/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the actual mounted transient Word export route, original-person authority, real file bytes and transport limits without creating Office records.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hold real serializer output through current-person withdrawal, deadlines and canceled requests; keep rendering capacity charged until the actual work settles.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify optional Word paragraph borderBottom, tabRight and native OOXML tab runs in DOCX, PDF and RTF exports without altering existing models.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createOfficeEditorRoutes} from '../../routes/office-editor/application.mjs';
import {initial, validate, stableJSON} from '../../tools/office/model.mjs';
import {registerTransientExports} from '../../routes/office-editor/transient-export.mjs';
import {renderOffice} from '../../routes/office-editor/formats.mjs';

const require = createRequire(import.meta.url);
const express = require('express');
const Zip = require('jszip');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PATH = '/api/presentations/editor/exports';

/** Real application routes and serializers; only the outside request-person port is controlled. */
async function mounted(t, helper) {
  const state = {active: true, denied: new Set(), sql: 0,
    person: {issuer: 'transient-fixture', sub: 'original', principalId: 'person-1', tenantIds: ['tenant-1']}};
  const ctx = {appPackageDir: ROOT,
    pool: {connect: async () => { state.sql++; throw new Error('Transient export must not access SQL'); }},
    authorization: {registerResource() {}, currentActor: () => ({...state.person, isActive: state.active}),
      authorize: async ({permission}) => ({allowed: state.active && !state.denied.has(permission)})}};
  const app = express();
  if (helper) {
    const router = express.Router();
    registerTransientExports(router, ctx, helper);
    app.use('/api/presentations/editor', router);
  }
  app.use('/api/presentations/editor', createOfficeEditorRoutes(ctx));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const ready = await fetch(origin + '/api/presentations/editor/permissions');
  assert.equal(ready.status, 200, 'existing real Office factory must load before feature assertions');
  assert.equal((await ready.json()).permissions.export, true, 'fixture admits actual export permission');
  return {origin, state};
}

function body(format = 'docx') {
  const source = initial('docx', 'Supplied Word source');
  source.pages[0].blocks[0].runs[0].text = 'Original supplied text, not a newly saved document.';
  const model = validate(source);
  const modelSha256 = createHash('sha256').update(stableJSON(model)).digest('hex');
  return {model, format, modelSha256};
}

async function post(f, input, signal) {
  return fetch(f.origin + PATH, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: typeof input === 'string' ? input : JSON.stringify(input), signal});
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function heldRender() {
  const entered = deferred(), release = deferred(), settled = deferred();
  const renderer = async (...args) => {
    const bytes = await renderOffice(...args);
    entered.resolve();
    await release.promise;
    settled.resolve();
    return bytes;
  };
  return {renderer, entered, release, settled};
}

test('actual mounted export produces genuine Word, PDF and RTF without creating a record', async t => {
  const f = await mounted(t);
  for (const [format, mime] of [['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pdf', 'application/pdf'], ['rtf', 'text/rtf']]) {
    const response = await post(f, body(format));
    assert.equal(response.status, 200, `${format}: ${response.status === 200 ? '' : await response.text()}`);
    assert.equal(response.headers.get('content-type').split(';')[0].trim().toLowerCase(), mime);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024);
    if (format === 'docx') {
      const zip = await Zip.loadAsync(bytes);
      assert.match(await zip.file('word/document.xml').async('string'), /Original supplied text/);
    } else assert.ok(bytes.subarray(0, 8).toString().startsWith(format === 'pdf' ? '%PDF-' : '{\\rtf1'));
  }
  assert.equal(f.state.sql, 0, 'pure rendering does not create documents, revisions or export rows');
});

test('transient export requires the current original-person read and export authority', async t => {
  const f = await mounted(t);
  for (const permission of ['document.view', 'document.read', 'document.export']) {
    f.state.denied.add(permission);
    assert.equal((await post(f, body())).status, 403, permission);
    f.state.denied.clear();
  }
  f.state.active = false;
  assert.equal((await post(f, body())).status, 401);
  assert.equal(f.state.sql, 0);
});

test('actual mounted route refuses unsupported inputs and the full native-sized JSON body', async t => {
  const f = await mounted(t);
  for (const input of [{...body(), extra: 'not supported'}, {...body(), format: 'xlsx'},
    {...body(), modelSha256: '0'.repeat(64)}]) assert.equal((await post(f, input)).status, 400);
  const input = body();
  input.model.pages[0].blocks.push({id: 'image-1', type: 'image', width: 1, height: 1,
    src: 'data:image/png;base64,iVBORw0KGgo='});
  input.model = validate(input.model);
  input.modelSha256 = createHash('sha256').update(stableJSON(input.model)).digest('hex');
  assert.equal((await post(f, input)).status, 400, 'no embedded-resource decoding in transient export');
  assert.equal((await post(f, ' '.repeat(512 * 1024 + 1))).status, 413);
  assert.equal(f.state.sql, 0);
});

test('production helper re-admits the original person and every permission after a held real render', async t => {
  for (const [label, change, status] of [
    ['different person', state => { state.person.sub = 'another'; }, 401],
    ['inactive person', state => { state.active = false; }, 401],
    ...['document.view', 'document.read', 'document.export'].map(permission =>
      [permission, state => state.denied.add(permission), 403])]) {
    const held = heldRender(), f = await mounted(t, {renderer: held.renderer});
    const request = post(f, body());
    await held.entered.promise;
    change(f.state); held.release.resolve();
    const response = await request;
    assert.equal(response.status, status, label);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(f.state.sql, 0);
  }
});

test('production helper uses the original monotonic deadline after real rendering', async t => {
  let now = 0;
  const held = heldRender(), f = await mounted(t, {renderer: held.renderer, clock: () => now});
  const request = post(f, body());
  await held.entered.promise;
  now = 15001; held.release.resolve();
  const response = await request;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error, 'office_export_timeout');
  assert.equal(f.state.sql, 0);
});

test('production helper keeps both canceled real renders charged until they actually settle', async t => {
  const holds = [heldRender(), heldRender()];
  let calls = 0;
  const f = await mounted(t, {renderer: (...args) => calls < 2 ? holds[calls++].renderer(...args) : renderOffice(...args)});
  const controllers = [new AbortController(), new AbortController()];
  const requests = controllers.map(controller => post(f, body(), controller.signal).catch(error => error));
  await Promise.all(holds.map(held => held.entered.promise));
  controllers.forEach(controller => controller.abort());
  await Promise.all(requests);
  const busy = await post(f, body());
  assert.equal(busy.status, 503);
  assert.equal((await busy.json()).error, 'office_export_busy');
  holds.forEach(held => held.release.resolve());
  await Promise.all(holds.map(held => held.settled.promise));
  const later = await post(f, body());
  assert.equal(later.status, 200, 'only settled work frees a rendering slot');
  assert.equal(f.state.sql, 0);
});

test('production helper refuses nonbinary, empty and over-native-bound results without publishing them', async t => {
  for (const value of ['not bytes', Buffer.alloc(0), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    const f = await mounted(t, {renderer: async () => value});
    const response = await post(f, body());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'office_export_limit');
    assert.equal(f.state.sql, 0);
  }
});

test('optional paragraph borderBottom and tabRight emit OOXML bottom borders, right tab stops and native tab runs without adding defaults to legacy models', async () => {
  const legacy = initial('docx', 'Legacy model');
  assert.equal(Object.hasOwn(legacy.pages[0].blocks[0], 'borderBottom'), false);
  assert.equal(Object.hasOwn(legacy.pages[0].blocks[0], 'tabRight'), false);
  assert.throws(() => validate({...legacy, pages: [{...legacy.pages[0], blocks: [{...legacy.pages[0].blocks[0], borderBottom: 'red'}]}]}), /six-digit color/i);
  assert.throws(() => validate({...legacy, pages: [{...legacy.pages[0], blocks: [{...legacy.pages[0].blocks[0], tabRight: 0}]}]}), /between 1 and 1440/i);

  const styled = initial('docx', 'Resume heading and role');
  const baseStyle = styled.pages[0].blocks[0].runs[0].style;
  styled.pages[0].blocks = [
    {id: 'sec-1', type: 'paragraph', style: 'heading1', spacingBefore: 10, spacingAfter: 4, lineHeight: 1.2, list: 'none',
      keepWithNext: true, borderBottom: '#1f3a5f', runs: [{text: 'PROFESSIONAL EXPERIENCE', style: {...baseStyle, bold: true, color: '#1f3a5f'}}]},
    {id: 'role-1', type: 'paragraph', style: 'heading2', spacingBefore: 6, spacingAfter: 2, lineHeight: 1.25, list: 'none',
      keepWithNext: true, tabRight: 540,
      runs: [{text: 'Senior Engineer', style: {...baseStyle, bold: true}}, {text: ', Acme', style: {...baseStyle, bold: true, color: '#33414f'}}, {text: '\tJan 2020 - Present', style: {...baseStyle, color: '#5a6675'}}]},
  ];
  const docx = await renderOffice(styled, 'docx');
  const zip = await Zip.loadAsync(docx);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:pBdr><w:bottom[^>]*w:val="single"[^>]*w:color="1F3A5F"/, 'emits bottom paragraph border');
  assert.match(xml, /<w:tabs><w:tab[^>]*w:val="right"[^>]*w:pos="10800"/, 'emits right tab stop in twips');
  assert.match(xml, /<w:tab\/><w:t[^>]*>Jan 2020 - Present<\/w:t>/, 'emits native OOXML tab element');

  const pdf = await renderOffice(styled, 'pdf');
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
  assert.match(pdf.toString('latin1'), /0\.75 w 0\.1216 0\.2275 0\.3725 RG/, 'emits PDF bottom rule');
  const rtf = (await renderOffice(styled, 'rtf')).toString('ascii');
  assert.match(rtf, /\\brdrb\\brdrs\\brdrw15\\brsp40\\brdrcf\d+/, 'emits RTF bottom border');
  assert.match(rtf, /\\tqr\\tx10800/, 'emits RTF right tab stop');
  assert.match(rtf, /\\tab Jan 2020 - Present/, 'emits RTF tab character');
});
