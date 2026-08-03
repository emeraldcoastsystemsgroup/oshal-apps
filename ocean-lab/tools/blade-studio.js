/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — Blade Studio's model half: a client-side
 *                     |                             | mirror of @/features/rotor-design (panel method, Viterna,
 *                     |                             | section polar, BEMT) wired straight into a mirror of
 *                     |                             | @/shared/energy, so moving a twist slider moves the battery
 *                     |                             | size on screen. The mirror exists for the same reason the
 *                     |                             | harvest console's does: the surface must stay usable with
 *                     |                             | the API absent, so the server is a CROSS-CHECK and never a
 *                     |                             | dependency — and the page says which mode it is in rather
 *                     |                             | than quietly degrading.
 *                     |                             |
 *                     |                             | Two deliberate departures from the server defaults, both
 *                     |                             | stated on the surface: 24 blade elements (server 48) and 40
 *                     |                             | panel stations per surface (server 80). They are the cost
 *                     |                             | of re-solving on every slider move; they move Cp by well
 *                     |                             | under a percent and they are exactly why the server's
 *                     |                             | verdict is shown beside the local one instead of instead
 *                     |                             | of it.
 */

/* global window, document, fetch */

(function (global) {
  'use strict';

  /**
   * @description The geometry and rendering half, which MUST already be loaded — the page's script
   * loader is sequential for exactly this reason. Captured once rather than dereferenced at every
   * call site so the dependency is stated in one place instead of implied in forty.
   */
  var V = global.BladeStudioGL;

  /* =========================================================================
   * 1. Constants and defaults.
   * ====================================================================== */

  /** @description The Betz limit, 16/27 — the ceiling on Cp for any rotor in open flow. */
  var BETZ_LIMIT = 16 / 27;
  /** @description Seawater density at coastal temperature and salinity, kg/m³. */
  var SEAWATER_DENSITY_KGM3 = 1025;
  /** @description Kinematic viscosity of seawater, m²/s. This is what sets section Reynolds. */
  var SEAWATER_VISCOSITY_M2S = 1.05e-6;
  /** @description Annular elements per solve. Below the server's 48 to stay live under a slider. */
  var ELEMENT_COUNT = 24;
  /** @description Chordwise panel stations per surface. Below the server's 80, for the same reason. */
  var PANEL_STATIONS = 40;
  /** @description Section Reynolds at 75 % span below which the 4-digit polar stops being reliable. */
  var LOW_REYNOLDS_THRESHOLD = 1e5;
  /** @description Simulated span for the energy budget, hours — one full spring/neap beat. */
  var BUDGET_HOURS = 720;
  /** @description Integration step for the energy budget, seconds. */
  var BUDGET_STEP_S = 120;

  /**
   * @description The illustrative tidal site the energy verdict is taken at. Constituents SUM — the
   * spring/neap beat that decides endurance is an emergent product of M2 and S2 drifting in and out
   * of phase every 14.77 days, never a parameter anyone sets. Plausible values over a real model;
   * NOT harmonic constants for any station.
   */
  var SITE = {
    name: 'Illustrative channel site',
    constituents: [
      { name: 'M2', periodHours: 12.4206, amplitudeMs: 1.35, phaseDeg: 0 },
      { name: 'S2', periodHours: 12.0, amplitudeMs: 0.42, phaseDeg: 35 },
      { name: 'K1', periodHours: 23.9345, amplitudeMs: 0.12, phaseDeg: 60 }
    ],
    residualMs: 0.05
  };

  /** @description The illustrative always-on load set, duty-cycle averaged. */
  var LOADS = [
    { name: 'Instrument suite', watts: 1.6, dutyCycle: 1 },
    { name: 'Acoustic modem', watts: 22, dutyCycle: 0.12 },
    { name: 'Edge compute', watts: 6.5, dutyCycle: 0.55 },
    { name: 'Anti-fouling heater', watts: 12, dutyCycle: 0.1 }
  ];

  /** @description The illustrative store. `capacityWh` is the nameplate the search overrides. */
  var STORAGE = { capacityWh: 1200, initialSocFraction: 0.6, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 };

  /**
   * @description The site's constituents with their angular frequency and phase already in radians.
   * Derived once because the budget evaluates the tide 21 600 times per run and twenty-odd runs per
   * store search — recomputing 2π/T inside that loop is pure waste.
   */
  var CONSTITUENTS = SITE.constituents.map(function (c) {
    return {
      omega: (2 * Math.PI) / (c.periodHours * 3600),
      amp: c.amplitudeMs,
      phase: (c.phaseDeg * Math.PI) / 180
    };
  });

  /** @description Drivetrain (generator + rectifier + MPPT) efficiency, 0..1. */
  var DRIVETRAIN_EFFICIENCY = 0.78;
  /** @description Flow speed below which the rotor produces nothing — bearing drag and cogging. */
  var CUT_IN_SPEED_MS = 0.35;
  /** @description Electrical clamp, W. Output above this is curtailed. */
  var RATED_POWER_W = 60;

  /** @description Opening design. A 150 mm rotor: a printable test article, not a recommendation. */
  var DEFAULTS = {
    tipRadiusM: 0.15, hubFrac: 0.25, bladeCount: 3, rootChordM: 0.042, tipChordM: 0.017,
    rootTwistDeg: 26, tipTwistDeg: 2.5, twistLaw: 'hyperbolic', pitchDeg: 0,
    naca: '4412', rootThickness: 0.18, freeStreamMs: 1, lambda: 5
  };

  /** @description How root twist is carried out to the tip. */
  var TWIST_LAWS = [
    { id: 'hyperbolic', label: 'Hyperbolic (Betz-like, 1/r)' },
    { id: 'linear', label: 'Linear in radius' },
    { id: 'cosine', label: 'Cosine (soft root)' }
  ];

  /**
   * @description Emit a structured warning shaped like the platform's Pino logger, so a surface
   * warning read in a browser console lines up with a server log line. No silent catches.
   * @param msg - What went wrong.
   * @param ctx - Structured context; never secrets.
   * @returns Nothing.
   */
  function surfaceWarn(msg, ctx) {
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn({ module: 'api:blade-studio', msg: msg, ctx: ctx || {} });
    }
  }

  /* =========================================================================
   * 2. Section aerodynamics — mirrors panel-method.ts, viterna.ts, section-polar.ts.
   * ====================================================================== */

  /** @description Angle used as the second sample when characterising a lift line, radians. */
  var LIFT_LINE_PROBE_RAD = 0.1;
  /** @description Memo of characterised lift lines. Panelling a section is pure, so caching is safe. */
  var liftLineCache = {};

  /**
   * @description Cut a closed profile into Hess-Smith panels, normalising the winding by MEASURING
   * the signed area rather than trusting the caller. That ordering — trailing edge, along the lower
   * surface, back along the upper — is what makes the Kutta condition "first panel and last panel".
   * @param points - Closed profile, closing point not repeated.
   * @returns Panel geometry.
   */
  function buildPanels(points) {
    var area = 0;
    for (var s = 0; s < points.length; s += 1) {
      var p = points[s];
      var q = points[(s + 1) % points.length];
      area += p.x * q.y - q.x * p.y;
    }
    var ring = area < 0 ? points.slice() : points.slice().reverse();
    var start = 0;
    for (var i = 1; i < ring.length; i += 1) if (ring[i].x > ring[start].x) start = i;
    var nodes = ring.slice(start).concat(ring.slice(0, start));
    nodes = nodes.concat([nodes[0]]);
    var panels = { nodes: nodes, controls: [], lengths: [], sines: [], cosines: [], count: nodes.length - 1 };
    for (var j = 0; j < panels.count; j += 1) {
      var dx = nodes[j + 1].x - nodes[j].x;
      var dy = nodes[j + 1].y - nodes[j].y;
      var len = Math.hypot(dx, dy) || 1e-12;
      panels.controls.push({ x: (nodes[j].x + nodes[j + 1].x) / 2, y: (nodes[j].y + nodes[j + 1].y) / 2 });
      panels.lengths.push(len);
      panels.sines.push(dy / len);
      panels.cosines.push(dx / len);
    }
    return panels;
  }

  /**
   * @description Velocity at control point i from a unit constant SOURCE sheet on panel j, in panel
   * j's own frame. The vortex result is the same pair rotated 90°, which is why only one is derived.
   * @param panels - Panel geometry.
   * @param i - Control-point index.
   * @param j - Influencing panel index.
   * @returns `{ along, across }`, each already divided by 2π.
   */
  function sourceInfluenceLocal(panels, i, j) {
    if (i === j) return { along: 0, across: 0.5 };
    var p = panels.controls[i];
    var a = panels.nodes[j];
    var b = panels.nodes[j + 1];
    var r1 = Math.hypot(p.x - a.x, p.y - a.y);
    var r2 = Math.hypot(p.x - b.x, p.y - b.y);
    var cross = (p.x - a.x) * (p.y - b.y) - (p.y - a.y) * (p.x - b.x);
    var dot = (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y);
    return { along: Math.log(r1 / r2) / (2 * Math.PI), across: Math.atan2(cross, dot) / (2 * Math.PI) };
  }

  /**
   * @description Normal and tangential influence of a unit source on every panel and of ONE vortex
   * strength shared by all panels. The single shared vortex is why this formulation stays stable at
   * cosine spacing: a per-panel vortex puts a near-singular block wherever two panels are short and
   * nearly collinear, which is precisely the leading edge.
   * @param panels - Panel geometry.
   * @returns `{ sourceNormal, sourceTangent, vortexNormal, vortexTangent }`.
   */
  function buildInfluence(panels) {
    var n = panels.count;
    var out = { sourceNormal: [], sourceTangent: [], vortexNormal: [], vortexTangent: [] };
    for (var i = 0; i < n; i += 1) {
      var nx = -panels.sines[i];
      var ny = panels.cosines[i];
      var tx = panels.cosines[i];
      var ty = panels.sines[i];
      out.sourceNormal.push([]);
      out.sourceTangent.push([]);
      out.vortexNormal.push(0);
      out.vortexTangent.push(0);
      for (var j = 0; j < n; j += 1) {
        var inf = sourceInfluenceLocal(panels, i, j);
        var cj = panels.cosines[j];
        var sj = panels.sines[j];
        var sx = inf.along * cj - inf.across * sj;
        var sy = inf.along * sj + inf.across * cj;
        var vx = inf.across * cj + inf.along * sj;
        var vy = inf.across * sj - inf.along * cj;
        out.sourceNormal[i][j] = sx * nx + sy * ny;
        out.sourceTangent[i][j] = sx * tx + sy * ty;
        out.vortexNormal[i] += vx * nx + vy * ny;
        out.vortexTangent[i] += vx * tx + vy * ty;
      }
    }
    return out;
  }

  /**
   * @description Solve `M x = b` for several right-hand sides by Gaussian elimination with partial
   * pivoting, sharing one elimination across all of them. Sharing matters: characterising a lift
   * line needs two angles of attack and the matrix is identical for both.
   * @param matrix - Square coefficient matrix.
   * @param rightSides - One vector per right-hand side.
   * @returns One solution vector per right-hand side, in order; null if the system is singular.
   */
  function solveLinearSystem(matrix, rightSides) {
    var n = matrix.length;
    var k = rightSides.length;
    var rows = matrix.map(function (row, i) {
      return row.concat(rightSides.map(function (side) { return side[i]; }));
    });
    for (var col = 0; col < n; col += 1) {
      var pivot = col;
      for (var r = col + 1; r < n; r += 1) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
      if (Math.abs(rows[pivot][col]) < 1e-14) return null;
      var swap = rows[col]; rows[col] = rows[pivot]; rows[pivot] = swap;
      for (var r2 = col + 1; r2 < n; r2 += 1) {
        var factor = rows[r2][col] / rows[col][col];
        if (factor === 0) continue;
        for (var c = col; c < n + k; c += 1) rows[r2][c] -= factor * rows[col][c];
      }
    }
    return rightSides.map(function (unused, side) {
      var x = new Array(n);
      for (var r3 = n - 1; r3 >= 0; r3 -= 1) {
        var sum = rows[r3][n + side];
        for (var c2 = r3 + 1; c2 < n; c2 += 1) sum -= rows[r3][c2] * x[c2];
        x[r3] = sum / rows[r3][r3];
      }
      return x;
    });
  }

  /**
   * @description The right-hand side for one angle of attack: minus the free-stream normal component
   * on each panel, plus the Kutta row over the two trailing-edge panels.
   * @param panels - Panel geometry.
   * @param alphaRad - Angle of attack, radians.
   * @returns The N+1 right-hand-side entries.
   */
  function kuttaRightSide(panels, alphaRad) {
    var n = panels.count;
    var ux = Math.cos(alphaRad);
    var uy = Math.sin(alphaRad);
    var side = new Array(n + 1);
    for (var i = 0; i < n; i += 1) side[i] = -(ux * -panels.sines[i] + uy * panels.cosines[i]);
    side[n] = -((ux * panels.cosines[0] + uy * panels.sines[0]) + (ux * panels.cosines[n - 1] + uy * panels.sines[n - 1]));
    return side;
  }

  /**
   * @description Characterise a section's inviscid lift line with TWO panel solves.
   *
   * The Hess-Smith matrix does not depend on the angle of attack — only the right-hand side does,
   * and it does so through `cos α` and `sin α`. So `Cl(α) = A cos α + B sin α` holds EXACTLY for
   * every α once A and B are known. That is not an interpolation; it is the linearity of the system,
   * and it is what makes it affordable to put a panel method inside a BEMT root-find.
   * @param spec - `{ maxCamber, camberPos, thickness }`.
   * @returns `{ cosCoefficient, sinCoefficient, zeroLiftAlphaRad, liftSlopePerRad }`.
   */
  function sectionLiftLine(spec) {
    var key = spec.maxCamber + ':' + spec.camberPos + ':' + spec.thickness;
    if (liftLineCache[key]) return liftLineCache[key];
    var panels = buildPanels(V.nacaSection(spec, PANEL_STATIONS));
    var influence = buildInfluence(panels);
    var n = panels.count;
    var matrix = [];
    for (var i = 0; i < n; i += 1) matrix.push(influence.sourceNormal[i].concat([influence.vortexNormal[i]]));
    var kutta = [];
    for (var j = 0; j < n; j += 1) kutta.push(influence.sourceTangent[0][j] + influence.sourceTangent[n - 1][j]);
    matrix.push(kutta.concat([influence.vortexTangent[0] + influence.vortexTangent[n - 1]]));
    var solved = solveLinearSystem(matrix, [kuttaRightSide(panels, 0), kuttaRightSide(panels, LIFT_LINE_PROBE_RAD)]);
    var line = solved ? liftLineFrom(solved, panels) : { cosCoefficient: 0, sinCoefficient: 2 * Math.PI, zeroLiftAlphaRad: 0, liftSlopePerRad: 2 * Math.PI };
    if (!solved) surfaceWarn('panel system was singular; fell back to thin-aerofoil theory', { spec: spec });
    liftLineCache[key] = line;
    return line;
  }

  /**
   * @description Turn the two panel solutions into the closed-form lift line.
   * @param solved - The two solution vectors.
   * @param panels - Panel geometry (its perimeter scales the circulation).
   * @returns The characterised lift line.
   */
  function liftLineFrom(solved, panels) {
    var perimeter = panels.lengths.reduce(function (sum, l) { return sum + l; }, 0);
    var cosCoefficient = 2 * solved[0][panels.count] * perimeter;
    var clProbe = 2 * solved[1][panels.count] * perimeter;
    var sinCoefficient = (clProbe - cosCoefficient * Math.cos(LIFT_LINE_PROBE_RAD)) / Math.sin(LIFT_LINE_PROBE_RAD);
    return {
      cosCoefficient: cosCoefficient,
      sinCoefficient: sinCoefficient,
      zeroLiftAlphaRad: Math.atan2(-cosCoefficient, sinCoefficient),
      liftSlopePerRad: sinCoefficient
    };
  }

  /**
   * @description Evaluate a characterised lift line. Exact for the inviscid problem.
   * @param line - The lift line.
   * @param alphaRad - Angle of attack, radians.
   * @returns Inviscid lift coefficient.
   */
  function liftLineCl(line, alphaRad) {
    return line.cosCoefficient * Math.cos(alphaRad) + line.sinCoefficient * Math.sin(alphaRad);
  }

  /**
   * @description Flat-plate skin friction, blended from Blasius to Prandtl-Schlichting across the
   * transition Reynolds. The blend is logistic in log-Reynolds rather than a hard switch so a
   * bisection differentiating through it does not see a step. An ESTIMATE: a flat plate is not an
   * aerofoil and the correlation knows nothing about the pressure gradient that sets transition.
   * @param reynolds - Section Reynolds number.
   * @returns One-sided skin-friction coefficient.
   */
  function skinFriction(reynolds) {
    var re = Math.max(reynolds, 1e3);
    var laminar = 1.328 / Math.sqrt(re);
    var turbulent = 0.455 / Math.pow(Math.log(re) / Math.LN10, 2.58);
    var weight = 1 / (1 + Math.exp(-(Math.log(re) - Math.log(5e5)) / 0.35));
    return (1 - weight) * laminar + weight * turbulent;
  }

  /**
   * @description Maximum lift a section reaches at a Reynolds number. It FALLS with Reynolds because
   * the boundary layer that has to survive the adverse gradient over the rear gets thinner and less
   * energetic — the same physics as the laminar-bubble drag penalty, showing up in lift instead.
   * @param reynolds - Section Reynolds number.
   * @returns Maximum lift coefficient.
   */
  function maxLiftCoefficient(reynolds) {
    var re = Math.max(reynolds, 1e3);
    return 1.5 * Math.pow(re / (re + 2e5), 0.35);
  }

  /**
   * @description The four Viterna coefficients, derived FROM the stall point so the extension
   * reproduces cl and cd there exactly. Continuity is a property of the construction, not of a blend
   * applied afterwards — and the BEMT bisection walks across that join constantly, so a jump there
   * would put a spurious root either side of it.
   * @param stall - `{ alphaStallRad, clStall, cdStall, aspectRatio }`.
   * @returns `{ a1, a2, b1, b2 }`.
   */
  function viternaCoefficients(stall) {
    var cdMax = stall.aspectRatio > 50 ? 2.01 : 1.11 + 0.018 * stall.aspectRatio;
    var sin = Math.sin(stall.alphaStallRad);
    var cos = Math.cos(stall.alphaStallRad);
    return {
      a1: cdMax / 2,
      a2: ((stall.clStall - cdMax * sin * cos) * sin) / (cos * cos),
      b1: cdMax,
      b2: (stall.cdStall - cdMax * sin * sin) / cos
    };
  }

  /**
   * @description Post-stall coefficients anywhere in `alphaStall ≤ |α| ≤ π`.
   *
   * This is not a nicety for exotic operating points: the induction bisection brackets the inflow
   * angle over the whole of (0, π/2], and at start-up or low tip-speed ratio that bracket genuinely
   * contains angles of attack of 40–90°. Without a polar defined there the residual has no sign
   * change and the solver has nothing to converge on. Odd in lift and even in drag about zero — a
   * fully separated section has lost the memory of its camber. Past π − alphaStall the Viterna lift
   * form has a 1/sin α factor and is singular, so lift tapers linearly to zero at reversed flow.
   * @param stall - The hand-over point, stated with a POSITIVE stall angle.
   * @param alphaRad - Angle of attack, radians.
   * @returns `{ cl, cd }`.
   */
  function viternaExtend(stall, alphaRad) {
    var wrapped = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));
    var mag = Math.abs(wrapped);
    var c = viternaCoefficients(stall);
    var branch = function (a) {
      return {
        cl: c.a1 * Math.sin(2 * a) + (c.a2 * Math.cos(a) * Math.cos(a)) / Math.sin(a),
        cd: c.b1 * Math.sin(a) * Math.sin(a) + c.b2 * Math.cos(a)
      };
    };
    var forward;
    if (mag <= Math.PI / 2) forward = branch(mag);
    else if (mag <= Math.PI - stall.alphaStallRad) {
      var m = branch(Math.PI - mag);
      forward = { cl: -0.7 * m.cl, cd: m.cd };
    } else {
      var edge = branch(stall.alphaStallRad);
      forward = { cl: -0.7 * edge.cl * ((Math.PI - mag) / stall.alphaStallRad), cd: edge.cd };
    }
    return wrapped >= 0 ? forward : { cl: -forward.cl, cd: forward.cd };
  }

  /** @description Memo of per-section constants. Keyed by value, so two identical sections share. */
  var sectionCacheStore = {};

  /**
   * @description Everything about a section that does NOT depend on the angle of attack or the
   * Reynolds number: its panelled lift line, the lift coefficient at the bottom of its drag bucket,
   * its Hoerner thickness form factor and its pressure-drag term.
   *
   * Hoisting these is not micro-optimisation. A single BEMT sweep evaluates the polar a quarter of a
   * million times, and rebuilding a cache key string per evaluation cost more than the physics did.
   * @param spec - The section.
   * @returns The cached constants.
   */
  function sectionCache(spec) {
    var key = spec.maxCamber + ':' + spec.camberPos + ':' + spec.thickness;
    if (sectionCacheStore[key]) return sectionCacheStore[key];
    var line = sectionLiftLine(spec);
    sectionCacheStore[key] = {
      line: line, clMinDrag: liftLineCl(line, 0), thickness: spec.thickness,
      formFactor: 1 + 2 * spec.thickness + 60 * Math.pow(spec.thickness, 4),
      pressure: 0.002 + 0.02 * spec.thickness * spec.thickness
    };
    return sectionCacheStore[key];
  }

  /**
   * @description Build a polar evaluator for ONE section at ONE Reynolds number, valid over the full
   * ±180° range.
   *
   * Splitting it this way is what makes a live solve affordable: the stall angles, the maximum lift
   * coefficient, the skin friction and the laminar-bubble penalty are all functions of Reynolds
   * ALONE, and the inflow bisection holds Reynolds fixed while it sweeps forty-odd angles. Computing
   * them once per pass instead of once per angle is a pure restructuring — the numbers are identical.
   *
   * Attached flow uses the panelled lift line, so `cl` there is a solved inviscid result with a
   * viscous ceiling applied on top. Past stall the Viterna extension takes over, stitched on AT the
   * stall point so the curve is continuous — the bisection walks across that join constantly and a
   * jump there would put a spurious root either side of it. The two stall angles are deliberately
   * not symmetric: the boundary layer that lets a cambered section reach cl = 1.4 nose-up gives out
   * sooner nose-down.
   *
   * `cd` is ALWAYS an estimate: flat-plate skin friction with a Hoerner thickness factor, a pressure
   * term, a drag bucket quadratic in the departure from minimum-drag lift, and a laminar-separation
   * penalty below Re ≈ 2×10⁵ that is deliberately NOT clamped. A 12 %-thick 4-digit section at
   * Re 7×10⁴ really does see its L/D fall into the low twenties, and saying so is the point.
   * @param cache - Section constants from {@link sectionCache}.
   * @param reynolds - Section Reynolds number, held fixed for this evaluator.
   * @param aspectRatio - Blade aspect ratio, for the Viterna flat-plate ceiling.
   * @param inviscidDrag - When true, force cd = 0 — the ideal-rotor limit.
   * @returns `(alphaRad) => { cl, cd }`.
   */
  function makePolar(cache, reynolds, aspectRatio, inviscidDrag) {
    var line = cache.line;
    var clMax = maxLiftCoefficient(reynolds);
    var slope = Math.max(line.liftSlopePerRad, 1e-3);
    var positive = Math.max(line.zeroLiftAlphaRad + clMax / slope, 0.02);
    var negative = Math.min(line.zeroLiftAlphaRad - (0.8 * clMax) / slope, -0.02);
    var excess = Math.max(0, Math.pow(2e5 / Math.max(reynolds, 1e3), 1.5) - 1);
    var base = 2 * skinFriction(reynolds) * cache.formFactor + cache.pressure
      + 0.0035 * (1 + 6 * cache.thickness) * excess;
    var drag = function (cl) { return base + 0.006 * (cl - cache.clMinDrag) * (cl - cache.clMinDrag); };
    var stalls = {};
    return function (alphaRad) {
      var alpha = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));
      if (alpha <= positive && alpha >= negative) {
        var cl = liftLineCl(line, alpha);
        return { cl: cl, cd: inviscidDrag ? 0 : drag(cl) };
      }
      var stallAngle = alpha > positive ? positive : negative;
      var sign = stallAngle >= 0 ? 1 : -1;
      var key = sign > 0 ? 'p' : 'n';
      if (!stalls[key]) {
        var clStall = liftLineCl(line, stallAngle);
        stalls[key] = {
          alphaStallRad: Math.max(Math.abs(stallAngle), 1e-3), clStall: sign * clStall,
          cdStall: drag(clStall), aspectRatio: aspectRatio
        };
      }
      var mirrored = viternaExtend(stalls[key], sign * alpha);
      return { cl: sign * mirrored.cl, cd: inviscidDrag ? 0 : mirrored.cd };
    };
  }

  /**
   * @description Section lift and drag at one angle of attack — the single-shot form of
   * {@link makePolar}, kept because a caller inspecting one section should not have to know about
   * the solver's per-pass caching.
   * @param spec - The section.
   * @param alphaRad - Angle of attack, radians.
   * @param reynolds - Section Reynolds number.
   * @param aspectRatio - Blade aspect ratio.
   * @param inviscidDrag - When true, force cd = 0.
   * @returns `{ cl, cd }`. `cd` is ALWAYS an estimate.
   */
  function sectionPolar(spec, alphaRad, reynolds, aspectRatio, inviscidDrag) {
    return makePolar(sectionCache(spec), reynolds, aspectRatio, inviscidDrag)(alphaRad);
  }

  /* =========================================================================
   * 3. Blade element momentum theory — mirrors bemt-solver.ts.
   * ====================================================================== */

  /**
   * @description Prandtl loss factor from an exponent: `F = (2/π) acos(exp(−f))`.
   * @param exponent - The `f` of the tip or hub form.
   * @returns The loss factor, 0 at the boundary and 1 far from it.
   */
  function prandtlFactor(exponent) {
    return (2 / Math.PI) * Math.acos(Math.min(1, Math.exp(-Math.max(exponent, 0))));
  }

  /**
   * @description The combined Prandtl factor, tip × hub. Note the HUB denominator is `Rhub`, not
   * `r`: dividing by `r` under-penalises the root, which is exactly where a printed blade carries
   * its thick structural sections and therefore where an over-optimistic answer does most damage.
   * @param ctx - Residual context.
   * @param sinPhi - Sine of the inflow angle.
   * @returns The combined factor, floored at 1e-4 (F = 0 exactly at a boundary divides by zero).
   */
  function prandtlLossFactor(ctx, sinPhi) {
    var s = Math.max(Math.abs(sinPhi), 1e-9);
    var tip = prandtlFactor(((ctx.bladeCount / 2) * (ctx.tipRadiusM - ctx.element.radiusM)) / (ctx.element.radiusM * s));
    var hub = prandtlFactor(((ctx.bladeCount / 2) * (ctx.element.radiusM - ctx.hubRadiusM)) / (ctx.hubRadiusM * s));
    return Math.max(tip * hub, 1e-4);
  }

  /**
   * @description Axial induction from the loading parameter, with the Glauert/Buhl correction above
   * a = 0.4. Momentum theory does not describe the turbulent wake state at all; skipping this is
   * what lets an uncorrected BEMT print a Cp above 16/27, which is a bug, not a result.
   * @param kappa - `σ Cn / (4 F sin²φ)`.
   * @param lossFactor - The combined Prandtl factor F.
   * @returns Axial induction factor.
   */
  function axialInduction(kappa, lossFactor) {
    if (kappa <= 2 / 3) {
      var limited = Math.max(kappa, -0.5);
      return limited / (1 + limited);
    }
    var f = lossFactor;
    var u = 2 * f * kappa;
    var g1 = u + f - 10 / 9;
    var g2 = Math.max(u + f * f - (4 * f) / 3, 0);
    var g3 = u + 2 * f - 25 / 9;
    if (Math.abs(g3) < 1e-9) return 1 - 1 / (2 * Math.sqrt(Math.max(g2, 1e-12)));
    return (g1 - Math.sqrt(g2)) / g3;
  }

  /**
   * @description Keep a denominator off zero WITHOUT changing its sign — a sign flip here would
   * invent a root the physics does not have.
   * @param value - The denominator.
   * @returns The value, or ±1e-9.
   */
  function clampAwayFromZero(value) {
    if (Math.abs(value) >= 1e-9) return value;
    return value < 0 ? -1e-9 : 1e-9;
  }

  /**
   * @description The BEMT residual at one inflow angle: the momentum and geometric statements of the
   * same inflow triangle subtracted. It is a function of φ ALONE — a and a′ are derived from φ,
   * never carried between iterations — which turns the classic coupled fixed-point iteration into a
   * one-dimensional root-find with a guaranteed bracket.
   * @param ctx - Residual context.
   * @param phi - Inflow angle, radians.
   * @returns `{ residual, a, aPrime, cl, cd }`.
   */
  function evaluateResidual(ctx, phi) {
    var e = ctx.element;
    var coefficients = ctx.polar(phi - e.betaRad);
    var sinPhi = Math.sin(phi);
    var cosPhi = Math.cos(phi);
    var normal = coefficients.cl * cosPhi + coefficients.cd * sinPhi;
    var tangential = coefficients.cl * sinPhi - coefficients.cd * cosPhi;
    var F = prandtlLossFactor(ctx, sinPhi);
    var kappa = (e.solidity * normal) / (4 * F * Math.max(sinPhi * sinPhi, 1e-12));
    var kappaPrime = (e.solidity * tangential) / (4 * F * clampAwayFromZero(sinPhi * cosPhi));
    var a = axialInduction(kappa, F);
    var kp = Math.max(-0.9, Math.min(0.9, kappaPrime));
    var aPrime = kp / (1 - kp);
    return {
      residual: sinPhi / clampAwayFromZero(1 - a) - cosPhi / (ctx.localSpeedRatio * clampAwayFromZero(1 + aPrime)),
      a: a, aPrime: aPrime, cl: coefficients.cl, cd: coefficients.cd
    };
  }

  /**
   * @description Find the inflow angle by BISECTION on the first bracket showing a sign change —
   * the windmill branch, then the propeller-brake branch, then the negative-inflow branch. A rotor
   * swept from λ = 0.5 to λ = 15 visits all three. Bisection cannot fail to find a root that
   * exists, which is the difference between a solver that converges and one that reports whatever
   * it was holding when the iteration cap ran out.
   * @param ctx - Residual context.
   * @returns `{ phi, state }`, or null when NO bracket contains a sign change.
   */
  function bisectInflowAngle(ctx) {
    var m = 1e-6;
    var brackets = [[m, Math.PI / 2 - m], [Math.PI / 2 + m, Math.PI - m], [-Math.PI / 2 + m, -m]];
    for (var b = 0; b < brackets.length; b += 1) {
      var lo = brackets[b][0];
      var hi = brackets[b][1];
      var loValue = evaluateResidual(ctx, lo).residual;
      var hiValue = evaluateResidual(ctx, hi).residual;
      if (!isFinite(loValue) || !isFinite(hiValue) || loValue * hiValue > 0) continue;
      for (var i = 0; i < 60 && hi - lo > 1e-10; i += 1) {
        var mid = 0.5 * (lo + hi);
        var midValue = evaluateResidual(ctx, mid).residual;
        if (loValue * midValue <= 0) hi = mid;
        else { lo = mid; loValue = midValue; }
      }
      var phi = 0.5 * (lo + hi);
      return { phi: phi, state: evaluateResidual(ctx, phi) };
    }
    return null;
  }

  /**
   * @description Solve the inflow angle at one assumed section Reynolds number and report the
   * Reynolds number the answer implies. The gap between the two is what the outer loop closes.
   * @param ctx - Residual context.
   * @param flow - The inflow condition.
   * @param reynolds - Reynolds number to evaluate the polar at.
   * @returns The element solution, or null when no bracket contained a sign change.
   */
  function inflowAtReynolds(ctx, flow, reynolds) {
    var working = {
      element: ctx.element, bladeCount: ctx.bladeCount, tipRadiusM: ctx.tipRadiusM, hubRadiusM: ctx.hubRadiusM,
      localSpeedRatio: ctx.localSpeedRatio, reynolds: reynolds, aspectRatio: ctx.aspectRatio,
      inviscidDrag: ctx.inviscidDrag,
      polar: makePolar(ctx.element.cache, reynolds, ctx.aspectRatio, ctx.inviscidDrag)
    };
    var solution = bisectInflowAngle(working);
    if (!solution) return null;
    var axial = flow.freeStreamMs * (1 - solution.state.a);
    var rotational = flow.rotationRadS * working.element.radiusM * (1 + solution.state.aPrime);
    var relativeSpeed = Math.hypot(axial, rotational);
    return {
      context: working, solution: solution, relativeSpeed: relativeSpeed,
      impliedReynolds: (relativeSpeed * working.element.chordM) / flow.kinematicViscosityM2S
    };
  }

  /**
   * @description The outer Reynolds loop: under-relaxed successive substitution, because Reynolds
   * depends on induction and induction depends (through drag) on Reynolds. Under-relaxing damps the
   * limit cycle that appears when an element sits exactly on the stall boundary, where a 1 % move in
   * Reynolds moves the stall angle past the operating point.
   * @param ctx - Residual context; its `reynolds` is the seed.
   * @param flow - The inflow condition.
   * @returns The settled solution, or the last candidate when it did not settle (reported as
   * non-converged by the caller only if no candidate was reached at all).
   */
  function settleReynolds(ctx, flow) {
    var candidate = inflowAtReynolds(ctx, flow, ctx.reynolds);
    for (var pass = 0; pass < 6 && candidate; pass += 1) {
      var gap = Math.abs(candidate.impliedReynolds - candidate.context.reynolds);
      if (gap <= 5e-3 * Math.max(candidate.impliedReynolds, 1)) return candidate;
      var next = candidate.context.reynolds + 0.6 * (candidate.impliedReynolds - candidate.context.reynolds);
      var stepped = inflowAtReynolds(ctx, flow, next);
      if (!stepped) return candidate;
      candidate = stepped;
    }
    return candidate;
  }

  /**
   * @description Chord, twist and section at a radius fraction, linearly interpolated between the
   * bracketing design stations. The SECTION is taken from the NEARER station rather than blended —
   * a NACA 4412 and a 4418 do not average into a meaningful aerofoil.
   * @param stations - Design stations, sorted ascending.
   * @param radiusFrac - Radius fraction.
   * @returns `{ chordM, twistDeg, section }`.
   */
  function interpolateStation(stations, radiusFrac) {
    var first = stations[0];
    var last = stations[stations.length - 1];
    if (radiusFrac <= first.radiusFrac) return first;
    if (radiusFrac >= last.radiusFrac) return last;
    var upper = 1;
    while (upper < stations.length - 1 && stations[upper].radiusFrac < radiusFrac) upper += 1;
    var lo = stations[upper - 1];
    var hi = stations[upper];
    var span = hi.radiusFrac - lo.radiusFrac;
    var t = span === 0 ? 0 : (radiusFrac - lo.radiusFrac) / span;
    return {
      chordM: lo.chordM + t * (hi.chordM - lo.chordM),
      twistDeg: lo.twistDeg + t * (hi.twistDeg - lo.twistDeg),
      section: t < 0.5 ? lo.section : hi.section
    };
  }

  /**
   * @description Cut the blade into equal-width annular elements evaluated at their MID-span radii.
   * Mid-span is not a refinement: the Prandtl factors are singular at exactly `r = R` and exactly
   * `r = Rhub`, so an element evaluated on a boundary divides by zero.
   * @param blade - The blade.
   * @param count - Element count.
   * @returns Element geometry, hub to tip.
   */
  function buildElements(blade, count) {
    var sorted = blade.stations.slice().sort(function (a, b) { return a.radiusFrac - b.radiusFrac; });
    var width = (blade.tipRadiusM - blade.hubRadiusM) / count;
    var elements = [];
    for (var i = 0; i < count; i += 1) {
      var radiusM = blade.hubRadiusM + (i + 0.5) * width;
      var st = interpolateStation(sorted, radiusM / blade.tipRadiusM);
      elements.push({
        radiusM: radiusM, chordM: st.chordM, section: st.section, widthM: width, cache: sectionCache(st.section),
        betaRad: ((st.twistDeg + blade.pitchDeg) * Math.PI) / 180,
        solidity: (blade.bladeCount * st.chordM) / (2 * Math.PI * radiusM)
      });
    }
    return elements;
  }

  /**
   * @description Solve BEMT for a rotor in an inflow: thrust, torque, power, Cp, Ct and the full
   * per-element state. Read `allConverged` FIRST — every integral below it is a sum over elements
   * and a non-converged element contributes zero, so a partial sweep reads as a rotor that lost its
   * inboard third, which is exactly how it should read. Never average over it.
   * @param blade - The blade.
   * @param flow - `{ freeStreamMs, rotationRadS, densityKgM3, kinematicViscosityM2S }`.
   * @param inviscidDrag - When true, force cd = 0 — the ideal-rotor limit.
   * @returns `{ thrustN, torqueNm, powerW, cp, ct, tipSpeedRatio, elements, allConverged }`.
   */
  function solveBemt(blade, flow, inviscidDrag) {
    var elements = buildElements(blade, ELEMENT_COUNT);
    var meanChord = elements.reduce(function (s, e) { return s + e.chordM; }, 0) / elements.length;
    var aspectRatio = blade.tipRadiusM / Math.max(meanChord, 1e-9);
    var results = elements.map(function (element) {
      var seed = Math.hypot(flow.freeStreamMs, flow.rotationRadS * element.radiusM);
      var settled = settleReynolds({
        element: element, bladeCount: blade.bladeCount, tipRadiusM: blade.tipRadiusM,
        hubRadiusM: blade.hubRadiusM, aspectRatio: aspectRatio, inviscidDrag: !!inviscidDrag,
        localSpeedRatio: Math.max((flow.rotationRadS * element.radiusM) / flow.freeStreamMs, 1e-6),
        reynolds: (seed * element.chordM) / flow.kinematicViscosityM2S
      }, flow);
      return settled ? buildElementResult(settled, flow, blade) : emptyElement(element, blade);
    });
    return integrateRotor(blade, flow, results);
  }

  /**
   * @description Turn a converged element solution into thrust and torque:
   * `dT = ½ρW²Bc·Cn·dr` and `dQ = ½ρW²Bc·Ct·r·dr`.
   * @param settled - The converged element solution.
   * @param flow - The inflow condition.
   * @param blade - The blade (for the blade count).
   * @returns The element result, always converged — a failed element never reaches here.
   */
  function buildElementResult(settled, flow, blade) {
    var e = settled.context.element;
    var st = settled.solution.state;
    var phi = settled.solution.phi;
    var normal = st.cl * Math.cos(phi) + st.cd * Math.sin(phi);
    var tangential = st.cl * Math.sin(phi) - st.cd * Math.cos(phi);
    var dynamic = 0.5 * flow.densityKgM3 * settled.relativeSpeed * settled.relativeSpeed * blade.bladeCount * e.chordM;
    return {
      radiusM: e.radiusM, radiusFrac: e.radiusM / blade.tipRadiusM, chordM: e.chordM,
      a: st.a, aPrime: st.aPrime, phiDeg: (phi * 180) / Math.PI,
      alphaDeg: ((phi - e.betaRad) * 180) / Math.PI, reynolds: settled.context.reynolds,
      cl: st.cl, cd: st.cd, liftToDrag: st.cd > 0 ? st.cl / st.cd : 0,
      dThrustN: dynamic * normal * e.widthM, dTorqueNm: dynamic * tangential * e.radiusM * e.widthM,
      converged: true
    };
  }

  /**
   * @description The result record for an element the solver could not close. Every aerodynamic
   * field is NaN and the loads are zero, so an integral built over it is visibly wrong rather than
   * subtly optimistic.
   * @param element - Element geometry.
   * @param blade - The blade, so the failed element still plots at its true span position rather
   * than collapsing to the root and dragging every spanwise panel with it.
   * @returns A non-converged element result.
   */
  function emptyElement(element, blade) {
    surfaceWarn('BEMT element did not converge; no bracket contained a sign change', { radiusM: element.radiusM });
    return {
      radiusM: element.radiusM, radiusFrac: element.radiusM / blade.tipRadiusM, chordM: element.chordM, a: NaN, aPrime: NaN, phiDeg: NaN,
      alphaDeg: NaN, reynolds: NaN, cl: NaN, cd: NaN, liftToDrag: NaN, dThrustN: 0, dTorqueNm: 0, converged: false
    };
  }

  /**
   * @description Sum the element loads into rotor thrust, torque, power and the two coefficients.
   * @param blade - The blade.
   * @param flow - The inflow condition.
   * @param elements - Per-element results.
   * @returns The whole-rotor result.
   */
  function integrateRotor(blade, flow, elements) {
    var thrustN = elements.reduce(function (s, e) { return s + e.dThrustN; }, 0);
    var torqueNm = elements.reduce(function (s, e) { return s + e.dTorqueNm; }, 0);
    var powerW = flow.rotationRadS * torqueNm;
    var dynamic = 0.5 * flow.densityKgM3 * Math.PI * blade.tipRadiusM * blade.tipRadiusM;
    return {
      thrustN: thrustN, torqueNm: torqueNm, powerW: powerW,
      cp: powerW / (dynamic * Math.pow(flow.freeStreamMs, 3)),
      ct: thrustN / (dynamic * flow.freeStreamMs * flow.freeStreamMs),
      tipSpeedRatio: (flow.rotationRadS * blade.tipRadiusM) / flow.freeStreamMs,
      elements: elements,
      allConverged: elements.every(function (e) { return e.converged; })
    };
  }

  /* =========================================================================
   * 4. The blade the controls describe.
   * ====================================================================== */

  /**
   * @description The inflow condition at a free-stream speed and tip-speed ratio.
   * @param blade - The blade (its tip radius sets the rotational speed).
   * @param speedMs - Free-stream speed, m/s.
   * @param lambda - Tip-speed ratio.
   * @returns A flow condition.
   */
  function flowAt(blade, speedMs, lambda) {
    return {
      freeStreamMs: speedMs, rotationRadS: (lambda * speedMs) / blade.tipRadiusM,
      densityKgM3: SEAWATER_DENSITY_KGM3, kinematicViscosityM2S: SEAWATER_VISCOSITY_M2S
    };
  }

  /**
   * @description Sweep Cp against tip-speed ratio, deriving the rotational speed from each λ rather
   * than reading it off the flow. That is what makes a Cp(λ) curve comparable between two rotors of
   * different SIZE at the same inflow — which is the whole low-Reynolds question.
   * @param blade - The blade.
   * @param speedMs - Free-stream speed, m/s.
   * @param lambdas - Tip-speed ratios to evaluate.
   * @returns `[{ lambda, cp, converged }]` in input order.
   */
  function cpCurve(blade, speedMs, lambdas) {
    return lambdas.map(function (lambda) {
      var result = solveBemt(blade, flowAt(blade, speedMs, lambda), false);
      return { lambda: lambda, cp: result.cp, converged: result.allConverged };
    });
  }

  /* =========================================================================
   * 5. The energy budget — mirrors @/shared/energy and the marine adapter.
   * ====================================================================== */

  /**
   * @description Signed flow speed at a time, summing the site's harmonic constituents plus any
   * steady residual. The spring/neap beat is emergent, never a parameter.
   * @param tSeconds - Seconds since the run's epoch.
   * @returns Signed flow speed, m/s.
   */
  function currentSpeedAt(tSeconds) {
    var total = SITE.residualMs || 0;
    for (var i = 0; i < CONSTITUENTS.length; i += 1) {
      total += CONSTITUENTS[i].amp * Math.cos(CONSTITUENTS[i].omega * tSeconds - CONSTITUENTS[i].phase);
    }
    return total;
  }

  /**
   * @description Pre-sample the harvest schedule ONCE over the run's time grid.
   *
   * The minimum-store search runs the same span twenty-odd times at different capacities, and the
   * harvest is a pure function of time that does not change between trials — so evaluating it per
   * trial was doing half a million redundant rotor-power evaluations for an answer already known.
   * @param sampler - The Cp(V) sampler.
   * @param areaM2 - Rotor swept area, m².
   * @returns `{ steps, watts, flow, hours }`, all typed arrays on the same grid.
   */
  function buildHarvestSeries(sampler, areaM2) {
    var spanS = BUDGET_HOURS * 3600;
    var steps = Math.ceil(spanS / BUDGET_STEP_S);
    var series = {
      steps: steps, watts: new Float64Array(steps),
      flow: new Float64Array(steps), hours: new Float64Array(steps)
    };
    for (var i = 0; i < steps; i += 1) {
      var t = i * BUDGET_STEP_S;
      series.flow[i] = currentSpeedAt(t);
      series.watts[i] = turbinePowerW(sampler, areaM2, series.flow[i]);
      series.hours[i] = Math.min(BUDGET_STEP_S, spanS - t) / 3600;
    }
    return series;
  }

  /**
   * @description Build a Cp(V) sampler by solving BEMT at the operating tip-speed ratio across the
   * speed band the site actually visits, then interpolating.
   *
   * This is the honest form of the marine slice's SCALAR `powerCoefficient`: at a fixed λ the inflow
   * triangles are identical at every speed, so classical Reynolds-independent BEMT would return one
   * number — every variation this sampler carries is a pure Reynolds effect, which at 150 mm is
   * precisely the effect that decides whether the design closes.
   * @param blade - The blade.
   * @param lambda - Operating tip-speed ratio.
   * @param peakSpeedMs - Fastest speed the site reaches.
   * @returns `{ speeds, cps, at }` where `at(v)` interpolates Cp, clamped at the band ends.
   */
  function buildCpSampler(blade, lambda, peakSpeedMs) {
    var speeds = [];
    var cps = [];
    var top = Math.max(peakSpeedMs, CUT_IN_SPEED_MS * 2);
    for (var i = 0; i < 6; i += 1) {
      var v = CUT_IN_SPEED_MS + ((top - CUT_IN_SPEED_MS) * i) / 5;
      var result = solveBemt(blade, flowAt(blade, v, lambda), false);
      speeds.push(v);
      cps.push(isFinite(result.cp) ? Math.max(0, result.cp) : 0);
    }
    return {
      speeds: speeds, cps: cps,
      at: function (v) {
        if (v <= speeds[0]) return cps[0];
        if (v >= speeds[speeds.length - 1]) return cps[cps.length - 1];
        var k = 1;
        while (k < speeds.length - 1 && speeds[k] < v) k += 1;
        var t = (v - speeds[k - 1]) / (speeds[k] - speeds[k - 1]);
        return cps[k - 1] + t * (cps[k] - cps[k - 1]);
      }
    };
  }

  /**
   * @description Electrical power the rotor extracts: `P = ½ρA|v|³·Cp(|v|)·η`, zero below cut-in and
   * clamped at rated. The CUBE is why cut-in dominates the design — halving the flow cuts power by
   * eight, so a site spends most of its time producing almost nothing.
   * @param sampler - The Cp(V) sampler.
   * @param sweptAreaM2 - Rotor swept area, m².
   * @param speedMs - Signed flow speed (sign ignored — a rotor harvests either direction).
   * @returns Electrical power, W.
   */
  function turbinePowerW(sampler, sweptAreaM2, speedMs) {
    var v = Math.abs(speedMs);
    if (v < CUT_IN_SPEED_MS) return 0;
    var raw = 0.5 * SEAWATER_DENSITY_KGM3 * sweptAreaM2 * v * v * v * sampler.at(v) * DRIVETRAIN_EFFICIENCY;
    return Math.min(raw, RATED_POWER_W);
  }

  /** @description Duty-cycle-weighted total draw of the load set, W. @returns Watts. */
  function totalDrawW() {
    return LOADS.reduce(function (sum, load) { return sum + load.watts * load.dutyCycle; }, 0);
  }

  /**
   * @description Integrate the closed-loop energy budget. "Perpetual" requires BOTH that the pack
   * never browned out AND that the run ended in net energy surplus after charging losses, so a
   * design that merely drains slowly is correctly rejected. `netEnergyWh` is accumulated WITHOUT
   * either clamp, which makes it capacity-independent — the one term no battery can move.
   * @param series - Pre-sampled harvest schedule from {@link buildHarvestSeries}.
   * @param capacityWh - Store nameplate for this run.
   * @param keepSamples - Whether to retain the timeseries for plotting.
   * @returns `{ verdict, samples }`.
   */
  function simulateEnergyBudget(series, capacityWh, keepSamples) {
    var floorWh = capacityWh * (1 - STORAGE.usableDepthOfDischarge);
    var socWh = capacityWh * STORAGE.initialSocFraction;
    var drawW = totalDrawW();
    var acc = { harvested: 0, consumed: 0, curtailed: 0, net: 0, brownoutS: 0, minSoc: socWh, minAtS: 0 };
    var samples = [];
    for (var i = 0; i < series.steps; i += 1) {
      var t = i * BUDGET_STEP_S;
      var dtH = series.hours[i];
      var harvestW = series.watts[i];
      acc.harvested += harvestW * dtH;
      acc.consumed += drawW * dtH;
      var netWh = (harvestW - drawW) * dtH;
      acc.net += netWh >= 0 ? netWh * STORAGE.roundTripEfficiency : netWh;
      if (netWh >= 0) {
        var stored = Math.min(netWh * STORAGE.roundTripEfficiency, capacityWh - socWh);
        socWh += stored;
        acc.curtailed += netWh - stored / STORAGE.roundTripEfficiency;
      } else {
        var drawn = Math.min(-netWh, Math.max(0, socWh - floorWh));
        socWh -= drawn;
        if (drawn < -netWh) acc.brownoutS += dtH * 3600;
      }
      if (socWh < acc.minSoc) { acc.minSoc = socWh; acc.minAtS = t; }
      if (keepSamples && i % 15 === 0) {
        samples.push({ tHours: t / 3600, harvestW: harvestW, socFraction: socWh / capacityWh, currentMs: series.flow[i] });
      }
    }
    return { verdict: buildVerdict(acc, capacityWh), samples: samples };
  }

  /**
   * @description Collapse the accumulator into the scalar verdict.
   * @param acc - The accumulator after the run.
   * @param capacityWh - Store nameplate, the denominator for every SoC fraction.
   * @returns The verdict.
   */
  function buildVerdict(acc, capacityWh) {
    return {
      perpetual: acc.brownoutS === 0 && acc.net >= 0,
      durationHours: BUDGET_HOURS,
      minSocFraction: acc.minSoc / capacityWh,
      minSocAtHours: acc.minAtS / 3600,
      brownoutHours: acc.brownoutS / 3600,
      harvestedWh: acc.harvested, consumedWh: acc.consumed, curtailedWh: acc.curtailed,
      netEnergyWh: acc.net,
      marginRatio: acc.consumed > 0 ? acc.harvested / acc.consumed : Infinity,
      meanHarvestW: acc.harvested / BUDGET_HOURS,
      meanDrawW: acc.consumed / BUDGET_HOURS
    };
  }

  /**
   * @description Smallest store that makes the design perpetual, by binary search over capacity —
   * each trial run from the design's OWN starting charge, because a node that wakes at 60 % has to
   * survive its first gap on 60 %. The predicate is monotone in capacity because the only
   * capacity-sensitive clause is "never browned out"; the surplus clause is capacity-independent, so
   * null here means exactly one thing a bigger battery cannot fix.
   * @param series - Pre-sampled harvest schedule from {@link buildHarvestSeries}.
   * @param maxCapacityWh - Search bound, Wh.
   * @returns Minimum viable capacity in Wh, or null when no store closes the design.
   */
  function recommendStorageWh(series, maxCapacityWh) {
    if (!simulateEnergyBudget(series, maxCapacityWh, false).verdict.perpetual) return null;
    var lo = 0;
    var hi = maxCapacityWh;
    for (var i = 0; i < 20 && hi - lo > 0.5; i += 1) {
      var mid = (lo + hi) / 2;
      if (simulateEnergyBudget(series, mid, false).verdict.perpetual) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /* =========================================================================
   * 6. The three 2-D visuals. Palette, scales and marks come from the renderer
   *    file — see the chart-layer section there for the validated palette.
   * ====================================================================== */

  /**
   * @description Draw Cp against tip-speed ratio, with the Betz limit as a hard ceiling and the
   * current operating point marked. One data series, so no legend box — the title names it; the two
   * reference marks are labelled in place instead.
   * @param canvas - Target canvas.
   * @param model - The solved model.
   * @param pal - The palette.
   * @returns Nothing.
   */
  function drawCpCurve(canvas, model, pal) {
    var fit = V.fitCanvas(canvas);
    if (!fit) return;
    var ctx = fit.ctx;
    var rect = { l: 54, t: 26, w: fit.w - 84, h: fit.h - 62 };
    var peak = Math.max(BETZ_LIMIT * 1.06, 0.05);
    var scale = V.makeScale(rect, 0, model.curve[model.curve.length - 1].lambda, 0, peak);
    V.drawFrame(ctx, scale, pal, { xLabel: 'tip-speed ratio  λ = ΩR / V', yLabel: 'power coefficient  Cp', yTicks: 5 });
    var betzY = Math.round(scale.y(BETZ_LIMIT)) + 0.5;
    ctx.save();
    ctx.strokeStyle = pal.dim; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(rect.l, betzY); ctx.lineTo(rect.l + rect.w, betzY); ctx.stroke();
    ctx.restore();
    V.drawLabel(ctx, 'Betz limit 16/27 = 0.593 — no open-flow rotor may cross this', rect.l + 6, betzY - 9, pal);
    V.drawSeries(ctx, scale, model.curve.map(function (p) { return [p.lambda, p.cp]; }), pal.series[0]);
    var op = model.rotor;
    if (isFinite(op.cp)) {
      var x = scale.x(op.tipSpeedRatio);
      var y = scale.y(Math.max(op.cp, 0));
      V.drawMarker(ctx, x, y, pal.series[0], pal);
      V.drawLabel(ctx, 'operating point  λ ' + op.tipSpeedRatio.toFixed(1) + ' · Cp ' + op.cp.toFixed(3),
        Math.min(x + 11, rect.l + rect.w - 4), Math.max(y - 14, rect.t + 8), pal,
        x > rect.l + rect.w * 0.6 ? 'right' : 'left');
    }
    V.registerHover(canvas, scale, function (lambda) {
      var best = model.curve[0];
      model.curve.forEach(function (p) { if (Math.abs(p.lambda - lambda) < Math.abs(best.lambda - lambda)) best = p; });
      return 'λ ' + best.lambda.toFixed(2) + ' · Cp ' + best.cp.toFixed(3);
    });
  }

  /** @description The six spanwise panels, in reading order. Each names its own accessor and unit. */
  var SPAN_PANELS = [
    { key: 'alphaDeg', title: 'Angle of attack  α (deg)', digits: 1 },
    { key: 'cl', title: 'Lift coefficient  Cl', digits: 2 },
    { key: 'cd', title: 'Drag coefficient  Cd (estimate)', digits: 4 },
    { key: 'liftToDrag', title: 'Lift-to-drag  Cl / Cd', digits: 0 },
    { key: 'reynolds', title: 'Section Reynolds  W·c / ν', digits: 0, log: true },
    { key: 'induction', title: 'Induction factors  a and a′', digits: 3, pair: true }
  ];

  /**
   * @description Draw the spanwise distributions as SMALL MULTIPLES — six panels sharing one x axis.
   * Small multiples rather than one chart with six lines because α, Cl, Cd, Reynolds and the
   * induction factors have five different units and five different magnitudes; overlaying them would
   * need a second y-axis, which is never the answer.
   * @param canvas - Target canvas.
   * @param model - The solved model.
   * @param pal - The palette.
   * @returns Nothing.
   */
  function drawSpanwise(canvas, model, pal) {
    var fit = V.fitCanvas(canvas);
    if (!fit) return;
    var cols = fit.w < 640 ? 1 : fit.w < 1000 ? 2 : 3;
    var rows = Math.ceil(SPAN_PANELS.length / cols);
    var cellW = fit.w / cols;
    var cellH = fit.h / rows;
    SPAN_PANELS.forEach(function (panel, index) {
      var cx = (index % cols) * cellW;
      var cy = Math.floor(index / cols) * cellH;
      drawSpanPanel(fit.ctx, panel, model, pal, { l: cx + 52, t: cy + 30, w: cellW - 74, h: cellH - 62 });
    });
  }

  /**
   * @description Draw one spanwise panel, with a direct label at 75 % span — the station a rotor is
   * designed around, and the one the low-Reynolds warning is taken at.
   * @param ctx - 2-D context.
   * @param panel - Panel descriptor from {@link SPAN_PANELS}.
   * @param model - The solved model.
   * @param pal - The palette.
   * @param rect - Plot rectangle.
   * @returns Nothing.
   */
  function drawSpanPanel(ctx, panel, model, pal, rect) {
    var els = model.rotor.elements;
    var series = panel.pair
      ? [els.map(function (e) { return [e.radiusFrac, e.a]; }), els.map(function (e) { return [e.radiusFrac, e.aPrime]; })]
      : [els.map(function (e) { return [e.radiusFrac, panel.log ? Math.log(Math.max(e[panel.key], 1)) / Math.LN10 : e[panel.key]]; })];
    var values = series.reduce(function (all, s) { return all.concat(s.map(function (p) { return p[1]; })); }, [])
      .filter(function (v) { return isFinite(v); });
    var lo = Math.min.apply(null, values.concat([0]));
    var hi = Math.max.apply(null, values.concat([lo + 1e-6]));
    var pad = (hi - lo) * 0.12 || 0.1;
    var scale = V.makeScale(rect, 0, 1, lo - pad, hi + pad);
    V.drawFrame(ctx, scale, pal, {
      xLabel: 'r / R', yLabel: panel.title, xTicks: 4, yTicks: 4,
      format: panel.log ? function (v) { return '1e' + v.toFixed(1); } : function (v) { return v.toFixed(panel.digits > 2 ? 3 : panel.digits); }
    });
    series.forEach(function (s, i) { V.drawSeries(ctx, scale, s, pal.series[i]); });
    var ref = model.station75;
    if (ref) {
      var raw = panel.pair ? ref.a : ref[panel.key];
      var plotted = panel.log ? Math.log(Math.max(ref.reynolds, 1)) / Math.LN10 : raw;
      if (isFinite(plotted)) {
        V.drawMarker(ctx, scale.x(0.75), scale.y(plotted), pal.series[0], pal);
        V.drawLabel(ctx, panel.log ? ref.reynolds.toExponential(1) : raw.toFixed(panel.digits),
          scale.x(0.75) - 9, scale.y(plotted) - 13, pal, 'right');
      }
    }
  }

  /**
   * @description Draw the closed loop: harvested power and state of charge over one spring/neap
   * beat, with brownout regions marked. Two series, so a legend is present in the page markup and
   * both carry a direct end-label — the light-mode contrast relief this palette requires.
   * @param canvas - Target canvas.
   * @param model - The solved model.
   * @param pal - The palette.
   * @returns Nothing.
   */
  function drawEnergy(canvas, model, pal) {
    var fit = V.fitCanvas(canvas);
    if (!fit) return;
    var ctx = fit.ctx;
    var samples = model.energy.samples;
    if (!samples.length) return;
    var rect = { l: 56, t: 26, w: fit.w - 118, h: fit.h - 62 };
    var days = samples[samples.length - 1].tHours / 24;
    var peakW = Math.max.apply(null, samples.map(function (s) { return s.harvestW; }).concat([1]));
    var powerScale = V.makeScale(rect, 0, days, 0, peakW * 1.08);
    V.drawFrame(ctx, powerScale, pal, { xLabel: 'days into the run', yLabel: 'harvested power (W) — store overlaid as % of nameplate', yTicks: 4 });
    ctx.save();
    ctx.fillStyle = pal.critical;
    ctx.globalAlpha = 0.16;
    samples.forEach(function (s, i) {
      if (s.socFraction > 1 - STORAGE.usableDepthOfDischarge + 1e-6 || i === 0) return;
      ctx.fillRect(powerScale.x(samples[i - 1].tHours / 24), rect.t, Math.max(1, powerScale.x(s.tHours / 24) - powerScale.x(samples[i - 1].tHours / 24)), rect.h);
    });
    ctx.restore();
    V.drawSeries(ctx, powerScale, samples.map(function (s) { return [s.tHours / 24, s.harvestW]; }), pal.series[0]);
    var socScale = V.makeScale(rect, 0, days, 0, 1);
    V.drawSeries(ctx, socScale, samples.map(function (s) { return [s.tHours / 24, s.socFraction]; }), pal.series[2]);
    var last = samples[samples.length - 1];
    V.drawMarker(ctx, powerScale.x(days), powerScale.y(last.harvestW), pal.series[0], pal);
    V.drawMarker(ctx, socScale.x(days), socScale.y(last.socFraction), pal.series[2], pal);
    V.drawLabel(ctx, last.harvestW.toFixed(1) + ' W', rect.l + rect.w + 9, powerScale.y(last.harvestW), pal);
    V.drawLabel(ctx, (last.socFraction * 100).toFixed(0) + '% store', rect.l + rect.w + 9, socScale.y(last.socFraction), pal);
    V.registerHover(canvas, powerScale, function (day) {
      var best = samples[0];
      samples.forEach(function (s) { if (Math.abs(s.tHours / 24 - day) < Math.abs(best.tHours / 24 - day)) best = s; });
      return 'day ' + (best.tHours / 24).toFixed(1) + ' · flow ' + best.currentMs.toFixed(2) + ' m/s · '
        + best.harvestW.toFixed(1) + ' W · store ' + (best.socFraction * 100).toFixed(0) + '%';
    });
  }

  /* =========================================================================
   * 8. Verdict, tables, exports and the server cross-check.
   * ====================================================================== */

  /**
   * @description Set a text node by id, tolerating a missing element so a trimmed page still boots.
   * @param id - Element id.
   * @param text - Text to write.
   * @returns Nothing.
   */
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * @description Paint the verdict band, the KPI tiles and the low-Reynolds warning.
   *
   * The warning fires on section Reynolds at 75 % span below 1e5 and says plainly that the polar is
   * outside its reliable range there — it is not a styling flourish. A 4-digit aerofoil at Re 7e4 is
   * far outside what it was drawn for, laminar separation dominates, and every Cd on this page is a
   * correlation rather than a solved boundary layer.
   * @param model - The solved model.
   * @returns Nothing.
   */
  function renderVerdict(model) {
    var v = model.energy.verdict;
    var band = document.getElementById('verdict');
    if (band) band.className = 'verdict summary-card ' + (v.perpetual ? 'is-good' : 'is-bad');
    setText('verdict-icon', v.perpetual ? '●' : '▲');
    setText('verdict-word', v.perpetual ? 'Perpetual' : 'Runs down');
    setText('verdict-note', v.perpetual
      ? 'The rotor this blade describes carries the load through the whole spring/neap beat and ends in net surplus. Minimum store is the smallest battery that stays true.'
      : (v.netEnergyWh < 0
        ? 'Harvest is short of the load once charging losses are paid. No battery fixes this — the blade or the site has to change.'
        : 'The pack browns out during the neap. A bigger store closes it; the minimum is below.'));
    setText('kpi-cp', isFinite(model.rotor.cp) ? model.rotor.cp.toFixed(3) : '—');
    setText('kpi-harvest', v.meanHarvestW.toFixed(2) + ' W');
    setText('kpi-margin', isFinite(v.marginRatio) ? v.marginRatio.toFixed(2) + '×' : '∞');
    setText('kpi-store', model.minStoreWh === null ? 'no size closes it' : model.minStoreWh.toFixed(1) + ' Wh');
    setText('kpi-minsoc', (v.minSocFraction * 100).toFixed(0) + '%');
    var warn = document.getElementById('lowre');
    var re75 = model.station75 ? model.station75.reynolds : NaN;
    if (warn) {
      warn.hidden = !(isFinite(re75) && re75 < LOW_REYNOLDS_THRESHOLD);
      setText('lowre-value', isFinite(re75) ? re75.toExponential(2) : '—');
    }
  }

  /**
   * @description Rebuild the table view — the WCAG-clean twin of every chart, and the relief channel
   * the light-mode palette obliges. Every value the charts encode in colour or position is here as
   * text, including the server cross-check when one came back.
   * @param model - The solved model.
   * @returns Nothing.
   */
  function renderTables(model) {
    var v = model.energy.verdict;
    var rows = [
      ['Rotor Cp at the operating point', isFinite(model.rotor.cp) ? model.rotor.cp.toFixed(4) : 'not converged'],
      ['Fraction of the Betz limit', isFinite(model.rotor.cp) ? (100 * model.rotor.cp / BETZ_LIMIT).toFixed(1) + ' %' : '—'],
      ['Peak Cp over the sweep', model.peak.cp.toFixed(4) + ' at λ ' + model.peak.lambda.toFixed(2)],
      ['Thrust coefficient Ct', model.rotor.ct.toFixed(3)],
      ['Shaft power at the design speed', model.rotor.powerW.toFixed(2) + ' W'],
      ['Rotor torque', model.rotor.torqueNm.toFixed(4) + ' N·m'],
      ['Rotor thrust', model.rotor.thrustN.toFixed(2) + ' N'],
      ['Every element converged', model.rotor.allConverged ? 'yes' : 'NO — the integral is not usable'],
      ['Section Reynolds at 75 % span', model.station75 ? model.station75.reynolds.toExponential(2) : '—'],
      ['Swept area', (Math.PI * model.blade.tipRadiusM * model.blade.tipRadiusM).toFixed(4) + ' m²'],
      ['Printed blade envelope', model.sizeMm],
      ['Mean harvested power', v.meanHarvestW.toFixed(3) + ' W'],
      ['Mean load draw', v.meanDrawW.toFixed(3) + ' W'],
      ['Harvest margin (raw, before charging losses)', isFinite(v.marginRatio) ? v.marginRatio.toFixed(3) + '×' : '∞'],
      ['Net energy over the run (capacity-independent)', v.netEnergyWh.toFixed(1) + ' Wh'],
      ['Energy curtailed', v.curtailedWh.toFixed(1) + ' Wh'],
      ['Deepest state of charge', (v.minSocFraction * 100).toFixed(1) + ' % at hour ' + v.minSocAtHours.toFixed(0)],
      ['Hours browned out', v.brownoutHours.toFixed(1) + ' h'],
      ['Minimum viable store', model.minStoreWh === null ? 'no size closes this design' : model.minStoreWh.toFixed(2) + ' Wh'],
      ['Solve mode', model.mode]
    ];
    if (model.serverNote) rows.push(['Server cross-check', model.serverNote]);
    var body = document.getElementById('table-body');
    if (body) {
      body.innerHTML = '';
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        var th = document.createElement('th');
        th.setAttribute('scope', 'row');
        th.textContent = row[0];
        var td = document.createElement('td');
        td.className = 'num';
        td.textContent = row[1];
        tr.appendChild(th); tr.appendChild(td); body.appendChild(tr);
      });
    }
    renderSpanTable(model);
  }

  /**
   * @description Rebuild the spanwise table — the text twin of the six small multiples.
   * @param model - The solved model.
   * @returns Nothing.
   */
  function renderSpanTable(model) {
    var body = document.getElementById('span-body');
    if (!body) return;
    body.innerHTML = '';
    var els = model.rotor.elements;
    var stride = Math.max(1, Math.round(els.length / 10));
    for (var i = 0; i < els.length; i += stride) {
      var e = els[i];
      var tr = document.createElement('tr');
      [e.radiusFrac.toFixed(2), (e.chordM * 1000).toFixed(1), e.alphaDeg.toFixed(1), e.cl.toFixed(3),
        e.cd.toFixed(4), e.liftToDrag.toFixed(0), e.reynolds.toExponential(2), e.a.toFixed(3), e.aPrime.toFixed(4)]
        .forEach(function (value, col) {
          var cell = document.createElement(col === 0 ? 'th' : 'td');
          if (col === 0) cell.setAttribute('scope', 'row'); else cell.className = 'num';
          cell.textContent = value;
          tr.appendChild(cell);
        });
      body.appendChild(tr);
    }
  }

  /**
   * @description Wire the four export buttons. Every one produces a REAL file: binary STL for the
   * slicer, indexed OBJ for a CAD or DCC handover, an OpenSCAD module with a readable parameter
   * block, and a DXF R12 station drawing. All solids are emitted in MILLIMETRES, which is what every
   * slicer assumes when a file carries no units — a metre-scale STL imports as a 150-metre blade.
   * @param getModel - Accessor returning the current solved model.
   * @returns Nothing.
   */
  function wireExports(getModel) {
    var jobs = {
      'x-stl': function (m) { V.download(m.name + '.stl', V.toStlBinary(m.mesh, 1000), 'model/stl'); },
      'x-obj': function (m) { V.download(m.name + '.obj', V.toObj(m.mesh, m.name, 1000), 'text/plain'); },
      'x-scad': function (m) {
        V.download(m.name + '.scad', V.toOpenScad(m.mesh, {
          name: m.name, scale: 1000,
          parameters: {
            tip_radius_mm: m.blade.tipRadiusM * 1000, hub_radius_mm: m.blade.hubRadiusM * 1000,
            blade_count: m.blade.bladeCount, collective_pitch_deg: m.blade.pitchDeg,
            root_chord_mm: m.blade.stations[0].chordM * 1000,
            tip_chord_mm: m.blade.stations[m.blade.stations.length - 1].chordM * 1000,
            root_twist_deg: m.blade.stations[0].twistDeg,
            tip_twist_deg: m.blade.stations[m.blade.stations.length - 1].twistDeg,
            aerofoil: 'NACA ' + m.naca, design_cp: Number(m.rotor.cp.toFixed(4))
          }
        }), 'text/plain');
      },
      'x-dxf': function (m) { V.download(m.name + '-stations.dxf', V.toDxfR12(V.stationProfiles(m.blade)), 'image/vnd.dxf'); }
    };
    Object.keys(jobs).forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var model = getModel();
        if (!model) return;
        try {
          jobs[id](model);
        } catch (err) {
          surfaceWarn('export failed', { format: id, error: err.message });
        }
      });
    });
  }

  /**
   * @description POST JSON and return the parsed body, or null on any failure. Null is the honest
   * answer: this surface is designed to be fully usable with the API absent, so a failed cross-check
   * changes a badge, never the headline.
   * @param url - Endpoint.
   * @param body - Request body.
   * @returns A promise of the parsed body or null.
   */
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.ok ? res.json() : null; }).catch(function (err) {
      surfaceWarn('cross-check request failed', { url: url, error: err.message });
      return null;
    });
  }

  /**
   * @description Ask the server for the same two answers this page just computed, and report the
   * comparison. The headline verdict is ALWAYS the local one, so the page cannot contradict itself;
   * the server's numbers land in the table as a cross-check row and in the mode badge.
   * @param model - The solved model.
   * @param onDone - Called with a note string (or null) once both requests settle.
   * @returns Nothing.
   */
  function crossCheck(model, onDone) {
    var turbine = {
      sweptAreaM2: Math.PI * model.blade.tipRadiusM * model.blade.tipRadiusM,
      powerCoefficient: Math.min(Math.max(model.rotor.cp, 0), 1),
      drivetrainEfficiency: DRIVETRAIN_EFFICIENCY,
      cutInSpeedMs: CUT_IN_SPEED_MS, ratedPowerW: RATED_POWER_W
    };
    var rotor = postJson('/api/ocean-lab/rotor/solve', {
      blade: model.blade, flow: flowAt(model.blade, model.state.freeStreamMs, model.state.lambda)
    });
    var harvest = postJson('/api/ocean-lab/harvest/simulate', {
      domain: 'marine',
      options: { durationHours: BUDGET_HOURS, stepSeconds: 60, sampleEveryMinutes: 60 },
      config: { site: SITE, turbine: turbine, loads: LOADS, storage: STORAGE }
    });
    global.Promise.all([rotor, harvest]).then(function (results) {
      var notes = [];
      if (results[0] && typeof results[0].cp === 'number') notes.push('BEMT Cp ' + results[0].cp.toFixed(4));
      if (results[1] && results[1].verdict) {
        notes.push('marine budget mean ' + results[1].verdict.meanHarvestW.toFixed(2) + ' W, '
          + (results[1].verdict.perpetual ? 'perpetual' : 'runs down'));
      }
      onDone(notes.length ? notes.join(' · ') : null);
    });
  }

  /* =========================================================================
   * 9. Controls, hover and boot.
   * ====================================================================== */

  /** @description One-deep memo per named slot — the last key and its value. */
  var memoSlots = {};

  /**
   * @description Memoise the last value computed for a slot.
   *
   * One entry deep is exactly right here: a slider drag re-enters with the SAME key for every
   * product the moved control does not feed, and a deeper cache would only hold values the user has
   * already scrolled past. The Cp sweep does not depend on the operating tip-speed ratio and the
   * harvest schedule does not depend on the free-stream speed control, so dragging either one
   * re-solves about a third of the page instead of all of it.
   * @param slot - Slot name.
   * @param key - Value signature; a miss rebuilds.
   * @param build - Builder, called only on a miss.
   * @returns The cached or freshly built value.
   */
  function memo(slot, key, build) {
    if (memoSlots[slot] && memoSlots[slot].key === key) return memoSlots[slot].value;
    memoSlots[slot] = { key: key, value: build() };
    return memoSlots[slot].value;
  }

  /**
   * @description Signature of everything that changes the blade's GEOMETRY — deliberately excluding
   * the free-stream speed and the operating tip-speed ratio, which change the flow the blade is
   * evaluated in but not the blade.
   * @param s - Control state.
   * @returns A signature string.
   */
  function bladeKey(s) {
    return [s.tipRadiusM, s.hubFrac, s.bladeCount, s.rootChordM, s.tipChordM, s.rootTwistDeg,
      s.tipTwistDeg, s.twistLaw, s.pitchDeg, s.naca, s.rootThickness].join('|');
  }

  /** @description Live control state, seeded from {@link DEFAULTS}. */
  var state = {};
  /** @description The most recent solved model, shared with the export buttons and the hover layer. */
  var current = null;
  /** @description The mounted WebGL viewer handle, or null when WebGL2 is unavailable. */
  var viewer = null;
  /** @description Coalescing flag so a slider drag costs one solve per animation frame. */
  var pending = false;

  /**
   * @description Solve everything the page shows, in one pass: the blade, the Cp sweep, the
   * operating point, the printable mesh, and the energy budget the Cp feeds.
   * @returns The solved model.
   */
  function solveModel() {
    var geometry = bladeKey(state);
    var blade = memo('blade', geometry, function () { return V.buildBlade(state); });
    var lambdas = [];
    for (var i = 1; i <= 14; i += 1) lambdas.push(i * 0.85);
    var curve = memo('curve', geometry + '@' + state.freeStreamMs, function () {
      return cpCurve(blade, state.freeStreamMs, lambdas);
    });
    var rotor = solveBemt(blade, flowAt(blade, state.freeStreamMs, state.lambda), false);
    var peak = curve.reduce(function (best, p) { return p.cp > best.cp ? p : best; }, curve[0]);
    var station75 = rotor.elements.reduce(function (best, e) {
      return Math.abs(e.radiusFrac - 0.75) < Math.abs(best.radiusFrac - 0.75) ? e : best;
    }, rotor.elements[0]);
    var mesh = memo('mesh', geometry, function () { return V.bladeToMesh(blade, V.DEFAULT_SECTION_STATIONS); });
    var extent = V.rotorExtent(mesh);
    var bounds = extent.bounds;
    var peakSpeed = SITE.constituents.reduce(function (s, c) { return s + c.amplitudeMs; }, Math.abs(SITE.residualMs || 0));
    var series = memo('series', geometry + '@' + state.lambda, function () {
      return buildHarvestSeries(buildCpSampler(blade, state.lambda, peakSpeed),
        Math.PI * blade.tipRadiusM * blade.tipRadiusM);
    });
    return {
      state: state, blade: blade, naca: state.naca, curve: curve, rotor: rotor, peak: peak,
      station75: station75, mesh: mesh, extent: extent, series: series,
      name: 'oshal_blade_R' + Math.round(blade.tipRadiusM * 1000) + 'mm_B' + blade.bladeCount,
      sizeMm: (bounds.size.x * 1000).toFixed(1) + ' × ' + (bounds.size.y * 1000).toFixed(1)
        + ' × ' + (bounds.size.z * 1000).toFixed(1) + ' mm',
      energy: memo('energy', geometry + '@' + state.lambda, function () {
        return simulateEnergyBudget(series, STORAGE.capacityWh, true);
      }),
      minStoreWh: memo('store', geometry + '@' + state.lambda, function () {
        return recommendStorageWh(series, 4000);
      }),
      mode: 'local mirror of @/features/rotor-design + @/shared/energy',
      serverNote: null
    };
  }

  /**
   * @description Solve, paint every visual, and hand the mesh to the 3-D viewer. Registered hover
   * targets are cleared first so a repaint cannot leave a scale pointing at stale data.
   * @returns Nothing.
   */
  function render() {
    pending = false;
    var pal = V.resolvePalette();
    V.resetHover();
    var model = solveModel();
    current = model;
    drawCpCurve(document.getElementById('cv-cp'), model, pal);
    drawSpanwise(document.getElementById('cv-span'), model, pal);
    drawEnergy(document.getElementById('cv-energy'), model, pal);
    renderVerdict(model);
    renderTables(model);
    setText('gl-size', model.sizeMm);
    setText('mode-badge', model.mode);
    if (viewer && viewer.supported) viewer.setBlade(model.mesh, model.blade.bladeCount);
    document.querySelectorAll('.legend i[data-series]').forEach(function (dot) {
      dot.style.background = pal.series[Number(dot.getAttribute('data-series'))] || pal.muted;
    });
    crossCheck(model, function (note) {
      if (current !== model || !note) return;
      model.serverNote = note;
      model.mode = 'local mirror, cross-checked against the API';
      setText('mode-badge', model.mode);
      renderTables(model);
    });
  }

  /**
   * @description Coalesce control churn into one solve per animation frame. A slider drag fires
   * dozens of input events; a BEMT sweep per event would wedge the tab.
   * @returns Nothing.
   */
  function scheduleRender() {
    if (pending) return;
    pending = true;
    global.requestAnimationFrame(render);
  }

  /**
   * @description Bind one control to a state key, keeping its output readout in sync.
   * @param id - Element id.
   * @param key - State key to write.
   * @param parse - Value parser.
   * @param format - Readout formatter, or null when the control has no output.
   * @returns Nothing.
   */
  function bindControl(id, key, parse, format) {
    var el = document.getElementById(id);
    if (!el) return;
    var out = document.getElementById(id + '-out');
    var sync = function () {
      state[key] = parse(el.value);
      if (out && format) out.textContent = format(state[key]);
    };
    sync();
    el.addEventListener('input', function () { sync(); scheduleRender(); });
    el.addEventListener('change', function () { sync(); scheduleRender(); });
  }

  /**
   * @description Bind every control on the page.
   * @returns Nothing.
   */
  function bindControls() {
    var num = function (v) { return parseFloat(v); };
    var fixed = function (digits, unit) {
      return function (v) { return v.toFixed(digits) + (unit || ''); };
    };
    bindControl('c-tipr', 'tipRadiusM', function (v) { return num(v) / 1000; }, function (v) { return (v * 1000).toFixed(0) + ' mm'; });
    bindControl('c-hub', 'hubFrac', num, function (v) { return (v * 100).toFixed(0) + '% of R'; });
    bindControl('c-blades', 'bladeCount', function (v) { return Math.round(num(v)); }, function (v) { return String(v); });
    bindControl('c-rootc', 'rootChordM', function (v) { return num(v) / 1000; }, function (v) { return (v * 1000).toFixed(1) + ' mm'; });
    bindControl('c-tipc', 'tipChordM', function (v) { return num(v) / 1000; }, function (v) { return (v * 1000).toFixed(1) + ' mm'; });
    bindControl('c-roott', 'rootTwistDeg', num, fixed(1, '°'));
    bindControl('c-tipt', 'tipTwistDeg', num, fixed(1, '°'));
    bindControl('c-law', 'twistLaw', function (v) { return v; }, null);
    bindControl('c-pitch', 'pitchDeg', num, fixed(1, '°'));
    bindControl('c-naca', 'naca', function (v) { return String(v).replace(/[^0-9]/g, '').slice(0, 4) || '0012'; }, null);
    bindControl('c-thick', 'rootThickness', num, function (v) { return (v * 100).toFixed(0) + '% chord'; });
    bindControl('c-speed', 'freeStreamMs', num, fixed(2, ' m/s'));
    bindControl('c-lambda', 'lambda', num, fixed(1, ''));
    var reset = document.getElementById('c-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        if (viewer && viewer.resetView) viewer.resetView();
        scheduleRender();
      });
    }
  }

  /**
   * @description Boot: seed the state, mount the viewer, bind everything, and paint. Also re-themes
   * on the `storage` event, because a surface is a same-origin iframe that does NOT inherit the
   * cockpit's `data-theme` — the cockpit writes the new theme and every surface follows.
   * @returns Nothing.
   */
  function boot() {
    Object.keys(DEFAULTS).forEach(function (key) { state[key] = DEFAULTS[key]; });
    var canvas = document.getElementById('gl');
    if (canvas && global.BladeStudioGL) viewer = global.BladeStudioGL.mount(canvas);
    var fallback = document.getElementById('gl-unsupported');
    if (fallback) fallback.hidden = !!(viewer && viewer.supported);
    bindControls();
    wireExports(function () { return current; });
    V.attachHover(document.getElementById('tooltip'));
    var retheme = function () {
      if (viewer && viewer.setTheme) viewer.setTheme();
      scheduleRender();
    };
    global.addEventListener('storage', retheme);
    global.addEventListener('focus', retheme);
    global.addEventListener('resize', scheduleRender);
    render();
  }

  global.BladeStudio = {
    solveBemt: solveBemt, cpCurve: cpCurve, sectionPolar: sectionPolar,
    sectionLiftLine: sectionLiftLine, simulateEnergyBudget: simulateEnergyBudget,
    recommendStorageWh: recommendStorageWh, currentSpeedAt: currentSpeedAt, buildCpSampler: buildCpSampler,
    buildHarvestSeries: buildHarvestSeries, sectionCache: sectionCache, makePolar: makePolar,
    turbinePowerW: turbinePowerW, boot: boot,
    BETZ_LIMIT: BETZ_LIMIT, TWIST_LAWS: TWIST_LAWS, DEFAULTS: DEFAULTS, SITE: SITE, LOADS: LOADS, STORAGE: STORAGE
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}(typeof window !== 'undefined' ? window : this));
