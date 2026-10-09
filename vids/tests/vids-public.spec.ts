/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the token-only public route over loopback: anonymous delivery is limited to committed artifact bytes, is never cached, and exposes no listing or job controls.
 */
import express from 'express';
import type { Server } from 'http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '@/app/composition/app-context';

const WORKSPACE = join(tmpdir(), `oshal-vids-public-boundary-${process.pid}`);
process.env.CLINE_WORKSPACE_ROOT = WORKSPACE;
const TOKEN = 'a'.repeat(64);
const ARTIFACT_ID = '40000000-0000-4000-8000-000000000099';
const BYTES = Buffer.from('published-video-boundary');
let server: Server;
let origin: string;

describe('Vids public read-only surface (boundary)', () => {
  beforeAll(async () => {
    const mod = await import('../src-routes/vids-public-routes');
    const files = await import('../src-routes/vids-artifact-files');
    mkdirSync(files.artifactRoot(), { recursive: true });
    writeFileSync(files.artifactPath(ARTIFACT_ID), BYTES);
    const row = { artifact_id: ARTIFACT_ID, sha256: 'b'.repeat(64), byte_length: BYTES.length };
    const ctx = { pool: { connect: async () => ({
      query: async (sql: string, params?: unknown[]) => /SELECT artifact_id/.test(sql) && params?.[0] === TOKEN
        ? { rows: [row] } : { rows: [] },
      release: () => undefined,
    }) } } as unknown as AppContext;
    const app = express();
    app.use('/api/vids-public', mod.createVidsPublicRoutes(ctx));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing listener address');
    origin = `http://127.0.0.1:${address.port}`;
  }, 30000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    rmSync(WORKSPACE, { recursive: true, force: true });
  }, 30000);

  it('serves only the committed token artifact anonymously and never caches it', async () => {
    const res = await fetch(`${origin}/api/vids-public/${TOKEN}/video.mp4`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type') || '').toContain('video/mp4');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('404s an unlisted or malformed token, directory listing and traversal', async () => {
    expect((await fetch(`${origin}/api/vids-public/${'c'.repeat(64)}/video.mp4`)).status).toBe(404);
    expect((await fetch(`${origin}/api/vids-public/not-a-token/video.mp4`)).status).toBe(404);
    expect((await fetch(`${origin}/api/vids-public/${TOKEN}`)).status).toBe(404);
    expect((await fetch(`${origin}/api/vids-public/${TOKEN}/../video.mp4`)).status).toBe(404);
  });
});
