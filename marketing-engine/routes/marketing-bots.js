"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Inline-bot execution for the marketing-engine API, moved verbatim out of marketing-routes.ts at the 800-line decomposition threshold: the package BotNodeClient, the bounded executeBotOrInline turn runner and its ADR-127 result-shape check, the campaign-director/market-analyst/launch-coordinator prompt builders, the ICP JSON extractor, and the no-hosted-brain 503 translation. Reasoning still never happens in the controller; nothing about the prompts, the turn, or the 503 changed.
 *
 * @module marketing-bots
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMarketingBot = runMarketingBot;
exports.draftPrompt = draftPrompt;
exports.researchPrompt = researchPrompt;
exports.launchPrompt = launchPrompt;
exports.extractJsonObject = extractJsonObject;
exports.respondWithBot = respondWithBot;
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const agent_management_1 = require("@/features/agent-management");
const marketing_support_1 = require("./marketing-support");
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
// ---------------------------------------------------------------------------
// Inline bot execution (ADR-036/ADR-127 — reasoning never happens in this controller)
// ---------------------------------------------------------------------------
/** NoHostedBrainError-shaped failure (code or wrapped message) → the honest 503. */
function isNoHostedBrain(err) {
    const e = err;
    return e?.code === 'NO_HOSTED_BRAIN' || /NO_HOSTED_BRAIN|hosted brain|AI Providers/i.test(String(e?.message || ''));
}
/**
 * @description Run one bounded prompt on a package inline bot, cost-attributed to the caller.
 * Reads result.success explicitly — the orchestrator swallows provider errors as
 * {success:false} instead of throwing (the ADR-127 result-shape landmine).
 * @param ctx - Framework app context.
 * @param agentId - Inline concierge agent id to run.
 * @param kind - Turn kind, used in the task id.
 * @param scopeKey - Scope key (the campaign slug), used in the task id.
 * @param sub - The caller's OIDC subject.
 * @param prompt - The bounded prompt text.
 * @returns The bot's response text.
 */
async function runMarketingBot(ctx, agentId, kind, scopeKey, sub, prompt) {
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, agentId, {
        text: prompt,
        taskId: `marketing-${kind}-${scopeKey}`,
        workspaceFolderId: `marketing-${sub}`,
        agentId,
        agenticMode: false,
        direct: true,
        userSub: sub,
    });
    if (!result || result.success === false) {
        throw new Error(`marketing bot turn failed: ${String(result?.error ?? 'unknown')}`);
    }
    return String(result.response ?? '');
}
/** Bounded campaign summary shared by every bot prompt. */
function campaignSummary(campaign) {
    return [
        `Campaign: ${campaign.name} (product: ${campaign.product}, motion: ${campaign.motion}, stage ${campaign.stage})`,
        `ICP: ${(0, marketing_support_1.boundJson)(campaign.icp, 1500)}`,
        `Message map: ${(0, marketing_support_1.boundJson)(campaign.message_map, 1500)}`,
    ].join('\n');
}
/**
 * @description Prompt for one channel draft (campaign-director).
 * @param campaign - The campaign row.
 * @param channel - Target channel.
 * @param brief - The operator brief.
 * @returns The assembled prompt.
 */
function draftPrompt(campaign, channel, brief) {
    return [
        'You are drafting ONE marketing post. A human reviews and publishes it — you never publish.',
        campaignSummary(campaign),
        `Brief: ${brief}`,
        `Channel constraints: ${marketing_support_1.CHANNEL_CONSTRAINTS[channel]}`,
        marketing_support_1.HONESTY_RULES,
        'Return ONLY the post text (for email: subject line first, blank line, then the body). No preamble, no markdown fences.',
    ].join('\n\n');
}
/**
 * @description Prompt for ICP research (market-analyst).
 * @param campaign - The campaign row.
 * @returns The assembled prompt.
 */
function researchPrompt(campaign) {
    return [
        'You are refining the ideal-customer-profile (ICP) for this campaign. You research and propose — you never publish or spend.',
        campaignSummary(campaign),
        'Return ONLY a JSON object (no fences, no preamble) with keys such as segments (array of {name, pains, gains, watering_holes}), personas, objections, positioning. Extend the existing ICP; do not drop existing keys.',
        marketing_support_1.HONESTY_RULES,
    ].join('\n\n');
}
/**
 * @description Prompt for the launch checklist + human-posted community drafts (launch-coordinator).
 * @param campaign - The campaign row.
 * @returns The assembled prompt.
 */
function launchPrompt(campaign) {
    return [
        'You are preparing a launch checklist plus plain-text community post drafts a HUMAN will post manually (community norms: bots never post to HN/Reddit/Product Hunt).',
        campaignSummary(campaign),
        'Return a markdown checklist (pre-launch, launch-day, post-launch) followed by one clearly-labeled plain-text draft per community, each honest and norm-following.',
        marketing_support_1.HONESTY_RULES,
    ].join('\n\n');
}
/**
 * @description Extract a JSON object from bot output (direct, fenced, or embedded); null when unparseable.
 * @param text - Raw bot output.
 * @returns The parsed object, or null.
 */
function extractJsonObject(text) {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const candidates = [cleaned];
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first)
        candidates.push(cleaned.slice(first, last + 1));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch (err) {
            marketing_support_1.logger.debug({ err: String(err) }, 'ICP JSON candidate did not parse');
        }
    }
    return null;
}
/**
 * @description Run a bot handler and translate a missing hosted brain into the honest 503.
 * @param res - The Express response.
 * @param fn - The bot-backed handler body to run.
 * @returns Resolves when the handler body completes.
 */
async function respondWithBot(res, fn) {
    try {
        await fn();
    }
    catch (err) {
        if (isNoHostedBrain(err)) {
            res.status(503).json({ error: 'no_hosted_brain', hint: 'Add an AI provider under Settings → AI Providers, then retry.' });
            return;
        }
        throw err;
    }
}
