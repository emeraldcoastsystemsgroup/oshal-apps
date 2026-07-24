/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-17 11:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Ops-primitive tests: retry-with-backoff semantics (transient-only, injectable sleep), vendor-error classification, hard timeout, and semaphore FIFO bounding. Plain node against the compiled routes/portrait-ops.js.
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const ops = require(path.join(__dirname, '..', 'routes', 'portrait-ops.js'));

module.exports = async function run() {
  const noSleep = () => Promise.resolve();

  // withRetries: succeeds after two transient failures.
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw new Error('RATE_LIMITED');
    return 'ok';
  };
  assert.strictEqual(await ops.withRetries(flaky, ops.isTransientVendorError, { sleep: noSleep }), 'ok');
  assert.strictEqual(calls, 3, 'expected exactly 3 attempts');

  // withRetries: permanent errors throw immediately (no retry).
  calls = 0;
  await assert.rejects(
    ops.withRetries(async () => { calls++; throw new Error('HTTP 400 bad request'); }, ops.isTransientVendorError, { sleep: noSleep }),
    /HTTP 400/,
  );
  assert.strictEqual(calls, 1, 'permanent error must not retry');

  // withRetries: exhausts attempts then throws the last transient error.
  calls = 0;
  await assert.rejects(
    ops.withRetries(async () => { calls++; throw new Error('HTTP 503 unavailable'); }, ops.isTransientVendorError, { sleep: noSleep, attempts: 3 }),
    /HTTP 503/,
  );
  assert.strictEqual(calls, 3, 'expected all attempts consumed');

  // Classification table.
  assert.ok(ops.isTransientVendorError(new Error('RATE_LIMITED')));
  assert.ok(ops.isTransientVendorError(new Error('openrouter image provider: HTTP 502 bad gateway')));
  assert.ok(ops.isTransientVendorError(new Error('fetch failed')));
  assert.ok(ops.isTransientVendorError(new Error('image generation timed out after 120000ms')));
  assert.ok(!ops.isTransientVendorError(new Error('HTTP 401 unauthorized')));
  assert.ok(!ops.isTransientVendorError(new Error('HTTP 400 content refused')));

  // withTimeout: fast work passes through, slow work rejects with the label.
  assert.strictEqual(await ops.withTimeout(Promise.resolve(42), 1000, 'fast'), 42);
  await assert.rejects(
    ops.withTimeout(new Promise((r) => setTimeout(r, 200)), 20, 'slow thing'),
    /slow thing timed out after 20ms/,
  );

  // Semaphore: bounds concurrency at the limit, FIFO wakeup.
  const sem = new ops.Semaphore(2);
  const order = [];
  const hold = async (name, ms) => {
    await sem.acquire();
    order.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`end:${name}`);
    sem.release();
  };
  const t1 = hold('a', 40);
  const t2 = hold('b', 40);
  const t3 = hold('c', 10); // must wait for a slot
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(sem.active, 2, 'semaphore must cap at 2');
  assert.ok(!order.includes('start:c'), 'third task must be waiting');
  await Promise.all([t1, t2, t3]);
  assert.strictEqual(order.filter((e) => e.startsWith('start:')).length, 3);
  assert.strictEqual(sem.active, 0, 'all slots released');

  assert.throws(() => new ops.Semaphore(0), /limit must be >= 1/);

  return 7;
};
