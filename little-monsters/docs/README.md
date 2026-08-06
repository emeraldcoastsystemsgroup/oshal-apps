# Little Monsters — Documentation

**Little Monsters** is a dyslexia-first K-12 study companion: a calendar, an AI tutor that coaches
(rather than hands over answers), a unified flashcards hub, a study toolkit, a game arcade that
scores into XP, and an earn-only rewards loop with a collectible, equippable monster. It runs as a
swarm application on the OSHAL platform.

This is the index to all of its documentation. Start with the row that matches you.

---

## Find your guide

| If you are a… | Read |
|---|---|
| **Student** | [User Guide](user-guide.md) — how to use every part of the app. |
| **Teacher** | [User Guide → For teachers](user-guide.md#for-teachers), then [School Deployment Guide](school-deployment.md) for class setup and enrollment. |
| **School administrator** | [Installation](installation.md) → [School Deployment Guide](school-deployment.md) (sign-in, enrollment, privacy/compliance). |
| **Operator** (running the server) | [Installation](installation.md) → [Runbook](runbook.md) → [Support & Troubleshooting](support.md). |
| **Reviewer** (evaluating before release) | [Ship / Review Package](ship-review.md) — what's built, tested, and known-open, on one page. |
| **Developer** | [ADR-075](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/075-little-monsters-onboarding-and-enhancements.md) and the [architecture plan](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/architecture/little-monsters-on-oshal-plan.md), then the package manifest [`oshal-app.yaml`](../oshal-app.yaml). |
| **Anyone stuck** | [Support, FAQ & Troubleshooting](support.md). |

---

## All documents

### Using it
- **[User Guide](user-guide.md)** — home, My Day, the tutor, flashcards, recording, the toolkit, the arcade, and rewards/My Monsters. For students and teachers.
- **[Support, FAQ & Troubleshooting](support.md)** — how to get help, common questions by audience, operator fixes, and honest limitations.

### Installing & operating it
- **[Installation Guide](installation.md)** — quick local install and school production install, prerequisites, and verification.
- **[School Deployment Guide](school-deployment.md)** — Microsoft Entra ID sign-in, classes and enrollment, the privacy/compliance checklist, and operations.
- **[Local Runbook](runbook.md)** — start, open, verify, rebuild, and debug a local Docker deployment.
- **[Optimization Strategies](optimization.md)** — levers for running cost-effectively and responsively at school scale.

### Evaluating & building it
- **[Ship / Review Package](ship-review.md)** — one-page summary for a reviewer: features, enrollment/access model, the test suite and results, the security review and fixes, and known-open items.
- **[ADR-075 — Onboarding & Enhancements](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/075-little-monsters-onboarding-and-enhancements.md)** — the enhancement spec, change-impact analysis, and security review.
- **[Architecture on oshal](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/architecture/little-monsters-on-oshal-plan.md)** — architecture and sprint history.
- **[Education content sources](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/backlog/education-content-sources.md)** — backlog for content/material sources.
- **[Package manifest — `oshal-app.yaml`](../oshal-app.yaml)** — the single source of truth: bots, routes, surfaces, theme.

---

## The one-line orientation

- **It's a swarm app, not framework code.** Behavior lives in the manifest, the `education-*`
  route modules, and the bind-mounted student surfaces — the platform itself is barely touched.
- **Reach the student view** at `/cockpit/?app=little-monsters&student=1`.
- **Privacy model:** each student's progress is private; class materials are shared only with
  enrolled students; access is always pinned to the authenticated identity.
- **Rewards are earned**, never given — level up to earn a mystery box.
