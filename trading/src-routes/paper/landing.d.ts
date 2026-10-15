/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: types for the native paper book on the Accounts landing. The module itself is plain JavaScript at routes/paper/landing.js; trading-accounts-routes imports it as './paper/landing'.
 *
 * @module paper/landing
 */

/** The person's native paper book as the landing reads it. */
export interface PaperLanding {
  opened: boolean;
  armed: boolean;
  state: Record<string, unknown> | null;
  series: Array<{ date: string; equity: number }>;
  error: string | null;
}

/** One position as the summary rollup reads it. */
export interface PaperLandingPosition { symbol: string; qty: number; marketValue: number }

/**
 * @description The person's native paper book for the landing, or null when the existing answers stand.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param books - The books the store listed.
 * @param railConnected - Whether the paper book's broker rail is connected.
 * @returns The landing state, or null.
 */
export function paperLanding(ctx: unknown, sub: string, books: Array<{ ref: string }>, railConnected: boolean): Promise<PaperLanding | null>;

/**
 * @description The roster entry GET /accounts lists for the native paper book.
 * @param landing - paperLanding's answer.
 * @returns The books[] entry.
 */
export function rosterBook(landing: PaperLanding): Record<string, unknown>;

/**
 * @description The GET /summary row and positions for the native paper book.
 * @param landing - paperLanding's answer.
 * @param now - Instant.
 * @returns The row and the held names.
 */
export function summaryOf(landing: PaperLanding, now: Date): { row: Record<string, unknown> & { equity?: number; dayChange?: number | null }; positions: PaperLandingPosition[] };
