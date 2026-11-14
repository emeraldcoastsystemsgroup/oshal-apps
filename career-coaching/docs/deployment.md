# Career Coaching: deployment and what is live

Career Coaching lets a job seeker share a short summary of their job search with one career coach in the same
organization for a few days, and stop sharing in one press. It is a separate package from Intelligent Career
(`career-hunter`), so Career's own records and storage are not changed by it.

## What a coach can see

Only what the seeker reviewed and confirmed, labelled **Seeker-shared snapshot**:

| Always | Only if the seeker turns it on |
|---|---|
| Counts by stage: Saved, Getting ready, Applied, Interviewing, Offer, Closed (a count Career could not read shows as a dash, never as 0) | **Include my applications**: employer, job title, stage and date, up to 25 |
| Applications recorded in the past 7 days | **Add next steps**: up to 3, written by the seeker, 160 characters each, no links |
| The name the seeker chose, when the snapshot was read and shared, and when access ends | |

A coach never gets the seeker's account, résumé, documents, mail, saved searches, notes, job links or any way to
act in Career. Access lasts 1, 3, 7 (default), 14 or 30 days; there is no longer or open-ended option.

## Roles

| Role template | Who | Can |
|---|---|---|
| **Coaching client** (`seeker`) | A job seeker who will share | Share a summary, confirm it, see who has access, stop sharing |
| **Career coach** (`coach`) | A coach | Get, replace or turn off their coach code; read summaries shared with them; stop viewing one |

There is no administrator role, and platform administration gives no coaching access.

A client's page reads their own Career counts, so a client also needs Intelligent Career's **Job seeker** role. A
person who already has it needs nothing more. For a person who does not, the **Coaching client** bundle can give it
in the same assignment: on **Application access**, tick **career-hunter** under **Optional components** before
**Assign role**. A client without Career access can still share; each count Career does not give them is shared as
unknown.

The **Career coach** bundle gives nothing in Career. A coach reads only what clients shared with them, and the
kernel refuses the **career-hunter** tick on that bundle.

That is why Career is an optional application of this package (since 0.1.2). The kernel loads a package only when
every role bundle maps the package itself and every application it requires, so requiring Career would have put
Career access into the coach's bundle. 0.1.1 required Career, mapped it in neither bundle, and was refused at its
first load.

## How sharing works

1. The coach opens **Shared with me** and presses **Get my code** (for example `K7QM-4XPD-9TRA`). The code only lets
   a client name them as the recipient; it gives the coach nothing. **New code** replaces it; **Turn off** stops new
   shares (existing ones continue until they end).
2. The seeker opens **Share with a coach**, enters the code, chooses **Access ends after** and the two optional parts,
   and presses **Review**. The page reads the seeker's own Career counts in their session; the server resolves the
   exact code to one coach in the same organization and keeps the preview for 10 minutes.
3. The seeker presses **Share**, then **Share** again in the confirmation. That is the kernel's own human gate: a
   one-use confirmation and the seeker's decision on their own approval ticket. Only the kernel's owner-verified
   decision for that exact preview makes the share.
4. **Stop sharing** (seeker) ends access at once and deletes the snapshot. **Stop viewing** (coach) removes it from
   the coach's list only.

## Two things an operator must know before this is useful

### 1. The relationship policy must be installed for the organization

On the native kernel every package table is a private copy per person unless an operator installs the package's
relationship policy for the tenant. Without it a seeker cannot find any coach's code ("No coach in your
organization has that code") and nothing is shared. The policy is `storage/relationships.json` in this package. It
must be installed as the document `active` in the collection `pkg:career-coaching:__sql_policy` of the tenant scope.
Package code never writes that collection. The kernel repository's operator command does it, from the kernel
checkout's `ops` folder (it prepares and prints what it would do; `--apply` writes):

```
python3 install_relationship_policy.py --package career-coaching \
  --policy <store>/career-coaching/storage/relationships.json --container <the installation's PostgreSQL container> --apply
```

Install it before the package is delivered. Installing it later leaves the rows people already wrote in their own
scope unreachable; the command reports how many such rows exist (`rows_in_other_scopes`).

### 2. Coach viewing needs a kernel with the `person.status` read

A coach reads as themself, and the kernel checks that the coach is an active person. Before the package shows a
snapshot it also asks the kernel whether the **seeker** is still an active member of the same organization, through
the kernel's `person.status` read, which this package declares as `person-status.read`. The kernel answers only
`active` or `inactive` for one exact person (native id, issuer and subject); a suspended, deactivated or removed
seeker, and anyone of another organization, is `inactive`, and that seeker's snapshot is left out of the coach's
list while their other clients still show.

On a kernel that does not have the read (before kernel commit `0a93fe93` on `dev/native-parity`, 2026-11-14) the
package is not linked it. Then **Shared with me** says "Shared snapshots can’t be shown yet", no snapshot leaves the
server, and the seeker's page says "Your coach can’t open shared snapshots on this installation yet." Sharing,
confirming and stopping work either way. Deliver the package after the kernel that has the read is running, so the
kernel links the declared capability when it installs the package.

## Proof

| Suite | What it proves |
|---|---|
| `tests/coaching-routes.test.cjs` | The routes: success, every refusal, ownership, cancellation, confirmation, lost answers, fail-closed |
| `tests/projection.test.cjs` | The snapshot rules and the page's builder |
| `tests/declarations.test.cjs` | Catalog, policy, migration, manifest and source boundary |
| `tests/red-before.test.cjs` | Each refusal guard goes red when removed |
| `tests/browser/coaching-page.browser.cjs` | The page in Chromium at phone and desktop sizes |
| kernel `crates/oshald/tests/career_coaching_relationships.rs` | This package's policy and routes on the real interpreter and a disposable database, and a coach opening an active seeker's snapshot and nothing of a suspended one |
| store `scripts/role-template-coverage.test.mjs` | Every role template in the store maps its own application and every required application, the kernel's load rule; red on 0.1.1's declaration |
| kernel `crates/oshald/tests/person_status_read.rs` | The `person.status` read itself through the real package bridge: active, suspended, deactivated, unknown, another tenant, an undeclared package |

Run the package suites from this folder: `node --test "tests/*.test.cjs"` and
`node --test tests/browser/coaching-page.browser.cjs` (needs `npm ci --prefix scripts/toolchain` at the store root).
