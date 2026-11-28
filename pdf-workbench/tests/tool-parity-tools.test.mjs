/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Unit and HTTP contract verification for pdf-workbench 0.4.2 tool parity (CREATE-TOOL-PDF-WORKBENCH-08, -05, -03): pdf-export, pdf-delete-source, pdf-go-to-page, surface ops, and update-annotation geometry remapping.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Follow the manifest patch version while retaining tool and route behavior coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { apply, initial, CONTRACT } from '../routes/model.mjs';
import { requireRuntime } from './fixtures/runtime.mjs';

const require = requireRuntime;
const yaml = require('js-yaml');
const express = require('express');
const { createPdfRoutes } = await import('../routes/application.mjs');

const PKG_DIR = resolve(import.meta.dirname, '..');

test('manifest 0.4.3 declares pdf-export, pdf-delete-source, pdf-go-to-page and surface custom ops', () => {
  const manifest = yaml.load(fs.readFileSync(resolve(PKG_DIR, 'oshal-app.yaml'), 'utf8'));
  const auth = yaml.load(fs.readFileSync(resolve(PKG_DIR, 'authorization.yaml'), 'utf8'));

  assert.equal(manifest.version, '0.4.3');
  assert.ok(Array.isArray(manifest.surface?.ops) && manifest.surface.ops.includes('custom'));

  const byName = new Map(manifest.tools.map((t) => [t.name, t]));
  const pdfExport = byName.get('pdf-export');
  const pdfDeleteSource = byName.get('pdf-delete-source');
  const pdfGoToPage = byName.get('pdf-go-to-page');
  assert.ok(pdfExport, 'pdf-export tool declared');
  assert.ok(pdfDeleteSource, 'pdf-delete-source tool declared');
  assert.ok(pdfGoToPage, 'pdf-go-to-page tool declared');

  assert.equal(pdfExport.executor.apiEndpoint, 'POST /api/pdf-workbench/documents/{input.id}/export');
  assert.equal(pdfExport.requiresApproval, true);
  assert.equal(pdfExport.defaultAuthMode, 'ask');
  assert.ok(typeof pdfExport.cardText === 'string' && pdfExport.cardText.length > 5);

  assert.equal(pdfDeleteSource.executor.apiEndpoint, 'DELETE /api/pdf-workbench/sources/{input.source}');
  assert.equal(pdfDeleteSource.requiresApproval, true);
  assert.equal(pdfDeleteSource.defaultAuthMode, 'ask');
  assert.ok(typeof pdfDeleteSource.cardText === 'string' && pdfDeleteSource.cardText.length > 5);

  assert.equal(pdfGoToPage.executor.apiEndpoint, 'GET /api/pdf-workbench/documents/{input.id}/navigate?page={input.page}');
  assert.equal(pdfGoToPage.requiresApproval, false);
  assert.equal(pdfGoToPage.defaultAuthMode, 'auto');

  const http = new Map(auth.bindings.http.map((b) => [`${b.method} ${b.path}`, b.allOf]));
  assert.deepEqual(http.get('POST /documents/:document/export'), ['document.view', 'document.read', 'document.export']);
  assert.deepEqual(http.get('GET /documents/:document/navigate'), ['document.view', 'document.read']);

  const tools = new Map(auth.bindings.tools.map((b) => [b.id, b.allOf]));
  assert.deepEqual(tools.get('pdf-export'), ['document.view', 'document.read', 'document.export']);
  assert.deepEqual(tools.get('pdf-delete-source'), ['document.view', 'document.read', 'document.delete']);
  assert.deepEqual(tools.get('pdf-go-to-page'), ['document.view', 'document.read']);
});

test('update-annotation edits text/color, remaps quadPoints and ink points on move, supports page move and refuses invalid input', () => {
  const source = {
    id: randomUUID(),
    pages: [
      { index: 0, cropBox: [0, 0, 612, 792], rotation: 0, objects: [] },
      { index: 1, cropBox: [0, 0, 612, 792], rotation: 0, objects: [] },
    ],
    fields: [],
  };
  const base = initial(source);
  const [p1, p2] = base.pages.map((p) => p.id);
  const noteId = randomUUID();
  const hlId = randomUUID();
  const inkId = randomUUID();

  const added = apply(base, [
    { op: 'annotate', annotation: { id: noteId, page: p1, kind: 'text', rect: [20, 40, 180, 90], text: 'Initial note', color: 'ffcc00' } },
    { op: 'annotate', annotation: { id: hlId, page: p1, kind: 'highlight', rect: [50, 700, 210, 720], quadPoints: [[50, 720, 210, 720, 50, 700, 210, 700]], color: 'ffcc00' } },
    { op: 'annotate', annotation: { id: inkId, page: p1, kind: 'ink', rect: [40, 100, 140, 160], points: [[40, 100], [90, 130], [140, 160]], color: '1d4ed8', strokeWidth: 2 } },
  ], [source]);

  const updated = apply(added, [
    { op: 'update-annotation', id: noteId, properties: { text: 'Updated note', color: '2563eb', rect: [60, 120, 220, 170], page: p2 } },
    { op: 'update-annotation', id: hlId, properties: { rect: [100, 640, 260, 660] } },
    { op: 'update-annotation', id: inkId, properties: { rect: [140, 200, 240, 260] } },
  ], [source]);

  const note = updated.annotations.find((a) => a.id === noteId);
  assert.equal(note.text, 'Updated note');
  assert.equal(note.color, '2563eb');
  assert.equal(note.page, p2);
  assert.deepEqual(note.rect, [60, 120, 220, 170]);

  const hl = updated.annotations.find((a) => a.id === hlId);
  assert.deepEqual(hl.rect, [100, 640, 260, 660]);
  assert.deepEqual(hl.quadPoints, [[100, 660, 260, 660, 100, 640, 260, 640]]);

  const ink = updated.annotations.find((a) => a.id === inkId);
  assert.deepEqual(ink.rect, [140, 200, 240, 260]);
  assert.deepEqual(ink.points, [[140, 200], [190, 230], [240, 260]]);

  assert.throws(() => apply(added, [{ op: 'update-annotation', id: noteId, properties: {} }], [source]), /pdf_invalid_input/);
  assert.throws(() => apply(added, [{ op: 'update-annotation', id: noteId, properties: { page: randomUUID() } }], [source]), /pdf_page_unavailable/);
  assert.throws(() => apply(added, [{ op: 'update-annotation', id: noteId, properties: { rect: [-10, 10, 50, 50] } }], [source]), /pdf_annotation_geometry/);
  assert.ok(CONTRACT.operations.includes('update-annotation'));
});

test('export-link and navigate HTTP routes enforce fail-closed auth and input validation', async () => {
  const denied = new Set();
  const ctx = {
    appPackageDir: PKG_DIR,
    pool: { connect: () => { throw new Error('unexpected SQL access'); } },
    intent: () => { throw new Error('unexpected engine access'); },
    authorization: {
      currentActor: () => ({ issuer: 'fixture', sub: 'alice', isActive: true }),
      authorize: async ({ permission }) => ({ allowed: !denied.has(permission) }),
      registerResource: () => {},
    },
  };
  const app = express();
  app.use('/api/pdf-workbench', createPdfRoutes(ctx));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const docId = randomUUID();
    assert.equal((await fetch(`${url}/api/pdf-workbench/documents/${docId}/navigate?page=0`)).status, 400);
    assert.equal((await fetch(`${url}/api/pdf-workbench/documents/${docId}/navigate?page=abc`)).status, 400);
    assert.equal((await fetch(`${url}/api/pdf-workbench/documents/${docId}/navigate?page=1&owner=bob`)).status, 400);
    assert.equal((await fetch(`${url}/api/pdf-workbench/documents/${docId}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unknown: 1 }),
    })).status, 400);
    denied.add('document.export');
    assert.equal((await fetch(`${url}/api/pdf-workbench/documents/${docId}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
