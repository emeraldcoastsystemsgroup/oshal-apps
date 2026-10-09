/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the actual COMPILED video editor router with real Express and Multer from a core checkout, synthetic verified actors behind an authorization double shaped like the package context, and one explicitly NAMED ffprobe stand-in (fixtureProber) that reads the probe answer the test wrote into the upload itself. The kernel logger resolves to a recording double so a test can prove a failure was logged. Real ffprobe is exercised separately inside the runtime image (video-editor-media.test.mjs).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: a NAMED FFmpeg stand-in (fixtureEncoder, with its output prober) for export route and database tests - it reads the compiled frame count and canvas, writes a marker output, reports progress, can be held, and honours abort - and a refusing default so a suite that names none can never start an export. Real FFmpeg exports run in video-edit-export.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: options.extend lets the browser proof add the core's shared theme assets to the same loopback server after the editor router.
 */
import { createRequire } from 'node:module';
import Module from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
export const requireCore = createRequire(resolve(coreRoot, 'package.json'));
export const express = requireCore('express');
/** Everything the compiled routes log, so a test can prove a refusal or failure was recorded. */
export const logged = [];
const record = level => (fields, message) => logged.push({ level, fields, message });
const logger = { createChildLogger: () => ({ debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') }) };
const dependencies = new Map([['express', express], ['multer', requireCore('multer')], ['@/shared/logger', logger]]);
const requirePackage = createRequire(resolve(packageRoot, 'routes/video-editor-routes.js'));
const original = Module._load;

/** @description Load one compiled package module with the framework dependencies this fixture supplies.
 * @param {string} name File under routes/. @returns {object} Its exports. */
export function loadCompiled(name) {
  try {
    Module._load = function load(request, parent, main) { return dependencies.has(request) ? dependencies.get(request) : original.call(this, request, parent, main); };
    return requirePackage('./' + name);
  } finally { Module._load = original; }
}
const { createVideoEditorRoutes } = loadCompiled('video-editor-routes.js');

export const ISSUER = 'https://video-identity.fixture.test';
export const actors = {
  alice: { issuer: ISSUER, sub: 'alice', isActive: true, isSwarmAdmin: false },
  bob: { issuer: ISSUER, sub: 'bob', isActive: true, isSwarmAdmin: false },
  collision: { issuer: 'https://other-video.fixture.test', sub: 'alice', isActive: true, isSwarmAdmin: false },
  admin: { issuer: ISSUER, sub: 'admin', isActive: true, isSwarmAdmin: true },
  inactive: { issuer: ISSUER, sub: 'inactive', isActive: false, isSwarmAdmin: false },
};

/**
 * @description The NAMED ffprobe stand-in. Upload bodies built by `mediaBytes` carry a real container signature
 * followed by the JSON this prober returns, so each test states exactly what "ffprobe" reports for its bytes.
 * @param {string} file Uploaded file. @returns {Promise<object>} The embedded probe result.
 */
export async function fixtureProber(file) {
  const bytes = await readFile(file);
  return JSON.parse(bytes.subarray(12).toString('utf8'));
}
fixtureProber.fixtureName = 'video-editor-fixture-prober';

/**
 * @description The NAMED FFmpeg stand-in for route and database tests (real FFmpeg runs in video-edit-export.test.mjs). It reads the
 * compiled arguments it was given (frame count, canvas), writes a small marker file at the compiler's output name, reports progress,
 * and honours abort. `hold` keeps it "encoding" until released, so tests can observe queueing, cancellation and revocation.
 * @returns {{encoder: Function, prober: Function, release: Function, calls: object[]}} The pair and its controls.
 */
export function fixtureEncoder() {
  const calls = [], holds = [];
  let holding = false;
  const encoder = async request => {
    const frames = Number(request.args[request.args.indexOf('-frames:v') + 1]);
    const canvas = /scale=(\d+):(\d+):/.exec(request.args[request.args.indexOf('-filter_complex') + 1]);
    calls.push({ frames, args: request.args, cwd: request.cwd });
    request.onProgress?.(1);
    if (holding) await new Promise(done => { holds.push(done); request.signal.addEventListener('abort', done, { once: true }); });
    if (request.signal.aborted) return { code: null, signal: 'SIGTERM', stderrTail: '' };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(request.cwd, 'output.mp4'), Buffer.concat([Buffer.from('\0\0\0\x18ftypisom', 'latin1'),
      Buffer.from(JSON.stringify({ frames, width: Number(canvas[1]), height: Number(canvas[2]) }))]));
    return { code: 0, signal: null, stderrTail: '' };
  };
  encoder.fixtureName = 'video-editor-fixture-encoder';
  const prober = async file => {
    const { frames, width, height } = JSON.parse((await readFile(file)).subarray(12).toString('utf8'));
    return { frames, durationMs: Math.round((frames * 1000) / 30), width, height, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000, channels: 2 };
  };
  prober.fixtureName = 'video-editor-fixture-output-prober';
  return { encoder, prober, calls, hold: () => { holding = true; }, release: () => { holding = false; holds.splice(0).forEach(done => done()); } };
}

/** @description A probe answer for an H.264 MP4 clip. */
export function clipProbe({ seconds = 3, width = 320, height = 180, fps = '30/1', audio = true, codec = 'h264', extra = [] } = {}) {
  const streams = [{ codec_type: 'video', codec_name: codec, width, height, avg_frame_rate: fps, duration: String(seconds) }];
  if (audio) streams.push({ codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000', duration: String(seconds) });
  return { format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds) }, streams: [...streams, ...extra] };
}
/** @description A probe answer for a PCM WAV bed. */
export function bedProbe({ seconds = 10, codec = 'pcm_s16le' } = {}) {
  return { format: { format_name: 'wav', duration: String(seconds) },
    streams: [{ codec_type: 'audio', codec_name: codec, channels: 2, sample_rate: '48000', duration: String(seconds) }] };
}
/** @description Upload bytes: a real signature, then the named prober's answer. @returns {Buffer} */
export function mediaBytes(kind, probe, padding = 0) {
  const header = kind === 'video' ? Buffer.from('\0\0\0\x18ftypisom', 'latin1') : Buffer.from('RIFF\0\0\0\0WAVE', 'latin1');
  return Buffer.concat([header, Buffer.from(JSON.stringify(probe), 'utf8'), Buffer.alloc(padding, 32)]);
}
/** @description A multipart body with one `media` part. */
export function mediaForm(bytes, name = 'clip.mp4') {
  const form = new FormData(); form.append('media', new Blob([bytes]), name); return form;
}

/** @description A validated-shape timeline document referencing uploaded media. */
export function timeline(name = 'Synthetic edit', sources = {}, segments = [], extra = {}) {
  return { version: 1, name, profile: 'hd720p30', sources, segments, titles: [], audioBed: null, ...extra };
}

/**
 * @description Start the compiled router on loopback. Headers select a fixture actor; production code only ever sees
 * the context actor. `denied` removes named permissions; `decisions` records every authorize call.
 * @returns {Promise<object>} call(), origin, state, dataRoot.
 */
export async function startApi(t, pool, options = {}) {
  const dataRoot = options.dataRoot ?? await mkdtemp(resolve(tmpdir(), 'video-editor-media-'));
  const scope = new AsyncLocalStorage(), resources = new Map();
  const state = { denied: new Set(options.denied || []), decisions: [] };
  const authorization = {
    currentActor: () => scope.getStore(), registerResource: (name, adapter) => resources.set(name, adapter),
    authorize: async operation => {
      state.decisions.push(operation.permission);
      const actor = scope.getStore(), resource = resources.get(operation.permission.startsWith('editor.') ? 'editor' : 'studio');
      const own = actor && resource && await resource.authorize({ actor, operation, grant: { scope: 'own' } });
      return { allowed: !!own && !state.denied.has(operation.permission) };
    },
  };
  const app = express();
  app.use((req, _res, next) => scope.run(actors[req.header('x-fixture-actor') || 'alice'], next));
  app.use('/api/video', createVideoEditorRoutes({ pool, authorization, appPackageDir: packageRoot }, { dataRoot, prober: options.prober ?? fixtureProber,
    exports: options.exports ?? { encoder: async () => { throw new Error('Fixture: this suite starts no export; name a fixture encoder'); } } }));
  options.extend?.(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); if (!options.dataRoot) await rm(dataRoot, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body, actor = 'alice', headers = {}) => {
    const response = await fetch(origin + '/api/video' + path, { method,
      headers: { 'x-fixture-actor': actor, ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    const buffer = Buffer.from(await response.arrayBuffer()), text = buffer.toString('utf8');
    let result; try { result = JSON.parse(text); } catch { result = buffer; }
    return { status: response.status, headers: response.headers, body: result };
  };
  return { call, origin, state, dataRoot, resources };
}

/** @description A strict pool double: transaction control and owner-qualified reads only; any write or unqualified query throws. */
export function emptyPool() {
  const queries = [];
  return { queries, connect: async () => ({
    query: async (sql, values = []) => {
      queries.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK|SET|SELECT set_config|SELECT pg_advisory_xact_lock)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^SELECT/.test(sql) && /FROM video_edit_/.test(sql)) {
        if (!/owner_issuer=\$1/.test(sql) || !/owner_sub=\$2/.test(sql)) throw new Error('Fixture refused unqualified owner query');
        return { rows: /COUNT/.test(sql) ? [{ count: 0, bytes: '0' }] : [], rowCount: 0 };
      }
      throw new Error('Fixture refused unexpected SQL');
    }, release: () => undefined,
  }) };
}
