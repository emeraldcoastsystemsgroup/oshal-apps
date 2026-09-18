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
management or access to another application. Core `@access-admin` and `@access-auditor` remain
separate assignments. Teacher and admin roles are marked sensitive for the core's existing
self-grant and directory-group approval rules.

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
shared asset, six bundled game HTML files, HEAD counterparts, six declared bot IDs and the
Tutor artifact destination. Unknown paths, undeclared tools and undeclared jobs stay denied.
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
