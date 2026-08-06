"use strict";
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
 * Exactly three endpoints on this interactive router can spend money:
 * `POST /ventures` (one short scoping call), `POST /ventures/:id/runs` (the
 * out-of-band authoring run), and explicit `POST /chat`. Everything else — every
 * recompute, sensitivity sweep, and document read — is pure arithmetic over
 * stored rows. That is deliberate and it
 * is guarded: `POST /model` never reaching the bot client is what makes "edit an
 * assumption and watch the answer move, for free" a promise the app can keep.
 *
 * LONG WORK NEVER RUNS ON THE REQUEST PATH. A full authoring run has three analyst
 * calls plus narration for each requested prose-bearing document. It answers 202
 * with a run id and the surface polls `GET /runs/:runId`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — venture CRUD with a synchronous scoping call, the append-only assumption endpoints, BOM/vendor/quote/scenario CRUD, the free recompute and sensitivity endpoints, the 202 run endpoint, and the concierge chat door. Every handler 401s before any query.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add owner-scoped immutable FX endpoints, fail-closed foreign-quote errors, and integer-micro scenario inputs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add owner-scoped default-deny rebaseline policy management and a mutation-free UTC preview endpoint.
 *
 * @module venture-routes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.surfaceDir = surfaceDir;
exports.createVentureRoutes = createVentureRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const agent_management_1 = require("@/features/agent-management");
const logger_1 = require("@/shared/logger");
const venture_sensitivity_1 = require("./venture-sensitivity");
const venture_model_1 = require("./venture-model");
const venture_store_compose_1 = require("./venture-store-compose");
const venture_bots_1 = require("./venture-bots");
const venture_bot_contracts_1 = require("./venture-bot-contracts");
const venture_schema_1 = require("./venture-schema");
const venture_http_1 = require("./venture-http");
const venture_routes_docs_1 = require("./venture-routes-docs");
const venture_run_1 = require("./venture-run");
const venture_store_1 = require("./venture-store");
const venture_store_supply_1 = require("./venture-store-supply");
const venture_store_outputs_1 = require("./venture-store-outputs");
const venture_store_fx_1 = require("./venture-store-fx");
const venture_currency_1 = require("./venture-currency");
const venture_rebaseline_1 = require("./venture-rebaseline");
const venture_store_rebaseline_1 = require("./venture-store-rebaseline");
const venture_doc_catalog_1 = require("./venture-doc-catalog");
const venture_types_1 = require("./venture-types");
const log = (0, logger_1.createChildLogger)({ module: 'venture-routes' });
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (ADR-085 D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/** Run kinds a caller may ask for. Anything else is rejected rather than coerced. */
const RUN_KINDS = ['full', 'bom', 'market', 'ops', 'narrate'];
/** Answer an expected FX refusal without turning user input into a 500. */
function replyFxError(res, err) {
    if (!(err instanceof venture_currency_1.VentureFxError))
        return false;
    const notFound = new Set([
        'fx_assumption_not_found', 'fx_venture_not_found',
        'quote_vendor_not_found', 'quote_bom_line_not_found',
    ]);
    const status = err.code === 'fx_idempotency_conflict' ? 409
        : notFound.has(err.code) ? 404 : 400;
    res.status(status).json({ error: err.code, detail: err.message });
    return true;
}
/** Answer a closed rebaseline policy validation error as caller input, not 500. */
function replyRebaselineError(res, err) {
    if (!(err instanceof venture_rebaseline_1.RebaselineError))
        return false;
    res.status(400).json({ error: err.code, detail: err.message });
    return true;
}
/**
 * @description Resolve the bundled surface directory, captured at FACTORY time.
 *
 * Never read the env var inside a handler: it points at whichever package mounted
 * last, so with two apps installed the wrong surface is served.
 *
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate directory that actually holds the surface file.
 */
function surfaceDir(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
        path.resolve(__dirname, '../tools'),
    ].filter(Boolean);
    return candidates.find((d) => fs.existsSync(path.join(d, 'venture.html')))
        || candidates[candidates.length - 1];
}
/** The modelling date. A request parameter so the engine never reads a clock. */
function onDateOf(req) {
    const raw = String(req.query.onDate ?? req.body?.onDate ?? '');
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}
/** GET / — the bundled console surface. */
function handleSurface(dir) {
    return (_req, res) => res.sendFile(path.join(dir, 'venture.html'));
}
/** GET /ventures and DELETE /ventures/:id. */
function handleVentureList(pool) {
    return {
        list: (0, venture_http_1.guarded)('GET /ventures', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            res.json({ ventures: await (0, venture_store_1.listVentures)(pool, sub) });
        }),
        remove: (0, venture_http_1.guarded)('DELETE /ventures/:id', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const removed = await (0, venture_store_1.deleteVenture)(pool, sub, String(req.params.id));
            if (!removed) {
                res.status(404).json({ error: 'not found' });
                return;
            }
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
function handleCreate(ctx, pool) {
    return (0, venture_http_1.guarded)('POST /ventures', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const idea = String(req.body?.idea ?? '').trim();
        if (idea.length < 10) {
            res.status(400).json({ error: 'describe the idea in at least a sentence' });
            return;
        }
        const body = req.body;
        let currency;
        try {
            currency = (0, venture_currency_1.normalizeCurrencyCode)(body.currency ?? 'USD');
        }
        catch (err) {
            if (replyFxError(res, err))
                return;
            throw err;
        }
        let scoped = { name: null, spec: {}, openQuestions: [] };
        let scopeError = null;
        try {
            const reply = await (0, venture_bots_1.scopeIdea)(ctx, botClient, sub, idea);
            scoped = (0, venture_bot_contracts_1.parseScopeOutput)(reply.text);
        }
        catch (err) {
            log.error({ err, stack: err?.stack, sub }, 'venture scoping call failed');
            scopeError = err?.message || String(err);
        }
        const venture = await (0, venture_store_1.insertVenture)(pool, sub, {
            name: String(body.name ?? scoped.name ?? idea.slice(0, 80)),
            ideaText: idea,
            spec: scoped.spec,
            currency,
            targetLaunchDate: typeof body.targetLaunchDate === 'string' ? body.targetLaunchDate : null,
            openQuestions: scoped.openQuestions,
        });
        res.status(201).json({ venture, openQuestions: scoped.openQuestions, scopeError });
    });
}
/** GET /ventures/:id — the header plus everything the surface needs to open it. */
function handleVentureRead(pool) {
    return (0, venture_http_1.guarded)('GET /ventures/:id', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        const venture = await (0, venture_store_1.getVenture)(pool, sub, id);
        if (!venture) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const [scenarios, assumptions, bom, vendors, quotes, fxAssumptions, model, run] = await Promise.all([
            (0, venture_store_1.listScenarios)(pool, sub, id), (0, venture_store_1.liveAssumptions)(pool, sub, id), (0, venture_store_supply_1.listBom)(pool, sub, id),
            (0, venture_store_supply_1.listVendors)(pool, sub, id), (0, venture_store_supply_1.listQuotes)(pool, sub, id),
            (0, venture_store_fx_1.listFxAssumptions)(pool, sub, id),
            (0, venture_store_outputs_1.latestModel)(pool, sub, id, null), (0, venture_store_1.latestRun)(pool, sub, id),
        ]);
        res.json({
            venture, scenarios,
            counts: {
                assumptions: assumptions.length, bomLines: bom.length,
                vendors: vendors.length, quotes: quotes.length, fxAssumptions: fxAssumptions.length,
            },
            coverage: (0, venture_store_1.coverageOf)(assumptions),
            latestModel: model ? {
                id: model.id, computedAt: model.computedAt, posture: model.posture,
                canPublish: model.canPublish, warnings: model.warnings.length,
            } : null,
            latestRun: run,
            fxAssumptions,
            documentCatalog: venture_doc_catalog_1.DOC_CATALOG.map((d) => ({ key: d.key, title: d.title, decision: d.decision })),
        });
    });
}
/** PATCH /ventures/:id — header edits only; the spec is replaced wholesale. */
function handleVenturePatch(pool) {
    return (0, venture_http_1.guarded)('PATCH /ventures/:id', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const venture = await (0, venture_store_1.updateVenture)(pool, sub, String(req.params.id), req.body);
        if (!venture) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.json({ venture });
    });
}
/** Validate an assumption write from a human. Returns the row or the reason. */
function parseAssumptionBody(body, key) {
    if (!/^[a-z0-9][a-z0-9.\-]{2,158}$/i.test(key))
        return { error: 'bad assumption key' };
    if (!(0, venture_types_1.isDomain)(body.domain))
        return { error: 'unknown domain' };
    if (!(0, venture_types_1.isConfidence)(body.confidence))
        return { error: 'unknown confidence' };
    const valueNum = typeof body.valueNum === 'number' && Number.isFinite(body.valueNum) ? body.valueNum : null;
    const valueText = typeof body.valueText === 'string' ? body.valueText : null;
    if (valueNum === null && !valueText)
        return { error: 'an assumption needs a value' };
    // A human may state `user-entered` or `published-source`; `vendor-quote` is
    // reserved for POST /quotes, where a real quote document is recorded with it.
    const claimed = (0, venture_types_1.isSourceKind)(body.sourceKind) ? body.sourceKind : 'user-entered';
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
function handleAssumptions(pool) {
    const write = (0, venture_http_1.guarded)('write assumption', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const body = (req.body ?? {});
        const key = String(req.params.key ?? body.key ?? '');
        const parsed = parseAssumptionBody(body, key);
        if (!parsed.row) {
            res.status(400).json({ error: parsed.error });
            return;
        }
        const written = await (0, venture_store_1.upsertAssumption)(pool, sub, id, parsed.row, `user:${sub}`, null);
        res.status(req.params.key ? 200 : 201).json(written);
    });
    return {
        list: (0, venture_http_1.guarded)('GET /ventures/:id/assumptions', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const all = await (0, venture_store_1.liveAssumptions)(pool, sub, id);
            const domain = req.query.domain ? String(req.query.domain) : null;
            const rows = domain ? all.filter((a) => a.domain === domain) : all;
            res.json({ assumptions: rows, summary: (0, venture_store_1.coverageOf)(all) });
        }),
        create: write,
        update: write,
        history: (0, venture_http_1.guarded)('GET /ventures/:id/assumptions/:key/history', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ revisions: await (0, venture_store_1.assumptionHistory)(pool, sub, id, String(req.params.key)) });
        }),
    };
}
/** True when the venture exists AND belongs to the caller. */
async function owns(pool, sub, id) {
    return Boolean(await (0, venture_store_1.getVenture)(pool, sub, id));
}
/** The BOM endpoints. */
function handleBom(pool) {
    const own = (sub, id) => owns(pool, sub, id);
    return {
        bomList: (0, venture_http_1.guarded)('GET /ventures/:id/bom', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await own(sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ lines: await (0, venture_store_supply_1.listBom)(pool, sub, id) });
        }),
        bomCreate: (0, venture_http_1.guarded)('POST /ventures/:id/bom', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await own(sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            if (!body.ref || !body.partName) {
                res.status(400).json({ error: 'ref and partName are required' });
                return;
            }
            res.status(201).json({ line: await (0, venture_store_supply_1.insertBomLine)(pool, sub, id, { sourceKind: 'user-entered', confidence: 'medium', ...body }) });
        }),
        bomPatch: (0, venture_http_1.guarded)('PATCH /ventures/:id/bom/:lineId', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const line = await (0, venture_store_supply_1.updateBomLine)(pool, sub, String(req.params.id), String(req.params.lineId), (req.body ?? {}));
            if (!line) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ line });
        }),
        bomDelete: (0, venture_http_1.guarded)('DELETE /ventures/:id/bom/:lineId', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const ok = await (0, venture_store_supply_1.deleteBomSubtree)(pool, sub, String(req.params.id), String(req.params.lineId));
            if (!ok) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ ok: true });
        }),
    };
}
/** The vendor and quote endpoints. */
function handleVendors(pool) {
    const own = (sub, id) => owns(pool, sub, id);
    return {
        vendorList: (0, venture_http_1.guarded)('GET /ventures/:id/vendors', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await own(sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ vendors: await (0, venture_store_supply_1.listVendors)(pool, sub, id) });
        }),
        vendorCreate: (0, venture_http_1.guarded)('POST /ventures/:id/vendors', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await own(sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            if (!body.name) {
                res.status(400).json({ error: 'name is required' });
                return;
            }
            res.status(201).json({ vendor: await (0, venture_store_supply_1.insertVendor)(pool, sub, id, { sourceKind: 'user-entered', confidence: 'medium', ...body }) });
        }),
        vendorPatch: (0, venture_http_1.guarded)('PATCH /ventures/:id/vendors/:vendorId', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const vendor = await (0, venture_store_supply_1.updateVendor)(pool, sub, String(req.params.id), String(req.params.vendorId), (req.body ?? {}));
            if (!vendor) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ vendor });
        }),
    };
}
/** Immutable FX evidence endpoints. There is deliberately no PATCH or DELETE. */
function handleFxAssumptions(pool) {
    return {
        list: (0, venture_http_1.guarded)('GET /ventures/:id/fx-assumptions', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ fxAssumptions: await (0, venture_store_fx_1.listFxAssumptions)(pool, sub, id) });
        }),
        read: (0, venture_http_1.guarded)('GET /ventures/:id/fx-assumptions/:fxId', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const fx = await (0, venture_store_fx_1.getFxAssumption)(pool, sub, String(req.params.id), String(req.params.fxId));
            if (!fx) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ fxAssumption: fx });
        }),
        create: (0, venture_http_1.guarded)('POST /ventures/:id/fx-assumptions', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            const venture = await (0, venture_store_1.getVenture)(pool, sub, id);
            if (!venture) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            try {
                const reportingCurrency = (0, venture_currency_1.normalizeCurrencyCode)(body.reportingCurrency, 'reportingCurrency');
                if (reportingCurrency !== (0, venture_currency_1.normalizeCurrencyCode)(venture.currency, 'venture currency')) {
                    throw new venture_currency_1.VentureFxError('fx_reporting_currency_mismatch', 'reportingCurrency must match the venture currency');
                }
                const result = await (0, venture_store_fx_1.insertFxAssumption)(pool, sub, id, {
                    sourceCurrency: String(body.sourceCurrency ?? ''),
                    reportingCurrency,
                    rateNanos: body.rateNanos,
                    sourceKind: String(body.sourceKind ?? 'user-entered'),
                    sourceRef: String(body.sourceRef ?? ''),
                    observedAt: String(body.observedAt ?? ''),
                    idempotencyKey: String(body.idempotencyKey ?? ''),
                }, `user:${sub}`);
                res.status(result.inserted ? 201 : 200).json({
                    fxAssumption: result.assumption, idempotentReplay: !result.inserted,
                });
            }
            catch (err) {
                if (!replyFxError(res, err))
                    throw err;
            }
        }),
    };
}
/**
 * The quote endpoints. Recording a received quote is the ONE action in this app
 * that can write `vendor-quote` provenance, because it is the one action a human
 * takes with a real quote document in front of them.
 */
function handleQuotes(pool) {
    const own = (sub, id) => owns(pool, sub, id);
    return {
        quoteList: (0, venture_http_1.guarded)('GET /ventures/:id/quotes', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await own(sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ quotes: await (0, venture_store_supply_1.listQuotes)(pool, sub, id) });
        }),
        quoteCreate: (0, venture_http_1.guarded)('POST /ventures/:id/quotes', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await own(sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            const cost = body.unitCostMicros;
            if (!body.vendorId || typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 0) {
                res.status(400).json({ error: 'vendorId and non-negative integer unitCostMicros are required' });
                return;
            }
            let applied;
            try {
                applied = await (0, venture_store_supply_1.applyQuote)(pool, sub, id, body);
            }
            catch (err) {
                if (replyFxError(res, err))
                    return;
                throw err;
            }
            // The quote changed a number, so the model that stood on the old one is
            // stale the moment this returns. Recompute here rather than hoping the
            // surface remembers to ask.
            const recomputed = await (0, venture_run_1.recomputeVenture)(pool, sub, id, { onDate: onDateOf(req) });
            res.status(201).json({
                ...applied,
                model: recomputed ? summariseModel(recomputed) : null,
            });
        }),
    };
}
/** The compact model summary every compute-ish endpoint answers with. */
function summariseModel(r) {
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
/** Refuse the retired cents field and validate the exact scenario micro amount. */
function scenarioInput(body) {
    if (Object.prototype.hasOwnProperty.call(body, 'retailPriceCents')) {
        throw new venture_currency_1.VentureFxError('retail_price_cents_retired', 'retailPriceCents is retired; provide integer retailPriceMicros');
    }
    if (body.retailPriceMicros !== undefined && body.retailPriceMicros !== null) {
        const price = (0, venture_currency_1.assertCurrencyMicros)(body.retailPriceMicros, 'retailPriceMicros');
        if (price < 0)
            throw new venture_currency_1.VentureFxError('invalid_currency_amount', 'retailPriceMicros cannot be negative');
        return { ...body, retailPriceMicros: price };
    }
    return body;
}
/** The scenario endpoints. Overrides only; the arithmetic lives in the engine. */
function handleScenarios(pool) {
    return {
        scenarioList: (0, venture_http_1.guarded)('GET /ventures/:id/scenarios', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ scenarios: await (0, venture_store_1.listScenarios)(pool, sub, id) });
        }),
        scenarioCreate: (0, venture_http_1.guarded)('POST /ventures/:id/scenarios', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            if (!body.name) {
                res.status(400).json({ error: 'name is required' });
                return;
            }
            try {
                res.status(201).json({ scenario: await (0, venture_store_1.insertScenario)(pool, sub, id, scenarioInput(body)) });
            }
            catch (err) {
                if (!replyFxError(res, err))
                    throw err;
            }
        }),
        scenarioPatch: (0, venture_http_1.guarded)('PATCH /ventures/:id/scenarios/:scenarioId', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            let s;
            try {
                s = await (0, venture_store_1.updateScenario)(pool, sub, String(req.params.id), String(req.params.scenarioId), scenarioInput((req.body ?? {})));
            }
            catch (err) {
                if (replyFxError(res, err))
                    return;
                throw err;
            }
            if (!s) {
                res.status(404).json({ error: 'not found' });
                return;
            }
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
function handleModel(pool) {
    return {
        compute: (0, venture_http_1.guarded)('POST /ventures/:id/model', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const body = (req.body ?? {});
            const r = await (0, venture_run_1.recomputeVenture)(pool, sub, String(req.params.id), {
                scenarioId: typeof body.scenarioId === 'string' ? body.scenarioId : null,
                onDate: onDateOf(req),
            });
            if (!r) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ model: summariseModel(r) });
        }),
        readModel: (0, venture_http_1.guarded)('GET /ventures/:id/model', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const m = await (0, venture_store_outputs_1.latestModel)(pool, sub, id, req.query.scenarioId ? String(req.query.scenarioId) : null);
            res.json({ model: m });
        }),
        figure: handleFigureDerivation(pool),
        sensitivity: (0, venture_http_1.guarded)('GET /ventures/:id/sensitivity', handleSensitivity(pool)),
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
function handleFigureDerivation(pool) {
    return (0, venture_http_1.guarded)('GET /ventures/:id/model/figures/:figureKey', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const m = await (0, venture_store_outputs_1.latestModel)(pool, sub, id, null);
        const figure = m?.figures?.[String(req.params.figureKey)];
        if (!figure) {
            res.status(404).json({ error: 'no such figure in the latest model' });
            return;
        }
        const assumptions = await (0, venture_store_1.liveAssumptions)(pool, sub, id);
        const refs = (figure.assumptionRefs ?? []);
        res.json({
            figure,
            derivation: {
                formula: figure.formula ?? '',
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
function handleInversion(pool) {
    return (0, venture_http_1.guarded)('GET /ventures/:id/inversion', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const built = await buildModelFor(pool, sub, String(req.params.id), onDateOf(req));
        if (!built) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        // The three questions an operator asks before committing: what can this cost
        // at the factory gate, what can it cost landed, and how much of the run has
        // to sell. Split from the sweep because they are closed-form and cheap —
        // making somebody pay 2N model rebuilds to see a break-even sell-through
        // would be a latency defect, not a feature.
        res.json({
            inversions: (0, venture_sensitivity_1.computeInversions)({
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
async function buildModelFor(pool, sub, ventureId, onDate) {
    const venture = await (0, venture_store_1.getVenture)(pool, sub, ventureId);
    if (!venture)
        return null;
    const [assumptions, bomLines, vendors, headcount] = await Promise.all([
        (0, venture_store_1.liveAssumptions)(pool, sub, ventureId), (0, venture_store_supply_1.listBom)(pool, sub, ventureId),
        (0, venture_store_supply_1.listVendors)(pool, sub, ventureId), (0, venture_store_supply_1.listHeadcount)(pool, sub, ventureId),
    ]);
    const composed = (0, venture_store_compose_1.composeModelInput)({
        venture, assumptions, bomLines, vendors, headcount, scenario: null, onDate,
    });
    return { model: (0, venture_model_1.buildVentureModel)(composed.input), input: composed.input, composed };
}
/** GET /ventures/:id/sensitivity — a real one-at-a-time sweep, rebuilding the model. */
function handleSensitivity(pool) {
    return async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const built = await buildModelFor(pool, sub, String(req.params.id), onDateOf(req));
        if (!built) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const composed = built.composed;
        const base = built.model;
        const objective = (['peak-cash', 'contribution-per-unit', 'break-even-units', 'total-net-income']
            .includes(String(req.query.objective)) ? String(req.query.objective) : 'total-net-income');
        // Only banded assumptions are swept. One with no stated band is EXCLUDED
        // rather than swung over an invented range — that would be the model
        // inventing its own uncertainty.
        const inputs = composed.input.ledger.order
            .filter((aid) => composed.input.ledger.byId[aid].band)
            .map((aid) => ({ assumptionId: aid, label: composed.input.ledger.byId[aid].label }));
        const sweep = (0, venture_sensitivity_1.sensitivitySweep)({
            ledger: composed.input.ledger, inputs, objective, base,
            rebuild: (ledger) => (0, venture_model_1.buildVentureModel)((0, venture_model_1.withLedger)(composed.input, ledger)),
        });
        const inversions = (0, venture_sensitivity_1.computeInversions)({
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
/** Owner policy CRUD plus a read-only scheduler preview. */
function handleRebaselinePolicy(pool) {
    return {
        read: (0, venture_http_1.guarded)('GET /ventures/:id/rebaseline-policy', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const ventureId = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, ventureId)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ policy: await (0, venture_store_rebaseline_1.getRebaselinePolicy)(pool, sub, ventureId) });
        }),
        update: (0, venture_http_1.guarded)('PUT /ventures/:id/rebaseline-policy', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const ventureId = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, ventureId)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            try {
                const current = await (0, venture_store_rebaseline_1.getRebaselinePolicy)(pool, sub, ventureId);
                const patch = (req.body ?? {});
                const validated = (0, venture_rebaseline_1.mergeRebaselinePolicy)(current, patch);
                const stored = await (0, venture_store_rebaseline_1.upsertRebaselinePolicy)(pool, sub, validated);
                if (!stored) {
                    res.status(404).json({ error: 'not found' });
                    return;
                }
                res.json({ policy: stored });
            }
            catch (err) {
                if (!replyRebaselineError(res, err))
                    throw err;
            }
        }),
        preview: (0, venture_http_1.guarded)('POST /ventures/:id/rebaseline-policy/preview', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const ventureId = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, ventureId)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            const atIso = typeof body.atIso === 'string' ? body.atIso : new Date().toISOString();
            try {
                const policy = await (0, venture_store_rebaseline_1.getRebaselinePolicy)(pool, sub, ventureId);
                // forceDryRun is load-bearing: preview can never reserve a run or reach a bot.
                const decision = (0, venture_rebaseline_1.evaluateRebaselinePolicy)(policy, atIso, true);
                res.json({ policy, decision });
            }
            catch (err) {
                if (!replyRebaselineError(res, err))
                    throw err;
            }
        }),
    };
}
/** POST /ventures/:id/runs and the run pollers. */
function handleRuns(ctx, pool) {
    return {
        start: (0, venture_http_1.guarded)('POST /ventures/:id/runs', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const body = (req.body ?? {});
            const kind = RUN_KINDS.includes(body.kind) ? body.kind : 'full';
            const docKeys = Array.isArray(body.docKeys)
                ? body.docKeys.filter((k) => typeof k === 'string') : undefined;
            const started = await (0, venture_run_1.startRun)(ctx, sub, id, kind, docKeys, onDateOf(req));
            res.status(202).json({ ...started, kind });
        }),
        list: (0, venture_http_1.guarded)('GET /ventures/:id/runs', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const id = String(req.params.id);
            if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ runs: await (0, venture_store_1.listRuns)(pool, sub, id) });
        }),
        read: (0, venture_http_1.guarded)('GET /runs/:runId', async (req, res) => {
            const sub = (0, venture_http_1.requireSub)(req, res);
            if (!sub)
                return;
            const run = await (0, venture_store_1.getRun)(pool, sub, String(req.params.runId));
            if (!run) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ run });
        }),
    };
}
/** POST /chat — the ADR-036 concierge door. Spends, so it is an explicit POST. */
function handleChat(ctx, pool) {
    return (0, venture_http_1.guarded)('POST /chat', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const message = String(body.message ?? '').trim();
        if (!message) {
            res.status(400).json({ error: 'message is required' });
            return;
        }
        let context = { ventures: (await (0, venture_store_1.listVentures)(pool, sub)).map((v) => ({ id: v.id, name: v.name, stage: v.stage })) };
        const ventureId = typeof body.ventureId === 'string' ? body.ventureId : null;
        if (ventureId) {
            const venture = await (0, venture_store_1.getVenture)(pool, sub, ventureId);
            if (!venture) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            const [assumptions, model] = await Promise.all([
                (0, venture_store_1.liveAssumptions)(pool, sub, ventureId), (0, venture_store_outputs_1.latestModel)(pool, sub, ventureId, null),
            ]);
            context = {
                venture: { name: venture.name, stage: venture.stage, idea: venture.ideaText },
                coverage: (0, venture_store_1.coverageOf)(assumptions),
                assumptions: assumptions.map((a) => ({ key: a.key, label: a.label, value: a.valueNum, unit: a.unit, source: a.sourceKind, confidence: a.confidence })),
                figures: model?.figures ?? null,
                posture: model?.posture ?? null,
                canPublish: model?.canPublish ?? false,
            };
        }
        const reply = await (0, venture_bots_1.chat)(ctx, botClient, sub, message, context);
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
function createVentureRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const dir = surfaceDir(ctx.appPackageDir);
    (0, venture_schema_1.ensureVentureSchema)(pool).catch((err) => log.error({ err, stack: err?.stack }, 'venture schema bootstrap failed — the surface will report empty state'));
    const ventures = handleVentureList(pool);
    const assumptions = handleAssumptions(pool);
    const bom = handleBom(pool);
    const vendors = handleVendors(pool);
    const fx = handleFxAssumptions(pool);
    const quotes = handleQuotes(pool);
    const scenarios = handleScenarios(pool);
    const compute = handleModel(pool);
    const runs = handleRuns(ctx, pool);
    const rebaseline = handleRebaselinePolicy(pool);
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
    router.get('/ventures/:id/rebaseline-policy', rebaseline.read);
    router.put('/ventures/:id/rebaseline-policy', rebaseline.update);
    router.post('/ventures/:id/rebaseline-policy/preview', rebaseline.preview);
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
    router.get('/ventures/:id/fx-assumptions', fx.list);
    router.get('/ventures/:id/fx-assumptions/:fxId', fx.read);
    router.post('/ventures/:id/fx-assumptions', fx.create);
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
    (0, venture_routes_docs_1.registerDocumentRoutes)(router, ctx, pool);
    log.info({ surfaceDir: dir, documents: venture_doc_catalog_1.DOC_CATALOG.length }, 'venture-plan routes mounted');
    return router;
}
//# sourceMappingURL=venture-routes.js.map