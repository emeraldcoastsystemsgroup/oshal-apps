/**
 * Camera Ops Routes — remote camera control surface API (?app=camera)
 *
 * Backs the Camera Ops surface at /cockpit?app=camera. The framework way (clones Drone Ops):
 *  - CONTROL is deterministic code: the CameraService (feature slice) validates every command and
 *    drives the engine — the built-in simulator today, a real GoPro (Open GoPro HTTP) behind the
 *    same CameraProvider interface at a camera node. No LLM in the control loop.
 *  - The BRAIN (camera-operator, Form B inline concierge) interprets natural language ("start
 *    recording", "switch to photo") into ONE validated command; the route executes non-destructive
 *    ops immediately and requires an explicit confirmation for destructive ones (delete-all → 428).
 *  - Every actuating command is audit-logged to camera_command_log under the caller's sub.
 *
 * Cameras are device nodes (like drones): the embedded sim is always present; real cameras join via
 * authenticated camera-node heartbeats. Per-user isolation: the audit log + concierge turns are
 * scoped by the OIDC `sub`; the fleet itself is deployment-level.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-07-19 01:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Camera Ops:
 *            | GET /app|/fleet|/state|/events|/captures, POST /control (+ /fleet/:cameraId/control)
 *            | with the destructive-op confirm gate, POST /nodes/heartbeat (service-secret REQUIRED
 *            | — a node identity, never an operator browser), and a stateless concierge POST /chat.
 * 2026-07-19 14:25:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into
 *            | the camera app package (ADR-085 Wave 3, "skill with a surface"). The surface serves
 *            | from ctx.appPackageDir/tools (load-time env fallback, D10); shared framework helpers
 *            | import via @/ aliases (the camera ENGINE @/features/camera, concierge-envelope,
 *            | authz, schema bootstrap). ensureCameraSchema now appends
 *            | buildOwnerRlsPolicyStatements (owner-RLS at the lazy-DDL chokepoint). The engine,
 *            | the camera-node server, and the camera-operator inline node stay framework-resident.
 * ---------------------------------------------------------------------------
 * @module camera-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import { getTrustedServiceUserSub, hasValidServiceSecret } from '@/shared/middleware/authz';
import type { AppContext } from '@/app/composition/app-context';
import {
  CameraService,
  CameraCommandError,
  CameraConfirmationRequiredError,
  DEFAULT_CAMERA_ID,
  normalizeCameraCommand,
  type CameraCommand,
  type CameraNodeHeartbeat,
  type CameraTelemetry,
} from '@/features/camera';
import { extractEnvelopeJson, sayOr } from '@/app/routes/concierge-envelope';

const logger = createChildLogger({ module: 'camera-routes' });

/** The camera-operator agent (Form B inline concierge; registry + persona + this package's manifest). */
const OPERATOR_AGENT_ID = 'b0200000-0000-0000-0000-000000000001';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * @description Resolve a surface file from the package's tools/ dir (ctx.appPackageDir, captured
 * at factory time per D10), with the load-time env fallback and a final relative fallback for
 * running the built routes/ next to src-routes/ (tests, local checks).
 * @param appPackageDir - This package's directory from the per-package context.
 * @param fileName - The bundled surface file.
 * @returns The first existing candidate path (or the last candidate for sendFile's 404 path).
 */
function surfaceHtml(appPackageDir: string | undefined, fileName: string): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
    path.resolve(__dirname, '../tools', fileName),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}

function resolveViewerSub(req: Request): string {
  const trustedSub = getTrustedServiceUserSub(req);
  if (trustedSub) return trustedSub;
  const oidc = (req as any).oidc;
  if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
    const u = oidc.user || {};
    const sub = u.sub || u.oid;
    if (sub) return String(sub);
  }
  if (process.env.MOCK_OIDC === 'true') return 'demo-viewer';
  throw Object.assign(new Error('Not authenticated'), { status: 401 });
}

// ── Schema ───────────────────────────────────────────────────────────────────

/**
 * @description Lazy-DDL for the camera audit log (owner-RLS applied at the chokepoint so a fresh
 * database is never left policy-less between table creation and any migration run).
 * @param pool - The framework's pg pool.
 * @returns Resolves when the schema is ensured (or validation-only mode has checked it).
 */
export async function ensureCameraSchema(pool: Pool): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'camera routes',
    statements: [`
    CREATE TABLE IF NOT EXISTS camera_command_log (
      log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, camera_id VARCHAR(64) NOT NULL, op VARCHAR(32) NOT NULL,
      detail JSONB, outcome VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_camera_command_log_user ON camera_command_log (user_sub, created_at DESC);
  `,
      ...buildOwnerRlsPolicyStatements('camera_command_log', 'user_sub'),
    ],
    requirements: [
      { table: 'camera_command_log', columns: ['log_id', 'user_sub', 'camera_id', 'op', 'detail', 'outcome', 'created_at'] },
    ],
  });
}

// ── Concierge prompt + envelope ──────────────────────────────────────────────

interface ControlEnvelope { say: string; action: unknown | null }

/**
 * @description Build the camera-operator prompt: live telemetry + the command vocabulary + a strict
 * output contract. The concierge emits at most ONE command; the route validates + executes it (a
 * destructive op still needs the human confirm). It never claims an action happened on its own.
 */
function buildOperatorPrompt(o: { message: string; telemetry: CameraTelemetry; cameraId: string; fleetLine: string }): string {
  const t = o.telemetry;
  return [
    'You are the Camera Operator — the control brain of a remote camera system (GoPro and similar). You interpret ONE operator instruction into at most ONE camera command. You never invent media or claim a result you were not told; the system executes and reports back.',
    '',
    `FLEET: ${o.fleetLine}`,
    `SELECTED CAMERA: ${o.cameraId}`,
    `LIVE STATE (${o.cameraId}): status=${t.status} | mode=${t.mode} | recording=${t.recording} | battery=${t.batteryPct ?? '?'}% | preview=${t.previewActive} | model=${t.model}`,
    '',
    'COMMAND VOCABULARY (op → meaning):',
    '- record → start a video recording; stop → stop it; photo → take a still',
    '- setMode {mode: "video"|"photo"|"timelapse"} → switch capture mode',
    '- loadPreset {presetId: <int>} → load a specific preset',
    '- setSetting {setting: <int>, option: <int>} → change one device setting',
    '- startPreview / stopPreview → the low-latency preview feed; keepAlive → hold the link',
    '- connect / disconnect → open/close the camera link',
    '- deleteAll → DESTRUCTIVE: erase all media (the human must confirm separately)',
    '',
    `OPERATOR: ${o.message}`,
    '',
    'Reply with ONLY a JSON object, nothing around it:',
    '{ "say": "your short reply — confirm what you are doing or ask ONE clarifying question", "action": { "op": "record" } }',
    'Set "action" to null when you are only answering a question or lack enough detail. Use exactly one op from the vocabulary. Include op-specific fields (mode/presetId/setting/option) only when that op needs them.',
  ].join('\n');
}

/** Parse the operator reply envelope ({say, action|null}); tolerant of missing fields. */
export function parseControlEnvelope(text: string): ControlEnvelope {
  const fallbackSay = (text || '').trim();
  const o = extractEnvelopeJson(text);
  if (!o) return { say: fallbackSay, action: null };
  return { say: sayOr(o, fallbackSay), action: (o as Record<string, unknown>).action ?? null };
}

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * @description Build the /api/camera router (the packaged Camera Ops surface).
 * @param ctx - App context (pool for the audit log, orchestrator for the concierge,
 *              appPackageDir for the bundled surface).
 * @returns The configured Express router.
 */
export function createCameraRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;
  const camera = new CameraService();
  const appHtml = surfaceHtml(ctx.appPackageDir, 'camera-ops.html');

  ensureCameraSchema(pool).catch((err) => logger.warn({ err }, 'Camera schema bootstrap deferred — tables may not exist yet'));

  const viewer =
    (fn: (req: Request, res: Response, sub: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let sub: string;
      try { sub = resolveViewerSub(req); }
      catch (e: any) { res.status(e.status || 401).json({ error: e.message }); return; }
      try { await fn(req, res, sub); }
      catch (err: any) {
        if (err instanceof CameraConfirmationRequiredError) { res.status(428).json({ error: err.message, confirmationRequired: true }); return; }
        if (err instanceof CameraCommandError) { res.status(409).json({ error: err.message }); return; }
        logger.error({ err, path: req.path }, 'camera route error');
        res.status(500).json({ error: err.message || 'internal error' });
      }
    };

  const audit = async (sub: string, cameraId: string, op: string, detail: unknown, outcome: 'ok' | 'rejected'): Promise<void> => {
    await pool.query(
      `INSERT INTO camera_command_log (user_sub, camera_id, op, detail, outcome) VALUES ($1,$2,$3,$4,$5)`,
      [sub, cameraId, op, JSON.stringify(detail ?? null), outcome],
    ).catch((err) => logger.error({ err, op }, 'camera audit insert failed'));
  };

  /** One control endpoint: normalize the body into a command, execute (with the confirm gate),
   * audit both outcomes under the caller's sub, and return the camera's fresh telemetry. */
  const control: RequestHandler = viewer(async (req, res, sub) => {
    const cameraId = String(req.params.cameraId || req.body?.cameraId || DEFAULT_CAMERA_ID);
    const { command, errors } = normalizeCameraCommand(req.body);
    if (!command) { res.status(422).json({ error: 'invalid camera command', errors }); return; }
    const confirmed = req.body?.confirm === true;
    try {
      const telemetry = await camera.execute(cameraId, command, { confirmed });
      await audit(sub, cameraId, command.op, { command }, 'ok');
      res.json({ ok: true, telemetry });
    } catch (err) {
      if (err instanceof CameraCommandError || err instanceof CameraConfirmationRequiredError) {
        await audit(sub, cameraId, command.op, { command, error: err.message }, 'rejected');
      }
      throw err;
    }
  });

  // ── Surface + reads ──────────────────────────────────────────────────────
  router.get('/app', (_req: Request, res: Response) => {
    res.sendFile(appHtml, (err: unknown) => {
      if (err) { logger.error({ err, appHtml }, 'Failed to serve camera-ops.html'); res.status(404).send('Page not found: camera-ops.html'); }
    });
  });
  router.get('/fleet', viewer(async (_req, res) => { res.json({ fleet: camera.list() }); }));
  router.get('/state', viewer(async (req, res) => {
    res.json({ telemetry: camera.getTelemetry(String(req.query.cameraId || DEFAULT_CAMERA_ID)) });
  }));
  router.get('/events', viewer(async (req, res) => {
    res.json({ events: camera.getEvents(String(req.query.cameraId || DEFAULT_CAMERA_ID), Number(req.query.since) || 0) });
  }));
  router.get('/captures', viewer(async (req, res) => {
    res.json({ captures: camera.getCaptures(String(req.query.cameraId || DEFAULT_CAMERA_ID), Number(req.query.since) || 0) });
  }));

  // ── Control (deterministic; validated in CameraService) ────────────────────
  router.post('/control', control);
  router.post('/fleet/:cameraId/control', control);

  // Camera-node heartbeat ingest: a NODE identity, never an operator browser — the swarm service
  // secret is REQUIRED (the surrounding serviceSecretOr(requiresAuth) would also let an OIDC
  // session through, which must not be able to impersonate a camera).
  router.post('/nodes/heartbeat', async (req: Request, res: Response) => {
    if (!hasValidServiceSecret(req)) { res.status(401).json({ error: 'camera-node heartbeat requires the swarm service secret' }); return; }
    try {
      const b = (req.body || {}) as Partial<CameraNodeHeartbeat>;
      if (!b.cameraId || !b.endpointUrl || !b.telemetry) {
        res.status(400).json({ error: 'cameraId, endpointUrl, and telemetry are required' });
        return;
      }
      const ack = camera.ingestHeartbeat({
        cameraId: String(b.cameraId),
        endpointUrl: String(b.endpointUrl),
        engine: b.engine === 'gopro' ? 'gopro' : 'sim',
        telemetry: b.telemetry as CameraTelemetry,
        events: Array.isArray(b.events) ? b.events : [],
        videoUrl: typeof b.videoUrl === 'string' ? b.videoUrl : undefined,
        captures: Array.isArray(b.captures) ? b.captures : [],
      });
      res.json({ ok: true, ack });
    } catch (err: any) {
      if (err instanceof CameraCommandError) { res.status(409).json({ error: err.message }); return; }
      logger.error({ err }, 'camera heartbeat ingest failed');
      res.status(500).json({ error: err.message || 'internal error' });
    }
  });

  registerChatRoutes(router, viewer, ctx, camera, audit);
  return router;
}

// ── Concierge chat (interprets NL → one validated command; executes non-destructive) ──

type Viewer = (fn: (req: Request, res: Response, sub: string) => Promise<void>) => RequestHandler;
type Audit = (sub: string, cameraId: string, op: string, detail: unknown, outcome: 'ok' | 'rejected') => Promise<void>;

function registerChatRoutes(router: Router, viewer: Viewer, ctx: AppContext, camera: CameraService, audit: Audit): void {
  router.post('/chat', viewer(async (req, res, sub) => {
    const message = String(req.body?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }
    const cameraId = String(req.body?.cameraId || DEFAULT_CAMERA_ID);

    let telemetry: CameraTelemetry;
    try { telemetry = camera.getTelemetry(cameraId); }
    catch { telemetry = camera.getTelemetry(DEFAULT_CAMERA_ID); }
    const fleetLine = camera.list()
      .map((f) => `${f.cameraId} (${f.kind}, ${f.online ? 'online' : 'OFFLINE'}${f.telemetry ? `, ${f.telemetry.mode}, batt ${f.telemetry.batteryPct ?? '?'}%` : ''})`)
      .join('; ');
    const prompt = buildOperatorPrompt({ message, telemetry, cameraId, fleetLine });

    let raw = '';
    try {
      const result = await (ctx as any).orchestrator.processMessage(`camera-${sub}-${randomUUID()}`, prompt, {
        agenticMode: true, autoApprove: false, source: 'camera', agentId: OPERATOR_AGENT_ID, userSub: sub,
      });
      raw = String(result?.response || '').trim();
    } catch (e) { logger.error({ e }, 'camera operator orchestrate failed'); }

    const env = parseControlEnvelope(raw);
    if (!env.say) env.say = "I couldn't reach the camera brain just now — try again in a moment.";

    // Interpret + execute at most one command. Destructive ops are NOT auto-run — the reply asks
    // the human to confirm via the explicit control endpoint (confirm:true).
    let executed: { op: string; telemetry: CameraTelemetry } | null = null;
    let actionErrors: string[] = [];
    let confirmNeededOp: string | null = null;
    const { command, errors } = normalizeCameraCommand(env.action);
    if (env.action && !command) actionErrors = errors;
    if (command) {
      try {
        const tele = await camera.execute(cameraId, command);
        await audit(sub, cameraId, command.op, { command, via: 'chat' }, 'ok');
        executed = { op: command.op, telemetry: tele };
      } catch (err) {
        if (err instanceof CameraConfirmationRequiredError) { confirmNeededOp = command.op; }
        else if (err instanceof CameraCommandError) { actionErrors = [err.message]; await audit(sub, cameraId, command.op, { command, error: err.message }, 'rejected'); }
        else throw err;
      }
    }
    res.json({ reply: env.say, executed, actionErrors, confirmNeededOp });
  }));
}
