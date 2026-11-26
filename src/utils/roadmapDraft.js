// Client-side roadmap draft helpers. Drafts (untrusted model output or manual input)
// live in React state + sessionStorage until saved; prerequisites use 1-based global step numbers.

const DRAFT_KEY = (userKey, collectionId) =>
  `roadmapDraft:${userKey ?? "anon"}:${collectionId}`;

let uidCounter = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${++uidCounter}`;

/** Reassign stable client ids and 1-based global step numbers, immutably. */
export function renumberDraft(draft) {
  let stepNumber = 0;
  return {
    ...draft,
    stages: draft.stages.map((stage) => ({
      ...stage,
      id: stage.id ?? uid("stage"),
      milestones: stage.milestones.map((milestone) => ({
        ...milestone,
        id: milestone.id ?? uid("ms"),
        steps: milestone.steps.map((step) => ({
          ...step,
          id: step.id ?? uid("step"),
          step_number: ++stepNumber,
        })),
      })),
    })),
  };
}

/**
 * Remove invalid/self/cyclic prerequisite references. Returns
 * `{ draft, removed }` where `removed` says whether anything was cleaned.
 */
export function validateDraftPrerequisites(draft) {
  // Collect global step numbers in draft order.
  const numbers = [];
  draft.stages.forEach((stage) =>
    stage.milestones.forEach((milestone) =>
      milestone.steps.forEach((step) => numbers.push(step.step_number))
    )
  );
  const valid = new Set(numbers);

  // First pass: drop refs that don't exist or point at the step itself.
  let removed = false;
  const cleaned = {
    ...draft,
    stages: draft.stages.map((stage) => ({
      ...stage,
      milestones: stage.milestones.map((milestone) => ({
        ...milestone,
        steps: milestone.steps.map((step) => {
          const refs = (step.prerequisite_steps ?? []).filter(
            (n) => valid.has(n) && n !== step.step_number
          );
          if (refs.length !== (step.prerequisite_steps ?? []).length) removed = true;
          return { ...step, prerequisite_steps: refs };
        }),
      })),
    })),
  };

  // Second pass: cycle detection (DFS); on any cycle, drop the refs that
  // close it — simpler and safe: drop ALL refs on that step.
  const byNumber = new Map();
  cleaned.stages.forEach((stage) =>
    stage.milestones.forEach((milestone) =>
      milestone.steps.forEach((step) => byNumber.set(step.step_number, step))
    )
  );
  const state = new Map();
  let cyclic = false;
  const visit = (n) => {
    const mark = state.get(n);
    if (mark === "ok") return true;
    if (mark === "visiting") {
      cyclic = true;
      return false;
    }
    state.set(n, "visiting");
    for (const p of byNumber.get(n).prerequisite_steps ?? []) {
      if (!visit(p)) {
        cyclic = true;
        return false;
      }
    }
    state.set(n, "ok");
    return true;
  };
  for (const n of byNumber.keys()) visit(n);

  if (cyclic) {
    removed = true;
    for (const step of byNumber.values()) {
      step.prerequisite_steps = [];
    }
  }

  return { draft: cleaned, removed };
}

/**
 * Convert a saved snapshot (fetchRoadmap's shape) into an editable draft.
 * Every step keeps its DB identity (`existing_step_id`) and progress
 * (`status`) so the replace RPC can carry task links and status forward.
 * Prerequisite pairs reference old step ids; they're translated into draft
 * global step numbers here.
 * @param {object} snapshot {roadmap, prerequisites}
 */
export function createDraftFromSnapshot(snapshot) {
  const roadmap = snapshot.roadmap;
  // Old step id → new draft global number, in display order.
  const numberByOldId = new Map();
  let counter = 0;
  const stages = (roadmap.roadmap_stages ?? []).map((stage) => ({
    id: `old-${stage.id}`,
    title: stage.title,
    description: stage.description ?? "",
    milestones: (stage.roadmap_milestones ?? []).map((milestone) => ({
      id: `old-${milestone.id}`,
      title: milestone.title,
      description: milestone.description ?? "",
      steps: (milestone.roadmap_steps ?? []).map((step) => {
        counter += 1;
        numberByOldId.set(step.id, counter);
        return {
          existing_step_id: step.id,
          status: step.status ?? "not_started",
          title: step.title,
          description: step.description ?? "",
          learning_objective: step.learning_objective ?? "",
          estimated_minutes: step.estimated_minutes ?? null,
          difficulty: step.difficulty ?? "beginner",
          task_type: step.task_type ?? "study",
          prerequisite_steps: [],
        };
      }),
    })),
  }));

  // Translate prerequisite pairs (old step ids) into draft step numbers.
  for (const p of snapshot.prerequisites ?? []) {
    const from = numberByOldId.get(p.prerequisite_step_id);
    const to = numberByOldId.get(p.step_id);
    if (!from || !to) continue;
    stages.forEach((stage) =>
      stage.milestones.forEach((milestone) =>
        milestone.steps.forEach((step) => {
          if (step.existing_step_id === p.step_id) {
            step.prerequisite_steps.push(from);
          }
        })
      )
    );
  }

  return renumberDraft({
    title: roadmap.title,
    goal: roadmap.goal,
    rationale: roadmap.rationale ?? null,
    assumptions: roadmap.assumptions ?? [],
    estimated_total_minutes: roadmap.estimated_total_minutes ?? null,
    current_level: roadmap.current_level ?? null,
    target_level: roadmap.target_level ?? null,
    stages,
  });
}

/** Blank manual draft: one stage, one milestone, one step. */
export function createManualDraft() {
  return renumberDraft({
    title: "",
    goal: "",
    rationale: null,
    assumptions: [],
    estimated_total_minutes: null,
    current_level: null,
    target_level: null,
    stages: [
      {
        title: "",
        description: "",
        milestones: [
          {
            title: "",
            description: "",
            steps: [
              {
                title: "",
                description: "",
                learning_objective: "",
                estimated_minutes: 30,
                difficulty: "beginner",
                task_type: "study",
                prerequisite_steps: [],
              },
            ],
          },
        ],
      },
    ],
  });
}

/** Last-rounding sanity check before save; returns an error string or null. */
export function validateDraftForSave(draft) {
  if (!draft.title?.trim()) return "Give the roadmap a title.";
  if (!draft.goal?.trim()) return "State the learning goal.";
  if (!draft.stages.length) return "Add at least one stage.";
  for (const stage of draft.stages) {
    if (!stage.title.trim()) return "Every stage needs a title.";
    if (!stage.milestones.length) {
      return `Stage "${stage.title}" needs at least one milestone.`;
    }
    for (const milestone of stage.milestones) {
      if (!milestone.title.trim()) return "Every milestone needs a title.";
      if (!milestone.steps.length) {
        return `Milestone "${milestone.title}" needs at least one step.`;
      }
      for (const step of milestone.steps) {
        if (!step.title.trim()) return "Every step needs a title.";
      }
    }
  }
  return null;
}

// ---- sessionStorage persistence (survives a reload mid-review) ------------
// Keys are namespaced by the signed-in user: a shared browser must never
// resume one account's generated draft inside another account's session.

export function persistDraft(userKey, collectionId, draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY(userKey, collectionId), JSON.stringify(draft));
  } catch {
    /* storage unavailable — the draft stays in memory only */
  }
}

export function loadPersistedDraft(userKey, collectionId) {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(userKey, collectionId));
    if (!raw) return null;
    return renumberDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearPersistedDraft(userKey, collectionId) {
  try {
    sessionStorage.removeItem(DRAFT_KEY(userKey, collectionId));
  } catch {
    /* noop */
  }
}

/** Sum of every step's estimate, for the editor footer. */
export function draftTotalMinutes(draft) {
  let total = 0;
  draft.stages.forEach((stage) =>
    stage.milestones.forEach((milestone) =>
      milestone.steps.forEach((step) => {
        total += step.estimated_minutes ?? 0;
      })
    )
  );
  return total;
}
