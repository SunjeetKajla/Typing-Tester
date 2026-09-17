const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('../database');
const { createSessionHandler } = require('../session');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateResult(body = {}) {
  const { attemptId, ownerId, mode, passage, typedText, elapsedSeconds, completedAt } = body;

  if (typeof attemptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
    return 'attemptId must be a valid UUID.';
  }
  if (ownerId !== null && ownerId !== undefined && !ObjectId.isValid(ownerId)) {
    return 'ownerId must be a valid user ID when provided.';
  }
  if (!['practice', 'test'].includes(mode)) {
    return 'mode must be practice or test.';
  }
  if (typeof passage !== 'string' || passage.length === 0 || passage.length > 10000) {
    return 'passage must contain between 1 and 10000 characters.';
  }
  if (typeof typedText !== 'string' || typedText.length !== passage.length) {
    return 'typedText must contain exactly one character for every passage character.';
  }
  if (!isFiniteNumber(elapsedSeconds) || elapsedSeconds < 0.1 || elapsedSeconds > 3600) {
    return 'elapsedSeconds must be between 0.1 and 3600.';
  }
  const completedDate = new Date(completedAt);
  if (typeof completedAt !== 'string' || Number.isNaN(completedDate.getTime())) {
    return 'completedAt must be a valid date.';
  }
  const now = Date.now();
  if (completedDate.getTime() > now + 5 * 60 * 1000 || completedDate.getTime() < now - 365 * 24 * 60 * 60 * 1000) {
    return 'completedAt is outside the accepted range.';
  }
  return null;
}

function calculateResult({ passage, typedText, elapsedSeconds }) {
  const errors = typedText.split('').filter((character, index) => character !== passage[index]).length;
  const accuracy = ((typedText.length - errors) / typedText.length) * 100;
  const grossWpm = (typedText.length / 5) / (elapsedSeconds / 60);
  const wpm = grossWpm * (accuracy / 100);
  return { grossWpm, accuracy, wpm };
}

function createResultsRouter({ config = process.env, database = getDatabase, store } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Anonymous POSTs without a session cookie fail fast as 401 without touching the DB.
  router.post('/', (req, res, next) => {
    if (!req.headers.cookie?.includes('typing.sid=')) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to save results.' } });
    }
    next();
  });

  // Anonymous history reads don't need a session or DB connection.
  router.get('/me', (req, res, next) => {
    if (!req.headers.cookie?.includes('typing.sid=')) return res.json({ data: [] });
    next();
  });

  router.use(createSessionHandler({ config, database, store }));

  router.post('/', async (req, res) => {
    if (!req.session?.userId || !ObjectId.isValid(req.session.userId)) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to save results.' } });
    }

    const validationError = validateResult(req.body);
    if (validationError) {
      return res.status(400).json({ error: { code: 'INVALID_RESULT', message: validationError } });
    }

    const { attemptId, ownerId, mode, passage, typedText, elapsedSeconds, completedAt } = req.body;

    try {
      const db = await database();
      const user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
      if (!user) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to save results.' } });
      }
      if (ownerId && ownerId !== user._id.toString()) {
        return res.status(403).json({ error: { code: 'WRONG_OWNER', message: 'This result belongs to another account.' } });
      }

      const { grossWpm, accuracy, wpm } = calculateResult({ passage, typedText, elapsedSeconds });
      if (grossWpm > 300) {
        return res.status(400).json({ error: { code: 'INVALID_RESULT', message: 'The calculated typing speed exceeds the accepted limit.' } });
      }
      const doc = {
        attemptId,
        userId: user._id,
        name: user.name,
        username: user.username,
        mode,
        grossWpm,
        accuracy,
        wpm,
        elapsedSeconds,
        charsTyped: typedText.length,
        passageLength: passage.length,
        completedAt: new Date(completedAt),
        receivedAt: new Date(),
      };
      const collection = db.collection('test_results');
      await collection.createIndex(
        { attemptId: 1 },
        { unique: true, partialFilterExpression: { attemptId: { $type: 'string' } } },
      );
      const saved = await collection.findOneAndUpdate(
        { attemptId },
        { $setOnInsert: doc },
        { upsert: true, returnDocument: 'after' },
      );
      if (!saved || saved.userId?.toString() !== user._id.toString()) {
        return res.status(403).json({ error: { code: 'WRONG_OWNER', message: 'This result belongs to another account.' } });
      }

      return res.status(200).json({
        data: {
          id: user._id.toString(),
          resultId: saved._id.toString(),
          name: user.name,
          username: user.username,
          mode: saved.mode,
          grossWpm: saved.grossWpm,
          accuracy: saved.accuracy,
          wpm: saved.wpm,
          completedAt: saved.completedAt,
        },
      });
    } catch {
      return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Could not save the result. Please try again.' } });
    }
  });

  router.get('/me', async (req, res) => {
    if (!req.headers.cookie?.includes('typing.sid=')) return res.json({ data: [] });
    if (!req.session?.userId || !ObjectId.isValid(req.session.userId)) return res.json({ data: [] });

    try {
      const db = await database();
      const results = await db.collection('test_results')
        .find({ userId: new ObjectId(req.session.userId) })
        .sort({ completedAt: -1, receivedAt: -1, createdAt: -1 })
        .limit(50)
        .toArray();
      return res.json({
        data: results.map((entry) => ({
          resultId: entry._id.toString(),
          mode: entry.mode || 'practice',
          grossWpm: entry.grossWpm,
          accuracy: entry.accuracy,
          wpm: entry.wpm ?? Math.round(entry.grossWpm * entry.accuracy / 100 * 10) / 10,
          elapsedSeconds: entry.elapsedSeconds,
          completedAt: entry.completedAt || entry.createdAt || entry.receivedAt,
        })),
      });
    } catch {
      return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Could not load your results.' } });
    }
  });

  return router;
}

module.exports = { calculateResult, createResultsRouter, validateResult };
