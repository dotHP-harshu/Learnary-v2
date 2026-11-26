"use client";

import React, { useEffect, useState } from "react";
import supabase from "../../supabase/supabase";
import { set, get } from "idb-keyval";
import { getUserKey } from "../../utils/getUserKey";
import { userCacheKey } from "../../utils/idbCacheOwner";
import Skeleton from "../ui/Skeleton";
import Card from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import { CircleAlert, FolderOpen, ListChecks, CalendarCheck } from "lucide-react";

const STAT_CARDS = [
  {
    key: "totalCollections",
    label: "Collections",
    Icon: FolderOpen,
  },
  {
    key: "totalTasks",
    label: "Tasks completed",
    Icon: ListChecks,
  },
  {
    key: "totalActiveDays",
    label: "Active days",
    Icon: CalendarCheck,
  },
];

function ActiveStats({ user, timezone = null }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const userKey = getUserKey(user);
  // The cached snapshot holds this account's figures; namespace it so a
  // shared device never shows one learner's totals to another.
  const cacheKey = userCacheKey(userKey, "activeStats");

  const getTotalCollections = async (user) => {
    const { data, error } = await supabase.rpc("get_total_collections", {
      user_uuid: getUserKey(user),
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const getTotalTasks = async (user) => {
    const { data, error } = await supabase.rpc("get_total_tasks", {
      user_uuid: getUserKey(user),
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const getTotalActiveDays = async () => {
    // Day boundaries follow the learner's saved zone, exactly like the
    // heatmap and the 7-day chart; the server derives identity from the JWT.
    const { data, error } = await supabase.rpc("get_active_days", {
      p_timezone: timezone || null,
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const getStats = async () => {
    setError(null);
    try {
      const [collections, tasks, activeDays] = await Promise.all([
        getTotalCollections(user),
        getTotalTasks(user),
        getTotalActiveDays(),
      ]);

      const newStats = {
        totalCollections: collections,
        totalTasks: tasks,
        totalActiveDays: activeDays,
      };

      setStats(newStats);
      setOffline(false);
      if (cacheKey) await set(cacheKey, newStats);
    } catch (e) {
      // A failed read must never render as a genuine zero.
      setError(e.message || "Couldn't load your stats.");
    }
  };

  useEffect(() => {
    if (navigator.onLine) {
      getStats();
    } else {
      setOffline(true);
      const loadLocalStats = async () => {
        const savedStats = cacheKey ? await get(cacheKey) : null;
        if (savedStats) {
          setStats(savedStats);
        } else {
          setError("No cached stats on this device yet.");
        }
      };
      loadLocalStats();
    }
    // timezone resolves after the profile loads; refetch so the day buckets
    // match the heatmap once it is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, timezone]);

  return (
    <section aria-label="Active stats">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-fg-muted">
        Active stats
      </h2>
      {error ? (
        <Card className="p-5">
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load your stats"
            description={`${error} Your records are untouched — retry to load them.`}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setStats(null);
                  if (navigator.onLine) getStats();
                  else {
                    setOffline(true);
                    if (cacheKey) {
                      get(cacheKey).then((saved) => {
                        if (saved) setStats(saved);
                      });
                    }
                  }
                }}
              >
                Retry
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {offline && stats !== null && (
            <p className="mb-3 text-xs text-warning">
              Cached stats (offline) — reload once you're back online.
            </p>
          )}
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            {stats === null
              ? STAT_CARDS.map(({ key }) => (
                  <Card key={key} className="flex items-center gap-4 p-5">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-6 w-12" />
                    </div>
                  </Card>
                ))
              : STAT_CARDS.map(({ key, label, Icon }) => (
                  <Card key={key} className="flex items-center gap-4 p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
                      <Icon size={20} className="text-accent" aria-hidden />
                    </span>
                    <div className="flex flex-col">
                      <p className="text-xs font-medium text-fg-muted">{label}</p>
                      {/* tabular-nums keeps the figures from jittering */}
                      <p className="text-2xl font-semibold tabular-nums text-fg">
                        {stats[key] ?? 0}
                      </p>
                    </div>
                  </Card>
                ))}
          </div>
        </>
      )}
    </section>
  );
}

export default ActiveStats;
