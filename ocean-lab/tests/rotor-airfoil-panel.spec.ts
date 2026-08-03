/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — guards for the section half of
 *                     |                             | @/features/rotor-design: NACA 4-digit geometry, the Hess-Smith
 *                     |                             | vortex panel solution, the viscous polar and the Viterna
 *                     |                             | post-stall extension. The panel guards are the ones that matter
 *                     |                             | most: a symmetric section MUST produce exactly zero lift at
 *                     |                             | zero incidence and the lift slope MUST approach 2*pi per radian
 *                     |                             | as thickness goes to zero, because those two are the only
 *                     |                             | independent facts about this solver that theory hands us for
 *                     |                             | free. Everything downstream — the whole BEMT result — is built
 *                     |                             | on the number this file checks.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_SECTION_STATIONS,
  cosineStations,
  estimateSectionDrag,
  liftLineCl,
  maxLiftCoefficient,
  nacaCamber,
  nacaSection,
  nacaThickness,
  panelLiftLine,
  panelSolveCl,
  sectionLiftLine,
  sectionPolar,
  sectionReynolds,
  sectionRingLength,
  skinFrictionCoefficient,
  viternaDragMax,
  viternaExtend,
  type NacaSpec,
} from '../src-routes/engine/rotor-design';

/**
 * A panel solve is a dense factorisation of a ~200 × 200 system, and several of these tests run a
 * handful of them. That is comfortably fast on an idle machine and NOT comfortably fast on a busy
 * one, so the budget is stated explicitly rather than left to vitest's five-second default — a
 * guard that goes red because the box was loaded teaches everyone to ignore red.
 */
const PANEL_TIMEOUT_MS = 180_000;

const NACA_0012: NacaSpec = { maxCamber: 0, camberPos: 0, thickness: 0.12 };
const NACA_4412: NacaSpec = { maxCamber: 0.04, camberPos: 0.4, thickness: 0.12 };
const TWO_PI = 2 * Math.PI;
const degrees = (rad: number): number => (rad * 180) / Math.PI;
const radians = (deg: number): number => (deg * Math.PI) / 180;

describe('NACA 4-digit geometry', () => {
  it('closes the trailing edge EXACTLY — an open TE is a non-manifold mesh, not a rounding detail', () => {
    for (const thickness of [0.06, 0.12, 0.18, 0.24]) {
      expect(Math.abs(nacaThickness(1, thickness))).toBeLessThan(1e-15);
    }
    expect(nacaThickness(0, 0.12)).toBe(0);
  }, PANEL_TIMEOUT_MS);

  it('puts maximum thickness near 30 % chord and scales linearly with the thickness digit', () => {
    const stations = cosineStations(400);
    const halfThickness = stations.map((x) => nacaThickness(x, 0.12));
    const peak = stations[halfThickness.indexOf(Math.max(...halfThickness))];
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThan(0.35);
    expect(Math.max(...halfThickness) * 2).toBeCloseTo(0.12, 2);
    expect(nacaThickness(0.3, 0.24) / nacaThickness(0.3, 0.12)).toBeCloseTo(2, 12);
  }, PANEL_TIMEOUT_MS);

  it('degrades to a symmetric section when camber is zero, INCLUDING the p = 0 of a NACA 00xx', () => {
    expect(() => nacaCamber(0.5, 0, 0)).not.toThrow();
    expect(nacaCamber(0.5, 0, 0)).toEqual({ yc: 0, slope: 0 });
    expect(() => nacaCamber(0.5, 0.04, 0)).toThrow(RangeError);
    expect(() => nacaCamber(0.5, 0.04, 1)).toThrow(RangeError);
  }, PANEL_TIMEOUT_MS);

  it('reproduces the closed-form camber line and its slope', () => {
    const m = 0.04;
    const p = 0.4;
    const front = nacaCamber(0.2, m, p);
    expect(front.yc).toBeCloseTo((m / p ** 2) * (2 * p * 0.2 - 0.2 ** 2), 12);
    expect(front.slope).toBeCloseTo((2 * m / p ** 2) * (p - 0.2), 12);
    const rear = nacaCamber(0.7, m, p);
    expect(rear.yc).toBeCloseTo((m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * 0.7 - 0.7 ** 2), 12);
    expect(rear.slope).toBeCloseTo((2 * m / (1 - p) ** 2) * (p - 0.7), 12);
    expect(nacaCamber(p, m, p).yc).toBeCloseTo(m, 12);
    expect(nacaCamber(p, m, p).slope).toBeCloseTo(0, 12);
  }, PANEL_TIMEOUT_MS);

  it('uses COSINE spacing — the leading-edge station is far finer than uniform spacing would give', () => {
    const stations = cosineStations(41);
    expect(stations[0]).toBe(0);
    expect(stations[stations.length - 1]).toBe(1);
    for (let i = 1; i < stations.length; i += 1) expect(stations[i]).toBeGreaterThan(stations[i - 1]);
    const uniform = 1 / 40;
    expect(stations[1] - stations[0]).toBeLessThan(uniform / 5);
    const middle = stations[21] - stations[20];
    expect(middle).toBeGreaterThan(uniform);
    expect(() => cosineStations(2)).toThrow(RangeError);
  }, PANEL_TIMEOUT_MS);

  it('emits a closed ring with no repeated leading- or trailing-edge point', () => {
    const section = nacaSection(NACA_4412, 80);
    expect(section.points).toHaveLength(sectionRingLength(80));
    expect(section.points).toHaveLength(158);
    const first = section.points[0];
    const last = section.points[section.points.length - 1];
    expect(first.x).toBeCloseTo(1, 12);
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(1e-6);
    const leadingEdges = section.points.filter((point) => Math.hypot(point.x, point.y) < 1e-12);
    expect(leadingEdges).toHaveLength(1);
  }, PANEL_TIMEOUT_MS);

  it('makes a symmetric section geometrically symmetric about the chord line', () => {
    const section = nacaSection(NACA_0012, 60);
    const half = section.points.length / 2;
    for (let i = 1; i < half; i += 1) {
      const upper = section.points[half - i];
      const lower = section.points[half + i];
      expect(lower.x).toBeCloseTo(upper.x, 12);
      expect(lower.y).toBeCloseTo(-upper.y, 12);
    }
  }, PANEL_TIMEOUT_MS);

  it('lifts the whole cambered outline above the symmetric one at mid-chord', () => {
    const cambered = nacaSection(NACA_4412, 60);
    const symmetric = nacaSection(NACA_0012, 60);
    const upperAt = (points: { x: number; y: number }[]): number =>
      points.filter((p) => Math.abs(p.x - 0.4) < 0.05 && p.y > 0).reduce((s, p) => s + p.y, 0);
    expect(upperAt(cambered.points)).toBeGreaterThan(upperAt(symmetric.points));
  }, PANEL_TIMEOUT_MS);
});

describe('vortex panel method', () => {
  it('gives a symmetric section EXACTLY zero lift at zero incidence', () => {
    for (const thickness of [0.06, 0.12, 0.2]) {
      const cl = panelSolveCl(nacaSection({ maxCamber: 0, camberPos: 0, thickness }, 100), 0);
      expect(Math.abs(cl)).toBeLessThan(1e-9);
    }
  }, PANEL_TIMEOUT_MS);

  it('is antisymmetric in angle of attack for a symmetric section', () => {
    const section = nacaSection(NACA_0012, 100);
    for (const deg of [2, 5, 8]) {
      expect(panelSolveCl(section, radians(-deg))).toBeCloseTo(-panelSolveCl(section, radians(deg)), 10);
    }
  }, PANEL_TIMEOUT_MS);

  it('drives dCl/dalpha to 2*pi per RADIAN as the section thins', () => {
    const slopes = [0.02, 0.04, 0.06, 0.09, 0.12].map(
      (thickness) => panelLiftLine(nacaSection({ maxCamber: 0, camberPos: 0, thickness }, 120)).liftSlopePerRad,
    );
    for (let i = 1; i < slopes.length; i += 1) expect(slopes[i]).toBeGreaterThan(slopes[i - 1]);
    expect(slopes[0] / TWO_PI).toBeGreaterThan(1);
    expect(slopes[0] / TWO_PI).toBeLessThan(1.025);
    const zeroThickness = slopes[0] - (slopes[1] - slopes[0]);
    expect(zeroThickness / TWO_PI).toBeGreaterThan(0.99);
    expect(zeroThickness / TWO_PI).toBeLessThan(1.01);
  }, PANEL_TIMEOUT_MS);

  it('gives a cambered section positive lift at zero incidence and a NEGATIVE zero-lift angle', () => {
    const line = panelLiftLine(nacaSection(NACA_4412, 120));
    expect(line.cosCoefficient).toBeGreaterThan(0.4);
    expect(panelSolveCl(nacaSection(NACA_4412, 120), 0)).toBeGreaterThan(0);
    expect(line.zeroLiftAlphaRad).toBeLessThan(0);
    expect(degrees(line.zeroLiftAlphaRad)).toBeGreaterThan(-5);
    expect(degrees(line.zeroLiftAlphaRad)).toBeLessThan(-3.5);
    expect(Math.abs(panelSolveCl(nacaSection(NACA_4412, 120), line.zeroLiftAlphaRad))).toBeLessThan(1e-9);
  }, PANEL_TIMEOUT_MS);

  it('is EXACTLY linear in (cos alpha, sin alpha) — which is what makes the two-solve lift line valid', () => {
    const section = nacaSection(NACA_4412, 100);
    const line = panelLiftLine(section);
    for (const deg of [-12, -6, -3, 0, 3, 6, 12, 25]) {
      expect(liftLineCl(line, radians(deg))).toBeCloseTo(panelSolveCl(section, radians(deg)), 8);
    }
  }, PANEL_TIMEOUT_MS);

  it('accepts either profile handedness — the panel ordering is measured, not assumed', () => {
    const section = nacaSection(NACA_4412, 80);
    const reversed = { points: [...section.points].reverse() };
    expect(panelSolveCl(reversed, radians(4))).toBeCloseTo(panelSolveCl(section, radians(4)), 8);
  }, PANEL_TIMEOUT_MS);

  it('refuses a degenerate profile rather than returning a plausible number', () => {
    expect(() => panelSolveCl({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] }, 0)).toThrow(RangeError);
  }, PANEL_TIMEOUT_MS);
});

describe('viscous section polar', () => {
  it('labels drag as an ESTIMATE in its own documentation', () => {
    const source = readFileSync(
      resolve(__dirname, '../src-routes/engine/rotor-design/services/section-polar.ts'),
      'utf8',
    );
    const doc = source.slice(0, source.indexOf('export function estimateSectionDrag'));
    expect(doc.slice(doc.lastIndexOf('/**'))).toMatch(/ESTIMATE/);
  }, PANEL_TIMEOUT_MS);

  it('computes section Reynolds as W c / nu and refuses a non-physical chord or viscosity', () => {
    expect(sectionReynolds(3.86, 0.0142, 1.05e-6)).toBeCloseTo((3.86 * 0.0142) / 1.05e-6, 6);
    expect(() => sectionReynolds(1, 0, 1.05e-6)).toThrow(RangeError);
    expect(() => sectionReynolds(1, 0.1, 0)).toThrow(RangeError);
  }, PANEL_TIMEOUT_MS);

  it('blends laminar into turbulent skin friction without a hard switch', () => {
    expect(skinFrictionCoefficient(1e4)).toBeCloseTo(1.328 / Math.sqrt(1e4), 4);
    expect(skinFrictionCoefficient(1e8)).toBeCloseTo(0.455 / Math.log10(1e8) ** 2.58, 4);
    expect(skinFrictionCoefficient(1e8)).toBeLessThan(skinFrictionCoefficient(1e3));
    // A hard switch at the transition Reynolds would step ~170 % in one sample; the logistic
    // blend keeps every 0.02-decade step under a few per cent, which is what the bisection needs.
    let worst = 0;
    let previous = skinFrictionCoefficient(1e3);
    for (let logRe = 3.02; logRe <= 8; logRe += 0.02) {
      const current = skinFrictionCoefficient(10 ** logRe);
      worst = Math.max(worst, Math.abs(current - previous) / previous);
      previous = current;
    }
    expect(worst).toBeLessThan(0.08);
  }, PANEL_TIMEOUT_MS);

  it('makes the LOW-Reynolds penalty visible rather than smoothing it away', () => {
    const low = estimateSectionDrag(0.12, 7.4e4, 0.7, 0.5);
    const mid = estimateSectionDrag(0.12, 5e5, 0.7, 0.5);
    const high = estimateSectionDrag(0.12, 5e6, 0.7, 0.5);
    expect(low).toBeGreaterThan(2 * high);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
    expect(0.7 / low).toBeLessThan(25);
    expect(0.7 / high).toBeGreaterThan(50);
  }, PANEL_TIMEOUT_MS);

  it('charges a THICK section more friction drag even at high Reynolds — the form factor', () => {
    const thin = estimateSectionDrag(0.09, 5e6, 0.6, 0.5);
    const thick = estimateSectionDrag(0.21, 5e6, 0.6, 0.5);
    // The pressure term alone would only lift this ratio to about 1.08; the Hoerner form factor
    // scaling the SKIN FRICTION is what takes it past 1.2.
    expect(thick / thin).toBeGreaterThan(1.2);
    expect(thick / thin).toBeLessThan(1.5);
  }, PANEL_TIMEOUT_MS);

  it('penalises a THICK section harder at low Reynolds than a thin one', () => {
    const thinPenalty = estimateSectionDrag(0.09, 6e4, 0.6, 0.5) - estimateSectionDrag(0.09, 5e6, 0.6, 0.5);
    const thickPenalty = estimateSectionDrag(0.21, 6e4, 0.6, 0.5) - estimateSectionDrag(0.21, 5e6, 0.6, 0.5);
    expect(thickPenalty).toBeGreaterThan(thinPenalty);
  }, PANEL_TIMEOUT_MS);

  it('bottoms the drag bucket at the minimum-drag lift coefficient', () => {
    const at = (cl: number): number => estimateSectionDrag(0.12, 1e6, cl, 0.5);
    expect(at(0.5)).toBeLessThan(at(0.9));
    expect(at(0.5)).toBeLessThan(at(0.1));
  }, PANEL_TIMEOUT_MS);

  it('lowers maximum lift as Reynolds falls — the same physics as the bubble, seen in lift', () => {
    expect(maxLiftCoefficient(5e4)).toBeLessThan(maxLiftCoefficient(2e5));
    expect(maxLiftCoefficient(2e5)).toBeLessThan(maxLiftCoefficient(5e6));
    expect(maxLiftCoefficient(5e4)).toBeGreaterThan(0.6);
    expect(maxLiftCoefficient(5e6)).toBeLessThan(1.6);
  }, PANEL_TIMEOUT_MS);

  it('clips lift at the Reynolds-dependent maximum instead of extrapolating the inviscid line', () => {
    const line = sectionLiftLine(NACA_4412);
    const alpha = radians(10);
    const inviscid = liftLineCl(line, alpha);
    const low = sectionPolar(NACA_4412, alpha, 7e4);
    const high = sectionPolar(NACA_4412, alpha, 5e6);
    expect(inviscid).toBeGreaterThan(1.5);
    expect(low.cl).toBeLessThan(inviscid);
    expect(low.cl).toBeLessThan(high.cl);
  }, PANEL_TIMEOUT_MS);

  it('stays continuous across the stall hand-over and over the whole +/-180 degree range', () => {
    let worstCl = 0;
    let worstCd = 0;
    let previous = sectionPolar(NACA_4412, -Math.PI, 1e5);
    for (let alpha = -Math.PI + 1e-3; alpha <= Math.PI; alpha += 1e-3) {
      const current = sectionPolar(NACA_4412, alpha, 1e5);
      worstCl = Math.max(worstCl, Math.abs(current.cl - previous.cl));
      worstCd = Math.max(worstCd, Math.abs(current.cd - previous.cd));
      previous = current;
    }
    expect(worstCl).toBeLessThan(0.02);
    expect(worstCd).toBeLessThan(0.02);
  }, PANEL_TIMEOUT_MS);

  it('gives a cambered section LESS lift nose-down than nose-up before it lets go', () => {
    const line = sectionLiftLine(NACA_4412);
    const departed = (deg: number): boolean =>
      Math.abs(sectionPolar(NACA_4412, radians(deg), 1e6).cl - liftLineCl(line, radians(deg))) > 1e-6;
    let positive = 0;
    while (positive < 40 && !departed(positive)) positive += 0.05;
    let negative = 0;
    while (negative > -40 && !departed(negative)) negative -= 0.05;
    // Measured from the ZERO-LIFT angle the cambered section gives out sooner nose-down, so the
    // negative excursion is the shorter one — and the peak nose-down lift is the smaller one.
    const zeroLiftDeg = degrees(line.zeroLiftAlphaRad);
    expect(positive - zeroLiftDeg).toBeGreaterThan(Math.abs(negative - zeroLiftDeg));
    expect(Math.abs(sectionPolar(NACA_4412, radians(negative), 1e6).cl)).toBeLessThan(
      sectionPolar(NACA_4412, radians(positive), 1e6).cl,
    );
    expect(negative).toBeLessThan(zeroLiftDeg);
    expect(positive).toBeGreaterThan(zeroLiftDeg);
  }, PANEL_TIMEOUT_MS);

  it('reports zero drag only when explicitly asked for the ideal-rotor limit', () => {
    expect(sectionPolar(NACA_4412, radians(4), 1e5).cd).toBeGreaterThan(0);
    expect(sectionPolar(NACA_4412, radians(4), 1e5, { inviscidDrag: true }).cd).toBe(0);
    expect(sectionPolar(NACA_4412, radians(4), 1e5, { inviscidDrag: true }).cl).toBeCloseTo(
      sectionPolar(NACA_4412, radians(4), 1e5).cl,
      12,
    );
  }, PANEL_TIMEOUT_MS);

  it('memoises the panelled lift line without changing the answer', () => {
    const first = sectionLiftLine(NACA_0012, DEFAULT_SECTION_STATIONS);
    const second = sectionLiftLine(NACA_0012, DEFAULT_SECTION_STATIONS);
    expect(second).toBe(first);
    expect(second.liftSlopePerRad).toBeCloseTo(
      panelLiftLine(nacaSection(NACA_0012, DEFAULT_SECTION_STATIONS)).liftSlopePerRad,
      12,
    );
  }, PANEL_TIMEOUT_MS);
});

describe('Viterna post-stall extension', () => {
  const stall = { alphaStallRad: radians(12), clStall: 1.2, cdStall: 0.03, aspectRatio: 10 };

  it('reproduces the stall point EXACTLY — continuity is built in, not blended on', () => {
    const at = viternaExtend(stall, stall.alphaStallRad);
    expect(at.cl).toBeCloseTo(stall.clStall, 12);
    expect(at.cd).toBeCloseTo(stall.cdStall, 12);
  }, PANEL_TIMEOUT_MS);

  it('reaches the flat-plate drag ceiling broadside and zero lift at 90 degrees', () => {
    const broadside = viternaExtend(stall, Math.PI / 2);
    expect(broadside.cd).toBeCloseTo(viternaDragMax(10), 10);
    expect(broadside.cl).toBeCloseTo(0, 10);
    expect(viternaDragMax(10)).toBeCloseTo(1.11 + 0.018 * 10, 12);
    expect(viternaDragMax(400)).toBeCloseTo(2.01, 12);
  }, PANEL_TIMEOUT_MS);

  it('runs all the way to +/-180 degrees, ending at zero lift', () => {
    expect(viternaExtend(stall, Math.PI).cl).toBeCloseTo(0, 10);
    expect(viternaExtend(stall, -Math.PI).cl).toBeCloseTo(0, 10);
    expect(viternaExtend(stall, Math.PI).cd).toBeGreaterThan(0);
    expect(viternaExtend(stall, radians(150)).cl).toBeLessThan(0);
  }, PANEL_TIMEOUT_MS);

  it('is odd in lift and even in drag about zero incidence', () => {
    for (const deg of [12, 30, 60, 90, 120, 170]) {
      const positive = viternaExtend(stall, radians(deg));
      const negative = viternaExtend(stall, radians(-deg));
      expect(negative.cl).toBeCloseTo(-positive.cl, 10);
      expect(negative.cd).toBeCloseTo(positive.cd, 10);
    }
  }, PANEL_TIMEOUT_MS);

  it('refuses to extrapolate INTO the attached-flow region', () => {
    expect(() => viternaExtend(stall, radians(5))).toThrow(RangeError);
    expect(() => viternaExtend({ ...stall, alphaStallRad: 0 }, radians(30))).toThrow(RangeError);
    expect(() => viternaExtend({ ...stall, aspectRatio: 0 }, radians(30))).toThrow(RangeError);
  }, PANEL_TIMEOUT_MS);

  it('never lets drag exceed the flat-plate ceiling anywhere on the sweep', () => {
    const ceiling = viternaDragMax(stall.aspectRatio);
    for (let deg = 12; deg <= 180; deg += 0.5) {
      const { cd } = viternaExtend(stall, radians(deg));
      expect(cd).toBeGreaterThan(0);
      expect(cd).toBeLessThanOrEqual(ceiling + 1e-9);
    }
  }, PANEL_TIMEOUT_MS);
});
