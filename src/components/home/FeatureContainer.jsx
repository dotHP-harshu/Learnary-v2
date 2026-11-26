"use client";

import React from "react";
import Feature from "./Feature";
import {
  Brain,
  CheckSquare,
  FileText,
  Lock,
  Smartphone,
  Palette,
  Search,
  Download,
  ChartLine,
} from "lucide-react";

const FEATURES = [
  {
    icon: <FileText size={20} className="text-accent" aria-hidden />,
    heading: "Organize by topic",
    description:
      "Group your learning into custom collections like “React”, “Python”, or “Digital Marketing”.",
  },
  {
    icon: <CheckSquare size={20} className="text-accent" aria-hidden />,
    heading: "Track your progress",
    description:
      "Add, complete, and manage learning tasks in a clean and focused interface.",
  },
  {
    icon: <Smartphone size={20} className="text-accent" aria-hidden />,
    heading: "Installable app",
    description:
      "Works offline and can be added to your device like a native app.",
  },
  {
    icon: <Palette size={20} className="text-accent" aria-hidden />,
    heading: "Dark mode friendly",
    description: "Beautiful light and dark themes for anytime learning.",
  },
  {
    icon: <Search size={20} className="text-accent" aria-hidden />,
    heading: "Search anything",
    description:
      "Instantly find any topic or task — no matter how big your list gets.",
  },
  {
    icon: <Lock size={20} className="text-accent" aria-hidden />,
    heading: "Secure & private",
    description:
      "Built on Supabase, your data is private and synced securely.",
  },
  {
    icon: <Download size={20} className="text-accent" aria-hidden />,
    heading: "Export your data",
    description:
      "Download your collections and tasks as JSON or CSV — portable and future-proof.",
  },
  {
    icon: <Brain size={20} className="text-accent" aria-hidden />,
    heading: "SkillMap as a plan",
    description:
      "Write a living roadmap: what to learn, in what order, and why — a skill map that grows with you.",
  },
  {
    icon: <ChartLine size={20} className="text-accent" aria-hidden />,
    heading: "Weekly activity",
    description:
      "See your progress — how many tasks you completed each day over the week.",
  },
];

function FeatureContainer() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 max-sm:px-4">
      <div className="mx-auto mb-12 max-w-lg text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-fg max-sm:text-2xl">
          Why Learnary?
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Everything you need to organize, track, and grow your learning — in
          one focused place.
        </p>
      </div>
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <Feature key={feature.heading} {...feature} />
        ))}
      </div>
    </section>
  );
}

export default FeatureContainer;
