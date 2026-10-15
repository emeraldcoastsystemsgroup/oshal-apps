/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The compiled upload-limits module states the ceilings that hold here: in the native sandbox (OSHAL_EGRESS=kernel, set by the kernel bridge) every per-file byte ceiling is the kernel's 10 MiB file cap and one request carries at most 10 MiB of files; elsewhere the routes' declared ceilings stand. /capabilities advertised a 200 MiB .ply the native kernel refuses at 10 MiB.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const limits = require(path.resolve(__dirname, '..', 'routes', 'upload-limits.js'));
const MiB = 1024 * 1024;
const DECLARED = Object.freeze({ imageBytes: 25 * MiB, imagesPerRequest: 12, imagesPerJob: 24, videoBytes: 300 * MiB, plyBytes: 200 * MiB, depthBytes: 64 * MiB });

test('in the native sandbox every per-file ceiling is the kernel cap and a request is bounded', () => {
  const native = limits.effectiveUploadLimits(DECLARED, { OSHAL_EGRESS: 'kernel' });
  assert.equal(limits.NATIVE_FILE_BYTES, 10 * MiB);
  assert.deepEqual({ ...native, declared: undefined }, { imageBytes: 10 * MiB, imagesPerRequest: 12, imagesPerJob: 24, videoBytes: 10 * MiB,
    plyBytes: 10 * MiB, depthBytes: 10 * MiB, host: 'native', requestBytes: 10 * MiB, declared: undefined });
  assert.deepEqual(native.declared, DECLARED, 'the routes\' own ceilings stay readable');
});

test('a ceiling already under the cap is kept, and outside the native sandbox the declared ceilings stand', () => {
  assert.equal(limits.effectiveUploadLimits({ ...DECLARED, imageBytes: 2 * MiB }, { OSHAL_EGRESS: 'kernel' }).imageBytes, 2 * MiB);
  const legacy = limits.effectiveUploadLimits(DECLARED, {});
  assert.equal(legacy.host, 'declared');
  assert.equal(legacy.requestBytes, null);
  assert.equal(legacy.plyBytes, 200 * MiB);
  assert.equal(limits.effectiveUploadLimits(DECLARED, { OSHAL_EGRESS: 'direct' }).plyBytes, 200 * MiB);
});
