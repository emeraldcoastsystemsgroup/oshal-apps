"use strict";
/**
 * Strategy Studio prompt + reply contract — the pure half of POST /api/trading/lab/studio, split
 * out of trading-strategy-lab-routes.ts so the studio-refine spec can exercise it without the
 * route module's kernel import chain (BotNodeClient, pool, express). Mirrors the workflow-assistant
 * refine-in-place contract: an optional CURRENT STRATEGY block turns a design turn into a
 * refinement turn, and a reply with no parseable JSON is a clarifying question, not an error.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 21:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Extracted studioPrompt/parseStudioReply from trading-strategy-lab-routes.ts; added the refinement block (current name+config fed back, change ONLY what was asked), the clarifying-question instruction (no mappable design -> plain-prose question, no json block), and stripBotFences so that question reads clean.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D6 event playbooks: isEventIntent (an IPO / listing-day / single-event ask is NOT a rotation — the studio refused "the Anthropic IPO" because it only knew rotations), eventPlanPrompt (the analyst designs an EVENT PLAYBOOK grounded in the cited IPO findings: offer-price allocation is not something software can secure, Schwab's Conditional Offer to Purchase is a manual step, the automated part is EDGAR S-1/424B4 watch → first-trade limit at IPO price × (1 + premium cap) → take-profit/stop off the IPO "strike" → time stop; not backtestable), and parseEventPlanReply mirroring parseStudioReply with manualSteps.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.studioPrompt = studioPrompt;
exports.parseStudioReply = parseStudioReply;
exports.stripBotFences = stripBotFences;
exports.isEventIntent = isEventIntent;
exports.eventPlanPrompt = eventPlanPrompt;
exports.parseEventPlanReply = parseEventPlanReply;
const trading_strategy_research_1 = require("./trading-strategy-research");
/**
 * @description Build the Strategy Studio prompt: ground the analyst in the selected research and
 * force a single fenced-JSON answer. When `current` is present this is a REFINEMENT turn — the
 * bot starts from the existing config and changes only what the trader asked (the workflow-
 * assistant contract). When the request cannot be mapped honestly onto the lab knobs, the bot is
 * told to ask ONE clarifying question in plain prose with no json block — the route turns that
 * into a `needsInput` reply instead of an error.
 * @param message - The trader's request.
 * @param findings - The relevance-selected research findings.
 * @param current - The strategy being refined (name + stored config), if any.
 * @returns The prompt text.
 */
function studioPrompt(message, findings, current) {
    const refs = findings.map((f) => `- [${f.id}] ${f.name} — ${f.authors} (${f.year}), ${f.journal}: ${f.finding} Maps: ${f.maps.note}`).join('\n');
    return [
        'You are a quantitative research analyst designing a TESTABLE OSHAL Strategy Lab strategy for a trader.',
        'Ground your design ONLY in the peer-reviewed findings below and CITE them by [id]. Never invent a citation or reference a paper not in this list.',
        '',
        'RESEARCH AVAILABLE:',
        refs,
        ...(current ? [
            '',
            'CURRENT STRATEGY — the trader is REFINING this design. Start from this exact config and change',
            'ONLY what the request asks for; keep every other knob exactly as it is, and keep the name.',
            `name: ${current.name}`,
            `config: ${JSON.stringify(current.config)}`,
        ] : []),
        '',
        `TRADER REQUEST: ${message}`,
        '',
        'Reply with EXACTLY ONE fenced json block and nothing else:',
        '```json',
        '{ "name": "short strategy name", "description": "one-sentence restatement",',
        '  "hypothesis": "the testable claim in plain English, grounded in the cited research",',
        '  "citations": ["id"],',
        '  "config": { "kind": "rotation"|"ensemble", "posture": "conservative"|"balanced"|"aggressive"|"active",',
        '    "corePct": 0-90, "coreSymbol": "SPY", "takeProfitPct": number|null,',
        '    "rank": "gravity"|"momentum"|"ensemble"|"blend", "cadenceDays": 1-63, "topN": 1-64,',
        '    "weighting": "conviction"|"equal", "universe": [], "warmupDays": 80, "windowDays": 780 },',
        '  "narration": "2-4 sentences a trader hears: what the strategy does, which finding(s) justify it and where they were published, and that a ~2-year backtest will test it" }',
        '```',
        'Keep the config faithful to the cited research (a momentum finding -> rank:"momentum"). windowDays 780 ~= 2 years.',
        'EXCEPTION: if the request cannot be mapped honestly onto these knobs, or is too ambiguous to design,',
        'reply with ONE short clarifying question in plain prose and NO json block.',
    ].join('\n');
}
/**
 * @description Parse the studio reply's fenced JSON, validating citations against the real corpus
 * (drops invented ids). Throws when the reply holds no parseable JSON — the route treats that as
 * the bot's clarifying question, not a failure.
 * @param raw - The bot's raw reply text.
 * @param findings - The findings that were offered (the citation allowlist).
 * @returns The parsed design.
 */
function parseStudioReply(raw, findings) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = (fenced ? fenced[1] : raw.match(/\{[\s\S]*\}/)?.[0] ?? '').trim();
    const parsed = JSON.parse(jsonText);
    const allowed = new Set(findings.map((f) => f.id));
    const citeIds = Array.isArray(parsed.citations) ? parsed.citations.map((x) => String(x)).filter((id) => allowed.has(id)) : [];
    const cited = citeIds.map((id) => (0, trading_strategy_research_1.findingById)(id)).filter((f) => !!f);
    return {
        name: String(parsed.name || 'Studio strategy').slice(0, 80),
        description: String(parsed.description || '').slice(0, 500),
        hypothesis: String(parsed.hypothesis || '').slice(0, 1000),
        config: parsed.config,
        citations: cited.length ? cited : findings.slice(0, 2),
        narration: String(parsed.narration || '').slice(0, 2000),
    };
}
/**
 * @description Strip fenced code blocks from a bot reply so a clarifying question reads as clean
 * prose (the bot sometimes wraps stray fragments in fences even when asking a question).
 * @param raw - The bot's raw reply text.
 * @returns The reply with fenced blocks removed and whitespace collapsed.
 */
function stripBotFences(raw) {
    return raw.replace(/```[\s\S]*?```/g, ' ').replace(/\s{3,}/g, ' ').trim();
}
/** The phrases that mark a single-event ask (an IPO, a listing day, an earnings print) rather than a rotation. */
const EVENT_INTENT = /\b(ipo|initial public offering|listing day|goes public|s-1|424b4|single event|one[- ]time event|event[- ]driven|earnings (report|call|release))\b/i;
/**
 * @description True when the trader is asking for an EVENT playbook — a one-off entry/exit around a
 * listing or a dated corporate event — rather than a rotation/ensemble strategy. The studio branches
 * on this BEFORE the rotation flow: "the Anthropic IPO" is not mappable onto rotation knobs, and the
 * old behaviour was a refusal. A plan already of kind 'event' stays on the event branch on refinement.
 * @param message - The trader's request.
 * @param current - The strategy/plan being refined, if any (kind 'event' forces the event branch).
 * @returns Whether the request should be designed as an event playbook.
 */
function isEventIntent(message, current) {
    if (current?.kind === 'event')
        return true;
    return EVENT_INTENT.test(String(message || ''));
}
/** The manual half of an IPO the plan can only REMIND about — the prompt states it, the reply echoes it. */
const EVENT_MANUAL_FACTS = [
    'MANUAL, NOT AUTOMATABLE: an allocation at the offer price is not something software can secure — offer-price shares go mainly to institutions and favored clients [ipo-first-day].',
    'MANUAL, NOT AUTOMATABLE: Schwab requires the client to submit a Conditional Offer to Purchase on schwab.com before 4 p.m. ET on the day before pricing, and to CONFIRM it after pricing; the plan reminds about this step, it cannot perform it.',
];
/** The automated half — what the executor does once the plan is armed. */
const EVENT_AUTOMATED_FACTS = [
    'AUTOMATED: watch EDGAR for the public S-1 registration and then the 424B4 pricing prospectus (which fixes the IPO price — the operator calls it the "strike").',
    'AUTOMATED: on the first trade, place a BUY limit at IPO price × (1 + maxPremiumPct/100); size as sizePctOfEquity of the account equity, or as notionalUsd; give up after entryDeadlineDays sessions with no fill.',
    'AUTOMATED: once filled, take profit at IPO price × (1 + takeProfitPct/100) and stop at IPO price × (1 − stopLossPct/100) — both measured off the strike, not the fill; close whatever remains after timeStopDays.',
    'NOT BACKTESTABLE: the issuer is not listed, so there is no price history; the dry-run shows the exact orders at example IPO prices instead.',
];
/**
 * @description Build the event-playbook prompt (ADR-136 D6). The analyst designs an EVENT PLAYBOOK
 * — a one-off IPO entry/exit — grounded in the cited IPO findings by [id], states plainly which
 * steps are manual (offer-price allocation, Schwab's Conditional Offer to Purchase) and which the
 * executor automates (EDGAR watch, first-trade limit with a premium cap, take-profit/stop off the
 * IPO "strike", time stop), and answers with exactly one fenced json block. With `current` this is a
 * refinement turn: change only what was asked.
 * @param message - The trader's request.
 * @param findings - The relevance-selected research findings (the IPO literature).
 * @param accountLabel - The selected account's ref/label, so sizing is spoken about the right book.
 * @param equity - The account equity when readable, else null (the prompt says so — never a guess).
 * @param current - The plan being refined (name + stored params), if any.
 * @returns The prompt text.
 */
function eventPlanPrompt(message, findings, accountLabel, equity, current) {
    const refs = findings.map((f) => `- [${f.id}] ${f.name} — ${f.authors} (${f.year}), ${f.journal}: ${f.finding} Maps: ${f.maps.note}`).join('\n');
    const equityLine = equity == null ? 'equity: not readable right now (do not assume a number; size by sizePctOfEquity)' : `equity: $${equity.toFixed(0)}`;
    return [
        'You are a quantitative research analyst designing an EVENT PLAYBOOK — NOT a rotation or a scan — for a trader who wants to trade a single upcoming event (an IPO / listing day).',
        'Ground the design ONLY in the peer-reviewed findings below and CITE them by [id]. Never invent a citation or reference a paper not in this list.',
        '',
        'RESEARCH AVAILABLE:',
        refs,
        '',
        'WHAT THE PLATFORM CAN AND CANNOT DO — state these plainly in the narration:',
        ...EVENT_MANUAL_FACTS,
        ...EVENT_AUTOMATED_FACTS,
        '',
        `ACCOUNT: ${accountLabel} (${equityLine})`,
        ...(current ? [
            '',
            'CURRENT PLAN — the trader is REFINING this playbook. Start from this exact plan and change',
            'ONLY what the request asks for; keep every other parameter exactly as it is, and keep the name.',
            `name: ${current.name}`,
            `plan: ${JSON.stringify(current.plan)}`,
        ] : []),
        '',
        `TRADER REQUEST: ${message}`,
        '',
        'Reply with EXACTLY ONE fenced json block and nothing else:',
        '```json',
        '{ "name": "short playbook name", "description": "one-sentence restatement",',
        '  "hypothesis": "the claim in plain English, grounded in the cited research",',
        '  "citations": ["id"],',
        '  "plan": { "issuer": "company name", "ticker": null|"EXPECTED",',
        '    "maxPremiumPct": number, "sizePctOfEquity": number|null, "notionalUsd": number|null,',
        '    "takeProfitPct": number, "stopLossPct": number, "timeStopDays": number, "entryDeadlineDays": number },',
        '  "narration": "3-5 sentences the trader hears: what is automated vs. manual, that offer-price allocation cannot be secured by software, the Schwab Conditional Offer step, and that this is NOT backtestable (unlisted stock) — the dry-run shows the orders at example IPO prices",',
        '  "manualSteps": ["each manual step the trader must do, in order"] }',
        '```',
        'Rules: give EXACTLY ONE of sizePctOfEquity or notionalUsd (null the other); takeProfitPct/stopLossPct/maxPremiumPct are percents of the IPO price ("strike"); timeStopDays and entryDeadlineDays are trading days; ticker null unless the trader named one or it is public.',
        'EXCEPTION: if the request cannot be designed honestly (no identifiable issuer, or the ask is not a single event), reply with ONE short clarifying question in plain prose and NO json block.',
    ].join('\n');
}
/**
 * @description Parse the event-playbook reply's fenced JSON, validating citations against the real
 * corpus (drops invented ids) — mirrors parseStudioReply. Throws when the reply holds no parseable
 * JSON; the route treats that as the bot's clarifying question, not a failure.
 * @param raw - The bot's raw reply text.
 * @param findings - The findings that were offered (the citation allowlist).
 * @returns The parsed playbook: the raw `plan` is normalized by the kernel (normalizeEventPlanParams).
 */
function parseEventPlanReply(raw, findings) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = (fenced ? fenced[1] : raw.match(/\{[\s\S]*\}/)?.[0] ?? '').trim();
    const parsed = JSON.parse(jsonText);
    const allowed = new Set(findings.map((f) => f.id));
    const citeIds = Array.isArray(parsed.citations) ? parsed.citations.map((x) => String(x)).filter((id) => allowed.has(id)) : [];
    const cited = citeIds.map((id) => (0, trading_strategy_research_1.findingById)(id)).filter((f) => !!f);
    const manualSteps = Array.isArray(parsed.manualSteps)
        ? parsed.manualSteps.map((x) => String(x).trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 300))
        : [];
    return {
        name: String(parsed.name || 'Event playbook').slice(0, 80),
        description: String(parsed.description || '').slice(0, 500),
        hypothesis: String(parsed.hypothesis || '').slice(0, 1000),
        plan: parsed.plan,
        citations: cited.length ? cited : findings.slice(0, 2),
        narration: String(parsed.narration || '').slice(0, 2000),
        manualSteps,
    };
}
//# sourceMappingURL=trading-strategy-studio-prompt.js.map