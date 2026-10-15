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
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The three analyst replies are bounded so each fits one native request: on the native kernel a bot turn
 *   defaults to 2048 output tokens and the request to 60 s, and the unbounded BOM reply (10 lines, 4 vendors, indented)
 *   measured 3,142 tokens and the ops reply 2,869, so both were cut off before their JSON closed. Each analyst call now
 *   passes an explicit max_output_tokens (ANALYST_MAX_OUTPUT_TOKENS) and its contract states item counts, text lengths
 *   and minified JSON (ANALYST_LIMITS) whose worst case fits that cap.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The market and ops analysts fill code-owned "required" slots for the inputs the model names by key
 *   (venture-required-inputs): asked to "cover" market.demand.base-units and landed.freight.container-rate in a free list,
 *   they named their own keys live and the model refused every document on model:traceability. The free lists shrink
 *   (market 9 to 7, ops 8 to 6) so the worst-case reply with the slots still fits ANALYST_MAX_OUTPUT_TOKENS.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | One unit convention across each analyst prompt. The free assumption lists asked for "micros" money and
 *   "bps" rates while the "required" block beside them asked for plain dollars and the personas for usd/pct, and live the
 *   ledger held channel.amazon.fulfillment-pct as 550000 "usd_micros" and comparables at a tenth of their price. The
 *   lists now ask for "usd" (plain dollars) and "pct" (percent), the units the personas and the slots already use, and
 *   the contract parser converts them (venture-bot-contracts). Units per container and CBM per unit are ops slots now,
 *   so the ops free list shrinks from 6 to 4.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The narrate prompt asks for {{fig:<id>}} tokens from the figure table, as the strategist persona does,
 *   instead of "copy a figure exactly" over raw micro-dollar values: the persona wrote tokens and the document printed them
 *   raw. The table shows each figure formatted the way the document prints it.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the first Run the analysts failed "BOM analyst reply unusable: no JSON object in the reply" (1,070 tokens
 *   that did not parse) and the next run succeeded. Each analyst call takes `strict`, which adds STRICT_JSON, so the run can
 *   ask once more for the JSON object alone. The narrate prompt takes the document's figures the model could not reach and
 *   tells the strategist never to write that the plan reaches them (it wrote "before the venture reaches break-even" over a
 *   table reading break-even "not reachable").
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Round 14: the narrate prompt takes break-even as the model computed it
 *   (breakEvenFacts: reached or not within the horizon, the month and run size when reached, the horizon net income as the
 *   gap when not) under BREAK-EVEN AS COMPUTED, and tells the strategist to state break-even only that way; a condition for
 *   breaking even may still be written as a condition. NOT REACHABLE no longer carries break-even.
 *
 * @module venture-bots
 */

import type { AppContext } from '@/app/composition/app-context';
import type { BotNodeClient } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { createChildLogger } from '@/shared/logger';
import { requiredPromptLines } from './venture-required-inputs';

const log = createChildLogger({ module: 'venture-bots' });

/**
 * The four bots this package contributes, matching the `bots:` block of
 * `oshal-app.yaml`. These ids are the spend attribution: a call made with the
 * wrong one bills the wrong bot and the cost report becomes fiction.
 */
export const AGENT_IDS = Object.freeze({
  strategist: 'b7000000-0000-0000-0000-000000000001',
  bomAnalyst: 'b7000000-0000-0000-0000-000000000002',
  marketAnalyst: 'b7000000-0000-0000-0000-000000000003',
  opsAnalyst: 'b7000000-0000-0000-0000-000000000004',
});

/**
 * The output budget of one analyst reply, in tokens. The native kernel serves one package request for 60 s and an
 * analyst starts at most 10 s into it (venture-run NATIVE_ANALYST_WINDOW_MS); the local model wrote 2,048 tokens in
 * 30.5 s live (journal, 2026-10-11) and 3,142 in 46.2 s, about 67 tokens/s, so 2,200 tokens take about 33 s, and
 * about 42 s at the slowest rate seen on this host (52 tokens/s): started by 10 s, written by 52 s. Sent as max_output_tokens on every analyst
 * turn: without it the kernel's default (2,048) applies on native and the platform's own default elsewhere.
 */
export const ANALYST_MAX_OUTPUT_TOKENS = 2200;

/**
 * The unit rule for every free assumption list: the same plain dollars and percent the "required" slots and the
 * personas use, converted by the contract parser (venture-bot-contracts normaliseUnit).
 */
export const UNITS_LINE = 'Units there: "usd" for money in plain dollars (24.99 means $24.99), "pct" for rates in percent '
  + '(15 means 15%), "ratio" for fractions 0 to 1, "units" or "count" for quantities, or weeks|days|months|oz|lb|cbm.';

/**
 * What each analyst contract allows: item counts and the longest text per field. They are stated in the prompt,
 * and the contract test builds the largest reply these allow and proves it fits ANALYST_MAX_OUTPUT_TOKENS.
 */
export const ANALYST_LIMITS = Object.freeze({
  bom: Object.freeze({ lines: 6, vendors: 2 }),
  market: Object.freeze({ assumptions: 7 }),
  ops: Object.freeze({ assumptions: 4, tasks: 4, roles: 2 }),
  /** Longest name-like text (partName, label, vendorName, role, task name). */
  nameChars: 40,
  /** Longest descriptive text (specText, sourceDetail, notes). */
  detailChars: 80,
  /** Longest short text (key, uom, material, process, kind, country, phase, ownerRole). */
  shortChars: 30,
  /** Longest URL. */
  urlChars: 80,
});

/** The output rule every analyst contract ends with. Indentation alone made the BOM reply a third longer. */
const MINIFIED = 'Write the JSON on ONE line, minified: no indentation, no line breaks, no code fence.';

/** The retry's opening rule: the previous reply could not be read as JSON (venture-run parsedAnalystReply). */
export const STRICT_JSON = 'Your previous reply to this request could not be read as JSON. Reply with the JSON object ONLY: '
  + 'start with { and end with }, double-quoted keys and strings, no trailing commas, no comments, nothing before or after it.';

/** The text-length rule, in the contract's own words. */
const TEXT_LIMITS = `Keep names and labels under ${ANALYST_LIMITS.nameChars} characters, specText, sourceDetail and notes `
  + `under ${ANALYST_LIMITS.detailChars}, every other text under ${ANALYST_LIMITS.shortChars}, and a URL under `
  + `${ANALYST_LIMITS.urlChars}. A reply longer than the contract is cut off and lost.`;

/** What one bot call returned, plus what it cost. */
export interface BotReply {
  text: string;
  costUsd: number;
  model: string | null;
  durationMs: number;
}

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

/** Call one bot through the framework chokepoint and normalise the reply; an analyst passes its output cap. */
async function callBot(
  ctx: AppContext, botClient: BotNodeClient, agentId: string,
  ownerSub: string, taskId: string, text: string, maxOutputTokens?: number,
): Promise<BotReply> {
  const started = Date.now();
  const result = await executeBotOrInline(ctx, botClient, agentId, {
    text, taskId, workspaceFolderId: 'venture-plan', agentId,
    userSub: ownerSub, direct: true, agenticMode: false,
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
  } as never);
  const reply: BotReply = {
    text: String((result as { response?: unknown }).response ?? ''),
    costUsd: Number((result as { cost?: unknown }).cost ?? 0),
    model: ((result as { model?: unknown }).model as string) ?? null,
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
export async function scopeIdea(
  ctx: AppContext, botClient: BotNodeClient, ownerSub: string, idea: string,
): Promise<BotReply> {
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
  return callBot(ctx, botClient, AGENT_IDS.strategist, ownerSub, `venture-scope-${Date.now()}`, prompt);
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
 * @param strict - A retry after a reply that did not parse: ask for the JSON object alone (STRICT_JSON).
 * @returns The analyst's raw reply.
 */
export async function authorBom(
  ctx: AppContext, botClient: BotNodeClient, ownerSub: string,
  spec: { name: string; ideaText: string; spec: Record<string, unknown> }, runQtyUnits: number, strict = false,
): Promise<BotReply> {
  const prompt = [
    `Draft the bill of materials for "${spec.name}".`,
    ...(strict ? [STRICT_JSON] : []),
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
    `At most ${ANALYST_LIMITS.bom.lines} bom_lines: the parts and subassemblies that drive cost. Fold fasteners,`,
    'labels and other minor parts into ONE "Minor hardware and consumables" line with a wide band.',
    `At most ${ANALYST_LIMITS.bom.vendors} vendor_candidates.`,
    TEXT_LIMITS,
    MINIFIED,
    `Costs are MICRO-DOLLARS (1000000 = $1.00), stated at a run of ${runQtyUnits} units.`,
    'A line with no lowMicros/highMicros band is DROPPED. Do not emit a total: the roll-up,',
    'the scrap uplift, the minimum-order overbuy and the tooling amortisation are computed.',
    'An HTS code and a duty rate are legally consequential — emit them at confidence "low"',
    'and say in specText that a customs broker must confirm the classification.',
    '',
    `IDEA: ${spec.ideaText.slice(0, 2000)}`,
    `SPEC: ${JSON.stringify(spec.spec).slice(0, 2000)}`,
  ].join('\n');
  return callBot(ctx, botClient, AGENT_IDS.bomAnalyst, ownerSub, `venture-bom-${Date.now()}`, prompt,
    ANALYST_MAX_OUTPUT_TOKENS);
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
 * @param strict - A retry after a reply that did not parse: ask for the JSON object alone (STRICT_JSON).
 * @returns The analyst's raw reply.
 */
export async function authorMarket(
  ctx: AppContext, botClient: BotNodeClient, ownerSub: string,
  spec: { name: string; ideaText: string; spec: Record<string, unknown> }, strict = false,
): Promise<BotReply> {
  const prompt = [
    `Draft the market and channel assumptions for "${spec.name}".`,
    ...(strict ? [STRICT_JSON] : []),
    HONESTY_CLAUSE,
    '',
    'Schema:',
    '{"assumptions": [{"key": string, "domain": "market"|"channel"|"finance",',
    '  "label": string, "unit": string, "valueNum": number, "lowNum": number, "highNum": number,',
    '  "sourceKind": "model-estimate"|"published-source", "sourceDetail": string,',
    '  "sourceUrl": string|null, "confidence": "low"|"medium"|"high"}]}',
    '',
    ...requiredPromptLines('market', ANALYST_LIMITS.detailChars),
    '',
    'In "assumptions" add what else drives the plan: the retailer and distributor margins in percent,',
    'marketplace referral and fulfilment fees, the return rate, and the seasonality window.',
    UNITS_LINE,
    'You may NOT name a part or a manufacturing cost — that is the BOM analyst\'s contract.',
    'Comparable retail prices you can actually cite are worth more than a confident guess:',
    'attach the sourceUrl and the observed price rather than rounding to a nicer number.',
    `At most ${ANALYST_LIMITS.market.assumptions} assumptions. ${TEXT_LIMITS}`,
    MINIFIED,
    '',
    `IDEA: ${spec.ideaText.slice(0, 2000)}`,
    `SPEC: ${JSON.stringify(spec.spec).slice(0, 2000)}`,
  ].join('\n');
  return callBot(ctx, botClient, AGENT_IDS.marketAnalyst, ownerSub, `venture-market-${Date.now()}`, prompt,
    ANALYST_MAX_OUTPUT_TOKENS);
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
 * @param strict - A retry after a reply that did not parse: ask for the JSON object alone (STRICT_JSON).
 * @returns The analyst's raw reply.
 */
export async function authorOps(
  ctx: AppContext, botClient: BotNodeClient, ownerSub: string,
  spec: { name: string; ideaText: string; spec: Record<string, unknown> },
  bomSummary: unknown, strict = false,
): Promise<BotReply> {
  const prompt = [
    `Draft the operations plan for "${spec.name}".`,
    ...(strict ? [STRICT_JSON] : []),
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
    ...requiredPromptLines('ops', ANALYST_LIMITS.detailChars),
    '',
    'In "assumptions" add: the certification path and its cost and lead time, and the',
    'qualification/lead weeks for the long-lead components below.',
    UNITS_LINE,
    'Months are OFFSETS from the plan start (0 = first month).',
    'The critical path, the cash trough and the schedule feasibility are COMPUTED — do not',
    'state them. A certification requirement you are unsure of is confidence "low" with the',
    'standard named in sourceDetail, never a claim that the product passes anything.',
    `At most ${ANALYST_LIMITS.ops.assumptions} assumptions, ${ANALYST_LIMITS.ops.tasks} schedule_tasks (each depending on`,
    `at most 2 others) and ${ANALYST_LIMITS.ops.roles} headcount_roles; name the costliest items first. ${TEXT_LIMITS}`,
    MINIFIED,
    '',
    `FROZEN BILL OF MATERIALS (already rolled up in code — treat as fact):`,
    JSON.stringify(bomSummary).slice(0, 6000),
    `IDEA: ${spec.ideaText.slice(0, 1500)}`,
  ].join('\n');
  return callBot(ctx, botClient, AGENT_IDS.opsAnalyst, ownerSub, `venture-ops-${Date.now()}`, prompt,
    ANALYST_MAX_OUTPUT_TOKENS);
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
 * @param figureTable - The frozen figures, figure id -> label and the value as the document prints it.
 * @param notReachable - The document's figures the model could not reach, as plain facts (venture-prose-claims).
 * @param breakEven - Break-even as the model computed it, one fact per line (venture-prose-claims breakEvenFacts).
 * @returns The strategist's raw reply.
 */
export async function narrate(
  ctx: AppContext, botClient: BotNodeClient, ownerSub: string,
  docTitle: string, sectionKeys: readonly string[], figureTable: Record<string, string>,
  notReachable: readonly string[] = [], breakEven: readonly string[] = [],
): Promise<BotReply> {
  const prompt = [
    `Write the prose sections of "${docTitle}".`,
    '',
    'Reply with ONE JSON object: {"sections": {"<sectionKey>": "<prose>"}}',
    `Section keys, in order: ${sectionKeys.join(', ')}`,
    '',
    'THE NUMBERS BELOW ARE FROZEN AND AUTHORITATIVE. Write every money amount, rate, quantity',
    'or duration as a figure token {{fig:<id>}} naming an id from the table, for example',
    '{{fig:landed.buyerUnitMicros}}; the document prints the value shown beside that id in its',
    'place. A token naming an id that is not in the table rejects the whole section. A numeral',
    'you type is checked against the model by code, and one that matches nothing gets the',
    'document flagged as containing unverified numbers. Do not round, annualise or recompute,',
    'and do not add a number that is not in the table; write the sentence without it instead.',
    'Say plainly where the plan rests on estimates rather than quotes. Under-claiming costs',
    'as much credibility as over-claiming; state what is known and what is not.',
    '',
    'FIGURES:',
    ...Object.entries(figureTable).slice(0, 200).map(([k, v]) => `  ${k} = ${v}`),
    ...(notReachable.length ? ['', 'NOT REACHABLE IN THIS MODEL (no value: never write that the plan reaches one, and give no date,',
      'month or volume for it; say plainly that the model does not reach it):', ...notReachable.map((fact) => `  ${fact}`)] : []),
    ...(breakEven.length ? ['', 'BREAK-EVEN AS COMPUTED (state break-even only as computed here: never give it a month, year or',
      'volume that is not below, and never write that the plan reaches it when it does not; what would have to change for it',
      'to break even may be written as a condition, "would have to" or "if"):', ...breakEven.map((fact) => `  ${fact}`)] : []),
  ].join('\n');
  return callBot(ctx, botClient, AGENT_IDS.strategist, ownerSub, `venture-narrate-${Date.now()}`, prompt);
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
export async function chat(
  ctx: AppContext, botClient: BotNodeClient, ownerSub: string,
  message: string, context: unknown,
): Promise<BotReply> {
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
  return callBot(ctx, botClient, AGENT_IDS.strategist, ownerSub, `venture-chat-${Date.now()}`, prompt);
}
