/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Guard route-level LoRA owner predicates, per-owner starter creation, service callback attribution, and encoded owner carriage to the GPU scripts.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | Guard lazy schema bootstrap against cross-owner system-seed writes after FORCE RLS is active.
 * 3   | maintainer@emeraldcoastsystemsgroup.com   | Prove durable GPU commands omit the fleet secret and PowerShell-quote data-derived arguments.
 * 4   | maintainer@emeraldcoastsystemsgroup.com   | Guard the studio renderer against stored script injection from character, model, score, image, and error fields.
 * 5   | maintainer@emeraldcoastsystemsgroup.com   | A box command is now built from a whole character row, and the subject names that character's own box directory. The owner-carriage case keeps every assertion against a legal character; a second case pins that an injecting subject is REFUSED outright rather than merely quoted, because it would otherwise reach a path.
 * 6   | maintainer@emeraldcoastsystemsgroup.com   | Keep callback attribution and command quoting assertions aligned with immutable worker names rather than public-subject paths.
 * 7   | maintainer@emeraldcoastsystemsgroup.com   | Callbacks authenticate with a per-dispatch grant: a fleet-secret request is refused before any database access, a signed callback resolves its grant and character under the grant owner, and the box scripts sign with the grant from their environment and never read the fleet secret.
 * 8   | maintainer@emeraldcoastsystemsgroup.com   | The ingest router runs behind the signed-package-callbacks verifier (lora-callback-rail double) at its manifest path, and grant rows carry an owner issuer.
 * 9   | maintainer@emeraldcoastsystemsgroup.com   | GET /characters no longer creates the starter character: the native host admits a GET read-only and refused that INSERT, so the studio's first read failed for every account. The app routes now run under a double of the native admission rule (a GET may run only a query or idempotent table setup; anything else is refused with the host's message). Pins: the list is a pure owner-bound read; the starter is created only by an explicit POST /characters/starter, owner-bound and idempotent, which answers the list; every LoRA GET route answers without attempting a write; and the double refuses the very INSERT the GET used to make.
 */

import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
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
import { buildTrainCommand, boxRootFor } from '../src-routes/lora-train-dispatch';
import { send, signedCallback, workerGrant } from './helpers/lora-callback-signer';
import { mountLoraIngest } from './helpers/lora-callback-rail';

const CHARACTER_ID = '10000000-0000-4000-8000-0000000000bb';

/** A validate-kind grant the recording pool resolves for its owner, signed like the real worker. */
const GRANT = workerGrant('dddddddd-dddd-4ddd-8ddd-dddddddddddd.' + 'g'.repeat(43));
function grantRow(owner: string, kinds: string[]) {
  return { id: GRANT.id, character_id: CHARACTER_ID, owner_sub: owner, owner_issuer: 'https://issuer.oshal.example.com', ticket_id: 'ticket-validate', callback_kinds: kinds,
    signing_key: createHash('sha256').update(`oshal-lora-callback-grant-v1:${GRANT.secret}`).digest('hex'), expired: false, revoked: false };
}

interface QueryCall {
  text: string;
  params: unknown[];
}

/** The admission each request runs under: GET and HEAD read, anything else write (as the native host admits). */
const admission = new AsyncLocalStorage<'read' | 'write'>();
/** The native host's refusal, verbatim (crates/packages/src/sql_transaction.rs). */
const WRITER_REFUSAL = 'SQL mutation requires original writer admission';
/** What read admission lets through: a query, or idempotent table setup. */
const READ_STATEMENT = /^\s*(?:SELECT|WITH|VALUES|TABLE)\b/i;
const IDEMPOTENT_DDL = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i;

function recordingContext() {
  const calls: QueryCall[] = [];
  const refused: string[] = [];
  const ctx = {
    pool: {
      query: vi.fn(async (text: string, params: unknown[] = []) => {
        if (admission.getStore() === 'read' && !READ_STATEMENT.test(text) && !IDEMPOTENT_DDL.test(text)) {
          refused.push(text.trim().replace(/\s+/g, ' ').slice(0, 120));
          throw new Error(`refused: ${WRITER_REFUSAL}`);
        }
        calls.push({ text, params });
        if (/FROM oshal_lora_characters c\s+WHERE c\.owner_sub/.test(text)) {
          return { rows: [{ subject: 'oshbrainrot', display_name: 'Cyclops' }], rowCount: 1 };
        }
        if (/FROM oshal_lora_callback_grants WHERE id = \$1/.test(text)) {
          return params[1] === 'owner-callback' ? { rows: [grantRow('owner-callback', ['score'])], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO oshal_lora_callback_nonces/.test(text)) return { rows: [{ grant_id: GRANT.id }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    },
    ticketService: { createTicket: vi.fn() },
  } as any;
  return { ctx, calls, refused };
}

function authenticatedApp(ownerSub: string): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).oidc = { isAuthenticated: () => true, user: { sub: ownerSub } };
    admission.run(['GET', 'HEAD'].includes(req.method) ? 'read' : 'write', next);
  });
  app.use(express.json());
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('missing listener address'));
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('LoRA owner isolation', () => {
  let server: Server | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('keeps system seed DML out of request-time schema bootstrap', async () => {
    const { ctx } = recordingContext();
    createBotLoraRoutes(ctx as never);
    await vi.waitFor(() => expect(harness.bootstrap).toHaveBeenCalled());
    const options = harness.bootstrap.mock.calls.at(-1)?.[0] as { statements?: unknown[] };
    const statements = (options.statements ?? []).map(String).join('\n');
    expect(statements).not.toContain('system:seed:lora');
    expect(statements).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('lists only the authenticated owner rows, as a pure read under read-only admission', async () => {
    const { ctx, calls, refused } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/characters`);
    expect(response.status).toBe(200);
    expect(refused).toEqual([]);
    expect(calls.filter((call) => !READ_STATEMENT.test(call.text))).toEqual([]);
    const list = calls.find((call) => /FROM oshal_lora_characters c\s+WHERE c\.owner_sub/.test(call.text));
    expect(list?.text).toMatch(/c\.owner_sub = \$1/);
    expect(list?.params).toEqual(['owner-a']);
  });

  it('creates the starter only on an explicit, owner-bound POST /characters/starter that answers the list', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/characters/starter`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).characters).toEqual([{ subject: 'oshbrainrot', display_name: 'Cyclops' }]);
    const starter = calls.find((call) => /INSERT INTO oshal_lora_characters/.test(call.text));
    expect(starter?.params).toEqual(['owner-a']);
    expect(starter?.text).toMatch(/ON CONFLICT \(owner_sub, subject\) DO NOTHING/);
    const list = calls.find((call) => /FROM oshal_lora_characters c\s+WHERE c\.owner_sub/.test(call.text));
    expect(list?.params).toEqual(['owner-a']);
    expect(calls.indexOf(starter!)).toBeLessThan(calls.indexOf(list!));
  });

  it('answers every LoRA GET route without attempting a SQL write', async () => {
    const { ctx, refused } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    for (const path of ['/ui', '/characters', '/models?subject=oshbrainrot', '/scorecard?subject=oshbrainrot&version=1',
      '/cell-image?subject=oshbrainrot&version=1&cell=0', '/dataset?subject=oshbrainrot']) {
      const response = await fetch(`${listening.origin}${path}`);
      expect(response.status, `GET ${path}`).toBeLessThan(500);
    }
    expect(refused).toEqual([]);
  });

  it('refuses, under read admission, the starter INSERT a GET used to make', async () => {
    const { ctx, refused } = recordingContext();
    await expect(admission.run('read', () => ctx.pool.query(
      'INSERT INTO oshal_lora_characters (subject, owner_sub) VALUES ($1, $2) ON CONFLICT (owner_sub, subject) DO NOTHING',
      ['oshbrainrot', 'owner-a'],
    ))).rejects.toThrow(WRITER_REFUSAL);
    expect(refused).toHaveLength(1);
  });

  it('looks up a named character by subject and exact owner before reading child rows', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/models?subject=private-character`);
    expect(response.status).toBe(404);
    const lookup = calls.find((call) => /SELECT id FROM oshal_lora_characters/.test(call.text));
    expect(lookup?.text).toMatch(/owner_sub = \$2/);
    expect(lookup?.params).toEqual(['private-character', 'owner-a']);
  });

  it('rejects a fleet-secret callback that carries no callback grant before DB access', async () => {
    const previous = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = 'lora-test-service-secret';
    try {
      const { ctx, calls } = recordingContext();
      const app = express().use(express.json());
      mountLoraIngest(app, ctx);
      const listening = await listen(app);
      server = listening.server;
      const response = await fetch(`${listening.origin}/api/lora/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-secret': 'lora-test-service-secret',
          'x-oshal-user-sub-b64': Buffer.from('owner-callback', 'utf8').toString('base64url') },
        body: JSON.stringify({ kind: 'score', character: 'private-character', version: 1 }),
      });
      expect(response.status).toBe(401);
      expect(calls).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.SWARM_SERVICE_SECRET;
      else process.env.SWARM_SERVICE_SECRET = previous;
    }
  });

  it('binds a signed callback to its grant owner for both the grant and the character lookup', async () => {
    const { ctx, calls } = recordingContext();
    const app = express().use(express.json());
    mountLoraIngest(app, ctx);
    const listening = await listen(app);
    server = listening.server;
    const response = await send(signedCallback(listening.origin, GRANT, 'owner-callback',
      { kind: 'score', character: 'private-character', version: 1 }));
    expect(response.status).toBe(404);
    const grantLookup = calls.find((call) => /FROM oshal_lora_callback_grants WHERE id = \$1/.test(call.text));
    expect(grantLookup?.params).toEqual([GRANT.id, 'owner-callback']);
    const lookup = calls.find((call) => /SELECT id, subject FROM oshal_lora_characters/.test(call.text));
    expect(lookup?.params).toEqual(['private-character', 'owner-callback']);
  });

  it('carries only the encoded owner in the box callback command', () => {
    const owner = 'Owner|Exact-Case';
    const secret = 'fleet-secret-must-not-enter-task-journal';
    const previous = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = secret;
    try {
      const command = buildTrainCommand(
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject: 'legal-character', identPrompt: `osh'; $(throw 'injected')` }, 2, 1, owner,
      );
      expect(command).toContain(`--owner-sub-b64 '${Buffer.from(owner, 'utf8').toString('base64url')}'`);
      expect(command).not.toContain(owner);
      expect(command).not.toContain('--secret');
      expect(command).not.toContain(secret);
      expect(command).toContain(`--character 'lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'`);
    } finally {
      if (previous === undefined) delete process.env.SWARM_SERVICE_SECRET;
      else process.env.SWARM_SERVICE_SECRET = previous;
    }
  });

  it('refuses a subject that would escape the character\'s own box directory', () => {
    // The subject became a directory name on the box the moment each character got its own
    // dataset, so quoting it is no longer enough - it is a slug or the command is not built.
    for (const subject of [`osh'; $(throw 'injected')`, '../../windows/system32', 'has space', '']) {
      expect(() => buildTrainCommand({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject }, 2, 1, 'owner'),
        `${subject} was accepted as a character subject`).toThrow(/slug/);
      expect(() => boxRootFor({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject })).toThrow(/slug/);
    }
    expect(boxRootFor({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject: 'legal-character' })).toContain('/lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa');
  });

  it('signs box callbacks with the dispatch grant from the environment, never the fleet secret', () => {
    const frameworkRoot = process.env.OSHAL_FRAMEWORK_ROOT
      ? resolve(process.env.OSHAL_FRAMEWORK_ROOT)
      : resolve('..', 'oshal');
    const edge = (name: string) => readFileSync(resolve(frameworkRoot, 'scripts', 'comfyui-edge', name), 'utf8');
    for (const script of ['train-lora.py', 'validate-lora.py', 'overnight-loop.py']) {
      const source = edge(script);
      expect(source).not.toMatch(/add_argument\(["']--(?:secret|grant)["']/);
      expect(source).not.toContain('os.environ.get("SWARM_SERVICE_SECRET"');
      expect(source).not.toContain('"x-service-secret"');
      expect(source).toMatch(/from lora_callback import load_grant/);
    }
    const signer = edge('lora_callback.py');
    expect(signer).toContain('GRANT_ENV = "OSHAL_LORA_CALLBACK_GRANT"');
    expect(signer).not.toMatch(/environ[^\n]*SWARM_SERVICE_SECRET/);
  });

  it('renders callback and database fields through the escaped studio path', () => {
    const studio = readFileSync(fileURLToPath(new URL('../tools/lora.html', import.meta.url)), 'utf8');
    expect(studio).toContain('function esc(v)');
    expect(studio).toContain('function safeImageUrl(v)');
    expect(studio).toContain('referrerpolicy="no-referrer"');
    expect(studio).toContain('${esc(c.display_name)}');
    expect(studio).toContain('${esc(String(c.cell||\'\').replace(/\\|/g,\' · \'))}');
    expect(studio).not.toContain('e.innerHTML=msg');
    expect(studio).not.toMatch(/onclick="(?:select|gallery|keepBest)\(/);
  });
});
