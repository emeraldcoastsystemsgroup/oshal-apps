"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 06:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — Sat-Ops (ADR-102) W1
 *                     |                             | round 3: the controller-side sat fleet surface. POST
 *                     |                             | /nodes/heartbeat (service-secret REQUIRED — a node
 *                     |                             | identity, never an operator browser), GET /fleet, and
 *                     |                             | two node commands (point / mode) dialed over the secret
 *                     |                             | rail. Mounted behind serviceSecretOr(requiresAuth) in
 *                     |                             | server.ts, drone-routes style. W3 adds the draft →
 *                     |                             | human-approve → execute rail + command audit table when
 *                     |                             | the cockpit surface lands — until then every engine is a
 *                     |                             | simulator and commands cannot leave sim by construction.
 * 2026-07-18 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | W2: POST /passes — stateless SGP4 pass
 *                     |                             | prediction (satellite.js ^5). This route is the slice's
 *                     |                             | ONE impure time boundary: startUtc omitted → Date.now();
 *                     |                             | ISO strings must carry an explicit zone. TleParseError →
 *                     |                             | 400, PropagationError (decayed orbit) → 422.
 * 2026-07-18 11:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | W3 fleet plane: GET /app (surface), TLE
 *                     |                             | catalog CRUD (PUT/GET/DELETE /catalog), POST /track
 *                     |                             | (orbit + ground track from catalog id or inline TLE),
 *                     |                             | POST /conjunctions (pairwise screening over the
 *                     |                             | catalog). Same impure-boundary rule: routes resolve
 *                     |                             | time, services stay deterministic.
 * 2026-07-18 14:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | W3 concierge: POST /chat — the sat-operator
 *                     |                             | Form B inline concierge (drone-operator's sibling).
 *                     |                             | DRAFTS ADCS commands over live fleet + catalog
 *                     |                             | context; the route validates every draft (whitelist,
 *                     |                             | online sat, finite axis, ≤60°) and the surface only
 *                     |                             | pre-fills the console — sending stays behind the
 *                     |                             | human approve gate. Stateless v1 (client history).
 * 2026-07-19 15:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the
 *                     |                             | sat-ops app package (ADR-085 Wave 3, "skill with a
 *                     |                             | surface"). The surface serves from
 *                     |                             | ctx.appPackageDir/tools (load-time env fallback, D10);
 *                     |                             | the sat ENGINE (@/features/sat-ops), the sat-node
 *                     |                             | server, and the sat-operator inline node stay
 *                     |                             | framework-resident (ADR-102: sats ARE swarm nodes).
 *                     |                             | Same /api/sat paths, so live evidence probes stay valid.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSatRoutes = createSatRoutes;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const sat_ops_1 = require("@/features/sat-ops");
const logger = (0, logger_1.createChildLogger)({ module: 'sat-routes' });
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
function surfaceHtml(appPackageDir, fileName) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
        path.resolve(__dirname, '../tools', fileName),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}
/** Serve one bundled surface file (resolved once per factory call). */
function serveFile(filePath) {
    return (_req, res) => {
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error({ err, filePath }, 'Failed to serve surface file');
                res.status(404).send('Page not found');
            }
        });
    };
}
/**
 * @description Resolve a request's start time: absent → now; number → epoch ms; string →
 * ISO WITH explicit zone (ambiguous local times rejected). The routes' one impure boundary.
 * @param raw - startUtc from the body.
 * @returns Epoch ms, or an error string.
 */
function resolveStartUtc(raw) {
    if (raw === undefined || raw === null)
        return { ms: Date.now() };
    if (typeof raw === 'number')
        return { ms: raw };
    const s = String(raw);
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
        return { error: 'startUtc string must carry an explicit zone (Z or ±hh:mm) — ambiguous local times are rejected' };
    }
    const ms = Date.parse(s);
    if (!Number.isFinite(ms))
        return { error: `unparseable startUtc "${s}"` };
    return { ms };
}
const SAT_OPERATOR_AGENT_ID = 'b0102000-0000-0000-0000-000000000001';
const DRAFT_COMMANDS = new Set(['point', 'detumble', 'desat', 'safe']);
/**
 * @description Assemble the sat-operator turn prompt: live fleet + catalog context, the
 * short client-side history, and the strict say+draft output contract (the persona rides
 * via agentId at orchestration time).
 * @param o - Message, history, and the context lines.
 * @returns The prompt string.
 */
function buildSatOperatorPrompt(o) {
    const convo = o.history.slice(-8).map((h) => `${h.role === 'assistant' ? 'You' : 'Operator'}: ${h.content}`).join('\n');
    return [
        'You are the Sat Operator — the operations-planning brain of a satellite fleet plane. You DRAFT ADCS commands; you never send one. Every draft is validated by the route, pre-filled into the console, and only sent after the human presses Approve. Every engine is a simulator.',
        '',
        `FLEET: ${o.fleetLine || '(no sats heartbeating)'}`,
        `ORBIT CATALOG: ${o.catalogLine || '(empty)'}`,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}\n` : '',
        `Operator: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply", "draft": { "satId": "...", "command": "point", "axis": { "x": 1, "y": 1, "z": 0 }, "angleDeg": 30 } }',
        'Mode drafts: { "satId": "...", "command": "detumble" } (or "desat" / "safe") — no axis/angle. No command to suggest → "draft": null.',
        'Only draft for ONLINE sats. Never invent satIds. point: 0 < angleDeg ≤ 60, finite axis numbers.',
    ].join('\n');
}
/**
 * @description Parse + validate the concierge envelope. Anything malformed degrades to a
 * say-only reply — a bad draft must never reach the console.
 * @param raw - Raw model output.
 * @param onlineSatIds - The satIds a draft may target.
 * @returns say + a validated draft or null.
 */
function parseSatOperatorEnvelope(raw, onlineSatIds) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m)
        return { say: raw.slice(0, 2000), draft: null };
    let env;
    try {
        env = JSON.parse(m[0]);
    }
    catch {
        return { say: raw.slice(0, 2000), draft: null };
    }
    const say = String(env.say || '').slice(0, 4000) || 'No reply.';
    const d = env.draft;
    if (!d || typeof d !== 'object')
        return { say, draft: null };
    const satId = String(d.satId || '');
    const command = String(d.command || '');
    if (!DRAFT_COMMANDS.has(command) || !onlineSatIds.has(satId))
        return { say, draft: null };
    if (command === 'point') {
        const ax = (d.axis || {});
        const axis = { x: Number(ax.x), y: Number(ax.y), z: Number(ax.z) };
        const angleDeg = Number(d.angleDeg);
        const finite = [axis.x, axis.y, axis.z].every(Number.isFinite) && (axis.x !== 0 || axis.y !== 0 || axis.z !== 0);
        if (!finite || !(angleDeg > 0 && angleDeg <= 60))
            return { say, draft: null };
        return { say, draft: { satId, command: 'point', axis, angleDeg } };
    }
    return { say, draft: { satId, command: command } };
}
/**
 * @description Build the /api/sat router over one fleet instance (injectable for tests).
 *
 * Accepts EITHER the historical opts wrapper ({fleet?, catalog?, ctx?} — how core server.ts
 * and the specs call it) OR a bare AppContext (how the manifest-route-mounter invokes a
 * packaged factory with requiresContext). Anything without an opts key is treated as the
 * context, so the packaged mount keeps the orchestrator (POST /chat) and appPackageDir
 * (surface serving) wired.
 * @param arg - Opts wrapper, or the AppContext itself.
 * @returns The router.
 */
function createSatRoutes(arg = {}) {
    const isOpts = arg !== null && typeof arg === 'object' && ('fleet' in arg || 'catalog' in arg || 'ctx' in arg);
    const opts = isOpts ? arg : { ctx: arg };
    const fleet = opts.fleet ?? new sat_ops_1.SatFleet();
    const catalog = opts.catalog ?? new sat_ops_1.TleCatalog();
    const appPackageDir = opts.ctx?.appPackageDir;
    const router = (0, express_1.Router)();
    // ── W3 surface ─────────────────────────────────────────────────────────────
    router.get('/app', serveFile(surfaceHtml(appPackageDir, 'sat-ops.html')));
    /** POST /nodes/heartbeat — node identity only: the swarm service secret is REQUIRED. */
    router.post('/nodes/heartbeat', (req, res) => {
        if (!(0, authz_1.hasValidServiceSecret)(req)) {
            res.status(401).json({ error: 'sat-node heartbeat requires the swarm service secret' });
            return;
        }
        const b = (req.body || {});
        if (!b.satId || !b.endpointUrl || !b.telemetry) {
            res.status(400).json({ error: 'satId, endpointUrl, and telemetry are required' });
            return;
        }
        try {
            fleet.ingestHeartbeat({
                satId: String(b.satId),
                endpointUrl: String(b.endpointUrl),
                engine: (b.engine === 'nasa42' ? 'nasa42' : 'rk4'),
                telemetry: b.telemetry,
            });
            res.json({ ok: true });
        }
        catch (err) {
            if (err instanceof sat_ops_1.SatCommandError) {
                res.status(400).json({ error: err.message });
                return;
            }
            logger.error({ err, stack: err.stack }, 'heartbeat ingest failed');
            res.status(500).json({ error: 'heartbeat ingest failed' });
        }
    });
    /** GET /fleet — every known sat with liveness + last telemetry. */
    router.get('/fleet', (_req, res) => {
        res.json({ fleet: fleet.list() });
    });
    /** Shared dial handler for the two node commands. */
    const dial = async (res, satId, command, args) => {
        const started = Date.now();
        try {
            const body = await fleet.command(satId, command, args);
            logger.info({ satId, command, durationMs: Date.now() - started }, 'sat command dialed');
            res.json(body);
        }
        catch (err) {
            if (err instanceof sat_ops_1.SatCommandError) {
                logger.warn({ satId, command, error: err.message }, 'sat command rejected');
                res.status(409).json({ error: err.message });
                return;
            }
            logger.error({ err, satId, command, stack: err.stack }, 'sat command failed');
            res.status(502).json({ error: err.message });
        }
    };
    /** POST /nodes/:satId/point {q} | {axis, angleDeg} — command an attitude target. */
    router.post('/nodes/:satId/point', (req, res) => {
        void dial(res, String(req.params.satId), 'point', (req.body || {}));
    });
    /** POST /nodes/:satId/mode {mode: idle|rateDamp} — drop pointing / rate-damp the body. */
    router.post('/nodes/:satId/mode', (req, res) => {
        void dial(res, String(req.params.satId), 'setMode', (req.body || {}));
    });
    /** POST /passes — stateless SGP4 ground-contact prediction. The one impure time boundary. */
    router.post('/passes', (req, res) => {
        const started = Date.now();
        const b = (req.body || {});
        try {
            const tleRaw = String(b.tle ?? '');
            if (tleRaw.length === 0 || tleRaw.length > sat_ops_1.TLE_MAX_CHARS) {
                res.status(400).json({ error: `tle is required and must be ≤ ${sat_ops_1.TLE_MAX_CHARS} characters` });
                return;
            }
            const st = (b.station || {});
            const station = { latDeg: Number(st.latDeg), lonDeg: Number(st.lonDeg), altKm: Number(st.altKm) };
            const start = resolveStartUtc(b.startUtc);
            if ('error' in start) {
                res.status(400).json({ error: start.error });
                return;
            }
            const prediction = (0, sat_ops_1.computePassWindows)((0, sat_ops_1.parseTle)(tleRaw), station, {
                startUtcMs: start.ms,
                horizonHours: b.horizonHours === undefined ? undefined : Number(b.horizonHours),
                elevationMaskDeg: b.elevationMaskDeg === undefined ? undefined : Number(b.elevationMaskDeg),
                stepSeconds: b.stepSeconds === undefined ? undefined : Number(b.stepSeconds),
            });
            logger.info({ satnum: prediction.satnum, passes: prediction.passes.length, durationMs: Date.now() - started }, 'POST /passes done');
            res.json({ ...prediction, engine: 'sgp4/satellite.js' });
        }
        catch (err) {
            if (err instanceof sat_ops_1.TleParseError) {
                res.status(400).json({ error: err.message });
                return;
            }
            if (err instanceof sat_ops_1.PropagationError) {
                res.status(422).json({ error: err.message });
                return;
            }
            if (err instanceof Error && /out of range|must be in/.test(err.message)) {
                res.status(400).json({ error: err.message });
                return;
            }
            logger.error({ err, stack: err.stack }, 'POST /passes failed');
            res.status(500).json({ error: 'pass prediction failed' });
        }
    });
    /** Map service errors to status codes for the W3 orbit endpoints. */
    const orbitError = (res, err, what) => {
        if (err instanceof sat_ops_1.CatalogError || err instanceof sat_ops_1.TleParseError) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (err instanceof sat_ops_1.PropagationError) {
            res.status(422).json({ error: err.message });
            return;
        }
        if (err instanceof Error && /must be in|out of range|at least|at most|duplicate|not in the catalog|required/.test(err.message)) {
            res.status(400).json({ error: err.message });
            return;
        }
        logger.error({ err, stack: err.stack }, `${what} failed`);
        res.status(500).json({ error: `${what} failed` });
    };
    // ── W3: TLE catalog (orbit identity, decoupled from attitude nodes) ────────
    /** PUT /catalog/:satId {tle, name?} — register/replace an element set. */
    router.put('/catalog/:satId', (req, res) => {
        const b = (req.body || {});
        try {
            const entry = catalog.upsert(String(req.params.satId), String(b.tle ?? ''), b.name === undefined ? null : String(b.name), Date.now());
            logger.info({ satId: entry.satId, satnum: entry.satnum }, 'catalog upsert');
            res.json({ ok: true, entry });
        }
        catch (err) {
            orbitError(res, err, 'catalog upsert');
        }
    });
    /** GET /catalog — every registered element set. */
    router.get('/catalog', (_req, res) => {
        res.json({ catalog: catalog.list() });
    });
    /** DELETE /catalog/:satId. */
    router.delete('/catalog/:satId', (req, res) => {
        const removed = catalog.remove(String(req.params.satId));
        if (!removed) {
            res.status(404).json({ error: `satId "${req.params.satId}" is not in the catalog` });
            return;
        }
        res.json({ ok: true });
    });
    /** POST /track {satId | tle, startUtc?, durationMinutes?, stepSeconds?} — orbit + ground track. */
    router.post('/track', (req, res) => {
        const started = Date.now();
        const b = (req.body || {});
        try {
            const start = resolveStartUtc(b.startUtc);
            if ('error' in start) {
                res.status(400).json({ error: start.error });
                return;
            }
            let tle = null;
            let satId = null;
            if (b.satId !== undefined) {
                satId = String(b.satId);
                tle = catalog.tleOf(satId);
                if (!tle) {
                    res.status(404).json({ error: `satId "${satId}" is not in the catalog` });
                    return;
                }
            }
            else if (typeof b.tle === 'string' && b.tle.length > 0 && b.tle.length <= sat_ops_1.TLE_MAX_CHARS) {
                tle = (0, sat_ops_1.parseTle)(b.tle);
            }
            else {
                res.status(400).json({ error: 'either satId (catalog) or tle (inline, ≤512 chars) is required' });
                return;
            }
            const track = (0, sat_ops_1.computeOrbitTrack)(tle, {
                startUtcMs: start.ms,
                durationMinutes: b.durationMinutes === undefined ? undefined : Number(b.durationMinutes),
                stepSeconds: b.stepSeconds === undefined ? undefined : Number(b.stepSeconds),
            });
            logger.info({ satId, satnum: track.satnum, points: track.points.length, durationMs: Date.now() - started }, 'POST /track done');
            res.json({ ...track, satId });
        }
        catch (err) {
            orbitError(res, err, 'orbit track');
        }
    });
    /** POST /chat — the sat-operator concierge: drafts only, the approve gate sends. */
    router.post('/chat', (req, res) => {
        void (async () => {
            const started = Date.now();
            const message = String((req.body || {}).message || '').trim();
            if (!message) {
                res.status(400).json({ error: 'message is required' });
                return;
            }
            const orchestrator = opts.ctx?.orchestrator;
            if (!orchestrator) {
                res.status(503).json({ error: 'sat-operator concierge is not wired on this deployment' });
                return;
            }
            const history = Array.isArray((req.body || {}).history) ? req.body.history.slice(-8) : [];
            const rows = fleet.list();
            const fleetLine = rows.map((r) => {
                const t = r.telemetry;
                if (!t)
                    return `${r.satId} (${r.engine}, ${r.online ? 'online' : 'OFFLINE'}, no telemetry yet)`;
                return `${r.satId} (${r.engine}, ${r.online ? 'online' : 'OFFLINE'}, mode ${t.mode}, err ${t.pointingErrorDeg == null ? '—' : t.pointingErrorDeg.toFixed(2) + '°'}, momentum ${t.adcs ? Math.round(t.adcs.momentumFrac * 100) + '%' : '?'}${t.estimator ? `, MEKF σ ${(Math.hypot(t.estimator.attitudeSigmaDeg.x, t.estimator.attitudeSigmaDeg.y, t.estimator.attitudeSigmaDeg.z)).toFixed(3)}°` : ''})`;
            }).join('; ');
            const catalogLine = catalog.list().map((c) => `${c.satId} (#${c.satnum}${c.name ? ` ${c.name}` : ''})`).join('; ');
            const prompt = buildSatOperatorPrompt({ message, history, fleetLine, catalogLine });
            const sub = String(req.oidc?.user?.sub || 'operator');
            let raw = '';
            try {
                const result = await orchestrator.processMessage(`sat-${sub}-${started}`, prompt, {
                    agenticMode: true, autoApprove: false, source: 'sat-ops', agentId: SAT_OPERATOR_AGENT_ID, userSub: sub,
                });
                raw = String(result?.response || '').trim();
            }
            catch (err) {
                logger.error({ err, stack: err.stack }, 'sat-operator orchestrate failed');
            }
            const env = parseSatOperatorEnvelope(raw, new Set(rows.filter((r) => r.online).map((r) => r.satId)));
            if (!raw)
                env.say = "I couldn't reach the operations-planning brain just now — try again in a moment.";
            logger.info({ hasDraft: !!env.draft, durationMs: Date.now() - started }, 'POST /chat done');
            res.json(env);
        })();
    });
    /** POST /conjunctions {ids?, startUtc?, horizonHours?, stepSeconds?, thresholdKm?} — screen the catalog. */
    router.post('/conjunctions', (req, res) => {
        const started = Date.now();
        const b = (req.body || {});
        try {
            const start = resolveStartUtc(b.startUtc);
            if ('error' in start) {
                res.status(400).json({ error: start.error });
                return;
            }
            const ids = Array.isArray(b.ids) ? b.ids.map(String) : undefined;
            const report = (0, sat_ops_1.screenConjunctions)(catalog.screenEntries(ids), {
                startUtcMs: start.ms,
                horizonHours: b.horizonHours === undefined ? undefined : Number(b.horizonHours),
                stepSeconds: b.stepSeconds === undefined ? undefined : Number(b.stepSeconds),
                thresholdKm: b.thresholdKm === undefined ? undefined : Number(b.thresholdKm),
            });
            logger.info({ screened: report.screenedIds.length, events: report.events.length, durationMs: Date.now() - started }, 'POST /conjunctions done');
            res.json(report);
        }
        catch (err) {
            orbitError(res, err, 'conjunction screening');
        }
    });
    return router;
}
//# sourceMappingURL=sat-routes.js.map