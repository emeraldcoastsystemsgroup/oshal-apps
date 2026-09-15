# Circuit Lab engine container -- built LOCALLY by engine/install-engine.sh from the official
# python image plus Debian's ngspice package (the SPICE solver). Nothing third-party is committed
# to the package and the image is never published. The worker is stdlib-only Python driving
# `ngspice -b`; no network, no credentials, read-only root, /tmp for the scratch decks.
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# ngspice (the solver, batch binary AND libngspice0 -- the shared library the firmware co-simulation
# drives so a sketch can read the circuit back); gcc-avr + avr-libc + the Arduino AVR core compile an
# Uno sketch; node runs it in avr8js (MIT, pinned tarball + sha512 from the npm registry) so a
# programmed pin becomes a source in the deck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ngspice libngspice0 gcc-avr avr-libc arduino-core-avr nodejs \
 && rm -rf /var/lib/apt/lists/*
# avr8js is vendored by a COPYed script, never a Dockerfile heredoc: a heredoc RUN is a BuildKit
# feature and the classic builder ran this step silently doing nothing, shipping an image whose
# Arduino path was broken while ngspice still answered. The script verifies what it extracted and
# node loads it, so a build that does not vendor cannot become an image.
COPY container/vendor-avr8js.py /tmp/vendor-avr8js.py
RUN python /tmp/vendor-avr8js.py && rm -f /tmp/vendor-avr8js.py
RUN useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin circuit
COPY . /opt/circuit-lab/engine
ENV CIRCUIT_LAB_ENGINE_DIR=/opt/circuit-lab/engine \
    NGSPICE_BIN=/usr/bin/ngspice \
    AVR8JS_DIR=/opt/circuit-lab/avr8js \
    ARDUINO_CORE_LIB=/opt/circuit-lab/avr-core/core.a \
    HOME=/tmp \
    TMPDIR=/tmp
# the Arduino core compiled once, so a sketch build is one compile and one link
RUN python -c "import sys; sys.path.insert(0, '/opt/circuit-lab/engine/firmware'); import arduino_build as b; print(b.build_core('/opt/circuit-lab/avr-core'))"
USER circuit
WORKDIR /opt/circuit-lab/engine
EXPOSE 7413
CMD ["python", "/opt/circuit-lab/engine/container/circuit_engine_bridge.py"]
