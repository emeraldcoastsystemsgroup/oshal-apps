/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reproduce concurrent Create writes with real durable authorization sharing the deployed two-client pool budget.
 */
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { setImmediate as turn } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { concurrencyFixture } from './project-concurrency.fixture';
import { acquireProjectWrite, PROJECT_WRITE_QUEUE } from '../../src-routes/create-project-write-gate';
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof concurrencyFixture>>;
beforeAll(async () => { fixture = await concurrencyFixture(work => cleanup.push(work)); });
afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
  expect(fixture.db.evidence.cleanupVerified).toBe(true);
  if (process.env.OSHAL_CREATE_CONCURRENCY_RECEIPT) writeFileSync(process.env.OSHAL_CREATE_CONCURRENCY_RECEIPT,
    JSON.stringify({ fixture: 'create-concurrency', ...fixture.db.evidence, poolMax: 2 }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ fixture: 'create-concurrency', ...fixture.db.evidence }));
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it('both owners can create concurrently without starving real final authorization in a max-two pool', async () => {
  fixture.observed.state.delayMs = 200;
  const replies = await Promise.all([fixture.call('Alice concurrent', 'alice'), fixture.call('Bob concurrent', 'bob')]);
  expect(replies.map(reply => reply.status), JSON.stringify(replies)).toEqual([201, 201]);
  expect(fixture.observed.state.checkoutFailures).toBe(0);
  expect(fixture.observed.state.maxWrites).toBe(1);
  expect(fixture.db.pool.options.max).toBe(2);
  expect((await fixture.db.admin.query('SELECT COUNT(*)::int AS count FROM create_projects')).rows[0].count).toBe(2);
});

it('revocation while queued rejects before checkout and releases admission for the next writer', async () => {
  fixture.observed.state.delayMs = 0;
  const release = await acquireProjectWrite(fixture.observed.pool), before = fixture.observed.state.revisionWrites;
  const ready = signal(), original = fixture.runtime.authorize.bind(fixture.runtime);
  let calls = 0;
  const observed = vi.spyOn(fixture.runtime, 'authorize').mockImplementation(async (actor, operation) => {
    const decision = await original(actor, operation);
    if (actor.sub === 'bob' && operation.permission === 'project.create' && ++calls === 2) ready.resolve();
    return decision;
  });
  const pending = fixture.call('Revoked in queue', 'bob');
  try {
    await ready.promise; await turn();
    await fixture.change('bob', 'revoke'); release();
    expect((await pending).status).toBe(403);
    expect(fixture.observed.state.revisionWrites).toBe(before);
  } finally { release(); observed.mockRestore(); await pending; }
  await fixture.change('bob', 'grant');
  expect((await fixture.call('After queued rejection', 'bob')).status).toBe(201);
});

it('real revocation after insertion still rolls back and releases the two-client pool', async () => {
  const entered = signal(), resume = signal();
  const before = (await fixture.db.admin.query('SELECT COUNT(*)::int AS count FROM create_projects')).rows[0].count;
  fixture.observed.state.onRevision = async () => { entered.resolve(); await resume.promise; };
  const pending = fixture.call('Revoked before commit', 'alice');
  try {
    await entered.promise;
    await fixture.change('alice', 'revoke'); resume.resolve();
    expect((await pending).status).toBe(403);
    expect((await fixture.db.admin.query('SELECT COUNT(*)::int AS count FROM create_projects')).rows[0].count).toBe(before);
    expect((await fixture.db.admin.query('SELECT COUNT(*)::int AS count FROM create_project_revisions')).rows[0].count).toBe(before);
  } finally { resume.resolve(); fixture.observed.state.onRevision = undefined; await pending; }
  expect(fixture.observed.state.activeWrites).toBe(0);
  expect((await fixture.call('After rollback', 'bob')).status).toBe(201);
});

it('writer admission is FIFO, bounded by count and time, and reusable after rejected waiters', async () => {
  const pool = { connect: async () => { throw new Error('Admission must not check out a client'); } };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const release = await acquireProjectWrite(pool);
  try {
    const waiting = Array.from({ length: PROJECT_WRITE_QUEUE.maximum }, () => acquireProjectWrite(pool)
      .then(unlock => ({ unlock, error: '' }), error => ({ unlock: undefined, error: error.code })));
    await expect(acquireProjectWrite(pool)).rejects.toMatchObject({ status: 503, code: 'project_write_queue_full' });
    release(); const first = await waiting[0]; expect(first.unlock).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(PROJECT_WRITE_QUEUE.timeoutMs);
    expect((await Promise.all(waiting.slice(1))).every(row => row.error === 'project_write_queue_timeout')).toBe(true);
    first.unlock!(); first.unlock!();
    const fresh = await acquireProjectWrite(pool); fresh();
  } finally { release(); vi.useRealTimers(); }
});
