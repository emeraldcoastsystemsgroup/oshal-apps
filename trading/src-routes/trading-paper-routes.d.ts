/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: types for the caller resolution the autopilot switch shares with the native paper routes. The module itself is plain JavaScript at routes/trading-paper-routes.js; './trading-paper-routes' resolves to that file once compiled into routes/.
 *
 * @module trading-paper-routes
 */

/**
 * @description The admitted caller's subject, never read from a header or a body.
 * @param req - Request.
 * @returns The subject, or null.
 */
export function callerOf(req: unknown): string | null;
