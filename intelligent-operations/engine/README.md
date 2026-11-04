# Detection engine

This package service performs real stored-query publication and matching on OpenSearch. It has
three bounded commands: health, publish and match. OSHAL's existing admitted engine relay owns
caller access; package code derives the index scope and verifies `identity.json` against the hello.
The service is not a public API. Install it on a private endpoint reachable only by the kernel.

The guarded ARM64 local-lab installer is `python3 intelligent-operations/lab/detection.py deploy`.
It installs the pinned OpenSearch 3.3.2 image and engine in one pod with persistent search data,
no service-account token, resource limits and a kernel-only ingress policy. Search listens on pod
loopback only; its security plugin is disabled for this isolated instance. The sole Service exposes
the typed engine port. The installer preserves other package engine mappings when setting the
native `OSHAL_PACKAGE_ENGINES` binding. Kernel replacement requires reconnecting the local portal
port-forward. This helper targets the owned lab, not a general production installation.

On a Docker host such as the Spark (native kernel on bare metal) the same engine runs as its own
compose project: `sh intelligent-operations/engine/install-engine.sh [listen-port]` (default 37420)
starts `engine/container/compose.yaml`, the digest-pinned OpenSearch 3.3.2 on a private network only
and the engine (official `python:3.13-slim`, this folder's `server.py`, `percolation.py` and
`identity.json` mounted read-only, read-only root, no capabilities, user 1000) joined to
`oshal-native-engines` with no published port. It waits for yellow search health, runs the
hello/health exchange the package performs and refuses unless the hello equals `identity.json`. The
kernel reaches the engine only through the loopback link unit `oshal-native-operations-link.service`,
which resolves the container's address when it starts; every run recreates the engine, so when that
user unit exists (`systemctl --user cat` succeeds) the installer restarts it and proves the restart
before reporting it: within 5 s the unit must be active (`systemctl --user is-active`) and the
loopback port parsed from the unit's ExecStart must accept a TCP connect (`python3`
`socket.create_connection`); only then does it say the kernel dials the recreated engine again,
otherwise it prints the unit's last 20 journal lines (`journalctl --user -u
oshal-native-operations-link.service -n 20`) and exits 1. Without the unit it prints the two host steps it never
applies: the `native_container_forward.py` link-unit line and the `OSHAL_PACKAGE_ENGINES` entry; it
writes neither, and the `OSHAL_PACKAGE_ENGINES` pin is never changed by it. Re-run the installer
after an engine change; it recreates only the engine.

The install command is owned by the route, never by a surface (BUILDING-EXTENSIONS.md section 7):
`routes/detection-engine.js` exports `INSTALL_HINT` and, when the kernel relay cannot reach the
engine or the hello's identity digest differs from `identity.json`, refuses with status 503, the
command in the message the surface renders and `installHint` beside the error. A kernel deadline or
a busy engine (a hello of the shape `{"error":"engine-busy"}`, which the kernel relays unchanged
with a null reply) is reported as such without it. The control that reports that state is the
Operations navigation entry **Data pipeline** and its button **Check detection service**
(`experience/index.html`, GET `/pipeline/health`), the on-demand check; publishing or previewing a policy and evaluating report the engine
state with the install hint. The store gate
`scripts/check-engine-container-pattern.mjs` holds this package to that pattern, and
`tests/engine-container.test.cjs` guards the compose, installer and route shape without Docker.

When engine source changes, regenerate `identity.json` using SHA-256 of `percolation.py` followed
by `server.py`. The deployment annotation uses that digest to replace the engine pod. Install the
matching committed application package; a mismatch refuses processing.

In Data pipeline, press Refresh processing, choose a saved source, publish its policy, select at most
20 validated occurrences, and evaluate. Rules support bounded `term`, `terms`, `match`,
`match_phrase`, `exists`, `range` (explicit time bounds), `match_all` and `bool` queries over the
listed normalized fields. Each policy declares its window and each rule chooses whether to request
a snapshot. Unknown query operators are rejected before activation.

Rules are sealed before activation. Backend loss leaves a failed processing attempt and the input
available for retry. Already completed decisions remain readable. A unique evidence reservation
records intent only: the collector/dispatch consumer is a separate unfinished pipeline stage.
Unused rule-generation cleanup, retention, background processing and general installer integration
remain open. SQL decision/history retention must stay aligned with index retention before deleting
any referenced policy generation.

Tests require an explicit disposable PostgreSQL on 127.0.0.1:35689 and OpenSearch on
127.0.0.1:35690, supplied via `OSHAL_TEST_POSTGRES` and `OSHAL_TEST_SEARCH`. They create/drop
isolated databases and test-owned indexes. The CI workflow pins the AMD64 image separately from
the ARM64 lab image. Missing services fail acceptance; they are never silently replaced with mocks.
