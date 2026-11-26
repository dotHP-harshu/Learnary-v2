"use client";

import React, { useState } from "react";
import Link from "next/link";
import EmailInput from "../../components/auth/EmailInput";
import supabase from "../../supabase/supabase";
import Logo from "../../components/ui/Logo";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import ErrorState from "../../components/ui/ErrorState";
import { MailCheck } from "lucide-react";

/**
 * Forgot password (public route): sends the Supabase password-reset email.
 * The link redirects back to /reset-password (must be an allowed redirect
 * URL in the Supabase dashboard). Password reset is online-only by nature.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSending(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo: `${window.location.origin}/reset-password` }
      );
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err?.message || "Couldn't send the reset link. Try again.");
    } finally {
      setIsSending(false);
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
          {sent ? (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <MailCheck size={22} className="text-accent" aria-hidden />
              </span>
              <h1 className="mt-3 text-lg font-semibold text-fg">
                Check your email
              </h1>
              <p className="mt-1 text-sm text-fg-muted">
                If an account exists for{" "}
                <span className="font-medium text-fg">{email}</span>, we sent a
                link to reset your password.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-fg">Reset password</h1>
              <p className="mt-1 text-sm text-fg-muted">
                Enter your account email and we'll send you a reset link.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
                <EmailInput email={email} setEmail={setEmail} />
                {error && <ErrorState title="" message={error} />}
                <Button type="submit" loading={isSending} className="w-full">
                  Send reset link
                </Button>
              </form>
            </>
          )}
        </Card>

        <p className="mt-4 text-center text-sm text-fg-muted">
          Remembered it?{" "}
          <Link href="/signin" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
