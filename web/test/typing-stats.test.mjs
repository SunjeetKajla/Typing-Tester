import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureTyping } from '../app/(typing zone)/typing-stats.ts';

test('empty text and a zero-duration start produce finite rates', () => {
  assert.deepEqual(measureTyping('', 'hello', 0), { seconds: 0, grossWpm: 0, errorRate: 0 });
  assert.equal(measureTyping('h', 'hello', 0).grossWpm, 0);
});

test('gross WPM includes incorrect characters and error rate measures mismatches', () => {
  assert.deepEqual(measureTyping('hxllo', 'hello', 3), { seconds: 3, grossWpm: 20, errorRate: 20 });
});

test('pauses lower cumulative WPM without changing the error rate', () => {
  const first = measureTyping('hxllo', 'hello', 3);
  const paused = measureTyping('hxllo', 'hello', 6);
  assert.equal(paused.grossWpm, first.grossWpm / 2);
  assert.equal(paused.errorRate, first.errorRate);
});

test('corrections and deleting all text update the error rate', () => {
  assert.equal(measureTyping('hxllo', 'hello', 3).errorRate, 20);
  assert.equal(measureTyping('hello', 'hello', 4).errorRate, 0);
  assert.deepEqual(measureTyping('', 'hello', 5), { seconds: 5, grossWpm: 0, errorRate: 0 });
});

test('spaces and newlines count as characters and subsecond finishes are supported', () => {
  assert.equal(measureTyping('a b\nc', 'a b\nc', 0.5).grossWpm, 120);
  assert.equal(measureTyping('a b\nc', 'a b\nc', 0.5).errorRate, 0);
});
