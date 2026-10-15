/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | GET /capabilities over loopback HTTP states the upload ceilings that hold: with the routes' environment marking the native sandbox (OSHAL_EGRESS=kernel, what the kernel bridge sets) the .ply, video, photo and depth ceilings are the kernel's 10 MiB file cap with a 10 MiB request bound and the declared ceilings kept under `declared`; without it the declared 200 MiB .ply stands. Before this, /capabilities (and the scan-to-print-capabilities tool, which answers the same document) advertised 200 MiB on the native kernel.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Renamed from upload-limits.core.test.js: the store-CI surface job runs node --test "tests/*-*.test.js" with no framework checkout, and a hyphenated name put this framework-coupled suite in that wildcard (it failed there, as every core suite would).
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=<framework checkout> node --test tests/limits.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startFixture } = require('./routes-core.fixture.js');

const MiB = 1024 * 1024;
let fixture;
test.before(async () => { fixture = await startFixture(); });
test.after(async () => fixture.close());

test('/capabilities states the native cap in the native sandbox and the declared ceilings elsewhere', async () => {
  const declared = await fixture.call('/capabilities');
  assert.equal(declared.status, 200);
  assert.equal(declared.body.upload.host, 'declared');
  assert.equal(declared.body.upload.plyBytes, 200 * MiB);
  assert.equal(declared.body.upload.requestBytes, null);

  fixture.env.OSHAL_EGRESS = 'kernel';
  try {
    const native = (await fixture.call('/capabilities')).body.upload;
    assert.equal(native.host, 'native');
    for (const key of ['plyBytes', 'videoBytes', 'imageBytes', 'depthBytes']) assert.equal(native[key], 10 * MiB, key);
    assert.equal(native.requestBytes, 10 * MiB);
    assert.equal(native.declared.plyBytes, 200 * MiB);
    assert.equal(native.imagesPerRequest, 12);
  } finally { delete fixture.env.OSHAL_EGRESS; }
});
