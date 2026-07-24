/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 19:15:00 | roger.murphy@emeraldcoastsystemsgroup.com | Guard for the storage move + share actions over the REAL router on HTTP loopback (camera route-spec pattern). Points the store root at a temp dir (CLINE_WORKSPACE_ROOT set before the dynamic import), seeds files, and pins: move/rename within the store, move into a subfolder, the authed download-link shape of share, a share 404, the traversal guard (a `..` toDir cannot escape the store root), and the 401 when unauthenticated. Runnable from the package root against a framework checkout on the vitest alias path.
 */
import express from 'express';
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '@/app/composition/app-context';

const PORT = 42311;
const API = `http://127.0.0.1:${PORT}`;
const SUB = 'user-1';

// The store root is computed at module load from CLINE_WORKSPACE_ROOT — set it BEFORE the SUT imports.
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-storage-test-'));
process.env.CLINE_WORKSPACE_ROOT = WORKSPACE;
process.env.MOCK_OIDC = 'true';
const userKey = (s: string): string => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const STORE_DIR = path.join(WORKSPACE, 'userfiles', userKey(SUB));

const ctx = { pool: { query: async () => ({ rows: [] }) } } as unknown as AppContext;

async function req(method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: any = {};
  try { parsed = JSON.parse(await res.text()); } catch { /* non-json */ }
  return { status: res.status, body: parsed };
}

describe('Storage move + share actions (boundary)', () => {
  let server: Server;
  let noAuthServer: Server;

  beforeAll(async () => {
    const { createStorageRoutes } = await import('../src-routes/storage-routes');
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STORE_DIR, 'deck.pptx'), 'PK-fake');
    fs.writeFileSync(path.join(STORE_DIR, 'notes.md'), '# notes');

    const app = express();
    app.use(express.json());
    app.use((r, _res, next) => { (r as any).oidc = { user: { sub: SUB } }; next(); }); // simulate the authed caller
    app.use('/api/storage', createStorageRoutes(ctx));
    server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });

    // A second mount WITHOUT the oidc injector proves the callerSub 401 gate.
    const bare = express();
    bare.use(express.json());
    bare.use('/api/storage', createStorageRoutes(ctx));
    noAuthServer = await new Promise<Server>((resolve) => { const s = bare.listen(PORT + 1, () => resolve(s)); });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await new Promise<void>((resolve) => noAuthServer?.close(() => resolve()));
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  });

  it('renames a file within the store', async () => {
    const r = await req('POST', '/api/storage/local/move', { name: 'deck.pptx', toName: 'renamed.pptx' });
    expect(r.status).toBe(200);
    expect(r.body.to).toBe('renamed.pptx');
    expect(r.body.downloadUrl).toBe('/api/files/download?provider=oshal-local&path=renamed.pptx');
    expect(fs.existsSync(path.join(STORE_DIR, 'renamed.pptx'))).toBe(true);
    expect(fs.existsSync(path.join(STORE_DIR, 'deck.pptx'))).toBe(false);
  });

  it('moves a file into a subfolder', async () => {
    const r = await req('POST', '/api/storage/local/move', { name: 'renamed.pptx', toDir: 'archive' });
    expect(r.status).toBe(200);
    expect(r.body.to).toBe('archive/renamed.pptx');
    expect(fs.existsSync(path.join(STORE_DIR, 'archive', 'renamed.pptx'))).toBe(true);
  });

  it('shares a file as the authed kernel download link', async () => {
    const r = await req('GET', '/api/storage/local/share?name=notes.md');
    expect(r.status).toBe(200);
    expect(r.body.provider).toBe('oshal-local');
    expect(r.body.path).toBe('notes.md');
    expect(r.body.downloadUrl).toBe('/api/files/download?provider=oshal-local&path=notes.md');
  });

  it('404s sharing a missing file', async () => {
    const r = await req('GET', '/api/storage/local/share?name=ghost.md');
    expect(r.status).toBe(404);
  });

  it('a `..` toDir cannot escape the store root (traversal guard)', async () => {
    const r = await req('POST', '/api/storage/local/move', { name: 'notes.md', toDir: '../../evil' });
    expect(r.status).toBe(200);
    // the `..` segments are stripped; only the safe `evil` segment survives → stays UNDER the store root
    expect(r.body.to).toBe('evil/notes.md');
    expect(fs.existsSync(path.join(STORE_DIR, 'evil', 'notes.md'))).toBe(true);
    // and nothing landed outside the store root
    expect(fs.existsSync(path.join(WORKSPACE, '..', 'evil'))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(STORE_DIR), 'evil'))).toBe(false);
  });

  it('401s move + share when unauthenticated', async () => {
    const noAuth = `http://127.0.0.1:${PORT + 1}`;
    const m = await fetch(`${noAuth}/api/storage/local/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    expect(m.status).toBe(401);
    const s = await fetch(`${noAuth}/api/storage/local/share?name=x`);
    expect(s.status).toBe(401);
  });
});
