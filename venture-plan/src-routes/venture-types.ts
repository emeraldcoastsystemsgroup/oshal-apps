/**
 * Venture Plan — the store/route DTO layer.
 *
 * These are the shapes that cross the HTTP boundary and the database boundary.
 * They are deliberately SEPARATE from the engine's types (`venture-assumptions`,
 * `venture-bom`, …): the engine speaks in integer micro-dollars and basis points
 * and knows nothing about `owner_sub`, while these carry ownership, revision
 * history and source provenance and know nothing about arithmetic.
 *
 * THE ONE TYPE-LEVEL RULE. `Assumption.provenance` is the literal `'assumed'` and
 * `Figure.provenance` is the literal `'computed'`. Neither is optional and neither
 * is a union. That is what makes "a computed number is stored as an assumption" a
 * compile error rather than a code-review question — and it is the reason the bot
 * parsers can only ever produce `Assumption` values.
 *
 * `SourceKind` is closed on purpose. A bot may claim `vendor-quote`; the parser
 * in `venture-bot-contracts` downgrades it to `model-estimate` unless a source URL
 * or document reference came with it. A model cannot certify its own guess.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the closed SourceKind/Confidence/Domain enums, the row DTOs for every stored entity, the provenance literal discriminants, and the run/stage vocabularies the routes and the orchestrator share.
 *
 * @module venture-types
 */

/** How a stored number came to exist. Closed — a new kind is a schema decision. */
export type SourceKind =
  | 'model-estimate'
  | 'user-entered'
  | 'vendor-quote'
  | 'published-source'
  | 'derived';

/** Every source kind, for validation and for the coverage roll-up. */
export const SOURCE_KINDS: readonly SourceKind[] = Object.freeze([
  'model-estimate', 'user-entered', 'vendor-quote', 'published-source', 'derived',
]);

/**
 * Source kinds a bot may assert about its own output WITHOUT external evidence.
 * Everything else needs a URL or a document reference, or it is downgraded.
 */
export const SELF_CERTIFIABLE_SOURCE_KINDS: readonly SourceKind[] = Object.freeze(['model-estimate']);

/** How much weight a number can carry. */
export type Confidence = 'low' | 'medium' | 'high';

/** Every confidence level, weakest first. */
export const CONFIDENCES: readonly Confidence[] = Object.freeze(['low', 'medium', 'high']);

/** Which part of the venture an assumption belongs to. Drives the ledger grouping. */
export type Domain =
  | 'product' | 'market' | 'channel' | 'manufacturing' | 'logistics'
  | 'compliance' | 'finance' | 'org' | 'schedule';

/**
 * The arithmetic contract version, folded into every model's `inputs_hash`.
 *
 * BUMP IT WHENEVER AN ENGINE CHANGE MOVES A NUMBER. That invalidates every stored
 * hash, which is the point: a document rendered under the old arithmetic must read
 * as stale rather than as agreeing with a model it no longer matches.
 */
export const ENGINE_VERSION = '1.0.0';

/** Every domain, in the order the surface groups them. */
export const DOMAINS: readonly Domain[] = Object.freeze([
  'product', 'market', 'channel', 'manufacturing', 'logistics',
  'compliance', 'finance', 'org', 'schedule',
]);

/** A venture's lifecycle stage. Advanced by what exists, never by a click alone. */
export type VentureStage = 'scoped' | 'assumed' | 'modelled' | 'documented';

/** What a run was asked to do. `full` runs every authoring phase. */
export type RunKind = 'full' | 'bom' | 'market' | 'ops' | 'narrate';

/** The phases a `full` run walks, in order. Two of them are independent. */
export const RUN_PHASES: readonly string[] = Object.freeze(['bom', 'market', 'ops', 'compute', 'narrate']);

/** One assumption revision. Rows are NEVER updated in place; a change is a new row. */
export interface Assumption {
  id: string;
  ventureId: string;
  key: string;
  domain: Domain;
  label: string;
  unit: string;
  valueNum: number | null;
  valueText: string | null;
  lowNum: number | null;
  highNum: number | null;
  sourceKind: SourceKind;
  sourceDetail: string | null;
  sourceUrl: string | null;
  confidence: Confidence;
  /** An agentId, or `user:<sub>`. The accountable author of this number. */
  authoredBy: string;
  runId: string | null;
  /** Set to the id of the revision that replaced this one. Null means live. */
  supersededBy: string | null;
  createdAt: string;
  /** Literal. An `Assumption` can never carry a computed result. */
  provenance: 'assumed';
}

/** The write shape for an assumption — no id, no supersede pointer, no clock. */
export interface AssumptionInput {
  key: string;
  domain: Domain;
  label: string;
  unit: string;
  valueNum?: number | null;
  valueText?: string | null;
  lowNum?: number | null;
  highNum?: number | null;
  sourceKind: SourceKind;
  sourceDetail?: string | null;
  sourceUrl?: string | null;
  confidence: Confidence;
}

/** A supplier, contract manufacturer, freight forwarder or lab. */
export interface Vendor {
  id: string;
  ventureId: string;
  name: string;
  kind: string;
  country: string | null;
  url: string | null;
  contact: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  qualificationDays: number | null;
  depositBps: number;
  balanceNetDays: number;
  qualified: boolean;
  notes: string | null;
  status: string;
  sourceKind: SourceKind;
  confidence: Confidence;
}

/** One line of the hierarchical bill of materials. Costs are MICRO-dollars. */
export interface BomLine {
  id: string;
  ventureId: string;
  parentLineId: string | null;
  ref: string;
  partName: string;
  specText: string | null;
  qtyPerUnit: number;
  uom: string;
  discrete: boolean;
  material: string | null;
  process: string | null;
  makeOrBuy: string;
  unitCostMicros: number | null;
  lowMicros: number | null;
  highMicros: number | null;
  scrapPct: number;
  moq: number | null;
  leadTimeDays: number | null;
  toolingCostMicros: number;
  toolingLifeUnits: number | null;
  vendorId: string | null;
  /** The assumption key this line's unit cost resolves through. */
  assumptionKey: string | null;
  htsCode: string | null;
  dutyPct: number | null;
  sourceKind: SourceKind;
  confidence: Confidence;
  sortOrder: number;
}

/** A received supplier quote. Writing one supersedes the estimate it replaces. */
export interface Quote {
  id: string;
  ventureId: string;
  vendorId: string;
  bomLineId: string | null;
  qtyBreak: number;
  unitCostMicros: number;
  currency: string;
  toolingCostMicros: number;
  incoterm: string | null;
  leadTimeDays: number | null;
  validUntil: string | null;
  documentRef: string | null;
  notes: string | null;
  assumptionId: string | null;
  receivedAt: string;
}

/** A planned task on the launch schedule. */
export interface ScheduleTask {
  id: string;
  ventureId: string;
  phase: string;
  name: string;
  ownerRole: string | null;
  durationDays: number;
  dependsOn: string[];
  assumptionKey: string | null;
  sourceKind: SourceKind;
  confidence: Confidence;
  sortOrder: number;
}

/** One planned role. Months are offsets from the horizon start. */
export interface HeadcountRow {
  id: string;
  ventureId: string;
  role: string;
  kind: 'employee' | 'contractor';
  fte: number;
  startMonth: number;
  endMonth: number | null;
  baseSalaryMicros: number;
  burdenBps: number;
  recruitCostMicros: number;
  assumptionKey: string | null;
  sourceKind: SourceKind;
  confidence: Confidence;
  sortOrder: number;
}

/** A what-if: named overrides applied on top of the live assumption set. */
export interface Scenario {
  id: string;
  ventureId: string;
  name: string;
  overrides: Record<string, number>;
  volumeUnits: number | null;
  retailPriceCents: number | null;
  channelMix: Record<string, number>;
  isBase: boolean;
  createdAt: string;
}

/**
 * The qualitative + structural spec a venture is modelled from.
 *
 * The strategist bot authors the QUALITATIVE half (product class, customer,
 * positioning, constraints). The STRUCTURAL half — run quantity, incoterm, freight
 * profile, channel shapes, season, timing, horizon — is numeric, so it is either
 * operator-entered or carried by an assumption that a binding writes back into
 * this object at compute time.
 */
export interface VentureSpec {
  productClass?: string;
  customer?: string;
  positioning?: string;
  constraints?: string[];
  /** Structural inputs the engine needs. Overlaid on the package defaults. */
  structure?: Record<string, unknown>;
  /** Assumption id -> dotted path into the engine input. */
  bindings?: Array<{ assumptionId: string; path: string }>;
}

/** A venture header. */
export interface Venture {
  id: string;
  ownerSub: string;
  name: string;
  ideaText: string;
  spec: VentureSpec;
  currency: string;
  targetLaunchDate: string | null;
  stage: VentureStage;
  horizonMonths: number;
  openQuestions: string[];
  createdAt: string;
  updatedAt: string;
}

/** One phase of a run, as the poller sees it. */
export interface RunPhase {
  name: string;
  agentId: string | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  durationMs: number | null;
  error: string | null;
}

/** A run header. */
export interface RunSummary {
  id: string;
  ventureId: string;
  kind: RunKind;
  status: 'running' | 'done' | 'failed';
  phase: string | null;
  phases: RunPhase[];
  botsRequested: number;
  botsCompleted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * One number produced by the engine.
 *
 * `provenance` is the literal `'computed'`: a figure is never an assumption, and
 * the document renderer resolves figure KEYS rather than accepting literals, so a
 * number cannot enter a document as prose.
 */
export interface Figure {
  key: string;
  label: string;
  unit: string;
  value: number;
  formula: string;
  inputs: Array<{ ref: string; kind: 'assumption' | 'figure' }>;
  provenance: 'computed';
}

/** How much of the model still rests on the model's own guesses. */
export interface Coverage {
  totalAssumptions: number;
  bySourceKind: Record<SourceKind, number>;
  byConfidence: Record<Confidence, number>;
  /** Percentage of live assumptions whose source kind is `model-estimate`. */
  estimatePct: number;
}

/** A persisted, immutable model snapshot. */
export interface ModelSnapshot {
  id: string;
  ventureId: string;
  scenarioId: string | null;
  runId: string | null;
  engineVersion: string;
  inputsHash: string;
  figures: Record<string, Figure>;
  tables: Record<string, unknown[]>;
  coverage: Coverage;
  warnings: string[];
  posture: string;
  canPublish: boolean;
  computedAt: string;
}

/** A rendered document version. */
export interface StoredDocument {
  id: string;
  ventureId: string;
  docKey: string;
  version: number;
  modelId: string;
  title: string;
  bodyMd: string;
  sections: Array<{ heading: string; kind: string }>;
  proseRunId: string | null;
  proseStatus: 'none' | 'generated' | 'flagged';
  unverifiedNumbers: string[];
  assumptionsCited: string[];
  estimatePct: number;
  createdAt: string;
}

/**
 * @description Narrow an arbitrary value to a known source kind.
 * @param v - Candidate value, typically off a bot's JSON.
 * @returns True when `v` is a member of the closed set.
 */
export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === 'string' && (SOURCE_KINDS as readonly string[]).includes(v);
}

/**
 * @description Narrow an arbitrary value to a known confidence level.
 * @param v - Candidate value.
 * @returns True when `v` is `low`, `medium` or `high`.
 */
export function isConfidence(v: unknown): v is Confidence {
  return typeof v === 'string' && (CONFIDENCES as readonly string[]).includes(v);
}

/**
 * @description Narrow an arbitrary value to a known domain.
 * @param v - Candidate value.
 * @returns True when `v` is one of the nine domains.
 */
export function isDomain(v: unknown): v is Domain {
  return typeof v === 'string' && (DOMAINS as readonly string[]).includes(v);
}
