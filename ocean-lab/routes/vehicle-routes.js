"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the explorer record's routes, mounted under
 *                     |                             | /api/ocean-lab/vehicles inside the package's one requiresAuth
 *                     |                             | mount and owner-scoped inside it: the caller's vehicles with
 *                     |                             | the stage computed on read; the kind with its limit rows, the
 *                     |                             | media and the force-model envelopes; a model held to its
 *                     |                             | envelope in a named medium (422 by name, an undeclared model
 *                     |                             | fails closed); seed the Explorer from the committed fixture
 *                     |                             | (idempotent per name, concept until evaluated); one record
 *                     |                             | with its limits and runs — a run that cannot name its medium
 *                     |                             | and engine is WITHHELD by name (D5); a design-vector change
 *                     |                             | that drops the stage (D2); EVALUATE, which runs the wave
 *                     |                             | engine at the current vector in a chosen medium and records the
 *                     |                             | run (air refused as medium_property_unavailable: freeSurface);
 *                     |                             | RUN INGEST, where another lab's result — the embodied hull drop
 *                     |                             | — is posted AS DATA with its medium id and fingerprints and can
 *                     |                             | never pose as this lab's evaluation; and delete.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the stage is computed with the explorer's parts
 *                     |                             | gate (the parts model at the current vector and its displacement
 *                     |                             | budget against the sizing run), so `parts-complete` is reached
 *                     |                             | or refused by name on every read. Three owner-scoped reads:
 *                     |                             | GET /:id/parts (the parts model, the budget and what keeps it
 *                     |                             | from complete), GET /:id/parts/:partId (one watertight part with
 *                     |                             | its D8 portable object and the exact body to POST to
 *                     |                             | /api/cad-studio/models, the portable object carried in `source`),
 *                     |                             | and GET /:id/design.md (the generated design document).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BODY_BYTES = void 0;
exports.callerSub = callerSub;
exports.createVehicleRoutes = createVehicleRoutes;
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const vehicle_1 = require("./engine/vehicle");
const wave_1 = require("./engine/wave");
const vehicle_store_1 = require("./vehicle-store");
const logger = (0, logger_1.createChildLogger)({ module: 'ocean-lab-vehicle-routes' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The largest design vector or foreign run a person may post, bytes of JSON. */
exports.MAX_BODY_BYTES = 64 * 1024;
/** A vehicle name: printable, no control characters, 1-120 characters. */
const NAME = /^[^\u0000-\u001f\u007f]{1,120}$/;
/** @description The signed-in caller, the way the framework stamps a request (oidc sub or oid, or the trusted service sub). @param req - The request. @returns The sub, or null. */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
/** @description A stored limit row, or the kind's limit it was copied from: a kind limit with no row stays OPEN (fail closed — a deleted row never retires a limit). */
function openLimits(rows) {
    const byId = new Map(rows.map((r) => [r.limit_id, r]));
    return vehicle_1.EXPLORER_KIND.limits.filter((l) => byId.get(l.id)?.status !== 'retired');
}
/** @description A run as the record publishes it, or the reason it is withheld (D5). */
function publishRun(row) {
    const missing = (0, vehicle_1.displayabilityProblems)({ mediumId: row.medium_id, engineFingerprints: row.engine_fingerprints });
    if (missing.length) {
        return { displayable: false, withheld: { runId: row.run_id, sequence: row.sequence, plant: row.plant, missing, because: 'a run result without its medium id and engine fingerprints is not displayed (ADR-160 D5)' } };
    }
    return {
        displayable: true,
        run: { runId: row.run_id, sequence: row.sequence, mediumId: row.medium_id, plant: row.plant, vectorFingerprint: row.vector_fingerprint, engineFingerprints: row.engine_fingerprints, result: row.result, createdAt: row.created_at },
    };
}
/** A stored run in the shape the stage function reads — displayable runs only: a withheld run sizes nothing. */
function runsForStage(rows) {
    return rows
        .filter((row) => (0, vehicle_1.displayabilityProblems)({ mediumId: row.medium_id, engineFingerprints: row.engine_fingerprints }).length === 0)
        .map((row) => ({ sequence: row.sequence, mediumId: row.medium_id, plant: row.plant, vectorFingerprint: row.vector_fingerprint, result: row.result }));
}
/** @description The stage on this read, computed with the explorer's parts gate, and the gate's parts model and budget (unsized when the stage never reached the gate). */
function stageWithParts(row, runs, limits) {
    const held = { gate: null };
    const stage = (0, vehicle_1.stageOf)(vehicle_1.EXPLORER_KIND, row.design_vector, runsForStage(runs), openLimits(limits), (vector, sized) => { held.gate = (0, vehicle_1.explorerPartsGate)(vector, sized); return held.gate; });
    return { stage, gate: held.gate ?? (0, vehicle_1.explorerPartsGate)(row.design_vector, null) };
}
/** @description A vehicle as the record publishes it, with the stage computed on this read. */
function publishVehicle(row, runs, limits) {
    return {
        vehicle: { vehicleId: row.vehicle_id, kind: row.kind, name: row.name, designVector: row.design_vector, provenance: row.provenance, createdAt: row.created_at, updatedAt: row.updated_at },
        stage: stageWithParts(row, runs, limits).stage,
    };
}
/** @description The full record: vehicle, stage, the kind, every limit row and every run split into displayed and withheld. */
async function fullRecord(pool, sub, row) {
    const [runs, limits] = await Promise.all([(0, vehicle_store_1.listRuns)(pool, sub, row.vehicle_id), (0, vehicle_store_1.listLimits)(pool, sub, row.vehicle_id)]);
    const published = runs.map(publishRun);
    return {
        ...publishVehicle(row, runs, limits),
        kind: vehicle_1.EXPLORER_KIND,
        limits: limits.map((l) => ({ id: l.limit_id, sentence: l.sentence, retireWhen: l.retire_when, blocking: l.blocking, status: l.status })),
        runs: published.filter((p) => p.displayable).map((p) => p.run),
        withheld: published.filter((p) => !p.displayable).map((p) => p.withheld),
        fabricable: vehicle_1.FABRICABLE_SENTENCE,
    };
}
/** @description Send a named medium refusal as 422 (or 400 for a medium this lab does not know). @returns True when it was one. */
function sendRefusal(res, error) {
    if (!(error instanceof wave_1.MediumRefusal))
        return false;
    res.status(error.code === 'unknown_medium' ? 400 : 422).json(error.toJSON());
    return true;
}
/** @description The fingerprints an evaluation is stamped with, read at request time and never invented; whatever cannot be read is NAMED in `missing` (D5). */
function engineFingerprints(packageDir) {
    const packageVersion = (0, vehicle_1.readPackageVersion)(packageDir);
    const routesBuildHash = (0, vehicle_1.routesEngineBuildHash)();
    const missing = [...(packageVersion ? [] : ['packageVersion']), ...(routesBuildHash ? [] : ['routesBuildHash'])];
    if (missing.length)
        return { fingerprints: null, missing };
    return { fingerprints: { package: 'ocean-lab', packageVersion, routesBuildHash, engine: { id: wave_1.WAVE_ENGINE.id, version: wave_1.WAVE_ENGINE.version } }, missing };
}
/** @description Is the posted JSON within the byte ceiling? */
function withinBytes(value) {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') <= exports.MAX_BODY_BYTES;
}
/** @description Wrap a handler: the caller (401 without one), the store (503 without one), timing, and the ERROR log a failure owes. */
function guarded(name, deps, handler) {
    return (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!deps.pool) {
            res.status(503).json({ error: 'record_store_unavailable', message: 'the package was mounted without a database pool, so no vehicle can be read or written' });
            return;
        }
        const started = Date.now();
        const pool = deps.pool;
        void handler(req, res, sub, { ...deps, pool }).then(() => logger.info({ route: name, status: res.statusCode, durationMs: Date.now() - started }, 'vehicle route done'), (err) => {
            logger.error({ err, stack: err?.stack, route: name }, 'vehicle route failed');
            if (!res.headersSent)
                res.status(500).json({ error: 'vehicle_route_failed', route: name });
        });
    };
}
/** @description The owner's vehicle by the :id param, or a 404 already sent. */
async function ownedVehicle(req, res, pool, sub) {
    const id = String(req.params.id);
    const row = UUID.test(id) ? await (0, vehicle_store_1.getVehicle)(pool, sub, id) : null;
    if (!row)
        res.status(404).json({ error: 'vehicle_not_found' });
    return row;
}
/** @description GET / — the caller's vehicles with their stage computed on this read. */
const listHandler = async (_req, res, sub, { pool }) => {
    const rows = await (0, vehicle_store_1.listVehicles)(pool, sub);
    const vehicles = [];
    for (const row of rows) {
        const [runs, limits] = await Promise.all([(0, vehicle_store_1.listRuns)(pool, sub, row.vehicle_id), (0, vehicle_store_1.listLimits)(pool, sub, row.vehicle_id)]);
        vehicles.push(publishVehicle(row, runs, limits));
    }
    res.json({ vehicles, stages: vehicle_1.STAGES, fabricable: vehicle_1.FABRICABLE_SENTENCE });
};
/** @description POST /explorer/seed {name?} — the Explorer from the committed seed, with its limit rows. Idempotent per owner and name; `concept` until evaluated. */
const seedHandler = async (req, res, sub, { pool }) => {
    const name = req.body?.name === undefined ? 'Explorer' : String(req.body.name);
    if (!NAME.test(name)) {
        res.status(400).json({ error: 'name must be 1-120 printable characters' });
        return;
    }
    const existing = await (0, vehicle_store_1.findVehicleByName)(pool, sub, vehicle_1.EXPLORER_KIND.id, name);
    if (existing) {
        res.status(200).json({ ...(await fullRecord(pool, sub, existing)), seeded: false });
        return;
    }
    const seed = (0, vehicle_1.explorerSeed)();
    const provenance = { source: 'ocean-lab/src-routes/engine/vehicle/explorer-seed.json', schema: seed.schema, study: seed.study, fields: seed.provenance };
    const row = await (0, vehicle_store_1.insertVehicleWithLimits)(pool, sub, vehicle_1.EXPLORER_KIND.id, name, seed.designVector, provenance, vehicle_1.EXPLORER_KIND.limits);
    res.status(201).json({ ...(await fullRecord(pool, sub, row)), seeded: true });
};
/** @description GET /:id — one record with its stage, limits and runs. */
const getHandler = async (req, res, sub, { pool }) => {
    const row = await ownedVehicle(req, res, pool, sub);
    if (!row)
        return;
    res.json(await fullRecord(pool, sub, row));
};
/** @description PATCH /:id/design {designVector} — replace the authored part. The stage drops to concept until re-evaluated (D2). */
const designHandler = async (req, res, sub, { pool }) => {
    const vector = req.body?.designVector;
    if (!withinBytes(vector)) {
        res.status(413).json({ error: `designVector exceeds ${exports.MAX_BODY_BYTES} bytes` });
        return;
    }
    const problems = (0, vehicle_1.validateExplorerVector)(vector);
    if (problems.length) {
        res.status(400).json({ error: 'invalid_design_vector', problems });
        return;
    }
    const row = await ownedVehicle(req, res, pool, sub);
    if (!row)
        return;
    const updated = await (0, vehicle_store_1.updateDesignVector)(pool, sub, row.vehicle_id, vector);
    if (!updated) {
        res.status(404).json({ error: 'vehicle_not_found' });
        return;
    }
    res.json(await fullRecord(pool, sub, updated));
};
/** @description POST /:id/evaluate {mediumId?} — run the wave engine at the CURRENT vector in the chosen medium and record the run. */
const evaluateHandler = async (req, res, sub, deps) => {
    const row = await ownedVehicle(req, res, deps.pool, sub);
    if (!row)
        return;
    const problems = (0, vehicle_1.validateExplorerVector)(row.design_vector);
    if (problems.length) {
        res.status(409).json({ error: 'stored_vector_invalid', problems });
        return;
    }
    let evaluation;
    try {
        evaluation = (0, vehicle_1.evaluateExplorer)(row.design_vector, (0, wave_1.mediumById)(String(req.body?.mediumId ?? 'seawater').slice(0, 32)));
    }
    catch (error) {
        if (sendRefusal(res, error)) {
            logger.info({ refusal: error.refusal }, 'evaluation refused by name');
            return;
        }
        throw error;
    }
    const engine = engineFingerprints(deps.packageDir);
    if (!engine.fingerprints) {
        logger.error({ missing: engine.missing }, 'evaluate refused — the package cannot name its engine, so no run is recorded (ADR-160 D5)');
        res.status(503).json({ error: 'run_unfingerprinted', missing: engine.missing, message: 'this package cannot name its own version or engine tree, so the run would carry no engine fingerprint; nothing is recorded rather than a result nothing may display (ADR-160 D5)' });
        return;
    }
    const result = { schema: vehicle_1.RUN_RESULT_SCHEMA, ...evaluation, engine: engine.fingerprints };
    const run = await (0, vehicle_store_1.insertRun)(deps.pool, sub, row.vehicle_id, { mediumId: evaluation.medium.id, plant: vehicle_1.EVALUATION_PLANT, vectorFingerprint: (0, vehicle_1.designVectorFingerprint)(row.design_vector), engineFingerprints: engine.fingerprints, result });
    res.status(201).json({ ...(await fullRecord(deps.pool, sub, row)), recorded: publishRun(run) });
};
/** @description The plant a foreign run names, `<package>:<plant kind>`, or null when it names none. */
function foreignPlant(run) {
    const engine = (run.engine ?? {});
    const pkg = typeof engine.package === 'string' ? engine.package : '';
    const kind = typeof engine.plant?.kind === 'string' ? engine.plant.kind : 'unnamed';
    const plant = `${pkg}:${kind}`;
    return /^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,30}$/.test(plant) ? plant : null;
}
/** @description POST /:id/runs {run} — record another lab's run AS DATA (never an import): it must carry the run-result schema, its medium id and its engine fingerprints, and it can never pose as this lab's own evaluation. */
const ingestHandler = async (req, res, sub, { pool }) => {
    const run = req.body?.run;
    if (!run || typeof run !== 'object' || Array.isArray(run)) {
        res.status(400).json({ error: 'run (the other lab\'s run result, as posted) is required' });
        return;
    }
    if (!withinBytes(run)) {
        res.status(413).json({ error: `run exceeds ${exports.MAX_BODY_BYTES} bytes` });
        return;
    }
    const r = run;
    const missing = (0, vehicle_1.displayabilityProblems)({ mediumId: r.medium?.id, engineFingerprints: r.engine });
    if (r.schema !== vehicle_1.RUN_RESULT_SCHEMA)
        missing.unshift('schema');
    const plant = foreignPlant(r);
    if (!plant)
        missing.push('engine.package');
    if (missing.length) {
        res.status(422).json({ error: 'run_not_displayable', missing, because: 'a run result without its schema, medium id and engine fingerprints is not recorded, because it could not be displayed (ADR-160 D5)' });
        return;
    }
    if (plant.startsWith('ocean-lab:')) {
        res.status(422).json({ error: 'run_poses_as_evaluation', because: 'only this lab\'s own evaluate route records ocean-lab runs; an ingested run is another lab\'s and cannot size the record' });
        return;
    }
    const row = await ownedVehicle(req, res, pool, sub);
    if (!row)
        return;
    const stored = await (0, vehicle_store_1.insertRun)(pool, sub, row.vehicle_id, { mediumId: r.medium.id, plant: plant, vectorFingerprint: (0, vehicle_1.designVectorFingerprint)(row.design_vector), engineFingerprints: r.engine, result: r });
    res.status(201).json({ ...(await fullRecord(pool, sub, row)), recorded: publishRun(stored) });
};
/** @description DELETE /:id — the vehicle, its limits and its runs. */
const deleteHandler = async (req, res, sub, { pool }) => {
    const id = String(req.params.id);
    if (!UUID.test(id) || !(await (0, vehicle_store_1.deleteVehicle)(pool, sub, id))) {
        res.status(404).json({ error: 'vehicle_not_found' });
        return;
    }
    res.status(204).end();
};
/** @description A printed or bought row as the parts listing publishes it: the program summarised, the portable object left to the part route. */
function partSummary(p) {
    const { geometry, portableObject, ...rest } = p;
    return { ...rest, program: geometry ? (0, vehicle_1.describeProgram)(geometry.program) : null, attachmentPoints: portableObject ? portableObject.attachmentFrame.points.map((pt) => pt.name) : [], forceModel: portableObject ? portableObject.forceModel : null, opensInCadStudio: Boolean(geometry) };
}
/** @description The record's parts gate on this read; a 409 is already sent when the stored vector no longer derives a parts model. */
async function ownedGate(req, res, pool, sub) {
    const row = await ownedVehicle(req, res, pool, sub);
    if (!row)
        return null;
    const [runs, limits] = await Promise.all([(0, vehicle_store_1.listRuns)(pool, sub, row.vehicle_id), (0, vehicle_store_1.listLimits)(pool, sub, row.vehicle_id)]);
    const { stage, gate } = stageWithParts(row, runs, limits);
    if (!gate.parts) {
        res.status(409).json({ error: 'stored_vector_invalid', problems: gate.problems });
        return null;
    }
    return { row, stage, gate, parts: gate.parts };
}
/** @description GET /:id/parts — the parts model at the current vector, the displacement budget, and what keeps the stage from parts-complete. */
const partsHandler = async (req, res, sub, { pool }) => {
    const owned = await ownedGate(req, res, pool, sub);
    if (!owned)
        return;
    const { parts } = owned;
    res.json({
        vehicleId: owned.row.vehicle_id, stage: owned.stage, fabricable: vehicle_1.FABRICABLE_SENTENCE, engine: parts.engine, vectorFingerprint: parts.vectorFingerprint,
        watertightParts: parts.watertightParts, printed: parts.printed.map(partSummary), bought: parts.bought.map(partSummary), problems: parts.problems, budget: owned.gate.budget, fabrication: parts.fabrication,
    });
};
/** @description The exact body to POST to /api/cad-studio/models for one part: its program, the print density, and the portable object in `source`. */
function cadStudioBody(row, part, densityGcm3) {
    const geometry = part.geometry;
    const material = part.make === 'printed' ? part.material : null;
    return {
        title: `${part.name} — ${row.name}`, base: geometry.program.base, features: geometry.program.features,
        ...(part.make === 'printed' ? { settings: { densityGcm3 } } : {}),
        source: { package: 'ocean-lab', kind: vehicle_1.EXPLORER_KIND.id, vehicleId: row.vehicle_id, partId: part.id, qty: part.qty, material, portableObject: part.portableObject },
    };
}
/** @description GET /:id/parts/:partId — one watertight part with its portable object and the exact body to POST to /api/cad-studio/models. */
const partHandler = async (req, res, sub, { pool }) => {
    const owned = await ownedGate(req, res, pool, sub);
    if (!owned)
        return;
    const { parts } = owned;
    const bodies = [...parts.printed, ...parts.bought].filter((p) => p.geometry && p.portableObject);
    const part = bodies.find((p) => p.id === String(req.params.partId));
    if (!part) {
        res.status(404).json({ error: 'unknown_part', parts: bodies.map((p) => p.id) });
        return;
    }
    res.json({ vehicleId: owned.row.vehicle_id, part: { ...partSummary(part), portableObject: part.portableObject }, fabricable: vehicle_1.FABRICABLE_SENTENCE, cadStudio: cadStudioBody(owned.row, part, parts.fabrication.densityGcm3) });
};
/** @description GET /:id/design.md — the design document generated from the parts model at the current vector. */
const designDocHandler = async (req, res, sub, { pool }) => {
    const owned = await ownedGate(req, res, pool, sub);
    if (!owned)
        return;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send((0, vehicle_1.explorerDesignMarkdown)({ name: owned.row.name, vehicleId: owned.row.vehicle_id, stage: owned.stage, parts: owned.parts, budget: owned.gate.budget }));
};
/** @description GET /kinds — the kind with its limit rows, the media, the envelopes and the committed seed. */
function kindsBody() {
    const seed = (0, vehicle_1.explorerSeed)();
    return {
        kinds: [vehicle_1.EXPLORER_KIND], stages: vehicle_1.STAGES, fabricable: vehicle_1.FABRICABLE_SENTENCE, evaluationPlant: vehicle_1.EVALUATION_PLANT,
        media: (0, wave_1.listMedia)().map((m) => ({ id: m.id, label: m.label, densityKgM3: m.densityKgM3, dynamicViscosityPaS: m.dynamicViscosityPaS, freeSurface: m.freeSurface, validity: m.validity })),
        forceModels: { schema: wave_1.FORCE_MODEL_ENVELOPES_SCHEMA, mediaKnown: wave_1.MEDIA_KNOWN, models: (0, wave_1.listEnvelopes)(), undeclared: 'fails closed: valid in the default medium only, refused by name elsewhere' },
        seed: { name: seed.name, designVector: seed.designVector, provenance: seed.provenance, study: seed.study },
    };
}
/**
 * @description Build the /vehicles router. Auth is the manifest's `requiresAuth: true` on the package's
 * one mount; every handler additionally reads the caller and 401s without one, and every query is
 * owner-scoped on top of the migration's FORCEd owner RLS.
 * @param deps - The framework pool (null when mounted without one) and the package directory.
 * @returns The router.
 */
function createVehicleRoutes(deps) {
    const d = { pool: deps.pool ?? null, packageDir: deps.packageDir ?? process.env.OSHAL_APP_PACKAGE_DIR ?? node_path_1.default.resolve(__dirname, '..') };
    const router = (0, express_1.Router)();
    router.get('/', guarded('GET /vehicles', d, listHandler));
    router.get('/kinds', (req, res) => { if (!callerSub(req)) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    } res.json(kindsBody()); });
    router.get('/force-models/:model/in/:medium', (req, res) => {
        if (!callerSub(req)) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const model = String(req.params.model).slice(0, 64);
        try {
            res.json({ model, medium: req.params.medium, valid: true, envelope: (0, wave_1.requireModelValidIn)(model, (0, wave_1.mediumById)(String(req.params.medium).slice(0, 32))) });
        }
        catch (error) {
            if (sendRefusal(res, error))
                return;
            logger.error({ err: error, stack: error.stack }, 'force-model check failed');
            res.status(500).json({ error: 'force-model check failed' });
        }
    });
    router.post('/explorer/seed', guarded('POST /vehicles/explorer/seed', d, seedHandler));
    router.get('/:id', guarded('GET /vehicles/:id', d, getHandler));
    router.get('/:id/parts', guarded('GET /vehicles/:id/parts', d, partsHandler));
    router.get('/:id/parts/:partId', guarded('GET /vehicles/:id/parts/:partId', d, partHandler));
    router.get('/:id/design.md', guarded('GET /vehicles/:id/design.md', d, designDocHandler));
    router.patch('/:id/design', guarded('PATCH /vehicles/:id/design', d, designHandler));
    router.post('/:id/evaluate', guarded('POST /vehicles/:id/evaluate', d, evaluateHandler));
    router.post('/:id/runs', guarded('POST /vehicles/:id/runs', d, ingestHandler));
    router.delete('/:id', guarded('DELETE /vehicles/:id', d, deleteHandler));
    return router;
}
