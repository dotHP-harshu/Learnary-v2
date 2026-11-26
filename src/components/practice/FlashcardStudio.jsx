"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import EmptyState from "../ui/EmptyState";
import Skeleton from "../ui/Skeleton";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Chip from "../ui/Chip";
import ErrorState from "../ui/ErrorState";
import Modal from "../ui/Modal";
import {
  generateFlashcards,
  saveGeneratedCards,
  createCard,
  listCards,
  updateCard,
  setCardStatus,
  deleteCard,
  describeAIError,
} from "../../services/practice";
import { ackAIRequest } from "../../services/ai/aiClient";
import { ALGORITHM } from "../../utils/spacedRepetition";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import useAIResume from "../../hooks/useAIResume";
import useMountedRef from "../../hooks/useMountedRef";
import {
  Archive,
  Check,
  Layers,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

// Flashcards tab: generate → preview → save selected, manual creation,
// edit/suspend/delete, and the review-session entry point.
export default function FlashcardStudio({ userKey, toast, onReviewed, onStartReview, dueCount }) {
  const [cards, setCards] = useState(null); // null = loading
  const [listError, setListError] = useState(null);
  const [preview, setPreview] = useState(null); // generated candidates before saving
  const [selected, setSelected] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState({ topic: "", notes: "", card_count: 10 });
  const [manual, setManual] = useState({ front: "", back: "", explanation: "" });
  const [savingManual, setSavingManual] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const online = useOnlineStatus();
  const mountedRef = useMountedRef();
  const generationToken = useRef(0);
  const resumeScope = "flashcards";

  const loadCards = useCallback(async () => {
    setListError(null);
    const { data, error, offline } = await listCards();
    if (error) {
      setListError(`Couldn't load cards. ${error}`);
      return;
    }
    setCards(data);
    if (offline) {
      toast.info("You're offline — showing cached cards (read-only).");
    }
  }, [toast]);

  useEffect(() => {
    if (userKey) loadCards();
  }, [userKey, loadCards]);

  // Recover a generation that outlived this component (tab switch, reload,
  // PWA backgrounding). The preview is rebuilt from the stored result without
  // a second model call.
  useAIResume("generate_flashcards", resumeScope, {
    enabled: Boolean(userKey) && !preview,
    userKey,
    onPendingChange: setGenerating,
    onSucceeded: ({ data, requestId }) => {
      // An unusable succeeded payload must not be replayed on every mount.
      if (!Array.isArray(data?.cards)) {
        ackAIRequest("generate_flashcards", resumeScope, userKey, requestId);
        return;
      }
      generationToken.current += 1;
      setPreview(data.cards);
      setSelected(new Set(data.cards.map((_, i) => i)));
      ackAIRequest("generate_flashcards", resumeScope, userKey, requestId);
    },
    onFailed: ({ code }) => toast.error(describeAIError(code)),
  });

  const handleGenerate = async () => {
    if (generating || (!form.topic.trim() && !form.notes.trim())) return;
    const token = ++generationToken.current;
    setGenerating(true);
    const result = await generateFlashcards(
      {
        topic: form.topic.trim() || undefined,
        notes: form.notes.trim() || undefined,
        card_count: form.card_count,
      },
      { resumeScope }
    );
    // Unmounted mid-request: keep the handle so the next mount can recover it.
    if (!mountedRef.current) return;
    if (generationToken.current !== token) {
      setGenerating(false);
      return;
    }
    setGenerating(false);
    if (!result.ok) {
      toast.error(describeAIError(result.code, result.message));
      return;
    }
    if (!Array.isArray(result.data?.cards)) {
      toast.error("Generation returned no cards. Please try again.");
      return;
    }
    setPreview(result.data.cards);
    setSelected(new Set(result.data.cards.map((_, i) => i)));
    ackAIRequest("generate_flashcards", resumeScope, userKey, result.requestId);
  };

  const handleSavePreview = async () => {
    if (savingPreview || selected.size === 0) return;
    setSavingPreview(true);
    const chosen = preview.filter((_, i) => selected.has(i));
    const { error } = await saveGeneratedCards(userKey, chosen);
    setSavingPreview(false);
    if (error) {
      toast.error(`Couldn't save cards. ${error}`);
      return;
    }
    toast.success(`${chosen.length} card${chosen.length > 1 ? "s" : ""} saved.`);
    setPreview(null);
    setForm((f) => ({ ...f, topic: "", notes: "" }));
    loadCards();
    onReviewed?.();
  };

  const handleManualCreate = async (event) => {
    event?.preventDefault?.();
    if (savingManual || !manual.front.trim() || !manual.back.trim()) return;
    setSavingManual(true);
    const { data, error } = await createCard(userKey, {
      front: manual.front.trim(),
      back: manual.back.trim(),
      explanation: manual.explanation.trim(),
    });
    setSavingManual(false);
    if (error) {
      toast.error(`Couldn't save the card. ${error}`);
      return;
    }
    setManual({ front: "", back: "", explanation: "" });
    setManualOpen(false);
    toast.success("Card added.");
    setCards((prev) => [data, ...(prev ?? [])]);
    onReviewed?.();
  };

  const handleEdit = async (event) => {
    event?.preventDefault?.();
    if (savingEdit) return;
    setSavingEdit(true);
    const { error } = await updateCard(editing.id, {
      front: editing.front.trim(),
      back: editing.back.trim(),
      explanation: editing.explanation?.trim() || null,
    });
    setSavingEdit(false);
    if (error) {
      toast.error(`Couldn't update the card. ${error}`);
      return;
    }
    setEditing(null);
    toast.success("Card updated.");
    loadCards();
  };

  const handleToggleStatus = async (card) => {
    if (togglingId) return;
    const next = card.status === "suspended" ? "active" : "suspended";
    setTogglingId(card.id);
    const { error } = await setCardStatus(card.id, next);
    setTogglingId(null);
    if (error) {
      toast.error(`Couldn't ${next === "active" ? "resume" : "suspend"} the card. ${error}`);
      return;
    }
    loadCards();
  };

  const handleDelete = async () => {
    if (deletingId) return;
    setDeletingId(deleting.id);
    const { error } = await deleteCard(deleting.id);
    setDeletingId(null);
    if (error) {
      toast.error(`Couldn't delete the card. ${error}`);
      setDeleting(null);
      return;
    }
    setDeleting(null);
    toast.success("Card deleted (its review history goes with it).");
    loadCards();
    onReviewed?.();
  };

  const isDue = (card) =>
    card.status === "active" &&
    card.next_review_at &&
    new Date(card.next_review_at) <= new Date();

  return (
    <div className="flex flex-col gap-5">
      {/* Generate + manual entry */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" aria-hidden />
            <h2 className="text-sm font-semibold text-fg">Flashcards</h2>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setManualOpen((v) => !v)}
              disabled={!online}
            >
              <Plus size={14} aria-hidden /> Manual card
            </Button>
            <Button
              size="sm"
              onClick={onStartReview}
              disabled={!dueCount || !online}
            >
              <Play size={14} aria-hidden /> Review{dueCount ? ` (${dueCount})` : ""}
            </Button>
          </div>
        </div>

        {manualOpen && (
          <form onSubmit={handleManualCreate} className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
            <Input
              aria-label="Front (question or cue)"
              value={manual.front}
              onChange={(e) => setManual((m) => ({ ...m, front: e.target.value }))}
              placeholder="Front (question or cue)"
              maxLength={300}
              required
            />
            <Input
              aria-label="Back (the answer)"
              value={manual.back}
              onChange={(e) => setManual((m) => ({ ...m, back: e.target.value }))}
              placeholder="Back (the answer)"
              maxLength={600}
              required
            />
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Explanation (optional)"
                  value={manual.explanation}
                  onChange={(e) => setManual((m) => ({ ...m, explanation: e.target.value }))}
                  placeholder="Explanation (optional)"
                  maxLength={600}
                />
              </div>
              <Button type="submit" size="sm" loading={savingManual} disabled={!online || savingManual}>
                <Check size={14} aria-hidden /> Add
              </Button>
            </div>
          </form>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <Input
              aria-label="Topic for card generation"
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
              placeholder="Topic (e.g. React hooks)"
              maxLength={200}
            />
          </div>
          <Button
            onClick={handleGenerate}
            loading={generating}
            disabled={!online || (!form.topic.trim() && !form.notes.trim())}
          >
            Generate cards
          </Button>
        </div>
        <p className="mt-1.5 text-2xs text-fg-muted">
          Generation is online-only. New cards start unscheduled — they enter
          the review queue after your first review.
        </p>
      </div>

      {/* Preview → save selected */}
      {preview && (
        <section className="rounded-xl border border-accent bg-accent-soft/40 p-4" aria-label="Generated card preview">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">
              Preview — {selected.size} of {preview.length} selected
            </h3>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                Discard
              </Button>
              <Button size="sm" onClick={handleSavePreview} loading={savingPreview} disabled={selected.size === 0}>
                Save selected
              </Button>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {preview.map((card, i) => (
              <li key={i}>
                <label
                  htmlFor={`preview-card-${i}`}
                  aria-label="Select this generated card"
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <input
                    id={`preview-card-${i}`}
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    className="mt-1 accent-accent"
                  />
                  <span className="min-w-0 text-sm text-fg">
                    <span className="font-medium">{card.front}</span>
                    <span className="block truncate text-xs text-fg-muted">{card.back}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Card list */}
      <section aria-label="Your flashcards">
        <h2 className="mb-2 text-sm font-semibold text-fg">Your cards</h2>
        {cards === null && !listError ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : listError ? (
          <ErrorState title="" message={listError} onRetry={loadCards} retryLabel="Retry" />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No flashcards yet"
            description="Generate cards from a topic or add your first manual card."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className={`rounded-lg border bg-surface-muted px-3 py-2.5 ${
                  isDue(card) ? "border-accent" : "border-border"
                } ${card.status === "suspended" ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{card.front}</p>
                    <p className="truncate text-xs text-fg-muted">{card.back}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {card.status === "suspended" ? (
                        <Chip tone="neutral">Suspended</Chip>
                      ) : isDue(card) ? (
                        <Chip tone="warning">Due now</Chip>
                      ) : (
                        <span className="text-2xs text-fg-muted">
                          {card.next_review_at
                            ? `Next review ${new Date(card.next_review_at).toLocaleDateString()}`
                            : "Not scheduled yet"}
                        </span>
                      )}
                      <Chip tone="neutral">
                        {card.source === "ai" ? "Auto-generated" : "manual"}
                      </Chip>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      label={`Edit card: ${card.front}`}
                      size="sm"
                      disabled={Boolean(togglingId || deletingId)}
                      onClick={() => setEditing({ ...card })}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label={card.status === "suspended" ? "Resume card" : "Suspend card"}
                      size="sm"
                      disabled={Boolean(togglingId || deletingId)}
                      onClick={() => handleToggleStatus(card)}
                    >
                      {togglingId === card.id ? (
                        <LoaderCircle size={14} className="animate-spin" aria-hidden />
                      ) : card.status === "suspended" ? (
                        <Play size={14} />
                      ) : (
                        <Archive size={14} />
                      )}
                    </IconButton>
                    <IconButton
                      label={`Delete card: ${card.front}`}
                      size="sm"
                      disabled={Boolean(togglingId || deletingId)}
                      onClick={() => setDeleting(card)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-2xs text-fg-muted">
          Scheduling: {ALGORITHM.version} — again ≈ 10 min; hard ×1.2; good ×ease
          (start 2.5); easy ×ease×1.3; ease adjusts ±0.15 (1.3–3.0); max 365 days.
          Deleting source content unlinks cards rather than deleting them.
        </p>
      </section>

      {/* Edit modal (shared dialog primitive: focus trap, Esc, backdrop) */}
      {editing && (
        <Modal
          open
          onClose={() => {
            if (!savingEdit) setEditing(null);
          }}
          title="Edit card"
        >
          <form onSubmit={handleEdit} className="flex flex-col gap-2" aria-label="Edit card">
            <Textarea
              rows={2}
              value={editing.front}
              onChange={(e) => setEditing((c) => ({ ...c, front: e.target.value }))}
              maxLength={300}
              required
              aria-label="Front"
            />
            <Textarea
              rows={2}
              value={editing.back}
              onChange={(e) => setEditing((c) => ({ ...c, back: e.target.value }))}
              maxLength={600}
              required
              aria-label="Back"
            />
            <Textarea
              rows={2}
              value={editing.explanation ?? ""}
              onChange={(e) => setEditing((c) => ({ ...c, explanation: e.target.value }))}
              maxLength={600}
              placeholder="Explanation (optional)"
              aria-label="Explanation"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={savingEdit}>
                Cancel
              </Button>
              <Button type="submit" loading={savingEdit} disabled={savingEdit}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirm (same accessible pattern as TaskItem) */}
      {deleting && (
        <Modal
          open
          onClose={() => {
            if (!deletingId) setDeleting(null);
          }}
          title="Delete card?"
        >
          <p className="text-sm text-fg-muted">
            “{deleting.front}” and its review history will be permanently
            removed.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={Boolean(deletingId)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={Boolean(deletingId)}>
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
