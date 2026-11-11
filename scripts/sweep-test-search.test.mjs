/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The sweep over HTTP against a stand-in engine: what an earlier run left
 *     |                                         | is removed, what a run still going made is kept, the engine's own indices
 *     |                                         | are never touched, and an engine that has refused requests is named.
 * -----------------------------------------------------------------------------
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { report, staleIndices, sweep, STALE_AFTER_MS } from './sweep-test-search.mjs';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

/** A stand-in engine that keeps an index list, answers deletes and reports its memory. */
async function engine(t, { indices, tripped = 0, refuseDelete = [] }) {
  const deleted = [];
  const server = http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url.startsWith('/_cat/indices')) return send(200, indices);
    if (req.method === 'GET' && req.url.startsWith('/_nodes/stats')) {
      return send(200, { nodes: { a: { jvm: { mem: { heap_used_percent: 93, heap_max_in_bytes: 512 * 1048576 } }, breakers: { parent: { tripped } } } } });
    }
    if (req.method === 'DELETE') {
      const name = decodeURIComponent(req.url.slice(1));
      if (refuseDelete.includes(name)) return send(429, { error: 'circuit_breaking_exception' });
      deleted.push(name);
      return send(200, { acknowledged: true });
    }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, deleted };
}

test('only an index older than any run still going counts as left over, and never the engine\'s own', () => {
  const rows = [
    { index: 'ops-rules-old', 'creation.date': String(NOW - 3 * HOUR) },
    { index: 'ops-rules-running', 'creation.date': String(NOW - 10 * 60 * 1000) },
    { index: '.plugins-ml-config', 'creation.date': String(NOW - 30 * HOUR) },
    { index: 'no-date', 'creation.date': '' },
  ];
  assert.deepEqual(staleIndices(rows, NOW), ['ops-rules-old']);
  assert.deepEqual(staleIndices(rows, NOW, 5 * 60 * 1000), ['ops-rules-old', 'ops-rules-running']);
  assert.deepEqual(staleIndices(null, NOW), []);
  assert.equal(STALE_AFTER_MS, 2 * HOUR);
});

test('the sweep removes what earlier runs left and keeps what a run still going made', async (t) => {
  const stand = await engine(t, { indices: [
    { index: 'ops-rules-a', 'creation.date': String(NOW - 5 * HOUR) },
    { index: 'ops-rules-b', 'creation.date': String(NOW - 4 * HOUR) },
    { index: 'ops-rules-now', 'creation.date': String(NOW - 60 * 1000) },
    { index: '.kibana', 'creation.date': String(NOW - 50 * HOUR) },
  ] });
  const result = await sweep(stand.base, { nowMs: NOW });
  assert.deepEqual(result.removed, ['ops-rules-a', 'ops-rules-b']);
  assert.deepEqual(stand.deleted, ['ops-rules-a', 'ops-rules-b']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(report(result), ['test search: removed 2 indices left by earlier runs']);
});

test('an engine that refuses is named with its memory, and a delete it refuses is counted, not thrown', async (t) => {
  const stand = await engine(t, {
    indices: [{ index: 'ops-rules-a', 'creation.date': String(NOW - 5 * HOUR) }], tripped: 721, refuseDelete: ['ops-rules-a'],
  });
  const result = await sweep(stand.base, { nowMs: NOW });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.failed, ['ops-rules-a']);
  assert.equal(result.refused, 721);
  assert.equal(result.heapMb, 512);
  const lines = report(result);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /refused 721 requests for lack of memory/);
  assert.match(lines[1], /93% of 512 MB/);
});

test('a clean engine that has refused nothing says nothing', async (t) => {
  const stand = await engine(t, { indices: [{ index: 'ops-rules-now', 'creation.date': String(NOW - 1000) }] });
  assert.deepEqual(report(await sweep(stand.base, { nowMs: NOW })), []);
});
