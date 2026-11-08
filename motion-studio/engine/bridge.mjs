/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Frame the real isolated Rust worker for engine.exchange with bounded input/output and exact owned process cleanup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01: stage verified chunked media blobs in an isolated bridge cache directory for bounded video and audio assets.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, utimesSync, writeFileSync
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceIdentity } from './package-identity.mjs';

export const MAX_LINE = 12 * 1024 * 1024;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_STAGE_CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_STAGE_CACHE_BYTES = 256 * 1024 * 1024;
const STAGE_KEYS = new Set(['op', 'sha256', 'totalBytes', 'offset', 'data', 'reset']);

const environment = stagedDir => ({
  PATH: '/usr/bin:/bin',
  HOME: '/tmp',
  LANG: 'C.UTF-8',
  RUST_BACKTRACE: '0',
  ...(stagedDir ? { MOTION_STAGED_ASSET_DIR: stagedDir } : {})
});

async function binaryIdentity(binary) {
  return new Promise((done, reject) => {
    const child = spawn(binary, ['--identity'], { stdio: ['ignore', 'pipe', 'ignore'], env: environment() });
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('motion_identity_timeout')); }, 5000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('motion_engine_unavailable')); });
    child.stdout.on('data', data => { bytes = Buffer.concat([bytes, data]); if (bytes.length > 4096) child.kill('SIGKILL'); });
    child.once('close', code => {
      clearTimeout(timer);
      try { if (code !== 0 || bytes.length > 4096) throw new Error(); done(JSON.parse(bytes.toString('utf8'))); }
      catch { reject(new Error('motion_identity_invalid')); }
    });
  });
}

function evictStagedCache(stagedDir, incomingBytes) {
  const bins = readdirSync(stagedDir)
    .filter(name => name.endsWith('.bin'))
    .map(name => {
      const full = join(stagedDir, name);
      const st = statSync(full);
      return { full, size: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = bins.reduce((sum, item) => sum + item.size, 0);
  for (const item of bins) {
    if (total + incomingBytes <= MAX_STAGE_CACHE_BYTES) break;
    rmSync(item.full, { force: true });
    total -= item.size;
  }
}

function stageChunk(stagedDir, actual, req) {
  if (Object.keys(req).some(key => !STAGE_KEYS.has(key))) return { error: 'motion_invalid_request' };
  const { sha256, totalBytes, offset, data, reset } = req;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return { error: 'motion_asset_digest_mismatch' };
  if (!Number.isInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_MEDIA_BYTES) return { error: 'motion_asset_bytes_limit' };
  if (!Number.isInteger(offset) || offset < 0 || offset >= totalBytes) return { error: 'motion_stage_offset_mismatch' };
  if (typeof data !== 'string' || !data.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { error: 'motion_asset_invalid_encoding' };
  const chunk = Buffer.from(data, 'base64');
  if (!chunk.length || chunk.length > MAX_STAGE_CHUNK_BYTES || offset + chunk.length > totalBytes) return { error: 'motion_asset_bytes_limit' };
  const finalPath = join(stagedDir, `${sha256}.bin`), partPath = join(stagedDir, `${sha256}.part`);
  if (existsSync(finalPath) && statSync(finalPath).size === totalBytes) {
    const now = new Date(); utimesSync(finalPath, now, now);
    return { result: { staged: true, complete: true, bytes: totalBytes, sha256, upstream: actual.upstream } };
  }
  if (offset === 0 || reset === true) writeFileSync(partPath, chunk, { mode: 0o600 });
  else {
    if (!existsSync(partPath) || statSync(partPath).size !== offset) return { error: 'motion_stage_offset_mismatch' };
    appendFileSync(partPath, chunk);
  }
  const written = offset + chunk.length;
  if (written < totalBytes) return { result: { staged: true, complete: false, bytes: written, totalBytes, sha256, upstream: actual.upstream } };
  const digest = createHash('sha256').update(readFileSync(partPath)).digest('hex');
  if (digest !== sha256) { rmSync(partPath, { force: true }); return { error: 'motion_asset_digest_mismatch' }; }
  evictStagedCache(stagedDir, totalBytes);
  renameSync(partPath, finalPath);
  return { result: { staged: true, complete: true, bytes: written, sha256, upstream: actual.upstream } };
}

function parseStageIfPresent(packet, opaque) {
  if (!opaque) return packet.args.op === 'stage' ? packet.args : null;
  if (!packet.args.requestJson.includes('"stage"')) return null;
  try {
    const parsed = JSON.parse(packet.args.requestJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.op === 'stage' ? parsed : null;
  } catch {
    return null;
  }
}

function spawnWorker({ binary, stagedDir, actual, socket, leases, workers, timeoutMs, opaque, payload, fail, bindTimers }) {
  let output = [], outputSize = 0;
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'], env: environment(stagedDir) });
  workers.add(child);
  const timer = setTimeout(() => fail('motion_engine_timeout'), timeoutMs);
  bindTimers(child, timer);
  child.once('error', () => fail('motion_engine_unavailable'));
  child.stdin.on('error', () => fail('motion_engine_failed'));
  child.stdout.on('data', bytes => {
    outputSize += bytes.length;
    if (outputSize > MAX_LINE - 64) return fail('motion_engine_output_limit');
    output.push(bytes);
  });
  child.once('close', code => {
    workers.delete(child); leases.delete(socket); clearTimeout(timer); bindTimers(child, null, true);
    if (socket.destroyed || socket.writableEnded) return;
    let reply, replyJson;
    try { replyJson = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output)); reply = JSON.parse(replyJson); }
    catch { return fail('motion_engine_failed'); }
    if (!reply || typeof reply !== 'object' || Array.isArray(reply) || (code !== 0 && typeof reply.error !== 'string')
        || (reply.ok !== true && typeof reply.error !== 'string')) return fail('motion_engine_failed');
    if (reply.buildHash !== actual.buildHash) return fail('motion_engine_source_mismatch');
    const encoded = JSON.stringify(opaque ? { id: 1, buildHash: reply.buildHash, ok: reply.ok, error: reply.error, resultJson: replyJson } : { ...reply, id: 1 }) + '\n';
    if (Buffer.byteLength(encoded) > MAX_LINE) return fail('motion_engine_output_limit');
    socket.end(encoded);
  });
  child.stdin.end(payload);
}

function handleSocket({ socket, binary, stagedDir, actual, slots, timeoutMs, sockets, workers, leases, isClosing }) {
  sockets.add(socket);
  if (isClosing() || leases.size >= slots) {
    socket.end(JSON.stringify({ error: 'motion_engine_busy' }) + '\n');
    socket.once('close', () => sockets.delete(socket));
    return;
  }
  leases.add(socket);
  let child, handled = false, ended = false, stopped = false, parts = [], size = 0, timer, force;
  const bindTimers = (proc, nextTimer, clearForce = false) => { child = proc; timer = nextTimer; if (clearForce) clearTimeout(force); };
  const stop = () => {
    clearTimeout(timer);
    if (!stopped && child && child.exitCode === null && child.signalCode === null) {
      stopped = true; child.kill('SIGTERM'); force = setTimeout(() => child.kill('SIGKILL'), 500); force.unref();
    }
  };
  const fail = code => {
    if (!ended) {
      ended = true; socket.end(JSON.stringify({ id: 1, buildHash: actual.buildHash, error: code }) + '\n');
      const retire = setTimeout(() => socket.destroy(), 500); retire.unref();
    }
    stop();
  };
  socket.on('error', stop);
  socket.once('close', () => { sockets.delete(socket); stop(); if (!child) leases.delete(socket); });
  socket.setTimeout(50000, () => fail('motion_request_timeout'));
  socket.write(JSON.stringify({ bridge: actual }) + '\n');
  socket.on('data', data => {
    if (handled) { if (data.some(byte => ![9, 10, 13, 32].includes(byte))) fail('motion_single_request_required'); return; }
    size += data.length; if (size > MAX_LINE) { fail('motion_request_limit'); handled = true; return; }
    const newline = data.indexOf(10); if (newline < 0) { parts.push(data); return; }
    handled = true;
    if (data.subarray(newline + 1).some(byte => ![9, 10, 13, 32].includes(byte))) return fail('motion_single_request_required');
    parts.push(data.subarray(0, newline)); let packet;
    try { packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); } catch { return fail('motion_invalid_request'); }
    parts = [];
    if (!packet || typeof packet !== 'object' || Array.isArray(packet) || Object.keys(packet).some(k => !['id', 'cmd', 'args'].includes(k))
        || packet.id !== 1 || packet.cmd !== 'motion' || !packet.args || typeof packet.args !== 'object' || Array.isArray(packet.args)) return fail('motion_invalid_request');
    const opaque = Object.prototype.hasOwnProperty.call(packet.args, 'requestJson');
    if (opaque && (Object.keys(packet.args).length !== 1 || typeof packet.args.requestJson !== 'string' || Buffer.byteLength(packet.args.requestJson) > MAX_LINE)) return fail('motion_invalid_request');
    const stageReq = parseStageIfPresent(packet, opaque);
    if (stageReq) {
      const outcome = stageChunk(stagedDir, actual, stageReq);
      if (outcome.error) return fail(outcome.error);
      const replyObj = { ok: true, buildHash: actual.buildHash, result: outcome.result };
      leases.delete(socket); ended = true;
      socket.end(JSON.stringify(opaque ? { id: 1, buildHash: actual.buildHash, ok: true, resultJson: JSON.stringify(replyObj) } : { ...replyObj, id: 1 }) + '\n');
      return;
    }
    spawnWorker({ binary, stagedDir, actual, socket, leases, workers, timeoutMs, opaque, payload: opaque ? packet.args.requestJson : JSON.stringify(packet.args), fail, bindTimers });
  });
}

/** The installation chooses the binary/listen address; caller packets contain no path, host or owner selector. */
export async function startMotionBridge({ binary, host = '127.0.0.1', port = 0, slots = 2, timeoutMs = 45000, identity = sourceIdentity() } = {}) {
  if (typeof binary !== 'string' || !binary.startsWith('/') || !Number.isInteger(slots) || slots < 1 || slots > 4
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 50000) throw new Error('motion_bridge_invalid_configuration');
  const actual = await binaryIdentity(binary);
  if (!actual || ['protocol', 'buildHash', 'upstream'].some(key => actual[key] !== identity[key])) throw new Error('motion_engine_source_mismatch');
  const stagedDir = mkdtempSync(join(tmpdir(), 'motion-bridge-staged-'));
  const sockets = new Set(), workers = new Set(), leases = new Set(); let closing = false;
  const server = createServer(socket => handleSocket({
    socket, binary, stagedDir, actual, slots, timeoutMs, sockets, workers, leases, isClosing: () => closing
  }));
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
  } catch (err) {
    await rm(stagedDir, { recursive: true, force: true });
    throw err;
  }
  return {
    address: server.address(),
    identity: actual,
    state: () => ({ connections: sockets.size, workers: workers.size, leases: leases.size }),
    close: async () => {
      closing = true;
      const exits = [...workers].map(child => new Promise(done => child.once('close', done)));
      for (const socket of sockets) socket.destroy();
      await new Promise(done => server.close(done));
      await Promise.all(exits);
      await rm(stagedDir, { recursive: true, force: true });
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bridge = await startMotionBridge({
    binary: process.env.MOTION_ENGINE_BINARY,
    host: process.env.MOTION_ENGINE_HOST || '127.0.0.1',
    port: Number(process.env.MOTION_ENGINE_PORT || 7414)
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bridge.close().then(() => process.exit(0)));
}
