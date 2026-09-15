#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the part library (the
#   |                                           | contract: every part type, its pins and their
#   |                                           | kinds, every property with unit, default and
#   |                                           | range), the circuit validator that names the
#   |                                           | field it refuses, the electrical net resolver
#   |                                           | (union-find over wires, ground = node 0, an
#   |                                           | unreferenced battery minus becomes the reference
#   |                                           | with a warning), and the mechanism solver: shaft
#   |                                           | groups, gear meshes as signed ratios, every
#   |                                           | driven shaft's ratio to its motor, and the
#   |                                           | inertia / viscous / coulomb loads reflected to
#   |                                           | the motor shaft so the whole train is one
#   |                                           | rotational node in the SPICE solve. Mirrored by
#   |                                           | src-routes/circuit-contract.ts; a spec keeps the
#   |                                           | two libraries equal.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | Eight more parts (zener, lamp, regulator, op-amp,
#   |                                           | relay, sequenced pin, H-bridge driver, 555 timer),
#   |                                           | a `text` property type (the sequencer's pattern,
#   |                                           | bounded by length and a regex the Node side shares),
#   |                                           | and the gear's face width / bore / pressure angle
#   |                                           | for the CAD Studio hand-off.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | A hobby servo, a bipolar stepper and a step/dir
#   |                                           | driver as contract parts; a load's constant torque
#   |                                           | (a lifted weight) reflected with its sign; any of
#   |                                           | motor / servo / stepper drives a shaft train (one
#   |                                           | driver per train); a wire may carry a `route`
#   |                                           | (where its middle segment sits) that the solver
#   |                                           | ignores.
# 5 | maintainer@emeraldcoastsystemsgroup.com   | The Arduino Uno as a part (20 header pins, a
#   |                                           | `sketch` text property); its GND can be the 0 V
#   |                                           | reference and its spare headers are not warned.
# 4 | maintainer@emeraldcoastsystemsgroup.com   | Non-rigid mechanics in the same solve: a torsional
#   |                                           | spring between two shafts, pulleys joined by a belt
#   |                                           | that slips (a `belt` pin kind), and a crank-slider
#   |                                           | (crank, rod, slider mass, damper, spring, friction)
#   |                                           | on a shaft. The mechanism is now CLUSTERS of rigid
#   |                                           | shaft groups (meshes = rigid ratios, reflected as
#   |                                           | before) joined by compliant LINKS (springs, belts),
#   |                                           | each cluster one rotational node; a cluster with a
#   |                                           | crank carries position-dependent inertia.
# 6 | maintainer@emeraldcoastsystemsgroup.com   | sim.syncSeconds -- the firmware co-simulation step -- is
#   |                                           | validated and bounded here so the refusal names the field.
# 7 | maintainer@emeraldcoastsystemsgroup.com   | A wire's route may be several bend points (route.points,
#   |                                           | at most MAX_ROUTE_POINTS) instead of one middle segment;
#   |                                           | drawing only, refused with the field named.
# 8 | maintainer@emeraldcoastsystemsgroup.com   | The solver knobs (BACKLOG B7): sim.reltol, sim.gmin and
#   |                                           | sim.method bounded here; the deck's .option line (the
#   |                                           | lab defaults, the person's knobs, or the relaxed retry
#   |                                           | set) is derived from the validated sim in one place.
"""circuit_parts -- the contract and the mechanism, stdlib only."""
import math
import re

ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,23}$")
MAX_PARTS = 200
MAX_WIRES = 400
MAX_ROUTE_POINTS = 16
ROTATIONS = (0, 90, 180, 270)


def _num(unit, default, lo, hi, optional=False):
    d = {"type": "number", "unit": unit, "default": default, "min": lo, "max": hi}
    if optional:
        d["optional"] = True
    return d


def _enum(values, default):
    return {"type": "enum", "values": list(values), "default": default}


def _bool(default):
    return {"type": "boolean", "default": default}


def _text(default, max_len, pattern):
    return {"type": "text", "default": default, "maxLength": max_len, "pattern": pattern}


#: One token per step: level (0..1, a fraction of highVolts) : seconds. Shared with the Node contract.
SEQUENCE_PATTERN = r"^\s*(?:(?:0|1|0?\.\d+):\d*\.?\d+(?:[eE]-?\d+)?\s*)+$"
SEQUENCE_MAX_STEPS = 64
#: An Arduino sketch: any text up to the cap (the compiler judges it). Shared with the Node contract.
SKETCH_PATTERN = r"^[\s\S]*$"
SKETCH_MAX_CHARS = 8000
DEFAULT_SKETCH = "void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n"


def _pins(*names):
    return [{"name": n, "kind": "electrical"} for n in names]


#: The contract. Keys, pins, property names, units, defaults and ranges are the ones the api
#: publishes and validates; the worker below computes from exactly these.
PART_LIBRARY = {
    "ground": {"category": "electrical", "label": "Ground", "pins": _pins("gnd"), "props": {}},
    "junction": {"category": "electrical", "label": "Junction", "pins": _pins("n"), "props": {}},
    "battery": {"category": "electrical", "label": "Battery", "pins": _pins("+", "-"), "props": {
        "volts": _num("V", 9, 0.1, 1000), "internalOhms": _num("ohm", 0.5, 0, 1e6), "capacityMah": _num("mAh", 500, 1, 1e6)}},
    "source": {"category": "electrical", "label": "Signal source", "pins": _pins("+", "-"), "props": {
        "kind": _enum(("dc", "pulse", "sine"), "pulse"), "volts": _num("V", 5, 0, 1000), "offsetVolts": _num("V", 0, -1000, 1000),
        "frequencyHz": _num("Hz", 1000, 0.001, 1e7), "dutyPercent": _num("%", 50, 0, 100)}},
    "resistor": {"category": "electrical", "label": "Resistor", "pins": _pins("a", "b"), "props": {
        "ohms": _num("ohm", 220, 0.001, 1e9), "ratedWatts": _num("W", 0.25, 0.001, 1e4)}},
    "potentiometer": {"category": "electrical", "label": "Potentiometer", "pins": _pins("a", "w", "b"), "props": {
        "ohms": _num("ohm", 10000, 1, 1e9), "position": _num("fraction", 0.5, 0, 1)}},
    "capacitor": {"category": "electrical", "label": "Capacitor", "pins": _pins("a", "b"), "props": {
        "farads": _num("F", 100e-6, 1e-12, 10), "ratedVolts": _num("V", 25, 1, 1e4)}},
    "inductor": {"category": "electrical", "label": "Inductor", "pins": _pins("a", "b"), "props": {
        "henries": _num("H", 0.001, 1e-9, 100)}},
    "diode": {"category": "electrical", "label": "Diode", "pins": _pins("a", "k"), "props": {}},
    "led": {"category": "electrical", "label": "LED", "pins": _pins("a", "k"), "props": {
        "color": _enum(("red", "yellow", "green", "blue", "white"), "red"), "maxMa": _num("mA", 20, 0.1, 1000)}},
    "switch": {"category": "electrical", "label": "Switch", "pins": _pins("a", "b"), "props": {
        "closed": _bool(True), "toggleAtSeconds": _num("s", None, 0, 1e4, optional=True)}},
    "npn": {"category": "electrical", "label": "NPN transistor", "pins": _pins("c", "b", "e"), "props": {}},
    "nmos": {"category": "electrical", "label": "N-channel MOSFET", "pins": _pins("d", "g", "s"), "props": {}},
    "motor": {"category": "electromechanical", "label": "DC motor", "pins": _pins("+", "-") + [{"name": "shaft", "kind": "shaft"}], "props": {
        "nominalVolts": _num("V", 12, 0.1, 1000), "stallAmps": _num("A", 5, 0.001, 1000), "noLoadRpm": _num("rpm", 3000, 1, 100000),
        "noLoadAmps": _num("A", 0.2, 0, 1000), "inductanceMh": _num("mH", 1, 0.001, 1000), "rotorInertiaGcm2": _num("g*cm2", 10, 0.001, 1e6)}},
    "gear": {"category": "mechanical", "label": "Gear", "pins": [{"name": "shaft", "kind": "shaft"}, {"name": "teeth", "kind": "teeth"}], "props": {
        "teeth": _num("count", 20, 6, 400), "moduleMm": _num("mm", 1, 0.2, 20), "inertiaGcm2": _num("g*cm2", 5, 0, 1e6),
        "faceWidthMm": _num("mm", 8, 1, 200), "boreMm": _num("mm", 3, 0, 100), "pressureAngleDeg": _num("deg", 20, 14.5, 25)}},
    "load": {"category": "mechanical", "label": "Load", "pins": [{"name": "shaft", "kind": "shaft"}], "props": {
        "inertiaGcm2": _num("g*cm2", 50, 0, 1e7), "frictionMnm": _num("mN*m", 0, 0, 1e5), "viscousMnmPerKrpm": _num("mN*m/krpm", 0.1, 0, 1e5),
        "torqueMnm": _num("mN*m", 0, -1e5, 1e5)}},
    "zener": {"category": "electrical", "label": "Zener diode", "pins": _pins("a", "k"), "props": {"breakdownVolts": _num("V", 5.1, 1, 200)}},
    "lamp": {"category": "electrical", "label": "Lamp", "pins": _pins("a", "b"), "props": {"ratedVolts": _num("V", 12, 0.1, 1000), "ratedWatts": _num("W", 5, 0.01, 1e4)}},
    "regulator": {"category": "electrical", "label": "Voltage regulator", "pins": _pins("in", "gnd", "out"), "props": {
        "outputVolts": _num("V", 5, 1, 50), "dropoutVolts": _num("V", 2, 0, 5), "maxAmps": _num("A", 1, 0.01, 20)}},
    "opamp": {"category": "electrical", "label": "Op-amp", "pins": _pins("+", "-", "out", "vcc", "vee"), "props": {
        "gain": _num("V/V", 100000, 10, 1e7), "railDropVolts": _num("V", 1, 0, 5)}},
    "relay": {"category": "electrical", "label": "Relay", "pins": _pins("c+", "c-", "com", "no", "nc"), "props": {
        "coilOhms": _num("ohm", 100, 1, 1e5), "coilMh": _num("mH", 10, 0.001, 1e4), "pullInAmps": _num("A", 0.03, 1e-4, 10)}},
    "sequencer": {"category": "electrical", "label": "Sequenced pin", "pins": _pins("out", "ref"), "props": {
        "highVolts": _num("V", 5, 0, 1000), "pattern": _text("1:0.5 0:0.5", 400, SEQUENCE_PATTERN), "repeat": _bool(True)}},
    "hbridge": {"category": "electrical", "label": "H-bridge driver", "pins": _pins("vcc", "gnd", "in1", "in2", "out1", "out2"), "props": {
        "thresholdVolts": _num("V", 2.5, 0.1, 100), "onOhms": _num("ohm", 0.2, 0.001, 100)}},
    "timer555": {"category": "electrical", "label": "555 timer", "pins": _pins("vcc", "gnd", "trig", "thr", "out", "dis"), "props": {}},
    "servo": {"category": "electromechanical", "label": "Hobby servo", "pins": _pins("sig", "v+", "gnd") + [{"name": "shaft", "kind": "shaft"}], "props": {
        "nominalVolts": _num("V", 5, 3, 12), "stallAmps": _num("A", 0.7, 0.01, 20), "runAmps": _num("A", 0.2, 0, 10), "stallTorqueMnm": _num("mN*m", 180, 1, 1e5),
        "noLoadDegPerS": _num("deg/s", 500, 10, 5000), "travelDeg": _num("deg", 180, 10, 360), "minPulseMs": _num("ms", 1.0, 0.3, 3), "maxPulseMs": _num("ms", 2.0, 0.5, 4),
        "idleAmps": _num("A", 0.01, 0, 1), "rotorInertiaGcm2": _num("g*cm2", 500, 0.001, 1e6)}},
    "stepper": {"category": "electromechanical", "label": "Stepper motor", "pins": _pins("a+", "a-", "b+", "b-") + [{"name": "shaft", "kind": "shaft"}], "props": {
        "stepsPerRev": _num("count", 200, 4, 3200), "phaseOhms": _num("ohm", 2, 0.01, 1000), "phaseMh": _num("mH", 3, 0.001, 1000), "ratedAmps": _num("A", 1.7, 0.01, 50),
        "holdingTorqueMnm": _num("mN*m", 400, 0.1, 1e5), "detentTorqueMnm": _num("mN*m", 20, 0, 1e4), "rotorInertiaGcm2": _num("g*cm2", 54, 0.001, 1e6),
        "dampingRatio": _num("ratio", 0.15, 0.01, 1)}},
    "stepdriver": {"category": "electrical", "label": "Step/dir driver", "pins": _pins("vm", "gnd", "step", "dir", "a+", "a-", "b+", "b-"), "props": {
        "currentAmps": _num("A", 1.0, 0.01, 20), "microsteps": _enum(("1", "2", "4", "8", "16"), "1"), "thresholdVolts": _num("V", 1.5, 0.1, 20)}},
    "spring": {"category": "mechanical", "label": "Torsion spring", "pins": [{"name": "a", "kind": "shaft"}, {"name": "b", "kind": "shaft"}], "props": {
        "stiffnessMnmPerDeg": _num("mN*m/deg", 5, 0.001, 1e5), "dampingMnmPerKrpm": _num("mN*m/krpm", 1, 0, 1e5)}},
    "pulley": {"category": "mechanical", "label": "Pulley", "pins": [{"name": "shaft", "kind": "shaft"}, {"name": "belt", "kind": "belt"}], "props": {
        "radiusMm": _num("mm", 20, 1, 1000), "inertiaGcm2": _num("g*cm2", 5, 0, 1e6), "gripN": _num("N", 10, 0.01, 1e5)}},
    "crank": {"category": "mechanical", "label": "Crank-slider", "pins": [{"name": "shaft", "kind": "shaft"}], "props": {
        "radiusMm": _num("mm", 20, 1, 1000), "rodMm": _num("mm", 80, 2, 5000), "sliderMassG": _num("g", 100, 0.1, 1e5), "dampingNsPerM": _num("N*s/m", 0.5, 0, 1e4),
        "springNPerM": _num("N/m", 0, 0, 1e6), "springRestMm": _num("mm", 100, -5000, 5000), "frictionN": _num("N", 0, 0, 1e4)}},
    "arduino": {"category": "electrical", "label": "Arduino Uno", "pins": _pins("5V", "GND", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "A0", "A1", "A2", "A3", "A4", "A5"), "props": {
        "sketch": _text(DEFAULT_SKETCH, SKETCH_MAX_CHARS, SKETCH_PATTERN)}},
}
PART_TYPES = tuple(PART_LIBRARY.keys())
PIN_KINDS = ("electrical", "shaft", "teeth", "belt")
#: The part types that drive a shaft train (one per train).
DRIVER_TYPES = ("motor", "servo", "stepper")
#: The transient defaults; reltol is the lab's own, gmin and method are ngspice's.
SIM_DEFAULTS = {"stopSeconds": 1.0, "maxPoints": 20000, "defaultPoints": 2000, "startFromRest": True, "reltol": 0.003, "gmin": 1e-12, "method": "trap"}
SIM_LIMITS = {"stopSeconds": (1e-6, 600.0), "stepSeconds": (1e-9, 600.0), "syncSeconds": (4e-6, 10e-3), "reltol": (1e-6, 0.05), "gmin": (1e-15, 1e-6)}
SIM_METHODS = ("trap", "gear")
SOLVER_KNOBS = ("reltol", "gmin", "method")
#: The deck's solver options at the defaults, and the relaxed set of the one automatic retry.
DEFAULT_OPTIONS = ".option rshunt=1e12 reltol=0.003 abstol=1e-9 vntol=1e-6"
RELAXED_OPTIONS = ".option rshunt=1e12 reltol=0.01 abstol=1e-8 vntol=1e-5 gmin=1e-9 method=gear"
GCM2_TO_KGM2 = 1e-7
RPM_TO_RADS = 2 * math.pi / 60


class Refusal(Exception):
    """@description A refused input: `field` names what was wrong."""

    def __init__(self, message, field="circuit"):
        super().__init__(message)
        self.field = field


def contract():
    """@description The library as published JSON (what the api's contract must equal)."""
    return {"parts": PART_LIBRARY, "limits": {"maxParts": MAX_PARTS, "maxWires": MAX_WIRES, "maxRoutePoints": MAX_ROUTE_POINTS, "rotations": list(ROTATIONS), "idPattern": ID_PATTERN.pattern},
            "sim": {"defaults": SIM_DEFAULTS, "limits": {k: list(v) for k, v in SIM_LIMITS.items()}, "methods": list(SIM_METHODS)}}


def pin_kind(part_type, pin):
    for p in PART_LIBRARY[part_type]["pins"]:
        if p["name"] == pin:
            return p["kind"]
    return None


def validate_props(part_type, props, field):
    """@description Normalise one part's properties: defaults filled, ranges enforced, unknown keys refused."""
    schema = PART_LIBRARY[part_type]["props"]
    props = props if isinstance(props, dict) else {}
    for key in props:
        if key not in schema:
            raise Refusal(f"{part_type} has no property {key}", f"{field}.props.{key}")
    out = {}
    for key, spec in schema.items():
        value = props.get(key, spec.get("default"))
        if spec["type"] == "number":
            if value is None:
                if spec.get("optional"):
                    out[key] = None
                    continue
                raise Refusal(f"{key} is required", f"{field}.props.{key}")
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise Refusal(f"{key} must be a number", f"{field}.props.{key}")
            if value < spec["min"] or value > spec["max"]:
                raise Refusal(f"{key} must be between {spec['min']} and {spec['max']} {spec['unit']}", f"{field}.props.{key}")
            out[key] = float(value)
        elif spec["type"] == "enum":
            if value not in spec["values"]:
                raise Refusal(f"{key} must be one of {', '.join(spec['values'])}", f"{field}.props.{key}")
            out[key] = value
        elif spec["type"] == "boolean":
            if not isinstance(value, bool):
                raise Refusal(f"{key} must be true or false", f"{field}.props.{key}")
            out[key] = value
        elif spec["type"] == "text":
            if not isinstance(value, str) or len(value) > spec["maxLength"] or not re.match(spec["pattern"], value):
                raise Refusal(f"{key} must match {spec['pattern']} (at most {spec['maxLength']} characters)", f"{field}.props.{key}")
            if key == "pattern":
                steps = parse_sequence(value)
                if len(steps) > SEQUENCE_MAX_STEPS:
                    raise Refusal(f"pattern has {len(steps)} steps; at most {SEQUENCE_MAX_STEPS}", f"{field}.props.{key}")
                if any(sec <= 0 for _, sec in steps):
                    raise Refusal("every step needs a positive duration", f"{field}.props.{key}")
            out[key] = value
    return out


def parse_sequence(text):
    """@description 'level:seconds …' -> [(level, seconds)] (the contract regex has already shaped it)."""
    out = []
    for token in text.split():
        level, sec = token.split(":", 1)
        out.append((float(level), float(sec)))
    return out


def validate_circuit(circuit):
    """@description Validate and normalise `{parts, wires}`; refuses with the field named.
    @returns (parts, wires) with defaults filled and ids kept."""
    if not isinstance(circuit, dict):
        raise Refusal("circuit must be an object")
    parts_in = circuit.get("parts", [])
    wires_in = circuit.get("wires", [])
    if not isinstance(parts_in, list) or not isinstance(wires_in, list):
        raise Refusal("parts and wires must be lists", "circuit")
    if len(parts_in) > MAX_PARTS:
        raise Refusal(f"at most {MAX_PARTS} parts", "parts")
    if len(wires_in) > MAX_WIRES:
        raise Refusal(f"at most {MAX_WIRES} wires", "wires")
    parts, seen = [], {}
    for i, raw in enumerate(parts_in):
        field = f"parts[{i}]"
        if not isinstance(raw, dict):
            raise Refusal("part must be an object", field)
        pid = raw.get("id")
        if not isinstance(pid, str) or not ID_PATTERN.match(pid):
            raise Refusal("id must be a letter followed by up to 23 letters, digits or underscores", f"{field}.id")
        if pid.lower() in seen:
            raise Refusal(f"duplicate part id {pid} (ids are case-insensitive)", f"{field}.id")
        seen[pid.lower()] = pid
        ptype = raw.get("type")
        if ptype not in PART_LIBRARY:
            raise Refusal(f"unknown part type {ptype!r}", f"{field}.type")
        rotation = raw.get("rotation", 0)
        if rotation not in ROTATIONS:
            raise Refusal("rotation must be 0, 90, 180 or 270", f"{field}.rotation")
        x, y = raw.get("x", 0), raw.get("y", 0)
        for name, v in (("x", x), ("y", y)):
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise Refusal(f"{name} must be a number", f"{field}.{name}")
        label = raw.get("label")
        if label is not None and not isinstance(label, str):
            raise Refusal("label must be text", f"{field}.label")
        parts.append({"id": pid, "type": ptype, "x": float(x), "y": float(y), "rotation": int(rotation),
                      "label": (label or "")[:60], "props": validate_props(ptype, raw.get("props"), field)})
    by_id = {p["id"]: p for p in parts}
    wires, keys = [], set()
    for i, raw in enumerate(wires_in):
        field = f"wires[{i}]"
        if not isinstance(raw, dict):
            raise Refusal("wire must be an object", field)
        wid = raw.get("id")
        if not isinstance(wid, str) or not ID_PATTERN.match(wid):
            raise Refusal("wire id must be a letter followed by up to 23 letters, digits or underscores", f"{field}.id")
        ends = []
        for end in ("from", "to"):
            e = raw.get(end)
            if not isinstance(e, dict) or e.get("part") not in by_id:
                raise Refusal(f"{end}.part must name a part in the circuit", f"{field}.{end}.part")
            kind = pin_kind(by_id[e["part"]]["type"], e.get("pin"))
            if kind is None:
                raise Refusal(f"{by_id[e['part']]['type']} {e['part']} has no pin {e.get('pin')!r}", f"{field}.{end}.pin")
            ends.append((e["part"], e["pin"], kind))
        if ends[0][2] != ends[1][2]:
            raise Refusal(f"a wire joins pins of one kind; {ends[0][0]}.{ends[0][1]} is {ends[0][2]} and {ends[1][0]}.{ends[1][1]} is {ends[1][2]}", field)
        if ends[0][:2] == ends[1][:2]:
            raise Refusal("a wire cannot join a pin to itself", field)
        key = tuple(sorted([ends[0][:2], ends[1][:2]]))
        if key in keys:
            raise Refusal(f"duplicate wire between {ends[0][0]}.{ends[0][1]} and {ends[1][0]}.{ends[1][1]}", field)
        keys.add(key)
        route = raw.get("route")
        if route is not None:
            route = validate_route(route, f"{field}.route")
        wires.append({"id": wid, "kind": ends[0][2], "from": {"part": ends[0][0], "pin": ends[0][1]}, "to": {"part": ends[1][0], "pin": ends[1][1]}, "route": route})
    return parts, wires


def _finite(v):
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def validate_route(route, field):
    """@description A wire's drawing route: {mid} (where the middle segment sits) or {points} (1 to
    MAX_ROUTE_POINTS bend points [x, y]). Drawing only -- the solver never reads it."""
    route = route if isinstance(route, dict) else {}
    if "points" in route and "mid" in route:
        raise Refusal("a route is either {mid} or {points}, not both", field)
    if "points" in route:
        points = route["points"]
        if not isinstance(points, list) or not 1 <= len(points) <= MAX_ROUTE_POINTS:
            raise Refusal(f"route.points must be a list of 1 to {MAX_ROUTE_POINTS} bend points [x, y]", f"{field}.points")
        out = []
        for i, p in enumerate(points):
            if not isinstance(p, list) or len(p) != 2 or not _finite(p[0]) or not _finite(p[1]):
                raise Refusal("a bend point is [x, y] in canvas units", f"{field}.points[{i}]")
            out.append([float(p[0]), float(p[1])])
        return {"points": out}
    if not _finite(route.get("mid")):
        raise Refusal("route.mid must be a number (where the wire's middle segment sits)", f"{field}.mid")
    return {"mid": float(route["mid"])}


def validate_sim(sim):
    """@description Normalise the transient settings and enforce the point cap."""
    sim = sim if isinstance(sim, dict) else {}
    stop = sim.get("stopSeconds", SIM_DEFAULTS["stopSeconds"])
    lo, hi = SIM_LIMITS["stopSeconds"]
    if isinstance(stop, bool) or not isinstance(stop, (int, float)) or not (lo <= stop <= hi):
        raise Refusal(f"stopSeconds must be between {lo} and {hi}", "sim.stopSeconds")
    step = sim.get("stepSeconds")
    if step is None:
        step = stop / SIM_DEFAULTS["defaultPoints"]
    lo, hi = SIM_LIMITS["stepSeconds"]
    if isinstance(step, bool) or not isinstance(step, (int, float)) or not (lo <= step <= hi):
        raise Refusal(f"stepSeconds must be between {lo} and {hi}", "sim.stepSeconds")
    points = int(stop / step) + 1
    if points > SIM_DEFAULTS["maxPoints"]:
        raise Refusal(f"stopSeconds / stepSeconds is {points} points; at most {SIM_DEFAULTS['maxPoints']} -- raise stepSeconds", "sim.stepSeconds")
    if points < 4:
        raise Refusal("stepSeconds must give at least four points", "sim.stepSeconds")
    rest = sim.get("startFromRest", True)
    if not isinstance(rest, bool):
        raise Refusal("startFromRest must be true or false", "sim.startFromRest")
    out = {"stopSeconds": float(stop), "stepSeconds": float(step), "points": points, "startFromRest": rest}
    sync = sim.get("syncSeconds")
    if sync is not None:
        lo, hi = SIM_LIMITS["syncSeconds"]
        if isinstance(sync, bool) or not isinstance(sync, (int, float)) or not (lo <= sync <= hi):
            raise Refusal(f"syncSeconds (the firmware co-simulation step) must be between {lo} and {hi}", "sim.syncSeconds")
        out["syncSeconds"] = float(sync)
    return _solver_knobs(sim, out)


def _solver_knobs(sim, out):
    """@description The solver knobs a person may set (absent or None = the lab's default): reltol and gmin
    bounded, method one of SIM_METHODS; a refusal names the field."""
    for key in ("reltol", "gmin"):
        value = sim.get(key)
        if value is None:
            continue
        lo, hi = SIM_LIMITS[key]
        if not _finite(value) or not lo <= value <= hi:
            raise Refusal(f"{key} must be between {lo} and {hi}", f"sim.{key}")
        out[key] = float(value)
    if sim.get("method") is not None:
        if sim["method"] not in SIM_METHODS:
            raise Refusal(f"method must be one of {', '.join(SIM_METHODS)}", "sim.method")
        out["method"] = sim["method"]
    return out


def solver_chosen(sim):
    """@description True when the person set any solver knob: the deck then uses theirs, and the automatic
    relaxed retry never overrides a choice they made."""
    return any(sim.get(k) is not None for k in SOLVER_KNOBS)


def spice_options(sim, relaxed=False):
    """@description The deck's .option line for a validated sim: the relaxed set on the automatic retry; the
    person's knobs over the lab's defaults when they chose any; otherwise the defaults exactly (a deck without
    knobs is byte-identical to one written before the knobs existed)."""
    if relaxed:
        return RELAXED_OPTIONS
    if not solver_chosen(sim):
        return DEFAULT_OPTIONS
    line = f".option rshunt=1e12 reltol={sim.get('reltol') or SIM_DEFAULTS['reltol']:.6g} abstol=1e-9 vntol=1e-6"
    if sim.get("gmin") is not None:
        line += f" gmin={sim['gmin']:.6g}"
    if sim.get("method") is not None:
        line += f" method={sim['method']}"
    return line


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, key):
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def resolve_nets(parts, wires):
    """@description Electrical nets from the wires. Returns (net_of_pin, nets, warnings) where
    net names are '0' for ground and n1.. otherwise, assigned in part order for determinism."""
    uf = UnionFind()
    pins = [(p["id"], pin["name"]) for p in parts for pin in PART_LIBRARY[p["type"]]["pins"] if pin["kind"] == "electrical"]
    for pin in pins:
        uf.find(pin)
    for w in wires:
        if w["kind"] == "electrical":
            uf.union((w["from"]["part"], w["from"]["pin"]), (w["to"]["part"], w["to"]["pin"]))
    groups = {}
    for pin in pins:
        groups.setdefault(uf.find(pin), []).append(pin)
    warnings = []
    ground_roots = {uf.find((p["id"], "gnd")) for p in parts if p["type"] == "ground"}
    if not ground_roots:
        ref = next(((p["id"], "GND" if p["type"] == "arduino" else "-") for p in parts if p["type"] in ("battery", "source", "arduino")), None)
        if ref is not None:
            ground_roots = {uf.find(ref)}
            warnings.append({"code": "no_ground", "part": ref[0], "message": f"no ground in the circuit: {ref[0]} - is used as the 0 V reference"})
    names, nets, counter = {}, [], 0
    for pin in pins:  # part order => deterministic net numbering
        root = uf.find(pin)
        if root in names:
            continue
        if root in ground_roots:
            names[root] = "0"
        else:
            counter += 1
            names[root] = f"n{counter}"
        nets.append({"name": names[root], "pins": [{"part": a, "pin": b} for a, b in groups[root]]})
    net_of_pin = {pin: names[uf.find(pin)] for pin in pins}
    if not ground_roots:
        warnings.append({"code": "no_reference", "message": "no ground and no battery or source: nothing sets 0 V"})
    for net in nets:
        if len(net["pins"]) == 1:
            a, b = net["pins"][0]["part"], net["pins"][0]["pin"]
            ptype = next(p["type"] for p in parts if p["id"] == a)
            if ptype not in ("junction", "ground", "arduino"):  # a board's spare headers are not a fault
                warnings.append({"code": "unconnected_pin", "part": a, "message": f"{a}.{b} is not connected"})
    return net_of_pin, nets, warnings


def motor_constants(props):
    """@description First-order brushed DC motor identification from nameplate numbers.
    R = V/Istall; Ke = (V - R*Inl)/omega_nl; Kt = Ke (SI); viscous b = Kt*Inl/omega_nl so the
    no-load point is self-consistent; L from inductanceMh; J from rotorInertiaGcm2."""
    v, i_stall, i_nl = props["nominalVolts"], props["stallAmps"], props["noLoadAmps"]
    w_nl = props["noLoadRpm"] * RPM_TO_RADS
    r = v / i_stall
    ke = max((v - r * i_nl) / w_nl, 1e-6)
    return {"ohms": r, "ke": ke, "kt": ke, "viscous": ke * i_nl / w_nl, "henries": props["inductanceMh"] * 1e-3, "inertia": props["rotorInertiaGcm2"] * GCM2_TO_KGM2, "noLoadRads": w_nl}


def servo_constants(props):
    """@description A hobby servo seen at its OUTPUT shaft: the geared motor as one DC motor whose
    no-load speed is the rated deg/s and whose stall torque is the rated one. R = V/Istall;
    Ke = (V - R*Irun)/omega_nl (so the free speed is exactly the rated speed at the running current);
    Kt = tau_stall/Istall (Kt != Ke: the gearbox loses power); b = Kt*Irun/omega_nl; a fixed 0.5 mH."""
    v, i_stall, i_run = props["nominalVolts"], props["stallAmps"], props["runAmps"]
    w_nl = props["noLoadDegPerS"] * math.pi / 180
    r = v / i_stall
    kt = props["stallTorqueMnm"] * 1e-3 / i_stall
    return {"ohms": r, "ke": max((v - r * i_run) / w_nl, 1e-6), "kt": kt, "viscous": kt * i_run / w_nl, "henries": 0.5e-3, "inertia": props["rotorInertiaGcm2"] * GCM2_TO_KGM2, "noLoadRads": w_nl}


def stepper_constants(props):
    """@description A two-phase bipolar stepper: N = steps/4 pole pairs; Km = holding torque /
    (sqrt(2) * rated amps) in N*m/A per phase (both phases at rated current give the holding torque);
    detent torque; the damping the worker applies is 2 * dampingRatio * sqrt(Km * Irated * N * J)
    (the ratio at rated current), capped at 10 % of the holding torque. No viscous load of its own."""
    n_pairs = props["stepsPerRev"] / 4
    km = props["holdingTorqueMnm"] * 1e-3 / (math.sqrt(2) * props["ratedAmps"])
    j = props["rotorInertiaGcm2"] * GCM2_TO_KGM2
    return {"ohms": props["phaseOhms"], "henries": props["phaseMh"] * 1e-3, "polePairs": n_pairs, "km": km, "detent": props["detentTorqueMnm"] * 1e-3,
            "damping": 2 * props["dampingRatio"] * math.sqrt(km * props["ratedAmps"] * n_pairs * j), "viscous": 0.0, "inertia": j, "stepRad": 2 * math.pi / props["stepsPerRev"]}


def driver_constants(part):
    """@description The constants of whichever driver type sits on a train."""
    if part["type"] == "motor":
        return motor_constants(part["props"])
    if part["type"] == "servo":
        return servo_constants(part["props"])
    return stepper_constants(part["props"])


def _shaft_pins(parts):
    return [(p["id"], pin["name"]) for p in parts for pin in PART_LIBRARY[p["type"]]["pins"] if pin["kind"] == "shaft"]


def _group_loads(by_id, members):
    """Inertia, viscous, coulomb and constant torque of one rigid group (the driver's own constants excluded)."""
    j = b = tau = torque = 0.0
    for pid, _pin in members:
        part = by_id[pid]
        pr = part["props"]
        if part["type"] in ("gear", "pulley"):
            j += pr["inertiaGcm2"] * GCM2_TO_KGM2
        elif part["type"] == "load":
            j += pr["inertiaGcm2"] * GCM2_TO_KGM2
            b += pr["viscousMnmPerKrpm"] * 1e-3 / (1000 * RPM_TO_RADS)
            tau += pr["frictionMnm"] * 1e-3
            torque += pr["torqueMnm"] * 1e-3
    return j, b, tau, torque


def solve_mechanism(parts, wires):
    """@description Shaft groups (rigid couplings), meshes (rigid ratios) and the compliant links between
    them (springs, belts), reflected onto one rotational node per CLUSTER of rigidly linked groups.
    @returns {'shafts', 'meshes', 'belts', 'links', 'clusters', 'motors', 'warnings'}.
    Refuses gear loops that disagree, gears meshing on one shaft, two drivers on one cluster, a spring
    or belt shorted by a rigid path, and two cranks on one cluster."""
    by_id = {p["id"]: p for p in parts}
    uf = UnionFind()
    shaft_pins = _shaft_pins(parts)
    for pin in shaft_pins:
        uf.find(pin)
    for w in wires:
        if w["kind"] == "shaft":
            uf.union((w["from"]["part"], w["from"]["pin"]), (w["to"]["part"], w["to"]["pin"]))
    groups, order = {}, []
    for pin in shaft_pins:
        root = uf.find(pin)
        if root not in groups:
            groups[root] = []
            order.append(root)
        groups[root].append(pin)
    group_id = {}
    for root in order:
        pid, pin = groups[root][0]
        group_id[root] = f"shaft:{pid}" if pin == "shaft" else f"shaft:{pid}.{pin}"
    of_pin = {pin: root for root, members in groups.items() for pin in members}
    of_part = {pid: root for root, members in groups.items() for pid, pin in members if pin == "shaft"}
    # meshes: rigid ratios between groups
    edges, meshes = {}, []
    for w in wires:
        if w["kind"] != "teeth":
            continue
        a, b = w["from"]["part"], w["to"]["part"]
        ga, gb = of_part[a], of_part[b]
        if ga == gb:
            raise Refusal(f"gears {a} and {b} ride the same shaft and cannot mesh", "wires")
        na, nb = by_id[a]["props"]["teeth"], by_id[b]["props"]["teeth"]
        ratio = -na / nb  # omega_b / omega_a: external gears turn opposite ways
        edges.setdefault(ga, []).append((gb, ratio))
        edges.setdefault(gb, []).append((ga, 1 / ratio))
        meshes.append({"wire": w["id"], "a": a, "b": b, "ratio": ratio, "sameModule": abs(by_id[a]["props"]["moduleMm"] - by_id[b]["props"]["moduleMm"]) < 1e-9})
    warnings = [{"code": "module_mismatch", "part": m["a"], "message": f"gears {m['a']} and {m['b']} have different modules; real teeth would not mesh"} for m in meshes if not m["sameModule"]]
    # clusters: connected components of groups over meshes
    cu = UnionFind()
    for root in order:
        cu.find(root)
    for ga, lst in edges.items():
        for gb, _r in lst:
            cu.union(ga, gb)
    cluster_of, clusters = {}, []
    for root in order:
        c = cu.find(root)
        if c not in cluster_of:
            cluster_of[c] = len(clusters)
            clusters.append({"groups": [], "driver": None, "crank": None})
        cluster_of[root] = cluster_of[c]
        clusters[cluster_of[c]]["groups"].append(root)
    for p in parts:
        if p["type"] in DRIVER_TYPES or p["type"] == "crank":
            k = "driver" if p["type"] in DRIVER_TYPES else "crank"
            cl = clusters[cluster_of[of_part[p["id"]]]]
            if cl[k] is not None:
                raise Refusal(f"{k}s {cl[k]} and {p['id']} share one train; one {('motor' if k == 'driver' else 'crank')} per train", "wires")
            cl[k] = p["id"]
    # ratios of every group to its cluster's reference group (the driver's, else the first group)
    ratio_of = {}
    for ci, cl in enumerate(clusters):
        ref = of_part[cl["driver"]] if cl["driver"] else cl["groups"][0]
        cl["ref"] = ref
        queue = [(ref, 1.0)]
        while queue:
            g, r = queue.pop()
            if g in ratio_of:
                if abs(ratio_of[g] - r) > 1e-9 * max(1.0, abs(r)):
                    raise Refusal(f"the gear loop through {group_id[g]} is inconsistent ({ratio_of[g]:.4g} vs {r:.4g})", "wires")
                continue
            ratio_of[g] = r
            for nxt, er in edges.get(g, []):
                queue.append((nxt, r * er))
    # links: springs and belts between clusters
    links, belts = [], []
    def endpoint(root):
        return {"cluster": cluster_of[root], "ratio": ratio_of[root], "group": group_id[root]}
    for p in parts:
        if p["type"] != "spring":
            continue
        ga, gb = of_pin[(p["id"], "a")], of_pin[(p["id"], "b")]
        if cluster_of[ga] == cluster_of[gb]:
            raise Refusal(f"spring {p['id']} is shorted by a rigid path between its two ends", "wires")
        pr = p["props"]
        links.append({"kind": "spring", "part": p["id"], "a": endpoint(ga), "b": endpoint(gb),
                      "stiffness": pr["stiffnessMnmPerDeg"] * 1e-3 * 180 / math.pi, "damping": pr["dampingMnmPerKrpm"] * 1e-3 / (1000 * RPM_TO_RADS)})
    for w in wires:
        if w["kind"] != "belt":
            continue
        a, b = w["from"]["part"], w["to"]["part"]
        ga, gb = of_part[a], of_part[b]
        if cluster_of[ga] == cluster_of[gb]:
            raise Refusal(f"the belt between {a} and {b} is shorted by a rigid path", "wires")
        pa, pb = by_id[a]["props"], by_id[b]["props"]
        belt = {"kind": "belt", "wire": w["id"], "a": dict(endpoint(ga), part=a, radius=pa["radiusMm"] * 1e-3), "b": dict(endpoint(gb), part=b, radius=pb["radiusMm"] * 1e-3), "grip": min(pa["gripN"], pb["gripN"])}
        links.append(belt)
        belts.append({"wire": w["id"], "a": a, "b": b, "ratio": pa["radiusMm"] / pb["radiusMm"]})
    linked = {l["a"]["cluster"] for l in links} | {l["b"]["cluster"] for l in links}
    # reflect every cluster onto its node
    shafts, motors = [], {}
    for ci, cl in enumerate(clusters):
        driver = cl["driver"]
        node = f"sh{driver.lower()}" if driver else f"shc{ci + 1}"
        base = f"rpm({driver})" if driver else f"rpm({group_id[cl['ref']]})"
        angle = f"angle({driver})" if driver else f"angle({group_id[cl['ref']]})"
        k = driver_constants(by_id[driver]) if driver else None
        j_eq, b_eq, tau_eq, torque_eq = (k["inertia"], k["viscous"], 0.0, 0.0) if k else (0.0, 0.0, 0.0, 0.0)
        for root in cl["groups"]:
            j, b, tau, torque = _group_loads(by_id, groups[root])
            r = ratio_of[root]
            j_eq += j * r * r
            b_eq += b * r * r
            tau_eq += tau * abs(r)
            torque_eq += torque * r  # a constant torque keeps its sign through the train (power balance)
            members = [pid for pid, _pin in groups[root]]
            shafts.append({"id": group_id[root], "parts": members, "ratio": r, "drivenBy": driver, "cluster": ci, "node": node, "base": base, "angleSignal": angle,
                           "inertia": j, "viscous": b, "friction": tau, "torque": torque})
        cl.update({"node": node, "base": base, "angleSignal": angle, "reflected": {"inertia": j_eq, "viscous": b_eq, "friction": tau_eq, "torque": torque_eq, "inertiaGcm2": j_eq / GCM2_TO_KGM2}})
        if cl["crank"]:
            cl["crankRatio"] = ratio_of[of_part[cl["crank"]]]
        if driver:
            motors[driver] = {"shaft": group_id[of_part[driver]], "type": by_id[driver]["type"], "constants": k, "node": node, "cluster": ci, "reflected": cl["reflected"]}
        elif ci not in linked and any(by_id[pid]["type"] not in DRIVER_TYPES for root in cl["groups"] for pid, _pin in groups[root]):
            first = [pid for pid, _pin in groups[cl["ref"]]]
            warnings.append({"code": "not_driven", "part": first[0], "message": f"{group_id[cl['ref']]} ({', '.join(first)}) is not driven by any motor"})
    for cl in clusters:
        cl["groups"] = [group_id[root] for root in cl["groups"]]
        cl["ref"] = group_id[cl["ref"]]
    return {"shafts": shafts, "meshes": meshes, "belts": belts, "links": links, "clusters": clusters, "motors": motors, "warnings": warnings}
