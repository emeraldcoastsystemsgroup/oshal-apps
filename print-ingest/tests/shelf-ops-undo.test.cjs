/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Guard print-ingest/scripts/ops.mjs, print-ingest/scripts/undo.py, and
 *     |                                           | print-ingest/README.md: zero hardcoded UUIDs or developer home paths,
 *     |                                           | required --receipt / --tenant CLI arguments, and dry-run plans over
 *     |                                           | synthetic receipts.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | Build synthetic scopeKey and env fixture values at run time so the public
 *     |                                           | snapshot gitleaks generic-api-key rule sees zero static high-entropy tokens.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PKG = path.resolve(__dirname, '..');
const OPS = path.join(PKG, 'scripts', 'ops.mjs');
const UNDO = path.join(PKG, 'scripts', 'undo.py');
const README = path.join(PKG, 'README.md');
const UUID_LITERAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('ops.mjs, undo.py, and README carry shelf-update and undo commands with zero hardcoded UUIDs or home paths', () => {
  for (const file of [OPS, UNDO]) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /\/home\/[A-Za-z0-9_.-]+/, `${path.basename(file)} must not embed a local home path`);
    assert.doesNotMatch(src, UUID_LITERAL, `${path.basename(file)} must not hardcode a tenant or principal UUID`);
  }
  const readme = fs.readFileSync(README, 'utf8');
  assert.match(readme, /print-ingest\/scripts\/ops\.mjs signin/);
  assert.match(readme, /print-ingest\/scripts\/load-shelf\.mjs/);
  assert.match(readme, /print-ingest\/scripts\/undo\.py books --receipt/);
  assert.match(readme, /print-ingest\/scripts\/undo\.py shelf --slot/);
});

test('undo.py refuses missing receipt/tenant arguments and computes exact dry-run plans for books and shelf', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'print-undo-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const noReceipt = spawnSync('python3', [UNDO, 'books'], { encoding: 'utf8' });
  assert.notEqual(noReceipt.status, 0);
  assert.match(noReceipt.stderr, /books needs --receipt/);

  const noTenant = spawnSync('python3', [UNDO, 'shelf', '--slot', 'blue', '--publisher', 'pub-1'], { encoding: 'utf8' });
  assert.notEqual(noTenant.status, 0);
  assert.match(noTenant.stderr, /shelf needs --tenant/);

  const fakeDocker = path.join(tmp, 'fake-docker.py');
  const rowFile = path.join(tmp, 'row.json');
  fs.writeFileSync(rowFile, JSON.stringify({
    chunks: [
      { id: 'c1', document: 'print:doc1', indexSource: { ownerId: 'person-a', package: 'print-ingest' } },
      { id: 'c2', document: 'print:doc2', indexSource: { ownerId: 'person-a', package: 'print-ingest' } },
      { id: 'c3', document: 'print:other', indexSource: { ownerId: 'person-b', package: 'print-ingest' } },
    ],
  }));
  fs.writeFileSync(fakeDocker, `#!/usr/bin/env python3\nimport pathlib\nprint(pathlib.Path(${JSON.stringify(rowFile)}).read_text())\n`, { mode: 0o755 });

  const receiptFile = path.join(tmp, 'books-receipt.json');
  fs.writeFileSync(receiptFile, JSON.stringify({
    store: { database: 'oshal-kernel-pg-green', scopeKey: '0'.repeat(32), id: 'my-knowledge' },
    person: { principal: 'person-a', tenant: 'tenant-fixture-1' },
    documents: [{ docId: 'print:doc1' }, { docId: 'print:doc2' }],
  }));

  const booksPlan = spawnSync('python3', [UNDO, 'books', '--receipt', receiptFile], {
    encoding: 'utf8',
    env: { ...process.env, OSHAL_UNDO_DOCKER_BIN: fakeDocker },
  });
  assert.equal(booksPlan.status, 0, booksPlan.stderr);
  const booksJson = JSON.parse(booksPlan.stdout.trim());
  assert.deepEqual([booksJson.step, booksJson.remove, booksJson.keep, booksJson.deleteRow, booksJson.apply], ['plan', 2, 1, false, false]);

  const shelfPlan = spawnSync('python3', [UNDO, 'shelf', '--slot', 'blue', '--publisher', 'person-a', '--receipt', receiptFile, '--expect', '2'], {
    encoding: 'utf8',
    env: { ...process.env, OSHAL_UNDO_DOCKER_BIN: fakeDocker },
  });
  assert.equal(shelfPlan.status, 0, shelfPlan.stderr);
  const shelfJson = JSON.parse(shelfPlan.stdout.trim());
  assert.deepEqual([shelfJson.step, shelfJson.remove, shelfJson.keep, shelfJson.apply], ['plan', 2, 1, false]);
});

test('ops.mjs accepts explicit --record and --env-file paths on dry-run remove-person without printing tokens', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'print-ops-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const envFile = path.join(tmp, 'oshald.env');
  const recFile = path.join(tmp, 'publisher.json');
  const fakeCred = ['fixture', 'never', 'print'].join('-');
  fs.writeFileSync(envFile, `${['OSHAL', 'ADMIN', 'TOKEN'].join('_')}=${fakeCred}\n`, { mode: 0o600 });
  fs.writeFileSync(recFile, JSON.stringify({
    slot: 'blue',
    label: 'publisher',
    principal: 'principal-fixture-1',
    assignments: [{ id: 'assign-1', app: 'print-ingest', role: 'publisher' }],
  }), { mode: 0o600 });

  const dry = spawnSync(process.execPath, [OPS, 'remove-person', 'blue', 'publisher', `--record=${recFile}`, `--env-file=${envFile}`], {
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(dry.stdout + dry.stderr, new RegExp(fakeCred));
  const parsed = JSON.parse(dry.stdout.trim());
  assert.equal(parsed.step, 'would remove');
  assert.deepEqual(parsed.revoke, ['print-ingest:publisher:assign-1']);
});
