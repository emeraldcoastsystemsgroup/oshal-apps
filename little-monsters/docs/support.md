# Little Monsters — Support, FAQ & Troubleshooting

Where to get help, answers to common questions, and fixes for the problems people actually hit.
Organized by who you are. As-built as of 2026-08-06 (package 1.0.9).

> Related: [User Guide](user-guide.md) · [Installation](installation.md) · [School Deployment](school-deployment.md) · [Runbook](runbook.md) · [All docs](README.md)

---

## How to get help

| You are a… | Start here |
|---|---|
| **Student** | Ask the floating **Little Monster Expert** (the tutor bubble) — it's there on every screen. For account/access problems, tell your teacher. |
| **Teacher** | Check the [User Guide → For teachers](user-guide.md#for-teachers) and the [School Deployment Guide](school-deployment.md). For setup issues, contact your school's oshal administrator. |
| **Administrator / operator** | Use the [Troubleshooting](#troubleshooting-administrators) section below and the [Runbook](runbook.md). File bugs/feature requests as repository issues. |

When reporting a problem, include: what you were doing, what you expected, what happened, whether
it's the **local** install or the **public tunnel**, and whether a **hard refresh** (Ctrl+Shift+R)
changed anything.

---

## FAQ — Students

**How do I earn a mystery box?**
By **leveling up**. You gain XP from studying, flashcards, and games; each level you reach grants
one box. There are no free boxes — you earn them.

**I opened a box and got a duplicate. What happens?**
You get a small XP bonus instead of a repeat item, so a box is never wasted.

**Why can't I see one of my classes?**
You only see classes you're **enrolled** in. If a class is missing, ask your teacher to enroll you
(it shows up after they add you and you sign in).

**The camera button isn't doing anything.**
The tutor's camera asks your browser for permission first — choose **Allow**. If your device or
browser blocks the camera, use the **upload** button to send a photo you already took instead.

**Read-aloud isn't playing.**
Make sure your device isn't muted and the volume is up. Read-aloud uses your browser's audio; if a
page was open a long time, refresh and try again.

**Can other students see my work or my score?**
No. Classmates cannot see your XP, level, streak, flashcard progress, quiz results, private study
sets, personal calendar, or monster collection. Your teacher can view your dashboard only while
you are enrolled in an active class they own, and an administrator is limited to your school
tenant. Class-wide content is shared only with current class members. Your own uploaded material
remains private unless the class teacher/admin approves the share request.

**The tutor won't just give me the answer.**
That's by design — it coaches you to the answer with hints, a similar practice problem, or
questions. It's helping you actually learn it.

**A game I'm playing froze or I want to stop.**
Every game has an **I'm done** button on the game-over screen that returns you to the arcade, and
**Play again** to retry. If a game looks stuck, refresh the page.

---

## FAQ — Teachers & Administrators

**How do students sign in?**
With their **school Microsoft account** (Entra ID / Microsoft 365). Their account is
auto-provisioned on first sign-in — no separate account creation. Little Monsters binds the exact
OIDC issuer and subject pair, not an email or subject alone. A pre-provisioned roster email can be
claimed only by an unbound account in the same school tenant.

**How do I add a class and enroll students?**
A teacher/admin creates the class and enrolls students (students self-provision on login, but
classes and enrollments are made by you). Steps and the API calls are in the
[School Deployment Guide → Set up classes and enroll students](school-deployment.md#3-set-up-classes-and-enroll-students).

**How do I make the tutor and flashcards use our textbook?**
**Upload the class textbook (PDF)** — via the cockpit's **+ Add Class → Textbook** or
`POST /api/education/upload-material`. The tutor, auto-generated flashcards, and quizzes for that
class ground in the uploader's private copy immediately. To share it with classmates, request
sharing and have the owning teacher/admin approve it. Approval changes retrieval eligibility;
each successfully grounded file uses its own RAG collection so denial or deletion cannot leave
its text mixed into another material's collection.

Uploads are limited to **10 MiB per file** and **50 MiB per student in a rolling 24-hour window**.
Concurrent uploads are serialized around that quota rather than racing independent checks.

**Can a student reveal the generated quiz answers or submit a made-up score?**
The generator returns question text/options and an opaque attempt id, not the answer key. The
server keeps the full attempt for 30 minutes, accepts answer indexes once, computes the score,
persists it, and awards deduplicated XP. A completed attempt returns 409 on replay; an expired one
returns 410.

**Is there automatic rostering from Microsoft?**
Not yet. Microsoft School Data Sync / Graph Education auto-rostering is on the roadmap; for now
enroll via the cockpit or API.

**Can one server host several schools?**
Yes at the application layer: each configured email domain maps to one tenant, and routes plus
database enrollment/quiz constraints keep schools separate. PostgreSQL RLS and full district
administration are not built. Deploy one instance per school when database-level isolation is a
required defense-in-depth control.

**What about student privacy / FERPA / COPPA?**
The model keeps each student's progress private and shares only class materials with enrolled
students. Before a production rollout, work through the
[Privacy & compliance checklist](school-deployment.md#5-privacy--compliance-for-your-privacy-officer)
with your privacy officer — note that **Anthropic processes** lecture transcripts and tutor chats
as a subprocessor.

---

## Troubleshooting (Administrators)

Condensed fixes for the most common operational issues. The [Runbook](runbook.md)
has the full diagnostics.

### Pages hang / ribbon empty, but `docker ps` says healthy (Windows)

A stale **`wslrelay.exe`** squatting the IPv6 loopback (`[::1]`) intercepts `localhost` requests
and never services them. Single `curl` calls may still work, which makes it look intermittent.

- **Confirm:** `http://127.0.0.1:<port>/api/health` works but `http://localhost:<port>/...` hangs.
- **Fix:** `Stop-Process -Name wslrelay -Force` (it respawns on demand; Docker is unaffected).
  Container/Docker restarts do **not** clear it.

### Ribbon shows the tools but no per-class icons

The per-class icons are built in memory when the app activates at boot. If they're missing after a
cold start, `docker restart oshal-local-api` once the database is quiet, then confirm
`Dynamic row UIs registered` and `auto-load complete` `failedCount:0` in
`docker logs oshal-local-api`.

### A front-end fix doesn't show up (especially on the public tunnel)

Two caches sit in front of the student UI:

- **Package assets and route bytes have different build paths.** HTML/CSS/JS in this package's
  `tools/` and `ui/` directories ship directly, while `src-routes/*.ts` never runs in production;
  it must be rebuilt into committed `routes/*.js`. Reinstall/reload the deployed package after
  changing either set so the runtime is not serving an older installed copy.
- **Cloudflare caches static `.js`** on the public tunnel, so a JavaScript fix can lag even when
  the origin is fresh. **Fix:** bump a cache-bust query on the script reference (e.g.
  `lm-mascot.js?v=3`). A hard refresh (Ctrl+Shift+R) clears the browser's copy; the `?v=N` bump
  clears Cloudflare's.

### After changing package route source (`src-routes/**`)

```powershell
# Run from the oshal core checkout.
node scripts/oshal-app.js build C:\Projects\oshal-apps\little-monsters --framework .

# Prove the generated package bytes and all security boundaries together.
Set-Location C:\Projects\oshal-apps\little-monsters
node --test "tests/*.test.cjs"
```

Expect 68/68 tests, then reinstall/reload the package through the operator app-management rail.
Do not hand-edit `routes/*.js`; the official builder is the source/artifact handshake.

### AI features (tutor / flashcards / quizzes) don't answer

They use Claude. Confirm `ANTHROPIC_API_KEY` is set (or the cockpit is signed in to Claude). The
15-point check exercises these — `OSHAL_BASE=<host> bash scripts/oshal-local-checks.sh`.

### Sign-in returns 401, 403, 409, or 503

- **401 — missing issuer or subject:** production OIDC sessions must carry both `iss` and `sub`.
  Do not add an application fallback. `MOCK_OIDC=true` supplies a synthetic issuer only for
  explicit local development.
- **403 — school tenant is not configured:** after the first explicit domain mapping exists,
  identities from an unmapped email domain fail closed. Add the verified domain to the intended
  `lm_tenants` row; do not move a student merely to make sign-in succeed.
- **409 — identity requires review/relink:** the tenant-local email is already bound, duplicated,
  or changed while sign-in was linking it. Inspect the relevant `lm_students` rows and resolve the
  account ownership explicitly.
- **503 — ambiguous tenant/identity or lookup failure:** check duplicate case-normalized tenant
  domains, database health, and structured `education-access` errors. Do not retry by selecting an
  arbitrary matching tenant.

### Material upload is rejected

A file over 10 MiB is outside the per-request limit. HTTP 429 means the authenticated student
would exceed 50 MiB across the preceding 24 hours. Wait for the rolling window or delete material
that is no longer required. A file's extension cannot override its byte-detected media type.

### Google Calendar says tenant credentials are required

This is the intended 1.0.9 behavior. Authenticated `status`, `push`, and `pull` return HTTP 410 with
`TENANT_CALENDAR_CREDENTIALS_REQUIRED`; the old controller-wide OAuth profile bridge was unsafe
for multiple schools. Use Little Monsters' internal personal/class calendar. External sync remains
off until credentials and remote calendar ownership are tenant-bound.

### A quiz attempt is already completed or expired

Generated attempts are single-use and expire after 30 minutes. HTTP 409 means the server already
graded that attempt; HTTP 410 means it expired. Generate a new quiz. The client cannot resubmit a
score or correct-answer list because grading is server-authoritative.

---

## Known limitations (as-built, honest)

- **No PostgreSQL RLS yet.** Multi-school application isolation is implemented through
  case-normalized tenant mapping, final route predicates, composite foreign keys, and triggers.
  Full district administration and database RLS remain platform work; deploy one instance per
  school when that extra isolation layer is required.
- **Rostering is manual** (cockpit/API). Microsoft Graph Education / School Data Sync
  auto-rostering is roadmap.
- **Google Calendar external sync is disabled.** Its authenticated endpoints return 410 until a
  tenant-scoped credential broker exists. Internal personal and class calendars remain available.
- **Authorization coverage is release-gated.** Dashboard, roster, class/catalog, lecture,
  material, flashcard/quiz, assignment, notification, calendar, tutor, analytics, and XP paths
  are tenant/role/relationship scoped. The owner-gated `/classes/:classId/students` endpoint is
  the supported roster write; legacy ID-based writes return 410 without touching data.

Full hardening history:
[core hardening backlog](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/backlog/hardening.md).
Enhancement spec and review:
[ADR 075](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/075-little-monsters-onboarding-and-enhancements.md).
