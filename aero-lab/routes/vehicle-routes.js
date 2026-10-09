"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S4 — the vehicle record's routes, mounted at
 *                     |                             | /api/aero-lab/vehicles behind the manifest's requiresAuth and
 *                     |                             | owner-scoped inside: list the caller's vehicles with their
 *                     |                             | stage computed on read; the kinds with their limit rows and
 *                     |                             | the force models' declared envelopes; a model held to its
 *                     |                             | envelope in a named medium (422 by name, an undeclared model
 *                     |                             | fails closed); seed the Floater from the committed reference
 *                     |                             | design as vehicle + evaluation 1 (idempotent); one record with
 *                     |                             | its stage, budget check and evaluations — an evaluation that
 *                     |                             | cannot name its medium and engine is WITHHELD by name, never
 *                     |                             | listed as a result (D5); and a design-vector change, after
 *                     |                             | which the stage reads concept until re-evaluated (D2).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | D5 closed at the seed. The manifest version is a REAL
 *                     |                             | version or null — never the placeholder 'unknown', which
 *                     |                             | was being persisted as evaluation 1's fingerprint and
 *                     |                             | then listed; the engine hash is taken over a non-empty
 *                     |                             | vendored tree or is null (a hash over zero files names no
 *                     |                             | engine); POST /floater/seed answers 503 run_unfingerprinted
 *                     |                             | naming what is missing and inserts nothing, the refusal
 *                     |                             | embodied makes for the same condition. publishEvaluation
 *                     |                             | withholds a stored row whose fingerprint is not a real
 *                     |                             | version and a 64-hex engine hash.
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
exports.callerSub = callerSub;
exports.createAeroVehicleRoutes = createAeroVehicleRoutes;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const engine_build_hash_1 = require("./engine-build-hash");
const floater_record_1 = require("./floater-record");
const force_model_envelopes_1 = require("./force-model-envelopes");
const vehicle_store_1 = require("./vehicle-store");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-lab-vehicle-routes' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The largest design vector a person may post, bytes of JSON. */
const MAX_VECTOR_BYTES = 64 * 1024;
/** @description The signed-in caller, the way the framework stamps a request (oidc sub or oid, or the trusted service sub). @param req - The request. @returns The sub, or null. */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
/** A real version string, the shape a manifest's `version:` carries: semver core with an optional pre-release or build tag. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** A sha256 in hex — the only shape an engine build hash takes. */
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** The one plain top-level scalar a package may read of its own manifest without a YAML runtime: a REAL version, or null. Never a placeholder — a placeholder would be persisted as a fingerprint (D5). */
function manifestVersion(packageDir) {
    try {
        const source = fs.readFileSync(path.join(packageDir, 'oshal-app.yaml'), 'utf8');
        const match = /^version:\s*([^#\r\n]+)/m.exec(source);
        const version = String(match?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
        if (VERSION.test(version))
            return version;
        logger.error({ packageDir, version: version || null }, 'package manifest carries no real version — no evaluation can be fingerprinted (ADR-160 D5)');
        return null;
    }
    catch (err) {
        logger.error({ err, stack: err.stack, packageDir }, 'package manifest unreadable — no evaluation can be fingerprinted (ADR-160 D5)');
        return null;
    }
}
/** The vendored engine tree's build hash, or null when there is no tree to hash: a hash over zero files names no engine. */
function engineTreeHash(engineDir) {
    try {
        if ((0, engine_build_hash_1.engineBuildFiles)(engineDir).length === 0) {
            logger.error({ engineDir }, 'engine tree absent or empty — no evaluation can be fingerprinted (ADR-160 D5)');
            return null;
        }
        return (0, engine_build_hash_1.engineBuildHash)(engineDir);
    }
    catch (err) {
        logger.error({ err, stack: err.stack, engineDir }, 'engine tree unreadable — no evaluation can be fingerprinted (ADR-160 D5)');
        return null;
    }
}
/** @description What the seed stamps on evaluation 1, read at request time and never invented. Whatever cannot be read is NAMED in `missing`, and the seed then produces nothing (D5). */
function engineSnapshot(packageDir) {
    const packageVersion = manifestVersion(packageDir);
    const hash = engineTreeHash(path.join(packageDir, 'engine'));
    const missing = [...(packageVersion ? [] : ['packageVersion']), ...(hash ? [] : ['engineBuildHash'])];
    return { snapshot: packageVersion && hash ? { packageVersion, engineBuildHash: hash } : null, missing };
}
/** @description An evaluation as the record publishes it, or the reason it is withheld (D5). A fingerprint that is not a real version and a real engine hash is no fingerprint. */
function publishEvaluation(row) {
    const missing = [];
    if (!row.medium_id)
        missing.push('mediumId');
    const fp = row.engine_fingerprints ?? {};
    if (typeof fp.packageVersion !== 'string' || !VERSION.test(fp.packageVersion))
        missing.push('engineFingerprints.packageVersion');
    if (typeof fp.engineBuildHash !== 'string' || !SHA256_HEX.test(fp.engineBuildHash))
        missing.push('engineFingerprints.engineBuildHash');
    if (typeof fp.generator !== 'string' || !fp.generator)
        missing.push('engineFingerprints.generator');
    if (missing.length) {
        return { displayable: false, withheld: { evaluationId: row.evaluation_id, sequence: row.sequence, missing, because: 'a run result without its medium id and engine fingerprints is not displayed (ADR-160 D5)' } };
    }
    return {
        displayable: true,
        evaluation: { evaluationId: row.evaluation_id, sequence: row.sequence, mediumId: row.medium_id, vectorFingerprint: row.vector_fingerprint, engineFingerprints: row.engine_fingerprints, result: row.result, createdAt: row.created_at },
    };
}
/** A stored evaluation in the shape the stage function reads. */
const asEvaluationLike = (row) => ({ sequence: row.sequence, mediumId: row.medium_id, vectorFingerprint: row.vector_fingerprint, result: row.result });
/** @description A vehicle as the record publishes it, with the stage computed on this read. */
function publishVehicle(row, evaluations) {
    const stage = (0, floater_record_1.stageOf)(floater_record_1.FLOATER_KIND, row.design_vector, evaluations.map(asEvaluationLike));
    return {
        vehicle: { vehicleId: row.vehicle_id, kind: row.kind, name: row.name, designVector: row.design_vector, provenance: row.provenance, createdAt: row.created_at, updatedAt: row.updated_at },
        stage,
    };
}
/** @description Send a named medium refusal as 422 (or 400 for a medium this lab does not know). */
function sendRefusal(res, error) {
    if (!(error instanceof force_model_envelopes_1.MediumRefusal))
        return false;
    res.status(error.code === 'unknown_medium' ? 400 : 422).json(error.toJSON());
    return true;
}
/**
 * @description Build the /api/aero-lab/vehicles router. Accepts either the bare AppContext (how the
 * manifest mounter invokes a factory with requiresContext) or a {ctx} wrapper. Auth is the manifest's
 * `requiresAuth: true` on the whole mount; every handler additionally reads the caller and 401s
 * without one, and every query is owner-scoped on top of the migration's FORCEd owner RLS.
 * @param arg - The AppContext, or {ctx}.
 * @returns The router.
 */
function createAeroVehicleRoutes(arg) {
    const ctx = ('ctx' in arg && arg.ctx && typeof arg.ctx === 'object' && 'pool' in arg.ctx ? arg.ctx : arg);
    const pool = ctx.pool;
    const packageDir = ctx.appPackageDir ?? process.env.OSHAL_APP_PACKAGE_DIR ?? path.resolve(__dirname, '..');
    const router = (0, express_1.Router)();
    const withSub = (req, res) => {
        const sub = callerSub(req);
        if (!sub)
            res.status(401).json({ error: 'not_authenticated' });
        return sub;
    };
    router.get('/', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const started = Date.now();
        void (async () => {
            try {
                const rows = await (0, vehicle_store_1.listVehicles)(pool, sub);
                const vehicles = [];
                for (const row of rows)
                    vehicles.push(publishVehicle(row, await (0, vehicle_store_1.listEvaluations)(pool, sub, row.vehicle_id)));
                logger.info({ count: vehicles.length, durationMs: Date.now() - started }, 'GET /vehicles done');
                res.json({ vehicles, stages: floater_record_1.STAGES, fabricable: floater_record_1.FABRICABLE_SENTENCE });
            }
            catch (err) {
                logger.error({ err, stack: err.stack }, 'GET /vehicles failed');
                res.status(500).json({ error: 'vehicles unavailable' });
            }
        })();
    });
    router.get('/kinds', (req, res) => {
        if (!withSub(req, res))
            return;
        res.json({ kinds: [floater_record_1.FLOATER_KIND], stages: floater_record_1.STAGES, fabricable: floater_record_1.FABRICABLE_SENTENCE, forceModels: { schema: force_model_envelopes_1.FORCE_MODEL_ENVELOPES_SCHEMA, mediaKnown: force_model_envelopes_1.MEDIA_KNOWN, models: (0, force_model_envelopes_1.listEnvelopes)(), undeclared: 'fails closed: valid in the default medium only, refused by name elsewhere' } });
    });
    /** GET /force-models/:model/in/:medium — the envelope check, by name. An undeclared model fails closed. */
    router.get('/force-models/:model/in/:medium', (req, res) => {
        if (!withSub(req, res))
            return;
        const model = String(req.params.model).slice(0, 64);
        const medium = String(req.params.medium).slice(0, 32);
        try {
            const envelope = (0, force_model_envelopes_1.requireModelValidIn)(model, medium);
            res.json({ model, medium, valid: true, envelope });
        }
        catch (error) {
            if (sendRefusal(res, error)) {
                logger.info({ model, medium, refusal: error.refusal }, 'force model refused by name');
                return;
            }
            logger.error({ err: error, stack: error.stack }, 'force-model check failed');
            res.status(500).json({ error: 'force-model check failed' });
        }
    });
    /** POST /floater/seed — the Floater from the committed reference design: the vehicle and evaluation 1. Idempotent per owner. */
    router.post('/floater/seed', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const started = Date.now();
        void (async () => {
            try {
                const existing = await (0, vehicle_store_1.findVehicleByName)(pool, sub, floater_record_1.FLOATER_KIND.id, 'Floater');
                if (existing) {
                    const evaluations = await (0, vehicle_store_1.listEvaluations)(pool, sub, existing.vehicle_id);
                    res.status(200).json({ ...publishVehicle(existing, evaluations), evaluations: evaluations.map(publishEvaluation), seeded: false });
                    return;
                }
                const engine = engineSnapshot(packageDir);
                if (!engine.snapshot) {
                    logger.error({ missing: engine.missing, durationMs: Date.now() - started }, 'POST /vehicles/floater/seed refused — the package cannot name its engine, so no evaluation is produced (ADR-160 D5)');
                    res.status(503).json({ error: 'run_unfingerprinted', missing: engine.missing, message: 'this package cannot name its own version or engine tree, so evaluation 1 would carry no engine fingerprint; nothing is seeded rather than a result nothing may display (ADR-160 D5)' });
                    return;
                }
                const ref = (0, floater_record_1.loadReferenceDesign)(packageDir);
                const seed = (0, floater_record_1.floaterSeed)(ref);
                const vehicle = await (0, vehicle_store_1.insertVehicle)(pool, sub, seed.kind, seed.name, seed.designVector, seed.provenance);
                const draft = (0, floater_record_1.firstEvaluation)(ref, seed, engine.snapshot);
                const evaluation = await (0, vehicle_store_1.insertEvaluation)(pool, sub, vehicle.vehicle_id, { ...draft, engineFingerprints: { ...draft.engineFingerprints } });
                logger.info({ vehicleId: vehicle.vehicle_id, budget: draft.result.budget.status, durationMs: Date.now() - started }, 'POST /vehicles/floater/seed done');
                res.status(201).json({ ...publishVehicle(vehicle, [evaluation]), evaluations: [publishEvaluation(evaluation)], seeded: true });
            }
            catch (err) {
                logger.error({ err, stack: err.stack }, 'POST /vehicles/floater/seed failed');
                res.status(500).json({ error: 'the Floater could not be seeded from the reference design', reason: err.message });
            }
        })();
    });
    router.get('/:id', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!UUID.test(id)) {
            res.status(404).json({ error: 'vehicle_not_found' });
            return;
        }
        void (async () => {
            try {
                const row = await (0, vehicle_store_1.getVehicle)(pool, sub, id);
                if (!row) {
                    res.status(404).json({ error: 'vehicle_not_found' });
                    return;
                }
                const evaluations = await (0, vehicle_store_1.listEvaluations)(pool, sub, id);
                const published = evaluations.map(publishEvaluation);
                res.json({
                    ...publishVehicle(row, evaluations),
                    kind: floater_record_1.FLOATER_KIND,
                    evaluations: published.filter((e) => e.displayable).map((e) => e.evaluation),
                    withheld: published.filter((e) => !e.displayable).map((e) => e.withheld),
                });
            }
            catch (err) {
                logger.error({ err, stack: err.stack, id }, 'GET /vehicles/:id failed');
                res.status(500).json({ error: 'vehicle unavailable' });
            }
        })();
    });
    /** PATCH /:id/design {designVector} — replace the authored part. The stage drops to concept until re-evaluated (D2). */
    router.patch('/:id/design', (req, res) => {
        const sub = withSub(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!UUID.test(id)) {
            res.status(404).json({ error: 'vehicle_not_found' });
            return;
        }
        const vector = (req.body || {}).designVector;
        if (!vector || typeof vector !== 'object' || Array.isArray(vector) || Object.keys(vector).length === 0) {
            res.status(400).json({ error: 'designVector (non-empty object) is required' });
            return;
        }
        if (Buffer.byteLength(JSON.stringify(vector), 'utf8') > MAX_VECTOR_BYTES) {
            res.status(413).json({ error: `designVector exceeds ${MAX_VECTOR_BYTES} bytes` });
            return;
        }
        void (async () => {
            try {
                const row = await (0, vehicle_store_1.updateDesignVector)(pool, sub, id, vector);
                if (!row) {
                    res.status(404).json({ error: 'vehicle_not_found' });
                    return;
                }
                const evaluations = await (0, vehicle_store_1.listEvaluations)(pool, sub, id);
                logger.info({ id }, 'PATCH /vehicles/:id/design done — the stage recomputes on the next read');
                res.json(publishVehicle(row, evaluations));
            }
            catch (err) {
                logger.error({ err, stack: err.stack, id }, 'PATCH /vehicles/:id/design failed');
                res.status(500).json({ error: 'design vector not updated' });
            }
        })();
    });
    return router;
}
