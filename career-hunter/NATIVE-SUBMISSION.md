# Native submission worker

Career auto-submit uses a separately enrolled `browser-form-v1` worker bound to
`career-submission-browser` (`cb000000-0000-0000-0000-000000000004`). A general
reasoning node cannot claim this work. The worker uses Playwright 1.59.1 semantic
controls, approved profile fields, exact PDF uploads, page-state waits and two
screenshots on the common path. It does not run a model call for each form field.

The application publishes approval and a frozen private input first, binds a
queued native ticket in a second request, and starts that saved ticket in a third.
A retry recovers the same ticket and exact input. Native admission binds the
original person, package source, bot, device claim and runtime generation. The
final action needs a one-use permit. Lost final-action acknowledgements and
unconfirmed responses stay unknown; neither is automatically submitted again.

When approval was saved but queueing or starting was interrupted, Submission
activity offers **Resume approved submission**. It reads the current native state
first and reuses the same intent, frozen documents and saved ticket. If the start
response was lost after publication, the existing work is recovered. Resuming
does not create a replacement approval. Expired approvals stay blocked; uncertain
employer outcomes must be checked rather than retried.

Confirmed completion is projected into application status only after the exact
accepted native answer and actual confirmation image pass digest checks. The
record says worker-reported: a screenshot is retained evidence, not an independent
employer verification service. Submission activity can open it. Unknown required
questions return to the person, whose explicit per-job answers require a new
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
