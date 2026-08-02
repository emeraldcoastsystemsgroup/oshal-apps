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
 */

import { findingById, type ResearchFinding } from './trading-strategy-research';

/** The current-strategy context a refinement turn feeds back into the prompt. */
export interface StudioCurrent {
  name: string;
  config: unknown;
}

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
export function studioPrompt(message: string, findings: ResearchFinding[], current?: StudioCurrent): string {
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
export function parseStudioReply(raw: string, findings: ResearchFinding[]): {
  name: string; description: string; hypothesis: string; config: unknown; citations: ResearchFinding[]; narration: string;
} {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced ? fenced[1] : raw.match(/\{[\s\S]*\}/)?.[0] ?? '').trim();
  const parsed = JSON.parse(jsonText) as { name?: string; description?: string; hypothesis?: string; config?: unknown; citations?: unknown; narration?: string };
  const allowed = new Set(findings.map((f) => f.id));
  const citeIds = Array.isArray(parsed.citations) ? parsed.citations.map((x) => String(x)).filter((id) => allowed.has(id)) : [];
  const cited = citeIds.map((id) => findingById(id)).filter((f): f is ResearchFinding => !!f);
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
export function stripBotFences(raw: string): string {
  return raw.replace(/```[\s\S]*?```/g, ' ').replace(/\s{3,}/g, ' ').trim();
}
