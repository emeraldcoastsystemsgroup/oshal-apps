# Little Monsters roles and record access

The package imports `student`, `teacher` and `admin` roles into Access Administration.
Ordinary learners can receive the `student` role instead of the catalog-less `@app-admin`
fallback. Installation imports definitions; it does not assign roles or edit school records.

| Structural role | Functions it opens | Records it can affect |
| --- | --- | --- |
| `student` | Student pages, personal study and flashcard CRUD, quizzes, tutor, uploads, lecture processing/export, personal calendar and notifications, existing class creation/enrollment | Only what the current issuer-bound student identity and existing ownership/enrollment checks permit |
| `teacher` | Student functions plus teaching pages, class changes/deletion, roster, assignments, class flashcard generation and material moderation | Requires an existing teacher/admin school record; each handler still restricts its own classes and current school relationships |
| `admin` | The same declared functions as teacher, with an application admin tier | Requires an existing teacher/admin school record; only the existing school `admin` record role supplies wider same-school record access |

The student's technical tier is `editor` because submitting answers and maintaining personal
study records are writes. The assigned role is still **student**, never platform or swarm
administrator. None of these roles grants Access Administration, provider configuration, swarm
management. The structural roles alone cover Little Monsters; the complete application
composites below also include the declared learning components. Core `@access-admin` and `@access-auditor` remain
separate assignments. Teacher and admin roles are marked sensitive for the core's existing
self-grant and directory-group approval rules.

## Complete application roles (1.4.7)

The native Student, Teacher and School administrator composites are declared in
`oshal-app.yaml` under `authorization.roleTemplates`. Each contains three explicit
application-role mappings: the matching Little Monsters student/teacher/admin role,
AI Office (`presentations:@app-admin`) and Circuit Lab (`circuit-lab:@app-admin`).
Both components are required prerequisites of the complete learning workspace. Access
reviews and applies the whole bundle atomically, with no optional-component selections.
The two compatibility roles apply only to their respective catalog-less applications;
they confer no Access Administration, portal administration or swarm-default management.

The core must support native composites and the `experience-roles` skill. Neither the
school role catalog nor the existing HTTP/bot/artifact bindings changes in this release.
Existing direct grants stay direct; adopting the complete bundle needs a fresh normal
preview and apply. Existing composite upgrades also need a fresh review. Revoke removes
only grants sourced from that composite and retains separately established component roles.

A complete role establishes application permissions. It does not manufacture a school
identity, teacher roster role, enrollment, shared workspace membership or connector token.
Teacher/admin school authority remains governed by the two current checks below. A new
learner follows normal first-entry school setup, then joins the intended classes. Provider
and voice readiness must also be checked before declaring the learning workflow ready.
The retired Google Calendar bridge remains unavailable until its tenant-bound OAuth work
is implemented; additional roles cannot enable that missing integration.

## Two checks, both required

The core checks named structural permissions before invoking a package handler. A new
`teaching` resource adapter also reads the **current exact issuer and subject** from
`lm_students`, requires one unambiguous teacher/admin row with a school, and never writes.
Changing that row to student immediately closes teaching functions even if an old structural
grant remains. Giving a structural teacher/admin role to an ordinary student does not promote
the student or bypass the package's roster gate.

The learner adapter permits an active verified principal through an explicitly granted student
operation before first sign-in. This is necessary for `/me` to reach the existing verified
identity resolution and placeholder-adoption flow. The adapter itself never adopts a placeholder,
creates a student, enrolls a learner or consults a client-supplied role. Existing sign-in behavior,
including its teacher allowlist handling, is unchanged.

The package then checks its own current tenant, teacher relationship, enrollment, material
ownership/moderation, private dashboard scope and final SQL predicates. The structural catalog
does not replace those checks. Its `own` scope refers to the caller's existing school
relationships; it does not mean unrestricted school access. Little Monsters school IDs remain
internal to its roster and are not inferred to be OSHAL business-workspace memberships.

## Covered entry points

The catalog explicitly binds every current HTTP method/path, student and teacher document,
shared asset, six bundled game HTML files, HEAD counterparts, six declared bot IDs and both
artifact destinations: the Tutor hand-off (`tutor.execute`) and File into a class
(`class-material`, which like `POST /import-artifact` requires `material.create` and
`material.share`, because every import files a material and asks to share it). Unknown paths, undeclared tools and undeclared jobs stay denied.
Little Monsters currently declares no callable package tools; filenames under `tools/` are
not new permissions or callable tools. Artifact discovery/bindings do not redeem an artifact
or bypass the existing attachment authorization.

`/lectures/recent` shares the same read permission as `/lectures/:lectureId`, under one binding
to avoid overlapping catalog patterns. Review, home summary and readiness have separate
manifest mounts whose local path is `/`; that binding requires `app.open` and `study.read`.
The existing service-authenticated readiness transport remains subject to the core's checks.
The arcade links exact `index.html` paths; arbitrary game directories and new files are not
implicitly authorized. Catalog validation requires the core's safe literal-filename support
for names such as `education.css` and `index.html`.

## Adoption and verification

Deploying this catalog changes its revision. The core refuses activation with
`authorization_catalog_migration_required` while any assignment for the application references
another catalog revision or installation source. Existing `@app-admin` rows never turn into
a student, teacher or admin role automatically. Revoke the fallback under the **old** catalog;
the new catalog no longer recognizes `@app-admin` as a grantable or revocable business role.

An authorized operator must first review every existing direct grant, group mapping, restriction,
expiry and management assignment, retaining an exact issuer/subject or directory-group migration
plan. Through the old active package's preview/apply workflow, remove the reviewed old-revision
assignments; only then activate the new catalog. This introduces a planned access gap. Review
the new catalog and explicitly apply each intended named role, management role, restriction,
expiry and group mapping before declaring migration complete. Restrictions must not be lost.
If an obsolete role or installation source cannot be addressed through the active management
API, stop and resolve that migration first; do not delete policy rows or bypass the core check.
A platform assignment and a school roster role are two distinct records. Do not bulk-convert
either by matching email addresses or labels.

The new isolated boundary suite is registered as `structural-roles` in AI Test Lab. It uses the
real core validator, preview/apply service, policy, HTTP guard and package adapters against
synthetic in-memory assignments and a read-only roster fixture. It never connects to a real
school database, changes real grants, signs anyone in or invokes providers. With a core checkout
and dependencies available, set `OSHAL_CORE_ROOT` to that checkout and run:

```text
node --test little-monsters/tests/authorization/catalog.test.cjs
```

The existing nine dependency-free security/documentation suites remain registered separately.
Their compiled-route assertions must run after the normal package build. The catalog also
registers four legacy Vitest specs and eight legacy Playwright specs honestly: the former retain
obsolete pre-carve imports, and the latter require reviewed fixtures and a disposable school
stack. They are pending prerequisites, not evidence of passing current browser workflows.
No local test suite runs automatically during installation; only the existing readiness smoke
retains its installation eligibility. Full deployed student/teacher navigation, first sign-in
and role migration are separate acceptance steps, not claimed by the synthetic proof.

Version 1.3.2 was rebuilt through the canonical package builder against the core, producing
40 modules. One catalog-driven run of the ten executable Node recipes passed **88 checks**:
76 existing compiled security/documentation checks and 12 structural-role checks, with no
skips and verified child-process exit. Package validation reported zero warnings. The full
catalog contains 13 recipes covering 22 suite files and the existing smoke; the two legacy
recipe groups and live installation acceptance remain pending as described above.

Version 1.3.3 changed nothing in the role catalog. It fixed how the identity readers obtain
the OIDC issuer: express-openid-connect's default `identityClaimFilter` removes `iss` from
`req.oidc.user` and keeps it on `req.oidc.idTokenClaims`, so the 1.3.2 readers (which read
only `user.iss`) rejected every real browser session with 401 and never reached the legacy-row
issuer adoption; only the PAT and MOCK_OIDC rails put `iss` on `user`, which is why the
mock-backed suites passed. Both readers now call one exported `resolveSessionIssuer`
(`idTokenClaims.iss` when `idTokenClaims` is present, else `user.iss`, mock fallback only
under MOCK_OIDC), and the identity and lecture suites carry the real session shape as cases
(80 compiled checks).

Version 1.4.4 moves the catalog revision: it binds `POST /import-artifact` and the
`class-material` artifact action. The adoption sequence above applies before it activates
wherever assignments already exist.

## Enterprise-authorization pilot (1.4.5): isolated evidence

Little Monsters is the pilot package for core's application authorization (ADR-149). Version 1.4.5
adds three suites and a shared fixture under `tests/authorization/` and registers them in AI Test Lab. It changes no
route, page, migration or catalog byte. `authorization.yaml` is the same as in 1.4.4, so installing
1.4.5 over 1.4.4 needs no new catalog migration.

Everything below is **isolated fixture evidence**. Signed-in multi-user acceptance on an installed
swarm and directory-group rights from a real identity-provider tenant are **not** claimed.

| Test Lab case | Suite | Proves | Lab status |
| --- | --- | --- | --- |
| `authorization-groups-delegation` | `group-delegation.test.cjs` | Directory-group and direct grants differ over the same routes. A group-mapped deny wins over a direct grant. Unmapping revokes. Stale, overage (incomplete), foreign-tenant, future-dated and missing group evidence all refuse. A sensitive teacher/admin group mapping is refused without an approval verifier. The tutor and quiz bots run through core's controller execution guard (`BotNodeClient.execute` and the inline orchestrator): admitted for a granted learner; refused before any endpoint for an unassigned actor, a mismatched subject, an explicit tutor deny, or a grant revoked between queueing and execution | Runnable (core checkout) |
| `authorization-record-rights-postgres` | `record-rights-postgres.test.cjs` | Uses the compiled routes behind core's HTTP guard on PostgreSQL 16, with every package migration applied as a NOSUPERUSER NOBYPASSRLS role. A teacher sees only their own class list, analytics and roster; other classes and the other school are refused. A learner sees only their own dashboard. A teacher sees only their class's share of a learner's aggregates. Roster writes are confined to the teacher's own class. Unassigned, denied and revoked actors are refused before any handler SQL | Pending by Lab design (`engine-container:disposable-postgres`) |
| `authorization-permission-ui` | `permission-ui-browser.test.cjs` | Runs the actual dashboard, teacher and Tutor pages in Chromium on that database: each person sees only their own records; a learner never receives the teacher page; an unassigned person gets core's role-guidance page; a tutor deny refuses the Tutor turn; a mid-session revocation refuses the teacher's next request and navigation | Pending by Lab design (browser runner) |
| `structural-roles` | `catalog.test.cjs` | The existing named-role, binding and HTTP-guard proofs | Runnable (core checkout) |

What is real in these suites:
- the package catalog;
- core's validator, preview/apply service and policy (including the directory-evidence rules);
- the HTTP guard and the controller execution guard;
- the compiled `routes/education-routes.js`;
- the package's own teaching adapter;
- PostgreSQL 16 through core's `DisposablePostgres`, which applies the machine-wide fixture-slot ceiling.

What is doubled, and why:
- The OIDC session: a loopback header picks one synthetic issuer and subject, attached as `req.oidc`.
- The policy store: held in memory. Its PostgreSQL boundary is proven in core `authorization-postgres-integration`.
- The execution-policy port: wired the way core's composition root wires it, minus the durable ownership read, which is proven in the same core suite.
- The bot endpoint: a recorder, so no model, provider or bot node is touched.
- Migration 020: not applied. It only writes the kernel `agents` table, which the suite asserts.

Behavior these suites pin down:
- Once any directory group is mapped for this app, every caller also needs fresh, complete evidence
  from that directory. Without it, even a direct grant is refused with `authorization_directory_unavailable`.
- `/teacher` is not a bare application shell (it needs `teaching.read`), so a learner receives a JSON
  403 rather than the role-guidance page. That page is served for `app.open`-only shells such as `/dashboard`.
- A tutor deny does not remove the Tutor tab: `/class-tool-keys` decides visibility by school role.
  The deny refuses the Tutor turn itself, and the page says it could not connect.

Run the suites with a framework checkout that has its dependencies installed. The PostgreSQL and
browser suites also need Docker and the checkout's Playwright Chromium:

```text
OSHAL_CORE_ROOT=<core checkout> node --test tests/authorization/group-delegation.test.cjs tests/authorization/record-rights-postgres.test.cjs tests/authorization/permission-ui-browser.test.cjs tests/authorization/catalog.test.cjs
```
