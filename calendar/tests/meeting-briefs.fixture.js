/**
 * Framework-coupled fixture for the meeting-brief agent.
 *
 * Real code on every boundary the fix claims: the actual `JarvisBriefingService` (which is what
 * enforces the manifest's consent default), the actual `jarvis-task-store.saveCompletedBriefing`
 * transaction, the actual `request-identity` system-identity scope, real express for the surface
 * read, and the COMPILED package bytes the loader mounts. Only the database is a port, and it is
 * an explicit synthetic one: every statement is matched, recorded, and an unrecognised statement
 * is a failure rather than an empty result set.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compose the registered briefing runtime, an owner-scoped synthetic store and a loopback surface read around the compiled meeting-brief modules.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Serve core's own ADR-100 consent-gate statement (ambient_speaker_assignments UNION the latest ambient_speaker_consents row per profile) with its real semantics, and record the exact SQL text of every package read and write. The consent rule and the columns a query selects are both now boundaries a test can assert on rather than infer: a suite can prove that a declined voice is not admitted and that the recorded words are never selected at all.
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

/** @description Resolve only existing core source files without touching installed app paths. */
function resolveSource(relative) {
  for (const candidate of [`${relative}.ts`, path.join(relative, 'index.ts')]) {
    if (fs.existsSync(path.join(core, 'src', candidate))) return candidate;
  }
  throw new Error(`Synthetic fixture cannot resolve core source ${relative}`);
}

/** @description Load canonical TypeScript modules with only unrelated task-store dependencies stubbed. */
function loadCore(relative) {
  const filename = path.join(core, 'src', relative);
  if (loadedCore.has(filename)) return loadedCore.get(filename).exports;
  const subject = new Module(filename, module);
  loadedCore.set(filename, subject);
  subject.filename = filename;
  subject.require = name => {
    if (name === '@/shared/logger') return { createChildLogger: () => ({ warn: noop, info: noop, error: noop }) };
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

const delivery = loadCore('app/routes/jarvis-briefing-delivery.ts');
const taskStore = loadCore('app/routes/jarvis-task-store.ts');
const { JarvisBriefingService } = loadCore('app/composition/jarvis-briefing-service.ts');
const identity = loadCore('shared/services/database/request-identity.ts');
const manifest = coreRequire('js-yaml').load(fs.readFileSync(path.resolve(__dirname, '../oshal-app.yaml'), 'utf8'));
const actor = Object.freeze({ sub: 'synthetic-calendar-owner', issuer: 'https://calendar-owner.fixture.test', isActive: true, isSwarmAdmin: false });
const sourceId = `${manifest.name}:${manifest.briefings[0].id}`;
const session = manifest.briefings[0].sessionId;
const result = rows => ({ rows, rowCount: rows.length });

/** @description Load unchanged compiled package code; replace only its framework resolution with canonical sources. */
function loadPackage(file, store = taskStore) {
  const filename = path.resolve(__dirname, '..', 'routes', file);
  const subject = new Module(filename, module);
  subject.filename = filename;
  subject.require = name => name === '@/app/routes/jarvis-task-store' ? store
    : name.startsWith('@/') ? loadCore(resolveSource(name.slice(2)))
      : name.startsWith('.') ? loadPackage(`${path.basename(name)}${name.endsWith('.js') ? '' : '.js'}`, store)
        : coreRequire(name);
  subject._compile(fs.readFileSync(filename, 'utf8'), filename);
  return subject.exports;
}

/** @description Dispatch actual briefing-source/preference SQL against fixture-owned Maps. */
function controlQuery(state, text, values) {
  if (text.startsWith('SELECT pg_advisory_xact_lock')) return result([]);
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
    const preference = state.preferences.get(JSON.stringify(values));
    return result(preference ? [{ preference }] : []);
  }
  throw new Error(`Unrecognized synthetic control SQL: ${text.slice(0, 120)}`);
}

/** @description The consent-gate admission rule, applied to fixture-owned rows exactly as core states it:
 * the owner's own 'self' profile, plus every profile whose LATEST transcript-scope consent is
 * 'granted' and is not flagged a minor. Nothing else is eligible. */
function eligibleProfiles(state, ownerSub) {
  const eligible = new Set((state.speakerSelf ?? []).map(String));
  const latest = new Map();
  for (const row of state.speakerConsents ?? []) {
    if (row.owner_sub !== ownerSub || row.scope !== 'transcript') continue;
    const seen = latest.get(row.profile_id);
    if (!seen || Date.parse(row.recorded_at) >= Date.parse(seen.recorded_at)) latest.set(row.profile_id, row);
  }
  for (const [profileId, row] of latest) {
    if (row.status === 'granted' && row.is_minor !== true) eligible.add(String(profileId));
  }
  return eligible;
}

/** @description Record that a package statement was served AND the exact SQL text it used. */
function reading(state, label, text) {
  state.reads.push(label);
  state.packageSql.push(text);
}

/** @description Serve the package's own owner-scoped reads; each one records that it happened. */
function packageRead(state, text, values) {
  if (text.includes('FROM ambient_speaker_assignments')) {
    reading(state, 'speaker-consent', text);
    return result([...eligibleProfiles(state, values[0])].map(profile_id => ({ profile_id })));
  }
  if (text.includes('FROM calendar_preparation_snapshots')) {
    reading(state, 'snapshots', text);
    if (state.snapshotError) throw new Error('synthetic snapshot unavailable');
    return result(state.snapshots.map(row => ({ user_sub: row.user_sub, events: row.events })));
  }
  if (text.includes('FROM calendar_meeting_briefs') && text.includes('series_key')) {
    reading(state, 'priors', text);
    return result([...state.briefRows.values()]
      .filter(row => row.user_sub === values[0] && row.series_key === values[1]
        && Date.parse(row.starts_at) < Date.parse(values[2]))
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)).slice(0, values[3]));
  }
  if (text.includes('FROM ambient_user_settings')) {
    reading(state, 'ambient-settings', text);
    return result(state.ambient.has(values[0]) ? [{ ambient_enabled: state.ambient.get(values[0]) }] : []);
  }
  if (text.includes('FROM ambient_transcript_segments')) {
    reading(state, 'transcripts', text);
    // The whole stored row is returned deliberately, including transcript_text: a brief that must
    // not carry the recorded words has to not carry them while they ARE available, not because a
    // double withheld them. The speaker restriction is applied only when the STATEMENT asks for it,
    // so dropping that clause returns the ineligible rows here exactly as Postgres would.
    const gated = text.includes('speaker_profile_id = ANY(');
    return result(state.segments.filter(row => row.user_sub === values[0]
      && Date.parse(row.captured_at) >= Date.parse(values[1]) && Date.parse(row.captured_at) < Date.parse(values[2])
      && (!gated || (row.speaker_profile_id != null && values[3].includes(row.speaker_profile_id))))
      .slice(0, values[values.length - 1]));
  }
  if (text.includes('FROM ambient_daily_reviews')) {
    reading(state, 'reviews', text);
    return result(state.reviews.filter(row => row.user_sub === values[0] && values[1].includes(row.local_date)));
  }
  if (text.includes('FROM calendar_meeting_briefs')) {
    reading(state, 'view', text);
    return result([...state.briefRows.values()].filter(row => row.user_sub === values[0])
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)).slice(0, values[1]));
  }
  return null;
}

/** @description Apply the package's only write with the real ON CONFLICT semantics. */
function packageWrite(state, text, values) {
  if (!text.startsWith('INSERT INTO calendar_meeting_briefs')) return null;
  assert.match(text, /ON CONFLICT\(user_sub,event_id\) DO NOTHING/);
  const [user_sub, event_id, series_key, title, starts_at, ends_at, brief, built_at] = values;
  const key = `${user_sub}|${event_id}`;
  state.writes.push(key);
  state.packageSql.push(text);
  if (state.briefRows.has(key)) return result([]);
  state.briefRows.set(key, { user_sub, event_id, series_key, title, starts_at, ends_at, brief: JSON.parse(brief), built_at });
  return result([]);
}

/** @description Insert exact canonical completed fields into a transaction-local task map. */
function insertTask(state, tasks, text, values) {
  assert.match(text, /ON CONFLICT\(id\) DO NOTHING RETURNING id/);
  const [id, user_sub, session_id, title, payload, briefing_source_id, principal_issuer] = values;
  if (tasks.has(id)) return result([]);
  tasks.set(id, { id, user_sub, session_id, title, result: payload, briefing_source_id,
    principal_issuer, status: 'done', delivered: false });
  return result([{ id }]);
}

/** @description Borrow a synthetic client with commit/rollback isolation for the actual service transaction. */
function client(state) {
  let tasks;
  return {
    async query(input, values = []) {
      const text = typeof input === 'string' ? input : input.text;
      state.statements.push(text);
      if (text === 'BEGIN') { tasks = new Map(state.tasks); return result([]); }
      if (text === 'COMMIT') { state.tasks = tasks; return result([]); }
      if (text === 'ROLLBACK') { state.rollbacks += 1; return result([]); }
      if (text.startsWith('INSERT INTO jarvis_tasks')) return insertTask(state, tasks, text, values);
      return controlQuery(state, text, values);
    },
    release() { state.releases += 1; },
  };
}

/** @description Compose the actual service, task store and package modules over one synthetic store. */
async function fixture(options = {}) {
  const state = {
    snapshots: [], ambient: new Map(), segments: [], reviews: [], briefRows: new Map(),
    speakerSelf: [], speakerConsents: [],
    tasks: new Map(), sources: new Map(), preferences: new Map(),
    reads: [], writes: [], statements: [], packageSql: [], systemScoped: [], rollbacks: 0, releases: 0,
    allowed: true, recipient: actor, ...options,
  };
  const pool = {
    async connect() { return client(state); },
    async query(input, values = []) {
      const text = typeof input === 'string' ? input : input.text;
      const args = typeof input === 'string' ? values : input.values;
      const served = packageRead(state, text, args) ?? packageWrite(state, text, args);
      if (served) {
        state.systemScoped.push([text.includes('calendar_meeting_briefs') && text.includes('built_at,brief')
          ? 'view' : 'collector', identity.isSystemIdentity(identity.getRequestIdentity())]);
        return served;
      }
      return controlQuery(state, text, args);
    },
  };
  const service = new JarvisBriefingService(pool, {
    async resolveRecipient() { return state.recipient; },
    async canAccess() { return state.allowed; },
  });
  if (options.register !== false) await service.register(manifest.name, manifest.version, manifest.briefings);
  const previousRuntime = delivery.getJarvisBriefingDelivery();
  delivery.configureJarvisBriefingDelivery({ service, resolveActor: async () => actor, targetActor: async () => actor });
  const collector = loadPackage('meeting-briefs.js', options.store ?? taskStore);
  const view = loadPackage('meeting-brief-view.js');
  return { state, service, pool, collector, view, taskStore, delivery, manifest, actor, sourceId, session,
    collect: body => collector.runMeetingBriefCollection({ pool }, body ?? {}),
    stop: () => delivery.configureJarvisBriefingDelivery(previousRuntime) };
}

/** @description Mount the package's real surface read behind an explicit fixture-only session seam. */
async function viewFixture(proof, sub = actor.sub) {
  const app = express();
  app.use('/api/calendar/meeting-briefs', (req, _res, next) => {
    req.oidc = { user: sub ? { sub } : {}, isAuthenticated: () => Boolean(sub) };
    next();
  }, proof.view.createMeetingBriefViewRoutes({ pool: proof.pool }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

/** @description One explicitly synthetic upcoming meeting inside the default lead window. */
function meeting(startsInMinutes, overrides = {}) {
  const start = new Date(Date.now() + startsInMinutes * 60_000);
  return { id: `synthetic-evt-${startsInMinutes}`, title: 'Synthetic Weekly Sync',
    start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString(),
    allDay: false, ...overrides };
}

module.exports = { fixture, viewFixture, meeting, actor, manifest, sourceId, session };
