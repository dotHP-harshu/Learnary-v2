"use client";

import { useContext } from "react";
import userContext from "../../context/userContext";
import ProfileSettingsCard from "./ProfileSettingsCard";
import AIUsageSection from "./AIUsageSection";
import PageHeader from "../ui/PageHeader";
import Card from "../ui/Card";
import { UserRound } from "lucide-react";

// My Profile page: account details, learning profile (the shared editor)
// and the usage section.
export default function ProfilePage() {
  const { user } = useContext(userContext);

  const name = user?.user_metadata?.name || "—";
  const email = user?.user_metadata?.email || user?.email || "—";
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;
  const lastSignIn = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="w-full max-w-2xl">
      <PageHeader
        title="My Profile"
        description="Account, learning profile and usage."
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Account overview */}
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full bg-accent-strong text-base font-semibold text-accent-fg"
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-fg">{name}</h2>
              <p className="truncate text-sm text-fg-muted">{email}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-muted p-3">
              <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
                <UserRound size={13} aria-hidden /> Member since
              </dt>
              <dd className="mt-1 font-medium text-fg">{memberSince ?? "—"}</dd>
            </div>
            <div className="rounded-lg border border-border bg-surface-muted p-3">
              <dt className="text-xs text-fg-muted">Last sign-in</dt>
              <dd className="mt-1 font-medium text-fg">{lastSignIn ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        {/* Learning profile — same shared editor as onboarding */}
        <ProfileSettingsCard />

        {/* Usage: allowance (credits) vs tokens vs generation limits */}
        <AIUsageSection />
      </div>
    </div>
  );
}
