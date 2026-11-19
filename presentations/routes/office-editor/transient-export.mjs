/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render a bounded supplied Word model through current original-person export authority without creating documents or revisions.
 */
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {actor, access} from './authorization.mjs';
import {renderOffice, modelHash, MIME} from './formats.mjs';
import {validate, OfficeError, fail} from '../../tools/office/model.mjs';

const require = createRequire(import.meta.url);
const json = require('express').json({limit: 524288, strict: true});
const FORMATS = new Set(['docx', 'pdf', 'rtf']);
const TIMEOUT = 15000, MAX_BYTES = 8388608;
let rendering = 0;

function input(body, query) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 3 || Object.keys(body).some(key => !['model', 'format', 'modelSha256'].includes(key))
    || Object.keys(query || {}).length || !FORMATS.has(body.format)
    || typeof body.modelSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.modelSha256)) {
    fail('office_invalid_export', 'Choose a supported format and the exact supplied Word model.');
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 524288) fail('office_request_limit', 'This export request exceeds 512 KiB.', 413);
  const model = validate(body.model);
  if (model.kind !== 'docx' || model.pages.some(page => page.blocks.some(block => block.type === 'image'))) {
    fail('office_invalid_export', 'Transient export supports Word text and tables without embedded resources.');
  }
  if (modelHash(model) !== body.modelSha256) fail('office_export_changed', 'The supplied document changed. Read it again before downloading.');
  return {model, format: body.format};
}

function lifetime(req, res, clock) {
  const deadline = clock() + TIMEOUT;
  let reason, reject;
  const stopped = new Promise((_resolve, no) => { reject = no; });
  stopped.catch(() => {});
  const stop = error => { if (!reason) { reason = error; reject(error); } };
  const canceled = () => stop(new OfficeError('office_export_canceled', 'The download request ended. Try again when ready.', 499));
  const closed = () => { if (!res.writableFinished && !res.headersSent) canceled(); };
  const timer = setTimeout(() => stop(new OfficeError('office_export_timeout', 'The download took too long. Your source is unchanged; retry when ready.', 504)), TIMEOUT);
  timer.unref?.();
  req.once?.('aborted', canceled); res.once?.('close', closed);
  return {stopped, check() {
    if (req.aborted || res.destroyed) canceled();
    if (clock() >= deadline) stop(new OfficeError('office_export_timeout', 'The download took too long. Your source is unchanged; retry when ready.', 504));
    if (reason) throw reason;
  }, dispose() {
    clearTimeout(timer); req.removeListener?.('aborted', canceled); res.removeListener?.('close', closed);
  }};
}

async function render(model, format, life, renderer) {
  life.check();
  if (rendering >= 2) fail('office_export_busy', 'Two downloads are still rendering. Wait for them to finish, then retry.', 503);
  rendering++;
  const work = Promise.resolve().then(() => renderer(model, format)).finally(() => { rendering--; });
  return Promise.race([work, life.stopped]);
}

function refused(res, error) {
  if (res.headersSent || res.destroyed) return;
  const known = error instanceof OfficeError;
  const status = known ? error.status : error?.status === 413 ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503;
  res.status(status).json({error: known ? error.code : status === 413 ? 'office_request_limit' : status === 400 ? 'office_invalid_export' : 'office_backend_unavailable',
    message: known ? error.message : status === 413 ? 'This export request exceeds 512 KiB.' : status === 400 ? 'Provide a valid JSON export request.' : 'The Office backend could not render this download. Your source is unchanged.'});
}

/** Mount the fixed native-bound route. Optional dependencies exercise the same lifecycle with held real renders. */
export function registerTransientExports(router, ctx, {renderer = renderOffice, clock = () => performance.now()} = {}) {
  router.post('/exports', async (req, res) => {
    const life = lifetime(req, res, clock);
    try {
      const original = actor(ctx);
      await access(ctx, 'export', original); life.check();
      await Promise.race([new Promise((done, reject) => json(req, res, error => error ? reject(error) : done())), life.stopped]);
      life.check();
      const request = input(req.body, req.query);
      const bytes = await render(request.model, request.format, life, renderer);
      life.check();
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) fail('office_export_limit', 'This download exceeds the supported 8 MiB artifact limit.');
      await access(ctx, 'export', original); life.check();
      res.setHeader('Content-Type', MIME[request.format]);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    } catch (error) { refused(res, error); }
    finally { life.dispose(); }
  });
}
