/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video editor's browser client for /api/video/editor (CREATE-EDIT-05d): same-origin JSON and multipart calls that never cache, stable error codes on every failure, and the plain-language sentence each refusal shows the person.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */

export const BASE = '/api/video/editor';
let nativeChunkBytes = null;
/** @description Select only the server-advertised bounded native transport. */
export function configureMediaTransport(transport) {
  nativeChunkBytes = Number.isInteger(transport?.chunkBytes) && transport.chunkBytes > 0 && transport.chunkBytes <= 131072
    ? transport.chunkBytes : null;
}
/** @description Hash and send one fixed offset; uncertain mutations are never retried automatically. */
async function uploadChunks(kind, file) {
  const size = nativeChunkBytes;
  const begin = await call(`/media?kind=${kind}`, {method: 'POST', body: {op: 'begin', bytes: file.size}});
  if (begin.chunkBytes !== size) throw Object.assign(new Error('video_edit_upload_contract_changed'), {status: 409});
  for (let offset = 0; offset < file.size; offset += size) {
    const bytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
    await call(`/media?kind=${kind}`, {method: 'POST', body: {op: 'chunk', id: begin.id, offset, data: btoa(text), sha256}});
  }
  return (await call(`/media?kind=${kind}`, {method: 'POST', body: {op: 'finish', id: begin.id}})).media;
}


/** @description Plain-language explanations for the server's stable refusal codes. */
const WORDS = Object.freeze({
  video_edit_permission_denied: 'Your access does not include that action in the video editor.',
  video_edit_verified_identity_required: 'Sign in again to keep editing.',
  video_edit_revision_conflict: 'This project was saved somewhere else since you opened it.',
  video_edit_media_too_long: 'That file is too long: clips can be at most 30 seconds and music at most 60 seconds.',
  video_edit_media_too_large: 'That file is too large: clips can be at most 100 MB and music at most 32 MB.',
  video_edit_media_unsupported: 'That file is not supported: use an H.264 MP4 clip (with AAC sound or none) or a WAV music file.',
  video_edit_media_limit: 'Your uploads are full: remove unused media before adding more.',
  video_edit_media_unavailable: 'A clip in this project is no longer available.',
  video_edit_export_in_progress: 'An export is already running for you.',
  video_edit_export_queue_full: 'The exporter is busy. Try again in a minute.',
  video_edit_export_empty: 'Add a clip to the timeline before exporting.',
  video_edit_export_timeout: 'The export took too long and was stopped.',
  video_edit_permission_revoked: 'Your access changed while exporting, so the export was stopped.',
  video_edit_export_interrupted: 'The export was interrupted by a restart. Start it again.',
});

/**
 * @description Words for a failure: the server's own code when it is known, otherwise a neutral sentence.
 * @param {Error & {code?: string, status?: number}} error Failure. @returns {string} Sentence.
 */
export function describe(error) {
  if (error?.code && WORDS[error.code]) return WORDS[error.code];
  if (error?.status === 401) return WORDS.video_edit_verified_identity_required;
  if (error?.status === 403) return WORDS.video_edit_permission_denied;
  if (error?.offline) return 'The video editor could not be reached. Your edits are still here.';
  return 'Something went wrong. Your edits are still here.';
}

async function parse(response) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { status: response.status, code: body.error });
  return body;
}

/**
 * @description Call one editor route with an optional JSON body.
 * @param {string} path Path under /api/video/editor. @param {{method?: string, body?: object}} options Request.
 * @returns {Promise<object>} Parsed JSON; failures carry `status` and the server `code`.
 */
export async function call(path, options = {}) {
  let response;
  try {
    response = await fetch(BASE + path, { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch { throw Object.assign(new Error('offline'), { offline: true }); }
  return parse(response);
}

/**
 * @description Upload one file as a clip or a music bed.
 * @param {'video'|'audio'} kind Declared kind. @param {File} file Chosen file. @returns {Promise<object>} Verified media metadata.
 */
export async function upload(kind, file) {
  if (nativeChunkBytes !== null) return uploadChunks(kind, file);
  const form = new FormData();
  form.append('media', file, file.name || kind);
  let response;
  try { response = await fetch(`${BASE}/media?kind=${kind}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', body: form }); }
  catch { throw Object.assign(new Error('offline'), { offline: true }); }
  return (await parse(response)).media;
}

/** @description Where an owned upload plays from. @param {string} id Media UUID. @returns {string} URL. */
export function mediaUrl(id) { return `${BASE}/media/${encodeURIComponent(id)}`; }
/** @description Where a finished export downloads from. @param {string} id Export UUID. @param {boolean} inline Play in the page. @returns {string} URL. */
export function exportUrl(id, inline = false) { return `${BASE}/exports/${encodeURIComponent(id)}/download${inline ? '?inline=1' : ''}`; }
