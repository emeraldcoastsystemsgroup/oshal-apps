/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the hexapod designer's four routes over real
 *                     |                             | loopback HTTP, mounted through the shared harness (express from
 *                     |                             | the framework checkout, the same doubles): the design with the
 *                     |                             | shape the Spider Design Studio reads, an unknown fit refused, the
 *                     |                             | document as markdown, every part in the CAD Studio hand-off
 *                     |                             | shape the drone and the arm use, an unknown part 404, the BOM
 *                     |                             | as CSV.
 *
 * FRAMEWORK-COUPLED: OSHAL_CORE_ROOT=$HOME/Documents/projects/oshal/src node --test tests/routes-hexapod.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadRoutes, PKG } = require('./routes.harness');
const { express, restore } = loadRoutes();
const { registerHexapodDesignRoutes, HEXAPOD_FITS } = require(path.join(PKG, 'routes', 'embodied-hexapod-routes.js'));

const app = express();
const router = express.Router();
registerHexapodDesignRoutes(router);
app.use('/api/embodied', router);
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}/api/embodied`; });
test.after(async () => { await new Promise((r) => server.close(r)); restore(); });

const call = async (p) => {
  const res = await fetch(base + p);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: res.status, body, headers: res.headers, text };
};

test('GET /build/hexapod answers the design in the shape the studio reads; an unknown fit is refused', async () => {
  const r = await call('/build/hexapod');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const d = r.body;
  assert.equal(d.simulated, true); assert.equal(d.generated, true); assert.equal(d.fit, 'spider-18');
  assert.equal(typeof d.massBudget.totalG, 'number'); assert.equal(typeof d.massBudget.targetG, 'number'); assert.equal(typeof d.massBudget.withinTarget, 'boolean');
  assert.ok(Array.isArray(d.printed) && d.printed.length === 13);
  for (const p of d.printed) { assert.ok(p.cad.base.kind); assert.ok(Array.isArray(p.cad.features)); assert.ok(p.massEachG > 0); }
  assert.ok(Array.isArray(d.bought) && d.bought.some((b) => b.id === 'pi5-8gb'));
  assert.ok(Array.isArray(d.joints) && d.joints.length === 3, 'joints is the array form');
  for (const j of d.joints) for (const k of ['joint', 'nm', 'usableNm', 'withinContinuous', 'pose']) assert.ok(k in j, `joints[].${k}`);
  assert.deepEqual(d.jump.map((j) => j.option), ['legs-hop', 'latched-spring']);
  assert.deepEqual(Object.keys(d.masses).sort(), ['bodyG', 'coxaLinkG', 'femurLinkG', 'tibiaLinkG']);
  assert.ok(Array.isArray(d.bom) && d.bom.length > 13);
  const same = await call('/build/hexapod?fit=spider-18');
  assert.equal(same.status, 200);
  const bad = await call('/build/hexapod?fit=spider-99');
  assert.equal(bad.status, 400); assert.equal(bad.body.error, 'unknown_fit'); assert.deepEqual(bad.body.fits, [...HEXAPOD_FITS]);
});

test('GET /build/hexapod/design.md is the generated document as markdown', async () => {
  const r = await call('/build/hexapod/design.md');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/markdown/);
  assert.ok(r.text.startsWith('# spider-18'));
  assert.ok(r.text.includes('## Mass budget') && r.text.includes('## Jump') && r.text.includes('## Bill of materials'));
  assert.equal((await call('/build/hexapod/design.md?fit=nope')).status, 400);
});

test('GET /build/hexapod/parts/:partId hands every part to CAD Studio in the drone\'s shape; an unknown part is 404', async () => {
  const ids = (await call('/build/hexapod')).body.printed.map((p) => p.id);
  for (const id of ids) {
    const r = await call(`/build/hexapod/parts/${id}`);
    assert.equal(r.status, 200, id);
    assert.equal(r.body.fit, 'spider-18');
    assert.deepEqual(Object.keys(r.body.cadStudio), ['title', 'base', 'features', 'source'], `${id}: the hand-off shape`);
    assert.deepEqual(r.body.cadStudio.source, { package: 'embodied', fit: 'spider-18', partId: id, qty: r.body.part.qty, material: r.body.part.material });
    assert.ok(r.body.cadStudio.title.includes(r.body.part.name));
    assert.ok(r.body.cadStudio.base.kind && Array.isArray(r.body.cadStudio.features));
  }
  const plate = await call('/build/hexapod/parts/plate');
  assert.equal(plate.body.part.qty, 2); assert.equal(plate.body.part.link, 'body');
  const housing = await call('/build/hexapod/parts/spring-housing');
  assert.equal(housing.body.part.option, 'latched-spring');
  const missing = await call('/build/hexapod/parts/wing');
  assert.equal(missing.status, 404); assert.equal(missing.body.error, 'unknown_part'); assert.deepEqual(missing.body.parts, ids);
});

test('GET /build/hexapod/bom.csv is the bill of materials as a CSV download', async () => {
  const r = await call('/build/hexapod/bom.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /spider-18-bom\.csv/);
  const lines = r.text.trimEnd().split('\n');
  assert.equal(lines[0], 'id,kind,name,qty,massEachG,totalG,approxUsdEach,approxUsdTotal,option,detail');
  const bom = (await call('/build/hexapod')).body.bom;
  assert.equal(lines.length, bom.length + 1);
});
