const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const session = require('express-session');
const { ObjectId } = require('mongodb');
const { OAuth2Client } = require('google-auth-library');
const { createAuthRouter } = require('../routes/auth');

async function fixture(context, overrides = {}) {
  const config = {
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/auth/google/callback',
    WEB_URL: 'http://localhost:3000', SESSION_SECRET: 'test-only-secret-at-least-32-characters',
  };
  const users = new Map();
  let nonce;
  let exchanges = 0;
  const google = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI);
  const googleClient = {
    generateCodeVerifierAsync: () => google.generateCodeVerifierAsync(),
    generateAuthUrl: (options) => { nonce = options.nonce; return google.generateAuthUrl(options); },
    getToken: async ({ codeVerifier }) => {
      exchanges++;
      assert.ok(codeVerifier.length >= 43);
      return { tokens: { id_token: 'test-token' } };
    },
    verifyIdToken: async ({ audience }) => {
      assert.equal(audience, config.GOOGLE_CLIENT_ID);
      return { getPayload: () => ({ sub: 'google-user-1', name: 'Test Typist', email: 'typist@example.com', email_verified: true, nonce, ...overrides.profile }) };
    },
  };
  const database = async () => ({
    collection: () => ({
      findOneAndUpdate: async (filter, update) => {
        const user = { ...(users.get(filter.googleId) || { _id: new ObjectId(), ...update.$setOnInsert }), ...update.$set };
        users.set(filter.googleId, user);
        return user;
      },
      findOne: async ({ _id }) => [...users.values()].find((user) => user._id.equals(_id)),
    }),
  });
  const app = express();
  app.use('/api/auth', createAuthRouter({ config, store: new session.MemoryStore(), database, googleClient }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  let cookie = '';
  async function request(path, options = {}) {
    const response = await fetch(base + path, { redirect: 'manual', ...options, headers: { cookie, ...options.headers } });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  }
  async function begin() {
    const response = await request('/google');
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('redirect_uri'), config.GOOGLE_REDIRECT_URI);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state'));
    assert.ok(url.searchParams.get('nonce'));
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
    return url.searchParams.get('state');
  }
  return { request, begin, users, exchanges: () => exchanges, cookie: () => cookie };
}

test('anonymous requests do not create a session', async (context) => {
  const app = await fixture(context);
  const response = await app.request('/me');
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('Google callback creates a user, rotates the session, restores identity and signs out', async (context) => {
  const app = await fixture(context);
  const state = await app.begin();
  const oldCookie = app.cookie();
  const callback = await app.request(`/google/callback?state=${state}&code=valid`);
  assert.equal(callback.headers.get('location'), 'http://localhost:3000/');
  assert.notEqual(app.cookie(), oldCookie);
  assert.equal(app.users.size, 1);
  const result = await (await app.request('/me')).json();
  assert.equal(result.user.username, 'Test Typist');
  assert.equal(result.user.email, undefined);
  const again = await app.begin();
  await app.request(`/google/callback?state=${again}&code=valid`);
  assert.equal(app.users.size, 1, 'Returning users should be updated, not duplicated');
  const forbidden = await app.request('/logout', { method: 'POST', headers: { origin: 'https://other.example' } });
  assert.equal(forbidden.status, 403);
  assert.ok((await (await app.request('/me')).json()).user);
  const logout = await app.request('/logout', { method: 'POST', headers: { origin: 'http://localhost:3000' } });
  assert.equal(logout.status, 200);
  assert.deepEqual(await (await app.request('/me')).json(), { user: null });
});

test('missing or mismatched state prevents token exchange', async (context) => {
  const app = await fixture(context);
  await app.begin();
  const response = await app.request('/google/callback?state=wrong&code=valid');
  assert.equal(response.headers.get('location'), 'http://localhost:3000/?auth_error=expired');
  assert.equal(app.exchanges(), 0);
  assert.equal(app.users.size, 0);
});

test('OAuth cancellation returns to the app without creating a user', async (context) => {
  const app = await fixture(context);
  const state = await app.begin();
  const response = await app.request(`/google/callback?state=${state}&error=access_denied`);
  assert.equal(response.headers.get('location'), 'http://localhost:3000/?auth_error=cancelled');
  assert.equal(app.users.size, 0);
});

test('an invalid nonce or unverified email cannot create an account', async (context) => {
  for (const profile of [{ nonce: 'wrong' }, { email_verified: false }]) {
    const app = await fixture(context, { profile });
    const state = await app.begin();
    const response = await app.request(`/google/callback?state=${state}&code=valid`);
    assert.equal(response.headers.get('location'), 'http://localhost:3000/?auth_error=google');
    assert.equal(app.users.size, 0);
  }
});

test('a completed callback cannot be replayed', async (context) => {
  const app = await fixture(context);
  const state = await app.begin();
  await app.request(`/google/callback?state=${state}&code=valid`);
  const replay = await app.request(`/google/callback?state=${state}&code=valid`);
  assert.equal(replay.headers.get('location'), 'http://localhost:3000/?auth_error=expired');
  assert.equal(app.exchanges(), 1);
});
