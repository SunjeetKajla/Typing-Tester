"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type CurrentUser = { id: string; username: string; name: string };

export const loginErrors: Record<string, string> = {
  configuration: "Google sign-in needs to be configured on the server.",
  database: "Cannot connect to the user database. Please try again later.",
  expired: "Your sign-in request expired. Please try again.",
  cancelled: "Google sign-in was cancelled.",
  google: "Google sign-in could not be completed. Please try again.",
  unavailable: "Sign-in is temporarily unavailable. Please try again later.",
};

type CurrentUserContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  error: string;
  setUser: Dispatch<SetStateAction<CurrentUser | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  refresh: (signal?: AbortSignal) => Promise<void>;
};

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Unable to load account");
      const data = await response.json();
      if (!signal?.aborted) {
        setUser(data.user ?? null);
      }
    } catch {
      if (!signal?.aborted) {
        // Network/auth backend down: treat as signed-out but surface a message.
        setUser(null);
        setError(loginErrors.unavailable);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("auth_error");
    if (reason) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setError(loginErrors[reason] || loginErrors.unavailable);
        }
      });
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url);
    }
    async function loadUser() {
      await Promise.resolve();
      if (!controller.signal.aborted) await refresh(controller.signal);
    }
    void loadUser();
    return () => controller.abort();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, error, setUser, setLoading, setError, refresh }),
    [user, loading, error, refresh],
  );

  return createElement(CurrentUserContext.Provider, { value }, children);
}

export function useCurrentUser() {
  const context = useContext(CurrentUserContext);
  if (!context) throw new Error("useCurrentUser must be used inside CurrentUserProvider");
  return context;
}
