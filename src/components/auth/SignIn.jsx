"use client";

import React, { useState } from "react";
import EmailInput from "./EmailInput";
import PasswordInput from "./PasswordInput";
import supabase from "../../supabase/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "../ui/Logo";
import Card from "../ui/Card";
import Button from "../ui/Button";
import ErrorState from "../ui/ErrorState";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signinError, setSigninError] = useState(null);
  const router = useRouter();

  const handleLogin = async (e) => {
    setSigninError(null);
    setIsSigningIn(true);
    e.preventDefault();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setSigninError(error.message);
        setIsSigningIn(false);
      } else {
        setIsSigningIn(false);
        router.push("/today");
      }
    } catch (error) {
      setSigninError(error.message);
      setIsSigningIn(false);
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
          <h1 className="text-lg font-semibold text-fg">Sign in</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Welcome back — continue your learning.
          </p>

          <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
            <EmailInput email={email} setEmail={setEmail} />
            <PasswordInput password={password} setPassword={setPassword} />

            {signinError && <ErrorState title="" message={signinError} />}

            <Button type="submit" loading={isSigningIn} className="w-full">
              Sign in
            </Button>

            <p className="text-center text-sm">
              <Link
                href="/forgot-password"
                className="font-medium text-fg-muted transition-colors hover:text-accent"
              >
                Forgot password?
              </Link>
            </p>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-fg-muted">
          New to Learnary?{" "}
          <Link
            href="/signup"
            className="font-medium text-accent hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export default SignIn;
