"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the divergence between two cross-check runs
    |                                           | (BACKLOG B28): the same vehicle file, the same manoeuvre and the same
    |                                           | controller read back from both flight stacks, or the comparison is
    |                                           | refused by name. Both runs are aligned at the moment OFFBOARD was
    |                                           | accepted with the vehicle armed, expressed relative to their own rest
    |                                           | pose, resampled onto one clock, and compared per axis (RMS and max
    |                                           | position error, yaw error) and per leg (rise time, overshoot,
    |                                           | settling). A difference past the declared tolerances is a FINDING
    |                                           | about one of the two models, named as such -- this module never
    |                                           | decides which one is wrong. Standard library only.
2   | maintainer@emeraldcoastsystemsgroup.com   | Every commanded phase is compared from ITS OWN command, not only from
    |                                           | the moment OFFBOARD was accepted. Two SIH runs of one vehicle file
    |                                           | (PX4 1.18.0, 2026-09-28) differed by 23.5 degrees of yaw with a single
    |                                           | alignment: the harness sends each setpoint on a 10 Hz tick and closes
    |                                           | a segment on the vehicle's clock, so one run's yaw command landed a
    |                                           | tick later than the other's -- harness timing, a third thing, that the
    |                                           | first cut would have reported as a model difference. Each phase is now
    |                                           | resampled from its own segment (or LAND) event over the shorter of its
    |                                           | two durations, and each phase's command offset is published. A run
    |                                           | that did not complete is refused.
"""
from __future__ import annotations

import argparse
import json
import math
import sys

TRAJECTORY_SCHEMA = "embodied.px4-crosscheck.trajectory/1"
DIVERGENCE_SCHEMA = "embodied.px4-crosscheck.divergence/1"
ALIGN_EVENT = "offboard-armed"
RESAMPLE_HZ = 20.0

# The cross-check's acceptance band. Declared, not derived: two different physics models flying one
# F450 through one PX4 controller should track the same setpoints to within these. A metric past its
# tolerance is a finding, not a failure of the harness.
TOLERANCES = {
    "positionRmsM": 0.25,
    "positionMaxM": 0.75,
    "yawRmsDeg": 5.0,
    "yawMaxDeg": 15.0,
    "riseTimeS": 0.5,
    "overshootPct": 10.0,
    "settlingS": 1.0,
}

# Which axis each leg of the manoeuvre steps, and the band a response must stay inside to count as
# settled: a fraction of the step, never tighter than the floor.
LEG_AXES = {"takeoff": "up", "leg-north": "n", "yaw-90": "yawDeg"}
SETTLE_FRACTION = 0.05
SETTLE_FLOOR = {"up": 0.05, "n": 0.05, "yawDeg": 2.0}

EXIT_AGREE, EXIT_DIVERGE, EXIT_REFUSED = 0, 1, 2


def _wrap_deg(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


def validate_run(run: dict) -> list[str]:
    """@description The problems that make a trajectory file unusable, each named; an empty list is a usable run.
    @param run The parsed trajectory file. @returns Problem strings."""
    problems = []
    if run.get("complete") is not True:
        problems.append(f"complete: the run did not finish ({run.get('error')})")
    if run.get("schema") != TRAJECTORY_SCHEMA:
        problems.append(f"schema: expected {TRAJECTORY_SCHEMA}, got {run.get('schema')!r}")
    samples = run.get("samples") or []
    if len(samples) < 2:
        problems.append("samples: fewer than two position samples")
    times = [s.get("t") for s in samples]
    if any(not isinstance(t, (int, float)) for t in times):
        problems.append("samples: a sample has no numeric t")
    elif any(b <= a for a, b in zip(times, times[1:])):
        problems.append("samples: time is not strictly increasing")
    if not (run.get("attitude") or []):
        problems.append("attitude: no attitude samples")
    events = run.get("events") or []
    if not any(e.get("event") == ALIGN_EVENT for e in events):
        problems.append(f"events: no {ALIGN_EVENT} event to align on")
    if not isinstance(run.get("rest"), dict):
        problems.append("rest: the vehicle's rest pose is missing")
    return problems


def comparability(a: dict, b: dict) -> list[str]:
    """@description Why two runs cannot be compared at all: another manoeuvre, another vehicle file, a
    controller parameter that differs between the two flight stacks, or an unusable file.
    @param a First run. @param b Second run. @returns Refusal strings; empty when comparable."""
    refusals = [f"a.{p}" for p in validate_run(a)] + [f"b.{p}" for p in validate_run(b)]
    if (a.get("manoeuvre") or {}).get("sha256") != (b.get("manoeuvre") or {}).get("sha256"):
        refusals.append("different_manoeuvre: the two runs flew different manoeuvre definitions")
    if (a.get("vehicle") or {}).get("sha256") != (b.get("vehicle") or {}).get("sha256"):
        refusals.append("different_vehicle: the two runs declared different vehicle files")
    for run, label in ((a, "a"), (b, "b")):
        if (run.get("vehicle") or {}).get("confirmed") is not True:
            refusals.append(f"unconfirmed_vehicle: {label} never had its vehicle parameters confirmed by the flight stack")
    ca, cb = a.get("controller") or {}, b.get("controller") or {}
    differing = sorted(k for k in set(ca) | set(cb) if k not in ca or k not in cb or not math.isclose(ca[k], cb[k], rel_tol=1e-6, abs_tol=1e-9))
    if differing:
        refusals.append("different_controller: " + ", ".join(differing))
    return refusals


def _align_time(run: dict) -> float:
    return next(float(e["t"]) for e in run["events"] if e.get("event") == ALIGN_EVENT)


def aligned_series(run: dict) -> dict:
    """@description A run as series on its own clock: t = 0 where OFFBOARD was accepted armed, position
    relative to the rest pose (n, e, up), yaw relative to the rest heading in degrees, unwrapped.
    @param run A valid trajectory. @returns {'pos': (t, n, e, up), 'yaw': (t, yawDeg)}."""
    t0 = _align_time(run)
    rest = run["rest"]
    tp, n, e, up = [], [], [], []
    for s in run["samples"]:
        tp.append(float(s["t"]) - t0)
        n.append(float(s["n"]) - float(rest["n"]))
        e.append(float(s["e"]) - float(rest["e"]))
        up.append(float(rest["d"]) - float(s["d"]))
    ty, yaw = [], []
    previous = None
    for s in run["attitude"]:
        relative = _wrap_deg(math.degrees(float(s["yaw"]) - float(rest["yaw"])))
        if previous is not None:  # unwrap: a heading that crosses +-180 stays one continuous angle
            relative = previous + _wrap_deg(relative - previous)
        ty.append(float(s["t"]) - t0)
        yaw.append(relative)
        previous = relative
    return {"pos": (tp, n, e, up), "yaw": (ty, yaw)}


def resample(times: list[float], values: list[float], grid: list[float]) -> list[float]:
    """@description Linear interpolation of (times, values) onto grid; the grid must lie inside times.
    @param times Strictly increasing. @param values Same length. @param grid Increasing. @returns Values on the grid."""
    out, i = [], 0
    for g in grid:
        while i < len(times) - 2 and times[i + 1] < g:
            i += 1
        t_a, t_b = times[i], times[i + 1]
        w = 0.0 if t_b == t_a else (g - t_a) / (t_b - t_a)
        out.append(values[i] + w * (values[i + 1] - values[i]))
    return out


def phase_windows(run: dict) -> list[tuple[str, float, float]]:
    """@description Every commanded phase on the aligned clock: each segment from its own event to the next command,
    and the landing from LAND to landed (or the end of the data).
    @param run A valid trajectory. @returns [(name, start, end)] in flight order."""
    t0 = _align_time(run)
    end_of_data = min(float(run["samples"][-1]["t"]), float(run["attitude"][-1]["t"]))
    at = lambda name: next((float(e["t"]) for e in run["events"] if e.get("event") == name), None)  # noqa: E731
    land, landed = at("land"), at("landed")
    marks = [(e["name"], float(e["t"])) for e in run["events"] if e.get("event") == "segment"]
    ends = [t for _, t in marks[1:]] + [land if land is not None else end_of_data]
    windows = [(name, start - t0, end - t0) for (name, start), end in zip(marks, ends)]
    if land is not None:
        windows.append(("land", land - t0, (landed if landed is not None else end_of_data) - t0))
    return windows


def _series_end(series: dict) -> float:
    return min(series["pos"][0][-1], series["yaw"][0][-1])


def phase_errors(sa: dict, sb: dict, wa: list, wb: list, hz: float = RESAMPLE_HZ) -> tuple[dict, list[dict]]:
    """@description Run a minus run b, phase by phase: each phase resampled from ITS OWN command in each run over the
    shorter of the two durations, so a command one run sent a tick later is not counted as a model difference.
    @param sa Aligned series of a. @param sb Aligned series of b. @param wa phase_windows(a). @param wb phase_windows(b).
    @param hz Rate. @returns ({axis: [error]}, [per-phase clock: name, points, durationS, commandOffsetS])."""
    errors: dict[str, list[float]] = {"n": [], "e": [], "up": [], "yawDeg": []}
    clocks = []
    other = {name: (start, end) for name, start, end in wb}
    for name, start_a, end_a in wa:
        if name not in other:
            continue
        start_b, end_b = other[name]
        span = min(end_a - start_a, end_b - start_b, _series_end(sa) - start_a, _series_end(sb) - start_b)
        local = [k / hz for k in range(int(math.floor(span * hz + 1e-9)) + 1)] if span > 0 else []
        for k, axis in ((1, "n"), (2, "e"), (3, "up")):
            va = resample(sa["pos"][0], sa["pos"][k], [start_a + g for g in local])
            vb = resample(sb["pos"][0], sb["pos"][k], [start_b + g for g in local])
            errors[axis] += [x - y for x, y in zip(va, vb)]
        ya = resample(sa["yaw"][0], sa["yaw"][1], [start_a + g for g in local])
        yb = resample(sb["yaw"][0], sb["yaw"][1], [start_b + g for g in local])
        errors["yawDeg"] += [_wrap_deg(x - y) for x, y in zip(ya, yb)]
        clocks.append({"phase": name, "points": len(local), "durationS": span, "commandOffsetS": start_b - start_a})
    return errors, clocks


def _rms(xs: list[float]) -> float:
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else 0.0


def segment_windows(run: dict) -> dict:
    """@description Each flown leg's window on the aligned clock, from the harness's segment events.
    @param run A valid trajectory. @returns {name: (start, end)}."""
    return {name: (start, end) for name, start, end in phase_windows(run) if name != "land"}


def step_metrics(t: list[float], v: list[float], window: tuple[float, float], start: float, target: float, floor: float) -> dict:
    """@description One leg's step response: 10-90 % rise time, overshoot as a percentage of the step in
    its own direction, and settling time (the last moment outside the band) -- all from the leg's start.
    @param t Aligned times. @param v The stepped axis. @param window (start, end) of the leg.
    @param start The value before the step. @param target The commanded value. @param floor Band floor.
    @returns {'riseTimeS', 'overshootPct', 'settlingS'}; None for a quantity the leg never reached."""
    step = target - start
    pts = [(ti - window[0], vi) for ti, vi in zip(t, v) if window[0] <= ti <= window[1]]
    if not pts or step == 0:
        return {"riseTimeS": None, "overshootPct": None, "settlingS": None}
    frac = [((vi - start) / step, ti) for ti, vi in pts]
    t10 = next((ti for f, ti in frac if f >= 0.1), None)
    t90 = next((ti for f, ti in frac if f >= 0.9), None)
    rise = None if t10 is None or t90 is None else t90 - t10
    overshoot = max(0.0, max(f for f, _ in frac) - 1.0) * 100.0
    band = max(abs(step) * SETTLE_FRACTION, floor)
    outside = [ti for ti, vi in pts if abs(vi - target) > band]
    settling = 0.0 if not outside else (None if outside[-1] == pts[-1][0] else outside[-1])
    return {"riseTimeS": rise, "overshootPct": overshoot, "settlingS": settling}


def _leg_targets(run: dict) -> dict:
    segments = {s["name"]: s for s in (run.get("manoeuvre") or {}).get("segments") or []}
    order = [s["name"] for s in (run.get("manoeuvre") or {}).get("segments") or []]
    targets = {}
    for name, axis in LEG_AXES.items():
        if name not in segments:
            continue
        before = segments[order[order.index(name) - 1]] if order.index(name) > 0 else {"n": 0.0, "e": 0.0, "up": 0.0, "yawDeg": 0.0}
        targets[name] = (axis, float(before[axis]), float(segments[name][axis]))
    return targets


def leg_metrics(run: dict, series: dict) -> dict:
    """@description Step metrics for every leg the manoeuvre declares a stepped axis for.
    @param run The trajectory. @param series Its aligned series. @returns {leg: metrics}."""
    windows = segment_windows(run)
    tp, n, _e, up = series["pos"]
    ty, yaw = series["yaw"]
    axes = {"n": (tp, n), "up": (tp, up), "yawDeg": (ty, yaw)}
    out = {}
    for leg, (axis, start, target) in _leg_targets(run).items():
        if leg in windows:
            t, v = axes[axis]
            out[leg] = {"axis": axis, "from": start, "to": target, **step_metrics(t, v, windows[leg], start, target, SETTLE_FLOOR[axis])}
    return out


def _exceeded(axes: dict, legs: dict, tol: dict) -> list[dict]:
    over = []
    for axis, m in axes.items():
        rms_key, max_key = ("yawRmsDeg", "yawMaxDeg") if axis == "yawDeg" else ("positionRmsM", "positionMaxM")
        if m["rms"] > tol[rms_key]:
            over.append({"metric": f"{axis}.rms", "value": m["rms"], "tolerance": tol[rms_key]})
        if m["max"] > tol[max_key]:
            over.append({"metric": f"{axis}.max", "value": m["max"], "tolerance": tol[max_key]})
    for leg, d in legs.items():
        for key, tol_key in (("riseTimeS", "riseTimeS"), ("overshootPct", "overshootPct"), ("settlingS", "settlingS")):
            delta = d["difference"][key]
            if delta is None or abs(delta) > tol[tol_key]:
                over.append({"metric": f"{leg}.{key}", "value": delta, "tolerance": tol[tol_key]})
    return over


def _leg_differences(la: dict, lb: dict) -> dict:
    legs = {}
    for leg in sorted(set(la) & set(lb)):
        diff = {}
        for key in ("riseTimeS", "overshootPct", "settlingS"):
            x, y = la[leg][key], lb[leg][key]
            # Both never reaching a quantity is agreement; only one reaching it is a finding (None).
            diff[key] = 0.0 if x is None and y is None else (None if x is None or y is None else x - y)
        legs[leg] = {"a": la[leg], "b": lb[leg], "difference": diff}
    return legs


def compare(a: dict, b: dict, tolerances: dict | None = None) -> dict:
    """@description The divergence of run b from run a, or the refusal to compare them.
    @param a First run. @param b Second run. @param tolerances Overrides for TOLERANCES.
    @returns The divergence document; its 'verdict' is agree, diverge or refused."""
    tol = {**TOLERANCES, **(tolerances or {})}
    labels = {"a": a.get("simulator", "a"), "b": b.get("simulator", "b")}
    refusals = comparability(a, b)
    if refusals:
        return {"schema": DIVERGENCE_SCHEMA, "labels": labels, "verdict": "refused", "refusals": refusals, "tolerances": tol}
    sa, sb = aligned_series(a), aligned_series(b)
    errors, clocks = phase_errors(sa, sb, phase_windows(a), phase_windows(b))
    axes = {k: {"rms": _rms(v), "max": max((abs(x) for x in v), default=0.0)} for k, v in errors.items()}
    horizontal = [math.hypot(x, y) for x, y in zip(errors["n"], errors["e"])]
    legs = _leg_differences(leg_metrics(a, sa), leg_metrics(b, sb))
    over = _exceeded(axes, legs, tol)
    findings = [{**o, "about": f"one of the two models ({labels['a']} or {labels['b']}); this comparison does not say which"} for o in over]
    return {"schema": DIVERGENCE_SCHEMA, "labels": labels, "verdict": "diverge" if over else "agree", "tolerances": tol,
            "clock": {"hz": RESAMPLE_HZ, "points": sum(c["points"] for c in clocks), "phases": clocks},
            "axes": axes, "horizontal": {"rms": _rms(horizontal), "max": max(horizontal, default=0.0)}, "legs": legs, "findings": findings}


def self_check(run: dict) -> dict:
    """@description A run compared with itself: usable, and every error exactly zero, or it says why not.
    @param run The trajectory. @returns {'ok', 'problems', 'divergence'}."""
    problems = validate_run(run)
    if problems:
        return {"ok": False, "problems": problems}
    d = compare(run, run)
    nonzero = [k for k, m in (d.get("axes") or {}).items() if m["rms"] != 0.0 or m["max"] != 0.0]
    return {"ok": d["verdict"] == "agree" and not nonzero, "problems": [f"self-divergence on {k}" for k in nonzero] + d.get("refusals", []), "divergence": d}


def _read(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main(argv: list[str] | None = None) -> int:
    """@description CLI: `divergence.py a.json b.json [--out d.json]` or `divergence.py --self-check a.json`.
    @param argv Arguments. @returns 0 agree / self-check ok, 1 diverge / self-check failed, 2 refused."""
    parser = argparse.ArgumentParser(description="Divergence between two PX4 cross-check trajectories.")
    parser.add_argument("runs", nargs="*")
    parser.add_argument("--self-check", dest="self_check")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    if args.self_check:
        report = self_check(_read(args.self_check))
        code = EXIT_AGREE if report["ok"] else EXIT_DIVERGE
    elif len(args.runs) == 2:
        report = compare(_read(args.runs[0]), _read(args.runs[1]))
        code = {"agree": EXIT_AGREE, "diverge": EXIT_DIVERGE}.get(report["verdict"], EXIT_REFUSED)
    else:
        parser.error("give two trajectory files, or --self-check one")
        return EXIT_REFUSED
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(report, fh, indent=1, sort_keys=True)
            fh.write("\n")
    summary = {k: report.get(k) for k in ("ok", "verdict", "problems", "refusals", "axes", "findings") if k in report}
    sys.stdout.write(json.dumps(summary, sort_keys=True) + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
