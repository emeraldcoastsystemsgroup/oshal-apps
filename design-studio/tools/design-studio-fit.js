/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B9: browser joint fit / interference clearance check and
 *                     |                             | honest strength reporting for Design Studio. Mirrors
 *                     |                             | src-routes/fit-check.ts over CAD Studio part snapshots read in
 *                     |                             | the caller's session so the Design poster answers fit or
 *                     |                             | interference in mm, blocks parts-complete on interference, and
 *                     |                             | reports measured engine strength or explicitly says none is.
 */
window.DesignStudioFit = (function designStudioFit() {
  'use strict';
  const FDM_TOLERANCE_MM = 0.2;
  const EPS = 1e-6;
  const AXES = ['x', 'y', 'z'];
  const LOAD_RE = /\b(\d+(?:\.\d+)?)\s*(kg|g|lb|lbs|n|kn)\b/i;
  const LOAD_WORD_RE = /\b(lift|lifts|raise|raises|hoist|hoists|carry|carries|hold|holds|support|supports|load|weight|force|stress|strength)\b/i;

  const round3 = (n) => Math.round(n * 1000) / 1000;
  const fmtMm = (n) => `${n > 0 ? '+' : ''}${round3(n).toFixed(2)} mm`;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

  function shiftBox(b, d) {
    return {
      min: [b.min[0] + d[0], b.min[1] + d[1], b.min[2] + d[2]],
      max: [b.max[0] + d[0], b.max[1] + d[1], b.max[2] + d[2]],
    };
  }
  function axisIndex(v) {
    const s = typeof v === 'string' ? v.toLowerCase() : 'z';
    const i = AXES.indexOf(s);
    return i >= 0 ? i : 2;
  }

  function partOuterEnvelope(part) {
    if (!part || typeof part !== 'object') return null;
    const base = part.base && typeof part.base === 'object' ? part.base : null;
    if (base && base.kind === 'box') {
      const sx = num(base.sizeX), sy = num(base.sizeY), sz = num(base.sizeZ);
      if (sx && sy && sz && sx > 0 && sy > 0 && sz > 0) return { kind: 'box', box: { min: [-sx / 2, -sy / 2, 0], max: [sx / 2, sy / 2, sz] } };
    }
    if (base && base.kind === 'cylinder') {
      const d = num(base.diameter), h = num(base.height);
      if (d && h && d > 0 && h > 0) { const r = d / 2; return { kind: 'cylinder', diameter: d, height: h, box: { min: [-r, -r, 0], max: [r, r, h] } }; }
    }
    const e = part.report && typeof part.report === 'object' ? part.report.extentsMm : null;
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      if (Array.isArray(e.min) && Array.isArray(e.max) && e.min.length === 3 && e.max.length === 3) {
        const lo = e.min.map(Number), hi = e.max.map(Number);
        if (lo.every(Number.isFinite) && hi.every(Number.isFinite)) return { kind: 'bounds', box: { min: lo, max: hi } };
      }
      if (Array.isArray(e.size) && e.size.length === 3 && e.size.every((x) => Number.isFinite(Number(x)))) {
        const [sx, sy, sz] = e.size.map(Number);
        return { kind: 'bounds', box: { min: [-sx / 2, -sy / 2, 0], max: [sx / 2, sy / 2, sz] } };
      }
    }
    if (Array.isArray(e) && e.length === 3 && e.every((x) => Number.isFinite(Number(x)))) {
      const [sx, sy, sz] = e.map(Number);
      return { kind: 'bounds', box: { min: [-sx / 2, -sy / 2, 0], max: [sx / 2, sy / 2, sz] } };
    }
    return null;
  }

  function failedFeatureIds(part) {
    const failed = new Set();
    for (const st of Array.isArray(part.feature_status) ? part.feature_status : []) {
      if (st && st.ok === false && typeof st.id === 'string') failed.add(st.id);
    }
    return failed;
  }
  function parseBoxCut(f, index, shift) {
    const p = f.params || {};
    if (!Array.isArray(p.size) || p.size.length !== 3 || !Array.isArray(p.center) || p.center.length !== 3) return null;
    const s = p.size.map(Number), c = p.center.map(Number);
    if (!s.every((x) => Number.isFinite(x) && x > 0) || !c.every(Number.isFinite)) return null;
    return { id: f.id || `box-cut-${index + 1}`, kind: 'box-cut', box: { min: [c[0] - s[0] / 2 + shift[0], c[1] - s[1] / 2 + shift[1], c[2] - s[2] / 2 + shift[2]], max: [c[0] + s[0] / 2 + shift[0], c[1] + s[1] / 2 + shift[1], c[2] + s[2] / 2 + shift[2]] } };
  }
  function parseHoleCut(f, index, hostBox, shift) {
    const p = f.params || {};
    const d = num(p.diameter);
    if (!d || d <= 0) return null;
    const ax = axisIndex(p.axis);
    const perp = [0, 1, 2].filter((k) => k !== ax);
    const coord = (k) => { const v = num(p[AXES[k]]); return v !== null ? v : (k === 2 ? (hostBox.min[2] + hostBox.max[2]) / 2 - shift[2] : 0); };
    const center = [coord(perp[0]) + shift[perp[0]], coord(perp[1]) + shift[perp[1]]];
    const depth = num(p.depth);
    const through = p.through !== false && depth === null;
    const span = through ? [hostBox.min[ax] - 1, hostBox.max[ax] + 1] : [hostBox.max[ax] - Math.max(0, depth || 0), hostBox.max[ax] + 1];
    return { id: f.id || `hole-${index + 1}`, kind: 'hole', axis: ax, center, radius: d / 2, span };
  }
  function activeSubtractions(part, hostBox, shift) {
    const failed = failedFeatureIds(part);
    const out = [];
    (Array.isArray(part.features) ? part.features : []).forEach((f, i) => {
      if (!f || f.enabled === false) return;
      if (f.id && failed.has(f.id)) return;
      if (f.type === 'box-cut') { const cut = parseBoxCut(f, i, shift); if (cut) out.push(cut); }
      else if (f.type === 'hole') { const cut = parseHoleCut(f, i, hostBox, shift); if (cut) out.push(cut); }
    });
    return out;
  }

  function overlapBox(a, b) {
    return {
      min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
      max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
    };
  }
  function boxCutClearance(cut, mate, overlap) {
    let best = -Infinity;
    for (const tAxis of [0, 1, 2]) {
      const perp = [0, 1, 2].filter((k) => k !== tAxis);
      const walls = perp.flatMap((u) => [mate.min[u] - cut.min[u], cut.max[u] - mate.max[u]]);
      const axialLo = overlap.min[tAxis] - cut.min[tAxis];
      const axialHi = cut.max[tAxis] - overlap.max[tAxis];
      const minWall = Math.min(...walls);
      const score = axialLo >= -EPS && axialHi >= -EPS ? minWall : Math.min(minWall, axialLo, axialHi);
      if (score > best) best = score;
    }
    return best;
  }
  function holeClearance(cut, mateEnv, mateBox, overlap) {
    const ax = cut.axis;
    const perp = [0, 1, 2].filter((k) => k !== ax);
    const [cu, cv] = cut.center;
    let radial;
    if (mateEnv.kind === 'cylinder' && ax === 2 && mateEnv.diameter) {
      const mu = (mateBox.min[perp[0]] + mateBox.max[perp[0]]) / 2;
      const mv = (mateBox.min[perp[1]] + mateBox.max[perp[1]]) / 2;
      radial = cut.radius - mateEnv.diameter / 2 - Math.hypot(mu - cu, mv - cv);
    } else {
      const du = Math.max(Math.abs(mateBox.min[perp[0]] - cu), Math.abs(mateBox.max[perp[0]] - cu));
      const dv = Math.max(Math.abs(mateBox.min[perp[1]] - cv), Math.abs(mateBox.max[perp[1]] - cv));
      radial = cut.radius - Math.hypot(du, dv);
    }
    const axialLo = overlap.min[ax] - cut.span[0];
    const axialHi = cut.span[1] - overlap.max[ax];
    return axialLo >= -EPS && axialHi >= -EPS ? radial : Math.min(radial, axialLo, axialHi);
  }
  function bestFeatureClearance(host, hostBox, hostShift, mateEnv, mateBox, overlap) {
    let best = null;
    for (const cut of activeSubtractions(host, hostBox, hostShift)) {
      const clearance = cut.kind === 'box-cut' && cut.box ? boxCutClearance(cut.box, mateBox, overlap) : holeClearance(cut, mateEnv, mateBox, overlap);
      if (!best || clearance > best.clearance) best = { clearance, id: cut.id };
    }
    return best;
  }

  function unverifiedJoint(joint, reason, fdmToleranceMm) {
    return { jointId: joint.id, parent: joint.parent, child: joint.child, type: joint.type, verdict: 'unverified', clearanceMm: null, fdmToleranceMm, tightFit: false, warning: null, reason, matingFeature: null };
  }
  function evaluateJointFit(joint, parentPart, childPart, fdmToleranceMm) {
    const tol = Number.isFinite(fdmToleranceMm) && fdmToleranceMm > 0 ? fdmToleranceMm : FDM_TOLERANCE_MM;
    if (!parentPart) return unverifiedJoint(joint, `parent part ${joint.parent} was not read from CAD Studio`, tol);
    if (!childPart) return unverifiedJoint(joint, `child part ${joint.child} was not read from CAD Studio`, tol);
    if (parentPart.state && parentPart.state !== 'built') return unverifiedJoint(joint, `parent part ${joint.parent} is ${parentPart.state}, not built`, tol);
    if (childPart.state && childPart.state !== 'built') return unverifiedJoint(joint, `child part ${joint.child} is ${childPart.state}, not built`, tol);
    const pEnv = partOuterEnvelope(parentPart), cEnv = partOuterEnvelope(childPart);
    if (!pEnv || !cEnv) return unverifiedJoint(joint, `geometry extents missing for ${!pEnv ? joint.parent : joint.child}`, tol);
    const origin = Array.isArray(joint.originMm) && joint.originMm.length === 3 ? joint.originMm : [0, 0, 0];
    const pBox = pEnv.box, cBox = shiftBox(cEnv.box, origin);
    const maxGap = Math.max(...[0, 1, 2].map((k) => Math.max(cBox.min[k] - pBox.max[k], pBox.min[k] - cBox.max[k])));
    let clearance = maxGap, matingFeature = null;
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
      return { jointId: joint.id, parent: joint.parent, child: joint.child, type: joint.type, verdict: 'interference', clearanceMm: rounded, fdmToleranceMm: tol, tightFit: false, warning: null, reason: `${fmtMm(rounded)} interference between ${joint.parent} and ${joint.child}${via}`, matingFeature };
    }
    const tightFit = joint.type !== 'fixed' && rounded < tol;
    const warning = tightFit ? `tight clearance (${fmtMm(rounded)} < ${tol.toFixed(2)} mm FDM tolerance on ${joint.type} joint ${joint.id})` : null;
    const via = matingFeature ? ` via ${matingFeature}` : rounded === 0 ? ' (line-to-line contact)' : ' (separated envelopes)';
    return { jointId: joint.id, parent: joint.parent, child: joint.child, type: joint.type, verdict: 'fit', clearanceMm: rounded, fdmToleranceMm: tol, tightFit, warning, reason: `${fmtMm(rounded)} clearance${via}`, matingFeature };
  }

  function detectNamedLoad(brief, mechanism) {
    if (mechanism && mechanism.payload && Number.isFinite(mechanism.payload.massKg) && mechanism.payload.massKg > 0) {
      return `${mechanism.payload.massKg} kg payload on ${mechanism.payload.attachedTo}`;
    }
    if (mechanism && mechanism.task && mechanism.task.loadKg > 0) {
      return mechanism.task.line ? `${mechanism.task.loadKg} kg (${mechanism.task.line})` : `${mechanism.task.loadKg} kg task load`;
    }
    const reqs = (brief && Array.isArray(brief.requirements)) ? brief.requirements : [];
    for (const line of reqs) { const m = LOAD_RE.exec(line); if (m) return `${m[1]} ${m[2]} (${String(line).trim()})`; }
    const wordLine = reqs.find((l) => LOAD_WORD_RE.test(l));
    return wordLine ? String(wordLine).trim() : null;
  }
  function evaluateStrength(brief, mechanism, binding) {
    const loadLabel = detectNamedLoad(brief, mechanism);
    const a = binding && binding.artifact ? binding.artifact : binding;
    const raw = (a && a.read && typeof a.read.strength === 'object' && a.read.strength) || (a && typeof a.strength === 'object' && a.strength) || null;
    const engine = raw && typeof raw.engine === 'string' ? raw.engine.trim() : '';
    const sf = raw ? num(raw.safetyFactor) : null;
    if (engine && engine !== 'reasoned' && sf !== null && sf > 0) {
      const maxMpa = num(raw.maxStressMpa), allowMpa = num(raw.allowableStressMpa);
      const label = typeof raw.loadLabel === 'string' && raw.loadLabel.trim() ? raw.loadLabel.trim() : loadLabel;
      const status = sf >= 1.5 ? 'ok' : sf >= 1 ? 'warn' : 'bad';
      const stressPart = maxMpa !== null && allowMpa !== null ? ` (${round3(maxMpa)} MPa / ${round3(allowMpa)} MPa)` : maxMpa !== null ? ` (${round3(maxMpa)} MPa max)` : '';
      return { loadLabel: label || null, measured: true, status, engine, safetyFactor: round3(sf), maxStressMpa: maxMpa, allowableStressMpa: allowMpa, line: `Strength${label ? ` for ${label}` : ''}: safety factor ${round3(sf).toFixed(2)}${stressPart} measured by ${engine}` };
    }
    const line = loadLabel
      ? `No engine strength estimate measured for ${loadLabel} — CAD Studio and the box plant do not verify printed wall or joint stress.`
      : 'No engine strength estimate measured — no structural solver ran on these parts.';
    return { loadLabel, measured: false, status: 'unmeasured', engine: null, safetyFactor: null, maxStressMpa: null, allowableStressMpa: null, line };
  }

  function resolvePartSnapshot(partId, mechanism, parts, binding) {
    const a = binding && binding.artifact ? binding.artifact : binding;
    const mechPart = (mechanism.parts || []).find((p) => p.id === partId);
    const modelMap = new Map();
    if (a && Array.isArray(a.models)) for (const m of a.models) if (m && m.partId && m.modelId) modelMap.set(m.partId, m.modelId);
    const targetModelId = (mechPart && mechPart.modelId) || modelMap.get(partId) || null;
    return parts.find((p) => {
      const mid = p.model_id || p.modelId || null;
      if (targetModelId && mid === targetModelId) return true;
      if (p.id === partId || mid === partId) return true;
      const ds = p.source && p.source.designStudio;
      return Boolean(ds && ds.part === partId);
    }) || null;
  }
  function evaluateDesignFit(input) {
    const o = input || {};
    const tol = Number.isFinite(o.fdmToleranceMm) && o.fdmToleranceMm > 0 ? Number(o.fdmToleranceMm) : FDM_TOLERANCE_MM;
    const parts = Array.isArray(o.parts) ? o.parts : [];
    const strength = evaluateStrength(o.brief, o.mechanism, o.binding);
    const mech = o.mechanism;
    if (!mech || !Array.isArray(mech.joints) || !mech.joints.length) {
      return { ok: true, verdict: 'fit', minClearanceMm: null, fdmToleranceMm: tol, joints: [], blockingJoints: [], warnings: [], summary: 'no mechanism joints defined to check fit', strength };
    }
    const joints = mech.joints.map((j) => evaluateJointFit(j, resolvePartSnapshot(j.parent, mech, parts, o.binding), resolvePartSnapshot(j.child, mech, parts, o.binding), tol));
    const blockingJoints = joints.filter((j) => j.verdict !== 'fit');
    const interfering = joints.filter((j) => j.verdict === 'interference');
    const verdict = interfering.length ? 'interference' : blockingJoints.length ? 'unverified' : 'fit';
    const clearances = joints.map((j) => j.clearanceMm).filter((v) => v !== null);
    const minClearanceMm = clearances.length ? round3(Math.min(...clearances)) : null;
    const warnings = joints.map((j) => j.warning).filter(Boolean);
    const summary = verdict === 'interference'
      ? interfering.map((j) => `joint ${j.jointId} (${j.parent} / ${j.child}): ${fmtMm(j.clearanceMm)} interference`).join('; ')
      : verdict === 'unverified'
        ? blockingJoints.map((j) => `joint ${j.jointId} (${j.parent} / ${j.child}): unverified (${j.reason})`).join('; ')
        : `fit check: ${joints.map((j) => `${j.jointId} ${fmtMm(j.clearanceMm)}`).join(', ')}${warnings.length ? ` · warning: ${warnings.join('; ')}` : ''}`;
    return { ok: verdict === 'fit', verdict, minClearanceMm, fdmToleranceMm: tol, joints, blockingJoints, warnings, summary, strength };
  }

  return { FDM_TOLERANCE_MM, partOuterEnvelope, evaluateJointFit, evaluateStrength, evaluateDesignFit };
}());
