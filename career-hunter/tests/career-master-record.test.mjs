/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The master record reader (lib/career-master-record.js, 1.51.0) over a made-up person's store written the way Career writes it: every bullet once under its role, every skill under its group, the history newest first with its dates (a Resume Studio save labelled, an unreadable line counted), Strengthen answers under their theme names, snapshot dates without opening a snapshot, the counts, the private writing notes on the record but never in the Markdown, nothing written on a read-only folder with the database opened immutable, a link or an oversized source refused before it is read, and no file of another person's folder touched.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the record and its file say Other experience, My résumé, Questions you answered and Improve it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.55.0: the page is named Improve my résumé, and the line about answers that could not be read says so.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { madeUpProfile, sqliteAdapter, treeState, writeStore } from './helpers/career-master-record-fixture.mjs';

const require = createRequire(import.meta.url);
const opened = [];
const originalLoad = Module._load;
Module._load = function withSqlite(request, ...rest) {
  if (request === 'better-sqlite3') return sqliteAdapter(opened);
  return originalLoad.call(this, request, ...rest);
};
let reader;
try { reader = require('../lib/career-master-record.js'); } finally { Module._load = originalLoad; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-master-record-'));
const gaps = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../engine/jobhunter/gaps.py');
const priorMount = process.env.OSHAL_CAREER_OWNER_MOUNT;
process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
after(() => {
  if (priorMount === undefined) delete process.env.OSHAL_CAREER_OWNER_MOUNT; else process.env.OSHAL_CAREER_OWNER_MOUNT = priorMount;
  fs.rmSync(root, { recursive: true, force: true });
});
const person = (name, options) => writeStore(path.join(root, name), options);
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
const between = (markdown, start, end) => markdown.slice(markdown.indexOf(start), end ? markdown.indexOf(end) : undefined);

test('every bullet once under its role, every skill under its group, history newest first with dates, and the counts', () => {
  const r = reader.readMasterRecord(person('alex'));
  assert.equal(r.present, true);
  assert.deepEqual(r.counts, {
    roles: 2, bullets: 5, roleSkills: 3, stories: 1, skills: 3, skillGroups: 2, competencies: 0, headlineOptions: 2, additional: 2,
    education: 1, certifications: 1, licenses: 0, metrics: 1, projects: 1, accountGroups: 1, accounts: 1, speaking: 1, employers: 1,
    history: 3, unreadableHistory: 1, strengthenAnswers: 1, strengthenThemes: 30, snapshots: 2, linked: 2,
    framingNotes: 1, gapsToCollect: 1, lockedFacts: 1,
  });
  const md = r.markdown, profile = madeUpProfile('ALEX');
  for (const [index, role] of profile.roles.entries()) {
    const next = profile.roles[index + 1], section = between(md, `### ${index + 1}. ${role.title} — ${role.org}`, next ? `### ${index + 2}. ${next.title}` : '## Skills');
    role.deliverables.forEach((bullet, n) => {
      assert.equal(occurrences(md, bullet), 1 + (index === 1 && n === 0 ? 1 : 0), `${bullet} once (and once more as the bullet its story supports)`);
      assert.ok(section.includes(`${n + 1}. ${bullet}`), `${bullet} is numbered under ${role.title}`);
    });
  }
  const cloud = between(md, '### Cloud (expert)', '### Leadership');
  for (const skill of profile.skills.Cloud.items) assert.ok(cloud.includes(`- ${skill}`), `${skill} under Cloud`);
  assert.ok(between(md, '### Leadership', '## Other experience').includes('- ALEX-SKILL-Mentoring'));
  assert.deepEqual(r.history.map((h) => h.when), ['2026-11-09 02:35:36', '2026-06-15 09:00:00', '2026-06-05 10:15:00']);
  assert.deepEqual(r.history[0], { at: '20261109-023536-891855', when: '2026-11-09 02:35:36', source: 'Saved from My résumé', added: ['headline updated'], words: '' });
  const history = between(md, '## History, newest first', '### Questions you answered');
  assert.ok(history.indexOf('2026-11-09 02:35:36') < history.indexOf('2026-06-15 09:00:00'));
  assert.ok(history.indexOf('2026-06-15 09:00:00') < history.indexOf('2026-06-05 10:15:00'));
  assert.ok(history.includes('> ALEX-WORDS first fact\n> second line'), 'the person\'s own words keep their lines');
  assert.match(history, /1 history line could not be read and is not shown/);
  assert.deepEqual(r.strengthen.map((a) => [a.when, a.theme, a.answer]), [['2026-08-11 14:02:09 UTC', 'Kubernetes / container orchestration', 'ALEX-ANSWER ran Kubernetes at scale']]);
  assert.deepEqual(r.snapshots.map((s) => s.when), ['2026-11-09 02:35:36', '2026-10-01 12:00:00'], 'snapshot dates only, newest first');
  assert.deepEqual(r.additional.map((e) => e.title), ['ALEX Labs', 'ALEX-BANK Volunteer coach'], 'the library as its screen lists it');
  assert.deepEqual(r.additional[0].bullets, ['[ALEX-OSS-1] built the platform', '[ALEX-OSS-2] shipped 12 apps']);
  assert.deepEqual(r.linked.map((d) => d.label), ['Your résumé', 'Detailed work addendum']);
});

test('Career\'s private writing notes are on the record for the page but never in the Markdown', () => {
  const r = reader.readMasterRecord(person('notes'));
  assert.deepEqual(r.notes, { framing: ['ALEX-NOTE frame the platform as a product'], gaps: ['ALEX-GAP collect the deploy metric'],
    locked: [{ name: 'Program revenue', display: 'ALEX-LOCKED $2M', scope: 'program' }] });
  for (const kept of ['ALEX-NOTE', 'ALEX-GAP', 'ALEX-LOCKED', 'ALEX-PRIVATE-NOTE', 'ALEX-STREET']) assert.equal(r.markdown.includes(kept), false, kept);
  assert.match(r.markdown, /Not in this file: the notes Career keeps for writing \(1 framing note, 1 gap to collect, 1 locked fact\)/);
});

test('nothing is written: a read-only folder reads whole, the database opens immutable, and every byte stays', () => {
  const store = person('readonly'), folders = [path.join(store.userDir, 'backups'), store.userDir];
  for (const dir of folders) fs.chmodSync(dir, 0o500);
  const before = treeState(store.userDir);
  opened.length = 0;
  let r;
  try { r = reader.readMasterRecord(store); } finally { for (const dir of folders.reverse()) fs.chmodSync(dir, 0o700); }
  assert.equal(r.counts.strengthenAnswers, 1);
  assert.deepEqual(treeState(store.userDir), before, 'no file added, changed or touched');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].readonly, true);
  assert.match(opened[0].filename, /^file:.*user-alex\.db\?immutable=1$/);
});

test('a linked or oversized source is refused before it is read, and the refusal never carries another person\'s text', () => {
  const bob = person('bob', { mark: 'BOB' });
  const link = (name, target) => (dir) => { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); fs.symlinkSync(target, path.join(dir, name)); };
  const cases = [
    ['a linked profile', link('career_db.json', path.join(bob.userDir, 'career_db.json')), /career profile is a link/],
    ['a linked history', link('enrichment_log.jsonl', path.join(bob.userDir, 'enrichment_log.jsonl')), /history of what you added is a link/],
    ['an oversized library', (dir) => fs.writeFileSync(path.join(dir, 'experience-bank.json'), ' '.repeat(512 * 1024 + 1)), /Your other experience is larger than Career keeps/],
    ['an oversized profile', (dir) => fs.truncateSync(path.join(dir, 'career_db.json'), 4 * 1024 * 1024 + 1), /career profile is larger than Career keeps/],
    ['a linked snapshot folder', link('backups', path.join(bob.userDir, 'backups')), /snapshot folder is not a folder/],
    ['a linked owner database', link('user-mal.db', bob.userDb), /Your answers on Improve my résumé could not be read/],
  ];
  cases.forEach(([name, plant, refusal], index) => {
    const dir = path.join(root, `mallory-${index}`), store = writeStore(dir, { mark: 'MAL', userDb: 'user-mal.db' });
    plant(dir);
    opened.length = 0;
    assert.throws(() => reader.readMasterRecord(store), (err) => {
      assert.equal(err.status, 503); assert.match(err.message, refusal); assert.doesNotMatch(err.message, /BOB/);
      return true;
    }, name);
    assert.equal(opened.some((open) => open.filename.includes('bob')), false, `${name}: Bob's database is never opened`);
  });
});

test('reading one person touches no file of another person\'s folder', () => {
  const alice = person('alice', { mark: 'ALICE' }), carol = person('carol', { mark: 'CAROL' });
  reader.readMasterRecord(alice);
  const touched = [], names = ['openSync', 'lstatSync', 'statSync', 'readFileSync', 'readdirSync', 'existsSync', 'fstatSync'];
  const real = Object.fromEntries(names.map((name) => [name, fs[name]]));
  for (const name of names) fs[name] = function spy(target, ...rest) { if (typeof target === 'string') touched.push(target); return real[name].call(this, target, ...rest); };
  opened.length = 0;
  let r;
  try { r = reader.readMasterRecord(alice); } finally { Object.assign(fs, real); }
  assert.ok(touched.length > 5, 'the spy saw the reads');
  assert.deepEqual(touched.filter((file) => !file.startsWith(alice.userDir + path.sep) && file !== gaps), [], 'only Alice\'s own folder');
  assert.ok(opened.every((open) => open.filename.includes(path.join('alice', 'user-alice.db'))));
  assert.equal(touched.some((file) => file.startsWith(carol.userDir)), false);
  assert.equal(JSON.stringify(r).includes('CAROL'), false);
});

test('a person with no saved profile, or no store at all, gets an empty record that says so', () => {
  for (const r of [reader.readMasterRecord(person('empty', { profile: null, history: null, bank: null, answers: null, snapshots: [] })), reader.readMasterRecord(null)]) {
    assert.equal(r.present, false);
    assert.equal(r.counts.roles, 0); assert.equal(r.counts.bullets, 0); assert.equal(r.counts.history, 0);
    assert.match(r.markdown, /You have not saved a résumé in Career yet/);
  }
});
