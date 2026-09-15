/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The tick simulation on a LATTICE (backlog B9): relays hold
 *                     |                             | grid slots over an area while the tip flies its survey sweep
 *                     |                             | round and round. Positions are points, not arc lengths, and
 *                     |                             | reachability is a graph: a relay is reachable when a chain of
 *                     |                             | links inside the modelled edge joins it to the base, and the
 *                     |                             | tip when any reachable relay (or the base) is in its reach —
 *                     |                             | so a lost relay is routed around wherever a neighbour still
 *                     |                             | reaches. The controller (roster until stale, as on a chain)
 *                     |                             | applies the lattice assignment rule: the route from the base
 *                     |                             | to the slot nearest the tip first, then every other slot inner
 *                     |                             | first; a relay keeps a slot it holds, a slot left open takes
 *                     |                             | the nearest free relay, a swap takes the tired relay's slot.
 *                     |                             | No commanded move may cut off a node that is reachable now
 *                     |                             | (checked on the graph). Every relay runs the on-board rule
 *                     |                             | with its inner link = any link to the base or to a relay on a
 *                     |                             | slot nearer the base; shifting in means toward its slot's
 *                     |                             | parent. Returning drones fly straight home. The run reports
 *                     |                             | the chain's metrics. Deterministic: same inputs, same bytes.
 */

import { type ChainPlan, type ChainSpec, hopMarginDb } from './chain';
import { type LatticeGeometry, latticeAssign, latticeGeometry, nearestNode } from './lattice';
import { decideLocal } from './node-policy';
import { type Pt, distance, pointAt } from './path';
import { rangeAtMarginM, type Transport } from './transports';
import type { DroneRole, DroneState, Frame, HopSample, Scenario, SimDrone, SimEvent, SimMetrics, SimResult } from './relay-sim';

/** @description A drone over an area: where it is, where the controller last heard it, and the slot it holds. */
export interface LatticeDrone extends SimDrone {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  slot: number | null;
}

interface LatticeWorld {
  spec: ChainSpec;
  plan: ChainPlan;
  geo: LatticeGeometry;
  drones: LatticeDrone[];
  t: number;
  events: SimEvent[];
  frames: Frame[];
  /** The tip's way: out from the base to the sweep (not on station at t = 0), then the sweep as a loop. */
  approach: Pt[];
  loop: Pt[];
  tipFlownM: number;
  lastLaunchS: number;
  outageStart: number | null;
  awaitingRestore: boolean;
  awaitingGapDetect: boolean;
  metrics: SimMetrics;
}

/** The chain's own constants: one launch per interval, restored within two metres. */
const LAUNCH_INTERVAL_S = 5;
const RESTORE_TOLERANCE_M = 2;
const BASE = { x: 0, y: 0 };

const at = (d: { x: number; y: number }, e: { x: number; y: number }): number => Math.hypot(d.x - e.x, d.y - e.y);
const nodeOf = (w: LatticeWorld, index: number): { x: number; y: number } => w.geo.nodes[index - 1];

function makeDrone(id: string, role: DroneRole, state: DroneState, p: { x: number; y: number }, slot: number | null, enduranceS: number): LatticeDrone {
  const s = at(p, BASE);
  return { id, role, state, s, x: p.x, y: p.y, lastX: p.x, lastY: p.y, slot, remainingS: enduranceS, reachable: state === 'active', innerLinkOk: true, innerLostForS: 0, movedInwardM: 0, lastKnownS: s, lastSeenS: 0, swapFor: null, groundedAtS: null, moving: false };
}

function initDrones(w: LatticeWorld, scenario: Scenario): LatticeDrone[] {
  const on = scenario.startDeployed;
  const drones = w.geo.nodes.map((n, i) => makeDrone(`r${i + 1}`, 'relay', on ? 'active' : 'base', on ? n : BASE, on ? n.index : null, w.spec.enduranceS));
  for (let i = 1; i <= Math.max(0, w.plan.sparesAvailable); i += 1) drones.push(makeDrone(`s${i}`, 'relay', 'base', BASE, null, w.spec.enduranceS));
  drones.push(makeDrone('tip', 'tip', 'active', on ? w.geo.survey[0] : BASE, null, w.spec.enduranceS));
  return drones;
}

function log(w: LatticeWorld, kind: string, text: string, drone?: string): void {
  w.events.push({ atS: round1(w.t), kind, ...(drone ? { drone } : {}), text });
}

function applyEvents(w: LatticeWorld, scenario: Scenario, dt: number): void {
  for (const ev of scenario.events) {
    if (ev.atS > w.t - dt && ev.atS <= w.t) {
      const d = w.drones.find((x) => x.id === ev.drone);
      if (d && d.state !== 'failed') { d.state = 'failed'; d.reachable = false; w.metrics.failures += 1; w.awaitingRestore = true; log(w, 'fail', `${d.id} failed ${Math.round(d.s)} m from the base`, d.id); }
    }
  }
}

function tip(w: LatticeWorld): LatticeDrone {
  return w.drones.find((d) => d.role === 'tip') as LatticeDrone;
}

function activeRelays(w: LatticeWorld): LatticeDrone[] {
  return w.drones.filter((d) => d.role === 'relay' && d.state === 'active');
}

/** Breadth-first from the base over active relays (drone order); `moved` tries one relay at another point. */
function reachFrom(w: LatticeWorld, moved?: { d: LatticeDrone; x: number; y: number }): Map<string, string> {
  const edge = w.plan.hardRangeM;
  const pos = (d: LatticeDrone): { x: number; y: number } => (moved && moved.d === d ? moved : d);
  const relays = activeRelays(w);
  const parent = new Map<string, string>();
  const queue: Array<{ id: string; p: { x: number; y: number } }> = [{ id: 'base', p: BASE }];
  for (let q = 0; q < queue.length; q += 1) {
    for (const d of relays) {
      if (parent.has(d.id) || at(pos(d), queue[q].p) > edge) continue;
      parent.set(d.id, queue[q].id);
      queue.push({ id: d.id, p: pos(d) });
    }
  }
  return parent;
}

/** The tip's link: the nearest reachable relay (or the base) inside the edge, or null. */
function tipLink(w: LatticeWorld, parent: Map<string, string>, moved?: { d: LatticeDrone; x: number; y: number }): { id: string; m: number } | null {
  const t = tip(w);
  let best: { id: string; m: number } | null = at(t, BASE) <= w.plan.hardRangeM ? { id: 'base', m: at(t, BASE) } : null;
  for (const d of activeRelays(w)) {
    if (!parent.has(d.id)) continue;
    const m = at(moved && moved.d === d ? moved : d, t);
    if (m <= w.plan.hardRangeM && (!best || m < best.m)) best = { id: d.id, m };
  }
  return best;
}

/**
 * Where a relay stands on the lattice for its own inner link: the depth of the slot nearest where it
 * is now (0 within half a hop of the base) — a relay in transit judges by where it is, not where it
 * is going.
 */
function rank(w: LatticeWorld, d: LatticeDrone): number {
  return at(d, BASE) <= w.geo.spacingM / 2 ? 0 : w.geo.nodes[nearestNode(w.geo, d) - 1].depth;
}

/**
 * The links the controller routes over: from the base, always the shortest link that joins one more
 * relay (a minimum spanning tree inside the edge — every node's route has the shortest longest link
 * there is, which is the route a controller choosing by margin takes). Its nodes are the reachable ones.
 */
function routeTree(w: LatticeWorld): Map<string, { from: string; m: number }> {
  const edge = w.plan.hardRangeM;
  const relays = activeRelays(w);
  const tree = new Map<string, { from: string; m: number }>();
  const best = new Map(relays.map((d) => [d.id, { from: 'base', m: at(d, BASE) }]));
  for (;;) {
    let pick: LatticeDrone | null = null;
    for (const d of relays) {
      const b = best.get(d.id) as { m: number };
      if (!tree.has(d.id) && b.m <= edge && (!pick || b.m < (best.get(pick.id) as { m: number }).m - 1e-9)) pick = d;
    }
    if (!pick) return tree;
    tree.set(pick.id, best.get(pick.id) as { from: string; m: number });
    for (const d of relays) { const m = at(d, pick); if (!tree.has(d.id) && m < (best.get(d.id) as { m: number }).m - 1e-9) best.set(d.id, { from: pick.id, m }); }
  }
}

/** Reachability on the graph, the links the controller routes over, and every relay's own view of its inner link. */
function linkPass(w: LatticeWorld): HopSample[] {
  const tree = routeTree(w);
  const hops: HopSample[] = [];
  const note = (from: string, to: LatticeDrone, m: number): void => {
    const margin = hopMarginDb(w.spec, w.plan, m);
    hops.push({ from, to: to.id, distanceM: round1(m), marginDb: margin, ok: true });
    if (w.metrics.minHopMarginDb === null || margin < w.metrics.minHopMarginDb) w.metrics.minHopMarginDb = margin;
  };
  const relays = activeRelays(w);
  for (const d of relays) { const link = tree.get(d.id); if (link) note(link.from, d, link.m); }
  const link = tipLink(w, new Map([...tree].map(([id, l]) => [id, l.from])));
  const t = tip(w);
  t.reachable = t.state === 'active' && link !== null;
  t.innerLinkOk = t.reachable;
  if (link && t.state === 'active') note(link.id, t, link.m);
  for (const d of relays) {
    d.reachable = tree.has(d.id);
    // A relay that hears the base's traffic knows its way in works; otherwise it judges by its neighbours.
    d.innerLinkOk = d.reachable || at(d, BASE) <= w.plan.hardRangeM || relays.some((e) => e !== d && rank(w, e) < rank(w, d) && at(e, d) <= w.plan.hardRangeM);
  }
  for (const d of w.drones) if (d.state === 'active' && d.reachable) { d.lastSeenS = w.t; d.lastX = d.x; d.lastY = d.y; d.lastKnownS = d.s; }
  return hops;
}

function roster(w: LatticeWorld): LatticeDrone[] {
  return w.drones.filter((d) => d.role === 'relay' && ((d.state === 'active' && d.reachable) || (d.state !== 'base' && d.state !== 'landed' && !d.reachable && w.t - d.lastSeenS < w.spec.staleS)));
}

/**
 * The lattice assignment rule, handed out: a swap takes its tired relay's slot; a relay keeps a slot
 * it holds while that slot is wanted; every wanted slot still open, in priority order, takes the
 * nearest relay left (by where the controller last heard it).
 */
function controllerTargets(w: LatticeWorld): Map<string, number> {
  const list = roster(w);
  const t = tip(w);
  const wanted = latticeAssign(w.geo, list.length, t.reachable ? t : { x: t.lastX, y: t.lastY });
  const wantedSet = new Set(wanted);
  const out = new Map<string, number>();
  const taken = new Set<number>();
  const tired = new Set<string>();
  for (const d of list) {
    const old = d.swapFor ? w.drones.find((x) => x.id === d.swapFor) : undefined;
    if (old && old.slot) { out.set(d.id, old.slot); taken.add(old.slot); tired.add(old.id); }
  }
  for (const d of list) if (!out.has(d.id) && !tired.has(d.id) && d.slot && wantedSet.has(d.slot) && !taken.has(d.slot)) { out.set(d.id, d.slot); taken.add(d.slot); }
  const free = list.filter((d) => !out.has(d.id) && !tired.has(d.id));
  for (const slot of wanted) {
    if (taken.has(slot) || !free.length) continue;
    const n = nodeOf(w, slot);
    let best = 0;
    free.forEach((d, i) => { if (at({ x: d.lastX, y: d.lastY }, n) < at({ x: free[best].lastX, y: free[best].lastY }, n) - 1e-9) best = i; });
    out.set(free[best].id, slot);
    taken.add(slot);
    free.splice(best, 1);
  }
  for (const d of list) if (!tired.has(d.id)) d.slot = out.get(d.id) ?? null;
  return out;
}

function launch(w: LatticeWorld, spare: LatticeDrone, reason: string, swapFor: string | null): void {
  spare.state = 'active'; spare.x = 0; spare.y = 0; spare.s = 0; spare.slot = null; spare.remainingS = w.spec.enduranceS; spare.reachable = true; spare.swapFor = swapFor;
  spare.lastSeenS = w.t; spare.lastX = 0; spare.lastY = 0; spare.lastKnownS = 0;
  w.lastLaunchS = w.t;
  w.awaitingRestore = true;
  w.metrics.sparesLaunched += 1;
  log(w, 'launch', `${spare.id} launched (${reason})`, spare.id);
}

function swapLeadS(w: LatticeWorld, d: LatticeDrone): number {
  return (2 * at(d, BASE)) / w.spec.cruiseMps + w.spec.reserveS + LAUNCH_INTERVAL_S * (w.plan.relaysNeeded + 1) + w.spec.staleS;
}

function dispatchPass(w: LatticeWorld, targets: Map<string, number>): void {
  const spare = w.drones.find((d) => d.state === 'base');
  const known = roster(w);
  const canLaunch = spare && w.t - w.lastLaunchS >= LAUNCH_INTERVAL_S;
  if (canLaunch && known.length < w.plan.relaysNeeded) {
    const disturbed = w.events.some((ev) => ev.kind === 'fail' || ev.kind === 'rtl' || ev.kind === 'release');
    launch(w, spare as LatticeDrone, disturbed ? 'replace' : 'deploy', null);
    return;
  }
  const swapping = new Set(w.drones.filter((d) => d.swapFor).map((d) => d.swapFor));
  const tiring = known.find((d) => d.reachable && d.slot && !swapping.has(d.id) && d.remainingS < swapLeadS(w, d));
  if (canLaunch && tiring) { launch(w, spare as LatticeDrone, `swap for ${tiring.id}`, tiring.id); return; }
  for (const d of w.drones) {
    if (!d.swapFor || d.state !== 'active') continue;
    const old = w.drones.find((x) => x.id === d.swapFor);
    const slot = targets.get(d.id);
    if (!old || old.state !== 'active') { d.swapFor = null; continue; }
    if (slot !== undefined && at(d, nodeOf(w, slot)) <= 5) { old.state = 'returning'; old.slot = null; w.metrics.swaps += 1; w.awaitingRestore = true; log(w, 'release', `${old.id} released home; ${d.id} holds its slot`, old.id); d.swapFor = null; }
  }
}

/** Step `d` toward a point by at most `stepM`; returns the metres moved. */
function stepToward(d: LatticeDrone, goal: { x: number; y: number }, stepM: number): number {
  const m = at(d, goal);
  const f = m <= stepM || m === 0 ? 1 : stepM / m;
  d.x += (goal.x - d.x) * f; d.y += (goal.y - d.y) * f; d.s = at(d, BASE);
  return m * f;
}

/** The on-board rule, as on a chain: battery, then the inner link; shifting in is toward the slot's parent. */
function localPass(w: LatticeWorld, d: LatticeDrone, dt: number): 'moved' | 'idle' {
  d.innerLostForS = d.innerLinkOk ? 0 : d.innerLostForS + dt;
  if (d.innerLinkOk) d.movedInwardM = 0;
  const action = decideLocal({ innerLinkOk: d.innerLinkOk, innerLostForS: d.innerLostForS, movedInwardM: d.movedInwardM, hopM: w.geo.spacingM, remainingS: d.remainingS, returnTimeS: at(d, BASE) / w.spec.cruiseMps, reserveS: w.spec.reserveS, detectS: w.spec.detectS, rtlAfterS: w.spec.rtlAfterS });
  if (action.action === 'rtl') {
    d.state = 'returning'; d.slot = null;
    if (action.reason === 'battery') w.metrics.forcedReturns += 1;
    log(w, 'rtl', `${d.id} flying home (${action.reason})`, d.id);
    return 'moved';
  }
  if (action.action === 'shift-in') {
    const parent = d.slot ? w.geo.nodes[d.slot - 1].parent : 0;
    d.movedInwardM += stepToward(d, parent ? nodeOf(w, parent) : BASE, w.spec.recoverMps * dt);
    d.moving = true;
    return 'moved';
  }
  return 'idle';
}

/** No commanded move may cut off a node that is reachable now: the farthest safe point toward the goal, by bisection. */
function guardedMove(w: LatticeWorld, d: LatticeDrone, goal: { x: number; y: number }, dt: number): void {
  const now = reachFrom(w);
  const reachable = new Set(now.keys());
  const tipIn = tipLink(w, now) !== null;
  const from = { x: d.x, y: d.y };
  const m = at(from, goal);
  const f = m <= w.spec.cruiseMps * dt || m === 0 ? 1 : (w.spec.cruiseMps * dt) / m;
  const pointAtF = (k: number): { d: LatticeDrone; x: number; y: number } => ({ d, x: from.x + (goal.x - from.x) * k, y: from.y + (goal.y - from.y) * k });
  const keeps = (k: number): boolean => {
    const trial = pointAtF(k);
    const after = reachFrom(w, trial);
    return [...reachable].every((id) => after.has(id)) && (!tipIn || tipLink(w, after, trial) !== null);
  };
  let safe = 0;
  if (keeps(f)) safe = f;
  else { let unsafe = f; for (let i = 0; i < 20; i += 1) { const mid = (safe + unsafe) / 2; if (keeps(mid)) safe = mid; else unsafe = mid; } }
  const p = pointAtF(safe);
  d.moving = at(p, from) > 1e-6;
  d.x = p.x; d.y = p.y; d.s = at(d, BASE);
}

function tipPosition(w: LatticeWorld, flownM: number): Pt {
  const approachM = w.approach.length > 1 ? distance(w.approach[0], w.approach[1]) : 0;
  if (flownM < approachM) return pointAt(w.approach, flownM);
  const loopM = w.geo.surveyM;
  return pointAt(w.loop, loopM > 0 ? (flownM - approachM) % loopM : 0);
}

function motionPass(w: LatticeWorld, targets: Map<string, number>, dt: number): void {
  for (const d of activeRelays(w)) {
    d.moving = false;
    if (localPass(w, d, dt) === 'moved' || !d.reachable) continue;
    const slot = targets.get(d.id);
    if (slot !== undefined) guardedMove(w, d, nodeOf(w, slot), dt);
  }
  const t = tip(w);
  if (t.state !== 'active') return;
  w.tipFlownM += w.spec.cruiseMps * dt;
  const p = tipPosition(w, w.tipFlownM);
  t.x = p.x; t.y = p.y; t.s = at(t, BASE);
}

function groundPass(w: LatticeWorld, dt: number): void {
  for (const d of w.drones) {
    if (d.state === 'active' || d.state === 'returning') d.remainingS = Math.max(0, d.remainingS - dt * (w.spec.posture === 'perch' && d.role === 'relay' && d.state === 'active' && !d.moving ? w.spec.perchDrawFraction : 1));
    if (d.state === 'returning') {
      stepToward(d, BASE, w.spec.cruiseMps * dt);
      d.reachable = false;
      if (d.s === 0) { d.state = 'landed'; d.groundedAtS = w.t; w.metrics.landings += 1; log(w, 'landed', `${d.id} landed`, d.id); }
    } else if (d.state === 'landed' && d.role === 'relay' && d.groundedAtS !== null && w.t - d.groundedAtS >= w.spec.turnaroundS) {
      d.state = 'base'; d.remainingS = w.spec.enduranceS; d.groundedAtS = null; d.swapFor = null; d.innerLostForS = 0; d.movedInwardM = 0;
      log(w, 'ready', `${d.id} back on a fresh battery`, d.id);
    }
  }
}

function accountPass(w: LatticeWorld, dt: number): void {
  const reach = tip(w).reachable;
  if (reach) w.metrics.tipReachableS += dt;
  if (!reach && w.outageStart === null) { w.outageStart = w.t; w.awaitingGapDetect = true; w.awaitingRestore = true; log(w, 'tip-lost', 'the tip is out of reach'); }
  if (!reach && w.awaitingGapDetect && w.outageStart !== null && w.t - w.outageStart >= w.spec.staleS) { w.awaitingGapDetect = false; w.metrics.gapDetectedAtS.push(round1(w.t)); log(w, 'gap-detected', 'controller: the tip is stale — the lattice is broken'); }
  if (reach && w.outageStart !== null) {
    w.metrics.outages.push({ fromS: round1(w.outageStart), toS: round1(w.t) }); w.metrics.tipOutageS += w.t - w.outageStart; w.outageStart = null; w.awaitingGapDetect = false;
    w.metrics.reconnectedAtS.push(round1(w.t)); log(w, 'reconnected', 'the tip is reachable again');
  }
  const relays = activeRelays(w);
  const held = new Set(relays.filter((d) => d.reachable && !d.swapFor && d.slot && at(d, nodeOf(w, d.slot)) <= RESTORE_TOLERANCE_M).map((d) => d.slot));
  const restored = reach && relays.length === w.plan.relaysNeeded && held.size === w.geo.nodes.length;
  if (restored && w.awaitingRestore) { w.awaitingRestore = false; w.metrics.restoredAtS.push(round1(w.t)); log(w, 'restored', 'every slot held and the tip in reach'); }
}

function sample(w: LatticeWorld, hops: HopSample[]): void {
  w.frames.push({ atS: round1(w.t), tipTargetS: round1(tip(w).s), drones: w.drones.map((d) => ({ id: d.id, role: d.role, state: d.state, s: round1(d.s), reachable: d.reachable, remainingS: Math.round(d.remainingS), x: round1(d.x), y: round1(d.y) })), hops });
}

function finish(w: LatticeWorld): void {
  if (w.outageStart !== null) { w.metrics.outages.push({ fromS: round1(w.outageStart), toS: round1(w.t) }); w.metrics.tipOutageS += w.t - w.outageStart; }
  w.metrics.tipReachableS = round1(w.metrics.tipReachableS);
  w.metrics.tipOutageS = round1(w.metrics.tipOutageS);
  const longest = w.metrics.outages.reduce((m, o) => Math.max(m, o.toS - o.fromS), 0);
  const spareKbps = w.plan.endToEndKbps - w.spec.tipDataKbps;
  w.metrics.longestOutageS = round1(longest);
  w.metrics.tipBufferKB = round1((w.spec.tipDataKbps * longest) / 8);
  w.metrics.drainS = longest === 0 ? 0 : spareKbps > 0 ? round1((w.spec.tipDataKbps * longest) / spareKbps) : null;
  const lastFail = Math.max(-1, ...w.events.filter((e) => e.kind === 'fail' || e.kind === 'release').map((e) => e.atS));
  const lastRestore = w.metrics.restoredAtS.length ? w.metrics.restoredAtS[w.metrics.restoredAtS.length - 1] : -1;
  w.metrics.verdict = !tip(w).reachable ? 'lost' : !w.metrics.outages.length && !w.metrics.failures && !w.metrics.swaps ? 'held' : lastRestore > lastFail ? 'restored' : 'degraded';
}

/**
 * @description The lattice's spacing from the spec — the design hop, unrounded — the same number the planner tiled with.
 * @param spec - The spec.
 * @param plan - Its plan.
 * @returns Metres.
 */
export function latticeSpacingM(spec: ChainSpec, plan: ChainPlan): number {
  return spec.spacingFactor * rangeAtMarginM(plan.transport as Transport, spec.requiredMarginDb, spec.pathLossExponent);
}

function makeWorld(spec: ChainSpec, plan: ChainPlan, scenario: Scenario): LatticeWorld {
  const geo = latticeGeometry(spec.area as Pt[], latticeSpacingM(spec, plan));
  const w: LatticeWorld = {
    spec, plan, geo, drones: [], t: 0, events: [], frames: [], approach: scenario.startDeployed ? [geo.survey[0]] : [{ x: 0, y: 0, z: 0 }, geo.survey[0]], loop: [...geo.survey, geo.survey[0]],
    tipFlownM: 0, lastLaunchS: -LAUNCH_INTERVAL_S, outageStart: null, awaitingRestore: false, awaitingGapDetect: false,
    metrics: { durationS: scenario.durationS, tipReachableS: 0, tipOutageS: 0, outages: [], gapDetectedAtS: [], reconnectedAtS: [], restoredAtS: [], minHopMarginDb: null, sparesLaunched: 0, swaps: 0, forcedReturns: 0, landings: 0, failures: 0, longestOutageS: 0, tipBufferKB: 0, drainS: 0, verdict: 'held' },
  };
  w.drones = initDrones(w, scenario);
  return w;
}

/**
 * @description Run a scenario on a lattice plan (the caller has checked it is feasible).
 * @param spec - The validated spec (with an area).
 * @param plan - Its plan (with its lattice block).
 * @param scenario - The validated scenario (r1..rN, s1..sM, tip).
 * @returns Timeline, metrics, frames (each drone's x and y) and the final state.
 */
export function simulateLattice(spec: ChainSpec, plan: ChainPlan, scenario: Scenario): SimResult {
  const w = makeWorld(spec, plan, scenario);
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
    accountPass(w, step === 0 ? 0 : dt);
    if (w.t + 1e-9 >= nextSample) { sample(w, hops); nextSample += scenario.sampleS; }
  }
  finish(w);
  return { scenario, events: w.events, metrics: w.metrics, frames: w.frames, final: w.drones };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
