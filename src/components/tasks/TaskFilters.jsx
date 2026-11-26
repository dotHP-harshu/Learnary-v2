"use client";

import { ListFilter } from "lucide-react";
import SegmentedControl from "../ui/SegmentedControl";
import Select from "../ui/Select";

// Filter/sort bar for the tasks list: status as a segmented control, the rest
// as Select primitives. Roadmap-milestone filtering is deferred for now.

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
];

const PRIORITY_OPTIONS = ["all", "low", "medium", "high"];
const DIFFICULTY_OPTIONS = ["all", "beginner", "intermediate", "advanced"];
const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "estimate", label: "Estimate" },
  { value: "due", label: "Due date" },
];

export default function TaskFilters({ filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Filter and sort tasks"
    >
      <ListFilter size={16} className="text-fg-muted" aria-hidden />

      <SegmentedControl
        options={STATUS_OPTIONS}
        value={filters.status}
        onChange={(status) => set({ status })}
        ariaLabel="Status filter"
        size="sm"
      />

      {/* Plain wrapper keeps the Select primitive's w-full chrome inline in
          this flex-wrap bar instead of stretching to the full row. */}
      <div className="w-full min-w-32 sm:w-auto">
        <Select
          aria-label="Priority filter"
          value={filters.priority}
          onChange={(e) => set({ priority: e.target.value })}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p === "all" ? "Any priority" : `${p} priority`}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-full min-w-32 sm:w-auto">
        <Select
          aria-label="Difficulty filter"
          value={filters.difficulty}
          onChange={(e) => set({ difficulty: e.target.value })}
        >
          {DIFFICULTY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === "all" ? "Any difficulty" : d}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-full min-w-32 sm:w-auto">
        <Select
          aria-label="Sort tasks"
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value })}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              Sort: {label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
