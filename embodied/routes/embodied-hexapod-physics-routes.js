"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 lane L2: the spider-18's physics routes on the embodied mount.
 *                     |                             | GET /physics/hexapod/mjcf hands out the model the generator builds
 *                     |                             | from the contract for a jump option; POST /physics/hexapod/check
 *                     |                             | sends that model to the engine container, which stands it, walks
 *                     |                             | it on the tripod gait, walks it inverted through the mirror rule,
 *                     |                             | rolls it over and times the recovery, and jumps it — and the route
 *                     |                             | hands back what was measured beside the contract numbers the model
 *                     |                             | was built from. The check runs without blocking the api; an engine
 *                     |                             | that is down is a 503 naming the install command, as the arm's is.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 integration: the plant and the check load the design's computed masses (buildHexapod) instead of the brief's estimates.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: POST /physics/hexapod/certify {file} sends a training report to the engine's gate with the design's continuous torque (the smallest usable joint torque, never a literal); the engine replays the policy and the gait through the fall and torque limits, rolls a walk policy over, and writes the certificate beside the policy; the route remembers it for the owner and answers the gate's named refusals with their own status.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEXAPOD_CERTIFY_TIMEOUT_MS = exports.HEXAPOD_CHECK_TIMEOUT_MS = exports.HEXAPOD_CHECK_SEEDS = void 0;
exports.continuousTorqueNm = continuousTorqueNm;
exports.registerHexapodPhysicsRoutes = registerHexapodPhysicsRoutes;
const bridge_client_1 = require("./engine/physics/bridge-client");
const hexapod_spec_1 = require("./engine/design/hexapod-spec");
const hexapod_design_1 = require("./engine/design/hexapod-design");
/** The design's computed link masses (ADR-202 brief 1.2: the design's figures supersede the brief's at integration). */
const masses = (0, hexapod_design_1.buildHexapod)('spider-18').masses;
const hexapod_mjcf_1 = require("./engine/physics/hexapod-mjcf");
/** How many seeded resets each measurement may be asked for in one check. */
exports.HEXAPOD_CHECK_SEEDS = { min: 1, max: 5, fallback: 1 };
/** The check simulates about thirty seconds of walking, rolling and jumping per seed: seconds of wall time, not milliseconds. */
exports.HEXAPOD_CHECK_TIMEOUT_MS = 300000;
/** The gate replays the policy and the gait on the evaluation seeds and rolls a walk policy over: tens of seconds of simulation. */
exports.HEXAPOD_CERTIFY_TIMEOUT_MS = 300000;
const FITS = ['spider-18'];
/** @description The fit a query or a body names; `spider-18` when absent. */
function fitOf(value) {
    return (0, hexapod_spec_1.hexapodFitById)(typeof value === 'string' ? value : undefined);
}
/** @description The contract numbers the model was built from, so the answer says what a measurement is measured against. */
function contractView(jump) {
    const p = (0, hexapod_mjcf_1.hexapodPlant)(hexapod_spec_1.SPIDER_18, masses);
    return {
        actuators: hexapod_spec_1.ACTUATOR_ORDER, standHeightM: p.standHeightM, allUpKg: Number(p.allUpKg.toFixed(6)), servo: { rowId: hexapod_spec_1.SPIDER_18.servoRowId, stallNm: p.servo.stallNm, noLoadRadS: p.servo.noLoadRadS },
        jump, spring: jump === 'latched-spring' ? { stiffnessNPerM: p.spring.stiffnessNPerM, strokeM: p.spring.strokeM, storedJ: p.spring.storedJ } : null,
    };
}
/** @description The design's continuous torque: the smallest usable torque over the joint types (one servo row, so one number), what the gate holds an episode's RMS torque to. */
function continuousTorqueNm() {
    return Math.min(...(0, hexapod_design_1.buildHexapod)('spider-18').joints.map((j) => j.usableNm));
}
/** A training report is named `hexapod-<task>…json`, never pathed. */
const REPORT_NAME = /^hexapod-[A-Za-z0-9_.-]+\.json$/;
/** How the gate's own refusals answer: a missing report or policy is 404, a report with nothing to certify 422, a bad request 400; anything else is the engine's 503. */
const CERTIFY_REFUSALS = { report_not_found: 404, policy_not_found: 404, no_policy: 422, bad_task: 422, bad_request: 400 };
/**
 * @description POST /physics/hexapod/certify {file}: the gate, in the container, with the design's limit; the certificate is remembered for the owner.
 * @param router - The package's router. @param deps - Identity, the gate and the failure shape.
 */
function registerHexapodCertifyRoute(router, deps) {
    router.post('/physics/hexapod/certify', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const file = typeof body.file === 'string' ? body.file.trim() : '';
        if (!file) {
            res.status(400).json({ error: 'file_required', message: 'the hexapod training report to certify (from GET /physics/reports)' });
            return;
        }
        if (!REPORT_NAME.test(file)) {
            res.status(400).json({ error: 'bad_file', message: 'a report is named hexapod-<task>…json, never pathed', file });
            return;
        }
        try {
            const certificate = await deps.certifyHexapod({ file, continuousNm: continuousTorqueNm() });
            deps.rememberCertified?.(sub, certificate.policyFile, certificate);
            res.json({ file, policyFile: certificate.policyFile, beatsBaseline: certificate.policyBeatsBaseline, limits: certificate.limits, certification: certificate });
        }
        catch (error) {
            const refusal = error instanceof bridge_client_1.EngineFailure ? error.refusal : undefined;
            const status = refusal ? CERTIFY_REFUSALS[refusal] : undefined;
            if (refusal && status) {
                res.status(status).json({ error: refusal, message: error.reason ?? error.message, file });
                return;
            }
            const failure = deps.physicsFailure(error);
            res.status(failure.status).json(failure.body);
        }
    });
}
/** @description The seeds a body asks for, or null when outside the allowed band. */
function seedsOf(body) {
    const asked = body.seeds === undefined ? exports.HEXAPOD_CHECK_SEEDS.fallback : Number(body.seeds);
    const seeds = Number.isFinite(asked) ? Math.round(asked) : NaN;
    return seeds >= exports.HEXAPOD_CHECK_SEEDS.min && seeds <= exports.HEXAPOD_CHECK_SEEDS.max ? seeds : null;
}
/**
 * @description Mount the spider-18's physics routes on the embodied router.
 * @param router - The package's router. @param deps - Identity, the engine check and the failure shape.
 */
function registerHexapodPhysicsRoutes(router, deps) {
    router.get('/physics/hexapod/mjcf', (req, res) => {
        if (!deps.withSub(req, res))
            return;
        const fit = fitOf(req.query.fit);
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits: FITS });
            return;
        }
        const jump = (0, hexapod_mjcf_1.jumpOptionById)(req.query.jump);
        if (!jump) {
            res.status(400).json({ error: 'unknown_jump', jumps: hexapod_spec_1.SPIDER_18.jumpOptions });
            return;
        }
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send((0, hexapod_mjcf_1.hexapodMjcf)(hexapod_spec_1.SPIDER_18, masses, { jump }));
    });
    router.post('/physics/hexapod/check', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const fit = fitOf(body.fit);
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits: FITS });
            return;
        }
        const jump = (0, hexapod_mjcf_1.jumpOptionById)(body.jump);
        if (!jump) {
            res.status(400).json({ error: 'unknown_jump', jumps: hexapod_spec_1.SPIDER_18.jumpOptions });
            return;
        }
        const seeds = seedsOf(body);
        if (seeds === null) {
            res.status(400).json({ error: 'bad_seeds', message: `seeds must be between ${exports.HEXAPOD_CHECK_SEEDS.min} and ${exports.HEXAPOD_CHECK_SEEDS.max}` });
            return;
        }
        try {
            const report = await deps.checkHexapod({ models: [{ jump, mjcf: (0, hexapod_mjcf_1.hexapodMjcf)(hexapod_spec_1.SPIDER_18, masses, { jump }) }], seeds });
            res.json({ simulated: true, fit, jump, seeds, contract: contractView(jump), report });
        }
        catch (error) {
            const { status, body: failure } = deps.physicsFailure(error);
            res.status(status).json(failure);
        }
    });
    registerHexapodCertifyRoute(router, deps);
}
//# sourceMappingURL=embodied-hexapod-physics-routes.js.map