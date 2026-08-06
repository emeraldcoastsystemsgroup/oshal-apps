/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Guard route-level LoRA owner predicates, per-owner starter creation, service callback attribution, and encoded owner carriage to the GPU scripts.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | Guard lazy schema bootstrap against cross-owner system-seed writes after FORCE RLS is active.
 * 3   | maintainer@emeraldcoastsystemsgroup.com   | Prove durable GPU commands omit the fleet secret and PowerShell-quote data-derived arguments.
 * 4   | maintainer@emeraldcoastsystemsgroup.com   | Guard the studio renderer against stored script injection from character, model, score, image, and error fields.
 */

import express from 'express';
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

import { createBotLoraRoutes, createLoraIngestRoutes } from '../src-routes/bot-lora-routes';
import { buildTrainCommand } from '../src-routes/lora-train-dispatch';

interface QueryCall {
  text: string;
  params: unknown[];
}

function recordingContext() {
  const calls: QueryCall[] = [];
  const ctx = {
    pool: {
      query: vi.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        if (/FROM oshal_lora_characters c\s+WHERE c\.owner_sub/.test(text)) {
          return { rows: [{ subject: 'oshbrainrot', display_name: 'Cyclops' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    },
    ticketService: { createTicket: vi.fn() },
  } as any;
  return { ctx, calls };
}

function authenticatedApp(ownerSub: string): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).oidc = { isAuthenticated: () => true, user: { sub: ownerSub } };
    next();
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

  it('creates and lists only the authenticated owner starter row', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/characters`);
    expect(response.status).toBe(200);
    const starter = calls.find((call) => /INSERT INTO oshal_lora_characters/.test(call.text));
    expect(starter?.params).toEqual(['owner-a']);
    const list = calls.find((call) => /FROM oshal_lora_characters c\s+WHERE c\.owner_sub/.test(call.text));
    expect(list?.text).toMatch(/c\.owner_sub = \$1/);
    expect(list?.params).toEqual(['owner-a']);
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

  it('rejects a fleet-secret callback without separate owner attribution before DB access', async () => {
    const previous = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = 'lora-test-service-secret';
    try {
      const { ctx, calls } = recordingContext();
      const listening = await listen(express().use(express.json()).use(createLoraIngestRoutes(ctx)));
      server = listening.server;
      const response = await fetch(listening.origin, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-secret': 'lora-test-service-secret' },
        body: JSON.stringify({ kind: 'score', character: 'private-character', version: 1 }),
      });
      expect(response.status).toBe(403);
      expect(calls).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.SWARM_SERVICE_SECRET;
      else process.env.SWARM_SERVICE_SECRET = previous;
    }
  });

  it('binds an attributed callback lookup to the encoded owner', async () => {
    const previous = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = 'lora-test-service-secret';
    try {
      const { ctx, calls } = recordingContext();
      const listening = await listen(express().use(express.json()).use(createLoraIngestRoutes(ctx)));
      server = listening.server;
      const response = await fetch(listening.origin, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-secret': 'lora-test-service-secret',
          'x-oshal-user-sub-b64': Buffer.from('owner-callback', 'utf8').toString('base64url'),
        },
        body: JSON.stringify({ kind: 'score', character: 'private-character', version: 1 }),
      });
      expect(response.status).toBe(404);
      const lookup = calls.find((call) => /SELECT id FROM oshal_lora_characters/.test(call.text));
      expect(lookup?.params).toEqual(['private-character', 'owner-callback']);
    } finally {
      if (previous === undefined) delete process.env.SWARM_SERVICE_SECRET;
      else process.env.SWARM_SERVICE_SECRET = previous;
    }
  });

  it('carries only the encoded owner in the box callback command', () => {
    const owner = 'Owner|Exact-Case';
    const secret = 'fleet-secret-must-not-enter-task-journal';
    const previous = process.env.SWARM_SERVICE_SECRET;
    process.env.SWARM_SERVICE_SECRET = secret;
    try {
      const command = buildTrainCommand(`osh'; $(throw 'injected')`, 2, 1, owner);
      expect(command).toContain(`--owner-sub-b64 '${Buffer.from(owner, 'utf8').toString('base64url')}'`);
      expect(command).not.toContain(owner);
      expect(command).not.toContain('--secret');
      expect(command).not.toContain(secret);
      expect(command).toContain(`--character 'osh''; $(throw ''injected'')'`);
    } finally {
      if (previous === undefined) delete process.env.SWARM_SERVICE_SECRET;
      else process.env.SWARM_SERVICE_SECRET = previous;
    }
  });

  it('accepts the fleet secret only from the edge process environment', () => {
    const frameworkRoot = process.env.OSHAL_FRAMEWORK_ROOT
      ? resolve(process.env.OSHAL_FRAMEWORK_ROOT)
      : resolve('..', 'oshal');
    for (const script of ['train-lora.py', 'validate-lora.py', 'overnight-loop.py']) {
      const source = readFileSync(resolve(frameworkRoot, 'scripts', 'comfyui-edge', script), 'utf8');
      expect(source).not.toMatch(/add_argument\(["']--secret["']/);
      expect(source).not.toMatch(/[[,]\s*["']--secret["']/);
      expect(source).toContain('os.environ.get("SWARM_SERVICE_SECRET", "")');
    }
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
