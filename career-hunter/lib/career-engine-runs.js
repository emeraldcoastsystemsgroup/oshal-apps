/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add the in-process engine run registry behind the Career worker rail: every engine child the runner launches gets a run id and a runner-minted, owner-bound bearer token that the model rail redeems and that is revoked when the child settles; owner-only cancellation, a recorded rail failure reason, and truthful succeeded/failed/cancelled terminal states. The rail limits (concurrency, per-call deadline, heartbeat staleness, body ceiling) live here so the runner and the rail read one definition.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Add a separate queue-wait ceiling (CAREER_WORKER_RAIL_QUEUE_WAIT_MS, default 1 h) to the rail limits. The per-call deadline now starts when a call is granted a Career bot slot, so a scoring batch that queues behind the semaphore no longer spends its deadline waiting; the engine's client timeout covers the queue ceiling plus the deadline so the rail's own answer still arrives before the socket gives up.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The run token becomes a per-run callback grant for the kernel's signed-package-callbacks rail (1.25.1). Under ADR-149 enforce the kernel refused the engine child's bearer-token call with authorization_identity_required before the rail could redeem it, because a service-secret caller has no verified identity. A run now records its owner's verified issuer and keeps only the HMAC key derived from its secret; the child receives `<run id>.<secret>` (CAREER_RAIL_GRANT) and signs every completion over the method, path, timestamp, a single-use nonce and the body hash, and verifyRailRequest returns the run whose recorded (owner, issuer) the kernel then refreshes and authorizes. The fleet service secret is no longer part of the child environment at all: railChildEnv mints exactly four entries, and the retired 1.24.0 names are listed so the runner strips them from any caller-supplied environment.
 */
'use strict';

const crypto = require('crypto');

/** @description Route path the engine's model rail posts to, beneath the package's service mount. */
const RAIL_PATH = '/api/career-hunter/engine/complete';

/** @description Content type the rail accepts; it keeps the kernel's tight global JSON parser off the body. */
const RAIL_CONTENT_TYPE = 'application/vnd.oshal.career-rail+json';

/** @description Child environment names the runner sets and the launcher forwards to the engine. */
const RAIL_ENV = Object.freeze({
  url: 'CAREER_RAIL_URL',
  grant: 'CAREER_RAIL_GRANT',
  runId: 'CAREER_RAIL_RUN_ID',
  timeoutSeconds: 'CAREER_RAIL_TIMEOUT_S',
});

/**
 * @description The 1.24.0 bearer-token names. Nothing mints them any more; the runner strips them
 * from any caller-supplied environment so a stale value can never reach an engine child.
 */
const RETIRED_RAIL_ENV = Object.freeze(['CAREER_RAIL_TOKEN', 'CAREER_RAIL_SERVICE_SECRET']);

/** @description Request headers of the signed rail contract (the engine's enrich._rail_headers). */
const RAIL_HEADERS = Object.freeze({
  grant: 'x-career-rail-grant',
  owner: 'x-career-rail-owner',
  timestamp: 'x-career-rail-timestamp',
  nonce: 'x-career-rail-nonce',
  signature: 'x-career-rail-signature',
});

/** Domain prefix of the grant key derivation; the engine derives the same key from the same secret. */
const KEY_DOMAIN = 'oshal-career-rail-grant-v1:';
/** Largest clock difference between the engine child and the controller a signature survives. */
const RAIL_SKEW_SECONDS = 300;
/** Nonces one run may spend; a scoring run sends at most a few thousand completions. */
const MAX_NONCES_PER_RUN = 20_000;
const MAX_ISSUER_LENGTH = 2048;
const MAX_OWNER_BYTES = 512;

const TERMINAL_HISTORY_PER_OWNER = 20;
const MAX_TRACKED_RUNS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;

/** runId -> mutable run record. */
const runs = new Map();

/**
 * @description Read one integer package setting from the environment, falling back to the package
 * default when it is missing or not a number, and clamping it to a supported range.
 * @param {string} name - Environment variable name.
 * @param {number} fallback - Package default.
 * @param {number} min - Lowest accepted value.
 * @param {number} max - Highest accepted value.
 * @returns {number} Clamped integer setting.
 */
function clampedSetting(name, fallback, min, max) {
  const raw = process.env[name];
  const parsed = raw !== undefined && String(raw).trim() ? Number(raw) : fallback;
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, value));
}

/**
 * @description Resolve the worker-rail limits. Package defaults apply unless a deployment sets the
 * matching CAREER_WORKER_RAIL_* override; every value is clamped so a typo cannot unbound the rail.
 * `deadlineMs` bounds one call from the moment it holds a Career bot slot; `queueWaitMs` separately
 * bounds how long a call may wait for that slot. The default queue ceiling lets two concurrent
 * 8-worker scoring runs (16 calls, 8 rounds at 2 slots) queue even when every call runs close to the
 * default deadline (8 x 300 s = 40 min); a run's own cancellation or exit also ends the wait.
 * @returns {{concurrency: number, deadlineMs: number, queueWaitMs: number, heartbeatStaleMs: number,
 *   maxBodyBytes: number}} The effective limits.
 */
function railLimits() {
  return {
    concurrency: clampedSetting('CAREER_WORKER_RAIL_CONCURRENCY', 2, 1, 16),
    deadlineMs: clampedSetting('CAREER_WORKER_RAIL_DEADLINE_MS', 300_000, 1_000, 1_800_000),
    queueWaitMs: clampedSetting('CAREER_WORKER_RAIL_QUEUE_WAIT_MS', 3_600_000, 1_000, 7_200_000),
    heartbeatStaleMs: clampedSetting('CAREER_WORKER_RAIL_HEARTBEAT_STALE_MS', 90_000, 10_000, 600_000),
    maxBodyBytes: clampedSetting('CAREER_WORKER_RAIL_MAX_BODY_BYTES', 1_048_576, 65_536, 8_388_608),
  };
}

/**
 * @description Derive a grant's HMAC key from its secret. The registry keeps only this key, never
 * the secret, and the engine derives the same key from the secret it was handed.
 * @param {string} secret - The grant secret (the half of the token after the run id).
 * @returns {Buffer} The 32-byte signing key.
 */
function railSigningKey(secret) {
  return crypto.createHash('sha256').update(`${KEY_DOMAIN}${secret}`, 'utf8').digest();
}

/**
 * @description The exact string a rail signature covers: method, the request target as the
 * controller receives it, the timestamp, the nonce and the hex SHA-256 of the body bytes.
 * @param {string} method - HTTP method.
 * @param {string} target - Request path (and query, when any).
 * @param {number} timestamp - Unix seconds.
 * @param {string} nonce - Single-use nonce.
 * @param {Buffer} body - Exact body bytes.
 * @returns {string} The canonical string.
 */
function canonicalRailRequest(method, target, timestamp, nonce, body) {
  const bodyHash = crypto.createHash('sha256').update(body || Buffer.alloc(0)).digest('hex');
  return `${String(method).toUpperCase()}|${target}|${timestamp}|${nonce}|${bodyHash}`;
}

/** Split a `<run id>.<secret>` grant token; null when it is not one. */
function parseGrantToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const runId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return UUID_RE.test(runId) && SECRET_RE.test(secret) ? { runId: runId.toLowerCase(), secret } : null;
}

/** Whether a value can be recorded as the run owner's verified issuer. */
function isValidIssuer(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ISSUER_LENGTH && !value.includes('\0');
}

/** Decode a canonical base64url owner sub, refusing anything that does not round-trip exactly. */
function decodeOwner(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 700 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length === 0 || bytes.length > MAX_OWNER_BYTES || bytes.toString('base64url') !== value) return null;
  const sub = bytes.toString('utf8');
  return Buffer.from(sub, 'utf8').equals(bytes) && !sub.includes('\0') ? sub : null;
}

/** Project a run record onto the fields an owner may read; the token hash and hooks stay private. */
function publicRun(record) {
  return {
    runId: record.runId,
    verb: record.verb,
    state: record.state,
    reason: record.reason,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    railCalls: record.railCalls,
  };
}

/** Drop the oldest terminal runs beyond the per-owner history and the global ceiling. */
function pruneRuns() {
  const terminalByOwner = new Map();
  for (const record of runs.values()) {
    if (record.state === 'running') continue;
    const list = terminalByOwner.get(record.owner) || [];
    list.push(record);
    terminalByOwner.set(record.owner, list);
  }
  for (const list of terminalByOwner.values()) {
    list.sort((a, b) => b.finishedAt - a.finishedAt);
    list.slice(TERMINAL_HISTORY_PER_OWNER).forEach((record) => runs.delete(record.runId));
  }
  if (runs.size <= MAX_TRACKED_RUNS) return;
  const terminal = [...runs.values()].filter((record) => record.state !== 'running')
    .sort((a, b) => a.finishedAt - b.finishedAt);
  for (const record of terminal) {
    if (runs.size <= MAX_TRACKED_RUNS) break;
    runs.delete(record.runId);
  }
}

/**
 * @description Register one engine child for an exact owner and mint its callback grant. The
 * grant token `<run id>.<secret>` is returned once; only the HMAC key derived from the secret is
 * retained. The owner's verified issuer is recorded with the run because the kernel refreshes and
 * authorizes exactly that (subject, issuer) principal before a signed completion runs; a run
 * registered without one still exists (it can be listed and cancelled) but its grant can never
 * be admitted.
 * @param {string} owner - Exact, case-sensitive OIDC subject that owns the run.
 * @param {string} verb - Engine verb, recorded for the owner's run list.
 * @param {{ownerIssuer?: string|null}} [options] - The owner's verified principal issuer.
 * @returns {{runId: string, token: string, ownerIssuer: string|null}} The new run, its grant
 * token and the issuer it recorded.
 */
function registerEngineRun(owner, verb, options = {}) {
  if (typeof owner !== 'string' || owner.length === 0) throw new TypeError('engine run owner is required');
  const runId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const ownerIssuer = isValidIssuer(options.ownerIssuer) ? options.ownerIssuer : null;
  runs.set(runId, {
    runId, owner, ownerIssuer,
    signingKey: railSigningKey(secret), nonces: new Set(),
    verb: String(verb || 'engine').slice(0, 40),
    state: 'running', reason: null,
    startedAt: Date.now(), finishedAt: null,
    cancelled: false, railFailure: null, railCalls: 0,
    terminate: null, abort: new AbortController(),
  });
  pruneRuns();
  return { runId, token: `${runId}.${secret}`, ownerIssuer };
}

/**
 * @description Build the child-environment entries that let exactly this run reach the rail on
 * the controller's own loopback listener: the URL (derived from the listen port, never
 * configurable, so a grant cannot be pointed at another host), the grant, the run id and the
 * client timeout. Exactly these four; the fleet service secret is not part of the contract.
 * @param {string} runId - Run id from registerEngineRun.
 * @param {string} token - Grant token from registerEngineRun.
 * @param {{port?: string}} [options] - Listen port.
 * @returns {Record<string, string>} Rail environment entries for the engine child.
 */
function railChildEnv(runId, token, options = {}) {
  const port = String(options.port || '5000').trim();
  const limits = railLimits();
  return {
    [RAIL_ENV.url]: `http://127.0.0.1:${port}${RAIL_PATH}`,
    [RAIL_ENV.grant]: token,
    [RAIL_ENV.runId]: runId,
    // The engine's HTTP client waits a little longer than the rail's longest answer (the queue
    // ceiling plus the per-call deadline), so the rail's own 504 arrives before the socket gives up.
    [RAIL_ENV.timeoutSeconds]: String(Math.ceil((limits.queueWaitMs + limits.deadlineMs) / 1_000) + 30),
  };
}

/** The live run a grant names, or null while it is settled, cancelled or unknown. */
function liveRun(runId) {
  const record = runs.get(runId);
  if (!record || record.state !== 'running' || record.cancelled) return null;
  return record;
}

/**
 * @description Redeem a grant token for the run it was minted for, and only for that run's exact
 * owner while the run is still running. Any mismatch returns null without saying why. The rail
 * itself verifies signatures (verifyRailRequest); this is the direct check the runner's guards use.
 * @param {unknown} token - Presented grant token `<run id>.<secret>`.
 * @param {string|null} subject - The subject claiming the run.
 * @returns {object|null} The live run record, or null when the token is refused.
 */
function redeemRunToken(token, subject) {
  const grant = parseGrantToken(token);
  if (!grant || typeof subject !== 'string' || subject.length === 0) return null;
  const record = liveRun(grant.runId);
  if (!record || record.owner !== subject) return null;
  return crypto.timingSafeEqual(railSigningKey(grant.secret), record.signingKey) ? record : null;
}

/** Parse the five contract headers; null when any is missing or malformed. */
function parseRailHeaders(headers) {
  const header = (name) => { const v = headers ? headers[name] : undefined; return typeof v === 'string' ? v : ''; };
  const grantId = header(RAIL_HEADERS.grant);
  const owner = decodeOwner(header(RAIL_HEADERS.owner));
  const timestampText = header(RAIL_HEADERS.timestamp);
  const nonce = header(RAIL_HEADERS.nonce);
  const signature = header(RAIL_HEADERS.signature);
  if (!UUID_RE.test(grantId) || !owner || !/^\d{1,12}$/.test(timestampText) || !NONCE_RE.test(nonce)
    || !SIGNATURE_RE.test(signature)) return null;
  return { grantId: grantId.toLowerCase(), owner, timestamp: Number(timestampText), nonce, signature };
}

/**
 * @description Verify one signed rail request against the run its grant names: the grant must
 * name a run the asserted owner owns, the timestamp must be fresh, the signature must cover this
 * exact method, target and body under the run's key, the run must still be running with a
 * recorded owner issuer, and the nonce must never have been spent. Another owner's grant is
 * indistinguishable from an unknown one. On success the nonce is recorded, so the same request
 * can never be admitted twice.
 * @param {{method: string, target: string, headers: object, body: Buffer, nowSeconds?: number}} request
 * The request facts the signature covers, plus the contract headers.
 * @returns {{ok: true, run: object} | {ok: false, error: string}} The admitted run, or the refusal reason.
 */
function verifyRailRequest(request) {
  const parsed = parseRailHeaders(request.headers);
  if (!parsed) return { ok: false, error: 'rail_grant_required' };
  const record = runs.get(parsed.grantId);
  if (!record || record.owner !== parsed.owner) return { ok: false, error: 'rail_grant_invalid' };
  const now = Number.isFinite(request.nowSeconds) ? request.nowSeconds : Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > RAIL_SKEW_SECONDS) return { ok: false, error: 'rail_timestamp_stale' };
  const canonical = canonicalRailRequest(request.method, request.target, parsed.timestamp, parsed.nonce, request.body);
  const expected = crypto.createHmac('sha256', record.signingKey).update(canonical, 'utf8').digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(parsed.signature, 'hex'))) return { ok: false, error: 'rail_signature_invalid' };
  if (record.state !== 'running' || record.cancelled) return { ok: false, error: 'rail_grant_revoked' };
  if (!isValidIssuer(record.ownerIssuer)) return { ok: false, error: 'rail_grant_issuer_missing' };
  if (record.nonces.has(parsed.nonce)) return { ok: false, error: 'rail_replayed' };
  if (record.nonces.size >= MAX_NONCES_PER_RUN) return { ok: false, error: 'rail_nonce_ceiling' };
  record.nonces.add(parsed.nonce);
  return { ok: true, run: record };
}

/**
 * @description Attach the process-tree terminator the runner uses to fence a cancelled run.
 * @param {string} runId - Run id.
 * @param {() => void} terminate - Terminates the run's complete process tree.
 * @returns {void}
 */
function attachRunTerminator(runId, terminate) {
  const record = runs.get(runId);
  if (record && record.state === 'running') record.terminate = terminate;
}

/**
 * @description Count one admitted rail call against the run, for the owner's run list.
 * @param {string} runId - Run id.
 * @returns {void}
 */
function noteRailCall(runId) {
  const record = runs.get(runId);
  if (record) record.railCalls += 1;
}

/**
 * @description Record why the rail could not complete a call for this run. The first reason wins,
 * because the engine stops at the first failure and later calls only repeat it.
 * @param {string} runId - Run id.
 * @param {string} reason - Stable failure code, e.g. career-worker-unavailable.
 * @returns {void}
 */
function markRailFailure(runId, reason) {
  const record = runs.get(runId);
  if (record && !record.railFailure) record.railFailure = String(reason);
}

/** Choose the terminal state from the child's exit facts and what the rail recorded. */
function terminalState(record, facts) {
  if (record.cancelled) return { state: 'cancelled', reason: 'cancelled-by-owner' };
  if (facts.code === 0 && !facts.timedOut) return { state: 'succeeded', reason: null };
  if (record.railFailure) return { state: 'failed', reason: record.railFailure };
  if (facts.timedOut) return { state: 'failed', reason: 'timeout' };
  return { state: 'failed', reason: 'engine-failed' };
}

/**
 * @description Settle a run exactly once when its child exits: revoke the token, abort any rail
 * call still waiting for it, and record a terminal state that never stays `running`.
 * @param {string} runId - Run id.
 * @param {{code: number|null, timedOut?: boolean}} facts - Child exit code and deadline flag.
 * @returns {object|null} The owner-visible terminal record, or null for an unknown run.
 */
function settleEngineRun(runId, facts) {
  const record = runs.get(runId);
  if (!record) return null;
  if (record.state !== 'running') return publicRun(record);
  record.nonces.clear();
  record.abort.abort();
  const terminal = terminalState(record, { code: facts?.code ?? null, timedOut: Boolean(facts?.timedOut) });
  record.state = terminal.state;
  record.reason = terminal.reason;
  record.finishedAt = Date.now();
  record.terminate = null;
  pruneRuns();
  return publicRun(record);
}

/**
 * @description Cancel one running run for its owner: revoke the token so in-flight and later rail
 * calls are refused, abort waiting calls, and terminate the process tree. Another owner's run is
 * indistinguishable from a missing one.
 * @param {string} owner - Exact subject of the caller.
 * @param {string} runId - Run id to cancel.
 * @returns {{status: 'cancelled'|'not-found'|'already-terminal', run?: object}} Outcome.
 */
function cancelEngineRun(owner, runId) {
  const record = runs.get(runId);
  if (!record || record.owner !== owner) return { status: 'not-found' };
  if (record.state !== 'running') return { status: 'already-terminal', run: publicRun(record) };
  if (!record.cancelled) {
    record.cancelled = true;
    record.nonces.clear();
    record.abort.abort();
    const terminate = record.terminate;
    if (typeof terminate === 'function') terminate();
  }
  return { status: 'cancelled', run: publicRun(record) };
}

/**
 * @description List one owner's runs, newest first; other owners' runs are never included.
 * @param {string} owner - Exact subject of the caller.
 * @returns {object[]} Owner-visible run records.
 */
function listEngineRuns(owner) {
  return [...runs.values()]
    .filter((record) => record.owner === owner)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(publicRun);
}

/**
 * @description Read one run's owner-visible record by id, for the route that launched it.
 * @param {string} runId - Run id.
 * @returns {object|null} The record, or null when unknown or pruned.
 */
function engineRunSnapshot(runId) {
  const record = runs.get(runId);
  return record ? publicRun(record) : null;
}

module.exports = {
  RAIL_CONTENT_TYPE,
  RAIL_ENV,
  RAIL_HEADERS,
  RAIL_PATH,
  RETIRED_RAIL_ENV,
  attachRunTerminator,
  cancelEngineRun,
  canonicalRailRequest,
  engineRunSnapshot,
  listEngineRuns,
  markRailFailure,
  noteRailCall,
  railChildEnv,
  railLimits,
  railSigningKey,
  redeemRunToken,
  registerEngineRun,
  settleEngineRun,
  verifyRailRequest,
};
