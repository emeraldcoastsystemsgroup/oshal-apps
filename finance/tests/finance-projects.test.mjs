/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5 unit and route lifecycle suite: pure integer-cents budget/committed/actual/variance rollups (zero float drift, over-budget detection, all six actual sources), full /api/finance/projects* CRUD lifecycle, invalid source 400 refusal, cross-project lineId 404 refusal, two-owner 404 isolation, and zero per-request DDL verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = path.resolve(HERE, '..', 'routes');

const model = require(path.join(ROUTES, 'finance-projects-model.js'));
const routesMod = require(path.join(ROUTES, 'finance-projects.js'));

const DDL_RE = /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|POLICY|SCHEMA|EXTENSION)\b/i;

/** In-memory owner-scoped SQL store emulating PostgreSQL queries used by finance-projects.js. */
function makeMemoryPool() {
  const projects = new Map();
  const lines = new Map();
  const actuals = new Map();
  const statements = [];

  return {
    statements,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      assert.doesNotMatch(text, DDL_RE, `project route must never execute DDL: ${text}`);
      statements.push({ text, params });

      if (/^SELECT project_id FROM oshal_finance_projects WHERE owner_sub = \$1 AND slug = \$2$/i.test(text)) {
        const found = [...projects.values()].filter((p) => p.owner_sub === params[0] && p.slug === params[1]);
        return { rows: found.map((p) => ({ project_id: p.project_id })), rowCount: found.length };
      }
      if (/^INSERT INTO oshal_finance_projects/i.test(text)) {
        for (const p of projects.values()) {
          if (p.owner_sub === params[0] && p.slug === params[1]) {
            const err = new Error('duplicate key value violates unique constraint');
            err.code = '23505';
            throw err;
          }
        }
        const now = new Date().toISOString();
        const row = {
          project_id: randomUUID(), owner_sub: params[0], slug: params[1], name: params[2],
          currency: params[3], status: params[4], budget_cents: String(params[5]),
          external_ref: params[6], notes: params[7], created_at: now, updated_at: now,
        };
        projects.set(row.project_id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/^SELECT .* FROM oshal_finance_projects WHERE owner_sub = \$1/i.test(text)) {
        const rows = [...projects.values()].filter((p) => p.owner_sub === params[0]);
        return { rows, rowCount: rows.length };
      }
      if (/^SELECT .* FROM oshal_finance_projects WHERE project_id = \$1 AND owner_sub = \$2$/i.test(text)) {
        const p = projects.get(params[0]);
        const rows = p && p.owner_sub === params[1] ? [p] : [];
        return { rows, rowCount: rows.length };
      }
      if (/^UPDATE oshal_finance_projects SET /i.test(text)) {
        const projectId = params[params.length - 2];
        const sub = params[params.length - 1];
        const p = projects.get(projectId);
        if (!p || p.owner_sub !== sub) return { rows: [], rowCount: 0 };
        const setClause = text.slice(text.indexOf('SET ') + 4, text.indexOf(' WHERE '));
        for (const part of setClause.split(',').map((s) => s.trim())) {
          const m = /^(\w+) = \$(\d+)$/.exec(part);
          if (m) p[m[1]] = m[1] === 'budget_cents' ? String(params[Number(m[2]) - 1]) : params[Number(m[2]) - 1];
        }
        p.updated_at = new Date().toISOString();
        return { rows: [{ project_id: p.project_id }], rowCount: 1 };
      }
      if (/^DELETE FROM oshal_finance_projects WHERE project_id = \$1 AND owner_sub = \$2$/i.test(text)) {
        const p = projects.get(params[0]);
        if (!p || p.owner_sub !== params[1]) return { rows: [], rowCount: 0 };
        projects.delete(params[0]);
        return { rows: [{ project_id: params[0] }], rowCount: 1 };
      }
      if (/^INSERT INTO oshal_finance_project_lines/i.test(text)) {
        const now = new Date().toISOString();
        const row = {
          line_id: randomUUID(), owner_sub: params[0], project_id: params[1], name: params[2],
          channel: params[3], budget_cents: String(params[4]), committed_cents: String(params[5]),
          notes: params[6], created_at: now, updated_at: now,
        };
        lines.set(row.line_id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/^SELECT .* FROM oshal_finance_project_lines WHERE owner_sub = \$1 ORDER/i.test(text)) {
        const rows = [...lines.values()].filter((l) => l.owner_sub === params[0]);
        return { rows, rowCount: rows.length };
      }
      if (/^SELECT .* FROM oshal_finance_project_lines WHERE project_id = \$1 AND owner_sub = \$2/i.test(text)) {
        const rows = [...lines.values()].filter((l) => l.project_id === params[0] && l.owner_sub === params[1]);
        return { rows, rowCount: rows.length };
      }
      if (/^SELECT line_id FROM oshal_finance_project_lines WHERE line_id = \$1 AND project_id = \$2 AND owner_sub = \$3$/i.test(text)) {
        const l = lines.get(params[0]);
        const rows = l && l.project_id === params[1] && l.owner_sub === params[2] ? [{ line_id: l.line_id }] : [];
        return { rows, rowCount: rows.length };
      }
      if (/^UPDATE oshal_finance_project_lines SET /i.test(text)) {
        const lineId = params[params.length - 3];
        const projectId = params[params.length - 2];
        const sub = params[params.length - 1];
        const l = lines.get(lineId);
        if (!l || l.project_id !== projectId || l.owner_sub !== sub) return { rows: [], rowCount: 0 };
        const setClause = text.slice(text.indexOf('SET ') + 4, text.indexOf(' WHERE '));
        for (const part of setClause.split(',').map((s) => s.trim())) {
          const m = /^(\w+) = \$(\d+)$/.exec(part);
          if (m) l[m[1]] = m[1].endsWith('_cents') ? String(params[Number(m[2]) - 1]) : params[Number(m[2]) - 1];
        }
        l.updated_at = new Date().toISOString();
        return { rows: [l], rowCount: 1 };
      }
      if (/^DELETE FROM oshal_finance_project_lines WHERE project_id = \$1 AND owner_sub = \$2$/i.test(text)) {
        for (const [id, l] of lines.entries()) {
          if (l.project_id === params[0] && l.owner_sub === params[1]) lines.delete(id);
        }
        return { rows: [], rowCount: 0 };
      }
      if (/^INSERT INTO oshal_finance_project_actuals/i.test(text)) {
        const now = new Date().toISOString();
        const row = {
          actual_id: randomUUID(), owner_sub: params[0], project_id: params[1], line_id: params[2],
          source: params[3], amount_cents: String(params[4]), occurred_on: params[5],
          reference_id: params[6], evidence: JSON.parse(params[7]), note: params[8], created_at: now,
        };
        actuals.set(row.actual_id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/^SELECT .* FROM oshal_finance_project_actuals WHERE owner_sub = \$1 ORDER/i.test(text)) {
        const rows = [...actuals.values()].filter((a) => a.owner_sub === params[0]);
        return { rows, rowCount: rows.length };
      }
      if (/^SELECT .* FROM oshal_finance_project_actuals WHERE project_id = \$1 AND owner_sub = \$2/i.test(text)) {
        const rows = [...actuals.values()].filter((a) => a.project_id === params[0] && a.owner_sub === params[1]);
        return { rows, rowCount: rows.length };
      }
      if (/^DELETE FROM oshal_finance_project_actuals WHERE actual_id = \$1 AND project_id = \$2 AND owner_sub = \$3/i.test(text)) {
        const a = actuals.get(params[0]);
        if (!a || a.project_id !== params[1] || a.owner_sub !== params[2]) return { rows: [], rowCount: 0 };
        actuals.delete(params[0]);
        return { rows: [{ actual_id: params[0] }], rowCount: 1 };
      }
      if (/^DELETE FROM oshal_finance_project_actuals WHERE project_id = \$1 AND owner_sub = \$2$/i.test(text)) {
        for (const [id, a] of actuals.entries()) {
          if (a.project_id === params[0] && a.owner_sub === params[1]) actuals.delete(id);
        }
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unhandled memory SQL: ${text}`);
    },
  };
}

/** Mount project routes on a recording router and expose an invoker. */
function makeRouterHarness(pool) {
  const handlers = {};
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const router = { get: record('GET'), post: record('POST'), patch: record('PATCH'), delete: record('DELETE') };
  routesMod.mountFinanceProjectsRoutes(router, pool);
  async function invoke(key, { sub = 'owner-a', body = {}, params = {} } = {}) {
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    const req = {
      oidc: sub ? { user: { sub } } : undefined,
      body,
      params,
    };
    await handlers[key](req, res);
    return res;
  }
  return { handlers, invoke };
}

test('summarizeFinanceProject computes exact integer-cent rollups across all 6 sources with zero float drift', () => {
  const project = {
    projectId: randomUUID(), slug: 'q4-launch', name: 'Q4 Launch', currency: 'USD',
    status: 'active', budgetCents: 100000, externalRef: 'marketing:campaign:abc', notes: '',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  };
  const lineEmail = {
    lineId: randomUUID(), projectId: project.projectId, name: 'Email', channel: 'email',
    budgetCents: 30000, committedCents: 5000, notes: '', createdAt: null, updatedAt: null,
  };
  const lineAds = {
    lineId: randomUUID(), projectId: project.projectId, name: 'Paid Ads', channel: 'ads',
    budgetCents: 50000, committedCents: 10000, notes: '', createdAt: null, updatedAt: null,
  };
  const actuals = [
    { actualId: randomUUID(), projectId: project.projectId, lineId: lineEmail.lineId, source: 'email', amountCents: 10, occurredOn: '2026-11-02', referenceId: null, evidence: {}, note: '', createdAt: null },
    { actualId: randomUUID(), projectId: project.projectId, lineId: lineEmail.lineId, source: 'sms', amountCents: 20, occurredOn: '2026-11-03', referenceId: null, evidence: {}, note: '', createdAt: null },
    { actualId: randomUUID(), projectId: project.projectId, lineId: lineAds.lineId, source: 'ads', amountCents: 55000, occurredOn: '2026-11-04', referenceId: null, evidence: {}, note: '', createdAt: null },
    { actualId: randomUUID(), projectId: project.projectId, lineId: lineAds.lineId, source: 'plaid', amountCents: 1500, occurredOn: '2026-11-05', referenceId: null, evidence: {}, note: '', createdAt: null },
    { actualId: randomUUID(), projectId: project.projectId, lineId: null, source: 'manual', amountCents: 333, occurredOn: '2026-11-06', referenceId: null, evidence: {}, note: 'misc', createdAt: null },
    { actualId: randomUUID(), projectId: project.projectId, lineId: null, source: 'invoice', amountCents: 667, occurredOn: '2026-11-07', referenceId: 'inv-1', evidence: {}, note: '', createdAt: null },
  ];

  const sum = model.summarizeFinanceProject(project, [lineEmail, lineAds], actuals);
  assert.equal(sum.projectBudgetCents, 100000);
  assert.equal(sum.allocatedCents, 80000);
  assert.equal(sum.unallocatedBudgetCents, 20000);
  assert.equal(sum.totalBudgetCents, 80000);
  assert.equal(sum.totalCommittedCents, 15000);
  assert.equal(sum.totalActualCents, 57530);
  assert.equal(sum.totalVarianceCents, 22470);
  assert.equal(sum.remainingAfterCommittedCents, 7470);
  assert.equal(sum.unassignedActualCents, 1000);
  assert.equal(sum.unassignedActualCount, 2);
  assert.equal(sum.overBudget, false);
  assert.deepEqual(sum.bySource, { manual: 333, plaid: 1500, ads: 55000, sms: 20, email: 10, invoice: 667 });

  const emailSum = sum.lines.find((l) => l.lineId === lineEmail.lineId);
  assert.equal(emailSum.actualCents, 30);
  assert.equal(emailSum.varianceCents, 29970);
  assert.equal(emailSum.overBudget, false);

  const adsSum = sum.lines.find((l) => l.lineId === lineAds.lineId);
  assert.equal(adsSum.actualCents, 56500);
  assert.equal(adsSum.varianceCents, -6500);
  assert.equal(adsSum.overBudget, true);
});

test('model rejects floating-point cents, invalid sources, invalid dates, and oversize evidence', () => {
  assert.equal(model.normalizeProjectInput({ name: 'Float Test', budgetCents: 12.34 }).ok, false);
  assert.equal(model.normalizeProjectInput({ name: 'Neg Test', budgetCents: -100 }).ok, false);
  assert.equal(model.normalizeProjectActualInput({ source: 'crypto', amountCents: 100, occurredOn: '2026-11-10' }).ok, false);
  assert.equal(model.normalizeProjectActualInput({ source: 'manual', amountCents: 0, occurredOn: '2026-11-10' }).ok, false);
  assert.equal(model.normalizeProjectActualInput({ source: 'manual', amountCents: 100, occurredOn: '2026-02-31' }).ok, false);
  assert.equal(model.normalizeProjectActualInput({ source: 'manual', amountCents: 100, occurredOn: '2026-11-10', evidence: { big: 'x'.repeat(9000) } }).ok, false);
  assert.deepEqual([...model.ACTUAL_SOURCES], ['manual', 'plaid', 'ads', 'sms', 'email', 'invoice']);
});

test('full route lifecycle, cross-project lineId refusal, invalid source 400, and two-owner 404 isolation', async () => {
  const pool = makeMemoryPool();
  const { invoke } = makeRouterHarness(pool);

  const unauth = await invoke('GET /projects', { sub: null });
  assert.equal(unauth.statusCode, 401);

  const created = await invoke('POST /projects', {
    sub: 'owner-a',
    body: {
      name: 'Launch Campaign',
      budgetCents: 100000,
      externalRef: 'marketing:campaign:launch-1',
      lines: [
        { name: 'Email', channel: 'email', budgetCents: 40000, committedCents: 5000 },
      ],
    },
  });
  assert.equal(created.statusCode, 201);
  const projectId = created.body.project.projectId;
  const emailLineId = created.body.lines[0].lineId;

  const secondProj = await invoke('POST /projects', {
    sub: 'owner-a',
    body: { name: 'Other Project', budgetCents: 50000, lines: [{ name: 'Other Line', channel: 'ads', budgetCents: 50000 }] },
  });
  assert.equal(secondProj.statusCode, 201);
  const otherProjectLineId = secondProj.body.lines[0].lineId;

  const addedLine = await invoke('POST /projects/:id/lines', {
    sub: 'owner-a',
    params: { id: projectId },
    body: { name: 'Social', channel: 'linkedin', budgetCents: 60000, committedCents: 0 },
  });
  assert.equal(addedLine.statusCode, 201);
  const socialLineId = addedLine.body.line.lineId;

  const patchedLine = await invoke('PATCH /projects/:id/lines/:lineId', {
    sub: 'owner-a',
    params: { id: projectId, lineId: socialLineId },
    body: { committedCents: 15000 },
  });
  assert.equal(patchedLine.statusCode, 200);
  assert.equal(patchedLine.body.line.committedCents, 15000);

  const badSource = await invoke('POST /projects/:id/actuals', {
    sub: 'owner-a',
    params: { id: projectId },
    body: { lineId: emailLineId, source: 'wire', amountCents: 1000, occurredOn: '2026-11-20' },
  });
  assert.equal(badSource.statusCode, 400);
  assert.equal(badSource.body.error, 'invalid_source');

  const crossProjectLine = await invoke('POST /projects/:id/actuals', {
    sub: 'owner-a',
    params: { id: projectId },
    body: { lineId: otherProjectLineId, source: 'manual', amountCents: 1000, occurredOn: '2026-11-20' },
  });
  assert.equal(crossProjectLine.statusCode, 404);
  assert.equal(crossProjectLine.body.error, 'line_not_found');

  const act1 = await invoke('POST /projects/:id/actuals', {
    sub: 'owner-a',
    params: { id: projectId },
    body: { lineId: emailLineId, source: 'email', amountCents: 7500, occurredOn: '2026-11-20', note: 'Resend batch' },
  });
  assert.equal(act1.statusCode, 201);

  const act2 = await invoke('POST /projects/:id/actuals', {
    sub: 'owner-a',
    params: { id: projectId },
    body: { lineId: socialLineId, source: 'manual', amountCents: 12500, occurredOn: '2026-11-21', note: 'Sponsor slot' },
  });
  assert.equal(act2.statusCode, 201);

  const summary = await invoke('GET /projects/:id/summary', { sub: 'owner-a', params: { id: projectId } });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.body.totalBudgetCents, 100000);
  assert.equal(summary.body.totalCommittedCents, 20000);
  assert.equal(summary.body.totalActualCents, 20000);
  assert.equal(summary.body.totalVarianceCents, 80000);
  assert.equal(summary.body.bySource.email, 7500);
  assert.equal(summary.body.bySource.manual, 12500);

  // Owner B isolation across every route
  const ownerBList = await invoke('GET /projects', { sub: 'owner-b' });
  assert.equal(ownerBList.statusCode, 200);
  assert.equal(ownerBList.body.projects.length, 0);

  assert.equal((await invoke('GET /projects/:id/summary', { sub: 'owner-b', params: { id: projectId } })).statusCode, 404);
  assert.equal((await invoke('PATCH /projects/:id', { sub: 'owner-b', params: { id: projectId }, body: { status: 'paused' } })).statusCode, 404);
  assert.equal((await invoke('POST /projects/:id/lines', { sub: 'owner-b', params: { id: projectId }, body: { name: 'Injected', budgetCents: 100 } })).statusCode, 404);
  assert.equal((await invoke('PATCH /projects/:id/lines/:lineId', { sub: 'owner-b', params: { id: projectId, lineId: emailLineId }, body: { budgetCents: 1 } })).statusCode, 404);
  assert.equal((await invoke('POST /projects/:id/actuals', { sub: 'owner-b', params: { id: projectId }, body: { source: 'manual', amountCents: 500, occurredOn: '2026-11-22' } })).statusCode, 404);
  assert.equal((await invoke('DELETE /projects/:id/actuals/:actualId', { sub: 'owner-b', params: { id: projectId, actualId: act1.body.actual.actualId } })).statusCode, 404);
  assert.equal((await invoke('DELETE /projects/:id', { sub: 'owner-b', params: { id: projectId } })).statusCode, 404);

  // Owner A removes one actual -> totalActualCents drops cleanly
  const delAct = await invoke('DELETE /projects/:id/actuals/:actualId', {
    sub: 'owner-a',
    params: { id: projectId, actualId: act1.body.actual.actualId },
  });
  assert.equal(delAct.statusCode, 200);
  assert.equal(delAct.body.summary.totalActualCents, 12500);
  assert.equal(delAct.body.summary.totalVarianceCents, 87500);

  // Patch & Delete project
  const patchedProj = await invoke('PATCH /projects/:id', {
    sub: 'owner-a',
    params: { id: projectId },
    body: { status: 'completed', notes: 'Wrapped under budget' },
  });
  assert.equal(patchedProj.statusCode, 200);
  assert.equal(patchedProj.body.project.status, 'completed');

  const delProj = await invoke('DELETE /projects/:id', { sub: 'owner-a', params: { id: projectId } });
  assert.equal(delProj.statusCode, 200);
  assert.equal((await invoke('GET /projects/:id/summary', { sub: 'owner-a', params: { id: projectId } })).statusCode, 404);
});
