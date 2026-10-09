/**
 * Guards for the move of the fantasy half to the fantasy-football package (ADR-146 D1).
 *
 * Two ways the move decays quietly: a copy of the fantasy engine comes back here beside the new
 * package (two advisors, two ledgers, one of them keyed for a shared cache the operator ruled out),
 * or the old routes start answering something that looks like data. So these read the package itself
 * and drive the compiled retirement route.
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — every method under /fantasy answers 410 with the fantasy-football address; no fantasy engine module remains (source or compiled); the router mounts the retirement route and not the engine; and the manifest no longer claims the fantasy-leagues skill or the espn-fantasy connector it no longer uses.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FANTASY_MOVED, registerFantasyMoved } = require('../routes/sports-fantasy-moved.js');

const PKG = path.resolve(__dirname, '..');

test('EVERY RETIRED FANTASY ROUTE ANSWERS 410 WITH THE NEW ADDRESS — never something that looks like data', () => {
  const mounted = [];
  registerFantasyMoved({ use: (p, handler) => mounted.push({ p, handler }) });
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].p, '/fantasy', 'router.use covers every method and every path below /fantasy');
  const res = { code: 0, body: null, status(n) { this.code = n; return this; }, json(b) { this.body = b; return this; } };
  mounted[0].handler({ method: 'GET', url: '/lineup' }, res);
  assert.equal(res.code, 410);
  assert.deepEqual(res.body, { ...FANTASY_MOVED });
  assert.equal(res.body.app, 'fantasy-football');
  assert.equal(res.body.movedTo, '/api/fantasy-football/');
});

test('NO FANTASY ENGINE MODULE REMAINS HERE — source or compiled', () => {
  const engine = ['scoring', 'winprob', 'roster', 'store', 'routes', 'espn'];
  for (const dir of ['src-routes', 'routes']) {
    const ext = dir === 'routes' ? '.js' : '.ts';
    for (const name of engine) {
      assert.equal(fs.existsSync(path.join(PKG, dir, `sports-fantasy-${name}${ext}`)), false, `${dir}/sports-fantasy-${name}${ext} is back`);
    }
  }
});

test('the router mounts the retirement route, not the engine', () => {
  const compiled = fs.readFileSync(path.join(PKG, 'routes', 'sports-routes.js'), 'utf8');
  assert.match(compiled, /require\("\.\/sports-fantasy-moved"\)/);
  assert.equal(/sports-fantasy-routes/.test(compiled), false);
});

test('the manifest no longer claims the fantasy skill or the ESPN Fantasy connector', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const uses = /^uses:\s*\[([^\]]*)\]/m.exec(manifest)[1].split(',').map((s) => s.trim());
  assert.equal(uses.includes('fantasy-leagues'), false, 'no module here imports the fantasy-leagues skill any more');
  assert.equal(/connectors:\s*\[[^\]]*espn-fantasy/.test(manifest), false, 'no route here reads a private league any more');
});
