/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-136 D3 source guards for the direct-trade route: the operator decision is book-scoped QUERY-FIRST (the 2026-09-03 paper-routing class), writes book_id on both the signal and the decision (never trigger-derived from mode), refuses a BUY on a view-only book before any venue work, pre-checks the same guardrails the engine enforces, only ever mints agent_id 'operator', and the surface reaches the venue ONLY through the existing POST /orders (no second order path). Plus the static UI mount is inside the auth-gated router and no-cache.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

describe('direct trades — POST /decisions/manual (ADR-136 D3)', () => {
  const route = src('src-routes/trading-manual-order-routes.ts');

  it('resolves the book QUERY-first, then body — never body-only (the paper-routing class)', () => {
    expect(route).toMatch(/resolveBook\(ctx\.pool, sub, \(req\.query\.book as string \| undefined\) \?\? b\.book/);
    expect(route).not.toMatch(/resolveBook\(ctx\.pool, sub, b\.book/);
  });

  it('writes book_id explicitly on the signal AND the decision (trigger-derived book_id lands on the wrong book)', () => {
    expect(route).toMatch(/INSERT INTO oshal_trading_signals \(user_sub, mode, book_id,/);
    expect(route).toMatch(/INSERT INTO oshal_trading_decisions\s*\(user_sub, mode, book_id,/);
    expect(route).toMatch(/ON CONFLICT \(user_sub, book_id, content_hash\)/);
  });

  it('a MANUAL buy is allowed regardless of the autopilot flag — the route no longer refuses a view-only buy (2026-09-04)', () => {
    // "enabled" gates the AUTOPILOT, not the operator: a human clicking Buy is explicit. The route
    // must NOT block a manual buy on a disabled book; the engine refuses only AUTONOMOUS buys there.
    expect(route).not.toMatch(/res\.status\(409\)\.json\(\{ error: 'book_disabled'/);
    expect(route).toContain('A manual buy is the operator\'s explicit action');
  });

  it('pre-checks the engine guardrails and returns 422 guardrail_blocked with the reason', () => {
    expect(route).toContain('guardrailViolation(g, symbol, qty, refPrice ?? 0)');
    expect(route).toMatch(/422[\s\S]{0,60}guardrail_blocked/);
  });

  it('only ever mints an operator-authored decision, sized in whole shares', () => {
    expect(route).toMatch(/'operator'/);
    expect(route).not.toMatch(/agent_id[^\n]*'algo-ensemble'/);
    expect(route).toContain('qty = Math.floor(notional / refPrice)');
    expect(route).toContain('!Number.isInteger(qty) || qty < 1');
  });

  it('never places at the venue itself — execution stays on POST /orders (one order path)', () => {
    expect(route).not.toMatch(/placeDecisionOrder|getBrokerAdapter|placeOrder\(/);
  });

  it('every order type the venue supports is accepted and price-shape-validated', () => {
    expect(route).toContain("['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']");
    for (const t of ['limit', 'stop', 'stop_limit', 'trailing_stop']) expect(route).toMatch(new RegExp(`type === '${t}'`));
    expect(route).toContain("tif !== 'day' && tif !== 'gtc'");
  });
});

describe('the split surface is served inside the auth-gated router (ADR-136 D2)', () => {
  const entry = src('src-routes/trading-routes.ts');

  it('mounts tools/ui as static on the trading router (service-or-oidc), no-cache, no directory index', () => {
    expect(entry).toMatch(/router\.use\('\/ui', serveStatic\(path\.join\(apiDir, 'ui'\)/);
    expect(entry).toContain("res.setHeader('Cache-Control', 'no-cache')");
    expect(entry).toContain('index: false');
  });

  it('registers the direct-trade routes', () => {
    expect(entry).toContain('registerTradingManualOrderRoutes(router, ctx);');
  });

  it('the UI calls the direct-trade contract (ticket → /decisions/manual → /orders)', () => {
    const ticket = src('tools/ui/ticket.js');
    expect(ticket).toContain("'/decisions/manual'");
    expect(ticket).toContain("'/orders'");
    expect(ticket).toMatch(/STATUS\.bookEnabled === false/);
  });

  it('every surface order path reads the ORDER object (not the {ok, order} envelope) and mints ONE requestId per decision', () => {
    // 2026-09-03 review: the ticket read r.status on the envelope (a REJECTED order rendered "submitted")
    // and minted 'tkt-' + Date.now() per click (a retry after a lost response double-submitted at the venue).
    const ticket = src('tools/ui/ticket.js');
    expect(ticket).toMatch(/j\.order/);
    expect(ticket).not.toMatch(/requestId: 'tkt-' \+ Date\.now\(\)/);
    expect(ticket).toMatch(/String\(j\.decisionId\)\.slice\(0, 8\)/);
    const shared = src('tools/ui/shared-positions.js');
    expect(shared).toMatch(/'foc-' \+ String\(d\.decisionId\)\.slice\(0, 8\)/);
    expect(shared).not.toMatch(/'foc-' \+ Date\.now\(\)/);
    const research = src('tools/ui/view-research.js');
    expect(research).toMatch(/'cap-' \+ String\(decisionId\)\.slice\(0, 8\)/);
    expect(research).not.toMatch(/Math\.random\(\)\.toString\(36\)/);
  });

  it('sizing is shares OR dollars — never both silently resolved', () => {
    expect(src('src-routes/trading-manual-order-routes.ts')).toContain("error: 'size_ambiguous'");
  });
});
