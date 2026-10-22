# ADR0031: Separate mitigation, permanent repair and recovery verification

Status: proposed design, 21 October 2026. Extends ADR0030's roadmap.

Support four operator-selected response paths: paired mitigation/permanent repair,
standard lower-environment promotion, bounded emergency runtime patch, and an
expedited Git-backed production hotfix with explicit omitted-check waivers.
Keep separate linked change records under the incident. A runtime patch requires
Git reconciliation; an expedited Git deployment uses an exact reviewed artifact.

Start post-change watching as a durable, bounded, read-only workflow branch using
versioned health criteria. Command success does not resolve an incident. Healthy,
regressed, inconclusive and timed-out outcomes are distinct. Conditional rollback
requires exact prior authorization plus current preconditions, or a new approval.
A temporary fix's deadline prompts review rather than blind reversion.

[Response design](../RESPONSE-PATH-DESIGN.md) describes screens and implementation
acceptance. The interactive prototype makes no live calls and grants no authority.
