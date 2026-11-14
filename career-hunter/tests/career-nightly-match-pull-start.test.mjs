/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The jobs pull moves from 18:00 to 01:00 Central (Roger, 2026-11-14: "the jobs run needs to be moved back to 1AM"). The shipped routes/career-nightly-match.js decides, with fixed clocks, what a person's nightly pass does when the pull starts at 01:00 and publishes in the morning: one pass for each night's corpus, none for a second publication the same day, and the first night after the move is due. It also holds the one limit of the rule as built: a cycle still turns at 18:00 Central, so a pull that publishes after 18:00 takes the next night's pass with it. The existing 18:00 cases stay in career-nightly-match.test.mjs.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'career-pull-start-'));
const corpusDb = join(root, 'corpus.db'), owner = join(root, 'owner');
mkdirSync(owner);
const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
  if (request === './career-user-store') return { userPaths: () => ({ userDir: owner, corpusDb }) };
  if (request === './career-engine-dispatch') return { runCareerCliAsync: async () => ({ started: false }) };
  return original.call(this, request, ...rest);
};
const nightly = require('../routes/career-nightly-match.js');
after(() => { Module._load = original; rmSync(root, { recursive: true, force: true }); });

/** Central Standard Time in November 2026 is six hours behind UTC. */
const central = (day, clock) => new Date(`${day}T${clock}:00-06:00`);

/** The corpus as published at `at`: a publication renames a new file into place, so its time is the file's. */
function publish(at) {
  writeFileSync(corpusDb, 'published ' + at.toISOString());
  utimesSync(corpusDb, at, at);
}

/** The receipt a successful pass over the corpus now in place leaves for the person. */
function passed() {
  const stat = statSync(corpusDb);
  writeFileSync(join(owner, nightly.NIGHTLY_MATCH_FILE), JSON.stringify({ version: 1, matchContract: nightly.NIGHTLY_MATCH_CONTRACT,
    corpusVersion: `${Math.trunc(stat.mtimeMs)}:${stat.size}`, completedAt: '2026-11-01T12:00:00.000Z',
    keywordMatched: 10, scored: 5, skipped: 0, limit: nightly.NIGHTLY_MATCH_LIMIT }), { mode: 0o600 });
}
const decision = () => nightly.nightlyMatchDecision(owner, corpusDb).reason;

test('a pull that starts at 01:00 Central and publishes in the morning gives each night exactly one pass', () => {
  publish(central('2026-11-04', '08:05'));
  assert.equal(decision(), null, 'the first morning publication is due');
  passed();
  assert.equal(decision(), 'up-to-date', 'the half-hourly check after the pass does nothing');
  publish(central('2026-11-04', '13:00'));
  assert.equal(decision(), 'daily-cooldown', 'a second publication the same day (a run started by hand) starts no second pass');
  publish(central('2026-11-05', '07:40'));
  assert.equal(decision(), null, "the next night's publication is due");
  passed();
  publish(central('2026-11-06', '09:55'));
  assert.equal(decision(), null, 'and the night after, when the pull ran long');
});

test('the first night after the move: the last 18:00 pull published after midnight, the first 01:00 pull is due', () => {
  publish(central('2026-11-05', '01:10'));
  passed();
  assert.equal(decision(), 'up-to-date');
  publish(central('2026-11-06', '08:00'));
  assert.equal(decision(), null, 'the 01:00 pull of the next night is a new cycle');
});

test('the first night after the move, when the last 18:00 pull published before midnight', () => {
  publish(central('2026-11-04', '22:55'));
  passed();
  publish(central('2026-11-06', '08:00'));
  assert.equal(decision(), null);
});

test('as built, a cycle turns at 18:00 Central: a pull that publishes after it takes the next night with it', () => {
  // A 01:00 pull would have to run more than 17 hours to publish after 18:00. The pass for the next
  // morning's corpus is then held back as the same cycle, and runs again the night after.
  publish(central('2026-11-04', '18:30'));
  passed();
  publish(central('2026-11-05', '08:00'));
  assert.equal(decision(), 'daily-cooldown', 'the limit of the fixed 18:00 turn, kept visible here');
  publish(central('2026-11-06', '08:00'));
  assert.equal(decision(), null);
});
