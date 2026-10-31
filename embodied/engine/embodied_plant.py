"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant -- a physics plant generated from a design,
    |                                           | for ANY machine: a plant spec (the parts with the kernel's mass and
    |                                           | extents or their STL, the base that is ground, the joints as the
    |                                           | mechanism declares them, the actuators from the bought rows' stall
    |                                           | torque, no-load speed and the stated gear ratio, the payload on its
    |                                           | part, the medium's gravity) becomes a MuJoCo model: each part a body
    |                                           | at its joint's frame (a box of the extents carrying the mass, or the
    |                                           | STL as a mesh geom MuJoCo convexifies), position servos limited to
    |                                           | stall x ratio with the torque-speed damping the arm learned, joint
    |                                           | position / velocity / force sensors, an IMU on the base and a
    |                                           | position sensor on the payload. `plant_op` is the bridge's dispatch
    |                                           | for the `plant.*` family in the hexapod's op shapes (load, reset,
    |                                           | step by targets or by a command through a certified policy, state,
    |                                           | drop, train, jobs, certify): its own sessions and lock, the long
    |                                           | runs under their own lock so a live plant never waits. Every
    |                                           | refusal is named (bad_spec with the field, unknown_part, cycle,
    |                                           | no_session, ...). No number of any machine lives here.
2   | maintainer@emeraldcoastsystemsgroup.com   | The spec digest names the plant, not the reading: the provenance a
    |                                           | caller attaches (where and when a part or a row was read, its
    |                                           | label) is left out, so a spec re-composed for the gate matches the
    |                                           | report it trained (the lift's real-engine proof found the mismatch).
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import threading
import time

import mujoco
import numpy as np

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
from embodied_hexapod import refuse  # noqa: E402 -- the one refusal mechanism the bridge names on the wire

#: The control period the task and the brain step at: the hexapod's.
CONTROL_DT_S = 0.02
#: The physics step every plant of this package runs at unless the spec says otherwise (MJCF_TIMESTEP_S in mjcf.ts).
DEFAULT_TIMESTEP_S = 0.002
#: kp = force limit / this error, so the drive saturates at this much error (the arm's SATURATION_ERROR_RAD; metres on a slide).
SATURATION_ERROR = 0.05
#: The reflected inertia a servo shows at its output (the arm's SERVO_ARMATURE_KGM2 estimate); through a ratio r it is x r^2.
ARMATURE_AT_OUTPUT = 0.01
#: Reset settles the mechanism for this long under its rest targets, then zeroes the clock.
SETTLE_S = 0.2
#: A seeded reset jitters the start targets by up to this fraction of the actuator's range.
JITTER_FRACTION = 0.01
JOINT_TYPES = ("hinge", "slide", "fixed")
DEFAULT_SESSION = "plant"
#: The inverse-kinematics solver for a chain of more than one actuated joint: damped least squares.
IK_ITERATIONS = 200
IK_DAMPING = 1e-3
IK_STEP = 0.5
#: Idle plant sessions are dropped after this long, as the bridge drops a drone's.
IDLE_DROP_S = 1800.0


def _vec3(value, where: str) -> list[float]:
    try:
        v = [float(x) for x in value]
    except (TypeError, ValueError):
        refuse("bad_spec", f"{where} must be three numbers")
    if len(v) != 3 or not all(math.isfinite(x) for x in v):
        refuse("bad_spec", f"{where} must be three finite numbers")
    return v


def _positive(value, where: str) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        refuse("bad_spec", f"{where} must be a positive number")
    if not (math.isfinite(v) and v > 0):
        refuse("bad_spec", f"{where} must be a positive number, got {value!r}")
    return v


def _ident(value, where: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 64 or not all(c.isalnum() or c in "-_" for c in value):
        refuse("bad_spec", f"{where} must be a short id of letters, digits, - and _")
    return value


def mesh_bytes(part: dict, where: str) -> bytes | None:
    """@description The part's STL when the spec carries one, as base64 text (`meshStl`) or a path on this host (`meshPath`)."""
    stl = part.get("meshStl")
    if isinstance(stl, str) and stl:
        try:
            return base64.b64decode(stl, validate=True)
        except (ValueError, TypeError):
            refuse("bad_spec", f"{where}.meshStl must be base64 STL bytes")
    path = part.get("meshPath")
    if isinstance(path, str) and path:
        if not os.path.isfile(path):
            refuse("bad_spec", f"{where}.meshPath {path!r} is not a file on this host")
        with open(path, "rb") as fh:
            return fh.read()
    return None


def _parts(spec: dict) -> dict[str, dict]:
    raw = spec.get("parts")
    if not isinstance(raw, list) or not raw:
        refuse("bad_spec", "parts must be a non-empty list of {id, massKg, extentsM, meshStl?}")
    out: dict[str, dict] = {}
    for i, p in enumerate(raw):
        where = f"parts[{i}]"
        if not isinstance(p, dict):
            refuse("bad_spec", f"{where} must be an object")
        pid = _ident(p.get("id"), f"{where}.id")
        if pid in out:
            refuse("bad_spec", f"{where}.id {pid!r} appears twice")
        out[pid] = {"id": pid, "massKg": _positive(p.get("massKg"), f"{where}.massKg"), "extentsM": _vec3(p.get("extentsM"), f"{where}.extentsM"), "mesh": mesh_bytes(p, where), "name": str(p.get("name") or pid)}
        if min(out[pid]["extentsM"]) <= 0:
            refuse("bad_spec", f"{where}.extentsM must be positive")
    return out


def _joints(spec: dict, parts: dict[str, dict]) -> list[dict]:
    raw = spec.get("joints")
    if not isinstance(raw, list):
        refuse("bad_spec", "joints must be a list of {id, parent, child, type, axis, range, originM}")
    out, ids = [], set()
    for i, j in enumerate(raw):
        where = f"joints[{i}]"
        if not isinstance(j, dict):
            refuse("bad_spec", f"{where} must be an object")
        jid = _ident(j.get("id"), f"{where}.id")
        if jid in ids:
            refuse("bad_spec", f"{where}.id {jid!r} appears twice")
        ids.add(jid)
        parent, child = j.get("parent"), j.get("child")
        for key, value in (("parent", parent), ("child", child)):
            if value not in parts:
                refuse("unknown_part", f"{where}.{key} names {value!r}, which is not a part of the spec")
        if parent == child:
            refuse("cycle", f"{where} joins {parent!r} to itself")
        kind = j.get("type")
        if kind not in JOINT_TYPES:
            refuse("bad_spec", f"{where}.type must be one of {JOINT_TYPES}")
        axis = _vec3(j.get("axis", [0, 0, 1]), f"{where}.axis") if kind != "fixed" else None
        if axis is not None and np.linalg.norm(axis) == 0:
            refuse("bad_spec", f"{where}.axis must not be zero")
        rng = None
        if kind != "fixed":
            r = j.get("range")
            if not isinstance(r, (list, tuple)) or len(r) != 2:
                refuse("bad_spec", f"{where}.range must be [lo, hi] ({'rad' if kind == 'hinge' else 'm'})")
            lo, hi = float(r[0]), float(r[1])
            if not (math.isfinite(lo) and math.isfinite(hi) and hi > lo):
                refuse("bad_spec", f"{where}.range must be [lo, hi] with hi > lo")
            rng = [lo, hi]
        origin = _vec3(j.get("originM", [0.0, 0.0, parts[parent]["extentsM"][2]]), f"{where}.originM")
        out.append({"id": jid, "parent": parent, "child": child, "type": kind, "axis": axis, "range": rng, "originM": origin})
    return out


def _tree(base: str, parts: dict[str, dict], joints: list[dict]) -> dict[str, list[dict]]:
    """@description The parts as a tree rooted at the base: every other part the child of exactly one joint, no cycle,
    every part reachable. @returns parent id -> its joints. @raises bad_spec, cycle by name."""
    if base not in parts:
        refuse("unknown_part", f"base names {base!r}, which is not a part of the spec")
    children: dict[str, list[dict]] = {pid: [] for pid in parts}
    parent_of: dict[str, str] = {}
    for j in joints:
        if j["child"] == base:
            refuse("cycle", f"joint {j['id']} makes the base {base!r} a child; the base is ground")
        if j["child"] in parent_of:
            refuse("cycle", f"part {j['child']!r} is the child of two joints ({parent_of[j['child']]} and {j['id']}): a part hangs from one joint")
        parent_of[j["child"]] = j["id"]
        children[j["parent"]].append(j)
    seen, stack = set(), [base]
    while stack:
        pid = stack.pop()
        if pid in seen:
            refuse("cycle", f"the joints loop back through {pid!r}")
        seen.add(pid)
        stack.extend(j["child"] for j in children[pid])
    loose = sorted(set(parts) - seen)
    if loose:
        if any(pid in parent_of for pid in loose):
            refuse("cycle", f"parts {loose} hang from each other and never reach the base {base!r}")
        refuse("bad_spec", f"parts {loose} are not joined to the base {base!r}")
    return children


def _actuators(spec: dict, joints: list[dict]) -> list[dict]:
    raw = spec.get("actuators")
    if not isinstance(raw, list):
        refuse("bad_spec", "actuators must be a list of {joint, stallNm, noLoadRadS, gearRatio, continuousNm}")
    by_id = {j["id"]: j for j in joints}
    out, driven = [], set()
    for i, a in enumerate(raw):
        where = f"actuators[{i}]"
        if not isinstance(a, dict) or a.get("joint") not in by_id:
            refuse("bad_spec", f"{where}.joint must name a joint of the spec")
        j = by_id[a["joint"]]
        if j["type"] == "fixed":
            refuse("bad_spec", f"{where} drives {j['id']}, which is fixed")
        if j["id"] in driven:
            refuse("bad_spec", f"{where}: joint {j['id']} is driven twice")
        driven.add(j["id"])
        stall = _positive(a.get("stallNm"), f"{where}.stallNm")
        speed = _positive(a.get("noLoadRadS"), f"{where}.noLoadRadS")
        ratio = _positive(a.get("gearRatio", 1.0), f"{where}.gearRatio")
        continuous = _positive(a.get("continuousNm"), f"{where}.continuousNm")
        if continuous > stall:
            refuse("bad_spec", f"{where}.continuousNm {continuous} is above the stall {stall}")
        limit = stall * ratio
        out.append({"joint": j["id"], "type": j["type"], "stallNm": stall, "noLoadRadS": speed, "gearRatio": ratio, "continuousNm": continuous, "row": a.get("row") if isinstance(a.get("row"), dict) else None,
                    "forceLimit": limit, "noLoadSpeed": speed / ratio, "kp": limit / SATURATION_ERROR, "damping": limit / (speed / ratio), "armature": ARMATURE_AT_OUTPUT * ratio * ratio,
                    "unit": "N·m" if j["type"] == "hinge" else "N", "speedUnit": "rad/s" if j["type"] == "hinge" else "m/s"})
    return out


def _payload(spec: dict, parts: dict[str, dict]) -> dict | None:
    p = spec.get("payload")
    if p is None:
        return None
    if not isinstance(p, dict) or p.get("attachedTo") not in parts:
        refuse("bad_spec", "payload must be {massKg, attachedTo: a part id, atM?}")
    part = parts[p["attachedTo"]]
    return {"massKg": _positive(p.get("massKg"), "payload.massKg"), "attachedTo": p["attachedTo"], "atM": _vec3(p.get("atM", [0.0, 0.0, part["extentsM"][2]]), "payload.atM")}


def validate_spec(spec) -> dict:
    """@description The plant spec checked field by field: the parts, the base, the joints as a tree, the actuators on
    non-fixed joints with their rows' numbers, the payload on a part, the medium's gravity (the route fills it from the
    medium row; never a literal here). @param spec The request's spec. @returns The normalised spec.
    @raises bad_spec naming the field, unknown_part, cycle."""
    if not isinstance(spec, dict):
        refuse("bad_spec", "spec must be an object {parts, base, joints, actuators, payload, medium}")
    parts = _parts(spec)
    base = spec.get("base")
    joints = _joints(spec, parts)
    children = _tree(base, parts, joints)
    actuators = _actuators(spec, joints)
    medium = spec.get("medium")
    if not isinstance(medium, dict) or not isinstance(medium.get("id"), str):
        refuse("bad_spec", "medium must be {id, gravityMps2}: the route reads it from the medium row")
    gravity = _vec3(medium.get("gravityMps2"), "medium.gravityMps2")
    timestep = _positive(spec.get("timestepS", DEFAULT_TIMESTEP_S), "timestepS")
    name = _ident(spec.get("name", "plant"), "name")
    return {"name": name, "timestepS": timestep, "parts": parts, "base": base, "joints": joints, "children": children, "actuators": actuators,
            "payload": _payload(spec, parts), "medium": {"id": medium["id"], "gravityMps2": gravity}, "senses": list(spec.get("senses") or [])}


#: The provenance a caller attaches to what it read (where, when, the row's label): not part of the plant, so not of its digest.
PROVENANCE_KEYS = ("source", "route", "readAt", "name", "revision", "modelId")


def spec_sha256(spec: dict) -> str:
    """@description The digest a report and a certificate bind the spec by: the canonical JSON of the PLANT -- the parts'
    masses and extents (every mesh replaced by its own sha256, so a spec with or without the bytes names the same plant),
    the joints, the actuators' numbers and row ids, the payload, the medium -- with the provenance a reader attaches
    (where and when a part or a row was read, its label) left out, so the same plant read twice has one digest.
    @param spec The request's spec. @returns Hex."""
    def strip(part):
        p = {k: v for k, v in part.items() if k not in ("meshStl", "meshPath") and k not in PROVENANCE_KEYS}
        b = mesh_bytes(part, "parts") if isinstance(part, dict) else None
        if b is not None:
            p["meshSha256"] = hashlib.sha256(b).hexdigest()
        return p

    def actuator(a):
        out = dict(a)
        row = a.get("row")
        if isinstance(row, dict):
            out["row"] = {k: v for k, v in row.items() if k not in PROVENANCE_KEYS}
        return out
    canon = {k: v for k, v in spec.items() if k not in PROVENANCE_KEYS}
    canon["parts"] = [strip(p) for p in spec.get("parts", []) if isinstance(p, dict)]
    canon["actuators"] = [actuator(a) for a in spec.get("actuators", []) if isinstance(a, dict)]
    return hashlib.sha256(json.dumps(canon, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _f(x: float) -> str:
    return repr(round(float(x), 9))


def _v(xs) -> str:
    return " ".join(_f(x) for x in xs)


def _part_geom(part: dict, assets: dict) -> str:
    """@description The part's geom: a box of its extents seated on its own z = 0 (CAD Studio's frame) carrying the kernel's
    mass, or its STL as a mesh asset MuJoCo convexifies, carrying the same mass."""
    if part["mesh"] is not None:
        assets[f"{part['id']}.stl"] = part["mesh"]
        return f'<geom name="{part["id"]}" class="part" type="mesh" mesh="{part["id"]}" mass="{_f(part["massKg"])}"/>'
    e = part["extentsM"]
    return f'<geom name="{part["id"]}" class="part" type="box" pos="0 0 {_f(e[2] / 2)}" size="{_v([x / 2 for x in e])}" mass="{_f(part["massKg"])}"/>'


def _joint_line(j: dict, act: dict | None) -> str:
    if j["type"] == "fixed":
        return ""
    damping = _f(act["damping"]) if act else "0"
    armature = _f(act["armature"]) if act else "0"
    return f'<joint name="{j["id"]}" type="{j["type"]}" axis="{_v(j["axis"])}" range="{_v(j["range"])}" damping="{damping}" armature="{armature}"/>'


def _body_lines(spec: dict, pid: str, pos, joint: dict | None, assets: dict, indent: str) -> list[str]:
    part = spec["parts"][pid]
    acts = {a["joint"]: a for a in spec["actuators"]}
    lines = [f'{indent}<body name="{pid}" pos="{_v(pos)}">']
    if joint is not None and joint["type"] != "fixed":
        lines.append(f"{indent}  {_joint_line(joint, acts.get(joint['id']))}")
    lines.append(f"{indent}  {_part_geom(part, assets)}")
    if pid == spec["base"]:
        lines.append(f'{indent}  <site name="imu" pos="0 0 {_f(part["extentsM"][2] / 2)}" size="0.004"/>')
    payload = spec["payload"]
    if payload is not None and payload["attachedTo"] == pid:
        r = max(0.005, (3 * payload["massKg"] / (4 * math.pi * 1000.0)) ** (1 / 3))  # a water-density sphere: a visible lump, its inertia the mass's
        lines.append(f'{indent}  <body name="payload" pos="{_v(payload["atM"])}"><geom name="payload" class="part" type="sphere" pos="0 0 {_f(r)}" size="{_f(r)}" mass="{_f(payload["massKg"])}"/><site name="payload" pos="0 0 {_f(r)}" size="0.004"/></body>')
    for child in spec["children"][pid]:
        lines.extend(_body_lines(spec, child["child"], child["originM"], child, assets, indent + "  "))
    lines.append(f"{indent}</body>")
    return lines


def plant_mjcf(spec: dict) -> tuple[str, dict]:
    """@description The validated spec as MuJoCo XML: a floor, the base as a static body on it, the tree of parts at their
    joints' frames, position servos limited to stall x ratio, the sensors. @param spec validate_spec()'s output.
    @returns (xml, assets) -- the assets are the mesh bytes by file name."""
    assets: dict = {}
    body = _body_lines(spec, spec["base"], [0.0, 0.0, 0.0], None, assets, "    ")
    actuators = [f'    <position name="{a["joint"]}" joint="{a["joint"]}" kp="{_f(a["kp"])}" forcelimited="true" forcerange="{_f(-a["forceLimit"])} {_f(a["forceLimit"])}" ctrlrange="{_v(next(j["range"] for j in spec["joints"] if j["id"] == a["joint"]))}"/>' for a in spec["actuators"]]
    sensors = []
    for a in spec["actuators"]:
        sensors += [f'    <jointpos name="{a["joint"]}-pos" joint="{a["joint"]}"/>', f'    <jointvel name="{a["joint"]}-vel" joint="{a["joint"]}"/>', f'    <actuatorfrc name="{a["joint"]}-frc" actuator="{a["joint"]}"/>']
    sensors += ['    <gyro name="gyro" site="imu"/>', '    <accelerometer name="accel" site="imu"/>']
    if spec["payload"] is not None:
        sensors += ['    <framepos name="payload-pos" objtype="site" objname="payload"/>', '    <framelinvel name="payload-vel" objtype="site" objname="payload"/>']
    meshes = [f'    <mesh name="{name[:-4]}" file="{name}"/>' for name in assets]
    lines = [
        f'<mujoco model="embodied-plant-{spec["name"]}">',
        "  <!-- ADR-203 D9: a plant generated from a design's mechanism. Every mass, extent, range, stall torque, speed and",
        "       ratio is the spec's (the kernel's report, the bought rows, the mechanism); the medium's gravity is the row's.",
        "       Parts do not collide with each other (a carriage around a column would); the base is ground. -->",
        '  <compiler angle="radian" autolimits="true"/>',
        f'  <option timestep="{_f(spec["timestepS"])}" gravity="{_v(spec["medium"]["gravityMps2"])}" integrator="implicitfast"/>',
        "  <default>",
        '    <default class="floor"><geom contype="1" conaffinity="1" rgba="0.6 0.6 0.55 1"/></default>',
        '    <default class="part"><geom contype="0" conaffinity="0" rgba="0.25 0.3 0.4 1"/></default>',
        "  </default>",
        *(["  <asset>", *meshes, "  </asset>"] if meshes else []),
        "  <worldbody>",
        '    <geom name="floor" class="floor" type="plane" size="5 5 0.1"/>',
        '    <light pos="0 0 2" dir="0 0 -1"/>',
        *body,
        "  </worldbody>",
        "  <actuator>", *actuators, "  </actuator>",
        "  <sensor>", *sensors, "  </sensor>",
        "</mujoco>",
    ]
    return "\n".join(lines) + "\n", assets


class PlantSession:
    """@description One MuJoCo world built from a spec: the mechanism and its servos, stepped by whoever holds it (targets,
    or a command through a certified policy). Counts the energy the drives spend and the peak force; knows where its
    payload is."""

    def __init__(self, spec, seed: int = 0, report_dir: str | None = None) -> None:
        self.spec = validate_spec(spec)
        self.spec_sha256 = spec_sha256(spec)
        xml, assets = plant_mjcf(self.spec)
        self.xml = xml
        try:
            self.model = mujoco.MjModel.from_xml_string(xml, assets)
        except ValueError as error:  # a mesh MuJoCo cannot take is the spec's fault, named
            refuse("bad_spec", f"MuJoCo refused the generated model: {error}")
        self.data = mujoco.MjData(self.model)
        self.seed = int(seed)
        self.rng = np.random.default_rng(self.seed)
        m = self.model
        self.actuators = self.spec["actuators"]
        self.act_ids = [m.actuator(a["joint"]).id for a in self.actuators]
        self.jnt_ids = [m.joint(a["joint"]).id for a in self.actuators]
        self.qpos_adr = [int(m.jnt_qposadr[j]) for j in self.jnt_ids]
        self.dof_adr = [int(m.jnt_dofadr[j]) for j in self.jnt_ids]
        self.ranges = np.array([m.jnt_range[j] for j in self.jnt_ids]).reshape(-1, 2)
        self.gyro_adr = int(m.sensor("gyro").adr[0])
        self.accel_adr = int(m.sensor("accel").adr[0])
        self.payload_site = m.site("payload").id if self.spec["payload"] is not None else None
        self.payload_adr = int(m.sensor("payload-pos").adr[0]) if self.payload_site is not None else None
        self.payload_vel_adr = int(m.sensor("payload-vel").adr[0]) if self.payload_site is not None else None
        self.substeps = max(1, int(round(CONTROL_DT_S / m.opt.timestep)))
        self.energy_j = 0.0
        self.peak_force = np.zeros(len(self.actuators))
        self.controller = None
        self.report_dir = report_dir
        self.rest_targets = self._rest_targets()
        self.rest_payload = None
        self.reset()

    def _rest_targets(self) -> np.ndarray:
        """@description Each actuated joint's rest: zero when its range allows it, else the end of the range nearest zero."""
        return np.array([0.0 if lo <= 0.0 <= hi else (lo if abs(lo) < abs(hi) else hi) for lo, hi in self.ranges])

    # -- what the bridge answers at load ---------------------------------------
    def info(self) -> dict:
        """@description The load reply: the joints and the actuators with every number the model was built from, the physics step, the masses, the payload's rest position."""
        m = self.model
        base = m.body(self.spec["base"]).id
        return {"name": self.spec["name"], "specSha256": self.spec_sha256, "timestepS": float(m.opt.timestep), "controlDtS": CONTROL_DT_S, "bodies": int(m.nbody), "geoms": int(m.ngeom),
                "massKg": round(float(m.body_subtreemass[base]), 6), "medium": self.spec["medium"],
                "parts": [{"id": p["id"], "name": p["name"], "massKg": p["massKg"], "extentsM": p["extentsM"], "mesh": p["mesh"] is not None} for p in self.spec["parts"].values()],
                "joints": [{"id": j["id"], "type": j["type"], "parent": j["parent"], "child": j["child"], "axis": j["axis"], "range": j["range"], "originM": j["originM"]} for j in self.spec["joints"]],
                "actuators": [{k: a[k] for k in ("joint", "type", "stallNm", "noLoadRadS", "gearRatio", "continuousNm", "row", "forceLimit", "noLoadSpeed", "kp", "damping", "unit", "speedUnit")} | {"range": list(self.ranges[i])} for i, a in enumerate(self.actuators)],
                "payload": None if self.spec["payload"] is None else {**self.spec["payload"], "restPosM": self.rest_payload},
                "senses": self.senses(), "controller": self.controller_name()}

    def senses(self) -> list[dict]:
        """@description What the plant senses, by name: the joints (q, dq, force), the IMU on the base, the payload's position."""
        out = [{"name": "joints", "present": True, "count": len(self.actuators), "fields": ["q", "dq", "force"], "rateHz": round(1.0 / CONTROL_DT_S, 3)},
               {"name": "imu", "present": True, "on": self.spec["base"], "fields": ["gyro", "accel"], "rateHz": round(1.0 / CONTROL_DT_S, 3)}]
        out.append({"name": "payload", "present": self.payload_site is not None, "fields": ["posM", "velMps"], "rateHz": round(1.0 / CONTROL_DT_S, 3)})
        return out

    def controller_name(self) -> str:
        """@description Who makes the targets: `targets` (whoever steps the plant) or `policy:<file>`. @returns The name."""
        return "targets" if self.controller is None else self.controller.name

    def set_controller(self, spec_text) -> str:
        """@description `targets` keeps the plant on whoever steps it; `policy:<file>` plays a certified reach policy from the
        report directory, loaded only through the gate's door. @returns The controller's name. @raises bad_controller, policy_not_found, policy_not_certified."""
        text = (spec_text or "targets").strip() if isinstance(spec_text, str) else None
        if text is None or not text or text == "targets":
            self.controller = None
            return "targets"
        if not text.startswith("policy:") or not self.report_dir:
            refuse("bad_controller", "controller must be \"targets\" or \"policy:<file>\" on an engine with a report directory")
        from tasks.plant_reach import PolicyReach  # noqa: PLC0415 -- torch only when a policy plays
        self.controller = PolicyReach(os.path.join(self.report_dir, os.path.basename(text[len("policy:"):])), self)
        return self.controller.name

    # -- truth -----------------------------------------------------------------
    def payload_pos(self) -> list[float] | None:
        """@description Where the payload is now, in the world frame. @returns [x, y, z] or None without a payload."""
        if self.payload_adr is None:
            return None
        return [float(v) for v in self.data.sensordata[self.payload_adr: self.payload_adr + 3]]

    def motor_torques(self) -> np.ndarray:
        """@description Each drive's torque at the motor shaft (N·m), what the rows' ratings are compared with: the commanded
        force less the joint damping's share (that damping IS the motor's torque-speed line, stall over no-load speed,
        so at speed the motor produces only what is left), reflected through the gear ratio."""
        return np.array([(float(self.data.actuator_force[a]) - act["damping"] * float(self.data.qvel[d])) / act["gearRatio"] for a, d, act in zip(self.act_ids, self.dof_adr, self.actuators)])

    def state(self) -> dict:
        """@description The state dict a task, the gate and a brain read, key for key."""
        d = self.data
        return {
            "timeS": round(float(d.time), 6),
            "jointPos": [round(float(d.qpos[a]), 6) for a in self.qpos_adr],
            "jointVel": [round(float(d.qvel[a]), 6) for a in self.dof_adr],
            "jointForce": [round(float(d.actuator_force[a]), 6) for a in self.act_ids],
            "motorTorqueNm": [round(float(v), 6) for v in self.motor_torques()],
            "targets": [round(float(d.ctrl[a]), 6) for a in self.act_ids],
            "gyroRadS": [round(float(v), 6) for v in d.sensordata[self.gyro_adr: self.gyro_adr + 3]],
            "accelMps2": [round(float(v), 6) for v in d.sensordata[self.accel_adr: self.accel_adr + 3]],
            "payloadPosM": None if self.payload_adr is None else [round(v, 6) for v in self.payload_pos()],
            "payloadVelMps": None if self.payload_vel_adr is None else [round(float(v), 6) for v in d.sensordata[self.payload_vel_adr: self.payload_vel_adr + 3]],
            "energyJ": round(self.energy_j, 6),
        }

    # -- commands --------------------------------------------------------------
    def reset(self, seed: int | None = None) -> dict:
        """@description Put every joint at its rest target (jittered a little on a seeded reset), settle for SETTLE_S, zero the clock. @returns The state."""
        if seed is not None:
            self.seed = int(seed)
            self.rng = np.random.default_rng(self.seed)
        targets = self.rest_targets.copy()
        if seed:
            span = self.ranges[:, 1] - self.ranges[:, 0]
            targets = np.clip(targets + self.rng.uniform(-JITTER_FRACTION, JITTER_FRACTION, len(targets)) * span, self.ranges[:, 0], self.ranges[:, 1])
        mujoco.mj_resetData(self.model, self.data)
        for a, v in zip(self.qpos_adr, targets):
            self.data.qpos[a] = float(v)
        self._command(targets)
        mujoco.mj_forward(self.model, self.data)
        self.energy_j = 0.0
        self.peak_force[:] = 0.0
        self._advance(targets, SETTLE_S)
        self.data.time = 0.0
        self.energy_j = 0.0
        self.peak_force[:] = 0.0
        self.rest_payload = self.payload_pos()
        if self.controller is not None:
            self.controller.reset()
        return self.state()

    def _command(self, targets) -> None:
        for act, v, (lo, hi) in zip(self.act_ids, targets, self.ranges):
            self.data.ctrl[act] = min(hi, max(lo, float(v)))

    def _advance(self, targets, seconds: float) -> None:
        """@description Command the drives and run whole physics steps for `seconds`, counting the mechanical energy spent and the peak force."""
        self._command(targets)
        dt = float(self.model.opt.timestep)
        for _ in range(max(1, int(round(seconds / dt)))):
            mujoco.mj_step(self.model, self.data)
            force = np.array([self.data.actuator_force[a] for a in self.act_ids])
            speed = np.array([self.data.qvel[a] for a in self.dof_adr])
            self.energy_j += float(np.sum(np.abs(force * speed))) * dt
            self.peak_force = np.maximum(self.peak_force, np.abs(force))

    def step(self, targets, dt: float = CONTROL_DT_S) -> dict:
        """@description Command one target per actuator (joint units, clamped to the range) and advance dt. @returns The state. @raises bad_targets."""
        try:
            arr = np.array(targets, dtype=float).reshape(-1)
        except (TypeError, ValueError):
            refuse("bad_targets", f"targets must be {len(self.actuators)} numbers")
        if arr.shape != (len(self.actuators),) or not np.all(np.isfinite(arr)):
            refuse("bad_targets", f"targets must be {len(self.actuators)} finite numbers in actuator order, got {arr.shape[0]}")
        if not (math.isfinite(dt) and dt > 0):
            refuse("bad_targets", f"dtS must be a positive number, got {dt!r}")
        self._advance(arr, float(dt))
        return self.state()

    def step_command(self, cmd, dt: float = CONTROL_DT_S) -> dict:
        """@description A command for the plant's own controller (a certified policy): {payloadTargetM} -> targets. @raises no_controller."""
        if self.controller is None:
            refuse("no_controller", "this session has no policy controller: load it with controller \"policy:<file>\" or step targets")
        if not isinstance(cmd, dict):
            refuse("bad_targets", "command must be {payloadTargetM: [x, y, z]}")
        targets, info = self.controller.targets(self, self.state(), cmd)
        state = self.step(targets, dt)
        return {**state, "controller": info}

    # -- inverse kinematics ------------------------------------------------------
    def ik_targets(self, target_pos) -> dict:
        """@description The joint targets that put the payload at a world position: exact for one actuated joint (a slide
        along its axis, a hinge on its circle), damped least squares for a longer chain. The plant's state is restored.
        @param target_pos [x, y, z]. @returns {targets, reachedPosM, residualM, exact}."""
        if self.payload_site is None:
            refuse("no_payload", "inverse kinematics needs a payload on a part")
        target = np.array(_vec3(target_pos, "targetPosM"))
        snapshot = (self.data.qpos.copy(), self.data.qvel.copy(), self.data.ctrl.copy(), float(self.data.time))
        try:
            q = self._ik_single(target) if len(self.actuators) == 1 else self._ik_dls(target)
            q = np.clip(q, self.ranges[:, 0], self.ranges[:, 1])
            self.data.qvel[:] = 0.0
            for a, v in zip(self.qpos_adr, q):
                self.data.qpos[a] = float(v)
            mujoco.mj_forward(self.model, self.data)
            reached = np.array(self.data.site_xpos[self.payload_site])
        finally:
            self.data.qpos[:], self.data.qvel[:], self.data.ctrl[:] = snapshot[0], snapshot[1], snapshot[2]
            self.data.time = snapshot[3]
            mujoco.mj_forward(self.model, self.data)
        residual = float(np.linalg.norm(reached - target))
        sag = self.gravity_sag(q)
        return {"targets": [round(float(v), 6) for v in q], "gravitySag": [round(float(v), 6) for v in sag], "pdTargets": [round(float(v), 6) for v in q + sag],
                "reachedPosM": [round(float(v), 6) for v in reached], "residualM": round(residual, 6), "exact": len(self.actuators) == 1}

    def gravity_sag(self, q: np.ndarray) -> np.ndarray:
        """@description How far each position servo settles from its target under the static load at pose q: the model's own
        bias force (gravity, at rest) over kp, in joint units. The PD baseline adds it to the inverse-kinematics targets so a
        held load sits ON the target instead of load / kp below it. The plant's state is restored."""
        snapshot = (self.data.qpos.copy(), self.data.qvel.copy(), float(self.data.time))
        try:
            self.data.qvel[:] = 0.0
            for a, v in zip(self.qpos_adr, q):
                self.data.qpos[a] = float(v)
            mujoco.mj_forward(self.model, self.data)
            bias = np.array([float(self.data.qfrc_bias[d]) for d in self.dof_adr])
        finally:
            self.data.qpos[:], self.data.qvel[:] = snapshot[0], snapshot[1]
            self.data.time = snapshot[2]
            mujoco.mj_forward(self.model, self.data)
        return bias / np.array([a["kp"] for a in self.actuators])

    def _site_at(self, q: np.ndarray) -> np.ndarray:
        for a, v in zip(self.qpos_adr, q):
            self.data.qpos[a] = float(v)
        mujoco.mj_forward(self.model, self.data)
        return np.array(self.data.site_xpos[self.payload_site])

    def _ik_single(self, target: np.ndarray) -> np.ndarray:
        """@description One joint: a slide moves the payload along its world axis (q = the projection); a hinge moves it on a circle about the axis (q = the angle between the rest radius and the target's)."""
        q0 = self.rest_targets.copy()
        p0 = self._site_at(q0)
        jid = self.jnt_ids[0]
        axis = np.array(self.data.xaxis[jid])
        if self.model.jnt_type[jid] == mujoco.mjtJoint.mjJNT_SLIDE:
            return q0 + np.array([float(np.dot(target - p0, axis))])
        anchor = np.array(self.data.xanchor[jid])
        r0 = (p0 - anchor) - np.dot(p0 - anchor, axis) * axis
        r1 = (target - anchor) - np.dot(target - anchor, axis) * axis
        if np.linalg.norm(r0) < 1e-9 or np.linalg.norm(r1) < 1e-9:
            return q0
        angle = math.atan2(float(np.dot(np.cross(r0, r1), axis)), float(np.dot(r0, r1)))
        return q0 + np.array([angle])

    def _ik_dls(self, target: np.ndarray) -> np.ndarray:
        """@description Damped least squares over the actuated joints from the rest pose: IK_ITERATIONS steps or until the payload is within a tenth of a millimetre."""
        q = self.rest_targets.copy()
        jac = np.zeros((3, self.model.nv))
        for _ in range(IK_ITERATIONS):
            p = self._site_at(q)
            err = target - p
            if np.linalg.norm(err) < 1e-4:
                break
            mujoco.mj_jacSite(self.model, self.data, jac, None, self.payload_site)
            j = jac[:, self.dof_adr]
            dq = j.T @ np.linalg.solve(j @ j.T + IK_DAMPING * np.eye(3), err)
            q = np.clip(q + IK_STEP * dq, self.ranges[:, 0], self.ranges[:, 1])
        return q


# -- the bridge's dispatch ------------------------------------------------------------------------------------------
_SESSIONS: dict[str, PlantSession] = {}
_TOUCHED: dict[str, float] = {}
_LOCK = threading.Lock()
_RUN_LOCK = threading.Lock()
_JOBS: dict[str, dict] = {}


def _sweep() -> None:
    now = time.monotonic()
    for key in [k for k, t in _TOUCHED.items() if now - t > IDLE_DROP_S]:
        _SESSIONS.pop(key, None)
        _TOUCHED.pop(key, None)


def _job_view(job: dict) -> dict:
    return {k: job[k] for k in ("file", "policyFile", "project", "seed", "timesteps", "state", "startedAt", "elapsedS", "stepsDone", "error") if k in job}


def _start_training(req: dict, report_dir: str) -> dict:
    """@description A long run: the report is written when it finishes; one job per report file at a time."""
    from tasks.plant_reach import report_file, run_training  # noqa: PLC0415 -- torch only when training
    project = _ident(req.get("project"), "project")
    seed = int(req.get("seed", 0))
    timesteps = int(req.get("timesteps", 0))
    file = report_file(project, seed)
    with _LOCK:
        running = _JOBS.get(file)
        if running and running["state"] == "running":
            refuse("busy", f"{file} is already training ({running['stepsDone']} of {running['timesteps']} steps)")
        job = {"file": file, "project": project, "seed": seed, "timesteps": timesteps, "state": "running", "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "elapsedS": 0.0, "stepsDone": 0, "error": None, "policyFile": None, "t0": time.monotonic()}
        _JOBS[file] = job

    def progress(done: int) -> None:
        job["stepsDone"] = int(done)
        job["elapsedS"] = round(time.monotonic() - job["t0"], 1)

    def run() -> None:
        with _RUN_LOCK:
            try:
                report = run_training(req.get("spec"), req.get("task"), project, seed, timesteps, report_dir, req.get("seeds"), progress)
                job.update({"state": "done", "policyFile": report.get("policyFile"), "stepsDone": timesteps})
            except Exception as error:  # the job carries its own failure; the bridge's log has the trace
                job.update({"state": "failed", "error": f"{type(error).__name__}: {error}"})
            job["elapsedS"] = round(time.monotonic() - job["t0"], 1)
    threading.Thread(target=run, name=f"plant-train-{project}-{seed}", daemon=True).start()
    return {"started": True, **_job_view(job)}


def plant_op(op: str, req: dict, report_dir: str | None = None) -> dict:
    """@description Serve one `plant.*` request: load {spec, session?, seed?, controller?}, reset, step {targets | command},
    state, ik {targetPosM}, drop, train {spec, task, project, seed, timesteps, seeds?} (timesteps 0 scores the baseline now;
    more starts a job), jobs, certify {file, spec?, seeds?}. Sessions under this module's own lock; the runs under their own.
    @param op The command. @param req The request. @param report_dir Where reports and policies live. @returns The result."""
    if op == "plant.train":
        if not report_dir:
            refuse("no_report_dir", "the engine has no report directory to write a report to")
        if int(req.get("timesteps", 0)) > 0:
            return _start_training(req, report_dir)
        from tasks.plant_reach import run_training  # noqa: PLC0415
        with _RUN_LOCK:
            return run_training(req.get("spec"), req.get("task"), _ident(req.get("project"), "project"), int(req.get("seed", 0)), 0, report_dir, req.get("seeds"), None)
    if op == "plant.jobs":
        with _LOCK:
            return {"jobs": [_job_view(j) for j in _JOBS.values()]}
    if op == "plant.certify":
        from tasks.plant_reach import certify_policy  # noqa: PLC0415 -- torch only when a policy is replayed
        with _RUN_LOCK:
            seeds = req.get("seeds")
            return certify_policy(req.get("file"), report_dir, req.get("spec"), list(seeds) if isinstance(seeds, list) and seeds else None)
    with _LOCK:
        _sweep()
        session = str(req.get("session", DEFAULT_SESSION))
        if op == "plant.load":
            plant = PlantSession(req.get("spec"), int(req.get("seed", 0)), report_dir)
            plant.set_controller(req.get("controller"))
            _SESSIONS[session] = plant
            _TOUCHED[session] = time.monotonic()
            return {**plant.info(), "session": session}
        if op == "plant.drop":
            _TOUCHED.pop(session, None)
            return {"dropped": _SESSIONS.pop(session, None) is not None}
        plant = _SESSIONS.get(session)
        if plant is None:
            refuse("no_session", f"no plant session {session!r}: plant.load first")
        _TOUCHED[session] = time.monotonic()
        return _session_op(op, req, plant)


def _session_op(op: str, req: dict, plant: PlantSession) -> dict:
    if op == "plant.reset":
        return plant.reset(req.get("seed"))
    if op == "plant.step":
        if "targets" not in req and "command" in req:
            return plant.step_command(req.get("command"), float(req.get("dtS", CONTROL_DT_S)))
        return plant.step(req.get("targets"), float(req.get("dtS", CONTROL_DT_S)))
    if op == "plant.state":
        return {**plant.state(), "info": plant.info()}
    if op == "plant.ik":
        return plant.ik_targets(req.get("targetPosM"))
    refuse("unknown_command", f"unknown plant command {op!r}")
    return {}
