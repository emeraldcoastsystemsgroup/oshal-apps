#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Writes tools/prep-media/manifest.json from what was filmed: the teacher, the voice take and its checks, the length, the transcript and a digest of the words, so a guard can catch a video that no longer matches its script
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { describe, loadAll, scriptDigest, spokenWords } = require('./lessons-json.cjs');

const MEDIA = path.join(__dirname, '../../tools/prep-media');
const VIDEOS = path.join(__dirname, '../../.videos');
const TAKES = path.join(__dirname, 'takes');

/**
 * @description One lesson's manifest entry, measured from the actual video file.
 * @param {string} id Lesson id.
 * @returns {object} The entry.
 */
function entry(id) {
  const lesson = describe(id);
  const timing = JSON.parse(fs.readFileSync(path.join(TAKES, `${id}.timing.json`), 'utf8'));
  const video = path.join(VIDEOS, `${id}.mp4`);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', video], { encoding: 'utf8' }));
  const chapters = [];
  for (const beat of lesson.beats) {
    if (beat.page || !chapters.length) chapters.push({ label: beat.page || '', text: [] });
    chapters[chapters.length - 1].text.push(spokenWords(beat.say).join(' '));
  }
  return {
    teacher: lesson.teacher.name,
    seconds: Math.round(Number(info.format.duration)),
    bytes: fs.statSync(video).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'),
    script: scriptDigest(lesson),
    voice: { engine: timing.voice.engine, model: timing.voice.model, voice: timing.voice.voice },
    checks: { wordMatch: timing.check.wordMatch, pitchSpreadSemitones: timing.check.pitchSpreadSemitones },
    transcript: chapters.map((c) => ({ label: c.label, text: c.text.join(' ') })),
  };
}

const lessons = {};
for (const id of Object.keys(loadAll().lessons).sort()) lessons[id] = entry(id);
fs.writeFileSync(path.join(MEDIA, 'manifest.json'), JSON.stringify({ lessons }, null, 1) + '\n');
console.log(`${Object.keys(lessons).length} lessons, ${(Object.values(lessons).reduce((a, l) => a + l.bytes, 0) / 1048576).toFixed(1)} MB`);
