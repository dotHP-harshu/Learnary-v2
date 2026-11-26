import { describe, expect, it } from "vitest";
import { buildTaskAssistPayload } from "../src/utils/taskAssistPayload.js";

// Task Assist regressed because the task lived under `context.input`; the
// server reads `input.task`. These tests pin the envelope shape.

const task = {
  id: "task-1",
  title: "Write the parser",
  description: "Tokenize then parse",
  priority: "high",
  difficulty: "intermediate",
  estimated_minutes: 45,
  status: "pending",
  completed: false,
};

describe("buildTaskAssistPayload", () => {
  it("puts the task under input, not context", () => {
    const payload = buildTaskAssistPayload({
      actionKey: "explain_task",
      task,
      collectionId: "col-1",
      collectionTitle: "Compilers",
    });

    expect(payload.input.task.title).toBe("Write the parser");
    expect(payload.context.input).toBeUndefined();
    expect(payload.context.collection_id).toBe("col-1");
  });

  it("sends count only for a breakdown", () => {
    const breakdown = buildTaskAssistPayload({
      actionKey: "break_down_task",
      task,
      collectionId: "col-1",
    });
    const hint = buildTaskAssistPayload({
      actionKey: "give_hint",
      task,
      collectionId: "col-1",
    });

    expect(breakdown.input.count).toBe(4);
    expect(hint.input.count).toBeUndefined();
  });

  it("maps a completed task to the completed status", () => {
    const payload = buildTaskAssistPayload({
      actionKey: "generate_practice",
      task: { ...task, completed: true },
      collectionId: "col-1",
    });
    expect(payload.input.task.status).toBe("completed");
  });

  it("scopes the request to the task", () => {
    const payload = buildTaskAssistPayload({
      actionKey: "give_hint",
      task,
      collectionId: "col-1",
    });
    expect(payload.resumeScope).toBe("task:task-1");
  });
});
