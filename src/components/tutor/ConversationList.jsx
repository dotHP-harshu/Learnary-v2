"use client";

import { useEffect, useRef, useState } from "react";
import IconButton from "../ui/IconButton";
import Button from "../ui/Button";
import ErrorState from "../ui/ErrorState";
import Menu from "../ui/Menu";
import EmptyState from "../ui/EmptyState";
import Skeleton from "../ui/Skeleton";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

// Conversation list pane: start, rename, archive/unarchive, delete. Row actions
// live in a kebab menu so rows stay scannable; archived rows collapse below.
export default function ConversationList({
  conversations,
  collections,
  activeId,
  loading,
  online,
  error,
  onSelect,
  onNew,
  onRetry, // reload the conversation list; never creates a conversation
  onRename,
  onArchive, // (conversation, archived) => {}
  onDelete,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [focusRowId, setFocusRowId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const rowTitleRefs = useRef({});
  const renameInputRef = useRef(null);

  const active = conversations.filter((c) => c.status !== "archived");
  const archived = conversations.filter((c) => c.status === "archived");

  const contextLabel = (conversation) => {
    if (conversation.context_type === "collection") {
      const collection = collections.find(
        (c) => c.collection_id === conversation.collection_id
      );
      return collection?.title ?? "Collection";
    }
    if (conversation.context_type === "task") return "Task";
    return null;
  };

  // Form submit is the single commit path. Blur cancels — except when focus
  // moved to the Save button inside the same form (canceling would unmount
  // it before its submit can fire). `savingRename` guards double submits;
  // a failed save keeps the editor open with the draft text.
  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
  };

  const commitRename = async (conversation) => {
    if (savingRename) return;
    const title = renameDraft.trim();
    if (!title || title === conversation.title) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    const { error } = (await onRename(conversation, title)) ?? {};
    setSavingRename(false);
    if (error) return;
    cancelRename();
    setFocusRowId(conversation.id); // restore focus to the row after success
  };

  // Focus the renamed row's title button once, then consume the request.
  useEffect(() => {
    if (!focusRowId) return;
    rowTitleRefs.current[focusRowId]?.focus();
    setFocusRowId(null);
  }, [focusRowId]);

  // Move focus into the editor when it opens (replaces autoFocus, which is
  // hostile to screen-reader and keyboard users).
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleRenameBlur = (e) => {
    if (e.relatedTarget && e.currentTarget.form?.contains(e.relatedTarget)) {
      return; // focus stayed inside the editor (Save button)
    }
    cancelRename();
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={onRetry}
        retryLabel="Try again"
        retryDisabled={!online}
      />
    );
  }

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No conversations yet"
        description="Ask your tutor anything about what you're learning. Conversations are saved automatically."
      />
    );
  }

  const row = (conversation) => {
    const isActive = conversation.id === activeId;
    const isArchivedRow = conversation.status === "archived";
    const label = contextLabel(conversation);
    return (
      <li key={conversation.id}>
        {renamingId === conversation.id ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commitRename(conversation);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-surface p-1.5"
          >
            <input
              ref={renameInputRef}
              value={renameDraft}
              maxLength={120}
              disabled={savingRename}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={handleRenameBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              className="min-w-0 flex-1 bg-transparent px-1.5 text-sm text-fg outline-none"
              aria-label="Conversation title"
            />
            <Button
              type="submit"
              size="sm"
              loading={savingRename}
              // Keep the input focused on click so blur can't cancel the
              // form before its submit fires (Safari never focuses buttons).
              onMouseDown={(e) => e.preventDefault()}
            >
              Save
            </Button>
          </form>
        ) : (
          <div
            className={`relative flex items-center gap-1 rounded-lg border py-2 pl-3.5 pr-1.5 transition-colors duration-200 ${
              isActive
                ? "border-accent/40 bg-accent-soft"
                : "border-transparent hover:border-border hover:bg-surface-muted"
            }`}
          >
            {/* Active-row indicator (not color alone) */}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent"
              />
            )}
            <button
              type="button"
              ref={(el) => {
                rowTitleRefs.current[conversation.id] = el;
              }}
              onClick={() => onSelect(conversation)}
              className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none"
            >
              <span
                className={`block truncate text-sm ${
                  isActive ? "font-medium text-accent" : "text-fg"
                }`}
              >
                {conversation.title}
              </span>
              <span
                className={`block truncate text-2xs ${
                  label ? "text-fg-muted" : ""
                }`}
              >
                {label ?? (isArchivedRow ? "Archived" : "")}
              </span>
            </button>
            <Menu
              label={`Options for conversation: ${conversation.title}`}
              align="right"
              trigger={({ toggle, menuProps }) => (
                <IconButton
                  label={`Options for conversation: ${conversation.title}`}
                  size="sm"
                  onClick={toggle}
                  {...menuProps}
                >
                  <MoreHorizontal size={15} />
                </IconButton>
              )}
              items={[
                {
                  label: "Rename",
                  icon: Pencil,
                  onSelect: () => {
                    setRenamingId(conversation.id);
                    setRenameDraft(conversation.title);
                  },
                },
                {
                  label: isArchivedRow ? "Unarchive" : "Archive",
                  icon: isArchivedRow ? ArchiveRestore : Archive,
                  onSelect: () => onArchive(conversation, !isArchivedRow),
                },
                {
                  label: "Delete",
                  icon: Trash2,
                  danger: true,
                  onSelect: () => onDelete(conversation),
                },
              ]}
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-full">
      <Button variant="primary" onClick={onNew} disabled={!online} className="w-full shrink-0">
        <MessageSquarePlus size={16} aria-hidden />
        New conversation
      </Button>
      <div className="scrollable min-h-0 flex-1 overflow-y-auto lg:pr-0.5">
        <ul className="flex flex-col gap-0.5" aria-label="Conversations">
          {active.map(row)}
        </ul>
        {archived.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
            >
              {showArchived ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
              Archived ({archived.length})
            </Button>
            {showArchived && (
              <ul className="mt-1 flex flex-col gap-0.5" aria-label="Archived conversations">
                {archived.map(row)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
