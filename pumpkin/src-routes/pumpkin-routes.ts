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
 * 2026-07-24 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Saved-responses playlist (operator request): every spoken line (rooms/say mimic, rooms/ask + /chat autonomous replies) auto-saves per user (deduped, unpinned cap); new /responses CRUD (list/save/pin/delete) + POST /rooms/replay pushes a saved line to the projector in one tap — instant replay, no LLM regeneration.
 * 2026-08-01 12:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | THE SWARM DOOR (operator: "it needs to be controlled from the swarm"). Nothing in the swarm could make the prop speak: pumpkinRooms.push() demands the 18-byte pairing token, which register() only ever hands back to the registering BROWSER, so no bot, ticket, or Jarvis path could obtain one. New POST /speak is a service-secret-ONLY door — its FIRST statement is hasValidServiceSecret(req), deliberately NOT resolveSub/getTrustedServiceUserSub (resolveSub answers for any OIDC session and for MOCK_OIDC, which would have handed every signed-in browser a token-free hijack). The browser /rooms/* doors keep the pairing token unchanged and forever. /speak resolves the room itself and FAILS LOUD — no_live_pumpkin / ambiguous_room / projector_not_listening / unknown_room — and only writes the playlist on a real 200, because "the pumpkin said it" when no screen was listening is the worst answer this API can give. runPumpkin now leads its prompt with [[PUMPKIN:GUEST]] (a fence guest text cannot occupy, since guest text is interpolated later inside triple quotes) and holds a per-owner reentrancy lock, so the bot that HOLDS the speak tool and also answers mode:'ask' burns one turn instead of a budget. Server half of the resilience work too: GET /stream now answers 409 BEFORE writeHead for an unknown room (a 200-then-end reads to EventSource as a dropped connection it retries silently forever), the SSE transport reports unwritability so the registry can prune it (res.write on a destroyed socket does not throw, so the old empty catch was dead code), and /rooms/heartbeat tells a caller WHY it failed so a projector can re-register.
 * 2026-08-01 22:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Three defects the swarm-door change left behind. (1) GET /links + GET /qr NOW EXIST. Both were documented across a whole README section and both QR runbook steps, and the control surface has been calling /links since Design C — but no router ever registered them, so the Projector-link card and BOTH QR images sat permanently in their degraded fallback: a URL built from the cockpit browser's own address (http://localhost:35457 on the operator's laptop, which cannot open on a phone). The QR target is a closed whitelist of the two pages this app serves; encoding a caller-supplied URL would make a signed-in cockpit a phishing generator on this deployment's own domain. The encoder is required LAZILY so a core-image dependency cannot make this package's route module unloadable. (2) PUT /settings NO LONGER DROPS roomLabel. The surface always sent it; the route ignored it, so the short-form projector URL the runbook tells the operator to type could not restore the room and the projector came up in 'main' while the cockpit pushed to 'front-porch' — a silent prop, caused by the documentation. (3) THE SWARM DOOR IS GATED ON THE ACTOR, not only the target. gateInput evaluates `sub`, which on /speak is the trusted X-OSHAL-User-Sub — i.e. the OWNER, not the caller — so an allowlist naming an owner did not constrain who could drive that owner's screens. gateSwarmSpeak keeps that owner check and adds the operator's intent: with an allowlist configured, the swarm door additionally requires PUMPKIN_ALLOW_SWARM_SPEAK (outward-acting automation is opt-in). With no allowlist configured, nothing changes.
 * 2026-10-10 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | GET /assets/pumpkin-face.js and /assets/pumpkin-audio.js serve the two surface scripts from this package's tools/. The control and remote pages loaded them from the framework's /pumpkin/ page directory, which the native kernel does not serve, so /api/pumpkin/app failed with 404s and "window.PumpkinFace is not a constructor".
 * 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | GET /projector serves the full-screen projector page (ported from the framework's /pumpkin/ page into tools/pumpkin-projector.{html,js,css}; the native kernel never served /pumpkin/, so every projector link and Launch was a 404), its script and stylesheet join the /assets/ list, and device links keep the request's port and use http on loopback (requestOrigin) instead of https://<hostname>.
 * 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | The projector's room link works on the native kernel. Its bridge response buffers the whole body and has no writeHead, so GET /stream answered 500 "res.writeHead is not a function" on every try and the projector looped "Reconnecting to the room" without ever receiving a line. POST /rooms/register now names the transport this runtime can serve (sse where the response can stream, poll on the bridge) with the poll interval; GET /rooms/poll answers a screen's events after its cursor (409 unknown_room tells it to re-register); GET /stream on a non-streaming response answers 501 stream_unavailable instead of a 500.
 * 2026-10-12 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | A spoken line is saved before the reply. remember() was fire-and-forget, so /chat, /rooms/say, /rooms/ask and /speak answered before the INSERT and the page's Saved responses re-read showed 'Nothing saved yet' (sweep 8). The save is now awaited (a failed save still only logs). Guard: tests/pumpkin-swarm-push.test.cjs ("each speaking door has saved the line before it answers").
 * 2026-10-12 21:00:00 | maintainer@emeraldcoastsystemsgroup.com     | A reply the model could not give answers 503 model_unavailable with the cause in words. Sweep 9: while the model was unavailable, POST /rooms/ask answered 500 {"error":"internal_error"} although the kernel had refused the turn with its reason (every configured model failed). runPumpkin raises PumpkinModelError for a failed bot turn; withSub maps it to 503 with "message" (what the page shows) and "detail" (the kernel's reason, bounded); the swarm door keeps its 502 bot_failed contract with the reason as its detail. Guard: tests/pumpkin-model-unavailable.test.cjs.
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getTrustedServiceUserSub, getCaller, isOperatorIdentity, hasValidServiceSecret } from '@/shared/middleware/authz';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import {
  PumpkinPresetService,
  PumpkinResponseService,
  buildPumpkinLinks,
  parsePumpkinReply,
  pumpkinQrTargetUrl,
  pumpkinRooms,
  POLL_INTERVAL_MS,
  readQrTarget,
  requestOrigin,
  resolvePublicOrigin,
  resolveSpeakTargets,
  roomSlug,
  type PumpkinLinkRequest,
  type PumpkinReply,
  type PumpkinMode,
  type PumpkinExpression,
  type PumpkinEvent,
  type PumpkinRoomInfo,
} from './pumpkin-engine';

const logger = createChildLogger({ module: 'pumpkin-routes' });

/** The pumpkin-bot agent (registered inline on the api, container 'oshal-api'). Cost lands here. */
const PUMPKIN_AGENT_ID = 'a0000000-0000-0000-0000-000000000054';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * The first line of every prompt built from a GUEST utterance. Guest text is interpolated later,
 * inside triple quotes, so a guest can never make this the first line themselves — which is what
 * lets the persona treat "marker first" as "you are the porch pumpkin: emit JSON, never call a
 * tool" and everything else as an operator instruction. A prompt-level fence is not a security
 * boundary; the reentrancy lock below is what bounds the damage when a model ignores it.
 */
export const GUEST_FRAME_MARKER = '[[PUMPKIN:GUEST]]';

/** Told to a caller whose in-character reply collided with one already running for the same owner. */
const BUSY_DETAIL = 'an in-character reply is already being generated for this owner';

/** Told to a browser that reached the swarm-only door, so the fix is obvious. */
const SPEAK_BROWSER_HINT = 'browser surfaces use POST /api/pumpkin/rooms/say with the room pairing token';

/** Longest verbatim line the prop will speak in one breath (matches the browser mimic path). */
const MAX_SPEAK_CHARS = 300;

/** Expressions the swarm door accepts; anything else falls back to neutral rather than 400-ing. */
const SPEAK_EXPRESSIONS: readonly PumpkinExpression[] = [
  'neutral', 'happy', 'mischief', 'spooky', 'angry', 'laugh', 'surprised',
];

/**
 * Raised when a second in-character reply is requested for an owner whose reply is still running.
 * pumpkin-bot both HOLDS the speak tool and answers mode:'ask', so an ignored fence could otherwise
 * recurse; this caps a runaway at one nested call instead of a budget.
 */
export class PumpkinBusyError extends Error {
  /** HTTP status this maps to, so any handler can translate it without a lookup table. */
  readonly status = 409;

  constructor() {
    super(BUSY_DETAIL);
    this.name = 'PumpkinBusyError';
  }
}

/** Owners with an in-character reply in flight right now. Process-wide, like the room registry. */
const guestReplyLocks = new Set<string>();

/**
 * @description Run `fn` under a per-owner reentrancy lock, refusing rather than queueing when one is
 * already in flight. The cycle it breaks: /speak?mode=ask runs pumpkin-bot, and pumpkin-bot is the
 * bot that holds the pumpkin-speak tool — so a model that ignores the guest fence and calls the tool
 * from inside its own reply would otherwise spawn replies without bound.
 * @param sub - The owner's OIDC sub (the lock key; never logged as a secret).
 * @param fn - The work to run exclusively for this owner.
 * @returns Whatever `fn` resolves to.
 * @throws PumpkinBusyError when this owner already has a reply in flight.
 */
async function withGuestReplyLock<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  if (guestReplyLocks.has(sub)) throw new PumpkinBusyError();
  guestReplyLocks.add(sub);
  try {
    return await fn();
  } finally {
    guestReplyLocks.delete(sub);
  }
}

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

/** The surface scripts the control and remote pages load from /api/pumpkin/assets/. */
export const SURFACE_SCRIPTS = ['pumpkin-face.js', 'pumpkin-audio.js', 'pumpkin-projector.js', 'pumpkin-projector.css'] as const;

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

/**
 * @description A pumpkin reply the model could not give: the bot turn was refused or failed (no model answered, a budget,
 * a stopped provider). It carries the person-facing words and the runtime's own reason, bounded.
 */
export class PumpkinModelError extends Error {
  /** HTTP status this maps to. */
  readonly status = 503;
  /** The runtime's reason, bounded and on one line. */
  readonly detail: string;

  constructor(cause: unknown) {
    super("The pumpkin's voice model did not answer, so nothing was spoken. Try again in a minute.");
    this.name = 'PumpkinModelError';
    this.detail = String(cause instanceof Error ? cause.message : cause ?? 'no reason given').replace(/\s+/g, ' ').trim().slice(0, 300);
  }
}

/**
 * @description The answer for a failed pumpkin reply: 503 with the words the page shows and the runtime's reason.
 * @param res - The response to write.
 * @param err - The PumpkinModelError.
 */
function respondModelUnavailable(res: Response, err: PumpkinModelError): void {
  logger.warn({ detail: err.detail }, 'pumpkin reply refused: the model did not answer');
  if (!res.headersSent) res.status(503).json({ error: 'model_unavailable', message: `${err.message} (${err.detail})`, detail: err.detail });
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
      if (err instanceof PumpkinBusyError) {
        logger.warn({ err, path: req.path }, 'pumpkin reply refused: one is already in flight for this owner');
        if (!res.headersSent) res.status(409).json({ error: 'pumpkin_busy', detail: BUSY_DETAIL });
        return;
      }
      if (err instanceof PumpkinModelError) { respondModelUnavailable(res, err); return; }
      logger.error({ err, path: req.path }, 'pumpkin route failed');
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}

/** Comma-separated env allowlist → lowercased Set. */
function parseList(v?: string): Set<string> {
  return new Set((v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** True when the operator has configured either allowlist at all. */
function allowlistConfigured(): boolean {
  return parseList(process.env.PUMPKIN_ALLOWED_SUBS).size > 0
    || parseList(process.env.PUMPKIN_ALLOWED_EMAILS).size > 0;
}

/**
 * @description Is this OWNER one whose prop may be driven?
 *
 * Read the subject carefully: `sub` is the OWNER the request acts for. On the browser doors the
 * actor and the owner are the same identity (both come from the session), so this reads naturally
 * as "who may drive the prop". On the SWARM door they are NOT the same — `sub` there came from the
 * trusted `X-OSHAL-User-Sub` header, so this function answers "whose prop", and the actor is gated
 * separately by {@link gateSwarmSpeak}. Conflating the two is how "the allowlist protects the swarm
 * door" became false: with an owner on the list, any service-secret holder acting for that owner
 * passed. Unconfigured → every authenticated owner passes, exactly as before.
 * @param req - The request (for the caller's email, when there is a session).
 * @param sub - The OWNER the request acts for.
 * @returns True when this owner's prop may be driven.
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

/** Told to a swarm caller refused because the operator has not opted the swarm door in. */
const SWARM_OPT_IN_DETAIL =
  'a pumpkin allowlist is configured, so driving the prop from the swarm is opt-in: set PUMPKIN_ALLOW_SWARM_SPEAK=true';

/** Explicit operator opt-in for the swarm door. Anything but a truthy word is off. */
function swarmSpeakOptedIn(): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env.PUMPKIN_ALLOW_SWARM_SPEAK || '').trim().toLowerCase());
}

/**
 * @description Gate the SWARM door on the ACTOR as well as the owner.
 *
 * The only actor identity this door can ever have is "a holder of the service secret" — /speak's
 * first statement is hasValidServiceSecret and a session can never reach past it. So there is no
 * per-actor allowlist to consult; what there IS is the operator's intent. Once they configure a
 * pumpkin allowlist at all they have said they want to narrow who drives the prop, and outward-
 * acting automation is opt-in by directive — so with an allowlist configured the swarm door
 * additionally requires PUMPKIN_ALLOW_SWARM_SPEAK. With NO allowlist configured nothing changes and
 * the door is exactly as open as it was.
 * @param req - The request.
 * @param res - The response, written only on refusal.
 * @param sub - The OWNER the line will be spoken for.
 * @returns True when the caller may continue to the speak step.
 */
function gateSwarmSpeak(req: Request, res: Response, sub: string): boolean {
  if (!gateInput(req, res, sub)) return false;
  if (!allowlistConfigured() || swarmSpeakOptedIn()) return true;
  logger.warn({ path: req.path }, 'pumpkin swarm speak refused: an allowlist is configured and the swarm door is not opted in');
  res.status(403).json({ error: 'swarm_speak_not_enabled', detail: SWARM_OPT_IN_DETAIL });
  return false;
}

/**
 * @description Read the untrusted label/mode/preset a link request carries. Normalization lives in
 * the links module so /links and /qr can never disagree about what they were asked for.
 * @param req - The request whose query carries the three fields.
 * @returns The raw values, to be normalized by the links builder.
 */
function linkRequest(req: Request): PumpkinLinkRequest {
  const q = req.query as { label?: unknown; mode?: unknown; preset?: unknown };
  return { label: q.label, mode: q.mode, preset: q.preset };
}

/**
 * @description The origin absolute device links are built from.
 *
 * `req.protocol` is deliberately NOT used: behind the deployment's reverse proxy it reads `http`
 * unless trust-proxy is on, and a link that downgrades to http is worse than one that is merely
 * wrong. Configured origins win; the fallback is requestOrigin(): the Host header WITH its port,
 * http on loopback and https elsewhere.
 * @param req - The request, for its Host header.
 * @returns The resolved public origin, no trailing slash.
 */
function publicOrigin(req: Request): string {
  const host = typeof req.get === 'function' ? req.get('host') : undefined;
  return resolvePublicOrigin(process.env, requestOrigin(host, req.hostname));
}

/**
 * @description Render a QR PNG for an already-resolved URL.
 *
 * The encoder is required LAZILY: it is a core-image dependency (the same `qrcode` the TV pairing
 * route uses), not a package one, so a top-level import would make this whole route module
 * unloadable anywhere it is absent — including the package's own dependency-free test run. A
 * missing encoder therefore degrades to one dead QR box, not a dead app.
 * @param url - The absolute URL to encode.
 * @returns The PNG bytes.
 */
async function renderQrPng(url: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const encoder = require('qrcode') as { toBuffer: (text: string, opts: Record<string, unknown>) => Promise<Buffer> };
  return encoder.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 480,
    color: { dark: '#1a0f00', light: '#ffffff' },
  });
}

/**
 * Run one GUEST line through pumpkin-bot and parse its in-character reply. The prompt leads with
 * {@link GUEST_FRAME_MARKER} so the persona knows this is a porch guest and not an operator, and the
 * whole call runs under the per-owner lock — so /chat, /rooms/ask and /speak?mode=ask share ONE
 * fence and ONE lock rather than three copies that can drift apart.
 */
async function runPumpkin(ctx: AppContext, sub: string, text: string): Promise<PumpkinReply> {
  return withGuestReplyLock(sub, async () => {
    const prompt = `${GUEST_FRAME_MARKER}\nA guest at your porch just said to you:\n"""\n${text.slice(0, 600)}\n"""\n\nReply in character as the jack-o'-lantern, using ONLY the JSON contract { "say", "expression", "intensity" }.`;
    let result: any;
    try {
      result = await executeBotOrInline(ctx, botClient, PUMPKIN_AGENT_ID, {
        text: prompt,
        taskId: `pumpkin-${sub}-${randomUUID()}`,
        workspaceFolderId: `pumpkin-${sub}`,
        agentId: PUMPKIN_AGENT_ID,
        agenticMode: true,
        direct: true,
        userSub: sub,
      });
    } catch (err) {
      throw new PumpkinModelError(err);
    }
    return parsePumpkinReply(String(result?.response || ''));
  });
}

/** Read a normalized mode from a request body value. */
function readMode(v: unknown): PumpkinMode {
  return v === 'autonomous' ? 'autonomous' : 'mimic';
}

/** The two things a swarm caller can ask the prop to do; anything else is a 400, never a guess. */
type SpeakMode = 'say' | 'ask';

/** Normalize the swarm door's mode. Absent means 'say' (speak it verbatim); junk means null → 400. */
function readSpeakMode(v: unknown): SpeakMode | null {
  if (v === undefined || v === null || v === '') return 'say';
  return v === 'say' || v === 'ask' ? v : null;
}

/**
 * @description Allowlist a requested face expression for the swarm door.
 * @param v - Untrusted body value.
 * @returns The requested expression, or 'neutral' when it is absent or off the allowlist.
 */
function readExpression(v: unknown): PumpkinExpression {
  return typeof v === 'string' && SPEAK_EXPRESSIONS.includes(v as PumpkinExpression)
    ? (v as PumpkinExpression)
    : 'neutral';
}

/**
 * @description Clamp a requested delivery intensity for the swarm door.
 * @param v - Untrusted body value.
 * @returns The value clamped to [0,1], or 0.6 when it is absent or not a finite number.
 */
function readIntensity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0.6;
  return Math.min(1, Math.max(0, n));
}

/** What a swarm-driven fan-out actually reached, per room and in total. */
interface SpeakFanout {
  /** Listeners the event was DELIVERED to across every target (dead transports already pruned). */
  listeners: number;
  /** Per-room detail, so a total of zero can name the dark screen instead of shrugging. */
  rooms: Array<{ room: string; label: string; live: boolean; listeners: number }>;
}

/**
 * @description Fan one event out to every resolved target over the TOKEN-FREE trusted path, summing
 * only the listeners it truly reached. A -1 (room evicted between resolution and push) counts as
 * zero rather than corrupting the sum, so the caller still gets an honest total.
 * @param sub - The owner's sub, resolved from the trusted service header.
 * @param targets - Rooms chosen by {@link resolveSpeakTargets}.
 * @param evt - The event to deliver.
 * @returns The total listener count plus the per-room breakdown.
 */
function speakToTargets(sub: string, targets: PumpkinRoomInfo[], evt: PumpkinEvent): SpeakFanout {
  let listeners = 0;
  const rooms = targets.map((t) => {
    const n = pumpkinRooms.pushTrusted(sub, t.room, evt);
    const reached = n > 0 ? n : 0;
    listeners += reached;
    return { room: t.room, label: t.label, live: t.live, listeners: reached };
  });
  return { listeners, rooms };
}

/**
 * @description Translate a failure from the swarm door's reply step into its contract response.
 * @param res - The response to write.
 * @param err - The thrown value.
 * @returns Nothing; the response is written.
 */
function respondSpeakFailure(res: Response, err: unknown): void {
  if (err instanceof PumpkinBusyError) {
    logger.warn({ err }, 'pumpkin swarm speak refused: a reply is already in flight for this owner');
    res.status(409).json({ error: 'pumpkin_busy', detail: BUSY_DETAIL });
    return;
  }
  logger.error({ err }, 'pumpkin swarm speak failed inside the bot path');
  // The swarm door's contract stays 502 bot_failed; its detail is the runtime's own reason, as before.
  const reason = err instanceof PumpkinModelError ? err.detail : String(err instanceof Error ? err.message : err);
  res.status(502).json({ error: 'bot_failed', detail: reason.slice(0, 300) });
}

/**
 * @description Push a look change ahead of a swarm-driven line, so one call can set the face AND
 * speak. The name is verified against the caller's own presets — an unknown one is a 404, never a
 * silently-dropped field that leaves a bot believing it changed the look.
 * @param presetSvc - The per-user preset store.
 * @param sub - The owner's sub.
 * @param targets - The rooms the line is about to go to.
 * @param name - Requested preset name, already trimmed ('' means no look change).
 * @param res - The response, written only on the 404 path.
 * @returns True when the caller may continue to the speak step.
 */
async function pushPresetFirst(
  presetSvc: PumpkinPresetService,
  sub: string,
  targets: PumpkinRoomInfo[],
  name: string,
  res: Response,
): Promise<boolean> {
  if (!name) return true;
  const preset = await presetSvc.getPreset(sub, name);
  if (!preset) {
    res.status(404).json({ error: 'unknown_preset', preset: name });
    return false;
  }
  speakToTargets(sub, targets, { type: 'preset', name: preset.name });
  return true;
}

/**
 * @description Attach one projector SSE transport to a room. Extracted from the route so the
 * handler can choose its STATUS CODE before a single header is written — an unknown room used to
 * get 200-then-end, which EventSource is spec-bound to read as a dropped connection and retry
 * silently forever. The transport reports unwritability by returning false (res.write on a
 * destroyed socket does NOT throw synchronously in Node, so the old try/catch was dead code and a
 * dead screen stayed in the listener count), which is what lets the registry prune it.
 * @param req - The projector's request (its 'close' is one of two drop triggers).
 * @param res - The SSE response.
 * @param sub - The owner's sub.
 * @param room - The already-verified room slug or label.
 * @returns Nothing; the response stays open until dropped.
 */
function attachRoomStream(req: Request, res: Response, sub: string, room: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n: connected\n\n');
  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;
  const drop = (reason: string): void => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    if (unsub) unsub();
    logger.info({ room, reason }, 'pumpkin SSE stream closed');
    try { res.end(); } catch (err) { logger.error({ err, room }, 'pumpkin SSE end failed'); }
  };
  const send = (evt: PumpkinEvent): boolean => {
    if (closed) return false;
    if (res.writableEnded || res.destroyed) { drop('unwritable'); return false; }
    res.write(`data: ${JSON.stringify(evt)}\n\n`, (err?: Error | null) => {
      if (err) { logger.error({ err, room }, 'pumpkin SSE write failed'); drop('write_error'); }
    });
    return true;
  };
  unsub = pumpkinRooms.subscribe(sub, room, send);
  if (!unsub) { drop('room_vanished'); return; }
  keepAlive = setInterval(() => send({ type: 'ping' }), 25000);
  req.on('close', () => drop('client_close'));
  res.on('error', (err: unknown) => { logger.error({ err, room }, 'pumpkin SSE response error'); drop('response_error'); });
}

/**
 * @description Can this response hold an SSE stream open? Node's ServerResponse can; the native
 * kernel's bridge response buffers the whole body until end and has neither writeHead nor
 * flushHeaders, so a projector there must poll instead.
 * @param res - The response the runtime handed this request.
 * @returns True when the response streams.
 */
function canStream(res: Response): boolean {
  const r = res as unknown as { writeHead?: unknown; flushHeaders?: unknown };
  return typeof r.writeHead === 'function' && typeof r.flushHeaders === 'function';
}

/**
 * @description GET /rooms/poll — one poll from a projector on the poll transport. Answers the
 * events after its cursor; 409 unknown_room when the room is gone so the screen re-registers
 * (the same contract /stream keeps).
 * @param req - query room, client (the screen's id) and after (the previous cursor, absent on the first poll).
 * @param res - The response.
 * @param sub - The owner's sub.
 * @returns Nothing.
 */
function pollRoom(req: Request, res: Response, sub: string): void {
  const room = String(req.query.room || '').trim();
  const raw = req.query.after;
  const after = raw === undefined || raw === '' ? null : Number(raw);
  const got = pumpkinRooms.poll(sub, room, String(req.query.client || ''), after);
  if (!got) { res.status(409).json({ error: 'unknown_room', room }); return; }
  res.json({ ok: true, events: got.events, cursor: got.cursor });
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
  const responseSvc = new PumpkinResponseService(ctx.pool);
  void responseSvc.ensureSchema();

  /**
   * Auto-save a spoken line into the playlist. Called after the line reached the screens and awaited before the
   * response, so the page's Saved responses re-read sees it (sweep 8: fire-and-forget left 'Nothing saved yet' after a
   * save). A failed save is logged and never fails the speak.
   */
  const remember = async (sub: string, candidate: unknown): Promise<void> => {
    try { await responseSvc.record(sub, candidate); } catch (err) {
      logger.error({ err, sub }, 'pumpkin auto-save response failed');
    }
  };

  // ── Surfaces (bundled in this package's tools/) ───────────────────────────
  router.get('/app', serveFile(surfaceHtml(ctx.appPackageDir, 'pumpkin-app.html')));
  router.get('/remote', serveFile(surfaceHtml(ctx.appPackageDir, 'pumpkin-remote.html')));
  // The full-screen projector page (ported from the framework's /pumpkin/ page, which the native kernel never served).
  router.get('/projector', serveFile(surfaceHtml(ctx.appPackageDir, 'pumpkin-projector.html')));
  // The face renderer and voice pipeline the two pages load, shipped beside them in tools/.
  for (const script of SURFACE_SCRIPTS) router.get(`/assets/${script}`, serveFile(surfaceHtml(ctx.appPackageDir, script)));

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
  // The projector reads these back when its URL omits room/mode/preset — the short-form
  // `{origin}/pumpkin/` the night-of runbook has the operator type on the projector device.
  router.get('/settings', withSub(async (_req, res, sub) => {
    res.json(await presetSvc.getSettings(sub));
  }));
  router.put('/settings', withSub(async (req, res, sub) => {
    // roomLabel is passed through UNDEFINED when absent, never coerced to '': saveSettings treats
    // undefined as "leave the stored room alone", and an older surface must not blank a live room.
    const label = typeof req.body?.roomLabel === 'string' ? req.body.roomLabel : undefined;
    await presetSvc.saveSettings(sub, String(req.body?.activePreset || 'inflatable'), readMode(req.body?.mode), label);
    res.json({ ok: true });
  }));

  // ── Device links + QR (the SERVER owns every cross-device URL) ─────────────
  // The cockpit is usually open on http://localhost:35457, so a link the BROWSER builds is dead on
  // arrival on a phone. Only the server knows the public origin and owns roomSlug(), which is why
  // these two routes exist at all. The pairing token is never in a link, a QR, or this response.
  router.get('/links', withSub((req, res, _sub) => {
    res.json(buildPumpkinLinks(publicOrigin(req), linkRequest(req)));
  }));
  // A CLOSED target whitelist. Encoding a caller-supplied URL would make a signed-in cockpit into a
  // QR-phishing generator wearing this deployment's own domain, so `target` is the ONLY input that
  // chooses a destination and anything outside the two pages this app serves is a 400.
  router.get('/qr', withSub(async (req, res, _sub) => {
    const target = readQrTarget(req.query.target);
    if (!target) { res.status(400).json({ error: 'unknown_qr_target', hint: 'target must be "projector" or "remote"' }); return; }
    const url = pumpkinQrTargetUrl(publicOrigin(req), target, linkRequest(req));
    try {
      const png = await renderQrPng(url);
      res.type('png').set('Cache-Control', 'no-store').send(png);
    } catch (err) {
      // The surface hides a failed <img> and says "QR code unavailable — copy the link instead",
      // so a missing encoder costs one box, never the runbook.
      logger.error({ err, target }, 'pumpkin qr_unavailable — the PNG encoder could not be used');
      res.status(503).json({ error: 'qr_unavailable' });
    }
  }));

  // ── Saved responses (the one-tap replay playlist) ─────────────────────────
  router.get('/responses', withSub(async (_req, res, sub) => {
    res.json({ responses: await responseSvc.list(sub) });
  }));
  router.post('/responses', withSub(async (req, res, sub) => {
    const saved = await responseSvc.record(sub, { ...(req.body ?? {}), source: 'manual' });
    if (!saved) { res.status(400).json({ error: 'text required' }); return; }
    res.json({ response: saved });
  }));
  router.patch('/responses/:id', withSub(async (req, res, sub) => {
    const updated = await responseSvc.setPinned(sub, String(req.params.id), req.body?.pinned === true);
    if (!updated) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ response: updated });
  }));
  router.delete('/responses/:id', withSub(async (req, res, sub) => {
    res.json({ deleted: await responseSvc.remove(sub, String(req.params.id)) });
  }));

  // ── Autonomous chat (ALL-IN-ONE topology) ─────────────────────────────────
  router.post('/chat', withSub(async (req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const text = String(req.body?.text || req.body?.message || '').trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const reply = await runPumpkin(ctx, sub, text);
    await remember(sub, { ...reply, source: 'autonomous' });
    res.json({ reply });
  }));

  // ── Rooms (PAIRED topology) ───────────────────────────────────────────────
  // The transport is the one THIS runtime can serve: a held-open SSE response, or polling where the
  // response is buffered until end (the native kernel's bridge).
  router.post('/rooms/register', withSub((req, res, sub) => {
    const transport = canStream(res) ? 'sse' : 'poll';
    res.json({ ...pumpkinRooms.register(sub, String(req.body?.label || 'Main')), transport, pollMs: POLL_INTERVAL_MS });
  }));
  router.get('/rooms/poll', withSub(pollRoom));
  // Stays HTTP 200 on failure so the browser api() helper resolves; a caller that reads ok:false
  // MUST re-register (the projector used to discard this value entirely and go quietly deaf).
  router.post('/rooms/heartbeat', withSub((req, res, sub) => {
    const room = String(req.body?.room || '');
    if (!pumpkinRooms.heartbeat(sub, room)) { res.json({ ok: false, reason: 'unknown_room' }); return; }
    res.json({ ok: true, room: roomSlug(room) });
  }));
  router.get('/rooms', withSub((_req, res, sub) => {
    res.json({ rooms: pumpkinRooms.list(sub) });
  }));

  // Projector SSE subscription — receives speak/preset/mode/ping/evicted events for its room.
  // The 409 lands BEFORE writeHead: a non-2xx fails EventSource TERMINALLY (readyState CLOSED),
  // handing recovery to the client's re-register state machine instead of a silent retry loop.
  router.get('/stream', withSub((req, res, sub) => {
    const room = String(req.query.room || '').trim();
    if (!pumpkinRooms.has(sub, room)) { res.status(409).json({ error: 'unknown_room', room }); return; }
    if (!canStream(res)) { res.status(501).json({ error: 'stream_unavailable', transport: 'poll' }); return; }
    attachRoomStream(req, res, sub, room);
  }));

  // Remote → room pushes. speak(mimic)/ask(autonomous) are input-gated; preset/mode are display-only.
  router.post('/rooms/say', withSub(async (req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const text = String(req.body?.text || '').trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''),
      { type: 'speak', say: text.slice(0, 300), expression: 'neutral', intensity: 0.6, mimic: true });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    await remember(sub, { say: text, expression: 'neutral', intensity: 0.6, source: 'mimic' });
    res.json({ ok: true, listeners: n });
  }));
  router.post('/rooms/ask', withSub(async (req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const text = String(req.body?.text || '').trim();
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const reply = await runPumpkin(ctx, sub, text);
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''), { type: 'speak', ...reply });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    await remember(sub, { ...reply, source: 'autonomous' });
    res.json({ ok: true, reply, listeners: n });
  }));
  // One-tap replay of a SAVED line — the playlist's fast path (no LLM, straight to the projector).
  router.post('/rooms/replay', withSub(async (req, res, sub) => {
    if (!gateInput(req, res, sub)) return;
    const saved = await responseSvc.get(sub, String(req.body?.id || ''));
    if (!saved) { res.status(404).json({ error: 'not_found' }); return; }
    const n = pumpkinRooms.push(sub, String(req.body?.room || ''), String(req.body?.token || ''),
      { type: 'speak', say: saved.say, expression: saved.expression, intensity: saved.intensity });
    if (n < 0) { res.status(403).json({ error: 'invalid_room_or_token' }); return; }
    void responseSvc.markPlayed(sub, saved.id);
    res.json({ ok: true, reply: { say: saved.say, expression: saved.expression, intensity: saved.intensity }, listeners: n });
  }));

  // ── The SWARM DOOR — service secret ONLY, never a browser ─────────────────
  // A bot/CLI/Jarvis delegation can drive the prop here WITHOUT the pairing token, because the
  // token never leaves the registering browser. The gate is hasValidServiceSecret and nothing else:
  // resolveSub() answers for any OIDC session AND for MOCK_OIDC, so gating on it would hand every
  // signed-in tab a token-free hijack of a screen it never registered.
  router.post('/speak', withSub(async (req, res, sub) => {
    if (!hasValidServiceSecret(req)) {
      res.status(403).json({ error: 'service_secret_required', hint: SPEAK_BROWSER_HINT });
      return;
    }
    // Two questions, not one: WHOSE prop (gateInput, on the trusted owner sub) and MAY THE SWARM
    // drive it at all (the operator's opt-in). gateInput alone answers only the first.
    if (!gateSwarmSpeak(req, res, sub)) return;
    const text = String(req.body?.text || '').trim();
    if (!text) { res.status(400).json({ error: 'text_required' }); return; }
    const mode = readSpeakMode(req.body?.mode);
    if (!mode) { res.status(400).json({ error: 'bad_mode', mode: req.body?.mode }); return; }
    const resolved = resolveSpeakTargets(sub, req.body?.room === undefined ? undefined : String(req.body.room));
    if (!resolved.ok) { res.status(resolved.status).json(resolved.body); return; }
    const targets = resolved.targets;
    if (!(await pushPresetFirst(presetSvc, sub, targets, String(req.body?.preset || '').trim(), res))) return;
    let reply: PumpkinReply;
    try {
      reply = mode === 'ask'
        ? await runPumpkin(ctx, sub, text)
        : { say: text.slice(0, MAX_SPEAK_CHARS), expression: readExpression(req.body?.expression), intensity: readIntensity(req.body?.intensity) };
    } catch (err) {
      respondSpeakFailure(res, err);
      return;
    }
    const fan = speakToTargets(sub, targets, { type: 'speak', ...reply });
    // Zero listeners is a FAILURE, not a quiet success: the room can be inside its 90s TTL with the
    // projector window already closed, and a swarm caller must never be told the pumpkin spoke.
    if (fan.listeners === 0) { res.status(409).json({ error: 'projector_not_listening', rooms: fan.rooms }); return; }
    await remember(sub, { ...reply, source: mode === 'ask' ? 'autonomous' : 'mimic' });
    res.json({
      ok: true,
      mode,
      spoken: reply,
      listeners: fan.listeners,
      rooms: fan.rooms.map((r) => ({ room: r.room, label: r.label, listeners: r.listeners })),
    });
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
