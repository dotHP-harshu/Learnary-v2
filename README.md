<h1 align="center" style="display:flex; align-items: center; justify-content: center;"><img src="public/pwa.png" alt="Learnary Logo" width="50"> Learnary</h1>

<p style="color:#c25e32;" align="center">Track your learning. One task at a time.</p>

**Learnary** is a progressive web app (PWA) to **organize**, **track**, and **practice** your learning journey. Group your goals into collections, build learning roadmaps (with optional assistance when you want it), plan your day, quiz yourself with spaced repetition, and watch your knowledge grow.

- **Stack:** Next.js 15 (App Router) · React 19 · Supabase (Auth + Postgres + RLS) · Tailwind CSS v4 · Serwist PWA · Zod · Groq (optional provider)
- **Highlights:** server-side assistant boundary, offline-first data caching, learner-timezone analytics, and a full practice suite.

---

## Features

### Core learning workflow

- **Collections** — group topics (React, Python, DSA…) into learning spaces
- **Tasks** — add, edit, check off, filter, and search tasks inside each collection
- **Roadmaps** — build a stage-by-step learning roadmap per collection, with **auto-generated drafts you review and accept** (drafts never auto-save)
- **Today** — a daily study planner: due tasks, daily plan (optional), and a focused session view
- **Practice** — auto-generated **quizzes** (server-scored, answer keys never sent to the client), **flashcards** with spaced repetition, and short-answer evaluation
- **Tutor chat** — a context-aware tutor conversation bound to a collection or task, with history that survives provider failures
- **Progress** — reconcilable metrics from source rows in your own timezone: heatmap, practice trends, roadmap progress, weekly review

### Platform

- **Offline support (PWA)** — installable; reads fall back to IndexedDB caches and the UI says so honestly (assistant features are online-only and labeled as such)
- **Dark & light themes** — class-based theming applied pre-paint (no flash of the wrong theme)
- **Data export** — download your tasks as JSON or CSV
- **Protected routes** — Supabase auth with RLS-protected data access on every table
- **Usage transparency** — per-response indicators of exactly what context the assistant used, plus a personal usage dashboard in Profile

---

## Tech Stack

| Framework                                | Backend/Auth                             | Styling                 | Tools                        |
| ---------------------------------------- | ---------------------------------------- | ----------------------- | ---------------------------- |
| Next.js 15 (App Router)                  | Supabase Auth + Postgres (RLS)           | Tailwind CSS v4         | Serwist (PWA)                |
| React 19                                 | Supabase client (single shared instance) | Dark-first theme tokens | ESLint                       |
| GSAP · ApexCharts (dynamically imported) | Groq API (server-only, optional)         | `next/font` (Inter)     | `idb-keyval` (offline cache) |

---

## Getting Started

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev                  # http://localhost:3000
```

**Environment variables** (see `.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_API` — your Supabase project URL and **publishable** key (safe for the browser)
- `NEXT_PUBLIC_SITE_URL` — canonical origin (used by `robots.js`, `sitemap.js`, and Open Graph metadata)
- `GROQ_API_KEY`, `GROQ_MODEL`, `LEARNARY_AI_ENABLED`, … — **server-only** assistant config (no `NEXT_PUBLIC_` prefix; the assistant stays dark until you explicitly enable it)
- `SUPABASE_SERVICE_ROLE_KEY` (or the newer `SUPABASE_SECRET_KEY` with an `sb_secret_...` key) — **server-only**, required for assistant quota accounting since migration `0009`; without it assistant requests fail closed

**Database:** run the single file `supabase/setup.sql` once on a fresh Supabase project (creates every table, RLS policy, RPC, trigger, and index, with the final security posture). It is re-runnable and safe to apply again. Use `supabase/diagnostics.sql` for read-only health checks.

> **Upgrading an existing deployment:** apply `setup.sql` and deploy the matching app build **together**. The script revokes browser write access to `quizzes` and `quiz_attempts` (answer keys and scores are now server-owned), so a new database with an old client — or the reverse — breaks quiz generation and submission. The script is idempotent, so re-running it after the deploy is harmless. Run `diagnostics.sql` afterwards: every value in section 5 must be `false`.

**Scripts:**

```bash
npm run dev        # Next dev server
npm run build      # production build
npm run start      # serve the production build
npm run lint       # eslint
npm run test       # unit tests (vitest, single run)
npm run test:watch # unit tests in watch mode
npm run ai:doctor  # preflight the assistant's env, quota RPC and provider
```

Unit tests live in `tests/` and cover the pure logic only — quiz/flashcard
parsing and scoring, spaced-repetition scheduling, timezone day bucketing,
analytics aggregation, and per-user cache key isolation. No network or
Supabase connection is required.

---

## How Learnary Works

1. **Sign up / Sign in** — Supabase auth protects every route; data access is enforced by Row Level Security.
2. **Create collections** — group topics into learning spaces.
3. **Add tasks or generate a roadmap** — write tasks by hand, or let the assistant draft a roadmap you review, edit, and accept.
4. **Plan your day** — Today shows what's due, your daily plan, and an active session.
5. **Practice** — generate quizzes and flashcards; short answers are model-evaluated against a rubric, MCQs are scored deterministically on the server.
6. **Track progress** — activity heatmap, practice trends, and roadmap progress, all computed from source records in your timezone.
7. **Go offline or install** — the PWA keeps your data readable without internet and syncs your view when you're back.

---

## Contact

- **Portfolio:** [Portfolio](https://dothp.vercel.app)
- **LinkedIn:** [dothp](https://linkedin.com/in/dothp)
- **GitHub:** [@dothp-harshu](https://github.com/dothp-harshu)

---

> Built with ❤️ by [DotHP](https://github.com/dothp-harshu)
