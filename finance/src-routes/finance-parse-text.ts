/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Read the text of a statement (a PDF the kernel turned into text, or pasted lines) into proposed transactions: a line that starts with a date and ends in an amount is one transaction; the statement's period gives a line its year; a heading such as Deposits or Withdrawals, a minus, parentheses or CR says which way the money went. It is always a proposal a person confirms, so every line that looked like a transaction and could not be read is counted and listed. Text with no letters or digits in it (a PDF that is a picture of a page) is refused in those words. A second reader finds a bill's payee, amount due and due date.
 */

/**
 * Pure functions: tested with plain node against the compiled module (tests/ledger-parsers.test.cjs).
 *
 * @module finance-parse-text
 */
import {
  MAX_UNREADABLE_LISTED, closingBalanceOf, parseAmountCents, parseStatementDate, periodOf, refuse, refuseEmptyOrTooLong, refuseUnreadableText,
  type ParsedRow, type ParsedStatement, type ParseRefusal, type Unreadable,
} from './finance-parse-csv';

/** A bill read from text: who is owed, how much, and by when. */
export interface ParsedBill { ok: true; payee: string; amountDueCents: number; dueDate: string }

const MONTH_WORD = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_AT_START = new RegExp(`^\\s*(\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{4}-\\d{2}-\\d{2}|${MONTH_WORD}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${MONTH_WORD}(?:\\s+\\d{4})?)\\s+(.*)$`, 'i');
const AMOUNT_AT_END = /(\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?(?:\s?(?:CR|DR))?)\s*$/i;
const MONEY_IN_HEADING = /^(deposits?|credits?|additions?|payments? and (other )?credits?|payments? received|money in|other credits?)\b/i;
const MONEY_OUT_HEADING = /^(withdrawals?|debits?|checks?( paid)?|purchases?|subtractions?|fees?|charges?|money out|other debits?|electronic (withdrawals?|payments?)|card purchases?|transactions?)\b/i;
const ANY_DATE = `(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|${MONTH_WORD}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH_WORD}\\s+\\d{4})`;

/** A date with a year, as a statement or a bill writes it. */
function fullDate(value: string): string | null {
  return parseStatementDate(value.replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/\s+/g, ' ').trim());
}

/**
 * @description The period a statement says it covers ("October 1, 2026 through October 31, 2026",
 * "Statement period 10/01/2026 - 10/31/2026").
 * @param text - The statement's text.
 * @returns The period, or null when the text names none.
 */
export function statementPeriod(text: string): { start: string; end: string } | null {
  const m = new RegExp(`${ANY_DATE}\\s*(?:through|thru|to|-|–|—)\\s*${ANY_DATE}`, 'i').exec(text);
  if (!m) return null;
  const start = fullDate(m[1]), end = fullDate(m[2]);
  return start && end && start <= end ? { start, end } : null;
}

/** A date at the start of a line as YYYY-MM-DD; a date with no year takes it from the statement period. */
function lineDate(value: string, period: { start: string; end: string } | null): string | null {
  const withYear = fullDate(value);
  if (withYear) return withYear;
  if (!period) return null;
  const endYear = Number(period.end.slice(0, 4));
  for (const year of [endYear, endYear - 1]) {
    const date = fullDate(/^\d/.test(value) && /[/-]/.test(value) ? `${value}/${year}`.replace(/-/g, '/') : `${value} ${year}`);
    if (date && date <= period.end) return date;
  }
  return null;
}

const MONEY_IN_WORDS = /\b(deposit|payroll|direct dep|refund|interest (paid|earned)|credit)\b/i;

/** Which way one line's money went, and whether the line itself said so (a sign or CR) or it was inferred. */
function directionOf(amountText: string, cents: number, description: string, heading: 'in' | 'out' | null): { direction: 'in' | 'out'; stated: boolean } {
  if (/cr\s*$/i.test(amountText)) return { direction: 'in', stated: true };
  if (cents < 0) return { direction: 'out', stated: true };
  if (heading) return { direction: heading, stated: false };
  return { direction: MONEY_IN_WORDS.test(description) ? 'in' : 'out', stated: false };
}

/** A section heading: a few words with no digits, apart from a total at the end of the line. */
function headingOf(line: string): 'in' | 'out' | null {
  const words = line.replace(AMOUNT_AT_END, '').trim();
  if (/\d/.test(words) || words.split(/\s+/).length > 6) return null;
  if (MONEY_IN_HEADING.test(words)) return 'in';
  return MONEY_OUT_HEADING.test(words) ? 'out' : null;
}

/** Where a running balance is printed, it settles the direction: the balance moved by the amount, up or down. */
function settleByBalance(rows: ParsedRow[], stated: Set<number>): void {
  for (let i = 1; i < rows.length; i++) {
    const before = rows[i - 1].balanceCents, after = rows[i].balanceCents;
    if (stated.has(rows[i].line) || typeof before !== 'number' || typeof after !== 'number') continue;
    if (after - before === rows[i].amountCents) rows[i].direction = 'in';
    else if (before - after === rows[i].amountCents) rows[i].direction = 'out';
  }
}

/** One dated line as a transaction, or the reason it is not one. */
function lineRow(line: number, datePart: string, rest: string, period: { start: string; end: string } | null, heading: 'in' | 'out' | null, stated: Set<number>): ParsedRow | Unreadable {
  const date = lineDate(datePart, period);
  if (!date) return { line, reason: `no year for the date "${datePart.trim()}"` };
  const end = AMOUNT_AT_END.exec(rest);
  if (!end) return { line, reason: 'no amount at the end of the line' };
  let body = rest.slice(0, end.index).trim();
  let amountText = end[1];
  let balanceCents: number | null = null;
  const before = AMOUNT_AT_END.exec(body);
  if (before) {
    // Two amounts at the end of a line are the transaction and the running balance after it.
    balanceCents = parseAmountCents(amountText);
    amountText = before[1];
    body = body.slice(0, before.index).trim();
  }
  const cents = parseAmountCents(amountText);
  if (cents === null || cents === 0) return { line, reason: `no amount in "${amountText.trim()}"` };
  const description = body.replace(/\s+/g, ' ').slice(0, 240);
  if (!description) return { line, reason: 'no description between the date and the amount' };
  const way = directionOf(amountText, cents, description, heading);
  if (way.stated) stated.add(line);
  const row: ParsedRow = { line, date, amountCents: Math.abs(cents), direction: way.direction, description };
  if (balanceCents !== null) row.balanceCents = balanceCents;
  return row;
}

/**
 * @description Read a statement's text into proposed transactions.
 * @param text - The statement's text.
 * @returns The proposed transactions with a count of lines that could not be read, or a refusal in words.
 */
export function parseStatementText(text: string): ParsedStatement | ParseRefusal {
  // Text with nothing in it is what the kernel hands back for a PDF that is only a picture of a page.
  const unreadableText = refuseUnreadableText(text);
  if (unreadableText) return unreadableText.code === 'empty_file' ? refuse('picture_only', 'This PDF is a picture of a page; Finance cannot read it.') : unreadableText;
  const period = statementPeriod(text);
  const rows: ParsedRow[] = [], unreadable: Unreadable[] = [];
  const stated = new Set<number>();
  let heading: 'in' | 'out' | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\t/g, ' ').trim();
    if (!line) return;
    const m = DATE_AT_START.exec(line);
    if (!m) { heading = headingOf(line) || heading; return; }
    const row = lineRow(index + 1, m[1], m[2], period, heading, stated);
    if ('reason' in row) unreadable.push(row); else rows.push(row);
  });
  settleByBalance(rows, stated);
  const refusal = refuseEmptyOrTooLong(rows, unreadable);
  if (refusal) return refusal.code === 'no_transactions' && !unreadable.length ? refuse('no_transactions', 'Finance found no line in this text that starts with a date and ends in an amount.') : refusal;
  return { ok: true, kind: 'text', rows, unreadable: unreadable.slice(0, MAX_UNREADABLE_LISTED), unreadableCount: unreadable.length, period: periodOf(rows), closingBalance: closingBalanceOf(rows) };
}

/** The first amount that follows one of these words on a line. */
function amountAfter(text: string, words: RegExp): number | null {
  for (const line of text.split(/\r?\n/)) {
    const m = words.exec(line);
    if (!m) continue;
    const found = /\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}/.exec(line.slice(m.index + m[0].length));
    const cents = found ? parseAmountCents(found[0]) : null;
    if (cents !== null && cents > 0) return cents;
  }
  return null;
}

/** The first date that follows one of these words on a line. */
function dateAfter(text: string, words: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = words.exec(line);
    if (!m) continue;
    const found = new RegExp(ANY_DATE, 'i').exec(line.slice(m.index + m[0].length));
    const date = found ? fullDate(found[1]) : null;
    if (date) return date;
  }
  return null;
}

/**
 * @description Read a bill's text: who is owed (the first line that reads as a name), the amount
 * due and the due date. Nothing is guessed: a bill missing either figure is refused.
 * @param text - The bill's text.
 * @returns The bill, or a refusal in words.
 */
export function parseBillText(text: string): ParsedBill | ParseRefusal {
  const unreadableText = refuseUnreadableText(text);
  if (unreadableText) return unreadableText;
  const amountDueCents = amountAfter(text, /\b(total )?(amount|balance|payment) due\b|\btotal due\b|\bplease pay\b|\bminimum payment due\b/i);
  const dueDate = dateAfter(text, /\b(payment )?due (date|by|on)\b|\bpay by\b|\bdue\b/i);
  if (amountDueCents === null) return refuse('no_amount_due', 'Finance could not find an amount due in this document.');
  if (!dueDate) return refuse('no_due_date', 'Finance could not find a due date in this document.');
  const payee = (text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).find((line) => /[A-Za-z]{3}/.test(line) && !/\d{3}/.test(line)) || '').slice(0, 80);
  if (!payee) return refuse('no_payee', 'Finance could not tell who this bill is from.');
  return { ok: true, payee, amountDueCents, dueDate };
}

/**
 * @description Whether text reads as a bill rather than a statement: it names an amount due and a
 * due date and lists few dated lines.
 * @param text - The document's text.
 * @returns True for a bill.
 */
export function looksLikeBill(text: string): boolean {
  if (typeof text !== 'string') return false;
  const dated = text.split(/\r?\n/).filter((line) => DATE_AT_START.test(line) && AMOUNT_AT_END.test(line)).length;
  return dated < 6 && /\b(amount|balance|total|payment) due\b/i.test(text) && /\bdue (date|by|on)\b|\bpay by\b/i.test(text);
}
