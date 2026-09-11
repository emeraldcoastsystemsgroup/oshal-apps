# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the aero-lab
#   |                                           | engine image. Built LOCALLY on the box by
#   |                                           | ../install-engine.sh from upstream sources
#   |                                           | (the official python image + the exact PyPI
#   |                                           | pins); it is never published, and nothing
#   |                                           | third-party is committed to the package.
#
# Why a separate image: the oshal api image is Alpine (musl) and casadi 3.7.2,
# which AeroSandbox imports, ships glibc-only wheels. python:3.11-slim is glibc
# and is the interpreter line the validation campaign ran on.
#
# Build context = the package's engine/ directory; ../.dockerignore whitelists
# exactly the runtime tree (the same file set the build hash covers).

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --system --uid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin aero

# Dependencies first so an engine-code change reuses this (large) layer. The lock
# is a CONSTRAINTS file: every package that installs is held to the version the
# validation interpreter ran, without pulling the lock's dev-only extras.
COPY requirements.txt requirements-lock.txt /opt/aero-lab/engine/
RUN python -m venv /opt/aero-lab/venv \
 && /opt/aero-lab/venv/bin/pip install -r /opt/aero-lab/engine/requirements.txt \
      -c /opt/aero-lab/engine/requirements-lock.txt

COPY . /opt/aero-lab/engine

ENV PATH=/opt/aero-lab/venv/bin:$PATH \
    AERO_LAB_ENGINE_DIR=/opt/aero-lab/engine \
    HOME=/tmp \
    MPLCONFIGDIR=/tmp/matplotlib \
    XDG_CACHE_HOME=/tmp/.cache

USER aero
WORKDIR /opt/aero-lab/engine
EXPOSE 7411
CMD ["python", "/opt/aero-lab/engine/container/aero_engine_bridge.py"]
