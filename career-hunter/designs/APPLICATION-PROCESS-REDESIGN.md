# Career process redesign

Status: implemented in Career 1.47, October 28, 2026. Production uses the
four destinations and dedicated application page described below. The HTML
walkthrough remains a fictional design aid; production evidence is recorded
in JOURNEY-DELIVERY.md.

## Purpose

Help someone find work they want, choose which jobs to pursue, produce truthful
applications, send them deliberately, and follow the outcome. Each screen must
answer: Which job am I working on? What has happened? What do I do next?

The previous implementation mixed recommendations, saved jobs, generated
documents and submission execution in overlapping lists. Renaming buttons and
moving panels did not resolve those competing purposes. The redesign starts
with the person's decisions, then maps existing capabilities into that process.

## Four destinations

| Destination | Person's decision | Main action | Result |
| --- | --- | --- | --- |
| Search jobs | Is this opening worth pursuing? | Save to Job Board | Saved and starred; assessment starts; documents are not generated. |
| Job Board | Which saved job do I want to apply for? | Prepare application | Opens a dedicated application page for that job. |
| Prepare & submit | What should I send, and am I ready to send it? | The current preparation step | Tailor → generate → review documents → review application → approve submission. |
| Application status | What happened, and what needs my attention? | Follow up or prepare for interview | Confirmation, exact submitted documents, email updates and interview work stay together. |

The preparation list is an index of unfinished applications. The work itself
opens on a dedicated page with the job identity always visible. There is no
second list of jobs beside the résumé and no expanded card to hunt for.

Recommendations belong in Search, alongside open searching. The Job Board is
the person's shortlist. Saving and starring are one operation. Existing saved
and historical records require an explicit migration plan; redesigning the
interface must not delete or silently reclassify them.

## One application, carried through the process

1. **Tailor.** Show the employer requirements, the core résumé source, a short
   tailoring field and optional additional experience. The core résumé is
   unchanged. The experience library supports recorded projects, independent
   product work such as OSHAL, teaching and other work. Entries are selected for
   this job rather than inserted into every application.
2. **Generate.** Reassess against the full job description and selected verified
   experience. Produce the résumé and cover letter. Display actual saved fit
   evidence, gaps and assessment time; never imply a hiring probability.
3. **Review documents.** Automatically open the generated version. One viewer,
   Résumé/Cover letter tabs, one Download PDF action and one Edit action. Changing
   tailoring or selected experience makes the previous packet out of date.
   Continue is unavailable until regeneration succeeds. Direct document edits
   produce a new reviewable version.
4. **Review and approve submission.** Show the employer destination, exact
   document version, applicant facts, answers and submission-browser readiness.
   Approve & submit authorizes that packet once. Worker setup appears here when
   it blocks submission, not across search and comparison screens.
5. **Execute and track.** Display progress for this application. Employer questions
   return to the same application. After confirmation, automatically open that
   job's Application status record and activate/verify email monitoring. The
   person does not have to find the job in another list.

Interview preparation appears after submission, alongside the submitted
application and employer updates. Submitted documents are an immutable,
read-only record; editing a future draft cannot overwrite what was sent.

## Recovery is part of the process

| Situation | What the person sees | Available next action |
| --- | --- | --- |
| Generation fails | Saved notes, selected experience, failure reason; previous packet retained | Retry generation. An earlier packet can only be used after explicitly choosing and reviewing that version. |
| Browser unavailable | Documents ready; connection is the only blocker | Connect browser, then return to the same submission review. |
| Employer asks questions | Application not yet submitted; questions displayed | Answer → review updated application → approve the exact attempt. |
| Connection is lost before final submission | Durable execution state, not a fresh blank application | Synchronize and resume the existing approved work if still valid. |
| Final submission outcome is uncertain | Outcome needs checking; retained activity and packet | Check employer history/confirmation and reconcile. No automatic retry or duplicate final action. |
| Approval expires or approved data changes | Review required; explanation of what changed | Renew approval for the current exact packet through supported cancellation/renewal transitions. |
| Manual submitted mark was a mistake | Manual provenance and correction history | Return to preparation only when no native submission evidence exists. |
| Employer email is ambiguous | Needs review, with candidate applications | Ask the person to associate it; do not silently change an unrelated job. |

## Search and shortlist behavior

- Text search covers title, company and full description at the top of Search.
  Local radius and fully remote choices are distinct; local distance can affect
  ranking without removing fully remote opportunities.
- Pay uses a range and an explicit basis. Employer-listed and estimated pay
  remain distinguishable. Adjunct per-course compensation must not become a
  fictitious annual salary.
- Read posting, fit and source dates without losing the search or scroll position.
  Saved jobs retain a route back to the same application.
- Not interested supports this opening, company, title phrase, location or
  category/keyword, with visible reversible preferences.
- Saving a search is a compact secondary action. Pagination, dynamic loading and
  duplicate handling must not reset a person's reading position.

## Implementation boundary and acceptance

Keep the existing owner authorization, original-owner storage, packet binding,
submission ledger, retained confirmation and uncertain-outcome protections.
Create one application view model from the saved job, assessment, draft,
document revision, approved intent and outcome. Those are separate records,
not interchangeable meanings of one status column.

Persist tailoring drafts and selected experience per owner/job in the backend.
Browser memory can improve responsiveness but cannot be the only copy. Give
each application a direct link and preserve filters/scroll when returning to
lists. Production implements durable drafts, outdated-document gates, conservative
approval renewal and confirmation reconciliation. These are tested against
the application modules and the native workflow; the walkthrough itself
does not provide the production implementation.

Acceptance is a continuous journey with a newly saved opening, an existing
draft resumed after a reload, and each recovery path above. A happy-path button
test alone is insufficient. Verify on the real bare-metal deployment with a
disposable employer fixture; no real employer application is sent as a test.

Interactive source:
`/home/oshal-maintainer/Documents/projects/oshal-kernel/work/career-process-redesign/career-journey.html`.
The source uses fictional data and performs no network or employer actions.

Walkthrough validation: six interaction paths passed with all network requests
blocked: normal preparation/submission, generation failure/retry, unavailable
worker/reconnection, employer questions/review, uncertain outcome held without
resubmission, and an interview email update. Description search and 320-pixel
layout were also checked. Evidence: `/tmp/career-process-design-proof.log`.
These are prototype checks, not proof of a production implementation.
