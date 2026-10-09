/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run one package engine suite inside the LOCAL runtime image, which carries the FFmpeg/ffprobe and fonts the api uses: no pull, no network, read-only root and package mount, a private tmpfs, an unprivileged user, bounded memory/CPU/PIDs, a unique labelled name, and proof afterwards that the container is gone. The inner TAP summary must show every test passed; an exit code alone is not accepted.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The runtime image; overridable only to name another LOCAL tag of the same image. */
export const ENGINE_IMAGE = process.env.VIDEO_EDIT_ENGINE_IMAGE || 'oshal-bot:latest';

function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

/**
 * @description Run `node --test <file>` inside a disposable runtime-image container and return its parsed TAP summary.
 * @param {string} file Package-relative inner suite. @param {{timeoutMs?: number, minimumTests?: number}} options Bounds.
 * @returns {{counts: object, output: string, image: string, container: string}} The inner result.
 */
export function runInEngine(file, options = {}) {
  const image = docker(['image', 'inspect', ENGINE_IMAGE, '--format', '{{.Id}}']);
  assert.match(image, /^sha256:[a-f0-9]{64}$/, `the local ${ENGINE_IMAGE} image is required`);
  const token = randomUUID().replaceAll('-', '').slice(0, 16), name = `oshal-video-edit-engine-${token}`;
  const result = spawnSync('docker', ['run', '--rm', '--pull=never', '--name', name, '--label', `oshal.video-edit-engine=${token}`,
    '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=256m,mode=1777', '--memory', '640m', '--cpus', '1', '--pids-limit', '128',
    '--user', '65534:65534', '--security-opt', 'no-new-privileges', '-e', 'HOME=/tmp', '-e', 'OSHAL_CORE_ROOT=/app',
    '-v', `${packageRoot}:/pkg/video:ro`, '-w', '/pkg/video', '--entrypoint', 'node', image,
    '--test', '--test-concurrency=1', '--test-reporter=tap', file], { encoding: 'utf8', timeout: options.timeoutMs ?? 240000, maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let remaining = '';
  try { remaining = docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']); }
  finally { if (remaining) docker(['rm', '--force', name]); }
  assert.equal(remaining, '', 'the engine container removed itself');
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = new RegExp(`^# ${key} (\\d+)\\s*$`, 'm').exec(output);
    counts[key] = match ? Number(match[1]) : null;
  }
  assert.equal(result.status, 0, output.slice(-4000));
  assert.ok(counts.tests >= (options.minimumTests ?? 1) && counts.pass === counts.tests, output.slice(-4000));
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[key], 0, `${key}: ${output.slice(-2000)}`);
  return { counts, output, image, container: name };
}
