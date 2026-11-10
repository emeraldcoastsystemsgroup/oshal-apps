/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | No tracked file names the household (open-work audit 2026-11-10): Phone & Device Control's tests, Ambient Recall's default profile and LoRA Studio's callback default carried the house's LAN addresses, its street address and the owner's phone number. Every tracked text file is scanned for the identifiers in scripts/security/house-identifiers.sha256, which holds salted digests in the kernel's scheme (oshal-kernel ops/test_no_personal_data.py: same salt, the lowercase letter-and-digit runs of the text), so neither this file nor the list names what it guards. A finding names the file, the line and the kind, never the text. The one file exempt is scripts/build-store-public.sh, the public-cut identifier gate, which must name what it refuses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HOUSE_SCAN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(dirname(fileURLToPath(import.meta.url)), 'security', 'house-identifiers.sha256');
const SALT = Buffer.from('oshal:personal-data:v1');
const LINE = /^([0-9a-f]{64})\s+(\d+)\s+([0-9a-f]{4})\s+(\S.*)$/;
const EXEMPT = new Set(['scripts/build-store-public.sh']);
const MAX_BYTES = 8 * 1024 * 1024;

/** @description The lowercase letter-and-digit runs of a text, with where each starts. @param {string} text Text. @returns {Array<{word:string,at:number}>} Runs. */
function runs(text) {
  return [...text.toLowerCase().matchAll(/[a-z0-9]+/g)].map((m) => ({ word: m[0], at: m.index }));
}

/** @description The salted digest of a word sequence. @param {string[]} words Words. @returns {string} Hex. */
function digest(words) {
  return createHash('sha256').update(Buffer.concat([SALT, Buffer.from([0x1f]), Buffer.from(words.join(' '))])).digest('hex');
}

const anchors = new Map();
/** @description The 16-bit filter value of an identifier's first word. @param {string} word Word. @returns {string} Four hex digits. */
function anchor(word) {
  if (!anchors.has(word)) {
    anchors.set(word, createHash('sha256').update(Buffer.concat([SALT, Buffer.from([0x1e]), Buffer.from(word)])).digest('hex').slice(0, 4));
  }
  return anchors.get(word);
}

/** @description Every entry of a digest list; comments and blank lines skipped. @param {string} text List. @returns {Array<{digest:string,count:number,anchor:string,kind:string}>} Entries. */
export function parseList(text) {
  return text.split('\n').flatMap((raw, index) => {
    if (!raw.trim() || raw.startsWith('#')) return [];
    const m = LINE.exec(raw);
    if (!m) throw new Error(`house-identifiers.sha256 line ${index + 1} is not '<digest> <count> <anchor> <kind>'`);
    return [{ digest: m[1], count: Number(m[2]), anchor: m[3], kind: m[4].trim() }];
  });
}

/** @description (line, kind) for each listed identifier in a text. @param {string} text Text. @param {Array} entries Entries. @returns {Array<{line:number,kind:string}>} Findings. */
export function scanText(text, entries) {
  const byAnchor = new Map();
  for (const entry of entries) byAnchor.set(entry.anchor, [...(byAnchor.get(entry.anchor) || []), entry]);
  const sequence = runs(text);
  const findings = [];
  for (let i = 0; i < sequence.length; i += 1) {
    const wanted = byAnchor.get(anchor(sequence[i].word));
    if (!wanted) continue;
    for (const entry of wanted) {
      const window = sequence.slice(i, i + entry.count).map((r) => r.word);
      if (window.length === entry.count && digest(window) === entry.digest) {
        findings.push({ line: text.slice(0, sequence[i].at).split('\n').length, kind: entry.kind });
      }
    }
  }
  return findings;
}

/** @description Every finding in the tracked text files as 'path:line: kind'. @param {string} root Repository. @param {Array} entries Entries. @returns {{findings:string[],scanned:number}} Result. */
export function scanRepository(root, entries) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    if (EXEMPT.has(file)) continue;
    let bytes;
    try {
      if (statSync(join(root, file)).size > MAX_BYTES) continue;
      bytes = readFileSync(join(root, file));
    } catch { continue; }
    if (bytes.includes(0)) continue;
    scanned += 1;
    for (const { line, kind } of scanText(bytes.toString('utf8'), entries)) findings.push(`${file}:${line}: ${kind}`);
  }
  return { findings, scanned };
}

const entries = parseList(readFileSync(LIST, 'utf8'));

test('no tracked file names the household', () => {
  const { findings, scanned } = scanRepository(ROOT, entries);
  assert.ok(scanned > 1000, `scanned only ${scanned} tracked text files`);
  assert.deepEqual(findings, [], `house identifiers in tracked files:\n${findings.join('\n')}`);
});

test('the list is well formed and holds the addresses, the street address and the phone number', () => {
  assert.ok(entries.length >= 5, `${entries.length} entries`);
  assert.equal(entries.filter((e) => e.kind.startsWith('a house LAN address')).length, 3);
  for (const kind of ["a person's street address", "a person's phone number"]) assert.ok(entries.some((e) => e.kind === kind), kind);
  assert.throws(() => parseList('not a digest line\n'), /is not '<digest> <count> <anchor> <kind>'/);
});

test('an identifier is found whatever its case, punctuation or spacing, and the finding names the kind only', () => {
  const words = ['10', '0', '0', '99'];
  const sample = [{ digest: digest(words), count: 4, anchor: anchor('10'), kind: 'a sample address' }];
  for (const text of ['host 10.0.0.99:5555', 'HOST 10-0-0-99', 'x\n\n10 0 0 99']) {
    const found = scanText(text, sample);
    assert.equal(found.length, 1, text);
    assert.equal(found[0].kind, 'a sample address');
    assert.ok(!JSON.stringify(found).includes('99'), 'the finding carries no text');
  }
  assert.equal(scanText('x\n\n10 0 0 99', sample)[0].line, 3);
  assert.deepEqual(scanText('10.0.0.990 and 110.0.0.99', sample), [], 'neighbouring numbers are not a match');
});
