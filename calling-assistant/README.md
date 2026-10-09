# Calling Assistant

0.1.5 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

An optional application package: `calling_task` tool, `calling-operator` bot, Assisted Phone Task
workflow, configuration page and durable reports. Jarvis, other authorized bots and the application
page use the same tool/service. No calling implementation is compiled into the platform.

The platform supplies existing connection ownership, encrypted credentials, identity, named
permissions, voice providers, package tools and workflow execution. The only additional core
contract is `signed-package-callbacks`: an installed verifier authenticates the provider request,
then the platform resolves the durable owner afresh and enforces current named permissions.
The package's CORE-05 readiness route is service-authenticated, metadata-only and non-AI; it
does not enable calling, dial a number, query owner data or substitute for the live carrier receipt.

## Configure

Open `/cockpit?app=calling-assistant`, or `/api/calling-assistant/app`. Installation exposes the
configuration screen; outbound calling is disabled by default, regardless of connected accounts.
An application administrator can assign the `caller` role through the platform Access page.

1. Connect the intended Twilio account in Connections. Select that exact account in this app.
2. Load its voice-capable numbers and select the sender. Set the owner's handoff phone and the
   specific permitted destination numbers. No insurer number or customer information ships in code.
3. Set the externally reachable HTTPS origin. Outbound calls supply their callback URLs automatically;
   there is no need to repurpose the incoming-number webhook. The public tunnel must permit POSTs to
   `/api/calling-callbacks/run/*`; the signed callback authentication remains enforced there.
4. Select the existing speech provider, opening disclosure, listen window, duration/turn limits and
   estimated all-in rates. Save with calling disabled first. Test a WAV on the same page.
5. Enable calling and acknowledge the account use. Review the exact destination and approved replies
   before submitting a controlled test call. Inspect its report, then test handoff to your phone.

Personal and accessible shared connections are supported. Settings belong to the exact owner/issuer;
background tasks retain that owner. A shared connection does not give every swarm service permission
to use it. Deployment credentials are never an implicit fallback. Unattended service-principal
enrollment is a separate configuration/authorization feature and is not advertised by this release.

## Execution and evidence

The carrier receives short `<Record>` turns; the completed-recording callback downloads the actual
WAV using the selected connection and passes it through the existing voice provider. The service
interprets explicit menu choices and operator-approved replies, returns `<Play digits>` or `<Say>`,
and dials the configured phone after a recognized human greeting or a sensitive-information request.
The report records transcripts, decisions, source audio hashes, provider and actual carrier status.
Unknown/ambiguous speech and hold announcements wait. Local `no_speech_detected` is an ordinary wait.
This release is turn-based, with listening and processing delays; it is not a full-duplex conversation
engine or a promise to negotiate arbitrary claims. A greeting heuristic can miss unfamiliar humans.

Starts are durable and idempotent. A lost/ambiguous create response is `uncertain` and never redialed.
Only one active task per owner is allowed. Provider call duration plus callback checks bound the
session; transfer receives the remaining seconds. Pricing is an operator estimate, not a billing cap.
Cancel, connection revocation, disabled settings, limits and processing failures stop further actions.
After restart, persisted tasks remain inspectable; an interrupted audio turn times out instead of
repeating a side effect. Completed recordings are deleted after processing; cleanup failures are
reported for operator cleanup. Transcripts and metadata remain in owner-scoped application tables.

## Home summary (0.1.3)

The manifest declares an ADR-145 `summary:` at the caller's own `GET /api/calling-assistant/tasks`
(bound to `calling.read`, read-only). Besides `tasks`, the response carries `tiles` (Calling: Ready,
No connection or Off; Saved runs; Last outcome), `items` (the three newest runs as saved, then two
honesty notes) and `asOf`, so a shell such as the Business homebase can show a Calls card without any
package logic of its own. Ready means the saved configuration is enabled and its connection is still
one of the caller's own; nothing here dials or reads the carrier.

## Company audience view (0.1.4)

The Business shell opens the page with `?audience=company` (ADR-164 D6). The shared kit then paints a
"Calls" board from that same `GET /tasks` read alone: the three tiles as stats (Calling, Saved runs,
Last outcome), the newest runs as a table (started, status, outcome as saved), the two honesty notes,
one action that opens the full page in the frame, and the escape to the cockpit. `/config` is never
read there (it probes the speech provider registry), nothing is written, and `ui/client.js` stops
before its first read while a view is active. Any other request, and any page without the kit, runs
the full Calling Assistant page unchanged. Signed out (401) and not permitted (403) are named as such.

## Tests

- `node --test calling-assistant/tests/policy.test.cjs`: deterministic configuration/interpretation,
  signature binding and outbound TwiML contracts.
- `node --test calling-assistant/tests/summary.test.cjs`: the home-summary shape (readiness, newest
  runs, honesty notes, malformed input).
- With core dependencies on `NODE_PATH` and `CALLING_TEST_DATABASE_URL` pointing at a database where
  disposable schemas may be created: `node --test calling-assistant/tests/integration.test.cjs`.
  It creates and deletes one uniquely named fixture schema, never touches application tables, and
  uses a loopback fake Twilio API that captures requests without credentials. Besides the start,
  refusal, ownership, callback, audio, handoff, cancel and failure cases it covers:
  - worker restart: a fresh worker (its own pool, carrier client and service, the tool registered
    again) neither redials a run whose create request was in flight when the first worker died nor
    loses the call the carrier placed, and continues it at the next turn; an audio turn interrupted
    by the restart is not claimed again and stops at the 90 second processing bound;
  - owner no-answer: `DialCallStatus` `no-answer` on the handoff leg fails the run as
    `handoff_no-answer`, nothing dials the owner again, and a later carrier `completed` status or a
    repeated handoff callback does not turn it into a success;
  - credential confinement: the package code runs in a separate worker process
    (`tests/calling-worker.fixture.cjs`) with piped stdout and stderr and a fresh temporary working
    directory. Across dial, answer, audio, a failing recording delete, handoff, a cancel that hangs
    up, a failed create whose error body echoes the Authorization header, and refusals, the auth
    token, the SID:token pair and the Basic header value appear in none of the tool results or
    errors (returned over IPC), the callback responses, the rows of the four tables, everything the
    worker wrote to stdout or stderr, or any file it wrote under its working directory. Files it
    writes elsewhere and output from other processes are not covered.
- `tests/generate-audio.ps1 -OutputDirectory <temporary-directory>` creates 24 real WAV recordings
  using two installed Windows voices. `tests/audio-round.cjs <directory> <report.json>` runs those
  bytes plus silence, instrumental music, noise and degraded variants through the installed local
  speech provider. Set `OSHAL_CORE_DIR` to the running core; its usual voice service settings apply.
  The 45-case report separates exact expected actions, conservative waits on degraded audio, and
  failures. A conservative wait is not counted as successful recognition.
- Set `CALLING_REAL_AUDIO_FIXTURES` to the generated directory and `CALLING_AUDIO_REPORT` to a
  temporary JSON output when running the integration suite to exercise a whole tool-initiated task
  through signed mock callbacks, actual speech recognition, DTMF, speech, hold, silence and handoff.
- `node --test calling-assistant/tests/audience-view.test.cjs`: the static audience-view contract (kit
  right after the theme bootstrap, boot with this application's name and audiences, `ui/client.js`
  gated on the kit's decision, reads only on this package's routes). `tests/audience-view.fixture.cjs`
  feeds the store's `node scripts/audience-views.browser.cjs calling-assistant` (headless Chromium with
  the real kit from a core checkout: the view paints, the full UI is hidden, nothing is written, the
  full page is untouched without the audience).
- `node --test calling-assistant/tests/ui.test.cjs` with Playwright available (core dependencies on
  `NODE_PATH`) checks desktop/mobile configuration and, with the real kit from that core checkout, the
  company view (no `/config` probe, no listener attached, full UI hidden) and the full page booting
  without the audience. Core's authorization-runtime suite tests callback signature admission, current
  owner/issuer, grant denial, deactivation and POST-only execution.

Generated audio tests prove waveform processing and orchestration, not a live Twilio call or carrier
speech synthesis. The operator's controlled call is the remaining acceptance check after setup.
Provider contracts: [Record](https://www.twilio.com/docs/voice/twiml/record),
[Play digits](https://www.twilio.com/docs/voice/twiml/play),
[request signatures](https://www.twilio.com/docs/usage/security).

## Operator backlog

**Open: configure the paid account and capture a live test receipt.** Follow the setup steps above,
verify the sender/account permissions and callback reachability, run a controlled destination that
you own, answer the handoff phone, and retain the report with actual carrier call and handoff status.
Then evaluate a claims menu with the approved information. A successful fake-carrier test does not
close this human action item. Keep arbitrary natural-language negotiation, streaming/full-duplex
audio, additional carriers, service-principal enrollment and recording-retention automation on the
roadmap until their distinct implementation and live evidence exist.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| phone-task-operator | phone task | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
