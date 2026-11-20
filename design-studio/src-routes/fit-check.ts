/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B9: joint fit / interference clearance check and honest
 *                     |                             | strength reporting for Design Studio. Evaluates each mechanism
 *                     |                             | joint's parent and child CAD Studio geometry (outer envelopes
 *                     |                             | and active subtractive box-cut pockets / cylindrical holes) to
 *                     |                             | report signed clearance in mm (`fit`, `interference`, or
 *                     |                             | `unverified`), flags tight FDM clearances (< 0.2 mm) on moving
 *                     |                             | joints, blocks `parts-complete` on interference, and reports
 *                     |                             | measured engine strength or explicitly states no engine
 *                     |                             | strength estimate has been measured for a named load.
 */

import type { Mechanism, MechanismJoint, MechanismPart } from './mechanism-model';
import type { Artifact, Brief } from './phase-model';

export const FDM_TOLERANCE_MM = 0.2;
const EPS = 1e-6;
const AXES = ['x', 'y', 'z'] as const;
const LOAD_RE = /\b(\d+(?:\.\d+)?)\s*(kg|g|lb|lbs|n|kn)\b/i;
const LOAD_WORD_RE = /\b(lift|lifts|raise|raises|hoist|hoists|carry|carries|hold|holds|support|supports|load|weight|force|stress|strength)\b/i;

export type Vec3 = [number, number, number];
export type FitVerdict = 'fit' | 'interference' | 'unverified';
export type StrengthStatus = 'ok' | 'warn' | 'bad' | 'unmeasured';

export interface Box3 { min: Vec3; max: Vec3 }

export interface PartEnvelope {
  box: Box3;
  kind: 'box' | 'cylinder' | 'bounds';
  diameter?: number;
  height?: number;
}

export interface CadFeatureStatus {
  id?: string | null;
  ok?: boolean;
  code?: string;
  ms?: number;
  skipped?: boolean;
}

export interface CadFeatureRecord {
  id?: string;
  type?: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}

export interface CadPartSnapshot {
  id?: string;
  model_id?: string;
  modelId?: string;
  title?: string;
  state?: string;
  base?: Record<string, unknown> | null;
  features?: CadFeatureRecord[];
  feature_status?: CadFeatureStatus[];
  source?: Record<string, unknown> | null;
  report?: Record<string, unknown> | null;
}

export interface JointFitResult {
  jointId: string;
  parent: string;
  child: string;
  type: MechanismJoint['type'];
  verdict: FitVerdict;
  clearanceMm: number | null;
  fdmToleranceMm: number;
  tightFit: boolean;
  warning: string | null;
  reason: string;
  matingFeature: string | null;
}

export interface StrengthReport {
  loadLabel: string | null;
  measured: boolean;
  status: StrengthStatus;
  engine: string | null;
  safetyFactor: number | null;
  maxStressMpa: number | null;
  allowableStressMpa: number | null;
  line: string;
}

export interface DesignFitReport {
  ok: boolean;
  verdict: FitVerdict;
  minClearanceMm: number | null;
  fdmToleranceMm: number;
  joints: JointFitResult[];
  blockingJoints: JointFitResult[];
  warnings: string[];
  summary: string;
  strength: StrengthReport;
}

interface SubCut {
  id: string;
  kind: 'box-cut' | 'hole';
  box?: Box3;
  axis?: 0 | 1 | 2;
  center?: [number, number];
  radius?: number;
  span?: [number, number];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const fmtMm = (n: number): string => `${n > 0 ? '+' : ''}${round3(n).toFixed(2)} mm`;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function shiftBox(b: Box3, d: Vec3): Box3 {
  return {
    min: [b.min[0] + d[0], b.min[1] + d[1], b.min[2] + d[2]],
    max: [b.max[0] + d[0], b.max[1] + d[1], b.max[2] + d[2]],
  };
}

function axisIndex(v: unknown): 0 | 1 | 2 {
  const s = typeof v === 'string' ? v.toLowerCase() : 'z';
  const i = AXES.indexOf(s as typeof AXES[number]);
  return (i >= 0 ? i : 2) as 0 | 1 | 2;
}

/** Extract a part's local outer envelope in CAD Studio's frame (X/Y centred, resting on Z = 0). */
export function partOuterEnvelope(part: CadPartSnapshot | null | undefined): PartEnvelope | null {
  if (!part || typeof part !== 'object') return null;
  const base = part.base && typeof part.base === 'object' ? part.base : null;
  if (base && base.kind === 'box') {
    const sx = num(base.sizeX), sy = num(base.sizeY), sz = num(base.sizeZ);
    if (sx && sy && sz && sx > 0 && sy > 0 && sz > 0) {
      return { kind: 'box', box: { min: [-sx / 2, -sy / 2, 0], max: [sx / 2, sy / 2, sz] } };
    }
  }
  if (base && base.kind === 'cylinder') {
    const d = num(base.diameter), h = num(base.height);
    if (d && h && d > 0 && h > 0) {
      const r = d / 2;
      return { kind: 'cylinder', diameter: d, height: h, box: { min: [-r, -r, 0], max: [r, r, h] } };
    }
  }
  const e = part.report && typeof part.report === 'object' ? (part.report as Record<string, unknown>).extentsMm : null;
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    const rec = e as Record<string, unknown>;
    if (Array.isArray(rec.min) && Array.isArray(rec.max) && rec.min.length === 3 && rec.max.length === 3) {
      const lo = rec.min.map(Number) as Vec3, hi = rec.max.map(Number) as Vec3;
      if (lo.every(Number.isFinite) && hi.every(Number.isFinite)) return { kind: 'bounds', box: { min: lo, max: hi } };
    }
    if (Array.isArray(rec.size) && rec.size.length === 3 && rec.size.every((x) => Number.isFinite(Number(x)))) {
      const [sx, sy, sz] = rec.size.map(Number);
      return { kind: 'bounds', box: { min: [-sx / 2, -sy / 2, 0], max: [sx / 2, sy / 2, sz] } };
    }
  }
  if (Array.isArray(e) && e.length === 3 && e.every((x) => Number.isFinite(Number(x)))) {
    const [sx, sy, sz] = e.map(Number);
    return { kind: 'bounds', box: { min: [-sx / 2, -sy / 2, 0], max: [sx / 2, sy / 2, sz] } };
  }
  return null;
}

function failedFeatureIds(part: CadPartSnapshot): Set<string> {
  const failed = new Set<string>();
  for (const st of Array.isArray(part.feature_status) ? part.feature_status : []) {
    if (st && st.ok === false && typeof st.id === 'string') failed.add(st.id);
  }
  return failed;
}

function parseBoxCut(f: CadFeatureRecord, index: number, shift: Vec3): SubCut | null {
  const p = f.params || {};
  if (!Array.isArray(p.size) || p.size.length !== 3 || !Array.isArray(p.center) || p.center.length !== 3) return null;
  const s = p.size.map(Number), c = p.center.map(Number);
  if (!s.every((x) => Number.isFinite(x) && x > 0) || !c.every(Number.isFinite)) return null;
  const box: Box3 = {
    min: [c[0] - s[0] / 2 + shift[0], c[1] - s[1] / 2 + shift[1], c[2] - s[2] / 2 + shift[2]],
    max: [c[0] + s[0] / 2 + shift[0], c[1] + s[1] / 2 + shift[1], c[2] + s[2] / 2 + shift[2]],
  };
  return { id: f.id || `box-cut-${index + 1}`, kind: 'box-cut', box };
}

function parseHoleCut(f: CadFeatureRecord, index: number, hostBox: Box3, shift: Vec3): SubCut | null {
  const p = f.params || {};
  const d = num(p.diameter);
  if (!d || d <= 0) return null;
  const ax = axisIndex(p.axis);
  const perp = ([0, 1, 2] as const).filter((k) => k !== ax);
  const coord = (k: 0 | 1 | 2): number => num(p[AXES[k]]) ?? (k === 2 ? (hostBox.min[2] + hostBox.max[2]) / 2 - shift[2] : 0);
  const center: [number, number] = [coord(perp[0]) + shift[perp[0]], coord(perp[1]) + shift[perp[1]]];
  const depth = num(p.depth);
  const through = p.through !== false && depth === null;
  const span: [number, number] = through ? [hostBox.min[ax] - 1, hostBox.max[ax] + 1] : [hostBox.max[ax] - Math.max(0, depth || 0), hostBox.max[ax] + 1];
  return { id: f.id || `hole-${index + 1}`, kind: 'hole', axis: ax, center, radius: d / 2, span };
}

function activeSubtractions(part: CadPartSnapshot, hostBox: Box3, shift: Vec3): SubCut[] {
  const failed = failedFeatureIds(part);
  const out: SubCut[] = [];
  (Array.isArray(part.features) ? part.features : []).forEach((f, i) => {
    if (!f || f.enabled === false) return;
    if (f.id && failed.has(f.id)) return;
    if (f.type === 'box-cut') { const cut = parseBoxCut(f, i, shift); if (cut) out.push(cut); }
    else if (f.type === 'hole') { const cut = parseHoleCut(f, i, hostBox, shift); if (cut) out.push(cut); }
  });
  return out;
}

function overlapBox(a: Box3, b: Box3): Box3 {
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  };
}

function boxCutClearance(cut: Box3, mate: Box3, overlap: Box3): number {
  let best = -Infinity;
  for (const tAxis of [0, 1, 2] as const) {
    const perp = ([0, 1, 2] as const).filter((k) => k !== tAxis);
    const walls = perp.flatMap((u) => [mate.min[u] - cut.min[u], cut.max[u] - mate.max[u]]);
    const axialLo = overlap.min[tAxis] - cut.min[tAxis];
    const axialHi = cut.max[tAxis] - overlap.max[tAxis];
    const throughOk = axialLo >= -EPS && axialHi >= -EPS;
    const minWall = Math.min(...walls);
    const score = throughOk ? minWall : Math.min(minWall, axialLo, axialHi);
    if (score > best) best = score;
  }
  return best;
}

function holeClearance(cut: SubCut, mateEnv: PartEnvelope, mateBox: Box3, overlap: Box3): number {
  const ax = cut.axis as 0 | 1 | 2;
  const perp = ([0, 1, 2] as const).filter((k) => k !== ax);
  const [cu, cv] = cut.center as [number, number];
  const rHole = cut.radius as number;
  const [sLo, sHi] = cut.span as [number, number];
  let radial: number;
  if (mateEnv.kind === 'cylinder' && ax === 2 && mateEnv.diameter) {
    const mu = (mateBox.min[perp[0]] + mateBox.max[perp[0]]) / 2;
    const mv = (mateBox.min[perp[1]] + mateBox.max[perp[1]]) / 2;
    radial = rHole - mateEnv.diameter / 2 - Math.hypot(mu - cu, mv - cv);
  } else {
    const du = Math.max(Math.abs(mateBox.min[perp[0]] - cu), Math.abs(mateBox.max[perp[0]] - cu));
    const dv = Math.max(Math.abs(mateBox.min[perp[1]] - cv), Math.abs(mateBox.max[perp[1]] - cv));
    radial = rHole - Math.hypot(du, dv);
  }
  const axialLo = overlap.min[ax] - sLo;
  const axialHi = sHi - overlap.max[ax];
  return axialLo >= -EPS && axialHi >= -EPS ? radial : Math.min(radial, axialLo, axialHi);
}

function bestFeatureClearance(host: CadPartSnapshot, hostBox: Box3, hostShift: Vec3, mateEnv: PartEnvelope, mateBox: Box3, overlap: Box3): { clearance: number; id: string } | null {
  const cuts = activeSubtractions(host, hostBox, hostShift);
  let best: { clearance: number; id: string } | null = null;
  for (const cut of cuts) {
    const clearance = cut.kind === 'box-cut' && cut.box ? boxCutClearance(cut.box, mateBox, overlap) : holeClearance(cut, mateEnv, mateBox, overlap);
    if (!best || clearance > best.clearance) best = { clearance, id: cut.id };
  }
  return best;
}

function unverifiedJoint(joint: MechanismJoint, reason: string, fdmToleranceMm: number): JointFitResult {
  return { jointId: joint.id, parent: joint.parent, child: joint.child, type: joint.type, verdict: 'unverified', clearanceMm: null, fdmToleranceMm, tightFit: false, warning: null, reason, matingFeature: null };
}

/** Evaluate one joint's signed clearance in mm between its parent and child CAD parts. */
export function evaluateJointFit(joint: MechanismJoint, parentPart: CadPartSnapshot | null | undefined, childPart: CadPartSnapshot | null | undefined, fdmToleranceMm = FDM_TOLERANCE_MM): JointFitResult {
  if (!parentPart) return unverifiedJoint(joint, `parent part ${joint.parent} was not read from CAD Studio`, fdmToleranceMm);
  if (!childPart) return unverifiedJoint(joint, `child part ${joint.child} was not read from CAD Studio`, fdmToleranceMm);
  if (parentPart.state && parentPart.state !== 'built') return unverifiedJoint(joint, `parent part ${joint.parent} is ${parentPart.state}, not built`, fdmToleranceMm);
  if (childPart.state && childPart.state !== 'built') return unverifiedJoint(joint, `child part ${joint.child} is ${childPart.state}, not built`, fdmToleranceMm);
  const pEnv = partOuterEnvelope(parentPart), cEnv = partOuterEnvelope(childPart);
  if (!pEnv || !cEnv) return unverifiedJoint(joint, `geometry extents missing for ${!pEnv ? joint.parent : joint.child}`, fdmToleranceMm);
  const origin: Vec3 = Array.isArray(joint.originMm) && joint.originMm.length === 3 ? joint.originMm : [0, 0, 0];
  const pBox = pEnv.box;
  const cBox = shiftBox(cEnv.box, origin);
  const gaps = [0, 1, 2].map((k) => Math.max(cBox.min[k] - pBox.max[k], pBox.min[k] - cBox.max[k]));
  const maxGap = Math.max(...gaps);
  let clearance = maxGap;
  let matingFeature: string | null = null;
  if (maxGap < -EPS) {
    const ov = overlapBox(pBox, cBox);
    const byChild = bestFeatureClearance(childPart, cBox, origin, pEnv, pBox, ov);
    const byParent = bestFeatureClearance(parentPart, pBox, [0, 0, 0], cEnv, cBox, ov);
    const pick = byChild && byParent ? (byChild.clearance >= byParent.clearance ? byChild : byParent) : (byChild || byParent);
    if (pick && pick.clearance > maxGap) { clearance = pick.clearance; matingFeature = pick.id; }
  }
  const rounded = round3(Math.abs(clearance) < EPS ? 0 : clearance);
  if (rounded < 0) {
    const via = matingFeature ? ` through feature ${matingFeature}` : ' (no mating pocket or bore clears the overlap)';
    return { jointId: joint.id, parent: joint.parent, child: joint.child, type: joint.type, verdict: 'interference', clearanceMm: rounded, fdmToleranceMm, tightFit: false, warning: null, reason: `${fmtMm(rounded)} interference between ${joint.parent} and ${joint.child}${via}`, matingFeature };
  }
  const tightFit = joint.type !== 'fixed' && rounded < fdmToleranceMm;
  const warning = tightFit ? `tight clearance (${fmtMm(rounded)} < ${fdmToleranceMm.toFixed(2)} mm FDM tolerance on ${joint.type} joint ${joint.id})` : null;
  const via = matingFeature ? ` via ${matingFeature}` : rounded === 0 ? ' (line-to-line contact)' : ' (separated envelopes)';
  return { jointId: joint.id, parent: joint.parent, child: joint.child, type: joint.type, verdict: 'fit', clearanceMm: rounded, fdmToleranceMm, tightFit, warning, reason: `${fmtMm(rounded)} clearance${via}`, matingFeature };
}

function detectNamedLoad(brief?: Brief | null, mechanism?: Mechanism | null): string | null {
  if (mechanism?.payload && Number.isFinite(mechanism.payload.massKg) && mechanism.payload.massKg > 0) {
    return `${mechanism.payload.massKg} kg payload on ${mechanism.payload.attachedTo}`;
  }
  if (mechanism?.task && mechanism.task.loadKg && mechanism.task.loadKg > 0) {
    return mechanism.task.line ? `${mechanism.task.loadKg} kg (${mechanism.task.line})` : `${mechanism.task.loadKg} kg task load`;
  }
  for (const line of brief?.requirements || []) {
    const m = LOAD_RE.exec(line);
    if (m) return `${m[1]} ${m[2]} (${line.trim()})`;
  }
  const wordLine = (brief?.requirements || []).find((l) => LOAD_WORD_RE.test(l));
  return wordLine ? wordLine.trim() : null;
}

function readMeasuredStrength(binding?: Artifact | null): Record<string, unknown> | null {
  const fromRead = binding?.read && typeof binding.read === 'object' ? (binding.read as Record<string, unknown>).strength : null;
  const raw = fromRead && typeof fromRead === 'object' ? fromRead : binding && typeof binding.strength === 'object' ? binding.strength : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const engine = typeof rec.engine === 'string' ? rec.engine.trim() : '';
  const sf = num(rec.safetyFactor);
  if (!engine || engine === 'reasoned' || sf === null || sf <= 0) return null;
  return rec;
}

/** Report measured engine strength for a named load, or explicitly state none has been measured. */
export function evaluateStrength(brief?: Brief | null, mechanism?: Mechanism | null, binding?: Artifact | null): StrengthReport {
  const loadLabel = detectNamedLoad(brief, mechanism);
  const measured = readMeasuredStrength(binding);
  if (measured) {
    const engine = String(measured.engine).trim();
    const sf = round3(Number(measured.safetyFactor));
    const maxMpa = num(measured.maxStressMpa);
    const allowMpa = num(measured.allowableStressMpa);
    const label = typeof measured.loadLabel === 'string' && measured.loadLabel.trim() ? measured.loadLabel.trim() : loadLabel;
    const status: StrengthStatus = sf >= 1.5 ? 'ok' : sf >= 1 ? 'warn' : 'bad';
    const stressPart = maxMpa !== null && allowMpa !== null ? ` (${round3(maxMpa)} MPa / ${round3(allowMpa)} MPa)` : maxMpa !== null ? ` (${round3(maxMpa)} MPa max)` : '';
    const line = `Strength${label ? ` for ${label}` : ''}: safety factor ${sf.toFixed(2)}${stressPart} measured by ${engine}`;
    return { loadLabel: label || null, measured: true, status, engine, safetyFactor: sf, maxStressMpa: maxMpa, allowableStressMpa: allowMpa, line };
  }
  const line = loadLabel
    ? `No engine strength estimate measured for ${loadLabel} — CAD Studio and the box plant do not verify printed wall or joint stress.`
    : 'No engine strength estimate measured — no structural solver ran on these parts.';
  return { loadLabel, measured: false, status: 'unmeasured', engine: null, safetyFactor: null, maxStressMpa: null, allowableStressMpa: null, line };
}

function resolvePartSnapshot(partId: string, mechanism: Mechanism, parts: CadPartSnapshot[], binding?: Artifact | null): CadPartSnapshot | null {
  const mechPart = (mechanism.parts || []).find((p: MechanismPart) => p.id === partId);
  const modelMap = new Map<string, string>();
  if (binding && Array.isArray(binding.models)) {
    for (const m of binding.models as Array<Record<string, unknown>>) {
      if (typeof m.partId === 'string' && typeof m.modelId === 'string') modelMap.set(m.partId, m.modelId);
    }
  }
  const targetModelId = mechPart?.modelId || modelMap.get(partId) || null;
  return parts.find((p) => {
    const mid = p.model_id || p.modelId || null;
    if (targetModelId && mid === targetModelId) return true;
    if (p.id === partId || mid === partId) return true;
    const ds = p.source && typeof p.source === 'object' ? (p.source as Record<string, unknown>).designStudio as Record<string, unknown> | undefined : undefined;
    return Boolean(ds && ds.part === partId);
  }) || null;
}

/** Evaluate every joint in a mechanism against CAD Studio part geometry plus load/strength honesty. */
export function evaluateDesignFit(input: { brief?: Brief | null; mechanism?: Mechanism | null; binding?: Artifact | null; parts?: CadPartSnapshot[]; fdmToleranceMm?: number }): DesignFitReport {
  const tol = Number.isFinite(input.fdmToleranceMm) && (input.fdmToleranceMm as number) > 0 ? Number(input.fdmToleranceMm) : FDM_TOLERANCE_MM;
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const strength = evaluateStrength(input.brief, input.mechanism, input.binding);
  const mech = input.mechanism;
  if (!mech || !Array.isArray(mech.joints) || !mech.joints.length) {
    return { ok: true, verdict: 'fit', minClearanceMm: null, fdmToleranceMm: tol, joints: [], blockingJoints: [], warnings: [], summary: 'no mechanism joints defined to check fit', strength };
  }
  const joints = mech.joints.map((j) => evaluateJointFit(j, resolvePartSnapshot(j.parent, mech, parts, input.binding), resolvePartSnapshot(j.child, mech, parts, input.binding), tol));
  const blockingJoints = joints.filter((j) => j.verdict !== 'fit');
  const interfering = joints.filter((j) => j.verdict === 'interference');
  const verdict: FitVerdict = interfering.length ? 'interference' : blockingJoints.length ? 'unverified' : 'fit';
  const measuredClearances = joints.map((j) => j.clearanceMm).filter((v): v is number => v !== null);
  const minClearanceMm = measuredClearances.length ? round3(Math.min(...measuredClearances)) : null;
  const warnings = joints.map((j) => j.warning).filter((w): w is string => Boolean(w));
  const summary = verdict === 'interference'
    ? interfering.map((j) => `joint ${j.jointId} (${j.parent} / ${j.child}): ${fmtMm(j.clearanceMm as number)} interference`).join('; ')
    : verdict === 'unverified'
      ? blockingJoints.map((j) => `joint ${j.jointId} (${j.parent} / ${j.child}): unverified (${j.reason})`).join('; ')
      : `fit check: ${joints.map((j) => `${j.jointId} ${fmtMm(j.clearanceMm as number)}`).join(', ')}${warnings.length ? ` · warning: ${warnings.join('; ')}` : ''}`;
  return { ok: verdict === 'fit', verdict, minClearanceMm, fdmToleranceMm: tol, joints, blockingJoints, warnings, summary, strength };
}
