const { Server } = require('socket.io');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('../database');
const { RoomManager } = require('./room-manager');
const { verifySocketToken } = require('./token');

function acknowledgement(callback, operation) {
  Promise.resolve()
    .then(operation)
    .then((data) => callback?.({ ok: true, data }))
    .catch((error) => callback?.({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }));
}

function createMultiplayerServer(httpServer, {
  config = process.env,
  database = getDatabase,
  roomManagerOptions = {},
} = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.WEB_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 20_000,
  });

  const manager = new RoomManager({
    ...roomManagerOptions,
    onRoomState: (code, payload) => io.to(code).emit('room:state', payload),
    onPrepare: (code, payload) => io.to(code).emit('race:prepare', payload),
    onProgress: (code, payload) => io.to(code).emit('race:progress', payload),
    onFinished: (code, payload) => io.to(code).emit('race:finished', payload),
    onClosed: (code, payload) => io.to(code).emit('room:closed', payload),
  });

  io.use(async (socket, next) => {
    const claims = verifySocketToken(socket.handshake.auth?.token, config.SESSION_SECRET);
    if (!claims || !ObjectId.isValid(claims.sub)) return next(new Error('Authentication required.'));
    try {
      const db = await database();
      const user = await db.collection('users').findOne({ _id: new ObjectId(claims.sub) });
      if (!user) return next(new Error('Authentication required.'));
      socket.data.user = { id: user._id.toString(), username: user.username, name: user.name };
      return next();
    } catch {
      return next(new Error('Multiplayer is temporarily unavailable.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    let lastProgressAt = 0;

    socket.on('room:create', (payload, callback) => acknowledgement(callback, () => {
      const state = manager.create(user, payload, socket.id);
      socket.join(state.code);
      socket.data.roomCode = state.code;
      return state;
    }));

    socket.on('room:join', (payload, callback) => acknowledgement(callback, () => {
      const state = manager.join(user, payload?.code, socket.id);
      socket.join(state.code);
      socket.data.roomCode = state.code;
      io.to(state.code).emit('room:state', state);
      return state;
    }));

    socket.on('room:rejoin', (payload, callback) => acknowledgement(callback, () => {
      const state = manager.rejoin(user, payload?.code, socket.id);
      socket.join(state.code);
      socket.data.roomCode = state.code;
      io.to(state.code).emit('room:state', state);
      return state;
    }));

    socket.on('room:ready', (payload, callback) => acknowledgement(callback, () => (
      manager.setReady(user.id, payload?.ready !== false)
    )));

    socket.on('race:progress', (payload) => {
      const now = Date.now();
      const text = payload?.typedText;
      if (typeof text !== 'string') {
        socket.emit('multiplayer:error', { message: 'Invalid typing progress.' });
        return;
      }
      if (now - lastProgressAt < 60 && payload?.finished !== true) return;
      lastProgressAt = now;
      try {
        manager.updateProgress(user.id, text);
      } catch (error) {
        socket.emit('multiplayer:error', { message: error instanceof Error ? error.message : 'Progress was rejected.' });
      }
    });

    socket.on('room:leave', (_payload, callback) => acknowledgement(callback, () => {
      const code = manager.leave(user.id, socket.data.roomCode);
      if (code) socket.leave(code);
      socket.data.roomCode = undefined;
      return null;
    }));

    socket.on('disconnect', () => manager.disconnect(user.id, socket.id));
  });

  return { io, manager };
}

module.exports = { createMultiplayerServer };
