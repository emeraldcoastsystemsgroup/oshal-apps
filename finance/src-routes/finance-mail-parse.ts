/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2, Roger 2026-11-14: "pulls your bills from emails"): read one mail message, as the Gmail API answers it, for a bill: who it is from, the amount due and the due date, by fixed patterns. A message with no amount due or no due date is not a bill here, and neither is a payment receipt. Nothing is kept from the message but what a bill needs (the sender, the subject, the date and the message's id); the text is read in memory only. No model is asked. Pure: no framework import, no I/O.
 */

/**
 * @module finance-mail-parse
 */

/** The most text read from one message, in characters. */
export const TEXT_LIMIT = 24_000;
/** A due date further than this from the mail's own date is not believed. */
const DUE_BEFORE_DAYS = 30;
const DUE_AFTER_DAYS = 120;

/** What a bill found in one message holds. */
export interface MailBill {
  messageId: string;
  sender: string;
  subject: string;
  mailDate: string;
  payee: string;
  amountCents: number;
  currency: string;
  dueDate: string;
}

/** Why a message gave no bill: it was a receipt, or it named no amount due, or no due date. */
export type LeftAlone = 'receipt' | 'no-amount' | 'no-date';

/** One header of a Gmail message. */
interface Header { name?: string; value?: string }
/** One part of a Gmail message (format=full). */
interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: Header[] }
/** A Gmail message as users.messages.get answers it with format=full. */
export interface GmailMessage { id?: string; internalDate?: string; snippet?: string; payload?: Part }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
/** The amount labels, strongest first: the whole amount due before a minimum payment. */
const AMOUNT_LABELS: RegExp[] = [
  /(?:total|amount|balance|payment)\s+(?:now\s+)?due|amount\s+owed|new\s+balance|statement\s+balance|total\s+(?:amount|balance)|amount\s+to\s+pay|please\s+pay/g,
  /minimum\s+(?:payment|amount)(?:\s+due)?/g,
];
const MONEY = /(?:usd\s*)?\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)|usd\s+(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/;
const DUE_LABEL = /(?:payment\s+)?due\s+date|due\s+(?:on|by)|pay\s+by|(?:payment|amount|balance|bill)\s+(?:is\s+)?due|\bdue\b/g;
const RECEIPT = /thank you for your payment|payment (?:received|confirmation|confirmed|was successful|has posted|posted)|receipt for your payment|we (?:have )?received your payment|your payment of .{0,20} (?:was|has been) (?:received|processed)/;

/**
 * @description A header's value, by name, from a message.
 * @param message - The message.
 * @param name - The header name, any case.
 * @returns The value, or an empty string.
 */
export function header(message: GmailMessage, name: string): string {
  const found = (message.payload?.headers || []).find((h) => String(h.name || '').toLowerCase() === name);
  return String(found?.value || '');
}

/** HTML as plain words: scripts, styles and tags out, the few entities a bill uses read. */
function plain(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&#36;|&dollar;/gi, '$').replace(/&amp;/gi, '&').replace(/&#44;/g, ',');
}

/** One part's text: plain text kept, HTML read as words, every child part after it. */
function partText(part: Part | undefined, depth = 0): string {
  if (!part || depth > 6) return '';
  let text = '';
  if (part.body?.data && /^text\//i.test(part.mimeType || 'text/plain')) {
    const raw = Buffer.from(part.body.data, 'base64url').toString('utf8').slice(0, TEXT_LIMIT);
    text = /html/i.test(part.mimeType || '') ? plain(raw) : raw;
  }
  return `${text} ${(part.parts || []).slice(0, 12).map((child) => partText(child, depth + 1)).join(' ')}`;
}

/**
 * @description The words of a message: subject, snippet and body, lower case, one space between words.
 * @param message - The message.
 * @returns At most TEXT_LIMIT characters.
 */
export function messageText(message: GmailMessage): string {
  return `${header(message, 'subject')} ${message.snippet || ''} ${partText(message.payload)}`.toLowerCase().replace(/\s+/g, ' ').slice(0, TEXT_LIMIT);
}

/**
 * @description The amount due a message names after one of its labels, strongest label first.
 * @param text - The message's words, lower case.
 * @returns Whole cents, or null when no label is followed by an amount.
 */
export function amountDue(text: string): number | null {
  for (const [rank, label] of AMOUNT_LABELS.entries()) {
    label.lastIndex = 0;
    for (let hit = label.exec(text); hit; hit = label.exec(text)) {
      if (rank === 0 && /minimum\s+$/.test(text.slice(Math.max(0, hit.index - 10), hit.index))) continue;
      const money = MONEY.exec(text.slice(hit.index, hit.index + hit[0].length + 60));
      if (!money) continue;
      const cents = Math.round(Number((money[1] || money[2]).replace(/,/g, '')) * 100);
      if (Number.isSafeInteger(cents) && cents > 0) return cents;
    }
  }
  return null;
}

/** YYYY-MM-DD for a year, month (1-12) and day, or null when there is no such day. */
function ymd(year: number, month: number, day: number): string | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return at.toISOString().slice(0, 10);
}

/** A date without its year takes the mail's year, or the next one when that would fall well before the mail. */
function withYear(month: number, day: number, mailDate: string): string | null {
  const year = Number(mailDate.slice(0, 4));
  const here = ymd(year, month, day);
  if (here && daysFrom(mailDate, here) >= -DUE_BEFORE_DAYS) return here;
  return ymd(year + 1, month, day);
}

/** Whole days from one date to another. */
function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The first date written at the start of a stretch of words. */
function dateIn(words: string, mailDate: string): string | null {
  let m = /^\W{0,4}(\d{4})-(\d{2})-(\d{2})/.exec(words);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^\W{0,4}(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(words);
  if (m) return m[3] ? ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2])) : withYear(Number(m[1]), Number(m[2]), mailDate);
  m = new RegExp(`^\\W{0,4}(?:[a-z]+day,?\\s+)?${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`).exec(words);
  if (m) { const month = MONTHS.indexOf(m[1].slice(0, 3)) + 1; return m[3] ? ymd(Number(m[3]), month, Number(m[2])) : withYear(month, Number(m[2]), mailDate); }
  m = new RegExp(`^\\W{0,4}(?:[a-z]+day,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:,?\\s+(\\d{4}))?`).exec(words);
  if (m) { const month = MONTHS.indexOf(m[2].slice(0, 3)) + 1; return m[3] ? ymd(Number(m[3]), month, Number(m[1])) : withYear(month, Number(m[1]), mailDate); }
  return null;
}

/**
 * @description The due date a message names: a date right after a due label, believed only when it falls
 * between a month before the mail and four months after it.
 * @param text - The message's words, lower case.
 * @param mailDate - YYYY-MM-DD, the mail's own date.
 * @returns YYYY-MM-DD, or null.
 */
export function dueDate(text: string, mailDate: string): string | null {
  DUE_LABEL.lastIndex = 0;
  for (let hit = DUE_LABEL.exec(text); hit; hit = DUE_LABEL.exec(text)) {
    const after = text.slice(hit.index + hit[0].length, hit.index + hit[0].length + 48).replace(/^\s*(?:date|on|by|is)?\s*[:\-–]?\s*/, '');
    const date = dateIn(after, mailDate);
    if (date && daysFrom(mailDate, date) >= -DUE_BEFORE_DAYS && daysFrom(mailDate, date) <= DUE_AFTER_DAYS) return date;
  }
  return null;
}

/**
 * @description Who a bill is from, by the sender's name: "City Utilities <billing@…>" is City Utilities; a
 * trailing "Billing", "Statements" or "Notifications" is dropped; a sender with no name is named by its domain.
 * @param from - The From header.
 * @returns The payee, at most 80 characters.
 */
export function payeeOf(from: string): string {
  let name = from.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (!name || /@/.test(name)) {
    const domain = (/@([a-z0-9.-]+)/i.exec(from)?.[1] || '').toLowerCase().split('.').filter((label) => !['mail', 'email', 'e', 'billing', 'notify', 'alerts', 'www'].includes(label));
    const label = domain.length >= 2 ? domain[domain.length - 2] : domain[0] || '';
    name = label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
  }
  for (let i = 0; i < 3; i++) name = name.replace(/[\s,-]+(billing|bills?|statements?|notifications?|alerts?|customer service|accounts?|team|support|no-?reply|e-?bill)$/i, '').trim();
  return name.slice(0, 80);
}

/**
 * @description The mail's own date: when Gmail received it, else its Date header.
 * @param message - The message.
 * @returns YYYY-MM-DD, or null.
 */
export function mailDateOf(message: GmailMessage): string | null {
  const at = Number(message.internalDate);
  const when = Number.isFinite(at) && at > 0 ? at : Date.parse(header(message, 'date'));
  return Number.isFinite(when) ? new Date(when).toISOString().slice(0, 10) : null;
}

/**
 * @description Read one message for a bill.
 * @param message - The message as users.messages.get answers it (format=full).
 * @returns The bill, or why the message was left alone.
 */
export function readBill(message: GmailMessage): { bill: MailBill } | { left: LeftAlone } {
  const text = messageText(message), mailDate = mailDateOf(message);
  if (RECEIPT.test(text)) return { left: 'receipt' };
  const cents = amountDue(text);
  if (cents === null) return { left: 'no-amount' };
  const due = mailDate ? dueDate(text, mailDate) : null;
  if (!due || !mailDate) return { left: 'no-date' };
  const from = header(message, 'from');
  return {
    bill: {
      messageId: String(message.id || ''), sender: from.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 160),
      subject: header(message, 'subject').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 200), mailDate,
      payee: payeeOf(from) || 'A biller', amountCents: cents, currency: 'USD', dueDate: due,
    },
  };
}
