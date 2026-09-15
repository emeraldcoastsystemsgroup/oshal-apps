/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | A wire takes several bends (BACKLOG B9): a double-click on a wire
 *                     |                             | inserts a bend where it landed (the drawn corners become bend
 *                     |                             | points), a bend drags on the grid, a double-click on a bend
 *                     |                             | removes it; saved as the wire's `route.points`. R on a
 *                     |                             | multi-selection turns the group a quarter clockwise about its
 *                     |                             | centre (positions, rotations, the routes of wires inside it),
 *                     |                             | refused when a part would leave the canvas. The geometry is
 *                     |                             | circuit-lab-geometry.js, shared with the plain-node suite.
 *                     |                             | Keys act only while the schematic is showing: Delete or R in
 *                     |                             | the Breadboard view no longer reach a hidden selection.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Symbols for the torsion spring, the pulley (a `belt` pin and
 *                     |                             | dashed belt wires) and the crank-slider, whose crank, rod
 *                     |                             | and slider move from the solver's angle and x signals; every
 *                     |                             | shaft group turns by its cluster's angle signal.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Marquee multi-select (drag on empty canvas) with group move
 *                     |                             | and group delete; wires re-route by dragging their middle
 *                     |                             | segment (persisted as the wire's `route.mid`); symbols for
 *                     |                             | the servo (a horn that turns to the solved angle), the
 *                     |                             | stepper and the step/dir driver; rotors follow the solver's
 *                     |                             | angle(<id>) signal when it exists instead of integrating rpm.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A 1920 × 960 world with wheel zoom and shift/middle-drag pan
 *                     |                             | (the viewBox is the camera; every hit test goes through the
 *                     |                             | screen CTM so drops, drags and wires stay exact at any zoom);
 *                     |                             | symbols for the eight added parts with pin labels on the
 *                     |                             | multi-pin boxes; live values on the canvas at the timeline's
 *                     |                             | time (net voltage on every electrical wire, shaft rpm on
 *                     |                             | mechanical links, current under every sensed part) behind
 *                     |                             | one toggle; lamps glow with their power; a resetView.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Drag a part from the palette and drop it where it should sit
 *                     |                             | (HTML5 drop target on the canvas, snapped to the grid); addPart
 *                     |                             | takes an explicit position; click-to-add keeps the free-spot scan.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the schematic editor on an SVG: every part
 *                     |                             | type drawn as a symbol with its pins (electrical, shaft,
 *                     |                             | teeth) in the positions the contract names; drag to place on
 *                     |                             | a 20 px grid; click pin → pin to wire (same-kind check before
 *                     |                             | the server's); select a part or wire, Delete removes it, R
 *                     |                             | rotates; and after a run the canvas ANIMATES from the solved
 *                     |                             | waveforms: gears and motor rotors turn by the integrated
 *                     |                             | shaft speed, LEDs glow with their current, switches show
 *                     |                             | their state at the timeline's time. Every node is built
 *                     |                             | with createElementNS; exposed as window.CircuitLabCanvas.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const G = window.CircuitLabGeometry;
  const GRID = 20, WORLD = { w: 1920, h: 960 }, HOME = { x: 0, y: 0, w: 960, h: 480 };
  const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v))); return n; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const snap = (v) => Math.round(v / GRID) * GRID;
  const state = { svg: null, parts: [], wires: [], contract: null, handlers: {}, selection: null, multi: new Set(), pending: null, drag: null, wireDrag: null, bendDrag: null, marquee: null, pan: null, anim: null, layer: null, rubber: null, band: null, nodes: new Map(), wireNodes: new Map(), wireVals: new Map(), view: { ...HOME }, showValues: false };

  function gearRadius(part) { return clamp(10 + (Number(part.props.moduleMm) || 1) * (Number(part.props.teeth) || 20) * 0.6, 14, 56); }

  /** Local pin positions per type (before rotation). */
  function pinsOf(part) {
    switch (part.type) {
      case 'resistor': case 'capacitor': case 'inductor': case 'switch': case 'lamp': return { a: [-30, 0], b: [30, 0] };
      case 'diode': case 'led': case 'zener': return { a: [-30, 0], k: [30, 0] };
      case 'battery': case 'source': return { '+': [0, -30], '-': [0, 30] };
      case 'ground': return { gnd: [0, -16] };
      case 'junction': return { n: [0, 0] };
      case 'potentiometer': return { a: [-30, 0], w: [0, -26], b: [30, 0] };
      case 'npn': return { c: [0, -30], b: [-30, 0], e: [0, 30] };
      case 'nmos': return { d: [0, -30], g: [-30, 0], s: [0, 30] };
      case 'motor': return { '+': [0, -30], '-': [0, 30], shaft: [30, 0] };
      case 'gear': return { shaft: [0, 0], teeth: [0, -gearRadius(part)] };
      case 'load': return { shaft: [0, -20] };
      case 'regulator': return { in: [-30, 0], gnd: [0, 24], out: [30, 0] };
      case 'opamp': return { '+': [-30, -10], '-': [-30, 10], out: [30, 0], vcc: [0, -24], vee: [0, 24] };
      case 'relay': return { 'c+': [-30, -12], 'c-': [-30, 12], com: [30, -16], no: [30, 0], nc: [30, 16] };
      case 'sequencer': return { out: [30, 0], ref: [0, 24] };
      case 'hbridge': return { vcc: [0, -34], gnd: [0, 34], in1: [-34, -12], in2: [-34, 12], out1: [34, -12], out2: [34, 12] };
      case 'timer555': return { vcc: [0, -34], gnd: [0, 34], trig: [-34, -12], thr: [-34, 12], out: [34, -12], dis: [34, 12] };
      case 'servo': return { sig: [-30, -12], 'v+': [-30, 0], gnd: [-30, 12], shaft: [30, 0] };
      case 'stepper': return { 'a+': [-30, -18], 'a-': [-30, -6], 'b+': [-30, 6], 'b-': [-30, 18], shaft: [30, 0] };
      case 'stepdriver': return { vm: [0, -38], gnd: [0, 38], step: [-34, -12], dir: [-34, 12], 'a+': [34, -24], 'a-': [34, -8], 'b+': [34, 8], 'b-': [34, 24] };
      case 'spring': return { a: [-30, 0], b: [30, 0] };
      case 'pulley': return { shaft: [0, 0], belt: [0, -22] };
      case 'crank': return { shaft: [-40, 0] };
      case 'arduino': { const o = { '5V': [-60, -54], GND: [-60, -42] }; ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'].forEach((d, i) => { o[d] = [60, -54 + i * 10]; }); ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].forEach((a, i) => { o[a] = [-60, -6 + i * 10]; }); return o; }
      default: return {};
    }
  }
  function pinKind(part, pin) {
    const spec = state.contract && state.contract.parts[part.type];
    const p = spec && spec.pins.find((x) => x.name === pin);
    return p ? p.kind : 'electrical';
  }
  function rotate(x, y, deg) { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; }
  function pinWorld(part, pin) { const local = pinsOf(part)[pin]; if (!local) return null; const [x, y] = rotate(local[0], local[1], part.rotation || 0); return [part.x + x, part.y + y]; }

  const si = (v, u) => { const a = Math.abs(v); if (!Number.isFinite(v)) return '—'; if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M' + u; if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' + u; if (a >= 1) return v.toFixed(a >= 10 ? 0 : 1) + u; if (a >= 1e-3) return (v * 1e3).toFixed(a >= 1e-2 ? 0 : 1) + 'm' + u; if (a >= 1e-6) return (v * 1e6).toFixed(0) + 'µ' + u; if (a >= 1e-9) return (v * 1e9).toFixed(0) + 'n' + u; return a === 0 ? '0' + u : v.toExponential(1) + u; };
  const fmtVal = (part) => {
    const p = part.props || {};
    switch (part.type) {
      case 'resistor': case 'potentiometer': return si(p.ohms, 'Ω');
      case 'capacitor': return si(p.farads, 'F');
      case 'inductor': return si(p.henries, 'H');
      case 'battery': return p.volts + ' V';
      case 'source': return p.kind === 'dc' ? p.volts + ' V' : `${p.volts} V ${p.kind} ${si(p.frequencyHz, 'Hz')}`;
      case 'led': return p.color;
      case 'motor': return `${p.nominalVolts} V · ${p.noLoadRpm} rpm`;
      case 'gear': return `${p.teeth} t`;
      case 'load': return `${p.inertiaGcm2} g·cm²` + (Number(p.torqueMnm) ? ` · ${p.torqueMnm} mN·m` : '');
      case 'switch': return p.toggleAtSeconds != null ? `→ ${p.toggleAtSeconds} s` : (p.closed ? 'closed' : 'open');
      case 'zener': return p.breakdownVolts + ' V';
      case 'lamp': return `${p.ratedVolts} V ${p.ratedWatts} W`;
      case 'regulator': return p.outputVolts + ' V out';
      case 'opamp': return 'gain ' + si(p.gain, '');
      case 'relay': return `${si(p.coilOhms, 'Ω')} coil · ${si(p.pullInAmps, 'A')}`;
      case 'sequencer': return String(p.pattern || '').slice(0, 24);
      case 'hbridge': return `thr ${p.thresholdVolts} V`;
      case 'servo': return `${p.travelDeg}° · ${p.stallTorqueMnm} mN·m`;
      case 'stepper': return `${p.stepsPerRev} steps · ${p.holdingTorqueMnm} mN·m`;
      case 'stepdriver': return `${p.currentAmps} A · 1/${p.microsteps} step`;
      case 'spring': return `${p.stiffnessMnmPerDeg} mN·m/°`;
      case 'pulley': return `r ${p.radiusMm} mm · grip ${p.gripN} N`;
      case 'crank': return `r ${p.radiusMm} · rod ${p.rodMm} mm · ${p.sliderMassG} g`;
      case 'arduino': return String(p.sketch || '').split('\n').length + ' lines';
      default: return '';
    }
  };

  /** A labelled box symbol: the body, a title, and tiny pin labels at each pin. */
  function boxSymbol(g, part, w, h, title, labels) {
    g.appendChild(svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4, class: 'fillbody' }));
    const t = svgEl('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'title' }); t.textContent = title; g.appendChild(t);
    Object.entries(pinsOf(part)).forEach(([name, [px, py]]) => {
      g.appendChild(svgEl('path', { d: `M${px} ${py} L${clamp(px, -w / 2, w / 2)} ${clamp(py, -h / 2, h / 2)}`, class: 'body' }));
      const inside = [clamp(px, -w / 2 + 9, w / 2 - 9), clamp(py, -h / 2 + 8, h / 2 - 4)];
      const l = svgEl('text', { x: inside[0], y: inside[1] + 3, 'text-anchor': 'middle', class: 'pinlabel' }); l.textContent = labels ? labels[name] || name : name; g.appendChild(l);
    });
  }

  /** Draw the symbol body into `g` (local coordinates). Returns animatable handles. */
  function drawSymbol(g, part) {
    const body = (tag, attrs) => { const n = svgEl(tag, Object.assign({ class: 'body' }, attrs)); g.appendChild(n); return n; };
    const handles = {};
    switch (part.type) {
      case 'resistor': body('path', { d: 'M-30 0 H-20 L-16 -7 L-8 7 L0 -7 L8 7 L16 -7 L20 0 H30' }); break;
      case 'potentiometer': body('path', { d: 'M-30 0 H-20 L-16 -7 L-8 7 L0 -7 L8 7 L16 -7 L20 0 H30 M0 -26 V-12 M-4 -14 L0 -10 L4 -14' }); break;
      case 'capacitor': body('path', { d: 'M-30 0 H-4 M4 0 H30 M-4 -12 V12 M4 -12 V12' }); break;
      case 'inductor': body('path', { d: 'M-30 0 H-24 A6 6 0 0 1 -12 0 A6 6 0 0 1 0 0 A6 6 0 0 1 12 0 A6 6 0 0 1 24 0 H30' }); break;
      case 'diode': case 'led': case 'zener':
        body('path', { d: 'M-30 0 H-10 M10 0 H30' }); body('path', { d: part.type === 'zener' ? 'M6 -10 L10 -10 V10 L14 10' : 'M10 -10 V10' }); body('path', { d: 'M-10 -10 L10 0 L-10 10 Z', class: 'fillbody' });
        if (part.type === 'led') { handles.glow = body('circle', { cx: 0, cy: 0, r: 22, class: 'glow' }); body('path', { d: 'M2 -12 L8 -20 M6 -10 L12 -18 M8 -20 L4 -19 M12 -18 L8 -17' }); }
        break;
      case 'lamp': handles.glow = body('circle', { cx: 0, cy: 0, r: 22, class: 'glow' }); body('circle', { cx: 0, cy: 0, r: 12 }); body('path', { d: 'M-30 0 H-12 M12 0 H30 M-8 -8 L8 8 M-8 8 L8 -8' }); break;
      case 'battery': body('path', { d: 'M0 -30 V-8 M-12 -8 H12 M-6 -2 H6 M-12 4 H12 M-6 10 H6 M0 10 V30' }); g.appendChild(svgEl('text', { x: 8, y: -12 })).textContent = '+'; break;
      case 'source': body('circle', { cx: 0, cy: 0, r: 14 }); body('path', { d: 'M0 -30 V-14 M0 14 V30' }); body('path', { d: part.props.kind === 'sine' ? 'M-9 0 Q-4.5 -9 0 0 T9 0' : part.props.kind === 'dc' ? 'M-8 -3 H8 M-5 4 H5' : 'M-9 5 V-5 H-2 V5 H4 V-5 H9' }); break;
      case 'switch': body('path', { d: 'M-30 0 H-14 M14 0 H30' }); handles.contact = body('path', { d: 'M-14 0 L12 -12' }); body('circle', { cx: -14, cy: 0, r: 2 }); body('circle', { cx: 14, cy: 0, r: 2 }); break;
      case 'ground': body('path', { d: 'M0 -16 V0 M-12 0 H12 M-7 6 H7 M-2 12 H2' }); break;
      case 'junction': body('circle', { cx: 0, cy: 0, r: 3, class: 'fillbody' }); break;
      case 'npn': body('circle', { cx: 0, cy: 0, r: 16 }); body('path', { d: 'M-30 0 H-8 M-8 -10 V10 M-8 -4 L8 -14 V-30 M-8 4 L8 14 V30 M3 11 L8 14 L6 8' }); break;
      case 'nmos': body('circle', { cx: 0, cy: 0, r: 16 }); body('path', { d: 'M-30 0 H-10 M-10 -10 V10 M-5 -10 V-4 M-5 -3 V3 M-5 4 V10 M-5 -7 H8 V-30 M-5 7 H8 V30 M-5 0 H8 M0 -3 L-5 0 L0 3' }); break;
      case 'motor': body('circle', { cx: 0, cy: 0, r: 18 }); body('path', { d: 'M0 -30 V-18 M0 18 V30 M18 0 H30' }); handles.rotor = body('path', { d: 'M-12 0 H12 M6 -5 L12 0 L6 5' }); break;
      case 'stepper': body('circle', { cx: 0, cy: 0, r: 18 }); body('path', { d: 'M-30 -18 H-18 M-30 -6 H-17 M-30 6 H-17 M-30 18 H-18 M18 0 H30' }); g.appendChild(svgEl('text', { x: 0, y: -22, 'text-anchor': 'middle', class: 'pinlabel' })).textContent = 'STEP'; handles.rotor = body('path', { d: 'M-12 0 H12 M6 -5 L12 0 L6 5 M0 -12 V12' }); break;
      case 'servo': body('rect', { x: -22, y: -18, width: 44, height: 36, rx: 3, class: 'fillbody' }); body('path', { d: 'M-30 -12 H-22 M-30 0 H-22 M-30 12 H-22 M22 0 H30' }); g.appendChild(svgEl('text', { x: 0, y: 14, 'text-anchor': 'middle', class: 'pinlabel' })).textContent = 'SERVO'; handles.horn = body('path', { d: 'M0 0 V-14 M-3 -11 L0 -14 L3 -11', transform: 'translate(0 -2)' }); body('circle', { cx: 0, cy: -2, r: 3 }); break;
      case 'gear': {
        const r = gearRadius(part), n = clamp(Math.round(Number(part.props.teeth) || 20), 6, 48), pts = [];
        for (let i = 0; i < n; i += 1) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2, ro = r, ri = r - clamp(r * 0.18, 3, 7); pts.push(`${(Math.cos(a0) * ro).toFixed(1)} ${(Math.sin(a0) * ro).toFixed(1)}`, `${(Math.cos(a0 + (a1 - a0) * 0.5) * ro).toFixed(1)} ${(Math.sin(a0 + (a1 - a0) * 0.5) * ro).toFixed(1)}`, `${(Math.cos(a1) * ri).toFixed(1)} ${(Math.sin(a1) * ri).toFixed(1)}`, `${(Math.cos(a1 + (a1 - a0) * 0.5) * ri).toFixed(1)} ${(Math.sin(a1 + (a1 - a0) * 0.5) * ri).toFixed(1)}`); }
        const wheel = svgEl('g'); g.appendChild(wheel);
        wheel.appendChild(svgEl('path', { d: 'M' + pts.join(' L') + ' Z', class: 'fillbody' }));
        wheel.appendChild(svgEl('circle', { cx: 0, cy: 0, r: Math.max(4, r * 0.25), class: 'body' }));
        wheel.appendChild(svgEl('path', { d: `M0 ${-r * 0.25} V${-r + 6}`, class: 'body' }));
        handles.wheel = wheel; handles.radius = r;
        break;
      }
      case 'load': body('rect', { x: -20, y: -12, width: 40, height: 24, rx: 3, class: 'fillbody' }); body('path', { d: 'M-14 -12 L-6 12 M-2 -12 L6 12 M10 -12 L18 12 M0 -20 V-12' }); break;
      case 'regulator': boxSymbol(g, part, 44, 28, 'REG', { in: 'in', gnd: '⏚', out: 'out' }); break;
      case 'opamp': body('path', { d: 'M-30 -10 H-18 M-30 10 H-18 M18 0 H30 M0 -24 V-14 M0 24 V14' }); body('path', { d: 'M-18 -22 L18 0 L-18 22 Z', class: 'fillbody' }); g.appendChild(svgEl('text', { x: -12, y: -6, class: 'pinlabel' })).textContent = '+'; g.appendChild(svgEl('text', { x: -12, y: 14, class: 'pinlabel' })).textContent = '−'; break;
      case 'relay': boxSymbol(g, part, 44, 48, 'K', { 'c+': 'c+', 'c-': 'c−', com: 'com', no: 'no', nc: 'nc' }); body('path', { d: 'M-14 -12 A4 4 0 0 1 -14 -4 A4 4 0 0 1 -14 4 A4 4 0 0 1 -14 12' }); handles.contact = body('path', { d: 'M4 -14 L14 8' }); break;
      case 'sequencer': boxSymbol(g, part, 44, 28, 'SEQ', { out: 'out', ref: 'ref' }); body('path', { d: 'M-16 4 H-10 V-6 H-4 V4 H2 V-6 H8' }); break;
      case 'hbridge': boxSymbol(g, part, 56, 56, 'H-BRIDGE', { vcc: 'V+', gnd: '⏚', in1: 'in1', in2: 'in2', out1: 'out1', out2: 'out2' }); break;
      case 'timer555': boxSymbol(g, part, 56, 56, '555', { vcc: 'V+', gnd: '⏚', trig: 'trig', thr: 'thr', out: 'out', dis: 'dis' }); break;
      case 'stepdriver': boxSymbol(g, part, 56, 64, 'STEP DRV', { vm: 'Vm', gnd: '⏚', step: 'step', dir: 'dir', 'a+': 'a+', 'a-': 'a−', 'b+': 'b+', 'b-': 'b−' }); break;
      case 'spring': body('path', { d: 'M-30 0 H-22 L-18 -8 L-12 8 L-6 -8 L0 8 L6 -8 L12 8 L18 -8 L22 0 H30', class: 'body mech' }); break;
      case 'pulley': { const r = clamp(8 + Number(part.props.radiusMm) * 0.5, 12, 40); body('circle', { cx: 0, cy: 0, r, class: 'fillbody' }); body('circle', { cx: 0, cy: 0, r: r - 4, class: 'body' }); handles.rotor = body('path', { d: `M0 ${-r + 4} V${r - 4} M${-r + 4} 0 H${r - 4}` }); handles.radius = r; break; }
      case 'crank': {
        // the crank turns about the shaft pin (-40, 0); the slider runs along +x on a rail to the right
        const rc = clamp(Number(part.props.radiusMm) * 0.6, 8, 24), rod = clamp(Number(part.props.rodMm) * 0.6, rc + 10, 70);
        body('path', { d: `M-40 -${rc + 6} V${rc + 6} M${-40 + rc + 10} 8 H${-40 + rc + rod + 40}`, class: 'body mech' });
        body('circle', { cx: -40, cy: 0, r: 4 });
        handles.crank = body('path', { d: `M0 0 L${rc} 0`, transform: 'translate(-40 0)' }); handles.crankR = rc; handles.rodL = rod;
        handles.rod = body('path', { d: `M${-40 + rc} 0 L${-40 + rc + rod} 0` });
        handles.slider = body('rect', { x: -40 + rc + rod - 8, y: -8, width: 16, height: 16, rx: 2, class: 'fillbody' });
        break;
      }
      case 'arduino': boxSymbol(g, part, 96, 120, 'UNO', { '5V': '5V', GND: '⏚' }); break;
      default: body('rect', { x: -20, y: -12, width: 40, height: 24 });
    }
    return handles;
  }

  /** A wire's path: through its bend points, or the three-segment orthogonal path whose middle segment `route.mid` places. */
  function wirePath(a, b, route) {
    const v = G.routeVertices(a, b, route), d = G.pathD(v);
    if (route && Array.isArray(route.points) && route.points.length) return { d, mid: v[Math.floor(v.length / 2)], axis: null, seg: null, bends: route.points };
    const c1 = v[1], c2 = v[2], axis = Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1]) ? 'x' : 'y';
    const seg = c1[0] === c2[0] && c1[1] === c2[1] ? null : `M${c1[0]} ${c1[1]} L${c2[0]} ${c2[1]}`;
    return { d, mid: [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2], axis, seg, bends: null };
  }
  const cloneRoute = (r) => (!r ? null : Array.isArray(r.points) ? { points: r.points.map((p) => [p[0], p[1]]) } : Number.isFinite(r.mid) ? { mid: r.mid } : null);
  function verticesOf(w) { const a = state.parts.find((x) => x.id === w.from.part), b = state.parts.find((x) => x.id === w.to.part); return a && b ? G.routeVertices(pinWorld(a, w.from.pin), pinWorld(b, w.to.pin), w.route) : []; }
  function labelY(part) { return part.type === 'gear' ? gearRadius(part) + 14 : ['hbridge', 'timer555', 'relay'].includes(part.type) ? 40 : part.type === 'stepdriver' ? 46 : part.type === 'servo' ? 30 : part.type === 'pulley' ? clamp(8 + Number(part.props.radiusMm) * 0.5, 12, 40) + 14 : part.type === 'crank' ? 36 : part.type === 'arduino' ? 72 : 28; }

  function applyView() { const v = state.view; state.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }
  const isSelected = (id) => state.multi.has(id) || (state.selection && state.selection.kind === 'part' && state.selection.id === id);

  /** Every wire: its drawn path, a wide hit path, the middle-segment grab or its bend handles, and its live value. */
  function renderWires(svg) {
    const wires = svgEl('g'); svg.appendChild(wires);
    state.wireNodes.clear(); state.wireVals.clear();
    const byId = new Map(state.parts.map((p) => [p.id, p]));
    state.wires.forEach((w) => {
      const a = byId.get(w.from.part), b = byId.get(w.to.part);
      if (!a || !b) return;
      const pa = pinWorld(a, w.from.pin), pb = pinWorld(b, w.to.pin);
      if (!pa || !pb) return;
      const { d, mid, seg, axis, bends } = wirePath(pa, pb, w.route);
      const kind = w.kind || pinKind(a, w.from.pin);
      const hit = svgEl('path', { d, class: 'wire-hit' });
      const line = svgEl('path', { d, class: 'wire ' + kind + (state.selection && state.selection.kind === 'wire' && state.selection.id === w.id ? ' selected' : '') });
      hit.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ kind: 'wire', id: w.id }); });
      wires.appendChild(line); wires.appendChild(hit);
      const entry = { line, hit, mid: null, bends: [] };
      if (seg) { const grab = svgEl('path', { d: seg, class: 'wire-mid ' + (axis === 'x' ? 'ew' : 'ns'), 'data-wire': w.id }); grab.addEventListener('pointerdown', (e) => startWireDrag(e, w, axis)); wires.appendChild(grab); entry.mid = grab; }
      (bends || []).forEach((pt, i) => { const c = svgEl('circle', { cx: pt[0], cy: pt[1], r: 4, class: 'wire-bend', 'data-wire': w.id, 'data-index': i }); c.addEventListener('pointerdown', (e) => startBendDrag(e, w, i)); wires.appendChild(c); entry.bends.push(c); });
      state.wireNodes.set(w.id, entry);
      if (state.showValues) { const t = svgEl('text', { x: mid[0] + 4, y: mid[1] - 4, class: 'wireval' }); wires.appendChild(t); state.wireVals.set(w.id, { text: t, kind, part: a.id, pin: w.from.pin }); }
    });
  }

  function render() {
    const svg = state.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    applyView();
    const grid = svgEl('g');
    for (let x = 0; x <= WORLD.w; x += GRID * 2) grid.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: WORLD.h, class: 'grid' }));
    for (let y = 0; y <= WORLD.h; y += GRID * 2) grid.appendChild(svgEl('line', { x1: 0, y1: y, x2: WORLD.w, y2: y, class: 'grid' }));
    svg.appendChild(grid);
    renderWires(svg);
    state.layer = svgEl('g'); svg.appendChild(state.layer);
    state.nodes.clear();
    state.parts.forEach((part) => {
      const g = svgEl('g', { class: 'part' + (isSelected(part.id) ? ' selected' : ''), transform: `translate(${part.x} ${part.y}) rotate(${part.rotation || 0})` });
      const handles = drawSymbol(g, part);
      const ly = labelY(part);
      const label = svgEl('text', { x: 0, y: ly, 'text-anchor': 'middle', transform: `rotate(${-(part.rotation || 0)})` });
      label.textContent = part.label || part.id; g.appendChild(label);
      const value = svgEl('text', { x: 0, y: ly + 12, 'text-anchor': 'middle', class: 'value', transform: `rotate(${-(part.rotation || 0)})` });
      value.textContent = fmtVal(part); g.appendChild(value);
      if (state.showValues) { handles.reading = svgEl('text', { x: 0, y: ly + 24, 'text-anchor': 'middle', class: 'partval', transform: `rotate(${-(part.rotation || 0)})` }); g.appendChild(handles.reading); }
      Object.entries(pinsOf(part)).forEach(([name, [px, py]]) => {
        const kind = pinKind(part, name);
        const pin = svgEl('circle', { cx: px, cy: py, r: 4, class: 'pin ' + kind + (state.pending && state.pending.part === part.id && state.pending.pin === name ? ' pending' : '') });
        pin.appendChild(svgEl('title')).textContent = `${part.id}.${name} (${kind})`;
        pin.addEventListener('pointerdown', (e) => { e.stopPropagation(); pinClick(part, name); });
        g.appendChild(pin);
      });
      g.addEventListener('pointerdown', (e) => startDrag(e, part));
      state.layer.appendChild(g);
      state.nodes.set(part.id, { g, handles, part });
    });
    state.rubber = svgEl('path', { class: 'rubber', d: '' }); svg.appendChild(state.rubber);
    state.band = svgEl('rect', { class: 'marquee', x: 0, y: 0, width: 0, height: 0, visibility: 'hidden' }); svg.appendChild(state.band);
    if (state.anim) applyTime(state.anim.index); else if (state.showValues) applyTime(-1);
  }

  function select(sel) { if (!sel || sel.kind !== 'parts') state.multi = new Set(); state.selection = sel; render(); if (state.handlers.onSelect) state.handlers.onSelect(sel); }

  function pinClick(part, pin) {
    if (!state.pending) { state.pending = { part: part.id, pin }; render(); return; }
    const from = state.pending; state.pending = null; state.rubber.setAttribute('d', '');
    if (from.part === part.id && from.pin === pin) { render(); return; }
    const a = state.parts.find((p) => p.id === from.part);
    if (pinKind(a, from.pin) !== pinKind(part, pin)) { render(); if (state.handlers.onError) state.handlers.onError(`${from.part}.${from.pin} is ${pinKind(a, from.pin)} and ${part.id}.${pin} is ${pinKind(part, pin)}: a wire joins pins of one kind`); return; }
    const dup = state.wires.some((w) => (w.from.part === from.part && w.from.pin === from.pin && w.to.part === part.id && w.to.pin === pin) || (w.to.part === from.part && w.to.pin === from.pin && w.from.part === part.id && w.from.pin === pin));
    if (dup) { render(); return; }
    let n = 1; while (state.wires.some((w) => w.id === 'w' + n)) n += 1;
    state.wires.push({ id: 'w' + n, kind: pinKind(part, pin), from: { part: from.part, pin: from.pin }, to: { part: part.id, pin } });
    render(); changed();
  }

  function svgPoint(e) { const pt = state.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = state.svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : pt; }
  function capture(e) { try { state.svg.setPointerCapture(e.pointerId); } catch (_) { /* older browsers, synthetic events */ } }

  function startDrag(e, part) {
    e.stopPropagation();
    if (e.button === 1 || e.shiftKey) { startPan(e); return; }
    if (state.pending) { state.pending = null; state.rubber.setAttribute('d', ''); }
    const start = svgPoint(e);
    const group = state.multi.has(part.id) ? state.parts.filter((p) => state.multi.has(p.id)) : [part];
    state.drag = { part, group: group.map((p) => ({ part: p, x0: p.x, y0: p.y })), sx: start.x, sy: start.y, moved: false };
    capture(e);
  }
  function startWireDrag(e, wire, axis) {
    e.stopPropagation();
    if (e.button === 1 || e.shiftKey) { startPan(e); return; }
    state.wireDrag = { wire, axis, moved: false };
    capture(e);
  }
  function startBendDrag(e, wire, index) {
    e.stopPropagation();
    if (e.button === 1 || e.shiftKey) { startPan(e); return; }
    state.bendDrag = { wire, index, moved: false };
    capture(e);
  }
  function startPan(e) { state.pan = { x: e.clientX, y: e.clientY, view: { ...state.view } }; capture(e); }
  function startMarquee(e) { const p = svgPoint(e); state.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false }; capture(e); }
  function redrawWire(w) {
    const a = state.parts.find((x) => x.id === w.from.part), b = state.parts.find((x) => x.id === w.to.part), entry = state.wireNodes.get(w.id);
    if (!entry || !a || !b) return;
    const { d, mid, seg, bends } = wirePath(pinWorld(a, w.from.pin), pinWorld(b, w.to.pin), w.route);
    entry.line.setAttribute('d', d); entry.hit.setAttribute('d', d);
    if (entry.mid && seg) entry.mid.setAttribute('d', seg);
    (bends || []).forEach((pt, i) => { const c = entry.bends[i]; if (c) { c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]); } });
    const v = state.wireVals.get(w.id); if (v) { v.text.setAttribute('x', mid[0] + 4); v.text.setAttribute('y', mid[1] - 4); }
  }
  function onMove(e) {
    if (state.pan) {
      const scale = state.view.w / (state.svg.clientWidth || 960);
      state.view.x = clamp(state.pan.view.x - (e.clientX - state.pan.x) * scale, 0, WORLD.w - state.view.w);
      state.view.y = clamp(state.pan.view.y - (e.clientY - state.pan.y) * scale, 0, WORLD.h - state.view.h);
      applyView(); return;
    }
    if (state.marquee) {
      const p = svgPoint(e), m = state.marquee; m.x1 = p.x; m.y1 = p.y;
      if (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4) m.moved = true;
      state.band.setAttribute('x', Math.min(m.x0, m.x1)); state.band.setAttribute('y', Math.min(m.y0, m.y1)); state.band.setAttribute('width', Math.abs(m.x1 - m.x0)); state.band.setAttribute('height', Math.abs(m.y1 - m.y0)); state.band.setAttribute('visibility', m.moved ? 'visible' : 'hidden');
      return;
    }
    if (state.bendDrag) {
      const p = svgPoint(e), { wire, index } = state.bendDrag;
      wire.route.points[index] = [snap(clamp(p.x, 0, WORLD.w)), snap(clamp(p.y, 0, WORLD.h))]; state.bendDrag.moved = true;
      redrawWire(wire); return;
    }
    if (state.wireDrag) {
      const p = svgPoint(e), { wire, axis } = state.wireDrag;
      wire.route = { mid: snap(clamp(axis === 'x' ? p.x : p.y, 0, axis === 'x' ? WORLD.w : WORLD.h)) }; state.wireDrag.moved = true;
      redrawWire(wire); return;
    }
    if (state.drag) {
      const p = svgPoint(e), dx = p.x - state.drag.sx, dy = p.y - state.drag.sy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.drag.moved = true;
      const moving = new Set();
      state.drag.group.forEach(({ part, x0, y0 }) => {
        part.x = clamp(x0 + dx, 20, WORLD.w - 20); part.y = clamp(y0 + dy, 20, WORLD.h - 20); moving.add(part.id);
        const node = state.nodes.get(part.id);
        if (node) node.g.setAttribute('transform', `translate(${part.x} ${part.y}) rotate(${part.rotation || 0})`);
      });
      state.wires.forEach((w) => { if (moving.has(w.from.part) || moving.has(w.to.part)) redrawWire(w); });
    } else if (state.pending) {
      const a = state.parts.find((x) => x.id === state.pending.part), p = svgPoint(e);
      if (a) state.rubber.setAttribute('d', wirePath(pinWorld(a, state.pending.pin), [p.x, p.y]).d);
    }
  }
  function onUp() {
    if (state.pan) { state.pan = null; return; }
    if (state.marquee) {
      const m = state.marquee; state.marquee = null; state.band.setAttribute('visibility', 'hidden');
      if (!m.moved) { if (state.selection) select(null); return; }
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      const ids = state.parts.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id);
      if (ids.length === 1) select({ kind: 'part', id: ids[0] });
      else if (ids.length) { state.multi = new Set(ids); select({ kind: 'parts', ids }); }
      else select(null);
      return;
    }
    if (state.wireDrag) { const { wire, moved } = state.wireDrag; state.wireDrag = null; if (moved) { render(); changed(); } else select({ kind: 'wire', id: wire.id }); return; }
    if (state.bendDrag) { const { wire, moved } = state.bendDrag; state.bendDrag = null; if (moved) { render(); changed(); } else select({ kind: 'wire', id: wire.id }); return; }
    if (!state.drag) return;
    const { part, group, moved } = state.drag; state.drag = null;
    if (moved) { group.forEach(({ part: p }) => { p.x = snap(p.x); p.y = snap(p.y); }); render(); changed(); }
    else if (!state.multi.has(part.id)) select({ kind: 'part', id: part.id });
  }
  function onCanvasDown(e) {
    if (e.button === 1 || e.shiftKey) { startPan(e); return; }
    if (state.pending) { state.pending = null; state.rubber.setAttribute('d', ''); render(); return; }
    startMarquee(e);
  }
  /** A double-click on a bend removes it; on a wire, it inserts a bend there (the nearest wire within 8 units). */
  function onDblClick(e) {
    const p = svgPoint(e), at = [p.x, p.y];
    for (const w of state.wires) { const i = G.bendAt(w.route, at, 8); if (i >= 0) { e.preventDefault(); w.route = G.removeBend(w.route, i); render(); changed(); return; } }
    let best = null;
    for (const w of state.wires) { const v = verticesOf(w); if (v.length < 2) continue; const { dist } = G.nearestSegment(v, at); if (dist <= 8 && (!best || dist < best.dist)) best = { w, v, dist }; }
    if (!best) return;
    const next = G.insertBend(best.v, at, 8);
    if (!next) return;
    e.preventDefault();
    if (next.error) { if (state.handlers.onError) state.handlers.onError(next.error); return; }
    best.w.route = next; render(); changed();
  }
  function onWheel(e) {
    e.preventDefault();
    const p = svgPoint(e), f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const w = clamp(state.view.w * f, 240, WORLD.w), h = w / 2;
    state.view = { x: clamp(p.x - (p.x - state.view.x) * (w / state.view.w), 0, WORLD.w - w), y: clamp(p.y - (p.y - state.view.y) * (h / state.view.h), 0, WORLD.h - h), w, h };
    applyView();
  }
  function resetView() { state.view = { ...HOME }; applyView(); }
  function changed() { if (state.handlers.onChange) state.handlers.onChange(state.parts, state.wires); }

  function deleteSelected() {
    const sel = state.selection; if (!sel) return;
    const gone = sel.kind === 'parts' ? new Set(sel.ids) : sel.kind === 'part' ? new Set([sel.id]) : null;
    if (gone) { state.parts = state.parts.filter((p) => !gone.has(p.id)); state.wires = state.wires.filter((w) => !gone.has(w.from.part) && !gone.has(w.to.part)); }
    else state.wires = state.wires.filter((w) => w.id !== sel.id);
    state.selection = null; state.multi = new Set(); render(); changed(); if (state.handlers.onSelect) state.handlers.onSelect(null);
  }
  function rotateSelected() {
    const sel = state.selection; if (!sel) return;
    if (sel.kind === 'parts') {
      let out;
      try { out = G.rotateGroup(state.parts, state.wires, sel.ids, { w: WORLD.w, h: WORLD.h, margin: 20, verticesOf }); }
      catch (e) { if (state.handlers.onError) state.handlers.onError(e.message); return; }
      state.parts = out.parts; state.wires = out.wires; render(); changed(); return;
    }
    if (sel.kind !== 'part') return;
    const part = state.parts.find((p) => p.id === sel.id); if (!part) return;
    part.rotation = ((part.rotation || 0) + 90) % 360; render(); changed();
  }
  function onKey(e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (state.svg && state.svg.hasAttribute('hidden')) return; // the Breadboard view owns the keys while it shows
    if (e.ctrlKey || e.metaKey) return; // the page owns undo / redo / copy / paste
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') rotateSelected();
    else if (e.key === 'Escape') { if (state.pending) { state.pending = null; state.rubber.setAttribute('d', ''); render(); } else if (state.selection) select(null); }
  }

  /** Add a part at `at` (a drop point, snapped) or at a free grid spot (a column scan from the top-left), then report the change. */
  function addPart(part, at) {
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) { part.x = snap(clamp(at.x, 20, WORLD.w - 20)); part.y = snap(clamp(at.y, 20, WORLD.h - 20)); }
    else {
      const taken = new Set(state.parts.map((p) => `${p.x},${p.y}`));
      let placed = false;
      for (let y = 100; y <= 400 && !placed; y += 100) for (let x = 100; x <= 900 && !placed; x += 120) if (!taken.has(`${x},${y}`)) { part.x = x; part.y = y; placed = true; }
      if (!placed) { part.x = 480; part.y = 240; }
    }
    state.parts.push(part); render(); changed(); select({ kind: 'part', id: part.id });
  }
  function onDragOver(e) { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }
  function onDrop(e) {
    const type = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (!type) return;
    e.preventDefault();
    const p = svgPoint(e);
    if (state.handlers.onDrop) state.handlers.onDrop(type, p.x, p.y);
  }

  // ── Animation and live values from a run ───────────────────────────────────
  function setRun(report, waveforms) {
    if (!report || !waveforms || !waveforms.time || waveforms.time.length < 2) { state.anim = null; applyTime(-1); return; }
    const time = waveforms.time, signals = waveforms.signals || {};
    const shaftOf = new Map(), angles = new Map();
    (report.mechanism && report.mechanism.shafts || []).forEach((s) => {
      (s.parts || []).forEach((pid) => shaftOf.set(pid, s.id));
      const solved = signals[s.angleSignal || ('angle(' + s.drivenBy + ')')];
      const rpm = signals['rpm(' + s.id + ')'];
      if (solved && s.ratio != null) { angles.set(s.id, Float64Array.from(solved, (v) => v * s.ratio)); }
      else if (rpm) { const arr = new Float64Array(time.length); for (let i = 1; i < time.length; i += 1) arr[i] = arr[i - 1] + rpm[i] * 6 * (time[i] - time[i - 1]); angles.set(s.id, arr); }
    });
    state.anim = { time, signals, shaftOf, angles, index: 0, netOfPin: report.netOfPin || waveforms.netOfPin || {} };
    applyTime(0);
  }
  const fmtV = (v) => si(v, 'V'), fmtA = (v) => si(v, 'A');
  function applyTime(index) {
    if (state.anim) state.anim.index = index;
    const a = state.anim;
    const angleOf = (part) => { const own = a && a.signals['angle(' + part.id + ')']; if (own && index >= 0) return own[index]; const arr = a && a.angles.get(a.shaftOf.get(part.id)); return arr && index >= 0 ? arr[index] : 0; };
    state.nodes.forEach(({ handles, part }) => {
      if (part.type === 'gear' && handles.wheel) handles.wheel.setAttribute('transform', `rotate(${(angleOf(part) % 360).toFixed(2)})`);
      if (handles.rotor) handles.rotor.setAttribute('transform', `rotate(${(angleOf(part) % 360).toFixed(2)})`);
      if (handles.horn) handles.horn.setAttribute('transform', `translate(0 -2) rotate(${(angleOf(part) - Number(part.props.travelDeg || 180) / 2).toFixed(2)})`);
      if (handles.crank) {
        const th = (angleOf(part) * Math.PI) / 180, rc = handles.crankR, rod = handles.rodL;
        const tipX = -40 + rc * Math.cos(th), tipY = -rc * Math.sin(th);
        const sx = -40 + rc * Math.cos(th) + Math.sqrt(Math.max(1, rod * rod - (rc * Math.sin(th)) ** 2));
        handles.crank.setAttribute('transform', `translate(-40 0) rotate(${(-angleOf(part)).toFixed(2)})`);
        handles.rod.setAttribute('d', `M${tipX.toFixed(1)} ${tipY.toFixed(1)} L${sx.toFixed(1)} 0`);
        handles.slider.setAttribute('x', (sx - 8).toFixed(1));
      }
      if (handles.glow) {
        const cur = a && a.signals['i(' + part.id + ')'];
        let b = 0;
        if (cur && index >= 0) { const i = Math.abs(cur[index]); b = part.type === 'lamp' ? clamp((i * i * (Number(part.props.ratedVolts) ** 2 / Number(part.props.ratedWatts))) / Number(part.props.ratedWatts), 0, 1) : clamp((i * 1000) / (Number(part.props.maxMa) || 20), 0, 1); }
        handles.glow.setAttribute('opacity', (b * 0.55).toFixed(3));
        handles.glow.setAttribute('fill', part.type === 'lamp' ? '#ffd86b' : { red: '#ff4040', yellow: '#ffd23f', green: '#39e05a', blue: '#4f8cff', white: '#ffffff' }[part.props.color] || '#ff4040');
      }
      if (part.type === 'switch' && handles.contact) { const t = a && index >= 0 ? a.time[index] : 0; const toggle = part.props.toggleAtSeconds; const closed = toggle == null ? !!part.props.closed : (t >= toggle ? !part.props.closed : !!part.props.closed); handles.contact.setAttribute('d', closed ? 'M-14 0 L14 0' : 'M-14 0 L12 -12'); }
      if (part.type === 'relay' && handles.contact) { const cur = a && a.signals['i(' + part.id + ')']; const on = cur && index >= 0 && Math.abs(cur[index]) >= Number(part.props.pullInAmps); handles.contact.setAttribute('d', on ? 'M4 -14 L14 -3' : 'M4 -14 L14 8'); }
      if (handles.reading) { const cur = a && a.signals['i(' + part.id + ')']; const rpm = a && a.signals['rpm(' + part.id + ')']; const ang = a && a.signals['angle(' + part.id + ')']; const x = a && a.signals['x(' + part.id + ')']; const tw = a && a.signals['twist(' + part.id + ')']; handles.reading.textContent = index >= 0 && x ? x[index].toFixed(1) + ' mm' : index >= 0 && tw ? tw[index].toFixed(2) + '° twist' : index >= 0 && ang && part.type !== 'motor' ? ang[index].toFixed(1) + '°' : index >= 0 && rpm ? Math.round(rpm[index]) + ' rpm' : index >= 0 && cur ? fmtA(cur[index]) : ''; }
    });
    state.wireVals.forEach((v) => {
      if (!a || index < 0) { v.text.textContent = ''; return; }
      if (v.kind === 'electrical') { const net = a.netOfPin[v.part + '.' + v.pin]; const sig = net === '0' ? null : a.signals['v(' + net + ')']; v.text.textContent = net === '0' ? '0 V' : sig ? fmtV(sig[index]) : ''; }
      else { const rpm = a.signals['rpm(' + a.shaftOf.get(v.part) + ')']; v.text.textContent = rpm ? Math.round(rpm[index]) + ' rpm' : ''; }
    });
  }

  function init(svg, handlers) {
    state.svg = svg; state.handlers = handlers || {};
    svg.addEventListener('pointermove', onMove); svg.addEventListener('pointerup', onUp); svg.addEventListener('pointerleave', onUp); svg.addEventListener('pointerdown', onCanvasDown);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('dragover', onDragOver); svg.addEventListener('drop', onDrop); svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    document.addEventListener('keydown', onKey);
    render();
  }
  function setContract(contract) { state.contract = contract; }
  function setCircuit(parts, wires) {
    state.parts = parts.map((p) => Object.assign({}, p, { props: Object.assign({}, p.props) })); state.wires = wires.map((w) => Object.assign({}, w, w.route ? { route: cloneRoute(w.route) } : {})); state.pending = null;
    state.multi = new Set([...state.multi].filter((id) => state.parts.some((p) => p.id === id)));
    if (state.selection && !(state.selection.kind === 'part' ? state.parts.some((p) => p.id === state.selection.id) : state.selection.kind === 'parts' ? state.multi.size > 0 : state.wires.some((w) => w.id === state.selection.id))) { state.selection = null; state.multi = new Set(); }
    render();
  }
  function circuit() { return { parts: state.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, rotation: p.rotation || 0, label: p.label || '', props: p.props })), wires: state.wires.map((w) => Object.assign({ id: w.id, from: w.from, to: w.to }, cloneRoute(w.route) ? { route: cloneRoute(w.route) } : {})) }; }
  function updatePart(id, patch) { const part = state.parts.find((p) => p.id === id); if (!part) return; Object.assign(part, patch, { props: Object.assign({}, part.props, patch.props || {}) }); render(); changed(); }
  function setShowValues(on) { state.showValues = !!on; render(); }
  function selectParts(ids) { state.multi = new Set(ids); if (ids.length === 1) select({ kind: 'part', id: ids[0] }); else select(ids.length ? { kind: 'parts', ids: [...ids] } : null); }

  window.CircuitLabCanvas = { init, setContract, setCircuit, circuit, addPart, updatePart, select, selectParts, deleteSelected, rotateSelected, setRun, setTime: applyTime, setShowValues, resetView, selection: () => state.selection, pinsOf, isDragging: () => !!state.drag || !!state.pending || !!state.pan || !!state.marquee || !!state.wireDrag || !!state.bendDrag, view: () => ({ ...state.view }) };
})();
