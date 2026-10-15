# CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Digest-pinned Python and dated Debian repositories with hash-pinned PDF library.
FROM python@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' \
  'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261006T000000Z bookworm main' \
  'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261006T000000Z bookworm-security main' > /etc/apt/sources.list \
  && apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng fonts-dejavu-core \
  && dpkg-query -W > /opt/pdf-system-packages.txt && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/pdf-engine
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes --no-deps -r requirements.txt
COPY worker.py server.py ./
ENV PDF_ENGINE_HOST=0.0.0.0 PDF_ENGINE_PORT=7415 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 7415
CMD ["python", "server.py"]
