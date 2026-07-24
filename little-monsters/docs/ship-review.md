# Little Monsters — Ship / Review Package

A single-page summary for a reviewer picking up **Little Monsters** before it goes out for
external review. It states what the app is, what is built and deployed, how enrollment and
access control work, what the test suite covers and how to run it, the security review and its
fixes, and what is known-open. As-built as of 2026-06-27.

Companion docs:
- [adr/075-little-monsters-onboarding-and-enhancements.md](../adr/075-little-monsters-onboarding-and-enhancements.md) — the full enhancement spec + change-impact analysis
- [runbook.md](runbook.md) — start / open / verify / debug
- [school-deployment.md](school-deployment.md) — sign-in, enrollment, privacy model
- [architecture/little-monsters-on-oshal-plan.md](../architecture/little-monsters-on-oshal-plan.md) — architecture + sprint history
- [../swarm-apps/little-monsters.yaml](../../swarm-apps/little-monsters.yaml) — the manifest (single source of truth)

---

## 1. What it is

Little Monsters is a **dyslexia-first K-12 study companion**, delivered as an OSHAL **swarm
application** — a declarative manifest (`swarm-apps/little-monsters.yaml`) that adds education
bots, the `/api/education` routes, and a set of cockpit surfaces on top of the platform. It was
built to a hard constraint: **negligible core-platform change** — new behavior lives in the
manifest, the `education-*` route modules, and bind-mounted student surfaces, not in framework
code (see ADR-075's change-impact section).

Students reach it at `/cockpit/?app=little-monsters&student=1` (student mode hides the operator
chrome). The build is deployed on the local Docker stack and the `oshal.agenticfederal.us`
tunnel.

---

## 2. What is built and deployed

| Area | State |
|---|---|
| **Onboarding** | Little-Monsters-branded welcome/done flow (guarded by `?app=little-monsters`), trimmed steps, connectors limited to email/social/storage, lands directly in the student view. Query-preserving `/`→`/welcome` redirect. |
| **Home / My Day** | Master calendar merging assignments + class calendars, color-coded by class and task type, per-class filter chips, bold class tiles. First home visit after a level-up shows a confetti party and an "open your box" prompt. |
| **Tutor** | Anti-cheating guardrails (Lecture Recap / Parallel Problem / Socratic Debugging / Custom Tutorial — never direct answers). Photo / file / **real camera** (`getUserMedia`) input routed to a Claude vision path. Neural read-aloud. |
| **Tools** | Formula Lab (formula → worked example), STEM Helpers (calculator / periodic table / PhET), Citations (paper upload → Works Cited), Lecture Timelines, My Files (local save/open + connector cards). |
| **Flashcards** | One unified hub: browse a gallery of existing sets, study, **create** (manual / paste / AI-from-class), and **edit** cards inline. |
| **Game arcade** | Six rewritten HTML5 games (Snake, Monster Dash, 2048, Flashcard Blitz, Quiz Arena, Milkshake Maker), each with keyboard + touch controls, a live score/streak readout, a study warm-up gate that pulls **real class flashcards**, and a game-over screen offering **Play again** or **I'm done** (returns to the arcade). Scores feed XP. |
| **Rewards** | Earning a level grants a **mystery box**. Opening is pick-1-of-3 → a server-authoritative roll yields a new monster skin or an accessory. Items are kept in **My Monsters**, equippable on the avatar, with a "monster tricks" animation hook. Boxes are **earned only** — no free welcome boxes. |
| **Concierge** | A floating "Little Monster Expert" that replaces the operator right-rail chat in student mode and wears the student's equipped monster. |
| **Theme** | The real pink-monster palette (magenta body, blue horns, deep-purple world) with the canonical character art. |

Deployment mechanics (front-end is bind-mounted/hot; baked TS needs an api rebuild; Cloudflare
caches `/api/education/*.js` so script `src` is cache-busted with `?v=N`) are documented in the
runbook.

---

## 3. Enrollment and access model

Two sign-in paths, plus a manual roster, all converging on one authorization invariant.

1. **School account → public/shared tenant.** A student signs in with their school account and
   auto-joins the shared tenant, where standard classes and their materials are published.
2. **School-tenant OIDC.** A district runs its own tenant; students sign in via the school's
   OIDC and stay inside that tenant's boundary.
3. **Manual roster (teacher).** A teacher enrolls a student by email; a placeholder record
   attaches to the real identity on first sign-in.

The data model is **shared-vs-private** (full table in the school-deployment guide): class
materials are visible to enrolled students; XP, level, streak, and progress are private to the
student. The invariant that makes this safe is the same across all three paths:

> Every write and every by-id read is pinned to the **authenticated** student — never a
> client-supplied id. A student not enrolled in a class gets HTTP 403 on that class's endpoints
> and never sees the class in their list.

This invariant is what the security tests lock down (Section 4).

---

## 4. Test suite

Location: [../tests/unit/little-monsters/](../../tests/unit/little-monsters/). Runner: vitest.
**Run with `npm run test:unit`** (the Playwright config ignores `tests/unit/`, so these run as
fast unit/integration tests). They mount the real route modules against a mock pg pool and a
mocked auth layer, then drive them over `fetch` — no live database or network required, so they
run in CI. **Current result: 21 passed (21).**

| File | Tests | Category | Covers |
|---|---|---|---|
| `lm-logic.spec.ts` | 8 | Functional | The XP→level curve (`levelFromXP`, `XP_TABLE`), reward-catalog integrity (well-formed items, unique ids, default monster present), and the rarity-weighted `rollItem`. |
| `lm-rewards-routes.spec.ts` | 6 | Transactional | `GET /rewards` state + catalog; the **atomic** box-open (`UPDATE … WHERE boxes > 0 RETURNING`) including 0-boxes → 400, duplicate roll → +5 XP sparkle with no new item, `boxesLeft` decrement; equip authorization. |
| `lm-flashcards-security.spec.ts` | 7 | Security | The IDOR fixes: editing / deleting / reading a card or set in a class you are not enrolled in → 403; missing → 404; a private (null-class) self-study set correctly skips the class check; empty input → 400; equipping an un-owned or non-catalog item rejected. |

To keep the route modules testable, `levelFromXP` + `XP_TABLE` (education-routes) and `rollItem`
+ `REWARD_CATALOG` (education-rewards-routes) were exported. These are export-only changes with
no runtime effect.

> **Scope note.** This is the unit/integration layer — it proves the route logic and the access
> invariant in isolation. The live full-stack walkthrough (sign-in → study → game → reward
> through a real server, DB, and OIDC) belongs in the Playwright `tests/*.spec.ts` layer; see
> `tests/education-access-control.spec.ts` for the existing end-to-end access-control test.

---

## 5. Security review and fixes

A two-agent best-practices/security pass over the LM route modules produced the following
fixes, all landed:

| Finding | Fix |
|---|---|
| **IDOR** on flashcard cards/sets — by-id endpoints did not re-check enrollment | Resolve the owning `class_id` (`classIdForCard` / `classIdForSet`) and `assertClassAccess` before any read/write; a null `class_id` is a private self-study set and is allowed. Locked down by `lm-flashcards-security.spec.ts`. |
| **Reward double-spend** — box-open read-then-wrote boxes | Atomic `UPDATE lm_rewards SET boxes = boxes - 1 … WHERE boxes > 0 RETURNING`; 0 rows → 400. |
| **Tutor crash** on image-only messages | Guarded `(message ?? '').length`; image blocks sent via a direct SDK call. |
| **XSS** in flashcard hub and tutor read button | Replaced inline `onclick` with data-attributes; attribute-safe `esc()`. |
| **Cross-frame message spoofing** in the arcade | Listener checks `e.source === frame.contentWindow`. |
| **Information disclosure** | Generic client-facing error messages. |
| **Tutor XP** not awarded | Tutor questions resolve the authenticated student and award XP. |

**Known-open** (pre-existing, captured in the ADR-075 security section — not introduced by this
work):
- `GET /student/:id/dashboard` does not yet verify the caller is the student or their teacher (teacher-view IDOR).
- `POST /enroll` and the students listing are not yet auth-gated.

These are flagged for the next hardening pass; they sit on teacher/admin endpoints, not the
student data path.

---

## 6. How to verify locally

```bash
cd /c/Projects/open-shal-swarm-harness-agent-llm

# Unit/integration tests (includes the LM suite)
npm run test:unit

# Just the LM suite
npx vitest run --config vite.config.ts tests/unit/little-monsters/
```

Then open the student view (`/cockpit/?app=little-monsters&student=1`), hard-refresh
(Ctrl+Shift+R) to clear the cached game/surface JS, and spot-check: play a game to a game-over
screen and confirm **Play again** / **I'm done**; earn a level and confirm the home-page
confetti + box prompt on the next home visit; open a box in My Monsters and confirm the item is
kept and equippable. Rebuild/redeploy steps are in the runbook.

---

## 7. Where it lives

| Concern | Path |
|---|---|
| Manifest | [../swarm-apps/little-monsters.yaml](../../swarm-apps/little-monsters.yaml) |
| Routes | `src/app/routes/education-routes.ts`, `education-study-routes.ts`, `education-rewards-routes.ts`, `education-access.ts` |
| Student surfaces | `any-bot/server/services/tools/education/` (dashboard, games-arcade, flashcard-hub, my-monsters, the six `games/*/index.html`) |
| Cockpit integration | `src/pages/cockpit/js/` (RibbonNav student mode, lm-concierge) and `src/pages/welcome/welcome.js` (onboarding) |
| Theme | `src/pages/cockpit/css/themes/little-monsters.css` |
| Tests | [../tests/unit/little-monsters/](../../tests/unit/little-monsters/) |
