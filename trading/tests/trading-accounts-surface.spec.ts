/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-134 PR3 surface guards (source-level; the DB-boundary invariants — cross-user FK, born-disabled, delete refusal, clone-backfill — are real-DB-proven in the KERNEL's trading-books-schema / trading-override-book-scope specs): every accounts/summary handler resolves the caller through callerSub (the SEC-01 service-secret READ refusal rides it); book creation, strategy apply, mix edits, and breaker resets are confirm-gated; PATCH whitelists label/enabled/capitalCapUsd and can never carry account_id; the mix editor merges over the ACTIVE override (never env defaults); the resolver is connectionKey-capable and fail-closed on a missing login row; and the UI threads book= on every fetch.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-134 pin retirement pin: the summary's double-count guard must not read SCHWAB_ACCOUNT_NUMBER (nor any other env pin) - it is derived from the legacy live book's own account_id and the discovered-account count, so a login with several accounts can never have one of them silently substituted for another.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

describe('accounts/summary surface — auth + confirm posture', () => {
  const accounts = src('src-routes/trading-accounts-routes.ts');

  it('every handler resolves the caller via callerSub (SEC-01 read-refusal rides it) — no handler skips auth', () => {
    const handlers = accounts.match(/router\.(get|post|patch|delete)\(/g) || [];
    const subChecks = accounts.match(/const s = sub\(req, res\); if \(!s\) return;/g) || [];
    expect(handlers.length).toBeGreaterThanOrEqual(10);
    expect(subChecks.length, 'every route must resolve + 401-gate the caller').toBe(handlers.length);
  });

  it('book creation, strategy apply, mix edits and breaker resets are confirm-gated (428)', () => {
    const gates = accounts.match(/confirm !== true|confirm_required/g) || [];
    expect(gates.length).toBeGreaterThanOrEqual(6);
  });

  it('PATCH can never carry account_id — the binding is immutable at every layer', () => {
    expect(accounts).not.toMatch(/account_id[^\n]*UPDATE|UPDATE[^\n]*account_id/i);
    expect(accounts).toContain('NEVER account_id');
  });

  it('the mix editor merges over the ACTIVE override, never bare env defaults', () => {
    expect(accounts).toContain('getActiveOverride(ctx.pool, s, book.bookId)');
    expect(accounts).toContain("strategyName: 'manual-mix'");
  });

  it('the summary day-change can be null (n/a) — never fabricated as 0', () => {
    expect(accounts).toContain('dayChange = prior != null && account.equity > 0 ? account.equity - prior : null');
  });
});

describe('resolver — connectionKey-capable, fail-closed (ADR-134 D5.6)', () => {
  const entry = src('src-routes/trading-routes.ts');

  it('registers a 3-arg resolver (the core factory checks Function.length for bound books)', () => {
    expect(entry).toMatch(/registerSchwabTokenResolver\(async \(_mode, sub, connectionKey\)/);
  });

  it('a bound book whose login connection is gone gets NO token — never another login’s token', () => {
    expect(entry).toContain('if (!row) return null;');
  });
});

describe('the switcher actually switches — UI threads book= on every fetch (ADR-136: runtime lives in tools/ui/app.js)', () => {
  const app = src('tools/ui/app.js');
  const html = src('tools/trading.html');

  it('api() carries book= in the query AND injects book+mode into JSON bodies (the 2026-09-03 paper-routing class)', () => {
    expect(app).toContain("'&mode=' + MODE");
    expect(app).toMatch(/book=' \+ encodeURIComponent\(BOOK\)/);
    expect(app).toContain('if (parsed.book === undefined) parsed.book = BOOK;');
    expect(app).toContain('if (parsed.mode === undefined) parsed.mode = MODE;');
  });

  it('the four top-level views exist in the shell and the router whitelists exactly them (+ account detail)', () => {
    for (const v of ['accounts', 'strategies', 'research', 'reports']) expect(html).toContain(`data-view="${v}"`);
    expect(app).toContain("const VIEWS = ['accounts','account','strategies','research','reports'];");
    // legacy ?tab= deep links keep working
    expect(app).toMatch(/summary:\['accounts', null\]/);
    expect(app).toMatch(/accounts:\['strategies','roster'\]/);
  });

  it('navigation clears the per-symbol cache and bumps the render token (no cross-account paint)', () => {
    expect(app).toMatch(/function navigate\([\s\S]{0,600}UNIVERSE = \{\}; CURRENT = null;[\s\S]{0,100}RENDER_TOKEN \+= 1;/);
  });
});

describe('no unbound broker readers — the wrong-balances class (operator-reported 2026-08-28)', () => {
  it('every account-data getBrokerReader call in src-routes carries a binding argument', () => {
    for (const f of ['src-routes/trading-routes-book-read-builders.ts', 'src-routes/trading-routes-order-flow-builders.ts', 'src-routes/trading-accounts-routes.ts']) {
      const text = src(f);
      // Two-arg reader calls are allowed ONLY for configured() capability probes; any call that
      // goes on to read account/positions/orders must pass the third (binding) argument, else a
      // non-legacy book renders the LEGACY account's balances (the /ledger bug).
      const twoArg = (text.match(/getBrokerReader\([^)]*\bsub\)(?!\.configured)/g) || [])
        .filter((m) => !/['"](paper|live)['"], sub\)$/.test(m));
      expect(twoArg, `${f} has unbound account-data reader calls: ${twoArg.join(' | ')}`).toEqual([]);
    }
  });

  it('/summary builds every reader from a LOADED book, never a list row (list rows omit the binding)', () => {
    const accounts = src('src-routes/trading-accounts-routes.ts');
    // The 2026-09-02 shape: the reader call HAD a binding argument, but the book came from
    // listBooks — whose rows carry accountNumber:null by design — so the binding was always
    // undefined and every live-kind book read the legacy account. The guard: inside the /summary
    // books loop the reader's book must come from loadBook.
    expect(accounts).toMatch(/for \(const listed of books\) \{[\s\S]{0,1200}?await loadBook\(ctx\.pool, s, listed\.bookId\)[\s\S]{0,800}?getBrokerReader\(book\.kind/);
    // And the corrected shape must NOT fall back to the list row (the ?? listed pattern is banned).
    expect(accounts).not.toMatch(/await loadBook\(ctx\.pool, s, listed\.bookId\)\)?\s*\?\?\s*listed/);
  });

  it('/ledger resolves the BOOK and keys its orders by book_id', () => {
    const flow = src('src-routes/trading-routes-order-flow-builders.ts');
    expect(flow).toMatch(/\/ledger[\s\S]{0,700}resolveBook\(/);
    expect(flow).toMatch(/\/ledger[\s\S]{0,1600}book_id=\$2 ORDER BY created_at DESC LIMIT 25/);
  });
});

describe('compiled twins are in lockstep with src-routes', () => {
  it('the built routes/ twins carry the ADR-134 markers', () => {
    expect(src('routes/trading-accounts-routes.js')).toContain('reset-breaker');
    expect(src('routes/trading-routes.js')).toContain('connectionKey');
    expect(src('routes/trading-routes-book-read-builders.js')).toContain('book_id=$2');
  });
});

describe('summary double-count guard - derived from the books/accounts rows, never an env pin', () => {
  const accounts = src('src-routes/trading-accounts-routes.ts');

  it('nothing in this surface reads SCHWAB_ACCOUNT_NUMBER (the retired account pin)', () => {
    expect(accounts).not.toContain('process.env.SCHWAB_ACCOUNT_NUMBER');
    expect(accounts).not.toContain('envPinLast4');
  });

  it('the skip is the two real facts: an UNBOUND legacy live book and exactly one discovered account', () => {
    expect(accounts).toContain("ref = 'live' AND account_id IS NULL");
    expect(accounts).toContain("broker = 'schwab'");
    expect(accounts).toMatch(/legacyLiveUnbound && schwabAccountCount === 1/);
    expect(accounts).toContain('if (legacyRowCoversTheOnlyAccount) continue;');
  });
});
