/* trading/ui/view-strategies.js — VIEW 'strategies' (ADR-136 D1): the per-account strategy roster FIRST
 * (the configuration screen is never buried), then Strategy Lab, Strategy Studio and Tuning as sub-tabs.
 *
 * Classic script; depends on app.js globals (BOOK/MODE/BOOKS/DISP/VIEW/SUB, api(), jbody(method, obj),
 * esc/money/pct/fmtDate/cls, loadBooks(), navigate(), subTabs(), stale()). Every loader paints into
 * #tabbody, the host subTabs() renders. Lab/Studio/Tuning code moved verbatim from the single-file page;
 * the only edits are the account-wording fixups (the "profile"/"switcher" copy now names the selected
 * account), the jbody(method, obj) call shape app.js established, and the post-change repaint: Set/Reset/
 * Start/Stop are also wired from the account page and the landing tiles, so they repaint whichever view
 * is showing instead of assuming the roster.
 *
 * Event playbooks (ADR-136 D6 — IPO plans) live in view-events.js: the Studio renders a `kind:'event'`
 * reply through renderStudioEventResult (+ studioArmEvent / studioDisarmEvent) and the 'Event playbooks'
 * sub-tab is loadEventPlansTab — all globals from that module, called from here at render time.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The event-playbook block (EVENT_ACTIVE … toggleEventPlanDetail) moved verbatim to view-events.js — this file had reached 870 code lines, past the 800-line decomposition bar; Lab / Studio / Tuning / roster stay. No behaviour change: the moved functions remain globals with the same names.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Strict-CSP cleanup + the sub-tab race (ADR-136 D2 tail). The four handler attributes here are gone: the roster is #rosterHost with ONE delegated listener (wireRoster/rosterAction) where only the BOOK ID rides the markup and the trading state is read from BOOKS at click time, and the applied-panel's 'Account strategies' link is a delegated data-act. Every sub-tab loader (roster, lab-applied, lab-knobs, tuning recs, tuning params) now captures RENDER_TOKEN and tabGen() before its first await and bails after it - including the catch paths - so a slow answer for the sub-tab just left can no longer overpaint the one just chosen; loadRosterTab bails BEFORE writing BOOKS or filling the live pickers. loadTuning is a plain function (it paints nothing after an await).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Review follow-ups on the SEQ 2 lines: loadRosterTab carries JSDoc rather than a prose block, and loadTuneParams' catch binds its error and shows it in the same "foot err" shape its sibling loaders use instead of blanking the panel and swallowing the reason - a silent empty panel is indistinguishable from "no parameters".
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | acknowledgeArming(): the operator-facing half of the arming gate the kernel dispatch now enforces for a non-legacy book. Its copy states what an armed leg actually does to an account whose positions the engine did not open - it BUYS with the idle cash, and under ADR-159 it neither sells, trims, tops up nor stops a holding its own filled orders cannot account for, while a pinned lot still places real GTC sells for the shares its own entry bought. That last clause is a CORRECTION: before ADR-159 the engine did rotation-sell a hand-picked name, and copy still saying so would be wrong in the direction that makes an operator distrust what they are reading. toggleBook's confirm no longer implies that turning an account on is what starts a leg; it names the acknowledgement as the second act.
 */

/* ── Account strategies roster — per-book strategy + trading control (ADR-134) ── */
/**
 * @description Paint the account-strategies roster (per-book strategy + trading control, ADR-134).
 * It paints into the PERSISTENT #tabbody element, so a slow /accounts answer for the sub-tab the
 * operator just left would overpaint the one they chose. The render token AND the sub-tab generation
 * are captured before the await and re-checked after it - BEFORE BOOKS is written and BEFORE the
 * strategy pickers are filled, because a stale answer must touch neither module state nor a live
 * <select> the operator may already be using. Pinned by tests/trading-ui-loader-guards.spec.ts.
 * @returns {Promise<void>} resolves once the roster is painted, or immediately if the render moved on
 */
async function loadRosterTab() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="spin"><span class="dot"></span> Loading accounts…</div>';
  try {
    const j = await api('/accounts');
    if (stale(token) || tabStale(gen)) return;
    BOOKS = j.books || [];
    const stratCell = (b) => {
      const cur = b.strategy
        ? '<span class="ok">' + esc(b.strategy.name) + '</span> <span class="foot">@ ' + b.strategy.applyPct + '%</span>'
        : '<span class="ok">Production baseline</span> <span class="foot" title="The live-tuned engine configuration (the Strategy Lab tab shows its exact knobs). Every account runs this until you Set a named strategy.">(engine config)</span>';
      return cur +
        '<div style="margin-top:4px;display:flex;gap:4px;align-items:center">' +
        '<select id="stratPick-' + esc(b.bookId) + '" style="max-width:180px"><option value="">choose strategy…</option></select>' +
        '<button class="btn ghost sm" data-act="set" data-book="' + esc(b.bookId) + '">Set</button>' +
        (b.strategy ? '<button class="btn ghost sm" data-act="reset" data-book="' + esc(b.bookId) + '" title="Back to the Production baseline">Reset</button>' : '') +
        '</div>';
    };
    const bookRow = (b) =>
      '<tr><td><strong>' + esc(b.label && b.label !== b.ref ? b.label : b.ref) + '</strong>' + (b.accountMasked ? ' <span class="foot">' + esc(b.accountMasked) + '</span>' : '') + (b.learn ? ' <span class="foot" title="This book trains the signal weights">learn</span>' : '') + '</td>' +
      '<td>' + esc(b.kind) + '</td>' +
      '<td>' + (b.enabled ? '<span class="ok">TRADING</span>' : '<span class="foot">view-only</span>') + '</td>' +
      '<td>' + stratCell(b) + '</td>' +
      '<td class="num">' + (b.capitalCapUsd != null ? money(b.capitalCapUsd) : '—') + '</td>' +
      '<td>' + (b.ref === 'paper' ? '<span class="foot">always on</span>'
        : '<button class="btn ghost sm" data-act="toggle" data-book="' + esc(b.bookId) + '">' + (b.enabled ? 'Stop trading' : 'Start trading…') + '</button>') + '</td></tr>';
    host.innerHTML =
      (j.multiAccountEnabled ? '' :
        '<div class="panel"><div class="foot">Multi-account dispatch is <strong>not armed yet</strong> (TRADING_MULTI_ACCOUNT is off — the ADR-134 cutover flips it). ' +
        'Discovery and book setup work now; per-account trading starts at cutover.</div></div>') +
      '<div class="panel" id="rosterHost"><h2>Your accounts — strategy & trading control</h2>' +
        '<div class="foot" style="margin-bottom:8px">One row per account: what it runs and whether it trades. Set a saved strategy from the dropdown (takes effect on the next engine cycle); Reset returns it to the Production baseline; Start trading… arms it. Build and test strategies in the Strategy Lab / Studio tabs — selection happens HERE or on the account page.</div>' +
        '<table><thead><tr><th>Account</th><th>Kind</th><th>State</th><th>Strategy</th><th class="num">Capital cap</th><th></th></tr></thead><tbody>' +
        BOOKS.map(bookRow).join('') + '</tbody></table></div>';
    wireRoster($('rosterHost'));
    fillStrategyPickers();
  } catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; }
}
/**
 * @description One delegated listener for the whole roster table — strict CSP allows no handler
 * attribute, so each button carries data-act + data-book and the action is dispatched here.
 * @param {HTMLElement|null} panel - The #rosterHost panel just painted.
 * @returns {void}
 */
function wireRoster(panel) {
  if (!panel) return;
  panel.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || !panel.contains(b)) return;
    e.preventDefault();
    rosterAction(b.getAttribute('data-act'), b.getAttribute('data-book'));
  };
}
/**
 * @description Run one roster action for a book. Only the BOOK ID rides the markup: the trading
 * state (and so the direction Start/Stop moves it) is resolved from BOOKS at CLICK time, so a row
 * painted before a state change can never send the stale flag the old baked argument carried.
 * @param {string} act - set | reset | toggle.
 * @param {string} bookId - The book the clicked row belongs to.
 * @returns {void}
 */
function rosterAction(act, bookId) {
  if (!bookId) return;
  if (act === 'set') { setBookStrategy(bookId); return; }
  if (act === 'reset') { resetBookStrategy(bookId); return; }
  if (act !== 'toggle') return;
  const b = BOOKS.find(x => x.bookId === bookId);
  if (b) toggleBook(bookId, !b.enabled);
}
/* Fill every row's strategy <select> from the saved Strategy Library (one fetch). */
async function fillStrategyPickers() {
  try {
    const j = await labApi('/strategies');
    const opts = (j.strategies || []).map(st => '<option value="' + esc(st.id) + '">' + esc(st.name) + '</option>').join('');
    for (const b of BOOKS) {
      const sel = $('stratPick-' + b.bookId);
      if (sel) sel.innerHTML = '<option value="">' + (b.strategy ? 'switch strategy…' : 'Production baseline (current)') + '</option>' + opts;
    }
  } catch { /* library unavailable — Set will explain */ }
}
/* Label is resolved from BOOKS at call time — never passed through an inline onclick string (a label
   with an apostrophe would break the handler). */
function bookLabelById(bookId) { const b = BOOKS.find(x => x.bookId === bookId); return b ? bookLabel(b.ref) : String(bookId); }
async function setBookStrategy(bookId, label) {
  label = label || bookLabelById(bookId);
  const sel = $('stratPick-' + bookId);
  const stratId = sel && sel.value;
  if (!stratId) { alert('Pick a strategy from the dropdown first.'); return; }
  const stratName = sel.options[sel.selectedIndex].text;
  const pctRaw = prompt('Run "' + stratName + '" on ' + label + ' at what % of the book? (100 = as designed)', '100');
  if (pctRaw == null) return;
  const applyPct = Math.max(1, Math.min(100, Math.round(Number(pctRaw) || 100)));
  if (!confirm('Set strategy for ' + label + '?\n\n' + stratName + ' @ ' + applyPct + '%\n\nThis account ONLY. Takes effect on the next engine cycle' + '. It still trades nothing until the account is set to trading.')) return;
  try {
    await api('/accounts/books/' + bookId + '/strategy', jbody('POST', { strategyId: stratId, applyPct, confirm: true }));
  } catch (e) { alert('Set failed: ' + e.message); }
  try { await loadBooks(); } catch { /* the roster reload below re-fetches on its own */ }
  if (VIEW === 'account' || VIEW === 'accounts') navigate(VIEW, { book: BOOK, kind: MODE, sub: SUB }); else loadRosterTab();
}
async function resetBookStrategy(bookId, label) {
  label = label || bookLabelById(bookId);
  if (!confirm('Reset ' + label + ' to the Production baseline?\n\nIts applied strategy stops driving it on the next cycle (kept in history). Other accounts untouched.')) return;
  try { await api('/accounts/books/' + bookId + '/strategy', { method: 'DELETE' }); } catch (e) { alert('Reset failed: ' + e.message); }
  try { await loadBooks(); } catch { /* the roster reload below re-fetches on its own */ }
  if (VIEW === 'account' || VIEW === 'accounts') navigate(VIEW, { book: BOOK, kind: MODE, sub: SUB }); else loadRosterTab();
}
async function makeBook(accountId, label) {
  const name = prompt('Label for the new trading book on ' + label + ':', label);
  if (!name) return;
  if (!confirm('Create a live trading book on ' + label + '?\nIt is created DISABLED — you enable it explicitly after assigning a strategy.')) return;
  try { await api('/accounts/books', jbody('POST', { accountId, label: name, confirm: true })); } catch (e) { alert(e.message); }
  try { await loadBooks(); } catch { /* the roster reload below re-fetches on its own */ }
  if (VIEW === 'account' || VIEW === 'accounts') navigate(VIEW, { book: BOOK, kind: MODE, sub: SUB }); else loadRosterTab();
}
async function toggleBook(bookId, enable) {
  const bk = BOOKS.find(b => b.bookId === bookId); const nm = bk && bk.label ? bk.label : bookId;
  // A second account needs BOTH acts: this flag, and the arming acknowledgement acknowledgeArming()
  // records. Promising REAL orders on the strength of this one alone is a promise the dispatch does
  // not keep - a leg pinned to an unacknowledged book fires nothing at all.
  const unarmed = bk && bk.armAckRequired && !bk.armAckAt
    ? '\n\nThis account is NOT armed: an autopilot leg for it still fires nothing until you use Arm autopilot and read what it says.'
    : '';
  if (enable && !confirm('START TRADING on ' + nm + '?\n\nThe engine will place REAL orders on this account using its assigned strategy, on its next cycle. Stop any time from this row.' + unarmed)) return;
  try { await api('/accounts/books/' + bookId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(enable ? { enabled: true, confirm: true } : { enabled: false }) }); } catch (e) { alert(e.message); }
  try { await loadBooks(); } catch { /* the roster reload below re-fetches on its own */ }
  if (VIEW === 'account' || VIEW === 'accounts') navigate(VIEW, { book: BOOK, kind: MODE, sub: SUB }); else loadRosterTab();
}

/**
 * @description The arming acknowledgement for one account — the deliberate second act a NON-LEGACY
 *   book needs before an autopilot leg pinned to it fires anything. The wording is the contract:
 *   every line of it is what the engine does TODAY (ADR-159 for a holding it cannot account for,
 *   ADR-138 for pinned lots), not what it did before the engine stopped managing what it did not buy.
 * @param {string} bookId - The book being armed, or handed back to the operator.
 * @returns {Promise<void>} Resolves once the roster / account view has been repainted.
 */
async function acknowledgeArming(bookId) {
  const bk = BOOKS.find(b => b.bookId === bookId); const nm = bk && bk.label ? bk.label : bookId;
  const armed = !!(bk && bk.armAckAt);
  if (armed) {
    if (!confirm('Withdraw the autopilot arming on ' + nm + '?\n\nAn autopilot leg for this account stops firing entirely: no rotation buys, no pinned-lot exits. Positions and working orders already at the venue are untouched.')) return;
  } else if (!confirm(
    'ARM THE AUTOPILOT on ' + nm + '?\n\n' +
    'Until this is recorded, an autopilot leg for this account fires NOTHING. What changes when it is:\n\n' +
    '\u2022 It BUYS. Rotation deploys this account\u2019s idle cash into the engine\u2019s own picks, on its own schedule.\n' +
    '\u2022 A position you bought by hand is NOT sold, trimmed or topped up by rotation, and gets no engine stop \u2014 the engine manages only what its own filled orders account for. It stays visible, marked unmanaged.\n' +
    '\u2022 A pinned lot places REAL GTC sell orders at the venue for the shares its own entry bought.\n' +
    '\u2022 Everything held here still counts toward exposure, the capital cap and the drawdown breaker.\n\n' +
    'You can withdraw this at any time from the same button.')) return;
  try { await api('/accounts/books/' + encodeURIComponent(bookId) + '/arm-ack', jbody('POST', armed ? { acknowledge: false } : { acknowledge: true, confirm: true })); }
  catch (e) { alert('Could not change the arming acknowledgement: ' + (e.message || 'unknown error')); }
  try { await loadBooks(); } catch { /* the repaint below shows what the server has */ }
  if (VIEW === 'account' || VIEW === 'accounts') navigate(VIEW, { book: BOOK, kind: MODE, sub: SUB }); else loadRosterTab();
}

/* ── Strategy Lab — sub-tab (ADR-092) ────────────────────────── */
let LAB = { strategies: [], selected: new Set(), chart: null, knobs: null, runsOpen: null };
const LAB_COLORS = ['#34c79a','#6aa5e3','#e3bd6a','#c98ae0','#ec7672','#7fd4d4','#b7c96a'];
/* A function declaration (not a const) so a sibling module that also needs the lab prefix can coexist. */
async function labApi(path, opts) { return api('/lab' + path, opts); }

function loadLab() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML =
    '<div id="labApplied"></div>' +
    '<div class="panel"><div class="panel head2"><h2 style="margin:0">Strategy Lab</h2>' +
      '<label class="foot" style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;margin-right:8px" title="Whole-share sizing: a $20K book and a $500K book do not trade alike. Defaults to the selected account\'s equity; blank = the $100K reference used by the nightly walks.">Backtest capital $<input id="labCash" type="number" min="1000" step="1000" placeholder="reading…" style="width:120px;padding:4px 6px" /></label>' +
      '<span class="foot" id="labMsg"></span>' +
      '<button class="btn ghost sm" id="labBlendBtn" title="Combine the CHECKED rotation strategies into one blend — e.g. 30% of the money on one, 20% on another, remainder in the core">Blend selected…</button>' +
      '<button class="btn ghost sm" id="labFwdAll" title="Advance every strategy&#39;s out-of-sample walk to the latest session">Forward-step all</button>' +
      '<button class="btn ghost sm" id="labRegAll" title="Re-run every baselined strategy over its pinned window and flag drift">Run regressions</button></div>' +
      '<div class="foot" style="margin-bottom:8px">Save strategy variations, backtest them, and let each one accrue an <strong>out-of-sample forward curve</strong> nightly. Regressions re-run pinned windows so an engine change that moves the numbers is caught automatically. Click a strategy name for its runs and its <strong>notes &amp; lessons journal</strong>; <strong>Apply…</strong> switches the selected account (' + esc(DISP) + ') onto it (part or all) until you Revert. Check ≥2 rotation strategies and hit <strong>Blend selected…</strong> to run several at once — "30% into this one, 20% into that one" — as one backtestable, appliable strategy.</div>' +
      '<div id="labList"><div class="spin"><span class="dot"></span> Loading strategies…</div></div></div>' +
    '<div class="panel"><div class="panel head2"><h2 style="margin:0">Equity curves</h2><span class="foot" style="margin-left:auto">solid = backtest · dashed = out-of-sample forward · gray = SPY</span></div>' +
      '<div id="labChart" style="height:320px;width:100%"></div><div id="labChartMsg" class="foot"></div><div id="labLegend" class="foot" style="margin-top:6px"></div></div>' +
    '<div class="panel"><div class="panel head2"><h2 style="margin:0">New variation</h2></div>' +
      '<div class="foot" style="margin-bottom:8px">Describe it in words and let the analyst fill the knobs — or set them by hand. Nothing saves until you hit Save; every knob is explained below.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><input id="labDraftText" placeholder="e.g. daily gravity rotation of the top 10, 50% SPY core, take profit at 20%" style="flex:1;min-width:280px">' +
      '<button class="btn ghost sm" id="labDraftBtn">Draft knobs from words</button></div>' +
      '<div id="labForm"></div><div id="labFormMsg" class="sub" style="margin-top:6px"></div></div>' +
    '<div class="panel"><div class="panel head2"><h2 style="margin:0">Knobs &amp; formulas — what the machine actually computes</h2></div><div id="labKnobs"><div class="spin"><span class="dot"></span></div></div></div>';
  $('labFwdAll').onclick = () => labRunAll('/forward-run', 'forward walks');
  $('labRegAll').onclick = () => labRunAll('/regression-run', 'regressions');
  $('labBlendBtn').onclick = labBlendSelected;
  $('labDraftBtn').onclick = labDraft;
  // Default the backtest capital to the SELECTED account's real equity (api() scopes /ledger to BOOK).
  LAB.accountEquity = null;
  api('/ledger').then(j => {
    const eq = j && j.account ? Number(j.account.equity) : NaN; const el = $('labCash');
    if (Number.isFinite(eq) && eq >= 1000) { LAB.accountEquity = eq; if (el && !el.value) { el.value = String(Math.round(eq)); el.title = 'Equity of ' + DISP + ' right now — edit to test another size; blank = $100,000 reference'; } }
    else if (el) el.placeholder = '100000 (reference)';
  }).catch(() => { const el = $('labCash'); if (el) el.placeholder = '100000 (reference)'; });
  renderLabForm();
  loadLabApplied();
  refreshLabList();
  loadLabKnobs();
}

/* ── applied-to-account panel (ADR-095) — what the autopilot actually runs, apply history, revert ── */
async function loadLabApplied() {
  const token = RENDER_TOKEN, gen = tabGen();
  const el = $('labApplied'); if (!el) return;
  try {
    const j = await labApi('/apply');
    if (stale(token) || tabStale(gen)) return;
    const a = j.active, env = j.envDefaults || {};
    const rotTxt = env.rotation && env.rotation.enabled
      ? env.rotation.rank + '/' + env.rotation.everyDays + 'd/top' + env.rotation.topN + '/' + env.rotation.weighting
      : 'scan sleeve (rotation off)';
    const envTxt = rotTxt + ' · posture ' + (env.posture || '?') + ' · core ' + ((env.core && env.core.symbols) || 'none') +
      ' · tp ' + (env.takeProfitPct != null ? env.takeProfitPct + '%' : '—') + ' · universe ' + (env.universeCount || '?');
    const hist = (j.history || []).filter(h => !h.active);
    el.innerHTML = '<div class="panel">' +
      '<div class="panel head2"><h2 style="margin:0">What account "' + esc(BOOK) + '" is running</h2><span class="foot" style="margin-left:auto" id="labAppMsg"></span>' +
        (a ? '<button class="btn ghost sm" id="labRevert" title="Back to env defaults on the next autopilot fire">Revert to env defaults</button>' : '') +
        (LAB.lastLogRow ? '<button class="btn ghost sm" id="labCopyLog" title="Copy the strategy-log.md row for this change">Copy log row</button>' : '') + '</div>' +
      (a
        ? '<div><span class="pill buy">APPLIED</span> <strong>' + esc(a.strategyName) + '</strong> <span class="foot">@ ' + a.applyPct + '% of the selected account (' + esc(DISP) + ') · since ' + fmtDate(a.createdAt) + '</span></div>' +
          '<div class="foot" style="margin-top:4px">' + esc(j.activeSummary || '') + '</div>' +
          '<div class="foot" style="margin-top:6px;opacity:.75">Env defaults (what Revert resumes): ' + esc(envTxt) + '</div>'
        : '<div><span class="pill">PRODUCTION BASELINE</span> <span class="foot">' + esc(envTxt) + '</span></div>' +
          '<div class="foot" style="margin-top:6px">This account runs the <strong>production baseline</strong> — the live-tuned engine configuration shown above (your July/August tuning lives here). To move it onto a named library strategy instead: <a href="#" data-act="roster"><strong>Account strategies</strong></a> → Set, or <strong>Set on ' + esc(DISP) + '…</strong> below.</div>') +
      (hist.length ? '<div class="foot" style="margin-top:8px;opacity:.75">Past applies (all accounts, audit trail — NOT what runs now): ' + hist.slice(0, 5).map(h =>
          esc(h.strategyName) + ' @ ' + h.applyPct + '% (' + fmtDate(h.createdAt) + ' → ' + (h.deactivatedAt ? fmtDate(h.deactivatedAt) : '…') + ')').join(' · ') +
          (hist.length > 5 ? ' · +' + (hist.length - 5) + ' more' : '') + '</div>' : '') +
      '<div class="foot" style="margin-top:6px;opacity:.6">Applying changes what the autopilot trades on its NEXT fire, on the selected account (currently <strong>' + esc(DISP) + '</strong>). Every apply/revert returns a strategy-log.md row — paste it into docs/apps/trading/strategy-log.md (the log rule stands).</div></div>';
    if (a) { const b = $('labRevert'); if (b) b.onclick = labRevert; }
    const c = $('labCopyLog'); if (c) c.onclick = () => copyText(LAB.lastLogRow, $('labAppMsg'));
    // The 'Account strategies' link is delegated (strict CSP: no handler attribute); assignment, not
    // addEventListener, so re-painting this panel cannot stack a second listener.
    el.onclick = (e) => {
      const a2 = e.target.closest('[data-act="roster"]');
      if (!a2 || !el.contains(a2)) return;
      e.preventDefault();
      navigate('strategies', { sub: 'roster' });
    };
  } catch (e) { if (!stale(token) && !tabStale(gen)) el.innerHTML = '<div class="panel"><div class="foot err">' + esc(e.message) + '</div></div>'; }
}
function copyText(text, msgEl) {
  const done = () => { if (msgEl) { msgEl.textContent = 'copied ✓'; setTimeout(() => { msgEl.textContent = ''; }, 1800); } };
  try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); }
  catch { fallbackCopy(text, done); }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
  ta.select(); try { document.execCommand('copy'); } catch {} document.body.removeChild(ta); done();
}
async function labApply(id) {
  const s = LAB.strategies.find(x => x.id === id); if (!s) return;
  const cfg = s.config || {};
  const pctRaw = prompt(
    'Run "' + s.name + '" on what percent of the selected account (' + DISP + ')?\n\n' +
    '100 = the strategy exactly as designed (its own core/sleeve split).\n' +
    'Lower = only that share of its designed sleeve trades; the remainder parks in the ' + (cfg.coreSymbol || 'SPY') + ' core.', '100');
  if (pctRaw == null) return;
  const applyPct = Math.max(1, Math.min(100, Math.round(Number(pctRaw) || 100)));
  const knobs = cfg.kind === 'blend'
    ? 'BLEND: ' + (cfg.components || []).map(x => x.weightPct + '% ' + x.name).join(' + ') +
      ' · core ' + cfg.corePct + '% ' + (cfg.coreSymbol || 'SPY') + ' · exits: most-conservative component'
    : (cfg.kind === 'rotation'
        ? 'rotation ' + cfg.rank + '/' + cfg.cadenceDays + 'd/top' + cfg.topN + '/' + cfg.weighting
        : 'ensemble scan') +
      ' · posture ' + cfg.posture + ' · designed core ' + cfg.corePct + '% ' + (cfg.coreSymbol || 'SPY') +
      ' · tp ' + (cfg.takeProfitPct == null ? 'posture-default' : cfg.takeProfitPct + '%') +
      ' · universe ' + ((cfg.universe || []).length ? (cfg.universe || []).length + ' pinned' : 'default');
  if (!confirm('APPLY to ' + bookLabel(BOOK) + ' @ ' + applyPct + '%?\n\n' + s.name + '\n' + knobs +
    '\n\nThis changes what the autopilot trades on its NEXT fire on the SELECTED ACCOUNT ONLY (' + bookLabel(BOOK) + '). Env knobs stay untouched and resume on Revert.')) return;
  try {
    const j = await labApi('/strategies/' + id + '/apply', jbody('POST', { applyPct, confirm: true, book: BOOK }));
    LAB.lastLogRow = j.logRow || '';
    $('labMsg').textContent = 'Applied — ' + ((j.effective && j.effective.summary) || '');
    await refreshLabList(); loadLabApplied(); loadBooks().catch(() => { /* header/roster refresh only — the apply itself succeeded */ });
  } catch (e) { $('labMsg').textContent = e.message; }
}
/* Blend builder — checked rotation strategies → one weighted portfolio strategy ("30% A + 20% B"). */
async function labBlendSelected() {
  const picked = LAB.strategies.filter(s => LAB.selected.has(s.id));
  const rot = picked.filter(s => (s.config || {}).kind === 'rotation');
  if (rot.length < 2) { $('labMsg').textContent = 'Check at least 2 ROTATION strategies (the checkboxes on the left), then Blend.'; return; }
  if (rot.length < picked.length) $('labMsg').textContent = (picked.length - rot.length) + ' non-rotation selection(s) skipped — blends take rotation components only.';
  const components = [];
  const equal = Math.floor(100 / (rot.length + 1)); // leave room for a core by default
  for (const s of rot) {
    const w = prompt('Percent of the money for:\n"' + s.name + '"\n\n(The unallocated remainder becomes the SPY core.)', String(equal));
    if (w == null) return;
    const pct = Math.round(Number(w));
    if (!(pct >= 1 && pct <= 95)) { $('labMsg').textContent = 'Weights must be 1–95%.'; return; }
    components.push({ strategyId: s.id, weightPct: pct, _name: s.name });
  }
  const total = components.reduce((t, c) => t + c.weightPct, 0);
  if (total > 100) { $('labMsg').textContent = 'Weights sum to ' + total + '% — must be ≤ 100.'; return; }
  const name = prompt('Name this blend:', components.map(c => c.weightPct + '% ' + c._name.split(' ')[0]).join(' + ') + (total < 100 ? ' + ' + (100 - total) + '% core' : ''));
  if (!name) return;
  try {
    await labApi('/strategies', jbody('POST', {
      name: name.trim(),
      description: 'Blend: ' + components.map(c => c.weightPct + '% ' + c._name).join(' + ') + (total < 100 ? ' · ' + (100 - total) + '% SPY core' : ''),
      config: { kind: 'blend', coreSymbol: 'SPY', components: components.map(c => ({ strategyId: c.strategyId, weightPct: c.weightPct })) },
    }));
    $('labMsg').textContent = 'Blend saved — hit Backtest to see what the mix would have done.';
    await refreshLabList();
  } catch (e) { $('labMsg').textContent = e.message; }
}
async function labRevert() {
  if (!confirm('Revert ' + bookLabel(BOOK) + ' to the Production baseline?\n\nThe applied strategy stops driving this book on its next fire; the override is kept in history. Other books are untouched.')) return;
  try {
    const j = await labApi('/apply/revert', jbody('POST', { book: BOOK }));
    LAB.lastLogRow = j.logRow || '';
    await refreshLabList(); loadLabApplied(); loadBooks().catch(() => { /* header/roster refresh only — the revert itself succeeded */ });
  } catch (e) { const m = $('labAppMsg'); if (m) m.textContent = e.message; }
}

async function refreshLabList() {
  const el = $('labList'); if (!el) return;
  try {
    const j = await labApi('/strategies');
    LAB.strategies = j.strategies || [];
    if (!LAB.strategies.length) { el.innerHTML = '<div class="foot">No saved strategies yet. The armed production shape is pre-filled below — hit Save, then Backtest.</div>'; return; }
    const rows = LAB.strategies.map((s, i) => {
      const m = (s.latestBacktest && s.latestBacktest.metrics) || null;
      const cfg = s.config || {};
      const knobs = cfg.kind==='blend'
        ? 'BLEND: ' + (cfg.components||[]).map(x => x.weightPct + '% ' + x.name).join(' + ')
        : cfg.kind==='rotation'
          ? cfg.rank + '/' + cfg.cadenceDays + 'd/top' + cfg.topN + '/' + cfg.weighting
          : 'ensemble scan';
      const extras = cfg.kind==='blend'
        ? (cfg.corePct>0 ? ' · core ' + cfg.corePct + '% ' + esc(cfg.coreSymbol||'SPY') : '') + ' · conservative exits'
        : (cfg.corePct>0 ? ' · core ' + cfg.corePct + '% ' + esc(cfg.coreSymbol||'SPY') : '') + (cfg.takeProfitPct!=null ? ' · tp ' + cfg.takeProfitPct + '%' : '') + ' · ' + esc(cfg.posture);
      // HEADLINE = excess over SPY for the same window (the honest yardstick); total return second.
      const met = m ? '<span class="'+cls(m.alphaVsSpyPct)+'" title="Strategy return minus SPY over the same window"><b>'+pct(m.alphaVsSpyPct)+' vs SPY</b></span> · total '+pct(m.totalReturnPct)+' · DD '+Number(m.maxDrawdownPct).toFixed(1)+'% · Sharpe '+Number(m.sharpe).toFixed(2)+(m.startCash ? ' <span class="foot" title="Starting capital of that backtest">@ '+money(m.startCash)+'</span>' : '') : '<span class="foot">not backtested</span>';
      const fwd = s.forwardPoints ? s.forwardPoints + ' sessions' + (s.forwardLast ? ' · ' + money(s.forwardLast.e) : '') : '—';
      // TRUTH over lifecycle labels: the green chip appears ONLY when a book's active override
      // actually came from this strategy (appliedOn), naming the book(s). The stored 'armed'
      // status is a shelf label ("production-worthy"), shown neutrally.
      const chip = (s.appliedOn && s.appliedOn.length)
        ? '<span class="pill buy" title="A book is actively running this strategy">RUNNING ON ' + esc(s.appliedOn.join(', ').toUpperCase()) + '</span>'
        : s.status==='armed' ? '<span class="pill" title="Marked production-worthy — not currently applied to any account">READY</span>'
        : s.status==='retired' ? '<span class="pill" style="opacity:.6">RETIRED</span>' : '<span class="pill">CANDIDATE</span>';
      const journal = s.notesCount ? ' <span class="foot" title="notes · lessons — click the name to read">📝' + s.notesCount + (s.lessonsCount ? ' 🎓' + s.lessonsCount : '') + '</span>' : '';
      return '<tr>' +
        '<td><input type="checkbox" data-sel="' + s.id + '"' + (LAB.selected.has(s.id)?' checked':'') + '></td>' +
        '<td><strong style="cursor:pointer" data-runs="' + s.id + '" title="' + esc(s.description||'') + '">' + esc(s.name) + '</strong>' + journal + '<div class="foot">' + esc(knobs + extras) + '</div></td>' +
        '<td>' + chip + '</td><td>' + met + '</td><td class="foot">' + fwd + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn ghost sm" data-bt="' + s.id + '">Backtest</button> ' +
          '<button class="btn ghost sm" data-fw="' + s.id + '">Forward</button> ' +
          '<button class="btn ghost sm" data-apply="' + s.id + '" title="Put this strategy on the selected account (' + esc(DISP) + ') — same action as Set on the Account strategies roster">Set on ' + esc(DISP) + '…</button> ' +
          '<button class="btn ghost sm" data-arm="' + s.id + '" title="Shelf label only — running a strategy on an account happens in Account strategies">' + (s.status==='armed'?'Shelve':'Mark ready') + '</button> ' +
          '<button class="btn ghost sm" data-del="' + s.id + '" title="Delete strategy + its runs">✕</button></td></tr>';
    }).join('');
    el.innerHTML = '<table style="width:100%"><thead><tr><th></th><th>Strategy</th><th>Status</th><th>Latest backtest</th><th>Forward (out-of-sample)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table><div id="labRuns"></div>';
    el.querySelectorAll('input[data-sel]').forEach(c => c.onchange = () => { const id=c.getAttribute('data-sel'); if (c.checked) LAB.selected.add(id); else LAB.selected.delete(id); drawLabChart(); });
    el.querySelectorAll('button[data-bt]').forEach(b => b.onclick = () => labBacktest(b.getAttribute('data-bt'), b));
    el.querySelectorAll('button[data-fw]').forEach(b => b.onclick = () => labAct(b, 'POST', '/strategies/' + b.getAttribute('data-fw') + '/forward'));
    el.querySelectorAll('button[data-apply]').forEach(b => b.onclick = () => labApply(b.getAttribute('data-apply')));
    el.querySelectorAll('button[data-arm]').forEach(b => { const s = LAB.strategies.find(x=>x.id===b.getAttribute('data-arm')); b.onclick = () => labPatch(s.id, { status: s.status==='armed' ? 'retired' : 'armed' }); });
    el.querySelectorAll('button[data-del]').forEach(b => b.onclick = () => { if (confirm('Delete this strategy and all its saved runs?')) labAct(b, 'DELETE', '/strategies/' + b.getAttribute('data-del')); });
    el.querySelectorAll('[data-runs]').forEach(n => n.onclick = () => showLabRuns(n.getAttribute('data-runs')));
    if (!LAB.selected.size && LAB.strategies.length) { LAB.selected.add(LAB.strategies[0].id); const c = el.querySelector('input[data-sel="'+LAB.strategies[0].id+'"]'); if (c) c.checked = true; }
    drawLabChart();
  } catch (e) { el.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}

async function showLabRuns(id) {
  const el = $('labRuns'); if (!el) return;
  LAB.runsOpen = id;
  el.innerHTML = '<div class="spin"><span class="dot"></span></div>';
  try {
    const j = await labApi('/strategies/' + id);
    const rows = (j.runs || []).map(r => {
      const m = r.metrics || {};
      const st = r.status==='ok' ? '<span class="ok">ok</span>' : r.status==='drifted' ? '<span class="err">DRIFTED</span>' : '<span class="err">failed</span>';
      const drift = m.deltas ? ' <span class="foot" title="delta vs pinned baseline">Δret ' + Number(m.deltas.totalReturnPct).toFixed(2) + ' · Δdd ' + Number(m.deltas.maxDrawdownPct).toFixed(2) + ' · Δtrades ' + m.deltas.trades + '</span>' : '';
      return '<tr><td>' + esc(r.kind) + '</td><td>' + st + drift + '</td><td class="foot">' + esc((r.windowStart||'—') + ' → ' + (r.windowEnd||'—')) + ' (' + r.bars + ' bars)' + (m.startCash ? ' · @ ' + money(m.startCash) : '') + '</td>' +
        '<td>' + (m.alphaVsSpyPct!=null ? '<span class="'+cls(m.alphaVsSpyPct)+'"><b>'+pct(m.alphaVsSpyPct)+'</b> vs SPY</span> · ' : '') + (m.totalReturnPct!=null ? '<span class="'+cls(m.totalReturnPct)+'">'+pct(m.totalReturnPct)+'</span> total' : '—') + '</td>' +
        '<td class="foot">' + (m.maxDrawdownPct!=null ? Number(m.maxDrawdownPct).toFixed(1)+'%' : '—') + '</td>' +
        '<td class="foot">' + (m.sharpe!=null ? Number(m.sharpe).toFixed(2) : '—') + '</td>' +
        '<td class="foot">' + esc(r.feed) + (r.gitSha ? ' @ ' + esc(r.gitSha) : '') + '</td><td class="foot">' + fmtDate(r.createdAt) + '</td>' +
        (r.error ? '<td class="foot err">' + esc(r.error) + '</td>' : '<td></td>') + '</tr>';
    }).join('');
    const s = LAB.strategies.find(x=>x.id===id);
    el.innerHTML = '<div class="foot" style="margin:10px 0 4px"><strong>' + esc(s ? s.name : 'runs') + '</strong> — every saved run (newest first). The ★ baseline is what regressions replay.</div>' +
      '<table style="width:100%"><thead><tr><th>kind</th><th>status</th><th>window</th><th>return</th><th>maxDD</th><th>Sharpe</th><th>feed@sha</th><th>when</th><th></th></tr></thead><tbody>' + (rows || '<tr><td class="foot" colspan="9">no runs yet</td></tr>') + '</tbody></table>' +
      '<div id="labNotes"><div class="spin"><span class="dot"></span></div></div>';
    renderLabNotes(id);
  } catch (e) { el.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}

/* ── notes & lessons journal per strategy (ADR-095) ──────────── */
async function renderLabNotes(id) {
  const el = $('labNotes'); if (!el || LAB.runsOpen !== id) return;
  const icon = k => k==='lesson' ? '🎓' : k==='decision' ? '⚖️' : '📝';
  try {
    const j = await labApi('/strategies/' + id + '/notes');
    const items = (j.notes || []).map(n =>
      '<div class="sig" style="margin-bottom:6px">' + icon(n.kind) + ' <span class="foot" style="text-transform:uppercase;letter-spacing:.4px">' + esc(n.kind) + '</span>' +
      ' <span class="foot" style="opacity:.65">' + fmtDate(n.createdAt) + '</span>' +
      '<button class="btn ghost sm" data-ndel="' + n.id + '" title="Delete note" style="float:right;padding:1px 7px">✕</button>' +
      '<div style="margin-top:4px;white-space:pre-wrap;font-size:13px;line-height:1.5">' + esc(n.body) + '</div></div>').join('');
    el.innerHTML =
      '<div class="foot" style="margin:14px 0 6px"><strong>Notes &amp; lessons learned</strong> — the journal for this configuration (what we tested, what the verdict was, what to remember).</div>' +
      (items || '<div class="foot" style="margin-bottom:6px">No notes yet — record the verdict, the surprise, the lesson.</div>') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:8px">' +
        '<select id="labNoteKind"><option value="note">📝 note</option><option value="lesson">🎓 lesson</option><option value="decision">⚖️ decision</option></select>' +
        '<textarea id="labNoteBody" placeholder="e.g. Sweep verdict, root cause, arming bar, what NOT to retry…" style="flex:1;min-width:260px;min-height:52px"></textarea>' +
        '<button class="btn primary sm" id="labNoteAdd">Add</button></div>';
    $('labNoteAdd').onclick = async () => {
      const body = $('labNoteBody').value.trim(); if (!body) return;
      try { await labApi('/strategies/' + id + '/notes', jbody('POST', { body, kind: $('labNoteKind').value })); await refreshLabList(); LAB.runsOpen = id; showLabRuns(id); }
      catch (e) { $('labMsg').textContent = e.message; }
    };
    el.querySelectorAll('button[data-ndel]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this note?')) return;
      try { await labApi('/strategies/' + id + '/notes/' + b.getAttribute('data-ndel'), { method: 'DELETE' }); await refreshLabList(); LAB.runsOpen = id; showLabRuns(id); }
      catch (e) { $('labMsg').textContent = e.message; }
    });
  } catch (e) { el.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}

/* The capital a Lab backtest starts from: the input if the operator set one, else the selected
   account's equity (read once per Lab load), else the $100K reference. Whole shares → this matters. */
function labStartCash() {
  const el = $('labCash'); const v = el ? Number(String(el.value).replace(/[^0-9.]/g, '')) : NaN;
  if (Number.isFinite(v) && v >= 1000) return Math.round(v);
  return LAB.accountEquity && LAB.accountEquity >= 1000 ? Math.round(LAB.accountEquity) : null;
}
async function labBacktest(id, btn) {
  btn.disabled = true; btn.textContent = 'Running…';
  const cash = labStartCash();
  $('labMsg').textContent = 'Backtest running at ' + (cash ? money(cash) : '$100,000 (reference)') + ' — a 2-year, full-universe walk takes 10–30 s.';
  try { await labApi('/strategies/' + id + '/backtest', jbody('POST', cash ? { startCash: cash } : {})); $('labMsg').textContent = ''; await refreshLabList(); if (LAB.runsOpen===id) showLabRuns(id); }
  catch (e) { $('labMsg').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Backtest'; }
}
async function labAct(btn, method, path) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = '…';
  try { await labApi(path, method==='DELETE' ? { method:'DELETE' } : jbody('POST', {})); await refreshLabList(); }
  catch (e) { $('labMsg').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
}
async function labPatch(id, patch) {
  try { await labApi('/strategies/' + id, jbody('PATCH', patch)); await refreshLabList(); }
  catch (e) { $('labMsg').textContent = e.message; }
}
async function labRunAll(path, label) {
  $('labMsg').textContent = 'Running ' + label + '…';
  try {
    const j = await labApi(path, jbody('POST', {}));
    $('labMsg').textContent = path==='/regression-run'
      ? 'Regressions: ' + (j.verdicts||[]).length + ' run, ' + (j.drifted||0) + ' drifted, ' + (j.failed||0) + ' failed.'
      : 'Forward: ' + (j.results||[]).reduce((s,r)=>s+(r.applied||0),0) + ' sessions applied across ' + (j.results||[]).length + ' strategies.';
    await refreshLabList();
  } catch (e) { $('labMsg').textContent = e.message; }
}

async function drawLabChart() {
  const el = $('labChart'), msg = $('labChartMsg'), leg = $('labLegend'); if (!el) return;
  if (LAB.chart) { try { LAB.chart.remove(); } catch {} LAB.chart = null; }
  if (!window.LightweightCharts) { msg.innerHTML = '<span class="err">chart lib missing</span>'; return; }
  const ids = [...LAB.selected]; leg.innerHTML = '';
  if (!ids.length) { msg.textContent = 'Select a strategy above to chart its curves.'; return; }
  msg.textContent = 'loading curves…';
  const css = getComputedStyle(document.documentElement); const line = (v,d)=> (css.getPropertyValue(v).trim()||d);
  LAB.chart = LightweightCharts.createChart(el, { width: el.clientWidth, height: 320,
    layout:{ background:{ type:'solid', color:'transparent' }, textColor: line('--muted','#8a99a3') },
    grid:{ vertLines:{ color: line('--line','#26333f') }, horzLines:{ color: line('--line','#26333f') } },
    rightPriceScale:{ borderColor: line('--line','#26333f') }, timeScale:{ borderColor: line('--line','#26333f') }, crosshair:{ mode:0 } });
  let spyDrawn = false; const legends = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      const detail = await labApi('/strategies/' + ids[i]);
      const s = detail.strategy;
      const runId = s.baselineRunId || ((detail.runs||[]).find(r => r.kind==='backtest' && r.status==='ok') || {}).id;
      const color = LAB_COLORS[i % LAB_COLORS.length];
      if (runId) {
        const rr = await labApi('/runs/' + runId);
        const curve = (rr.run && rr.run.curve) || [];
        if (curve.length) {
          LAB.chart.addLineSeries({ color, lineWidth: 2, title: s.name }).setData(curve.map(p => ({ time: p.d, value: p.e })));
          if (!spyDrawn) { LAB.chart.addLineSeries({ color: line('--muted','#8a99a3'), lineWidth: 1, lineStyle: 2, title: 'SPY' }).setData(curve.map(p => ({ time: p.d, value: p.s }))); spyDrawn = true; }
        }
      }
      const fwd = (detail.forward && detail.forward.points) || [];
      if (fwd.length) LAB.chart.addLineSeries({ color, lineWidth: 2, lineStyle: 2, title: s.name + ' (fwd)' }).setData(fwd.map(p => ({ time: p.d, value: p.e })));
      legends.push('<span style="color:' + color + '">■</span> ' + esc(s.name) + (fwd.length ? ' <span class="foot">(+' + fwd.length + ' fwd)</span>' : ''));
    } catch (e) { legends.push('<span class="err">' + esc(e.message) + '</span>'); }
  }
  LAB.chart.timeScale().fitContent();
  leg.innerHTML = legends.join(' · ');
  msg.textContent = '';
  try { new ResizeObserver(()=>{ if (LAB.chart && el.clientWidth) LAB.chart.applyOptions({ width: el.clientWidth }); }).observe(el); } catch {}
}

/* the new-variation form — defaults mirror the ARMED production config (2026-07-10 sweep) */
function renderLabForm(v) {
  v = v || { name:'', description:'', config:{ kind:'rotation', posture:'active', corePct:60, coreSymbol:'SPY', takeProfitPct:null, rank:'gravity', cadenceDays:1, topN:12, weighting:'conviction', universe:[], warmupDays:80, windowDays:780 } };
  const c = v.config;
  const opt = (list, cur) => list.map(o=>'<option'+(o===cur?' selected':'')+'>'+o+'</option>').join('');
  $('labForm').innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' +
    '<label class="foot">Name<input id="lfName" value="' + esc(v.name) + '" placeholder="my variation"></label>' +
    '<label class="foot">Kind<select id="lfKind">' + opt(['rotation','ensemble'], c.kind) + '</select></label>' +
    '<label class="foot">Posture<select id="lfPosture">' + opt(['conservative','balanced','aggressive','active'], c.posture) + '</select></label>' +
    '<label class="foot">Core % (SPY ballast)<input id="lfCore" type="number" min="0" max="90" value="' + c.corePct + '"></label>' +
    '<label class="foot">Core symbol<input id="lfCoreSym" value="' + esc(c.coreSymbol||'SPY') + '"></label>' +
    '<label class="foot">Take-profit % (blank = posture)<input id="lfTp" type="number" min="1" max="95" value="' + (c.takeProfitPct==null?'':c.takeProfitPct) + '"></label>' +
    '<label class="foot">Rank<select id="lfRank">' + opt(['gravity','momentum','ensemble','blend'], c.rank) + '</select></label>' +
    '<label class="foot">Cadence (days)<input id="lfCad" type="number" min="1" max="63" value="' + c.cadenceDays + '"></label>' +
    '<label class="foot">Top N<input id="lfTopN" type="number" min="1" max="64" value="' + c.topN + '"></label>' +
    '<label class="foot">Weighting<select id="lfWeight">' + opt(['conviction','equal'], c.weighting) + '</select></label>' +
    '<label class="foot">Window (calendar days)<input id="lfWin" type="number" min="200" max="2000" value="' + c.windowDays + '"></label>' +
    '</div>' +
    '<label class="foot" style="display:block;margin-top:8px">Universe (comma tickers; blank = default ~140)<input id="lfUni" value="' + esc((c.universe||[]).join(',')) + '" placeholder="default universe"></label>' +
    '<label class="foot" style="display:block;margin-top:8px">Description<input id="lfDesc" value="' + esc(v.description||'') + '"></label>' +
    '<div style="margin-top:10px"><button class="btn primary" id="lfSave">Save strategy</button></div>';
  $('lfSave').onclick = saveLabStrategy;
}
async function saveLabStrategy() {
  const msg = $('labFormMsg'); msg.className='sub'; msg.textContent = 'saving…';
  const tp = $('lfTp').value.trim();
  const body = {
    name: $('lfName').value.trim(), description: $('lfDesc').value.trim(),
    config: {
      kind: $('lfKind').value, posture: $('lfPosture').value,
      corePct: Number($('lfCore').value)||0, coreSymbol: $('lfCoreSym').value.trim().toUpperCase()||'SPY',
      takeProfitPct: tp==='' ? null : Number(tp),
      rank: $('lfRank').value, cadenceDays: Number($('lfCad').value)||1, topN: Number($('lfTopN').value)||12,
      weighting: $('lfWeight').value, windowDays: Number($('lfWin').value)||780, warmupDays: 80,
      universe: $('lfUni').value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),
    },
  };
  try { await labApi('/strategies', jbody('POST', body)); msg.className='sub ok'; msg.textContent = 'Saved. Now hit Backtest to give it a baseline.'; refreshLabList(); }
  catch (e) { msg.className='sub err'; msg.textContent = e.message; }
}
async function labDraft() {
  const msg = $('labFormMsg'); const text = $('labDraftText').value.trim();
  if (!text) { msg.className='sub err'; msg.textContent = 'Describe the strategy first.'; return; }
  msg.className='sub'; msg.textContent = 'The analyst is turning your words into knobs…';
  try { const j = await labApi('/draft', jbody('POST', { text })); renderLabForm(j); msg.className='sub ok'; msg.textContent = 'Drafted — review every knob (they are explained below), then Save.'; }
  catch (e) { msg.className='sub err'; msg.textContent = 'Draft failed: ' + e.message; }
}

// ── Strategy Studio: talk to the quant analyst — research-grounded design → real backtest → spoken narration.
const ST = { strategyId: null, chart: null, busy: false, rec: null, recognizing: false, eventMode: false };
function stEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function stAppend(role, text){ const log=$('stLog'); if(!log)return; const d=document.createElement('div'); d.className='st-msg st-'+role; d.textContent=text; log.appendChild(d); log.scrollTop=log.scrollHeight; }
function loadStudio(){
  const host=$('tabbody'); if(!host)return;
  host.innerHTML = '<style>' +
    '.st-wrap{max-width:960px}' +
    '.st-log{display:flex;flex-direction:column;gap:8px;margin:8px 0;max-height:320px;overflow:auto;padding:4px}' +
    '.st-msg{padding:8px 12px;border-radius:12px;max-width:82%;white-space:pre-wrap;line-height:1.45}' +
    '.st-you{align-self:flex-end;background:#2b6cb0;color:#fff}' +
    '.st-bot{align-self:flex-start;background:var(--panel2,#1b2530);border:1px solid var(--line,#26333f)}' +
    '.st-err{align-self:flex-start;background:#4a2020;color:#ffb3c8}' +
    '.st-row{display:flex;gap:8px;align-items:flex-end;margin-top:6px}' +
    '.st-row textarea{flex:1;min-height:46px;resize:vertical;padding:8px;border-radius:8px;background:var(--panel2,#1b2530);border:1px solid var(--line,#26333f);color:inherit}' +
    '.st-row button{padding:10px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--line,#26333f);background:var(--panel2,#1b2530);color:inherit}' +
    '#stSend{background:#34c79a;color:#04121c;border:none;font-weight:700}' +
    '.st-mic.recording{background:#c0392b;color:#fff}' +
    '.st-metrics{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}' +
    '.st-metric{background:var(--panel2,#1b2530);border:1px solid var(--line,#26333f);border-radius:8px;padding:8px 12px;min-width:96px}' +
    '.st-metric b{display:block;font-size:18px}' +
    '.st-cites{margin:10px 0;font-size:13px}' +
    '.st-cite{padding:6px 0;border-top:1px solid var(--line,#26333f)}' +
    '</style>' +
    '<div class="st-wrap">' +
    '<h3>Strategy Studio</h3>' +
    '<p class="sub">Talk to the quant analyst. Describe an idea — it references the published research, designs a strategy, runs a real ~2-year backtest, and explains it — or an event play: "the Anthropic IPO — get in near the IPO price, sell at +10% over it or stop out", which becomes an <b>event playbook</b> (a dry run instead of a backtest, armed on the selected account). Every design is saved to your Strategy Lab or Event playbooks, and <b>follow-up messages refine the same one in place</b> until you start a new one.</p>' +
    '<div id="stLog" class="st-log"></div>' +
    '<div class="st-row">' +
    '<textarea id="stInput" placeholder="e.g. a momentum rotation that avoids 2009-style crashes — or \'trend-following on the index\'"></textarea>' +
    '<button id="stMic" class="st-mic" title="Speak">&#127908;</button>' +
    '<button id="stSend">Design &rarr;</button>' +
    '</div>' +
    '<div id="stMode" class="sub"></div>' +
    '<div id="stStatus" class="sub"></div>' +
    '<div id="stResults"></div>' +
    '</div>';
  ST.strategyId=null; ST.currentName=null; ST.chart=null; ST.busy=false; ST.eventMode=false;
  $('stSend').onclick=studioSend;
  $('stMic').onclick=studioMic;
  $('stInput').addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); studioSend(); } });
  stAppend('bot', "Tell me what you want to trade and how — I'll ground it in the research. Try: \"a low-volatility tilt with a big SPY core,\" or \"cross-sectional momentum, top 10, monthly.\"");
}
async function studioSend(){
  const input=$('stInput'); const text=(input.value||'').trim();
  if(!text||ST.busy)return;
  input.value=''; stAppend('you', text); ST.busy=true; $('stSend').disabled=true;
  // An event turn ends in a dry run, not a backtest — never promise one.
  $('stStatus').textContent=ST.eventMode?'Researching → designing…':(ST.strategyId?'Refining → re-running the ~2-year backtest (10–30s)…':'Researching → designing → running a real ~2-year backtest (10–30s)…');
  try{
    const j=await labApi('/studio', jbody('POST', { message:text, strategyId:ST.strategyId }));
    if(j.needsInput){ stAppend('bot', j.message||'Tell me a bit more.'); studioSpeak(j.message||''); return; }
    ST.strategyId=j.strategyId; ST.currentName=j.name||null; ST.eventMode=(j.kind==='event');
    stAppend('bot', j.narration||(ST.eventMode?(j.refined?'Refined the event plan.':'Designed the event plan.'):(j.refined?'Refined and re-backtested.':'Designed and backtested.')));
    studioSpeak(j.narration||'');
    renderStudioResult(j);
    updateStudioMode();
  }catch(e){ stAppend('err','Failed: '+e.message); }
  finally{ ST.busy=false; $('stSend').disabled=false; $('stStatus').textContent=''; }
}
function updateStudioMode(){
  const el=$('stMode'); if(!el)return;
  el.innerHTML = ST.strategyId
    ? 'Refining '+(ST.eventMode?'event plan ':'')+'<b>'+stEsc(ST.currentName||(ST.eventMode?'this plan':'this strategy'))+'</b> — follow-up messages adjust it in place. <a href="#" id="stModeNew">Start a new strategy</a>'
    : '';
  const a=$('stModeNew'); if(a) a.onclick=(e)=>{ e.preventDefault(); studioNewStrategy(); };
}
function studioNewStrategy(){
  ST.strategyId=null; ST.currentName=null; ST.eventMode=false; updateStudioMode();
  stAppend('bot','Fresh slate — describe the next strategy or event play.');
}
async function studioApply(j){
  const pctRaw=prompt(
    'Run "'+j.name+'" on what percent of the selected account ('+DISP+')?\n\n'+
    '100 = the strategy exactly as designed (its own core/sleeve split).\n'+
    'Lower = only that share of its designed sleeve trades; the remainder parks in the core.', '100');
  if(pctRaw==null)return;
  const applyPct=Math.max(1,Math.min(100,Math.round(Number(pctRaw)||100)));
  if(!confirm('APPLY to book "'+BOOK+'" @ '+applyPct+'%?\n\n'+j.name+'\n'+(j.knobSummary||'')+
    '\n\nThis changes what the autopilot trades on its NEXT fire on the SELECTED BOOK ONLY ('+BOOK+'). Env knobs stay untouched and resume on Revert.'))return;
  try{
    const r=await labApi('/strategies/'+j.strategyId+'/apply', jbody('POST', { applyPct, confirm:true, book: BOOK }));
    stAppend('bot','Applied at '+applyPct+'% of the selected account ('+DISP+') — '+((r.effective&&r.effective.summary)||'')+' It drives the autopilot from its next fire; revert any time from the Strategy Lab (or ask me for something safer first).');
    loadBooks().catch(() => { /* header/roster refresh only — the apply itself succeeded */ });
  }catch(e){ stAppend('err','Apply failed: '+e.message); }
}
/* The research citations block — shared by the classic (backtest) card and the event-plan card. */
function studioCitesHtml(citations){
  return (citations||[]).map(c=>'<div class="st-cite">'+stEsc(c.name)+' — '+stEsc(c.authors)+' ('+stEsc(c.year)+'), '+stEsc(c.journal)+' &middot; <a href="'+stEsc(c.url)+'" target="_blank" rel="noopener">source</a></div>').join('')||'<div class="st-cite sub">—</div>';
}
function renderStudioResult(j){
  if(j.kind==='event'){ renderStudioEventResult(j); return; }
  const host=$('stResults'); if(!host)return; const m=j.metrics||{};
  const f=(v,d)=>(v==null||isNaN(Number(v)))?'—':Number(v).toFixed(d==null?2:d);
  const cites=studioCitesHtml(j.citations);
  host.innerHTML='<h4>'+stEsc(j.name||'Strategy')+'</h4>'+
    '<p class="sub"><b>Hypothesis:</b> '+stEsc(j.hypothesis||'')+'</p>'+
    '<p class="sub"><b>Design:</b> '+stEsc(j.knobSummary||'')+'</p>'+
    // HEADLINE = excess return over SPY for the same window; total return is second. (The run metric
    // is alphaVsSpyPct — the old card read a key that never existed and showed "—".)
    '<div class="st-metrics">'+
    '<div class="st-metric" style="border-color:var(--accent)"><span class="sub">vs SPY (same window)</span><b>'+f(m.alphaVsSpyPct!=null?m.alphaVsSpyPct:m.alphaPct)+'%</b></div>'+
    '<div class="st-metric"><span class="sub">Total return</span><b>'+f(m.totalReturnPct)+'%</b></div>'+
    '<div class="st-metric"><span class="sub">SPY same window</span><b>'+f(m.spyReturnPct)+'%</b></div>'+
    '<div class="st-metric"><span class="sub">CAGR</span><b>'+f(m.cagrPct)+'%</b></div>'+
    '<div class="st-metric"><span class="sub">Sharpe</span><b>'+f(m.sharpe)+'</b></div>'+
    '<div class="st-metric"><span class="sub">Max drawdown</span><b>'+f(m.maxDrawdownPct)+'%</b></div>'+
    '<div class="st-metric"><span class="sub">Trades</span><b>'+(m.trades==null?'—':m.trades)+'</b></div>'+
    '</div>'+
    (m.startCash?'<p class="sub">Backtested from <b>'+money(m.startCash)+'</b>'+(LAB.accountEquity&&Math.round(LAB.accountEquity)===Math.round(m.startCash)?' — the selected account\'s equity ('+stEsc(DISP)+')':' of starting capital')+', whole shares. Change the account (Acting on) and re-run to size it to a different book.</p>':'')+
    '<div id="stChart" style="height:300px;margin:8px 0"></div>'+
    '<div class="st-cites"><b>Grounded in:</b>'+cites+'</div>'+
    (j.appliedNote?'<p class="sub" style="color:#e3bd6a">&#9888; '+stEsc(j.appliedNote)+'</p>':'')+
    '<p class="sub">'+(j.refined
      ?'Refined "'+stEsc(j.name||'')+'" in place — the backtest above is the refined design (its forward walk and baseline reset).'
      :'Saved to your Strategy Lab as "'+stEsc(j.name||'')+'".')+' Keep refining here, or apply it to the selected account ('+stEsc(DISP)+') (confirm-gated).</p>'+
    '<div style="margin-top:8px"><button class="btn primary sm" id="stApply">Apply live&hellip;</button> <button class="btn ghost sm" id="stNew">Start a new strategy</button></div>';
  $('stApply').onclick=()=>studioApply(j);
  $('stNew').onclick=studioNewStrategy;
  studioChart(j.curve||[]);
}
function studioChart(curve){
  const el=$('stChart'); if(!el||!window.LightweightCharts||!curve.length)return;
  // theme-token reader — the legacy page only had this as a local inside the OTHER chart functions,
  // so this one threw ReferenceError on 'line'; it needs its own copy.
  const css=getComputedStyle(document.documentElement); const line=(v,d)=>(css.getPropertyValue(v).trim()||d);
  const chart=LightweightCharts.createChart(el,{ width:el.clientWidth, height:300,
    layout:{ background:{type:'solid',color:'transparent'}, textColor:line('--muted','#8a99a3') },
    grid:{ vertLines:{color:line('--line','#26333f')}, horzLines:{color:line('--line','#26333f')} },
    rightPriceScale:{ borderColor:line('--line','#26333f') }, timeScale:{ borderColor:line('--line','#26333f') }, crosshair:{mode:0} });
  chart.addLineSeries({ color:line('--buy','#34c79a'), lineWidth:2, title:'Strategy' }).setData(curve.map(p=>({ time:p.d, value:Number(p.e) })));
  chart.addLineSeries({ color:line('--muted','#8a99a3'), lineWidth:1, lineStyle:2, title:'S&P 500' }).setData(curve.map(p=>({ time:p.d, value:Number(p.s) })));
  chart.timeScale().fitContent(); ST.chart=chart;
}
function studioMic(){
  const R=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!R){ stAppend('err','Speech recognition is not available in this browser.'); return; }
  if(ST.rec&&ST.recognizing){ ST.rec.stop(); return; }
  ST.rec=new R(); ST.rec.interimResults=true; ST.rec.continuous=false;
  ST.rec.onresult=ev=>{ $('stInput').value=Array.from(ev.results).map(r=>r[0].transcript).join(''); };
  ST.rec.onend=()=>{ ST.recognizing=false; $('stMic').classList.remove('recording'); };
  ST.rec.onerror=()=>{ ST.recognizing=false; $('stMic').classList.remove('recording'); };
  ST.rec.start(); ST.recognizing=true; $('stMic').classList.add('recording');
}
async function studioSpeak(text){
  const clip=String(text||'').slice(0,600); if(!clip)return;
  try{
    const r=await fetch('/api/voice/synthesize', jbody('POST', { text:clip }));
    const b=await r.json().catch(()=>({})); const p=(b&&b.data)?b.data:b;
    if(p&&p.audioData&&!p.fallback){ await new Audio('data:audio/wav;base64,'+p.audioData).play().catch(()=>stBrowserSpeak(clip)); return; }
  }catch(e){}
  stBrowserSpeak(clip);
}
function stBrowserSpeak(text){ if(!('speechSynthesis' in window))return; speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }

async function loadLabKnobs() {
  const token = RENDER_TOKEN, gen = tabGen();
  const el = $('labKnobs'); if (!el) return;
  try {
    if (!LAB.knobs) LAB.knobs = await labApi('/knobs');
    if (stale(token) || tabStale(gen)) return;
    const k = LAB.knobs;
    const postures = (k.knobs.find(x=>x.key==='posture')||{}).values || [];
    el.innerHTML =
      '<div class="foot" style="margin-bottom:6px"><strong>Strategy kinds</strong></div>' +
      k.kinds.map(x=>'<div class="sig" style="margin-bottom:6px"><strong>' + esc(x.label) + '</strong><div class="foot">' + esc(x.what) + '</div></div>').join('') +
      '<div class="foot" style="margin:10px 0 6px"><strong>Knobs</strong></div>' +
      '<table style="width:100%"><tbody>' + k.knobs.filter(x=>x.key!=='posture').map(x=>'<tr><td style="color:var(--muted);white-space:nowrap;vertical-align:top">' + esc(x.key) + '</td><td class="foot">' + esc(x.what) + '</td></tr>').join('') + '</tbody></table>' +
      '<div class="foot" style="margin:10px 0 6px"><strong>Postures (every dial, % of equity or position)</strong></div>' +
      '<div style="overflow-x:auto"><table style="width:100%"><thead><tr><th>posture</th><th>per-name</th><th>sector</th><th>deployed</th><th>positions</th><th>stop</th><th>take-profit</th><th>day-halt</th><th>trail arm/give</th><th>DD halt</th></tr></thead><tbody>' +
      postures.map(p=>'<tr><td>' + esc(p.posture) + '</td><td>' + p.maxPerNamePct + '%</td><td>' + p.maxSectorPct + '%</td><td>' + p.maxDeployedPct + '%</td><td>' + p.maxPositions + '</td><td>' + p.stopLossPct + '%</td><td>' + p.takeProfitPct + '%</td><td>' + p.dailyLossHaltPct + '%</td><td>' + p.trailArmPct + '/' + p.trailGivebackPct + '%</td><td>' + p.maxDrawdownPct + '%</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="foot" style="margin:10px 0 6px"><strong>Formulas (verbatim from the engine)</strong></div>' +
      '<table style="width:100%"><tbody>' + k.formulas.map(f=>'<tr><td style="color:var(--muted);white-space:nowrap;vertical-align:top">' + esc(f.algo) + '</td><td class="foot">' + esc(f.formula) + ' <span style="opacity:.6">(' + esc(f.source) + ')</span></td></tr>').join('') + '</tbody></table>' +
      '<div class="foot" style="margin-top:10px"><strong>Honest limits:</strong> ' + esc(k.honestLimits) + '</div>';
  } catch (e) { if (!stale(token) && !tabStale(gen)) el.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}

/* ── Tuning — nightly optimizer & approvals (sub-tab). The optimizer proposes parameter tweaks for the
 * engine shared by every account of the selected kind; nothing changes how the bot trades until it is
 * approved here. ── */
const fmtExp = (n) => n==null ? '—' : (Number(n)>=0?'+':'') + Number(n).toFixed(2) + '%';
const fmtWin = (n) => n==null ? '—' : Math.round(Number(n)*100) + '%';
/* Not async: the paint is synchronous and refreshTuning()'s two loaders own their own capture/bail,
   so there is no post-await paint here to guard. Its only caller (the subTabs onSelect below) ignores
   the return value. */
function loadTuning() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Tuning — nightly optimizer &amp; approvals</h2>' +
      '<button class="btn ghost sm" id="optRunBtn" style="margin-left:auto">Run optimization now</button></div>' +
    '<div class="foot" style="margin-bottom:6px">Tuning proposals apply to the engine parameters shared by every account of this kind (' + MODE + ').</div>' +
    '<div class="sub" style="margin-bottom:8px">Each night the engine backtests small parameter tweaks against recent market history and proposes the ones that would have improved results. <strong>Nothing changes how the bot trades until you approve it here.</strong> Selected account: ' + esc(DISP) + '.</div>' +
    '<div id="optMsg" class="sub" style="min-height:18px"></div>' +
    '<div id="tunePending"><div class="spin"><span class="dot"></span></div></div>' +
    '<div id="tuneParams" style="margin-top:18px"></div>' +
    '<div id="tuneHistory" style="margin-top:18px"></div></div>';
  $('optRunBtn').onclick = runOptimizeNow;
  refreshTuning();
}
async function refreshTuning() { await Promise.all([loadTuneRecs(), loadTuneParams()]); }
async function loadTuneRecs() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('tunePending'), hist = $('tuneHistory'); if (!host) return;
  let j; try { j = await api('/recommendations-tuning'); } catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; return; }
  if (stale(token) || tabStale(gen)) return;
  const pending = j.pending || [];
  if (!pending.length) {
    host.innerHTML = '<div class="why" style="margin-top:4px"><strong>No pending recommendations.</strong> The optimizer hasn’t found a parameter change worth making since the last run — the current settings are holding up. Run it now, or check back after tonight’s 5:30am pass.</div>';
  } else {
    host.innerHTML = '<div class="foot" style="margin:6px 0 8px">' + pending.length + ' recommended change(s) — review and approve:</div>' +
      pending.map(r =>
        '<div class="sig" style="border-left-color:var(--buy)">' +
          '<div><strong>' + esc(r.label) + '</strong>: <span class="foot">' + r.currentValue + '</span> &rarr; <strong class="ok">' + r.proposedValue + '</strong></div>' +
          '<div class="foot" style="margin-top:4px">backtest: win-rate ' + fmtWin(r.baselineWinrate) + ' &rarr; <strong>' + fmtWin(r.proposedWinrate) + '</strong> · expectancy ' + fmtExp(r.baselineExpectancy) + ' &rarr; <strong>' + fmtExp(r.proposedExpectancy) + '</strong> · ' + (r.proposedSignals||0) + ' signals</div>' +
          '<div style="margin-top:8px"><button class="btn buy sm" data-approve="' + r.recId + '">Approve &amp; apply</button> <button class="btn ghost sm" data-reject="' + r.recId + '">Reject</button> <span class="sub" id="recmsg_' + r.recId + '"></span></div>' +
        '</div>'
      ).join('');
    host.querySelectorAll('button[data-approve]').forEach(b => b.onclick = () => actOnRec(b.getAttribute('data-approve'), 'approve'));
    host.querySelectorAll('button[data-reject]').forEach(b => b.onclick = () => actOnRec(b.getAttribute('data-reject'), 'reject'));
  }
  const history = j.history || [];
  hist.innerHTML = history.length ? ('<div class="foot" style="margin-bottom:6px">RECENT DECISIONS</div>' +
    '<table><thead><tr><th>When</th><th>Parameter</th><th class="num">Change</th><th>Decision</th></tr></thead><tbody>' +
    history.map(r => '<tr><td class="foot">' + fmtDate(r.resolvedAt) + '</td><td>' + esc(r.label) + '</td><td class="num">' + r.currentValue + ' &rarr; ' + r.proposedValue + '</td><td><span class="pill ' + (r.status==='applied'?'buy':'sell') + '">' + esc(r.status) + '</span></td></tr>').join('') +
    '</tbody></table>') : '';
}
async function actOnRec(id, action) {
  const msg = $('recmsg_' + id); if (msg) { msg.className='sub'; msg.innerHTML='<span class="dot"></span> ' + (action==='approve'?'Applying…':'Rejecting…'); }
  try { await api('/recommendations-tuning/' + encodeURIComponent(id) + '/' + action, { method:'POST' }); await refreshTuning(); }
  catch (e) { if (msg) { msg.className='sub err'; msg.textContent = e.message; } }
}
async function loadTuneParams() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('tuneParams'); if (!host) return;
  let j; try { j = await api('/strategy-params'); } catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; return; }
  if (stale(token) || tabStale(gen)) return;
  const ps = j.params || [];
  host.innerHTML = '<div class="foot" style="margin-bottom:6px">CURRENT ' + MODE.toUpperCase() + ' ENGINE PARAMETERS (shared by every ' + MODE + ' account)</div>' +
    '<table><thead><tr><th>Parameter</th><th class="num">Value</th><th>Source</th><th>Updated</th></tr></thead><tbody>' +
    ps.map(p => '<tr><td>' + esc(p.label) + '</td><td class="num"><strong>' + p.value + '</strong></td><td>' + (p.isDefault?'<span class="pill hold">default</span>':'<span class="pill buy">tuned</span>') + '</td><td class="foot">' + (p.updatedAt?fmtDate(p.updatedAt):'—') + '</td></tr>').join('') +
    '</tbody></table>' +
    '<div class="foot" style="margin-top:8px">Backtest scores signal direction vs. the next ~5 sessions’ move (a ranking proxy, not a fills/slippage simulator). v1 tunes the algo + ensemble parameters; multi-timeframe weights come later.</div>';
}
async function runOptimizeNow() {
  const btn = $('optRunBtn'), msg = $('optMsg'); if (!btn) return;
  btn.disabled = true; msg.className='sub'; msg.innerHTML='<span class="dot"></span> Backtesting parameter tweaks across the universe… (~10–30s)';
  try {
    const j = await api('/optimize-now', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mode: MODE }) });
    msg.className='sub ok'; msg.textContent = 'Done — assessed ' + (j.assessed||0) + ' symbols, ' + (j.recommendations||0) + ' recommendation(s).' + (j.skipped?(' ('+j.skipped+')'):'');
    await refreshTuning();
  } catch (e) { msg.className='sub err'; msg.textContent = e.message; } finally { btn.disabled=false; }
}

/* ── view entry ──────────────────────────────────────────────── */
async function renderStrategiesView(token) {
  main.innerHTML = '<div class="panel"><h2>Strategies</h2><div class="sub">Which strategy each account runs, and the lab where strategies are built, tested and refined. Every account always runs exactly one strategy — the <b>Production baseline</b> unless you set one.</div></div>' +
    acctContextBar('Lab “Set on…”, Apply/Revert and Tuning act on this account') + '<div id="viewTabs"></div>';
  if (stale(token)) return;
  wireAcctContextBar();
  subTabs('viewTabs', [['roster','Account strategies'],['events','Event playbooks'],['lab','Strategy Lab'],['studio','Strategy Studio'],['tuning','Tuning']], SUB || 'roster', (k) => { if (k==='roster') loadRosterTab(); else if (k==='events') loadEventPlansTab(); else if (k==='lab') loadLab(); else if (k==='studio') loadStudio(); else if (k==='tuning') loadTuning(); });
}
