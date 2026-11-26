/**
 * Venture Plan — exact decimal-string FX nano-rate and micro-currency helpers.
 *
 * Financial rates and supplier quote amounts must never pass through binary
 * floating-point multiplication (e.g. `Math.round(parseFloat("1.085") * 1e9)`).
 * This pure module parses decimal strings directly into integer nano-units
 * (1e-9) and integer micro-currency units (1e-6) using string splitting and
 * BigInt arithmetic, matching `src-routes/venture-currency.ts` half-up-away-
 * from-zero rounding to the exact micro.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial pure FX evidence console helpers: exact decimal-to-nanos parser, nano-rate formatter, BigInt half-away conversion preview, micro-currency parser/formatter, safe HTTP URL filter, and snapshot pair selector.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VentureFxConsole = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FX_RATE_SCALE = 1000000000;
  var FX_RATE_SCALE_BIG = 1000000000n;
  var MAX_FX_RATE_NANOS = 1000000 * FX_RATE_SCALE;
  var MAX_FX_RATE_NANOS_BIG = 1000000000000000n;
  var MICROS_PER_UNIT = 1000000;
  var MAX_SAFE_MICROS = 9007199254740000;
  var MAX_SAFE_MICROS_BIG = 9007199254740000n;
  var CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥' };

  /** Create a typed FX helper error with a stable code. */
  function fxError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  /** Normalize a 3-letter ISO-4217 currency code, or return null if invalid. */
  function normalizeCurrency(raw) {
    var code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    return /^[A-Z]{3}$/.test(code) ? code : null;
  }

  /** Parse a non-negative decimal string into BigInt scaled by 10^maxDecimals. */
  function parseScaledDecimal(raw, maxDecimals, code, label) {
    if (typeof raw !== 'string') throw fxError(code, label + ' must be a decimal string');
    var trimmed = raw.trim();
    if (!trimmed) throw fxError(code, label + ' is required');
    if (trimmed.charAt(0) === '-') throw fxError(code, label + ' cannot be negative');
    var match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(trimmed);
    if (!match) throw fxError(code, label + ' must be a plain decimal number');
    var intPart = match[1] || '0';
    var fracPart = match[2] !== undefined ? match[2] : (match[3] || '');
    if (fracPart.length > maxDecimals) {
      throw fxError(code, label + ' supports at most ' + maxDecimals + ' decimal places');
    }
    var padded = fracPart.padEnd(maxDecimals, '0');
    var scale = 10n ** BigInt(maxDecimals);
    return BigInt(intPart) * scale + BigInt(padded || '0');
  }

  /**
   * Parse an exact positive decimal exchange-rate string into integer nano-units (1e-9).
   * Example: "1.085" -> 1085000000, "0.138" -> 138000000.
   */
  function parseDecimalToNanos(str) {
    var nanos = parseScaledDecimal(str, 9, 'invalid_fx_rate', 'Exchange rate');
    if (nanos <= 0n) throw fxError('invalid_fx_rate', 'Exchange rate must be greater than zero');
    if (nanos > MAX_FX_RATE_NANOS_BIG) {
      throw fxError('invalid_fx_rate', 'Exchange rate exceeds maximum supported value (1,000,000)');
    }
    return Number(nanos);
  }

  /** Format integer nano-units (1e-9) back into a minimal exact decimal string. */
  function formatNanosAsRate(nanos) {
    if (typeof nanos !== 'number' || !Number.isSafeInteger(nanos) || nanos <= 0 || nanos > MAX_FX_RATE_NANOS) {
      throw fxError('invalid_fx_rate', 'rateNanos must be a positive safe integer');
    }
    var big = BigInt(nanos);
    var whole = big / FX_RATE_SCALE_BIG;
    var frac = String(big % FX_RATE_SCALE_BIG).padStart(9, '0').replace(/0+$/, '');
    return frac ? String(whole) + '.' + frac : String(whole);
  }

  /** Parse a non-negative decimal currency amount string into exact integer micros (1e-6). */
  function parseDecimalToMicros(str) {
    var micros = parseScaledDecimal(str, 6, 'invalid_currency_amount', 'Amount');
    if (micros > MAX_SAFE_MICROS_BIG) {
      throw fxError('invalid_currency_amount', 'Amount exceeds exact micro-currency range');
    }
    return Number(micros);
  }

  /** Round a signed BigInt quotient half-up away from zero (matches venture-currency.ts). */
  function divideHalfAway(numerator, denominator) {
    var quotient = numerator / denominator;
    var remainder = numerator % denominator;
    if (remainder === 0n) return quotient;
    var magnitude = remainder < 0n ? -remainder : remainder;
    if (magnitude * 2n < denominator) return quotient;
    return quotient + (numerator < 0n ? -1n : 1n);
  }

  /**
   * Convert supplier-currency integer micros using an exact integer nano-rate.
   * Uses BigInt multiplication + half-up-away-from-zero rounding to match venture-currency.ts.
   */
  function convertMicrosPreview(supplierMicros, rateNanos) {
    if (typeof supplierMicros !== 'number' || !Number.isSafeInteger(supplierMicros)
        || Math.abs(supplierMicros) > MAX_SAFE_MICROS) {
      throw fxError('invalid_currency_amount', 'supplierMicros must be exact integer micros');
    }
    if (typeof rateNanos !== 'number' || !Number.isSafeInteger(rateNanos)
        || rateNanos <= 0 || rateNanos > MAX_FX_RATE_NANOS) {
      throw fxError('invalid_fx_rate', 'rateNanos must be a positive integer within bounds');
    }
    var converted = divideHalfAway(BigInt(supplierMicros) * BigInt(rateNanos), FX_RATE_SCALE_BIG);
    if (converted > MAX_SAFE_MICROS_BIG || converted < -MAX_SAFE_MICROS_BIG) {
      throw fxError('fx_conversion_overflow', 'Converted amount exceeds exact micro-currency range');
    }
    return Number(converted);
  }

  /** Group digits with commas for readable currency display. */
  function groupDigits(wholeStr) {
    return String(wholeStr).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Format integer micros with currency symbol and code, preserving sub-cent precision. */
  function formatCurrencyMicros(micros, currencyCode) {
    if (typeof micros !== 'number' || !Number.isSafeInteger(micros)) return '—';
    var code = normalizeCurrency(currencyCode) || 'USD';
    var neg = micros < 0;
    var absBig = BigInt(neg ? -micros : micros);
    var whole = absBig / 1000000n;
    var fracNum = absBig % 1000000n;
    var fracFull = String(fracNum).padStart(6, '0');
    var fracTrimmed = fracFull.replace(/0+$/, '');
    var decimals = fracTrimmed.length <= 2 ? fracFull.slice(0, 2) : fracTrimmed;
    var sym = CURRENCY_SYMBOLS[code];
    var formatted = sym
      ? sym + groupDigits(String(whole)) + '.' + decimals
      : code + ' ' + groupDigits(String(whole)) + '.' + decimals;
    return neg ? '(' + formatted + ')' : formatted;
  }

  /** Return a safe http/https URL string or null for any unsafe/non-URL text. */
  function safeHttpUrl(raw) {
    var s = typeof raw === 'string' ? raw.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(s)) return null;
    try {
      var parsed = new URL(s);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (_e) {
      return null;
    }
  }

  /** Combine source reference and optional notes into a <=500-char sourceRef value. */
  function buildFxSourceRef(sourceRef, notes) {
    var ref = typeof sourceRef === 'string' ? sourceRef.trim() : '';
    var note = typeof notes === 'string' ? notes.trim() : '';
    if (!ref && !note) throw fxError('invalid_fx_source', 'Source URL or reference is required');
    var combined = ref && note ? ref + ' | ' + note : (ref || note);
    if (combined.length > 500) {
      throw fxError('invalid_fx_source', 'Source reference plus notes must be at most 500 characters');
    }
    return combined;
  }

  /** Split a stored sourceRef into a safe URL (if any), label text, and optional notes. */
  function parseSourceRefParts(sourceRef) {
    var raw = typeof sourceRef === 'string' ? sourceRef.trim() : '';
    var sep = raw.indexOf(' | ');
    var head = sep >= 0 ? raw.slice(0, sep).trim() : raw;
    var notes = sep >= 0 ? raw.slice(sep + 3).trim() : '';
    var url = safeHttpUrl(head);
    return { url: url, label: url ? head : head, notes: notes };
  }

  /** Filter recorded snapshots to a specific source->reporting pair, newest observed first. */
  function filterSnapshotsForPair(snapshots, sourceCurrency, reportingCurrency) {
    var src = normalizeCurrency(sourceCurrency);
    var rep = normalizeCurrency(reportingCurrency);
    if (!src || !rep || src === rep || !Array.isArray(snapshots)) return [];
    return snapshots.filter(function (fx) {
      return fx && fx.sourceCurrency === src && fx.reportingCurrency === rep;
    }).slice().sort(function (a, b) {
      var byObs = String(b.observedAt || '').localeCompare(String(a.observedAt || ''));
      if (byObs !== 0) return byObs;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  /** Generate a fresh client-side idempotency key matching /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/. */
  function makeFxIdempotencyKey(sourceCurrency, reportingCurrency) {
    var src = (normalizeCurrency(sourceCurrency) || 'fx').toLowerCase();
    var rep = (normalizeCurrency(reportingCurrency) || 'usd').toLowerCase();
    var rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    return ('fx-' + src + '-' + rep + '-' + Date.now().toString(36) + '-' + rand).slice(0, 120);
  }

  return {
    FX_RATE_SCALE: FX_RATE_SCALE,
    MAX_FX_RATE_NANOS: MAX_FX_RATE_NANOS,
    MICROS_PER_UNIT: MICROS_PER_UNIT,
    MAX_SAFE_MICROS: MAX_SAFE_MICROS,
    normalizeCurrency: normalizeCurrency,
    parseDecimalToNanos: parseDecimalToNanos,
    formatNanosAsRate: formatNanosAsRate,
    parseDecimalToMicros: parseDecimalToMicros,
    convertMicrosPreview: convertMicrosPreview,
    formatCurrencyMicros: formatCurrencyMicros,
    safeHttpUrl: safeHttpUrl,
    buildFxSourceRef: buildFxSourceRef,
    parseSourceRefParts: parseSourceRefParts,
    filterSnapshotsForPair: filterSnapshotsForPair,
    makeFxIdempotencyKey: makeFxIdempotencyKey
  };
});
