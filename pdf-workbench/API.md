# PDF Workbench API

Base: `/api/pdf-workbench`. Authenticated current original owner only. No query/body/header can select another owner, issuer or tenant. Own named permissions are separate from role labels; a Reader cannot mutate, OCR, cancel or export. Agent writes are held by kernel approval cards.

| Method and path | Permission | Result |
|---|---|---|
| GET `/app`, `/ui/:asset`, `/permissions`, `/editing-contract` | view | Human UI/current grants/closed operation contract |
| GET `/sources?receipt=1` | read | Owned originals; omit receipt for human full inspection |
| POST `/sources/upload` | create | Multipart file/title/requestKey, immutable original |
| POST `/sources/import-artifact` | create | `{ref,title,requestKey}` genuine native owned handle |
| DELETE `/sources/:source` | delete | Refuses a history-referenced source |
| GET `/documents` | read | Owned current document index |
| POST `/documents` | create | `{source,title,indices?,requestKey}` new derivative |
| GET `/documents/:id?revision=n&receipt=1` | read | Pinned small receipt and history; human default includes full model |
| GET `/documents/:id/model/:part/:offset?revision=n` | read | One exact pages/annotations/fields/form-fields descriptor and nextOffset |
| GET `/documents/:id/forms?revision=n` | read | Form definitions/value/appearance support |
| GET `/documents/:id/pages/:pageId/preview?revision=n` | read | Actual saved PNG preview |
| GET `/documents/:id/text?revision=n` | read | Bounded selectable text by page |
| GET `/documents/:id/text/:page/:offset?revision=n` | read |4096UTF-16 code-unit chunk and explicit truncation |
| POST `/documents/:id/revisions` | change | `{baseRevision,requestKey,operations}` or `{baseRevision,requestKey,restoreRevision}` →202 queued job |
| POST `/documents/:id/ocr` | ocr | `{revision,pageIds,language:'eng',requestKey}` →202 queued independent OCR |
| GET `/jobs/:id?receipt=1` | job.read | Bounded protected status; OCR text remains separately OCR-protected |
| GET `/jobs/:id/ocr/:page/:offset` | ocr | Explicit selected-page OCR text chunk with quality/confidence |
| POST `/jobs/:id/cancel` | job.manage | `{}`; only active work changes state |
| GET `/documents/:id/revisions/:n/content` | export | Current guarded complete PDF<=4MiB |
| DELETE `/documents/:id` | delete | Delete derivative history, retain originals |

Tool POST bodies may include `id`, which must exactly match the path and is removed before model validation. Unknown fields refuse. Repeated same key and identical intent return the same source/document/job receipt; differing intent refuses409. A delayed revision cannot overwrite a newer head. A confirmed failed/cancelled intent needs a fresh key for explicit retry. Job state is queued/rendering/ready/failed/cancelled; ready alone proves committed output. Terminal receipts are bounded16/owner; evicted old job refs are unavailable. Document history remains intact.

Closed operations: `reorder {pageIds}` exact permutation; `rotate {page,degrees:90|180|270}`; `remove|extract {pageIds}` retaining at least one page; `merge {source,indices?,position}` from original-owned source; `annotate {annotation:{id,page,kind,rect,text?,points?,color?}}`; `remove-annotation {id}`; `fill {name,value}` for an actually present supported field. Form names are source UUID + dot + fully qualified original field name. Page IDs identify instances; original asset ID plus source ordinal tracks lineage. Coordinates are crop-box PDF user units before page rotation. No arbitrary PDF/SQL/shell operators.

Exports minted at a browser boundary use the existing ordinary `/api/artifacts/handles` source URL pointing to this protected content route. The producer does not recursively mint its own package; that runtime recursion is refused. Each handle metadata/chunk checks original ownership, producer source and current grant. The source contract unit test is not evidence that a native handle was accepted: that requires genuine installed-fixture integration.

Retry receipts:24h retention;256 records/2MiB encoded results per owner,256KiB/result. Current matching keys replay within the horizon; conflicts409, deleted-resource replay410. Expired receipts reclaim on the next authorized mutation; no live receipt evicts automatically to admit a new one. All structured metadata additionally charges against8MiB/owner in the same transaction as publication. Exceeding count/bytes/metadata yields413 without partial publication. Delete unused originals or derivative history to reclaim metadata; deletions replace matching cached results with small tombstones while preserving original fingerprint/key/horizon.
