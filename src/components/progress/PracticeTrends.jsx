"use client";

import Link from "next/link";
import { Award, Brain, ClipboardCheck, Layers } from "lucide-react";
import Card from "../ui/Card";

// Practice trends: reconcilable counts from source records. Scores are
// per-attempt indicators only — no mastery language anywhere.
const CARDS = [
  { key: "quiz_attempts", label: "Quiz attempts", Icon: ClipboardCheck, hint: (m) => (m.avg_quiz_score != null ? `avg ${m.avg_quiz_score}% per attempt` : "no scored attempts yet") },
  { key: "cards_reviewed", label: "Cards reviewed", Icon: Brain, hint: (m) => `${m.due_cards} due now` },
  { key: "active_days", label: "Active days", Icon: Award, hint: (m) => `last ${m.window_days} days` },
  { key: "tasks_completed", label: "Tasks completed", Icon: Layers, hint: (m) => `last ${m.window_days} days` },
];

export default function PracticeTrends({ metrics }) {
  return (
    <section aria-label="Practice trends">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">Practice</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CARDS.map(({ key, label, Icon, hint }) => (
          <Card key={key} className="p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
              <Icon size={16} className="text-accent" aria-hidden />
            </span>
            <p className="mt-2 text-xl font-semibold text-fg">
              {metrics[key] ?? 0}
            </p>
            <p className="text-xs text-fg-muted">{label}</p>
            <p className="text-2xs text-fg-muted">{hint(metrics)}</p>
          </Card>
        ))}
      </div>
      <p className="mt-2 text-2xs text-fg-muted">
        Counts come straight from your records. Quiz scores describe single
        attempts — they are not a measure of mastery. Review due cards from{" "}
        <Link href="/practice?review=1" className="text-accent underline">
          Practice
        </Link>
        .
      </p>
    </section>
  );
}
