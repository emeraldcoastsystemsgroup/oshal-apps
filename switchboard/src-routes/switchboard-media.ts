/**
 * Switchboard Media — an image attached to a post, and its upload to X.
 *
 * A post's attached image travels as its `mediaRef`: a `data:image/<png|jpeg|gif|webp>;base64,…` URL (the image the
 * Composer generated and the person attached; Streams variants and scheduled Calendar posts store the same value).
 * This module reads that reference and uploads the bytes to X with the v2 chunked media upload, so every publisher
 * (Compose, Send to all, Streams, the Calendar executor) attaches the same way:
 *
 *   POST https://api.twitter.com/2/media/upload/initialize  {media_type,total_bytes,media_category}  → data.id
 *   POST …/2/media/upload/{id}/append                        {media:<base64 chunk>,segment_index}   (one per chunk)
 *   POST …/2/media/upload/{id}/finalize                                                             → data.processing_info?
 *   GET  …/2/media/upload?command=STATUS&media_id={id}       (only while processing_info says pending/in_progress)
 *
 * The host is api.twitter.com, the X connector's API host: under the native kernel the egress places the person's own
 * X connection only on that host (api.x.com serves the same paths, but the credential never goes there). Chunks are
 * 512 KiB so each JSON body (base64 plus framing) stays under the kernel egress's 1 MiB request limit. X needs the
 * connection to carry the `media.write` scope for these calls; a connection made without it is refused by X (401/403)
 * and the publisher answers that in words: reconnect X, nothing was posted.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.7.0: publishing with an attached image. Reads a post's image mediaRef (data URL, PNG/JPEG/GIF/WEBP, at most 5 MB) and uploads it to X through the chunked v2 media upload on api.twitter.com (the X connector's API host), polling only while X says the media is processing; X's 401/403 on the upload reads as "reconnect X so it may upload media; nothing was posted". Before this the Compose route answered 501 for any attached media and Streams/Calendar dropped a variant's mediaRef without a word.
 *
 * @module switchboard-media
 */

/** The X v2 media upload base on the X connector's API host. */
export const X_MEDIA_UPLOAD = 'https://api.twitter.com/2/media/upload';
/** Raw bytes per append: base64 (4/3) plus the JSON framing stays under the kernel egress's 1 MiB request limit. */
export const X_CHUNK_BYTES = 512 * 1024;
/** X's limit for a Post image (tweet_image) and the most this package attaches. */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
/** The longest a publish waits for X to finish processing an upload. */
const PROCESSING_WAIT_MS = 20_000;

/** The image types X attaches to a Post, with the media category each uploads under. */
const MEDIA_TYPES: Record<string, string> = {
  'image/png': 'tweet_image',
  'image/jpeg': 'tweet_image',
  'image/webp': 'tweet_image',
  'image/gif': 'tweet_gif',
};

/** An attached image read from its reference. */
export interface PostMedia { mime: string; category: string; bytes: Buffer }

/** A refusal the publisher answers with (and posts nothing). */
export type MediaRefusal = { ok: false; code: number; error: string; message: string };

/**
 * @description Read a post's attached image from its mediaRef. Only an image data URL this package can attach is
 * accepted; anything else is refused in words so a post never goes out without the image the person attached.
 * @param ref - The mediaRef (a `data:image/…;base64,…` URL).
 * @returns The image, or a refusal.
 */
export function readMediaRef(ref: unknown): PostMedia | MediaRefusal {
  const raw = typeof ref === 'string' ? ref.trim() : '';
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(raw);
  if (!match) {
    return { ok: false, code: 400, error: 'media_unreadable', message: 'The attached image could not be read. Attach the image again, or remove it, then publish. Nothing was posted.' };
  }
  const mime = match[1].toLowerCase();
  const category = MEDIA_TYPES[mime];
  if (!category) {
    return { ok: false, code: 400, error: 'media_type_unsupported', message: `X attaches PNG, JPEG, GIF or WEBP images; this one is ${mime}. Nothing was posted.` };
  }
  const bytes = Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64');
  if (!bytes.length) return { ok: false, code: 400, error: 'media_unreadable', message: 'The attached image is empty. Attach the image again, then publish. Nothing was posted.' };
  if (bytes.length > MAX_MEDIA_BYTES) {
    return { ok: false, code: 413, error: 'media_too_large', message: `The attached image is ${(bytes.length / 1048576).toFixed(1)} MB; X takes images up to 5 MB. Nothing was posted.` };
  }
  return { mime, category, bytes };
}

/** One HTTP call to X: the caller's fetch with its auth headers already decided (none under the kernel egress). */
export type XFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

/** Read a JSON answer, or {} when X sent none. */
async function answer(r: Response): Promise<Record<string, unknown>> {
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

/** The words for an upload X refused: a 401/403 means the connection may not upload media. */
function uploadRefused(step: string, status: number, body: Record<string, unknown>): MediaRefusal {
  if (status === 401 || status === 403) {
    return { ok: false, code: 403, error: 'x_media_not_allowed',
      message: `X refused the image upload (HTTP ${status}): your X connection was made without permission to upload media. Reconnect X in Connections, then publish again. Nothing was posted.` };
  }
  return { ok: false, code: 502, error: 'media_upload_failed',
    message: `X did not accept the image (${step}, HTTP ${status}${body?.detail ? `: ${String(body.detail).slice(0, 160)}` : ''}). Nothing was posted.` };
}

/** The processing state X reports for an upload, when it reports one. */
function processing(body: Record<string, unknown>): { state: string; after: number } | null {
  const info = (body?.data as { processing_info?: { state?: string; check_after_secs?: number } } | undefined)?.processing_info;
  return info?.state ? { state: String(info.state), after: Number(info.check_after_secs) || 1 } : null;
}

/** Wait while X processes the upload; answers a refusal when it fails or does not finish in time. */
async function awaitProcessing(xfetch: XFetch, id: string, first: { state: string; after: number } | null, sleep: (ms: number) => Promise<void>): Promise<MediaRefusal | null> {
  let info = first;
  let waited = 0;
  while (info && (info.state === 'pending' || info.state === 'in_progress')) {
    const pause = Math.min(info.after, 5) * 1000;
    if (waited + pause > PROCESSING_WAIT_MS) {
      return { ok: false, code: 504, error: 'media_processing_timeout', message: 'X was still processing the image after 20 seconds. Publish again in a minute. Nothing was posted.' };
    }
    await sleep(pause);
    waited += pause;
    const r = await xfetch(`${X_MEDIA_UPLOAD}?command=STATUS&media_id=${encodeURIComponent(id)}`, { method: 'GET' });
    const body = await answer(r);
    if (r.status < 200 || r.status >= 300) return uploadRefused('status', r.status, body);
    info = processing(body);
  }
  if (info && info.state === 'failed') {
    return { ok: false, code: 502, error: 'media_processing_failed', message: 'X could not process the image. Try another image. Nothing was posted.' };
  }
  return null;
}

/**
 * @description Upload one image to X with the chunked v2 media upload and answer its media id. Each step's refusal
 * stops the upload and is answered in words; nothing is posted by this function.
 * @param xfetch - The fetch to X (the kernel egress under the native kernel, else one carrying the Bearer token).
 * @param media - The image (readMediaRef).
 * @param sleep - Waits between processing checks (a test passes an instant one).
 * @returns { ok: true, mediaId } or a refusal.
 */
export async function uploadToX(
  xfetch: XFetch,
  media: PostMedia,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ ok: true; mediaId: string } | MediaRefusal> {
  const json = { 'Content-Type': 'application/json' };
  const init = await xfetch(`${X_MEDIA_UPLOAD}/initialize`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ media_type: media.mime, total_bytes: media.bytes.length, media_category: media.category }),
  });
  const started = await answer(init);
  if (init.status < 200 || init.status >= 300) return uploadRefused('initialize', init.status, started);
  const id = String((started.data as { id?: unknown } | undefined)?.id ?? '');
  if (!/^[0-9]{1,19}$/.test(id)) return uploadRefused('initialize', 502, { detail: 'no media id in the answer' });
  for (let index = 0, offset = 0; offset < media.bytes.length; index += 1, offset += X_CHUNK_BYTES) {
    const chunk = media.bytes.subarray(offset, offset + X_CHUNK_BYTES).toString('base64');
    const r = await xfetch(`${X_MEDIA_UPLOAD}/${id}/append`, { method: 'POST', headers: json, body: JSON.stringify({ media: chunk, segment_index: index }) });
    if (r.status < 200 || r.status >= 300) return uploadRefused('append', r.status, await answer(r));
  }
  const fin = await xfetch(`${X_MEDIA_UPLOAD}/${id}/finalize`, { method: 'POST' });
  const finished = await answer(fin);
  if (fin.status < 200 || fin.status >= 300) return uploadRefused('finalize', fin.status, finished);
  const stalled = await awaitProcessing(xfetch, id, processing(finished), sleep);
  if (stalled) return stalled;
  return { ok: true, mediaId: id };
}
