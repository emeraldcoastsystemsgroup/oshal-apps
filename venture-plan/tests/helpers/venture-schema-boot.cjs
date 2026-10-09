/**
 * Venture Plan - boot the package's two schema-bootstrapping routers the way the kernel does,
 * against a real PostgreSQL, with the framework's REAL database layer.
 *
 * The kernel's manifest route mounter calls every declared factory of a package in one
 * synchronous loop, so createVentureRoutes and createVentureRebaselineRoutes start their schema
 * bootstrap within the same tick. This helper reproduces exactly that: it loads the COMPILED
 * routes (routes/*.js, the bytes the framework mounts) fresh, as a new api process would, and
 * calls the two factories back to back with one shared context.
 *
 * Real: runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements, the schema lock, the identity
 * (GUC) pool wrapper and the runtime DDL guard the api wraps its pool in, request identity, and
 * the pg driver, all loaded from the framework checkout through its own tsx hook; PostgreSQL
 * itself. Named seams: the logger records instead of printing (it is how the suite sees the
 * routers' "bootstrap failed" lines); the bot client, the inline bot rail and the caller-sub
 * reader are inert, because no request is made; a transparent counting proxy around the pool
 * tells the suite when every bootstrap has finished.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: framework loader, seams, the api's pool shape, fresh package load per boot, and an idle wait over the pool.
 */

'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..', '..');
const ROUTES = path.join(PKG, 'routes') + path.sep;
const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || process.env.OSHAL_FRAMEWORK_ROOT
  || path.join(PKG, '..', '..', 'oshal'));

/** @description Every log line any seam-logged module wrote, in order. */
const logs = [];

/** @description A pino-shaped child logger that records `(obj, msg)` and `(msg)` calls. @param {object} bindings @returns {object} */
function recordingLogger(bindings = {}) {
  const write = (level) => (first, second) => {
    const obj = first && typeof first === 'object' ? first : {};
    const msg = typeof first === 'string' ? first : String(second ?? '');
    logs.push({ level, module: bindings.module ?? null, msg, err: obj.err ?? null });
  };
  const logger = { trace: write('trace'), debug: write('debug'), info: write('info'), warn: write('warn'),
    error: write('error'), fatal: write('fatal') };
  logger.child = (more) => recordingLogger({ ...bindings, ...more });
  return logger;
}

/** @description Inert stand-ins for the seams a schema bootstrap never reaches. */
const SEAMS = {
  '@/shared/logger': { createChildLogger: recordingLogger, logger: recordingLogger({ module: 'root' }) },
  '@/features/agent-management': {
    BotNodeClient: class InertBotNodeClient {},
    createRegistryEndpointResolver: () => () => null,
  },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async () => { throw new Error('no bot rail in the schema fixture'); },
  },
  '@/app/routes/caller-sub': { callerSub: () => null },
};

/** @description Install the seams and send a package file's bare requires (express) to the framework's node_modules. */
function installRequireLayer(coreRequire) {
  if (Module._load.ventureSchemaBootPatched) return;
  const original = Module._load;
  const patched = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(SEAMS, request)) return SEAMS[request];
    const fromPackage = String(parent?.filename || '').startsWith(PKG + path.sep);
    const bare = !request.startsWith('.') && !request.startsWith('@/') && !path.isAbsolute(request)
      && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    return original.call(this, fromPackage && bare ? coreRequire.resolve(request) : request, parent, isMain);
  };
  patched.ventureSchemaBootPatched = true;
  Module._load = patched;
}

/**
 * @description Load the framework's database layer and pg from the checkout named by OSHAL_CORE_ROOT
 *   (or OSHAL_CORE_DIR / OSHAL_FRAMEWORK_ROOT). Fails loudly without one: a skipped guard is not a guard.
 * @returns {{ database: object, Pool: Function, core: string }}
 */
function loadFramework() {
  const marker = path.join(CORE, 'src', 'shared', 'services', 'database', 'schema-lock.ts');
  if (!fs.existsSync(marker) || !fs.existsSync(path.join(CORE, 'node_modules', 'pg'))) {
    throw new Error(`OSHAL_CORE_ROOT (or OSHAL_CORE_DIR / OSHAL_FRAMEWORK_ROOT) must name a framework checkout with src/ and node_modules (got ${CORE})`);
  }
  const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
  process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
  coreRequire('tsx/cjs');
  installRequireLayer(coreRequire);
  const database = coreRequire(path.join(CORE, 'src', 'shared', 'services', 'database', 'index.ts'));
  return { database, Pool: coreRequire('pg').Pool, core: CORE };
}

/**
 * @description Wrap a pool so the suite can tell when nothing is running on it. Counts every query in
 *   flight and every checked-out client until its release; forwards everything else untouched.
 * @param {object} pool The api-shaped pool.
 * @returns {{ pool: object, busy: () => number }}
 */
function countingPool(pool) {
  let inFlight = 0;
  const track = (promise) => { inFlight += 1; return Promise.resolve(promise).finally(() => { inFlight -= 1; }); };
  const proxy = new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'query') return (...args) => track(target.query(...args));
      if (prop === 'connect') {
        return async () => {
          inFlight += 1;
          let client;
          try { client = await target.connect(); } catch (error) { inFlight -= 1; throw error; }
          const release = client.release.bind(client);
          let released = false;
          client.release = (...args) => { if (!released) { released = true; inFlight -= 1; } return release(...args); };
          return client;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { pool: proxy, busy: () => inFlight };
}

/**
 * @description Build the pool exactly as the api's runtime factory does: the identity (GUC) wrapper, then
 *   the runtime DDL guard, then the suite's counting proxy outermost.
 * @param {{ database: object, Pool: Function }} framework From loadFramework.
 * @param {object} config pg connection settings for the application role.
 * @returns {{ pool: object, busy: () => number, raw: object }}
 */
function apiPool(framework, config) {
  const raw = new framework.Pool({ ...config, max: 10 });
  const { gucEnabled, wrapPoolWithGuc, wrapPoolWithRuntimeDdlGuard } = framework.database;
  const scoped = gucEnabled() ? wrapPoolWithGuc(raw) : raw;
  return { ...countingPool(wrapPoolWithRuntimeDdlGuard(scoped)), raw };
}

/** @description Forget every compiled package module, as a fresh api process would start without them. */
function forgetPackageModules() {
  for (const file of Object.keys(require.cache)) if (file.startsWith(ROUTES)) delete require.cache[file];
}

/**
 * @description One api boot of this package: load the compiled routers fresh and call the two factories
 *   that bootstrap the schema back to back, in the manifest's order, as the kernel's mounter does.
 * @param {object} ctx The package context ({ pool, appPackageDir }).
 * @returns {{ rebaseline: object, schema: object }} The freshly loaded tick router and schema modules.
 */
function bootPackage(ctx) {
  forgetPackageModules();
  const consoleRoutes = require(path.join(ROUTES, 'venture-routes.js'));
  const rebaseline = require(path.join(ROUTES, 'venture-rebaseline-routes.js'));
  consoleRoutes.createVentureRoutes(ctx);
  rebaseline.createVentureRebaselineRoutes(ctx);
  return { rebaseline, schema: require(path.join(ROUTES, 'venture-schema.js')) };
}

/**
 * @description Wait until the pool has been idle for three consecutive polls. Polls are timers, so every
 *   promise continuation (the next statement of a bootstrap, a catch handler's log line) has run first.
 * @param {() => number} busy The counting proxy's in-flight reader.
 * @param {number} [timeoutMs] Ceiling before the wait is a failure.
 * @returns {Promise<void>}
 */
async function waitForIdle(busy, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let quiet = 0;
  while (quiet < 3) {
    if (Date.now() > deadline) throw new Error(`the package bootstrap was still running after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    quiet = busy() === 0 ? quiet + 1 : 0;
  }
}

module.exports = { PKG, logs, loadFramework, apiPool, bootPackage, forgetPackageModules, waitForIdle };
