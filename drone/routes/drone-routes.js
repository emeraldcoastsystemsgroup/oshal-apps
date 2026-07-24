"use strict";
/**
 * Drone Ops Routes — single-drone automation control surface API (ADR-098)
 *
 * Backs the Drone Ops surface at /cockpit?app=drone. The framework way:
 *  - FLIGHT is deterministic code: the DroneService (feature slice) validates every command
 *    against the geofence and drives the engine — the built-in kinematic simulator today, a
 *    MAVLink adapter behind the same DroneProvider interface later. No LLM in the control loop.
 *  - The BRAIN (drone-operator, Form B inline concierge) only DRAFTS waypoint missions from
 *    natural language over live telemetry. A draft is persisted per-user as status 'draft' and
 *    NEVER flies by itself — execution is an explicit human-approved POST /missions/:id/execute,
 *    which re-validates the plan against the fence at that moment.
 *  - Every actuating command is audit-logged to drone_command_log under the caller's sub.
 *
 * Per-user isolation: missions + conversations are scoped by the OIDC `sub`. The drone itself
 * is deployment-level (one sim drone, phase 1) — see the ADR for the multi-drone roadmap.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-07-17 19:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Drone Ops
 *            | phase 1: state/telemetry/events, arm/takeoff/goto/land/RTL/abort commands, per-user
 *            | mission store with approval-gated execute, concierge mission drafting via the
 *            | orchestrator (movies-routes pattern), command audit log.
 * 2026-07-17 21:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-099 phase 2 (fleet plane):
 *            | GET /fleet, per-drone command/state/event routes under /fleet/:droneId/* (legacy
 *            | paths stay = the embedded 'alpha' sim), POST /nodes/heartbeat (service-secret
 *            | REQUIRED — a node identity, never an operator browser), mission execute + chat
 *            | gained an optional droneId, and commands thread the hardware confirm flag.
 * 2026-07-18 08:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Show timelines: POST /show/draft
 *            | (preset 'ballet' or a cue timeline; stage-relative slots absolutized + validated by
 *            | the show gate), execute branch for the show shape → FleetShowRunner (the conductor:
 *            | cue-time-synchronized gotos), GET /show/status, POST /show/stop, and /fleet/abort-all
 *            | freezes the conductor first. Drafts stay drafts; Execute is still the one approval.
 * 2026-07-17 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Execute rejections now carry their
 *            | WHY: logged at warn + the reason stored in the drone_command_log detail. A live
 *            | fleet-execute transient (arm delivered, startMission not) was undiagnosable
 *            | because the 409 path left no trace anywhere.
 * 2026-07-17 22:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Fleet Show patterns: GET
 *            | /fleet/patterns (catalog) + POST /fleet/patterns/:id/draft — deterministic
 *            | choreography generated from the LIVE fleet, run through the SAME fleet gate, and
 *            | stored as an ordinary draft (source 'pattern'). Execute rail untouched.
 * 2026-07-18 20:50:00 | roger.murphy@emeraldcoastsystemsgroup.com | Camera equipment + live retask: POST
 *            | /camera (payload op, shape-validated) + GET /captures per drone (structured shot
 *            | records for the gallery), heartbeat ingest passes capture records through, goto
 *            | threads a camera arrival action, and POST /show/retask replaces the remainder of a
 *            | RUNNING show (validateRetask against live positions; audited both outcomes).
 * 2026-07-17 22:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Fleet missions (ADR-099 #2): the
 *            | concierge envelope gains fleetMission ({droneId → plan} assignments) validated by
 *            | the same gate chain (normalize → per-drone fence → pairwise separation) before it
 *            | is saved as a draft; /missions/:id/execute branches on the stored fleet shape into
 *            | DroneService.startFleetMission (all-or-nothing); POST /fleet/abort-all is the
 *            | confirm-exempt fleet-wide safety sweep. One approval still gates every flight.
 * 2026-07-19 14:50:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into
 *            | the drone app package (ADR-085 Wave 3, "skill with a surface"). The surface serves
 *            | from ctx.appPackageDir/tools (load-time env fallback, D10); shared framework helpers
 *            | import via @/ aliases (the drone ENGINE @/features/drone, concierge-envelope +
 *            | concierge-store — the kernel-owned 'drone' prefix — authz, schema bootstrap).
 *            | ensureDroneSchema now appends buildOwnerRlsPolicyStatements for all four user_sub-
 *            | keyed tables (owner-RLS at the lazy-DDL chokepoint). The engine, the drone-node
 *            | server, and the drone-operator inline node stay framework-resident (ADR-099:
 *            | drones ARE swarm nodes).
 * ---------------------------------------------------------------------------
 * @module drone-routes
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
exports.ensureDroneSchema = ensureDroneSchema;
exports.parseOperatorEnvelope = parseOperatorEnvelope;
exports.createDroneRoutes = createDroneRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const authz_1 = require("@/shared/middleware/authz");
const drone_1 = require("@/features/drone");
const concierge_envelope_1 = require("@/app/routes/concierge-envelope");
const concierge_store_1 = require("@/app/routes/concierge-store");
const logger = (0, logger_1.createChildLogger)({ module: 'drone-routes' });
/** The drone-operator agent (Form B inline concierge; registry + persona + this package's manifest). */
const OPERATOR_AGENT_ID = 'b00f0000-0000-0000-0000-000000000001';
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
function resolveViewerSub(req) {
    const trustedSub = (0, authz_1.getTrustedServiceUserSub)(req);
    if (trustedSub)
        return trustedSub;
    const oidc = req.oidc;
    if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
        const u = oidc.user || {};
        const sub = u.sub || u.oid;
        if (sub)
            return String(sub);
    }
    if (process.env.MOCK_OIDC === 'true')
        return 'demo-viewer';
    throw Object.assign(new Error('Not authenticated'), { status: 401 });
}
// ── Schema ───────────────────────────────────────────────────────────────────
async function ensureDroneSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'drone routes',
        statements: [`
    CREATE TABLE IF NOT EXISTS drone_missions (
      mission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, name TEXT NOT NULL,
      plan JSONB NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'draft',
      source VARCHAR(16) NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_flown_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS idx_drone_missions_user ON drone_missions (user_sub, updated_at DESC);
    CREATE TABLE IF NOT EXISTS drone_command_log (
      log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, command VARCHAR(32) NOT NULL,
      detail JSONB, outcome VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS drone_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS drone_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES drone_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('drone_missions', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('drone_command_log', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('drone_conversations', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('drone_messages', 'user_sub'),
        ],
        requirements: [
            { table: 'drone_missions', columns: ['mission_id', 'user_sub', 'name', 'plan', 'status', 'source', 'created_at', 'updated_at'] },
            { table: 'drone_command_log', columns: ['log_id', 'user_sub', 'command', 'detail', 'outcome', 'created_at'] },
            { table: 'drone_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
            { table: 'drone_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
        ],
    });
}
/**
 * @description Build the drone-operator prompt: live telemetry + fence + the strict draft-only
 * output contract. The concierge can never actuate — the contract is "reply JSON with say +
 * an optional mission draft", and the route validates any draft before saving it as 'draft'.
 */
function buildOperatorPrompt(o) {
    const t = o.telemetry;
    const convo = o.history.map((h) => `${h.role === 'assistant' ? 'You' : 'Operator'}: ${h.content}`).join('\n');
    const missions = o.missions.map((m) => `- ${m.name} (${m.status})`).join('\n') || '(none saved)';
    return [
        'You are the Drone Operator — the flight-planning brain of a drone-swarm automation system. You DRAFT waypoint missions; you never fly a drone. Every draft you emit is validated against the geofence and only flies after the human presses Execute. Never claim a flight happened or will happen automatically.',
        '',
        `FLEET: ${o.fleetLine}`,
        `SELECTED DRONE: ${o.droneId}`,
        `LIVE TELEMETRY (${o.droneId}): status=${t.status} | position=${t.position.lat.toFixed(6)},${t.position.lon.toFixed(6)} alt=${t.position.alt}m | battery=${t.batteryPct}% | ${t.distanceFromHomeM}m from home${t.failsafe ? ` | FAILSAFE: ${t.failsafe}` : ''}`,
        `HOME (launch point): ${t.home.lat.toFixed(6)}, ${t.home.lon.toFixed(6)}`,
        `GEOFENCE (hard limits, all waypoints must comply): max ${o.fence.maxRadiusM}m from home, altitude ${o.fence.minAltM}–${o.fence.maxAltM}m AGL, speed 0.5–15 m/s, ≤50 waypoints.`,
        `SAVED MISSIONS:\n${missions}`,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        '',
        `OPERATOR: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply — explain the plan or ask ONE clarifying question", "mission": { "name": "...", "waypoints": [{ "lat": 0, "lon": 0, "alt": 30, "holdSeconds": 0 }], "speedMps": 8, "rtlAfterMission": true }, "fleetMission": null }',
        'Set "mission" to null when you are only answering a question. Waypoint coordinates are absolute WGS-84; derive them as small offsets from HOME (≈0.00001° ≈ 1.1m). Stay well inside the geofence.',
        'FLEET MISSIONS: when the operator asks for a COORDINATED MULTI-DRONE flight, set "mission" to null and set "fleetMission" to { "name": "...", "assignments": [{ "droneId": "<an ONLINE drone from FLEET>", "waypoints": [...], "speedMps": 8, "rtlAfterMission": true }] } — one assignment per drone, each drone at most once. Center each drone\'s waypoints near its OWN home (listed in FLEET). Simultaneous paths must keep ≥20m horizontal OR ≥10m vertical separation at all times — prefer altitude layering (e.g. 30/45/60m). Never fill both "mission" and "fleetMission".',
    ].filter(Boolean).join('\n');
}
/** Parse the operator reply envelope ({say, mission|null, fleetMission|null}); tolerant of missing fields. */
function parseOperatorEnvelope(text) {
    const fallbackSay = (text || '').trim();
    const o = (0, concierge_envelope_1.extractEnvelopeJson)(text);
    if (!o)
        return { say: fallbackSay, mission: null, fleetMission: null };
    return { say: (0, concierge_envelope_1.sayOr)(o, fallbackSay), mission: o.mission ?? null, fleetMission: o.fleetMission ?? null };
}
/**
 * @description Normalize + fully validate an untrusted FLEET draft against the live fleet:
 * per-assignment fence validation centered on each drone's OWN home (offline/unknown drones
 * are reported, not guessed around) plus pairwise separation. The single gate both the
 * concierge draft path and the manual save path call — identical to how single missions
 * share normalizeMissionDraft + validateMission.
 * @returns The typed fleet plan, or null plus every violation found.
 */
function checkFleetDraft(raw, drone) {
    const { plan, errors } = (0, drone_1.normalizeFleetMissionDraft)(raw);
    if (!plan)
        return { plan: null, errors };
    const all = [];
    for (const a of plan.assignments) {
        try {
            const st = drone.getState(a.droneId);
            (0, drone_1.validateMission)(a.plan, drone.fence, st.telemetry.home).forEach((e) => all.push(`[${a.droneId}] ${e}`));
        }
        catch (err) {
            all.push(err.message);
        }
    }
    all.push(...(0, drone_1.validateFleetSeparation)(plan.assignments));
    return all.length ? { plan: null, errors: all } : { plan, errors: [] };
}
/** Home of every ONLINE drone — the frame show slots absolutize and validate against. */
function onlineHomes(drone) {
    const homes = {};
    for (const f of drone.listFleet())
        if (f.online && f.telemetry)
            homes[f.droneId] = f.telemetry.home;
    return homes;
}
/**
 * @description Normalize + fully validate an untrusted SHOW timeline against the live
 * fleet — the show sibling of checkFleetDraft, so drafts and execute-time re-validation
 * share one gate.
 */
function checkShowDraft(raw, drone) {
    const homes = onlineHomes(drone);
    const { timeline, errors } = (0, drone_1.normalizeShowDraft)(raw, homes);
    if (!timeline)
        return { timeline: null, errors };
    const all = (0, drone_1.validateShowTimeline)(timeline, drone.fence, homes);
    return all.length ? { timeline: null, errors: all } : { timeline, errors: [] };
}
// ── Router ───────────────────────────────────────────────────────────────────
function createDroneRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const store = new concierge_store_1.ConciergeStore(pool, 'drone', false);
    const drone = new drone_1.DroneService();
    const showRunner = new drone_1.FleetShowRunner(drone);
    const appHtml = surfaceHtml(ctx.appPackageDir, 'drone-ops.html');
    ensureDroneSchema(pool).catch((err) => logger.warn({ err }, 'Drone schema bootstrap deferred — tables may not exist yet'));
    const viewer = (fn) => async (req, res) => {
        let sub;
        try {
            sub = resolveViewerSub(req);
        }
        catch (e) {
            res.status(e.status || 401).json({ error: e.message });
            return;
        }
        try {
            await fn(req, res, sub);
        }
        catch (err) {
            if (err instanceof drone_1.DroneValidationError) {
                res.status(422).json({ error: 'geofence/mission validation failed', errors: err.errors });
                return;
            }
            if (err instanceof drone_1.DroneCommandError) {
                res.status(409).json({ error: err.message });
                return;
            }
            logger.error({ err, path: req.path }, 'drone route error');
            res.status(500).json({ error: err.message || 'internal error' });
        }
    };
    const audit = async (sub, command, detail, outcome) => {
        await pool.query(`INSERT INTO drone_command_log (user_sub, command, detail, outcome) VALUES ($1,$2,$3,$4)`, [sub, command, JSON.stringify(detail ?? null), outcome]).catch((err) => logger.error({ err, command }, 'drone audit insert failed'));
    };
    /**
     * One actuating command endpoint: resolve the target drone (path param on the fleet routes,
     * default 'alpha' on the legacy paths), run it, audit both outcomes under the caller's sub
     * with the droneId, return that drone's fresh state.
     */
    const command = (name, run) => viewer(async (req, res, sub) => {
        const droneId = String(req.params.droneId || req.body?.droneId || drone_1.DEFAULT_DRONE_ID);
        const confirm = req.body?.confirm === true;
        try {
            const detail = await run(req, droneId, confirm);
            await audit(sub, name, { droneId, ...(typeof detail === 'object' && detail ? detail : { body: req.body ?? null }) }, 'ok');
            res.json({ ok: true, state: drone.getState(droneId) });
        }
        catch (err) {
            if (err instanceof drone_1.DroneCommandError || err instanceof drone_1.DroneValidationError) {
                await audit(sub, name, { droneId, body: req.body ?? null }, 'rejected');
            }
            throw err;
        }
    });
    /** Register the full command set at `base` ('' = legacy alpha paths, '/fleet/:droneId' = per-drone). */
    const registerCommands = (base) => {
        router.post(`${base}/arm`, command('arm', async (_req, id) => { await drone.arm(id); }));
        router.post(`${base}/disarm`, command('disarm', async (_req, id) => { await drone.disarm(id); }));
        router.post(`${base}/takeoff`, command('takeoff', async (req, id, confirm) => {
            const alt = Number(req.body?.alt);
            await drone.takeoff(alt, id, confirm);
            return { alt };
        }));
        router.post(`${base}/goto`, command('goto', async (req, id, confirm) => {
            const b = req.body || {};
            const pt = {
                lat: Number(b.lat), lon: Number(b.lon), alt: Number(b.alt),
                ...(b.headingDeg !== undefined ? { headingDeg: Number(b.headingDeg) } : {}),
                ...(typeof b.led === 'string' ? { led: b.led } : {}),
                ...(b.camera && typeof b.camera === 'object' ? { camera: b.camera } : {}),
            };
            const speed = b.speed !== undefined ? Number(b.speed) : undefined;
            await drone.goto(pt, speed, id, confirm);
            return { ...pt, speed };
        }));
        router.post(`${base}/yaw`, command('yaw', async (req, id, confirm) => {
            const deg = Number(req.body?.deg);
            await drone.setHeading(deg, id, confirm);
            return { deg };
        }));
        router.post(`${base}/led`, command('led', async (req, id) => {
            const color = String(req.body?.color || '');
            await drone.setLed(color, id);
            return { color };
        }));
        router.post(`${base}/camera`, command('camera', async (req, id) => {
            const action = await drone.setCamera(req.body?.action ?? req.body, id);
            return { action };
        }));
        router.post(`${base}/land`, command('land', async (_req, id) => { await drone.land(id); }));
        router.post(`${base}/rtl`, command('rtl', async (_req, id) => { await drone.returnToLaunch(id); }));
        router.post(`${base}/abort`, command('abort-mission', async (_req, id) => { await drone.abortMission(id); }));
        router.post(`${base}/battery`, command('replace-battery', async (_req, id) => { await drone.replaceBattery(id); }));
    };
    // ── Surface + state ────────────────────────────────────────────────────────
    router.get('/app', (_req, res) => {
        res.sendFile(appHtml, (err) => {
            if (err) {
                logger.error({ err, appHtml }, 'Failed to serve drone-ops.html');
                res.status(404).send('Page not found: drone-ops.html');
            }
        });
    });
    router.get('/state', viewer(async (_req, res) => { res.json(drone.getState()); }));
    router.get('/events', viewer(async (req, res) => {
        res.json({ events: drone.getEvents(Number(req.query.since) || 0) });
    }));
    router.get('/config', viewer(async (_req, res) => {
        res.json({ provider: drone.providerKind, fence: drone.fence });
    }));
    // ── Fleet plane (ADR-099): every known drone + per-drone routes ────────────
    router.get('/fleet', viewer(async (_req, res) => { res.json({ fleet: drone.listFleet(), fence: drone.fence }); }));
    // Fleet-wide abort: the confirm-exempt safety sweep (stopping missions only makes the
    // vehicles safer). The show conductor is frozen FIRST so it can't re-dispatch cues into
    // the sweep. Best-effort per drone; the response says exactly what happened to each.
    router.post('/fleet/abort-all', viewer(async (_req, res, sub) => {
        await showRunner.stop('fleet abort');
        const results = await drone.abortFleet();
        await audit(sub, 'fleet-abort', { results }, 'ok');
        res.json({ ok: true, results, fleet: drone.listFleet() });
    }));
    // ── Show timelines (the conductor): draft → human Execute → cue-synchronized flight ──
    router.post('/show/draft', viewer(async (req, res, sub) => {
        let raw = req.body?.timeline;
        if (!raw && req.body?.preset) {
            if (String(req.body.preset) !== 'ballet') {
                res.status(422).json({ error: `unknown show preset "${req.body.preset}"` });
                return;
            }
            const homes = onlineHomes(drone);
            const requested = Array.isArray(req.body?.droneIds) && req.body.droneIds.length
                ? req.body.droneIds.map(String)
                : Object.keys(homes);
            const missing = requested.filter((id) => !homes[id]);
            if (missing.length) {
                res.status(422).json({ error: 'show needs online drones', errors: missing.map((id) => `drone "${id}" is not online`) });
                return;
            }
            raw = (0, drone_1.generateBalletShow)(requested.map((id) => ({ droneId: id, home: homes[id] })));
        }
        if (!raw) {
            res.status(400).json({ error: 'body needs a timeline or a preset' });
            return;
        }
        const { timeline, errors } = checkShowDraft(raw, drone);
        if (!timeline) {
            res.status(422).json({ error: 'invalid show timeline', errors });
            return;
        }
        const r = await pool.query(`INSERT INTO drone_missions (user_sub, name, plan, source, status) VALUES ($1,$2,$3,'show','draft') RETURNING *`, [sub, timeline.name, JSON.stringify(timeline)]);
        res.json({ mission: r.rows[0] });
    }));
    router.get('/show/status', viewer(async (_req, res) => { res.json(showRunner.status()); }));
    router.post('/show/stop', viewer(async (_req, res, sub) => {
        await showRunner.stop('operator stop');
        await audit(sub, 'show-stop', { status: showRunner.status() }, 'ok');
        res.json({ ok: true, show: showRunner.status() });
    }));
    // LIVE RETASK ("changes on demand"): replace the remainder of the RUNNING show. Cue times
    // are seconds from acceptance. Validated against LIVE positions (validateRetask) — the same
    // separation/fence/reachability doctrine as a fresh draft, with holders at their real spots.
    // No new approval needed: the show was human-executed and the roster cannot grow.
    router.post('/show/retask', viewer(async (req, res, sub) => {
        const st = showRunner.status();
        if (!st.active || st.phase !== 'cues') {
            res.status(409).json({ error: `a retask needs a show in the cues phase — current phase is ${st.phase}` });
            return;
        }
        const confirm = req.body?.confirm === true;
        const homes = onlineHomes(drone);
        const { timeline, errors } = (0, drone_1.normalizeShowDraft)(req.body?.timeline, homes);
        if (!timeline) {
            res.status(422).json({ error: 'invalid retask timeline', errors });
            return;
        }
        // A retask actuates real hardware afresh — the confirm rail applies exactly as it does to
        // start/goto. Reject before validation if any roster drone is non-sim and confirm is absent.
        const hwRoster = st.drones.filter((id) => { try {
            return drone.getState(id).provider !== 'sim';
        }
        catch {
            return false;
        } });
        if (hwRoster.length && !confirm) {
            await audit(sub, 'show-retask', { name: timeline.name, error: `hardware roster needs confirm: ${hwRoster.join(', ')}` }, 'rejected');
            res.status(409).json({ error: `this show includes real hardware (${hwRoster.join(', ')}) — a live retask needs confirm:true` });
            return;
        }
        const liveById = {};
        for (const id of st.drones) {
            try {
                liveById[id] = drone.getState(id).telemetry.position;
            }
            catch (err) {
                logger.warn({ err, droneId: id }, 'retask — roster drone has no readable state');
            }
        }
        const vErrors = (0, drone_1.validateRetask)(timeline, drone.fence, homes, liveById, st.drones);
        if (vErrors.length) {
            await audit(sub, 'show-retask', { name: timeline.name, error: vErrors.join('; ') }, 'rejected');
            res.status(422).json({ error: 'retask failed validation', errors: vErrors });
            return;
        }
        try {
            await showRunner.retask(timeline, { confirm });
        }
        catch (err) {
            // Persist the WHY on any rejection (both error classes) — a retask actuates, so the
            // reason must survive exactly like the execute paths (2026-07-17 lesson).
            if (err instanceof drone_1.DroneCommandError || err instanceof drone_1.DroneValidationError) {
                const reason = err instanceof drone_1.DroneValidationError ? err.errors.join('; ') : err.message;
                await audit(sub, 'show-retask', { name: timeline.name, error: reason }, 'rejected');
            }
            throw err;
        }
        // Persist the full retasked geometry (not just counts) — a live retask leaves no
        // drone_missions row, so the audit detail is the only durable record of what flew.
        await audit(sub, 'show-retask', { name: timeline.name, cues: timeline.cues, drones: (0, drone_1.showParticipants)(timeline) }, 'ok');
        res.json({ ok: true, show: showRunner.status() });
    }));
    // Fleet Show: deterministic choreography. The generator only PRODUCES a plan — it goes
    // through the same checkFleetDraft gate and is stored as a draft; Execute stays human.
    router.get('/fleet/patterns', viewer(async (_req, res) => {
        res.json({ patterns: drone_1.FLEET_PATTERNS, defaults: { sizeM: 160, altBaseM: 30, altStepM: 12, speedMps: 8 } });
    }));
    router.post('/fleet/patterns/:patternId/draft', viewer(async (req, res, sub) => {
        const online = drone.listFleet().filter((f) => f.online && f.telemetry);
        const requested = Array.isArray(req.body?.droneIds) && req.body.droneIds.length
            ? req.body.droneIds.map(String)
            : online.map((f) => f.droneId);
        const missing = requested.filter((id) => !online.some((f) => f.droneId === id));
        if (missing.length) {
            res.status(422).json({ error: 'pattern draft needs online drones', errors: missing.map((id) => `drone "${id}" is not online`) });
            return;
        }
        const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
        const { plan: generated, errors: genErrors } = (0, drone_1.generateFleetPattern)({
            patternId: String(req.params.patternId),
            drones: requested.map((id) => ({ droneId: id, home: online.find((f) => f.droneId === id).telemetry.home })),
            sizeM: num(req.body?.sizeM),
            altBaseM: num(req.body?.altBaseM),
            altStepM: num(req.body?.altStepM),
            speedMps: num(req.body?.speedMps),
        });
        if (!generated) {
            res.status(422).json({ error: 'pattern generation failed', errors: genErrors });
            return;
        }
        const { plan: fleetPlan, errors } = checkFleetDraft(generated, drone);
        if (!fleetPlan) {
            res.status(422).json({ error: 'generated pattern failed the fleet gate', errors });
            return;
        }
        const r = await pool.query(`INSERT INTO drone_missions (user_sub, name, plan, source, status) VALUES ($1,$2,$3,'pattern','draft') RETURNING *`, [sub, fleetPlan.name, JSON.stringify(fleetPlan)]);
        res.json({ mission: r.rows[0] });
    }));
    router.get('/fleet/:droneId/state', viewer(async (req, res) => {
        res.json(drone.getState(String(req.params.droneId)));
    }));
    router.get('/fleet/:droneId/events', viewer(async (req, res) => {
        res.json({ events: drone.getEvents(Number(req.query.since) || 0, String(req.params.droneId)) });
    }));
    router.get('/captures', viewer(async (req, res) => {
        res.json({ captures: drone.getCaptures(Number(req.query.since) || 0) });
    }));
    router.get('/fleet/:droneId/captures', viewer(async (req, res) => {
        res.json({ captures: drone.getCaptures(Number(req.query.since) || 0, String(req.params.droneId)) });
    }));
    // Drone-node heartbeat ingest: a NODE identity, never an operator browser — the swarm
    // service secret is REQUIRED (the surrounding serviceSecretOr(requiresAuth) would also let
    // an OIDC session through, which must not be able to impersonate a vehicle).
    router.post('/nodes/heartbeat', async (req, res) => {
        if (!(0, authz_1.hasValidServiceSecret)(req)) {
            res.status(401).json({ error: 'drone-node heartbeat requires the swarm service secret' });
            return;
        }
        try {
            const b = (req.body || {});
            if (!b.droneId || !b.endpointUrl || !b.telemetry) {
                res.status(400).json({ error: 'droneId, endpointUrl, and telemetry are required' });
                return;
            }
            const ack = drone.ingestHeartbeat({
                droneId: String(b.droneId),
                endpointUrl: String(b.endpointUrl),
                engine: b.engine === 'mavlink' ? 'mavlink' : 'sim',
                telemetry: b.telemetry,
                events: Array.isArray(b.events) ? b.events : [],
                videoUrl: typeof b.videoUrl === 'string' ? b.videoUrl : undefined,
                captures: Array.isArray(b.captures) ? b.captures : [],
            });
            res.json({ ok: true, ack });
        }
        catch (err) {
            if (err instanceof drone_1.DroneCommandError) {
                res.status(409).json({ error: err.message });
                return;
            }
            logger.error({ err }, 'drone heartbeat ingest failed');
            res.status(500).json({ error: err.message || 'internal error' });
        }
    });
    // ── Flight commands (deterministic; geofence-validated in DroneService) ────
    registerCommands(''); // legacy paths → the embedded 'alpha' sim
    registerCommands('/fleet/:droneId'); // per-drone (remote nodes + alpha alike)
    registerMissionRoutes(router, viewer, pool, drone, audit, showRunner);
    registerChatRoutes(router, viewer, ctx, pool, store, drone);
    return router;
}
function registerMissionRoutes(router, viewer, pool, drone, audit, showRunner) {
    router.get('/missions', viewer(async (_req, res, sub) => {
        const rows = (await pool.query(`SELECT mission_id, name, plan, status, source, created_at, updated_at, last_flown_at
       FROM drone_missions WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT 50`, [sub])).rows;
        res.json({ missions: rows });
    }));
    router.post('/missions', viewer(async (req, res, sub) => {
        // Fleet-shaped bodies save through the fleet gate; the table and endpoint are shared.
        if ((0, drone_1.isFleetMissionShape)(req.body)) {
            const { plan: fleetPlan, errors } = checkFleetDraft(req.body, drone);
            if (!fleetPlan) {
                res.status(422).json({ error: 'invalid fleet mission', errors });
                return;
            }
            const r = await pool.query(`INSERT INTO drone_missions (user_sub, name, plan, source, status) VALUES ($1,$2,$3,'manual','ready') RETURNING *`, [sub, fleetPlan.name, JSON.stringify(fleetPlan)]);
            res.json({ mission: r.rows[0] });
            return;
        }
        const { plan, errors } = (0, drone_1.normalizeMissionDraft)(req.body);
        if (!plan) {
            res.status(422).json({ error: 'invalid mission', errors });
            return;
        }
        const fenceErrors = (0, drone_1.validateMission)(plan, drone.fence, drone.getState().telemetry.home);
        if (fenceErrors.length) {
            res.status(422).json({ error: 'geofence/mission validation failed', errors: fenceErrors });
            return;
        }
        const r = await pool.query(`INSERT INTO drone_missions (user_sub, name, plan, source, status) VALUES ($1,$2,$3,'manual','ready') RETURNING *`, [sub, plan.name, JSON.stringify(plan)]);
        res.json({ mission: r.rows[0] });
    }));
    router.delete('/missions/:missionId', viewer(async (req, res, sub) => {
        await pool.query(`DELETE FROM drone_missions WHERE mission_id = $1 AND user_sub = $2`, [req.params.missionId, sub]);
        res.json({ ok: true });
    }));
    // The approval gate: a human explicitly executes a stored mission (optional body.droneId
    // targets a fleet drone; body.confirm satisfies the real-hardware rail). The plan is
    // re-normalized and re-validated against the CURRENT fence here — a stale or
    // concierge-drafted plan never flies on the strength of an old validation.
    router.post('/missions/:missionId/execute', viewer(async (req, res, sub) => {
        const droneId = String(req.body?.droneId || drone_1.DEFAULT_DRONE_ID);
        const confirm = req.body?.confirm === true;
        const r = await pool.query(`SELECT * FROM drone_missions WHERE mission_id = $1 AND user_sub = $2`, [req.params.missionId, sub]);
        if (!r.rows.length) {
            res.status(404).json({ error: 'mission not found' });
            return;
        }
        // SHOW timelines branch here: the stored timeline is re-validated against the LIVE
        // fleet at this moment, then handed to the conductor — Execute is the one approval
        // that starts the clock. One show at a time; the runner rejects overlaps.
        if ((0, drone_1.isShowShape)(r.rows[0].plan)) {
            const { timeline, errors } = checkShowDraft(r.rows[0].plan, drone);
            if (!timeline) {
                res.status(422).json({ error: 'stored show failed re-validation', errors });
                return;
            }
            try {
                await showRunner.start(timeline, { confirm });
            }
            catch (err) {
                if (err instanceof drone_1.DroneCommandError || err instanceof drone_1.DroneValidationError) {
                    const reason = err instanceof drone_1.DroneValidationError ? err.errors.join('; ') : err.message;
                    logger.warn({ missionId: req.params.missionId, reason }, 'show execute rejected');
                    await audit(sub, 'execute-show', { missionId: req.params.missionId, name: timeline.name, error: reason }, 'rejected');
                }
                throw err;
            }
            await audit(sub, 'execute-show', { missionId: req.params.missionId, name: timeline.name, drones: timeline.cues[0].slots.map((s) => s.droneId) }, 'ok');
            await pool.query(`UPDATE drone_missions SET status = 'flown', last_flown_at = NOW(), updated_at = NOW() WHERE mission_id = $1`, [req.params.missionId]);
            res.json({ ok: true, show: showRunner.status() });
            return;
        }
        // FLEET missions branch here: re-normalized + re-validated (fence per drone + separation
        // + confirm rail) inside startFleetMission at THIS moment — same doctrine as single plans.
        if ((0, drone_1.isFleetMissionShape)(r.rows[0].plan)) {
            const { plan: fleetPlan, errors } = (0, drone_1.normalizeFleetMissionDraft)(r.rows[0].plan);
            if (!fleetPlan) {
                res.status(422).json({ error: 'stored fleet mission is malformed', errors });
                return;
            }
            const drones = fleetPlan.assignments.map((a) => a.droneId);
            try {
                await drone.startFleetMission(fleetPlan, confirm);
            }
            catch (err) {
                if (err instanceof drone_1.DroneCommandError || err instanceof drone_1.DroneValidationError) {
                    // The WHY must survive: 409/422 responses aren't logged anywhere else, which made a
                    // live transient (arm delivered, startMission not) undiagnosable post-hoc (2026-07-17).
                    const reason = err instanceof drone_1.DroneValidationError ? err.errors.join('; ') : err.message;
                    logger.warn({ missionId: req.params.missionId, drones, reason }, 'fleet mission execute rejected');
                    await audit(sub, 'execute-fleet-mission', { missionId: req.params.missionId, name: fleetPlan.name, drones, error: reason }, 'rejected');
                }
                throw err;
            }
            await audit(sub, 'execute-fleet-mission', { missionId: req.params.missionId, name: fleetPlan.name, drones }, 'ok');
            await pool.query(`UPDATE drone_missions SET status = 'flown', last_flown_at = NOW(), updated_at = NOW() WHERE mission_id = $1`, [req.params.missionId]);
            res.json({ ok: true, fleet: drone.listFleet() });
            return;
        }
        const { plan, errors } = (0, drone_1.normalizeMissionDraft)(r.rows[0].plan);
        if (!plan) {
            res.status(422).json({ error: 'stored mission is malformed', errors });
            return;
        }
        try {
            await drone.startMission(plan, droneId, confirm);
        }
        catch (err) {
            if (err instanceof drone_1.DroneCommandError || err instanceof drone_1.DroneValidationError) {
                const reason = err instanceof drone_1.DroneValidationError ? err.errors.join('; ') : err.message;
                logger.warn({ missionId: req.params.missionId, droneId, reason }, 'mission execute rejected');
                await audit(sub, 'execute-mission', { missionId: req.params.missionId, name: plan.name, droneId, error: reason }, 'rejected');
            }
            throw err;
        }
        await audit(sub, 'execute-mission', { missionId: req.params.missionId, name: plan.name, droneId }, 'ok');
        await pool.query(`UPDATE drone_missions SET status = 'flown', last_flown_at = NOW(), updated_at = NOW() WHERE mission_id = $1`, [req.params.missionId]);
        res.json({ ok: true, state: drone.getState(droneId) });
    }));
}
// ── Concierge chat (drafts only — never actuates) ────────────────────────────
function registerChatRoutes(router, viewer, ctx, pool, store, drone) {
    router.post('/chat', viewer(async (req, res, sub) => {
        const message = String(req.body?.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message is required' });
            return;
        }
        const conversationId = await store.ensureConversation(sub, req.body?.conversationId || undefined, message);
        await store.addMessage(conversationId, sub, 'user', message);
        const history = await store.loadHistory(conversationId);
        const missions = (await pool.query(`SELECT name, status FROM drone_missions WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT 10`, [sub])).rows;
        // Draft against the selected drone when it's reachable; fall back to the embedded alpha
        // (drafting must keep working even when a node is offline — flying it won't).
        let droneId = String(req.body?.droneId || drone_1.DEFAULT_DRONE_ID);
        let state;
        try {
            state = drone.getState(droneId);
        }
        catch {
            droneId = drone_1.DEFAULT_DRONE_ID;
            state = drone.getState();
        }
        const fleetLine = drone.listFleet()
            .map((f) => `${f.droneId} (${f.kind}, ${f.online ? 'online' : 'OFFLINE'}${f.telemetry ? `, batt ${f.telemetry.batteryPct}%, home ${f.telemetry.home.lat.toFixed(6)},${f.telemetry.home.lon.toFixed(6)}` : ''})`)
            .join('; ');
        const prompt = buildOperatorPrompt({ message, history, telemetry: state.telemetry, fence: state.fence, missions, droneId, fleetLine });
        let raw = '';
        try {
            const result = await ctx.orchestrator.processMessage(`drone-${sub}-${(0, crypto_1.randomUUID)()}`, prompt, {
                agenticMode: true, autoApprove: false, source: 'drone', agentId: OPERATOR_AGENT_ID, userSub: sub,
            });
            raw = String(result?.response || '').trim();
        }
        catch (e) {
            logger.error({ e }, 'drone operator orchestrate failed');
        }
        const env = parseOperatorEnvelope(raw);
        if (!env.say)
            env.say = "I couldn't reach the flight-planning brain just now — try again in a moment.";
        let draft = null;
        let draftErrors = [];
        if (env.fleetMission) {
            // Fleet drafts pass the full gate (normalize → per-drone fence → separation) BEFORE
            // they are stored — a rejected fleet draft never becomes an executable row.
            const { plan: fleetPlan, errors } = checkFleetDraft(env.fleetMission, drone);
            draftErrors = errors;
            if (fleetPlan) {
                const r = await pool.query(`INSERT INTO drone_missions (user_sub, name, plan, source, status) VALUES ($1,$2,$3,'concierge','draft') RETURNING mission_id`, [sub, fleetPlan.name, JSON.stringify(fleetPlan)]);
                draft = { missionId: r.rows[0].mission_id, plan: fleetPlan };
            }
        }
        else if (env.mission) {
            const { plan, errors } = (0, drone_1.normalizeMissionDraft)(env.mission);
            draftErrors = errors;
            if (plan) {
                const fenceErrors = (0, drone_1.validateMission)(plan, state.fence, state.telemetry.home);
                if (fenceErrors.length)
                    draftErrors = fenceErrors;
                else {
                    const r = await pool.query(`INSERT INTO drone_missions (user_sub, name, plan, source, status) VALUES ($1,$2,$3,'concierge','draft') RETURNING mission_id`, [sub, plan.name, JSON.stringify(plan)]);
                    draft = { missionId: r.rows[0].mission_id, plan };
                }
            }
        }
        await store.addMessage(conversationId, sub, 'assistant', env.say);
        await store.touch(conversationId);
        res.json({ conversationId, reply: env.say, draft, draftErrors });
    }));
    router.get('/conversation', viewer(async (req, res, sub) => {
        res.json(await store.resume(sub, String(req.query.id || '')));
    }));
}
//# sourceMappingURL=drone-routes.js.map