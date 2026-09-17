const crypto = require('node:crypto');
const { generateSentences, generateWords } = require('../routes/passages');

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TIMED_DURATIONS = new Set([15, 30, 60]);
const FINISH_WORD_COUNTS = new Set([25, 50, 100, 200]);
const WAITING_LIMIT_MS = 10 * 60 * 1000;
const FINISH_LIMIT_MS = 10 * 60 * 1000;
const COUNTDOWN_MS = 3000;
const DISCONNECT_GRACE_MS = 15000;
const FINISH_GRACE_MS = 30000;
const CLOSED_RETENTION_MS = 60000;

function validateSettings(value) {
  if (!value || typeof value !== 'object') return 'Race settings are required.';
  if (!['timed', 'finish'].includes(value.format)) return 'Format must be timed or finish.';
  if (!['words', 'sentences'].includes(value.passageType)) return 'Passage type must be words or sentences.';
  if (value.format === 'timed' && !TIMED_DURATIONS.has(value.durationSeconds)) {
    return 'Timed races must be 15, 30, or 60 seconds.';
  }
  if (value.format === 'finish' && !FINISH_WORD_COUNTS.has(value.wordCount)) {
    return 'Finish races must contain 25, 50, 100, or 200 words.';
  }
  return null;
}

function calculateMetrics(typedText, passage, elapsedSeconds) {
  const errors = typedText.split('').filter((character, index) => character !== passage[index]).length;
  const correctCharacters = typedText.length - errors;
  const accuracy = typedText.length > 0 ? correctCharacters / typedText.length * 100 : 0;
  const grossWpm = elapsedSeconds > 0 ? (typedText.length / 5) / (elapsedSeconds / 60) : 0;
  return {
    accuracy,
    adjustedWpm: grossWpm * accuracy / 100,
    correctCharacters,
    grossWpm,
  };
}

function compareNumber(left, right) {
  const difference = left - right;
  return Math.abs(difference) < 0.0001 ? 0 : Math.sign(difference);
}

class RoomManager {
  constructor({
    now = () => Date.now(),
    passageFactory = (type, wordCount) => type === 'words' ? generateWords(wordCount) : generateSentences(wordCount),
    randomIndex = (maximum) => crypto.randomInt(maximum),
    schedule = (callback, delay) => {
      const timer = setTimeout(callback, delay);
      timer.unref?.();
      return timer;
    },
    cancel = clearTimeout,
    onRoomState = () => {},
    onPrepare = () => {},
    onProgress = () => {},
    onFinished = () => {},
    onClosed = () => {},
  } = {}) {
    this.rooms = new Map();
    this.activeRoomByUser = new Map();
    this.now = now;
    this.passageFactory = passageFactory;
    this.randomIndex = randomIndex;
    this.schedule = schedule;
    this.cancel = cancel;
    this.onRoomState = onRoomState;
    this.onPrepare = onPrepare;
    this.onProgress = onProgress;
    this.onFinished = onFinished;
    this.onClosed = onClosed;
  }

  generateCode() {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      let code = '';
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_ALPHABET[this.randomIndex(ROOM_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Unable to allocate a room code.');
  }

  create(user, settings, socketId) {
    if (this.activeRoomByUser.has(user.id)) throw new Error('Leave your current room before creating another one.');
    const settingsError = validateSettings(settings);
    if (settingsError) throw new Error(settingsError);

    const code = this.generateCode();
    const room = {
      code,
      creatorId: user.id,
      settings: Object.freeze({
        format: settings.format,
        passageType: settings.passageType,
        ...(settings.format === 'timed'
          ? { durationSeconds: settings.durationSeconds }
          : { wordCount: settings.wordCount }),
      }),
      state: 'waiting',
      createdAt: this.now(),
      passage: null,
      startAt: null,
      endAt: null,
      result: null,
      players: new Map(),
      timers: new Set(),
    };
    room.players.set(user.id, this.createPlayer(user, true, socketId));
    this.rooms.set(code, room);
    this.activeRoomByUser.set(user.id, code);
    room.waitingTimer = this.setRoomTimer(room, () => this.closeRoom(room, 'expired'), WAITING_LIMIT_MS);
    return this.publicRoom(room);
  }

  join(user, rawCode, socketId) {
    if (this.activeRoomByUser.has(user.id)) throw new Error('Leave your current room before joining another one.');
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('Enter a valid six-character room code.');
    const room = this.rooms.get(code);
    if (!room || room.state !== 'waiting') throw new Error('That room is unavailable or has already started.');
    if (room.players.size >= 2) throw new Error('That room is full.');
    if (room.players.has(user.id)) throw new Error('You are already in this room.');

    room.players.set(user.id, this.createPlayer(user, false, socketId));
    this.activeRoomByUser.set(user.id, code);
    this.onRoomState(room.code, this.publicRoom(room));
    return this.publicRoom(room);
  }

  rejoin(user, rawCode, socketId) {
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    const player = room?.players.get(user.id);
    if (!room || !player) throw new Error('That room is no longer available.');
    const activeCode = this.activeRoomByUser.get(user.id);
    if (activeCode && activeCode !== code) throw new Error('You are already active in another room.');

    player.socketIds.add(socketId);
    player.connected = true;
    if (player.disconnectTimer) {
      this.cancel(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    if (room.state !== 'finished') this.activeRoomByUser.set(user.id, code);
    this.onRoomState(room.code, this.publicRoom(room));
    return this.publicRoom(room);
  }

  setReady(userId, ready = true) {
    const room = this.getActiveRoom(userId);
    if (room.state !== 'waiting') throw new Error('The race has already started.');
    const player = room.players.get(userId);
    player.ready = Boolean(ready);
    this.onRoomState(room.code, this.publicRoom(room));

    if (room.players.size === 2 && [...room.players.values()].every((entry) => entry.ready && entry.connected)) {
      this.beginCountdown(room);
    }
    return this.publicRoom(room);
  }

  beginCountdown(room) {
    if (room.state !== 'waiting') return;
    if (room.waitingTimer) {
      this.cancel(room.waitingTimer);
      room.timers.delete(room.waitingTimer);
      room.waitingTimer = null;
    }
    const wordCount = room.settings.format === 'timed'
      ? { 15: 100, 30: 200, 60: 400 }[room.settings.durationSeconds]
      : room.settings.wordCount;
    room.passage = this.passageFactory(room.settings.passageType, wordCount);
    room.state = 'countdown';
    room.startAt = this.now() + COUNTDOWN_MS;
    room.endAt = room.settings.format === 'timed'
      ? room.startAt + room.settings.durationSeconds * 1000
      : room.startAt + FINISH_LIMIT_MS;
    const payload = this.publicRoom(room);
    this.onPrepare(room.code, payload);
    this.onRoomState(room.code, payload);

    this.setRoomTimer(room, () => {
      if (room.state !== 'countdown') return;
      room.state = 'running';
      this.onRoomState(room.code, this.publicRoom(room));
      const delay = room.settings.format === 'timed'
        ? room.settings.durationSeconds * 1000
        : FINISH_LIMIT_MS;
      this.setRoomTimer(room, () => this.finishRace(room, 'timeout'), delay);
    }, COUNTDOWN_MS);
  }

  updateProgress(userId, typedText) {
    const room = this.getActiveRoom(userId);
    const now = this.now();
    if (room.state !== 'running' || now < room.startAt) throw new Error('The race has not started yet.');
    if (typeof typedText !== 'string' || typedText.length > room.passage.length || typedText.length > 10000) {
      throw new Error('Invalid typing progress.');
    }
    if (room.settings.format === 'timed' && now >= room.endAt) {
      this.finishRace(room, 'timeout');
      return this.publicRoom(room);
    }

    const player = room.players.get(userId);
    if (now - player.lastProgressAt < 50 && typedText.length !== room.passage.length) {
      throw new Error('Typing progress is arriving too quickly.');
    }
    player.lastProgressAt = now;
    player.typedText = typedText;
    if (typedText.length === room.passage.length && player.completedAt === null) {
      player.completedAt = now;
    }
    const payload = { roomCode: room.code, player: this.publicPlayer(room, player, now) };
    this.onProgress(room.code, payload);

    if (room.settings.format === 'finish' && player.completedAt !== null) {
      const completed = [...room.players.values()].filter((entry) => entry.completedAt !== null);
      if (completed.length === 2) {
        this.finishRace(room, 'completed');
      } else if (completed.length === 1 && !room.firstFinishTimer) {
        room.firstFinishTimer = this.setRoomTimer(room, () => this.finishRace(room, 'timeout'), FINISH_GRACE_MS);
      }
    }
    return this.publicRoom(room);
  }

  disconnect(userId, socketId) {
    const code = this.activeRoomByUser.get(userId);
    if (!code) return;
    const room = this.rooms.get(code);
    const player = room?.players.get(userId);
    if (!room || !player) return;
    player.socketIds.delete(socketId);
    if (player.socketIds.size > 0) return;
    player.connected = false;
    this.onRoomState(room.code, this.publicRoom(room));
    player.disconnectTimer = this.setRoomTimer(room, () => this.handleDisconnectExpiry(room, player), DISCONNECT_GRACE_MS);
  }

  handleDisconnectExpiry(room, player) {
    player.disconnectTimer = null;
    if (player.connected || room.state === 'finished') return;
    if (room.state === 'running' || room.state === 'countdown') {
      const opponent = [...room.players.values()].find((entry) => entry.id !== player.id && entry.connected);
      if (opponent) this.finishRace(room, 'forfeit', opponent.id);
      else this.closeRoom(room, 'disconnected');
      return;
    }
    if (player.isCreator) {
      this.closeRoom(room, 'creator_left');
    } else {
      room.players.delete(player.id);
      this.activeRoomByUser.delete(player.id);
      this.onRoomState(room.code, this.publicRoom(room));
    }
  }

  leave(userId, requestedCode) {
    const code = requestedCode || this.activeRoomByUser.get(userId);
    const room = this.rooms.get(code);
    const player = room?.players.get(userId);
    if (!room || !player) return null;

    if (room.state === 'running' || room.state === 'countdown') {
      const opponent = [...room.players.values()].find((entry) => entry.id !== userId);
      if (opponent) this.finishRace(room, 'forfeit', opponent.id);
      else this.closeRoom(room, 'player_left');
    } else if (room.state === 'waiting' && player.isCreator) {
      this.closeRoom(room, 'creator_left');
    } else if (room.state === 'waiting') {
      room.players.delete(userId);
      this.activeRoomByUser.delete(userId);
      this.onRoomState(room.code, this.publicRoom(room));
    }
    return room.code;
  }

  finishRace(room, reason, forcedWinnerId = null) {
    if (!room || !['running', 'countdown'].includes(room.state)) return;
    const now = this.now();
    room.state = 'finished';

    const ranked = [...room.players.values()].map((player) => {
      const elapsedUntil = player.completedAt || Math.min(now, room.endAt || now);
      const elapsedSeconds = Math.max(0.1, (elapsedUntil - room.startAt) / 1000);
      return {
        id: player.id,
        username: player.username,
        name: player.name,
        completed: player.completedAt !== null,
        ...calculateMetrics(player.typedText, room.passage, elapsedSeconds),
        elapsedSeconds,
        progress: room.passage.length ? player.typedText.length / room.passage.length * 100 : 0,
      };
    });

    let winnerId = forcedWinnerId;
    if (!winnerId && ranked.length === 2) {
      const [left, right] = ranked;
      let comparison = 0;
      if (room.settings.format === 'finish' && left.completed !== right.completed) {
        comparison = left.completed ? 1 : -1;
      } else {
        comparison = compareNumber(left.adjustedWpm, right.adjustedWpm) ||
          compareNumber(left.accuracy, right.accuracy) ||
          (room.settings.format === 'timed' ? compareNumber(left.correctCharacters, right.correctCharacters) : 0);
      }
      winnerId = comparison > 0 ? left.id : comparison < 0 ? right.id : null;
    }

    room.result = { reason, winnerId, isDraw: winnerId === null, players: ranked, finishedAt: now };
    for (const player of room.players.values()) this.activeRoomByUser.delete(player.id);
    const payload = this.publicRoom(room);
    this.onFinished(room.code, payload);
    this.onRoomState(room.code, payload);
    this.setRoomTimer(room, () => this.closeRoom(room, 'closed'), CLOSED_RETENTION_MS);
  }

  closeRoom(room, reason) {
    if (!room || !this.rooms.has(room.code)) return;
    for (const player of room.players.values()) {
      this.activeRoomByUser.delete(player.id);
      if (player.disconnectTimer) this.cancel(player.disconnectTimer);
    }
    for (const timer of room.timers) this.cancel(timer);
    room.timers.clear();
    this.rooms.delete(room.code);
    this.onClosed(room.code, { roomCode: room.code, reason });
  }

  createPlayer(user, isCreator, socketId) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      isCreator,
      ready: false,
      connected: true,
      socketIds: new Set([socketId]),
      disconnectTimer: null,
      typedText: '',
      completedAt: null,
      lastProgressAt: Number.NEGATIVE_INFINITY,
    };
  }

  publicPlayer(room, player, now = this.now()) {
    const elapsedUntil = player.completedAt || Math.min(now, room.endAt || now);
    const elapsedSeconds = room.startAt ? Math.max(0.1, (elapsedUntil - room.startAt) / 1000) : 0;
    const metrics = room.passage
      ? calculateMetrics(player.typedText, room.passage, elapsedSeconds)
      : { accuracy: 0, adjustedWpm: 0, correctCharacters: 0, grossWpm: 0 };
    return {
      id: player.id,
      username: player.username,
      name: player.name,
      isCreator: player.isCreator,
      ready: player.ready,
      connected: player.connected,
      finished: player.completedAt !== null,
      charsTyped: player.typedText.length,
      progress: room.passage?.length ? player.typedText.length / room.passage.length * 100 : 0,
      ...metrics,
    };
  }

  publicRoom(room) {
    return {
      code: room.code,
      state: room.state,
      creatorId: room.creatorId,
      settings: room.settings,
      players: [...room.players.values()].map((player) => this.publicPlayer(room, player)),
      race: room.passage ? { passage: room.passage, startAt: room.startAt, endAt: room.endAt } : null,
      result: room.result,
    };
  }

  getActiveRoom(userId) {
    const code = this.activeRoomByUser.get(userId);
    const room = code ? this.rooms.get(code) : null;
    if (!room || !room.players.has(userId)) throw new Error('Join a room first.');
    return room;
  }

  setRoomTimer(room, callback, delay) {
    let timer;
    timer = this.schedule(() => {
      room.timers.delete(timer);
      callback();
    }, Math.max(0, delay));
    room.timers.add(timer);
    return timer;
  }
}

module.exports = {
  CLOSED_RETENTION_MS,
  COUNTDOWN_MS,
  DISCONNECT_GRACE_MS,
  FINISH_GRACE_MS,
  FINISH_LIMIT_MS,
  ROOM_ALPHABET,
  RoomManager,
  TIMED_DURATIONS,
  FINISH_WORD_COUNTS,
  calculateMetrics,
  validateSettings,
};
