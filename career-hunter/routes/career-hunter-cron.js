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
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the gated Career cron and retain an unreferenced interval handle for clean process shutdown.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Make pull and score non-blocking and add stale-gated boot catch-up.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add caller-channel daily digests with a persistent once-per-day guard.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Bound catch-up scoring with persistent cursors and add the per-user title pass.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Schedule the scrape/index chain in Chicago time and match every user before bounded scoring.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Anchor catch-up to the latest window without consuming a future daily slot.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Persist a completion marker so interrupted recovery chains retry after API restarts.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Mirror freshly indexed jobs into each owning person graph through a fail-open hook.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Require explicit per-user automation opt-in while preserving manual refresh.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Use decomposed engine and user-store boundaries and advance state only after successful child completion.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Extract the default-deny automation scan so the evening-chain coordinator remains within the function-size contract.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Complete exported cron status and startup documentation for route consumers.
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
 * @module career-hunter-cron
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const career_hunter_routes_1 = require("./career-hunter-routes");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
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
    return path_1.default.join(path_1.default.dirname((0, career_user_store_1.userPaths)(anyUserSub).corpusDb), '.last-evening-run');
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
    for (const userSub of (0, career_user_store_1.listStoreUsers)()) {
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
                const scoreResult = await (0, career_engine_dispatch_1.runUserScore)(ctx.pool, userSub, opts.catchup
                    ? { firstSeenDays: SCORE_FIRST_SEEN_DAYS, limit: CATCHUP_SCORE_LIMIT }
                    : { firstSeenDays: SCORE_FIRST_SEEN_DAYS });
                if (scoreResult.ok)
                    await (0, career_title_score_1.markCronScore)(ctx.pool, userSub);
                else {
                    keywordPass = 'failed';
                    logger.error({ userSub }, 'career-hunter cron: keyword score failed; cursor not advanced');
                }
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
/** Return true only when at least one readable user setting explicitly enables generation. */
async function anyAutomationOptIn(ctx, users) {
    for (const userSub of users) {
        try {
            if ((await (0, career_automation_1.readAutomationSettingsSystem)(ctx, userSub)).autoGenerate)
                return true;
        }
        catch (err) {
            logger.error({ err, userSub }, 'career-hunter cron: automation opt-in read failed — treating as OFF');
        }
    }
    return false;
}
/**
 * @description The evening chain (operator's "scrape 6pm, index right after"): scrape the SHARED
 * corpus once, keyword-index EVERY user against the new rows (runSharedPull already matched
 * users[0]; match the rest), then AI-score (first-seen bounded) + title-pass + enqueue for all.
 * Sequential so each per-user SQLite has a single writer. Runs detached from the tick (multi-hour
 * scrape). Single-flighted: the cron window, the boot recovery, and the admin refresh route all
 * funnel here, and two concurrent chains would double-scrape + fight over the SQLite writers.
 * @param ctx app context
 * @param users the per-user store subs to index (from listStoreUsers)
 * @param opts manualRefresh: true when an operator explicitly asked for a data refresh
 * (POST /run/refresh / the career_refresh tool) — the scrape+index runs even with zero
 * automation opt-ins because it is a data refresh, not application automation; the
 * score/enqueue steps stay per-user gated inside scoreAllUsers either way
 * @returns true when the chain ran; false when one was already in flight or it was skipped
 */
async function runEveningScrapeIndex(ctx, users, opts = {}) {
    if (eveningChainRunning) {
        logger.warn('career-hunter cron: evening scrape/index already in flight — skipped');
        return false;
    }
    // EXPLICIT OPT-IN (2026-07-24): a CRON-triggered chain with no opted-in users does nothing
    // at all — no scrape, no score, no drafts. Only the operator's explicit refresh bypasses
    // the scrape gate (and only the scrape/index: drafts stay gated per user).
    if (!opts.manualRefresh && !await anyAutomationOptIn(ctx, users)) {
        logger.info({ users: users.length }, 'career-hunter cron: evening chain skipped — no user has opted in to automation');
        return false;
    }
    eveningChainRunning = true;
    logger.info({ users: users.length }, 'career-hunter cron: evening scrape + index starting');
    try {
        const r = await (0, career_engine_dispatch_1.runSharedPull)(ctx.pool, users[0]); // shared scrape + keyword-match users[0]
        logger.info({ ok: r.ok }, 'career-hunter cron: scrape finished — indexing all users');
        // Jobs-write seam → person graph (ADR-045): mirror each user's fresh index fire-and-forget.
        // ingestJobsGraphForUser NEVER rejects (engine-absent no-op; errors logged + swallowed).
        if (r.ok)
            void (0, career_graph_routes_1.ingestJobsGraphForUser)(users[0]);
        for (let i = 1; i < users.length; i++) {
            try {
                const match = await (0, career_engine_dispatch_1.runUserMatch)(ctx.pool, users[i]); // keyword-match the rest against the fresh corpus
                if (match.ok)
                    void (0, career_graph_routes_1.ingestJobsGraphForUser)(users[i]);
                else
                    logger.error({ userSub: users[i] }, 'career-hunter cron: per-user match failed');
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
/**
 * @description Reports whether the shared evening scrape and index coordinator owns its flight.
 * @returns true while one scheduled, recovery, or manual chain is active
 */
function isEveningChainRunning() {
    return eveningChainRunning;
}
async function tick(ctx, opts = {}) {
    const { hh, mm, day } = clock();
    const users = (0, career_user_store_1.listStoreUsers)();
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
/**
 * @description Starts the gated daily timer once and remains inert unless the cron flag is true.
 * @param ctx kernel services used by scheduled Career operations
 * @returns nothing after startup is enabled, disabled, or already complete
 */
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