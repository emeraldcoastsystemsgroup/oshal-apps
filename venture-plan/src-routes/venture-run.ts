/**
 * Venture Plan — recomputation, and the out-of-band authoring run.
 *
 * TWO PATHS, SPLIT BY WHAT THEY COST.
 *
 * `recomputeVenture` is PURE CODE over stored rows: read the ledger, compose the
 * engine input, run the engine, persist the snapshot. It calls no bot, spends
 * nothing, and takes milliseconds — which is what makes the product's central
 * interaction possible: edit an assumption, watch every number move, pay nothing.
 * A route that quietly narrated the result would destroy that property, so nothing
 * in this function may ever reach an LLM.
 *
 * `startRun` is the LLM path and it NEVER runs on the request path. A full run is
 * four bot calls across four bots and takes minutes; a synchronous route would
 * time out and the user would retry, doubling the spend. So it opens a run row,
 * returns the id immediately, and drives the phases detached. The surface polls.
 *
 * PER-PHASE FAILURE ISOLATION IS DELIBERATE. If the market analyst's harness is
 * down, the BOM and ops phases still land and the compute phase still produces a
 * model — flagged, with the failed phase named on the run row. A transient failure
 * that cost the whole run would train the user to re-run everything, which is the
 * expensive habit.
 *
 * SINGLE-FLIGHT PER VENTURE. A second click while a run is in flight returns the
 * SAME run id rather than starting a second one. Two concurrent runs would write
 * two revisions of every assumption and race each other into the ledger.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the free, LLM-free recompute path; the detached authoring run with single-flight, per-phase failure isolation and a persisted phase log; and the narration phase that renders every document from the frozen snapshot.
 *
 * @module venture-run
 */

import type { Pool } from 'pg';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { createChildLogger } from '@/shared/logger';
import { buildVentureModel } from './venture-model';
import type { VentureModel } from './venture-model';
import { composeModelInput, hashableInputs } from './venture-store-compose';
import { authorBom, authorMarket, authorOps, narrate, AGENT_IDS } from './venture-bots';
import {
  parseAssumptionOutput, parseBomOutput, parseOpsOutput, parseProseOutput,
} from './venture-bot-contracts';
import { buildTables, renderDocument } from './venture-documents';
import { DOC_CATALOG, getDocSpec, proseKeysFor } from './venture-doc-catalog';
import {
  advanceRun, bulkInsertAssumptions, closeRun, coverageOf, getScenario, getVenture,
  liveAssumptions, openRun,
} from './venture-store';
import {
  listBom, listHeadcount, listScheduleTasks, listVendors, replaceBomFromBot,
  replaceHeadcount, replaceScheduleTasks, insertVendor,
} from './venture-store-supply';
import { hashInputs, insertDocumentVersion, insertModel } from './venture-store-outputs';
import type { ModelSnapshot, RunKind, RunPhase } from './venture-types';
import { ENGINE_VERSION } from './venture-types';

const log = createChildLogger({ module: 'venture-run' });

/** The framework way to reach a bot; falls through to inline for concierge bots. */
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** In-flight runs by venture id. A second click must not double-spend. */
const inFlight = new Map<string, string>();

/**
 * @description Whether a venture already has an authoring run in flight.
 * @param ventureId - Venture id.
 * @returns The in-flight run id, or null.
 */
export function inFlightRun(ventureId: string): string | null {
  return inFlight.get(ventureId) ?? null;
}

/** What a recompute produced. `model` is null only when the venture vanished. */
export interface RecomputeResult {
  model: VentureModel;
  snapshot: ModelSnapshot;
  missingAssumptionKeys: string[];
}

/**
 * @description Recompute a venture and persist an immutable snapshot.
 *
 * PURE CODE. No bot call, no spend, no clock inside the engine — `onDate` is a
 * parameter. This is what an assumption edit triggers, and it must stay free
 * forever: the moment recomputation costs money, people stop exploring, and
 * exploring is the only way anyone finds out which guess is load-bearing.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param opts - Scenario to apply, the run that triggered it, and the model date.
 * @returns The computed model, its stored snapshot, and the assumption keys the
 *   plan references but nobody has registered.
 */
export async function recomputeVenture(
  pool: Pool, ownerSub: string, ventureId: string,
  opts: { scenarioId?: string | null; runId?: string | null; onDate: string },
): Promise<RecomputeResult | null> {
  const venture = await getVenture(pool, ownerSub, ventureId);
  if (!venture) return null;
  const [assumptions, bomLines, vendors, headcount, tasks] = await Promise.all([
    liveAssumptions(pool, ownerSub, ventureId),
    listBom(pool, ownerSub, ventureId),
    listVendors(pool, ownerSub, ventureId),
    listHeadcount(pool, ownerSub, ventureId),
    listScheduleTasks(pool, ownerSub, ventureId),
  ]);
  const scenario = opts.scenarioId
    ? await getScenario(pool, ownerSub, ventureId, opts.scenarioId) : null;

  const composed = composeModelInput({
    venture, assumptions, bomLines, vendors, headcount, scenario, onDate: opts.onDate,
  });
  const model = buildVentureModel(composed.input);
  const tables = buildTables(model, { vendors, tasks, roles: headcount, bomLines });
  const snapshot = await insertModel(pool, ownerSub, ventureId, {
    scenarioId: scenario ? scenario.id : null,
    runId: opts.runId ?? null,
    engineVersion: ENGINE_VERSION,
    inputsHash: hashInputs(ENGINE_VERSION, hashableInputs(composed.input.ledger, composed.input.runQtyUnits)),
    figures: model.figures as never,
    tables,
    coverage: coverageOf(assumptions),
    warnings: model.issues.map((i) => `[${i.severity}] ${i.where}: ${i.message}`),
    posture: model.posture,
    canPublish: model.canPublish,
  });
  return { model, snapshot, missingAssumptionKeys: composed.missingAssumptionKeys };
}

/** Which phases a run of each kind walks, and which bot owns each. */
function phasesFor(kind: RunKind): RunPhase[] {
  const phase = (name: string, agentId: string | null): RunPhase =>
    ({ name, agentId, status: 'pending', durationMs: null, error: null });
  const bom = phase('bom', AGENT_IDS.bomAnalyst);
  const market = phase('market', AGENT_IDS.marketAnalyst);
  const ops = phase('ops', AGENT_IDS.opsAnalyst);
  const compute = phase('compute', null);
  const narrateP = phase('narrate', AGENT_IDS.strategist);
  if (kind === 'bom') return [bom, compute];
  if (kind === 'market') return [market, compute];
  if (kind === 'ops') return [ops, compute];
  if (kind === 'narrate') return [compute, narrateP];
  return [bom, market, ops, compute, narrateP];
}

/** Mark one phase and persist the run's progress. */
async function mark(
  pool: Pool, runId: string, phases: RunPhase[], name: string,
  status: RunPhase['status'], startedAt: number, error?: string,
): Promise<void> {
  const p = phases.find((x) => x.name === name);
  if (p) {
    p.status = status;
    p.durationMs = Date.now() - startedAt;
    p.error = error ?? null;
  }
  const done = phases.filter((x) => x.agentId && (x.status === 'done' || x.status === 'failed')).length;
  await advanceRun(pool, runId, name, phases, done);
}

/** The context every phase needs. Assembled once so a phase cannot re-read state. */
interface PhaseCtx {
  ctx: AppContext;
  pool: Pool;
  ownerSub: string;
  ventureId: string;
  runId: string;
  onDate: string;
}

/** Run the BOM phase: draft lines and vendor candidates, store what parses. */
async function phaseBom(p: PhaseCtx, spec: { name: string; ideaText: string; spec: Record<string, unknown> }): Promise<void> {
  const model = await recomputeVenture(p.pool, p.ownerSub, p.ventureId, { onDate: p.onDate, runId: p.runId });
  const runQty = model?.model.bom.runQtyUnits ?? 5000;
  const reply = await authorBom(p.ctx, botClient, p.ownerSub, spec, runQty);
  const parsed = parseBomOutput(reply.text);
  if (!parsed.ok) throw new Error(`BOM analyst reply unusable: ${parsed.error}`);
  const vendorIds = new Map<string, string>();
  for (const v of parsed.vendors ?? []) {
    const stored = await insertVendor(p.pool, p.ownerSub, p.ventureId, { ...v, sourceKind: 'model-estimate' });
    vendorIds.set(v.name, stored.id);
  }
  // A band, not a point: the midpoint is what the roll-up costs, and the band is
  // what the sensitivity sweep swings. Storing only a midpoint would delete the
  // uncertainty the analyst was asked to express.
  const rows = parsed.rows.map((l, i) => ({
    ref: l.ref, partName: l.partName, specText: l.specText, qtyPerUnit: l.qtyPerUnit,
    uom: l.uom, discrete: l.discrete, material: l.material, process: l.process,
    makeOrBuy: l.makeOrBuy,
    unitCostMicros: Math.round((l.lowMicros + l.highMicros) / 2),
    lowMicros: l.lowMicros, highMicros: l.highMicros, scrapPct: l.scrapPct,
    moq: l.moq, leadTimeDays: l.leadTimeDays, toolingCostMicros: l.toolingCostMicros,
    toolingLifeUnits: l.toolingLifeUnits, htsCode: l.htsCode, dutyPct: l.dutyPct,
    vendorId: l.vendorName ? vendorIds.get(l.vendorName) ?? null : null,
    assumptionKey: `bom.${l.ref}.unit-cost`,
    sourceKind: 'model-estimate', confidence: l.confidence, sortOrder: i,
  }));
  await replaceBomFromBot(p.pool, p.ownerSub, p.ventureId, rows);
  // Every line's cost also becomes a registered assumption, so the figure that
  // rests on it can name it and the sweep can move it.
  await bulkInsertAssumptions(p.pool, p.ownerSub, p.ventureId, parsed.rows.map((l) => ({
    key: `bom.${l.ref}.unit-cost`, domain: 'manufacturing' as const,
    label: `${l.partName} unit cost`, unit: 'micros',
    valueNum: Math.round((l.lowMicros + l.highMicros) / 2),
    lowNum: l.lowMicros, highNum: l.highMicros,
    sourceKind: 'model-estimate' as const, sourceDetail: l.specText, confidence: l.confidence,
  })), AGENT_IDS.bomAnalyst, p.runId);
}

/** Run the market phase: demand, price ladder and channel terms. */
async function phaseMarket(p: PhaseCtx, spec: { name: string; ideaText: string; spec: Record<string, unknown> }): Promise<void> {
  const reply = await authorMarket(p.ctx, botClient, p.ownerSub, spec);
  const parsed = parseAssumptionOutput(reply.text);
  if (!parsed.ok) throw new Error(`market analyst reply unusable: ${parsed.error}`);
  await bulkInsertAssumptions(p.pool, p.ownerSub, p.ventureId, parsed.rows, AGENT_IDS.marketAnalyst, p.runId);
}

/** Run the ops phase against the frozen BOM roll-up. */
async function phaseOps(p: PhaseCtx, spec: { name: string; ideaText: string; spec: Record<string, unknown> }): Promise<void> {
  const computed = await recomputeVenture(p.pool, p.ownerSub, p.ventureId, { onDate: p.onDate, runId: p.runId });
  const summary = computed ? {
    runQtyUnits: computed.model.bom.runQtyUnits,
    recurringUnitMicros: computed.model.bom.recurringUnitMicros,
    lines: computed.model.bom.lines.map((l) => ({
      name: l.name, purchaseQty: l.purchaseQty, extendedMicros: l.extendedMicros,
    })),
  } : { note: 'no BOM computed yet' };
  const reply = await authorOps(p.ctx, botClient, p.ownerSub, spec, summary);
  const parsed = parseOpsOutput(reply.text);
  if (!parsed.ok) throw new Error(`ops analyst reply unusable: ${parsed.error}`);
  await bulkInsertAssumptions(p.pool, p.ownerSub, p.ventureId, parsed.rows, AGENT_IDS.opsAnalyst, p.runId);
  if (parsed.tasks?.length) await replaceScheduleTasks(p.pool, p.ownerSub, p.ventureId, parsed.tasks);
  if (parsed.roles?.length) await replaceHeadcount(p.pool, p.ownerSub, p.ventureId, parsed.roles);
}

/** Narrate and store every requested document from the FROZEN snapshot. */
async function phaseNarrate(
  p: PhaseCtx, snapshot: ModelSnapshot, docKeys: readonly string[],
): Promise<void> {
  const assumptions = await liveAssumptions(p.pool, p.ownerSub, p.ventureId);
  const venture = await getVenture(p.pool, p.ownerSub, p.ventureId);
  if (!venture) return;
  const figureTable: Record<string, string> = {};
  for (const [id, f] of Object.entries(snapshot.figures)) figureTable[id] = `${f.label}: ${f.value} ${f.unit}`;

  for (const key of docKeys) {
    const spec = getDocSpec(key);
    if (!spec) continue;
    let prose: Record<string, string> = {};
    const wanted = proseKeysFor(spec);
    if (wanted.length) {
      try {
        const reply = await narrate(p.ctx, botClient, p.ownerSub, spec.title, wanted, figureTable);
        prose = parseProseOutput(reply.text);
      } catch (err: any) {
        // A missing narrator must never cost the evidence: the computed sections
        // stand on their own and the document records that prose is absent.
        log.error({ err, stack: err?.stack, docKey: key }, 'narration failed — rendering computed sections only');
      }
    }
    try {
      const rendered = renderDocument(spec, {
        figures: snapshot.figures as never, tables: snapshot.tables, coverage: snapshot.coverage,
        posture: snapshot.posture, canPublish: snapshot.canPublish, warnings: snapshot.warnings,
        assumptions, prose, ventureName: venture.name, computedAt: snapshot.computedAt,
      });
      await insertDocumentVersion(p.pool, p.ownerSub, p.ventureId, {
        docKey: rendered.docKey, modelId: snapshot.id, title: rendered.title,
        bodyMd: rendered.bodyMd, sections: rendered.sections, proseRunId: p.runId,
        proseStatus: Object.keys(prose).length
          ? (rendered.unverifiedNumbers.length ? 'flagged' : 'generated') : 'none',
        unverifiedNumbers: rendered.unverifiedNumbers,
        assumptionsCited: rendered.assumptionsCited, estimatePct: rendered.estimatePct,
      });
    } catch (err: any) {
      log.error({ err, stack: err?.stack, docKey: key }, 'document render refused');
    }
  }
}

/**
 * @description Start an authoring run and return its id immediately.
 *
 * The caller answers 202 with this id; the phases execute detached. Single-flight
 * per venture: a second call while one is running returns the SAME id.
 *
 * @param ctx - App context.
 * @param ownerSub - The accountable spend owner.
 * @param ventureId - Venture id.
 * @param kind - What to author.
 * @param docKeys - Documents to narrate; defaults to the whole catalogue.
 * @param onDate - The modelling date, supplied by the route.
 * @returns The run id, and whether a run was already in flight.
 */
export async function startRun(
  ctx: AppContext, ownerSub: string, ventureId: string, kind: RunKind,
  docKeys: readonly string[] | undefined, onDate: string,
): Promise<{ runId: string; alreadyRunning: boolean; phases: string[] }> {
  const open = inFlightRun(ventureId);
  const phases = phasesFor(kind);
  if (open) return { runId: open, alreadyRunning: true, phases: phases.map((p) => p.name) };

  const pool = ctx.pool as Pool;
  const runId = await openRun(pool, ownerSub, ventureId, kind, phases);
  inFlight.set(ventureId, runId);

  // Detached on purpose: the HTTP response must not wait on minutes of bot work.
  void drive({ ctx, pool, ownerSub, ventureId, runId, onDate }, kind, phases, docKeys)
    .catch((err: any) => log.error({ err, stack: err?.stack, ventureId, runId }, 'venture run crashed'))
    .finally(() => { inFlight.delete(ventureId); });

  return { runId, alreadyRunning: false, phases: phases.map((p) => p.name) };
}

/** Walk the phases, isolating each failure, then close the run. */
async function drive(
  p: PhaseCtx, kind: RunKind, phases: RunPhase[], docKeys: readonly string[] | undefined,
): Promise<void> {
  const venture = await getVenture(p.pool, p.ownerSub, p.ventureId);
  if (!venture) { await closeRun(p.pool, p.runId, 'failed', phases, 'venture not found'); return; }
  const spec = {
    name: venture.name, ideaText: venture.ideaText,
    spec: venture.spec as unknown as Record<string, unknown>,
  };
  const failures: string[] = [];

  for (const phase of phases) {
    if (phase.name === 'compute' || phase.name === 'narrate') continue;
    const started = Date.now();
    await mark(p.pool, p.runId, phases, phase.name, 'running', started);
    try {
      if (phase.name === 'bom') await phaseBom(p, spec);
      else if (phase.name === 'market') await phaseMarket(p, spec);
      else if (phase.name === 'ops') await phaseOps(p, spec);
      await mark(p.pool, p.runId, phases, phase.name, 'done', started);
    } catch (err: any) {
      log.error({ err, stack: err?.stack, phase: phase.name, runId: p.runId }, 'venture phase failed');
      failures.push(`${phase.name}: ${err?.message || String(err)}`);
      await mark(p.pool, p.runId, phases, phase.name, 'failed', started, err?.message || String(err));
    }
  }

  const computeStarted = Date.now();
  await mark(p.pool, p.runId, phases, 'compute', 'running', computeStarted);
  const computed = await recomputeVenture(p.pool, p.ownerSub, p.ventureId, {
    onDate: p.onDate, runId: p.runId,
  });
  await mark(p.pool, p.runId, phases, 'compute', computed ? 'done' : 'failed', computeStarted);

  if (computed && phases.some((x) => x.name === 'narrate')) {
    const started = Date.now();
    await mark(p.pool, p.runId, phases, 'narrate', 'running', started);
    try {
      await phaseNarrate(p, computed.snapshot, docKeys?.length ? docKeys : DOC_CATALOG.map((d) => d.key));
      await mark(p.pool, p.runId, phases, 'narrate', 'done', started);
    } catch (err: any) {
      failures.push(`narrate: ${err?.message || String(err)}`);
      await mark(p.pool, p.runId, phases, 'narrate', 'failed', started, err?.message || String(err));
    }
  }

  // A run with a failed phase is still `done` when it produced a model: the user
  // has a plan plus a named gap, which is more useful than a wholesale failure.
  await closeRun(p.pool, p.runId, computed ? 'done' : 'failed', phases,
    failures.length ? failures.join(' | ') : null);
  log.info({ ventureId: p.ventureId, runId: p.runId, kind, failures: failures.length }, 'venture run closed');
}
