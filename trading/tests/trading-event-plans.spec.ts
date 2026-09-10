/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-136 D6 guards for event playbooks: every event-plan handler 401-gates via callerSub, the book is resolved QUERY-FIRST (the 2026-09-03 paper-routing class), arm is 428 confirm-gated and 503s BEFORE arming when the scheduler is absent, the per-user schedule is created in America/New_York on the intelligent-trades queue, the route family is registered right after the direct-trade routes, /studio branches on isEventIntent BEFORE the rotation flow with the SAME query-first book resolution, the six IPO findings exist with their exact ids + Google-Scholar urls (no doi.org asserted for them), isEventIntent matches the operator's phrasings and not a rotation ask, and the event prompt/parser carry the manual-vs-automated contract.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | UI pins for the D6 remainder: the event-playbook UI lives in view-events.js (view-strategies.js no longer defines it and is back under the 800-code-line bar), the shell loads view-events.js right after view-strategies.js, the pricing-date Save is a data-act handler that reads the <input> BY ID and PATCHes params.pricingDate only (no inline handler, no order path), and the reminder status is read off the timeline's cotp_* events. The behaviour itself is proven by the kernel's real-DB specs (tests/unit/trading-event-reminders.spec.ts, trading-event-alerts.spec.ts in core).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Review round 2: pin the pricing-date Save READ-BACK — the response's params.pricingDate is compared to what was sent and a mismatch alerts. A kernel that predates the knob returns 200 and drops the value, so without this pin the surface could ship a control that looks successful and stores nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { eventPlanPrompt, isEventIntent, parseEventPlanReply } from '../src-routes/trading-strategy-studio-prompt';
import { findingById, selectResearch, STRATEGY_RESEARCH } from '../src-routes/trading-strategy-research';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

const IPO_IDS = ['ipo-first-day', 'ipo-long-run', 'new-issues-puzzle', 'ipo-flipping-persistence', 'lockup-expiry', 'ipo-underpricing-time'];

describe('event-plan routes — auth + book scoping (ADR-136 D6)', () => {
  const route = src('src-routes/trading-event-plan-routes.ts');
  const handlers = route.split(/\n  router\.(?=get|post|patch|delete)/).slice(1);

  it('registers exactly the seven event-plan handlers', () => {
    const heads = handlers.map((h) => h.split('\n')[0]);
    expect(heads.filter((h) => h.startsWith("get('/events/plans'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("get('/events/plans/:id'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("post('/events/plans'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("patch('/events/plans/:id'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("post('/events/plans/:id/arm'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("post('/events/plans/:id/disarm'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("delete('/events/plans/:id'"))).toHaveLength(1);
    expect(handlers).toHaveLength(7);
  });

  it('every handler 401-gates via callerSub before any work', () => {
    expect(route).toMatch(/const s = callerSub\(req\);\s*\n\s*if \(!s\) res\.status\(401\)/);
    for (const h of handlers) expect(h.split('\n')[1]).toContain('const s = sub(req, res); if (!s) return;');
    expect(route).not.toMatch(/req\.oidc|userSub\s*=\s*req\./);
  });

  it('resolves the book QUERY-first, then body, then the legacy mode aliases in the same order', () => {
    expect(route).toContain('resolveBook(ctx.pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined) ?? b.mode)');
    expect(route).not.toMatch(/resolveBook\(ctx\.pool, s, b\.book/);
    expect(route).not.toMatch(/resolveBook\(ctx\.pool, s, b\.mode/);
  });

  it('list + create resolve the SELECTED book; get/patch read equity from the PLAN\'s own book', () => {
    const list = handlers.find((h) => h.startsWith("get('/events/plans'"))!;
    const create = handlers.find((h) => h.startsWith("post('/events/plans'"))!;
    expect(list).toContain('resolveRequestBook(ctx, s, req)');
    expect(list).toContain('listEventPlans(ctx.pool, s, { bookId: book.bookId })');
    expect(create).toContain('resolveRequestBook(ctx, s, req)');
    expect(create).toContain('createEventPlan(ctx.pool, s, {');
    expect(create).toMatch(/book, name, params/);
    for (const h of ['get(\'/events/plans/:id\'', 'patch(\'/events/plans/:id\'']) {
      expect(handlers.find((x) => x.startsWith(h))!).toContain('planEquity(ctx, s, plan)');
    }
  });

  it('a view-only account may hold a DRAFT but the response warns it cannot buy', () => {
    const create = handlers.find((h) => h.startsWith("post('/events/plans'"))!;
    expect(create).toContain('res.status(201)');
    expect(create).toContain('warning: book.enabled ? null : VIEW_ONLY_WARNING');
    expect(route).toContain("'This account is view-only — the plan cannot buy until you Start trading on it.'");
    expect(create).not.toMatch(/book_disabled/);
  });

  it('equity for the dry-run is read from the broker reader and is NULL on any failure — never fabricated', () => {
    expect(route).toMatch(/getBrokerReader\(book\.kind, s, binding\)/);
    expect(route).toContain('if (!reader.configured()) return null;');
    expect(route).toContain('(await reader.getAccount()).equity');
    expect(route).toMatch(/catch \(err\) \{\s*\n\s*logger\.error\([^\n]*\n\s*return null;/);
    expect(route).not.toMatch(/equity\s*(\?\?|\|\|)\s*\d/);
  });

  it('every handler maps a TradingError to its own status/code and logs + 502s anything else', () => {
    expect(route).toContain('if (err instanceof TradingError) { res.status(err.httpStatus).json({ error: err.code, message: err.message }); return; }');
    expect(route).toMatch(/logger\.error\(\{ err, what \}, 'event plan route failed'\);\s*\n\s*res\.status\(502\)/);
    for (const h of handlers) expect(h).toMatch(/catch \(err\) \{ fail\(res, err, '/);
    expect(route).not.toMatch(/catch\s*\{\s*\}/);
    expect(route).not.toMatch(/console\.log/);
  });
});

describe('arm — confirm-gated, scheduler-checked BEFORE arming, schedule in New York on the trades queue', () => {
  const route = src('src-routes/trading-event-plan-routes.ts');
  const arm = route.slice(route.indexOf("router.post('/events/plans/:id/arm'"), route.indexOf("router.post('/events/plans/:id/disarm'"));

  it('428 confirm_required unless confirm === true (strict boolean, never truthy)', () => {
    expect(arm).toContain('if (b.confirm !== true) {');
    expect(arm).toMatch(/res\.status\(428\)\.json\(\{ error: 'confirm_required'/);
    expect(arm.indexOf('confirm !== true')).toBeLessThan(arm.indexOf('armEventPlan('));
  });

  it('503 scheduler_unavailable is decided BEFORE armEventPlan so a refusal changes no state', () => {
    expect(arm).toMatch(/res\.status\(503\)\.json\(\{ error: 'scheduler_unavailable'/);
    expect(arm.indexOf('scheduler_unavailable')).toBeLessThan(arm.indexOf('armEventPlan('));
  });

  it('ensures the per-user trading-events schedule with the kernel cron + timezone on the intelligent-trades queue', () => {
    expect(arm).toContain('taskType: eventPlanTaskType(s), schedule: EVENT_PLANS_CRON, timezone: EVENT_PLANS_TIMEZONE, ownerSub: s, queue: \'intelligent-trades\'');
    expect(arm).toContain("taskData: { prompt: 'Event playbooks — IPO watch/entry/exit state machine', userSub: s }");
    expect(arm).toContain('res.json({ plan, scheduled: true, enabled, note: enabled ? null : EXECUTOR_OFF_NOTE })');
    expect(route).toContain("'TRADING_EVENT_PLANS is off on this server — the plan is armed but the executor will not fire until it is enabled.'");
  });

  it('scheduled in the list response means an ACTIVE schedule owned by the caller — not merely present', () => {
    expect(route).toMatch(/r\.taskType === taskType && r\.ownerSub === s && r\.status === 'active'/);
  });
});

describe('registration + the /studio event branch', () => {
  const entry = src('src-routes/trading-routes.ts');
  const lab = src('src-routes/trading-strategy-lab-routes.ts');

  it('trading-routes registers the event-plan family right after the direct-trade routes', () => {
    expect(entry).toContain("import { registerTradingEventPlanRoutes } from './trading-event-plan-routes';");
    const manual = entry.indexOf('registerTradingManualOrderRoutes(router, ctx);');
    const events = entry.indexOf('registerTradingEventPlanRoutes(router, ctx);');
    const reads = entry.indexOf('registerTradingBookReadRoutes(router, ctx, apiDir);');
    expect(manual).toBeGreaterThan(0);
    expect(events).toBeGreaterThan(manual);
    expect(reads).toBeGreaterThan(events);
  });

  it('/studio branches on isEventIntent BEFORE the rotation flow (selectResearch / studioPrompt)', () => {
    const studio = lab.slice(lab.indexOf("router.post('/studio'"));
    const branch = studio.indexOf('if (existingPlan || isEventIntent(message))');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(studio.indexOf('selectResearch(message, 4)'));
    expect(branch).toBeLessThan(studio.indexOf('studioPrompt('));
    expect(studio).toContain('await respondEventStudioTurn(ctx, res, { sub: s, book, message, existingPlan, botClient, agentId: TRADING_AGENT_ID });');
    expect(studio).toMatch(/respondEventStudioTurn\([^\n]*\);\s*\n\s*return;/);
  });

  it('/studio resolves the SELECTED book query-first and reads the event plan by the request strategyId', () => {
    const studio = lab.slice(lab.indexOf("router.post('/studio'"));
    expect(studio).toContain('resolveBook(pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined) ?? b.mode)');
    expect(studio).toContain('const existingPlan = b.strategyId ? await getEventPlan(pool, s, String(b.strategyId)) : null;');
    expect(lab).toContain("from '@/app/trading-event-plans'");
  });

  it('the event branch selects IPO research, refines in place, and answers with the dry-run + notBacktestable', () => {
    const route = src('src-routes/trading-event-plan-routes.ts');
    expect(route).toContain("selectResearch(`${turn.message} ipo initial public offering listing`, 4)");
    expect(route).toContain('updateEventPlan(ctx.pool, turn.sub, turn.existingPlan.planId, { params,');
    expect(route).toContain('normalizeEventPlanParams({ ...turn.existingPlan.params, ...rawPlan })');
    expect(route).toContain("kind: 'event', strategyId: plan.planId, planId: plan.planId");
    expect(route).toContain("armed: plan.status !== 'draft' && plan.status !== 'cancelled'");
    expect(route).toContain('dryRun: dryRunEventPlan(plan, equity), account: turn.book.ref');
    expect(route).toContain('res.json({ needsInput: true, message: question.slice(0, 2000) });');
    expect(route).toContain("'The issuer is not listed yet, so there is no price history to backtest; the dry-run shows exactly what the executor would place at example IPO prices.'");
  });
});

describe('the IPO research corpus', () => {
  it('holds the six IPO findings with their exact ids, tagged ipo', () => {
    for (const id of IPO_IDS) {
      const f = findingById(id);
      expect(f, id).toBeDefined();
      expect(f!.tags).toContain('ipo');
      expect(f!.tags).toContain('initial public offering');
      expect(f!.maps).toEqual({ note: f!.maps.note });
      expect(f!.maps.note.length).toBeGreaterThan(10);
    }
  });

  it('cites Google Scholar title searches — never a doi.org the corpus did not verify', () => {
    for (const id of IPO_IDS) {
      const f = findingById(id)!;
      expect(f.url).toMatch(/^https:\/\/scholar\.google\.com\/scholar\?q=%22/);
      expect(f.url).not.toContain('doi.org');
    }
  });

  it('carries the published facts the plan is designed from', () => {
    expect(findingById('ipo-first-day')!.finding).toContain('18.8%');
    expect(findingById('ipo-first-day')!.authors).toBe('Ritter & Welch');
    expect(findingById('ipo-first-day')!.year).toBe(2002);
    expect(findingById('ipo-long-run')!.year).toBe(1991);
    expect(findingById('new-issues-puzzle')!.year).toBe(1995);
    expect(findingById('ipo-flipping-persistence')!.authors).toBe('Krigman, Shaw & Womack');
    expect(findingById('lockup-expiry')!.finding).toMatch(/−1\.5%/);
    expect(findingById('lockup-expiry')!.finding).toMatch(/40%/);
    expect(findingById('ipo-underpricing-time')!.journal).toBe('Financial Management 33(3)');
    expect(findingById('ipo-underpricing-time')!.finding).toMatch(/65%/);
  });

  it('an IPO query selects ONLY IPO findings, and the padded studio query fills all four slots with them', () => {
    const picked = selectResearch('the anthropic ipo ipo initial public offering listing', 4);
    expect(picked).toHaveLength(4);
    for (const f of picked) expect(IPO_IDS).toContain(f.id);
    expect(picked.map((f) => f.id)).toContain('ipo-first-day');
  });

  it('the rotation selector still works and does not pick up IPO findings for a rotation ask', () => {
    const picked = selectResearch('a momentum rotation with a low-volatility tilt and a big SPY core', 4);
    expect(picked.length).toBeGreaterThan(0);
    for (const f of picked) expect(IPO_IDS).not.toContain(f.id);
    expect(STRATEGY_RESEARCH.filter((f) => !IPO_IDS.includes(f.id))).toHaveLength(9);
  });
});

describe('isEventIntent', () => {
  it("matches the operator's phrasings", () => {
    expect(isEventIntent('the anthropic ipo')).toBe(true);
    expect(isEventIntent('get in early on the IPO and sell at 10% over the strike')).toBe(true);
    expect(isEventIntent('watch for the S-1 and buy when it goes public')).toBe(true);
    expect(isEventIntent('a one-time event trade around the earnings release')).toBe(true);
  });

  it('does NOT match a rotation ask', () => {
    expect(isEventIntent('a low-volatility tilt with a big SPY core')).toBe(false);
    expect(isEventIntent('a momentum rotation, top 12, daily rebalance')).toBe(false);
    expect(isEventIntent('')).toBe(false);
  });

  it('a plan already of kind event stays on the event branch on refinement, whatever the wording', () => {
    expect(isEventIntent('raise the take profit to 15%', { kind: 'event' })).toBe(true);
    expect(isEventIntent('raise the take profit to 15%', { kind: 'rotation' })).toBe(false);
  });
});

describe('eventPlanPrompt + parseEventPlanReply — the manual-vs-automated contract', () => {
  const findings = selectResearch('ipo initial public offering listing', 4);

  it('the prompt states the manual steps and the automated state machine, cites by [id], and forbids a backtest claim', () => {
    const p = eventPlanPrompt('the anthropic ipo', findings, 'live', 451800);
    expect(p).toContain('EVENT PLAYBOOK');
    expect(p).toContain('Conditional Offer to Purchase');
    expect(p).toContain('before 4 p.m. ET');
    expect(p).toContain('not something software can secure');
    expect(p).toContain('S-1');
    expect(p).toContain('424B4');
    expect(p).toContain('IPO price × (1 + maxPremiumPct/100)');
    expect(p).toContain('IPO price × (1 + takeProfitPct/100)');
    expect(p).toContain('IPO price × (1 − stopLossPct/100)');
    expect(p).toContain('NOT BACKTESTABLE');
    expect(p).toContain('"strike"');
    expect(p).toContain('[ipo-first-day]');
    expect(p).toContain('ACCOUNT: live (equity: $451800)');
    expect(p).toContain('"manualSteps"');
    expect(p).not.toContain('CURRENT PLAN');
  });

  it('a null equity is said plainly — never a guessed number', () => {
    const p = eventPlanPrompt('the anthropic ipo', findings, 'b-1234abcd', null);
    expect(p).toContain('equity: not readable right now');
    expect(p).not.toMatch(/equity: \$\d/);
  });

  it('a refinement turn feeds the current plan back and asks to change only what was asked', () => {
    const plan = { issuer: 'Anthropic', maxPremiumPct: 5, sizePctOfEquity: 2, takeProfitPct: 10, stopLossPct: 10, timeStopDays: 30, entryDeadlineDays: 2 };
    const p = eventPlanPrompt('make the take profit 15%', findings, 'live', null, { name: 'Anthropic IPO', plan });
    expect(p).toContain('CURRENT PLAN');
    expect(p).toContain('name: Anthropic IPO');
    expect(p).toContain(JSON.stringify(plan));
    expect(p).toContain('ONLY what the request asks for');
  });

  it('parses the fenced reply, keeps only real citations, and carries manualSteps', () => {
    const reply = '```json\n' + JSON.stringify({
      name: 'Anthropic IPO', description: 'd', hypothesis: 'h', citations: ['ipo-first-day', 'made-up-2031'],
      plan: { issuer: 'Anthropic', ticker: null, maxPremiumPct: 5, sizePctOfEquity: 2, notionalUsd: null, takeProfitPct: 10, stopLossPct: 10, timeStopDays: 30, entryDeadlineDays: 2 },
      narration: 'n', manualSteps: ['Submit the Conditional Offer to Purchase on schwab.com', ' Confirm after pricing '],
    }) + '\n```';
    const parsed = parseEventPlanReply(reply, findings);
    expect(parsed.citations.map((c) => c.id)).toEqual(['ipo-first-day']);
    expect(parsed.manualSteps).toEqual(['Submit the Conditional Offer to Purchase on schwab.com', 'Confirm after pricing']);
    expect((parsed.plan as { issuer: string }).issuer).toBe('Anthropic');
  });

  it('THROWS on a prose-only reply — the route turns that into needsInput, never a 502', () => {
    expect(() => parseEventPlanReply('Which company is going public?', findings)).toThrow();
  });
});

describe('event-playbook UI — carved into view-events.js; pricing date + reminders (ADR-136 D6 remainder)', () => {
  const events = src('tools/ui/view-events.js');
  const strategies = src('tools/ui/view-strategies.js');
  const html = src('tools/trading.html');
  /** Code lines per CLAUDE.md "Hard file/function limits": blank lines and comments do not count. */
  const codeLines = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;

  it('view-events.js owns the event helpers; view-strategies.js only calls them, and both files are under the 800-code-line bar', () => {
    for (const fn of ['eventPlanActive', 'eventStatusPill', 'eventEntryExitText', 'eventPlanText', 'renderStudioEventResult', 'studioArmEvent', 'studioDisarmEvent', 'loadEventPlansTab', 'eventPlanDetail', 'eventPlanAction']) {
      expect(events).toMatch(new RegExp(`(async )?function ${fn}\\(`));
      expect(strategies).not.toMatch(new RegExp(`function ${fn}\\(`));
    }
    expect(strategies).toContain('renderStudioEventResult(j)');   // the Studio still dispatches kind:event to the moved card
    expect(codeLines(strategies)).toBeLessThan(800);
    expect(codeLines(events)).toBeLessThan(800);
  });

  it('the shell loads view-events.js right after view-strategies.js', () => {
    const refs = [...html.matchAll(/<script src="\/api\/trading\/ui\/([^"?]+)"/g)].map((m) => m[1]);
    expect(refs.indexOf('view-events.js')).toBe(refs.indexOf('view-strategies.js') + 1);
  });

  it('the pricing-date Save is a delegated data-act that reads the input BY ID and PATCHes params.pricingDate only — no inline handler, no order path', () => {
    expect(events).toContain('data-act="pricing" data-id="');
    expect(events).toContain("if (act === 'pricing') { await saveEventPricingDate(p); return; }");
    expect(events).toContain("document.getElementById('evpPricing-' + p.planId)");
    expect(events).toContain("jbody('PATCH', { params: { pricingDate: value || null } })");
    // The kernel rebuilds params from a fixed key set: a build without the pricingDate knob answers 200
    // and drops the value. Save must compare the response to what it sent, or it lies to the operator.
    expect(events).toContain("const saved = (r && r.plan && r.plan.params && r.plan.params.pricingDate) || '';");
    expect(events).toContain('if (saved !== value) {');
    expect(events).toContain('Pricing date NOT saved');
    // Inline handlers in MARKUP (onclick="…" attributes) are what strict CSP forbids; `el.onclick = fn` property wiring is not.
    expect(events).not.toMatch(/\bon(click|change|input)=["'\\]/);
    expect(events).not.toMatch(/\/orders|\/decisions\/manual/);
    expect(events).not.toMatch(/console\.log/);
  });

  it('reminder status is derived from the timeline (cotp_<key>_sent / _expired) and the deadline is 4:00 PM ET on the last trading day before pricing', () => {
    expect(events).toContain('/^cotp_t(\\d+)_(sent|expired)$/');
    expect(events).toContain("function eventCotpDeadline(pricingDate) { const d = eventTradingDayBack(pricingDate, 1); return d ? eventDateWords(d) + ' 4:00 PM ET' : ''; }");
    expect(events).toContain('function eventTradingDayBack(iso, n)');
    expect(events).not.toContain('Deadline today');
  });
});
