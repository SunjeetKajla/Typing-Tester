"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { CurrentUser } from "../use-current-user";

type RaceFormat = "timed" | "finish";
type PassageType = "words" | "sentences";
type RoomState = "waiting" | "countdown" | "running" | "finished";

type Player = {
  id: string;
  username: string;
  name: string;
  isCreator: boolean;
  ready: boolean;
  connected: boolean;
  finished: boolean;
  charsTyped: number;
  progress: number;
  grossWpm: number;
  adjustedWpm: number;
  accuracy: number;
  correctCharacters: number;
};

type RaceResultPlayer = Player & { completed: boolean; elapsedSeconds: number };

type MultiplayerRoom = {
  code: string;
  state: RoomState;
  creatorId: string;
  settings: {
    format: RaceFormat;
    passageType: PassageType;
    durationSeconds?: number;
    wordCount?: number;
  };
  players: Player[];
  race: { passage: string; startAt: number; endAt: number } | null;
  result: {
    reason: "completed" | "timeout" | "forfeit";
    winnerId: string | null;
    isDraw: boolean;
    players: RaceResultPlayer[];
    finishedAt: number;
  } | null;
};

type Ack<T = MultiplayerRoom> = { ok: true; data: T } | { ok: false; error: string };
type ConnectionStatus = "connecting" | "connected" | "disconnected";

const ACTIVE_ROOM_KEY = "typing.multiplayerRoom";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8000";

function roomDescription(room: MultiplayerRoom) {
  const type = room.settings.passageType === "words" ? "Random words" : "Natural sentences";
  return room.settings.format === "timed"
    ? `${room.settings.durationSeconds}-second timed race · ${type}`
    : `${room.settings.wordCount}-word finish race · ${type}`;
}

function updatePlayer(room: MultiplayerRoom | null, player: Player): MultiplayerRoom | null {
  if (!room) return room;
  return { ...room, players: room.players.map((entry) => entry.id === player.id ? player : entry) };
}

export default function MultiplayerMode({ user }: { user: CurrentUser }) {
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<MultiplayerRoom | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const progressTimerRef = useRef<number | null>(null);
  const latestTextRef = useRef("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [room, setRoom] = useState<MultiplayerRoom | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [format, setFormat] = useState<RaceFormat>("timed");
  const [passageType, setPassageType] = useState<PassageType>("sentences");
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [wordCount, setWordCount] = useState(50);
  const [typedText, setTypedText] = useState("");
  const [clock, setClock] = useState(0);

  const acceptRoom = useCallback((nextRoom: MultiplayerRoom) => {
    roomRef.current = nextRoom;
    setRoom(nextRoom);
    setClock(Date.now());
    setError("");
    window.sessionStorage.setItem(ACTIVE_ROOM_KEY, nextRoom.code);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;
    let refreshingToken = false;

    async function fetchToken() {
      const response = await fetch("/api/auth/socket-token", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Your sign-in expired. Sign in again to use multiplayer.");
      const payload = await response.json();
      if (typeof payload?.token !== "string") throw new Error("Could not authenticate multiplayer.");
      return payload.token as string;
    }

    async function connect() {
      try {
        const token = await fetchToken();
        if (cancelled) return;
        socket = io(SOCKET_URL, { auth: { token } });
        socketRef.current = socket;

        socket.on("connect", () => {
          setConnectionStatus("connected");
          setError("");
          const savedCode = window.sessionStorage.getItem(ACTIVE_ROOM_KEY);
          if (savedCode) {
            socket?.emit("room:rejoin", { code: savedCode }, (response: Ack) => {
              if (response.ok) acceptRoom(response.data);
              else {
                window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
                setRoom(null);
                setError(response.error);
              }
            });
          }
        });
        socket.on("disconnect", () => setConnectionStatus("disconnected"));
        socket.on("connect_error", async (connectionError) => {
          setConnectionStatus("disconnected");
          if (connectionError.message !== "Authentication required." || refreshingToken) {
            setError(connectionError.message || "Could not connect to multiplayer.");
            return;
          }
          refreshingToken = true;
          try {
            const freshToken = await fetchToken();
            if (socket && !cancelled) {
              socket.auth = { token: freshToken };
              socket.connect();
            }
          } catch (tokenError) {
            setError(tokenError instanceof Error ? tokenError.message : "Could not reconnect.");
          } finally {
            refreshingToken = false;
          }
        });
        socket.on("room:state", acceptRoom);
        socket.on("race:prepare", (nextRoom: MultiplayerRoom) => {
          latestTextRef.current = "";
          setTypedText("");
          acceptRoom(nextRoom);
        });
        socket.on("race:progress", ({ player }: { roomCode: string; player: Player }) => {
          setRoom((current) => updatePlayer(current, player));
        });
        socket.on("race:finished", acceptRoom);
        socket.on("room:closed", ({ reason }: { roomCode: string; reason: string }) => {
          window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
          roomRef.current = null;
          setRoom(null);
          setTypedText("");
          setNotice(reason === "creator_left" ? "The room closed because its creator left." : "The room has closed.");
        });
        socket.on("multiplayer:error", ({ message }: { message?: string }) => {
          setError(message || "The multiplayer request was rejected.");
        });
      } catch (connectionError) {
        if (!cancelled) {
          setConnectionStatus("disconnected");
          setError(connectionError instanceof Error ? connectionError.message : "Could not connect to multiplayer.");
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
      if (socket?.connected && roomRef.current?.code) socket.emit("room:leave", {});
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [user.id, acceptRoom]);

  useEffect(() => {
    if (!room || !["countdown", "running"].includes(room.state)) return;
    const interval = window.setInterval(() => setClock(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [room]);

  useEffect(() => {
    const me = room?.players.find((player) => player.id === user.id);
    if (room?.state === "running" && !me?.finished) inputRef.current?.focus({ preventScroll: true });
  }, [room?.state, room?.players, user.id]);

  function emitWithAck<T = MultiplayerRoom>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        reject(new Error("Multiplayer is disconnected. Please wait for it to reconnect."));
        return;
      }
      socket.timeout(8000).emit(event, payload, (timeoutError: Error | null, response: Ack<T>) => {
        if (timeoutError) reject(new Error("The server did not respond. Please try again."));
        else if (!response?.ok) reject(new Error(response?.error || "Request failed."));
        else resolve(response.data);
      });
    });
  }

  async function createRoom() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const nextRoom = await emitWithAck("room:create", {
        format,
        passageType,
        ...(format === "timed" ? { durationSeconds } : { wordCount }),
      });
      acceptRoom(nextRoom);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the room.");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const nextRoom = await emitWithAck("room:join", { code: joinCode.trim().toUpperCase() });
      acceptRoom(nextRoom);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not join the room.");
    } finally {
      setBusy(false);
    }
  }

  async function setReady(ready: boolean) {
    setBusy(true);
    setError("");
    try {
      const nextRoom = await emitWithAck("room:ready", { ready });
      acceptRoom(nextRoom);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update readiness.");
    } finally {
      setBusy(false);
    }
  }

  async function leaveRoom() {
    try {
      await emitWithAck<null>("room:leave", {});
    } catch {
      // Clear the local room even if the socket has already disconnected.
    }
    window.sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    roomRef.current = null;
    setRoom(null);
    setTypedText("");
    latestTextRef.current = "";
    setNotice("");
    setError("");
  }

  function sendProgress(value: string, finished: boolean) {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
    if (finished) {
      progressTimerRef.current = null;
      socket.emit("race:progress", { typedText: value, finished: true });
      return;
    }
    progressTimerRef.current = window.setTimeout(() => {
      socket.emit("race:progress", { typedText: latestTextRef.current });
      progressTimerRef.current = null;
    }, 100);
  }

  const me = room?.players.find((player) => player.id === user.id);
  const passage = room?.race?.passage || "";
  const countdown = room?.state === "countdown" && room.race
    ? Math.max(1, Math.ceil((room.race.startAt - clock) / 1000))
    : null;
  const remainingSeconds = room?.state === "running" && room.race && room.settings.format === "timed"
    ? Math.max(0, (room.race.endAt - clock) / 1000)
    : null;
  const resultPlayers = useMemo(() => room?.result?.players || [], [room?.result]);

  return (
    <section className="space-y-6" aria-labelledby="multiplayer-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="multiplayer-title" className="text-xl font-semibold">Multiplayer race</h2>
          <p className="text-sm text-gray-500">Two signed-in players compete on the same server-timed passage.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${connectionStatus === "connected" ? "bg-green-500/15 text-green-500" : "bg-orange-500/15 text-orange-500"}`}>
          {connectionStatus === "connected" ? "Connected" : connectionStatus === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-blue-500/10 p-3 text-sm text-blue-500">{notice}</p>}

      {!room ? (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4 rounded-lg border border-gray-500/40 p-5">
            <div>
              <h3 className="font-semibold">Create a room</h3>
              <p className="text-sm text-gray-500">Choose the settings, then share the generated code.</p>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Race format</span>
              <select value={format} onChange={(event) => setFormat(event.target.value as RaceFormat)} className="rounded-lg border border-gray-500 bg-transparent px-3 py-2">
                <option value="timed">Timed</option>
                <option value="finish">Finish the passage</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Passage type</span>
              <select value={passageType} onChange={(event) => setPassageType(event.target.value as PassageType)} className="rounded-lg border border-gray-500 bg-transparent px-3 py-2">
                <option value="words">Random words</option>
                <option value="sentences">Natural sentences</option>
              </select>
            </label>
            {format === "timed" ? (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Duration</span>
                <select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} className="rounded-lg border border-gray-500 bg-transparent px-3 py-2">
                  {[15, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
                </select>
              </label>
            ) : (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Word count</span>
                <select value={wordCount} onChange={(event) => setWordCount(Number(event.target.value))} className="rounded-lg border border-gray-500 bg-transparent px-3 py-2">
                  {[25, 50, 100, 200].map((count) => <option key={count} value={count}>{count} words</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={createRoom} disabled={busy || connectionStatus !== "connected"} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? "Creating…" : "Create room"}
            </button>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-500/40 p-5">
            <div>
              <h3 className="font-semibold">Join a room</h3>
              <p className="text-sm text-gray-500">Enter the six-character code from the room creator.</p>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Room code</span>
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6))}
                onKeyDown={(event) => { if (event.key === "Enter" && joinCode.length === 6) void joinRoom(); }}
                maxLength={6}
                placeholder="ABC234"
                autoComplete="off"
                className="rounded-lg border border-gray-500 bg-transparent px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] uppercase"
              />
            </label>
            <button type="button" onClick={joinRoom} disabled={busy || joinCode.length !== 6 || connectionStatus !== "connected"} className="w-full rounded-lg bg-green-700 px-4 py-2 text-white hover:bg-green-800 disabled:opacity-50">
              {busy ? "Joining…" : "Join room"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-500/40 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Room code</p>
              <p className="font-mono text-3xl font-bold tracking-[0.2em]">{room.code}</p>
              <p className="mt-1 text-sm text-gray-500">{roomDescription(room)}</p>
            </div>
            <button type="button" onClick={leaveRoom} className="rounded-lg border border-gray-500 px-4 py-2 text-sm hover:border-red-500 hover:text-red-500">Leave room</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {room.players.map((player) => (
              <article key={player.id} className={`rounded-lg border p-4 ${player.id === user.id ? "border-blue-500" : "border-gray-500/40"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{player.username} {player.id === user.id && <span className="text-xs text-blue-500">(you)</span>}</h3>
                    <p className="text-xs text-gray-500">{player.isCreator ? "Creator" : "Opponent"}</p>
                  </div>
                  <span className={`text-xs ${player.connected ? "text-green-500" : "text-orange-500"}`}>{player.connected ? "Online" : "Reconnecting…"}</span>
                </div>
                {room.state === "waiting" ? (
                  <p className={`mt-4 text-sm font-medium ${player.ready ? "text-green-500" : "text-gray-500"}`}>{player.ready ? "Ready" : "Not ready"}</p>
                ) : (
                  <div className="mt-4 space-y-2 text-sm tabular-nums">
                    <div className="h-2 overflow-hidden rounded-full bg-gray-500/20"><div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, player.progress)}%` }} /></div>
                    <div className="flex flex-wrap justify-between gap-2 text-gray-500"><span>{player.progress.toFixed(0)}%</span><span>{player.adjustedWpm.toFixed(1)} WPM</span><span>{player.accuracy.toFixed(1)}%</span></div>
                    {player.finished && <p className="font-medium text-green-500">Finished</p>}
                  </div>
                )}
              </article>
            ))}
            {room.players.length === 1 && <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-gray-500/40 p-4 text-center text-sm text-gray-500">Waiting for an opponent to join…</div>}
          </div>

          {room.state === "waiting" && (
            <div className="space-y-3 rounded-lg bg-gray-500/10 p-4 text-center">
              <p>{room.players.length < 2 ? "Share the room code with another signed-in player." : "Both players must be ready to start."}</p>
              <button type="button" onClick={() => void setReady(!me?.ready)} disabled={busy || room.players.length < 2 || !me?.connected} className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
                {me?.ready ? "Cancel ready" : "Ready"}
              </button>
            </div>
          )}

          {room.state === "countdown" && <div role="status" className="py-10 text-center"><p className="text-gray-500">Race starts in</p><p className="text-7xl font-bold text-blue-500">{countdown}</p></div>}

          {room.race && ["countdown", "running"].includes(room.state) && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-between gap-3 text-sm">
                <p>{room.state === "countdown" ? "Get ready…" : "Type the passage below."}</p>
                {remainingSeconds !== null && <p className="font-semibold tabular-nums">Time remaining: {remainingSeconds.toFixed(1)}s</p>}
              </div>
              <div className="group relative rounded-lg border border-gray-500 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500">
                <div className="pointer-events-none max-h-72 overflow-y-auto p-6">
                  <p id="multiplayer-passage" className="whitespace-pre-wrap wrap-break-words font-mono text-xl leading-relaxed">
                    {passage.split("").map((character, index) => {
                      const colour = index < typedText.length ? typedText[index] === character ? "text-green-500" : "bg-red-500/20 text-red-500" : "text-gray-500";
                      return <span key={index} className={colour}>{character}</span>;
                    })}
                  </p>
                </div>
                <label htmlFor="multiplayer-input" className="sr-only">Type the multiplayer passage</label>
                <textarea
                  id="multiplayer-input"
                  ref={inputRef}
                  value={typedText}
                  onChange={(event) => {
                    const value = event.target.value.slice(0, passage.length);
                    latestTextRef.current = value;
                    setTypedText(value);
                    sendProgress(value, value.length === passage.length);
                  }}
                  aria-describedby="multiplayer-passage"
                  maxLength={passage.length}
                  disabled={room.state !== "running" || me?.finished || connectionStatus !== "connected"}
                  onPaste={(event) => event.preventDefault()}
                  onDrop={(event) => event.preventDefault()}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  className="absolute inset-0 h-full w-full cursor-text resize-none opacity-0 disabled:cursor-default"
                />
              </div>
            </div>
          )}

          {room.state === "finished" && room.result && (
            <div className="space-y-4 rounded-lg border border-gray-500/40 p-5">
              <div className="text-center">
                <p className="text-sm uppercase tracking-wide text-gray-500">Race finished</p>
                <h3 className="mt-1 text-2xl font-bold">
                  {room.result.isDraw
                    ? "Draw"
                    : room.result.winnerId === user.id
                      ? "You won!"
                      : `${room.players.find((player) => player.id === room.result?.winnerId)?.username || "Your opponent"} won`}
                </h3>
                {room.result.reason === "forfeit" && <p className="text-sm text-orange-500">Result decided by forfeit.</p>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm tabular-nums">
                  <thead className="text-gray-500"><tr><th className="py-2">Player</th><th>Adjusted WPM</th><th>Gross WPM</th><th>Accuracy</th><th>Progress</th></tr></thead>
                  <tbody>
                    {resultPlayers.map((player) => <tr key={player.id} className="border-t border-gray-500/20"><td className="py-2 font-medium">{player.username}</td><td>{player.adjustedWpm.toFixed(1)}</td><td>{player.grossWpm.toFixed(1)}</td><td>{player.accuracy.toFixed(1)}%</td><td>{player.progress.toFixed(0)}%</td></tr>)}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={leaveRoom} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">Create or join another room</button>
              <p className="text-center text-xs text-gray-500">Multiplayer results are temporary and do not affect history or the leaderboard.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
