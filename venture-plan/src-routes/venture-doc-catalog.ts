/**
 * Venture Plan — the document catalogue, as DATA.
 *
 * Seventeen documents. Each one declares WHICH figures and WHICH tables it prints
 * and which prose sections it asks a writer for — and nothing else. There is no
 * document text in this file, and no number: a specification that could contain a
 * literal number would be a place a number could enter a plan without passing
 * through the engine.
 *
 * THE THREE SECTION KINDS AND WHY THEY ARE THE ONLY THREE:
 *
 * - `figures` resolves ids out of the computed registry. A required id that the
 *   engine did not produce THROWS, because a blank where a funding number belongs
 *   is indistinguishable from a zero. `optionalKeys` exist for figures that are
 *   legitimately absent — a break-even volume when contribution is negative is a
 *   real answer ("never"), not a missing one, and it renders as that.
 * - `table` renders a computed table verbatim. The renderer never re-derives a
 *   row; the engine already did.
 * - `prose` is the ONLY place model-written language appears, it is always
 *   optional, and every numeral in it is checked against the model before storage.
 *
 * `assumption-register` is the document that makes the other sixteen honest, and
 * it is the one document with no prose section at all: it is a dump of the live
 * ledger with each number's source, confidence, band and author.
 *
 * EVERY SPEC CARRIES A NON-EMPTY `decision`. If you cannot say what decision a
 * document supports, the document is padding — and a plan padded to look thorough
 * is how a reader stops reading the parts that matter. Validated at module load.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the seventeen document specifications with their figure ids, computed tables and prose section keys, the required/optional figure split, and the load-time assertion that every document states the decision it supports.
 *
 * @module venture-doc-catalog
 */

/** One section of a document. Three kinds, no fourth. */
export type DocSection =
  | { kind: 'figures'; heading: string; keys: string[]; optionalKeys?: string[] }
  | { kind: 'table'; heading: string; table: string }
  | { kind: 'assumptions'; heading: string; domains?: string[] }
  | { kind: 'prose'; heading: string; proseKey: string };

/** One document in the catalogue. */
export interface DocSpec {
  key: string;
  title: string;
  audience: string;
  /** The decision this document exists to support. Never empty. */
  decision: string;
  sections: DocSection[];
}

/** The seventeen documents, in reading order. */
export const DOC_CATALOG: readonly DocSpec[] = Object.freeze([
  {
    key: 'executive-summary',
    title: 'Executive summary',
    audience: 'whoever signs the cheque',
    decision: 'Is this worth spending the next round of money to find out more about?',
    sections: [
      { kind: 'prose', heading: 'The idea in a paragraph', proseKey: 'overview' },
      {
        kind: 'figures',
        heading: 'The numbers that decide it',
        keys: ['landed.buyerUnitMicros', 'financials.revenueMicros', 'financials.netIncomeMicros',
          'financials.fundingRequiredMicros', 'ledger.total', 'ledger.softMoneyCount'],
        optionalKeys: ['breakEven.units'],
      },
      { kind: 'prose', heading: 'What would have to be true', proseKey: 'what-must-be-true' },
    ],
  },
  {
    key: 'concept-brief',
    title: 'Concept brief',
    audience: 'the team building it',
    decision: 'What exactly are we making, for whom, and what is deliberately out of scope?',
    sections: [
      { kind: 'prose', heading: 'Product concept', proseKey: 'concept' },
      { kind: 'prose', heading: 'Customer and use', proseKey: 'customer' },
      { kind: 'prose', heading: 'Out of scope', proseKey: 'out-of-scope' },
      { kind: 'figures', heading: 'Physical shape', keys: ['bom.lineCount', 'landed.containers'] },
    ],
  },
  {
    key: 'market-and-channel',
    title: 'Market and channel',
    audience: 'sales and marketing',
    decision: 'Which channel do we launch in, and at what shelf price?',
    sections: [
      { kind: 'prose', heading: 'Market read', proseKey: 'market' },
      { kind: 'figures', heading: 'Demand at the planned price', keys: ['demand.units', 'demand.priceMicros'] },
      { kind: 'table', heading: 'Channel margin waterfall', table: 'waterfall' },
      { kind: 'prose', heading: 'Channel choice', proseKey: 'channel-choice' },
    ],
  },
  {
    key: 'assumption-register',
    title: 'Assumption register',
    audience: 'anyone checking the plan',
    decision: 'Which numbers are real, which are guesses, and which one should we go and buy first?',
    sections: [
      { kind: 'assumptions', heading: 'Every assumption in the plan' },
    ],
  },
  {
    key: 'bill-of-materials',
    title: 'Bill of materials',
    audience: 'sourcing and the contract manufacturer',
    decision: 'What do we buy, from whom, and what does one unit cost at the factory gate?',
    sections: [
      { kind: 'table', heading: 'Rolled-up bill of materials', table: 'bom' },
      {
        kind: 'figures',
        heading: 'Factory cost',
        keys: ['bom.runRecurringMicros', 'bom.recurringUnitMicros', 'bom.oneTimeMicros',
          'bom.amortizedUnitMicros', 'bom.fullyLoadedUnitMicros', 'bom.moqConstrainedRunUnits'],
      },
      { kind: 'prose', heading: 'Sourcing notes', proseKey: 'sourcing' },
    ],
  },
  {
    key: 'manufacturing-plan',
    title: 'Manufacturing plan',
    audience: 'operations',
    decision: 'Can this be built at the quality and volume the plan assumes?',
    sections: [
      { kind: 'prose', heading: 'Process and tooling', proseKey: 'manufacturing' },
      { kind: 'figures', heading: 'Volume constraints', keys: ['bom.moqConstrainedRunUnits', 'bom.oneTimeMicros'] },
      { kind: 'prose', heading: 'Quality plan', proseKey: 'quality' },
    ],
  },
  {
    key: 'supplier-plan-srm',
    title: 'Supplier plan',
    audience: 'sourcing',
    decision: 'Who do we ask for a quote, in what order, and where are we single-sourced?',
    sections: [
      { kind: 'table', heading: 'Vendors and status', table: 'vendors' },
      { kind: 'prose', heading: 'Sourcing strategy', proseKey: 'srm' },
      { kind: 'assumptions', heading: 'Supplier assumptions', domains: ['manufacturing'] },
    ],
  },
  {
    key: 'logistics-and-landed-cost',
    title: 'Logistics and landed cost',
    audience: 'operations and finance',
    decision: 'What does it cost to get one unit from the factory gate into the warehouse?',
    sections: [
      {
        kind: 'figures',
        heading: 'The landed stack',
        keys: ['landed.buyerTotalMicros', 'landed.buyerUnitMicros', 'landed.customsValueMicros',
          'landed.containers'],
        optionalKeys: ['landed.containerFillRatio', 'landed.effectiveDutyBps'],
      },
      { kind: 'table', heading: 'Cost legs', table: 'landedLegs' },
      { kind: 'prose', heading: 'Freight and customs notes', proseKey: 'logistics' },
    ],
  },
  {
    key: 'compliance-and-certification',
    title: 'Compliance and certification',
    audience: 'the person who signs the declaration of conformity',
    decision: 'What has to be tested and certified before this can be sold, and by when?',
    sections: [
      { kind: 'prose', heading: 'Applicable regimes', proseKey: 'compliance' },
      { kind: 'assumptions', heading: 'Compliance assumptions', domains: ['compliance'] },
      { kind: 'prose', heading: 'Open questions for a specialist', proseKey: 'compliance-questions' },
    ],
  },
  {
    key: 'unit-economics',
    title: 'Unit economics',
    audience: 'finance',
    decision: 'Does one unit make money, and at which price and channel?',
    sections: [
      { kind: 'table', heading: 'Per-unit waterfall by channel', table: 'waterfall' },
      {
        kind: 'figures',
        heading: 'Per unit',
        keys: ['landed.buyerUnitMicros', 'breakEven.contributionPerUnitMicros'],
      },
      { kind: 'prose', heading: 'Reading the waterfall', proseKey: 'unit-economics' },
    ],
  },
  {
    key: 'financial-model',
    title: 'Financial model',
    audience: 'finance and investors',
    decision: 'Over the horizon, does the venture earn more than it costs?',
    sections: [
      { kind: 'table', heading: 'Monthly profit and loss', table: 'pnl' },
      {
        kind: 'figures',
        heading: 'Horizon totals',
        keys: ['financials.revenueMicros', 'financials.contributionMicros',
          'financials.fixedCostsMicros', 'financials.netIncomeMicros'],
        optionalKeys: ['breakEven.units'],
      },
      { kind: 'prose', heading: 'What drives the result', proseKey: 'financials' },
    ],
  },
  {
    key: 'cash-flow-and-working-capital',
    title: 'Cash flow and working capital',
    audience: 'whoever has to fund the gap',
    decision: 'How much cash goes out before any comes back, and when is the trough?',
    sections: [
      { kind: 'table', heading: 'Monthly cash', table: 'cash' },
      {
        kind: 'figures',
        heading: 'The funding gap',
        keys: ['financials.peakCashTroughMicros', 'financials.fundingRequiredMicros',
          'financials.monthsUnderwater'],
      },
      { kind: 'prose', heading: 'Why the trough falls where it does', proseKey: 'cash' },
    ],
  },
  {
    key: 'sensitivity-and-risk',
    title: 'Sensitivity and risk',
    audience: 'whoever is deciding',
    decision: 'Which single assumption most changes the answer, and what should we resolve first?',
    sections: [
      { kind: 'table', heading: 'Tornado — swing by assumption', table: 'tornado' },
      { kind: 'prose', heading: 'Risks and triggers', proseKey: 'risk' },
    ],
  },
  {
    key: 'org-and-hiring-plan',
    title: 'Organisation and hiring plan',
    audience: 'whoever is doing the hiring',
    decision: 'Who do we need, from which month, and what does that cost?',
    sections: [
      { kind: 'table', heading: 'Roles', table: 'headcount' },
      // Optional, because a founder-operated plan has no headcount figure at all.
      // A printed "$0 of headcount" reads as a costed answer; the absence is the
      // answer, and the prose section is where it is stated.
      { kind: 'figures', heading: 'Headcount cost', keys: [], optionalKeys: ['headcount.totalMicros', 'headcount.peakFte'] },
      { kind: 'prose', heading: 'Hiring notes', proseKey: 'org' },
    ],
  },
  {
    key: 'timeline-and-gantt',
    title: 'Timeline',
    audience: 'the programme manager',
    decision: 'Can we be on shelf when we said, and what is the long pole?',
    sections: [
      { kind: 'table', heading: 'Planned tasks', table: 'schedule' },
      {
        kind: 'figures',
        heading: 'Critical path',
        keys: ['schedule.criticalPathWeeks', 'schedule.weeksLate'],
      },
      { kind: 'prose', heading: 'Schedule risk', proseKey: 'timeline' },
    ],
  },
  {
    key: 'go-to-market-plan',
    title: 'Go-to-market plan',
    audience: 'sales and marketing',
    decision: 'How do the first units get sold, and what does that cost per unit?',
    sections: [
      { kind: 'prose', heading: 'Launch plan', proseKey: 'gtm' },
      { kind: 'figures', heading: 'Volume and price', keys: ['demand.units', 'demand.priceMicros'] },
      { kind: 'assumptions', heading: 'Channel assumptions', domains: ['channel', 'market'] },
    ],
  },
  {
    key: 'funding-ask',
    title: 'Funding ask',
    audience: 'a lender or an investor',
    decision: 'How much money, for what, and what does the money buy certainty about?',
    sections: [
      {
        kind: 'figures',
        heading: 'The ask',
        keys: ['financials.fundingRequiredMicros', 'financials.peakCashTroughMicros',
          'financials.monthsUnderwater', 'bom.oneTimeMicros'],
      },
      { kind: 'prose', heading: 'Use of funds', proseKey: 'use-of-funds' },
      { kind: 'assumptions', heading: 'What this ask rests on' },
    ],
  },
]);

/** Every document key, in catalogue order. */
export const DOC_KEYS: readonly string[] = Object.freeze(DOC_CATALOG.map((d) => d.key));

/**
 * @description Look one document specification up by key.
 * @param key - The document key.
 * @returns The specification, or null when the key is not in the catalogue.
 */
export function getDocSpec(key: string): DocSpec | null {
  return DOC_CATALOG.find((d) => d.key === key) ?? null;
}

/**
 * @description Every prose section key one document asks a writer for.
 * @param spec - The document specification.
 * @returns The prose keys, in section order.
 */
export function proseKeysFor(spec: DocSpec): string[] {
  return spec.sections.filter((s): s is Extract<DocSection, { kind: 'prose' }> => s.kind === 'prose')
    .map((s) => s.proseKey);
}

/**
 * @description Every REQUIRED figure id one document prints.
 * @param spec - The document specification.
 * @returns The required figure ids, de-duplicated.
 */
export function requiredFigureIds(spec: DocSpec): string[] {
  const ids = new Set<string>();
  for (const s of spec.sections) if (s.kind === 'figures') for (const k of s.keys) ids.add(k);
  return [...ids];
}

// Load-time integrity: a catalogue entry with no stated decision is padding, and
// padding is how a reader learns to skim the parts that matter. Throwing at import
// means a bad entry cannot reach a running system.
for (const spec of DOC_CATALOG) {
  if (!spec.decision || !spec.decision.trim()) {
    throw new Error(`venture document "${spec.key}" states no decision it supports`);
  }
  if (!spec.sections.length) {
    throw new Error(`venture document "${spec.key}" has no sections`);
  }
}
