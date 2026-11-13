# Deploying Career

This guide describes the Career 1.60.6 package and the roles it currently
provides. It is intended for an organization or person setting up individual job
searches. Prospective buyers include **outplacement firms, workforce boards and
independent career coaches**. The current product gives each job seeker their
own workspace; shared client case management remains unbuilt.

The [user guide](user-guide.md) follows a job seeker's day. Use this deployment
guide for access, connections and acceptance. It does not install a new role or
change an existing assignment.

## Choose the entry point

- **Career Hunter** supplies Home, Find jobs, My jobs, Applications, résumé and
  experience work, Recruiters, Job market and Settings.
- **Intelligent Career** is the grouped front door. Its manifest resolves its
  required member applications and borrows their admitted surfaces. Read the
  [group setup notes](../../intelligent-career/README.md) before installing it.

Install through the normal oshal application workflow, honoring the package's
declared capabilities, migrations and authorization catalog. Use the package's
matching native kernel. An installation missing the required native matching,
credential or submission interfaces must report that limitation; installing a
new app version alone cannot supply those interfaces.

Open Career from the application launcher. Existing native experience entries
are declared in the [package manifest](../oshal-app.yaml); application and group
access remain subject to the signed-in person's current assignments. Optional
AI Office, Portrait Studio and Social surfaces require their own available,
current access. A missing optional surface is not repaired by widening Career's
permissions.

## Assign the current roles

Use the installation's application role-assignment workflow and review the
current catalog when an update requires it. Existing stale or suspended
assignments need their normal review; avoid substituting a broad platform role.

| Template | Visible role | Use |
|---|---|---|
| `member` | **Job seeker** | Read and change the person's own Career records and run their authorized matching, preparation and application work |
| `admin` | **Job source administrator** | The job-seeker capabilities plus Career's source administration and source-health controls |

The current catalog grants these roles in the **own** scope. Source
administration does not create a right to browse another seeker's résumé,
mailbox, saved jobs or applications. Role names are presentation; the
[authorization catalog](../authorization.yaml) defines the permissions.

### Coaching is a remaining product gap

There is currently **no coach role, seeker-approved coach link, shared caseload
or cross-person pipeline view**. Assigning Job source administrator does not
create those capabilities. The coach design study is read-only planning; it is
not an implemented consent or delegation feature.

A coaching service can deploy individual job-seeker workspaces and work with
material people choose to share through its existing agreed process. Career
does not yet manage that sharing agreement, revocation or access to a client's
workspace. A future coach feature needs explicit seeker consent, limited
readable fields, revocation and original-owner checks before it can be offered
as part of this deployment.

## Review unresolved employer sources

In **Companies → Needs you**, the source administrator prepares one native
human-decision ticket for the current employer decision. **Archive** approves
that exact ticket; **Keep trying** cancels it. Both choices use the application's
native confirmation flow as that original person. Their current own-scoped
Execute grant and source-administrator gate are checked independently of their
platform role. A Job seeker cannot prepare or answer a source decision.

The choice is queued for the next pull; it is not an immediate corpus change.
The writer rechecks the exact action, employer and opening time, and refuses a
source that has recovered, changed or already been answered. The page reports
queued, applied and uncertain states separately. Lost acknowledgements do not
justify creating another ticket or choosing again automatically.

The existing daily source-maintenance job keeps its original administrator.
Its route now also requires the existing `career.execute` effect to prepare a
ticket alongside `career.administer`. Review an outdated activation through the
normal job workflow; the update does not activate or select a replacement owner.
The native kernel must include the first-phase human gate, application-owned
human decisions, bounded original-owner ticket metadata and verified decision
history projection. A ticket's Done or Cancelled status alone cannot authorize
a source change. See [source maintenance](../SOURCE-MAINTENANCE.md).

## Set up each job seeker's workspace

1. Assign **Job seeker** to the person's own identity. Have them sign in and check
   their role, including the phone menu.
2. Add the main résumé through **My résumé**. Confirm indexing actually finished
   and the person can review it.
3. Set matching titles, area and remote preference in **Settings → What I'm looking for**.
   Inspect the saved result rather than assuming a successful button press.
4. Choose whether to enable the person's scheduled matching in Settings. Read
   its enabled state and dated completion result separately from the shared
   source-refresh state.
5. Connect Gmail in **Settings → Accounts** if application-reply monitoring is
   wanted. The monitored mailbox must match the résumé's submission email.
6. Review **Email updates** with the person before enabling or running the
   monitor. Saved authorization alone is not proof of a successful mailbox read.

Native credential custody retains Gmail authorization. Career's Accounts page
reads saved metadata and offers the native sign-in ceremony; it does not copy
tokens into Career preferences. A failed or missing status remains unavailable.
There is no mailbox selector or general account-disconnect control in this
Career section. Optional Social account flows remain in the admitted Social
workspace, and LinkedIn profile work uses the person's signed-in browser.

## Prepare the installation services

The shared source refresh and each person's matching are distinct operations.
On a native installation, the kernel manages the shared corpus writer and
publishes a completed corpus. Career displays its observed progress, source
failures and last successful publication. A running refresh is not a completed
publication, and a successful publication does not prove that every employer
source succeeded. See the native section of the [operations guide](operations.md)
and [source maintenance](../SOURCE-MAINTENANCE.md).

Scoring and document preparation need the configured Career worker and model
service. Verify the actual run result and retained counts. A queued run, missing
worker or unavailable scoring configuration must not be presented as a completed
fit assessment. Use [native run control](../NATIVE-RUN-CONTROL.md) for observation,
stop and recovery behavior. The later API-container sections of the operations
guide describe the legacy deployment and should be read in that context.

Manual application is available through the employer's form and downloaded
documents. Automatic sending additionally needs the separately enrolled,
original-owner **Career submission browser worker**. Follow
[Native submission worker](../NATIVE-SUBMISSION.md), including its supported
installer, exact runtime fingerprint and private configuration. Enrolling that
worker sends no employer application. Approving a job later authorizes its exact
packet; an uncertain final outcome remains held for reconciliation.

## Check the deployment with synthetic records

Before accepting an installation, use a dedicated test identity and synthetic
résumé, job and mailbox fixtures through the installation's normal test process.
Avoid sending a real employer application as a smoke check.

- Verify that a second identity cannot see the first person's résumé, saved
  jobs, application history or goal. Check that source controls require the
  administrator role.
- Open Home, Find jobs, Saved, Getting ready, Applied and Interviewing on a
  phone and a computer. Confirm readable errors, reachable actions and that
  unavailable counts stay distinct from zero.
- Save a fixture job, exercise **Not scored yet → Check my fit**, and verify an
  actual completed or failed check. Text ordering in Find jobs is separate from
  this fit assessment.
- Prepare fixture documents, record a manual application, then an interview
  with a time, offer and closed outcome. Confirm the manual provenance remains
  visible and that the original recorded application still counts in the past
  seven days when its timestamp belongs to that period.
- Connect fixture Gmail only with its owner's authorization. Confirm saved
  authorization and a dated successful mailbox check are shown separately, and
  that connecting does not itself start a check or send mail.
- Where automatic sending is being accepted, use the documented controlled
  employer fixture to check the exact approval, retained confirmation and unknown
  outcome handling. Device presence alone is insufficient evidence of a sent
  application.

Keep acceptance evidence separate from a live person's records. The package's
[Test Lab catalog](../tests/test-lab.yaml) supplies focused regression commands;
the store's required publish gate is described in
[CONTRIBUTING](../../CONTRIBUTING.md).

## Support and delivery limits

Record the installed app and kernel versions, the page, action and time, and the
visible refusal or retained run/submission reference. Follow the installation's
support process for private evidence. Do not collect tokens or unrestricted
mailbox exports as routine diagnostics.

Current limits include the unbuilt coach and consent model, missing optional
application access, the limited fallback search sample reported by the UI, and
services that are not yet configured. The LinkedIn update page must be judged by
its actual result; an approved draft is not proof of a profile change. A package
source change or passing fixture suite is also separate from installing and
verifying that release on a person's device.

<!-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Describe Career 1.60.5 with explicit preparation and Open application recovery. -->

## Saved-job preparation (1.60.6)

The owner-only `application-workflow.json` file holds `{version:1,enabled,mode}`;
missing settings mean OFF with review selected. GET/POST `/application-workflow`
use the existing own read/change permissions. The authorization catalog adds those
two bindings, so existing assignments may require the installation's normal source
review. No role template, migration or schedule is added.

Enabling prepares existing favorites; later favorite writes queue new preparations
inside the admitted owner writer. One `prepare-saved` background engine run processes
each batch sequentially through the existing scoring, source-verification and packet
writers. Each attempt records its choice and generation request with its job. Known
refusals retain a reason; incomplete receipts stay pending with explicit recovery.
Neither automatic reads nor repeat saves retry a stopped attempt. Reads never start
preparation. No submission intent, browser ticket or employer final action is made
by this workflow, even when a submission computer is available.

Review mode binds readiness to current tailoring and exact PDF hashes. Automatic
mode ends at document readiness and an employer link. The separate exact-packet
approval remains required for the connected-browser route. This package does not
supply unattended saved-to-employer submission. Installed native acceptance and the
store gate belong to the release coordinator; the package tests use synthetic stores.

<!-- CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Describe owner preparation consent, authorization review and the ready-only automation boundary for 1.60.6. -->
