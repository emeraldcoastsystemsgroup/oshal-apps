/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 00:25:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — aero-lab routes
 *                     |                             | (BUILD_CONTRACT §2/§2a/§2b, sat-routes pattern):
 *                     |                             | GET /app + /app.js (bundled surface), GET
 *                     |                             | /capabilities (engine presence + feature flags,
 *                     |                             | honest 200 even when absent), POST /polar /evaluate
 *                     |                             | /screen /mission /export against the real aerosim
 *                     |                             | engine via the subprocess adapter, allow-listed
 *                     |                             | per-file export downloads, and the aero-designer
 *                     |                             | concierge POST /chat (drafts only — the human runs
 *                     |                             | the engine). No mocks anywhere: a missing engine or
 *                     |                             | module returns 503 capability_unavailable with the
 *                     |                             | reason; numbers only ever come from the engine.
 * 2026-08-03 03:20:00 | maintainer@emeraldcoastsystemsgroup.com | Integration fix: four sanity bounds were
 *                     |                             | TIGHTER than the engine's own published bounds, so
 *                     |                             | the route refused designs the engine accepts — the
 *                     |                             | opposite of this table's stated job. Measured against
 *                     |                             | the live capabilities payload: area_m2 20 vs engine
 *                     |                             | 195, battery_mass_kg 100 vs 500, fus_over_floor
 *                     |                             | [0.5,3] vs [0.25,8], buoyancy_fraction 0.95 vs 1.0.
 *                     |                             | The last one mattered most: f=1.00 is the pure-float
 *                     |                             | craft the persona ships as a validated design, and
 *                     |                             | the surface's own buoyancy slider ends at 1.0 — its
 *                     |                             | last notch 400'd before the engine ever ran. Widened
 *                     |                             | so the engine's bounds bind, which the live spec now
 *                     |                             | asserts field-by-field against published bounds.
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Serve the browser geometry helper as a
 *                     |                             | first-class package asset so the cockpit and
 *                     |                             | cross-runtime parity spec execute the exact
 *                     |                             | same JavaScript implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { AeroEngineAdapter, AeroEngineError } from './engine-adapter';

const logger = createChildLogger({ module: 'aero-lab-routes' });

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const AERO_DESIGNER_AGENT_ID = 'b0ae0000-0000-0000-0000-000000000001';

/**
 * The frozen design-vector wire shape (§2a) with defaults from the engine's own proven
 * sweep winner — R7_winner_vector.json "v" block (min SOC 0.4366, usable 1.0586) plus
 * buoyancy_fraction 0 (pure fixed-wing unless the hybrid capability is live). Values are
 * rounded for readability; the engine re-validates authoritatively.
 */
export const DEFAULT_DESIGN: Record<string, number> = {
  area_m2: 0.9, aspect_ratio: 12.0, taper_ratio: 0.57,
  twist_root_deg: 2.0, twist_tip_deg: -0.93, extra_CD0: 0.0059,
  battery_mass_kg: 2.04, pack_Wh_per_kg: 441.8,
  cell_eff: 0.29, pv_density: 0.296, pv_packing: 0.9,
  prop_max_W: 2102.7, prop_diameter_m: 0.498,
  payload_W: 4.57, payload_mass_kg: 0.244,
  altitude_m: 163.7, latitude_deg: -10.4, day_of_year: 90,
  fus_over_floor: 1.01,
  buoyancy_fraction: 0.0,
};

/**
 * Garbage-early sanity bounds per field: [min, max]. These reject nonsense before a
 * worker spawn; the ENGINE's published bounds (worker capabilities → bounds) are the
 * authority and are applied on top when cached. Source: the R7 sweep envelope widened
 * to physical-plausibility limits — deliberately loose so the engine's own bounds bind.
 */
export const DESIGN_SANITY_BOUNDS: Record<string, [number, number]> = {
  area_m2: [0.01, 500], aspect_ratio: [2, 40], taper_ratio: [0.05, 1],
  twist_root_deg: [-10, 10], twist_tip_deg: [-10, 10], extra_CD0: [0, 0.1],
  battery_mass_kg: [0, 1000], pack_Wh_per_kg: [50, 1000],
  cell_eff: [0.05, 0.5], pv_density: [0.01, 5], pv_packing: [0.1, 1],
  prop_max_W: [10, 100_000], prop_diameter_m: [0.05, 5],
  payload_W: [0, 1000], payload_mass_kg: [0, 50],
  altitude_m: [0, 30_000], latitude_deg: [-90, 90], day_of_year: [1, 366],
  fus_over_floor: [0.1, 20], buoyancy_fraction: [0, 1],
};

/**
 * @description Validate + normalize a request's design vector: unknown fields rejected,
 * every known field present-or-defaulted, finite, inside the sanity bounds and (when the
 * worker's published bounds are cached) inside those too. Clamp nothing — reject.
 * @param raw - The request body's design value.
 * @param workerBounds - `bounds` from cached worker capabilities, when available.
 * @returns The full normalized vector, or the rejection reason.
 */
export function validateDesign(
  raw: unknown,
  workerBounds?: Record<string, unknown> | null,
): { design: Record<string, number> } | { error: string } {
  if (raw === undefined || raw === null) return { error: 'design (object) is required' };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'design must be a JSON object' };
  const body = raw as Record<string, unknown>;
  for (const k of Object.keys(body)) {
    if (!(k in DEFAULT_DESIGN)) return { error: `unknown design field "${k}"` };
  }
  const design: Record<string, number> = {};
  for (const [field, dflt] of Object.entries(DEFAULT_DESIGN)) {
    const v = body[field] === undefined ? dflt : Number(body[field]);
    if (!Number.isFinite(v)) return { error: `design.${field} must be a finite number` };
    const [lo, hi] = DESIGN_SANITY_BOUNDS[field];
    if (v < lo || v > hi) return { error: `design.${field}=${v} is outside sanity bounds [${lo}, ${hi}]` };
    const wb = workerBounds?.[field];
    if (Array.isArray(wb) && wb.length === 2 && Number.isFinite(Number(wb[0])) && Number.isFinite(Number(wb[1]))) {
      if (v < Number(wb[0]) || v > Number(wb[1])) {
        return { error: `design.${field}=${v} is outside engine bounds [${wb[0]}, ${wb[1]}]` };
      }
    }
    design[field] = v;
  }
  if (!Number.isInteger(design.day_of_year)) return { error: 'design.day_of_year must be an integer (1–366)' };
  return { design };
}

/**
 * @description Resolve a surface file from the package's tools/ dir (ctx.appPackageDir
 * captured at factory time per D10), load-time env fallback, then relative to the built
 * routes/ dir (tests, local checks). Verbatim sat-routes pattern.
 * @param appPackageDir - This package's directory from the per-package context.
 * @param fileName - The bundled surface file.
 * @returns The first existing candidate path (or the last for sendFile's 404 path).
 */
function surfaceHtml(appPackageDir: string | undefined, fileName: string): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
    path.resolve(__dirname, '../tools', fileName),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}

/** Serve one bundled surface file (resolved once per factory call). */
function serveFile(filePath: string): RequestHandler {
  return (_req: Request, res: Response) => {
    res.sendFile(filePath, (err: unknown) => {
      if (err) { logger.error({ err, filePath }, 'Failed to serve surface file'); res.status(404).send('Page not found'); }
    });
  };
}

/**
 * @description Map a typed engine failure to the frozen §2a status codes. Anything that
 * is not an AeroEngineError is a route bug — logged with stack, 500.
 * @param res - The response.
 * @param err - What the adapter threw.
 * @param what - Route label for logs.
 */
function engineErrorTo(res: Response, err: unknown, what: string): void {
  if (err instanceof AeroEngineError) {
    switch (err.code) {
      case 'capability_unavailable':
        res.status(503).json({ error: err.message, code: 'capability_unavailable', reason: err.reason || err.message });
        return;
      case 'invalid_design':
        res.status(400).json({ error: err.message });
        return;
      case 'inadmissible_input':
        res.status(422).json({ error: err.message });
        return;
      case 'engine_timeout':
        res.status(504).json({ error: err.message });
        return;
      case 'engine_busy':
        res.status(503).json({ error: err.message });
        return;
      default:
        logger.error({ code: err.code, message: err.message }, `${what} engine error`);
        res.status(500).json({ error: err.message });
        return;
    }
  }
  logger.error({ err, stack: (err as Error)?.stack }, `${what} failed`);
  res.status(500).json({ error: `${what} failed` });
}

/** Shape-pick of the worker's capabilities result (route passes it through, §2a). */
interface WorkerCaps {
  engineVersion?: string | null;
  python?: string;
  capabilities?: Record<string, unknown>;
  bounds?: Record<string, unknown>;
}

/** One recorded export — the download allow-list (§2a: never path-join a raw name). */
interface ExportRecord { dir: string; files: string[] }

/**
 * @description Build the aero-designer turn prompt: live capability flags (so the bot
 * never drafts what the engine cannot run), the slider bounds, the user's current
 * vector, the short client-side history, and the strict say+draft output contract.
 * @param o - Message, history, and the context lines.
 * @returns The prompt string.
 */
function buildAeroDesignerPrompt(o: {
  message: string;
  history: Array<{ role: string; content: string }>;
  capsLine: string;
  boundsLine: string;
  currentLine: string;
}): string {
  const convo = o.history.slice(-8).map((h) => `${h.role === 'assistant' ? 'You' : 'Designer'}: ${h.content}`).join('\n');
  return [
    'You are the Aero Designer — the design-drafting brain of the Aero Lab. The user describes the craft they want; you produce a design-vector DRAFT. You never compute performance numbers: the validated aerosim engine is the only source of polars, SOC traces, and verdicts, and your drafts only reach it after the human presses Run. Never claim a design works — say the engine will judge it.',
    '',
    `ENGINE CAPABILITIES: ${o.capsLine}`,
    `SLIDER BOUNDS: ${o.boundsLine}`,
    `CURRENT DESIGN: ${o.currentLine}`,
    '',
    convo ? `CONVERSATION SO FAR:\n${convo}\n` : '',
    `Designer: ${o.message}`,
    '',
    'Reply with ONLY a JSON object, nothing around it:',
    '{ "say": "your reply", "draft": { "area_m2": 0.9, "aspect_ratio": 12.0 } }',
    `Draft fields (all optional, all numeric, inside the bounds): ${Object.keys(DEFAULT_DESIGN).join(', ')}.`,
    'No draft to suggest → "draft": null. Never invent fields. buoyancy_fraction must stay 0 unless the capabilities line says hybrid true.',
  ].join('\n');
}

/**
 * @description Parse + validate the concierge envelope. Anything malformed degrades to
 * a say-only reply — a bad draft must never reach the sliders (§2b). Fields are checked
 * finite + in bounds; nothing is clamped — a bad draft is dropped whole.
 * @param raw - Raw model output.
 * @param hybridOk - Whether the hybrid capability is live (gates buoyancy_fraction > 0).
 * @param workerBounds - Engine-published bounds when cached.
 * @returns say + a validated full design draft or null.
 */
export function parseAeroDesignerEnvelope(
  raw: string,
  hybridOk: boolean,
  workerBounds?: Record<string, unknown> | null,
): { say: string; draft: Record<string, number> | null } {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { say: raw.slice(0, 2000), draft: null };
  let env: Record<string, unknown>;
  try { env = JSON.parse(m[0]) as Record<string, unknown>; } catch { return { say: raw.slice(0, 2000), draft: null }; }
  const say = String(env.say || '').slice(0, 4000) || 'No reply.';
  const d = env.draft;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { say, draft: null };
  const validated = validateDesign(d, workerBounds);
  if ('error' in validated) {
    logger.warn({ error: validated.error }, 'concierge draft rejected — degrading to say-only');
    return { say, draft: null };
  }
  if (validated.design.buoyancy_fraction > 0 && !hybridOk) {
    logger.warn({}, 'concierge drafted buoyancy without the hybrid capability — draft dropped');
    return { say, draft: null };
  }
  return { say, draft: validated.design };
}

/** Optional overrides for tests + the app context (orchestrator for /chat). */
export interface AeroLabRouteOpts { adapter?: AeroEngineAdapter; ctx?: unknown }

/**
 * @description Build the /api/aero-lab router (frozen §2a API) over one engine adapter
 * (injectable for tests). Accepts EITHER the opts wrapper ({adapter?, ctx?}) OR a bare
 * AppContext (how the manifest-route-mounter invokes a packaged factory with
 * requiresContext) — sat-routes pattern verbatim. Auth is the manifest's
 * `requiresAuth: true` wrapping the whole mount; nothing here mounts elsewhere.
 * @param arg - Opts wrapper, or the AppContext itself.
 * @returns The router.
 */
export function createAeroLabRoutes(arg: AeroLabRouteOpts | Record<string, unknown> = {}): Router {
  const isOpts = arg !== null && typeof arg === 'object' && ('adapter' in arg || 'ctx' in arg);
  const opts: AeroLabRouteOpts = isOpts ? (arg as AeroLabRouteOpts) : { ctx: arg };
  const appPackageDir = (opts.ctx as { appPackageDir?: string } | undefined)?.appPackageDir;
  const adapter = opts.adapter ?? new AeroEngineAdapter({ appPackageDir });
  const exports = new Map<string, ExportRecord>();
  const router = Router();

  // ── The bundled surface ────────────────────────────────────────────────────
  router.get('/app', serveFile(surfaceHtml(appPackageDir, 'aero-lab.html')));
  router.get('/geometry.js', serveFile(surfaceHtml(appPackageDir, 'aero-lab-geometry.js')));
  router.get('/app.js', serveFile(surfaceHtml(appPackageDir, 'aero-lab.js')));

  /** GET /capabilities — honest presence + per-module flags. 200 even when absent: the
   * surface's first paint renders these flags; absence is data, not an error. */
  router.get('/capabilities', (_req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const started = Date.now();
      const status = adapter.engineStatus();
      const engine = { present: status.present, engineDir: status.engineDir, python: status.python, venvOk: status.venvOk, version: null as string | null };
      if (!status.present) {
        const reason = !status.venvOk
          ? `engine venv not found (${status.python}) — set AERO_LAB_ENGINE_DIR / run engine/setup-venv`
          : `engine worker script not found (${status.workerPath})`;
        res.json({ engine, capabilities: null, bounds: null, reason });
        return;
      }
      try {
        const caps = (await adapter.capabilities()) as WorkerCaps;
        engine.version = caps.engineVersion == null ? null : String(caps.engineVersion);
        if (caps.python) engine.python = String(caps.python);
        logger.info({ durationMs: Date.now() - started }, 'GET /capabilities done');
        res.json({ engine, capabilities: caps.capabilities ?? null, bounds: caps.bounds ?? null });
      } catch (err) {
        engineErrorTo(res, err, 'capabilities');
      }
    })();
  });

  /** Shared handler for the four design→engine commands (validate early, engine re-validates). */
  const runEngine = (cmd: 'polar' | 'evaluate' | 'screen' | 'export', req: Request, res: Response, extraArgs: Record<string, unknown> = {}): void => {
    void (async (): Promise<void> => {
      const started = Date.now();
      const caps = adapter.cachedCapabilities() as WorkerCaps | null;
      const v = validateDesign((req.body || {}).design, caps?.bounds ?? null);
      if ('error' in v) { res.status(400).json({ error: v.error }); return; }
      try {
        if (v.design.buoyancy_fraction > 0) {
          const live = (await adapter.capabilities()) as WorkerCaps;
          if (!(live.capabilities as { hybrid?: boolean } | undefined)?.hybrid) {
            res.status(503).json({
              error: 'buoyancy_fraction > 0 needs the hybrid buoyancy capability, which is not available',
              code: 'capability_unavailable',
              reason: 'hybrid module not importable in the engine tree (in-flight upgrade) — set buoyancy_fraction to 0',
            });
            return;
          }
        }
        const result = await adapter.request(cmd, { design: v.design, ...extraArgs });
        logger.info({ cmd, durationMs: Date.now() - started }, `POST /${cmd} done`);
        if (cmd === 'export') {
          const r = result as { exportId?: unknown; files?: unknown };
          const exportId = String(r.exportId || '');
          const files = Array.isArray(r.files) ? (r.files as unknown[]).map(String) : [];
          if (!exportId || files.length === 0) {
            res.status(500).json({ error: 'engine export returned no files' });
            return;
          }
          exports.set(exportId, { dir: path.join(adapter.workDir, 'exports', exportId), files });
          res.json({ exportId, files });
          return;
        }
        res.json(result);
      } catch (err) {
        engineErrorTo(res, err, cmd);
      }
    })();
  };

  /** POST /polar {design} — real wing polar via the engine. */
  router.post('/polar', (req: Request, res: Response) => runEngine('polar', req, res));

  /** POST /evaluate {design} — build + 24 h energy limit cycle + verdict. */
  router.post('/evaluate', (req: Request, res: Response) => runEngine('evaluate', req, res));

  /** POST /screen {design} — admissibility screen, reasons verbatim. */
  router.post('/screen', (req: Request, res: Response) => runEngine('screen', req, res));

  /** POST /mission {design, days?} — capability-gated multi-day mission (503 until the
   * in-flight mission module lands; the worker's feature detection is the gate). */
  router.post('/mission', (req: Request, res: Response) => {
    const rawDays = (req.body || {}).days;
    const days = rawDays === undefined ? 3 : Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      res.status(400).json({ error: 'days must be an integer between 1 and 30' });
      return;
    }
    void (async (): Promise<void> => {
      const caps = adapter.cachedCapabilities() as WorkerCaps | null;
      const v = validateDesign((req.body || {}).design, caps?.bounds ?? null);
      if ('error' in v) { res.status(400).json({ error: v.error }); return; }
      try {
        const result = await adapter.request('mission', { design: v.design, days });
        res.json(result);
      } catch (err) {
        engineErrorTo(res, err, 'mission');
      }
    })();
  });

  /** POST /export {design} — generate the build package; files download individually. */
  router.post('/export', (req: Request, res: Response) => runEngine('export', req, res));

  /** GET /export/:exportId/:file — stream one recorded file. `:file` is validated
   * against the export's recorded list — never path-joined raw (§2a). */
  router.get('/export/:exportId/:file', (req: Request, res: Response) => {
    const exportId = String(req.params.exportId);
    const file = String(req.params.file);
    const record = exports.get(exportId);
    if (!record) { res.status(404).json({ error: `unknown exportId "${exportId}"` }); return; }
    if (!record.files.includes(file) || path.basename(file) !== file) {
      logger.warn({ exportId, file }, 'export download refused — not in the recorded file list');
      res.status(404).json({ error: `"${file}" is not a file of export "${exportId}"` });
      return;
    }
    const filePath = path.join(record.dir, file);
    res.download(filePath, file, (err?: Error) => {
      if (err && !res.headersSent) {
        logger.error({ err, filePath }, 'export download failed');
        res.status(404).json({ error: 'export file no longer on disk' });
      }
    });
  });

  /** POST /chat — the aero-designer concierge: drafts only; the human runs the engine. */
  router.post('/chat', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const started = Date.now();
      const message = String((req.body || {}).message || '').trim();
      if (!message) { res.status(400).json({ error: 'message is required' }); return; }
      const orchestrator = (opts.ctx as { orchestrator?: { processMessage: (id: string, prompt: string, o: Record<string, unknown>) => Promise<{ response?: string }> } } | undefined)?.orchestrator;
      if (!orchestrator) { res.status(503).json({ error: 'aero-designer concierge is not wired on this deployment' }); return; }
      const history = Array.isArray((req.body || {}).history) ? ((req.body as Record<string, unknown>).history as Array<{ role: string; content: string }>).slice(-8) : [];
      let caps: WorkerCaps | null = null;
      try { caps = (await adapter.capabilities()) as WorkerCaps; } catch (err) {
        logger.warn({ error: (err as Error).message }, 'capabilities unavailable for chat context — telling the bot');
      }
      const capsLine = caps?.capabilities ? JSON.stringify(caps.capabilities) : 'engine OFFLINE — every command will 503; draft anyway but say the engine cannot run it right now';
      const boundsLine = caps?.bounds ? JSON.stringify(caps.bounds) : JSON.stringify(DESIGN_SANITY_BOUNDS);
      const current = validateDesign((req.body || {}).design ?? {}, caps?.bounds ?? null);
      const currentLine = 'design' in current ? JSON.stringify(current.design) : '(none provided)';
      const prompt = buildAeroDesignerPrompt({ message, history, capsLine, boundsLine, currentLine });
      const sub = String((req as unknown as { oidc?: { user?: { sub?: string } } }).oidc?.user?.sub || 'operator');
      let raw = '';
      try {
        const result = await orchestrator.processMessage(`aero-${sub}-${started}`, prompt, {
          agenticMode: true, autoApprove: false, source: 'aero-lab', agentId: AERO_DESIGNER_AGENT_ID, userSub: sub,
        });
        raw = String(result?.response || '').trim();
      } catch (err) {
        logger.error({ err, stack: (err as Error).stack }, 'aero-designer orchestrate failed');
      }
      const hybridOk = !!(caps?.capabilities as { hybrid?: boolean } | undefined)?.hybrid;
      const env = parseAeroDesignerEnvelope(raw, hybridOk, caps?.bounds ?? null);
      if (!raw) env.say = "I couldn't reach the design brain just now — try again in a moment.";
      logger.info({ hasDraft: !!env.draft, durationMs: Date.now() - started }, 'POST /chat done');
      res.json(env);
    })();
  });

  return router;
}
