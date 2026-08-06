# Little Monsters — School Deployment Guide

A professional guide to deploying **Little Monsters** (the oshal K-12 study companion) in a
school, with **Microsoft 365 / Entra ID** sign-in, class enrollment, and a privacy model that
keeps each student's data private while sharing class materials with the right students.

> Status: email-domain tenant isolation is implemented at the application layer. Full
> district administration and database RLS from
> [ADR 035](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/035-multi-tenant-saas-foundation.md)
> are not yet built; use one instance per
> school when database-level isolation is required.

---

## 1. What students, teachers, and admins see

The data model is **shared-vs-private**, enforced by tenant, current enrollment/ownership, and the
authenticated identity (never a client-supplied student id). Package security tests exercise both
schools and every role against the compiled runtime routes:

| Data | Visibility |
|---|---|
| **Class info, teacher-published lectures/slides, class flashcard sets, assignments, class calendar** | **Shared** — visible to enrolled students, the owning teacher, and an admin in the same tenant. |
| **Uploaded material** | **Private by default.** A student may request sharing; classmates and class-wide tutor grounding see it only while the owning teacher/admin has marked it `approved`. The uploader retains private access after denial. |
| **Private flashcard sets, XP, level, streak, SM-2 progress, quiz attempts/results, personal calendar** | **Private** — scoped to the authenticated student. |
| **A student's dashboard** | The student themselves; the owner of an active class in which the student is enrolled; or an admin in the same tenant. Unrelated and cross-tenant callers receive the same non-oracular 404. |

A student who is **not enrolled** in a class is denied (normally HTTP 403; by-id privacy surfaces
may use HTTP 404 to avoid revealing existence), and the class never appears in their list. A
student cannot read or mutate another student's private progress.

Roles: `student` (enrolled access), `teacher` (owned classes, plus any class in which they are
separately enrolled), and `admin` (all classes inside their own tenant). Role is assigned from the
`LM_TEACHER_EMAILS` allowlist on first sign-in or set directly in `lm_students.role`.

---

## 2. Sign in with Microsoft (Entra ID)

oshal authenticates via OIDC, so Microsoft Entra ID (Azure AD) — the identity most K-12 schools
already run with Microsoft 365 Education — plugs in directly.

### 2.1 Register the app in Entra

1. Entra admin center → **App registrations → New registration**.
2. Redirect URI (Web): `https://<your-oshal-host>/callback`.
3. Note the **Application (client) ID** and **Directory (tenant) ID**.
4. **Certificates & secrets → New client secret** — copy the value.
5. **API permissions** → Microsoft Graph → delegated: `openid`, `profile`, `email`
   (add `User.Read` if you later sync rosters). Grant admin consent.

### 2.2 Point oshal at Entra

Set these (in `.env` or the container environment) and **unset** `MOCK_OIDC`:

```bash
OIDC_ISSUER_URL=https://login.microsoftonline.com/<TENANT_ID>/v2.0
OIDC_CLIENT_ID=<APPLICATION_CLIENT_ID>
OIDC_CLIENT_SECRET=<CLIENT_SECRET>
SESSION_SECRET=<a long random string>
APP_URL=https://<your-oshal-host>
LM_TEACHER_EMAILS=teacher1@yourschool.edu,teacher2@yourschool.edu
```

That's the whole identity integration — no code changes. Keycloak (self-hosted) remains
supported by leaving `OIDC_ISSUER_URL` unset and using the `KEYCLOAK_*` vars; `MOCK_OIDC=true`
remains the no-IdP local-dev path.

On first sign-in, a student's Entra account is auto-provisioned as an `lm_students` row. The
account key is the exact verified OIDC **issuer plus subject** pair, `(iss, sub)`; `sub` by itself
is not globally unique across identity providers. A roster email can link only to an unbound
placeholder in the same tenant (or a one-time same-tenant legacy row), under transaction and
advisory locks. A different issuer/subject cannot take over a bound email account.

Production requests fail with HTTP 401 if the authenticated identity lacks either `iss` or `sub`.
The synthetic issuer fallback exists only while `MOCK_OIDC=true` is explicitly enabled for local
development. Once any tenant domain is configured, an unmapped email domain fails closed instead
of falling into the default tenant.

---

## 3. Set up classes and enroll students

Students self-provision on login, but **classes and enrollments** are created by a teacher/admin.

```bash
# Create a class (returns { classId })
curl -X POST https://<host>/api/education/classes \
  -H 'Content-Type: application/json' \
  -d '{"name":"Biology I","subject":"science","teacherName":"Ms. Parker","gradeLevel":"9"}'

# Enroll or pre-provision a student by email (class owner / tenant admin only)
curl -X POST https://<host>/api/education/classes/<class-uuid>/students \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@yourschool.edu"}'
```

The older ID-based `POST /students` and `POST /enroll` routes are retired and return HTTP 410.
Use only the class-scoped roster endpoint above; it verifies class ownership, class state, and
tenant before provisioning or enrolling anyone.

Upload class material through the cockpit **+ Add Class → Textbook** or
`POST /api/education/upload-material`. Files are private to the uploader unless an owning teacher
or tenant admin approves sharing.

### 3.1 Security-sensitive service contracts

| Boundary | As-built contract |
|---|---|
| **Material upload** | One file, at most **10 MiB**; at most **50 MiB per authenticated student per rolling 24 hours**. A transaction-scoped advisory lock serializes concurrent quota checks. Storage uses random exclusive filenames, derives the media type from bytes, and verifies real-path containment before later reads/deletes. |
| **Material RAG** | Every successfully grounded material uses its own `lm-material-<uuid-without-dashes>` collection; a file with no extractable text may have no collection. Tutor lookup selects only the caller's own rows or currently `approved` rows in an accessible class. Share/delete operations lock the live class, actor, material, and same-tenant uploader. Denial removes class-wide visibility immediately. Deletion removes the exact collection, when present, and contained file; an external failure aborts SQL pointer removal for a retry. |
| **Class/private study sets** | Only the owning teacher/admin can create or mutate class-wide sets; enrolled students can read them. A private set carries `owner_student_id` and is visible only to that student. Historical null-class rows with no trustworthy owner remain inaccessible. |
| **Generated quiz** | The response contains public question text/options plus an `attemptId`, never `correctIndex`. Full questions remain server-side for **30 minutes**. Submission accepts only the attempt id and answer indexes, locks and grades the tenant-bound attempt once, persists the result, and awards idempotent server-derived XP. |
| **Lecture artifacts** | Teacher/admin writes are tenant-and-class-owner gated before filesystem, speech, RAG, model, ticket, or database work. Audio types are detected from bytes, filenames are random/exclusive, persisted paths are containment-checked, and API projections do not expose internal paths. Enrolled users retain read access. |
| **Calendar/notifications** | Personal events/reminders are student-bound; shared events require current class access. Notification targeting is self, same-tenant admin, or a student in an active class owned by the teacher. Final SQL predicates and row locks recheck those relationships at mutation time. |
| **Google Calendar** | Authenticated `status`, `push`, and `pull` calls intentionally return **HTTP 410** and code `TENANT_CALENDAR_CREDENTIALS_REQUIRED`. The controller's shared OAuth profile is not reused; the bridge remains off until OAuth credentials and remote calendars are tenant-bound. |

> **Roster automation (roadmap):** Microsoft **School Data Sync** / Graph Education
> (`/education/classes`, `/education/me/classes`) can become the source of truth for classes +
> enrollments so this is automatic. Not built yet — enroll via the API/cockpit for now.

---

## 4. Install & run

```bash
git clone <repo> oshal && cd oshal
bash scripts/install.sh --with-keys     # build → up → self-verify (see INSTALL.md)
```

- **LLM**: the tutor/flashcards/quiz/lecture features use Claude (`ANTHROPIC_API_KEY`, or the
  cockpit Claude sign-in). Set the key before `--with-keys`.
- **Data stores**: Postgres (identity/tenant/classes/progress), Redis (swarm mesh), and ChromaDB
  (legacy class textbook/lecture collections plus exact per-material and collision-resistant
  private/shared collection names).
- **Verify**: run the platform health checks, then from this package run
  `node --test "tests/*.test.cjs"` and expect all 60 security tests to pass. Browser/e2e specs
  remain under `tests/*.spec.ts` for a deployed swarm.

---

## 5. Privacy & compliance (for your privacy officer)

K-12 student data triggers **FERPA** and, for under-13s, **COPPA** (the school consents as the
"school official"), plus state laws. Before a production rollout:

- **Sign a DPA** with the operator; the SDPC standard DPA is what most districts use.
- **Anthropic is a subprocessor.** Lecture transcripts and tutor chats are sent to Anthropic for
  processing. Use Anthropic's zero-retention/DPA terms and disclose Anthropic in your subprocessor
  list. (Browser speech-to-text keeps audio on the device; only text is sent.)
- **Encryption**: terminate TLS at your load balancer; encrypt Postgres at rest.
- **Data subject rights**: material and class deletion lock the relevant class/material rows, remove
  exact per-material RAG collections and contained files, and only then delete their SQL pointers.
  If external cleanup fails, relational deletion aborts and the pointer remains for a safe retry.
  Deleting a student row removes relational private progress under the installed foreign keys,
  but raw SQL cannot orchestrate external storage: first delete that uploader's materials (or
  their classes) through the application lifecycle, then remove the student row.

Full posture and the multi-tenant/compliance plan:
[ADR 035](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/035-multi-tenant-saas-foundation.md).

---

## 6. Operations

- **Logs**: `docker compose -f docker-compose.oshal-local.yml logs -f oshal-api`.
- **Backups**: nightly `pg_dump` of the `oshal` database + snapshot the ChromaDB volume.
- **1.0.9 upgrade preflight**: each case-normalized email domain belongs to exactly one
  `lm_tenants` row, and every enrollment must join a student and class from the same tenant.
  Activation fails closed instead of silently choosing or backfilling across an ambiguous school
  boundary. Migration 037 must also install both append-only audit triggers. Audit all invariants
  before upgrading:

  ```sql
  SELECT lower(domain) AS domain, array_agg(tenant_id) AS tenants
    FROM lm_tenants
   WHERE domain IS NOT NULL
   GROUP BY lower(domain)
  HAVING COUNT(*) > 1;

  SELECT e.student_id, e.class_id, s.tenant_id AS student_tenant,
         c.tenant_id AS class_tenant
    FROM lm_enrollments e
    JOIN lm_students s ON s.student_id = e.student_id
    JOIN lm_classes c ON c.class_id = e.class_id
   WHERE s.tenant_id <> c.tenant_id;

  SELECT tgname
    FROM pg_trigger
   WHERE tgrelid = 'lm_authorization_audit'::regclass
     AND tgname IN ('lm_authorization_audit_stamp_trigger',
                    'lm_authorization_audit_immutable_trigger')
     AND NOT tgisinternal;

  -- After confirming the correct school, make every other mapping distinct or unmapped:
  UPDATE lm_tenants SET domain = NULL WHERE tenant_id = '<duplicate-tenant-id>';
  ```

  Do not pick a tenant arbitrarily. Identities or enrollments already attached across the wrong
  school boundary require an operator-reviewed data correction before activation. Migration 032
  intentionally leaves historical `external_issuer` values null; a verified same-tenant sign-in
  may adopt a matching legacy subject exactly once.
- **Windows host gotcha**: if `localhost` pages hang while `docker ps` is healthy, a stale
  `wslrelay.exe` is squatting `[::1]` — `Stop-Process -Name wslrelay -Force`
  ([runbook](runbook.md)).
- **Hardening history / deferred platform work**:
  [core hardening backlog](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/backlog/hardening.md).

---

## 7. Current limitations (as-built, honest)

- **Tenant isolation is application-enforced, not PostgreSQL RLS.** Email-domain mapping supports
  multiple schools; route predicates, enrollment/quiz composite foreign keys, and tenant-binding
  triggers enforce the application boundary. Full district administration and the database-RLS
  design in ADR 035 are not built. Operators requiring database-level defense in depth should
  still deploy one instance per school.
- **Rostering is manual** (API/cockpit). Microsoft Graph Education / School Data Sync auto-rostering
  is roadmap.
- **Google Calendar synchronization is deliberately unavailable.** Status, push, and pull return
  HTTP 410 until tenant-scoped OAuth credential and external-calendar ownership are implemented.
  Little Monsters' internal personal/class calendar remains available.
- **Authorization is application code plus database invariants.** Dashboards, rosters, class bank,
  lectures, materials, flashcards/quizzes, assignments, notifications, calendars, tutor grounding,
  and analytics are tenant/role/enrollment scoped. High-risk writes use final-SQL relationship
  predicates; multi-row operations use transactions and relationship locks. The legacy ID-based
  roster endpoints return 410 without touching the database.
- **Student experience (2026-06-27).** The student build — master calendar, the Flashcards hub
  (create/edit/study), the toolkit (Formula Lab / STEM / Citations / Timelines / My Files), a
  six-game arcade that scores into XP, and the rewards → collection → equippable-avatar loop — is
  live. See
  [ADR 075](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/075-little-monsters-onboarding-and-enhancements.md).
