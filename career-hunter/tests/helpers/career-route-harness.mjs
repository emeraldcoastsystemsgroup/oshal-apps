/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One loopback harness for the suites that drive the COMPILED Career routes through the real engine dispatch, runner, launcher and engine (1.26.0): load the compiled modules with only the kernel leaves outside that boundary doubled, match `:param` routes the way Express does, serve them over node:http with a caller resolved from a session cookie or a bearer token, point the runner at a fixture store, and read or seed one subject's SQLite store through the engine's own connect().
 * 2 | maintainer@emeraldcoastsystemsgroup.com | loadCompiledModules takes an optional map of leaf replacements (1.27.0): the Test Lab application seam reads the caller's SQLite store in the controller (the same read the draft queue makes), so its suite hands the real better-sqlite3 driver in place of the tripwire. Callers that pass nothing get exactly the doubles they had.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { engineRoot } from './career-pg-env.mjs';
import { requestIdentity } from './request-identity-stub.mjs';

const require = createRequire(import.meta.url);

/** @description The Python the runner and the store helpers launch. @type {string} */
export const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

/** Process settings the runner reads or hands to the engine child; each is restored afterwards. */
const RUNNER_ENV_KEYS = [
  'JOBHUNTER_STORE_ROOT', 'JOBHUNTER_PYTHON', 'JOBHUNTER_CLI', 'JOBHUNTER_STORE', 'DATABASE_URL',
  'SWARM_SERVICE_SECRET', 'PORT', 'CAREER_HUNTER_CLI_TIMEOUT_MS',
];

/**
 * @description Point the runner and its engine child at a fixture store, the packaged launcher and
 * no provider (no launcher override, no live datastore, no rail secret).
 * @param {string} storeRoot The fixture store root.
 * @returns {() => void} Restores every setting it changed.
 */
export function isolateRunnerEnv(storeRoot) {
  const saved = Object.fromEntries(RUNNER_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.JOBHUNTER_STORE_ROOT = storeRoot;
  process.env.JOBHUNTER_PYTHON = python;
  process.env.CAREER_HUNTER_CLI_TIMEOUT_MS = '60000';
  for (const key of ['JOBHUNTER_CLI', 'JOBHUNTER_STORE', 'DATABASE_URL', 'SWARM_SERVICE_SECRET', 'PORT']) delete process.env[key];
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
}

/**
 * @description The kernel leaves outside the package boundary, doubled. Every one a removal or a
 * story turn must not reach is a tripwire.
 * @param {{decryptCalls: number}} counters Counts attempts on the token decryptor.
 * @returns {Record<string, unknown>} Module doubles keyed by request.
 */
function kernelLeaves(counters) {
  const tripwire = (name) => () => { throw new Error(`tripwire: ${name}`); };
  return {
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null },
    '@/shared/services/database/request-identity': requestIdentity,
    // Mirrors src/app/routes/caller-sub.ts: the authenticated principal's subject, or nobody.
    '@/app/routes/caller-sub': { callerSub: (req) => (req.oidc?.user?.sub ? String(req.oidc.user.sub) : null) },
    '@/app/routes/connector-token-crypto': { decryptToken: async () => { counters.decryptCalls += 1; throw new Error('tripwire: no Firecrawl row to decrypt'); } },
    '@/app/apply-run-ledger': { recordManualApplyRun: tripwire('no applied mark here') },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: tripwire('no Career bot turn here') },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    'better-sqlite3': tripwire('the controller never opens SQLite here'),
  };
}

/**
 * @description Load compiled package modules with only the kernel leaves doubled.
 * @param {Record<string, string>} modules Names to package-relative module paths.
 * @param {Record<string, unknown>} [replacements] Leaf doubles to replace by request (e.g. the real
 *   better-sqlite3 driver for a suite whose routes read SQLite in the controller).
 * @returns {{modules: Record<string, any>, counters: {decryptCalls: number}}} The modules and the tripwire counters.
 */
export function loadCompiledModules(modules, replacements = {}) {
  const counters = { decryptCalls: 0 };
  const leaves = { ...kernelLeaves(counters), ...replacements };
  const originalLoad = Module._load;
  Module._load = function loadWithKernelLeaves(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(leaves, request)) return leaves[request];
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const loaded = Object.fromEntries(Object.entries(modules).map(([name, file]) => [name, require(path.join('..', '..', file))]));
    return { modules: loaded, counters };
  } finally {
    Module._load = originalLoad;
  }
}

/**
 * @description A router that records handlers and matches `:param` segments the way Express does.
 * @returns {{find: Function, get: Function, post: Function, delete: Function}} The router.
 */
export function createRouter() {
  const handlers = [];
  const add = (method) => (pattern, ...callbacks) => {
    const regex = new RegExp(`^${pattern.replace(/:[A-Za-z_]+/g, '([^/]+)')}$`);
    const names = [...pattern.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]);
    handlers.push({ method, regex, names, handler: callbacks.at(-1) });
  };
  const find = (method, pathname) => {
    for (const entry of handlers) {
      const hit = entry.method === method && entry.regex.exec(pathname);
      if (hit) return { handler: entry.handler, params: Object.fromEntries(entry.names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
    }
    return null;
  };
  return { find, get: add('GET'), post: add('POST'), delete: add('DELETE') };
}

/** @description Parse the JSON body the package mount's body parser would hand the route. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8').on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

/**
 * @description Serve the router at /api/career-hunter over loopback HTTP. The caller is whoever
 * `identify` resolves from the request headers (a session cookie or a bearer token), or nobody.
 * @param {ReturnType<typeof createRouter>} router The router.
 * @param {(headers: object) => string|undefined} identify Headers to subject.
 * @returns {Promise<{server: http.Server, baseUrl: string}>} The listener and its origin.
 */
export async function startServer(router, identify) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const found = router.find(req.method, url.pathname.replace(/^\/api\/career-hunter/, ''));
    const reply = {
      statusCode: 200,
      status(code) { reply.statusCode = code; return reply; },
      json(body) { res.writeHead(reply.statusCode, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return reply; },
      setHeader() { return reply; },
    };
    if (!found) { reply.status(404).json({ error: 'not mounted in this fixture' }); return; }
    const body = ['POST', 'PUT'].includes(req.method) ? await readJsonBody(req) : undefined;
    const sub = identify(req.headers);
    found.handler({
      method: req.method, path: url.pathname, params: found.params, query: Object.fromEntries(url.searchParams),
      headers: req.headers, body, oidc: sub ? { user: { sub } } : undefined,
    }, reply);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/**
 * @description The engine-launch environment bin/oshal-jobhunter.js gives one subject.
 * @param {{userDir: string, corpusDb: string, userDb: string}} paths The subject's store paths.
 * @param {string} sub The subject.
 * @returns {NodeJS.ProcessEnv} The environment.
 */
function sqliteEnv(paths, sub) {
  mkdirSync(paths.userDir, { recursive: true });
  return {
    ...process.env, PYTHONPATH: engineRoot, PYTHONIOENCODING: 'utf-8', JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: sub,
    JOBHUNTER_DATA: paths.userDir, JOBHUNTER_CORPUS_DB: paths.corpusDb, JOBHUNTER_USER_DB: paths.userDb,
    JOBHUNTER_CAREER_DB: path.join(paths.userDir, 'career_db.json'), JOBHUNTER_STORE: 'sqlite',
  };
}

const SQLITE_RUN = [
  'import json, sys', 'from jobhunter import db', 'statements = json.loads(sys.stdin.read())',
  'with db.connect() as conn:',
  '    for sql, params in statements: conn.execute(sql, params)',
  '    rows = [dict(r) for r in conn.execute("SELECT posting_id, status, resume_path, cover_path, generated_at FROM user_signals ORDER BY posting_id")]',
  'print("ROWS=" + json.dumps(rows))',
].join('\n');

/**
 * @description Run statements in one subject's SQLite store through the engine's own connect()
 * (corpus attached, schemas ensured), then read the subject's per-posting rows.
 * @param {{userDir: string, corpusDb: string, userDb: string}} paths The subject's store paths.
 * @param {string} sub The subject.
 * @param {Array<[string, unknown[]]>} [statements] Statements to run first.
 * @returns {Array<{posting_id: number, status: string|null, resume_path: string|null, cover_path: string|null, generated_at: string|null}>} The rows.
 */
export function sqliteRows(paths, sub, statements = []) {
  const result = spawnSync(python, ['-c', SQLITE_RUN], { input: JSON.stringify(statements), env: sqliteEnv(paths, sub), encoding: 'utf8', timeout: 60_000 });
  const line = String(result.stdout).split(/\r?\n/).find((row) => row.startsWith('ROWS='));
  assert.ok(line, `sqlite store read failed: ${result.stderr}`);
  return JSON.parse(line.slice(5)).map((row) => ({ ...row, posting_id: Number(row.posting_id) }));
}
