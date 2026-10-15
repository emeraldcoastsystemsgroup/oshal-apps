/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the narrated "What would have to be true" said the funding covers "the 36 month cash deficit before the venture reaches break-even", while the same document's figure table read break-even run size "not reachable" and net income over the horizon was negative. A figure the model could not reach is ABSENT from the frozen figure table, so the narrator never learned it was unreachable. The narrator is now told which of a document's figures are not reachable, and a sentence that still claims to reach one (no negation in it) is removed from the prose before the document is stored.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of sweep 10: the filter removed EVERY un-negated sentence naming break-even, so the conditional sentences "What would have to be true" exists for ("To break even within the horizon, the landed cost would have to fall to $2.10 per lid.", "Demand would need to triple for the plan to reach break-even.") were silently dropped, and a section of only such sentences vanished. Only a sentence that ASSERTS break-even is reached (a reach verb, "breaks even", or a time/volume beside it) and is neither negated nor conditional (would/could/must/need/if/unless/to reach ...; "expected to" stays an assertion) is removed now, and a section left empty is kept with a note saying why its draft was taken out instead of disappearing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Round 14 design decision: no narrated sentence is deleted any more. Deleting by word lists failed both ways (round 12 dropped conditions; round 13 kept "The raise would cover the deficit before the venture reaches break-even" because a modal anywhere in the sentence read as a condition). Now (1) breakEvenFacts gives the narrator break-even exactly as computed (reached or not within the horizon, the month at the planned run size and the break-even run size when reached, the horizon net income as the gap when not); (2) withBreakEvenCheck runs ONE check after narration: when the model does not reach break-even and a section asserts that it does, the prose is kept as written and a visible "Check: the computed model does not reach break-even within the horizon" note is attached to that section. The condition test is scoped to the clause that names break-even (and to a leading or "if/once/assuming" clause), so a modal in another clause no longer hides a claim, and a scenario ("At $2.10 per lid", "With demand tripled") is a condition. withoutUnreachableClaims, the deletion path, is removed; unreachableFigures no longer lists break-even, which the facts carry.
 */

import type { DocSpec } from './venture-doc-catalog';

/** The figure the break-even facts cover; unreachableFigures leaves it to them. */
const BREAK_EVEN_ID = 'breakEven.units';
/** The horizon net income figure: when break-even is not reached, the gap the plan would have to close. */
const GAP_ID = 'financials.netIncomeMicros';

/** How a person reads an optional figure the model left without a value (break-even is in breakEvenFacts). */
const REACHABLE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  'landed.containerFillRatio': 'Container fill: not computed for this plan',
  'landed.effectiveDutyBps': 'Effective duty rate: not computed for this plan',
  'headcount.totalMicros': 'Headcount cost: no roles are planned',
  'headcount.peakFte': 'Peak headcount: no roles are planned',
});

/** The note attached to a section whose prose says break-even is reached when the computed model does not reach it. */
export const BREAK_EVEN_CHECK_NOTE = '*Check: the computed model does not reach break-even within the horizon.*';

/** Break-even as a noun or a verb ("break-even", "breaks even", "broke even"), for building the patterns below. */
const BE = 'br(?:eak|eaks|oke|eaking)[\\s-]?even';
const NAMES = new RegExp(`\\b${BE}`, 'i');

/** A clause that says break-even happens: a reach verb, "breaks even", a time or volume beside it, or a presupposing "before/once". */
const REACHED: readonly RegExp[] = [
  new RegExp(`\\b(reach|reaches|reached|reaching|hit|hits|hitting|achieves?|achieved|achieving|attains?|attained|cross|crosses|crossed|gets? to|got to)\\b[^.!?]*\\b${BE}`, 'i'),
  /\b(break|breaks|broke|breaking)\s+even\b/i,
  new RegExp(`\\b${BE}(\\s+point)?\\s+(is\\s+|was\\s+|will be\\s+)?(reached|achieved|hit|comes?|came|arrives?|arrived|occurs?|occurred|happens?|happened|lands?|landed)\\b`, 'i'),
  new RegExp(`\\b${BE}\\b[^.!?]*\\b(in|by|at|within|after|around|is|was|will be)\\s+(month|year|week|quarter|day|q[1-4]\\b|\\d|\\{\\{fig:)`, 'i'),
  new RegExp(`\\b(before|until|till|once|by the time|when)\\b[^.!?]*\\b${BE}`, 'i'),
  new RegExp(`\\b(past|beyond|above)\\s+(the\\s+)?${BE}`, 'i'),
];

/** A hypothesis inside the break-even clause ("would", "could", "must", "needs", "if"). "should"/"will" forecast, so they stay claims. */
const HYPOTHETICAL = /\b(would|could|might|must|needs?|needed|requires?|required|if|whether|suppose|supposing|assuming|provided|only when|only if|only then)\b/i;
/** "may" as a modal; lower case only, so the month ("in May") is not read as a condition. */
const MAY = /\bmay\b/;

/** "to reach break-even" / "to break even": what it would take, unless a forecast word makes it a result ("expected to"). */
const TO_REACH = /\bto\s+(reach|hit|achieve|attain|get to|cross)\b|\bto\s+break\s+even\b/i;
const FORECAST = /\b(expected|expects?|projected|projects?|forecast|forecasts|forecasted|set|on track|likely|due|poised|going|scheduled|planned|enough|starts?|begins?)\s+to\s+(reach|hit|achieve|attain|get to|cross|break)\b/i;

/** A clause that opens a condition for the rest of the sentence ("If demand triples, ...", "..., assuming prices hold"). */
const CONDITION_START = /^(if|unless|assuming|provided|supposing|suppose|should|were|had|as long as|only if|on condition|once|when)\b/i;
/** A clause opening a scenario ("At $2.10 per lid", "With demand tripled", "Under the high case"), not a time ("At month 14"). */
const SCENARIO_START = /^(at\s+(\$|\d|\{\{fig:|an?\s+|the\s+)|with\s+|under\s+|in\s+(a|the)\s+\S+\s+(scenario|case)\b)/i;
const NOT_SCENARIO = new RegExp(`^(at\\s+(the\\s+(end|start|close)\\b|\\d[\\d,.]*\\s*(months?|years?|weeks?|quarters?|days?)\\b)|with\\s+(\\S+\\s+){0,3}?${BE})`, 'i');

/** A clause that says the thing does NOT happen. */
const NEGATION = /\b(not|never|no|cannot|can't|won't|unreachable|fails?|without|isn't|doesn't|does not|is not|neither|nor|unless)\b/i;

/** Where one sentence splits into clauses: a comma before a space, other punctuation, and the words that open a clause. */
const CLAUSE_SPLIT = /,(?=\s)|[;:()–—]|\s(?=(?:and|but|which|while|whereas|so|before|once|until|till|by the time|when|after which|because|although|though)\b)/i;

/** Break-even as the frozen model computed it, and the lines the narrator is given. */
export interface BreakEvenFacts {
  /** True when the plan's cumulative net income turns non-negative within the horizon, or some run size breaks even. */
  reached: boolean;
  /** The plan month (1 = the first) where cumulative net income at the planned run size first turns non-negative. */
  month: number | null;
  /** The break-even run size, when one exists. */
  units: number | null;
  /** The horizon length in months, from the stored P&L. */
  horizonMonths: number | null;
  /** The facts as the narrator reads them; numbers as figure tokens or small counts only. */
  lines: string[];
}

/**
 * @description The optional figures one document prints that the frozen model left without a value, as plain facts for the
 * narrator ("Container fill: not computed for this plan"). Break-even is not listed: breakEvenFacts states it, reached or not.
 * @param spec - The document specification.
 * @param figures - The frozen snapshot's figures by id.
 * @returns The ids not reached, each with the fact the narrator is given.
 */
export function unreachableFigures(spec: DocSpec, figures: Readonly<Record<string, unknown>>): Array<{ id: string; fact: string }> {
  const out: Array<{ id: string; fact: string }> = [];
  for (const section of spec.sections ?? []) {
    if (section.kind !== 'figures') continue;
    for (const id of section.optionalKeys ?? []) {
      if (id === BREAK_EVEN_ID || figures[id] || out.some((u) => u.id === id)) continue;
      out.push({ id, fact: REACHABLE_LABEL[id] ?? `${id}: not reachable in this model` });
    }
  }
  return out;
}

/** The first plan month (1-based) whose cumulative net income is non-negative, and the horizon length, from the stored P&L. */
function planBreakEvenMonth(tables: Readonly<Record<string, unknown>>): { month: number | null; horizonMonths: number | null } {
  const pnl = Array.isArray(tables.pnl) ? tables.pnl as Array<{ cumulativeNetIncomeMicros?: unknown }> : [];
  if (!pnl.length) return { month: null, horizonMonths: null };
  const at = pnl.findIndex((row) => typeof row?.cumulativeNetIncomeMicros === 'number' && row.cumulativeNetIncomeMicros >= 0);
  return { month: at === -1 ? null : at + 1, horizonMonths: pnl.length };
}

/**
 * @description Break-even exactly as the frozen model computed it, with the lines the narrator is given: reached or not within
 * the horizon, the plan month and the break-even run size when reached, and the horizon net income as the gap when not.
 * Numbers go to the narrator as {{fig:id}} tokens or as small month counts the unverified-number check lets through.
 * @param figures - The frozen snapshot's figures by id.
 * @param tables - The frozen snapshot's tables (the P&L carries cumulative net income by month).
 * @returns The computed facts.
 */
export function breakEvenFacts(
  figures: Readonly<Record<string, unknown>>, tables: Readonly<Record<string, unknown>>,
): BreakEvenFacts {
  const { month, horizonMonths } = planBreakEvenMonth(tables);
  const unitsFig = figures[BREAK_EVEN_ID] as { value?: unknown } | undefined;
  const units = typeof unitsFig?.value === 'number' ? unitsFig.value : null;
  const horizon = horizonMonths ? `the ${horizonMonths}-month plan horizon` : 'the plan horizon';
  const gap = figures[GAP_ID]
    ? `Net income across the horizon is {{fig:${GAP_ID}}}: that shortfall is the gap the plan would have to close to break even.` : null;
  const lines: string[] = [];
  if (month !== null) lines.push(`At the planned run size, cumulative net income first turns non-negative in month ${month} of ${horizon} (month 1 is the first plan month).`);
  else lines.push(`At the planned run size, cumulative net income does NOT turn non-negative within ${horizon}.`, ...(gap ? [gap] : []));
  if (units !== null) lines.push(`The smallest run size that breaks even within the horizon is {{fig:${BREAK_EVEN_ID}}}.`);
  else lines.push(`No run size in this model breaks even within ${horizon}.`);
  const reached = month !== null || units !== null;
  if (!reached) lines.unshift(`Break-even is NOT reached within ${horizon}.`);
  return { reached, month, units, horizonMonths, lines };
}

/** True when a clause carries a hypothesis: a modal, "if", or "to reach ..." that no forecast word makes a result. */
function hypothetical(clause: string): boolean {
  if (HYPOTHETICAL.test(clause) || MAY.test(clause)) return true;
  if (TO_REACH.test(clause) && !FORECAST.test(clause)) return true;
  const head = clause.trim();
  return SCENARIO_START.test(head) && !NOT_SCENARIO.test(head);
}

/** True when another clause of the sentence sets the condition the break-even clause rests on. */
function conditionedElsewhere(clauses: readonly string[], at: number): boolean {
  return clauses.some((c, j) => {
    if (j === at) return false;
    const head = c.trim();
    if (CONDITION_START.test(head)) return true;
    return j < at && SCENARIO_START.test(head) && !NOT_SCENARIO.test(head);
  });
}

/**
 * @description True when one sentence asserts that break-even IS reached: a clause names it and says it happens (a reach verb,
 * "breaks even", a time or volume beside it, "before/once ... reaches"), and that clause is neither negated nor a hypothesis,
 * nor conditioned by another clause ("If ..., the plan breaks even"; "At $2.10 per lid ..."). A modal in a DIFFERENT clause
 * ("The raise would cover the deficit before the venture reaches break-even") does not make the claim a condition.
 * @param sentence - One sentence of narrated prose.
 * @returns Whether the sentence claims break-even is reached.
 */
export function claimsReached(sentence: string): boolean {
  if (!NAMES.test(sentence)) return false;
  const clauses = sentence.split(CLAUSE_SPLIT).filter((c) => c && c.trim());
  return clauses.some((clause, i) => NAMES.test(clause) && !NEGATION.test(clause)
    && REACHED.some((re) => re.test(clause)) && !hypothetical(clause) && !conditionedElsewhere(clauses, i));
}

/** The sentences of one prose section; a stop inside "$1.50" or a {{fig:...}} token is not followed by a space. */
function sentencesOf(text: string): string[] {
  return (text.match(/[\s\S]*?(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [text]).filter(Boolean);
}

/**
 * @description The one check after narration. When the computed model does not reach break-even within the horizon, every
 * section with a sentence asserting that it is reached (claimsReached) keeps its prose exactly as written and gets
 * BREAK_EVEN_CHECK_NOTE attached after it. Nothing is deleted and no section is dropped; when break-even is reached, nothing
 * is touched.
 * @param prose - The parsed prose sections by key.
 * @param facts - The computed break-even facts (breakEvenFacts).
 * @returns The prose with any notes attached, and which sections got one.
 */
export function withBreakEvenCheck(
  prose: Readonly<Record<string, string>>, facts: Pick<BreakEvenFacts, 'reached'>,
): { prose: Record<string, string>; flagged: string[] } {
  const out: Record<string, string> = { ...prose };
  const flagged: string[] = [];
  if (facts.reached) return { prose: out, flagged };
  for (const [key, text] of Object.entries(prose)) {
    if (!sentencesOf(text).some((s) => claimsReached(s))) continue;
    out[key] = `${text.trimEnd()}\n\n${BREAK_EVEN_CHECK_NOTE}`;
    flagged.push(key);
  }
  return { prose: out, flagged };
}
