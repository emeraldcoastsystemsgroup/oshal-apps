# Travel — backlog

Open work on this package. Every entry has a done-when, so scope does not have to be guessed later.

## The assistant cannot call its route-backed tools yet (2026-10-06)

Since core #1095 (2026-10-06), `travel-concierge` answers the deployment operator's chat on the
operator's own Antigravity login, from its own node (`travel-bot`). One chat turn as the operator on 2026-10-06 confirmed it.
Its 7 tools are route-backed (`executorType: api`): `search-flights`, `search-hotels`, `search-cars`, `read-price-intelligence`, `create-fare-watch`, `explain-travel-pick`, `prepare-booking`.
Core documents that a route-backed tool answers 401 when a bot calls it (core
`docs/security/remote-application-execution.md`, "Limits"), and Scene Studio's director hit exactly
that before 0.2.0. No tool call from this package's assistant has been run yet.

- **Done when:** every tool the assistant is meant to call is a package tool
  (`executor: { executorType: builtin, builtinKey: package }`) bound in an ADR-149 authorization
  catalog (this package has none yet, so that means writing `authorization.yaml`), the bot is bound in `bindings.bots` (core `docs/apps/package-tools.md`), and one live chat
  turn as the operator runs a tool and its result is checked against the app's own state. Scene
  Studio 0.2.0 is the worked example.
