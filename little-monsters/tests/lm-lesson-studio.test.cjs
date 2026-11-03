/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Lesson scripts against the catalog and the real stage in Chromium: every lesson has a monster teacher, a your-turn, correct arithmetic, moving parts and highlights, and no writing off the board. Regression: the lesson videos were still text cards with nothing moving.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (playwright, chromium). It fails, never skips, without them.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PKG = path.resolve(__dirname, '..');
const STUDIO = path.join(PKG, 'scripts/lesson-studio');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const { loadAll, describe, spokenWords } = require(path.join(STUDIO, 'lessons-json.cjs'));

const catalog = JSON.parse(fs.readFileSync(path.join(PKG, 'data/test-prep/catalog.json'), 'utf8'));
const { lessons, teachers } = loadAll();
const CHROME_ARGS = ['--font-render-hinting=none', '--allow-file-access-from-files', '--disable-lcd-text'];

let browser;
test.before(async () => { browser = await chromium.launch({ args: CHROME_ARGS }); });
test.after(async () => { await browser.close(); });

/** Open the stage with a lesson script loaded. */
async function stageWith(scriptPath, content) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(pathToFileURL(path.join(STUDIO, 'stage/stage.html')).href);
  await page.addScriptTag({ path: path.join(STUDIO, 'lessons/teachers.js') });
  await page.addScriptTag(content ? { content } : { path: scriptPath });
  return page;
}

/** A small hand-written timing for fixture lessons. */
function fixtureTiming(words, cues) {
  const beatWords = words.map((w, i) => ({ w, raw: w, t0: 1 + i * 0.4, t1: 1.35 + i * 0.4 }));
  return { fps: 30, duration: 6, mouthO: new Array(200).fill(40), mouthC: new Array(200).fill(50), beats: [{ start: 1, end: beatWords.at(-1).t1, cues, words: beatWords }] };
}

test('every catalog lesson has a script, and no script lacks a catalog lesson', () => {
  assert.deepEqual(Object.keys(lessons).sort(), catalog.lessons.map((l) => l.id).sort());
});

test('a monster from the app\'s own roster teaches each subject', () => {
  const rewards = fs.readFileSync(path.join(PKG, 'routes/education-rewards-routes.js'), 'utf8');
  for (const teacher of Object.values(teachers)) assert.match(rewards, new RegExp(`name: '${teacher.name}'`), teacher.name);
  const subjectOf = { math: 'pinky', english: 'bluebold', reading: 'tealy', science: 'sprout' };
  for (const l of catalog.lessons) assert.equal(lessons[l.id].teacher, subjectOf[l.domain], l.id);
});

test('spoken lines are spelled as spoken, and each lesson ends at the button under the video', () => {
  for (const id of Object.keys(lessons)) {
    const said = describe(id).beats.map((b) => spokenWords(b.say).join(' '));
    for (const line of said) assert.doesNotMatch(line, /[0-9%$=+×÷<>_]/, `${id}: ${line}`);
    assert.match(said.at(-1), /Now hit Try this skill/, id);
  }
  assert.match(fs.readFileSync(path.join(PKG, 'tools/test-prep.js'), 'utf8'), />Try this skill</, 'the button the lessons name exists');
});

test('each lesson stops for the student to try it', () => {
  for (const [id, lesson] of Object.entries(lessons)) {
    const turn = lesson.beats.find((b) => b.page === 'Your turn');
    assert.ok(turn, `${id} has a your-turn page`);
    assert.ok(turn.pause >= 4, `${id} leaves time to think`);
  }
});

test('every number a math lesson states is correct', () => {
  for (const l of catalog.lessons) {
    const facts = lessons[l.id].facts || [];
    if (l.domain === 'math' || l.id === 'science-data') assert.ok(facts.length >= 3, `${l.id} lists its arithmetic`);
    for (const [expression, expected] of facts) {
      const value = new Function(`return (${expression});`)();
      assert.ok(Math.abs(value - expected) < 1e-9, `${l.id}: ${expression} is ${value}, not ${expected}`);
    }
  }
});

for (const id of Object.keys(lessons)) {
  test(`${id} builds on the real stage, moves, highlights and stays on the board`, async () => {
    const timing = JSON.parse(fs.readFileSync(path.join(STUDIO, 'takes', `${id}.timing.json`), 'utf8'));
    const page = await stageWith(path.join(STUDIO, `lessons/${id}.js`));
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const built = await page.evaluate(([name, t]) => window.LessonStudio.build(name, t), [id, timing]);
    assert.ok(built.movingParts >= 1, `${id} has no moving demonstration`);
    assert.ok(built.highlights >= 1, `${id} never highlights anything`);
    for (const beat of timing.beats) {
      const problems = await page.evaluate((t) => window.LessonStudio.audit(t), beat.end + 0.2);
      const hard = problems.filter((p) => p.kind !== 'overlap');
      assert.deepEqual(hard, [], `${id} at ${beat.end}`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('negative control: writing off the board is caught', async () => {
  const page = await stageWith(null, `LessonStudio.define({ id: 'fixture', teacher: 'pinky', title: 'x', beats: [{ say: 'one two', run(s, c) { s.text('far away', { x: 4000, y: 100, size: 80, at: c.a, dur: 0.1 }); s.text('tiny', { x: 300, y: 300, size: 20, at: c.a, dur: 0.1 }); } }] });`);
  await page.evaluate((t) => window.LessonStudio.build('fixture', t), fixtureTiming(['one', 'two'], { a: 1 }));
  const kinds = (await page.evaluate(() => window.LessonStudio.audit(3))).map((p) => p.kind);
  assert.ok(kinds.includes('off-board'));
  assert.ok(kinds.includes('too-small'));
  await page.close();
});

test('negative control: a cue the script does not have stops the build', async () => {
  const page = await stageWith(null, `LessonStudio.define({ id: 'fixture', teacher: 'pinky', title: 'x', beats: [{ say: 'one two', run(s, c) { s.text('x', { at: c.nope }); } }] });`);
  await assert.rejects(page.evaluate((t) => window.LessonStudio.build('fixture', t), fixtureTiming(['one', 'two'], {})), /no cue \{nope\}/);
  await page.close();
});

test('negative control: a lesson of only words reports no moving parts', async () => {
  const page = await stageWith(null, `LessonStudio.define({ id: 'fixture', teacher: 'pinky', title: 'x', beats: [{ say: 'one two', run(s, c) { s.text('just words', { at: c.a, dur: 0.1 }); } }] });`);
  const built = await page.evaluate((t) => window.LessonStudio.build('fixture', t), fixtureTiming(['one', 'two'], { a: 1 }));
  assert.equal(built.movingParts, 0);
  assert.equal(built.highlights, 0);
  await page.close();
});
