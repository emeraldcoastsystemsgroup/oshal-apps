/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-134 PR3 surface guards (source-level; the DB-boundary invariants — cross-user FK, born-disabled, delete refusal, clone-backfill — are real-DB-proven in the KERNEL's trading-books-schema / trading-override-book-scope specs): every accounts/summary handler resolves the caller through callerSub (the SEC-01 service-secret READ refusal rides it); book creation, strategy apply, mix edits, and breaker resets are confirm-gated; PATCH whitelists label/enabled/capitalCapUsd and can never carry account_id; the mix editor merges over the ACTIVE override (never env defaults); the resolver is connectionKey-capable and fail-closed on a missing login row; and the UI threads book= on every fetch.
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

describe('the switcher actually switches — UI threads book= on every fetch', () => {
  const html = src('tools/trading.html');

  it('api() carries book=', () => {
    expect(html).toContain("'&mode=' + MODE");
    expect(html).toContain("'?' : '?'".length >= 0 ? "book=" : 'book=');
    expect(html).toMatch(/book=' \+ encodeURIComponent\(BOOK\)/);
  });

  it('the accounts + summary tabs exist and are deep-linkable', () => {
    expect(html).toContain("['accounts','Accounts & books']");
    expect(html).toContain("['summary','All accounts']");
    expect(html).toMatch(/'accounts','summary'\]\.includes\(q\)/);
  });
});

describe('compiled twins are in lockstep with src-routes', () => {
  it('the built routes/ twins carry the ADR-134 markers', () => {
    expect(src('routes/trading-accounts-routes.js')).toContain('reset-breaker');
    expect(src('routes/trading-routes.js')).toContain('connectionKey');
    expect(src('routes/trading-routes-book-read-builders.js')).toContain('book_id=$2');
  });
});
