/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-27 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove the served table carries a code fingerprint, /sync echoes the same one, and the client announces exactly once when they disagree — the 2026-07-27 session ran a whole chapter on stale JS with no way to know.
 * 2026-07-31 11:50:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Tolerate CRLF checkouts when slicing the handshake block: the regex required \n}\n, so on Windows this guard was permanently red and training everyone to ignore it while store-ci stayed green.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createDndRoutes } = require('../routes/dnd-routes');

const root = path.join(__dirname, '..');

/** @description Invoke a public route and wait for its callback response. */
function request(router, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 0,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(value) { resolve({ status: this.statusCode, headers, body: String(value || '') }); },
    };
    Promise.resolve(router({ method: 'GET', url }, res,
      () => reject(new Error('route unexpectedly fell through')))).catch(reject);
  });
}

test('the served table document is stamped with the code fingerprint', async () => {
  const router = createDndRoutes({ appPackageDir: root });
  const response = await request(router, '/table');
  assert.equal(response.status, 200);
  const stamp = response.body.match(/window\.__dndBuild="([0-9a-f]{12})"/);
  assert.ok(stamp, 'the table must carry window.__dndBuild');
  // The same package must always mint the same fingerprint — it is a content
  // hash, so a no-op reload cannot nag every open tab to refresh.
  const again = await request(createDndRoutes({ appPackageDir: root }), '/table');
  assert.match(again.body, new RegExp(`window\\.__dndBuild="${stamp[1]}"`));
});

test('the client announces a newer served build exactly once, and never for its own', () => {
  const storySource = fs.readFileSync(path.join(root, 'ui', 'table-story.js'), 'utf8');
  assert.match(storySource, /noteServerBuild\(r\.build\)/, 'the sync poll must feed the handshake');
  const banners = [];
  const context = vm.createContext({
    window: { __dndBuild: 'aaaaaaaaaaaa' },
    banner: (message) => banners.push(message),
  });
  const block = storySource.match(/let staleBuildAnnounced[\s\S]*?\r?\n}\r?\n/);
  assert.ok(block, 'the handshake block must exist in table-story.js');
  vm.runInContext(block[0], context);
  vm.runInContext('noteServerBuild(""); noteServerBuild("aaaaaaaaaaaa");', context);
  assert.equal(banners.length, 0, 'a missing or matching build must stay silent');
  vm.runInContext('noteServerBuild("bbbbbbbbbbbb"); noteServerBuild("cccccccccccc");', context);
  assert.equal(banners.length, 1, 'a mismatch announces once, not on every poll');
  assert.match(banners[0], /refresh/i);
});

test('a page with no stamp never nags (older documents fail open)', () => {
  const storySource = fs.readFileSync(path.join(root, 'ui', 'table-story.js'), 'utf8');
  const banners = [];
  const context = vm.createContext({ window: {}, banner: (message) => banners.push(message) });
  vm.runInContext(storySource.match(/let staleBuildAnnounced[\s\S]*?\r?\n}\r?\n/)[0], context);
  vm.runInContext('noteServerBuild("bbbbbbbbbbbb");', context);
  assert.equal(banners.length, 0);
});
