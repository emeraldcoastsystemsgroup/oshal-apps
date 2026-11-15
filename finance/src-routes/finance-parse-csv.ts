/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Read a bank's CSV export into transactions, with no bank connection: the delimiter and the header line are found, columns are guessed from their names (or taken from the map a person matched once for the account), an amount is one signed column or separate in and out columns, a balance column gives the closing balance, and every line that cannot be read is listed with its number and the reason instead of being dropped. Deterministic and bounded (2 MB, 2,000 transactions); a file it cannot read is refused in words that name the line. The amount and date readers are shared with the OFX and text readers.
 */

/**
 * Pure functions, node built-ins only: tested with plain node against the compiled module
 * (tests/ledger-parsers.test.cjs).
 *
 * @module finance-parse-csv
 */

/** The largest statement text Finance reads. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
/** The most transactions Finance reads from one file. */
export const MAX_IMPORT_ROWS = 2000;
/** The most unreadable lines listed back (the count is always exact). */
export const MAX_UNREADABLE_LISTED = 20;

/** One transaction read from a file. amountCents is never negative. */
export interface ParsedRow {
  line: number;
  date: string;
  amountCents: number;
  direction: 'in' | 'out';
  description: string;
  category?: string;
  bankRef?: string;
  balanceCents?: number | null;
}

/** A line the reader could not turn into a transaction, and why. */
export interface Unreadable { line: number; reason: string }

/** A file Finance cannot read, in words a person reads. */
export interface ParseRefusal { ok: false; code: string; message: string }

/** What a statement file says about its own account. Only the last four digits of a number are kept. */
export interface StatementAccount { last4: string; type: string; subtype: string; institution: string; currency: string }

/** A statement read into transactions. */
export interface ParsedStatement {
  ok: true;
  kind: 'csv' | 'ofx' | 'text';
  rows: ParsedRow[];
  unreadable: Unreadable[];
  unreadableCount: number;
  period: { start: string; end: string } | null;
  closingBalance: { cents: number; asOf: string } | null;
  account?: StatementAccount;
  header?: string[];
  headerKey?: string;
  columnMap?: ColumnMap;
}

/** A CSV whose columns Finance could not tell apart: the page asks the person to match them once. */
export interface NeedsColumns { ok: true; needsColumns: true; header: string[]; headerKey: string; sample: string[][] }

/** Which column holds what (zero-based). Either amount, or moneyIn and moneyOut. */
export interface ColumnMap {
  date: number;
  description: number;
  amount?: number;
  moneyIn?: number;
  moneyOut?: number;
  balance?: number;
  category?: number;
  reference?: number;
  flip?: boolean;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const COLUMN_NAMES: Record<string, string[]> = {
  date: ['transactiondate', 'date', 'posteddate', 'postingdate', 'postdate', 'transdate', 'dateposted', 'effectivedate', 'bookingdate'],
  description: ['description', 'transactiondescription', 'payee', 'name', 'merchant', 'details', 'memo', 'narrative', 'originaldescription'],
  amount: ['amount', 'transactionamount', 'amountusd'],
  moneyOut: ['debit', 'debits', 'withdrawal', 'withdrawals', 'moneyout', 'paidout', 'debitamount', 'amountdebit'],
  moneyIn: ['credit', 'credits', 'deposit', 'deposits', 'moneyin', 'paidin', 'creditamount', 'amountcredit'],
  balance: ['balance', 'runningbalance', 'runningbal', 'ledgerbalance', 'availablebalance'],
  category: ['category'],
  reference: ['transactionid', 'referencenumber', 'reference', 'referenceno', 'fitid', 'id'],
};

/** Build a refusal. */
export function refuse(code: string, message: string): ParseRefusal {
  return { ok: false, code, message };
}

/**
 * @description An amount of money as whole cents, read without floating point. Understands a
 * currency sign, thousands commas, a leading or trailing minus, parentheses and a CR or DR suffix.
 * @param value - The text of one amount.
 * @returns Signed cents (negative for a minus, parentheses or DR), or null when it is not an amount.
 */
export function parseAmountCents(value: unknown): number | null {
  let text = String(value ?? '').trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  const suffix = /\s*(cr|dr)\.?$/i.exec(text);
  if (suffix) { if (suffix[1].toLowerCase() === 'dr') negative = !negative; text = text.slice(0, suffix.index); }
  text = text.replace(/[$€£\s]|usd/gi, '');
  if (/^-/.test(text) || /-$/.test(text)) { negative = !negative; text = text.replace(/^-|-$/g, ''); }
  text = text.replace(/^\+/, '');
  const m = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = Number((m[1] || '0').replace(/,/g, ''));
  const cents = whole * 100 + Number(((m[2] || '') + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 1e13) return null;
  return negative ? -cents : cents;
}

/** A real calendar date as YYYY-MM-DD, or null. */
function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return at.toISOString().slice(0, 10);
}

/**
 * @description A date as a bank writes it, as YYYY-MM-DD. Understands 2026-10-31, 2026/10/31,
 * 10/31/2026, 10/31/26, 31 Oct 2026, Oct 31, 2026 and 20261031.
 * @param value - The text of one date.
 * @param dayFirst - Read 01/02/2026 as 1 February (true) or January 2 (false).
 * @returns The date, or null when it is not one.
 */
export function parseStatementDate(value: unknown, dayFirst: boolean = false): string | null {
  const text = String(value ?? '').trim().replace(/[T ]\d{1,2}:\d{2}.*$/, '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) return dayFirst ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2}|\d{4})$/.exec(text);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m && MONTHS[m[1].toLowerCase()]) return isoDate(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  return null;
}

/**
 * @description Refuse text Finance cannot take as a statement at all: nothing, too much, or not text.
 * @param text - The file's text.
 * @returns A refusal, or null when the text can be read.
 */
export function refuseUnreadableText(text: unknown): ParseRefusal | null {
  if (typeof text !== 'string' || !text.trim()) return refuse('empty_file', 'This file is empty.');
  if (text.length > MAX_IMPORT_BYTES) return refuse('file_too_large', 'This file is larger than 2 MB. Finance reads statements up to 2 MB; export a shorter date range and add each part.');
  if (/\u0000/.test(text.slice(0, 4096))) return refuse('not_text', 'This file is not text. Save the statement as CSV, OFX or QFX and add that file.');
  return null;
}

/** The delimiter a file uses: the one that splits its first lines into the most columns. */
function delimiterOf(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10);
  let best = ',', most = 0;
  for (const candidate of [',', ';', '\t', '|']) {
    const count = lines.reduce((sum, line) => sum + (line.split(candidate).length - 1), 0);
    if (count > most) { most = count; best = candidate; }
  }
  return best;
}

/**
 * @description Split delimited text into records, honouring quoted cells and doubled quotes.
 * @param text - The file's text.
 * @returns Each record's cells and the line it starts on.
 */
export function splitCsv(text: string): Array<{ line: number; cells: string[] }> {
  const source = text.replace(/^﻿/, '');
  const delimiter = delimiterOf(source);
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [], cell = '', quoted = false, line = 1, start = 1;
  const endRecord = () => {
    cells.push(cell.trim());
    if (cells.some((value) => value !== '')) records.push({ line: start, cells });
    cells = []; cell = '';
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') line += 1;
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && !cell.trim()) { quoted = true; cell = ''; } else if (ch === delimiter) { cells.push(cell.trim()); cell = ''; } else if (ch === '\n') { endRecord(); start = line; } else if (ch !== '\r') cell += ch;
  }
  if (cell.trim() || cells.length) endRecord();
  return records;
}

/** A column name folded for matching: lower case, letters and digits only. */
function fold(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * @description A stable key for a header line, so the column map a person matched once is found
 * again for the next file from the same bank.
 * @param header - The header cells.
 * @returns The key.
 */
export function headerKeyOf(header: string[]): string {
  return header.map(fold).join('|');
}

/**
 * @description Guess which column holds what from the header's names.
 * @param header - The header cells.
 * @returns The map, or null when a date, a description and an amount cannot all be found.
 */
export function guessColumns(header: string[]): ColumnMap | null {
  const folded = header.map(fold);
  const find = (kind: string): number | undefined => {
    for (const name of COLUMN_NAMES[kind]) { const at = folded.indexOf(name); if (at >= 0) return at; }
    return undefined;
  };
  const date = find('date'), description = find('description'), amount = find('amount');
  const moneyIn = find('moneyIn'), moneyOut = find('moneyOut');
  if (date === undefined || description === undefined) return null;
  if (amount === undefined && moneyIn === undefined && moneyOut === undefined) return null;
  const map: ColumnMap = { date, description };
  if (amount !== undefined) map.amount = amount; else { if (moneyIn !== undefined) map.moneyIn = moneyIn; if (moneyOut !== undefined) map.moneyOut = moneyOut; }
  for (const kind of ['balance', 'category', 'reference'] as const) { const at = find(kind); if (at !== undefined) map[kind] = at; }
  return map;
}

/** Where the header line is: the first of the opening records that names a date and one more known column. */
function headerIndex(records: Array<{ cells: string[] }>): number {
  const known = new Set(Object.values(COLUMN_NAMES).flat());
  for (let i = 0; i < Math.min(records.length, 12); i++) {
    const folded = records[i].cells.map(fold);
    if (folded.some((name) => COLUMN_NAMES.date.includes(name)) && folded.filter((name) => known.has(name)).length >= 2) return i;
  }
  return -1;
}

/** A person's column map made safe: whole column numbers inside the file's width. */
function cleanMap(map: unknown, width: number): ColumnMap | null {
  if (!map || typeof map !== 'object') return null;
  const m = map as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const key of ['date', 'description', 'amount', 'moneyIn', 'moneyOut', 'balance', 'category', 'reference']) {
    if (m[key] === undefined || m[key] === null || m[key] === '') continue;
    const at = Number(m[key]);
    if (!Number.isInteger(at) || at < 0 || at >= width) return null;
    out[key] = at;
  }
  if (out.date === undefined || out.description === undefined) return null;
  if (out.amount === undefined && out.moneyIn === undefined && out.moneyOut === undefined) return null;
  if (m.flip === true) out.flip = true;
  return out as unknown as ColumnMap;
}

/** Whether a file writes 31/10/2026: any first number above 12 says day first. */
function dayFirstIn(records: Array<{ cells: string[] }>, column: number): boolean {
  for (const record of records) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/.exec(String(record.cells[column] || '').trim());
    if (m && Number(m[1]) > 12) return true;
    if (m && Number(m[2]) > 12) return false;
  }
  return false;
}

/** The signed cents one record states, or the reason it states none. */
function recordAmount(cells: string[], map: ColumnMap): { cents: number } | { reason: string } {
  if (map.amount !== undefined) {
    const cents = parseAmountCents(cells[map.amount]);
    if (cents === null) return { reason: `no amount in "${String(cells[map.amount] || '').slice(0, 40)}"` };
    return { cents: map.flip ? -cents : cents };
  }
  const out = map.moneyOut === undefined ? null : parseAmountCents(cells[map.moneyOut]);
  const into = map.moneyIn === undefined ? null : parseAmountCents(cells[map.moneyIn]);
  if (out) return { cents: -Math.abs(out) };
  if (into) return { cents: Math.abs(into) };
  return { reason: 'no amount in the in or out column' };
}

/** One record as a transaction, or the reason it is not one. */
function recordRow(record: { line: number; cells: string[] }, map: ColumnMap, dayFirst: boolean): ParsedRow | Unreadable {
  const date = parseStatementDate(record.cells[map.date], dayFirst);
  if (!date) return { line: record.line, reason: `no date in "${String(record.cells[map.date] || '').slice(0, 40)}"` };
  const amount = recordAmount(record.cells, map);
  if ('reason' in amount) return { line: record.line, reason: amount.reason };
  if (amount.cents === 0) return { line: record.line, reason: 'the amount is zero' };
  const row: ParsedRow = {
    line: record.line, date, amountCents: Math.abs(amount.cents), direction: amount.cents < 0 ? 'out' : 'in',
    description: String(record.cells[map.description] || '').replace(/\s+/g, ' ').trim().slice(0, 240),
  };
  if (map.category !== undefined && record.cells[map.category]) row.category = record.cells[map.category].slice(0, 60);
  if (map.reference !== undefined && record.cells[map.reference]) row.bankRef = record.cells[map.reference].slice(0, 80);
  if (map.balance !== undefined) row.balanceCents = parseAmountCents(record.cells[map.balance]);
  return row;
}

/**
 * @description The first and last date of a run of transactions.
 * @param rows - The transactions.
 * @returns The period, or null for none.
 */
export function periodOf(rows: ParsedRow[]): { start: string; end: string } | null {
  if (!rows.length) return null;
  const dates = rows.map((row) => row.date).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

/**
 * @description The balance after the last transaction, when the lines carry a running balance.
 * @param rows - The transactions, in the file's order.
 * @returns The closing balance with its date, or null when no line carries a balance.
 */
export function closingBalanceOf(rows: ParsedRow[]): { cents: number; asOf: string } | null {
  const withBalance = rows.filter((row) => typeof row.balanceCents === 'number');
  if (!withBalance.length) return null;
  const last = withBalance.map((row) => row.date).sort().pop() as string;
  const newestFirst = withBalance[0].date >= withBalance[withBalance.length - 1].date;
  const onLastDay = withBalance.filter((row) => row.date === last);
  const row = newestFirst ? onLastDay[0] : onLastDay[onLastDay.length - 1];
  return { cents: row.balanceCents as number, asOf: last };
}

/**
 * @description Refuse a read that found nothing usable, or too much, naming the line that stopped it.
 * @param rows - The transactions read.
 * @param unreadable - The lines that could not be read.
 * @returns A refusal, or null when the read stands.
 */
export function refuseEmptyOrTooLong(rows: ParsedRow[], unreadable: Unreadable[]): ParseRefusal | null {
  if (rows.length > MAX_IMPORT_ROWS) {
    return refuse('too_many_rows', `This file has ${rows.length.toLocaleString('en-US')} transactions. Finance reads up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} from one file; export a shorter date range and add each part.`);
  }
  if (rows.length) return null;
  const first = unreadable[0];
  return refuse('no_transactions', first
    ? `Finance could not read any transaction in this file. Line ${first.line} stopped it: ${first.reason}.`
    : 'Finance found no transactions in this file.');
}

/**
 * @description Read a bank's CSV export.
 * @param text - The file's text.
 * @param options - The column map a person matched for this account, when there is one.
 * @returns The transactions, a request to match the columns, or a refusal in words.
 */
export function parseCsv(text: string, options: { columnMap?: unknown } = {}): ParsedStatement | NeedsColumns | ParseRefusal {
  const unreadableText = refuseUnreadableText(text);
  if (unreadableText) return unreadableText;
  const records = splitCsv(text);
  if (!records.length) return refuse('empty_file', 'This file is empty.');
  const at = headerIndex(records);
  const header = at >= 0 ? records[at].cells : records[0].cells.map((_, column) => `Column ${column + 1}`);
  const data = at >= 0 ? records.slice(at + 1) : records;
  const width = Math.max(...records.map((record) => record.cells.length));
  const map = cleanMap(options.columnMap, width) || (at >= 0 ? guessColumns(header) : null);
  const headerKey = headerKeyOf(header);
  if (!map) return { ok: true, needsColumns: true, header, headerKey, sample: data.slice(0, 5).map((record) => record.cells) };
  const dayFirst = dayFirstIn(data, map.date);
  const rows: ParsedRow[] = [], unreadable: Unreadable[] = [];
  for (const record of data) {
    const row = recordRow(record, map, dayFirst);
    if ('reason' in row) unreadable.push(row); else rows.push(row);
  }
  const refusal = refuseEmptyOrTooLong(rows, unreadable);
  if (refusal) return refusal;
  return {
    ok: true, kind: 'csv', rows, unreadable: unreadable.slice(0, MAX_UNREADABLE_LISTED), unreadableCount: unreadable.length,
    period: periodOf(rows), closingBalance: closingBalanceOf(rows), header, headerKey, columnMap: map,
  };
}
