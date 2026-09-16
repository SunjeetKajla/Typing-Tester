const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const app = require('../app');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('returns all sample results ranked by adjusted WPM', async () => {
  const response = await fetch(`${baseUrl}/api/leaderboard`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { data } = await response.json();
  assert.equal(data.length, 18);
  assert.equal(new Set(data.map((entry) => entry.id)).size, data.length);
  assert.equal(data[0].wpm, 146.8);
  for (let index = 0; index < data.length; index++) {
    assert.equal(data[index].rank, index + 1);
    assert.equal(data[index].wpm, Math.round(data[index].grossWpm * data[index].accuracy / 100 * 10) / 10);
    if (index > 0) assert.ok(data[index - 1].wpm >= data[index].wpm);
  }
});

test('unknown endpoints return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});
