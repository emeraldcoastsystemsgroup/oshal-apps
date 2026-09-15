# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial -- the worker against the real ngspice:
#   |                                           | the contract refuses bad input naming the field
#   |                                           | and fills defaults; nets resolve deterministically
#   |                                           | with an honest auto-ground; the mechanism solver
#   |                                           | reflects a gear train and refuses the shapes it
#   |                                           | cannot model; an LED, an RC charge, a switch that
#   |                                           | closes mid-run, a geared motor, a stalled motor and
#   |                                           | a PWM-driven motor solve to textbook numbers; and
#   |                                           | the protocol answers every line in order.
#   |                                           | Runs inside the engine container:
#   |                                           |   python -m unittest discover -s tests
# 2 | maintainer@emeraldcoastsystemsgroup.com   | The eight added parts each solve to a textbook
#   |                                           | number (a zener holds 5.1 V, a lamp burns its
#   |                                           | rated watts, a regulator holds 5 V and reports
#   |                                           | the dropped watts, a follower op-amp tracks, a
#   |                                           | relay pulls in and its NO / NC contacts swap, a
#   |                                           | sequenced pin blinks and repeats, an H-bridge
#   |                                           | drives a motor both ways, a 555 astable runs at
#   |                                           | the formula frequency), the sequence contract
#   |                                           | refuses bad patterns, and the relaxed retry is
#   |                                           | taken once and reported.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | A servo goes to the angle its pulse width names
#   |                                           | at its rated speed and droops under a torque; a
#   |                                           | stepper behind a step/dir driver turns exactly one
#   |                                           | step per pulse, holds a load at the textbook load
#   |                                           | angle, slips above its pull-out torque and steps
#   |                                           | back with dir low; a motor holds a lifted weight;
#   |                                           | a wire's route is accepted and ignored.
# 4 | maintainer@emeraldcoastsystemsgroup.com   | Non-rigid mechanics: a torsion spring and a load
#   |                                           | ring at sqrt(k/J)/2pi, a belt turns the second
#   |                                           | pulley at the radius ratio and slips when the load
#   |                                           | exceeds its grip, a crank-slider's slider follows
#   |                                           | the exact crank kinematics with a stroke of 2r,
#   |                                           | and the shapes the solver cannot model are refused.
# 5 | maintainer@emeraldcoastsystemsgroup.com   | Firmware in the loop: a blink sketch toggles an
#   |                                           | LED at the sketch's period, analogWrite drives a
#   |                                           | PWM whose RC average is the duty, Serial text is
#   |                                           | captured, a sketch that does not compile is refused
#   |                                           | naming the sketch with the compiler's words.
# 6 | maintainer@emeraldcoastsystemsgroup.com   | The part-type tail assertion includes the arduino
#   |                                           | part 0.6.0 appended to PART_LIBRARY; the first
#   |                                           | real-solver run of 0.6.0 found the 0.5.1 tuple.
# 7 | maintainer@emeraldcoastsystemsgroup.com   | The closed loop (BACKLOG B1): a button the sketch polls and a
#   |                                           | potentiometer it reads change what it drives, plus the four
#   |                                           | refusals -- a pin nothing drives, a sync step out of bounds, a
#   |                                           | second board, and a loop the co-simulation's own delay drives.
# 8 | maintainer@emeraldcoastsystemsgroup.com   | A wire's route as bend points (BACKLOG B9): accepted and
#   |                                           | carried, every malformed shape refused naming the field (pure
#   |                                           | contract, no solver).
# 9 | maintainer@emeraldcoastsystemsgroup.com   | The solver knobs (BACKLOG B7). SolverKnobs (no solver needed):
#   |                                           | a deck without knobs keeps the default .option line exactly,
#   |                                           | chosen reltol / gmin / method are written into it, each knob is
#   |                                           | bounded naming the field, and a refusal under chosen knobs is not
#   |                                           | retried over. HardSwitching (real solver): an inductor whose
#   |                                           | switch opens with no flyback path is refused at the default
#   |                                           | tolerances and solves with gear / reltol 0.01 / gmin 1e-9.
"""Real-solver tests for circuit_worker (need ngspice; they run in the engine image)."""
import copy
import json
import math
import os
import re
import subprocess
import sys
import unittest

ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "container"))
import circuit_parts as cp  # noqa: E402
import circuit_worker as w  # noqa: E402
import arduino_build as fw  # noqa: E402  (on sys.path once circuit_worker is imported)
from circuit_engine_bridge import GEARBOX_CIRCUIT, LED_CIRCUIT  # noqa: E402


def wire(wid, a, pa, b, pb):
    return {"id": wid, "from": {"part": a, "pin": pa}, "to": {"part": b, "pin": pb}}


def reading(result, pid):
    return next(r for r in result["readings"] if r["id"] == pid)


class Contract(unittest.TestCase):
    def test_contract_lists_every_type_with_typed_props(self):
        c = cp.contract()
        self.assertEqual(sorted(c["parts"]), sorted(cp.PART_TYPES))
        for spec in c["parts"].values():
            for prop in spec["props"].values():
                self.assertIn(prop["type"], ("number", "enum", "boolean", "text"))
        self.assertEqual(c["limits"]["maxParts"], 200)

    def test_refusals_name_the_field(self):
        cases = [
            ({"parts": [{"id": "X1", "type": "flux"}]}, "parts[0].type"),
            ({"parts": [{"id": "R1", "type": "resistor", "props": {"ohm": 5}}]}, "parts[0].props.ohm"),
            ({"parts": [{"id": "R1", "type": "resistor", "props": {"ohms": 0}}]}, "parts[0].props.ohms"),
            ({"parts": [{"id": "R1", "type": "resistor"}, {"id": "r1", "type": "resistor"}]}, "parts[1].id"),
            ({"parts": [{"id": "1R", "type": "resistor"}]}, "parts[0].id"),
            ({"parts": [{"id": "R1", "type": "resistor", "rotation": 45}]}, "parts[0].rotation"),
            ({"parts": [{"id": "L1", "type": "led", "props": {"color": "pink"}}]}, "parts[0].props.color"),
            ({"parts": [{"id": "S1", "type": "switch", "props": {"closed": "yes"}}]}, "parts[0].props.closed"),
            ({"parts": [{"id": "R1", "type": "resistor"}], "wires": [wire("w", "R1", "a", "R1", "q")]}, "wires[0].to.pin"),
            ({"parts": [{"id": "R1", "type": "resistor"}], "wires": [wire("w", "R1", "a", "R1", "a")]}, "wires[0]"),
            ({"parts": [{"id": "R1", "type": "resistor"}, {"id": "G1", "type": "gear"}], "wires": [wire("w", "R1", "a", "G1", "shaft")]}, "wires[0]"),
            ({"parts": [{"id": "R1", "type": "resistor"}, {"id": "R2", "type": "resistor"}], "wires": [wire("w", "R1", "a", "R2", "a"), wire("v", "R2", "a", "R1", "a")]}, "wires[1]"),
        ]
        for circuit, field in cases:
            with self.assertRaises(cp.Refusal) as ctx:
                cp.validate_circuit(circuit)
            self.assertEqual(ctx.exception.field, field, str(ctx.exception))
        with self.assertRaises(cp.Refusal) as ctx:
            cp.validate_sim({"stopSeconds": 10, "stepSeconds": 1e-6})
        self.assertEqual(ctx.exception.field, "sim.stepSeconds")

    def test_a_route_of_bend_points_is_carried_and_a_malformed_one_refused(self):
        two = [{"id": "R1", "type": "resistor"}, {"id": "R2", "type": "resistor"}]
        _, wires = cp.validate_circuit({"parts": two, "wires": [dict(wire("w1", "R1", "b", "R2", "a"), route={"points": [[120, 240], [200, 240]]})]})
        self.assertEqual(wires[0]["route"], {"points": [[120.0, 240.0], [200.0, 240.0]]})
        self.assertEqual(cp.contract()["limits"]["maxRoutePoints"], 16)
        bad = [({"mid": "left"}, "wires[0].route.mid"), ({"mid": 1, "points": [[1, 2]]}, "wires[0].route"), ({"points": []}, "wires[0].route.points"),
               ({"points": [[i * 20, 40] for i in range(17)]}, "wires[0].route.points"), ({"points": [[1, 2], [3]]}, "wires[0].route.points[1]"),
               ({"points": [[1, 2], [3, True]]}, "wires[0].route.points[1]")]
        for route, field in bad:
            with self.assertRaises(cp.Refusal) as ctx:
                cp.validate_circuit({"parts": two, "wires": [dict(wire("w1", "R1", "b", "R2", "a"), route=route)]})
            self.assertEqual(ctx.exception.field, field, str(route))

    def test_defaults_are_filled(self):
        parts, wires = cp.validate_circuit({"parts": [{"id": "M1", "type": "motor"}, {"id": "S1", "type": "switch"}]})
        self.assertEqual(parts[0]["props"]["noLoadRpm"], 3000)
        self.assertIsNone(parts[1]["props"]["toggleAtSeconds"])
        self.assertTrue(parts[1]["props"]["closed"])
        self.assertEqual(cp.validate_sim({})["points"], 2001)


class Nets(unittest.TestCase):
    def test_auto_ground_is_honest(self):
        circuit = copy.deepcopy(LED_CIRCUIT)
        circuit["parts"] = [p for p in circuit["parts"] if p["type"] != "ground"]
        circuit["wires"] = [x for x in circuit["wires"] if x["id"] not in ("w3", "w4")] + [wire("w5", "D1", "k", "B1", "-")]
        parts, wires = cp.validate_circuit(circuit)
        net_of_pin, nets, warnings = cp.resolve_nets(parts, wires)
        self.assertEqual(net_of_pin[("B1", "-")], "0")
        self.assertEqual([x["code"] for x in warnings], ["no_ground"])
        self.assertEqual([n["name"] for n in nets], ["n1", "0", "n2"])

    def test_unconnected_pin_is_warned(self):
        parts, wires = cp.validate_circuit({"parts": [{"id": "B1", "type": "battery"}, {"id": "R1", "type": "resistor"}], "wires": [wire("w", "B1", "+", "R1", "a")]})
        _, _, warnings = cp.resolve_nets(parts, wires)
        # B1.- is the auto-chosen reference AND unwired: both facts are reported.
        self.assertEqual(sorted(x["part"] + "." for x in warnings if x["code"] == "unconnected_pin"), ["B1.", "R1."])
        self.assertIn("no_ground", [x["code"] for x in warnings])


class Mechanism(unittest.TestCase):
    def test_gear_train_ratio_and_reflection(self):
        parts, wires = cp.validate_circuit(GEARBOX_CIRCUIT)
        m = cp.solve_mechanism(parts, wires)
        g2 = next(s for s in m["shafts"] if "G2" in s["parts"])
        self.assertAlmostEqual(g2["ratio"], -1 / 3)
        self.assertEqual(g2["drivenBy"], "M1")
        refl = m["motors"]["M1"]["reflected"]
        self.assertAlmostEqual(refl["inertia"], 10e-7 + 5e-7 + (5e-7 + 50e-7) / 9)
        self.assertEqual(m["warnings"], [])

    def test_compound_train_keeps_the_sign(self):
        parts, wires = cp.validate_circuit({"parts": [
            {"id": "M1", "type": "motor"}, {"id": "G1", "type": "gear", "props": {"teeth": 20}}, {"id": "G2", "type": "gear", "props": {"teeth": 60}},
            {"id": "G3", "type": "gear", "props": {"teeth": 20}}, {"id": "G4", "type": "gear", "props": {"teeth": 60}}],
            "wires": [wire("a", "M1", "shaft", "G1", "shaft"), wire("b", "G1", "teeth", "G2", "teeth"), wire("c", "G2", "shaft", "G3", "shaft"), wire("d", "G3", "teeth", "G4", "teeth")]})
        m = cp.solve_mechanism(parts, wires)
        g4 = next(s for s in m["shafts"] if "G4" in s["parts"])
        self.assertAlmostEqual(g4["ratio"], 1 / 9)

    def test_refused_shapes(self):
        base = [{"id": "M1", "type": "motor"}, {"id": "G1", "type": "gear"}, {"id": "G2", "type": "gear"}]
        same_shaft = {"parts": base, "wires": [wire("a", "G1", "shaft", "G2", "shaft"), wire("b", "G1", "teeth", "G2", "teeth")]}
        two_motors = {"parts": base + [{"id": "M2", "type": "motor"}], "wires": [wire("a", "M1", "shaft", "G1", "shaft"), wire("b", "G1", "teeth", "G2", "teeth"), wire("c", "G2", "shaft", "M2", "shaft")]}
        loop = {"parts": base + [{"id": "G3", "type": "gear", "props": {"teeth": 30}}], "wires": [wire("a", "M1", "shaft", "G1", "shaft"), wire("b", "G1", "teeth", "G2", "teeth"), wire("c", "G2", "teeth", "G3", "teeth"), wire("d", "G3", "teeth", "G1", "teeth")]}
        for circuit, pattern in ((same_shaft, "same shaft"), (two_motors, "one motor per train"), (loop, "inconsistent")):
            parts, wires = cp.validate_circuit(circuit)
            with self.assertRaisesRegex(cp.Refusal, pattern):
                cp.solve_mechanism(parts, wires)

    def test_undriven_shaft_is_warned(self):
        parts, wires = cp.validate_circuit({"parts": [{"id": "G1", "type": "gear"}, {"id": "L1", "type": "load"}], "wires": [wire("a", "G1", "shaft", "L1", "shaft")]})
        m = cp.solve_mechanism(parts, wires)
        self.assertEqual([x["code"] for x in m["warnings"]], ["not_driven"])
        self.assertIsNone(m["shafts"][0]["drivenBy"])
        self.assertEqual(m["shafts"][0]["ratio"], 1.0, "a passive cluster's reference group has ratio 1 to its own node")


class Solve(unittest.TestCase):
    def test_hello_names_ngspice(self):
        self.assertRegex(w.hello()["ngspice"] or "", r"^\d+")

    def test_led_circuit(self):
        r = w.simulate({"circuit": LED_CIRCUIT, "sim": {"stopSeconds": 0.01}})
        led, res, bat = reading(r, "D1"), reading(r, "R1"), reading(r, "B1")
        self.assertTrue(2.9 < led["milliampsFinal"] < 3.4)
        self.assertTrue(led["lit"])
        self.assertFalse(led["overMax"])
        self.assertAlmostEqual(res["wattsAvg"], 0.0097, delta=0.0006)
        self.assertAlmostEqual(bat["ampsAvg"], 0.00312, delta=0.0002)
        self.assertAlmostEqual(bat["runtimeHours"], 160, delta=12)
        self.assertEqual(r["warnings"], [])
        self.assertIn("v(n2)", r["waveforms"]["signals"])
        self.assertEqual(len(r["waveforms"]["time"]), 2001)
        self.assertIn(".end", r["netlist"])
        self.assertNotIn(".control", r["netlist"])

    def test_rc_charge_reaches_63_percent_at_tau(self):
        circuit = {"parts": [{"id": "B1", "type": "battery", "props": {"volts": 5, "internalOhms": 0}}, {"id": "R1", "type": "resistor", "props": {"ohms": 1000}},
                             {"id": "C1", "type": "capacitor", "props": {"farads": 100e-6}}, {"id": "GND", "type": "ground"}],
                   "wires": [wire("a", "B1", "+", "R1", "a"), wire("b", "R1", "b", "C1", "a"), wire("c", "C1", "b", "GND", "gnd"), wire("d", "B1", "-", "GND", "gnd")]}
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.1}})
        vc = r["waveforms"]["signals"]["v(n2)"]
        self.assertLess(vc[0], 0.05)  # power applied to a circuit at rest
        self.assertAlmostEqual(vc[-1], 5 * (1 - math.exp(-1)), delta=0.05)
        self.assertFalse(reading(r, "C1")["overRated"])
        # The DC steady state is available on request.
        steady = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.1, "startFromRest": False}})
        self.assertAlmostEqual(steady["waveforms"]["signals"]["v(n2)"][0], 5, delta=0.01)

    def test_switch_closes_mid_run(self):
        circuit = copy.deepcopy(LED_CIRCUIT)
        circuit["parts"].append({"id": "S1", "type": "switch", "props": {"closed": False, "toggleAtSeconds": 0.005}})
        circuit["wires"] = [x for x in circuit["wires"] if x["id"] != "w1"] + [wire("w1", "B1", "+", "S1", "a"), wire("w5", "S1", "b", "R1", "a")]
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.01}})
        i_led = r["waveforms"]["signals"]["i(D1)"]
        self.assertLess(abs(i_led[10]), 1e-6)
        self.assertTrue(2.9 < i_led[-1] * 1000 < 3.4)
        self.assertTrue(reading(r, "S1")["closed"])
        self.assertTrue(reading(r, "D1")["lit"])

    def test_geared_motor(self):
        r = w.simulate({"circuit": GEARBOX_CIRCUIT, "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0005}})
        m, g2, load = reading(r, "M1"), reading(r, "G2"), reading(r, "L1")
        self.assertTrue(2850 < m["rpmFinal"] < 3000, m["rpmFinal"])
        self.assertFalse(m["stalled"])
        spin = r["waveforms"]["signals"]["rpm(M1)"]
        self.assertLess(spin[0], 1.0)  # starts from rest
        self.assertGreater(spin[20], 100)  # and is spinning 10 ms in
        self.assertAlmostEqual(g2["rpmFinal"], -m["rpmFinal"] / 3, delta=1)
        self.assertEqual(load["shaft"], "shaft:G2")
        self.assertTrue(load["driven"])
        self.assertAlmostEqual(g2["pitchRadiusMm"], 30)
        self.assertIn("rpm(shaft:G2)", r["waveforms"]["signals"])
        self.assertIn("torque(M1)", r["waveforms"]["signals"])
        self.assertTrue(0 < m["efficiencyPercent"] < 100)
        self.assertGreater(m["electricalWattsFinal"], 0)

    def test_stalled_motor(self):
        circuit = copy.deepcopy(GEARBOX_CIRCUIT)
        next(p for p in circuit["parts"] if p["id"] == "L1")["props"]["frictionMnm"] = 5000
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.2, "stepSeconds": 0.0002}})
        m = reading(r, "M1")
        self.assertTrue(m["stalled"], m)
        self.assertAlmostEqual(m["ampsFinal"], 5, delta=0.3)
        self.assertIn("motor_stalled", [x["code"] for x in r["warnings"]])

    def test_pwm_through_a_mosfet(self):
        circuit = {"parts": [
            {"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "M1", "type": "motor"},
            {"id": "Q1", "type": "nmos"}, {"id": "D1", "type": "diode"}, {"id": "V1", "type": "source", "props": {"kind": "pulse", "volts": 5, "frequencyHz": 1000, "dutyPercent": 50}},
            {"id": "GND", "type": "ground"}],
            "wires": [wire("a", "B1", "+", "M1", "+"), wire("b", "M1", "-", "Q1", "d"), wire("c", "Q1", "s", "GND", "gnd"), wire("d", "B1", "-", "GND", "gnd"),
                      wire("e", "V1", "+", "Q1", "g"), wire("f", "V1", "-", "GND", "gnd"), wire("g", "D1", "a", "M1", "-"), wire("h", "D1", "k", "M1", "+")]}
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.2, "stepSeconds": 2e-5}})
        m = reading(r, "M1")
        # Unloaded, the freewheeling current is discontinuous (L/R = 0.4 ms < the 1 ms period), so the
        # speed sits between the duty-scaled 1500 rpm and the full-voltage 3000 rpm -- never above it.
        self.assertTrue(1500 < m["rpmFinal"] < 2950, m["rpmFinal"])
        self.assertLess(reading(r, "Q1")["wattsAvg"], 2.0)
        self.assertLess(r["waveforms"]["signals"]["rpm(M1)"][0], 1.0)

    def test_protocol_answers_every_line_in_order(self):
        proc = subprocess.Popen([sys.executable, os.path.join(ENGINE_DIR, "circuit_worker.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        lines = [json.dumps({"id": 1, "cmd": "hello"}), "{not json", json.dumps({"id": 3, "cmd": "nope"}), json.dumps({"id": 4, "cmd": "check", "args": {"circuit": {"parts": [{"id": "R1", "type": "resistor", "props": {"ohms": -1}}]}}})]
        out, _ = proc.communicate(("\n".join(lines) + "\n").encode("utf-8"), timeout=60)
        replies = [json.loads(l) for l in out.decode("utf-8").splitlines() if l.strip()]
        self.assertEqual([r.get("id") for r in replies], [1, None, 3, 4])
        self.assertTrue(replies[0]["ok"])
        self.assertEqual(replies[1]["error"]["code"], "engine_error")
        self.assertEqual(replies[2]["error"]["code"], "refused")
        self.assertEqual(replies[3]["error"]["field"], "parts[0].props.ohms")


def gnd_circuit(parts, wires):
    return {"parts": parts + [{"id": "GND", "type": "ground"}], "wires": wires}


class NewParts(unittest.TestCase):
    def test_zener_holds_its_breakdown(self):
        circuit = gnd_circuit([{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "R1", "type": "resistor", "props": {"ohms": 1000}}, {"id": "Z1", "type": "zener", "props": {"breakdownVolts": 5.1}}],
                              [wire("a", "B1", "+", "R1", "a"), wire("b", "R1", "b", "Z1", "k"), wire("c", "Z1", "a", "GND", "gnd"), wire("d", "B1", "-", "GND", "gnd")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.01}})
        z = reading(r, "Z1")
        self.assertAlmostEqual(-z["voltsFinal"], 5.1, delta=0.35)  # k sits above a
        self.assertTrue(z["regulating"])
        self.assertAlmostEqual(reading(r, "R1")["ampsFinal"], (12 - 5.1) / 1000, delta=0.0006)

    def test_lamp_burns_its_rating(self):
        circuit = gnd_circuit([{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "L1", "type": "lamp", "props": {"ratedVolts": 12, "ratedWatts": 5}}],
                              [wire("a", "B1", "+", "L1", "a"), wire("b", "L1", "b", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd")])
        lamp = reading(w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.01}}), "L1")
        self.assertAlmostEqual(lamp["wattsAvg"], 5, delta=0.05)
        self.assertAlmostEqual(lamp["brightness"], 1.0, delta=0.02)
        self.assertTrue(lamp["lit"]); self.assertFalse(lamp["overRated"])

    def test_regulator_holds_five_volts(self):
        circuit = gnd_circuit([{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "U1", "type": "regulator", "props": {"outputVolts": 5, "dropoutVolts": 2, "maxAmps": 1}}, {"id": "R1", "type": "resistor", "props": {"ohms": 100}}],
                              [wire("a", "B1", "+", "U1", "in"), wire("b", "U1", "gnd", "GND", "gnd"), wire("c", "U1", "out", "R1", "a"), wire("d", "R1", "b", "GND", "gnd"), wire("e", "B1", "-", "GND", "gnd")])
        u = reading(w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.01}}), "U1")
        self.assertAlmostEqual(u["voltsFinal"], 5, delta=0.01)
        self.assertAlmostEqual(u["ampsFinal"], 0.05, delta=0.001)
        self.assertAlmostEqual(u["droppedWattsFinal"], 0.35, delta=0.01)
        self.assertFalse(u["overMax"]); self.assertFalse(u["inDropout"])

    def test_opamp_follower_tracks_and_saturates_at_the_rail(self):
        parts = [{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "V1", "type": "source", "props": {"kind": "dc", "volts": 3}}, {"id": "A1", "type": "opamp", "props": {"gain": 1e5, "railDropVolts": 1}}, {"id": "R1", "type": "resistor", "props": {"ohms": 1000}}]
        wires = [wire("a", "B1", "+", "A1", "vcc"), wire("b", "A1", "vee", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd"), wire("d", "V1", "+", "A1", "+"), wire("e", "V1", "-", "GND", "gnd"), wire("f", "A1", "out", "A1", "-"), wire("g", "A1", "out", "R1", "a"), wire("h", "R1", "b", "GND", "gnd")]
        a = reading(w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 0.001}}), "A1")
        self.assertAlmostEqual(a["voltsFinal"], 3, delta=0.02); self.assertFalse(a["saturated"])
        parts[1]["props"]["volts"] = 15  # asks for more than the rail can give
        a = reading(w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 0.001}}), "A1")
        self.assertAlmostEqual(a["voltsFinal"], 11 * 1000 / 1050, delta=0.15, msg="11 V at the rail, less the 50 ohm output stage into 1 kohm"); self.assertTrue(a["saturated"])

    def test_relay_pulls_in_and_swaps_its_contacts(self):
        def build(coil_volts):
            parts = [{"id": "B1", "type": "battery", "props": {"volts": coil_volts, "internalOhms": 0}}, {"id": "K1", "type": "relay", "props": {"coilOhms": 100, "coilMh": 10, "pullInAmps": 0.03}},
                     {"id": "B2", "type": "battery", "props": {"volts": 5, "internalOhms": 0}}, {"id": "R1", "type": "resistor", "props": {"ohms": 500}}, {"id": "R2", "type": "resistor", "props": {"ohms": 500}}]
            wires = [wire("a", "B1", "+", "K1", "c+"), wire("b", "K1", "c-", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd"), wire("d", "B2", "+", "K1", "com"), wire("e", "B2", "-", "GND", "gnd"),
                     wire("f", "K1", "no", "R1", "a"), wire("g", "R1", "b", "GND", "gnd"), wire("h", "K1", "nc", "R2", "a"), wire("i", "R2", "b", "GND", "gnd")]
            return gnd_circuit(parts, wires)
        r = w.simulate({"circuit": build(12), "sim": {"stopSeconds": 0.05}})
        k = reading(r, "K1")
        self.assertAlmostEqual(k["coilAmpsFinal"], 0.12, delta=0.005); self.assertTrue(k["energized"])
        self.assertAlmostEqual(reading(r, "R1")["ampsFinal"], 0.01, delta=0.0005, msg="NO carries the load when energized")
        self.assertLess(reading(r, "R2")["ampsFinal"], 1e-6, "NC is open when energized")
        r = w.simulate({"circuit": build(1), "sim": {"stopSeconds": 0.05}})  # 10 mA: below pull-in
        self.assertFalse(reading(r, "K1")["energized"])
        self.assertAlmostEqual(reading(r, "R2")["ampsFinal"], 0.01, delta=0.0005, msg="NC carries the load at rest")
        self.assertLess(reading(r, "R1")["ampsFinal"], 1e-6)

    def test_sequenced_pin_blinks_and_repeats(self):
        parts = [{"id": "Q1", "type": "sequencer", "props": {"highVolts": 5, "pattern": "1:0.5 0:0.5", "repeat": True}}, {"id": "R1", "type": "resistor", "props": {"ohms": 1000}}]
        wires = [wire("a", "Q1", "out", "R1", "a"), wire("b", "R1", "b", "GND", "gnd"), wire("c", "Q1", "ref", "GND", "gnd")]
        r = w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 2.0, "stepSeconds": 0.001}})
        v = r["waveforms"]["signals"]["v(" + r["netOfPin"]["Q1.out"] + ")"]
        at = lambda t: v[int(round(t / 0.001))]  # noqa: E731
        self.assertAlmostEqual(at(0.25), 5, delta=0.01); self.assertAlmostEqual(at(0.75), 0, delta=0.01); self.assertAlmostEqual(at(1.25), 5, delta=0.01); self.assertAlmostEqual(at(1.75), 0, delta=0.01)
        self.assertEqual(reading(r, "Q1")["steps"], 2)
        parts[0]["props"]["repeat"] = False
        r = w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 2.0, "stepSeconds": 0.001}})
        v = r["waveforms"]["signals"]["v(" + r["netOfPin"]["Q1.out"] + ")"]
        self.assertAlmostEqual(v[int(1.25 / 0.001)], 0, delta=0.01, msg="without repeat the last level holds")
        with self.assertRaises(cp.Refusal) as ctx:
            cp.validate_circuit({"parts": [{"id": "Q1", "type": "sequencer", "props": {"pattern": "high 0.5"}}]})
        self.assertEqual(ctx.exception.field, "parts[0].props.pattern")
        with self.assertRaisesRegex(cp.Refusal, "positive duration"):
            cp.validate_circuit({"parts": [{"id": "Q1", "type": "sequencer", "props": {"pattern": "1:0 0:1"}}]})

    def test_hbridge_drives_the_motor_both_ways(self):
        def build(in1, in2):
            parts = [{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "H1", "type": "hbridge"}, {"id": "M1", "type": "motor"},
                     {"id": "V1", "type": "source", "props": {"kind": "dc", "volts": in1}}, {"id": "V2", "type": "source", "props": {"kind": "dc", "volts": in2}}]
            wires = [wire("a", "B1", "+", "H1", "vcc"), wire("b", "H1", "gnd", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd"), wire("d", "H1", "out1", "M1", "+"), wire("e", "H1", "out2", "M1", "-"),
                     wire("f", "V1", "+", "H1", "in1"), wire("g", "V1", "-", "GND", "gnd"), wire("h", "V2", "+", "H1", "in2"), wire("i", "V2", "-", "GND", "gnd")]
            return gnd_circuit(parts, wires)
        r = w.simulate({"circuit": build(5, 0), "sim": {"stopSeconds": 0.3, "stepSeconds": 0.0003}})
        self.assertGreater(reading(r, "M1")["rpmFinal"], 2800); self.assertEqual(reading(r, "H1")["direction"], "forward")
        r = w.simulate({"circuit": build(0, 5), "sim": {"stopSeconds": 0.3, "stepSeconds": 0.0003}})
        self.assertLess(reading(r, "M1")["rpmFinal"], -2800); self.assertEqual(reading(r, "H1")["direction"], "reverse")
        r = w.simulate({"circuit": build(0, 0), "sim": {"stopSeconds": 0.1}})
        self.assertLess(abs(reading(r, "M1")["rpmFinal"]), 5); self.assertEqual(reading(r, "H1")["direction"], "off")

    def test_555_astable_runs_at_the_formula_frequency(self):
        r1, r2, c = 1000, 10000, 10e-6
        parts = [{"id": "B1", "type": "battery", "props": {"volts": 9, "internalOhms": 0}}, {"id": "U1", "type": "timer555"}, {"id": "R1", "type": "resistor", "props": {"ohms": r1}},
                 {"id": "R2", "type": "resistor", "props": {"ohms": r2}}, {"id": "C1", "type": "capacitor", "props": {"farads": c}}, {"id": "R3", "type": "resistor", "props": {"ohms": 1000}}]
        wires = [wire("a", "B1", "+", "U1", "vcc"), wire("b", "U1", "gnd", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd"), wire("d", "B1", "+", "R1", "a"), wire("e", "R1", "b", "U1", "dis"),
                 wire("f", "U1", "dis", "R2", "a"), wire("g", "R2", "b", "U1", "thr"), wire("h", "U1", "thr", "U1", "trig"), wire("i", "U1", "thr", "C1", "a"), wire("j", "C1", "b", "GND", "gnd"),
                 wire("k", "U1", "out", "R3", "a"), wire("l", "R3", "b", "GND", "gnd")]
        r = w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 1.5, "stepSeconds": 0.0005}})
        u = reading(r, "U1")
        expected = 1.44 / ((r1 + 2 * r2) * c)  # 6.86 Hz
        self.assertIsNotNone(u["frequencyHz"], u)
        self.assertAlmostEqual(u["frequencyHz"], expected, delta=0.15 * expected)
        self.assertTrue(45 < u["dutyPercent"] < 62, u["dutyPercent"])  # (R1+R2)/(R1+2R2) = 52 %
        self.assertGreaterEqual(u["risingEdges"], 7)

    def test_relaxed_retry_is_taken_once_and_reported(self):
        calls = []
        original = w.run_ngspice
        def flaky(deck, timeout):
            calls.append(deck.relaxed)
            if not deck.relaxed:
                raise cp.Refusal("ngspice could not solve this circuit: timestep too small", "circuit")
            return original(deck, timeout)
        w.run_ngspice = flaky
        try:
            r = w.simulate({"circuit": LED_CIRCUIT, "sim": {"stopSeconds": 0.01}})
        finally:
            w.run_ngspice = original
        self.assertEqual(calls, [False, True])
        self.assertIn("relaxed_tolerances", [x["code"] for x in r["warnings"]])
        self.assertTrue(2.9 < reading(r, "D1")["milliampsFinal"] < 3.4)
        self.assertNotIn("gmin", r["netlist"], "the stored deck keeps the default options")


class SolverKnobs(unittest.TestCase):
    """The knobs as the deck writes them -- no solver needed (check() builds the deck; the retry is driven by a stub)."""

    def options_line(self, sim):
        return next(line for line in w.check({"circuit": LED_CIRCUIT, "sim": sim})["netlist"].splitlines() if line.startswith(".option"))

    def test_a_deck_without_knobs_keeps_the_default_options_exactly(self):
        self.assertEqual(self.options_line({"stopSeconds": 0.01}), ".option rshunt=1e12 reltol=0.003 abstol=1e-9 vntol=1e-6")
        self.assertEqual(self.options_line({"stopSeconds": 0.01, "reltol": None, "method": None}), cp.DEFAULT_OPTIONS, "null is the default, not a knob")

    def test_chosen_knobs_are_written_into_the_deck(self):
        self.assertEqual(self.options_line({"stopSeconds": 0.01, "reltol": 0.01, "gmin": 1e-9, "method": "gear"}), ".option rshunt=1e12 reltol=0.01 abstol=1e-9 vntol=1e-6 gmin=1e-09 method=gear")
        self.assertEqual(self.options_line({"stopSeconds": 0.01, "method": "gear"}), ".option rshunt=1e12 reltol=0.003 abstol=1e-9 vntol=1e-6 method=gear", "an unset knob keeps the lab default")
        self.assertEqual(cp.contract()["sim"]["methods"], ["trap", "gear"])
        self.assertEqual(cp.contract()["sim"]["defaults"]["gmin"], 1e-12)

    def test_each_knob_is_bounded_naming_the_field(self):
        for sim, field in (({"reltol": 1}, "sim.reltol"), ({"reltol": 0}, "sim.reltol"), ({"gmin": 1e-3}, "sim.gmin"), ({"gmin": "small"}, "sim.gmin"),
                           ({"gmin": True}, "sim.gmin"), ({"method": "euler"}, "sim.method"), ({"method": 1}, "sim.method")):
            with self.assertRaises(cp.Refusal) as ctx:
                cp.validate_sim(sim)
            self.assertEqual(ctx.exception.field, field, str(sim))

    def test_a_refusal_under_chosen_knobs_is_not_retried_over(self):
        calls = []
        original = w.run_ngspice
        def refuse(deck, timeout):
            calls.append(deck.relaxed)
            raise cp.Refusal("ngspice could not solve this circuit: timestep too small", "circuit")
        w.run_ngspice = refuse
        try:
            with self.assertRaises(cp.Refusal) as ctx:
                w.simulate({"circuit": LED_CIRCUIT, "sim": {"stopSeconds": 0.01, "method": "trap", "reltol": 0.003}})
            self.assertEqual(calls, [False], "the person's settings are used as given, once")
            self.assertIn("automatic relaxed retry runs only at the defaults", str(ctx.exception))
            calls.clear()
            with self.assertRaises(cp.Refusal):
                w.simulate({"circuit": LED_CIRCUIT, "sim": {"stopSeconds": 0.01}})
            self.assertEqual(calls, [False, True], "at the defaults the one relaxed retry still runs")
        finally:
            w.run_ngspice = original


class HardSwitching(unittest.TestCase):
    """BACKLOG B7's real case: an inductor carrying current whose switch opens with no flyback path -- the
    SW element steps from 1 mohm to 1 Gohm and the inductor forces its current into it."""

    @staticmethod
    def circuit():
        parts = [{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "S1", "type": "switch", "props": {"closed": True, "toggleAtSeconds": 0.001}},
                 {"id": "L1", "type": "inductor", "props": {"henries": 0.1}}, {"id": "R1", "type": "resistor", "props": {"ohms": 10, "ratedWatts": 25}}, {"id": "GND", "type": "ground"}]
        wires = [wire("w1", "B1", "+", "S1", "a"), wire("w2", "S1", "b", "L1", "a"), wire("w3", "L1", "b", "R1", "a"), wire("w4", "R1", "b", "GND", "gnd"), wire("w5", "B1", "-", "GND", "gnd")]
        return {"parts": parts, "wires": wires}

    def test_refused_at_the_default_tolerances(self):
        # the defaults chosen EXPLICITLY, so the automatic relaxed retry stays out of the way
        with self.assertRaises(cp.Refusal) as ctx:
            w.simulate({"circuit": self.circuit(), "sim": {"stopSeconds": 0.003, "stepSeconds": 1e-6, "reltol": 0.003, "method": "trap"}})
        self.assertEqual(ctx.exception.field, "circuit")
        self.assertIn("you set", str(ctx.exception))

    def test_solves_with_the_knobs_a_person_picks(self):
        r = w.simulate({"circuit": self.circuit(), "sim": {"stopSeconds": 0.003, "stepSeconds": 1e-6, "reltol": 0.01, "gmin": 1e-9, "method": "gear"}})
        self.assertNotIn("relaxed_tolerances", [x["code"] for x in r["warnings"]], "their settings solved it; no retry was taken")
        self.assertIn("method=gear", r["netlist"])
        i = r["waveforms"]["signals"]["i(L1)"]
        t = r["waveforms"]["time"]
        before = next(v for tt, v in zip(t, i) if tt >= 0.0009)
        self.assertAlmostEqual(before, 1.2 * (1 - math.exp(-0.0009 / 0.01)), delta=0.01)  # L/R = 10 ms charging toward 1.2 A
        self.assertLess(abs(i[-1]), 1e-3, "no path once the switch opens: the current is gone")


class ServoAndStepper(unittest.TestCase):
    @staticmethod
    def servo(width_ms, load_torque=0.0):
        parts = [{"id": "B1", "type": "battery", "props": {"volts": 5, "internalOhms": 0}}, {"id": "V1", "type": "source", "props": {"kind": "pulse", "volts": 5, "frequencyHz": 50, "dutyPercent": 100 * width_ms / 20}},
                 {"id": "S1", "type": "servo"}]
        wires = [wire("a", "B1", "+", "S1", "v+"), wire("b", "S1", "gnd", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd"), wire("d", "V1", "+", "S1", "sig"), wire("e", "V1", "-", "GND", "gnd")]
        if load_torque:
            parts.append({"id": "L1", "type": "load", "props": {"inertiaGcm2": 10, "torqueMnm": load_torque}})
            wires.append(wire("s", "S1", "shaft", "L1", "shaft"))
        return gnd_circuit(parts, wires)

    @staticmethod
    def stepper(step_hz, load_torque=0.0, dir_volts=5):
        parts = [{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "V1", "type": "source", "props": {"kind": "pulse", "volts": 5, "frequencyHz": step_hz, "dutyPercent": 50}},
                 {"id": "V2", "type": "source", "props": {"kind": "dc", "volts": dir_volts}}, {"id": "U1", "type": "stepdriver", "props": {"currentAmps": 1.7}}, {"id": "M1", "type": "stepper"}]
        wires = [wire("a", "B1", "+", "U1", "vm"), wire("b", "U1", "gnd", "GND", "gnd"), wire("c", "B1", "-", "GND", "gnd"), wire("d", "V1", "+", "U1", "step"), wire("e", "V1", "-", "GND", "gnd"),
                 wire("f", "V2", "+", "U1", "dir"), wire("g", "V2", "-", "GND", "gnd"), wire("h", "U1", "a+", "M1", "a+"), wire("i", "U1", "a-", "M1", "a-"), wire("j", "U1", "b+", "M1", "b+"), wire("k", "U1", "b-", "M1", "b-")]
        if load_torque:
            parts.append({"id": "L1", "type": "load", "props": {"inertiaGcm2": 10, "torqueMnm": load_torque}})
            wires.append(wire("s", "M1", "shaft", "L1", "shaft"))
        return gnd_circuit(parts, wires)

    def test_servo_goes_to_the_angle_its_pulse_names_at_its_rated_speed(self):
        for width, angle in ((1.0, 0.0), (1.5, 90.0), (2.0, 180.0)):
            r = w.simulate({"circuit": self.servo(width), "sim": {"stopSeconds": 0.4, "stepSeconds": 0.0005}})
            s = reading(r, "S1")
            self.assertAlmostEqual(s["pulseMs"], width, delta=0.02, msg=str(s))
            self.assertAlmostEqual(s["angleDeg"], angle, delta=2.5, msg=str(s))  # the 1.5 V decode threshold reads 0.008 ms long
            self.assertTrue(s["tracking"]); self.assertFalse(s["stalled"])
            self.assertAlmostEqual(s["ampsFinal"], 0.01, delta=0.02, msg="idle current at rest")
        ang = r["waveforms"]["signals"]["angle(S1)"]
        self.assertAlmostEqual((ang[200] - ang[100]) / 0.05, 500, delta=30, msg="the rated 500 deg/s on the way to 180")
        self.assertIn("rpm(S1)", r["waveforms"]["signals"]); self.assertIn("torque(S1)", r["waveforms"]["signals"])

    def test_servo_droops_under_a_constant_torque(self):
        s = reading(w.simulate({"circuit": self.servo(1.5, 60), "sim": {"stopSeconds": 0.4, "stepSeconds": 0.0005}}), "S1")
        self.assertTrue(80 < s["angleDeg"] < 90, s)  # a proportional loop holds a third of the stall torque with a few degrees of error
        self.assertGreater(s["ampsFinal"], 0.15)
        self.assertLess(abs(s["targetDeg"] - s["angleDeg"]), 6)

    def test_stepper_turns_one_step_per_pulse_and_reverses(self):
        r = w.simulate({"circuit": self.stepper(100), "sim": {"stopSeconds": 0.6, "stepSeconds": 0.0005}})
        m, d = reading(r, "M1"), reading(r, "U1")
        self.assertAlmostEqual(d["stepsFinal"], 60, delta=0.05, msg="60 rising edges in 0.6 s")
        self.assertAlmostEqual(m["angleDeg"], 108, delta=0.6, msg="60 full steps of 1.8 degrees")
        self.assertAlmostEqual(m["phaseAmpsFinal"], 1.7, delta=0.06)
        self.assertFalse(m["slipped"]); self.assertTrue(m["holding"])
        self.assertAlmostEqual(r["waveforms"]["signals"]["angle(M1)"][1000], 90, delta=0.6, msg="50 steps at 0.5 s")
        self.assertEqual(r["warnings"], [])
        back = reading(w.simulate({"circuit": self.stepper(100, dir_volts=0), "sim": {"stopSeconds": 0.3, "stepSeconds": 0.0005}}), "M1")
        self.assertAlmostEqual(back["angleDeg"], -54, delta=0.6, msg="dir low steps the other way")

    def test_stepper_holds_a_load_at_the_textbook_load_angle_and_slips_above_pull_out(self):
        # Km = 400 mN*m / (sqrt(2) * 1.7 A); sine / cosine drive at 1.7 A gives 283 mN*m; a 100 mN*m weight
        # sits at asin(100 / 283) = 20.7 degrees electrical = 0.41 degrees on a 50-pole-pair rotor
        m = reading(w.simulate({"circuit": self.stepper(100, 100), "sim": {"stopSeconds": 0.6, "stepSeconds": 0.0005}}), "M1")
        self.assertFalse(m["slipped"], m); self.assertTrue(m["holding"])
        self.assertAlmostEqual(m["loadAngleDeg"], 0.41, delta=0.3, msg=str(m))
        self.assertAlmostEqual(m["angleDeg"], 108 - 0.41, delta=0.8)
        r = w.simulate({"circuit": self.stepper(100, 400), "sim": {"stopSeconds": 0.3, "stepSeconds": 0.0005}})
        m = reading(r, "M1")
        self.assertTrue(m["slipped"], m); self.assertFalse(m["holding"])
        self.assertLess(m["angleDeg"], 40, "the weight wins")
        self.assertIn("stepper_slipped", [x["code"] for x in r["warnings"]])

    def test_motor_holds_a_lifted_weight_and_a_wire_route_is_accepted(self):
        circuit = copy.deepcopy(GEARBOX_CIRCUIT)
        # the 3:1 output turns backwards (one external mesh), so a weight it LIFTS pulls in its positive direction: -60 mN*m
        next(p for p in circuit["parts"] if p["id"] == "L1")["props"]["torqueMnm"] = -60  # 20 mN*m against the motor
        circuit["wires"][0]["route"] = {"mid": 180}
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0005}})
        m = reading(r, "M1")
        free = reading(w.simulate({"circuit": GEARBOX_CIRCUIT, "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0005}}), "M1")
        self.assertLess(m["rpmFinal"], free["rpmFinal"] - 50, "lifting the weight slows the motor")
        self.assertAlmostEqual(m["torqueMnmFinal"] - free["torqueMnmFinal"], 20, delta=3, msg="the reflected weight is 60 / 3 mN*m")
        self.assertFalse(m["stalled"])
        self.assertAlmostEqual(m["reflected"]["torque"], 0.02, delta=1e-6, msg="the weight reflects through the signed ratio")
        lowering = copy.deepcopy(circuit)
        next(p for p in lowering["parts"] if p["id"] == "L1")["props"]["torqueMnm"] = 60
        self.assertGreater(reading(w.simulate({"circuit": lowering, "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0005}}), "M1")["rpmFinal"], free["rpmFinal"] + 50, "the same weight the other way is lowered: it drives the motor")
        self.assertIn("angle(M1)", r["waveforms"]["signals"])
        with self.assertRaises(cp.Refusal) as ctx:
            cp.validate_circuit({"parts": [{"id": "R1", "type": "resistor"}, {"id": "R2", "type": "resistor"}], "wires": [dict(wire("w", "R1", "a", "R2", "a"), route={"mid": "x"})]})
        self.assertEqual(ctx.exception.field, "wires[0].route.mid")

    def test_contract_has_the_three_new_types(self):
        self.assertEqual(cp.PART_TYPES[-7:], ("servo", "stepper", "stepdriver", "spring", "pulley", "crank", "arduino"))
        self.assertEqual(cp.DRIVER_TYPES, ("motor", "servo", "stepper"))
        parts, wires = cp.validate_circuit({"parts": [{"id": "M1", "type": "stepper"}, {"id": "S1", "type": "servo"}, {"id": "G1", "type": "gear"}], "wires": [wire("a", "M1", "shaft", "G1", "shaft"), wire("b", "G1", "shaft", "S1", "shaft")]})
        with self.assertRaisesRegex(cp.Refusal, "one motor per train"):
            cp.solve_mechanism(parts, wires)


class NonRigid(unittest.TestCase):
    MOTOR = [{"id": "B1", "type": "battery", "props": {"volts": 12, "internalOhms": 0}}, {"id": "M1", "type": "motor"}]
    POWER = [wire("p", "B1", "+", "M1", "+"), wire("q", "M1", "-", "GND", "gnd"), wire("r", "B1", "-", "GND", "gnd")]

    @staticmethod
    def crossings(values, start):
        mean = sum(values[start:]) / len(values[start:])
        return sum(1 for i in range(start + 1, len(values)) if (values[i - 1] - mean) * (values[i] - mean) < 0)

    def test_spring_and_load_ring_at_the_textbook_frequency(self):
        # a heavy flywheel on the motor (so the drive side barely moves), a 5 mN*m/deg spring, a 50 g*cm2 load:
        # f = sqrt(k / J) / 2 pi = sqrt(0.2865 / 5e-6) / 2 pi = 38 Hz
        parts = self.MOTOR + [{"id": "W0", "type": "load", "props": {"inertiaGcm2": 1e5, "viscousMnmPerKrpm": 0}}, {"id": "K1", "type": "spring", "props": {"stiffnessMnmPerDeg": 5, "dampingMnmPerKrpm": 1}},
                              {"id": "L1", "type": "load", "props": {"inertiaGcm2": 50, "viscousMnmPerKrpm": 0}}]
        wires = self.POWER + [wire("a", "M1", "shaft", "W0", "shaft"), wire("b", "M1", "shaft", "K1", "a"), wire("c", "K1", "b", "L1", "shaft")]
        r = w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 0.5, "stepSeconds": 0.0002}})
        twist = r["waveforms"]["signals"]["twist(K1)"]
        start = int(0.2 / 0.0002)
        freq = self.crossings(twist, start) / 2 / 0.3
        expected = math.sqrt(5e-3 * 180 / math.pi / 5e-6) / (2 * math.pi)
        self.assertAlmostEqual(freq, expected, delta=0.08 * expected, msg=f"{freq} Hz vs {expected} Hz")
        k = reading(r, "K1")
        self.assertGreater(k["twistDegPeak"], 0.01); self.assertIn("torque(K1)", r["waveforms"]["signals"])
        self.assertEqual(reading(r, "L1")["shaft"], "shaft:K1.b")
        self.assertIn("rpm(shaft:K1.b)", r["waveforms"]["signals"]); self.assertIn("angle(shaft:K1.b)", r["waveforms"]["signals"])
        self.assertEqual([x["code"] for x in r["warnings"]], [])

    def test_belt_turns_the_second_pulley_at_the_radius_ratio_and_slips_at_the_grip(self):
        def build(friction):
            # grip 4 N: the belt hands the motor at most 80 mN*m (less than half its 183 mN*m stall torque)
            parts = self.MOTOR + [{"id": "P1", "type": "pulley", "props": {"radiusMm": 20, "gripN": 4}}, {"id": "P2", "type": "pulley", "props": {"radiusMm": 40, "gripN": 4}},
                                  {"id": "L1", "type": "load", "props": {"inertiaGcm2": 20, "frictionMnm": friction, "viscousMnmPerKrpm": 0}}]
            wires = self.POWER + [wire("a", "M1", "shaft", "P1", "shaft"), wire("b", "P1", "belt", "P2", "belt"), wire("c", "P2", "shaft", "L1", "shaft")]
            return gnd_circuit(parts, wires)
        r = w.simulate({"circuit": build(0), "sim": {"stopSeconds": 0.4, "stepSeconds": 0.0004}})
        m, p2 = reading(r, "M1"), reading(r, "P2")
        self.assertAlmostEqual(p2["rpmFinal"] / m["rpmFinal"], 0.5, delta=0.02, msg="omega2 / omega1 = r1 / r2, the belt creeping a little")
        self.assertFalse(p2["slipping"]); self.assertLess(p2["slipPercent"], 3)
        self.assertEqual(p2["belt"], "b")
        # 300 mN*m of friction on the load: the belt can hand over at most grip * r2 = 160 mN*m, so it slips and the load creeps
        r = w.simulate({"circuit": build(300), "sim": {"stopSeconds": 0.4, "stepSeconds": 0.0004}})
        p2 = reading(r, "P2")
        self.assertTrue(p2["slipping"], p2); self.assertLess(abs(p2["rpmFinal"]), 30); self.assertGreater(p2["slipPercent"], 90)
        self.assertAlmostEqual(abs(p2["beltForceNFinal"]), 4, delta=0.5, msg="the belt force sits at the grip")
        self.assertGreater(reading(r, "M1")["rpmFinal"], 1000, "the motor keeps turning under the slipping belt")

    def test_crank_slider_follows_the_exact_kinematics_with_a_stroke_of_two_radii(self):
        parts = self.MOTOR + [{"id": "C1", "type": "crank", "props": {"radiusMm": 20, "rodMm": 80, "sliderMassG": 100, "dampingNsPerM": 0.5}}]
        wires = self.POWER + [wire("a", "M1", "shaft", "C1", "shaft")]
        r = w.simulate({"circuit": gnd_circuit(parts, wires), "sim": {"stopSeconds": 0.2, "stepSeconds": 0.0001}})
        sg = r["waveforms"]["signals"]
        x, ang = sg["x(C1)"], sg["angle(M1)"]
        worst = max(abs(x[i] - (20 * math.cos(math.radians(ang[i])) + math.sqrt(80 ** 2 - (20 * math.sin(math.radians(ang[i]))) ** 2))) for i in range(0, len(x), 7))
        self.assertLess(worst, 0.05, f"slider position off the crank formula by {worst} mm")
        c = reading(r, "C1")
        self.assertAlmostEqual(c["sliderXmmMax"] - c["sliderXmmMin"], 40, delta=0.5, msg="stroke = 2 r")
        self.assertEqual(c["strokeMm"], 40)
        self.assertGreater(ang[-1], 720, "the crank turned more than two revolutions in 0.2 s")
        free = reading(w.simulate({"circuit": gnd_circuit(self.MOTOR, self.POWER), "sim": {"stopSeconds": 0.2, "stepSeconds": 0.0001}}), "M1")
        self.assertLess(reading(r, "M1")["rpmFinal"], free["rpmFinal"], "the damper on the slider loads the motor")
        self.assertGreater(reading(r, "M1")["torqueMnmFinal"], 0)

    def test_shapes_the_solver_refuses(self):
        shorted = {"parts": [{"id": "M1", "type": "motor"}, {"id": "K1", "type": "spring"}], "wires": [wire("a", "M1", "shaft", "K1", "a"), wire("b", "M1", "shaft", "K1", "b")]}
        two_cranks = {"parts": [{"id": "M1", "type": "motor"}, {"id": "C1", "type": "crank"}, {"id": "C2", "type": "crank"}], "wires": [wire("a", "M1", "shaft", "C1", "shaft"), wire("b", "M1", "shaft", "C2", "shaft")]}
        belt_short = {"parts": [{"id": "M1", "type": "motor"}, {"id": "P1", "type": "pulley"}, {"id": "P2", "type": "pulley"}], "wires": [wire("a", "M1", "shaft", "P1", "shaft"), wire("b", "M1", "shaft", "P2", "shaft"), wire("c", "P1", "belt", "P2", "belt")]}
        for circuit, pattern in ((shorted, "shorted by a rigid path"), (two_cranks, "one crank per train"), (belt_short, "shorted by a rigid path")):
            parts, wires = cp.validate_circuit(circuit)
            with self.assertRaisesRegex(cp.Refusal, pattern):
                cp.solve_mechanism(parts, wires)
        with self.assertRaises(cp.Refusal) as ctx:
            cp.validate_circuit({"parts": [{"id": "P1", "type": "pulley"}, {"id": "G1", "type": "gear"}], "wires": [wire("w", "P1", "belt", "G1", "teeth")]})
        self.assertEqual(ctx.exception.field, "wires[0]", "a belt pin does not mesh with teeth")


class Firmware(unittest.TestCase):
    BLINK = "void setup() { pinMode(13, OUTPUT); Serial.begin(9600); Serial.println(\"blink\"); }\nvoid loop() { digitalWrite(13, HIGH); delay(200); digitalWrite(13, LOW); delay(300); }\n"

    @staticmethod
    def uno(sketch, extra_parts, extra_wires):
        parts = [{"id": "MCU1", "type": "arduino", "props": {"sketch": sketch}}] + extra_parts
        wires = [wire("g", "MCU1", "GND", "GND", "gnd")] + extra_wires
        return gnd_circuit(parts, wires)

    def test_blink_toggles_the_led_at_the_sketch_period(self):
        circuit = self.uno(self.BLINK, [{"id": "R1", "type": "resistor", "props": {"ohms": 220}}, {"id": "D1", "type": "led"}],
                           [wire("a", "MCU1", "D13", "R1", "a"), wire("b", "R1", "b", "D1", "a"), wire("c", "D1", "k", "GND", "gnd")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 1.5, "stepSeconds": 0.0005}})
        i = r["waveforms"]["signals"]["i(D1)"]
        rises = [k for k in range(1, len(i)) if i[k - 1] < 0.005 <= i[k]]
        self.assertGreaterEqual(len(rises), 2, "at least two rising edges in 1.5 s")
        period = (rises[1] - rises[0]) * 0.0005
        self.assertAlmostEqual(period, 0.5, delta=0.005, msg=f"period {period} s: 200 ms on + 300 ms off")
        on = sum(1 for v in i[rises[0]:rises[1]] if v > 0.005) / (rises[1] - rises[0])
        self.assertAlmostEqual(on, 0.4, delta=0.03, msg="on 40 % of the period")
        self.assertTrue(0.010 < max(i) < 0.016, f"{max(i)} A through 220 ohm from 5 V minus the LED drop and 25 ohm")
        m = reading(r, "MCU1")
        self.assertTrue(m["compiled"]); self.assertEqual(m["pinsDriven"], ["D13"]); self.assertIn("blink", m["serial"]); self.assertGreater(m["flashBytes"], 500)
        self.assertAlmostEqual(m["simulatedSeconds"], 1.5, delta=0.01)
        self.assertNotIn("unconnected_pin", [x["code"] for x in r["warnings"]], "the Uno's spare headers are not a fault")

    def test_analogwrite_pwm_averages_to_its_duty(self):
        sketch = "void setup() { pinMode(9, OUTPUT); analogWrite(9, 64); }\nvoid loop() {}\n"
        circuit = self.uno(sketch, [{"id": "R1", "type": "resistor", "props": {"ohms": 10000}}, {"id": "C1", "type": "capacitor", "props": {"farads": 10e-6}}],
                           [wire("a", "MCU1", "D9", "R1", "a"), wire("b", "R1", "b", "C1", "a"), wire("c", "C1", "b", "GND", "gnd")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.8, "stepSeconds": 0.0002}})
        vc = r["waveforms"]["signals"]["v(" + r["netOfPin"]["C1.a"] + ")"]
        self.assertAlmostEqual(sum(vc[-400:]) / 400, 5 * 64 / 255, delta=0.15, msg="the RC average is the duty: 64/255 of 5 V")
        m = reading(r, "MCU1")
        self.assertEqual(m["pinsDriven"], ["D9"]); self.assertGreater(m["edges"], 700, "490 Hz for 0.8 s")

    def test_a_sketch_that_does_not_compile_is_refused_naming_it(self):
        circuit = self.uno("void setup() { pinMode(13, OUTPUT) }\nvoid loop() {}\n", [], [])
        with self.assertRaises(cp.Refusal) as ctx:
            w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.1}})
        self.assertEqual(ctx.exception.field, "parts[0].props.sketch")
        self.assertIn("expected", str(ctx.exception))
        long_run = self.uno("void setup() {}\nvoid loop() {}\n", [], [])
        r = w.simulate({"circuit": long_run, "sim": {"stopSeconds": 12, "stepSeconds": 0.01}})
        self.assertIn("firmware_truncated", [x["code"] for x in r["warnings"]])
        self.assertEqual(reading(r, "MCU1")["pinsDriven"], [])


if __name__ == "__main__":
    unittest.main()


class Cosim(unittest.TestCase):
    """BACKLOG B1's input half: the sketch and the transient step together, so digitalRead and
    analogRead see the solver's node voltages. Every case here needs libngspice in the image."""

    BUTTON = ("void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }\n"
              "void loop() { digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW); }\n")
    POT = ("void setup() { Serial.begin(9600); pinMode(9, OUTPUT); }\n"
           "void loop() { int v = analogRead(A0); analogWrite(9, v / 4); Serial.println(v); delay(20); }\n")

    def setUp(self):
        if not fw.cosim_available():
            self.skipTest("this engine image has no libngspice or no AVR toolchain")

    def test_a_button_the_sketch_polls_changes_what_it_drives(self):
        """The switch closes at 20 ms; nothing in the sketch knows the time, so the LED can only
        light because digitalRead saw the node the switch pulled down."""
        circuit = Firmware.uno(self.BUTTON, [
            {"id": "S1", "type": "switch", "props": {"closed": False, "toggleAtSeconds": 0.02}},
            {"id": "R1", "type": "resistor", "props": {"ohms": 220}}, {"id": "D1", "type": "led"}], [
            wire("s", "MCU1", "D2", "S1", "a"), wire("sg", "S1", "b", "GND", "gnd"),
            wire("a", "MCU1", "D13", "R1", "a"), wire("b", "R1", "b", "D1", "a"), wire("c", "D1", "k", "GND", "gnd")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.04, "stepSeconds": 2e-5, "syncSeconds": 1e-4}})
        i, t = r["waveforms"]["signals"]["i(D1)"], r["waveforms"]["time"]
        before = max(i[k] for k in range(len(t)) if 0.001 < t[k] < 0.018)
        after = min(i[k] for k in range(len(t)) if t[k] > 0.025)
        self.assertLess(before, 1e-4, "the button is open: the sketch must hold D13 low")
        self.assertGreater(after, 0.005, "the button is closed: the sketch must drive D13 high")
        m = reading(r, "MCU1")
        self.assertTrue(m["closedLoop"]); self.assertEqual(m["readsPins"], ["D2"]); self.assertEqual(m["syncSeconds"], 1e-4)
        self.assertGreater(m["coSimSlices"], 300, "0.04 s at a 0.1 ms sync step")
        self.assertEqual([x["code"] for x in r["warnings"] if x["code"].startswith("cosim")], [])

    def test_a_potentiometer_the_sketch_reads_sets_the_duty(self):
        """The wiper sits at a quarter of 5 V; analogRead must report about 256 and the PWM it writes
        must average to that duty through the RC."""
        circuit = Firmware.uno(self.POT, [
            {"id": "P1", "type": "potentiometer", "props": {"ohms": 10000, "position": 0.25}},
            {"id": "B1", "type": "battery", "props": {"volts": 5, "internalOhms": 0.1}},
            {"id": "R1", "type": "resistor", "props": {"ohms": 10000}}, {"id": "C1", "type": "capacitor", "props": {"farads": 10e-6}}], [
            wire("p", "MCU1", "A0", "P1", "w"), wire("pa", "P1", "a", "B1", "+"), wire("pb", "P1", "b", "GND", "gnd"),
            wire("bg", "B1", "-", "GND", "gnd"),
            wire("a", "MCU1", "D9", "R1", "a"), wire("b", "R1", "b", "C1", "a"), wire("c", "C1", "b", "GND", "gnd")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.6, "stepSeconds": 2e-4, "syncSeconds": 2e-4}})
        m = reading(r, "MCU1")
        self.assertTrue(m["closedLoop"]); self.assertEqual(m["readsPins"], ["A0"]); self.assertGreater(m["analogReads"]["A0"], 10)
        counts = [int(x) for x in re.findall(r"\d+", m["serial"])]
        self.assertTrue(counts, "the sketch prints every reading")
        wiper = r["readings"] and [x for x in r["readings"] if x["id"] == "P1"][0]["wiperVoltsFinal"]
        self.assertAlmostEqual(counts[-1], round(1023 * wiper / 5), delta=25, msg=f"the sketch must read the wiper the solver put at {wiper:.2f} V, got {counts[-1]} counts")
        vc = r["waveforms"]["signals"]["v(" + r["netOfPin"]["C1.a"] + ")"]
        self.assertAlmostEqual(sum(vc[-500:]) / 500, 5 * (counts[-1] // 4) / 255, delta=0.25, msg="the RC average is the duty the sketch wrote from what it read")

    def test_a_pin_nothing_drives_is_not_feedback(self):
        """A sketch may read a pin no wire reaches. There is nothing to co-simulate, the run stays
        open-loop and says so, and the pin reads its own pull-up, as it does on a real board."""
        circuit = Firmware.uno(self.BUTTON, [{"id": "R1", "type": "resistor", "props": {"ohms": 220}}, {"id": "D1", "type": "led"}],
                               [wire("a", "MCU1", "D13", "R1", "a"), wire("b", "R1", "b", "D1", "a"), wire("c", "D1", "k", "GND", "gnd")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.02, "stepSeconds": 2e-5}})
        m = reading(r, "MCU1")
        self.assertNotIn("closedLoop", m, "nothing drives D2, so there is no loop to close")
        self.assertEqual([x["code"] for x in r["warnings"] if x["code"].startswith("cosim")], [])
        self.assertLess(max(r["waveforms"]["signals"]["i(D1)"]), 1e-4, "the pull-up reads HIGH, so the sketch holds D13 low")

    def test_a_sync_step_the_engine_refuses(self):
        """The step the two halves agree on is bounded at both ends: too short and a slice cannot hold
        a read, too long and it aliases the sketch's own sampling."""
        circuit = Firmware.uno(self.BUTTON, [{"id": "S1", "type": "switch", "props": {"closed": False, "toggleAtSeconds": 0.01}}],
                               [wire("s", "MCU1", "D2", "S1", "a"), wire("sg", "S1", "b", "GND", "gnd")])
        for sync, why in ((1e-7, "too short"), (0.05, "too long")):
            with self.assertRaises(cp.Refusal, msg=why) as ctx:
                w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.02, "stepSeconds": 2e-5, "syncSeconds": sync}})
            self.assertEqual(ctx.exception.field, "sim.syncSeconds")
        with self.assertRaises(cp.Refusal) as ctx:  # inside the limits, but not a quarter of the run
            w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.004, "stepSeconds": 2e-5, "syncSeconds": 0.002}})
        self.assertEqual(ctx.exception.field, "sim.syncSeconds")
        self.assertIn("quarter", str(ctx.exception))

    def test_two_boards_are_refused_rather_than_half_looped(self):
        """One slicer holds one AVR. A second board would run open-loop beside a closed one, which
        would read like a closed loop and would not be one."""
        circuit = Firmware.uno(self.BUTTON, [
            {"id": "MCU2", "type": "arduino", "props": {"sketch": Firmware.BLINK}},
            {"id": "S1", "type": "switch", "props": {"closed": False, "toggleAtSeconds": 0.01}}], [
            wire("s", "MCU1", "D2", "S1", "a"), wire("sg", "S1", "b", "GND", "gnd"), wire("g2", "MCU2", "GND", "GND", "gnd")])
        with self.assertRaises(cp.Refusal) as ctx:
            w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.02, "stepSeconds": 2e-5, "syncSeconds": 1e-4}})
        self.assertEqual(ctx.exception.field, "circuit")
        self.assertIn("one board at a time", str(ctx.exception))

    def test_a_loop_the_delay_itself_drives_is_named(self):
        """An inverter wired back to its own input cannot settle: what it oscillates at is the
        co-simulation's step, not the circuit. The run still finishes and the warning says which pin."""
        sketch = ("void setup() { pinMode(2, INPUT); pinMode(13, OUTPUT); }\n"
                  "void loop() { digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW); }\n")
        circuit = Firmware.uno(sketch, [{"id": "R1", "type": "resistor", "props": {"ohms": 1000}}],
                               [wire("a", "MCU1", "D13", "R1", "a"), wire("b", "R1", "b", "MCU1", "D2")])
        r = w.simulate({"circuit": circuit, "sim": {"stopSeconds": 0.02, "stepSeconds": 2e-5, "syncSeconds": 1e-4}})
        chatter = [x for x in r["warnings"] if x["code"] == "cosim_chatter"]
        self.assertTrue(chatter, f"expected cosim_chatter, got {[x['code'] for x in r['warnings']]}")
        self.assertIn("D13", chatter[0]["message"])
        self.assertTrue(reading(r, "MCU1")["closedLoop"], "the run still completes -- the warning is the answer, not a refusal")
