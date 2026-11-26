"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import UserContext from "../../context/userContext";
import { useToast } from "../ui/Toast";
import Skeleton from "../ui/Skeleton";
import ErrorState from "../ui/ErrorState";
import Card from "../ui/Card";
import PageHeader from "../ui/PageHeader";
import ActivityHeatmap from "./ActivityHeatmap";
import RoadmapProgress from "./RoadmapProgress";
import PracticeTrends from "./PracticeTrends";
import WeeklyReview from "./WeeklyReview";
import { loadMetrics } from "../../services/analytics";
import { fetchLearningProfile } from "../../services/profile";
import ActiveStats from "./ActiveStats";
import { HeartHandshake } from "lucide-react";

// ApexCharts touches `window` at import time, so load it client-only.
const Chart = dynamic(() => import("./Chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-80 w-full" />,
});

// Progress page: reconcilable metrics from source records (learner timezone),
// heatmap, roadmap progress, practice trends, weekly review — no mastery claims.
function ProgressPage() {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const [metrics, setMetrics] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const [timezone, setTimezone] = useState(null);

  const userKey = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userKey) return;
    setError(null);
    const { data: profile } = await fetchLearningProfile(userKey);
    const tz = profile?.timezone ?? null;
    setTimezone(tz);
    const result = await loadMetrics(userKey, tz);
    if (result.error) {
      setError(`Couldn't load your progress. ${result.error}`);
      return;
    }
    setMetrics(result.data);
    setOffline(result.offline);
    if (result.offline) {
      toast.info("You're offline — showing your last cached metrics.");
    }
  }, [userKey, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const inactiveDays = metrics?.inactive_days ?? null;

  return (
    <div>
      <PageHeader
        title="Progress"
        description="Evidence of your learning activity — reconciled from your own records."
      />

      {offline && (
        <p className="mb-3 mt-5 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          Cached metrics (offline). Reload once you're back online for fresh
          numbers.
        </p>
      )}

      {inactiveDays != null && inactiveDays >= 7 && (
        <Card className="mb-4 mt-5 flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft">
            <HeartHandshake size={17} className="text-accent" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-fg">
              Welcome back — it's been {inactiveDays} days
            </p>
            <p className="text-sm text-fg-muted">
              No pressure: pick one small task or a 10-minute review session and
              you're rolling again.
            </p>
          </div>
        </Card>
      )}

      {/* Totals snapshot + 7-day chart. They own their loading/error/offline
          states internally, so they render outside the metrics conditional
          below. Both receive the learner's saved time zone: the chart's day
          buckets and the heatmap's grid keys use it — one timezone
          interpretation. */}
      <div className="mt-6 flex flex-col gap-6">
        <ActiveStats user={user} timezone={timezone} />
        <Chart user={user} timezone={timezone} />
      </div>

      {metrics === null && !error ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState
          title="Something went wrong"
          message={error}
          retryLabel="Retry"
          onRetry={load}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <PracticeTrends metrics={metrics} />
          <ActivityHeatmap heatmap={metrics.heatmap ?? []} timezone={timezone} />
          <RoadmapProgress roadmaps={metrics.roadmap_progress ?? []} />
          <WeeklyReview metrics={metrics} timezone={timezone} />
        </div>
      )}
    </div>
  );
}

export default ProgressPage;
