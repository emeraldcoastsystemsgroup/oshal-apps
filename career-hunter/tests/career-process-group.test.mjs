/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the wrapper's process-group fence (lib/career-process-group.js, 1.27.1) over a fixture procfs tree with an injected signal sender, so it runs on every platform and never signals a real process: a command name with spaces and parentheses parses, a missing procfs proves no leadership, a process that does not lead its group refuses to fence and signals nothing, the fence signals only live members of its own group (never itself, another group or a zombie), it re-scans until a member forked during the first pass is caught, and a vanished member is tolerated while any other signal failure surfaces. The real-process half is career-cancel-engine-tree.test.mjs (Linux).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const groups = require('../lib/career-process-group.js');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-process-group-'));
const SELF = process.pid;
let fixtureCount = 0;

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

/** Write one procfs stat entry in the kernel's field order (pid, comm, state, ppid, pgrp, session). */
function writeStat(procRoot, pid, { comm = 'python3', state = 'S', ppid = 1, pgrp }) {
  fs.mkdirSync(path.join(procRoot, String(pid)), { recursive: true });
  fs.writeFileSync(path.join(procRoot, String(pid), 'stat'), `${pid} (${comm}) ${state} ${ppid} ${pgrp} ${pgrp} 0 -1\n`);
}

/** Build a fixture procfs: entries map pid to stat fields, plus non-process noise. */
function procFixture(entries) {
  fixtureCount += 1;
  const procRoot = path.join(fixtureRoot, `proc-${fixtureCount}`);
  fs.mkdirSync(procRoot, { recursive: true });
  fs.mkdirSync(path.join(procRoot, 'self'));
  fs.writeFileSync(path.join(procRoot, 'uptime'), '1.0 1.0\n');
  for (const [pid, fields] of Object.entries(entries)) writeStat(procRoot, Number(pid), fields);
  return procRoot;
}

/** A recording signal sender standing in for process.kill. */
function recorder(onKill = () => {}) {
  const calls = [];
  const kill = (pid, signal) => { calls.push([pid, signal]); onKill(pid, calls.length); };
  return { calls, kill };
}

test('a stat line parses after the last parenthesis, so a command name cannot shift the fields', () => {
  assert.deepEqual(groups.parseProcStat('4321 (py (worker) 2) S 4300 4300 4300 0 -1'), { state: 'S', ppid: 4300, pgrp: 4300 });
  assert.deepEqual(groups.parseProcStat('77 (sleep) Z 1 4300 4300 0 -1'), { state: 'Z', ppid: 1, pgrp: 4300 });
  assert.equal(groups.parseProcStat('no fields here'), null);
  assert.equal(groups.parseProcStat('12 (x) S notanumber 3'), null);
});

test('leadership needs procfs proof: a leader is true, a member or a host without procfs is false', () => {
  assert.equal(groups.leadsOwnProcessGroup(procFixture({ [SELF]: { pgrp: SELF } })), true);
  assert.equal(groups.leadsOwnProcessGroup(procFixture({ [SELF]: { pgrp: 4_000_001 } })), false);
  assert.equal(groups.leadsOwnProcessGroup(path.join(fixtureRoot, 'no-procfs-here')), false);
});

test('a process that does not lead its group refuses to fence and signals nothing', () => {
  const procRoot = procFixture({
    [SELF]: { comm: 'node', pgrp: 4_000_001, ppid: 4_000_001 },
    4_000_001: { comm: 'node', pgrp: 4_000_001 },
    4_000_002: { pgrp: 4_000_001, ppid: SELF },
  });
  const { calls, kill } = recorder();
  assert.throws(() => groups.killOwnGroupExceptSelf({ procRoot, kill }), /does not lead/);
  assert.deepEqual(calls, []);
});

test('the fence signals only live members of its own group, never itself, another group or a zombie', () => {
  const procRoot = procFixture({
    [SELF]: { comm: 'node', pgrp: SELF },
    4_000_010: { comm: 'python3', pgrp: SELF, ppid: SELF },
    4_000_011: { comm: 'chrome (renderer)', pgrp: SELF, ppid: 4_000_010 },
    4_000_012: { comm: 'sleep', state: 'Z', pgrp: SELF, ppid: 1 },
    4_000_013: { comm: 'node', pgrp: 4_000_013 },
  });
  const { calls, kill } = recorder((pid) => writeStat(procRoot, pid, { state: 'Z', pgrp: SELF }));
  assert.equal(groups.killOwnGroupExceptSelf({ procRoot, kill }), 2);
  assert.deepEqual(calls.sort(), [[4_000_010, 'SIGKILL'], [4_000_011, 'SIGKILL']]);
});

test('the fence re-scans until a member forked during the first pass is caught', () => {
  const procRoot = procFixture({
    [SELF]: { comm: 'node', pgrp: SELF },
    4_000_020: { pgrp: SELF, ppid: SELF },
  });
  const { calls, kill } = recorder((pid, count) => {
    writeStat(procRoot, pid, { state: 'Z', pgrp: SELF });
    if (count === 1) writeStat(procRoot, 4_000_021, { comm: 'sleep', pgrp: SELF, ppid: pid });
  });
  assert.equal(groups.killOwnGroupExceptSelf({ procRoot, kill }), 2);
  assert.deepEqual(calls, [[4_000_020, 'SIGKILL'], [4_000_021, 'SIGKILL']]);
});

test('a member that vanished is tolerated, while any other signal failure surfaces', () => {
  const procRoot = procFixture({ [SELF]: { comm: 'node', pgrp: SELF }, 4_000_030: { pgrp: SELF } });
  const vanished = (pid) => {
    writeStat(procRoot, pid, { state: 'Z', pgrp: SELF });
    throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
  };
  assert.equal(groups.killOwnGroupExceptSelf({ procRoot, kill: vanished }), 0);
  writeStat(procRoot, 4_000_031, { pgrp: SELF });
  const denied = () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); };
  assert.throws(() => groups.killOwnGroupExceptSelf({ procRoot, kill: denied }), /operation not permitted/);
});
