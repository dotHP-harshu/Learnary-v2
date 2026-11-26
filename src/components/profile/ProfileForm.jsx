"use client";

import { useMemo, useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Select from "../ui/Select";
import SegmentedControl from "../ui/SegmentedControl";
import { Check } from "lucide-react";

// Shared learning-profile form: display name, goal, level, study days and
// daily minutes, all optional except the name. Used by onboarding and settings.

const LEVELS = [
  { value: "beginner", label: "Beginner — just starting out" },
  { value: "intermediate", label: "Intermediate — some experience" },
  { value: "advanced", label: "Advanced — strong experience" },
];

const TARGET_LEVELS = [
  { value: "", label: "Not decided" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "job_ready", label: "Job-ready" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120];

const EXPLANATION_STYLES = [
  { value: "", label: "No preference" },
  { value: "step_by_step", label: "Step by step" },
  { value: "concise", label: "Concise summaries" },
  { value: "detailed", label: "In-depth explanations" },
];

function ChipGroup({ label, options, selected, onToggle, hint }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(value)}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
              }`}
            >
              {active && <Check size={13} aria-hidden />}
              {value}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export default function ProfileForm({ profile, user, onSubmit, submitLabel = "Save", busy = false, children }) {
  const displayName = useMemo(() => {
    const meta = user?.user_metadata ?? {};
    return (
      profile?.display_name ??
      meta.display_name ??
      meta.full_name ??
      meta.name ??
      ""
    );
  }, [profile, user]);

  const [name, setName] = useState(displayName);
  const [goal, setGoal] = useState(profile?.primary_goal ?? "");
  const [level, setLevel] = useState(profile?.current_level ?? "");
  const [targetLevel, setTargetLevel] = useState(profile?.target_level ?? "");
  const [days, setDays] = useState(profile?.study_days ?? []);
  const [minutes, setMinutes] = useState(profile?.daily_study_minutes ?? "");
  const [style, setStyle] = useState(profile?.preferred_explanation_style ?? "");
  const [nameError, setNameError] = useState(null);

  const timezone =
    profile?.timezone ||
    (typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : null);

  const toggleDay = (day) =>
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError("A display name helps personalize your Today page.");
      return;
    }
    setNameError(null);
    onSubmit(
      {
        displayName: name.trim(),
        fields: {
          primary_goal: goal.trim() || null,
          current_level: level || null,
          target_level: targetLevel || null,
          study_days: days.length ? days : null,
          daily_study_minutes: minutes ? Number(minutes) : null,
          weekly_study_minutes: minutes ? Number(minutes) * (days.length || 7) : null,
          timezone: timezone || null,
          preferred_explanation_style: style || null,
        },
      },
      event
    );
  };

  return (
    <Card as="form" className="p-6" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-5">
        <Input
          label="Display name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          autoComplete="name"
        />

        <Input
          label="What do you want to learn? (optional)"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={300}
          placeholder="e.g. Build and deploy full-stack web apps"
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            id="profile-level"
            label="Current level (optional)"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">Not specified</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
          <Select
            id="profile-target"
            label="Target level (optional)"
            value={targetLevel}
            onChange={(e) => setTargetLevel(e.target.value)}
          >
            {TARGET_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>

        <ChipGroup
          label="Preferred study days (optional)"
          options={DAY_LABELS}
          selected={days.map((d) => DAY_LABELS[d])}
          onToggle={(label) => toggleDay(DAY_LABELS.indexOf(label))}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">
            Study time per day (optional)
          </span>
          <SegmentedControl
            ariaLabel="Study time per day"
            options={[
              { value: "", label: "Not set" },
              ...MINUTE_OPTIONS.map((value) => ({
                value: String(value),
                label: `${value} min`,
              })),
            ]}
            value={String(minutes ?? "")}
            onChange={(value) => setMinutes(value)}
          />
        </div>

        <Select
          id="profile-style"
          label="Preferred explanation style (optional)"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        >
          {EXPLANATION_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>

        {timezone && (
          <p className="text-xs text-fg-muted">Time zone: {timezone}</p>
        )}

        {children}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
