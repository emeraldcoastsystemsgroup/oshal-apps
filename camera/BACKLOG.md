# Camera Ops — backlog

Open work on this package. Every entry has a done-when, so scope does not have to be guessed later.

## The assistant cannot call its route-backed tools yet (2026-10-06)

**CLOSED 2026-11-19 (version 1.2.2).** The 2026-10-06 `401` refusal occurred on the retired TypeScript core before `oshald` (`package_api_tools.rs`) executed route-backed `executorType: api` tools directly under the caller's verified principal. Live verification on Blue (`:38798`, 2026-11-19) confirmed `camera-operator` calls `camera-fleet-status` with `200 OK` (zero `401`). `1.2.2` declares explicit `posture: inline` + `chatBot: camera-operator`, adds explicit `inputSchema` objects to `camera-status` and `camera-fleet-status`, updates `personas/camera-operator.yaml` with plain-prose direct-chat rules and the ```` ```tool_call ```` `{"tool": ...}` fence for all four tools, and guards the contract in `tests/camera-bot-tools-contract.test.cjs`.

## Future: ADR-149 `authorization.yaml` catalog adoption (coordinated migration)

Adopting an ADR-149 `authorization.yaml` catalog + `builtinKey: package` tools requires coordinated operator role migration because active production installations hold `@app-admin` assignments for `camera`.
