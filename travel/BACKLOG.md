# Travel — backlog

Open work on this package. Every entry has a done-when, so scope does not have to be guessed later.

## The assistant cannot call its route-backed tools yet (2026-10-06)

**CLOSED 2026-11-19 (version 1.3.6).** The 2026-10-06 `401` refusal occurred on the retired TypeScript core before the native Rust kernel (`oshald`, `package_api_tools.rs`) directly dispatched route-backed `executorType: api` tools under the caller's verified principal. Live verification on Blue (`:38798`, 2026-11-19) confirmed `travel-concierge` invokes its own route-backed tools with `200 OK` and real application state (`list-fare-watches` returned active `VPS-DCA` fare watch, zero `401`). `1.3.6` makes `posture: inline` explicit on `travel-concierge` and guards the inline/tool-call contract in `tests/travel-tools.test.js`.

## Future: ADR-149 `authorization.yaml` catalog adoption (coordinated migration)

Adopting an ADR-149 `authorization.yaml` catalog + `builtinKey: package` tools for `travel` is a separate coordinated release because `travel` is a required `@app-admin` member of five experiences (`commons-experience`, `home-experience`, `jarvis-experience`, `orbit-experience`, `studio-experience`) and has active `@app-admin` production assignments.

- **Done when:** all five experiences update their `travel` role templates from `@app-admin` to a named role in `travel/authorization.yaml`, production role re-approval is coordinated with the operator, and `travel`'s tools run under explicit `authorization.yaml` bindings.
