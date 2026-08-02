/**
 * NACHA ACH file generation — the disbursement half of payroll, without oshal
 * ever touching money.
 *
 * THE MODEL: we compute payroll, then emit the fixed-width ACH file the employer
 * uploads to THEIR OWN bank. The bank originates the transfers. oshal is not a
 * money transmitter, holds no funds, and needs no partner agreement — and the
 * employer keeps the banking relationship they already have.
 *
 * THE FORMAT is unforgiving and that is a feature: every record is exactly 94
 * characters, the file is blocked to a multiple of 10 records padded with 9s, and
 * three control totals must reconcile or the bank rejects the whole file. Those
 * are precisely the invariants a test can assert, so the guards here check the
 * structure the way an ODFI would rather than eyeballing a sample.
 *
 * Record layout (PPD credit — the standard payroll entry class):
 *   1  File Header      — who is sending, to which bank, when
 *   5  Batch Header     — the company, the entry description, the effective date
 *   6  Entry Detail     — one per deposit: routing, account, amount, name
 *   8  Batch Control    — counts, entry hash, credit total for the batch
 *   9  File Control     — batch count, block count, and the same totals for the file
 *   9999... padding     — to the 10-record block boundary
 *
 * ENTRY HASH is the one field people get wrong: it is the sum of the 8-digit
 * receiving-DFI identifiers (routing minus its check digit), truncated to the
 * RIGHTMOST 10 digits — not a checksum, and not the full routing number.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 21:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — PPD credit file builder with all five record types, 94-character fixed-width fields, right-truncated entry hash, reconciled batch and file control totals, 10-record blocking with 9-fill padding, ascending unique trace numbers, and a prenote mode for zero-dollar account validation.
 *
 * @module payroll-nacha
 */

/** One deposit to write into the file. */
export interface AchEntry {
  /** 9-digit receiving routing number (ABA). */
  routingNumber: string;
  /** Receiving account number, up to 17 characters. */
  accountNumber: string;
  /** 'checking' or 'savings' — decides the transaction code. */
  accountType: 'checking' | 'savings';
  /** Amount in cents. Zero is legal only in prenote mode. */
  amountCents: number;
  /** Employee name; truncated to 22 characters by the format. */
  name: string;
  /** Employer's own identifier for the employee, up to 15 characters. */
  employeeId: string;
}

/** Everything the file header and batch header need about the originator. */
export interface AchOriginator {
  /** The employer's bank routing number — where the file is sent (ODFI). */
  odfiRoutingNumber: string;
  /** Bank name for the file header. */
  odfiName: string;
  /** Company name as it should appear on the employee's statement. */
  companyName: string;
  /**
   * 10-character company identifier. Conventionally '1' + the 9-digit EIN.
   * The bank assigns this; it must match what they have on file.
   */
  companyId: string;
  /** What the employee sees on their statement, e.g. PAYROLL. Max 10 chars. */
  entryDescription: string;
  /** The date funds should settle, YYYY-MM-DD. */
  effectiveDate: string;
  /** File creation timestamp, YYYY-MM-DD, and HHMM. */
  fileDate: string;
  fileTime: string;
  /** A–Z / 0–9, distinguishing two files created the same day. */
  fileIdModifier?: string;
  /**
   * The first trace sequence number for this file.
   *
   * Trace numbers MUST NOT restart at 1 for every file. The trace is the only
   * handle a return gives back, so two files that both number their entries
   * from 1 produce colliding traces and a return for one pay run can be matched
   * to a payment in another. Callers allocate this from a per-company counter
   * the same way check numbers are allocated. Defaults to 1 only so a direct
   * caller in a test still produces a valid file.
   */
  traceStart?: number;
}

/** The trace number assigned to one entry, and who it belongs to. */
export interface AchTrace {
  employeeId: string;
  /** The 15-character trace number written into the entry detail record. */
  trace: string;
  amountCents: number;
}

/** The generated file plus the totals a human should reconcile before uploading. */
export interface AchFile {
  content: string;
  lineCount: number;
  entryCount: number;
  totalCreditCents: number;
  entryHash: number;
  /**
   * The trace number assigned to each entry, in file order.
   *
   * These MUST be persisted against the payment rows. A return or notification
   * of change identifies the entry it concerns ONLY by its original trace
   * number, so a trace that is generated and thrown away leaves a returned
   * deposit with nothing to match against — the failure then looks exactly like
   * a success.
   */
  traces: AchTrace[];
  /** True when every structural invariant held. */
  valid: boolean;
  problems: string[];
}

const RECORD_LEN = 94;
const BLOCKING_FACTOR = 10;

/** Left-justify and pad/truncate to a fixed width — the alphanumeric field rule. */
function alpha(v: unknown, width: number): string {
  return String(v ?? '').toUpperCase().replace(/[^\x20-\x7E]/g, ' ').slice(0, width).padEnd(width, ' ');
}

/** Right-justify with leading zeros — the numeric field rule. */
function numeric(v: number | string, width: number): string {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits.slice(-width).padStart(width, '0');
}

/** Blanks, for fields the ACH operator fills in. */
function blank(width: number): string {
  return ' '.repeat(width);
}

/** YYMMDD from a YYYY-MM-DD string. */
function yymmdd(iso: string): string {
  const s = String(iso || '').replace(/\D/g, '');
  return s.length >= 8 ? s.slice(2, 8) : '000000';
}

/** The 8-digit receiving-DFI identifier: the routing number less its check digit. */
function dfiId(routing: string): string {
  return String(routing || '').replace(/\D/g, '').padStart(9, '0').slice(0, 8);
}

/** The routing number's 9th digit. */
function dfiCheckDigit(routing: string): string {
  const d = String(routing || '').replace(/\D/g, '').padStart(9, '0');
  return d.slice(8, 9);
}

/**
 * @description Build a NACHA PPD credit file for a payroll run.
 *
 * @param entries - One entry per deposit.
 * @param o - Originator/bank details from company settings.
 * @param prenote - Emit zero-dollar prenotification entries to validate accounts
 *   before a real run. Transaction codes shift to 23/33 and every amount is zero.
 * @returns The file content plus reconciliation totals and any structural problems.
 */
export function buildAchFile(entries: AchEntry[], o: AchOriginator, prenote = false): AchFile {
  const problems: string[] = [];
  const lines: string[] = [];

  const odfi = String(o.odfiRoutingNumber || '').replace(/\D/g, '');
  if (odfi.length !== 9) problems.push(`Originating routing number must be 9 digits, got "${o.odfiRoutingNumber}".`);
  if (!String(o.companyId || '').trim()) problems.push('Company identification is required (usually 1 + your EIN).');
  if (!entries.length) problems.push('No entries — nothing to deposit.');

  /* ── 1  File Header ─────────────────────────────────────────────────────── */
  lines.push([
    '1', '01',
    ' ' + numeric(odfi, 9),              // immediate destination (blank + routing)
    numeric(o.companyId, 10),            // immediate origin
    yymmdd(o.fileDate),
    numeric(String(o.fileTime || '0000').replace(/\D/g, ''), 4),
    alpha(o.fileIdModifier || 'A', 1),
    '094', '10', '1',
    alpha(o.odfiName, 23),
    alpha(o.companyName, 23),
    blank(8),
  ].join(''));

  /* ── 5  Batch Header ────────────────────────────────────────────────────── */
  // 220 = credits only. Payroll never mixes debits into the employee batch.
  lines.push([
    '5', '220',
    alpha(o.companyName, 16),
    blank(20),                            // company discretionary data
    numeric(o.companyId, 10),
    'PPD',
    alpha(o.entryDescription || 'PAYROLL', 10),
    yymmdd(o.effectiveDate),              // company descriptive date
    yymmdd(o.effectiveDate),              // effective entry date
    blank(3),                             // settlement date — filled by the operator
    '1',                                  // originator status code
    dfiId(odfi),
    numeric(1, 7),                        // batch number
  ].join(''));

  /* ── 6  Entry Detail ────────────────────────────────────────────────────── */
  let totalCreditCents = 0;
  let entryHash = 0;
  const traces: AchTrace[] = [];
  entries.forEach((e, i) => {
    const routing = String(e.routingNumber || '').replace(/\D/g, '');
    if (routing.length !== 9) problems.push(`Entry ${i + 1} (${e.name}): routing number must be 9 digits.`);
    if (!String(e.accountNumber || '').trim()) problems.push(`Entry ${i + 1} (${e.name}): missing account number.`);
    const amount = prenote ? 0 : Math.max(0, Math.trunc(Number(e.amountCents) || 0));
    if (!prenote && amount <= 0) problems.push(`Entry ${i + 1} (${e.name}): amount must be positive.`);

    // 22/32 = live credit to checking/savings; 23/33 = the zero-dollar prenote.
    const code = e.accountType === 'savings' ? (prenote ? '33' : '32') : (prenote ? '23' : '22');
    totalCreditCents += amount;
    entryHash += Number(dfiId(routing));

    // Trace number: ODFI identifier + an ascending sequence. This is the ONLY
    // handle a return or NOC will give us back, so it is returned to the caller
    // to be stored against the payment — and the sequence therefore continues
    // across files rather than restarting, or two runs would mint identical
    // traces and a return could be matched to the wrong pay run's payment.
    const trace = dfiId(odfi) + numeric(Math.max(1, Math.trunc(Number(o.traceStart) || 1)) + i, 7);
    traces.push({ employeeId: String(e.employeeId), trace, amountCents: amount });

    lines.push([
      '6', code,
      dfiId(routing), dfiCheckDigit(routing),
      alpha(e.accountNumber, 17),
      numeric(amount, 10),
      alpha(e.employeeId, 15),
      alpha(e.name, 22),
      blank(2),                           // discretionary data
      '0',                                // no addenda
      trace,
    ].join(''));
  });

  // The hash is the RIGHTMOST 10 digits of the running sum — a wider sum wraps.
  const hash10 = Number(String(entryHash).slice(-10));

  /* ── 8  Batch Control ───────────────────────────────────────────────────── */
  lines.push([
    '8', '220',
    numeric(entries.length, 6),
    numeric(hash10, 10),
    numeric(0, 12),                       // total debits — none in a payroll batch
    numeric(totalCreditCents, 12),
    numeric(o.companyId, 10),
    blank(19),                            // message authentication code
    blank(6),                             // reserved
    dfiId(odfi),
    numeric(1, 7),
  ].join(''));

  /* ── 9  File Control ────────────────────────────────────────────────────── */
  // Block count counts the FILE CONTROL record itself, so it is computed from the
  // record count including this line.
  const recordsBeforePadding = lines.length + 1;
  const blockCount = Math.ceil(recordsBeforePadding / BLOCKING_FACTOR);
  lines.push([
    '9',
    numeric(1, 6),                        // batch count
    numeric(blockCount, 6),
    numeric(entries.length, 8),
    numeric(hash10, 10),
    numeric(0, 12),
    numeric(totalCreditCents, 12),
    blank(39),
  ].join(''));

  /* ── padding to the 10-record block boundary ───────────────────────────── */
  while (lines.length % BLOCKING_FACTOR !== 0) lines.push('9'.repeat(RECORD_LEN));

  for (const [i, l] of lines.entries()) {
    if (l.length !== RECORD_LEN) problems.push(`Record ${i + 1} is ${l.length} characters, must be exactly ${RECORD_LEN}.`);
  }

  return {
    content: lines.join('\n') + '\n',
    lineCount: lines.length,
    entryCount: entries.length,
    totalCreditCents,
    entryHash: hash10,
    traces,
    valid: problems.length === 0,
    problems,
  };
}

/**
 * @description Allocate a contiguous block of ACH trace sequence numbers.
 *
 * The same shape as check-number allocation, and for the same reason: a single
 * UPDATE advances the counter and returns where the block started, so two
 * concurrent callers serialise on the row instead of minting the same trace.
 * @param pool - Anything with a `query` method (the app's Postgres pool).
 * @param sub - Owning OIDC sub.
 * @param count - How many entries the file will carry.
 * @returns The first sequence number of the block.
 */
export async function allocateTraceStart(
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  sub: string,
  count: number,
): Promise<number> {
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  const r = await pool.query(
    `UPDATE payroll_company
        SET ach_next_trace = GREATEST(ach_next_trace, 1) + $2, updated_at = now()
      WHERE user_sub = $1
      RETURNING ach_next_trace - $2 AS start`,
    [sub, n]);
  const start = Number(r.rows[0]?.start || 0);
  if (!start) throw new Error('No company settings row — cannot allocate ACH trace numbers.');
  return start;
}

/**
 * @description Parse a generated file back into its control totals.
 *
 * Used by the guards to verify the file the way an ODFI would — reading the
 * control records rather than trusting the builder's own arithmetic.
 * @param content - The file content.
 * @returns The totals as the control records state them.
 */
export function readAchControls(content: string): {
  records: number; entryCount: number; entryHash: number; creditCents: number; blockCount: number;
} {
  const lines = content.split('\n').filter((l) => l.length > 0);
  const file = lines.find((l) => l.startsWith('9') && !/^9{94}$/.test(l)) || '';
  return {
    records: lines.length,
    entryCount: Number(file.slice(13, 21)),
    entryHash: Number(file.slice(21, 31)),
    creditCents: Number(file.slice(43, 55)),
    blockCount: Number(file.slice(7, 13)),
  };
}
