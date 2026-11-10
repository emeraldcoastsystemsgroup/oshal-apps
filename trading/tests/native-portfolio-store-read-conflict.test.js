/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A record read that meets another writer's commit mid-scan is read again: production 2026-11-09 15:20Z and 17:20Z, the paper autopilot's strategy lookup failed with "unavailable: conflict: scoped collection revision changed" while the same person's portfolio watcher saved its record in the same minute. Red before the retry (the first conflict was thrown); proves at most two more reads, no retry of any other failure, and a missing record still answers 404.
 */
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const store = require('../routes/trading-portfolio-store');
const strategy = require('../routes/paper/strategy');

/** The kernel's own words when a scan spans two revisions of a scoped collection (crates/control/src/data_snapshot.rs). */
const CONFLICT = 'unavailable: conflict: scoped collection revision changed';

/** A pool that fails its first `failures` queries with `error`, then answers `rows`; it counts every query. */
function pool(failures, rows, error = new Error(CONFLICT)) {
 const seen = {calls: 0};
 return {seen, query: async (text, values) => {
  seen.calls += 1;
  seen.last = {text, values};
  if (seen.calls <= failures) throw error;
  return {rows};
 }};
}
const row = (id) => ({record_id: id, payload: JSON.stringify({strategyId: 'balanced', bookRef: 'b1'}), created_at: '2026-11-09T15:00:00.000Z'});

test('a record read that met another writer mid-scan is read again and answers the record', async () => {
 const p = pool(1, [row('watch:abc')]);
 const record = await store.getRecord({pool: p}, 'owner-1', 'watch', 'watch:abc');
 assert.equal(record.id, 'watch:abc');
 assert.equal(record.strategyId, 'balanced');
 assert.equal(p.seen.calls, 2, 'one more read, no more');
 assert.deepEqual(p.seen.last.values, ['owner-1', 'watch', 'watch:abc'], 'the same owner-bound statement both times');
});

test('the paper autopilot\'s strategy lookup survives the watcher\'s write in the same minute', async () => {
 const p = pool(2, [row('paper-strategy:x')]);
 const assigned = await strategy.assignmentOf({pool: p}, 'owner-1', 'b1');
 assert.equal(assigned.strategyId, 'balanced');
 assert.equal(p.seen.calls, 3);
});

test('a third conflict in a row is the caller\'s, and any other failure is not read again', async () => {
 const busy = pool(3, [row('watch:abc')]);
 await assert.rejects(store.getRecord({pool: busy}, 'owner-1', 'watch', 'watch:abc'), {message: CONFLICT});
 assert.equal(busy.seen.calls, 3);
 const broken = pool(1, [row('watch:abc')], new Error('unavailable: store is down'));
 await assert.rejects(store.getRecord({pool: broken}, 'owner-1', 'watch', 'watch:abc'), /store is down/);
 assert.equal(broken.seen.calls, 1);
});

test('a record that is not there still answers 404 after a conflict, and a strategy-less book still reads as none', async () => {
 const p = pool(1, []);
 await assert.rejects(store.getRecord({pool: p}, 'owner-1', 'watch', 'watch:none'), (error) => error.status === 404);
 assert.equal(p.seen.calls, 2);
 assert.equal(await strategy.assignmentOf({pool: pool(1, [])}, 'owner-1', 'b1'), null);
});
