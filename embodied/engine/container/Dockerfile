# Embodied physics engine container -- built LOCALLY by engine/install-engine.sh from the official
# python image plus the exact PyPI pins in requirements.txt / requirements-lock.txt (MuJoCo,
# Gymnasium, NumPy; Stable-Baselines3 with CPU-only PyTorch for the training lane). Nothing
# third-party is committed to the package and the image is never published. No renderer: every
# sensor is a batched ray cast, so no GL libraries are needed.
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN useradd --system --uid 10003 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin embodied
COPY requirements.txt requirements-lock.txt /opt/embodied/engine/
RUN python -m venv /opt/embodied/venv \
 && /opt/embodied/venv/bin/pip install --extra-index-url https://download.pytorch.org/whl/cpu \
      -r /opt/embodied/engine/requirements.txt -c /opt/embodied/engine/requirements-lock.txt
COPY . /opt/embodied/engine
ENV PATH=/opt/embodied/venv/bin:$PATH \
    EMBODIED_ENGINE_DIR=/opt/embodied/engine \
    MUJOCO_GL=disable \
    HOME=/tmp \
    TMPDIR=/tmp
USER embodied
WORKDIR /opt/embodied/engine
EXPOSE 7413 7414 7415
CMD ["python", "/opt/embodied/engine/container/embodied_engine_bridge.py"]
