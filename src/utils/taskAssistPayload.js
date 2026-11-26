import { taskScope } from "./aiScopes";

// The assistant envelope carries the action payload in `input`, not inside
// `context`. Task Assist previously nested it under `context.input`, which the
// server stripped before validating `input.task` — every action failed with
// "input.task: Required". Keeping the builder pure makes that regression
// testable without React.
export function buildTaskAssistPayload({
  actionKey,
  task,
  collectionId,
  collectionTitle,
}) {
  return {
    context: { collection_id: collectionId },
    input: {
      task: {
        title: task.title,
        description: task.description ?? null,
        priority: task.priority ?? "medium",
        difficulty: task.difficulty ?? null,
        estimated_minutes: task.estimated_minutes ?? null,
        status: task.completed ? "completed" : task.status ?? "pending",
        collection_title: collectionTitle ?? null,
      },
      ...(actionKey === "break_down_task" ? { count: 4 } : {}),
    },
    resumeScope: taskScope(task.id),
  };
}
