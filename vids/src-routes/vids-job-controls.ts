/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.8: case-insensitive orientation normalization (CREATE-TOOL-VIDS-03) and owner-scoped job cancel/retry controls (CREATE-TOOL-VIDS-08).
 */
'use strict';

import type { Router, Request, Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';

export type CanonicalOrientation = 'Landscape' | 'Portrait' | 'Square';

const UUID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ORIENTATION_MAP: Record<string, CanonicalOrientation> = {
  landscape: 'Landscape',
  portrait: 'Portrait',
  square: 'Square',
};

export interface WorkerRef {
  clientId: string;
  agentId?: string;
}

export interface JobControlDeps {
  callerSub: (req: Request) => string | null;
  findVidsWorker: () => WorkerRef | null;
  enqueueVidsTask: (
    ctx: AppContext,
    worker: WorkerRef,
    jobId: string,
    userSub: string,
    input: { name: string; arguments: Record<string, unknown> },
    kind: 'clip' | 'story' | 'brand',
  ) => Promise<string | null>;
  watchTask: (ctx: AppContext, clientId: string, taskId: string, jobId: string, userSub: string) => void;
  stopWatcher: (jobId: string) => void;
  notifyWorkerCancel: (clientId: string | null, jobId: string, taskId: string | null, userSub: string) => Promise<boolean>;
}

interface StoredJobRow {
  job_id: string;
  status: string;
  client_id: string | null;
  idea: string;
  orientation: string | null;
  insert_mode: string | null;
  ingredient: string | null;
  outcome: Record<string, unknown> | null;
}

/**
 * @description Normalize case-insensitive orientation values to canonical Landscape, Portrait, or Square.
 */
export function normalizeOrientation(
  raw: unknown,
): { ok: true; value: CanonicalOrientation | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const canonical = ORIENTATION_MAP[trimmed.toLowerCase()];
  return canonical ? { ok: true, value: canonical } : { ok: false };
}

function buildRetryPayload(row: StoredJobRow, orientation: CanonicalOrientation | null): {
  kind: 'clip' | 'story' | 'brand';
  tool: string;
  arguments: Record<string, unknown>;
  meta: Record<string, unknown>;
} {
  const prev = row.outcome && typeof row.outcome === 'object' ? row.outcome : {};
  if (row.insert_mode === 'brand') {
    const brandMode = prev.brandMode === 'graphic' ? 'graphic' : 'intro';
    const tool = brandMode === 'graphic' ? 'brand.graphic' : 'brand.intro';
    return { kind: 'brand', tool, arguments: { brief: row.idea, subject: row.idea }, meta: { kind: 'brand', brandMode } };
  }
  if (row.insert_mode === 'story') {
    const tool = prev.tool === 'content.produce' ? 'content.produce' : 'content.next';
    const label = row.idea.replace(/^story:\s*/i, '').trim();
    const args: Record<string, unknown> = {};
    if (orientation) args.orientation = orientation;
    if (tool === 'content.produce' && label) args.storyId = label;
    return { kind: 'story', tool, arguments: args, meta: { kind: 'story', tool } };
  }
  return {
    kind: 'clip',
    tool: 'vids.generate',
    arguments: {
      prompt: row.idea,
      orientation: orientation ?? undefined,
      insertMode: row.insert_mode ?? undefined,
      ingredientPath: row.ingredient ?? undefined,
    },
    meta: { kind: 'clip' },
  };
}

async function handleCancelJob(
  req: Request,
  res: Response,
  ctx: AppContext,
  deps: JobControlDeps,
): Promise<void> {
  const userSub = deps.callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'user_identity_required' }); return; }
  const jobId = String(req.params.id || '');
  if (!UUID_RE.test(jobId)) { res.status(404).json({ error: 'job_not_found' }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.trim().length > 500)) {
    res.status(400).json({ error: 'invalid_cancel_reason' }); return;
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'cancelled by user';
  const found = (await ctx.pool.query(
    `SELECT job_id, status, client_id, outcome FROM vids_jobs WHERE job_id = $1 AND user_sub = $2`,
    [jobId, userSub],
  )).rows[0] as StoredJobRow | undefined;
  if (!found) { res.status(404).json({ error: 'job_not_found' }); return; }
  if (found.status !== 'queued' && found.status !== 'running') {
    res.status(409).json({ error: 'job_not_cancellable', status: found.status }); return;
  }
  const cancelledAt = new Date().toISOString();
  const updated = await ctx.pool.query(
    `UPDATE vids_jobs
        SET status = 'cancelled', outcome = outcome || $3::jsonb, updated_at = now()
      WHERE job_id = $1 AND user_sub = $2 AND status IN ('queued', 'running')
      RETURNING job_id, status, updated_at`,
    [jobId, userSub, JSON.stringify({ cancelledAt, cancelReason: reason })],
  );
  if (!updated.rows.length) { res.status(409).json({ error: 'job_not_cancellable' }); return; }
  deps.stopWatcher(jobId);
  const taskId = typeof found.outcome?.taskId === 'string' ? found.outcome.taskId : null;
  const workerNotified = await deps.notifyWorkerCancel(found.client_id ?? null, jobId, taskId, userSub);
  res.json({ job_id: jobId, status: 'cancelled', cancelledAt, reason, workerNotified });
}

async function handleRetryJob(
  req: Request,
  res: Response,
  ctx: AppContext,
  deps: JobControlDeps,
): Promise<void> {
  const userSub = deps.callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'user_identity_required' }); return; }
  const jobId = String(req.params.id || '');
  if (!UUID_RE.test(jobId)) { res.status(404).json({ error: 'job_not_found' }); return; }
  const found = (await ctx.pool.query(
    `SELECT job_id, status, client_id, idea, orientation, insert_mode, ingredient, outcome
       FROM vids_jobs WHERE job_id = $1 AND user_sub = $2`,
    [jobId, userSub],
  )).rows[0] as StoredJobRow | undefined;
  if (!found) { res.status(404).json({ error: 'job_not_found' }); return; }
  if (found.status !== 'failed' && found.status !== 'cancelled') {
    res.status(409).json({ error: 'job_not_retryable', status: found.status }); return;
  }
  const worker = deps.findVidsWorker();
  if (!worker) {
    res.status(503).json({
      error: 'box_required',
      message: 'No Vids worker is registered. Start one on a machine with a screen: `oshal-vids worker`.',
      original_job_id: found.job_id,
    });
    return;
  }
  const orient = normalizeOrientation(found.orientation);
  const orientation = orient.ok ? orient.value : null;
  const payload = buildRetryPayload(found, orientation);
  const newJobId = (await ctx.pool.query(
    `INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient, outcome)
     VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7::jsonb) RETURNING job_id`,
    [userSub, worker.clientId, found.idea, orientation, found.insert_mode, found.ingredient, JSON.stringify({ ...payload.meta, retriedFrom: found.job_id })],
  )).rows[0].job_id as string;
  const taskId = await deps.enqueueVidsTask(ctx, worker, newJobId, userSub, { name: payload.tool, arguments: payload.arguments }, payload.kind);
  if (!taskId) {
    res.status(503).json({ error: 'The Vids worker could not accept the retry task.', job_id: newJobId, original_job_id: found.job_id });
    return;
  }
  await ctx.pool.query(
    `UPDATE vids_jobs SET outcome = outcome || jsonb_build_object('taskId', $2::text), updated_at = now()
      WHERE job_id = $1 AND user_sub = $3`,
    [newJobId, taskId, userSub],
  );
  deps.watchTask(ctx, worker.clientId, taskId, newJobId, userSub);
  res.json({ job_id: newJobId, original_job_id: found.job_id, taskId, clientId: worker.clientId, status: 'queued' });
}

/**
 * @description Register owner-scoped cancel and retry routes directly on the Vids router.
 */
export function registerVidsJobControlRoutes(router: Router, ctx: AppContext, deps: JobControlDeps): void {
  router.post('/jobs/:id/cancel', (req: Request, res: Response) => { void handleCancelJob(req, res, ctx, deps); });
  router.post('/jobs/:id/retry', (req: Request, res: Response) => { void handleRetryJob(req, res, ctx, deps); });
}
