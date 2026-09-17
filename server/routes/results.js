const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('../database');
const { createSessionHandler } = require('../session');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateResult(body = {}) {
  const { grossWpm, accuracy, elapsedSeconds, charsTyped, passageLength } = body;

  if (!isFiniteNumber(grossWpm) || grossWpm < 0 || grossWpm > 300) {
    return 'grossWpm must be a number between 0 and 300.';
  }
  if (!isFiniteNumber(accuracy) || accuracy < 0 || accuracy > 100) {
    return 'accuracy must be a number between 0 and 100.';
  }
  if (!isFiniteNumber(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds > 3600) {
    return 'elapsedSeconds must be a number greater than 0.';
  }
  for (const [key, value] of [['charsTyped', charsTyped], ['passageLength', passageLength]]) {
    if (value !== undefined && value !== null && (!Number.isInteger(value) || value <= 0 || value > 10000)) {
      return `${key} must be a positive integer when provided.`;
    }
  }
  return null;
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

    const { grossWpm, accuracy, elapsedSeconds, charsTyped, passageLength } = req.body;

    try {
      const db = await database();
      const user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
      if (!user) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to save results.' } });
      }

      const wpm = Math.round((grossWpm * accuracy / 100) * 10) / 10;
      const doc = {
        userId: user._id,
        name: user.name,
        username: user.username,
        grossWpm,
        accuracy,
        wpm,
        elapsedSeconds,
        charsTyped: charsTyped ?? null,
        passageLength: passageLength ?? null,
        createdAt: new Date(),
      };
      await db.collection('test_results').createIndex({ userId: 1, wpm: -1, accuracy: -1 }).catch(() => {});
      const inserted = await db.collection('test_results').insertOne(doc);

      return res.status(201).json({
        data: {
          id: user._id.toString(),
          resultId: inserted.insertedId.toString(),
          name: user.name,
          username: user.username,
          grossWpm,
          accuracy,
          wpm,
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
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      return res.json({
        data: results.map((entry) => ({
          resultId: entry._id.toString(),
          grossWpm: entry.grossWpm,
          accuracy: entry.accuracy,
          wpm: entry.wpm ?? Math.round(entry.grossWpm * entry.accuracy / 100 * 10) / 10,
          elapsedSeconds: entry.elapsedSeconds,
          createdAt: entry.createdAt,
        })),
      });
    } catch {
      return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Could not load your results.' } });
    }
  });

  return router;
}

module.exports = { createResultsRouter, validateResult };
