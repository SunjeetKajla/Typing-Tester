"use client";

export type PendingResult = {
  grossWpm: number;
  accuracy: number;
  elapsedSeconds: number;
  charsTyped: number;
  passageLength: number;
  createdAt: string;
};

const PENDING_KEY = "typing.pendingResults";
const HISTORY_KEY = "typing.localHistory";
const MAX_STORED = 100;

function readList(key: string): PendingResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: PendingResult[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(-MAX_STORED)));
  } catch {
    // Storage full or unavailable (private mode): saving locally is best-effort.
  }
}

export function readPendingResults(): PendingResult[] {
  return readList(PENDING_KEY);
}

export function readLocalHistory(): PendingResult[] {
  return readList(HISTORY_KEY);
}

export function appendLocalResult(result: PendingResult) {
  writeList(HISTORY_KEY, [...readList(HISTORY_KEY), result]);
  writeList(PENDING_KEY, [...readList(PENDING_KEY), result]);
}

export function removePendingResult(result: PendingResult) {
  writeList(
    PENDING_KEY,
    readList(PENDING_KEY).filter(
      (item) =>
        !(
          item.createdAt === result.createdAt &&
          item.grossWpm === result.grossWpm &&
          item.accuracy === result.accuracy
        ),
    ),
  );
}

export function clearPendingResults() {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export type ServerHistoryEntry = {
  resultId: string;
  grossWpm: number;
  accuracy: number;
  wpm: number;
  elapsedSeconds: number;
  createdAt: string;
};

export async function fetchServerHistory(signal?: AbortSignal): Promise<ServerHistoryEntry[]> {
  const response = await fetch("/api/results/me", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`History request failed with status ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function postResult(result: PendingResult) {
  const response = await fetch("/api/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(`Save failed with status ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.json();
}
