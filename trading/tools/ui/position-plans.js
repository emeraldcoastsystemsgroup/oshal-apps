/* trading/ui/position-plans.js — each open position's exit plan, beside its governance badge
 * (ADR-052 addendum P4).
 *
 * While plans are armed for a book, the kernel stamps every autonomous buy with an immutable plan:
 * the entry reference price, the stop / take-profit / trailing dials of the posture in force and an
 * expiry in NYSE sessions. The engine then judges that position on its OWN stored terms, so a later
 * posture change does not re-price it. This module shows that plan where the operator looks at the
 * position: loadPositionPlans() reads GET /position-plans (the selected book's OPEN plans) into
 * window.PLAN_BY_SYMBOL and repaints the table, and planPill(sym) is the one pill per planned holding,
 * whose title carries the whole plan. A holding with no plan shows nothing: it runs on the book's
 * global exit rules, which is not a fault. A failed read also shows nothing rather than a guess.
 * Classic script, plain globals; shared-positions.js loads it and calls both functions.
 *
 * The 'Exit plans' card (account view, #planAmendCard) is the deliberate amend: new dials from a posture
 * and/or a new life in sessions, optionally for named symbols. amendPlansFromSurface() first POSTs the
 * change WITHOUT confirm - the route answers 428 before it reads anything - and shows that refusal; only
 * an explicit OK in the confirmation that follows resends it with confirm:true.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — loadPositionPlans (RENDER_TOKEN-guarded read of GET /position-plans?status=open into window.PLAN_BY_SYMBOL, plus window.PLAN_ARM with the book's resolved plan life, then one table repaint; a failed read clears the map) and planPill (a 'plan · stop $X · exp D' pill whose title states the entry, stop, take-profit, trailing arm and giveback, expiry, posture and that a posture change does not re-price it).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The amend button (trading 1.33.0). Amending was API-only: POST /position-plans/amend had no control on the surface. renderPlanAmendCard paints an 'Exit plans' card into #planAmendCard (account view only) whenever the book has open plans - new dials from one of the kernel's postures, a new life in sessions, optional symbols and a note - and refreshes only its count on a re-read, so the operator's input survives. amendPlansFromSurface sends the change WITHOUT confirm first; the route refuses with 428 before any read, and the card shows the server's own words and that nothing changed. Only an explicit OK in the confirmation that follows (which names the plans, the account and the new terms) resends the same change with confirm:true; declining leaves the 428 standing. A second 428 or any error is shown as such, success reloads the plans. loadPositionPlans calls renderPlanAmendCard after every read, so a failed read clears the card with the pills.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A life of 0 reached the confirmation with no terms named. planAmendChange turned '0' into sessions 0, which passed the nothing-chosen check, and planAmendSummary dropped it because 0 is falsy, so the question read 'every open plan (2 open plans) on Paper get , priced from each plan's original entry.' Nothing was written (the route answered 428, then 400 after OK), but the operator was asked to confirm terms the question did not state. amendPlansFromSurface now refuses a life that is not a whole number of 1 or more (0, a negative, a fraction) before any request, with or without a posture beside it, and says nothing was sent. planAmendSummary names the life whenever the request carries one. The upper bound stays the route's.
 */

/* The last-read plans for the selected book, by UPPERCASE symbol, and its plan arm ({sessions, source}). */
window.PLAN_BY_SYMBOL = window.PLAN_BY_SYMBOL || {};
window.PLAN_ARM = window.PLAN_ARM || null;

/* Read the selected book's open plans and repaint the positions table with them. */
async function loadPositionPlans() {
  const token = RENDER_TOKEN;                 // bail after the await if the operator navigated away
  try {
    const j = await api('/position-plans?status=open');
    if (stale(token)) return;
    const map = {};
    for (const p of (j.plans || [])) map[String(p.symbol || '').toUpperCase()] = p;
    window.PLAN_BY_SYMBOL = map;
    window.PLAN_ARM = j.armed || null;
  } catch (e) {
    // No plan pill beats a stale one: the positions table still paints, just without plans.
    if (stale(token)) return;
    window.PLAN_BY_SYMBOL = {};
    window.PLAN_ARM = null;
  }
  renderPlanAmendCard();
  if (typeof renderPortfolioTable === 'function') renderPortfolioTable();
}

/* The plan pill for one held symbol ('' when it has no open plan). */
function planPill(sym) {
  const m = window.PLAN_BY_SYMBOL;
  const p = m && typeof m === 'object' ? m[String(sym || '').toUpperCase()] : null;
  if (!p) return '';
  const title = 'Exit plan (' + p.posture + ' posture, stamped ' + p.stampedSession + '): entry ' + money(p.entryPrice) +
    ' · stop ' + money(p.stopPrice) + ' (-' + p.stopLossPct + '%) · take-profit ' + money(p.takeProfitPrice) + ' (+' + p.takeProfitPct + '%)' +
    ' · trailing arms at +' + p.trailArmPct + '% and gives back ' + p.trailGivebackPct + '%' +
    ' · expires ' + p.expirySession + ' (' + p.sessions + ' sessions). The engine exits this position on these stored terms; ' +
    'a posture change does not re-price them — only an explicit amend does.';
  return ' <span class="pill" style="font-size:9px" data-plan-symbol="' + esc(p.symbol) + '" title="' + esc(title) + '">plan · stop ' +
    money(p.stopPrice) + ' · exp ' + esc(p.expirySession) + '</span>';
}

/* ── the deliberate amend (POST /position-plans/amend) ──────────────────────────────────────────── */

/* The kernel's RISK_POLICIES postures; the route refuses any other with 400 posture_invalid. */
const PLAN_AMEND_POSTURES = ['conservative', 'balanced', 'aggressive', 'active'];

/* '3 open plans' - the count the card and the confirmation both state. */
function planCountText(n) { return n + ' open plan' + (n === 1 ? '' : 's'); }

/* Paint the 'Exit plans' card once per account view, or refresh only its count, so a re-read never
 * wipes what the operator is typing. No open plans, or no #planAmendCard host (every view but the
 * account view), paints nothing. */
function renderPlanAmendCard() {
  const host = $('planAmendCard'); if (!host) return;
  const count = Object.keys(window.PLAN_BY_SYMBOL || {}).length;
  if (!count) { host.innerHTML = ''; return; }
  const counter = host.querySelector('[data-plan-count]');
  if (counter) { counter.textContent = planCountText(count); return; }
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Exit plans</h2>' +
    '<span class="foot" style="margin-left:auto" data-plan-count>' + esc(planCountText(count)) + '</span></div>' +
    '<div class="foot" style="margin-bottom:8px">Each open plan keeps the terms it was stamped with: a posture change does not re-price it. ' +
    'Amending does. The server refuses an amend you have not confirmed (428) and changes nothing until you do.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
    '<label class="foot">New dials<select id="planAmendPosture"><option value="">keep dials</option>' +
      PLAN_AMEND_POSTURES.map(p => '<option value="' + p + '">' + p + ' posture</option>').join('') + '</select></label>' +
    '<label class="foot">New life (sessions)<input id="planAmendSessions" type="number" min="1" max="252" step="1" placeholder="keep"></label>' +
    '<label class="foot">Only these symbols<input id="planAmendSymbols" placeholder="all open plans"></label>' +
    '<label class="foot" style="flex:1;min-width:160px">Note<input id="planAmendNote" placeholder="why you are amending"></label>' +
    '<button class="btn ghost sm" id="planAmendBtn">Amend plans…</button></div>' +
    '<div id="planAmendMsg" class="sub" style="margin-top:6px"></div></div>';
  $('planAmendBtn').onclick = amendPlansFromSurface;
}

/* The amend form as the route's body ({posture?, sessions?, symbols?, note?}). It never carries confirm. */
function planAmendChange() {
  const change = {};
  const posture = $('planAmendPosture').value; if (posture) change.posture = posture;
  const sessions = $('planAmendSessions').value.trim(); if (sessions) change.sessions = Number(sessions);
  const symbols = $('planAmendSymbols').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (symbols.length) change.symbols = symbols;
  const note = $('planAmendNote').value.trim(); if (note) change.note = note;
  return change;
}

/* A life the card will send: a whole number of sessions, 1 or more. The route owns the upper bound. */
function planLifeValid(sessions) { return Number.isInteger(sessions) && sessions >= 1; }

/* What the confirmation names: which plans, on which account, and what they become. Every term the
 * request carries is named, so the question can never be asked about terms it does not state. */
function planAmendSummary(change) {
  const what = [change.posture ? 'the stop / take-profit / trailing dials of the ' + change.posture + ' posture' : '',
    change.sessions !== undefined ? 'a life of ' + change.sessions + ' sessions' : ''].filter(Boolean).join(' and ');
  const which = change.symbols ? change.symbols.join(', ') : 'every open plan (' + planCountText(Object.keys(window.PLAN_BY_SYMBOL || {}).length) + ')';
  return which + ' on ' + DISP + ' get ' + what + ', priced from each plan\'s original entry.';
}

/* POST the amend. A 428 comes back as {refused: the server's own words} instead of a throw. */
async function planAmendPost(body) {
  try {
    const j = await api('/position-plans/amend', jbody('POST', body));
    return { refused: null, amended: (j && j.amended) || [] };
  } catch (e) {
    if (e && e.status === 428) return { refused: e.message, amended: [] };
    throw e;
  }
}

/* One status line under the card. */
function planAmendSay(el, kind, text) { if (el) { el.className = 'sub' + (kind ? ' ' + kind : ''); el.textContent = text; } }

/* Amend on purpose. The first request goes WITHOUT confirm, and the route answers 428 before it reads
 * anything, so it cannot change a plan; the card shows that refusal. Only an explicit OK in the
 * confirmation that follows resends the same change with confirm:true. */
async function amendPlansFromSurface() {
  const token = RENDER_TOKEN, msg = $('planAmendMsg'), btn = $('planAmendBtn');
  const change = planAmendChange();
  if (!change.posture && change.sessions === undefined) { planAmendSay(msg, 'err', 'Choose new dials, a new life in sessions, or both.'); return; }
  if (change.sessions !== undefined && !planLifeValid(change.sessions)) {
    planAmendSay(msg, 'err', 'A new life is a whole number of sessions, 1 or more. Nothing was sent.'); return;
  }
  if (btn) btn.disabled = true;
  try {
    const first = await planAmendPost(change);
    if (stale(token)) return;
    if (!first.refused) {
      planAmendSay(msg, 'err', 'The server amended ' + first.amended.length + ' plan(s) WITHOUT a confirmation - that route must answer 428. Plans reloaded.');
      await loadPositionPlans(); return;
    }
    planAmendSay(msg, '', 'Not amended - the server answered 428: ' + first.refused + ' Nothing has changed.');
    if (!confirm('Amend exit plans?\n\n' + planAmendSummary(change) + '\n\nThe server refused without your confirmation: ' + first.refused + '\n\nOK sends it again with your confirmation.')) {
      planAmendSay(msg, '', 'Not amended - you did not confirm, so the 428 stands and nothing changed.'); return;
    }
    const done = await planAmendPost(Object.assign({}, change, { confirm: true }));
    if (stale(token)) return;
    if (done.refused) { planAmendSay(msg, 'err', 'Not amended - the server answered 428: ' + done.refused); return; }
    planAmendSay(msg, 'ok', 'Amended ' + done.amended.length + ' plan(s); each successor records you and your note.');
    await loadPositionPlans();
  } catch (e) {
    if (!stale(token)) planAmendSay(msg, 'err', 'Amend failed: ' + e.message);
  } finally { if (btn) btn.disabled = false; }
}
