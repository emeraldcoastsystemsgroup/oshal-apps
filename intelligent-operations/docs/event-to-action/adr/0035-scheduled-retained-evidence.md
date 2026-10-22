# ADR0035 — Capture retained context on the personal processing schedule

Status: implemented in source; native deployment acceptance pending.

The evaluator committed evidence reservations but required a separate manual pin before the three raw banks rotated. The existing personal processing schedule now offers an explicit **Preserve retained evidence after filtering** setting. Existing configurations default to off. This authorizes only retention of already admitted data for the selected source revisions.

A bounded consumer follows evaluation and also drains earlier pending reservations. Each completion locks its processing item and current configuration, validates its source and reservation, then commits the immutable packet, reservation outcome and processing outcome together. No duplicate capture occurs across concurrent consumers. A rule without capture records `not-requested`; absent context records `no-retained-context`, never invented observations. The packet preserves its source, time, content hashes, redaction and bounded truncation indicators.

Failures use durable exponential backoff and the configured attempt ceiling. Explicit retry resets only capture; it does not repeat filtering or increment suppression counts. Disabling the worker serializes with an in-flight capture commit and prevents later ones. Schedule pause controls future ticks; disable controls the active commit fence.

This consumer uses the existing native personal schedule, original-user SQL scope and application permissions. It grants no infrastructure access, model call, external communication or execution authority. Automatic correlation, collection from external systems and canonical workflow dispatch retain separate acceptance gates. The current native package ticket port exposes create/list/get and needs a shared start operation for unattended workflow dispatch.

Validation: real disposable PostgreSQL consumer tests cover opt-in, ownership, concurrent completion, no-capture rules, backoff/exhaustion/retry, pause serialization and redacted retained context. The existing real OpenSearch processing test covers repeated occurrences through reduction into one immediately eligible packet. Native schedule acceptance must be recorded separately before claiming installation completion.
