# ADR0028: Bind declared conversational bots explicitly

Accepted and installed, 21 October 2026.

A weekly RCA request submitted through the actual Jarvis UI reached the Operations
specialist, then failed with `operation has no explicit permission binding`.
The kernel admitted the application and completed Jarvis inference, but refused
the specialist before its inference. No new workflow was created. HTTP-only
acceptance had missed this separate non-HTTP admission boundary.

Bind both declared Operations bots by name to the existing `app.open` read
permission. Its resource scope remains `own`; existing roles, write permission,
workflow approval and execution authority are unchanged. The regression enumerates
every declared bot and requires its explicit binding and the own-scope read role.
Do not bypass the kernel refusal, add a broad role or fabricate a successful job.

After normal publication, use the existing trusted native package install and
composite-role reapproval flow, then submit through Jarvis again only after
checking for any partial work. The report, PDF, PowerPoint and email are separate
results and require actual artifact and provider receipts.

Source `2ef275de` was published and merged in PR547. The exact installed Operations
artifact is `dc3d158459d6a92cbbac3e6c9b2bc301a307e22f9efde11a49171bb236670e56`.
The real UX retry completed specialist and Office inference. Subsequent operator
evidence export supplied the own-account records; this is not autonomous evidence
retrieval. Create's separate studio installation and the actual PDF/PowerPoint/mail
receipts are recorded in ADR0029 and `deploy/evidence/create-suite.json`.
