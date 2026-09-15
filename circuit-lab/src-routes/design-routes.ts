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

import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { boardFailure, boardModel, type BoardLayout } from './board-bridge';
import { ContractError, describeContract, validateCircuit, validatePart, validateSim, validateWire, type CircuitPart, type CircuitWire } from './circuit-contract';
import { ARTIFACT_TYPES, artifactPath, designDir, isArtifactKey, requireRun, requireUuid, runDir, type ArtifactKey } from './data-dir';
import { createDesign, deleteDesign, getDesign, getRun, listDesigns, listRuns, updateDesign, type DesignRow, type QueryablePool } from './design-store';
import { findExample } from './examples';
import { cadStudioBody } from './gear-profile';
import { buildStatus, simulateDesign, type BuildOutcome, type SimulateDeps } from './simulate-service';

const logger = createChildLogger({ module: 'circuit-lab-design-routes' });
const BASE = '/api/circuit-lab';
const CONTRACT = describeContract() as { parts: Record<string, { pins: Array<{ name: string; kind: string }> }> };

/** @description What the design router needs from its host. */
export interface DesignRouteDeps extends SimulateDeps {
  pool: QueryablePool;
  callerSub: (req: Request) => string | null;
}

type DesignRequest = Request & { labSub?: string; labDesign?: DesignRow };

/** @description The design as the API returns it (artifact URLs for the last run). */
export function publicDesign(design: DesignRow): Record<string, unknown> {
  const artifacts = design.run_count > 0 ? Object.fromEntries(['waveforms', 'netlist', 'report'].map((k) => [k, `${BASE}/designs/${design.design_id}/runs/${design.run_count}/artifacts/${k}`])) : {};
  return { ...design, artifacts };
}

function refuse(res: Response, error: unknown): boolean {
  if (error instanceof ContractError) { res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message }); return true; }
  if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_id', message: error.message }); return true; }
  const board = boardFailure(error);
  if (board) { res.status(400).json({ error: 'invalid_input', field: board.field, message: board.message }); return true; }
  return false;
}

/** A saved board follows every schematic change: placements kept, jumpers regenerated from the new nets. */
function boardFor(design: DesignRow, parts: CircuitPart[], wires: CircuitWire[]): BoardLayout | null | undefined {
  if (!design.board) return undefined;
  return boardModel.reconcileBoard(design.board, parts, wires, CONTRACT);
}

function answer(res: Response, built: { design: DesignRow; report: Record<string, unknown> | null; build: BuildOutcome }, extra: Record<string, unknown> = {}, okStatus = 200): void {
  res.status(built.build.ok ? okStatus : buildStatus(built.build)).json({ design: publicDesign(built.design), run: built.report ? { run: built.design.run_count, report: built.report } : null, build: built.build, ...extra });
}

function title(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || fallback;
}

const wantsRun = (body: Record<string, unknown>, fallback: boolean): boolean => (typeof body.run === 'boolean' ? body.run : fallback);

/** Strip the routing ids tool calls carry so the rest of the body is the part / wire. */
function payload(body: Record<string, unknown>, key: 'part' | 'wire'): Record<string, unknown> {
  if (body[key] && typeof body[key] === 'object') return body[key] as Record<string, unknown>;
  const { designId: _d, partId: _p, wireId: _w, run: _r, ...rest } = body;
  return rest;
}

/** A fresh id of the form <prefix><n> not used by the list. */
function mintId(prefix: string, taken: Array<{ id: string }>): string {
  const used = new Set(taken.map((t) => t.id.toLowerCase()));
  for (let n = 1; n < 10_000; n += 1) if (!used.has(`${prefix}${n}`.toLowerCase())) return `${prefix}${n}`;
  return `${prefix}${Date.now()}`;
}

const PREFIX: Record<string, string> = { ground: 'GND', junction: 'J', battery: 'B', source: 'V', resistor: 'R', potentiometer: 'P', capacitor: 'C', inductor: 'L', diode: 'D', led: 'D', switch: 'S', npn: 'Q', nmos: 'Q', motor: 'M', gear: 'G', load: 'W', zener: 'Z', lamp: 'LP', regulator: 'U', opamp: 'A', relay: 'K', sequencer: 'SQ', hbridge: 'H', timer555: 'U', servo: 'SV', stepper: 'ST', stepdriver: 'U', spring: 'K', pulley: 'PL', crank: 'CR', arduino: 'MCU' };

/**
 * @description Build the design router (mounted under the package's oidc mount).
 * @param deps - Pool, engine, data root, caller resolver.
 * @returns The router.
 */
export function createDesignRoutes(deps: DesignRouteDeps): Router {
  const router = Router();

  router.use((req: DesignRequest, res, next) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    req.labSub = sub;
    next();
  });

  router.param('designId', async (req: DesignRequest, res, next, value) => {
    try {
      const design = await getDesign(deps.pool, req.labSub as string, requireUuid(value));
      if (!design) { res.status(404).json({ error: 'design_not_found' }); return; }
      req.labDesign = design;
      next();
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Load design failed'); res.status(500).json({ error: 'load_failed' }); }
    }
  });

  /** Solve when asked (and there is something to solve); otherwise answer with the row as saved. */
  async function maybeRun(design: DesignRow, run: boolean): Promise<{ design: DesignRow; report: Record<string, unknown> | null; build: BuildOutcome }> {
    if (!run || design.parts.length === 0) return { design, report: null, build: { ok: true, ms: 0 } };
    return simulateDesign(deps, design);
  }

  /** Persist a new circuit (a saved board follows it), then solve on request. */
  async function applyCircuit(req: DesignRequest, res: Response, patch: { parts?: CircuitPart[]; wires?: CircuitWire[]; board?: BoardLayout | null }, run: boolean, extra: Record<string, unknown> = {}): Promise<void> {
    const design = req.labDesign as DesignRow;
    const board = patch.board !== undefined ? patch.board : boardFor(design, patch.parts ?? design.parts, patch.wires ?? design.wires);
    const updated = (await updateDesign(deps.pool, req.labSub as string, design.design_id, board === undefined ? patch : { ...patch, board })) ?? design;
    answer(res, await maybeRun(updated, run), extra);
  }

  router.get('/designs', async (req: DesignRequest, res) => {
    try { res.json({ designs: (await listDesigns(deps.pool, req.labSub as string)).map(publicDesign) }); }
    catch (error) { logger.error({ err: error }, 'List designs failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.post('/designs', async (req: DesignRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const example = body.example === undefined ? null : findExample(body.example);
      if (body.example !== undefined && !example) throw new ContractError(`unknown example ${JSON.stringify(body.example)}`, 'example');
      const circuit = validateCircuit({ parts: body.parts ?? example?.parts ?? [], wires: body.wires ?? example?.wires ?? [] });
      const sim = validateSim(body.sim ?? example?.sim ?? {});
      const source = example ? { kind: 'example', example: example.id } : {};
      const stored = await createDesign(deps.pool, req.labSub as string, { title: title(body.title, example?.title ?? 'Untitled circuit'), ...circuit, sim, source });
      answer(res, await maybeRun(stored, wantsRun(body, true)), {}, 201);
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Create design failed'); res.status(500).json({ error: 'create_failed' }); }
    }
  });

  router.get('/designs/:designId', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try { res.json({ design: publicDesign(design), runs: await listRuns(deps.pool, req.labSub as string, design.design_id), engine: deps.engine.status() }); }
    catch (error) { logger.error({ err: error, designId: design.design_id }, 'Read design failed'); res.status(500).json({ error: 'read_failed' }); }
  });

  router.patch('/designs/:designId', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const patch: { title?: string; sim?: DesignRow['sim'] } = {};
      if (body.title !== undefined) patch.title = title(body.title, design.title);
      if (body.sim !== undefined) patch.sim = validateSim({ ...design.sim, ...(body.sim && typeof body.sim === 'object' ? (body.sim as Record<string, unknown>) : {}) });
      const updated = (await updateDesign(deps.pool, req.labSub as string, design.design_id, patch)) ?? design;
      answer(res, await maybeRun(updated, wantsRun(body, false)));
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Update design failed'); res.status(500).json({ error: 'update_failed' }); }
    }
  });

  router.delete('/designs/:designId', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try {
      await deleteDesign(deps.pool, req.labSub as string, design.design_id);
      fs.rmSync(designDir(deps.dataRoot, req.labSub as string, design.design_id), { recursive: true, force: true });
      res.json({ deleted: design.design_id });
    } catch (error) { logger.error({ err: error, designId: design.design_id }, 'Delete design failed'); res.status(500).json({ error: 'delete_failed' }); }
  });

  router.put('/designs/:designId/circuit', async (req: DesignRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try { await applyCircuit(req, res, validateCircuit({ parts: body.parts, wires: body.wires }), wantsRun(body, false)); }
    catch (error) { if (!refuse(res, error)) { logger.error({ err: error }, 'Replace circuit failed'); res.status(500).json({ error: 'circuit_failed' }); } }
  });

  router.post('/designs/:designId/parts', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const raw = payload(body, 'part');
      const type = typeof raw.type === 'string' ? raw.type : '';
      const part = validatePart({ ...raw, id: raw.id ?? mintId(PREFIX[type] ?? 'X', design.parts) }, 'part');
      if (design.parts.some((p) => p.id.toLowerCase() === part.id.toLowerCase())) throw new ContractError(`part id ${part.id} already exists`, 'part.id');
      await applyCircuit(req, res, { parts: [...design.parts, part] }, wantsRun(body, true), { part });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Add part failed'); res.status(500).json({ error: 'part_failed' }); }
    }
  });

  router.patch('/designs/:designId/parts/:partId', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const index = design.parts.findIndex((p) => p.id === req.params.partId);
      if (index < 0) { res.status(404).json({ error: 'part_not_found' }); return; }
      const current = design.parts[index];
      const raw = payload(body, 'part');
      const merged = { ...current, ...raw, id: current.id, type: current.type, props: raw.props && typeof raw.props === 'object' ? { ...current.props, ...(raw.props as Record<string, unknown>) } : current.props };
      const part = validatePart(merged, 'part', current.id);
      const parts = design.parts.slice();
      parts[index] = part;
      await applyCircuit(req, res, { parts }, wantsRun(body, true), { part });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Update part failed'); res.status(500).json({ error: 'part_failed' }); }
    }
  });

  router.delete('/designs/:designId/parts/:partId', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try {
      const parts = design.parts.filter((p) => p.id !== req.params.partId);
      if (parts.length === design.parts.length) { res.status(404).json({ error: 'part_not_found' }); return; }
      const wires = design.wires.filter((w) => w.from.part !== req.params.partId && w.to.part !== req.params.partId);
      await applyCircuit(req, res, { parts, wires }, wantsRun((req.body ?? {}) as Record<string, unknown>, true), { removed: req.params.partId, removedWires: design.wires.length - wires.length });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Remove part failed'); res.status(500).json({ error: 'part_failed' }); }
    }
  });

  router.post('/designs/:designId/wires', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const raw = payload(body, 'wire');
      const wire = validateWire({ ...raw, id: raw.id ?? mintId('w', design.wires) }, design.parts, 'wire');
      const circuit = validateCircuit({ parts: design.parts, wires: [...design.wires, wire] });
      await applyCircuit(req, res, { wires: circuit.wires }, wantsRun(body, true), { wire });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Add wire failed'); res.status(500).json({ error: 'wire_failed' }); }
    }
  });

  router.delete('/designs/:designId/wires/:wireId', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try {
      const wires = design.wires.filter((w) => w.id !== req.params.wireId);
      if (wires.length === design.wires.length) { res.status(404).json({ error: 'wire_not_found' }); return; }
      await applyCircuit(req, res, { wires }, wantsRun((req.body ?? {}) as Record<string, unknown>, true), { removed: req.params.wireId });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Remove wire failed'); res.status(500).json({ error: 'wire_failed' }); }
    }
  });

  router.post('/designs/:designId/run', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { designId: _d, run: _r, ...simPatch } = body;
      let current = design;
      if (Object.keys(simPatch).length) current = (await updateDesign(deps.pool, req.labSub as string, design.design_id, { sim: validateSim({ ...design.sim, ...simPatch }) })) ?? design;
      if (current.parts.length === 0) throw new ContractError('the circuit has no parts', 'parts');
      answer(res, await simulateDesign(deps, current));
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Run failed'); res.status(500).json({ error: 'run_failed' }); }
    }
  });

  router.post('/designs/:designId/restore', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try {
      const run = Number(((req.body ?? {}) as Record<string, unknown>).run);
      if (!Number.isInteger(run) || run < 1) throw new ContractError('run must be a kept run number', 'run');
      const row = await getRun(deps.pool, req.labSub as string, design.design_id, run);
      if (!row) { res.status(404).json({ error: 'run_not_found' }); return; }
      const circuit = validateCircuit({ parts: row.parts, wires: row.wires });
      const board = boardFor(design, circuit.parts, circuit.wires);
      const updated = (await updateDesign(deps.pool, req.labSub as string, design.design_id, { parts: circuit.parts, wires: circuit.wires, sim: validateSim(row.sim), ...(board === undefined ? {} : { board }) })) ?? design;
      answer(res, await simulateDesign(deps, updated), { restoredFrom: run });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Restore failed'); res.status(500).json({ error: 'restore_failed' }); }
    }
  });

  router.post('/designs/:designId/board', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      if (design.board && body.relayout !== true) { answer(res, { design, report: null, build: { ok: true, ms: 0 } }, { board: design.board, laidOut: false }); return; }
      const board = boardModel.autoLayout(design.parts, design.wires, CONTRACT);
      if (!board) { res.status(422).json({ error: 'board_capacity', message: `the circuit does not fit a ${boardModel.COLS}-column breadboard` }); return; }
      const updated = (await updateDesign(deps.pool, req.labSub as string, design.design_id, { board })) ?? design;
      answer(res, { design: updated, report: null, build: { ok: true, ms: 0 } }, { board, laidOut: true });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Board layout failed'); res.status(500).json({ error: 'board_failed' }); }
    }
  });

  router.put('/designs/:designId/board', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const board = boardModel.validateBoard({ placements: body.placements, jumpers: body.jumpers }, design.parts);
      const wires = boardModel.wiresFromBoard(board, design.parts, design.wires, CONTRACT);
      const circuit = validateCircuit({ parts: design.parts, wires });
      const nets = boardModel.boardNets(board, circuit.parts, CONTRACT);
      await applyCircuit(req, res, { wires: circuit.wires, board }, wantsRun(body, true), { board, nets: nets.filter((n) => n.length > 1).length, agree: boardModel.sameNets(nets, boardModel.wireNets(circuit.parts, circuit.wires, CONTRACT)) });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Board update failed'); res.status(500).json({ error: 'board_failed' }); }
    }
  });

  router.delete('/designs/:designId/board', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try {
      const updated = (await updateDesign(deps.pool, req.labSub as string, design.design_id, { board: null })) ?? design;
      answer(res, { design: updated, report: null, build: { ok: true, ms: 0 } }, { board: null });
    } catch (error) { logger.error({ err: error, designId: design.design_id }, 'Board delete failed'); res.status(500).json({ error: 'board_failed' }); }
  });

  router.get('/designs/:designId/parts/:partId/gear-profile', (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const part = design.parts.find((p) => p.id === req.params.partId);
    if (!part) { res.status(404).json({ error: 'part_not_found' }); return; }
    const num = (v: unknown): number | undefined => (v === undefined ? undefined : Number(v));
    const faceWidthMm = num(req.query.faceWidthMm), boreMm = num(req.query.boreMm);
    if ((faceWidthMm !== undefined && !Number.isFinite(faceWidthMm)) || (boreMm !== undefined && !Number.isFinite(boreMm))) { res.status(400).json({ error: 'invalid_input', field: 'faceWidthMm', message: 'faceWidthMm and boreMm must be numbers' }); return; }
    const made = cadStudioBody(part, { faceWidthMm, boreMm }, { designId: design.design_id, designTitle: design.title });
    if (!made.ok) { res.status(422).json({ error: 'gear_not_exportable', message: made.reason }); return; }
    res.json({ partId: part.id, cadStudio: { method: 'POST', path: '/api/cad-studio/models', body: made.body }, outline: made.outline, next: '/cockpit/?app=cad-studio' });
  });

  router.get('/designs/:designId/runs', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try { res.json({ runs: await listRuns(deps.pool, req.labSub as string, design.design_id) }); }
    catch (error) { logger.error({ err: error, designId: design.design_id }, 'List runs failed'); res.status(500).json({ error: 'runs_failed' }); }
  });

  router.get('/designs/:designId/runs/:run', async (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    try {
      const run = req.params.run === 'latest' ? design.run_count : requireRun(req.params.run);
      const row = run > 0 ? await getRun(deps.pool, req.labSub as string, design.design_id, run) : null;
      if (!row) { res.status(404).json({ error: 'run_not_found' }); return; }
      res.json({ run: row, artifacts: Object.fromEntries(['waveforms', 'netlist', 'report'].map((k) => [k, `${BASE}/designs/${design.design_id}/runs/${run}/artifacts/${k}`])) });
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error, designId: design.design_id }, 'Read run failed'); res.status(500).json({ error: 'run_failed' }); }
    }
  });

  router.get('/designs/:designId/runs/:run/artifacts/:key', (req: DesignRequest, res) => {
    const design = req.labDesign as DesignRow;
    const key = req.params.key;
    if (!isArtifactKey(key)) { res.status(404).json({ error: 'unknown_artifact' }); return; }
    const run = req.params.run === 'latest' ? design.run_count : Number(req.params.run);
    if (!Number.isInteger(run) || run < 1 || run > design.run_count) { res.status(404).json({ error: 'run_not_found' }); return; }
    const file = artifactPath(runDir(deps.dataRoot, req.labSub as string, design.design_id, run), key as ArtifactKey);
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(ARTIFACT_TYPES[key as ArtifactKey]);
    if (req.query.download !== undefined) res.setHeader('Content-Disposition', `attachment; filename="${design.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'circuit'}-run${run}.${key === 'netlist' ? 'cir' : 'json'}"`);
    res.sendFile(file);
  });

  return router;
}
