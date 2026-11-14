# Native submission worker

Career auto-submit uses a separately enrolled `browser-form-v1` worker bound to
`career-submission-browser` (`cb000000-0000-0000-0000-000000000004`). A general
reasoning node cannot claim this work. The worker uses Playwright 1.59.1 semantic
controls, approved profile fields, exact PDF uploads, page-state waits and before/after
pictures for each permitted step. It does not run a model call for each form field.

The application publishes approval and a frozen private input first, binds a
queued native ticket in a second request, and starts that saved ticket in a third.
A retry recovers the same ticket and exact input. Native admission binds the
original person, package source, bot, device claim and runtime generation. Each
employer press needs its own native permit. The approved digest covers `maxPresses: 4`;
there are at most four distinct presses within the native 120-second work limit.
Lost press acknowledgements and unconfirmed responses stay unknown; neither is automatically retried.

When approval was saved but queueing or starting was interrupted, Submission
activity offers **Resume approved submission**. It reads the current native state
first and reuses the same intent, frozen documents and saved ticket. If the start
response was lost after publication, the existing work is recovered. Resuming
does not create a replacement approval. Expired approvals stay blocked; uncertain
employer outcomes must be checked rather than retried.

Confirmed completion is projected into application status only after the exact
accepted native answer and actual confirmation image pass digest checks. The
record says worker-reported: a screenshot is retained evidence, not an independent
employer verification service. Submission activity can open it. Unanswered required
questions before a form press return to the person, whose explicit per-job answers require a new
review and approval. Jarvis uses the same routes and a person-approved action
card for the exact packet.

## Worker configuration

On Submission activity or the Submission queue, choose **Connect browser worker**.
Review its scope, then create the connection. The signed-in person owns the new
node and its exact Career browser-bot binding; the private configuration downloads
only after this action. No employer application is sent by connecting it.

On the bare-metal Linux computer, the packaged installer verifies that device's
owner, tenant, browser capability and exact bot binding before preparing its user
service. It copies the pinned runtime, isolates its profile and work directory,
and writes the credential with mode 0600. A preflight does not create a service:

```
python3 career-hunter/bin/install-browser-worker.py --config /private/career-browser-worker.json --node-modules /path/to/pinned/node_modules --check-only
python3 career-hunter/bin/install-browser-worker.py --config /private/career-browser-worker.json --node-modules /path/to/pinned/node_modules --start
```


Use an original-person node join code, redeem it with harness
`{"custom":"browser-form-v1"}` and capabilities `{"browse":true}`, and bind the
resulting node to the browser bot through the native owner node UI/API. Never use
an installation admin credential as a substitute for the applicant's identity.

Install Playwright 1.59.1 and its Chromium through the trusted store toolchain.
Set `NODE_PATH` to that toolchain's `node_modules`, or install the pinned package
beside the worker. Keep this configuration owner-readable only (0600):

```json
{
  "version": 1,
  "kernelUrl": "https://your-oshal-host",
  "nodeId": "the-original-owner-enrolled-node-uuid",
  "deviceToken": "the-private-device-token",
  "botId": "cb000000-0000-0000-0000-000000000004",
  "profileDir": "/absolute/private/career-browser-profile",
  "workDir": "/absolute/private/career-browser-work",
  "headless": true
}
```

Both directories must be owned by the worker user and mode 0700. They are separate
from the user's ordinary Chrome profile and unrelated tabs. The service blocks
service workers and local-network browser requests; credentials stay in Node and
are never injected into web pages. HTTPS certificate checks remain enabled.

Print the runtime fingerprint, then pin that exact value in the service command:

```
node career-hunter/bin/career-browser-worker.cjs --fingerprint
node career-hunter/bin/career-browser-worker.cjs /private/worker.json --expected-sha256 FINGERPRINT
```

A delivered package carries no `node_modules`, so `--fingerprint` run bare from it cannot load Playwright and
prints only `career_browser_worker_start_refused`. Run it with the helper's own pinned runtime, as its unit does:
`NODE_PATH=~/.local/state/oshal-native/career-browser/runtime-1.59.1/node_modules node bin/career-browser-worker.cjs --fingerprint`.
`install-browser-worker.py --upgrade --check-only` does this comparison for an installed helper.

The existing owner mailbox schedule also reconciles accepted submission results
before checking employer email, so the Career tab need not stay open. A browser
submission activates that original-owner schedule.

The fingerprint includes worker code, the pinned Playwright version and browser
binary bytes. Update it deliberately when deploying a new worker. Result outbox
files retain exact evidence across a lost acknowledgement; recovery reports those
bytes and never opens the employer form again.

When the worker and kernel share the bare-metal computer, `kernelUrl` may use the
kernel's trusted loopback origin (`http://127.0.0.1:38788`) to avoid a public gateway.
The installer still verifies the exact device, owner, tenant and sole bot binding.
This affects the Node control connection; employer browser requests remain public
HTTPS only. Heartbeats include the device token in the native route's body field;
work requests use the separate device header. Neither is exposed to the browser.

## Focused acceptance

The application suite covers private approval/dispatch, immutable packets,
question answers, state/UI mapping, authorization bindings and real browser
forms. The native `browser_node_work` tests additionally run the shipped Node
worker through actual native HTTP and an owned TLS employer fixture. That fixture
accepts the complete multipart resume and cover letter once and retains actual
Chromium confirmation bytes. It never contacts a real employer.

On October 27, 2026, the applicant approved enrollment and startup on the bare-metal
installation. Its dedicated service is running with a private profile and pinned
runtime; the original-owner Submission queue shows **ready** and enables exact-packet
approval. The review was cancelled and no employer application was sent. A new
process regression starts the shipped entry point, authenticates its heartbeat,
reaches the claim loop and shuts down Chromium cleanly.

The continuous owned native fixture now covers approval, browser submission,
retained confirmation, application status and synthetic mailbox reconciliation.
Production ATS/login/challenge coverage and live conversational Jarvis approval
still require their full acceptance audit. A ready worker is not a claim that
every employer form is supported.

## Bounded submission steps in 1.60.10

The approval screen says: “This form can have more than one step; Career will press
up to 4 buttons on jobs.example.com.” The actual approved hostname and bound come
from the reviewed packet. Its digest covers the bound. Approval applies once to
that exact job, facts and document bytes. An existing saved approval and native
input keep their original digests; absent bounds still mean one press.

Before opening the posting, the helper clears only the approved host's cookies
(including parent-domain cookies) in its own isolated browser profile. Other
hosts' cookies and the person's ordinary browser are untouched.

The helper identifies one Apply button before visible form fields (`open`), or
fills the selected form and chooses one Submit-set (`submit`) or Next-set
(`continue`) button. Missing required answers stop it. A combined résumé/cover
field receives the approved résumé; separate fields receive their respective
approved files. The result says when the cover letter had no place to go.

Each step fingerprints visible control tags, types, names, labels and button words,
without applicant values; an opening page uses button words and the address path.
A repeated fingerprint stops locally. Before every press the helper takes a
picture and asks `browser-progress` with phase `press`, the next step number,
kind, button words, current origin and fingerprint. It never repeats an ask or
presses without its permit. A refusal presses nothing. A lost ask reply stops as
unknown because the kernel may already have recorded permission.

After a press the helper waits up to ten seconds. A blocked cross-site navigation,
frame or write wins over any receipt text (`left_site`). Otherwise an existing
English receipt phrase means `confirmed`, a changed form fingerprint on a settled
page means `advanced`, and an unchanged or unrecognized page means `unknown`.
Text changing alone does not advance a step. A Continue may itself confirm receipt.
Only an advanced page and the kernel's `next: true` allow another ask.

The after-picture is reduced locally to its reserved share of the 2 MiB artifact
budget (reserving the kernel’s 64 KiB answer ceiling plus 4 KiB) **before** its SHA-256 is reported with phase `pressed` and that press's
permit. A lost report reply causes one byte-identical retry. If both replies are lost, its
picture is omitted because the kernel may never have stored that digest. The final pack never
re-encodes a reported picture. A confirming form press supplies `confirmation.png`
with exactly that digest; other reported presses supply `press-<step>.png`.
Packing can drop the before-picture and then the earliest press pictures if the
answer plus pictures exceeds the budget. Missing pictures are said plainly.

The job's **Check the submission outcome**, **Application status**, and expanded
**Submission activity** show each permitted press in words and its digest-checked
picture when available. Permission without a report says whether it was pressed
is unknown. The kernel's words survive even if the helper never returns a result.

`completed` requires a confirmed Continue or Submit. Stops after only reported
opening presses may return `needs_review`, so unanswered questions can be answered
and approved again immediately. After any allowed form press or lost reply the
outcome stays unknown unless receipt is confirmed. **It was sent** records the
owner's word and blocks another submission; **It was not sent** closes the hold
and requires fresh review and approval. Neither button sends an application.

Upgrade the helper (next section) before using a newly approved packet. Helpers
from 1.60.9 or earlier reject `maxPresses` packets with “The approved application
facts or packet changed.” and press nothing. The installed kernel must include
ADR-220's `press`/`pressed` protocol before this package is released.

The real-Chromium proof runs the shipped worker against a loopback-only employer
that counts every press, and a stub kernel that records every ask/report and
checks retained picture hashes. Its fourteen sequence cases cover Continue then
Submit, Apply then Submit, Continue confirming receipt, Saving without advancing,
the four-press bound, a blocked second host, unanswered questions after Apply and
after Continue, a refused second ask, a lost second ask reply, an identical report
retry, isolated cookie clearing, an oversized confirming picture and all asks
refused. Existing PDF destination and result-outbox recovery proofs remain.
`career-native-worker-fixture.cjs` also offers `twoStep: true` (or
`variant: "two-step"`) for the coordinator's real-kernel integration case.

Only the existing four English receipt patterns count. Cross-site guards remain
conservative; login/challenge and real employer acceptance are untested. Required
radio, checkbox and file questions still use the existing generic answer UI.

## Upgrading an installed helper in place (1.61.1)

Pressing **Connect a computer** again enrols another device, and the installer refuses a second, different settings
file for the same person. An installed helper is made current without either:

```
python3 career-hunter/bin/install-browser-worker.py --upgrade --check-only
python3 career-hunter/bin/install-browser-worker.py --upgrade --package /path/to/delivered/career-hunter
```

The first compares the installed and delivered fingerprints and writes nothing. The second reuses the installed
settings file and enrolled device, copies the program from `--package` (default: the installer's own package) into a
new read-only release, rewrites only the unit's start line, restarts the service and waits (`--ready-timeout`, 90 s)
until the device's kernel profile reports the new fingerprint with a current lease and the Career bot binding. The
previous program copy is kept, and the previous unit is kept in `career-browser/unit-backups/`. If the new program does
not report ready, the previous start line is put back and restarted, and the command exits non-zero with
`"rolledBack":true`. It refuses with a closed reason and restarts nothing when no helper is installed (`no_install`),
the settings file is missing or not private (`settings_missing`, `settings_invalid`), the unit was not written by this
installer (`unit_unrecognized`), the device is no longer the owner's Career browser node (`device_not_current`), or the
helper is mid-application or holds an unreported result (`helper_busy`, `helper_result_pending`). The device token is
never printed. With more than one person installed on the computer, name one with `--owner`.

<!-- CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Explain why a bare --fingerprint from a delivered package refuses, and document --upgrade, the in-place re-pin that replaces reinstalling the helper. -->
<!-- CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Describe four individually permitted presses, immutable picture digests, owner records and required helper reinstall in 1.60.10. -->
