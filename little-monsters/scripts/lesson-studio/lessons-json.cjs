#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Reads the lesson scripts without a browser, so narration and the guards use the same words the stage films
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const LESSONS = path.join(__dirname, 'lessons');

/**
 * @description Evaluate every lesson script with a stand-in for the stage.
 * @returns {{teachers: object, lessons: object}} All teachers and lessons by id.
 */
function loadAll() {
  const studio = { lessons: {}, teachers: {}, define(lesson) { this.lessons[lesson.id] = lesson; } };
  const context = vm.createContext({ LessonStudio: studio });
  const files = fs.readdirSync(LESSONS).filter((f) => f.endsWith('.js')).sort((a, b) => (a === 'teachers.js' ? -1 : b === 'teachers.js' ? 1 : a.localeCompare(b)));
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(LESSONS, f), 'utf8'), context, { filename: f });
  return studio;
}

/**
 * @description One lesson in plain data: its teacher and the words of each beat.
 * @param {string} id Lesson id from the catalog.
 * @returns {object} Lesson data with no functions.
 */
function describe(id) {
  const { lessons, teachers } = loadAll();
  const lesson = lessons[id];
  if (!lesson) throw new Error('no script for lesson ' + id);
  const teacher = teachers[lesson.teacher];
  if (!teacher) throw new Error('no such teacher: ' + lesson.teacher);
  const beats = lesson.beats.map((b) => ({ say: b.say, page: b.page || null, gap: b.gap ?? null, pause: b.pause ?? null }));
  // Plain data from this realm: the scripts run in their own context, whose arrays compare unequal under strict assertions.
  return JSON.parse(JSON.stringify({ id, title: lesson.title, teacher: { ...teacher, accessory: undefined }, beats, facts: lesson.facts || [] }));
}

/**
 * @description The words of a beat as a listener hears them: no cue markers, no delivery tags.
 * @param {string} say A beat's say line.
 * @returns {string[]} The spoken words with their punctuation.
 */
function spokenWords(say) {
  return say.replace(/\[[^\]]*\]\s*/g, '').replace(/\{\w+\}/g, '').split(/\s+/).filter(Boolean);
}

/**
 * @description Digest of a lesson's spoken words, stored with its video so a stale video is caught.
 * @param {object} lesson A lesson from describe().
 * @returns {string} Hex SHA-256.
 */
function scriptDigest(lesson) {
  const words = lesson.beats.map((b) => spokenWords(b.say).join(' ')).join('\n');
  return crypto.createHash('sha256').update(words).digest('hex');
}

if (require.main === module) {
  const id = process.argv[2];
  if (id === '--ids') console.log(JSON.stringify(Object.keys(loadAll().lessons)));
  else process.stdout.write(JSON.stringify(describe(id)));
}

module.exports = { loadAll, describe, spokenWords, scriptDigest };
