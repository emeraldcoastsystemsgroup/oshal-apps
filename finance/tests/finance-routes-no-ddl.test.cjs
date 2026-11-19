/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Regression guard for finance/BACKLOG.md Entry A: request paths in finance-routes never run DDL or schema bootstrap, and ensureFinanceSchema checks catalog metadata first on PostgreSQL pools and tolerates lock_timeout without holding a pool connection.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');
const DDL_PATTERN = /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|POLICY|SCHEMA|EXTENSION)\b/i;

function loadFinanceModule(pool, bootstrapHook) {
    const handlers = {};
    const record = (verb) => (route, handler) => { handlers[`${verb} ${route}`] = handler; };
    const doubles = {
        express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
        '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
        '@/shared/services/database': {
            runRuntimeSchemaBootstrap: bootstrapHook,
            buildOwnerRlsPolicyStatements: (table, col) => [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY -- ${col}`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`],
        },
        '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
        '@/features/payments': { getPaymentAdapter: () => ({ provider: 'stripe', configured: () => true, isTestMode: () => true, createTransfer: async () => ({ id: 'tr-1', provider: 'stripe', amountCents: 500, currency: 'usd', status: 'succeeded' }), getTransfer: async () => ({ id: 'tr-1', status: 'succeeded' }) }) },
        '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '## Commentary\nSteady balances.' }) },
        '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
        '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({ confirm: true }), hasExplicitWriteConfirmation: (b) => b?.confirm === true },
        './finance-plaid': {
            plaidConfigured: () => true,
            plaidEnv: () => 'sandbox',
            createLinkToken: async () => 'link-tok',
            exchangePublicToken: async () => ({ itemId: 'item-1', institution: 'Fixture Bank', accessToken: 'vault:1' }),
            createSandboxItem: async () => ({ itemId: 'item-sbx', institution: 'Sandbox Bank', accessToken: 'vault:2' }),
            removeItem: async () => ({ providerDisconnected: true }),
            fetchFinanceAggregate: async () => ({ generatedAt: '2026-11-18T00:00:00Z', sourceEnvironment: 'sandbox', currency: 'USD', balancesComplete: true, transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 0, total: 0, institutions: [{ institution: 'Fixture Bank', state: 'complete', returned: 0, total: 0, pages: 1, reason: null }] }, netWorth: { assets: 100, liabilities: 0, net: 100 }, accounts: [{ name: 'Checking', institution: 'Fixture Bank', type: 'depository', balance: 100, currency: 'USD' }], holdings: [], topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: 90, notes: [] }),
        },
        './session-crypto': { encryptSessionValue: (v) => v, decryptSessionValue: (v) => v },
    };
    const original = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent && parent.filename === ROUTES && request in doubles) return doubles[request];
        return original.call(this, request, parent, isMain);
    };
    let mod;
    try {
        delete require.cache[ROUTES];
        mod = require(ROUTES);
        mod.createFinanceRoutes({ pool, appPackageDir: ROOT });
    } finally {
        Module._load = original;
        delete require.cache[ROUTES];
    }
    return { mod, handlers };
}

function recordingRequestPool() {
    const statements = [];
    const savedRow = {
        has_data: true,
        has_brief: true,
        synced_at: '2026-11-18T00:00:00Z',
        brief_at: '2026-11-18T00:01:00Z',
        aggregate: { generatedAt: '2026-11-18T00:00:00Z', sourceEnvironment: 'sandbox', currency: 'USD', balancesComplete: true, transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 0, total: 0, institutions: [{ institution: 'Fixture Bank', state: 'complete', returned: 0, total: 0, pages: 1, reason: null }] }, netWorth: { assets: 100, liabilities: 0, net: 100 }, accounts: [{ name: 'Checking', institution: 'Fixture Bank', type: 'depository', balance: 100, currency: 'USD' }], holdings: [], topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: 90, notes: [] },
        brief: '## Saved\nFixture brief.',
    };
    return {
        statements,
        async query(arg, values = []) {
            const sql = typeof arg === 'string' ? arg : arg.text;
            assert.doesNotMatch(sql, DDL_PATTERN, `request issued forbidden DDL: ${sql}`);
            statements.push({ sql, values: typeof arg === 'string' ? values : arg.values });
            if (/SELECT COUNT/i.test(sql)) return { rows: [{ n: 1, count: 1 }], rowCount: 1 };
            if (/FROM oshal_finance_items/i.test(sql)) return { rows: [{ item_id: 'item-1', user_sub: 'alice', institution: 'Fixture Bank', access_token: 'vault:1', linked_at: '2026-11-18T00:00:00Z' }], rowCount: 1 };
            if (/UPDATE oshal_finance_data SET brief/i.test(sql)) return { rows: [{ brief_at: '2026-11-18T00:05:00Z' }], rowCount: 1 };
            if (/FROM oshal_finance_data/i.test(sql)) return { rows: [savedRow], rowCount: 1 };
            if (/FROM oshal_finance_payments/i.test(sql)) return { rows: [{ transfer_id: 'tr-1' }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        },
    };
}

async function invoke(handler, { body = {}, query = {}, params = {}, headers = {} } = {}) {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, body, query, params, get: (h) => headers[h.toLowerCase()] }, res);
    return res;
}

test('no HTTP request handler in finance-routes runs schema bootstrap or issues any DDL statement', async () => {
    const pool = recordingRequestPool();
    const { handlers } = loadFinanceModule(pool, async () => {
        assert.fail('HTTP request handlers must never invoke runRuntimeSchemaBootstrap');
    });
    const prevDemo = process.env.FINANCE_DEMO_DATA;
    process.env.FINANCE_DEMO_DATA = '1';
    try {
        const calls = [
            ['GET /status', {}],
            ['GET /summary', {}],
            ['GET /brief', {}],
            ['GET /brief', { query: { cached: '1' } }],
            ['GET /brief/analysis', {}],
            ['GET /pay-status', {}],
            ['GET /pay/:transferId', { params: { transferId: 'tr-1' } }],
            ['GET /payments', {}],
            ['POST /link-token', {}],
            ['POST /exchange', { body: { publicToken: 'pub-tok' } }],
            ['POST /link-sandbox', { body: {} }],
            ['POST /demo-data', { body: {} }],
            ['POST /sync', { body: {} }],
            ['POST /brief/refresh', { body: {} }],
            ['POST /review', { body: { confirm: true, title: 'Lease', notes: 'Monthly rent check' } }],
            ['POST /pay', { body: { amountCents: 500, source: 'src_1', requestId: 'req-1', confirm: true } }],
            ['DELETE /items/:itemId', { params: { itemId: 'item-1' } }],
        ];
        for (const [route, opts] of calls) {
            const res = await invoke(handlers[route], opts);
            assert.ok(res.statusCode >= 200 && res.statusCode < 300, `${route} returned unexpected status ${res.statusCode}: ${JSON.stringify(res.body)}`);
        }
        assert.ok(pool.statements.length >= 12, 'routes exercised real data queries');
        assert.equal(pool.statements.some((s) => DDL_PATTERN.test(s.sql)), false);
    } finally {
        if (prevDemo === undefined) delete process.env.FINANCE_DEMO_DATA;
        else process.env.FINANCE_DEMO_DATA = prevDemo;
    }
});

test('ensureFinanceSchema issues zero DDL on PostgreSQL when the catalog already matches all four stores and forced RLS', async () => {
    const queries = [];
    let connectCount = 0;
    const expectedColumns = [
        ['oshal_finance_items', ['item_id', 'user_sub', 'institution', 'access_token', 'linked_at']],
        ['oshal_finance_data', ['user_sub', 'aggregate', 'brief', 'synced_at', 'brief_at']],
        ['oshal_finance_analysis', ['user_sub', 'run_id', 'state', 'snapshot', 'requested_at', 'finished_at', 'failure']],
        ['oshal_finance_payments', ['transfer_id', 'user_sub', 'provider', 'amount_cents', 'currency', 'payee', 'description', 'status', 'raw_status', 'test_mode', 'created_at', 'updated_at']],
    ];
    const pgPool = {
        async query(sql, values = []) {
            queries.push({ sql: String(sql), values });
            if (/information_schema\.columns/i.test(sql)) {
                const rows = [];
                for (const [table_name, cols] of expectedColumns) {
                    for (const column_name of cols) rows.push({ table_name, column_name });
                }
                return { rows };
            }
            if (/pg_class/i.test(sql)) {
                return { rows: expectedColumns.map(([relname]) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })) };
            }
            return { rows: [] };
        },
        async connect() {
            connectCount++;
            return { async query() { return { rows: [] }; }, release() {} };
        },
    };
    const { mod } = loadFinanceModule({ query: async () => ({ rows: [] }) }, async () => {
        assert.fail('matching PostgreSQL catalog must not run DDL bootstrap');
    });
    await mod.ensureFinanceSchema(pgPool);
    await mod.ensureFinanceSchema(pgPool);
    assert.equal(connectCount, 0, 'no DDL transaction client checked out when schema matches');
    assert.equal(queries.some((q) => DDL_PATTERN.test(q.sql)), false, 'zero DDL statements issued');
    assert.equal(queries.filter((q) => /information_schema\.columns/i.test(q.sql)).length, 1, 'second call on verified pool skips catalog query');
});

test('ensureFinanceSchema sets a bounded lock_timeout on PostgreSQL and skips cleanly when a concurrent lock holds the table', async () => {
    const clientQueries = [];
    let released = 0;
    const pgPool = {
        async query(sql) {
            if (/information_schema\.columns/i.test(sql)) return { rows: [] };
            if (/pg_class/i.test(sql)) return { rows: [] };
            return { rows: [] };
        },
        async connect() {
            return {
                async query(sql) {
                    clientQueries.push(String(sql));
                    if (DDL_PATTERN.test(String(sql))) {
                        const err = new Error('canceling statement due to lock timeout');
                        err.code = '55P03';
                        throw err;
                    }
                    return { rows: [] };
                },
                release() { released++; },
            };
        },
    };
    const { mod } = loadFinanceModule({ query: async () => ({ rows: [] }) }, async () => {});
    await assert.doesNotReject(mod.ensureFinanceSchema(pgPool));
    assert.equal(released, 1, 'checked-out client is released immediately on lock timeout');
    assert.ok(clientQueries.some((q) => /SET LOCAL lock_timeout/i.test(q)), 'DDL runs under bounded lock_timeout');
    assert.ok(clientQueries.some((q) => /^ROLLBACK$/i.test(q.trim())), 'failed lock acquisition rolls back cleanly');
});
