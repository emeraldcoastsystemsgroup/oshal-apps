"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCareerEngineEnv = resolveCareerEngineEnv;
exports.runCareerCliAsync = runCareerCliAsync;
exports.runCareerCliAwait = runCareerCliAwait;
exports.runSharedPull = runSharedPull;
exports.runUserMatch = runUserMatch;
exports.runUserScore = runUserScore;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Broker only the caller's Anthropic and Firecrawl credentials and fail closed when decryption is unavailable.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Serialize shared-corpus writers while preserving caller-owned preclaims through brokerage and start rejection.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Claim automatic command resources before credential brokerage so rejected duplicate work cannot query or decrypt caller secrets.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Enforce one absolute admission deadline across bounded Postgres brokerage, decryption, wrapper adoption, and engine execution.
 */
/**
 * Career engine dispatch with controller-side credential brokering.
 *
 * Career settings are stored with the kernel's per-user `v2:` connector envelope. The standalone
 * package CLI cannot unwrap that kernel-owned DEK and must never forward its ciphertext as an API
 * key, so mounted routes decrypt only the authenticated caller's two Career providers here and
 * pass short-lived plaintext in the child environment.
 *
 * @module career-engine-dispatch
 */
const connector_token_crypto_1 = require("@/app/routes/connector-token-crypto");
const logger_1 = require("@/shared/logger");
const career_engine_runner_1 = require("./career-engine-runner");
const logger = (0, logger_1.createChildLogger)({ module: 'career-engine-dispatch' });
const PROVIDER_ENV = { anthropic: 'OSHAL_CRED_ANTHROPIC', firecrawl: 'OSHAL_CRED_FIRECRAWL' };
const USER_STORE_SLOT = 'user-store';
const SHARED_CORPUS_SLOT = 'corpus-write';
const SHARED_CORPUS_WRITERS = new Set(['pull', 'score', 'score-titles', 'seturl', 'discover', 'enrich']);
const PULL_TIMEOUT_MS = Number(process.env.CAREER_HUNTER_PULL_TIMEOUT_MS) || 8 * 60 * 60 * 1_000;
class BrokerDeadlineError extends Error {
    constructor() { super('career engine credential brokerage timed out'); }
}
/** Reject a pending brokerage operation at the command's original absolute deadline. */
function beforeDeadline(operation, deadlineAt) {
    const remaining = Math.max(0, deadlineAt - Date.now());
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new BrokerDeadlineError()), remaining);
        operation.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}
/** Add client/server Postgres timeouts and a local promise deadline to every broker query. */
function deadlineQueryPool(pool, deadlineAt) {
    return {
        async query(text, params) {
            const remaining = Math.max(1, Math.floor(deadlineAt - Date.now()));
            if (remaining <= 1 && Date.now() >= deadlineAt)
                throw new BrokerDeadlineError();
            const config = typeof text === 'string'
                ? { text, values: params, query_timeout: remaining, statement_timeout: remaining }
                : { ...text, query_timeout: remaining, statement_timeout: remaining };
            try {
                return await beforeDeadline(pool.query(config), deadlineAt);
            }
            catch (error) {
                if (Date.now() >= deadlineAt || /timeout/i.test(String(error?.message))) {
                    throw new BrokerDeadlineError();
                }
                throw error;
            }
        },
    };
}
/**
 * @description Resolve only this caller's latest Career provider rows through kernel cryptography.
 * @param pool query boundary for caller-scoped connection rows
 * @param userSub authenticated caller subject
 * @param decrypt kernel token decryptor, injectable for boundary tests
 * @param deadlineAt optional absolute brokerage deadline used by mounted dispatch
 * @returns plaintext child-environment values for the caller's configured providers
 */
async function resolveCareerEngineEnv(pool, userSub, decrypt = connector_token_crypto_1.decryptToken, deadlineAt) {
    const queryPool = deadlineAt ? deadlineQueryPool(pool, deadlineAt) : pool;
    const rows = (await queryPool.query(`SELECT provider, access_token FROM oshal_connections
      WHERE user_sub=$1 AND provider IN ('anthropic','firecrawl')
      ORDER BY updated_at DESC`, [userSub])).rows;
    const env = {};
    for (const row of rows) {
        const provider = String(row.provider);
        const envKey = PROVIDER_ENV[provider];
        if (!envKey || env[envKey] || !row.access_token)
            continue;
        const decrypted = decrypt(queryPool, userSub, String(row.access_token));
        env[envKey] = deadlineAt ? await beforeDeadline(decrypted, deadlineAt) : await decrypted;
    }
    return env;
}
/** Convert a broker failure into a non-secret-bearing dispatch result. */
function brokerFailure(err) {
    logger.error({ err }, 'career engine credential broker failed');
    return 'career engine credentials unavailable';
}
/** Broker credentials behind a non-throwing result so admission cleanup stays explicit. */
async function brokerEnvironment(pool, userSub, deadlineAt) {
    try {
        const env = await beforeDeadline(resolveCareerEngineEnv(pool, userSub, connector_token_crypto_1.decryptToken, deadlineAt), deadlineAt);
        return { ok: true, env };
    }
    catch (err) {
        const timedOut = err instanceof BrokerDeadlineError || Date.now() >= deadlineAt;
        return {
            ok: false,
            error: timedOut ? 'career engine credential brokerage timed out' : brokerFailure(err),
            timedOut,
        };
    }
}
/** Format the runner's bounded admission result without touching credential storage. */
function limitFailure(status) {
    return { err: `career engine ${status}`, limitReason: status };
}
/** Reserve automatic work only; a caller-provided proof retains its original ownership contract. */
function acquireAutomaticRun(userSub, args, options) {
    return options.preclaimed ? undefined : (0, career_engine_runner_1.tryAcquireCliRun)(userSub, args, options);
}
/** Every command owns its user store; corpus writers additionally own one cross-user slot. */
function commandOptions(args, options) {
    const globalSlots = [...(options.globalSlots || [])];
    if (SHARED_CORPUS_WRITERS.has(args[0]))
        globalSlots.push(SHARED_CORPUS_SLOT);
    return { ...options, slot: USER_STORE_SLOT, globalSlots: [...new Set(globalSlots)] };
}
/**
 * @description Claim automatic resources before reading caller credentials, then start a detached
 * engine child only after brokerage succeeds; explicit preclaims retain caller ownership.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @param args packaged CLI arguments
 * @param extraEnv bounded command inputs
 * @param options runner lease and deadline options
 * @returns acknowledged child-start result
 */
async function runCareerCliAsync(pool, userSub, args, extraEnv = {}, options = {}) {
    const normalized = (0, career_engine_runner_1.withCliDeadline)(commandOptions(args, options));
    const lease = acquireAutomaticRun(userSub, args, normalized);
    if (lease && lease.status !== 'ok')
        return { started: false, ...limitFailure(lease.status) };
    const brokered = await brokerEnvironment(pool, userSub, normalized.deadlineAt);
    if (!brokered.ok) {
        if (lease)
            (0, career_engine_runner_1.releaseRun)(lease);
        return {
            started: false, err: brokered.error,
            ...(brokered.timedOut ? { timedOut: true } : {}),
        };
    }
    const launchOptions = lease
        ? { ...normalized, preclaimed: lease, adoptPreclaim: true }
        : normalized;
    const childEnv = { ...extraEnv, ...brokered.env, CAREER_HUNTER_BROKER_COMPLETE: '1' };
    const result = await (0, career_engine_runner_1.runCliAsync)(userSub, args, childEnv, launchOptions);
    if (lease && !result.started)
        (0, career_engine_runner_1.releaseRun)(lease);
    return result;
}
/**
 * @description Claim automatic resources before reading caller credentials, then await a bounded
 * engine verdict without blocking the event loop; explicit preclaims retain caller ownership.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @param args packaged CLI arguments
 * @param extraEnv bounded command inputs
 * @param options runner lease and deadline options
 * @returns bounded command result
 */
async function runCareerCliAwait(pool, userSub, args, extraEnv = {}, options = {}) {
    const normalized = (0, career_engine_runner_1.withCliDeadline)(commandOptions(args, options));
    const lease = acquireAutomaticRun(userSub, args, normalized);
    if (lease && lease.status !== 'ok')
        return { ok: false, out: '', ...limitFailure(lease.status) };
    const brokered = await brokerEnvironment(pool, userSub, normalized.deadlineAt);
    if (!brokered.ok) {
        if (lease)
            (0, career_engine_runner_1.releaseRun)(lease);
        return {
            ok: false, out: '', err: brokered.error,
            ...(brokered.timedOut ? { timedOut: true } : {}),
        };
    }
    const childEnv = { ...extraEnv, ...brokered.env, CAREER_HUNTER_BROKER_COMPLETE: '1' };
    if (!lease)
        return (0, career_engine_runner_1.runCliAwait)(userSub, args, childEnv, normalized);
    try {
        return await (0, career_engine_runner_1.runCliAwait)(userSub, args, childEnv, { ...normalized, preclaimed: lease });
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
/**
 * @description Run the shared scrape/index leg with a long but finite production deadline.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @returns success state without child diagnostics
 */
async function runSharedPull(pool, userSub) {
    const result = await runCareerCliAwait(pool, userSub, ['pull'], {}, { timeoutMs: PULL_TIMEOUT_MS });
    return { ok: result.ok };
}
/**
 * @description Keyword-index the shared corpus into one caller's signals under its store lease.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @returns success state without child diagnostics
 */
async function runUserMatch(pool, userSub) {
    const result = await runCareerCliAwait(pool, userSub, ['match'], { CH_MATCH_DAYS: '14' });
    return { ok: result.ok };
}
/**
 * @description Run bounded per-user scoring without allowing a sibling store writer.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @param opts optional result and freshness bounds
 * @returns success state without child diagnostics
 */
async function runUserScore(pool, userSub, opts = {}) {
    const args = ['score', '--min-keyword', '40'];
    if (opts.firstSeenDays && Number.isFinite(opts.firstSeenDays)) {
        args.push('--first-seen-days', String(Math.max(1, Math.floor(opts.firstSeenDays))));
    }
    if (opts.limit && Number.isFinite(opts.limit)) {
        args.push('--limit', String(Math.max(1, Math.floor(opts.limit))));
    }
    const result = await runCareerCliAwait(pool, userSub, args);
    return { ok: result.ok };
}
//# sourceMappingURL=career-engine-dispatch.js.map