/**
 * Paper checks — numbering, the printable document, and one deliberate refusal.
 *
 * WHAT THIS DOES. Allocates check numbers from a per-company sequence that
 * cannot hand the same number out twice, and renders everything a payroll check
 * needs: payee, date, the amount in both figures and words, the memo, and the
 * attached earnings statement that most states require a worker to receive.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: generate a MICR line.
 *
 * That is not laziness, it is the same rule the state withholding tables
 * follow — a wrong table is worse than an absent one, because the operator
 * cannot tell it is wrong. The MICR line is governed by ANSI X9.100-160-1,
 * which is paywalled. Every field position obtainable from vendor
 * documentation CONTRADICTS the other vendors:
 *
 *   - total character positions: 62 (Elfring gauge) vs 65 (Morovia, and the
 *     same vendor's own web page)
 *   - the EPC field: "either, but not both, positions 44 or 45" (TROY) vs
 *     "position 44-45" (Morovia)
 *   - the auxiliary on-us field starts at 44 (Morovia) or 45 (TROY)
 *   - the on-us field "occupies positions 13-32" and "occupies nineteen
 *     spaces" — in consecutive sentences of the same document
 *
 * A MICR line printed one position out is rejected by a reader-sorter, or worse
 * mis-posted to another account. It also needs magnetic toner to be machine
 * readable at all, which no software can supply. Small employers overwhelmingly
 * buy pre-printed check stock with the MICR line already encoded by their bank,
 * so the honest product is a check that prints ONTO that stock and leaves the
 * band alone.
 *
 * WHAT IS VERIFIED and is used: the ABA routing check-digit algorithm, and
 * UCC § 4-404 — "A bank is under no obligation to a customer having a checking
 * account to pay a check, other than a certified check, which is presented more
 * than six months after its date" — which is the actual legal basis for a
 * staleness legend, retrieved from the statute rather than from convention.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 04:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — atomic check-number allocation that cannot reissue a number, the printable check document with the amount in words, the attached earnings statement, the UCC 4-404 staleness legend, and an explicit refusal to synthesise a MICR line from contradictory vendor sources.
 *
 * @module payroll-checks
 */

import type { AppContext } from '@/app/composition/app-context';

type Pool = AppContext['pool'];

/**
 * A bank need not pay a check presented more than six months after its date
 * (UCC § 4-404). The legend states that, rather than the conventional but
 * unsourced "void after 90 days".
 */
export const STALE_AFTER_MONTHS = 6;

/* ── the amount, in words ────────────────────────────────────────────────── */

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION'];

/** Words for 0–999. */
function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = ONES[n % 10];
    return o ? `${t}-${o}` : t;
  }
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} HUNDRED${rest ? ` ${underThousand(rest)}` : ''}`;
}

/**
 * @description Write an amount the way a check requires it.
 *
 * The written amount is the legally controlling one when it disagrees with the
 * figures, so cents are rendered as a fraction of 100 rather than words — that
 * is the convention every bank reads and it cannot be misheard as dollars.
 * @param cents - Amount in cents. Negative amounts are refused.
 * @returns e.g. "ONE THOUSAND TWO HUNDRED THIRTY-FOUR AND 56/100".
 */
export function amountInWords(cents: number): string {
  const total = Math.trunc(Number(cents) || 0);
  if (total < 0) throw new Error('A check cannot be written for a negative amount.');
  const dollars = Math.floor(total / 100);
  const remainder = String(total % 100).padStart(2, '0');
  if (dollars === 0) return `ZERO AND ${remainder}/100`;

  const groups: string[] = [];
  let n = dollars;
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${underThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`);
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return `${groups.join(' ')} AND ${remainder}/100`;
}

/* ── numbering ───────────────────────────────────────────────────────────── */

/**
 * @description Allocate a contiguous block of check numbers.
 *
 * Atomic by construction: a single UPDATE advances the sequence and returns
 * where the block started, so two operators printing at the same moment cannot
 * be handed the same number. The unique index on (user_sub, check_number) is
 * the second line of defence — a register only reconciles against a bank
 * statement if a number is never reused.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param count - How many numbers are needed.
 * @returns The allocated numbers, ascending.
 */
export async function allocateCheckNumbers(pool: Pool, sub: string, count: number): Promise<number[]> {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (!n) return [];
  // RETURNING sees the NEW value, so subtracting the block size gives the first
  // number in the block. GREATEST guards a company row whose sequence was left
  // at zero. One statement, so two concurrent callers serialise on the row.
  const r = await pool.query(
    `UPDATE payroll_company
        SET check_next_number = GREATEST(check_next_number, 1) + $2, updated_at = now()
      WHERE user_sub = $1
      RETURNING check_next_number - $2 AS start`,
    [sub, n]);
  const start = Number(r.rows[0]?.start || 0);
  if (!start) throw new Error('No company settings row — cannot allocate check numbers.');
  return Array.from({ length: n }, (_, i) => start + i);
}

/* ── the document ────────────────────────────────────────────────────────── */

/** One line on the earnings statement attached to the check. */
export interface StubLine {
  label: string;
  currentCents: number;
  ytdCents?: number;
}

/** Everything needed to print one payroll check. */
export interface CheckDocument {
  checkNumber: string;
  date: string;
  payeeName: string;
  payeeAddress: string[];
  amountCents: number;
  amountFigures: string;
  amountWords: string;
  memo: string;
  employer: { name: string; address: string[] };
  /** The bank whose stock this prints onto, for the operator's confirmation. */
  bankName: string;
  /** Last four only — the full account never reaches a rendered document. */
  accountLast4: string;
  staleLegend: string;
  earnings: StubLine[];
  deductions: StubLine[];
  taxes: StubLine[];
  grossCents: number;
  netCents: number;
  /**
   * ALWAYS null. See the module header: the governing standard is paywalled and
   * the obtainable vendor sources contradict each other on field positions, so
   * this prints onto pre-encoded stock rather than synthesising the band.
   */
  micrLine: null;
  micrNote: string;
  warnings: string[];
}

/** The inputs a caller assembles from a run line. */
export interface CheckInput {
  checkNumber: number | string;
  date: string;
  payeeName: string;
  payeeAddress?: string[];
  amountCents: number;
  memo?: string;
  employerName: string;
  employerAddress?: string[];
  bankName?: string;
  accountLast4?: string;
  earnings?: StubLine[];
  deductions?: StubLine[];
  taxes?: StubLine[];
  grossCents?: number;
}

/** Format cents as $#,##0.00. */
function figures(cents: number): string {
  const v = (Math.trunc(Number(cents) || 0) / 100).toFixed(2);
  const [whole, frac] = v.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Add whole months to an ISO date, clamping to the end of a short month. */
function addMonths(date: string, months: number): string {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const targetMonth = d.getUTCMonth() + months;
  const end = new Date(Date.UTC(d.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    d.getUTCFullYear(), targetMonth, Math.min(d.getUTCDate(), end),
  )).toISOString().slice(0, 10);
}

/**
 * @description Render one payroll check with its attached earnings statement.
 *
 * @param input - The check details, assembled from a payment and its run line.
 * @returns The document. `micrLine` is always null by design.
 */
export function checkDocument(input: CheckInput): CheckDocument {
  const warnings: string[] = [];
  const amountCents = Math.trunc(Number(input.amountCents) || 0);
  if (amountCents <= 0) {
    warnings.push('A check must be written for a positive amount — this one is not printable.');
  }
  const checkNumber = String(input.checkNumber ?? '').trim();
  if (!checkNumber) warnings.push('No check number was allocated for this payment.');

  const earnings = input.earnings || [];
  const deductions = input.deductions || [];
  const taxes = input.taxes || [];
  const grossCents = Number(
    input.grossCents ?? earnings.reduce((a, l) => a + l.currentCents, 0),
  );
  const withheld = [...deductions, ...taxes].reduce((a, l) => a + l.currentCents, 0);
  if (grossCents && grossCents - withheld !== amountCents) {
    warnings.push(
      `The stub does not foot: gross ${figures(grossCents)} less ${figures(withheld)} withheld is `
      + `${figures(grossCents - withheld)}, but the check is for ${figures(amountCents)}.`,
    );
  }

  return {
    checkNumber,
    date: String(input.date || '').slice(0, 10),
    payeeName: input.payeeName,
    payeeAddress: input.payeeAddress || [],
    amountCents,
    amountFigures: figures(amountCents),
    amountWords: amountCents > 0 ? amountInWords(amountCents) : '',
    memo: input.memo || 'Payroll',
    employer: { name: input.employerName, address: input.employerAddress || [] },
    bankName: input.bankName || '',
    accountLast4: input.accountLast4 || '',
    staleLegend: `VOID AFTER ${STALE_AFTER_MONTHS} MONTHS — ${addMonths(String(input.date), STALE_AFTER_MONTHS)}`,
    earnings,
    deductions,
    taxes,
    grossCents,
    netCents: amountCents,
    micrLine: null,
    micrNote:
      'No MICR line is generated. Print onto your bank\'s pre-encoded check stock: the governing '
      + 'standard (ANSI X9.100-160-1) is not publicly available, the vendor documentation that is '
      + 'available contradicts itself on field positions, and a MICR line one position out is '
      + 'rejected by the reader-sorter or posted to the wrong account. Magnetic toner is required '
      + 'for the band to be machine readable in any case.',
    warnings,
  };
}
