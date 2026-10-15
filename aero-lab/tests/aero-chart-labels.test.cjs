/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The 24 h state-of-charge chart's labels do not overprint each other
 *   or the curve. The surface's own linePlot (and the helpers it calls), run as shipped against a recording SVG stub,
 *   draws the sweep-6 trace: the y-axis title 'state of charge' used to sit at the top tick's height over the '1', and
 *   'min SOC 0.0500' was always placed up-right of the dot, across the recharge curve.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 7: a three-day loop (narrow valleys, flat 0.05 floors) left no clear spot beside
 *   the dot and the fallback drew the label across the rising curve. The label of that trace crosses no curve and no other
 *   label at any width; when no spot beside the dot is clear it sits in the strip above the plot with a keyed dot.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.js'), 'utf8');

/** Slice of the shipped surface from `from` up to (not including) `to`. */
function slice(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a + 1);
  assert.ok(a > 0 && b > a, `surface contains ${from} before ${to}`);
  return page.slice(a, b);
}

/** Minimal recording SVG document: elements keep their attributes, text and children. */
function stubDocument() {
  const make = (tag) => ({
    tag, attrs: {}, children: [], textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElementNS: (_ns, tag) => make(tag) };
}

/** Load el/ticks/label placement/linePlot exactly as shipped. */
function loadChart() {
  const code = [
    slice('function el(tag, at)', '/**\n   * @description Round tick steps'),
    slice('function ticks(lo, hi, n)', '  /* chart-label-placement:start */'),
    slice('/* chart-label-placement:start */', '/**\n   * @description Nearest-x hover tooltip'),
  ].join('\n');
  const fn = new Function('document', 'NS', 'attachHover',
    code + '\nreturn { linePlot, placeMarkLabel, segHitsBox };');
  return fn(stubDocument(), 'http://www.w3.org/2000/svg', () => {});
}

/** The sweep-6 energy loop: night drain to 0.05 at 6.5 h, flat, recharge 10-11.5 h, full, evening dip. */
function sweepTrace() {
  const xs = [];
  const ys = [];
  for (let h = 0; h <= 24.0001; h += 0.25) {
    let v;
    if (h <= 6.5) v = 0.95 - (0.9 * h) / 6.5;
    else if (h <= 10) v = 0.05;
    else if (h <= 11.5) v = 0.05 + (0.95 * (h - 10)) / 1.5;
    else if (h <= 23) v = 1;
    else v = 1 - 0.15 * (h - 23);
    xs.push(Number(h.toFixed(2)));
    ys.push(v);
  }
  return { xs, ys };
}

const CHAR_W = 6.4;
/** Screen box of a recorded <text>, using the same glyph estimate as the surface. */
function textBox(t) {
  const w = String(t.textContent).length * CHAR_W;
  const x = Number(t.attrs.x);
  const y = Number(t.attrs.y);
  const anchor = t.attrs['text-anchor'] || 'start';
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x0, x1: x0 + w, y0: y - 9, y1: y + 2, text: t.textContent };
}
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The sweep-7 shape: three days, each a steep night drain to a flat 0.05 floor and a steep recharge to 1. */
function multiDayTrace() {
  const xs = [];
  const ys = [];
  for (let h = 0; h <= 72.0001; h += 0.5) {
    const d = h % 24;
    let v;
    if (d <= 8) v = 1 - (0.95 * d) / 8;
    else if (d <= 10) v = 0.05;
    else if (d <= 12) v = 0.05 + (0.95 * (d - 10)) / 2;
    else v = 1;
    xs.push(Number(h.toFixed(2)));
    ys.push(v);
  }
  return { xs, ys };
}

function drawSoc(width, trace = sweepTrace) {
  const { linePlot } = loadChart();
  const host = { clientWidth: width, innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
  const { xs, ys } = trace();
  let minI = 0;
  ys.forEach((v, i) => { if (v < ys[minI]) minI = i; });
  linePlot(host, {
    series: [{ name: 'SOC', color: '#36c', xs, ys }],
    xLabel: 'h', yLabel: 'state of charge', height: 210, y0: 0, y1: 1, shades: [[0, 8.5]],
    mark: { x: xs[minI], y: ys[minI], color: '#d33', label: 'min SOC 0.0500' },
  });
  const svg = host.children[0];
  const texts = svg.children.filter((c) => c.tag === 'text' && c.textContent);
  const line = svg.children.find((c) => c.tag === 'polyline').attrs.points.split(' ').map((p) => p.split(',').map(Number));
  return { texts, line };
}

for (const width of [362, 460, 760]) {
  test(`no chart label overprints another at ${width} px`, () => {
    const { texts } = drawSoc(width);
    const boxes = texts.map(textBox);
    assert.ok(boxes.some((b) => b.text === 'state of charge'), 'y-axis title drawn');
    assert.ok(boxes.some((b) => b.text === '1'), 'top tick drawn');
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        assert.ok(!overlap(boxes[i], boxes[j]), `'${boxes[i].text}' overlaps '${boxes[j].text}'`);
      }
    }
  });

  test(`the min-SOC label crosses no part of the curve at ${width} px`, () => {
    const { texts, line } = drawSoc(width);
    const { segHitsBox } = loadChart();
    const mark = textBox(texts.find((t) => t.textContent === 'min SOC 0.0500'));
    const hit = line.some((p, i) => i > 0 && segHitsBox(line[i - 1], p, mark));
    assert.equal(hit, false, `label box ${JSON.stringify(mark)} crosses the SOC curve`);
  });
}

test('the old fixed up-right spot did cross the recharge curve (the failure shape)', () => {
  const { texts, line } = drawSoc(362);
  const { segHitsBox } = loadChart();
  assert.ok(texts.find((t) => t.textContent === 'min SOC 0.0500'));
  // Rebuild the pre-fix box from the dot: the circle sits where the trace bottoms out.
  const low = line.reduce((m, p) => (p[1] > m[1] ? p : m), line[0]);
  const old = textBox({ textContent: 'min SOC 0.0500', attrs: { x: low[0] + 7, y: low[1] - 6 } });
  assert.equal(line.some((p, i) => i > 0 && segHitsBox(line[i - 1], p, old)), true);
});

test('placeMarkLabel stays inside the plot and reports when nothing is clear', () => {
  const { placeMarkLabel } = loadChart();
  const plot = { l: 44, r: 300, t: 22, b: 184 };
  const at = placeMarkLabel({ px: 298, py: 100, text: 'min SOC 0.0500', plot, lines: [] });
  const box = textBox({ textContent: 'min SOC 0.0500', attrs: { x: at.x, y: at.y, 'text-anchor': at.anchor } });
  assert.ok(box.x1 <= plot.r && box.x0 >= plot.l, 'a point at the right edge keeps its label inside the plot');
  assert.equal(at.clear, true);
  const wall = [];
  for (let y = 22; y <= 184; y += 2) wall.push([44, y], [300, y]);
  const blocked = placeMarkLabel({ px: 150, py: 100, text: 'x', plot, lines: [wall] });
  assert.equal(blocked.clear, false);
});

for (const width of [362, 460, 760]) {
  test(`on a three-day loop the min-SOC label crosses no curve and no label at ${width} px`, () => {
    const { texts, line } = drawSoc(width, multiDayTrace);
    const { segHitsBox } = loadChart();
    const boxes = texts.map(textBox);
    const mark = boxes.find((b) => b.text === 'min SOC 0.0500');
    assert.ok(mark, 'the label is drawn');
    assert.equal(line.some((p, i) => i > 0 && segHitsBox(line[i - 1], p, mark)), false, `label box ${JSON.stringify(mark)} crosses the SOC curve`);
    for (const other of boxes) if (other !== mark) assert.ok(!overlap(mark, other), `'${mark.text}' overlaps '${other.text}'`);
  });
}

test('with no clear spot beside the dot the label sits in the strip above the plot, keyed by a dot', () => {
  const { linePlot } = loadChart();
  const host = { clientWidth: 362, innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
  const xs = []; const ys = [];
  // A dense zig-zag fills the plot, so every spot beside the minimum is crossed.
  for (let i = 0; i <= 400; i++) { xs.push(i / 10); ys.push(i % 2 ? 1 : (i === 200 ? 0 : 0.02)); }
  linePlot(host, { series: [{ name: 'SOC', color: '#36c', xs, ys }], xLabel: 'h', yLabel: 'state of charge', height: 210, y0: 0, y1: 1,
    mark: { x: 20, y: 0, color: '#d33', label: 'min SOC 0.0000' } });
  const svg = host.children[0];
  const label = svg.children.find((c) => c.tag === 'text' && c.textContent === 'min SOC 0.0000');
  assert.equal(label.attrs['text-anchor'], 'end');
  assert.equal(Number(label.attrs.y), 11, 'in the strip above the plot');
  const keys = svg.children.filter((c) => c.tag === 'circle' && c.attrs.fill === '#d33');
  assert.equal(keys.length, 2, 'the point and the key dot beside the label');
});
