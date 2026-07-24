/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 19:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | Guard for the Vids PUBLIC read-only surface over the REAL router on HTTP loopback (camera route-spec pattern). Points the publish root at a temp dir (CLINE_WORKSPACE_ROOT set before the dynamic import), seeds a published render, and pins: an anonymous GET serves the file with nosniff + the right content-type; a missing file, a bad (non-hex) slug, an encoded traversal, and a bare-slug listing attempt all 404. Runnable from the package root against a framework checkout on the vitest alias path.
 */
import express from 'express';
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '@/app/composition/app-context';

const PORT = 42319;
const API = `http://127.0.0.1:${PORT}`;
const SUB = 'user-1';

// PUBLIC_ROOT is computed at module load from CLINE_WORKSPACE_ROOT — set it BEFORE the SUT imports.
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-vids-public-test-'));
process.env.CLINE_WORKSPACE_ROOT = WORKSPACE;

const ctx = { pool: { query: async () => ({ rows: [] }) } } as unknown as AppContext;
const CLIP_BYTES = 'FAKE-MP4-BYTES';
let slug = '';

describe('Vids public read-only surface (boundary)', () => {
  let server: Server;

  beforeAll(async () => {
    const mod = await import('../src-routes/vids-public-routes');
    slug = mod.vidsPublicSlug(SUB);
    const dir = path.join(mod.vidsPublicRoot(), slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'clip.mp4'), CLIP_BYTES);

    const app = express();
    app.use('/api/vids-public', mod.createVidsPublicRoutes(ctx)); // NO auth wrapper — it is a public mount
    server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  });

  it('serves a published render anonymously with nosniff + a video content-type', async () => {
    const res = await fetch(`${API}/api/vids-public/${slug}/clip.mp4`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-type') || '').toContain('video/mp4');
    expect(await res.text()).toBe(CLIP_BYTES);
  });

  it('404s a file that was never published', async () => {
    expect((await fetch(`${API}/api/vids-public/${slug}/ghost.mp4`)).status).toBe(404);
  });

  it('404s a non-hex slug (only the user_sub-keyed dirs are reachable)', async () => {
    expect((await fetch(`${API}/api/vids-public/not-a-slug/clip.mp4`)).status).toBe(404);
  });

  it('404s an encoded path traversal', async () => {
    const res = await fetch(`${API}/api/vids-public/${slug}/..%2f..%2fsecret.txt`);
    expect(res.status).toBe(404);
  });

  it('does not list the directory (a bare slug 404s)', async () => {
    expect((await fetch(`${API}/api/vids-public/${slug}`)).status).toBe(404);
    expect((await fetch(`${API}/api/vids-public/${slug}/`)).status).toBe(404);
  });
});
