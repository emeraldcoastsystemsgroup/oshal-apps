"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the vendored
  |                                           | real-chain design sweep. The R6/R7 driver
  |                                           | that ranked the 30k set on the IDEAL chain
  |                                           | never shipped with the package; this one
  |                                           | does: a seeded, library-independent sampler
  |                                           | over service.BOUNDS (seed + sample hash in
  |                                           | the header), every design evaluated through
  |                                           | build_solar_cruise(chain="real") with the
  |                                           | structured reasons certify_reference emits,
  |                                           | every record stamped with the tree
  |                                           | fingerprint it was scored against, output
  |                                           | as resumable JSONL, and verify_survivor on
  |                                           | the top-N before anything is promoted.

sweep_real -- the pinned real-chain design sweep (aero-lab BACKLOG section D).

    python sweep_real.py --out output/sweep-real-30k.jsonl [--n 30000] [--seed 20260927]
                         [--dt-s 60] [--resume] [--verify-top N] [--report]

PINNED. Design i of seed s is a pure function of (s, i, field): each unit
draw is the first 64 bits of sha256("s:i:field"), so the sample set does not
depend on numpy's generator streams or the machine. The header records the
seed, n, the sha256 of every vector in order (sampleHash) and of the bounds.

FIXED-WING. buoyancy_fraction is held at 0: verify_survivor re-builds a
survivor from its _SolarCruiseDesign alone, and the buoyant attachment lives
in service.py, so a hybrid survivor could not be re-confirmed. The R6/R7
sweep this replaces was a fixed-wing sweep too.

FINGERPRINTED. The header carries service._fingerprint() and
validate_screen.tree_fingerprint(); each design record carries the tree
fingerprint measured just before it was scored. A tree that changes mid-run
stops the sweep (SweepIntegrityError); a --resume against a changed tree is
refused, never mixed into the same file.

RESUMABLE. --resume re-reads the file, drops a torn last line, refuses a
header that disagrees with the arguments, and appends only the indices not
yet recorded, in order. Records carry no wall-clock, so the same arguments on
the same tree produce the same bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
if _ENGINE_DIR not in sys.path:
    sys.path.insert(0, _ENGINE_DIR)

import service  # noqa: E402 - the sweep maps vectors exactly as the service does

SCHEMA = "aero-lab.sweep-real/1"
DEFAULT_N = 30000
DEFAULT_SEED = 20260927
SWEEP_WINDOW_S = 86400.0
SWEEP_DT_S = 60.0
SWEEP_BUOYANCY_FRACTION = 0.0

#: Header fields a resume must match exactly (the tree is checked separately).
_PINNED_FIELDS = ("schema", "seed", "n", "sampleHash", "boundsHash", "chain",
                  "windowS", "dtS", "buoyancyFraction")


class SweepConfigError(ValueError):
    """@description The output file's header disagrees with the requested
        sweep, or the file would be overwritten without --resume."""


def _canon(obj) -> str:
    """@description Canonical JSON (sorted keys, no spaces, no NaN).
    @param obj JSON-safe value.
    @returns The string."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _unit(seed: int, index: int, key: str) -> float:
    """@description One pinned unit draw in [0, 1).
    @param seed Sweep seed.  @param index Design index.  @param key Field name.
    @returns float in [0, 1)."""
    digest = hashlib.sha256(f"{seed}:{index}:{key}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2.0 ** 64


def sample_vector(seed: int, index: int) -> dict:
    """@description Design `index` of the pinned sample: uniform inside
        service.BOUNDS per field, day_of_year rounded, buoyancy held at 0.
    @param seed Sweep seed.  @param index Design index.
    @returns The wire design vector."""
    v: dict = {}
    for key in sorted(service.BOUNDS):
        if key == "buoyancy_fraction":
            v[key] = SWEEP_BUOYANCY_FRACTION
            continue
        lo, hi = service.BOUNDS[key]
        x = lo + (hi - lo) * _unit(seed, index, key)
        v[key] = int(round(x)) if key in service.INT_KEYS else x
    return v


def sample_hash(seed: int, n: int) -> str:
    """@description sha256 over every vector of the sample, in index order.
    @param seed Sweep seed.  @param n Sample size.
    @returns 64-hex digest."""
    h = hashlib.sha256()
    for i in range(n):
        h.update(_canon(sample_vector(seed, i)).encode("utf-8") + b"\n")
    return h.hexdigest()


def _hooks():
    """@description The service's modules and vector handling as certify hooks.
    @returns (hooks, certify_reference module, module registry)."""
    m = service._require("certify")
    cert = m["certify_reference"]
    hooks = cert.ServiceHooks(
        modules=m, validate_vector=service._validate_vector,
        to_design=service._to_design, attach_buoyancy=service._attach_buoyancy,
        fingerprint=service._fingerprint())
    return hooks, cert, m


def make_header(seed: int, n: int, dt_s: float, tree_fp: str) -> dict:
    """@description The sweep's identity line.
    @param seed Seed.  @param n Size.  @param dt_s Step, s.
    @param tree_fp validate_screen.tree_fingerprint() now.
    @returns The header record."""
    return {"type": "header", "schema": SCHEMA, "seed": int(seed), "n": int(n),
            "sampleHash": sample_hash(seed, n),
            "boundsHash": hashlib.sha256(_canon(
                {k: list(b) for k, b in service.BOUNDS.items()}).encode()).hexdigest(),
            "engineFingerprint": service._fingerprint(), "treeFingerprint": tree_fp,
            "chain": "real", "windowS": SWEEP_WINDOW_S, "dtS": float(dt_s),
            "buoyancyFraction": SWEEP_BUOYANCY_FRACTION}


def read_sweep(path: str) -> tuple[dict | None, list[dict], int]:
    """@description Parse a sweep file, tolerating one torn trailing line.
    @param path JSONL path.
    @returns (header | None, records, byte length of the complete lines)."""
    if not os.path.exists(path):
        return None, [], 0
    with open(path, "rb") as fh:
        raw = fh.read()
    header, records, good = None, [], 0
    for line in raw.splitlines(keepends=True):
        if not line.endswith(b"\n"):
            break  # a torn last write -- resume re-scores that index
        obj = json.loads(line)
        if obj.get("type") == "header":
            header = obj
        else:
            records.append(obj)
        good += len(line)
    return header, records, good


def _check_resume(header: dict | None, want: dict) -> None:
    """@description Refuse a resume whose pinned identity or tree differs.
    @param header The file's header.  @param want The header these args make.
    @raises SweepConfigError On a missing header or a pinned-field mismatch.
    @raises SweepIntegrityError On a stale tree fingerprint."""
    if header is None:
        raise SweepConfigError("sweep file has no header; refusing to resume into it")
    diff = [k for k in _PINNED_FIELDS if header.get(k) != want.get(k)]
    if diff:
        raise SweepConfigError(f"sweep header disagrees with the request on {diff}")
    if header.get("treeFingerprint") != want["treeFingerprint"]:
        err = service._load_engine()["validate_screen"].SweepIntegrityError
        raise err(f"sweep was scored against tree {str(header.get('treeFingerprint'))[:12]}... "
                  f"but the current tree is {want['treeFingerprint'][:12]}... -- start a "
                  f"new sweep file, do not mix trees")


def run_sweep(out: str, n: int = DEFAULT_N, seed: int = DEFAULT_SEED,
              dt_s: float = SWEEP_DT_S, resume: bool = False,
              progress=None) -> dict:
    """@description Score every not-yet-recorded design and append it.
    @param out JSONL path.  @param n Size.  @param seed Seed.  @param dt_s Step, s.
    @param resume Continue an existing file (required when it exists).
    @param progress Optional callable(index, record) for logging.
    @returns {evaluated, skipped, path}."""
    hooks, cert, m = _hooks()
    screen = m["validate_screen"]
    want = make_header(seed, n, dt_s, screen.tree_fingerprint())
    header, records, good = read_sweep(out)
    if header is not None or records:
        if not resume:
            raise SweepConfigError(f"{out} exists; pass --resume to continue it")
        _check_resume(header, want)
    done = {int(r["index"]) for r in records if r.get("type") == "design"}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "r+b" if good or header is not None else "wb") as fh:
        fh.truncate(good)
        fh.seek(good)
        if header is None:
            fh.write((_canon(want) + "\n").encode("utf-8"))
        evaluated = 0
        for i in range(n):
            if i in done:
                continue
            fh.write((_canon(_score(hooks, cert, screen, want, seed, i)) + "\n").encode("utf-8"))
            fh.flush()
            evaluated += 1
            if progress is not None:
                progress(i, evaluated)
    return {"evaluated": evaluated, "skipped": len(done), "path": out}


def _score(hooks, cert, screen, want: dict, seed: int, index: int) -> dict:
    """@description Score one design, stamped with the tree it ran against.
    @param hooks Certify hooks.  @param cert certify_reference.
    @param screen validate_screen.  @param want The header.
    @param seed Seed.  @param index Design index.
    @returns The JSON-safe design record.
    @raises SweepIntegrityError When the tree changed since the header."""
    fp = screen.tree_fingerprint()
    if fp != want["treeFingerprint"]:
        raise screen.SweepIntegrityError(
            f"tree changed mid-sweep at design {index}: {fp[:12]}... != "
            f"{want['treeFingerprint'][:12]}...")
    v = sample_vector(seed, index)
    rec = cert.certify_preset(hooks, {"key": f"d{index}", "name": f"d{index}", "v": v},
                              window_s=want["windowS"], dt_s=want["dtS"])
    rec.pop("key", None)
    rec.pop("name", None)
    return service._json_safe({"type": "design", "index": index, "treeFingerprint": fp,
                               "vectorHash": hashlib.sha256(_canon(v).encode()).hexdigest()[:16],
                               "vector": v, **rec})


def verify_top(out: str, top: int) -> list[dict]:
    """@description Re-confirm the top-N passing designs (by usable margin,
        ties by index) in fresh subprocesses on the real chain, and append a
        verify record for each.
    @param out JSONL path.  @param top How many.
    @returns The verify records appended."""
    header, records, _good = read_sweep(out)
    hooks, _cert, m = _hooks()
    passing = [r for r in records if r.get("type") == "design" and r.get("outcome") == "pass"]
    passing.sort(key=lambda r: (-float(r["metrics"]["usable"]), int(r["index"])))
    appended = []
    for rec in passing[:max(0, int(top))]:
        design, _w, _f = hooks.to_design(m, service._validate_vector(rec["vector"]))
        verdict = m["validate_screen"].verify_survivor(
            design, expected_fingerprint=header["treeFingerprint"],
            check_seasonal=False, chain="real")
        appended.append(service._json_safe({
            "type": "verify", "index": rec["index"], "verdict": verdict,
            "agrees": bool(verdict["closed"]) == bool(rec["metrics"]["closed"])
            and bool(verdict["admissible"]) == bool(rec["metrics"]["admissible"])}))
    with open(out, "ab") as fh:
        for obj in appended:
            fh.write((_canon(obj) + "\n").encode("utf-8"))
    return appended


def report(out: str, top: int = 10) -> dict:
    """@description Summarise a sweep file: outcomes, reason-code histogram,
        the ranked top-N and any verify records.
    @param out JSONL path.  @param top Ranked entries to list.
    @returns The summary dict."""
    header, records, _good = read_sweep(out)
    designs = [r for r in records if r.get("type") == "design"]
    outcomes: dict = {}
    codes: dict = {}
    for r in designs:
        outcomes[r["outcome"]] = outcomes.get(r["outcome"], 0) + 1
        for reason in r.get("reasons") or []:
            name = reason["code"] + (f":{reason['rule']}" if "rule" in reason else "")
            codes[name] = codes.get(name, 0) + 1
    passing = sorted((r for r in designs if r["outcome"] == "pass"),
                     key=lambda r: (-float(r["metrics"]["usable"]), int(r["index"])))
    return {"header": header, "recorded": len(designs),
            "complete": bool(header) and len(designs) == int(header["n"]),
            "outcomes": dict(sorted(outcomes.items())),
            "reasonCodes": dict(sorted(codes.items(), key=lambda kv: (-kv[1], kv[0]))),
            "top": [{"index": r["index"], "usable": r["metrics"]["usable"],
                     "minSoc": r["metrics"]["minSoc"]} for r in passing[:top]],
            "verified": [r for r in records if r.get("type") == "verify"]}


def main(argv: list[str] | None = None) -> int:
    """@description CLI entry point.
    @param argv Arguments (sys.argv[1:] when None).
    @returns Exit code."""
    ap = argparse.ArgumentParser(description="aero-lab pinned real-chain sweep")
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=DEFAULT_N)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--dt-s", type=float, default=SWEEP_DT_S)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--verify-top", type=int, default=0)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args(argv)
    if not (args.report and os.path.exists(args.out) and args.verify_top == 0
            and not args.resume):
        result = run_sweep(args.out, args.n, args.seed, args.dt_s, args.resume,
                           progress=lambda i, k: service._log(f"sweep design {i} scored ({k} this run)"))
        service._log(f"sweep: {result}")
    if args.verify_top > 0:
        verify_top(args.out, args.verify_top)
    if args.report:
        sys.stdout.write(json.dumps(report(args.out), indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
