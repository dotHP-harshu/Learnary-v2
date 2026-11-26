"use client";

import React, { useEffect, useMemo, useState } from "react";
import TaskItem from "./TaskItem";
import { Plus, Route, Map } from "lucide-react";
import { useRouter } from "next/navigation";
import TaskPopup from "./TaskPopup";
import supabase from "../../supabase/supabase";
import Skeleton from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import Menu from "../ui/Menu";
import Search from "../ui/Search";
import TaskFilters from "./TaskFilters";
import { useToast } from "../ui/Toast";
import { get } from "idb-keyval";
import SkillMap from "./SkillMap";
import ExportData from "./ExportData";
import { getUserKey } from "../../utils/getUserKey";

const DEFAULT_FILTERS = {
  status: "all",
  priority: "all",
  difficulty: "all",
  sort: "newest",
};

function TaskContainer({ collection_id, collection_title, user }) {
  const [isShowingPopup, setIsShowingPopup] = useState(false);
  const [editingTask, setEditingTask] = useState(null); // null = closed; object = edit that task
  const [tasks, setTasks] = useState(null);
  const [isShowingSkillMap, setIsShowingSkillMap] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const router = useRouter();
  const toast = useToast();

  const getTasks = async (userKey) => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .match({
        collection_id,
        user_id: userKey,
      })
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load tasks. Please try again.", {
        action: { label: "Retry", onClick: () => getTasks(userKey) },
      });
    } else {
      setTasks(data);
    }
  };

  // Local patch for optimistic updates (task completion flips instantly in
  // the UI; TaskItem rolls it back if the database write fails).
  const patchTask = (taskId, patch) => {
    setTasks(
      (prev) =>
        prev?.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) ?? prev
    );
  };

  useEffect(() => {
    const getOfflineData = async () => {
      const localTasks = await get("tasks");
      if (!localTasks) {
        setTasks([]);
        return;
      }
      const filtered = localTasks.filter(
        (t) => t.collection_id === collection_id
      );
      setTasks(filtered);
    };

    if (navigator.onLine) {
      getTasks(getUserKey(user));
    } else {
      getOfflineData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection_id]);

  // Search + filters compose in one place; the raw `tasks` state stays
  // untouched so CRUD refreshes never lose filter state.
  const visibleTasks = useMemo(() => {
    if (!tasks) return null;
    const q = query.trim().toLowerCase();
    let list = tasks.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (filters.status === "pending" && t.completed) return false;
      if (filters.status === "completed" && !t.completed) return false;
      if (filters.priority !== "all" && (t.priority ?? "medium") !== filters.priority) return false;
      if (filters.difficulty !== "all" && t.difficulty !== filters.difficulty) return false;
      return true;
    });
    const byDue = (t) => (t.due_at ? new Date(t.due_at).getTime() : Infinity);
    list = [...list].sort((a, b) => {
      switch (filters.sort) {
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "estimate":
          return (a.estimated_minutes ?? 1e9) - (b.estimated_minutes ?? 1e9);
        case "due":
          return byDue(a) - byDue(b);
        default:
          return b.created_at.localeCompare(a.created_at); // newest
      }
    });
    return list;
  }, [tasks, query, filters]);

  if (!tasks) {
    return (
      <div className="mt-8 flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <>
      <SkillMap
        open={isShowingSkillMap}
        onClose={() => setIsShowingSkillMap(false)}
        collection_id={collection_id}
        user={user}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ExportData tasks={tasks} collection_title={collection_title} />
          {/* Skill map + Roadmap consolidated under one "Plan" menu: the
              roadmap is the authoritative plan; the free-text skill map
              remains available as a reference. */}
          <Menu
            label="Plan"
            align="left"
            items={[
              {
                label: "Learning plan",
                icon: Map,
                onSelect: () => router.push(`/roadmap/${collection_id}`),
              },
              {
                label: "Skill map",
                icon: Route,
                onSelect: () => setIsShowingSkillMap(true),
              },
            ]}
            trigger={({ toggle, menuProps }) => (
              <Button
                variant="secondary"
                size="sm"
                onClick={toggle}
                {...menuProps}
              >
                <Route size={16} aria-hidden />
                Plan
              </Button>
            )}
          />
        </div>
        <div className="flex items-center gap-3">
          <Search value={query} onValueChange={setQuery} label="Search tasks" />
          <Button size="sm" onClick={() => setIsShowingPopup(true)}>
            <Plus size={16} aria-hidden />
            New task
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <TaskFilters filters={filters} onChange={setFilters} />
      </div>

      <div className="mt-6 flex max-w-2xl flex-col gap-3">
        {tasks.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No tasks yet"
            description="Add your first task to start tracking progress in this collection."
            action={
              <Button size="sm" variant="secondary" onClick={() => setIsShowingPopup(true)}>
                <Plus size={14} aria-hidden />
                New task
              </Button>
            }
          />
        ) : visibleTasks.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No matching tasks"
            description="Nothing matches the current search or filters. Adjust them or add a new task."
          />
        ) : (
          visibleTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              getTasks={getTasks}
              onPatch={patchTask}
              user={user}
              collection_id={collection_id}
              collection_title={collection_title}
              onEdit={() => setEditingTask(task)}
            />
          ))
        )}
      </div>

      {isShowingPopup && (
        <TaskPopup
          open={isShowingPopup}
          onClose={() => setIsShowingPopup(false)}
          collection_id={collection_id}
          getTasks={getTasks}
          user_id={getUserKey(user)}
        />
      )}

      {editingTask && (
        <TaskPopup
          key={editingTask.id} // remount per task: fresh prefilled state
          open
          onClose={() => setEditingTask(null)}
          collection_id={collection_id}
          getTasks={getTasks}
          user_id={getUserKey(user)}
          task={editingTask}
        />
      )}
    </>
  );
}

export default TaskContainer;
