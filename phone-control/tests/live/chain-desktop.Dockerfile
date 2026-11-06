# CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T5: a plain Ubuntu 24.04 desktop standing in for the person's computer next to their phones - an X server, a window manager and a terminal, the libraries Electron needs, and the system python3 with python3-dbus and python3-gi that the phone bridge uses, and zlib1g-dev because the AppImage runtime loads the unversioned libz.so. apt's package lists stay, so Set up this computer can download adb without root as it does on a real computer. No Bluetooth and no system message bus: the bridge must say so. node comes from the official image only to run the proof driver.
FROM node:22-bookworm-slim AS node
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth openbox xterm x11-utils x11-xserver-utils xdotool imagemagick fonts-dejavu-core locales ca-certificates zlib1g-dev \
    libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgtk-3-0t64 libgbm1 libasound2t64 libxss1 libxtst6 libsecret-1-0 \
    python3 python3-dbus python3-gi \
    && locale-gen en_US.UTF-8
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
