"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import UserContext from "../../../context/userContext";
import TutorChat from "../../../components/tutor/TutorChat";
import ConversationList from "../../../components/tutor/ConversationList";
import { useToast } from "../../../components/ui/Toast";
import Modal from "../../../components/ui/Modal";
import PageHeader from "../../../components/ui/PageHeader";
import Chip from "../../../components/ui/Chip";
import Button from "../../../components/ui/Button";
import {
  listConversations,
  getMessages,
  renameConversation,
  setConversationStatus,
  deleteConversation,
} from "../../../services/tutor";
import supabase from "../../../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";

// The tutor only needs { collection_id, title }. Its projection gets its own
// cache key so it can never overwrite the full `collections` snapshot that the
// Collections page relies on (created_at, id, …).
const COLLECTIONS_LITE_KEY = "collections:lite";

// Tutor page: two-pane layout — conversation list + chat, reloaded from the
// database so conversations survive refresh; reads fall back to the idb cache.
function Tutor() {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const [online, setOnline] = useState(true);
  const [conversations, setConversations] = useState(null); // null = loading
  const [listError, setListError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [collections, setCollections] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const loadSeq = useRef(0);

  const userKey = user?.id ?? null;

  // Track connectivity with events, not a render-time `navigator.onLine` read.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const loadConversations = useCallback(async () => {
    setListError(null);
    const { data, error, offline } = await listConversations();
    if (error) {
      setListError(`Couldn't load conversations. ${error}`);
      return null;
    }
    setConversations(data);
    if (offline) {
      toast.info("You're offline — showing cached conversations (read-only).");
    }
    return data;
  }, [toast]);

  const loadMessages = useCallback(
    async (conversationId) => {
      if (!conversationId) {
        setMessages([]);
        return;
      }
      const seq = ++loadSeq.current;
      setMessagesLoading(true);
      const { data, error } = await getMessages(conversationId);
      if (seq !== loadSeq.current) return; // stale response for an old selection
      setMessagesLoading(false);
      if (error) {
        toast.error(`Couldn't load messages. ${error}`, {
          action: { label: "Retry", onClick: () => loadMessages(conversationId) },
        });
        return;
      }
      setMessages(data);
    },
    [toast]
  );

  // Initial load: conversations + collections (for the context selector).
  useEffect(() => {
    if (!userKey) return;
    loadConversations().then((data) => {
      if (data?.length) setActiveId((current) => current ?? data[0].id);
    });
    const loadCollections = async () => {
      if (!navigator.onLine) {
        const lite = await idbGet(COLLECTIONS_LITE_KEY);
        if (lite) {
          setCollections(lite);
          return;
        }
        // First offline visit: derive the lite shape from the full snapshot.
        const full = (await idbGet("collections")) ?? [];
        setCollections(
          full.map((c) => ({ collection_id: c.collection_id, title: c.title }))
        );
        return;
      }
      const { data, error } = await supabase
        .from("collections")
        .select("collection_id, title")
        .order("created_at", { ascending: false });
      if (!error && data) {
        setCollections(data);
        await idbSet(COLLECTIONS_LITE_KEY, data);
      }
    };
    loadCollections();
  }, [userKey, loadConversations]);

  // Messages for the selected conversation (refresh-safe reload).
  useEffect(() => {
    loadMessages(activeId);
  }, [activeId, loadMessages]);

  const activeConversation =
    conversations?.find((c) => c.id === activeId) ?? null;

  const handleSelect = (conversation) => setActiveId(conversation.id);

  const handleNew = () => {
    // A new conversation is created server-side on the first message —
    // deselecting shows the empty chat pane with example prompts.
    setActiveId(null);
    setMessages([]);
  };

  const handleRename = async (conversation, title) => {
    const { error } = await renameConversation(conversation.id, title);
    if (error) {
      toast.error(`Couldn't rename. ${error}`);
      // Returning the error keeps the rename editor open with the draft text.
      return { error };
    }
    setConversations((prev) =>
      prev?.map((c) => (c.id === conversation.id ? { ...c, title } : c))
    );
    return { error: null };
  };

  const handleArchive = async (conversation, archived) => {
    const { error } = await setConversationStatus(
      conversation.id,
      archived ? "archived" : "active"
    );
    if (error) {
      toast.error(`Couldn't ${archived ? "archive" : "unarchive"}. ${error}`);
      return;
    }
    // The conversation stays open but read-only; the composer explains why.
    loadConversations();
  };

  const handleDelete = async (conversation) => {
    const { error } = await deleteConversation(conversation.id);
    setDeleteTarget(null);
    if (error) {
      toast.error(`Couldn't delete. ${error}`);
      return;
    }
    toast.success("Conversation deleted.");
    const next = await loadConversations();
    if (conversation.id === activeId) {
      setActiveId(next?.[0]?.id ?? null);
    }
  };

  const handleContextChanged = async (patch) => {
    if (!activeConversation) return;
    const { error } = await supabase
      .from("ai_conversations")
      .update(patch)
      .eq("id", activeConversation.id);
    if (error) {
      toast.error(`Couldn't change context. ${error}`);
      return;
    }
    setConversations((prev) =>
      prev?.map((c) => (c.id === activeConversation.id ? { ...c, ...patch } : c))
    );
  };

  const reloadAll = useCallback(() => {
    loadConversations();
    loadMessages(activeId);
  }, [loadConversations, loadMessages, activeId]);

  // Belt-and-braces for DB-backed history: a reply that finished while this tab
  // was backgrounded is already in Supabase, so a cheap refresh on return
  // surfaces it even if no client journal entry survived.
  useEffect(() => {
    if (!userKey) return;
    let last = 0;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (!navigator.onLine) return;
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      reloadAll();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [userKey, reloadAll]);

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask, practise, and review — grounded in your learning context."
        actions={
          !online ? (
            <Chip tone="warning" size="md">
              Offline — tutor is read-only
            </Chip>
          ) : undefined
        }
      />

      <div className="mt-6 grid h-[calc(100dvh-16rem)] min-h-[20rem] gap-4 lg:h-[calc(100dvh-8rem)] lg:min-h-[28rem] lg:grid-cols-[17rem_1fr]">
        <section
          aria-label="Conversations"
          className={`h-full min-h-0 ${activeId ? "max-lg:hidden" : ""}`}
        >
          <ConversationList
            conversations={conversations ?? []}
            collections={collections}
            activeId={activeId}
            loading={conversations === null && !listError}
            online={online}
            error={listError}
            onSelect={handleSelect}
            onNew={handleNew}
            onRetry={loadConversations}
            onRename={handleRename}
            onArchive={handleArchive}
            onDelete={(conversation) => setDeleteTarget(conversation)}
          />
        </section>
        <section
          aria-label="Tutor chat"
          className={activeId ? "" : "max-lg:hidden"}
        >
          <TutorChat
            conversation={activeConversation}
            messages={messages}
            collections={collections}
            online={online}
            userKey={userKey}
            loadingMessages={messagesLoading}
            onMessagesChanged={reloadAll}
            onContextChanged={handleContextChanged}
            onConversationCreated={(id) => setActiveId(id)}
            onBack={() => setActiveId(null)}
          />
        </section>
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete conversation?"
      >
        <p className="text-sm text-fg-muted">
          “{deleteTarget?.title}” and all of its messages will be permanently
          removed.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => handleDelete(deleteTarget)}>
            Delete
          </Button>
        </div>
      </Modal>
    </>
  );
}

export default Tutor;
