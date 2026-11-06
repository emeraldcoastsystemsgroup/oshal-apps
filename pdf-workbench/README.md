# PDF Workbench

0.2.2 returns a fresh server-generated `requestKey` on every editing-contract read. Copy it unchanged for one new edit and retain the exact key and body for an uncertain retry. Edit tool schemas enforce the existing backend UUID rules before proposing an action. Contract responses remain private and uncached; saved models and authorization stay unchanged. Installed acceptance for this release is pending.


A bounded, provider-independent PDF editor for the original person's documents. Upload or import a native owned PDF, keep its original bytes, select actual page text/images/shapes and save edits as new derivative revisions. Manual controls and approval-held agent tools call the same validated operations.

Source and native kernel proofs are tracked separately from installation and provider acceptance; audit remains pending.

Supported editing profile (0.2.0):

- Shared document workspace with selectable native objects, a page/object tree, direct text editing and dragging, typed geometry/font/color/line/opacity properties, draft previews, focused-field Save, draft Undo/Redo and phone drawers. Text stays within its own PDF object. Re-encoding controls are enabled only for safe standard-font runs; embedded/subset/custom fonts keep geometry/paint editing, with text/size locked until an explicit supported standard font is chosen for Latin-1 text. Visible non-Latin runs retain geometry/paint controls. Hidden/clipping text and pages with Type3 glyph programs stay read only for content editing; page organization/annotations preserve them. Font choice never silently substitutes the original. Native shapes and owned PNG/JPEG images can be inserted, moved and edited. Existing images retain their masks and opacity when transformed.
- Immutable image assets are stored once in bounded SQL chunks, referenced by revisions and protected from deletion while retained history uses them. PNG transparency survives native PDF export.

- Page reorder, quarter-turn rotation, remove, keep-selected extraction and merge from owned originals. Human selected-page new-copy currently accepts unedited pages from one original; edited pages use keep-selected and append a saved revision. No unchanged-original overwrite.
- Printable ASCII Helvetica free-text notes, rectangular highlights and bounded ink strokes in crop-box coordinates before rotation. Saved derivatives reopen through independent Poppler. Draft page/content/annotation edits render with the actual worker; merged source pages appear after save.
- Standard AcroForm text, checkbox, radio and single-choice values with real generated/retained appearances. Source UUID namespaces prevent colliding field names. Text filling is ASCII with existing field length limits. Read-only/rich-text/push-button/multi-select or unsupported field flags/fonts/appearances are refused. Repeated copies of form-bearing source pages are refused.
- Selectable-text search and explicit selected-page English OCR. OCR returns page scope, language, raster size, word boxes/confidence, uncertainty and quality. It is a separate result and never changes the original.
- Saved history and restoration by appending a new revision; separate current read/change/export/delete/OCR grants and original owner checks.

Encrypted and signed PDFs, XFA, embedded files/active actions, text reflow or arbitrary nested form-XObject text rewriting, redaction, digital signing, accessibility/PDF-A and arbitrary non-Latin form appearance generation are unsupported. A highlight or ink rectangle does not remove data.

Bounds: combined source bytes and derivative at most4MiB, at most32 pages,64 operations,128 new annotations,128 added native objects,2048 original-object patches,256 fields,32MiB retained owner PDF bytes and a separate8MiB accounted structured-metadata budget,32 original sources and32 documents,100 revisions/document, one active job/owner and16 retained job receipts. OCR selects at most10 pages and retains at most1MiB combined report; previews cap1600px/side and4MiB. A producer has a five-minute deadline; every engine RPC is at most50s. Pre-work engine-busy retries have a five-second bound and refresh original permissions; unknown/lost-reply failures are not blindly repeated.

Immutable original/derivative content is stored in64KiB SQL parts, with independent per-part and whole SHA256. The same original SQL client publishes bytes, lineage and a head CAS in one transaction. Quota includes originals and all retained derivative history. Deleting history retains originals; deleting a source referenced by any history refuses. Original source and derivative update triggers refuse in both migration profiles. PostgreSQL adds forced original-owner RLS; the native engine retains its physical original-person namespace.

Retry receipts retain their exact fingerprints/results for24 hours, with at most256 records and2MiB encoded results per original owner (at most256KiB/result). Count/byte exhaustion refuses atomically; no active unexpired retry intent is silently evicted. Expired receipts are reclaimed on the next authorized mutation. Explicit document/source deletion tombstones matching receipts, retaining key/fingerprint/horizon and returning410 for replay instead of reviving deleted data. Removing unused originals or derivative history frees their stored metadata; byte and metadata quotas include all retained history. Metadata accounting includes models, inspections, job payload/results, retry results and a conservative per-row identity/header charge. A retry after the documented horizon may be a new intent; callers must reread current state before retrying uncertain old replies.

A queued/rendering result is incomplete. Status reads project a deadline-expired active record as failed without writing under a Reader; a later authorized begin settles expired rows. Cancel/revocation/deletion/stale head prevents publication. If continued admission is withdrawn before cleanup SQL can run, that refused queued job remains unreachable and counts active only until its five-minute expiry; a later authorized begin expires it. No guaranteed rollback across process death or revocation after an already-authorized SQL commit is claimed. Every later read/export remains freshly guarded.

The package uses only existing native `engine.exchange`, scoped SQL, current application authority and native generic artifact metadata/chunks. It never calls the old `/builtin/extract-text` relay, a service secret, a user-supplied URL, an owner selector or arbitrary shell command. Ordinary native artifact handles cap4MiB. Handle ownership/current producer-source proof requires the genuine full-kernel fixture; contract callbacks alone are not that proof.

The source bridge hashes worker/server/page_content/requirements, and verifies that identity on every engine reply. pypdf6.20.1, pypdfium2 5.14.0 and Pillow13.0.0 are pinned by wheel SHA256. Image assets cap1MiB and16MP; native object inspection caps512 objects/page and4096/document, with explicit read-only/truncation flags. The own sidecar image uses an official Python image digest and dated signed Debian repositories for Poppler/Tesseract/fonts. Source identity is not an image attestation: retain the built image digest and installed package manifest alongside final operator installation receipts. `engine/install-engine.sh` touches only the own compose project, asserts its project label, and leaves kernel mapping/admission/restart to coordinated root installation.

Run genuine source fixtures on the shared disposable PostgreSQL only:

```sh
python3 -m venv /tmp/my-pdf-runtime
/tmp/my-pdf-runtime/bin/pip install --require-hashes --no-deps -r engine/requirements.txt
export OSHAL_PDF_TEST_PYTHON=/tmp/my-pdf-runtime/bin/python
export STORE_CI_TOOLCHAIN=/path/to/store/scripts/toolchain
# Set OSHAL_TEST_POSTGRES privately to the disposable127.0.0.1:35689 URL; never a live DSN.
node --test tests/model.test.mjs tests/http-tools.test.mjs tests/engine-real.test.mjs tests/project-store.test.mjs tests/workbench-browser.test.mjs
```

Poppler utilities/Tesseract English and the pinned Playwright Chromium are required by real engine/browser fixtures. Missing prerequisites fail explicitly, not green-skipped. Each database/role, child and temporary directory is unique and cleaned; the shared container is never removed. The whole-store push gate runs the bounded HTTP/tool contract suite; genuine worker/SQL/browser suites are registered separately in Test Lab with their prerequisites. Source ALS original-grant and continuation wrappers, a held worker-delivery pause and tiny unit artifact chunks are named seams; no renderer, database or document bytes are mocked in the real source suites. The genuine PDF-only kernel fixture is published as f98d4944548972ff996acf6fe25859ab577b3a0b: native uploads/chunks, held approvals, immutable SQL revisions, real worker forms/OCR, current Viewer/Reader status, cancellation, withdrawal and protected exports passed. Only provider choice and bounded delivery of a completed worker reply are named seams; installed human/configured-provider acceptance remains separate.

Primary APIs: [pypdf merge/forms](https://pypdf.readthedocs.io/en/stable/user/merging-pdfs.html), [forms and appearances](https://pypdf.readthedocs.io/en/stable/user/forms.html), [annotations](https://pypdf.readthedocs.io/en/stable/user/adding-pdf-annotations.html), [security bounds](https://pypdf.readthedocs.io/en/stable/user/security.html), [Tesseract output](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 768 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| pdf-editing-command | editing command | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->

## Automatic concierge document handoff (source 0.1.1)

The workbench applies changed form fields, saves pending page/form/annotation
operations and waits for the genuine revision job to finish before the concierge
reads. It refreshes that same saved PDF after the concierge returns. Page
organization, form fields and annotations remain in the native PDF model.
Failed saves stop the handoff; concurrent browser drafts and another opened
document are retained. Historical questions retain the visible historical revision.

`tests/browser/document-handoff.test.mjs` covers repeated manual/assistant edits,
real SQL and PDF jobs, denied saves, concurrent fields and late jobs after a
document switch. It uses actual Poppler/pypdf and disposable original-owner SQL;
it does not prove installed provider acceptance, which remains pending.

## Bounded form lookup (source 0.1.3)

`pdf-read-model-part` accepts `part: "form-fields"`, the optional literal name
fragment in `query`, and offset 0. It searches case-insensitively under the
same current original-owner read permission. It returns up to eight exact saved
values within 8192 bytes, their original model-part indexes, and an explicit
matching-result `nextOffset`. Values are never clipped; an oversized single field
is refused. This lets the concierge find a requested value without spending its
whole tool budget enumerating fields. The revision receipt already supplies saved
page IDs for an additive annotation. Native operations retain untouched objects;
read only the parts needed and leave a step for the real approval card.

Source checks cover a late field, literal punctuation, byte-bound pagination,
exact values and mounted HTTP lookup against genuine disposable PostgreSQL,
including another actor and withdrawn read permission. They do not qualify the
installed 0.1.3 provider; that acceptance must follow deployment. The existing
portal-theme CSS from the UX lane is retained verbatim.

The existing authorization contract is retained byte-for-byte: this read selector
uses the existing read tool and permissions, so adding a tool binding does not
invalidate current composite role assignments. Installed promotion must verify
those assignments and statuses are unchanged.

The lookup travels in the tool's supported optional query parameter, leaving its
path canonical. Omitting query retains existing single-item behavior and input
requirements. The gateway keeps its percent-path restriction unchanged.

### Actual annotation coordinates (source 0.1.4)

The native revision receipt and pages model-part return each saved page's real
pre-rotation cropBox and a textAnnotationRect suggestion within those bounds,
avoiding existing native annotation rectangles when a free row is available.
No paper size is assumed. A null suggestion requires choosing another valid
placement. These read-only fields do not become properties of the engine model.
New annotation bounds, color, supported text and ink points are checked before
queueing a render, with the independent worker checks retained.

Installed0.1.3 fixed the bounded field read but its actual full provider trial
failed on geometry;0.1.4 has no installed-provider qualification yet.

## Upgrade and native editing contracts

Apply both schema migrations in the appropriate PostgreSQL or native profile.
New source/preview/image HTTP bindings change the authorization catalog revision;
existing installations require explicit named-role reapproval under the normal
application lifecycle. No blanket legacy grant is promoted automatically.
The native viewer/reader/change/export boundaries remain distinct.

The shared PDF AI partner saves focused fields and waits for the actual job, then
uses the existing PDF bot and native held approval cards. It reads selected stable
page/object IDs and complete text in bounded chunks. Draft Undo/Redo operates on
local edits; saved revision restoration appends a new immutable revision. Provider
unavailability is reported without simulated edits.

`tests/content-editor.test.mjs` independently extracts text and renders paths,
transparent inserted images and reimported-image transforms through Poppler.
`tests/browser/content-editor.test.mjs` exercises real original-owner SQL/worker
save/reopen/export, focused invalid fields, phone drawers, immutable asset
references, one-click object selection after property blur and Undo pixel reset.
These source tests do not establish installed provider availability.
