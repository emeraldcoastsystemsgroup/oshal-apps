/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.5: dependency-free verification for CREATE-TOOL-CREATE-02, -08, -10, -29 and CREATE-TOOL-BRAND-01..-03 (text alignment controls, revision list/restore store semantics, brand kit read/update/apply-brand deterministic mapping + single-logo guard, and 8192 px canvas size parity).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CreateProjectStore } = require('../routes/create-project-store.js');

const PKG = path.resolve(__dirname, '..');
const ALICE = { issuer: 'https://create-parity.fixture.invalid', sub: 'alice' };
const BOB = { issuer: ALICE.issuer, sub: 'bob' };
const LOGO_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const LOGO_SRC = `/api/create/project-assets/${LOGO_ID}`;

function statefulPool() {
  const projects = new Map(), revisions = new Map();
  let clock = Date.parse('2026-11-25T10:00:00.000Z');
  const k = (issuer, sub, id) => JSON.stringify([issuer, sub, id]);
  return {
    projects, revisions,
    connect: async () => {
      let owner;
      return {
        release() {},
        query: async (raw, values = []) => {
          const sql = raw.replace(/\s+/g, ' ').trim();
          const now = new Date(clock += 10).toISOString();
          const res = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
          if (sql.startsWith('SELECT set_config')) { owner = values.slice(0, 2); return res([]); }
          if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT pg_advisory_xact_lock)\b/.test(sql)) return res([]);
          const own = map => [...map.values()].filter(r => r.owner_issuer === owner[0] && r.owner_sub === owner[1]);
          if (sql.startsWith('SELECT COUNT(*)')) return res([{ count: own(projects).length }]);
          if (sql.startsWith('INSERT INTO create_projects ')) {
            const row = { project_id: values[2], owner_issuer: values[0], owner_sub: values[1], title: values[3], current_revision: 1, created_at: now, updated_at: now };
            projects.set(k(values[0], values[1], values[2]), row);
            return res([row]);
          }
          if (sql.startsWith('INSERT INTO create_project_revisions ')) {
            const row = { project_id: values[2], owner_issuer: values[0], owner_sub: values[1], revision: values.length === 6 ? (sql.includes(',1,') ? 1 : values[3]) : values[3], title: sql.includes(',1,') ? values[3] : values[4], document: JSON.parse(sql.includes(',1,') ? values[4] : values[5]), created_at: sql.includes(',1,') ? values[5] : now };
            revisions.set(`${k(values[0], values[1], values[2])}:${row.revision}`, row);
            return res([row]);
          }
          if (sql.startsWith('UPDATE create_projects SET ')) {
            const row = projects.get(k(values[0], values[1], values[2]));
            if (!row || row.current_revision !== values[5]) return res([]);
            row.title = values[3]; row.current_revision = values[4]; row.updated_at = values[6];
            return res([row]);
          }
          if (sql.includes('FROM create_project_revisions') && sql.includes('AND revision=$4')) {
            const row = revisions.get(`${k(values[0], values[1], values[2])}:${values[3]}`);
            return res(row ? [row] : []);
          }
          if (sql.includes('FROM create_project_revisions') && sql.includes('AND revision<$4')) {
            const rows = own(revisions).filter(r => r.project_id === values[2] && r.revision < values[3]).sort((a, b) => b.revision - a.revision);
            return res(rows.slice(0, 1));
          }
          if (sql.includes('JOIN create_project_revisions')) {
            const project = projects.get(k(values[0], values[1], values[2]));
            if (!project) return res([]);
            const rev = revisions.get(`${k(values[0], values[1], values[2])}:${values[3] ?? project.current_revision}`);
            return res(rev ? [{ ...project, title: rev.title, current_revision: rev.revision, updated_at: rev.created_at, document: rev.document }] : []);
          }
          if (sql.includes('FROM create_project_revisions')) {
            return res(own(revisions).filter(r => r.project_id === values[2]).sort((a, b) => b.revision - a.revision));
          }
          if (sql.includes('FROM create_projects')) {
            const row = projects.get(k(values[0], values[1], values[2]));
            return res(row ? [row] : []);
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
}

function docInput(title, text) {
  return {
    title,
    document: {
      version: 1, name: title, width: 640, height: 480, background: '#ffffff', images: {},
      layers: [{ id: 'headline', type: 'text', name: 'Headline', text, x: 40, y: 40, w: 400, h: 100, fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, align: 'left', fill: '#111827' }],
    },
  };
}

test('CREATE-TOOL-CREATE-08: store.restoreRevision restores previous or explicit revision as a new immutable revision', async () => {
  const pool = statefulPool(), store = new CreateProjectStore(pool);
  const confirm = async () => {};
  const identity = doc => doc;
  const r1 = await store.create(ALICE, docInput('Rev 1', 'First'), confirm);
  await assert.rejects(() => store.restoreRevision(ALICE, r1.id, undefined, undefined, identity, confirm), err => err.status === 409 && err.code === 'project_no_previous_revision');
  const r2 = await store.save(ALICE, r1.id, 1, docInput('Rev 2', 'Second'), confirm);
  const r3 = await store.save(ALICE, r1.id, 2, docInput('Rev 3', 'Third'), confirm);
  assert.equal(r3.revision, 3);

  // Default undo (revision omitted) restores immediately previous retained revision (2) as new revision 4.
  const undone = await store.restoreRevision(ALICE, r1.id, undefined, 3, identity, confirm);
  assert.equal(undone.restoredFromRevision, 2);
  assert.equal(undone.project.revision, 4);
  assert.equal(undone.project.document.layers[0].text, 'Second');

  // Explicit restore of revision 1 creates new revision 5 while preserving revisions 1..4.
  const explicit = await store.restoreRevision(ALICE, r1.id, 1, 4, identity, confirm);
  assert.equal(explicit.restoredFromRevision, 1);
  assert.equal(explicit.project.revision, 5);
  assert.equal(explicit.project.document.layers[0].text, 'First');
  const listed = await store.revisions(ALICE, r1.id);
  assert.deepEqual(listed.map(item => item.revision), [5, 4, 3, 2, 1]);

  // Conflict, missing revision, and cross-owner isolation stay fail-closed.
  await assert.rejects(() => store.restoreRevision(ALICE, r1.id, 2, 4, identity, confirm), err => err.status === 409 && err.code === 'project_revision_conflict');
  await assert.rejects(() => store.restoreRevision(ALICE, r1.id, 99, undefined, identity, confirm), err => err.status === 404 && err.code === 'project_revision_not_found');
  await assert.rejects(() => store.restoreRevision(BOB, r1.id, 1, undefined, identity, confirm), err => err.status === 404 && err.code === 'project_not_found');
});

test('CREATE-TOOL-BRAND-03 & CREATE-TOOL-CREATE-10: applyBrandToProject maps background, shapes, text, and logo once with change list', async () => {
  const { applyBrandToProject, defaultBrandKit } = await import('../tools/editor/brand-kit.mjs');
  const { validateProject } = await import('../tools/editor/model-validation.mjs');
  const kit = {
    ...defaultBrandKit(), name: 'Harbor',
    colors: { primary: '#123abc', secondary: '#2a9d8f', accent: '#0a84ff', dark: '#111827', light: '#fafaf7' },
    fonts: { heading: 'Georgia', body: 'Garamond' },
    logo: { src: LOGO_SRC, width: 200, height: 100 },
  };
  const project = validateProject({
    version: 1, name: 'Campaign', width: 1000, height: 600, background: '#e2e8f0', images: {},
    layers: [
      { id: 'bg-card', type: 'rect', name: 'Hero shape', x: 20, y: 20, w: 300, h: 200, fill: '#ef4444', stroke: '#000000', strokeWidth: 2 },
      { id: 'badge', type: 'ellipse', name: 'Badge', x: 360, y: 20, w: 120, h: 120, fill: '#22c55e' },
      { id: 'locked-rect', type: 'rect', name: 'Locked shape', x: 20, y: 300, w: 80, h: 80, fill: '#f59e0b', locked: true },
      { id: 'headline', type: 'text', name: 'Title', text: 'Launch', x: 40, y: 260, w: 500, h: 80, fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, fill: '#64748b' },
      { id: 'body', type: 'text', name: 'Body', text: 'Details', x: 40, y: 360, w: 500, h: 60, fontFamily: 'sans-serif', fontSize: 20, fontWeight: 400, fill: '#64748b' },
    ],
  }, { assetMode: 'reference' });

  const first = applyBrandToProject(project, kit, { logoLayerId: 'brand-logo-1' });
  const validated = validateProject(first.project, { assetMode: 'reference' });
  assert.equal(validated.background, '#fafaf7');
  assert.equal(validated.layers.find(l => l.id === 'bg-card').fill, '#123abc');
  assert.equal(validated.layers.find(l => l.id === 'bg-card').stroke, '#0a84ff');
  assert.equal(validated.layers.find(l => l.id === 'badge').fill, '#2a9d8f');
  assert.equal(validated.layers.find(l => l.id === 'locked-rect').fill, '#f59e0b', 'locked layer stays untouched');
  assert.equal(validated.layers.find(l => l.id === 'headline').fontFamily, 'Georgia');
  assert.equal(validated.layers.find(l => l.id === 'body').fontFamily, 'Garamond');
  assert.equal(validated.layers.find(l => l.id === 'body').fill, '#111827');
  assert.equal(validated.layers.filter(l => l.name === 'Brand logo').length, 1);
  assert.equal(validated.images[LOGO_ID].src, LOGO_SRC);
  assert.ok(first.changes.some(c => c.target === 'canvas' && c.to === '#fafaf7'));
  assert.ok(first.changes.some(c => c.layerId === 'bg-card' && c.field === 'fill' && c.to === '#123abc'));
  assert.ok(first.changes.some(c => c.layerId === 'headline' && c.field === 'fontFamily' && c.to === 'Georgia'));
  assert.ok(first.changes.some(c => c.layerId === 'brand-logo-1' && c.action === 'added'));

  // Re-applying never duplicates the brand logo.
  const second = applyBrandToProject(validated, kit);
  assert.equal(second.project.layers.filter(l => l.name === 'Brand logo').length, 1);
});

test('CREATE-TOOL-CREATE-29: 8192 px canvas size limit and error wording match between editor and concierge', async () => {
  const { createProject } = await import('../tools/editor/model.mjs');
  const { blankProject } = await import('../tools/editor/agent-tools.mjs');
  const wideAgent = blankProject({ title: 'Wide', width: 8192, height: 4096 });
  const wideEditor = createProject({ name: 'Wide', width: 8192, height: 4096 });
  assert.equal(wideAgent.width, 8192); assert.equal(wideAgent.height, 4096);
  assert.deepEqual(wideAgent, wideEditor);

  let agentErr, editorErr;
  try { blankProject({ title: 'Bad', width: 8193, height: 100 }); } catch (e) { agentErr = e.message; }
  try { createProject({ name: 'Bad', width: 8193, height: 100 }); } catch (e) { editorErr = e.message; }
  assert.equal(agentErr, 'Canvas width is out of range');
  assert.equal(agentErr, editorErr);

  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const start = manifest.indexOf('  - name: create-new-project');
  const block = manifest.slice(start, manifest.indexOf('  - name: create-apply-edits', start));
  assert.doesNotMatch(block, /maximum: 4096/);
  assert.equal([...block.matchAll(/maximum: 8192/g)].length, 2);
});

test('CREATE-TOOL-CREATE-02 & 1.20.5 UI/manifest parity controls and tool declarations are complete', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools/create-editor.html'), 'utf8');
  for (const id of ['textAlignLeft', 'textAlignCenter', 'textAlignRight', 'applyBrandBtn']) {
    assert.match(html, new RegExp(`id="${id}"`), `create-editor.html exposes #${id}`);
  }
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  for (const tool of ['create-list-revisions', 'create-restore-revision', 'create-read-brand-kit', 'create-update-brand-kit', 'create-apply-brand']) {
    assert.match(manifest, new RegExp(`name: ${tool}\\b`), `oshal-app.yaml declares ${tool}`);
  }
});
