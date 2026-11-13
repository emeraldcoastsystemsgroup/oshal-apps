/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Save an administrator's source change for the kernel to hand to the next pull, and say what became of it. A request mounts the corpus read-only, so this is how Resolve reaches it on the native kernel.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add, Remove and Put back travel the same way: an added employer is `add:<name>|<link>` under a placeholder id, a removal `remove:employer` and a put-back `restore:employer` under the employer's own id.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Publish human-confirmed decision outcomes with deterministic request IDs and exact conditional source identity for the single writer.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep trying travels the same way: `keep:employer` under the employer's own id answers a source maintenance decision.
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** The kernel takes this folder away when the call succeeds, and only for an administrator. */
const OUTBOX = '.source-request-outbox';
/** The caller's own record of what they sent, so the page can say "waiting" before any pull has run. */
const SENT = 'source-requests-sent';
const KEEP_SENT = 50;
const MAX_TARGET = 2048;
/** An added employer has no id until the pull makes it; the kernel needs a positive one, so this stands in. */
const NEW_EMPLOYER = 2147483647;
const REMOVE = 'remove:employer';
const RESTORE = 'restore:employer';
const KEEP_TRYING = 'keep:employer';

/** Percent-encode everything but letters, digits and `._~-`, so the name and link cannot break the `|` between them. */
function strictEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * @description The change that adds an employer: its name and the careers page or job board to read.
 * @param {unknown} name - The employer's name as the administrator typed it.
 * @param {unknown} link - An http or https link to its careers page or job board.
 * @returns {{target: string, name: string, link: string} | null} The target, or null when either part is not usable.
 */
function addTarget(name, link) {
  const rawName = String(name ?? ''), rawLink = String(link ?? '').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(rawName + rawLink)) return null;
  const tidy = rawName.split(/\s+/).filter(Boolean).join(' ');
  if (tidy.length < 2 || tidy.length > 120) return null;
  try {
    const url = new URL(rawLink);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null;
  } catch { return null; }
  const target = `add:${strictEncode(tidy)}|${strictEncode(rawLink)}`;
  return target.length <= MAX_TARGET ? { target, name: tidy, link: rawLink } : null;
}

/** Either a link, or a board as the source review names one: `greenhouse:acme`. The engine has the final word. */
function validTarget(value) {
  const target = String(value ?? '').trim();
  // eslint-disable-next-line no-control-regex
  if (/^decision:/i.test(target)) return null;
  if (!target || target.length > MAX_TARGET || /[\u0000-\u001f\u007f]/.test(target)) return null;
  try {
    const url = new URL(target);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return target;
  } catch { /* Not a link; it may still name a board. */ }
  return /^[a-z][a-z0-9_]*:[A-Za-z0-9._~|%+-][A-Za-z0-9._~|/:%+?=&#,;@!$*-]*$/.test(target) && !/^https?:/.test(target) ? target : null;
}

function readSent(userDir) {
  const folder = path.join(userDir, SENT);
  let names;
  try { names = fs.readdirSync(folder); } catch { return []; }
  const sent = [];
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    try { sent.push(JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))); } catch { /* A damaged record is not worth a failed page. */ }
  }
  return sent.sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
}

/** Leave one change for the kernel and keep the caller's record of it. */
function saveChange(userDir, companyId, target) {
  const change = { id: crypto.randomUUID(), companyId, target };
  fs.mkdirSync(path.join(userDir, OUTBOX), { recursive: true });
  fs.mkdirSync(path.join(userDir, SENT), { recursive: true });
  fs.writeFileSync(path.join(userDir, OUTBOX, `${change.id}.json`), JSON.stringify(change));
  const record = { ...change, requestedAt: Date.now() };
  fs.writeFileSync(path.join(userDir, SENT, `${change.id}.json`), JSON.stringify(record));
  for (const old of readSent(userDir).slice(KEEP_SENT)) {
    fs.rmSync(path.join(userDir, SENT, `${old.id}.json`), { force: true });
  }
  return record;
}

/** What the pulls have done with changes, newest first. Empty on a corpus no change has reached, and on any read failure. */
function appliedChanges(db) {
  try {
    const exists = db.prepare("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name='source_requests'").get();
    if (!exists) return [];
    return db.prepare(`SELECT id, company_id AS companyId, target, requested_at AS requestedAt, finished_at AS finishedAt,
      outcome, detail FROM corpus.source_requests ORDER BY COALESCE(finished_at, '') DESC, id DESC LIMIT ${KEEP_SENT}`).all()
      .map((row) => {
        let detail = {};
        try { detail = JSON.parse(row.detail || '{}'); } catch { /* The outcome alone is still an answer. */ }
        return { ...row, state: row.outcome, detail };
      });
  } catch {
    return []; // The page must not lose the company list over this.
  }
}

/** Every change the page should mention: what pulls did, then what this caller sent that no pull has reached. */
function sourceChanges(db, userDir) {
  const applied = appliedChanges(db);
  const known = new Set(applied.map((change) => change.id));
  const waiting = readSent(userDir).filter((change) => !known.has(change.id))
    .map((change) => ({ ...change, state: 'waiting', detail: {} }));
  return [...waiting, ...applied];
}

/** A stable UUID for the same original owner's exact native decision outcome. */
function decisionId(owner, action, ticketId, outcome) {
  const bytes = crypto.createHash('sha256').update(JSON.stringify([1,owner,action.companyId,action.id,action.openedAt,ticketId,outcome])).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function decisionFolder(userDir, name) {
  const folder = path.join(userDir,name);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const stat = fs.lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Source decision handoff folder is unavailable.');
  return folder;
}

function existingDecision(file) {
  let fd;
  try { fd = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw new Error('Source decision handoff is unavailable.');
    return JSON.parse(fs.readFileSync(fd,'utf8'));
  } finally { fs.closeSync(fd); }
}

function decisionFile(folder, record, savedAt) {
  const file = path.join(folder,record.id+'.json'), previous = existingDecision(file);
  if (previous && ['id','companyId','target'].some(key => previous[key] !== record[key]))
    throw new Error('Source decision handoff identity changed.');
  if (previous) return previous;
  const value = savedAt ? {...record,requestedAt:savedAt} : record;
  const temp = file+'.'+crypto.randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});
    const fd = fs.openSync(temp,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp,file);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return value;
}

/** @description Queue the same confirmed ticket outcome once, for an exact current source action.
 * @param {string} userDir Original owner's locked request directory. @param {string} owner Original subject.
 * @param {object} action Server-read exact source identity. @param {string} ticketId Verified native ticket.
 * @param {string} outcome Archive or keep, derived from native Done or Cancelled. @returns {object} Durable queued request. */
function saveDecisionChange(userDir, owner, action, ticketId, outcome) {
  if (typeof owner !== 'string' || !owner || !Number.isSafeInteger(action?.id) || action.id < 1
    || !Number.isSafeInteger(action.companyId) || action.companyId < 1 || typeof action.openedAt !== 'string'
    || !Number.isFinite(Date.parse(action.openedAt)) || action.openedAt.length > 80
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ticketId) || !['archive','keep'].includes(outcome))
    throw new Error('The confirmed source decision is invalid.');
  const record = {id:decisionId(owner,action,ticketId,outcome),companyId:action.companyId,
    target:`decision:${action.id}:${strictEncode(action.openedAt)}:${outcome}`};
  const outbox = decisionFolder(userDir,OUTBOX), sent = decisionFolder(userDir,SENT);
  decisionFile(outbox,record);
  return decisionFile(sent,record,Date.now());
}

/** @description Read one exact queued decision's actual next-pull outcome without fabricating application.
 * @param {object} db Attached corpus reader. @param {string} id Owner-journal request ID. @returns {object|null} Recorded result. */
function decisionChangeState(db,id) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) return null;
  const table = db.prepare("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name='source_requests'").get();
  if (!table) return null;
  const row = db.prepare('SELECT outcome AS state FROM corpus.source_requests WHERE id=?').get(id);
  return row && row.state !== 'started' ? row : null;
}

module.exports = { saveDecisionChange, decisionChangeState, validTarget, saveChange, sourceChanges, addTarget, NEW_EMPLOYER, REMOVE, RESTORE, KEEP_TRYING };
