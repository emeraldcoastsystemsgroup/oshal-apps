"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The tick simulation on a TREE (backlog B5): the chain's two
 *                     |                             | rules, unchanged, on a trunk and two to four branches. Every
 *                     |                             | drone is one arc length on one lane (0 the trunk, i the trunk
 *                     |                             | continued along branch i); the relays inside the fork serve
 *                     |                             | every branch, the outermost of them is the junction every
 *                     |                             | branch hangs off. Each tick: links walk out from the base up
 *                     |                             | the trunk and then out each branch; with every tip reachable
 *                     |                             | the controller lays the known relays out by the tree's
 *                     |                             | elastic rule (tree-rules) and hands each its slot — relays
 *                     |                             | already out a branch keep to it, the ones nearest the fork
 *                     |                             | fill a branch that is short, a relay changes branch only by
 *                     |                             | coming back through the fork; with a tip out of reach it
 *                     |                             | applies meet-in-the-middle where the cut is — a trunk cut
 *                     |                             | stretches the connected prefix to the midpoint while the far
 *                     |                             | side (the junction and every branch behind it) walks in on
 *                     |                             | its own rule, a branch cut does the same on that branch
 *                     |                             | while the rest of the tree holds. Spares launch, swap and
 *                     |                             | join from the base as on a chain; no commanded move breaks a
 *                     |                             | link that is good now (checked by distance, so a relay
 *                     |                             | leaving the fork cannot strand the branch it leaves). The
 *                     |                             | run reports every tip's outages and reconnections beside the
 *                     |                             | chain's metrics, where "the tip is reachable" means every
 *                     |                             | tip is. Deterministic: same inputs, same bytes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateTree = simulateTree;
const chain_1 = require("./chain");
const node_policy_1 = require("./node-policy");
const path_1 = require("./path");
const tree_rules_1 = require("./tree-rules");
/** The chain's own constants: one launch per interval, restored within two metres. */
const LAUNCH_INTERVAL_S = 5;
const RESTORE_TOLERANCE_M = 2;
const AT_FORK = 1e-6;
function makeDrone(id, role, state, s, lane, enduranceS) {
    return { id, role, state, s, lane, remainingS: enduranceS, reachable: state === 'active', innerLinkOk: true, innerLostForS: 0, movedInwardM: 0, lastKnownS: s, lastKnownLane: lane, lastSeenS: 0, swapFor: null, groundedAtS: null, moving: false };
}
function initDrones(w, scenario) {
    const { spec, plan, shape } = w;
    const on = scenario.startDeployed;
    const drones = plan.mobileSlots.map((slot, i) => makeDrone(`r${i + 1}`, 'relay', on ? 'active' : 'base', on ? slot.s : 0, on ? slot.branch ?? 0 : 0, spec.enduranceS));
    for (let i = 1; i <= Math.max(0, plan.sparesAvailable); i += 1)
        drones.push(makeDrone(`s${i}`, 'relay', 'base', 0, 0, spec.enduranceS));
    shape.branchM.forEach((B, i) => drones.push(makeDrone(`tip${i + 1}`, 'tip', 'active', on ? shape.forkS + B : 0, i + 1, spec.enduranceS)));
    return drones;
}
function posOf(w, d) {
    return (0, path_1.pointAt)(w.lanes[d.lane], d.s);
}
function tips(w) {
    return w.drones.filter((d) => d.role === 'tip');
}
function log(w, kind, text, drone) {
    w.events.push({ atS: round1(w.t), kind, ...(drone ? { drone } : {}), text });
}
function applyEvents(w, scenario, dt) {
    for (const ev of scenario.events) {
        if (ev.atS > w.t - dt && ev.atS <= w.t) {
            const d = w.drones.find((x) => x.id === ev.drone);
            if (d && d.state !== 'failed') {
                d.state = 'failed';
                d.reachable = false;
                w.metrics.failures += 1;
                w.awaitingRestore = true;
                log(w, 'fail', `${d.id} failed at ${Math.round(d.s)} m${d.lane && d.s > w.shape.forkS ? ` on branch ${d.lane}` : ''}`, d.id);
            }
        }
    }
}
/** Relays inside the fork serve every branch; a branch is its own relays beyond the fork and its tip. */
function topology(w) {
    const T = w.shape.forkS;
    const active = w.drones.filter((d) => d.state === 'active');
    const trunk = active.filter((d) => d.role === 'relay' && d.s <= T + AT_FORK).sort((a, b) => a.s - b.s);
    const branches = w.shape.branchM.map((_, i) => active.filter((d) => d.lane === i + 1 && (d.role === 'tip' || d.s > T + AT_FORK)).sort((a, b) => a.s - b.s));
    const inner = new Map();
    const outers = new Map();
    const link = (from, to) => { inner.set(to.id, from); if (from)
        outers.set(from.id, [...(outers.get(from.id) ?? []), to]); };
    trunk.forEach((d, i) => link(i ? trunk[i - 1] : null, d));
    const end = trunk.length ? trunk[trunk.length - 1] : null;
    for (const list of branches)
        list.forEach((d, i) => link(i ? list[i - 1] : end, d));
    return { trunk, branches, inner, outers };
}
/** Links out from the base: up the trunk, then out every branch from the trunk's end. */
function linkPass(w) {
    w.topo = topology(w);
    const hops = [];
    const reachOf = new Map();
    for (const d of [...w.topo.trunk, ...w.topo.branches.flat()]) {
        const prev = w.topo.inner.get(d.id) ?? null;
        const dist = (0, path_1.distance)(prev ? posOf(w, prev) : w.lanes[0][0], posOf(w, d));
        const margin = (0, chain_1.hopMarginDb)(w.spec, w.plan, dist);
        const ok = dist <= w.plan.hardRangeM;
        hops.push({ from: prev ? prev.id : 'base', to: d.id, distanceM: round1(dist), marginDb: margin, ok });
        d.innerLinkOk = ok;
        d.reachable = ok && (prev ? reachOf.get(prev.id) === true : true);
        reachOf.set(d.id, d.reachable);
        if (d.reachable) {
            d.lastKnownS = d.s;
            d.lastKnownLane = d.lane;
            d.lastSeenS = w.t;
            if (w.metrics.minHopMarginDb === null || margin < w.metrics.minHopMarginDb)
                w.metrics.minHopMarginDb = margin;
        }
    }
    return hops;
}
/** The controller's roster: reachable now, or lost less than the staleness window ago (a ghost where it was last heard). */
function roster(w) {
    return w.drones.filter((d) => d.role === 'relay' && ((d.state === 'active' && d.reachable) || (d.state !== 'base' && d.state !== 'landed' && !d.reachable && w.t - d.lastSeenS < w.spec.staleS)));
}
function allTipsReachable(w) {
    return tips(w).every((d) => d.state === 'active' && d.reachable);
}
const knownS = (d) => (d.reachable ? d.s : d.lastKnownS);
const knownLane = (d) => (d.reachable ? d.lane : d.lastKnownLane);
function controllerTargets(w) {
    const list = roster(w);
    if (!allTipsReachable(w))
        return meetTargets(w, list);
    const inTree = list.filter((d) => d.reachable && d.s >= w.plan.hopM / 2).length;
    const layout = (0, tree_rules_1.treeTargets)(w.shape, inTree, list.length, w.allowedHop);
    w.tipTargets = layout.tips;
    return assign(w, layout, list);
}
/**
 * Hand the layout's slots to the relays the controller knows. A relay out a branch keeps to that
 * branch (outermost to outermost); a branch short of relays takes the ones nearest the fork; the rest
 * fill the trunk in order — so a spare joining at the base shifts the whole tree outward one slot.
 */
function assign(w, layout, list) {
    const T = w.shape.forkS;
    const out = new Map();
    const pool = list.filter((d) => knownS(d) <= T + AT_FORK);
    const open = [];
    layout.branches.forEach((targets, b) => {
        const lane = b + 1;
        const on = list.filter((d) => knownLane(d) === lane && knownS(d) > T + AT_FORK).sort((a, c) => knownS(c) - knownS(a));
        const slots = targets.slice().sort((a, c) => c - a);
        on.forEach((d, i) => { if (i < slots.length)
            out.set(d.id, { lane, s: slots[i] });
        else
            pool.push(d); });
        for (let i = on.length; i < slots.length; i += 1)
            open.push({ lane, s: slots[i] });
    });
    const byFork = pool.slice().sort((a, c) => Math.abs(knownS(a) - T) - Math.abs(knownS(c) - T));
    const outbound = byFork.slice(0, open.length).sort((a, c) => knownS(c) - knownS(a));
    open.sort((a, c) => a.lane - c.lane || c.s - a.s);
    outbound.forEach((d, i) => out.set(d.id, open[i]));
    const rest = byFork.slice(open.length).sort((a, c) => knownS(a) - knownS(c));
    layout.trunk.forEach((s, i) => { if (rest[i])
        out.set(rest[i].id, { lane: 0, s }); });
    return out;
}
/**
 * A tip is out of reach: meet in the middle where the cut is. A TRUNK cut cuts every branch — the
 * connected relays stretch along the trunk to the midpoint between the outermost of them and the
 * innermost node lost, while the junction and every branch behind it walk in on their own rule. A
 * BRANCH cut is a chain cut on that branch: the connected tree keeps every reachable tip where it is,
 * holds a relay AT the cut branch's meeting point (the midpoint between that branch's outermost
 * connected node and its innermost lost one, never short of the fork) and spreads the rest — so a
 * spare from the base shifts the tree outward toward the gap instead of waiting on the pad.
 */
function meetTargets(w, list) {
    const connected = list.filter((d) => d.reachable).sort((a, b) => a.s - b.s);
    const lostTrunk = w.topo.trunk.filter((d) => !d.reachable);
    if (lostTrunk.length) {
        const out = new Map();
        const outermostS = connected.length ? connected[connected.length - 1].s : 0;
        const anchor = (outermostS + Math.min(...lostTrunk.map((d) => d.lastKnownS))) / 2;
        connected.forEach((d, i) => out.set(d.id, { lane: 0, s: (anchor * (i + 1)) / connected.length }));
        return out;
    }
    const T = w.shape.forkS;
    const trunkEnd = w.topo.trunk.length ? w.topo.trunk[w.topo.trunk.length - 1].s : 0;
    const ends = w.topo.branches.map((members, b) => {
        const lost = members.filter((d) => !d.reachable);
        if (!lost.length)
            return { s: w.tipTargets[b], held: false };
        const near = members.filter((d) => d.reachable && d.role === 'relay');
        const from = near.length ? near[near.length - 1].s : trunkEnd;
        return { s: Math.max(T, (from + Math.min(...lost.map((d) => d.lastKnownS))) / 2), held: true };
    });
    return assign(w, (0, tree_rules_1.treeSpreadTo)(w.shape, ends, connected.length), connected);
}
function launch(w, spare, reason, swapFor) {
    spare.state = 'active';
    spare.s = 0;
    spare.lane = 0;
    spare.remainingS = w.spec.enduranceS;
    spare.reachable = true;
    spare.swapFor = swapFor;
    spare.lastSeenS = w.t;
    spare.lastKnownS = 0;
    spare.lastKnownLane = 0;
    w.lastLaunchS = w.t;
    w.awaitingRestore = true;
    w.metrics.sparesLaunched += 1;
    log(w, 'launch', `${spare.id} launched (${reason})`, spare.id);
}
function swapLeadS(w, d) {
    return (2 * d.s) / w.spec.cruiseMps + w.spec.reserveS + LAUNCH_INTERVAL_S * (w.plan.relaysNeeded + 1) + w.spec.staleS;
}
function dispatchPass(w, targets) {
    const spare = w.drones.find((d) => d.state === 'base');
    const known = roster(w);
    const canLaunch = spare && w.t - w.lastLaunchS >= LAUNCH_INTERVAL_S;
    if (canLaunch && known.length < w.plan.relaysNeeded) {
        const disturbed = w.events.some((ev) => ev.kind === 'fail' || ev.kind === 'rtl' || ev.kind === 'release');
        launch(w, spare, disturbed ? 'replace' : 'deploy', null);
        return;
    }
    const swapping = new Set(w.drones.filter((d) => d.swapFor).map((d) => d.swapFor));
    const tiring = known.find((d) => d.reachable && !swapping.has(d.id) && d.remainingS < swapLeadS(w, d));
    if (canLaunch && tiring) {
        launch(w, spare, `swap for ${tiring.id}`, tiring.id);
        return;
    }
    for (const d of w.drones) {
        if (!d.swapFor || d.state !== 'active')
            continue;
        const tired = w.drones.find((x) => x.id === d.swapFor);
        const target = targets.get(d.id);
        if (!tired || tired.state !== 'active') {
            d.swapFor = null;
            continue;
        }
        if (target !== undefined && (0, path_1.distance)(posOf(w, d), (0, path_1.pointAt)(w.lanes[target.lane], target.s)) <= 5) {
            tired.state = 'returning';
            w.metrics.swaps += 1;
            w.awaitingRestore = true;
            log(w, 'release', `${tired.id} released home; ${d.id} holds its slot`, tired.id);
            d.swapFor = null;
        }
    }
}
/** The on-board rule, exactly as on a chain: battery, then the inner link; inward only, along the drone's own lane. */
function localPass(w, d, dt) {
    d.innerLostForS = d.innerLinkOk ? 0 : d.innerLostForS + dt;
    if (d.innerLinkOk)
        d.movedInwardM = 0;
    const remainingS = d.role === 'tip' ? Number.POSITIVE_INFINITY : d.remainingS;
    const action = (0, node_policy_1.decideLocal)({ innerLinkOk: d.innerLinkOk, innerLostForS: d.innerLostForS, movedInwardM: d.movedInwardM, hopM: w.plan.hopM, remainingS, returnTimeS: d.s / w.spec.cruiseMps, reserveS: w.spec.reserveS, detectS: w.spec.detectS, rtlAfterS: w.spec.rtlAfterS });
    if (action.action === 'rtl') {
        d.state = 'returning';
        if (action.reason === 'battery')
            w.metrics.forcedReturns += 1;
        log(w, 'rtl', `${d.id} flying home (${action.reason})`, d.id);
        return 'moved';
    }
    if (action.action === 'shift-in') {
        const step = Math.min(w.spec.recoverMps * dt, d.s);
        d.s -= step;
        d.movedInwardM += step;
        d.moving = true;
        return 'moved';
    }
    return 'idle';
}
/**
 * The farthest point toward `wanted` along the drone's lane that keeps every link good now within the
 * modelled edge — by distance, against the inner neighbour and every outer one (a junction has one
 * per branch). The current point keeps them all, so the answer exists; bisection makes it exact.
 */
function guardedS(w, d, wanted) {
    const edge = w.plan.hardRangeM;
    const here = posOf(w, d);
    const prev = w.topo.inner.get(d.id) ?? null;
    const ends = [prev ? posOf(w, prev) : w.lanes[0][0], ...(w.topo.outers.get(d.id) ?? []).filter((o) => o.state === 'active').map((o) => posOf(w, o))];
    const good = ends.filter((p) => (0, path_1.distance)(p, here) <= edge);
    const keeps = (s) => { const p = (0, path_1.pointAt)(w.lanes[d.lane], s); return good.every((q) => (0, path_1.distance)(p, q) <= edge); };
    let safe = d.s;
    if (keeps(wanted))
        safe = wanted;
    else {
        let unsafe = wanted;
        for (let i = 0; i < 30; i += 1) {
            const mid = (safe + unsafe) / 2;
            if (keeps(mid))
                safe = mid;
            else
                unsafe = mid;
        }
    }
    const T = w.shape.forkS;
    if (d.role === 'relay' && d.s <= T + AT_FORK && safe > T + AT_FORK && !leavingKeepsBranches(w, d))
        safe = Math.max(d.s, T);
    return Math.max(0, safe);
}
/**
 * A relay that leaves the trunk for a branch stops serving the others: every OTHER branch then hangs
 * off whatever relay is left outermost on the trunk. The crossing waits at the fork until each such
 * branch's first node — where that link is good now — would still be inside the edge of it.
 */
function leavingKeepsBranches(w, d) {
    const edge = w.plan.hardRangeM;
    const trunk = w.topo.trunk.filter((x) => x.state === 'active');
    const endNow = trunk.length ? posOf(w, trunk[trunk.length - 1]) : w.lanes[0][0];
    const rest = trunk.filter((x) => x !== d);
    const endAfter = rest.length ? posOf(w, rest[rest.length - 1]) : w.lanes[0][0];
    return w.topo.branches.every((list, j) => {
        const first = j + 1 === d.lane ? undefined : list.find((x) => x.state === 'active');
        if (!first)
            return true;
        const p = posOf(w, first);
        return (0, path_1.distance)(endNow, p) > edge || (0, path_1.distance)(endAfter, p) <= edge;
    });
}
/** Toward a slot: a relay on the wrong branch comes back to the fork first; inside the fork every lane is the same point. */
function moveToward(w, d, target, dt) {
    const T = w.shape.forkS;
    const crossing = d.lane !== target.lane && d.s > T + AT_FORK;
    if (d.lane !== target.lane && !crossing)
        d.lane = target.lane;
    const goal = crossing ? T : target.s;
    const step = Math.max(-w.spec.cruiseMps * dt, Math.min(w.spec.cruiseMps * dt, goal - d.s));
    const before = d.s;
    d.s = guardedS(w, d, d.s + step);
    d.moving = Math.abs(d.s - before) > 1e-6;
}
function motionPass(w, targets, dt) {
    w.topo = topology(w);
    for (const d of [...w.topo.trunk, ...w.topo.branches.flat()]) {
        d.moving = false;
        if (localPass(w, d, dt) === 'moved' || !d.reachable)
            continue;
        const target = d.role === 'tip' ? { lane: d.lane, s: w.tipTargets[d.lane - 1] } : targets.get(d.id);
        if (target !== undefined)
            moveToward(w, d, target, dt);
    }
}
function groundPass(w, dt) {
    for (const d of w.drones) {
        if (d.state === 'active' || d.state === 'returning')
            d.remainingS = Math.max(0, d.remainingS - dt * (w.spec.posture === 'perch' && d.role === 'relay' && d.state === 'active' && !d.moving ? w.spec.perchDrawFraction : 1));
        if (d.state === 'returning') {
            d.s = Math.max(0, d.s - w.spec.cruiseMps * dt);
            d.reachable = false;
            if (d.s === 0) {
                d.state = 'landed';
                d.lane = 0;
                d.groundedAtS = w.t;
                w.metrics.landings += 1;
                log(w, 'landed', `${d.id} landed`, d.id);
            }
        }
        else if (d.state === 'landed' && d.role === 'relay' && d.groundedAtS !== null && w.t - d.groundedAtS >= w.spec.turnaroundS) {
            d.state = 'base';
            d.remainingS = w.spec.enduranceS;
            d.groundedAtS = null;
            d.swapFor = null;
            d.innerLostForS = 0;
            d.movedInwardM = 0;
            log(w, 'ready', `${d.id} back on a fresh battery`, d.id);
        }
    }
}
/** Every tip's own outages and reconnections. */
function accountTips(w, dt) {
    tips(w).forEach((tip, i) => {
        const bm = w.branchMetrics[i];
        const reach = tip.state === 'active' && tip.reachable;
        const start = w.tipOutageStart[i];
        if (reach)
            bm.reachableS += dt;
        if (!reach && start === null) {
            w.tipOutageStart[i] = w.t;
            log(w, 'tip-lost', `${tip.id} is out of reach`, tip.id);
        }
        if (reach && start !== null) {
            bm.outages.push({ fromS: round1(start), toS: round1(w.t) });
            bm.outageS += w.t - start;
            bm.reconnectedAtS.push(round1(w.t));
            w.tipOutageStart[i] = null;
            log(w, 'reconnected', `${tip.id} is reachable again`, tip.id);
        }
    });
}
function accountPass(w, hops, dt) {
    accountTips(w, dt);
    const reach = allTipsReachable(w);
    if (reach)
        w.metrics.tipReachableS += dt;
    if (!reach && w.outageStart === null) {
        w.outageStart = w.t;
        w.awaitingGapDetect = true;
        w.awaitingRestore = true;
    }
    if (!reach && w.awaitingGapDetect && w.outageStart !== null && w.t - w.outageStart >= w.spec.staleS) {
        w.awaitingGapDetect = false;
        w.metrics.gapDetectedAtS.push(round1(w.t));
        log(w, 'gap-detected', 'controller: a tip is stale — the tree is broken');
    }
    if (reach && w.outageStart !== null) {
        w.metrics.outages.push({ fromS: round1(w.outageStart), toS: round1(w.t) });
        w.metrics.tipOutageS += w.t - w.outageStart;
        w.outageStart = null;
        w.awaitingGapDetect = false;
        w.metrics.reconnectedAtS.push(round1(w.t));
    }
    const active = w.drones.filter((d) => d.role === 'relay' && d.state === 'active');
    const settled = active.length === w.plan.relaysNeeded && active.every((d) => d.reachable && !d.swapFor);
    const home = tips(w).every((d, i) => Math.abs(d.s - (w.shape.forkS + w.shape.branchM[i])) <= RESTORE_TOLERANCE_M);
    const restored = reach && settled && home && hops.every((h) => h.distanceM <= w.plan.hopM + 1);
    if (restored && w.awaitingRestore) {
        w.awaitingRestore = false;
        w.metrics.restoredAtS.push(round1(w.t));
        log(w, 'restored', 'every hop at the design spacing and every tip back on station');
    }
}
function sample(w, hops) {
    w.frames.push({ atS: round1(w.t), tipTargetS: round1(w.tipTargets[0]), tipTargets: w.tipTargets.map(round1), drones: w.drones.map((d) => ({ id: d.id, role: d.role, state: d.state, s: round1(d.s), reachable: d.reachable, remainingS: Math.round(d.remainingS), lane: d.lane })), hops });
}
function finish(w) {
    if (w.outageStart !== null) {
        w.metrics.outages.push({ fromS: round1(w.outageStart), toS: round1(w.t) });
        w.metrics.tipOutageS += w.t - w.outageStart;
    }
    w.tipOutageStart.forEach((start, i) => { if (start !== null) {
        w.branchMetrics[i].outages.push({ fromS: round1(start), toS: round1(w.t) });
        w.branchMetrics[i].outageS += w.t - start;
    } });
    w.branchMetrics.forEach((bm) => { bm.reachableS = round1(bm.reachableS); bm.outageS = round1(bm.outageS); });
    w.metrics.tipReachableS = round1(w.metrics.tipReachableS);
    w.metrics.tipOutageS = round1(w.metrics.tipOutageS);
    const longest = w.metrics.outages.reduce((m, o) => Math.max(m, o.toS - o.fromS), 0);
    const spareKbps = w.plan.endToEndKbps - w.spec.tipDataKbps;
    w.metrics.longestOutageS = round1(longest);
    w.metrics.tipBufferKB = round1((w.spec.tipDataKbps * longest) / 8);
    w.metrics.drainS = longest === 0 ? 0 : spareKbps > 0 ? round1((w.spec.tipDataKbps * longest) / spareKbps) : null;
    w.metrics.branches = w.branchMetrics;
    w.metrics.verdict = verdict(w);
}
function verdict(w) {
    if (!allTipsReachable(w))
        return 'lost';
    if (!w.metrics.outages.length && !w.metrics.failures && !w.metrics.swaps)
        return 'held';
    const lastFail = Math.max(-1, ...w.events.filter((e) => e.kind === 'fail' || e.kind === 'release').map((e) => e.atS));
    const lastRestore = w.metrics.restoredAtS.length ? w.metrics.restoredAtS[w.metrics.restoredAtS.length - 1] : -1;
    return lastRestore > lastFail ? 'restored' : 'degraded';
}
function makeWorld(spec, plan, scenario) {
    const lanes = (0, path_1.lanePaths)(spec.path, spec.branches);
    const forkS = (0, path_1.pathLength)(spec.path);
    const shape = { forkS, branchM: lanes.slice(1).map((lane) => (0, path_1.pathLength)(lane) - forkS) };
    const tree = plan.tree;
    const ruleHop = Math.max(forkS / tree.trunkHops, ...shape.branchM.map((B, i) => B / tree.branches[i].hops));
    const w = {
        spec, plan, lanes, shape, ruleHop, allowedHop: spec.gapPolicy === 'hold-degraded' ? Math.max(ruleHop, plan.degradedRangeM) : ruleHop, drones: [], t: 0, events: [], frames: [],
        tipTargets: shape.branchM.map((B) => (scenario.startDeployed ? forkS + B : 0)), lastLaunchS: -LAUNCH_INTERVAL_S, outageStart: null, tipOutageStart: shape.branchM.map(() => null),
        awaitingRestore: false, awaitingGapDetect: false, branchMetrics: shape.branchM.map((_, i) => ({ tip: `tip${i + 1}`, reachableS: 0, outageS: 0, outages: [], reconnectedAtS: [] })),
        metrics: { durationS: scenario.durationS, tipReachableS: 0, tipOutageS: 0, outages: [], gapDetectedAtS: [], reconnectedAtS: [], restoredAtS: [], minHopMarginDb: null, sparesLaunched: 0, swaps: 0, forcedReturns: 0, landings: 0, failures: 0, longestOutageS: 0, tipBufferKB: 0, drainS: 0, verdict: 'held' },
        topo: { trunk: [], branches: [], inner: new Map(), outers: new Map() },
    };
    w.drones = initDrones(w, scenario);
    return w;
}
/**
 * @description Run a scenario against a tree plan (the caller has checked it is feasible).
 * @param spec - The validated spec (with branches).
 * @param plan - Its plan (with its tree block).
 * @param scenario - The validated scenario (drones r1..rN, s1..sM, tip1..tipK).
 * @returns Timeline, metrics (every tip's under `branches`), frames (each drone's lane) and the final state.
 */
function simulateTree(spec, plan, scenario) {
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
        accountPass(w, hops, step === 0 ? 0 : dt);
        if (w.t + 1e-9 >= nextSample) {
            sample(w, hops);
            nextSample += scenario.sampleS;
        }
    }
    finish(w);
    return { scenario, events: w.events, metrics: w.metrics, frames: w.frames, final: w.drones };
}
function round1(v) {
    return Math.round(v * 10) / 10;
}
function round3(v) {
    return Math.round(v * 1000) / 1000;
}
//# sourceMappingURL=tree-sim.js.map