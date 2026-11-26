"use client";

import { useContext, useEffect, useState } from "react";
import ReactApexChart from "react-apexcharts";
import supabase from "../../supabase/supabase";
import { themeContext } from "../../context/ThemeContext";
import { get, set } from "idb-keyval";
import { getUserKey } from "../../utils/getUserKey";
import { learnerToday, learnerDayKey, lastNDays } from "../../utils/learnerDate";
import Skeleton from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import { CircleAlert } from "lucide-react";

// Chart colors are read from the design-token CSS variables at render time
// (single source of truth: globals.css), with static fallbacks so the first
// client render and SSR path never paint with undefined colors.
const FALLBACK_COLORS = {
  accent: "#c25e32",
  muted: "#6f6a66",
  grid: "#e7e5e4",
  markerStroke: "#ffffff",
};

function readToken(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function themeColors() {
  return {
    accent: readToken("--accent", FALLBACK_COLORS.accent),
    muted: readToken("--fg-muted", FALLBACK_COLORS.muted),
    grid: readToken("--border", FALLBACK_COLORS.grid),
    markerStroke: readToken("--surface", FALLBACK_COLORS.markerStroke),
  };
}

/**
 * Whether an RPC error means "the learner-timezone function isn't available"
 * so we can fall back to the UTC-bucketed RPC instead of failing the whole
 * chart.
 */
function isMissingFunctionError(error) {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /does not exist|could not find the function|schema cache/i.test(message)
  );
}

const Chart = ({ user, timezone }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chartHeight, setChartHeight] = useState(300);
  const { theme } = useContext(themeContext);
  const isDark = theme !== "light";

  // Day keys are computed from a DATE STRING with the pure helpers — never
  // from device-local Date arithmetic, which (west of UTC in the evening)
  // shifted `toISOString` keys a day off the RPC's bucket keys and pushed
  // today's real count off the chart.
  const getData = async (user) => {
    // Preferred path: learner-timezone RPC — buckets and window both use the
    // learner's local calendar day.
    const todayKey = learnerToday(timezone);
    const dates = lastNDays(todayKey, 7);

    let rpcData = null;
    let rpcError = await supabase
      .rpc("count_tasks_completed_last_7_days", {
        p_timezone: timezone || null,
      })
      .then((res) => {
        if (res.error) return res.error;
        rpcData = res.data;
        return null;
      });

    // Fallback for databases without the timezone RPC: that RPC buckets by
    // UTC date, so the buckets must be UTC dates too (learnerDayKey with
    // "UTC" — still no device-local parsing).
    if (rpcError && isMissingFunctionError(rpcError)) {
      rpcError = null;
      const utcToday = learnerDayKey(new Date(), "UTC");
      const utcDates = lastNDays(utcToday, 7);
      const res = await supabase.rpc("count_tasks_last_7_days", {
        user_id_input: getUserKey(user),
      });
      if (res.error) {
        rpcError = res.error;
      } else {
        rpcData = res.data;
        dates.length = 0;
        dates.push(...utcDates);
      }
    }

    if (rpcError) {
      setError(rpcError.message || "Could not load chart data.");
      return;
    }
    if (!rpcData) {
      setError("Could not load chart data.");
      return;
    }

    let formatData = {};
    rpcData.forEach((d) => {
      formatData[d.task_date] = d.task_count;
    });

    let counts = dates.map((d) => formatData[d] || 0);

    // dates/counts are ascending oldest → newest already (lastNDays); the
    // old device-local loop built them newest-first and reversed after.
    await set("chartData", { dates, counts });
    setData({ dates, counts });
  };

  const getOfflineData = async () => {
    const data = await get("chartData");
    if (data) {
      setData(data);
    } else {
      setError("There is no chart data saved on this device.");
    }
  };

  useEffect(() => {
    if (navigator.onLine) {
      getData(user);
    } else {
      getOfflineData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  useEffect(() => {
    const update = () => setChartHeight(window.innerWidth < 640 ? 220 : 300);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const colors = themeColors();
  const tooltipTheme = isDark ? "dark" : "light";

  const options = {
    colors: [colors.accent],
    chart: {
      height: chartHeight,
      type: "line",
      background: "transparent",
      toolbar: { show: false },
    },
    stroke: {
      curve: "smooth",
      width: 2.5,
      colors: [colors.accent],
    },
    markers: {
      size: 4,
      colors: [colors.accent],
      strokeColors: colors.markerStroke,
      strokeWidth: 2,
    },
    dataLabels: { enabled: false },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: {
        style: { colors: colors.muted },
      },
    },
    xaxis: {
      categories: data?.dates ?? [],
      labels: {
        style: { colors: colors.muted },
      },
    },
    grid: {
      borderColor: colors.grid,
      row: { colors: ["transparent"], opacity: 0.5 },
    },
    tooltip: { theme: tooltipTheme },
    legend: { show: false },
  };

  // Plain-text alternative to the chart for screen readers.
  const summary = data
    ? data.counts.reduce((a, b) => a + b, 0) === 0
      ? "No tasks were completed in the last 7 days."
      : `${data.counts.reduce((a, b) => a + b, 0)} tasks completed in the last 7 days. Best day: ${Math.max(...data.counts)} tasks.`
    : null;

  return (
    <section aria-label="Tasks completed in the last 7 days">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-fg-muted">
        Last 7 days
      </h2>
      <div className="rounded-xl border border-border bg-surface p-5">
        {error ? (
          // An analytics/RPC failure is NEVER rendered as a genuine zero —
          // the learner sees an explicit error with a retry.
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load your weekly activity"
            description={`${error} Complete tasks and retry — your records are safe.`}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setData(null);
                  if (navigator.onLine) getData(user);
                  else getOfflineData();
                }}
              >
                Retry
              </Button>
            }
          />
        ) : data ? (
          <>
            <p className="mb-3 text-sm text-fg-muted">{summary}</p>
            <div id="chart" className="w-full" aria-hidden="true">
              <ReactApexChart
                options={options}
                series={[
                  { name: "Tasks completed", data: data.counts },
                ]}
                type="line"
                height={chartHeight}
              />
            </div>
            <table className="sr-only">
              <caption>Tasks completed per day, last 7 days</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Tasks completed</th>
                </tr>
              </thead>
              <tbody>
                {data.dates.map((date, i) => (
                  <tr key={date}>
                    <td>{date}</td>
                    <td>{data.counts[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </div>
    </section>
  );
};

export default Chart;
