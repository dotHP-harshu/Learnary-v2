"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PasswordInput from "../../components/auth/PasswordInput";
import supabase from "../../supabase/supabase";
import Logo from "../../components/ui/Logo";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import ErrorState from "../../components/ui/ErrorState";
import { KeyRound } from "lucide-react";

/**
 * Set a new password (public route). The Supabase client detects the session
 * tokens in the URL the reset email links to (detectSessionInUrl), so the
 * user is temporarily signed in here; the form calls updateUser with the new
 * password.
 */
export default function ResetPassword() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    // The Supabase client consumes the reset tokens in the URL
    // asynchronously. A fixed 300 ms delay raced that exchange on slow
    // devices and showed "link expired" for a perfectly valid link, so
    // subscribe first, then check the current session, and only give up
    // after a bounded wait.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !session) return;
      setHasSession(true);
      setChecking(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data?.session) {
        setHasSession(true);
        setChecking(false);
      }
    });

    const giveUp = setTimeout(() => {
      if (active) setChecking(false);
    }, 5000);

    return () => {
      active = false;
      clearTimeout(giveUp);
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setSaved(true);
      // End the temporary recovery session: the user signs in with the new
      // password instead of staying authenticated from the email link.
      await supabase.auth.signOut();
      setTimeout(() => router.push("/signin"), 1500);
    } catch (err) {
      setError(err?.message || "Couldn't update your password. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Link href="/" aria-label="Learnary home">
            <Logo className="h-16 w-auto" />
          </Link>
        </div>
        <Card className="p-6">
          {checking ? (
            <p className="text-sm text-fg-muted" aria-busy="true">
              Verifying reset link…
            </p>
          ) : saved ? (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <KeyRound size={22} className="text-accent" aria-hidden />
              </span>
              <h1 className="mt-3 text-lg font-semibold text-fg">
                Password updated
              </h1>
              <p className="mt-1 text-sm text-fg-muted">
                Your new password is set. Redirecting you to sign in…
              </p>
            </>
          ) : hasSession ? (
            <>
              <h1 className="text-lg font-semibold text-fg">Set new password</h1>
              <p className="mt-1 text-sm text-fg-muted">
                Choose a new password for your account.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
                <PasswordInput
                  password={password}
                  setPassword={setPassword}
                  autoComplete="new-password"
                  label="New password"
                  minLength={6}
                  required
                />
                {error && <ErrorState title="" message={error} />}
                <Button type="submit" loading={isSaving} className="w-full">
                  Save new password
                </Button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-fg">Link expired</h1>
              <p className="mt-1 text-sm text-fg-muted">
                This reset link is invalid or has expired. Request a new one and
                try again.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-5 w-full"
                onClick={() => router.push("/forgot-password")}
              >
                Request a new link
              </Button>
            </>
          )}
        </Card>

        <p className="mt-4 text-center text-sm text-fg-muted">
          <Link href="/signin" className="font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
