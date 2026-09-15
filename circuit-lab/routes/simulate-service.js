"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — one solve: send the stored circuit and its
 *                     |                             | transient settings to the engine, write the waveforms, the
 *                     |                             | deck and the report into the NEXT run's directory, then
 *                     |                             | record the run — or record the failure (the engine's typed
 *                     |                             | reason, the refused field) and keep the last good run.
 *                     |                             | Solves of one design are serialised so two edits cannot
 *                     |                             | interleave a run number.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withDesignLock = withDesignLock;
exports.reportOf = reportOf;
exports.simulateDesign = simulateDesign;
exports.buildStatus = buildStatus;
const node_fs_1 = __importDefault(require("node:fs"));
const logger_1 = require("@/shared/logger");
const engine_client_1 = require("./engine-client");
const data_dir_1 = require("./data-dir");
const design_store_1 = require("./design-store");
const logger = (0, logger_1.createChildLogger)({ module: 'circuit-lab-simulate' });
const locks = new Map();
/** @description Run `fn` after any in-flight solve of the same design finishes. */
function withDesignLock(designId, fn) {
    const previous = locks.get(designId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    locks.set(designId, next.catch(() => undefined));
    return next;
}
/** @description The report stored on the row and in report.json (waveforms stay on disk only). */
function reportOf(result) {
    return { readings: result.readings, mechanism: result.mechanism, warnings: result.warnings, nets: result.nets, netOfPin: result.netOfPin, sim: result.sim, engineMs: result.ms ?? null, engineLog: result.engineLog ?? '' };
}
function writeArtifacts(dir, result, report) {
    (0, data_dir_1.ensureDir)(dir);
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'waveforms'), JSON.stringify({ time: result.waveforms.time, signals: result.waveforms.signals, nets: result.nets, netOfPin: result.netOfPin }), 'utf8');
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'netlist'), result.netlist, 'utf8');
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'report'), JSON.stringify(report, null, 2), 'utf8');
}
/**
 * @description Solve a design: engine round-trip, artifacts to the next run dir, run row.
 * @param deps - Pool, engine, data root.
 * @param design - The design as stored (its parts, wires and sim are what is solved).
 * @returns The updated row, the run's report (on success) and the outcome.
 */
function simulateDesign(deps, design) {
    return withDesignLock(design.design_id, async () => {
        const started = Date.now();
        const sub = design.owner_sub;
        try {
            const timeoutMs = deps.timeoutMs ?? 120_000;
            const result = await deps.engine.request('simulate', {
                circuit: { parts: design.parts, wires: design.wires }, sim: design.sim, timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000) - 5),
            }, timeoutMs);
            const nextRun = design.run_count + 1;
            const report = reportOf(result);
            writeArtifacts((0, data_dir_1.runDir)(deps.dataRoot, sub, design.design_id, nextRun), result, report);
            const ms = Date.now() - started;
            const row = await (0, design_store_1.recordRun)(deps.pool, sub, design.design_id, { parts: design.parts, wires: design.wires, sim: design.sim, report, engineBuild: deps.engineBuild, ms });
            if (!row)
                throw new engine_client_1.EngineFailure('engine_error', 'the design vanished during the solve');
            if (row.run_count !== nextRun)
                logger.warn({ designId: design.design_id, expected: nextRun, actual: row.run_count }, 'run number drifted under the lock');
            logger.info({ designId: design.design_id, run: row.run_count, ms, parts: design.parts.length, warnings: result.warnings.length }, 'design solved');
            return { design: row, report, build: { ok: true, ms } };
        }
        catch (error) {
            const failure = error instanceof engine_client_1.EngineFailure ? error : new engine_client_1.EngineFailure('engine_error', error instanceof Error ? error.message : String(error));
            logger.error({ err: error, designId: design.design_id, code: failure.code }, 'design solve failed');
            const row = (await (0, design_store_1.recordFailure)(deps.pool, sub, design.design_id, `${failure.code}: ${failure.reason || failure.message}`)) ?? design;
            return { design: row, report: null, build: { ok: false, code: failure.code, error: failure.message, reason: failure.reason, ...(failure.field ? { field: failure.field } : {}), ms: Date.now() - started } };
        }
    });
}
/** @description Map a build outcome to the HTTP status the routes answer with. */
function buildStatus(build) {
    if (build.ok)
        return 200;
    switch (build.code) {
        case 'capability_unavailable':
        case 'engine_busy':
        case 'engine_timeout': return 503;
        case 'refused': return 422;
        default: return 500;
    }
}
