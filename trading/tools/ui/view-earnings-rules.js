/* trading/ui/view-earnings-rules.js — the EARNINGS-REACTION RULES card (ADR-136 D5), on the account
 * page. Classic script, global functions, loaded after view-events.js; view-account.js creates the
 * #earningsRulesCard placeholder and calls loadEarningsRulesCard(token) from kickAccountCards().
 *
 * A rule is a standing instruction on ONE account and ONE held name: "when this company reports,
 * read what it actually filed and act". The kernel has owned that state machine since 2026-09-06 —
 * the EDGAR watch, the analyst read, the mapped order — but it could only be reached by calling the
 * module, so there was no way for the operator to arm, see or stop one. This file is the operator's
 * half of that: GET /events/rules paints the account's rules, a small form POSTs a new one, and
 * POST /events/rules/:id/cancel disarms an active one.
 *
 * THREE THINGS THE CARD REFUSES TO IMPLY, because each of them would be read as a promise:
 *  1. It never says a rule is running when the server says the watcher is off. `enabled` folds BOTH
 *     executor gates and the server sends the reason as words; the card prints the server's sentence
 *     rather than deciding for itself which flag is missing.
 *  2. The basis line comes from the payload (`basis`), never from a string here. "Beat" and "miss"
 *     are the company's own filed numbers against its own prior year and its own guidance — oshal
 *     ingests no consensus feed, and a card that let the operator assume otherwise would be lying.
 *  3. A rule only acts on a name the account HOLDS. The symbol picker is built from the positions
 *     already loaded for this account, and a rule armed on anything else says so up front instead of
 *     sitting "armed" forever while the kernel quietly notes "not held".
 *
 * Strict-CSP clean: no inline handlers anywhere. One delegated listener per painted card dispatches
 * data-act values, and every form value is read out of its element BY ID at click time, so nothing
 * about a rule is ever baked into markup.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the ADR-136 D5 surface: loadEarningsRulesCard paints this account's rules with their status, their mapped actions, the last thing the kernel recorded on each timeline and a Cancel on the active ones; the Arm form offers the account's held symbols, the three verdict mappings, the three sizing modes and the expiry, confirm-gated before the POST; the watcher-off note and the classification basis are printed from the server payload rather than restated here.
 */

/* ── the earnings-rules card (ADR-136 D5) ──────────────────────────────────── */
/* The rules of the CURRENT paint — Cancel resolves an id against this array (never an onclick string). */
let ACCT_RULES = [];
/* The server's own posture words for this paint: { enabled, note, basis, limits }. */
let ACCT_RULES_META = { enabled: false, note: null, basis: '', limits: null };
/* Whether the Arm form is open. Kept across repaints so arming a rule does not collapse the form. */
let ACCT_RULES_FORM_OPEN = false;
/* Statuses the kernel treats as ACTIVE — the only ones that can be cancelled. Mirrors its ACTIVE list. */
const RULE_ACTIVE = ['armed', 'detected', 'classified'];
/* Statuses that mean shares moved. 'fired_short' is the kernel's honest terminal for a partial exit. */
const RULE_MOVED = ['fired', 'fired_short'];

/* GET /events/rules is scoped to BOOK by api(). A failure is said in red, never a silent blank; the
   card is painted even with zero rules, because arming the first one has to start somewhere. */
async function loadEarningsRulesCard(token) {
  const el = $('earningsRulesCard'); if (!el) return;
  let j;
  try { j = await api('/events/rules'); }
  catch (e) {
    if (stale(token)) return;
    el.innerHTML = '<div class="panel"><h2>Earnings rules</h2><div class="err" style="font-size:13px">Earnings rules unavailable: ' + esc(e.message) + '</div></div>';
    return;
  }
  if (stale(token) || !$('earningsRulesCard')) return;
  ACCT_RULES = j.rules || [];
  ACCT_RULES_META = { enabled: j.enabled === true, note: j.note || null, basis: j.basis || '', limits: j.limits || null };
  el.innerHTML = earningsRulesCardHtml(ACCT_RULES, ACCT_RULES_META);
  wireEarningsRulesCard(el);
}

/**
 * @description The whole card: the posture line, the rules table, the Arm form when it is open, and
 *   the basis footnote. Every sentence about what the server will or will not do comes from `meta`.
 * @param rows - This account's rules, newest first.
 * @param meta - { enabled, note, basis, limits } as the route reported them.
 * @returns The card's HTML.
 */
function earningsRulesCardHtml(rows, meta) {
  const active = rows.filter(r => RULE_ACTIVE.includes(r.status)).length;
  const head = '<div class="panel"><div class="panel head2" style="padding:0;margin:0 0 8px;background:none;border:0;box-shadow:none">' +
    '<h2 style="margin:0">Earnings rules</h2>' +
    '<span class="foot" style="margin-left:auto">' + active + ' armed' + (rows.length - active ? ' · ' + (rows.length - active) + ' done' : '') + '</span></div>';
  const posture = meta.enabled ? '' : '<div class="sub warn" style="margin-bottom:8px">&#9888; ' + esc(meta.note || 'The earnings watcher is off on this server.') + '</div>';
  const table = rows.length
    ? '<div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>When it reports</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(earningsRuleRowHtml).join('') + '</tbody></table></div>'
    : '<div class="foot" style="margin:0 0 8px">No earnings rule on this account.</div>';
  return head + posture + table + earningsArmFormHtml() +
    '<div class="foot" style="margin-top:8px">' + esc(meta.basis || '') + '</div>' +
    '<div class="foot">' + esc(earningsWindowWords(meta.limits)) + '</div></div>';
}

/** The watch window and the expiry horizon in the server's own numbers; silent when it sent none. */
function earningsWindowWords(limits) {
  if (!limits) return '';
  return 'A rule watches EDGAR for an 8-K carrying item 2.02 from ' + Number(limits.windowBeforeDays) + ' day(s) before the expected print to ' +
    Number(limits.windowAfterDays) + ' day(s) after it, and only while the account still holds the name. A rule may run at most ' +
    Number(limits.maxDays) + ' days.';
}

/** One rule row: the mapped actions, the size, the status pill, the last thing the kernel recorded. */
function earningsRuleRowHtml(r) {
  const cancelable = RULE_ACTIVE.includes(r.status);
  return '<tr><td><strong>' + esc(r.symbol) + '</strong>' + (r.expectedAt ? ' <span class="foot" style="margin:0">expects ' + esc(r.expectedAt) + '</span>' : '') + '</td>' +
    '<td>' + esc(ruleActionWords(r)) + '</td>' +
    '<td>' + esc(ruleSizingWords(r.sizing)) + '</td>' +
    '<td>' + ruleStatusPill(r.status) + ruleDetailHtml(r) + '</td>' +
    '<td style="text-align:right">' + (cancelable ? '<button class="btn ghost sm" data-act="cancel-rule" data-rule="' + esc(r.ruleId) + '">Cancel…</button>' : '') + '</td></tr>';
}

/** 'beat → buy · miss → sell · inline → hold' — the three mappings exactly as stored. */
function ruleActionWords(r) {
  return 'beat → ' + String(r.onBeat) + ' · miss → ' + String(r.onMiss) + ' · inline → ' + String(r.onInline);
}

/** The sizing in the operator's own units. Unknown modes print raw rather than guess. */
function ruleSizingWords(s) {
  if (!s) return '—';
  if (s.mode === 'pct_of_position') return Number(s.value) + '% of the position';
  if (s.mode === 'shares') return Number(s.value) + ' shares';
  if (s.mode === 'notional') return money(s.value);
  return String(s.mode) + ' ' + String(s.value);
}

/** Status pill: a rule that MOVED shares is not styled like one that decided to do nothing. */
function ruleStatusPill(status) {
  const s = String(status || 'armed');
  const k = s === 'error' ? 'rejected' : (s === 'fired' ? 'filled' : (s === 'fired_short' ? 'rejected' : (RULE_ACTIVE.includes(s) ? 'pending' : '')));
  return '<span class="pill ' + k + '">' + esc(s.replace(/_/g, ' ')) + '</span>';
}

/** The LAST thing the kernel wrote on this rule's timeline — its own words, never a re-derivation. */
function ruleDetailHtml(r) {
  const t = (r.timeline || []);
  const last = t.length ? t[t.length - 1] : null;
  const words = last && last.detail ? String(last.detail) : '';
  const short = r.order && r.order.truncated
    ? ' <span class="err" style="font-size:12px">TRUNCATED — check the exposure this rule left behind.</span>' : '';
  const filing = r.filing && r.filing.url
    ? ' <a href="' + esc(r.filing.url) + '" target="_blank" rel="noopener noreferrer">filing</a>' : '';
  if (!words && !short && !filing) return '';
  return '<div class="foot" style="margin:2px 0 0">' + esc(words) + filing + short + '</div>';
}

/* ── the Arm form ──────────────────────────────────────────────────────────── */
/* Closed by default: it is a standing instruction to place a real order, not a filter. */
function earningsArmFormHtml() {
  if (!ACCT_RULES_FORM_OPEN) {
    return '<div style="margin-top:8px"><button class="btn sm" data-act="open-rule-form">Arm an earnings rule…</button></div>';
  }
  const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label) + '</option>';
  const verdict = (id, sel) => '<select id="' + id + '">' + ['buy', 'sell', 'hold'].map(a => opt(a, a, sel)).join('') + '</select>';
  return '<div class="panel" id="ruleForm" style="margin-top:8px;padding:10px 14px">' +
    '<div class="foot" style="margin:0 0 6px">Arm a rule on a name this account holds</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
      '<label class="foot">Name<br>' + earningsSymbolPickerHtml() + '</label>' +
      '<label class="foot">If it beats<br>' + verdict('ruleBeat', 'buy') + '</label>' +
      '<label class="foot">If it misses<br>' + verdict('ruleMiss', 'sell') + '</label>' +
      '<label class="foot">If it is in line<br>' + verdict('ruleInline', 'hold') + '</label>' +
      '<label class="foot">Size<br><select id="ruleSizeMode">' +
        opt('pct_of_position', '% of the position', 'pct_of_position') + opt('shares', 'shares', '') + opt('notional', 'dollars', '') +
      '</select></label>' +
      '<label class="foot">Amount<br><input id="ruleSizeValue" type="number" min="1" step="1" value="100" style="width:90px"></label>' +
      '<label class="foot">Expected print (optional)<br><input id="ruleExpected" type="date" style="width:150px"></label>' +
      '<label class="foot">Expires<br><input id="ruleExpires" type="date" value="' + esc(earningsDefaultExpiry()) + '" style="width:150px"></label>' +
      '<button class="btn buy" data-act="arm-rule">Arm…</button>' +
      '<button class="btn ghost" data-act="close-rule-form">Cancel</button>' +
    '</div><div id="ruleFormMsg"></div></div>';
}

/* The account's held names, from the positions this view already loaded — a rule only acts on one of
   them. A free-text box is offered too, plainly marked, rather than silently refusing a name that is
   about to be bought. */
function earningsSymbolPickerHtml() {
  const held = ((typeof STATE !== 'undefined' && STATE && STATE.positions) || []).filter(p => Number(p.qty) > 0);
  if (!held.length) return '<input id="ruleSymbol" type="text" placeholder="MSFT" maxlength="6" style="width:110px"> <span class="foot">(nothing held yet)</span>';
  return '<select id="ruleSymbol">' + held.map(p => '<option value="' + esc(p.symbol) + '">' + esc(p.symbol) + ' (' + esc(p.qty) + ')</option>').join('') + '</select>';
}

/* 45 days out, clamped to the server's own horizon when it sent one. */
function earningsDefaultExpiry() {
  const max = ACCT_RULES_META.limits ? Number(ACCT_RULES_META.limits.maxDays) : 120;
  const days = Math.min(45, Number.isFinite(max) && max > 0 ? max : 45);
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * @description Wire the card's ONE delegated click listener. Every action is a data-act value; the
 *   form's values are read out of their elements at click time, so nothing is baked into markup.
 * @param el - The painted card element.
 * @returns Nothing.
 */
function wireEarningsRulesCard(el) {
  el.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || !el.contains(b)) return;
    e.preventDefault();
    const act = b.getAttribute('data-act');
    if (act === 'open-rule-form' || act === 'close-rule-form') {
      ACCT_RULES_FORM_OPEN = (act === 'open-rule-form');
      el.innerHTML = earningsRulesCardHtml(ACCT_RULES, ACCT_RULES_META);
      wireEarningsRulesCard(el);
      return;
    }
    if (act === 'cancel-rule') cancelEarningsRule(b.getAttribute('data-rule'));
    if (act === 'arm-rule') armEarningsRule();
  };
}

/** Read the form. Returns null after saying why, so a half-filled form never reaches the server. */
function readEarningsRuleForm() {
  const val = (id) => { const n = $(id); return n ? String(n.value || '').trim() : ''; };
  const symbol = val('ruleSymbol').toUpperCase();
  const expiresAt = val('ruleExpires');
  const size = Number(val('ruleSizeValue'));
  if (!symbol) return earningsFormError('Pick the name the rule watches.');
  if (!expiresAt) return earningsFormError('A rule needs a date it stops on.');
  if (!Number.isFinite(size) || size < 1) return earningsFormError('The size has to be at least 1.');
  const rule = {
    symbol, onBeat: val('ruleBeat'), onMiss: val('ruleMiss'), onInline: val('ruleInline'),
    sizing: { mode: val('ruleSizeMode'), value: size },
    expectedAt: val('ruleExpected') || null,
    // The kernel wants an instant; the picker gives a day. End of that day, UTC.
    expiresAt: new Date(expiresAt + 'T23:59:59Z').toISOString(),
  };
  if (rule.onBeat === 'hold' && rule.onMiss === 'hold' && rule.onInline === 'hold') {
    return earningsFormError('All three outcomes hold — this rule would never do anything.');
  }
  return rule;
}

/** Say it in the form, not in an alert: the operator is looking at the fields that are wrong. */
function earningsFormError(message) {
  const m = $('ruleFormMsg');
  if (m) m.innerHTML = '<div class="err" style="font-size:13px;margin-top:6px">' + esc(message) + '</div>';
  return null;
}

/* POST /events/rules with confirm:true after a confirm() that names the account and the action. The
   card reloads on success and keeps the form open so the next one is one click away. */
async function armEarningsRule() {
  const rule = readEarningsRuleForm(); if (!rule) return;
  const acts = 'beat → ' + rule.onBeat + ', miss → ' + rule.onMiss + ', in line → ' + rule.onInline;
  if (!confirm('Arm an earnings rule on ' + rule.symbol + ' in ' + DISP + '?\n\n' + acts + ' (' + ruleSizingWords(rule.sizing) + ').\n\n' +
    'When ' + rule.symbol + ' files its results, the swarm reads that filing and places a REAL order on this account. Cancel it any time before it fires.')) return;
  const token = RENDER_TOKEN;
  let j;
  try { j = await api('/events/rules', jbody('POST', { confirm: true, rule })); }
  catch (e) { earningsFormError('Could not arm: ' + (e.message || 'unknown error')); return; }
  if (stale(token)) return;
  await loadEarningsRulesCard(token);
  if (j && j.warning) {
    const el = $('earningsRulesCard');
    if (el && !stale(token)) el.insertAdjacentHTML('afterbegin', '<div class="sub warn" style="margin:0 0 6px">&#9888; ' + esc(j.warning) + '</div>');
  }
}

/* POST /events/rules/:id/cancel after a confirm() naming the rule; the card reloads, says why on failure. */
async function cancelEarningsRule(id) {
  const r = ACCT_RULES.find(x => String(x.ruleId) === String(id)); if (!r) return;
  const moved = RULE_MOVED.includes(r.status) ? '\n\nShares have already moved for this rule — cancelling does not undo them.' : '';
  if (!confirm('Cancel the earnings rule on ' + r.symbol + ' in ' + DISP + '?\nIt will not act when ' + r.symbol + ' reports.' + moved)) return;
  const token = RENDER_TOKEN;
  try { await api('/events/rules/' + encodeURIComponent(id) + '/cancel', jbody('POST', {})); }
  catch (e) {
    const el = $('earningsRulesCard');
    if (el && !stale(token)) el.insertAdjacentHTML('afterbegin', '<div class="err" style="font-size:13px;margin:0 0 6px">Could not cancel: ' + esc(e.message || 'unknown error') + '</div>');
    return;
  }
  if (!stale(token)) loadEarningsRulesCard(token);
}
