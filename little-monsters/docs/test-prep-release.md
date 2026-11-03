# Study Lab 1.6.0 implementation and verification

The [product specification](test-prep-spec.md) defines the complete direction. This release
implements the first saved learning loop at `/api/education/test-prep` and adds the **SAT & ACT** tab.

Implemented:
- SAT and enhanced ACT diagnostics; eight-question focused sets; fixed full-length pacing
  simulations, optional ACT Science, practice time multipliers and the SAT Math break.
- 21 original lessons and 222 template-based foundation question variants. Each lesson includes
  a worked example, shortcut, limitation and common mistake. Each has an actual narrated MP4,
  a WebM fallback for Chromium without H.264 support, WebVTT captions and a readable transcript.
- Server-held keys, snapshot questions, deadlines, private saved answers and cumulative active
  question time. Answers save on selection/navigation and every five seconds; hidden tabs pause
  active time while server deadlines continue. Up to five seconds of unsent timing can be lost on
  an abrupt browser termination. Offline saves remain in memory and the page offers retry.
- Owner/tenant-scoped sessions and profiles, conflict detection, resume, confidence, review flags,
  mistake categories and written lessons learned. Finished grades cannot be overwritten.
- Accuracy and correct-answer pace per skill; weak/slow/due focus; separate exam histories;
  first-versus-recent fresh-item comparison after ten samples. Repeat IDs do not inflate mastery.
- Saved date and daily budget; the daily budget is a displayed goal. Automatic multiweek planning
  and reminders are expansion work, not delivered behavior.
- Test Prep Coach plus nine caller-scoped Jarvis tools: progress, topic search, prepared practice,
  graded answers, create/list/read/update training, and saved study plans. Ready practice waits for
  **Begin practice**, so a conversation does not consume the student's test time.
- A common versioned question table, private per-question answer ledger and private training table.
  Session and ledger writes commit together; revision conflicts refuse stale updates. The dashboard
  shows fresh evidence, recent accuracy, active study time, study-pack reviews and practice history.
- Saved topic training with explanations, worked examples, shortcut limits and recall cards. Guided
  packs use researched content; optional personalized packs call the configured, tool-disabled study
  model under the student's identity. Cards, notes and completion save to that student. Model output
  is bounded text, validated before saving and escaped when shown. Reviews do not count as mastery.
- 47 searchable question-type methods with applicability, failure cases, original examples and
  primary-source context; 16 inspected official question references; official download links
  for SAT tests 4–11 and ACT tests 1–4. The 32 PDFs are verified local research downloads, not
  shipped question-bank content. See [strategy research](test-prep-strategy-research.md).

## Verification

- Package `tests/*.test.cjs`: **200 passed, 0 failed, 0 skipped**, using the existing framework
  checkout for the legacy catalog validator and the store's pinned Node/browser toolchain.
- `tests/authorization/prep-postgres-browser.test.cjs`: **8 passed** against a dedicated disposable
  PostgreSQL 16 container. Actual compiled routes and SQL; synthetic authenticated OIDC identities
  for two students in one school and a student in another. The framework logger alone is stubbed.
  Browser tests cover phone/desktop width, saved answer reload, review/reflection, playable media,
  lesson completion, focused practice and a failed network save followed by successful retry.
  They also exercise strategy search, no-match results, exam/section switching, optional Science
  and Writing guidance, and the distinct paper/online official resource links. Added cases prove
  the common bank, separate student answer ledgers, transaction rollback after a forced ledger error,
  prepared practice, private training, concurrent edits, saved notes/cards and completion after reload.
- The full package build compiles all 50 TypeScript modules successfully. The staged textbook-upload
  variable has an explicit UploadedFile type, fixing the prior Multer intersection inference error.
  Changed compiled modules are generated with the framework build; unrelated emitted drift is excluded.
- Native integration: **1 passed, 0 failed, 0 skipped**. It applies the actual migrations under a school administrator, then exercises
  private practice, grades and training inside the isolated kernel process host with real row policies.
  Students cannot mutate the bank. The test uses its own PostgreSQL database and no live student data.
  The canonical learner/teaching adapters are registered with the shipped prep router. Concierge
  requests execute all nine prep tools using named student grants and the real API-tool executor;
  only model wording is scripted. Personalized content also traverses the real native model port
  and persists the returned lesson under its requesting student.
  MP4, JPEG and WebVTT requests return the exact bundled bytes and correct media types through
  the authenticated sandbox route. Videos sit in the package's lasting directory
  (`scripts/lesson-studio/install-videos.py`) and answer real byte ranges through the lasting-file
  reference (`routes/education-prep-media.js`), above the 8 MiB package reply limit. Captions need the
  companion kernel change that admits `.vtt` into source snapshots.
- Personalized generation additionally has a deterministic model-boundary test (identity, bounded
  prompt, tool suppression and invalid-output refusal). The live acceptance below additionally checks one actual provider-generated lesson; it does not certify every possible generated lesson.
- `tests/lm-lesson-videos.test.cjs` decodes every published video: it keeps moving, a monster is in
  the room, the voice's pitch moves like a person's, the captions match the script word for word, and
  the file streams. Lessons run about two minutes. Captions are timed to the spoken phrases.
- Manifest validates; it retains the existing Presentations dependency warning.

The package tests run with:

```bash
NODE_PATH=/path/to/store/scripts/toolchain/node_modules \
OSHAL_ROOT=/path/to/legacy/framework \
node --test little-monsters/tests/*.test.cjs
```

The integration test requires `STORE_CI_TOOLCHAIN` pointing to the directory **containing**
`node_modules`, and `LM_PREP_TEST_DATABASE_URL` explicitly pointing to a disposable PostgreSQL on a
nonstandard loopback port. It creates/drops only its process-specific schema. Never use the live DB.
The harness owns and removes its container after the test; Chromium comes from the store toolchain.

Content is reproducible with `scripts/build-test-prep-content.py`. Videos come from
`scripts/lesson-studio/` (see its README): a hosted speech model records each original script once, and
the take is kept in `takes/` so the pictures can be redone with no key and no new voice. No student data
reaches any service, and nothing is generated at run time: every student gets the same file. Run
`install-videos.py` on each installation after delivering new videos (see the studio README).

## Release state and remaining work

**Live on 2026-10-28:** [SAT & ACT Study Lab](https://oshal.agenticfederal.us/api/education/test-prep).
The running application source is `a5de28872fc451f9e094e2cfc1c5971255521c36`; the native media
runtime is `48c16e6292a3335e637a00592f7381102fc4087b`, built on the previously running kernel.
The application uses a separate source-pinned snapshot. Other application source files were preserved.

Activation installed only the five additional row policies, retaining every existing rule and the
school provisioning identity. The 222 immutable shared questions were seeded from the exact checked-in
041 migration through a witnessed, atomic operator import; no student or school role was elevated.
The normal native schema endpoint then applied migrations 039–041, with its bank inserts becoming
no-ops against those same keys. The 11 affected existing assignments were reapproved through the
normal preview/apply API with identical authority, selection and expiration. Media-bearing packages
were refreshed after the runtime export change, and all previously active applications and assignments
were verified active afterward. The broader product/educator audit remains pending; earlier-version
package audit evidence is not claimed for 1.6.0.

### Live acceptance

Two dedicated test students used the running native service, its real database, named Student access,
and the configured model. Jarvis additionally used its normal `chat-user` role. Browser checks ran at
1440×1000 and 390×844, with separate screenshot inspection and viewport-fit checks.

- The visible SAT & ACT tab and dashboard action open the lab. A fresh student opening the lab
  directly completes school setup before its private progress request. Both issues were found and
  fixed during this live pass.
- SAT/ACT switching, optional Science, timing multipliers, test date and daily budget worked. A saved
  plan survived reload. ACT diagnostic and full-length pacing launch displayed their actual question
  and timing budgets; this pass did not sit through an entire official-length exam.
- A completed eight-question practice produced 7/8, durable answer times, confidence and review flags.
  Reload preserved the answers, grades and written mistake reflection. A second controlled practice
  brought one skill to ten fresh samples; its recent 60% accuracy became the top weak-area focus and
  the first-five/latest-five comparison displayed +40 accuracy points. These are fixture results,
  not claims about any real student's improvement.
- The live captioned WebM lesson played with a decoded 1280-pixel video and captions enabled.
  Lesson review was saved separately from assessed progress.
- Both guided and actual-provider personalized training were created and saved. The personalized
  reverse-percentage example correctly recovered $60 from a $48 sale after a 20% discount and explained
  why adding 20% to the sale price is wrong. Reviewed cards, a note and pack completion survived reload.
- The actual Test Prep Coach read saved progress through `lm-test-prep-progress`, then prepared an
  eight-question session through `lm-test-prep-start`. Its clock stayed unstarted until the browser's
  Begin control. In the actual Jarvis screen, a natural-language request invoked progress and
  `lm-test-prep-save-plan`; the dashboard then reloaded with the requested 30-minute goal and unchanged
  test date. This is actual provider execution, separate from the scripted-model integration proof.
- Another student received 404 for the first student's session and training; an anonymous request
  was refused. Completed answer-overwrite attempts left stored grades and revision unchanged.
- Live concurrent saving exposed native collection-witness collisions between different students.
  The fix retries only definitely rolled-back native conflicts from fresh reads, with a bounded limit.
  Twenty simultaneous session saves across the two students then passed; a genuinely stale own-session
  revision still returned 409. Four added regression cases cover retry boundaries and completed-save
  immutability. The final package and PostgreSQL/browser runs passed 200 and 8 tests respectively.
- Empty searches, clock hiding/restoring, stale-session recovery and narrow-screen tables were checked.
  No horizontal page overflow or browser script errors were observed in the inspected states.
- The authenticated public HTTPS progress route returned 200 with the same saved results.

Private operator evidence (screenshots, source hashes, exact deployment witnesses and fixture receipts)
is retained under `~/.local/state/oshal-native/lm-prep-live-20261028/`; it is not distributed in the app.
The normal store push hook remains enabled, with its documented legacy checks explicitly marked as
skipped. No skip is treated as a passing test.

For the native proof, set `OSHAL_NATIVE_KERNEL_ROOT` to the kernel checkout,
`OSHAL_PACKAGE_NODE_MODULES` to its installed, pinned `crates/host-process/node-runtime` dependencies,
and `OSHAL_TEST_POSTGRES` to an explicitly disposable loopback PostgreSQL on a nonproduction port.
The kernel checkout must contain the companion captioned-media export change.
Run `node --test little-monsters/tests/authorization/native-prep.test.cjs`. It removes its unique
Rust test file, temporary package directory and owned database afterward.

This is a starter skill curriculum, not a comprehensive test-prep course. Remaining specification
work includes educator review, broader independent question families and realistic shared reading
passages, SAT student-produced responses/adaptive calibration, ACT essay practice, school-approved reporting, and reminders. Use official practice to assess
transfer; neither a familiar template nor fast foundation questions prove exam readiness.
