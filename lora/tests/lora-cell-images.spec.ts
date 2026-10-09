/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Guard hosted validation thumbnails: bounded checked ingest, owner-only serving, the expiry predicate on every read, run deletion removing the bytes, and a studio that derives a cell's image source instead of trusting the box's filename.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | Keep the recording callback port aligned with owner-bound immutable-key resolution; real namespace isolation is exercised separately against PostgreSQL.
 * 3   | maintainer@emeraldcoastsystemsgroup.com   | Thumbnail uploads are signed with a callback grant instead of the fleet secret; the recording pool answers the grant and nonce statements, and a request that carries only the fleet secret is refused before any database access. Real grant verification is proven in lora-callback-grants.spec.ts.
 * 4   | maintainer@emeraldcoastsystemsgroup.com   | The ingest router runs behind the signed-package-callbacks verifier (lora-callback-rail double) at its manifest path; grant rows carry an owner issuer, and an oversized thumbnail body is now refused by the verifier (401 callback_body_refused) before any grant lookup instead of 413 from the route.
 */

import express from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  bootstrap: vi.fn(async () => undefined),
}));

vi.mock('@/shared/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/shared/services/database', () => ({
  runRuntimeSchemaBootstrap: harness.bootstrap,
}));
vi.mock('@/app/routes/remote-client-routes', () => ({
  remoteClientRegistry: {
    listClients: vi.fn(() => []),
    enqueueTask: vi.fn(),
  },
}));

import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
import { MAX_CELL_IMAGE_BYTES, checkCellImage, parseCellIndex, sniffCellImageType } from '../src-routes/lora-cell-images';
import { send, signedRequest, workerGrant } from './helpers/lora-callback-signer';
import { mountLoraIngest } from './helpers/lora-callback-rail';

const SERVICE_SECRET = 'lora-cell-image-test-secret';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const CHARACTER_ID = '10000000-0000-4000-8000-0000000000aa';

/** A validate-kind grant the recording pool resolves for its owner, signed like the real worker. */
const GRANT = workerGrant('dddddddd-dddd-4ddd-8ddd-dddddddddddd.' + 'g'.repeat(43));
function grantRow(owner: string, kinds: string[]) {
  return { id: GRANT.id, character_id: CHARACTER_ID, owner_sub: owner, owner_issuer: 'https://issuer.oshal.example.com', ticket_id: 'ticket-validate', callback_kinds: kinds,
    signing_key: createHash('sha256').update(`oshal-lora-callback-grant-v1:${GRANT.secret}`).digest('hex'), expired: false, revoked: false };
}

/** A real 1x1 PNG, so every ingest case carries bytes the type check actually accepts. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface QueryCall {
  text: string;
  params: unknown[];
}

interface FakeOptions {
  /** Owner whose character lookup resolves; any other owner gets no row, as RLS and the predicate do. */
  resolvesFor?: string;
  /** Rows the live-thumbnail read returns (empty models an expired or absent thumbnail). */
  imageRows?: Array<Record<string, unknown>>;
  /** Cell indexes the hosted-cell listing returns. */
  hostedRows?: Array<{ cell_index: number }>;
}

/**
 * @description Build an app context whose pool records every statement and answers the few shapes
 * these routes issue. The character lookup resolves only for the named owner, which is how a second
 * user's request is made to look exactly like it does in production: no id, so no image query.
 * @param options - Which owner resolves and what the image reads return.
 * @returns The context and the recorded calls.
 */
function recordingContext(options: FakeOptions = {}) {
  const calls: QueryCall[] = [];
  const ctx = {
    pool: {
      query: vi.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        if (/SELECT id(?:, subject)? FROM oshal_lora_characters/.test(text)) {
          const owner = options.resolvesFor ?? OWNER_A;
          return params[1] === owner ? { rows: [{ id: CHARACTER_ID, subject: 'oshbrainrot' }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/SELECT content_type, image FROM oshal_lora_cell_images/.test(text)) {
          const rows = options.imageRows ?? [];
          return { rows, rowCount: rows.length };
        }
        if (/SELECT cell_index FROM oshal_lora_cell_images/.test(text)) {
          const rows = options.hostedRows ?? [];
          return { rows, rowCount: rows.length };
        }
        if (/FROM oshal_lora_scores WHERE character_id/.test(text)) {
          return { rows: [{ version: 3, overall: 0.9, cells: [] }], rowCount: 1 };
        }
        if (/INSERT INTO oshal_lora_cell_images/.test(text)) return { rows: [], rowCount: 1 };
        if (/FROM oshal_lora_callback_grants WHERE id = \$1/.test(text)) {
          return params[1] === OWNER_A ? { rows: [grantRow(OWNER_A, ['score', 'cell-image'])], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO oshal_lora_callback_nonces/.test(text)) return { rows: [{ grant_id: GRANT.id }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    },
    ticketService: { createTicket: vi.fn() },
  } as any;
  return { ctx, calls };
}

/** @description An express app that presents a signed-in OIDC identity, as the studio mount does. */
function authenticatedApp(ownerSub: string): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).oidc = { isAuthenticated: () => true, user: { sub: ownerSub } };
    next();
  });
  app.use(express.json());
  return app;
}

/** @description The worker mount behind its verifier, at its manifest path. */
function ingestApp(ctx: unknown): express.Express {
  const app = express();
  mountLoraIngest(app, ctx as never);
  return app;
}

/** @description Listen on an ephemeral loopback port and return the origin to drive over real HTTP. */
async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  return new Promise((settle, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('missing listener address'));
      settle({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** @description The base64url owner assertion the GPU box sends beside the fleet secret. */
function ownerHeader(sub: string): string {
  return Buffer.from(sub, 'utf8').toString('base64url');
}

describe('LoRA hosted validation thumbnails', () => {
  let server: Server | undefined;
  let previousSecret: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    previousSecret = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = SERVICE_SECRET;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    if (previousSecret === undefined) delete process.env.SWARM_SERVICE_SECRET;
    else process.env.SWARM_SERVICE_SECRET = previousSecret;
  });

  it('bounds a thumbnail by size and by its actual bytes, not by a declared type', () => {
    expect(checkCellImage(PNG_1X1)).toEqual({ ok: true, contentType: 'image/png' });
    expect(checkCellImage(Buffer.alloc(0))).toEqual({ ok: false, error: 'empty_image' });
    expect(checkCellImage(Buffer.from('<html>not an image at all</html>'))).toEqual({ ok: false, error: 'unsupported_image_type' });
    const oversize = Buffer.concat([PNG_1X1, Buffer.alloc(MAX_CELL_IMAGE_BYTES)]);
    expect(checkCellImage(oversize)).toEqual({ ok: false, error: 'image_too_large' });
    expect(sniffCellImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(parseCellIndex('4')).toBe(4);
    expect(parseCellIndex('-1')).toBeNull();
    expect(parseCellIndex('9999')).toBeNull();
  });

  it('stores an attributed thumbnail against the encoded owner with an expiry', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(ingestApp(ctx));
    server = listening.server;
    const response = await send(signedRequest(listening.origin, GRANT, OWNER_A, 'POST',
      '/api/lora/ingest/cell-image?character=oshbrainrot&version=3&cell=2&filename=val_x_v3_02_.png', { bytes: PNG_1X1, type: 'image/png' }));
    expect(response.status).toBe(200);
    const grantLookup = calls.find((call) => /FROM oshal_lora_callback_grants WHERE id = \$1/.test(call.text));
    expect(grantLookup?.params).toEqual([GRANT.id, OWNER_A]);
    const lookup = calls.find((call) => /SELECT id, subject FROM oshal_lora_characters/.test(call.text));
    expect(lookup?.params).toEqual(['oshbrainrot', OWNER_A]);
    const insert = calls.find((call) => /INSERT INTO oshal_lora_cell_images/.test(call.text));
    expect(insert).toBeDefined();
    expect(insert?.text).toMatch(/expires_at/);
    expect(insert?.text).toContain("m.created_at + ($8 || ' days')::INTERVAL");
    expect(insert?.text).toContain("(s.cells -> $3::int ->> 'image')=$7");
    expect(insert?.params.slice(0, 5)).toEqual([CHARACTER_ID, 3, 2, 'image/png', PNG_1X1.length]);
    expect(Buffer.isBuffer(insert?.params[5])).toBe(true);
    expect((insert?.params[5] as Buffer).equals(PNG_1X1)).toBe(true);
  });

  it('refuses a thumbnail callback carrying only the fleet secret and owner before any database access', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(ingestApp(ctx));
    server = listening.server;
    const response = await fetch(`${listening.origin}/api/lora/ingest/cell-image?character=oshbrainrot&version=3&cell=2`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-service-secret': SERVICE_SECRET, 'x-oshal-user-sub-b64': ownerHeader(OWNER_A) },
      body: PNG_1X1,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'callback_grant_required' });
    expect(calls).toHaveLength(0);
  });

  it('refuses bytes that are not an image, and a body over the bound, without writing', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(ingestApp(ctx));
    server = listening.server;
    const notAnImage = await send(signedRequest(listening.origin, GRANT, OWNER_A, 'POST', '/api/lora/ingest/cell-image?character=oshbrainrot&version=3&cell=2',
      { bytes: Buffer.from('<html>not an image at all</html>'), type: 'image/png' }));
    expect(notAnImage.status).toBe(400);
    expect(await notAnImage.json()).toEqual({ error: 'unsupported_image_type' });

    const oversize = await send(signedRequest(listening.origin, GRANT, OWNER_A, 'POST', '/api/lora/ingest/cell-image?character=oshbrainrot&version=3&cell=2',
      { bytes: Buffer.concat([PNG_1X1, Buffer.alloc(MAX_CELL_IMAGE_BYTES)]), type: 'image/png' }));
    // The verifier reads the signed body first, so an oversized one is refused before any grant lookup.
    expect(oversize.status).toBe(401);
    expect(await oversize.json()).toEqual({ error: 'callback_body_refused' });
    expect(calls.filter((call) => /INSERT INTO oshal_lora_cell_images/.test(call.text))).toHaveLength(0);
  });

  it('serves a thumbnail to its owner and filters the expiry on the read itself', async () => {
    const { ctx, calls } = recordingContext({ imageRows: [{ content_type: 'image/png', image: PNG_1X1 }] });
    const listening = await listen(authenticatedApp(OWNER_A).use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/cell-image?subject=oshbrainrot&version=3&cell=2`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG_1X1)).toBe(true);
    const read = calls.find((call) => /SELECT content_type, image FROM oshal_lora_cell_images/.test(call.text));
    expect(read?.text).toMatch(/expires_at > NOW\(\)/);
    expect(read?.params).toEqual([CHARACTER_ID, 3, 2]);
  });

  it('does not let a second user reach another owner thumbnail or even query for it', async () => {
    const { ctx, calls } = recordingContext({ resolvesFor: OWNER_A, imageRows: [{ content_type: 'image/png', image: PNG_1X1 }] });
    const listening = await listen(authenticatedApp(OWNER_B).use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/cell-image?subject=oshbrainrot&version=3&cell=2`);
    expect(response.status).toBe(404);
    const lookup = calls.find((call) => /SELECT id FROM oshal_lora_characters/.test(call.text));
    expect(lookup?.params).toEqual(['oshbrainrot', OWNER_B]);
    expect(calls.filter((call) => /FROM oshal_lora_cell_images/.test(call.text))).toHaveLength(0);
  });

  it('refuses an expired thumbnail with the same not-found answer as a missing one', async () => {
    const { ctx } = recordingContext({ imageRows: [] });
    const listening = await listen(authenticatedApp(OWNER_A).use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/cell-image?subject=oshbrainrot&version=3&cell=2`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no image for that cell' });
  });

  it('tells the scorecard read which cells have a live image, from storage rather than the callback', async () => {
    const { ctx, calls } = recordingContext({ hostedRows: [{ cell_index: 0 }, { cell_index: 2 }] });
    const listening = await listen(authenticatedApp(OWNER_A).use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/scorecard?subject=oshbrainrot&version=3`);
    expect(response.status).toBe(200);
    expect((await response.json()).hostedCells).toEqual([0, 2]);
    const hosted = calls.find((call) => /SELECT cell_index FROM oshal_lora_cell_images/.test(call.text));
    expect(hosted?.text).toMatch(/expires_at > NOW\(\)/);
    expect(hosted?.params).toEqual([CHARACTER_ID, 3]);
  });

  it('deletes a run thumbnails with the run, and only for the owner', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(authenticatedApp(OWNER_A).use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/models/oshbrainrot/3`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    const deleted = calls.find((call) => /DELETE FROM oshal_lora_cell_images/.test(call.text));
    expect(deleted?.params).toEqual([CHARACTER_ID, 3]);
    expect(calls.some((call) => /DELETE FROM oshal_lora_scores/.test(call.text))).toBe(true);
    expect(calls.some((call) => /DELETE FROM oshal_lora_models/.test(call.text))).toBe(true);

    const other = recordingContext({ resolvesFor: OWNER_A });
    const second = await listen(authenticatedApp(OWNER_B).use(createBotLoraRoutes(other.ctx)));
    await new Promise<void>((done) => server!.close(() => done()));
    server = second.server;
    const refused = await fetch(`${second.origin}/models/oshbrainrot/3`, { method: 'DELETE' });
    expect(refused.status).toBe(404);
    expect(other.calls.filter((call) => /DELETE FROM/.test(call.text))).toHaveLength(0);
  });

  it('derives the studio image source from the selected run rather than the box filename', () => {
    const studio = readFileSync(fileURLToPath(new URL('../tools/lora.html', import.meta.url)), 'utf8');
    expect(studio).toContain('function hostedCellImageUrl(subject, version, index)');
    expect(studio).toContain("'/api/lora/cell-image?subject='+encodeURIComponent(subject)+'&version='+v+'&cell='+i");
    expect(studio).toContain('hosted.has(index)?hostedCellImageUrl(subject,version,index)');
    expect(studio).not.toContain('safeImageUrl(c&&c.image)');
    expect(studio).toContain('referrerpolicy="no-referrer"');
  });
});
