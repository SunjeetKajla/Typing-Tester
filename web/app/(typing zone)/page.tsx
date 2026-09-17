"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import HistorySection from "./history-section";
import SpeedGraph from "./speed-graph";
import { measureTyping, type TypingSample } from "./typing-stats";
import { useCurrentUser } from "../use-current-user";
import {
  appendLocalResult,
  postResult,
  readPendingResults,
  removePendingResult,
  type PendingResult,
} from "./local-results";

const initialPassage = "Learning to type takes practice. Focus on accuracy first. Speed follows my brother.\nSpeed or Accuracy? Accuracy!";

type SaveStatus = "idle" | "saving" | "saved" | "local" | "error";

export default function MainPage() {
  const typingInputRef = useRef<HTMLTextAreaElement>(null);
  const latestTextRef = useRef("");
  const finishPersistedRef = useRef(false);
  const flushingRef = useRef(false);
  const [typedText, setTypedText] = useState("");
  const [caretPosition, setCaretPosition] = useState(0);
  const [passage, setPassage] = useState(initialPassage);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [samples, setSamples] = useState<TypingSample[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [pendingCount, setPendingCount] = useState(() => readPendingResults().length);
  const [historyVersion, setHistoryVersion] = useState(0);
  const { user, loading: authLoading } = useCurrentUser();
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const { grossWpm, errorRate } = measureTyping(typedText, passage, elapsedSeconds);
  const accuracy = typedText.length === 0 ? null : 100 - errorRate;
  const adjustedWpm = grossWpm * ((accuracy ?? 0) / 100);

  useEffect(() => {
    if (!isLoading && !isFinished) {
      typingInputRef.current?.focus({ preventScroll: true });
    }
  }, [isLoading, isFinished]);

  const persistResult = useCallback(async (result: PendingResult) => {
    // Always keep a local copy so anonymous tests survive reloads.
    appendLocalResult(result);
    setPendingCount(readPendingResults().length);
    setHistoryVersion((version) => version + 1);

    if (!userRef.current) {
      setSaveStatus("local");
      return;
    }

    setSaveStatus("saving");
    setSaveError("");
    try {
      await postResult(result);
      removePendingResult(result);
      setPendingCount(readPendingResults().length);
      setSaveStatus("saved");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) {
        // Session expired: keep it queued locally for the next sign-in.
        setSaveStatus("local");
      } else {
        setSaveError("Could not save your result. Please try again.");
        setSaveStatus("error");
      }
      setPendingCount(readPendingResults().length);
    }
    setHistoryVersion((version) => version + 1);
  }, []);

  // When a signed-out user signs in, upload queued local results so their
  // history syncs across devices. The leaderboard shows every upload.
  useEffect(() => {
    if (!user || flushingRef.current) return;
    const pending = readPendingResults();
    if (pending.length === 0) return;
    flushingRef.current = true;
    (async () => {
      let failures = 0;
      for (const result of pending) {
        try {
          await postResult(result);
          removePendingResult(result);
        } catch {
          failures += 1;
        }
      }
      setPendingCount(readPendingResults().length);
      if (failures === 0) setSaveStatus((previous) => (previous === "local" ? "saved" : previous));
      setHistoryVersion((version) => version + 1);
      flushingRef.current = false;
    })();
  }, [user]);

  const retrySave = useCallback(async () => {
    const pending = readPendingResults();
    const latest = pending[pending.length - 1];
    if (!latest) {
      setSaveStatus("idle");
      return;
    }
    if (!userRef.current) {
      setSaveStatus("local");
      return;
    }
    setSaveStatus("saving");
    setSaveError("");
    try {
      await postResult(latest);
      removePendingResult(latest);
      setPendingCount(readPendingResults().length);
      setSaveStatus("saved");
    } catch {
      setSaveError("Could not save your result. Please try again.");
      setSaveStatus("error");
    }
    setHistoryVersion((version) => version + 1);
  }, []);

  function handleTyping(value: string) {
    if (isLoading || isFinished) return;

    const now = performance.now();
    const start = startedAt ?? now;

    if (startedAt === null && value.length > 0) {
      setStartedAt(start);
    }

    const seconds = (now - start) / 1000;
    latestTextRef.current = value;
    setTypedText(value);
    setCaretPosition(value.length);
    setElapsedSeconds(seconds);

    if (value.length === passage.length && !finishPersistedRef.current) {
      finishPersistedRef.current = true;
      const finalSample = measureTyping(value, passage, seconds);
      const finalAccuracy = 100 - finalSample.errorRate;
      setIsFinished(true);
      setSamples((previous) => [...previous, finalSample]);
      void persistResult({
        grossWpm: finalSample.grossWpm,
        accuracy: finalAccuracy,
        elapsedSeconds: seconds,
        charsTyped: value.length,
        passageLength: passage.length,
        createdAt: new Date().toISOString(),
      });
    }
  }

  useEffect(() => {
    if (startedAt === null || isFinished) return;

    const intervalId = window.setInterval(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      setElapsedSeconds(seconds);
      const sample = measureTyping(latestTextRef.current, passage, seconds);
      setSamples((previous) => {
        const lastSeconds = previous[previous.length - 1]?.seconds ?? 0;
        return seconds - lastSeconds >= 1 ? [...previous, sample] : previous;
      });
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [startedAt, isFinished, passage]);

  async function loadRandomPassage() {
    if (isLoading) return;

    setIsLoading(true);
    setError("");
    setSaveError("");
    setSaveStatus("idle");
    setTypedText("");
    latestTextRef.current = "";
    setSamples([]);
    setCaretPosition(0);
    setStartedAt(null);
    setElapsedSeconds(0);
    setIsFinished(false);
    finishPersistedRef.current = false;

    try {
      const response = await fetch("https://dummyjson.com/quotes/random", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch passage");
      }

      const data = await response.json();

      if (typeof data?.quote !== "string" || data.quote.trim().length === 0) {
        throw new Error("Invalid passage");
      }

      setPassage(data.quote.trim().replace(/\s+/g, " "));
    } catch {
      setError(
        "Could not load new text. Try again or practise the current passage."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-bold">Typing Performance Tester</h1>
      <div className="flex flex-wrap gap-3">
        <Link href="/leaderboard" className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          View leaderboard →
        </Link>

        <button
          type="button"
          onClick={loadRandomPassage}
          disabled={isLoading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {isLoading ? "Loading..." : "New random passage"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}

      <p id="typing-hint" className="text-sm text-gray-500">
        Start typing to begin. Use Enter for ↵.
      </p>

      <div
        aria-busy={isLoading}
        className="group relative rounded-lg border border-gray-500 p-6 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500"
      >
        <p
          id="typing-passage"
          className="pointer-events-none whitespace-pre-wrap wrap-break-words font-mono text-xl leading-relaxed"
        >
          {passage.split("").map((character, index) => {
            let colour = "text-gray-500";

            if (index < typedText.length) {
              colour =
                typedText[index] === character
                  ? "text-green-500"
                  : "bg-red-500/20 text-red-500";
            }

            return (
              <span key={index} className={`relative ${colour}`}>
                {index === caretPosition && !isFinished && (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px top-0 h-[1.2em] border-l-2 border-blue-500 opacity-0 group-focus-within:opacity-100"
                  />
                )}
                {character === "\n" ? <>↵<br /></> : character}
              </span>
            );
          })}
        </p>

        <label htmlFor="typing-input" className="sr-only">
          Type the displayed passage
        </label>

        <textarea
          id="typing-input"
          ref={typingInputRef}
          value={typedText}
          onChange={(event) => handleTyping(event.target.value)}
          onClick={(event) => {
            event.currentTarget.setSelectionRange(typedText.length, typedText.length);
            setCaretPosition(typedText.length);
          }}
          onSelect={(event) => setCaretPosition(event.currentTarget.selectionStart)}
          aria-describedby="typing-hint typing-passage"
          maxLength={passage.length}
          disabled={isLoading || isFinished}
          onPaste={(event) => event.preventDefault()}
          onDrop={(event) => event.preventDefault()}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="absolute inset-0 h-full w-full cursor-text resize-none opacity-0 disabled:cursor-default"
        />
      </div>

      <p>Characters typed: {typedText.length} / {passage.length}</p>
      <p>Time: {elapsedSeconds.toFixed(1)} seconds</p>
      <p>Accuracy: {accuracy === null ? "—" : `${accuracy.toFixed(1)}%`}</p>
      <p>Gross WPM: {grossWpm === null ? "—" : `${grossWpm.toFixed(1)} words per minutes`}</p>
      <p className="font-bold">Adjusted WPM: {adjustedWpm === null ? "—" : `${adjustedWpm.toFixed(1)} words per minutes`}</p>

      {isFinished && (
        <div className="space-y-2">
          <p role="status" className="text-green-500">
            Test completed! Load another passage to try again.
          </p>
          {saveStatus === "saving" && (
            <p role="status" className="text-sm text-gray-500">Saving your result…</p>
          )}
          {saveStatus === "saved" && (
            <p role="status" className="text-sm text-green-600">
              Result saved{pendingCount > 0 ? ` (${pendingCount} older result${pendingCount === 1 ? "" : "s"} still queued)` : ""}. See it on the leaderboard.
            </p>
          )}
          {saveStatus === "local" && (
            <p role="status" className="text-sm text-gray-500">
              Saved on this device. Sign in to sync it across devices{pendingCount > 1 ? ` (${pendingCount} queued)` : ""}.
            </p>
          )}
          {saveStatus === "error" && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-sm text-red-500">{saveError}</p>
              <button
                type="button"
                onClick={retrySave}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Retry save
              </button>
            </div>
          )}
        </div>
      )}
      <SpeedGraph
        samples={samples}
        grossWpm={grossWpm}
        errorRate={typedText.length === 0 ? null : errorRate}
        adjustedWpm={adjustedWpm}
      />
      <HistorySection user={user} authLoading={authLoading} refreshKey={historyVersion} />
    </main>
  );
}
