#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05 automated acceptance, for AFTER Video 1.9.0 is installed: the manual editor's whole server path on the box, driven over the REAL routes as the operator automation identity (OSHAL_VERIFY_OPERATOR_PAT, read BY NAME and never printed). It uploads the committed one-second H.264/AAC clip (measured by the box's own ffprobe), creates ONE uniquely tagged project, saves a second revision and has a stale save refused, exports it with the box's own FFmpeg and requires a verified MP4 back, then deletes exactly what it created (the project, its export file and the upload) and reads each back as 404. An incomplete cleanup is a failure. It prints one RESULT line. The same function is driven against the loopback router by tests/editor-live-acceptance.test.mjs, so the script is proven before any box runs it.
 *
 * Usage (from a core or store checkout, with the api reachable):
 *   OSHAL_VERIFY_BASE_URL=http://localhost:35457 OSHAL_VERIFY_ENV_FILE=<box .env> node video/tests/editor-live-acceptance.mjs
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Test Lab case id this proof reports under. */
export const CASE_ID = 'video:editor-live-acceptance';
const PAT_ENV = 'OSHAL_VERIFY_OPERATOR_PAT';
/** The committed clip: 160x90, 30 frames at 30 fps, H.264 with one AAC track, made by the runtime image's own FFmpeg. */
export const CLIP = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'editor-acceptance-clip.mp4');

/**
 * @description The operator PAT, BY NAME: the environment first, then the env file's line. Never printed.
 * @param {NodeJS.ProcessEnv} env Environment. @returns {string} The token, or ''.
 */
export function readOperatorPat(env) {
  const direct = String(env[PAT_ENV] || '').trim();
  if (direct || !env.OSHAL_VERIFY_ENV_FILE) return direct;
  let text = '';
  try { text = fs.readFileSync(env.OSHAL_VERIFY_ENV_FILE, 'utf8'); }
  catch (error) { process.stderr.write(`OSHAL_VERIFY_ENV_FILE is not readable (${error?.code ?? 'error'}); no token taken from it\n`); return ''; }
  const line = text.split(/\n/).find(row => new RegExp(`^\\s*${PAT_ENV}=`).test(row));
  return line ? line.slice(line.indexOf('=') + 1).replace(/\r$/, '').trim().replace(/^(['"])(.*)\1$/, '$2') : '';
}

/**
 * @description Calls to the editor as the PAT's owner.
 * @param {string} base Api origin. @param {string} token PAT. @param {typeof fetch} fetchImpl Fetch.
 * @returns {(method: string, route: string, body?: unknown) => Promise<{status: number, json: any, bytes: Buffer}>} Caller.
 */
export function editorApi(base, token, fetchImpl = fetch) {
  return async (method, route, body) => {
    const form = body instanceof FormData;
    const response = await fetchImpl(`${base}/api/video/editor${route}`, { method, redirect: 'manual', signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined || form ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let json = {};
    try { json = JSON.parse(bytes.toString('utf8')); } catch { json = {}; }
    return { status: response.status, json, bytes };
  };
}

function expect(ok, detail) { if (!ok) throw new Error(detail); }

async function uploadClip(call) {
  const form = new FormData();
  form.append('media', new Blob([fs.readFileSync(CLIP)], { type: 'video/mp4' }), 'editor-acceptance-clip.mp4');
  const response = await call('POST', '/media?kind=video', form);
  expect(response.status === 201, `upload answered ${response.status} ${response.json.error ?? ''}`);
  const media = response.json.media;
  expect(media.frames === 30 && media.width === 160 && media.height === 90 && media.hasAudio === true && media.videoCodec === 'h264',
    `the box measured the clip as ${JSON.stringify({ frames: media.frames, width: media.width, height: media.height, hasAudio: media.hasAudio })}`);
  return media;
}

function timeline(name, media, out) {
  return { version: 1, name, profile: 'hd720p30', audioBed: null, titles: [],
    sources: { v1: { kind: 'video', asset: media.id, name: 'Acceptance clip', frames: media.frames, width: media.width, height: media.height, audio: media.hasAudio } },
    segments: [{ id: 's1', source: 'v1', in: 0, out, volume: 100 }] };
}

async function exportAndDownload(call, projectId, revision) {
  const started = await call('POST', `/projects/${projectId}/exports`, { revision });
  expect(started.status === 202, `export answered ${started.status} ${started.json.error ?? ''}`);
  const id = started.json.export.id, deadline = Date.now() + 150_000;
  let row = started.json.export;
  while (['queued', 'running'].includes(row.status)) {
    expect(Date.now() < deadline, 'the export did not finish within 150 s');
    await new Promise(done => setTimeout(done, 1000));
    row = (await call('GET', `/exports/${id}`)).json.export;
  }
  expect(row.status === 'succeeded', `the export ended ${row.status} ${row.error ?? ''}`);
  const file = await call('GET', `/exports/${id}/download`);
  expect(file.status === 200 && file.bytes.length === row.outputBytes && file.bytes.toString('latin1', 4, 8) === 'ftyp', 'the download is not the verified MP4');
  return row;
}

/** Delete exactly what this run created and read each back as 404; any miss is a cleanup error. */
async function cleanup(call, created) {
  const errors = [];
  if (created.project) {
    const deleted = await call('DELETE', `/projects/${created.project.id}`, { baseRevision: created.project.revision });
    if (deleted.status !== 204 || (await call('GET', `/projects/${created.project.id}`)).status !== 404) errors.push(`project ${deleted.status}`);
  }
  if (created.export && (await call('GET', `/exports/${created.export}/download`)).status !== 404) errors.push('export still downloadable');
  if (created.media) {
    const deleted = await call('DELETE', `/media/${created.media}`, {});
    if (deleted.status !== 204 || (await call('GET', `/media/${created.media}`)).status !== 404) errors.push(`media ${deleted.status}`);
  }
  return errors;
}

/**
 * @description The whole walk. Never throws: returns the RESULT fields, with every cleanup error named.
 * @param {{base: string, token: string, fetchImpl?: typeof fetch}} options Target. @returns {Promise<object>} Result.
 */
export async function runEditorAcceptance({ base, token, fetchImpl = fetch }) {
  const call = editorApi(base, token, fetchImpl), tag = `oshal-acceptance-${randomUUID().slice(0, 8)}`, created = {}, evidence = { tag };
  let failure = null;
  try {
    const permissions = (await call('GET', '/permissions')).json.permissions ?? {};
    expect(['create', 'change', 'delete', 'export'].every(action => permissions[action]), `the automation identity lacks editor permissions: ${JSON.stringify(permissions)}`);
    const media = await uploadClip(call); created.media = media.id; evidence.media = { frames: media.frames, durationMs: media.durationMs };
    const project = await call('POST', '/projects', { title: tag, document: timeline(tag, media, 30) });
    expect(project.status === 201, `create answered ${project.status} ${project.json.error ?? ''}`); created.project = project.json.project;
    const saved = await call('POST', `/projects/${created.project.id}/revisions`, { baseRevision: 1, title: tag, document: timeline(tag, media, 20) });
    expect(saved.status === 201 && saved.json.project.revision === 2, `save answered ${saved.status}`); created.project = saved.json.project;
    const stale = await call('POST', `/projects/${created.project.id}/revisions`, { baseRevision: 1, title: tag, document: timeline(tag, media, 25) });
    expect(stale.status === 409, `a stale save answered ${stale.status}`);
    const row = await exportAndDownload(call, created.project.id, 2); created.export = row.id;
    evidence.export = { frames: row.outputFrames, durationMs: row.outputDurationMs, bytes: row.outputBytes };
    expect(row.outputFrames === 20, `the export has ${row.outputFrames} frames, not the saved 20`);
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const cleanupErrors = await cleanup(call, created).catch(error => [`cleanup threw: ${error.message}`]);
  const pass = !failure && !cleanupErrors.length;
  return { case: CASE_ID, state: pass ? 'pass' : 'fail', failure, cleanupErrors, evidence };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = String(process.env.OSHAL_VERIFY_BASE_URL || 'http://localhost:35457').replace(/\/+$/, ''), token = readOperatorPat(process.env);
  if (!token) { process.stdout.write(`RESULT ${JSON.stringify({ case: CASE_ID, state: 'fail', failure: `${PAT_ENV} is not set` })}\n`); process.exit(1); }
  const result = await runEditorAcceptance({ base, token });
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  process.exit(result.state === 'pass' ? 0 : 1);
}
