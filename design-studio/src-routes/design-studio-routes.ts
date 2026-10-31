/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D1-D6, lane @ds-app: the package's single mounted factory on
 *                     |                             | /api/design-studio. Serves the screen from tools/, publishes
 *                     |                             | /capabilities (the vocabulary, the phase briefs, the examples),
 *                     |                             | proposes a chain from a brief (/plan), and owns the person's
 *                     |                             | projects: create (from a brief or an example), list, read,
 *                     |                             | rename and re-brief, delete, the chain (PUT /phases), bindings
 *                     |                             | (POST /bind), closures (POST /close, refused as missing_evidence
 *                     |                             | without an evidence line AND a revision), the phase brief per
 *                     |                             | kind, and the body contract (GET /body, refused as
 *                     |                             | body_incomplete naming every value no bound read supplies).
 *                     |                             | Never reads another package's routes: stages are read by the
 *                     |                             | page through the person's session (circuit-lab B17).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the print-set routes under a product
 *                     |                             | (print-set-routes.ts) are mounted here with the package's data
 *                     |                             | root (print-set-store.ts: DESIGN_STUDIO_DATA_DIR, else the native
 *                     |                             | lasting directory, else the shared workspace); withProject is
 *                     |                             | exported so they load the owner's project the same way.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the mechanism routes under a product
 *                     |                             | (mechanism-routes.ts) are mounted here; a project read carries
 *                     |                             | its mechanism; an example with a mechanism (the lift) saves it
 *                     |                             | with the task read from the brief's line when it is created.
 */

import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { buildBodyContract } from './body-contract';
import { findExample, listExamples } from './examples';
import { taskFromBrief } from './mechanism-model';
import { registerMechanism } from './mechanism-routes';
import { registerOrders } from './order-routes';
import { getMechanism, saveMechanism } from './mechanism-store';
import { ENGINES, ModelError, PHASE_BRIEFS, PHASE_KINDS, proposePhases, validateArtifact, validateBrief, validateClosure, validatePhases, type PhaseEntry, type PhaseKind } from './phase-model';
import { registerPrintSet } from './print-set-routes';
import { resolveDataRoot } from './print-set-store';
import { bindArtifact, closePhase, createProject, deleteProject, getProject, latestBindings, listBindings, listClosures, listOwnerClosures, listProjects, updateProject, type ProjectRow } from './project-store';
import { serveSurfaceFile, SURFACE_FILES, surfaceFile } from './surface-files';

const logger = createChildLogger({ module: 'design-studio-routes' });
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_CAP = 120;

/** @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub). */
export function callerSub(req: Request): string | null {
  const r = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}

type Pool = AppContext['pool'];
interface Ctx { pool: Pool; sub: string; project: ProjectRow }

/** Answer a ModelError with its status, code and field; anything else is the caller's 500. */
function refuse(res: Response, error: unknown, what: string): void {
  if (error instanceof ModelError) { res.status(error.status).json({ error: error.code, field: error.field, message: error.message }); return; }
  logger.error({ err: error }, `${what} failed`);
  res.status(500).json({ error: `${what.replace(/\s+/g, '_')}_failed` });
}

/** The project name from a body, or the brief's first words. */
function nameOf(body: Record<string, unknown>, fallback: string): string {
  const raw = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const name = (raw || fallback).slice(0, NAME_CAP);
  if (!name) throw new ModelError('name is required', 'bad_name', 'name');
  return name;
}

/** The phase kind a path names, checked against the vocabulary. */
function kindOf(value: string): PhaseKind {
  if (!(PHASE_KINDS as readonly string[]).includes(value)) throw new ModelError(`unknown phase ${value}; the vocabulary is ${PHASE_KINDS.join(', ')}`, 'unknown_phase', 'phase');
  return value as PhaseKind;
}

/** The phase a body names, which must be in the project's chain. */
function phaseInChain(project: ProjectRow, value: unknown): PhaseEntry {
  const kind = kindOf(String(value ?? ''));
  const entry = project.phases.find((p) => p.kind === kind);
  if (!entry) throw new ModelError(`${kind} is not in this project's chain (${project.phases.map((p) => p.kind).join(' -> ')}); set the chain first`, 'phase_not_in_chain', 'phase', 409);
  return entry;
}

/** The full read of a project: the row, the newest binding per phase with the bind count, every closure, the mechanism when one is saved. */
async function projectView(pool: Pool, sub: string, project: ProjectRow): Promise<Record<string, unknown>> {
  const [bindings, closures, mechanism] = await Promise.all([listBindings(pool, sub, project.id), listClosures(pool, sub, project.id), getMechanism(pool, sub, project.id)]);
  const latest = latestBindings(bindings);
  const binds = Object.fromEntries(Object.entries(latest).map(([k, b]) => [k, { ...b, bindCount: bindings.filter((x) => x.phase === k).length }]));
  return { project, bindings: binds, closures, mechanism: mechanism ? { ...mechanism.mechanism, revision: mechanism.revision, savedAt: mechanism.saved_at } : null };
}

/** Create a project from an example: the brief, the chain and the bindings by name. */
async function createFromExample(pool: Pool, sub: string, body: Record<string, unknown>): Promise<ProjectRow> {
  const example = findExample(body.example);
  if (!example) throw new ModelError(`unknown example ${JSON.stringify(body.example)}; the examples are ${listExamples().map((e) => e.id).join(', ')}`, 'unknown_example', 'example', 404);
  const row = await createProject(pool, sub, { name: nameOf(body, example.name), brief: example.brief, phases: example.phases });
  for (const phase of example.phases) {
    const artifact = example.bindings[phase.kind];
    if (artifact) await bindArtifact(pool, sub, row.id, phase.kind, validateArtifact(phase.kind, artifact));
  }
  if (example.mechanism) await saveMechanism(pool, sub, row.id, { ...example.mechanism, task: example.mechanism.task ?? taskFromBrief(example.brief) });
  logger.info({ sub, projectId: row.id, example: example.id, mechanism: !!example.mechanism }, 'Project created from an example');
  return row;
}

/** Create a project from a brief: the chain is the body's, or the proposal from the brief. */
async function createFromBrief(pool: Pool, sub: string, body: Record<string, unknown>): Promise<ProjectRow> {
  const brief = validateBrief(body.brief);
  const phases = body.phases === undefined ? proposePhases(brief).phases : validatePhases(body.phases);
  const row = await createProject(pool, sub, { name: nameOf(body, brief.what), brief, phases });
  logger.info({ sub, projectId: row.id, phases: phases.map((p) => p.kind) }, 'Project created from a brief');
  return row;
}

/**
 * @description Load the caller and the project a path names; answers 401/400/404 itself and returns null then.
 * @param pool - The pool. @param req - The request. @param res - The response.
 * @returns The caller, the project and the pool, or null once a refusal was answered.
 */
export async function withProject(pool: Pool, req: Request, res: Response): Promise<Ctx | null> {
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return null; }
  const id = String(req.params.id || '');
  if (!PROJECT_ID.test(id)) { res.status(400).json({ error: 'bad_project_id', field: 'id' }); return null; }
  const project = await getProject(pool, sub, id);
  if (!project) { res.status(404).json({ error: 'project_not_found', id }); return null; }
  return { pool, sub, project };
}

/** Mount the screen and its assets. */
function registerSurface(router: Router, appPackageDir: string | undefined): void {
  const page = surfaceFile(appPackageDir, SURFACE_FILES.page);
  logger.info({ page, appPackageDir }, 'Resolved the design-studio surface');
  router.get('/app', serveSurfaceFile(page, 'html'));
  const assets = Router();
  for (const file of SURFACE_FILES.scripts) assets.get(`/${file}`, serveSurfaceFile(surfaceFile(appPackageDir, file), 'application/javascript'));
  assets.get(`/${SURFACE_FILES.style}`, serveSurfaceFile(surfaceFile(appPackageDir, SURFACE_FILES.style), 'text/css'));
  router.use('/assets', assets);
}

/** The vocabulary and the proposal: no owner, no write. */
function registerVocabulary(router: Router): void {
  router.get('/capabilities', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ app: 'design-studio', phases: PHASE_KINDS, engines: ENGINES, briefs: PHASE_BRIEFS, examples: listExamples(), body: { schema: 'design-studio-body/1', route: 'GET /api/design-studio/projects/{id}/body' } });
  });
  router.post('/plan', (req: Request, res: Response) => {
    try {
      const brief = validateBrief((req.body ?? {}).brief ?? req.body);
      res.json({ brief, ...proposePhases(brief), rule: 'the package\'s rules over the requirement lines; the design partner revises the chain with design-plan-phases' });
    } catch (error) { refuse(res, error, 'plan'); }
  });
}

/** Projects: list, create, read, update, delete. */
function registerProjects(router: Router, pool: Pool): void {
  router.get('/projects', async (req: Request, res: Response) => {
    const sub = callerSub(req); if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    try {
      const [projects, closures] = await Promise.all([listProjects(pool, sub), listOwnerClosures(pool, sub)]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ projects: projects.map((p) => ({ ...p, closedPhases: [...new Set(closures.filter((c) => c.project_id === p.id && c.step === null).map((c) => c.phase))].length })) });
    } catch (error) { refuse(res, error, 'list projects'); }
  });
  router.post('/projects', async (req: Request, res: Response) => {
    const sub = callerSub(req); if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const row = body.example !== undefined ? await createFromExample(pool, sub, body) : await createFromBrief(pool, sub, body);
      res.status(201).json(await projectView(pool, sub, row));
    } catch (error) { refuse(res, error, 'create project'); }
  });
  router.get('/projects/:id', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    try { res.setHeader('Cache-Control', 'no-store'); res.json(await projectView(pool, c.sub, c.project)); } catch (error) { refuse(res, error, 'read project'); }
  });
  router.patch('/projects/:id', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const next = { ...c.project };
      if (body.name !== undefined) next.name = nameOf(body, c.project.name);
      if (body.brief !== undefined) next.brief = validateBrief(body.brief);
      res.json(await projectView(pool, c.sub, await updateProject(pool, c.sub, next)));
    } catch (error) { refuse(res, error, 'update project'); }
  });
  router.delete('/projects/:id', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    try { await deleteProject(pool, c.sub, c.project.id); res.json({ deleted: c.project.id }); } catch (error) { refuse(res, error, 'delete project'); }
  });
}

/** The chain, the bindings and the closures of one project. */
function registerPhases(router: Router, pool: Pool): void {
  router.put('/projects/:id/phases', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    try {
      const phases = validatePhases((req.body ?? {}).phases);
      res.json(await projectView(pool, c.sub, await updateProject(pool, c.sub, { ...c.project, phases })));
    } catch (error) { refuse(res, error, 'set phases'); }
  });
  router.post('/projects/:id/bind', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const phase = phaseInChain(c.project, body.phase);
      const binding = await bindArtifact(pool, c.sub, c.project.id, phase.kind, validateArtifact(phase.kind, body.artifact));
      logger.info({ sub: c.sub, projectId: c.project.id, phase: phase.kind, revision: binding.revision }, 'Artifact bound');
      res.status(201).json({ binding, ...(await projectView(pool, c.sub, c.project)) });
    } catch (error) { refuse(res, error, 'bind artifact'); }
  });
  router.post('/projects/:id/close', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const phase = phaseInChain(c.project, body.phase);
      const closure = await closePhase(pool, c.sub, c.project.id, phase.kind, validateClosure(phase.kind, body));
      logger.info({ sub: c.sub, projectId: c.project.id, phase: phase.kind, step: closure.step }, 'Phase closed');
      res.status(201).json({ closure, ...(await projectView(pool, c.sub, c.project)) });
    } catch (error) { refuse(res, error, 'close phase'); }
  });
}

/** The phase brief per kind and the body contract. */
function registerReads(router: Router, pool: Pool): void {
  router.get('/projects/:id/phase-brief/:kind', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    try {
      const kind = kindOf(String(req.params.kind));
      const entry = c.project.phases.find((p) => p.kind === kind) ?? null;
      const [bindings, closures] = await Promise.all([listBindings(pool, c.sub, c.project.id), listClosures(pool, c.sub, c.project.id)]);
      const binding = latestBindings(bindings)[kind] ?? null;
      const closed = closures.filter((x) => x.phase === kind);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ project: c.project.id, brief: PHASE_BRIEFS[kind], inChain: !!entry, phase: entry, binding, closures: closed, productBrief: c.project.brief });
    } catch (error) { refuse(res, error, 'phase brief'); }
  });
  router.get('/projects/:id/body', async (req: Request, res: Response) => {
    const c = await withProject(pool, req, res); if (!c) return;
    try {
      const { body, required } = buildBodyContract(c.project, latestBindings(await listBindings(pool, c.sub, c.project.id)));
      res.setHeader('Cache-Control', 'no-store');
      if (required.length) { res.status(409).json({ error: 'body_incomplete', message: 'the contract needs values no bound artifact read supplies; close the phases on the product page or bind the engine replies with design-bind-artifact', required, body }); return; }
      res.json(body);
    } catch (error) { refuse(res, error, 'body contract'); }
  });
}

/**
 * @description Build the `/api/design-studio` router.
 * @param ctx - The per-package AppContext (ADR-085 D10): `pool` and `appPackageDir` are read.
 * @returns The composed router.
 */
export function createDesignStudioRoutes(ctx: AppContext): Router {
  const router = Router();
  registerSurface(router, ctx.appPackageDir);
  registerVocabulary(router);
  registerProjects(router, ctx.pool);
  registerPhases(router, ctx.pool);
  registerReads(router, ctx.pool);
  registerOrders(router, { pool: ctx.pool, callerSub, withProject });
  registerPrintSet(router, { pool: ctx.pool, dataRoot: resolveDataRoot(process.env as Record<string, string | undefined>), withProject });
  registerMechanism(router, { pool: ctx.pool, withProject });
  return router;
}
