/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: types for the native paper screen reads. The module itself is plain JavaScript at routes/paper/screen.js (the native paper engine has no TypeScript source); the book-read and order-flow builders import it as './paper/screen', which resolves to that file once compiled into routes/.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Declare nativeHost, which the autopilot switch (trading-autopilot-routes.ts) uses to answer from the native paper book on the native kernel.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Declare paperBook, which GET /exposure uses to tell the native paper book apart, and the accountOf/positionsOf/dayOf helpers paper/landing.js reuses.
 *
 * @module paper/screen
 */

/** Which existing screen read to answer from the native paper book. */
export type PaperScreenRead = 'account' | 'positions' | 'ledger' | 'orders' | 'journal' | 'realized' | 'performance';

/**
 * @description The screen payload for one existing read from the person's native paper book, or null when the
 * route's own behaviour stands (not the native kernel, not the paper book, a connected rail, or no paper account).
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param railConnected - Whether the book's broker rail is connected.
 * @param read - Which read.
 * @param opts - Read options.
 * @returns The payload, or null.
 */
export function screenRead(ctx: unknown, sub: string, book: unknown, railConnected: boolean, read: PaperScreenRead,
  opts?: { period?: string; now?: Date }): Promise<Record<string, unknown> | null>;

/**
 * @description GET /status fields for the native paper book ({} when it does not apply).
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param railConnected - Whether the book's broker rail is connected.
 * @returns Fields to merge into the status payload.
 */
export function statusFields(ctx: unknown, sub: string, book: unknown, railConnected: boolean): Promise<Record<string, unknown>>;

/**
 * @description Whether a book's broker reader is connected; a reader that cannot be built is not connected.
 * @param getReader - Builds the reader.
 * @returns True only when the reader's configured() probe answers true.
 */
export function readerConnected(getReader: () => unknown): boolean;

/**
 * @description Whether this route context is the native kernel's (it carries the kernel intent call and a SQL pool).
 * @param ctx - Route context.
 * @returns True on the native kernel.
 */
export function nativeHost(ctx: unknown): boolean;

/**
 * @description Whether the selected book is the paper book (an unresolved book on the native host is the paper book).
 * @param book - The resolved book.
 * @returns True for the paper book.
 */
export function paperBook(book: unknown): boolean;
