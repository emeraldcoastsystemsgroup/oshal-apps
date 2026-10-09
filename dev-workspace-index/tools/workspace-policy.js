/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Explicit three-part gate for the developer-workspace query surface.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Server-verified dev mode replaces the client-set x-oshal-dev-context header as the authority: a DevModeRegistry holds the flag per (issuer, sub) with a TTL and nothing survives a restart; the gate now needs the ADR-077 capability, the super-admin allowlist, the package flag AND dev mode, and names the first failing check so a refusal is explainable without leaking the allowlist.
 */

'use strict';

const CHECKS = Object.freeze([
  ['devConsoleEnabled', 'dev_console_disabled'],
  ['superAdmin', 'super_admin_required'],
  ['packageEnabled', 'package_disabled'],
  ['devMode', 'dev_mode_off'],
]);

/**
 * @description Name the first failing gate, in the fixed order the gate evaluates them.
 * @param {{devConsoleEnabled: boolean, superAdmin: boolean, packageEnabled: boolean, devMode: boolean}} checks Evaluated checks.
 * @returns {string|null} A stable refusal code, or null when every check passed.
 */
function refusalReason(checks) {
  const failing = CHECKS.find(([key]) => checks[key] !== true);
  return failing ? failing[1] : null;
}

/**
 * @description The only way to reach the workspace index: every check must be exactly true.
 * @param {{devConsoleEnabled: boolean, superAdmin: boolean, packageEnabled: boolean, devMode: boolean}} checks Evaluated checks.
 * @returns {boolean} Whether the query may proceed.
 */
function isDevWorkspaceQueryAllowed(checks) {
  return refusalReason(checks) === null;
}

/**
 * @description Server-held dev mode per verified actor. Keyed by issuer and subject so a subject
 * collision across identity providers can never share a grant; expires by TTL; process-local, so a
 * restart fails closed and dev mode has to be turned on again.
 */
class DevModeRegistry {
  /**
   * @param {{ttlMs: number, now?: () => number}} options TTL in milliseconds and an injectable clock.
   */
  constructor({ ttlMs, now = Date.now }) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new Error('DevModeRegistry needs a positive integer ttlMs');
    this.ttlMs = ttlMs;
    this.now = now;
    this.grants = new Map();
  }

  static key(actor) {
    if (!actor || typeof actor.sub !== 'string' || !actor.sub || typeof actor.issuer !== 'string' || !actor.issuer) return null;
    return `${actor.issuer}\u0000${actor.sub}`;
  }

  /**
   * @description Turn dev mode on for one actor until the TTL elapses.
   * @param {{sub: string, issuer: string}} actor Verified actor.
   * @returns {{enabled: true, expiresAt: string}} The new state.
   */
  enable(actor) {
    const key = DevModeRegistry.key(actor);
    if (!key) throw new Error('dev mode needs a verified actor with sub and issuer');
    const expires = this.now() + this.ttlMs;
    this.grants.set(key, expires);
    return { enabled: true, expiresAt: new Date(expires).toISOString() };
  }

  /**
   * @description Turn dev mode off for one actor.
   * @param {{sub: string, issuer: string}} actor Verified actor.
   * @returns {{enabled: false, expiresAt: null}} The new state.
   */
  disable(actor) {
    const key = DevModeRegistry.key(actor);
    if (key) this.grants.delete(key);
    return { enabled: false, expiresAt: null };
  }

  /**
   * @description Read one actor's current state, dropping an expired grant on the way.
   * @param {{sub: string, issuer: string}} actor Verified actor.
   * @returns {{enabled: boolean, expiresAt: string|null}} The state.
   */
  state(actor) {
    const key = DevModeRegistry.key(actor);
    const expires = key ? this.grants.get(key) : undefined;
    if (expires === undefined) return { enabled: false, expiresAt: null };
    if (expires <= this.now()) {
      this.grants.delete(key);
      return { enabled: false, expiresAt: null };
    }
    return { enabled: true, expiresAt: new Date(expires).toISOString() };
  }

  /**
   * @description Whether dev mode is on for the actor right now.
   * @param {{sub: string, issuer: string}} actor Verified actor.
   * @returns {boolean} True only for an unexpired grant of exactly this issuer and subject.
   */
  isEnabled(actor) {
    return this.state(actor).enabled;
  }
}

module.exports = { DevModeRegistry, isDevWorkspaceQueryAllowed, refusalReason };
