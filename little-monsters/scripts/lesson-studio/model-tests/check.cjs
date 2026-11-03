#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Static house rules for one lesson script, the rules the lm-lesson-studio guard enforces, plus a scan of each beat's run function for cues and spoken words it asks for that the beat does not have, so every such error surfaces in one pass instead of one per build
 * 2   | maintainer@emeraldcoastsystemsgroup.com | A fact is evaluated only when it is plain arithmetic: a drafted lesson comes from a model, and its facts must not run as code
 *
 * Usage: check.cjs <studioDir> <id> <subject>   prints {ok, problems, warnings, stats}
 * subject is the catalog domain: math, english, reading or science.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const [studio, id, subject] = process.argv.slice(2);
const TEACHER_OF = { math: 'pinky', english: 'bluebold', reading: 'tealy', science: 'sprout' };
const RESERVED = ['start', 'end', 'index', 'spoken', 'word', 'from'];
const problems = [];
const warnings = [];

/**
 * @description Print the result and stop; every exit path reports the same shape.
 * @param {object} extra Fields to add, such as stats.
 * @returns {never} Exits the process.
 */
function out(extra = {}) {
  const unique = [...new Set(problems)];
  process.stdout.write(JSON.stringify({ ok: unique.length === 0, problems: unique, warnings, ...extra }));
  process.exit(0);
}

/**
 * @description The words of a say line as a listener hears them: no cue markers, no delivery tags.
 * @param {string} say A beat's say line.
 * @returns {string[]} Spoken words with their punctuation.
 */
function spokenWords(say) {
  return say.replace(/\[[^\]]*\]\s*/g, '').replace(/\{\w+\}/g, '').split(/\s+/).filter(Boolean);
}

/**
 * @description Cues and words a beat's run function asks for, compared with what the beat says.
 * @param {object} b The beat.
 * @param {number} i Its index.
 * @param {string[]} names The cue names in its say line.
 * @returns {void} Adds problems.
 */
function scanRun(b, i, names) {
  const src = String(b.run);
  const param = (src.match(/^[^(]*\(\s*[\w$]+\s*,\s*([\w$]+)/) || [])[1];
  if (!param) return;
  const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  const said = spokenWords(b.say).map(norm);
  const used = new Set([...src.matchAll(new RegExp(`\\b${param}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1]).filter((n) => !RESERVED.includes(n)));
  const missing = [...used].filter((n) => !names.includes(n));
  if (missing.length) problems.push(`beat ${i}: run uses ${missing.map((n) => `${param}.${n}`).join(', ')} but this beat's say has no such cue. Its cues are: ${names.length ? names.map((n) => `{${n}}`).join(' ') : '(none)'}`);
  for (const m of src.matchAll(new RegExp(`\\b${param}\\.word\\(\\s*(['"\`])(.*?)\\1\\s*(?:,\\s*(\\d+))?\\s*\\)`, 'g'))) {
    const nth = m[3] ? Number(m[3]) : 0;
    const count = said.filter((w) => w === norm(m[2])).length;
    if (/\s/.test(m[2].trim())) problems.push(`beat ${i}: ${param}.word('${m[2]}') asks for several words; ${param}.word takes ONE spoken word`);
    else if (count <= nth) problems.push(`beat ${i}: ${param}.word('${m[2]}'${m[3] ? ', ' + m[3] : ''}) needs "${m[2]}" spoken ${nth + 1} time(s) in this beat, but it is spoken ${count} time(s). This beat's spoken words: ${said.join(' ')}`);
  }
}

/**
 * @description The rules for one beat: spelled as spoken, valid unique cues, and the run function's references.
 * @param {object} b The beat.
 * @param {number} i Its index.
 * @returns {{words: number, cues: number}} Counts for the lesson totals.
 */
function checkBeat(b, i) {
  if (typeof b.say !== 'string' || !b.say.trim()) { problems.push(`beat ${i}: say must be a non-empty string`); return { words: 0, cues: 0 }; }
  if (typeof b.run !== 'function') problems.push(`beat ${i}: run(s, c, v) must be a function`);
  const spoken = spokenWords(b.say).join(' ');
  const bad = spoken.match(/[0-9%$=+×÷<>_]/g);
  if (bad) problems.push(`beat ${i}: say must be spelled exactly as spoken, with no digits or symbols; found ${JSON.stringify([...new Set(bad)].join(''))} in: "${spoken.slice(0, 160)}"`);
  const names = (b.say.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));
  for (const n of names) if (RESERVED.includes(n)) problems.push(`beat ${i}: the cue {${n}} is a reserved name (${RESERVED.join(', ')}); rename it`);
  const dup = names.filter((n, k) => names.indexOf(n) !== k);
  if (dup.length) problems.push(`beat ${i}: cue names must be unique within a beat; repeated: ${[...new Set(dup)].join(', ')}`);
  if (/\{\w+\}\s*$/.test(b.say.trim())) problems.push(`beat ${i}: a cue marker must come right before a spoken word, not at the end of the line`);
  if (typeof b.run === 'function') scanRun(b, i, names);
  return { words: spokenWords(b.say).length, cues: names.length };
}

/**
 * @description Lesson-level rules: the ending, the your-turn pause and, for math, correct arithmetic.
 * @param {object} lesson The lesson.
 * @returns {void} Adds problems.
 */
function checkLesson(lesson) {
  const last = lesson.beats.at(-1);
  if (last && typeof last.say === 'string' && !/Now hit Try this skill/.test(spokenWords(last.say).join(' '))) problems.push('the last beat must end the lesson at the button under the video: its say line must contain "Now hit Try this skill"');
  const turn = lesson.beats.find((b) => b.page === 'Your turn');
  if (!turn) problems.push("there must be a beat with page: 'Your turn' where the student tries a question");
  else if (!(turn.pause >= 4)) problems.push(`the 'Your turn' beat needs pause: 5 or so (at least 4 seconds of silence to think); it has ${turn.pause}`);
  if (subject !== 'math' && id !== 'science-data') return;
  const facts = lesson.facts || [];
  if (facts.length < 3) problems.push('a math lesson lists every number it states in facts: [[expression, value], ...] (at least 3)');
  for (const f of facts) {
    // A fact written by a model is evaluated only when it is plain arithmetic, never as code.
    if (!/^[\d\s.+\-*/()]+$/.test(String(f[0]))) { problems.push(`facts: ${JSON.stringify(f[0])} must be plain arithmetic: numbers, + - * / and parentheses`); continue; }
    try {
      const value = new Function(`return (${f[0]});`)();
      if (!(Math.abs(value - f[1]) < 1e-9)) problems.push(`facts: ${f[0]} is ${value}, not ${f[1]}; fix the arithmetic in the fact and wherever the lesson says or writes it`);
    } catch (err) { problems.push(`facts: ${JSON.stringify(f)} is not a valid JavaScript expression: ${err.message}`); }
  }
}

const studioObj = { lessons: {}, teachers: {}, define(lesson) { this.lessons[lesson.id] = lesson; } };
const ctx = vm.createContext({ LessonStudio: studioObj });
try {
  vm.runInContext(fs.readFileSync(path.join(studio, 'lessons/teachers.js'), 'utf8'), ctx, { filename: 'teachers.js' });
  vm.runInContext(fs.readFileSync(path.join(studio, `lessons/${id}.js`), 'utf8'), ctx, { filename: `${id}.js` });
} catch (err) {
  problems.push(`The file does not load: ${err.name}: ${err.message}`);
  out();
}
const lesson = studioObj.lessons[id];
if (!lesson) { problems.push(`The file never calls LessonStudio.define with id '${id}'. Ids defined: ${JSON.stringify(Object.keys(studioObj.lessons))}`); out(); }
if (lesson.teacher !== TEACHER_OF[subject]) problems.push(`teacher must be '${TEACHER_OF[subject]}' for a ${subject} lesson, not '${lesson.teacher}'`);
if (!Array.isArray(lesson.beats) || !lesson.beats.length) { problems.push('beats must be a non-empty array'); out(); }
let words = 0, cues = 0;
lesson.beats.forEach((b, i) => { const n = checkBeat(b, i); words += n.words; cues += n.cues; });
checkLesson(lesson);
if (words < 150) warnings.push(`only ${words} spoken words; aim for about 190 to 290`);
if (words > 330) warnings.push(`${words} spoken words is long; aim for about 190 to 290`);
out({ stats: { beats: lesson.beats.length, words, cues, pages: lesson.beats.filter((b) => b.page).map((b) => b.page) } });
