"use client";

import { useCallback, useEffect, useState } from "react";

export type CurrentUser = { id: string; username: string; name: string };

export const loginErrors: Record<string, string> = {
  configuration: "Google sign-in needs to be configured on the server.",
  database: "Cannot connect to the user database. Please try again later.",
  expired: "Your sign-in request expired. Please try again.",
  cancelled: "Google sign-in was cancelled.",
  google: "Google sign-in could not be completed. Please try again.",
  unavailable: "Sign-in is temporarily unavailable. Please try again later.",
};

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const reason = new URL(window.location.href).searchParams.get("auth_error");
    return reason ? loginErrors[reason] || loginErrors.unavailable : "";
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Unable to load account");
      const data = await response.json();
      if (!signal?.aborted) setUser(data.user ?? null);
    } catch {
      if (!signal?.aborted) {
        // Network/auth backend down: treat as signed-out but surface a message.
        setError(loginErrors.unavailable);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Clean one-time OAuth error params from the URL (external system sync).
    const url = new URL(window.location.href);
    if (url.searchParams.has("auth_error")) {
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url);
    }
    async function loadUser() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load account");
        const data = await response.json();
        if (!controller.signal.aborted) setUser(data.user ?? null);
      } catch {
        if (!controller.signal.aborted) setError(loginErrors.unavailable);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadUser();
    return () => controller.abort();
  }, []);

  return { user, loading, error, setUser, setLoading, setError, refresh };
}
