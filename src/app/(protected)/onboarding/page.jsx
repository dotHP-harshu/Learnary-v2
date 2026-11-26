"use client";

import { useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import userContext from "../../../context/userContext";
import ProfileForm from "../../../components/profile/ProfileForm";
import Button from "../../../components/ui/Button";
import Loading from "../../../components/ui/Loading";
import PageHeader from "../../../components/ui/PageHeader";
import { useToast } from "../../../components/ui/Toast";
import supabase from "../../../supabase/supabase";
import { getUserKey } from "../../../utils/getUserKey";
import {
  fetchLearningProfile,
  saveLearningProfile,
  setOnboardingSkippedLocally,
} from "../../../services/profile";

// First-run onboarding: everything except the display name is optional, and
// skipping records a flag locally (and remotely when online).
export default function Onboarding() {
  const { user, loading } = useContext(userContext);
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipBusy, setSkipBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let active = true;
    fetchLearningProfile(getUserKey(user)).then(({ data }) => {
      if (!active) return;
      setProfile(data);
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [user, loading]);

  const complete = async (fields) => {
    setBusy(true);
    // Display name lives in auth metadata; learning answers in the profile.
    if (fields.displayName) {
      await supabase.auth.updateUser({ data: { display_name: fields.displayName } });
    }
    const { error, offline } = await saveLearningProfile(getUserKey(user), {
      ...fields.fields,
      onboarding_completed_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      toast.error(
        offline
          ? "You're offline — reconnect to save your profile. You can also finish this later in Settings."
          : "Couldn't save your profile. Please try again.",
        offline
          ? undefined
          : { action: { label: "Retry", onClick: () => complete(fields) } }
      );
      return;
    }
    toast.success("Profile saved. Welcome to Learnary!");
    router.push("/today");
  };

  const skip = async () => {
    setSkipBusy(true);
    setOnboardingSkippedLocally(getUserKey(user));
    if (navigator.onLine) {
      // Persist the skip so returning on another device isn't nagged either.
      await saveLearningProfile(getUserKey(user), {
        onboarding_completed_at: new Date().toISOString(),
      });
    }
    setSkipBusy(false);
    toast.info("You can finish your profile anytime in Settings.");
    router.push("/today");
  };

  if (loading || !user || !checked) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loading label="Loading onboarding" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Set up your learning profile"
        description="Answer what you like — everything except your name is optional and can be changed later in My Profile. This helps tailor recommendations to your goal and available time."
      />

      <div className="mt-6">
        <ProfileForm
          profile={profile}
          user={user}
          onSubmit={(fields, event) => complete(fields, event)}
          submitLabel="Save and continue"
          busy={busy}
        >
          <button
            type="button"
            onClick={skip}
            disabled={skipBusy || busy}
            className="self-start text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
          >
            Skip for now
          </button>
        </ProfileForm>
      </div>
    </div>
  );
}
