"use client";

import { useEffect, useRef, useState } from "react";
import SpeedGraph from "./speed-graph";
import { measureTyping, type TypingSample } from "./typing-stats";

const initialPassage = "Learning to type takes practice. Focus on accuracy first. Speed follows my brother.\nSpeed or Accuracy? Accuracy!";

export default function MainPage() {
  const typingInputRef = useRef<HTMLTextAreaElement>(null);
  const latestTextRef = useRef("");
  const [typedText, setTypedText] = useState("");
  const [caretPosition, setCaretPosition] = useState(0);
  const [passage, setPassage] = useState(initialPassage);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [samples, setSamples] = useState<TypingSample[]>([]);

  const { grossWpm, errorRate } = measureTyping(typedText, passage, elapsedSeconds);
  const accuracy = typedText.length === 0 ? null : 100 - errorRate;
  const adjustedWpm = grossWpm * ((accuracy ?? 0) / 100);

  useEffect(() => {
    if (!isLoading && !isFinished) {
      typingInputRef.current?.focus({ preventScroll: true });
    }
  }, [isLoading, isFinished]);

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

    if (value.length === passage.length) {
      setIsFinished(true);
      setSamples((previous) => [...previous, measureTyping(value, passage, seconds)]);
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
    setTypedText("");
    latestTextRef.current = "";
    setSamples([]);
    setCaretPosition(0);
    setStartedAt(null);
    setElapsedSeconds(0);
    setIsFinished(false);

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
      <h1 className="text-3xl font-bold">Typing Performance Tracker</h1>
      {/* <Link href="/leaderboard" className="rounded-lg bg-blue-600 px-4 py-3 mx-2 text-white disabled:opacity-50">
        View leaderboard →
      </Link> */}

      <button
        type="button"
        onClick={loadRandomPassage}
        disabled={isLoading}
        className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isLoading ? "Loading..." : "New random passage"}
      </button>

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

      {isFinished && (
        <p role="status" className="text-green-500">
          Test completed! Load another passage to try again.
        </p>
      )}
      <SpeedGraph
        samples={samples}
        grossWpm={grossWpm}
        errorRate={typedText.length === 0 ? null : errorRate}
        adjustedWpm={adjustedWpm}
      />
    </main>
  );
}
