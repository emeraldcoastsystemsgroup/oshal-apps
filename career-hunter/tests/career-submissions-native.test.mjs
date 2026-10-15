/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Submissions screen reads only routes the native kernel serves: the caller's
 *   application records (/api/career-hunter/applications) and the dispatcher's worker answer (/api/apply-operator/workers),
 *   never the old platform's /api/apply-operator/queue, /story or /shot. Each record status lands in its lane with what it
 *   is waiting on, and the "dispatcher not connected" answer is said plainly.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const page = readFileSync(fileURLToPath(new URL('../tools/career-submissions.html', import.meta.url)), 'utf8');

/** The page's own native queue mapping, evaluated as shipped. */
function nativeQueue() {
  const block = page.match(/\/\/ NATIVE_QUEUE_START([\s\S]*?)\/\/ NATIVE_QUEUE_END/);
  assert.ok(block, 'the native queue block is present');
  const sandbox = {};
  vm.runInNewContext(`${block[1]};this.queueFromNative=queueFromNative;this.workerFromNative=workerFromNative;`, sandbox);
  return sandbox;
}

test('the screen fetches only routes the native kernel serves', () => {
  const fetched = [...page.matchAll(/fetch\((['`])([^'`]+)/g)].map((m) => m[2]);
  assert.ok(fetched.includes('/api/career-hunter/applications'), 'reads the application records');
  assert.ok(fetched.some((u) => u.startsWith('/api/apply-operator/workers')), 'reads the worker answer');
  for (const url of fetched) assert.doesNotMatch(url, /\/api\/apply-operator\/(queue|story|shot)/, `${url} is not served natively`);
});

test('each record status lands in its lane with what it is waiting on', () => {
  const { queueFromNative } = nativeQueue();
  const q = queueFromNative([
    { ticket_id: 't1', posting_id: 1, title: 'A', status: 'approval_required' },
    { ticket_id: 't2', posting_id: 2, title: 'B', status: 'drafting' },
    { ticket_id: 't3', posting_id: 3, title: 'C', status: 'drafted' },
    { ticket_id: 't4', posting_id: 4, title: 'D', status: 'applied', application_source: 'manual-mark' },
    { ticket_id: null, posting_id: 5, title: 'E', status: 'error' },
    { ticket_id: 't6', posting_id: 6, title: 'F', status: 'denied' },
  ], { available: false, workers: [] });
  assert.deepEqual(q.items.map((i) => i.lane), ['needs_you', 'queued', 'needs_you', 'applied', 'failed', 'dismissed']);
  assert.deepEqual(JSON.parse(JSON.stringify(q.counts)), { needs_you: 2, queued: 1, applied: 1, failed: 1, dismissed: 1 });
  assert.equal(q.items[4].ticketId, 'posting-5', 'a record without a ticket still has a stable row id');
  assert.equal(q.items[3].application_source, 'manual-mark', 'the record provenance reaches the proof renderer');
  assert.match(q.items[0].executionDetail, /approval/);
  assert.equal(queueFromNative(undefined, null).items.length, 0);
});

test('the worker banner says plainly when the dispatcher is not connected', () => {
  const { workerFromNative } = nativeQueue();
  const off = workerFromNative({ available: false, reason: 'application_submission_dispatcher_not_connected', workers: [], observedBrowserNodes: [{ lastSeen: 1791340922958 }] });
  assert.equal(off.available, false);
  assert.equal(off.connected, false);
  assert.match(off.detail, /dispatcher is not connected/);
  assert.equal(off.lastSeenAt, new Date(1791340922958).toISOString());
  assert.equal(workerFromNative({ available: true, workers: [{ clientId: 'c' }] }).connected, true);
  assert.match(workerFromNative(null).detail, /No desktop worker answered/);
});
