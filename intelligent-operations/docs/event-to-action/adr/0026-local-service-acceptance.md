# ADR0026: Record local service acceptance separately from release certification

Accepted, 21 October 2026.

The operator authorized one SMS, one brief phone call and one Telegram test to the
existing private destinations. These are original-person tests through the shared
native notifier. They do not enable a general automatic alert campaign or authorize
external issue mutations.

The owned local Kubernetes installation now runs development kernel `ac5f00e`.
The build uses an immutable source export and the existing verified runtime base;
image/binary digests and a private rollback snapshot are retained. Only the kernel
image and source annotations change. Accounts, sidecars, environment, placement and
volumes are compared before/after. Supported service keys enter through the standard
private connector installer. Credentials and destinations never enter the product
package, public receipt or agent evidence.

The acceptance runner fsyncs an attempt reservation before any possible send and
never resends an attempted channel. SMS and voice returned explicit carrier
acceptance. Telegram's successful HTTP response used the installed older contract;
its newer-field checker initially marked it unconfirmed. The record was reconciled
against that exact legacy success contract, explicitly marked as an inference,
without another send. All three channels have one attempt and all test topics are
muted. The operator subsequently confirmed receiving the phone call in chat.
That confirmation is recorded separately from the native carrier acknowledgement;
The operator reported no SMS. A read-only provider lookup uniquely matched the
existing test and returned `undelivered`, error `30034`: the sending number is not
associated with an approved US A2P 10DLC campaign. No additional message was sent.
SMS registration/delivery remains blocked; Telegram human receipt is unverified.
The provider definition is documented at
https://www.twilio.com/docs/api/errors/30034.

The installed connection/notification screen and existing three workflow-generated
shared-PVC reports pass native password-login checks after the development update.
Jira is selected and connected under the original person, with its invocation scope
and named-account selection. Its read-only profile probe returned HTTP 404; live
account/site validation remains open and no issue mutation is claimed.

Full release certification remains open. The wider committed kernel gate found a
stale SQL cache (fixed centrally in core ADR189), stale fixture contracts/counts
(corrected without waived assertions), and a 264 MiB stream that expired its
ten-minute handle under the test load. The complete rerun on `af5afcb` remains pending.
The development image is explicitly marked uncertified; the kernel PR remains
draft. This local acceptance does not turn a failed or incomplete full gate green.

Sanitized evidence lives in `deploy/evidence/communications-acceptance.json`,
`development-kernel.json`, `services-standing.json` and `jira-readonly.json`.
