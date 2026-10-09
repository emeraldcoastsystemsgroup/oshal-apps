/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the public store cut at push time. The nightly publish refused at gate A on a vendor-prefixed test fixture (2026-10-06 to 10-08) and, once that was renamed, at gate B on 127 lines where the experience packages name carved commercial members; nothing ran the publish gates before 01:00, so each defect surfaced only as a stale public store. In the trunk this runs scripts/build-store-public.sh itself over HEAD, with docker withheld, and requires every gate before the gitleaks sweep to pass and no package to go missing. A public cut ships without that script (step 2), so there it pins what step 2 guarantees instead: no publish toolchain and no internal coordination thread. Each side runs exactly one real case; neither skips.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Run gate C too whenever a docker engine answers. With gates A and B fixed, the first complete cut was refused by gitleaks on three random-looking claim-token fixtures in career-hunter's Python contracts (added 2026-09-27), which a docker-withheld run cannot see. With an engine the case now requires the whole build to succeed (every gate clean, a one-commit snapshot, every package kept); without one a case still proves gates A to B3 and a second, named case is SKIPPED for gate C, which the local gate grades PARTIAL rather than green.
 */

/**
 * @file The public store cut, proved before a push instead of discovered at 01:00.
 *
 * The real boundary is the publish script, so the trunk case runs it, unmodified, against HEAD
 * (the commit a push publishes; uncommitted edits are not in a cut). With a docker engine the run
 * is the whole build: every gate, gitleaks included, must pass and the scratch directory must end
 * up a one-commit snapshot holding every package. Without an engine docker is replaced by a stub
 * that refuses, so the run ends at gate C with "docker unavailable": reaching that refusal, and
 * only that refusal, proves the commercial directory check, the vendor-prefix gate, the
 * personal-identifier gate, the private-trunk gate and the separation guard, and a separate gate C
 * case is reported skipped because gitleaks never ran. Nothing is ever pushed: the script only cuts.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'scripts', 'build-store-public.sh');

/** Every line the script prints when a gate before gitleaks passes, in the order it prints them. */
const CLEAN_GATES = [
  'Commercial-package check clean.',
  'Vendor-prefix gate clean.',
  'Personal-identifier gate clean.',
  'Private-trunk gate clean.',
  'Store-side repo-separation guard clean.',
];

/** What the script prints after the gitleaks sweep passes and the single-commit snapshot exists. */
const COMPLETE_CUT = ['Gitleaks entropy gate clean', 'Clean store snapshot ready:'];

/** The one refusal a cut without a docker engine may end on: gate C cannot run. */
const DOCKER_REFUSAL = 'REFUSING: docker unavailable';

/**
 * @description The child environment: the stub directory first, node's own directory next, and no
 * inherited GIT_* repository override. A pre-push hook exports GIT_DIR, and the script's own
 * `git -C <store>` cannot outrank it, so carrying it in would archive whatever repository the hook
 * named rather than this one.
 * @param {string} [stubDir] Directory holding the refusing docker stub; omitted for a plain git call.
 * @returns {Record<string,string>} The environment for the publish script.
 */
function childEnv(stubDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') || key === 'NODE_TEST_CONTEXT') delete env[key];
  }
  env.PATH = [stubDir, dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);
  return env;
}

/**
 * @description Top-level package directories of a tree on disk (a directory holding oshal-app.yaml).
 * @param {string} dir The tree root.
 * @returns {string[]} Sorted package directory names.
 */
function packagesOnDisk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * @description Top-level package directories committed at HEAD, which is what the script archives.
 * @returns {string[]} Sorted package directory names.
 */
function packagesAtHead() {
  const files = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf8', env: childEnv(), maxBuffer: 64 * 1024 * 1024,
  });
  return files.split('\n').map((file) => /^([^/]+)\/oshal-app\.yaml$/.exec(file)?.[1]).filter(Boolean).sort();
}

/**
 * @description Does a docker engine answer here? The same probe the script's gate C uses.
 * @returns {boolean} True when `docker version` reports a server.
 */
function dockerEngine() {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { env: childEnv(), encoding: 'utf8' });
  return !probe.error && probe.status === 0 && Boolean(probe.stdout.trim());
}

/**
 * @description A directory whose `docker` always refuses, so gate C reports the engine missing.
 * @param {string} work Scratch directory owned by the caller.
 * @returns {string} The stub directory to put first on PATH.
 */
function withheldDocker(work) {
  const stubDir = join(work, 'bin');
  mkdirSync(stubDir);
  const docker = join(stubDir, 'docker');
  writeFileSync(docker, '#!/bin/sh\necho "docker is withheld by build-store-public.test.mjs" >&2\nexit 97\n');
  chmodSync(docker, 0o755);
  return stubDir;
}

/**
 * @description Run the publish script into a scratch directory.
 * @param {string} work Scratch directory owned by the caller.
 * @param {string} [stubDir] A withheld-docker directory, or none to use the real engine.
 * @returns {{status:number|null,log:string,out:string}} Exit status, combined output and the cut path.
 */
function cut(work, stubDir) {
  const out = join(work, 'cut');
  const run = spawnSync('bash', [BUILD, out], {
    cwd: ROOT, env: childEnv(stubDir), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  return { status: run.status, log: `${run.stdout ?? ''}${run.stderr ?? ''}`, out };
}

/**
 * @description Require each line to appear in the log, in the given order.
 * @param {string} log The script's combined output.
 * @param {string[]} lines The expected lines, in order.
 */
function assertPrintedInOrder(log, lines) {
  const tail = log.split(/\r?\n/).slice(-40).join('\n');
  let from = 0;
  for (const line of lines) {
    const at = log.indexOf(line, from);
    assert.ok(at >= 0, `the cut never printed "${line}" (in order); the end of its log:\n${tail}`);
    from = at + line.length;
  }
}

/** @description Every refusal line the script printed. */
const refusalsIn = (log) => log.split(/\r?\n/).filter((line) => line.startsWith('REFUSING'));

/**
 * @description Cut HEAD into a fresh scratch directory and hand the result to a checker.
 * @param {boolean} useEngine True to run gate C on the real docker engine; false to withhold docker.
 * @param {(run: {status:number|null,log:string,out:string}) => void} check Assertions on the cut.
 */
function withCut(useEngine, check) {
  const work = mkdtempSync(join(tmpdir(), 'oshal-public-cut-'));
  try {
    const run = cut(work, useEngine ? undefined : withheldDocker(work));
    assert.deepEqual(packagesOnDisk(run.out), packagesAtHead(), 'the cut must carry every package HEAD carries');
    check(run);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (existsSync(BUILD) && dockerEngine()) {
  test('HEAD cuts a complete public snapshot through every publish gate, gitleaks included', () => {
    withCut(true, ({ status, log }) => {
      assertPrintedInOrder(log, [...CLEAN_GATES, ...COMPLETE_CUT]);
      assert.deepEqual(refusalsIn(log), [], 'a complete cut refuses nothing');
      assert.equal(status, 0, 'the complete cut must exit 0');
    });
  });
} else if (existsSync(BUILD)) {
  test('HEAD clears every publish gate before gitleaks (no docker engine here)', () => {
    withCut(false, ({ status, log }) => {
      assertPrintedInOrder(log, CLEAN_GATES);
      const refusals = refusalsIn(log);
      assert.equal(refusals.length, 1, `exactly one refusal is expected, at gate C:\n${refusals.join('\n')}`);
      assert.ok(refusals[0].startsWith(DOCKER_REFUSAL), `the cut stopped before gate C: ${refusals[0]}`);
      assert.equal(status, 1, 'a cut that could not run gitleaks must still exit non-zero');
    });
  });
  test('HEAD clears gate C (gitleaks)', { skip: 'no docker engine here: gate C cannot run, so this cut is unverified past gate B3' }, () => {});
} else {
  test('a public cut carries neither the publish toolchain nor the internal coordination thread', () => {
    for (const path of ['scripts/publish-store.sh', '.github/workflows/store-publish.yml', 'COLLABORATE.md']) {
      assert.equal(existsSync(join(ROOT, path)), false, `${path} must never ride a public snapshot`);
    }
    const handovers = readdirSync(ROOT, { recursive: true })
      .map(String)
      .filter((path) => !path.split(/[\\/]/).includes('.git') && /(^|[\\/])HANDOVER[^\\/]*\.md$/.test(path));
    assert.deepEqual(handovers, [], 'handover notes are internal and must never ride a public snapshot');
  });
}
