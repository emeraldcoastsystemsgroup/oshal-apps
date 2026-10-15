# Bounded publishing profile0.1

The authoritative native-layout JSON stores page geometry, frames, story paragraphs and runs, style dictionaries, master objects and immutable asset descriptors. It stores no executable Typst, external URLs, kernel state or caller-supplied ownership. All coordinates are points from the trim top-left. Objects may extend only to the declared bleed; linked text frames remain inside trim.

| Bound | Supported value |
|---|---|
| Pages |1–8;72–1440pt per axis; single or facing view |
| Bleed / guides |0–36pt;32 numeric guides per axis/page |
| Stories / placed items |16 stories;128 total frames plus placed/master objects |
| Linked frames | Uniform width/height within each story; forward page/y/x reading order; cycles, branches and unlinked frames refused |
| Text |64KiB total basic Latin English; LF/TAB supported; no silent unsupported-glyph fallback |
| Styles |32 each; Libertinus Serif regular/bold/italic/bold italic;6–96pt; paragraph leading/spacing/indent/alignment |
| Images | PNG/JPEG;32 assets;4MiB each;32MiB aggregate;8192px/axis and32M decoded pixels; clean export needs150 effective DPI |
| Model |512KiB encoded; edits1–64 operations; agent edit transport16KiB |
| Output | RGB embedded-font PDF1.7; PNG previews decoded at96PPI from the same final PDF;4MiB per output,32MiB combined |
| Owner persistence |32MiB distinct blob bytes;8MiB stored metadata;100 immutable revisions/document;16 retained job receipts |
| Retry receipts |256 requests;2MiB aggregate;256KiB each;24h expiry/reclamation; changed input conflicts |
| Execution |300s original kept-run;15s engine RPC;64KiB transfer chunks |
| Pure stages |600s fixed TTL;2/namespace,8 global maximum;128MiB reserved globally; one active renderer; explicit refusal instead of queue |
| TCP |16 active connections;1MiB framed requests/replies;10s read/write bounds |

Only an original current actor with one tenant may access the own namespace. Named view, read, change, render, export, asset and job permissions remain distinct. SQL forced-RLS fixtures and native Person-scoped schema prevent another actor selecting an arbitrary owner. Source/revision/current-authority checks surround native calls and final atomic publication. No part of the pure engine's namespace token independently grants app authority.

A clean preflight means this profile passed its own text flow, supported font, image-resolution and geometry checks. It does not mean a commercial printer has certified the file. The worker labels `modelSha256` as `python-json-sort-keys-ascii`; protected app `sourceSha256` identifies the exact stored JS-canonical native-layout bytes. Those digest encodings are not interchangeable for every numeric representation.

Still unsupported: PDF/X, CMYK/ICC or certified color fidelity, spot colors, IDML, packaged fonts, arbitrary fonts, complex scripts, tables, footnotes, automatic hyphenation, professional accessibility tagging and secure redaction/signing. Native/installed and configured-provider workflow acceptance are pending. This profile makes no whole Adobe product parity claim.
