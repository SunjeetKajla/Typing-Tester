"use client";

export type TypingMode = "practice" | "test";

export type LocalResult = {
  attemptId?: string;
  ownerId: string | null;
  mode: TypingMode;
  grossWpm: number;
  accuracy: number;
  elapsedSeconds: number;
  charsTyped: number;
  passageLength: number;
  completedAt: string;
  passage?: string;
  typedText?: string;
};

export type PendingResult = LocalResult & {
  attemptId: string;
  passage: string;
  typedText: string;
};

const PENDING_KEY = "typing.pendingResults";
const HISTORY_KEY = "typing.localHistory";
const MAX_STORED = 100;

function normalizeResult(value: unknown): LocalResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const completedAt = typeof item.completedAt === "string"
    ? item.completedAt
    : typeof item.createdAt === "string"
      ? item.createdAt
      : "";
  if (
    typeof item.grossWpm !== "number" ||
    typeof item.accuracy !== "number" ||
    typeof item.elapsedSeconds !== "number" ||
    !completedAt
  ) return null;

  return {
    attemptId: typeof item.attemptId === "string" ? item.attemptId : undefined,
    ownerId: typeof item.ownerId === "string" ? item.ownerId : null,
    mode: item.mode === "test" ? "test" : "practice",
    grossWpm: item.grossWpm,
    accuracy: item.accuracy,
    elapsedSeconds: item.elapsedSeconds,
    charsTyped: typeof item.charsTyped === "number" ? item.charsTyped : 0,
    passageLength: typeof item.passageLength === "number" ? item.passageLength : 0,
    completedAt,
    passage: typeof item.passage === "string" ? item.passage : undefined,
    typedText: typeof item.typedText === "string" ? item.typedText : undefined,
  };
}

function isPendingResult(result: LocalResult): result is PendingResult {
  return Boolean(result.attemptId && result.passage && result.typedText);
}

function readList(key: string): LocalResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeResult).filter((item): item is LocalResult => item !== null)
      : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: LocalResult[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(-MAX_STORED)));
    return true;
  } catch {
    return false;
  }
}

function isVisibleToOwner(result: LocalResult, ownerId: string | null) {
  return result.ownerId === null || result.ownerId === ownerId;
}

export function readPendingResults(ownerId: string | null): PendingResult[] {
  return readList(PENDING_KEY).filter(
    (result): result is PendingResult => isPendingResult(result) && isVisibleToOwner(result, ownerId),
  );
}

export function readLocalHistory(ownerId: string | null): LocalResult[] {
  return readList(HISTORY_KEY).filter((result) => isVisibleToOwner(result, ownerId));
}

export function appendLocalResult(result: PendingResult) {
  const history = readList(HISTORY_KEY).filter((item) => item.attemptId !== result.attemptId);
  const pending = readList(PENDING_KEY).filter((item) => item.attemptId !== result.attemptId);
  return {
    historySaved: writeList(HISTORY_KEY, [...history, result]),
    pendingSaved: writeList(PENDING_KEY, [...pending, result]),
  };
}

export function markResultSynced(attemptId: string, ownerId: string) {
  const history = readList(HISTORY_KEY).map((item) =>
    item.attemptId === attemptId ? { ...item, ownerId } : item,
  );
  const pending = readList(PENDING_KEY).filter((item) => item.attemptId !== attemptId);
  return {
    historySaved: writeList(HISTORY_KEY, history),
    pendingSaved: writeList(PENDING_KEY, pending),
  };
}

export type ServerHistoryEntry = {
  resultId: string;
  mode: TypingMode;
  grossWpm: number;
  accuracy: number;
  wpm: number;
  elapsedSeconds: number;
  completedAt: string;
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
    body: JSON.stringify({
      attemptId: result.attemptId,
      ownerId: result.ownerId,
      mode: result.mode,
      passage: result.passage,
      typedText: result.typedText,
      elapsedSeconds: result.elapsedSeconds,
      completedAt: result.completedAt,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(`Save failed with status ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.json();
}
