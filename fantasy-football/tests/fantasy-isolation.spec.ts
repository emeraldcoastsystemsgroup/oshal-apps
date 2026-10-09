/**
 * Cross-user denial for Fantasy Football, across the real boundary (ADR-146 Q2, operator decision
 * 2026-09-27: "only i can control my team.. no one else can see my team and connection").
 *
 * THE BOUNDARY: which rows and which ESPN connection a request may touch. Nothing on it is doubled —
 * a private PostgreSQL started for this file with core's tenancy and connector migrations (060, 100,
 * 101), this package's own migration 001 applied BY the NOSUPERUSER NOBYPASSRLS runtime role so that
 * role OWNS the ff_* tables (the production shape, where FORCE is what makes an owner obey its own
 * policies), the production GUC pool wrapper stamping each request's identity, connections written
 * by the production upsert and sealed by the production per-user DEK envelope, the REAL kernel
 * connection lookup and token broker, and the REAL packaged fantasy routes over loopback HTTP.
 *
 * Doubled OUTSIDE that boundary, and recorded: the ESPN hosts (a fetch stub keyed by the SWID cookie
 * each request carries — every fixture league answers only its member's cookie) and the Pino logger's
 * output. What is asserted is which rows each caller sees and which cookie went out, never ESPN.
 *
 * SELF-VALIDATED: the runtime role owns the tables, every table is forced, a forged row in another
 * user's name is refused (SQLSTATE 42501), and an OPERATOR identity sees none of another person's
 * rows — so the fixture enforces the wall rather than agreeing with itself. Docker is REQUIRED — a
 * missing engine fails, never skips.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: owners A and B each with their own ESPN connection and league, owner C sharing an ESPN connection into a household A and a stranger belong to, and an operator. B cannot list, unlink, grade or read A's league, calls or cached projections, and B's league read carries only B's cookie; the operator sees none of A's rows over HTTP or SQL; the stranger's household-shared connection is refused and never spent; A's requests carry A's own cookie although the shared row sorts first; anonymous is 401.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.2.0: migration 002 applied by the runtime role too (ff_manual_leagues, ff_weeks forced with exact-owner policies); A's hand-typed league serves the lineup, season, waivers and trades on the real store with no cookie sent; B can neither read, list, replace, delete nor build on it; A's completed week is graded from A's stored actuals by the real grading statements, and B's grading pass grades nothing; the operator sees none of the new tables either (15 cases).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { wrapPoolWithGuc } from '@/shared/services/database/guc-pool';
import { runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { addMember, createTenant, upsertConnection } from '@/app/routes/connector-tenancy';
import { encryptToken } from '@/app/routes/connector-token-crypto';
import { createFantasyFootballRoutes } from '../src-routes/fantasy-routes';

vi.setConfig({ testTimeout: 30000, hookTimeout: 180000 });

const RUNTIME_ROLE = 'fantasy_runtime';
const A = 'fantasy-owner-a';
const B = 'fantasy-owner-b';
const C = 'fantasy-owner-c';
const STRANGER = 'fantasy-stranger';
const OPERATOR = 'fantasy-operator';
const SEASON = 2026;
const WEEK = 4;
/** The week ESPN reports as current; the grading case moves it on to 5. */
let currentWeek = WEEK;
/** SWIDs and espn_s2 values minted per run, so no literal credential is ever written down. */
const SWID = { a: `{${randomUUID().toUpperCase()}}`, b: `{${randomUUID().toUpperCase()}}`, c: `{${randomUUID().toUpperCase()}}` };
const S2 = { a: `a-${randomUUID()}`, b: `b-${randomUUID()}`, c: `c-${randomUUID()}` };
const LEAGUE_A = '111111';
const LEAGUE_B = '222222';
const A_TEAM = 'Alpha Private Team';
const A_PLAYER = 'Alpha Bench Star';

const fixture = new DisposablePostgres({
  purpose: 'fantasy-football-isolation',
  migrations: ['060-platform-rls-tenancy.sql', '100-connector-base-schema.sql', '101-connections-multi-account.sql'],
  roles: [RUNTIME_ROLE],
});
const realFetch = globalThis.fetch;
const sent: Array<{ url: string; cookie: string }> = [];
let owner: Awaited<ReturnType<typeof fixture.start>>;
let runtimePool: ReturnType<typeof wrapPoolWithGuc>;
let server: Server;
let base = '';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** One roster entry in ESPN's shape. */
function entry(playerId: number, name: string, slot: number) {
  return { playerId, lineupSlotId: slot, playerPoolEntry: { player: { id: playerId, fullName: name, eligibleSlots: [2, 20], defaultPositionId: 2 } } };
}

/** Each league, the SWID that may read it, and its teams. */
const LEAGUES: Record<string, { swid: string; name: string; teams: unknown[] }> = {
  [LEAGUE_A]: { swid: SWID.a, name: 'Alpha League', teams: [
    { id: 1, name: A_TEAM, owners: [SWID.a], roster: { entries: [entry(11, 'Alpha Starter', 2), entry(12, A_PLAYER, 20)] } },
    { id: 2, name: 'Alpha Rival', owners: ['{RIVAL}'], roster: { entries: [entry(21, 'Rival Back', 2)] } },
  ] },
  [LEAGUE_B]: { swid: SWID.b, name: 'Bravo League', teams: [
    { id: 5, name: 'Bravo Team', owners: [SWID.b], roster: { entries: [entry(51, 'Bravo Back', 2)] } },
  ] },
};

/** Completed weeks every feed player carries, so the refresh writes a real history. */
/** Filler players: with the four named ones this is 522 player-weeks, across the 500-row insert chunk. */
const FILLER = 170;
const PLAYER_WEEKS = (4 + FILLER) * 3;

/** The public feed: this week's projection and every completed week before it, for every player. */
function feed() {
  const PLAYED = Array.from({ length: currentWeek - 1 }, (_, i) => i + 1);
  const row = (id: number, name: string, yards: number) => ({ id, fullName: name, eligibleSlots: [2, 20], defaultPositionId: 2, proTeamId: 1,
    stats: [{ seasonId: SEASON, scoringPeriodId: currentWeek, statSourceId: 1, statSplitTypeId: 1, stats: { 24: yards } },
      ...PLAYED.map((w) => ({ seasonId: SEASON, scoringPeriodId: w, statSourceId: 0, statSplitTypeId: 1, stats: { 24: yards + w * 7 } }))] });
  const named = [row(11, 'Alpha Starter', 40), row(12, A_PLAYER, 120), row(21, 'Rival Back', 70), row(51, 'Bravo Back', 80)];
  return [...named, ...Array.from({ length: FILLER }, (_, i) => row(1000 + i, `Filler ${i}`, 10 + (i % 30)))];
}

/** ESPN: every league answers only the SWID of its member; the public reads need no cookie. */
async function espn(url: URL, cookie: string): Promise<Response> {
  if (/\/seasons\/\d+$/.test(url.pathname)) return json(200, { currentScoringPeriod: { id: currentWeek } });
  if (url.pathname.endsWith('/players')) return json(200, feed());
  const league = /\/leagues\/(\d+)$/.exec(url.pathname)?.[1] || '';
  const def = LEAGUES[league];
  if (!def) return json(404, { messages: ['not found'] });
  if (!cookie.includes(`SWID=${def.swid};`)) return json(401, { messages: ['not authorized'] });
  const views = url.searchParams.getAll('view');
  if (views.includes('mSettings')) return json(200, { scoringPeriodId: WEEK, settings: { name: def.name,
    scoringSettings: { scoringItems: [{ statId: 24, points: 0.1 }] }, rosterSettings: { lineupSlotCounts: { 2: 1, 20: 4 } } } });
  if (views.includes('mMatchup')) return json(200, { schedule: [{ matchupPeriodId: WEEK, home: { teamId: 1 }, away: { teamId: 2 } }] });
  return json(200, { teams: def.teams });
}

/** ESPN hosts are answered here and recorded with the cookie they carried; loopback goes to the real fetch. */
async function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!url.hostname.endsWith('espn.com')) return realFetch(input, init);
  const cookie = String((init?.headers as Record<string, string> | undefined)?.Cookie || '');
  sent.push({ url: url.toString(), cookie });
  return espn(url, cookie);
}

/** Seed one espn-fantasy connection through the production upsert and per-user envelope, as its owner. */
async function seed(sub: string, swid: string, s2: string, tenantId?: string): Promise<void> {
  await runWithRequestIdentity({ sub, isOperator: false }, async () => {
    await upsertConnection(runtimePool, {
      userSub: sub, userEmail: `${sub}@oshal.example.com`, provider: 'espn-fantasy', accountEmail: null,
      accountId: swid, scopes: '', encAccess: await encryptToken(runtimePool, sub, `${swid}:${s2}`), encRefresh: null,
      expiry: null, connectedBySub: sub, tenantId: tenantId ?? null,
    });
  });
}

/** The routes, mounted as the kernel mounts them: a signed-in subject and a stamped request identity. */
function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/fantasy-football', (req, _res, next) => {
    const sub = req.header('x-fixture-sub');
    if (sub) Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub: sub ?? null, isOperator: req.header('x-fixture-operator') === 'on' } as never, () => next());
  }, createFantasyFootballRoutes({ pool: runtimePool, appPackageDir: resolve(__dirname, '..') } as never));
  return app;
}

async function call(method: string, path: string, sub?: string, body?: unknown, operator = false): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sub) headers['x-fixture-sub'] = sub;
  if (operator) headers['x-fixture-operator'] = 'on';
  const res = await realFetch(`${base}/api/fantasy-football${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Rows of one ff_* table visible to one stamped identity, read through the runtime role. */
async function visible(table: string, sub: string, isOperator = false): Promise<Array<{ user_sub: string }>> {
  return (await runWithRequestIdentity({ sub, isOperator }, () =>
    runtimePool.query(`SELECT user_sub FROM ${table}`))).rows as Array<{ user_sub: string }>;
}

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', randomUUID());
  vi.stubEnv('OSHAL_DB_GUC', 'on');
  vi.stubEnv('OSHAL_DB_GUC_STRICT', 'deny');
  owner = await fixture.start();
  await owner.query(`GRANT CREATE, USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE}`);
  await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE}`);
  await owner.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${RUNTIME_ROLE}`);
  // The package migration runs AS the runtime role, so that role owns the ff_* tables exactly as the
  // api does in production — which is the case FORCE exists for.
  for (const file of ['001-fantasy-football.sql', '002-fantasy-manual-and-weeks.sql']) {
    await fixture.rolePool(RUNTIME_ROLE).query(readFileSync(resolve(__dirname, '../migrations', file), 'utf8'));
  }
  runtimePool = wrapPoolWithGuc(fixture.rolePool(RUNTIME_ROLE));
  await seed(A, SWID.a, S2.a);
  await seed(B, SWID.b, S2.b);
  const household = await runWithRequestIdentity({ sub: C, isOperator: false }, async () => {
    const t = await createTenant(runtimePool, { name: 'Shared household', createdBySub: C });
    await addMember(runtimePool, t.tenant_id, A, C);
    await addMember(runtimePool, t.tenant_id, STRANGER, C);
    return t.tenant_id;
  });
  await seed(C, SWID.c, S2.c, household);
  vi.stubGlobal('fetch', providerFetch);
  server = makeApp().listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', () => done()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await fixture.stop();
  vi.unstubAllEnvs();
});

describe('the fixture enforces the wall it is testing', () => {
  it('has the runtime role OWN every ff_* table, each forced with its exact-owner policy', async () => {
    const r = await owner.query(`SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity,
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
      FROM pg_class c WHERE c.relname LIKE 'ff\\_%' AND c.relkind = 'r' ORDER BY c.relname`);
    expect(r.rows).toEqual(['ff_calls', 'ff_leagues', 'ff_manual_leagues', 'ff_player_weeks', 'ff_projections', 'ff_weeks'].map((relname) => ({
      relname, owner: RUNTIME_ROLE, relrowsecurity: true, relforcerowsecurity: true, policies: 1,
    })));
  });

  it('refuses a row written in another person\'s name', async () => {
    await expect(runWithRequestIdentity({ sub: B, isOperator: false }, () => runtimePool.query(
      "INSERT INTO ff_leagues (user_sub, season, league_id) VALUES ($1, 2026, 'forged')", [A],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('each person reaches only their own league', () => {
  it('answers 401 with no session', async () => {
    expect((await call('GET', '/status')).status).toBe(401);
    expect((await call('GET', `/lineup?leagueId=${LEAGUE_A}`)).status).toBe(401);
  });

  it('links A\'s league with A\'s own team, read with A\'s cookie only', async () => {
    sent.length = 0;
    const linked = await call('POST', '/link', A, { leagueId: LEAGUE_A, season: SEASON });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ ok: true, teamName: A_TEAM });
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) expect(s.cookie).toBe(`SWID=${SWID.a}; espn_s2=${S2.a}`);
  });

  it('serves A a lineup for A\'s team and registers A\'s calls', async () => {
    const lineup = await call('GET', `/lineup?leagueId=${LEAGUE_A}&season=${SEASON}`, A);
    expect(lineup.status).toBe(200);
    expect(lineup.body.team.name).toBe(A_TEAM);
    expect(lineup.body.calls.map((c: any) => c.start.name)).toContain(A_PLAYER);
    expect((await visible('ff_calls', A)).length).toBeGreaterThan(0);
    expect((await visible('ff_projections', A)).map((r) => r.user_sub)).toEqual([A]);
    // The refresh stored every completed week in A's name, across the insert chunk boundary.
    const weeks = await visible('ff_player_weeks', A);
    expect(weeks.length).toBe(PLAYER_WEEKS);
    expect(new Set(weeks.map((r) => r.user_sub))).toEqual(new Set([A]));
  });

  it('shows B none of A\'s leagues, calls or cached projections — over HTTP and in SQL', async () => {
    const status = await call('GET', '/status', B);
    expect(status.body.connected).toBe(true);
    expect(status.body.leagues).toEqual([]);
    const record = await call('GET', '/record', B);
    expect(record.body.calls).toEqual([]);
    expect(record.body.record.graded).toBe(0);
    for (const table of ['ff_leagues', 'ff_calls', 'ff_projections', 'ff_player_weeks', 'ff_manual_leagues', 'ff_weeks']) {
      expect(await visible(table, B), table).toEqual([]);
    }
  });

  it('lets B neither unlink A\'s league nor read it — B\'s read carries only B\'s cookie', async () => {
    const removed = await call('DELETE', `/leagues/${SEASON}/${LEAGUE_A}`, B);
    expect(removed.body.removed).toBe(0);
    expect((await call('GET', '/status', A)).body.leagues.map((l: any) => l.leagueId)).toEqual([LEAGUE_A]);
    sent.length = 0;
    const lineup = await call('GET', `/lineup?leagueId=${LEAGUE_A}&season=${SEASON}`, B);
    expect(lineup.status).toBe(404);
    expect(JSON.stringify(lineup.body)).not.toContain(A_TEAM);
    for (const s of sent) expect(s.cookie.includes(SWID.a) || s.cookie.includes(S2.a)).toBe(false);
  });

  it('keeps B\'s own league B\'s, and A\'s list unchanged', async () => {
    expect((await call('POST', '/link', B, { leagueId: LEAGUE_B, season: SEASON })).status).toBe(200);
    expect((await call('GET', '/status', B)).body.leagues.map((l: any) => l.leagueId)).toEqual([LEAGUE_B]);
    expect((await call('GET', '/status', A)).body.leagues.map((l: any) => l.leagueId)).toEqual([LEAGUE_A]);
    // B's own lineup refreshes B's own copy of the public feed; A's copy is untouched and unseen.
    expect((await call('GET', `/lineup?leagueId=${LEAGUE_B}&season=${SEASON}`, B)).status).toBe(200);
    expect((await visible('ff_player_weeks', B)).length).toBe(PLAYER_WEEKS);
    expect((await visible('ff_player_weeks', A)).length).toBe(PLAYER_WEEKS);
    expect((await owner.query('SELECT count(DISTINCT user_sub)::int AS n FROM ff_projections')).rows[0].n).toBe(2);
  });

  it('grades only the caller\'s own ledger', async () => {
    expect((await call('POST', '/grade', B, { season: SEASON })).body).toMatchObject({ ok: true, graded: 0 });
    const aCalls = (await owner.query('SELECT count(*)::int AS n FROM ff_calls WHERE user_sub = $1', [A])).rows[0].n;
    expect(aCalls).toBeGreaterThan(0);
  });
});

describe('a hand-typed league and the week ledger are their owner\'s alone', () => {
  let manualId = 0;
  const league = {
    name: 'Hand-typed', season: SEASON, scoring: [{ statId: 24, points: 0.1 }], slots: [{ slotId: 2, count: 1 }],
    teams: [{ teamId: 1, name: A_TEAM, mine: true, roster: [11, 12], starting: [11] }, { teamId: 2, name: 'Rival', roster: [21], starting: [21] }],
    schedule: [{ week: WEEK, home: 1, away: 2 }], byes: {}, faab: { budget: 100, spent: 0 }, lastWeek: 6, playoffStart: 6,
  };

  it('serves A every board from A\'s hand-typed league on the real store, with no cookie sent', async () => {
    const created = await call('POST', '/manual-leagues', A, league);
    expect(created.status).toBe(201);
    manualId = created.body.id;
    sent.length = 0;
    for (const board of ['lineup', 'season', 'waivers', 'trades']) {
      const res = await call('GET', `/${board}?manualId=${manualId}&season=${SEASON}`, A);
      expect(res.status, board).toBe(200);
      expect(res.body.source, board).toBe('manual');
    }
    expect(sent.filter((s) => s.url.includes('/leagues/'))).toEqual([]);
    for (const s of sent) expect(s.cookie).toBe('');
    expect((await visible('ff_weeks', A)).length).toBeGreaterThan(0);
  });

  it('lets B neither read, list, replace, delete nor build on A\'s hand-typed league', async () => {
    expect((await call('GET', `/manual-leagues/${manualId}`, B)).status).toBe(404);
    expect((await call('GET', '/manual-leagues', B)).body.leagues).toEqual([]);
    expect((await call('PUT', `/manual-leagues/${manualId}`, B, { ...league, name: 'Taken' })).status).toBe(404);
    expect((await call('DELETE', `/manual-leagues/${manualId}`, B)).body.removed).toBe(0);
    expect((await call('GET', `/lineup?manualId=${manualId}&season=${SEASON}`, B)).status).toBe(404);
    expect(await visible('ff_manual_leagues', B)).toEqual([]);
    expect((await visible('ff_weeks', B)).filter((r) => r.user_sub !== B)).toEqual([]);
    expect((await call('GET', `/manual-leagues/${manualId}`, A)).body.league.name).toBe('Hand-typed');
  });

  it('grades A\'s completed week from A\'s stored actuals on the real store, and only A\'s', async () => {
    currentWeek = WEEK + 1;
    try {
      // Week 5's lineup refreshes A's feed, which now carries week 4's actual lines; then grade.
      expect((await call('GET', `/lineup?manualId=${manualId}&season=${SEASON}`, A)).status).toBe(200);
      const graded = await call('POST', '/grade', A, { season: SEASON });
      expect(graded.body.graded, JSON.stringify(graded.body)).toBeGreaterThanOrEqual(1);
      const rows = (await runWithRequestIdentity({ sub: A, isOperator: false }, () => runtimePool.query(
        "SELECT graded, actual_advised::float AS advised, actual_started::float AS started FROM ff_weeks WHERE league_key = $1 AND week = $2",
        [`manual:${manualId}`, WEEK]))).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].graded).toBe(true);
      expect(rows[0].advised).toBeGreaterThanOrEqual(rows[0].started);
      expect((await call('POST', '/grade', B, { season: SEASON })).body.graded).toBe(0);
    } finally {
      currentWeek = WEEK;
    }
  });
});

describe('no role reads another person\'s team', () => {
  it('shows an OPERATOR none of A\'s rows, over HTTP or SQL', async () => {
    const status = await call('GET', '/status', OPERATOR, undefined, true);
    expect(status.body.leagues).toEqual([]);
    expect((await call('GET', '/record', OPERATOR, undefined, true)).body.calls).toEqual([]);
    for (const table of ['ff_leagues', 'ff_calls', 'ff_projections', 'ff_player_weeks', 'ff_manual_leagues', 'ff_weeks']) {
      expect(await visible(table, OPERATOR, true), table).toEqual([]);
    }
  });
});

describe('the ESPN connection is the caller\'s own', () => {
  it('refuses a household-shared connection and never sends its cookie', async () => {
    const status = await call('GET', '/status', STRANGER);
    expect(status.body.connected).toBe(false);
    expect(status.body.connectHint).toMatch(/your own/i);
    sent.length = 0;
    const link = await call('POST', '/link', STRANGER, { leagueId: LEAGUE_A, season: SEASON });
    expect(link.status).toBe(403);
    for (const s of sent) expect(s.cookie).toBe('');
  });

  it('spends A\'s personal connection although the shared one sorts first', async () => {
    sent.length = 0;
    const lineup = await call('GET', `/lineup?leagueId=${LEAGUE_A}&season=${SEASON}`, A);
    expect(lineup.status).toBe(200);
    const leagueReads = sent.filter((s) => s.url.includes('/leagues/'));
    expect(leagueReads.length).toBeGreaterThan(0);
    for (const s of leagueReads) expect(s.cookie).toBe(`SWID=${SWID.a}; espn_s2=${S2.a}`);
  });
});
