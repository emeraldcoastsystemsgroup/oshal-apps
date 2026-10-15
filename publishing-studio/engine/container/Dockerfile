# CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Original pinned Typst and PDF assembly run without system fonts, root privileges or a writable image.
FROM python@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' \
  'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261006T000000Z bookworm main' \
  'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261006T000000Z bookworm-security main' > /etc/apt/sources.list \
  && apt-get update && apt-get install -y --no-install-recommends poppler-utils \
  && dpkg-query -W > /opt/publishing-system-packages.txt && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/publishing-engine
COPY worker.py server.py prepare-runtime.py requirements.txt source-lock.json layout.typ NOTICE install-engine.sh ./
COPY fonts/ ./fonts/
COPY licenses/ ./licenses/
COPY container/ ./container/
RUN python prepare-runtime.py --root /opt/publishing-runtime --allow-download \
  && chmod 0555 /opt/publishing-runtime
ENV PUBLISHING_ENGINE_HOST=0.0.0.0 PUBLISHING_ENGINE_PORT=7419 OSHAL_PUBLISHING_TYPST=/opt/publishing-runtime/typst PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 7419
CMD ["/opt/publishing-runtime/python/bin/python", "server.py"]
