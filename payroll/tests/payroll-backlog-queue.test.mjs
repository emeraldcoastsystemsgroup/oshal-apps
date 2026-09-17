/**
 * The package's deferred-work queue is a FILE, and the README points at it.
 *
 * This suite is not about arithmetic. It guards the handoff itself: the payroll
 * queue used to live in the core repository's docs/BACKLOG.md as sixteen
 * numbered items, was removed from there when the work was handed to the
 * package, and never arrived — leaving README.md telling the reader to "see the
 * backlog" with no backlog to see, and ADR-123 citing "backlog item 12",
 * "Item 15" and "Item 16" by numbers that resolved to nothing.
 *
 * So the assertions cross exactly that boundary and read the SHIPPED files off
 * disk (README.md, BACKLOG.md and every relative link they make), rather than a
 * fixture:
 *
 *   - the queue exists, and its items are numbered 1..16 with no gap, so the
 *     ADR's item references land on the items they were written about;
 *   - every item declares a status, and every item that is not finished states
 *     a done-when, so "deferred" never degrades into "forgotten";
 *   - every subject the core handoff entry named is actually in the queue;
 *   - no paragraph of README.md mentions the backlog without linking to it —
 *     the dangling-reference defect this guard exists for;
 *   - every relative link either file makes resolves to a real path.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial — guard the package-owned deferred-work queue: contiguous 1..16 numbering for the ADR's citations, a status per item, a done-when for every unfinished item, coverage of every handed-off subject, linked README references, and resolvable relative links.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG_PATH = path.join(PACKAGE_DIR, 'BACKLOG.md');
const README_PATH = path.join(PACKAGE_DIR, 'README.md');

/** Statuses an item may declare. Anything else is a typo, not a state. */
const STATUSES = ['SHIPPED', 'PARTLY SHIPPED', 'OPEN', 'REFUSED', 'HUMAN TASK'];

/** Items that still owe work must say when they are done. SHIPPED ones are done. */
const FINISHED = new Set(['SHIPPED']);

/**
 * The subjects the core handoff entry named, each pinned to a token that only a
 * real treatment of it would contain. A queue missing any of them is a queue
 * that quietly dropped part of the handoff.
 */
const REQUIRED_SUBJECTS = [
  ['cited state withholding tables', /KNOWN_UNSUPPORTED/],
  ['local and city taxes, disability and paid-leave', /Act 32|PFML|SDI/],
  ['per-workweek overtime', /29 CFR 778\.104/],
  ['protected identifiers', /\bSSN\b/],
  ['employee isolation', /self-service/i],
  ['overpayment repayment across tax years', /claim-of-right|W-2c/],
  ['garnishment priority', /\bCCPA\b/],
  ['deposit schedule rules', /semiweekly/i],
  ['benefits and accruals', /\bPTO\b/],
  ['payment traces', /trace/i],
  ['verified EFW2 for tax year 2026', /26efw2\.pdf/i],
  ['enrolled filing and payment rails', /\bEFTPS\b/],
];

const backlogExists = existsSync(BACKLOG_PATH);
const backlog = backlogExists ? readFileSync(BACKLOG_PATH, 'utf8') : '';
const readme = readFileSync(README_PATH, 'utf8');

/**
 * Split the queue into items on its numbered `## N. Title` headings.
 *
 * @description The heading number is the handle ADR-123 cites, so it is parsed
 * rather than assumed; the body runs to the next numbered heading or EOF.
 * @param {string} text - The backlog markdown.
 * @returns {{ number: number, title: string, body: string }[]} Items in file order.
 */
function parseItems(text) {
  const heading = /^## (\d+)\.\s+(.+)$/gm;
  const found = [];
  let match = heading.exec(text);
  while (match !== null) {
    const start = match.index + match[0].length;
    const next = heading.exec(text);
    found.push({
      number: Number(match[1]),
      title: match[2].trim(),
      body: text.slice(start, next === null ? text.length : next.index),
    });
    match = next;
  }
  return found;
}

/**
 * Paragraphs of a markdown file, so a rule about a mention survives rewrapping.
 *
 * @description Line-based rules break the moment someone reflows a sentence
 * across the 100-column margin this repository wraps at. HTML comments, code
 * (fenced and inline) and heading lines are removed first: a change-log comment,
 * a file name in backticks and a section title are not references a reader can
 * follow, and treating them as such would make the rule fire on the name of the
 * guard file itself.
 * @param {string} text - Markdown source.
 * @returns {string[]} Blank-line separated prose blocks.
 */
function paragraphs(text) {
  const prose = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^#{1,6} .*$/gm, '');
  return prose.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

/**
 * Relative link targets a markdown file points at, ignoring URLs and anchors.
 *
 * @param {string} text - Markdown source.
 * @returns {string[]} Repository-relative paths, de-duplicated.
 */
function relativeLinks(text) {
  const out = new Set();
  const link = /\]\(([^)\s]+)\)/g;
  let match = link.exec(text);
  while (match !== null) {
    const target = match[1].split('#')[0];
    if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('/')) out.add(target);
    match = link.exec(text);
  }
  return [...out];
}

test('the package owns a deferred-work queue file', () => {
  assert.equal(
    backlogExists,
    true,
    'payroll/BACKLOG.md is missing: README.md and ADR-123 both refer to a package backlog, so it has to exist here',
  );
  assert.ok(backlog.length > 0, 'payroll/BACKLOG.md is empty');
});

test('items are numbered 1..16 with no gap, because ADR-123 cites them by number', () => {
  const items = parseItems(backlog);
  assert.ok(items.length > 0, 'no `## N. Title` items found in payroll/BACKLOG.md');
  const numbers = items.map((item) => item.number);
  const expected = Array.from({ length: 16 }, (_, index) => index + 1);
  assert.deepEqual(
    numbers,
    expected,
    `items must run 1..16 in order so ADR-123's "backlog item 12", "Item 15" and "Item 16" resolve; found ${numbers.join(', ')}`,
  );
});

test('every item declares a status, and every unfinished item states a done-when', () => {
  const items = parseItems(backlog);
  assert.ok(items.length > 0, 'no `## N. Title` items found in payroll/BACKLOG.md — this check must never pass vacuously');
  for (const item of items) {
    const status = /^-\s+\*\*Status:\*\*\s+(.+)$/m.exec(item.body);
    assert.ok(status, `item ${item.number} (${item.title}) has no "- **Status:**" line`);
    const value = status[1].trim();
    const known = STATUSES.find((candidate) => value.startsWith(candidate));
    assert.ok(known, `item ${item.number} declares an unknown status "${value}" (expected one of ${STATUSES.join(', ')})`);
    if (!FINISHED.has(known)) {
      assert.match(
        item.body,
        /\*\*Done when[^*]*:\*\*/,
        `item ${item.number} (${item.title}) is ${known} and must state a done-when`,
      );
    }
  }
});

test('every subject the core handoff named is in the queue', () => {
  const missing = REQUIRED_SUBJECTS.filter(([, pattern]) => !pattern.test(backlog)).map(([name]) => name);
  assert.deepEqual(missing, [], `payroll/BACKLOG.md does not cover: ${missing.join('; ')}`);
});

test('the queue points back at the decision record that cites it', () => {
  assert.match(backlog, /123-payroll-app\.md/, 'payroll/BACKLOG.md must link ADR-123, whose item numbers it carries');
});

test('no README paragraph mentions the backlog without linking to it', () => {
  const offenders = paragraphs(readme)
    .filter((block) => /backlog/i.test(block))
    .filter((block) => !/\]\(BACKLOG\.md\)/.test(block));
  assert.deepEqual(
    offenders.map((block) => block.split('\n')[0]),
    [],
    'a README paragraph refers to "the backlog" without a link to BACKLOG.md — that dangling reference is the defect this guard exists for',
  );
});

test('every relative link in the README and the queue resolves on disk', () => {
  const broken = [];
  for (const [label, text] of [['README.md', readme], ['BACKLOG.md', backlog]]) {
    for (const target of relativeLinks(text)) {
      if (!existsSync(path.join(PACKAGE_DIR, target))) broken.push(`${label} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], `broken relative links: ${broken.join(', ')}`);
});
