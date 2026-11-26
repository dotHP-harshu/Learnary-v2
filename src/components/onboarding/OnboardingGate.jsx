"use client";

import { useContext, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import userContext from "../../context/userContext";
import { getUserKey } from "../../utils/getUserKey";
import {
  fetchLearningProfile,
  isOnboardingSkippedLocally,
} from "../../services/profile";

// Positive results only: once we know a learner finished onboarding, the gate
// stays out of the way for the rest of the browser session instead of
// re-reading the profile on every navigation. Incomplete/unknown is never
// cached, so finishing onboarding (or a transient failure) re-checks normally.
const onboardedUsers = new Set();

// Onboarding gate: users who never completed onboarding are routed through it
// once; a DB skip flag (with a localStorage fallback) prevents re-asking.
function OnboardingGate({ children }) {
  const { user } = useContext(userContext);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!user || pathname === "/onboarding") return;
    const userKey = getUserKey(user);
    if (!userKey) return;
    if (onboardedUsers.has(userKey)) return;
    if (isOnboardingSkippedLocally(userKey)) return;

    let active = true;
    fetchLearningProfile(userKey).then(({ data, error }) => {
      if (!active) return;
      // "Unknown" is not "not onboarded": a network failure or a cold offline
      // cache must not trap an already-onboarded learner in a form that
      // cannot be saved while offline.
      if (error) return;
      if (data?.onboarding_completed_at) {
        onboardedUsers.add(userKey);
        return;
      }
      router.replace("/onboarding");
    });
    return () => {
      active = false;
    };
  }, [user, pathname, router]);

  return children;
}

export default OnboardingGate;
