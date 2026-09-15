#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the INPUT half of firmware in the
#   |                                           | loop (BACKLOG B1). ngspice is driven through its shared
#   |                                           | library (libngspice.so.0) instead of the batch binary so the
#   |                                           | transient and the AVR advance together: every OUTPUT pin is
#   |                                           | an `external` source served from the sketch's own edge
#   |                                           | timeline, and at each accepted solver point the node voltages
#   |                                           | on the pins the sketch reads are latched and handed to the
#   |                                           | AVR before its next slice -- so digitalRead and analogRead
#   |                                           | see the circuit. Runs as its own process (libngspice is a
#   |                                           | process singleton and a refused deck must not take the
#   |                                           | worker down with it): JSON request on stdin, the closed-loop
#   |                                           | firmware run on stdout.
"""cosim -- lock-step co-simulation of an ATmega328P and the ngspice transient. Stdlib only."""
import bisect
import ctypes
import subprocess
import json
import os
import sys

LIB_NAME = os.environ.get("NGSPICE_SHARED_LIB", "libngspice.so.0")
DEFAULT_SYNC_SECONDS = 100e-6   # 1600 AVR cycles: shorter than any loop() a person writes, cheap enough to run
MIN_SYNC_SECONDS = 4e-6         # 64 cycles -- below this a slice cannot hold a digitalRead and its answer
MAX_SYNC_SECONDS = 10e-3        # beyond this the sampled feedback aliases anything a sketch can react to
MAX_SLICES = 400000
MAX_LOG = 4000


class CosimError(Exception):
    """@description The co-simulation could not be run or could not be trusted; `detail` says why in
    the words the surface shows, and `code` lets the worker turn it into a refusal or a warning."""

    def __init__(self, detail, code="cosim"):
        super().__init__(detail)
        self.detail, self.code = detail, code


class VecValues(ctypes.Structure):
    _fields_ = [("name", ctypes.c_char_p), ("creal", ctypes.c_double), ("cimag", ctypes.c_double),
                ("is_scale", ctypes.c_bool), ("is_complex", ctypes.c_bool)]


class VecValuesAll(ctypes.Structure):
    _fields_ = [("veccount", ctypes.c_int), ("vecindex", ctypes.c_int),
                ("vecsa", ctypes.POINTER(ctypes.POINTER(VecValues)))]


SEND_CHAR = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p)
SEND_STAT = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p)
CONTROLLED_EXIT = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_bool, ctypes.c_bool, ctypes.c_int, ctypes.c_void_p)
SEND_DATA = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(VecValuesAll), ctypes.c_int, ctypes.c_int, ctypes.c_void_p)
SEND_INIT_DATA = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p)
BG_RUNNING = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_bool, ctypes.c_int, ctypes.c_void_p)
GET_VSRC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_double), ctypes.c_double, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p)
GET_ISRC = GET_VSRC


def available():
    """@description True when libngspice (the shared library, not the batch binary) can be loaded --
    the whole input half depends on it, and an engine image without it keeps the open-loop path."""
    try:
        ctypes.CDLL(LIB_NAME)
        return True
    except OSError:
        return False


def _as_char_array(lines):
    """@description The NULL-terminated char** ngSpice_Circ wants, kept alive by the caller."""
    buf = (ctypes.c_char_p * (len(lines) + 1))()
    for i, line in enumerate(lines):
        buf[i] = line.encode("utf-8")
    buf[len(lines)] = None
    return buf


class AvrSlicer:
    """@description The ATmega328P half of the loop: a node process holding one avr8js CPU that is
    advanced one slice at a time. Kept as a process (not a fresh run per slice) so the CPU keeps its
    RAM, its timers and its program counter across the whole transient -- restarting it per slice
    would silently re-run setup() and is exactly the kind of fake this feature must not be."""

    def __init__(self, node_bin, runner, hex_path, timeout=300.0):
        self.proc = subprocess.Popen([node_bin, runner, "--serve", hex_path], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     bufsize=1, cwd=os.path.dirname(hex_path) or None)
        self.timeout = timeout
        self.closed = False

    def step(self, to_seconds, digital, analog):
        """@description Advance the CPU to `to_seconds` with these pin levels and channel voltages
        applied first; returns the slice's edges, modes, serial text and ADC read counts."""
        if self.closed:
            raise CosimError("the firmware process is gone", "engine")
        req = json.dumps({"t": to_seconds, "digital": digital, "analog": analog}, separators=(",", ":"))
        try:
            self.proc.stdin.write(req + "\n")
            self.proc.stdin.flush()
            line = self.proc.stdout.readline()
        except (BrokenPipeError, OSError) as err:
            raise CosimError(f"the firmware process stopped: {err}", "engine")
        if not line:
            self.close()
            raise CosimError("avr8js: " + (self._stderr() or "the firmware runner stopped mid-run"), "engine")
        return json.loads(line)

    def _stderr(self):
        try:
            return (self.proc.stderr.read() or "").strip()[-600:]
        except OSError:
            return ""

    def close(self):
        """@description Stop the firmware process; safe to call twice."""
        if self.closed:
            return
        self.closed = True
        for stream in (self.proc.stdin, self.proc.stdout):
            try:
                stream.close()
            except OSError:
                pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


class PinTimeline:
    """@description One OUTPUT pin's edges, in solver time, answering `level_at(t)` for the external
    source. Edges inside a slice keep their exact avr8js time, so the OUTPUT path stays edge-exact --
    only the INPUT path is sampled at the sync step."""

    def __init__(self):
        self.times, self.levels = [0.0], [0]

    def add(self, t, level):
        """@description Record an edge at t (ignored if it does not change the level)."""
        if level == self.levels[-1]:
            return
        self.times.append(max(t, self.times[-1] + 1e-12))
        self.levels.append(level)

    def level_at(self, t):
        """@description The level the pin holds at t; ngspice may ask for a time it later rejects, so
        this is a pure lookup and never advances anything."""
        return self.levels[max(0, bisect.bisect_right(self.times, t) - 1)]


class CoSimulation:
    """@description The loop itself. ngspice owns time; the AVR is kept exactly one sync step ahead of
    it. At every ACCEPTED solver point the node voltages the sketch reads are latched (a rejected step
    never reaches us, which is why the AVR is advanced from SendData and never from the source
    callback -- the AVR cannot be rewound). The solver's maximum internal step is pinned to the sync
    step, so it can never ask for a source value the AVR has not reached."""

    def __init__(self, req, slicer):
        self.req, self.slicer = req, slicer
        self.sync = float(req["syncSeconds"])
        self.stop = float(req["stopSeconds"])
        self.sources = {k.lower(): v for k, v in req["sources"].items()}
        self.feedback = {k.lower(): v for k, v in req["feedback"].items()}
        self.timelines = {v["pin"]: PinTimeline() for v in self.sources.values()}
        self.vlow, self.vhigh = req.get("logicLow", 1.5), req.get("logicHigh", 3.0)
        self.digital = {v["pin"]: 0 for v in self.feedback.values() if v["kind"] == "digital"}
        self.analog = {v["pin"]: 0.0 for v in self.feedback.values() if v["kind"] == "analog"}
        self.avr_time, self.slices, self.serial, self.modes = 0.0, 0, "", {}
        self.reads, self.samples, self.log, self.unknown = {}, [], [], set()
        self.exit_code, self.mode_changed, self.last_point = None, set(), 0.0
        self.vecnames = None   # the first accepted point proves every feedback node is really reported

    def _advance(self):
        """@description Run the AVR one slice on the latched inputs and fold its edges into the
        timelines the external sources are served from."""
        if self.slices >= MAX_SLICES:
            raise CosimError(f"the co-simulation passed {MAX_SLICES} sync steps; raise syncSeconds or shorten stopSeconds", "sim.stopSeconds")
        target = min(self.avr_time + self.sync, self.stop + self.sync)
        out = self.slicer.step(target, self.digital, self.analog)
        for name, t, level in out.get("edges", []):
            if name in self.timelines:
                self.timelines[name].add(float(t), int(level))
            elif self.modes.get(name) == "output":
                self.mode_changed.add(name)
        self.modes.update(out.get("modes", {}))
        for name, count in out.get("reads", {}).items():
            self.reads[name] = count
        self.serial = out.get("serial", self.serial)
        self.avr_time, self.slices = float(out.get("t", target)), self.slices + 1
        self.cycles = out.get("cycles", 0)

    def _latch(self, values):
        """@description Turn the solved node voltages into what the AVR's pins see: a digital pin keeps
        its level inside the AVR's own 1.5 V / 3.0 V hysteresis band, an analog pin takes the volts."""
        for node, spec in self.feedback.items():  # the AVR has not run yet at the first point: it starts on THIS latch
            if node not in values:
                continue
            v = values[node]
            if spec["kind"] == "analog":
                self.analog[spec["pin"]] = max(0.0, min(5.0, v))
            elif v >= self.vhigh:
                self.digital[spec["pin"]] = 1
            elif v <= self.vlow:
                self.digital[spec["pin"]] = 0

    def on_send_data(self, allv, count, ident, user):
        """@description ngspice accepted a point: latch what the sketch will read and keep the AVR one
        sync step ahead of the solver."""
        try:
            values, t = {}, self.last_point
            block = allv.contents
            for i in range(block.veccount):
                vec = block.vecsa[i].contents
                name = (vec.name or b"").decode("utf-8", "replace").lower()
                if name == "time":
                    t = vec.creal
                else:
                    values[name] = vec.creal
            self.last_point = t
            if self.vecnames is None:
                self.vecnames = sorted(values)
                missing = [n for n in self.feedback if n not in values]
                if missing:
                    raise CosimError("the solver did not report the node(s) the sketch reads: " + ", ".join(missing) + " (reported: " + ", ".join(self.vecnames[:12]) + ")", "engine")
            self._latch(values)
            self.samples.append([t] + [values.get(n, 0.0) for n in sorted(self.feedback)])
            while self.avr_time < t + self.sync and self.avr_time < self.stop + self.sync:
                self._advance()
        except CosimError as err:
            self.log.append(err.detail)
            return 1
        return 0

    def on_get_vsrc(self, ret, when, name, ident, user):
        """@description The value of one external source at `when`. A pure lookup into the timeline the
        AVR already produced -- ngspice asks for times it later rejects, and nothing here may move."""
        key = (name or b"").decode("utf-8", "replace").lower().lstrip("v")
        spec = self.sources.get(key) or self.sources.get("v" + key)
        if spec is None:
            self.unknown.add(key)
            ret[0] = 0.0
            return 1
        ret[0] = 5.0 * self.timelines[spec["pin"]].level_at(when)
        return 0

    def chatter(self):
        """@description Pins whose edges are locked to the sync step -- the shape a loose co-simulation
        takes when the one-step feedback delay, not the circuit, is driving the switching."""
        out = []
        for pin, tl in self.timelines.items():
            gaps = [tl.times[i + 1] - tl.times[i] for i in range(1, len(tl.times) - 1)]
            locked = [g for g in gaps if 0.5 * self.sync <= g <= 1.5 * self.sync]
            if len(gaps) >= 20 and len(locked) > 0.8 * len(gaps):
                out.append(pin)
        return out

    def result(self):
        """@description The closed-loop firmware run in the shape the open-loop runner returns, plus the
        co-simulation's own record: the sync step, the slices run, the sampled feedback and the
        diagnostics the worker turns into warnings."""
        pins = {pin: [[t, lv] for t, lv in zip(tl.times[1:], tl.levels[1:])] for pin, tl in self.timelines.items()}
        return {
            "pins": pins, "modes": self.modes, "serial": self.serial,
            "seconds": round(min(self.avr_time, self.stop), 9), "cycles": getattr(self, "cycles", 0), "reads": self.reads,
            "edges": sum(len(v) for v in pins.values()), "truncated": False,
            "coSim": {
                "syncSeconds": self.sync, "slices": self.slices, "solverPoints": len(self.samples),
                "feedback": sorted(self.feedback), "feedbackPins": sorted(set(self.digital) | set(self.analog)),
                "reads": self.reads, "chatter": self.chatter(), "startsAtFirstPoint": True,
                "modeChanged": sorted(self.mode_changed),
                "samples": self.samples[:: max(1, len(self.samples) // 2000)],
                "sampleOrder": sorted(self.feedback),
            },
        }


def _validate(req):
    """@description Refuse a step configuration the loop cannot honour, naming the field. A sync step
    that is too long aliases the sketch's own sampling; one that is too short cannot hold a read."""
    sync = float(req.get("syncSeconds") or DEFAULT_SYNC_SECONDS)
    stop = float(req["stopSeconds"])
    if not MIN_SYNC_SECONDS <= sync <= MAX_SYNC_SECONDS:
        raise CosimError(f"the co-simulation sync step must be between {MIN_SYNC_SECONDS:g} s and {MAX_SYNC_SECONDS:g} s; {sync:g} s was asked for", "sim.syncSeconds")
    if sync > stop / 4.0:
        raise CosimError(f"the co-simulation sync step ({sync:g} s) must be at most a quarter of the run ({stop:g} s)", "sim.syncSeconds")
    if not req.get("sources"):
        raise CosimError("the sketch drives no pin, so there is nothing to co-simulate", "circuit")
    if not req.get("feedback"):
        raise CosimError("no pin the sketch reads is connected to the circuit", "circuit")
    req["syncSeconds"] = sync
    return req


def _netlist(req):
    """@description The deck the shared library runs: the worker's own lines (OUTPUT pins already
    emitted as `external` sources) plus a .tran card whose MAXIMUM internal step is the sync step --
    that cap is what keeps the solver from asking for a time the AVR has not reached yet."""
    step = min(float(req.get("stepSeconds") or req["syncSeconds"]), req["syncSeconds"])
    uic = " uic" if req.get("startFromRest", True) else ""
    tran = f".tran {step:.12g} {float(req['stopSeconds']):.12g} 0 {req['syncSeconds']:.12g}{uic}"
    return list(req["netlist"]) + [tran, ".end"]


def run(req, slicer):
    """@description Drive one transient through libngspice with the AVR in the loop; returns the
    closed-loop firmware run. Raises CosimError with ngspice's own words when the deck is refused."""
    sim = CoSimulation(_validate(req), slicer)
    lib = ctypes.CDLL(LIB_NAME)
    state = {"exit": None}

    def _char(msg, ident, user):
        text = (msg or b"").decode("utf-8", "replace")
        if len(sim.log) < 200:
            sim.log.append(text)
        return 0

    def _exit(status, immediate, quit_exit, ident, user):
        state["exit"] = status
        return status

    keep = [SEND_CHAR(_char), SEND_STAT(lambda *a: 0), CONTROLLED_EXIT(_exit), SEND_DATA(sim.on_send_data),
            SEND_INIT_DATA(lambda *a: 0), BG_RUNNING(lambda *a: 0), GET_VSRC(sim.on_get_vsrc)]
    ident = ctypes.c_int(0)
    lib.ngSpice_Init(keep[0], keep[1], keep[2], keep[3], keep[4], keep[5], None)
    lib.ngSpice_Init_Sync(keep[6], None, None, ctypes.byref(ident), None)
    lines = _netlist(sim.req)
    buf = _as_char_array(lines)
    if lib.ngSpice_Circ(buf) != 0:
        raise CosimError("ngspice refused the deck: " + _tail(sim.log), "circuit")
    lib.ngSpice_Command(b"run")
    if sim.unknown:
        raise CosimError("ngspice asked for an external source this engine did not declare: " + ", ".join(sorted(sim.unknown)), "engine")
    if len(sim.samples) < 2:
        raise CosimError("the co-simulated transient produced no time points: " + _tail(sim.log), "circuit")
    return sim.result()


def _tail(log):
    """@description The last of ngspice's own words, for a refusal a person can act on."""
    text = "\n".join(l.rstrip() for l in log if l.strip())
    return text[-600:] if text else "no output"


def main():
    """@description Process entry: one JSON request on stdin, one closed-loop firmware run on stdout.
    Errors leave stdout empty and go out as JSON on stderr so the worker can name the field."""
    req = json.loads(sys.stdin.read())
    node = os.environ.get("NODE_BIN", "node")
    runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), "avr8js_run.js")
    slicer = None
    try:
        slicer = AvrSlicer(node, runner, req["hex"])
        out = run(req, slicer)
    except CosimError as err:
        sys.stderr.write(json.dumps({"error": err.detail, "code": err.code}))
        return 2
    finally:
        if slicer is not None:
            slicer.close()
    sys.stdout.write(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
