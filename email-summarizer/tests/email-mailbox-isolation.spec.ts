/**
 * Cross-user denial for the Intelligent Communication mailbox routes, across the real boundary.
 *
 * THE BOUNDARY: which stored connection a request is allowed to spend. Nothing on it is doubled:
 * a private PostgreSQL started for this file with core's own migrations (060 tenancy + 100
 * connector base schema with FORCE row-level security + 101 multi-account), a NOSUPERUSER
 * NOBYPASSRLS runtime role behind the production GUC pool wrapper, connections written by the
 * production upsert and sealed by the production per-user DEK envelope crypto, the REAL kernel
 * token broker (getValidAccessToken), and the REAL packaged createEmailRoutes over loopback HTTP.
 *
 * Doubled OUTSIDE that boundary, and recorded: the Gmail / Google Calendar / Microsoft Graph hosts
 * (a fetch stub keyed by bearer token — each fixture mailbox answers only its own token), and the
 * communications-bot dispatch (executeBotOrInline records the prompt instead of reaching a bot
 * node) plus its BYO-LLM lookup. What is asserted is which token went out and which rows reached
 * the prompt, not Google's or Microsoft's APIs. A live mailbox is an operator acceptance step.
 *
 * SELF-VALIDATED: the runtime role sees only the stamped owner's connection rows and a forged row
 * in another user's name is refused (SQLSTATE 42501), so the fixture enforces RLS rather than
 * agreeing with itself. Docker is REQUIRED — a missing engine fails, never skips.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: owner A (Google + Outlook) and owner B (Google only) against the real broker and forced-RLS store — B's Outlook list/read/summary are 409 and A's tokens never leave; B's Gmail read of A's message id goes out with B's own token only; each summary prompt carries only its owner's rows; bad provider 400, anonymous 401, send without confirm 428 before any connection is touched.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Yahoo: owner A also holds a sealed yahoo app-password grant; the routes read it through core's REAL fixed IMAP reader (real broker, real imapflow) against a loopback IMAP responder (core tests/helpers/loopback-imap.ts). A's list and summary use a read-only session; B's Yahoo list/digest/summary are 409 and open no IMAP session; message/draft/send are 400 without contacting Yahoo; a caller with no mailbox at all still gets no_mail_connection through the Yahoo fallback.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The Yahoo fallback is limited to list, digest and summary: a caller with no mailbox gets 409 no_mail_connection (not a Yahoo 400) from /message/:id, /draft and /send when no provider is named, and no IMAP session opens.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { wrapPoolWithGuc } from '@/shared/services/database/guc-pool';
import { runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { upsertConnection } from '@/app/routes/connector-tenancy';
import { encryptToken } from '@/app/routes/connector-token-crypto';
import { createImapMailReader } from '@/app/routes/imap-mail-reader';
import { LoopbackImap } from '@test-fixtures/loopback-imap';

vi.setConfig({ testTimeout: 30000, hookTimeout: 180000 });

const recorded = vi.hoisted(() => ({
  prompts: [] as Array<{ agentId: string; sub: string; text: string }>,
  provider: [] as Array<{ host: string; path: string; authorization: string }>,
}));

vi.mock('@/app/routes/inline-bot-execution', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeBotOrInline: async (_ctx: unknown, _client: unknown, agentId: string, request: { userSub: string; text: string }) => {
    recorded.prompts.push({ agentId, sub: request.userSub, text: request.text });
    return { response: `bot summary for ${request.userSub}` };
  },
}));
vi.mock('@/app/routes/free-tier-rotation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserLlmConnection: async () => undefined,
}));

import { createEmailRoutes, ensureEmailSchema } from '../src-routes/email-app-routes';

const RUNTIME_ROLE = 'email_mailbox_runtime';
const OWNER_A = 'mailbox-owner-a';
const OWNER_B = 'mailbox-owner-b';
const STRANGER = 'mailbox-stranger';
const COMMS_BOT = 'b0000000-0000-0000-0000-000000000001';
/** Per-user provider tokens, minted per run so no literal credential is ever written down. */
const TOKENS = {
  aGoogle: `a-google-${randomUUID()}`,
  aOutlook: `a-outlook-${randomUUID()}`,
  bGoogle: `b-google-${randomUUID()}`,
};
const YAHOO_ADDRESS = 'owner.a@yahoo.example.com';
const YAHOO_PASSWORD = randomUUID().replace(/-/g, '').slice(0, 16);
const A_TOKENS = [TOKENS.aGoogle, TOKENS.aOutlook, YAHOO_PASSWORD];
const A_SUBJECTS = ['A private gmail subject', 'A private outlook subject', 'A private yahoo subject'];
const imap = new LoopbackImap({ [YAHOO_ADDRESS]: { password: YAHOO_PASSWORD, inbox: [{
  uid: 4242, flags: [], receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
  subject: A_SUBJECTS[2], fromName: 'Yankee', fromAddress: 'yankee@mail.example.com',
}] } });

const fixture = new DisposablePostgres({
  purpose: 'email-mailbox-isolation',
  migrations: ['060-platform-rls-tenancy.sql', '100-connector-base-schema.sql', '101-connections-multi-account.sql'],
  roles: [RUNTIME_ROLE],
});
const realFetch = globalThis.fetch;
let runtimePool: ReturnType<typeof wrapPoolWithGuc>;
let server: Server;
let base = '';

/** Each fixture mailbox, keyed by the ONLY token that opens it. */
const GMAIL_BOXES: Record<string, Array<{ id: string; subject: string; from: string }>> = {
  [TOKENS.aGoogle]: [{ id: 'gmail-a-1', subject: A_SUBJECTS[0], from: 'Alpha <alpha@oshal.example.com>' }],
  [TOKENS.bGoogle]: [{ id: 'gmail-b-1', subject: 'B own gmail subject', from: 'Bravo <bravo@oshal.example.com>' }],
};
const GRAPH_BOXES: Record<string, Array<{ id: string; subject: string }>> = {
  [TOKENS.aOutlook]: [{ id: 'outlook-a-1', subject: A_SUBJECTS[1] }],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A Gmail message resource as the API returns it. */
function gmailMessage(m: { id: string; subject: string; from: string }) {
  return {
    id: m.id, labelIds: ['UNREAD', 'INBOX'], internalDate: String(Date.now() - 60_000), snippet: `snippet of ${m.subject}`,
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }, { name: 'To', value: 'me@oshal.example.com' }],
      body: { data: Buffer.from(`body of ${m.subject}`).toString('base64url') } },
  };
}

/** Gmail + Google Calendar: answers only the token that owns the mailbox. */
function gmailHost(url: URL, token: string): Response {
  const box = GMAIL_BOXES[token];
  if (!box) return json(401, { error: 'invalid token' });
  if (url.hostname === 'www.googleapis.com') return json(200, { items: [] });
  const detail = /\/messages\/([^/?]+)$/.exec(url.pathname);
  if (detail) {
    const found = box.find((m) => m.id === decodeURIComponent(detail[1]));
    return found ? json(200, gmailMessage(found)) : json(404, { error: 'not found' });
  }
  if (url.pathname.endsWith('/profile')) return json(200, { emailAddress: 'bravo@oshal.example.com' });
  return json(200, { messages: box.map((m) => ({ id: m.id })) });
}

/** Microsoft Graph: answers only the token that owns the mailbox. */
function graphHost(url: URL, token: string): Response {
  const box = GRAPH_BOXES[token];
  if (!box) return json(401, { error: { code: 'InvalidAuthenticationToken' } });
  const asGraph = (m: { id: string; subject: string }) => ({
    id: m.id, subject: m.subject, from: { emailAddress: { name: 'Alpha', address: 'alpha@oshal.example.com' } },
    receivedDateTime: new Date(Date.now() - 60_000).toISOString(), bodyPreview: `preview of ${m.subject}`, isRead: false,
    importance: 'high', flag: { flagStatus: 'notFlagged' }, body: { contentType: 'text', content: `body of ${m.subject}` },
  });
  if (url.pathname === '/v1.0/me/calendarView') return json(200, { value: [] });
  if (url.pathname === '/v1.0/me') return json(200, { mail: 'alpha@oshal.example.com' });
  if (url.pathname === '/v1.0/me/sendMail') return new Response(null, { status: 202 });
  const detail = /^\/v1\.0\/me\/messages\/([^/?]+)$/.exec(url.pathname);
  if (detail) {
    const found = box.find((m) => m.id === decodeURIComponent(detail[1]));
    return found ? json(200, asGraph(found)) : json(404, { error: { code: 'ErrorItemNotFound' } });
  }
  return json(200, { value: box.map(asGraph) });
}

/** Provider hosts are answered here and recorded; loopback calls go to the real fetch. */
async function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const hosts = ['gmail.googleapis.com', 'www.googleapis.com', 'graph.microsoft.com'];
  if (!hosts.includes(url.hostname)) return realFetch(input, init);
  const authorization = String(new Headers(init?.headers).get('authorization') || '');
  recorded.provider.push({ host: url.hostname, path: url.pathname, authorization });
  const token = authorization.replace(/^Bearer /, '');
  return url.hostname === 'graph.microsoft.com' ? graphHost(url, token) : gmailHost(url, token);
}

/** Seed one connection through the production upsert and per-user envelope crypto, as its owner. */
async function seed(sub: string, provider: 'google' | 'outlook' | 'yahoo', token: string): Promise<void> {
  await runWithRequestIdentity({ sub, isOperator: false }, async () => {
    await upsertConnection(runtimePool, {
      userSub: sub, userEmail: `${sub}@oshal.example.com`, provider, accountEmail: `${sub}@oshal.example.com`,
      accountId: `${sub}-${provider}`, scopes: { google: 'gmail.readonly', outlook: 'Mail.Read Mail.Send Calendars.Read', yahoo: '' }[provider],
      encAccess: await encryptToken(runtimePool, sub, token), encRefresh: null,
      expiry: new Date(Date.now() + 3_600_000), connectedBySub: sub,
    });
  });
}

function makeApp(imapPort: number): express.Express {
  // The REAL core reader and broker; only its endpoint is the loopback responder (plain TCP).
  const imapMail = createImapMailReader(runtimePool, { endpoint: { host: '127.0.0.1', port: imapPort, secure: false } });
  const app = express();
  app.use(express.json());
  app.use('/api/email', (req, _res, next) => {
    const sub = req.header('x-fixture-sub');
    if (sub) Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub: sub ?? null, isOperator: false } as never, () => next());
  }, createEmailRoutes({ pool: runtimePool, imapMail } as never));
  return app;
}

function call(path: string, sub?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sub) headers['x-fixture-sub'] = sub;
  return realFetch(`${base}/api/email${path}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
}

/** No request, to any provider host, ever carried one of owner A's tokens. */
function expectNoATokenSent(): void {
  for (const call of recorded.provider) for (const token of A_TOKENS) expect(call.authorization).not.toContain(token);
}

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', randomUUID());
  vi.stubEnv('OSHAL_DB_GUC', 'on');
  vi.stubEnv('OSHAL_DB_GUC_STRICT', 'deny');
  const owner = await fixture.start();
  await ensureEmailSchema(owner as never);
  await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE}`);
  runtimePool = wrapPoolWithGuc(fixture.rolePool(RUNTIME_ROLE));
  await seed(OWNER_A, 'google', TOKENS.aGoogle);
  await seed(OWNER_A, 'outlook', TOKENS.aOutlook);
  await seed(OWNER_B, 'google', TOKENS.bGoogle);
  await seed(OWNER_A, 'yahoo', `${YAHOO_ADDRESS}:${YAHOO_PASSWORD}`);
  const imapPort = await imap.start();
  vi.stubGlobal('fetch', providerFetch);
  server = makeApp(imapPort).listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', () => done()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

beforeEach(() => {
  recorded.prompts.length = 0;
  recorded.provider.length = 0;
  imap.commands.length = 0;
  imap.connections = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await imap.stop();
  await fixture.stop();
  vi.unstubAllEnvs();
});

describe('the fixture enforces the store the broker reads', () => {
  it('shows the runtime role only the stamped owner rows and refuses a forged row', async () => {
    const visible = await runWithRequestIdentity({ sub: OWNER_B, isOperator: false }, () =>
      runtimePool.query('SELECT user_sub, provider FROM oshal_connections ORDER BY provider'));
    expect(visible.rows).toEqual([{ user_sub: OWNER_B, provider: 'google' }]);
    const ownerA = await runWithRequestIdentity({ sub: OWNER_A, isOperator: false }, () =>
      runtimePool.query('SELECT provider FROM oshal_connections ORDER BY provider'));
    expect(ownerA.rows.map((r: { provider: string }) => r.provider)).toEqual(['google', 'outlook', 'yahoo']);
    await expect(runWithRequestIdentity({ sub: OWNER_B, isOperator: false }, () => runtimePool.query(
      `INSERT INTO oshal_connections (user_sub, provider, account_key, access_token) VALUES ($1, 'outlook', 'forged', 'x')`, [OWNER_A],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('request refusals happen before any connection is spent', () => {
  it('answers 401 without a session and 400 for a provider outside the closed list', async () => {
    expect((await call('/messages?provider=outlook')).status).toBe(401);
    const bad = await call('/messages?provider=aol', OWNER_A);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'unsupported_provider', supported: ['google', 'outlook', 'yahoo'] });
    expect(recorded.provider).toEqual([]);
  });

  it('answers 428 for a send without explicit confirmation', async () => {
    const res = await call('/send?provider=outlook', OWNER_A, { subject: 'copy', body: 'text' });
    expect(res.status).toBe(428);
    expect(recorded.provider).toEqual([]);
  });

  it('answers a caller with no mailbox at all with 409 no_mail_connection', async () => {
    const res = await call('/messages', STRANGER);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'no_mail_connection', provider: null });
    expect(recorded.provider).toEqual([]);
    expect(imap.connections).toBe(0);
  });

  it('keeps message, draft and send at 409 no_mail_connection for a caller with no mailbox (no Yahoo fallback)', async () => {
    const refusals = {
      '/message/x': await call('/message/x', STRANGER),
      '/draft': await call('/draft', STRANGER, { messageId: 'x' }),
      '/send': await call('/send', STRANGER, { subject: 'copy', body: 'text', confirm: true }),
    };
    for (const [path, res] of Object.entries(refusals)) {
      expect(res.status, path).toBe(409);
      expect(await res.json(), path).toMatchObject({ error: 'no_mail_connection', provider: null });
    }
    expect(imap.connections).toBe(0);
    expect(recorded.provider).toEqual([]);
    expect(recorded.prompts).toEqual([]);
  });
});

describe('each owner reads only their own mailbox', () => {
  it("lists A's Outlook mail with A's Outlook token and nothing else", async () => {
    const res = await call('/messages?provider=outlook', OWNER_A);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe('outlook');
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['outlook-a-1']);
    expect(body.messages[0]).toMatchObject({ unread: true, important: true, subject: A_SUBJECTS[1] });
    expect(new Set(recorded.provider.map((c) => c.authorization))).toEqual(new Set([`Bearer ${TOKENS.aOutlook}`]));
  });

  it('refuses B an Outlook list, read or summary with 409 and never sends a token of A', async () => {
    for (const [path, body] of [['/messages?provider=outlook'], ['/message/outlook-a-1?provider=outlook'], ['/summary?provider=outlook', {}]] as const) {
      const res = await call(path, OWNER_B, body);
      expect(res.status, path).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'no_outlook_connection', provider: 'outlook' });
    }
    const surface = await call('/digest?provider=outlook&surface=1', OWNER_B);
    expect(await surface.json()).toMatchObject({ connected: false, error: 'no_outlook_connection' });
    expect(recorded.provider).toEqual([]);
    expect(recorded.prompts).toEqual([]);
  });

  it("reads A's Gmail message id for B only with B's own token, so A's message is not found", async () => {
    const res = await call('/message/gmail-a-1?provider=google', OWNER_B);
    expect(res.status).toBe(502);
    const text = await res.text();
    for (const subject of A_SUBJECTS) expect(text).not.toContain(subject);
    expect(recorded.provider.map((c) => c.authorization)).toEqual([`Bearer ${TOKENS.bGoogle}`]);
    expectNoATokenSent();
  });

  it("defaults B to B's own Google mailbox when no provider is named", async () => {
    const res = await call('/messages', OWNER_B);
    const body = await res.json();
    expect(body.provider).toBe('google');
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['gmail-b-1']);
    expectNoATokenSent();
  });
});

describe('the bot summary carries only its owner rows and is recorded against the comms bot', () => {
  it("summarizes A's Outlook day for A and B's Gmail day for B without crossing rows", async () => {
    const a = await call('/summary?provider=outlook', OWNER_A, {});
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ provider: 'outlook', summary: `bot summary for ${OWNER_A}` });
    expect(new Set(recorded.provider.splice(0).map((c) => c.authorization))).toEqual(new Set([`Bearer ${TOKENS.aOutlook}`]));
    const b = await call('/summary?provider=google', OWNER_B, {});
    expect(b.status).toBe(200);
    expect(new Set(recorded.provider.map((c) => c.authorization))).toEqual(new Set([`Bearer ${TOKENS.bGoogle}`]));
    expect(recorded.prompts.map((p) => [p.agentId, p.sub])).toEqual([[COMMS_BOT, OWNER_A], [COMMS_BOT, OWNER_B]]);
    expect(recorded.prompts[0].text).toContain(A_SUBJECTS[1]);
    expect(recorded.prompts[1].text).toContain('B own gmail subject');
    for (const subject of A_SUBJECTS) expect(recorded.prompts[1].text).not.toContain(subject);
    expectNoATokenSent();
    const cachedB = await (await call('/summary/cached', OWNER_B)).json();
    expect(cachedB.cached.summary).toBe(`bot summary for ${OWNER_B}`);
  });

  it("drafts a reply to A's own Outlook message on the comms bot", async () => {
    const res = await call('/draft?provider=outlook', OWNER_A, { messageId: 'outlook-a-1' });
    expect(res.status).toBe(200);
    expect(recorded.prompts).toHaveLength(1);
    expect(recorded.prompts[0]).toMatchObject({ agentId: COMMS_BOT, sub: OWNER_A });
    expect(recorded.prompts[0].text).toContain(`body of ${A_SUBJECTS[1]}`);
  });

  it("sends A's confirmed copy through Graph with A's own token to A's own address", async () => {
    const res = await call('/send?provider=outlook', OWNER_A, { subject: 'copy', body: 'text', confirm: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: 'outlook', to: 'alpha@oshal.example.com' });
    expect(recorded.provider.map((c) => [c.path, c.authorization])).toEqual([
      ['/v1.0/me', `Bearer ${TOKENS.aOutlook}`],
      ['/v1.0/me/sendMail', `Bearer ${TOKENS.aOutlook}`],
    ]);
  });
});

describe("Yahoo Mail through core's fixed read-only IMAP reader", () => {
  it("lists A's Yahoo inbox through the real broker with a read-only IMAP session", async () => {
    const res = await call('/messages?provider=yahoo', OWNER_A);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe('yahoo');
    expect(body.messages).toEqual([expect.objectContaining({ id: '4242', subject: A_SUBJECTS[2], unread: true, from: 'Yankee <yankee@mail.example.com>' })]);
    expect(imap.commands).toContain('EXAMINE INBOX');
    expect(imap.commands.some((c) => /^(SELECT|STORE|EXPUNGE|APPEND)\b/.test(c))).toBe(false);
    expect(recorded.provider).toEqual([]);
  });

  it('refuses B a Yahoo list, digest or summary with 409 and opens no IMAP session', async () => {
    for (const [path, body] of [['/messages?provider=yahoo'], ['/digest?provider=yahoo'], ['/summary?provider=yahoo', {}]] as const) {
      const res = await call(path, OWNER_B, body);
      expect(res.status, path).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'no_yahoo_connection', provider: 'yahoo' });
    }
    expect(await (await call('/messages?provider=yahoo&surface=1', OWNER_B)).json()).toMatchObject({ connected: false, error: 'no_yahoo_connection' });
    expect(imap.connections).toBe(0);
    expect(recorded.prompts).toEqual([]);
  });

  it("summarizes A's Yahoo day on the comms bot with only A's rows", async () => {
    const res = await call('/summary?provider=yahoo', OWNER_A, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: 'yahoo', summary: `bot summary for ${OWNER_A}` });
    expect(recorded.prompts.map((p) => [p.agentId, p.sub])).toEqual([[COMMS_BOT, OWNER_A]]);
    expect(recorded.prompts[0].text).toContain(A_SUBJECTS[2]);
    expect(recorded.prompts[0].text).not.toContain(YAHOO_PASSWORD);
  });

  it('answers message, draft and send for Yahoo with 400 and never contacts Yahoo', async () => {
    const refusals = [
      await call('/message/4242?provider=yahoo', OWNER_A),
      await call('/draft?provider=yahoo', OWNER_A, { messageId: '4242' }),
      await call('/send?provider=yahoo', OWNER_A, { subject: 'copy', body: 'text', confirm: true }),
    ];
    for (const res of refusals) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'not_supported_for_provider', provider: 'yahoo' });
    }
    expect(imap.connections).toBe(0);
    expect(recorded.prompts).toEqual([]);
  });
});
