/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | An unwritable data folder: New object answers 503 storage_unavailable and leaves no job row (it had answered 500 create_failed after inserting an orphan 'capturing' job), and a photo that cannot be stored answers 503 in words without the data path (it had answered 422 with the raw ENOENT path in the toast). Over the shared loopback route fixture; red on the previous job-routes.js.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp (OSHAL_CORE_ROOT or OSHAL_CORE_DIR).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture, json, photo } = require('./routes-core.fixture.js');

let fixture;
test.before(async () => { fixture = await startFixture(); });
test.after(async () => { fs.chmodSync(fixture.tmp, 0o700); await fixture.close(); });

/** Make the data root read-only (as the package directory is in the native sandbox) for one step. */
async function readOnlyRoot(step) {
  fs.chmodSync(fixture.tmp, 0o500);
  try { return await step(); } finally { fs.chmodSync(fixture.tmp, 0o700); }
}

test('New object on an unwritable data folder answers storage_unavailable and leaves no job behind', async () => {
  fixture.control.sub = 'alice';
  const created = await readOnlyRoot(() => fixture.call('/jobs', json('POST', { title: 'blocked box' })));
  assert.equal(created.status, 503, JSON.stringify(created.body));
  assert.equal(created.body.error, 'storage_unavailable');
  assert.doesNotMatch(created.body.message, new RegExp(fixture.tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual((await fixture.call('/jobs')).body.jobs, [], 'no orphan capturing job');
  assert.deepEqual(fs.readdirSync(fixture.tmp), []);
});

test('a photo that cannot be stored answers in words, not with the data path', async () => {
  const created = await fixture.call('/jobs', json('POST', { title: 'box' }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.job.job_id;
  const owner = fs.readdirSync(fixture.tmp)[0];
  const jobDir = path.join(fixture.tmp, owner, id);
  fs.chmodSync(jobDir, 0o500);
  try {
    const body = new FormData();
    body.append('images', new Blob([await photo(60, 30)], { type: 'image/png' }), 'front.png');
    const up = await fixture.call(`/jobs/${id}/images`, { method: 'POST', body });
    assert.equal(up.status, 503, JSON.stringify(up.body));
    assert.equal(up.body.error, 'storage_unavailable');
    assert.doesNotMatch(JSON.stringify(up.body), /EACCES|ENOENT|\//);
  } finally { fs.chmodSync(jobDir, 0o700); }
  const refused = new FormData();
  refused.append('images', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'junk.png');
  const junk = await fixture.call(`/jobs/${id}/images`, { method: 'POST', body: refused });
  assert.equal(junk.status, 422, 'a photo that cannot be read is still refused as a photo');
  assert.equal(junk.body.error, 'image_ingest_failed');
});
