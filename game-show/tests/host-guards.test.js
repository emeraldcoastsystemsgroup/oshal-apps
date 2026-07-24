/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 03:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Regression guards for two defects found by LIVE play, not unit tests: (1) the host answering a "spoken" mode with a full markdown document (headings/tables/bullets/emoji) that would wreck the caption bar and blow the TTS limit; (2) host data replies needing tolerant JSON extraction. Plain `node tests/host-guards.test.js`.
 */

'use strict';

const { spokenText, extractJson, SPOKEN_CONSTRAINT } = require('../lib/host-service');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

// ── The ACTUAL reply that broke the caption bar in live play (2026-07-22) ────
const REAL_BAD_OUTRO = [
  '# 🎉 THAT\'S A WRAP, FOLKS! 🎉',
  '',
  '---',
  '',
  '*The lights swirl, the confetti drops!*',
  '',
  'Well, what a morning we had here on **Family Feud**!',
  '',
  '📱 **Check their phone** — 28 points up top!',
  '🚽 **Use the bathroom** — 22!',
  '',
  '| | Team A | Team B |',
  '|---|---|---|',
  '| **Final Score** | 0 | **50** 🏆 |',
  '',
  '### 👑 TEAM B — YOU ARE TODAY\'S CHAMPIONS! 👑',
  '',
  '> "We asked 100 people... survey SAID!"',
  '',
  '1. Good night everybody!',
].join('\n');

const cleaned = spokenText(REAL_BAD_OUTRO);
check(cleaned.length > 0, 'a markdown-heavy reply still yields a usable line');
check(cleaned.length <= 320, 'the spoken line is capped for the caption bar and TTS');
check(!/[#*_`|]/.test(cleaned), 'markdown syntax is stripped (no # * _ ` |)');
check(cleaned.indexOf('\n') < 0, 'the spoken line is a single line');
check(!/^\s*[-*+]\s/m.test(cleaned) && !/^\s*\d+[.)]\s/m.test(cleaned), 'bullet and numbered list markers are gone');
check(cleaned.indexOf('---') < 0, 'horizontal rules are gone');
check(cleaned.indexOf('THAT\'S A WRAP') >= 0, 'the actual words survive the sanitizing');

// Well-behaved replies must pass through essentially untouched.
const good = 'Team B steals it at the buzzer — what a finish!';
check(spokenText(good) === good, 'a clean one-liner is left alone');
check(spokenText('') === '', 'empty input stays empty');
check(spokenText(null) === '', 'null input is safe');

// Sentence-boundary truncation, not a mid-word chop.
const long = ('Sentence one is here. ').repeat(40);
const cut = spokenText(long);
check(cut.length <= 320 && /\.$/.test(cut), 'over-long text is cut on a sentence boundary');

// The prompt-side half of the belt-and-braces fix.
check(/no markdown/i.test(SPOKEN_CONSTRAINT) && /emoji/i.test(SPOKEN_CONSTRAINT), 'the spoken constraint forbids markdown and emoji');
check(/one or two/i.test(SPOKEN_CONSTRAINT), 'the spoken constraint demands brevity');

// ── Host data replies: tolerant JSON extraction ─────────────────────────────
check(extractJson('```json\n{"a":1}\n```').a === 1, 'fenced json is extracted');
check(extractJson('sure! {"a":2} there you go').a === 2, 'bare json is extracted from prose');
check(extractJson('{"nested":{"deep":[1,2]},"x":3}').x === 3, 'balanced braces survive nesting');
check(extractJson('no json at all') === null, 'a reply with no json returns null');
check(extractJson('{"broken":') === null, 'malformed json returns null rather than throwing');
check(extractJson('{"s":"a } brace in a string","k":9}').k === 9, 'braces inside strings do not end the scan');

if (failures) { console.error(`\n✗ ${failures}/${checks} host guard checks failed`); process.exit(1); }
console.log(`✓ Host output guards hold — ${checks} checks green (spoken-line sanitizing, tolerant json)`);
