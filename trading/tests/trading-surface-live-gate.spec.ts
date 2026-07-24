/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — created WITH the trading
 *                     |                             | carve (ADR-085 Wave 3) so the surface's route-level
 *                     |                             | live gates keep a named source guard after leaving
 *                     |                             | the kernel's risky-write-guards.spec.ts. The ENGINE's
 *                     |                             | env-level live_blocked gate (placeDecisionOrder,
 *                     |                             | TRADING_LIVE_ENABLED + explicit confirm) stays
 *                     |                             | kernel-guarded in that spec at its surviving owner
 *                     |                             | (src/app/trading-engine.ts); THIS spec pins the
 *                     |                             | packaged surface's own gates verbatim.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

describe('trading surface live gates (carved WITH the app — coverage never dropped)', () => {
  it('POST /trigger parks LIVE tickets in backlog behind the approval gate', () => {
    const trading = source('src-routes/trading-routes.ts');
    // The route-level autonomy gate (ADR-052/053): paper auto-approves, live waits for a human.
    expect(trading).toContain("status: mode === 'paper' ? 'approved' : 'backlog'");
    expect(trading).toContain("note: 'Live trades require approval");
    // The paper inline loop must never pass a live confirm.
    expect(trading).toContain('placeDecisionOrder(ctx.pool, sub, mode, decisionId, ticket.ticketId, false)');
  });

  it('POST /orders only forwards an EXPLICIT boolean confirm to the kernel engine gate', () => {
    const orderFlow = source('src-routes/trading-routes-order-flow-builders.ts');
    // The engine (kernel: src/app/trading-engine.ts) enforces live_blocked off TRADING_LIVE_ENABLED
    // + confirm===true; the packaged surface must hand it the strict boolean, never a truthy coercion.
    expect(orderFlow).toContain('b.confirm === true');
    expect(orderFlow).toContain("from '@/app/trading-engine'");
  });

  it('strategy apply keeps its confirm guard (changes what the autopilot trades)', () => {
    const lab = source('src-routes/trading-strategy-lab-routes.ts');
    expect(lab).toContain("error: 'confirm_required'");
    expect(lab).toContain('b.confirm !== true');
  });
});
