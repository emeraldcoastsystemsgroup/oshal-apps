# Developer Workspace Index

`dev-workspace-index` is an opt-in package for the local oshal checkout. It builds a small, cited
index of the checkout's documentation and lets Jarvis answer developer questions from it, but only
for a super-admin whose dev mode is on. Normal Jarvis turns cannot reach it.

## What is indexed

The include/exclude manifest lives in `oshal-app.yaml` under `devWorkspaceIndex:` and the indexer
reads that block (`tools/workspace-manifest.js`), so the manifest is the declaration, not a copy:

- **In:** `CLAUDE.md`, `CONTRIBUTING.md`, `docs/BACKLOG.md`, `docs/adr`, `docs/backlog`,
  `docs/governance`, `docs/runbooks` (`.md`, `.markdown`, `.txt`).
- **Out, always:** any path with a `.git`, `.env*`, `config-seed`, `node_modules`, `lane-clones`,
  `transcripts`, `scratch`, `session-notes` or `COLLABORATE.md` segment.
- **Optional, only when named:** a local notes directory (`--notes-dir <dir>`, indexed under
  `local-notes/`) and the checkout-root `COLLABORATE.md` (`--include-collaborate`).

## The guard

Every file is scanned before it is indexed, and every emitted chunk is scanned again after the
build (`tools/workspace-guard.js`):

- **Secret rules** mirror the core publish gate's vendor-credential families (AWS access keys, PEM
  private-key blocks, headscale/tailscale keys, GitHub/GitLab tokens, Anthropic/OpenAI keys, Slack
  tokens, Google client secrets, DigitalOcean/Shopify tokens) plus signed JWTs and generic
  `api_key/secret/password/token = value` assignments. The gate's own per-line exemptions apply
  (`REPLACE_ME`, `CHANGE_ME`, `example`, `placeholder`, `<...>`, the documented fake key body).
- **Identifier rules** are concrete shapes, not prose: personal email addresses (role mailboxes and
  reserved example domains are allowed), OIDC subject forms such as `google-oauth2|...`, subject
  values in key positions (`sub`, `owner_sub`, `oid`, ...), bare 21-digit subjects and phone numbers
  (the 555 fictional exchange is allowed).
- **Local patterns:** when the checkout carries the gitignored `scripts/publish-gate.local.patterns`
  it is loaded too (`--local-patterns <file>` overrides). A present-but-unreadable or non-compiling
  file stops the build. Only a count is reported; the pattern text is never stored or echoed.
- **Red means red:** a guarded chunk that reaches the index makes the build exit non-zero and names
  the path, chunk id and rule only. `--verify <index.json>` rescans an existing index the same way.

## Build the index

```text
node tools/workspace-index.js --root C:\Projects\oshal
node tools/workspace-index.js --root /home/user/oshal --notes-dir /home/user/oshal-notes
node tools/workspace-index.js --verify data/dev-workspace-index.json --root C:\Projects\oshal
```

The default output is `data/dev-workspace-index.json` inside this package, which is also the file
the route reads (`OSHAL_DEV_WORKSPACE_INDEX_PATH` overrides both). The command prints generated
counts of documents, chunks and skipped files, with skips broken down per rule, plus the number of
local identifier rules loaded. With dev mode on, `GET /api/dev-workspace-index/status` reports the same
counts plus `sources`, the document count per source (`checkout`, `local-notes`), so an index built
without `--notes-dir` is visible as such.

## Dev mode is the gate

Reading the index needs four things, in this order, and the refusal names the first one missing:

1. `OSHAL_DEV_CONSOLE_ENABLED` is on (ADR-077 capability) — `dev_console_disabled`.
2. The caller's subject is on `OSHAL_SUPERADMIN_SUBS` — `super_admin_required`. The tool path has
   only the verified subject, so the email allowlist does not apply here.
3. `OSHAL_DEV_WORKSPACE_INDEX_ENABLED` is on — `package_disabled`.
4. Dev mode is on for that exact issuer and subject — `dev_mode_off`.

Dev mode is server-held: a super-admin turns it on from the Developer Workspace surface
(same-origin `POST /api/dev-workspace-index/dev-mode`), it lasts `devModeTtlMinutes` from the
manifest, `DELETE` ends it, and a restart starts with it off. A client header is never authority.

The package's catalog `scope:` is `operator`, so the catalog lists it for operators only. That is
visibility, not the gate: the four conditions above still decide every read.

## Jarvis

The package registers the in-process tool `dev_workspace_search` (`builtin/package`). Jarvis
receives `doc_id`, `path`, `title` and a bounded excerpt for each result and is instructed to cite
the `doc_id`. The actor comes from the framework's verified authorization context, never from the
tool input.

## Tests

- `node --test "tests/*-*.test.js"` — dependency-free source guards (the store-ci job).
- `OSHAL_CORE_DIR=<framework checkout with node_modules> node --test tests/jarvis.core.test.js`
  and `tests/refusal.core.test.js` — the real core seam (authorization runtime, package-tool
  registry, route mounter, tool executor, Jarvis proposal routes) with this package mounted; run
  by the framework-coupled gate and registered in `tests/test-lab.yaml`.

Installed acceptance (the operator's signed-in dev console asking for tonight's handover) remains
separate evidence.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
