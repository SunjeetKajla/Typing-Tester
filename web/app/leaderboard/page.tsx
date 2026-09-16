"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Typist = {
  id: string;
  name: string;
  username: string;
  rank: number;
  wpm: number;
  accuracy: number;
};

export default function LeaderboardPage() {
  const [typists, setTypists] = useState<Typist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLeaderboard() {
      try {
        const response = await fetch("/api/leaderboard", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to load leaderboard");

        const result = await response.json();
        if (!controller.signal.aborted) setTypists(result.data);
      } catch {
        if (!controller.signal.aborted) setError("Could not load the leaderboard. Please try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    loadLeaderboard();
    return () => controller.abort();
  }, [retry]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-bold">Leaderboard</h1>

      <Link href="/" className="inline-flex rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
        Back to typing
      </Link>

      <p className="text-sm text-gray-500">Sample results from 60-second tests, ranked by adjusted WPM.</p>

      {isLoading ? (
        <p role="status" className="text-gray-500">Loading leaderboard...</p>
      ) : error ? (
        <div className="space-y-3">
          <p role="alert" className="text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => { setIsLoading(true); setError(""); setRetry(retry + 1); }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      ) : typists.length === 0 ? (
        <p className="text-gray-500">No results yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-500">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Typing rankings using sample data</caption>
            <thead className="border-b border-gray-500 text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-4 font-medium">Rank</th>
                <th scope="col" className="px-4 py-4 font-medium">Typist</th>
                <th scope="col" className="px-4 py-4 text-right font-medium">WPM</th>
                <th scope="col" className="px-4 py-4 text-right font-medium">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {typists.map((typist) => (
                <tr key={typist.id} className="border-b border-gray-500/20 last:border-0">
                  <td className={`px-4 py-4 font-mono ${typist.rank <= 3 ? "text-blue-500" : "text-gray-500"}`}>
                    {typist.rank}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium">{typist.name}</p>
                    <p className="mt-1 text-xs text-gray-500">@{typist.username}</p>
                  </td>
                  <td className="px-4 py-4 text-right font-mono font-semibold">{typist.wpm.toFixed(1)}</td>
                  <td className="px-4 py-4 text-right font-mono">{typist.accuracy.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-gray-500">Adjusted WPM = gross WPM × (accuracy / 100). Higher accuracy breaks ties.</p>
    </main>
  );
}
