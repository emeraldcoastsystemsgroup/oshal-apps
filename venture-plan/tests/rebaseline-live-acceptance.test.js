/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive tests/rebaseline-live-acceptance.mjs, unchanged, against a loopback api and hourly-scheduler double that keeps the routes' contracts (PAT whoami, the kernel services view and system activation, venture create/read/delete, the owner policy, owner-scoped runs and the self spend read) and the package's run semantics (one run per venture and UTC slot, integer-micro cost with the gate checked before each call). It passes only when every done-when holds, fails naming the clause when one does not - including today's kernel answer under a system activation, where the owner-pinned analyst call is refused authorization_execution_identity_required - writes nothing when a precondition is missing, never prints a token, and treats leftover synthetic ventures as a failure.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The double now keeps every charge with its time and answers the spend read over core's trailing whole-hour window, and gains three modes: a cost gate that keeps calling after an overshoot, an activation suspended after the ticks, and an old charge of the second owner that ages out of a 6-hour window while a new one lands. Each makes the walk fail naming costGate, activation and disabledAndDryRun respectively; before this, the walk's later-calls and activation checks could be deleted with every case still green.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HOUR = 3_600_000;
const MINUTE = 60_000;
const PEOPLE = { 'tok-a': { sub: 'sub-a', admin: true }, 'tok-b': { sub: 'sub-b', admin: false } };
const CALL_MICROS = 4_000;

/** @description Load the live script itself; nothing is copied or re-implemented here. */
const live = () => import(pathToFileURL(path.join(__dirname, 'rebaseline-live-acceptance.mjs')).href);

/** A box double: the routes the script calls and an hourly scheduler that fires at :07 on the fake clock. */
class FakeBox {
  constructor(options = {}) {
    this.options = { mode: 'paid', activation: 'active', ...options };
    this.clock = Date.parse(this.options.start ?? '2026-10-02T09:20:00Z');
    this.activation = this.options.activation;
    this.ventures = new Map();
    // Every charge is a timestamped cost event, read back over a trailing window as core does.
    this.charges = [{ sub: 'sub-a', usd: 1.5, at: this.clock - HOUR }, { sub: 'sub-b', usd: 0.75, at: this.clock - HOUR }];
    const old = this.options.oldSecondOwnerCharge;
    if (old) this.charges.push({ sub: 'sub-b', usd: old.usd, at: this.clock - old.hoursBeforeStart * HOUR });
    this.writes = 0;
    this.nextId = 1;
    this.ticks = 0;
  }
  charge(sub, usd) { this.charges.push({ sub, usd, at: this.clock }); }
  /** budget-routes.ts parseSpendQuery floors and clamps the window to 1..720 whole hours; the SQL keeps ts >= now - window. */
  spendOver(sub, rawHours) {
    const parsed = Number(rawHours ?? 24);
    const hours = Number.isFinite(parsed) ? Math.min(720, Math.max(1, Math.floor(parsed))) : 24;
    return this.charges.filter((row) => row.sub === sub && row.at >= this.clock - hours * HOUR).reduce((sum, row) => sum + row.usd, 0);
  }
  now() { return this.clock; }
  async sleep(ms) {
    const target = this.clock + ms;
    let next = Math.floor(this.clock / HOUR) * HOUR + 7 * MINUTE;
    if (next <= this.clock) next += HOUR;
    while (next <= target) { this.clock = next; this.tick(); next += HOUR; }
    this.clock = target;
  }
  tick() {
    if (this.activation !== 'active') return;
    this.ticks += 1;
    if (this.options.secondOwnerCharged) this.charge('sub-b', 0.003);
    const slot = `nightly:${new Date(this.clock).toISOString().slice(0, 10)}`;
    for (const venture of this.ventures.values()) {
      const policy = venture.policy;
      if (!policy || !(policy.enabled || this.options.disabledGetsRun) || (policy.dryRun && !this.options.disabledGetsRun)) continue;
      const already = venture.runs.some((run) => run.scheduleSlot === slot);
      if (already && !(this.options.duplicateSecondTick && venture.runs.length === 1)) continue;
      venture.runs.push(this.run(venture, slot));
    }
    if (this.options.suspendAfterTicks && this.ticks >= 2) this.activation = 'suspended';
  }
  run(venture, slot) {
    const cap = venture.policy.maxCostMicros;
    let spent = 0; let unknown = false;
    const phase = (name) => {
      if (unknown || (spent >= cap && !this.options.gateLeaks)) return { name, status: 'skipped', error: 'rebaseline_cost_cap_blocked' };
      if (this.options.mode === 'identity-refused') { unknown = true; return { name, status: 'failed', error: 'authorization_execution_identity_required' }; }
      spent += CALL_MICROS; this.charge(venture.owner, CALL_MICROS / 1e6);
      return { name, status: 'done', error: null };
    };
    const phases = [phase('bom'), phase('market'), phase('ops'), { name: 'compute', status: 'done', error: null }];
    const costStatus = unknown ? 'capture-failed' : spent > cap ? 'overshot' : spent >= cap ? 'exhausted' : 'within-cap';
    const at = new Date(this.clock).toISOString();
    return { id: `run-${this.nextId++}`, ventureId: venture.id, kind: 'rebaseline', status: 'done', phases, triggerKind: 'scheduled',
      scheduleSlot: slot, costCapMicros: cap, costSpentMicros: spent, costStatus, startedAt: at, finishedAt: at };
  }
  services() {
    const active = this.activation === 'active';
    const suspended = this.activation === 'suspended';
    return { services: [{ id: 'rebaseline-policy-tick', proposedRunsAs: 'system', state: active ? 'active' : suspended ? 'suspended' : 'not-activated',
      ...(active || suspended ? { runsAs: 'system', activatedAt: '2026-10-02T08:00:00.000Z', activatedBy: 'sub-a' } : {}),
      ...(suspended ? { suspendedReason: 'authorization_tier_denied' } : {}),
      requires: this.options.catalogLess ? [] : [{ permission: 'venture.rebaseline', resource: 'venture', effect: 'execute' }] }] };
  }
  activate(person) {
    if (!person.admin) return [403, { error: 'authorization_service_admin_required' }];
    if (this.options.activation409) return [409, { error: 'authorization_service_catalog_required' }];
    this.activation = 'active';
    return [200, { activation: { id: 'act-1', runsAs: 'system', activatedAt: new Date(this.clock).toISOString() } }];
  }
  visible(person, venture) { return venture && (venture.owner === person.sub || this.options.crossRead); }
  ventureRoute(person, method, parts, body) {
    const venture = this.ventures.get(parts[0]);
    if (parts.length === 1 && method === 'GET') return venture && venture.owner === person.sub ? [200, { venture }] : [404, { error: 'not found' }];
    if (parts.length === 1 && method === 'DELETE') {
      if (!venture || venture.owner !== person.sub) return [404, { error: 'not found' }];
      if (this.options.deleteFails) return [500, { error: 'delete failed' }];
      this.ventures.delete(parts[0]); this.writes += 1; return [200, { ok: true }];
    }
    if (parts[1] === 'rebaseline-policy' && method === 'PUT') {
      if (!venture || venture.owner !== person.sub) return [404, { error: 'not found' }];
      venture.policy = { ...body }; this.writes += 1; return [200, { policy: venture.policy }];
    }
    if (parts[1] === 'runs' && method === 'GET') return this.visible(person, venture) ? [200, { runs: [...venture.runs].reverse() }] : [404, { error: 'not found' }];
    return [404, { error: 'fixture_not_found' }];
  }
  handle(person, method, url, body) {
    if (url.pathname === '/api/cli-tokens/whoami') return [200, { sub: person.sub }];
    if (url.pathname === '/api/swarm/apps/venture-plan/services') return [200, this.services()];
    if (url.pathname === '/api/swarm/apps/venture-plan/services/rebaseline-policy-tick/activate' && method === 'POST') return this.activate(person);
    if (url.pathname === '/api/budgets/spend') {
      return url.searchParams.get('scope') === `user:${person.sub}`
        ? [200, { success: true, spendUsd: this.spendOver(person.sub, url.searchParams.get('windowHours')) }] : [403, { success: false }];
    }
    if (url.pathname === '/api/venture/ventures' && method === 'GET') return [200, { ventures: [...this.ventures.values()].filter((v) => v.owner === person.sub) }];
    if (url.pathname === '/api/venture/ventures' && method === 'POST') {
      const venture = { id: `v-${this.nextId++}`, owner: person.sub, name: body.name, ideaText: body.idea, createdAt: new Date(this.clock).toISOString(), runs: [] };
      this.ventures.set(venture.id, venture); this.writes += 1; this.charge(person.sub, 0.001);
      return [201, { venture }];
    }
    const runRead = /^\/api\/venture\/runs\/(.+)$/.exec(url.pathname);
    if (runRead) {
      const owner = [...this.ventures.values()].find((v) => v.runs.some((r) => r.id === runRead[1]));
      return this.visible(person, owner) ? [200, { run: owner.runs.find((r) => r.id === runRead[1]) }] : [404, { error: 'not found' }];
    }
    const ventureRoute = /^\/api\/venture\/ventures\/(.+)$/.exec(url.pathname);
    return ventureRoute ? this.ventureRoute(person, method, ventureRoute[1].split('/'), body) : [404, { error: 'fixture_not_found' }];
  }
}

/** @description Serve a box double on loopback for one run of the live script. */
async function serve(box) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const person = PEOPLE[String(req.headers.authorization || '').replace(/^Bearer /, '')];
      const [status, body] = person ? box.handle(person, req.method, new URL(req.url, 'http://fixture'), raw ? JSON.parse(raw) : undefined)
        : [401, { error: 'not_authenticated' }];
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** @description Run the live script once against a fresh box double. */
async function walk(boxOptions = {}, runOptions = {}) {
  const { runAcceptance } = await live();
  const box = new FakeBox(boxOptions);
  const api = await serve(box);
  try {
    const result = await runAcceptance({ base: api.base, operatorToken: 'tok-a', secondToken: 'tok-b', allowPaid: true,
      now: () => box.now(), sleep: (ms) => box.sleep(ms), pollMs: MINUTE, ...runOptions });
    return { result, box };
  } finally { await api.close(); }
}

test('every done-when holds: one run per slot, the late venture proves the second tick, the gate stops later calls, no spend for the non-spending owner, isolation, clean exit', async () => {
  const { result, box } = await walk();
  assert.equal(result.state, 'pass', JSON.stringify(result));
  const { clauses } = result.evidence;
  assert.deepEqual(Object.entries(clauses).map(([name, verdict]) => [name, verdict.ok]),
    [['oneRunPerSlot', true], ['costGate', true], ['disabledAndDryRun', true], ['isolation', true], ['activation', true]]);
  assert.deepEqual([clauses.oneRunPerSlot.costSpentMicros, clauses.oneRunPerSlot.costStatus], [12_000, 'within-cap']);
  assert.deepEqual([clauses.costGate.costSpentMicros, clauses.costGate.costCapMicros, clauses.costGate.phases],
    [4_000, 1, { bom: 'done', market: 'skipped', ops: 'skipped', compute: 'done' }]);
  assert.equal(clauses.disabledAndDryRun.secondOwnerSpendDeltaUsd, 0);
  assert.equal(clauses.isolation.crossReadsRefused, 4);
  assert.ok(Date.parse(result.evidence.ticks.second) - Date.parse(result.evidence.ticks.first) === HOUR, 'two consecutive hourly ticks');
  assert.deepEqual([result.cleanup.deleted, result.cleanup.residue, box.ventures.size], [5, [], 0]);
  assert.equal(JSON.stringify(result).includes('tok-a') || JSON.stringify(result).includes('tok-b'), false, 'no token is ever reported');
});

test("today's kernel under a system activation: the owner-pinned analyst call is refused, so the walk fails naming it, still judges every other clause and cleans up", async () => {
  const { result, box } = await walk({ mode: 'identity-refused' });
  assert.equal(result.state, 'fail');
  assert.match(result.detail, /oneRunPerSlot: .*bom=failed \(authorization_execution_identity_required\)/);
  assert.match(result.detail, /costGate: the cost gate did not record an overshoot \(capture-failed, 0 of 1\)/);
  assert.deepEqual(Object.entries(result.evidence.clauses).map(([name, verdict]) => [name, verdict.ok]),
    [['oneRunPerSlot', false], ['costGate', false], ['disabledAndDryRun', true], ['isolation', true], ['activation', true]]);
  assert.deepEqual([result.cleanup.residue, box.ventures.size], [[], 0]);
});

test('a missing precondition writes nothing: no consent to pay, no second caller, a late UTC hour, an inactive service, an older install', async () => {
  for (const [boxOptions, runOptions, pattern] of [
    [{}, { allowPaid: false }, /--allow-paid/],
    [{}, { secondToken: '' }, /OSHAL_VERIFY_SECOND_PAT/],
    [{ start: '2026-10-02T21:30:00Z' }, {}, /straddle the UTC date/],
    [{ activation: 'none' }, {}, /activates it as a system service/],
    [{ catalogLess: true }, {}, /install 1\.5\.0/],
  ]) {
    const { result, box } = await walk(boxOptions, runOptions);
    assert.equal(result.state, 'unavailable', JSON.stringify(result));
    assert.match(result.detail, pattern);
    assert.equal(box.writes, 0, `nothing was written: ${result.detail}`);
  }
});

test('--activate makes the system activation when it is missing, and a 409 there fails before anything is seeded', async () => {
  const made = await walk({ activation: 'none' }, { activate: true });
  assert.deepEqual([made.result.state, made.result.evidence.activation.madeHere], ['pass', true]);
  const refused = await walk({ activation: 'none', activation409: true }, { activate: true });
  assert.equal(refused.result.state, 'fail');
  assert.match(refused.result.detail, /answered 409 authorization_service_catalog_required/);
  assert.equal(refused.box.writes, 0);
});

test('each broken clause fails by name: a second run in one slot, a run on the disabled venture, a cross-owner read, a charge to the non-spending owner, a cleanup that leaves residue', async () => {
  for (const [boxOptions, pattern] of [
    [{ duplicateSecondTick: true }, /has 2 scheduled runs after two ticks/],
    [{ disabledGetsRun: true }, /the disabled venture has runs/],
    [{ crossRead: true }, /a cross-owner read was answered/],
    [{ secondOwnerCharged: true }, /the second owner spent/],
    [{ deleteFails: true }, /cleanup left synthetic ventures behind/],
  ]) {
    const { result } = await walk(boxOptions);
    assert.equal(result.state, 'fail', JSON.stringify(result.detail));
    assert.match(result.detail, pattern);
  }
});

/** @description Each clause's verdict, in judging order. */
const verdicts = (result) => Object.entries(result.evidence.clauses).map(([name, verdict]) => [name, verdict.ok]);

test('a gate that keeps calling after an overshoot fails costGate, and an activation suspended after the ticks fails activation', async () => {
  const leaking = await walk({ gateLeaks: true });
  assert.equal(leaking.result.state, 'fail');
  assert.match(leaking.result.detail, /costGate: after the overshoot the later calls were not stopped: \{"bom":"done","market":"done","ops":"done","compute":"done"\}/);
  assert.deepEqual(verdicts(leaking.result),
    [['oneRunPerSlot', true], ['costGate', false], ['disabledAndDryRun', true], ['isolation', true], ['activation', true]]);
  const suspended = await walk({ suspendAfterTicks: true });
  assert.equal(suspended.result.state, 'fail');
  assert.match(suspended.result.detail, /activation: after the ticks rebaseline-policy-tick is suspended \(authorization_tier_denied\)/);
  assert.deepEqual(verdicts(suspended.result),
    [['oneRunPerSlot', true], ['costGate', true], ['disabledAndDryRun', true], ['isolation', true], ['activation', false]]);
  assert.deepEqual([leaking.box.ventures.size, suspended.box.ventures.size], [0, 0]);
});

test('an old charge ageing out of a fixed window cannot hide a new one: the second reading widens by the hours elapsed', async () => {
  const old = { usd: 0.05, hoursBeforeStart: 5.5 }; // inside the 6-hour baseline window, outside a 6-hour window two hours later
  const hidden = await walk({ oldSecondOwnerCharge: old, secondOwnerCharged: true });
  assert.equal(hidden.result.state, 'fail');
  assert.match(hidden.result.detail, /disabledAndDryRun: the second owner spent 0\.00(5|6)\d* USD across the ticks/);
  assert.deepEqual(hidden.result.evidence.clauses.disabledAndDryRun.evidence.windowHours, 8, 'six hours plus the two started hours since the baseline');
  const quiet = await walk({ oldSecondOwnerCharge: old });
  assert.equal(quiet.result.state, 'pass', JSON.stringify(quiet.result.detail));
  assert.deepEqual([quiet.result.evidence.clauses.disabledAndDryRun.secondOwnerSpendDeltaUsd, quiet.result.evidence.clauses.disabledAndDryRun.afterWindowHours], [0, 8]);
});

test('seeding waits out the minutes around :07 so the first tick sees every venture', async () => {
  const { result, box } = await walk({ start: '2026-10-02T09:05:00Z' });
  assert.equal(result.state, 'pass', JSON.stringify(result));
  assert.ok(Date.parse(result.evidence.seededAt) >= Date.parse('2026-10-02T09:10:00Z'), result.evidence.seededAt);
  assert.equal(result.evidence.ticks.first, '2026-10-02T10:07:00.000Z');
  assert.equal(box.ventures.size, 0);
});

test('tokens are read by name, from the environment first and then the env file, and never from a missing file', async () => {
  const { readNamedToken } = await live();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venture-live-env-'));
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'OTHER=1\nOSHAL_VERIFY_SECOND_PAT="pat-from-file"\r\n');
    assert.equal(readNamedToken({ OSHAL_VERIFY_SECOND_PAT: 'pat-from-env', OSHAL_VERIFY_ENV_FILE: file }, 'OSHAL_VERIFY_SECOND_PAT'), 'pat-from-env');
    assert.equal(readNamedToken({ OSHAL_VERIFY_ENV_FILE: file }, 'OSHAL_VERIFY_SECOND_PAT'), 'pat-from-file');
    assert.equal(readNamedToken({ OSHAL_VERIFY_ENV_FILE: file }, 'OSHAL_VERIFY_OPERATOR_PAT'), '');
    assert.equal(readNamedToken({ OSHAL_VERIFY_ENV_FILE: path.join(dir, 'missing') }, 'OSHAL_VERIFY_SECOND_PAT'), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
