/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real-boundary proof of the nightly autonomous schedule and its morning-review handoff. The handler runs under the system identity against forced-RLS disposable PostgreSQL through a NON-bypass operator role (migrations 058-105 applied twice), with two owners and four characters (ready, not ready, disabled, other owner's ready), and with core's real TicketService over its in-memory store so dedupe and status transitions are the framework's own. The review callbacks are signed with the grant each scheduled dispatch actually handed its worker. Only GPU enqueue is a recording seam.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Worker callbacks now pass the kernel's signed-package-callbacks verifier first: the ingest router is mounted through the lora-callback-rail double (POST only, verifier, then the router as the grant owner; the real kernel is crossed by signed-callback-boundary.core.test.js), grants carry the owner's verified issuer (migration 106) and the dataset download is an empty signed POST to /dataset-download/:id. Scheduled grants take the issuer recorded when the owner enabled autonomous mode, and a character enabled before that was recorded is skipped as not ready.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity } from '@/shared/services/database/request-identity';
import { InMemoryTicketStore, TicketService } from '@/features/ticketing';
import { grantFromCommand, send, signedCallback, type WorkerGrant } from './helpers/lora-callback-signer';

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

const recorded = vi.hoisted(() => ({ commands: [] as string[] }));
vi.mock('@/shared/services/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), runRuntimeSchemaBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: {
  listClients: () => [{ clientId: 'fixture-edge', status: 'online', healthy: true, capabilities: ['shell.exec'], tailnetHostname: 'fixture-edge' }],
  enqueueTask: async (_client: string, envelope: any) => {
    recorded.commands.push(envelope.input.arguments.command);
    return { taskId: `fixture-task-${recorded.commands.length}` };
  },
} }));
import { runLoraOvernightSchedule } from '../src-routes/bot-lora-routes';
import { mountLoraIngest } from './helpers/lora-callback-rail';

const MIGRATIONS = ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql',
  '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql', '106-lora-callback-identity.sql'];
const ISSUER = 'https://issuer.oshal.example.com';
const fixture = new DisposablePostgres({ purpose: 'lora-overnight-schedule', roles: [
  { name: 'nightly_a', options: '-c oshal.current_sub=nightly_a -c oshal.is_operator=off' },
  { name: 'nightly_b', options: '-c oshal.current_sub=nightly_b -c oshal.is_operator=off' },
  // The system identity's database role: operator visibility, but still NOBYPASSRLS, so every
  // policy (including the grant's owner-equals-character-owner check) is really evaluated.
  { name: 'nightly_system', options: '-c oshal.current_sub=system:lora-schedule -c oshal.is_operator=on' },
] });
const pkg = fileURLToPath(new URL('..', import.meta.url));
const A1 = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; // nightly_a, autonomous, trained v1
const A2 = 'a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'; // nightly_a, autonomous, no model yet
const B1 = 'b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbb1'; // nightly_b, NOT autonomous, scored v1
const B2 = 'b2b2b2b2-bbbb-4bbb-8bbb-bbbbbbbbbbb2'; // nightly_b, autonomous, scored v1
const workerKey = (id: string) => `lora-${id.replace(/-/g, '')}`;
let server: Server, base: string, tickets: TicketService;

/** Identity-bound pool: system work uses the operator role, a callback its exact owner's role. */
function identityPool() {
  const role = () => {
    const identity = getRequestIdentity();
    if (identity?.isOperator) return fixture.rolePool('nightly_system');
    if (identity?.sub === 'nightly_a' || identity?.sub === 'nightly_b') return fixture.rolePool(identity.sub);
    throw new Error('Unbound fixture database identity');
  };
  return { query: (sql: string, params?: unknown[]) => role().query(sql, params), connect: () => role().connect() };
}

const ctx = { pool: identityPool(), appPackageDir: pkg } as any;

beforeAll(async () => {
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of MIGRATIONS) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nightly_a, nightly_b, nightly_system');
  const app = express();
  app.use(express.json());
  mountLoraIngest(app, ctx);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);

beforeEach(async () => {
  tickets = new TicketService(new InMemoryTicketStore());
  ctx.ticketService = tickets;
  recorded.commands.length = 0;
  await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  await fixture.pool.query(`INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub, autonomous, autonomous_issuer, max_hours) VALUES
    ($1, 'drummer', 'Drummer', 'drummer', 'nightly_a', TRUE, $5, 2), ($2, 'piper', 'Piper', 'piper', 'nightly_a', TRUE, $5, 2),
    ($3, 'fiddler', 'Fiddler', 'fiddler', 'nightly_b', FALSE, NULL, 2), ($4, 'drummer', 'Other drummer', 'drummer', 'nightly_b', TRUE, $5, 3)`,
  [A1, A2, B1, B2, ISSUER]);
  await fixture.pool.query(`INSERT INTO oshal_lora_models (character_id, version, status, lora_path) VALUES
    ($1, 1, 'trained', $4), ($2, 1, 'scored', $5), ($3, 1, 'scored', $6)`,
  [A1, B1, B2, `C:\\models\\${workerKey(A1)}_v1.safetensors`, `C:\\models\\${workerKey(B1)}_v1.safetensors`, `C:\\models\\${workerKey(B2)}_v1.safetensors`]);
});

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  await fixture.stop();
});

function tick(night = '2026-09-27T02:00:00.000Z') {
  return runLoraOvernightSchedule(ctx, { scheduleId: 'lora-lora-autonomous-overnight', scheduledAtIso: night, body: {} });
}

async function overnightTickets(characterId: string) {
  return (await tickets.listTickets()).filter((t) => (t.metadata as Record<string, unknown>)?.loraOvernightCharacterId === characterId);
}

/** The command and grant the schedule dispatched for one character. */
function dispatchFor(characterId: string): { command: string; grant: WorkerGrant } {
  const command = recorded.commands.find((c) => c.includes(`--character '${workerKey(characterId)}'`));
  if (!command) throw new Error(`no command was dispatched for ${characterId}`);
  return { command, grant: grantFromCommand(command) };
}

async function review(grant: WorkerGrant, owner: string, character: string, ticketId: string) {
  return send(signedCallback(base, grant, owner, { kind: 'review', character, ticket_id: ticketId, best_version: 2, overall: 0.81,
    summary: 'Overnight improve finished: best v2.' }));
}

describe('the nightly autonomous LoRA schedule', () => {
  it('dispatches exactly the opted-in, ready characters, each under its own owner and grant', async () => {
    expect((await tick()).summary).toBe('LoRA overnight schedule: 2 started, 1 skipped or not ready.');
    expect(recorded.commands).toHaveLength(2);
    for (const [id, owner] of [[A1, 'nightly_a'], [B2, 'nightly_b']] as const) {
      const [ticket] = await overnightTickets(id);
      expect(ticket).toMatchObject({ ownerSub: owner, status: 'approved', ticketType: 'lora-train' });
      expect(ticket.metadata).toMatchObject({ source: 'nightly-schedule', characterId: id, startVersion: 1 });
      const { command, grant } = dispatchFor(id);
      expect(command).toContain(`--owner-sub-b64 '${Buffer.from(owner).toString('base64url')}'`);
      expect(command).toContain(`--review-ticket-id '${ticket.ticketId}'`);
      expect(command).toContain(`/${workerKey(id)}/curated`);
      const other = id === A1 ? B2 : A1;
      expect(command).not.toContain(workerKey(other));
      const [row] = (await fixture.pool.query('SELECT * FROM oshal_lora_callback_grants WHERE id = $1', [grant.id])).rows;
      expect(row).toMatchObject({ owner_sub: owner, owner_issuer: ISSUER, character_id: id, ticket_id: ticket.ticketId, dispatch_kind: 'overnight', revoked_at: null });
      expect(row.callback_kinds).toEqual(['training', 'score', 'cell-image', 'review']);
    }
    expect(await overnightTickets(A2)).toHaveLength(0);
    expect(await overnightTickets(B1)).toHaveLength(0);
    expect((await fixture.pool.query('SELECT character_id FROM oshal_lora_callback_grants WHERE character_id = ANY($1)', [[A2, B1]])).rows).toHaveLength(0);
  });

  it('skips an autonomous character enabled before owner issuers were recorded, minting and sending nothing for it', async () => {
    await fixture.pool.query('UPDATE oshal_lora_characters SET autonomous_issuer = NULL WHERE id = $1', [A1]);
    expect((await tick()).summary).toBe('LoRA overnight schedule: 1 started, 2 skipped or not ready.');
    expect(await overnightTickets(A1)).toHaveLength(0);
    expect(recorded.commands.some((c) => c.includes(workerKey(A1)))).toBe(false);
    expect((await fixture.pool.query('SELECT id FROM oshal_lora_callback_grants WHERE character_id = $1', [A1])).rows).toHaveLength(0);
  });

  it('skips characters whose loop is still running, including after an earlier night completed', async () => {
    await tick();
    expect((await tick()).summary).toBe('LoRA overnight schedule: 0 started, 3 skipped or not ready.');
    expect(recorded.commands).toHaveLength(2);
    const [first] = await overnightTickets(A1);
    expect((await review(dispatchFor(A1).grant, 'nightly_a', workerKey(A1), first.ticketId)).status).toBe(200);
    recorded.commands.length = 0;
    expect((await tick('2026-09-28T02:00:00.000Z')).summary).toBe('LoRA overnight schedule: 1 started, 2 skipped or not ready.');
    expect(dispatchFor(A1).command).toContain('overnight-loop.py');
    // A second tick that night: A1 now has a completed ticket AND a running one. Only the newest counts.
    expect((await tick('2026-09-28T02:00:00.000Z')).summary).toBe('LoRA overnight schedule: 0 started, 3 skipped or not ready.');
    expect(recorded.commands).toHaveLength(1);
    expect((await overnightTickets(A1)).map((t) => t.status).sort()).toEqual(['approved', 'complete']);
  });

  it('parks one approval_required morning review, completes only its own dispatch ticket and revokes the grant', async () => {
    await tick();
    const [dispatchA] = await overnightTickets(A1);
    const [dispatchB] = await overnightTickets(B2);
    const { grant } = dispatchFor(A1);
    const response = await review(grant, 'nightly_a', workerKey(A1), dispatchA.ticketId);
    expect(response.status, await response.clone().text()).toBe(200);
    const reviews = (await tickets.listTickets()).filter((t) => (t.metadata as Record<string, unknown>)?.action === 'review');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ status: 'approval_required', ownerSub: 'nightly_a', ticketType: 'lora-train' });
    expect(reviews[0].metadata).toMatchObject({ characterId: A1, bestVersion: 2, dispatchTicketId: dispatchA.ticketId });
    expect((await tickets.getTicket(dispatchA.ticketId))?.status).toBe('complete');
    expect((await tickets.getTicket(dispatchB.ticketId))?.status).toBe('approved');
    const revoked = (await fixture.pool.query('SELECT revoked_at FROM oshal_lora_callback_grants WHERE id = $1', [grant.id])).rows[0];
    expect(revoked.revoked_at).not.toBeNull();
    const again = await review(grant, 'nightly_a', workerKey(A1), dispatchA.ticketId);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: 'callback_grant_revoked' });
    expect((await tickets.listTickets()).filter((t) => (t.metadata as Record<string, unknown>)?.action === 'review')).toHaveLength(1);
  });

  it("refuses a review naming another owner's dispatch ticket and leaves that ticket untouched", async () => {
    await tick();
    const [dispatchB] = await overnightTickets(B2);
    const response = await review(dispatchFor(A1).grant, 'nightly_a', workerKey(A1), dispatchB.ticketId);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'callback_ticket_not_granted' });
    expect((await tickets.getTicket(dispatchB.ticketId))?.status).toBe('approved');
    const crossOwner = await review(dispatchFor(B2).grant, 'nightly_a', workerKey(A1), dispatchB.ticketId);
    expect(crossOwner.status).toBe(401);
    expect((await tickets.listTickets()).filter((t) => (t.metadata as Record<string, unknown>)?.action === 'review')).toHaveLength(0);
    expect((await fixture.pool.query('SELECT count(*)::int AS n FROM oshal_lora_callback_grants WHERE revoked_at IS NOT NULL')).rows[0].n).toBe(0);
  });

  it("refuses a review for another of the owner's characters under this character's grant", async () => {
    await tick();
    const [dispatchA] = await overnightTickets(A1);
    const response = await review(dispatchFor(A1).grant, 'nightly_a', workerKey(A2), dispatchA.ticketId);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'callback_character_not_granted' });
    expect((await tickets.getTicket(dispatchA.ticketId))?.status).toBe('approved');
    expect((await tickets.listTickets()).filter((t) => (t.metadata as Record<string, unknown>)?.action === 'review')).toHaveLength(0);
  });
});
