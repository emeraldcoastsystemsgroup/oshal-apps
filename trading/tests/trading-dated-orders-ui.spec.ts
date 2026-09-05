/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-136 D4 timed orders, the store half: the route converts + validates fireAtEt through the KERNEL at parse time (nothing written on a refusal), ensures the trading-events leg BEFORE the mint for a timed order, records a kernel dated-order row and never places at the venue itself; the ticket sends fireAtEt only for 'At a time', confirms a LIVE timed order BEFORE the mint (there is no Place step), and skips POST /orders when the server answers `dated`; the account page carries the Timed orders card with Cancel. Source pins — the behaviour itself is proven by the kernel's real-DB spec (tests/unit/trading-dated-orders.spec.ts in core).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

describe('timed orders — POST /decisions/manual fireAtEt (ADR-136 D4)', () => {
  const route = src('src-routes/trading-manual-order-routes.ts');

  it('converts and validates the fire time through the kernel at PARSE time, so a bad time is a 400 with nothing written', () => {
    expect(route).toContain("from '@/app/trading-dated-orders'");
    expect(route).toMatch(/fireAt = etWallToInstant\(String\(b\.fireAtEt\.date \|\| ''\), String\(b\.fireAtEt\.time \|\| ''\)\); validateFireAt\(fireAt\);/);
    expect(route).toContain("'fire_at_invalid'");
    // parse happens before resolveBook/mint in the handler
    expect(route.indexOf('const parsed = parseManualBody(b);')).toBeLessThan(route.indexOf('const minted = await mintManualDecision('));
  });

  it('ensures the trading-events leg BEFORE the mint for a timed order (a timed order with no leg would never fire)', () => {
    const ensureAt = route.indexOf('if (parsed.v.fireAt) await ensureEventSchedule(sub);');
    expect(ensureAt).toBeGreaterThan(0);
    expect(ensureAt).toBeLessThan(route.indexOf('const sized = await sizeManualOrder('));
    expect(ensureAt).toBeLessThan(route.indexOf('const minted = await mintManualDecision('));
  });

  it('records a kernel dated-order row for the minted decision and answers `dated` with the fire time in words', () => {
    expect(route).toMatch(/const dated = parsed\.v\.fireAt \? await createDatedOrder\(ctx\.pool, sub, \{ book, decisionId: minted\.decisionId, symbol, side, qty: sized\.qty, orderType: type, fireAt: parsed\.v\.fireAt \}\) : null;/);
    expect(route).toContain('dated: dated ? withFireWords(dated) : null,');
    expect(route).toContain('fireAtWords: formatEt(new Date(d.fireAt))');
  });

  it('a protected timed entry hands the fire time to the lot as notBefore (the 2-day unfilled release counts from then)', () => {
    expect(route).toContain('notBefore: v.fireAt ?? undefined');
  });

  it('still never places at the venue itself — the leg fires it through the engine', () => {
    expect(route).not.toMatch(/placeDecisionOrder|getBrokerAdapter|placeOrder\(/);
  });

  it('GET /dated (book-scoped, query-first) and POST /dated/:id/cancel exist and map TradingError codes', () => {
    expect(route).toContain("router.get('/dated'");
    expect(route).toContain("router.post('/dated/:id/cancel'");
    expect(route).toMatch(/router\.get\('\/dated'[\s\S]{0,400}resolveBook\(ctx\.pool, sub, \(req\.query\.book as string \| undefined\)/);
    expect(route).toContain('cancelDatedOrder(ctx.pool, sub, String(req.params.id))');
  });
});

describe('timed orders — the ticket (tools/ui/ticket.js)', () => {
  const tkt = src('tools/ui/ticket.js');

  it('carries when/fireDate/fireTime state and sends fireAtEt ONLY for "At a time"', () => {
    expect(tkt).toContain("when: 'now', fireDate: '', fireTime: ''");
    expect(tkt).toContain("if (TKT.when === 'at') body.fireAtEt = { date: TKT.fireDate, time: TKT.fireTime };");
  });

  it('validates the fire time client-side with the same rules as the kernel (trading day, 9:00–4:55 PM ET, 5-minute grid, future)', () => {
    expect(tkt).toContain('return tktPriceError() || tktProtError() || tktWhenError();');
    expect(tkt).toContain("'Timed orders fire on trading days (Monday to Friday).'");
    expect(tkt).toContain("'Timed orders fire between 9:00 AM and 4:55 PM Eastern.'");
    expect(tkt).toMatch(/Number\(hm\[1\]\) % 5 !== 0/);
    expect(tkt).toContain("timeZone: 'America/New_York'");
  });

  it('a LIVE timed order confirms BEFORE the mint (the mint is the commitment — there is no Place step)', () => {
    const confirmAt = tkt.indexOf("if (timed && MODE === 'live' && !confirm('Schedule a LIVE order on '");
    expect(confirmAt).toBeGreaterThan(0);
    expect(confirmAt).toBeLessThan(tkt.indexOf("j = await api('/decisions/manual', jbody('POST', tktBody()));"));
  });

  it('when the server answers `dated`, step 3 shows Scheduled and never calls POST /orders for it', () => {
    expect(tkt).toContain("if (j.dated) { t.result = { ok: true, status: 'scheduled'");
    expect(tkt).toContain("if (r.status === 'scheduled') return");
    // the scheduled result is not "bad", so the actions are Place another / Close — never a Place button
    expect(tkt).toContain("return !r || r.ok === false || /reject|fail|error|block|refus|cancel/i.test(String(r.status || ''));");
    expect(tkt).toContain('quiet(typeof loadDatedCard === \'function\' ? () => loadDatedCard(RENDER_TOKEN) : null);');
  });

  it('the date/time inputs are on the 5-minute grid inside the window (step=300, min 09:00, max 16:55)', () => {
    expect(tkt).toContain('type="time" step="300" min="09:00" max="16:55"');
  });
});

describe('timed orders — the account page card (tools/ui/view-account.js)', () => {
  const va = src('tools/ui/view-account.js');

  it('hosts the Timed orders card, loads it per paint, and resets it when the account changes', () => {
    expect(va).toContain('<div id="datedCard"></div>');
    expect(va).toContain('loadDatedCard(token);');
    expect(va).toContain('ACCT_DATED = [];');
    expect(va).toContain("j = await api('/dated');");
  });

  it('Cancel resolves the row from the model (never an onclick string), confirms by name, and only pending rows offer it', () => {
    expect(va).toContain("const b = e.target.closest('button[data-dated]');");
    expect(va).toContain("r.status === 'pending' ? '<button class=\"btn ghost sm\" data-dated=\"'");
    expect(va).toMatch(/confirm\('Cancel the timed order '/);
    expect(va).toContain("api('/dated/' + encodeURIComponent(id) + '/cancel', jbody('POST', {}))");
  });
});
