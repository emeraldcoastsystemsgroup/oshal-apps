# Little Monsters — Installation Guide

How to install and run **Little Monsters**. Two tracks: a **quick local install** for trying it
out or developing on it (Docker Desktop on Windows), and a **school production install** with
real Microsoft sign-in. As-built as of 2026-06-27.

> Related: [School Deployment Guide](school-deployment.md) (the full production
> sign-in / enrollment / privacy walkthrough) · [Local Runbook](runbook.md) (day-to-day
> start/verify/debug) · [Support & FAQ](support.md) · [All docs](README.md)

---

## What you're installing

Little Monsters is **not a standalone app** — it's a **swarm application** that runs on the OSHAL
platform. Installing it means standing up OSHAL with the Little Monsters manifest
(`swarm-apps/little-monsters.yaml`) active. The manifest declares the six education bots, the
`/api/education` routes, the cockpit surfaces, and the theme; OSHAL loads it at boot.

### Prerequisites

| Requirement | Notes |
|---|---|
| **Docker Desktop** | The whole stack runs in containers. Windows or Linux. |
| **Git** | To clone the repository. |
| **An Anthropic API key** (or Claude sign-in) | The tutor, flashcards, quizzes, and lecture notes use Claude. Set `ANTHROPIC_API_KEY`, or sign in to Claude from the cockpit. Without it those AI features won't answer. |
| **~8 GB free RAM** for the container set | Postgres, Redis, ChromaDB, the controller, and the LM bots. |
| **An OIDC identity provider** | Production only — Microsoft Entra ID (Azure AD) for most schools. Local installs use the built-in mock sign-in. |

The stack uses **Postgres** (students, classes, progress), **Redis** (the swarm mesh), and
**ChromaDB** (per-class textbook/lecture search, isolated per class).

---

## Track A — Quick local install (Docker Desktop)

For evaluating or developing. Uses a local mock sign-in, no identity provider required.

```bash
git clone <repo> oshal
cd oshal

# 1. Build the controller image (needed after TypeScript/dependency changes)
docker build -f Dockerfile.oshal -t oshal-bot:latest .

# 2. Bring up the base services plus the Little Monsters bots.
#    The six LM bots sit behind the `little-monsters` compose profile —
#    without the profile flag they do not start.
OSHAL_API_PORT=35460 docker compose \
  -f docker-compose.oshal-local.yml \
  -f docker-compose.override.yml \
  --profile build --profile incident --profile little-monsters \
  up -d
```

Set your Claude key first (so the AI features work):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Open it:**

```
http://localhost:35460/cockpit/?app=little-monsters
```

Add `&student=1` for the clean student view (hides the operator chrome):
`http://localhost:35460/cockpit/?app=little-monsters&student=1`

> The `docker-compose.override.yml` file (dev-only) bind-mounts the student surfaces, so edits to
> the HTML/CSS/JS under `any-bot/server/services/tools/education/` and `src/pages/` serve on the
> next request with **no rebuild**. Only changes under `src/**` (the TypeScript routes/services)
> need a rebuild. See the [Runbook](runbook.md) for the rebuild command.

---

## Track B — School production install

A scripted install that builds, starts, and self-verifies. Run it on the host that will serve the
school.

```bash
git clone <repo> oshal && cd oshal
bash scripts/install.sh --with-keys      # build → up → self-verify
```

Set your Claude key before `--with-keys` so the verify step can exercise the AI endpoints.

### Connect Microsoft sign-in (Entra ID)

Production uses real OIDC sign-in instead of the local mock. Register an app in Entra, then set
these in `.env` (and **unset** `MOCK_OIDC`):

```bash
OIDC_ISSUER_URL=https://login.microsoftonline.com/<TENANT_ID>/v2.0
OIDC_CLIENT_ID=<APPLICATION_CLIENT_ID>
OIDC_CLIENT_SECRET=<CLIENT_SECRET>
SESSION_SECRET=<a long random string>
APP_URL=https://<your-oshal-host>
LM_TEACHER_EMAILS=teacher1@yourschool.edu,teacher2@yourschool.edu
```

The full Entra app-registration steps (redirect URI, permissions, admin consent), class creation,
student enrollment, and the privacy/compliance checklist are in the
**[School Deployment Guide](school-deployment.md)** — follow that for a real
rollout. On first sign-in each student's account is auto-provisioned; **classes and enrollments**
are created by a teacher/admin (via the cockpit or the `/api/education` endpoints).

---

## Verify the install

```bash
# 15-point health check (checks 11–15 are the Little Monsters ones:
# app active, education UI served, tutor reply, flashcard + quiz generators)
OSHAL_BASE=http://localhost:35460 bash scripts/oshal-local-checks.sh   # expect 15/15

# Access-control end-to-end test (the privacy guarantees)
# plus the Little Monsters unit/integration suite
npm run test:unit
```

Then open the student view, hard-refresh (Ctrl+Shift+R), and confirm the home page, the tutor
bubble, the Flashcards hub, the Games arcade, and My Monsters all load.

---

## After installing

- **Day-to-day operations** (start/stop, logs, rebuild after a code change, the per-class ribbon
  icons): [Local Runbook](runbook.md).
- **Adding classes, enrolling students, uploading textbooks**: [School Deployment Guide](school-deployment.md).
- **Something not working?** [Support & FAQ](support.md).
