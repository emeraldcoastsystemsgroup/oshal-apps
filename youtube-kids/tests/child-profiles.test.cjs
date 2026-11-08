/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | RP-KL-01: behavioural and refusal regression suite for Kid Lens household child profiles (8-profile cap, per-child uploads and briefs, delete cleanup, cross-parent isolation, legacy promotion, and concierge tool parity).
 * -----------------------------------------------------------------------------
 *
 * @module child-profiles.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const READER_REFUSAL = 'refused: SQL mutation requires original writer admission';

let nextBriefAnswer = (prompt) => `## Top interests\n- Brief from prompt (${prompt.includes("Maya's") ? 'Maya' : prompt.includes("Leo's") ? 'Leo' : 'Child'})`;

const STUB_EXPORTS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/services/database': {
    runRuntimeSchemaBootstrap: async ({ pool, statements }) => { for (const s of statements) await pool.query(s); },
    buildOwnerRlsPolicyStatements: () => [],
  },
  '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => ({ ok: false, status: 404, error: 'missing' }) },
  '@/features/personal-data': {
    encryptField: async (sub, raw) => `sealed:${sub}:${Buffer.byteLength(raw)}`,
    decryptField: async () => '',
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _client, _id, payload) => ({ response: nextBriefAnswer(payload.text) }),
  },
};

let recording = {};
const record = (method) => (p, ...h) => { recording[`${method} ${p}`] = h[h.length - 1]; };
const EXPRESS = {
  Router: () => ({ get: record('GET'), post: record('POST'), patch: record('PATCH'), delete: record('DELETE'), use() {} }),
  raw: () => (_req, _res, next) => next && next(),
};

function withStubs(handlers, fn) {
  recording = handlers;
  const stubs = Object.assign({}, STUB_EXPORTS, { express: EXPRESS });
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[path.join(ROOT, 'routes', 'youtube-children-store.js')];
    delete require.cache[path.join(ROOT, 'routes', 'youtube-kids-routes.js')];
    return fn();
  } finally {
    Module._load = original;
  }
}

/** Stateful in-memory SQL double modelling oshal_youtube_children + legacy oshal_youtube_activity + reader/writer admission. */
function createFamilyDb(legacyInit = {}) {
  const children = new Map(); // `${sub}::${childId}` -> row
  const legacy = new Map(); // sub -> row
  for (const [sub, row] of Object.entries(legacyInit)) legacy.set(sub, { ...row });
  let seq = 0;
  let currentRole = 'writer';
  const writes = [];

  const pool = {
    setRole(role) { currentRole = role; },
    childrenMap: children,
    legacyMap: legacy,
    writes,
    async query(text, values = []) {
      const sql = String(typeof text === 'object' ? text.text : text).trim();
      const params = typeof text === 'object' ? text.values : values;
      const isMutation = /^(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(sql);
      const isDDL = /^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(sql);
      if (isMutation && currentRole !== 'writer') throw new Error(READER_REFUSAL);
      if (isDDL) return { rows: [], rowCount: 0 };

      if (/FROM\s+oshal_youtube_children\s+WHERE\s+user_sub\s*=\s*\$1/i.test(sql) && /^SELECT/i.test(sql)) {
        const sub = params[0];
        const rows = [...children.values()]
          .filter((r) => r.user_sub === sub)
          .sort((a, b) => a.order - b.order)
          .map((r) => ({
            ...r,
            date_range: r.aggregate ? JSON.parse(r.aggregate).dateRange : null,
            has_data: r.aggregate != null,
            has_brief: r.brief != null,
          }));
        return { rows, rowCount: rows.length };
      }

      if (/FROM\s+oshal_youtube_activity\s+WHERE\s+user_sub\s*=\s*\$1/i.test(sql) && /^SELECT/i.test(sql)) {
        const row = legacy.get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        const parsed = typeof row.aggregate === 'string' ? JSON.parse(row.aggregate) : row.aggregate;
        return {
          rows: [{ ...row, date_range: parsed?.dateRange ?? null, has_data: row.aggregate != null, has_brief: row.brief != null }],
          rowCount: 1,
        };
      }

      if (/^INSERT\s+INTO\s+oshal_youtube_children/i.test(sql)) {
        writes.push({ op: 'insert_child', params });
        const [sub, childId, name] = params;
        const key = `${sub}::${childId}`;
        const existing = children.get(key);
        if (params.length === 3) {
          children.set(key, {
            user_sub: sub, child_id: childId, name, aggregate: null, raw_blob: null,
            total_watched: null, brief: null, uploaded_at: null, brief_at: null, order: ++seq,
          });
        } else if (params.length === 9) {
          if (!existing) {
            children.set(key, {
              user_sub: sub, child_id: childId, name, aggregate: params[3], raw_blob: params[4],
              total_watched: params[5], brief: params[6], uploaded_at: params[7], brief_at: params[8], order: ++seq,
            });
          }
        } else {
          const now = new Date().toISOString();
          children.set(key, {
            user_sub: sub, child_id: childId, name: existing ? existing.name : name,
            aggregate: params[3], raw_blob: params[4], total_watched: params[5],
            brief: null, uploaded_at: now, brief_at: null, order: existing ? existing.order : ++seq,
          });
        }
        return { rows: [], rowCount: 1 };
      }

      if (/^UPDATE\s+oshal_youtube_children\s+SET\s+name\s*=\s*\$3/i.test(sql)) {
        writes.push({ op: 'rename_child', params });
        const key = `${params[0]}::${params[1]}`;
        const cur = children.get(key);
        if (!cur) return { rows: [], rowCount: 0 };
        cur.name = params[2];
        return { rows: [], rowCount: 1 };
      }

      if (/^UPDATE\s+oshal_youtube_children\s+SET\s+brief\s*=\s*\$3/i.test(sql)) {
        writes.push({ op: 'brief_child', params });
        const key = `${params[0]}::${params[1]}`;
        const cur = children.get(key);
        if (!cur) return { rows: [], rowCount: 0 };
        cur.brief = params[2];
        cur.brief_at = new Date().toISOString();
        return { rows: [], rowCount: 1 };
      }

      if (/^DELETE\s+FROM\s+oshal_youtube_children/i.test(sql)) {
        writes.push({ op: 'delete_child', params });
        const deleted = children.delete(`${params[0]}::${params[1]}`);
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }

      if (/^DELETE\s+FROM\s+oshal_youtube_activity/i.test(sql)) {
        writes.push({ op: 'delete_legacy', params });
        legacy.delete(params[0]);
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

function createCaller(pool) {
  const handlers = {};
  withStubs(handlers, () => {
    const mod = require(path.join(ROOT, 'routes', 'youtube-kids-routes.js'));
    mod.createYoutubeKidsRoutes({ pool, appPackageDir: ROOT });
  });
  return async (route, sub, { query = {}, body = {}, params = {}, rawBody = null } = {}) => {
    pool.setRole(route.startsWith('GET ') ? 'reader' : 'writer');
    const sent = { status: 200, body: undefined };
    const res = { status(c) { sent.status = c; return res; }, json(b) { sent.body = b; return res; } };
    const req = {
      oidc: sub ? { isAuthenticated: () => true, user: { sub } } : { isAuthenticated: () => false },
      query,
      params,
      body: rawBody !== null ? Buffer.from(rawBody, 'utf8') : body,
    };
    await handlers[route](req, res);
    return sent;
  };
}

const HISTORY_LEO = JSON.stringify([
  { title: 'Watched Kerbal Rocket Launch', subtitles: [{ name: 'Space Lab' }], time: '2026-10-01T12:00:00Z' },
  { title: 'Watched Mars Rover Build', subtitles: [{ name: 'Space Lab' }], time: '2026-10-02T12:00:00Z' },
]);
const HISTORY_MAYA = JSON.stringify([
  { title: 'Watched Watercolor Clouds', subtitles: [{ name: 'Studio Art' }], time: '2026-10-03T12:00:00Z' },
]);

test('parent adds children by first name, uploads separate histories, reads separate briefs, and deletes cleanly', async () => {
  const pool = createFamilyDb();
  const call = createCaller(pool);

  const leo = await call('POST /children', 'parent-a', { body: { name: 'Leo' } });
  assert.equal(leo.status, 201);
  assert.equal(leo.body.child.childId, 'leo');

  const maya = await call('POST /children', 'parent-a', { body: { name: 'Maya' } });
  assert.equal(maya.status, 201);
  assert.equal(maya.body.children.length, 2);

  const upLeo = await call('POST /upload-takeout', 'parent-a', { query: { childId: 'leo' }, rawBody: HISTORY_LEO });
  assert.equal(upLeo.status, 200);
  assert.equal(upLeo.body.totalWatched, 2);

  const upMaya = await call('POST /upload-takeout', 'parent-a', { query: { childId: 'maya' }, rawBody: HISTORY_MAYA });
  assert.equal(upMaya.status, 200);
  assert.equal(upMaya.body.totalWatched, 1);

  const briefLeo = await call('POST /brief', 'parent-a', { body: { childId: 'leo' } });
  assert.equal(briefLeo.status, 200);
  assert.match(briefLeo.body.brief, /Leo/);

  const briefMaya = await call('POST /brief', 'parent-a', { body: { childId: 'maya' } });
  assert.equal(briefMaya.status, 200);
  assert.match(briefMaya.body.brief, /Maya/);

  const readLeo = await call('GET /brief', 'parent-a', { query: { childId: 'leo' } });
  const readMaya = await call('GET /brief', 'parent-a', { query: { childId: 'maya' } });
  assert.notEqual(readLeo.body.brief, readMaya.body.brief, 'each child keeps its own brief');

  // Deleting Leo removes Leo's row, sealed raw_blob, and brief while leaving Maya intact.
  const delLeo = await call('POST /children/delete', 'parent-a', { body: { childId: 'leo' } });
  assert.equal(delLeo.status, 200);
  assert.equal(pool.childrenMap.has('parent-a::leo'), false);
  assert.equal(delLeo.body.children.length, 1);
  assert.equal(delLeo.body.children[0].childId, 'maya');
  const afterDel = await call('GET /brief', 'parent-a', { query: { childId: 'leo' } });
  assert.equal(afterDel.body.brief, null);
  assert.equal(afterDel.body.childNotFound, true);
});

test('refuses blank names, duplicate names, >8 profiles, unauthenticated callers, and cross-parent access', async () => {
  const pool = createFamilyDb();
  const call = createCaller(pool);

  assert.equal((await call('GET /children', null)).status, 401);
  assert.equal((await call('POST /children', 'parent-a', { body: { name: '   ' } })).status, 400);
  assert.equal((await call('POST /children', 'parent-a', { body: { name: 'X'.repeat(41) } })).status, 400);

  for (let i = 1; i <= 8; i++) {
    const r = await call('POST /children', 'parent-a', { body: { name: `Kid ${i}` } });
    assert.equal(r.status, 201);
  }
  const dup = await call('POST /children', 'parent-a', { body: { name: 'Kid 9' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'child_limit_reached');

  // Parent B sees none of Parent A's 8 profiles and can still create their own Kid 1.
  const listB = await call('GET /children', 'parent-b');
  assert.deepEqual(listB.body.children, []);

  const bCreate = await call('POST /children', 'parent-b', { body: { name: 'Kid 1' } });
  assert.equal(bCreate.status, 201);

  // Parent B cannot rename, delete, upload to, or analyze Parent A's child-2 ('kid-2').
  assert.equal((await call('POST /children/rename', 'parent-b', { body: { childId: 'kid-2', name: 'Hijack' } })).status, 404);
  assert.equal((await call('POST /children/delete', 'parent-b', { body: { childId: 'kid-2' } })).status, 404);
  assert.equal((await call('POST /upload-takeout', 'parent-b', { query: { childId: 'kid-2' }, rawBody: HISTORY_MAYA })).status, 404);
  assert.equal((await call('POST /brief', 'parent-b', { body: { childId: 'kid-2' } })).status, 404);

  // Duplicate name within the same parent is refused with 409 duplicate_child_name.
  const dupName = await call('POST /children', 'parent-b', { body: { name: 'kid 1' } });
  assert.equal(dupName.status, 409);
  assert.equal(dupName.body.error, 'duplicate_child_name');
});

test('legacy oshal_youtube_activity rows read without mutation under GET and promote cleanly on first write', async () => {
  const pool = createFamilyDb({
    'parent-leg': {
      user_sub: 'parent-leg',
      aggregate: JSON.stringify({ totalWatched: 15, distinctChannels: 2, dateRange: { from: '2026-01-01', to: '2026-06-01' }, topChannels: [], monthlyTrend: [], recentTitles: [] }),
      raw_blob: 'sealed:legacy',
      total_watched: 15,
      brief: '## Top interests\n- Classic trains',
      uploaded_at: '2026-06-02T00:00:00Z',
      brief_at: '2026-06-02T00:05:00Z',
    },
  });
  const call = createCaller(pool);

  const list = await call('GET /children', 'parent-leg');
  assert.equal(list.status, 200);
  assert.equal(list.body.children.length, 1);
  assert.equal(list.body.children[0].name, 'Child 1');
  assert.equal(pool.writes.length, 0, 'GET /children performs zero SQL writes');

  // Adding a second child promotes the legacy row to child-1 and deletes the legacy row.
  const second = await call('POST /children', 'parent-leg', { body: { name: 'Nora' } });
  assert.equal(second.status, 201);
  assert.equal(pool.legacyMap.has('parent-leg'), false);
  assert.deepEqual(second.body.children.map((c) => c.name), ['Child 1', 'Nora']);
  assert.equal(second.body.children[0].hasBrief, true);
});

test('manifest and persona declare concierge child-profile tools with forced RLS migrations', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  const persona = fs.readFileSync(path.join(ROOT, 'personas', 'kid-lens-analyzer.yaml'), 'utf8');
  const rls = fs.readFileSync(path.join(ROOT, 'migrations', '003-youtube-children-rls.sql'), 'utf8');
  for (const tool of ['kid-lens-children-list', 'kid-lens-child-brief', 'kid-lens-child-add', 'kid-lens-child-rename', 'kid-lens-child-delete', 'kid-lens-child-analyze']) {
    assert.match(manifest, new RegExp(`name: ${tool}\\b`));
    assert.match(persona, new RegExp(`${tool}:`));
  }
  assert.match(rls, /ALTER TABLE oshal_youtube_children ENABLE ROW LEVEL SECURITY/);
  assert.match(rls, /ALTER TABLE oshal_youtube_children FORCE ROW LEVEL SECURITY/);
});
