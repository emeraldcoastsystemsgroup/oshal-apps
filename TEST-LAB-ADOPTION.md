# Installed Test Lab adoption

This cohort registers the existing tests for ten packages. Installation loads each
package's `tests/test-lab.yaml`; it does not execute tests, change application
permissions, or certify an audit. The manifests, marketplace, audit versions and
generated README are released together.

| Package | Version | Shipped suite files | Supported Node cases | Pending cases |
|---|---|---:|---:|---:|
| create | 1.2.1 | 3 | 3 | 0 |
| presentations | 2.11.2 | 3 | 3 | 0 |
| bake-off | 1.1.1 | 1 | 1 | 0 |
| identity | 1.1.1 | 2 | 1 | 1 |
| email-summarizer | 1.2.1 | 1 | 1 | 0 |
| finance | 1.2.1 | 1 | 1 | 0 |
| world | 1.2.1 | 3 | 3 | 0 |
| marketing-engine | 0.4.2 | 4 | 3 | 1 |
| payroll | 2.3.1 | 13 | 13 | 0 |
| venture-plan | 1.4.1 | 18 | 16 | 2 |

All 49 suite files are referenced explicitly. The 59 catalog cases include ten
existing smoke declarations with preserved identities. Tests using in-memory
ports are classified as unit coverage; the Create loopback HTTP suite is
integration coverage. Package test files and business code are unchanged.

The Identity Home harness needs disposable PostgreSQL, Chromium and its explicit
core fixture. Marketing's persona declaration check needs packaged persona
metadata. Two Venture Plan suites need the package's dataset and example fixtures.
These four cases remain pending in the current sealed runner. Runtime business
datasets must not be copied into that runner to make a check pass.

## Running and maintaining the catalogs

Open `/api/test-lab/app` on a controller with the supported isolated Node runner.
Use Run for a current eligible package case, or Scheduled package checks for a
current application/level selection. Daily unit checks include newly installed
eligible unit cases automatically; the integration suite needs integration selected.
Versioned results remain attached to the source and image that actually ran.

Use `node scripts/oshal-app.js validate <package-dir>` from the core checkout to
validate each package. In this store, run `node scripts/check-catalog.mjs` and
`node scripts/security/validate-package-audits.mjs` against the canonical committed
export. The latter compares exact LF JSON bytes; a Windows CRLF working checkout
is not that export. Audit records stay pending until their separate controls pass.

When adding a test, update the package catalog in the same change. Describe the
assertions, actual runner, prerequisites, effects, cleanup and bounds. Review the
Lab's registration-drift report after installation. Missing runners, unregistered
files, failed assertions and successful runs are separate outcomes.

See [the authoring contract](BUILDING-EXTENSIONS.md#registering-package-tests-with-the-ai-test-lab)
and the [core execution guide](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/testing/package-test-execution.md).

## Source acceptance

The actual core catalog and disposable Docker runner passed all 45 supported
suites: **572 Node tests, zero skipped or failed**, with cleanup verified for
every execution. Create/Office/Bake-Off/Identity/Email/Finance/World contributed
89 tests; Marketing/Payroll/Venture contributed 483. All ten registration-drift
inventories are empty. CLI package validation and marketplace/README parity pass.
The four prerequisite-dependent suites remain pending. Deployed acceptance is a
separate release check; these results describe the isolated source execution.

## Deployed acceptance: 2026-09-11

Public source `ec1482a37848cbe4981af206e89fe9ff8d3563f9` is installed at the versions
in the table above. Serving core is `7a22a13067f464b10cf0d0c58e28049aba76ddd8`;
the immutable result image is `sha256:2142c427653fbf70afd651d8e6e06b4f13898863a2e8bc05247fa224c9e6ab56`.
The core platform regression passed **275/275 tests across 24 files**, with
publication and exported-source typechecks passing. The canonical public export
passed **15/15 store checks**, and all **54 audit/catalog records** validated.

On 2026-09-11 (America/Chicago), the authenticated installed Lab completed
**44 public unit suites / 568 Node test cases**, all passed. Create's separate
loopback HTTP integration run passed **4/4**, making **45 native public suites /
572 Node test cases**. Every final durable result read returned HTTP 200, and every
receipt records the exact image above and verified container cleanup. The public
cohort had zero registration drift. All **59 catalog cases** matched their installed
versions and source pins, and all **ten metadata readiness GET smokes passed**.

The existing daily unit schedule remained enabled and unchanged. This acceptance
records an explicit one-off occurrence through that schedule; it does not claim a
future unattended interval. Integration requires an integration-level selection.
Four fixture-dependent cases remain registered and unavailable; they did not run.

All **367/367 staged public package files**, including installation stamps, matched
installed bytes. All **35 app services** were healthy on the expected image;
independent deployment parity passed. Original infrastructure identities,
configuration hashes, authorization assignments and existing business data were
unchanged. This is the dated adoption receipt; later package and configuration
changes require their own verification.

Transient result-read failures occurred during the batch. Bounded retries of
reads only (at most three attempts, 1.5 seconds apart) recovered every receipt;
tests were not dispatched again. The original failures remain in the progress
evidence. Local database pool configuration is a separate operational follow-up,
not a claim that the transient failures never occurred.

The core also corrected a schedule-page refresh race with seven actual browser
cases, including a deterministic failure before the fix. Current source and native
acceptance are complete for the supported recipes; the four explicitly listed
fixture cases remain pending. Other packages' registration and runner gaps remain
outside this cohort. See the
[dated core acceptance](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/releases/test-lab-adoption-2026-09-11.md).

## Sports Edge follow-up: 2026-09-11

Sports Edge **0.7.1** is a separate follow-up at
[source `7459c157774e98167737d28f6358e0f6f7a05441`](https://github.com/emeraldcoastsystemsgroup/oshal-apps/blob/7459c157774e98167737d28f6358e0f6f7a05441/sports-edge/README.md).
Its catalog registers all **11 shipped suites** plus the preserved readiness smoke.
All **11 suites / 165 Node tests** passed through the actual sealed package runner,
with zero failures or skips, verified cleanup and no registration drift.

The installed authenticated Lab separately ran the **coach suite: 11/11 passed**,
with HTTP 200 for its durable result and verified cleanup. The preserved metadata
readiness GET smoke also passed. These native checks cover one suite and the smoke;
the eleven-suite total above describes isolated source execution. Native results
pin core `8d1abae445097b11b1c5197bdff1212eb176cbf7` and image
`sha256:10933116dc2754b3abb38f6e1482280cef58ae5f4e95bed3caad56600573bc01`.

The coach suite uses synthetic ESPN, World and persistence boundaries around the
actual compiled modules. It verifies roster parsing, current team attribution,
missing and changed coaches, follow ownership and persistent cooldown; it performs
no live provider ingestion or betting. The ten-package cohort and its four pending
fixture cases above retain their original counts and dated receipts. Sports Edge's
audit remains pending.

## Portrait Studio follow-up: 2026-09-12

Portrait **1.14.1**, published source
[`2e10bbb6eb07fc69a9f6b3022b50ae165488f7f4`](https://github.com/emeraldcoastsystemsgroup/oshal-apps/commit/2e10bbb6eb07fc69a9f6b3022b50ae165488f7f4),
was installed from the standard verified stage. All 58 committed files and the
installation stamp matched. The named-role entry repair preserved the 1.14.0
authorization catalog; it did not require another role regrant. The signed-in
catalog showed all **eleven Portrait cases** at the current version/source.

The actual installed Lab then ran **`local-face-cascade`: 4/4 passed**, no skipped
or failed tests, with verified cleanup and no timeout/cancellation. Durable run
`69bf258d-6e7b-4444-9bea-b5511add0df6` completed at 08:27:31 UTC on core
`9c5985ed0c82cab72374c63d9ac1d78705568409`, image
`sha256:20ba2e72fd2647e767b9386f9e1dbb911753be519c874bdf3e676d3e3ae96559`.
The retained result's catalog and execution revisions matched the installed case.
This is one native sealed Node recipe, separate from catalog registration and
the existing ten-case Chromium/Firefox/WebKit detector fixture proof.

At that core9c5985 checkpoint, the native image-picker face-detection flow was
**not completed** because a Windows prompt blocked it. That receipt did not prove
native face-photo detection, generation, provider upload or a real camera workflow.
Browser/custom-harness/PAT
prerequisites remain explicit; the other ten catalog entries were not thereby
executed. Application audit controls remain pending.

Read-only preservation passed for the recorded core checkpoint without changing
the earlier baselines. Local evidence is retained in
`temp/parallel-native-install-registration-final.json`,
`temp/parallel-native-current-runs-receipt.json` and
`temp/parallel-backlog-preservation-9c5985ed-final-20260912.json` in the core checkout.
Later core rollout and preservation are recorded separately in the
[parallel release record](https://github.com/emeraldcoastsystemsgroup/oshal/blob/feat/store-compatibility-gate/docs/releases/parallel-backlog-2026-09-11.md).
The ten-package cohort and Sports counts above remain their original dated evidence.

### Later native photo check

After the Windows blocker was closed normally, the actual installed Chrome page
loaded the [licensed local `astronaut.png` fixture](portrait-studio/tests/fixtures/README.md)
through its file picker in **Group** mode. At 08:52:09 UTC on 2026-09-12, **Find
faces** returned one face and displayed an editable box. The browser's
`FaceDetector` API was unavailable, so this exercised the bundled local fallback.
The page and saved preference both remained Daylight, and the recorded generation
request count was zero.

This check used core `dd7bcaa402d7074122db85a322d1cf785ded1776`, image
`sha256:b568aa193af92e3c1ca1ac1abde10e304acca71878f3c59584a8a72767503353`,
with the same installed Portrait 1.14.1 source `2e10bbb6`.
The receipt and screenshot are retained at
`temp/portrait-native-detected-dd7bcaa4.json` and
`temp/portrait-native-detected-dd7bcaa4.png` in the core checkout.
It supersedes the earlier blocked status for this one picker/detection check;
the 4/4 Lab run remains the separate core9c5985 checkpoint. No portrait generation,
provider output, export, real camera, recognition or broader Safari/device workflow
was exercised. This adds no hosted-suite or audit-completion claim.
