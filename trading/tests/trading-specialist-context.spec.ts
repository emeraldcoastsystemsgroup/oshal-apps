/**
 * The trading bot's ONLY data channel, proven end to end through the REAL kernel.
 *
 * A protected bot-node run is tool-less, so the specialist-context append is the only way numbers
 * reach the accountable trading bot. This suite stands up the REAL SpecialistContextRegistry, the
 * REAL ApplicationAuthorizationRuntime registered from this package's REAL oshal-app.yaml, and the
 * REAL ManifestRouteMounter, then mounts the REAL createTradingRoutes factory through it and reads
 * the facts back out of registry.append() exactly as BotNodeClient does before a signed dispatch.
 *
 * The fixture is the operator's REAL book layout, read from oshal-local-db: one paper book and
 * THREE live books (the legacy engine book plus two bound Schwab accounts). That is the layout the
 * kind-grouped shape failed on - see the three-live-books suite below.
 *
 * Doubled here: only the Postgres pool, and it is a STRICT double - it refuses any query it does
 * not recognise and records the parameters of the ones it does, which is what lets the book-scope
 * and owner-scope claims be checked rather than asserted. The real store/RLS boundary for these
 * exact queries is proven core-side (trading-books-schema, trading-override-book-scope,
 * trading-engine-cost-basis); recorded here per the real-boundary audit.
 *
 * RUN: from this package root, with a framework checkout on the alias path -
 *   OSHAL_FRAMEWORK=<oshal checkout> node <oshal checkout>/node_modules/vitest/vitest.mjs run \
 *     --config vitest.config.mjs tests/trading-specialist-context.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial - the facts are produced, labelled live vs paper with no leakage between the books, computed for the ticket's owner and not the asker, delivered inside the kernel's 2000 ms deadline even when the store wedges, and honest (null, not 0) when no equity was recorded today.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The fixture becomes the operator's REAL four-book layout, and the suite gains the case the kind-grouped shape could not pass: with three live books and two siblings last snapshotted the previous session, the engine book must still report its own recorded equity. Also pins one book per slot (nothing summed across live books), the live slots against paper money, and the honest overflow when an owner has more books than slots.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The declaration under test is BOTH halves. The registered fact set is now TRADING_SPECIALIST_FACT_KEYS, so the kernel-cap and exact-key assertions moved onto the composed set - checking only the book half would let the market half push the real declaration past 64 keys and be refused wholesale on a live box while this suite stayed green. Adds the regression itself: the append the BotNodeClient makes must carry the market keys, because the bot was reporting equity to the cent while answering that it could not access index or market-mover data. Every Alpaca env var is scrubbed for the file so the composed read can never reach a live vendor from a developer shell.
 */
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import express from 'express';
import yaml from 'js-yaml';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ManifestRouteMounterImpl } from '@/app/composition/manifest-route-mounter';
import type { AppContext } from '@/app/composition/app-context';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import type { SwarmAppManifest, SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AuthorizationActor } from '@/shared/application-authorization';
import { getApplicationAuthorizationActor, runWithApplicationAuthorizationActor } from '@/shared/application-authorization-context';
import { configureApplicationExecutionPolicy } from '@/shared/application-authorization-execution';
import { runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { SpecialistContextRegistry, configureSpecialistContextRegistry } from '@/shared/specialist-context';
import { createTradingRoutes, TRADING_ANALYST_AGENT_ID, TRADING_FACTS_TOOL } from '../src-routes/trading-routes';
import { TRADING_BOOK_SLOTS, TRADING_FACT_KEYS, easternDay, readTradingBookFacts } from '../src-routes/trading-book-facts';
import { MARKET_FACT_KEYS, TRADING_SPECIALIST_FACT_KEYS, resetMarketFactsCache } from '../src-routes/trading-market-facts';

const PACKAGE_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = join(PACKAGE_ROOT, 'oshal-app.yaml');
const MANIFEST = yaml.load(readFileSync(MANIFEST_PATH, 'utf8')) as SwarmAppManifest;
const APP = MANIFEST.name;
const ISSUER = 'https://accounts.google.com';

/**
 * The operator's real books, by id, so a scope bug shows up as the WRONG book's money. Three of
 * them are live: the legacy engine book and two bound Schwab account books, which is the layout
 * that broke the kind-grouped shape.
 */
const LIVE_BOOK = '631c0052-b0d8-b9ca-6f50-2ad28ce736d9';
const MARGIN_BOOK = '6690e236-ae0c-4b18-a303-62666e84252a';
const CASH_BOOK = '77146871-8cfb-4113-9164-389a82df42c2';
const PAPER_BOOK = '9bad813d-0000-0000-0000-00000000dead';

const OWNER: AuthorizationActor = { sub: 'owner-sub', issuer: ISSUER, isActive: true, isSwarmAdmin: false };
const ASKER: AuthorizationActor = { ...OWNER, sub: 'someone-else' };
const ADMIN: AuthorizationActor = { ...OWNER, sub: 'admin-sub', isSwarmAdmin: true };

interface EquityPoint { et_day: string; equity: number }
interface FillRow { order_id: string; symbol: string; side: 'buy' | 'sell'; filled_qty: number; filled_avg_price: number; realized_pnl: string | null; today: boolean }
interface BookFixture { book_id: string; ref: string; kind: 'live' | 'paper' }
interface SubFixture { books: BookFixture[]; equity: Record<string, EquityPoint[]>; fills: Record<string, FillRow[]> }

let store: Record<string, SubFixture>;
let queries: Array<{ text: string; params: unknown[] }>;
/** Per-query latency, so the deadline claim is measured rather than asserted. */
let latencyMs: number;
/** When true the store never answers - the wedged-database case. */
let wedged: boolean;
/** When true every read rejects - the database-is-down case. */
let failing: boolean;
/** One book id whose reads reject - the one-book-is-unreadable case. */
let unreadableBook: string | null;

const DAY_MS = 86_400_000;
const today = (): string => easternDay(Date.now());
const yesterday = (): string => easternDay(Date.now() - DAY_MS);

/** @description A STRICT pool double: it answers only the queries this reader is allowed to make,
 * records every one for the scope assertions, and throws on anything else so a new unscoped query
 * cannot slip in unnoticed.
 * @returns An object shaped like the framework's pool for the reads under test. */
function fakePool(): AppContext['pool'] {
  const query = async (text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    queries.push({ text, params });
    if (wedged) return new Promise(() => undefined);
    if (failing) throw new Error('fixture: the trading store is unavailable');
    // Latency is charged to the READER's own reads. The trading stores' idempotent
    // schema-readiness probes are charged nothing: they are the store's bootstrap, not this
    // reader's work, and on every oshal deployment Postgres is a same-host socket away, so
    // modelling each of those probes as a remote round trip would measure the fixture rather
    // than the reader. What DOES have to stay small is the reader's data-query count per book,
    // and the scope case below pins it.
    if (latencyMs && !isReadinessProbe(text)) await new Promise((done) => setTimeout(done, latencyMs));
    const rows = answer(text, params);
    return { rows, rowCount: rows.length };
  };
  return { query } as unknown as AppContext['pool'];
}

/** @description Resolve one recognised query against the fixture.
 * @param text - The SQL the store code issued. @param params - Its bound parameters.
 * @returns The rows, or throws for an unrecognised query. */
function answer(text: string, params: unknown[]): unknown[] {
  if (text.includes('to_regclass')) return [{ exists: true }];
  if (text.includes('information_schema.columns')) return [{ column_name: String(params[2]) }];
  const sub = String(params[0] ?? '');
  const fixture = store[sub];
  if (unreadableBook && String(params[1] ?? '') === unreadableBook) {
    throw new Error(`fixture: book ${unreadableBook} cannot be read`);
  }
  if (text.includes('FROM oshal_trading_books b')) {
    return (fixture?.books ?? []).map((b) => ({
      book_id: b.book_id, ref: b.ref, kind: b.kind, broker: null, account_id: null,
      connection_key: null, enabled: true, learn: false, capital_cap_usd: null,
      settlement_policy: null, account_type: null,
    }));
  }
  if (text.includes('FROM oshal_trading_daily_equity')) {
    const points = fixture?.equity[String(params[1] ?? '')] ?? [];
    return points.map((p) => ({ et_day: p.et_day, equity: p.equity }));
  }
  if (text.includes('FROM oshal_trading_orders')) {
    const fills = fixture?.fills[String(params[1] ?? '')] ?? [];
    // realizedReport's close selection: filled sells in the last 30 days, with a today flag.
    if (text.includes("side='sell'")) {
      return fills.filter((f) => f.side === 'sell')
        .map((f) => ({ order_id: f.order_id, symbol: f.symbol, realized_pnl: f.realized_pnl, today: f.today }));
    }
    // engineRealizedForBook's replay read: every filled order for the named symbols.
    const symbols = (params[2] as string[] | undefined) ?? null;
    return fills.filter((f) => !symbols || symbols.includes(f.symbol))
      .map((f) => ({ order_id: f.order_id, symbol: f.symbol, side: f.side, filled_qty: f.filled_qty, filled_avg_price: f.filled_avg_price }));
  }
  throw new Error(`Unrecognised query from the trading facts reader: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
}

/** @description Whether a query is one of the trading stores' schema-readiness probes rather than
 * a read the facts reader asked for.
 * @param text - The SQL. @returns True for a readiness probe. */
function isReadinessProbe(text: string): boolean {
  return text.includes('to_regclass') || text.includes('information_schema');
}

let registry: SpecialistContextRegistry;
let runtime: ApplicationAuthorizationRuntime;
let policy: ApplicationAuthorizationService;
let authStore: MemoryAuthorizationStore;
let packageDir: string;
let ctx: AppContext;

/** @description Build the installed-application record the real runtime registers, from the REAL
 * shipped manifest - so the manifest's own bots[]/tools[] are what the kernel's ownership check runs
 * against.
 * @returns The record. */
function record(): SwarmApplicationRecord {
  return {
    appId: APP, name: APP, displayName: MANIFEST.displayName ?? APP, description: '',
    version: MANIFEST.version ?? '0.0.0', status: 'active', manifestPath: MANIFEST_PATH,
    agentIds: (MANIFEST.bots ?? []).flatMap((bot) => (bot.agentId ? [bot.agentId] : [])),
    toolNames: (MANIFEST.tools ?? []).map((tool) => tool.name),
    manifest: MANIFEST, scope: 'public', ownerSub: null, tenantId: null, guestTierApproved: null,
    loadedAt: new Date(), updatedAt: new Date(),
  } as unknown as SwarmApplicationRecord;
}

/** @description Run something as a verified caller, exactly as the kernel's protected-route guard
 * and the manifest worker do before dispatch.
 * @param actor - The caller. @param run - The work. @returns Whatever the work returns. */
function asCaller<T>(actor: AuthorizationActor, run: () => Promise<T>): Promise<T> {
  return runWithApplicationAuthorizationActor(actor, () => runWithRequestIdentity(
    { sub: actor.sub, principalIssuer: actor.issuer, isOperator: false }, run));
}

/** @description Append the facts the way BotNodeClient.executeAuthorized does.
 * @param principal - The ticket's OWNER (not the asker). @param actor - Who is on the request.
 * @returns The enriched prompt text. */
function append(principal: AuthorizationActor, actor: AuthorizationActor = principal): Promise<string> {
  return asCaller(actor, () => registry.append(TRADING_ANALYST_AGENT_ID,
    'How did we do in the stock market today?', { sub: principal.sub, issuer: principal.issuer }));
}

/** @description Pull the appended fact object back out of the enriched prompt.
 * @param text - The enriched prompt. @returns The parsed facts. */
function facts(text: string): Record<string, number | boolean | null> {
  const line = text.slice(text.lastIndexOf('{'));
  return JSON.parse(line) as Record<string, number | boolean | null>;
}

/** @description Give one app-admin grant, the only route a catalog-less package has to an allowed
 * tools decision under enforce.
 * @param target - Who to grant. @returns Nothing. */
async function grantAppAdmin(target: AuthorizationActor): Promise<void> {
  const preview = await policy.previewChange(ADMIN, {
    action: 'grant', app: APP, targetSub: target.sub, targetIssuer: target.issuer, role: '@app-admin',
    reason: 'Isolated trading specialist-context proof', expectedRevision: (await authStore.read()).revision,
  });
  await policy.applyChange(ADMIN, { previewId: preview.previewId, idempotencyKey: `grant-${target.sub}` });
}

/**
 * Every env var that could hand the market half of the fact set a real vendor credential. The
 * composed read is the REAL one, so without this a developer shell (or the operator's own box)
 * would send these cases out to Alpaca - a live network call inside a unit suite, and a fact set
 * that changes with the tape. Scrubbed for the whole file, restored after it.
 */
const MARKET_ENV_KEYS = ['ALPACA_SCREENER_BASE_URL', 'ALPACA_PAPER_KEY_ID', 'ALPACA_PAPER_SECRET_KEY',
  'ALPACA_KEY_ID', 'ALPACA_KEY', 'ALPAKA_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_SECRET', 'ALPAKA_SECRET'];
const savedMarketEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of MARKET_ENV_KEYS) { savedMarketEnv.set(key, process.env[key]); delete process.env[key]; }
});

afterAll(() => {
  for (const [key, value] of savedMarketEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

beforeEach(async () => {
  resetMarketFactsCache();
  process.env.APP_PACKAGE_DYNAMIC_ROUTES = 'true';
  process.env.APP_PACKAGE_MIGRATIONS = 'false';
  // Validate-only keeps the store helpers' idempotent bootstraps off the DDL path: the double
  // answers the two readiness probes instead, which is what a hosted runtime role does anyway.
  process.env.OSHAL_SCHEMA_BOOTSTRAP = 'validate-only';
  queries = []; latencyMs = 0; wedged = false; failing = false; unreadableBook = null;
  store = {
    [OWNER.sub]: {
      // listBooks order: legacy refs first, then by creation. The engine book is the legacy `live`.
      books: [
        { book_id: PAPER_BOOK, ref: 'paper', kind: 'paper' },
        { book_id: LIVE_BOOK, ref: 'live', kind: 'live' },
        { book_id: MARGIN_BOOK, ref: 'b-6690e236', kind: 'live' },
        { book_id: CASH_BOOK, ref: 'b-77146871', kind: 'live' },
      ],
      // The operator's real recorded figures, with every book snapshotted today.
      equity: {
        [LIVE_BOOK]: [{ et_day: yesterday(), equity: 42_655.35 }, { et_day: today(), equity: 42_758.05 }],
        [MARGIN_BOOK]: [{ et_day: yesterday(), equity: 2_284.8 }, { et_day: today(), equity: 2_284.8 }],
        [CASH_BOOK]: [{ et_day: yesterday(), equity: 470_218.99 }, { et_day: today(), equity: 471_374.22 }],
        [PAPER_BOOK]: [{ et_day: yesterday(), equity: 94_163.3 }, { et_day: today(), equity: 94_465.63 }],
      },
      fills: {
        // Live engine book: one round trip closed today for +100.
        [LIVE_BOOK]: [
          { order_id: 'l-buy', symbol: 'ANET', side: 'buy', filled_qty: 10, filled_avg_price: 100, realized_pnl: null, today: false },
          { order_id: 'l-sell', symbol: 'ANET', side: 'sell', filled_qty: 10, filled_avg_price: 110, realized_pnl: '-999', today: true },
        ],
        // Paper: two closes today, one of them a loss, so a live/paper mix is unmistakable.
        [PAPER_BOOK]: [
          { order_id: 'p-buy', symbol: 'MPC', side: 'buy', filled_qty: 5, filled_avg_price: 200, realized_pnl: null, today: false },
          { order_id: 'p-sell', symbol: 'MPC', side: 'sell', filled_qty: 5, filled_avg_price: 190, realized_pnl: '0', today: true },
          { order_id: 'p-buy2', symbol: 'TSLA', side: 'buy', filled_qty: 2, filled_avg_price: 300, realized_pnl: null, today: false },
          { order_id: 'p-sell2', symbol: 'TSLA', side: 'sell', filled_qty: 2, filled_avg_price: 325, realized_pnl: '0', today: true },
        ],
        // The bound Schwab account books traded nothing today.
      },
    },
    [ASKER.sub]: {
      books: [{ book_id: 'aaaaaaaa-0000-0000-0000-00000000aaaa', ref: 'live', kind: 'live' }],
      equity: { 'aaaaaaaa-0000-0000-0000-00000000aaaa': [{ et_day: today(), equity: 7_777_777 }] },
      fills: {},
    },
  };
  authStore = new MemoryAuthorizationStore();
  policy = new ApplicationAuthorizationService(authStore);
  runtime = new ApplicationAuthorizationRuntime(policy, async () => OWNER, {}, async () => record());
  // The PRODUCTION deadline. Nothing here relaxes it.
  registry = new SpecialistContextRegistry(runtime, { timeoutMs: 2000 });
  configureSpecialistContextRegistry(registry);
  configureApplicationExecutionPolicy(runtime);
  await runtime.start(record());
  runtime.complete(record());
  await grantAppAdmin(OWNER);
  await grantAppAdmin(ASKER);

  ctx = { pool: fakePool(), appPackageDir: PACKAGE_ROOT } as unknown as AppContext;
  // The REAL mounter, loading a module that hands it the REAL factory. The mounter require()s a
  // CommonJS file, and the shipped routes/*.js keep their `@/…` imports for the running framework,
  // so the module under the mount point delegates to the factory this spec imported through the
  // package's own alias config. Everything the mounter does to it - staging the reader port,
  // rolling back a failed factory, publishing on success - is real.
  packageDir = mkdtempSync(join(tmpdir(), 'oshal-trading-specialist-'));
  (globalThis as Record<string, unknown>).__tradingRoutesFactory = createTradingRoutes;
  writeFileSync(join(packageDir, 'routes.js'),
    'exports.createTradingRoutes = function (ctx) { return globalThis.__tradingRoutesFactory(ctx); };\n');
  const mounter = new ManifestRouteMounterImpl(express(), (_req, _res, next) => next(), ctx, undefined, runtime, registry);
  await mounter.mount(APP, packageDir, [{ module: 'routes.js', factory: 'createTradingRoutes', mountPath: '/api/trading', auth: 'service-or-oidc' }]);
});

afterEach(() => {
  configureSpecialistContextRegistry(undefined);
  configureApplicationExecutionPolicy(undefined);
  delete (globalThis as Record<string, unknown>).__tradingRoutesFactory;
  const withinTemp = relative(resolve(tmpdir()), resolve(packageDir));
  if (!withinTemp || withinTemp.startsWith('..')) throw new Error('Unsafe fixture cleanup');
  rmSync(packageDir, { recursive: true, force: true });
});

describe('the manifest is what makes the registration legal', () => {
  it('declares the bot, the named read and the specialist-context skill it registers through', () => {
    expect((MANIFEST.bots ?? []).map((bot) => bot.agentId)).toContain(TRADING_ANALYST_AGENT_ID);
    expect((MANIFEST.tools ?? []).map((tool) => tool.name)).toContain(TRADING_FACTS_TOOL);
    // An older kernel must REFUSE this package rather than install it with the channel dropped.
    expect(MANIFEST.uses ?? []).toContain('specialist-context');
  });

  it('the real mounter published a reader for the trading bot', () => {
    expect(registry.requires(TRADING_ANALYST_AGENT_ID)).toBe(true);
    // capture() is what BotNodeClient calls before dispatch; it re-checks ownership against the
    // runtime registered from the manifest above, and throws if this package does not own both.
    expect(() => registry.capture(TRADING_ANALYST_AGENT_ID)()).not.toThrow();
  });

  it('the declared key set is one key per book per figure, inside the kernel cap', () => {
    // The registry refuses a declaration of more than 64 keys, and refuses a read whose key set is
    // not exactly the declared one - which is WHY the keys are fixed slots and cannot be minted
    // from an owner's own book refs at read time. The cap applies to what is REGISTERED, which is
    // both halves together - checking only the book half would let the market half push the real
    // declaration over 64 and be rejected wholesale on a live box while this stayed green.
    expect(TRADING_SPECIALIST_FACT_KEYS.length).toBeLessThanOrEqual(64);
    expect(new Set(TRADING_SPECIALIST_FACT_KEYS).size).toBe(TRADING_SPECIALIST_FACT_KEYS.length);
    for (const key of TRADING_SPECIALIST_FACT_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_.-]{0,63}$/);
    // Every slot the reader can fill has to be declared, or the read is rejected outright.
    for (const slot of TRADING_BOOK_SLOTS) expect(TRADING_FACT_KEYS).toContain(`${slot}.equity_today`);
    // Enough live slots for the operator's three live books, with room for another account.
    expect(TRADING_BOOK_SLOTS.filter((slot) => slot.startsWith('live')).length).toBeGreaterThanOrEqual(4);
  });

  it('declares the MARKET half too, because the bot cannot call the movers route', () => {
    // The regression: the bot reported the operator's equity to the cent and, in the same answer,
    // said it could not access index or market-mover data. Not a missing key and not a missing
    // screener - a fact set that carried no market number, on the one channel a tool-less worker
    // can see. A declaration that loses the market half puts the bot straight back there.
    for (const key of MARKET_FACT_KEYS) expect(TRADING_SPECIALIST_FACT_KEYS).toContain(key);
    expect(TRADING_SPECIALIST_FACT_KEYS).toEqual([...TRADING_FACT_KEYS, ...MARKET_FACT_KEYS]);
  });
});

describe('the facts', () => {
  it('are produced, one slot per book, for the whole account set', async () => {
    const produced = facts(await append(OWNER));
    // The kernel's normalizeFacts demands EXACTLY the declared set, so this is the whole
    // declaration - both halves - not just the book half the rest of this case is about.
    expect(Object.keys(produced).sort()).toEqual([...TRADING_SPECIALIST_FACT_KEYS].sort());
    expect(produced['books.live']).toBe(3);
    expect(produced['books.paper']).toBe(1);
    expect(produced['books.unreported']).toBe(0);
    expect(produced['paper.present']).toBe(true);
    expect(produced['live.present']).toBe(true);
    expect(produced['live2.present']).toBe(true);
    expect(produced['live3.present']).toBe(true);
    // The spare slot is absent, not an empty book.
    expect(produced['live4.present']).toBe(false);
    expect(produced['live4.equity_today']).toBeNull();
    expect(produced['facts.complete']).toBe(true);
  });

  it('carry the MARKET half across the channel, not only the book half', async () => {
    // This is the regression, proven where it actually happens: through the REAL registry's
    // append, the same call BotNodeClient makes before a signed dispatch. The bot was reporting
    // equity to the cent and saying it could not access index or market-mover data, because the
    // append it received carried book keys and nothing else.
    const produced = facts(await append(OWNER));
    for (const key of MARKET_FACT_KEYS) expect(Object.keys(produced)).toContain(key);
    // No market credential is configured in this suite (scrubbed above), so the figures are
    // honestly unknown and NO vendor is called - what is proven here is that the keys reach the
    // bot at all, and that the kernel accepts the composed declaration rather than refusing it.
    expect(produced['market.spy_change_pct']).toBeNull();
    expect(produced['market.screener_available']).toBe(false);
    expect(produced['market.complete']).toBe(false);
    // The book half is untouched by the market half's arrival.
    expect(produced['facts.complete']).toBe(true);
  });

  it('never mixes the live books with the paper book, and never sums one live book into another', async () => {
    const produced = facts(await append(OWNER));
    // The legacy engine book: 42,758.05 today against 42,655.35 yesterday, one close today at +100
    // on the engine's own cost basis.
    expect(produced['live.equity_today']).toBe(42_758.05);
    expect(produced['live.equity_prior_close']).toBe(42_655.35);
    expect(produced['live.day_change']).toBe(102.7);
    expect(produced['live.day_change_pct']).toBe(0.24);
    expect(produced['live.realized_today_net']).toBe(100);
    expect(produced['live.realized_today_trades']).toBe(1);
    expect(produced['live.realized_today_wins']).toBe(1);
    expect(produced['live.realized_today_losses']).toBe(0);
    // The two bound Schwab account books keep their OWN figures and traded nothing today.
    expect(produced['live2.equity_today']).toBe(2_284.8);
    expect(produced['live2.day_change']).toBe(0);
    expect(produced['live2.realized_today_trades']).toBe(0);
    expect(produced['live3.equity_today']).toBe(471_374.22);
    expect(produced['live3.day_change']).toBe(1_155.23);
    expect(produced['live3.realized_today_trades']).toBe(0);
    // Paper: up 302.33 on the day, two closes (-50 and +50).
    expect(produced['paper.equity_today']).toBe(94_465.63);
    expect(produced['paper.day_change']).toBe(302.33);
    expect(produced['paper.realized_today_net']).toBe(0);
    expect(produced['paper.realized_today_trades']).toBe(2);
    expect(produced['paper.realized_today_wins']).toBe(1);
    expect(produced['paper.realized_today_losses']).toBe(1);
    // Numbers that appear NOWHERE: the live total, and the live+paper total. Either one showing up
    // on any key means figures were added across books that must never be added.
    const totals = [42_758.05 + 2_284.8 + 471_374.22, 42_758.05 + 2_284.8 + 471_374.22 + 94_465.63];
    for (const total of totals) {
      expect(Object.values(produced)).not.toContain(Math.round(total * 100) / 100);
    }
    // And the closes are never pooled either: 1 live + 2 paper must not read as 3 anywhere.
    for (const slot of TRADING_BOOK_SLOTS) expect(produced[`${slot}.realized_today_trades`]).not.toBe(3);
  });

  it('scopes every store read to one book and one owner', async () => {
    await append(OWNER);
    const data = queries.filter((q) => !isReadinessProbe(q.text));
    // One book list, plus a small constant per book: the equity series, the closes, and the engine
    // replay for a book that has closes. Four books, eleven reads. If this ever multiplies, the
    // reader will start losing races with its own budget long before anyone notices a slow answer.
    expect(data.length).toBe(11);
    for (const q of data) {
      expect(q.params[0], `owner scope on ${q.text.replace(/\s+/g, ' ').slice(0, 80)}`).toBe(OWNER.sub);
      // Everything except the book LIST is keyed to exactly one book id.
      if (!q.text.includes('FROM oshal_trading_books b')) {
        expect([LIVE_BOOK, MARGIN_BOOK, CASH_BOOK, PAPER_BOOK]).toContain(String(q.params[1]));
      }
    }
    // Each book's rows were read under its OWN id - never one book's id standing in for another.
    const equity = data.filter((q) => q.text.includes('FROM oshal_trading_daily_equity')).map((q) => String(q.params[1]));
    expect(equity.sort()).toEqual([LIVE_BOOK, MARGIN_BOOK, CASH_BOOK, PAPER_BOOK].sort());
  });

  it('belong to the ticket owner, never to whoever is asking', async () => {
    // The asker is a real, separately provisioned user whose own live book is worth 7,777,777.
    // The kernel refuses a read for a principal who is not the caller, so a facts read can never
    // be performed on the asker's authority in the first place...
    await expect(asCaller(ASKER, () => registry.append(TRADING_ANALYST_AGENT_ID, 'x',
      { sub: OWNER.sub, issuer: OWNER.issuer }))).rejects.toThrow('specialist_context_identity_required');
    expect(queries.filter((q) => q.text.includes('FROM oshal_trading_books b'))).toHaveLength(0);
    // ...and on the owner's own dispatch every read is keyed to the owner, so the asker's money
    // can never appear in the answer.
    const produced = facts(await append(OWNER));
    expect(produced['live.equity_today']).toBe(42_758.05);
    expect(Object.values(produced)).not.toContain(7_777_777);
    expect([...new Set(queries.filter((q) => !q.text.includes('to_regclass')
      && !q.text.includes('information_schema')).map((q) => q.params[0]))]).toEqual([OWNER.sub]);
    expect(getApplicationAuthorizationActor()).toBeUndefined();
  });
});

describe('three live books, and a freshness gate on each one', () => {
  /**
   * 2026-09-15, the day the operator asked. The engine book HAD a recorded equity of 42,758.05;
   * its two sibling Schwab account books had not been snapshotted since the 14th. Grouping the
   * three into one `live.*` figure meant a single stale sibling withheld a number that was sitting
   * in the table, and the answer came back unknown.
   */
  const staleSiblings = (): void => {
    store[OWNER.sub].equity[MARGIN_BOOK] = [{ et_day: yesterday(), equity: 2_284.8 }];
    store[OWNER.sub].equity[CASH_BOOK] = [{ et_day: yesterday(), equity: 470_218.99 }];
  };

  it('a sibling account that missed today does not cost the engine book its recorded number', async () => {
    staleSiblings();
    const produced = facts(await append(OWNER));
    // The number that was in the table all along.
    expect(produced['live.equity_recorded_today']).toBe(true);
    expect(produced['live.equity_today']).toBe(42_758.05);
    expect(produced['live.day_change']).toBe(102.7);
    expect(produced['live.realized_today_net']).toBe(100);
    // The stale siblings, honestly: present, prior close known, today's figure unknown - not 0.
    for (const slot of ['live2', 'live3']) {
      expect(produced[`${slot}.present`]).toBe(true);
      expect(produced[`${slot}.equity_recorded_today`]).toBe(false);
      expect(produced[`${slot}.equity_today`]).toBeNull();
      expect(produced[`${slot}.equity_today`]).not.toBe(0);
      expect(produced[`${slot}.day_change`]).toBeNull();
    }
    expect(produced['live2.equity_prior_close']).toBe(2_284.8);
    expect(produced['live3.equity_prior_close']).toBe(470_218.99);
    // The paper book is untouched by any of it.
    expect(produced['paper.equity_today']).toBe(94_465.63);
    // Every book was read, so the fact set is complete even though two books have no figure today.
    expect(produced['books.live']).toBe(3);
    expect(produced['facts.complete']).toBe(true);
  });

  it('the engine book still reports when it is the ONLY live book with a snapshot today', async () => {
    staleSiblings();
    store[OWNER.sub].equity[PAPER_BOOK] = [{ et_day: yesterday(), equity: 94_163.3 }];
    const produced = facts(await append(OWNER));
    expect(produced['live.equity_today']).toBe(42_758.05);
    expect(produced['paper.equity_recorded_today']).toBe(false);
    expect(produced['paper.equity_today']).toBeNull();
  });

  it('a book that cannot be read costs its own keys, not its siblings', async () => {
    // Every read keyed to the margin book rejects - a corrupt row, a revoked grant, anything.
    unreadableBook = MARGIN_BOOK;
    const produced = facts(await append(OWNER));
    expect(produced['live2.present']).toBe(true);
    expect(produced['live2.equity_today']).toBeNull();
    expect(produced['live.equity_today']).toBe(42_758.05);
    expect(produced['live3.equity_today']).toBe(471_374.22);
    expect(produced['paper.equity_today']).toBe(94_465.63);
    expect(produced['facts.complete']).toBe(false);
  });

  it('a paper book never occupies a live slot, even with live slots free', async () => {
    store[OWNER.sub].books = [
      { book_id: PAPER_BOOK, ref: 'paper', kind: 'paper' },
      { book_id: LIVE_BOOK, ref: 'live', kind: 'live' },
      { book_id: 'cccccccc-0000-0000-0000-00000000cccc', ref: 'b-cccccccc', kind: 'paper' },
    ];
    store[OWNER.sub].equity['cccccccc-0000-0000-0000-00000000cccc'] = [{ et_day: today(), equity: 1_000_000 }];
    const produced = facts(await append(OWNER));
    expect(produced['books.paper']).toBe(2);
    // The second paper book had no paper slot left, so it is COUNTED, never dealt onto live2.
    expect(produced['books.unreported']).toBe(1);
    expect(produced['live2.present']).toBe(false);
    expect(Object.values(produced)).not.toContain(1_000_000);
    // A book the bot cannot see means the picture is not complete, and the facts say so.
    expect(produced['facts.complete']).toBe(false);
  });

  it('an owner with more live books than slots reads incomplete, never silently short', async () => {
    const extra = ['d1', 'd2'].map((tag, index) => ({
      book_id: `dddddddd-0000-0000-0000-0000000000d${index}`, ref: `b-${tag}`, kind: 'live' as const,
    }));
    store[OWNER.sub].books = [...store[OWNER.sub].books, ...extra];
    const produced = facts(await append(OWNER));
    expect(produced['books.live']).toBe(5);
    expect(produced['live4.present']).toBe(true);
    expect(produced['books.unreported']).toBe(1);
    expect(produced['facts.complete']).toBe(false);
    // The books that DID fit still carry their own real figures.
    expect(produced['live.equity_today']).toBe(42_758.05);
  });
});

describe('honest when the numbers are not there', () => {
  it('reads null, never 0, when no equity was recorded today (closed market, or a venue out all session)', async () => {
    store[OWNER.sub].equity[LIVE_BOOK] = [{ et_day: yesterday(), equity: 42_655.35 }];
    const produced = facts(await append(OWNER));
    expect(produced['live.equity_recorded_today']).toBe(false);
    expect(produced['live.equity_today']).toBeNull();
    expect(produced['live.day_change']).toBeNull();
    expect(produced['live.day_change_pct']).toBeNull();
    expect(produced['live.equity_today']).not.toBe(0);
    expect(produced['live.equity_prior_close']).toBe(42_655.35);
    // The other books still report, and today's closes are still a real count.
    expect(produced['paper.equity_recorded_today']).toBe(true);
    expect(produced['live3.equity_recorded_today']).toBe(true);
    expect(produced['live.realized_today_trades']).toBe(1);
  });

  it('makes no venue call at all — nothing in the reader can reach a broker or the market clock', () => {
    // Comments stripped: the module header names tradableSessionDetailed() to explain why it is
    // NOT used, and a guard that cannot tell prose from code is not a guard.
    const code = readFileSync(join(PACKAGE_ROOT, 'src-routes/trading-book-facts.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    for (const forbidden of ['getBrokerReader', 'getBrokerAdapter', 'tradableSession', 'isMarketOpen',
      'latestPrice', 'latestTrade', 'fetch(', 'marketData', 'http']) {
      expect(code, `the facts reader must not reach ${forbidden}`).not.toContain(forbidden);
    }
    // Its whole import surface: the pool's own stores and this package's realized helper.
    expect(code.match(/from '[^']+'/g)?.sort()).toEqual([
      "from './trading-realized'",
      "from '@/app/composition/app-context'",
      "from '@/app/trading-books-store'",
      "from '@/app/trading-daily-equity-store'",
      "from '@/features/trading'",
      "from '@/shared/logger'",
    ]);
  });
});

describe('the 2000 ms deadline', () => {
  it('delivers inside it, with room to spare, on a store answering at a realistic latency', async () => {
    latencyMs = 20;
    const started = Date.now();
    const produced = facts(await append(OWNER));
    const elapsed = Date.now() - started;
    expect(produced['facts.complete']).toBe(true);
    expect(elapsed, `append took ${elapsed}ms`).toBeLessThan(2000);
  });

  it('a wedged store costs the budget, not the dispatch — the facts come back unknown, not thrown', async () => {
    wedged = true;
    const started = Date.now();
    // The registry would THROW specialist_context_timeout at 2000 ms and kill the ticket. The
    // reader's own budget has to win that race.
    const produced = facts(await append(OWNER));
    const elapsed = Date.now() - started;
    expect(elapsed, `append took ${elapsed}ms`).toBeLessThan(2000);
    expect(produced['facts.complete']).toBe(false);
    expect(produced['live.equity_today']).toBeNull();
    expect(produced['live.realized_today_net']).toBeNull();
    expect(Object.keys(produced).sort()).toEqual([...TRADING_SPECIALIST_FACT_KEYS].sort());
  });

  it('a store that fails outright degrades to unknown facts rather than a dead ticket', async () => {
    failing = true;
    const produced = facts(await append(OWNER));
    expect(produced['facts.complete']).toBe(false);
    expect(produced['books.live']).toBe(0);
    expect(produced['live.present']).toBe(false);
    expect(produced['live.equity_today']).toBeNull();
    expect(produced['live.realized_today_net']).toBeNull();
    expect(Object.keys(produced).sort()).toEqual([...TRADING_SPECIALIST_FACT_KEYS].sort());
  });

  it('a user with no books at all answers "no books", completely', async () => {
    store[OWNER.sub].books = [];
    const produced = facts(await append(OWNER));
    expect(produced['facts.complete']).toBe(true);
    expect(produced['books.live']).toBe(0);
    expect(produced['books.paper']).toBe(0);
    expect(produced['books.unreported']).toBe(0);
    expect(produced['live.present']).toBe(false);
    expect(produced['live.equity_today']).toBeNull();
  });

  it('stops at its own budget when the caller has already run out of time', async () => {
    latencyMs = 30;
    const produced = await readTradingBookFacts(ctx, { sub: OWNER.sub }, { budgetMs: 40 });
    expect(produced['facts.complete']).toBe(false);
    expect(Object.keys(produced).sort()).toEqual([...TRADING_FACT_KEYS].sort());
  });
});
