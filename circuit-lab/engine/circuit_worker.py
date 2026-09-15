#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the Circuit Lab worker:
#   |                                           | a JSON-lines process (hello | simulate | check)
#   |                                           | that turns a validated circuit into a SPICE deck
#   |                                           | (every part a real element with a zero-volt sense
#   |                                           | source so its current is measured, not derived; a
#   |                                           | brushed DC motor as R + L + back-EMF with its
#   |                                           | shaft as a rotational node -- torque = current,
#   |                                           | speed = voltage, inertia = capacitance, viscous
#   |                                           | friction = conductance, coulomb friction a
#   |                                           | behavioural source -- with the whole gear train
#   |                                           | reflected onto it), runs ngspice in batch mode on a
#   |                                           | linearised transient, reads the waveforms back by
#   |                                           | column, and computes per-part readings (currents,
#   |                                           | powers, LED brightness, battery runtime, motor rpm
#   |                                           | / torque / efficiency / stall, every driven shaft's
#   |                                           | rpm). Refusals name the field; a solver failure
#   |                                           | is a refusal carrying ngspice's own words.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | Eight more parts as real elements (a zener with
#   |                                           | its breakdown, a lamp as its rated resistance, a
#   |                                           | behavioural linear regulator, a rail-limited
#   |                                           | op-amp, a relay whose contacts follow the coil
#   |                                           | current with hysteresis, a sequenced pin as a
#   |                                           | repeating PWL source, an H-bridge driver as four
#   |                                           | switches with a dead band, a 555 as a hysteresis
#   |                                           | latch with the real thresholds), their readings
#   |                                           | (a 555's measured frequency and duty), and one
#   |                                           | automatic retry with relaxed tolerances when the
#   |                                           | solver refuses -- reported as a warning, never
#   |                                           | silently.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | A hobby servo (the pulse width sampled at each
#   |                                           | falling edge by a ramp / hold pair, a position
#   |                                           | loop driving a geared DC motor from the supply it
#   |                                           | is given), a bipolar stepper (two phases with
#   |                                           | sinusoidal torque and back-EMF against the rotor
#   |                                           | angle, detent torque, the shaft node shared with
#   |                                           | the gear train) and a step/dir driver (edges
#   |                                           | counted through a differentiated pulse, sine /
#   |                                           | cosine phase currents held by a saturating
#   |                                           | regulator from its own supply), an angle signal
#   |                                           | for every shaft driver, a load's constant torque.
# 4 | maintainer@emeraldcoastsystemsgroup.com   | Non-rigid mechanics in the same solve: every
#   |                                           | cluster of rigidly linked shaft groups is one
#   |                                           | rotational node (driven or passive); a torsion
#   |                                           | spring is a twist integrator with a stiffness and
#   |                                           | a damping torque between two nodes; a belt is a
#   |                                           | saturating viscous coupling of the two pulleys'
#   |                                           | rim speeds (it slips at the grip); a crank-slider
#   |                                           | makes its node's inertia position-dependent (the
#   |                                           | slider mass, damper, spring and friction reflected
#   |                                           | through the exact crank kinematics) and reports the
#   |                                           | slider position as a signal.
# 5 | maintainer@emeraldcoastsystemsgroup.com   | Firmware in the loop: an `arduino` part's sketch is
#   |                                           | compiled with avr-gcc and run in avr8js for the
#   |                                           | transient's length (at most 10 s); every OUTPUT pin
#   |                                           | it drives becomes a PWL source through 25 ohm, an
#   |                                           | INPUT pin a weak load (pull-ups to the 5 V rail),
#   |                                           | the 5 V pin a sensed 5 V rail; a sketch that does
#   |                                           | not compile is a refusal naming the sketch with the
#   |                                           | compiler's words; the reading carries the pins
#   |                                           | driven, the edges, the flash size and the serial
#   |                                           | text. Pins are outputs only in this version: the
#   |                                           | sketch cannot yet read the circuit back.
# 6 | maintainer@emeraldcoastsystemsgroup.com   | The INPUT half of firmware in the loop (BACKLOG B1): a pin the
#   |                                           | sketch can read whose net something else drives is recorded as
#   |                                           | feedback, the deck can emit driven pins as ngspice `external`
#   |                                           | sources, and cosimulate() steps the AVR and the transient
#   |                                           | together before the final batch deck is emitted from the
#   |                                           | closed-loop timeline. The two solves are then compared and a
#   |                                           | difference on a read node, a pin whose switching is locked to
#   |                                           | the sync step, and an image without libngspice each get their
#   |                                           | own warning rather than a quiet wrong answer.
# 7 | maintainer@emeraldcoastsystemsgroup.com   | The solver knobs (BACKLOG B7): the deck's .option line comes
#   |                                           | from circuit_parts.spice_options (the defaults unchanged, the
#   |                                           | person's reltol / gmin / method when set, the relaxed set on
#   |                                           | the retry); a refusal with knobs the person chose is theirs to
#   |                                           | change -- the automatic relaxed retry runs only at the defaults.
"""circuit_worker -- SPICE deck + ngspice run + readings (stdlib only).

Protocol (one JSON object per line, answered in order):
  request  {"id": <any>, "cmd": "hello" | "simulate" | "check", "args": {...}}
  response {"id": <same>, "ok": true, "result": {...}}
           {"id": <same>, "ok": false, "error": {"code": "refused" | "engine_error", "message": "...", "field": "..."}}
"""
import bisect
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "firmware"))
import circuit_parts as cp  # noqa: E402
import arduino_build as fw  # noqa: E402
import cosim  # noqa: E402

MAX_PWL_POINTS = 40000
COSIM_AGREE_VOLTS = 0.35  # the batch re-solve must land on the node voltages the loop fed the sketch
COSIM_AGREE_WINDOW = 3    # ... within this many output steps, since the two solves pick their own time points

PROTOCOL = 1
NGSPICE = os.environ.get("NGSPICE_BIN", "ngspice")
LED_MODELS = {"red": 1.77, "yellow": 1.96, "green": 2.05, "blue": 2.80, "white": 2.89}  # emission coefficient -> Vf at 10 mA
MODELS = [
    ".model D_STD D(IS=1e-14 N=1.05 RS=0.1)",
    ".model NPN_STD NPN(BF=150 IS=1e-14 VAF=100 RB=10 RC=0.3 RE=0.1 CJC=8p CJE=25p TF=400p)",
    ".model NMOS_STD NMOS(LEVEL=1 VTO=2 KP=2 LAMBDA=0.01)",
    ".model SW_STD SW(RON=1m ROFF=1G VT=0.5 VH=0.1)",
] + [f".model LED_{c.upper()} D(IS=1e-20 N={n} RS=1)" for c, n in LED_MODELS.items()]
MAX_LOG = 4000


def fmt(x):
    """SPICE number: plain, finite, enough digits."""
    return f"{float(x):.9g}"


def _ngspice_version():
    try:
        out = subprocess.run([NGSPICE, "-v"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"ngspice-(\d+(?:\.\d+)*)", out)
    return m.group(1) if m else (out.strip().splitlines()[0] if out.strip() else None)


def hello():
    return {"protocol": PROTOCOL, "engine": "ngspice", "ngspice": _ngspice_version(), "partTypes": list(cp.PART_TYPES), "python": sys.version.split()[0], "firmware": fw.available()}


class Deck:
    """The SPICE deck under construction and the vectors it will report."""

    def __init__(self, parts, wires, sim, firmware=None, external=False):
        self.parts, self.wires, self.sim = parts, wires, sim
        self.firmware_in = firmware or {}   # a closed-loop run to emit instead of running the sketch open-loop
        self.external = external            # emit driven pins as ngspice `external` sources (the co-simulation pass)
        self.externals, self.feedback = {}, {}
        self.net_of_pin, self.nets, self.warnings = cp.resolve_nets(parts, wires)
        self.mech = cp.solve_mechanism(parts, wires)
        self.warnings += self.mech["warnings"]
        self.lines = []
        self.vectors = []   # (spice vector name, public signal name, scale)
        self.by_id = {p["id"]: p for p in parts}
        self.firmware = {}  # arduino id -> the avr8js run

    def net(self, pid, pin):
        return self.net_of_pin[(pid, pin)]

    @staticmethod
    def vd(a, b):
        """A node-difference expression for a behavioural source (node 0 spelled the way ngspice wants)."""
        if a == "0" and b == "0":
            return "0"
        if b == "0":
            return f"V({a})"
        if a == "0":
            return f"(-V({b}))"
        return f"V({a},{b})"

    def sense(self, p, pin):
        s = p["id"].lower()
        self.lines.append(f"V{s}_i {self.net(p['id'], pin)} x{s} DC 0")
        self.vectors.append((f"i(v{s}_i)", f"i({p['id']})", 1.0))
        return f"x{s}"

    def emit_part(self, p):
        t, s, pr = p["type"], p["id"].lower(), p["props"]
        n = lambda pin: self.net(p["id"], pin)  # noqa: E731
        if t in ("ground", "junction"):
            return
        if t == "battery":
            if pr["internalOhms"] > 0:
                self.lines += [f"V{s} {n('+')} b{s} DC {fmt(pr['volts'])}", f"R{s}_r b{s} {n('-')} {fmt(pr['internalOhms'])}"]
            else:
                self.lines.append(f"V{s} {n('+')} {n('-')} DC {fmt(pr['volts'])}")
            self.vectors.append((f"i(v{s})", f"i({p['id']})", -1.0))
        elif t == "source":
            self.lines.append(f"V{s} {n('+')} {n('-')} {self.source_spec(pr)}")
            self.vectors.append((f"i(v{s})", f"i({p['id']})", -1.0))
        elif t == "resistor":
            self.lines.append(f"R{s} {self.sense(p, 'a')} {n('b')} {fmt(pr['ohms'])}")
        elif t == "potentiometer":
            x = self.sense(p, "a")
            self.lines += [f"R{s}_a {x} {n('w')} {fmt(max(pr['ohms'] * pr['position'], 1e-3))}", f"R{s}_b {n('w')} {n('b')} {fmt(max(pr['ohms'] * (1 - pr['position']), 1e-3))}"]
        elif t == "capacitor":
            self.lines.append(f"C{s} {self.sense(p, 'a')} {n('b')} {fmt(pr['farads'])}")
        elif t == "inductor":
            self.lines.append(f"L{s} {self.sense(p, 'a')} {n('b')} {fmt(pr['henries'])}")
        elif t == "diode":
            self.lines.append(f"D{s} {self.sense(p, 'a')} {n('k')} D_STD")
        elif t == "led":
            self.lines.append(f"D{s} {self.sense(p, 'a')} {n('k')} LED_{pr['color'].upper()}")
        elif t == "switch":
            x = self.sense(p, "a")
            if pr["toggleAtSeconds"] is None:
                self.lines.append(f"R{s} {x} {n('b')} {fmt(1e-3 if pr['closed'] else 1e9)}")
            else:
                v0, v1 = (1, 0) if pr["closed"] else (0, 1)
                self.lines += [f"S{s} {x} {n('b')} c{s} 0 SW_STD", f"V{s}_c c{s} 0 PULSE({v0} {v1} {fmt(pr['toggleAtSeconds'])} 1u 1u 1e6 2e6)"]
        elif t == "npn":
            self.lines.append(f"Q{s} {self.sense(p, 'c')} {n('b')} {n('e')} NPN_STD")
        elif t == "nmos":
            self.lines.append(f"M{s} {self.sense(p, 'd')} {n('g')} {n('s')} {n('s')} NMOS_STD")
        elif t == "motor":
            self.emit_motor(p)
        elif t == "zener":
            self.lines += [f"D{s} {self.sense(p, 'a')} {n('k')} DZ_{s}", f".model DZ_{s} D(IS=1e-14 N=1.05 RS=0.5 BV={fmt(pr['breakdownVolts'])} IBV=1e-3)"]
        elif t == "lamp":
            self.lines.append(f"R{s} {self.sense(p, 'a')} {n('b')} {fmt(pr['ratedVolts'] ** 2 / pr['ratedWatts'])}")
        elif t == "regulator":
            g = n("gnd")
            self.lines += [f"B{s} bo{s} {g} V=max(0,min({self.vd(n('in'), g)}-{fmt(pr['dropoutVolts'])},{fmt(pr['outputVolts'])}))",
                           f"V{s}_i bo{s} {n('out')} DC 0", f"I{s}_q {n('in')} {g} DC 0.005"]
            self.vectors.append((f"i(v{s}_i)", f"i({p['id']})", 1.0))
        elif t == "opamp":
            d = fmt(pr["railDropVolts"])
            # rail-limited gain, a dominant pole (1 kohm / 100 nF: 1.6 kHz open loop, ~0.1 V/us into the rail), a unity buffer, 50 ohm out
            self.lines += [f"B{s} bo{s} 0 V=max({self.vd(n('vee'), '0')}+{d},min({self.vd(n('vcc'), '0')}-{d},{fmt(pr['gain'])}*({self.vd(n('+'), '0')}-{self.vd(n('-'), '0')})))",
                           f"R{s}_p bo{s} po{s} 1k", f"C{s}_p po{s} 0 100n", f"E{s} bx{s} 0 po{s} 0 1",
                           f"R{s}_o bx{s} by{s} 50", f"V{s}_i by{s} {n('out')} DC 0"]
            self.vectors.append((f"i(v{s}_i)", f"i({p['id']})", 1.0))
        elif t == "relay":
            self.emit_relay(p)
        elif t == "sequencer":
            self.emit_sequencer(p)
        elif t == "hbridge":
            self.emit_hbridge(p)
        elif t == "timer555":
            self.emit_555(p)
        elif t == "servo":
            self.emit_servo(p)
        elif t == "stepper":
            self.emit_stepper(p)
        elif t == "stepdriver":
            self.emit_stepdriver(p)
        elif t == "arduino":
            self.emit_arduino(p)

    def emit_arduino(self, p):
        """The Uno: its sketch run in avr8js for the transient (at most 10 s), every OUTPUT pin a PWL source
        through 25 ohm, INPUT pins weak loads, the 5 V pin a sensed 5 V rail against its GND pin."""
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        g, index = n("GND"), self.parts.index(p)
        if not fw.available():
            raise cp.Refusal("this engine image has no AVR toolchain or node; rebuild the engine container (install-engine.sh)", "engine")
        run = self.firmware_in.get(p["id"])
        if run is None:
            try:
                run = fw.run_firmware(pr["sketch"], self.sim["stopSeconds"])
            except fw.BuildError as err:
                raise cp.Refusal(f"{p['id']}: the sketch did not compile: {err.detail}", f"parts[{index}].props.sketch")
        self.firmware[p["id"]] = run
        if self.sim["stopSeconds"] > run["seconds"] + 1e-9:
            self.warnings.append({"code": "firmware_truncated", "part": p["id"], "message": f"{p['id']}: the sketch ran for the first {run['seconds']:g} s; its pins hold their last state after that"})
        if run.get("truncated"):
            self.warnings.append({"code": "firmware_edges", "part": p["id"], "message": f"{p['id']}: a pin toggles too often for the deck; the run stopped at {run['seconds']:g} s"})
        if next(len(net["pins"]) for net in self.nets if net["name"] == g) == 1:
            self.warnings.append({"code": "board_floating", "part": p["id"], "message": f"{p['id']}.GND is not connected: the board and every pin it drives float"})
        self.lines += [f"V{s}_i {n('5V')} x{s} DC 0", f"V{s}_5v x{s} {g} DC 5"]
        self.vectors.append((f"i(v{s}_i)", f"i({p['id']})", -1.0))
        pins = {pin["name"] for pin in cp.PART_LIBRARY["arduino"]["pins"]}
        for name, mode in sorted(run["modes"].items()):
            if name not in pins:
                continue
            pin = name.lower()
            if mode == "output" and self.external:
                # the co-simulation pass: the level is served per solver call from the AVR's own timeline
                self.externals[f"v{s}_{pin}"] = {"part": p["id"], "pin": name}
                self.lines += [f"V{s}_{pin} d{s}{pin} {g} external", f"R{s}_{pin} d{s}{pin} {n(name)} 25"]
            elif mode == "output":
                events = run["pins"].get(name, [])
                if 2 * len(events) + 1 > MAX_PWL_POINTS:
                    raise cp.Refusal(f"{p['id']}.{name} toggles {len(events)} times in the run; shorten stopSeconds or slow the sketch", f"parts[{index}].props.sketch")
                pts, level = [(0.0, 0.0)], 0.0
                for t, v in events:
                    if t > pts[-1][0] + 1e-7:
                        pts.append((t - 5e-8, level))
                    pts.append((max(t, pts[-1][0] + 1e-9), 5.0 * v))
                    level = 5.0 * v
                pts.append((max(self.sim["stopSeconds"], pts[-1][0]) + 1e-6, level))  # a pin held at one level is still a two-point source
                # 12 digits keep edges 50 ns apart distinct at 10 s; 32 points per SPICE continuation line
                chunks = [" ".join(f"{t:.12g} {fmt(v)}" for t, v in pts[k:k + 32]) for k in range(0, len(pts), 32)]
                self.lines += [f"V{s}_{pin} d{s}{pin} {g} PWL(" + "\n+ ".join(chunks) + ")", f"R{s}_{pin} d{s}{pin} {n(name)} 25"]
            elif mode == "input_pullup":
                self.lines.append(f"R{s}_{pin} {n(name)} x{s} 35k")
                self.note_feedback(p, name, run)
            else:
                self.lines.append(f"R{s}_{pin} {n(name)} {g} 10meg")
                self.note_feedback(p, name, run)

    def note_feedback(self, p, name, run):
        """@description Record a pin the sketch can READ whose net something else drives -- the nodes the
        co-simulation latches and hands back to the AVR. A pin alone on its net is not feedback: nothing
        in the circuit moves it, and saying otherwise would be the fake this feature must not be."""
        node = self.net(p["id"], name)
        if node == "0" or sum(len(net["pins"]) for net in self.nets if net["name"] == node) < 2:
            return
        kind = "analog" if run.get("reads", {}).get(name) else "digital"
        self.feedback[node] = {"part": p["id"], "pin": name, "kind": kind}

    def cluster_of(self, pid):
        return self.mech["clusters"][self.mech["motors"][pid]["cluster"]]

    def tq(self, cluster):
        """The node a torque is injected into: the shaft node itself, or the torque-sum node of a crank cluster."""
        return "tq" + cluster["node"][2:] if cluster.get("crank") else cluster["node"]

    def emit_clusters(self):
        """One rotational node per cluster: inertia, viscous and coulomb friction, a constant load torque,
        the angle integrator (rad) and the rpm / angle signals; a crank cluster in its explicit form."""
        for cl in self.mech["clusters"]:
            node, r = cl["node"], cl["reflected"]
            n = node[2:]
            self.lines += [f"C{n}_th th{n} 0 1", f"B{n}_th 0 th{n} I=V({node})", f"R{n}_th th{n} 0 1e12"]
            if cl.get("crank"):
                self.emit_crank_cluster(cl)
            else:
                self.lines += [f"C{n}_j {node} 0 {fmt(max(r['inertia'], 1e-12))}", f"R{n}_b {node} 0 {fmt(1 / max(r['viscous'], 1e-9))}"]
            tq = self.tq(cl)
            if r["friction"] > 0:
                self.lines.append(f"B{n}_t {tq} 0 I={fmt(r['friction'])}*tanh(V({node})/0.5)")
            if r.get("torque"):
                self.lines.append(f"I{n}_w {tq} 0 DC {fmt(r['torque'])}")
            self.vectors.append((f"v({node})", cl["base"], 1 / cp.RPM_TO_RADS))
            self.vectors.append((f"v(th{n})", cl["angleSignal"], 180 / math.pi))
        for link in self.mech["links"]:
            if link["kind"] == "spring":
                self.emit_spring(link)
            else:
                self.emit_belt(link)

    def emit_crank_cluster(self, cl):
        """The crank-slider: x = r cos(th) + sqrt(l^2 - r^2 sin^2 th) is the slider position; the slider's
        mass, damper, spring and friction act on the crank through dx/dth, so the node's equation is
        (J_eq + m x'^2) w' = sum of torques - m x' x'' w^2 - c x'^2 w - k (x - x0) x' - mu tanh(x' w) x'.
        The shaft node integrates that with a unit capacitor; every torque is summed on tq<n> (1 ohm)."""
        node, r, crank = cl["node"], cl["reflected"], self.by_id[cl["crank"]]
        n, pr, rg = node[2:], crank["props"], cl.get("crankRatio", 1.0)
        rc, l, m, c, k = pr["radiusMm"] * 1e-3, pr["rodMm"] * 1e-3, pr["sliderMassG"] * 1e-3, pr["dampingNsPerM"], pr["springNPerM"]
        x0, mu = pr["springRestMm"] * 1e-3, pr["frictionN"]
        th = f"({fmt(rg)}*V(th{n}))"
        S = f"sqrt({fmt(l * l)}-{fmt(rc * rc)}*sin({th})^2)"
        G = f"({fmt(rc)}*cos({th})+{S})"
        GP = f"(-{fmt(rc)}*sin({th})-{fmt(rc * rc)}*sin({th})*cos({th})/{S})"
        GPP = f"(-{fmt(rc)}*cos({th})-{fmt(rc * rc)}*(cos({th})^2-sin({th})^2)/{S}-{fmt(rc ** 4)}*sin({th})^2*cos({th})^2/{S}^3)"
        w = f"({fmt(rg)}*V({node}))"
        slider = f"({fmt(m)}*{GP}*{GPP}*{w}^2+{fmt(c)}*{GP}^2*{w}+{fmt(k)}*({G}-{fmt(x0)})*{GP}+{fmt(mu)}*tanh({GP}*{w}/0.01)*{GP})"
        self.lines += [
            f"C{n}_j {node} 0 1", f"R{n}_tq tq{n} 0 1", f"R{n}_x xs{n} 0 1e12", f"B{n}_x xs{n} 0 V={G}",
            f"B{n}_acc 0 {node} I=(V(tq{n})-{fmt(rg)}*{slider}-{fmt(r['viscous'])}*V({node}))/({fmt(max(r['inertia'], 1e-12))}+{fmt(m * rg * rg)}*{GP}^2)",
        ]
        self.vectors.append((f"v(xs{n})", f"x({crank['id']})", 1000.0))

    def emit_spring(self, link):
        s, a, b = link["part"].lower(), link["a"], link["b"]
        ca, cb = self.mech["clusters"][a["cluster"]], self.mech["clusters"][b["cluster"]]
        rate = f"({fmt(a['ratio'])}*V({ca['node']})-{fmt(b['ratio'])}*V({cb['node']}))"
        self.lines += [
            f"C{s}_tw tw{s} 0 1", f"R{s}_tw tw{s} 0 1e12", f"B{s}_tw 0 tw{s} I={rate}",
            f"B{s}_tq tqs{s} 0 V={fmt(link['stiffness'])}*V(tw{s})+{fmt(link['damping'])}*{rate}", f"R{s}_tqs tqs{s} 0 1e12",
            f"B{s}_a {self.tq(ca)} 0 I={fmt(a['ratio'])}*V(tqs{s})", f"B{s}_b 0 {self.tq(cb)} I={fmt(b['ratio'])}*V(tqs{s})",
        ]
        self.vectors.append((f"v(tw{s})", f"twist({link['part']})", 180 / math.pi))
        self.vectors.append((f"v(tqs{s})", f"torque({link['part']})", 1000.0))

    def emit_belt(self, link):
        s, a, b = link["wire"].lower(), link["a"], link["b"]
        ca, cb = self.mech["clusters"][a["cluster"]], self.mech["clusters"][b["cluster"]]
        grip = link["grip"]
        slip = f"({fmt(a['ratio'] * a['radius'])}*V({ca['node']})-{fmt(b['ratio'] * b['radius'])}*V({cb['node']}))"
        self.lines += [
            f"B{s}_sl sl{s} 0 V={slip}", f"R{s}_sl sl{s} 0 1e12",
            f"B{s}_f bf{s} 0 V={fmt(grip)}*tanh({fmt(20 * grip)}*V(sl{s})/{fmt(grip)})", f"R{s}_bf bf{s} 0 1e12",
            f"B{s}_a {self.tq(ca)} 0 I={fmt(a['ratio'] * a['radius'])}*V(bf{s})", f"B{s}_b 0 {self.tq(cb)} I={fmt(b['ratio'] * b['radius'])}*V(bf{s})",
        ]
        self.vectors.append((f"v(sl{s})", f"slip({link['wire']})", 1.0))
        self.vectors.append((f"v(bf{s})", f"force({link['wire']})", 1.0))

    def emit_servo(self, p):
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        m = self.mech["motors"][p["id"]]
        k, g = m["constants"], n("gnd")
        sup = self.vd(n("v+"), g)
        lo, span = pr["minPulseMs"], max(pr["maxPulseMs"] - pr["minPulseMs"], 0.01)
        x = self.sense(p, "v+")  # supply current = i(<id>)
        self.lines += [
            # the pulse decoder: a ramp of 1 V per ms while the signal is high, sampled (through a unity buffer, so no
            # charge is shared) into a hold in the ~70 us after each falling edge (a delayed copy of "high" opens
            # the window), then reset
            f"B{s}_hi hi{s} 0 V=0.5+0.5*tanh(4*({self.vd(n('sig'), g)}-1.5))", f"R{s}_sig {n('sig')} {g} 100k",
            f"B{s}_rc 0 rp{s} I=1e-3*V(hi{s})", f"C{s}_rp rp{s} 0 1u",
            f"R{s}_lo hi{s} lo{s} 1k", f"C{s}_lo lo{s} 0 100n",
            f"B{s}_sw sw{s} 0 V=(1-V(hi{s}))*V(lo{s})", f"E{s}_bf bf{s} 0 rp{s} 0 1", f"S{s}_s bf{s} hd{s} sw{s} 0 SWS_{s}", f".model SWS_{s} SW(VT=0.5 VH=0.05 RON=1 ROFF=1e9)", f"C{s}_hd hd{s} 0 1u",
            f"B{s}_rs rs{s} 0 V=(1-V(hi{s}))*(1-V(lo{s}))", f"S{s}_r rp{s} 0 rs{s} 0 SWR_{s}", f".model SWR_{s} SW(VT=0.9 VH=0.05 RON=100 ROFF=1e9)",
            # width (V = ms) -> target angle (deg), smoothed over 2 ms; the loop works in radians
            f"B{s}_tg tg{s} 0 V={fmt(pr['travelDeg'])}*max(0,min(1,(V(hd{s})-{fmt(lo)})/{fmt(span)}))", f"R{s}_tg tg{s} tf{s} 1k", f"C{s}_tg tf{s} 0 2u",
            # the position loop: full drive at 10 degrees of error, limited to the supply it is given
            f"B{s}_dr dr{s} 0 V={sup}*tanh((V(tf{s})*{fmt(math.pi / 180)}-V(th{s}))/0.1745)",
            f"V{s}_m dr{s} xm{s} DC 0", f"R{s} xm{s} a{s} {fmt(k['ohms'])}", f"L{s} a{s} b{s} {fmt(k['henries'])}", f"E{s} b{s} 0 sh{s} 0 {fmt(k['ke'])}",
            f"F{s} 0 {self.tq(self.cluster_of(p['id']))} V{s}_m {fmt(k['kt'])}",
            f"B{s}_sup {x} {g} I=abs(I(V{s}_m))+{fmt(pr['idleAmps'])}",
        ]
        self.vectors.append((f"v(hd{s})", f"pulse({p['id']})", 1.0))
        self.vectors.append((f"v(tf{s})", f"target({p['id']})", 1.0))
        self.vectors.append((f"i(v{s}_m)", f"i({p['id']}:motor)", 1.0))

    def emit_stepper(self, p):
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        m = self.mech["motors"][p["id"]]
        k = m["constants"]
        km, npp = fmt(k["km"]), fmt(k["polePairs"])
        for ph, sign, fn in (("a", "-", "sin"), ("b", "", "cos")):
            self.lines += [f"V{s}_i{ph} {n(ph + '+')} x{ph}{s} DC 0", f"R{s}_w{ph} x{ph}{s} y{ph}{s} {fmt(k['ohms'])}", f"L{s}_w{ph} y{ph}{s} z{ph}{s} {fmt(k['henries'])}",
                           f"B{s}_e{ph} z{ph}{s} {n(ph + '-')} V={sign}{km}*{fn}({npp}*V(th{s}))*V(sh{s})"]
        tq = self.tq(self.cluster_of(p["id"]))
        self.lines.append(f"B{s}_tq 0 {tq} I={km}*(-I(V{s}_ia)*sin({npp}*V(th{s}))+I(V{s}_ib)*cos({npp}*V(th{s})))")
        if k["detent"] > 0:
            self.lines.append(f"B{s}_dt {tq} 0 I={fmt(k['detent'])}*sin(4*{npp}*V(th{s}))")
        # the damping real steppers show (iron, bearings, the driver): a viscous term for the damping
        # ratio at rated current, capped at 10 % of the holding torque so it never dominates at speed
        cap = 0.1 * pr["holdingTorqueMnm"] * 1e-3
        self.lines.append(f"B{s}_dm {tq} 0 I={fmt(cap)}*tanh({fmt(k['damping'])}*V(sh{s})/{fmt(cap)})")
        self.vectors.append((f"i(v{s}_ia)", f"i({p['id']})", 1.0))
        self.vectors.append((f"i(v{s}_ib)", f"i({p['id']}:b)", 1.0))

    def emit_stepdriver(self, p):
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        g, thr, amps = n("gnd"), fmt(pr["thresholdVolts"]), fmt(pr["currentAmps"])
        vm = self.vd(n("vm"), g)
        step_e = fmt(math.pi / 2 / int(pr["microsteps"]))  # electrical radians per step pulse
        x = self.sense(p, "vm")  # supply current = i(<id>)
        self.lines += [
            # step pulses: a 1 uF packet charges through 5 ohm while the pin is high and empties while it is
            # low; only the charging current is integrated, so every rising edge adds exactly one step
            # (its direction from the dir pin) once the pulse and the gap each last 25 us or more
            f"B{s}_st st{s} 0 V=0.5+0.5*tanh(4*({self.vd(n('step'), g)}-{thr}))", f"R{s}_pk st{s} pk{s} 5", f"C{s}_pk pk{s} 0 1u",
            f"B{s}_ph 0 ph{s} I=max(0,V(st{s},pk{s}))*{fmt(1e6 / 5)}*{step_e}*tanh(4*({self.vd(n('dir'), g)}-{thr}))", f"C{s}_ph ph{s} 0 1", f"R{s}_ph ph{s} 0 1e12",
            f"R{s}_stp {n('step')} {g} 100k", f"R{s}_dir {n('dir')} {g} 100k",
        ]
        for ph, fn in (("a", "cos"), ("b", "sin")):
            # a saturating current regulator (100 V/A) across each phase, both outputs referenced to gnd
            va = f"({vm})*tanh(100*({amps}*{fn}(V(ph{s}))-I(V{s}_i{ph}))/max({vm},0.1))"
            self.lines += [f"B{s}_v{ph} d{ph}{s} {g} V=0.5*({vm})+0.5*{va}", f"V{s}_i{ph} d{ph}{s} {n(ph + '+')} DC 0", f"B{s}_n{ph} {n(ph + '-')} {g} V=0.5*({vm})-0.5*{va}"]
        self.lines.append(f"B{s}_sup {x} {g} I=(abs(I(V{s}_ia)*({vm})*tanh(100*({amps}*cos(V(ph{s}))-I(V{s}_ia))/max({vm},0.1)))+abs(I(V{s}_ib)*({vm})*tanh(100*({amps}*sin(V(ph{s}))-I(V{s}_ib))/max({vm},0.1))))/max({vm},0.1)")
        self.vectors.append((f"v(ph{s})", f"steps({p['id']})", 1 / (math.pi / 2 / int(pr["microsteps"]))))
        self.vectors.append((f"i(v{s}_ia)", f"i({p['id']}:a)", 1.0))
        self.vectors.append((f"i(v{s}_ib)", f"i({p['id']}:b)", 1.0))

    def emit_relay(self, p):
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        pi, h = pr["pullInAmps"], 0.2 * pr["pullInAmps"]
        x = self.sense(p, "c+")  # coil current = i(V<s>_i)
        self.lines += [
            f"R{s} {x} a{s} {fmt(pr['coilOhms'])}", f"L{s} a{s} {n('c-')} {fmt(pr['coilMh'] * 1e-3)}",
            f"B{s}_c cc{s} 0 V=I(V{s}_i)", f"B{s}_n cn{s} 0 V=-I(V{s}_i)",
            f"V{s}_c {n('com')} cm{s} DC 0",
            f"S{s}_no cm{s} {n('no')} cc{s} 0 SWR_{s}", f"S{s}_nc cm{s} {n('nc')} cn{s} 0 SWRN_{s}",
            f".model SWR_{s} SW(VT={fmt(pi - h)} VH={fmt(h)} RON=0.05 ROFF=1e9)",
            f".model SWRN_{s} SW(VT={fmt(-pi + h)} VH={fmt(h)} RON=0.05 ROFF=1e9)",
        ]
        self.vectors.append((f"i(v{s}_c)", f"i({p['id']}:com)", 1.0))

    def emit_sequencer(self, p):
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        steps, hv = cp.parse_sequence(pr["pattern"]), pr["highVolts"]
        pts, t0 = [], 0.0
        for level, sec in steps:
            edge = min(1e-6, sec / 10)
            pts += [(t0, level * hv), (t0 + sec - edge, level * hv)]
            t0 += sec
        if pr["repeat"]:
            pts.append((t0, steps[0][0] * hv))
        spec = "PWL(" + " ".join(f"{fmt(t)} {fmt(v)}" for t, v in pts) + ")" + (" r=0" if pr["repeat"] else "")
        self.lines.append(f"V{s} {n('out')} {n('ref')} {spec}")
        self.vectors.append((f"i(v{s})", f"i({p['id']})", -1.0))

    def emit_hbridge(self, p):
        s, pr, n = p["id"].lower(), p["props"], (lambda pin: self.net(p["id"], pin))
        vcc, g, thr = n("vcc"), n("gnd"), pr["thresholdVolts"]
        self.lines.append(f".model SWH_{s} SW(VT={fmt(thr)} VH=0.1 RON={fmt(pr['onOhms'])} ROFF=1e9)")
        for k, (pin_in, pin_out) in enumerate((("in1", "out1"), ("in2", "out2")), start=1):
            self.lines += [
                f"B{s}_h{k} h{k}{s} 0 V={self.vd(n(pin_in), g)}", f"B{s}_l{k} l{k}{s} 0 V={fmt(2 * thr)}-({self.vd(n(pin_in), g)})",
                f"S{s}_t{k} {vcc} xo{k}{s} h{k}{s} 0 SWH_{s}", f"S{s}_b{k} xo{k}{s} {g} l{k}{s} 0 SWH_{s}",
                f"V{s}_i{k} xo{k}{s} {n(pin_out)} DC 0",
            ]
            self.vectors.append((f"i(v{s}_i{k})", f"i({p['id']}{'' if k == 1 else ':out2'})", 1.0))

    def emit_555(self, p):
        s, n = p["id"].lower(), (lambda pin: self.net(p["id"], pin))
        vcc, g = n("vcc"), n("gnd")
        V = lambda a: self.vd(a, g)  # noqa: E731
        self.lines += [
            # the SR latch as a hysteresis switch driven by two SMOOTH comparators (a hard step in a behavioural
            # source stalls the solver): +1 when the threshold passes 2/3 Vcc resets, -1 when the trigger drops
            # under 1/3 Vcc sets, ~0 in between holds
            f"B{s}_c ct{s} 0 V=tanh(40*({V(n('thr'))}-2*{V(vcc)}/3))-tanh(40*({V(vcc)}/3-{V(n('trig'))}))",
            f".model SWL_{s} SW(VT=0 VH=0.5 RON=1 ROFF=1e9)",
            f"R{s}_q {vcc} qn{s} 1k", f"S{s}_l qn{s} {g} ct{s} 0 SWL_{s}",
            f"B{s}_o bo{s} {g} V=0.1+(max(0,{V(vcc)}-1.6))*(0.5+0.5*tanh(4*({V('qn' + s)}-{V(vcc)}/2)))",
            f"R{s}_o bo{s} bx{s} 10", f"V{s}_i bx{s} {n('out')} DC 0",
            f"B{s}_d dn{s} 0 V={V(vcc)}-{V('qn' + s)}", f".model SWD_{s} SW(VT=1 VH=0.5 RON=10 ROFF=1e9)",
            f"S{s}_d {n('dis')} {g} dn{s} 0 SWD_{s}",
            f"I{s}_q {vcc} {g} DC 0.003",
        ]
        self.vectors.append((f"i(v{s}_i)", f"i({p['id']})", 1.0))

    def source_spec(self, pr):
        if pr["kind"] == "dc":
            return f"DC {fmt(pr['volts'] + pr['offsetVolts'])}"
        if pr["kind"] == "sine":
            return f"SIN({fmt(pr['offsetVolts'])} {fmt(pr['volts'])} {fmt(pr['frequencyHz'])})"
        per = 1 / pr["frequencyHz"]
        edge = max(per / 1000, 1e-9)  # the high time at 50 % is exactly duty * period
        return f"PULSE({fmt(pr['offsetVolts'])} {fmt(pr['offsetVolts'] + pr['volts'])} 0 {fmt(edge)} {fmt(edge)} {fmt(max(per * pr['dutyPercent'] / 100 - edge, 0))} {fmt(per)})"

    def emit_motor(self, p):
        s, m = p["id"].lower(), self.mech["motors"][p["id"]]
        k = m["constants"]
        x = self.sense(p, "+")
        self.lines += [
            f"R{s} {x} a{s} {fmt(k['ohms'])}",
            f"L{s} a{s} b{s} {fmt(k['henries'])}",
            f"E{s} b{s} {self.net(p['id'], '-')} sh{s} 0 {fmt(k['ke'])}",
            f"F{s} 0 {self.tq(self.cluster_of(p['id']))} V{s}_i {fmt(k['kt'])}",
        ]

    def build(self):
        """@description Emit every element; returns the deck WITHOUT the control block (what the api stores)."""
        for net in self.nets:
            if net["name"] != "0":
                self.vectors.append((f"v({net['name']})", f"v({net['name']})", 1.0))
        self.emit_clusters()
        for p in self.parts:
            self.emit_part(p)
        self.relaxed = False
        self.head = ["* circuit-lab deck"] + MODELS
        return "\n".join(self.head[:1] + [cp.spice_options(self.sim)] + self.head[1:] + self.lines + [".end"]) + "\n"

    def run_deck(self, out_file):
        """@description The deck with the batch control block that writes the vectors to `out_file`
        (relaxed tolerances on the retry)."""
        st = self.sim
        # `uic` = power applied at t = 0 to a circuit at rest (capacitors empty, motors still) --
        # what a maker means by "switch it on"; without it ngspice starts from the DC steady state.
        uic = " uic" if st.get("startFromRest", True) else ""
        control = [".control", "set wr_singlescale", "set wr_vecnames", f"tran {fmt(st['stepSeconds'])} {fmt(st['stopSeconds'])} 0 {fmt(st['stepSeconds'])}{uic}", "linearize",
                   f"wrdata {out_file} " + " ".join(v[0] for v in self.vectors), "quit", ".endc", ".end"]
        return "\n".join(self.head[:1] + [cp.spice_options(self.sim, self.relaxed)] + self.head[1:] + self.lines + control) + "\n"


def parse_wrdata(path, expected):
    """@description Columns by position: time, then the requested vectors in order."""
    time_col, cols = [], [[] for _ in expected]
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            toks = line.split()
            if not toks:
                continue
            try:
                vals = [float(t) for t in toks]
            except ValueError:
                continue  # the header line
            if len(vals) != len(expected) + 1:
                raise cp.Refusal(f"ngspice wrote {len(vals) - 1} columns, {len(expected)} expected")
            time_col.append(vals[0])
            for i, v in enumerate(vals[1:]):
                cols[i].append(v)
    return time_col, cols


def run_ngspice(deck, timeout):
    """@description Run the deck in batch mode in a scratch dir; return (time, columns, log tail).
    The scratch dir is removed on every path."""
    if shutil.which(NGSPICE) is None:
        raise RuntimeError(f"{NGSPICE} is not installed in the engine container")
    work = tempfile.mkdtemp(prefix="circuit-lab-")
    try:
        out_file = os.path.join(work, "out.txt")
        with open(os.path.join(work, "deck.cir"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(deck.run_deck(out_file))
        log = os.path.join(work, "log.txt")
        try:
            subprocess.run([NGSPICE, "-b", "-o", log, os.path.join(work, "deck.cir")], cwd=work, capture_output=True, text=True, timeout=timeout,
                           env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": work})
        except subprocess.TimeoutExpired:
            raise cp.Refusal(f"ngspice did not finish within {timeout} s; shorten stopSeconds or raise stepSeconds", "sim.stopSeconds")
        tail = ""
        if os.path.exists(log):
            with open(log, "r", encoding="utf-8", errors="replace") as fh:
                tail = fh.read()[-MAX_LOG:]
        if not os.path.exists(out_file) or os.path.getsize(out_file) == 0:
            errors = [l.strip() for l in tail.splitlines() if re.search(r"error|singular|timestep too small|no such vector|doAnalyses", l, re.I)]
            raise cp.Refusal("ngspice could not solve this circuit: " + ("; ".join(errors[-4:]) if errors else "no output produced"), "circuit")
        time_col, cols = parse_wrdata(out_file, deck.vectors)
        return time_col, cols, tail
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cosimulate(deck):
    """@description BACKLOG B1's input half. Builds the same circuit with every driven pin as an ngspice
    `external` source, steps the AVR and the transient together through libngspice, and returns the
    closed-loop firmware run the final batch deck is emitted from. One board at a time: a second AVR
    would need a second slicer, and pretending otherwise would give a sketch readings nothing produced."""
    boards = [p for p in deck.parts if p["type"] == "arduino"]
    if len(boards) > 1:
        raise cp.Refusal(f"the firmware co-simulation runs one board at a time; this circuit has {len(boards)}", "circuit")
    ext = Deck(deck.parts, deck.wires, deck.sim, external=True)
    ext.build()
    sync = deck.sim.get("syncSeconds") or min(cosim.DEFAULT_SYNC_SECONDS, deck.sim["stopSeconds"] / 8.0)
    req = {"netlist": ext.head[:1] + [cp.spice_options(deck.sim)] + ext.head[1:] + ext.lines, "sources": ext.externals, "feedback": ext.feedback,
           "stopSeconds": deck.sim["stopSeconds"], "stepSeconds": deck.sim["stepSeconds"], "syncSeconds": sync,
           "startFromRest": deck.sim.get("startFromRest", True)}
    try:
        run = fw.run_firmware_cosim(boards[0]["props"]["sketch"], req)
    except cosim.CosimError as err:
        field = err.code if err.code.startswith("sim.") else "circuit"
        raise cp.Refusal(f"{boards[0]['id']}: {err.detail}", field)
    return {boards[0]["id"]: run}


def cosim_warnings(closed, part_id):
    """@description What the loop noticed: a pin whose switching is locked to the sync step (the
    co-simulation's own delay driving it, not the circuit), and a pin that left OUTPUT mid-run, which
    the deck's fixed topology cannot follow."""
    out = []
    if closed.get("chatter"):
        out.append({"code": "cosim_chatter", "part": part_id, "message": f"{part_id}: {', '.join(closed['chatter'])} switches once per co-simulation step ({closed['syncSeconds']:g} s) -- the feedback delay is driving it, not the circuit; lower sim.syncSeconds and compare"})
    if closed.get("modeChanged"):
        out.append({"code": "firmware_mode_changed", "part": part_id, "message": f"{part_id}: {', '.join(closed['modeChanged'])} changed direction during the run; the deck holds the mode the sketch set first"})
    return out


def cosim_agreement(closed, signals, time_col):
    """@description The two solves must agree. The loop fed the sketch node voltages from its own
    transient; the deck that is finally solved carries the sketch's edges as PWL sources. Returns the
    largest difference between them at the sampled instants -- a real number, not an assumption."""
    order, worst, at = closed.get("sampleOrder") or [], 0.0, None
    for row in closed.get("samples", []):
        t = row[0]
        if not time_col[0] <= t <= time_col[-1]:
            continue
        i = _nearest(time_col, t)
        lo, hi = max(0, i - COSIM_AGREE_WINDOW), min(len(time_col), i + COSIM_AGREE_WINDOW + 1)
        for node, v in zip(order, row[1:]):
            series = signals.get(f"v({node})")
            if series is None:
                continue
            # the two solves choose their own time points, so an edge lands a step apart in each: the
            # question is whether the TRAJECTORY agrees, which is the closest sample within a few steps
            d = min(abs(series[k] - v) for k in range(lo, hi))
            if d > worst:
                worst, at = d, (node, t)
    return worst, at


def _nearest(time_col, t):
    """@description Index of the sample closest to t in a sorted time column."""
    i = bisect.bisect_left(time_col, t)
    if i == 0:
        return 0
    if i >= len(time_col):
        return len(time_col) - 1
    return i if abs(time_col[i] - t) < abs(time_col[i - 1] - t) else i - 1


def _stats(values):
    if not values:
        return {"avg": 0.0, "peak": 0.0, "final": 0.0, "max": 0.0, "min": 0.0}
    tail = values[-max(1, len(values) // 50):]
    return {"avg": sum(values) / len(values), "peak": max(abs(v) for v in values), "final": sum(tail) / len(tail), "max": max(values), "min": min(values)}


def _mul(a, b):
    return [x * y for x, y in zip(a, b)]


def _sub(a, b):
    return [x - y for x, y in zip(a, b)]


def part_readings(deck, signals, time_col):
    """@description Per-part numbers from the waveforms (the units the surface shows)."""
    zeros = [0.0] * len(time_col)
    vnet = lambda name: zeros if name == "0" else signals[f"v({name})"]  # noqa: E731
    vpin = lambda pid, pin: vnet(deck.net(pid, pin))  # noqa: E731
    out = []
    for p in deck.parts:
        t, pid, pr = p["type"], p["id"], p["props"]
        r = {"id": pid, "type": t}
        cur = signals.get(f"i({pid})")
        if t in ("battery", "source"):
            vv = _sub(vpin(pid, "+"), vpin(pid, "-"))
            i, w = _stats(cur), _stats(_mul(vv, cur))
            r.update({"ampsAvg": i["avg"], "ampsPeak": i["peak"], "ampsFinal": i["final"], "wattsAvg": w["avg"], "voltsFinal": _stats(vv)["final"]})
            if t == "battery":
                r["runtimeHours"] = (pr["capacityMah"] / 1000) / i["avg"] if i["avg"] > 1e-6 else None
        elif t in ("resistor", "capacitor", "inductor", "diode", "led", "switch", "potentiometer", "zener", "lamp"):
            pins = cp.PART_LIBRARY[t]["pins"]
            vv = _sub(vpin(pid, pins[0]["name"]), vpin(pid, pins[-1]["name"]))
            i, v, w = _stats(cur), _stats(vv), _stats(_mul(vv, cur))
            r.update({"ampsFinal": i["final"], "ampsPeak": i["peak"], "ampsAvg": i["avg"], "voltsFinal": v["final"], "voltsPeak": v["peak"], "wattsAvg": w["avg"], "wattsPeak": w["peak"]})
            if t == "resistor":
                r["overRated"] = w["avg"] > pr["ratedWatts"]
            elif t == "capacitor":
                r["overRated"] = v["peak"] > pr["ratedVolts"]
            elif t == "led":
                ma = i["final"] * 1000
                r.update({"milliampsFinal": ma, "milliampsPeak": i["peak"] * 1000, "lit": ma >= 1.0, "brightness": max(0.0, min(1.0, ma / pr["maxMa"])), "overMax": i["peak"] * 1000 > pr["maxMa"]})
            elif t == "switch":
                r["closed"] = pr["closed"] if pr["toggleAtSeconds"] is None else (not pr["closed"] if time_col[-1] >= pr["toggleAtSeconds"] else pr["closed"])
            elif t == "potentiometer":
                r["wiperVoltsFinal"] = _stats(vpin(pid, "w"))["final"]
            elif t == "zener":
                r["regulating"] = abs(-v["final"] - pr["breakdownVolts"]) < 0.1 * pr["breakdownVolts"]  # reverse-biased: k above a
            elif t == "lamp":
                r.update({"brightness": max(0.0, min(1.0, w["avg"] / pr["ratedWatts"])), "lit": w["avg"] >= 0.1 * pr["ratedWatts"], "overRated": w["avg"] > 1.2 * pr["ratedWatts"]})
        elif t in ("npn", "nmos"):
            top, bot = ("c", "e") if t == "npn" else ("d", "s")
            vv = _sub(vpin(pid, top), vpin(pid, bot))
            i, v, w = _stats(cur), _stats(vv), _stats(_mul(vv, cur))
            r.update({"ampsFinal": i["final"], "ampsPeak": i["peak"], "voltsFinal": v["final"], "wattsAvg": w["avg"], "wattsPeak": w["peak"]})
        elif t == "motor":
            m = deck.mech["motors"][pid]
            k = m["constants"]
            rpm, i = _stats(signals[f"rpm({pid})"]), _stats(cur)
            vv = _sub(vpin(pid, "+"), vpin(pid, "-"))
            elec = _stats(_mul(vv, cur))
            omega_final = rpm["final"] * cp.RPM_TO_RADS
            torque = k["kt"] * i["final"]
            mech_w = torque * omega_final
            r.update({"rpmFinal": rpm["final"], "rpmPeak": rpm["peak"], "ampsAvg": i["avg"], "ampsFinal": i["final"], "ampsPeak": i["peak"], "voltsFinal": _stats(vv)["final"],
                      "torqueMnmFinal": torque * 1000, "mechanicalWattsFinal": mech_w, "electricalWattsAvg": elec["avg"], "electricalWattsFinal": elec["final"],
                      "efficiencyPercent": (100 * mech_w / elec["final"]) if elec["final"] > 1e-9 and mech_w > 0 else 0.0,
                      "stalled": abs(rpm["final"]) < 0.01 * pr["noLoadRpm"] and i["final"] > 0.5 * pr["stallAmps"],
                      "shaft": m["shaft"], "constants": k, "reflected": m["reflected"]})
        elif t == "regulator":
            vin, vout = _stats(_sub(vpin(pid, "in"), vpin(pid, "gnd"))), _stats(_sub(vpin(pid, "out"), vpin(pid, "gnd")))
            i = _stats(cur)
            r.update({"inputVoltsFinal": vin["final"], "voltsFinal": vout["final"], "ampsFinal": i["final"], "ampsPeak": i["peak"], "droppedWattsFinal": max(0.0, vin["final"] - vout["final"]) * i["final"],
                      "overMax": i["peak"] > pr["maxAmps"], "inDropout": vout["final"] < pr["outputVolts"] - 0.1})
        elif t == "opamp":
            vo, i = _stats(vpin(pid, "out")), _stats(cur)
            vcc, vee = _stats(vpin(pid, "vcc"))["final"], _stats(vpin(pid, "vee"))["final"]
            inside = vo["final"] + 50 * i["final"]  # the output stage before its 50 ohm source resistance
            r.update({"voltsFinal": vo["final"], "voltsPeak": vo["peak"], "ampsFinal": i["final"], "saturated": inside >= vcc - pr["railDropVolts"] - 0.05 or inside <= vee + pr["railDropVolts"] + 0.05})
        elif t == "relay":
            i, c = _stats(cur), _stats(signals[f"i({pid}:com)"])
            r.update({"coilAmpsFinal": i["final"], "coilAmpsPeak": i["peak"], "energized": i["final"] >= pr["pullInAmps"], "contactAmpsFinal": c["final"], "contactAmpsPeak": c["peak"]})
        elif t == "sequencer":
            vv = _sub(vpin(pid, "out"), vpin(pid, "ref"))
            v, i = _stats(vv), _stats(cur)
            r.update({"voltsFinal": v["final"], "levelFinal": (v["final"] / pr["highVolts"]) if pr["highVolts"] > 0 else 0.0, "ampsAvg": i["avg"], "ampsPeak": i["peak"], "steps": len(cp.parse_sequence(pr["pattern"]))})
        elif t == "hbridge":
            i1, i2 = _stats(cur), _stats(signals[f"i({pid}:out2)"])
            vv = _stats(_sub(vpin(pid, "out1"), vpin(pid, "out2")))
            r.update({"ampsFinal": i1["final"], "ampsPeak": max(i1["peak"], i2["peak"]), "out2AmpsFinal": i2["final"], "voltsFinal": vv["final"], "direction": "forward" if vv["final"] > 0.5 else ("reverse" if vv["final"] < -0.5 else "off")})
        elif t == "timer555":
            vout = _sub(vpin(pid, "out"), vpin(pid, "gnd"))
            vcc = _stats(_sub(vpin(pid, "vcc"), vpin(pid, "gnd")))["final"]
            half = vcc / 2
            edges = [time_col[k] for k in range(1, len(vout)) if vout[k - 1] < half <= vout[k]]
            high = sum(1 for v in vout if v > half) / max(1, len(vout))
            r.update({"voltsFinal": _stats(vout)["final"], "outHigh": vout[-1] > half, "ampsFinal": _stats(cur)["final"], "risingEdges": len(edges),
                      "frequencyHz": ((len(edges) - 1) / (edges[-1] - edges[0])) if len(edges) >= 2 and edges[-1] > edges[0] else None, "dutyPercent": 100 * high})
        elif t == "servo":
            m = deck.mech["motors"][pid]
            ang, tgt, pulse, i = _stats(signals[f"angle({pid})"]), _stats(signals[f"target({pid})"]), _stats(signals[f"pulse({pid})"]), _stats(cur)
            err = tgt["final"] - ang["final"]
            r.update({"angleDeg": ang["final"], "targetDeg": tgt["final"], "pulseMs": pulse["final"], "ampsAvg": i["avg"], "ampsFinal": i["final"], "ampsPeak": i["peak"],
                      "supplyVoltsFinal": _stats(_sub(vpin(pid, "v+"), vpin(pid, "gnd")))["final"], "rpmFinal": _stats(signals[f"rpm({pid})"])["final"],
                      "tracking": abs(err) < 5.0, "stalled": abs(err) > 10.0 and i["final"] > 0.5 * pr["stallAmps"], "shaft": m["shaft"], "constants": m["constants"], "reflected": m["reflected"]})
        elif t == "stepper":
            m = deck.mech["motors"][pid]
            npp = m["constants"]["polePairs"]
            ia, ib, ang = signals[f"i({pid})"], signals[f"i({pid}:b)"], signals[f"angle({pid})"]
            # the load angle: the electrical angle the currents command (unwrapped over time) minus the
            # rotor's; a step is lost once it passes 180 degrees electrical -- the torque then pulls the
            # rotor into the next well, not back
            field, prev = [], 0.0
            for a, b in zip(ia, ib):
                raw = math.atan2(b, a) if abs(a) + abs(b) > 1e-6 else prev
                prev += ((raw - prev + math.pi) % (2 * math.pi)) - math.pi
                field.append(prev)
            lag = [f - npp * th * math.pi / 180 for f, th in zip(field, ang)]
            # a stepper's numbers are read at the LAST sample: a step inside the usual 2 % window would blur them
            lag_final = lag[-1]
            slipped = any(abs(v) >= math.pi for v in lag[len(lag) // 10:])
            r.update({"angleDeg": ang[-1], "rpmFinal": _stats(signals[f"rpm({pid})"])["final"], "rpmPeak": _stats(signals[f"rpm({pid})"])["peak"],
                      "phaseAmpsFinal": ia[-1], "phaseAmpsPeak": max(_stats(ia)["peak"], _stats(ib)["peak"]),
                      "loadAngleDeg": lag_final * 180 / math.pi / npp, "slipped": slipped, "holding": not slipped and abs(lag_final) < math.pi / 2,
                      "shaft": m["shaft"], "constants": m["constants"], "reflected": m["reflected"]})
        elif t == "stepdriver":
            i = _stats(cur)
            r.update({"stepsFinal": signals[f"steps({pid})"][-1], "ampsAvg": i["avg"], "ampsFinal": i["final"], "ampsPeak": i["peak"], "phaseAmpsPeak": max(_stats(signals[f"i({pid}:a)"])["peak"], _stats(signals[f"i({pid}:b)"])["peak"]),
                      "supplyVoltsFinal": _stats(_sub(vpin(pid, "vm"), vpin(pid, "gnd")))["final"]})
        elif t in ("gear", "load", "pulley", "crank"):
            shaft = next(s for s in deck.mech["shafts"] if pid in s["parts"])
            moving = f"rpm({shaft['id']})" in signals
            linked = any(shaft["cluster"] in (l["a"]["cluster"], l["b"]["cluster"]) for l in deck.mech["links"])
            r.update({"shaft": shaft["id"], "driven": shaft["drivenBy"] is not None or linked, "ratio": shaft["ratio"], "rpmFinal": _stats(signals[f"rpm({shaft['id']})"])["final"] if moving else 0.0})
            if t == "gear":
                r["pitchRadiusMm"] = pr["moduleMm"] * pr["teeth"] / 2
            elif t == "pulley":
                belt = next((b for b in deck.mech["belts"] if pid in (b["a"], b["b"])), None)
                if belt:
                    sl, f = _stats(signals[f"slip({belt['wire']})"]), _stats(signals[f"force({belt['wire']})"])
                    grip = next(l["grip"] for l in deck.mech["links"] if l.get("wire") == belt["wire"])
                    rim = (_stats(signals[f"rpm({shaft['id']})"])["final"] * cp.RPM_TO_RADS * pr["radiusMm"] * 1e-3) if moving else 0.0
                    other = rim + sl["final"] if belt["b"] == pid else rim - sl["final"]  # slip = rim(a) - rim(b)
                    ref = max(abs(rim), abs(other), 1e-6)
                    pct = 100 * abs(sl["final"]) / ref
                    r.update({"belt": belt["wire"], "beltForceNFinal": f["final"], "beltForceNPeak": f["peak"], "slipMpsFinal": sl["final"], "slipPercent": pct, "slipping": pct > 10 or abs(f["final"]) > 0.9 * grip})
            elif t == "crank":
                x = _stats(signals[f"x({pid})"])
                r.update({"sliderXmmFinal": x["final"], "sliderXmmMin": x["min"], "sliderXmmMax": x["max"], "strokeMm": 2 * pr["radiusMm"]})
        elif t == "arduino":
            run, i = deck.firmware[pid], _stats(cur)
            headers = {pin["name"] for pin in cp.PART_LIBRARY["arduino"]["pins"]}  # D0 / D1 are the serial port, not headers here
            driven = sorted((k for k, m in run["modes"].items() if k in headers and m == "output" and run["pins"].get(k)), key=lambda k: (k[0], int(k[1:])))
            r.update({"compiled": True, "flashBytes": run["flashBytes"], "simulatedSeconds": run["seconds"], "cycles": run["cycles"], "pinsDriven": driven, "edges": run["edges"],
                      "modes": {k: m for k, m in run["modes"].items() if k in headers and m != "input"}, "serial": run["serial"][:2000], "ampsAvg": i["avg"], "ampsPeak": i["peak"], "ampsFinal": i["final"]})
            cs = run.get("coSim")
            if cs:  # the closed loop: what the sketch read, and at what step it and the solver stepped together
                r.update({"closedLoop": True, "syncSeconds": cs["syncSeconds"], "coSimSlices": cs["slices"], "solverPoints": cs["solverPoints"],
                          "readsPins": sorted(cs["feedbackPins"]), "analogReads": cs["reads"]})
        elif t == "spring":
            tw, tq = _stats(signals[f"twist({pid})"]), _stats(signals[f"torque({pid})"])
            r.update({"twistDegFinal": tw["final"], "twistDegPeak": tw["peak"], "torqueMnmFinal": tq["final"], "torqueMnmPeak": tq["peak"]})
        out.append(r)
    return out


def derived_signals(deck, signals):
    """Shaft rpm from the driving motor's rpm and the reflected ratio; motor torque from current."""
    for s in deck.mech["shafts"]:
        if f"rpm({s['id']})" in signals:
            continue  # the cluster's own node signal
        base, r = signals[s["base"]], s["ratio"]
        signals[f"rpm({s['id']})"] = [v * r for v in base]
    for mid, m in deck.mech["motors"].items():
        if m["type"] == "motor":
            signals[f"torque({mid})"] = [v * m["constants"]["kt"] * 1000 for v in signals[f"i({mid})"]]
        elif m["type"] == "servo":
            signals[f"torque({mid})"] = [v * m["constants"]["kt"] * 1000 for v in signals[f"i({mid}:motor)"]]
        else:
            km, npp = m["constants"]["km"], m["constants"]["polePairs"]
            signals[f"torque({mid})"] = [km * 1000 * (-a * math.sin(npp * th * math.pi / 180) + b * math.cos(npp * th * math.pi / 180)) for a, b, th in zip(signals[f"i({mid})"], signals[f"i({mid}:b)"], signals[f"angle({mid})"])]


def build(args):
    parts, wires = cp.validate_circuit(args.get("circuit"))
    sim = cp.validate_sim(args.get("sim"))
    deck = Deck(parts, wires, sim)
    text = deck.build()
    return deck, text


def check(args):
    deck, text = build(args)
    return {"netlist": text, "nets": deck.nets, "netOfPin": {f"{a}.{b}": n for (a, b), n in deck.net_of_pin.items()}, "mechanism": public_mech(deck), "warnings": deck.warnings, "sim": deck.sim}


def public_mech(deck):
    m = deck.mech
    return {"shafts": [{k: v for k, v in s.items()} for s in m["shafts"]], "meshes": m["meshes"], "belts": m["belts"], "links": m["links"], "clusters": m["clusters"], "motors": m["motors"]}


def simulate(args):
    started = time.time()
    deck, text = build(args)
    closed, board = None, None
    if deck.feedback and fw.cosim_available():
        runs = cosimulate(deck)
        board, run = next(iter(runs.items()))
        deck = Deck(deck.parts, deck.wires, deck.sim, firmware=runs)
        text, closed = deck.build(), run["coSim"]
    timeout = min(float(args.get("timeoutSeconds") or 60), 300.0)
    relaxed = False
    try:
        time_col, cols, log_tail = run_ngspice(deck, timeout)
    except cp.Refusal as err:
        if err.field != "circuit":
            raise
        if cp.solver_chosen(deck.sim):  # the person chose the tolerances: their choice is not silently overridden
            raise cp.Refusal(f"{err} (tried with the sim.reltol / sim.gmin / sim.method you set; the automatic relaxed retry runs only at the defaults)", "circuit")
        deck.relaxed = relaxed = True  # one retry with looser tolerances; the report says so
        time_col, cols, log_tail = run_ngspice(deck, timeout)
    if len(time_col) < 2:
        raise cp.Refusal("ngspice produced no time points: " + log_tail[-300:], "circuit")
    signals = {}
    for (_, public, scale), values in zip(deck.vectors, cols):
        signals[public] = values if scale == 1.0 else [v * scale for v in values]
    derived_signals(deck, signals)
    readings = part_readings(deck, signals, time_col)
    warnings = list(deck.warnings)
    if closed:
        warnings += cosim_warnings(closed, board)
        worst, at = cosim_agreement(closed, signals, time_col)
        if at is not None and worst > COSIM_AGREE_VOLTS:
            warnings.append({"code": "cosim_disagreement", "part": board, "message": f"the co-simulated loop and the solved deck differ by {worst:.2f} V on {at[0]} near {at[1]:.4g} s -- treat the readings as approximate and lower sim.syncSeconds"})
    elif deck.feedback:
        warnings.append({"code": "cosim_unavailable", "message": "this engine image has no libngspice, so the sketch ran open-loop: every digitalRead and analogRead sees nothing the circuit does. Rebuild the engine container (install-engine.sh)"})
    if relaxed:
        warnings.append({"code": "relaxed_tolerances", "message": "the solver refused the default tolerances; solved again with relaxed ones (reltol 0.01, gmin 1e-9, gear) -- treat fast edges as approximate"})
    for r in readings:
        if r.get("overRated"):
            warnings.append({"code": "over_rated", "part": r["id"], "message": f"{r['id']} exceeds its rating"})
        if r.get("overMax"):
            warnings.append({"code": "led_over_max", "part": r["id"], "message": f"{r['id']} peaks above its maximum current"})
        if r.get("stalled"):
            warnings.append({"code": "motor_stalled", "part": r["id"], "message": f"{r['id']} is stalled: the load exceeds its torque"})
        if r.get("slipped"):
            warnings.append({"code": "stepper_slipped", "part": r["id"], "message": f"{r['id']} lost steps: the load angle passed a half step"})
    mech = public_mech(deck)
    for s in mech["shafts"]:
        s["rpmFinal"] = _stats(signals[f"rpm({s['id']})"])["final"] if f"rpm({s['id']})" in signals else 0.0
    round6 = lambda xs: [float(f"{v:.6g}") if math.isfinite(v) else 0.0 for v in xs]  # noqa: E731
    if any(not math.isfinite(v) for vs in signals.values() for v in vs):
        warnings.append({"code": "non_finite", "message": "ngspice produced non-finite samples; they are shown as 0"})
    return {"protocol": PROTOCOL, "netlist": text, "nets": deck.nets, "netOfPin": {f"{a}.{b}": n for (a, b), n in deck.net_of_pin.items()}, "sim": deck.sim,
            "waveforms": {"time": round6(time_col), "signals": {k: round6(v) for k, v in signals.items()}},
            "readings": readings, "mechanism": mech, "warnings": warnings, "engineLog": log_tail[-1200:], "ms": int((time.time() - started) * 1000)}


def handle(request):
    cmd, args = request.get("cmd"), request.get("args") or {}
    if cmd == "hello":
        return hello()
    if cmd == "simulate":
        return simulate(args)
    if cmd == "check":
        return check(args)
    raise cp.Refusal(f"unknown command {cmd!r}", "cmd")


def main():
    if "--contract" in sys.argv:
        print(json.dumps(cp.contract(), sort_keys=True))
        return
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="\n", write_through=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        rid = None
        try:
            request = json.loads(raw)
            rid = request.get("id")
            result = handle(request)
            out.write(json.dumps({"id": rid, "ok": True, "result": result}, allow_nan=False) + "\n")
        except cp.Refusal as err:
            out.write(json.dumps({"id": rid, "ok": False, "error": {"code": "refused", "message": str(err), "field": err.field}}) + "\n")
        except Exception as err:  # noqa: BLE001 -- the worker must answer every line
            out.write(json.dumps({"id": rid, "ok": False, "error": {"code": "engine_error", "message": f"{type(err).__name__}: {str(err)[:500]}"}}) + "\n")


if __name__ == "__main__":
    main()
