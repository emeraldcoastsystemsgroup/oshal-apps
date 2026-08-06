# Little Monsters — Installation Guide

How to install and run **Little Monsters**. Two tracks: a **quick local install** for trying it
out or developing on it (Docker Desktop on Windows), and a **school production install** with
real Microsoft sign-in.

> **Superseding note (2026-08-05):** the original 2026-06-27 guide installed Little Monsters as
> part of the core compose topology. Little Monsters now ships only as an app-store package. The
> `scripts/oshal-app.js` workflow below replaces the historical profile-based procedure; the dated
> record remains available in repository history.

> Related: [School Deployment Guide](school-deployment.md) (the full production
> sign-in / enrollment / privacy walkthrough) · [Local Runbook](runbook.md) (day-to-day
> start/verify/debug) · [Support & FAQ](support.md) · [All docs](README.md)

---

## What you're installing

Little Monsters is **not a standalone app** — it is an **oshal app package** that runs on the
oshal platform. Its package-local [`oshal-app.yaml`](../oshal-app.yaml) declares the education
bots, `/api/education` routes, migrations, cockpit surfaces, and theme. Installation places the
whole package under the swarm's shared `deployed-apps/little-monsters` directory; the package
loader validates and activates that manifest at controller boot.

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

First install a local oshal swarm using the
[current core installer](https://github.com/emeraldcoastsystemsgroup/oshal#install--one-command).
For a source checkout, bring the stack up in dependency order, then run the package helper inside
the controller so it writes to the shared workspace volume:

```bash
cd /c/Projects/oshal
bash scripts/oshal-up.sh
docker compose -f docker-compose.oshal-local.yml exec oshal-api \
  node scripts/oshal-app.js install little-monsters
docker compose -f docker-compose.oshal-local.yml restart oshal-api
```

Set your Claude key first (so the AI features work):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Open it:**

```
http://localhost:35457/cockpit/?app=little-monsters
```

Add `&student=1` for the clean student view (hides the operator chrome):
`http://localhost:35457/cockpit/?app=little-monsters&student=1`

> The applications-store checkout is not the runtime copy. For source-route changes, run
> `node scripts/oshal-app.js build C:/Projects/oshal-apps/little-monsters --framework .`
> from the core checkout, validate and commit the generated `routes/*.js`, then reinstall the
> committed package ref and restart the controller. See the [Runbook](runbook.md) for the complete
> rebuild/reinstall sequence.

---

## Track B — School production install

A scripted install that builds, starts, and self-verifies. Run it on the host that will serve the
school.

Install oshal using the current installer and include Little Monsters in the resolved bundle, or
install the package afterward with `node scripts/oshal-app.js install little-monsters`. Production
rollout must use a pinned, reviewed store ref and the platform deployment procedure; do not copy
the package into the kernel repository.

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
# Core service and app-store separation checks.
OSHAL_BASE=http://localhost:35457 bash scripts/oshal-local-checks.sh   # expect 11/11

# Dependency-free Little Monsters package contracts.
cd /c/Projects/oshal-apps/little-monsters
node --test "tests/*.test.cjs"
```

Then open the student view, hard-refresh (Ctrl+Shift+R), and confirm the home page, the tutor
bubble, the Flashcards hub, the Games arcade, and My Monsters all load.

---

## After installing

- **Day-to-day operations** (start/stop, logs, rebuild after a code change, the per-class ribbon
  icons): [Local Runbook](runbook.md).
- **Adding classes, enrolling students, uploading textbooks**: [School Deployment Guide](school-deployment.md).
- **Something not working?** [Support & FAQ](support.md).
