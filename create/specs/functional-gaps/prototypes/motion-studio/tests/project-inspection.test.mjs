/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Recover every native-document field, long key and Unicode string through bounded revision-pinned structural pages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectProject, projectReceipt, exportReceipt, projectIndex, revisionIndex, OBSERVATION_BYTES } from '../routes/project-inspection.mjs';
const project = document => ({ id: '9ca35c66-6b80-45b1-853d-0797e749aef5', title: 'Complete inspection',
  revision: 17, createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z', document, assets: [] });
function page(p, node, part, offset) {
  const result = inspectProject(p, { node, part, offset });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= OBSERVATION_BYTES);
  assert.equal(result.project.revision, p.revision); assert.equal(result.node, node); assert.equal(result.part, part);
  return result;
}
function reconstruct(p, node = 'root', part = 'value') {
  let current = page(p, node, part, 0);
  if (current.type === 'string') {
    let text = current.text;
    while (!current.complete) { assert.ok(current.nextOffset > current.offset); current = page(p, node, part, current.nextOffset); text += current.text; }
    return text;
  }
  if (!['object', 'array'].includes(current.type)) return current.value;
  const result = current.type === 'array' ? [] : {};
  let seen = 0;
  for (;;) {
    for (const child of current.children) {
      const name = child.nameComplete ? child.name : reconstruct(p, child.node, 'key');
      Object.defineProperty(result, name, { value: reconstruct(p, child.node), enumerable: true, writable: true, configurable: true }); seen++;
    }
    if (current.complete) { assert.equal(seen, current.totalChildren); return result; }
    assert.ok(current.nextOffset > current.offset); current = page(p, node, part, current.nextOffset);
  }
}
test('a two-megabyte document reconstructs exactly through complete bounded pages, not truncated previews', () => {
  const document = { items: Array.from({ length: 360 }, (_, id) => ({ id, text: '🧑‍🎨\n\u0000'.repeat(300), keys: [null, true, 12.5] })), empty: {}, blank: [] };
  const p = project(document); assert.ok(Buffer.byteLength(JSON.stringify(document)) > 2_000_000);
  assert.ok(Buffer.byteLength(JSON.stringify(document)) <= 2097152);
  assert.deepEqual(reconstruct(p), document);
  const receipt = projectReceipt(p); assert.equal(receipt.document, undefined); assert.equal(receipt.documentBytes, Buffer.byteLength(JSON.stringify(document)));
});
test('escaped keys, very long field names, prototype-shaped keys and lone surrogate units are recoverable', () => {
  const document = JSON.parse('{"__proto__":{"constructor":"owned"},"a/b~c":"x"}');
  document['🧑‍🎨\u0000'.repeat(1800)] = '\ud800left\udfff';
  assert.deepEqual(reconstruct(project(document)), document);
});
test('control-character keys dynamically shorten pages while preserving every next offset', () => {
  const document = Object.fromEntries(Array.from({ length: 200 }, (_, n) => [String(n) + '\u0000'.repeat(300), '\u0000'.repeat(1000)]));
  const p = project(document), first = page(p, 'root', 'value', 0);
  assert.ok(first.children.length < 64); assert.equal(first.complete, false);
  assert.deepEqual(reconstruct(p), document);
});
test('string chunks preserve surrogate pairs and refuse offsets that bisect a pair', () => {
  const p = project('x'.repeat(4095) + '😀' + 'end'), first = page(p, 'root', 'value', 0);
  assert.equal(first.nextOffset, 4095); assert.equal(reconstruct(p), p.document);
  assert.throws(() => inspectProject(p, { offset: 4096 }), /motion_invalid_inspection_offset/);
});
test('invalid node selectors, missing children, negative offsets and non-existent root key refuse', () => {
  const p = project({ value: true });
  for (const node of ['../value', '00', '-1', '1e2', '__proto__', 'root.0']) assert.throws(() => inspectProject(p, { node }), /motion_invalid_inspection_node/);
  assert.throws(() => inspectProject(p, { node: '1' }), /motion_inspection_node_not_found/);
  assert.throws(() => inspectProject(p, { offset: -1 }), /motion_invalid_inspection_input/);
  assert.throws(() => inspectProject(p, { offset: 2 }), /motion_invalid_inspection_offset/);
  assert.throws(() => inspectProject(p, { part: 'key' }), /motion_inspection_root_has_no_key/);
});
test('export receipts bind exact immutable download bytes and mark retained source references', () => {
  const p = project({ items: {}, note: 'Original sources stay references.' }), result = exportReceipt(p);
  assert.equal(result.download.byteLength, Buffer.byteLength(JSON.stringify(p.document)));
  assert.match(result.download.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.download.immutableUrl, '/api/motion-studio/projects/' + p.id + '/revisions/17/export');
  assert.equal(result.download.portableSources, false); assert.equal(result.download.requiresPermission, 'project.export');
});

test('all1000 project/history metadata entries remain reachable within escaped-title budgets', () => {
  const rows = Array.from({length:1000},(_,n)=>({id:String(n).padStart(36,'0'),revision:n+1,title:'\u0001'.repeat(160),createdAt:'2026-10-12T00:00:00.000Z'}));
  let page = projectIndex(rows, 'start', 0), stamp = page.stamp, projects = [...page.projects];
  while (!page.complete) { page = projectIndex(rows, stamp, page.nextOffset); assert.ok(Buffer.byteLength(JSON.stringify(page)) < OBSERVATION_BYTES); projects.push(...page.projects); }
  assert.deepEqual(projects.map(p=>p.id), rows.map(p=>p.id));
  page = revisionIndex(rows, 1000, 0); const history = [...page.revisions];
  while (!page.complete) { page = revisionIndex(rows, 1000, page.nextOffset); assert.ok(Buffer.byteLength(JSON.stringify(page)) < OBSERVATION_BYTES); history.push(...page.revisions); }
  assert.deepEqual(history, rows);
});
test('collection changes refuse stale project pages while later revisions leave a pinned history intact', () => {
  const rows = Array.from({length:100},(_,n)=>({id:String(n),revision:n+1,title:'Title'}));
  const first = projectIndex(rows, 'start', 0);
  assert.throws(()=>projectIndex([...rows,{id:'new',revision:1,title:'Later'}],first.stamp,64),/motion_index_changed/);
  assert.throws(()=>projectIndex(rows,'start',1),/motion_invalid_index_stamp/);
  const later = [...rows,{revision:101,title:'Later'}];
  assert.deepEqual(revisionIndex(later,100,64),revisionIndex(rows,100,64));
});
