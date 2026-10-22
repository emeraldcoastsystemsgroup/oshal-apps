# Operations alert profile

Version 1 is the draft JSON alert profile used by the application source preview. It builds on structured CloudEvents 1.0, adding the application-specific data schema, time, environment, severity, alert type and scoped resource identity. It is not an OTLP envelope or a general-purpose CloudEvents validator.

`operations-alert-v1.schema.json` describes the structure. The shipped `ui/source-contract.js` additionally enforces a 64 KiB UTF-8 limit, real calendar dates with explicit timezone and seconds 00–59, unpadded/control-free identifiers, no credentials in a source URI, and optional exact comparison against the expected source. The preview runs locally and never authenticates a source or writes data.

Delivery identity is the ordered tuple of source URI and event ID. The proposed symptom identity is source, environment, resource kind, resource scope, native ID and alert type. Preserve case and field boundaries; do not put severity, mutable prose, delivery ID or timestamp into this symptom identity. Persisted incident-key and asset-alias behavior belongs to later ingestion/correlation milestones and must preserve the established semantics.

Use native resource IDs with their account, project, cluster or site scope. An instance ID identifies that instance; workload continuity requires a separate workload identity and temporal inventory mapping. This draft does not resolve aliases or prove a supplied identity exists. Server-side source registration must bind authenticated connection/scope and reject source spoofing independently of these client-side checks.

The UI example is explicitly synthetic and never sent. Real local-lab alert payloads and sanitized capture receipts are separate test data; they do not represent production events.

Reference: [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md).

## Adapter mapping preview

The application now previews an explicit adapter mapping before profile validation. The seven
required mappings are environment, alert type, severity, status, resource kind, scope and native ID.
Defaults use the standard profile paths. Each configured path is a JSON Pointer into the sample;
`~1` represents a slash in a field name and `~0` represents a tilde. Concrete zero-based array
indices are accepted. The preview restricts pointers to 512 characters and 12 segments, rejects
control characters and reserved prototype property names, and reads only own properties.
See [JSON Pointer, RFC 6901](https://www.rfc-editor.org/rfc/rfc6901.html) for the path syntax.

Every field must resolve to a string. Missing fields, malformed paths and invalid normalized
values stop the preview; there is no coercion, name-based fallback, default identity or script
execution. The 64 KiB limit applies to the original UTF-8 sample and the normalized alert.
The normalized preview contains only the profile fields. Source URI, event ID, timestamp, type,
content type and schema remain in the envelope; mappings cannot overwrite them. A mixed base64
payload still fails the profile. Changing a mapping immediately clears the old identity preview.

This is source preparation, not inventory resolution or a saved administrative mapping. Inputs
and mapping drafts stay in browser memory. Named source authentication, administrator-only
registration, versioned mappings, durable raw records, telemetry storage and quarantine remain M2
work; the browser must never substitute for those server-side boundaries. No OTLP mapping is
implemented here. Duplicate-member JSON handling must be specified for the durable intake parser;
this local preview uses the browser's JSON parser and is not an admission decision.
