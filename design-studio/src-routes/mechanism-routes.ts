/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the mechanism routes under a product.
 *                     |                             | GET /projects/{id}/mechanism answers the saved mechanism with its
 *                     |                             | revision and the task the brief's line states (404 no_mechanism
 *                     |                             | before a save, with that task so the screen can show it);
 *                     |                             | PUT /projects/{id}/mechanism validates against the Design
 *                     |                             | phase's bound parts and saves (201 the first time, 200 after),
 *                     |                             | reading the task from the brief when the body states none;
 *                     |                             | POST /projects/{id}/plant-spec composes the engine's spec from
 *                     |                             | the mechanism and the parts and rows the page read (every
 *                     |                             | number one of those). The tool design-set-mechanism is the PUT.
 */

import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { plantSpecFrom, taskFromBrief, validateMechanism, type MotorRead, type PartRead } from './mechanism-model';
import { getMechanism, saveMechanism } from './mechanism-store';
import { ModelError } from './phase-model';
import { latestBindings, listBindings, type ProjectRow } from './project-store';

const logger = createChildLogger({ module: 'design-studio-mechanism' });
type Pool = AppContext['pool'];
interface Ctx { pool: Pool; sub: string; project: ProjectRow }

/** @description What the mechanism routes need from the mount around them. */
export interface MechanismRouteDeps { pool: Pool; withProject: (pool: Pool, req: Request, res: Response) => Promise<Ctx | null> }

/** Answer a ModelError with its status, code and field; anything else is the caller's 500. */
function refuse(res: Response, error: unknown, what: string): void {
  if (error instanceof ModelError) { res.status(error.status).json({ error: error.code, field: error.field, message: error.message }); return; }
  logger.error({ err: error }, `${what} failed`);
  res.status(500).json({ error: `${what.replace(/\s+/g, '_')}_failed` });
}

/**
 * @description Mount the mechanism routes on the package router.
 * @param router - The package's router. @param deps - The pool and the project loader.
 */
export function registerMechanism(router: Router, deps: MechanismRouteDeps): void {
  router.get('/projects/:id/mechanism', async (req: Request, res: Response) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const row = await getMechanism(c.pool, c.sub, c.project.id);
      res.setHeader('Cache-Control', 'no-store');
      const briefTask = taskFromBrief(c.project.brief);
      if (!row) { res.status(404).json({ error: 'no_mechanism', project: c.project.id, briefTask, message: 'no mechanism is defined for this product yet: Define the mechanism on the Design poster, or design-set-mechanism' }); return; }
      res.json({ project: c.project.id, mechanism: row.mechanism, revision: row.revision, savedAt: row.saved_at, briefTask });
    } catch (error) { refuse(res, error, 'read mechanism'); }
  });
  router.put('/projects/:id/mechanism', async (req: Request, res: Response) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const binding = latestBindings(await listBindings(c.pool, c.sub, c.project.id)).design ?? null;
      const mechanism = validateMechanism(body.mechanism ?? body, binding ? binding.artifact : null);
      if (!mechanism.task) mechanism.task = taskFromBrief(c.project.brief);
      const existed = !!(await getMechanism(c.pool, c.sub, c.project.id));
      const row = await saveMechanism(c.pool, c.sub, c.project.id, mechanism);
      logger.info({ sub: c.sub, projectId: c.project.id, revision: row.revision, joints: mechanism.joints.length }, 'Mechanism saved');
      res.status(existed ? 200 : 201).json({ project: c.project.id, mechanism: row.mechanism, revision: row.revision, savedAt: row.saved_at, briefTask: taskFromBrief(c.project.brief) });
    } catch (error) { refuse(res, error, 'save mechanism'); }
  });
  router.post('/projects/:id/plant-spec', async (req: Request, res: Response) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const row = await getMechanism(c.pool, c.sub, c.project.id);
      if (!row) { res.status(404).json({ error: 'no_mechanism', project: c.project.id }); return; }
      const parts = Array.isArray(body.parts) ? body.parts as PartRead[] : [];
      const motors = Array.isArray(body.motors) ? body.motors as MotorRead[] : [];
      res.json({ project: c.project.id, revision: row.revision, spec: plantSpecFrom(row.mechanism, parts, motors) });
    } catch (error) { refuse(res, error, 'plant spec'); }
  });
}
