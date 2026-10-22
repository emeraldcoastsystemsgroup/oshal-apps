# ADR 0006: Select independent applications and shared communication transports

Status: Accepted and partially delivered, 20 October 2026.

Context: The hackathon installation needs Operations, Office, email and Telegram alerts,
with Jarvis as its assistant. The broad Jarvis experience package requires Finance and
many unrelated applications. Initial Kubernetes desktop transfers failed because native
import routes were absent, although the bare-metal satellite had worked.

Decision: Install the independent public `intelligent-operations`, `presentations` and
`email-summarizer` packages after the kernel. Use built-in Jarvis and Workflow Studio.
Trust the captured public origin before previewing and installing each exact artifact.
Keep source identity, native sessions, account transfer, application grants, connections,
notification preferences and delivery in the kernel's shared frameworks.

Operations retains its operator role; Jarvis gets chat-user. Office and email currently
use application tiers. Optional model accounts are imported only through the signed-in
installation operator; a device enrollment credential cannot authorize the import.
Choose the model explicitly after testing it. Shared runtime configuration is not
permission to impersonate another user's mailbox or to perform an infrastructure action.

Telegram is a separate native notification transport over fenced HTTPS. It follows the
person's saved topic, numeric destination, mutes and quiet hours. A manual test send needs
native confirmation and delivery is recorded only after Telegram acknowledges a message.
Reuse the existing bot for outbound configuration without changing its webhook. Mail
application credentials and mailbox sign-in are separate steps; the connector installer
does not enable Google portal auto-provisioning.

Alternatives rejected: installing the entire umbrella bundle; application-private tokens;
database writes that bypass registry trust or role previews; treating a stored credential,
configured bot or HTTP success as proof that an external message was delivered.

Acceptance: Five active packages with no Finance; admitted app views; real desktop Codex
and Claude transfers and model responses; actual locally generated Office artifact;
visible disconnected-mailbox guidance; Telegram caller isolation, confirmation, bounded
payload and acknowledgement tests. Keep live delivery, mailbox connection, automatic event
notification production and full platform publication explicitly separate.

Owner boundary: The store owns Operations' event producer and UX. The kernel owns the
installer, notification rail and credentials. M2/M4 still own ingestion, filtering and
the established reduction algorithm; this installation does not complete those milestones.


21 October implementation refinement: the shared native notifier now has source-tested SMS and explicitly enabled short phone alerts (core ADR186/188). Brief calls use fixed escaped speech followed by hangup, a30-second ceiling and no recording; interactive Calling Assistant remains separate. Configure services through the standard private Kubernetes connector installer, and save destinations under the original person's topic preferences. The operator authorized exactly one SMS, one brief call and one Telegram test to existing destinations. The operator-side acceptance runner fsyncs each reservation before any possible send, holds lost acknowledgements and mutes test topics. Live acceptance remains pending the final kernel gate/rollout. No automatic alert campaign is authorized by that test.
