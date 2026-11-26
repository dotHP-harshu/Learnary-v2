// Tutor client. Conversations + messages persist in Supabase (refresh-safe);
// sends go through the single /api/learnary-ai envelope — never the provider directly.

import supabase from "../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { callAI, describeAIError } from "../services/ai/aiClient";
import { scopedKey } from "../utils/idbCacheOwner";

const LIST_CACHE_KEY = "tutor:conversations";
const convCacheKey = (id) => `tutor:conv:${id}`;
// A conversation can grow without bound. Load the newest window (the part the
// chat pane shows) instead of downloading every message on each open; the
// ascending order is restored client-side for rendering.
const MESSAGE_WINDOW = 200;

/** List active + archived conversations, most recently updated first. */
export async function listConversations() {
  const listKey = scopedKey(LIST_CACHE_KEY);
  if (!navigator.onLine) {
    const cached = listKey ? await idbGet(listKey) : undefined;
    return { data: cached ?? [], error: null, offline: true };
  }
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, context_type, collection_id, task_id, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) return { data: null, error: error.message, offline: false };
  if (listKey) await idbSet(listKey, data ?? []);
  return { data: data ?? [], error: null, offline: false };
}

/** Full message history for one conversation (refresh-safe reload). */
export async function getMessages(conversationId) {
  const key = scopedKey(convCacheKey(conversationId));
  if (!navigator.onLine) {
    const cached = key ? await idbGet(key) : undefined;
    return { data: cached ?? null, error: null, offline: true };
  }
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, status, created_at, model_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_WINDOW);
  if (error) return { data: null, error: error.message, offline: false };
  const rows = (data ?? []).slice().reverse();
  await idbSet(convCacheKey(conversationId), rows);
  return { data: rows, error: null, offline: false };
}

/**
 * Send one tutor turn.
 * @returns {{ok:true, data:{conversation_id,title,user_message_id,assistant_message,context_summary,message_reused}} |
 *   {ok:false, code, message, retryAfter}}
 */
export async function sendTutorMessage({ conversationId, message, mode, contextType, collectionId, taskId, title, regenerate, resumeScope, resumeMeta }) {
  const result = await callAI("tutor_chat", {
    context: conversationId ? { conversation_id: conversationId } : {},
    input: {
      ...(regenerate ? { regenerate: true } : { message }),
      mode,
      context_type: contextType,
      ...(contextType === "collection" && collectionId ? { collection_id: collectionId } : {}),
      ...(contextType === "task" && taskId ? { task_id: taskId } : {}),
      ...(title ? { title } : {}),
    },
    resumeScope,
    resumeMeta,
  });
  return result;
}

export async function createConversation(userKey, { title, contextType, collectionId, taskId }) {
  if (!navigator.onLine) {
    return { data: null, error: "You are offline. The tutor needs an internet connection.", offline: true };
  }
  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      user_id: userKey,
      title: title || "New conversation",
      context_type: contextType ?? "general",
      collection_id: contextType === "collection" ? collectionId : null,
      task_id: contextType === "task" ? taskId : null,
    })
    .select("id, title, status")
    .single();
  return { data, error: error?.message ?? null, offline: false };
}

export async function renameConversation(conversationId, title) {
  const { error } = await supabase
    .from("ai_conversations")
    .update({ title })
    .eq("id", conversationId);
  return { error: error?.message ?? null };
}

export async function setConversationStatus(conversationId, status) {
  const { error } = await supabase
    .from("ai_conversations")
    .update({ status })
    .eq("id", conversationId);
  return { error: error?.message ?? null };
}

export async function deleteConversation(conversationId) {
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId);
  return { error: error?.message ?? null };
}

export { describeAIError };
