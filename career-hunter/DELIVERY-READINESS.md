# Intelligent Career delivery acceptance

The complete objective remains in progress: truthful custom resumes and cover
letters per job, interview preparation, fast indexed search and matching,
a polished interactive UX, healthy scheduled operations, complete Jarvis access
and automatic submission. A deployed release or passing component cohort alone
does not establish that the entire product is complete.

## Installed release: 1.46.9, verified October 28, 2026

Application source `7b97489e` is active on bare metal through a Career-only
package reload. Native process `1368618` and corpus import `1642420` continue
unchanged. Complete application manifest:
`3a6aecd421bca94506cdb7cdb62a0ad80c645f2ec67f3688f6487822b3706ef9`.

The submission queue now has a compact job selector beside one selected
application. It opens preparation directly, keeps unfinished per-job tailoring,
conversation and additional-experience choices while switching or filtering,
and separates tailoring/generation, document review and submission approval.
The selected workspace retains one tabbed document viewer, one PDF action and
one Edit action. Queue/status screens no longer repeat the stage navigation as
another set of tabs. Queue search, filters and browser-worker controls use a
compact header; hidden preferences stay in the selector. At phone widths the
selector stacks above the workspace and selecting a job brings it into view.

All **34 focused checks passed**. Browser proofs cover actual page markup,
promotion without generation, embedded stage navigation and separate filter
memory, two-job selection with retained drafts after filtering, sidebar
alignment, phone layout without horizontal overflow, retry/refresh behavior,
document sandboxing, paging past 400 results, and existing feedback behavior.
No full store CI or push was run.

The signed-in live cockpit displayed ICF and KBR documents when selected. ICF
retains the selected OSHAL experience and its successful 8:32 PM document
generation. No employer application was sent and no packet was regenerated
during layout verification. A fresh cockpit tab was used after an older tab's
frame remained blank. Opening a new queue view loaded the final source; the
outer Reload control had retained an earlier cached page during this check.

Evidence: `/tmp/career-queue-layout-focused.log`,
`/tmp/career-1469-live-layout.json`, `/tmp/career-1469-live-layout.png`, and
`/tmp/career-1469-activation-plan.json`. These UI checks do not establish that
the entire Career product objective is complete.

## Previous release: 1.46.6, verified October 28, 2026

Application source `302a2feb` is active on bare metal, with the same native
process `1368618`, native executable `48c16e62`, and uninterrupted corpus-import
process. The complete application manifest is
`ca9937340a0bfa58888cc68949f8096a53920d5debff8c4fb820e9d0d233f4f1`.

Application preparation now has one tabbed resume/cover viewer, one selected
PDF download, one editing action, and a visible generation/regeneration action.
Tailoring and experience selections remain intact through retries. Completion
clears stale failure messages; retained open panels update when application
status changes. Submitted packets expose a read-only document viewer rather
than regeneration or another submission action. Preview scripts and event
handlers, including proxy-injected scripts, are stripped without enabling
scripting or removing an existing content security policy.

An explicitly mistaken manual submission mark can return to preparation through
the original-owner status route. This requires an applied/manual-mark record,
a bounded reason, and no native intent, task, confirmation, claim or later-stage
evidence. It retains the previous status/date/source in bounded private audit
history. SQLite commit failure restores the preceding metadata bytes. Actual
worker submissions and another original owner cannot use the correction.

**58 focused checks and one continuous native workflow passed.** The native
proof corrects a manual mark, keeps the exact packet bytes, rejects another
owner, and then refuses correction of a real worker submission to its owned
test employer. Browser coverage includes failure/retry, one document viewer,
retained tailoring, script-free previews, submitted-state synchronization and
returning a mistaken mark to preparation.

For the owner-confirmed live correction, the preceding packet was backed up,
the mark was corrected with an audit entry, and generation with the selected
additional project completed at **8:32:13 PM America/Chicago**. All four real
PDFs parsed successfully. The master resume and 18 files in unrelated saved
packets remain byte-identical. No application was sent to a real employer.
The corrected draft survives a full workspace reload, with one PDF action,
one edit action and an enabled regeneration button. No new blocked-script
preview warning was observed. Matching was re-enabled after source review;
the matching and mailbox routines are active, and the browser worker is ready.

Evidence: `/tmp/career-regeneration-final-focused.log`,
`/tmp/career-1466-staged-native.log`,
`/tmp/career-1466-installed-acceptance.json`,
`/tmp/career-1466-icf-regeneration.json`,
`/tmp/career-1466-live-ui.json`, and
`/tmp/career-1466-live-regeneration.png`.
Receipt: `release-inputs/career-1466-302a2feb/delivery.json`, selected by
`/tmp/career-current-receipt-path`. Code and delivery documentation remain
committed locally; nothing was pushed. The broader product acceptance below
remains incomplete.

## Previous release: 1.46.3, verified October 28, 2026

Application source `02db2e89` was activated on bare metal at **6:43:52 PM
America/Chicago** using the native single-package reload endpoint. The existing
native executable `48c16e62`, frontend, bridge and every non-Career application
file were retained. Complete application manifest:
`426a00f1a2eb067dffdc74aa3aaa3126d499de433a9af437a37637891a09af70`.
The native process and its read-only mounted corpus import kept the same process
identities throughout activation. No daemon restart or interrupted import was
needed. Deployment helpers are committed locally as `a11b7e67` and `34ea6d5a`.

Starred active jobs form a server-paginated prefix, including saved openings
that have not been AI scored. The selected sort applies within that prefix and
the remaining matches; hidden preferences and explicit search/pay filters still
apply. The live owner board showed all **24 starred jobs before other matches**.
Job titles open posting and fit information; the ambiguous Details action is
gone. Promotion only queues and stars a job. Preparation explicitly selects
experience and generates documents, then presents document review, editing and
one reviewed-submission action. Interview preparation follows recorded
submission. Board stages change in place, and each stage retains its own search,
sort and page-size preferences. A newly promoted job's preparation panel opens
when it is present in the loaded queue page.

Additional experience is an original-owner library of projects/products, other
employment, volunteering and skills outside the master resume. Saved portfolio
facts appear as a selectable project without rewriting the master. Entries are
revision checked and archivable/restorable; generation uses only selected
additional entries and preserves their recorded work type, organization and
dates. The user's existing OSHAL work is available and unchecked for a new
application. The preparation panel and Resume Studio link to the library.

**65 focused checks passed:** 44 Career cases, 20 deployment-helper cases and
one continuous native submission/status/mail workflow using the exact staged
application. The generation contract runs the engine and templates with owned
model responses. Native submission targets an owned employer fixture. Live UI
checks inspect the existing packet's preview and document links; no real
employer application was sent as a test. Matching and email schedules are active
with completed latest checks, and the dedicated browser worker is ready. The
master resume and saved KBR packet remain byte-identical across normal owner
generation changes.

Evidence: `/tmp/career-flow-focused-ci-1463.log`,
`/tmp/career-flow-hot-activation-focused.log`,
`/tmp/career-1463-staged-native.log`,
`/tmp/career-1463-installed-acceptance.json`,
`/tmp/career-1463-live-board.png` and
`/tmp/career-1463-live-preparation.png`.
Receipt: `release-inputs/career-1463-02db2e89/delivery.json`, selected by
`/tmp/career-current-receipt-path`. All commits remain local under the owner's
instruction; no full-store CI or push was run. The broader product acceptance
and the remaining Jarvis/recovery transitions below are still incomplete.

## Previous release: 1.45.6, verified October 28, 2026

Application source `38bdc20f` and native core `771ff31a` were activated on bare
metal at **4:36:28 PM America/Chicago**. Frontend source `35a626bb` and all other
application files were retained. Full application manifest:
`1d17d92a427804b5977d34899c85322a4b1ca71461f4be6437f3306b505ff12b`.
The same original-owner role remains active, matching and mailbox schedules are
restored, and the browser worker reports ready.

The board retains cards, expanded documents and scroll anchors during pending
filters; failures retain prior results and offer Retry. Favorites update their
card without refetching the list. Next/Previous load the selected server page
and return to its top. Load more appends a batch, with no fixed 400-item list.
Stable posting identifiers break ranking ties. Indexed open search now pages
past the former 2,000-item depth ceiling; the explicitly reported unindexed
legacy keyword fallback retains its bound. Corpus sorts use every scored match
instead of reordering a changing top-score subset.

Not interested records reversible original-owner rules for an opening, title
phrase, company, location or a title/industry keyword. Rules apply before
pagination in Search Jobs, active board matches and Jarvis reads. Explicit
saved/queue/application history remains accessible. Hidden preferences removes
a rule. Repeat employer URLs are consolidated within loaded results while
distinct requisition parameters are retained; this does not claim semantic
deduplication of every independently syndicated posting.

The actual corpus and owner databases already carry the needed date, score and
full-text indexes. A deep exhaustive request previously let SQLite scan the
large corpus; it now retains signal-driven primary-key lookups. Controlled
read-only measurements found page 9 beyond 400 returned 50 jobs, and the
exhausted page completed in 503 ms on the final warm run (the earlier cold run
was 40.9 seconds; these are different cache states, not a promised speed ratio).
A separate owned-copy benchmark measured per-file durability flushing at
15,817 ms versus 719 ms for a Linux filesystem flush. The native implementation
uses that completed barrier before the unchanged durable selector commit;
writeback errors and linked output cannot publish. This is not a power-loss
simulation or a claimed live request latency.

Focused evidence: **95 checks**, comprising 43 real SQLite/preferences cases,
6 real browser cases, 22 reader/experience cases, 9 publication cases,
14 guarded-activation cases and one continuous native workflow. The native
fixture persists/removes company feedback, proves another owner still sees the
shared opening, then completes the approved packet/worker/status/mail workflow
against its owned employer fixture. No employer application was sent as a test.
Browser continuation reaches 450 cards; indexed SQLite search reaches 3,000.

Live UI evidence verifies disjoint pages of 50, Next at scroll position zero,
and Load more retaining those 50 while growing to 100 cards. The exclusion
dialog exposes every reason; its demonstration was canceled without persisting
a test rule. The master and the existing KBR packet are byte-identical.
Acceptance: `/tmp/career-1456-installed-acceptance.json`; UI screenshots:
`/tmp/career-1456-live-board.png`, `/tmp/career-1456-live-feedback.png`.
Receipt: `~/.local/state/oshal-native/release-inputs/career-1456-38bdc20f/delivery.json`.
A live explicitly scoped Jarvis save (`Use Intelligent Career to save/star job …
on my board`) succeeded and retained the existing star, packet and master.
A preceding plain save without the application name reached a reader handoff
and incorrectly claimed no plain save action; contextual classification and
that refusal wording still need follow-up. The broader objective and the
incomplete transitions below remain in progress.

## Previous release: 1.45.5, verified October 28, 2026

Application source `29d79fee` was activated on bare metal at **9:48:31 AM
America/Chicago**. The native core, frontend and matching bridge remain pinned to
`35a626bb`; no other application's source changed. The complete public-app
manifest is `5d30c62f612c05748446518799f926e6c80f2b85e2ab413157f151b4b44bffea`.

Submission activity now exposes **Resume approved submission** when approval was
published but its binding/start request was interrupted. Recovery reads the
current native state, keeps the same intent and frozen packet, publishes any
missing ticket binding separately, then starts that exact ticket. Unknown and
expired approvals cannot become executable retries. Connection and non-JSON
response failures show readable guidance. The activity screen includes the
existing application-email helper for successful resumed starts.

Twenty focused submission/recovery checks and three experience-contract checks
pass. The obsolete 1.29.1 version pin in the experience check was replaced with
a valid-version assertion; its actual route, map and named-role constraints are
unchanged. A manifest comparison confirms only the release version and start
tool's recovery instructions changed; the authorization catalog is byte-identical.

The continuous native proof now starts from the actual activity page after
approval. It discards the server's successful start response, recovers the saved
work without a replacement approval, and reaches exactly one owned TLS employer
submission. Two confirmation screenshots are retained, application status is
recorded, a synthetic interview email advances status, and a second original
owner remains isolated. The fixture uses native HTTP, PostgreSQL and owner SQLite
generations with the candidate package. No real employer receives test data.

The deployed owner activity page loads with a ready browser worker. The final
board displays 50 jobs with seven days selected. Both matching and application
mail routines are enabled at their prior cadences. A real scheduled mailbox
check after the update completed at **9:52:48 AM America/Chicago**; the native
job reports completed with no error. The master and saved KBR application packet
are unchanged.

Evidence: `/tmp/career-submission-recovery-focused.log`,
`/tmp/career-submission-recovery-contract.log`,
`/tmp/career-submission-recovery-native.log`, `/tmp/career-1455-manifest-scope.log`,
`/tmp/career-1455-installed-acceptance.json` and
`/tmp/career-1455-live-activity.png`. The current receipt is
`release-inputs/career-1455-29d79fee/delivery.json`, selected by
`/tmp/career-current-receipt-path`.

The full objective remains active. Specific remaining recovery work includes
safe cancellation/renewal of expired native submission intents and original-owner
email-monitor activation when an approved application starts through Jarvis/API
or its start response is lost. Existing mailbox checks do reconcile accepted
native results when that routine is enabled; that is separate from proving
automatic enrollment of a new caller. Remaining supported Jarvis transitions and
login/challenge/manual handoffs still require their completion audit.

## Earlier Jarvis save and panel recovery, verified October 28, 2026 UTC

Native and frontend source `35a626bb` are active on bare metal at **07:18:55
UTC**. The application remains 1.45.4 with the complete
`142728920419f7b1792822cc99e5be7062d9912c701b6968e2a355c46e08d538`
manifest unchanged. The matching bridge has the same 93 JavaScript files as the
previous runtime. Only the frontend's `jarvis-orb.js` changed.

A real Jarvis save was refused because a slash-separated save/star command fell
into the implicit saved-data Reader lane. Explicit save/star, use-app-to-save and
set-saved commands now retain ordinary Writer admission; status and how-to
questions remain Reader-only. Route permissions, original-owner admission,
revocation checks and submission approval gates are unchanged. The native
regression failed before the correction and passes afterward. Three focused
native tests cover save/promote, foreign-owner isolation, Reader exclusions,
source drift, role withdrawal and explicit task routing. The command classifier's
selected unit test also passes.

The embedded assistant was also visibly blank while the direct page loaded.
It now reveals its panel before creating an explicitly eager iframe. A named
Reload Jarvis button retries only frame navigation; it never resends a prompt.
Two Chromium tests cover a failed initial load, recovery and retained drafts on
close/reopen at desktop and phone widths. Twelve adjacent frame recovery and
surface-binding checks pass. The release build and changed-file formatting pass.

The original-owner live panel now loads normally. Jarvis called `career_save`
once and `career_job` once, successfully reading back the selected KBR job's
saved star. Its existing ready state, master and saved application packet are
byte-identical. Live Reload restored the result without another action. Both
matching and mailbox routines are enabled at their prior cadences, the dedicated
worker is active, and the final board displays 50 jobs with seven days selected.
No employer application was sent for verification.

Evidence: `/tmp/career-jarvis-save-native.log`,
`/tmp/career-jarvis-command-focused.log`, `/tmp/career-jarvis-orb-browser.log`,
`/tmp/career-jarvis-neighbor-browser.log`, `/tmp/career-jarvis-build.log`,
`/tmp/career-jarvis-installed-acceptance.json` and
`/tmp/career-jarvis-save-live.png`. The latest paired receipt is
`release-inputs/career-jarvis-35a626bb/delivery.json`, selected by
`/tmp/career-current-receipt-path`; later deployments must inherit this runtime.
These are component acceptances. The full objective remains active while the
remaining supported Jarvis transitions and workflow recovery receive their
requirement-by-requirement audit.

## Earlier native handoff repair, verified October 28, 2026 UTC

A continuous test against the installed 1.45.4 package found that the real browser
submission and evidence retention succeeded, then `/submission-queue/:id/sync`
returned HTTP 503. The guarded application and tool hosts had omitted forwarding
`get_ticket_work` and `get_accepted_artifact`, so actual calls reached the SDK's
unavailable defaults. Both adapters now forward through their existing checks
before and after the awaited operation. The underlying original-owner, package,
source and exact-artifact checks remain unchanged.

The repaired continuous test passes: specifically approved valid PDF bytes go to
one owned TLS form, two Chromium screenshots are retained, native reconciliation
records the application, and a synthetic Gmail interview message advances its
status. A second ordinary owner cannot read or reconcile that intent. This uses
real native HTTP, PostgreSQL, owner SQLite generations and the installed Career
routes. Only the copied test package's Gmail endpoint URL and egress host are
rewired to the owned TLS mailbox; its other source bytes are checked unchanged.
No employer or real mailbox receives test data. The test begins with a prepared
packet; real per-job generation and editing have their separate evidence below.

Focused checks pass: the continuous native workflow; the existing browser worker
CLI acceptance; one adapter check covering twelve source/tool/lifecycle cases;
21 queue/workflow/mail checks; and three interview checks including nine engine
grounding/recovery cases and real narrow-screen Chromium practice/replay.
Evidence: `/tmp/career-workflow-native.log`,
`/tmp/career-ticket-forwarding-focused.log`, `/tmp/career-worker-cli-focused.log`,
`/tmp/career-workflow-focused.log`, `/tmp/career-interview-recovery-focused.log`.
Native source `ca0d5589` and its matching, code-identical bridge were activated
on bare metal at **06:56:45 UTC**. The application remains 1.45.4, with its complete
`142728920419f7b1792822cc99e5be7062d9912c701b6968e2a355c46e08d538`
manifest unchanged. The frontend, all application files, master and saved KBR
packet are unchanged. The dedicated worker is active and the original-owner board
shows it ready, renders 50 jobs with seven days selected, and has no load error.
Both schedules are enabled. Application status shows the real mailbox monitor's
check at **1:59:42 AM America/Chicago** and its automatic 15-minute checks.
No real employer application was sent for acceptance.

That repair's receipt is `release-inputs/career-handoff-ca0d5589/delivery.json`,
superseded by the current runtime above. Runtime-only activation means a later
candidate must inherit the latest native core/bridge pair rather than an older
paired application receipt. `/tmp/career-handoff-installed-acceptance.json` and
`/tmp/career-handoff-live-board.png` retain live component acceptance.
The full objective remains active; broader supported Jarvis state transitions and
remaining workflow recovery/UI acceptance still need the full completion audit.

## Installed release: 1.45.4, verified October 28, 2026 UTC

The native release gives Jarvis the existing declared Resume Studio draft
operation and extracts bounded, validated actions from its reply. It cannot save
or submit, alter role anchors, or change a master cover letter. Draft replies stay
bound to the selected document; a changed selection shows a clear notice instead
of silently applying an old edit. The narrow desktop composer also shows its full
placeholder. Four native HTTP/context checks pass, including malformed/oversize
edits, protected master fields, undeclared operations, loading state and caller
authority refusal. Seven browser binding/replay checks and two layout checks
pass. Application `8754aa4b` and native/frontend/bridge source `bb157f68`
were activated on bare metal at **06:31:44 UTC**. No application files outside
Career changed; all permissions, routes, tools and approval gates are unchanged.
Both matching and mail schedules are enabled at their prior cadences.

The actual Jarvis panel changed only the separator in the selected KBR packet's
headline. The complete visible resume and cover text matched the original except
for that single requested change, and the editor showed "edited by Jarvis — Save
to re-render the PDF". The test draft was discarded through Reload; the saved
packet and master hashes remain unchanged. No employer application was sent.
The narrow editor now shows its entire placeholder and Send is clear of the orb.

The full application manifest is
`142728920419f7b1792822cc99e5be7062d9912c701b6968e2a355c46e08d538`.
Evidence: `/tmp/career-1454-draft-acceptance.json`,
`/tmp/career-1454-jarvis-draft.txt`, `/tmp/career-1454-live-editor.png` and
`release-inputs/career-1454-8754aa4b/delivery.json`.
This confirms the document/Jarvis component. The full product objective remains
in progress: broader supported Jarvis state transitions, interview recovery and
an owned fixture across submission, status and mailbox monitoring still need
completion acceptance.

## Earlier installed release: 1.45.3, verified October 28, 2026 UTC

The editor composer sits directly below its heading, keeping Send away from the
shell assistant. A real Chromium click test fails on the prior layout because the
orb intercepts the click and passes on the new layout. The phone layout still
passes. The 29 document checks also pass. The paired native/frontend candidate
binds bridge messages to each admitted screen's actual route provider, including
borrowed screens, with that provider's declared operations. A delayed assistant
reply cannot apply operations after the user changes documents or replaces the
surface. Native source `d3c19b6a` and application `b34e88cb` were activated at
**06:17:34 UTC**. Ten native navigation/access checks and six browser binding
checks pass. Both schedules are enabled. The actual Jarvis panel correctly named
the KBR packet, title and saved headline, with no refused bridge messages. The
same live check confirmed that the native assistant could not yet prepare a draft
edit; it said so truthfully and changed nothing. The next candidate addresses this.
Evidence: `/tmp/career-1453-jarvis-packet-read.txt`,
`/tmp/career-1453-live-editor.png` and
`release-inputs/career-1453-b34e88cb/delivery.json`.
The full application manifest is
`eff4c2ce5f6741fd1cc7f7eba0519e4dc6ee712a13077abfc3fcb38cf6f5e8d9`.

## Earlier installed release: 1.45.2, verified October 28, 2026 UTC

Resume Studio now binds loading, guide and save operations to the selected
document, ignores late reads and closes editing while a guide/save is pending.
Failed loads clear the old draft, and deep-linked packets stay selected when the
slower generated-job list arrives. Malformed custom edits cannot crash the
preview or alter master role anchors. The packet preview carries its saved
candidate name, education, certifications and cover letter, with separate PDF
links. The original per-job packet is copied to private maintenance storage
before the installed edit/save acceptance. No user master edit is planned.

The editor/route/master cohort has **29** passing checks, the phone layout check
passes, and the compiled route's original compiler/map policy was verified before
emitting. Reload recovery has **7** passing checks; paired activation has **14**.
A private temporary PostgreSQL cluster on loopback now supplies stronger native
proof: **23** browser/history/tool checks pass, including one real Chromium
multipart submission to an owned TLS form, retained screenshots, one-use permits,
redelivery refusal and actual database restarts. An additional original-owner
Career reader proof passes against PostgreSQL with unchanged SQLite byte witnesses.
The running browser worker's three primary libraries match the installed source
used by the browser fixture. These are focused cohorts, not full OSHAL CI.

Application source `c204915e` was activated on bare metal at **05:52:17 UTC**,
with native core/bridge `8171107d` and frontend `4468820d`. Other applications
were preserved byte-for-byte. In the actual KBR packet 2250228, the editor changed
only the requested headline, preserved every other resume and cover field, and
saved/re-rendered a valid two-page resume and one-page cover PDF. Private before
and after copies and hashes are retained. The master profile is unchanged. The
installed UI shows the candidate name, education, certifications, cover letter and
separate PDF links. Browser download automation timed out; the generated PDF
bytes and extracted text were verified on disk. Both existing schedules were
restored enabled. No employer application was used as a test.

The full application manifest is
`9666eaeaa0d9295b31f248f66a9ed752862834a79c30cc288523cfd8b963dd87`.
Evidence: `/tmp/career-1452-document-acceptance.json` and
`release-inputs/career-1452-c204915e/delivery.json`.
The live test exposed an orb/Send overlap and dropped editor context in the
composed experience; 1.45.3 above addresses these. Full submission/status/mail
completion remains pending.

## Earlier installed release: 1.45.1, verified October 28, 2026 UTC

Application source `dbcf2f57` is installed on the bare-metal native service from
`8171107d`, with its matching bridge and frontend bundle from `b3a23a8f`.
The full application manifest is
`04f2da511d63dda0846065db2bbb6266ad84ffefa744c14f4d59833c6ae7a8aa`.
The guarded application activation completed at **05:15:40 UTC**. All other
applications were retained byte-for-byte; the original master profile hash is
unchanged and the dedicated browser worker is active/ready.

The patch retains file-change consistency checks but returns the legacy profile
revision timestamp as unknown. A generation/export file's mtime can advance
without any résumé content change. Fifteen focused reader/provenance checks pass,
including an unchanged profile assigned a new file timestamp. The real embedded
chat now explicitly says it cannot date the résumé edit and that neither source
timestamp is a résumé edit date. It also correctly says not-revalidated proves
neither currentness nor staleness, and returns six fresh high-fit jobs with the
original owner's saved 70-mile/remote-inclusive preference.

The installed shell loads the chat and selected tool surface immediately. The
board rendered 151 cards with 200 selected, reached page four (one last card) at
50, and was restored to page one, 50 results, seven days. Both matching and mail
routines are enabled with their original cadences. Their retained last completed
checks were **05:02:18 UTC** and **05:07:22 UTC**, respectively. No real employer
application or further purge was used for verification.

Current evidence: `/tmp/career-1451-installed-acceptance.json`,
`/tmp/career-1451-focused.log`, `/tmp/career-1451-embedded-saved-read.txt`,
`/tmp/career-1451-live-board-chat.jpg`, and
`release-inputs/career-1451-dbcf2f57/delivery.json`. The receipt verifies this
component cohort; the full delivery objective remains in progress. Next acceptance
includes document edit/save, supported Jarvis writes and state transitions, and
an owned fixture through submission/status/mail. Initial-load Reload recovery
also needs a focused check: the shell currently reloads the frame's current
location, which could still be about:blank before its intended navigation commits.

## Earlier installed release: 1.45.0, October 28, 2026 UTC

Application source `2ba577b9` is installed on bare metal. Its full public-app
manifest is `41563c1bc1de5f63e87cd8ddaebde5d10c90d31357ec8eff2c402d3e144e69a9`.
The native core and matching 93-file bridge are pinned to `8171107d`;
the bridge's code is unchanged from the verified `7bd745b7` bundle. The frontend
bundle from `b3a23a8f` changes the cockpit index and tool-view controller: interactive
frames load immediately once their existing enable gates select a workspace. All other
frontend assets and all installed application files were retained byte-for-byte
through the native and panel updates.

The board now distinguishes **AI fit** from keyword fit, preserves an actual
zero, and shows each saved assessment date (or that its date is unknown).
Details explain that a saved score is not a hiring probability and must be
rescored after relevant résumé or job changes. Provider/model metadata is shown
only when it is structured and attributable; an input fingerprint alone does
not establish currentness. The unsupported hiring-probability and high-win
rankings have been retired; their compatibility fields return null. Best AI fit
is the default comparison. Historical sort links resolve to that indexed sort.

Original-owner Jarvis snapshots now use the saved matching area, the strict
remote-only preference and the same conservative fully-remote classification as
the board and search. Hybrid, negated-remote and remote-sensing descriptions do
not acquire remote eligibility from the word alone. A snapshot's newly indexed
high-fit count means AI fit >=70, first seen within three days, within saved scope;
keyword scores do not enter that count. Title categories requested as alternatives
must be searched separately; the manifest explains this and the seven-day default.

A real saved-match question initially failed before inference with "implicit
Career questions require a read-only host". The dedicated bot HTTP adapter had
passed its conversation-saving Writer into tool execution. It now narrows that
same original context to Reader for the exact predicate used by the native
evidence guard. Explicit preparation/submission commands retain their existing
Writer admission. No grants, roles, tiers, providers or approval requirements
were widened. Conversation persistence still uses its separately retained Writer.

The installed original-owner chat successfully read the saved snapshot, returned
three dated historical AI assessments, the saved 70-mile area including remote
roles, and **six** newly indexed high-fit jobs. It explicitly said the historical
scores were not revalidated against the current résumé. The native reader is
mandatory before inference for this class of question. New conversation nonces
now select separate sessions without deleting history. Assistant replies reuse
the existing escape-first Markdown renderer; user input, refusal text and nested
drafts remain literal. Failed sends appear beside the attempted message and keep
its text available for retry.

Focused verification: application scoring/scope/remote/query cohort **105**;
native host, history and tool authority **17**; classifier **8**; embedded chat
controller **7**; surface URL forwarding **2**; guarded activation **12**, all selected checks passing. These
cohorts are not a full OSHAL CI run. Two existing PostgreSQL restart cases were
not accepted in this environment because no owned disposable PostgreSQL fixture
is configured. Process-handler tests used the existing immutable bare-metal
runtime dependencies. All 25 native API tools and 54 Test Lab recipes passed
their admission/catalog checks for 1.45.0. Four actual read-only board query
shapes took 47–141 ms, and actual owner-snapshot shapes 75–154 ms, against the
published 7.46 GB corpus. These are observed timings, without a speedup guarantee.

The installed board returned 151 cards with 200 results selected and reached page
four (one final card) at 50 per page. Its final view is page one, 50 and seven days.

The guarded native activation completed at **05:01:37 UTC**, followed by the
panel-only frontend activations at **05:05:37 UTC** and **05:11:22 UTC**. Both matching and application
mail routines were restored enabled at their existing cadences. The original
master profile hash, corpus, application tree and browser submission queue were
preserved. No employer application was sent and no further purge was performed.

Evidence: `/tmp/career-host-selected.log`, `/tmp/career-host-api-unit.log`,
`/tmp/career-chat-focused.log`, `/tmp/career-chat-activation-tests.log`,
`/tmp/career-1450-native-saved-read.txt`, and the private receipts
`release-inputs/career-chat-8171107d/delivery.json` and
`release-inputs/career-chat-panel-b3a23a8f/delivery.json`.

The installed 1.45.1 section above supersedes the profile-file timestamp issue
found during the 1.45.0 live read. A saved score being not-revalidated does not
prove that it is stale or current.

Full delivery remains in progress. Remaining acceptance includes the installed
custom document edit/save round trip, broader interview recovery, all supported
Jarvis write/state transitions, and an owned fixture through submission, status
and mailbox monitoring. No real employer application is used as a test. The
historical sections below retain earlier evidence and then-open issues; resolved
items are superseded by the current release sections.

## Earlier installed release: 1.44.0, verified October 28, 2026 UTC

Application source `e366ead2` is installed on bare metal, with native core and
runtime bridge from `7bd745b7`. The current application manifest is
`4f71fd897041486ef97ffea8090e32a8cd83b7b4621342249f9a69b6313994d5`.
Other applications were copied from the then-current installation unchanged;
the existing canonical application path and all its release guards remain.

The installed board's sort and worker selectors are enabled and were changed
through the real owner UI. Page three loaded, and the 200-results option rendered
151 current matches. The final view is Best fit, 50 results and seven days.
The dedicated browser worker reports ready.

Native manual scoring now uses the same saved title selector as nightly matching,
including explicit adjunct and support titles, with the same owner, area, remote
preference, seven-day window and 1–50 limit. The installed one-job run
`861fda17-8fac-41fb-a312-5c61c13ea1d6` completed at **04:12:11 UTC**, scored one,
skipped zero, and retained actual `claude-account` / `sonnet` attribution and its
input fingerprint. Empty or unavailable title profiles refuse before inference.

The first live stop check exposed an older external bridge despite the newer
native binary. A separately verified 93-file bridge bundle now matches that
binary; only two runtime JavaScript files differ from the old bundle. The actual
Stop scoring control then appeared and stopped run
`7779fd9f-880f-4af7-a041-b410d186dc2f` at **04:16:23 UTC**. The original-owner
native API reports cancelled, and the earlier success receipt remains intact.
Both matching and mailbox schedules remain enabled with the same scopes/cadence.
A post-update application-mail check completed with HTTP 200 at **04:18:21 UTC**.

Employer-pay parsing preserves decimal-K amounts, explicit currencies and
per-course units; unknown periods stay unknown in rendering and filtering.
An atomic copy of the published corpus corrected **8,798 Ashby rows**, including
1,154 amount corrections, 425 currency corrections and 8,787 period corrections
(these overlap). It skipped 178 ambiguous quotes. Only four salary columns were
updated; all **2,515,710** postings and the schema were retained. SQLite quick_check
passed on the candidate. The original corpus is kept for rollback, and the last
pull marker was preserved. The real Hinge card now shows **$157,400–$217,800 ·
period unknown**, instead of $4k–$8k/year. The private master profile is unchanged.

Focused checks: salary/source/UI cohort 47, manual-title/native-state cohort 47,
board-control cohort 16, bridge cohort six, activation cohort 12, all passing with
zero skips. Cohorts overlap and must not be added. All 25 native API tools pass
admission, and all 54 Test Lab recipes validate. Four actual read-only board query
shapes against the 7.46 GB corpus retained date, FTS and user-score indexes and
completed in 23–236 ms with the remote correction; this is an observed run, not a
latency guarantee or portable PostgreSQL proof.

Private installed evidence: `/tmp/career-1440-installed-acceptance.json`,
`/tmp/career-1440-live-board.jpg`, `/tmp/career-1440-live-cancelled.jpg`,
`/tmp/career-remote-live-performance.json`. The delivery receipt is
`release-inputs/career-1440-e366ead2/delivery.json`. No employer application was
sent by verification. Full delivery remains in progress, especially score
provenance/ranking, complete Jarvis operations and fixture-to-status/mail proof.

## Earlier 1.43.1 evidence

Career **1.43.1**, application source `99407422`, previously ran on native
core `7bd745b7`. The evidence below records that release and its then-open gaps;
the 1.44.0 section above supersedes resolved items. The existing shared
application path is preserved, and the separate Trading update present during
staging remains byte-identical. All prior release guards remain; there is one
canonical public-application manifest guard.

The full source pull completed at **02:56:57 UTC** with **14,413 new postings,
443,901 refreshed and 3,341 closed**. It reported **509 confirmed and 602
unconfirmed sources**. Those counts describe the actual publication, not a claim
that every provider succeeded. Failed and unconfirmed feeds preserve existing
postings. The prior engine process and working copy were gone before activation.

The original owner's nightly pass completed at **03:09:22 UTC**: **143,917
keyword matches updated, 50 AI-scored, zero skipped**. Keyword matches are not
AI assessments. The original owner's master profile remains byte-identical:
nine roles, 257 skills, two education entries and six certifications.

A real post-install manual pass completed at **03:19:03 UTC**, limit one,
scored one, skipped zero. The saved result records actual `claude-account` /
`sonnet` attribution, `fallback: false`, and an evidence fingerprint. This proves
the installed identity/guard/attribution path, without changing the configured
model or claiming upstream weights are immutable.

The original-owner matching and mailbox routines were reactivated with the same
scopes and cadence. Both returned HTTP 200. The mailbox state is connected with
no error; a subsequent scheduled check also completed at 03:37 UTC. Matching
checks every half hour; application-mail checks run at minutes 7, 22, 37 and 52.
The next full shared pull is the existing evening cadence.

## Historical 1.43.1 requirement matrix

| Required outcome | Authoritative evidence | Remaining acceptance or correction |
| --- | --- | --- |
| Truthful tailored documents | Two distinct real jobs previously generated source-grounded two-page ATS resumes, compact variants and one-page covers. Installed board downloads for KBR match the actual owner packet hashes: two-page resume and one-page cover. Full profile/job evidence and oversize refusal are tested. | Installed custom edit/save round trip and further role breadth; preserve all factual and ownership gates. |
| Interview preparation | Original-owner eight-question job-specific guide, persisted practice feedback and actual Jarvis interview read were verified previously. | Additional role/failure recovery and current-release edit/practice acceptance. |
| Indexed search and matching | Live search previously reached page three and 200-result mode. Installed Jarvis completed two actual career_database reads in 513 and 487 ms. The new full publication and 50-score nightly receipt are real. | Query-plan/latency regression on the actual corpus for pending remote changes; manual saved-title selection, stale-score labels and derived ranking corrections. |
| Interactive polished UX | Front keyword search, pay bounds, compact saved searches, pagination and readable navigation are present. New Settings displays selected-job document preparation and exact-packet review; unsupported legacy digest/bulk controls stay inactive without changing saved consent. | Sort and worker selectors are disabled after menu population; fix these. Correct employer-pay parsing and truthful missing-unit/currency display. |
| Healthy operations | Completed atomic full publication, retained per-source outcomes, connected mailbox and successful matching/mail schedules; private profile hash unchanged. | Confirm generic source compatibility individually and retain useful empty/challenge reasons; selected generic pages without job bodies still need detail coverage. |
| Jarvis coverage | All 25 API tools pass native admission. Installed Find request returned five local openings for a temporary 50-mile search; the saved 70-mile area remained unchanged. Actual original-owner career_database tool completions are recorded. Prior document/master/interview tools were exercised. | Current-release accented-resume read, approved document edit/write, remaining state transitions and all supported workflow operations. |
| Automatic submission | Dedicated approved bare-metal browser worker remains active; original-owner board says ready. Exact packet approval, one-use final permit, durable result recovery, native HTTP and owned TLS form tests have passed. | Installed fixture-to-submission/status/mail proof, login/challenge handoffs and installed cancellation/recovery UI. No real employer application is used as a test. |
| Delivery integrity | Local commits, focused CI only, source/config CAS, immutable artifacts, atomic exchange and rollback. New activation checks verify actual portal assets as well as kernel readiness. | Continue the full completion audit; no push, full OSHAL CI or additional purge is authorized. |

## Installed workflow evidence

The live board loaded 50 cards, exposes Resume/Cover, Customize documents,
Interview preparation and promotion controls, and reports the browser worker
ready. Its final view has 50 results per page and a seven-day posting/indexing
window, with no loading or job-read error. The pinned navigation has its own
scroll container: 741-pixel viewport, 1,012-pixel content and overflow-y auto.
Both PDF downloads match the current owner files exactly:

- Resume: 62,243 bytes, two pages, SHA-256 `a54024849b3ae5c80c09b15c715797fe91f6c3f6af40c04fb352fc937b38df60`.
- Cover: 30,332 bytes, one page, SHA-256 `3fc6941e3cf799a39a65bc3a8b844ab3143c8470580ef5fec71e147e0e287a11`.

The browser's cover download first lacked an origin context. Retrying through the
actual board in an established authenticated app tab passed its download gate.
No credential extraction or indirect download bypass was used.

The installed Find request used temporary 50-mile criteria and returned real
local openings with distances and employer URLs. It labeled them unscored and
called out unverified requirements. Its broad combined role query returned
nothing, then a developer query succeeded; it did not cover the other requested
role categories. Multi-category search behavior and recency defaults still need
improvement. The unchanged saved area remains 70 miles with remote jobs included.

Current private evidence:
`/tmp/career-1431-installed-acceptance.json`,
`/tmp/career-1431-model-score-proof.json`,
`/tmp/career-1431-activation.log`,
`/tmp/career-1431-live-routines.jpg`,
`/tmp/career-1431-live-jarvis.jpg`.
The delivery receipt is
`release-inputs/career-source-browser-daba1efd/delivery.json`.
Do not commit private acceptance records or owner data.

## Activation correction and regression guards

The initial cold start passed readyz but the portal reported missing assets:
the staged frontend manifest lives in `release/`, while its runtime is
`release/platform/`. The service's OSHAL_PLATFORM_DIR was corrected to that child
and the actual signed-in portal was verified. The native core and Career app
remained installed; unrelated application bytes were preserved. The current
service configuration hash is
`f1aa9e387b58e747f3fc44bf86f01c236f9ee8e49fa185a45132ccce53e8b743`.

`ops/activate_career_candidate.py` now checks that explicit runtime directory,
probes real portal HTML with a bounded read, refuses credential redirects and
keeps only the existing canonical app guard. Ten focused activation tests pass,
including nested roots, the real index's long leading change log, atomic rollback,
active pulls/submissions, unsettled scheduled invocations and other-app changes.
Evidence: `/tmp/career-1431-activation-guards-path-fix.log` and
`/tmp/career-1431-systemd-verify.log`. Operator source is `b0cdf166`; this changes
release tooling only, so the running native binary remains `7bd745b7`.

## Focused component cohorts

These cohorts have different scope and overlap; do not add their counts:

- Source reader: 16 Node checks, including eight Python adapter/SQLite cases;
  seven actual native ingestion/bundle checks with zero skips. Dedicated
  anonymous Node 24 / Playwright 1.59.1, immutable mounts, page-three pagination,
  delayed JSON/JSON-LD, form refusal and hung-descendant cleanup are covered.
- Live model settings: 30 synthetic-provider native checks across settings,
  attribution/failover, actual package execution and retained authority. Old
  policy guards spend nothing. Provider transports, inline defaults and caller
  payment boundaries remain intact.
- Managed Settings: 19 Node/browser checks, including narrow-screen native/unknown
  capability states and score/stop/reload behavior. The final configuration case
  was rerun after its last source change. All 54 Test Lab recipes validate.
- Native API admission: all 25 tools pass against the final 1.43.1 manifest.

The real public Amway source smoke used only an isolated test corpus and the
installed native browser bundle. It returned zero postings/empty_unconfirmed.
It proves neither successful generic import nor that the employer has no jobs.
The live corpus and applicant data were untouched by that smoke.

## Historical scoring and data-quality findings at 1.43.1

This earlier audit found the following issues. The 1.44.0 and 1.45.x sections
above record subsequent corrections and their acceptance; this is not a current
open-issue list.

1. Historical AI assessments omit dates/currentness, and keyword fallback can
   look like AI fit. Expose provenance instead of presenting all scores alike.
2. Manual fresh scoring uses a generic keyword/target-role gate, unlike explicit
   nightly saved-title scoring, and can miss requested adjunct or support roles.
3. P(land) is an uncalibrated ranking, not a hiring probability; referral can make
   it 100. High-Win rewards clearance/defense terms without proving qualification,
   and substring ai also matches retail. Correct framing and bounded evidence.
4. Legacy remote flags treat hybrid, negated remote and remote sensing as fully
   remote, bypassing the radius. Code commit `97c82659` corrects ingestion and
   saved-radius/remote-only reads, retains explicit evidence and fixes mobile
   AI=0 display. It is tested but not installed. Ambiguous legacy rows need
   independent workplace evidence or a normal source refresh; no live rewrite.
5. Employer salary parsing splits decimal-K tokens: Hinge's raw $157.4K–$217.8K
   became 4000–8000. Explicit CA$ can also become USD, and missing periods are
   silently annualized. A narrow parser/filter/renderer fix is underway; already
   published wrong values require a controlled refresh/repair after that fix.
6. setSortOptions and loadWorkers disable their select elements without enabling
   them again. Fix both and verify real interaction.

The pending remote/mobile cohort has 17 passing Node checks, including eight
Python cases using 28 shared evidence fixtures; generated JS parity passes.
The materialized normalization is per candidate, not a full-corpus CTE, but actual
published-corpus plans and portable PostgreSQL execution remain unverified.
Six old board-surface and two old geo assertions fail identically on untouched
HEAD; they are recorded in `/tmp/career-board-baseline.log` and
`/tmp/career-geo-baseline.log`, not counted as passing checks.

See [historical evidence](docs/delivery-evidence-through-1430.md) for earlier
component proofs and their original limits, and [NATIVE-SUBMISSION.md](NATIVE-SUBMISSION.md)
for the approved browser worker and exact-packet execution contract.
