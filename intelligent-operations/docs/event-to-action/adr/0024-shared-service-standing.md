# ADR0024: Service standing is distinct from account and delivery status

Accepted, 21 October 2026; source and native password-login acceptance pass.

Connections must show what the signed-in user can actually invoke. A local credential
or saved connection is insufficient evidence of a configured native executor or a
successful message. The Operations view reads standard GET /connectors and
/api/notify/prefs. It shows selected endpoints, original-person invocation standing,
usable/expiring personal accounts, registered transports and enabled personal routes.
It never displays SMS/Telegram destinations or credentials. Legacy kernel metadata
remains an explicit rollout requirement rather than a false connected state.

The central HTTP gap is documented in kernel ADR187, and central SMS in ADR186.
No app-specific credentials or transport are added. The view performs no effect.
Phone readiness remains separate from SMS; provider health remains not-probed.
Refresh generations discard stale results, and any authorization refusal clears
all private service rows. Two actual browser cases prove this behavior.

ADR0003 still owns durable external-ticket direction, phase/status mapping,
operation reservation, reconciliation and echo/conflict behavior. This standing
view does not claim those domain contracts are implemented.

The development installation now registers SMS, brief phone and Telegram, and
selects Jira under core ADR187/188. Separately authorized one-time tests have
transport acceptance; they are not inferred from this read-only screen. Jira's
profile read returns HTTP 404, so live account validation remains open. ADR0026
records these acceptance boundaries and the outstanding full kernel gate.
