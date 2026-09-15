/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the breadboard model under plain node: footprints
 *                     |                             | put every pin in a real hole (a DIP across the gap on its
 *                     |                             | pinout), a board is refused for an unknown part, two legs in
 *                     |                             | one hole, a bad hole or a self-jumper; for every starter
 *                     |                             | example the automatic layout implies EXACTLY the schematic's
 *                     |                             | nets and the wires rebuilt from that board imply them again
 *                     |                             | (the same deck both ways, since the deck is a function of
 *                     |                             | parts and nets); a moved part keeps the nets, a removed
 *                     |                             | jumper splits one, an added jumper joins two; reconciling
 *                     |                             | drops a gone part, places a new one and regenerates the
 *                     |                             | jumpers; a board that cannot fit is reported.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B2: a turned placement steps its legs down the rows,
 *                     |                             | back along the row or up the rows (an upright resistor from row c
 *                     |                             | crosses the channel to f), off the board it does not fit, a DIP
 *                     |                             | or a bad turn is refused naming `.rot`, an unturned placement is
 *                     |                             | stored without one; a part with two legs on one strip is named
 *                     |                             | as shorted and its nets say so; a jumper's span in mm follows the
 *                     |                             | BB830 geometry (0.1" pitch, 0.3" across the channel, the rails
 *                     |                             | two pitches out); a turned part keeps board and schematic nets
 *                     |                             | equal both ways.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const M = require(path.resolve(__dirname, '..', 'tools', 'circuit-lab-board-model.js'));
const c = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const { EXAMPLES } = require(path.resolve(__dirname, '..', 'routes', 'examples.js'));
const contract = c.describeContract();
const circuitOf = (e) => c.validateCircuit({ parts: e.parts, wires: e.wires });

test('footprints put every electrical pin in a real hole; a DIP straddles the gap on its pinout', () => {
  const r = c.validatePart({ id: 'R1', type: 'resistor' });
  assert.deepEqual(M.footprintHoles(r, { col: 5, row: 'b' }), { a: 'b5', b: 'b8' });
  assert.equal(M.stripOf('b5'), 't5'); assert.equal(M.stripOf('g5'), 'b5'); assert.equal(M.stripOf('T+9'), 'rail:T+'); assert.equal(M.stripOf('zz'), null);
  const u = c.validatePart({ id: 'U1', type: 'timer555' });
  assert.deepEqual(M.footprintHoles(u, { col: 10, row: 'anything' }), { gnd: 'e10', trig: 'e11', out: 'e12', thr: 'f12', dis: 'f11', vcc: 'f10' }, 'pins 1-4 on row e left to right; pin 8 sits above pin 1');
  assert.equal(M.footprintHoles(r, { col: 62, row: 'b' }), null, 'off the right edge');
  assert.equal(M.footprintHoles(c.validatePart({ id: 'G1', type: 'gear' }), { col: 1, row: 'a' }), null, 'mechanical parts have no footprint');
  for (const type of c.PART_TYPES) assert.equal(M.isBoardType(type), contract.parts[type].pins.some((p) => p.kind === 'electrical'), type);
});

test('a board is refused for an unknown part, two legs in one hole, a bad hole or a self-jumper', () => {
  const parts = c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }] }).parts;
  const field = (board) => { try { M.validateBoard(board, parts); return null; } catch (e) { return e.field; } };
  assert.equal(field({ placements: { R9: { col: 1, row: 'a' } }, jumpers: [] }), 'board.placements.R9');
  assert.equal(field({ placements: { R1: { col: 2, row: 'b' }, R2: { col: 5, row: 'b' } }, jumpers: [] }), 'board.placements.R2', 'R1.b and R2.a would share b5');
  assert.equal(field({ placements: { R1: { col: 2, row: 'q' } }, jumpers: [] }), 'board.placements.R1');
  assert.equal(field({ placements: {}, jumpers: [{ from: 'a1', to: 'a1' }] }), 'board.jumpers[0]');
  assert.equal(field({ placements: {}, jumpers: [{ from: 'a1', to: 'k1' }] }), 'board.jumpers[0].to');
  const ok = M.validateBoard({ placements: { R1: { col: 2, row: 'b' }, R2: { col: 2, row: 'g' } }, jumpers: [{ from: 'a2', to: 'j2' }] }, parts);
  assert.deepEqual(ok.jumpers, [{ id: 'j1', from: 'a2', to: 'j2' }]);
});

test('for every starter example the automatic layout implies the schematic nets, and the wires rebuilt from it imply them again', () => {
  for (const example of EXAMPLES) {
    const { parts, wires } = circuitOf(example);
    const board = M.autoLayout(parts, wires, contract);
    assert.ok(board, example.id);
    const placed = parts.filter((p) => M.isBoardType(p.type));
    assert.deepEqual(Object.keys(board.placements).sort(), placed.map((p) => p.id).sort(), example.id + ': every electrical part is placed');
    const fromWires = M.wireNets(parts, wires, contract), fromBoard = M.boardNets(board, parts, contract);
    assert.ok(M.sameNets(fromWires, fromBoard), example.id + ': the board implies the schematic nets');
    const rebuilt = M.wiresFromBoard(board, parts, wires, contract);
    assert.ok(M.sameNets(fromWires, M.wireNets(parts, rebuilt, contract)), example.id + ': the rebuilt wires imply them too');
    assert.deepEqual(rebuilt.map((w) => w.id).sort(), wires.map((w) => w.id).sort(), example.id + ': wires that still hold keep their ids');
    assert.equal(c.validateCircuit({ parts, wires: rebuilt }).wires.length, rebuilt.length, 'the rebuilt wires validate');
  }
});

test('a moved part keeps the nets, a removed jumper splits one, an added jumper joins two', () => {
  const { parts, wires } = circuitOf(EXAMPLES[0]);
  const board = M.autoLayout(parts, wires, contract);
  const r1 = board.placements.R1;
  const moved = { placements: { ...board.placements, R1: { col: 40, row: 'i' } }, jumpers: M.jumpersFromNets({ placements: { ...board.placements, R1: { col: 40, row: 'i' } }, jumpers: [] }, parts, wires, contract) };
  assert.notDeepEqual(moved.placements.R1, r1);
  assert.ok(M.sameNets(M.wireNets(parts, wires, contract), M.boardNets(M.validateBoard(moved, parts), parts, contract)), 'jumpers regenerated for the new spot keep the nets');
  const fewer = { placements: board.placements, jumpers: board.jumpers.slice(1) };
  const netsFewer = M.boardNets(fewer, parts, contract).filter((g) => g.length > 1).length;
  assert.equal(netsFewer, M.wireNets(parts, wires, contract).filter((g) => g.length > 1).length - 1, 'one net split in two singletons or fewer joined pins');
  const rebuilt = M.wiresFromBoard(fewer, parts, wires, contract);
  assert.equal(rebuilt.length, wires.length - 1, 'the wire that jumper carried is gone');
  const b1 = board.placements.B1, r1p = board.placements.R1;
  const more = { placements: board.placements, jumpers: board.jumpers.concat([{ id: 'jx', from: 'a' + r1p.col, to: 'a' + (b1.col + 2) }]) };
  const joined = M.boardNets(more, parts, contract);
  assert.ok(joined.some((g) => g.includes('R1.a') && g.includes('B1.-')), 'the new jumper joins R1.a to the battery minus strip');
  assert.equal(M.wiresFromBoard(more, parts, wires, contract).length, wires.length + 1);
});

test('reconciling drops a gone part, places a new one, regenerates the jumpers; a full board is reported', () => {
  const { parts, wires } = circuitOf(EXAMPLES[0]);
  const board = M.autoLayout(parts, wires, contract);
  const without = parts.filter((p) => p.id !== 'S1'), wiresWithout = wires.filter((w) => w.from.part !== 'S1' && w.to.part !== 'S1');
  const r = M.reconcileBoard(board, without, wiresWithout, contract);
  assert.ok(!r.placements.S1); assert.ok(!r.stale);
  assert.ok(M.sameNets(M.wireNets(without, wiresWithout, contract), M.boardNets(r, without, contract)));
  const withNew = parts.concat([c.validatePart({ id: 'C9', type: 'capacitor' })]);
  const r2 = M.reconcileBoard(board, withNew, wires, contract);
  assert.ok(r2.placements.C9, 'the new part was placed'); assert.deepEqual(r2.placements.R1, board.placements.R1, 'existing placements are kept');
  const many = c.validateCircuit({ parts: Array.from({ length: 40 }, (_, i) => ({ id: 'R' + i, type: 'resistor' })) }).parts;
  assert.equal(M.autoLayout(many, [], contract), null, '40 resistors do not fit two rows of 63 columns');
  assert.match(M.reconcileBoard({ placements: {}, jumpers: [] }, many, [], contract).stale, /full/);
});

test('a placement turns: legs down the rows, back along the row, up the rows; off the board it does not fit; a DIP or a bad turn is refused naming .rot', () => {
  const r = c.validatePart({ id: 'R1', type: 'resistor' });
  assert.deepEqual(M.footprintHoles(r, { col: 5, row: 'c', rot: 90 }), { a: 'c5', b: 'f5' }, 'upright from row c: across the channel to f');
  assert.deepEqual(M.footprintHoles(r, { col: 5, row: 'b', rot: 180 }), { a: 'b5', b: 'b2' });
  assert.deepEqual(M.footprintHoles(r, { col: 5, row: 'h', rot: 270 }), { a: 'h5', b: 'e5' });
  assert.deepEqual(M.footprintHoles(r, { col: 5, row: 'i', rot: 90 }), { a: 'i5', b: 'B-5' }, 'a pull-down from row i to the bottom minus rail');
  assert.equal(M.footprintHoles(r, { col: 5, row: 'j', rot: 90 }), null, 'off the bottom');
  assert.equal(M.footprintHoles(r, { col: 2, row: 'b', rot: 180 }), null, 'off the left edge');
  assert.equal(M.footprintHoles(c.validatePart({ id: 'MCU1', type: 'arduino' }), { col: 5, row: 'T+', rot: 90 }), null, 'a 20-pin header does not fit down 14 rows');
  const parts = c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'U1', type: 'timer555' }] }).parts;
  const field = (board) => { try { M.validateBoard(board, parts); return null; } catch (e) { return e.field; } };
  assert.equal(field({ placements: { U1: { col: 10, row: 'e', rot: 90 } }, jumpers: [] }), 'board.placements.U1.rot', 'a DIP straddles the gap unturned');
  assert.equal(field({ placements: { R1: { col: 5, row: 'c', rot: 45 } }, jumpers: [] }), 'board.placements.R1.rot');
  assert.equal(field({ placements: { R1: { col: 5, row: 'j', rot: 90 } }, jumpers: [] }), 'board.placements.R1', 'a leg off the board');
  const ok = M.validateBoard({ placements: { R1: { col: 5, row: 'c', rot: 90 }, U1: { col: 20, row: 'e', rot: 0 } }, jumpers: [] }, parts);
  assert.deepEqual(ok.placements, { R1: { col: 5, row: 'c', rot: 90 }, U1: { col: 20, row: 'e' } }, 'rot is kept when turned and absent when not');
});

test('two legs of one part on one strip are named as shorted, and the board nets join them', () => {
  const parts = c.validateCircuit({ parts: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }] }).parts;
  const board = { placements: { R1: { col: 5, row: 'a', rot: 90 }, R2: { col: 20, row: 'T+' } }, jumpers: [] };
  assert.deepEqual(M.shortedParts(board, parts), [{ part: 'R1', pins: ['a', 'b'], strip: 't5' }, { part: 'R2', pins: ['a', 'b'], strip: 'rail:T+' }], 'upright inside one block, and flat along a rail');
  assert.ok(M.boardNets(board, parts, contract).some((g) => g.includes('R1.a') && g.includes('R1.b')));
  assert.deepEqual(M.shortedParts({ placements: { R1: { col: 5, row: 'c', rot: 90 } }, jumpers: [] }, parts), [], 'across the channel it is not shorted');
});

test('a jumper spans its holes on the BB830 geometry: 0.1 inch pitch, 0.3 inch across the channel, the rails two pitches out', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(M.jumperLengthMm('a5', 'a12'), 7 * 2.54));
  assert.ok(near(M.jumperLengthMm('e10', 'f10'), 7.62), 'row e to row f is the 0.3 inch DIP channel');
  assert.ok(near(M.jumperLengthMm('T-1', 'a1'), 5.08));
  assert.ok(near(M.jumperLengthMm('j3', 'B+3'), 5.08));
  assert.ok(near(M.jumperLengthMm('T+1', 'B-1'), 17 * 2.54), 'rail to rail across the whole board');
  assert.ok(near(M.jumperLengthMm('a1', 'b2'), Math.SQRT2 * 2.54), 'a diagonal is its straight span');
  assert.equal(M.jumperLengthMm('a1', 'k1'), null);
  const { parts, wires } = circuitOf(EXAMPLES[0]);
  for (const j of M.autoLayout(parts, wires, contract).jumpers) assert.ok(M.jumperLengthMm(j.from, j.to) > 0, j.id);
});

test('a turned part keeps board and schematic nets equal both ways', () => {
  const { parts, wires } = circuitOf(EXAMPLES[0]);
  const base = M.autoLayout(parts, wires, contract);
  const placements = { ...base.placements, D1: { col: 40, row: 'e', rot: 90 } };
  const board = M.validateBoard({ placements, jumpers: M.jumpersFromNets({ placements, jumpers: [] }, parts, wires, contract) }, parts);
  assert.deepEqual(M.footprintHoles(parts.find((p) => p.id === 'D1'), board.placements.D1), { a: 'e40', k: 'f40' }, 'an LED straddling the channel');
  assert.ok(M.sameNets(M.wireNets(parts, wires, contract), M.boardNets(board, parts, contract)), 'the jumpers regenerated for the turned LED imply the schematic nets');
  const rebuilt = M.wiresFromBoard(board, parts, wires, contract);
  assert.ok(M.sameNets(M.wireNets(parts, rebuilt, contract), M.boardNets(board, parts, contract)), 'and the wires rebuilt from that board imply them again');
});
