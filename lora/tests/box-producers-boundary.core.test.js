/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the two real worker-side producers through the kernel's ADR-149 enforce boundary (kernel-callback-harness.cjs): the framework's Python box signer (scripts/comfyui-edge/lora_callback.py) and the dataset import's PowerShell command, whose Invoke-WebRequest download was the request refused authorization_identity_required on the live box. The download is now an empty signed POST; the command writes the image, reports ready, and cannot run a second time.
 */

'use strict';

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { A1, CORE, PNG, dispatchTrain, interpreter, runChild, seedCharacters, stagedImport, startKernelHarness, training,
  workerKey } = require('./helpers/kernel-callback-harness.cjs');

let h;

before(async () => {
  h = await startKernelHarness();
  await h.changeRole('owner_a');
}, { timeout: 180000 });

after(async () => { if (h) await h.stop(); });

beforeEach(() => seedCharacters(h));

const rows = async (sql, params = []) => (await h.fixture.pool.query(sql, params)).rows;

test('the framework Python box signer is admitted through the kernel rail', async () => {
  const helper = path.join(CORE, 'scripts', 'comfyui-edge', 'lora_callback.py');
  assert.ok(fs.existsSync(helper), `${helper} is missing`);
  const grant = await dispatchTrain(h);
  const driver = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("lora_callback", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps(m.post_json(sys.argv[2], m.load_grant(), sys.argv[3], json.loads(sys.argv[4]))))'].join('\n');
  const python = interpreter(['python3', 'python'], ['--version'], (out) => /Python 3/.test(out), 'python3');
  const result = await runChild(python, ['-c', driver, helper, h.base, Buffer.from('lcb_a').toString('base64url'),
    JSON.stringify(training(workerKey(A1)))], { ...process.env, OSHAL_LORA_CALLBACK_GRANT: grant.token });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { ok: true, kind: 'training', subject: 'drummer', version: 1, status: 'trained' });
  assert.deepEqual(await rows('SELECT status FROM oshal_lora_models WHERE character_id = $1', [A1]), [{ status: 'trained' }]);
});

test('the dataset import command downloads with a signed POST and reports ready through the kernel rail, once', async () => {
  const { command } = await stagedImport(h);
  const shell = interpreter(['powershell.exe', 'pwsh'], ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
    () => true, 'PowerShell');
  const first = await runChild(shell, ['-NoProfile', '-NonInteractive', '-Command', command], process.env);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const curated = path.join(h.boxRoot, workerKey(A1), 'curated');
  assert.ok(fs.readFileSync(path.join(curated, 'portrait.png')).equals(PNG));
  assert.equal(fs.readFileSync(path.join(curated, 'portrait.txt'), 'utf8'), 'drummer, portrait');
  assert.deepEqual(await rows('SELECT status, byte_size FROM oshal_lora_dataset_images'), [{ status: 'ready', byte_size: PNG.length }]);
  assert.deepEqual(await rows('SELECT image_id FROM oshal_lora_dataset_staging'), []);
  assert.deepEqual(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces'), [{ n: 2 }]);
  const again = await runChild(shell, ['-NoProfile', '-NonInteractive', '-Command', command], process.env);
  assert.notEqual(again.status, 0);
  assert.deepEqual(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces'), [{ n: 2 }]);
});
