# ADR-077 — The Self-Developing Platform: super-admin Developer Console (fixture)

- **Status:** Accepted.

## Decision

Super-admin is a distinct role, double-gated and fail-closed: the capability flag must be on and the
caller must be on the dedicated allowlist. The developer console owns the dev context.
