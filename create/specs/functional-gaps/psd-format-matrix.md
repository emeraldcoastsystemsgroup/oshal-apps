# Create PSD import profile 1

This is a bounded RGB8 PSD reader and conversion profile, not Photoshop parity or
PSD round-trip support. Format reference: [Adobe PSD specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/).

| Feature | Outcome |
| --- | --- |
| PSD version 1, RGB, 8 bits/channel | Supported |
| Raw and PackBits/RLE pixel planes | Supported, exact per-row expansion bounds |
| Pixel layers and alpha planes | Editable image layers backed by owned immutable PNGs |
| Normal isolated groups | Editable fixed-frame groups, at most 4 levels |
| Normal blend, opacity, visibility, transparency lock | Editable |
| Layer bounds/placement | Editable position/size/rotation in Create; PSD raster geometry is already baked |
| Unicode names | Imported; control characters removed/names over120 units truncated with report |
| Other blends, pass-through groups, masks, clipping, text, smart objects, adjustments, effects, unknown additional tags | Editable import refused, deterministic report |
| Unsupported semantics with opaque merged raw/RLE RGB cache | Explicit optional flattened import; one image, no editable semantic claim |
| Transparent merged cache | Flattened import refused (white-matte conversion not implemented) |
| Embedded color profile/unknown image resources | Reported, editable import refused; explicit flattened cache may discard metadata |
| PSB, 16/32-bit, CMYK/Lab/indexed, ZIP/prediction, malformed/oversized input | Refused |
| PSD export | Not implemented; export remains native Create JSON, SVG or raster |

Bounds:4MiB input;2048 pixels/side;4M canvas pixels;32 pixel layers/64 total
records;8M total decoded pixels including merged cache;4 group levels. These
are resource limits, not measured installed throughput claims.

Persistence source integration: preserve exact immutable original
bytes and report alongside revision1 and owned PNG references in the existing
owner transaction. Retained originals are capped at4MiB per owner separately
from native PNG storage. The original download requires current own read/export;
edits append ordinary immutable revisions and never rewrite the original.

Parser fixtures are original binary format fixtures generated from this specification.
They cover raw/RLE, RGBA/opacity, placement, Unicode, groups, unsupported tags,
blend/mask/clipping refusal, malformed/truncated inputs and bounded expansion.
Exact independent Pillow pixels, real Sharp/forced-RLS source transactions, original4MiB/64parts, rollback/roles/quotas and desktop/phone/browser retry proofs pass. Genuine native fixture `1446506` with source `915b3a55` and reviewed core `36922b94` passes canonical manifest/all3 schemas, real worker/Sharp/PNG/original SQL persistence, native uploaded handle SHA/chunks, held original-owner import/edit, exact pixels/history/reopen, original download/export and actual source reload/current-role isolation. Supervised13.97s and strict fixture lint pass. Its sole model seam is deterministic tool choice; installed browser/natural-provider acceptance and full PSD parity remain open. This does not certify installed capacity.

Raw layer/original bytes are exact. Theoretical source-over reference RGB permits1byte/channel per isolated group level for Chromium Canvas opacity rounding; alpha is exact. Two maximum8M decoded source pipelines observed335944KiB process peak onarm64 including fixture/Node/Sharp/PG, excluding native FFmpeg/browser/installed traffic. Declared memory512MiB; no throughput/installed capacity certification.
