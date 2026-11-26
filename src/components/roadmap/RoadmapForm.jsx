"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Select from "../ui/Select";
import { Sparkles } from "lucide-react";

// Roadmap generation form: goal, levels, deadline, known topics, constraints.
// Availability comes from the saved learning profile — not re-asked here.

export default function RoadmapForm({
  collectionTitle,
  profile,
  online,
  aiAvailable,
  generating,
  onSubmit,
  onCancel,
}) {
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState(profile?.current_level ?? "");
  const [targetLevel, setTargetLevel] = useState(profile?.target_level ?? "");
  const [deadline, setDeadline] = useState("");
  const [knownTopics, setKnownTopics] = useState("");
  const [constraints, setConstraints] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [goalError, setGoalError] = useState(null);

  const availabilityHint = profile?.weekly_study_minutes
    ? `Using your saved availability: about ${profile.weekly_study_minutes} min/week. Change it in My Profile → Learning profile.`
    : "No availability saved — add it in My Profile → Learning profile so estimates can fit your schedule.";

  const submit = (event) => {
    event.preventDefault();
    if (goal.trim().length < 4) {
      setGoalError("Describe your goal in a few words.");
      return;
    }
    setGoalError(null);
    onSubmit({
      goal: goal.trim(),
      current_level: level || null,
      target_level: targetLevel || null,
      deadline: deadline || null,
      known_topics: knownTopics.trim() || null,
      constraints: constraints.trim() || null,
      source_text: sourceText.trim() || null,
      // Saved profile supplies availability.
      weekly_study_minutes: profile?.weekly_study_minutes ?? null,
      study_days: profile?.study_days ?? null,
      collection_title: collectionTitle ?? null,
    });
  };

  const blocked = !online || !aiAvailable;

  return (
    <Card as="form" className="p-6" onSubmit={submit}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
            <Sparkles size={18} className="text-accent" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-fg">
              Build a roadmap automatically
            </h2>
            <p className="text-xs text-fg-muted">
              Turn your goal into an ordered plan of stages and steps.
            </p>
          </div>
        </div>

        {blocked && (
          <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-fg">
            {!online
              ? "You're offline — generation needs an internet connection. You can still create a roadmap manually."
              : "Generation is currently unavailable. You can still create a roadmap manually."}
          </p>
        )}

        <Input
          label="Learning goal"
          required
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          error={goalError}
          maxLength={300}
          placeholder={
            collectionTitle
              ? `e.g. Get solid at ${collectionTitle}`
              : "e.g. Learn data analysis with Python"
          }
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            id="roadmap-level"
            label="Current level (optional)"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">Not specified</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
          <Select
            id="roadmap-target"
            label="Target level (optional)"
            value={targetLevel}
            onChange={(e) => setTargetLevel(e.target.value)}
          >
            <option value="">Not specified</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="job_ready">Job-ready</option>
          </Select>
        </div>

        <Input
          label="Target date (optional)"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />

        <Textarea
          label="Paste an existing roadmap (optional)"
          rows={8}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          maxLength={20000}
          placeholder="Paste a roadmap in plain text — stages, steps, or notes. The assistant will structure it into an editable plan you can review before saving."
          hint={`If provided, the assistant converts this text instead of inventing a new plan. Up to 20,000 characters.${sourceText ? ` ${sourceText.length.toLocaleString()}/20,000` : ""}`}
        />

        <Textarea
          label="Topics you already know (optional)"
          rows={2}
          value={knownTopics}
          onChange={(e) => setKnownTopics(e.target.value)}
          maxLength={600}
          placeholder="These may be skipped or compressed"
        />

        <Textarea
          label="Constraints or notes (optional)"
          rows={2}
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          maxLength={600}
          placeholder="e.g. only free resources, evenings only"
        />

        <p className="text-xs leading-relaxed text-fg-muted">{availabilityHint}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={generating} disabled={blocked || generating}>
            {generating ? "Generating draft…" : "Generate draft"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={generating}>
            Back
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          Generation uses one request from your daily allowance. You'll
          review and edit everything before anything is saved.
        </p>
      </div>
    </Card>
  );
}
