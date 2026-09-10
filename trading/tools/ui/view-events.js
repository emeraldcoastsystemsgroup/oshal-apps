/* trading/ui/view-events.js — the EVENT PLAYBOOKS UI (ADR-136 D6 — IPO plans), carved out of
 * view-strategies.js (which had passed the 800-code-line decomposition bar). Classic script, global
 * functions: the Studio's event-plan card (renderStudioEventResult / studioArmEvent / studioDisarmEvent —
 * view-strategies.js still calls them as globals), the Strategies → Event playbooks sub-tab
 * (loadEventPlansTab) and the shared helpers view-account.js / view-accounts.js call at render time
 * (eventPlanActive, eventStatusPill, eventEntryExitText). Loads after view-strategies.js; every call into
 * it happens at render time, so load order only matters for app.js.
 *
 * Also here: the expected PRICING DATE (params.pricingDate — saved with PATCH /events/plans/:id; the
 * kernel normalizes it) and the Conditional Offer reminder status, derived from the plan's timeline
 * (cotp_<key>_sent / _expired events the kernel's trading-events leg writes). The deadline shown is
 * 4:00 PM ET on the last trading day before pricing — the rule, not a guess.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — moved verbatim from view-strategies.js (its "Event playbooks" block: EVENT_ACTIVE … toggleEventPlanDetail); added the pricing-date input + Save (data-act="pricing", the value is read by element id in the delegated handler — never through an onclick/onchange string) and eventRemindersText / eventCotpDeadline / eventTradingDayBack (weekday step-back, mirroring the kernel's trading-day rule).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review round 2: Save now READS BACK params.pricingDate from the PATCH response and says so loudly when it differs from what was sent. Without it a kernel that has not yet learned the pricingDate knob rebuilds params from a fixed key set, returns 200 with an 'edited' timeline entry, and the button looked successful while nothing was stored; the same check surfaces a date the kernel refuses (weekday-only).
 */

/* ── Event playbooks (ADR-136 D6 — IPO plans): shared helpers ─────────────── */
/* Statuses in which the executor is (or will be) acting on the plan — armed through exits placed.
   draft / closed / missed / cancelled / error are not active. */
const EVENT_ACTIVE = ['armed','watching','priced','listed','entry_placed','filled','exits_placed'];
const EVENT_DONE = ['closed','cancelled','missed'];
let EVP = { plans: [], open: null, detail: null };   // the Event playbooks tab's paint state
function eventPlanActive(p) { return !!p && EVENT_ACTIVE.includes(p.status); }
function eventStatusPill(status) {
  const s = String(status || 'draft');
  const klass = (s === 'error' || s === 'missed') ? ' sell' : (EVENT_ACTIVE.includes(s) ? ' buy' : '');
  return '<span class="pill' + klass + '">' + esc(s.replace(/_/g, ' ')) + '</span>';
}
/* '≤ +X% · TP +Y% · stop −Z% · time N d' — the one-line entry/exit summary (tiles, cards, table). */
function eventEntryExitText(p) {
  const q = (p && p.params) || {};
  const n = (v) => v == null ? '?' : String(Number(v));
  return '≤ +' + n(q.maxPremiumPct) + '% · TP +' + n(q.takeProfitPct) + '% · stop −' + n(q.stopLossPct) + '% · time ' + n(q.timeStopDays) + ' d';
}
/* The plan in plain words — what the executor will do, in the order it does it. Plain text: esc() at render. */
function eventPlanText(p) {
  const q = (p && p.params) || {};
  const n = (v) => v == null ? '?' : String(Number(v));
  const tick = q.ticker || (p && p.ticker);
  const size = q.sizePctOfEquity != null
    ? n(q.sizePctOfEquity) + '% of the account' + (q.notionalUsd != null ? ' (~' + money(q.notionalUsd) + ')' : '')
    : (q.notionalUsd != null ? money(q.notionalUsd) : 'the configured size');
  return 'Watch EDGAR for ' + (q.issuer || (p && p.name) || 'the issuer') + (tick ? ' (' + tick + ')' : '') + ' to price and list; enter on the first trade up to +' + n(q.maxPremiumPct) +
    '% over the IPO price, size ' + size + ', take profit at +' + n(q.takeProfitPct) + '% over the IPO price, stop at −' + n(q.stopLossPct) +
    '%, time stop ' + n(q.timeStopDays) + ' days, entry deadline ' + n(q.entryDeadlineDays) + ' days after listing.' +
    (q.pricingDate ? ' Expected pricing ' + eventDateWords(q.pricingDate) + '.' : '');
}
/* The dry-run table: one row per IPO-price scenario, assumptions as foot lines, guardrail note in warn. */
function eventDryRunHtml(dryRun) {
  const d = dryRun || {}; const rows = d.rows || [];
  const c = (v) => v == null ? '—' : money(v);
  const body = rows.length
    ? rows.map(r => '<tr><td class="num">' + c(r.ipoPrice) + '</td><td class="num">' + c(r.entryLimit) + '</td><td class="num">' + (r.shares == null ? '—' : esc(r.shares)) + '</td><td class="num">' + c(r.entryNotional) + '</td><td class="num">' + c(r.takeProfit) + '</td><td class="num">' + c(r.stop) + '</td><td class="num err">' + c(r.maxLossUsd) + '</td><td class="num ok">' + c(r.targetGainUsd) + '</td></tr>').join('')
    : '<tr><td class="foot" colspan="8">No dry-run rows — the IPO price is unknown until the deal prices.</td></tr>';
  return '<div style="overflow-x:auto"><table style="width:100%"><thead><tr><th class="num">IPO price</th><th class="num">Entry limit</th><th class="num">Shares</th><th class="num">Cost</th><th class="num">Take-profit</th><th class="num">Stop</th><th class="num">Max loss</th><th class="num">Target gain</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
    (d.assumptions || []).map(a => '<div class="foot">' + esc(a) + '</div>').join('') +
    (d.guardrailNote ? '<div class="sub warn">&#9888; ' + esc(d.guardrailNote) + '</div>' : '');
}
function eventStepsHtml(steps) {
  const list = steps || []; if (!list.length) return '';
  return '<div class="foot" style="margin-top:8px"><b>Manual steps</b></div><ol class="sub" style="margin:4px 0 0 18px;padding:0">' + list.map(s => '<li>' + esc(s) + '</li>').join('') + '</ol>';
}
/* Arm / disarm / delete — confirm-gated; the caller repaints. Return the server payload, or null. */
async function armEventPlan(planId, name, acctLabel) {
  if (!confirm('ARM "' + name + '" on ' + acctLabel + '?\n\nWhen the stock lists, the executor places REAL orders on this account: the entry, then the take-profit and the stop. Disarm any time before it fires.')) return null;
  try { return await api('/events/plans/' + encodeURIComponent(planId) + '/arm', jbody('POST', { confirm: true })); }
  catch (e) { alert('Arm failed: ' + e.message); return null; }
}
async function disarmEventPlan(planId, name) {
  if (!confirm('Disarm "' + name + '"?\n\nThe executor stops watching for it; nothing will be placed.')) return null;
  try { return await api('/events/plans/' + encodeURIComponent(planId) + '/disarm', jbody('POST', {})); }
  catch (e) { alert('Disarm failed: ' + e.message); return null; }
}
async function deleteEventPlan(planId, name) {
  if (!confirm('Delete "' + name + '"?\n\nThe plan and its timeline are removed. This cannot be undone.')) return null;
  try { return await api('/events/plans/' + encodeURIComponent(planId), { method: 'DELETE' }); }
  catch (e) { alert('Delete failed: ' + e.message); return null; }
}
/* What to tell the operator after arming: the server's note, or the flag-off truth. */
function eventArmNote(r) {
  if (r && r.note) return r.note;
  if (r && r.enabled === false) return 'The event executor is OFF on this server (TRADING_EVENT_PLANS) — the plan is saved and armed; nothing fires until it is turned on.';
  return 'The executor is watching EDGAR; the entry goes in when the stock lists.';
}

/* ── Studio: the event-plan card (replaces metrics + chart for kind:'event') ── */
function renderStudioEventResult(j){
  const host=$('stResults'); if(!host)return;
  const plan=j.plan||{}; const armed=!!j.armed||eventPlanActive(plan);
  const acct=bookLabel(j.account||plan.bookRef||BOOK);
  host.innerHTML='<h4>'+stEsc(j.name||plan.name||'Event plan')+' '+eventStatusPill(plan.status||(armed?'armed':'draft'))+'</h4>'+
    '<p class="sub">Account: <b>'+stEsc(acct)+'</b></p>'+
    '<p class="sub"><b>Hypothesis:</b> '+stEsc(j.hypothesis||plan.hypothesis||'')+'</p>'+
    '<p class="sub"><b>Plan:</b> '+stEsc(eventPlanText(plan))+'</p>'+
    '<div class="foot" style="margin-top:8px"><b>Dry run</b> — what the executor would do at each IPO price</div>'+eventDryRunHtml(j.dryRun)+
    eventStepsHtml(j.manualSteps||(j.dryRun&&j.dryRun.manualSteps))+
    '<div class="st-cites"><b>Grounded in:</b>'+studioCitesHtml(j.citations||plan.citations)+'</div>'+
    (j.notBacktestable?'<p class="sub">'+stEsc(j.notBacktestable)+'</p>':'')+
    '<div style="margin-top:8px">'+
      (armed?'<button class="btn ghost sm" id="stEvDisarm">Disarm</button> ':'<button class="btn primary sm" id="stEvArm">Arm on '+stEsc(acct)+'&hellip;</button> ')+
      '<button class="btn ghost sm" id="stEvOpen">Open Event playbooks</button> <button class="btn ghost sm" id="stNew">Start a new strategy</button></div>';
  const arm=$('stEvArm'); if(arm) arm.onclick=()=>studioArmEvent(j);
  const dis=$('stEvDisarm'); if(dis) dis.onclick=()=>studioDisarmEvent(j);
  $('stEvOpen').onclick=()=>navigate('strategies',{ sub:'events' });
  $('stNew').onclick=studioNewStrategy;
}
async function studioArmEvent(j){
  const plan=j.plan||{}; const id=j.planId||plan.planId||j.strategyId; if(!id)return;
  const acct=bookLabel(j.account||plan.bookRef||BOOK);
  const r=await armEventPlan(id, j.name||plan.name||'this plan', acct); if(!r)return;
  j.plan=r.plan||plan; j.armed=true;
  stAppend('bot','Armed on '+acct+'. '+eventArmNote(r));
  renderStudioEventResult(j);
}
async function studioDisarmEvent(j){
  const plan=j.plan||{}; const id=j.planId||plan.planId||j.strategyId; if(!id)return;
  const r=await disarmEventPlan(id, j.name||plan.name||'this plan'); if(!r)return;
  j.plan=r.plan||plan; j.armed=false;
  stAppend('bot','Disarmed — the plan is kept as a draft. Arm it again any time.');
  renderStudioEventResult(j);
}

/* ── Event playbooks — sub-tab: every plan across accounts, with arm/disarm/view/delete ── */
async function loadEventPlansTab() {
  const host = $('tabbody'); if (!host) return;
  const token = RENDER_TOKEN, gen = tabGen();
  host.innerHTML = spinner('Loading event playbooks…');
  let j;
  try { j = await api('/events/plans'); }
  catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; return; }
  if (stale(token) || tabStale(gen)) return;
  EVP.plans = j.allPlans || j.plans || [];
  if (!EVP.plans.some(p => p.planId === EVP.open)) { EVP.open = null; EVP.detail = null; }
  const state = (j.enabled
      ? '<span class="ok">Executor ON</span>'
      : '<span class="warn">Executor OFF on this server (TRADING_EVENT_PLANS)</span> — plans can be designed and armed; nothing fires until it is on') +
    ' · ' + (j.scheduled ? 'EDGAR watcher scheduled' : '<span class="warn">EDGAR watcher not scheduled</span>');
  host.innerHTML = '<div class="panel" id="evpHost"><h2>Event playbooks</h2>' +
    '<div class="foot" style="margin-bottom:8px">A playbook is a one-off plan for a dated market event — today, an IPO: watch EDGAR for the pricing, buy on the first trade up to a premium cap you set, then take profit and stop out at fixed distances from the IPO price, with a time stop. Design one in Strategy Studio: "the Anthropic IPO — get in near the IPO price, sell at +10% over it or stop out". <a href="#" data-act="studio">Open Strategy Studio →</a></div>' +
    '<div class="sub" style="margin-bottom:8px">' + state + '</div>' +
    '<div id="evpTable"></div></div>';
  paintEventPlans();
  wireEventPlans($('evpHost'));
}
function paintEventPlans() {
  const el = $('evpTable'); if (!el) return;
  el.innerHTML = EVP.plans.length
    ? '<table style="width:100%"><thead><tr><th>Name</th><th>Account</th><th>Issuer / ticker</th><th class="num">IPO price</th><th>Entry / exit</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' + EVP.plans.map(eventPlanRow).join('') + '</tbody></table>'
    : '<div class="foot">No event playbooks yet — design one in Strategy Studio.</div>';
}
function eventPlanRow(p) {
  const q = p.params || {}; const id = esc(p.planId);
  const bk = bookOf(p.bookRef); const viewOnly = !!bk && bk.enabled === false;
  const tick = q.ticker || p.ticker;
  const issuer = esc(q.issuer || '—') + (tick ? ' <span class="foot">' + esc(tick) + '</span>' : '');
  const ipo = p.ipoPrice != null ? money(p.ipoPrice) : (q.ipoPrice != null ? money(q.ipoPrice) : '—');
  const status = eventStatusPill(p.status) + (viewOnly ? ' <span class="pill warn" style="border-color:var(--warn)" title="The plan cannot buy until this account is set to trading">view-only account</span>' : '');
  const active = eventPlanActive(p);
  const canArm = !active && p.status !== 'closed' && p.status !== 'missed';
  const canDelete = p.status === 'draft' || EVENT_DONE.includes(p.status);
  const acts = (active ? '<button class="btn ghost sm" data-act="disarm" data-id="' + id + '">Disarm</button> ' : '') +
    (canArm ? '<button class="btn primary sm" data-act="arm" data-id="' + id + '">Arm…</button> ' : '') +
    '<button class="btn ghost sm" data-act="view" data-id="' + id + '">' + (EVP.open === p.planId ? 'Hide' : 'View') + '</button>' +
    (canDelete ? ' <button class="btn ghost sm" data-act="delete" data-id="' + id + '" title="Delete this plan">✕</button>' : '');
  const detail = EVP.open === p.planId ? '<tr><td colspan="8">' + eventPlanDetail(p) + '</td></tr>' : '';
  return '<tr><td><strong>' + esc(p.name) + '</strong></td><td>' + esc(bookLabel(p.bookRef)) + '</td><td>' + issuer + '</td><td class="num">' + ipo + '</td>' +
    '<td class="foot">' + esc(eventEntryExitText(p)) + '</td><td>' + status + '</td><td class="foot">' + esc(fmtDate(p.updatedAt)) + '</td>' +
    '<td style="white-space:nowrap">' + acts + '</td></tr>' + detail;
}
/* The expanded row: hypothesis, plan in words, filings links, timeline, and the dry run (fetched). */
function eventPlanDetail(p) {
  const d = EVP.detail && EVP.detail.planId === p.planId ? EVP.detail : null;
  const plan = (d && d.plan) || p; const f = plan.filings || {};
  const link = (label, x) => x && x.url
    ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + label + (x.form ? ' ' + esc(x.form) : '') + (x.date ? ' · ' + esc(x.date) : '') + '</a>'
    : '<span class="foot">' + label + ' — not yet</span>';
  const tl = (plan.timeline || []).length
    ? '<ul class="sub" style="margin:4px 0 0 18px;padding:0">' + plan.timeline.map(t => '<li><span class="foot">' + esc(fmtDate(t.at)) + '</span> ' + esc(t.event) + (t.detail ? ' <span class="foot">— ' + esc(t.detail) + '</span>' : '') + '</li>').join('') + '</ul>'
    : '<div class="foot">Nothing has happened yet.</div>';
  const dry = !d ? spinner('Loading dry run…') : (d.error ? '<div class="foot err">' + esc(d.error) + '</div>' : eventDryRunHtml(d.dryRun));
  return '<div class="why">' +
    (plan.hypothesis ? '<div class="sub"><b>Hypothesis:</b> ' + esc(plan.hypothesis) + '</div>' : '') +
    '<div class="sub"><b>Plan:</b> ' + esc(eventPlanText(plan)) + '</div>' +
    '<div class="foot" style="margin-top:6px"><b>Filings:</b> ' + link('S-1', f.s1) + ' · ' + link('Pricing', f.pricing) + '</div>' +
    eventPricingHtml(plan) +
    '<div class="foot" style="margin-top:6px"><b>Timeline</b></div>' + tl +
    '<div class="foot" style="margin-top:6px"><b>Dry run</b></div>' + dry + '</div>';
}
/* One delegated listener on the panel (it dies with the panel on repaint): data-act + data-id only —
   the plan is resolved from EVP.plans, so no name ever passes through a JS string. */
function wireEventPlans(panel) {
  if (!panel) return;
  panel.onclick = (e) => {
    const a = e.target.closest('[data-act]'); if (!a || !panel.contains(a)) return;
    e.preventDefault();
    eventPlanAction(a.getAttribute('data-act'), a.getAttribute('data-id'));
  };
}
async function eventPlanAction(act, id) {
  if (act === 'studio') { navigate('strategies', { sub: 'studio' }); return; }
  const p = EVP.plans.find(x => x.planId === id); if (!p) return;
  if (act === 'view') { toggleEventPlanDetail(p); return; }
  if (act === 'pricing') { await saveEventPricingDate(p); return; }
  const token = RENDER_TOKEN, gen = tabGen();
  let r = null;
  if (act === 'arm') r = await armEventPlan(p.planId, p.name, bookLabel(p.bookRef));
  else if (act === 'disarm') r = await disarmEventPlan(p.planId, p.name);
  else if (act === 'delete') r = await deleteEventPlan(p.planId, p.name);
  if (!r || stale(token) || tabStale(gen)) return;
  if (act === 'arm' && r.enabled === false) alert(eventArmNote(r));
  loadEventPlansTab();
}
async function toggleEventPlanDetail(p) {
  if (EVP.open === p.planId) { EVP.open = null; EVP.detail = null; paintEventPlans(); return; }
  EVP.open = p.planId; EVP.detail = null; paintEventPlans();
  const gen = tabGen();
  try {
    const j = await api('/events/plans/' + encodeURIComponent(p.planId));
    if (tabStale(gen) || EVP.open !== p.planId) return;
    EVP.detail = { planId: p.planId, plan: j.plan || p, dryRun: j.dryRun || null, error: null };
  } catch (e) {
    if (tabStale(gen) || EVP.open !== p.planId) return;
    EVP.detail = { planId: p.planId, plan: p, dryRun: null, error: e.message };
  }
  paintEventPlans();
}

/* ── Pricing date + Conditional Offer reminders (ADR-136 D6 remainder) ────── */
/* Step an ISO date back N trading days (weekdays — mirrors the kernel's shiftTradingDays; exchange
   holidays are a kernel follow-up). null for a malformed date. */
function eventTradingDayBack(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return null;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  for (let left = n; left > 0;) { t -= 86400000; const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return new Date(t).toISOString().slice(0, 10);
}
/* 'Wed Oct 14, 2026' for an ISO date (rendered in UTC so the calendar day never shifts with the browser's zone). */
function eventDateWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return String(iso || '');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
/* The Conditional Offer deadline in words: 4:00 PM ET on the last trading day before pricing. */
function eventCotpDeadline(pricingDate) { const d = eventTradingDayBack(pricingDate, 1); return d ? eventDateWords(d) + ' 4:00 PM ET' : ''; }
/* Reminder status = what the kernel leg actually did, read off the plan's timeline (cotp_<key>_sent / _expired).
   Plain text: esc() at render. */
function eventRemindersText(p) {
  const q = (p && p.params) || {};
  if (!q.pricingDate) return 'No expected pricing date yet — set it to get the Conditional Offer reminders (T-3, T-1 and the pricing morning, in trading days).';
  const done = [];
  for (const t of (p && p.timeline) || []) {
    const m = /^cotp_t(\d+)_(sent|expired)$/.exec(String(t.event || ''));
    if (m) done.push('T-' + m[1] + ' ' + m[2] + ' ' + fmtDate(t.at));
  }
  return 'Expected pricing ' + eventDateWords(q.pricingDate) + ' · Conditional Offer deadline ' + eventCotpDeadline(q.pricingDate) +
    (done.length ? ' · reminders: ' + done.join(', ')
      : ' · reminders go out on the trading-events leg (default T-3, T-1 and the pricing morning at 9:00 ET; TRADING_COTP_REMINDER_DAYS / _HOUR_ET on the server).');
}
/* The pricing-date row of the expanded plan: a date input read BY ID on Save (data-act="pricing") — no inline handler. */
function eventPricingHtml(plan) {
  const q = plan.params || {}; const id = esc(plan.planId);
  return '<div class="foot" style="margin-top:6px"><b>Pricing &amp; Conditional Offer reminders</b></div>' +
    '<div class="sub" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px">' +
      '<label class="foot">Expected pricing date <input type="date" id="evpPricing-' + id + '" value="' + esc(q.pricingDate || '') + '"></label>' +
      '<button class="btn ghost sm" data-act="pricing" data-id="' + id + '">Save</button>' +
      '<span class="foot">EDGAR does not publish it — take it from Schwab\'s IPO center or the press. Software cannot submit the Conditional Offer for you; the platform reminds.</span></div>' +
    '<div class="foot" style="margin-top:4px">' + esc(eventRemindersText(plan)) + '</div>';
}
/* Save the pricing date: PATCH params only (the kernel merges + normalizes; nothing about orders changes),
   then keep the expanded detail current from the response and repaint the list.
   READ-BACK CHECK: the kernel rebuilds params from a fixed key set, so a build without the pricingDate
   knob accepts this PATCH, returns 200 and drops the value. Comparing what came back against what was
   sent is what stops the Save button from looking successful while nothing was stored. A weekday-only
   date is a kernel rule too (an offering prices on a trading day), so a refused weekend lands here. */
async function saveEventPricingDate(p) {
  const el = document.getElementById('evpPricing-' + p.planId); const value = el ? String(el.value || '').trim() : '';
  const token = RENDER_TOKEN, gen = tabGen();
  let r;
  try { r = await api('/events/plans/' + encodeURIComponent(p.planId), jbody('PATCH', { params: { pricingDate: value || null } })); }
  catch (e) { alert('Save failed: ' + e.message); return; }
  if (stale(token) || tabStale(gen)) return;
  const saved = (r && r.plan && r.plan.params && r.plan.params.pricingDate) || '';
  if (saved !== value) {
    alert(value
      ? 'Pricing date NOT saved — the server returned "' + (saved || 'nothing') + '". Either this oshal build predates the pricing-date knob (update the platform), or the date is not a weekday. Reminders stay off until it is stored.'
      : 'Pricing date NOT cleared — the server still has "' + saved + '".');
  }
  if (r && r.plan) EVP.detail = { planId: p.planId, plan: r.plan, dryRun: r.dryRun || null, error: null };
  loadEventPlansTab();
}
