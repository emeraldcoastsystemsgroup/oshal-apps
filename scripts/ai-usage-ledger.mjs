#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The store's AI usage and requirements ledger (core ADR-170 D2/D10; operator 2026-09-29: a ledger per repo, every application tagged and documented in a standard way, container memory low/high). Zero-dependency like the other catalog gates: reads each package's `rating:` block in its ONE standard form, writes AI-USAGE-LEDGER.md and a generated "Models and requirements" section in each package README, and `--check` fails on a stale ledger, a stale README section, a malformed block, or (without --allow-unrated) an unrated package. Carries no version, so a version bump never stales it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | T0 is accepted only for a generation-only feature (generation local or hosted), matching the core loader (oshal #911).
 *
 * Usage:
 *   node scripts/ai-usage-ledger.mjs --write                  regenerate ledger + README sections
 *   node scripts/ai-usage-ledger.mjs --check [--allow-unrated] fail on any drift
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_FILE = 'AI-USAGE-LEDGER.md';
export const SECTION_START = '<!-- oshal-rating:start -->';
export const SECTION_END = '<!-- oshal-rating:end -->';
const NOT_MEASURED = 'not yet measured';
const NONE_RECORDED = 'none recorded';
const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'];
const GENERATIONS = ['none', 'local', 'hosted'];
const DEGRADES = ['template', 'hosted', 'disable', 'reduced'];
const BASES = ['declared', 'observed'];
const MEMORY_MAX_MB = 1048576;
const MEMORY_KEYS = ['low', 'high', 'basis'];
const FEATURE_KEYS = ['id', 'unit', 'tier', 'generation', 'degrade', 'contextFloor', 'reducedEdition'];
const FEATURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STANDARD_FORM = 'write it in the standard form: `memoryMb: { low: N, high: N, basis: declared }`, then `features: []` or a block list of `- id:` items';

/** @description Strip an inline comment and surrounding quotes from a scalar. */
function scalar(value) {
  return value.replace(/\s+#.*$/, '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
}

/** @description The indented lines under the top-level `rating:` key, comments dropped. */
function ratingLines(text) {
  const all = text.split(/\r?\n/);
  const start = all.findIndex((line) => /^rating:[ \t]*(?:#.*)?$/.test(line));
  if (start === -1) return null;
  const lines = [];
  for (let index = start + 1; index < all.length; index += 1) {
    const raw = all[index].replace(/\s+$/, '');
    if (raw === '' || /^\s*#/.test(raw)) continue;
    if (!/^[ \t]/.test(raw)) break;
    lines.push({ raw, indent: raw.match(/^[ \t]*/)[0].length, text: raw.trim(), line: index + 1 });
  }
  return lines;
}

/** @description Parse `{ low: 64, high: 256, basis: declared }`. */
function parseMemory(value, at, problems) {
  const match = /^\{(.*)\}$/.exec(scalar(value));
  if (!match) { problems.push(`${at} memoryMb must be a flow mapping; ${STANDARD_FORM}`); return null; }
  const memory = {};
  for (const pair of match[1].split(',').map((part) => part.trim()).filter(Boolean)) {
    const kv = /^([A-Za-z]+):\s*(.+)$/.exec(pair);
    if (!kv || !MEMORY_KEYS.includes(kv[1])) { problems.push(`${at} memoryMb has an unknown or malformed field: ${pair}`); return null; }
    memory[kv[1]] = scalar(kv[2]);
  }
  const low = Number(memory.low);
  const high = Number(memory.high);
  const basis = memory.basis ?? 'declared';
  if (!Number.isInteger(low) || !Number.isInteger(high) || low <= 0 || high <= 0) problems.push(`${at} memoryMb low and high must be positive integers (MiB)`);
  else if (low > high) problems.push(`${at} memoryMb low (${low}) must not exceed high (${high})`);
  else if (high > MEMORY_MAX_MB) problems.push(`${at} memoryMb high (${high}) exceeds ${MEMORY_MAX_MB} MiB; the unit is MiB, not bytes`);
  if (!BASES.includes(basis)) problems.push(`${at} memoryMb basis "${basis}" is not one of ${BASES.join(', ')}`);
  return { low, high, basis };
}

/** @description Validate one parsed feature against the closed sets. */
function checkFeature(feature, at, seen, problems) {
  for (const key of Object.keys(feature)) if (!FEATURE_KEYS.includes(key)) problems.push(`${at} has unknown field ${key} (token counts and verified models are generated, never declared)`);
  if (!FEATURE_ID.test(feature.id ?? '')) problems.push(`${at} id must be a kebab-case string`);
  else if (seen.has(feature.id)) problems.push(`${at} id "${feature.id}" is declared twice`);
  seen.add(feature.id);
  if (!feature.unit) problems.push(`${at} unit must name the thing one transaction is`);
  if (!TIERS.includes(feature.tier)) problems.push(`${at} tier "${feature.tier}" is not one of ${TIERS.join(', ')}`);
  if (!GENERATIONS.includes(feature.generation)) problems.push(`${at} generation "${feature.generation}" is not one of ${GENERATIONS.join(', ')}`);
  if (feature.tier === 'T0' && feature.generation === 'none') problems.push(`${at} tier T0 is declared only for a generation-only feature (generation local or hosted)`);
  if (!DEGRADES.includes(feature.degrade)) problems.push(`${at} degrade "${feature.degrade}" is not one of ${DEGRADES.join(', ')}`);
  if (feature.contextFloor !== undefined && !(Number.isInteger(Number(feature.contextFloor)) && Number(feature.contextFloor) > 0)) problems.push(`${at} contextFloor must be a positive integer`);
  if (feature.degrade === 'reduced' && !feature.reducedEdition) problems.push(`${at} degrade: reduced requires reducedEdition`);
}

/** @description Parse the `features:` list (items at indent 4, fields at indent 6). */
function parseFeatures(lines, at, problems) {
  const features = [];
  let current = null;
  for (const entry of lines) {
    const item = /^- ([A-Za-z]+):\s*(.*)$/.exec(entry.text);
    const field = /^([A-Za-z]+):\s*(.*)$/.exec(entry.text);
    if (entry.indent === 4 && item) {
      current = { [item[1]]: scalar(item[2]) };
      features.push(current);
    } else if (entry.indent === 6 && field && current) {
      current[field[1]] = scalar(field[2]);
    } else {
      problems.push(`${at}:${entry.line} is not in the standard form; ${STANDARD_FORM}`);
      return [];
    }
  }
  return features;
}

/**
 * @description Read a manifest's rating block in its one standard form.
 * @param {string} text - The oshal-app.yaml text.
 * @param {string} label - A path label for messages.
 * @returns {{rating: object|null, problems: string[]}} The rating (null when absent) and any problems.
 */
export function readRating(text, label) {
  const problems = [];
  const lines = ratingLines(text);
  if (lines === null) return { rating: null, problems };
  if (lines.some((entry) => entry.raw.includes('\t'))) return { rating: null, problems: [`${label} indents rating: with a tab`] };
  let memoryMb = null;
  let features = null;
  const rest = [];
  for (const entry of lines) {
    const top = entry.indent === 2 ? /^([A-Za-z]+):\s*(.*)$/.exec(entry.text) : null;
    if (top && top[1] === 'memoryMb') memoryMb = parseMemory(top[2], label, problems);
    else if (top && top[1] === 'features') {
      const value = scalar(top[2]);
      if (value === '[]') features = [];
      else if (value !== '') problems.push(`${label} features must be [] or a block list; ${STANDARD_FORM}`);
      else features = rest;
    } else if (top) problems.push(`${label} rating has unknown field ${top[1]}`);
    else if (features === rest) rest.push(entry);
    else problems.push(`${label}:${entry.line} is not in the standard form; ${STANDARD_FORM}`);
  }
  if (!memoryMb && !problems.length) problems.push(`${label} rating needs memoryMb`);
  if (features === null && !problems.length) problems.push(`${label} rating needs features ([] when no model is in the loop)`);
  const parsed = features === rest ? parseFeatures(rest, label, problems) : (features ?? []);
  const seen = new Set();
  parsed.forEach((feature, index) => checkFeature(feature, `${label} rating.features[${index}]`, seen, problems));
  return { rating: problems.length ? null : { memoryMb, features: parsed }, problems };
}

function topScalar(text, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(text);
  return match ? scalar(match[1]) : '';
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** @description Every package directory, sorted, with its parsed rating. */
export function collect(root = REPOSITORY_ROOT) {
  const problems = [];
  const packages = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name).sort()
    .map((directory) => {
      const text = fs.readFileSync(path.join(root, directory, 'oshal-app.yaml'), 'utf8');
      const { rating, problems: found } = readRating(text, `${directory}/oshal-app.yaml`);
      problems.push(...found);
      return { directory, name: topScalar(text, 'name') || directory, displayName: topScalar(text, 'displayName') || directory, rating, rated: ratingLines(text) !== null };
    });
  return { packages, problems };
}

function memoryText(rating) {
  return `${rating.memoryMb.low} / ${rating.memoryMb.high} (${rating.memoryMb.basis})`;
}

function featureCells(feature) {
  const floor = feature.contextFloor ? ` (context ≥ ${feature.contextFloor})` : '';
  const degrade = feature.degrade === 'reduced' ? `reduced: ${cell(feature.reducedEdition)}` : feature.degrade;
  return `${cell(feature.id)} | ${cell(feature.unit)} | ${feature.tier}${floor} | ${feature.generation} | ${degrade} | ${NOT_MEASURED} | ${NONE_RECORDED}`;
}

/** @description The explanatory header shared by the ledger. */
function ruleText() {
  return [
    'Memory is container MiB the application needs on the swarm host, including any engine container it owns;',
    '`low` runs it, `high` is the ceiling to plan for. Each application counts every bot container it uses, even one',
    'another application shares, so the figures describe one application and do not add up across applications.',
    'Services on another machine (a GPU box, a desktop worker node) are not counted.',
    '',
    'Declared memory (basis `declared`) follows one rule until an observed run replaces it (basis `observed`):',
    'a bot-node container is 64 MiB low (the core sizing runbook, `docs/runbooks/docker-engine-memory-sizing.md`,',
    'measures 43–50 MiB idle per worker bot) and 256 high; an application with no bot container of its own is 32 low',
    'and 128 high (its load lands in the api process); a package engine container with a declared `mem_limit` counts',
    'that limit as its high and a quarter of it as its low. These are declared ceilings, not measurements.',
    '',
    'Tier is the capability the feature asks of a model today (core ADR-170 D1): T1 pick from a set, T2 a bounded plan',
    'code renders, T3 grounded reasoning over retrieved context, T4 long tool loops. T0 means no language model: a feature',
    'declares it only when a template prompt drives an image, audio or video model (generation local or hosted).',
    'A package with no model at all shows "none (T0, no model in the loop)".',
    `Tokens per unit and models verified read "${NOT_MEASURED}" / "${NONE_RECORDED}" until the P0 and P1 generators exist;`,
    'a number in those columns is never typed by hand.',
  ];
}

/** @description The whole store ledger as markdown. */
export function renderLedger(packages) {
  const unrated = packages.filter((entry) => !entry.rating).map((entry) => entry.name);
  const lines = [
    '# AI usage and requirements ledger — store',
    '',
    "Generated by `node scripts/ai-usage-ledger.mjs --write` from every package's `rating:` block. Do not edit by hand:",
    'the `--check` gate fails when this file or a package README section is stale. Field meaning: core ADR-170 D2, D9, D10.',
    '',
    ...ruleText(),
    '',
    `Coverage: ${packages.length} packages, ${packages.length - unrated.length} rated, ${unrated.length} unrated.`,
    '',
    '| Package | Memory MiB low / high (basis) | Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const entry of packages) {
    const head = `| ${cell(entry.name)} | ${entry.rating ? memoryText(entry.rating) : 'unrated'} |`;
    if (!entry.rating) lines.push(`${head} unrated | | | | | | |`);
    else if (entry.rating.features.length === 0) lines.push(`${head} none (T0, no model in the loop) | | | | | | |`);
    else for (const feature of entry.rating.features) lines.push(`${head} ${featureCells(feature)} |`);
  }
  if (unrated.length) lines.push('', `Unrated: ${unrated.join(', ')}.`);
  return `${lines.join('\n')}\n`;
}

/** @description The generated README section for one rated package. */
export function renderSection(entry) {
  const lines = [
    SECTION_START,
    '## Models and requirements',
    '',
    "Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.",
    'The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.',
    '',
    `Container memory, MiB low / high: **${memoryText(entry.rating)}**.`,
    '',
  ];
  if (entry.rating.features.length === 0) {
    lines.push('No model in the loop (T0): every feature of this application is deterministic code.');
  } else {
    lines.push('| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |', '|---|---|---|---|---|---|---|');
    for (const feature of entry.rating.features) lines.push(`| ${featureCells(feature)} |`);
  }
  lines.push(SECTION_END);
  return lines.join('\n');
}

/** @description README text with the section replaced or appended (or removed when unrated). */
export function withSection(readme, entry) {
  const text = readme.replace(/\r\n/g, '\n');
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END);
  const before = start === -1 ? text.replace(/\s+$/, '') : text.slice(0, start).replace(/\s+$/, '');
  const after = start === -1 || end === -1 ? '' : text.slice(end + SECTION_END.length).replace(/^\s+/, '');
  if (!entry.rating) return `${[before, after].filter(Boolean).join('\n\n')}\n`;
  return `${[before, renderSection(entry), after].filter(Boolean).join('\n\n')}\n`;
}

function normalise(text) {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
}

/**
 * @description Regenerate or check the ledger and README sections.
 * @param {{mode: 'write'|'check', allowUnrated?: boolean, root?: string}} options - What to do.
 * @returns {string[]} Problems found (empty = pass).
 */
export function run({ mode, allowUnrated = false, root = REPOSITORY_ROOT }) {
  const { packages, problems } = collect(root);
  // A malformed block reads as "no rating"; writing now would strip that package's README section.
  if (mode === 'write' && problems.length) return problems;
  const ledgerPath = path.join(root, LEDGER_FILE);
  const ledger = renderLedger(packages);
  for (const entry of packages) {
    const readmePath = path.join(root, entry.directory, 'README.md');
    const exists = fs.existsSync(readmePath);
    const current = exists ? fs.readFileSync(readmePath, 'utf8') : `# ${entry.displayName}\n`;
    const next = withSection(current, entry);
    if (mode === 'write' && (entry.rating || exists) && normalise(current) !== normalise(next)) fs.writeFileSync(readmePath, next, 'utf8');
    if (mode === 'check' && entry.rating && (!exists || normalise(current) !== normalise(next))) problems.push(`${entry.directory}/README.md rating section is stale; run node scripts/ai-usage-ledger.mjs --write`);
    if (mode === 'check' && !entry.rating && exists && current.includes(SECTION_START)) problems.push(`${entry.directory}/README.md carries a rating section but the manifest has no rating`);
  }
  if (mode === 'write') fs.writeFileSync(ledgerPath, ledger, 'utf8');
  if (mode === 'check') {
    const committed = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : '';
    if (normalise(committed) !== normalise(ledger)) problems.push(`${LEDGER_FILE} is stale; run node scripts/ai-usage-ledger.mjs --write`);
    const unrated = packages.filter((entry) => !entry.rated).map((entry) => entry.directory);
    if (unrated.length && !allowUnrated) problems.push(`unrated package(s): ${unrated.join(', ')}`);
  }
  return problems;
}

function main(argv) {
  const mode = argv.includes('--write') ? 'write' : argv.includes('--check') ? 'check' : null;
  if (!mode) {
    console.error('usage: node scripts/ai-usage-ledger.mjs --write | --check [--allow-unrated]');
    return 2;
  }
  const problems = run({ mode, allowUnrated: argv.includes('--allow-unrated') });
  for (const problem of problems) console.error(`ai-usage-ledger: ${problem}`);
  if (problems.length) return 1;
  console.log(`ai-usage-ledger: ${mode === 'write' ? 'wrote' : 'checked'} ${LEDGER_FILE} and package README sections`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
