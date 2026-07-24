"use strict";
/**
 * Spaces (ADR-111) — the video->3D reconstruction app's HTTP surface (PACKAGED).
 * Serves the cockpit surface (`/app`), the self-contained WebGL splat viewer
 * (`/viewer`), and the phone capture HUD (`/capture`), plus the owner-scoped
 * scan JSON API the surfaces are a view over. All reasoning lives on the
 * spaces-operator inline concierge; deterministic reconstruction I/O lives in the
 * kernel-resident spatial-mapping service (@/features/spatial-mapping).
 *
 * @module spaces-routes
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 22:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-111 Phase 1 — initial spaces routes: surface + viewer sendFile, multipart video upload (multer disk storage into the scan-scoped dir), scan list/detail, and a streamed owner-scoped .splat artifact endpoint. Mounted under a single requiresAuth in server.ts; every handler re-derives the caller sub and pins reads to it.
 * 2026-07-20 06:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-111 direct-import lane (POST /scans/import), pose persistence (GET /scans/:id/poses), RF/router coverage overlay (POST /scans/:id/rf + GET overlay/summary), guided capture-plan (GET /capture-plan), the live phone HUD (GET /capture + POST /capture-telemetry), and the sim-first drone scan (POST /drone-scan). See docs/architecture/spatial-capture-playbook.md.
 * 2026-07-20 15:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the spaces app package (ADR-085, "skill with a surface"). STRUCTURAL adaptation only: the factory drops the `apiDir` parameter for the standard single-arg (ctx) package shape (the mounter calls factory(packageCtx) — manifest-route-mounter.ts D10), and the three surfaces now serve from ctx.appPackageDir/tools via surfaceHtml() (load-time env fallback). Shared framework helpers keep importing via @/ aliases — the reconstruction ENGINE @/features/spatial-mapping (PINNED kernel skill 'spatial-mapping', declared in the manifest `uses:`) and the sim-drone helper @/features/drone (kernel-resident via the drone node-server pin). NOTE: the handler bodies below are a SYNC region — core spaces-routes.ts is being extended concurrently (mobile-ingest endpoint); the orchestrator RE-SYNCS the handler bodies from the final core source and rebuilds routes/spaces-routes.js at integration.
 * 2026-07-20 19:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | Integration sync: grafted the final core /pair mobile-ingest endpoint (+ callerEmail / clampPairingTtlMinutes / requestOrigin helpers + the TTL bounds) onto this packaged surface. Rewrote the insertCliToken import from the core-relative './cli-token-routes' to the '@/app/routes/cli-token-routes' alias — src/app/** is always in dist, so the mounter resolves it against the running framework at mount time (same mechanism as @/features/*). The SYNC region below is now reconciled to the final core source.
 * 2026-07-20 21:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-111 geometry export: GET /scans/:id/geometry downloads the ACCURATE model a build consumes (the original LiDAR/photogrammetry .ply for an import, the produced .splat for a reconstruction) via the kernel engine's getGeometryPath; GET /scans/:id/dimensions returns the to-scale footprint (getDimensions — metres for LiDAR, labelled relative otherwise). Owner-scoped; turns Spaces from a viewer into a model you can build on.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSpacesRoutes = createSpacesRoutes;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const spatial_mapping_1 = require("@/features/spatial-mapping");
const drone_1 = require("@/features/drone");
const cli_token_routes_1 = require("@/app/routes/cli-token-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'spaces-routes' });
/** Max accepted upload size — a room walkthrough clip, not a movie. */
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
/** Phone-pairing token lifetime bounds (minutes): default a day, clamp 5 min … 30 days. Short-lived + revocable. */
const DEFAULT_PAIRING_TTL_MIN = 24 * 60;
const MIN_PAIRING_TTL_MIN = 5;
const MAX_PAIRING_TTL_MIN = 30 * 24 * 60;
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve a surface file from the package's tools/ dir (ctx.appPackageDir,
 * captured at factory time per D10), with the load-time env fallback and a final relative
 * fallback for running the built routes/ next to src-routes/ (tests, local checks).
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
/** Resolve the authenticated caller's sub (mount is requiresAuth). A `Bearer oshal_pat_…`
 *  pairing/PAT token is resolved to this owner sub by the global CLI-token middleware upstream,
 *  so the phone's tokened ingest lands here under the real owner — never anonymous. */
function callerSub(req) {
    const oidc = req.oidc;
    return oidc?.user?.sub || oidc?.user?.oid || null;
}
/** The caller's email, when the OIDC/token session carries one (stored on the minted token for display). */
function callerEmail(req) {
    const user = req.oidc?.user;
    return user?.email || user?.preferred_username || null;
}
/** Clamp a requested pairing lifetime (minutes) into the allowed band, defaulting when unset/invalid. */
function clampPairingTtlMinutes(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0)
        return DEFAULT_PAIRING_TTL_MIN;
    return Math.min(MAX_PAIRING_TTL_MIN, Math.max(MIN_PAIRING_TTL_MIN, Math.floor(n)));
}
/** Best-effort absolute origin (honors a reverse proxy) so the QR payload is directly usable by the phone. */
function requestOrigin(req) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'https';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
}
/** Sanitize an upload's extension to a short safe suffix. */
function safeExt(name) {
    const ext = path.extname(name || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    return ext && ext.length <= 12 ? ext : '.mp4';
}
/** Fixed WGS-84 reference the sim scan missions orbit around (arbitrary but stable). */
const SIM_SCAN_HOME = { lat: 30.4213, lon: -87.2169 };
const SIM_SCAN_MAX_VIRTUAL_S = 3600;
/**
 * @description Fly a mapper-drafted scan orbit on the sim drone under a VIRTUAL
 * clock: the sim integrates flight lazily on telemetry reads, so stepping the
 * injected clock completes a full multi-ring photo mission deterministically in
 * milliseconds of real time. ADR-111 Phase 3 sim-first; real drones keep the
 * onboard-VIO boundary and the MAVLink media follow-up.
 * @returns The flown plan + the camera capture records it produced
 */
async function flySimScanMission() {
    const pattern = (0, spatial_mapping_1.droneScanPattern)({
        home: SIM_SCAN_HOME, radiusM: 4, altitudesM: [2.5, 4.5], overlapPct: 0.75, fovDeg: 70,
    });
    const plan = {
        name: 'spaces-scan-orbit',
        speedMps: 2,
        rtlAfterMission: true,
        waypoints: pattern.waypoints.map((w) => ({
            lat: w.lat, lon: w.lon, alt: w.alt, headingDeg: w.headingDeg,
            camera: { op: 'photo', tiltDeg: w.camera.tiltDeg },
        })),
    };
    const home = { ...SIM_SCAN_HOME, alt: 0 };
    const errors = (0, drone_1.validateMission)(plan, { maxRadiusM: 100, maxAltM: 120, minAltM: 1 }, home);
    if (errors.length > 0)
        throw new Error(`generated scan mission failed validation: ${errors.join('; ')}`);
    let virtualNow = 0;
    const drone = new drone_1.SimDroneProvider({
        droneId: `spaces-scan-${(0, crypto_1.randomUUID)().slice(0, 8)}`,
        home: SIM_SCAN_HOME,
        clock: () => virtualNow,
    });
    await drone.arm();
    await drone.startMission(plan);
    let telemetry = drone.getTelemetry();
    for (let s = 0; s < SIM_SCAN_MAX_VIRTUAL_S && telemetry.status !== 'disarmed'; s++) {
        virtualNow += 1000;
        telemetry = drone.getTelemetry();
    }
    if (telemetry.status !== 'disarmed') {
        throw new Error(`sim scan mission did not complete within ${SIM_SCAN_MAX_VIRTUAL_S}s (status ${telemetry.status})`);
    }
    return {
        home: SIM_SCAN_HOME,
        pattern: { perRing: pattern.perRing, stepDeg: pattern.stepDeg, ringCount: pattern.ringCount },
        plan,
        captures: drone.getCaptures(0),
        virtualFlightS: Math.round(virtualNow / 1000),
    };
}
/**
 * @description Build the Spaces router (packaged single-arg factory). Serves the
 * surface + viewer + capture HUD from this package's tools/ and the owner-scoped
 * scan API. The mounter injects ctx.appPackageDir (manifest-route-mounter D10).
 * @param ctx - Per-package application context (pg pool + appPackageDir)
 * @returns The configured Express router
 */
function createSpacesRoutes(ctx) {
    const router = (0, express_1.Router)();
    const service = new spatial_mapping_1.SpatialMappingService(ctx.pool);
    const rf = new spatial_mapping_1.RfOverlayService(ctx.pool);
    const appHtml = surfaceHtml(ctx.appPackageDir, 'spaces.html');
    const viewerHtml = surfaceHtml(ctx.appPackageDir, 'spaces-viewer.html');
    const captureHtml = surfaceHtml(ctx.appPackageDir, 'spaces-capture.html');
    // ══════════════════════════════════════════════════════════════════════════
    // Ported from core src/app/routes/spaces-routes.ts (RECONCILED to final source
    // 2026-07-20 19:45, incl. the /pair mobile-ingest endpoint). Adapted ONLY where
    // noted: surfaces serve from surfaceHtml(ctx.appPackageDir, ...) instead of a
    // passed-in apiDir (the /app, /viewer, /capture handlers), and insertCliToken
    // imports via the @/app/routes/cli-token-routes alias. Keep the single-arg
    // (ctx) factory signature — do NOT reintroduce the `apiDir` parameter.
    // ══════════════════════════════════════════════════════════════════════════
    // multer writes the upload straight into the scan-scoped dir (no full-video
    // buffering in RAM) using the sub + scan id stashed by prepUpload below.
    const storage = multer_1.default.diskStorage({
        destination(req, _file, cb) {
            const s = req;
            const dir = (0, spatial_mapping_1.scanDir)(s._spacesSub, s._spacesScanId);
            fs.promises.mkdir(dir, { recursive: true }).then(() => cb(null, dir)).catch((e) => cb(e, dir));
        },
        filename(_req, file, cb) {
            cb(null, `source${safeExt(file.originalname)}`);
        },
    });
    const upload = (0, multer_1.default)({ storage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    // Assign the caller sub + a fresh scan id BEFORE multer streams the file, and enforce the
    // per-user scan quota here so an over-cap user is rejected without streaming a 300MB upload.
    const prepUpload = async (req, res, next) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            if (!(await service.canAcceptScan(sub))) {
                res.status(429).json({ error: 'scan_quota_exceeded', maxScans: service.maxScansPerUser });
                return;
            }
        }
        catch (err) {
            logger.error({ err }, 'scan quota check failed');
            res.status(500).json({ error: 'quota check failed' });
            return;
        }
        const s = req;
        s._spacesSub = sub;
        s._spacesScanId = (0, crypto_1.randomUUID)();
        next();
    };
    // Run multer, translating its errors to clean 4xx (413 for too-large, 400 otherwise) and removing
    // the pre-created scan dir so a rejected upload never leaks an empty directory.
    const uploadVideo = (req, res, next) => {
        upload.single('video')(req, res, (err) => {
            if (!err) {
                next();
                return;
            }
            const s = req;
            if (s._spacesSub && s._spacesScanId) {
                void fs.promises.rm((0, spatial_mapping_1.scanDir)(s._spacesSub, s._spacesScanId), { recursive: true, force: true })
                    .catch((e) => logger.warn({ e }, 'orphan scan dir cleanup failed'));
            }
            const tooLarge = err instanceof multer_1.default.MulterError && err.code === 'LIMIT_FILE_SIZE';
            logger.warn({ err }, 'spaces video upload rejected');
            res.status(tooLarge ? 413 : 400).json({
                error: tooLarge ? 'video_too_large' : 'invalid_video_upload',
                maxUploadBytes: MAX_UPLOAD_BYTES,
            });
        });
    };
    // Same disk-streaming + orphan-cleanup contract as uploadVideo, but for the import lane's
    // multipart field ("model") — a pre-built .ply/.splat capture rather than a walkthrough video.
    const uploadModel = (req, res, next) => {
        upload.single('model')(req, res, (err) => {
            if (!err) {
                next();
                return;
            }
            const s = req;
            if (s._spacesSub && s._spacesScanId) {
                void fs.promises.rm((0, spatial_mapping_1.scanDir)(s._spacesSub, s._spacesScanId), { recursive: true, force: true })
                    .catch((e) => logger.warn({ e }, 'orphan scan dir cleanup failed'));
            }
            const tooLarge = err instanceof multer_1.default.MulterError && err.code === 'LIMIT_FILE_SIZE';
            logger.warn({ err }, 'spaces model import rejected');
            res.status(tooLarge ? 413 : 400).json({
                error: tooLarge ? 'model_too_large' : 'invalid_model_upload',
                maxUploadBytes: MAX_UPLOAD_BYTES,
            });
        });
    };
    router.get('/app', (_req, res) => sendPage(res, appHtml));
    router.get('/viewer', (_req, res) => sendPage(res, viewerHtml));
    router.post('/scans', prepUpload, uploadVideo, async (req, res) => {
        const s = req;
        const sub = s._spacesSub;
        const scanId = s._spacesScanId;
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: 'a video file is required (multipart field "video")' });
            return;
        }
        const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const title = (rawTitle || file.originalname || 'Untitled scan').slice(0, 120);
        try {
            const scan = await service.registerAndStart({
                id: scanId, userSub: sub, title, sourceKind: 'video',
                sourceName: file.originalname || 'source', sourceRef: file.path, sourceBytes: file.size,
            });
            res.status(201).json({ scan });
        }
        catch (err) {
            logger.error({ err, scanId }, 'scan registration failed');
            // the upload already streamed to disk — don't leak the file/dir when the row never landed
            void fs.promises.rm((0, spatial_mapping_1.scanDir)(sub, scanId), { recursive: true, force: true })
                .catch((e) => logger.warn({ e, scanId }, 'scan dir cleanup after failed registration failed'));
            res.status(500).json({ error: 'failed to start scan' });
        }
    });
    // Import a pre-built 3D capture (.ply/.splat) exported from the user's own device — no GPU/recon
    // box needed. Registered as a 'model' scan; the import engine converts it to a viewer splat.
    router.post('/scans/import', prepUpload, uploadModel, async (req, res) => {
        const s = req;
        const sub = s._spacesSub;
        const scanId = s._spacesScanId;
        const cleanup = () => {
            void fs.promises.rm((0, spatial_mapping_1.scanDir)(sub, scanId), { recursive: true, force: true })
                .catch((e) => logger.warn({ e, scanId }, 'scan dir cleanup failed'));
        };
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: 'a 3D capture file is required (multipart field "model")' });
            return;
        }
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (!spatial_mapping_1.IMPORT_EXTENSIONS.includes(ext)) {
            cleanup();
            res.status(400).json({ error: 'unsupported_import_format', accepts: spatial_mapping_1.IMPORT_EXTENSIONS });
            return;
        }
        const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const title = (rawTitle || file.originalname || 'Imported scan').slice(0, 120);
        try {
            const scan = await service.registerAndStart({
                id: scanId, userSub: sub, title, sourceKind: 'model',
                sourceName: file.originalname || `source${ext}`, sourceRef: file.path, sourceBytes: file.size,
            });
            res.status(201).json({ scan });
        }
        catch (err) {
            logger.error({ err, scanId }, 'import registration failed');
            cleanup();
            res.status(500).json({ error: 'failed to import capture' });
        }
    });
    // ADR-111 mobile ingest — mint a short-lived, revocable, owner-scoped pairing token so an iPhone
    // (native app or an iOS Shortcut) can POST a LiDAR/photogrammetry capture WITHOUT a browser OIDC
    // login. Auth-gated by the /api/spaces requiresAuth mount: only a logged-in owner mints, and only
    // for their OWN sub (never a body-supplied sub). The token rides the existing oshal_cli_tokens
    // store, so the global CLI-token middleware resolves it to this owner on the ingest routes and the
    // user revokes it from the same /api/cli-tokens list.
    router.post('/pair', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const ttlMinutes = clampPairingTtlMinutes(req.body?.ttlMinutes);
        const device = String(req.body?.device ?? '').slice(0, 40).trim();
        try {
            const minted = await (0, cli_token_routes_1.insertCliToken)(ctx.pool, {
                sub, email: callerEmail(req),
                label: device ? `phone pairing: ${device}` : 'phone pairing',
                ttlMs: ttlMinutes * 60 * 1000,
            });
            const origin = requestOrigin(req);
            const apiBase = origin ? `${origin}/api/spaces` : '/api/spaces';
            logger.info({ id: minted.id, sub, ttlMinutes }, 'spaces phone-pairing token minted');
            res.status(201).json({
                pairing: { id: minted.id, token: minted.token, label: minted.label, expiresAt: minted.expiresAt, ttlMinutes },
                ingest: {
                    importUrl: `${apiBase}/scans/import`, videoUrl: `${apiBase}/scans`,
                    method: 'POST', authHeader: 'Authorization', authScheme: 'Bearer',
                    fields: { import: 'model', video: 'video' },
                },
                qr: JSON.stringify({ v: 1, kind: 'oshal-spaces-pairing', api: apiBase, token: minted.token, expiresAt: minted.expiresAt }),
            });
        }
        catch (err) {
            logger.error({ err }, 'spaces phone-pairing mint failed');
            res.status(500).json({ error: 'pairing_mint_failed' });
        }
    });
    router.get('/scans', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json({ scans: await service.listScans(sub) });
        }
        catch (err) {
            logger.error({ err }, 'list scans failed');
            res.status(500).json({ error: 'failed to list scans' });
        }
    });
    router.get('/scans/:id', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const scan = await service.getScan(sub, id);
            if (!scan) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            res.json({ scan });
        }
        catch (err) {
            logger.error({ err, id }, 'get scan failed');
            res.status(500).json({ error: 'failed to load scan' });
        }
    });
    router.get('/scans/:id/artifact', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const artifact = await service.getArtifactPath(sub, id);
            if (!artifact || !fs.existsSync(artifact)) {
                res.status(404).json({ error: 'artifact_not_ready' });
                return;
            }
            streamArtifact(req, res, artifact, id);
        }
        catch (err) {
            logger.error({ err, id }, 'artifact read failed');
            res.status(500).json({ error: 'failed to read artifact' });
        }
    });
    // ADR-111 geometry export — the ACCURATE, exportable model your OWN build consumes (not the
    // viewer-only stream). GET .../geometry downloads the real geometry (the original LiDAR/photo
    // .ply for an import — full-res + metric; the produced .splat for a reconstruction). GET
    // .../dimensions returns the to-scale footprint (metres for a LiDAR import; labelled relative
    // for an un-anchored video/sim). Owner-scoped.
    router.get('/scans/:id/geometry', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const geo = await service.getGeometryPath(sub, id);
            if (!geo || !fs.existsSync(geo.path)) {
                res.status(404).json({ error: 'no_geometry' });
                return;
            }
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${geo.filename}"`);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Spaces-Geometry-Kind', geo.kind);
            const stream = fs.createReadStream(geo.path);
            req.on('close', () => stream.destroy());
            stream.on('error', () => { if (!res.writableEnded)
                res.end(); });
            stream.pipe(res);
        }
        catch (err) {
            logger.error({ err, id }, 'geometry export failed');
            res.status(500).json({ error: 'geometry_export_failed' });
        }
    });
    router.get('/scans/:id/dimensions', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const dimensions = await service.getDimensions(sub, id);
            if (!dimensions) {
                res.status(404).json({ error: 'no_dimensions' });
                return;
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.json({ dimensions });
        }
        catch (err) {
            logger.error({ err, id }, 'dimensions read failed');
            res.status(500).json({ error: 'dimensions_failed' });
        }
    });
    // ADR-111 increment A: the scan's camera poses (poses.json) — owner-scoped; 404 when the
    // scan isn't ready/owned or has no poses (e.g. an imported capture).
    router.get('/scans/:id/poses', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const poses = await service.getPosesPath(sub, id);
            if (!poses || !fs.existsSync(poses)) {
                res.status(404).json({ error: 'no_poses' });
                return;
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.sendFile(poses, (err) => { if (err && !res.headersSent)
                res.status(404).json({ error: 'no_poses' }); });
        }
        catch (err) {
            logger.error({ err, id }, 'poses read failed');
            res.status(500).json({ error: 'failed to read poses' });
        }
    });
    // ADR-111 increment B — RF/router coverage overlay. POST computes it from uploaded RSSI
    // samples ({samples:[...]}) or a no-hardware demo ({demo:true}); GET streams the overlay
    // splat / summary. Owner-scoped; RF is an overlay on the map, never geometry.
    router.post('/scans/:id/rf', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        const demo = req.body?.demo === true;
        const samples = Array.isArray(req.body?.samples) ? req.body.samples : undefined;
        if (!demo && !samples) {
            res.status(400).json({ error: 'provide { samples: [...] } or { demo: true }' });
            return;
        }
        try {
            const result = await rf.computeOverlay(sub, id, { samples, demo });
            if (!result) {
                res.status(404).json({ error: 'not_found_or_not_ready' });
                return;
            }
            res.status(201).json({ result });
        }
        catch (err) {
            // Only EXPECTED input failures echo their message; anything else (fs/DB) is an
            // internal 500 whose raw text (paths, driver errors) must not leave the server.
            if (err instanceof spatial_mapping_1.RfInputError) {
                logger.warn({ err, id }, 'rf overlay compute rejected');
                res.status(400).json({ error: err.message });
                return;
            }
            logger.error({ err, id }, 'rf overlay compute failed');
            res.status(500).json({ error: 'rf_overlay_failed' });
        }
    });
    router.get('/scans/:id/rf/overlay', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const overlay = await rf.getOverlayPath(sub, id);
            if (!overlay || !fs.existsSync(overlay)) {
                res.status(404).json({ error: 'no_overlay' });
                return;
            }
            streamArtifact(req, res, overlay, `${id}-rf`);
        }
        catch (err) {
            logger.error({ err, id }, 'rf overlay read failed');
            res.status(500).json({ error: 'failed to read overlay' });
        }
    });
    router.get('/scans/:id/rf/summary', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const summary = await rf.getSummaryPath(sub, id);
            if (!summary || !fs.existsSync(summary)) {
                res.status(404).json({ error: 'no_summary' });
                return;
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.sendFile(summary, (err) => { if (err && !res.headersSent)
                res.status(404).json({ error: 'no_summary' }); });
        }
        catch (err) {
            logger.error({ err, id }, 'rf summary read failed');
            res.status(500).json({ error: 'failed to read summary' });
        }
    });
    // ADR-111 Phase 2 (first increment) — the step-by-step filming guidance a human
    // follows while capturing ("tells you where to go"). Deterministic per target.
    router.get('/capture-plan', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const raw = String(req.query.target ?? 'room');
        const targets = ['room', 'large-room', 'object', 'facade'];
        const target = targets.includes(raw) ? raw : 'room';
        res.json({ plan: (0, spatial_mapping_1.generateCapturePlan)(target) });
    });
    // ADR-111 live guided capture v1 — the phone-facing HUD page (two arrow channels:
    // WALK vs PAN) and its sensor-telemetry sink. v1 is sensor-driven against the plan;
    // streaming + live pose/coverage feedback are the ladder's next rungs.
    router.get('/capture', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        sendPage(res, captureHtml);
    });
    router.post('/capture-telemetry', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const record = (0, spatial_mapping_1.sanitizeCaptureTelemetry)(req.body);
        if (!record) {
            res.status(400).json({ error: 'invalid_telemetry' });
            return;
        }
        try {
            const file = (0, spatial_mapping_1.captureTelemetryPath)(sub, record.sessionId);
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            const size = await fs.promises.stat(file).then((st) => st.size).catch(() => 0);
            if (size >= spatial_mapping_1.CAPTURE_TELEMETRY_MAX_BYTES) {
                res.status(413).json({ error: 'session_telemetry_full' });
                return;
            }
            await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`);
            res.status(204).end();
        }
        catch (err) {
            logger.error({ err, sessionId: record.sessionId }, 'capture telemetry append failed');
            res.status(500).json({ error: 'telemetry_write_failed' });
        }
    });
    // ADR-111 Phase 3 (sim-first) — a drone flies a mapper-drafted scan orbit and the
    // captures flow the reconstruction pipeline. Sim only; real media stays gated on
    // the MAVLink media follow-up (BACKLOG).
    router.post('/drone-scan', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!(await service.canAcceptScan(sub))) {
            res.status(429).json({ error: 'scan_quota_reached', max: service.maxScansPerUser });
            return;
        }
        const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const title = rawTitle ? rawTitle.slice(0, 120) : 'Drone scan (sim)';
        try {
            const flight = await flySimScanMission();
            const id = (0, crypto_1.randomUUID)();
            const dir = (0, spatial_mapping_1.scanDir)(sub, id);
            await fs.promises.mkdir(dir, { recursive: true });
            const manifest = JSON.stringify(flight, null, 2);
            const manifestPath = path.join(dir, 'drone-mission.json');
            await fs.promises.writeFile(manifestPath, manifest);
            const scan = await service.registerAndStart({
                id, userSub: sub, title, sourceKind: 'sim-mission',
                sourceName: 'drone-mission.json', sourceRef: manifestPath,
                sourceBytes: Buffer.byteLength(manifest),
            });
            res.status(201).json({
                scan,
                mission: {
                    photos: flight.captures.length,
                    waypoints: flight.plan.waypoints.length,
                    rings: flight.pattern.ringCount,
                    perRing: flight.pattern.perRing,
                    virtualFlightS: flight.virtualFlightS,
                },
            });
        }
        catch (err) {
            logger.error({ err }, 'sim drone scan failed');
            res.status(500).json({ error: 'drone_scan_failed' });
        }
    });
    router.delete('/scans/:id', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        try {
            const removed = await service.deleteScan(sub, id);
            if (!removed) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            res.json({ deleted: true });
        }
        catch (err) {
            logger.error({ err, id }, 'delete scan failed');
            res.status(500).json({ error: 'failed to delete scan' });
        }
    });
    // ══════════════════════════════════════════════════════════════════════════
    // SYNC FROM CORE spaces-routes.ts AT INTEGRATION  (region end)
    // ══════════════════════════════════════════════════════════════════════════
    logger.info('Spaces routes registered (surface + viewer + capture + owner-scoped scan API)');
    return router;
}
/** sendFile a pre-resolved surface page with a 404 fallback. */
function sendPage(res, filePath) {
    res.sendFile(filePath, (err) => {
        if (err && !res.headersSent)
            res.status(404).send('Page not found');
    });
}
/** Stream a .splat artifact from disk with backpressure + client-disconnect teardown. */
function streamArtifact(req, res, filePath, id) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(fs.statSync(filePath).size));
    res.setHeader('Content-Disposition', `inline; filename="scan-${id}.splat"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = fs.createReadStream(filePath);
    req.on('close', () => stream.destroy());
    stream.on('error', () => { if (!res.writableEnded)
        res.end(); });
    stream.pipe(res);
}
//# sourceMappingURL=spaces-routes.js.map