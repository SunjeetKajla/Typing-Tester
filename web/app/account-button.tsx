"use client";

import { useCurrentUser } from "./use-current-user";

export default function AccountButton() {
  const { user, loading, error, setUser, setLoading, setError } = useCurrentUser();

  async function logout() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out");
      setUser(null);
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 px-6 pt-6 xl:absolute xl:right-8 xl:top-16 xl:p-0">
      {loading ? (
        <span className="rounded-lg bg-green-700 px-4 py-2 text-sm text-white" role="status">Loading account...</span>
      ) : user ? (
        <div className="flex items-center gap-3">
          <span className="max-w-48 truncate rounded-lg bg-green-700 px-4 py-2 text-white" title={user.username}>{user.username}</span>
          <button onClick={logout} className="text-sm text-gray-500 underline underline-offset-4">Sign out</button>
        </div>
      ) : (
        <button type="button" onClick={() => window.location.assign(new URL("/api/auth/google", window.location.origin).href)} className="rounded-lg bg-green-700 px-4 py-2 text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-500">
          Sign up / Login
        </button>
      )}
      {error && <p role="alert" className="max-w-64 text-right text-xs text-red-500">{error}</p>}
    </div>
  );
}
