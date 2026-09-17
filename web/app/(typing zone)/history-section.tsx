"use client";

import { useEffect, useState } from "react";
import type { CurrentUser } from "../use-current-user";
import {
  fetchServerHistory,
  readLocalHistory,
  readPendingResults,
  type PendingResult,
  type ServerHistoryEntry,
} from "./local-results";

type HistoryRow = {
  key: string;
  createdAt: string;
  wpm: number;
  accuracy: number;
  grossWpm: number;
  elapsedSeconds: number;
  source: "synced" | "device";
};

function toRowFromServer(entry: ServerHistoryEntry): HistoryRow {
  return {
    key: entry.resultId,
    createdAt: entry.createdAt,
    wpm: entry.wpm,
    accuracy: entry.accuracy,
    grossWpm: entry.grossWpm,
    elapsedSeconds: entry.elapsedSeconds,
    source: "synced",
  };
}

function toRowFromLocal(entry: PendingResult, index: number): HistoryRow {
  return {
    key: `${entry.createdAt}-${index}`,
    createdAt: entry.createdAt,
    wpm: Math.round((entry.grossWpm * entry.accuracy) / 100 * 10) / 10,
    accuracy: entry.accuracy,
    grossWpm: entry.grossWpm,
    elapsedSeconds: entry.elapsedSeconds,
    source: "device",
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HistorySection({
  user,
  authLoading,
  refreshKey,
}: {
  user: CurrentUser | null;
  authLoading: boolean;
  refreshKey: number;
}) {
  const [serverRows, setServerRows] = useState<HistoryRow[] | null>(null);
  const [localRows, setLocalRows] = useState<HistoryRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      // Yield so external-store sync (localStorage + network) doesn't cascade
      // synchronously inside the effect body.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setLocalRows(readLocalHistory().map(toRowFromLocal).reverse());
      setPendingCount(readPendingResults().length);

      if (!user) {
        setServerRows(null);
        setIsLoading(false);
        setError("");
        return;
      }

      setIsLoading(true);
      setError("");
      try {
        const entries = await fetchServerHistory(controller.signal);
        if (!controller.signal.aborted) {
          setServerRows(entries.map(toRowFromServer));
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("Could not load your synced history. Please try again.");
          setServerRows([]);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [user, refreshKey]);

  const rows = user ? (serverRows ?? []) : localRows;
  const showSyncNote = Boolean(user);
  const showDeviceNote = !user;

  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="history-title" className="text-lg font-semibold">
          Your history
        </h2>
        {pendingCount > 0 && (
          <p className="text-xs text-gray-500">
            {pendingCount} result{pendingCount === 1 ? "" : "s"} waiting to sync from this device
          </p>
        )}
      </div>

      {showSyncNote && (
        <p className="text-sm text-gray-500">
          {authLoading
            ? "Checking your account…"
            : "Synced across devices. Your results also appear on the leaderboard."}
        </p>
      )}
      {showDeviceNote && (
        <p className="text-sm text-gray-500">
          Saved on this device. Sign in to sync it across devices and appear on the leaderboard.
        </p>
      )}

      {user && isLoading ? (
        <p role="status" className="text-sm text-gray-500">
          Loading your history…
        </p>
      ) : user && error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
          {localRows.length > 0 && (
            <p className="text-sm text-gray-500">
              Showing {localRows.length} result{localRows.length === 1 ? "" : "s"} saved on this device below.
            </p>
          )}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No completed tests yet. Finish a passage and it will show up here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-500">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {user ? "Your synced typing history" : "Your typing history on this device"}
            </caption>
            <thead className="border-b border-gray-500 text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Adjusted WPM
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Accuracy
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Gross WPM
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-gray-500/20 last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(row.createdAt)}
                    {row.source === "device" && !user && (
                      <span className="ml-2 rounded bg-gray-500/20 px-1.5 py-0.5 text-xs text-gray-500">
                        this device
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{row.wpm.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.accuracy.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right font-mono">{row.grossWpm.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.elapsedSeconds.toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {user && error && localRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-500">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Results saved on this device</caption>
            <thead className="border-b border-gray-500 text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Adjusted WPM
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Accuracy
                </th>
              </tr>
            </thead>
            <tbody>
              {localRows.map((row) => (
                <tr key={row.key} className="border-b border-gray-500/20 last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{row.wpm.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.accuracy.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
