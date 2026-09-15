/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the breadboard view on an SVG: a full-size
 *                     |                             | board (63 columns, rows a–e / f–j, two rails top and bottom)
 *                     |                             | drawn hole by hole, every placed part as a body over its
 *                     |                             | footprint with its legs in the holes, jumpers as arcs
 *                     |                             | between holes; drag a part to another anchor hole (refused
 *                     |                             | where a leg would share a hole), click one hole then another
 *                     |                             | to add a jumper, click a jumper and Delete to remove it. Every
 *                     |                             | edit hands the whole board to the page, which asks the server
 *                     |                             | to derive the schematic's wires from it. Exposed as
 *                     |                             | window.CircuitLabBoard; the geometry and nets come from
 *                     |                             | circuit-lab-board-model.js.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B2: the board is drawn to scale (the model's BB830 row
 *                     |                             | geometry: the rails two pitches out, rows e and f 0.3" apart);
 *                     |                             | a jumper is a straight wire at its physical span, the selected
 *                     |                             | one labelled in mm and the total under the board; click a part
 *                     |                             | and press R to turn it a quarter clockwise about its first leg
 *                     |                             | (a vertical footprint), refused for a DIP or where it does not
 *                     |                             | fit; a part the board shorts (two of its legs on one strip) is
 *                     |                             | named under the board.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const M = window.CircuitLabBoardModel;
  const PITCH = 14, X0 = 24, Y0 = 16, WIDTH = 960, BOARD_H = 270, HEIGHT = 288;
  // to scale: every row where the model's physical geometry puts it (14 px per 0.1 inch)
  const ROW_Y = Object.fromEntries(Object.entries(M.ROW_PITCH).map(([row, k]) => [row, Y0 + k * PITCH]));
  const COLORS = ['#e5534b', '#3fb950', '#4f8cff', '#d29922', '#b57bee', '#39c5cf', '#ff8ac2'];
  const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v))); return n; };
  const x = (col) => X0 + (col - 1) * PITCH;
  // selection: { kind: 'jumper' | 'part', id } | null
  const state = { svg: null, board: null, parts: [], contract: null, handlers: {}, active: false, selection: null, pending: null, drag: null, nodes: new Map() };
  const isSel = (kind, id) => !!state.selection && state.selection.kind === kind && state.selection.id === id;
  const mm = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' mm';

  const holeXY = (id) => { const h = M.parseHole(id); return h ? [x(h.col), ROW_Y[h.row]] : null; };
  function svgPoint(e) { const pt = state.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = state.svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : pt; }
  /** The hole nearest a canvas point, or null off the board. */
  function holeAt(px, py) {
    const col = Math.round((px - X0) / PITCH) + 1;
    if (col < 1 || col > M.COLS) return null;
    let best = null, dist = 1e9;
    for (const [row, y] of Object.entries(ROW_Y)) { const d = Math.abs(y - py); if (d < dist) { dist = d; best = row; } }
    return dist <= PITCH ? { row: best, col } : null;
  }
  const rowIndex = (row) => Object.keys(ROW_Y).indexOf(row);

  function render() {
    const svg = state.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    state.nodes.clear();
    svg.appendChild(svgEl('rect', { x: 4, y: 4, width: WIDTH - 8, height: BOARD_H - 8, rx: 6, class: 'bboard' }));
    for (const [r0, r1] of [['T+', 'T-'], ['a', 'e'], ['f', 'j'], ['B+', 'B-']]) svg.appendChild(svgEl('rect', { x: 10, y: ROW_Y[r0] - 8, width: WIDTH - 20, height: ROW_Y[r1] - ROW_Y[r0] + 16, rx: 3, class: 'bblock' }));
    svg.appendChild(svgEl('line', { x1: 10, y1: (ROW_Y.e + ROW_Y.f) / 2, x2: WIDTH - 10, y2: (ROW_Y.e + ROW_Y.f) / 2, class: 'bgap' }));
    const pendingStrip = state.pending ? M.stripOf(state.pending) : null;
    const holes = svgEl('g'); svg.appendChild(holes);
    for (const [row, y] of Object.entries(ROW_Y)) {
      if (/^[a-j]$/.test(row)) { const t = svgEl('text', { x: 10, y: y + 3, class: 'brow' }); t.textContent = row; svg.appendChild(t); }
      else { const t = svgEl('text', { x: 10, y: y + 3, class: 'brow rail' }); t.textContent = row.endsWith('+') ? '+' : '−'; svg.appendChild(t); }
      for (let col = 1; col <= M.COLS; col += 1) {
        const id = M.holeId(row, col);
        const c = svgEl('circle', { cx: x(col), cy: y, r: 3, class: 'hole' + (pendingStrip && M.stripOf(id) === pendingStrip ? ' lit' : '') + (state.pending === id ? ' pending' : ''), 'data-hole': id });
        c.addEventListener('pointerdown', (e) => { e.stopPropagation(); holeClick(id); });
        holes.appendChild(c);
      }
    }
    for (let col = 1; col <= M.COLS; col += 5) { const t = svgEl('text', { x: x(col), y: (ROW_Y['T-'] + ROW_Y.a) / 2 + 3, class: 'bcol', 'text-anchor': 'middle' }); t.textContent = col; svg.appendChild(t); }
    renderJumpers(svg);
    const layer = svgEl('g'); svg.appendChild(layer);
    for (const part of state.parts) {
      const pl = state.board.placements[part.id];
      const pins = M.footprintHoles(part, pl); if (!pins) continue;
      const g = svgEl('g', { class: 'bpart', 'data-part': part.id });
      const xs = Object.values(pins).map((h) => holeXY(h)[0]), ys = Object.values(pins).map((h) => holeXY(h)[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const upright = !M.DIP_FOOTPRINTS[part.type] && y1 - y0 > x1 - x0;
      if (isSel('part', part.id)) g.setAttribute('class', 'bpart selected');
      if (M.DIP_FOOTPRINTS[part.type]) { g.appendChild(svgEl('rect', { x: x0 - 7, y: y0 - 6, width: x1 - x0 + 14, height: y1 - y0 + 12, rx: 3, class: 'bbody dip' })); g.appendChild(svgEl('circle', { cx: x0 - 2, cy: y0 - 1, r: 2, class: 'bnotch' })); }
      else if (part.type === 'ground') g.appendChild(svgEl('path', { d: `M${x0 - 6} ${y0 - 9} H${x0 + 6} L${x0} ${y0 - 2} Z`, class: 'bbody gnd' }));
      else if (part.type === 'led') g.appendChild(svgEl('circle', { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: 7, class: 'bbody led ' + (part.props.color || 'red') }));
      else if (upright) g.appendChild(svgEl('rect', { x: x0 - 5, y: y0 - 6, width: 10, height: y1 - y0 + 12, rx: 4, class: 'bbody ' + part.type }));
      else g.appendChild(svgEl('rect', { x: x0 - 6, y: y0 - 5, width: x1 - x0 + 12, height: 10, rx: 4, class: 'bbody ' + part.type }));
      const label = upright ? svgEl('text', { x: x0 + 9, y: (y0 + y1) / 2 + 3, 'text-anchor': 'start', class: 'blabel' }) : svgEl('text', { x: (x0 + x1) / 2, y: (M.DIP_FOOTPRINTS[part.type] ? (y0 + y1) / 2 + 3 : y0 - 10), 'text-anchor': 'middle', class: 'blabel' });
      label.textContent = part.id; g.appendChild(label);
      Object.entries(pins).forEach(([pin, hole]) => { const [hx, hy] = holeXY(hole); const leg = svgEl('circle', { cx: hx, cy: hy, r: 3.2, class: 'leg' }); leg.appendChild(svgEl('title')).textContent = `${part.id}.${pin} in ${hole} (strip ${M.stripOf(hole)})`; g.appendChild(leg); });
      g.addEventListener('pointerdown', (e) => startDrag(e, part, pl));
      layer.appendChild(g);
      state.nodes.set(part.id, g);
    }
    const unplaced = state.parts.filter((p) => M.isBoardType(p.type) && !state.board.placements[p.id]);
    const shorted = M.shortedParts(state.board, state.parts).map((s) => `${s.part} is shorted: ${s.pins.join(' and ')} share strip ${s.strip}`);
    const warn = [state.board.stale || (unplaced.length ? 'not on the board: ' + unplaced.map((p) => p.id).join(', ') : '')].concat(shorted).filter(Boolean).join(' · ');
    if (warn) { const t = svgEl('text', { x: WIDTH - 12, y: HEIGHT - 6, 'text-anchor': 'end', class: 'bwarn' }); t.textContent = warn; svg.appendChild(t); }
  }

  /** Jumpers as the straight wires they are, at their physical span; the selected one says its length in mm, the total sits under the board. */
  function renderJumpers(svg) {
    const layer = svgEl('g'); svg.appendChild(layer);
    let total = 0, longest = 0;
    (state.board.jumpers || []).forEach((j, i) => {
      const a = holeXY(j.from), b = holeXY(j.to); if (!a || !b) return;
      const len = M.jumperLengthMm(j.from, j.to); total += len; longest = Math.max(longest, len);
      const p = svgEl('path', { d: `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`, class: 'jumper' + (isSel('jumper', j.id) ? ' selected' : ''), stroke: COLORS[i % COLORS.length], 'data-jumper': j.id, 'data-mm': len.toFixed(2) });
      p.appendChild(svgEl('title')).textContent = `${j.id}: ${j.from} to ${j.to}, ${mm(len)} of wire`;
      p.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ kind: 'jumper', id: j.id }); });
      layer.appendChild(p);
      if (isSel('jumper', j.id)) { const t = svgEl('text', { x: (a[0] + b[0]) / 2 + 4, y: (a[1] + b[1]) / 2 - 5, class: 'jlen' }); t.textContent = mm(len); layer.appendChild(t); }
    });
    const n = (state.board.jumpers || []).length;
    const sum = svgEl('text', { x: 12, y: HEIGHT - 6, class: 'bsum' }); sum.textContent = n ? `${n} jumper${n === 1 ? '' : 's'} · ${mm(total)} of wire · longest ${mm(longest)}` : 'no jumpers';
    svg.appendChild(sum);
  }

  function select(sel) { state.selection = sel; state.pending = null; render(); if (state.handlers.onSelect) state.handlers.onSelect(sel); }
  function holeClick(id) {
    if (!state.pending) { state.selection = null; state.pending = id; render(); return; }
    const from = state.pending; state.pending = null;
    if (from === id || M.stripOf(from) === M.stripOf(id)) { render(); return; }
    const jumpers = state.board.jumpers.slice();
    let n = 1; while (jumpers.some((j) => j.id === 'j' + n)) n += 1;
    jumpers.push({ id: 'j' + n, from, to: id });
    emit({ placements: state.board.placements, jumpers });
  }
  function emit(board) {
    try { const valid = M.validateBoard(board, state.parts); state.board = valid; render(); if (state.handlers.onChange) state.handlers.onChange(valid); }
    catch (e) { render(); if (state.handlers.onError) state.handlers.onError(e.message); }
  }

  function startDrag(e, part, pl) {
    e.stopPropagation();
    const p = svgPoint(e), hole = holeAt(p.x, p.y);
    state.pending = null; state.selection = null;
    state.drag = { part, from: pl, dcol: hole ? hole.col - pl.col : 0, drow: hole ? rowIndex(hole.row) - rowIndex(pl.row) : 0, moved: false, target: null, sx: p.x, sy: p.y };
    try { state.svg.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
  }
  function onMove(e) {
    if (!state.drag) return;
    const p = svgPoint(e), d = state.drag;
    if (Math.abs(p.x - d.sx) > 3 || Math.abs(p.y - d.sy) > 3) d.moved = true;
    const node = state.nodes.get(d.part.id);
    if (node) node.setAttribute('transform', `translate(${p.x - d.sx} ${p.y - d.sy})`);
    const hole = holeAt(p.x, p.y);
    if (!hole) { d.target = null; return; }
    const rows = Object.keys(ROW_Y);
    const rowIx = rowIndex(hole.row) - d.drow;
    d.target = rowIx >= 0 && rowIx < rows.length ? { col: hole.col - d.dcol, row: M.DIP_FOOTPRINTS[d.part.type] ? 'e' : rows[rowIx] } : null;
  }
  function onUp() {
    const d = state.drag; if (!d) return; state.drag = null;
    if (!d.moved) { select({ kind: 'part', id: d.part.id }); return; }
    if (!d.target) { render(); return; }
    const target = Object.assign({}, d.target, d.from && d.from.rot ? { rot: d.from.rot } : {});
    emit({ placements: Object.assign({}, state.board.placements, { [d.part.id]: target }), jumpers: state.board.jumpers });
  }
  function onKey(e) {
    if (!state.active || (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'r' || e.key === 'R') rotateSelected();
    else if (e.key === 'Escape') { state.pending = null; state.selection = null; render(); }
  }
  function deleteSelected() {
    if (!state.selection || state.selection.kind !== 'jumper') return;
    const jumpers = state.board.jumpers.filter((j) => j.id !== state.selection.id);
    state.selection = null;
    emit({ placements: state.board.placements, jumpers });
  }
  /** Turn the selected part a quarter clockwise about its first leg; the model refuses a DIP, an overlap or a leg off the board. */
  function rotateSelected() {
    if (!state.selection || state.selection.kind !== 'part') return;
    const pl = state.board.placements[state.selection.id]; if (!pl) return;
    const turned = Object.assign({}, pl, { rot: ((pl.rot || 0) + 90) % 360 });
    if (!turned.rot) delete turned.rot;
    emit({ placements: Object.assign({}, state.board.placements, { [state.selection.id]: turned }), jumpers: state.board.jumpers });
  }

  function init(svg, handlers) {
    state.svg = svg; state.handlers = handlers || {};
    svg.addEventListener('pointermove', onMove); svg.addEventListener('pointerup', onUp); svg.addEventListener('pointerleave', onUp);
    svg.addEventListener('pointerdown', () => { if (state.pending || state.selection) { state.pending = null; state.selection = null; render(); if (state.handlers.onSelect) state.handlers.onSelect(null); } });
    document.addEventListener('keydown', onKey);
  }
  /** Take the design's board; a pending hole click survives a re-render (the page re-renders after every save and poll). */
  function setBoard(board, parts, contract) {
    state.board = board ? { placements: Object.assign({}, board.placements), jumpers: (board.jumpers || []).map((j) => Object.assign({}, j)), stale: board.stale } : { placements: {}, jumpers: [] };
    state.parts = parts.slice(); state.contract = contract; state.drag = null;
    const sel = state.selection;
    if (sel && !(sel.kind === 'jumper' ? state.board.jumpers.some((j) => j.id === sel.id) : !!state.board.placements[sel.id])) state.selection = null;
    render();
  }
  function setActive(on) { state.active = !!on; }
  function board() { return { placements: Object.assign({}, state.board.placements), jumpers: state.board.jumpers.map((j) => Object.assign({}, j)) }; }

  window.CircuitLabBoard = { init, setBoard, setActive, deleteSelected, rotateSelected, board, selection: () => state.selection, holeAt, ROW_Y, PITCH, X0 };
})();
