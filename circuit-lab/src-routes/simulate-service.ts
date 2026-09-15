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

import fs from 'node:fs';
import { createChildLogger } from '@/shared/logger';
import { EngineFailure, type EngineClient } from './engine-client';
import { artifactPath, ensureDir, runDir } from './data-dir';
import { recordFailure, recordRun, type DesignRow, type QueryablePool } from './design-store';

const logger = createChildLogger({ module: 'circuit-lab-simulate' });

export interface SimulateDeps { pool: QueryablePool; engine: EngineClient; dataRoot: string; engineBuild: string | null; timeoutMs?: number }

/** @description The outcome the routes report beside the design. */
export interface BuildOutcome { ok: boolean; code?: string; error?: string; reason?: string; field?: string; ms?: number }

/** What the worker answers to `simulate` (see engine/circuit_worker.py). */
interface EngineResult {
  netlist: string; nets: unknown[]; netOfPin: Record<string, string>; sim: Record<string, unknown>;
  waveforms: { time: number[]; signals: Record<string, number[]> };
  readings: Array<Record<string, unknown>>; mechanism: Record<string, unknown>; warnings: Array<Record<string, unknown>>; engineLog?: string; ms?: number;
}

const locks = new Map<string, Promise<unknown>>();

/** @description Run `fn` after any in-flight solve of the same design finishes. */
export function withDesignLock<T>(designId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(designId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(designId, next.catch(() => undefined));
  return next;
}

/** @description The report stored on the row and in report.json (waveforms stay on disk only). */
export function reportOf(result: EngineResult): Record<string, unknown> {
  return { readings: result.readings, mechanism: result.mechanism, warnings: result.warnings, nets: result.nets, netOfPin: result.netOfPin, sim: result.sim, engineMs: result.ms ?? null, engineLog: result.engineLog ?? '' };
}

function writeArtifacts(dir: string, result: EngineResult, report: Record<string, unknown>): void {
  ensureDir(dir);
  fs.writeFileSync(artifactPath(dir, 'waveforms'), JSON.stringify({ time: result.waveforms.time, signals: result.waveforms.signals, nets: result.nets, netOfPin: result.netOfPin }), 'utf8');
  fs.writeFileSync(artifactPath(dir, 'netlist'), result.netlist, 'utf8');
  fs.writeFileSync(artifactPath(dir, 'report'), JSON.stringify(report, null, 2), 'utf8');
}

/**
 * @description Solve a design: engine round-trip, artifacts to the next run dir, run row.
 * @param deps - Pool, engine, data root.
 * @param design - The design as stored (its parts, wires and sim are what is solved).
 * @returns The updated row, the run's report (on success) and the outcome.
 */
export function simulateDesign(deps: SimulateDeps, design: DesignRow): Promise<{ design: DesignRow; report: Record<string, unknown> | null; build: BuildOutcome }> {
  return withDesignLock(design.design_id, async () => {
    const started = Date.now();
    const sub = design.owner_sub;
    try {
      const timeoutMs = deps.timeoutMs ?? 120_000;
      const result = await deps.engine.request('simulate', {
        circuit: { parts: design.parts, wires: design.wires }, sim: design.sim, timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000) - 5),
      }, timeoutMs) as EngineResult;
      const nextRun = design.run_count + 1;
      const report = reportOf(result);
      writeArtifacts(runDir(deps.dataRoot, sub, design.design_id, nextRun), result, report);
      const ms = Date.now() - started;
      const row = await recordRun(deps.pool, sub, design.design_id, { parts: design.parts, wires: design.wires, sim: design.sim, report, engineBuild: deps.engineBuild, ms });
      if (!row) throw new EngineFailure('engine_error', 'the design vanished during the solve');
      if (row.run_count !== nextRun) logger.warn({ designId: design.design_id, expected: nextRun, actual: row.run_count }, 'run number drifted under the lock');
      logger.info({ designId: design.design_id, run: row.run_count, ms, parts: design.parts.length, warnings: result.warnings.length }, 'design solved');
      return { design: row, report, build: { ok: true, ms } };
    } catch (error) {
      const failure = error instanceof EngineFailure ? error : new EngineFailure('engine_error', error instanceof Error ? error.message : String(error));
      logger.error({ err: error, designId: design.design_id, code: failure.code }, 'design solve failed');
      const row = (await recordFailure(deps.pool, sub, design.design_id, `${failure.code}: ${failure.reason || failure.message}`)) ?? design;
      return { design: row, report: null, build: { ok: false, code: failure.code, error: failure.message, reason: failure.reason, ...(failure.field ? { field: failure.field } : {}), ms: Date.now() - started } };
    }
  });
}

/** @description Map a build outcome to the HTTP status the routes answer with. */
export function buildStatus(build: BuildOutcome): number {
  if (build.ok) return 200;
  switch (build.code) {
    case 'capability_unavailable': case 'engine_busy': case 'engine_timeout': return 503;
    case 'refused': return 422;
    default: return 500;
  }
}
