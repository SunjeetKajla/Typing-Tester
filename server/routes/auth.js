const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { OAuth2Client } = require('google-auth-library');
const { randomBytes } = require('node:crypto');
const { ObjectId } = require('mongodb');
const { getClient, getDatabase } = require('../database');

function createAuthRouter({ config = process.env, database = getDatabase, store, googleClient } = {}) {
  const router = express.Router();
  const webUrl = config.WEB_URL || 'http://localhost:3000';
  const callbackUrl = config.GOOGLE_REDIRECT_URI || `${webUrl}/api/auth/google/callback`;
  const google = googleClient || new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, callbackUrl);
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', path: '/' };
  const fail = (res, reason) => res.redirect(`${webUrl}/?auth_error=${reason}`);
  let sessionMiddleware;

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  // Anonymous page loads don't need a database connection or a session cookie.
  router.get('/me', (req, res, next) => {
    if (!req.headers.cookie?.includes('typing.sid=')) return res.json({ user: null });
    next();
  });

  router.use(async (req, res, next) => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.SESSION_SECRET || config.SESSION_SECRET.length < 32) {
      return req.path.startsWith('/google') ? fail(res, 'configuration') : res.status(503).json({ error: 'Sign-in is not configured yet.' });
    }
    try {
      if (!sessionMiddleware) {
        sessionMiddleware = (async () => {
          let sessionStore = store;
          if (!sessionStore) {
            const db = await database();
            await db.collection('users').createIndex({ googleId: 1 }, { unique: true });
            sessionStore = MongoStore.create({
              clientPromise: getClient(), dbName: db.databaseName, collectionName: 'sessions',
            });
            sessionStore.on('error', () => console.error('MongoDB session store error.'));
          }
          return session({
            name: 'typing.sid', secret: config.SESSION_SECRET, store: sessionStore,
            resave: false, saveUninitialized: false,
            cookie: { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 },
          });
        })().catch((error) => { sessionMiddleware = undefined; throw error; });
      }
      const middleware = await sessionMiddleware;
      middleware(req, res, next);
    } catch {
      return req.path.startsWith('/google') ? fail(res, 'database') : res.status(503).json({ error: 'Sign-in is temporarily unavailable.' });
    }
  });

  router.get('/google', async (req, res) => {
    const { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
    const state = randomBytes(32).toString('hex');
    const nonce = randomBytes(32).toString('hex');
    req.session.oauth = { state, nonce, codeVerifier, createdAt: Date.now() };
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    res.redirect(google.generateAuthUrl({
      scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account',
      code_challenge: codeChallenge, code_challenge_method: 'S256',
    }));
  });

  router.get('/google/callback', async (req, res) => {
    const pending = req.session.oauth;
    delete req.session.oauth;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));

    if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return fail(res, 'expired');
    }
    if (req.query.error) return fail(res, 'cancelled');
    if (typeof req.query.code !== 'string') return fail(res, 'google');

    try {
      const { tokens } = await google.getToken({ code: req.query.code, codeVerifier: pending.codeVerifier });
      if (!tokens.id_token) return fail(res, 'google');
      const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || !profile.email_verified || profile.nonce !== pending.nonce) return fail(res, 'google');

      const db = await database();
      const now = new Date();
      const user = await db.collection('users').findOneAndUpdate(
        { googleId: profile.sub },
        {
          $set: { name: profile.name || 'Typist', email: profile.email, picture: profile.picture || null, lastLoginAt: now },
          $setOnInsert: { googleId: profile.sub, username: profile.name || profile.email.split('@')[0], createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
      // Rotate the session ID after authentication; never store Google tokens in it.
      await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
      req.session.userId = user._id.toString();
      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      res.redirect(`${webUrl}/`);
    } catch {
      fail(res, 'google');
    }
  });

  router.get('/me', async (req, res) => {
    if (!req.session.userId || !ObjectId.isValid(req.session.userId)) return res.json({ user: null });
    const db = await database();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
    res.json({ user: user ? { id: user._id.toString(), username: user.username, name: user.name } : null });
  });

  router.post('/logout', async (req, res) => {
    if (req.get('origin') !== new URL(webUrl).origin) return res.status(403).json({ error: 'Invalid request origin.' });
    await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
    res.clearCookie('typing.sid', cookieOptions);
    res.json({ user: null });
  });

  router.use((error, req, res, next) => {
    // OAuth exceptions can include credentials; don't log raw errors.
    if (req.path.startsWith('/google')) return fail(res, 'unavailable');
    res.status(503).json({ error: 'Sign-in is temporarily unavailable.' });
  });
  return router;
}

module.exports = { createAuthRouter };
