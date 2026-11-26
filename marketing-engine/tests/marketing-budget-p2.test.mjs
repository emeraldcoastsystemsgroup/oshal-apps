/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit, route, weekly-review, and atomic
 *     transaction rollback tests for marketing-engine 0.6.8 P2 campaign-to-finance-project
 *     link and channel_allocation proposals: pure parseChannelAllocationProposal (JSON map,
 *     transfer, single-channel, colon syntax, negative/float/malformed refusals),
 *     applyChannelAllocationMap (integer cents, zero floats, insufficient donor refusal),
 *     buildBudgetProjectPayload (exact POST /api/finance/projects shape), owner-scoped
 *     /campaigns/:id/finance-project, /campaigns/:id/budget-summary, and
 *     /campaigns/:id/reallocation-proposals with two-owner 404 isolation, weekly review
 *     reallocation proposal creation from real channel costs, 428 confirm gate on
 *     channel_allocation approval, atomic success updating campaign + finance lines + ledger,
 *     and explicit mid-transaction failure proving ROLLBACK leaves BOTH ledgers untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const UUID_CAMP = '11111111-1111-4111-8111-111111111111';
const UUID_FIN_PROJ = '22222222-2222-4222-8222-222222222222';
const UUID_PROP = '33333333-3333-4333-8333-333333333333';
const UUID_LINE_EMAIL = '44444444-4444-4444-8444-444444444444';
const UUID_LINE_LINKEDIN = '55555555-5555-4555-8555-555555555555';

/** Load a compiled marketing route module with minimal runtime stubs. */
function loadCompiledModule(relPath, extras = {}) {
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
    '@/shared/services/database/request-identity': {
      runWithSystemIdentity: async (fn) => fn(),
    },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (b) => b?.confirm === true,
      confirmationRequiredPayload: (g, a) => ({ error: 'confirmation_required', guard: g, action: a }),
    },
    '@/app/connectors/runtime': { loadConnectorSpec: () => null, invokeSpecResource: async () => ({ status: 500, body: { ok: false } }), resolveConnectorActionCreds: async () => null, runConnectorAction: async () => ({ status: 500, body: { ok: false } }) },
    '@/app/connectors/runtime/spec-tools': { resolveConnectorSpecCreds: async () => null },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ success: false }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/features/notifications': { notifyOperator: async () => ({ delivered: false, skipped: true }) },
    ...extras,
  };
  const cache = new Map();
  const reqStub = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('./')) {
      const target = join(dirname(full), id.endsWith('.js') ? id : `${id}.js`);
      if (!cache.has(target)) cache.set(target, loadCompiledModule(target.slice(pkgDir.length + 1), extras));
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

/** Stateful transactional in-memory DB double supporting BEGIN/COMMIT/ROLLBACK and injected errors. */
function makeTransactionalState({ failOnFinanceLineUpdate = false } = {}) {
  let committed = {
    campaigns: [{
      campaign_id: UUID_CAMP,
      user_sub: 'owner-a',
      product: 'Open Swarm',
      name: 'Q4 Growth Push',
      slug: 'q4-growth-push',
      motion: 'revenue',
      status: 'active',
      stage: 2,
      budget_monthly_usd: 1000,
      channels: ['email', 'linkedin'],
      channel_allocations: { email: 40000, linkedin: 60000 },
      finance_project_id: UUID_FIN_PROJ,
    }],
    proposals: [{
      entry_id: UUID_PROP,
      user_sub: 'owner-a',
      campaign_id: UUID_CAMP,
      channel: 'linkedin->email',
      field: 'channel_allocation',
      old_value: JSON.stringify({ linkedin: 60000, email: 40000 }),
      new_value: JSON.stringify({ fromChannel: 'linkedin', toChannel: 'email', deltaCents: 12000, allocations: { email: 52000, linkedin: 48000 } }),
      status: 'proposed',
      proposed_by: 'weekly-review',
      decided_by: null,
      decided_at: null,
    }],
    financeProjects: [{
      project_id: UUID_FIN_PROJ,
      owner_sub: 'owner-a',
      slug: 'q4-growth-push',
      name: 'Q4 Growth Push',
      currency: 'USD',
      status: 'active',
      budget_cents: 100000,
      external_ref: `marketing:campaign:${UUID_CAMP}`,
    }],
    financeLines: [
      { line_id: UUID_LINE_EMAIL, owner_sub: 'owner-a', project_id: UUID_FIN_PROJ, name: 'Email budget', channel: 'email', budget_cents: 40000, committed_cents: 5000 },
      { line_id: UUID_LINE_LINKEDIN, owner_sub: 'owner-a', project_id: UUID_FIN_PROJ, name: 'LinkedIn budget', channel: 'linkedin', budget_cents: 60000, committed_cents: 10000 },
    ],
    financeActuals: [
      { actual_id: '66666666-6666-4666-8666-666666666661', owner_sub: 'owner-a', project_id: UUID_FIN_PROJ, line_id: UUID_LINE_EMAIL, source: 'email', amount_cents: 15000, occurred_on: '2026-11-20' },
      { actual_id: '66666666-6666-4666-8666-666666666662', owner_sub: 'owner-a', project_id: UUID_FIN_PROJ, line_id: UUID_LINE_LINKEDIN, source: 'ads', amount_cents: 45000, occurred_on: '2026-11-21' },
    ],
    events: [
      { user_sub: 'owner-a', campaign_slug: 'q4-growth-push', medium: 'email', source: 'posthog', event: 'conversion', value: 30, ts: '2026-11-22T12:00:00Z' },
      { user_sub: 'owner-a', campaign_slug: 'q4-growth-push', medium: 'linkedin', source: 'posthog', event: 'conversion', value: 2, ts: '2026-11-22T12:00:00Z' },
    ],
  };

  function runQuery(store, sql, params = []) {
    if (sql.includes('SELECT * FROM oshal_marketing_campaigns WHERE campaign_id = $1 AND user_sub = $2')) {
      const rows = store.campaigns.filter((c) => c.campaign_id === params[0] && c.user_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('UPDATE oshal_marketing_campaigns') && sql.includes('SET finance_project_id = $1')) {
      const c = store.campaigns.find((x) => x.campaign_id === params[1] && x.user_sub === params[2]);
      if (!c) return { rows: [], rowCount: 0 };
      c.finance_project_id = params[0];
      return { rows: [c], rowCount: 1 };
    }
    if (sql.includes('UPDATE oshal_marketing_campaigns') && sql.includes('SET channel_allocations = $1::jsonb')) {
      const c = store.campaigns.find((x) => x.campaign_id === params[2] && x.user_sub === params[3]);
      if (!c) return { rows: [], rowCount: 0 };
      c.channel_allocations = JSON.parse(params[0]);
      c.budget_monthly_usd = params[1];
      return { rows: [c], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM oshal_marketing_budget_ledger WHERE entry_id = $1 AND user_sub = $2')) {
      const rows = store.proposals.filter((p) => p.entry_id === params[0] && p.user_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('UPDATE oshal_marketing_budget_ledger') && sql.includes("SET status = 'applied'")) {
      const p = store.proposals.find((x) => x.entry_id === params[1] && x.user_sub === params[2] && x.status === 'proposed');
      if (!p) return { rows: [], rowCount: 0 };
      p.status = 'applied';
      p.decided_by = params[0];
      p.decided_at = '2026-11-26T00:00:00Z';
      return { rows: [p], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_budget_ledger')) {
      const row = {
        entry_id: '77777777-7777-4777-8777-777777777777',
        user_sub: params[0], campaign_id: params[1], channel: params[2],
        field: 'channel_allocation', old_value: params[3], new_value: params[4],
        status: 'proposed', proposed_by: params[5],
      };
      store.proposals.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_finance_projects') && sql.includes('WHERE project_id = $1 AND owner_sub = $2')) {
      const rows = store.financeProjects.filter((p) => p.project_id === params[0] && p.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('UPDATE oshal_finance_project_lines')) {
      if (failOnFinanceLineUpdate) {
        const err = new Error('simulated finance line write failure');
        err.code = '40001';
        throw err;
      }
      const line = store.financeLines.find((l) => l.project_id === params[1] && l.owner_sub === params[2] && l.channel === params[3]);
      if (!line) return { rows: [], rowCount: 0 };
      line.budget_cents = params[0];
      return { rows: [{ line_id: line.line_id }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_finance_project_lines')) {
      const line = { line_id: '88888888-8888-4888-8888-888888888888', owner_sub: params[0], project_id: params[1], name: params[2], channel: params[3], budget_cents: params[4], committed_cents: 0 };
      store.financeLines.push(line);
      return { rows: [line], rowCount: 1 };
    }
    if (sql.includes('UPDATE oshal_finance_projects')) {
      const p = store.financeProjects.find((x) => x.project_id === params[1] && x.owner_sub === params[2]);
      if (p) p.budget_cents = params[0];
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_finance_project_lines')) {
      const rows = store.financeLines.filter((l) => l.project_id === params[0] && l.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_finance_project_actuals a')) {
      const totals = new Map();
      for (const a of store.financeActuals.filter((x) => x.owner_sub === params[0] && x.project_id === params[1])) {
        const ln = store.financeLines.find((l) => l.line_id === a.line_id);
        const ch = ln ? ln.channel : 'general';
        totals.set(ch, (totals.get(ch) || 0) + a.amount_cents);
      }
      return { rows: [...totals.entries()].map(([channel, spend_cents]) => ({ channel, spend_cents })), rowCount: totals.size };
    }
    if (sql.includes('FROM oshal_finance_project_actuals')) {
      const rows = store.financeActuals.filter((a) => a.project_id === params[0] && a.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_events')) {
      const rows = store.events.filter((e) => e.user_sub === params[0] && (!params[1] || e.campaign_slug === params[1] || String(params[1]).includes('T')));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  const txLog = [];
  const pool = {
    query: async (sql, params) => runQuery(committed, sql, params),
    connect: async () => {
      let working = null;
      return {
        query: async (sql, params) => {
          const trimmed = sql.trim().toUpperCase();
          if (trimmed === 'BEGIN') { txLog.push('BEGIN'); working = structuredClone(committed); return { rows: [], rowCount: 0 }; }
          if (trimmed === 'COMMIT') { txLog.push('COMMIT'); committed = working; working = null; return { rows: [], rowCount: 0 }; }
          if (trimmed === 'ROLLBACK') { txLog.push('ROLLBACK'); working = null; return { rows: [], rowCount: 0 }; }
          return runQuery(working || committed, sql, params);
        },
        release() {},
      };
    },
  };
  return { pool, getState: () => committed, txLog };
}

test('pure model: parseChannelAllocationProposal handles JSON map, transfer, single-channel, and colon syntax while refusing invalid inputs', () => {
  const model = loadCompiledModule('routes/marketing-budget-model.js');
  const mapRes = model.parseChannelAllocationProposal(JSON.stringify({ allocations: { email: 40000, linkedin: 60000 } }));
  assert.equal(mapRes.ok, true);
  assert.deepEqual(mapRes.value, { kind: 'map', allocations: { email: 40000, linkedin: 60000 } });

  const txRes = model.parseChannelAllocationProposal({ fromChannel: 'linkedin', toChannel: 'email', deltaCents: 12000 });
  assert.equal(txRes.ok, true);
  assert.deepEqual(txRes.value, { kind: 'transfer', fromChannel: 'linkedin', toChannel: 'email', deltaCents: 12000 });

  const colonRes = model.parseChannelAllocationProposal('email:40000, linkedin:60000');
  assert.equal(colonRes.ok, true);
  assert.deepEqual(colonRes.value, { kind: 'map', allocations: { email: 40000, linkedin: 60000 } });

  for (const bad of [
    '',
    'not-valid',
    'email:-500',
    'email:12.5',
    JSON.stringify({ allocations: { email: -100 } }),
    JSON.stringify({ allocations: { email: 40.5 } }),
    JSON.stringify({ allocations: {} }),
    JSON.stringify({ fromChannel: 'email', toChannel: 'email', deltaCents: 500 }),
    JSON.stringify({ fromChannel: 'linkedin', toChannel: 'email', deltaCents: 0 }),
    '{"broken":',
  ]) {
    const r = model.parseChannelAllocationProposal(bad);
    assert.equal(r.ok, false, `must reject ${JSON.stringify(bad)}`);
    assert.equal(r.error, 'invalid_channel_allocation');
  }
});

test('pure model: applyChannelAllocationMap and buildBudgetProjectPayload compute exact integer cents with zero float drift', () => {
  const model = loadCompiledModule('routes/marketing-budget-model.js');
  const applied = model.applyChannelAllocationMap(
    { email: 40000, linkedin: 60000 },
    { fromChannel: 'linkedin', toChannel: 'email', deltaCents: 12500 },
  );
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.value.allocations, { email: 52500, linkedin: 47500 });
  assert.equal(applied.value.totalBudgetCents, 100000);
  assert.equal(applied.value.budgetMonthlyUsd, 1000);

  const overdraft = model.applyChannelAllocationMap(
    { email: 10000, linkedin: 5000 },
    { fromChannel: 'linkedin', toChannel: 'email', deltaCents: 6000 },
  );
  assert.equal(overdraft.ok, false);
  assert.equal(overdraft.error, 'insufficient_channel_allocation');

  // Odd dollar split (10000 cents across 3 channels -> 3334 + 3333 + 3333 = 10000, zero drift).
  const payload = model.buildBudgetProjectPayload({
    campaign_id: UUID_CAMP,
    name: 'Three-Channel Launch',
    slug: 'three-channel-launch',
    budget_monthly_usd: 100,
    channels: ['email', 'linkedin', 'mastodon'],
    channel_allocations: {},
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.value.externalRef, `marketing:campaign:${UUID_CAMP}`);
  assert.equal(payload.value.budgetCents, 10000);
  assert.deepEqual(payload.value.lines.map((l) => l.budgetCents), [3334, 3333, 3333]);
});

test('campaign finance-project link, budget-summary, reallocation-proposals, and two-owner 404 isolation', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const db = makeTransactionalState();
  const router = routesMod.createMarketingRoutes({ pool: db.pool, appPackageDir: pkgDir });

  // Owner B gets 404 on Owner A's campaign endpoints.
  assert.equal((await callRoute(router, 'POST', '/campaigns/:id/finance-project', { sub: 'owner-b', params: { id: UUID_CAMP }, body: { financeProjectId: UUID_FIN_PROJ } })).statusCode, 404);
  assert.equal((await callRoute(router, 'GET', '/campaigns/:id/budget-summary', { sub: 'owner-b', params: { id: UUID_CAMP } })).statusCode, 404);
  assert.equal((await callRoute(router, 'POST', '/campaigns/:id/reallocation-proposals', { sub: 'owner-b', params: { id: UUID_CAMP }, body: {} })).statusCode, 404);

  // Invalid financeProjectId -> 400.
  const badLink = await callRoute(router, 'POST', '/campaigns/:id/finance-project', { params: { id: UUID_CAMP }, body: { financeProjectId: 'not-a-uuid' } });
  assert.equal(badLink.statusCode, 400);
  assert.equal(badLink.body.error, 'invalid_finance_project_id');

  // Valid link & live budget summary.
  const linkRes = await callRoute(router, 'POST', '/campaigns/:id/finance-project', { params: { id: UUID_CAMP }, body: { financeProjectId: UUID_FIN_PROJ } });
  assert.equal(linkRes.statusCode, 200);
  assert.equal(linkRes.body.financeProjectId, UUID_FIN_PROJ);

  const sumRes = await callRoute(router, 'GET', '/campaigns/:id/budget-summary', { params: { id: UUID_CAMP } });
  assert.equal(sumRes.statusCode, 200);
  assert.equal(sumRes.body.financeAvailable, true);
  assert.equal(sumRes.body.linkedSummary.totalBudgetCents, 100000);
  assert.equal(sumRes.body.linkedSummary.totalCommittedCents, 15000);
  assert.equal(sumRes.body.linkedSummary.totalActualCents, 60000);
  assert.equal(sumRes.body.linkedSummary.totalVarianceCents, 40000);

  // Reallocation proposals from real recorded Finance actuals (email $150/30 conv = $5 CPA vs linkedin $450/2 conv = $225 CPA).
  const reallocRes = await callRoute(router, 'POST', '/campaigns/:id/reallocation-proposals', { params: { id: UUID_CAMP }, body: {} });
  assert.equal(reallocRes.statusCode, 201);
  assert.equal(reallocRes.body.proposed, true);
  assert.equal(reallocRes.body.proposals[0].field, 'channel_allocation');
  assert.equal(reallocRes.body.proposals[0].status, 'proposed');
  const parsedNew = JSON.parse(reallocRes.body.proposals[0].new_value);
  assert.equal(parsedNew.fromChannel, 'linkedin');
  assert.equal(parsedNew.toChannel, 'email');
  assert.equal(parsedNew.deltaCents, 12000);
  assert.deepEqual(parsedNew.allocations, { email: 52000, linkedin: 48000 });
});

test('decideBudgetProposal on channel_allocation requires confirm:true (428) and commits campaign + finance lines + ledger atomically', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const db = makeTransactionalState();
  const router = routesMod.createMarketingRoutes({ pool: db.pool, appPackageDir: pkgDir });

  // Missing confirm: true -> 428, zero state mutation.
  const needConfirm = await callRoute(router, 'POST', '/budget/proposals/:id/decide', {
    params: { id: UUID_PROP },
    body: { decision: 'approve' },
  });
  assert.equal(needConfirm.statusCode, 428);
  assert.equal(db.getState().proposals[0].status, 'proposed');

  // Confirmed approval -> BEGIN ... COMMIT updating campaign, finance lines, and ledger.
  const okRes = await callRoute(router, 'POST', '/budget/proposals/:id/decide', {
    params: { id: UUID_PROP },
    body: { decision: 'approve', confirm: true },
  });
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.proposal.status, 'applied');
  assert.equal(okRes.body.financeSynced, true);
  assert.deepEqual(okRes.body.allocations, { email: 52000, linkedin: 48000 });
  assert.deepEqual(db.txLog, ['BEGIN', 'COMMIT']);
  assert.deepEqual(db.getState().campaigns[0].channel_allocations, { email: 52000, linkedin: 48000 });
  assert.equal(db.getState().financeLines.find((l) => l.channel === 'email').budget_cents, 52000);
  assert.equal(db.getState().financeLines.find((l) => l.channel === 'linkedin').budget_cents, 48000);
  assert.equal(db.getState().proposals[0].status, 'applied');
});

test('atomic failure test: when updating finance lines throws mid-transaction, ROLLBACK leaves BOTH campaign/finance lines AND budget ledger untouched', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const db = makeTransactionalState({ failOnFinanceLineUpdate: true });
  const router = routesMod.createMarketingRoutes({ pool: db.pool, appPackageDir: pkgDir });

  const failed = await callRoute(router, 'POST', '/budget/proposals/:id/decide', {
    params: { id: UUID_PROP },
    body: { decision: 'approve', confirm: true },
  });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(db.txLog, ['BEGIN', 'ROLLBACK']);

  // Neither ledger changed: budget ledger is STILL 'proposed', campaign & finance lines are STILL 40000/60000!
  assert.equal(db.getState().proposals[0].status, 'proposed');
  assert.deepEqual(db.getState().campaigns[0].channel_allocations, { email: 40000, linkedin: 60000 });
  assert.equal(db.getState().financeLines.find((l) => l.channel === 'email').budget_cents, 40000);
  assert.equal(db.getState().financeLines.find((l) => l.channel === 'linkedin').budget_cents, 60000);
});

test('weekly review runs reallocationProposals() from real recorded channel costs and includes the proposal on the backlog ticket', async () => {
  const opsMod = loadCompiledModule('routes/marketing-ops-routes.js');
  const insertedProposals = [];
  const tickets = [];
  const pool = {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT DISTINCT user_sub FROM oshal_marketing_campaigns WHERE status = 'active'")) {
        return { rows: [{ user_sub: 'owner-a' }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_campaigns') && sql.includes("status = 'active'")) {
        return {
          rows: [{
            campaign_id: UUID_CAMP, name: 'Q4 Growth Push', slug: 'q4-growth-push',
            budget_monthly_usd: 1000, channels: ['email', 'linkedin'],
            channel_allocations: { email: 40000, linkedin: 60000 }, finance_project_id: UUID_FIN_PROJ,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("field = 'channel_allocation' AND status = 'proposed'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM oshal_finance_project_actuals a')) {
        return { rows: [{ channel: 'email', spend_cents: 15000 }, { channel: 'linkedin', spend_cents: 45000 }], rowCount: 2 };
      }
      if (sql.includes('FROM oshal_marketing_events')) {
        return {
          rows: [
            { ts: '2026-11-23T12:00:00Z', source: 'posthog', event: 'conversion', medium: 'email', campaign_slug: 'q4-growth-push', value: 30 },
            { ts: '2026-11-23T12:00:00Z', source: 'posthog', event: 'conversion', medium: 'linkedin', campaign_slug: 'q4-growth-push', value: 2 },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('INSERT INTO oshal_marketing_budget_ledger')) {
        const row = { entry_id: UUID_PROP, campaign_id: params[1], channel: params[2], field: 'channel_allocation', old_value: params[3], new_value: params[4], status: 'proposed', proposed_by: params[5] };
        insertedProposals.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('SELECT COUNT(*)::int AS n FROM oshal_marketing_budget_ledger')) {
        return { rows: [{ n: insertedProposals.length }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const ticketService = {
    createTicket: async (input) => {
      tickets.push(input);
      return { ticketId: 'ticket-1', ...input };
    },
  };
  const summary = await opsMod.runMarketingWeeklyReview({ pool, ticketService });
  assert.match(summary.summary, /tickets=1/);
  assert.equal(insertedProposals.length, 1);
  assert.equal(insertedProposals[0].proposed_by, 'weekly-review');
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].status, 'backlog');
  assert.match(tickets[0].description, /\[channel_allocation\] Q4 Growth Push: linkedin -> email/);
});
