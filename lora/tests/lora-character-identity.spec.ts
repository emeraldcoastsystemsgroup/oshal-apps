/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Guard LoRA per-character generalization on the store side. The dispatch passed --character and nothing else, and every character on a box shared one dataset folder, so the box scripts supplied the rest from constants and a second character trained on the first one's images. These cases assert on the command that is actually enqueued for the box - through the real routes, from a real character row - plus the create route that makes a new character a row rather than a source edit, including its refusal to reuse another character's hero or identity sentence.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | Update recording-row assertions for immutable storage keys and existing model lookup. These are HTTP/command contract tests with a database double, not persisted-row acceptance.
 * 3   | maintainer@emeraldcoastsystemsgroup.com   | Supply a recording transaction client for creation; real concurrency and rollback are covered by the console PostgreSQL suite.
 * 4   | maintainer@emeraldcoastsystemsgroup.com   | Every dispatch now mints a callback grant, so the database double answers the grant insert, and the schedule double answers the newest-ticket lookup the dedupe now uses. The real-boundary schedule, dedupe and review proof is lora-overnight-schedule.spec.ts.
 * 5   | maintainer@emeraldcoastsystemsgroup.com   | Dispatches now take the owner's verified issuer from the package authorization port (the kernel's actor in production), and a scheduled character carries the issuer recorded when autonomous mode was enabled; the doubles supply both.
 */

import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  bootstrap: vi.fn(async () => undefined),
  enqueued: [] as Array<{ command: string }>,
}));

vi.mock('@/shared/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/shared/services/database', () => ({
  runRuntimeSchemaBootstrap: harness.bootstrap,
}));
vi.mock('@/app/routes/remote-client-routes', () => ({
  remoteClientRegistry: {
    listClients: vi.fn(() => ([{
      clientId: 'edge-1', agentId: 'agent-1', status: 'online', healthy: true,
      capabilities: ['shell.exec'], tags: ['worker'], tailnetHostname: 'gpu-box',
    }])),
    enqueueTask: vi.fn(async (_clientId: string, envelope: { input: { arguments: { command: string } } }) => {
      harness.enqueued.push({ command: envelope.input.arguments.command });
      return { taskId: 'task-1' };
    }),
  },
}));

import { runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { createBotLoraRoutes, runLoraOvernightSchedule } from '../src-routes/bot-lora-routes';
import { fixtureAuthorization } from './helpers/lora-callback-rail';
import {
  buildTrainCommand, buildValidateCommand, buildImproveCommand, buildOvernightCommand,
  characterConfigFromRow, boxRootFor,
} from '../src-routes/lora-train-dispatch';

const ISSUER = 'https://issuer.oshal.example.com';

/** A character that is nothing like the one the box scripts used to hard-code. */
const ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  subject: 'tin-drummer',
  trigger_word: 'tindrummer',
  hero_image: 'hero_tin_drummer.png',
  ident_prompt: 'a bright tin wind-up drummer toy with two round glass eyes and a red drum',
  negative_prompt: 'blurry, lowres, rusted, missing drum',
  identity_structure: 'a wind-up toy with a drum strapped to its chest',
  identity_violation: 'a toy with no drum at all',
  base_model: 'tin-checkpoint.safetensors',
  autonomous: true,
  autonomous_issuer: ISSUER,
  max_hours: 2,
  plateau_epsilon: 0.004,
  owner_sub: 'owner-a',
};

/** Every identity value that must reach the box, flag by flag. */
const EXPECTED_FLAGS: Array<[string, string]> = [
  ['--character', 'lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'],
  ['--trigger', ROW.trigger_word],
  ['--hero', ROW.hero_image],
  ['--ident', ROW.ident_prompt],
  ['--negative', ROW.negative_prompt],
  ['--identity-structure', ROW.identity_structure],
  ['--identity-violation', ROW.identity_violation],
  ['--base-model', ROW.base_model],
];

interface QueryCall { text: string; params: unknown[] }

/**
 * @description A pool double that answers the queries the dispatch routes make, so the routes run
 *   end to end and the enqueued box command can be inspected.
 * @param overrides - Extra row answers keyed by a pattern the query text must match.
 * @returns The context and the recorded query calls.
 */
function recordingContext(overrides: Array<[RegExp, { rows: unknown[]; rowCount: number }]> = []) {
  const calls: QueryCall[] = [];
  const ctx = {
    authorization: fixtureAuthorization(),
    pool: {
      query: vi.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        for (const [pattern, answer] of overrides) if (pattern.test(text)) return answer;
        if (/SELECT id, subject, trigger_word/.test(text)) return { rows: [ROW], rowCount: 1 };
        if (/COALESCE\(max\(version\), 0\) \+ 1/.test(text)) return { rows: [{ v: 2 }], rowCount: 1 };
        if (/FROM oshal_lora_scores s WHERE s\.character_id/.test(text)) {
          return { rows: [{ version: 1, weak_cells: [{ value: 'side profile view' }] }], rowCount: 1 };
        }
        if (/max\(version\) AS v FROM oshal_lora_models/.test(text)) return { rows: [{ v: 1 }], rowCount: 1 };
        if (/SELECT lora_path FROM oshal_lora_models/.test(text)) return { rows: [{ lora_path: 'tin-drummer_v1.safetensors' }], rowCount: 1 };
        if (/INSERT INTO oshal_lora_callback_grants/.test(text)) return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    },
    ticketService: {
      createTicket: vi.fn(async () => ({ ticketId: 'ticket-1' })),
      findLatestTicketByMetadataKey: vi.fn(async () => null),
      getTicket: vi.fn(async () => null),
      updateStatus: vi.fn(async () => undefined),
    },
  } as any;
  ctx.pool.connect = vi.fn(async () => ({ query: ctx.pool.query, release: vi.fn() }));
  return { ctx, calls };
}

/** An express app whose requests are already authenticated as one owner. */
function authenticatedApp(ownerSub: string): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).oidc = { isAuthenticated: () => true, user: { sub: ownerSub } };
    runWithRequestIdentity({ sub: ownerSub, principalIssuer: ISSUER, isOperator: false }, next);
  });
  app.use(express.json());
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('missing listener address'));
      resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('a LoRA box command carries the whole character, not just its name', () => {
  const config = characterConfigFromRow(ROW);

  it('puts every identity value the box scripts need on the command line', () => {
    const commands = [
      buildValidateCommand(config, 2, 'owner-a'),
      buildImproveCommand(config, 2, 1, ['side profile view'], 'owner-a'),
      buildOvernightCommand(config, 1, 2, 0.004, 'owner-a'),
    ];
    for (const command of commands) {
      for (const [flag, value] of EXPECTED_FLAGS) {
        expect(command, `the box command omits ${flag}, so the script falls back to a constant`)
          .toContain(`${flag} '${value}'`);
      }
    }
  });

  it('gives each character its own dataset instead of one shared folder per box', () => {
    const other = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', subject: 'other-character' };
    const mine = boxRootFor(config);
    const theirs = boxRootFor(other);
    expect(mine).not.toBe(theirs);
    expect(buildTrainCommand(config, 2, 1, 'owner-a')).toContain(`--dataset "${mine}/curated"`);
    expect(buildTrainCommand(other, 2, 1, 'owner-a'))
      .toContain(`--dataset "${theirs}/curated"`);
    expect(buildOvernightCommand(config, 1, 2, 0.004, 'owner-a')).toContain(`--dataset "${mine}/curated"`);
  });

  it('keeps the public trigger fallback while omitting undeclared identity values', () => {
    const bare = buildValidateCommand({ id: ROW.id, subject: 'bare-character' }, 1, 'owner-a');
    expect(bare).toContain("--character 'lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'");
    expect(bare).toContain("--trigger 'bare-character'");
    for (const flag of ['--hero', '--ident', '--negative',
      '--identity-structure', '--identity-violation', '--base-model']) {
      expect(bare, `${flag} was invented for a character that declares none`).not.toContain(flag);
    }
  });
});

describe('the dispatch routes build the box command from the character row', () => {
  let server: Server | undefined;

  beforeEach(() => {
    harness.enqueued.length = 0;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
  });

  /**
   * @description POST one dispatch route and return the command it enqueued for the box.
   * @param route - The route path.
   * @returns The enqueued box command.
   */
  async function dispatched(route: string): Promise<string> {
    const { ctx } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: ROW.subject }),
    });
    expect(response.status, `${route} did not dispatch: ${await response.text()}`).toBe(200);
    expect(harness.enqueued, `${route} enqueued nothing`).toHaveLength(1);
    return harness.enqueued[0].command;
  }

  for (const route of ['/validate', '/improve', '/improve-overnight']) {
    it(`carries the row's own identity through ${route}`, async () => {
      const command = await dispatched(route);
      for (const [flag, value] of EXPECTED_FLAGS) {
        expect(command, `${route} dispatched without ${flag}`).toContain(`${flag} '${value}'`);
      }
      expect(command).toContain(`${boxRootFor(characterConfigFromRow(ROW))}`);
    });
  }

  it('selects the identity columns when it looks a character up', async () => {
    const { ctx, calls } = recordingContext();
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    await fetch(`${listening.origin}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: ROW.subject }),
    });
    const lookup = calls.find((call) => /FROM oshal_lora_characters WHERE subject/.test(call.text));
    expect(lookup?.text).toContain('negative_prompt');
    expect(lookup?.text).toContain('identity_structure');
    expect(lookup?.text).toContain('identity_violation');
    expect(lookup?.params).toEqual([ROW.subject, 'owner-a']);
  });
});

describe('the autonomous overnight schedule handler', () => {
  it('starts only an opted-in owner row and carries its review ticket into the worker command', async () => {
    const { ctx } = recordingContext();
    const result = await runLoraOvernightSchedule(ctx, {
      scheduleId: 'lora-lora-autonomous-overnight',
      scheduledAtIso: '2026-09-25T02:00:00.000Z',
      body: {},
    });
    expect(result.summary).toContain('1 started');
    expect(harness.enqueued.at(-1)?.command).toContain("--review-ticket-id 'ticket-1'");
    expect(harness.enqueued.at(-1)?.command).toMatch(/^\$env:OSHAL_LORA_CALLBACK_GRANT='cccccccc-cccc-4ccc-8ccc-cccccccccccc\.[A-Za-z0-9_-]{43}'; /);
    expect((ctx.ticketService.createTicket as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({
      ownerSub: 'owner-a',
      metadata: { loraOvernightCharacterId: ROW.id, source: 'nightly-schedule' },
    });
  });
});

describe('creating a character', () => {
  let server: Server | undefined;

  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(async () => {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
  });

  /**
   * @description POST /characters with a body, against a pool that may already hold a clash.
   * @param body - The request body.
   * @param clash - A row the reuse check should find, or null.
   * @returns status and parsed body.
   */
  async function create(body: Record<string, unknown>, clash: unknown = null) {
    const { ctx, calls } = recordingContext([
      [/hero_image = \$2 OR ident_prompt = \$3/, { rows: clash ? [clash] : [], rowCount: clash ? 1 : 0 }],
      [/INSERT INTO oshal_lora_characters\s+\(subject/, { rows: [{ subject: body.subject }], rowCount: 1 }],
    ]);
    const listening = await listen(authenticatedApp('owner-a').use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/characters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown>, calls };
  }

  const NEW_CHARACTER = {
    subject: 'tin-drummer',
    displayName: 'Tin Drummer',
    triggerWord: 'tindrummer',
    heroImage: 'hero_tin_drummer.png',
    identPrompt: 'a bright tin wind-up drummer toy with a red drum',
    negativePrompt: 'blurry, rusted, missing drum',
    identityStructure: 'a wind-up toy with a drum strapped to its chest',
    identityViolation: 'a toy with no drum at all',
  };

  it('stores every identity value the box will need, scoped to the caller', async () => {
    const { status, calls } = await create(NEW_CHARACTER);
    expect(status).toBe(201);
    const insert = calls.find((call) => /INSERT INTO oshal_lora_characters\s+\(subject/.test(call.text));
    expect(insert?.params).toEqual([
      NEW_CHARACTER.subject, NEW_CHARACTER.displayName, NEW_CHARACTER.triggerWord,
      NEW_CHARACTER.heroImage, 'v1-5-pruned-emaonly-fp16.safetensors', NEW_CHARACTER.identPrompt,
      NEW_CHARACTER.negativePrompt, NEW_CHARACTER.identityStructure, NEW_CHARACTER.identityViolation,
      'owner-a',
    ]);
  });

  it('refuses a new character that reuses another character\'s identity artifacts', async () => {
    const { status, body } = await create(NEW_CHARACTER, { subject: 'oshbrainrot' });
    expect(status).toBe(409);
    expect(body.error).toBe('identity_artifact_reused');
    expect(body.conflictsWith).toBe('oshbrainrot');
  });

  it('refuses a subject that is not a slug, a missing identity, and half a structural pair', async () => {
    const bad = await create({ ...NEW_CHARACTER, subject: '../../windows' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_subject');

    const noHero = await create({ ...NEW_CHARACTER, heroImage: '' });
    expect(noHero.status).toBe(400);
    expect(noHero.body.error).toBe('hero_required');

    const noIdent = await create({ ...NEW_CHARACTER, identPrompt: '   ' });
    expect(noIdent.status).toBe(400);
    expect(noIdent.body.error).toBe('ident_required');

    const halfPair = await create({ ...NEW_CHARACTER, identityViolation: '' });
    expect(halfPair.status).toBe(400);
    expect(halfPair.body.error).toBe('structural_pair_incomplete');
  });

  it('refuses an anonymous caller', async () => {
    const { ctx } = recordingContext();
    const app = express();
    app.use(express.json());
    const listening = await listen(app.use(createBotLoraRoutes(ctx)));
    server = listening.server;
    const response = await fetch(`${listening.origin}/characters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(NEW_CHARACTER),
    });
    expect(response.status).toBe(401);
  });
});
