/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Bills from the person's own mail, mounted at /api/finance/mail (Finance 1.8.0, Lane FINH2; Roger 2026-11-14: "pulls your bills from emails"). The person turns the mail check on themselves (POST /switch with confirm: true); it is off until they do, and a check while it is off reads no mail. A check (POST /check, the Check my mail now button and the finance-mail-bills job) searches the caller's Gmail through the kernel's declared egress, which adds the caller's own gmail connection on the way out (the package never holds a token), with one bounded query for bill-like mail of the last 45 days, reads at most 20 messages in 45 s and continues where it stopped on the next check. Each bill found by fixed patterns (finance-mail-parse) becomes a proposal under Found in your mail; nothing becomes a bill without the person's yes (POST /finds/:findId/add with confirm: true), which adds a bill or brings the bill already known for that payee up to date. Not a bill (POST /finds/:findId/dismiss) is remembered for that payee. Kept of a message: its id, sender, subject and date, and the payee, amount due and due date; never its text. Nothing is paid, nothing is sent, no mail is changed. The GET only reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.8.1 (VER4 acceptance on the test slot, 2026-11-14): after Look for bills in my mail with no Google connection the check answered read: 0, status: not-connected and more: true, so Bills said "There is more mail to read; Finance continues at the next check." though no mail was read: the first request failed after the check had opened its window of days. `more` now says there is more mail only after a check that reached the mailbox (status connected) stopped with its window still open; a mailbox that could not be read, and a check that is off, never say so.
 */

/**
 * @module finance-mail
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { LedgerRefusal, cleanText, duplicateKey, ensureBook, figure, hashId, nowStamp, type Figure, type LedgerDb } from './finance-ledger-store';
import { merchantKey } from './finance-day-model';
import { bodyOf, bookOf, cell, centsOf, dateOf, dayOf, jsonParam, nameOf, requireConfirm, route } from './finance-day-kit';
import { CADENCES, billCard, covers, dropUnpaid, insertBill, listBills, saveBill, syncBills, type Bill } from './finance-bills';
import { readBill, type GmailMessage, type MailBill } from './finance-mail-parse';

const logger = createChildLogger({ module: 'finance-mail' });

/** The caller's own Gmail, as the kernel's declared egress reaches it (the kernel adds the credential). */
export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** How far back the first check looks. */
export const LOOK_BACK_DAYS = 45;
/** The work one check does before it stops and saves where it is (the kernel ends a package call at 60 s). */
export const RUN_MS = 45_000;
/** The most messages one check reads. */
export const READ_PER_RUN = 20;
/** Messages listed a page. */
export const PAGE_SIZE = 25;
/** The longest one mailbox request may take. */
const CALL_MS = 5_500;
/** Message ids remembered as read. */
const SEEN_KEPT = 1_500;
/** The words the search asks for; promotions are left out. */
export const MAIL_WORDS = '{statement bill invoice "payment due" "amount due" "balance due" "due date"} -category:promotions';
/** What the mail check is, in the words the screen and the concierge use. */
export const MAIL_NOTE = 'Finance reads only bill-like mail and keeps the sender, the subject and the date of each bill it finds. It sends nothing, changes nothing in your mailbox and pays nothing. Nothing becomes a bill until you add it.';

/** What one check did. */
export interface MailCounts { read: number; found: number; receipts: number; noAmount: number; noDate: number }

/** Where the person's mail check stands, as stored. */
export interface MailCheck {
  checkId: string; bookId: string; state: string; status: string; detail: string; turnedOnAt: string | null; lastCheckedAt: string | null;
  lastSuccessAt: string | null; windowAfter: number | null; windowBefore: number | null; pageToken: string; pending: string[] | null;
  seen: string[]; counts: MailCounts | null; createdAt: string; updatedAt: string;
}

/** One bill found in one message, as stored. */
export interface MailFind {
  findId: string; bookId: string; messageId: string; sender: string; subject: string; mailDate: string; payee: string; payeeKey: string;
  amountCents: number; currency: string; dueDate: string; state: string; billId: string; createdAt: string; updatedAt: string;
}

/** How a check reads the mailbox: fetch, through the kernel's egress. A test hands its own. */
export type MailFetch = (url: string, init?: { method?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const CHECK_COLUMNS = 'check_id, user_sub, book_id, state, status, detail, turned_on_at, last_checked_at, last_success_at, window_after, window_before, page_token, pending, seen, counts, created_at, updated_at';
const FIND_COLUMNS = 'find_id, user_sub, book_id, message_id, sender, subject, mail_date, payee, payee_key, amount_cents, currency, due_date, state, bill_id, created_at, updated_at';

/** Every statement this module issues. The selective text equality comes first in each WHERE. */
export const MAIL_SQL = Object.freeze({
  checkRead: `SELECT ${CHECK_COLUMNS} FROM finance_mail_checks WHERE check_id = $1 AND user_sub = $2`,
  checkInsert: `INSERT INTO finance_mail_checks (${CHECK_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17)`,
  checkUpdate: 'UPDATE finance_mail_checks SET state = $3, status = $4, detail = $5, turned_on_at = $6, last_checked_at = $7, last_success_at = $8, window_after = $9, window_before = $10, page_token = $11, pending = $12::jsonb, seen = $13::jsonb, counts = $14::jsonb, updated_at = $15 WHERE check_id = $1 AND user_sub = $2',
  findsByBook: `SELECT ${FIND_COLUMNS} FROM finance_mail_finds WHERE book_id = $1 AND user_sub = $2`,
  findRead: `SELECT ${FIND_COLUMNS} FROM finance_mail_finds WHERE find_id = $1 AND user_sub = $2`,
  findInsert: `INSERT INTO finance_mail_finds (${FIND_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
  findUpdate: 'UPDATE finance_mail_finds SET payee = $3, amount_cents = $4, due_date = $5, state = $6, bill_id = $7, updated_at = $8 WHERE find_id = $1 AND user_sub = $2',
});

/* ─── the store ─────────────────────────────────────────────────────────────── */

/** A whole number from a stored cell, or null. */
function wholeCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function checkOf(row: any): MailCheck {
  return {
    checkId: row.check_id, bookId: row.book_id, state: row.state, status: row.status, detail: row.detail || '', turnedOnAt: row.turned_on_at || null,
    lastCheckedAt: row.last_checked_at || null, lastSuccessAt: row.last_success_at || null, windowAfter: wholeCell(row.window_after),
    windowBefore: wholeCell(row.window_before), pageToken: row.page_token || '', pending: cell<string[]>(row.pending),
    seen: cell<string[]>(row.seen) || [], counts: cell<MailCounts>(row.counts), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function findOf(row: any): MailFind {
  return {
    findId: row.find_id, bookId: row.book_id, messageId: row.message_id, sender: row.sender || '', subject: row.subject || '', mailDate: row.mail_date,
    payee: row.payee, payeeKey: row.payee_key, amountCents: Number(row.amount_cents), currency: row.currency || 'USD', dueDate: row.due_date,
    state: row.state, billId: row.bill_id || '', createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/**
 * @description The id of a person's mail check for one set of records.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The id.
 */
export function checkIdOf(sub: string, bookId: string): string {
  return hashId('mailcheck', sub, bookId);
}

/**
 * @description The person's mail check, or one that is off when they never turned it on.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The check and whether it is stored.
 */
export async function readCheck(db: LedgerDb, sub: string, bookId: string): Promise<{ check: MailCheck; stored: boolean }> {
  const row = (await db.query(MAIL_SQL.checkRead, [checkIdOf(sub, bookId), sub])).rows[0];
  if (row) return { check: checkOf(row), stored: true };
  const now = nowStamp();
  return {
    check: { checkId: checkIdOf(sub, bookId), bookId, state: 'off', status: 'not-checked', detail: '', turnedOnAt: null, lastCheckedAt: null, lastSuccessAt: null,
      windowAfter: null, windowBefore: null, pageToken: '', pending: null, seen: [], counts: null, createdAt: now, updatedAt: now },
    stored: false,
  };
}

/**
 * @description Keep where the person's mail check stands.
 * @param db - The pool.
 * @param sub - The caller.
 * @param c - The check.
 * @returns Nothing.
 */
export async function saveCheck(db: LedgerDb, sub: string, c: MailCheck): Promise<void> {
  const values = [c.state, c.status, cleanText(c.detail, 300), c.turnedOnAt, c.lastCheckedAt, c.lastSuccessAt, c.windowAfter, c.windowBefore, c.pageToken,
    jsonParam(c.pending), jsonParam(c.seen.slice(-SEEN_KEPT)), jsonParam(c.counts)];
  const stored = (await db.query(MAIL_SQL.checkRead, [c.checkId, sub])).rows[0];
  if (!stored) {
    try {
      await db.query(MAIL_SQL.checkInsert, [c.checkId, sub, c.bookId, ...values, c.createdAt, nowStamp()]);
      return;
    } catch (err) {
      if (!duplicateKey(err)) throw err;
    }
  }
  await db.query(MAIL_SQL.checkUpdate, [c.checkId, sub, ...values, nowStamp()]);
}

/**
 * @description Every bill found in the person's mail, in every state.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The finds, newest due date first.
 */
export async function listFinds(db: LedgerDb, sub: string, bookId: string): Promise<MailFind[]> {
  const rows = (await db.query(MAIL_SQL.findsByBook, [bookId, sub])).rows;
  return rows.map(findOf).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.payee.localeCompare(b.payee) || a.findId.localeCompare(b.findId));
}

/**
 * @description One bill found in the caller's mail.
 * @param db - The pool.
 * @param sub - The caller.
 * @param findId - The find.
 * @returns The find.
 */
export async function needFind(db: LedgerDb, sub: string, findId: string): Promise<MailFind> {
  const row = (await db.query(MAIL_SQL.findRead, [findId, sub])).rows[0];
  if (!row) throw new LedgerRefusal(404, 'unknown_find', 'That bill from your mail is not in your records.');
  return findOf(row);
}

async function saveFind(db: LedgerDb, sub: string, f: MailFind): Promise<void> {
  await db.query(MAIL_SQL.findUpdate, [f.findId, sub, f.payee, f.amountCents, f.dueDate, f.state, f.billId, nowStamp()]);
}

/**
 * @description Keep one bill found in a message as a proposal. The same payee and due date is kept
 * once (a reminder adds nothing); a payee the person said is not a bill is not proposed again; a payee
 * has one proposal waiting, the one with the latest due date.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param bill - What the message gave.
 * @returns True when a new proposal is waiting.
 */
export async function keepFind(db: LedgerDb, sub: string, bookId: string, bill: MailBill): Promise<boolean> {
  const key = merchantKey({ merchant: bill.payee, description: bill.payee }), finds = await listFinds(db, sub, bookId);
  const same = finds.filter((f) => f.payeeKey === key);
  if (same.some((f) => f.dueDate === bill.dueDate || f.state === 'dismissed')) return false;
  const waiting = same.filter((f) => f.state === 'proposed'), newer = waiting.some((f) => f.dueDate > bill.dueDate), now = nowStamp();
  const find: MailFind = {
    findId: hashId('mailfind', sub, bookId, key, bill.dueDate), bookId, messageId: bill.messageId, sender: bill.sender, subject: bill.subject,
    mailDate: bill.mailDate, payee: bill.payee, payeeKey: key, amountCents: bill.amountCents, currency: bill.currency, dueDate: bill.dueDate,
    state: newer ? 'superseded' : 'proposed', billId: '', createdAt: now, updatedAt: now,
  };
  try {
    await db.query(MAIL_SQL.findInsert, [find.findId, sub, bookId, find.messageId, find.sender, find.subject, find.mailDate, find.payee, find.payeeKey,
      find.amountCents, find.currency, find.dueDate, find.state, find.billId, find.createdAt, find.updatedAt]);
  } catch (err) {
    if (!duplicateKey(err)) throw err;
    return false;
  }
  if (!newer) for (const older of waiting) await saveFind(db, sub, { ...older, state: 'superseded' });
  return !newer;
}

/* ─── reading the mailbox ───────────────────────────────────────────────────── */

/** Why a check could not read the mailbox, in the status and words the screen shows. */
export class MailTrouble extends Error {
  constructor(public readonly status: string, message: string) { super(message); }
}

/**
 * @description One request to the caller's Gmail. A missing or expired connection and a refused
 * permission are said in words; the package sends no credential of its own.
 * @param fetcher - fetch through the kernel's egress.
 * @param path - The path after /users/me/.
 * @returns The JSON answer.
 */
export async function gmail(fetcher: MailFetch, path: string): Promise<any> {
  let response;
  try {
    response = await fetcher(`${GMAIL}/${path}`, { method: 'GET', signal: AbortSignal.timeout(CALL_MS) });
  } catch (err) {
    const words = String((err as Error)?.message || '');
    if (/not connected/i.test(words)) throw new MailTrouble('not-connected', 'Connect your mail to find bills: connect Gmail in Connections.');
    if (/renew|reconnect|expired/i.test(words)) throw new MailTrouble('reconnect', 'Your Gmail connection has expired. Connect Gmail again in Connections.');
    if (/turned .* off/i.test(words)) throw new MailTrouble('not-connected', 'Gmail is turned off for you here. Turn it on in Connections to find bills in your mail.');
    throw new MailTrouble('unavailable', 'Your mailbox could not be read just now. Finance tries again at the next check.');
  }
  if (response.status === 401) throw new MailTrouble('reconnect', 'Your Gmail connection was refused. Connect Gmail again in Connections.');
  if (response.status === 403) throw new MailTrouble('no-permission', 'Finance needs permission to read your mail: connect Gmail again in Connections and allow reading your email.');
  if (!response.ok) throw new MailTrouble('unavailable', `Your mailbox could not be read just now (HTTP ${response.status}). Finance tries again at the next check.`);
  return response.json();
}

/** The search for one window of days. */
export function mailQuery(after: number, before: number): string {
  return `after:${after} before:${before} ${MAIL_WORDS}`;
}

/** Start a window when none is being worked through: from the last finished check (less a day), else 45 days back. */
function openWindow(check: MailCheck, now: number): void {
  if (check.windowBefore) return;
  const from = check.lastSuccessAt ? Date.parse(check.lastSuccessAt) - 86_400_000 : now - LOOK_BACK_DAYS * 86_400_000;
  check.windowAfter = Math.floor(from / 1000);
  check.windowBefore = Math.floor(now / 1000) + 1;
  check.pending = null;
  check.pageToken = '';
}

/** Read one message and keep the bill it gives; count what it was. */
async function readOne(db: LedgerDb, sub: string, check: MailCheck, fetcher: MailFetch, id: string, counts: MailCounts): Promise<void> {
  const message = await gmail(fetcher, `messages/${encodeURIComponent(id)}?format=full`) as GmailMessage;
  counts.read += 1;
  const result = readBill(message);
  if ('bill' in result) {
    if (await keepFind(db, sub, check.bookId, { ...result.bill, messageId: result.bill.messageId || id })) counts.found += 1;
  } else if (result.left === 'receipt') counts.receipts += 1;
  else if (result.left === 'no-amount') counts.noAmount += 1;
  else counts.noDate += 1;
}

/** Work through the open window until it is done, the time is up or the run has read its share. */
async function workWindow(db: LedgerDb, sub: string, check: MailCheck, fetcher: MailFetch, counts: MailCounts, stopAt: number): Promise<void> {
  const seen = new Set(check.seen);
  while (Date.now() < stopAt && counts.read < READ_PER_RUN) {
    if (check.pending === null || (!check.pending.length && check.pageToken)) {
      const token = check.pageToken ? `&pageToken=${encodeURIComponent(check.pageToken)}` : '';
      const page = await gmail(fetcher, `messages?maxResults=${PAGE_SIZE}&q=${encodeURIComponent(mailQuery(check.windowAfter as number, check.windowBefore as number))}${token}`);
      check.pending = (Array.isArray(page?.messages) ? page.messages : []).map((m: { id?: unknown }) => String(m?.id || '')).filter((id: string) => id && !seen.has(id));
      check.pageToken = typeof page?.nextPageToken === 'string' ? page.nextPageToken : '';
      continue;
    }
    if (!check.pending.length) break;
    const id = check.pending[0];
    await readOne(db, sub, check, fetcher, id, counts);
    seen.add(id);
    check.seen = [...seen];
    check.pending.shift();
    if (counts.read % 5 === 0) await saveCheck(db, sub, check);
  }
  if (check.pending && !check.pending.length && !check.pageToken) {
    check.lastSuccessAt = new Date((check.windowBefore as number) * 1000).toISOString();
    check.windowAfter = null; check.windowBefore = null; check.pending = null;
  }
}

/**
 * @description One mail check for the caller: nothing at all while the check is off; otherwise one
 * bounded pass over bill-like mail, kept as proposals, continued by the next check.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param fetcher - fetch through the kernel's egress.
 * @param stopAt - The clock time (ms) after which no new request is started.
 * @returns The check as it now stands, whether mail was read, and what was done.
 */
export async function checkMail(db: LedgerDb, sub: string, bookId: string, fetcher: MailFetch, stopAt: number = Date.now() + RUN_MS): Promise<{ check: MailCheck; ran: boolean; counts: MailCounts | null }> {
  const { check } = await readCheck(db, sub, bookId);
  if (check.state !== 'on') return { check, ran: false, counts: null };
  const counts: MailCounts = { read: 0, found: 0, receipts: 0, noAmount: 0, noDate: 0 };
  try {
    openWindow(check, Date.now());
    await workWindow(db, sub, check, fetcher, counts, stopAt);
    check.status = 'connected'; check.detail = '';
  } catch (err) {
    if (err instanceof MailTrouble) { check.status = err.status; check.detail = err.message; }
    else { logger.error({ err }, 'finance mail check failed'); check.status = 'unavailable'; check.detail = 'Your mailbox could not be read just now. Finance tries again at the next check.'; }
  }
  check.lastCheckedAt = nowStamp(); check.counts = counts;
  await saveCheck(db, sub, check);
  return { check, ran: true, counts };
}

/* ─── answering a find ──────────────────────────────────────────────────────── */

/** The bill a find would bring up to date: a bill the person has for the same payee. */
function knownBill(bills: Bill[], key: string): Bill | undefined {
  return bills.find((bill) => bill.state === 'confirmed' && covers(bill, key));
}

/** A find's amount as a figure: what the biller's mail said, as of the mail's date. */
function findFigure(f: MailFind): Figure {
  return figure(f.amountCents, f.currency, `Mail from ${f.payee}`, 'mail', f.mailDate);
}

/**
 * @description Add a bill found in the mail, with the person's yes: a new bill, or the bill already
 * known for that payee with the mail's amount and due date. The person may correct the payee, the
 * amount, the due date and how often it comes due. Bookkeeping only: nothing is paid.
 * @param db - The pool.
 * @param sub - The caller.
 * @param find - The find.
 * @param body - confirm: true, and optionally payee, amountCents, dueDate, cadence.
 * @param today - YYYY-MM-DD.
 * @returns The bill and whether it was new.
 */
export async function addFind(db: LedgerDb, sub: string, find: MailFind, body: Record<string, unknown>, today: string): Promise<{ bill: Bill; updated: boolean }> {
  requireConfirm(body, 'Adding this bill');
  if (find.state !== 'proposed') throw new LedgerRefusal(409, 'already_answered', 'This bill from your mail is already answered.');
  const payee = body.payee === undefined ? find.payee : nameOf(body.payee, 'Say who the bill is paid to.');
  const cents = body.amountCents === undefined ? find.amountCents : centsOf(body.amountCents, 'The amount');
  const due = dateOf(body.dueDate, 'The due date') || find.dueDate, cadence = String(body.cadence || 'monthly');
  if (!CADENCES[cadence]) throw new LedgerRefusal(400, 'bad_cadence', 'A bill comes due weekly, every two weeks, monthly, quarterly or yearly.');
  await ensureBook(db, sub, find.bookId);
  const key = merchantKey({ merchant: payee, description: payee }), mail = { source: 'mail', sourceLabel: `Mail from ${payee}`, posture: '' };
  const known = knownBill(await listBills(db, sub, find.bookId), key);
  let bill: Bill;
  if (known) {
    bill = { ...known, ...mail, amountCents: cents, amountAsOf: cents === null ? null : find.mailDate };
    if (CADENCES[known.cadence].months && Number(due.slice(8, 10)) !== known.dueDay) {
      await dropUnpaid(db, sub, known, today);
      bill = { ...bill, dueDay: Number(due.slice(8, 10)), firstDue: due, nextDue: due };
    }
    await saveBill(db, sub, bill);
  } else {
    const now = nowStamp();
    bill = {
      billId: hashId('bill', sub, find.bookId, 'mail', key), bookId: find.bookId, payee, matchText: key, amountCents: cents, amountAsOf: cents === null ? null : find.mailDate,
      currency: find.currency, cadence, dueDay: CADENCES[cadence].months ? Number(due.slice(8, 10)) : null, firstDue: due, nextDue: due, accountId: '', category: '',
      origin: 'mail', ...mail, state: 'confirmed', evidence: null, createdAt: now, updatedAt: now,
    };
    if (!(await insertBill(db, sub, bill))) await saveBill(db, sub, bill);
  }
  await saveFind(db, sub, { ...find, payee, amountCents: cents === null ? find.amountCents : cents, dueDate: due, state: 'added', billId: bill.billId });
  await syncBills(db, sub, find.bookId, today);
  return { bill, updated: Boolean(known) };
}

/* ─── the routes ────────────────────────────────────────────────────────────── */

/** The words for where a check stands. */
function statusWords(check: MailCheck): string {
  if (check.state !== 'on') return 'The mail check is off. Turn it on and Finance looks through your mail for bills.';
  if (check.status === 'not-checked') return 'Finance has not looked through your mail yet.';
  if (check.status === 'connected') return '';
  return check.detail || 'Your mailbox could not be read just now. Finance tries again at the next check.';
}

/**
 * @description Where the mail check stands and the bills found waiting for an answer.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The view the screen and the concierge read.
 */
export async function readMail(db: LedgerDb, sub: string, bookId: string): Promise<Record<string, unknown>> {
  const { check } = await readCheck(db, sub, bookId), finds = await listFinds(db, sub, bookId), bills = await listBills(db, sub, bookId);
  const proposals = finds.filter((f) => f.state === 'proposed').map((f) => {
    const known = knownBill(bills, f.payeeKey);
    return { findId: f.findId, payee: f.payee, amount: findFigure(f), dueDate: f.dueDate, mailDate: f.mailDate, sender: f.sender, subject: f.subject,
      knownBill: known ? { billId: known.billId, payee: known.payee } : null };
  });
  return {
    book: bookId, on: check.state === 'on', status: check.status, words: statusWords(check), lastCheckedAt: check.lastCheckedAt, lastSuccessAt: check.lastSuccessAt,
    more: check.state === 'on' && check.status === 'connected' && Boolean(check.windowBefore), counts: check.counts, proposals, note: MAIL_NOTE,
  };
}

/**
 * @description The mail routes, mounted at /api/finance/mail.
 * @param ctx - The application context (its pool). A test may hand financeMailFetch; otherwise the
 * kernel's fetch, whose declared egress adds the caller's gmail connection.
 * @returns The router.
 */
export function createFinanceMailRoutes(ctx: AppContext): Router {
  const router = Router();
  const db = ctx.pool as unknown as LedgerDb;
  const fetcher: MailFetch = ((ctx as unknown as { financeMailFetch?: MailFetch }).financeMailFetch) || (fetch as unknown as MailFetch);

  /** GET / — whether the mail check is on, how it stands, and the bills found waiting for an answer. */
  router.get('/', route('mail', (sub, req) => readMail(db, sub, bookOf(req))));

  /** POST /switch — turn the mail check on (confirm: true) or off. Turning it on reads nothing yet. */
  router.post('/switch', route('mail.switch', async (sub, req) => {
    const body = bodyOf(req), on = body.on === true, bookId = bookOf(req);
    if (body.on !== true && body.on !== false) throw new LedgerRefusal(400, 'on_required', 'Say whether the mail check is on or off.');
    if (on) requireConfirm(body, 'Looking through your mail for bills');
    const { check } = await readCheck(db, sub, bookId);
    if (on && check.state !== 'on') { check.state = 'on'; check.turnedOnAt = nowStamp(); if (check.status === 'connected') check.status = 'not-checked'; }
    if (!on) { check.state = 'off'; check.windowAfter = null; check.windowBefore = null; check.pending = null; check.pageToken = ''; }
    await saveCheck(db, sub, check);
    return { ok: true, ...(await readMail(db, sub, bookId)) };
  }));

  /** POST /check — one bounded pass over the caller's bill-like mail (the button and the finance-mail-bills job). Nothing while the check is off. */
  router.post('/check', route('mail.check', async (sub, req) => {
    const bookId = bookOf(req), done = await checkMail(db, sub, bookId, fetcher);
    const view = await readMail(db, sub, bookId);
    return { ok: true, ran: done.ran, read: done.counts?.read ?? 0, found: done.counts?.found ?? 0, nothing: done.ran ? null : 'The mail check is off; no mail was read.', ...view };
  }));

  /** POST /finds/:findId/add — a bill found in the mail becomes a bill, or brings the known one up to date (confirm: true). */
  router.post('/finds/:findId/add', route('mail.add', async (sub, req) => {
    const find = await needFind(db, sub, String(req.params.findId));
    const done = await addFind(db, sub, find, bodyOf(req), dayOf(req));
    return { ok: true, updated: done.updated, bill: billCard(done.bill), note: 'Marks it as a bill in Finance. It does not pay the bill.' };
  }));

  /** POST /finds/:findId/dismiss — not a bill; that payee's mail is not proposed again. */
  router.post('/finds/:findId/dismiss', route('mail.dismiss', async (sub, req) => {
    const find = await needFind(db, sub, String(req.params.findId));
    if (find.state !== 'proposed') throw new LedgerRefusal(409, 'already_answered', 'This bill from your mail is already answered.');
    await saveFind(db, sub, { ...find, state: 'dismissed' });
    return { ok: true, findId: find.findId, payee: find.payee };
  }));

  return router;
}
