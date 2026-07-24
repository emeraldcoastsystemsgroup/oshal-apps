/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:58:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract bounded D&D Beyond PDF text recognition, inventory recovery, and optional byte parsing from the character-import facade.
 */

'use strict';

const { Buffer } = require('buffer');
const {
  ABILITIES,
  ABILITY_NAMES,
  LIMITS,
  assertSize,
  cleanString,
  fail,
  isRecord,
  safeId,
} = require('./character-import-common');
const { WEAPONS, classifyItem, weaponKey } = require('./character-import-items');
const { buildSheet, sourceMeta } = require('./character-import-sheet');

/** @description Convert extracted PDF text into bounded non-empty normalized lines. */
function normalizedPdfText(input) {
  if (typeof input !== 'string') fail('INVALID_INPUT', 'PDF text must be a string.');
  assertSize(input, LIMITS.TEXT_BYTES, 'Extracted PDF text');
  return input.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
}

/** @description Canonicalize PDF labels so varied capitalization and punctuation still match. */
function headingKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const PDF_LABEL_GROUPS = Object.freeze({
  name: ['character name', 'charactername'],
  classLevel: ['class & level', 'class and level', 'classlevel'],
  className: ['class'],
  level: ['level'],
  race: ['race', 'species'],
  ac: ['armor class', 'armour class', 'ac'],
  maxHp: ['hit point maximum', 'hit point max', 'maximum hit points', 'max hp', 'hp max', 'hpmax'],
  speed: ['speed', 'walking speed'],
  initiative: ['initiative', 'init'],
  prof: ['proficiency bonus', 'prof bonus', 'proficiencybonus'],
  equipment: ['equipment', 'equipment carried'],
  attacks: ['attacks & spellcasting', 'attacks and spellcasting', 'attacks spellcasting'],
});

const PDF_HEADINGS = new Set(Object.values(PDF_LABEL_GROUPS).flat().map(headingKey).concat([
  'background', 'alignment', 'player name', 'experience points', 'inspiration',
  'saving throws', 'skills', 'passive wisdom perception', 'personality traits',
  'ideals', 'bonds', 'flaws', 'features traits', 'other proficiencies languages',
  'spellcasting class', 'spellcasting ability', 'spell save dc', 'spell attack bonus',
].map(headingKey)));

/** @description Read a value placed before, after, or beside one of the supplied PDF labels. */
function labeledValue(lines, labels) {
  const normalized = labels.map(headingKey);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const key = headingKey(line);
    for (const label of normalized) {
      if (key === label) {
        const next = lines[index + 1];
        if (next && !PDF_HEADINGS.has(headingKey(next))) return next;
        const previous = lines[index - 1];
        if (previous && !PDF_HEADINGS.has(headingKey(previous))) return previous;
      }
      if (key.startsWith(label + ' ')) {
        const tail = line.slice(Math.min(line.length, label.length)).replace(/^\s*[:#-]?\s*/, '').trim();
        if (tail) return tail;
      }
      if (key.endsWith(' ' + label)) {
        const head = line.slice(0, Math.max(0, line.length - label.length)).replace(/\s*[:#-]?\s*$/, '').trim();
        if (head) return head;
      }
      const colon = line.match(/^([^:]{1,40}):\s*(.+)$/);
      if (colon && headingKey(colon[1]) === label) return colon[2].trim();
    }
  }
  return undefined;
}

/** @description Recover one ability score from common fillable-sheet extraction orders. */
function pdfAbility(lines, shortName) {
  const longName = ABILITY_NAMES[shortName];
  const aliases = [shortName, longName, `${longName} score`];
  const direct = labeledValue(lines, aliases);
  if (direct !== undefined) {
    const match = String(direct).match(/(?:^|\s)([1-2]?\d|30)(?:\s|$)/);
    if (match) return Number(match[1]);
  }
  for (const line of lines) {
    let match = line.match(new RegExp(`^(?:${shortName}|${longName})(?:\\s+score)?\\s*[:#-]?\\s*(\\d{1,2})$`, 'i'));
    if (match) return Number(match[1]);
    match = line.match(new RegExp(`^(\\d{1,2})\\s+(?:${shortName}|${longName})(?:\\s+score)?$`, 'i'));
    if (match) return Number(match[1]);
  }
  const keys = new Set(aliases.map(headingKey));
  for (let index = 0; index < lines.length; index++) {
    if (!keys.has(headingKey(lines[index]))) continue;
    for (let offset = index + 1; offset <= Math.min(index + 3, lines.length - 1); offset++) {
      if (PDF_HEADINGS.has(headingKey(lines[offset]))) break;
      if (/^\d{1,2}$/.test(lines[offset])) {
        const score = Number(lines[offset]);
        if (score >= 1 && score <= 30) return score;
      }
    }
  }
  return 10;
}

/** @description Read the first signed integer associated with a known PDF label group. */
function numberFromLabel(lines, key) {
  const value = labeledValue(lines, PDF_LABEL_GROUPS[key]);
  if (value === undefined) return undefined;
  const match = String(value).match(/[+-]?\d+/);
  return match ? Number(match[0]) : value;
}

/** @description Parse combined or separate class-and-level PDF fields. */
function parsePdfClass(lines) {
  const combined = labeledValue(lines, PDF_LABEL_GROUPS.classLevel);
  if (!combined) {
    return {
      className: labeledValue(lines, PDF_LABEL_GROUPS.className) || 'Adventurer',
      level: numberFromLabel(lines, 'level') || 1,
    };
  }
  const parts = String(combined).split(/\s*[/,]\s*/).filter(Boolean);
  const names = [];
  let total = 0;
  for (const part of parts) {
    const match = part.match(/^(.*?)(?:\s+|-)(\d{1,2})$/);
    if (match) { names.push(match[1].trim()); total += Number(match[2]); }
    else names.push(part.trim());
  }
  if (!total) {
    const match = String(combined).match(/\b(\d{1,2})\b/);
    total = match ? Number(match[1]) : 1;
  }
  const className = names.join(' / ').replace(/\s+\d{1,2}(?=\s*\/|$)/g, '').trim();
  return { className: className || 'Adventurer', level: total };
}

/** @description Read bounded lines following a known PDF section heading. */
function sectionLines(lines, labels) {
  const labelSet = new Set(labels.map(headingKey));
  for (let index = 0; index < lines.length; index++) {
    const key = headingKey(lines[index]);
    const exact = labelSet.has(key);
    const prefix = [...labelSet].find((label) => key.startsWith(label + ' '));
    if (!exact && !prefix) continue;
    const section = [];
    if (prefix) section.push(lines[index].slice(prefix.length).replace(/^\s*[:#-]?\s*/, ''));
    for (let offset = index + 1; offset < lines.length && section.length < 30; offset++) {
      if (PDF_HEADINGS.has(headingKey(lines[offset]))) break;
      section.push(lines[offset]);
    }
    return section.filter(Boolean);
  }
  return [];
}

/** @description Escape a catalog label before constructing a recognition expression. */
function regexEscape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** @description Find distinct supported SRD weapons mentioned in extracted text. */
function weaponsMentioned(text) {
  const found = [];
  const lower = text.toLowerCase();
  for (const [key, definition] of Object.entries(WEAPONS)) {
    const variants = [definition.name.toLowerCase(), key.replace(/-/g, ' ')];
    if (variants.some((value) => new RegExp(`\\b${regexEscape(value)}\\b`, 'i').test(lower))) {
      found.push(definition.name);
    }
  }
  return [...new Set(found)];
}

/** @description Recover supported weapons and ordinary equipment from PDF sections. */
function pdfInventory(lines) {
  const equipment = sectionLines(lines, PDF_LABEL_GROUPS.equipment);
  const attackLines = sectionLines(lines, PDF_LABEL_GROUPS.attacks);
  const combined = equipment.concat(attackLines).join('\n');
  const weaponNames = weaponsMentioned(combined || lines.join('\n'));
  const inventory = weaponNames.map((name) => ({
    name, category: 'weapon', quantity: 1, equipped: true,
  }));
  for (const chunk of equipment.join(',').split(/[,;\u2022]+/)) {
    const name = cleanString(chunk, LIMITS.ITEM_NAME, 'equipment item', false);
    if (!name || /^\d+$/.test(name) || PDF_HEADINGS.has(headingKey(name)) || weaponKey(name)) continue;
    if (inventory.length >= LIMITS.INVENTORY_COUNT) break;
    inventory.push({
      name,
      category: classifyItem(name),
      quantity: 1,
      equipped: /armor|armour|shield/i.test(name),
    });
  }
  return inventory;
}

/**
 * @description Normalize extracted D&D Beyond PDF text into a canonical playable sheet.
 * @param {string} input - Extracted plain text from a character PDF.
 * @returns {object} Canonical playable sheet.
 */
function parseDndBeyondPdfText(input) {
  const lines = normalizedPdfText(input);
  const name = labeledValue(lines, PDF_LABEL_GROUPS.name);
  if (!name) fail('MISSING_NAME', 'Character name is required.', 'name');
  const abilities = Object.fromEntries(ABILITIES.map((key) => [key, pdfAbility(lines, key)]));
  const classInfo = parsePdfClass(lines);
  const raw = {
    id: `ddb-${safeId(name)}`,
    name,
    race: labeledValue(lines, PDF_LABEL_GROUPS.race),
    class: classInfo.className,
    level: classInfo.level,
    abilities,
    prof: numberFromLabel(lines, 'prof'),
    ac: numberFromLabel(lines, 'ac'),
    maxHp: numberFromLabel(lines, 'maxHp'),
    speed: numberFromLabel(lines, 'speed'),
    initiative: numberFromLabel(lines, 'initiative'),
    inventory: pdfInventory(lines),
    actions: [],
    features: [],
  };
  return buildSheet(raw, sourceMeta('dndbeyond', 'pdf-text'), { idSeed: raw.id });
}

/**
 * @description Extract bounded text from PDF bytes using an injected or optional parser.
 * @param {Buffer|Uint8Array} input - Raw PDF bytes.
 * @param {object} [options] - Optional pdfParse implementation.
 * @returns {Promise<string>} Extracted bounded PDF text.
 */
async function extractPdfText(input, options) {
  if (!(Buffer.isBuffer(input) || input instanceof Uint8Array)) {
    fail('INVALID_PDF', 'PDF input must be bytes.');
  }
  const buffer = Buffer.from(input);
  assertSize(buffer, LIMITS.PDF_BYTES, 'PDF');
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    fail('INVALID_PDF', 'Input does not have a PDF header.');
  }
  let parser = options && options.pdfParse;
  if (!parser) {
    try { parser = require('pdf-parse'); }
    catch (_err) {
      fail('PDF_PARSER_UNAVAILABLE', 'Install optional dependency "pdf-parse" or inject options.pdfParse.');
    }
  }
  if (isRecord(parser) && typeof parser.default === 'function') parser = parser.default;
  if (typeof parser !== 'function') fail('PDF_PARSER_UNAVAILABLE', 'The supplied PDF parser is not callable.');
  let result;
  try { result = await parser(buffer); }
  catch (_err) { fail('INVALID_PDF', 'PDF text extraction failed.'); }
  const text = typeof result === 'string' ? result : result && result.text;
  if (typeof text !== 'string') fail('INVALID_PDF', 'PDF parser returned no text.');
  assertSize(text, LIMITS.TEXT_BYTES, 'Extracted PDF text');
  return text;
}

/**
 * @description Extract and normalize one D&D Beyond PDF in a single route-facing operation.
 * @param {Buffer|Uint8Array} input - Raw PDF bytes.
 * @param {object} [options] - Optional pdfParse implementation.
 * @returns {Promise<object>} Canonical playable sheet.
 */
async function importDndBeyondPdf(input, options) {
  return parseDndBeyondPdfText(await extractPdfText(input, options));
}

module.exports = {
  extractPdfText,
  importDndBeyondPdf,
  parseDndBeyondPdfText,
};
