/**
 * Pumpkin Routes — the animated talking jack-o'-lantern Halloween prop (?app=pumpkin).
 *
 * Backs two surfaces: the full-screen PROJECTOR page at /pumpkin/ (src/pages/pumpkin) and the
 * cockpit CONTROL surface at /api/pumpkin/app. Two run modes:
 *   - MIMIC: the operator feeds a line (mic → STT in the browser) and the pumpkin SAYS it. Pure
 *     voice I/O — the projector calls /api/voice/synthesize directly; NO LLM, so this file only
 *     relays the text (room push) for the paired topology.
 *   - AUTONOMOUS: a guest speaks, and pumpkin-bot (inline, agent ...054) replies IN CHARACTER via
 *     executeBotOrInline — the sanctioned ADR-036 chokepoint, so cost lands in chat_tasks.
 *
 * Two topologies, both here:
 *   - ALL-IN-ONE: the projector page captures, thinks (POST /chat), speaks, animates. No rooms.
 *   - PAIRED: the projector registers a ROOM + SSE-subscribes (GET /stream); a phone/control remote
 *     lists rooms and pushes speak/preset/mode events (POST /rooms/*). The pumpkin's INPUT endpoints
 *     are gated by an optional env allowlist (PUMPKIN_ALLOWED_SUBS/EMAILS) on top of the mount's
 *     serviceSecretOr(requiresAuth) — everything is owner-scoped by OIDC sub regardless.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-07-15 18:50:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial: pumpkin prop surface +
 *            | API — presets CRUD, last-used settings, autonomous chat via pumpkin-bot, and the
 *            | paired-remote room registry (register/heartbeat/list/SSE stream/push). Reuses the
 *            | voice pipeline (surfaces call /api/voice/*) and the Jarvis room pattern.
 * 2026-07-19 15:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into
 *            | the pumpkin app package (ADR-085 Wave 3, "skill with a surface"). The two surfaces
 *            | serve from ctx.appPackageDir/tools (load-time env fallback, D10); shared framework
 *            | helpers import via @/ aliases (the pumpkin ENGINE (bundled ./pumpkin-engine-* — presets/
 *            | reply/rooms — inline-bot-execution, agent-management, authz). The pumpkin-bot
 *            | INLINE node (...054, container oshal-api), the /pumpkin projector framework page,
 *            | and migration 084 stay framework-resident; this package ships a migrations/ copy
 *            | so fresh installs create the tables at load (the engine's ensureSchema also
 *            | self-heals lazily).
 * ---------------------------------------------------------------------------
 * @module pumpkin-routes
 * 2026-07-19 14:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Engine bundled INTO the package (pumpkin-engine-* flat modules): the kernel rip left @/features/pumpkin with ZERO kernel importers, tsc pruned it from dist, and the packaged route failed at mount (the D8 silent-prune class). Pumpkin's engine is exclusively pumpkin's - self-containment beats pinning dead domain code in the kernel build.
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getTrustedServiceUserSub, getCaller, isOperatorIdentity } from '@/shared/middleware/authz';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { PumpkinPresetService, parsePumpkinReply, pumpkinRooms, type PumpkinReply, type PumpkinMode } from './pumpkin-engine';

const logger = createChildLogger({ module: 'pumpkin-routes' });

/** The pumpkin-bot agent (registered inline on the api, container 'oshal-api'). Cost lands here. */
const PUMPKIN_AGENT_ID = 'a0000000-0000-0000-0000-000000000054';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

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

/** Serve one bundled surface file (resolved once per factory call). */
function serveFile(filePath: string): RequestHandler {
  return (_req: Request, res: Response) => {
    res.sendFile(filePath, (err: unknown) => {
      if (err) {
        logger.error({ err, filePath }, 'Failed to serve surface file');
        if (!res.headersSent) res.status(404).send('Page not found');
      }
    });
  };
}

/** The authenticated caller, from the OIDC session or a trusted service call. Throws 401 otherwise. */
function resolveSub(req: Request): string {
  const trusted = getTrustedServiceUserSub(req);
  if (trusted) return trusted;
  const oidc = (req as any).oidc;
  if (oidc?.isAuthenticated?.() && (oidc.user?.sub || oidc.user?.oid)) return String(oidc.user.sub || oidc.user.oid);
  if (process.env.MOCK_OIDC === 'true') return 'demo-operator';
  throw Object.assign(new Error('Not authenticated'), { status: 401 });
}

type SubHandler = (req: Request, res: Response, sub: string) => Promise<void> | void;

/** Wrap a handler: resolve the caller sub (401 on failure) and centralize error → 500 mapping. */
function withSub(fn: SubHandler): RequestHandler {
  return async (req: Request, res: Response) => {
    let sub: string;
    try {
      sub = resolveSub(req);
    } catch {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      await fn(req, res, sub);
    } catch (err) {
      logger.error({ err, path: req.path }, 'pumpkin route failed');
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}

/** Comma-separated env allowlist → lowercased Set. */
function parseList(v?: string): Set<string> {
  return new Set((v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * @description Gate the pumpkin's INPUT-producing endpoints. Everything is already owner-scoped by
 * sub; when PUMPKIN_ALLOWED_SUBS/EMAILS is configured it further restricts who may drive the prop
 * (fail-closed to that list + operators). Unconfigured → any authenticated owner passes.
 */
function inputAllowed(req: Request, sub: string): boolean {
  const subs = parseList(process.env.PUMPKIN_ALLOWED_SUBS);
  const emails = parseList(process.env.PUMPKIN_ALLOWED_EMAILS);
  if (subs.size === 0 && emails.size === 0) return true;
  const email = getCaller(req).email;
  if (sub && subs.has(sub.toLowerCase())) return true;
  if (email && emails.has(email.toLowerCase())) return true;
  return isOperatorIdentity(sub, email);
}

/** Enforce {@link inputAllowed}; writes 403 and returns false when the caller is off the allowlist. */
function gateInput(req: Request, res: Response, sub: string): boolean {
  if (inputAllowed(req, sub)) return true;
  res.status(403).json({ error: 'not_on_pumpkin_allowlist' });
  return false;
}

/** Run one guest line through pumpkin-bot and parse its in-character reply. */
async function runPumpkin(ctx: AppContext, sub: string, text: string): Promise<PumpkinReply> {
  const prompt = `A guest at your porch just said to you:\n"""\n${text.slice(0, 600)}\n"""\n\nReply in character as the jack-o'-lantern, using ONLY the JSON contract { "say", "expression", "intensity" }.`;
  const result = await executeBotOrInline(ctx, botClient, PUMPKIN_AGENT_ID, {
    text: prompt,
    taskId: `pumpkin-${sub}-${randomUUID()}`,
    workspaceFolderId: `pumpkin-${sub}`,
    agentId: PUMPKIN_AGENT_ID,
    agenticMode: true,
    direct: true,
    userSub: sub,
  });
  return parsePumpkinReply(String(result?.response || ''));
}

/** Read a normalized mode from a request body value. */
function readMode(v: unknown): PumpkinMode {
  return v === 'autonomous' ? 'autonomous' : 'mimic';
}

/**
 * @description Build the pumpkin prop router. Mounted at /api/pumpkin behind serviceSecretOr(requiresAuth).
 * @param ctx - App context (pool for presets, orchestrator for the inline bot).
 * @returns The configured Express router.
 */
export function createPumpkinRoutes(ctx: AppContext): Router {
  const router = Router();
  const presetSvc = new PumpkinPresetService(ctx.pool);
  void presetSvc.ensureSchema();

  // ── Surfaces (bundled in this package's tools/) ───────────────────────────
  router.get('/app', serveFile(surfaceHtml(ctx.appPackageDir, 'pumpkin-app.html')));
  router.get('/remote', serveFile(surfaceHtml(ctx.appPackageDir, 'pumpkin-remote.html')));

  // ── Presets (built-ins + per-user saved customs) ──────────────────────────
  router.get('/presets', withSub(async (_req, res, sub) => {
    res.json({ presets: await presetSvc.listPresets(sub) });
  }));
  router.get('/presets/:name', withSub(async (req, res, sub) => {
    const preset = await presetSvc.getPreset(sub, String(req.params.name));
    if (!preset) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ preset });
  }));
  router.put('/presets/:name', withSub(async (req, res, sub) => {
    const preset = await presetSvc.savePreset(sub, String(req.params.name), req.body);
    res.json({ preset });
  }));
  router.delete('/presets/:name', withSub(async (req, res, sub) => {
    res.json({ deleted: await presetSvc.deletePreset(sub, String(req.params.name)) });
  }));

  // ── Last-used settings ────────────────────────────────────────────────────
  router.get('/settings', withSub(async (_req, res, sub) => {
    res.json(await presetSvc.getSettings(sub));
  }));
  router.put('/settings', withSub(async (req, res, sub) => {
    await presetSvc.saveSettings(sub, String(req.body?.activePreset || 'inflatable'), readMode(req.body?.mode));
    res.json({ ok: true });
  }));

  // ── Autonomous chat (ALL-IN-ONE topology) ─────────────────────────────────
  router.post('/chat', withSub(async (req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const text = String(req.body?.text || req.body?.message || '').trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    res.json({ reply: await runPumpkin(ctx, sub, text) });
  }));

  // ── Rooms (PAIRED topology) ───────────────────────────────────────────────
  router.post('/rooms/register', withSub((req, res, sub) => {
    res.json(pumpkinRooms.register(sub, String(req.body?.label || 'Main')));
  }));
  router.post('/rooms/heartbeat', withSub((req, res, sub) => {
    res.json({ ok: pumpkinRooms.heartbeat(sub, String(req.body?.room || '')) });
  }));
  router.get('/rooms', withSub((_req, res, sub) => {
    res.json({ rooms: pumpkinRooms.list(sub) });
  }));

  // Projector SSE subscription — receives speak/preset/mode/ping events for its room.
  router.get('/stream', withSub((req, res, sub) => {
    const room = String(req.query.room || '').trim();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const send = (evt: unknown) => { try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch { /* client gone */ } };
    const unsub = pumpkinRooms.subscribe(sub, room, send);
    if (!unsub) { send({ type: 'error', error: 'unknown_room' }); res.end(); return; }
    const keepAlive = setInterval(() => send({ type: 'ping' }), 25000);
    req.on('close', () => { clearInterval(keepAlive); unsub(); });
  }));

  // Remote → room pushes. speak(mimic)/ask(autonomous) are input-gated; preset/mode are display-only.
  router.post('/rooms/say', withSub((req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const text = String(req.body?.text || '').trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''),
      { type: 'speak', say: text.slice(0, 300), expression: 'neutral', intensity: 0.6, mimic: true });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    res.json({ ok: true, listeners: n });
  }));
  router.post('/rooms/ask', withSub(async (req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const text = String(req.body?.text || '').trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const reply = await runPumpkin(ctx, sub, text);
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''), { type: 'speak', ...reply });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    res.json({ ok: true, reply, listeners: n });
  }));
  router.post('/rooms/preset', withSub((req, res, sub) => {
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''),
      { type: 'preset', name: String(req.body?.name || '').trim() });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    res.json({ ok: true, listeners: n });
  }));
  router.post('/rooms/mode', withSub((req, res, sub) => {
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''),
      { type: 'mode', mode: readMode(req.body?.mode) });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    res.json({ ok: true, listeners: n });
  }));

  return router;
}
