/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | Verify deterministic Gmail mailbox watches and TotalConnect security monitoring: native-kernel SQL cleanliness, manifest/persona/schedule/briefing contracts, preset/custom query matching, security category classification, forced-RLS cross-user isolation on disposable PostgreSQL, hit_key deduplication (quiet second check emits empty report), live Gmail warming + offline fallback, and Home summary active-watch tiles.
 * 2   | maintainer@emeraldcoastsystemsgroup.com    | 1.8.1: verify GET /api/email-watches executes zero writes under a read-only pool (even with EMAIL_DEFAULT_WATCHES=totalconnect set) and answers 200 empty on 42P01 missing table, while POST /check seeds EMAIL_DEFAULT_WATCHES once and preserves enabled: false.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
process.env.NODE_PATH = [TOOLCHAIN, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@/features/personal-data') {
    return {
      isEncrypted: (v) => typeof v === 'string' && v.startsWith('opd1:'),
      encryptField: async (_u, v) => `opd1:${Buffer.from(v).toString('base64')}`,
      decryptField: async (_u, v) => Buffer.from(String(v).slice(5), 'base64').toString('utf8'),
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

const express = require('express');
const yaml = require('js-yaml');
const { Pool, Client } = require('pg');
const DSN = process.env.OSHAL_TEST_POSTGRES;
if (!DSN) throw new Error('OSHAL_TEST_POSTGRES must name the disposable PostgreSQL server for this suite');

const watchStore = require('../routes/mail-watches-store.js');
const { createMailWatchRoutes } = require('../routes/mail-watches.js');
const { createHomeSummaryRoutes } = require('../routes/home-summary.js');

const MIGRATIONS = ['001-email-mail-store.sql', '003-email-digests.sql', '004-email-sync-gap.sql', '005-email-watches.sql']
  .map((name) => fs.readFileSync(path.join(PKG, 'migrations', name), 'utf8'));

test('migration 005, route modules, manifest and persona satisfy native-kernel contracts', () => {
  const stripComments = (txt, re) => txt.split('\n').filter((line) => !re.test(line.trim())).join('\n');
  const mig005 = fs.readFileSync(path.join(PKG, 'migrations', '005-email-watches.sql'), 'utf8');
  assert.doesNotMatch(stripComments(mig005, /^--/), /ON CONFLICT|ORDER BY|DISTINCT|\bOFFSET\b/i);
  for (const rel of ['routes/mail-watches-store.js', 'routes/mail-watches.js']) {
    const js = fs.readFileSync(path.join(PKG, rel), 'utf8');
    assert.doesNotMatch(stripComments(js, /^(\*|\/\*|\/\/)/), /ON CONFLICT|ORDER BY|DISTINCT|\bOFFSET\b/i);
  }
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  assert.ok(manifest.migrations.includes('migrations/005-email-watches.sql'));
  assert.ok(manifest.uses.includes('jarvis-briefings'));
  const route = manifest.routes.find((r) => r.mountPath === '/api/email-watches');
  assert.ok(route && route.auth === 'oidc' && route.requiresAi === false);
  const sched = manifest.schedules.find((s) => s.id === 'mail-watches');
  assert.ok(sched && sched.cron === '*/5 * * * *' && sched.runsAs === 'user' && sched.route === '/api/email-watches/check' && sched.report === true);
  const brief = manifest.briefings.find((b) => b.id === 'mailbox-watches');
  assert.ok(brief && brief.sessionId === 'mail-watches');
  for (const toolName of ['email-watches', 'email-watch-check', 'email-watch-save']) {
    assert.ok(manifest.tools.some((t) => t.name === toolName), `missing tool ${toolName}`);
  }
  const persona = yaml.load(fs.readFileSync(path.join(PKG, 'personas', 'email-summarizer.yaml'), 'utf8'));
  assert.match(persona.perspective, /email-watch-save/);
  assert.ok(persona.routing_keywords.includes('totalconnect'));
});

test('TotalConnect query matcher and deterministic category classifier cover security alerts', () => {
  const clauses = watchStore.parseWatchQuery(watchStore.PRESETS.totalconnect.query);
  const hits = [
    { sender: 'TotalConnect <donotreply@alarmnet.com>', subject: 'Home Status', snippet: 'Event notification' },
    { sender: 'Alerts <noreply@notify.totalconnect2.com>', subject: 'Panel update', snippet: 'Zone 2' },
    { sender: 'Comfort <alerts@mytotalconnectcomfort.com>', subject: 'Thermostat', snippet: ' Offline' },
    { sender: 'Resideo <security@resideo.com>', subject: 'Security notice', snippet: 'Armed' },
    { sender: 'Forwarded <owner@example.com>', subject: 'Fwd: Total Connect Alert', snippet: 'Front door' },
    { sender: 'Forwarded <owner@example.com>', subject: 'Notice', snippet: 'TotalConnect panel armed stay' },
    { sender: 'Forwarded <owner@example.com>', subject: 'Notice', snippet: 'TotConnect sensor activity' },
  ];
  for (const msg of hits) assert.equal(watchStore.matchesWatchMessage(clauses, msg), true, `expected match: ${msg.sender} / ${msg.subject}`);
  const aliasNorm = watchStore.normalizeWatchInput({ preset: 'totconnect', accountHint: 'owner@example.com' });
  assert.equal(aliasNorm.ok, true);
  assert.equal(aliasNorm.value.watchId, 'totalconnect');
  assert.equal(aliasNorm.value.label, 'TotalConnect Security Monitor');
  assert.equal(watchStore.matchesWatchMessage(clauses, { sender: 'Promo <deals@fakealarmnet.com>', subject: 'Sale today', snippet: 'Save 20%' }), false);
  assert.equal(watchStore.classifyWatchCategory('Burglary Alarm - Front Door', 'Zone 1 triggered'), 'alarm');
  assert.equal(watchStore.classifyWatchCategory('Sensor notification', 'Low battery on Zone 4'), 'trouble');
  assert.equal(watchStore.classifyWatchCategory('Panel status', 'System Disarmed by User 1'), 'disarmed');
  assert.equal(watchStore.classifyWatchCategory('Panel status', 'System Armed Away'), 'armed');
  assert.equal(watchStore.classifyWatchCategory('Home Event', 'Garage door opened'), 'sensor');
  assert.equal(watchStore.classifyWatchCategory('Account Notice', 'Monthly statement ready'), 'activity');
});

/** Provision a disposable forced-RLS PostgreSQL database and per-user pools. */
async function createFixtureDb(t) {
  const name = `email_watches_${crypto.randomBytes(6).toString('hex')}`;
  const role = `${name}_rt`;
  const admin = new Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(DSN);
  url.pathname = `/${name}`;
  const owner = new Pool({ connectionString: url.toString(), max: 2 });
  for (const sql of MIGRATIONS) await owner.query(sql);
  await owner.query(MIGRATIONS[3]); // idempotent 005 re-run
  await owner.query(
    `CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN;
     GRANT USAGE ON SCHEMA public TO ${role};
     GRANT SELECT, INSERT, UPDATE, DELETE ON oshal_email_messages, oshal_email_sync, oshal_email_digests, oshal_email_watches, oshal_email_watch_hits TO ${role};
     GRANT ${role} TO CURRENT_USER`,
  );
  const asUser = (sub) => new Pool({ connectionString: url.toString(), max: 2, options: `-c role=${role} -c oshal.current_sub=${sub}` });
  const pools = { alice: asUser('alice'), bob: asUser('bob') };
  t.after(async () => {
    for (const p of [owner, pools.alice, pools.bob]) await p.end();
    for (let i = 0; i < 40; i += 1) {
      const open = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [name]);
      if (open.rows[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });
  return pools;
}

/** Start a loopback Express app dispatching per-request user pools for alice and bob. */
async function startFixtureServer(t, pools, gmailState) {
  const muxPool = {
    query: (sql, params) => {
      const target = pools[gmailState.activeSub];
      if (!target) throw new Error('unbound user pool');
      return target.query(sql, params);
    },
  };
  const ctx = {
    pool: muxPool,
    get gmailReader() { return gmailState.reader; },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const sub = req.headers['x-test-sub'];
    if (sub) {
      gmailState.activeSub = String(sub);
      req.oidc = { isAuthenticated: () => true, user: { sub: String(sub) } };
    }
    next();
  });
  app.use('/api/email-watches', createMailWatchRoutes(ctx));
  app.use('/api/email-summarizer/home-summary', createHomeSummaryRoutes(ctx));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, urlPath, sub, body) => {
    const headers = { 'content-type': 'application/json' };
    if (sub) headers['x-test-sub'] = sub;
    const res = await fetch(`${base}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
}

test('watch CRUD, validation and forced-RLS isolation keep each person strictly separated', async (t) => {
  const pools = await createFixtureDb(t);
  const call = await startFixtureServer(t, pools, { activeSub: 'alice', reader: null });

  assert.equal((await call('GET', '/api/email-watches', null)).status, 401);
  assert.equal((await call('POST', '/api/email-watches', 'alice', { preset: 'unknown' })).status, 400);
  assert.equal((await call('POST', '/api/email-watches', 'alice', { watchId: 'BAD ID!', label: 'X', query: 'abc' })).status, 400);

  const created = await call('POST', '/api/email-watches', 'alice', { preset: 'totalconnect', accountHint: 'owner@example.com' });
  assert.equal(created.status, 200);
  assert.equal(created.body.created, true);
  assert.equal(created.body.watch.watchId, 'totalconnect');
  assert.equal(created.body.watch.label, 'TotalConnect Security Monitor');
  assert.equal(created.body.watch.accountHint, 'owner@example.com');

  const updated = await call('POST', '/api/email-watches', 'alice', { preset: 'totalconnect', accountHint: 'owner@example.com', label: 'TotalConnect Home Security' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.created, false);
  assert.equal(updated.body.watch.label, 'TotalConnect Home Security');

  const bobList = await call('GET', '/api/email-watches', 'bob');
  assert.deepEqual(bobList.body.watches, []);
  assert.equal((await call('DELETE', '/api/email-watches/totalconnect', 'bob')).status, 404);

  const aliceList = await call('GET', '/api/email-watches', 'alice');
  assert.equal(aliceList.body.watches.length, 1);
  assert.ok(aliceList.body.presets.some((p) => p.id === 'totalconnect'));

  await call('POST', '/api/email-watches', 'alice', { watchId: 'vip-alerts', label: 'VIP Alerts', query: 'from:vip@example.org' });
  assert.equal((await call('DELETE', '/api/email-watches/vip-alerts', 'alice')).status, 200);
  assert.equal((await call('GET', '/api/email-watches', 'alice')).body.watches.length, 1);
});

test('POST /check deduplicates hits, warms live Gmail rows, falls back offline, and updates Home summary', async (t) => {
  const pools = await createFixtureDb(t);
  const now = Date.now();
  const insertStored = (pool, sub, id, sender, subject, snippet, msAgo) =>
    pool.query(
      'INSERT INTO oshal_email_messages (msg_key, user_sub, provider, message_id, sender, subject, snippet, labels, search_text, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [`${sub}|google|${id}`, sub, 'google', id, sender, subject, snippet, 'INBOX', `${sender} ${subject} ${snippet}`.toLowerCase(), new Date(now - msAgo).toISOString()],
    );

  await insertStored(pools.alice, 'alice', 'm-alarm-1', 'TotalConnect <donotreply@alarmnet.com>', 'Intrusion Alarm: Patio Door', 'Zone 3 triggered', 120000);
  await insertStored(pools.alice, 'alice', 'm-noise-1', 'Store <news@retail.test>', 'Weekend sale', 'Save on shoes', 90000);
  await insertStored(pools.bob, 'bob', 'm-bob-1', 'Resideo <alerts@resideo.com>', 'Fire Alarm', 'Bob house', 60000);

  const gmailState = {
    activeSub: 'alice',
    reader: {
      list: async () => ['m-live-2'],
      metadata: async (id) => ({
        id,
        snippet: 'System Disarmed by Roger',
        labelIds: ['INBOX'],
        internalDate: String(now - 30000),
        payload: { headers: [{ name: 'From', value: 'TotalConnect <alerts@totalconnect2.com>' }, { name: 'Subject', value: 'Total Connect Disarmed' }] },
      }),
    },
  };
  const call = await startFixtureServer(t, pools, gmailState);
  await call('POST', '/api/email-watches', 'alice', { preset: 'totalconnect', accountHint: 'owner@example.com' });

  const first = await call('POST', '/api/email-watches/check', 'alice', {});
  assert.equal(first.status, 200);
  assert.equal(first.body.checked, 1);
  assert.equal(first.body.newHits, 2);
  assert.equal(first.body.report.length, 2);
  assert.deepEqual(first.body.report.map((r) => r.category), ['alarm', 'disarmed']);
  for (const item of first.body.report) {
    assert.equal(item.account, 'owner@example.com');
    for (const k of Object.keys(item)) assert.doesNotMatch(k, /key|cookie|token|secret/i);
  }
  const warmed = await pools.alice.query('SELECT subject FROM oshal_email_messages WHERE msg_key = $1', ['alice|google|m-live-2']);
  assert.equal(warmed.rows.length, 1);

  const quiet = await call('POST', '/api/email-watches/check', 'alice', {});
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.newHits, 0);
  assert.deepEqual(quiet.body.report, []);

  gmailState.reader = { list: async () => { throw new Error('network_offline'); }, metadata: async () => ({}) };
  await insertStored(pools.alice, 'alice', 'm-trouble-3', 'Resideo <noreply@resideo.com>', 'Sensor Trouble', 'Low battery Hallway Motion', 10000);
  const fallback = await call('POST', '/api/email-watches/check', 'alice', {});
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.newHits, 1);
  assert.equal(fallback.body.report[0].category, 'trouble');
  assert.equal(fallback.body.watches[0].hitCount, 3);

  const homeAlice = await call('GET', '/api/email-summarizer/home-summary', 'alice');
  assert.equal(homeAlice.status, 200);
  const watchTile = homeAlice.body.metrics.find((m) => m.id === 'mailbox-watches');
  assert.ok(watchTile && watchTile.value === 'Active (3)' && watchTile.tone === 'warn');
  const watchItem = homeAlice.body.items.find((i) => i.metricId === 'mailbox-watches');
  assert.ok(watchItem && watchItem.text.includes('TotalConnect Security Monitor (owner@example.com)'));
  assert.match(watchItem.detail, /\[TROUBLE\] Sensor Trouble/);

  const homeBob = await call('GET', '/api/email-summarizer/home-summary', 'bob');
  assert.equal(homeBob.body.metrics.some((m) => m.id === 'mailbox-watches'), false);
});

test('EMAIL_DEFAULT_WATCHES seeds totalconnect on POST /check (never on GET) and preserves enabled: false', async (t) => {
  const pools = await createFixtureDb(t);
  const call = await startFixtureServer(t, pools, { activeSub: 'alice', reader: null });
  const prior = process.env.EMAIL_DEFAULT_WATCHES;
  process.env.EMAIL_DEFAULT_WATCHES = 'totconnect';
  t.after(() => {
    if (prior === undefined) delete process.env.EMAIL_DEFAULT_WATCHES;
    else process.env.EMAIL_DEFAULT_WATCHES = prior;
  });

  const beforeWrite = await call('GET', '/api/email-watches', 'alice');
  assert.equal(beforeWrite.status, 200);
  assert.deepEqual(beforeWrite.body.watches, []);

  const checked = await call('POST', '/api/email-watches/check', 'alice', {});
  assert.equal(checked.status, 200);
  assert.equal(checked.body.checked, 1);

  const seeded = await call('GET', '/api/email-watches', 'alice');
  assert.equal(seeded.status, 200);
  assert.equal(seeded.body.watches.length, 1);
  assert.equal(seeded.body.watches[0].watchId, 'totalconnect');
  assert.equal(seeded.body.watches[0].enabled, true);

  const disabled = await call('POST', '/api/email-watches', 'alice', { preset: 'totconnect', enabled: false });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.watch.enabled, false);

  const afterReload = await call('GET', '/api/email-watches', 'alice');
  assert.equal(afterReload.body.watches.length, 1);
  assert.equal(afterReload.body.watches[0].enabled, false);

  const checkDisabled = await call('POST', '/api/email-watches/check', 'alice', {});
  assert.equal(checkDisabled.body.checked, 0);
  assert.equal((await call('GET', '/api/email-watches', 'alice')).body.watches[0].enabled, false);
});

test('GET /api/email-watches executes zero writes under a read-only pool and answers 200 on 42P01 missing table', async (t) => {
  const prior = process.env.EMAIL_DEFAULT_WATCHES;
  process.env.EMAIL_DEFAULT_WATCHES = 'totalconnect';
  t.after(() => {
    if (prior === undefined) delete process.env.EMAIL_DEFAULT_WATCHES;
    else process.env.EMAIL_DEFAULT_WATCHES = prior;
  });

  const executed = [];
  let throwMissingTable = false;
  const readOnlyPool = {
    query: async (sql) => {
      executed.push(String(sql));
      if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(String(sql))) {
        throw Object.assign(new Error('cannot execute write query in a read-only admission'), { code: '25006' });
      }
      if (throwMissingTable) {
        throw Object.assign(new Error('relation "oshal_email_watches" does not exist'), { code: '42P01' });
      }
      return { rows: [] };
    },
  };

  const app = express();
  app.use((req, _res, next) => {
    req.oidc = { isAuthenticated: () => true, user: { sub: 'alice' } };
    next();
  });
  app.use('/api/email-watches', createMailWatchRoutes({ pool: readOnlyPool }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/email-watches`;

  const okRes = await fetch(url);
  assert.equal(okRes.status, 200);
  const okBody = await okRes.json();
  assert.deepEqual(okBody.watches, []);
  assert.deepEqual(okBody.recentHits, []);
  assert.ok(okBody.presets.some((p) => p.id === 'totalconnect'));
  assert.equal(executed.length, 2);
  for (const sql of executed) assert.match(sql, /^SELECT\b/);

  executed.length = 0;
  throwMissingTable = true;
  const missingRes = await fetch(url);
  assert.equal(missingRes.status, 200);
  const missingBody = await missingRes.json();
  assert.deepEqual(missingBody.watches, []);
  assert.deepEqual(missingBody.recentHits, []);
  assert.ok(missingBody.presets.some((p) => p.id === 'totalconnect'));
  assert.equal(executed.length, 2);
  for (const sql of executed) assert.match(sql, /^SELECT\b/);
});

