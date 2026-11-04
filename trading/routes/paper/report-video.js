/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The OSHAL report as videos: the report-video schedule ticks this module, which feeds the saved daily report to the package's report studio engine over the kernel's engine.exchange relay; the engine renders one video per connected account into the lasting directory and this module keeps the owner-scoped index rows the page lists and the stream route checks. No broker call, no external upload, no model spend.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.51.1: a press without a session films the newest saved daily report when today's is not saved yet (the session rolls at midnight Eastern, 11 pm Central, so a late press found nothing), and a report with no connected accounts says so instead of reporting films ready.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.51.0: the films render inside Trading itself (report-film.js: the installation's ffmpeg, the kernel's voice.speak, the package's own lasting storage), one account per call so every pass stays inside the kernel's call limit. No engine container, link or host setting; an installation that has Trading has the films. A file already complete on disk is indexed, never filmed twice.
 */
'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { etParts } = require('./market');
const film = require('./report-film');

const SQL = {
 report: 'SELECT payload FROM trading_oshal_reports WHERE user_sub=$1 AND report_id=$2',
 latest: "SELECT report_id,payload FROM trading_oshal_reports WHERE user_sub=$1 AND report_id LIKE 'daily-%' ORDER BY report_id DESC LIMIT 1",
 list: 'SELECT session_date,file,account_label,status,detail,bytes,seconds,updated_at FROM trading_report_videos WHERE user_sub=$1 ORDER BY session_date DESC,account_label ASC LIMIT 60',
 session: 'SELECT session_date,file,account_label,status,detail,bytes,seconds,updated_at FROM trading_report_videos WHERE user_sub=$1 AND session_date=$2 ORDER BY account_label ASC',
 one: "SELECT file FROM trading_report_videos WHERE user_sub=$1 AND session_date=$2 AND file=$3 AND status='ready'",
 insert: 'INSERT INTO trading_report_videos (user_sub,session_date,file,account_label,status,detail,bytes,seconds,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',
 update: 'UPDATE trading_report_videos SET status=$4,detail=$5,bytes=$6,seconds=$7,updated_at=$8 WHERE user_sub=$1 AND session_date=$2 AND file=$3',
 clear: 'DELETE FROM trading_report_videos WHERE user_sub=$1 AND session_date=$2',
};
const SESSION = /^\d{4}-\d{2}-\d{2}$/, FILE = /^[a-z0-9][a-z0-9-]{0,78}\.mp4$/;
const CLIP_MAX = 4 * 1024 * 1024, ATTEMPTS = 2;
const STORAGE_HINT = 'Trading has no lasting storage on this installation (the kernel did not mount OSHAL_PACKAGE_DATA_DIR).';

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
/** @description The owner's opaque directory token in the lasting store: never the subject itself. */
const dirOf = (sub) => createHash('sha256').update(String(sub)).digest('hex').slice(0, 16);
/** @description The film's file name for an account. */
const fileOf = (label) => `${(String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')) || 'account'}.mp4`;

/** @description The owner's directory in the package's lasting storage, created private on first use. */
function ownerDir(env, owner, ...parts) {
 const root = env.OSHAL_PACKAGE_DATA_DIR;
 if (!root) throw httpError(503, 'no_lasting_store', STORAGE_HINT);
 const dir = path.join(root, 'report-videos', dirOf(owner), ...parts);
 fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
 return dir;
}

/**
 * @description Neural narration through the kernel's voice.speak (the installation's own speech settings).
 * @param {object} deps - {intent}.
 * @returns {Function} speak(text, voice) → WAV Buffer.
 */
function speaker(deps) {
 return async (text, voice) => {
  if (typeof deps.intent !== 'function') throw new Error('this installation offers no speech service to applications');
  let answer;
  try { answer = await deps.intent('voice.speak', { text, voice }); }
  catch (err) { throw new Error(`narration failed: ${err.message}`); }
  if (!answer || typeof answer.audioBase64 !== 'string') throw new Error('narration came back empty');
  return Buffer.from(answer.audioBase64, 'base64');
 };
}

async function rowsOf(pool, owner, session) { return (await pool.query(SQL.session, [owner, session])).rows; }
async function setRow(pool, owner, session, file, fields, now) {
 await pool.query(SQL.update, [owner, session, file, fields.status, fields.detail || null, fields.bytes || null, fields.seconds || null, now.toISOString()]);
}

const pub = (r) => ({ session: r.session_date, file: r.file, account: r.account_label, status: r.status,
 detail: r.detail || undefined, bytes: r.bytes == null ? null : Number(r.bytes), seconds: r.seconds == null ? null : Number(r.seconds),
 url: r.status === 'ready' ? `/api/trading/paper/reports/videos/${r.session_date}/${r.file}` : null });

/** @description Make sure every connected account in the report has an index row; a forced pass starts the day over. */
async function prepareRows(pool, owner, session, report, force, dir, now) {
 if (force) {
  await pool.query(SQL.clear, [owner, session]);
  for (const name of fs.readdirSync(dir)) if (FILE.test(name)) fs.rmSync(path.join(dir, name), { force: true });
 }
 const have = new Set((await rowsOf(pool, owner, session)).map((r) => r.file));
 for (const account of report.live || []) {
  const file = fileOf(account.label);
  if (!FILE.test(file) || have.has(file)) continue;
  await pool.query(SQL.insert, [owner, session, file, String(account.label || 'Connected account'), 'pending', null, null, null, now.toISOString()]);
  have.add(file);
 }
}

/** @description Film (or index) the next account that is not finished; one account per call. */
async function filmNext(deps, owner, session, report, dir, now) {
 const rows = await rowsOf(deps.pool, owner, session);
 const next = rows.find((r) => r.status === 'pending' || r.status === 'rendering');
 if (!next) return;
 const target = path.join(dir, next.file);
 if (fs.existsSync(target) && fs.statSync(target).size > 0) {
  const seconds = await film.probeSeconds(target).catch(() => null);
  await setRow(deps.pool, owner, session, next.file, { status: 'ready', bytes: fs.statSync(target).size, seconds }, now);
  return;
 }
 const attempt = next.status === 'rendering' ? Number(String(next.detail || '').replace(/\D/g, '') || 1) + 1 : 1;
 if (attempt > ATTEMPTS) {
  await setRow(deps.pool, owner, session, next.file, { status: 'failed', detail: 'the film did not finish inside the call limit twice' }, now);
  return;
 }
 await setRow(deps.pool, owner, session, next.file, { status: 'rendering', detail: `attempt ${attempt}` }, now);
 const account = (report.live || []).find((a) => fileOf(a.label) === next.file);
 try {
  if (!account) throw new Error('the account is no longer in this report');
  const presenter = path.join(dir, '..', 'presenter.mp4');
  const done = await film.renderAccount({ report, account, dir, presenter, speak: deps.speak || speaker(deps), file: next.file });
  await setRow(deps.pool, owner, session, next.file, { status: 'ready', bytes: done.bytes, seconds: done.seconds }, now);
 } catch (err) {
  await setRow(deps.pool, owner, session, next.file, { status: 'failed', detail: String(err.message).slice(0, 300) }, now);
 }
}

/**
 * @description One pass of the report-video pipeline: index the day's accounts from the saved report, then film
 * (or index an already finished file for) the next account. The schedule fires every five minutes after the close
 * and the page repeats the call until every account is done.
 * @param {object} deps - {pool, intent, env?, speak?}.
 * @param {string} owner - The admitted caller.
 * @param {object} body - {session?, force?}.
 * @param {Date} now - Instant.
 * @returns {Promise<{status:number, body:object}>} The pipeline state.
 */
/** @description The saved daily report a pass films: the session asked for, else today's, else the newest one saved. */
async function reportToFilm(pool, owner, body, now) {
 const asked = body && body.session ? String(body.session) : null;
 const session = asked || etParts(now).date;
 if (!SESSION.test(session)) throw httpError(400, 'session_invalid', 'Use a session date like 2026-11-02.');
 const saved = (await pool.query(SQL.report, [owner, `daily-${session}`])).rows[0];
 if (saved || asked) return { session, saved };
 const latest = (await pool.query(SQL.latest, [owner])).rows[0];
 return latest ? { session: latest.report_id.slice('daily-'.length), saved: latest } : { session };
}

async function tickVideos(deps, owner, body, now) {
 const { session, saved } = await reportToFilm(deps.pool, owner, body, now);
 if (!saved) return { status: 200, body: { ok: true, session, waiting: 'report', videos: [],
  message: 'No saved OSHAL report yet. The daily report schedule saves it at 5:05 pm Central; this job films it afterwards.' } };
 const report = JSON.parse(saved.payload);
 if (!(report.live || []).length) return { status: 200, body: { ok: true, session, waiting: 'accounts', videos: [],
  message: 'This report has no connected accounts, so there is nothing to film. Local paper accounts stay in the briefing.' } };
 const dir = ownerDir(deps.env || process.env, owner, session);
 await prepareRows(deps.pool, owner, session, report, Boolean(body && body.force), dir, now);
 await filmNext(deps, owner, session, report, dir, now);
 const rows = await rowsOf(deps.pool, owner, session);
 return { status: 200, body: { ok: true, session, done: rows.every((r) => r.status === 'ready' || r.status === 'failed'), videos: rows.map(pub) } };
}

/**
 * @description The owner's films, newest sessions first, and whether their presenter clip is in place.
 * @param {object} deps - {pool, env?}.
 * @param {string} owner - The admitted caller.
 * @returns {Promise<{status:number, body:object}>} The listing.
 */
async function listVideos(deps, owner) {
 const rows = (await deps.pool.query(SQL.list, [owner])).rows;
 let presenter;
 try {
  const clip = path.join(ownerDir(deps.env || process.env, owner), 'presenter.mp4');
  presenter = fs.existsSync(clip) ? { present: true, bytes: fs.statSync(clip).size } : { present: false };
 } catch (err) { presenter = { present: false, unavailable: err.message }; }
 return { status: 200, body: { ok: true, videos: rows.map(pub), presenter } };
}

/**
 * @description Keep the owner's silent presenter clip beside their films. The page reads the clip from the owner's
 * own Video Studio link in the browser and hands the bytes over; nothing here can read another package's store.
 * @param {object} deps - {env?}.
 * @param {string} owner - The admitted caller.
 * @param {object} body - {dataBase64}.
 * @returns {Promise<{status:number, body:object}>} The stored size.
 */
async function savePresenterClip(deps, owner, body) {
 const data = body && body.dataBase64;
 if (typeof data !== 'string' || !data) throw httpError(400, 'clip_required', 'Send the clip as dataBase64.');
 if (data.length > 5_600_000) throw httpError(413, 'clip_too_large', 'A presenter clip is at most 4 MiB.');
 const bytes = Buffer.from(data, 'base64');
 if (bytes.length > CLIP_MAX) throw httpError(413, 'clip_too_large', 'A presenter clip is at most 4 MiB.');
 if (bytes.length < 12 || bytes.toString('latin1', 4, 8) !== 'ftyp') throw httpError(400, 'clip_not_mp4', 'The presenter clip must be an MP4 video.');
 const target = path.join(ownerDir(deps.env || process.env, owner), 'presenter.mp4');
 fs.writeFileSync(`${target}.next`, bytes, { mode: 0o600 });
 fs.renameSync(`${target}.next`, target);
 return { status: 200, body: { ok: true, bytes: bytes.length } };
}

/**
 * @description The raw stream route for one film: the caller's own index row must name the file, then the kernel
 * streams it from the lasting directory with byte ranges. Owner isolation is the row check plus the owner-derived
 * directory; a file name is never taken from the caller beyond its exact validated shape.
 * @param {object} deps - {pool}.
 * @param {Function} callerOf - The admitted-caller reader shared with every paper route.
 * @param {object} [env] - Process environment (OSHAL_PACKAGE_DATA_DIR for the host fallback).
 * @returns {Function} Express handler for GET /reports/videos/:session/:file.
 */
function streamVideo(deps, callerOf, env = process.env) {
 return async (req, res) => {
  const sub = callerOf(req);
  if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
  const session = String(req.params.session || ''), file = String(req.params.file || '');
  if (!SESSION.test(session) || !FILE.test(file)) { res.status(400).json({ error: 'bad_request' }); return; }
  try {
   const row = (await deps.pool.query(SQL.one, [sub, session, file])).rows[0];
   if (!row) { res.status(404).json({ error: 'video_not_found' }); return; }
   const relative = path.posix.join('report-videos', dirOf(sub), session, file);
   res.setHeader('content-type', 'video/mp4');
   if (typeof res.lastingFile === 'function') { res.lastingFile(relative, { filename: file, inline: true }); return; }
   const dataDir = env.OSHAL_PACKAGE_DATA_DIR;
   if (!dataDir) { res.status(501).json({ error: 'no_lasting_store' }); return; }
   res.sendFile(path.join(dataDir, relative), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'video_not_found' }); });
  } catch (err) {
   if (!res.headersSent) res.status(500).json({ error: 'video_stream_failed', message: err.message });
  }
 };
}

module.exports = { tickVideos, listVideos, savePresenterClip, streamVideo, dirOf, fileOf, speaker, SQL };
