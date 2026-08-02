/**
 * Venture Plan — the HTTP surface.
 *
 * AUTH POSTURE, BOTH BELTS. The manifest mounts this router with
 * `requiresAuth: true`, and every handler ALSO resolves `callerSub(req)` and
 * refuses without one BEFORE it touches the pool. The mount is the wall; the
 * per-handler check is what makes each read owner-scoped; every store query is
 * parameterised on that sub, with owner-or-operator RLS underneath as the
 * backstop. Nothing here is anonymously callable, because everything here either
 * exposes somebody's business plan or spends their money.
 *
 * THE COST BOUNDARY IS A ROUTE-TABLE PROPERTY, NOT A CONVENTION.
 * Exactly two endpoints in this package can spend money: `POST /ventures` (one
 * short scoping call) and `POST /ventures/:id/runs` (the out-of-band authoring
 * run). Everything else — every recompute, every sensitivity sweep, every
 * document read — is pure arithmetic over stored rows. That is deliberate and it
 * is guarded: `POST /model` never reaching the bot client is what makes "edit an
 * assumption and watch the answer move, for free" a promise the app can keep.
 *
 * LONG WORK NEVER RUNS ON THE REQUEST PATH. A full authoring run is four bot calls
 * across four bots; it answers 202 with a run id and the surface polls
 * `GET /runs/:runId`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — venture CRUD with a synchronous scoping call, the append-only assumption endpoints, BOM/vendor/quote/scenario CRUD, the free recompute and sensitivity endpoints, the 202 run endpoint, and the concierge chat door. Every handler 401s before any query.
 *
 * @module venture-routes
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { createChildLogger } from '@/shared/logger';
import { sensitivitySweep, computeInversions, type Objective } from './venture-sensitivity';
import { withLedger, buildVentureModel } from './venture-model';
import { composeModelInput } from './venture-store-compose';
import { chat as botChat, scopeIdea } from './venture-bots';
import { parseScopeOutput } from './venture-bot-contracts';
import { ensureVentureSchema } from './venture-schema';
import { guarded, requireSub } from './venture-http';
import { registerDocumentRoutes } from './venture-routes-docs';
import { recomputeVenture, startRun } from './venture-run';
import {
  assumptionHistory, coverageOf, deleteVenture, getRun, getVenture, insertScenario,
  insertVenture, listRuns, listScenarios, listVentures, liveAssumptions, latestRun,
  updateScenario, updateVenture, upsertAssumption,
} from './venture-store';
import {
  applyQuote, deleteBomSubtree, insertBomLine, insertVendor, listBom, listHeadcount,
  listQuotes, listVendors, updateBomLine, updateVendor, type QuoteInput,
} from './venture-store-supply';
import { latestModel } from './venture-store-outputs';
import { DOC_CATALOG } from './venture-doc-catalog';
import type { AssumptionInput, RunKind } from './venture-types';
import { isConfidence, isDomain, isSourceKind } from './venture-types';

const log = createChildLogger({ module: 'venture-routes' });
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (ADR-085 D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** Run kinds a caller may ask for. Anything else is rejected rather than coerced. */
const RUN_KINDS: readonly RunKind[] = ['full', 'bom', 'market', 'ops', 'narrate'];

/**
 * @description Resolve the bundled surface directory, captured at FACTORY time.
 *
 * Never read the env var inside a handler: it points at whichever package mounted
 * last, so with two apps installed the wrong surface is served.
 *
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate directory that actually holds the surface file.
 */
export function surfaceDir(appPackageDir: string | undefined): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
    path.resolve(__dirname, '../tools'),
  ].filter(Boolean) as string[];
  return candidates.find((d) => fs.existsSync(path.join(d, 'venture.html')))
    || candidates[candidates.length - 1];
}

/** The modelling date. A request parameter so the engine never reads a clock. */
function onDateOf(req: Request): string {
  const raw = String(req.query.onDate ?? (req.body as { onDate?: unknown })?.onDate ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

/** GET / — the bundled console surface. */
function handleSurface(dir: string): RequestHandler {
  return (_req: Request, res: Response) => res.sendFile(path.join(dir, 'venture.html'));
}

/** GET /ventures and DELETE /ventures/:id. */
function handleVentureList(pool: Pool): { list: RequestHandler; remove: RequestHandler } {
  return {
    list: guarded('GET /ventures', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      res.json({ ventures: await listVentures(pool, sub) });
    }),
    remove: guarded('DELETE /ventures/:id', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const removed = await deleteVenture(pool, sub, String(req.params.id));
      if (!removed) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ ok: true });
    }),
  };
}

/**
 * POST /ventures — the one synchronous bot call in the package.
 *
 * Scoping is a single short reply and it is what the user is watching, so it runs
 * on the request path. A strategist that is down must not block venture creation:
 * the venture is created either way, with the open questions empty and the reason
 * on the record.
 */
function handleCreate(ctx: AppContext, pool: Pool): RequestHandler {
  return guarded('POST /ventures', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const idea = String((req.body as { idea?: unknown })?.idea ?? '').trim();
    if (idea.length < 10) {
      res.status(400).json({ error: 'describe the idea in at least a sentence' });
      return;
    }
    let scoped = { name: null as string | null, spec: {} as Record<string, unknown>, openQuestions: [] as string[] };
    let scopeError: string | null = null;
    try {
      const reply = await scopeIdea(ctx, botClient, sub, idea);
      scoped = parseScopeOutput(reply.text) as typeof scoped;
    } catch (err: any) {
      log.error({ err, stack: err?.stack, sub }, 'venture scoping call failed');
      scopeError = err?.message || String(err);
    }
    const body = req.body as Record<string, unknown>;
    const venture = await insertVenture(pool, sub, {
      name: String(body.name ?? scoped.name ?? idea.slice(0, 80)),
      ideaText: idea,
      spec: scoped.spec,
      currency: typeof body.currency === 'string' ? body.currency.slice(0, 3) : 'USD',
      targetLaunchDate: typeof body.targetLaunchDate === 'string' ? body.targetLaunchDate : null,
      openQuestions: scoped.openQuestions,
    });
    res.status(201).json({ venture, openQuestions: scoped.openQuestions, scopeError });
  });
}

/** GET /ventures/:id — the header plus everything the surface needs to open it. */
function handleVentureRead(pool: Pool): RequestHandler {
  return guarded('GET /ventures/:id', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const id = String(req.params.id);
    const venture = await getVenture(pool, sub, id);
    if (!venture) { res.status(404).json({ error: 'not found' }); return; }
    const [scenarios, assumptions, bom, vendors, quotes, model, run] = await Promise.all([
      listScenarios(pool, sub, id), liveAssumptions(pool, sub, id), listBom(pool, sub, id),
      listVendors(pool, sub, id), listQuotes(pool, sub, id),
      latestModel(pool, sub, id, null), latestRun(pool, sub, id),
    ]);
    res.json({
      venture, scenarios,
      counts: {
        assumptions: assumptions.length, bomLines: bom.length,
        vendors: vendors.length, quotes: quotes.length,
      },
      coverage: coverageOf(assumptions),
      latestModel: model ? {
        id: model.id, computedAt: model.computedAt, posture: model.posture,
        canPublish: model.canPublish, warnings: model.warnings.length,
      } : null,
      latestRun: run,
      documentCatalog: DOC_CATALOG.map((d) => ({ key: d.key, title: d.title, decision: d.decision })),
    });
  });
}

/** PATCH /ventures/:id — header edits only; the spec is replaced wholesale. */
function handleVenturePatch(pool: Pool): RequestHandler {
  return guarded('PATCH /ventures/:id', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const venture = await updateVenture(pool, sub, String(req.params.id), req.body as Record<string, unknown>);
    if (!venture) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ venture });
  });
}

/** Validate an assumption write from a human. Returns the row or the reason. */
function parseAssumptionBody(body: Record<string, unknown>, key: string): { row?: AssumptionInput; error?: string } {
  if (!/^[a-z0-9][a-z0-9.\-]{2,158}$/i.test(key)) return { error: 'bad assumption key' };
  if (!isDomain(body.domain)) return { error: 'unknown domain' };
  if (!isConfidence(body.confidence)) return { error: 'unknown confidence' };
  const valueNum = typeof body.valueNum === 'number' && Number.isFinite(body.valueNum) ? body.valueNum : null;
  const valueText = typeof body.valueText === 'string' ? body.valueText : null;
  if (valueNum === null && !valueText) return { error: 'an assumption needs a value' };
  // A human may state `user-entered` or `published-source`; `vendor-quote` is
  // reserved for POST /quotes, where a real quote document is recorded with it.
  const claimed = isSourceKind(body.sourceKind) ? body.sourceKind : 'user-entered';
  return {
    row: {
      key, domain: body.domain, label: String(body.label ?? key).slice(0, 300),
      unit: String(body.unit ?? 'ratio').slice(0, 24),
      valueNum, valueText,
      lowNum: typeof body.lowNum === 'number' && Number.isFinite(body.lowNum) ? body.lowNum : null,
      highNum: typeof body.highNum === 'number' && Number.isFinite(body.highNum) ? body.highNum : null,
      sourceKind: claimed === 'vendor-quote' ? 'user-entered' : claimed,
      sourceDetail: typeof body.sourceDetail === 'string' ? body.sourceDetail.slice(0, 500) : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 500) : null,
      confidence: body.confidence,
    },
  };
}

/** The assumption endpoints. Writes are append-only; there is no update path. */
function handleAssumptions(pool: Pool): Record<string, RequestHandler> {
  const write = guarded('write assumption', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const id = String(req.params.id);
    if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = String(req.params.key ?? body.key ?? '');
    const parsed = parseAssumptionBody(body, key);
    if (!parsed.row) { res.status(400).json({ error: parsed.error }); return; }
    const written = await upsertAssumption(pool, sub, id, parsed.row, `user:${sub}`, null);
    res.status(req.params.key ? 200 : 201).json(written);
  });
  return {
    list: guarded('GET /ventures/:id/assumptions', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const all = await liveAssumptions(pool, sub, id);
      const domain = req.query.domain ? String(req.query.domain) : null;
      const rows = domain ? all.filter((a) => a.domain === domain) : all;
      res.json({ assumptions: rows, summary: coverageOf(all) });
    }),
    create: write,
    update: write,
    history: guarded('GET /ventures/:id/assumptions/:key/history', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ revisions: await assumptionHistory(pool, sub, id, String(req.params.key)) });
    }),
  };
}

/** True when the venture exists AND belongs to the caller. */
async function owns(pool: Pool, sub: string, id: string): Promise<boolean> {
  return Boolean(await getVenture(pool, sub, id));
}

/** The BOM endpoints. */
function handleBom(pool: Pool): Record<string, RequestHandler> {
  const own = (sub: string, id: string) => owns(pool, sub, id);
  return {
    bomList: guarded('GET /ventures/:id/bom', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await own(sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ lines: await listBom(pool, sub, id) });
    }),
    bomCreate: guarded('POST /ventures/:id/bom', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await own(sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.ref || !body.partName) { res.status(400).json({ error: 'ref and partName are required' }); return; }
      res.status(201).json({ line: await insertBomLine(pool, sub, id, { sourceKind: 'user-entered', confidence: 'medium', ...body }) });
    }),
    bomPatch: guarded('PATCH /ventures/:id/bom/:lineId', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const line = await updateBomLine(pool, sub, String(req.params.id), String(req.params.lineId), (req.body ?? {}) as Record<string, unknown>);
      if (!line) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ line });
    }),
    bomDelete: guarded('DELETE /ventures/:id/bom/:lineId', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const ok = await deleteBomSubtree(pool, sub, String(req.params.id), String(req.params.lineId));
      if (!ok) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ ok: true });
    }),
  };
}

/** The vendor and quote endpoints. */
function handleVendors(pool: Pool): Record<string, RequestHandler> {
  const own = (sub: string, id: string) => owns(pool, sub, id);
  return {
    vendorList: guarded('GET /ventures/:id/vendors', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await own(sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ vendors: await listVendors(pool, sub, id) });
    }),
    vendorCreate: guarded('POST /ventures/:id/vendors', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await own(sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.name) { res.status(400).json({ error: 'name is required' }); return; }
      res.status(201).json({ vendor: await insertVendor(pool, sub, id, { sourceKind: 'user-entered', confidence: 'medium', ...body }) });
    }),
    vendorPatch: guarded('PATCH /ventures/:id/vendors/:vendorId', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const vendor = await updateVendor(pool, sub, String(req.params.id), String(req.params.vendorId), (req.body ?? {}) as Record<string, unknown>);
      if (!vendor) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ vendor });
    }),
  };
}

/**
 * The quote endpoints. Recording a received quote is the ONE action in this app
 * that can write `vendor-quote` provenance, because it is the one action a human
 * takes with a real quote document in front of them.
 */
function handleQuotes(pool: Pool): Record<string, RequestHandler> {
  const own = (sub: string, id: string) => owns(pool, sub, id);
  return {
    quoteList: guarded('GET /ventures/:id/quotes', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await own(sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ quotes: await listQuotes(pool, sub, id) });
    }),
    quoteCreate: guarded('POST /ventures/:id/quotes', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await own(sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const cost = typeof body.unitCostMicros === 'number' ? body.unitCostMicros : NaN;
      if (!body.vendorId || !Number.isFinite(cost) || cost < 0) {
        res.status(400).json({ error: 'vendorId and a non-negative unitCostMicros are required' });
        return;
      }
      const applied = await applyQuote(pool, sub, id, {
        ...(body as Record<string, unknown>), unitCostMicros: Math.round(cost),
      } as unknown as QuoteInput);
      // The quote changed a number, so the model that stood on the old one is
      // stale the moment this returns. Recompute here rather than hoping the
      // surface remembers to ask.
      const recomputed = await recomputeVenture(pool, sub, id, { onDate: onDateOf(req) });
      res.status(201).json({
        ...applied,
        model: recomputed ? summariseModel(recomputed) : null,
      });
    }),
  };
}

/** The compact model summary every compute-ish endpoint answers with. */
function summariseModel(r: NonNullable<Awaited<ReturnType<typeof recomputeVenture>>>) {
  return {
    modelId: r.snapshot.id,
    computedAt: r.snapshot.computedAt,
    engineVersion: r.snapshot.engineVersion,
    inputsHash: r.snapshot.inputsHash,
    posture: r.snapshot.posture,
    canPublish: r.snapshot.canPublish,
    coverage: r.snapshot.coverage,
    figures: r.snapshot.figures,
    tables: r.snapshot.tables,
    warnings: r.snapshot.warnings,
    missingAssumptionKeys: r.missingAssumptionKeys,
  };
}

/** The scenario endpoints. Overrides only; the arithmetic lives in the engine. */
function handleScenarios(pool: Pool): Record<string, RequestHandler> {
  return {
    scenarioList: guarded('GET /ventures/:id/scenarios', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ scenarios: await listScenarios(pool, sub, id) });
    }),
    scenarioCreate: guarded('POST /ventures/:id/scenarios', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.name) { res.status(400).json({ error: 'name is required' }); return; }
      res.status(201).json({ scenario: await insertScenario(pool, sub, id, body as never) });
    }),
    scenarioPatch: guarded('PATCH /ventures/:id/scenarios/:scenarioId', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const s = await updateScenario(pool, sub, String(req.params.id), String(req.params.scenarioId), (req.body ?? {}) as never);
      if (!s) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ scenario: s });
    }),
  };
}

/**
 * Model, figure-derivation, sensitivity and inversion endpoints. ALL LLM-FREE —
 * the guard suite asserts the bot client stays at zero calls across every one of
 * them, because a recompute that spends would end the editing loop this app is
 * built around.
 */
function handleModel(pool: Pool): Record<string, RequestHandler> {
  return {
    compute: guarded('POST /ventures/:id/model', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const r = await recomputeVenture(pool, sub, String(req.params.id), {
        scenarioId: typeof body.scenarioId === 'string' ? body.scenarioId : null,
        onDate: onDateOf(req),
      });
      if (!r) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ model: summariseModel(r) });
    }),
    readModel: guarded('GET /ventures/:id/model', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const m = await latestModel(pool, sub, id, req.query.scenarioId ? String(req.query.scenarioId) : null);
      res.json({ model: m });
    }),
    figure: handleFigureDerivation(pool),
    sensitivity: guarded('GET /ventures/:id/sensitivity', handleSensitivity(pool)),
    inversion: handleInversion(pool),
  };
}

/**
 * GET /ventures/:id/model/figures/:figureKey — one figure and what it rests on.
 *
 * The endpoint behind "click any number to see where it came from". An input the
 * ledger does not hold is returned marked `unregistered` rather than omitted: a
 * derivation that quietly dropped its weakest link would read as complete.
 */
function handleFigureDerivation(pool: Pool): RequestHandler {
  return guarded('GET /ventures/:id/model/figures/:figureKey', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const m = await latestModel(pool, sub, id, null);
      const figure = m?.figures?.[String(req.params.figureKey)];
      if (!figure) { res.status(404).json({ error: 'no such figure in the latest model' }); return; }
      const assumptions = await liveAssumptions(pool, sub, id);
      const refs = ((figure as { assumptionRefs?: string[] }).assumptionRefs ?? []);
      res.json({
        figure,
        derivation: {
          formula: (figure as { formula?: string }).formula ?? '',
          inputs: refs.map((ref) => {
            const a = assumptions.find((x) => x.key === ref);
            return a
              ? { ref, kind: 'assumption', label: a.label, value: a.valueNum, unit: a.unit,
                sourceKind: a.sourceKind, confidence: a.confidence, assumptionId: a.id }
              : { ref, kind: 'assumption', label: null, value: null, unit: null,
                sourceKind: null, confidence: null, assumptionId: null, unregistered: true };
          }),
        },
      });
  });
}

/** GET /ventures/:id/inversion — the closed-form "what would have to be true" answers. */
function handleInversion(pool: Pool): RequestHandler {
  return guarded('GET /ventures/:id/inversion', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const built = await buildModelFor(pool, sub, String(req.params.id), onDateOf(req));
      if (!built) { res.status(404).json({ error: 'not found' }); return; }
      // The three questions an operator asks before committing: what can this cost
      // at the factory gate, what can it cost landed, and how much of the run has
      // to sell. Split from the sweep because they are closed-form and cheap —
      // making somebody pay 2N model rebuilds to see a break-even sell-through
      // would be a latency defect, not a feature.
      res.json({
        inversions: computeInversions({
          model: built.model, modelInput: built.input,
          requiredContributionBps: Number(req.query.requiredContributionBps ?? 3000),
        }),
        posture: built.model.posture,
        canPublish: built.model.canPublish,
      });
  });
}

/**
 * @description Compose and build a venture's model without persisting a snapshot.
 *
 * Used by the read-only analysis endpoints. They answer questions ABOUT a model
 * rather than declaring a new one, and writing a snapshot row on every page view
 * would make the model history unreadable.
 *
 * @param pool - Shared pool.
 * @param sub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param onDate - The modelling date.
 * @returns The built model and the input it came from, or null when not the
 *   caller's venture.
 */
async function buildModelFor(pool: Pool, sub: string, ventureId: string, onDate: string) {
  const venture = await getVenture(pool, sub, ventureId);
  if (!venture) return null;
  const [assumptions, bomLines, vendors, headcount] = await Promise.all([
    liveAssumptions(pool, sub, ventureId), listBom(pool, sub, ventureId),
    listVendors(pool, sub, ventureId), listHeadcount(pool, sub, ventureId),
  ]);
  const composed = composeModelInput({
    venture, assumptions, bomLines, vendors, headcount, scenario: null, onDate,
  });
  return { model: buildVentureModel(composed.input), input: composed.input, composed };
}

/** GET /ventures/:id/sensitivity — a real one-at-a-time sweep, rebuilding the model. */
function handleSensitivity(pool: Pool): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const built = await buildModelFor(pool, sub, String(req.params.id), onDateOf(req));
    if (!built) { res.status(404).json({ error: 'not found' }); return; }
    const composed = built.composed;
    const base = built.model;
    const objective = (['peak-cash', 'contribution-per-unit', 'break-even-units', 'total-net-income']
      .includes(String(req.query.objective)) ? String(req.query.objective) : 'total-net-income') as Objective;
    // Only banded assumptions are swept. One with no stated band is EXCLUDED
    // rather than swung over an invented range — that would be the model
    // inventing its own uncertainty.
    const inputs = composed.input.ledger.order
      .filter((aid) => composed.input.ledger.byId[aid].band)
      .map((aid) => ({ assumptionId: aid, label: composed.input.ledger.byId[aid].label }));
    const sweep = sensitivitySweep({
      ledger: composed.input.ledger, inputs, objective, base,
      rebuild: (ledger) => buildVentureModel(withLedger(composed.input, ledger)),
    });
    const inversions = computeInversions({
      model: base, modelInput: composed.input,
      requiredContributionBps: Number(req.query.requiredContributionBps ?? 3000),
    });
    res.json({
      objective, tornado: sweep.bars, topThree: sweep.topThree, inversions,
      excludedForNoBand: composed.input.ledger.order.length - inputs.length,
      issues: [...sweep.issues, ...inversions.issues],
    });
  };
}

/** POST /ventures/:id/runs and the run pollers. */
function handleRuns(ctx: AppContext, pool: Pool): Record<string, RequestHandler> {
  return {
    start: guarded('POST /ventures/:id/runs', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const kind = RUN_KINDS.includes(body.kind as RunKind) ? body.kind as RunKind : 'full';
      const docKeys = Array.isArray(body.docKeys)
        ? body.docKeys.filter((k): k is string => typeof k === 'string') : undefined;
      const started = await startRun(ctx, sub, id, kind, docKeys, onDateOf(req));
      res.status(202).json({ ...started, kind });
    }),
    list: guarded('GET /ventures/:id/runs', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const id = String(req.params.id);
      if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ runs: await listRuns(pool, sub, id) });
    }),
    read: guarded('GET /runs/:runId', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const run = await getRun(pool, sub, String(req.params.runId));
      if (!run) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ run });
    }),
  };
}

/** POST /chat — the ADR-036 concierge door. Spends, so it is an explicit POST. */
function handleChat(ctx: AppContext, pool: Pool): RequestHandler {
  return guarded('POST /chat', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }
    let context: unknown = { ventures: (await listVentures(pool, sub)).map((v) => ({ id: v.id, name: v.name, stage: v.stage })) };
    const ventureId = typeof body.ventureId === 'string' ? body.ventureId : null;
    if (ventureId) {
      const venture = await getVenture(pool, sub, ventureId);
      if (!venture) { res.status(404).json({ error: 'not found' }); return; }
      const [assumptions, model] = await Promise.all([
        liveAssumptions(pool, sub, ventureId), latestModel(pool, sub, ventureId, null),
      ]);
      context = {
        venture: { name: venture.name, stage: venture.stage, idea: venture.ideaText },
        coverage: coverageOf(assumptions),
        assumptions: assumptions.map((a) => ({ key: a.key, label: a.label, value: a.valueNum, unit: a.unit, source: a.sourceKind, confidence: a.confidence })),
        figures: model?.figures ?? null,
        posture: model?.posture ?? null,
        canPublish: model?.canPublish ?? false,
      };
    }
    const reply = await botChat(ctx, botClient, sub, message, context);
    res.json({ reply: reply.text, ventureId, costUsd: reply.costUsd, model: reply.model });
  });
}

/**
 * @description Build the `/api/venture` router.
 *
 * The schema is ensured once here at factory time rather than per request. A
 * failure is logged loudly and the routes still mount, so the surface can report
 * the problem instead of 404ing and looking like a missing app.
 *
 * @param ctx - The framework app context (pool, orchestrator, appPackageDir).
 * @returns The Express router for this package.
 */
export function createVentureRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool as Pool;
  const dir = surfaceDir(ctx.appPackageDir);

  ensureVentureSchema(pool).catch((err: any) =>
    log.error({ err, stack: err?.stack }, 'venture schema bootstrap failed — the surface will report empty state'));

  const ventures = handleVentureList(pool);
  const assumptions = handleAssumptions(pool);
  const bom = handleBom(pool);
  const vendors = handleVendors(pool);
  const quotes = handleQuotes(pool);
  const scenarios = handleScenarios(pool);
  const compute = handleModel(pool);
  const runs = handleRuns(ctx, pool);

  router.get('/', handleSurface(dir));
  router.get('/app', handleSurface(dir));

  router.get('/ventures', ventures.list);
  router.post('/ventures', handleCreate(ctx, pool));
  router.get('/ventures/:id', handleVentureRead(pool));
  router.patch('/ventures/:id', handleVenturePatch(pool));
  router.delete('/ventures/:id', ventures.remove);

  router.post('/ventures/:id/runs', runs.start);
  router.get('/ventures/:id/runs', runs.list);
  router.get('/runs/:runId', runs.read);

  router.get('/ventures/:id/assumptions', assumptions.list);
  router.post('/ventures/:id/assumptions', assumptions.create);
  router.patch('/ventures/:id/assumptions/:key', assumptions.update);
  router.get('/ventures/:id/assumptions/:key/history', assumptions.history);

  router.get('/ventures/:id/bom', bom.bomList);
  router.post('/ventures/:id/bom', bom.bomCreate);
  router.patch('/ventures/:id/bom/:lineId', bom.bomPatch);
  router.delete('/ventures/:id/bom/:lineId', bom.bomDelete);
  router.get('/ventures/:id/vendors', vendors.vendorList);
  router.post('/ventures/:id/vendors', vendors.vendorCreate);
  router.patch('/ventures/:id/vendors/:vendorId', vendors.vendorPatch);
  router.get('/ventures/:id/quotes', quotes.quoteList);
  router.post('/ventures/:id/quotes', quotes.quoteCreate);

  router.get('/ventures/:id/scenarios', scenarios.scenarioList);
  router.post('/ventures/:id/scenarios', scenarios.scenarioCreate);
  router.patch('/ventures/:id/scenarios/:scenarioId', scenarios.scenarioPatch);
  router.post('/ventures/:id/model', compute.compute);
  router.get('/ventures/:id/model', compute.readModel);
  router.get('/ventures/:id/model/figures/:figureKey', compute.figure);
  router.get('/ventures/:id/sensitivity', compute.sensitivity);
  router.get('/ventures/:id/inversion', compute.inversion);

  router.post('/chat', handleChat(ctx, pool));

  registerDocumentRoutes(router, ctx, pool);

  log.info({ surfaceDir: dir, documents: DOC_CATALOG.length }, 'venture-plan routes mounted');
  return router;
}
