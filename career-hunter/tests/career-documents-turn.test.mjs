/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (the coordinator, 2026-11-27: a Career release must not make every person's documents be written again): lib/career-documents-turn.js staleWhy on made-up packets in a temporary folder. Proved: documents written today by an earlier Career (1.77.6, no documents revision recorded) stay fresh under this Career, so a plain Career version bump makes nothing stale; a bump of the documents revision makes a packet that records an older revision, or none, stale, and one that records the current revision stays fresh; a cover letter dated an earlier day than today in the letter's zone is stale, read from the letter itself, else from when the documents were last written, and a letter written late in the evening is still today in that zone; the revision is the engine's own constant, read from a packet's first bytes or its whole record.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

let root, turn, n = 0;
const ENGINE = Number(/^DOCUMENTS_REVISION\s*=\s*(\d+)/m.exec(fs.readFileSync(new URL('../engine/jobhunter/documents_revision.py', import.meta.url), 'utf8'))[1]);
const zone = process.env.CAREER_TIME_ZONE;
before(() => {
  delete process.env.CAREER_TIME_ZONE;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-documents-turn-'));
  ({ modules: { turn } } = loadCompiledModules({ turn: 'lib/career-documents-turn.js' }));
});
after(() => { if (zone !== undefined) process.env.CAREER_TIME_ZONE = zone; fs.rmSync(root, { recursive: true, force: true }); });

/** The day a letter shows for an instant in Central time ("November 27, 2026"), as the engine's _today writes it. */
const letterDate = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long', day: '2-digit', year: 'numeric' }).format(new Date(ms));
/** A made-up packet folder: its application.json and, when given, its letter dated `dated` (ms). */
function packet(record, dated) {
  const folder = path.join(root, 'packet-' + (++n)); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'application.json'), JSON.stringify({ posting_id: n, ...record }, null, 2));
  if (dated !== undefined) fs.writeFileSync(path.join(folder, 'CoverLetter.html'), `<html><body><p class="date">${letterDate(dated)}</p><p>Dear Hiring Manager,</p><p>I run offices.</p></body></html>`);
  return folder;
}
const NOW = Date.now(), DAY = 24 * 3600 * 1000;
const stale = (folder, extra = {}) => turn.staleWhy({ row: {}, folder, receipt: null, now: NOW, ...extra });

test('the documents revision is the engine\'s own constant, recorded on every generation', () => {
  assert.equal(turn.documentsRevision(), ENGINE);
  assert.ok(Number.isSafeInteger(ENGINE) && ENGINE >= 1);
  assert.equal(turn.packetRevision(packet({ career_version: '1.78.0', documents_revision: 3 })), 3, 'read from the first bytes');
  assert.equal(turn.packetRevision(packet({ career_version: '1.78.0', job_context: { description: 'x'.repeat(9000) }, documents_revision: 4 })), 4, 'or from the whole record');
  assert.equal(turn.packetRevision(packet({ career_version: '1.77.6' })), 1, 'a packet made before revisions were recorded counts as 1');
  assert.equal(turn.packetRevision(null), 1);
});

test('a plain Career version bump makes nothing stale: documents written today by Career 1.77.6 stay fresh under this Career', () => {
  const today = packet({ career_version: '1.77.6' }, NOW);
  assert.equal(stale(today), '', 'an earlier Career version alone never asks for new documents');
  assert.equal(stale(today, { row: { generated_at: new Date(NOW).toISOString() }, receipt: { phase: 'ready', completedAt: new Date(NOW).toISOString() } }), '');
  assert.equal(stale(packet({ career_version: '1.0.0' }, NOW)), '', 'however old the version');
  assert.equal(stale(packet({}, NOW)), '', 'or none recorded');
});

test('a documents revision bump makes older packets stale, and a packet of the current revision stays fresh', () => {
  const before = packet({ career_version: '1.77.6' }, NOW), older = packet({ career_version: '1.78.0', documents_revision: ENGINE }, NOW);
  assert.equal(stale(before, { current: ENGINE + 1 }), 'revision', 'a packet that records no revision, after a bump');
  assert.equal(stale(older, { current: ENGINE + 1 }), 'revision', 'a packet of the revision before the bump');
  assert.equal(stale(packet({ career_version: '1.78.0', documents_revision: ENGINE + 1 }, NOW), { current: ENGINE + 1 }), '', 'written under the new revision');
  assert.equal(stale(older), '', 'without a bump, the current revision is fresh');
  assert.match(turn.staleWords('revision'), /^Its documents were written before Career changed how it writes them\. Career is writing them again now/);
});

test('a cover letter dated an earlier day than today in the letter\'s zone is stale, read from the letter, else from when it was written', () => {
  assert.equal(stale(packet({ documents_revision: ENGINE }, NOW - 2 * DAY)), 'letter-day', 'the letter itself says an earlier day');
  assert.equal(stale(packet({ documents_revision: ENGINE }, NOW), { row: { generated_at: new Date(NOW - 3 * DAY).toISOString() } }), '', 'a letter rendered again today is dated today');
  const plain = packet({ documents_revision: ENGINE });
  assert.equal(stale(plain, { row: { generated_at: new Date(NOW - 2 * DAY).toISOString() } }), 'letter-day', 'no readable letter: when the documents were written');
  assert.equal(stale(plain, { row: { generated_at: new Date(NOW - 2 * DAY).toISOString() }, receipt: { phase: 'ready', completedAt: new Date(NOW).toISOString() } }), '', 'the later of the row and the receipt');
  assert.equal(stale(plain), '', 'nothing says when: never stale by a guess');
  // 22:30 Central on November 27 is already November 28 in UTC: the letter dated November 27 is still today's.
  const evening = Date.parse('2026-11-28T04:30:00Z');
  assert.equal(turn.staleWhy({ row: {}, folder: packet({ documents_revision: ENGINE }, Date.parse('2026-11-27T15:00:00Z')), receipt: null, now: evening }), '');
  assert.equal(turn.staleWhy({ row: {}, folder: packet({ documents_revision: ENGINE }, Date.parse('2026-11-26T15:00:00Z')), receipt: null, now: evening }), 'letter-day');
  assert.equal(turn.letterDay(packet({}, Date.parse('2026-11-07T15:00:00Z'))), '2026-11-07', 'a zero-padded day ("November 07, 2026") is read');
});
