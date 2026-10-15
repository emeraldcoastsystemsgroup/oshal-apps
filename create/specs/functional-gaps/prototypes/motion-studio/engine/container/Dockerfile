# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Build the locked real compositor on digest-pinned official Rust/Node images; retain runtime and dependency notices.
# Verified official image versions: rust:1.99.0-bookworm, node:24.21.0-bookworm-slim.
FROM node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime-base
FROM rust@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS builder
COPY --from=runtime-base /usr/local/bin/node /usr/local/bin/node
WORKDIR /build/motion-engine
COPY . ./
RUN --mount=type=cache,target=/usr/local/cargo/registry,id=oshal-motion-registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,id=oshal-motion-git,sharing=locked \
    --mount=type=cache,target=/build/motion-engine/target,id=oshal-motion-target,sharing=locked \
    cargo build --release --locked --jobs 2 \
    && cp target/release/oshal-motion-engine /motion-worker \
    && cargo metadata --locked --format-version 1 > /tmp/motion-cargo-metadata.json \
    && node container/dependency-notices.mjs /tmp/motion-cargo-metadata.json /notices
FROM runtime-base AS runtime
WORKDIR /opt/motion-engine
COPY --from=builder /motion-worker /usr/local/bin/oshal-motion-engine
COPY --from=builder /notices /opt/motion-dependency-notices
COPY . ./
ENV MOTION_ENGINE_BINARY=/usr/local/bin/oshal-motion-engine \
    MOTION_ENGINE_HOST=0.0.0.0 MOTION_ENGINE_PORT=7414
USER 10001:10001
EXPOSE 7414
CMD ["node", "bridge.mjs"]
