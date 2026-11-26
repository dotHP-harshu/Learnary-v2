"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import Chip from "../ui/Chip";
import Menu from "../ui/Menu";
import SegmentedControl from "../ui/SegmentedControl";
import Markdown from "../ui/Markdown";
import Skeleton from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import ContextUsed from "../ui/ContextUsed";
import { sendTutorMessage, describeAIError } from "../../services/tutor";
import { ackAIRequest, RETRYABLE_AI_CODES } from "../../services/ai/aiClient";
import useAIResume from "../../hooks/useAIResume";
import { tutorScope } from "../../utils/aiScopes";
import {
  BookOpen,
  Check,
  CircleAlert,
  ClipboardCheck,
  Lightbulb,
  LoaderCircle,
  MessagesSquare,
  RotateCcw,
  Send,
  Shapes,
  Sparkles,
  X,
} from "lucide-react";

// Tutor chat pane: context chip + selector, message list, and the persistent honesty footer note.

const MODES = [
  { value: "explain", label: "Explain", Icon: BookOpen },
  { value: "socratic", label: "Socratic", Icon: MessagesSquare },
  { value: "hints", label: "Hints", Icon: Lightbulb },
  { value: "examples", label: "Examples", Icon: Shapes },
  { value: "review", label: "Review", Icon: ClipboardCheck },
];

const EXAMPLE_PROMPTS = {
  general: [
    "Explain the difference between let, const, and var like I'm new to this.",
    "I keep procrastinating on studying — help me plan a realistic week.",
    "Quiz me with 5 questions on a topic I choose.",
  ],
  collection: [
    "What should I focus on next in this collection?",
    "Explain the core idea behind my latest task here.",
    "Give me 3 practice exercises for this subject.",
  ],
};

function TypingIndicator() {
  return (
    <li className="flex items-start" role="status" aria-label="Tutor is typing">
      <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-muted px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-muted"
            style={{ animationDelay: `${-0.3 + i * 0.15}s` }}
          />
        ))}
      </div>
    </li>
  );
}

export default function TutorChat({
  conversation, // {id, title, context_type, collection_id, task_id, status}
  messages,
  collections,
  online,
  userKey,
  loadingMessages = false,
  onMessagesChanged, // reload messages + conversation list
  onContextChanged, // (patch) => update conversation context
  onConversationCreated, // (id) => adopt a server-created conversation
  onBack,
}) {
  const toast = useToast();
  const [mode, setMode] = useState("explain");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [lastContextUsed, setLastContextUsed] = useState(null);
  const bottomRef = useRef(null);

  const isArchived = conversation?.status === "archived";
  const scope = tutorScope(conversation?.id);

  // Recover a tutor turn whose response was lost (tab switch, reload,
  // backgrounding, dropped connection). The reply is already persisted in
  // Supabase, so recovery only needs to reload the conversation — never resend.
  useAIResume("tutor_chat", scope, {
    enabled: Boolean(userKey) && !isArchived,
    userKey,
    onPendingChange: (pending) => setSending(pending),
    onSucceeded: ({ data, requestId, scope: resumedScope }) => {
      setSending(false);
      if (!conversation?.id && data?.conversation_id) {
        onConversationCreated?.(data.conversation_id);
      }
      setLastContextUsed(
        Array.isArray(data?.context_used) ? data.context_used : null
      );
      ackAIRequest("tutor_chat", resumedScope, userKey, requestId);
      onMessagesChanged();
    },
    onFailed: ({ code }) => {
      setSending(false);
      toast.error(describeAIError(code));
      onMessagesChanged();
    },
    onMissing: () => setSending(false),
  });

  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, sending]);

  const lastMessage = messages[messages.length - 1] ?? null;
  const canRegenerate =
    !isArchived &&
    online &&
    !sending &&
    lastMessage &&
    (lastMessage.role === "assistant" || lastMessage.status === "failed");

  // The per-message "Auto-generated" note stays on the newest assistant reply
  // only; the persistent footer note always covers the rest.
  const lastCompleteAssistantId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.status === "complete")?.id;

  const contextType = conversation?.context_type ?? "general";
  const contextCollection = collections.find(
    (c) => c.collection_id === conversation?.collection_id
  );

  const send = async (text, { regenerate = false } = {}) => {
    const requestScope = scope;
    setSending(true);
    let result;
    try {
      result = await sendTutorMessage({
        conversationId: conversation?.id ?? null,
        message: text,
        mode,
        contextType,
        collectionId: conversation?.collection_id ?? null,
        taskId: conversation?.task_id ?? null,
        regenerate,
        resumeScope: requestScope,
      });
    } catch (err) {
      setSending(false);
      toast.error(err?.message || "The request failed. Please try again.");
      onMessagesChanged();
      return;
    }
    if (!result.ok) {
      if (RETRYABLE_AI_CODES.has(result.code)) {
        // The server may still finish and persist the reply. Do not offer a
        // retry that would create a second turn — the hook will resolve it.
        setSending(true);
        onMessagesChanged();
        return;
      }
      setSending(false);
      toast.error(describeAIError(result.code, result.message), {
        action: { label: "Retry", onClick: () => send(text, { regenerate }) },
      });
      onMessagesChanged(); // surface the failed/pending state of history
      return;
    }
    setSending(false);
    // First message on an unsaved conversation: adopt the conversation the
    // server just created so the page tracks and reloads it.
    if (!conversation?.id && result.data?.conversation_id) {
      onConversationCreated?.(result.data.conversation_id);
    }
    // What this reply actually used.
    setLastContextUsed(
      Array.isArray(result.data?.context_used) ? result.data.context_used : null
    );
    ackAIRequest("tutor_chat", requestScope, userKey, result.requestId);
    onMessagesChanged();
  };

  const handleSend = async (event) => {
    event?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await send(text);
  };

  const setContext = (patch) => onContextChanged(patch);

  const contextLabel = () => {
    if (contextType === "collection" && contextCollection) {
      return `Collection: ${contextCollection.title}`;
    }
    if (contextType === "task" && conversation?.task_id) return "Task context";
    return "General";
  };

  const promptsDisabled = isArchived || !online || sending;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {/* Header: title, context chip/selector, archive state */}
      <div className="flex items-center gap-2 border-b border-border p-3">
        {onBack && (
          <IconButton label="Back to conversations" variant="ghost" size="sm" onClick={onBack} className="lg:hidden">
            <X size={16} />
          </IconButton>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
          {conversation?.title ?? "New conversation"}
        </h2>
        {isArchived && <Chip size="sm">archived</Chip>}
        <Menu
          label="Tutor context"
          align="right"
          panelClassName="w-56"
          trigger={({ toggle, menuProps }) => (
            <button
              type="button"
              {...menuProps}
              onClick={toggle}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors duration-200 hover:border-border-strong hover:text-fg"
            >
              <Sparkles size={12} className="text-accent" aria-hidden />
              <span className="max-w-44 truncate">{contextLabel()}</span>
            </button>
          )}
          items={[
            {
              label: "General question",
              icon: contextType === "general" ? Check : undefined,
              onSelect: () =>
                setContext({ context_type: "general", collection_id: null }),
            },
            ...collections.map((c) => ({
              label: c.title,
              icon:
                contextType === "collection" &&
                conversation?.collection_id === c.collection_id
                  ? Check
                  : undefined,
              onSelect: () =>
                setContext({ context_type: "collection", collection_id: c.collection_id }),
            })),
          ]}
        />
      </div>

      {/* What the latest reply used. */}
      {lastContextUsed && (
        <div className="border-b border-border px-4 py-2">
          <ContextUsed items={lastContextUsed} />
        </div>
      )}

      {/* Messages */}
      <div className="scrollable flex-1 overflow-y-auto p-4" aria-live="polite">
        {loadingMessages && messages.length === 0 ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-3/4" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-2 pb-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
              <Sparkles size={24} className="text-accent" aria-hidden />
            </span>
            <h3 className="mt-4 text-base font-semibold text-fg">
              {contextType === "collection" && contextCollection
                ? `Your ${contextCollection.title} tutor`
                : "What are you learning?"}
            </h3>
            <p className="mt-1 max-w-xs text-sm text-fg-muted">
              Ask anything about what you're learning — pick a starter below.
            </p>
            <div className="mt-5 flex w-full max-w-sm flex-col gap-2">
              {(EXAMPLE_PROMPTS[contextType] ?? EXAMPLE_PROMPTS.general).map(
                (prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={promptsDisabled}
                    onClick={() => {
                      setDraft("");
                      send(prompt);
                    }}
                    className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3.5 py-2.5 text-left text-sm text-fg transition-colors duration-200 hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0">{prompt}</span>
                    <Send
                      size={13}
                      aria-hidden
                      className="shrink-0 text-fg-muted transition-colors group-hover:text-accent"
                    />
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <li
                  key={m.id}
                  className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[min(85%,42rem)] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      isUser
                        ? "whitespace-pre-line rounded-br-sm bg-accent-strong text-accent-fg"
                        : "rounded-bl-sm border border-border bg-surface-muted text-fg"
                    } ${m.status === "failed" ? "opacity-70" : ""}`}
                  >
                    {isUser ? (
                      m.content
                    ) : (
                      <Markdown>{m.content}</Markdown>
                    )}
                  </div>
                  {m.status === "failed" && (
                    <div className="flex items-center gap-1.5 text-xs text-error">
                      <CircleAlert size={12} aria-hidden />
                      <span>Failed to get a reply.</span>
                      <button
                        type="button"
                        onClick={() => send(null, { regenerate: true })}
                        disabled={sending}
                        className="min-h-8 font-medium underline disabled:opacity-60"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {m.role === "assistant" &&
                    m.status === "complete" &&
                    m.id === lastCompleteAssistantId && (
                      <span className="flex items-center gap-1 text-2xs text-fg-muted">
                        <Sparkles size={11} aria-hidden />
                        Auto-generated — may be wrong, verify what matters
                      </span>
                    )}
                </li>
              );
            })}
            {sending && <TypingIndicator />}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="border-t border-border p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {/* Native fieldset disable keeps the archived lock-out exactly as
              before, since SegmentedControl itself has no disabled prop. */}
          <fieldset
            disabled={isArchived}
            className="flex min-w-0 flex-wrap items-center gap-1.5 disabled:opacity-60"
          >
            <SegmentedControl
              size="sm"
              ariaLabel="Tutor mode"
              options={MODES}
              value={mode}
              onChange={setMode}
            />
          </fieldset>
          {canRegenerate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => send(null, { regenerate: true })}
              disabled={sending}
              className="ml-auto"
            >
              <RotateCcw size={12} aria-hidden />
              Regenerate
            </Button>
          )}
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border border-border bg-surface-muted p-1.5 transition-colors duration-200 focus-within:border-accent">
          <label htmlFor="tutor-message" className="sr-only">
            Message your tutor
          </label>
          <textarea
            id="tutor-message"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isArchived || !online}
            placeholder={
              !online
                ? "You're offline — the tutor needs an internet connection."
                : isArchived
                  ? "Unarchive this conversation to continue."
                  : "Ask your tutor…  (Enter to send, Shift+Enter for a new line)"
            }
            className="min-h-11 max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-fg outline-none placeholder:text-fg-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <IconButton
            label="Send message"
            variant="solid"
            size="md"
            type="submit"
            disabled={isArchived || !online || !draft.trim() || sending}
            className="h-10 w-10"
          >
            {sending ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden />
            ) : (
              <Send size={16} aria-hidden />
            )}
          </IconButton>
        </div>
        <p className="mt-1.5 text-2xs text-fg-muted">
          Tutor replies are model-generated and may be wrong — nothing is
          executed or fetched from external sources. Each message uses quota.
        </p>
      </form>
    </div>
  );
}
