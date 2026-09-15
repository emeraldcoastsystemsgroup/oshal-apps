#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- compile an Arduino sketch for
#   |                                           | the Uno (ATmega328P at 16 MHz) with Debian's avr-gcc and
#   |                                           | the Arduino AVR core, then run it in avr8js (node) for a
#   |                                           | given number of seconds and return every digital pin
#   |                                           | edge as a timeline the SPICE deck turns into PWL
#   |                                           | sources. The core is compiled once at image build into
#   |                                           | core.a (build_core); a sketch compile is then one
#   |                                           | avr-g++ call and one link. Results are cached per
#   |                                           | (sketch, seconds) within the worker process.
# 2 | maintainer@emeraldcoastsystemsgroup.com   | The INPUT half (BACKLOG B1): run_firmware_cosim compiles the
#   |                                           | same sketch and hands the HEX to cosim.py, which steps the
#   |                                           | AVR and the ngspice transient together so digitalRead and
#   |                                           | analogRead see the solver's node voltages. The co-simulation
#   |                                           | gets its own process (libngspice is a process singleton) and
#   |                                           | its result is NOT cached -- it depends on the circuit, not
#   |                                           | only on the sketch.
# 3 | maintainer@emeraldcoastsystemsgroup.com   | available() also requires the vendored avr8js module:
#   |                                           | the image can be built without it and then reported
#   |                                           | firmware support it did not have, so every sketch
#   |                                           | failed at run time with MODULE_NOT_FOUND while the
#   |                                           | capability said the lane was ready.
"""arduino_build -- avr-gcc + arduino core + avr8js, stdlib only."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

import cosim

CORE_SRC = os.environ.get("ARDUINO_CORE_DIR", "/usr/share/arduino/hardware/arduino/avr/cores/arduino")
VARIANT = os.environ.get("ARDUINO_VARIANT_DIR", "/usr/share/arduino/hardware/arduino/avr/variants/standard")
CORE_LIB = os.environ.get("ARDUINO_CORE_LIB", "/opt/circuit-lab/avr-core/core.a")
RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "avr8js_run.js")
NODE = os.environ.get("NODE_BIN", "node")
# The avr8js module avr8js_run.js requires. available() checks it because the image can be built
# WITHOUT it (a vendoring step that silently did nothing), and a capability that says the firmware
# lane works when a sketch cannot run is worse than one that says it does not.
AVR8JS_DIR = os.environ.get("AVR8JS_DIR", "/opt/circuit-lab/avr8js")
# DECIMAL_DIG: the Arduino AVR core 1.8.7 (Debian) sizes String's float buffers with it, and avr-gcc 5.4's
# float.h does not define it in C++ mode; 9 is the float (= AVR double) value.
MCU_FLAGS = ["-mmcu=atmega328p", "-DF_CPU=16000000L", "-DDECIMAL_DIG=9", "-DARDUINO=10807", "-DARDUINO_AVR_UNO", "-DARDUINO_ARCH_AVR", "-Os", "-ffunction-sections", "-fdata-sections", "-fno-exceptions", "-w"]
MAX_ERROR = 600
MAX_FIRMWARE_SECONDS = 10.0
COSIM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cosim.py")
MAX_COSIM_SECONDS = 600
MAX_CACHED = 16  # the worker lives as long as the api's connection; keep the newest runs only
_cache = {}


class BuildError(Exception):
    """@description The sketch did not compile; `detail` is the compiler's own words."""

    def __init__(self, detail):
        super().__init__(detail)
        self.detail = detail


def available():
    """@description True when the toolchain, the core archive, node AND the vendored avr8js are present."""
    return (all(shutil.which(b) for b in ("avr-gcc", "avr-g++", "avr-objcopy", NODE))
            and os.path.exists(CORE_LIB) and os.path.isdir(CORE_SRC)
            and os.path.isfile(os.path.join(AVR8JS_DIR, "package.json")))


def build_core(out_dir):
    """@description Compile the Arduino AVR core into out_dir/core.a (run once at image build)."""
    os.makedirs(out_dir, exist_ok=True)
    objects = []
    for name in sorted(os.listdir(CORE_SRC)):
        if not name.endswith((".c", ".cpp", ".S")):
            continue
        src = os.path.join(CORE_SRC, name)
        obj = os.path.join(out_dir, name + ".o")
        tool = "avr-gcc" if name.endswith((".c", ".S")) else "avr-g++"
        extra = ["-std=gnu11"] if name.endswith(".c") else (["-x", "assembler-with-cpp"] if name.endswith(".S") else ["-std=gnu++11", "-fpermissive", "-fno-threadsafe-statics"])
        subprocess.run([tool, "-c"] + MCU_FLAGS + extra + ["-I", CORE_SRC, "-I", VARIANT, src, "-o", obj], check=True)
        objects.append(obj)
    lib = os.path.join(out_dir, "core.a")
    if os.path.exists(lib):
        os.remove(lib)
    subprocess.run(["avr-ar", "rcs", lib] + objects, check=True)
    return lib


def compile_sketch(sketch, work):
    """@description sketch text -> path of the Intel HEX; raises BuildError with the compiler's message."""
    src = os.path.join(work, "sketch.cpp")
    with open(src, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("#include <Arduino.h>\n#line 1 \"sketch.ino\"\n" + sketch + "\n")
    obj, elf, hexf = os.path.join(work, "sketch.o"), os.path.join(work, "sketch.elf"), os.path.join(work, "sketch.hex")
    r = subprocess.run(["avr-g++", "-c"] + MCU_FLAGS + ["-std=gnu++11", "-fpermissive", "-fno-threadsafe-statics", "-I", CORE_SRC, "-I", VARIANT, src, "-o", obj], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise BuildError(r.stderr.strip()[-MAX_ERROR:] or "avr-g++ failed")
    r = subprocess.run(["avr-gcc", "-Os", "-mmcu=atmega328p", "-Wl,--gc-sections", obj, CORE_LIB, "-lm", "-o", elf], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise BuildError(r.stderr.strip()[-MAX_ERROR:] or "link failed")
    subprocess.run(["avr-objcopy", "-O", "ihex", "-R", ".eeprom", elf, hexf], check=True, timeout=60)
    size = subprocess.run(["avr-size", "-A", elf], capture_output=True, text=True, timeout=30).stdout
    flash = sum(int(line.split()[1]) for line in size.splitlines() if line.split() and line.split()[0] in (".text", ".data"))
    return hexf, flash


def run_firmware(sketch, seconds, timeout=120):
    """@description Compile and run a sketch; returns {pins: {"D13": [[t, level], ...]}, modes: {...},
    serial, cycles, seconds, flashBytes}. Cached per (sketch, seconds) in this process."""
    seconds = min(float(seconds), MAX_FIRMWARE_SECONDS)
    key = (hashlib.sha256(sketch.encode("utf-8")).hexdigest(), round(seconds, 6))
    if key in _cache:
        return _cache[key]
    work = tempfile.mkdtemp(prefix="circuit-lab-fw-")
    try:
        hexf, flash = compile_sketch(sketch, work)
        r = subprocess.run([NODE, RUNNER, hexf, str(seconds)], capture_output=True, text=True, timeout=timeout, cwd=work)
        if r.returncode != 0:
            raise BuildError("avr8js: " + (r.stderr.strip()[-MAX_ERROR:] or "the firmware runner failed"))
        out = json.loads(r.stdout)
        out["flashBytes"] = flash
        _cache[key] = out
        while len(_cache) > MAX_CACHED:
            _cache.pop(next(iter(_cache)))
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cosim_available():
    """@description True when the closed loop can be run at all: the AVR toolchain AND libngspice.
    False keeps the open-loop path, which is a real answer for a sketch that reads nothing."""
    return available() and cosim.available()


def run_firmware_cosim(sketch, request, timeout=MAX_COSIM_SECONDS):
    """@description Compile the sketch and co-simulate it with the deck in `request` (netlist,
    external sources, feedback nodes, sync step). Returns the same shape as run_firmware plus a
    `coSim` record. Not cached: the same sketch in a different circuit is a different run."""
    work = tempfile.mkdtemp(prefix="circuit-lab-cosim-")
    try:
        hexf, flash = compile_sketch(sketch, work)
        payload = dict(request, hex=hexf)
        r = subprocess.run([sys.executable, COSIM], input=json.dumps(payload), capture_output=True, text=True, timeout=timeout, cwd=work)
        if r.returncode != 0 or not r.stdout.strip():
            raise cosim.CosimError(*_cosim_error(r))
        out = json.loads(r.stdout)
        out["flashBytes"] = flash
        return out
    except subprocess.TimeoutExpired:
        raise cosim.CosimError(f"the co-simulation did not finish within {timeout} s; raise sim.syncSeconds or shorten stopSeconds", "sim.stopSeconds")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _cosim_error(r):
    """@description (detail, code) from the child's JSON error, falling back to its own words."""
    try:
        err = json.loads(r.stderr)
        return err.get("error", "the co-simulation failed"), err.get("code", "cosim")
    except (ValueError, TypeError):
        return (r.stderr.strip()[-MAX_ERROR:] or "the co-simulation produced no result"), "engine"
