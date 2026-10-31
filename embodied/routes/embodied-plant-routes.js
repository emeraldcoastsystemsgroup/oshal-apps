"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the routes for a plant generated from a
 *                     |                             | design (engine/embodied_plant.py), for any machine. POST
 *                     |                             | /physics/plant/load builds the plant in the engine container from
 *                     |                             | a design-studio plant spec (the medium's gravity is filled from
 *                     |                             | the air row here, never typed); GET /physics/plant/state reads
 *                     |                             | the owner's plant; POST /physics/plant/train scores the PD
 *                     |                             | baseline now (timesteps 0) or starts a PPO run the engine
 *                     |                             | reports as a job (GET /physics/plant/train lists the jobs and the
 *                     |                             | default length); POST /physics/plant/certify runs the gate and
 *                     |                             | remembers the certificate for the owner. GET /build/catalog
 *                     |                             | publishes this package's owned motor and servo rows with the
 *                     |                             | numbers a drive is built from (stall torque, no-load speed, the
 *                     |                             | continuous rating the joint sizing uses). The engine's named
 *                     |                             | refusals answer with their own status; an engine that is down is
 *                     |                             | the tile's 503. The plant ops are serialized on one queue: the
 *                     |                             | bridge takes one request at a time, and a page reads the state,
 *                     |                             | the jobs and the reports together.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANT_TRAIN_MAX_TIMESTEPS = exports.PLANT_TRAIN_DEFAULT_TIMESTEPS = exports.PLANT_CERTIFY_TIMEOUT_MS = exports.PLANT_TRAIN_TIMEOUT_MS = exports.PLANT_LOAD_TIMEOUT_MS = void 0;
exports.plantSession = plantSession;
exports.engineSpec = engineSpec;
exports.driveCatalog = driveCatalog;
exports.serialized = serialized;
exports.registerPlantPhysicsRoutes = registerPlantPhysicsRoutes;
const parts_catalog_json_1 = __importDefault(require("./engine/design/parts-catalog.json"));
const parts_catalog_1 = require("./engine/design/parts-catalog");
const servos_1 = require("./engine/design/servos");
const medium_1 = require("./engine/medium/medium");
const bridge_client_1 = require("./engine/physics/bridge-client");
/** The engine builds a small model in milliseconds; a mesh part is seconds. */
exports.PLANT_LOAD_TIMEOUT_MS = 60000;
/** The baseline scores five episodes of the brief's time: seconds. A PPO run is a job and answers at once. */
exports.PLANT_TRAIN_TIMEOUT_MS = 120000;
/** The gate replays the policy and the baseline on the evaluation seeds: seconds. */
exports.PLANT_CERTIFY_TIMEOUT_MS = 300000;
/** How long a run the Simulate poster's Train the policy starts when the body names no length: about four minutes on the box's CPU for the lift (the 2048-step smoke ran at 235 steps/s). */
exports.PLANT_TRAIN_DEFAULT_TIMESTEPS = 60000;
/** The longest run a route starts: the hexapod's winning recipe ran a million steps. */
exports.PLANT_TRAIN_MAX_TIMESTEPS = 2000000;
/** A project id as design-studio mints it (a UUID) or a short example id. */
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A plant report is named plant-<project>-reach-seed<S>.json, never pathed. */
const REPORT_NAME = /^plant-[A-Za-z0-9_.-]+\.json$/;
/** How the engine's own refusals answer. */
const PLANT_REFUSALS = { bad_spec: 400, unknown_part: 400, bad_task: 400, bad_targets: 400, bad_request: 400, cycle: 422, no_payload: 422, no_policy: 422, spec_mismatch: 422, mesh_missing: 422, no_session: 404, report_not_found: 404, policy_not_found: 404, policy_not_certified: 409, busy: 409 };
/** @description The session a plant lives in: one per owner and product, so two people's lifts never share a model. */
function plantSession(sub, project) {
    return `plant:${project}:${sub}`;
}
/** @description The spec as the engine takes it: the body's, named by the project, with the air row's gravity when the caller stated no medium. */
function engineSpec(project, spec) {
    const air = (0, medium_1.mediumById)('air');
    const medium = spec.medium && typeof spec.medium === 'object' ? spec.medium : { id: air.id, gravityMps2: air.gravityMps2 };
    return { ...spec, name: project, medium };
}
/** A project id from a body or a query, or null. */
function projectOf(value) {
    return typeof value === 'string' && PROJECT_ID.test(value.trim()) ? value.trim() : null;
}
/** A spec from a body: an object with the four lists the engine validates further, or null. */
function specOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const s = value;
    return Array.isArray(s.parts) && Array.isArray(s.joints) && Array.isArray(s.actuators) && typeof s.base === 'string' ? s : null;
}
/** Answer the engine's named refusal with its status, or the tile's 503. */
function answerFailure(res, error, deps, extra = {}) {
    const refusal = error instanceof bridge_client_1.EngineFailure ? error.refusal : undefined;
    const status = refusal ? PLANT_REFUSALS[refusal] : undefined;
    if (refusal && status) {
        res.status(status).json({ error: refusal, message: error.reason ?? error.message, ...extra });
        return;
    }
    const failure = deps.physicsFailure(error);
    res.status(failure.status).json(failure.body);
}
/** @description This package's owned drive rows as a plant is built from them: every servo row's stall torque, no-load speed and the continuous rating the joint sizing holds it to (CONTINUOUS_FRACTION of the stall, the bench fraction servos.ts states), every motor row's KV. Mass, price and the source line ride along. */
function driveCatalog() {
    const data = parts_catalog_json_1.default;
    const servos = data.servos.map((r) => {
        const s = (0, servos_1.servoSpecFrom)((0, parts_catalog_1.servoRow)(r.id));
        return { id: s.id, name: s.name, kind: 'bus-servo', stallNm: s.stallNm, noLoadRadS: s.noLoadRadS, noLoadRpm: (s.noLoadRadS * 60) / (2 * Math.PI), continuousNm: s.stallNm * servos_1.CONTINUOUS_FRACTION, massG: s.massG, approxUsd: s.approxUsdEach, encoder: s.encoder, source: s.source };
    });
    const motors = data.motors.map((r) => { const m = (0, parts_catalog_1.motorRow)(r.id); return { id: m.id, name: m.name, kind: 'brushless', kv: m.propulsion.kv, stallNm: null, noLoadRadS: null, continuousNm: null, massG: m.massG, approxUsd: m.approxUsd, source: m.source, note: 'a propulsion row: KV only, no stall torque or continuous rating is published, so it cannot drive a joint' }; });
    return { servos, motors, continuousFraction: servos_1.CONTINUOUS_FRACTION, source: 'routes/engine/design/parts-catalog.json (ADR-152 D1); the continuous rating is servos.ts CONTINUOUS_FRACTION of the rated stall, the bench fraction the row\'s source cites' };
}
/** POST /physics/plant/load and GET /physics/plant/state. */
function registerLoadAndState(router, deps) {
    router.post('/physics/plant/load', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const project = projectOf(body.project);
        const spec = specOf(body.spec);
        if (!project) {
            res.status(400).json({ error: 'bad_project', message: 'project is the product id the plant is built for' });
            return;
        }
        if (!spec) {
            res.status(400).json({ error: 'bad_spec', message: 'spec is the plant spec: {parts, base, joints, actuators, payload?}' });
            return;
        }
        try {
            const info = await deps.plantOp('plant.load', { session: plantSession(sub, project), spec: engineSpec(project, spec), seed: 0 }, exports.PLANT_LOAD_TIMEOUT_MS);
            res.json({ built: true, project, route: '/api/embodied/physics/plant', plant: info });
        }
        catch (error) {
            answerFailure(res, error, deps, { project });
        }
    });
    router.get('/physics/plant/state', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const project = projectOf(req.query.project);
        if (!project) {
            res.status(400).json({ error: 'bad_project', message: 'project names the product' });
            return;
        }
        try {
            const state = await deps.plantOp('plant.state', { session: plantSession(sub, project) }, exports.PLANT_LOAD_TIMEOUT_MS);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ built: true, project, route: '/api/embodied/physics/plant', state });
        }
        catch (error) {
            if (error instanceof bridge_client_1.EngineFailure && error.refusal === 'no_session') {
                res.status(404).json({ error: 'plant_not_built', built: false, project, message: 'no plant is built for this product in the engine: POST /physics/plant/load first' });
                return;
            }
            answerFailure(res, error, deps, { project });
        }
    });
}
/** POST and GET /physics/plant/train. */
function registerTrain(router, deps) {
    router.post('/physics/plant/train', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const project = projectOf(body.project);
        const spec = specOf(body.spec);
        if (!project) {
            res.status(400).json({ error: 'bad_project', message: 'project is the product id the report is named by' });
            return;
        }
        if (!spec) {
            res.status(400).json({ error: 'bad_spec', message: 'spec is the plant spec the task runs on' });
            return;
        }
        if (!body.task || typeof body.task !== 'object') {
            res.status(400).json({ error: 'bad_task', message: 'task is {deltaM | posM, timeS, loadKg?}: the brief\'s numbers' });
            return;
        }
        const asked = body.timesteps === undefined ? 0 : Number(body.timesteps);
        if (!Number.isInteger(asked) || asked < 0 || asked > exports.PLANT_TRAIN_MAX_TIMESTEPS) {
            res.status(400).json({ error: 'bad_timesteps', message: `timesteps is 0 (the baseline only) to ${exports.PLANT_TRAIN_MAX_TIMESTEPS}` });
            return;
        }
        const seed = body.seed === undefined ? 0 : Number(body.seed);
        if (!Number.isInteger(seed) || seed < 0) {
            res.status(400).json({ error: 'bad_seed' });
            return;
        }
        const payload = { project, spec: engineSpec(project, spec), task: body.task, timesteps: asked, seed };
        if (Array.isArray(body.seeds) && body.seeds.length)
            payload.seeds = body.seeds;
        try {
            const out = await deps.plantOp('plant.train', payload, exports.PLANT_TRAIN_TIMEOUT_MS);
            res.json(asked > 0 ? { started: true, project, job: out } : { started: false, project, report: out });
        }
        catch (error) {
            answerFailure(res, error, deps, { project });
        }
    });
    router.get('/physics/plant/train', async (req, res) => {
        if (!deps.withSub(req, res))
            return;
        try {
            const out = await deps.plantOp('plant.jobs', {}, exports.PLANT_LOAD_TIMEOUT_MS);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ ...out, defaults: { timesteps: exports.PLANT_TRAIN_DEFAULT_TIMESTEPS, maxTimesteps: exports.PLANT_TRAIN_MAX_TIMESTEPS } });
        }
        catch (error) {
            answerFailure(res, error, deps);
        }
    });
}
/** POST /physics/plant/certify. */
function registerCertify(router, deps) {
    router.post('/physics/plant/certify', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const file = typeof body.file === 'string' ? body.file.trim() : '';
        if (!file) {
            res.status(400).json({ error: 'file_required', message: 'the plant training report to certify (from GET /physics/reports)' });
            return;
        }
        if (!REPORT_NAME.test(file)) {
            res.status(400).json({ error: 'bad_file', message: 'a report is named plant-<project>-reach-seed<S>.json, never pathed', file });
            return;
        }
        const payload = { file };
        const spec = specOf(body.spec);
        if (spec)
            payload.spec = engineSpec(projectOf(body.project) ?? 'plant', spec);
        if (Array.isArray(body.seeds) && body.seeds.length)
            payload.seeds = body.seeds;
        try {
            const certificate = await deps.plantOp('plant.certify', payload, exports.PLANT_CERTIFY_TIMEOUT_MS);
            deps.rememberCertified?.(sub, certificate.policyFile, certificate);
            res.json({ file, policyFile: certificate.policyFile, beatsBaseline: certificate.policyBeatsBaseline, limits: certificate.limits, certification: certificate });
        }
        catch (error) {
            answerFailure(res, error, deps, { file });
        }
    });
}
/**
 * @description One request after another on the engine: the bridge answers one request at a time and refuses a second as
 * busy, while a page reads the plant's state, the jobs and the reports together, so the plant ops queue here.
 * @param op - The engine op. @returns The same op, serialized.
 */
function serialized(op) {
    let tail = Promise.resolve();
    return (name, payload, timeoutMs) => {
        const run = tail.then(() => op(name, payload, timeoutMs));
        tail = run.catch(() => undefined);
        return run;
    };
}
/**
 * @description Mount the generic plant's routes and the drive catalog on the embodied router.
 * @param router - The package's router. @param deps - Identity, the engine op and the failure shape.
 */
function registerPlantPhysicsRoutes(router, deps) {
    const queued = { ...deps, plantOp: serialized(deps.plantOp) };
    router.get('/build/catalog', (req, res) => {
        if (!deps.withSub(req, res))
            return;
        res.setHeader('Cache-Control', 'no-store');
        res.json(driveCatalog());
    });
    registerLoadAndState(router, queued);
    registerTrain(router, queued);
    registerCertify(router, queued);
}
//# sourceMappingURL=embodied-plant-routes.js.map