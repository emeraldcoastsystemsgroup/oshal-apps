# Scene Studio engine container -- built LOCALLY by engine/install-engine.sh. Nothing third-party is
# committed to the package and the image is never published: every upstream piece is downloaded here
# and checked against the digest (or the commit) pinned below before it is used.
#
#   Godot 4.7.2-stable        official linux.arm64 build              sha256 of the release zip
#   Blender 5.1.0             CoconutMacaroon/blender-arm64 v10-5.1   sha256 of the release tarball
#                             (no official Blender build for linux/aarch64 exists; see docs/ARCHITECTURE.md)
#   godot-mcp                 Coding-Solo/godot-mcp @ 1209744         sha256 of the commit tarball
#   Blender Lab MCP v1.0.3    projects.blender.org/lab/blender_mcp    commit 2cea8d5 asserted after clone
#   Node 24.21.0              the official node image (godot-mcp's runtime)
#   Ubuntu 24.04 packages     Blender's shared libraries, from the Ubuntu archive
#
# linux/arm64 only for now (the DGX Spark); install-engine.sh refuses other machines with the reason.

# ── godot-mcp: build from the pinned commit with its own lockfile ───────────────────────────────
FROM node:24.21.0-bookworm-slim AS godot-mcp
ARG GODOT_MCP_COMMIT=1209744fad78f3998f98c7394fd0f6ef50da5281
ARG GODOT_MCP_SHA256=6be9f5925a3223aeb3e3820ae033250bfb16ff0605d0199830c98ea835c215e4
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL -o godot-mcp.tar.gz "https://codeload.github.com/Coding-Solo/godot-mcp/tar.gz/${GODOT_MCP_COMMIT}" \
 && echo "${GODOT_MCP_SHA256}  godot-mcp.tar.gz" | sha256sum -c - \
 && tar -xzf godot-mcp.tar.gz \
 && cd "godot-mcp-${GODOT_MCP_COMMIT}" \
 && npm ci --no-audit --no-fund \
 && npm prune --omit=dev --no-audit --no-fund \
 && mkdir -p /opt/godot-mcp \
 && cp -r build node_modules package.json LICENSE /opt/godot-mcp/

# ── Godot, Blender and the Blender Lab MCP source: download and verify ──────────────────────────
FROM ubuntu:24.04 AS fetch
ARG GODOT_SHA256=5dd0d86405cf7e8adf79fb6377b38ba682a2846cb378ffe5364f38c01ad29b9d
ARG BLENDER_SHA256=f8c41e767bfb8e42c0e3190ec5132c3bae413c568a17664388341c67d543ab1a
ARG BLENDER_MCP_COMMIT=2cea8d566dde07fbac28a61d698909d69724e853
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /fetch
RUN curl -fsSL -o godot.zip "https://github.com/godotengine/godot-builds/releases/download/4.7.2-stable/Godot_v4.7.2-stable_linux.arm64.zip" \
 && echo "${GODOT_SHA256}  godot.zip" | sha256sum -c - \
 && unzip -q godot.zip \
 && install -D -m 0755 Godot_v4.7.2-stable_linux.arm64 /opt/godot/godot \
 && rm -f godot.zip Godot_v4.7.2-stable_linux.arm64
# The release is a whole CMake build tree (~2.4 GB unpacked); only the binary, its data tree and its
# bundled shared libraries are runtime.
RUN curl -fsSL -o blender.tar.xz "https://github.com/CoconutMacaroon/blender-arm64/releases/download/v10-5.1/blender-v10.tar.xz" \
 && echo "${BLENDER_SHA256}  blender.tar.xz" | sha256sum -c - \
 && tar -xJf blender.tar.xz ./cmake-make/bin/blender ./cmake-make/bin/5.1 ./cmake-make/libExt \
 && mkdir -p /opt/blender/bin \
 && mv cmake-make/bin/blender cmake-make/bin/5.1 /opt/blender/bin/ \
 && mv cmake-make/libExt /opt/blender/lib \
 && rm -rf cmake-make blender.tar.xz
RUN git clone -q --depth 1 --branch v1.0.3 https://projects.blender.org/lab/blender_mcp.git /fetch/blender_mcp \
 && test "$(git -C /fetch/blender_mcp rev-parse HEAD)" = "${BLENDER_MCP_COMMIT}" \
 && mkdir -p /opt/blender-mcp-src \
 && cp -r /fetch/blender_mcp/mcp/. /opt/blender-mcp-src/ \
 && rm -rf /fetch/blender_mcp

# ── The engine ──────────────────────────────────────────────────────────────────────────────────
FROM ubuntu:24.04
ARG GODOT_MCP_COMMIT=1209744fad78f3998f98c7394fd0f6ef50da5281
ARG BLENDER_MCP_COMMIT=2cea8d566dde07fbac28a61d698909d69724e853
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# Blender's shared libraries: the build author's list, apt resolves the rest; then the X11/GL/audio
# libraries a desktop has and a container does not (Blender links them even when it never opens a window).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv ca-certificates fontconfig \
      libatlas3-base libavdevice60 libavfilter9 libblas3 libblosc1 libbs2b0 libfftw3-double3 libfftw3-single3 \
      libflite1 libgfortran5 libopenexr-3-1-30 libimath-3-1-29t64 libjack0 libjemalloc2 liblapack3 liblilv-0-0 \
      libosdcpu3.5.0t64 libosdgpu3.5.0t64 libplacebo338 libpocketsphinx3 libpotrace0 libpugixml1v5 libpystring0 \
      librubberband2 libsdl2-2.0-0 libserd-0-0 libshaderc1 libsndio7.0 libsord-0-0 libsphinxbase3t64 libsratom-0-0 \
      libvidstab1.1 libyaml-cpp0.8 libzimg2 libzix-0-0 libgif7 libheif1 libraw23t64 libwebpdemux2 \
      libgoogle-glog0v6t64 libgflags2.2 libspnav0 libmetis5 libboost-iostreams1.83.0 \
      libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libice6 libxext6 \
      libgl1 libegl1 libglx0 libopengl0 libwayland-client0 libwayland-cursor0 libwayland-egl1 libdecor-0-0 \
      libdbus-1-3 libfreetype6 libfontconfig1 libepoxy0 libvulkan1 libgomp1 libsndfile1 libopenal1 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin scene
COPY --from=godot-mcp /usr/local/bin/node /usr/local/bin/node
COPY --from=godot-mcp /opt/godot-mcp /opt/godot-mcp
COPY --from=fetch /opt/godot /opt/godot
COPY --from=fetch /opt/blender /opt/blender
COPY --from=fetch /opt/blender-mcp-src /opt/blender-mcp-src
COPY requirements.txt requirements-lock.txt /opt/scene-studio/engine/
RUN python3 -m venv /opt/blender-mcp/venv \
 && /opt/blender-mcp/venv/bin/pip install -r /opt/scene-studio/engine/requirements.txt \
      -c /opt/scene-studio/engine/requirements-lock.txt \
 && /opt/blender-mcp/venv/bin/pip install --no-deps /opt/blender-mcp-src
# The launchers every job uses: Godot forced headless; Blender with its bundled libraries and a fixed
# thread count, so one render cannot take every core of the box.
RUN mkdir -p /opt/scene-studio/bin \
 && printf '#!/bin/sh\nexec /opt/godot/godot --headless "$@"\n' > /opt/scene-studio/bin/godot-headless \
 && printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/blender/lib\nexec /opt/blender/bin/blender --threads "${SCENE_STUDIO_THREADS:-4}" "$@"\n' > /opt/scene-studio/bin/blender \
 && chmod 0755 /opt/scene-studio/bin/godot-headless /opt/scene-studio/bin/blender \
 && if LD_LIBRARY_PATH=/opt/blender/lib ldd /opt/blender/bin/blender | grep 'not found'; then echo 'Blender is missing shared libraries' >&2; exit 1; fi \
 && GV="$(HOME=/tmp /opt/godot/godot --headless --version | tail -n 1)" \
 && BV="$(HOME=/tmp LD_LIBRARY_PATH=/opt/blender/lib /opt/blender/bin/blender --factory-startup --version | head -n 1)" \
 && NV="$(/usr/local/bin/node --version)" \
 && printf '{"godot":"%s","blender":"%s","node":"%s","godotMcp":"Coding-Solo/godot-mcp@%s","blenderMcp":"Blender Lab MCP v1.0.3@%s"}\n' \
      "$GV" "$BV" "$NV" "$GODOT_MCP_COMMIT" "$BLENDER_MCP_COMMIT" > /opt/scene-studio/versions.json \
 && cat /opt/scene-studio/versions.json
COPY . /opt/scene-studio/engine
ENV SCENE_STUDIO_ENGINE_DIR=/opt/scene-studio/engine \
    SCENE_STUDIO_CONTAINER=1 \
    SCENE_STUDIO_THREADS=4 \
    HOME=/tmp \
    TMPDIR=/tmp
USER scene
WORKDIR /opt/scene-studio/engine
EXPOSE 7414
CMD ["python3", "/opt/scene-studio/engine/container/scene_engine_bridge.py"]
