/**
 * The fantasy-leagues kernel skill, loaded from a framework checkout's SOURCE for the fantasy suites.
 *
 * WHY THIS EXISTS. Sports Edge no longer carries an ESPN fantasy client: it imports the kernel skill
 * `@/features/fantasy-leagues` (ADR-146 D2), which the framework resolves at mount. The fantasy
 * suites drive that client for real — its retry, its failure classification, its cookie header and
 * its feed distillation are exactly what they assert — so a double here would test nothing. This
 * fixture compiles the skill's own TypeScript with the framework's own compiler and evaluates it in
 * this realm, so a suite's global fetch stub reaches it exactly as it reaches the mounted module.
 *
 * Only the Pino logger is doubled (quiet), as every other suite in this package doubles it. Any other
 * framework import the skill makes is refused: the skill is self-contained by contract, and a new
 * dependency should fail here loudly rather than be silently stubbed.
 *
 * The framework checkout comes from OSHAL_CORE_ROOT (the Test Lab sets /app), OSHAL_CORE_DIR or
 * OSHAL_FRAMEWORK (store-ci's framework checkout). The first one that carries the skill wins; none
 * is a hard failure naming what is missing, never a skip.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — resolve a framework checkout that carries the fantasy-leagues kernel skill, transpile its sources with that checkout's TypeScript, double only @/shared/logger, refuse every other framework import, and cache one module instance per process.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Moved from sports-edge with the fantasy suites (ADR-146 D1); unchanged.
 */

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const SKILL = path.join('src', 'features', 'fantasy-leagues');
const QUIET_LOGGER = { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };

let loaded = null;

/**
 * @description The first configured framework checkout that carries the skill and a compiler.
 * @returns {string} Absolute path of the checkout.
 */
function frameworkRoot() {
  const named = ['OSHAL_CORE_ROOT', 'OSHAL_CORE_DIR', 'OSHAL_FRAMEWORK']
    .filter((key) => process.env[key])
    .map((key) => ({ key, root: path.resolve(process.env[key]) }));
  if (!named.length) {
    throw new Error('fixture:core-checkout is required: set OSHAL_CORE_ROOT (the Test Lab sets /app), OSHAL_CORE_DIR '
      + 'or OSHAL_FRAMEWORK to a framework checkout with node_modules. The ESPN fantasy client these suites drive '
      + 'is the fantasy-leagues kernel skill, not part of this package.');
  }
  const usable = named.find(({ root }) => fs.existsSync(path.join(root, SKILL, 'index.ts'))
    && fs.existsSync(path.join(root, 'node_modules', 'typescript', 'package.json')));
  if (!usable) {
    throw new Error(`no framework checkout carries ${SKILL.split(path.sep).join('/')} with TypeScript installed `
      + `(checked ${named.map(({ key, root }) => `${key}=${root}`).join(', ')}); it predates the fantasy-leagues `
      + 'kernel skill (ADR-146 D2) or has no node_modules.');
  }
  return usable.root;
}

/**
 * @description Resolve a relative skill import to its TypeScript source.
 * @param {string} base - Absolute path without extension.
 * @returns {string} The .ts file, or the directory's index.ts.
 */
function sourceFor(base) {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`fantasy-leagues fixture: cannot resolve ${base}`);
}

/**
 * @description Transpile and evaluate one skill source, resolving its relative imports recursively.
 * @param {string} file - Absolute .ts path.
 * @param {{ts: object, coreRequire: Function, cache: Map}} env - Compiler, framework require, module cache.
 * @returns {object} The module's exports.
 */
function loadSource(file, env) {
  if (env.cache.has(file)) return env.cache.get(file).exports;
  const mod = { exports: {} };
  env.cache.set(file, mod);
  const { outputText } = env.ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: env.ts.ModuleKind.CommonJS, target: env.ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const localRequire = (request) => {
    if (request === '@/shared/logger') return QUIET_LOGGER;
    if (request.startsWith('.')) return loadSource(sourceFor(path.resolve(path.dirname(file), request)), env);
    if (request.startsWith('@/')) throw new Error(`fantasy-leagues fixture: unexpected framework import ${request} in ${file}`);
    return env.coreRequire(request);
  };
  new vm.Script(`(function (require, module, exports) {${outputText}\n})`, { filename: file })
    .runInThisContext()(localRequire, mod, mod.exports);
  return mod.exports;
}

/**
 * @description The kernel skill's exports, loaded once per process from the framework source.
 * @returns {object} What `require('@/features/fantasy-leagues')` resolves to when the package is mounted.
 */
function fantasyLeagues() {
  if (loaded) return loaded;
  const root = frameworkRoot();
  const coreRequire = createRequire(path.join(root, 'package.json'));
  loaded = loadSource(path.join(root, SKILL, 'index.ts'), { ts: coreRequire('typescript'), coreRequire, cache: new Map() });
  return loaded;
}

module.exports = { fantasyLeagues };
