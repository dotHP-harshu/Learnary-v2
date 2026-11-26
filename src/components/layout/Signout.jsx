"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import supabase from "../../supabase/supabase";
import { clearCacheOwner } from "../../utils/idbCacheOwner";
import { clearOnboardingSkippedLocally } from "../../services/profile";
import { LoaderCircle, LogOut } from "lucide-react";
import { useToast } from "../ui/Toast";

/**
 * Sign-out button: clears the local offline cache and returns to sign-in.
 * Guarded against double-clicks and reports a failed sign-out instead of
 * silently redirecting as if it succeeded.
 */
function Signout() {
  const router = useRouter();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error("Couldn't sign out. Please try again.");
        return;
      }
      // Reset local state: IndexedDB and the service worker's data caches
      // hold offline data, sessionStorage holds in-progress drafts (roadmap
      // review), and the onboarding-skip flag lives in localStorage. All
      // three are per-user state and must not survive into the next account
      // on this browser.
      await clearCacheOwner();
      try {
        sessionStorage.clear();
      } catch {
        /* storage unavailable — nothing to clear */
      }
      clearOnboardingSkippedLocally();
      router.replace("/signin");
    } catch {
      toast.error("Couldn't sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      aria-busy={signingOut}
      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-error transition-colors duration-200 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
    >
      {signingOut ? (
        <LoaderCircle size={16} className="animate-spin" aria-hidden />
      ) : (
        <LogOut size={16} aria-hidden />
      )}
      Sign out
    </button>
  );
}

export default Signout;
