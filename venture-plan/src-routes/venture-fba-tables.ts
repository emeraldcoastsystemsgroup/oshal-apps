/**
 * Venture engine — effective-dated marketplace fee tables.
 *
 * WHY THIS IS A DATED TABLE AND NOT A CONSTANT. Marketplace fulfilment and
 * storage rates change on a published schedule. A rate hardcoded as a constant
 * silently prices last year's economics forever, and nothing in an engine can
 * tell that it has gone stale. So each table carries `effectiveFrom`, who
 * published it, where, and when it was retrieved — and `fbaTableFor` raises a
 * `fee-table-stale` issue when the newest table it has predates the modelling
 * date by more than a year.
 *
 * WHY PEAK STORAGE IS NOT AVERAGED. Q4 storage runs several times the off-peak
 * rate, and a seasonal product sits in the warehouse through exactly those
 * months. Averaging the rate across the year hides the entire problem for the one
 * product category most exposed to it, so storage is summed month by month at the
 * rate that applies in each month.
 *
 * POSTURE. The values below are SEED data, not a verified rate card: they carry
 * their provenance so an operator can see what they are and replace them with the
 * current card. `fbaTableVerified` is false and the model surfaces it. Nothing
 * here should be read as a quoted fee.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the effective-dated table shape with provenance, size-tier classification from dimensions and weight, the fulfilment-fee ladder, month-by-month storage that charges the peak rate where it actually falls, and the staleness issue.
 *
 * @module venture-fba-tables
 */

import { issue, type VentureIssue } from './venture-issues';
import { addMicros, dollarsToMicros, scaleMicros, ymParts, type Micros, type YearMonth } from './venture-primitives';

/** Marketplace size tiers, smallest first. */
export type FbaSizeTier =
  | 'small-standard' | 'large-standard' | 'large-bulky'
  | 'extra-large-0-50' | 'extra-large-50-70' | 'extra-large-70-150';

/** One fulfilment-fee row: the fee for a tier up to a shipping weight ceiling. */
export interface FbaFeeRow {
  tier: FbaSizeTier;
  /** Inclusive ceiling in ounces; rows are matched in ascending order. */
  maxShippingWeightOz: number;
  feeMicros: Micros;
}

/** Monthly storage rates per cubic foot, split peak and off-peak. */
export interface FbaStorageRates {
  standardOffPeak: Micros;
  standardPeak: Micros;
  oversizeOffPeak: Micros;
  oversizePeak: Micros;
}

/** One dated fee card. */
export interface FbaFeeTable {
  effectiveFrom: string;
  publishedBy: string;
  url: string;
  retrievedAt: string;
  /** False until an operator confirms the card against the live source. */
  verified: boolean;
  rows: FbaFeeRow[];
  storagePerCubicFoot: FbaStorageRates;
  /** Calendar months (1-12) charged at the peak storage rate. */
  peakMonths: number[];
  /** Referral rate for the category, in basis points. */
  referralBps: number;
  assumptionRefs: string[];
}

const D = dollarsToMicros;

/**
 * Dated fee cards, NEWEST FIRST. One seed card; add a newer one rather than
 * editing this one, so a model dated before the change still prices correctly.
 */
export const FBA_FEE_TABLES: readonly FbaFeeTable[] = [
  {
    effectiveFrom: '2026-01-15',
    publishedBy: 'Amazon US FBA rate card (seed values — operator must confirm)',
    url: 'https://sellercentral.amazon.com/help/hub/reference/GG9RUEEUGSK9AA8F',
    retrievedAt: '2026-08-01',
    verified: false,
    rows: [
      { tier: 'small-standard', maxShippingWeightOz: 16, feeMicros: D(3.25) },
      { tier: 'large-standard', maxShippingWeightOz: 16, feeMicros: D(3.86) },
      { tier: 'large-standard', maxShippingWeightOz: 48, feeMicros: D(5.14) },
      { tier: 'large-standard', maxShippingWeightOz: 320, feeMicros: D(6.92) },
      { tier: 'large-bulky', maxShippingWeightOz: 800, feeMicros: D(8.66) },
      { tier: 'extra-large-0-50', maxShippingWeightOz: 800, feeMicros: D(26.33) },
      { tier: 'extra-large-50-70', maxShippingWeightOz: 1120, feeMicros: D(40.12) },
      { tier: 'extra-large-70-150', maxShippingWeightOz: 2400, feeMicros: D(54.81) },
    ],
    storagePerCubicFoot: {
      standardOffPeak: D(0.78), standardPeak: D(2.40),
      oversizeOffPeak: D(0.48), oversizePeak: D(1.20),
    },
    peakMonths: [10, 11, 12],
    referralBps: 1500,
    assumptionRefs: [],
  },
] as const;

/** Tiers billed at the oversize storage rate. */
const OVERSIZE_TIERS = new Set<FbaSizeTier>(['large-bulky', 'extra-large-0-50', 'extra-large-50-70', 'extra-large-70-150']);

/**
 * @description The fee card in force on a modelling date, plus a staleness issue
 *   when the newest card the engine holds is more than twelve months older than
 *   the date being modelled. The engine cannot know a card has been superseded;
 *   it can and does say how old the one it has is.
 * @param onDate - The modelling date, `YYYY-MM-DD`.
 * @returns The applicable card and any staleness issue.
 */
export function fbaTableFor(onDate: string): { table: FbaFeeTable; issues: VentureIssue[] } {
  const sorted = [...FBA_FEE_TABLES].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const table = sorted.find((t) => t.effectiveFrom <= onDate) ?? sorted[sorted.length - 1];
  const issues: VentureIssue[] = [];
  const ageDays = (Date.parse(onDate) - Date.parse(table.effectiveFrom)) / 86_400_000;
  if (Number.isFinite(ageDays) && ageDays > 365) {
    issues.push(issue('fee-table-stale', 'warn', 'fba:table',
      `The newest marketplace fee card held here took effect ${table.effectiveFrom}, over a year before the modelled date ${onDate}; marketplace fees are republished more often than that.`,
      { effectiveFrom: table.effectiveFrom, onDate, ageDays: Math.round(ageDays) }));
  }
  if (!table.verified) {
    issues.push(issue('unsourced-estimate', 'warn', 'fba:table',
      `The marketplace fee card dated ${table.effectiveFrom} is seed data that nobody has confirmed against the live rate card; every fee derived from it is an estimate.`,
      { effectiveFrom: table.effectiveFrom }));
  }
  return { table, issues };
}

/**
 * @description Classify a product into a marketplace size tier from its packed
 *   dimensions and weight. Tier decides both the fulfilment fee and whether
 *   storage bills at the standard or oversize rate, so a misclassification moves
 *   two lines at once.
 * @param dims - Packed dimensions in inches and weight in pounds.
 * @returns The size tier.
 */
export function classifySizeTier(dims: { lengthIn: number; widthIn: number; heightIn: number; weightLb: number }): FbaSizeTier {
  const sides = [dims.lengthIn, dims.widthIn, dims.heightIn].map((n) => Math.max(0, n)).sort((a, b) => b - a);
  const [longest, median, shortest] = sides;
  const lb = Math.max(0, dims.weightLb);
  const girth = longest + 2 * (median + shortest);
  if (lb <= 1 && longest <= 15 && median <= 12 && shortest <= 0.75) return 'small-standard';
  if (lb <= 20 && longest <= 18 && median <= 14 && shortest <= 8) return 'large-standard';
  if (lb <= 50 && longest <= 59 && median <= 33 && shortest <= 33 && girth <= 130) return 'large-bulky';
  if (lb <= 50) return 'extra-large-0-50';
  if (lb <= 70) return 'extra-large-50-70';
  return 'extra-large-70-150';
}

/**
 * @description The fulfilment fee for one unit. Rows are matched in ascending
 *   weight order within the tier; a unit heavier than every row falls to the
 *   heaviest row rather than to zero, because a missing fee is a fee of zero and
 *   zero is the single most dangerous default in a margin model.
 * @param t - The fee card.
 * @param tier - The size tier.
 * @param shippingWeightOz - Packed shipping weight in ounces.
 * @returns The fee in micros.
 */
export function fbaFulfilmentFee(t: FbaFeeTable, tier: FbaSizeTier, shippingWeightOz: number): Micros {
  const rows = t.rows.filter((r) => r.tier === tier).sort((a, b) => a.maxShippingWeightOz - b.maxShippingWeightOz);
  if (!rows.length) return 0;
  const oz = Math.max(0, shippingWeightOz);
  return (rows.find((r) => oz <= r.maxShippingWeightOz) ?? rows[rows.length - 1]).feeMicros;
}

/**
 * @description Storage cost for one unit across the months it actually occupies
 *   the warehouse, charged at the rate in force in each month. A seasonal product
 *   is in storage through the peak months by definition, so this is summed rather
 *   than averaged.
 * @param t - The fee card.
 * @param cubicFeet - Packed volume of one unit.
 * @param months - The months the unit is held.
 * @param oversize - Whether the unit bills at the oversize rate.
 * @returns Storage cost in micros for one unit across the whole period.
 */
export function fbaStorageCost(t: FbaFeeTable, cubicFeet: number, months: readonly YearMonth[], oversize: boolean): Micros {
  const cf = Math.max(0, cubicFeet);
  const rates = t.storagePerCubicFoot;
  const parts = months.map((m) => {
    const peak = t.peakMonths.includes(ymParts(m).month);
    const rate = oversize
      ? (peak ? rates.oversizePeak : rates.oversizeOffPeak)
      : (peak ? rates.standardPeak : rates.standardOffPeak);
    return scaleMicros(rate, cf);
  });
  return addMicros(...parts);
}

/**
 * @description Whether a tier bills at the oversize storage rate.
 * @param tier - The size tier.
 * @returns True for the bulky and extra-large tiers.
 */
export function isOversizeTier(tier: FbaSizeTier): boolean {
  return OVERSIZE_TIERS.has(tier);
}
