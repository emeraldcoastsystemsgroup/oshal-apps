/* trading/ui/ticket.js — the DIRECT-TRADE ticket ("Buy a stock") of the Trading surface (ADR-136 D3).
 *
 * Classic script; loads after app.js (BOOK/MODE/STATUS/DISP/STATE/UNIVERSE, api(), jbody(), navigate(),
 * esc/money/st/spinner) and shared-positions.js (focus(sym) research pane, loadKpisAndPositions()).
 * Paints into #ticketHost:
 *   1 Pick the stock    — GET /quote (last trade, re-polled every 5s + a Refresh button), then
 *                         focus(sym) opens the chart + signal model in #focus. GET /ledger once fills
 *                         TKT.funds so both step 1 and the summary can show what's available to spend.
 *   2 Size & price rule — size by SHARES, DOLLARS, or % OF AVAILABLE (percent of buying power/cash);
 *                         plain-word price rules map onto venue order types. A SELL shows the held
 *                         position and is capped at it (this ticket never opens a short).
 *   3 Confirm           — POST /decisions/manual mints the operator decision; POST /orders executes it
 *                         with ONE requestId per decision, so a retry after a lost response cannot
 *                         double-submit at the venue. A LIVE book gets a confirm() naming the account.
 * BUY is always allowed: the ticket opens in BUY and shows the Buy/Sell switch on every account. When
 * the autopilot is off on the account (STATUS.bookEnabled === false) a neutral note says so — a manual
 * order the autopilot will not touch — but nothing is blocked. Only a live book on a server with live
 * trading disabled (STATUS.liveEnabled === false) does not open at all. All state lives in TKT (reset
 * by openTicket, which also clears the last quote-poll interval).
 * Handlers re-read BOOK/MODE/DISP/STATUS at call time; a ticket minted on another book closes itself.
 *
 * ADR-138 (protected "pinned" purchases): a BUY may carry "Protect these shares" — take-profit,
 * stop (fixed or trailing) and time-stop legs that travel as `protect` on POST /decisions/manual.
 * The server mints a pinned lot the autopilot cannot touch and answers `lot` + `protection`; step 3
 * says so in words and, once placed, links to the account's Protected lots card. LIMIT rules may also
 * be marked `extendedHours` (pre/post-market) — never a market order. tktProtWords(rules, ref) is
 * shared with the lots card (view-account.js) so both surfaces describe a rule set identically.
 *
 * ADR-136 D4 (timed orders): step 2 asks WHEN — Now, or At a time (ET) on the 5-minute grid inside
 * 9:00 AM–4:55 PM on a trading day. A timed order travels as `fireAtEt` on POST /decisions/manual; the
 * server records a kernel dated order the trading leg fires ONCE at that time, so there is NO POST
 * /orders step — the review is the commitment (a LIVE account confirms BEFORE the mint) and step 3
 * shows "Scheduled" with a link to the account's Timed orders card (view-account.js loadDatedCard).
 */

/* Plain-word price rules → the order types the venue already runs. `tif` is the rule's default. */
const TKT_RULES = [
  { id: 'market', type: 'market', tif: 'day', buy: 'Buy now at market', sell: 'Sell now at market' },
  { id: 'limit', type: 'limit', tif: 'gtc', buy: 'Only if it drops to a price (limit)', sell: 'Only if it rises to a price (limit)' },
  { id: 'stop', type: 'stop', tif: 'gtc', buy: 'Only once it breaks above a price (stop)', sell: 'Only once it falls below a price (stop)' },
  { id: 'stop_limit', type: 'stop_limit', tif: 'gtc', buy: 'Break above, but not more than (stop-limit)', sell: 'Fall below, but not less than (stop-limit)' },
  { id: 'trailing_stop', type: 'trailing_stop', tif: 'gtc', sellOnly: true, sell: 'Protect with a trailing stop' },
];
const TKT_STEPS = ['Pick the stock', 'Size & price rule', 'Confirm'];
let TKT = null;

/* ── state ─────────────────────────────────────────────────────────────────── */
function tktFresh(prefill) {
  return {
    step: 1, symbol: String(prefill || '').trim().toUpperCase(), quote: null, quoteErr: '', quoteAt: null, busy: false,
    side: 'buy', sizeMode: 'shares', qty: '', notional: '', pctInput: '', rule: 'market',
    limitPrice: '', stopPrice: '', trailPercent: '', tif: 'day', rationale: '',
    prot: tktProtFresh(), extendedHours: false, funds: null, tick: null,
    when: 'now', fireDate: '', fireTime: '',                                   // ADR-136 D4: 'now' | 'at' (+ ET date/time)
    formErr: '', focusId: null, decision: null, bookAtMint: null, requestId: null, mintedNotional: null, mintedMode: null, result: null,
  };
}
const tktNum = (v) => { const n = Number(v); return v === '' || v == null || !isFinite(n) ? null : n; };
const tktPx = (n) => tktNum(n) == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tktOn = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
/* Autopilot off on this account (STATUS.bookEnabled === false). Buys and sells are BOTH allowed here —
   this only drives a neutral note that a manual order is one the autopilot will not touch. */
const tktAutopilotOff = () => STATUS.bookEnabled === false;
/* Available funds for a BUY: buying power first, then cash; null when the /ledger read hasn't landed. */
function tktAvailable() {
  const f = TKT && TKT.funds; if (!f) return null;
  const bp = tktNum(f.buyingPower); if (bp != null && bp >= 0) return bp;
  const c = tktNum(f.cash); return c != null && c >= 0 ? c : null;
}
/* % mode: the dollar amount the operator's percent of available funds works out to (client-computed). */
function tktPctDollars() {
  const p = tktNum(TKT.pctInput), avail = tktAvailable();
  if (!(p > 0) || p > 100 || !(avail > 0)) return null;
  return avail * p / 100;
}
function tktRule() { return TKT_RULES.find(r => r.id === TKT.rule) || TKT_RULES[0]; }
function tktRuleLabel(r) { return TKT.side === 'sell' ? r.sell : (r.buy || r.sell); }
/* Reference price the server sizes against: the operator's own price point first, else the quote. */
function tktRefPrice() {
  const t = tktRule().type, lim = tktNum(TKT.limitPrice), stp = tktNum(TKT.stopPrice);
  if ((t === 'limit' || t === 'stop_limit') && lim > 0) return lim;
  if (t === 'stop' && stp > 0) return stp;
  return TKT.quote ? tktNum(TKT.quote.price) : null;
}
/* The position behind a SELL: STATE.positions (this book's live rows) first, else the UNIVERSE cache. */
function tktHeld() {
  const sym = String(TKT.symbol || '').toUpperCase(); if (!sym) return null;
  const p = (STATE.positions || []).find(x => String(x.symbol || '').toUpperCase() === sym);
  if (p && Number(p.qty) > 0) return { qty: Number(p.qty), avg: tktNum(p.avgEntryPrice) };
  const u = UNIVERSE[sym];
  if (u && u.held && Number(u.qty) > 0) return { qty: Number(u.qty), avg: tktNum(u.avg) };
  return null;
}
function tktRawQty() {
  if (TKT.sizeMode === 'shares') { const q = tktNum(TKT.qty); return q != null && Number.isInteger(q) && q >= 1 ? q : null; }
  const p = tktRefPrice(), amt = TKT.sizeMode === 'pct' ? tktPctDollars() : tktNum(TKT.notional);
  if (!(amt > 0) || !(p > 0)) return null;
  const q = Math.floor(amt / p); return q >= 1 ? q : null;
}
/* Dollars- and %-mode SELLS are capped at the shares held — you cannot sell what you do not own. The
   capped SHARE count (not a notional) is what tktBody sends so the server never sizes an uncapped short. */
function tktSellCap() {
  if (TKT.side !== 'sell' || (TKT.sizeMode !== 'dollars' && TKT.sizeMode !== 'pct')) return null;
  const h = tktHeld(), raw = tktRawQty(), cap = h ? Math.floor(h.qty) : 0;
  return raw != null && cap >= 1 && raw > cap ? cap : null;
}
function tktQty() { const cap = tktSellCap(); return cap != null ? cap : tktRawQty(); }
function tktRuleWords() {
  const t = tktRule().type, sell = TKT.side === 'sell', lim = tktPx(TKT.limitPrice), stp = tktPx(TKT.stopPrice);
  if (t === 'market') return 'at market';
  if (t === 'limit') return (sell ? 'only if it rises to ' : 'only if it drops to ') + lim;
  if (t === 'stop') return (sell ? 'only once it falls below ' : 'only once it breaks above ') + stp;
  if (t === 'stop_limit') return sell ? 'once it falls below ' + stp + ' but not less than ' + lim : 'once it breaks above ' + stp + ' but not more than ' + lim;
  const tr = tktNum(TKT.trailPercent);
  return 'trailing stop ' + (tr != null ? tr + '%' : '—') + ' below the high';
}
const tktTifWords = () => TKT.tif === 'gtc' ? 'good until cancelled' : 'today only';
/* One-sentence order in words — the step-3 headline and the LIVE confirm() text. */
function tktSummaryText() {
  const d = TKT.decision, q = d && d.decision ? d.decision.qty : tktQty(), p = tktRefPrice();
  const est = d && d.estNotional != null ? d.estNotional : (q != null && p > 0 ? q * p : null);
  const avail = tktAvailable();
  const tail = TKT.side === 'buy' && est != null && avail != null
    ? ' ≈ ' + money(est) + ' of your ' + money(avail) + ' available.'
    : (est != null ? ' Estimated total ' + money(est) + '.' : '');
  return TKT.side.toUpperCase() + ' ' + (q != null ? q : '?') + ' ' + TKT.symbol + ' on ' + DISP + ' — ' + tktRuleWords() + ', ' + tktTifWords() + '.' +
    (TKT.when === 'at' ? ' Fires ' + tktFireWords() + '.' : '') + tail;
}
/* Blocking problems only — '' means Review may proceed. Non-blocking advice lives in tktPriceWarn(). */
function tktValidate() {
  const t = tktRule().type, lim = tktNum(TKT.limitPrice), stp = tktNum(TKT.stopPrice), tr = tktNum(TKT.trailPercent), held = tktHeld();
  if (!TKT.quote) return 'Look up the stock first.';
  if (TKT.side === 'sell' && !held) return 'You do not hold ' + TKT.symbol + ' in this account — a sell would open a short, which is not supported here.';
  if (TKT.sizeMode === 'shares' && tktQty() == null) return 'Enter a whole number of shares (1 or more).';
  if (TKT.sizeMode === 'dollars' && !(tktNum(TKT.notional) > 0)) return 'Enter a dollar amount.';
  if (TKT.sizeMode === 'dollars' && tktQty() == null) return 'That amount ' + (TKT.side === 'sell' ? 'is' : 'buys') + ' less than one share at ' + tktPx(tktRefPrice()) + '.';
  if (TKT.sizeMode === 'pct') {
    const pv = tktNum(TKT.pctInput);
    if (!(pv > 0)) return 'Enter a percent of your available funds (1 to 100).';
    if (pv > 100) return 'The percent cannot be more than 100.';
    if (tktAvailable() == null) return 'Your available balance did not load — size by shares or dollars instead.';
    if (tktQty() == null) return 'That percent is less than one share at ' + tktPx(tktRefPrice()) + '.';
  }
  if (TKT.side === 'sell' && TKT.sizeMode === 'shares' && tktQty() > held.qty) return 'You only hold ' + held.qty + ' share' + (held.qty === 1 ? '' : 's') + '.';
  if (t === 'limit' && !(lim > 0)) return 'Enter the limit price.';
  if (t === 'stop' && !(stp > 0)) return 'Enter the stop (trigger) price.';
  if (t === 'stop_limit' && !(stp > 0 && lim > 0)) return 'Enter both the stop price and the limit price.';
  if (t === 'trailing_stop' && !(tr > 0)) return 'Enter the trail percent.';
  return tktPriceError() || tktProtError() || tktWhenError();
}
/* A stop trigger on the wrong side of the quote fires at once (or the venue refuses it) — block it. */
function tktPriceError() {
  const t = tktRule().type, px = TKT.quote ? tktNum(TKT.quote.price) : null, stp = tktNum(TKT.stopPrice);
  if (!(px > 0) || !(stp > 0) || (t !== 'stop' && t !== 'stop_limit')) return '';
  if (TKT.side === 'buy' && stp <= px) return 'A buy stop must be ABOVE the current price (' + tktPx(px) + ').';
  if (TKT.side === 'sell' && stp >= px) return 'A sell stop must be BELOW the current price (' + tktPx(px) + ').';
  return '';
}
/* A limit already through the quote is a market order in disguise — say so, but let it through. */
function tktPriceWarn() {
  const t = tktRule().type, px = TKT.quote ? tktNum(TKT.quote.price) : null, lim = tktNum(TKT.limitPrice);
  if (!(px > 0) || !(lim > 0) || t !== 'limit') return '';
  if (TKT.side === 'buy' && lim >= px) return 'Your limit is at/above the current price (' + tktPx(px) + ') — this will fill immediately at market.';
  if (TKT.side === 'sell' && lim <= px) return 'Your limit is at/below the current price (' + tktPx(px) + ') — this will fill immediately at market.';
  return '';
}
/* A BUY that costs more than the account can spend — advisory (the venue is the authority), never a block. */
function tktFundsWarn() {
  if (TKT.side !== 'buy') return '';
  const avail = tktAvailable(), q = tktQty(), p = tktRefPrice();
  if (avail == null || q == null || !(p > 0)) return '';
  const cost = q * p;
  return cost > avail ? 'This is about ' + money(cost) + '; your available is ' + money(avail) + '.' : '';
}
/* Client-side echo of the server guardrails — advisory only; POST /decisions/manual is the authority. */
function tktGuardHint() {
  const g = STATUS.guardrails || {}, q = tktQty(), p = tktRefPrice();
  if (q == null) return '';
  if (g.maxQty && q > g.maxQty) return 'Over the guardrail: ' + q + ' shares exceeds the max of ' + g.maxQty + '.';
  if (g.maxNotionalUsd && p > 0 && q * p > g.maxNotionalUsd) return 'Over the guardrail: ~' + money(q * p) + ' exceeds the max of ' + money(g.maxNotionalUsd) + ' per order.';
  return '';
}

/* ── protection legs (ADR-138 "Protect these shares") ─────────────────────── */
/* BUY only. The chosen legs travel as `protect` on POST /decisions/manual; the server mints a pinned
   lot the autopilot cannot touch. State lives in TKT.prot so a radio switch keeps what was typed. */
function tktProtFresh() {
  return { open: false, tpMode: 'off', tpPct: '', tpPrice: '', slMode: 'off', slPct: '', slPrice: '', trailPct: '', timeDays: '' };
}
const TKT_PROT_KEYS = ['takeProfitPct', 'takeProfitPrice', 'stopLossPct', 'stopPrice', 'trailingStopPct', 'timeStopDays'];
/* The `protect` body: ONLY the chosen legs, one key per leg (a percent and a price are never both sent). */
function tktProtRules() {
  if (!TKT || TKT.side !== 'buy') return null;
  const p = TKT.prot, r = {};
  if (p.tpMode === 'pct' && tktNum(p.tpPct) > 0) r.takeProfitPct = tktNum(p.tpPct);
  else if (p.tpMode === 'price' && tktNum(p.tpPrice) > 0) r.takeProfitPrice = tktNum(p.tpPrice);
  if (p.slMode === 'pct' && tktNum(p.slPct) > 0) r.stopLossPct = tktNum(p.slPct);
  else if (p.slMode === 'price' && tktNum(p.slPrice) > 0) r.stopPrice = tktNum(p.slPrice);
  else if (p.slMode === 'trail' && tktNum(p.trailPct) > 0) r.trailingStopPct = tktNum(p.trailPct);
  const d = tktNum(p.timeDays); if (d > 0) r.timeStopDays = Math.floor(d);
  return Object.keys(r).length ? r : null;
}
/* A rules object out of the server's `protection` echo (bare, or under .rules) — else null. */
function tktProtRulesOf(x) {
  const pick = (o) => o && typeof o === 'object' && TKT_PROT_KEYS.some(k => o[k] != null) ? o : null;
  return x ? (pick(x) || pick(x.rules)) : null;
}
/* Plain words: 'Sell at +10% ($55.00) · stop at −8% ($46.00) · sell after 30 days if still held'. `ref`
   is the expected fill the percents are taken from; without one the dollar figures are left out.
   Safe to call with TKT === null (the lots card passes its own rules + fill price). */
function tktProtWords(rules, ref) {
  const r = rules || tktProtRules(); if (!r) return '';
  const px = ref != null ? Number(ref) : (TKT ? tktRefPrice() : null), parts = [];
  const at = (v) => px > 0 ? ' (' + tktPx(v) + ')' : '';
  if (r.takeProfitPct != null) parts.push('sell at +' + r.takeProfitPct + '%' + at(px * (1 + Number(r.takeProfitPct) / 100)));
  if (r.takeProfitPrice != null) parts.push('sell at ' + tktPx(r.takeProfitPrice));
  if (r.stopLossPct != null) parts.push('stop at −' + r.stopLossPct + '%' + at(px * (1 - Number(r.stopLossPct) / 100)));
  if (r.stopPrice != null) parts.push('stop at ' + tktPx(r.stopPrice));
  if (r.trailingStopPct != null) parts.push('trailing stop ' + r.trailingStopPct + '% below the high');
  if (r.timeStopDays != null) parts.push('sell after ' + r.timeStopDays + ' day' + (Number(r.timeStopDays) === 1 ? '' : 's') + ' if still held');
  if (!parts.length) return '';
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(' · ');
}
/* Blocking problems with the legs — '' when clean. A TP below the quote or a stop above it would fire
   the moment the shares fill; a trailing stop outside 0.5–50% is refused by the venue. */
function tktProtError() {
  if (!TKT || TKT.side !== 'buy') return '';
  const p = TKT.prot, px = TKT.quote ? tktNum(TKT.quote.price) : null;
  const tpP = tktNum(p.tpPrice), slP = tktNum(p.slPrice), tr = tktNum(p.trailPct), d = tktNum(p.timeDays);
  if (p.tpMode === 'pct' && !(tktNum(p.tpPct) > 0)) return 'Enter the take-profit percent.';
  if (p.tpMode === 'price' && !(tpP > 0)) return 'Enter the take-profit price.';
  if (p.tpMode === 'price' && px > 0 && tpP <= px) return 'The take-profit price must be ABOVE the current price (' + tktPx(px) + ').';
  if (p.slMode === 'pct' && !(tktNum(p.slPct) > 0 && tktNum(p.slPct) < 100)) return 'Enter the stop percent (above 0, below 100).';
  if (p.slMode === 'price' && !(slP > 0)) return 'Enter the stop price.';
  if (p.slMode === 'price' && px > 0 && slP >= px) return 'The stop price must be BELOW the current price (' + tktPx(px) + ').';
  if (p.slMode === 'trail' && !(tr >= 0.5 && tr <= 50)) return 'The trailing stop must be between 0.5% and 50%.';
  if (String(p.timeDays).trim() !== '' && !(d > 0 && Number.isInteger(d))) return 'The time stop is a whole number of days (1 or more).';
  const r = tktProtRules() || {};
  if ((r.takeProfitPct != null && r.takeProfitPrice != null) || (r.stopLossPct != null && r.stopPrice != null)) return 'Choose a percent OR a price for each leg, never both.';
  return '';
}
function tktProtPreviewHtml() {
  const w = tktProtWords(), e = tktProtError();
  if (!w && !e) return 'No protection chosen — these shares join the account like any other buy.';
  return (e ? '<span class="err">' + esc(e) + '</span>' + (w ? '<br />' : '') : '') + (w ? esc(w) + '. Ring-fenced from the autopilot until sold or released.' : '');
}
/* Collapsed by default: one line opens it; the 'on' pill says legs are set while it is closed. */
function tktProtHtml() {
  if (TKT.side !== 'buy') return '';
  const p = TKT.prot, tag = p.open ? '' : (tktProtRules() ? ' <span class="pill own">on</span>' : ' <span class="foot" style="margin:0">optional</span>');
  const head = '<div style="margin:0 0 10px"><a href="#" id="tktProtToggle" style="font-size:13px;font-weight:700">' + (p.open ? '&#9662;' : '&#9656;') + ' Protect these shares</a>' + tag + '</div>';
  if (!p.open) return head;
  return head + '<div class="summary-box" style="margin-bottom:12px">' +
    '<div class="foot" style="margin:0 0 8px">Sell rules that belong to THIS purchase only. The autopilot never touches a protected lot.</div>' +
    tktProtLegHtml('tp', 'Take profit', [['off', 'Off'], ['pct', '+N %'], ['price', 'At a price']]) +
    tktProtLegHtml('sl', 'Stop', [['off', 'Off'], ['pct', '&minus;N %'], ['price', 'At a price'], ['trail', 'Trailing N %']]) +
    '<div class="foot" style="margin:0 0 4px">Time stop</div><label class="f" style="margin:0 0 8px;max-width:220px">Days held before selling (optional)<input id="tktProtDays" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 30" value="' + esc(p.timeDays) + '" /></label>' +
    '<div id="tktProtPreview" style="font-size:12.5px;color:var(--muted)">' + tktProtPreviewHtml() + '</div></div>';
}
function tktProtLegHtml(leg, label, modes) {
  const mode = leg === 'tp' ? TKT.prot.tpMode : TKT.prot.slMode;
  const radios = modes.map(([v, l]) => '<label style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:12.5px;color:var(--text)"><input type="radio" name="tktProt_' + leg + '" value="' + v + '"' + (mode === v ? ' checked' : '') + ' style="width:auto" /> ' + l + '</label>').join('');
  return '<div style="margin-bottom:8px"><div class="foot" style="margin:0 0 4px">' + label + '</div>' + radios + tktProtInputHtml(leg, mode) + '</div>';
}
function tktProtInputHtml(leg, mode) {
  const p = TKT.prot;
  const f = (id, label, val, extra) => '<label class="f" style="margin:6px 0 0;max-width:220px">' + label + '<input id="' + id + '" type="number" min="0" inputmode="decimal" ' + extra + ' value="' + esc(val) + '" /></label>';
  if (leg === 'tp' && mode === 'pct') return f('tktTpPct', 'Sell when up by (%)', p.tpPct, 'step="0.1" placeholder="e.g. 10"');
  if (leg === 'tp' && mode === 'price') return f('tktTpPrice', 'Sell at price ($)', p.tpPrice, 'step="0.01"');
  if (leg === 'sl' && mode === 'pct') return f('tktSlPct', 'Stop when down by (%)', p.slPct, 'step="0.1" placeholder="e.g. 8"');
  if (leg === 'sl' && mode === 'price') return f('tktSlPrice', 'Stop at price ($)', p.slPrice, 'step="0.01"');
  if (leg === 'sl' && mode === 'trail') return f('tktTrailPct', 'Trail below the high by (%)', p.trailPct, 'step="0.1" placeholder="0.5 to 50"');
  return '';
}
/* LIMIT rules only — a market order cannot trade pre/post-market, so the box is not even offered there. */
function tktExtHoursHtml() {
  if (tktRule().type !== 'limit') return '';
  return '<label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text);margin:0 0 10px"><input type="checkbox" id="tktExt" style="width:auto"' + (TKT.extendedHours ? ' checked' : '') + ' /> Eligible pre/post-market (extended hours)</label>';
}
function tktWireProt() {
  tktOn('tktProtToggle', 'onclick', (e) => { e.preventDefault(); tktSyncForm(); TKT.prot.open = !TKT.prot.open; TKT.focusId = 'tktProtToggle'; tktRenderStep(); });
  const form = $('tktForm'); if (!form) return;
  form.querySelectorAll('input[name="tktProt_tp"], input[name="tktProt_sl"]').forEach(r => r.onchange = () => {
    tktSyncForm();
    const tp = r.name === 'tktProt_tp', v = r.value;
    if (tp) TKT.prot.tpMode = v; else TKT.prot.slMode = v;
    const ids = tp ? { pct: 'tktTpPct', price: 'tktTpPrice' } : { pct: 'tktSlPct', price: 'tktSlPrice', trail: 'tktTrailPct' };
    TKT.focusId = ids[v] || 'tktProtToggle';
    tktRenderStep(); tktRenderSummary();
  });
  ['tktTpPct', 'tktTpPrice', 'tktSlPct', 'tktSlPrice', 'tktTrailPct', 'tktProtDays'].forEach(id => tktOn(id, 'oninput', tktLiveUpdate));
  tktOn('tktExt', 'onchange', () => { TKT.extendedHours = !!$('tktExt').checked; tktRenderSummary(); });
}
/* Pull the protection inputs (and the extended-hours box) back into TKT — inputs are the truth. */
function tktSyncProt() {
  const v = (id) => { const el = $(id); return el ? el.value : null; }, p = TKT.prot;
  const a = v('tktTpPct'); if (a != null) p.tpPct = a;
  const b = v('tktTpPrice'); if (b != null) p.tpPrice = b;
  const c = v('tktSlPct'); if (c != null) p.slPct = c;
  const d = v('tktSlPrice'); if (d != null) p.slPrice = d;
  const e = v('tktTrailPct'); if (e != null) p.trailPct = e;
  const f = v('tktProtDays'); if (f != null) p.timeDays = f;
  const x = $('tktExt'); if (x) TKT.extendedHours = !!x.checked;
}
/* Step 3: the protection the minted decision carries — the server's echo first, else the client's rules. */
function tktDecisionProtWords() {
  if (!TKT || TKT.side !== 'buy') return '';
  const d = TKT.decision || {}, rules = tktProtRulesOf(d.protection) || tktProtRules();
  return rules ? tktProtWords(rules, d.refPrice != null ? tktNum(d.refPrice) : null) : '';
}
function tktProtSummaryHtml() {
  const w = tktDecisionProtWords(); if (!w) return '';
  return '<div class="summary-box" style="margin-bottom:12px"><div class="foot" style="margin:0 0 4px">PROTECTED SHARES</div><b style="font-size:13px">' + esc(w) + '.</b>' +
    '<div class="sub" style="margin-top:6px">These shares will be ring-fenced from the autopilot and follow only these rules until sold or released.</div></div>';
}
/* After a placed order: the protected lot the decision minted, and the way to its row on the account. */
function tktLotHtml() {
  const r = TKT.result, d = TKT.decision || {};
  if (!r || tktResultBad(r)) return '';
  const lot = r.lot || d.lot; if (!lot) return '';
  const pending = !lot.status || lot.status === 'pending_fill';
  return '<div class="ok" style="font-size:13px;margin-top:6px;font-weight:700">' +
    (pending ? 'Protected lot pending fill &rarr; exits placed on fill' : 'Protected lot ' + esc(String(lot.status).replace(/_/g, ' '))) +
    ' &middot; <a href="#" id="tktLotsLink">Protected lots on this account &rarr;</a></div>';
}
function tktGoLots(e) {
  if (e && e.preventDefault) e.preventDefault();
  const card = $('lotsCard');
  if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  navigate('account', { book: BOOK, kind: MODE, sub: SUB });
}

/* ── public API ────────────────────────────────────────────────────────────── */
function openTicket(prefillSymbol) {
  const host = $('ticketHost'); if (!host) return;
  tktClearTick();                                  // never leak the previous ticket's quote-poll interval
  TKT = tktFresh(prefillSymbol);
  if (MODE === 'live' && STATUS.liveEnabled === false) {
    tktRenderBlocked('Live trading is disabled on this server (TRADING_LIVE_ENABLED). Orders cannot be placed on live accounts.');
    return;
  }
  tktRender();
  tktLoadFunds();                                  // fill "Available to spend" — best-effort, updates in place
  if (TKT.symbol) tktLookup();
  tktStartTick();                                  // poll the last trade every 5s while the ticket is open
}
function closeTicket() { tktClearTick(); tktDetachSearch(); const host = $('ticketHost'); if (host) host.innerHTML = ''; TKT = null; }
/* The last-trade poll (point 3): a 5s interval that quietly re-fetches /quote while a symbol is set.
   Stored on TKT.tick and cleared by closeTicket and the next openTicket — an interval is never leaked. */
function tktClearTick() { if (TKT && TKT.tick) { clearInterval(TKT.tick); TKT.tick = null; } }
function tktStartTick() { tktClearTick(); if (TKT) TKT.tick = setInterval(tktTick, 5000); }
function tktTick() { if (TKT && !TKT.busy && TKT.symbol && TKT.quote) tktRefreshQuote(); }
/* One quiet quote refresh: keep the last good quote on failure, and PATCH the price/funds/validation
   nodes rather than re-rendering the step (a full re-render would blow away in-progress typing/focus). */
async function tktRefreshQuote() {
  const t = TKT; if (!t || t.busy || !t.symbol) return;
  const sym = t.symbol;
  let q = null;
  try { q = await api('/quote?symbol=' + encodeURIComponent(sym)); } catch (e) { return; }
  if (TKT !== t || t.symbol !== sym || !q || q.price == null) return;
  t.quote = q; t.quoteAt = Date.now(); t.quoteErr = '';
  tktApplyQuote();
}
/* Patch every live-price/funds surface in place. Safe to call on any step — it updates only what exists. */
function tktApplyQuote() {
  const qh = $('tktQuote'); if (qh) { qh.innerHTML = tktQuoteHtml(); tktWireQuoteBlock(); }
  const s2 = $('tktStep2Px'); if (s2) s2.innerHTML = TKT.quote ? tktPx(TKT.quote.price) : '—';
  const c = $('tktCalc'); if (c) c.innerHTML = tktCalcHtml();
  const vd = $('tktValid'); if (vd) vd.innerHTML = tktValidHtml();
  const pp = $('tktProtPreview'); if (pp) pp.innerHTML = tktProtPreviewHtml();
  tktRenderSummary();
}
/* GET /ledger once per ticket → TKT.funds { cash, buyingPower, equity } (null on failure). Then refresh
   the funds displays (step-1 block, step-2 context line, calc/validation and the summary). */
async function tktLoadFunds() {
  const t = TKT; if (!t) return;
  let j = null;
  try { j = await api('/ledger'); } catch (e) { j = null; }
  if (TKT !== t) return;
  const a = j && j.account ? j.account : null;
  t.funds = a ? { cash: tktNum(a.cash), buyingPower: tktNum(a.buyingPower), equity: tktNum(a.equity) } : null;
  const c1 = $('tktCtx1'); if (c1) c1.innerHTML = tktCtxInner(1);
  const cx = $('tktSizeCtx'); if (cx) { cx.innerHTML = tktCtxInner(2); tktOn('tktSellAll', 'onclick', tktSellAll); }
  const c = $('tktCalc'); if (c) c.innerHTML = tktCalcHtml();
  const vd = $('tktValid'); if (vd) vd.innerHTML = tktValidHtml();
  tktRenderSummary();
}
/* As-of time for the last trade — the server's asOf when present, else when this client fetched it. */
function tktAsOf() { const q = TKT.quote; return fmtDate(q && q.asOf ? q.asOf : (TKT.quoteAt || Date.now())); }
/* The ticket cannot open here at all — one sentence and a Close. */
function tktRenderBlocked(msg) {
  const host = $('ticketHost'); if (!host) return;
  host.innerHTML = '<div class="panel"><div class="warn" style="font-size:13px">' + esc(msg) + '</div>' +
    '<div style="margin-top:10px"><button class="btn ghost sm" id="tktClose">Close</button></div></div>';
  tktOn('tktClose', 'onclick', closeTicket);
}
/* A decision minted on another account must never be shown (let alone placed) under this one's name. */
function tktBookMoved() { return !!(TKT && TKT.bookAtMint && TKT.bookAtMint !== BOOK); }

/* ── shell: steps + two-column layout ──────────────────────────────────────── */
function tktRender() {
  if (tktBookMoved()) { closeTicket(); return; }
  const host = $('ticketHost'); if (!host || !TKT) return;
  const steps = TKT_STEPS.map((l, i) => {
    const n = i + 1, k = n < TKT.step ? ' class="done"' : (n === TKT.step ? ' class="on"' : '');
    return '<span' + k + '>' + n + ' ' + esc(l) + '</span>';
  }).join('');
  const note = tktAutopilotOff() ? '<div class="foot" style="margin:0 0 10px">The autopilot is off on this account — this is a manual order the autopilot will not touch.</div>' : '';
  host.innerHTML = '<div class="panel"><h2>' + (TKT.side === 'sell' ? 'Sell a stock' : 'Buy a stock') + '</h2>' + note +
    '<div class="steps">' + steps + '</div>' +
    '<div class="ticket"><div id="tktForm"></div><div id="tktSummary"></div></div></div>';
  tktRenderStep();
  tktRenderSummary();
}
/* The symbol input carries an autocomplete (symbol-search.js) that must be detached before its host
   #tktForm is rebuilt (or the ticket closes) so no debounce timer or orphan dropdown leaks. */
function tktDetachSearch() {
  if (typeof detachSymbolSearch !== 'function') return;
  const el = $('tktSym'); if (el) detachSymbolSearch(el);
}
function tktRenderStep() {
  if (tktBookMoved()) { closeTicket(); return; }
  const f = $('tktForm'); if (!f || !TKT) return;
  tktDetachSearch();
  if (TKT.step === 1) { f.innerHTML = tktStep1Html(); tktWireStep1(); }
  else if (TKT.step === 2) { f.innerHTML = tktStep2Html(); tktWireStep2(); }
  else { f.innerHTML = tktStep3Html(); tktWireStep3(); }
}
function tktGo(step) { TKT.step = step; TKT.formErr = ''; tktRender(); }
function tktRenderSummary() {
  const box = $('tktSummary'); if (!box || !TKT) return;
  const g = STATUS.guardrails || {}, q = tktQty(), p = tktRefPrice(), d = TKT.decision;
  const est = d && d.estNotional != null ? d.estNotional : (q != null && p > 0 ? q * p : null);
  const row = (l, v) => '<div style="display:flex;justify-content:space-between;gap:10px"><span class="foot" style="margin:0">' + l + '</span><span style="text-align:right">' + v + '</span></div>';
  const shares = (n) => n + ' share' + (n === 1 ? '' : 's');
  const dollars = TKT.sizeMode === 'pct' ? tktPctDollars() : tktNum(TKT.notional);
  const amount = TKT.sizeMode === 'shares' ? (q != null ? shares(q) : '—')
    : (dollars > 0 ? money(dollars) + (q != null ? ' (&asymp; ' + shares(q) + ')' : '') : '—');
  const held = tktHeld();
  const fundsRow = TKT.side === 'sell'
    ? row('You hold', held ? shares(Math.floor(held.qty)) : '—')
    : row('Available to spend', tktAvailable() != null ? money(tktAvailable()) : '—');
  const protW = TKT.side === 'buy' ? tktProtWords() : '';
  box.innerHTML = '<div class="summary-box">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>Order summary</b>' +
    '<button class="icon-btn" id="tktClose" title="Close" aria-label="Close" style="width:30px;min-height:28px;font-size:14px">&times;</button></div>' +
    row('Account', '<b style="font-size:13px">' + esc(DISP) + '</b>' + (MODE === 'live' ? ' <span class="pill" style="color:var(--warn);border-color:var(--warn)">live</span>' : '')) +
    row('Side', TKT.side === 'sell' ? '<span class="err">Sell</span>' : '<span class="ok">Buy</span>') +
    fundsRow +
    row('Symbol', TKT.symbol ? '<b style="font-size:13px">' + esc(TKT.symbol) + '</b>' + (TKT.quote ? ' ' + tktPx(TKT.quote.price) : '') : '—') +
    row('Amount', amount) +
    row('Order type', esc(tktRuleLabel(tktRule()))) +
    row('Price rule', esc(tktRuleWords())) +
    row('Time in force', TKT.tif === 'gtc' ? 'Until cancelled (GTC)' : 'Today only (day)') +
    (TKT.side === 'buy' ? row('Protection', protW ? '<span style="font-size:12px">' + esc(protW) + '</span>' : '<span class="foot" style="margin:0">none</span>') : '') +
    (tktRule().type === 'limit' ? row('Extended hours', TKT.extendedHours ? 'yes' : 'no') : '') +
    row('Estimated total', est != null ? '<b style="font-size:13px">' + money(est) + '</b>' : '—') +
    '<div class="foot">Guardrails: max ' + (g.maxNotionalUsd != null ? money(g.maxNotionalUsd) : '—') + ' per order · max ' + (g.maxQty != null ? esc(g.maxQty) : '—') + ' shares</div></div>';
  tktOn('tktClose', 'onclick', closeTicket);
}

/* ── step 1: pick the stock ────────────────────────────────────────────────── */
function tktStep1Html() {
  return '<label class="f">Ticker symbol' +
    '<div style="display:flex;gap:8px;margin-top:4px"><input id="tktSym" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Ticker or company name, e.g. MSFT" style="flex:1;min-width:0;text-transform:uppercase" value="' + esc(TKT.symbol) + '" />' +
    '<button class="btn ghost" id="tktLookup" style="flex:none"' + (TKT.busy ? ' disabled' : '') + '>Look up</button></div></label>' +
    '<div class="foot" style="margin:0 0 8px" id="tktCtx1">' + tktCtxInner(1) + '</div>' +
    '<div id="tktQuote">' + tktQuoteHtml() + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn buy" id="tktNext1"' + (TKT.quote ? '' : ' disabled') + '>Next &rarr;</button></div>';
}
/* Step 1's live block: the last trade big (point 3), its as-of time, a Refresh button, and the funds/
   held context (point 2). Honest labelling — 'Last trade' + as-of, since it is a 5s poll, not a stream. */
function tktQuoteHtml() {
  if (TKT.busy) return spinner('Looking up ' + TKT.symbol + '…');
  if (TKT.quoteErr) return '<div class="err" style="font-size:13px">' + esc(TKT.quoteErr) + '</div>';
  const q = TKT.quote;
  if (!q) return '<div class="foot">Enter a ticker and look it up. The chart and signal model open below while you size the order.</div>';
  return '<div class="foot" style="margin:0 0 2px">Last trade &middot; ' + esc(q.symbol) + '</div>' +
    '<div class="det-price">' + tktPx(q.price) + '</div>' +
    '<div class="foot" style="margin:2px 0 0">as of ' + esc(tktAsOf()) + ' &middot; <a href="#" id="tktRefresh">Refresh</a></div>';
}
/* Wire the Refresh link — called after any (re)render of the #tktQuote block. */
function tktWireQuoteBlock() { tktOn('tktRefresh', 'onclick', (e) => { if (e && e.preventDefault) e.preventDefault(); tktRefreshQuote(); }); }
function tktWireStep1() {
  const inp = $('tktSym'), next = $('tktNext1');
  if (inp) {
    inp.oninput = () => {
      inp.value = inp.value.toUpperCase(); TKT.symbol = inp.value.trim();
      if (TKT.quote && TKT.quote.symbol !== TKT.symbol) {
        TKT.quote = null; TKT.quoteErr = '';
        const qh = $('tktQuote'); if (qh) { qh.innerHTML = tktQuoteHtml(); tktWireQuoteBlock(); }
        if (next) next.disabled = true;
        tktRenderSummary();
      }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tktLookup(); } };
  }
  tktWireQuoteBlock();
  tktOn('tktLookup', 'onclick', tktLookup);
  if (next) next.onclick = () => tktGo(2);
  // Ticker/name autocomplete: picking a hit fills the box with the exact symbol and runs the same
  // Look-up path manual typing uses. Manual typing + the Look up button still work unchanged.
  if (inp && typeof attachSymbolSearch === 'function') attachSymbolSearch(inp, (hit) => {
    if (!TKT) return;
    const el = $('tktSym'); if (el) el.value = hit.symbol;
    TKT.symbol = String(hit.symbol || '').trim().toUpperCase();
    tktLookup();
  });
  if (TKT.busy) return;
  if (TKT.quote && next) next.focus(); else if (inp) { inp.focus(); inp.select(); }
}
async function tktLookup() {
  const t = TKT; if (!t || t.busy) return;
  const inp = $('tktSym'), sym = String(inp ? inp.value : t.symbol).trim().toUpperCase();
  t.symbol = sym; t.quote = null; t.quoteErr = '';
  if (!/^[A-Z.\-]{1,10}$/.test(sym)) { t.quoteErr = 'Enter a ticker symbol (letters, up to 10).'; tktRenderStep(); return; }
  t.busy = true; tktRenderStep();
  let q = null, err = '';
  try { q = await api('/quote?symbol=' + encodeURIComponent(sym)); } catch (e) { err = e.message || 'Quote failed.'; }
  if (TKT !== t) return;
  t.busy = false;
  if (t.symbol === sym) {
    t.quote = q; t.quoteErr = err; if (q) t.quoteAt = Date.now();
    if (q) { try { focus(q.symbol); } catch (e) { /* research pane is optional; the ticket stands alone */ } }
  }
  tktRenderStep(); tktRenderSummary();
}

/* ── when: now, or at a time (ET) — ADR-136 D4 ────────────────────────────── */
/* The current Eastern wall-clock as {date:'YYYY-MM-DD', time:'HH:MM'} — the ticket compares the operator's
   typed date/time against THIS, never the browser's zone. The server converts and re-validates. */
function tktEtNow() {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute };
}
/* 'Wed Sep 9, 2026 at 9:35 AM ET' from the typed date/time (the server answers the same words as fireAtWords). */
function tktFireWords() {
  if (!TKT.fireDate || !TKT.fireTime) return 'at a time (ET)';
  const d = new Date(TKT.fireDate + 'T12:00:00Z'), hm = TKT.fireTime.split(':'), h = Number(hm[0]);
  const day = isNaN(d.getTime()) ? TKT.fireDate : d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return day + ' at ' + ((h % 12) || 12) + ':' + hm[1] + ' ' + (h < 12 ? 'AM' : 'PM') + ' ET';
}
/* Client echo of the kernel's validateFireAt: trading day, 9:00–4:55 PM ET, 5-minute grid, in the future. */
function tktWhenError() {
  if (TKT.when !== 'at') return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(TKT.fireDate || '')) return 'Pick the date the order should fire (Eastern).';
  if (!/^\d{2}:\d{2}$/.test(TKT.fireTime || '')) return 'Pick the time it should fire (Eastern).';
  const wd = new Date(TKT.fireDate + 'T12:00:00Z').getUTCDay();
  if (wd === 0 || wd === 6) return 'Timed orders fire on trading days (Monday to Friday).';
  const hm = TKT.fireTime.split(':'), min = Number(hm[0]) * 60 + Number(hm[1]);
  if (min < 9 * 60 || min > 16 * 60 + 55) return 'Timed orders fire between 9:00 AM and 4:55 PM Eastern.';
  if (Number(hm[1]) % 5 !== 0) return 'Pick a time on the 5-minute grid (9:00, 9:05, …) — that is when the leg ticks.';
  const now = tktEtNow();
  if (TKT.fireDate < now.date || (TKT.fireDate === now.date && TKT.fireTime <= now.time)) return 'That time has already passed (Eastern).';
  return '';
}
function tktWhenHtml() {
  const at = TKT.when === 'at', now = tktEtNow();
  const radio = (v, l) => '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;color:var(--text)"><input type="radio" name="tktWhen" value="' + v + '"' + (TKT.when === v ? ' checked' : '') + ' style="width:auto" /> ' + l + '</label>';
  return '<div style="margin:0 0 10px;font-size:12px;color:var(--muted)">When &nbsp;' + radio('now', 'Now') + radio('at', 'At a time (ET)') + '</div>' +
    (at ? '<div class="grid2"><label class="f">Date (ET)<input id="tktFireDate" type="date" min="' + now.date + '" value="' + esc(TKT.fireDate) + '" /></label>' +
      '<label class="f">Time (ET)<input id="tktFireTime" type="time" step="300" min="09:00" max="16:55" value="' + esc(TKT.fireTime) + '" /></label></div>' +
      '<div class="foot" style="margin:-4px 0 10px">Fires on the 5-minute tick at that time, 9:00 AM–4:55 PM Eastern on a trading day. Nothing is sent until then — cancel it from this account\'s Timed orders card. A day order placed then expires at that day\'s close.</div>' : '');
}

/* ── step 2: size & price rule ─────────────────────────────────────────────── */
function tktStep2Html() {
  const sell = TKT.side === 'sell', price = TKT.quote ? tktPx(TKT.quote.price) : '—';
  const radio = (v, l) => '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;color:var(--text)"><input type="radio" name="tktSize" value="' + v + '"' + (TKT.sizeMode === v ? ' checked' : '') + ' style="width:auto" /> ' + l + '</label>';
  const rules = TKT_RULES.filter(x => sell || !x.sellOnly).map(x => '<option value="' + x.id + '"' + (x.id === TKT.rule ? ' selected' : '') + '>' + esc(tktRuleLabel(x)) + '</option>').join('');
  const prices = tktPriceInputsHtml();
  // BUY is always offered — the switch shows on every account and defaults to Buy (point 1).
  const sideCtl = '<div class="switch"><button id="tktBuy" class="' + (sell ? '' : 'on') + '">Buy</button><button id="tktSell" class="' + (sell ? 'on' : '') + '">Sell</button></div>';
  return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' + sideCtl +
    '<b>' + esc(TKT.symbol) + '</b> <span class="foot" style="margin:0" id="tktStep2Px">' + price + '</span></div>' +
    '<div class="foot" style="margin:-4px 0 10px" id="tktSizeCtx">' + tktCtxInner(2) + '</div>' +
    '<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">Size by &nbsp;' + radio('shares', 'Shares') + radio('dollars', 'Dollars') + radio('pct', '% of available') + '</div>' +
    '<div class="grid2">' + tktSizeInputHtml() + '<label class="f">Price rule<select id="tktRule">' + rules + '</select></label></div>' +
    (prices ? '<div class="grid2">' + prices + '</div>' : '') +
    '<div class="grid2"><label class="f">Time in force<select id="tktTif"><option value="day"' + (TKT.tif === 'day' ? ' selected' : '') + '>Today only (day)</option><option value="gtc"' + (TKT.tif === 'gtc' ? ' selected' : '') + '>Until cancelled (GTC)</option></select></label>' +
    '<label class="f">Why (rationale, optional)<input id="tktWhy" maxlength="500" placeholder="Kept with the order in the journal" value="' + esc(TKT.rationale) + '" /></label></div>' +
    tktWhenHtml() + tktProtHtml() + tktExtHoursHtml() +
    '<div id="tktValid" class="foot" style="min-height:16px">' + tktValidHtml() + '</div>' +
    '<div id="tktFormErr" class="err" style="font-size:13px;margin-top:6px">' + esc(TKT.formErr) + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" id="tktBack2">&larr; Back</button>' +
    '<button class="btn buy" id="tktReview"' + (TKT.busy ? ' disabled' : '') + '>' + (TKT.busy ? 'Checking…' : 'Review &rarr;') + '</button></div>';
}
/* The size context line: a BUY shows what's available to spend; a SELL shows what's held (with a
   one-click "Sell all" on step 2). Used in step 1 (step=1, no Sell-all) and step 2 (step=2). */
function tktCtxInner(step) {
  if (TKT.side === 'sell') {
    const h = tktHeld();
    if (!h) return '<span class="foot" style="margin:0">No ' + esc(TKT.symbol || 'shares') + ' held in this account.</span>';
    return 'You hold <b>' + esc(h.qty) + '</b> share' + (h.qty === 1 ? '' : 's') + (h.avg != null ? ' (avg ' + tktPx(h.avg) + ')' : '') +
      (step === 2 ? ' &middot; <a href="#" id="tktSellAll">Sell all</a>' : '');
  }
  const a = tktAvailable();
  return 'Available to spend: <b>' + (a != null ? money(a) : '&mdash;') + '</b>';
}
function tktSizeInputHtml() {
  if (TKT.sizeMode === 'shares') return '<label class="f">Shares<input id="tktQty" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 25" value="' + esc(TKT.qty) + '" /></label>';
  if (TKT.sizeMode === 'pct') return '<label class="f">% of available<input id="tktPct" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="e.g. 25" value="' + esc(TKT.pctInput) + '" /><div class="foot" id="tktCalc">' + tktCalcHtml() + '</div></label>';
  return '<label class="f">Dollars<input id="tktNotional" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 5000" value="' + esc(TKT.notional) + '" /><div class="foot" id="tktCalc">' + tktCalcHtml() + '</div></label>';
}
function tktPriceInputsHtml() {
  const t = tktRule().type;
  const f = (id, label, val, extra) => '<label class="f">' + label + '<input id="' + id + '" type="number" min="0" inputmode="decimal" ' + extra + ' value="' + esc(val) + '" /></label>';
  return (t === 'stop' || t === 'stop_limit' ? f('tktStop', 'Stop (trigger) price', TKT.stopPrice, 'step="0.01"') : '') +
    (t === 'limit' || t === 'stop_limit' ? f('tktLimit', 'Limit price', TKT.limitPrice, 'step="0.01"') : '') +
    (t === 'trailing_stop' ? f('tktTrail', 'Trail percent (%)', TKT.trailPercent, 'step="0.1" placeholder="e.g. 5"') : '');
}
function tktCalcHtml() {
  if (TKT.sizeMode === 'pct') return tktPctCalcHtml();
  const n = tktNum(TKT.notional), p = tktRefPrice();
  if (!(n > 0)) return 'Whole shares only — the share count is rounded down.';
  if (!(p > 0)) return 'No reference price yet.';
  const cap = tktSellCap(), q = cap != null ? cap : Math.floor(n / p);
  return '&asymp; ' + q + ' share' + (q === 1 ? '' : 's') + ' at ' + tktPx(p) +
    (q >= 1 ? ' (' + money(q * p) + ')' : ' — ' + (TKT.side === 'sell' ? '' : 'buys ') + 'less than one share') +
    (cap != null ? ' — capped at the ' + cap + ' you hold' : '');
}
/* % mode: '<pct>% of $<available> = $<amount> ≈ N shares at $X' (point 4), capped for a sell. */
function tktPctCalcHtml() {
  const pv = tktNum(TKT.pctInput), avail = tktAvailable(), p = tktRefPrice();
  if (!(pv > 0)) return 'Enter a percent (1 to 100) of your available funds.';
  if (pv > 100) return 'That is more than 100% of available.';
  if (avail == null) return 'Available funds unknown — the balance did not load.';
  const amt = avail * pv / 100;
  const head = pv + '% of ' + money(avail) + ' = ' + money(amt);
  if (!(p > 0)) return head + ' — no reference price yet.';
  const cap = tktSellCap(), q = cap != null ? cap : Math.floor(amt / p);
  return head + ' &asymp; ' + q + ' share' + (q === 1 ? '' : 's') + ' at ' + tktPx(p) +
    (q < 1 ? ' — ' + (TKT.side === 'sell' ? '' : 'buys ') + 'less than one share' : '') +
    (cap != null ? ' — capped at the ' + cap + ' you hold' : '');
}
/* Errors (class err) block Review; warnings (class warn) advise and let it through. */
function tktValidHtml() {
  const v = tktValidate(); if (v) return '<span class="err">' + esc(v) + '</span>';
  const w = [tktPriceWarn(), tktFundsWarn(), tktGuardHint()].filter(Boolean);
  if (w.length) return w.map(x => '<span class="warn">' + esc(x) + '</span>').join('<br />');
  return '<span class="ok">Ready to review.</span>';
}
function tktWireStep2() {
  tktOn('tktBuy', 'onclick', () => tktSetSide('buy'));
  tktOn('tktSell', 'onclick', () => tktSetSide('sell'));
  tktOn('tktSellAll', 'onclick', tktSellAll);
  const form = $('tktForm');
  if (form) form.querySelectorAll('input[name="tktSize"]').forEach(r => r.onchange = () => {
    tktSyncForm(); TKT.sizeMode = r.value; TKT.focusId = { shares: 'tktQty', dollars: 'tktNotional', pct: 'tktPct' }[r.value] || 'tktQty'; tktRenderStep(); tktRenderSummary();
  });
  tktOn('tktRule', 'onchange', () => {
    tktSyncForm(); TKT.rule = $('tktRule').value;
    const r = tktRule(), t = r.type;
    TKT.tif = r.tif; // every rule change resets TIF to the rule's default — no GTC market orders by stickiness
    if (t !== 'limit') TKT.extendedHours = false;   // only a LIMIT order may be extended-hours eligible
    TKT.focusId = t === 'market' ? 'tktRule' : (t === 'limit' ? 'tktLimit' : (t === 'trailing_stop' ? 'tktTrail' : 'tktStop'));
    tktRenderStep(); tktRenderSummary();
  });
  tktOn('tktTif', 'onchange', () => { TKT.tif = $('tktTif').value; tktRenderSummary(); });
  ['tktQty', 'tktNotional', 'tktPct', 'tktStop', 'tktLimit', 'tktTrail', 'tktWhy'].forEach(id => tktOn(id, 'oninput', tktLiveUpdate));
  // ADR-136 D4: Now / At a time. Switching re-renders the step (the date/time inputs appear); typing re-validates live.
  if (form) form.querySelectorAll('input[name="tktWhen"]').forEach(r => r.onchange = () => {
    tktSyncForm(); TKT.when = r.value; TKT.focusId = r.value === 'at' ? 'tktFireDate' : null; tktRenderStep(); tktRenderSummary();
  });
  ['tktFireDate', 'tktFireTime'].forEach(id => tktOn(id, 'onchange', tktLiveUpdate));
  tktWireProt();
  tktOn('tktBack2', 'onclick', () => tktGo(1));
  tktOn('tktReview', 'onclick', tktReview);
  const el = (TKT.focusId && $(TKT.focusId)) || $('tktQty') || $('tktNotional') || $('tktPct');
  TKT.focusId = null;
  if (el && !TKT.busy) el.focus();
}
/* Pull every field the operator can type into back into TKT (inputs are the live source of truth). */
function tktSyncForm() {
  const v = (id) => { const el = $(id); return el ? el.value : null; };
  const q = v('tktQty'); if (q != null) TKT.qty = q;
  const n = v('tktNotional'); if (n != null) TKT.notional = n;
  const pc = v('tktPct'); if (pc != null) TKT.pctInput = pc;
  const s = v('tktStop'); if (s != null) TKT.stopPrice = s;
  const l = v('tktLimit'); if (l != null) TKT.limitPrice = l;
  const t = v('tktTrail'); if (t != null) TKT.trailPercent = t;
  const w = v('tktWhy'); if (w != null) TKT.rationale = w;
  const tif = v('tktTif'); if (tif != null) TKT.tif = tif;
  const fd = v('tktFireDate'); if (fd != null) TKT.fireDate = fd;
  const ft = v('tktFireTime'); if (ft != null) TKT.fireTime = ft;
  tktSyncProt();
}
function tktLiveUpdate() {
  tktSyncForm(); TKT.formErr = '';
  const c = $('tktCalc'); if (c) c.innerHTML = tktCalcHtml();
  const pp = $('tktProtPreview'); if (pp) pp.innerHTML = tktProtPreviewHtml();
  const vd = $('tktValid'); if (vd) vd.innerHTML = tktValidHtml();
  const fe = $('tktFormErr'); if (fe) fe.textContent = '';
  tktRenderSummary();
}
function tktSetSide(side) {
  tktSyncForm(); TKT.side = side; TKT.formErr = '';
  if (side === 'buy' && tktRule().sellOnly) { TKT.rule = 'market'; TKT.tif = tktRule().tif; } // trailing-stop is sell-only
  tktRender();
}
function tktSellAll(e) {
  if (e && e.preventDefault) e.preventDefault();
  const h = tktHeld(); if (!h) return;
  tktSyncForm(); TKT.sizeMode = 'shares'; TKT.qty = String(Math.floor(h.qty)); TKT.formErr = ''; TKT.focusId = 'tktQty';
  tktRenderStep(); tktRenderSummary();
}
/* The exact POST /decisions/manual body — only the price params the chosen rule needs are sent. Sizing:
   SHARES → qty; DOLLARS → notional; % OF AVAILABLE → the client-computed dollar amount as notional (the
   server sizes the notional into whole shares). A dollars-/%-mode SELL that hit the held cap is sent as
   the capped SHARE count instead (the server would otherwise size an uncapped notional and mint a short). */
function tktBody() {
  const t = tktRule().type;
  const body = { symbol: TKT.symbol, side: TKT.side, orderType: t, timeInForce: TKT.tif };
  if (TKT.sizeMode === 'shares' || tktSellCap() != null) body.qty = tktQty();
  else if (TKT.sizeMode === 'pct') body.notional = tktPctDollars();
  else body.notional = tktNum(TKT.notional);
  if (t === 'limit' || t === 'stop_limit') body.limitPrice = tktNum(TKT.limitPrice);
  if (t === 'stop' || t === 'stop_limit') body.stopPrice = tktNum(TKT.stopPrice);
  if (t === 'trailing_stop') body.trailPercent = tktNum(TKT.trailPercent);
  const why = String(TKT.rationale || '').trim(); if (why) body.rationale = why;
  // ADR-138: only the chosen legs travel; extendedHours is true only for a LIMIT rule with the box ticked.
  const protect = tktProtRules(); if (protect) body.protect = protect;
  body.extendedHours = t === 'limit' && TKT.extendedHours === true;
  // ADR-136 D4: a timed order carries the Eastern wall-clock; the server converts + validates it.
  if (TKT.when === 'at') body.fireAtEt = { date: TKT.fireDate, time: TKT.fireTime };
  return body;
}
async function tktReview() {
  const t = TKT; if (!t || t.busy) return;
  tktSyncForm();
  const v = tktValidate();
  if (v) { t.formErr = v; const fe = $('tktFormErr'); if (fe) fe.textContent = v; return; }
  // A TIMED order has no Place step — the mint is the commitment (the leg fires it later), so a LIVE
  // account confirms HERE, before anything is written.
  const timed = t.when === 'at';
  if (timed && MODE === 'live' && !confirm('Schedule a LIVE order on ' + DISP + '?\n' + tktSummaryText() + '\nIt will be placed automatically at that time and trades REAL money.')) return;
  t.busy = true; t.formErr = ''; tktRenderStep();
  const book = BOOK;
  let j = null, err = '';
  try { j = await api('/decisions/manual', jbody('POST', tktBody())); } catch (e) { err = e.message || 'Review failed.'; }
  if (TKT !== t) return;
  t.busy = false;
  if (err || !j || !j.decisionId) { t.formErr = err || 'The server did not return a decision.'; tktRenderStep(); return; }
  tktAdoptDecision(t, j, book);
  if (j.dated) { t.result = { ok: true, status: 'scheduled', message: 'Fires ' + (j.dated.fireAtWords || tktFireWords()) + '.', dated: j.dated }; tktRefreshAfterOrder(); }
  tktGo(3);
}
/* The minted decision is the truth from here on: ONE requestId for its whole life (idempotent
   retries), and the SERVER's share count replaces the client's estimate so every panel agrees. */
function tktAdoptDecision(t, j, book) {
  t.decision = j; t.bookAtMint = book; t.result = null;
  t.requestId = 'tkt-' + String(j.decisionId).slice(0, 8);
  t.mintedMode = t.sizeMode;
  t.mintedNotional = t.sizeMode === 'dollars' ? tktNum(t.notional) : (t.sizeMode === 'pct' ? tktPctDollars() : null);
  if (j.decision && j.decision.qty != null) { t.sizeMode = 'shares'; t.qty = String(j.decision.qty); }
}

/* ── step 3: confirm & place ───────────────────────────────────────────────── */
function tktStep3Html() {
  const d = TKT.decision || {}, dd = d.decision || {}, live = MODE === 'live' || !!d.requiresConfirm;
  const r = TKT.result, settled = !!r && (!tktResultBad(r) || r.status === 'duplicate');
  const stats = '<div class="det-stats">' + st('Reference price', tktPx(d.refPrice)) + st('Estimated total', d.estNotional != null ? money(d.estNotional) : '—') +
    st('Order type', esc(dd.orderType || tktRule().type)) + st('Time in force', esc(String(dd.timeInForce || TKT.tif).toUpperCase())) +
    (tktRule().type === 'limit' ? st('Extended hours', TKT.extendedHours ? 'yes' : 'no') : '') +
    (TKT.when === 'at' ? st('Fires', esc(tktFireWords())) : '') + '</div>';
  const from = TKT.mintedNotional != null ? '<div class="foot" style="margin:4px 0 0">from ' + money(TKT.mintedNotional) + ' requested</div>' : '';
  return '<div class="summary-box" style="margin-bottom:12px"><b>' + esc(tktSummaryText()) + '</b>' + from + '</div>' + stats + tktProtSummaryHtml() +
    (live && !settled ? '<div class="livebanner">This is a LIVE account (' + esc(DISP) + ') — the order trades real money and you will be asked to confirm.</div>' : '') +
    '<div class="foot">This does not follow the account\'s strategy; the engine\'s guardrails still apply.</div>' +
    (r ? tktResultHtml() + tktLotHtml() : '') +
    '<div style="display:flex;gap:8px;margin-top:12px">' + tktStep3Actions(live) + '</div>';
}
/* Placed → another/close. Duplicate → journal/close (never a second Place). Otherwise back/place. */
function tktStep3Actions(live) {
  const r = TKT.result, dis = TKT.busy ? ' disabled' : '';
  if (r && !tktResultBad(r)) return '<button class="btn ghost" id="tktAnother">Place another</button><button class="btn ghost" id="tktDone">Close</button>';
  if (r && r.status === 'duplicate') return '<button class="btn ghost" id="tktJournal">Open journal</button><button class="btn ghost" id="tktDone">Close</button>';
  return '<button class="btn ghost" id="tktBack3"' + dis + '>&larr; Back</button>' +
    '<button class="btn buy" id="tktPlace"' + dis + (live ? ' style="background:var(--warn);border-color:var(--warn);color:#2b1d00"' : '') + '>' +
    (TKT.busy ? 'Placing…' : (live ? 'Place LIVE order' : 'Place order')) + '</button>';
}
function tktResultBad(r) { return !r || r.ok === false || /reject|fail|error|block|refus|cancel/i.test(String(r.status || '')); }
function tktResultHtml() {
  const r = TKT.result || {};
  if (r.status === 'scheduled') return '<div class="ok" style="font-size:13px;margin-top:10px;font-weight:700">Scheduled — ' + esc(r.message) + ' Nothing is sent until then. It appears in the Trade journal once placed; until then you can cancel it from this account\'s <a href="#" id="tktDatedLink">Timed orders</a> card.</div>';
  if (r.status === 'duplicate') return '<div class="warn" style="font-size:13px;margin-top:10px;font-weight:700">' + esc(r.message) + '</div>';
  if (tktResultBad(r)) return '<div class="err" style="font-size:13px;margin-top:10px;font-weight:700">Not placed' + (r.status ? ' (' + esc(r.status) + ')' : '') + (r.message ? ' — ' + esc(r.message) : '') + '</div>';
  const fill = r.filledQty != null ? ': ' + esc(r.filledQty) + ' share' + (Number(r.filledQty) === 1 ? '' : 's') + (r.filledAvgPrice != null ? ' @ ' + tktPx(r.filledAvgPrice) : '') : '';
  return '<div class="ok" style="font-size:13px;margin-top:10px;font-weight:700">Order ' + esc(r.status || 'submitted') + fill + (r.message ? ' — ' + esc(r.message) : '') + '</div>';
}
function tktWireStep3() {
  tktOn('tktBack3', 'onclick', tktBackToSize);
  tktOn('tktPlace', 'onclick', tktPlace);
  tktOn('tktAnother', 'onclick', () => openTicket());
  tktOn('tktDone', 'onclick', closeTicket);
  tktOn('tktJournal', 'onclick', () => { if (typeof navigate === 'function') navigate('account', { book: BOOK, kind: MODE, sub: 'journal' }); });
  tktOn('tktLotsLink', 'onclick', tktGoLots);
  tktOn('tktDatedLink', 'onclick', (e) => { if (e && e.preventDefault) e.preventDefault(); const c = $('datedCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const b = $('tktPlace') || $('tktAnother') || $('tktJournal'); if (b && !TKT.busy) b.focus();
}
/* Back discards the minted decision (and its requestId) and restores the sizing mode the operator typed
   in (adopting the decision flips sizeMode to shares — mintedMode remembers dollars/% so Back restores it). */
function tktBackToSize() {
  const t = TKT; if (!t) return;
  if (t.mintedMode) t.sizeMode = t.mintedMode;
  t.decision = null; t.result = null; t.requestId = null; t.bookAtMint = null; t.mintedNotional = null; t.mintedMode = null;
  tktGo(2);
}
async function tktPlace() {
  const t = TKT; if (!t || !t.decision || t.busy) return;
  if (t.bookAtMint !== BOOK) { t.result = { ok: false, message: 'The selected account changed since this order was reviewed. Go back and review it again.' }; tktRenderStep(); return; }
  const live = MODE === 'live' || !!t.decision.requiresConfirm, pw = tktDecisionProtWords();
  if (live && !confirm('Place a LIVE order on ' + DISP + '?\n' + tktSummaryText() + (pw ? '\nProtection: ' + pw + '.' : '') + '\nThis trades REAL money.')) return;
  if (!t.requestId) t.requestId = 'tkt-' + String(t.decision.decisionId).slice(0, 8);
  t.busy = true; t.result = null; tktRenderStep();
  let j = null, err = null;
  try { j = await api('/orders', jbody('POST', { decisionId: t.decision.decisionId, requestId: t.requestId, confirm: live })); }
  catch (e) { err = e || new Error('Order failed.'); }
  if (TKT !== t) return;
  t.busy = false; t.result = err ? tktPlaceError(err) : tktPlaceResult(j);
  tktRenderStep(); tktRenderSummary();
  if (!tktResultBad(t.result)) tktRefreshAfterOrder();
}
/* POST /orders answers `{ ok, order: OrderResult }` — the ORDER's status decides, not the envelope's ok.
   A `lot` on the envelope (ADR-138) rides along so step 3 can name the protected lot. */
function tktPlaceResult(j) {
  if (!j || !j.order) return { ok: false, message: 'No response from the server.' };
  return Object.assign({ ok: j.ok !== false && !/reject/i.test(String(j.order.status || '')), message: j.order.rejectReason || null, lot: j.lot || null }, j.order);
}
/* Pre-venue refusals arrive as thrown Error(message). A duplicate means the venue already has THIS
   decision's order under our requestId — never offer Place again. */
function tktPlaceError(e) {
  const msg = (e && e.message) || 'Order failed.';
  if (/duplicate|already/i.test(msg)) return { ok: false, status: 'duplicate', message: 'This order was already submitted for this decision — check the Trade journal before placing another.' };
  return { ok: false, status: 'rejected', message: msg };
}
/* Best-effort refresh of KPIs + positions (and the Protected lots card, ADR-138) — nothing here may
   ever mask the order result already shown. */
function tktRefreshAfterOrder() {
  const quiet = (fn) => {
    if (typeof fn !== 'function') return;
    try { const p = fn(); if (p && typeof p.catch === 'function') p.catch(() => { /* refresh is best-effort */ }); }
    catch (e) { /* refresh is best-effort; the order result above is already shown */ }
  };
  quiet(typeof loadKpisAndPositions === 'function' ? loadKpisAndPositions : null);
  quiet(typeof loadLotsCard === 'function' ? () => loadLotsCard(RENDER_TOKEN) : null);
  quiet(typeof loadDatedCard === 'function' ? () => loadDatedCard(RENDER_TOKEN) : null);
}
