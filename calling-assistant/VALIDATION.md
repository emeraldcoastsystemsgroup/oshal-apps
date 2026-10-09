# Calling Assistant validation

Validation on 2026-09-26, before carrier-account configuration:

- 42 policy/configuration/signature/TwiML/navigation-declaration tests passed.
- 22 deterministic PostgreSQL and mock-carrier integration cases passed, including real HTTP
  callbacks, ownership, issuer isolation under a non-superuser role, cancellation, idempotency,
  failure handling, reporting and recording cleanup. The fixture database schema is disposable.
- One additional complete task used the registered tool, signed mock-carrier HTTP callbacks and
  the actual local speech provider over generated WAV recordings. It produced keypad and spoken
  replies, silent hold/silence handling, human detection and a simulated completed handoff report.
- 45 waveform cases exercised actual speech recognition: two synthesized voices, explicit menus,
  spoken choices, human greetings, announcements, music, silence, noise and degraded/8 kHz audio.
  44 produced the expected action. One heavily music-masked menu abstained safely (wait).
  No unsafe action occurred. This is not a claim of 45/45 recognition accuracy.
- The browser test exercised the actual configuration UI at desktop and mobile widths, default-off
  behavior, existing shared-account selection, sender loading and explicit configuration saving.
- 161 focused platform tests passed across authorization runtime, route mounting, package tools
  and kernel capability registration. Both platform TypeScript projects passed typechecking.

The WAV round uses real audio bytes and the real local speech service, not injected transcripts.
Carrier transport and final telephone connection are simulated. No real insurer or personal phone
was dialed. The separate operator backlog item remains open until a live carrier session proves
the configured account, public callback reachability, audio behavior and handoff.

Contract cases added on 2026-10-01 (package runtime unchanged, still before carrier-account
configuration):

- 26 deterministic PostgreSQL and fake-carrier integration cases passed (27 tests, the real-audio
  case skipped without `CALLING_REAL_AUDIO_FIXTURES`), against a disposable PostgreSQL 16 container.
  The four new cases cover worker restart with the create request in flight, an audio turn
  interrupted by a worker restart, owner no-answer on the handoff leg, and the Twilio credential
  staying out of the tool results, the callback responses, the stored rows, and the full stdout,
  stderr and working-directory files of a separate worker process that runs the package code.
  Files written outside that directory and output from other processes are not checked.
- Each new case was shown to fail against a deliberate defect in the package source, restored
  afterwards: the answer callback no longer adopting a call SID the first worker never recorded;
  the restarted worker claiming a turn already being processed (it interpreted the audio again and
  emitted `<Play digits>`); no 90 second processing bound; owner no-answer recorded as completed
  (the existing busy case stays green under that defect); the handoff callback dialing the owner
  again; a provider error body logged with `console.error`; the credential stored in an event
  detail; the token written to file descriptor 2 through `require('node:fs').writeSync` and through
  a `writeSync` bound at module load; a pino logger on its default destination; a pino transport
  writing from a worker thread to stdout; and a pino file transport writing
  `output/logs/calling-assistant.log` under the working directory.
- 42 policy, 3 home-summary and 4 audience-view tests passed.

Carrier transport and the telephone connection remain simulated. No live call was placed.

Reproduction commands and prerequisites are in `README.md` and `tests/test-lab.yaml`.
