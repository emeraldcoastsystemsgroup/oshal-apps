/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- stand-in for the
 *                     |                             | framework's `@/shared/logger` so the SHIPPED
 *                     |                             | routes/*.js artifacts can be required by a plain
 *                     |                             | node process (engine-dir-probe.cjs). The oshal
 *                     |                             | loader resolves `@/` at runtime; outside it the
 *                     |                             | specifier is unresolvable, and a probe that had to
 *                     |                             | rewrite the artifact to load it would no longer be
 *                     |                             | testing the artifact.
 */

'use strict';

const noop = () => {};
const logger = {
  info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
  /** @description Pino's child(); returns this same no-op logger. @returns The logger. */
  child: () => logger,
};

/**
 * @description The framework logger factory's shape, doing nothing.
 * @returns A no-op logger.
 */
function createChildLogger() {
  return logger;
}

module.exports = { createChildLogger, logger };
