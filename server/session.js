const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { getClient, getDatabase } = require('./database');

function getCookieOptions(config = process.env) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
  };
}

// Shared session middleware so /api/auth and /api/results read the same
// `typing.sid` cookie from the same Mongo `sessions` collection.
function createSessionHandler({ config = process.env, database = getDatabase, store } = {}) {
  const cookieOptions = getCookieOptions(config);
  let middlewarePromise;

  return async (req, res, next) => {
    if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32) {
      return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    }
    try {
      if (!middlewarePromise) {
        middlewarePromise = (async () => {
          let sessionStore = store;
          if (!sessionStore) {
            const db = await database();
            await db.collection('users').createIndex({ googleId: 1 }, { unique: true }).catch(() => {});
            await db.collection('test_results').createIndex({ userId: 1, completedAt: -1 }).catch(() => {});
            await db.collection('test_results').createIndex(
              { attemptId: 1 },
              { unique: true, partialFilterExpression: { attemptId: { $type: 'string' } } },
            ).catch(() => {});
            await db.collection('test_results').createIndex({ mode: 1, wpm: -1, accuracy: -1 }).catch(() => {});
            sessionStore = MongoStore.create({
              clientPromise: getClient(),
              dbName: db.databaseName,
              collectionName: 'sessions',
            });
            sessionStore.on('error', () => console.error('MongoDB session store error.'));
          }
          return session({
            name: 'typing.sid',
            secret: config.SESSION_SECRET,
            store: sessionStore,
            resave: false,
            saveUninitialized: false,
            cookie: { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 },
          });
        })().catch((error) => {
          middlewarePromise = undefined;
          throw error;
        });
      }
      const middleware = await middlewarePromise;
      middleware(req, res, next);
    } catch {
      return res.status(503).json({ error: 'Sign-in is temporarily unavailable.' });
    }
  };
}

module.exports = { createSessionHandler, getCookieOptions };
