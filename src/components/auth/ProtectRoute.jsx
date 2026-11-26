"use client";
import userContext from "../../context/userContext";
import React, { useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import Loading from "../ui/Loading";

function ProtectRoute({ children }) {
  const { user, loading } = useContext(userContext);
  const router = useRouter();

  // No second session fetch: the auth provider resolves the session before it
  // clears `loading`, and keeps `user` current via onAuthStateChange.
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/signin");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-dvh bg-bg">
        <Loading />
      </div>
    );
  }

  return children;
}

export default ProtectRoute;
