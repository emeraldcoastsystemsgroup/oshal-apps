"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The design write-up, generated from the plan and the last run
 *                     |                             | so the document and the numbers cannot disagree: the link
 *                     |                             | budget, the chain table, the on-board and controller
 *                     |                             | policies as they are implemented, the scenario's timeline
 *                     |                             | and verdict, the module the transport implies, and the
 *                     |                             | honesty notes (what is modelled, what must be measured).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The chain section states the endurance line: the farthest
 *                     |                             | relay's time on station and the relays needed in rotation.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The posture (and the antenna height a perch needs), the
 *                     |                             | control plane (in band, or a second radio with its reach and
 *                     |                             | the air its heartbeats cost), the courier, and each run's
 *                     |                             | store-and-forward numbers — all from the plan and the run.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Trees (B5): the trunk, the fork and every branch with its
 *                     |                             | hops and tip; slot rows name their branch; the tree's own
 *                     |                             | controller rule; and every tip's outage in the last run. A
 *                     |                             | chain's write-up is unchanged.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Lattices (B9): the grid over the area, its cover, depth,
 *                     |                             | feeders and the tip's sweep; slot rows name their cell; the
 *                     |                             | lattice's own controller rule.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.designMarkdown = designMarkdown;
const n0 = (v) => String(Math.round(v));
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
function budgetSection(spec, plan) {
    const t = plan.transport;
    return [
        '## 1. Transport and link budget',
        '',
        `**${t.name}** — ${t.band}, ${t.txPowerDbm} dBm, ${t.antennaGainDbi} dBi per side, sensitivity ${t.sensitivityDbm} dBm, fade allowance ${t.fadeMarginDb} dB, environment exponent ${spec.pathLossExponent}.`,
        '',
        '| Range | Metres | Meaning |',
        '|---|---|---|',
        `| Design (margin ${spec.requiredMarginDb} dB) | ${n0(plan.designRangeM)} | a hop at this length keeps the design margin |`,
        `| Degraded (margin ${spec.degradedMarginDb} dB) | ${n0(plan.degradedRangeM)} | the most a hop may stretch under \`hold-degraded\` |`,
        `| Modelled edge (margin 0 dB) | ${n0(plan.hardRangeM)} | the model's cut-off; the range test replaces it |`,
        '',
        `Hop = ${spec.spacingFactor} × design range = **${n1(plan.hopM)} m** on this corridor (${n0(plan.pathLengthM)} m, ${plan.hops} hops). Margin at the hop: **${n1(plan.perHopMarginDb)} dB**. One lost relay opens a ${n0(2 * plan.hopM)} m hop (${2 * plan.hopM > plan.hardRangeM ? 'beyond the modelled edge — the outer segment disconnects' : 'inside the modelled edge — the chain stays connected at a lower margin'}).`,
        '',
        `Throughput: ${t.throughputKbps} kbps per hop on one shared channel, ${plan.hops} hops → **${n1(plan.endToEndKbps)} kbps** end to end for a tip that needs ${spec.tipDataKbps} kbps (${plan.throughputOk ? 'fits' : 'DOES NOT FIT'}); latency ≈ ${plan.endToEndLatencyMs} ms.`,
        '',
        controlLine(spec, plan),
        '',
        `Module: ${t.module}. Multi-hop: ${t.multiHop}. ${t.notes.map((s) => `${s}`).join(' ')}`,
        '',
        `Source: ${t.source}.`,
    ].join('\n');
}
function controlLine(spec, plan) {
    const c = plan.control;
    if (!c)
        return 'Control plane: in band — heartbeats and commands ride the chain, so a broken chain is also a silent tip until it closes.';
    const reach = c.reachesTipDirect ? `${n0(c.directRangeM)} m of reach at the design margin covers the ${n0(plan.pathLengthM)} m corridor` : `only ${n0(c.directRangeM)} m of reach at the design margin on a ${n0(plan.pathLengthM)} m corridor — beyond it they ride the chain`;
    return `Control plane: heartbeats and the RTL word ride **${c.transport}** direct from the base — ${reach}; ${c.nodesOnAir} nodes every ${spec.heartbeatS} s occupy ${n1(c.dutyPct)} % of that channel (${n1(c.alohaDeliveryPct)} % first-try delivery if nobody schedules them).`;
}
function postureLine(spec, plan) {
    if (spec.posture !== 'perch')
        return 'relays hover at their slots.';
    return `relays perch at their slots (motors off, ${n1(spec.perchDrawFraction * 100)} % of hover draw); every perch lifts the antenna at least ${n1(plan.perchAntennaHeightM)} m (60 % of the first Fresnel zone at the hop) or the plan's exponent is optimistic.`;
}
function courierLine(spec, plan, c) {
    return `${n0(c.payloadMB)} MB per trip over ${c.transport}: ${n0(c.loadS)} s to load landed beside the tip, ${n0(c.tripS)} s a trip, ${n1(c.mbPerHour)} MB/h ≈ ${n1(c.equivalentKbps)} kbps against the chain's ${n1(plan.endToEndKbps)} kbps${c.feasible ? '' : ` — NOT feasible on a ${n0(spec.enduranceS)} s battery`}.`;
}
function treeLine(plan) {
    const t = plan.tree;
    if (!t)
        return '';
    const branches = t.branches.map((b) => `branch ${b.index} runs ${n0(b.lengthM)} m in ${b.hops} hop${b.hops === 1 ? '' : 's'} (${b.relays} relay${b.relays === 1 ? '' : 's'}) to tip${b.index} at ${n0(b.tipS)} m`).join('; ');
    return `\nTree: the trunk runs ${n0(t.forkS)} m to the fork in ${t.trunkHops} hop${t.trunkHops === 1 ? '' : 's'}, its last relay AT the fork — every branch hangs off it; ${branches}. Every tip's frames cross the trunk, so the shared channel is divided by the sum of every tip's hops.\n`;
}
function latticeLine(plan) {
    const l = plan.lattice;
    if (!l)
        return '';
    return `\nLattice: the ${n0(l.areaM2)} m² area is tiled on a ${n1(l.spacingM)} m grid anchored at the base — ${l.slots} slots${l.feederSlots ? `, ${l.feederSlots} of them feeders joining the area to the base` : ''}, the deepest ${l.maxDepth} hops out. Every point of the area is within ${n1(l.coverM)} m of a slot; neighbouring slots are one hop apart. The tip sweeps the area back and forth, ${n0(l.surveyM)} m a round, and goes round again.\n`;
}
function tipRows(plan) {
    const row = (id, s) => `| ${id} | ${n0(s.s)} | ${n1(s.pt.x)}, ${n1(s.pt.y)}, ${n1(s.pt.z)} |`;
    if (plan.lattice)
        return [row('tip (where the sweep starts)', plan.tip)];
    return plan.tree ? plan.tree.branches.map((b) => row(`tip${b.index} (branch ${b.index})`, b.tip)) : [row('tip', plan.tip)];
}
function chainSection(spec, plan) {
    const rows = plan.slots.map((s) => `| r${s.index}${s.branch ? ` (branch ${s.branch})` : ''}${s.cell ? ` (cell ${s.cell.i}, ${s.cell.j}${s.cell.feeder ? ', feeder' : ''})` : ''} | ${n0(s.s)} | ${n1(s.pt.x)}, ${n1(s.pt.y)}, ${n1(s.pt.z)} |`);
    rows.push(...tipRows(plan));
    return [
        '## 2. The chain',
        '',
        `${plan.relaysNeeded} relays at ${n1(plan.hopM)} m, ${Math.max(0, plan.sparesAvailable)} spare${plan.sparesAvailable === 1 ? '' : 's'} at the base, ${plan.tree ? 'the farthest tip' : plan.lattice ? 'the deepest slot' : 'the tip'} at ${n0(plan.pathLengthM)} m${plan.lattice ? ' along the lattice' : ''}. Relays fly the ${spec.altitudes.relayM} m band, the tip ${spec.altitudes.tipM} m, returning drones ${spec.altitudes.returnM} m (the fleet's 10 m vertical separation rule).`,
        treeLine(plan) || latticeLine(plan),
        `Posture: ${postureLine(spec, plan)}`,
        '',
        `Endurance: the farthest relay ${spec.posture === 'perch' ? 'perches' : 'holds its slot'} ${n0(plan.onStationS)} s on a ${n0(spec.enduranceS)} s battery. Holding every slot continuously needs about **${plan.sustainFleet} relays in rotation** (each stretch on station costs one flight out and home, the reserve and a ${n0(spec.turnaroundS)} s turnaround); the fleet has ${spec.fleetSize}.`,
        plan.courier ? `\nCourier: ${courierLine(spec, plan, plan.courier)}` : '',
        '',
        '| Slot | Along corridor (m) | Position east, north, up (m) |',
        '|---|---|---|',
        ...rows,
        '',
        plan.feasible ? 'Feasible.' : `**Not feasible:** ${plan.reasons.join('; ')}.`,
        plan.warnings.length ? `\nWarnings: ${plan.warnings.join(' ')}` : '',
    ].join('\n');
}
function policySection(spec) {
    return [
        '## 3. How the chain behaves (as implemented)',
        '',
        '**On board every relay, without the controller:**',
        `1. Battery: when flight time left ≤ flight home + ${spec.reserveS} s reserve → fly home along the corridor.`,
        `2. Inner link silent ${spec.detectS} s → shift inward along the corridor at ${spec.recoverMps} m/s, at most one hop, then hold.`,
        `3. Inner link silent ${spec.rtlAfterS} s → fly home along the corridor (it is inside the chain's coverage the whole way).`,
        '4. The outer link is never chased: a relay only ever moves inward on its own.',
        '',
        '**At the controller, over the reachable part of the chain:**',
        `1. A silent node stays on the roster ${spec.staleS} s (its last position), then counts as lost.`,
        '2. Elastic spacing: k connected relays are spread evenly between the base and the tip; when the tip is out of reach the connected prefix stretches to the gap\'s midpoint while the outer segment shifts inward — they meet in the middle.',
        `3. Gap policy \`${spec.gapPolicy}\`: ${spec.gapPolicy === 'retreat' ? 'the tip retreats so every hop keeps the design margin' : `the tip holds while every hop stays above ${spec.degradedMarginDb} dB`}.`,
        '4. Fewer connected relays than the plan needs → a spare launches from the base and joins at the inner end; the whole chain shifts outward one slot as it arrives.',
        '5. A relay that could not fly home after a spare arrived → a spare launches first (a swap); the tired relay is released once the spare holds its slot.',
        '6. No commanded move may break a link that is good now (guarded against both neighbours).',
        ...(spec.area ? ['7. On a lattice: the controller holds the slots by the assignment rule — the route from the base to the slot nearest the tip first, then every other slot inner first; a relay keeps a slot it holds, an open slot takes the nearest free relay, a swap takes the tired relay\'s slot. Reachability is the graph: a lost relay is routed around wherever a neighbour still reaches. The controller does not stretch the lattice toward a gap; the far side walks in on its own rule.'] : []),
        ...(spec.branches ? ['7. On a tree: relays inside the fork serve every branch and a relay sits AT the fork; a tip passes the fork only once the trunk holds that relay, the relays left over go to the branch whose tip is farthest short, a relay changes branch only back through the fork, and it leaves the fork only while every other branch stays in reach of what is left on the trunk. A trunk cut is met in the middle along the trunk; a branch cut on that branch while the rest of the tree holds.'] : []),
        '',
        '**Envelopes:** commands and heartbeats ride source-routed, end-to-end authenticated envelopes; a relay forwards from the route alone, never reads or alters the payload, drops loops and exhausted hop budgets naming the reason, and stamps the signal it saw on every inward heartbeat.',
    ].join('\n');
}
function resultSection(spec, sim) {
    if (!sim)
        return '## 4. Last run\n\nNo scenario has been run for this plan yet.';
    const m = sim.metrics;
    const events = sim.events.slice(0, 40).map((e) => `| ${n1(e.atS)} | ${e.kind} | ${e.drone ?? ''} | ${e.text} |`);
    return [
        '## 4. Last run',
        '',
        `Scenario: ${n0(sim.scenario.durationS)} s, ${sim.scenario.startDeployed ? 'chain on station at t = 0' : 'everything launches from the base'}, ${sim.scenario.events.length} injected failure${sim.scenario.events.length === 1 ? '' : 's'} (${sim.scenario.events.map((e) => `${e.drone} @ ${n0(e.atS)} s`).join(', ') || 'none'}).`,
        '',
        `Store and forward: the longest outage was ${n1(m.longestOutageS)} s; a tip pushing ${spec.tipDataKbps} kbps buffers ${n1(m.tipBufferKB)} KB through it and drains that ${m.drainS === null ? 'never — the chain has no spare capacity' : `in ${n1(m.drainS)} s`} once reconnected.`,
        '',
        ...(m.branches ? [`Every tip: ${m.branches.map((b) => `${b.tip} out of reach ${n1(b.outageS)} s${b.reconnectedAtS.length ? ` (reconnected at ${b.reconnectedAtS.map(n1).join(', ')})` : ''}`).join('; ')}. On a tree "the tip is reachable" below means every tip is.`, ''] : []),
        `**Verdict: ${m.verdict}.** Tip reachable ${n1(m.tipReachableS)} s of ${n0(m.durationS)} s; outage **${n1(m.tipOutageS)} s** (${m.outages.length} outage${m.outages.length === 1 ? '' : 's'}); gap detected at ${m.gapDetectedAtS.map(n1).join(', ') || '—'}; reconnected at ${m.reconnectedAtS.map(n1).join(', ') || '—'}; restored at ${m.restoredAtS.map(n1).join(', ') || '—'}; worst hop margin ${m.minHopMarginDb === null ? '—' : `${n1(m.minHopMarginDb)} dB`}; spares launched ${m.sparesLaunched}; swaps ${m.swaps}; forced returns ${m.forcedReturns}; landings ${m.landings}.`,
        '',
        '| t (s) | event | drone | detail |',
        '|---|---|---|---|',
        ...events,
        sim.events.length > 40 ? `| … | | | ${sim.events.length - 40} more |` : '',
    ].join('\n');
}
function honestySection() {
    return [
        '## 5. What this document is and is not',
        '',
        '- The ranges are a log-distance model on datasheet numbers. They size the chain; they do not certify it. Fly the range test in the hardware document and replace the transport row with measured numbers before the first mission.',
        '- The simulation moves drones along the corridor at constant speeds with a hard link edge. It has no wind, no antenna pattern, no packet loss below the edge, no terrain. Its value is comparative: two designs run on the same model.',
        '- Nothing here flies anything. The chain\'s commands reach a vehicle only through the swarm drone rail (ADR-099) behind its human confirm.',
    ].join('\n');
}
/**
 * @description Render the design as Markdown from the plan (and the last run when there is one).
 * @param spec - The spec.
 * @param plan - The plan.
 * @param sim - The last run, or null.
 * @returns Markdown.
 */
function designMarkdown(spec, plan, sim) {
    return [
        `# ${spec.title} — relay chain design`,
        '',
        `Generated by the drone-relay engine from the saved plan. Corridor ${n0(plan.pathLengthM)} m, transport ${plan.transport.id}, fleet ${spec.fleetSize} relays + tip, endurance ${n0(spec.enduranceS)} s.`,
        '',
        budgetSection(spec, plan),
        '',
        chainSection(spec, plan),
        '',
        policySection(spec),
        '',
        resultSection(spec, sim),
        '',
        honestySection(),
        '',
    ].join('\n');
}
//# sourceMappingURL=design-doc.js.map