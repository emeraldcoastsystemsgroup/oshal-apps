"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.dueSince = dueSince;
exports.normalizeTitleTerms = normalizeTitleTerms;
exports.deriveTitleTermsFromRoles = deriveTitleTermsFromRoles;
exports.deriveTitleTermsFromResume = deriveTitleTermsFromResume;
exports.buildTitlePassInvocation = buildTitlePassInvocation;
exports.saveRemoteOnly = saveRemoteOnly;
exports.readTitleProfile = readTitleProfile;
exports.getOrSeedTitleProfile = getOrSeedTitleProfile;
exports.saveTitleProfile = saveTitleProfile;
exports.dueForCronScore = dueForCronScore;
exports.markCronScore = markCronScore;
exports.runTitlePassForUser = runTitlePassForUser;
exports.startTitlePassForUser = startTitlePassForUser;
exports.registerCareerTitleScoreRoutes = registerCareerTitleScoreRoutes;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_file_transaction_1 = require("./career-file-transaction");
const career_search_scope_1 = require("./career-search-scope");
const career_geo_1 = require("./career-geo");
const career_nightly_match_1 = require("./career-nightly-match");
const logger = (0, logger_1.createChildLogger)({ module: 'career-title-score' });
/** Persistent once/~day guard width (hours) — tolerant of cron-window drift, like the digest. */
const GUARD_HOURS = 20;
/** Hard cap on stored title terms (the SQL becomes one LIKE per term). */
const MAX_TERMS = 16;
/** Per-run posting cap for the daily title pass (env-tunable). */
const TITLE_PASS_LIMIT = Math.max(1, Number(process.env.CAREER_TITLE_PASS_LIMIT) || 150);
const NATIVE_CURSOR = 'title-pass-success.json';
function nativeOwnerMounted() {
    return process.env.OSHAL_EGRESS === 'kernel' && process.env.OSHAL_CAREER_OWNER_MOUNT === '1';
}
/** A native cursor is published in the same owner generation as its successful scores. */
function nativeTitlePassAt(userSub) {
    if (!nativeOwnerMounted())
        return null;
    try {
        const file = path.join((0, career_user_store_1.userPaths)(userSub).userDir, NATIVE_CURSOR);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512)
            return null;
        const record = JSON.parse(fs.readFileSync(file, 'utf8'));
        const at = Date.parse(record?.lastTitlePassAt);
        return record?.version === 1 && typeof record.lastTitlePassAt === 'string'
            && Number.isFinite(at) && at <= Date.now() + 60_000
            && new Date(at).toISOString() === record.lastTitlePassAt ? record.lastTitlePassAt : null;
    }
    catch {
        return null;
    }
}
/** Read only the count-only terminal record emitted by the title scorer. */
function titlePassSummary(stdout) {
    for (const line of (stdout || '').split(/\r?\n/).reverse()) {
        if (!line.startsWith('{'))
            continue;
        try {
            const value = JSON.parse(line);
            if (value?.result === 'complete' && [value.scored, value.skipped, value.terms].every(Number.isInteger)) {
                return { result: 'complete', scored: value.scored, skipped: value.skipped, terms: value.terms };
            }
            if (value?.result === 'failed' && typeof value.errorType === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.errorType)) {
                return { result: 'failed', errorType: value.errorType };
            }
        }
        catch { /* ignore non-summary output */ }
    }
    return null;
}
/**
 * @description The persistent "no more than once a ~day" guard shared by the title pass
 * and the boot catch-up score — same semantics as the digest's dueForDigest: due when
 * never run, due again only after GUARD_HOURS, and fails OPEN on an unparseable
 * timestamp (a broken cursor must never permanently disable scoring).
 * @param lastIso ISO timestamp of the last run, or null when never run
 * @param nowMs clock override for tests
 * @returns true when a new run is allowed
 */
function dueSince(lastIso, nowMs = Date.now()) {
    if (!lastIso)
        return true;
    const t = new Date(lastIso).getTime();
    if (!Number.isFinite(t))
        return true;
    return nowMs - t > GUARD_HOURS * 3_600_000;
}
/**
 * @description Normalize a user-supplied title list (comma/newline separated string, or an
 * array) into clean LIKE terms: trimmed, control-chars stripped (newline is the CH_TITLES
 * wire separator, so it can never survive inside a term), de-duplicated case-insensitively,
 * each 3..60 chars (1-2 char terms like "ai" would LIKE-match half the corpus and defeat
 * the bounding), capped at MAX_TERMS.
 * @param input raw terms from the settings form or API body
 * @returns clean, de-duplicated term list (possibly empty)
 */
/** Drop ASCII control characters (codepoints < 32 and DEL) — newline is the CH_TITLES
 *  wire separator, so no control char may ever survive inside a term. */
function stripControlChars(s) {
    let out = '';
    for (const ch of s) {
        const c = ch.charCodeAt(0);
        if (c >= 32 && c !== 127)
            out += ch;
    }
    return out;
}
/**
 * @description Normalizes untrusted title input into bounded, unique, printable search terms.
 * @param input comma/newline text or an array supplied by the settings surface
 * @returns at most the configured number of canonical title terms
 */
function normalizeTitleTerms(input) {
    const raw = Array.isArray(input)
        ? input.map((t) => String(t))
        : String(input ?? '').split(/[,\n]/);
    const seen = new Set();
    const out = [];
    for (const r of raw) {
        const term = stripControlChars(r).replace(/\s+/g, ' ').trim();
        if (term.length < 3 || term.length > 60)
            continue;
        const key = term.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(term);
        if (out.length >= MAX_TERMS)
            break;
    }
    return out;
}
/**
 * @description Derive default title terms from a user's parsed resume roles — the REAL
 * seed source (career_db.json roles[].title, written by the resume-upload ingest). Each
 * role title is split on separators, stripped of seniority prefixes and trailing level
 * suffixes (LIKE '%term%' already matches any seniority of the same role, so "Senior SAP
 * Basis Administrator" seeds the broader "SAP Basis Administrator"), then normalized.
 * Returns [] when nothing is derivable — never a hardcoded guess.
 * @param roles the parsed resume roles ({title} objects)
 * @returns derived title terms, broadest-useful form, de-duplicated
 */
function deriveTitleTermsFromRoles(roles) {
    const candidates = [];
    for (const role of roles || []) {
        const title = String(role?.title ?? '').trim();
        if (!title)
            continue;
        for (const segment of title.split(/[/|,;]|\s[-–—]\s/)) {
            let t = segment.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
            // Strip leading seniority/level words (repeatedly: "Sr. Staff Engineer" -> "Engineer").
            for (;;) {
                const stripped = t.replace(/^(senior|sr\.?|staff|principal|lead|junior|jr\.?|associate|interim)\s+/i, '');
                if (stripped === t)
                    break;
                t = stripped;
            }
            // Strip trailing level markers ("Engineer II", "Architect 3").
            t = t.replace(/\s+(i{1,3}v?|iv|v|\d)$/i, '').trim();
            if (t)
                candidates.push(t);
        }
    }
    return normalizeTitleTerms(candidates).slice(0, 12);
}
/**
 * @description Read the user's career_db.json (per-user, written by resume ingest) and
 * derive default title terms from its roles. Missing/unreadable file = [] (clean skip).
 * @param userSub the per-user store owner
 * @returns derived terms, or [] when no resume profile exists yet
 */
function deriveTitleTermsFromResume(userSub) {
    try {
        const careerDb = path.join((0, career_user_store_1.userPaths)(userSub).userDir, 'career_db.json');
        if (!fs.existsSync(careerDb))
            return [];
        const d = JSON.parse(fs.readFileSync(careerDb, 'utf8'));
        return deriveTitleTermsFromRoles(Array.isArray(d.roles) ? d.roles : []);
    }
    catch (err) {
        logger.error({ err, userSub }, 'title profile: resume derivation failed');
        return [];
    }
}
/**
 * @description Build the engine invocation for a bounded title pass: the oshal-jobhunter
 * `score-titles` verb, terms newline-joined into CH_TITLES (commas can appear inside a
 * term; newlines cannot survive normalizeTitleTerms), run cap in CH_LIMIT, seven-day posting
 * window, and the user's remote-only setting. Pure — exists so tests can pin the exact wire
 * format the Python side parses.
 * @param terms normalized title terms (must be non-empty; the engine refuses an empty list
 * because score_batch with a falsy title_any would score EVERYTHING unbounded)
 * @param limit max postings this run may AI-score
 * @param remoteOnly the user's standing remote-only matching preference
 * @returns CLI args + extra env for the Career engine
 */
function buildTitlePassInvocation(terms, limit, remoteOnly = false) {
    return {
        args: ['score-titles'],
        env: {
            CH_TITLES: terms.join('\n'),
            CH_LIMIT: String(Math.max(1, Math.floor(limit))),
            CH_FRESH_DAYS: '7',
            CH_REMOTE_ONLY: remoteOnly ? '1' : '0',
        },
    };
}
/** Map a career_score_settings row (or absence) to a TitleProfile. */
function toProfile(row, userSub) {
    const nativeAt = nativeTitlePassAt(userSub);
    if (!row)
        return { titleTerms: [], source: 'unset', lastTitlePassAt: nativeAt, lastCronScoreAt: null, remoteOnly: false };
    const storedAt = row.last_title_pass_at ? new Date(row.last_title_pass_at).toISOString() : null;
    return {
        titleTerms: Array.isArray(row.title_terms) ? row.title_terms : [],
        source: row.title_terms_source === 'derived' || row.title_terms_source === 'user' ? row.title_terms_source : 'unset',
        lastTitlePassAt: nativeAt && (!storedAt || Date.parse(nativeAt) > Date.parse(storedAt)) ? nativeAt : storedAt,
        lastCronScoreAt: row.last_cron_score_at ? new Date(row.last_cron_score_at).toISOString() : null,
        remoteOnly: row.remote_only === true,
    };
}
/**
 * @description Persist the standing remote-only matching preference.
 *
 * Upserts the settings row so a user who has never opened Target titles can still set it; only
 * this column is written, so it can never disturb `title_terms` or either cron cursor.
 * @param pool Postgres pool
 * @param userSub the user
 * @param remoteOnly the new value
 * @returns the stored value
 */
async function saveRemoteOnly(pool, userSub, remoteOnly) {
    await pool.query(`INSERT INTO career_score_settings (user_sub, remote_only) VALUES ($1, $2)
     ON CONFLICT (user_sub) DO UPDATE SET remote_only = EXCLUDED.remote_only, updated_at = NOW()`, [userSub, remoteOnly]);
    return remoteOnly;
}
/**
 * @description Read the user's stored title profile. Null-safe: no row = empty profile.
 * The cron uses this (it never seeds — only a settings visit does, so a user who never
 * opened settings costs nothing).
 * @param pool Postgres pool
 * @param userSub the user
 * @returns the stored profile, or the empty default
 */
async function readTitleProfile(pool, userSub) {
    const r = await pool.query(`SELECT title_terms, title_terms_source, last_title_pass_at, last_cron_score_at, remote_only
       FROM career_score_settings WHERE user_sub=$1`, [userSub]);
    return toProfile(r.rows[0], userSub);
}
/**
 * @description Read the profile, seeding it from the user's parsed resume on first visit:
 * when no row exists and the resume yields terms, they are persisted as source='derived'
 * so the user sees (and can edit) exactly what the cron will run. No resume = the empty
 * profile, unsaved, so a later resume upload can still seed.
 * @param pool Postgres pool
 * @param userSub the user
 * @returns the stored or freshly seeded profile
 */
async function getOrSeedTitleProfile(pool, userSub) {
    const existing = await pool.query(`SELECT title_terms, title_terms_source, last_title_pass_at, last_cron_score_at, remote_only
       FROM career_score_settings WHERE user_sub=$1`, [userSub]);
    const current = toProfile(existing.rows[0], userSub);
    // Seed only when there are no terms AND the user never saved (source='user' with an empty
    // list is a deliberate opt-out). Checking terms — not row existence — matters: markCronScore
    // creates a cursor-only row long before any settings visit, and the old "no row" test let
    // that row permanently block resume-derived seeding (every user showed no-title-profile).
    if (current.titleTerms.length || current.source === 'user')
        return current;
    const derived = deriveTitleTermsFromResume(userSub);
    if (!derived.length)
        return current;
    await pool.query(`INSERT INTO career_score_settings (user_sub, title_terms, title_terms_source)
     VALUES ($1, $2, 'derived')
     ON CONFLICT (user_sub) DO UPDATE SET title_terms=$2, title_terms_source='derived', updated_at=NOW()
     WHERE career_score_settings.title_terms_source IS DISTINCT FROM 'user'`, [userSub, derived]);
    logger.info({ userSub, terms: derived.length }, 'title profile: seeded from resume roles');
    return { ...current, titleTerms: derived, source: 'derived' };
}
/**
 * @description Save the user's edited title terms (source='user'). An empty list is a
 * valid save — it clears the profile and turns the daily title pass off for this user.
 * @param pool Postgres pool
 * @param userSub the user
 * @param terms already-normalized terms
 * @returns nothing after the user-owned profile is persisted
 */
async function saveTitleProfile(pool, userSub, terms) {
    await pool.query(`INSERT INTO career_score_settings (user_sub, title_terms, title_terms_source)
     VALUES ($1, $2, 'user')
     ON CONFLICT (user_sub) DO UPDATE SET title_terms=$2, title_terms_source='user', updated_at=NOW()`, [userSub, terms]);
}
/**
 * @description Whether the cron/boot-catch-up keyword score may run for this user — the
 * persistent >20h guard (last_cron_score_at) that makes api recreates cheap: the in-memory
 * lastRun map dies with the process, this cursor does not.
 * @param pool Postgres pool
 * @param userSub the user
 * @returns nothing after the persistent cursor is advanced
 * @returns true when a cron score is allowed
 */
async function dueForCronScore(pool, userSub) {
    const r = await pool.query(`SELECT last_cron_score_at FROM career_score_settings WHERE user_sub=$1`, [userSub]);
    return dueSince(r.rows[0]?.last_cron_score_at ?? null);
}
/**
 * @description Advance the persistent cron-score cursor after a cron-driven score run
 * (window AND catch-up), so a recreate later the same day skips the user entirely.
 * @param pool Postgres pool
 * @param userSub the user
 * @returns nothing after the durable score cursor advances
 */
async function markCronScore(pool, userSub) {
    await pool.query(`INSERT INTO career_score_settings (user_sub, last_cron_score_at) VALUES ($1, NOW())
     ON CONFLICT (user_sub) DO UPDATE SET last_cron_score_at=NOW(), updated_at=NOW()`, [userSub]);
}
/** Parse the engine's JSON verdict line ({"scored":N,"skipped":M,...}) from CLI output. */
function parseEngineVerdict(out) {
    try {
        const line = out.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
        if (!line)
            return {};
        const v = JSON.parse(line);
        return { scored: v.scored, skipped: v.skipped };
    }
    catch {
        return {};
    }
}
/**
 * @description Run one user's bounded title pass end-to-end: stored-profile gate → >20h
 * persistent guard → the SHARED per-user single-flight guard (verb key 'score', so a
 * title pass can never write the same per-user SQLite concurrently with a manual or cron
 * keyword score — SQLite is single-writer) → runCliAwait (NEVER spawnSync; the event loop
 * stays free) → advance the cursor only on a REAL successful run.
 * @param ctx app context (pool)
 * @param userSub the user
 * @param opts force bypasses the >20h guard (the explicit run-now button)
 * @returns what happened, for logs/routes
 */
async function runTitlePassForUser(ctx, userSub, opts = {}) {
    const profile = await readTitleProfile(ctx.pool, userSub);
    if (!profile.titleTerms.length)
        return { ran: false, reason: 'no-title-profile' };
    if (!opts.force && !dueSince(profile.lastTitlePassAt))
        return { ran: false, reason: 'already-ran-today' };
    try {
        const inv = buildTitlePassInvocation(profile.titleTerms, TITLE_PASS_LIMIT, profile.remoteOnly);
        const r = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, inv.args, inv.env, { slot: 'score', ownerIssuer: opts.ownerIssuer ?? null });
        if (r.limitReason) {
            logger.info({ userSub, limit: r.limitReason }, 'title pass: skipped - score run in flight or box busy');
            return { ran: false, reason: r.limitReason === 'inflight' ? 'score-in-flight' : 'busy' };
        }
        if (!r.ok) {
            logger.error({ userSub, err: r.err.slice(-400) }, 'title pass: engine run failed');
            return { ran: false, reason: 'engine-failed' };
        }
        const verdict = parseEngineVerdict(r.out);
        await markTitlePassCursor(ctx.pool, userSub);
        logger.info({ userSub, ...verdict, terms: profile.titleTerms.length, limit: TITLE_PASS_LIMIT }, 'title pass: done');
        return { ran: true, ...verdict };
    }
    catch (err) {
        logger.error({ err, userSub }, 'title pass: failed');
        return { ran: false, reason: 'error' };
    }
}
/** Advance the daily cursor only after a title-scoring child exits successfully. */
async function markTitlePassCursor(pool, userSub) {
    if (nativeOwnerMounted()) {
        // Bot-run continuations may score and log, but may not issue SQL. Keep this
        // cursor inside the already-admitted owner stage: a failed publication cannot
        // advance the cursor ahead of the scores it describes.
        const file = path.join((0, career_user_store_1.userPaths)(userSub).userDir, NATIVE_CURSOR);
        await (0, career_file_transaction_1.writeFileAtomicAsync)(file, JSON.stringify({ version: 1, lastTitlePassAt: new Date().toISOString() }) + '\n');
        await fs.promises.chmod(file, 0o600);
        return;
    }
    await pool.query(`INSERT INTO career_score_settings (user_sub, last_title_pass_at) VALUES ($1, NOW())
     ON CONFLICT (user_sub) DO UPDATE SET last_title_pass_at=NOW(), updated_at=NOW()`, [userSub]);
}
/**
 * @description Start a caller-triggered title pass as acknowledged background work. The app
 * request returns as soon as the native kernel keeps the run's sandbox alive; successful child
 * completion advances the persistent cursor, while a failed run remains eligible for retry.
 * @param ctx app context (pool)
 * @param userSub the authenticated user
 * @param opts optional verified owner issuer and smaller manual batch limit
 * @returns start acknowledgement, run id, or a safe start refusal
 */
async function startTitlePassForUser(ctx, userSub, opts = {}) {
    const profile = await readTitleProfile(ctx.pool, userSub);
    if (!profile.titleTerms.length)
        return { started: false, reason: 'no-title-profile' };
    const limit = opts.limit ?? TITLE_PASS_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > TITLE_PASS_LIMIT)
        throw new RangeError('Invalid title pass limit');
    const inv = buildTitlePassInvocation(profile.titleTerms, limit, profile.remoteOnly);
    let runId;
    const result = await (0, career_engine_dispatch_1.runCareerCliAsync)(ctx.pool, userSub, inv.args, inv.env, {
        slot: 'score',
        captureStdout: true,
        ownerIssuer: opts.ownerIssuer ?? null,
        onRunStarted: (id) => { runId = id; },
        onComplete: async (completion) => {
            const summary = titlePassSummary(completion.stdout);
            if (!completion.ok || summary?.result !== 'complete') {
                logger.warn({
                    userSub, runId, code: completion.code, timedOut: completion.timedOut,
                    errorType: summary?.result === 'failed' ? summary.errorType : undefined,
                }, 'title pass: background run failed; cursor not advanced');
                return;
            }
            try {
                await markTitlePassCursor(ctx.pool, userSub);
                logger.info({ userSub, runId, terms: profile.titleTerms.length, limit, scored: summary.scored, skipped: summary.skipped }, 'title pass: background run complete');
            }
            catch (err) {
                logger.error({ err, userSub, runId }, 'title pass: completion cursor update failed');
            }
        },
    });
    if (result.limitReason) {
        return { started: false, reason: result.limitReason === 'inflight' ? 'score-in-flight' : 'busy' };
    }
    if (!result.started) {
        logger.error({ userSub, err: result.err?.slice(-400) }, 'title pass: background start failed');
        return { started: false, reason: 'engine-failed' };
    }
    return { started: true, ...(runId ? { runId } : {}) };
}
/**
 * @description Settings-surface routes on the career-hunter router (parent-mounted behind
 * requiresAuth, per-user scoped by OIDC sub like every sibling): read/seed the profile,
 * save edited terms, and an explicit bounded run-now.
 * @param router the career-hunter router
 * @param ctx app context
 * @returns nothing after title-profile routes are mounted
 */
function registerCareerTitleScoreRoutes(router, ctx) {
    const pool = ctx.pool;
    router.get('/title-profile/state', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        try {
            const p = await getOrSeedTitleProfile(pool, userSub);
            const { userDir } = (0, career_user_store_1.userPaths)(userSub);
            res.json({ ...p, dailyLimit: TITLE_PASS_LIMIT, searchScope: (0, career_search_scope_1.readJobSearchScope)(userDir), nightlyMatching: (0, career_nightly_match_1.readNightlyMatchReceipt)(userDir) });
        }
        catch (err) {
            logger.error({ err, userSub }, 'title profile: state read failed');
            res.status(500).json({ error: 'read failed' });
        }
    });
    router.post('/settings/remote-only', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        if (typeof req.body?.remoteOnly !== 'boolean') {
            res.status(400).json({ error: 'remoteOnly must be a boolean' });
            return;
        }
        try {
            const remoteOnly = await saveRemoteOnly(pool, userSub, req.body.remoteOnly);
            logger.info({ userSub, remoteOnly }, 'remote-only preference saved');
            res.json({ ok: true, remoteOnly });
        }
        catch (err) {
            logger.error({ err, userSub }, 'remote-only: save failed');
            res.status(500).json({ error: 'save failed' });
        }
    });
    router.post('/settings/title-profile', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'scope')) {
            if (Object.prototype.hasOwnProperty.call(req.body, 'terms')) {
                res.status(400).json({ error: 'Save titles and matching area separately.' });
                return;
            }
            try {
                const searchScope = await (0, career_search_scope_1.saveJobSearchScope)((0, career_user_store_1.userPaths)(userSub).userDir, req.body.scope);
                res.json({ ok: true, searchScope });
            }
            catch (err) {
                logger.error({ err, userSub }, 'title profile: matching area save failed');
                res.status(err instanceof career_geo_1.CareerLocationError ? 400 : 500).json({
                    error: err instanceof career_geo_1.CareerLocationError ? err.message : 'Matching area could not be saved.',
                });
            }
            return;
        }
        try {
            const terms = normalizeTitleTerms(req.body?.terms);
            await saveTitleProfile(pool, userSub, terms);
            logger.info({ userSub, terms: terms.length }, 'title profile: saved');
            res.json({ ok: true, titleTerms: terms });
        }
        catch (err) {
            logger.error({ err, userSub }, 'title profile: save failed');
            res.status(500).json({ error: 'save failed' });
        }
    });
    router.post('/title-pass/run-now', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        if (req.body?.nightly === true) {
            try {
                const profile = await readTitleProfile(pool, userSub);
                const result = await (0, career_nightly_match_1.startNightlyMatching)(pool, userSub, profile, () => markTitlePassCursor(pool, userSub));
                const noop = ['up-to-date', 'daily-cooldown'].includes(result.reason || '');
                const status = result.started ? 202 : noop ? 200 : result.reason === 'no-title-profile' ? 400
                    : result.reason === 'score-in-flight' ? 409 : result.reason === 'busy' ? 429 : 502;
                res.status(status).json(result);
            }
            catch (err) {
                logger.error({ err, userSub }, 'nightly matching: start failed');
                res.status(500).json({ started: false, reason: 'error' });
            }
            return;
        }
        const limit = req.body?.limit;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > Math.min(150, TITLE_PASS_LIMIT))) {
            res.status(400).json({ error: `Choose between 1 and ${Math.min(150, TITLE_PASS_LIMIT)} jobs for this pass.` });
            return;
        }
        try {
            const r = await startTitlePassForUser(ctx, userSub, { limit });
            const status = r.started ? 202
                : r.reason === 'no-title-profile' ? 400
                    : r.reason === 'score-in-flight' ? 409
                        : r.reason === 'busy' ? 429
                            : 502;
            res.status(status).json(r);
        }
        catch (err) {
            logger.error({ err, userSub }, 'title pass: run-now failed');
            res.status(500).json({ ran: false, reason: 'error' });
        }
    });
}
//# sourceMappingURL=career-title-score.js.map
