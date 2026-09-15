/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the breadboard as a model shared by the
 *                     |                             | surface (window.CircuitLabBoardModel) and the routes / tests
 *                     |                             | (module.exports): a full-size board (63 columns, rows a–e and
 *                     |                             | f–j, two power rails top and bottom), every hole's STRIP,
 *                     |                             | every part type's FOOTPRINT (which hole each pin sits in
 *                     |                             | relative to its anchor; DIP-8 parts straddle the gap on the
 *                     |                             | real pinout), the nets a board implies (strips joined by
 *                     |                             | jumpers), the nets the schematic implies (pins joined by
 *                     |                             | wires), their equality, the wires regenerated from a board,
 *                     |                             | the jumpers regenerated from a schematic, an automatic
 *                     |                             | layout, and the reconciliation that keeps a saved board in
 *                     |                             | step with every schematic edit. Pure: no DOM, no I/O.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B2: a placement may turn (`rot` 0 / 90 / 180 / 270,
 *                     |                             | clockwise) — a vertical footprint steps its legs down the rows
 *                     |                             | (a resistor across the gap from row c lands in c and f); a DIP
 *                     |                             | is refused a turn. The board's physical geometry (the BB830
 *                     |                             | pattern: every row on the 0.1" grid, the rails two pitches out
 *                     |                             | from rows a / j, rows e and f 0.3" apart across the channel) gives
 *                     |                             | a jumper's straight span in mm; a part with two of its own legs
 *                     |                             | on one strip is reported as shorted by the board.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.CircuitLabBoardModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const COLS = 63;
  const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'], BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'], RAILS = ['T+', 'T-', 'B+', 'B-'];
  const ROWS = TOP_ROWS.concat(BOTTOM_ROWS);
  /** Every row top to bottom: a turned footprint's legs step along this list. */
  const V_ORDER = ['T+', 'T-'].concat(TOP_ROWS, BOTTOM_ROWS, ['B+', 'B-']);
  /**
   * Where each row sits across the board, in hole pitches from the top rail. This is the BB830 830-point
   * pattern as BusBoard's SB830 datasheet (BPS-MAR-(SB830)-001 Rev 4.00) draws it at actual size — "the same
   * pattern as a standard 830 connection point BB830", so jumpers transfer "without recutting wires": all 18
   * rows of holes on the 0.1" grid, a spare row between each rail pair and rows a / j, two between e and f
   * (the 0.3" DIP channel). The breadboard itself has no holes on the spare rows.
   */
  const ROW_PITCH = { 'T+': 0, 'T-': 1, a: 3, b: 4, c: 5, d: 6, e: 7, f: 10, g: 11, h: 12, i: 13, j: 14, 'B+': 16, 'B-': 17 };
  /** One hole pitch, 0.1 inch. */
  const PITCH_MM = 2.54;
  const PLACEMENT_ROTATIONS = [0, 90, 180, 270];
  /** Row parts: the pins in order along the columns and the column offset of each (0 = the anchor). */
  const ROW_FOOTPRINTS = {
    resistor: [['a', 0], ['b', 3]], capacitor: [['a', 0], ['b', 2]], inductor: [['a', 0], ['b', 3]], diode: [['a', 0], ['k', 3]], led: [['a', 0], ['k', 1]], zener: [['a', 0], ['k', 3]], lamp: [['a', 0], ['b', 2]],
    switch: [['a', 0], ['b', 2]], battery: [['+', 0], ['-', 2]], source: [['+', 0], ['-', 2]], potentiometer: [['a', 0], ['w', 1], ['b', 2]], npn: [['c', 0], ['b', 1], ['e', 2]], nmos: [['g', 0], ['d', 1], ['s', 2]],
    regulator: [['in', 0], ['gnd', 1], ['out', 2]], relay: [['c+', 0], ['c-', 1], ['com', 2], ['no', 3], ['nc', 4]], sequencer: [['out', 0], ['ref', 1]], hbridge: [['vcc', 0], ['gnd', 1], ['in1', 2], ['in2', 3], ['out1', 4], ['out2', 5]],
    stepdriver: [['vm', 0], ['gnd', 1], ['step', 2], ['dir', 3], ['a+', 4], ['a-', 5], ['b+', 6], ['b-', 7]], motor: [['+', 0], ['-', 1]], servo: [['sig', 0], ['v+', 1], ['gnd', 2]], stepper: [['a+', 0], ['a-', 1], ['b+', 2], ['b-', 3]],
    ground: [['gnd', 0]], junction: [['n', 0]],
    arduino: [['5V', 0], ['GND', 1], ['D2', 2], ['D3', 3], ['D4', 4], ['D5', 5], ['D6', 6], ['D7', 7], ['D8', 8], ['D9', 9], ['D10', 10], ['D11', 11], ['D12', 12], ['D13', 13], ['A0', 14], ['A1', 15], ['A2', 16], ['A3', 17], ['A4', 18], ['A5', 19]],
  };
  /** DIP-8 parts straddle the centre gap: DIP pin number → our pin name (pins 1–4 on row e, 8–5 on row f, left to right). */
  const DIP_FOOTPRINTS = { timer555: { 1: 'gnd', 2: 'trig', 3: 'out', 6: 'thr', 7: 'dis', 8: 'vcc' }, opamp: { 2: '-', 3: '+', 4: 'vee', 6: 'out', 7: 'vcc' } };
  const BOARD_TYPES = Object.keys(ROW_FOOTPRINTS).concat(Object.keys(DIP_FOOTPRINTS));

  const holeId = (row, col) => row + col;
  function parseHole(id) {
    const m = /^([a-j]|[TB][+-])(\d{1,2})$/.exec(String(id || ''));
    if (!m) return null;
    const col = Number(m[2]);
    if (col < 1 || col > COLS) return null;
    return { row: m[1], col };
  }
  /** The strip a hole belongs to: five holes of one column in a block, or a whole rail. */
  function stripOf(id) {
    const h = parseHole(id); if (!h) return null;
    if (RAILS.includes(h.row)) return 'rail:' + h.row;
    return (TOP_ROWS.includes(h.row) ? 't' : 'b') + h.col;
  }
  const isBoardType = (type) => Object.prototype.hasOwnProperty.call(ROW_FOOTPRINTS, type) || Object.prototype.hasOwnProperty.call(DIP_FOOTPRINTS, type);
  /** Width in columns a part's footprint spans. */
  function footprintWidth(type) { if (DIP_FOOTPRINTS[type]) return 4; const f = ROW_FOOTPRINTS[type]; return f ? f[f.length - 1][1] + 1 : 0; }

  /**
   * @description The hole of every electrical pin of a placed part, or null when the placement is off the
   * board. A row part's legs run along its row from the anchor (rot 0), down the rows (90), back along the
   * row (180) or up the rows (270); a DIP always straddles the gap unturned.
   */
  function footprintHoles(part, placement) {
    if (!placement || !isBoardType(part.type)) return null;
    const out = {}, rot = placement.rot || 0;
    if (!PLACEMENT_ROTATIONS.includes(rot)) return null;
    if (DIP_FOOTPRINTS[part.type]) {
      if (rot || placement.col < 1 || placement.col + 3 > COLS) return null;
      const map = DIP_FOOTPRINTS[part.type];
      for (let n = 1; n <= 8; n += 1) { const pin = map[n]; const col = placement.col + (n <= 4 ? n - 1 : 8 - n); const row = n <= 4 ? 'e' : 'f'; if (pin) out[pin] = holeId(row, col); }
      return out;
    }
    const row = placement.row, v = V_ORDER.indexOf(row);
    if (v < 0) return null;
    for (const [pin, off] of ROW_FOOTPRINTS[part.type]) {
      const col = placement.col + (rot === 0 ? off : rot === 180 ? -off : 0);
      const k = v + (rot === 90 ? off : rot === 270 ? -off : 0);
      if (col < 1 || col > COLS || k < 0 || k >= V_ORDER.length) return null;
      out[pin] = holeId(V_ORDER[k], col);
    }
    return out;
  }

  /** @description A hole's position on the board in pitches: [column, row] from the top-left hole of the top rail. */
  function holePitch(id) { const h = parseHole(id); return h ? [h.col - 1, ROW_PITCH[h.row]] : null; }
  /**
   * @description The straight span of a jumper between two holes, in mm — the length a pre-cut jumper is
   * sold by and the length the board view draws it at.
   */
  function jumperLengthMm(from, to) { const a = holePitch(from), b = holePitch(to); return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) * PITCH_MM : null; }
  /**
   * @description Parts the board itself shorts: two legs of one part on one strip (a vertical resistor inside
   * a block, a horizontal one on a rail). The nets say it too; this names it.
   * @returns {Array<{part: string, pins: string[], strip: string}>}
   */
  function shortedParts(board, parts) {
    const out = [];
    for (const part of parts) {
      const holes = footprintHoles(part, board.placements[part.id]); if (!holes) continue;
      const byStrip = new Map();
      for (const [pin, hole] of Object.entries(holes)) { const s = stripOf(hole); if (!byStrip.has(s)) byStrip.set(s, []); byStrip.get(s).push(pin); }
      for (const [strip, pins] of byStrip) if (pins.length > 1) out.push({ part: part.id, pins, strip });
    }
    return out;
  }

  /**
   * @description Validate a board against the parts: placements name existing board-type parts on real
   * holes with no two pins in one hole; jumpers join two different real holes. Throws {field, message}.
   */
  function validateBoard(board, parts) {
    const fail = (message, field) => { const e = new Error(message); e.field = field; throw e; };
    if (!board || typeof board !== 'object' || Array.isArray(board)) fail('board must be an object', 'board');
    const placements = board.placements && typeof board.placements === 'object' && !Array.isArray(board.placements) ? board.placements : fail('board.placements must be an object', 'board.placements');
    const byId = new Map(parts.map((p) => [p.id, p]));
    const occupied = new Map();
    const outPlacements = {};
    for (const [pid, pl] of Object.entries(placements)) {
      const part = byId.get(pid);
      if (!part) fail(`placement for unknown part ${pid}`, `board.placements.${pid}`);
      if (!isBoardType(part.type)) fail(`${part.type} ${pid} has no breadboard footprint`, `board.placements.${pid}`);
      if (!pl || typeof pl !== 'object' || !Number.isInteger(pl.col) || typeof pl.row !== 'string') fail('a placement is {col, row, rot?}', `board.placements.${pid}`);
      const rot = pl.rot === undefined || pl.rot === null ? 0 : pl.rot;
      if (!PLACEMENT_ROTATIONS.includes(rot)) fail('rot must be 0, 90, 180 or 270 (clockwise)', `board.placements.${pid}.rot`);
      if (rot && DIP_FOOTPRINTS[part.type]) fail(`${pid} is a DIP: it straddles the gap and is not turned`, `board.placements.${pid}.rot`);
      const holes = footprintHoles(part, pl);
      if (!holes) fail(`${pid} does not fit at ${pl.row}${pl.col}`, `board.placements.${pid}`);
      for (const [pin, hole] of Object.entries(holes)) { if (occupied.has(hole)) fail(`${pid}.${pin} and ${occupied.get(hole)} share hole ${hole}`, `board.placements.${pid}`); occupied.set(hole, pid + '.' + pin); }
      outPlacements[pid] = Object.assign({ col: pl.col, row: DIP_FOOTPRINTS[part.type] ? 'e' : pl.row }, rot ? { rot } : {});
    }
    const jumpers = Array.isArray(board.jumpers) ? board.jumpers : fail('board.jumpers must be a list', 'board.jumpers');
    const outJumpers = [];
    const ids = new Set();
    jumpers.forEach((j, i) => {
      if (!j || typeof j !== 'object') fail('a jumper is {id, from, to}', `board.jumpers[${i}]`);
      const from = parseHole(j.from), to = parseHole(j.to);
      if (!from) fail(`jumper ${i} from is not a hole`, `board.jumpers[${i}].from`);
      if (!to) fail(`jumper ${i} to is not a hole`, `board.jumpers[${i}].to`);
      if (j.from === j.to) fail('a jumper joins two different holes', `board.jumpers[${i}]`);
      const id = typeof j.id === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(j.id) ? j.id : 'j' + (i + 1);
      if (ids.has(id)) fail(`duplicate jumper id ${id}`, `board.jumpers[${i}].id`);
      ids.add(id);
      outJumpers.push({ id, from: j.from, to: j.to });
    });
    return { placements: outPlacements, jumpers: outJumpers };
  }

  class UnionFind {
    constructor() { this.parent = new Map(); }
    find(k) { if (!this.parent.has(k)) this.parent.set(k, k); let p = this.parent.get(k); while (p !== k) { const gp = this.parent.get(p); this.parent.set(k, gp); k = p; p = gp; } return k; }
    union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(rb, ra); }
  }
  const electricalPins = (parts, contract) => parts.flatMap((p) => (contract.parts[p.type] ? contract.parts[p.type].pins : []).filter((pin) => pin.kind === 'electrical').map((pin) => p.id + '.' + pin.name));
  /** A partition as a canonical sorted list of sorted groups (singletons included). */
  function partition(pins, uf) {
    const groups = new Map();
    for (const pin of pins) { const r = uf.find(pin); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(pin); }
    return Array.from(groups.values()).map((g) => g.slice().sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  /** @description The nets the schematic's electrical wires imply. */
  function wireNets(parts, wires, contract) {
    const uf = new UnionFind();
    const pins = electricalPins(parts, contract);
    pins.forEach((p) => uf.find(p));
    const kinds = new Map(parts.map((p) => [p.id, p.type]));
    for (const w of wires) { const a = w.from.part + '.' + w.from.pin, b = w.to.part + '.' + w.to.pin; const spec = contract.parts[kinds.get(w.from.part)]; const pk = spec && spec.pins.find((x) => x.name === w.from.pin); if (pk && pk.kind === 'electrical') uf.union(a, b); }
    return partition(pins, uf);
  }
  /** @description The nets the board implies: pins on one strip share it, jumpers join strips; unplaced pins stand alone. */
  function boardNets(board, parts, contract) {
    const uf = new UnionFind();
    const pins = electricalPins(parts, contract);
    pins.forEach((p) => uf.find(p));
    for (const part of parts) {
      const holes = footprintHoles(part, board.placements[part.id]);
      if (!holes) continue;
      for (const [pin, hole] of Object.entries(holes)) uf.union(part.id + '.' + pin, 'strip:' + stripOf(hole));
    }
    for (const j of board.jumpers) uf.union('strip:' + stripOf(j.from), 'strip:' + stripOf(j.to));
    return partition(pins, uf);
  }
  const sameNets = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** @description Electrical wires regenerated from the board's nets (mechanical wires kept; an existing wire that still joins one net keeps its id). */
  function wiresFromBoard(board, parts, wires, contract) {
    const nets = boardNets(board, parts, contract);
    const netOf = new Map(); nets.forEach((g, i) => g.forEach((pin) => netOf.set(pin, i)));
    const kinds = new Map(parts.map((p) => [p.id, p.type]));
    const isElectrical = (w) => { const spec = contract.parts[kinds.get(w.from.part)]; const pk = spec && spec.pins.find((x) => x.name === w.from.pin); return !!pk && pk.kind === 'electrical'; };
    const kept = wires.filter((w) => !isElectrical(w) || netOf.get(w.from.part + '.' + w.from.pin) === netOf.get(w.to.part + '.' + w.to.pin));
    const uf = new UnionFind();
    kept.filter(isElectrical).forEach((w) => uf.union(w.from.part + '.' + w.from.pin, w.to.part + '.' + w.to.pin));
    const used = new Set(kept.map((w) => w.id));
    let n = 1; const mint = () => { while (used.has('w' + n)) n += 1; used.add('w' + n); return 'w' + n; };
    const out = kept.slice();
    for (const group of nets) {
      if (group.length < 2) continue;
      for (let i = 1; i < group.length; i += 1) {
        if (uf.find(group[i]) === uf.find(group[0])) continue;
        uf.union(group[0], group[i]);
        const [ap, apin] = split(group[0]), [bp, bpin] = split(group[i]);
        out.push({ id: mint(), from: { part: ap, pin: apin }, to: { part: bp, pin: bpin } });
      }
    }
    return out;
  }
  function split(pinKey) { const i = pinKey.indexOf('.'); return [pinKey.slice(0, i), pinKey.slice(i + 1)]; }

  /** Holes of a strip, left to right / top to bottom. */
  function stripHoles(strip) {
    if (strip.startsWith('rail:')) { const rail = strip.slice(5); return Array.from({ length: COLS }, (_, i) => holeId(rail, i + 1)); }
    const rows = strip[0] === 't' ? TOP_ROWS : BOTTOM_ROWS; const col = Number(strip.slice(1));
    return rows.map((r) => holeId(r, col));
  }
  /** @description Jumpers regenerated from the schematic's nets over the existing placements (a chain per net through its strips). */
  function jumpersFromNets(board, parts, wires, contract) {
    const nets = wireNets(parts, wires, contract);
    const holeOfPin = new Map();
    for (const part of parts) { const holes = footprintHoles(part, board.placements[part.id]); if (holes) for (const [pin, hole] of Object.entries(holes)) holeOfPin.set(part.id + '.' + pin, hole); }
    const taken = new Set(holeOfPin.values());
    const jumpers = []; let n = 1;
    const free = (strip) => { const h = stripHoles(strip).find((x) => !taken.has(x)); if (h) taken.add(h); return h || stripHoles(strip)[0]; };
    for (const group of nets) {
      const strips = []; for (const pin of group) { const hole = holeOfPin.get(pin); if (!hole) continue; const s = stripOf(hole); if (!strips.includes(s)) strips.push(s); }
      for (let i = 1; i < strips.length; i += 1) jumpers.push({ id: 'j' + n++, from: free(strips[i - 1]), to: free(strips[i]) });
    }
    return jumpers;
  }

  /** @description Place every board-type part that has no placement: row parts along row b then row i, DIPs across the gap, grounds on the bottom − rail. Returns the placements, or null when the board is full. */
  function placeParts(parts, placements) {
    const out = Object.assign({}, placements);
    const occupied = new Set();
    for (const part of parts) { const holes = footprintHoles(part, out[part.id]); if (holes) Object.values(holes).forEach((h) => occupied.add(h)); }
    const fits = (part, pl) => { const holes = footprintHoles(part, pl); return holes && Object.values(holes).every((h) => !occupied.has(h)); };
    const take = (part, pl) => { out[part.id] = pl; Object.values(footprintHoles(part, pl)).forEach((h) => occupied.add(h)); };
    for (const part of parts) {
      if (out[part.id] || !isBoardType(part.type)) continue;
      const width = footprintWidth(part.type);
      const candidates = [];
      if (part.type === 'ground') for (let c = 1; c <= COLS; c += 1) candidates.push({ row: 'B-', col: c });
      else if (DIP_FOOTPRINTS[part.type]) for (let c = 2; c + 3 <= COLS - 1; c += 1) candidates.push({ row: 'e', col: c });
      else for (const row of ['b', 'i']) for (let c = 2; c + width <= COLS; c += 1) candidates.push({ row, col: c });
      const spot = candidates.find((pl) => fits(part, pl) && (part.type === 'ground' || DIP_FOOTPRINTS[part.type] || gapAround(part, pl, occupied)));
      if (!spot) return null;
      take(part, spot);
    }
    return out;
  }
  /** Keep one empty column between row parts so bodies do not touch. */
  function gapAround(part, pl, occupied) {
    const width = footprintWidth(part.type), rows = TOP_ROWS.includes(pl.row) ? TOP_ROWS : BOTTOM_ROWS;
    for (const c of [pl.col - 1, pl.col + width]) if (c >= 1 && c <= COLS && rows.some((r) => occupied.has(holeId(r, c)))) return false;
    return true;
  }

  /** @description A board laid out from scratch for the schematic (placements + jumpers), or null when it does not fit. */
  function autoLayout(parts, wires, contract) {
    const placements = placeParts(parts, {});
    if (!placements) return null;
    const board = { placements, jumpers: [] };
    board.jumpers = jumpersFromNets(board, parts, wires, contract);
    return board;
  }
  /**
   * @description Keep a saved board in step with the schematic: drop placements of parts that went, place
   * new parts, and regenerate the jumpers from the schematic's nets (placements are kept). `stale` is set
   * with a reason when a part could not be placed — the board then no longer implies the schematic's nets.
   */
  function reconcileBoard(board, parts, wires, contract) {
    const ids = new Set(parts.map((p) => p.id));
    const kept = {}; for (const [pid, pl] of Object.entries(board.placements || {})) if (ids.has(pid)) kept[pid] = pl;
    const placements = placeParts(parts, kept);
    if (!placements) return { placements: kept, jumpers: jumpersFromNets({ placements: kept, jumpers: [] }, parts, wires, contract), stale: 'the board is full: a part could not be placed' };
    const next = { placements, jumpers: [] };
    next.jumpers = jumpersFromNets(next, parts, wires, contract);
    return next;
  }

  return { COLS, TOP_ROWS, BOTTOM_ROWS, RAILS, ROWS, V_ORDER, ROW_PITCH, PITCH_MM, PLACEMENT_ROTATIONS, ROW_FOOTPRINTS, DIP_FOOTPRINTS, BOARD_TYPES, holeId, parseHole, stripOf, stripHoles, isBoardType, footprintWidth, footprintHoles, holePitch, jumperLengthMm, shortedParts, validateBoard, wireNets, boardNets, sameNets, wiresFromBoard, jumpersFromNets, placeParts, autoLayout, reconcileBoard };
});
