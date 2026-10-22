# ADR 0014: Native scheduled processing of admitted alerts

Status: Implemented; native scheduled processing and pause/resume verified in the local Kubernetes installation.

Recorded alerts must continue through published rules without an operator repeatedly
pressing Evaluate. Use the existing OSHAL personal scheduler and declared service route.
The activating person remains the caller; each run rechecks current package authority.
There is no application daemon, borrowed administrator credential or cluster access.

Processing is disabled initially. The operator selects exact saved source revisions,
each with a published policy, saves the configuration and activates the native schedule.
Configuration uses revision checks. Pausing the native schedule stops future ticks;
disabling processing also fences already claimed work before a decision commits.

The existing transactional queue owns eligibility, attempt count and a 120-second
lease. Each bounded run claims one item at a time, processes at most ten, and stops
starting items after 45 seconds. A native 120-second invocation budget accommodates
the final engine request. Claims, decisions and lease checks retain caller isolation.
Concurrent workers cannot count an occurrence twice. An expired claim can be recovered;
a stale worker cannot commit a decision. Transient failures receive exponential backoff
(up to one hour), permanent or exhausted failures require an explicit retry. A lost
commit acknowledgement cannot turn completed work back into pending work.

The experience displays saved processing configuration separately from native schedule
activation and recent job states. Missing scheduler access is unavailable, never active.
Revoked access clears private records. Native run failures remain failures even if an
earlier item in that batch succeeded. Lease tokens are not exposed to the experience.

This increment consumes already admitted alerts and reserves downstream evidence work.
It does not authenticate an external producer, ingest OTLP, correlate on a timer,
collect evidence, generate remediation, authorize execution or synchronize tickets.
Those remain separate delivery gates in the full Event-to-Action plan.

Acceptance: eight real SQL/OpenSearch/browser contracts cover concurrent workers,
expired claims, stopping processing, retry exhaustion and explicit recovery, lost commit
acknowledgements, owner isolation and unavailable scheduler UI. The complete Operations
suite passes 60 cases with no skips. The installed native scheduler processed seven labeled acceptance alerts without a manual
processing call or trigger. A 65-second pause retained new work; reactivation processed it.
Both native receipts report scheduled execution and HTTP 200. Acceptance leaves the
worker disabled and its schedule inactive. The configuration row is locked through
the decision commit so disabling cannot acknowledge ahead of that commit.
