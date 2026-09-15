/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Supply explicit synthetic transactional SQL and loopback transport ports around real registered briefing/service code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const core = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!core || !fs.existsSync(path.join(core, 'src/app/routes/jarvis-task-store.ts'))) {
  throw new Error('fixture:core-checkout is required (set OSHAL_CORE_ROOT or OSHAL_CORE_DIR); no live runtime is contacted');
}
const coreRequire = Module.createRequire(path.join(core, 'package.json'));
const ts = coreRequire('typescript');
const express = coreRequire('express');
const loadedCore = new Map();
const noop = () => {};

/** @description Load canonical TypeScript modules with only unrelated task-store dependencies stubbed. */
function loadCore(relative) {
  const filename = path.join(core, 'src', relative);
  if (loadedCore.has(filename)) return loadedCore.get(filename).exports;
  const subject = new Module(filename, module);
  loadedCore.set(filename, subject);
  subject.filename = filename;
  subject.require = name => {
    if (name === '@/shared/logger') return { createChildLogger: () => ({ warn: noop }) };
    if (name === '@/shared/services/database') return { runRuntimeSchemaBootstrap: () => { throw Error('fixture forbids schema writes'); } };
    if (name === '@/features/visual-response') return { VISUAL_RESPONSE_KINDS: [] };
    if (name === '@/shared/application-authorization-context' || name === './jarvis-result-access') return {};
    if (name.startsWith('@/')) return loadCore(resolveSource(name.slice(2)));
    if (name.startsWith('.')) return loadCore(resolveSource(path.join(path.dirname(relative), name)));
    return coreRequire(name);
  };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  subject._compile(source, filename);
  return subject.exports;
}

/** @description Resolve only existing core source files without touching installed app paths. */
function resolveSource(relative) {
  for (const candidate of [`${relative}.ts`, path.join(relative, 'index.ts')]) {
    if (fs.existsSync(path.join(core, 'src', candidate))) return candidate;
  }
  throw new Error(`Synthetic fixture cannot resolve core source ${relative}`);
}

const delivery = loadCore('app/routes/jarvis-briefing-delivery.ts');
const taskStore = loadCore('app/routes/jarvis-task-store.ts');
const { JarvisBriefingService } = loadCore('app/composition/jarvis-briefing-service.ts');
const identity = loadCore('shared/services/database/request-identity.ts');
const manifest = coreRequire('js-yaml').load(fs.readFileSync(path.resolve(__dirname, '../oshal-app.yaml'), 'utf8'));
const actor = Object.freeze({ sub: 'synthetic-report-owner', issuer: 'https://report-owner.fixture.test', isActive: true, isSwarmAdmin: false });
const result = rows => ({ rows, rowCount: rows.length });

/** @description Produce an explicitly synthetic recorded completion; no actual journal is queried. */
function report(overrides = {}) {
  return { id: 1, user_sub: actor.sub, et_day: new Date().toISOString().slice(0, 10),
    kind: 'report', source: 'daily-report', summary: 'Synthetic report: three reviewed positions.',
    created_at: new Date().toISOString(), ...overrides };
}

/** @description Model only the collector's fixed bounded SQL read; capture the exact query contract. */
function reportRows(state, query) {
  state.reads.push(query);
  if (state.readError) throw new Error('synthetic journal unavailable');
  assert.match(query.text, /kind='report' AND source='daily-report'/);
  assert.match(query.text, /INTERVAL '72 hours'/);
  assert.equal(query.values[1], 50);
  assert.equal(query.query_timeout, 2000);
  const now = Date.parse(query.values[0]);
  return result(state.reports.filter(row => row.kind === 'report' && row.source === 'daily-report'
    && Date.parse(row.created_at) <= now && Date.parse(row.created_at) >= now - 72 * 3600_000
    && row.et_day <= query.values[0].slice(0, 10))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).slice(0, 50));
}

/** @description Dispatch actual source/preference SQL against fixture-owned Maps, refusing unknown statements. */
function controlQuery(state, text, values) {
  if (state.sourceReadError && text.startsWith('SELECT * FROM jarvis_briefing_sources')) throw new Error('synthetic source unavailable');
  if (text.startsWith('SELECT pg_advisory_xact_lock')) { state.locks.push(values[0]); return result([]); }
  if (text.startsWith('UPDATE jarvis_briefing_sources')) {
    for (const row of state.sources.values()) if (row.app === values[0]) row.active = false;
    return result([]);
  }
  if (text.startsWith('INSERT INTO jarvis_briefing_sources')) {
    const [source_id, app, session_id, definition] = values;
    state.sources.set(source_id, { source_id, app, session_id, definition, active: true });
    return result([{ source_id }]);
  }
  if (/^SELECT (\*|1) FROM jarvis_briefing_sources WHERE session_id=/.test(text)) {
    return result([...state.sources.values()].filter(row => row.session_id === values[0]));
  }
  if (text.startsWith('INSERT INTO jarvis_briefing_preferences')) {
    state.preferences.set(JSON.stringify(values.slice(0, 3)), values[3]); return result([]);
  }
  if (text.startsWith('SELECT preference FROM jarvis_briefing_preferences')) {
    const preference = state.preferences.get(JSON.stringify(values)); return result(preference ? [{ preference }] : []);
  }
  throw new Error(`Unrecognized synthetic control SQL: ${text.slice(0, 100)}`);
}

/** @description Insert exact canonical completed fields into a transaction-local task map. */
async function insertTask(state, tasks, text, values) {
  assert.match(text, /ON CONFLICT\(id\) DO NOTHING RETURNING id/);
  assert.match(text, /'done','simple',\$5,NOW\(\),\$6,\$7/);
  if (state.failInserts-- > 0) throw new Error('synthetic insert failure');
  const [id, user_sub, session_id, title, payload, briefing_source_id, principal_issuer] = values;
  if (tasks.has(id)) return result([]);
  tasks.set(id, { id, user_sub, session_id, title, result: payload, briefing_source_id,
    principal_issuer, status: 'done', kind: 'simple', delivered: false, finished_at: new Date().toISOString() });
  await state.afterInsert?.();
  return result([{ id }]);
}

/** @description Borrow a synthetic client with commit/rollback isolation for the actual service transaction. */
function client(state) {
  let tasks;
  return {
    async query(input, values = []) {
      assert.equal(identity.isSystemIdentity(identity.getRequestIdentity()), true);
      const text = typeof input === 'string' ? input : input.text;
      state.statements.push(text);
      if (text === 'BEGIN') { tasks = new Map(state.tasks); return result([]); }
      if (text === 'COMMIT') { state.tasks = tasks; state.commits += 1; return result([]); }
      if (text === 'ROLLBACK') { state.rollbacks += 1; return result([]); }
      if (text.startsWith('INSERT INTO jarvis_tasks')) return insertTask(state, tasks, text, values);
      return controlQuery(state, text, values);
    },
    release() { state.releases += 1; },
  };
}

/** @description Load unchanged compiled package code; replace only its framework resolution with canonical sources. */
function loadCollector(store = taskStore) {
  const filename = path.resolve(__dirname, '../routes/completed-report-briefings.js');
  const subject = new Module(filename, module);
  subject.filename = filename;
  subject.require = name => name === '@/app/routes/jarvis-task-store' ? store
    : name.startsWith('@/') ? loadCore(resolveSource(name.slice(2))) : coreRequire(name);
  subject._compile(fs.readFileSync(filename, 'utf8'), filename);
  return subject.exports;
}

/** @description Wire the actual service and source with synthetic verified identity and transactional persistence ports. */
async function fixture(options = {}) {
  const state = { reports: [report()], tasks: new Map(), sources: new Map(), preferences: new Map(),
    reads: [], locks: [], statements: [], resolutions: [], accesses: [], commits: 0, rollbacks: 0, releases: 0,
    allowed: true, recipient: actor, failInserts: 0, ...options };
  const pool = {
    async connect() { return client(state); },
    async query(query, values = []) {
      assert.equal(identity.isSystemIdentity(identity.getRequestIdentity()), true);
      if (typeof query === 'object' && query.text.includes('oshal_trading_strategy_journal')) return reportRows(state, query);
      return controlQuery(state, query, values);
    },
  };
  const service = new JarvisBriefingService(pool, {
    async resolveRecipient(sub) { state.resolutions.push(sub); return state.resolve ? state.resolve(sub) : state.recipient; },
    async canAccess(current, app) { state.accesses.push({ current, app }); return state.access ? state.access(current, app) : state.allowed; },
  });
  if (options.register !== false) await service.register(manifest.name, manifest.version, manifest.briefings);
  const previousRuntime = delivery.getJarvisBriefingDelivery();
  const runtime = { service, resolveActor: async () => actor, targetActor: async () => actor };
  delivery.configureJarvisBriefingDelivery(runtime);
  const collector = loadCollector(options.store ?? taskStore);
  return { state, service, runtime, pool, collector, taskStore, delivery,
    collect: () => collector.collectCompletedReports({ pool }),
    stop: () => delivery.configureJarvisBriefingDelivery(previousRuntime) };
}

/** @description Mount real package HTTP behind an explicit fixture-only service-auth seam, never a live server. */
async function httpFixture(proof) {
  const app = express(); app.use(express.json());
  app.use('/api/daily-trade-recap/briefings', (req, res, next) => {
    if (req.get('x-synthetic-service') !== 'allowed') { res.sendStatus(401); return; }
    next();
  }, proof.collector.createCompletedReportBriefingRoutes({ pool: proof.pool }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`,
    stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

module.exports = { fixture, httpFixture, report, actor, manifest };
