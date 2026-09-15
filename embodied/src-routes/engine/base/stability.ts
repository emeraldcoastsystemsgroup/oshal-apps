/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the stability budget from the hardware design
 *                     |                             | (docs/architecture/embodied-mobile-manipulator-hardware.md §3):
 *                     |                             | a lumped-mass centre of mass, the caster support polygon, the
 *                     |                             | static moment capacity about each edge, the energy needed to
 *                     |                             | tip over each edge, and two checks — a horizontal wrench at a
 *                     |                             | height, and a travel speed. These numbers ARE the capability
 *                     |                             | manifest's envelope; the planner refuses what they refuse.
 */

import type { Vec3 } from '../math/vec';

/** @description Standard gravity (m/s²). */
export const G = 9.81;

/** @description One lumped mass in the base frame: x forward, y left, z up, origin at the floor centre. */
export interface MassItem {
  name: string;
  mass: number;
  com: Vec3;
}

/** @description The caster footprint. Casters sit `casterInset` inside each corner. */
export interface Footprint {
  /** Fore–aft extent (m). */
  length: number;
  /** Lateral extent (m). */
  width: number;
  casterInset: number;
}

/** @description Per-edge values, named by the edge the machine would tip over. */
export interface Edges {
  front: number;
  rear: number;
  left: number;
  right: number;
}

/** @description The complete budget for one configuration. */
export interface TipBudget {
  totalMass: number;
  com: Vec3;
  /** Half-extents of the support polygon (m). */
  supportHalfX: number;
  supportHalfY: number;
  /** Horizontal distance from the centre of mass to each tipping edge (m). */
  margin: Edges;
  /** Static moment each edge can resist before a wheel lifts (N·m). */
  momentCapacity: Edges;
  /** Kinetic energy needed to rotate the centre of mass over each edge (J). */
  energyToTip: Edges;
}

/** @description The hardware design's fixed items — everything but the arm and payload. */
export const HARDWARE_BASE_ITEMS: readonly MassItem[] = [
  { name: 'base frame, deck, skirt, casters, bumpers', mass: 14, com: [0, 0, 0.15] },
  { name: 'hub motors', mass: 7, com: [0, 0, 0.13] },
  { name: 'battery', mass: 12, com: [0, 0, 0.10] },
  { name: 'electronics', mass: 4, com: [0, 0, 0.25] },
  { name: 'column, lift, carriage', mass: 12, com: [-0.05, 0, 0.80] },
  { name: 'head', mass: 2.5, com: [-0.05, 0, 1.55] },
];

/** @description The hardware design's footprint: 0.65 × 0.55 m, casters 30 mm in from the corners. */
export const HARDWARE_FOOTPRINT: Footprint = { length: 0.65, width: 0.55, casterInset: 0.03 };

/**
 * @description Combined mass and centre of mass of a set of lumped items.
 * @param items - The items.
 * @returns Total mass and centre of mass.
 */
export function combinedCenterOfMass(items: readonly MassItem[]): { mass: number; com: Vec3 } {
  let mass = 0;
  let sx = 0; let sy = 0; let sz = 0;
  for (const it of items) {
    mass += it.mass;
    sx += it.mass * it.com[0]; sy += it.mass * it.com[1]; sz += it.mass * it.com[2];
  }
  if (mass <= 0) throw new RangeError('a mass model needs positive mass');
  return { mass, com: [sx / mass, sy / mass, sz / mass] };
}

/** @description Energy to lift the centre of mass from height h over an edge at horizontal distance d. */
const tipEnergy = (mass: number, h: number, d: number): number => (d <= 0 ? 0 : mass * G * (Math.hypot(d, h) - h));

/**
 * @description Compute the full tip budget for a set of masses on a footprint.
 * @param items - Every lumped mass, including the arm and any payload.
 * @param footprint - The caster footprint.
 * @returns The budget. A negative margin means the centre of mass is already outside the polygon.
 */
export function tipBudget(items: readonly MassItem[], footprint: Footprint): TipBudget {
  const { mass, com } = combinedCenterOfMass(items);
  const hx = footprint.length / 2 - footprint.casterInset;
  const hy = footprint.width / 2 - footprint.casterInset;
  const margin: Edges = { front: hx - com[0], rear: hx + com[0], left: hy - com[1], right: hy + com[1] };
  const weight = mass * G;
  const cap = (d: number): number => Math.max(0, d) * weight;
  const en = (d: number): number => tipEnergy(mass, com[2], d);
  return {
    totalMass: mass,
    com,
    supportHalfX: hx,
    supportHalfY: hy,
    margin,
    momentCapacity: { front: cap(margin.front), rear: cap(margin.rear), left: cap(margin.left), right: cap(margin.right) },
    energyToTip: { front: en(margin.front), rear: en(margin.rear), left: en(margin.left), right: en(margin.right) },
  };
}

/** @description The outcome of a budget check. `factor` is capacity ÷ demand (∞ when no demand). */
export interface BudgetCheck {
  ok: boolean;
  factor: number;
  edge: keyof Edges;
  demand: number;
  capacity: number;
}

/** @description Which edge a horizontal force in the base frame pushes the machine over. */
function edgeFor(fx: number, fy: number): keyof Edges {
  if (Math.abs(fx) >= Math.abs(fy)) return fx >= 0 ? 'front' : 'rear';
  return fy >= 0 ? 'left' : 'right';
}

/**
 * @description Check a horizontal force applied TO the machine (base frame) at a height against
 * the budget. The tipping moment is |F|·h about the edge the force pushes toward.
 * @param budget - The current budget.
 * @param fx - Force along +x (forward), N.
 * @param fy - Force along +y (left), N.
 * @param heightM - Height of the line of action above the floor (m).
 * @param requiredFactor - Minimum acceptable capacity ÷ demand (default 1.5).
 * @returns The check.
 */
export function wrenchCheck(budget: TipBudget, fx: number, fy: number, heightM: number, requiredFactor = 1.5): BudgetCheck {
  const edge = edgeFor(fx, fy);
  const demand = Math.hypot(fx, fy) * Math.max(0, heightM);
  const capacity = budget.momentCapacity[edge];
  const factor = demand <= 1e-9 ? Number.POSITIVE_INFINITY : capacity / demand;
  return { ok: factor >= requiredFactor, factor, edge, demand, capacity };
}

/**
 * @description Check a travel speed against the dead-stop energy rule: ½mv² must stay below the
 * energy to tip over the edge in the direction of travel by the required factor.
 * @param budget - The current budget.
 * @param speedMps - Travel speed (m/s), positive forward.
 * @param requiredFactor - Minimum acceptable energy ratio (default 2).
 * @returns The check.
 */
export function speedCheck(budget: TipBudget, speedMps: number, requiredFactor = 2): BudgetCheck {
  const edge: keyof Edges = speedMps >= 0 ? 'front' : 'rear';
  const demand = 0.5 * budget.totalMass * speedMps * speedMps;
  const capacity = budget.energyToTip[edge];
  const factor = demand <= 1e-9 ? Number.POSITIVE_INFINITY : capacity / demand;
  return { ok: factor >= requiredFactor, factor, edge, demand, capacity };
}
