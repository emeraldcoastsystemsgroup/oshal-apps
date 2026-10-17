/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Types for routes/futures/native.js (the Futures panel's routes on the native kernel).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The nightly 'tick' action.
 *
 * @module futures/native
 */

/**
 * @description Answer one Futures panel action on the native kernel, or null on any other host.
 * @param ctx - Route context.
 * @param action - The route.
 * @param sub - Caller.
 * @param body - Request body.
 * @returns The answer, or null.
 */
export function nativeFutures(ctx: unknown, action: 'get' | 'save' | 'run' | 'tick' | 'review' | 'predictions' | 'prediction' | 'probe' | 'capture' | 'capture-write' | 'delete' | 'pause' | 'resume', sub: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> } | null>;
