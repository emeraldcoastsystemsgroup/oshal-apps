# Publishing API0.1

All application paths are under `/api/publishing-studio`. Every data route uses fresh original-person authority and own-only scope. Owner/tenant override headers and unrecognized query/body fields are refused. UUIDs are canonical v4. All mutation retry keys are UUIDv4; retry identical inputs with the same key after an uncertain reply. Confirmed terminal failure requires a new key for a new render.

| Route | Purpose |
|---|---|
| GET `/app`, `/ui/workbench.mjs`, `/ui/workbench.css` | Authenticated human workbench assets |
| GET `/permissions`, `/editing-contract` | Current capabilities and authoritative closed operation schemas |
| GET `/documents`, `/home-summary` | Original-owned document catalogue/summary |
| POST `/documents` | `{title,pageCount,requestKey}`; creates immutable revision1 |
| GET `/documents/:document?revision=n` | Exact saved model and immutable revision history; `receipt=1` gives compact metadata |
| GET `/documents/:document/model/:part/:offset?revision=n` | One bounded page/master/story/asset/style entry, or complete JSON-text fragments, pinned to one revision/source SHA |
| POST `/documents/:document/revisions` | `{baseRevision,requestKey,operations}` or `{baseRevision,requestKey,restoreRevision}`; exact-one edit/restore; CAS |
| POST `/documents/:document/edits` | Held agent transport `{baseRevision,requestKey,operationsJson}`; JSON array of the same canonical operations,16KiB total |
| GET `/assets` | Own immutable asset catalogue |
| POST `/assets/upload` | One multipart PNG/JPEG file plus title/requestKey;4MiB cap |
| POST `/assets/import-artifact` | `{ref,title,requestKey}`; genuine native `art_` handle metadata/chunks, current owner/grants, full SHA |
| GET `/assets/:asset/content` | Current owned original image |
| DELETE `/assets/:asset` | Only unreferenced original asset; no historic revision corruption |
| POST `/documents/:document/render` | `{revision,requestKey}`;202 admits a pinned original kept-run, never means ready |
| GET `/jobs/:job` | Protected current status; queued/rendering/ready/failed/cancelled |
| POST `/jobs/:job/cancel` | Held/manage authority; stops final publication of an active own job |
| GET `/documents/:document/revisions/:revision/preview/:page` | Read-protected actual final-PDF PNG preview |
| POST `/documents/:document/export` | `{revision,format,page?}`; protected descriptor and current-export content URL |
| GET `/documents/:document/revisions/:revision/content?format=layout\|pdf\|preview&page=n` | Separate export permission; exact saved layout, ready PDF or selected PNG |
| DELETE `/documents/:document` | Own deletion; retained request tombstone prevents old-key recreation |

For full model reconstruction use `part=complete`, starting at offset0. Follow `nextOffset` until null at the same document/revision/`modelSha256`. Fragments are at most2048 UTF16 code units (`encoding: json-text-utf16`); offsets are code-unit offsets, not byte offsets. Require stable `totalCodeUnits` and `textSha256`, concatenate every `text` exactly, and verify the SHA256 of its UTF8 bytes before JSON parsing. `textSha256` identifies this exact transport string; protected `modelSha256` identifies the saved canonical model. Individual descriptors over16KiB explicitly refuse with `publishing_model_part_requires_chunks`; do not treat truncated observations as complete.

Read `/editing-contract` before editing. The server validates each operation and the resulting complete model: `set-frame`, `set-link`, `replace-story`, `set-character-style`, `set-paragraph-style`, `set-page`, `set-object`, `set-master`, `set-view`, `replace-layout`. Object kinds have different exact required fields. The inline registered Publishing Editor uses automatic protected reads and held changes/render/export; proposal/card approval does not replace current grants or revision checks at execution. Source tests do not prove a configured provider's natural discovery or a live held-card workflow.

## Private pure engine

`engine(ctx,action,payload)` derives the namespace from the captured original issuer/sub/principal/tenant and uses only native `engine.exchange` with command `publishing`,15s timeout and an exact pinned greeting/reply build identity. Backend remediation hints stay out of ordinary HTTP error bodies. `upload(ctx,action,descriptors,Map,current)` returns a stage token after bounded exact-hash uploads. `output(ctx,action,token,descriptor,current)` returns a complete verified Buffer after per-chunk and whole-output validation. Both call the original source/job/current-authority fence before and after every remote chunk.

The private framed wire sends `{id:1,cmd:'publishing',args:{op,namespace,...}}`. It has only six operations:

- `open`: exact assets `{id,sha256,bytes,mime}`; returns uploading token/chunkBytes65536/fixed TTL600s.
- `write`: token, assetId, offset, canonical dataBase64, chunk sha256. Full64KiB aligned chunks except terminal fragment; identical retries are accepted, changed overlaps refused.
- `render`: token plus complete validated model with identical asset descriptors; returns rendering immediately; actual native work is asynchronous and bounded300s.
- `status`: token; returns state, complete ready receipt or closed failure code/details.
- `read`: ready token, exact output name and aligned offset; returns actual chunk SHA, full output SHA/size, canonical base64, complete and nextOffset.
- `close`: exact namespace/token; retires own private buffers and cancels its actual producer. Expiry also removes stages.

This server has no database, login service, public artifact grant or publication authority. Stage tokens never substitute for current app permissions. Global reserved output space is admitted before work, not spent by optimistic later allocation. Cancellation and expiry tests deliberately pause delivery of an actual successful worker reply before publication; this named seam is separate from a native kernel continuation proof.

## Runtime preparation prerequisites

Use `python3 -I engine/prepare-runtime.py` so inherited Python paths cannot affect initial interpreter startup. Preparation removes inherited `PIP_*`, `PYTHONPATH` and `PYTHONHOME` from its subprocess environment, disables pip configuration, uses isolated Python/pip and explicitly installs into its new private venv. Offline inputs are the original hash-pinned Typst archive and pypdf wheel directory; downloads require explicit `--allow-download` and the fixed PyPI index. Source regressions require `OSHAL_PUBLISHING_TYPST_ARCHIVE` and `OSHAL_PUBLISHING_WHEEL_DIR` alongside the prepared `OSHAL_PUBLISHING_PYTHON`/`OSHAL_PUBLISHING_TYPST`. These are build/test inputs, not caller authority or a different native wire.
