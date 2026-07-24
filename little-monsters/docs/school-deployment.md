# Little Monsters — School Deployment Guide

A professional guide to deploying **Little Monsters** (the OSHAL K-12 study companion) in a
school, with **Microsoft 365 / Entra ID** sign-in, class enrollment, and a privacy model that
keeps each student's data private while sharing class materials with the right students.

> Status: single-school (single-tenant) deployment. Multi-district hosting is designed in
> [ADR 035](../adr/035-multi-tenant-saas-foundation.md) and not yet built — run one instance per
> school for now.

---

## 1. What students, teachers, and admins see

The data model is **shared-vs-private**, enforced by enrollment and the authenticated identity
(never a client-supplied id — verified by `tests/education-access-control.spec.ts`):

| Data | Visibility |
|---|---|
| **Class info, textbooks/lectures, flashcard sets, slides, quizzes, assignments, calendar** | **Shared** — visible to every student **enrolled** in that class (and the class's teacher). |
| **XP, level, streak, flashcard progress (SM-2), quiz results** | **Private** — only the student themselves. |
| **A student's dashboard** | Only that student. Teachers/admins may view a student in their classes. |

A student who is **not enrolled** in a class receives **HTTP 403** on every one of that class's
shared-material endpoints, and the class never appears in their list. A student can never read
another student's private progress.

Roles: `student` (enrolled access), `teacher` (their taught classes), `admin` (all). Role is
assigned from the `LM_TEACHER_EMAILS` allowlist on first sign-in (or set directly in `lm_students.role`).

---

## 2. Sign in with Microsoft (Entra ID)

OSHAL authenticates via OIDC, so Microsoft Entra ID (Azure AD) — the identity most K-12 schools
already run with Microsoft 365 Education — plugs in directly.

### 2.1 Register the app in Entra

1. Entra admin center → **App registrations → New registration**.
2. Redirect URI (Web): `https://<your-oshal-host>/callback`.
3. Note the **Application (client) ID** and **Directory (tenant) ID**.
4. **Certificates & secrets → New client secret** — copy the value.
5. **API permissions** → Microsoft Graph → delegated: `openid`, `profile`, `email`
   (add `User.Read` if you later sync rosters). Grant admin consent.

### 2.2 Point OSHAL at Entra

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

On first sign-in, a student's Entra account is **auto-provisioned** as an `lm_students` row
(matched by the stable `sub`, then email). No manual account creation.

---

## 3. Set up classes and enroll students

Students self-provision on login, but **classes and enrollments** are created by a teacher/admin.

```bash
# Create a class (returns { classId })
curl -X POST https://<host>/api/education/classes \
  -H 'Content-Type: application/json' \
  -d '{"name":"Biology I","subject":"science","teacherName":"Ms. Parker","gradeLevel":"9"}'

# Enroll a student (by their lm_students.student_id, looked up after they first sign in)
curl -X POST https://<host>/api/education/enroll \
  -H 'Content-Type: application/json' \
  -d '{"studentId":"<student-uuid>","classId":"<class-uuid>"}'
```

Upload the class's textbook (PDF) so the tutor, flashcards, and quizzes ground in it — via the
cockpit **+ Add Class → Textbook**, or `POST /api/education/upload-material`.

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
- **Data stores**: Postgres (students/classes/progress), Redis (swarm mesh), ChromaDB (per-class
  textbook/lecture RAG, isolated by `lm-class-{id}-*` collections).
- **Verify**: `OSHAL_BASE=https://<host> bash scripts/oshal-local-checks.sh` (15-point), and the
  access-control suite (`tests/education-access-control.spec.ts`).

---

## 5. Privacy & compliance (for your privacy officer)

K-12 student data triggers **FERPA** and, for under-13s, **COPPA** (the school consents as the
"school official"), plus state laws. Before a production rollout:

- **Sign a DPA** with the operator; the SDPC standard DPA is what most districts use.
- **Anthropic is a subprocessor.** Lecture transcripts and tutor chats are sent to Anthropic for
  processing. Use Anthropic's zero-retention/DPA terms and disclose Anthropic in your subprocessor
  list. (Browser speech-to-text keeps audio on the device; only text is sent.)
- **Encryption**: terminate TLS at your load balancer; encrypt Postgres at rest.
- **Data subject rights**: deleting a class cascades its materials; deleting a student row removes
  their private progress.

Full posture and the multi-tenant/compliance plan: [ADR 035](../adr/035-multi-tenant-saas-foundation.md).

---

## 6. Operations

- **Logs**: `docker compose -f docker-compose.oshal-local.yml logs -f oshal-api`.
- **Backups**: nightly `pg_dump` of the `oshal` database + snapshot the ChromaDB volume.
- **Windows host gotcha**: if `localhost` pages hang while `docker ps` is healthy, a stale
  `wslrelay.exe` is squatting `[::1]` — `Stop-Process -Name wslrelay -Force`
  ([runbook](runbook.md)).
- **Hardening status / known gaps**: [docs/backlog/hardening.md](../backlog/hardening.md).

---

## 7. Current limitations (as-built, honest)

- **Single school per instance.** Multi-district tenancy (RLS, per-tenant isolation) is designed
  in ADR 035, not built — run one deployment per school.
- **Rostering is manual** (API/cockpit). Microsoft Graph Education / School Data Sync auto-rostering
  is roadmap.
- **Access control covers the primary surfaces.** Reads — dashboard (own data only), class
  list/info, lectures, recent-lectures, and **flashcard sets + cards** (the latter gated as of the
  2026-06-27 review) — are enrollment-gated. Writes — XP, quiz results, flashcard (SM-2) review,
  **flashcard create/edit/delete**, and **rewards box-open** (atomic, server-authoritative) —
  record against / are gated to the **authenticated** student, so a student cannot affect
  another's data. Known remaining holes (pre-existing, tracked in the hardening backlog + ADR-075
  review section): `GET /student/:studentId/dashboard` lets a teacher read any student, and
  `POST /enroll` / `POST /students` are unauthenticated and trust a client `studentId` — both need
  a broader authz pass. A few secondary metadata endpoints (assignments, notifications, calendar
  create) still trust their inputs; extend the `assertClassAccess`/`resolveAuthedStudent` pattern there.
- **Student experience (2026-06-27).** The student build — master calendar, the Flashcards hub
  (create/edit/study), the toolkit (Formula Lab / STEM / Citations / Timelines / My Files), a
  six-game arcade that scores into XP, and the rewards → collection → equippable-avatar loop — is
  live. See [adr/075-little-monsters-onboarding-and-enhancements.md](../adr/075-little-monsters-onboarding-and-enhancements.md).
