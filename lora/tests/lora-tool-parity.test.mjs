/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 1.10.6 (CREATE-TOOL-LORA-01, -02, -05, -13): prove lora-models without and with subject against the real compiled route, lora-characters datasetCount/activeModelVersion/trainingState reporting, all concierge read and approval-held action tool contracts and permission bindings, single-version deletion preserving sibling versions and refusing foreign owners, and Chromium desktop/phone UI rendering of dataset counts, training state, and inline Delete version confirmation with active-version warning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, '..', 'scripts', 'toolchain'));
const requireTool = createRequire(path.join(TOOLCHAIN, 'package.json'));
const express = requireTool('express');
const yaml = requireTool('js-yaml');
const { chromium } = requireTool('playwright');

const identityStore = new AsyncLocalStorage();
const Module = (await import('node:module')).default;
const prevLoad = Module._load;

let botLoraRoutes, editorMod;
Module._load = function stubCore(name, parent, ...rest) {
  if (name === 'express') return express;
  if (name === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (name === '@/shared/services/database') return { runRuntimeSchemaBootstrap: async () => undefined };
  if (name === '@/shared/middleware/authz') {
    return {
      getCaller: (req) => ({ sub: req.headers['x-fixture-owner'] || null }),
      getTrustedServiceUserSub: () => null,
    };
  }
  if (name === '@/shared/services/database/request-identity') {
    return {
      runWithRequestIdentity: (id, fn) => identityStore.run(id, fn),
      runWithSystemIdentity: (fn) => fn(),
      getCurrentRequestIdentity: () => identityStore.getStore() || null,
    };
  }
  if (name === '@/app/routes/remote-client-routes') {
    return { remoteClientRegistry: { listClients: () => [], enqueueTask: () => { throw new Error('unexpected worker dispatch'); } } };
  }
  return prevLoad.call(this, name, parent, ...rest);
};
try {
  const reqLocal = createRequire(import.meta.url);
  botLoraRoutes = reqLocal('../routes/bot-lora-routes.js');
  editorMod = reqLocal('../routes/lora-caption-editor.js');
} finally {
  Module._load = prevLoad;
}

const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(ROOT, 'authorization.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'lora-director.yaml'), 'utf8'));

function actorFor(sub) {
  return { issuer: 'https://auth.example', sub, principalId: sub, tenant: 't1' };
}

function buildSeededState() {
  const chars = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      owner_sub: 'owner-a',
      ownerKey: editorMod.editorOwnerKey(actorFor('owner-a')),
      subject: 'cyclops',
      display_name: 'Cyclops',
      trigger_word: 'oshcyclops',
      hero_image: 'hero-cyclops.png',
      base_model: 'v1-5-pruned-emaonly-fp16.safetensors',
      ident_prompt: 'one-eyed orange cyclops creature',
      negative_prompt: 'two eyes',
      identity_structure: 'single eye',
      identity_violation: 'two eyes',
      autonomous: false,
      autonomous_issuer: null,
      max_hours: 9,
      plateau_epsilon: 0.005,
      active_version: 2,
      created_at: '2026-11-20T10:00:00Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      owner_sub: 'owner-a',
      ownerKey: editorMod.editorOwnerKey(actorFor('owner-a')),
      subject: 'fox-knight',
      display_name: 'Fox Knight',
      trigger_word: 'foxknight',
      hero_image: 'hero-fox.png',
      base_model: 'v1-5-pruned-emaonly-fp16.safetensors',
      ident_prompt: 'armored red fox knight',
      negative_prompt: null,
      identity_structure: null,
      identity_violation: null,
      autonomous: false,
      autonomous_issuer: null,
      max_hours: 9,
      plateau_epsilon: 0.005,
      active_version: null,
      created_at: '2026-11-21T10:00:00Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      owner_sub: 'owner-b',
      ownerKey: editorMod.editorOwnerKey(actorFor('owner-b')),
      subject: 'cyclops',
      display_name: 'Other Cyclops',
      trigger_word: 'othercyclops',
      hero_image: 'hero-other.png',
      base_model: 'v1-5-pruned-emaonly-fp16.safetensors',
      ident_prompt: 'another owner cyclops',
      negative_prompt: null,
      identity_structure: null,
      identity_violation: null,
      autonomous: false,
      autonomous_issuer: null,
      max_hours: 9,
      plateau_epsilon: 0.005,
      active_version: 1,
      created_at: '2026-11-19T10:00:00Z',
    },
  ];
  const models = [
    { character_id: chars[0].id, version: 1, status: 'scored', lora_path: 'cyclops_v1.safetensors', base_model: chars[0].base_model, dataset_count: 3, network_dim: 16, epochs: 10, steps: 300, final_loss: 0.09, duration_sec: 120, parent_version: null, ticket_id: 't-1', created_at: '2026-11-22T08:00:00Z' },
    { character_id: chars[0].id, version: 2, status: 'scored', lora_path: 'cyclops_v2.safetensors', base_model: chars[0].base_model, dataset_count: 3, network_dim: 16, epochs: 12, steps: 360, final_loss: 0.07, duration_sec: 140, parent_version: 1, ticket_id: 't-2', created_at: '2026-11-23T08:00:00Z' },
    { character_id: chars[0].id, version: 3, status: 'trained', lora_path: 'cyclops_v3.safetensors', base_model: chars[0].base_model, dataset_count: 3, network_dim: 16, epochs: 12, steps: 360, final_loss: 0.06, duration_sec: 145, parent_version: 2, ticket_id: 't-3', created_at: '2026-11-24T08:00:00Z' },
    { character_id: chars[1].id, version: 1, status: 'training', lora_path: null, base_model: chars[1].base_model, dataset_count: 2, network_dim: 16, epochs: 10, steps: null, final_loss: null, duration_sec: null, parent_version: null, ticket_id: 't-4', created_at: '2026-11-25T08:00:00Z' },
    { character_id: chars[2].id, version: 1, status: 'scored', lora_path: 'other_v1.safetensors', base_model: chars[2].base_model, dataset_count: 1, network_dim: 16, epochs: 10, steps: 200, final_loss: 0.08, duration_sec: 100, parent_version: null, ticket_id: 't-5', created_at: '2026-11-25T09:00:00Z' },
  ];
  const scores = [
    { character_id: chars[0].id, version: 1, overall: 0.72, identity_mean: 0.75, quality_mean: 0.68, min_cell: 0.55, cells: [{ cell: 'side|angry', identity: 0.6, quality: 0.5, score: 0.55 }], weak_cells: [{ axis: 'pose', value: 'side-profile', mean: 0.55 }], gallery_url: null, created_at: '2026-11-22T09:00:00Z' },
    { character_id: chars[0].id, version: 2, overall: 0.86, identity_mean: 0.89, quality_mean: 0.82, min_cell: 0.71, cells: [{ cell: 'front|smile', identity: 0.9, quality: 0.84, score: 0.88 }], weak_cells: [{ axis: 'angle', value: 'low-angle', mean: 0.71 }], gallery_url: null, created_at: '2026-11-23T09:00:00Z' },
    { character_id: chars[2].id, version: 1, overall: 0.91, identity_mean: 0.92, quality_mean: 0.9, min_cell: 0.85, cells: [], weak_cells: [], gallery_url: null, created_at: '2026-11-25T09:30:00Z' },
  ];
  const cellImages = [
    { character_id: chars[0].id, version: 1, cell_index: 0 },
    { character_id: chars[0].id, version: 2, cell_index: 0 },
    { character_id: chars[0].id, version: 2, cell_index: 1 },
    { character_id: chars[0].id, version: 3, cell_index: 0 },
  ];
  const datasetImages = [
    { id: 'd1111111-1111-4111-8111-111111111101', character_id: chars[0].id, filename: 'pose-1.png', source_name: 'pose-1.png', caption: 'oshcyclops front', byte_size: 4096, status: 'ready', created_at: '2026-11-20T11:00:00Z', ingested_at: '2026-11-20T11:01:00Z' },
    { id: 'd1111111-1111-4111-8111-111111111102', character_id: chars[0].id, filename: 'pose-2.png', source_name: 'pose-2.png', caption: 'oshcyclops side', byte_size: 4096, status: 'ready', created_at: '2026-11-20T11:02:00Z', ingested_at: '2026-11-20T11:03:00Z' },
    { id: 'd1111111-1111-4111-8111-111111111103', character_id: chars[0].id, filename: 'pose-3.png', source_name: 'pose-3.png', caption: 'oshcyclops close-up', byte_size: 4096, status: 'ready', created_at: '2026-11-20T11:04:00Z', ingested_at: '2026-11-20T11:05:00Z' },
    { id: 'd2222222-2222-4222-8222-222222222201', character_id: chars[1].id, filename: 'fox-1.png', source_name: 'fox-1.png', caption: 'foxknight standing', byte_size: 2048, status: 'ready', created_at: '2026-11-21T11:00:00Z', ingested_at: '2026-11-21T11:01:00Z' },
    { id: 'd2222222-2222-4222-8222-222222222202', character_id: chars[1].id, filename: 'fox-2.png', source_name: 'fox-2.png', caption: 'foxknight shield', byte_size: 2048, status: 'ready', created_at: '2026-11-21T11:02:00Z', ingested_at: '2026-11-21T11:03:00Z' },
  ];
  return { chars, models, scores, cellImages, datasetImages };
}

function queryCharacterList(state, ownerSub) {
  return state.chars
    .filter((c) => c.owner_sub === ownerSub)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => {
      const ms = state.models.filter((m) => m.character_id === c.id).sort((a, b) => b.version - a.version);
      const ss = state.scores.filter((s) => s.character_id === c.id).sort((a, b) => b.version - a.version);
      const ds = state.datasetImages.filter((d) => d.character_id === c.id);
      return {
        ...c,
        storage_key: `lora-${c.id.replace(/-/g, '')}`,
        latest_version: ms[0]?.version ?? null,
        version_count: ms.length,
        dataset_count: ds.length,
        latest_status: ms[0]?.status ?? null,
        training_count: ms.filter((m) => m.status === 'training').length,
        queued_count: ms.filter((m) => m.status === 'queued').length,
        latest_score: ss[0]?.overall ?? null,
      };
    });
}

function queryModelsAll(state, ownerSub) {
  return state.models
    .map((m) => ({ m, c: state.chars.find((ch) => ch.id === m.character_id) }))
    .filter(({ c }) => c && c.owner_sub === ownerSub)
    .sort((a, b) => b.m.created_at.localeCompare(a.m.created_at) || b.m.version - a.m.version)
    .map(({ m, c }) => {
      const s = state.scores.find((sc) => sc.character_id === m.character_id && sc.version === m.version);
      return {
        subject: c.subject,
        display_name: c.display_name,
        active_version: c.active_version,
        ...m,
        overall: s?.overall ?? null,
        identity_mean: s?.identity_mean ?? null,
        quality_mean: s?.quality_mean ?? null,
        min_cell: s?.min_cell ?? null,
        weak_cells: s?.weak_cells ?? null,
        gallery_url: s?.gallery_url ?? null,
      };
    });
}

function queryModelsForChar(state, charId) {
  return state.models
    .filter((m) => m.character_id === charId)
    .sort((a, b) => b.version - a.version)
    .map((m) => {
      const s = state.scores.find((sc) => sc.character_id === m.character_id && sc.version === m.version);
      return {
        ...m,
        overall: s?.overall ?? null,
        identity_mean: s?.identity_mean ?? null,
        quality_mean: s?.quality_mean ?? null,
        min_cell: s?.min_cell ?? null,
        weak_cells: s?.weak_cells ?? null,
        gallery_url: s?.gallery_url ?? null,
      };
    });
}

function runStateQuery(state, rawSql, params = []) {
  const s = String(rawSql).replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT pg_advisory)/i.test(s)) return { rows: [], rowCount: 0 };
  if (s.includes('FROM oshal_lora_character_editor WHERE character_id=$1')) {
    const c = state.chars.find((row) => row.id === params[0]);
    return { rows: c ? [{ owner_key: c.ownerKey }] : [], rowCount: c ? 1 : 0 };
  }
  if (s.includes('FROM oshal_lora_characters c WHERE c.owner_sub = $1 ORDER BY c.created_at ASC')) {
    const rows = queryCharacterList(state, params[0]);
    return { rows, rowCount: rows.length };
  }
  if (s.includes('FROM oshal_lora_models m JOIN oshal_lora_characters c ON c.id = m.character_id')) {
    const rows = queryModelsAll(state, params[0]);
    return { rows, rowCount: rows.length };
  }
  if (s.includes('FROM oshal_lora_models m LEFT JOIN oshal_lora_scores s')) {
    const rows = queryModelsForChar(state, params[0]);
    return { rows, rowCount: rows.length };
  }
  if (s.includes('FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2')) {
    const c = state.chars.find((row) => row.subject === params[0] && row.owner_sub === params[1]);
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }
  if (s.startsWith('DELETE FROM oshal_lora_scores WHERE character_id = $1 AND version = $2')) {
    const before = state.scores.length;
    state.scores = state.scores.filter((r) => !(r.character_id === params[0] && r.version === Number(params[1])));
    return { rows: [], rowCount: before - state.scores.length };
  }
  if (s.startsWith('DELETE FROM oshal_lora_models WHERE character_id = $1 AND version = $2')) {
    const before = state.models.length;
    state.models = state.models.filter((r) => !(r.character_id === params[0] && r.version === Number(params[1])));
    return { rows: [], rowCount: before - state.models.length };
  }
  if (s.includes('FROM oshal_lora_scores WHERE character_id = $1 AND version = $2')) {
    const sc = state.scores.find((row) => row.character_id === params[0] && row.version === Number(params[1]));
    return { rows: sc ? [sc] : [], rowCount: sc ? 1 : 0 };
  }
  if (s.includes('FROM oshal_lora_cell_images WHERE character_id = $1 AND version = $2')) {
    if (s.startsWith('DELETE')) {
      const before = state.cellImages.length;
      state.cellImages = state.cellImages.filter((r) => !(r.character_id === params[0] && r.version === Number(params[1])));
      return { rows: [], rowCount: before - state.cellImages.length };
    }
    const rows = state.cellImages.filter((r) => r.character_id === params[0] && r.version === Number(params[1]));
    return { rows, rowCount: rows.length };
  }
  if (s.startsWith('UPDATE oshal_lora_characters SET active_version = NULL')) {
    let count = 0;
    for (const c of state.chars) {
      if (c.id === params[0] && c.owner_sub === params[1] && c.active_version === Number(params[2])) {
        c.active_version = null;
        count += 1;
      }
    }
    return { rows: [], rowCount: count };
  }
  if (s.startsWith('SELECT 1 FROM oshal_lora_models WHERE character_id = $1 AND version = $2')) {
    const hit = state.models.some((m) => m.character_id === params[0] && m.version === Number(params[1]));
    return { rows: hit ? [{ '?column?': 1 }] : [], rowCount: hit ? 1 : 0 };
  }
  if (s.startsWith('UPDATE oshal_lora_characters SET active_version = $2')) {
    const c = state.chars.find((row) => row.id === params[0] && row.owner_sub === params[2]);
    if (c) c.active_version = Number(params[1]);
    return { rows: [], rowCount: c ? 1 : 0 };
  }
  if (s.startsWith('UPDATE oshal_lora_characters SET autonomous =')) {
    const c = state.chars.find((row) => row.subject === params[0] && row.owner_sub === params[4]);
    if (!c) return { rows: [], rowCount: 0 };
    if (params[1] !== null) { c.autonomous = Boolean(params[1]); c.autonomous_issuer = params[5]; }
    if (params[2] !== null) c.max_hours = Number(params[2]);
    if (params[3] !== null) c.plateau_epsilon = Number(params[3]);
    return { rows: [{ autonomous: c.autonomous, max_hours: c.max_hours, plateau_epsilon: c.plateau_epsilon }], rowCount: 1 };
  }
  if (s.includes('FROM oshal_lora_dataset_images WHERE character_id = $1')) {
    const rows = state.datasetImages.filter((d) => d.character_id === params[0]);
    return { rows, rowCount: rows.length };
  }
  if (s.includes('FROM oshal_lora_dataset_staging')) return { rows: [], rowCount: 0 };
  if (s.includes('FROM oshal_lora_dataset_captions')) return { rows: [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
}

async function mountRealLoraRoutes(t) {
  const state = buildSeededState();
  const pool = {
    async query(sql, params) { return runStateQuery(state, sql, params); },
    async connect() { return { release() {}, query: async (sql, params) => runStateQuery(state, sql, params) }; },
  };
  let currentSub = 'owner-a';
  const ctx = {
    pool,
    appPackageDir: ROOT,
    ticketService: { createTicket: async () => ({ ticketId: 'ticket-parity-1' }) },
    authorization: {
      registerResource() {},
      currentActor: () => ({ isActive: true, sub: currentSub, issuer: 'https://auth.example', principalId: currentSub, tenantIds: ['t1'] }),
      authorize: async () => ({ allowed: true }),
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    currentSub = String(req.headers['x-fixture-owner'] || '');
    identityStore.run({ userId: currentSub, issuer: 'https://auth.example' }, next);
  });
  app.use('/api/lora', botLoraRoutes.createBotLoraRoutes(ctx));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(() => new Promise((done) => server.close(done)));
  return { base: `http://127.0.0.1:${server.address().port}`, state };
}

/** Expand a declared tool apiEndpoint the same way oshald package_api_tools.rs renders it. */
function renderToolEndpoint(toolName, input = {}) {
  const tool = manifest.tools.find((t) => t.name === toolName);
  assert.ok(tool, `tool ${toolName} declared`);
  const [method, rawTarget] = tool.executor.apiEndpoint.split(' ');
  const [rawPath, rawQuery = ''] = rawTarget.split('?');
  const resolvedPath = rawPath.replace(/\{input\.([^}]+)\}/g, (_, k) => encodeURIComponent(String(input[k])));
  const qs = new URLSearchParams();
  for (const pair of rawQuery.split('&').filter(Boolean)) {
    const [k, v] = pair.split('=');
    const m = /^\{input\.([^}]+)\}$/.exec(v);
    if (m) {
      if (input[m[1]] !== undefined && input[m[1]] !== null && input[m[1]] !== '') qs.set(k, String(input[m[1]]));
    } else {
      qs.set(k, v);
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return { method, urlPath: `${resolvedPath}${suffix}` };
}

test('CREATE-TOOL-LORA-01: lora-models declared endpoint works with no subject and with subject', async (t) => {
  const { base } = await mountRealLoraRoutes(t);
  const allReq = renderToolEndpoint('lora-models', {});
  assert.equal(allReq.method, 'GET');
  assert.equal(allReq.urlPath, '/api/lora/models');
  const allRes = await fetch(`${base}${allReq.urlPath}`, { headers: { 'x-fixture-owner': 'owner-a' } });
  assert.equal(allRes.status, 200);
  const allBody = await allRes.json();
  assert.equal(allBody.subject, null);
  assert.equal(allBody.models.length, 4, 'returns all 4 versions owned by owner-a across both characters');
  assert.deepEqual(
    allBody.models.map((m) => `${m.subject}:v${m.version}:${m.status}:${m.active}`),
    ['fox-knight:v1:training:false', 'cyclops:v3:trained:false', 'cyclops:v2:scored:true', 'cyclops:v1:scored:false'],
    'newest first with character subject, status, and active boolean; excludes owner-b',
  );
  assert.equal(allBody.models.find((m) => m.subject === 'cyclops' && m.version === 2).overall, 0.86);

  const filteredReq = renderToolEndpoint('lora-models', { subject: 'cyclops' });
  assert.equal(filteredReq.urlPath, '/api/lora/models?subject=cyclops');
  const filteredRes = await fetch(`${base}${filteredReq.urlPath}`, { headers: { 'x-fixture-owner': 'owner-a' } });
  assert.equal(filteredRes.status, 200);
  const filteredBody = await filteredRes.json();
  assert.equal(filteredBody.subject, 'cyclops');
  assert.deepEqual(filteredBody.models.map((m) => m.version), [3, 2, 1]);

  const missingRes = await fetch(`${base}${renderToolEndpoint('lora-models', { subject: 'unknown-slug' }).urlPath}`, { headers: { 'x-fixture-owner': 'owner-a' } });
  assert.equal(missingRes.status, 404);
});

test('CREATE-TOOL-LORA-02: lora-characters returns datasetCount, activeModelVersion, and trainingState', async (t) => {
  const { base } = await mountRealLoraRoutes(t);
  const req = renderToolEndpoint('lora-characters', {});
  const res = await fetch(`${base}${req.urlPath}`, { headers: { 'x-fixture-owner': 'owner-a' } });
  assert.equal(res.status, 200);
  const { characters } = await res.json();
  assert.equal(characters.length, 2);
  const cyclops = characters.find((c) => c.subject === 'cyclops');
  const fox = characters.find((c) => c.subject === 'fox-knight');
  assert.equal(cyclops.datasetCount, 3);
  assert.equal(cyclops.dataset_count, 3);
  assert.equal(cyclops.activeModelVersion, 2);
  assert.equal(cyclops.trainingState, 'ready');
  assert.equal(cyclops.activeRunState, 'ready');
  assert.equal(fox.datasetCount, 2);
  assert.equal(fox.activeModelVersion, null);
  assert.equal(fox.trainingState, 'training');
  assert.equal(fox.activeRunState, 'training');
});

test('CREATE-TOOL-LORA-05 & -13: scorecard, dataset, active/overnight, and single-version delete preserve siblings and enforce ownership', async (t) => {
  const { base, state } = await mountRealLoraRoutes(t);

  // lora-scorecard
  const scReq = renderToolEndpoint('lora-scorecard', { subject: 'cyclops', version: 2 });
  const scRes = await fetch(`${base}${scReq.urlPath}`, { headers: { 'x-fixture-owner': 'owner-a' } });
  assert.equal(scRes.status, 200);
  const scBody = await scRes.json();
  assert.equal(scBody.scorecard.overall, 0.86);
  assert.equal(scBody.scorecard.weak_cells[0].value, 'low-angle');

  // lora-dataset
  const dsReq = renderToolEndpoint('lora-dataset', { subject: 'cyclops' });
  const dsRes = await fetch(`${base}${dsReq.urlPath}`, { headers: { 'x-fixture-owner': 'owner-a' } });
  assert.equal(dsRes.status, 200);
  assert.equal((await dsRes.json()).images.length, 3);

  // lora-overnight-toggle
  const autoReq = renderToolEndpoint('lora-overnight-toggle', { subject: 'cyclops', enabled: true, maxHours: 6 });
  const autoRes = await fetch(`${base}${autoReq.urlPath}`, {
    method: autoReq.method,
    headers: { 'content-type': 'application/json', 'x-fixture-owner': 'owner-a' },
    body: JSON.stringify({ enabled: true, maxHours: 6 }),
  });
  assert.equal(autoRes.status, 200);
  assert.equal((await autoRes.json()).autonomous, true);

  // lora-delete-model: foreign owner refused
  const delForeignReq = renderToolEndpoint('lora-delete-model', { subject: 'fox-knight', version: 1 });
  const delForeign = await fetch(`${base}${delForeignReq.urlPath}`, {
    method: delForeignReq.method,
    headers: { 'x-fixture-owner': 'owner-b' },
  });
  assert.equal(delForeign.status, 404);

  // lora-delete-model: delete v2 (active) leaves v1 and v3 intact, removes v2 score + thumbnails, clears active_version
  const delReq = renderToolEndpoint('lora-delete-model', { subject: 'cyclops', version: 2 });
  const delRes = await fetch(`${base}${delReq.urlPath}`, {
    method: delReq.method,
    headers: { 'x-fixture-owner': 'owner-a' },
  });
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.ok, true);
  assert.equal(delBody.removedImages, 2);
  assert.equal(delBody.removedVersions, 1);
  assert.deepEqual(state.models.filter((m) => m.character_id === state.chars[0].id).map((m) => m.version), [1, 3]);
  assert.deepEqual(state.scores.filter((s) => s.character_id === state.chars[0].id).map((s) => s.version), [1]);
  assert.deepEqual(state.cellImages.filter((c) => c.character_id === state.chars[0].id).map((c) => c.version), [1, 3]);
  assert.equal(state.chars[0].active_version, null);

  // lora-activate-model: set v1 active
  const actReq = renderToolEndpoint('lora-activate-model', { subject: 'cyclops', version: 1 });
  const actRes = await fetch(`${base}${actReq.urlPath}`, {
    method: actReq.method,
    headers: { 'content-type': 'application/json', 'x-fixture-owner': 'owner-a' },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(actRes.status, 200);
  assert.equal(state.chars[0].active_version, 1);
});

test('every declared lora tool binds to exact HTTP permissions and uses only supported JSON Schema keywords', () => {
  const forbidden = new Set(['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties']);
  function walkSchema(node) {
    assert.ok(node && typeof node === 'object');
    for (const key of Object.keys(node)) assert.equal(forbidden.has(key), false, `unsupported schema keyword ${key}`);
    if (node.properties) for (const child of Object.values(node.properties)) walkSchema(child);
    if (node.items) walkSchema(node.items);
  }
  const existingPerms = new Set(['app.open', 'lora.read', 'lora.configure', 'lora.source.change', 'lora.execute']);
  assert.deepEqual(new Set(Object.keys(catalog.permissions)), existingPerms, 'no new permissions added (policy_pending stays empty)');
  for (const tool of manifest.tools) {
    walkSchema(tool.inputSchema);
    const binding = catalog.bindings.tools.find((b) => b.id === tool.name);
    assert.ok(binding, `${tool.name} has a tool binding`);
    for (const p of binding.allOf) assert.ok(existingPerms.has(p), `${tool.name} uses existing permission ${p}`);
    assert.ok(persona.perspective.includes(tool.name), `${tool.name} named in lora-director persona`);
  }
});

test('Chromium (1440x900 & 412x915): studio displays datasetCount & trainingState and inline Delete version warns on active version', async (t) => {
  const gateDir = path.join(process.env.HOME || '', '.local/state/oshal-store-gate');
  const gatePlatforms = fs.existsSync(gateDir)
    ? fs.readdirSync(gateDir).filter((d) => d.startsWith('kernel-platform-')).map((d) => path.join(gateDir, d))
    : [];
  const platformRoot = [
    process.env.OSHAL_PLATFORM_ROOT,
    process.env.OSHAL_KERNEL_PLATFORM,
    path.resolve(ROOT, '..', '..', 'oshal-kernel', 'platform'),
    ...gatePlatforms,
  ].find((d) => d && fs.existsSync(path.join(d, 'src/shared/ui/js/jarvis-chat-frame.js')))
    || gatePlatforms.find((d) => fs.existsSync(path.join(d, 'src/shared/ui')));
  assert.ok(platformRoot, 'kernel shared UI root must be available');

  const characters = [
    { subject: 'cyclops', display_name: 'Cyclops', trigger_word: 'oshcyclops', hero_image: 'hero.png', ident_prompt: 'cyclops', storage_key: 'lora-1', version_count: 3, latest_version: 3, active_version: 2, latest_score: 0.86, datasetCount: 4, dataset_count: 4, trainingState: 'training', activeRunState: 'training' },
  ];
  let models = [
    { version: 3, status: 'training', overall: null, parent_version: 2, network_dim: 16, epochs: 12 },
    { version: 2, status: 'scored', overall: 0.86, identity_mean: 0.89, quality_mean: 0.82, min_cell: 0.71, parent_version: 1, network_dim: 16, epochs: 12 },
    { version: 1, status: 'scored', overall: 0.72, identity_mean: 0.75, quality_mean: 0.68, min_cell: 0.55, parent_version: null, network_dim: 16, epochs: 10 },
  ];
  const deleted = [];
  const app = express();
  app.use(express.json());
  app.get('/api/lora/ui', (_req, res) => res.sendFile(path.join(ROOT, 'tools', 'lora.html')));
  app.get('/api/lora/ui/photo-upload.mjs', (_req, res) => res.type('application/javascript').sendFile(path.join(ROOT, 'tools', 'lora-photo-upload.mjs')));
  app.use('/shared/ui', express.static(path.join(platformRoot, 'src/shared/ui')));
  app.use('/cockpit', express.static(path.join(platformRoot, 'src/pages/cockpit')));
  app.get('/api/lora/worker', (_req, res) => res.json({ gpuWorker: true }));
  app.get('/api/lora/characters', (_req, res) => res.json({ characters }));
  app.get('/api/lora/characters/:subject/editor', (req, res) => res.json({ subject: req.params.subject, characterId: '11111111-1111-4111-8111-111111111111', displayName: 'Cyclops', revision: 0, canConfigure: true, canExecute: true }));
  app.get('/api/lora/dataset', (_req, res) => res.json({ images: [] }));
  app.get('/api/lora/models', (_req, res) => res.json({ subject: 'cyclops', models }));
  app.delete('/api/lora/models/:subject/:version', (req, res) => {
    const ver = Number(req.params.version);
    deleted.push(`${req.params.subject}:${ver}`);
    models = models.filter((m) => m.version !== ver);
    if (characters[0].active_version === ver) characters[0].active_version = null;
    characters[0].version_count = models.length;
    res.json({ ok: true, subject: req.params.subject, version: ver, removedImages: 2, removedVersions: 1 });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });

  // Desktop 1440x900
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await deskCtx.newPage();
  const deskErrors = [];
  let nativeDialogFired = false;
  desk.on('pageerror', (e) => deskErrors.push(e.message));
  desk.on('dialog', async (d) => { nativeDialogFired = true; await d.dismiss(); });
  await desk.goto(`http://127.0.0.1:${server.address().port}/api/lora/ui`);
  await desk.locator('#chars .card').first().waitFor();
  const cardText = await desk.locator('#chars .card').first().textContent();
  assert.match(cardText, /4 images/);
  assert.match(cardText, /training/);
  await desk.locator('#chars .card').first().click();
  await desk.locator('[data-step="train"]').click();
  await desk.locator('#vers .ver[data-version="2"]').waitFor();
  await desk.locator('#vers .ver[data-version="2"] [data-delete-version="2"]').click();
  assert.equal(nativeDialogFired, false, 'must use inline confirmation, never window.confirm');
  assert.equal(deleted.length, 0, 'first click only arms confirmation');
  const warnText = await desk.locator('#result').textContent();
  assert.match(warnText, /active version/i);
  await desk.locator('#vers .ver[data-version="2"] [data-delete-version-cancel]').click();
  assert.equal(deleted.length, 0, 'Keep cancels without deleting');
  await desk.locator('#vers .ver[data-version="2"] [data-delete-version="2"]').click();
  await desk.locator('#vers .ver[data-version="2"] [data-delete-version="2"]').click();
  await desk.locator('#result').filter({ hasText: 'Deleted v2 of cyclops' }).waitFor();
  assert.deepEqual(deleted, ['cyclops:2']);
  assert.equal(await desk.locator('#vers .ver[data-version="2"]').count(), 0);
  assert.equal(await desk.locator('#vers .ver[data-version="1"]').count(), 1);
  assert.equal(await desk.locator('#vers .ver[data-version="3"]').count(), 1);
  assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(deskErrors, []);
  await deskCtx.close();

  // Phone 412x915
  const phoneCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(e.message));
  await phone.goto(`http://127.0.0.1:${server.address().port}/api/lora/ui`);
  const phoneRow = phone.locator('#phoneChars [data-home-index="0"]');
  await phoneRow.waitFor();
  const phoneText = await phoneRow.textContent();
  assert.match(phoneText, /4 images/);
  assert.match(phoneText, /training/);
  await phoneRow.tap();
  await phone.locator('[data-step="train"]').click();
  await phone.locator('#vers .ver[data-version="1"] [data-delete-version="1"]').waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(phoneErrors, []);
  await phoneCtx.close();
});
