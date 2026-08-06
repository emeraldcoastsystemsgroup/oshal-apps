# Little Monsters — ship/review package

A single-page summary for a reviewer picking up **Little Monsters** before it goes out for
external review. It states what the app is, what is built and deployed, how enrollment and
access control work, what the test suite covers and how to run it, the security review and its
fixes, and what remains open. As-built as of 2026-08-06 (package 1.0.9).

Companion package artifacts:
- [BUILD.md](../BUILD.md) — reproducible route build and artifact counts
- [runbook.md](runbook.md) — start / open / verify / debug
- [school-deployment.md](school-deployment.md) — sign-in, enrollment, privacy model
- [support.md](support.md) — operator-visible failure modes and status codes
- [oshal-app.yaml](../oshal-app.yaml) — package manifest and migration order (single source of truth)

---

## 1. What it is

Little Monsters is a voice-first, ADHD/dyslexia-friendly K-12 study companion delivered as an
oshal app package. Its declarative `oshal-app.yaml` registers six education bots, the
`/api/education` routes, migrations, tools, and cockpit surfaces. Domain behavior stays in this
store package; the framework supplies only the declared kernel skills.

Students reach it at `/cockpit/?app=little-monsters&student=1` (student mode hides the operator
chrome). This review covers the store artifact; it does not claim that any particular host or
public tunnel currently has version 1.0.9 deployed.

---

## 2. What is built and release-validated

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
| **Identity and tenancy** | Exact OIDC `(iss, sub)` account binding, fail-closed domain-to-tenant mapping, tenant-scoped roles, same-tenant enrollment database constraints, and collision-resistant RAG namespaces. |
| **Authorization audit** | Roster provisioning, enrollment, and removal append actor/student/class/action/database-time facts atomically. Migration 037 rejects update, delete, and truncate; the runtime role is append-only. |
| **Materials and RAG** | 10 MiB/request and 50 MiB/student/24-hour upload bounds, content-byte classification, contained random storage, per-material RAG collections, teacher moderation, and exact collection/file deletion. |
| **Quizzes and XP** | Public quiz questions contain no answer key; 30-minute server-side attempts are tenant-bound, single-use, and server-graded. XP uses server allowlists, cooldown buckets, and idempotency keys. |
| **External calendar** | The internal class/personal calendar is active. Google status/push/pull deliberately return HTTP 410 until school credentials and remote calendar ids are tenant-bound. |

The release artifact contains 36 TypeScript source modules, 36 corresponding compiled JavaScript
modules, and 17 ordered install migrations. Rebuild mechanics are documented in
[BUILD.md](../BUILD.md); runtime operations are in the [runbook](runbook.md).

---

## 3. Identity, tenant, and access model

Sign-in and a manual roster converge on one fail-closed principal model:

1. **Verified OIDC principal.** Production sessions must supply both `iss` and `sub`. The exact
   pair is the account key; the same subject string from another issuer is another principal.
2. **Tenant resolution.** A case-normalized school email domain maps to one tenant. Once any
   explicit domain mapping exists, an unmapped domain is denied rather than assigned to the
   default tenant. Duplicate mappings fail activation.
3. **Manual roster placeholder.** An owning teacher or same-tenant admin enrolls by email through
   `POST /classes/:classId/students`. First sign-in can claim only an unbound same-tenant
   placeholder (or one-time compatible legacy row), under ordered advisory locks.
4. **Current relationship at use time.** Access-sensitive queries include tenant, role, class
   ownership, enrollment, and active/archive state. High-risk mutations repeat those relationships
   in final SQL and use transactions/row locks so a preliminary authorization check cannot go
   stale before the write.

Class records are shared only with current members/owners/admins in that tenant. Student progress,
private study sets, quiz attempts, personal calendar rows, and unapproved material remain private.
Teacher dashboard access is limited to students in active classes they own; tenant admins remain
inside their tenant. Unauthorized by-id dashboard requests use the same 404 as a missing id.

---

## 4. Test suite

Package-local release guards live under `tests/`. They use built-in `node:test`, need no package
install, and mix compiled-runtime execution with source structural guards where final SQL shape is
the security contract. Store CI runs the complete glob:

```bash
node --test "tests/*.test.cjs"
```

| File | Tests | Category | Covers |
|---|---|---|---|
| `lm-authz.test.cjs` | 16 | Compiled integration | Two-tenant dashboard/teacher aggregate/roster matrix; locked class/material cleanup and rollback; class-bank and tutor denial; legacy endpoint retirement; tenant identity/domain invariants; package-local Presentations metadata. |
| `lm-identity-security.test.cjs` | 9 | Compiled + invariant | Issuer/subject separation, takeover resistance, serialized placeholder and legacy adoption, required claims, fail-closed default tenant, observable rollback, RAG hash entropy, migration/schema contract. |
| `lm-lecture-security.test.cjs` | 14 | Compiled integration | Tenant-bound teacher/admin writes and enrolled reads; zero-side-effect denials; content sniffing; random exclusive contained artifacts; no path disclosure; protected route composition. |
| `lm-study-authz.test.cjs` | 8 | Compiled integration | Class-set teacher writes/student reads, private-set ownership, zero-side-effect foreign-class denial, server-held quiz answers, caller-scoped SM-2 writes, fail-closed historical ownership. |
| `lm-calendar-material-progress-security.test.cjs` | 7 | Executed source seam | Notification/reminder scope, Google 410/no profile leakage, personal-calendar privacy, material storage/lifecycle controls, XP cooldowns, and single-use server quiz grading. |
| `lm-toctou-authz.test.cjs` | 6 | Structural SQL/transaction guard | Final relationship predicates for roster, catalog, assignment, and dashboard plus lock/transaction placement around class deletion and material lifecycle side effects. |
| `lm-doc-contract.test.cjs` | 4 | Documentation contract | Package-relative links, current install/build guidance, retired guidance removal, and shipped inline-help behavior. |
| `lm-roster-audit.test.cjs` | 4 | Audit + mounted-proof contract | Migration immutability, atomic roster writes, zero wildcard projections, retired generic writes, and enforced disposable-PostgreSQL gate wiring. |
| **Total** | **68** | Release gate | All rows above must pass; the glob must not be narrowed to one security area. |

The official 2026-08-06 package build completed before this suite and all **68/68** tests passed.
Store CI also mounts the compiled manifest entrypoint in real Express against disposable PostgreSQL
as a LOGIN `NOSUPERUSER`/`NOBYPASSRLS` application role. Browser coverage remains under
`tests/*.spec.ts`; those specs require a running oshal stack.

---

## 5. Security review closure

The 1.0.9 hardening pass closed the release-blocking findings below:

| Finding | Fix |
|---|---|
| **OIDC subject collision / email takeover** | Bind by exact `(external_issuer, external_id)`; permit email adoption only for an unbound same-tenant placeholder or compatible legacy row under ordered transaction locks. Missing issuer/subject fails closed outside explicit mock mode. |
| **Tenant ambiguity and cross-school enrollment** | Case-normalized domain uniqueness, fail-closed unmapped-domain behavior, tenant columns on enrollments/quiz attempts, composite foreign keys, and tenant-binding triggers. Migration 035 refuses historical cross-tenant enrollments. |
| **Dashboard, roster, analytics, and tutor IDOR** | Complete student/teacher/admin role matrices, same-tenant final SQL, active-class owner checks, non-oracular dashboard denial, class-scoped roster writes, and retired global ID-based writes. |
| **Mutable/missing roster audit** | Migration 037 stores actor, student, class, action, and database time without cascading foreign keys. Add/remove operations write audit and roster state atomically; update, delete, and truncate fail even for the table owner. |
| **Overbroad SQL projection** | Identity, class, assignment, calendar, notification, material, and quiz-attempt reads use explicit reviewed fields; source and compiled route gates reject `SELECT *`, alias wildcards, and `RETURNING *`. |
| **TOCTOU between authorization and mutation** | Roster, catalog, assignments, class metadata/deletion, calendar, materials, and analytics re-evaluate current relationships in final SQL; multi-row operations lock and transact. Material share/delete locks the class, live actor, material, and same-tenant uploader before any grounding or cleanup side effect. |
| **Lecture filesystem overwrite / path disclosure** | Teacher/admin authorization before side effects, byte-derived audio type, random no-clobber writes, lexical and real-path containment, bounded artifact reads, and path-free API projections. |
| **Study-set poisoning / quiz answer trust** | Only class owner/admin may mutate class sets; private sets have explicit owners. Quiz answers remain server-side in a 30-minute, single-use attempt and the server derives the score/XP. |
| **RAG contamination and stale sharing** | One exact collection per successfully grounded material; tutor search selects uploader-owned or currently approved rows under class/row locks. Denial removes classmates' lookup immediately. Material/class deletion removes exact collections and contained files before SQL pointers; external failure aborts relational deletion and retains pointers for retry. |
| **Upload abuse and type spoofing** | 10 MiB request limit, 50 MiB/student/24-hour serialized quota, random exclusive storage/OCR temp names, bounded PDF OCR, content-byte MIME classification, containment, `nosniff`, and attachment fallback for unsafe types. |
| **Calendar/notification cross-tenant access** | Caller-visible events only, locked idempotent reminders, self/same-tenant-admin/owned-class teacher targeting, and final access predicates. The unsafe shared Google credential bridge is retired with 410. |
| **Client-authored XP / replay** | Public XP endpoint accepts a fixed activity allowlist with server-time cooldown keys. Quiz and tutor rewards use deterministic idempotency keys in the XP ledger. |

---

## 6. How to verify locally

```powershell
# From the oshal core checkout: regenerate the runtime bytes from package sources.
node scripts/oshal-app.js build C:\Projects\oshal-apps\little-monsters --framework .

# From the applications checkout: execute every package security guard.
Set-Location C:\Projects\oshal-apps\little-monsters
node --test "tests/*.test.cjs"
```

Expected package result: **68 tests, 68 pass, 0 fail**. Then, on a deployed test swarm, run the
Playwright specs and spot-check the student/teacher role flows. The manual security spot-checks
are: cross-tenant class ids reveal no data; a generated quiz response has no answer key and cannot
be submitted twice; denied material disappears from a classmate's tutor context; and every Google
Calendar bridge operation returns the documented authenticated 410.

---

## 7. Where it lives

| Concern | Path |
|---|---|
| Manifest | [`../oshal-app.yaml`](../oshal-app.yaml) |
| Developer source of truth | `../src-routes/*.ts` (36 modules) |
| Runtime route artifact | `../routes/*.js` (36 modules; generated by the official builder) |
| Database upgrades | `../migrations/*.sql` (17 install migrations plus opt-in `uninstall.sql`) |
| Student surfaces | `../tools/` plus the two stylesheets in `../ui/`; the floating tutor is declarative `ui.assistant`, not package JavaScript running in the cockpit origin |
| Personas | `../personas/` (six education bots plus shared foundation) |
| Security and browser tests | `../tests/*.test.cjs` and `../tests/*.spec.ts` |
