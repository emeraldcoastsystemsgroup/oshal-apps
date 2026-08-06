"""
CHANGE LOG
-------------------------------------------------------------------------------
SEQ                 | AUTHOR                      | DESCRIPTION
-------------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com   | Restored the copy-tree mutation harness
  |                                           | required by the sweep-integrity gate.
  |                                           | Mutants are patched only inside a fresh
  |                                           | temporary aerosim copy, guards import that
  |                                           | copy first, and exact patch/path checks fail
  |                                           | closed before any subprocess runs.
-------------------------------------------------------------------------------

AUDIT_mutations -- run destructive mutation probes without touching the live engine tree.

The old operational failure this harness exists to prevent was mutate -> test -> restore against
the live checkout. A concurrent sweep imported the temporarily corrupted file and recorded fantasy
survivors. This module has no in-place mode: every mutation gets a disposable copy containing the
fingerprinted ``aerosim`` package, and every guard subprocess puts that copy first on PYTHONPATH.

Public helpers
    make_tree_copy(parent_dir)  -> directory containing a faithful ``aerosim`` copy
    run_mutant(spec)            -> structured patch/guard outcome

A mutation spec is a mapping with ``path`` (relative to the engine root), exact ``old`` and ``new``
text, and ``guards`` (each a list of Python interpreter arguments, normally ``["-c", code]``).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence


ENGINE_ROOT: Path = Path(__file__).resolve().parent
SOURCE_PACKAGE: Path = ENGINE_ROOT / "aerosim"
DEFAULT_GUARD_TIMEOUT_S: float = 120.0


def make_tree_copy(parent_dir: str | os.PathLike[str]) -> Path:
    """
    @description Copy the fingerprinted evaluation package into a fresh child directory. The
                 caller owns deletion; the live source is read-only throughout this operation.
    @param parent_dir Existing directory under which the disposable root is created.
    @returns Absolute Path whose ``aerosim`` child is a byte-faithful source copy.
    @raises FileNotFoundError when the source package or parent directory is absent.
    """
    parent = Path(parent_dir).resolve()
    if not parent.is_dir():
        raise FileNotFoundError(f"mutation-copy parent does not exist: {parent}")
    if not SOURCE_PACKAGE.is_dir():
        raise FileNotFoundError(f"aerosim source package does not exist: {SOURCE_PACKAGE}")

    copy_root = Path(tempfile.mkdtemp(prefix="aerosim-mutation-", dir=parent))
    shutil.copytree(
        SOURCE_PACKAGE,
        copy_root / "aerosim",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"),
    )
    return copy_root


def _copy_target(copy_root: Path, relative_path: str) -> Path:
    """Resolve a mutation target inside the disposable root and reject traversal."""
    target = (copy_root / relative_path).resolve()
    try:
        target.relative_to(copy_root.resolve())
    except ValueError as exc:
        raise ValueError(
            f"mutation path escapes its disposable tree: {relative_path!r}"
        ) from exc
    if not target.is_file():
        raise FileNotFoundError(f"mutation target does not exist in copy: {relative_path}")
    return target


def _apply_exact_patch(target: Path, old: str, new: str) -> None:
    """Replace exactly one occurrence so a stale mutation cannot silently test nothing."""
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise ValueError(
            f"mutation expected exactly one occurrence in {target}, found {count}: {old!r}"
        )
    target.write_text(source.replace(old, new, 1), encoding="utf-8", newline="")


def run_mutant(
    mutation: Mapping[str, Any],
    *,
    quiet: bool = False,
    timeout_s: float = DEFAULT_GUARD_TIMEOUT_S,
) -> dict[str, Any]:
    """
    @description Patch one disposable tree and execute its Python guards. The live engine is never
                 a write target. A non-zero guard exit means the mutant died; a patch mismatch,
                 invalid path or timeout is returned as a loud harness failure, not a false kill.
    @param mutation Mapping with name/path/old/new/guards.
    @param quiet Suppress the one-line human report; structured output is unchanged.
    @param timeout_s Per-guard wall-clock ceiling, seconds > 0.
    @returns Dict with name, patched, died, guard_results and optional error.
    """
    name = str(mutation.get("name", "unnamed mutation"))
    outcome: dict[str, Any] = {
        "name": name,
        "patched": False,
        "died": False,
        "guard_results": [],
    }
    if not (float(timeout_s) > 0.0):
        outcome["error"] = f"timeout_s must be > 0, got {timeout_s!r}"
        return outcome

    try:
        relative_path = str(mutation["path"])
        old = str(mutation["old"])
        new = str(mutation["new"])
        guards = list(mutation["guards"])
    except (KeyError, TypeError) as exc:
        outcome["error"] = f"invalid mutation spec: {exc}"
        return outcome
    if not old or old == new:
        outcome["error"] = "mutation old text must be non-empty and differ from new text"
        return outcome
    if not guards:
        outcome["error"] = "mutation has no guards; survival/death cannot be observed"
        return outcome

    try:
        with tempfile.TemporaryDirectory(prefix="aerosim-mutation-run-") as temp_dir:
            copy_root = make_tree_copy(temp_dir)
            target = _copy_target(copy_root, relative_path)
            _apply_exact_patch(target, old, new)
            outcome["patched"] = True

            env = os.environ.copy()
            prior_pythonpath = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = str(copy_root) + (
                os.pathsep + prior_pythonpath if prior_pythonpath else ""
            )
            for raw_guard in guards:
                if not isinstance(raw_guard, Sequence) or isinstance(raw_guard, (str, bytes)):
                    raise TypeError(f"guard must be a sequence of Python arguments: {raw_guard!r}")
                command = [sys.executable, *(str(arg) for arg in raw_guard)]
                completed = subprocess.run(
                    command,
                    cwd=copy_root,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=float(timeout_s),
                    check=False,
                )
                record = {
                    "args": command[1:],
                    "returncode": int(completed.returncode),
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                }
                outcome["guard_results"].append(record)
                if completed.returncode != 0:
                    outcome["died"] = True
                    break
    except (OSError, TypeError, ValueError, subprocess.TimeoutExpired) as exc:
        outcome["error"] = f"{type(exc).__name__}: {exc}"

    if not quiet:
        state = "DIED" if outcome["died"] else "SURVIVED"
        if outcome.get("error"):
            state = "HARNESS ERROR"
        print(f"[{state}] {name}")
    return outcome


__all__ = [
    "DEFAULT_GUARD_TIMEOUT_S",
    "ENGINE_ROOT",
    "make_tree_copy",
    "run_mutant",
]
