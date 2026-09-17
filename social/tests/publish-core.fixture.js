/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount the COMPILED social publish rail on the REAL kernel connector-action executor and the REAL swarm-apps/connectors/linkedin.yaml, with only the Postgres pool and the provider socket doubled, so the audit-before-provider and fail-closed-audit properties are proven where they actually live.
 *
 * Framework-coupled: needs an oshal checkout (OSHAL_CORE_ROOT, else OSHAL_CORE_DIR). No live
 * runtime, no database and no network are contacted; every record here is synthetic.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const core = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!core || !fs.existsSync(path.join(core, 'src/app/connectors/runtime/action-executor.ts'))) {
  throw new Error('fixture:core-checkout is required (set OSHAL_CORE_ROOT or OSHAL_CORE_DIR); no live runtime is contacted');
}
const coreRequire = Module.createRequire(path.join(core, 'package.json'));
const ts = coreRequire('typescript');
const loadedCore = new Map();
const noop = () => {};
const quietLogger = { createChildLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };

/** @description Transpile and load one canonical core source file, stubbing only the logger. */
function loadCore(relative) {
  const filename = path.join(core, 'src', relative);
  if (loadedCore.has(filename)) return loadedCore.get(filename).exports;
  const subject = new Module(filename, module);
  loadedCore.set(filename, subject);
  subject.filename = filename;
  subject.require = (name) => {
    if (name === '@/shared/logger') return quietLogger;
    if (name.startsWith('@/')) return loadCore(resolveSource(name.slice(2)));
    if (name.startsWith('.')) return loadCore(resolveSource(path.join(path.dirname(relative), name)));
    return coreRequire(name);
  };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  subject._compile(source, filename);
  return subject.exports;
}

/** @description Resolve only existing core source files; never fall through to an installed path. */
function resolveSource(relative) {
  for (const candidate of [`${relative}.ts`, path.join(relative, 'index.ts')]) {
    if (fs.existsSync(path.join(core, 'src', candidate))) return candidate;
  }
  throw new Error(`Synthetic fixture cannot resolve core source ${relative}`);
}

// The real kernel write rail: the executor that owns the fail-closed audit, the broker-only
// credential resolver, and the spec loader that reads the real connector definition.
const executor = loadCore('app/connectors/runtime/action-executor.ts');
const creds = loadCore('app/connectors/runtime/action-creds.ts');
const spec = loadCore('app/connectors/runtime/spec.ts');
const connectorRuntime = { ...executor, ...creds, ...spec };

/** The connector catalog the publish rail must read its declared action from. */
const SPEC_DIR = path.join(core, 'swarm-apps', 'connectors');
if (!fs.existsSync(path.join(SPEC_DIR, 'linkedin.yaml'))) {
  throw new Error(`fixture:core-checkout is missing the LinkedIn connector definition at ${SPEC_DIR}`);
}

const AUDIT_INSERT = /INSERT INTO connector_action_audit/i;

/** The one synthetic caller every case publishes as. */
const CALLER = Object.freeze({ sub: 'synthetic-social-owner', token: 'synthetic-linkedin-token', accountId: 'SyntheticAuthor_01' });

/**
 * @description One synthetic recorder for everything the rail touches, in the order it touches it:
 * the SQL the pool sees, and the provider socket. Ordering is the assertion that matters, so both
 * kinds land in a single list.
 * @returns The recorder with its journal.
 */
function recorder() {
  return { journal: [], add(entry) { entry.index = this.journal.length; this.journal.push(entry); return entry; } };
}

/**
 * @description Build the synthetic pool. It answers the audit DDL and INSERT and nothing else;
 * `failAudit` makes the audit INSERT throw the way an unavailable trail does.
 * @param log - The shared recorder.
 * @param options - `{ failAudit }`.
 * @returns A pg-shaped pool double.
 */
function pool(log, options = {}) {
  return {
    query: async (sql, params) => {
      const text = String(sql);
      log.add({ kind: 'sql', sql: text, params });
      if (options.failAudit && AUDIT_INSERT.test(text)) {
        throw new Error('synthetic audit trail unavailable');
      }
      // The caller's stored connection, answered the way a database would, so a rail that reads it
      // directly is exercised on its real path rather than failing for want of a row.
      if (/FROM oshal_connections/i.test(text)) {
        const rows = options.connection === null ? [] : [{ ...(options.connection || { account_id: CALLER.accountId }) }];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/**
 * @description Stand in for the LinkedIn socket. Records every call and answers the scripted
 * response; a rail that never reaches here has provably published nothing.
 * @param log - The shared recorder.
 * @param options - `{ status, body }`.
 * @returns A fetch-shaped double.
 */
function providerFetch(log, options = {}) {
  return async (url, init) => {
    log.add({ kind: 'http', url: String(url), method: init && init.method, headers: (init && init.headers) || {}, body: init && init.body });
    const status = options.status ?? 201;
    return new Response(JSON.stringify(options.body ?? { id: 'urn:li:share:7000000000000000001' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * @description Load the COMPILED package publish module with the real kernel runtime behind it and
 * fixture-owned doubles for the two collaborators outside the boundary under test: the token broker
 * and the connection-row reader.
 * @param stubs - `{ getValidAccessToken, resolveConnectionRow }`.
 * @returns The compiled module's exports.
 */
function loadCompiledPublisher(stubs) {
  const filename = path.resolve(__dirname, '..', 'routes', 'social-publish.js');
  if (!fs.existsSync(filename)) throw new Error(`compiled publish rail is missing: ${filename}`);
  const subject = new Module(filename, module);
  subject.filename = filename;
  subject.paths = Module._nodeModulePaths(path.dirname(filename));
  subject.require = (name) => {
    if (name === '@/shared/logger') return quietLogger;
    if (name === '@/app/connectors/runtime') return connectorRuntime;
    if (name === '@/app/routes/connectors-routes') return { getValidAccessToken: stubs.getValidAccessToken };
    if (name === '@/app/routes/connector-tenancy') return { resolveConnectionRow: stubs.resolveConnectionRow };
    if (name.startsWith('@/')) throw new Error(`fixture refuses an unexpected framework import: ${name}`);
    return require(name);
  };
  subject._compile(fs.readFileSync(filename, 'utf8'), filename);
  return subject.exports;
}


/**
 * @description Compose one publish attempt: real kernel rail, real connector definition, synthetic
 * pool and provider socket.
 * @param options - `{ connection, token, failAudit, providerStatus, providerBody, sub }`.
 * @returns `{ publish(text, requestBody), journal, audits(), httpCalls(), brokerCalls }`.
 */
function attempt(options = {}) {
  const log = recorder();
  const brokerCalls = [];
  const connection = options.connection === undefined ? { account_id: CALLER.accountId } : options.connection;
  const token = options.token === undefined ? CALLER.token : options.token;
  const publisher = loadCompiledPublisher({
    getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push({ sub, provider }); return token; },
    resolveConnectionRow: async (_pool, sub, provider) => (provider === 'linkedin' && sub === (options.sub ?? CALLER.sub) ? connection : null),
  });
  const ctx = { pool: pool(log, { failAudit: options.failAudit, connection }) };
  const previousDir = process.env.OSHAL_CONNECTOR_SPEC_DIR;
  const previousFetch = globalThis.fetch;
  return {
    journal: log.journal,
    brokerCalls,
    audits: () => log.journal.filter((e) => e.kind === 'sql' && AUDIT_INSERT.test(e.sql)).map((e) => auditRow(e)),
    httpCalls: () => log.journal.filter((e) => e.kind === 'http'),
    async publish(text, requestBody) {
      process.env.OSHAL_CONNECTOR_SPEC_DIR = SPEC_DIR;
      globalThis.fetch = providerFetch(log, { status: options.providerStatus, body: options.providerBody });
      try {
        return await publisher.publishToLinkedIn(ctx, options.sub ?? CALLER.sub, text, requestBody);
      } finally {
        globalThis.fetch = previousFetch;
        if (previousDir === undefined) delete process.env.OSHAL_CONNECTOR_SPEC_DIR;
        else process.env.OSHAL_CONNECTOR_SPEC_DIR = previousDir;
      }
    },
  };
}

/** @description Name the audit INSERT's positional parameters the way migration 083 orders them. */
function auditRow(entry) {
  const [userSub, connectorId, action, paramsHash, riskLevel, status, httpStatus, error] = entry.params || [];
  return { userSub, connectorId, action, paramsHash, riskLevel, status, httpStatus, error, index: entry.index };
}

module.exports = { attempt, CALLER, SPEC_DIR, AUDIT_INSERT };
