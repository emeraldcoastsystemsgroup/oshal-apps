#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendor the pinned avr8js tarball as a FILE the
#   |                                           | Dockerfile COPYs and runs, not as a heredoc. The
#   |                                           | heredoc form (`RUN python - <<'PY' ... PY`) is a
#   |                                           | BuildKit feature: under the classic builder the
#   |                                           | step ran, printed nothing, created nothing, and
#   |                                           | the image shipped with no avr8js at all -- the
#   |                                           | engine answered ordinary circuits and refused
#   |                                           | every Arduino sketch with MODULE_NOT_FOUND
#   |                                           | (measured on the operator's box 2026-09-15).
#   |                                           | This script verifies what it extracted and exits
#   |                                           | non-zero otherwise, so a build that does not
#   |                                           | vendor cannot become an image.
"""Download the pinned avr8js tarball, verify its sha512, extract it, and prove the result loads.

The integrity pin is the npm registry's own `dist.integrity` for avr8js 0.21.1. Nothing third-party
is committed to this package; the tarball is fetched at image-build time and never published.
"""
import base64
import hashlib
import io
import os
import subprocess
import sys
import tarfile
import urllib.request

URL = "https://registry.npmjs.org/avr8js/-/avr8js-0.21.1.tgz"
WANT_SHA512 = "lS1vPaB0gB2GXoPrHFQOUG/5CRORjvnmjbs8SiPZdJpt4HkV0+v6HnNeXxo/X9lPqumqphls2Qyql8zsw9rBaw=="
DEST = os.environ.get("AVR8JS_DIR", "/opt/circuit-lab/avr8js")
NODE = os.environ.get("NODE_BIN", "node")


def main() -> int:
    """@description Fetch, verify, extract and load-check avr8js. @returns 0 when the vendored copy is usable."""
    data = urllib.request.urlopen(URL, timeout=120).read()
    got = base64.b64encode(hashlib.sha512(data).digest()).decode()
    if got != WANT_SHA512:
        print(f"avr8js tarball integrity mismatch: {got}", file=sys.stderr)
        return 1
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        members = [m for m in tar.getmembers() if m.name.startswith("package/") and m.isfile()]
        for m in members:
            m.name = m.name[len("package/"):]
        tar.extractall(DEST, members=members)
    if not members:
        print("avr8js tarball contained no package/ files", file=sys.stderr)
        return 1
    # The image is useless without these: avr8js_run.js requires the directory as a CommonJS module.
    entry = os.path.join(DEST, "package.json")
    if not os.path.isfile(entry):
        print(f"avr8js did not extract: {entry} is missing", file=sys.stderr)
        return 1
    probe = subprocess.run([NODE, "-e", f"const a=require({DEST!r}); if(!a.CPU) throw new Error('avr8js has no CPU export'); console.log('avr8js loads')"],
                           capture_output=True, text=True)
    if probe.returncode != 0:
        print(f"vendored avr8js does not load: {probe.stderr.strip()[:400]}", file=sys.stderr)
        return 1
    print(f"avr8js 0.21.1 vendored into {DEST}, {len(members)} files, {probe.stdout.strip()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
