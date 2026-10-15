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
 * `startRun` is the LLM path and it NEVER runs on the request path. A full run has
 * three analyst calls plus one narration call per requested prose-bearing
 * document; it can take minutes, so a synchronous route would time out and the
 * user would retry, doubling the spend. So it opens a run row,
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
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add default-off scheduled rebaseline execution, per-call measured-cost gating, database slot idempotency, and owner-bound progress writes.
 *
 * 3 | maintainer@emeraldcoastsystemsgroup.com | On the native kernel a run is driven inside the request that started it. The kernel answers a
 *   package's host calls only while that request is open (bridge: "Completed application request is unavailable in this native
 *   runtime"), so the detached drive's first write after its BOM call was refused and the run sat at 'phase: bom' running for
 *   21+ minutes. One request is 60 seconds there, so one analyst runs per request; the later analysts are recorded 'skipped' as
 *   deferred and the next Run continues from the first deferred one. A run that throws is closed failed with the reason; a
 *   reply cut off before its JSON closed says so; runs an earlier request left 'running' are closed as interrupted.
 *
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A native run whose request was abandoned (the page closed or the connection dropped
 *   mid-run: the kernel drops the request and refuses its later host calls) stayed 'running' until the next Run, so the
 *   console showed "Analysts running…" indefinitely and the home tile counted it in progress. Reads now present such a
 *   run closed: presentRun shows a 'running' run older than the native request deadline plus a margin that this process
 *   is not driving as failed (interrupted), and GET /ventures/:id, GET /ventures/:id/runs and GET /runs/:runId answer
 *   through it. A read writes nothing (the kernel refuses SQL mutations on a read request); the next Run records the
 *   close (closeInterrupted).
 *
 * 5 | maintainer@emeraldcoastsystemsgroup.com | After bom, market and ops had all run, every document stayed "not generated yet" and the model
 *   refused on model:traceability: the analysts named their own keys, and nothing registered bom.final-assembly.cost,
 *   channel.dtc.terms, season.sell-through, a role's org.<id>.cost or a vendor's supplier.<id>.terms. Market and ops now
 *   register the code-owned "required" slots under the exact keys (venture-required-inputs) and a slot left empty is
 *   named on the phase and the run instead of the phase reading clean; ops registers each role's salary under its
 *   org.<id>.cost and BOM each vendor's terms under supplier.<id>.terms; a write that failed is named too. A native full
 *   run stores every catalogue document rendered from the computed numbers (no bot, no spend), so documents open and
 *   Regenerate prose adds the written sections. Run the analysts continues from the first analyst the latest full run
 *   deferred, failed or left with a gap, instead of starting again at bom.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | A required slot whose live row a person entered or that carries evidence (a recorded
 *   vendor quote, the person's own value, a published source) is left as it is: the analyst's value is not stored over it
 *   (bulkInsertAssumptions keeps it) and the slot is not named as a gap when the analyst left it empty, so Run does not
 *   repeat the analyst over it. Before, pressing Run again replaced a quoted container freight with the ops analyst's
 *   guess and the plan computed with the guess.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | A BOM run that redrafts the bill of materials closes the BOM analyst's own estimates for lines and vendors
 *   the redraft no longer has (retireAnalystRows): the lines were replaced but their bom.<ref>.unit-cost and
 *   supplier.<id>.terms rows stayed live, so a second BOM run left 13 BOM costs for a six-line product. A person's entry,
 *   a quote or a published source is never closed.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | A native run stores its computed documents in one batched statement (insertDocumentVersions) instead of
 *   one insert per document, and renders them only while the request has NATIVE_DOCUMENTS_RESERVE_MS left; with less, the
 *   Documents phase is deferred with that reason and the documents keep their earlier version, which the document routes
 *   mark stale. Live, an ops run answered 503 "package call timed out" after 60 s: its analyst finished at 18 s, the model
 *   was stored at 29 s, and the 17 single inserts that followed on a loaded host ran past the limit. The narration table
 *   shows each figure as the document prints it (formatFigure) for the {{fig:id}} tokens the strategist writes.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the first Run the analysts failed "BOM analyst reply unusable: no
 *   JSON object in the reply" (1,070 tokens that did not parse, 15 s) and the next run succeeded. An analyst reply that does
 *   not parse, and was not cut off at the output limit, is asked for once more with the strict JSON rule (parsedAnalystReply),
 *   on the native kernel only while the request still has room for a second reply as long as the first plus the documents
 *   reserve. The narrated "What would have to be true" said "before the venture reaches break-even" over a table reading
 *   break-even not reachable: the narrator is told the document's unreachable figures and a sentence still claiming one is
 *   removed before storing (venture-prose-claims).
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Round 14: no narrated sentence is deleted. The narrator is given break-even
 *   as the frozen model computed it (breakEvenFacts over the snapshot's figures and P&L), and after narration one check
 *   (withBreakEvenCheck) keeps the prose as written and attaches "Check: the computed model does not reach break-even within
 *   the horizon" to a section that says it is reached when it is not, logged as a warning (narrateDocument).
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
  extractJsonObject, parseAssumptionOutput, parseBomOutput, parseOpsOutput, parseProseOutput,
} from './venture-bot-contracts';
import { parseRequiredInputs, slotsFor, type SlotAnalyst } from './venture-required-inputs';
import { buildTables, renderDocument } from './venture-documents';
import { DOC_CATALOG, getDocSpec, proseKeysFor } from './venture-doc-catalog';
import {
  advanceRun, bulkInsertAssumptions, closeRun, coverageOf, getScenario, getVenture,
  latestRun, listRuns, liveAssumptions, openRun, retireAnalystRows,
} from './venture-store';
import {
  listBom, listHeadcount, listScheduleTasks, listVendors, replaceBomFromBot,
  replaceHeadcount, replaceScheduleTasks, insertVendor,
} from './venture-store-supply';
import { hashInputs, insertDocumentVersion, insertDocumentVersions, insertModel } from './venture-store-outputs';
import { formatFigure } from './venture-figures';
import { breakEvenFacts, unreachableFigures, withBreakEvenCheck } from './venture-prose-claims';
import {
  costCappedBotCall, RebaselineError, ScheduledRunBudget,
} from './venture-rebaseline';
import { openScheduledRun, updateScheduledRunCost } from './venture-store-rebaseline';
import type { AssumptionInput, HeadcountRow, ModelSnapshot, RunKind, RunPhase, RunSummary } from './venture-types';
import type { BotReply } from './venture-bots';
import { ENGINE_VERSION, heldAgainstAnalysts } from './venture-types';

const log = createChildLogger({ module: 'venture-run' });

/** The framework way to reach a bot; falls through to inline for concierge bots. */
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** In-flight runs by venture id. A second click must not double-spend. */
const inFlight = new Map<string, string>();

/**
 * How long into a native request an analyst phase may still start. The native kernel gives an
 * ordinary request 60 seconds and serves its host calls only while it is open; an analyst reply is
 * capped at ANALYST_MAX_OUTPUT_TOKENS (venture-bots), about 33 s of writing, so only an analyst that
 * starts this early can finish and record its outcome inside the same request.
 */
export const NATIVE_ANALYST_WINDOW_MS = 10_000;

/** The native kernel's package request deadline (oshal-kernel crates/host-process/src/host.rs CALL_DEADLINE). */
export const NATIVE_REQUEST_MS = 60_000;

/**
 * How much of a native request must remain for a run to render and store its documents: two reads, one batched
 * insert and the run's closing write, with room for a loaded host (live, single SQL calls took up to two seconds).
 */
export const NATIVE_DOCUMENTS_RESERVE_MS = 15_000;

/** Past the deadline, how long before a run nobody is driving is closed on read (clock skew, a slow close). */
export const ABANDONED_MARGIN_MS = 30_000;

/** Why a run read after its request was abandoned is shown closed. */
export const ABANDONED_REASON = 'interrupted: the request that ran it ended before it recorded a result (the page was '
  + 'closed, the connection dropped or the 60-second limit passed). Press Run the analysts again to continue.';

/** Prefix of a phase error that means "not run yet; the next Run continues here". */
export const DEFERRED = 'deferred: ';

/** Prefix of a done phase's note naming what its analyst did not supply; the next Run repeats that analyst. */
export const GAP = 'did not supply: ';

/**
 * @description Whether this package runs on the native kernel, where the bridge marks kernel-applied egress.
 * @returns True on the native kernel.
 */
export function onNativeKernel(): boolean {
  return process.env.OSHAL_EGRESS === 'kernel';
}

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
  if (kind === 'rebaseline') return [bom, market, ops, compute];
  return [bom, market, ops, compute, narrateP];
}

/** Mark one phase and persist the run's progress. */
async function mark(
  pool: Pool, ownerSub: string, ventureId: string, runId: string,
  phases: RunPhase[], name: string,
  status: RunPhase['status'], startedAt: number, error?: string,
): Promise<void> {
  const p = phases.find((x) => x.name === name);
  if (p) {
    p.status = status;
    p.durationMs = Date.now() - startedAt;
    p.error = error ?? null;
  }
  const done = phases.filter((x) => x.agentId
    && (x.status === 'done' || x.status === 'failed' || x.status === 'skipped')).length;
  await advanceRun(pool, ownerSub, ventureId, runId, name, phases, done);
}

/** The context every phase needs. Assembled once so a phase cannot re-read state. */
interface PhaseCtx {
  ctx: AppContext;
  pool: Pool;
  ownerSub: string;
  ventureId: string;
  runId: string;
  onDate: string;
  budget?: ScheduledRunBudget;
  /** Native kernel only: when the request driving this run started (see NATIVE_ANALYST_WINDOW_MS). */
  nativeStartedAt?: number;
}

/**
 * @description The failure text for an analyst reply that did not parse. A reply that opened its JSON
 * and never closed it was cut off (the model reached its output limit), which a person should be told
 * plainly; any other unusable reply keeps the parser's reason.
 * @param who - The analyst, as the run names it.
 * @param text - The reply text.
 * @param error - The contract parser's reason.
 * @returns The phase error.
 */
export function unusableReply(who: string, text: string, error: string): string {
  return replyCutOff(text)
    ? `${who} reply was cut off before its JSON closed (it reached the model's output limit): ${error}`
    : `${who} reply unusable: ${error}`;
}

/** @description Whether a reply opened its JSON and never closed it (the model reached its output limit). */
function replyCutOff(text: string): boolean {
  const body = String(text || '').trim().replace(/```\s*$/, '').trim();
  return /[{[]/.test(body) && !/[}\]]$/.test(body);
}

/**
 * @description Whether a second analyst reply fits: always off the native kernel; on it, only while the request still has
 * room for a reply as long as the first one plus the documents reserve (a retry that ran past 60 s would lose the run).
 * @param p - The phase context.
 * @param firstMs - How long the first reply took.
 * @returns True when the retry may be made.
 */
function retryFits(p: PhaseCtx, firstMs: number): boolean {
  if (p.nativeStartedAt === undefined) return true;
  const left = NATIVE_REQUEST_MS - (Date.now() - p.nativeStartedAt);
  return left >= firstMs + NATIVE_DOCUMENTS_RESERVE_MS;
}

/**
 * @description One analyst reply that parses: a reply that does not parse, and was not cut off at the output limit (a retry
 * would be cut off again), is asked for once more with the strict JSON rule when the retry fits.
 * @param p - The phase context.
 * @param who - The analyst, as the run names it.
 * @param call - The analyst call; `strict` asks for the JSON object alone.
 * @param parse - The analyst's contract parser.
 * @returns The reply and its parse.
 * @throws When neither reply parses, with the parser's reason (unusableReply).
 */
async function parsedAnalystReply<R extends { ok: boolean; error?: string }>(
  p: PhaseCtx, who: string, call: (strict: boolean) => Promise<BotReply>, parse: (text: string) => R,
): Promise<{ reply: BotReply; parsed: Extract<R, { ok: true }> }> {
  const started = Date.now();
  let reply = await paidBotCall(p, () => call(false));
  let parsed = parse(reply.text);
  if (!parsed.ok && !replyCutOff(reply.text) && retryFits(p, Date.now() - started)) {
    log.warn({ runId: p.runId, who, error: parsed.error }, 'analyst reply did not parse; asking once more for the JSON alone');
    reply = await paidBotCall(p, () => call(true));
    parsed = parse(reply.text);
  }
  if (!parsed.ok) throw new Error(unusableReply(who, reply.text, String(parsed.error)));
  return { reply, parsed: parsed as Extract<R, { ok: true }> };
}

/** Run and persist one bot boundary through the scheduled cap when present. */
async function paidBotCall<T extends { costUsd: number }>(
  p: PhaseCtx, call: () => Promise<T>,
): Promise<T> {
  if (!p.budget) return call();
  try {
    return await costCappedBotCall(p.budget, call);
  } finally {
    try {
      const saved = await updateScheduledRunCost(
        p.pool, p.ownerSub, p.ventureId, p.runId, p.budget.status(),
      );
      if (!saved) throw new Error('scheduled run cost evidence target is unavailable');
    } catch (err) {
      // Without durable cost evidence, later calls stop even when the provider
      // response itself was valid or the persistence adapter threw.
      p.budget.noteUnsettled();
      throw err;
    }
  }
}

/**
 * @description Register a batch of rows and name every key whose write failed. bulkInsertAssumptions logs and
 * skips a failed row; a phase that dropped that list read as clean while the model refused on the missing key.
 * @param p - The phase context.
 * @param rows - Rows to register.
 * @param agentId - The authoring analyst.
 * @returns One gap per key that was not written.
 */
async function register(p: PhaseCtx, rows: readonly AssumptionInput[], agentId: string): Promise<string[]> {
  if (!rows.length) return [];
  const { failed } = await bulkInsertAssumptions(p.pool, p.ownerSub, p.ventureId, rows, agentId, p.runId);
  return failed.map((key) => `${key}: not saved`);
}

/**
 * @description Register the slots an analyst filled under the exact keys the model names; name the rest.
 * Registered after the free-form rows, so a slot supersedes a free-form row that reused its key. A slot whose
 * live row a person entered or that carries evidence keeps that row (bulkInsertAssumptions) and is no gap.
 * @param p - The phase context.
 * @param text - The analyst's reply.
 * @param analyst - Which analyst.
 * @param agentId - Its agent id.
 * @returns The gaps: slots not filled or not saved, other than those a held row already answers.
 */
async function registerRequired(p: PhaseCtx, text: string, analyst: SlotAnalyst, agentId: string): Promise<string[]> {
  const { rows, missing } = parseRequiredInputs(extractJsonObject(text), analyst);
  const held = new Set((await liveAssumptions(p.pool, p.ownerSub, p.ventureId))
    .filter(heldAgainstAnalysts).map((a) => a.key));
  const answered = slotsFor(analyst).filter((s) => held.has(s.key)).map((s) => `${s.slot}:`);
  const open = missing.filter((gap) => !answered.some((prefix) => gap.startsWith(prefix)));
  return [...open, ...await register(p, rows, agentId)];
}

/** Run the BOM phase: draft lines and vendor candidates, store what parses. */
async function phaseBom(p: PhaseCtx, spec: { name: string; ideaText: string; spec: Record<string, unknown> }): Promise<string[]> {
  const model = await recomputeVenture(p.pool, p.ownerSub, p.ventureId, { onDate: p.onDate, runId: p.runId });
  const runQty = model?.model.bom.runQtyUnits ?? 5000;
  const { parsed } = await parsedAnalystReply(p, 'BOM analyst',
    (strict) => authorBom(p.ctx, botClient, p.ownerSub, spec, runQty, strict), parseBomOutput);
  const vendorIds = new Map<string, string>();
  const terms: AssumptionInput[] = [];
  for (const v of parsed.vendors ?? []) {
    const stored = await insertVendor(p.pool, p.ownerSub, p.ventureId, { ...v, sourceKind: 'model-estimate' });
    vendorIds.set(v.name, stored.id);
    // A line bought from this vendor rests on supplier.<id>.terms; the analyst's stated deposit is that term.
    terms.push({
      key: `supplier.${stored.id}.terms`, domain: 'manufacturing', label: `${v.name} deposit`, unit: 'bps',
      valueNum: v.depositBps, sourceKind: 'model-estimate', confidence: v.confidence,
      sourceDetail: `deposit ${v.depositBps} bps, balance net ${v.balanceNetDays} days, as the BOM analyst proposed`,
    });
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
  const costs: AssumptionInput[] = [...parsed.rows.map((l) => ({
    key: `bom.${l.ref}.unit-cost`, domain: 'manufacturing' as const,
    label: `${l.partName} unit cost`, unit: 'micros',
    valueNum: Math.round((l.lowMicros + l.highMicros) / 2),
    lowNum: l.lowMicros, highNum: l.highMicros,
    sourceKind: 'model-estimate' as const, sourceDetail: l.specText, confidence: l.confidence,
  })), ...terms];
  const gaps = await register(p, costs, AGENT_IDS.bomAnalyst);
  // The lines were replaced; this analyst's estimates for lines and vendors the redraft no longer has go with them.
  await retireAnalystRows(p.pool, p.ownerSub, p.ventureId, AGENT_IDS.bomAnalyst,
    ['bom.%.unit-cost', 'supplier.%.terms'], new Set(costs.map((c) => c.key)));
  return gaps;
}

/** Run the market phase: demand, price ladder and channel terms. */
async function phaseMarket(p: PhaseCtx, spec: { name: string; ideaText: string; spec: Record<string, unknown> }): Promise<string[]> {
  const { reply, parsed } = await parsedAnalystReply(p, 'market analyst',
    (strict) => authorMarket(p.ctx, botClient, p.ownerSub, spec, strict), parseAssumptionOutput);
  const gaps = await register(p, parsed.rows, AGENT_IDS.marketAnalyst);
  return [...gaps, ...await registerRequired(p, reply.text, 'market', AGENT_IDS.marketAnalyst)];
}

/** Run the ops phase against the frozen BOM roll-up. */
async function phaseOps(p: PhaseCtx, spec: { name: string; ideaText: string; spec: Record<string, unknown> }): Promise<string[]> {
  const computed = await recomputeVenture(p.pool, p.ownerSub, p.ventureId, { onDate: p.onDate, runId: p.runId });
  const summary = computed ? {
    runQtyUnits: computed.model.bom.runQtyUnits,
    recurringUnitMicros: computed.model.bom.recurringUnitMicros,
    lines: computed.model.bom.lines.map((l) => ({
      name: l.name, purchaseQty: l.purchaseQty, extendedMicros: l.extendedMicros,
    })),
  } : { note: 'no BOM computed yet' };
  const { reply, parsed } = await parsedAnalystReply(p, 'ops analyst',
    (strict) => authorOps(p.ctx, botClient, p.ownerSub, spec, summary, strict), parseOpsOutput);
  const gaps = await register(p, parsed.rows, AGENT_IDS.opsAnalyst);
  gaps.push(...await registerRequired(p, reply.text, 'ops', AGENT_IDS.opsAnalyst));
  if (parsed.tasks?.length) await replaceScheduleTasks(p.pool, p.ownerSub, p.ventureId, parsed.tasks);
  if (parsed.roles?.length) {
    await replaceHeadcount(p.pool, p.ownerSub, p.ventureId, parsed.roles);
    gaps.push(...await register(p, roleCosts(await listHeadcount(p.pool, p.ownerSub, p.ventureId)), AGENT_IDS.opsAnalyst));
  }
  return gaps;
}

/**
 * @description The salary of each analyst-proposed role as the assumption its payroll line rests on
 * (org.<id>.cost, venture-store-compose rolesFor). The analyst gives a salary and no range, so none is invented.
 * @param roles - The venture's stored roles.
 * @returns One row per model-estimate role without its own assumption key.
 */
export function roleCosts(roles: readonly HeadcountRow[]): AssumptionInput[] {
  return roles.filter((r) => r.sourceKind === 'model-estimate' && !r.assumptionKey).map((r) => ({
    key: `org.${r.id}.cost`, domain: 'org' as const, label: `${r.role} base salary`, unit: 'micros',
    valueNum: r.baseSalaryMicros, sourceKind: 'model-estimate' as const, confidence: r.confidence,
    sourceDetail: `annual base salary the ops analyst proposed, ${r.fte} FTE`,
  }));
}

/** The document version to store for one rendered document. */
function documentInsert(p: PhaseCtx, snapshot: ModelSnapshot, rendered: ReturnType<typeof renderDocument>, withProse: boolean) {
  return {
    docKey: rendered.docKey, modelId: snapshot.id, title: rendered.title,
    bodyMd: rendered.bodyMd, sections: rendered.sections, proseRunId: p.runId,
    proseStatus: withProse ? (rendered.unverifiedNumbers.length ? 'flagged' as const : 'generated' as const) : 'none' as const,
    unverifiedNumbers: rendered.unverifiedNumbers,
    assumptionsCited: rendered.assumptionsCited, estimatePct: rendered.estimatePct,
  };
}

/** Render one document from the frozen snapshot, or null after logging why the engine refused it. */
function renderFrom(
  spec: NonNullable<ReturnType<typeof getDocSpec>>, snapshot: ModelSnapshot,
  assumptions: Awaited<ReturnType<typeof liveAssumptions>>, prose: Record<string, string>, ventureName: string,
): ReturnType<typeof renderDocument> | null {
  try {
    return renderDocument(spec, {
      figures: snapshot.figures as never, tables: snapshot.tables, coverage: snapshot.coverage,
      posture: snapshot.posture, canPublish: snapshot.canPublish, warnings: snapshot.warnings,
      assumptions, prose, ventureName, computedAt: snapshot.computedAt,
    });
  } catch (err: any) {
    log.error({ err, stack: err?.stack, docKey: spec.key }, 'document render refused');
    return null;
  }
}

/** Store every requested document rendered from the computed numbers alone, in one batched write. */
async function storeComputedDocuments(
  p: PhaseCtx, snapshot: ModelSnapshot, docKeys: readonly string[],
  assumptions: Awaited<ReturnType<typeof liveAssumptions>>, ventureName: string,
): Promise<void> {
  const docs = docKeys.map((key) => getDocSpec(key))
    .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec))
    .map((spec) => renderFrom(spec, snapshot, assumptions, {}, ventureName))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => documentInsert(p, snapshot, r, false));
  await insertDocumentVersions(p.pool, p.ownerSub, p.ventureId, docs);
}

/**
 * Narrate one document's prose sections over the frozen figures, with break-even stated as computed, and run the one
 * break-even check on the reply. A failed narration returns no prose: the computed sections stand on their own.
 */
async function narrateDocument(
  p: PhaseCtx, snapshot: ModelSnapshot, spec: NonNullable<ReturnType<typeof getDocSpec>>,
  figureTable: Record<string, string>,
): Promise<Record<string, string>> {
  const wanted = proseKeysFor(spec);
  if (!wanted.length) return {};
  const unreachable = unreachableFigures(spec, snapshot.figures as Record<string, unknown>);
  const breakEven = breakEvenFacts(snapshot.figures as Record<string, unknown>, (snapshot.tables ?? {}) as Record<string, unknown>);
  try {
    const reply = await paidBotCall(p, () => narrate(p.ctx, botClient, p.ownerSub, spec.title, wanted, figureTable,
      unreachable.map((u) => u.fact), breakEven.lines));
    const checked = withBreakEvenCheck(parseProseOutput(reply.text), breakEven);
    if (checked.flagged.length) {
      log.warn({ docKey: spec.key, sections: checked.flagged }, 'prose says break-even is reached; the model does not reach it - check note attached');
    }
    return checked.prose;
  } catch (err: any) {
    // A missing narrator must never cost the evidence: the computed sections
    // stand on their own and the document records that prose is absent.
    log.error({ err, stack: err?.stack, docKey: spec.key }, 'narration failed — rendering computed sections only');
    return {};
  }
}

/** Narrate and store every requested document from the FROZEN snapshot. */
async function phaseNarrate(
  p: PhaseCtx, snapshot: ModelSnapshot, docKeys: readonly string[], withProse = true,
): Promise<void> {
  const assumptions = await liveAssumptions(p.pool, p.ownerSub, p.ventureId);
  const venture = await getVenture(p.pool, p.ownerSub, p.ventureId);
  if (!venture) return;
  if (!withProse) { await storeComputedDocuments(p, snapshot, docKeys, assumptions, venture.name); return; }
  const figureTable: Record<string, string> = {};
  for (const [id, f] of Object.entries(snapshot.figures)) figureTable[id] = `${f.label}: ${formatFigure(f as never)}`;

  for (const key of docKeys) {
    const spec = getDocSpec(key);
    if (!spec) continue;
    const prose = await narrateDocument(p, snapshot, spec, figureTable);
    const rendered = renderFrom(spec, snapshot, assumptions, prose, venture.name);
    if (!rendered) continue;
    try {
      await insertDocumentVersion(p.pool, p.ownerSub, p.ventureId, documentInsert(p, snapshot, rendered, Object.keys(prose).length > 0));
    } catch (err: any) {
      log.error({ err, stack: err?.stack, docKey: key }, 'document version not stored');
    }
  }
}

/**
 * @description Start an authoring run and return its id.
 *
 * Off the native kernel the caller answers 202 at once and the phases execute detached.
 * On the native kernel the phases run inside this request (see `driveRun`), so the id is
 * returned once the run is closed. Single-flight per venture: a second call while one is
 * running returns the SAME id.
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
  const pool = ctx.pool as Pool;
  if (open) return { runId: open, alreadyRunning: true, phases: phasesFor(kind).map((p) => p.name) };
  const native = onNativeKernel();
  const phases = native ? await nativePhases(pool, ownerSub, ventureId, kind) : phasesFor(kind);
  if (native) await closeInterrupted(pool, ownerSub, ventureId);
  const runId = await openRun(pool, ownerSub, ventureId, kind, phases);
  inFlight.set(ventureId, runId);
  await driveRun({ ctx, pool, ownerSub, ventureId, runId, onDate }, kind, phases, docKeys, 'venture run crashed');
  return { runId, alreadyRunning: false, phases: phases.map((p) => p.name) };
}

/**
 * @description Drive a run that is already open and in flight, then release its single-flight slot.
 *
 * Off the native kernel the drive is detached on purpose: the HTTP response must not wait on
 * minutes of bot work. On the native kernel the drive is awaited: the kernel answers a package's
 * host calls only while the request that made them is open, so detached work could not record
 * anything after the response, not even its own failure.
 *
 * @param p - The run's phase context.
 * @param kind - What to author.
 * @param phases - The run's phases.
 * @param docKeys - Documents to narrate.
 * @param crashed - Log message for a drive that threw.
 * @returns Nothing; the run is closed when it resolves on the native kernel.
 */
async function driveRun(
  p: PhaseCtx, kind: RunKind, phases: RunPhase[], docKeys: readonly string[] | undefined, crashed: string,
): Promise<void> {
  const native = onNativeKernel();
  const run = drive({ ...p, ...(native ? { nativeStartedAt: Date.now() } : {}) }, kind, phases, docKeys)
    .catch((err: any) => log.error({ err, stack: err?.stack, ventureId: p.ventureId, runId: p.runId }, crashed))
    .finally(() => { inFlight.delete(p.ventureId); });
  if (native) await run;
}

/**
 * @description The phases a native run walks. A full run continues from the first analyst the
 * venture's latest full run deferred, so pressing Run again finishes what one request could not.
 * @param pool - Shared pool.
 * @param ownerSub - The caller's sub.
 * @param ventureId - Venture id.
 * @param kind - What to author.
 * @returns The phases for this run.
 */
export async function nativePhases(
  pool: Pool, ownerSub: string, ventureId: string, kind: RunKind,
): Promise<RunPhase[]> {
  const all = phasesFor(kind);
  if (kind !== 'full') return all;
  const last = await latestRun(pool, ownerSub, ventureId);
  if (!last || last.kind !== 'full') return all;
  const from = last.phases.find((x) => x.agentId && x.name !== 'narrate' && needsAnotherRun(x));
  if (!from) return all;
  const index = all.findIndex((x) => x.name === from.name);
  return index < 0 ? all : all.slice(index);
}

/**
 * @description Whether an analyst phase of the latest full run still has work: it was deferred, it failed or was
 * interrupted, or it finished with inputs it did not supply. A Run continues from the first such phase.
 * @param phase - One phase of the latest full run.
 * @returns True when the next Run should start there.
 */
export function needsAnotherRun(phase: RunPhase): boolean {
  const error = String(phase.error || '');
  if (phase.status === 'skipped') return error.startsWith(DEFERRED);
  return phase.status === 'failed' || phase.status === 'running' || phase.status === 'pending'
    || (phase.status === 'done' && error.startsWith(GAP));
}

/** A run's phases as an interrupted run leaves them: the running one failed, the pending ones not run. */
function interruptedPhases(phases: RunPhase[]): RunPhase[] {
  return phases.map((x) => (x.status === 'running' || x.status === 'pending'
    ? { ...x, status: 'failed' as const, error: x.status === 'running' ? 'interrupted before it recorded a result' : 'not run' }
    : x));
}

/**
 * @description Close this venture's runs that are still 'running' but that no request is driving.
 * On the native kernel a run lives only as long as the request that drives it, so such a run was
 * interrupted (by the 60-second request limit, a closed page or a restart) and can never finish on its own.
 * Called when a new run starts, a write request; a read presents such a run closed (presentRun) instead.
 * @param pool - Shared pool.
 * @param ownerSub - The caller's sub.
 * @param ventureId - Venture id.
 * @returns Nothing.
 */
async function closeInterrupted(pool: Pool, ownerSub: string, ventureId: string): Promise<void> {
  for (const run of await listRuns(pool, ownerSub, ventureId)) {
    if (run.status !== 'running' || inFlight.get(ventureId) === run.id) continue;
    await closeRun(pool, ownerSub, ventureId, run.id, 'failed', interruptedPhases(run.phases),
      'interrupted: the request that ran it ended before it recorded a result');
  }
}

/**
 * @description A run as a read presents it. On the native kernel a run is driven inside the request that started
 * it, and the kernel drops that request when the page closes or the connection drops and refuses its later host
 * calls, so the run records nothing more. Once a 'running' run is older than the request deadline plus a margin and
 * this process is not driving it, it can only have been abandoned: it is shown failed (interrupted) with the reason,
 * instead of "Analysts running…" for ever. The stored row is unchanged (a read request may not write; the kernel
 * refuses it), and the next Run records the close. Off the native kernel runs are driven detached for minutes.
 * @param run - The stored run.
 * @param now - The time to judge its age by.
 * @returns The run, or its interrupted view.
 */
export function presentRun(run: RunSummary, now: number = Date.now()): RunSummary {
  if (!onNativeKernel() || run.status !== 'running' || inFlight.get(run.ventureId) === run.id) return run;
  if (!(now - Date.parse(run.startedAt) >= NATIVE_REQUEST_MS + ABANDONED_MARGIN_MS)) return run;
  return { ...run, status: 'failed', phase: null, error: ABANDONED_REASON, phases: interruptedPhases(run.phases) };
}

/**
 * Start the already-authorized scheduled path after a service tick evaluates an
 * owner policy. The database slot is reserved before any paid call, making a
 * retry or concurrent tick observationally idempotent.
 */
export async function startScheduledRebaseline(
  ctx: AppContext, ownerSub: string, ventureId: string, slot: string,
  onDate: string, capMicros: number,
): Promise<{
  runId: string;
  alreadyRunning: boolean;
  alreadyScheduled: boolean;
  phases: string[];
}> {
  const phases = phasesFor('rebaseline');
  const active = inFlightRun(ventureId);
  if (active) {
    return {
      runId: active, alreadyRunning: true, alreadyScheduled: false,
      phases: phases.map((phase) => phase.name),
    };
  }

  const pool = ctx.pool as Pool;
  const reserved = await openScheduledRun(pool, ownerSub, ventureId, slot, capMicros, phases);
  if (!reserved) throw new RebaselineError('rebaseline_venture_not_found', 'scheduled venture is unavailable');
  if (!reserved.inserted) {
    return {
      runId: reserved.runId, alreadyRunning: false, alreadyScheduled: true,
      phases: phases.map((phase) => phase.name),
    };
  }

  const budget = new ScheduledRunBudget(capMicros);
  inFlight.set(ventureId, reserved.runId);
  await driveRun({
    ctx, pool, ownerSub, ventureId, runId: reserved.runId, onDate, budget,
  }, 'rebaseline', phases, undefined, 'scheduled venture rebaseline crashed');

  return {
    runId: reserved.runId, alreadyRunning: false, alreadyScheduled: false,
    phases: phases.map((phase) => phase.name),
  };
}

/** Why a native run did not start this analyst; the next Run continues from it. */
function deferredReason(name: string): string {
  return `${DEFERRED}not started in this request — on this installation a request runs for at most 60 seconds, `
    + `which fits one analyst. Press Run the analysts again to continue with ${name}.`;
}

/** Run the analyst phases in order, isolating each failure; native runs defer what cannot fit. */
async function runAnalysts(
  p: PhaseCtx, phases: RunPhase[], spec: { name: string; ideaText: string; spec: Record<string, unknown> },
  failures: string[],
): Promise<void> {
  for (const phase of phases) {
    if (phase.name === 'compute' || phase.name === 'narrate') continue;
    const started = Date.now();
    if (p.nativeStartedAt !== undefined && started - p.nativeStartedAt > NATIVE_ANALYST_WINDOW_MS) {
      await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, phase.name, 'skipped', started,
        deferredReason(phase.name));
      continue;
    }
    await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, phase.name, 'running', started);
    try {
      const gaps = phase.name === 'bom' ? await phaseBom(p, spec)
        : phase.name === 'market' ? await phaseMarket(p, spec)
          : phase.name === 'ops' ? await phaseOps(p, spec) : [];
      const gap = gaps.length ? `${GAP}${gaps.join('; ')}` : undefined;
      if (gap) failures.push(`${phase.name}: ${gap}`);
      await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, phase.name, 'done', started, gap);
    } catch (err: any) {
      log.error({ err, stack: err?.stack, phase: phase.name, runId: p.runId }, 'venture phase failed');
      failures.push(`${phase.name}: ${err?.message || String(err)}`);
      const skipped = err instanceof RebaselineError
        && err.code === 'rebaseline_cost_cap_blocked';
      await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, phase.name,
        skipped ? 'skipped' : 'failed', started, err?.message || String(err));
    }
  }
}

/** Why a native run left its documents as they were: too little of the request remained to store them. */
export const DOCUMENTS_LATE = `${DEFERRED}the documents were not rendered again: too little of this request's 60 seconds was left `
  + 'after the analyst. They keep the numbers they were rendered from and say so; open one and press Regenerate prose '
  + 'to render it from the new numbers.';

/**
 * @description A native run's documents with no bot: every document is stored as rendered from the computed numbers, so
 * it can be opened and its prose added one document at a time (a narration per document fits one native request). With
 * less than NATIVE_DOCUMENTS_RESERVE_MS of the request left the documents are left as they were (DOCUMENTS_LATE).
 * @param p - The run's phase context (native).
 * @param phases - The run's phases.
 * @param snapshot - The computed snapshot.
 * @param docKeys - Documents to store; the whole catalogue when absent.
 * @param failures - The run's failure notes.
 * @param started - When the Documents phase started.
 * @returns Nothing; the Documents phase is marked.
 */
async function storeLateDocuments(
  p: PhaseCtx, phases: RunPhase[], snapshot: ModelSnapshot, docKeys: readonly string[] | undefined,
  failures: string[], started: number,
): Promise<void> {
  if (NATIVE_REQUEST_MS - (started - (p.nativeStartedAt as number)) < NATIVE_DOCUMENTS_RESERVE_MS) {
    await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, 'narrate', 'skipped', started, DOCUMENTS_LATE);
    return;
  }
  try {
    await phaseNarrate(p, snapshot, docKeys?.length ? docKeys : DOC_CATALOG.map((d) => d.key), false);
    await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, 'narrate', 'skipped', started,
      `${DEFERRED}documents were rendered from the computed numbers; open one and press Regenerate prose to add its written sections.`);
  } catch (err: any) {
    log.error({ err, stack: err?.stack, runId: p.runId }, 'computed documents could not be stored');
    failures.push(`narrate: ${err?.message || String(err)}`);
    await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, 'narrate', 'failed', started, err?.message || String(err));
  }
}

/** Narrate the documents of a computed run; a native full run leaves them to per-document Regenerate. */
async function runNarrate(
  p: PhaseCtx, kind: RunKind, phases: RunPhase[], snapshot: ModelSnapshot,
  docKeys: readonly string[] | undefined, failures: string[],
): Promise<void> {
  const started = Date.now();
  const late = p.nativeStartedAt !== undefined
    && (kind !== 'narrate' || started - p.nativeStartedAt > NATIVE_ANALYST_WINDOW_MS);
  if (late) { await storeLateDocuments(p, phases, snapshot, docKeys, failures, started); return; }
  await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, 'narrate', 'running', started);
  try {
    await phaseNarrate(p, snapshot, docKeys?.length ? docKeys : DOC_CATALOG.map((d) => d.key));
    await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases, 'narrate', 'done', started);
  } catch (err: any) {
    failures.push(`narrate: ${err?.message || String(err)}`);
    await mark(p.pool, p.ownerSub, p.ventureId, p.runId,
      phases, 'narrate', 'failed', started, err?.message || String(err));
  }
}

/** Walk the phases, isolating each failure, then close the run; a throw closes it failed. */
async function drive(
  p: PhaseCtx, kind: RunKind, phases: RunPhase[], docKeys: readonly string[] | undefined,
): Promise<void> {
  try {
    await walk(p, kind, phases, docKeys);
  } catch (err: any) {
    const reason = `run stopped: ${err?.message || String(err)}`;
    await closeRun(p.pool, p.ownerSub, p.ventureId, p.runId, 'failed', phases, reason);
    throw err;
  }
}

/** The phase walk itself: analysts, the free compute, narration, then the closing row. */
async function walk(
  p: PhaseCtx, kind: RunKind, phases: RunPhase[], docKeys: readonly string[] | undefined,
): Promise<void> {
  const venture = await getVenture(p.pool, p.ownerSub, p.ventureId);
  if (!venture) {
    await closeRun(p.pool, p.ownerSub, p.ventureId, p.runId,
      'failed', phases, 'venture not found');
    return;
  }
  const spec = {
    name: venture.name, ideaText: venture.ideaText,
    spec: venture.spec as unknown as Record<string, unknown>,
  };
  const failures: string[] = [];
  await runAnalysts(p, phases, spec, failures);

  const computeStarted = Date.now();
  await mark(p.pool, p.ownerSub, p.ventureId, p.runId,
    phases, 'compute', 'running', computeStarted);
  const computed = await recomputeVenture(p.pool, p.ownerSub, p.ventureId, {
    onDate: p.onDate, runId: p.runId,
  });
  await mark(p.pool, p.ownerSub, p.ventureId, p.runId, phases,
    'compute', computed ? 'done' : 'failed', computeStarted);

  if (computed && phases.some((x) => x.name === 'narrate')) {
    await runNarrate(p, kind, phases, computed.snapshot, docKeys, failures);
  }
  const deferred = phases.filter((x) => String(x.error || '').startsWith(DEFERRED)).map((x) => x.name);
  const notes = [...failures, ...(deferred.length ? [`not run yet: ${deferred.join(', ')}`] : [])];

  // A run with a failed phase is still `done` when it produced a model: the user
  // has a plan plus a named gap, which is more useful than a wholesale failure.
  await closeRun(p.pool, p.ownerSub, p.ventureId, p.runId,
    computed ? 'done' : 'failed', phases,
    notes.length ? notes.join(' | ') : null);
  log.info({ ventureId: p.ventureId, runId: p.runId, kind, failures: failures.length }, 'venture run closed');
}
