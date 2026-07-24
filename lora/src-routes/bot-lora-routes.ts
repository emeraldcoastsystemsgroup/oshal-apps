/**
 * Bot LoRA routes — the LoRA Studio (?app=lora) API. The lora-director bot reasons over the
 * pipeline; the heavy work runs off the api: dataset generation + validation over the GPU box's
 * ComfyUI HTTP API (free), and kohya training on the box ONLY via a queue-manager ticket + the
 * worker node's gated shell.exec (ADR-070 privilege rule). The controller stores the authoritative
 * version + score metadata (oshal_lora_*); the box keeps the .safetensors / datasets / samples.
 *
 * Phases on disk: P0/P1 here = the data spine (characters, versions, scorecards, the box→controller
 * /ingest callback, the studio surface). Box-dependent training dispatch (/train, /validate,
 * /improve) is wired in P3 (lora-train-dispatch) and returns `box_required` until then.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-24 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial LoRA Studio routes — P0 skeleton + P1 scorecard ingest/read (data spine, box-independent).
 * 2026-07-17 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the lora store package. Studio factory is the standard (ctx) shape — the surface serves from this package's tools/ (ctx.appPackageDir, portrait-studio pattern). The ingest router's internal paths move to '/' because the package mounts it at /api/lora/ingest (the loader-sanctioned split-mountPath shape for mixed auth: ingest = auth public + self-guard, studio = auth oidc) — the external URL the box calls is unchanged. scorecard + lora-train-dispatch are vendored package siblings (relative imports); shared core helpers stay @/ aliases (resolved by the loader at runtime).
 */

import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import { runRuntimeSchemaBootstrap } from '@/shared/services/database';
import { hasValidServiceSecret } from '@/shared/middleware/authz';
import { summarizeScore, computeWeakCells, type ScoreCell } from './scorecard';
import { dispatchBoxCommand, buildTrainCommand, buildValidateCommand, buildImproveCommand, buildOvernightCommand } from './lora-train-dispatch';
import type { AppContext } from '@/app/composition/app-context';

const logger = createChildLogger({ module: 'bot-lora-routes' });

/** Package install dir — set by the loader on the context; env fallback for tool-style callers. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** The LoRA Studio's own bot — reasons over training/validation, owns the cost line. */
const LORA_DIRECTOR_AGENT_ID = 'a0000000-0000-0000-0000-000000000049';

/** Signed-in caller's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** LoRA Studio schema: characters + their trained versions + each version's validation score. */
export async function ensureLoraSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'lora routes',
    statements: [
      `CREATE TABLE IF NOT EXISTS oshal_lora_characters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        trigger_word TEXT NOT NULL,
        hero_image TEXT,
        base_model TEXT NOT NULL DEFAULT 'v1-5-pruned-emaonly-fp16.safetensors',
        ident_prompt TEXT,
        autonomous BOOLEAN NOT NULL DEFAULT FALSE,
        max_hours NUMERIC(5,2) NOT NULL DEFAULT 9,
        plateau_epsilon NUMERIC(6,4) NOT NULL DEFAULT 0.0050,
        active_version INTEGER,
        owner_sub TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS oshal_lora_models (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        lora_path TEXT,
        base_model TEXT,
        dataset_count INTEGER,
        network_dim INTEGER,
        epochs INTEGER,
        steps INTEGER,
        final_loss NUMERIC(10,5),
        duration_sec INTEGER,
        parent_version INTEGER,
        ticket_id TEXT,
        metrics JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (character_id, version)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_lora_models_char ON oshal_lora_models(character_id, version DESC)',
      `CREATE TABLE IF NOT EXISTS oshal_lora_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        overall NUMERIC(6,4),
        identity_mean NUMERIC(6,4),
        quality_mean NUMERIC(6,4),
        min_cell NUMERIC(6,4),
        cells JSONB,
        weak_cells JSONB,
        gallery_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (character_id, version)
      )`,
      `INSERT INTO oshal_lora_characters (subject, display_name, trigger_word, hero_image, base_model, ident_prompt)
       VALUES ('oshbrainrot', 'Cyclops (oshbrainrot)', 'oshbrainrot', 'hero_brainrot_00002_.png',
         'v1-5-pruned-emaonly-fp16.safetensors',
         'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style')
       ON CONFLICT (subject) DO NOTHING`,
    ],
    requirements: [
      { table: 'oshal_lora_characters', columns: ['id', 'subject', 'display_name', 'trigger_word', 'hero_image', 'base_model', 'ident_prompt', 'autonomous', 'max_hours', 'plateau_epsilon', 'active_version', 'owner_sub', 'created_at'] },
      { table: 'oshal_lora_models', columns: ['id', 'character_id', 'version', 'status', 'lora_path', 'base_model', 'dataset_count', 'network_dim', 'epochs', 'steps', 'final_loss', 'duration_sec', 'parent_version', 'ticket_id', 'metrics', 'created_at'] },
      { table: 'oshal_lora_scores', columns: ['id', 'character_id', 'version', 'overall', 'identity_mean', 'quality_mean', 'min_cell', 'cells', 'weak_cells', 'gallery_url', 'created_at'] },
    ],
  });
}

/** Resolve a character row id from its subject slug. */
async function characterId(ctx: AppContext, subject: string): Promise<string | null> {
  const r = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1', [subject])).rows[0] as
    | { id: string }
    | undefined;
  return r?.id ?? null;
}

/**
 * @description Creates the gated LoRA Studio routes (mounted behind requiresAuth). Read/data routes
 * for characters, versions, and scorecards; the box-dependent action routes return `box_required`
 * until the training dispatch lands (P3).
 * @param ctx - app context (pool, swarm cost tracking + appPackageDir)
 */
export function createBotLoraRoutes(ctx: AppContext): Router {
  if (ctx.appPackageDir) packageDir = ctx.appPackageDir;
  const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
  const router = Router();
  void ensureLoraSchema(ctx.pool).catch((err) => logger.warn({ err: err?.message }, 'lora schema ensure failed'));

  /** GET /ui — the LoRA Studio surface (served from this package's tools/). */
  router.get('/ui', (_req: Request, res: Response) => {
    res.sendFile(path.join(surfaceDir, 'lora.html'), (err) => {
      if (err) { logger.error({ err }, 'serve lora UI failed'); res.status(404).send('Page not found'); }
    });
  });

  /** GET /characters — every character with its latest version + latest overall score. */
  router.get('/characters', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const rows = (await ctx.pool.query(
        `SELECT c.subject, c.display_name, c.trigger_word, c.hero_image, c.base_model, c.ident_prompt,
                c.autonomous, c.max_hours, c.plateau_epsilon, c.active_version, c.created_at,
                (SELECT max(version) FROM oshal_lora_models m WHERE m.character_id = c.id) AS latest_version,
                (SELECT count(*) FROM oshal_lora_models m WHERE m.character_id = c.id) AS version_count,
                (SELECT s.overall FROM oshal_lora_scores s WHERE s.character_id = c.id ORDER BY s.version DESC LIMIT 1) AS latest_score
         FROM oshal_lora_characters c ORDER BY c.created_at ASC`,
      )).rows as Array<Record<string, unknown>>;
      res.json({ characters: rows });
    } catch (err) {
      logger.error({ err }, 'list characters failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /models?subject= — the version timeline (each version joined with its score). */
  router.get('/models', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String(req.query.subject || '').trim();
    if (!subject) { res.status(400).json({ error: 'subject required' }); return; }
    try {
      const id = await characterId(ctx, subject);
      if (!id) { res.status(404).json({ error: 'character not found' }); return; }
      const rows = (await ctx.pool.query(
        `SELECT m.version, m.status, m.lora_path, m.base_model, m.dataset_count, m.network_dim, m.epochs,
                m.steps, m.final_loss, m.duration_sec, m.parent_version, m.ticket_id, m.created_at,
                s.overall, s.identity_mean, s.quality_mean, s.min_cell, s.weak_cells, s.gallery_url
         FROM oshal_lora_models m
         LEFT JOIN oshal_lora_scores s ON s.character_id = m.character_id AND s.version = m.version
         WHERE m.character_id = $1 ORDER BY m.version DESC`, [id],
      )).rows as Array<Record<string, unknown>>;
      res.json({ subject, models: rows });
    } catch (err) {
      logger.error({ err }, 'list models failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /scorecard?subject=&version= — the per-cell scores for one version (drives the gallery). */
  router.get('/scorecard', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String(req.query.subject || '').trim();
    const version = Number(req.query.version);
    if (!subject || !Number.isInteger(version)) { res.status(400).json({ error: 'subject + version required' }); return; }
    try {
      const id = await characterId(ctx, subject);
      if (!id) { res.status(404).json({ error: 'character not found' }); return; }
      const row = (await ctx.pool.query(
        `SELECT version, overall, identity_mean, quality_mean, min_cell, cells, weak_cells, gallery_url, created_at
         FROM oshal_lora_scores WHERE character_id = $1 AND version = $2`, [id, version],
      )).rows[0] as Record<string, unknown> | undefined;
      if (!row) { res.status(404).json({ error: 'no scorecard for that version' }); return; }
      res.json({ subject, scorecard: row });
    } catch (err) {
      logger.error({ err }, 'get scorecard failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /characters/:subject/autonomous — toggle the opt-in improve-overnight mode (controller-only). */
  router.post('/characters/:subject/autonomous', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String(req.params.subject || '').trim();
    const body = req.body as { enabled?: boolean; maxHours?: number; plateauEpsilon?: number };
    try {
      const r = await ctx.pool.query(
        `UPDATE oshal_lora_characters
         SET autonomous = COALESCE($2, autonomous),
             max_hours = COALESCE($3, max_hours),
             plateau_epsilon = COALESCE($4, plateau_epsilon)
         WHERE subject = $1 RETURNING autonomous, max_hours, plateau_epsilon`,
        [subject, typeof body.enabled === 'boolean' ? body.enabled : null,
          Number.isFinite(body.maxHours) ? body.maxHours : null,
          Number.isFinite(body.plateauEpsilon) ? body.plateauEpsilon : null],
      );
      if (!r.rowCount) { res.status(404).json({ error: 'character not found' }); return; }
      res.json({ ok: true, ...r.rows[0] });
    } catch (err) {
      logger.error({ err }, 'set autonomous failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /characters/:subject/active — keep-best: set the active version (the human decision). */
  router.post('/characters/:subject/active', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String(req.params.subject || '').trim();
    const version = Number((req.body as { version?: number }).version);
    if (!Number.isInteger(version)) { res.status(400).json({ error: 'version required' }); return; }
    try {
      const id = await characterId(ctx, subject);
      if (!id) { res.status(404).json({ error: 'character not found' }); return; }
      const exists = (await ctx.pool.query('SELECT 1 FROM oshal_lora_models WHERE character_id = $1 AND version = $2', [id, version])).rowCount;
      if (!exists) { res.status(404).json({ error: 'no such version' }); return; }
      await ctx.pool.query('UPDATE oshal_lora_characters SET active_version = $2 WHERE id = $1', [id, version]);
      res.json({ ok: true, subject, activeVersion: version });
    } catch (err) {
      logger.error({ err }, 'set active version failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /train — authorize + dispatch a new LoRA version to the GPU box (ticket-gated shell.exec). */
  router.post('/train', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String((req.body as { subject?: string }).subject || '').trim();
    try {
      const char = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1', [subject])).rows[0] as { id: string } | undefined;
      if (!char) { res.status(404).json({ error: 'character not found' }); return; }
      const version = Number((await ctx.pool.query(
        'SELECT COALESCE(max(version), 0) + 1 AS v FROM oshal_lora_models WHERE character_id = $1', [char.id],
      )).rows[0].v);
      const ticket = await ctx.ticketService.createTicket({
        title: `Train ${subject} LoRA v${version}`,
        ticketType: 'lora-train',
        description: `Train character LoRA "${subject}" version ${version} on the GPU edge box (kohya).`,
        status: 'approved',
        priority: 'none',
        labels: ['lora', 'train', subject],
        workspaceId: null,
        assignedAgentId: LORA_DIRECTOR_AGENT_ID,
        parentTicketId: null,
        externalProvider: null,
        externalId: null,
        externalUrl: null,
        ownerSub: sub,
        metadata: { app: 'lora', character: subject, version, action: 'train' },
      });
      await ctx.pool.query(
        `INSERT INTO oshal_lora_models (character_id, version, status, base_model, ticket_id)
         VALUES ($1, $2, 'training', (SELECT base_model FROM oshal_lora_characters WHERE id = $1), $3)
         ON CONFLICT (character_id, version) DO UPDATE SET status = 'training', ticket_id = EXCLUDED.ticket_id`,
        [char.id, version, ticket.ticketId],
      );
      const d = dispatchBoxCommand(buildTrainCommand(subject, version, null), ticket.ticketId);
      if (!d.ok) {
        await ctx.pool.query(`UPDATE oshal_lora_models SET status = 'failed' WHERE character_id = $1 AND version = $2`, [char.id, version]);
        res.status(503).json({ ok: false, status: 'box_required', version, ticketId: ticket.ticketId, message: d.error });
        return;
      }
      res.json({ ok: true, version, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
        message: `Training v${version} dispatched to the GPU box — results appear here when it finishes.` });
    } catch (err) {
      logger.error({ err }, 'train dispatch failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /validate — re-score the latest trained version on the fixed matrix (ticket-gated). */
  router.post('/validate', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String((req.body as { subject?: string; version?: number }).subject || '').trim();
    const asked = Number((req.body as { version?: number }).version);
    try {
      const char = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1', [subject])).rows[0] as { id: string } | undefined;
      if (!char) { res.status(404).json({ error: 'character not found' }); return; }
      const version = Number.isInteger(asked) ? asked : Number((await ctx.pool.query(
        `SELECT max(version) AS v FROM oshal_lora_models WHERE character_id = $1 AND status IN ('trained', 'scored')`, [char.id],
      )).rows[0]?.v);
      if (!Number.isInteger(version)) { res.status(400).json({ error: 'no trained version to validate yet' }); return; }
      const ticket = await ctx.ticketService.createTicket({
        title: `Validate ${subject} LoRA v${version}`,
        ticketType: 'lora-train',
        description: `Validate character LoRA "${subject}" v${version} on the fixed held-out matrix (ComfyUI).`,
        status: 'approved',
        priority: 'none',
        labels: ['lora', 'validate', subject],
        workspaceId: null,
        assignedAgentId: LORA_DIRECTOR_AGENT_ID,
        parentTicketId: null,
        externalProvider: null,
        externalId: null,
        externalUrl: null,
        ownerSub: sub,
        metadata: { app: 'lora', character: subject, version, action: 'validate' },
      });
      const d = dispatchBoxCommand(buildValidateCommand(subject, version), ticket.ticketId);
      if (!d.ok) { res.status(503).json({ ok: false, status: 'box_required', version, ticketId: ticket.ticketId, message: d.error }); return; }
      res.json({ ok: true, version, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
        message: `Validation of v${version} dispatched — the scorecard appears here when it finishes.` });
    } catch (err) {
      logger.error({ err }, 'validate dispatch failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /improve — regenerate the latest scored version's weak cells, then retrain v+1 (ticket-gated). */
  router.post('/improve', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String((req.body as { subject?: string }).subject || '').trim();
    try {
      const char = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1', [subject])).rows[0] as { id: string } | undefined;
      if (!char) { res.status(404).json({ error: 'character not found' }); return; }
      // The most-recently scored version is the parent we improve from.
      const parentRow = (await ctx.pool.query(
        `SELECT s.version, s.weak_cells FROM oshal_lora_scores s WHERE s.character_id = $1 ORDER BY s.version DESC LIMIT 1`, [char.id],
      )).rows[0] as { version: number; weak_cells: Array<{ value?: string }> | null } | undefined;
      if (!parentRow) { res.status(400).json({ error: 'no scored version to improve from — train + validate first' }); return; }
      const parentVersion = Number(parentRow.version);
      const weakValues = Array.isArray(parentRow.weak_cells)
        ? parentRow.weak_cells.map((w) => String(w?.value || '')).filter(Boolean)
        : [];
      const version = Number((await ctx.pool.query(
        'SELECT COALESCE(max(version), 0) + 1 AS v FROM oshal_lora_models WHERE character_id = $1', [char.id],
      )).rows[0].v);
      const ticket = await ctx.ticketService.createTicket({
        title: `Improve ${subject} LoRA v${parentVersion} → v${version}`,
        ticketType: 'lora-train',
        description: `Targeted regenerate weak cells [${weakValues.join(', ') || 'none'}] then retrain "${subject}" v${version} from v${parentVersion}.`,
        status: 'approved',
        priority: 'none',
        labels: ['lora', 'improve', subject],
        workspaceId: null,
        assignedAgentId: LORA_DIRECTOR_AGENT_ID,
        parentTicketId: null,
        externalProvider: null,
        externalId: null,
        externalUrl: null,
        ownerSub: sub,
        metadata: { app: 'lora', character: subject, version, parentVersion, action: 'improve', weakValues },
      });
      await ctx.pool.query(
        `INSERT INTO oshal_lora_models (character_id, version, status, base_model, parent_version, ticket_id)
         VALUES ($1, $2, 'training', (SELECT base_model FROM oshal_lora_characters WHERE id = $1), $3, $4)
         ON CONFLICT (character_id, version) DO UPDATE SET status = 'training', parent_version = EXCLUDED.parent_version, ticket_id = EXCLUDED.ticket_id`,
        [char.id, version, parentVersion, ticket.ticketId],
      );
      const d = dispatchBoxCommand(buildImproveCommand(subject, version, parentVersion, weakValues), ticket.ticketId);
      if (!d.ok) {
        await ctx.pool.query(`UPDATE oshal_lora_models SET status = 'failed' WHERE character_id = $1 AND version = $2`, [char.id, version]);
        res.status(503).json({ ok: false, status: 'box_required', version, ticketId: ticket.ticketId, message: d.error });
        return;
      }
      res.json({ ok: true, version, parentVersion, weakValues, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
        message: `Improving v${parentVersion} → v${version} (targeting ${weakValues.length} weak cells), then retraining. Results appear here when done.` });
    } catch (err) {
      logger.error({ err }, 'improve dispatch failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /improve-overnight — opt-in autonomous loop: improve→validate until plateau, parks a review. */
  router.post('/improve-overnight', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const subject = String((req.body as { subject?: string }).subject || '').trim();
    try {
      const char = (await ctx.pool.query(
        'SELECT id, autonomous, max_hours, plateau_epsilon FROM oshal_lora_characters WHERE subject = $1', [subject],
      )).rows[0] as { id: string; autonomous: boolean; max_hours: number; plateau_epsilon: number } | undefined;
      if (!char) { res.status(404).json({ error: 'character not found' }); return; }
      if (!char.autonomous) { res.status(400).json({ error: 'enable Improve overnight for this character first' }); return; }
      const startVersion = Number((await ctx.pool.query(
        `SELECT max(version) AS v FROM oshal_lora_models WHERE character_id = $1 AND status IN ('trained', 'scored')`, [char.id],
      )).rows[0]?.v);
      if (!Number.isInteger(startVersion)) { res.status(400).json({ error: 'train + validate a first version before running overnight' }); return; }
      const ticket = await ctx.ticketService.createTicket({
        title: `Overnight improve ${subject} (from v${startVersion})`,
        ticketType: 'lora-train',
        description: `Autonomous improve loop for "${subject}" from v${startVersion} up to ${char.max_hours}h, plateau ${char.plateau_epsilon}. Parks a review at the end.`,
        status: 'approved',
        priority: 'none',
        labels: ['lora', 'overnight', subject],
        workspaceId: null,
        assignedAgentId: LORA_DIRECTOR_AGENT_ID,
        parentTicketId: null,
        externalProvider: null,
        externalId: null,
        externalUrl: null,
        ownerSub: sub,
        metadata: { app: 'lora', character: subject, action: 'improve-overnight', startVersion },
      });
      const d = dispatchBoxCommand(
        buildOvernightCommand(subject, startVersion, Number(char.max_hours) || 9, Number(char.plateau_epsilon) || 0.005),
        ticket.ticketId);
      if (!d.ok) { res.status(503).json({ ok: false, status: 'box_required', ticketId: ticket.ticketId, message: d.error }); return; }
      res.json({ ok: true, startVersion, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
        message: `Overnight improve started from v${startVersion}. It runs until it plateaus or ${char.max_hours}h, then parks a morning review.` });
    } catch (err) {
      logger.error({ err }, 'overnight dispatch failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}

/**
 * @description Creates the PUBLIC LoRA ingest route — the box→controller callback. Authenticated by
 * the shared service secret (x-service-secret), NOT a user session, so the GPU box trainer/validator
 * can report metrics + scorecards back. The package manifest mounts this at /api/lora/ingest with
 * auth: public (self-guarded) — the loader-sanctioned split-mountPath shape — so the internal paths
 * here are '/': the external URL the box calls stays /api/lora/ingest, unchanged from core.
 * @param ctx - app context (pool)
 */
export function createLoraIngestRoutes(ctx: AppContext): Router {
  const router = Router();

  /**
   * GET / — public reachability probe. The ingest endpoint is intentionally OUTSIDE the OIDC
   * wall (it authenticates with the shared service secret, not a user session). This responder makes
   * that reachability verifiable: a probe gets a clear 200 here instead of falling through to the
   * downstream `/api` catch-all, whose `requiresAuth` would otherwise answer with an OIDC `loginPath`
   * 401 and make the public route look gated. The real write path is POST / below.
   */
  router.get('/', (_req: Request, res: Response) => {
    res.json({ ok: true, route: 'lora-ingest', method: 'POST', auth: 'x-service-secret' });
  });

  /** POST / — box reports a training result (kind:'training') or a scorecard (kind:'score'). */
  router.post('/', async (req: Request, res: Response) => {
    if (!hasValidServiceSecret(req)) { res.status(401).json({ error: 'service_secret_required' }); return; }
    const b = (req.body || {}) as Record<string, unknown>;
    const subject = String(b.character || b.subject || '').trim();
    const version = Number(b.version);
    const kind = String(b.kind || '').trim();

    try {
      const id = await characterId(ctx, subject);
      if (!subject || !id) { res.status(404).json({ error: 'character not found' }); return; }

      // Autonomous overnight loop finished — park a human "morning review" gate (never auto-promote).
      if (kind === 'review') {
        const bestVersion = Number(b.best_version);
        const summary = String(b.summary || 'Overnight improve finished.');
        const ticket = await ctx.ticketService.createTicket({
          title: `Review ${subject} overnight result — best v${Number.isInteger(bestVersion) ? bestVersion : '?'}`,
          ticketType: 'lora-train',
          description: `${summary} Open the LoRA Studio to compare versions and keep-best.`,
          status: 'approval_required',
          priority: 'none',
          labels: ['lora', 'review', subject],
          workspaceId: null,
          assignedAgentId: LORA_DIRECTOR_AGENT_ID,
          parentTicketId: null,
          externalProvider: null,
          externalId: null,
          externalUrl: null,
          ownerSub: null,
          metadata: { app: 'lora', character: subject, action: 'review', bestVersion, overall: Number(b.overall) || null },
        });
        logger.info({ subject, bestVersion }, 'lora overnight review ticket parked');
        res.json({ ok: true, kind, subject, ticketId: ticket.ticketId });
        return;
      }

      if (!Number.isInteger(version) || !['training', 'score'].includes(kind)) {
        res.status(400).json({ error: 'character, integer version, and kind (training|score|review) required' });
        return;
      }

      if (kind === 'training') {
        const status = ['queued', 'training', 'trained', 'scored', 'failed'].includes(String(b.status)) ? String(b.status) : 'trained';
        await ctx.pool.query(
          `INSERT INTO oshal_lora_models
             (character_id, version, status, lora_path, base_model, dataset_count, network_dim, epochs, steps, final_loss, duration_sec, parent_version, ticket_id, metrics)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (character_id, version) DO UPDATE SET
             status = EXCLUDED.status,
             lora_path = COALESCE(EXCLUDED.lora_path, oshal_lora_models.lora_path),
             base_model = COALESCE(EXCLUDED.base_model, oshal_lora_models.base_model),
             dataset_count = COALESCE(EXCLUDED.dataset_count, oshal_lora_models.dataset_count),
             network_dim = COALESCE(EXCLUDED.network_dim, oshal_lora_models.network_dim),
             epochs = COALESCE(EXCLUDED.epochs, oshal_lora_models.epochs),
             steps = COALESCE(EXCLUDED.steps, oshal_lora_models.steps),
             final_loss = COALESCE(EXCLUDED.final_loss, oshal_lora_models.final_loss),
             duration_sec = COALESCE(EXCLUDED.duration_sec, oshal_lora_models.duration_sec),
             parent_version = COALESCE(EXCLUDED.parent_version, oshal_lora_models.parent_version),
             ticket_id = COALESCE(EXCLUDED.ticket_id, oshal_lora_models.ticket_id),
             metrics = COALESCE(EXCLUDED.metrics, oshal_lora_models.metrics)`,
          [id, version, status, str(b.lora_path), str(b.base_model), int(b.dataset_count), int(b.network_dim),
            int(b.epochs), int(b.steps), num(b.final_loss), int(b.duration_sec), int(b.parent_version),
            str(b.ticket_id), b.metrics != null ? JSON.stringify(b.metrics) : null],
        );
        logger.info({ subject, version, status }, 'lora training ingest');
        res.json({ ok: true, kind, subject, version, status });
        return;
      }

      // kind === 'score' — recompute the rollup/weak-cells from cells if the box didn't send them.
      const cells = Array.isArray(b.cells) ? (b.cells as ScoreCell[]) : [];
      const summary = cells.length ? summarizeScore(cells) : null;
      const overall = num(b.overall) ?? summary?.overall ?? null;
      const identityMean = num(b.identity_mean) ?? summary?.identityMean ?? null;
      const qualityMean = num(b.quality_mean) ?? summary?.qualityMean ?? null;
      const minCell = num(b.min_cell) ?? summary?.minCell ?? null;
      const weakCells = Array.isArray(b.weak_cells) ? b.weak_cells : cells.length ? computeWeakCells(cells) : [];
      await ctx.pool.query(
        `INSERT INTO oshal_lora_scores
           (character_id, version, overall, identity_mean, quality_mean, min_cell, cells, weak_cells, gallery_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (character_id, version) DO UPDATE SET
           overall = EXCLUDED.overall, identity_mean = EXCLUDED.identity_mean,
           quality_mean = EXCLUDED.quality_mean, min_cell = EXCLUDED.min_cell,
           cells = EXCLUDED.cells, weak_cells = EXCLUDED.weak_cells,
           gallery_url = COALESCE(EXCLUDED.gallery_url, oshal_lora_scores.gallery_url)`,
        [id, version, overall, identityMean, qualityMean, minCell,
          JSON.stringify(cells), JSON.stringify(weakCells), str(b.gallery_url)],
      );
      await ctx.pool.query(
        `UPDATE oshal_lora_models SET status = 'scored' WHERE character_id = $1 AND version = $2 AND status <> 'failed'`,
        [id, version],
      );
      logger.info({ subject, version, overall }, 'lora score ingest');
      res.json({ ok: true, kind, subject, version, overall });
    } catch (err) {
      logger.error({ err }, 'lora ingest failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}

/** Coerce a JSON field to a trimmed string or null. */
function str(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}
/** Coerce to a finite integer or null. */
function int(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
/** Coerce to a finite number or null. */
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export { LORA_DIRECTOR_AGENT_ID };
