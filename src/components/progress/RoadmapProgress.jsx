"use client";

import EmptyState from "../ui/EmptyState";
import Card from "../ui/Card";
import { Map, Milestone } from "lucide-react";

// Roadmap progress: completed steps / eligible steps per active roadmap.
// Skipped steps are excluded from the eligible set and shown separately.
export default function RoadmapProgress({ roadmaps }) {
  if (!roadmaps?.length) {
    return (
      <section aria-label="Roadmap progress">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">Roadmap progress</h2>
        <EmptyState
          icon={Map}
          title="No active roadmaps"
          description="Generate a roadmap from a collection to see structured progress here."
        />
      </section>
    );
  }

  return (
    <section aria-label="Roadmap progress">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">Roadmap progress</h2>
      <ul className="flex flex-col gap-3">
        {roadmaps.map((r) => (
          <Card as="li" key={r.id} className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-fg">{r.title}</h3>
              <span className="text-sm font-semibold text-accent">
                {r.steps_completed} / {r.steps_eligible} steps ({r.percent}%)
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-border/60"
              role="progressbar"
              aria-valuenow={r.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${r.title}: ${r.steps_completed} of ${r.steps_eligible} steps completed`}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${r.percent}%` }}
              />
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-fg-muted">
              <Milestone size={11} aria-hidden />
              {r.milestones_completed} of {r.milestones_total} milestones completed
              {r.steps_skipped > 0 &&
                ` · ${r.steps_skipped} skipped step${r.steps_skipped > 1 ? "s" : ""} excluded from this total`}
            </p>
          </Card>
        ))}
      </ul>
      <p className="mt-2 text-2xs text-fg-muted">
        Skipped steps are excluded from the eligible set (explicit rule).
      </p>
    </section>
  );
}
