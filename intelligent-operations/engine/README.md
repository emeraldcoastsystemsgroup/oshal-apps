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

When engine source changes, regenerate `identity.json` using SHA-256 of `percolation.py` followed
by `server.py`. The deployment annotation uses that digest to replace the engine pod. Install the
matching committed application package; a mismatch refuses processing.

In Data & decisions, refresh processing, choose a saved source, publish its policy, select at most
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
