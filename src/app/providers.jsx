"use client";

import { useEffect, useRef, useState } from "react";
import supabase from "../supabase/supabase";
import UserContext from "../context/userContext";
import { ThemeProvider } from "../context/ThemeContext";
import { InstallAppProvider } from "../context/InstallAppContext";
import { WifiOff } from "lucide-react";
import { ToastProvider } from "../components/ui/Toast";
import InstallApp from "../components/ui/InstallApp";
import ChunkErrorHandler from "../components/system/ChunkErrorHandler";
import { clearCacheOwner, ensureCacheOwner } from "../utils/idbCacheOwner";
import { getUserKey } from "../utils/getUserKey";

/**
 * Session bootstrap plus `onAuthStateChange` feed the shared `userContext`.
 * `loading` gates the protected routes so users aren't redirected to /signin
 * before the session is resolved.
 */
function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Whether a previous session populated the offline cache. Only then does a
  // signed-out state need to wipe it.
  const hadUser = useRef(false);

  useEffect(() => {
    let active = true;

    // Resolve the cache owner BEFORE exposing the session. `loading` keeps
    // protected routes hidden until the previous account's IndexedDB and
    // Cache Storage entries are gone, so no page can read stale data.
    const applySession = async (session) => {
      const nextUser = session?.user ?? null;
      if (nextUser) {
        await ensureCacheOwner(getUserKey(nextUser));
        hadUser.current = true;
      } else if (hadUser.current) {
        await clearCacheOwner();
        hadUser.current = false;
      }
      if (!active) return;
      setUser(nextUser);
    };

    const getSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        await applySession(session);
      } catch {
        /* stay signed out rather than block the tree forever */
      } finally {
        if (active) setLoading(false);
      }
    };

    getSession();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // getSession() above already handles the bootstrap session.
        if (event === "INITIAL_SESSION") return;
        // Same-user token refresh: identity and cache owner are unchanged.
        if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          setUser(session?.user ?? null);
          return;
        }
        // SIGNED_IN / SIGNED_OUT / account switch: hide protected UI until the
        // cache belongs to the right user.
        setLoading(true);
        void applySession(session)
          .catch(() => {
            /* keep the previous user rather than half-switching */
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      }
    );

    return () => {
      active = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser, loading }}>
      {children}
    </UserContext.Provider>
  );
}

/**
 * Offline banner. Listens for online/offline events instead of reading
 * `navigator.onLine` during render, so SSR/prerender output matches the client.
 */
function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-warning-soft p-2.5 text-center"
    >
      <WifiOff size={16} className="shrink-0 text-warning" aria-hidden />
      <p className="text-sm text-fg">
        You're offline — changes can't be saved right now. Showing your last
        saved data.
      </p>
    </div>
  );
}

export default function Providers({ children }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <UserProvider>
          <InstallAppProvider>
            <div className="w-full min-h-dvh">
              <ChunkErrorHandler />
              <OfflineBanner />
              {children}
              <InstallApp />
            </div>
          </InstallAppProvider>
        </UserProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
