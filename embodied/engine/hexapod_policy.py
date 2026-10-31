"""
CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                    | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 / B30 -- the policy runtime for the Pi (NumPy only, no torch,
    |                                           | no MuJoCo): a certified policy is exported -- through the gate's door,
    |                                           | load_certified -- into a weights file carrying its layers, the
    |                                           | geometry it was certified on, the certificate's summary and the zip's
    |                                           | sha256, verified against the torch policy on random observations
    |                                           | before it is written. NodePolicyPlayer plays that file on any body:
    |                                           | it observes exactly what the task showed the policy (the observation
    |                                           | builder here is proven equal to the task's) and shapes the CPG
    |                                           | through the mirror rule the node decides. Refusals are exception
    |                                           | classes named as their wire code, as the plant's are.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ENGINE_DIR)
from hexapod_gaits import ACTUATOR_ORDER, GaitShape, LegGeometry, clamp_command, cpg_targets  # noqa: E402

#: The weights file sits beside the policy it was exported from: `<policy>.weights.json`.
WEIGHTS_SUFFIX = ".weights.json"
#: The observation scales the task uses (tasks/hexapod_walk.py); test_hexapod_policy proves the two builders equal.
VEL_SCALE = 10.0
ACCEL_SCALE = 10.0
#: How far the exported network may stray from the torch one on random observations before the export is refused.
EXPORT_TOLERANCE = 1e-5
EXPORT_SAMPLES = 256


class PolicyRefused(Exception):
    """@description A refusal by name: the class NAME is the wire code, as the plant's refusals are."""

    def __init__(self, because: str) -> None:
        super().__init__(because)
        self.because = because


_REFUSALS: dict[str, type] = {}


def refuse(code: str, because: str):
    """@description Raise the refusal named `code`. @param code The wire code. @param because Why. @raises PolicyRefused always."""
    cls = _REFUSALS.get(code)
    if cls is None:
        cls = type(code, (PolicyRefused,), {"__doc__": f"@description The `{code}` refusal."})
        _REFUSALS[code] = cls
    raise cls(because)


def observation(state: dict, prev_action, cmd_tuple) -> np.ndarray:
    """@description What the policy sees, built from the brief's state dict: joint positions and velocities in
    ACTUATOR_ORDER, the gyro, the accelerometer, the previous action, the command. @param state The state.
    @param prev_action The last action. @param cmd_tuple (vx, vy, yaw rate), clamped. @returns The float32 vector."""
    return np.concatenate([
        np.array(state["jointPosRad"], dtype=float), np.array(state["jointVelRadS"], dtype=float) / VEL_SCALE, np.array(state["gyroRadS"], dtype=float) / VEL_SCALE,
        np.array(state["accelMps2"], dtype=float) / ACCEL_SCALE, np.asarray(prev_action, dtype=float), np.array(cmd_tuple, dtype=float),
    ]).astype(np.float32)


def weights_path(policy_path: str) -> str:
    """@description Where a policy's weights file lives. @param policy_path The zip (or its stem). @returns `<stem>.weights.json`."""
    stem = policy_path[:-4] if policy_path.endswith(".zip") else policy_path
    return stem + WEIGHTS_SUFFIX


def file_sha256(path: str) -> str:
    """@description A file's digest. @param path The file. @returns Hex sha256."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def geometry_to_dict(geo: LegGeometry) -> dict:
    """@description The geometry as JSON carries it. @param geo The plant's geometry. @returns Plain lists and numbers."""
    return {"mounts": {leg: list(v) for leg, v in geo.mounts.items()}, "coxaAxisZ": dict(geo.coxa_axis_z), "coxaM": geo.coxa_m, "femurM": geo.femur_m,
            "footCentreM": geo.foot_centre_m, "footRadiusM": geo.foot_radius_m, "standHeightM": geo.stand_height_m, "bodyHalfHeightM": geo.body_half_height_m,
            "limits": {name: list(v) for name, v in geo.limits.items()}}


def geometry_from_dict(d: dict) -> LegGeometry:
    """@description The geometry back from JSON. @param d geometry_to_dict's shape. @returns The LegGeometry. @raises bad_geometry when a field is missing."""
    try:
        return LegGeometry(mounts={leg: tuple(float(x) for x in v) for leg, v in d["mounts"].items()}, coxa_axis_z={leg: float(v) for leg, v in d["coxaAxisZ"].items()},
                           coxa_m=float(d["coxaM"]), femur_m=float(d["femurM"]), foot_centre_m=float(d["footCentreM"]), foot_radius_m=float(d["footRadiusM"]),
                           stand_height_m=float(d["standHeightM"]), body_half_height_m=float(d["bodyHalfHeightM"]),
                           limits={name: (float(v[0]), float(v[1])) for name, v in d["limits"].items()})
    except (KeyError, TypeError, ValueError) as error:
        refuse("bad_geometry", f"the weights file's geometry is not the plant's shape: {error}")
        raise


class NumpyPolicy:
    """@description A small multilayer perceptron in NumPy: the layers an SB3 MlpPolicy's actor is made of, the output
    clipped to [-1, 1] as `predict` clips it."""

    def __init__(self, layers: list[tuple[np.ndarray, np.ndarray, str | None]]) -> None:
        self.layers = [(np.asarray(w, dtype=np.float64), np.asarray(b, dtype=np.float64), act) for w, b, act in layers]

    @classmethod
    def from_doc(cls, doc: dict) -> "NumpyPolicy":
        """@description The network out of a weights file. @param doc The JSON. @returns The policy. @raises bad_weights."""
        try:
            layers = [(np.array(layer["w"], dtype=float), np.array(layer["b"], dtype=float), layer.get("act")) for layer in doc["layers"]]
        except (KeyError, TypeError, ValueError) as error:
            refuse("bad_weights", f"the weights file carries no readable layers: {error}")
            raise
        for w, b, act in layers:
            if w.ndim != 2 or b.shape != (w.shape[0],) or act not in (None, "tanh"):
                refuse("bad_weights", f"a layer is not (out x in, out, tanh|null): {w.shape}, {b.shape}, {act!r}")
        return cls(layers)

    def act(self, obs) -> np.ndarray:
        """@description One deterministic action. @param obs The observation. @returns The action in [-1, 1]."""
        x = np.asarray(obs, dtype=np.float64).reshape(-1)
        for w, b, act in self.layers:
            x = w @ x + b
            if act == "tanh":
                x = np.tanh(x)
        return np.clip(x, -1.0, 1.0)


def _actor_layers(model) -> list[tuple[np.ndarray, np.ndarray, str | None]]:
    """@description The actor's layers out of an SB3 MlpPolicy: Linear/Tanh pairs then the action head. @raises bad_weights on any other shape."""
    import torch.nn as nn  # noqa: PLC0415 -- torch only on the engine side
    policy = model.policy
    if type(policy.features_extractor).__name__ != "FlattenExtractor" or getattr(policy, "squash_output", False):
        refuse("bad_weights", "only a flat MlpPolicy with an unsquashed Gaussian head is exported")
    layers: list[tuple[np.ndarray, np.ndarray, str | None]] = []
    pending: tuple[np.ndarray, np.ndarray] | None = None
    for module in policy.mlp_extractor.policy_net:
        if isinstance(module, nn.Linear):
            if pending is not None:
                layers.append((pending[0], pending[1], None))
            pending = (module.weight.detach().cpu().numpy(), module.bias.detach().cpu().numpy())
        elif isinstance(module, nn.Tanh) and pending is not None:
            layers.append((pending[0], pending[1], "tanh"))
            pending = None
        else:
            refuse("bad_weights", f"the actor carries a module the runtime does not play: {type(module).__name__}")
    if pending is not None:
        layers.append((pending[0], pending[1], None))
    layers.append((policy.action_net.weight.detach().cpu().numpy(), policy.action_net.bias.detach().cpu().numpy(), None))
    return layers


def export_policy(policy_path: str, geometry: LegGeometry, out_path: str | None = None, samples: int = EXPORT_SAMPLES) -> dict:
    """@description Export a CERTIFIED policy for the Pi: through load_certified (refused by name otherwise), the actor's
    layers, the geometry it is played on, the certificate's summary, the zip's sha256, and the parity measured against the
    torch policy on random observations (refused above EXPORT_TOLERANCE). @param policy_path The zip. @param geometry The
    plant's geometry. @param out_path The weights file (beside the zip by default). @returns The document written."""
    from tasks.hexapod_certify import load_certified  # noqa: PLC0415 -- the gate's door, engine side only
    from tasks.hexapod_walk import RESIDUAL_RAD  # noqa: PLC0415
    model, cert = load_certified(policy_path)
    layers = _actor_layers(model)
    numpy_policy = NumpyPolicy(layers)
    obs_size = int(model.policy.observation_space.shape[0])
    rng = np.random.default_rng(0)
    worst = 0.0
    for _ in range(max(1, samples)):
        obs = rng.standard_normal(obs_size).astype(np.float32)
        torch_action, _ = model.predict(obs, deterministic=True)
        worst = max(worst, float(np.max(np.abs(np.asarray(torch_action, dtype=float) - numpy_policy.act(obs)))))
    if worst > EXPORT_TOLERANCE:
        refuse("export_mismatch", f"the NumPy actor strays {worst:.2e} from the torch one (tolerance {EXPORT_TOLERANCE:.0e})")
    doc = {"policyFile": os.path.basename(policy_path), "policySha256": file_sha256(policy_path), "recipe": cert.get("mode", "shape"), "residualRad": RESIDUAL_RAD,
           "obsSize": obs_size, "actSize": int(model.policy.action_space.shape[0]), "scales": {"vel": VEL_SCALE, "accel": ACCEL_SCALE},
           "layers": [{"w": w.tolist(), "b": b.tolist(), "act": act} for w, b, act in layers], "geometry": geometry_to_dict(geometry),
           "certificate": {k: cert.get(k) for k in ("ok", "certifiedTask", "buildHash", "limits", "policyBeatsBaseline", "refusedCount", "checked", "certifiedAt", "reportFile")},
           "parity": {"samples": samples, "maxAbsDiff": worst, "tolerance": EXPORT_TOLERANCE}}
    with open(out_path or weights_path(policy_path), "w", encoding="utf-8") as fh:
        json.dump(doc, fh)
    return doc


class NodePolicyPlayer:
    """@description The node's brain: a weights file played on any body. Every control period it observes the body's state,
    asks the network for the gait shape (or the residual, by recipe) and makes the eighteen targets through the mirror rule
    the node decided. Refuses a weights file whose certificate summary is not ok."""

    def __init__(self, path: str) -> None:
        if not os.path.isfile(path):
            refuse("policy_not_found", f"no weights file {os.path.basename(path)}")
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        cert = doc.get("certificate") or {}
        if cert.get("ok") is not True:
            refuse("policy_not_certified", f"{os.path.basename(path)} was exported from a policy the gate refused or never saw")
        self.file = os.path.basename(path)
        self.policy_file = str(doc.get("policyFile", ""))
        self.policy_sha256 = str(doc.get("policySha256", ""))
        self.weights_sha256 = file_sha256(path)
        self.recipe = str(doc.get("recipe", "shape"))
        self.residual_rad = float(doc.get("residualRad", 0.0))
        self.n_act = int(doc.get("actSize", GaitShape.SIZE))
        self.policy = NumpyPolicy.from_doc(doc)
        self.geo = geometry_from_dict(doc.get("geometry") or {})
        self.certificate = cert
        self.reset()

    @property
    def name(self) -> str:
        """@description The controller as the load reply names it. @returns policy:<zip>."""
        return f"policy:{self.policy_file}"

    def reset(self) -> None:
        """@description A new episode: the gait clock and the previous action start over."""
        self.t = 0.0
        self.prev_action = np.zeros(self.n_act)

    def targets(self, state: dict, cmd, inverted: bool, dt: float) -> list[float]:
        """@description The eighteen targets for this control period, already through the mirror rule. @param state The
        body's state. @param cmd (vx, vy, yaw rate) or {vx, vy, yawRate}. @param inverted The node's decision. @param dt The
        period. @returns Targets in ACTUATOR_ORDER."""
        cmd_dict = cmd if isinstance(cmd, dict) else {"vx": cmd[0], "vy": cmd[1], "yawRate": cmd[2]}
        c = clamp_command(cmd_dict)
        a = self.policy.act(observation(state, self.prev_action, c))
        if self.recipe == "shape":
            targets = np.array(cpg_targets(self.geo, self.t, cmd_dict, bool(inverted), GaitShape.from_action(a)))
        else:
            targets = np.array(cpg_targets(self.geo, self.t, cmd_dict, bool(inverted))) + self.residual_rad * a
        self.prev_action = a
        self.t += float(dt)
        return [self.geo.clamp(name, float(v)) for name, v in zip(ACTUATOR_ORDER, targets)]
