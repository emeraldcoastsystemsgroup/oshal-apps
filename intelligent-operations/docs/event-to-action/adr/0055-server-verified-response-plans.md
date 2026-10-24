# ADR0055 — Approved plans use the kernel's accepted work

Status: accepted and installed in the Operations lab. Date: 23 October 2026.

## Context

The response page read completed work from the canonical ticket for preview, but sent its answer text back to the package when preparing a plan. The package froze the browser-supplied text as scripts and labeled its provenance unverified. A modified client could therefore submit different code under a real ticket and work ID. The approval gate bound the wrong bytes accurately but did not establish that a worker had produced them.

## Decision

The plan request now contains only the ticket ID, work ID and observed target. The package obtains the accepted answer through kernel ADR200's owner/type-scoped `getAcceptedWork` port, checks its IDs, source label, digest, receipt, phase and size, and extracts the response files from those returned bytes. New records retain the kernel receipt and mark `answerVerifiedByServer=true`. The browser's answer remains only a preview.

Existing plans marked unverified may still be inspected or downloaded as historical records. They cannot receive a new approval, reserve execution or reserve Git promotion. The operator prepares a new plan from the accepted work. Ticket file visibility itself grants no execution authority; the one-shot approval, exact target and current original-user connector checks remain required.

## Verification

Focused PostgreSQL and browser tests cover the real plan page, removal of browser answer input, mismatched/missing accepted-work refusal, legacy-plan execution refusal, exact bytes and Git promotion. The normal Store gate passed with its named legacy and optional skips.

The installed lab used merged kernel `e94e2851` and application `f7253060`. A new bounded CPU-pressure alert produced ticket `afd22d06` and three completed workflow phases. Its plan retained the accepted work receipt and exact answer SHA-256, matched the alert's observed pod, and served five generated files whose authenticated bytes matched their recorded digests. Sending an extra browser `answer` field returned HTTP 400 without another plan. The core ticket explorer listed the same five derived files among 13 accepted files, with identical download bytes and personal-save selectors. The test did not approve or execute the plan; it removed the lab Job afterward. [Installed receipt](../../deploy/evidence/accepted-work-live.json).
