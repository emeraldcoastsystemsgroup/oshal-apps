/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the per-dispatch callback grants that replace the fleet service secret on /api/lora/ingest, over real HTTP and forced-RLS disposable PostgreSQL with non-bypass owner roles (migrations 058-105 applied twice). A real dispatch mints the grant and hands it over only as an environment assignment; a fresh signed callback is accepted, and replayed, tampered, stale, expired, revoked, cross-owner, cross-character, wrong-kind and fleet-secret-only requests are refused with no write. The framework repo's Python signer and the dataset command's PowerShell signer are driven against the same verifier, so the shared header contract is proven from both producers. Tickets and GPU enqueue are recording seams; no worker, provider or deployment database is contacted.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verification moved to the kernel's signed-package-callbacks verifier, so the worker router is mounted behind it through the lora-callback-rail double (refusal bodies carry the verifier's reason; the real kernel is crossed by signed-callback-boundary.core.test.js). Grants now record the owner's verified issuer (migration 106): dispatches take it from the package authorization port, a grant without one is refused, and nothing is minted or sent when no verified issuer exists. The dataset download is an empty signed POST to /dataset-download/:id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { grantFromCommand, send, signedCallback, signedHeaders, signedRequest, type WorkerGrant } from './helpers/lora-callback-signer';

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 });

const recorded = vi.hoisted(() => {
  // Worker paths and the callback origin are read once at module load; point both at the fixture.
  const temp = process.env.RUNNER_TEMP || process.env.TEMP || process.env.TMPDIR || '/tmp';
  vi.stubEnv('LORA_BOX_ROOT', `${temp}/lora-grants-box-${process.pid}`);
  vi.stubEnv('LORA_CONTROLLER_URL', 'http://127.0.0.1:9');
  return { commands: [] as string[], tickets: [] as Record<string, unknown>[], online: true, noIssuer: false };
});
vi.mock('@/shared/services/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), runRuntimeSchemaBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: {
  listClients: () => recorded.online ? [{ clientId: 'fixture-edge', status: 'online', healthy: true, capabilities: ['shell.exec'], tailnetHostname: 'fixture-edge' }] : [],
  enqueueTask: async (_client: string, envelope: any) => {
    recorded.commands.push(envelope.input.arguments.command);
    return { taskId: `fixture-task-${recorded.commands.length}` };
  },
} }));
import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
import { callbackGrantSchemaStatements, callbackIdentitySchemaStatements, mintCallbackGrant, withCallbackGrant } from '../src-routes/lora-callback-grants';
import { buildDatasetImportCommand, characterConfigFromRow } from '../src-routes/lora-train-dispatch';
import { fixtureAuthorization, mountLoraIngest } from './helpers/lora-callback-rail';

const MIGRATIONS = ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql',
  '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql', '106-lora-callback-identity.sql'];
const ISSUER = 'https://issuer.oshal.example.com';
const fixture = new DisposablePostgres({ purpose: 'lora-callback-grants', roles: [
  { name: 'grants_a', options: '-c oshal.current_sub=grants_a -c oshal.is_operator=off' },
  { name: 'grants_b', options: '-c oshal.current_sub=grants_b -c oshal.is_operator=off' },
] });
const pkg = fileURLToPath(new URL('..', import.meta.url));
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'));
const FLEET_SECRET = 'grants-fixture-fleet-secret';
const A1 = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B1 = 'b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const workerKey = (id: string) => `lora-${id.replace(/-/g, '')}`;
let server: Server, base: string;

/** Owner-bound pool: every query runs as the non-bypass role named by the request identity. */
function ownerPool() {
  const role = () => {
    const sub = getRequestIdentity()?.sub;
    if (sub !== 'grants_a' && sub !== 'grants_b') throw new Error('Unbound fixture database identity');
    return fixture.rolePool(sub);
  };
  return { query: (sql: string, params?: unknown[]) => role().query(sql, params), connect: () => role().connect() };
}

const ctx = { pool: ownerPool(), appPackageDir: pkg, authorization: fixtureAuthorization(),
  ticketService: { createTicket: async (ticket: Record<string, unknown>) => {
    recorded.tickets.push(ticket); return { ticketId: `fixture-ticket-${recorded.tickets.length}` };
  } } } as any;

function makeApp(): express.Express {
  const app = express();
  app.use(express.json()); // the controller's global parser: it must leave signed callback bodies alone
  mountLoraIngest(app, ctx);
  app.use('/api/lora', (req, res, next) => {
    const sub = req.headers['x-fixture-owner'];
    if (sub !== 'grants_a' && sub !== 'grants_b') { res.status(401).end(); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub, principalIssuer: recorded.noIssuer ? undefined : ISSUER, isOperator: false }, next);
  }, createBotLoraRoutes(ctx));
  return app;
}

beforeAll(async () => {
  vi.stubEnv('SWARM_SERVICE_SECRET', FLEET_SECRET);
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of MIGRATIONS) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  // The lazy runtime bootstrap must replay cleanly over the migrated schema.
  for (const statement of [...callbackGrantSchemaStatements(), ...callbackIdentitySchemaStatements()]) await fixture.pool.query(statement);
  await fixture.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO grants_a, grants_b');
  server = makeApp().listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);

beforeEach(async () => {
  await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  await fixture.pool.query(`INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub) VALUES
    ($1, 'drummer', 'Drummer', 'drummer', 'grants_a'), ($2, 'piper', 'Piper', 'piper', 'grants_a'),
    ($3, 'drummer', 'Other drummer', 'drummer', 'grants_b')`, [A1, A2, B1]);
  recorded.commands.length = 0; recorded.tickets.length = 0; recorded.online = true; recorded.noIssuer = false;
});

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  await fixture.stop();
  rmSync(String(process.env.LORA_BOX_ROOT), { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function rows(sql: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  return (await fixture.pool.query(sql, params)).rows;
}

/** Dispatch a real training job as the owner and return the grant its worker received. */
async function dispatchTrain(owner = 'grants_a', subject = 'drummer'): Promise<WorkerGrant> {
  const response = await fetch(`${base}/api/lora/train`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fixture-owner': owner }, body: JSON.stringify({ subject }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return grantFromCommand(recorded.commands.at(-1)!);
}

function training(character: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'training', character, version: 1, status: 'trained', ...extra };
}

describe('per-dispatch LoRA callback grants', () => {
  it('mints one scoped grant per dispatch and hands it over only as an environment assignment', async () => {
    const grant = await dispatchTrain();
    const command = recorded.commands[0];
    expect(command.split(grant.secret)).toHaveLength(2);
    expect(command.indexOf(grant.secret)).toBeLessThan(command.indexOf('train-lora.py'));
    expect(command).not.toContain(FLEET_SECRET);
    const [row] = await rows('SELECT * FROM oshal_lora_callback_grants');
    expect(row).toMatchObject({ id: grant.id, character_id: A1, owner_sub: 'grants_a', owner_issuer: ISSUER, ticket_id: 'fixture-ticket-1',
      dispatch_kind: 'train', callback_kinds: ['training'], revoked_at: null });
    expect(row.signing_key).toBe(createHash('sha256').update(`oshal-lora-callback-grant-v1:${grant.secret}`).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(grant.secret);
    const hours = (new Date(row.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9); expect(hours).toBeLessThan(12.01);
  });

  it('accepts a fresh signed callback and refuses the identical request replayed', async () => {
    const grant = await dispatchTrain();
    const request = signedCallback(base, grant, 'grants_a', training(workerKey(A1)));
    expect((await send(request)).status).toBe(200);
    const replay = await send(request);
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: 'callback_replayed' });
    expect((await send(signedCallback(base, grant, 'grants_a', training(workerKey(A1), { version: 2 })))).status).toBe(200);
    expect(await rows('SELECT version FROM oshal_lora_models ORDER BY version')).toEqual([{ version: 1 }, { version: 2 }]);
    expect(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces')).toEqual([{ n: 2 }]);
  });

  it('refuses the fleet secret alone, an unsigned request and a tampered body before any write', async () => {
    const grant = await dispatchTrain();
    const body = JSON.stringify(training(workerKey(A1)));
    const fleet = await fetch(`${base}/api/lora/ingest`, { method: 'POST', body, headers: { 'content-type': 'application/json',
      'x-service-secret': FLEET_SECRET, 'x-oshal-user-sub-b64': Buffer.from('grants_a').toString('base64url') } });
    expect(fleet.status).toBe(401);
    expect(await fleet.json()).toEqual({ error: 'callback_grant_required' });
    const signed = signedCallback(base, grant, 'grants_a', training(workerKey(A1)));
    const tampered = await fetch(signed.url, { ...signed.init, body: Buffer.from(JSON.stringify(training(workerKey(A1), { version: 7 }))) });
    expect(tampered.status).toBe(401);
    expect(await tampered.json()).toEqual({ error: 'callback_signature_invalid' });
    const forged = signedCallback(base, { ...grant, secret: 'x'.repeat(43) }, 'grants_a', training(workerKey(A1)));
    expect((await send(forged)).status).toBe(401);
    expect(await rows('SELECT version, status FROM oshal_lora_models')).toEqual([{ version: 1, status: 'training' }]);
  });

  it('refuses an expired grant and a stale timestamp', async () => {
    const grant = await dispatchTrain();
    const stale = signedCallback(base, grant, 'grants_a', training(workerKey(A1)), { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    const staleResponse = await send(stale);
    expect(staleResponse.status).toBe(401);
    expect(await staleResponse.json()).toEqual({ error: 'callback_timestamp_stale' });
    await fixture.pool.query("UPDATE oshal_lora_callback_grants SET expires_at = NOW() - INTERVAL '1 second', created_at = NOW() - INTERVAL '1 hour'");
    const expired = await send(signedCallback(base, grant, 'grants_a', training(workerKey(A1))));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: 'callback_grant_expired' });
    expect(await rows('SELECT version, status FROM oshal_lora_models')).toEqual([{ version: 1, status: 'training' }]);
  });

  it("refuses another owner's grant and another character's grant", async () => {
    const grantA = await dispatchTrain('grants_a', 'drummer');
    const asOtherOwner = await send(signedCallback(base, grantA, 'grants_b', training(workerKey(B1))));
    expect(asOtherOwner.status).toBe(401);
    expect(await asOtherOwner.json()).toEqual({ error: 'callback_grant_invalid' });
    const otherCharacter = await send(signedCallback(base, grantA, 'grants_a', training(workerKey(A2))));
    expect(otherCharacter.status).toBe(403);
    expect(await otherCharacter.json()).toEqual({ error: 'callback_character_not_granted' });
    const byPublicName = await send(signedCallback(base, grantA, 'grants_a', training('piper')));
    expect(byPublicName.status).toBe(403);
    expect(await rows('SELECT character_id, status FROM oshal_lora_models')).toEqual([{ character_id: A1, status: 'training' }]);
  });

  it('refuses a callback kind the dispatch was not granted', async () => {
    const grant = await dispatchTrain();
    for (const payload of [{ kind: 'score', character: workerKey(A1), version: 1, cells: [] },
      { kind: 'review', character: workerKey(A1), ticket_id: 'fixture-ticket-1', best_version: 1 },
      { kind: 'dataset', character: workerKey(A1), filename: 'x.png', status: 'ready' }]) {
      const response = await send(signedCallback(base, grant, 'grants_a', payload));
      expect(response.status, payload.kind).toBe(403);
      expect(await response.json()).toEqual({ error: 'callback_kind_not_granted' });
    }
    const target = `/api/lora/ingest/cell-image?character=${workerKey(A1)}&version=1&cell=0&filename=cell.png`;
    const image = await send(signedRequest(base, grant, 'grants_a', 'POST', target, { bytes: PNG, type: 'image/png' }));
    expect(image.status).toBe(403);
    const download = await send(signedRequest(base, grant, 'grants_a', 'POST', `/api/lora/ingest/dataset-download/${A2}`));
    expect(download.status).toBe(403);
    expect(await download.json()).toEqual({ error: 'callback_kind_not_granted' });
    expect(recorded.tickets).toHaveLength(1);
  });

  it('refuses a grant that records no owner issuer, as every 1.6.0 grant does, before spending its nonce', async () => {
    const grant = await dispatchTrain();
    await fixture.pool.query('UPDATE oshal_lora_callback_grants SET owner_issuer = NULL');
    const response = await send(signedCallback(base, grant, 'grants_a', training(workerKey(A1))));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'callback_grant_issuer_missing' });
    expect(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces')).toEqual([{ n: 0 }]);
  });

  it('mints nothing and sends nothing when the caller has no verified issuer', async () => {
    recorded.noIssuer = true;
    const response = await fetch(`${base}/api/lora/train`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fixture-owner': 'grants_a' }, body: JSON.stringify({ subject: 'drummer' }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'box_required' });
    expect(recorded.commands).toHaveLength(0);
    expect(await rows('SELECT id FROM oshal_lora_callback_grants')).toHaveLength(0);
    await expect(runWithRequestIdentity({ sub: 'grants_a', isOperator: false }, () => mintCallbackGrant(ctx.pool,
      { characterId: A1, ownerSub: 'grants_a', ownerIssuer: '', ticketId: 't', dispatchKind: 'train' }))).rejects.toThrow(/owner issuer/);
  });

  it('records the enabling owner issuer for autonomous mode and refuses to enable it without one', async () => {
    const toggle = (enabled: boolean) => fetch(`${base}/api/lora/characters/drummer/autonomous`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fixture-owner': 'grants_a' }, body: JSON.stringify({ enabled }) });
    recorded.noIssuer = true;
    const refused = await toggle(true);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'verified_owner_required' });
    expect(await rows('SELECT autonomous, autonomous_issuer FROM oshal_lora_characters WHERE id = $1', [A1])).toEqual([{ autonomous: false, autonomous_issuer: null }]);
    recorded.noIssuer = false;
    expect((await toggle(true)).status).toBe(200);
    expect(await rows('SELECT autonomous, autonomous_issuer FROM oshal_lora_characters WHERE id = $1', [A1])).toEqual([{ autonomous: true, autonomous_issuer: ISSUER }]);
    expect((await toggle(false)).status).toBe(200);
    expect(await rows('SELECT autonomous, autonomous_issuer FROM oshal_lora_characters WHERE id = $1', [A1])).toEqual([{ autonomous: false, autonomous_issuer: null }]);
  });

  it('revokes the grant of a dispatch no worker accepted', async () => {
    recorded.online = false;
    const response = await fetch(`${base}/api/lora/train`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fixture-owner': 'grants_a' }, body: JSON.stringify({ subject: 'drummer' }) });
    expect(response.status).toBe(503);
    const [row] = await rows('SELECT revoked_at FROM oshal_lora_callback_grants');
    expect(row.revoked_at).not.toBeNull();
  });

  it('keeps the runtime grant DDL and migration 105 under the same forced owner RLS and bounds', () => {
    const runtime = callbackGrantSchemaStatements().join('\n');
    const migration = readFileSync(resolve(pkg, 'migrations', '105-lora-callback-grants.sql'), 'utf8');
    for (const text of [runtime, migration]) {
      for (const fragment of ['CREATE TABLE IF NOT EXISTS oshal_lora_callback_grants', 'CREATE TABLE IF NOT EXISTS oshal_lora_callback_nonces',
        'ALTER TABLE oshal_lora_callback_grants FORCE ROW LEVEL SECURITY', 'ALTER TABLE oshal_lora_callback_nonces FORCE ROW LEVEL SECURITY',
        'REFERENCES oshal_lora_characters(id) ON DELETE CASCADE', 'REFERENCES oshal_lora_callback_grants(id) ON DELETE CASCADE',
        "signing_key ~ '^[0-9a-f]{64}$'", "nonce ~ '^[A-Za-z0-9_-]{16,64}$'", 'PRIMARY KEY (grant_id, nonce)',
        'c.owner_sub = oshal_lora_callback_grants.owner_sub']) {
        expect(text, fragment).toContain(fragment);
      }
    }
  });

  it('keeps the runtime identity DDL and migration 106 identical in their bounds', () => {
    const runtime = callbackIdentitySchemaStatements().join('\n');
    const migration = readFileSync(resolve(pkg, 'migrations', '106-lora-callback-identity.sql'), 'utf8');
    for (const text of [runtime, migration]) {
      for (const fragment of ['ALTER TABLE oshal_lora_callback_grants ADD COLUMN IF NOT EXISTS owner_issuer TEXT',
        'CHECK (owner_issuer IS NULL OR length(owner_issuer) BETWEEN 1 AND 2048)',
        'ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS autonomous_issuer TEXT',
        'CHECK (autonomous_issuer IS NULL OR length(autonomous_issuer) BETWEEN 1 AND 2048)']) {
        expect(text, fragment).toContain(fragment);
      }
    }
  });

  it('keeps grants and nonces invisible and unmintable across owners at the database', async () => {
    const grant = await dispatchTrain();
    expect((await send(signedCallback(base, grant, 'grants_a', training(workerKey(A1))))).status).toBe(200);
    expect((await fixture.rolePool('grants_a').query('SELECT id FROM oshal_lora_callback_grants')).rows).toHaveLength(1);
    expect((await fixture.rolePool('grants_b').query('SELECT id FROM oshal_lora_callback_grants')).rows).toHaveLength(0);
    expect((await fixture.rolePool('grants_b').query('SELECT nonce FROM oshal_lora_callback_nonces')).rows).toHaveLength(0);
    const insert = `INSERT INTO oshal_lora_callback_grants (character_id, owner_sub, dispatch_kind, callback_kinds, signing_key, expires_at)
      VALUES ($1, $2, 'train', ARRAY['training'], $3, NOW() + INTERVAL '1 hour')`;
    await expect(fixture.rolePool('grants_b').query(insert, [A1, 'grants_b', 'a'.repeat(64)])).rejects.toThrow(/row-level security/);
    await expect(fixture.rolePool('grants_a').query(insert, [A1, 'grants_b', 'a'.repeat(64)])).rejects.toThrow(/row-level security/);
    expect((await fixture.rolePool('grants_b').query('UPDATE oshal_lora_callback_grants SET revoked_at = NULL')).rowCount).toBe(0);
  });
});

/** A Python 3 interpreter, required: the box signer is Python and a skipped guard is no guard. */
function python(): string {
  for (const candidate of ['python3', 'python']) {
    const r = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return candidate;
  }
  throw new Error('python3 is required to prove the box signer against the verifier');
}

/** A PowerShell host, required: the dataset import command is PowerShell. */
function powershell(): string {
  for (const candidate of ['powershell.exe', 'pwsh']) {
    const r = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (r.status === 0) return candidate;
  }
  throw new Error('PowerShell is required to prove the dataset command signer against the verifier');
}

/** Run a child without blocking this process's event loop, which serves the requests it makes. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', fail);
    child.once('close', (code) => done({ status: code ?? -1, stdout, stderr }));
  });
}

describe('the shared header contract, from both box-side producers', () => {
  it('accepts callbacks signed by the framework box signer and refuses its request replayed', async () => {
    const helper = join(framework, 'scripts', 'comfyui-edge', 'lora_callback.py');
    expect(existsSync(helper), `${helper} is missing: the framework checkout predates callback grants`).toBe(true);
    const grant = await dispatchTrain();
    const owner = Buffer.from('grants_a').toString('base64url');
    const driver = [
      'import importlib.util, json, sys',
      'spec = importlib.util.spec_from_file_location("lora_callback", sys.argv[1])',
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'grant = m.load_grant()',
      'print(json.dumps(m.post_json(sys.argv[2], grant, sys.argv[3], json.loads(sys.argv[4]))))',
      'body = json.dumps(json.loads(sys.argv[5])).encode()',
      'headers = m.signed_headers(grant, sys.argv[3], "POST", sys.argv[2] + "/api/lora/ingest", body)',
      'print(json.dumps({"headers": headers, "body": body.decode()}))',
    ].join('\n');
    const result = await run(python(), ['-c', driver, helper, base, owner, JSON.stringify(training(workerKey(A1))),
      JSON.stringify(training(workerKey(A1), { version: 2 }))], { ...process.env, OSHAL_LORA_CALLBACK_GRANT: grant.token });
    expect(result.status, result.stderr).toBe(0);
    const [accepted, prepared] = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(accepted).toMatchObject({ ok: true, kind: 'training', version: 1 });
    expect(Object.keys(prepared.headers).sort()).toEqual(Object.keys(signedHeaders({ grant, owner: 'grants_a', method: 'POST', target: '/' })).sort());
    const init = { method: 'POST', body: prepared.body, headers: { ...prepared.headers, 'content-type': 'application/vnd.oshal.lora-callback+json' } };
    expect((await fetch(`${base}/api/lora/ingest`, init)).status).toBe(200);
    expect((await fetch(`${base}/api/lora/ingest`, init)).status).toBe(401);
    expect(await rows('SELECT version FROM oshal_lora_models ORDER BY version')).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('runs the dataset import command end to end under its grant, then refuses the same command again', async () => {
    const [receipt] = await rows(`INSERT INTO oshal_lora_dataset_images (character_id, filename, caption, byte_size, status)
      VALUES ($1, 'portrait.png', 'drummer, portrait', $2, 'queued') RETURNING id`, [A1, PNG.length]);
    await fixture.pool.query(`INSERT INTO oshal_lora_dataset_staging (image_id, content_type, byte_size, sha256, image, expires_at)
      VALUES ($1, 'image/png', $2, 'fixture', $3, NOW() + INTERVAL '1 hour')`, [receipt.id, PNG.length, PNG]);
    const [character] = await rows('SELECT * FROM oshal_lora_characters WHERE id = $1', [A1]);
    const grant = await runWithRequestIdentity({ sub: 'grants_a', isOperator: false }, () => mintCallbackGrant(ctx.pool,
      { characterId: A1, ownerSub: 'grants_a', ownerIssuer: ISSUER, ticketId: 'fixture-dataset-ticket', dispatchKind: 'dataset-import' }));
    const command = withCallbackGrant(buildDatasetImportCommand(characterConfigFromRow(character), receipt.id, 'portrait.png',
      'drummer, portrait', 'grants_a'), grant).split('http://127.0.0.1:9/').join(`${base}/`);
    const curated = join(String(process.env.LORA_BOX_ROOT), workerKey(A1), 'curated');
    mkdirSync(String(process.env.LORA_BOX_ROOT), { recursive: true });
    const shell = powershell();
    const first = await run(shell, ['-NoProfile', '-NonInteractive', '-Command', command], process.env);
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(join(curated, 'portrait.png')).equals(PNG)).toBe(true);
    expect(readFileSync(join(curated, 'portrait.txt'), 'utf8')).toBe('drummer, portrait');
    expect(await rows('SELECT status, byte_size FROM oshal_lora_dataset_images')).toEqual([{ status: 'ready', byte_size: PNG.length }]);
    expect(await rows('SELECT * FROM oshal_lora_dataset_staging')).toHaveLength(0);
    expect(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces')).toEqual([{ n: 2 }]);
    expect((await rows('SELECT revoked_at FROM oshal_lora_callback_grants'))[0].revoked_at).not.toBeNull();
    const again = await run(shell, ['-NoProfile', '-NonInteractive', '-Command', command], process.env);
    expect(again.status).not.toBe(0);
    expect(await rows('SELECT status FROM oshal_lora_dataset_images')).toEqual([{ status: 'ready' }]);
  });
});
