"""HTML -> PDF via the system headless Chromium.

Run as a subprocess so it never collides with Flask's threading / any asyncio loop:
    python -m jobhunter.render input.html output.pdf

Uses the system Chromium directly (chromium --headless --print-to-pdf) instead of the
Playwright PyPI package, which has no musl/Alpine wheel and cannot be pip-installed in the
container. Page size + margins come from each template's @page CSS (prefer-css-page-size
behaviour), and `--virtual-time-budget` waits for the page to settle before printing
(the equivalent of Playwright's wait_until="networkidle").
"""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _chromium_binary() -> str:
    """Resolve a usable Chromium/Chrome executable (env override first, then PATH)."""
    candidates = [
        os.environ.get("PLAYWRIGHT_CHROMIUM_PATH"),
        os.environ.get("CHROMIUM_PATH"),
        shutil.which("chromium-browser"),
        shutil.which("chromium"),
        shutil.which("google-chrome"),
        shutil.which("chrome"),
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise RuntimeError(
        "No Chromium binary found for PDF rendering. Install `chromium` "
        "(apk add chromium) or set PLAYWRIGHT_CHROMIUM_PATH."
    )


def html_to_pdf(html_path: str, pdf_path: str) -> None:
    uri = Path(html_path).resolve().as_uri()
    out = str(Path(pdf_path).resolve())
    exe = _chromium_binary()
    cmd = [
        exe,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",                 # container runs as root
        "--hide-scrollbars",
        "--no-pdf-header-footer",       # no default date/URL header+footer
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=10000",  # let network/CSS/fonts settle (≈ networkidle)
        f"--print-to-pdf={out}",
        uri,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if not Path(out).exists() or Path(out).stat().st_size == 0:
        raise RuntimeError(
            f"Chromium PDF render failed (exit {proc.returncode}): "
            f"{(proc.stderr or proc.stdout or '')[-600:]}"
        )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python -m jobhunter.render input.html output.pdf", file=sys.stderr)
        sys.exit(2)
    html_to_pdf(sys.argv[1], sys.argv[2])
    print(sys.argv[2])
