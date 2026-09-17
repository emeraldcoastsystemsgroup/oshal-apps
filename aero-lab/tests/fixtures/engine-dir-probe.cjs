/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- load the SHIPPED
 *                     |                             | compiled adapter (routes/engine-adapter.js) the
 *                     |                             | way the oshal loader does and print the engine
 *                     |                             | status it resolves. Run against a package skeleton
 *                     |                             | that carries routes/ but no vendored engine/aerosim,
 *                     |                             | it answers the question the TypeScript source cannot:
 *                     |                             | what does a box actually get when nothing points at
 *                     |                             | an engine tree.
 */

'use strict';

const Module = require('module');
const path = require('path');

const LOGGER_STUB = path.join(__dirname, 'core-logger-stub.cjs');
const originalResolve = Module._resolveFilename;

/**
 * @description Resolve the framework's `@/shared/logger` alias to the local stub; everything
 * else resolves normally, so the artifact under test is loaded unmodified.
 * @param request - The specifier being resolved.
 * @param rest - Node's remaining _resolveFilename arguments.
 * @returns The resolved filename.
 */
Module._resolveFilename = function resolveWithCoreAlias(request, ...rest) {
  if (request === '@/shared/logger') return LOGGER_STUB;
  return originalResolve.call(this, request, ...rest);
};

const adapterPath = process.argv[2];
if (!adapterPath) {
  process.stderr.write('usage: engine-dir-probe.cjs <path to routes/engine-adapter.js>\n');
  process.exit(2);
}

// eslint-disable-next-line import/no-dynamic-require
const { AeroEngineAdapter } = require(adapterPath);
const adapter = new AeroEngineAdapter({});
process.stdout.write(JSON.stringify(adapter.engineStatus()));
adapter.dispose();
