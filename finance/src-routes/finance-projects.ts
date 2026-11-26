/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5: owner-scoped HTTP routes under /api/finance/projects for finance projects, budget allocation lines, and multi-source actuals (manual, plaid, ads, sms, email, invoice). Zero per-request DDL; strict owner isolation and exact integer-cent variance rollups.
 *
 * @module finance-projects
 */

import { randomBytes } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import {
  UUID_RE,
  normalizeProjectActualInput,
  normalizeProjectInput,
  normalizeProjectLineInput,
  normalizeProjectLinePatch,
  normalizeProjectPatch,
  summarizeFinanceProject,
  toSafeCents,
  type ActualSource,
  type FinanceProjectActualRecord,
  type FinanceProjectLineRecord,
  type FinanceProjectRecord,
  type FinanceProjectSummary,
  type ProjectStatus,
} from './finance-projects-model';

type QueryPool = Pick<AppContext['pool'], 'query'>;

/** Extract signed-in caller OIDC subject. */
function callerSub(req: Request): string | null {
  const user = (req as { oidc?: { user?: { sub?: string; oid?: string } } }).oidc?.user;
  const sub = user?.sub || user?.oid;
  return sub ? String(sub) : null;
}

/** Normalize a PostgreSQL/native timestamp or date column to ISO string. */
function isoStamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Normalize a DATE column to YYYY-MM-DD. */
function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

/** Map a raw DB row into a FinanceProjectRecord. */
function projectFromRow(row: Record<string, unknown>): FinanceProjectRecord {
  return {
    projectId: String(row.project_id),
    slug: String(row.slug),
    name: String(row.name),
    currency: String(row.currency || 'USD'),
    status: String(row.status || 'active') as ProjectStatus,
    budgetCents: toSafeCents(row.budget_cents ?? 0),
    externalRef: row.external_ref ? String(row.external_ref) : null,
    notes: String(row.notes || ''),
    createdAt: isoStamp(row.created_at),
    updatedAt: isoStamp(row.updated_at),
  };
}

/** Map a raw DB row into a FinanceProjectLineRecord. */
function lineFromRow(row: Record<string, unknown>): FinanceProjectLineRecord {
  return {
    lineId: String(row.line_id),
    projectId: String(row.project_id),
    name: String(row.name),
    channel: String(row.channel || 'general'),
    budgetCents: toSafeCents(row.budget_cents ?? 0),
    committedCents: toSafeCents(row.committed_cents ?? 0),
    notes: String(row.notes || ''),
    createdAt: isoStamp(row.created_at),
    updatedAt: isoStamp(row.updated_at),
  };
}

/** Map a raw DB row into a FinanceProjectActualRecord. */
function actualFromRow(row: Record<string, unknown>): FinanceProjectActualRecord {
  let evidence: Record<string, unknown> = {};
  if (row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)) {
    evidence = row.evidence as Record<string, unknown>;
  } else if (typeof row.evidence === 'string') {
    try {
      const parsed = JSON.parse(row.evidence);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) evidence = parsed;
    } catch { evidence = {}; }
  }
  return {
    actualId: String(row.actual_id),
    projectId: String(row.project_id),
    lineId: row.line_id ? String(row.line_id) : null,
    source: String(row.source) as ActualSource,
    amountCents: toSafeCents(row.amount_cents),
    occurredOn: isoDate(row.occurred_on),
    referenceId: row.reference_id ? String(row.reference_id) : null,
    evidence,
    note: String(row.note || ''),
    createdAt: isoStamp(row.created_at),
  };
}

/** Load one caller-owned project plus its lines and actuals, or null if missing/foreign. */
async function loadOwnedProjectSummary(
  pool: QueryPool,
  sub: string,
  projectId: string,
): Promise<FinanceProjectSummary | null> {
  if (!UUID_RE.test(projectId)) return null;
  const projRows = (await pool.query(
    `SELECT project_id, slug, name, currency, status, budget_cents, external_ref, notes, created_at, updated_at
       FROM oshal_finance_projects
      WHERE project_id = $1 AND owner_sub = $2`,
    [projectId, sub],
  )).rows;
  if (!projRows[0]) return null;
  const [lineRes, actualRes] = await Promise.all([
    pool.query(
      `SELECT line_id, project_id, name, channel, budget_cents, committed_cents, notes, created_at, updated_at
         FROM oshal_finance_project_lines
        WHERE project_id = $1 AND owner_sub = $2
        ORDER BY created_at ASC`,
      [projectId, sub],
    ),
    pool.query(
      `SELECT actual_id, project_id, line_id, source, amount_cents, occurred_on, reference_id, evidence, note, created_at
         FROM oshal_finance_project_actuals
        WHERE project_id = $1 AND owner_sub = $2
        ORDER BY occurred_on DESC, created_at DESC`,
      [projectId, sub],
    ),
  ]);
  return summarizeFinanceProject(
    projectFromRow(projRows[0]),
    lineRes.rows.map(lineFromRow),
    actualRes.rows.map(actualFromRow),
  );
}

/** Choose a unique slug for the caller (auto-suffixing only when the caller omitted slug). */
async function resolveProjectSlug(pool: QueryPool, sub: string, slug: string, explicitSlug: boolean): Promise<string | null> {
  const taken = (await pool.query(
    'SELECT project_id FROM oshal_finance_projects WHERE owner_sub = $1 AND slug = $2',
    [sub, slug],
  )).rows;
  if (!taken.length) return slug;
  if (explicitSlug) return null;
  const suffix = randomBytes(3).toString('hex');
  return `${slug.slice(0, 72)}-${suffix}`;
}

/** Group mapped child rows by projectId. */
function groupByProjectId<T extends { projectId: string }>(
  rows: Record<string, unknown>[],
  mapper: (row: Record<string, unknown>) => T,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const item = mapper(row);
    const list = map.get(item.projectId) || [];
    list.push(item);
    map.set(item.projectId, list);
  }
  return map;
}

/** Format one project list item from its rolled-up summary. */
function projectListItem(proj: FinanceProjectRecord, sum: FinanceProjectSummary) {
  return {
    ...proj,
    budgetCents: sum.totalBudgetCents,
    projectBudgetCents: sum.projectBudgetCents,
    allocatedCents: sum.allocatedCents,
    unallocatedBudgetCents: sum.unallocatedBudgetCents,
    committedCents: sum.totalCommittedCents,
    actualCents: sum.totalActualCents,
    varianceCents: sum.totalVarianceCents,
    remainingAfterCommittedCents: sum.remainingAfterCommittedCents,
    overBudget: sum.overBudget,
    lineCount: sum.lineCount,
    actualCount: sum.actualCount,
    bySource: sum.bySource,
  };
}

/** GET /projects — read-only list of caller's projects with live budget/committed/actual/variance rollups. */
export async function listFinanceProjects(pool: QueryPool, sub: string, res: Response): Promise<void> {
  const [projRes, lineRes, actualRes] = await Promise.all([
    pool.query(
      `SELECT project_id, slug, name, currency, status, budget_cents, external_ref, notes, created_at, updated_at
         FROM oshal_finance_projects WHERE owner_sub = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 200`,
      [sub],
    ),
    pool.query(
      `SELECT line_id, project_id, name, channel, budget_cents, committed_cents, notes, created_at, updated_at
         FROM oshal_finance_project_lines WHERE owner_sub = $1 ORDER BY created_at ASC`,
      [sub],
    ),
    pool.query(
      `SELECT actual_id, project_id, line_id, source, amount_cents, occurred_on, reference_id, evidence, note, created_at
         FROM oshal_finance_project_actuals WHERE owner_sub = $1 ORDER BY occurred_on DESC, created_at DESC`,
      [sub],
    ),
  ]);
  const linesByProject = groupByProjectId(lineRes.rows, lineFromRow);
  const actualsByProject = groupByProjectId(actualRes.rows, actualFromRow);
  const projects = projRes.rows.map((row: Record<string, unknown>) => {
    const proj = projectFromRow(row);
    const sum = summarizeFinanceProject(proj, linesByProject.get(proj.projectId) || [], actualsByProject.get(proj.projectId) || []);
    return projectListItem(proj, sum);
  });
  res.json({ projects });
}

/** POST /projects — create an owner-scoped project (optionally with initial allocation lines). */
export async function createFinanceProject(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const checked = normalizeProjectInput(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  const p = checked.value;
  const slug = await resolveProjectSlug(pool, sub, p.slug, p.explicitSlug);
  if (!slug) {
    res.status(409).json({ error: 'duplicate_project_slug', message: 'A project with that slug already exists.' });
    return;
  }
  const inserted = (await pool.query(
    `INSERT INTO oshal_finance_projects
       (owner_sub, slug, name, currency, status, budget_cents, external_ref, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING project_id, slug, name, currency, status, budget_cents, external_ref, notes, created_at, updated_at`,
    [sub, slug, p.name, p.currency, p.status, p.budgetCents, p.externalRef, p.notes],
  )).rows[0];
  const project = projectFromRow(inserted);
  const createdLines: FinanceProjectLineRecord[] = [];
  for (const line of p.lines) {
    const lineRow = (await pool.query(
      `INSERT INTO oshal_finance_project_lines
         (owner_sub, project_id, name, channel, budget_cents, committed_cents, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING line_id, project_id, name, channel, budget_cents, committed_cents, notes, created_at, updated_at`,
      [sub, project.projectId, line.name, line.channel, line.budgetCents, line.committedCents, line.notes],
    )).rows[0];
    createdLines.push(lineFromRow(lineRow));
  }
  res.status(201).json(summarizeFinanceProject(project, createdLines, []));
}

/** GET /projects/:id/summary — full owner-scoped budget/committed/actual/variance summary. */
export async function getFinanceProjectSummary(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const summary = await loadOwnedProjectSummary(pool, sub, String(req.params.id || ''));
  if (!summary) { res.status(404).json({ error: 'project_not_found' }); return; }
  res.json(summary);
}

/** PATCH /projects/:id — update a caller-owned project's metadata or top-level budget. */
export async function patchFinanceProject(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const projectId = String(req.params.id || '');
  if (!UUID_RE.test(projectId)) { res.status(404).json({ error: 'project_not_found' }); return; }
  const checked = normalizeProjectPatch(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  const p = checked.value;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (p.name !== undefined) { vals.push(p.name); sets.push(`name = $${vals.length}`); }
  if (p.currency !== undefined) { vals.push(p.currency); sets.push(`currency = $${vals.length}`); }
  if (p.status !== undefined) { vals.push(p.status); sets.push(`status = $${vals.length}`); }
  if (p.budgetCents !== undefined) { vals.push(p.budgetCents); sets.push(`budget_cents = $${vals.length}`); }
  if (p.externalRef !== undefined) { vals.push(p.externalRef); sets.push(`external_ref = $${vals.length}`); }
  if (p.notes !== undefined) { vals.push(p.notes); sets.push(`notes = $${vals.length}`); }
  vals.push(projectId, sub);
  const updated = (await pool.query(
    `UPDATE oshal_finance_projects
        SET ${sets.join(', ')}, updated_at = now()
      WHERE project_id = $${vals.length - 1} AND owner_sub = $${vals.length}
      RETURNING project_id`,
    vals,
  )).rows;
  if (!updated[0]) { res.status(404).json({ error: 'project_not_found' }); return; }
  const summary = await loadOwnedProjectSummary(pool, sub, projectId);
  res.json(summary);
}

/** DELETE /projects/:id — delete a caller-owned project and all its lines and actuals. */
export async function deleteFinanceProject(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const projectId = String(req.params.id || '');
  if (!UUID_RE.test(projectId)) { res.status(404).json({ error: 'project_not_found' }); return; }
  const owned = (await pool.query(
    'SELECT project_id FROM oshal_finance_projects WHERE project_id = $1 AND owner_sub = $2',
    [projectId, sub],
  )).rows;
  if (!owned[0]) { res.status(404).json({ error: 'project_not_found' }); return; }
  await pool.query('DELETE FROM oshal_finance_project_actuals WHERE project_id = $1 AND owner_sub = $2', [projectId, sub]);
  await pool.query('DELETE FROM oshal_finance_project_lines WHERE project_id = $1 AND owner_sub = $2', [projectId, sub]);
  await pool.query('DELETE FROM oshal_finance_projects WHERE project_id = $1 AND owner_sub = $2', [projectId, sub]);
  res.json({ ok: true, deletedProjectId: projectId });
}

/** POST /projects/:id/lines — add a budget allocation line to a caller-owned project. */
export async function addFinanceProjectLine(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const projectId = String(req.params.id || '');
  if (!UUID_RE.test(projectId)) { res.status(404).json({ error: 'project_not_found' }); return; }
  const owned = (await pool.query(
    'SELECT project_id FROM oshal_finance_projects WHERE project_id = $1 AND owner_sub = $2',
    [projectId, sub],
  )).rows;
  if (!owned[0]) { res.status(404).json({ error: 'project_not_found' }); return; }
  const checked = normalizeProjectLineInput(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  const line = checked.value;
  const row = (await pool.query(
    `INSERT INTO oshal_finance_project_lines
       (owner_sub, project_id, name, channel, budget_cents, committed_cents, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING line_id, project_id, name, channel, budget_cents, committed_cents, notes, created_at, updated_at`,
    [sub, projectId, line.name, line.channel, line.budgetCents, line.committedCents, line.notes],
  )).rows[0];
  const summary = await loadOwnedProjectSummary(pool, sub, projectId);
  res.status(201).json({ line: lineFromRow(row), summary });
}

/** PATCH /projects/:id/lines/:lineId — update a budget allocation line on a caller-owned project. */
export async function patchFinanceProjectLine(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const projectId = String(req.params.id || '');
  const lineId = String(req.params.lineId || '');
  if (!UUID_RE.test(projectId) || !UUID_RE.test(lineId)) { res.status(404).json({ error: 'line_not_found' }); return; }
  const checked = normalizeProjectLinePatch(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  const p = checked.value;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (p.name !== undefined) { vals.push(p.name); sets.push(`name = $${vals.length}`); }
  if (p.channel !== undefined) { vals.push(p.channel); sets.push(`channel = $${vals.length}`); }
  if (p.budgetCents !== undefined) { vals.push(p.budgetCents); sets.push(`budget_cents = $${vals.length}`); }
  if (p.committedCents !== undefined) { vals.push(p.committedCents); sets.push(`committed_cents = $${vals.length}`); }
  if (p.notes !== undefined) { vals.push(p.notes); sets.push(`notes = $${vals.length}`); }
  vals.push(lineId, projectId, sub);
  const updated = (await pool.query(
    `UPDATE oshal_finance_project_lines
        SET ${sets.join(', ')}, updated_at = now()
      WHERE line_id = $${vals.length - 2} AND project_id = $${vals.length - 1} AND owner_sub = $${vals.length}
      RETURNING line_id, project_id, name, channel, budget_cents, committed_cents, notes, created_at, updated_at`,
    vals,
  )).rows;
  if (!updated[0]) { res.status(404).json({ error: 'line_not_found' }); return; }
  const summary = await loadOwnedProjectSummary(pool, sub, projectId);
  res.json({ line: lineFromRow(updated[0]), summary });
}

/** POST /projects/:id/actuals — record an actual spend entry on a caller-owned project. */
export async function addFinanceProjectActual(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const projectId = String(req.params.id || '');
  if (!UUID_RE.test(projectId)) { res.status(404).json({ error: 'project_not_found' }); return; }
  const owned = (await pool.query(
    'SELECT project_id FROM oshal_finance_projects WHERE project_id = $1 AND owner_sub = $2',
    [projectId, sub],
  )).rows;
  if (!owned[0]) { res.status(404).json({ error: 'project_not_found' }); return; }
  const checked = normalizeProjectActualInput(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  const act = checked.value;
  if (act.lineId) {
    const lineOwned = (await pool.query(
      'SELECT line_id FROM oshal_finance_project_lines WHERE line_id = $1 AND project_id = $2 AND owner_sub = $3',
      [act.lineId, projectId, sub],
    )).rows;
    if (!lineOwned[0]) {
      res.status(404).json({ error: 'line_not_found', message: 'Budget line does not belong to this project.' });
      return;
    }
  }
  const row = (await pool.query(
    `INSERT INTO oshal_finance_project_actuals
       (owner_sub, project_id, line_id, source, amount_cents, occurred_on, reference_id, evidence, note)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::jsonb, $9)
     RETURNING actual_id, project_id, line_id, source, amount_cents, occurred_on, reference_id, evidence, note, created_at`,
    [sub, projectId, act.lineId, act.source, act.amountCents, act.occurredOn, act.referenceId, JSON.stringify(act.evidence), act.note],
  )).rows[0];
  const summary = await loadOwnedProjectSummary(pool, sub, projectId);
  res.status(201).json({ actual: actualFromRow(row), summary });
}

/** DELETE /projects/:id/actuals/:actualId — remove a recorded actual from a caller-owned project. */
export async function deleteFinanceProjectActual(pool: QueryPool, sub: string, req: Request, res: Response): Promise<void> {
  const projectId = String(req.params.id || '');
  const actualId = String(req.params.actualId || '');
  if (!UUID_RE.test(projectId) || !UUID_RE.test(actualId)) { res.status(404).json({ error: 'actual_not_found' }); return; }
  const removed = (await pool.query(
    `DELETE FROM oshal_finance_project_actuals
      WHERE actual_id = $1 AND project_id = $2 AND owner_sub = $3
      RETURNING actual_id`,
    [actualId, projectId, sub],
  )).rows;
  if (!removed[0]) { res.status(404).json({ error: 'actual_not_found' }); return; }
  const summary = await loadOwnedProjectSummary(pool, sub, projectId);
  res.json({ ok: true, deletedActualId: actualId, summary });
}

/** Wrap a project handler with caller authentication and structured error handling. */
function authed(
  fn: (sub: string, req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await fn(sub, req, res);
    } catch (err) {
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '23505') {
        res.status(409).json({ error: 'duplicate_project_slug', message: 'A project with that slug already exists.' });
        return;
      }
      res.status(500).json({ error: 'finance_projects_error', message: (err as Error).message });
    }
  };
}

/**
 * @description Mount all owner-scoped finance project routes onto the existing /api/finance router.
 */
export function mountFinanceProjectsRoutes(router: Router, pool: QueryPool): void {
  router.get('/projects', authed((sub, _req, res) => listFinanceProjects(pool, sub, res)));
  router.post('/projects', authed((sub, req, res) => createFinanceProject(pool, sub, req, res)));
  router.get('/projects/:id/summary', authed((sub, req, res) => getFinanceProjectSummary(pool, sub, req, res)));
  router.delete('/projects/:id', authed((sub, req, res) => deleteFinanceProject(pool, sub, req, res)));
  router.post('/projects/:id/lines', authed((sub, req, res) => addFinanceProjectLine(pool, sub, req, res)));
  router.post('/projects/:id/actuals', authed((sub, req, res) => addFinanceProjectActual(pool, sub, req, res)));
  router.delete('/projects/:id/actuals/:actualId', authed((sub, req, res) => deleteFinanceProjectActual(pool, sub, req, res)));
  // Guard patch registration so legacy unit tests with minimal { get, post, delete } router doubles keep passing.
  if (typeof router.patch === 'function') {
    router.patch('/projects/:id', authed((sub, req, res) => patchFinanceProject(pool, sub, req, res)));
    router.patch('/projects/:id/lines/:lineId', authed((sub, req, res) => patchFinanceProjectLine(pool, sub, req, res)));
  }
}
