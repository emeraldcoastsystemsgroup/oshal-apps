/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit and compiled route-handler tests for
 *     marketing-engine 0.6.7 P3 launch plans, unified marketing calendar deduplication, and
 *     strictly grounded recorded-numbers-only campaign retros: milestone/checklist
 *     normalization, default launch-coordinator starter checklist seeding, chronological
 *     deduplicated calendar merging across engine content, milestones, broadcasts, and
 *     optional Switchboard posts (with clean degradation when Switchboard is absent),
 *     grounded retro NO DATA / exact recorded counts invariant, full route lifecycle,
 *     session auth enforcement, and two-owner 404 isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = require(join(pkgDir, 'routes', 'marketing-launch-model.js'));

const CAMP_A = '11111111-1111-4111-8111-111111111111';
const CAMP_B = '11111111-1111-4111-8111-111111111112';
const PLAN_A = '22222222-2222-4222-8222-222222222221';

/** Load a compiled marketing route module with minimal runtime stubs. */
function loadCompiledModule(relPath) {
  const full = join(pkgDir, relPath);
  const src = readFileSync(full, 'utf8');
  const mod = { exports: {} };
  const stubs = {
    express: { Router: () => makeRouter() },
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/shared/services/database': {
      runRuntimeSchemaBootstrap: async () => {},
      buildOwnerRlsPolicyStatements: () => [],
    },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (b) => b?.confirm === true,
      confirmationRequiredPayload: (g, a) => ({ error: 'confirmation_required', guard: g, action: a }),
    },
    '@/app/connectors/runtime': { loadConnectorSpec: () => null, resolveConnectorActionCreds: async () => null, runConnectorAction: async () => ({ status: 500, body: { ok: false } }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ success: false }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  };
  const cache = new Map();
  const reqStub = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('./')) {
      const target = join(dirname(full), id.endsWith('.js') ? id : `${id}.js`);
      if (!cache.has(target)) cache.set(target, loadCompiledModule(target.slice(pkgDir.length + 1)));
      return cache.get(target);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', src)(
    reqStub, mod, mod.exports, full, dirname(full),
  );
  return mod.exports;
}

/** Minimal synthetic Express Router recording method + path + handler. */
function makeRouter() {
  const routes = [];
  const add = (method) => (routePath, ...handlers) => {
    routes.push({ method, path: routePath, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

/** Invoke a recorded route handler with a synthetic req/res pair. */
async function callRoute(router, method, routePath, { sub = 'owner-a', params = {}, query = {}, body = {} } = {}) {
  const entry = router.routes.find((r) => r.method === method && r.path === routePath);
  assert.ok(entry, `route registered: ${method} ${routePath}`);
  const req = { method, path: routePath, params, query, body, headers: {}, oidc: sub ? { user: { sub } } : null };
  const res = {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
    send(payload) { this.body = payload; this.headersSent = true; return this; },
  };
  await entry.handler(req, res);
  return res;
}

test('normalizeLaunchPlan validates strict dates, milestones, and seeds default launch-coordinator checklist', () => {
  const ok = model.normalizeLaunchPlan({
    campaignId: CAMP_A,
    title: 'v1.0 Launch',
    launchDate: '2026-12-15',
    milestones: [
      { id: 'ms-launch', title: 'Launch day post', dueDate: '2026-12-15', ownerRole: 'human', status: 'pending' },
      { id: 'ms-prep', title: 'UTM check', dueDate: '2026-12-08', ownerRole: 'launch-coordinator', status: 'in_progress' },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.plan.status, 'planning');
  // Milestones sorted chronologically by dueDate.
  assert.deepEqual(ok.plan.milestones.map((m) => m.id), ['ms-prep', 'ms-launch']);
  // Default launch-coordinator starter checklist seeded when omitted.
  assert.equal(ok.plan.checklist.length, 5);
  assert.ok(ok.plan.checklist.some((c) => c.category === 'community' && /Show HN/.test(c.label)));
  assert.ok(ok.plan.checklist.some((c) => c.category === 'compliance'));
  assert.ok(ok.plan.checklist.every((c) => c.done === false));

  // Reject impossible calendar date, invalid UUID, bad status, non-boolean checklist done.
  assert.equal(model.normalizeLaunchPlan({ campaignId: CAMP_A, title: 'Bad date', launchDate: '2026-02-30' }).ok, false);
  assert.equal(model.normalizeLaunchPlan({ campaignId: 'not-uuid', title: 'Bad id', launchDate: '2026-12-15' }).ok, false);
  assert.equal(model.normalizeLaunchPlan({ campaignId: CAMP_A, title: 'Bad st', launchDate: '2026-12-15', status: 'shipped' }).ok, false);
  assert.equal(model.normalizeChecklistItem({ label: 'Check', category: 'asset', done: 'yes' }).ok, false);
  assert.equal(model.normalizeMilestone({ title: 'X', dueDate: '2026-13-01' }).ok, false);
});

test('buildUnifiedCalendar merges engine content, milestones, broadcasts, and Switchboard chronologically with zero duplicates', () => {
  const cal = model.buildUnifiedCalendar({
    contentItems: [
      { item_id: 'c-1', campaign_id: CAMP_A, channel: 'linkedin', title: 'LinkedIn teaser', status: 'approved', scheduled_for: '2026-12-09T15:00:00Z' },
      { item_id: 'c-1', campaign_id: CAMP_A, channel: 'linkedin', title: 'LinkedIn teaser duplicate', status: 'approved', scheduled_for: '2026-12-09T15:00:00Z' },
    ],
    milestones: [
      { planId: PLAN_A, planTitle: 'Q4 Launch', campaignId: CAMP_A, id: 'ms-1', title: 'Landing page freeze', dueDate: '2026-12-05', ownerRole: 'human', status: 'done' },
      { planId: PLAN_A, planTitle: 'Q4 Launch', campaignId: CAMP_A, id: 'ms-1', title: 'Landing page freeze dup', dueDate: '2026-12-05', ownerRole: 'human', status: 'done' },
    ],
    broadcasts: [
      { message_id: 'b-1', campaign_id: CAMP_A, subject: 'Launch day email', status: 'draft', created_at: '2026-12-10T10:00:00Z' },
    ],
    switchboardPosts: [
      { post_id: 'sb-1', platform: 'twitter', body: 'We just shipped Open Swarm 1.0!\nSecond line.', scheduled_at: '2026-12-10T14:00:00Z', status: 'scheduled' },
      { post_id: 'sb-1', platform: 'twitter', body: 'Duplicate switchboard post', scheduled_at: '2026-12-10T14:00:00Z', status: 'scheduled' },
    ],
    switchboardAvailable: true,
  });

  assert.equal(cal.switchboardAvailable, true);
  assert.deepEqual(cal.counts, { total: 4, engine_content: 1, launch_milestone: 1, broadcast: 1, switchboard: 1 });
  assert.deepEqual(cal.items.map((i) => i.id), [
    `launch_milestone:${PLAN_A}:ms-1`,
    'engine_content:c-1',
    'broadcast:b-1',
    'switchboard:sb-1',
  ]);
  assert.equal(cal.items[3].title, 'We just shipped Open Swarm 1.0!');

  // Date window filtering.
  const windowed = model.buildUnifiedCalendar({
    contentItems: [{ item_id: 'c-1', channel: 'linkedin', title: 'In', status: 'approved', scheduled_for: '2026-12-09T15:00:00Z' }],
    milestones: [{ planId: PLAN_A, id: 'ms-1', title: 'Before', dueDate: '2026-12-01', status: 'done' }],
    switchboardPosts: null,
    switchboardAvailable: false,
    fromDate: '2026-12-08',
    toDate: '2026-12-12',
  });
  assert.equal(windowed.switchboardAvailable, false);
  assert.deepEqual(windowed.items.map((i) => i.sourceId), ['c-1']);
});

test('buildCampaignRetro emits explicit NO DATA when unrecorded and cites ONLY recorded figures when present', () => {
  const emptyRetro = model.buildCampaignRetro({
    campaign: { campaign_id: CAMP_A, name: 'Zero Data Campaign' },
    plan: {
      launchDate: '2026-12-10',
      milestones: [
        { id: 'm1', title: 'Prep', dueDate: '2026-12-05', status: 'done' },
        { id: 'm2', title: 'Ship', dueDate: '2026-12-10', status: 'pending' },
      ],
      checklist: [
        { id: 'c1', label: 'Landing', category: 'asset', done: true },
        { id: 'c2', label: 'Footer', category: 'compliance', done: false },
      ],
    },
    metricsRows: [],
    runLedgerRows: [],
    broadcastDeliveryRows: [],
    experiments: [],
    recordedAt: '2026-12-11T00:00:00.000Z',
  });
  assert.equal(emptyRetro.milestonesCompleted, 1);
  assert.equal(emptyRetro.milestonesTotal, 2);
  assert.equal(emptyRetro.checklistCompleted, 1);
  assert.equal(emptyRetro.checklistTotal, 2);
  assert.deepEqual(emptyRetro.metricsBySource, { gsc: 'NO DATA', posthog: 'NO DATA', github: 'NO DATA' });
  assert.deepEqual(emptyRetro.publishOutcomes, { published: 0, skippedConsent: 0, skippedCap: 0, skippedCompliance: 0, error: 0 });
  assert.deepEqual(emptyRetro.broadcastDeliveries, { sent: 0, dryRun: 0, skippedSuppressed: 0, skippedUnconfirmed: 0, skippedCap: 0 });
  assert.deepEqual(emptyRetro.experimentsSummary, { total: 0, scaled: 0, killed: 0, running: 0 });
  assert.match(emptyRetro.markdown, /\*\*gsc\*\*: NO DATA/);
  assert.match(emptyRetro.markdown, /\*\*posthog\*\*: NO DATA/);
  assert.match(emptyRetro.markdown, /\*\*github\*\*: NO DATA/);

  const recordedRetro = model.buildCampaignRetro({
    campaign: { campaign_id: CAMP_A, name: 'Recorded Campaign' },
    plan: {
      launchDate: '2026-12-10',
      milestones: [{ id: 'm1', title: 'Ship', dueDate: '2026-12-10', status: 'done' }],
      checklist: [{ id: 'c1', label: 'Landing', category: 'asset', done: true }],
    },
    metricsRows: [
      { source: 'gsc', event: 'clicks', value: 120 },
      { source: 'gsc', event: 'clicks', value: 30 },
      { source: 'github', event: 'views', value: 85 },
    ],
    runLedgerRows: [
      { outcome: 'published' },
      { outcome: 'published' },
      { outcome: 'skipped_consent' },
      { outcome: 'skipped_cap' },
      { outcome: 'skipped_compliance' },
      { outcome: 'error' },
    ],
    broadcastDeliveryRows: [
      { status: 'sent' },
      { status: 'dry_run' },
      { status: 'skipped_suppressed' },
      { status: 'skipped_unconfirmed' },
      { status: 'skipped_cap' },
    ],
    experiments: [
      { status: 'scaled' },
      { status: 'killed' },
      { status: 'running' },
      { status: 'proposed' },
    ],
    recordedAt: '2026-12-11T00:00:00.000Z',
  });
  assert.deepEqual(recordedRetro.metricsBySource, { gsc: 150, posthog: 'NO DATA', github: 85 });
  assert.deepEqual(recordedRetro.publishOutcomes, { published: 2, skippedConsent: 1, skippedCap: 1, skippedCompliance: 1, error: 1 });
  assert.deepEqual(recordedRetro.broadcastDeliveries, { sent: 1, dryRun: 1, skippedSuppressed: 1, skippedUnconfirmed: 1, skippedCap: 1 });
  assert.deepEqual(recordedRetro.experimentsSummary, { total: 4, scaled: 1, killed: 1, running: 1 });
  assert.match(recordedRetro.markdown, /\*\*gsc\*\*: 150/);
  assert.match(recordedRetro.markdown, /\*\*posthog\*\*: NO DATA/);
  assert.match(recordedRetro.markdown, /\*\*github\*\*: 85/);
});

test('launch plan and calendar route handlers enforce auth, two-owner 404 isolation, Switchboard fallback, and retro persistence', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const plans = new Map();
  let switchboardMissing = true;
  const campaigns = new Map([
    [CAMP_A, { campaign_id: CAMP_A, user_sub: 'owner-a', name: 'Alpha Launch', slug: 'alpha-launch' }],
    [CAMP_B, { campaign_id: CAMP_B, user_sub: 'owner-b', name: 'Beta Launch', slug: 'beta-launch' }],
  ]);

  const pool = {
    query: async (sql, params = []) => {
      if (sql.includes('FROM oshal_marketing_campaigns WHERE campaign_id = $1 AND user_sub = $2')) {
        const c = campaigns.get(params[0]);
        return { rows: c && c.user_sub === params[1] ? [c] : [], rowCount: c && c.user_sub === params[1] ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_launch_plans')) {
        const [owner_sub, campaign_id, title, launch_date, status, milestones, checklist] = params;
        const row = {
          plan_id: PLAN_A, owner_sub, campaign_id, title, launch_date, status,
          milestones: JSON.parse(milestones), checklist: JSON.parse(checklist),
          retro_markdown: null, retro_facts: null, retro_generated_at: null,
        };
        plans.set(PLAN_A, row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_launch_plans lp') && sql.includes('WHERE lp.plan_id = $1 AND lp.owner_sub = $2')) {
        const p = plans.get(params[0]);
        if (!p || p.owner_sub !== params[1]) return { rows: [], rowCount: 0 };
        const c = campaigns.get(p.campaign_id);
        return { rows: [{ ...p, campaign_name: c?.name, campaign_slug: c?.slug }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_launch_plans lp') && sql.includes('WHERE lp.owner_sub = $1')) {
        const mine = [...plans.values()].filter((p) => p.owner_sub === params[0]);
        return { rows: mine, rowCount: mine.length };
      }
      if (sql.includes('FROM oshal_marketing_launch_plans WHERE owner_sub = $1')) {
        const mine = [...plans.values()].filter((p) => p.owner_sub === params[0]);
        return { rows: mine, rowCount: mine.length };
      }
      if (sql.includes('UPDATE oshal_marketing_launch_plans') && sql.includes("status = 'retro_complete'")) {
        const p = plans.get(params[2]);
        if (!p || p.owner_sub !== params[3]) return { rows: [], rowCount: 0 };
        p.status = 'retro_complete';
        p.retro_markdown = params[0];
        p.retro_facts = JSON.parse(params[1]);
        p.retro_generated_at = new Date().toISOString();
        return { rows: [p], rowCount: 1 };
      }
      if (sql.includes('UPDATE oshal_marketing_launch_plans')) {
        const planId = params[params.length - 2];
        const owner = params[params.length - 1];
        const p = plans.get(planId);
        if (!p || p.owner_sub !== owner) return { rows: [], rowCount: 0 };
        if (sql.includes('status =')) p.status = 'ready';
        if (sql.includes('checklist =')) p.checklist = JSON.parse(params.find((x) => typeof x === 'string' && x.startsWith('[')));
        return { rows: [p], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_switchboard_scheduled_posts')) {
        if (switchboardMissing) throw new Error('relation "oshal_switchboard_scheduled_posts" does not exist');
        return { rows: [{ post_id: 'sb-9', platform: 'linkedin', body: 'Switchboard post', scheduled_at: '2026-12-10T16:00:00Z', status: 'scheduled' }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_content')) {
        return { rows: [{ item_id: 'cnt-1', campaign_id: CAMP_A, channel: 'bluesky', title: 'Bluesky teaser', status: 'approved', scheduled_for: '2026-12-09T12:00:00Z' }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_events')) {
        return { rows: [{ source: 'github', event: 'clones', value: 19 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });

  // Unauthenticated refused 401.
  assert.equal((await callRoute(router, 'GET', '/launch-plans', { sub: null })).statusCode, 401);
  assert.equal((await callRoute(router, 'GET', '/calendar', { sub: null })).statusCode, 401);

  // Creating plan for foreign campaign -> 404.
  const foreignCamp = await callRoute(router, 'POST', '/launch-plans', {
    sub: 'owner-a',
    body: { campaignId: CAMP_B, title: 'Foreign', launchDate: '2026-12-10' },
  });
  assert.equal(foreignCamp.statusCode, 404);

  // Owner A creates launch plan with 2 milestones -> 201 + seeded starter checklist.
  const created = await callRoute(router, 'POST', '/launch-plans', {
    sub: 'owner-a',
    body: {
      campaignId: CAMP_A,
      title: 'Alpha Q4 Launch',
      launchDate: '2026-12-10',
      milestones: [
        { id: 'ms-1', title: 'Checklist lock', dueDate: '2026-12-08', ownerRole: 'human', status: 'done' },
        { id: 'ms-2', title: 'Launch day', dueDate: '2026-12-10', ownerRole: 'human', status: 'pending' },
      ],
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.plan.checklist.length, 5);

  // Owner B gets 404 on GET, PATCH, and retro!
  assert.equal((await callRoute(router, 'GET', '/launch-plans/:id', { sub: 'owner-b', params: { id: PLAN_A } })).statusCode, 404);
  assert.equal((await callRoute(router, 'PATCH', '/launch-plans/:id', { sub: 'owner-b', params: { id: PLAN_A }, body: { status: 'ready' } })).statusCode, 404);
  assert.equal((await callRoute(router, 'POST', '/launch-plans/:id/retro', { sub: 'owner-b', params: { id: PLAN_A } })).statusCode, 404);

  // Calendar degrades cleanly when Switchboard table is absent.
  const calNoSb = await callRoute(router, 'GET', '/calendar', { sub: 'owner-a' });
  assert.equal(calNoSb.statusCode, 200);
  assert.equal(calNoSb.body.switchboardAvailable, false);
  assert.equal(calNoSb.body.counts.launch_milestone, 2);
  assert.equal(calNoSb.body.counts.engine_content, 1);

  // Calendar includes Switchboard when available, deduplicated and chronological.
  switchboardMissing = false;
  const calWithSb = await callRoute(router, 'GET', '/calendar', { sub: 'owner-a' });
  assert.equal(calWithSb.statusCode, 200);
  assert.equal(calWithSb.body.switchboardAvailable, true);
  assert.equal(calWithSb.body.counts.switchboard, 1);
  assert.equal(calWithSb.body.counts.total, 4);

  // Invalid date range on /calendar -> 400.
  assert.equal((await callRoute(router, 'GET', '/calendar', { sub: 'owner-a', query: { from: '2026-12-20', to: '2026-12-01' } })).statusCode, 400);

  // Grounded retro records exact github=19 and NO DATA for gsc/posthog.
  const retro = await callRoute(router, 'POST', '/launch-plans/:id/retro', { sub: 'owner-a', params: { id: PLAN_A } });
  assert.equal(retro.statusCode, 200);
  assert.equal(retro.body.plan.status, 'retro_complete');
  assert.equal(retro.body.retro.metricsBySource.github, 19);
  assert.equal(retro.body.retro.metricsBySource.gsc, 'NO DATA');
  assert.equal(retro.body.retro.metricsBySource.posthog, 'NO DATA');
});
