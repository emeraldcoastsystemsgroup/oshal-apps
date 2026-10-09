/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add the Linux process-group reader and self-sparing group fence for the Career engine wrapper (1.27.1). Under the runner's adopted lease the wrapper now keeps its Python engine in its own process group, so the runner's cancel, deadline and lease-loss fence (process.kill(-wrapperPid)) reach the engine; the wrapper's own deadline and lease-loss fence then cannot signal the engine's group without killing itself, so it kills every OTHER member of its group instead. Both decisions read /proc and refuse unless the wrapper provably leads its own group, so a wrapper that shares its parent's group never fences the parent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Default procfs mount; injectable so the parser and the fence are testable over a fixture tree. */
const PROC_ROOT = '/proc';
/** Bounded re-scans: a member forked before its parent's SIGKILL landed is caught by the next pass. */
const FENCE_PASSES = 8;

/**
 * @description Parse the state, parent and process group out of one /proc/<pid>/stat line. The
 * command name is parenthesised and may itself contain spaces or parentheses, so the fixed fields
 * are read after the LAST closing parenthesis.
 * @param {string} line - Contents of /proc/<pid>/stat.
 * @returns {{state: string, ppid: number, pgrp: number}|null} The fields, or null when malformed.
 */
function parseProcStat(line) {
  const close = String(line || '').lastIndexOf(')');
  if (close < 0) return null;
  const fields = String(line).slice(close + 1).trim().split(/\s+/);
  const [state, ppid, pgrp] = [fields[0], Number(fields[1]), Number(fields[2])];
  if (!state || !Number.isInteger(ppid) || !Number.isInteger(pgrp)) return null;
  return { state, ppid, pgrp };
}

/**
 * @description Read one process's stat fields; a process that is gone, or a host without procfs,
 * reads as null rather than throwing.
 * @param {number} pid - Process id.
 * @param {string} [procRoot] - procfs mount.
 * @returns {{state: string, ppid: number, pgrp: number}|null} The fields, or null.
 */
function readProcStat(pid, procRoot = PROC_ROOT) {
  try {
    return parseProcStat(fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8'));
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'ENOTDIR'].includes(error?.code)) return null;
    throw error;
  }
}

/**
 * @description True only when procfs proves the process leads its own process group. A host
 * without procfs, or a process that is gone, is false, so callers fall back to the engine having
 * a group of its own; an unexpected read failure throws for the caller to log.
 * @param {string} [procRoot] - procfs mount.
 * @param {number} [pid] - Process to test; this process by default.
 * @returns {boolean} Whether pid is its group's leader.
 */
function leadsOwnProcessGroup(procRoot = PROC_ROOT, pid = process.pid) {
  const stat = readProcStat(pid, procRoot);
  return Boolean(stat) && stat.pgrp === pid;
}

/**
 * @description List the members of one process group that can still run, skipping the excepted
 * pid and zombies (already dead, waiting only to be reaped).
 * @param {number} pgid - Process group id.
 * @param {number} exceptPid - Pid never listed.
 * @param {string} [procRoot] - procfs mount.
 * @returns {number[]} Live member pids.
 */
function liveGroupMembers(pgid, exceptPid, procRoot = PROC_ROOT) {
  const members = [];
  for (const name of fs.readdirSync(procRoot)) {
    if (!/^\d+$/.test(name) || Number(name) === exceptPid) continue;
    const stat = readProcStat(Number(name), procRoot);
    if (stat && stat.pgrp === pgid && stat.state !== 'Z' && stat.state !== 'X') members.push(Number(name));
  }
  return members;
}

/**
 * @description SIGKILL every other live member of this process's own group, never this process,
 * re-scanning until a pass finds none (bounded). Refuses unless this process leads the group: a
 * process inside its parent's group would otherwise reach the parent.
 * @param {{procRoot?: string, kill?: (pid: number, signal: string) => void}} [options] - procfs
 * mount and signal sender, injectable for fixture tests.
 * @returns {number} How many signals were delivered.
 * @throws {Error} When this process does not provably lead its own process group.
 */
function killOwnGroupExceptSelf(options = {}) {
  const procRoot = options.procRoot || PROC_ROOT;
  const kill = options.kill || ((pid, signal) => process.kill(pid, signal));
  const self = process.pid;
  if (!leadsOwnProcessGroup(procRoot, self)) {
    throw new Error('refusing to fence a process group this process does not lead');
  }
  let delivered = 0;
  for (let pass = 0; pass < FENCE_PASSES; pass += 1) {
    const members = liveGroupMembers(self, self, procRoot);
    if (members.length === 0) break;
    for (const pid of members) {
      try { kill(pid, 'SIGKILL'); delivered += 1; }
      catch (error) { if (error?.code !== 'ESRCH') throw error; }
    }
  }
  return delivered;
}

module.exports = {
  killOwnGroupExceptSelf,
  leadsOwnProcessGroup,
  liveGroupMembers,
  parseProcStat,
  readProcStat,
};
