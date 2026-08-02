/**
 * Venture engine — the channel margin waterfall, in both directions.
 *
 * THE STRUCTURAL INVARIANT THAT MAKES THE INVERSE EXACT: a channel fee may depend
 * on shelf price, weight, size tier, storage months or volume — NEVER on landed
 * cost. Under that invariant the fee stack is affine in price, so both directions
 * solve without iteration or approximation:
 *
 *   forward (price from cost):  contribution(S) = S + revFixed - fees(S) - lf * L
 *   inverse (max affordable L): lf * L = S + revFixed - fees(S) - required
 *
 * `validateChannel` REJECTS a cost-dependent fee shape with a blocking issue
 * rather than quietly degrading the inverse into an approximation — a
 * "break-even landed cost" that is off by a few percent is exactly the confident
 * wrong number this engine exists to prevent.
 *
 * WHY A `landedFactorBps` AND NOT A BARE SUBTRACTION. On a direct channel a
 * returned unit is often resellable, so a fraction of its landed cost comes back.
 * That makes the landed term `lf x L`, not `L`. Keeping it as an explicit integer
 * factor preserves the exact inverse and stops the salvage credit going missing.
 *
 * WHY A NEGATIVE CONTRIBUTION IS RETURNED, NOT CLAMPED. A channel that loses
 * money per unit is a finding. Clamping it to zero turns the most important thing
 * the model can tell you into silence.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the four channel shapes (direct, marketplace, big-box, distributor) decomposed into an affine fee stack, the forward waterfall for all three pricing modes, the exact inverse for maximum affordable landed cost, the cost-dependent-fee rejection that keeps the inverse exact, and the blended contribution across a channel mix.
 *
 * @module venture-channels
 */

import {
  classifySizeTier, fbaFulfilmentFee, fbaStorageCost, fbaTableFor, isOversizeTier,
  type FbaFeeTable, type FbaSizeTier,
} from './venture-fba-tables';
import { issue, type VentureIssue } from './venture-issues';
import {
  BPS_ONE, addMicros, applyBps, bpsOf, roundHalfUp, scaleMicros, subMicros,
  type Bps, type Micros, type Ratio, type YearMonth,
} from './venture-primitives';

/** The four route-to-market shapes this engine models. */
export type ChannelKind = 'dtc' | 'amazon' | 'big-box' | 'distributor';

/** Direct-to-consumer economics, per unit shipped. */
export interface DtcEconomics {
  kind: 'dtc';
  paymentBps: Bps;
  paymentFixedMicros: Micros;
  outboundShipMicros: Micros;
  shippingChargedToCustomerMicros: Micros;
  pickPackMicros: Micros;
  returnRateRatio: Ratio;
  returnHandlingMicros: Micros;
  /** Fraction of a returned unit's landed cost recovered as resellable stock. */
  returnSalvageRatio: Ratio;
  cacPerOrderMicros: Micros;
}

/** Marketplace economics, per unit shipped. */
export interface AmazonEconomics {
  kind: 'amazon';
  referralBps: Bps;
  dims: { lengthIn: number; widthIn: number; heightIn: number; weightLb: number };
  shippingWeightOz: number;
  cubicFeet: number;
  /** The months a unit actually occupies the warehouse — peak rates apply where they fall. */
  storageMonths: YearMonth[];
  inboundPerUnitMicros: Micros;
  returnRateRatio: Ratio;
  returnProcessingMicros: Micros;
  /** Advertising cost of sale, as basis points of shelf price. */
  acosBps: Bps;
  /** Modelling date used to select the fee card. */
  feeTableDate: string;
}

/** Big-box retail economics. The retailer sets shelf price from your wholesale. */
export interface BigBoxEconomics {
  kind: 'big-box';
  retailerMarginBps: Bps;
  markdownAllowanceBps: Bps;
  coopAdvertisingBps: Bps;
  defectiveAllowanceBps: Bps;
  chargebackBps: Bps;
  earlyPaymentDiscountBps: Bps;
  freightAllowanceBps: Bps;
  newStoreAllowanceBps: Bps;
  paymentNetDays: number;
}

/** Two-step distribution economics. */
export interface DistributorEconomics {
  kind: 'distributor';
  distributorMarginBps: Bps;
  retailerMarginBps: Bps;
  allowancesBps: Bps;
  paymentNetDays: number;
}

/** Any channel's economics. */
export type ChannelEconomics = DtcEconomics | AmazonEconomics | BigBoxEconomics | DistributorEconomics;

/** One route to market and the share of volume routed down it. */
export interface Channel {
  id: string;
  label: string;
  economics: ChannelEconomics;
  /** Share of total volume. Shares across channels are normalised, not required to sum to 1. */
  volumeShareRatio: Ratio;
  assumptionRefs: string[];
}

/** How the shelf price is arrived at. */
export type PriceSetting =
  | { kind: 'from-cost'; targetContributionBps: Bps }
  | { kind: 'fixed-shelf'; shelfPriceMicros: Micros }
  | { kind: 'fixed-wholesale'; wholesaleMicros: Micros };

/** One line of a waterfall as a document prints it. Signed: negatives reduce. */
export interface WaterfallStep {
  key: string;
  label: string;
  amountMicros: Micros;
  ofBps?: Bps;
  basis: string;
  assumptionRefs: string[];
}

/** The computed waterfall for one channel at one price and one landed cost. */
export interface ChannelWaterfall {
  channelId: string;
  kind: ChannelKind;
  shelfPriceMicros: Micros;
  /** The price YOU invoice. Present for big-box and distributor, null otherwise. */
  wholesaleMicros: Micros | null;
  /** Wholesale minus every allowance — the money you actually bank. */
  netWholesaleMicros: Micros | null;
  landedUnitMicros: Micros;
  steps: WaterfallStep[];
  /** Shelf price plus any revenue you collect on top of it (shipping charged). */
  grossRevenueMicros: Micros;
  totalFeeMicros: Micros;
  /**
   * The acquisition and advertising slice of `totalFeeMicros`. Split out because
   * it is money YOU pay out, not money the channel withholds from a remittance —
   * treating it as a deduction from the settlement makes accounts receivable
   * disagree with cash by exactly the marketing spend.
   */
  marketingMicros: Micros;
  contributionPerUnitMicros: Micros;
  contributionBps: Bps | null;
  /** Affine decomposition the exact inverse uses: fees = feeVarBps x S + feeFixed. */
  feeVarBps: Bps;
  feeFixedMicros: Micros;
  /** Revenue decomposition: gross = revVarBps x S + revFixed. */
  revVarBps: Bps;
  revFixedMicros: Micros;
  /** Landed cost enters as lf x L; below 1.0 when returns are resellable. */
  landedFactorBps: Bps;
  issues: VentureIssue[];
  assumptionRefs: string[];
}

/** Internal affine fee component. amount(S) = applyBps(S, varBps) + fixedMicros. */
interface FeeComponent {
  key: string;
  label: string;
  varBps: Bps;
  fixedMicros: Micros;
  basis: string;
  assumptionRefs: string[];
}

/** The affine decomposition of a channel, independent of price and landed cost. */
export interface ChannelDecomposition {
  components: FeeComponent[];
  feeVarBps: Bps;
  feeFixedMicros: Micros;
  revVarBps: Bps;
  revFixedMicros: Micros;
  landedFactorBps: Bps;
  /** Fraction of shelf price you invoice, in bps. 10000 for direct channels. */
  wholesaleFactorBps: Bps;
  issues: VentureIssue[];
}

/** Fee keys that are advertising/acquisition spend rather than a channel charge. */
export const MARKETING_FEE_KEYS: readonly string[] = ['customer-acquisition', 'advertising', 'coop-advertising'] as const;

/** Economics keys the four shapes legitimately carry. Anything else is inspected. */
const KNOWN_ECONOMICS_KEYS = new Set<string>([
  'kind', 'paymentBps', 'paymentFixedMicros', 'outboundShipMicros', 'shippingChargedToCustomerMicros',
  'pickPackMicros', 'returnRateRatio', 'returnHandlingMicros', 'returnSalvageRatio', 'cacPerOrderMicros',
  'referralBps', 'dims', 'shippingWeightOz', 'cubicFeet', 'storageMonths', 'inboundPerUnitMicros',
  'returnProcessingMicros', 'acosBps', 'feeTableDate', 'retailerMarginBps', 'markdownAllowanceBps',
  'coopAdvertisingBps', 'defectiveAllowanceBps', 'chargebackBps', 'earlyPaymentDiscountBps',
  'freightAllowanceBps', 'newStoreAllowanceBps', 'paymentNetDays', 'distributorMarginBps', 'allowancesBps',
]);

const COST_DEPENDENT_RE = /landed|cogs|unitcost|costof|percost/i;

/**
 * @description Validate a channel before it is priced. Rejects any fee shape that
 *   depends on landed cost, because that invariant is the whole reason the inverse
 *   is exact rather than iterative, and rejects rates outside their physical range.
 * @param c - The channel to validate.
 * @returns Issues; a `block` here means the channel must not be priced.
 */
export function validateChannel(c: Channel): VentureIssue[] {
  const issues: VentureIssue[] = [];
  const where = `channel:${c.id}`;
  for (const key of Object.keys(c.economics as unknown as Record<string, unknown>)) {
    if (KNOWN_ECONOMICS_KEYS.has(key)) continue;
    if (COST_DEPENDENT_RE.test(key)) {
      issues.push(issue('cost-dependent-fee-rejected', 'block', where,
        `"${c.label}" declares a fee "${key}" that appears to depend on landed cost. Channel fees must depend only on price, weight, size or volume — a cost-dependent fee makes the maximum-affordable-cost inverse an approximation, and an approximate break-even is the failure this engine exists to prevent.`,
        { channelId: c.id, feeKey: key }));
    } else {
      issues.push(issue('invalid-channel-rate', 'warn', where,
        `"${c.label}" declares an unrecognised economics field "${key}"; it is ignored by the waterfall.`,
        { channelId: c.id, feeKey: key }));
    }
  }
  const e = c.economics as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(e)) {
    if (key.endsWith('Bps') && typeof value === 'number' && (value < 0 || value >= BPS_ONE)) {
      issues.push(issue('invalid-channel-rate', 'block', where,
        `"${c.label}" declares ${key} = ${value} bps, which is outside 0-9999; a rate at or above 100% cannot be inverted.`,
        { channelId: c.id, feeKey: key, bps: value }));
    }
    if (key.endsWith('Ratio') && typeof value === 'number' && (value < 0 || value > 1)) {
      issues.push(issue('invalid-channel-rate', 'block', where,
        `"${c.label}" declares ${key} = ${value}, which is outside 0-1.`,
        { channelId: c.id, feeKey: key }));
    }
  }
  return issues;
}

/** Clamp a rate to a usable basis-point range. */
const clampBps = (n: number): Bps => Math.max(0, Math.min(BPS_ONE - 1, Math.trunc(Number.isFinite(n) ? n : 0)));

/** Clamp a physical ratio to 0..cap. */
const clampRatio = (n: number, cap = 1): Ratio => Math.max(0, Math.min(cap, Number.isFinite(n) ? n : 0));

/** Compose a fee component. */
function fee(key: string, label: string, varBps: Bps, fixedMicros: Micros, basis: string, refs: string[] = []): FeeComponent {
  return { key, label, varBps, fixedMicros, basis, assumptionRefs: refs };
}

/** Direct-to-consumer decomposition, per unit shipped. */
function decomposeDtc(e: DtcEconomics, refs: string[]): Omit<ChannelDecomposition, 'feeVarBps' | 'feeFixedMicros' | 'issues'> {
  const r = clampRatio(e.returnRateRatio, 0.95);
  const salvage = clampRatio(e.returnSalvageRatio);
  const pay = clampBps(e.paymentBps);
  const ship = e.shippingChargedToCustomerMicros;
  return {
    components: [
      fee('returns-refund', 'Refunds on returned orders', roundHalfUp(r * BPS_ONE), scaleMicros(ship, r), `${(r * 100).toFixed(1)}% of orders refunded`, refs),
      fee('payment', 'Payment processing', pay, addMicros(applyBps(ship, pay), e.paymentFixedMicros), `${pay} bps + fixed, on price and shipping collected`, refs),
      fee('outbound-shipping', 'Outbound shipping', 0, e.outboundShipMicros, 'per unit shipped', refs),
      fee('pick-pack', 'Pick and pack', 0, e.pickPackMicros, 'per unit shipped', refs),
      fee('customer-acquisition', 'Customer acquisition', 0, e.cacPerOrderMicros, 'per order', refs),
      fee('returns-handling', 'Returns handling', 0, scaleMicros(e.returnHandlingMicros, r), `${(r * 100).toFixed(1)}% of orders handled back`, refs),
    ],
    revVarBps: BPS_ONE,
    revFixedMicros: ship,
    landedFactorBps: roundHalfUp((1 - r * salvage) * BPS_ONE),
    wholesaleFactorBps: BPS_ONE,
  };
}

/** Marketplace decomposition, per unit shipped, against a dated fee card. */
function decomposeAmazon(e: AmazonEconomics, refs: string[], table: FbaFeeTable, tier: FbaSizeTier): Omit<ChannelDecomposition, 'feeVarBps' | 'feeFixedMicros' | 'issues'> {
  const r = clampRatio(e.returnRateRatio, 0.95);
  const referral = clampBps(e.referralBps);
  const oversize = isOversizeTier(tier);
  const tableRefs = [...new Set([...refs, ...table.assumptionRefs])].sort();
  return {
    components: [
      fee('returns-refund', 'Refunds on returned orders', roundHalfUp(r * BPS_ONE), 0, `${(r * 100).toFixed(1)}% of orders refunded`, refs),
      fee('referral', 'Marketplace referral fee', roundHalfUp(referral * (1 - r)), 0, `${referral} bps of net sales`, tableRefs),
      fee('fulfilment', 'Fulfilment', 0, fbaFulfilmentFee(table, tier, e.shippingWeightOz), `${tier}, ${e.shippingWeightOz} oz`, tableRefs),
      fee('storage', 'Storage', 0, fbaStorageCost(table, e.cubicFeet, e.storageMonths, oversize), `${e.storageMonths.length} month(s), peak rates where they fall`, tableRefs),
      fee('inbound', 'Inbound to the fulfilment centre', 0, e.inboundPerUnitMicros, 'per unit', refs),
      fee('returns-processing', 'Returns processing', 0, scaleMicros(e.returnProcessingMicros, r), `${(r * 100).toFixed(1)}% of orders processed back`, refs),
      fee('advertising', 'Advertising', clampBps(e.acosBps), 0, `${clampBps(e.acosBps)} bps of shelf price`, refs),
    ],
    revVarBps: BPS_ONE,
    revFixedMicros: 0,
    landedFactorBps: BPS_ONE,
    wholesaleFactorBps: BPS_ONE,
  };
}

/** Big-box decomposition. Allowances are rates on YOUR wholesale, not on shelf. */
function decomposeBigBox(e: BigBoxEconomics, refs: string[]): Omit<ChannelDecomposition, 'feeVarBps' | 'feeFixedMicros' | 'issues'> {
  const rm = clampBps(e.retailerMarginBps);
  const wholesaleFactorBps = BPS_ONE - rm;
  const onWholesale = (bps: Bps): Bps => roundHalfUp((clampBps(bps) * wholesaleFactorBps) / BPS_ONE);
  const allowance = (key: string, label: string, bps: Bps): FeeComponent =>
    fee(key, label, onWholesale(bps), 0, `${clampBps(bps)} bps of wholesale`, refs);
  return {
    components: [
      fee('retailer-margin', 'Retailer margin', rm, 0, `${rm} bps of shelf price`, refs),
      allowance('markdown-allowance', 'Markdown allowance', e.markdownAllowanceBps),
      allowance('coop-advertising', 'Co-op advertising', e.coopAdvertisingBps),
      allowance('defective-allowance', 'Defective allowance', e.defectiveAllowanceBps),
      allowance('chargebacks', 'Compliance chargebacks', e.chargebackBps),
      allowance('early-payment', 'Early payment discount', e.earlyPaymentDiscountBps),
      allowance('freight-allowance', 'Freight allowance', e.freightAllowanceBps),
      allowance('new-store-allowance', 'New store allowance', e.newStoreAllowanceBps),
    ],
    revVarBps: BPS_ONE,
    revFixedMicros: 0,
    landedFactorBps: BPS_ONE,
    wholesaleFactorBps,
  };
}

/** Two-step distribution decomposition. */
function decomposeDistributor(e: DistributorEconomics, refs: string[]): Omit<ChannelDecomposition, 'feeVarBps' | 'feeFixedMicros' | 'issues'> {
  const rm = clampBps(e.retailerMarginBps);
  const dm = clampBps(e.distributorMarginBps);
  const afterRetailer = BPS_ONE - rm;
  const wholesaleFactorBps = roundHalfUp((afterRetailer * (BPS_ONE - dm)) / BPS_ONE);
  return {
    components: [
      fee('retailer-margin', 'Retailer margin', rm, 0, `${rm} bps of shelf price`, refs),
      fee('distributor-margin', 'Distributor margin', roundHalfUp((dm * afterRetailer) / BPS_ONE), 0, `${dm} bps of the retailer's cost`, refs),
      fee('allowances', 'Programme allowances', roundHalfUp((clampBps(e.allowancesBps) * wholesaleFactorBps) / BPS_ONE), 0, `${clampBps(e.allowancesBps)} bps of wholesale`, refs),
    ],
    revVarBps: BPS_ONE,
    revFixedMicros: 0,
    landedFactorBps: BPS_ONE,
    wholesaleFactorBps,
  };
}

/**
 * @description Decompose a channel into its affine fee stack. This is the step
 *   that makes both directions of the waterfall closed-form: after it, every fee
 *   is `varBps x shelfPrice + fixed`, and nothing depends on landed cost.
 * @param c - The channel.
 * @param onDate - Modelling date, used to select a dated marketplace fee card.
 * @returns The components, the aggregate affine coefficients and any issues.
 */
export function channelFeeDecomposition(c: Channel, onDate: string): ChannelDecomposition {
  const issues = validateChannel(c);
  let partial: Omit<ChannelDecomposition, 'feeVarBps' | 'feeFixedMicros' | 'issues'>;
  if (c.economics.kind === 'dtc') {
    partial = decomposeDtc(c.economics, c.assumptionRefs);
  } else if (c.economics.kind === 'amazon') {
    const picked = fbaTableFor(c.economics.feeTableDate || onDate);
    issues.push(...picked.issues);
    partial = decomposeAmazon(c.economics, c.assumptionRefs, picked.table, classifySizeTier(c.economics.dims));
  } else if (c.economics.kind === 'big-box') {
    partial = decomposeBigBox(c.economics, c.assumptionRefs);
  } else {
    partial = decomposeDistributor(c.economics, c.assumptionRefs);
  }
  return {
    ...partial,
    feeVarBps: partial.components.reduce((a, f) => a + f.varBps, 0),
    feeFixedMicros: addMicros(...partial.components.map((f) => f.fixedMicros)),
    issues,
  };
}

/** Evaluate the fee stack at a shelf price, one rounding per component. */
function evaluateFees(d: ChannelDecomposition, shelfPrice: Micros): { steps: WaterfallStep[]; totalMicros: Micros } {
  const steps: WaterfallStep[] = d.components
    .map((f) => ({
      key: f.key,
      label: f.label,
      amountMicros: -addMicros(applyBps(shelfPrice, f.varBps), f.fixedMicros),
      ofBps: f.varBps || undefined,
      basis: f.basis,
      assumptionRefs: f.assumptionRefs,
    }))
    .filter((s) => s.amountMicros !== 0);
  return { steps, totalMicros: -addMicros(...steps.map((s) => s.amountMicros)) };
}

/**
 * @description Build the waterfall for one channel at one price and one landed
 *   cost. `from-cost` solves the shelf price that hits a target contribution;
 *   `fixed-shelf` and `fixed-wholesale` take the price as given.
 * @param input - Channel, landed unit cost, pricing mode and modelling date.
 * @returns The full waterfall including the affine coefficients the inverse needs.
 */
export function forwardWaterfall(input: {
  channel: Channel; landedUnitMicros: Micros; pricing: PriceSetting; onDate: string;
}): ChannelWaterfall {
  const d = channelFeeDecomposition(input.channel, input.onDate);
  const issues = [...d.issues];
  const solved = solvePrice(d, input.landedUnitMicros, input.pricing, input.channel);
  issues.push(...solved.issues);
  return assembleWaterfall(input.channel, d, solved.shelfPriceMicros, input.landedUnitMicros, issues);
}

/** Resolve the shelf price for a pricing mode. */
function solvePrice(
  d: ChannelDecomposition, landed: Micros, pricing: PriceSetting, c: Channel,
): { shelfPriceMicros: Micros; issues: VentureIssue[] } {
  if (pricing.kind === 'fixed-shelf') return { shelfPriceMicros: Math.max(0, pricing.shelfPriceMicros), issues: [] };
  if (pricing.kind === 'fixed-wholesale') {
    if (d.wholesaleFactorBps >= BPS_ONE) {
      return {
        shelfPriceMicros: Math.max(0, pricing.wholesaleMicros),
        issues: [issue('invalid-channel-rate', 'warn', `channel:${c.id}`,
          `"${c.label}" sells direct, so there is no wholesale price; the figure was read as the shelf price.`, { channelId: c.id })],
      };
    }
    return {
      shelfPriceMicros: roundHalfUp((pricing.wholesaleMicros * BPS_ONE) / d.wholesaleFactorBps),
      issues: [],
    };
  }
  return solveFromCost(d, landed, pricing.targetContributionBps, c);
}

/**
 * @description Solve the shelf price that hits a target contribution rate. The
 *   closed form is exact for the affine stack; the bounded local walk that follows
 *   corrects for the fact that each fee component rounds independently, so the
 *   answer is the true smallest price rather than one that is a micro short.
 * @param d - The channel decomposition.
 * @param landed - Landed unit cost.
 * @param targetBps - Target contribution as basis points of gross revenue.
 * @param c - The channel, for issue context.
 * @returns The shelf price and any issues.
 */
function solveFromCost(
  d: ChannelDecomposition, landed: Micros, targetBps: Bps, c: Channel,
): { shelfPriceMicros: Micros; issues: VentureIssue[] } {
  const denom = d.revVarBps - d.feeVarBps - clampBps(targetBps);
  if (denom <= 0) {
    return {
      shelfPriceMicros: 0,
      issues: [issue('unreachable-target-margin', 'block', `channel:${c.id}`,
        `"${c.label}" charges ${d.feeVarBps} bps of every dollar of shelf price; a ${clampBps(targetBps)} bps contribution on top leaves nothing, so no price reaches the target and raising the price does not help.`,
        { channelId: c.id, feeVarBps: d.feeVarBps, targetBps: clampBps(targetBps) })],
    };
  }
  const numerator = applyBps(landed, d.landedFactorBps) + d.feeFixedMicros - d.revFixedMicros;
  const estimate = Math.max(0, roundHalfUp((numerator * BPS_ONE) / denom));
  const meets = (s: Micros): boolean => {
    const { totalMicros } = evaluateFees(d, s);
    const gross = addMicros(applyBps(s, d.revVarBps), d.revFixedMicros);
    return subMicros(subMicros(gross, totalMicros), applyBps(landed, d.landedFactorBps)) >= applyBps(gross, clampBps(targetBps));
  };
  return { shelfPriceMicros: walkToSmallestMeeting(estimate, meets), issues: [] };
}

/**
 * @description Bounded deterministic walk to the smallest price meeting a
 *   predicate, starting from the closed-form estimate. Independent rounding of
 *   each fee component makes the predicate non-monotone at the micro scale, so a
 *   local walk is used before any bisection.
 * @param estimate - The closed-form starting point.
 * @param meets - The predicate under test.
 * @returns The smallest price at which the predicate holds.
 */
function walkToSmallestMeeting(estimate: Micros, meets: (s: Micros) => boolean): Micros {
  const LIMIT = 4096;
  if (meets(estimate)) {
    let s = estimate;
    for (let i = 0; i < LIMIT && s > 0 && meets(s - 1); i += 1) s -= 1;
    return s;
  }
  let s = estimate;
  for (let i = 0; i < LIMIT; i += 1) {
    s += 1;
    if (meets(s)) return s;
  }
  let lo = s;
  let hi = Math.max(s * 2, s + 1_000_000);
  for (let i = 0; i < 64 && !meets(hi); i += 1) hi *= 2;
  for (let i = 0; i < 64 && hi - lo > 1; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/** Assemble the presentable waterfall once the price is known. */
function assembleWaterfall(
  c: Channel, d: ChannelDecomposition, shelfPrice: Micros, landed: Micros, issues: VentureIssue[],
): ChannelWaterfall {
  const { steps: feeSteps, totalMicros } = evaluateFees(d, shelfPrice);
  const grossRevenueMicros = addMicros(applyBps(shelfPrice, d.revVarBps), d.revFixedMicros);
  const landedTerm = applyBps(landed, d.landedFactorBps);
  const contribution = subMicros(subMicros(grossRevenueMicros, totalMicros), landedTerm);
  const direct = d.wholesaleFactorBps >= BPS_ONE;
  const wholesaleMicros = direct ? null : applyBps(shelfPrice, d.wholesaleFactorBps);
  const allowanceMicros = direct ? 0 : -addMicros(...feeSteps.filter((s) => s.key !== 'retailer-margin' && s.key !== 'distributor-margin').map((s) => s.amountMicros));
  const steps: WaterfallStep[] = [
    { key: 'shelf-price', label: 'Shelf price', amountMicros: shelfPrice, basis: 'as priced', assumptionRefs: c.assumptionRefs },
    ...(d.revFixedMicros ? [{ key: 'shipping-collected', label: 'Shipping collected', amountMicros: d.revFixedMicros, basis: 'charged to the customer', assumptionRefs: c.assumptionRefs }] : []),
    ...feeSteps,
    { key: 'landed-cost', label: 'Landed cost of goods', amountMicros: -landedTerm, basis: d.landedFactorBps === BPS_ONE ? 'per unit' : `per unit, net of ${BPS_ONE - d.landedFactorBps} bps salvage on returns`, assumptionRefs: [] },
  ];
  if (contribution < 0) {
    issues.push(issue('negative-contribution', 'warn', `channel:${c.id}`,
      `"${c.label}" loses money on every unit at this price: contribution is ${contribution} micros per unit. Volume makes this worse, not better.`,
      { channelId: c.id, contributionMicros: contribution }));
  }
  return {
    channelId: c.id, kind: c.economics.kind, shelfPriceMicros: shelfPrice,
    wholesaleMicros, netWholesaleMicros: wholesaleMicros === null ? null : subMicros(wholesaleMicros, allowanceMicros),
    landedUnitMicros: landed, steps, grossRevenueMicros, totalFeeMicros: totalMicros,
    marketingMicros: -addMicros(...feeSteps.filter((s) => MARKETING_FEE_KEYS.includes(s.key)).map((s) => s.amountMicros)),
    contributionPerUnitMicros: contribution, contributionBps: bpsOf(contribution, grossRevenueMicros),
    feeVarBps: d.feeVarBps, feeFixedMicros: d.feeFixedMicros,
    revVarBps: d.revVarBps, revFixedMicros: d.revFixedMicros, landedFactorBps: d.landedFactorBps,
    issues, assumptionRefs: c.assumptionRefs,
  };
}

/**
 * @description The highest landed unit cost a channel can carry at a given shelf
 *   price and still clear a required contribution. EXACT, because no fee depends
 *   on landed cost: one forward evaluation gives the fee total, and the answer
 *   follows by algebra.
 * @param input - Channel, shelf price, required contribution rate, modelling date.
 * @returns The maximum affordable landed cost, the waterfall at that cost, and issues.
 */
export function maxAffordableLandedCost(input: {
  channel: Channel; shelfPriceMicros: Micros; requiredContributionBps: Bps; onDate: string;
}): { maxLandedUnitMicros: Micros; waterfall: ChannelWaterfall; issues: VentureIssue[] } {
  const d = channelFeeDecomposition(input.channel, input.onDate);
  const shelf = Math.max(0, input.shelfPriceMicros);
  const { totalMicros } = evaluateFees(d, shelf);
  const gross = addMicros(applyBps(shelf, d.revVarBps), d.revFixedMicros);
  const required = applyBps(gross, clampBps(input.requiredContributionBps));
  const landedTerm = subMicros(subMicros(gross, totalMicros), required);
  const issues: VentureIssue[] = [...d.issues];
  let maxLanded = d.landedFactorBps === 0 ? 0 : Math.floor((landedTerm * BPS_ONE) / d.landedFactorBps);
  if (maxLanded < 0) {
    issues.push(issue('unreachable-target-margin', 'block', `channel:${input.channel.id}`,
      `"${input.channel.label}" cannot clear a ${clampBps(input.requiredContributionBps)} bps contribution at this shelf price even with free goods; the channel's own fees already consume the price.`,
      { channelId: input.channel.id, shelfPriceMicros: shelf }));
    maxLanded = 0;
  }
  return {
    maxLandedUnitMicros: maxLanded,
    waterfall: assembleWaterfall(input.channel, d, shelf, maxLanded, [...d.issues]),
    issues,
  };
}

/**
 * @description Volume-weighted contribution per unit across a channel mix. Shares
 *   are normalised, so a mix that does not sum to 1 is a data shape, not a defect.
 * @param waterfalls - One waterfall per channel, in the same order as `channels`.
 * @param channels - The channels carrying the volume shares.
 * @returns Blended contribution per unit in micros.
 */
export function blendedContributionPerUnit(waterfalls: readonly ChannelWaterfall[], channels: readonly Channel[]): Micros {
  const weights = normalisedShares(channels);
  let total = 0;
  waterfalls.forEach((w, i) => { total += w.contributionPerUnitMicros * (weights[i] ?? 0); });
  return roundHalfUp(total);
}

/**
 * @description Normalise channel volume shares to sum to 1. An all-zero mix falls
 *   back to an even split rather than producing zero revenue silently.
 * @param channels - The channels.
 * @returns Shares in declaration order, summing to 1.
 */
export function normalisedShares(channels: readonly Channel[]): number[] {
  const raw = channels.map((c) => Math.max(0, Number.isFinite(c.volumeShareRatio) ? c.volumeShareRatio : 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum === 0) return raw.map(() => (channels.length ? 1 / channels.length : 0));
  return raw.map((r) => r / sum);
}

/**
 * @description The cash a channel actually remits per unit sold: gross revenue
 *   less the deductions the channel WITHHOLDS. Acquisition and advertising spend
 *   is excluded because you pay it separately — netting it out of the settlement
 *   is what makes accounts receivable disagree with cash.
 * @param w - A computed waterfall.
 * @returns Micros remitted per unit.
 */
export function channelCashPerUnitMicros(w: ChannelWaterfall): Micros {
  return subMicros(w.grossRevenueMicros, subMicros(w.totalFeeMicros, w.marketingMicros));
}

/**
 * @description Payment lag in days for a channel — direct channels settle inside
 *   the month, trade channels pay on their stated terms.
 * @param c - The channel.
 * @returns Days from sale to cash.
 */
export function channelPaymentNetDays(c: Channel): number {
  if (c.economics.kind === 'big-box' || c.economics.kind === 'distributor') {
    return Math.max(0, c.economics.paymentNetDays);
  }
  return c.economics.kind === 'amazon' ? 14 : 2;
}
