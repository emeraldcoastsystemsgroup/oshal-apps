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
import { decryptToken } from '@/app/routes/connector-token-crypto';
import { createChildLogger } from '@/shared/logger';
import {
  releaseRun, runCliAsync, runCliAwait, tryAcquireCliRun,
  withCliDeadline, type CliResult, type CliRunOptions, type CliStartResult,
  type RunClaim, type RunLease,
} from './career-engine-runner';

const logger = createChildLogger({ module: 'career-engine-dispatch' });
const PROVIDER_ENV = { anthropic: 'OSHAL_CRED_ANTHROPIC', firecrawl: 'OSHAL_CRED_FIRECRAWL' } as const;
const USER_STORE_SLOT = 'user-store';
const SHARED_CORPUS_SLOT = 'corpus-write';
const SHARED_CORPUS_WRITERS = new Set(['pull', 'score', 'score-titles', 'seturl', 'discover', 'enrich']);
const PULL_TIMEOUT_MS = Number(process.env.CAREER_HUNTER_PULL_TIMEOUT_MS) || 8 * 60 * 60 * 1_000;

interface DeadlineQuery {
  text: string;
  values?: unknown[];
  query_timeout: number;
  statement_timeout: number;
}

interface QueryPool {
  query(text: string | DeadlineQuery, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

type TokenDecryptor = (pool: QueryPool, userSub: string, blob: string) => Promise<string>;
type LimitReason = Exclude<RunClaim, 'ok'>;
type BrokeredEnvironment =
  | { ok: true; env: Record<string, string> }
  | { ok: false; error: string; timedOut?: boolean };

class BrokerDeadlineError extends Error {
  constructor() { super('career engine credential brokerage timed out'); }
}

/** Reject a pending brokerage operation at the command's original absolute deadline. */
function beforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = Math.max(0, deadlineAt - Date.now());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new BrokerDeadlineError()), remaining);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Add client/server Postgres timeouts and a local promise deadline to every broker query. */
function deadlineQueryPool(pool: QueryPool, deadlineAt: number): QueryPool {
  return {
    async query(text, params) {
      const remaining = Math.max(1, Math.floor(deadlineAt - Date.now()));
      if (remaining <= 1 && Date.now() >= deadlineAt) throw new BrokerDeadlineError();
      const config = typeof text === 'string'
        ? { text, values: params, query_timeout: remaining, statement_timeout: remaining }
        : { ...text, query_timeout: remaining, statement_timeout: remaining };
      try { return await beforeDeadline(pool.query(config), deadlineAt); }
      catch (error) {
        if (Date.now() >= deadlineAt || /timeout/i.test(String((error as Error)?.message))) {
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
export async function resolveCareerEngineEnv(
  pool: QueryPool,
  userSub: string,
  decrypt: TokenDecryptor = decryptToken,
  deadlineAt?: number,
): Promise<Record<string, string>> {
  const queryPool = deadlineAt ? deadlineQueryPool(pool, deadlineAt) : pool;
  const rows = (await queryPool.query(
    `SELECT provider, access_token FROM oshal_connections
      WHERE user_sub=$1 AND provider IN ('anthropic','firecrawl')
      ORDER BY updated_at DESC`,
    [userSub],
  )).rows;
  const env: Record<string, string> = {};
  for (const row of rows) {
    const provider = String(row.provider) as keyof typeof PROVIDER_ENV;
    const envKey = PROVIDER_ENV[provider];
    if (!envKey || env[envKey] || !row.access_token) continue;
    const decrypted = decrypt(queryPool, userSub, String(row.access_token));
    env[envKey] = deadlineAt ? await beforeDeadline(decrypted, deadlineAt) : await decrypted;
  }
  return env;
}

/** Convert a broker failure into a non-secret-bearing dispatch result. */
function brokerFailure(err: unknown): string {
  logger.error({ err }, 'career engine credential broker failed');
  return 'career engine credentials unavailable';
}

/** Broker credentials behind a non-throwing result so admission cleanup stays explicit. */
async function brokerEnvironment(
  pool: QueryPool, userSub: string, deadlineAt: number,
): Promise<BrokeredEnvironment> {
  try {
    const env = await beforeDeadline(resolveCareerEngineEnv(pool, userSub, decryptToken, deadlineAt), deadlineAt);
    return { ok: true, env };
  } catch (err) {
    const timedOut = err instanceof BrokerDeadlineError || Date.now() >= deadlineAt;
    return {
      ok: false,
      error: timedOut ? 'career engine credential brokerage timed out' : brokerFailure(err),
      timedOut,
    };
  }
}

/** Format the runner's bounded admission result without touching credential storage. */
function limitFailure(status: LimitReason): { err: string; limitReason: LimitReason } {
  return { err: `career engine ${status}`, limitReason: status };
}

/** Reserve automatic work only; a caller-provided proof retains its original ownership contract. */
function acquireAutomaticRun(
  userSub: string, args: string[], options: CliRunOptions,
): RunLease | undefined {
  return options.preclaimed ? undefined : tryAcquireCliRun(userSub, args, options);
}

/** Every command owns its user store; corpus writers additionally own one cross-user slot. */
function commandOptions(args: string[], options: CliRunOptions): CliRunOptions {
  const globalSlots = [...(options.globalSlots || [])];
  if (SHARED_CORPUS_WRITERS.has(args[0])) globalSlots.push(SHARED_CORPUS_SLOT);
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
export async function runCareerCliAsync(
  pool: QueryPool, userSub: string, args: string[], extraEnv: Record<string, string> = {},
  options: CliRunOptions = {},
): Promise<CliStartResult> {
  const normalized = withCliDeadline(commandOptions(args, options));
  const lease = acquireAutomaticRun(userSub, args, normalized);
  if (lease && lease.status !== 'ok') return { started: false, ...limitFailure(lease.status) };
  const brokered = await brokerEnvironment(pool, userSub, normalized.deadlineAt);
  if (!brokered.ok) {
    if (lease) releaseRun(lease);
    return {
      started: false, err: brokered.error,
      ...(brokered.timedOut ? { timedOut: true } : {}),
    };
  }
  const launchOptions = lease
    ? { ...normalized, preclaimed: lease, adoptPreclaim: true }
    : normalized;
  const childEnv = { ...extraEnv, ...brokered.env, CAREER_HUNTER_BROKER_COMPLETE: '1' };
  const result = await runCliAsync(userSub, args, childEnv, launchOptions);
  if (lease && !result.started) releaseRun(lease);
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
export async function runCareerCliAwait(
  pool: QueryPool, userSub: string, args: string[], extraEnv: Record<string, string> = {},
  options: CliRunOptions = {},
): Promise<CliResult> {
  const normalized = withCliDeadline(commandOptions(args, options));
  const lease = acquireAutomaticRun(userSub, args, normalized);
  if (lease && lease.status !== 'ok') return { ok: false, out: '', ...limitFailure(lease.status) };
  const brokered = await brokerEnvironment(pool, userSub, normalized.deadlineAt);
  if (!brokered.ok) {
    if (lease) releaseRun(lease);
    return {
      ok: false, out: '', err: brokered.error,
      ...(brokered.timedOut ? { timedOut: true } : {}),
    };
  }
  const childEnv = { ...extraEnv, ...brokered.env, CAREER_HUNTER_BROKER_COMPLETE: '1' };
  if (!lease) return runCliAwait(userSub, args, childEnv, normalized);
  try {
    return await runCliAwait(userSub, args, childEnv, { ...normalized, preclaimed: lease });
  } finally {
    releaseRun(lease);
  }
}

/**
 * @description Run the shared scrape/index leg with a long but finite production deadline.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @returns success state without child diagnostics
 */
export async function runSharedPull(pool: QueryPool, userSub: string): Promise<{ ok: boolean }> {
  const result = await runCareerCliAwait(pool, userSub, ['pull'], {}, { timeoutMs: PULL_TIMEOUT_MS });
  return { ok: result.ok };
}

/**
 * @description Keyword-index the shared corpus into one caller's signals under its store lease.
 * @param pool kernel query boundary
 * @param userSub authenticated caller subject
 * @returns success state without child diagnostics
 */
export async function runUserMatch(pool: QueryPool, userSub: string): Promise<{ ok: boolean }> {
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
export async function runUserScore(
  pool: QueryPool, userSub: string, opts: { limit?: number; firstSeenDays?: number } = {},
): Promise<{ ok: boolean }> {
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
