/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4: scripts/saved-job-places.py, the read-only dry run the release coordinator runs on an installation after delivery, over a made-up native data root (the engine's own corpus and owner schemas, invented jobs, people with and without a home, one with no published generation): it counts saved jobs, place text, fully remote, map points and distances exactly, says it would write nothing, prints no subject, principal, title or place, and leaves every file byte as it was.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
const schema = name => engine.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`))[1];
const script = new URL('../scripts/saved-job-places.py', import.meta.url).pathname;
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-saved-job-places-'));
after(() => fs.rmSync(root, {recursive:true, force:true}));

/** The shared corpus: three local jobs with points, a fully remote one, one that names a country, one that names nothing. */
function corpus() {
  const db = new DatabaseSync(':memory:');
  db.prepare('ATTACH DATABASE ? AS corpus').run(path.join(root, 'corpus.db'));
  db.exec(schema('CORPUS_SCHEMA'));
  db.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Invented Employer')");
  const put = db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,remote,city,lat,lon,active)
    VALUES(?,1,?,?,?,?,?,?,?,1)`);
  put.run(1, 'a-1', 'Warehouse Lead', 'Bend, OR', 0, 'bend', 44.06, -121.31);
  put.run(2, 'a-2', 'Field Engineer', 'Redmond, OR', 0, 'redmond', 44.27, -121.17);
  put.run(3, 'a-3', 'Planner', 'Sisters, OR', 0, 'sisters', 44.29, -121.55);
  put.run(4, 'a-4', 'Software Engineer', 'Remote - US', 1, 'austin', 30.27, -97.74);
  put.run(5, 'a-5', 'Coordinator', 'United States', 0, null, null, null);
  put.run(6, 'a-6', 'Clerk', null, 0, null, null, null);
  db.close();
}

/** One person's published generation: their store, their saved jobs (one removed) and, optionally, their home. */
function person(principal, sub, saved, removed, home) {
  const dir = path.join(root, 'tenant-1', 'people', principal), generation = path.join(dir, 'generations', 'gen-1');
  fs.mkdirSync(generation, {recursive:true});
  fs.writeFileSync(path.join(dir, 'current'), 'gen-1\n');
  const db = new DatabaseSync(path.join(generation, `user-${sub}.db`));
  db.exec(schema('USER_SCHEMA'));
  for (const id of saved) db.prepare('INSERT INTO user_signals(posting_id,status) VALUES(?,?)').run(id, removed.includes(id) ? 'dismissed' : 'new');
  db.close();
  const jobs = Object.fromEntries(saved.map(id => [id, {favorite:true, savedAt:'2026-11-01T00:00:00.000Z'}]));
  fs.writeFileSync(path.join(generation, 'job-board-state.json'), JSON.stringify({version:1, jobs}));
  if (home) fs.writeFileSync(path.join(generation, 'job-search-scope.json'), JSON.stringify({version:1, near:'Bend, OR', lat:44.0567, lon:-121.308, radiusMiles:25, includeRemote:true}));
}
/** Every file under the root with its digest, to prove the run wrote nothing. */
function bytes(folder) {
  const out = {};
  for (const entry of fs.readdirSync(folder, {withFileTypes:true, recursive:true})) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    out[path.relative(root, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return out;
}

test('the dry run counts where saved jobs are for every person, would write nothing, names nobody, and writes nothing', () => {
  corpus();
  person('principal-with-home', 'subject-with-home', [1, 2, 3, 4, 5, 6], [3], true);
  person('principal-without-home', 'subject-without-home', [1, 4], [], false);
  fs.mkdirSync(path.join(root, 'tenant-1', 'people', 'principal-not-yet'), {recursive:true});
  const before = bytes(root);
  const run = spawnSync(python, ['-I', script, root], {encoding:'utf8', timeout:60000});
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    people:2, people_with_saved_jobs:2, people_with_home:1, saved:7, missing_from_corpus:0,
    place_text:6, place_unknown:1, fully_remote:2, with_point:5, with_distance:2, would_write:0});
  for (const word of ['subject-', 'principal-', 'Warehouse', 'Redmond', 'Bend', 'Invented', 'Remote - US'])
    assert.ok(!run.stdout.includes(word) && !run.stderr.includes(word), `the run never prints "${word}"`);
  assert.deepEqual(bytes(root), before, 'every file byte is as it was');
  assert.equal(spawnSync(python, ['-I', script, path.join(root, 'no-such-folder')], {encoding:'utf8'}).status, 2);
});
