# Little Monsters — Optimization Strategies

Concrete levers for running Little Monsters cost-effectively and responsively at school scale.
Ordered by impact. Each names where it applies in the codebase.

## 1. LLM cost (the dominant cost driver)

LLM calls are ~all of the variable cost. Strategies:

- **Persona-as-quality-gate, no separate reviewer** (already the default). Each bot self-gates,
  so one LLM pass does the work of a generate→review pipeline — the proven ~68% cost reduction in
  the OSHAL benchmark. Keep new education flows single-pass.
- **Model tiering by task.** Generation (notes/flashcards/quiz/slides) already uses **Haiku**
  (`claude-haiku-4-5` in `education-lecture-routes.ts` / `education-study-routes.ts`); reserve the
  pricier **Sonnet** for the interactive tutor where quality is visible. Don't let generation drift
  to Sonnet.
- **One pass, many artifacts.** `process-transcript` already emits notes + flashcards + assignments
  + slides from a *single* call. Apply this pattern to any new "make study stuff" feature rather
  than N calls.
- **Prompt caching.** The tutor's system prompt + the class's retrieved textbook chunks are stable
  across a session — use Anthropic prompt caching (cache the grounding block) to cut input tokens
  on multi-turn tutoring. (We already see large `cacheReadTokens` in the claude-code path; make it
  explicit for the direct tutor calls.)
- **Per-seat usage cap** (ADR 035 billing). A per-student daily token budget protects margin and
  caps abuse; enforce at the per-tenant queue layer.

## 2. RAG / retrieval

- **Per-class collection isolation is already optimal** (`lm-class-{id}-textbook/-lecture`) — small
  collections mean fast, relevant retrieval and clean per-class deletion.
- **Tune `topK` and chunk size.** Generation retrieves `topK=8` over ~6000-char windows; for large
  textbooks, raise chunking quality (the tiered strategy in `rag-service.ts`) rather than topK.
- **Cache embeddings on ingest** (server-side default embedding already does one pass per chunk);
  avoid re-embedding unchanged materials.

## 3. Database

- **Indexes added for the access model** (migration 026: `lm_students.external_id`, `lower(email)`,
  `lm_classes.teacher_student_id`). Add a composite index on `lm_enrollments(student_id, class_id)`
  if enrollment lookups get hot — it's the access-control hot path.
- **Cache `listAccessibleClassIds` per request.** It runs on several endpoints; memoize it on the
  request (or a short-TTL per-session cache) so a dashboard load doesn't recompute it N times.
- **Avoid N+1 in the dashboard** — it already uses subselects; keep aggregations in SQL, not loops.
- **Connection pool** is `max: 20` with a 10s connect timeout (post-hardening). Size per the
  concurrent-student count; a class of 30 doing flashcards is bursty.

## 4. Caching & static delivery

- **Branding + UI profile** (`/api/branding`, `/api/ui/profile`) are near-static — add HTTP cache
  headers; the cockpit fetches them on every load.
- **Education UI** is bind-mounted for hot-swap in dev; in production it's baked — serve with
  long-lived cache headers + content hashing.

## 5. Throughput & fairness at scale

- **Per-tenant job queues** (the broker decision in [ADR 035](../adr/035-multi-tenant-saas-foundation.md))
  are where fairness lives — one busy school can't starve another's lecture processing, and the
  per-seat cap is enforced here.
- **Bot concurrency**: lecture processing is the heaviest path; cap concurrent transcript jobs per
  tenant so a 30-student "process my lecture" burst queues instead of melting the LLM budget.

## 6. Reports & usability (opportunities)

- **Teacher class analytics** — aggregate (already-private) quiz averages, flashcard engagement,
  and lecture counts per class into a teacher dashboard. The data exists (`lm_quiz_results`,
  `lm_flashcard_progress`); it just needs a teacher-scoped aggregate endpoint + view. This is the
  highest-value *new* surface for a school.
- **Recent-lectures strip** (already shipped) — keep it scoped to accessible classes (it is) and
  paginate if a class accrues many lectures.
- **Skeleton loading + count-up** (already on the dashboard) — extend to the tutor/flashcards for
  perceived speed.

## Quick wins to do first

1. Memoize `listAccessibleClassIds` per request.
2. Add the `lm_enrollments(student_id, class_id)` composite index.
3. Cache-headers on `/api/branding` + `/api/ui/profile`.
4. Explicit prompt caching on the tutor grounding block.
5. Teacher class-analytics endpoint + view (new value).
