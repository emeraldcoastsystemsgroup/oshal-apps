/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A Job Board run matches before it scores, so its terminal line may report matched postings; a plain manual pass still may not.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Validate the title scorer's exact terminal counts and expected selector size without accepting partial or over-budget success.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retain only validated count-only manual score success receipts in the original owner's staged generation.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const LIMIT = 50;
const FRESH_DAYS = 7;
const FILE = 'manual-score-success.json';
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function counts(value, limit) {
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= LIMIT
    && value && [value.scored, value.skipped].every(n => Number.isSafeInteger(n) && n >= 0)
    && value.scored + value.skipped <= limit;
}

/** Parse only the engine's exact terminal count line; no raw output becomes a public receipt. */
function verdict(stdout, limit = LIMIT, expectedTerms, matched = false) {
  const line = String(stdout || '').trim().split(/\r?\n/).at(-1) || '';
  if (expectedTerms !== undefined) {
    if (!Number.isSafeInteger(expectedTerms) || expectedTerms < 1 || expectedTerms > 16) return null;
    try {
      const record = JSON.parse(line);
      const keywordMatched = matched ? Number.isSafeInteger(record?.keywordMatched) && record.keywordMatched >= 0 : record?.keywordMatched === 0;
      if (record?.result !== 'complete' || record.terms !== expectedTerms || !keywordMatched) return null;
      return counts(record, limit) ? { scored: record.scored, skipped: record.skipped } : null;
    } catch { return null; }
  }
  const match = /^AI-scored (\d+) postings \((\d+) skipped\)\.$/.exec(line);
  const value = match && { scored: Number(match[1]), skipped: Number(match[2]) };
  return counts(value, limit) ? value : null;
}

function valid(value) {
  return value && value.version === 1 && typeof value.runId === 'string' && RUN_ID.test(value.runId) && value.verb === 'score'
    && value.state === 'succeeded' && counts(value, value.limit)
    && typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt))
    && new Date(value.completedAt).toISOString() === value.completedAt
    && Date.parse(value.completedAt) <= Date.now() + 60000;
}

/** Read one bounded regular owner file and project only its safe public fields. */
function read(userDir) {
  const file = path.join(userDir, FILE);
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2048) throw new Error('Manual score receipt is unavailable');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!valid(value)) throw new Error('Manual score receipt is unavailable');
  return { runId: value.runId, verb: 'score', state: 'succeeded', reason: null,
    scored: value.scored, skipped: value.skipped, limit: value.limit, completedAt: value.completedAt };
}

/** Publish from the kept run's completion scope; failed native runs never create a success receipt. */
async function write(userDir, runId, result, limit = LIMIT) {
  const value = { version: 1, runId, verb: 'score', state: 'succeeded', limit,
    scored: result.scored, skipped: result.skipped, completedAt: new Date().toISOString() };
  if (!valid(value)) throw new Error('Invalid manual score receipt');
  await fs.promises.mkdir(userDir, { recursive: true });
  const file = path.join(userDir, FILE), temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const output = await fs.promises.open(temporary, 'wx', 0o600);
    try { await output.writeFile(JSON.stringify(value) + '\n'); await output.sync(); }
    finally { await output.close(); }
    await fs.promises.rename(temporary, file);
  } finally { await fs.promises.rm(temporary, { force: true }); }
}

module.exports = { LIMIT, FRESH_DAYS, FILE, verdict, read, write };
