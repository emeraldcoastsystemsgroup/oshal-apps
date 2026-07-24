/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:58:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace the oversized implementation with a stable route-facing facade over focused common, item, sheet, and PDF adapters while preserving every public export.
 */

'use strict';

const {
  CharacterImportError,
  LIMITS,
  fail,
  parseJson,
  safeId,
} = require('./character-import-common');
const { WEAPONS } = require('./character-import-items');
const {
  looksLikeDndBeyond,
  normalizeDndBeyondJson,
  normalizeInternalSheet,
} = require('./character-import-sheet');
const {
  extractPdfText,
  importDndBeyondPdf,
  parseDndBeyondPdfText,
} = require('./character-import-pdf');

const SUPPORTED_FORMATS = new Set([
  'auto', 'internal-json', 'dndbeyond-json', 'dndbeyond-pdf-text',
]);

/**
 * @description Dispatch untrusted character input to the selected bounded format adapter.
 * @param {*} input - Character object, JSON, extracted PDF text, or provider envelope.
 * @param {object} [options] - Import options containing an optional format selector.
 * @returns {object} Canonical playable character sheet.
 */
function importCharacter(input, options) {
  const format = (options && options.format) || 'auto';
  if (!SUPPORTED_FORMATS.has(format)) {
    fail('UNSUPPORTED_FORMAT', `Unsupported character format: ${format}.`);
  }
  if (format === 'dndbeyond-pdf-text') return parseDndBeyondPdfText(input);
  if (format === 'internal-json') return normalizeInternalSheet(input);
  if (format === 'dndbeyond-json') return normalizeDndBeyondJson(input);
  if (typeof input === 'string' && !/^\s*[\[{]/.test(input)) {
    return parseDndBeyondPdfText(input);
  }
  const parsed = parseJson(input);
  return looksLikeDndBeyond(parsed)
    ? normalizeDndBeyondJson(parsed)
    : normalizeInternalSheet(parsed);
}

module.exports = {
  CharacterImportError,
  LIMITS,
  WEAPONS,
  safeId,
  normalizeInternalSheet,
  normalizeDndBeyondJson,
  parseDndBeyondPdfText,
  importCharacter,
  extractPdfText,
  importDndBeyondPdf,
};
