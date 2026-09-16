/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation proof for the attribution guard: every rule goes RED on a deliberate fixture, and the product's own vocabulary stays GREEN. Both halves matter. A guard nobody can trip is theatre, and a guard that flags the harness type, the env var, the model id in a persona or the town of Claude, Texas would be switched off within a day - which is how this directive went unenforced here in the first place. Every attribution literal below is assembled from fragments so this file does not itself carry the shape it detects.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findAttribution, findInText, formatFindings } from './check-no-model-attribution.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @description Build a throwaway tree (no .git, so the directory-walk path is exercised too).
 * @param files - Map of root-relative path to content.
 * @returns The fixture directory.
 */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'no-model-attribution-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

/** @description Run a fixture through the real scanner and clean up. */
function scan(files) {
  const dir = fixture(files);
  try {
    return findAttribution(dir).map((hit) => `${hit.file}:${hit.rule}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TRAILER = ['Co-Authored-By', ': Some Model <noreply@', 'anthropic.com>'].join('');
// Split so that no single line of this file carries the shape the toolFooter rule matches -
// this spec is a tracked file and the guard reads it like any other.
const FOOTER = ['Generat', 'ed with [Claude Code](https://example.invalid/tool)'].join('');

test('a co-author trailer naming the vendor is refused', () => {
  assert.deepEqual(scan({ 'PR_BODY.md': `fix: wire the importer\n\n${TRAILER}\n` }), ['PR_BODY.md:trailer']);
});

test('the vendor no-reply address alone is refused', () => {
  const line = ['contact: noreply@', 'anthropic.com'].join('');
  assert.deepEqual(scan({ 'notes.txt': `${line}\n` }), ['notes.txt:vendorNoReply']);
});

test('a generated-with model-tool footer is refused', () => {
  assert.deepEqual(scan({ 'PR_BODY.md': `## Summary\n\nfix\n\n${FOOTER}\n` }), ['PR_BODY.md:toolFooter']);
});

test('a Change Log AUTHOR column naming a model is refused', () => {
  const row = [' * 2026-06-27          | Claude', ' Opus   | Brand CLI\n'].join('');
  const header = ' * CHANGE LOG\n * SEQ                 | AUTHOR        | DESCRIPTION\n';
  assert.deepEqual(scan({ 'tool.js': `/*\n${header}${row} */\n` }), ['tool.js:changeLogAuthor']);
});

test('a coordination-log entry whose author slot names a model is refused', () => {
  const heading = ['## claude', '-opus-5 career-surfaces - 2026-08-11 - CLAIM\n'].join('');
  const bracketed = ['[2026-09-14 UTC] claude', ' (opus5) RELEASE: docs only\n'].join('');
  assert.deepEqual(scan({ 'COLLABORATE.md': heading + bracketed }), [
    'COLLABORATE.md:logByline',
    'COLLABORATE.md:logByline',
  ]);
});

test('a coordination-log byline parenthetical naming a model is refused', () => {
  const heading = ['### 2026-07-24 - @apply-off (Claude', ' Fable) - career-hunter: opt-in\n'].join('');
  const lane = ['## 2026-09-14 - LANE D (Claude', ' Opus 5, backlog sweep) - CLAIM\n'].join('');
  assert.deepEqual(scan({ 'COLLABORATE.md': heading + lane }), [
    'COLLABORATE.md:logBylineParenthetical',
    'COLLABORATE.md:logBylineParenthetical',
  ]);
});

test('the same byline outside a coordination log is not a hit (a leading # is a comment there)', () => {
  const comment = ['#   2. your Claude', ' Code login (OAuth token in ~/.claude/.credentials.json)\n'].join('');
  assert.deepEqual(scan({ 'engine/config.py': comment }), []);
});

test('the product’s own vocabulary stays green', () => {
  const vocabulary = [
    'harnessType: claude-code                       # a real harness type in this product',
    'CLAUDE_CODE_MODEL=claude-sonnet-4-6            # a real model id in persona/manifest config',
    'Set ANTHROPIC_API_KEY to use your own key.     # a real env var',
    'See CLAUDE.md for the repo rules.              # a filename',
    'The tutor uses Claude; an Anthropic sign-in works too.',
    'TX\tclaude\t35.1074\t-101.3629                 # Claude, Texas',
    'HI\thaiku\t20.9209\t-156.3019                  # Haiku, Hawaii',
    'const anthropic = process.env.OSHAL_CRED_ANTHROPIC;',
    'if (anthropic) env.ANTHROPIC_API_KEY = anthropic;',
    '| **An Anthropic API key** (or Claude sign-in) | The tutor needs it | required |',
    'Fallback: check for thinking blocks (Claude Sonnet 4.5 extended thinking)',
    'Provider: plan · Anthropic (claude-opus-4-1)',
    'Anthropic PBC filed an S-1.',
  ].join('\n');
  assert.deepEqual(scan({ 'vocabulary.md': `${vocabulary}\n` }), []);
});

test('the sanctioned house co-author identity is not attribution', () => {
  const house = ['Co-authored-by', ': oshal maintainers <maintainer@emeraldcoastsystemsgroup.com>'].join('');
  assert.deepEqual(scan({ 'PR_BODY.md': `feat: land the guard\n\n${house}\n` }), []);
});

test('a Change Log row authored by the house identity is not attribution', () => {
  const row = ' * 1 | maintainer@emeraldcoastsystemsgroup.com   | Claude Code harness adapter wiring\n';
  assert.deepEqual(scan({ 'adapter.ts': `/*\n * CHANGE LOG\n${row} */\n` }), []);
});

test('rules are evaluated per line, so one file reports every offending line', () => {
  const text = `${TRAILER}\nunrelated\n${FOOTER}\n`;
  assert.deepEqual(findInText('NOTES.md', text).map((hit) => hit.rule), ['trailer', 'toolFooter']);
});

test('this repository carries no model attribution', () => {
  const findings = findAttribution(REPO_ROOT);
  const perFile = new Map();
  for (const hit of findings) perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1);
  // Asserted per file rather than per line: a whole-tree failure must stay readable in a CI log,
  // and the offending lines are printed underneath it by formatFindings.
  assert.deepEqual(
    [...perFile].sort((a, b) => b[1] - a[1]).map(([file, count]) => `${file}: ${count} line(s)`),
    [],
    `\n${formatFindings(findings)}\n`,
  );
});
