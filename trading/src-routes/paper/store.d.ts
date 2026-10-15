/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: types for the native paper store reads the autopilot switch (trading-autopilot-routes.ts) uses. The module itself is plain JavaScript at routes/paper/store.js; './paper/store' resolves to that file once compiled into routes/.
 *
 * @module paper/store
 */

/** The package SQL pool shape the store reads through. */
type PaperPool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

/** The person's paper configuration. */
export interface PaperConfig {
  armed: boolean; posture: string; startingCash: number; maxShares: number; maxNotional: number;
  maxOrdersPerTick: number; maxQuoteAgeMinutes: number; universe: string[] | null; armedAt: string | null; disarmedAt: string | null;
}

/** The person's paper account. */
export interface PaperAccount {
  cash: number; equity: number; highWater: number; realizedPl: number; startingCash: number; version: number;
  lastTickWindow: string | null; createdAt: string; updatedAt: string;
}

/** One recorded tick (newest first from listTicks); trigger_kind is 'schedule' when the kernel's schedule fired it. */
export interface PaperTick {
  tick_window: string; trigger_kind: string; outcome: string; order_count: number; equity: number;
  summary: unknown; created_at: string | null;
}

/**
 * @description The person's paper configuration, or null before the first arm.
 * @param pool - Package SQL pool.
 * @param sub - Caller subject.
 * @returns The configuration.
 */
export function loadConfig(pool: PaperPool, sub: string): Promise<PaperConfig | null>;

/**
 * @description The person's paper account, or null before the first arm.
 * @param pool - Package SQL pool.
 * @param sub - Caller subject.
 * @returns The account.
 */
export function loadAccount(pool: PaperPool, sub: string): Promise<PaperAccount | null>;

/**
 * @description The person's twenty newest ticks.
 * @param pool - Package SQL pool.
 * @param sub - Caller subject.
 * @returns Ticks, newest first.
 */
export function listTicks(pool: PaperPool, sub: string): Promise<PaperTick[]>;
