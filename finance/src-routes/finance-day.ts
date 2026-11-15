/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.7.0 (Lane FINH1b, 2026-11-14): "where do I stand", mounted at /api/finance/day. GET / reads the person's own records (accounts, this month and the two before, bills, goals, the month against its plan, closed months) and answers the day the model in finance-day-model.ts works out: what is new to review, what is unusual, bills overdue and coming due, the month so far, goals, net worth with its oldest date, and whether this is the first run. It only reads. afterRecordsChange() is what the ledger's writes call once records changed: it proposes a bill for each repeating charge the person has no bill for and marks due dates paid by matching charges, within the time the caller allows, so a proposal is never made on a GET. Nothing here moves money.
 */

/**
 * @module finance-day
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { HOME_BOOK, listAccounts, listMonths, readBook, type LedgerDb, type LedgerTransaction } from './finance-ledger-store';
import { billLists, listBills, listEvents, eventMonths, proposeBills, syncBills } from './finance-bills';
import { goalsWithProgress } from './finance-goals';
import { closeStreak, linkedItems, listCloses, listLines, readMonth } from './finance-month';
import { DAY_MONTHS, buildDay, findRepeating, forward, recentMonths } from './finance-day-model';
import { bookOf, dayOf, route } from './finance-day-kit';
import { figure, monthOf } from './finance-ledger-store';

/** The floor the person planned for this month (the least they want left in cash), as a planned figure. */
async function floorOf(db: LedgerDb, sub: string, bookId: string, month: string) {
  const line = (await listLines(db, sub, bookId, month)).find((l) => l.line === 'floor');
  if (!line || line.plannedCents === null) return null;
  return forward(figure(line.plannedCents, line.currency, line.sourceLabel || 'Your plan', line.source, line.setOn, line.posture), 'planned');
}

/**
 * @description Read everything the day needs and answer it. Only reads.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param today - YYYY-MM-DD.
 * @returns The answer of GET /api/finance/day.
 */
export async function readDay(db: LedgerDb, sub: string, bookId: string, today: string): Promise<Record<string, unknown>> {
  const book = await readBook(db, sub, bookId);
  const accounts = await listAccounts(db, sub, bookId);
  const transactions = await listMonths(db, sub, bookId, recentMonths(today, DAY_MONTHS));
  const bills = billLists(await listBills(db, sub, bookId), await listEvents(db, sub, bookId, eventMonths(today)), today);
  const closes = await listCloses(db, sub, bookId);
  return buildDay({
    bookId, today, currency: book?.currency || accounts[0]?.currency || 'USD', accounts, linked: await linkedItems(db, sub), transactions,
    bills: { proposed: bills.proposed, overdue: bills.overdue, week: bills.week, later: bills.later },
    goals: await goalsWithProgress(db, sub, bookId, today), month: await readMonth(db, sub, bookId, monthOf(today), today),
    floor: await floorOf(db, sub, bookId, monthOf(today)), closedThrough: book?.closedThrough || null, closes,
    streak: closeStreak(closes, today), bookCreatedAt: null,
  });
}

/**
 * @description After the records changed (an import applied or undone, a transaction typed or
 * changed): propose a bill for each repeating charge the person has no bill for, and mark due dates
 * paid by matching charges. Bounded by stopAt so it fits inside the request that made the change.
 * A failure here never undoes the change that was made; the next change tries again.
 * @param db - The pool.
 * @param sub - The caller.
 * @param today - YYYY-MM-DD.
 * @param stopAt - The clock time (ms) after which nothing new is started.
 * @returns How many bills were proposed, and how many due dates were found paid.
 */
export async function afterRecordsChange(db: LedgerDb, sub: string, today: string, stopAt: number): Promise<{ proposed: number; paid: number }> {
  const txns: LedgerTransaction[] = await listMonths(db, sub, HOME_BOOK, recentMonths(today, DAY_MONTHS));
  const proposed = Date.now() < stopAt ? await proposeBills(db, sub, HOME_BOOK, findRepeating(txns, 'out')) : 0;
  const settled = Date.now() < stopAt ? await syncBills(db, sub, HOME_BOOK, today, txns, stopAt) : { paid: 0 };
  return { proposed, paid: settled.paid };
}

/**
 * @description The day's routes. GET / only reads.
 * @param ctx - The application context (its pool is the person's own records).
 * @returns The router mounted at /api/finance/day.
 */
export function createFinanceDayRoutes(ctx: AppContext): Router {
  const router = Router();
  const db = ctx.pool as unknown as LedgerDb;

  /** GET / — where the person stands today, from their own records. */
  router.get('/', route('day', (sub, req) => readDay(db, sub, bookOf(req), dayOf(req))));
  return router;
}
