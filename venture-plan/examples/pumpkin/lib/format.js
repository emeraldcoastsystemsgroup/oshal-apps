/**
 * Formatting helpers for the generated venture documents.
 *
 * EVERY MONEY STRING IN EVERY DOCUMENT COMES THROUGH HERE, and every one of them
 * starts life as integer micros produced by the engine. That is the mechanism
 * behind "no figure is hand-typed": a document cannot print a dollar sign without
 * handing this module a number the engine computed, and `regenerate.js` audits the
 * finished markdown for any `$` numeral that does not appear in the engine's own
 * value set.
 *
 * `usd()` deliberately has no default and no fallback for a null. A missing figure
 * renders as the literal string `UNCOMPUTED` rather than as `$0.00`, because a
 * blank or a zero where a number should be is indistinguishable from a real zero
 * and that is how a plan quietly acquires a figure nobody produced.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — money/percent/ratio formatters over engine micros, markdown table construction, and the UNCOMPUTED sentinel that keeps a missing figure visible instead of printing as zero.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Added `implausiblePercentages`. The emission audit only ever checked currency numerals, so a basis-point value handed to the ratio formatter published "150000.0% of landed cost" in the cash-flow document and the run still exited clean.
 */
'use strict';

const path = require('node:path');

const PKG = path.resolve(__dirname, '..', '..', '..');

/**
 * @description Require a COMPILED engine module — the same bytes the framework
 *   mounts. The documents are generated from the shipped engine, not from the
 *   TypeScript sources, so a source/compiled divergence shows up here.
 * @param {string} name - Module basename, e.g. `venture-model`.
 * @returns {object} The compiled module's exports.
 */
function engine(name) {
  return require(path.join(PKG, 'routes', `${name}.js`));
}

const P = engine('venture-primitives');

/** Printed where a figure the engine did not compute would otherwise go. */
const UNCOMPUTED = '_uncomputed_';

/**
 * Every money string this module has produced during the run. `regenerate.js`
 * extracts every `$` numeral out of the finished markdown and requires it to be a
 * member: a figure typed into prose by hand is not in this set, so the audit fails
 * and the run exits non-zero. This is what makes "no number is hand-typed" a
 * mechanism rather than an assurance.
 */
const EMITTED = new Set();

/**
 * @description Format engine micros as a dollar string, recording the result so
 *   the post-render audit can prove every printed dollar figure came from the
 *   engine. A null or non-finite value renders as the UNCOMPUTED sentinel rather
 *   than as zero.
 * @param {number|null|undefined} micros - Integer micro-dollars from the engine.
 * @param {{cents?: boolean}} [opts] - `cents: false` rounds to whole dollars.
 * @returns {string} `$1,234.56`, `($1,234.56)` for negatives, or the sentinel.
 */
function usd(micros, opts) {
  if (micros === null || micros === undefined || !Number.isFinite(micros)) return UNCOMPUTED;
  const out = P.formatUsd(micros, opts);
  EMITTED.add(out);
  return out;
}

/**
 * Matches a currency numeral in generated markdown, including accounting negatives.
 * Thousands groups are matched as exact triples rather than as "digits and commas",
 * so a comma of ordinary punctuation after a figure is not swallowed into the token
 * and reported as an unbacked number.
 */
const MONEY_TOKEN_RE = /\(?\$\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?/g;

/**
 * @description Extract every currency numeral from a rendered document and return
 *   the ones that did not come out of `usd()`.
 * @param {string} markdown - The rendered document.
 * @returns {string[]} Unmatched currency tokens, deduped and sorted.
 */
function unbackedMoneyTokens(markdown) {
  const found = new Set();
  for (const raw of markdown.match(MONEY_TOKEN_RE) || []) {
    // A trailing `)` only belongs to the token when it opened with `(`.
    const token = raw.startsWith('(') ? raw : raw.replace(/\)$/, '');
    if (!EMITTED.has(token)) found.add(token);
  }
  return [...found].sort();
}

/**
 * @description Format whole dollars — used in tables where cents are noise.
 * @param {number|null|undefined} micros - Integer micro-dollars.
 * @returns {string} `$1,234` or the sentinel.
 */
function usd0(micros) {
  return usd(micros, { cents: false });
}

/**
 * @description Format basis points as a percentage.
 * @param {number|null|undefined} bps - Basis points.
 * @param {number} [dp=1] - Decimal places.
 * @returns {string} `42.5%` or the sentinel.
 */
function pct(bps, dp = 1) {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return UNCOMPUTED;
  return `${(bps / 100).toFixed(dp)}%`;
}

/**
 * @description Format a unitless fraction as a percentage.
 *
 * THIS TAKES A FRACTION, NOT BASIS POINTS. Handing it a bps value published
 * "150000.0% of landed cost" in the cash-flow document, because 1500 bps read as a
 * ratio is fifteen hundred. The two formatters are one character apart in the call
 * site and ten thousand times apart in the output, so this THROWS on a value no
 * fraction in this domain reaches, and `implausiblePercentages` below audits the
 * finished markdown as a backstop for anything that arrives already stringified.
 *
 * The ceiling is deliberately generous: a required sell-through above 1.0 is a real
 * finding this document set prints ("you would have to sell 3,268% of what you
 * made"), so only a value at basis-point scale is refused.
 *
 * @param {number|null|undefined} ratio - A fraction, e.g. 0.145.
 * @param {number} [dp=1] - Decimal places.
 * @returns {string} `14.5%` or the sentinel.
 */
function ratioPct(ratio, dp = 1) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return UNCOMPUTED;
  if (Math.abs(ratio) >= RATIO_CEILING) {
    throw new RangeError(`ratioPct received ${ratio}, which is basis-point scale rather than a fraction — use pct() for a bps value`);
  }
  return `${(ratio * 100).toFixed(dp)}%`;
}

/** A "fraction" at or above this magnitude is a basis-point value in the wrong helper. */
const RATIO_CEILING = 100;

/**
 * Matches a printed percentage. Digit runs are matched WITHOUT requiring thousands
 * grouping, because the defect this catches prints ungrouped ("150000.0%") and a
 * grouped-only pattern matched the last three digits of it and found nothing wrong.
 */
const PERCENT_TOKEN_RE = /-?\d[\d,]*(?:\.\d+)?%/g;

/**
 * Percentages a venture document can legitimately print above 100: a required
 * sell-through the engine returns above 1.0 is a FINDING ("you would have to sell
 * 3,268% of what you made"), and a cost multiple is a comparison. Anything above
 * this ceiling is at basis-point scale and is a unit slip.
 */
const PERCENT_CEILING = 10000;

/**
 * @description Extract every printed percentage that is implausibly large — the
 *   signature of a basis-point value handed to the ratio formatter.
 *
 *   The currency audit cannot see this class of defect: a percentage is not a
 *   dollar figure, so `unbackedMoneyTokens` walked straight past a published
 *   "150000.0%". Percentages above a thousand percent do not occur in a venture
 *   plan that is telling the truth about itself.
 *
 * @param {string} markdown - The rendered document.
 * @returns {string[]} Offending percentage tokens, deduped and sorted.
 */
function implausiblePercentages(markdown) {
  const found = new Set();
  for (const raw of markdown.match(PERCENT_TOKEN_RE) || []) {
    const value = Math.abs(Number(raw.replace(/[,%]/g, '')));
    if (Number.isFinite(value) && value > PERCENT_CEILING) found.add(raw);
  }
  return [...found].sort();
}

/**
 * @description Format a whole count with thousands separators.
 * @param {number|null|undefined} n - The count.
 * @returns {string} `5,000` or the sentinel.
 */
function num(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNCOMPUTED;
  const rounded = Math.round(n);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @description Format a number to fixed decimals, sentinel-safe.
 * @param {number|null|undefined} n - The value.
 * @param {number} [dp=2] - Decimal places.
 * @returns {string} The formatted number or the sentinel.
 */
function dec(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNCOMPUTED;
  return n.toFixed(dp);
}

/**
 * @description Build a GitHub-flavoured markdown table. Rows are arrays of
 *   already-formatted strings; nothing is formatted here, so a caller cannot
 *   accidentally bypass the money formatters.
 * @param {string[]} headers - Column headers.
 * @param {Array<Array<string>>} rows - Row cells, pre-formatted.
 * @param {string[]} [align] - Per-column alignment: `l`, `r` or `c`.
 * @returns {string} The markdown table, or a stated-empty line when there are no rows.
 */
function table(headers, rows, align) {
  if (!rows.length) return '_No rows — the engine produced none for this section._\n';
  const rule = headers.map((_, i) => {
    const a = align && align[i];
    if (a === 'r') return '---:';
    if (a === 'c') return ':---:';
    return '---';
  });
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(rule), ...rows.map(line)].join('\n') + '\n';
}

/**
 * @description Escape a cell so a pipe or newline in source data cannot break the
 *   table structure of a generated document.
 * @param {unknown} value - The cell value.
 * @returns {string} A single-line, pipe-safe string.
 */
function cell(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * @description Join document sections with exactly one blank line between them
 *   and a single trailing newline, so regenerating produces a stable diff.
 * @param {Array<string|null|undefined>} parts - Section strings; falsy parts drop.
 * @returns {string} The assembled document.
 */
function doc(parts) {
  return parts.filter(Boolean).map((s) => String(s).trim()).join('\n\n') + '\n';
}

module.exports = {
  PKG, engine, UNCOMPUTED, EMITTED, usd, usd0, pct, ratioPct, num, dec, table, cell, doc,
  unbackedMoneyTokens, MONEY_TOKEN_RE, implausiblePercentages, PERCENT_CEILING, RATIO_CEILING,
};
