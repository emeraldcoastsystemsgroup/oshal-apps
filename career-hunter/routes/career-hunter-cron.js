"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEveningScrapeIndex = runEveningScrapeIndex;
exports.isEveningChainRunning = isEveningChainRunning;
exports.startCareerHunterCron = startCareerHunterCron;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-05 14:33:49 | roger.murphy@emeraldcoastsystemsgroup.com   | Add Change Log header; capture + unref the cron interval handle (2026-07-05 leak audit)
 */
/**
 * Career Hunter cron — a small, gated app-owned timer (Phase 1).
 *
 * When CAREER_HUNTER_CRON=1, runs the daily rhythm the old Windows Scheduled Tasks did,
 * now as OSHAL work: a SHARED nightly corpus pull (once for all users), then a per-user
 * midday score + auto-draft enqueue (which surfaces approval_required tickets the operator
 * acts on in the Approvals surface). Off by default so heavy scrapes never fire unexpectedly
 * in dev. (Phase 2 moves this onto schedule-runtime / the queue manager proper.)
 *
 * Two hardenings after the 2026-06-30 incident (engine dead + a frozen/missed nightly run):
 *   1. NON-BLOCKING execution — runSharedPull/runUserScore now resolve on child exit instead
 *      of spawnSync, so a multi-hour scrape no longer freezes the API event loop.
 *   2. BOOT CATCH-UP — the in-memory window tracker silently skips a day whenever the
 *      container is recreated after a window. On start we run a one-shot catch-up: score
 *      always (idempotent — only unscored in-lane roles cost anything) and pull only if the
 *      shared corpus is stale (>20h), so a post-window restart recovers without re-scraping
 *      on every bounce.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * 2026-06-16 18:40:00 | roger.murphy@agenticfederal.us | Initial gated cron for the career-hunter app.
 * 2026-06-30          | Claude (Opus 4.8)              | Non-blocking pull/score + stale-gated boot catch-up.
 * 2026-07-15 07:25:00 | roger.murphy@emeraldcoastsystemsgroup.com | Third daily job: per-user digest (13:00 window, after the midday score) — notifies each user of NEW high-fit matches over their own connected channel. Boot catch-up is safe: the persistent once/day guard lives in Postgres (career_digest_settings.last_digest_at), not this process's lastRun map.
 * 2026-07-15 17:28:14 | roger.murphy@emeraldcoastsystemsgroup.com | Bound the boot catch-up + add the title pass. Catch-up score now honors a PERSISTENT >20h per-user cursor (career_score_settings.last_cron_score_at — the in-memory lastRun map dies on recreate, which is exactly how every api recreate re-ran `score --min-keyword 40` unbounded for hours, killed manually 3x) and caps each catch-up run with --limit (CAREER_SCORE_CATCHUP_LIMIT, default 300; `--days` is a documented no-op on null posted_date so it is NOT used). After each user's keyword pass, a BOUNDED title pass scores roles matching their stored title_terms (career-title-score) — the productized version of the manual score_batch(title_any=[...]) run.
 * 2026-07-16 00:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Jobs-2026 cutover reschedule (operator: "scrape 6pm, index right after, every morning you get yesterday's jobs"). (1) Windows are now CHICAGO-LOCAL via Intl (NOT a global container TZ env — that would shift trading market-hours / the 5pm-CT recap). (2) Replaced the split 04:00 pull + 12:30 score with ONE evening scrape+index chain at 18:00 CT: shared scrape → keyword-match EVERY user (was users[0] only — a real multi-user bug) → AI score (now --first-seen-days bounded: ONE index per candidate against NEW jobs, not the whole backlog) → title pass → enqueue. (3) Digest moved to 07:00 CT so the morning delivery reflects the prior evening's drop. Boot catch-up + persistent cursors (score >20h, digest last_digest_at >20h) unchanged, so recreates never double-spend.
 * 2026-07-17 02:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | Killed-scrape recovery + day-slot fixes (2026-07-16 night: two api recreates killed the 18:00 scrape mid-run; 0 rows landed and NOTHING recovered it). (1) Catch-up staleness is now WINDOW-ANCHORED — "was the corpus refreshed since the most recent 18:00-CT window?" — instead of a flat >20h age test, which a killed evening run always passes (the corpus still looks fresh from the previous refresh). (2) A pre-window catch-up firing no longer consumes TODAY's slot: the recovery scrape belongs to yesterday, so tonight's 18:00 window still runs; same fix for the digest — a pre-07:00 boot used to stamp lastRun.digest while the >20h guard refused the send, silently skipping the day's 07:00 digest. (3) Catch-up score is skipped when the recovery chain just fired (it ends in scoreAllUsers itself; two concurrent scorers would fight over the single-writer per-user SQLite). runEveningScrapeIndex is now exported + single-flighted so the admin refresh route/tool can trigger the same chain.
 * 2026-07-17 02:35:00 | roger.murphy@emeraldcoastsystemsgroup.com | Recovery signal → COMPLETION MARKER (.last-evening-run in the tenant dir, on the volume). Ten minutes after the first recovery fired, ANOTHER agent's deploy recreated the api and killed it — and because the scrape writes rows progressively, the partially-scraped corpus looked "refreshed since the window" and the corpus-timestamp test refused to re-fire. Only a chain that finishes with a successful scrape writes the marker; catch-up fires whenever the marker predates the most recent 18:00 window (or is missing). Survives any number of mid-run recreates.
 * 2026-07-19 17:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Evening chain now mirrors each user's freshly-indexed jobs into their person graph (ADR-045 — the package-side call for kernel 85931d2a's ingestJobsForPerson). Fired fire-and-forget (void) right after each user's index step (pull for users[0], match for the rest); ingestJobsGraphForUser is fail-open by contract (engine-absent no-op, errors logged + swallowed), so the scrape/index rhythm is never blocked or failed by graph availability.
 * 2026-07-24 02:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | AUTOMATION IS EXPLICIT OPT-IN (operator directive 2026-07-24: the chain generated + queued application drafts for jobs the operator never picked). Per-user gate on career_automation_settings.auto_generate (migration 091, absent row = OFF): scoreAllUsers now SKIPS the AI score + title pass + draft enqueue for any user who has not opted in, and a CRON-triggered evening chain skips the shared scrape entirely when NO user has opted in. The operator's explicit admin refresh (POST /run/refresh / the career_refresh tool) passes manualRefresh:true — it still refreshes the shared corpus + keyword index (data, no LLM, no tickets), while score/enqueue stay per-user gated.
 *
 * @module career-hunter-cron
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const career_hunter_routes_1 = require("./career-hunter-routes");
const career_digest_1 = require("./career-digest");
const career_title_score_1 = require("./career-title-score");
const career_automation_1 = require("./career-automation");
const career_graph_routes_1 = require("./career-graph-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'career-hunter-cron' });
let started = false;
const lastRun = {}; // job -> YYYY-MM-DD it last ran (this process)
/** AMERICA/CHICAGO local hour:minute + date key for the tick windows. We convert explicitly via
 *  Intl (full-icu is bundled in the container's Node) instead of setting a global TZ env, so the
 *  cron's "6pm / 7am" are Central regardless of the UTC container clock — and nothing else that
 *  reads local time (trading market hours, the 5pm-CT recap) is disturbed. The
 *  `day` key is Chicago-local too, so "once per day" aligns to the operator's day. */
function clock() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value || '00';
    let hh = Number(get('hour'));
    if (hh === 24)
        hh = 0; // Intl emits 24 at midnight in some ICU builds
    return { hh, mm: Number(get('minute')), day: `${get('year')}-${get('month')}-${get('day')}` };
}
/** Milliseconds elapsed since the most recent 18:00-CT window opened. The recovery test is
 *  "did the corpus get refreshed AFTER the last window?" — a flat age threshold can never
 *  catch a killed evening run, because the corpus still looks fresh from the refresh before. */
function msSinceLastEveningWindow(hh, mm) {
    const minutesSince = ((hh * 60 + mm) - 18 * 60 + 24 * 60) % (24 * 60);
    return minutesSince * 60_000;
}
/** The evening chain's COMPLETION marker (tenant dir, on the data volume — survives container
 *  recreates). Corpus row timestamps can NOT be the recovery signal: the scrape writes rows
 *  progressively, so a run killed minutes in leaves the corpus looking "refreshed since the
 *  window" (exactly how the 07:14Z recreate defeated the first version of this recovery).
 *  Only a chain that finished with a SUCCESSFUL scrape writes the marker. */
function eveningMarkerPath(anyUserSub) {
    return path_1.default.join(path_1.default.dirname((0, career_hunter_routes_1.userPaths)(anyUserSub).corpusDb), '.last-evening-run');
}
function readEveningMarkerMs(anyUserSub) {
    try {
        const t = new Date(fs_1.default.readFileSync(eveningMarkerPath(anyUserSub), 'utf8').trim()).getTime();
        return Number.isFinite(t) ? t : null;
    }
    catch {
        return null;
    }
}
function writeEveningMarker(anyUserSub) {
    try {
        fs_1.default.writeFileSync(eveningMarkerPath(anyUserSub), new Date().toISOString(), 'utf8');
    }
    catch (err) {
        logger.error({ err }, 'career-hunter cron: evening marker write failed');
    }
}
/** Per-run cap for a CATCH-UP keyword score (`--limit`). A recreate with a big unscored
 *  backlog used to re-score for hours; the daily 12:30 window run stays unbounded so the
 *  backlog still drains at the normal rhythm. (`--days` is NOT a usable bound here — the
 *  engine's date gate skips the many rows with null posted_date; see runUserScore.) */
const CATCHUP_SCORE_LIMIT = Math.max(1, Number(process.env.CAREER_SCORE_CATCHUP_LIMIT) || 300);
/** NEW-jobs window for the nightly AI score (`--first-seen-days`). The operator's model is ONE
 *  index per candidate against jobs NEW to the corpus, not a re-drain of history. 8 days is a
 *  safe buffer that still catches a missed scrape day while staying ~0-cost when nothing landed. */
const SCORE_FIRST_SEEN_DAYS = Math.max(1, Number(process.env.CAREER_SCORE_FIRST_SEEN_DAYS) || 8);
/** Score every per-user store (keyword pass, then the bounded title pass), then enqueue
 *  its top fresh drafts. Sequential per user so the per-user SQLite only ever has one
 *  writer. On catch-up boots the keyword pass is DOUBLY bounded: skipped entirely when the
 *  persistent cursor says this user already had a cron score in the last ~20h (survives
 *  recreates, unlike the in-memory lastRun map), and capped with --limit when it does run.
 *  The title pass carries its own persistent >20h guard + limit inside runTitlePassForUser. */
async function scoreAllUsers(ctx, opts = {}) {
    for (const userSub of (0, career_hunter_routes_1.listStoreUsers)()) {
        try {
            // EXPLICIT OPT-IN (2026-07-24): no auto_generate opt-in → no AI score, no title pass,
            // no draft enqueue for this user. Absent settings row = OFF (default-deny).
            if (!(await (0, career_automation_1.readAutomationSettingsSystem)(ctx, userSub)).autoGenerate) {
                logger.info({ userSub, catchup: !!opts.catchup }, 'career-hunter cron: user skipped — automation opt-in is OFF');
                continue;
            }
            let keywordPass = 'ran';
            if (opts.catchup && !(await (0, career_title_score_1.dueForCronScore)(ctx.pool, userSub))) {
                keywordPass = 'skipped-cursor';
            }
            else {
                // Both paths bound to NEW jobs (--first-seen-days); the catch-up also caps with --limit.
                await (0, career_hunter_routes_1.runUserScore)(userSub, opts.catchup
                    ? { firstSeenDays: SCORE_FIRST_SEEN_DAYS, limit: CATCHUP_SCORE_LIMIT }
                    : { firstSeenDays: SCORE_FIRST_SEEN_DAYS });
                await (0, career_title_score_1.markCronScore)(ctx.pool, userSub);
            }
            const titlePass = await (0, career_title_score_1.runTitlePassForUser)(ctx, userSub);
            const n = await (0, career_hunter_routes_1.enqueueForUser)(ctx, userSub, 10);
            logger.info({ userSub, keywordPass, titlePass, queued: n, catchup: !!opts.catchup }, 'career-hunter cron: scored + enqueued');
        }
        catch (err) {
            logger.error({ err, userSub }, 'career-hunter cron: per-user score failed');
        }
    }
}
let eveningChainRunning = false;
/**
 * @description The evening chain (operator's "scrape 6pm, index right after"): scrape the SHARED
 * corpus once, keyword-index EVERY user against the new rows (runSharedPull already matched
 * users[0]; match the rest), then AI-score (first-seen bounded) + title-pass + enqueue for all.
 * Sequential so each per-user SQLite has a single writer. Runs detached from the tick (multi-hour
 * scrape). Single-flighted: the cron window, the boot recovery, and the admin refresh route all
 * funnel here, and two concurrent chains would double-scrape + fight over the SQLite writers.
 * @param ctx app context
 * @param users the per-user store subs to index (from listStoreUsers)
 * @returns true when the chain ran; false when one was already in flight
 */
async function runEveningScrapeIndex(ctx, users, opts = {}) {
    if (eveningChainRunning) {
        logger.warn('career-hunter cron: evening scrape/index already in flight — skipped');
        return false;
    }
    // EXPLICIT OPT-IN (2026-07-24): a CRON-triggered chain with no opted-in users does nothing
    // at all — no scrape, no score, no drafts. Only the operator's explicit refresh bypasses
    // the scrape gate (and only the scrape/index: drafts stay gated per user).
    if (!opts.manualRefresh) {
        let anyOptedIn = false;
        for (const u of users) {
            try {
                if ((await (0, career_automation_1.readAutomationSettingsSystem)(ctx, u)).autoGenerate) {
                    anyOptedIn = true;
                    break;
                }
            }
            catch (err) {
                logger.error({ err, userSub: u }, 'career-hunter cron: automation opt-in read failed — treating as OFF');
            }
        }
        if (!anyOptedIn) {
            logger.info({ users: users.length }, 'career-hunter cron: evening chain skipped — no user has opted in to automation');
            return false;
        }
    }
    eveningChainRunning = true;
    logger.info({ users: users.length }, 'career-hunter cron: evening scrape + index starting');
    try {
        const r = await (0, career_hunter_routes_1.runSharedPull)(users[0]); // shared scrape + keyword-match users[0]
        logger.info({ ok: r.ok }, 'career-hunter cron: scrape finished — indexing all users');
        // Jobs-write seam → person graph (ADR-045): mirror each user's fresh index fire-and-forget.
        // ingestJobsGraphForUser NEVER rejects (engine-absent no-op; errors logged + swallowed).
        if (r.ok)
            void (0, career_graph_routes_1.ingestJobsGraphForUser)(users[0]);
        for (let i = 1; i < users.length; i++) {
            try {
                await (0, career_hunter_routes_1.runUserMatch)(users[i]); // keyword-match the rest against the fresh corpus
                void (0, career_graph_routes_1.ingestJobsGraphForUser)(users[i]);
            }
            catch (err) {
                logger.error({ err, userSub: users[i] }, 'career-hunter cron: per-user match failed');
            }
        }
        await scoreAllUsers(ctx); // window run: --first-seen-days bounded AI score + title + enqueue, all users
        // Marker only on a SUCCESSFUL scrape: a failed/killed pull must leave the chain
        // recoverable at the next boot, even though the index steps above still ran.
        if (r.ok)
            writeEveningMarker(users[0]);
        logger.info({ scrapeOk: r.ok }, 'career-hunter cron: evening scrape + index complete');
    }
    catch (err) {
        logger.error({ err }, 'career-hunter cron: evening scrape/index failed');
    }
    finally {
        eveningChainRunning = false;
    }
    return true;
}
/** Whether the evening scrape+index chain is currently in flight (for the admin status route). */
function isEveningChainRunning() {
    return eveningChainRunning;
}
async function tick(ctx, opts = {}) {
    const { hh, mm, day } = clock();
    const users = (0, career_hunter_routes_1.listStoreUsers)();
    if (!users.length)
        return;
    // Evening scrape + index — 18:00–18:14 CT, once/day. On a catch-up boot, also fire when the
    // chain did NOT COMPLETE since the most recent 18:00 window — the signature of a run missed
    // or killed by a container recreate (2026-07-16/17: recreates killed two runs; corpus-row
    // freshness can't be the signal because the scrape writes progressively, and a flat >20h age
    // test never fires because the corpus still looks fresh from the refresh before).
    let firedScrapeNow = false;
    if (lastRun.scrapeIndex !== day) {
        const inWindow = hh === 18 && mm < 15;
        const markerMs = readEveningMarkerMs(users[0]);
        const staleCatchup = !!opts.catchup
            && (markerMs === null || Date.now() - markerMs > msSinceLastEveningWindow(hh, mm));
        if (inWindow || staleCatchup) {
            // A pre-window recovery run belongs to YESTERDAY's slot — only consume today's when the
            // window has passed, so tonight's 18:00 scrape still runs after an early-morning recovery.
            if (hh >= 18)
                lastRun.scrapeIndex = day;
            firedScrapeNow = true;
            void runEveningScrapeIndex(ctx, users); // detached — the scrape is multi-hour
        }
    }
    // Catch-up score (boot only, NO scrape) — surfaces recent jobs if we started after the evening
    // window with the corpus already fresh. Skipped when the evening index ran today OR the recovery
    // chain just fired (it ends in scoreAllUsers itself; the per-user SQLite is single-writer); the
    // persistent >20h per-user cursor + --first-seen-days + --limit make it cheap if nothing's new.
    if (!!opts.catchup && !firedScrapeNow && lastRun.score !== day && lastRun.scrapeIndex !== day) {
        lastRun.score = day;
        await scoreAllUsers(ctx, { catchup: true });
    }
    // Morning digest — 07:00–07:14 CT, once/day, so the morning delivery reflects the prior
    // evening's index. Persistent Postgres guard (last_digest_at >20h) prevents boot double-sends.
    // A catch-up boot fires this only AT/AFTER 07:00 CT: a pre-window boot must leave the day's
    // slot alone (stamping it while the >20h guard refuses the send silently ate the 07:00 digest).
    if (lastRun.digest !== day) {
        const inWindow = hh === 7 && mm < 15;
        if (inWindow || (!!opts.catchup && hh >= 7)) {
            lastRun.digest = day;
            await (0, career_digest_1.sendDigestsForAllUsers)(ctx);
        }
    }
}
/** Start the gated daily timer once. No-op unless CAREER_HUNTER_CRON is truthy. */
function startCareerHunterCron(ctx) {
    if (started)
        return;
    started = true;
    if (!['1', 'true', 'yes'].includes((process.env.CAREER_HUNTER_CRON || '').toLowerCase())) {
        logger.info('career-hunter cron disabled (set CAREER_HUNTER_CRON=1 to enable)');
        return;
    }
    logger.info('career-hunter cron enabled (scrape+index 18:00 CT, digest 07:00 CT, catch-up on start)');
    // One-shot catch-up ~1 min after boot so a recreate past a window doesn't skip the day.
    setTimeout(() => { void tick(ctx, { catchup: true }).catch((err) => logger.error({ err }, 'cron catch-up failed')); }, 60_000);
    const cronTimer = setInterval(() => { void tick(ctx).catch((err) => logger.error({ err }, 'cron tick failed')); }, 5 * 60 * 1000);
    cronTimer.unref();
}
//# sourceMappingURL=career-hunter-cron.js.map