/**
 * Per-book specialist-context facts for the accountable trading bot.
 *
 * A protected bot-node run is TOOL-LESS: the worker gets no tools and no workspace, so the
 * trading-analyst cannot fetch its own numbers. The kernel's specialist-context channel
 * (@/shared/specialist-context, declared in `uses:`) is the only data channel that reaches it —
 * the controller reads a CLOSED set of scalar facts under the caller's own authority and appends
 * them to the prompt before the signed dispatch.
 *
 * Four constraints shape everything here:
 *
 *  1. ONE BOOK PER KEY. Every figure belongs to exactly ONE book and the key says which. Nothing is
 *     ever summed — not across kinds, and not across the books of one kind. The operator has THREE
 *     live books, and grouping them cost him the answer: on 2026-09-15 the engine book had a
 *     recorded equity of 42,758.05 while its two sibling accounts had not been snapshotted since
 *     the 14th, so a group that reported only when EVERY member was fresh reported nothing at all.
 *     A stale sibling now costs that sibling's keys and nothing else.
 *  2. OWNER SCOPE. Facts are computed for the principal the kernel hands us (the ticket's owner),
 *     never for whoever happens to be asking. Every store read takes that sub explicitly, and the
 *     kernel has already re-scoped the request identity to the same sub.
 *  3. THE DEADLINE. SpecialistContextRegistry gives a reader 2000 ms and THROWS on expiry rather
 *     than degrading — a timeout takes the whole dispatch down. So this reader never makes an
 *     outbound venue call (the obvious helper, tradableSessionDetailed(), spends up to 8000 ms on
 *     the venue clock), works to its own smaller budget, and reports what it could not finish
 *     instead of guessing. Equity comes from the recorded daily-equity series, which the autopilot
 *     fires and the ledger reads already write; a book with no snapshot today — a closed market, or
 *     a venue unreachable all session — reads `null` with `equity_recorded_today: false`, never a
 *     stale figure and never a fabricated 0.
 *  4. THE KEY SET IS DECLARED ONCE. `register()` runs at route-mount time, for every owner at once,
 *     and the kernel's normalizeFacts demands the read return EXACTLY the declared keys. So a key
 *     cannot carry a per-owner book ref (`b-6690e236`) even though the kernel's key regex would
 *     accept one: the declaration is made long before any owner's books are known. The keys are
 *     therefore fixed SLOTS, filled in the order `listBooks` already returns (legacy refs first,
 *     then by creation), and every slot carries its own `present` flag so "no such book" and "book
 *     with no numbers" stay distinct. A live slot is only ever filled by a live book, so paper
 *     money can never be read as real.
 *
 * The reader NEVER throws. A refusal here is a dead dispatch and a silent thread, which is the
 * exact failure this channel exists to end — so a failed read degrades to all-null facts with
 * `facts.complete: false` and an ERROR log, and the bot answers with what it does not know.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial - the closed fact set the trading specialist reads: book-scoped by kind, owner-scoped, venue-free and bounded well inside the kernel's 2000 ms specialist deadline.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | One book per key, not one KIND per key. Grouping by kind put the operator's three live books behind a single freshness gate, so a sibling account that had not been snapshotted since the previous session withheld the engine book's real recorded equity and the answer came back unknown. Facts are now fixed per-book slots (paper, live, live2..live4) filled in listBooks order, each with its own present flag and its own equity and realized figures; books.live / books.paper / books.unreported carry the shape of the account set, and an owner with more books than slots reads incomplete rather than silently short.
 *
 * @module trading-book-facts
 */

import type { AppContext } from '@/app/composition/app-context';
import type { TradingBook } from '@/features/trading';
import { createChildLogger } from '@/shared/logger';
import { listBooks } from '@/app/trading-books-store';
import { loadDailyEquitySeries } from '@/app/trading-daily-equity-store';
import { realizedReport } from './trading-realized';

const logger = createChildLogger({ module: 'trading-book-facts' });

/** The kernel's `SpecialistFact` shape: scalars only - no text, no content, no credential. */
export type TradingFactValue = number | boolean | null;

/**
 * Our own budget, well inside the registry's 2000 ms. The registry aborts and THROWS at its
 * deadline; we stop at ours and say the facts are incomplete, which keeps the dispatch alive.
 */
export const TRADING_FACTS_BUDGET_MS = 1200;

/** How far back the recorded equity series is read to find today's value and the prior close. */
export const EQUITY_WINDOW_DAYS = 30;

/**
 * The reported book slots, in fill order. `paper` takes the one paper book (createBook only ever
 * mints LIVE books, so a second paper book is an anomaly, not a shape to design for); the live
 * slots take the live books in `listBooks` order, which puts the legacy `live` book - the engine's
 * book - first. Four live slots covers the operator's three accounts with one spare; a fifth reads
 * as unreported rather than being silently dropped.
 */
export const TRADING_BOOK_SLOTS = ['paper', 'live', 'live2', 'live3', 'live4'] as const;

/** One reported book's fact-key prefix. */
export type TradingBookSlot = typeof TRADING_BOOK_SLOTS[number];

/** The live slots, in fill order - a paper book may never occupy one of these. */
const LIVE_SLOTS: readonly TradingBookSlot[] = ['live', 'live2', 'live3', 'live4'];

/** The single paper slot. */
const PAPER_SLOTS: readonly TradingBookSlot[] = ['paper'];

/** The per-book fact suffixes. Prefixed with a slot, these are the closed key set. */
const SUFFIXES = [
  'present',
  'equity_today',
  'equity_prior_close',
  'equity_recorded_today',
  'day_change',
  'day_change_pct',
  'realized_today_net',
  'realized_today_trades',
  'realized_today_wins',
  'realized_today_losses',
] as const;

/** The shape of the whole account set, so a filled slot set is never mistaken for all of it. */
const SHAPE_KEYS = ['books.live', 'books.paper', 'books.unreported'] as const;

/**
 * The CLOSED fact set, exactly as declared to the registry. The registry rejects a read whose keys
 * are not this set, so the declaration and the reader cannot drift apart. 5 slots x 10 suffixes +
 * 3 shape keys + `facts.complete` = 54, inside the registry's 64-key cap.
 */
export const TRADING_FACT_KEYS: readonly string[] = Object.freeze([
  ...TRADING_BOOK_SLOTS.flatMap((slot) => SUFFIXES.map((suffix) => `${slot}.${suffix}`)),
  ...SHAPE_KEYS,
  'facts.complete',
]);

/** One book's numbers, before they are flattened onto its slot's fact keys. */
interface BookFacts {
  present: boolean;
  equityToday: number | null;
  equityPriorClose: number | null;
  equityRecordedToday: boolean;
  realizedNet: number | null;
  realizedTrades: number | null;
  realizedWins: number | null;
  realizedLosses: number | null;
}

/**
 * @description The US/Eastern calendar day - the key the daily-equity store writes its snapshots
 * under, so "today" here means the same day the stored series means.
 * @param ms - Epoch milliseconds.
 * @returns YYYY-MM-DD in America/New_York.
 */
export function easternDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The refs every user's deterministic legacy books carry (trading-books-store legacyBookId). */
const LEGACY_REFS = new Set(['paper', 'live']);

/**
 * @description Start a slot at "no such book", so a slot no book fills reads as absent rather than
 * as a book with nothing in it.
 * @returns An absent, all-null slot.
 */
function emptyBook(): BookFacts {
  return {
    present: false, equityToday: null, equityPriorClose: null, equityRecordedToday: false,
    realizedNet: null, realizedTrades: null, realizedWins: null, realizedLosses: null,
  };
}

/**
 * @description Deal the owner's books onto the fixed slots. Legacy books go first (`listBooks`
 * already orders that way; the sort pins it so a caller's ordering cannot move the engine book off
 * `live`), then the rest in the order they were created. A live slot only ever takes a LIVE book -
 * reporting paper money under a live key is the failure this whole module exists to prevent - and
 * a book with no slot left is counted, never quietly dropped.
 * @param books - The owner's books as `listBooks` returned them.
 * @returns The slot assignment, in fill order, and the number of books no slot could take.
 */
export function assignBookSlots(books: TradingBook[]): {
  slots: Array<[TradingBookSlot, TradingBook]>; unreported: number;
} {
  const ordered = [...books].sort(
    (left, right) => Number(LEGACY_REFS.has(right.ref)) - Number(LEGACY_REFS.has(left.ref)));
  const free: Record<'live' | 'paper', TradingBookSlot[]> = {
    live: [...LIVE_SLOTS], paper: [...PAPER_SLOTS],
  };
  const slots: Array<[TradingBookSlot, TradingBook]> = [];
  let unreported = 0;
  for (const book of ordered) {
    const slot = free[book.kind]?.shift();
    if (slot) slots.push([slot, book]); else unreported += 1;
  }
  return { slots, unreported };
}

/**
 * @description Read ONE book's recorded equity and engine-priced closes. Its own snapshot decides
 * its own numbers: a sibling account that has not been snapshotted today costs that sibling its
 * keys and nothing else.
 * @param ctx - The package context (pool only).
 * @param sub - The principal the facts are computed for (the ticket's owner).
 * @param book - The one book being read.
 * @param today - Today's US/Eastern calendar day.
 * @returns The book's numbers.
 */
async function readBook(
  ctx: Pick<AppContext, 'pool'>, sub: string, book: TradingBook, today: string,
): Promise<BookFacts> {
  const series = await loadDailyEquitySeries(ctx.pool, sub, book, EQUITY_WINDOW_DAYS);
  const todays = series.filter((point) => point.etDay === today).pop();
  // The prior session's close, defined exactly as loadPriorCloseEquity defines it: the latest
  // snapshot dated BEFORE today.
  const prior = series.filter((point) => point.etDay < today).pop();
  const realized = await realizedReport(ctx, sub, book.bookId);
  return {
    present: true,
    equityToday: todays ? round2(todays.equity) : null,
    equityPriorClose: prior ? round2(prior.equity) : null,
    equityRecordedToday: !!todays,
    realizedNet: round2(realized.today.net),
    realizedTrades: realized.today.trades,
    realizedWins: realized.today.wins,
    realizedLosses: realized.today.losses,
  };
}

/**
 * @description Flatten one book onto its slot's fact keys, deriving the day change only when both
 * ends of it are that same book's real figures.
 * @param slot - The slot, which is also the key prefix.
 * @param facts - The book's numbers.
 * @param out - The fact record being filled (mutated).
 * @returns Nothing.
 */
function emit(slot: TradingBookSlot, facts: BookFacts, out: Record<string, TradingFactValue>): void {
  const change = facts.equityToday != null && facts.equityPriorClose != null
    ? round2(facts.equityToday - facts.equityPriorClose) : null;
  out[`${slot}.present`] = facts.present;
  out[`${slot}.equity_today`] = facts.equityToday;
  out[`${slot}.equity_prior_close`] = facts.equityPriorClose;
  out[`${slot}.equity_recorded_today`] = facts.equityRecordedToday;
  out[`${slot}.day_change`] = change;
  out[`${slot}.day_change_pct`] = change != null && facts.equityPriorClose
    ? round2((change / facts.equityPriorClose) * 100) : null;
  out[`${slot}.realized_today_net`] = facts.realizedNet;
  out[`${slot}.realized_today_trades`] = facts.realizedTrades;
  out[`${slot}.realized_today_wins`] = facts.realizedWins;
  out[`${slot}.realized_today_losses`] = facts.realizedLosses;
}

/** Everything the reader needs from the kernel. */
export interface TradingFactsInput {
  /** The verified principal the facts belong to - the ticket's owner, never the asker. */
  sub: string;
  /** The registry's deadline signal. Aborted means stop and report incomplete. */
  signal?: AbortSignal;
}

/** Budget and clock seams; production callers pass nothing. */
export interface TradingFactsOptions {
  budgetMs?: number;
  now?: () => number;
}

/**
 * @description Fill every slot with the book dealt to it, one book at a time, so one unreadable or
 * unsnapshotted book costs only its own keys.
 * @param ctx - The package context (pool only).
 * @param sub - The ticket owner.
 * @param assignment - The slot assignment from assignBookSlots.
 * @param out - The fact record being filled (mutated).
 * @param spent - Whether the reader is out of budget.
 * @param now - The clock.
 * @returns Whether every dealt book was read in full.
 */
async function fillSlots(
  ctx: Pick<AppContext, 'pool'>, sub: string,
  assignment: Array<[TradingBookSlot, TradingBook]>,
  out: Record<string, TradingFactValue>, spent: () => boolean, now: () => number,
): Promise<boolean> {
  let complete = true;
  // Sequential on purpose: each store helper runs its own idempotent schema bootstrap under a
  // Postgres advisory lock, and firing those concurrently would queue pool clients against each
  // other inside a deadline instead of finishing well before it.
  for (const [slot, book] of assignment) {
    if (spent()) {
      // Out of budget: the book EXISTS (a fact already in hand) but its money is unknown. An
      // incomplete figure is a wrong figure.
      emit(slot, { ...emptyBook(), present: true }, out);
      complete = false;
      continue;
    }
    try {
      emit(slot, await readBook(ctx, sub, book, easternDay(now())), out);
    } catch (error) {
      // One unreadable book must not cost the other books, nor the dispatch.
      logger.error({ err: error, slot, bookId: book.bookId, kind: book.kind },
        'Trading specialist facts: one book could not be read - reported as present but unknown');
      emit(slot, { ...emptyBook(), present: true }, out);
      complete = false;
    }
  }
  return complete;
}

/**
 * @description Read the closed, per-book fact set for one owner. Makes no outbound venue call,
 * stops at its own budget, and never throws: an unreadable store degrades to all-null facts with
 * `facts.complete: false`, so the dispatch still reaches the bot carrying an honest "unknown"
 * rather than killing the ticket.
 * @param ctx - The package context (pool only).
 * @param input - The verified principal and the registry's abort signal.
 * @param options - Budget and clock seams for the regression guard.
 * @returns Exactly the keys in TRADING_FACT_KEYS, scalars only.
 */
export async function readTradingBookFacts(
  ctx: Pick<AppContext, 'pool'>, input: TradingFactsInput, options: TradingFactsOptions = {},
): Promise<Record<string, TradingFactValue>> {
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? TRADING_FACTS_BUDGET_MS;
  const expiresAt = now() + budgetMs;
  // Filled in place as each book completes, so the budget timer can return whatever is already
  // known instead of nothing.
  const out: Record<string, TradingFactValue> = {};
  for (const slot of TRADING_BOOK_SLOTS) emit(slot, emptyBook(), out);
  for (const key of SHAPE_KEYS) out[key] = 0;
  out['facts.complete'] = false;
  const spent = (): boolean => input.signal?.aborted === true || now() >= expiresAt;

  const work = async (): Promise<void> => {
    const books = await listBooks(ctx.pool, input.sub);
    out['books.live'] = books.filter((book) => book.kind === 'live').length;
    out['books.paper'] = books.filter((book) => book.kind === 'paper').length;
    const { slots, unreported } = assignBookSlots(books);
    out['books.unreported'] = unreported;
    const filled = await fillSlots(ctx, input.sub, slots, out, spent, now);
    // A book no slot could take is a number the bot cannot see, so the facts are not complete.
    out['facts.complete'] = filled && unreported === 0 && !spent();
  };

  // The budget is enforced by a RACE, not only by checks between steps: a single wedged query
  // would otherwise hold the reader past the registry's 2000 ms, and the registry throws there -
  // which kills the dispatch and puts the operator's thread back where it started, silent.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
  try {
    await Promise.race([
      work().catch((error) => {
        logger.error({ err: error }, 'Trading specialist facts unavailable - dispatching with no numbers');
      }),
      budget,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  // A run the budget cut short leaves `facts.complete` at its initial false, because only the end
  // of work() ever sets it true. Return a COPY: work() may still be in flight after the timer won,
  // and a fact record that changes under the kernel between here and its validation is exactly the
  // kind of number nobody can stand behind.
  return { ...out };
}
