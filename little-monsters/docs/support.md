# Little Monsters — Support, FAQ & Troubleshooting

Where to get help, answers to common questions, and fixes for the problems people actually hit.
Organized by who you are. As-built as of 2026-06-27.

> Related: [User Guide](user-guide.md) · [Installation](installation.md) · [School Deployment](school-deployment.md) · [Runbook](runbook.md) · [All docs](README.md)

---

## How to get help

| You are a… | Start here |
|---|---|
| **Student** | Ask the floating **Little Monster Expert** (the tutor bubble) — it's there on every screen. For account/access problems, tell your teacher. |
| **Teacher** | Check the [User Guide → For teachers](user-guide.md#for-teachers) and the [School Deployment Guide](school-deployment.md). For setup issues, contact your school's OSHAL administrator. |
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
No. Your XP, level, streak, flashcard progress, quiz results, and your monster collection are
**private to you**. Only class materials (textbook, flashcard sets, assignments, calendar) are
shared, and only with students in that class.

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
auto-provisioned on first sign-in — no separate account creation.

**How do I add a class and enroll students?**
A teacher/admin creates the class and enrolls students (students self-provision on login, but
classes and enrollments are made by you). Steps and the API calls are in the
[School Deployment Guide → Set up classes and enroll students](school-deployment.md#3-set-up-classes-and-enroll-students).

**How do I make the tutor and flashcards use our textbook?**
**Upload the class textbook (PDF)** — via the cockpit's **+ Add Class → Textbook** or
`POST /api/education/upload-material`. The tutor, auto-generated flashcards, and quizzes for that
class then ground in it.

**Is there automatic rostering from Microsoft?**
Not yet. Microsoft School Data Sync / Graph Education auto-rostering is on the roadmap; for now
enroll via the cockpit or API.

**Can one server host several schools?**
Not currently — run **one instance per school**. Multi-district tenancy is designed (ADR 035) but
not built.

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

- **Bind mounts are hot** — HTML/CSS/JS under `any-bot/server/services/tools/education/` and
  `src/pages/` serve on the next request, no rebuild. Only `src/**` TypeScript needs a rebuild.
- **Cloudflare caches static `.js`** on the public tunnel, so a JavaScript fix can lag even when
  the origin is fresh. **Fix:** bump a cache-bust query on the script reference (e.g.
  `mascot.js?v=3`). A hard refresh (Ctrl+Shift+R) clears the browser's copy; the `?v=N` bump
  clears Cloudflare's.

### After changing controller code (`src/**`)

```bash
docker build -t oshal-bot:latest .
UI_PROFILE=oshal-framework docker compose -f docker-compose.oshal-local.yml \
  up -d --no-deps --force-recreate oshal-api
```

Pass `UI_PROFILE=oshal-framework` so recreating the api doesn't reset the operator cockpit to the
bare starter profile. The `?app=little-monsters` URL overrides the profile per request, so the
student view is unaffected.

### AI features (tutor / flashcards / quizzes) don't answer

They use Claude. Confirm `ANTHROPIC_API_KEY` is set (or the cockpit is signed in to Claude). The
15-point check exercises these — `OSHAL_BASE=<host> bash scripts/oshal-local-checks.sh`.

---

## Known limitations (as-built, honest)

- **One school per instance.** Multi-district tenancy (per-tenant isolation) is designed in ADR
  035, not built.
- **Rostering is manual** (cockpit/API). Microsoft Graph Education / School Data Sync
  auto-rostering is roadmap.
- **Access control covers the primary student surfaces.** Reads (own dashboard, class list/info,
  lectures, flashcard sets + cards) are enrollment-gated; writes (XP, quiz results, flashcard
  review, flashcard create/edit/delete, rewards box-open) are gated to the **authenticated**
  student. Known remaining holes, tracked in the hardening backlog and the ADR-075 review:
  `GET /student/:studentId/dashboard` lets a teacher read any student, and `POST /enroll` /
  `POST /students` are unauthenticated — both need a broader authorization pass before a
  hardened production rollout.

Full hardening status: [hardening-backlog.md](../backlog/hardening.md). Enhancement spec and review:
[adr/075-little-monsters-onboarding-and-enhancements.md](../adr/075-little-monsters-onboarding-and-enhancements.md).
