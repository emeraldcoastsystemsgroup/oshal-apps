"use strict";
/**
 * Venture Plan — the ONLY module in this package that talks to a language model.
 *
 * ADR-036: reasoning happens on an accountable bot, never in a route. Every call
 * here goes through `executeBotOrInline`, which is where the execute-entitlement
 * check and the cost-governance budget gate live, and which is what puts the spend
 * in `chat_tasks` under the calling bot's own `agent_id`. A route that called an
 * LLM directly would bypass all three and the user would have no way to see what
 * their plan cost.
 *
 * FOUR BOTS BECAUSE THE PIPELINE HAS A CODE PHASE IN THE MIDDLE:
 *
 *   strategist (scope) -> bom-analyst -> market ‖ ops -> [DETERMINISTIC ENGINE] -> strategist (narrate)
 *
 * The ops analyst reads the FROZEN BOM roll-up; the narrator reads the FROZEN
 * computed model. Neither dependency can be expressed inside a single persona, and
 * a monolithic call would make "re-run only the BOM because a quote landed" cost
 * four calls instead of one — which is the operator's actual daily workflow.
 *
 * NO ARITHMETIC LIVES IN THIS FILE. Not a sum, not a margin, not a percentage.
 * Every function here builds a prompt, calls a bot, and hands the reply to a
 * parser in `venture-bot-contracts`. If arithmetic ever appears below this line,
 * the split the whole package rests on has been broken.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the four agent ids, the literal JSON contracts embedded in each prompt, the five authoring calls (scope, BOM, market, ops, narrate), and the executeBotOrInline chokepoint with per-call cost capture. No arithmetic anywhere in the module.
 *
 * @module venture-bots
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_IDS = void 0;
exports.scopeIdea = scopeIdea;
exports.authorBom = authorBom;
exports.authorMarket = authorMarket;
exports.authorOps = authorOps;
exports.narrate = narrate;
exports.chat = chat;
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const logger_1 = require("@/shared/logger");
const log = (0, logger_1.createChildLogger)({ module: 'venture-bots' });
/**
 * The four bots this package contributes, matching the `bots:` block of
 * `oshal-app.yaml`. These ids are the spend attribution: a call made with the
 * wrong one bills the wrong bot and the cost report becomes fiction.
 */
exports.AGENT_IDS = Object.freeze({
    strategist: 'b7000000-0000-0000-0000-000000000001',
    bomAnalyst: 'b7000000-0000-0000-0000-000000000002',
    marketAnalyst: 'b7000000-0000-0000-0000-000000000003',
    opsAnalyst: 'b7000000-0000-0000-0000-000000000004',
});
/** The shared instruction every authoring bot gets, stated as a hard contract. */
const HONESTY_CLAUSE = [
    'CONTRACT — this reply is machine-parsed and a violation is DROPPED, not corrected:',
    '- Reply with ONE JSON object and nothing else. No prose outside it, no extra keys.',
    '- You may NOT return a total, a margin, a break-even, a profit, a cash figure or any',
    '  other computed result. Those are calculated in code from what you supply here, and',
    '  the schema below has nowhere to put one.',
    '- Every number needs a low/high BAND and a confidence of low | medium | high.',
    '- sourceKind is "model-estimate" unless you attach a real sourceUrl. You cannot mark',
    '  your own number as a vendor quote; a quote is recorded by a human from a real quote.',
    '- A number you cannot source is still useful AS AN HONEST BAND. Widen the band and say',
    '  confidence "low". Do not narrow a band to look more certain.',
].join('\n');
/** Call one bot through the framework chokepoint and normalise the reply. */
async function callBot(ctx, botClient, agentId, ownerSub, taskId, text) {
    const started = Date.now();
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, agentId, {
        text, taskId, workspaceFolderId: 'venture-plan', agentId,
        userSub: ownerSub, direct: true, agenticMode: false,
    });
    const reply = {
        text: String(result.response ?? ''),
        costUsd: Number(result.cost ?? 0),
        model: result.model ?? null,
        durationMs: Date.now() - started,
    };
    log.info({ agentId, taskId, costUsd: reply.costUsd, durationMs: reply.durationMs }, 'venture bot call complete');
    return reply;
}
/**
 * @description Turn a plain-language idea into a qualitative venture spec.
 *
 * The one SYNCHRONOUS bot call in the package: it is a single short reply and it
 * is what the user is staring at after they press the button. Everything longer
 * runs out of band.
 *
 * @param ctx - App context.
 * @param botClient - The framework bot-node client.
 * @param ownerSub - The accountable spend owner.
 * @param idea - The user's free-text idea.
 * @returns The strategist's raw reply.
 */
async function scopeIdea(ctx, botClient, ownerSub, idea) {
    const prompt = [
        'Scope a physical-product venture from the idea below.',
        '',
        'Reply with ONE JSON object, no prose outside it, exactly these keys:',
        '{"name": string, "productClass": string, "customer": string, "positioning": string,',
        ' "constraints": string[], "openQuestions": string[]}',
        '',
        'Rules: language only. Do NOT state a price, a cost, a volume, a margin or a date —',
        'other bots and a deterministic engine own every number in this plan. "openQuestions"',
        'is the most valuable field: list what a person would have to go and find out before',
        'this idea could be costed, hardest question first.',
        '',
        `IDEA: ${idea.slice(0, 4000)}`,
    ].join('\n');
    return callBot(ctx, botClient, exports.AGENT_IDS.strategist, ownerSub, `venture-scope-${Date.now()}`, prompt);
}
/**
 * @description Ask the BOM analyst for a parts list with price BANDS.
 *
 * The highest-consequence hallucination surface in the app: this is where a
 * fabricated $47.30 projector would enter and become a manufacturing commitment.
 * Hence the tightest contract, a mandatory band on every line, and a parser that
 * drops any line without one.
 *
 * @param ctx - App context.
 * @param botClient - The framework bot-node client.
 * @param ownerSub - The accountable spend owner.
 * @param spec - The venture spec and idea, already scoped.
 * @param runQtyUnits - The quantity every price band must be stated at.
 * @returns The analyst's raw reply.
 */
async function authorBom(ctx, botClient, ownerSub, spec, runQtyUnits) {
    const prompt = [
        `Draft the bill of materials for "${spec.name}".`,
        HONESTY_CLAUSE,
        '',
        'Schema:',
        '{"bom_lines": [{"ref": string, "parentRef": string|null, "partName": string,',
        '  "specText": string, "qtyPerUnit": number, "uom": string, "discrete": boolean,',
        '  "material": string, "process": string, "makeOrBuy": "make"|"buy",',
        '  "lowMicros": number, "highMicros": number, "scrapPct": number, "moq": number|null,',
        '  "leadTimeDays": number|null, "toolingCostMicros": number, "toolingLifeUnits": number|null,',
        '  "vendorName": string|null, "htsCode": string|null, "dutyPct": number|null,',
        '  "confidence": "low"|"medium"|"high"}],',
        ' "vendor_candidates": [{"name": string, "kind": string, "country": string, "url": string,',
        '  "moq": number|null, "leadTimeDays": number|null, "qualificationDays": number|null,',
        '  "depositBps": number, "balanceNetDays": number, "notes": string,',
        '  "confidence": "low"|"medium"|"high"}]}',
        '',
        `Costs are MICRO-DOLLARS (1000000 = $1.00), stated at a run of ${runQtyUnits} units.`,
        'A line with no lowMicros/highMicros band is DROPPED. Do not emit a total: the roll-up,',
        'the scrap uplift, the minimum-order overbuy and the tooling amortisation are computed.',
        'An HTS code and a duty rate are legally consequential — emit them at confidence "low"',
        'and say in specText that a customs broker must confirm the classification.',
        '',
        `IDEA: ${spec.ideaText.slice(0, 2000)}`,
        `SPEC: ${JSON.stringify(spec.spec).slice(0, 2000)}`,
    ].join('\n');
    return callBot(ctx, botClient, exports.AGENT_IDS.bomAnalyst, ownerSub, `venture-bom-${Date.now()}`, prompt);
}
/**
 * @description Ask the market analyst for demand, price ladder and channel terms.
 *
 * A different evidence base from the BOM analyst, and forbidden from naming a part
 * or a unit cost — two contracts in one persona bleed into each other, which is
 * how a component price ends up stored as a market assumption.
 *
 * @param ctx - App context.
 * @param botClient - The framework bot-node client.
 * @param ownerSub - The accountable spend owner.
 * @param spec - The venture spec and idea.
 * @returns The analyst's raw reply.
 */
async function authorMarket(ctx, botClient, ownerSub, spec) {
    const prompt = [
        `Draft the market and channel assumptions for "${spec.name}".`,
        HONESTY_CLAUSE,
        '',
        'Schema:',
        '{"assumptions": [{"key": string, "domain": "market"|"channel"|"finance",',
        '  "label": string, "unit": string, "valueNum": number, "lowNum": number, "highNum": number,',
        '  "sourceKind": "model-estimate"|"published-source", "sourceDetail": string,',
        '  "sourceUrl": string|null, "confidence": "low"|"medium"|"high"}]}',
        '',
        'Cover at minimum: market.demand.base-units (annual sell-through at the assumed price),',
        'channel.retail-price (micro-dollars), the retailer and distributor margins in basis',
        'points, marketplace referral and fulfilment fees, the return rate, the acquisition cost',
        'per order, and the seasonality window if the product has one.',
        'Units: "micros" for money, "bps" for rates, "units" for volumes, "ratio" for fractions.',
        'You may NOT name a part or a manufacturing cost — that is the BOM analyst\'s contract.',
        'Comparable retail prices you can actually cite are worth more than a confident guess:',
        'attach the sourceUrl and the observed price rather than rounding to a nicer number.',
        '',
        `IDEA: ${spec.ideaText.slice(0, 2000)}`,
        `SPEC: ${JSON.stringify(spec.spec).slice(0, 2000)}`,
    ].join('\n');
    return callBot(ctx, botClient, exports.AGENT_IDS.marketAnalyst, ownerSub, `venture-market-${Date.now()}`, prompt);
}
/**
 * @description Ask the ops analyst for manufacturing, logistics, compliance,
 *   schedule and headcount — against the FROZEN BOM.
 *
 * It receives the rolled-up BOM because lead times, tooling, duty and the
 * certification path all depend on what is actually in the product. That
 * dependency is the reason this is a fourth bot rather than a fourth section of
 * one prompt.
 *
 * @param ctx - App context.
 * @param botClient - The framework bot-node client.
 * @param ownerSub - The accountable spend owner.
 * @param spec - The venture spec and idea.
 * @param bomSummary - The frozen BOM, already rolled up in code.
 * @returns The analyst's raw reply.
 */
async function authorOps(ctx, botClient, ownerSub, spec, bomSummary) {
    const prompt = [
        `Draft the operations plan for "${spec.name}".`,
        HONESTY_CLAUSE,
        '',
        'Schema:',
        '{"assumptions": [{"key": string, "domain": "manufacturing"|"logistics"|"compliance"|"schedule"|"org",',
        '  "label": string, "unit": string, "valueNum": number, "lowNum": number, "highNum": number,',
        '  "sourceKind": "model-estimate"|"published-source", "sourceDetail": string,',
        '  "sourceUrl": string|null, "confidence": "low"|"medium"|"high"}],',
        ' "schedule_tasks": [{"phase": string, "name": string, "ownerRole": string,',
        '  "durationDays": number, "dependsOn": string[], "confidence": "low"|"medium"|"high"}],',
        ' "headcount_roles": [{"role": string, "kind": "employee"|"contractor", "fte": number,',
        '  "startMonth": number, "endMonth": number|null, "baseSalaryMicros": number,',
        '  "burdenBps": number, "confidence": "low"|"medium"|"high"}]}',
        '',
        'Cover at minimum: landed.freight.container-rate, landed.duty.hts-rate (basis points),',
        'units per container, cubic metres per unit, the certification path and its cost and',
        'lead time, and the qualification/lead weeks for the long-lead components below.',
        'Months are OFFSETS from the plan start (0 = first month).',
        'The critical path, the cash trough and the schedule feasibility are COMPUTED — do not',
        'state them. A certification requirement you are unsure of is confidence "low" with the',
        'standard named in sourceDetail, never a claim that the product passes anything.',
        '',
        `FROZEN BILL OF MATERIALS (already rolled up in code — treat as fact):`,
        JSON.stringify(bomSummary).slice(0, 6000),
        `IDEA: ${spec.ideaText.slice(0, 1500)}`,
    ].join('\n');
    return callBot(ctx, botClient, exports.AGENT_IDS.opsAnalyst, ownerSub, `venture-ops-${Date.now()}`, prompt);
}
/**
 * @description Ask the strategist to narrate a document over a FROZEN model.
 *
 * The figure table is supplied and declared authoritative. The bot is told its
 * output is machine-checked, which is true: `verifyProseNumbers` flags every
 * numeral that matches nothing in the model, and a flagged document is badged on
 * the surface rather than quietly published.
 *
 * @param ctx - App context.
 * @param botClient - The framework bot-node client.
 * @param ownerSub - The accountable spend owner.
 * @param docTitle - The document being narrated.
 * @param sectionKeys - The prose sections this document asks for.
 * @param figureTable - The frozen figures, label -> formatted value.
 * @returns The strategist's raw reply.
 */
async function narrate(ctx, botClient, ownerSub, docTitle, sectionKeys, figureTable) {
    const prompt = [
        `Write the prose sections of "${docTitle}".`,
        '',
        'Reply with ONE JSON object: {"sections": {"<sectionKey>": "<prose>"}}',
        `Section keys, in order: ${sectionKeys.join(', ')}`,
        '',
        'THE NUMBERS BELOW ARE FROZEN AND AUTHORITATIVE. Every numeral you write is checked',
        'against them by code; one that matches nothing gets the document flagged as containing',
        'unverified numbers, and a reader sees that badge. So: copy a figure exactly, or write',
        'the sentence without a number. Do not round, do not annualise, do not recompute, do not',
        'add a number that is not in the table — including one you think is obvious.',
        'Say plainly where the plan rests on estimates rather than quotes. Under-claiming costs',
        'as much credibility as over-claiming; state what is known and what is not.',
        '',
        'FIGURES:',
        ...Object.entries(figureTable).slice(0, 200).map(([k, v]) => `  ${k} = ${v}`),
    ].join('\n');
    return callBot(ctx, botClient, exports.AGENT_IDS.strategist, ownerSub, `venture-narrate-${Date.now()}`, prompt);
}
/**
 * @description Answer a conversational question about one venture.
 *
 * The concierge transport of ADR-036: the strategist holds this package's `api`
 * executor tools, so a question that needs data drives this app's own routes
 * rather than being answered from the prompt.
 *
 * @param ctx - App context.
 * @param botClient - The framework bot-node client.
 * @param ownerSub - The accountable spend owner.
 * @param message - The user's message.
 * @param context - A compact state summary, already assembled by the route.
 * @returns The strategist's raw reply.
 */
async function chat(ctx, botClient, ownerSub, message, context) {
    const prompt = [
        'You are the venture strategist for the plan summarised below.',
        'Answer in plain language. Every number in the summary is computed or is a labelled',
        'assumption — quote them exactly and never invent one. If the answer needs a number the',
        'summary does not contain, say which assumption has to be resolved to get it.',
        '',
        `STATE: ${JSON.stringify(context).slice(0, 6000)}`,
        '',
        `QUESTION: ${String(message).slice(0, 2000)}`,
    ].join('\n');
    return callBot(ctx, botClient, exports.AGENT_IDS.strategist, ownerSub, `venture-chat-${Date.now()}`, prompt);
}
//# sourceMappingURL=venture-bots.js.map