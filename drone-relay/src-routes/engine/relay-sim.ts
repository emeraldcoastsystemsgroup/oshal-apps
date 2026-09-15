/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The deterministic tick simulation that puts numbers on a
 *                     |                             | chain design: drones are arc lengths on the corridor with a
 *                     |                             | battery; every tick the links are judged by the transport's
 *                     |                             | modelled edge, reachability walks outward from the base, the
 *                     |                             | controller (which only sees reachable nodes and keeps a lost
 *                     |                             | one on its roster until stale) hands the connected relays
 *                     |                             | their elastic targets, retreats the tip when its policy says
 *                     |                             | so, launches spares to replace or to swap a tiring relay
 *                     |                             | before it must leave, and releases the tired one once its
 *                     |                             | swap is in place; every unreachable node applies the
 *                     |                             | on-board rule (shift one hop inward, then home). A scenario
 *                     |                             | fails drones at chosen times; the result is a timeline, the
 *                     |                             | tip's outage seconds, when the chain reconnected and when it
 *                     |                             | was restored, the worst hop margin seen, spares used, and a
 *                     |                             | verdict — the same for the same inputs, every time.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Postures and store-and-forward. A perched relay holding still
 *                     |                             | drains its battery at the spec's perched fraction and at the
 *                     |                             | full rate the moment it moves (a shift inward, an elastic
 *                     |                             | target, the flight home), so the rotation the plan states
 *                     |                             | for a perch is what the run shows. Every run now reports
 *                     |                             | the longest outage, the buffer a tip that keeps collecting
 *                     |                             | needs for it, and how long the chain's spare capacity takes
 *                     |                             | to drain it once reconnected — the store-and-forward numbers.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | GROUND NODES (B7) and the CONTROL PLANE (B8). A ground node
 *                     |                             | flies in the run as an immovable chain member with no flight
 *                     |                             | budget: it relays, it can be failed by an event, and it is
 *                     |                             | never launched, swapped, rotated or flown home — the mobile
 *                     |                             | relays close a gap AROUND it. And when the spec's control
 *                     |                             | channel reaches the tip direct, the controller stops guessing:
 *                     |                             | every live node heartbeats past the chain, so a loss is known
 *                     |                             | one heartbeat later instead of one staleness window, there are
 *                     |                             | no ghosts (a live node reports where it really is), and the
 *                     |                             | segment beyond the gap is COMMANDED to the meeting point at
 *                     |                             | cruise instead of walking in blind on its own detect timer.
 *                     |                             | A chain with no ground node and heartbeats in band runs the
 *                     |                             | same code path, and the same bytes, as before.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | TREES (B5): a plan with a tree block runs on the tree
 *                     |                             | simulation (engine/tree-sim) — the same rules on a trunk and
 *                     |                             | its branches — and its roster names one tip per branch
 *                     |                             | (tip1..tipK). The types gain what a tree run adds: every
 *                     |                             | tip's own metrics, each drone's lane and every tip's target
 *                     |                             | in a frame — absent on a chain, whose run is byte for byte
 *                     |                             | what it was.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | LATTICES (B9): a plan with a lattice block runs on the lattice
 *                     |                             | simulation (engine/lattice-sim); a frame's drones carry x and
 *                     |                             | y there, and the trace to a lattice node walks its parents.
 */

import { type ChainPlan, type ChainSpec, allowedTipS, elasticTargets, elasticTargetsAround, guardMove, hopMarginDb, spread, spreadAround } from './chain';
import { decideLocal } from './node-policy';
import { distance, pointAt } from './path';
import { SpecError, numberIn } from './spec-error';
import { simulateLattice } from './lattice-sim';
import { simulateTree } from './tree-sim';

/** @description A failure injected at a time. */
export interface ScenarioEvent {
  atS: number;
  kind: 'fail';
  drone: string;
}

/** @description What to run. */
export interface Scenario {
  durationS: number;
  dtS: number;
  sampleS: number;
  /** True: the chain starts on station; false: everything launches from the base. */
  startDeployed: boolean;
  events: ScenarioEvent[];
}

/** @description The scenario ranges the validator enforces. */
export const SCENARIO_LIMITS = { durationS: { min: 10, max: 7200, default: 600 }, dtS: { min: 0.1, max: 5, default: 0.5 }, sampleS: { min: 0.5, max: 60, default: 1 }, maxEvents: 32 } as const;

/**
 * @description Validate a scenario against the plan's roster (r1..rN, g1..gK, s1..sM, tip).
 * @param input - Candidate.
 * @param plan - The plan whose roster the events name.
 * @returns The typed scenario.
 */
export function validateScenario(input: unknown, plan: ChainPlan): Scenario {
  const m = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const L = SCENARIO_LIMITS;
  const durationS = numberIn(m.durationS, 'durationS', L.durationS.min, L.durationS.max, L.durationS.default);
  const dtS = numberIn(m.dtS, 'dtS', L.dtS.min, L.dtS.max, L.dtS.default);
  const sampleS = numberIn(m.sampleS, 'sampleS', L.sampleS.min, L.sampleS.max, L.sampleS.default);
  const startDeployed = m.startDeployed === undefined ? true : m.startDeployed === true;
  const raw = m.events === undefined ? [] : m.events;
  if (!Array.isArray(raw)) throw new SpecError('events', 'events must be a list');
  if (raw.length > L.maxEvents) throw new SpecError('events', `at most ${L.maxEvents} events`);
  const roster = new Set(rosterIds(plan));
  const events = raw.map((e, i) => {
    const ev = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    if (ev.kind !== 'fail') throw new SpecError(`events[${i}].kind`, 'only "fail" events are supported');
    const drone = String(ev.drone ?? '');
    if (!roster.has(drone)) throw new SpecError(`events[${i}].drone`, `unknown drone "${drone}" (roster: ${[...roster].join(', ')})`);
    return { atS: numberIn(ev.atS, `events[${i}].atS`, 0, durationS, 0), kind: 'fail' as const, drone };
  });
  return { durationS, dtS, sampleS, startDeployed, events: events.sort((a, b) => a.atS - b.atS) };
}

/**
 * @description The drone ids a plan carries: flying relays r1..rN, ground nodes g1..gK (placed, not flown), spares s1..sM, and the tip.
 * @param plan - The plan.
 * @returns The ids.
 */
export function rosterIds(plan: ChainPlan): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= plan.relaysNeeded; i += 1) ids.push(`r${i}`);
  for (let i = 1; i <= plan.groundNodes.length; i += 1) ids.push(`g${i}`);
  for (let i = 1; i <= Math.max(0, plan.sparesAvailable); i += 1) ids.push(`s${i}`);
  if (plan.tree) plan.tree.branches.forEach((b) => ids.push(`tip${b.index}`));
  else ids.push('tip');
  return ids;
}

/**
 * @description The order a route toward `dst` walks, innermost relay first (what routeThrough slices
 * at `dst`). A chain: every slot's relay, then the tip. A tree: the trunk's relays, then the relays
 * of the branch `dst` lies on and that branch's tip — the path through the tree to it.
 * @param plan - The plan.
 * @param dst - The destination id.
 * @returns The order.
 */
export function chainOrderTo(plan: ChainPlan, dst: string): string[] {
  if (plan.lattice) return latticeOrderTo(plan, dst);
  if (!plan.tree) return [...plan.slots.map((s) => `r${s.index}`), 'tip'];
  const trunk = plan.slots.filter((s) => !s.branch).map((s) => `r${s.index}`);
  const along = (b: number): string[] => [...plan.slots.filter((s) => s.branch === b).map((s) => `r${s.index}`), `tip${b}`];
  const branch = plan.tree.branches.find((b) => along(b.index).includes(dst));
  return branch ? [...trunk, ...along(branch.index)] : trunk;
}

/** On a lattice: the route of parents out to the destination's slot — the tip's being the slot nearest where its sweep starts. */
function latticeOrderTo(plan: ChainPlan, dst: string): string[] {
  const bySlot = new Map(plan.slots.map((s) => [s.index, s]));
  const nearest = plan.slots.reduce((best, s) => (Math.hypot(s.pt.x - plan.tip.pt.x, s.pt.y - plan.tip.pt.y) < Math.hypot(best.pt.x - plan.tip.pt.x, best.pt.y - plan.tip.pt.y) - 1e-9 ? s : best), plan.slots[0]);
  const start = dst === 'tip' ? nearest.index : Number(/^r(\d+)$/.exec(dst)?.[1] ?? 0);
  const route: string[] = [];
  for (let n = start; bySlot.has(n); n = (bySlot.get(n) as { cell?: { parent: number } }).cell?.parent ?? 0) route.unshift(`r${n}`);
  return dst === 'tip' ? [...route, 'tip'] : route;
}

/** @description A drone's flight state. */
export type DroneState = 'base' | 'active' | 'returning' | 'landed' | 'failed';

/** @description What a chain member is: a flying relay, the working tip, or a relay that never flew. */
export type DroneRole = 'relay' | 'tip' | 'ground';

/** @description One simulated drone. */
export interface SimDrone {
  id: string;
  role: DroneRole;
  state: DroneState;
  s: number;
  remainingS: number;
  reachable: boolean;
  innerLinkOk: boolean;
  innerLostForS: number;
  movedInwardM: number;
  lastKnownS: number;
  lastSeenS: number;
  swapFor: string | null;
  groundedAtS: number | null;
  /** Moved this tick (a perched relay that moves draws the full rate). */
  moving: boolean;
}

/** @description One link as sampled. */
export interface HopSample {
  from: string;
  to: string;
  distanceM: number;
  marginDb: number;
  ok: boolean;
}

/** @description One sampled instant for the surface. */
export interface Frame {
  atS: number;
  tipTargetS: number;
  /** A tree only: every tip's target, branch order (`tipTargetS` is branch 1's). */
  tipTargets?: number[];
  /** `lane` on a tree only: 0 the trunk, i branch i — `s` is measured along that lane. `x`, `y` on a lattice only, where `s` is the distance from the base. */
  drones: Array<{ id: string; role: DroneRole; state: DroneState; s: number; reachable: boolean; remainingS: number; lane?: number; x?: number; y?: number }>;
  hops: HopSample[];
}

/** @description One tip of a tree: how long it was reachable, its own outages and when it came back. */
export interface BranchMetrics {
  tip: string;
  reachableS: number;
  outageS: number;
  outages: Array<{ fromS: number; toS: number }>;
  reconnectedAtS: number[];
}

/** @description One timeline entry. */
export interface SimEvent {
  atS: number;
  kind: string;
  drone?: string;
  text: string;
}

/** @description The numbers a designer compares. */
export interface SimMetrics {
  durationS: number;
  tipReachableS: number;
  tipOutageS: number;
  outages: Array<{ fromS: number; toS: number }>;
  gapDetectedAtS: number[];
  reconnectedAtS: number[];
  restoredAtS: number[];
  minHopMarginDb: number | null;
  sparesLaunched: number;
  swaps: number;
  forcedReturns: number;
  landings: number;
  failures: number;
  /** The longest single outage, seconds. */
  longestOutageS: number;
  /** What the tip buffers through that outage at its data rate, KB. */
  tipBufferKB: number;
  /** Seconds the chain's spare capacity takes to drain that buffer once reconnected; null when there is none. */
  drainS: number | null;
  verdict: 'held' | 'restored' | 'degraded' | 'lost';
  /** A tree only: every tip's own numbers (the fields above count "the tip reachable" as every tip reachable). */
  branches?: BranchMetrics[];
}

/** @description The whole run. */
export interface SimResult {
  scenario: Scenario;
  events: SimEvent[];
  metrics: SimMetrics;
  frames: Frame[];
  final: SimDrone[];
}

interface World {
  spec: ChainSpec;
  plan: ChainPlan;
  drones: SimDrone[];
  t: number;
  events: SimEvent[];
  frames: Frame[];
  tipTargetS: number;
  lastLaunchS: number;
  outageStart: number | null;
  awaitingRestore: boolean;
  awaitingGapDetect: boolean;
  metrics: SimMetrics;
}

const LAUNCH_INTERVAL_S = 5;
const RESTORE_TOLERANCE_M = 2;

function makeDrone(id: string, role: DroneRole, state: DroneState, s: number, enduranceS: number): SimDrone {
  return { id, role, state, s, remainingS: enduranceS, reachable: state === 'active', innerLinkOk: true, innerLostForS: 0, movedInwardM: 0, lastKnownS: s, lastSeenS: 0, swapFor: null, groundedAtS: null, moving: false };
}

function initDrones(spec: ChainSpec, plan: ChainPlan, scenario: Scenario): SimDrone[] {
  const drones: SimDrone[] = [];
  plan.mobileSlots.forEach((slot, i) => drones.push(makeDrone(`r${i + 1}`, 'relay', scenario.startDeployed ? 'active' : 'base', scenario.startDeployed ? slot.s : 0, spec.enduranceS)));
  // A ground node is placed, not launched: it is on station from the first tick of every scenario and
  // its flight budget is 0 because it has none — it never returns, never swaps and never rotates.
  plan.groundNodes.forEach((s, i) => drones.push(makeDrone(`g${i + 1}`, 'ground', 'active', s, 0)));
  for (let i = 1; i <= Math.max(0, plan.sparesAvailable); i += 1) drones.push(makeDrone(`s${i}`, 'relay', 'base', 0, spec.enduranceS));
  drones.push(makeDrone('tip', 'tip', 'active', scenario.startDeployed ? plan.pathLengthM : 0, spec.enduranceS));
  return drones;
}

function log(w: World, kind: string, text: string, drone?: string): void {
  w.events.push({ atS: round1(w.t), kind, ...(drone ? { drone } : {}), text });
}

function applyEvents(w: World, scenario: Scenario, dt: number): void {
  for (const ev of scenario.events) {
    if (ev.atS > w.t - dt && ev.atS <= w.t) {
      const d = w.drones.find((x) => x.id === ev.drone);
      if (d && d.state !== 'failed') { d.state = 'failed'; d.reachable = false; w.metrics.failures += 1; w.awaitingRestore = true; log(w, 'fail', `${d.id} failed at ${Math.round(d.s)} m`, d.id); }
    }
  }
}

/** Active chain members in corridor order. */
function members(w: World): SimDrone[] {
  return w.drones.filter((d) => d.state === 'active').sort((a, b) => a.s - b.s);
}

function linkPass(w: World): HopSample[] {
  const hops: HopSample[] = [];
  let prevS = 0;
  let prevId = 'base';
  let reachable = true;
  for (const d of members(w)) {
    const dist = distance(pointAt(w.spec.path, prevS), pointAt(w.spec.path, d.s));
    const margin = hopMarginDb(w.spec, w.plan, dist);
    const ok = dist <= w.plan.hardRangeM;
    hops.push({ from: prevId, to: d.id, distanceM: round1(dist), marginDb: margin, ok });
    d.innerLinkOk = ok;
    reachable = reachable && ok;
    d.reachable = reachable;
    if (reachable) { d.lastKnownS = d.s; d.lastSeenS = w.t; if (w.metrics.minHopMarginDb === null || margin < w.metrics.minHopMarginDb) w.metrics.minHopMarginDb = margin; }
    prevS = d.s;
    prevId = d.id;
  }
  // On a control channel that reaches, every node still holding its slot is heard whatever the chain
  // is doing: it reports where it REALLY is, so the controller has no ghost to steer around, and a
  // node that stops heartbeating is a node that is gone.
  if (controlDirect(w)) for (const d of w.drones) if (d.state === 'active') { d.lastSeenS = w.t; d.lastKnownS = d.s; }
  return hops;
}

/**
 * The out-of-band control plane is actually carrying the chain when the spec asked for one AND the
 * plan says it reaches the tip direct. A channel that stops short changes nothing: those heartbeats
 * ride the chain again, which is exactly the in-band run.
 */
function controlDirect(w: World): boolean {
  return w.plan.control !== null && w.plan.control.reachesTipDirect;
}

/** How long a silent node stays on the roster: one heartbeat on a direct channel, the staleness window in band. */
function knownWindowS(w: World): number {
  return controlDirect(w) ? w.spec.heartbeatS : w.spec.staleS;
}

/** The controller's roster: reachable now, or lost less than one known-window ago (a ghost at its last position). */
function roster(w: World): SimDrone[] {
  return w.drones
    .filter((d) => d.role === 'relay' && ((d.state === 'active' && d.reachable) || (d.state !== 'base' && d.state !== 'landed' && !d.reachable && w.t - d.lastSeenS < knownWindowS(w))))
    .sort((a, b) => (a.reachable ? a.s : a.lastKnownS) - (b.reachable ? b.s : b.lastKnownS));
}

function tipReachable(w: World): boolean {
  const tip = w.drones.find((d) => d.id === 'tip') as SimDrone;
  return tip.state === 'active' && tip.reachable;
}

/** Targets for the roster; a gap's midpoint anchors the connected prefix when the tip is out of reach. */
function controllerTargets(w: World): Map<string, number> {
  const list = roster(w);
  const k = list.length;
  const targets = new Map<string, number>();
  // Only a LIVE ground node anchors the elastic rule: one that has been failed is a hole like any
  // other, and the mobile relays must be free to spread across it.
  const ground = w.drones.filter((d) => d.role === 'ground' && d.state === 'active').map((d) => d.s);
  if (tipReachable(w)) {
    // A relay counts toward the tip's reach once it is in the chain (half a hop out), not while it sits
    // on the pad; a ground node is in the chain the moment the chain reaches it.
    const inChain = list.filter((d) => d.reachable && d.s >= w.plan.hopM / 2).length + w.drones.filter((d) => d.role === 'ground' && d.state === 'active' && d.reachable).length;
    w.tipTargetS = allowedTipS(w.spec, w.plan, inChain);
    const elastic = ground.length ? elasticTargetsAround(w.tipTargetS, k, ground) : elasticTargets(w.tipTargetS, k);
    elastic.forEach((s, i) => targets.set(list[i].id, s));
    return targets;
  }
  const connected = list.filter((d) => d.reachable);
  const outermostS = connected.length ? connected[connected.length - 1].s : 0;
  const lost = members(w).filter((d) => !d.reachable).sort((a, b) => a.lastKnownS - b.lastKnownS);
  const anchor = lost.length ? (outermostS + lost[0].lastKnownS) / 2 : outermostS;
  const inward = ground.length ? spreadAround(anchor, connected.length, ground) : spread(anchor, connected.length);
  inward.forEach((s, i) => targets.set(connected[i].id, s));
  commandOuterSegment(w, targets, lost, anchor);
  return targets;
}

/**
 * The half of B8 the chain cannot do for itself: with the controller still talking to the far side,
 * the segment beyond the gap is TOLD the meeting point (the whole segment slides inward keeping its
 * spacing, the innermost landing on the anchor) instead of each node walking in blind on its own
 * detect timer at recovery speed. In band there is nobody to tell, so nothing here fires.
 */
function commandOuterSegment(w: World, targets: Map<string, number>, lost: SimDrone[], anchor: number): void {
  if (!controlDirect(w) || !lost.length) return;
  const shift = lost[0].s - anchor;
  if (shift <= 0) return;
  for (const d of lost) {
    if (d.role === 'ground') continue;
    const to = Math.max(anchor, d.s - shift);
    targets.set(d.id, to);
    if (d.role === 'tip') w.tipTargetS = to;
  }
}

function launch(w: World, spare: SimDrone, reason: string, swapFor: string | null): void {
  spare.state = 'active'; spare.s = 0; spare.remainingS = w.spec.enduranceS; spare.reachable = true; spare.swapFor = swapFor; spare.lastSeenS = w.t; spare.lastKnownS = 0;
  w.lastLaunchS = w.t;
  w.awaitingRestore = true;
  w.metrics.sparesLaunched += 1;
  log(w, 'launch', `${spare.id} launched (${reason})`, spare.id);
}

function dispatchPass(w: World, targets: Map<string, number>): void {
  const spare = w.drones.find((d) => d.state === 'base');
  const known = roster(w);
  const connected = known.filter((d) => d.reachable);
  const canLaunch = spare && w.t - w.lastLaunchS >= LAUNCH_INTERVAL_S;
  // A lost relay stays on the roster until stale, so the replacement launches only once the controller KNOWS.
  if (canLaunch && known.length < w.plan.relaysNeeded) {
    const disturbed = w.events.some((ev) => ev.kind === 'fail' || ev.kind === 'rtl' || ev.kind === 'release');
    launch(w, spare as SimDrone, disturbed ? 'replace' : 'deploy', null);
    return;
  }
  const swapping = new Set(w.drones.filter((d) => d.swapFor).map((d) => d.swapFor));
  const tiring = connected.find((d) => !swapping.has(d.id) && d.remainingS < swapLeadS(w, d));
  if (canLaunch && tiring) { launch(w, spare as SimDrone, `swap for ${tiring.id}`, tiring.id); return; }
  for (const d of w.drones) {
    if (!d.swapFor || d.state !== 'active') continue;
    const tired = w.drones.find((x) => x.id === d.swapFor);
    const target = targets.get(d.id);
    if (!tired || tired.state !== 'active') { d.swapFor = null; continue; }
    if (target !== undefined && Math.abs(d.s - target) <= 5) { tired.state = 'returning'; w.metrics.swaps += 1; w.awaitingRestore = true; log(w, 'release', `${tired.id} released home; ${d.id} holds its slot`, tired.id); d.swapFor = null; }
  }
}

/** Flight time left at which a relay's swap must launch: the flight home, the reserve, the spare's flight out, and the launch queue. */
function swapLeadS(w: World, d: SimDrone): number {
  const flight = d.s / w.spec.cruiseMps;
  return 2 * flight + w.spec.reserveS + LAUNCH_INTERVAL_S * (w.plan.relaysNeeded + 1) + w.spec.staleS;
}

function localPass(w: World, d: SimDrone, dt: number, commanded: boolean): 'moved' | 'idle' {
  d.innerLostForS = d.innerLinkOk ? 0 : d.innerLostForS + dt;
  if (d.innerLinkOk) d.movedInwardM = 0;
  // The tip's battery is the mission's, not the chain's: it is reported, never acted on here.
  const remainingS = d.role === 'tip' ? Number.POSITIVE_INFINITY : d.remainingS;
  const action = decideLocal({ innerLinkOk: d.innerLinkOk, innerLostForS: d.innerLostForS, movedInwardM: d.movedInwardM, hopM: w.plan.hopM, remainingS, returnTimeS: d.s / w.spec.cruiseMps, reserveS: w.spec.reserveS, detectS: w.spec.detectS, rtlAfterS: w.spec.rtlAfterS });
  // A commanded node keeps only the decision that is its own: the battery. It does not fly home on a
  // silent inner link and does not guess its way inward — the base is still talking to it.
  if (action.action === 'rtl' && commanded && action.reason !== 'battery') return 'idle';
  if (action.action === 'shift-in' && commanded) return 'idle';
  if (action.action === 'rtl') {
    d.state = 'returning';
    if (action.reason === 'battery') w.metrics.forcedReturns += 1;
    log(w, 'rtl', `${d.id} flying home (${action.reason})`, d.id);
    return 'moved';
  }
  if (action.action === 'shift-in') {
    const step = Math.min(w.spec.recoverMps * dt, d.s);
    d.s -= step; d.movedInwardM += step; d.moving = true;
    return 'moved';
  }
  return 'idle';
}

function motionPass(w: World, targets: Map<string, number>, dt: number): void {
  const list = members(w);
  const commanded = controlDirect(w);
  list.forEach((d, i) => {
    d.moving = false;
    if (d.role === 'ground') return;
    if (localPass(w, d, dt, commanded) === 'moved') return;
    if (!d.reachable && !commanded) return;
    const target = d.role === 'tip' ? w.tipTargetS : targets.get(d.id);
    if (target === undefined) return;
    // The guard protects links that are good NOW; a broken outer link is the outer node's problem (its own rule brings it inward).
    const innerS = i > 0 ? list[i - 1].s : 0;
    const outerS = i + 1 < list.length && list[i + 1].innerLinkOk ? list[i + 1].s : null;
    const step = Math.max(-w.spec.cruiseMps * dt, Math.min(w.spec.cruiseMps * dt, target - d.s));
    const before = d.s;
    d.s = guardMove(d.s + step, innerS, outerS, w.plan.hardRangeM);
    d.moving = Math.abs(d.s - before) > 1e-6;
  });
}

/** A perched relay holding still draws the perched fraction; anything flying draws the full rate. */
function drawFactor(w: World, d: SimDrone): number {
  return w.spec.posture === 'perch' && d.role === 'relay' && d.state === 'active' && !d.moving ? w.spec.perchDrawFraction : 1;
}

function groundPass(w: World, dt: number): void {
  for (const d of w.drones) {
    if (d.role === 'ground') continue;
    if (d.state === 'active' || d.state === 'returning') d.remainingS = Math.max(0, d.remainingS - dt * drawFactor(w, d));
    if (d.state === 'returning') {
      d.s = Math.max(0, d.s - w.spec.cruiseMps * dt);
      d.reachable = false;
      if (d.s === 0) { d.state = 'landed'; d.groundedAtS = w.t; w.metrics.landings += 1; log(w, 'landed', `${d.id} landed`, d.id); }
    } else if (d.state === 'landed' && d.role === 'relay' && d.groundedAtS !== null && w.t - d.groundedAtS >= w.spec.turnaroundS) {
      d.state = 'base'; d.remainingS = w.spec.enduranceS; d.groundedAtS = null; d.swapFor = null; d.innerLostForS = 0; d.movedInwardM = 0;
      log(w, 'ready', `${d.id} back on a fresh battery`, d.id);
    }
  }
}

function accountPass(w: World, hops: HopSample[], dt: number): void {
  const reach = tipReachable(w);
  if (reach) w.metrics.tipReachableS += dt;
  if (!reach && w.outageStart === null) { w.outageStart = w.t; w.awaitingGapDetect = true; w.awaitingRestore = true; log(w, 'tip-lost', 'the tip is out of reach'); }
  if (!reach && w.awaitingGapDetect && w.outageStart !== null && w.t - w.outageStart >= knownWindowS(w)) { w.awaitingGapDetect = false; w.metrics.gapDetectedAtS.push(round1(w.t)); log(w, 'gap-detected', 'controller: the tip is stale — chain broken'); }
  if (reach && w.outageStart !== null) {
    w.metrics.outages.push({ fromS: round1(w.outageStart), toS: round1(w.t) }); w.metrics.tipOutageS += w.t - w.outageStart; w.outageStart = null; w.awaitingGapDetect = false;
    w.metrics.reconnectedAtS.push(round1(w.t)); log(w, 'reconnected', 'the tip is reachable again');
  }
  const tip = w.drones.find((d) => d.id === 'tip') as SimDrone;
  const activeRelays = w.drones.filter((d) => d.role === 'relay' && d.state === 'active');
  const settled = activeRelays.length === w.plan.relaysNeeded && activeRelays.every((d) => d.reachable && !d.swapFor);
  const restored = reach && settled && Math.abs(tip.s - w.plan.pathLengthM) <= RESTORE_TOLERANCE_M && hops.every((h) => h.distanceM <= w.plan.hopM + 1);
  if (restored && w.awaitingRestore) { w.awaitingRestore = false; w.metrics.restoredAtS.push(round1(w.t)); log(w, 'restored', 'every hop at the design spacing and the tip back on station'); }
}

function sample(w: World, hops: HopSample[]): void {
  w.frames.push({ atS: round1(w.t), tipTargetS: round1(w.tipTargetS), drones: w.drones.map((d) => ({ id: d.id, role: d.role, state: d.state, s: round1(d.s), reachable: d.reachable, remainingS: Math.round(d.remainingS) })), hops });
}

/** What an outage costs a tip that keeps collecting: the buffer for the longest one and the time the chain's spare capacity takes to drain it. */
function storeAndForward(w: World): void {
  const longest = w.metrics.outages.reduce((m, o) => Math.max(m, o.toS - o.fromS), 0);
  const spareKbps = w.plan.endToEndKbps - w.spec.tipDataKbps;
  w.metrics.longestOutageS = round1(longest);
  w.metrics.tipBufferKB = round1((w.spec.tipDataKbps * longest) / 8);
  w.metrics.drainS = longest === 0 ? 0 : spareKbps > 0 ? round1((w.spec.tipDataKbps * longest) / spareKbps) : null;
}

function verdict(w: World): SimMetrics['verdict'] {
  if (!tipReachable(w)) return 'lost';
  if (!w.metrics.outages.length && !w.metrics.failures && !w.metrics.swaps) return 'held';
  const lastFail = Math.max(-1, ...w.events.filter((e) => e.kind === 'fail' || e.kind === 'release').map((e) => e.atS));
  const lastRestore = w.metrics.restoredAtS.length ? w.metrics.restoredAtS[w.metrics.restoredAtS.length - 1] : -1;
  return lastRestore > lastFail ? 'restored' : 'degraded';
}

/**
 * @description Run a scenario against a plan.
 * @param spec - The validated spec.
 * @param plan - Its plan (must be feasible).
 * @param scenario - The validated scenario.
 * @returns Timeline, metrics, frames and the final state.
 */
export function simulate(spec: ChainSpec, plan: ChainPlan, scenario: Scenario): SimResult {
  if (!plan.feasible) throw new SpecError('plan', `the plan is not feasible: ${plan.reasons.join('; ')}`);
  if (plan.tree && spec.branches) return simulateTree(spec, plan, scenario);
  if (plan.lattice && spec.area) return simulateLattice(spec, plan, scenario);
  const w: World = {
    spec, plan, drones: initDrones(spec, plan, scenario), t: 0, events: [], frames: [], tipTargetS: scenario.startDeployed ? plan.pathLengthM : 0, lastLaunchS: -LAUNCH_INTERVAL_S,
    outageStart: null, awaitingRestore: false, awaitingGapDetect: false,
    metrics: { durationS: scenario.durationS, tipReachableS: 0, tipOutageS: 0, outages: [], gapDetectedAtS: [], reconnectedAtS: [], restoredAtS: [], minHopMarginDb: null, sparesLaunched: 0, swaps: 0, forcedReturns: 0, landings: 0, failures: 0, longestOutageS: 0, tipBufferKB: 0, drainS: 0, verdict: 'held' },
  };
  const dt = scenario.dtS;
  let nextSample = 0;
  const steps = Math.round(scenario.durationS / dt);
  for (let step = 0; step <= steps; step += 1) {
    w.t = round3(step * dt);
    applyEvents(w, scenario, dt);
    const hops = linkPass(w);
    const targets = controllerTargets(w);
    dispatchPass(w, targets);
    motionPass(w, targets, dt);
    groundPass(w, dt);
    accountPass(w, hops, step === 0 ? 0 : dt);
    if (w.t + 1e-9 >= nextSample) { sample(w, hops); nextSample += scenario.sampleS; }
  }
  if (w.outageStart !== null) { w.metrics.outages.push({ fromS: round1(w.outageStart), toS: round1(w.t) }); w.metrics.tipOutageS += w.t - w.outageStart; }
  w.metrics.tipReachableS = round1(w.metrics.tipReachableS);
  w.metrics.tipOutageS = round1(w.metrics.tipOutageS);
  storeAndForward(w);
  w.metrics.verdict = verdict(w);
  return { scenario, events: w.events, metrics: w.metrics, frames: w.frames, final: w.drones };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
