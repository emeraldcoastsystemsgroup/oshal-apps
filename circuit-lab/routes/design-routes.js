"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The breadboard: POST /board lays one out from the schematic,
 *                     |                             | PUT /board takes an edited one and derives the schematic's
 *                     |                             | electrical wires from it (then solves), DELETE /board drops
 *                     |                             | it; every wire-changing route keeps a saved board's jumpers
 *                     |                             | in step, so board and schematic always imply the same nets.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Restore a run's circuit (undo to any kept run, solved as a
 *                     |                             | new run) and the gear-to-CAD-Studio hand-off (the exact body
 *                     |                             | for POST /api/cad-studio/models from a gear's numbers).
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the design API the surface, the concierge's
 *                     |                             | tools and any MCP client all drive: designs (create from
 *                     |                             | numbers or an example, list, read, rename, delete), the
 *                     |                             | circuit (replace whole; add / change / remove a part; add /
 *                     |                             | remove a wire), run (solve with the stored or given transient
 *                     |                             | settings), the run history and its artifacts (waveforms,
 *                     |                             | deck, report). Every write validates against the contract
 *                     |                             | first and then solves through the engine, answering with the
 *                     |                             | design, the run's report AND the outcome so an iterating
 *                     |                             | caller sees a refused circuit or a stalled engine in the
 *                     |                             | same reply.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicDesign = publicDesign;
exports.createDesignRoutes = createDesignRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const board_bridge_1 = require("./board-bridge");
const circuit_contract_1 = require("./circuit-contract");
const data_dir_1 = require("./data-dir");
const design_store_1 = require("./design-store");
const examples_1 = require("./examples");
const gear_profile_1 = require("./gear-profile");
const simulate_service_1 = require("./simulate-service");
const logger = (0, logger_1.createChildLogger)({ module: 'circuit-lab-design-routes' });
const BASE = '/api/circuit-lab';
const CONTRACT = (0, circuit_contract_1.describeContract)();
/** @description The design as the API returns it (artifact URLs for the last run). */
function publicDesign(design) {
    const artifacts = design.run_count > 0 ? Object.fromEntries(['waveforms', 'netlist', 'report'].map((k) => [k, `${BASE}/designs/${design.design_id}/runs/${design.run_count}/artifacts/${k}`])) : {};
    return { ...design, artifacts };
}
function refuse(res, error) {
    if (error instanceof circuit_contract_1.ContractError) {
        res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message });
        return true;
    }
    if (error instanceof RangeError) {
        res.status(400).json({ error: 'invalid_id', message: error.message });
        return true;
    }
    const board = (0, board_bridge_1.boardFailure)(error);
    if (board) {
        res.status(400).json({ error: 'invalid_input', field: board.field, message: board.message });
        return true;
    }
    return false;
}
/** A saved board follows every schematic change: placements kept, jumpers regenerated from the new nets. */
function boardFor(design, parts, wires) {
    if (!design.board)
        return undefined;
    return board_bridge_1.boardModel.reconcileBoard(design.board, parts, wires, CONTRACT);
}
function answer(res, built, extra = {}, okStatus = 200) {
    res.status(built.build.ok ? okStatus : (0, simulate_service_1.buildStatus)(built.build)).json({ design: publicDesign(built.design), run: built.report ? { run: built.design.run_count, report: built.report } : null, build: built.build, ...extra });
}
function title(value, fallback) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return text || fallback;
}
const wantsRun = (body, fallback) => (typeof body.run === 'boolean' ? body.run : fallback);
/** Strip the routing ids tool calls carry so the rest of the body is the part / wire. */
function payload(body, key) {
    if (body[key] && typeof body[key] === 'object')
        return body[key];
    const { designId: _d, partId: _p, wireId: _w, run: _r, ...rest } = body;
    return rest;
}
/** A fresh id of the form <prefix><n> not used by the list. */
function mintId(prefix, taken) {
    const used = new Set(taken.map((t) => t.id.toLowerCase()));
    for (let n = 1; n < 10_000; n += 1)
        if (!used.has(`${prefix}${n}`.toLowerCase()))
            return `${prefix}${n}`;
    return `${prefix}${Date.now()}`;
}
const PREFIX = { ground: 'GND', junction: 'J', battery: 'B', source: 'V', resistor: 'R', potentiometer: 'P', capacitor: 'C', inductor: 'L', diode: 'D', led: 'D', switch: 'S', npn: 'Q', nmos: 'Q', motor: 'M', gear: 'G', load: 'W', zener: 'Z', lamp: 'LP', regulator: 'U', opamp: 'A', relay: 'K', sequencer: 'SQ', hbridge: 'H', timer555: 'U', servo: 'SV', stepper: 'ST', stepdriver: 'U', spring: 'K', pulley: 'PL', crank: 'CR', arduino: 'MCU' };
/**
 * @description Build the design router (mounted under the package's oidc mount).
 * @param deps - Pool, engine, data root, caller resolver.
 * @returns The router.
 */
function createDesignRoutes(deps) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        req.labSub = sub;
        next();
    });
    router.param('designId', async (req, res, next, value) => {
        try {
            const design = await (0, design_store_1.getDesign)(deps.pool, req.labSub, (0, data_dir_1.requireUuid)(value));
            if (!design) {
                res.status(404).json({ error: 'design_not_found' });
                return;
            }
            req.labDesign = design;
            next();
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Load design failed');
                res.status(500).json({ error: 'load_failed' });
            }
        }
    });
    /** Solve when asked (and there is something to solve); otherwise answer with the row as saved. */
    async function maybeRun(design, run) {
        if (!run || design.parts.length === 0)
            return { design, report: null, build: { ok: true, ms: 0 } };
        return (0, simulate_service_1.simulateDesign)(deps, design);
    }
    /** Persist a new circuit (a saved board follows it), then solve on request. */
    async function applyCircuit(req, res, patch, run, extra = {}) {
        const design = req.labDesign;
        const board = patch.board !== undefined ? patch.board : boardFor(design, patch.parts ?? design.parts, patch.wires ?? design.wires);
        const updated = (await (0, design_store_1.updateDesign)(deps.pool, req.labSub, design.design_id, board === undefined ? patch : { ...patch, board })) ?? design;
        answer(res, await maybeRun(updated, run), extra);
    }
    router.get('/designs', async (req, res) => {
        try {
            res.json({ designs: (await (0, design_store_1.listDesigns)(deps.pool, req.labSub)).map(publicDesign) });
        }
        catch (error) {
            logger.error({ err: error }, 'List designs failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.post('/designs', async (req, res) => {
        const body = (req.body ?? {});
        try {
            const example = body.example === undefined ? null : (0, examples_1.findExample)(body.example);
            if (body.example !== undefined && !example)
                throw new circuit_contract_1.ContractError(`unknown example ${JSON.stringify(body.example)}`, 'example');
            const circuit = (0, circuit_contract_1.validateCircuit)({ parts: body.parts ?? example?.parts ?? [], wires: body.wires ?? example?.wires ?? [] });
            const sim = (0, circuit_contract_1.validateSim)(body.sim ?? example?.sim ?? {});
            const source = example ? { kind: 'example', example: example.id } : {};
            const stored = await (0, design_store_1.createDesign)(deps.pool, req.labSub, { title: title(body.title, example?.title ?? 'Untitled circuit'), ...circuit, sim, source });
            answer(res, await maybeRun(stored, wantsRun(body, true)), {}, 201);
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Create design failed');
                res.status(500).json({ error: 'create_failed' });
            }
        }
    });
    router.get('/designs/:designId', async (req, res) => {
        const design = req.labDesign;
        try {
            res.json({ design: publicDesign(design), runs: await (0, design_store_1.listRuns)(deps.pool, req.labSub, design.design_id), engine: deps.engine.status() });
        }
        catch (error) {
            logger.error({ err: error, designId: design.design_id }, 'Read design failed');
            res.status(500).json({ error: 'read_failed' });
        }
    });
    router.patch('/designs/:designId', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            const patch = {};
            if (body.title !== undefined)
                patch.title = title(body.title, design.title);
            if (body.sim !== undefined)
                patch.sim = (0, circuit_contract_1.validateSim)({ ...design.sim, ...(body.sim && typeof body.sim === 'object' ? body.sim : {}) });
            const updated = (await (0, design_store_1.updateDesign)(deps.pool, req.labSub, design.design_id, patch)) ?? design;
            answer(res, await maybeRun(updated, wantsRun(body, false)));
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Update design failed');
                res.status(500).json({ error: 'update_failed' });
            }
        }
    });
    router.delete('/designs/:designId', async (req, res) => {
        const design = req.labDesign;
        try {
            await (0, design_store_1.deleteDesign)(deps.pool, req.labSub, design.design_id);
            node_fs_1.default.rmSync((0, data_dir_1.designDir)(deps.dataRoot, req.labSub, design.design_id), { recursive: true, force: true });
            res.json({ deleted: design.design_id });
        }
        catch (error) {
            logger.error({ err: error, designId: design.design_id }, 'Delete design failed');
            res.status(500).json({ error: 'delete_failed' });
        }
    });
    router.put('/designs/:designId/circuit', async (req, res) => {
        const body = (req.body ?? {});
        try {
            await applyCircuit(req, res, (0, circuit_contract_1.validateCircuit)({ parts: body.parts, wires: body.wires }), wantsRun(body, false));
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Replace circuit failed');
                res.status(500).json({ error: 'circuit_failed' });
            }
        }
    });
    router.post('/designs/:designId/parts', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            const raw = payload(body, 'part');
            const type = typeof raw.type === 'string' ? raw.type : '';
            const part = (0, circuit_contract_1.validatePart)({ ...raw, id: raw.id ?? mintId(PREFIX[type] ?? 'X', design.parts) }, 'part');
            if (design.parts.some((p) => p.id.toLowerCase() === part.id.toLowerCase()))
                throw new circuit_contract_1.ContractError(`part id ${part.id} already exists`, 'part.id');
            await applyCircuit(req, res, { parts: [...design.parts, part] }, wantsRun(body, true), { part });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Add part failed');
                res.status(500).json({ error: 'part_failed' });
            }
        }
    });
    router.patch('/designs/:designId/parts/:partId', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            const index = design.parts.findIndex((p) => p.id === req.params.partId);
            if (index < 0) {
                res.status(404).json({ error: 'part_not_found' });
                return;
            }
            const current = design.parts[index];
            const raw = payload(body, 'part');
            const merged = { ...current, ...raw, id: current.id, type: current.type, props: raw.props && typeof raw.props === 'object' ? { ...current.props, ...raw.props } : current.props };
            const part = (0, circuit_contract_1.validatePart)(merged, 'part', current.id);
            const parts = design.parts.slice();
            parts[index] = part;
            await applyCircuit(req, res, { parts }, wantsRun(body, true), { part });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Update part failed');
                res.status(500).json({ error: 'part_failed' });
            }
        }
    });
    router.delete('/designs/:designId/parts/:partId', async (req, res) => {
        const design = req.labDesign;
        try {
            const parts = design.parts.filter((p) => p.id !== req.params.partId);
            if (parts.length === design.parts.length) {
                res.status(404).json({ error: 'part_not_found' });
                return;
            }
            const wires = design.wires.filter((w) => w.from.part !== req.params.partId && w.to.part !== req.params.partId);
            await applyCircuit(req, res, { parts, wires }, wantsRun((req.body ?? {}), true), { removed: req.params.partId, removedWires: design.wires.length - wires.length });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Remove part failed');
                res.status(500).json({ error: 'part_failed' });
            }
        }
    });
    router.post('/designs/:designId/wires', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            const raw = payload(body, 'wire');
            const wire = (0, circuit_contract_1.validateWire)({ ...raw, id: raw.id ?? mintId('w', design.wires) }, design.parts, 'wire');
            const circuit = (0, circuit_contract_1.validateCircuit)({ parts: design.parts, wires: [...design.wires, wire] });
            await applyCircuit(req, res, { wires: circuit.wires }, wantsRun(body, true), { wire });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Add wire failed');
                res.status(500).json({ error: 'wire_failed' });
            }
        }
    });
    router.delete('/designs/:designId/wires/:wireId', async (req, res) => {
        const design = req.labDesign;
        try {
            const wires = design.wires.filter((w) => w.id !== req.params.wireId);
            if (wires.length === design.wires.length) {
                res.status(404).json({ error: 'wire_not_found' });
                return;
            }
            await applyCircuit(req, res, { wires }, wantsRun((req.body ?? {}), true), { removed: req.params.wireId });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Remove wire failed');
                res.status(500).json({ error: 'wire_failed' });
            }
        }
    });
    router.post('/designs/:designId/run', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            const { designId: _d, run: _r, ...simPatch } = body;
            let current = design;
            if (Object.keys(simPatch).length)
                current = (await (0, design_store_1.updateDesign)(deps.pool, req.labSub, design.design_id, { sim: (0, circuit_contract_1.validateSim)({ ...design.sim, ...simPatch }) })) ?? design;
            if (current.parts.length === 0)
                throw new circuit_contract_1.ContractError('the circuit has no parts', 'parts');
            answer(res, await (0, simulate_service_1.simulateDesign)(deps, current));
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Run failed');
                res.status(500).json({ error: 'run_failed' });
            }
        }
    });
    router.post('/designs/:designId/restore', async (req, res) => {
        const design = req.labDesign;
        try {
            const run = Number((req.body ?? {}).run);
            if (!Number.isInteger(run) || run < 1)
                throw new circuit_contract_1.ContractError('run must be a kept run number', 'run');
            const row = await (0, design_store_1.getRun)(deps.pool, req.labSub, design.design_id, run);
            if (!row) {
                res.status(404).json({ error: 'run_not_found' });
                return;
            }
            const circuit = (0, circuit_contract_1.validateCircuit)({ parts: row.parts, wires: row.wires });
            const board = boardFor(design, circuit.parts, circuit.wires);
            const updated = (await (0, design_store_1.updateDesign)(deps.pool, req.labSub, design.design_id, { parts: circuit.parts, wires: circuit.wires, sim: (0, circuit_contract_1.validateSim)(row.sim), ...(board === undefined ? {} : { board }) })) ?? design;
            answer(res, await (0, simulate_service_1.simulateDesign)(deps, updated), { restoredFrom: run });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Restore failed');
                res.status(500).json({ error: 'restore_failed' });
            }
        }
    });
    router.post('/designs/:designId/board', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            if (design.board && body.relayout !== true) {
                answer(res, { design, report: null, build: { ok: true, ms: 0 } }, { board: design.board, laidOut: false });
                return;
            }
            const board = board_bridge_1.boardModel.autoLayout(design.parts, design.wires, CONTRACT);
            if (!board) {
                res.status(422).json({ error: 'board_capacity', message: `the circuit does not fit a ${board_bridge_1.boardModel.COLS}-column breadboard` });
                return;
            }
            const updated = (await (0, design_store_1.updateDesign)(deps.pool, req.labSub, design.design_id, { board })) ?? design;
            answer(res, { design: updated, report: null, build: { ok: true, ms: 0 } }, { board, laidOut: true });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Board layout failed');
                res.status(500).json({ error: 'board_failed' });
            }
        }
    });
    router.put('/designs/:designId/board', async (req, res) => {
        const design = req.labDesign;
        const body = (req.body ?? {});
        try {
            const board = board_bridge_1.boardModel.validateBoard({ placements: body.placements, jumpers: body.jumpers }, design.parts);
            const wires = board_bridge_1.boardModel.wiresFromBoard(board, design.parts, design.wires, CONTRACT);
            const circuit = (0, circuit_contract_1.validateCircuit)({ parts: design.parts, wires });
            const nets = board_bridge_1.boardModel.boardNets(board, circuit.parts, CONTRACT);
            await applyCircuit(req, res, { wires: circuit.wires, board }, wantsRun(body, true), { board, nets: nets.filter((n) => n.length > 1).length, agree: board_bridge_1.boardModel.sameNets(nets, board_bridge_1.boardModel.wireNets(circuit.parts, circuit.wires, CONTRACT)) });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Board update failed');
                res.status(500).json({ error: 'board_failed' });
            }
        }
    });
    router.delete('/designs/:designId/board', async (req, res) => {
        const design = req.labDesign;
        try {
            const updated = (await (0, design_store_1.updateDesign)(deps.pool, req.labSub, design.design_id, { board: null })) ?? design;
            answer(res, { design: updated, report: null, build: { ok: true, ms: 0 } }, { board: null });
        }
        catch (error) {
            logger.error({ err: error, designId: design.design_id }, 'Board delete failed');
            res.status(500).json({ error: 'board_failed' });
        }
    });
    router.get('/designs/:designId/parts/:partId/gear-profile', (req, res) => {
        const design = req.labDesign;
        const part = design.parts.find((p) => p.id === req.params.partId);
        if (!part) {
            res.status(404).json({ error: 'part_not_found' });
            return;
        }
        const num = (v) => (v === undefined ? undefined : Number(v));
        const faceWidthMm = num(req.query.faceWidthMm), boreMm = num(req.query.boreMm);
        if ((faceWidthMm !== undefined && !Number.isFinite(faceWidthMm)) || (boreMm !== undefined && !Number.isFinite(boreMm))) {
            res.status(400).json({ error: 'invalid_input', field: 'faceWidthMm', message: 'faceWidthMm and boreMm must be numbers' });
            return;
        }
        const made = (0, gear_profile_1.cadStudioBody)(part, { faceWidthMm, boreMm }, { designId: design.design_id, designTitle: design.title });
        if (!made.ok) {
            res.status(422).json({ error: 'gear_not_exportable', message: made.reason });
            return;
        }
        res.json({ partId: part.id, cadStudio: { method: 'POST', path: '/api/cad-studio/models', body: made.body }, outline: made.outline, next: '/cockpit/?app=cad-studio' });
    });
    router.get('/designs/:designId/runs', async (req, res) => {
        const design = req.labDesign;
        try {
            res.json({ runs: await (0, design_store_1.listRuns)(deps.pool, req.labSub, design.design_id) });
        }
        catch (error) {
            logger.error({ err: error, designId: design.design_id }, 'List runs failed');
            res.status(500).json({ error: 'runs_failed' });
        }
    });
    router.get('/designs/:designId/runs/:run', async (req, res) => {
        const design = req.labDesign;
        try {
            const run = req.params.run === 'latest' ? design.run_count : (0, data_dir_1.requireRun)(req.params.run);
            const row = run > 0 ? await (0, design_store_1.getRun)(deps.pool, req.labSub, design.design_id, run) : null;
            if (!row) {
                res.status(404).json({ error: 'run_not_found' });
                return;
            }
            res.json({ run: row, artifacts: Object.fromEntries(['waveforms', 'netlist', 'report'].map((k) => [k, `${BASE}/designs/${design.design_id}/runs/${run}/artifacts/${k}`])) });
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error, designId: design.design_id }, 'Read run failed');
                res.status(500).json({ error: 'run_failed' });
            }
        }
    });
    router.get('/designs/:designId/runs/:run/artifacts/:key', (req, res) => {
        const design = req.labDesign;
        const key = req.params.key;
        if (!(0, data_dir_1.isArtifactKey)(key)) {
            res.status(404).json({ error: 'unknown_artifact' });
            return;
        }
        const run = req.params.run === 'latest' ? design.run_count : Number(req.params.run);
        if (!Number.isInteger(run) || run < 1 || run > design.run_count) {
            res.status(404).json({ error: 'run_not_found' });
            return;
        }
        const file = (0, data_dir_1.artifactPath)((0, data_dir_1.runDir)(deps.dataRoot, req.labSub, design.design_id, run), key);
        if (!node_fs_1.default.existsSync(file)) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.type(data_dir_1.ARTIFACT_TYPES[key]);
        if (req.query.download !== undefined)
            res.setHeader('Content-Disposition', `attachment; filename="${design.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'circuit'}-run${run}.${key === 'netlist' ? 'cir' : 'json'}"`);
        res.sendFile(file);
    });
    return router;
}
