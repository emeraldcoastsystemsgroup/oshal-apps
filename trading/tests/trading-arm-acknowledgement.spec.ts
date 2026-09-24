/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the package half of the BACKLOG entry "Arming a second autopilot leg is a deliberate, gated act". Source-level, on this package's documented split: the DB-boundary behaviour (a leg for an unacknowledged book fires nothing; the acknowledgement is what lets it through) is proven against a real disposable PostgreSQL in the KERNEL's tests/unit/trading-arm-acknowledgement.spec.ts, and what is left here is a surface contract — the route exists, resolves its caller, is 428-gated on the way IN and ungated on the way OUT, delegates to the core store rather than writing lifecycle SQL of its own, and the operator-facing copy states what an armed leg actually does. The copy assertions read ONLY the acknowledgeArming() body, sliced between its own markers, so a Change Log line describing a correction can never be what satisfies (or trips) them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

/**
 * @description Slice one function's body out of a source file so an assertion about COPY cannot be
 * satisfied by a comment, a Change Log line or another function that happens to use the same words.
 * @param source - The whole file.
 * @param signature - The exact declaration line the function starts with.
 * @returns Everything from that declaration to the first line-start closing brace after it.
 */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is not in this file`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end, `${signature} has no closing brace`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('POST /accounts/books/:bookId/arm-ack — the deliberate act, not a field on PATCH', () => {
  const accounts = src('src-routes/trading-accounts-routes.ts');

  it('the route exists and resolves its caller like every sibling handler', () => {
    expect(accounts).toContain("router.post('/accounts/books/:bookId/arm-ack'");
    const handlers = accounts.match(/router\.(get|post|patch|delete)\(/g) || [];
    const subChecks = accounts.match(/const s = sub\(req, res\); if \(!s\) return;/g) || [];
    expect(subChecks.length, 'every route must resolve + 401-gate the caller').toBe(handlers.length);
  });

  it('RECORDING is confirm-gated (428); WITHDRAWING is not, because it can only stop a leg', () => {
    const body = bodyOf(accounts, "  router.post('/accounts/books/:bookId/arm-ack'");
    expect(body).toContain('const acknowledge = b.acknowledge !== false;');
    expect(body).toMatch(/if \(acknowledge && b\.confirm !== true\)/);
    expect(body).toContain("error: 'confirm_required'");
  });

  it('delegates to the CORE store — no lifecycle SQL of its own (adversarial-review rule)', () => {
    expect(accounts).toContain('recordArmAck, requiresArmAcknowledgement,');
    const body = bodyOf(accounts, "  router.post('/accounts/books/:bookId/arm-ack'");
    expect(body).toContain('await recordArmAck(ctx.pool, s, String(req.params.bookId), acknowledge, s,');
    expect(body).not.toMatch(/UPDATE\s+oshal_trading_books/i);
  });

  it('the roster says which books carry the gate, using the CORE predicate — never a local re-derivation', () => {
    expect(accounts).toContain('armAckRequired: requiresArmAcknowledgement(b), armAckAt: b.armAckAt ?? null, armAckBy: b.armAckBy ?? null,');
  });
});

describe('the operator-facing copy states what an armed leg actually does', () => {
  const strategies = src('tools/ui/view-strategies.js');
  const arming = bodyOf(strategies, 'async function acknowledgeArming(bookId) {');

  it('says plainly that an unacknowledged account fires nothing', () => {
    expect(arming).toMatch(/fires NOTHING/);
  });

  it('names the live exposure an armed leg brings: buying with this account’s idle cash', () => {
    expect(arming).toMatch(/It BUYS\./);
    expect(arming).toMatch(/idle cash/);
  });

  it('names the pinned-lot GTC sells, which a hand-picked position does NOT get a pass from', () => {
    expect(arming).toMatch(/REAL GTC sell orders at the venue/);
  });

  it('states the ADR-159 truth about a hand-picked position — not the pre-ADR-159 claim', () => {
    // The correction this entry needed: before ADR-159 a hand-picked name WAS rotation-sold. Copy
    // still saying so would be wrong, so the assertion is on the statement, not on an absence.
    expect(arming).toMatch(/NOT sold, trimmed or topped up by rotation/);
    expect(arming).toMatch(/manages only what its own filled orders account for/);
    expect(arming).toMatch(/marked unmanaged/);
    // and it must not promise a ring-fence the engine does not give: the holding still counts.
    expect(arming).toMatch(/counts toward exposure, the capital cap and the drawdown breaker/);
  });

  it('withdrawal is offered, and says what it stops', () => {
    expect(arming).toMatch(/Withdraw the autopilot arming/);
    expect(arming).toMatch(/no rotation buys, no pinned-lot exits/);
  });

  it('enabling an account no longer implies a leg will fire for it', () => {
    const toggle = bodyOf(strategies, 'async function toggleBook(bookId, enable) {');
    expect(toggle).toContain('bk.armAckRequired && !bk.armAckAt');
    expect(toggle).toMatch(/NOT armed/);
  });
});

describe('the account header offers the act only where the gate exists', () => {
  const account = src('tools/ui/view-account.js');

  it('the button is painted from the server’s armAckRequired, not from the ref', () => {
    expect(account).toContain("const armack = (b && b.bookId && b.armAckRequired)");
    expect(account).toContain('data-act="armack"');
    expect(account).toContain("+ toggle + armack +");
  });

  it('the delegated header listener routes it to acknowledgeArming', () => {
    expect(account).toContain("if (act === 'armack') { const bk = bookOf(BOOK); if (bk && bk.bookId) acknowledgeArming(bk.bookId); return; }");
  });
});
