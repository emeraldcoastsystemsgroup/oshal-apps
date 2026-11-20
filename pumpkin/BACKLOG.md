# Pumpkin — backlog

Open work on this package. Every entry has a done-when, so scope does not have to be guessed later.

## The assistant cannot call its route-backed tools yet (2026-10-06)

**PARTIALLY RESOLVED 2026-11-19 (version 1.4.1).** On the native Rust kernel (`oshald`, `package_api_tools.rs`), `pumpkin-bot` executes `pumpkin-rooms` (`GET /api/pumpkin/rooms`, verified live on Blue `:38798` returning `200 OK`, zero `401`) and `pumpkin-stop` (`POST /api/pumpkin/stop` accepts OIDC principals). `1.4.1` fixes the ```` ```tool_call ```` fence bug in `personas/pumpkin-bot.yaml` (`"name"` -> `"tool"` to match `extract_tool_call`), declares explicit `posture: inline` + `chatBot: pumpkin-bot`, adds an explicit object `inputSchema` to `pumpkin-rooms`, and guards the contract in `tests/pumpkin-bot-tools-contract.test.cjs`.

**Remaining item (`POST /api/pumpkin/speak` on `oshald`):** `POST /api/pumpkin/speak` intentionally refuses browser OIDC calls (`hasValidServiceSecret` -> `403 service_secret_required`, guarded by `tests/pumpkin-swarm-push.test.cjs`), and `oshald` returns `false` for legacy `hasValidServiceSecret()`. Migrating `pumpkin-speak` to a `builtinKey: package` tool requires adopting an ADR-149 `authorization.yaml` catalog together with coordinated operator migration of active `@app-admin` production role assignments.

- **Done when:** `pumpkin` adopts `authorization.yaml` + `builtinKey: package` tools in a coordinated role migration, `pumpkin-speak` executes from a live `pumpkin-bot` turn without weakening `POST /api/pumpkin/speak`'s browser-OIDC refusal, and active production users are migrated to the declared catalog role.
