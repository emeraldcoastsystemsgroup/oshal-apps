# ADR 0002: Every event decision is inspectable

Status: Accepted design, 20 October 2026. Production reduction and storage remain planned.

Context: Operators need to see why incoming data was filtered, quarantined, grouped or dispatched.
Alert deliveries and telemetry are different records, and repeated deliveries differ from independent
occurrences. An opaque incident total cannot demonstrate the established noise-reduction behavior.

Decision: Keep immutable raw-delivery provenance, separate OTLP observations, normalized alerts and
versioned processing decisions. The data view traces source, mapping/rule versions, scoped identity,
filter reason, delivery retry, symptom tuple, suppression/reservation, correlation membership and
conditional snapshot outcome. Replays link old and new interpretations without overwriting history.

Preserve the established production algorithm: stable scoped keys, suppression windows,
reserve-before-dispatch, release-on-failure and bounded correlation. Inspect the existing implementation
before integrating it. The prototype's simple severity/tuple demonstration is not that implementation.
Stored-query percolation and telemetry window evaluation remain separate backend capabilities.

Alternatives rejected: deduplication by title/hostname/message; treating every measurement as an alert;
filtering after costly investigation; conflating cross-source correlation with delivery deduplication;
claiming a local fixture demonstrates durable or concurrent correctness.

Consequences: Decisions need durable scope, input references, versions, outcome/reason, incident link,
counts, time and replay lineage. Missing identities stay quarantined; unauthorized content is withheld.
A conflicting payload reusing a delivery ID must not be silently accepted as a retry.

Acceptance: Explain duplicate ID versus repeated occurrence; preserve distinct source/type/resource
keys; test 100 occurrences, concurrent reservation, crash/restart and release-on-failure; prove no
costly analysis before reduction; inspect unmatched/quarantined records and separate OTLP signals.
