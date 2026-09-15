/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Square-on frame suggestion (BACKLOG B12): a synthetic 60 x 40 x 30 box spun on a turntable yields its three axis-aligned frames (0, 90, 180 degrees) as the front, right and back suggestions, and a frame mid-turn at 67.4 degrees that has EXACTLY the front proportions (which a first-difference stability score would propose) is not proposed; a sweep from the side over the front to the top yields right, front and top; a pause counts as square-on; a view whose proportions are not known is ranked on the turning point alone and says so; frames with no object are never proposed and are skipped as neighbours; a frame at the edge of the clip is never confirmed; one frame is never proposed twice; a view the video never shows gets no proposal (only a frame at a turning point and inside the 10 % disagreement threshold qualifies); an already assigned frame stays a neighbour but is never proposed, and two clips never neighbour each other; malformed input is a RangeError.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const BOX = { x: 60, y: 40, z: 30 };
const KNOWN = [{ axis: 'x', mm: 60 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 30 }];
const PPM = 2;
const SIZE = 220;

/** Rotate a point by yaw about Z, then pitch about X, degrees. */
function rotate(p, yawDeg, pitchDeg) {
  const a = (yawDeg * Math.PI) / 180;
  const b = (pitchDeg * Math.PI) / 180;
  const x1 = p.x * Math.cos(a) - p.y * Math.sin(a);
  const y1 = p.x * Math.sin(a) + p.y * Math.cos(a);
  return { x: x1, y: y1 * Math.cos(b) - p.z * Math.sin(b), z: y1 * Math.sin(b) + p.z * Math.cos(b) };
}

/** Convex hull (monotone chain) of 2-D points. */
function hull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const out = []; for (const p of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } return out; };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The orthographic silhouette a fixed front camera (image right +X, image down -Z) sees of the rotated box, as frame statistics. */
function frame(id, yawDeg, pitchDeg, box = BOX) {
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = rotate({ x: (sx * box.x) / 2, y: (sy * box.y) / 2, z: (sz * box.z) / 2 }, yawDeg, pitchDeg);
    corners.push([SIZE / 2 + p.x * PPM, SIZE / 2 - p.z * PPM]);
  }
  const poly = hull(corners);
  const inside = (x, y) => poly.every((p, i) => { const q = poly[(i + 1) % poly.length]; return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= 0; });
  const stats = e.maskStats(e.maskFromPredicate(SIZE, SIZE, inside));
  return { id, pixels: stats.pixels, bbox: stats.bbox };
}

/** A turntable spin from -20 to 200 degrees in 5 degree steps. */
const turntable = () => Array.from({ length: 45 }, (_, i) => frame(`yaw${-20 + 5 * i}`, -20 + 5 * i, 0));

test('B12: a turntable spin of a box yields its three axis-aligned frames as the suggestions', () => {
  const frames = turntable();
  const [front, right, back] = e.suggestSquareOnFrames(frames, ['front', 'right', 'back'], KNOWN);
  assert.deepEqual([front.best.id, right.best.id, back.best.id], ['yaw0', 'yaw90', 'yaw180']);
  for (const s of [front, right, back]) {
    assert.ok(s.best.skew < 0.02, `${s.view}: the square-on frame has the view's proportions (skew ${s.best.skew})`);
    assert.ok(s.best.turn > 0, `${s.view}: and sits at a turning point (turn ${s.best.turn})`);
  }
  const midTurn = front.ranked.find((c) => c.id === 'yaw70');
  assert.ok(midTurn.skew < 0.05, 'at 70 degrees the outline has almost the front proportions too');
  assert.ok(midTurn.score > front.best.score, 'but it is mid-turn, so it ranks below the square-on frame');
});

test('B12: a mid-turn frame with exactly the front proportions is not proposed', () => {
  // On a steady spin a 60 x 40 box also shows width/height = 2.0 at 2 atan(40/60) = 67.4 degrees,
  // and that frame changes MORE slowly than the square-on one, so a first-difference "stability"
  // score (measured: 0.033 against 0.050 per step) proposes it. The turning point rejects it by sign.
  const frames = turntable();
  const at = frames.findIndex((f) => f.id === 'yaw65');
  frames.splice(at + 1, 0, frame('yaw67.4', (360 / Math.PI) * Math.atan(40 / 60), 0));
  const [front] = e.suggestSquareOnFrames(frames, ['front'], KNOWN);
  assert.equal(front.best.id, 'yaw0');
  const midTurn = front.ranked.find((c) => c.id === 'yaw67.4');
  assert.ok(midTurn.skew < 1e-9, 'its proportions match the front exactly');
  assert.ok(midTurn.turn < 0 && midTurn.score > 0, `but it is still turning: ${JSON.stringify(midTurn)}`);
});

test('B12: a sweep from the side over the front to the top yields right, front and top', () => {
  const frames = [];
  for (let yaw = 110; yaw >= 0; yaw -= 5) frames.push(frame(`yaw${yaw}`, yaw, 0));
  for (let pitch = 5; pitch <= 110; pitch += 5) frames.push(frame(`pitch${pitch}`, 0, pitch));
  const byView = Object.fromEntries(e.suggestSquareOnFrames(frames, ['front', 'right', 'top'], KNOWN).map((s) => [s.view, s.best.id]));
  assert.deepEqual(byView, { front: 'yaw0', right: 'yaw90', top: 'pitch90' });
});

test('B12: a pause on a face counts as square-on', () => {
  const frames = [];
  for (let yaw = 30; yaw > 0; yaw -= 5) frames.push(frame(`yaw${yaw}`, yaw, 0));
  frames.push(frame('hold-a', 0, 0), frame('hold-b', 0, 0), frame('hold-c', 0, 0));
  for (let yaw = -5; yaw >= -30; yaw -= 5) frames.push(frame(`yaw${yaw}`, yaw, 0));
  const [front] = e.suggestSquareOnFrames(frames, ['front'], KNOWN);
  assert.equal(front.best.id, 'hold-a', 'the first held frame (ties keep sequence order)');
  assert.equal(front.best.turn, 0, 'a plateau neither shrinks nor grows');
});

test('B12: without both extents of a view, frames rank on the turning point alone and say so', () => {
  const suggestions = e.suggestSquareOnFrames(turntable(), ['front', 'right', 'back'], [{ axis: 'z', mm: 30 }]);
  for (const s of suggestions) assert.equal(s.best.skew, null, `${s.view} has no proportions to compare`);
  assert.deepEqual(suggestions.map((s) => s.best.id).sort(), ['yaw0', 'yaw180', 'yaw90'], 'still the three cusps, one per view');
});

test('B12: frames with no object are never proposed and are skipped when finding neighbours', () => {
  const frames = [frame('before', -5, 0), frame('a', 0, 0), { id: 'blank', pixels: 0, bbox: null }, frame('after', 5, 0)];
  const [front, back] = e.suggestSquareOnFrames(frames, ['front', 'back'], KNOWN);
  assert.ok([front, back].every((s) => s.ranked.every((c) => c.id !== 'blank')));
  assert.equal(front.best.id, 'a');
  assert.ok(front.best.turn > 0, 'its right neighbour is the next frame that shows the object, not the empty one');
  assert.equal(back.best, null, 'the clip edges cannot confirm a turn, so nothing is left for the back');
});

test('B12: a frame at the edge of the clip is never confirmed as square-on', () => {
  const frames = Array.from({ length: 17 }, (_, i) => frame(`yaw${-20 + 5 * i}`, -20 + 5 * i, 0)); // ends at 60, shrinking
  const [, back] = e.suggestSquareOnFrames(frames, ['front', 'back'], KNOWN);
  const last = back.ranked.find((c) => c.id === 'yaw60');
  assert.ok(last.turn > 0 && last.skew < 0.105, 'it looks like a turn with nearly the right proportions');
  assert.equal(last.squareOn, false, 'but the clip ends, so the trend may continue');
});

test('B12: one frame is never proposed for two views', () => {
  const frames = Array.from({ length: 17 }, (_, i) => frame(`yaw${-20 + 5 * i}`, -20 + 5 * i, 0)); // -20..60: one x/z face only
  const [front, back] = e.suggestSquareOnFrames(frames, ['front', 'back'], KNOWN);
  assert.equal(front.best.id, 'yaw0');
  assert.equal(back.best, null, 'the back is the same outline, but the only square-on frame is already the front');
});

test('B12: a view the video never shows gets no proposal, not the least bad frame', () => {
  const flat = { x: 60, y: 40, z: 20 }; // front x/z = 3.0, right y/z = 2.0, top x/y = 1.5
  const frames = Array.from({ length: 45 }, (_, i) => frame(`yaw${-20 + 5 * i}`, -20 + 5 * i, 0, flat));
  const known = [{ axis: 'x', mm: 60 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 20 }];
  const [front, right, top] = e.suggestSquareOnFrames(frames, ['front', 'right', 'top'], known);
  assert.equal(front.best.id, 'yaw0');
  assert.equal(right.best.id, 'yaw90');
  assert.equal(top.best, null, 'a turntable never looks down on the part');
  assert.ok(top.ranked.length > 0 && top.ranked.every((c) => !c.squareOn), 'every frame is still ranked, none qualifies');
});

test('B12: an excluded frame stays a neighbour but is never proposed; clips never neighbour each other', () => {
  const frames = turntable();
  const [front] = e.suggestSquareOnFrames(frames, ['front'], KNOWN, { exclude: ['yaw0'] });
  assert.equal(front.best.id, 'yaw180', 'the person already assigned yaw0, so the other x/z face is proposed');
  assert.ok(front.ranked.find((c) => c.id === 'yaw5').turn < 0, 'yaw0 still neighbours yaw5, so yaw5 is still seen as turning');
  const clipA = [frame('a1', 20, 0), frame('a2', 10, 0)];
  const clipB = [frame('b1', 0, 0), frame('b2', 10, 0), frame('b3', 20, 0)].map((f) => ({ ...f, sequence: 1 }));
  const [onlyB] = e.suggestSquareOnFrames([...clipA, ...clipB], ['front'], KNOWN);
  assert.equal(onlyB.ranked.find((c) => c.id === 'b1').squareOn, false, 'b1 opens its clip, so a2 in the previous clip is not its neighbour');
  assert.equal(onlyB.best, null);
});

test('B12: the suggestion is deterministic', () => {
  assert.deepEqual(e.suggestSquareOnFrames(turntable(), ['front', 'right'], KNOWN), e.suggestSquareOnFrames(turntable(), ['front', 'right'], KNOWN));
});

test('B12: malformed frames, views and dimensions are RangeErrors that name the problem', () => {
  const ok = [frame('a', 0, 0)];
  const refuses = (f, v, k, pattern) => assert.throws(() => e.suggestSquareOnFrames(f, v, k), (err) => err instanceof RangeError && pattern.test(err.message), pattern.source);
  refuses([], ['front'], KNOWN, /At least one frame/);
  refuses([{ id: 'x', pixels: -1, bbox: null }], ['front'], KNOWN, /pixel count/);
  refuses([{ id: 'x', pixels: 4, bbox: { minX: 5, minY: 0, maxX: 2, maxY: 1 } }], ['front'], KNOWN, /bbox/);
  refuses([{ ...frame('a', 0, 0), sequence: 0.5 }], ['front'], KNOWN, /sequence must be an integer/);
  refuses(ok, [], KNOWN, /candidate view/);
  refuses(ok, ['front', 'front'], KNOWN, /distinct canonical/);
  refuses(ok, ['side'], KNOWN, /distinct canonical/);
  refuses(ok, ['front'], [{ axis: 'x', mm: 0 }], /Known dimensions/);
  refuses(ok, ['front'], [{ axis: 'x', mm: 60 }, { axis: 'x', mm: 60 }], /Known dimensions/);
});
