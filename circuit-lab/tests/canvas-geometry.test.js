/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the schematic geometry under plain node (BACKLOG B9):
 *                     |                             | a wire's corners for an automatic, middle-segment and bend-point
 *                     |                             | route and the path through them; a double-click puts a bend on
 *                     |                             | the nearest segment (snapped along it, the drawn wire unchanged,
 *                     |                             | shapeless corners dropped), and is ignored off the wire or on a
 *                     |                             | pin; the seventeenth
 *                     |                             | bend is refused; a bend is found and removed, the last one
 *                     |                             | leaving no route; a group turns a quarter clockwise about its
 *                     |                             | snapped centre with every pin turning rigidly, four turns are
 *                     |                             | the identity, a routed wire inside the group keeps its shape
 *                     |                             | and one crossing its edge keeps its route, and a turn that
 *                     |                             | would push a part off the canvas (or a one-part group) is
 *                     |                             | refused naming it; every route produced validates against the
 *                     |                             | contract.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const G = require(path.resolve(__dirname, '..', 'tools', 'circuit-lab-geometry.js'));
const c = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));

/** The canvas's pin positions for the two-pin parts used here (tools/circuit-lab-canvas.js pinsOf). */
const LOCAL = { resistor: { a: [-30, 0], b: [30, 0] }, switch: { a: [-30, 0], b: [30, 0] }, battery: { '+': [0, -30], '-': [0, 30] } };
function pinWorld(part, pin) {
  const [lx, ly] = LOCAL[part.type][pin], r = ((part.rotation || 0) * Math.PI) / 180;
  return [Math.round(part.x + lx * Math.cos(r) - ly * Math.sin(r)), Math.round(part.y + lx * Math.sin(r) + ly * Math.cos(r))];
}
const frameFor = (parts) => ({ w: 1920, h: 960, margin: 20, verticesOf: (w) => { const a = parts.find((p) => p.id === w.from.part), b = parts.find((p) => p.id === w.to.part); return G.routeVertices(pinWorld(a, w.from.pin), pinWorld(b, w.to.pin), w.route); } });
// The switched-LED starter: B1.+ at (100, 170) to S1.a at (230, 100) — the automatic path turns at x = 165.
const B1 = { id: 'B1', type: 'battery', x: 100, y: 200, rotation: 0 }, S1 = { id: 'S1', type: 'switch', x: 260, y: 100, rotation: 0 }, R1 = { id: 'R1', type: 'resistor', x: 420, y: 100, rotation: 0 };

test('a wire passes through its automatic, middle-segment or bend-point corners; the path draws them', () => {
  const a = [100, 170], b = [230, 100];
  assert.deepEqual(G.routeVertices(a, b, null), [a, [165, 170], [165, 100], b], 'wider than tall: the middle segment is vertical, halfway');
  assert.deepEqual(G.routeVertices(a, b, { mid: 140 }), [a, [140, 170], [140, 100], b]);
  assert.deepEqual(G.routeVertices([0, 0], [20, 200], { mid: 60 }), [[0, 0], [0, 60], [20, 60], [20, 200]], 'taller than wide: the middle segment is horizontal');
  assert.deepEqual(G.routeVertices(a, b, { points: [[120, 240], [200, 240]] }), [a, [120, 240], [200, 240], b]);
  assert.equal(G.pathD(G.routeVertices(a, b, { mid: 140 })), 'M100 170 L140 170 L140 100 L230 100');
});

test('a double-click puts a bend on the nearest segment, snapped along it, and keeps the drawn corners; off the wire or on a pin it does nothing', () => {
  const v = G.routeVertices([100, 170], [230, 100], null);
  assert.deepEqual(G.insertBend(v, [131, 172], 8), { points: [[140, 170], [165, 170], [165, 100]] }, 'the first segment gets the bend on its own line (x snapped to 140); the automatic corners become bend points');
  assert.equal(G.pathD(G.routeVertices([100, 170], [230, 100], G.insertBend(v, [131, 172], 8))), 'M100 170 L140 170 L165 170 L165 100 L230 100', 'placing a bend does not change the drawn wire');
  assert.deepEqual(G.insertBend(v, [167, 131], 8), { points: [[165, 170], [165, 140], [165, 100]] }, 'a vertical run: y snapped, x kept on the run');
  assert.deepEqual(G.insertBend(v, [198, 103], 8), { points: [[165, 170], [165, 100], [200, 100]] }, 'the last segment');
  assert.equal(G.insertBend(v, [131, 190], 8), null, '20 units off the wire');
  assert.equal(G.insertBend(v, [104, 170], 8), null, 'on the pin itself');
  const straight = G.routeVertices([0, 100], [200, 100], null);
  assert.deepEqual(G.insertBend(straight, [60, 101], 8), { points: [[60, 100]] }, 'a straight wire: its two coincident corners collapse, only the new bend stays');
  const zigzag = { points: Array.from({ length: 16 }, (_, i) => [300 + i * 20, i % 2 ? 340 : 300]) };
  assert.match(G.insertBend(G.routeVertices([280, 300], [700, 300], zigzag), [310, 321], 8).error, /at most 16 bends/, 'sixteen shaped bends are the cap');
  assert.equal(G.insertBend(G.routeVertices([280, 300], [700, 300], zigzag), [290, 301], 8).points.length, 16, 'a bend that snaps onto an existing corner adds nothing');
});

test('a bend is found near the pointer and removed; the last bend gone leaves no route', () => {
  const route = { points: [[140, 180], [165, 170], [165, 100]] };
  assert.equal(G.bendAt(route, [163, 104], 8), 2);
  assert.equal(G.bendAt(route, [300, 300], 8), -1);
  assert.equal(G.bendAt({ mid: 140 }, [140, 170], 8), -1, 'a middle-segment route has no bends to pick');
  assert.deepEqual(G.removeBend(route, 0), { points: [[165, 170], [165, 100]] });
  assert.equal(G.removeBend({ points: [[60, 100]] }, 0), null);
});

test('a group turns a quarter clockwise about its snapped centre, rigidly; four turns are the identity', () => {
  const parts = [B1, S1, R1];
  const w2 = { id: 'w2', from: { part: 'S1', pin: 'b' }, to: { part: 'R1', pin: 'a' } };
  const out = G.rotateGroup(parts, [w2], ['S1', 'R1'], frameFor(parts));
  assert.deepEqual(out.centre, [340, 100]);
  const after = Object.fromEntries(out.parts.map((p) => [p.id, [p.x, p.y, p.rotation]]));
  assert.deepEqual(after, { B1: [100, 200, 0], S1: [340, 20, 90], R1: [340, 180, 90] });
  assert.equal(out.parts[0], B1, 'an unselected part is the same object');
  assert.equal(out.wires[0], w2, 'an unrouted wire keeps its automatic path');
  // every pin of the group turned about the centre too
  const turn = (p) => [out.centre[0] - (p[1] - out.centre[1]), out.centre[1] + (p[0] - out.centre[0])];
  for (const [id, pin] of [['S1', 'a'], ['S1', 'b'], ['R1', 'a'], ['R1', 'b']]) assert.deepEqual(pinWorld(out.parts.find((p) => p.id === id), pin), turn(pinWorld(parts.find((p) => p.id === id), pin)), `${id}.${pin}`);
  let state = { parts, wires: [w2] };
  for (let i = 0; i < 4; i += 1) state = G.rotateGroup(state.parts, state.wires, ['S1', 'R1'], frameFor(state.parts));
  assert.deepEqual(state.parts.map((p) => [p.id, p.x, p.y, p.rotation]), parts.map((p) => [p.id, p.x, p.y, p.rotation]));
});

test('a routed wire inside the group keeps its shape; one crossing the group edge keeps its route', () => {
  const parts = [B1, S1, R1];
  const inside = { id: 'w2', from: { part: 'S1', pin: 'b' }, to: { part: 'R1', pin: 'a' }, route: { points: [[320, 60], [360, 60]] } };
  const middle = { id: 'w3', from: { part: 'S1', pin: 'b' }, to: { part: 'R1', pin: 'a' }, route: { mid: 340 } };
  const crossing = { id: 'w1', from: { part: 'B1', pin: '+' }, to: { part: 'S1', pin: 'a' }, route: { mid: 140 } };
  const out = G.rotateGroup(parts, [inside, middle, crossing], ['S1', 'R1'], frameFor(parts));
  const turned = out.wires.find((w) => w.id === 'w2');
  assert.deepEqual(turned.route, { points: [[380, 80], [380, 120]] });
  const v = frameFor(out.parts).verticesOf(turned);
  assert.deepEqual(v[0], pinWorld(out.parts[1], 'b')); assert.deepEqual(v[v.length - 1], pinWorld(out.parts[2], 'a'));
  assert.equal(out.wires.find((w) => w.id === 'w3').route, null, 'a middle segment between two pins on one line carries no shape: it turns into the automatic path');
  assert.equal(out.wires.find((w) => w.id === 'w1').route.mid, 140, 'the wire to B1 keeps its route');
  for (const w of out.wires) assert.equal(c.validateWire(w, out.parts.map((p) => c.validatePart(p))).id, w.id, 'every route the geometry produced validates');
  // a middle-segment route with a shape turns into its turned corners, still meeting both (turned) pins
  const R2 = { id: 'R2', type: 'resistor', x: 420, y: 220, rotation: 0 };
  const shaped = { id: 'w4', from: { part: 'S1', pin: 'b' }, to: { part: 'R2', pin: 'a' }, route: { mid: 340 } };
  const out2 = G.rotateGroup([S1, R2], [shaped], ['S1', 'R2'], frameFor([S1, R2]));
  assert.deepEqual(out2.centre, [340, 160]);
  assert.deepEqual(out2.wires[0].route, { points: [[160, 110], [160, 210]] }, 'taller than wide: mid 340 was the horizontal run at y = 340; its corners (290, 340) and (390, 340) turn to x = 160');
  const v2 = frameFor(out2.parts).verticesOf(out2.wires[0]);
  assert.deepEqual(v2[0], pinWorld(out2.parts[0], 'b')); assert.deepEqual(v2[v2.length - 1], pinWorld(out2.parts[1], 'a'));
});

test('a turn that would push a part off the canvas, or a one-part group, is refused naming it', () => {
  const parts = [B1, S1, R1];
  assert.throws(() => G.rotateGroup(parts, [], ['B1', 'R1'], frameFor(parts)), /would move B1 off the canvas/);
  assert.throws(() => G.rotateGroup(parts, [], ['S1'], frameFor(parts)), /two or more parts/);
  const bend = G.insertBend(G.routeVertices([100, 170], [230, 100], null), [131, 172], 8);
  assert.equal(c.validateWire({ id: 'w1', from: { part: 'B1', pin: '+' }, to: { part: 'S1', pin: 'a' }, route: bend }, parts.map((p) => c.validatePart(p))).route.points.length, 3);
});
