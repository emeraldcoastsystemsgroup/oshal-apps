/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted from routes.core.test.js (0.2.0) so the route suite, the bare package-tool suite and the framework-coupled tool suite share ONE in-memory database that answers exactly the package's owner-keyed SQL and ONE fake engine bridge that speaks the real wire protocol and records every request. The pool also records every statement it answers, so a suite can prove a refusal happened before any query. Plain Node, no framework import.
 */
'use strict';
const net = require('node:net');
const { randomUUID } = require('node:crypto');

/** The engine build hash every fake bridge announces (and the specs expect). */
const HASH = 'd'.repeat(64);
/** @description Base64 of a string (the engine's file-map encoding). @param {string} s @returns {string} */
const b64 = (s) => Buffer.from(s).toString('base64');
/** A PNG signature plus IHDR head: the bytes a fake preview carries. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/**
 * @description An in-memory database that answers exactly the package's SQL, owner-keyed like the real
 * tables (every statement filters on owner_sub). `statements` records each statement answered.
 * @returns {{ tables: object, statements: string[], query: Function }} The pool double.
 */
function fakePool() {
  const tables = { scene_project: [], scene_revision: [] };
  const statements = [];
  const project = (sub, id) => tables.scene_project.find((p) => p.owner_sub === sub && p.project_id === id);
  const answer = (rows) => ({ rows, rowCount: rows.length });
  const handlers = [
    [/^SELECT .* FROM scene_project WHERE owner_sub = \$1 ORDER BY/s, ([sub]) => tables.scene_project.filter((p) => p.owner_sub === sub).sort((a, b) => b.updated_at.localeCompare(a.updated_at))],
    [/^SELECT .* FROM scene_project WHERE owner_sub = \$1 AND project_id = \$2$/s, ([sub, id]) => [project(sub, id)].filter(Boolean)],
    [/^INSERT INTO scene_project/, ([sub, title, kind, template]) => { const now = new Date().toISOString(); const row = { project_id: randomUUID(), owner_sub: sub, title, kind, template, revision: 0, file_count: 0, total_bytes: 0, preview: null, last_run: null, created_at: now, updated_at: now }; tables.scene_project.push(row); return [row]; }],
    [/^UPDATE scene_project SET title/, ([sub, id, title]) => { const p = project(sub, id); if (p) Object.assign(p, { title, updated_at: new Date().toISOString() }); return [p].filter(Boolean); }],
    [/^DELETE FROM scene_project/, ([sub, id]) => { const p = project(sub, id); tables.scene_project = tables.scene_project.filter((r) => r !== p); tables.scene_revision = tables.scene_revision.filter((r) => r.project_id !== id); return p ? [p] : []; }],
    [/^WITH up AS/, (v) => commit(v)],
    [/^SELECT .* FROM scene_revision WHERE owner_sub = \$1 AND project_id = \$2 AND revision = \$3/s, ([sub, id, rev]) => tables.scene_revision.filter((r) => r.owner_sub === sub && r.project_id === id && r.revision === rev)],
    [/^SELECT .* FROM scene_revision WHERE owner_sub = \$1 AND project_id = \$2 ORDER BY revision DESC LIMIT/s, ([sub, id, limit]) => tables.scene_revision.filter((r) => r.owner_sub === sub && r.project_id === id).sort((a, b) => b.revision - a.revision).slice(0, limit)],
    [/^DELETE FROM scene_revision/, ([sub, id, keepFrom]) => { const gone = tables.scene_revision.filter((r) => r.owner_sub === sub && r.project_id === id && r.revision < keepFrom); tables.scene_revision = tables.scene_revision.filter((r) => !gone.includes(r)); return gone; }],
    [/^UPDATE scene_project SET (preview|last_run) = /, ([sub, id, value], sql) => { const p = project(sub, id); if (p) { p[/SET preview/.test(sql) ? 'preview' : 'last_run'] = JSON.parse(value); p.updated_at = new Date().toISOString(); } return [p].filter(Boolean); }],
    [/^SELECT count\(\*\)::text AS total/, ([sub]) => { const mine = tables.scene_project.filter((p) => p.owner_sub === sub); return [{ total: String(mine.length), godot: String(mine.filter((p) => p.kind === 'godot').length), blender: String(mine.filter((p) => p.kind === 'blender').length), revisions: String(mine.reduce((n, p) => n + p.revision, 0)) }]; }],
    [/^SELECT title, kind, revision, preview, last_run, updated_at FROM scene_project/, ([sub]) => tables.scene_project.filter((p) => p.owner_sub === sub).slice(0, 3)],
  ];
  function commit([sub, id, expected, fileCount, totalBytes, action, detail, blob, engineBuild]) {
    const p = project(sub, id);
    if (!p || p.revision !== expected) return [];
    Object.assign(p, { revision: expected + 1, file_count: fileCount, total_bytes: totalBytes, updated_at: new Date().toISOString() });
    tables.scene_revision.push({ project_id: id, revision: p.revision, owner_sub: sub, action, detail: JSON.parse(detail), file_count: fileCount, total_bytes: totalBytes, blob, engine_build: engineBuild, created_at: new Date().toISOString() });
    return [p];
  }
  return {
    tables,
    statements,
    async query(sql, params = []) {
      const text = typeof sql === 'string' ? sql : sql.text;
      const values = typeof sql === 'string' ? params : sql.values;
      const trimmed = text.replace(/\s+/g, ' ').trim();
      statements.push(trimmed);
      for (const [re, fn] of handlers) if (re.test(trimmed)) return answer(fn(values, trimmed).map((r) => ({ ...r })));
      throw new Error(`fake pool cannot answer: ${trimmed.slice(0, 80)}`);
    },
  };
}

/**
 * @description A fake engine bridge on loopback that speaks the wire protocol (hello with the build hash,
 * JSON lines answered by id) and records every request. `onMcp.fn` answers mcp_call and may be swapped per case.
 * @param {{ fn: Function }} onMcp - The mcp_call answer.
 * @param {string} [buildHash] - The hash the hello announces (HASH unless a suite mounts the real package).
 * @returns {Promise<{ port: number, requests: object[], close: Function }>} The running bridge.
 */
function fakeEngine(onMcp, buildHash = HASH) {
  const requests = [];
  const files = { godot: [{ path: 'main.tscn', data: b64('[gd_scene format=3]\n[node name="Main" type="Node3D"]\n') }, { path: 'project.godot', data: b64('config_version=5\n') }], blender: [{ path: 'scene.blend', data: b64('BLENDER-v1') }] };
  const ops = {
    capabilities: () => ({ versions: { godot: '4.7.2', blender: 'Blender 5.1.0' }, tools: { godot: [{ name: 'add_node' }], blender: [] }, sandbox: { ok: true } }),
    new_project: (req) => ({ files: files[req.kind] }),
    mcp_call: (req) => onMcp.fn(req),
    godot_run: () => ({ output: ['Godot Engine v4.7.2', 'hello from _ready'], errors: [], seconds: 2 }),
    preview: () => ({ png: PNG.toString('base64'), glb: b64('glTF-fake'), stl: b64('solid-fake'), info: { polygons: 12, camera: 'Camera' } }),
    export: (req) => ({ name: `export.${req.format}`, contentType: 'application/zip', data: b64(`EXPORT-${req.format}`) }),
    import_model: (req) => ({ files: [...req.files, { path: `models/${req.name}.glb`, data: b64('glTF') }], changed: true, delta: { added: [`models/${req.name}.glb`], modified: [], deleted: [] }, resPath: `res://models/${req.name}.glb` }),
  };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash } }) + '\n');
    let tail = '';
    socket.on('data', async (chunk) => {
      const parts = (tail + chunk).split('\n'); tail = parts.pop();
      for (const line of parts.filter((l) => l.trim())) {
        const req = JSON.parse(line);
        requests.push(req);
        try { socket.write(JSON.stringify({ id: req.id, ok: true, result: await ops[req.op](req) }) + '\n'); }
        catch (e) { socket.write(JSON.stringify({ id: req.id, ok: false, error: { code: e.code || 'engine_error', message: e.message } }) + '\n'); }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, requests, close: () => { for (const s of sockets) s.destroy(); server.close(); } })));
}

module.exports = { HASH, PNG, b64, fakePool, fakeEngine };
