/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com     | The table preloaded a portrait for every monster and drew one for every villain and imported hero, and each id without bundled art answered 404 - on the native kernel "application asset not found". GET /content now names the bundled art (art.tokens, art.maps) and the table asks only for those. Over the package's real router: the list is exactly the files serveArt answers with an image; the table's own art loader, run against the served bundle, requests only listed ids and every request it makes answers 200; an unlisted id yields no URL; and no surface script builds a token URL outside tokenArtUrl.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createDndRoutes } = require('../routes/dnd-routes');

const ROOT = path.join(__dirname, '..');

/** @description Invoke one public GET through the real router and collect status and body. */
function get(router, url) {
  return new Promise((resolve, reject) => {
    const headers = {}, chunks = [];
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      getHeader(name) { return headers[name.toLowerCase()]; },
      end(body) { if (body) chunks.push(Buffer.from(body)); resolve({ status: res.statusCode, headers, body: Buffer.concat(chunks) }); },
    };
    router({ method: 'GET', url, headers: {} }, res, (error) => reject(error || new Error(`no route for ${url}`)));
  });
}

/** @description Run the table's art block (from the served runtime script) against a bundle, recording image requests. */
function tableArt(content) {
  const source = fs.readFileSync(path.join(ROOT, 'ui', 'table-runtime.js'), 'utf8');
  const start = source.indexOf('const art = {'), end = source.indexOf('const tokenImg');
  assert.ok(start > 0 && end > start, 'the runtime still carries its art block');
  const requested = [];
  const context = vm.createContext({
    API: '/api/dnd', content,
    Image: class { set src(url) { requested.push(url); } },
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.helpers = { loadArt, tokenArtUrl, mapArtUrl, artStyle };`, context);
  return { requested, ...context.helpers };
}

test('GET /content lists exactly the bundled portraits and maps serveArt answers with an image', async () => {
  const router = createDndRoutes({ appPackageDir: ROOT });
  const bundle = JSON.parse((await get(router, '/content')).body.toString('utf8'));
  const files = (dir, ext) => fs.readdirSync(path.join(ROOT, 'data', dir)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
  assert.deepEqual(bundle.art.tokens, files('tokens', '.png'));
  assert.deepEqual(bundle.art.maps, files('maps', '.jpg'));
  for (const id of bundle.art.tokens) assert.equal((await get(router, `/art/token/${id}`)).status, 200, id);
  const unlisted = Object.keys(bundle.monsters).filter((id) => !bundle.art.tokens.includes(id));
  assert.ok(unlisted.length > 0, 'the bestiary has monsters without portraits (the case the list exists for)');
  assert.equal((await get(router, `/art/token/${unlisted[0]}`)).status, 404, 'an unlisted portrait really is absent');
});

test('the table asks only for listed art, and every request it makes answers 200', async () => {
  const router = createDndRoutes({ appPackageDir: ROOT });
  const bundle = JSON.parse((await get(router, '/content')).body.toString('utf8'));
  const table = tableArt(bundle);
  table.loadArt();
  assert.ok(table.requested.length > 0);
  for (const url of table.requested) {
    const reply = await get(router, url.replace(/^\/api\/dnd/, ''));
    assert.equal(reply.status, 200, url);
  }
  const monstersWithout = Object.keys(bundle.monsters).filter((id) => !bundle.art.tokens.includes(id));
  for (const id of monstersWithout) {
    assert.equal(table.requested.some((url) => url.endsWith(`/art/token/${id}`)), false, `${id} has no portrait and is not requested`);
    assert.equal(table.tokenArtUrl(id), null);
  }
  assert.equal(table.artStyle(table.tokenArtUrl('imported-hero-without-art')), '');
  assert.equal(table.tokenArtUrl('bram'), '/api/dnd/art/token/bram');
});

test('a bundle without the art list keeps the earlier behaviour', () => {
  const table = tableArt({ heroes: [{ id: 'bram' }], monsters: {}, adventures: [] });
  assert.equal(table.tokenArtUrl('anything'), '/api/dnd/art/token/anything');
});

test('no surface script builds a portrait URL outside tokenArtUrl', () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'ui')).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(ROOT, 'ui', file), 'utf8');
    const builders = source.split('\n').filter((line) => line.includes('/art/token/') && !line.includes('const tokenArtUrl'));
    assert.deepEqual(builders, [], file);
  }
});
