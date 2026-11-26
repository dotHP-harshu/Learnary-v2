"use client";

import { useContext, useEffect, useState } from "react";
import userContext from "../../context/userContext";
import ProfileForm from "./ProfileForm";
import Card from "../ui/Card";
import ErrorState from "../ui/ErrorState";
import Loading from "../ui/Loading";
import Skeleton from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import { getUserKey } from "../../utils/getUserKey";
import supabase from "../../supabase/supabase";
import { fetchLearningProfile, saveLearningProfile } from "../../services/profile";
import { UserRound } from "lucide-react";

// Settings → Learning profile. Same shared form as onboarding; Assistant features read this profile for context, never the reverse.
export default function ProfileSettingsCard() {
  const { user } = useContext(userContext);
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchLearningProfile(getUserKey(user)).then(({ data, error, offline }) => {
      if (!active) return;
      if (error) {
        setState("error");
      } else {
        setProfile(data);
        setState("ready");
        if (offline) {
          toast.info("You're offline — showing your last saved profile.");
        }
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const save = async ({ displayName, fields }, event) => {
    setBusy(true);
    if (displayName) {
      await supabase.auth.updateUser({ data: { display_name: displayName } });
    }
    const { data, error, offline } = await saveLearningProfile(
      getUserKey(user),
      fields
    );
    setBusy(false);
    if (error) {
      toast.error(
        offline
          ? "You're offline — reconnect to save your profile."
          : "Couldn't save your profile. Please try again.",
        offline
          ? undefined
          : { action: { label: "Retry", onClick: () => save({ displayName, fields }, event) } }
      );
      return;
    }
    setProfile(data);
    toast.success("Profile saved.");
  };

  const header = (
    <div className="mb-4 flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
        <UserRound size={18} className="text-accent" aria-hidden />
      </span>
      <div>
        <h2 className="text-base font-semibold text-fg">Learning profile</h2>
        <p className="text-xs text-fg-muted">Goals, availability, preferences</p>
      </div>
    </div>
  );

  if (state === "loading") {
    return (
      <Card className="p-6">
        {header}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Loading label="Loading your profile" />
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card className="p-6">
        {header}
        <ErrorState
          title=""
          message="Couldn't load your profile. Please try again."
        />
      </Card>
    );
  }

  return (
    <div>
      {header}
      <ProfileForm
        profile={profile}
        user={user}
        onSubmit={save}
        submitLabel="Save profile"
        busy={busy}
      />
    </div>
  );
}
