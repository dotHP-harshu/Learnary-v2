"use client";

import { useContext, useEffect, useRef, useState } from "react";
import UserContext from "../../context/userContext";
import Skeleton from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import ErrorState from "../ui/ErrorState";
import { useToast } from "../ui/Toast";
import {
  callAI,
  describeAIError,
  ackAIRequest,
} from "../../services/ai/aiClient";
import useAIResume from "../../hooks/useAIResume";
import useMountedRef from "../../hooks/useMountedRef";
import {
  fetchRoadmap,
  saveRoadmap,
} from "../../services/roadmap";
import { fetchLearningProfile } from "../../services/profile";
import { getUserKey } from "../../utils/getUserKey";
import {
  renumberDraft,
  clearPersistedDraft,
  createManualDraft,
  createDraftFromSnapshot,
  loadPersistedDraft,
  persistDraft,
} from "../../utils/roadmapDraft";
import RoadmapForm from "./RoadmapForm";
import RoadmapEditor from "./RoadmapEditor";
import RoadmapView from "./RoadmapView";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import { Map, PencilLine, Sparkles } from "lucide-react";

// Roadmap container: empty → (generate form | manual draft) → editor/view.
// view: "loading" | "error" | "empty" | "form" | "editor" | "saved"
export default function RoadmapPage({ collectionId, collectionTitle }) {
  const { user } = useContext(UserContext);
  const userKey = getUserKey(user);
  const toast = useToast();
  const mountedRef = useMountedRef();
  // Invalidates a late generation when the learner switches to a manual draft
  // or starts editing the saved roadmap.
  const generationToken = useRef(0);

  const [view, setView] = useState("loading");
  const [errorState, setErrorState] = useState(null);
  const [snapshot, setSnapshot] = useState(null); // saved roadmap + prereqs
  const [offline, setOffline] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [profile, setProfile] = useState(null);

  const [draft, setDraft] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [saving, setSaving] = useState(false);
  // True while the editor is modifying the saved roadmap rather than a new
  // one — saveDraft then uses replace_roadmap to keep task links and step
  // progress.
  const [editingSaved, setEditingSaved] = useState(false);
  const isOnline = useOnlineStatus();

  // Draft edits are frequent (every keystroke); the sessionStorage snapshot
  // does not need to be written that often. Debounce it, and flush the last
  // pending edit if the page unmounts mid-window.
  const persistTimer = useRef(null);
  const pendingPersist = useRef(null);

  const cancelPendingPersist = () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    pendingPersist.current = null;
  };

  const schedulePersist = (next) => {
    pendingPersist.current = { userKey, collectionId, draft: next };
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      const pending = pendingPersist.current;
      pendingPersist.current = null;
      if (pending) {
        persistDraft(pending.userKey, pending.collectionId, pending.draft);
      }
    }, 400);
  };

  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        const pending = pendingPersist.current;
        if (pending) {
          persistDraft(pending.userKey, pending.collectionId, pending.draft);
        }
      }
      persistTimer.current = null;
      pendingPersist.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setView("loading");
      const result = await fetchRoadmap(collectionId, getUserKey(user));
      if (!active) return;
      setOffline(result.offline);
      if (result.error) {
        setErrorState(result.error);
        setView("error");
        return;
      }
      if (result.data?.roadmap) {
        setSnapshot(result.data);
        setView("saved");
      } else {
        setView("empty");
      }
    };
    load();

    // Availability (cheap status call, no quota) decides whether the generate
    // path is offered; the manual path never depends on it.
    fetchLearningProfile(getUserKey(user)).then(({ data }) => {
      if (active) setProfile(data);
    });
    if (navigator.onLine) {
      callAI("status").then((result) => {
        if (active) setAiAvailable(Boolean(result.ok && result.data?.available));
      });
    } else {
      setAiAvailable(false);
    }

    return () => {
      active = false;
    };
  }, [collectionId, user]);

  const roadmapScope = collectionId ? `roadmap:${collectionId}` : null;

  // Recover a generation that outlived this component (tab switch, reload,
  // PWA backgrounding). The server stored the result for idempotency; this
  // reopens the same editable draft without a second model call.
  useAIResume("generate_roadmap", roadmapScope, {
    enabled:
      Boolean(userKey && roadmapScope) &&
      view !== "loading" &&
      view !== "error" &&
      !draft,
    userKey,
    onPendingChange: setResuming,
    onSucceeded: ({ data, requestId }) => {
      // An unusable succeeded payload must not be replayed on every mount.
      if (!data?.roadmap) {
        ackAIRequest("generate_roadmap", roadmapScope, userKey, requestId);
        return;
      }
      generationToken.current += 1;
      const next = renumberDraft({
        ...data.roadmap,
        assumptions: data.roadmap.assumptions ?? [],
        stages: data.roadmap.stages,
      });
      cancelPendingPersist();
      setDraft(next);
      persistDraft(userKey, collectionId, next);
      setView("editor");
      setResuming(false);
      ackAIRequest("generate_roadmap", roadmapScope, userKey, requestId);
    },
    onFailed: ({ code }) => {
      setResuming(false);
      toast.error(describeAIError(code));
    },
    onMissing: () => setResuming(false),
  });

  // ---- draft lifecycle ------------------------------------------------------

  const startAiDraft = () => {
    // Any in-progress draft from a reload resumes; otherwise the form.
    const resumed = loadPersistedDraft(userKey, collectionId);
    if (resumed) {
      setDraft(resumed);
      setView("editor");
    } else {
      setView("form");
    }
  };

  const startManualDraft = () => {
    generationToken.current += 1;
    if (roadmapScope) ackAIRequest("generate_roadmap", roadmapScope, userKey);
    const resumed = loadPersistedDraft(userKey, collectionId);
    if (resumed) {
      setDraft(resumed);
    } else {
      setDraft(createManualDraft());
    }
    setView("editor");
  };

  const generateDraft = async (input) => {
    const scope = roadmapScope;
    const token = ++generationToken.current;
    setGenerating(true);
    const result = await callAI("generate_roadmap", {
      context: { collection_id: collectionId },
      input,
      resumeScope: scope,
    });
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
    if (!result.data?.roadmap) {
      toast.error("Generation returned an empty roadmap. Please try again.");
      return;
    }
    const next = renumberDraft({
      ...result.data.roadmap,
      assumptions: result.data.roadmap.assumptions ?? [],
      stages: result.data.roadmap.stages,
    });
    cancelPendingPersist();
    setDraft(next);
    persistDraft(userKey, collectionId, next);
    setView("editor");
    ackAIRequest("generate_roadmap", scope, userKey, result.requestId);
  };

  const updateDraft = (next) => {
    setDraft(next);
    schedulePersist(next);
  };

  const discardDraft = () => {
    generationToken.current += 1;
    if (roadmapScope) ackAIRequest("generate_roadmap", roadmapScope, userKey);
    cancelPendingPersist();
    clearPersistedDraft(userKey, collectionId);
    setDraft(null);
    setEditingSaved(false);
    setView(snapshot ? "saved" : "empty");
  };

  // Edit the saved roadmap. The snapshot converts into a draft whose steps
  // carry their DB ids and statuses; saving replaces the roadmap atomically
  // (replace_roadmap) instead of leaving it read-only.
  const editSavedRoadmap = () => {
    if (!snapshot) return;
    generationToken.current += 1;
    if (roadmapScope) ackAIRequest("generate_roadmap", roadmapScope, userKey);
    setDraft(createDraftFromSnapshot(snapshot));
    setEditingSaved(true);
    setView("editor");
  };

  const saveDraft = async () => {
    setSaving(true);
    const { error, offline: offlineSave } = await saveRoadmap(
      collectionId,
      getUserKey(user),
      draft,
      { previousRoadmapId: editingSaved ? snapshot?.roadmap?.id : null }
    );
    setSaving(false);
    if (error) {
      toast.error(
        offlineSave
          ? "You're offline — reconnect to save the roadmap."
          : "Couldn't save the roadmap. Please try again.",
        offlineSave
          ? undefined
          : { action: { label: "Retry", onClick: saveDraft } }
      );
      return;
    }
    cancelPendingPersist();
    clearPersistedDraft(userKey, collectionId);
    if (roadmapScope) ackAIRequest("generate_roadmap", roadmapScope, userKey);
    setEditingSaved(false);
    // Reload the canonical saved snapshot (also refreshes the idb cache).
    const result = await fetchRoadmap(collectionId, getUserKey(user));
    if (!result.error && result.data?.roadmap) {
      setSnapshot(result.data);
      setView("saved");
      toast.success(
        editingSaved
          ? "Roadmap updated. Your tasks and step progress are preserved."
          : "Roadmap saved. Nothing is added to your tasks until you choose to."
      );
    } else {
      toast.error("Saved, but the view couldn't refresh. Please reopen this page.");
    }
  };

  // ---- render ---------------------------------------------------------------

  if (view === "loading" || resuming) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (view === "error") {
    return (
      <ErrorState
        title="Couldn't load the roadmap"
        message={errorState}
        retryLabel="Retry"
        onRetry={() => {
          fetchRoadmap(collectionId, getUserKey(user)).then((result) => {
            if (result.error) return;
            setOffline(result.offline);
            if (result.data?.roadmap) {
              setSnapshot(result.data);
              setView("saved");
            } else {
              setView("empty");
            }
          });
        }}
      />
    );
  }

  if (view === "empty") {
    return (
      <EmptyState
        icon={Map}
        title="No roadmap yet"
        description="Turn this collection's goal into an ordered plan of stages, milestones, and steps — automatically or by hand."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={startAiDraft} disabled={!aiAvailable}>
              <Sparkles size={14} aria-hidden />
              Auto-build
            </Button>
            <Button size="sm" variant="secondary" onClick={startManualDraft}>
              <PencilLine size={14} aria-hidden />
              Create manually
            </Button>
          </div>
        }
      />
    );
  }

  if (view === "form") {
    return (
      <RoadmapForm
        collectionTitle={collectionTitle}
        profile={profile}
        online={!offline && isOnline}
        aiAvailable={aiAvailable}
        generating={generating}
        onSubmit={generateDraft}
        onCancel={() => setView(snapshot ? "saved" : "empty")}
      />
    );
  }

  if (view === "editor") {
    return (
      <RoadmapEditor
        draft={draft}
        setDraft={updateDraft}
        collectionId={collectionId}
        weeklyStudyMinutes={profile?.weekly_study_minutes ?? null}
        onSave={saveDraft}
        onDiscard={discardDraft}
        saving={saving}
        userKey={getUserKey(user)}
      />
    );
  }

  // saved
  return (
    <RoadmapView
      snapshot={snapshot}
      collectionId={collectionId}
      onEdit={editSavedRoadmap}
      onChanged={() => {
        fetchRoadmap(collectionId, getUserKey(user)).then((result) => {
          if (!result.error && result.data) setSnapshot(result.data);
        });
      }}
      onDeleted={() => {
        clearPersistedDraft(userKey, collectionId);
        setSnapshot(null);
        setView("empty");
      }}
    />
  );
}
