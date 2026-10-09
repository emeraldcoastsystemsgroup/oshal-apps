"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | Initial creation -- the PX4 cross-check harness and its divergence
    |                                           | without a flight stack (BACKLOG B28). A link double stands in for
    |                                           | PX4 in simulated time (rate-limited toward the streamed setpoint,
    |                                           | PARAM_VALUE echoes, bytewise integer parameters, LAND and auto-
    |                                           | disarm) and drives the real harness end to end: the vehicle file's
    |                                           | values follow from its declared inputs, the file maps to PARAM_SET
    |                                           | per backend, a non-SITL airframe and an unconfirmed parameter stop
    |                                           | the run before anything is armed, segments are timed on the
    |                                           | vehicle's clock (a lockstep simulator at half speed flies the same
    |                                           | trajectory), alignment removes a boot-time offset, a known 0.5 m
    |                                           | offset is measured exactly and the verdict goes red, step metrics
    |                                           | match a closed-form response, every refusal is named, and the CLI
    |                                           | exits by verdict. Standard library only, with its own runner: the
    |                                           | engine image ships no pytest (BACKLOG B25).
2   | maintainer@emeraldcoastsystemsgroup.com   | A command one run sent a tick later is harness timing, not a model
    |                                           | difference: a yaw command 0.25 s late in one run compares as zero
    |                                           | error phase by phase (and would read as tens of degrees from a single
    |                                           | alignment, as two real SIH runs did). An unfinished run is refused.
"""
from __future__ import annotations

import copy
import json
import math
import os
import struct
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.dont_write_bytecode = True  # a test run leaves no __pycache__ in the package tree
sys.path.insert(0, os.path.join(ENGINE, "crosscheck"))

import divergence  # noqa: E402
import px4_crosscheck as xc  # noqa: E402

VEHICLE = xc.load_vehicle()
TICK = xc.TICK_S


class FakeMsg:
    """A MAVLink message as pymavlink hands it over: a type, a source system, fields as attributes."""

    def __init__(self, kind: str, src: int = 1, **fields) -> None:
        self._kind, self._src = kind, src
        self.__dict__.update(fields)

    def get_type(self) -> str:
        return self._kind

    def get_srcSystem(self) -> int:
        return self._src


def _f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def _wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


class FakePx4:
    """PX4 in simulated time behind the harness's link surface. The vehicle flies toward the streamed setpoint at
    most 2 m/s across, 1 m/s up and down and 45 deg/s in yaw; LAND descends and disarms half a second after touching
    down. `speed` is the lockstep rate: simulated seconds per wall second. Parameters answer PARAM_VALUE, integers
    bytewise as PX4 sends them; names in `drop` are never echoed and names in `substitute` echo another value.
    Values are test-double values, not PX4's."""

    def __init__(self, autostart: int = 10040, speed: float = 1.0, boot_s: float = 7.0, drop: tuple = (), substitute: dict | None = None) -> None:
        self.hooks: list = []
        self.lock = threading.Lock()
        self.sim, self.wall_s, self.speed, self.next_emit = boot_s, 0.0, speed, boot_s
        self.params: dict[str, tuple[float, int]] = {"SYS_AUTOSTART": (autostart, 6)}
        for i, name in enumerate(VEHICLE["readBack"]["controller"]):
            self.params[name] = (0.5 + 0.01 * i, 9)
        for name in list(VEHICLE["sih"]) + list(VEHICLE["allocation"]) + VEHICLE["readBack"]["sihUnset"]:
            self.params.setdefault(name, (1.0, 9))
        self.drop = set(drop)
        self.substitute = dict(substitute or {})  # name -> the value this vehicle stores instead of the one it was sent
        self.armed, self.custom_mode, self.landed_state = False, 0, xc.MAV_LANDED_STATE_ON_GROUND
        self.vehicle_seen, self.autopilot_version = 1.0, "1.18.0"
        self.ground_d = -0.05
        self.pos, self.vel, self.yaw = [0.3, -0.2, self.ground_d], [0.0, 0.0, 0.0], 0.1
        self.target = None
        self.landing, self.touchdown = False, None
        self.log: list = []
        self.arm_calls = 0

    # -- the link surface the harness uses ---------------------------------------------------------------------
    def attach(self, hook) -> None:
        self.hooks.append(hook)

    def _send(self, msg: FakeMsg) -> None:
        for hook in self.hooks:
            hook(msg)

    def _param_value(self, name: str) -> None:
        value, ptype = self.params[name]
        wire = float(value) if ptype == 9 else struct.unpack("<f", struct.pack("<i", int(value)))[0]
        self._send(FakeMsg("PARAM_VALUE", param_id=name, param_value=wire, param_type=ptype))

    def param_set(self, name: str, value: float) -> None:
        self.log.append(("param_set", name, value))
        if name in self.params and name not in self.drop:
            self.params[name] = (_f32(self.substitute.get(name, value)), 9)
            self._param_value(name)

    def param_request(self, name: str) -> None:
        self.log.append(("param_request", name))
        if name in self.params:
            self._param_value(name)

    def request_streams(self) -> None:
        self.log.append(("streams",))

    def command(self, *args) -> None:
        self.log.append(("command",) + args)

    def set_offboard(self) -> None:
        if self.target is not None:
            self.custom_mode = xc.PX4_MAIN_MODE_OFFBOARD << 16

    def arm(self, on: bool) -> None:
        self.arm_calls += 1
        self.armed = bool(on)

    def land(self) -> None:
        self.landing, self.custom_mode = True, 4 << 16

    def setpoint(self, n: float, e: float, d: float, yaw_ned: float) -> None:
        self.target = (n, e, d, yaw_ned)

    def close(self) -> None:
        pass

    # -- the clock -----------------------------------------------------------------------------------------------
    def wall(self) -> float:
        return self.wall_s

    def wait(self, dt: float) -> None:
        self.wall_s += dt
        end = self.sim + dt * self.speed
        while self.sim < end - 1e-12:
            h = min(0.005, end - self.sim)
            self._physics(h)
            self.sim += h
            if self.sim >= self.next_emit - 1e-9:
                self._emit()
                self.next_emit += 0.02

    def _physics(self, h: float) -> None:
        if self.landing and self.armed:
            self.vel = [0.0, 0.0, 0.7]
            self.pos[2] = min(self.ground_d, self.pos[2] + 0.7 * h)
            if self.pos[2] >= self.ground_d:
                self.landed_state, self.vel = xc.MAV_LANDED_STATE_ON_GROUND, [0.0, 0.0, 0.0]
                self.touchdown = self.sim if self.touchdown is None else self.touchdown
                if self.sim - self.touchdown >= 0.5:
                    self.armed, self.landing = False, False
            return
        if not (self.armed and self.custom_mode >> 16 == xc.PX4_MAIN_MODE_OFFBOARD and self.target):
            return
        limits = (2.0, 2.0, 1.0)
        for k in range(3):
            v = (self.target[k] - self.pos[k]) / 0.8
            self.vel[k] = max(-limits[k], min(limits[k], v))
            self.pos[k] += self.vel[k] * h
        rate = max(-math.pi / 4, min(math.pi / 4, _wrap(self.target[3] - self.yaw) / 0.5))
        self.yaw = _wrap(self.yaw + rate * h)
        self.landed_state = 2 if self.pos[2] < self.ground_d - 0.05 else xc.MAV_LANDED_STATE_ON_GROUND

    def _emit(self) -> None:
        ms = int(round(self.sim * 1000))
        n, e, d = self.pos
        self._send(FakeMsg("LOCAL_POSITION_NED", time_boot_ms=ms, x=n, y=e, z=d, vx=self.vel[0], vy=self.vel[1], vz=self.vel[2]))
        self._send(FakeMsg("ATTITUDE", time_boot_ms=ms, roll=0.0, pitch=0.0, yaw=self.yaw))


def _fly(backend: str = "sih", **fake) -> tuple[dict, FakePx4]:
    px4 = FakePx4(autostart=VEHICLE["sitlAirframes"][backend], **fake) if "autostart" not in fake else FakePx4(**fake)
    doc = xc.CrossCheckRun(px4, xc.Recorder(), VEHICLE, backend, f"fake-{backend}", wait=px4.wait, wall=px4.wall).run()
    return doc, px4


_REFERENCE: dict = {}


def _reference() -> dict:
    """One completed SIH-backend run, flown once and shared (read-only) by the divergence cases."""
    if not _REFERENCE:
        doc, _ = _fly("sih")
        assert doc["complete"], doc["error"]
        _REFERENCE["doc"] = doc
    return copy.deepcopy(_REFERENCE["doc"])


# -- the vehicle file -------------------------------------------------------------------------------------------
def test_vehicle_file_values_follow_from_its_declared_inputs() -> None:
    derived = xc.derive_vehicle(VEHICLE["inputs"])
    assert derived["sih"] == VEHICLE["sih"], (derived["sih"], VEHICLE["sih"])
    assert derived["allocation"] == VEHICLE["allocation"], (derived["allocation"], VEHICLE["allocation"])
    assert set(VEHICLE["provenance"]) == set(VEHICLE["inputs"]), "every declared input names where it came from"
    assert abs(VEHICLE["sih"]["SIH_L_ROLL"] - 0.225 * math.sqrt(0.5)) < 1e-6, "the arm lever of a 450 mm X frame"
    thrust = 4 * VEHICLE["sih"]["SIH_T_MAX"] / (VEHICLE["sih"]["SIH_MASS"] * VEHICLE["inputs"]["gravityMps2"])
    assert abs(thrust - 2.0) < 1e-5, "four rotors at full thrust lift twice the takeoff weight"
    assert VEHICLE["sitlAirframes"] == {"sih": 10040, "external": 10016}


def test_the_file_maps_to_param_set_per_backend() -> None:
    sih = xc.param_plan(VEHICLE, "sih")
    external = xc.param_plan(VEHICLE, "external")
    assert [n for n, _ in sih] == sorted(VEHICLE["sih"]) + sorted(VEHICLE["allocation"])
    assert [n for n, _ in external] == sorted(VEHICLE["allocation"]), "no SIH value is sent to an external simulator's PX4"
    assert all(isinstance(v, float) for _, v in sih)
    for bad in ({**VEHICLE, "allocation": {"CA_ROTOR_COUNT": 4}}, {**VEHICLE, "sih": {"SIH_MASS": "1.2"}}):
        try:
            xc.param_plan(bad, "sih")
        except ValueError as error:
            assert "only REAL32" in str(error)
        else:
            raise AssertionError("a non-float parameter must be refused")
    try:
        xc.param_plan(VEHICLE, "gazebo")
    except ValueError as error:
        assert "unknown backend" in str(error)
    else:
        raise AssertionError("an unknown backend must be refused")


def test_the_recorder_decodes_parameters_and_ignores_its_own_messages() -> None:
    rec = xc.Recorder()
    rec.on_message(FakeMsg("PARAM_VALUE", param_id="SYS_AUTOSTART", param_value=struct.unpack("<f", struct.pack("<i", 10040))[0], param_type=6))
    rec.on_message(FakeMsg("PARAM_VALUE", param_id=b"SIH_MASS\x00\x00", param_value=1.2000000476837158, param_type=9))
    rec.on_message(FakeMsg("LOCAL_POSITION_NED", src=xc.OWN_SYSTEM, time_boot_ms=5, x=9, y=9, z=9, vx=0, vy=0, vz=0))
    rec.on_message(FakeMsg("LOCAL_POSITION_NED", time_boot_ms=20, x=1, y=2, z=-3, vx=0, vy=0, vz=0))
    rec.on_message(FakeMsg("LOCAL_POSITION_NED", time_boot_ms=20, x=7, y=7, z=7, vx=0, vy=0, vz=0))
    assert rec.param("SYS_AUTOSTART") == 10040, "an INT32 arrives bytewise in the float"
    assert abs(rec.param("SIH_MASS") - 1.2) < 1e-6
    assert [s["n"] for s in rec.samples] == [1.0], "our own message and a repeated timestamp are dropped"
    assert rec.vehicle_time() == 0.02


# -- the harness over the link double ---------------------------------------------------------------------------
def test_the_sih_leg_flies_the_manoeuvre_and_records_it() -> None:
    doc = _reference()
    assert doc["complete"] and doc["error"] is None and doc["schema"] == xc.TRAJECTORY_SCHEMA
    plan = dict(xc.param_plan(VEHICLE, "sih"))
    applied = doc["vehicle"]["applied"]
    assert doc["vehicle"]["confirmed"] is True and set(applied) == set(plan), sorted(set(plan) ^ set(applied))
    assert all(math.isclose(applied[n], v, rel_tol=1e-6) for n, v in plan.items()), "recorded as the vehicle echoed them (REAL32)"
    assert set(doc["controller"]) == set(VEHICLE["readBack"]["controller"]) and set(doc["vehicle"]["sihUnset"]) == set(VEHICLE["readBack"]["sihUnset"])
    assert doc["px4"] == {"version": "1.18.0", "sysAutostart": 10040}
    names = [e["event"] if e["event"] != "segment" else e["name"] for e in doc["events"]]
    assert names == ["offboard-armed", "takeoff", "leg-north", "yaw-90", "hover", "land", "landed"], names
    assert abs(doc["rest"]["n"] - 0.3) < 1e-9 and abs(doc["rest"]["e"] + 0.2) < 1e-9 and abs(doc["rest"]["yaw"] - 0.1) < 1e-9
    last = doc["samples"][-1]
    assert abs(last["n"] - 5.3) < 0.05 and abs(last["d"] + 0.05) < 1e-6, "flew the leg north of the rest pose and landed"
    assert divergence.self_check(doc)["ok"] is True


def test_the_external_leg_sets_only_the_allocation() -> None:
    doc, px4 = _fly("external")
    assert doc["complete"], doc["error"]
    sent = [entry[1] for entry in px4.log if entry[0] == "param_set"]
    assert sent == sorted(VEHICLE["allocation"]) and not any(n.startswith("SIH_") for n in sent)
    assert doc["vehicle"]["sihUnset"] == {} and doc["px4"]["sysAutostart"] == 10016


def test_a_vehicle_that_is_not_the_backends_sitl_airframe_is_never_armed() -> None:
    doc, px4 = _fly("sih", autostart=4011)  # a real F450's airframe, not SITL
    assert doc["complete"] is False and doc["error"].startswith("not_a_sitl_vehicle: SYS_AUTOSTART 4011"), doc["error"]
    assert px4.arm_calls == 0 and not any(entry[0] == "param_set" for entry in px4.log), "refused before a single PARAM_SET"
    doc, px4 = _fly("sih", autostart=10016)  # the external airframe named as SIH
    assert doc["error"].startswith("not_a_sitl_vehicle") and px4.arm_calls == 0


def test_an_unconfirmed_parameter_stops_the_run_before_arming() -> None:
    doc, px4 = _fly("sih", drop=("SIH_MASS",))
    assert doc["complete"] is False and doc["error"].startswith("param_not_confirmed: SIH_MASS"), doc["error"]
    assert px4.arm_calls == 0 and doc["vehicle"]["confirmed"] is False
    assert len([e for e in px4.log if e[:2] == ("param_set", "SIH_MASS")]) == xc.TIMEOUTS["paramTries"], "retried, then refused"
    doc, px4 = _fly("sih", substitute={"SIH_MASS": 1.0})  # echoed, but not the value that was sent
    assert doc["error"].startswith("param_not_confirmed: SIH_MASS") and px4.arm_calls == 0, doc["error"]


def test_segments_are_timed_on_the_vehicle_clock() -> None:
    fast = _reference()
    slow, _ = _fly("sih", speed=0.5, boot_s=19.3)  # a lockstep simulator at half real time, booted at another moment
    assert slow["complete"], slow["error"]
    for doc, speed in ((fast, 1.0), (slow, 0.5)):
        marks = [e for e in doc["events"] if e["event"] in ("segment", "land")]
        for seg, (a, b) in zip(xc.MANOEUVRE["segments"], zip(marks, marks[1:])):
            held = b["t"] - a["t"]
            assert seg["holdS"] - 1e-9 <= held <= seg["holdS"] + TICK * speed + 0.021, (seg["name"], speed, held)
    d = divergence.compare(fast, slow)
    assert d["verdict"] == "agree", d["findings"]
    assert d["axes"]["n"]["max"] < 0.3 and d["axes"]["up"]["max"] < 0.15, d["axes"]


# -- the divergence ----------------------------------------------------------------------------------------------
def test_alignment_removes_a_boot_time_and_rest_offset() -> None:
    a = _reference()
    b = copy.deepcopy(a)
    for s in b["samples"]:
        s["t"] += 3.7
        s["n"] += 10.0
    for s in b["attitude"]:
        s["t"] += 3.7
        s["yaw"] = _wrap(s["yaw"] + 2.0)
    for e in b["events"]:
        e["t"] += 3.7
    b["rest"]["n"] += 10.0
    b["rest"]["yaw"] = _wrap(b["rest"]["yaw"] + 2.0)
    d = divergence.compare(a, b)
    assert d["verdict"] == "agree", d
    for axis, m in d["axes"].items():
        assert m["rms"] < 1e-9 and m["max"] < 1e-9, (axis, m)


def test_a_command_sent_late_in_one_run_is_not_a_model_difference() -> None:
    a = _reference()
    b = copy.deepcopy(a)
    late = 0.25
    t_yaw = next(e["t"] for e in a["events"] if e.get("name") == "yaw-90")
    for series in (b["samples"], b["attitude"], b["events"]):
        for item in series:
            if item["t"] >= t_yaw:
                item["t"] += late  # the yaw command, and everything the vehicle did after it, a quarter second later
    d = divergence.compare(a, b)
    assert d["verdict"] == "agree", d["findings"]
    for axis, m in d["axes"].items():
        # Not exactly zero: the late run has no samples for the quarter second it was shifted by, so the last points
        # of its leg-north interpolate across that gap while the vehicle creeps by micrometres.
        assert m["max"] < 1e-3, (axis, m)
    offsets = {c["phase"]: c["commandOffsetS"] for c in d["clock"]["phases"]}
    assert abs(offsets["yaw-90"] - late) < 1e-9 and abs(offsets["leg-north"]) < 1e-9, offsets
    assert [c["phase"] for c in d["clock"]["phases"]] == ["takeoff", "leg-north", "yaw-90", "hover", "land"]


def test_a_known_offset_is_measured_exactly_and_goes_red() -> None:
    a = _reference()
    b = copy.deepcopy(a)
    t0 = next(e["t"] for e in a["events"] if e["event"] == "offboard-armed")
    for s in b["samples"]:
        if s["t"] >= t0:
            s["n"] += 0.5
    d = divergence.compare(a, b)
    assert d["verdict"] == "diverge"
    assert abs(d["axes"]["n"]["rms"] - 0.5) < 1e-9 and abs(d["axes"]["n"]["max"] - 0.5) < 1e-9, d["axes"]["n"]
    assert d["axes"]["e"]["max"] == 0.0 and d["axes"]["up"]["max"] == 0.0 and d["axes"]["yawDeg"]["max"] == 0.0
    flagged = {f["metric"]: f for f in d["findings"]}
    assert "n.rms" in flagged and "n.max" not in flagged, sorted(flagged)
    assert flagged["n.rms"]["about"].startswith("one of the two models (fake-sih or fake-sih)")
    c = copy.deepcopy(a)
    for s in c["attitude"]:
        if s["t"] >= t0:
            s["yaw"] = _wrap(s["yaw"] + math.radians(10.0))
    d = divergence.compare(a, c)
    assert d["verdict"] == "diverge" and abs(d["axes"]["yawDeg"]["rms"] - 10.0) < 1e-6, d["axes"]["yawDeg"]


def test_step_metrics_match_a_closed_form_response() -> None:
    tau, dt = 1.0, 0.001
    t = [k * dt for k in range(12001)]
    first_order = [1.0 - math.exp(-x / tau) for x in t]
    m = divergence.step_metrics(t, first_order, (0.0, 12.0), 0.0, 1.0, 0.0)
    assert abs(m["riseTimeS"] - tau * math.log(9.0)) < 2 * dt, m
    assert m["overshootPct"] == 0.0
    assert abs(m["settlingS"] - tau * math.log(20.0)) < 2 * dt, m
    peaked = [min(1.2, 1.2 * x / 2.0) if x < 2.0 else 1.2 - 0.2 * min(1.0, (x - 2.0)) for x in t]
    m = divergence.step_metrics(t, peaked, (0.0, 12.0), 0.0, 1.0, 0.0)
    assert abs(m["overshootPct"] - 20.0) < 1e-9, m
    never = divergence.step_metrics(t, [0.5 for _ in t], (0.0, 12.0), 0.0, 1.0, 0.0)
    assert never["riseTimeS"] is None and never["settlingS"] is None


def test_every_refusal_is_named() -> None:
    a = _reference()
    cases = {
        "different_manoeuvre": lambda b: b["manoeuvre"].update(sha256="0" * 64),
        "different_vehicle": lambda b: b["vehicle"].update(sha256="0" * 64),
        "different_controller: MPC_XY_P": lambda b: b["controller"].update(MPC_XY_P=9.0),
        "unconfirmed_vehicle: b": lambda b: b["vehicle"].update(confirmed=False),
        "b.events: no offboard-armed event": lambda b: b.update(events=[e for e in b["events"] if e["event"] != "offboard-armed"]),
        "b.complete: the run did not finish": lambda b: b.update(complete=False, error="land_timeout"),
    }
    for expected, mutate in cases.items():
        b = copy.deepcopy(a)
        mutate(b)
        d = divergence.compare(a, b)
        assert d["verdict"] == "refused" and any(r.startswith(expected) for r in d["refusals"]), (expected, d["refusals"])


def test_the_cli_writes_the_divergence_and_exits_by_verdict() -> None:
    a = _reference()
    b = copy.deepcopy(a)
    for s in b["samples"]:
        s["e"] += 1.0 if s["t"] >= a["events"][0]["t"] else 0.0
    refused = copy.deepcopy(a)
    refused["manoeuvre"]["sha256"] = "0" * 64
    with tempfile.TemporaryDirectory() as tmp:
        paths = {}
        for name, doc in (("a", a), ("b", b), ("r", refused)):
            paths[name] = os.path.join(tmp, f"{name}.json")
            with open(paths[name], "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
        out = os.path.join(tmp, "d.json")
        assert divergence.main([paths["a"], paths["a"], "--out", out]) == divergence.EXIT_AGREE
        with open(out, encoding="utf-8") as fh:
            assert json.load(fh)["verdict"] == "agree"
        assert divergence.main([paths["a"], paths["b"]]) == divergence.EXIT_DIVERGE
        assert divergence.main([paths["a"], paths["r"]]) == divergence.EXIT_REFUSED
        assert divergence.main(["--self-check", paths["a"]]) == divergence.EXIT_AGREE


if __name__ == "__main__":  # the shipped engine image has no pytest; see README "Build and test"
    import traceback

    names = sorted(name for name, value in list(globals().items()) if name.startswith("test_") and callable(value))
    if not names:
        # A runner that discovers nothing and exits 0 is a guard that does not exist.
        print("FAIL: no test_* function was discovered in this module", file=sys.stderr)
        raise SystemExit(2)
    failures = 0
    for name in names:
        try:
            globals()[name]()
        except BaseException:  # a runner reports every failure shape, assertions included
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    print(f"{len(names) - failures} passed, {failures} failed")
    raise SystemExit(1 if failures else 0)
