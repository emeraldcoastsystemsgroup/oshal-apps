#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Master record's live proof (1.51.0), two modes. `counts <folder>` runs the reader read-only over one person's Career folder and prints counts and dates only, never résumé text, and checks the folder listing is unchanged. `blue` runs on bare-metal blue (loopback only) as a throwaway test person seeded with Career's bundled made-up profile: the page at 412x915 and 1280x900 (bullets and dates on screen, no sideways scroll, Download, Print in More), the concierge pages, Resume Studio's More item, the rail's save-before-send then Save to master resume changing no byte of the master, its history or its snapshots, and the Career bot asked for everything (its tool trace and time). It prints no token, cookie or header, signs out every session it made, revokes the test grants and deactivates the test person.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The blue test person's made-up résumé arrives through Resume Studio's own upload and Career's real indexing (the native upload works since 1.51.0), not the bundled profile.
 *
 * Usage:
 *   node career-hunter/tests/career-master-record-live-proof.mjs counts <career-folder>
 *   node career-hunter/tests/career-master-record-live-proof.mjs blue
 * Environment for `blue`: OSHAL_PROOF_KERNEL (default http://127.0.0.1:38798, loopback only), OSHAL_PROOF_ENV_FILE (blue's
 * env file; its OSHAL_ADMIN_TOKEN is read by name and never printed), OSHAL_PROOF_DATA (blue's Career data root),
 * OSHAL_PROOF_OUT (screenshots, the downloaded .md and the receipt).
 */
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteAdapter } from './helpers/career-master-record-fixture.mjs';
import { runBlue } from './helpers/career-master-record-live.mjs';

const require = createRequire(import.meta.url);
const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));

/** The reader with better-sqlite3 served over node:sqlite read-only, as the native bridge serves it. */
function loadReader() {
  const original = Module._load;
  Module._load = function withSqlite(request, ...rest) { return request === 'better-sqlite3' ? sqliteAdapter() : original.call(this, request, ...rest); };
  try { return require('../lib/career-master-record.js'); } finally { Module._load = original; }
}

function listing(dir) {
  const out = [];
  const walk = (folder) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name), stat = fs.lstatSync(file);
    out.push(`${path.relative(dir, file)}:${stat.size}:${stat.mtimeMs}`);
    if (entry.isDirectory() && entry.name === 'backups') walk(file);
  } };
  walk(dir);
  return out.sort().join('\n');
}

/** Counts and dates only, over one person's folder; nothing in it is written. */
function counts(dir) {
  const before = listing(dir), reader = loadReader(), database = fs.readdirSync(dir).find((name) => /^user-.*\.db$/.test(name));
  process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
  const started = Date.now(), r = reader.readMasterRecord({ userDir: dir, userDb: database ? path.join(dir, database) : undefined });
  const ms = Date.now() - started, sizes = [];
  for (let n = 1; ; n += 1) { const p = reader.pageOf(r, n); if (!p) break; sizes.push(Buffer.byteLength(JSON.stringify(p))); }
  const byDay = r.history.reduce((days, h) => ({ ...days, [h.when.slice(0, 10)]: (days[h.when.slice(0, 10)] || 0) + 1 }), {});
  say('counts', { ms, counts: r.counts, bulletsByRole: r.experience.map((role) => role.bullets.length), historyByDay: byDay,
    strengthenAnswered: r.strengthen.map((a) => a.when.slice(0, 10)), snapshots: r.snapshots.map((s) => s.when),
    additional: r.additional.map((e) => ({ bullets: e.bullets.length, skills: e.skills.length })), linked: r.linked.map((d) => d.label),
    markdownBytes: Buffer.byteLength(r.markdown), pages: sizes.length, largestPageBytes: Math.max(...sizes),
    folderUnchanged: listing(dir) === before });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, folder] = process.argv.slice(2);
  if (mode === 'counts' && folder) counts(path.resolve(folder));
  else if (mode === 'blue') await runBlue();
  else { console.error('usage: career-master-record-live-proof.mjs counts <career-folder> | blue'); process.exitCode = 2; }
}
