"use client";

import React, { useState } from "react";
import supabase from "../../supabase/supabase";
import { useToast } from "../ui/Toast";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Textarea from "../ui/Textarea";

// Create/edit-task dialog on the shared Modal primitive with optional metadata
// fields. Pass a `task` prop to edit; updates are RLS-scoped, writes online-only.

/** ISO timestamp → value for <input type="datetime-local"> (local time). */
const toLocalInputValue = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

function TaskPopup({ open, onClose, collection_id, getTasks, user_id, task = null }) {
  const editing = task !== null;
  const [isSaving, setIsSaving] = useState(false);
  const [taskName, setTaskName] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "medium");
  const [difficulty, setDifficulty] = useState(task?.difficulty ?? "");
  const [minutes, setMinutes] = useState(
    task?.estimated_minutes != null ? String(task.estimated_minutes) : ""
  );
  const [dueAt, setDueAt] = useState(
    task?.due_at ? toLocalInputValue(task.due_at) : ""
  );
  const toast = useToast();

  const reset = () => {
    setTaskName("");
    setDescription("");
    setPriority("medium");
    setDifficulty("");
    setMinutes("");
    setDueAt("");
  };

  const saveTask = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    const fields = {
      title: taskName.trim(),
      description: description.trim() || null,
      priority,
      difficulty: difficulty || null,
      estimated_minutes: minutes ? Number(minutes) : null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
    };

    let error = null;
    if (editing) {
      // The returned rows make the update checked: Supabase reports success
      // even when zero rows match, so an RLS-invisible or already-deleted
      // task is caught here instead of faking success.
      const { data, error: updateError } = await supabase
        .from("tasks")
        .update(fields)
        .eq("id", task.id)
        .select("id");
      if (updateError) error = updateError;
      else if (!data || data.length === 0) error = { message: "TASK_NOT_FOUND" };
    } else {
      ({ error } = await supabase
        .from("tasks")
        .insert({ ...fields, collection_id, user_id }));
    }

    setIsSaving(false);
    if (error) {
      toast.error(
        error.message === "TASK_NOT_FOUND"
          ? "This task no longer exists — it may have been deleted. Refreshing."
          : editing
            ? "Couldn't save the changes. Your edit is still open — please try again."
            : "Couldn't add the task. Please try again."
      );
      if (error.message === "TASK_NOT_FOUND") getTasks(user_id);
      return;
    }

    getTasks(user_id);
    onClose();
    if (!editing) reset();
    toast.success(
      editing ? `Task "${fields.title}" updated` : `Task "${fields.title}" added`
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      title={editing ? "Edit task" : "New task"}
    >
      <form onSubmit={saveTask} className="flex flex-col gap-4">
        <Input
          id="task-name"
          label="Task name"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          required
          type="text"
          placeholder="What do you want to learn?"
          data-autofocus={editing ? undefined : true}
        />
        <Textarea
          id="task-description"
          label="Details (optional)"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={600}
          placeholder="What exactly will you do?"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            id="task-priority"
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
          <Select
            id="task-difficulty"
            label="Difficulty (optional)"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="">Not set</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            id="task-minutes"
            label="Estimate (min, optional)"
            type="number"
            min={5}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <Input
            id="task-due"
            label="Due (optional)"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" loading={isSaving}>
            {editing ? "Save changes" : "Add task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default TaskPopup;
