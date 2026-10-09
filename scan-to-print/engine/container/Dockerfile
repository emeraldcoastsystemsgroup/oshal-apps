# Scan to Print slicer engine container -- built LOCALLY by engine/install-engine.sh from the
# official ubuntu:24.04 image plus the OrcaSlicer release AppImage pinned (version + sha256) in
# orcaslicer-lock.txt. Nothing third-party is committed to the package and the image is never
# published. The AppImage is unpacked rather than mounted (no FUSE in a container); its CLI links
# the GTK/WebKit/GL stack even when it never opens a window, hence the runtime libraries below.
FROM ubuntu:24.04
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-pil \
      libgtk-3-0t64 libwebkit2gtk-4.1-0 libsoup-3.0-0 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
      libgl1 libglu1-mesa libegl1 libopengl0 libwayland-egl1 libsm6 libice6 libxkbcommon0 \
      libsecret-1-0 libmspack0t64 libdbus-1-3 \
 && rm -rf /var/lib/apt/lists/*
COPY orcaslicer-lock.txt /tmp/orcaslicer-lock.txt
RUN set -eu; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    line=$(grep -E "^${arch}[[:space:]]" /tmp/orcaslicer-lock.txt) || { echo "no OrcaSlicer pin for ${arch}" >&2; exit 1; }; \
    sum=$(echo "$line" | awk '{print $3}'); url=$(echo "$line" | awk '{print $4}'); \
    curl -fsSL -o /tmp/orca.AppImage "$url"; \
    echo "$sum  /tmp/orca.AppImage" | sha256sum -c -; \
    chmod +x /tmp/orca.AppImage; \
    cd /opt && /tmp/orca.AppImage --appimage-extract >/dev/null; \
    mv /opt/squashfs-root /opt/orcaslicer; \
    rm -f /tmp/orca.AppImage /tmp/orcaslicer-lock.txt; \
    chmod -R a+rX /opt/orcaslicer
RUN useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin slicer
COPY . /opt/scan-to-print/engine
ENV SCAN_TO_PRINT_ENGINE_DIR=/opt/scan-to-print/engine \
    ORCA_SLICER_DIR=/opt/orcaslicer \
    HOME=/tmp \
    TMPDIR=/tmp
USER slicer
WORKDIR /opt/scan-to-print/engine
EXPOSE 7414
CMD ["python3", "/opt/scan-to-print/engine/container/slicer_engine_bridge.py"]
