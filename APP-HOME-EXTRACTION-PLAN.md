# App Home extraction ledger

Status: implementation plan; source assessment snapshot, 2026-09-09. All boxes remain visible by default. Earlier suggestions to automatically hide quiet apps are superseded by the user?s configurable, default-on direction.

Catalog coverage: **51 entries**, generated from `marketplace.json`. Each entry below has a source seam and extraction decision; none is marked live-verified merely because a route exists.

Framework decisions and acceptance: [configurable Home plan](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/configurable-app-home-plan.md).

## Common implementation recipe

For every extracting package: add a package-owned session-authenticated GET summary route; read existing caller-authorized records; return a compatibility `tiles` array, stable-id `metrics` catalog, and bounded `items`. Declare the pointers in the manifest. Add metadata timestamps and explicit unavailable/empty states. Reuse query/access helpers, not route handlers that may backfill, refresh tokens, call providers, or dispatch work.

Before writing each query, inspect its actual schema fields and lifecycle transitions; record metric id, definition, period, denominator, owner scope, freshness, and detail surface in the package. Where the listed source is a route, it identifies the implementation seam, not permission to call it on every Home load. No unavailable data becomes zero.

Done for each extractor means: caller isolation and source query verified, repeated GETs are side-effect free, partial failures remain visible, live/mock distinction retained, valid same-app detail action, package/catalog version parity, and an authenticated browser acceptance record. A source-only assessment remains ?planned? until these checks pass.

Connection requirements below describe capabilities needed for selected work. They are not an all-of connector checklist. A saved connection is not proof of live liveness.

## Per-package work orders

### Slice 2a implementation specification (2026-09-09)

Implement three independent, session-only, database-read summary routes before expanding provider coverage:

| Package | Stable metrics and exact source | Scope, freshness and detail |
|---|---|---|
| Feeds | `indexed-24h`, `indexed-5d`: Slack rows by `posted_at` in the preceding 24/120 hours, excluding future rows; `indexed-channels`: distinct channels in the index; `sync-age`: `feed_settings.last_synced_at` | Explicit `user_sub`; indexed counts are not unread counts or a complete Slack history. No settings row means no recorded sync. Open `feeds-dashboard`. |
| Email Summarizer | `cached-digest`: decryptable, nonempty saved digest; `digest-age`: saved digest's `updated_at`; bounded cached excerpt | Explicit `user_sub` in `oshal_email_digests`; generation time is not inbox freshness. Missing table/key/corrupt ciphertext is unavailable, not an empty inbox. Open `email-myday`. |
| Switchboard | `posts-in-review`, `posts-scheduled`, `posts-overdue`, `posts-failed`: current Streams states; `replies-pending`, `replies-failed`, `replies-uncertain`: current confirmed reply-outbox states | Explicit `user_sub`, all of the caller's workspaces; overdue means scheduled timestamp <= snapshot time. Pending includes sending, never sent. Read no message bodies or credentials. Open `switchboard-streams` or `switchboard-threads`. |

Each source failure remains visible alongside successful sources. All metrics default on. GET neither creates schemas nor imports/backfills, renews tokens, generates a digest, or sends. Verify compiled routes with two owners, read-only PostgreSQL permissions, missing sources, empty data, time boundaries and repeated requests. No live deployment is claimed before the core review and deployment complete. Slice 2b remains the separately assessed cached priority/social coverage and cross-app event deduplication.

### hello-oshal

- **Purpose:** hello-oshal — author example.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** No business status; optionally demonstrate the contract for developers.
- **Requirements:** None for example route.
- **Manifest:** [package definition](hello-oshal/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** No independent business ledger. Keep the box as an editable launcher with an honest no-metrics state. Do not add fake activity counts; optional recent core tasks remain a fallback.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### little-monsters

- **Purpose:** little-monsters — learning.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Work due, review backlog, learning progress, new teacher material.
- **Requirements:** Learner profile and approved class content; optional voice services.
- **Manifest:** [package definition](little-monsters/oshal-app.yaml).
- **Source seams:** [education-access.ts](little-monsters/src-routes/education-access.ts) ? records: `lm_tenants`, `lm_students`, `lm_classes`, `lm_enrollments`; [education-assignment-routes.ts](little-monsters/src-routes/education-assignment-routes.ts) ? records: `lm_assignments`, `lm_enrollments`, `lm_classes` ? reads: `/assignments`; [education-calendar-event-routes.ts](little-monsters/src-routes/education-calendar-event-routes.ts) ? records: `lm_calendar_events`, `lm_enrollments`, `lm_classes`, `lm_assignments` ? reads: `/calendar`; [education-catalog-routes.ts](little-monsters/src-routes/education-catalog-routes.ts) ? records: `lm_classes`, `lm_enrollments`, `lm_students` ? reads: `/catalog`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### brand-graphics

- **Purpose:** brand-graphics — branded video.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Output ready, render blocked, review requested.
- **Requirements:** Vids worker, signed-in browser, brief and brand assets.
- **Manifest:** [package definition](brand-graphics/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Workflow-only ownership requires tracing the manifest ticket type and worker completion/artifact records. Add a session-readable route before summary declaration; a service-only smoke route is not suitable. Fallback task titles alone are not reliable domain metrics.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### lora

- **Purpose:** lora — character training.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Training state, latest evaluated version, failed evaluations.
- **Requirements:** GPU worker, training images/captions, evaluation results.
- **Manifest:** [package definition](lora/oshal-app.yaml).
- **Source seams:** [bot-lora-routes.ts](lora/src-routes/bot-lora-routes.ts) ? records: `oshal_lora_characters`, `oshal_lora_models`, `oshal_lora_scores` ? reads: `/ui`, `/characters`, `/models`, `/scorecard`, `/`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### youtube-kids

- **Purpose:** youtube-kids — viewing-history brief.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** New imported-history report, report age, changed interests.
- **Requirements:** User-supplied Takeout history; no live YouTube connection implied.
- **Manifest:** [package definition](youtube-kids/oshal-app.yaml).
- **Source seams:** [youtube-kids-routes.ts](youtube-kids/src-routes/youtube-kids-routes.ts) ? records: `oshal_youtube_activity` ? reads: `/`, `/upload`, `/status`, `/brief`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### payments

- **Purpose:** payments — charges and invoices.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** Confirmed receipts, outstanding invoices, failed attempts.
- **Requirements:** Chosen Square/PayPal account; sandbox/live clearly separated.
- **Manifest:** [package definition](payments/oshal-app.yaml).
- **Source seams:** [payments-routes.ts](payments/src-routes/payments-routes.ts) ? records: `oshal_merchant_payments` ? reads: `/`, `/ui`, `/providers`, `/charge/:provider/:chargeId`, `/history`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### finance

- **Purpose:** finance — account overview.
- **Slice / state:** 5 / source assessed; extraction planned.
- **Candidate data points:** Net worth as of last sync, spending, stale accounts.
- **Requirements:** Plaid-linked accounts and current aggregation data.
- **Manifest:** [package definition](finance/oshal-app.yaml).
- **Source seams:** [finance-routes.ts](finance/src-routes/finance-routes.ts) ? records: `oshal_finance_items`, `oshal_finance_data`, `oshal_finance_payments` ? reads: `/`, `/ui`, `/status`, `/summary`, `/brief`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### movies

- **Purpose:** movies — viewing concierge.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Optional saved-watchlist change; no permanent activity counter.
- **Requirements:** TMDB search capability; user watchlist if persisted.
- **Manifest:** [package definition](movies/oshal-app.yaml).
- **Source seams:** [movies-routes.ts](movies/src-routes/movies-routes.ts) ? records: `movies_profile`, `movies_watchlist`, `movies_conversations`, `movies_messages`, `movies_feedback` ? reads: `/app`, `/chat`, `/config`, `/trending`, `/search`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### spotify

- **Purpose:** spotify — music concierge.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Optional current playback or saved playlist; no daily KPI.
- **Requirements:** User Spotify account.
- **Manifest:** [package definition](spotify/oshal-app.yaml).
- **Source seams:** [spotify-routes.ts](spotify/src-routes/spotify-routes.ts) ? records: `spotify_profile`, `spotify_conversations`, `spotify_messages`, `spotify_feedback` ? reads: `/app`, `/chat`, `/config`, `/search`, `/now-playing`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### rides

- **Purpose:** rides — ride handoff.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Prepared trip when relevant.
- **Requirements:** Pickup/destination and handoff; no confirmed ride status without evidence.
- **Manifest:** [package definition](rides/oshal-app.yaml).
- **Source seams:** [rides-routes.ts](rides/src-routes/rides-routes.ts) ? records: `rides_profile`, `rides_requests`, `rides_conversations`, `rides_messages`, `oshal_connections` ? reads: `/app`, `/chat`, `/config`, `/geocode`, `/reverse`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### eats

- **Purpose:** eats — food handoff.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Prepared cart when relevant.
- **Requirements:** Restaurant/cart inputs and checkout handoff; no delivery tracking assumed.
- **Manifest:** [package definition](eats/oshal-app.yaml).
- **Source seams:** [eats-routes.ts](eats/src-routes/eats-routes.ts) ? records: `eats_profile`, `eats_carts`, `eats_cart_items`, `eats_orders`, `eats_conversations` ? reads: `/app`, `/chat`, `/config`, `/search`, `/menu`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### purchasing

- **Purpose:** purchasing — shopping.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Lists needing a decision, cart ready, relevant saved deal.
- **Requirements:** Walmart/search capability, saved lists and preferences.
- **Manifest:** [package definition](purchasing/oshal-app.yaml).
- **Source seams:** [purchasing-routes.ts](purchasing/src-routes/purchasing-routes.ts) ? records: `shop_preferences`, `shop_feedback`, `shop_lists`, `shop_list_items`, `shop_purchase_history` ? reads: `/dashboard`, `/chat`, `/purchasing.css`, `/config`, `/search`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### career-hunter

- **Purpose:** career-hunter — job search.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** New strong matches, approval queue, application follow-ups.
- **Requirements:** Career profile, ATS ingestion; optional portrait/materials.
- **Manifest:** [package definition](career-hunter/oshal-app.yaml).
- **Source seams:** [career-application-routes.ts](career-hunter/src-routes/career-application-routes.ts) ? records: `career_hunter_applications`, `user_signals` ? reads: `/applications`; [career-artifacts.ts](career-hunter/src-routes/career-artifacts.ts) ? reads: `/artifacts`; [career-autofill-routes.ts](career-hunter/src-routes/career-autofill-routes.ts) ? reads: `/autofill/bookmarklet`; [career-automation.ts](career-hunter/src-routes/career-automation.ts) ? records: `career_automation_settings` ? reads: `/automation/state`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### presentations

- **Purpose:** presentations — document creation.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Finished artifacts, failed generation, unfinished requested work.
- **Requirements:** Outline/assets and chosen storage target; cloud targets optional.
- **Manifest:** [package definition](presentations/oshal-app.yaml).
- **Source seams:** [bot-presentation-routes.ts](presentations/src-routes/bot-presentation-routes.ts) ? records: `oshal_presentations` ? reads: `/ui`, `/themes`, `/destination`, `/list`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### storage

- **Purpose:** storage — file destinations.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Failed saves, selected target unavailable, recent requested export.
- **Requirements:** Local target or chosen cloud account; not every supported provider.
- **Manifest:** [package definition](storage/oshal-app.yaml).
- **Source seams:** [storage-routes.ts](storage/src-routes/storage-routes.ts) ? records: `oshal_connections` ? reads: `/`, `/assistant/ui`, `/prefs`, `/dropbox/folders`, `/github/repos`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### portrait-studio

- **Purpose:** portrait-studio — images.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Requested portraits ready, failed generation, needed profile image.
- **Requirements:** Source photo and generation service; mailbox only for email export.
- **Manifest:** [package definition](portrait-studio/oshal-app.yaml).
- **Source seams:** [portrait-studio-routes.ts](portrait-studio/src-routes/portrait-studio-routes.ts) ? records: `ps_portraits` ? reads: `/app`, `/capture.js`, `/catalog`, `/provider`, `/portraits`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### home

- **Purpose:** home — household devices.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Meaningful device exceptions, failed routines, last observed state.
- **Requirements:** Configured SmartThings/Google Home hubs and selected devices.
- **Manifest:** [package definition](home/oshal-app.yaml).
- **Source seams:** [home-routes.ts](home/src-routes/home-routes.ts) ? reads: `/ui`, `/devices`, `/scenes`, `/schedules`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### social

- **Purpose:** social — publishing and signals.
- **Slice / state:** 2 / source assessed; extraction planned.
- **Candidate data points:** Drafts awaiting review, scheduled posts, sourced social signals.
- **Requirements:** Chosen social accounts; mailbox for email-derived signals.
- **Manifest:** [package definition](social/oshal-app.yaml).
- **Source seams:** [social-routes.ts](social/src-routes/social-routes.ts) ? records: `oshal_connections`, `oshal_inbox_messages` ? reads: `/composer`, `/facebook`, `/workspace`, `/signals/ui`, `/profiles`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### job-apply

- **Purpose:** job-apply — submission queue.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** Approved applications queued, submitted with evidence, blocked.
- **Requirements:** Career Hunter, approved packet, available desktop browser worker.
- **Manifest:** [package definition](job-apply/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Workflow-only ownership requires tracing the manifest ticket type and worker completion/artifact records. Add a session-readable route before summary declaration; a service-only smoke route is not suitable. Fallback task titles alone are not reliable domain metrics.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### feeds

- **Purpose:** feeds — message stream.
- **Slice / state:** 2a / deployed; authenticated live Home rendering verified 2026-09-10 UTC.
- **Candidate data points:** New entries, configured channels, ingestion freshness.
- **Requirements:** Slack connection and selected feed settings.
- **Manifest:** [package definition](feeds/oshal-app.yaml).
- **Source seams:** [feeds-routes.ts](feeds/src-routes/feeds-routes.ts) ? records: `feed_messages` ? reads: `/status`, `/messages`, `/settings`.
- **Extraction work / gap:** Extract from indexed feed_messages and existing saved feed settings. Inspect last-sync fields. Existing /messages may backfill and /status may refresh a token; neither is the summary implementation.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### cloud

- **Purpose:** cloud — cloud operations.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Requested job outcome, resource issue with evidence.
- **Requirements:** GCP account, project access; no invented monitoring feed.
- **Manifest:** [package definition](cloud/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Workflow-only ownership requires tracing the manifest ticket type and worker completion/artifact records. Add a session-readable route before summary declaration; a service-only smoke route is not suitable. Fallback task titles alone are not reliable domain metrics.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### identity

- **Purpose:** identity — connection health.
- **Slice / state:** 1 / deployed (1.1.0); authenticated live Home rendering verified 2026-09-10 UTC.
- **Candidate data points:** Reconnect needs, genuine expiry deadlines, blocked selected workflows.
- **Requirements:** Safe accessible connection metadata and task requirements.
- **Manifest:** [package definition](identity/oshal-app.yaml).
- **Source seams:** [identity-routes.ts](identity/src-routes/identity-routes.ts) ? reads: `/`, `/ui`, `/advice`.
- **Extraction work / gap:** Implemented `identity-summary.ts`. Uses accessibleConnections and canonical isConnectionExpired. Count saved accounts, genuine reconnects, nonrenewable expiry within seven days, and shared accounts. No inference of provider liveness or missing-workflow requirements from this metadata.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### travel

- **Purpose:** travel — planning and watches.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Active fare-watch changes, relevant trip information.
- **Requirements:** Duffel/search capability, saved watches; booking confirmation only if known.
- **Manifest:** [package definition](travel/oshal-app.yaml).
- **Source seams:** [travel-routes.ts](travel/src-routes/travel-routes.ts) ? records: `travel_profile`, `travel_searches`, `travel_watches`, `travel_conversations`, `travel_messages` ? reads: `/app`, `/chat`, `/config`, `/flights`, `/hotels`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### camera

- **Purpose:** camera — remote capture.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Requested capture ready, active device unavailable.
- **Requirements:** Registered camera node; hardware permissions.
- **Manifest:** [package definition](camera/oshal-app.yaml).
- **Source seams:** [camera-routes.ts](camera/src-routes/camera-routes.ts) ? records: `camera_command_log` ? reads: `/app`, `/fleet`, `/state`, `/events`, `/captures`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### drone

- **Purpose:** drone — mission control.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Approval waiting, mission state, telemetry exception.
- **Requirements:** Registered node, mission and geofence; distinguish simulation/hardware.
- **Manifest:** [package definition](drone/oshal-app.yaml).
- **Source seams:** [drone-routes.ts](drone/src-routes/drone-routes.ts) ? records: `drone_missions`, `drone_command_log`, `drone_conversations`, `drone_messages` ? reads: `/app`, `/state`, `/events`, `/config`, `/fleet`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### spaces

- **Purpose:** spaces — scene reconstruction.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Reconstruction running/ready/failed, next capture step.
- **Requirements:** Capture upload or paired device and reconstruction worker.
- **Manifest:** [package definition](spaces/oshal-app.yaml).
- **Source seams:** [spaces-routes.ts](spaces/src-routes/spaces-routes.ts) ? reads: `/app`, `/viewer`, `/scans`, `/scans/:id`, `/scans/:id/artifact`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### sat-ops

- **Purpose:** sat-ops — orbital simulation.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Simulated conjunction alert, pass window, command awaiting approval.
- **Requirements:** Simulation fleet/engine; never describe simulated telemetry as live spacecraft.
- **Manifest:** [package definition](sat-ops/oshal-app.yaml).
- **Source seams:** [sat-routes.ts](sat-ops/src-routes/sat-routes.ts) ? reads: `/app`, `/fleet`, `/catalog`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### pumpkin

- **Purpose:** pumpkin — interactive prop.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Optional active-session connectivity.
- **Requirements:** Browser demo or paired devices for signed-in operation.
- **Manifest:** [package definition](pumpkin/oshal-app.yaml).
- **Source seams:** [pumpkin-engine-preset-service.ts](pumpkin/src-routes/pumpkin-engine-preset-service.ts) ? records: `pumpkin_presets`, `pumpkin_settings`; [pumpkin-engine-response-store.ts](pumpkin/src-routes/pumpkin-engine-response-store.ts) ? records: `pumpkin_responses`; [pumpkin-routes.ts](pumpkin/src-routes/pumpkin-routes.ts) ? reads: `/app`, `/remote`, `/presets`, `/presets/:name`, `/settings`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### creative-studio

- **Purpose:** creative-studio — continuous videos.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Episodes completed, blocked worker, outputs to review.
- **Requirements:** Vids worker/browser, enabled series, output storage.
- **Manifest:** [package definition](creative-studio/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Workflow-only ownership requires tracing the manifest ticket type and worker completion/artifact records. Add a session-readable route before summary declaration; a service-only smoke route is not suitable. Fallback task titles alone are not reliable domain metrics.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### daily-trade-recap

- **Purpose:** daily-trade-recap — recap production.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Recap ready, generation failed, publication awaiting approval.
- **Requirements:** Trading data and render/email capabilities; financial totals owned by trading.
- **Manifest:** [package definition](daily-trade-recap/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Workflow-only ownership requires tracing the manifest ticket type and worker completion/artifact records. Add a session-readable route before summary declaration; a service-only smoke route is not suitable. Fallback task titles alone are not reliable domain metrics.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### video

- **Purpose:** video — prompted/series production.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Script approval, episode progress, rendered output.
- **Requirements:** Configured generation/voice/render services and storage.
- **Manifest:** [package definition](video/oshal-app.yaml).
- **Source seams:** [video-pump-routes.ts](video/src-routes/video-pump-routes.ts) ? records: `video_pump_shows`, `video_pump_runs` ? reads: `/shows`, `/status`; [video-routes.ts](video/src-routes/video-routes.ts) ? records: `oshal_videos`, `video_series`, `video_episodes` ? reads: `/ui`, `/series`, `/list`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### vids

- **Purpose:** vids — desktop video production.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Queue progress, completed clips, browser worker blocked.
- **Requirements:** Registered worker with signed-in Google Vids browser.
- **Manifest:** [package definition](vids/oshal-app.yaml).
- **Source seams:** [vids-public-routes.ts](vids/src-routes/vids-public-routes.ts) ? reads: `/:slug/:file`; [vids-routes.ts](vids/src-routes/vids-routes.ts) ? records: `vids_jobs` ? reads: `/jobs`, `/app`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### email-summarizer

- **Purpose:** email-summarizer — Intelligent Communication.
- **Slice / state:** 2a / deployed; authenticated live Home rendering verified 2026-09-10 UTC.
- **Candidate data points:** Saved inbox/day digest, priority mail, meetings, draft approvals.
- **Requirements:** Selected mailbox/calendar; optional channels only when used.
- **Manifest:** [package definition](email-summarizer/oshal-app.yaml).
- **Source seams:** [email-app-routes.ts](email-summarizer/src-routes/email-app-routes.ts) ? records: `oshal_email_digests` ? reads: `/inbox`, `/my-day`, `/messages`, `/message/:id`, `/digest`.
- **Extraction work / gap:** Read and decrypt the stored digest through the established helper. Never call summary generation on GET. Priority counts need structured stored metadata; do not parse prose to invent counts.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### kalshi

- **Purpose:** kalshi — event-contract analysis.
- **Slice / state:** 5 / source assessed; extraction planned.
- **Candidate data points:** Open exposure, settled results, calibration/risk flags.
- **Requirements:** Market tape; account needed for account metrics; demo/live distinguished.
- **Manifest:** [package definition](kalshi/oshal-app.yaml).
- **Source seams:** [kalshi-routes.ts](kalshi/src-routes/kalshi-routes.ts) ? records: `kalshi_orders` ? reads: `/`, `/ui`, `/scan`, `/settings`, `/alerts`; [kalshi-scan-engine.ts](kalshi/src-routes/kalshi-scan-engine.ts) ? records: `kalshi_scan_snapshots`, `kalshi_scan_settings`, `kalshi_scan_alerts`, `swarm_applications`, `kalshi_predictions`; [kalshi-trends.ts](kalshi/src-routes/kalshi-trends.ts) ? records: `kalshi_predictions`, `kalshi_orders`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### intelligent-trades

- **Purpose:** intelligent-trades (`trading/`) — trading.
- **Slice / state:** 5 / source assessed; extraction planned.
- **Candidate data points:** Positions, realized/unrealized results separately, pending decisions, risk exceptions.
- **Requirements:** Selected broker/account and market data; paper/live separate.
- **Manifest:** [package definition](trading/oshal-app.yaml).
- **Source seams:** [trading-accounts-routes.ts](trading/src-routes/trading-accounts-routes.ts) ? records: `oshal_connections`, `oshal_trading_books`, `trading_config_overrides`, `oshal_trading_accounts` ? reads: `/accounts`, `/summary`; [trading-autopilot-routes.ts](trading/src-routes/trading-autopilot-routes.ts) ? reads: `/`; [trading-charts-routes.ts](trading/src-routes/trading-charts-routes.ts) ? reads: `/vendor/lightweight-charts.js`, `/bars`; [trading-event-plan-routes.ts](trading/src-routes/trading-event-plan-routes.ts) ? reads: `/events/plans`, `/events/plans/:id`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### world

- **Purpose:** world — news intelligence.
- **Slice / state:** 5 / World 1.1.1 deployed; authenticated live Home briefing and Venture draft action verified 2026-09-10 UTC.
- **Candidate data points:** New relevant stories/entities, changed themes, collection freshness.
- **Requirements:** Configured news sources and topic interests; distinguish from Slack Feeds.
- **Manifest:** [package definition](world/oshal-app.yaml).
- **Source seams:** [home-summary.ts](world/src-routes/home-summary.ts) uses the existing engine's read-only coverage snapshot over `world_pulls`, bounded baseline-topic `world_items` candidates, and `world_events`.
- **Extraction work / gap:** Shipped: rolling 24-hour collection metrics, three-topic recent-publication sample, recorded upcoming event and optional sourced Venture draft. Personalized topic selection, semantic event deduplication and changed-theme analysis remain planned. The sample is not a global importance ranking.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### dnd

- **Purpose:** dnd — role-playing game.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Resume session or your turn, if user opts in.
- **Requirements:** Saved campaign/room; configured narration capabilities.
- **Manifest:** [package definition](dnd/oshal-app.yaml).
- **Source seams:** [dnd-routes.js](dnd/routes/dnd-routes.js) ? records: `dnd_archive`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### game-show

- **Purpose:** game-show — game night.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Resume room or pending turn, if desired.
- **Requirements:** Room/session; configured voice/AI capabilities as used.
- **Manifest:** [package definition](game-show/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### games

- **Purpose:** games — game launcher.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** No independent metric.
- **Requirements:** Installed game apps.
- **Manifest:** [package definition](games/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** No independent business ledger. Keep the box as an editable launcher with an honest no-metrics state. Do not add fake activity counts; optional recent core tasks remain a fallback.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### bake-off

- **Purpose:** bake-off — AI lane comparison.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Comparison finished, quality-qualified winner, measured cost difference.
- **Requirements:** Available lanes, task/rubric and benchmark results; estimates labeled.
- **Manifest:** [package definition](bake-off/oshal-app.yaml).
- **Source seams:** [bake-off-routes.ts](bake-off/src-routes/bake-off-routes.ts) ? reads: `/lanes`, `/jobs`, `/jobs/:id/report`, `/jobs/:id/runs`, `/runs/:runId/output/:agentId`; [bake-off-store.ts](bake-off/src-routes/bake-off-store.ts) ? records: `bake_off_jobs`, `bake_off_runs`, `bake_off_results`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### life

- **Purpose:** life — lifestyle launcher.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** No independent metric.
- **Requirements:** Installed member apps; no additional connection.
- **Manifest:** [package definition](life/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** No independent business ledger. Keep the box as an editable launcher with an honest no-metrics state. Do not add fake activity counts; optional recent core tasks remain a fallback.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### switchboard

- **Purpose:** switchboard — communications desk.
- **Slice / state:** 2a / deployed; authenticated live Home rendering verified 2026-09-10 UTC.
- **Candidate data points:** Priority conversations, approvals, upcoming commitments, blocked outbound work.
- **Requirements:** Selected mailbox/social/message accounts and workspace selection.
- **Manifest:** [package definition](switchboard/oshal-app.yaml).
- **Source seams:** [switchboard-calendar-routes.ts](switchboard/src-routes/switchboard-calendar-routes.ts) ? records: `oshal_switchboard_workspaces`, `oshal_switchboard_scheduled_posts` ? reads: `/posts`, `/`; [switchboard-compose-routes.ts](switchboard/src-routes/switchboard-compose-routes.ts) ? records: `oshal_switchboard_workspace_accounts`, `oshal_connections` ? reads: `/`, `/targets`; [switchboard-inbox-routes.ts](switchboard/src-routes/switchboard-inbox-routes.ts) ? records: `oshal_switchboard_workspace_accounts`, `oshal_inbox_messages` ? reads: `/`, `/items`; [switchboard-reply-outbox-routes.ts](switchboard/src-routes/switchboard-reply-outbox-routes.ts) ? records: `oshal_switchboard_reply_outbox`, `oshal_inbox_messages`, `oshal_switchboard_workspace_accounts` ? reads: `/outbox`, `/outbox/:id`.
- **Extraction work / gap:** Separate cached inbox/outbox/scheduled state from provider fetches. Preserve workspace/account visibility; define stable origin ids before cross-app deduplication.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### intelligent-career

- **Purpose:** intelligent-career — career group.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** Career outcomes and actionable member setup; avoid counting support assets as job outcomes.
- **Requirements:** Its member apps' readiness and summaries.
- **Manifest:** [package definition](intelligent-career/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** Group aggregates its members. Do not duplicate SQL in the group. job-apply is not currently among its declared members; assess grouping explicitly before adding submission outcomes.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### system

- **Purpose:** system — infrastructure launcher.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** No independent metric; underlying Identity/Storage/Cloud own facts.
- **Requirements:** Installed member apps.
- **Manifest:** [package definition](system/oshal-app.yaml).
- **Source seam:** manifest-declared workflow/surfaces. No package-local query seam was found in the top-level route scan; resolve the owning engine before extraction.
- **Extraction work / gap:** No independent business ledger. Keep the box as an editable launcher with an honest no-metrics state. Do not add fake activity counts; optional recent core tasks remain a fallback.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### payroll

- **Purpose:** payroll — payroll preparation.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** Run awaiting approval, reconciliation exceptions, next configured deadline.
- **Requirements:** Company/employee records and bank return files; generated file is not payment/file submission.
- **Manifest:** [package definition](payroll/oshal-app.yaml).
- **Source seams:** [payroll-forms.ts](payroll/src-routes/payroll-forms.ts) ? records: `payroll_run_lines`; [payroll-ledger.ts](payroll/src-routes/payroll-ledger.ts) ? records: `payroll_audit`, `payroll_line_earnings`, `payroll_deduction_elections`, `payroll_line_deductions`, `payroll_run_lines`; [payroll-reports.ts](payroll/src-routes/payroll-reports.ts) ? records: `payroll_runs`, `payroll_run_lines`, `payroll_line_deductions`; [payroll-routes-settle.ts](payroll/src-routes/payroll-routes-settle.ts) ? records: `payroll_payments`, `payroll_ach_events`, `payroll_bank_accounts`, `payroll_filings`, `payroll_run_lines` ? reads: `/runs/:id/settlement`, `/calendar/holidays`, `/calendar/pay-date`, `/forms/rt6`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### venture-plan

- **Purpose:** venture-plan — venture planning.
- **Slice / state:** 6 / summary extraction planned; research-brief v1 receiver deployed in 1.1.0 and live Home handoff verified.
- **Candidate data points:** Plan ready, unresolved material assumptions, next validation task.
- **Requirements:** Saved project inputs, evidence/quotes, generated calculations.
- **Manifest:** [package definition](venture-plan/oshal-app.yaml).
- **Source seams:** [venture-routes-docs.ts](venture-plan/src-routes/venture-routes-docs.ts) ? reads: `/ventures/:id/documents`, `/ventures/:id/documents/:docKey`, `/ventures/:id/documents/:docKey/history`, `/ventures/:id/documents/:docKey/print`, `/ventures/:id/export/plan.docx`; [venture-routes.ts](venture-plan/src-routes/venture-routes.ts) ? reads: `/`, `/app`, `/ventures`, `/ventures/:id`, `/ventures/:id/runs`; [venture-schema.ts](venture-plan/src-routes/venture-schema.ts) ? records: `venture_ventures`, `venture_assumptions`, `venture_scenarios`, `venture_runs`, `venture_vendors`; [venture-store-fx.ts](venture-plan/src-routes/venture-store-fx.ts) ? records: `venture_fx_assumptions`, `venture_ventures`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### ocean-lab

- **Purpose:** ocean-lab — energy design calculator.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Current design result in the tool; no permanent “energy generated” metric.
- **Requirements:** Illustrative parameters and local deterministic engine.
- **Manifest:** [package definition](ocean-lab/oshal-app.yaml).
- **Source seams:** [harvest-routes.ts](ocean-lab/src-routes/harvest-routes.ts) ? reads: `/assets/harvest-console.js`, `/sites`; [ocean-lab-routes.ts](ocean-lab/src-routes/ocean-lab-routes.ts) ? reads: `/app`, `/harvest-console`, `/blade-studio`, `/capabilities`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### marketing-engine

- **Purpose:** marketing-engine — acquisition process.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** Leads/conversions, campaign changes, review decisions, measured spend.
- **Requirements:** Campaign configuration and metrics ingestion; chosen publishing channels/consent.
- **Manifest:** [package definition](marketing-engine/oshal-app.yaml).
- **Source seams:** [marketing-ops-routes.ts](marketing-engine/src-routes/marketing-ops-routes.ts) ? records: `oshal_marketing_events`, `oshal_marketing_scorecard_weeks`, `oshal_marketing_run_ledger`, `oshal_marketing_campaigns`, `oshal_marketing_channel_authorizations`; [marketing-routes.ts](marketing-engine/src-routes/marketing-routes.ts) ? records: `oshal_marketing_campaigns`, `oshal_marketing_channel_authorizations`, `oshal_marketing_content`, `oshal_marketing_experiments`, `oshal_marketing_budget_ledger` ? reads: `/`, `/overview`, `/utm`, `/channels`, `/content`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### aero-lab

- **Purpose:** aero-lab — aircraft design.
- **Slice / state:** 6 / source assessed; extraction planned.
- **Candidate data points:** Requested simulation complete or engine unavailable.
- **Requirements:** Python simulation engine and design parameters; predictions labeled.
- **Manifest:** [package definition](aero-lab/oshal-app.yaml).
- **Source seams:** [aero-lab-routes.ts](aero-lab/src-routes/aero-lab-routes.ts) ? reads: `/app`, `/geometry.js`, `/app.js`, `/capabilities`, `/export/:exportId/:file`.
- **Extraction work / gap:** Primarily interactive. Use only persisted caller-owned session/result state if it answers a useful question; otherwise retain an editable launcher. Do not trigger simulations/search/playback or infer completed external actions from handoffs.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### print-ingest

- **Purpose:** print-ingest — document intake.
- **Slice / state:** 4 / source assessed; extraction planned.
- **Candidate data points:** Unfiled documents, approval requests, ingestion failures.
- **Requirements:** Print subscription/intake and user-approved filing destination.
- **Manifest:** [package definition](print-ingest/oshal-app.yaml).
- **Source seams:** [print-ingest-routes.ts](print-ingest/src-routes/print-ingest-routes.ts) ? records: `print_intake_rule`, `print_intake` ? reads: `/readiness`, `/destinations`, `/documents`, `/app`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

### sports-edge

- **Purpose:** sports-edge — sports/fantasy advice.
- **Slice / state:** 5 / source assessed; extraction planned.
- **Candidate data points:** Next fixture, changed lineup advice, outcomes of prior recommendations.
- **Requirements:** Selected team; ESPN league access for fantasy; no wager or lineup execution claim.
- **Manifest:** [package definition](sports-edge/oshal-app.yaml).
- **Source seams:** [sports-fantasy-routes.ts](sports-edge/src-routes/sports-fantasy-routes.ts) ? reads: `/fantasy/status`, `/fantasy/lineup`, `/fantasy/record`; [sports-fantasy-store.ts](sports-edge/src-routes/sports-fantasy-store.ts) ? records: `sports_fantasy_leagues`, `sports_fantasy_projections`, `sports_fantasy_calls`; [sports-line-store.ts](sports-edge/src-routes/sports-line-store.ts) ? records: `sports_line_history`; [sports-refresh.ts](sports-edge/src-routes/sports-refresh.ts) ? records: `sports_followed_teams`, `sports_previews`.
- **Extraction work / gap:** Confirm source fields, caller scope and lifecycle transitions in the listed module before SQL. Separate saved results from live/provider-generating reads. Any metric without a persisted source stays explicitly unavailable until collection is separately implemented.
- **Acceptance:** common extractor criteria above, plus verify that the stated outcome is actually recorded (not merely requested, generated, modeled, or handed off).

## Completion ledger

| Slice | State | Evidence |
|---|---|---|
| 1 Identity | Deployed; live rendering verified | Compiled route plus real PostgreSQL access helper; Chromium hide/order/reset/reload/keyboard/mobile and failure checks in `identity/tests/home-summary.integration.cjs`. Mock authentication and seeded records; not live-account acceptance. |
| 2a Communications | Deployed; live rendering verified | Feeds, Email Summarizer and Switchboard; live evidence below. |
| 5 World + integration foundation | Deployed; live draft handoff verified | World 1.1.1 briefing; Venture 1.1.0 receiver; details in the integration ledger. |
| Remaining 2b and 3-6 work | Planned | Source seams above; no deployed-metric claims for other applications. |

The private Sales and unresolved Capability Ideation work orders live in the framework plan; private source details are not copied into this public-store document.

## Slice 1 release validation

Core and staged Identity TypeScript, Home unit tests, catalog parity and Identity manifest validation pass. The package audit remains truthfully pending with the updated version; no audit result was manufactured. Whole-store audit validation is blocked by existing other-package version/binding drift, reproduced from exported origin/main. Deploy the matching core plus migration 126 before installing Identity 1.1.0; older validators reject the new metricsPointer field. Production rollout subsequently completed; see the live verification record below.

## Execution record: communications slice 2a

Feeds 1.1.0, Email Summarizer 1.1.0 and Switchboard 0.5.0 now declare summary metrics. Together with Identity, four packages implement the configurable contract. Their package READMEs define stable ids, source lifecycle, exact time windows, owner scope and detail actions.

TypeScript, 12 compiled-route boundary tests, catalog/manifest validation and the real PostgreSQL/Chromium harness pass. The integration harness loads actual table definitions, enforces owner RLS under a non-superuser with SELECT-only source grants, checks two users/empty data/time windows/decryption failures and missing sources, and verifies default boxes and persisted metric hiding on desktop/mobile. Browser screenshots are local acceptance fixtures, not live account evidence.

Following explicit operator approval, core PR #411 and store PR #153 merged. The live rollout and browser verification are recorded below. Slice 2b retains cached priority/social coverage and semantic cross-app event deduplication.

## Live rollout verification (2026-09-10 UTC)

Core 7aa6f62f and migration 126 deployed through the sanctioned deployment script; all 35 app containers passed health/parity checks. Identity 1.1.0, Feeds 1.1.0, Email Summarizer 1.1.0 and Switchboard 0.5.0 were installed from this repository at c1817859 and hot-loaded through the normal app loader. All four summary endpoints returned 200 with no partial-source failures, and Home discovered all four metric catalogs. Chromium verified the actual authenticated cockpit rendering all four using existing account records. Temporary verification credentials were revoked. This is saved-data extraction/rendering evidence, not a claim of current provider liveness.

The configured public snapshot catalog contains older package versions; these installs explicitly selected this repository. Core #413 fixes private-store sparse/audited checkout losing the scoped Git authentication header during lazy blob fetches. The merged CLI was executed from an exported tool snapshot for these installs, preserving validation, audit mode and provenance.
