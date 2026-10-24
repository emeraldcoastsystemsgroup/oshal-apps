# ADR 0052 — Optional external evidence beside a sealed incident packet

Status: installed on the native lab; credentialed provider acceptance pending (see `../../../deploy/evidence/external-evidence-live.json`).

## Context

The conditional evidence packet is pinned atomically from admitted alerts, retained telemetry and observed inventory. A remote Splunk query cannot run inside that database transaction and must never decide whether the incident exists. The existing investigation input is sealed before the canonical ticket starts. The older per-bot Splunk MCP does not provide the package's original-person connection and audit boundary.

## Decision

Connections exposes an opt-in mapping of immutable named alert source revisions to one personal Splunk account and index. It stores no token. For a captured reservation, the investigation preparation obtains one durable external-evidence outcome. When enabled, it asks the kernel's `connector.read.splunk` operation (kernel ADR-199) for the packet's exact resource identifier and a window from ten minutes before to five minutes after the alert, capped at now. The kernel fixes the SPL and applies a 15-minute, 50-result, 10-second provider-time and 512-KiB response bound. Operations keeps at most 12 projected event rows and short fields in a 16-KiB model attachment; common credential patterns in log text are redacted, but logs remain untrusted evidence. The record names source revision, resource, provider, index, account label, query version, request/completion times, coverage, packet hash, result hash, status and truncation.

The packet stays immutable. A second owner-scoped table records one final enrichment outcome per reservation. A refused, timed-out, unconfigured, unsupported or empty query creates an explicit manifest with no fabricated events. The canonical investigation still receives its packet and starts. Concurrent preparations cannot dispatch two tickets while enrichment is in progress; stale in-flight attempts become an unavailable gap. The result is frozen for this incident even if the operator later changes account or index. New ticket inputs seal `evidence/external.json` beside `evidence/packet.json` and any owner runbook, with a digest over all attached file digests. Prior tickets retain their original input format/digest. The incident trace shows the external outcome with exact reservation identity and a link to Connections.

## Limits and follow-ups

Search for an identifier in raw Splunk events is contextual matching, not proof that a log came from that resource. Provider search may return zero when data is missing, differently indexed or not visible to the user's role. Redaction handles common patterns, not arbitrary unknown secrets; only reviewed accounts/indexes should be enabled for AI input. The fixed query has no general SPL editor. Other external providers need separate reviewed operations on the standard connection framework. A real Splunk service and personal bearer token are required for live provider acceptance; the test suite uses a mocked native read port and real caller-isolated PostgreSQL. No provider-side message, ticket update or infrastructure action is implied by enrichment.
