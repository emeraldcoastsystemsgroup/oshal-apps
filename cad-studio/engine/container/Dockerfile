# CAD Studio engine container -- built LOCALLY by engine/install-engine.sh from the official
# python image plus the exact PyPI pins in requirements.txt / requirements-lock.txt (CadQuery on
# the OCCT kernel). Nothing third-party is committed to the package and the image is never
# published. The OCCT wheels link against libGL/X11 even headless, hence the runtime libs.
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglu1-mesa libxrender1 libxext6 libx11-6 libfontconfig1 libfreetype6 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10002 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin cad
COPY requirements.txt requirements-lock.txt /opt/cad-studio/engine/
RUN python -m venv /opt/cad-studio/venv \
 && /opt/cad-studio/venv/bin/pip install -r /opt/cad-studio/engine/requirements.txt \
      -c /opt/cad-studio/engine/requirements-lock.txt
COPY . /opt/cad-studio/engine
ENV PATH=/opt/cad-studio/venv/bin:$PATH \
    CAD_STUDIO_ENGINE_DIR=/opt/cad-studio/engine \
    HOME=/tmp \
    TMPDIR=/tmp
USER cad
WORKDIR /opt/cad-studio/engine
EXPOSE 7412
CMD ["python", "/opt/cad-studio/engine/container/cad_engine_bridge.py"]
