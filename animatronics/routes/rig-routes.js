"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rig API the surface, the concierge's
 *                     |                             | tools and any MCP client drive: rigs (from a template or from
 *                     |                             | numbers; list, read, change, delete), the pose and scenario
 *                     |                             | libraries (one entry per call, deletion refused while
 *                     |                             | referenced), REHEARSE (compile + rate-limited servo sim +
 *                     |                             | supply budget → report and frames, no side effect but the
 *                     |                             | log), the authority rail — ARM needs `confirm: true` (428
 *                     |                             | without) and a supply the budget accepts; PLAY, LOOK-AT and
 *                     |                             | JOG answer 409 until armed; DISARM is always allowed and is
 *                     |                             | the e-stop — and the command log. Every answer that moves the
 *                     |                             | prop carries the exact protocol lines the browser streams to
 *                     |                             | the controller, so the server, not the page, owns the pulses.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The capability manifest is built from the OWNER's vocabulary
 *                     |                             | row (core BACKLOG 2026-09-14), so it is null on a box where
 *                     |                             | that package is not installed: a rig still lists, rehearses,
 *                     |                             | arms and plays — only the enrolment document, which describes
 *                     |                             | a vocabulary this package does not own, is absent, and
 *                     |                             | GET /rigs/:id/manifest says so with 503 rather than answering
 *                     |                             | with a locally invented row.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stallOf = stallOf;
exports.publicRig = publicRig;
exports.rehearsalFor = rehearsalFor;
exports.armLines = armLines;
exports.createRigRoutes = createRigRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const rig_contract_1 = require("./engine/rig-contract");
const scenario_1 = require("./engine/scenario");
const compile_1 = require("./engine/compile");
const servo_sim_1 = require("./engine/servo-sim");
const power_1 = require("./engine/power");
const look_at_1 = require("./engine/look-at");
const protocol_1 = require("./engine/protocol");
const templates_1 = require("./engine/templates");
const kind_1 = require("./engine/kind");
const rig_store_1 = require("./rig-store");
const logger = (0, logger_1.createChildLogger)({ module: 'animatronics-rig-routes' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function refuse(res, error) {
    if (error instanceof rig_contract_1.ContractError) {
        res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message });
        return true;
    }
    if (error instanceof RangeError) {
        res.status(400).json({ error: 'invalid_id', message: error.message });
        return true;
    }
    return false;
}
function requireUuid(value) {
    const text = String(value ?? '').toLowerCase();
    if (!UUID.test(text))
        throw new RangeError('Expected a UUID');
    return text;
}
function behaviourId(value, field) {
    if (typeof value !== 'string' || !scenario_1.BEHAVIOUR_ID.test(value))
        throw new rig_contract_1.ContractError(`${field} must be an upper-case name like LOOK_LEFT`, field);
    return value;
}
function title(value, fallback) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return text || fallback;
}
const lib = (row) => ({ poses: row.poses, scenarios: row.scenarios });
/** @description The strongest servo's stall torque on a rig, from the catalog. */
function stallOf(rig, catalog) {
    return rig.channels.reduce((m, c) => Math.max(m, catalog.get(c.model)?.stallKgCm ?? 0), 0);
}
/** @description The rig as the API returns it (axis keys and the capability manifest attached). */
function publicRig(row, catalog) {
    return { ...row, axes: [...(0, rig_contract_1.axisMap)(row.rig).keys()], manifest: (0, kind_1.capabilityManifestFor)(`prop-${row.rig_id.slice(0, 8)}`, row.rig, stallOf(row.rig, catalog)) };
}
/**
 * @description Compile, rehearse and budget one set of steps from a start pose.
 * @param row - The rig row.
 * @param catalog - Servo rows.
 * @param steps - Validated steps.
 * @param start - The pose the stream starts from.
 * @returns The bundle.
 */
function rehearsalFor(row, catalog, steps, start) {
    const compiled = (0, compile_1.compileSteps)(row.rig, lib(row), steps, start);
    const sim = (0, servo_sim_1.rehearse)(row.rig, compiled);
    const power = (0, power_1.budgetPower)(row.rig, catalog, compiled);
    const ok = sim.verdict.ok && power.verdict !== 'refuse';
    const reasons = [...sim.verdict.reasons, ...power.reasons];
    const summary = ok ? `ok — ${compiled.durationMs} ms, ${compiled.angles.length} frames, peak ${power.peakMovingA} A of ${row.rig.supply.amps} A` : `refused — ${reasons[0] ?? 'see reasons'}`;
    const report = { durationMs: compiled.durationMs, frames: compiled.angles.length, channels: sim.channels, power, end: compiled.end, verdict: { ok, followed: sim.verdict.followed, settled: sim.verdict.settled, power: power.verdict, reasons, summary } };
    const frames = { frameMs: compiled.frameMs, channelIds: compiled.channelIds, outputs: compiled.outputs, axisIndex: compiled.axisIndex, angles: compiled.angles, pulses: compiled.pulses, actual: sim.actual };
    return { compiled, sim, power, report, frames };
}
/** Steps from a request body: a scenario name, inline steps, a pose, or axes. */
function stepsFrom(body, row) {
    if (body.scenario !== undefined) {
        const name = behaviourId(body.scenario, 'scenario');
        if (!row.scenarios[name])
            throw new rig_contract_1.ContractError(`scenario ${name} is not in this rig's library`, 'scenario');
        return { steps: [{ kind: 'run', scenario: name }], scenario: name };
    }
    if (body.steps !== undefined)
        return { steps: (0, scenario_1.validateScenario)({ steps: body.steps }, row.rig, lib(row), 'steps').steps, scenario: null };
    const ms = body.ms === undefined ? 400 : Number(body.ms);
    if (body.pose !== undefined) {
        const name = behaviourId(body.pose, 'pose');
        if (!row.poses[name])
            throw new rig_contract_1.ContractError(`pose ${name} is not in this rig's library`, 'pose');
        return { steps: (0, scenario_1.validateScenario)({ steps: [{ kind: 'move', pose: name, ms }] }, row.rig, lib(row), 'pose').steps, scenario: null };
    }
    if (body.axes !== undefined)
        return { steps: (0, scenario_1.validateScenario)({ steps: [{ kind: 'move', axes: body.axes, ms }] }, row.rig, lib(row), 'axes').steps, scenario: null };
    throw new rig_contract_1.ContractError('give a scenario, steps, a pose or axes', 'scenario');
}
/** The lines that bring a controller up: hello, every channel's clamps, the neutral frame. */
function armLines(rig, pose) {
    const compiled = (0, compile_1.compileSteps)(rig, { poses: {}, scenarios: {} }, [], pose);
    return [(0, protocol_1.encodeHello)(), ...rig.channels.map((c) => (0, protocol_1.encodeLimits)(c.channel, c.minUs, c.maxUs)), (0, protocol_1.encodeFrame)(0, rig.channels.map((c, i) => [c.channel, compiled.pulses[0][i]]))];
}
/**
 * @description Build the rig router (mounted under the package's oidc mount).
 * @param deps - Pool, caller resolver, catalog, templates.
 * @returns The router.
 */
function createRigRoutes(deps) {
    const router = (0, express_1.Router)();
    const pub = (row) => publicRig(row, deps.catalog);
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        req.propSub = sub;
        next();
    });
    router.param('rigId', async (req, res, next, value) => {
        try {
            const row = await (0, rig_store_1.getRig)(deps.pool, req.propSub, requireUuid(value));
            if (!row) {
                res.status(404).json({ error: 'rig_not_found' });
                return;
            }
            req.propRig = row;
            next();
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Load rig failed');
                res.status(500).json({ error: 'load_failed' });
            }
        }
    });
    async function save(req, patch) {
        const row = req.propRig;
        return (await (0, rig_store_1.updateRig)(deps.pool, req.propSub, row.rig_id, patch)) ?? row;
    }
    async function log(req, kind, scenario, report, frames) {
        return (0, rig_store_1.recordRun)(deps.pool, req.propSub, req.propRig.rig_id, { kind, scenario, report, frames });
    }
    function requireArmed(req, res) {
        if (req.propRig.armed)
            return true;
        res.status(409).json({ error: 'rig_not_armed', message: 'arm the rig (with the controller connected) before moving it' });
        return false;
    }
    router.get('/rigs', async (req, res) => {
        try {
            res.json({ rigs: (await (0, rig_store_1.listRigs)(deps.pool, req.propSub)).map(pub) });
        }
        catch (error) {
            logger.error({ err: error }, 'List rigs failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.post('/rigs', async (req, res) => {
        const body = (req.body ?? {});
        try {
            const template = body.template === undefined ? null : (0, templates_1.findTemplate)(deps.templates, body.template);
            if (body.template !== undefined && !template)
                throw new rig_contract_1.ContractError(`unknown template ${JSON.stringify(body.template)}`, 'template');
            if (!template && body.rig === undefined)
                throw new rig_contract_1.ContractError('give a template or a rig', 'rig');
            const rig = body.rig === undefined ? template.rig : (0, rig_contract_1.validateRig)(body.rig);
            const poses = (0, scenario_1.validatePoses)(body.poses ?? template?.poses ?? {}, rig);
            const scenarios = (0, scenario_1.validateScenarios)(body.scenarios ?? template?.scenarios ?? {}, rig, poses);
            const row = await (0, rig_store_1.createRig)(deps.pool, req.propSub, { title: title(body.title, template?.title ?? 'Untitled rig'), rig, poses, scenarios, currentPose: (0, compile_1.neutralPose)(rig), source: template ? { kind: 'template', template: template.id } : {} });
            res.status(201).json({ rig: pub(row), power: (0, power_1.budgetPower)(rig, deps.catalog) });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Create rig failed');
                res.status(500).json({ error: 'create_failed' });
            }
        }
    });
    router.get('/rigs/:rigId', async (req, res) => {
        const row = req.propRig;
        try {
            res.json({ rig: pub(row), runs: await (0, rig_store_1.listRuns)(deps.pool, req.propSub, row.rig_id), power: (0, power_1.budgetPower)(row.rig, deps.catalog) });
        }
        catch (error) {
            logger.error({ err: error, rigId: row.rig_id }, 'Read rig failed');
            res.status(500).json({ error: 'read_failed' });
        }
    });
    router.patch('/rigs/:rigId', async (req, res) => {
        const row = req.propRig;
        const body = (req.body ?? {});
        try {
            const rig = body.rig === undefined ? row.rig : (0, rig_contract_1.validateRig)(body.rig);
            const poses = (0, scenario_1.validatePoses)(body.poses ?? row.poses, rig);
            const scenarios = (0, scenario_1.validateScenarios)(body.scenarios ?? row.scenarios, rig, poses);
            const patch = { poses, scenarios };
            if (body.title !== undefined)
                patch.title = title(body.title, row.title);
            if (body.rig !== undefined) {
                patch.rig = rig;
                patch.armed = false;
                patch.currentPose = (0, compile_1.neutralPose)(rig);
            }
            const saved = await save(req, patch);
            res.json({ rig: pub(saved), power: (0, power_1.budgetPower)(saved.rig, deps.catalog), disarmed: body.rig !== undefined && row.armed });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Update rig failed');
                res.status(500).json({ error: 'update_failed' });
            }
        }
    });
    router.delete('/rigs/:rigId', async (req, res) => {
        const row = req.propRig;
        try {
            await (0, rig_store_1.deleteRig)(deps.pool, req.propSub, row.rig_id);
            res.json({ deleted: row.rig_id });
        }
        catch (error) {
            logger.error({ err: error, rigId: row.rig_id }, 'Delete rig failed');
            res.status(500).json({ error: 'delete_failed' });
        }
    });
    router.put('/rigs/:rigId/poses/:poseId', async (req, res) => {
        const row = req.propRig;
        const body = (req.body ?? {});
        try {
            const name = behaviourId(req.params.poseId, 'poseId');
            const pose = (0, scenario_1.validatePose)(body.axes ?? body, row.rig, `poses.${name}`);
            const saved = await save(req, { poses: { ...row.poses, [name]: pose } });
            res.json({ rig: pub(saved), pose: { [name]: pose } });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Set pose failed');
                res.status(500).json({ error: 'pose_failed' });
            }
        }
    });
    router.delete('/rigs/:rigId/poses/:poseId', async (req, res) => {
        const row = req.propRig;
        try {
            const name = behaviourId(req.params.poseId, 'poseId');
            if (!row.poses[name]) {
                res.status(404).json({ error: 'pose_not_found' });
                return;
            }
            const poses = { ...row.poses };
            delete poses[name];
            try {
                (0, scenario_1.validateScenarios)(row.scenarios, row.rig, poses);
            }
            catch (error) {
                if (error instanceof rig_contract_1.ContractError) {
                    res.status(409).json({ error: 'pose_in_use', field: error.field, message: error.message });
                    return;
                }
                throw error;
            }
            res.json({ rig: pub(await save(req, { poses })), deleted: name });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Delete pose failed');
                res.status(500).json({ error: 'pose_failed' });
            }
        }
    });
    router.put('/rigs/:rigId/scenarios/:scenarioId', async (req, res) => {
        const row = req.propRig;
        const body = (req.body ?? {});
        try {
            const name = behaviourId(req.params.scenarioId, 'scenarioId');
            const candidate = { ...row.scenarios, [name]: { steps: [] } };
            const scenario = (0, scenario_1.validateScenario)({ steps: body.steps, ...(body.description !== undefined ? { description: body.description } : {}) }, row.rig, { poses: row.poses, scenarios: candidate }, `scenarios.${name}`);
            candidate[name] = scenario;
            for (const each of Object.keys(candidate))
                (0, scenario_1.assertAcyclic)(each, candidate, [], `scenarios.${each}`);
            const saved = await save(req, { scenarios: candidate });
            res.json({ rig: pub(saved), scenario: { [name]: scenario } });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Set scenario failed');
                res.status(500).json({ error: 'scenario_failed' });
            }
        }
    });
    router.delete('/rigs/:rigId/scenarios/:scenarioId', async (req, res) => {
        const row = req.propRig;
        try {
            const name = behaviourId(req.params.scenarioId, 'scenarioId');
            if (!row.scenarios[name]) {
                res.status(404).json({ error: 'scenario_not_found' });
                return;
            }
            const scenarios = { ...row.scenarios };
            delete scenarios[name];
            try {
                (0, scenario_1.validateScenarios)(scenarios, row.rig, row.poses);
            }
            catch (error) {
                if (error instanceof rig_contract_1.ContractError) {
                    res.status(409).json({ error: 'scenario_in_use', field: error.field, message: error.message });
                    return;
                }
                throw error;
            }
            res.json({ rig: pub(await save(req, { scenarios })), deleted: name });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Delete scenario failed');
                res.status(500).json({ error: 'scenario_failed' });
            }
        }
    });
    router.post('/rigs/:rigId/rehearse', async (req, res) => {
        const row = req.propRig;
        const body = (req.body ?? {});
        try {
            const { steps, scenario } = stepsFrom(body, row);
            const start = body.start === undefined ? row.current_pose : (0, scenario_1.validatePose)(body.start, row.rig, 'start');
            const bundle = rehearsalFor(row, deps.catalog, steps, start);
            const run = await log(req, 'rehearse', scenario, bundle.report, bundle.compiled.angles.length);
            await save(req, { lastReport: bundle.report });
            res.json({ run, report: bundle.report, frames: bundle.frames, lines: (0, protocol_1.frameLines)(bundle.compiled.outputs, bundle.compiled.pulses) });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Rehearse failed');
                res.status(500).json({ error: 'rehearse_failed' });
            }
        }
    });
    router.post('/rigs/:rigId/arm', async (req, res) => {
        const row = req.propRig;
        try {
            if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
                res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('animatronics-arm', 'arm the rig and let frames reach the controller'));
                return;
            }
            const power = (0, power_1.budgetPower)(row.rig, deps.catalog);
            if (power.verdict === 'refuse') {
                res.status(422).json({ error: 'supply_refused', power });
                return;
            }
            const pose = (0, compile_1.neutralPose)(row.rig);
            const saved = await save(req, { armed: true, currentPose: pose });
            await log(req, 'arm', null, { power, pose }, 1);
            res.json({ rig: pub(saved), power, lines: armLines(saved.rig, pose) });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Arm failed');
                res.status(500).json({ error: 'arm_failed' });
            }
        }
    });
    router.post('/rigs/:rigId/disarm', async (req, res) => {
        const row = req.propRig;
        try {
            const saved = await save(req, { armed: false });
            await log(req, 'disarm', null, { reason: String(req.body?.reason ?? 'operator').slice(0, 200) }, 0);
            res.json({ rig: pub(saved), lines: [(0, protocol_1.encodeEstop)()] });
        }
        catch (error) {
            logger.error({ err: error, rigId: row.rig_id }, 'Disarm failed');
            res.status(500).json({ error: 'disarm_failed' });
        }
    });
    async function drive(req, res, kind, steps, scenario, extra = {}) {
        const row = req.propRig;
        const bundle = rehearsalFor(row, deps.catalog, steps, row.current_pose);
        if (bundle.power.verdict === 'refuse') {
            await log(req, kind, scenario, { ...bundle.report, refused: true }, 0);
            res.status(422).json({ error: `${kind}_refused`, report: bundle.report });
            return;
        }
        const saved = await save(req, { currentPose: bundle.compiled.end, lastReport: bundle.report });
        const run = await log(req, kind, scenario, bundle.report, bundle.compiled.angles.length);
        res.json({ run, rig: pub(saved), report: bundle.report, frames: bundle.frames, lines: (0, protocol_1.frameLines)(bundle.compiled.outputs, bundle.compiled.pulses, run * 100_000), ...extra });
    }
    router.post('/rigs/:rigId/play', async (req, res) => {
        const row = req.propRig;
        try {
            if (!requireArmed(req, res))
                return;
            const { steps, scenario } = stepsFrom((req.body ?? {}), row);
            await drive(req, res, 'play', steps, scenario);
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Play failed');
                res.status(500).json({ error: 'play_failed' });
            }
        }
    });
    router.post('/rigs/:rigId/look-at', async (req, res) => {
        const row = req.propRig;
        const body = (req.body ?? {});
        try {
            const la = (0, look_at_1.lookAt)(row.rig, { azDeg: Number(body.azDeg), elDeg: Number(body.elDeg ?? 0) }, { eyeShare: body.eyeShare === undefined ? undefined : Number(body.eyeShare), eyeMs: body.eyeMs === undefined ? undefined : Number(body.eyeMs), neckMs: body.neckMs === undefined ? undefined : Number(body.neckMs) });
            const extra = { lookAt: { pose: la.pose, residualDeg: la.residualDeg, reachable: la.reachable, used: la.used } };
            if (body.rehearse === true) {
                const bundle = rehearsalFor(row, deps.catalog, la.steps, row.current_pose);
                const run = await log(req, 'rehearse', null, { ...bundle.report, lookAt: extra.lookAt }, bundle.compiled.angles.length);
                res.json({ run, report: bundle.report, frames: bundle.frames, lines: (0, protocol_1.frameLines)(bundle.compiled.outputs, bundle.compiled.pulses), ...extra });
                return;
            }
            if (!requireArmed(req, res))
                return;
            await drive(req, res, 'look-at', la.steps, null, extra);
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Look-at failed');
                res.status(500).json({ error: 'look_at_failed' });
            }
        }
    });
    router.post('/rigs/:rigId/jog', async (req, res) => {
        const row = req.propRig;
        const body = (req.body ?? {});
        try {
            if (!requireArmed(req, res))
                return;
            const ms = body.ms === undefined ? 120 : Number(body.ms);
            const steps = (0, scenario_1.validateScenario)({ steps: [{ kind: 'move', axes: body.axes, ms, ease: 'out' }] }, row.rig, lib(row), 'axes').steps;
            await drive(req, res, 'jog', steps, null);
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, rigId: row.rig_id }, 'Jog failed');
                res.status(500).json({ error: 'jog_failed' });
            }
        }
    });
    router.get('/rigs/:rigId/runs', async (req, res) => {
        const row = req.propRig;
        try {
            res.json({ runs: await (0, rig_store_1.listRuns)(deps.pool, req.propSub, row.rig_id) });
        }
        catch (error) {
            logger.error({ err: error, rigId: row.rig_id }, 'List runs failed');
            res.status(500).json({ error: 'runs_failed' });
        }
    });
    router.get('/rigs/:rigId/manifest', (req, res) => {
        const row = req.propRig;
        const vocabulary = (0, kind_1.loadPropVocabulary)();
        if (!vocabulary.ok) {
            logger.warn({ rigId: row.rig_id, reason: vocabulary.reason }, 'No capability manifest: the prop vocabulary owner is not installed');
            res.status(503).json({ error: 'vocabulary_unavailable', owner: kind_1.PROP_VOCABULARY_OWNER, message: vocabulary.reason });
            return;
        }
        res.json({ manifest: (0, kind_1.capabilityManifestFor)(`prop-${row.rig_id.slice(0, 8)}`, row.rig, stallOf(row.rig, deps.catalog)) });
    });
    return router;
}
