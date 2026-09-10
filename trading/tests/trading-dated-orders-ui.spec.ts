/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-136 D4 timed orders, the store half: the route converts + validates fireAtEt through the KERNEL at parse time (nothing written on a refusal), ensures the trading-events leg BEFORE the mint for a timed order, records a kernel dated-order row and never places at the venue itself; the ticket sends fireAtEt only for 'At a time', confirms a LIVE timed order BEFORE the mint (there is no Place step), and skips POST /orders when the server answers `dated`; the account page carries the Timed orders card with Cancel. Source pins — the behaviour itself is proven by the kernel's real-DB spec (tests/unit/trading-dated-orders.spec.ts in core).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D4 follow-up, the store half of the minute-precision kernel: the route pins now require the ORDER SHAPE on BOTH kernel calls (validateFireAt fails closed without it — a shapeless call refuses every pre/post-market time, so the pin is what keeps the surface usable) and that ensureEventSchedule compares the stored cron/timezone with EVENT_PLANS_CRON/EVENT_PLANS_TIMEZONE so a leg on the retired 5-minute cron is re-created rather than reused; the ticket pins drop the 5-minute grid, carry the 7:00 AM–7:59 PM window and the pre/post-market rule echo, and pin the input as step=60 min=07:00 max=19:59; a new pin proves the ticket can never OFFER a minute the kernel refuses (its input bounds are inside the kernel's own default window). The account card's footnote is pinned to the same words.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Review follow-up: pin that the pre/post-market echo NAMES the unmet condition (“Still to set: …”) rather than only restating the rule — with a limit rule defaulting to GTC, an operator following the rule text alone has to guess which of its three parts is missing.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Review follow-up (round 3): the derived-window guard now derives the window the way the kernel's legWindowFromCron does — expanding BOTH cron fields, so a cron whose minute field steps (e.g. '*\/5 7-19', real end 19:55) turns the guard RED instead of passing on an hour-only reading; a second derivation pins the ticket's 9:30–4:00 rule boundary and both footnotes against regularSession()'s own default (TRADING_DATED_REGULAR_ET), closing the asymmetry where one boundary was guarded and the other was a bare restatement; and the ticket cases are grouped into three describes so no grouping arrow crosses the 50-line function limit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
/**
 * The framework checkout the package's `@/` alias resolves to — the SAME rule vitest.config.mjs uses
 * (env OSHAL_FRAMEWORK → the sibling ../../oshal from the package root). The ticket's accepted window
 * is derived from the kernel here rather than restated, so the two cannot drift apart silently; with
 * no framework checkout the read throws and the guard goes RED (a skipped guard is not a guard).
 */
const FRAMEWORK = process.env.OSHAL_FRAMEWORK || path.resolve(__dirname, '..', '..', '..', 'oshal');
const kernel = (f: string) => readFileSync(path.resolve(FRAMEWORK, f), 'utf8');

const route = src('src-routes/trading-manual-order-routes.ts');
const tkt = src('tools/ui/ticket.js');
const va = src('tools/ui/view-account.js');

/**
 * The first and last value a 5-field-cron field takes — the same semantics the kernel's
 * legWindowFromCron gets from cron-parser (min/max over the field's expanded values). Understood
 * shapes: `*`, `A-B`, `N`, comma lists, and any of those with a `/step`. Anything else yields NaN,
 * which the caller asserts on, so an unfamiliar cron reddens the guard instead of silently deriving
 * the wrong window.
 */
function cronFieldBounds(field: string, hi: number): { min: number; max: number } {
  let first = Infinity, last = -Infinity;
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    let a: number, b: number;
    if (range === '*') { a = 0; b = hi; }
    else if (/^\d+-\d+$/.test(range)) { const p = range.split('-').map(Number); a = p[0]; b = p[1]; }
    else if (/^\d+$/.test(range)) { a = b = Number(range); }
    else return { min: NaN, max: NaN };
    if (!Number.isFinite(step) || step < 1 || a > b || b > hi) return { min: NaN, max: NaN };
    first = Math.min(first, a);
    last = Math.max(last, a + Math.floor((b - a) / step) * step);
  }
  return { min: first, max: last };
}

/**
 * The window (ET minutes-of-day, inclusive) a leg cron fires inside — the kernel's legWindowFromCron
 * restated: min(hour)*60 + min(minute) to max(hour)*60 + max(minute). The MINUTE half is the point:
 * an hour-only reading calls '*\/5 7-19' 19:59 when the leg's real last tick is 19:55.
 */
function legWindow(cron: string): { startMin: number; endMin: number } {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return { startMin: NaN, endMin: NaN };
  const mm = cronFieldBounds(f[0], 59), hh = cronFieldBounds(f[1], 23);
  return { startMin: hh.min * 60 + mm.min, endMin: hh.max * 60 + mm.max };
}

describe('timed orders — POST /decisions/manual fireAtEt (ADR-136 D4)', () => {
  it('converts and validates the fire time through the kernel at PARSE time, so a bad time is a 400 with nothing written', () => {
    expect(route).toContain("from '@/app/trading-dated-orders'");
    // The ORDER SHAPE is not optional here: the kernel's validateFireAt FAILS CLOSED without it and
    // would refuse every pre/post-market time, so a shapeless call is a broken surface, not a lax one.
    expect(route).toMatch(/fireAt = etWallToInstant\(String\(b\.fireAtEt\.date \|\| ''\), String\(b\.fireAtEt\.time \|\| ''\)\); validateFireAt\(fireAt, new Date\(\), \{ orderType: type, extendedHours: b\.extendedHours === true, timeInForce: tif \}\);/);
    expect(route).not.toMatch(/validateFireAt\(fireAt\)/);
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

  it('treats a leg left on a retired cron/timezone as missing, so an existing user migrates onto the current cadence', () => {
    // Without the cron/timezone comparison an existing 5-minute leg is "active" and reused — the
    // operator's 09:37 order would then wait for 09:40. The create-or-replace below keeps id/status.
    expect(route).toMatch(/r\.taskType === taskType && r\.ownerSub === sub && r\.status === 'active' && r\.cron === EVENT_PLANS_CRON && r\.timezone === EVENT_PLANS_TIMEZONE/);
    // the createSchedule call itself is untouched (the arm route pins the identical shape)
    expect(route).toContain("taskType: eventPlanTaskType(sub), schedule: EVENT_PLANS_CRON, timezone: EVENT_PLANS_TIMEZONE, ownerSub: sub, queue: 'intelligent-trades'");
  });

  it('records a kernel dated-order row for the minted decision and answers `dated` with the fire time in words', () => {
    expect(route).toMatch(/const dated = parsed\.v\.fireAt \? await createDatedOrder\(ctx\.pool, sub, \{ book, decisionId: minted\.decisionId, symbol, side, qty: sized\.qty, orderType: type, fireAt: parsed\.v\.fireAt, extendedHours, timeInForce: tif \}\) : null;/);
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

describe('timed orders — the ticket: the WHEN field and its client echo (tools/ui/ticket.js)', () => {
  it('carries when/fireDate/fireTime state and sends fireAtEt ONLY for "At a time"', () => {
    expect(tkt).toContain("when: 'now', fireDate: '', fireTime: ''");
    expect(tkt).toContain("if (TKT.when === 'at') body.fireAtEt = { date: TKT.fireDate, time: TKT.fireTime };");
  });

  it('validates the fire time client-side with the same rules as the kernel (trading day, 7:00 AM–7:59 PM ET, minute precision, future)', () => {
    expect(tkt).toContain('return tktPriceError() || tktProtError() || tktWhenError();');
    expect(tkt).toContain("'Timed orders fire on trading days (Monday to Friday).'");
    expect(tkt).toContain("'Timed orders fire between 7:00 AM and 7:59 PM Eastern.'");
    expect(tkt).toMatch(/min < 7 \* 60 \|\| min > 19 \* 60 \+ 59/);
    // the 5-minute grid is GONE — the leg ticks every minute, so offering only :00/:05/… would refuse
    // nine tenths of the window the kernel accepts
    expect(tkt).not.toMatch(/% 5 !== 0/);
    expect(tkt).not.toContain('5-minute grid');
    expect(tkt).toContain("timeZone: 'America/New_York'");
  });

  it('echoes the venue pre/post-market rule in the words the server refuses with (limit + extended hours + day)', () => {
    expect(tkt).toMatch(/if \(min < 9 \* 60 \+ 30 \|\| min >= 16 \* 60\) \{/);
    expect(tkt).toMatch(/tktRule\(\)\.type === 'limit' && TKT\.extendedHours === true && TKT\.tif === 'day'/);
    expect(tkt).toContain("'A pre/post-market time needs a limit price rule marked eligible for extended hours, as a day order.'");
    // … and NAMES the condition still unmet. The venue rule has three parts and the ticket resets TIF to the
    // rule default on every rule change (TKT_RULES: a limit defaults to gtc), so a bare restatement of the rule
    // leaves the operator guessing which part is missing on the exact screen where they must fix it.
    expect(tkt).toContain("+ ' Still to set: ' + need.join(' and ') + '.';");
    expect(tkt).toMatch(/if \(tktRule\(\)\.type !== 'limit'\) need\.push\('a limit price rule'\);/);
    expect(tkt).toMatch(/if \(TKT\.tif !== 'day'\) need\.push/);
    // the same rule is stated in the field's own footnote and on the account card
    expect(tkt).toContain('Outside 9:30–4:00 only an extended-hours limit day order is accepted');
  });

  it('the TIF select and the extended-hours box refresh the validity line (they are inputs to the pre/post rule)', () => {
    // tktRenderSummary alone does not repaint #tktValid — routing these two through tktLiveUpdate is
    // what stops the line reading "Ready to review" after the change that made the time unacceptable.
    expect(tkt).toContain("tktOn('tktTif', 'onchange', tktLiveUpdate);");
    expect(tkt).toMatch(/tktOn\('tktExt', 'onchange', tktLiveUpdate\);/);
    expect(tkt).toMatch(/function tktLiveUpdate\(\)[\s\S]{0,400}\$\('tktValid'\)/);
  });
});

describe('timed orders — the ticket: submit and result (tools/ui/ticket.js)', () => {
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
});

describe('timed orders — the ticket: the accepted window is DERIVED from the kernel, never restated', () => {
  it('derives a leg window the way the kernel does — the minute field included', () => {
    // legWindowFromCron's own JSDoc names two: '* 7-19 * * 1-5' → 07:00–19:59, and the v1
    // '*/5 9-16 * * 1-5' → 09:00–16:55. The second is why the minute field cannot be ignored: an
    // hour-only reading calls it 16:59 and would accept four minutes the leg never ticks.
    expect(legWindow('* 7-19 * * 1-5')).toEqual({ startMin: 7 * 60, endMin: 19 * 60 + 59 });
    expect(legWindow('*/5 9-16 * * 1-5')).toEqual({ startMin: 9 * 60, endMin: 16 * 60 + 55 });
    expect(legWindow('*/5 7-19 * * 1-5')).toEqual({ startMin: 7 * 60, endMin: 19 * 60 + 55 });
    expect(legWindow('0,30 7-19 * * 1-5')).toEqual({ startMin: 7 * 60, endMin: 19 * 60 + 30 });
    // a shape it cannot expand is NaN, which the guard above asserts on rather than trusting
    expect(Number.isFinite(legWindow('@daily').startMin)).toBe(false);
    expect(Number.isFinite(legWindow('L 7-19 * * 1-5').endMin)).toBe(false);
  });

  it('the time input is minute-precise inside the kernel window (step=60, min 07:00, max 19:59)', () => {
    expect(tkt).toContain('type="time" step="60" min="07:00" max="19:59"');
  });

  it('never OFFERS a minute the kernel would refuse: the input bounds sit inside the kernel default window', () => {
    // The kernel derives its window from the leg cron (legWindowFromCron → 07:00–19:59 by default);
    // this is the bug this pass closes — the shipped ticket offered 09:00 and 16:55, which the kernel
    // now refuses. Read the kernel's own default cron rather than restating the numbers here.
    const cron = kernel('src/app/trading-event-plans.ts');
    const m = /EVENT_PLANS_CRON = process\.env\.TRADING_EVENTS_CRON \|\| '([^']+)'/.exec(cron);
    expect(m, 'the kernel leg cron literal moved — re-derive the ticket bounds from it').toBeTruthy();
    // Derive it the way legWindowFromCron does — BOTH fields. An hour-only reading would call a
    // '*/5 7-19' cron 19:59 when the leg's last tick is 19:55, and pass the very drift this guards.
    const w = legWindow(m![1]);
    expect(Number.isFinite(w.startMin) && Number.isFinite(w.endMin), 'cron "' + m![1] + '" is a shape this guard cannot expand — widen cronFieldBounds rather than trusting the bounds').toBe(true);
    const bounds = /type="time" step="60" min="(\d{2}):(\d{2})" max="(\d{2}):(\d{2})"/.exec(tkt);
    expect(bounds).toBeTruthy();
    const inputMin = Number(bounds![1]) * 60 + Number(bounds![2]), inputMax = Number(bounds![3]) * 60 + Number(bounds![4]);
    expect(inputMin).toBeGreaterThanOrEqual(w.startMin);
    expect(inputMax).toBeLessThanOrEqual(w.endMin);
  });

  it('the regular-session boundary it refuses (and captions) against is the KERNEL default, not a second number', () => {
    // The other half of the asymmetry: the 07:00–19:59 bounds are derived above, but the rule
    // boundary was a bare restatement of regularSession()'s TRADING_DATED_REGULAR_ET default. Change
    // that default in core and the ticket would refuse against the wrong boundary with every spec green.
    const dated = kernel('src/app/trading-dated-orders.ts');
    const body = dated.slice(dated.indexOf('export function regularSession()'));
    const m = /\{ startMin: (\d+) \* 60(?: \+ (\d+))?, endMin: (\d+) \* 60(?: \+ (\d+))? \}/.exec(body);
    expect(m, "regularSession()'s default moved — re-derive the ticket's echo from it").toBeTruthy();
    const term = (h: string, mm?: string) => h + ' * 60' + (mm ? ' + ' + mm : '');
    expect(tkt).toContain('if (min < ' + term(m![1], m![2]) + ' || min >= ' + term(m![3], m![4]) + ') {');
    // the same boundary in words, on the field footnote AND the account card
    const words = (h: string, mm?: string) => ((Number(h) % 12) || 12) + ':' + String(mm || '0').padStart(2, '0');
    const rule = words(m![1], m![2]) + '–' + words(m![3], m![4]) + ' only an extended-hours limit day order';
    expect(tkt).toContain(rule);
    expect(va).toContain(rule);
  });
});

describe('timed orders — the account page card (tools/ui/view-account.js)', () => {
  it('hosts the Timed orders card, loads it per paint, and resets it when the account changes', () => {
    expect(va).toContain('<div id="datedCard"></div>');
    expect(va).toContain('loadDatedCard(token);');
    expect(va).toContain('ACCT_DATED = [];');
    expect(va).toContain("j = await api('/dated');");
  });

  it('the card footnote states the as-built cadence and the pre/post rule (not the retired 5-minute grid)', () => {
    expect(va).toContain('A timed order is placed by the trading leg at its minute (7:00 AM–7:59 PM ET on trading days; outside 9:30–4:00 only an extended-hours limit day order).');
    expect(va).not.toContain('5-minute ticks');
  });

  it('Cancel resolves the row from the model (never an onclick string), confirms by name, and only pending rows offer it', () => {
    expect(va).toContain("const b = e.target.closest('button[data-dated]');");
    expect(va).toContain("r.status === 'pending' ? '<button class=\"btn ghost sm\" data-dated=\"'");
    expect(va).toMatch(/confirm\('Cancel the timed order '/);
    expect(va).toContain("api('/dated/' + encodeURIComponent(id) + '/cancel', jbody('POST', {}))");
  });
});
