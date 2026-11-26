"use client";

import React, { useState } from "react";
import EmailInput from "./EmailInput";
import PasswordInput from "./PasswordInput";
import NameInput from "./NameInput";
import supabase from "../../supabase/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "../ui/Logo";
import Card from "../ui/Card";
import Button from "../ui/Button";
import ErrorState from "../ui/ErrorState";
import { MailCheck } from "lucide-react";

function Signup() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [signupError, setSignupError] = useState(null);
  // Supabase may require email confirmation (project setting): then signUp
  // succeeds WITHOUT a session, and pushing /collection would bounce off the
  // auth guard into a redirect loop. Show a "check your email" view instead.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const router = useRouter();

  const handleForm = async (e) => {
    setSignupError(null);
    setIsSigningUp(true);
    e.preventDefault();
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { name },
        },
      });
      if (error) {
        setSignupError(error.message);
        return;
      }
      if (data?.session) {
        // Confirmed immediately (or confirmation disabled): straight in.
        setEmail("");
        setPassword("");
        setName("");
        router.push("/today");
      } else {
        setAwaitingConfirmation(true);
      }
    } catch (err) {
      setSignupError(err?.message || "Couldn't create your account. Try again.");
    } finally {
      setIsSigningUp(false);
    }
  };

  if (awaitingConfirmation) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-bg px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center">
            <Link href="/" aria-label="Learnary home">
              <Logo className="h-16 w-auto" />
            </Link>
          </div>
          <Card className="p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
              <MailCheck size={22} className="text-accent" aria-hidden />
            </span>
            <h1 className="mt-3 text-lg font-semibold text-fg">
              Check your email
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              We sent a confirmation link to{" "}
              <span className="font-medium text-fg">{email}</span>. Confirm it
              to activate your account, then sign in.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-5 w-full"
              onClick={() => router.push("/signin")}
            >
              Back to sign in
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Link href="/" aria-label="Learnary home">
            <Logo className="h-16 w-auto" />
          </Link>
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-fg">Create account</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Start tracking what you learn — free.
          </p>

          <form onSubmit={handleForm} className="mt-6 flex flex-col gap-4">
            <NameInput name={name} setName={setName} />
            <EmailInput email={email} setEmail={setEmail} />
            <PasswordInput password={password} setPassword={setPassword} />

            {signupError && <ErrorState title="" message={signupError} />}

            <Button type="submit" loading={isSigningUp} className="w-full">
              Sign up
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-fg-muted">
          Already have an account?{" "}
          <Link
            href="/signin"
            className="font-medium text-accent hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Signup;
