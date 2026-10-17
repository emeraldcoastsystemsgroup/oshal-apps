/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Types for routes/paper/manual.js (manual orders on the native paper book).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Type for quoteManual.
 *
 * @module paper/manual
 */

/** A route answer: the status and the JSON body. */
export interface PaperAnswer { status: number; body: Record<string, unknown> }

/**
 * @description Review a manual market order on the native paper book and record its decision.
 * @param deps - {pool, intent, newId}.
 * @param sub - Caller subject.
 * @param input - The order request.
 * @returns The decision payload or a refusal.
 */
export function previewManual(deps: { pool: unknown; intent: unknown; newId: () => string }, sub: string, input: {
  symbol: string; side: string; qty?: unknown; notional?: unknown; orderType?: string; fireAt?: unknown; protect?: boolean;
  rationale?: string; now: Date;
}): Promise<PaperAnswer>;

/**
 * @description The ticket's quote on the native paper book: the stored price its orders are priced at.
 * @param deps - {intent}.
 * @param symbol - Upper-case ticker.
 * @param bookRef - The book reference to answer with.
 * @returns The quote, or a 404 refusal when there is no stored price.
 */
export function quoteManual(deps: { intent: unknown }, symbol: string, bookRef: string): Promise<PaperAnswer>;

/**
 * @description Fill a recorded manual paper decision once; null when it is not one.
 * @param deps - {pool, intent, newId}.
 * @param sub - Caller subject.
 * @param decisionId - The decision.
 * @param now - Instant.
 * @returns The order, a refusal, or null.
 */
export function fillManual(deps: { pool: unknown; intent: unknown; newId: () => string }, sub: string, decisionId: string, now: Date): Promise<PaperAnswer | null>;
