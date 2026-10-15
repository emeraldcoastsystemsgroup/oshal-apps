/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: types for the native paper arm/disarm and its declared schedule, used by the autopilot switch (trading-autopilot-routes.ts). The module itself is plain JavaScript at routes/paper/tick.js; './paper/tick' resolves to that file once compiled into routes/.
 *
 * @module paper/tick
 */

/** The manifest's paper-autopilot schedule, as the kernel lists it (app + name) and the route it fires. */
export const PAPER_SCHEDULE: Readonly<{ app: string; name: string; route: string }>;

/** What the native paper engine needs: the package SQL pool, the kernel intent call and an id source. */
export interface PaperDeps {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
  intent?: (name: string, input: unknown) => Promise<unknown>;
  newId?: () => string;
}

/**
 * @description Arm the person's paper book (re-arming keeps the open book's cash and positions).
 * @param deps - Package SQL pool and kernel intent.
 * @param sub - Caller subject.
 * @param body - Arm request body (posture, cash and size guards, pinned universe).
 * @param now - Instant.
 * @returns The saved configuration, the account and the schedule the person activates; refusals throw with status + code.
 */
export function armPaper(deps: PaperDeps, sub: string, body: unknown, now: Date): Promise<Record<string, unknown>>;

/**
 * @description Disarm the person's paper book; history and positions stay.
 * @param deps - Package SQL pool.
 * @param sub - Caller subject.
 * @param now - Instant.
 * @returns Whether a row changed, and the schedule.
 */
export function disarmPaper(deps: PaperDeps, sub: string, now: Date): Promise<{ ok: true; armed: false; changed: boolean; schedule: typeof PAPER_SCHEDULE }>;
