/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First logger (0.1.0): the kernel bridge's structured logger (@/shared/logger) when the package runs on a kernel, otherwise one JSON line on stderr. Callers log ids and codes only, never a snapshot, a code, a name or an email.
 */
'use strict';

/**
 * @description A child logger for one module, from the kernel when present.
 * @param {string} module - Module name.
 * @returns {{info: Function, warn: Function, error: Function}} Logger.
 */
function createLogger(module) {
  try {
    // eslint-disable-next-line global-require
    return require('@/shared/logger').createChildLogger({module});
  } catch (_) {
    const write = (level) => (fields, message) => {
      if (process.env.CAREER_COACHING_QUIET_LOG === '1') return;
      const safe = fields && typeof fields === 'object' ? {...fields, err: fields.err ? String(fields.err.message || fields.err) : undefined} : {};
      process.stderr.write(JSON.stringify({level, module, msg: message, ...safe, time: new Date().toISOString()}) + '\n');
    };
    return {info: write('info'), warn: write('warn'), error: write('error')};
  }
}

module.exports = {createLogger};
