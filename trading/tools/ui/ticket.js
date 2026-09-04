/* trading/ui/ticket.js — the DIRECT-TRADE ticket ("Buy a stock") of the Trading surface (ADR-136 D3).
 *
 * Classic script; loads after app.js (BOOK/MODE/STATUS/DISP/STATE/UNIVERSE, api(), jbody(), navigate(),
 * esc/money/st/spinner) and shared-positions.js (focus(sym) research pane, loadKpisAndPositions()).
 * Paints into #ticketHost:
 *   1 Pick the stock    — GET /quote, then focus(sym) opens the chart + signal model in #focus.
 *   2 Size & price rule — shares or dollars; plain-word price rules map onto venue order types. A SELL
 *                         shows the held position and is capped at it (this ticket never opens a short).
 *   3 Confirm           — POST /decisions/manual mints the operator decision; POST /orders executes it
 *                         with ONE requestId per decision, so a retry after a lost response cannot
 *                         double-submit at the venue. A LIVE book gets a confirm() naming the account.
 * A view-only book opens sell-only (the server refuses buys there but allows sells); a live book on a
 * server with live trading disabled does not open at all. All state lives in TKT (reset by openTicket).
 * Handlers re-read BOOK/MODE/DISP/STATUS at call time; a ticket minted on another book closes itself.
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
    step: 1, symbol: String(prefill || '').trim().toUpperCase(), quote: null, quoteErr: '', busy: false,
    side: 'buy', sizeMode: 'shares', qty: '', notional: '', rule: 'market',
    limitPrice: '', stopPrice: '', trailPercent: '', tif: 'day', rationale: '',
    formErr: '', focusId: null, decision: null, bookAtMint: null, requestId: null, mintedNotional: null, result: null,
  };
}
const tktNum = (v) => { const n = Number(v); return v === '' || v == null || !isFinite(n) ? null : n; };
const tktPx = (n) => tktNum(n) == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tktOn = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
/* The server refuses BUYS on a disabled book but allows SELLS — the ticket mirrors that: sell-only. */
const tktViewOnly = () => STATUS.bookEnabled === false;
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
  const n = tktNum(TKT.notional), p = tktRefPrice();
  if (!(n > 0) || !(p > 0)) return null;
  const q = Math.floor(n / p); return q >= 1 ? q : null;
}
/* Dollars-mode SELLS are capped at the shares held — you cannot sell what you do not own. */
function tktSellCap() {
  if (TKT.side !== 'sell' || TKT.sizeMode !== 'dollars') return null;
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
  return TKT.side.toUpperCase() + ' ' + (q != null ? q : '?') + ' ' + TKT.symbol + ' on ' + DISP + ' — ' + tktRuleWords() + ', ' + tktTifWords() + '.' +
    (est != null ? ' Estimated total ' + money(est) + '.' : '');
}
/* Blocking problems only — '' means Review may proceed. Non-blocking advice lives in tktPriceWarn(). */
function tktValidate() {
  const t = tktRule().type, lim = tktNum(TKT.limitPrice), stp = tktNum(TKT.stopPrice), tr = tktNum(TKT.trailPercent), held = tktHeld();
  if (!TKT.quote) return 'Look up the stock first.';
  if (TKT.side === 'sell' && !held) return 'You do not hold ' + TKT.symbol + ' in this account — a sell would open a short, which is not supported here.';
  if (TKT.sizeMode === 'shares' && tktQty() == null) return 'Enter a whole number of shares (1 or more).';
  if (TKT.sizeMode === 'dollars' && !(tktNum(TKT.notional) > 0)) return 'Enter a dollar amount.';
  if (TKT.sizeMode === 'dollars' && tktQty() == null) return 'That amount ' + (TKT.side === 'sell' ? 'is' : 'buys') + ' less than one share at ' + tktPx(tktRefPrice()) + '.';
  if (TKT.side === 'sell' && TKT.sizeMode === 'shares' && tktQty() > held.qty) return 'You only hold ' + held.qty + ' share' + (held.qty === 1 ? '' : 's') + '.';
  if (t === 'limit' && !(lim > 0)) return 'Enter the limit price.';
  if (t === 'stop' && !(stp > 0)) return 'Enter the stop (trigger) price.';
  if (t === 'stop_limit' && !(stp > 0 && lim > 0)) return 'Enter both the stop price and the limit price.';
  if (t === 'trailing_stop' && !(tr > 0)) return 'Enter the trail percent.';
  return tktPriceError();
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
/* Client-side echo of the server guardrails — advisory only; POST /decisions/manual is the authority. */
function tktGuardHint() {
  const g = STATUS.guardrails || {}, q = tktQty(), p = tktRefPrice();
  if (q == null) return '';
  if (g.maxQty && q > g.maxQty) return 'Over the guardrail: ' + q + ' shares exceeds the max of ' + g.maxQty + '.';
  if (g.maxNotionalUsd && p > 0 && q * p > g.maxNotionalUsd) return 'Over the guardrail: ~' + money(q * p) + ' exceeds the max of ' + money(g.maxNotionalUsd) + ' per order.';
  return '';
}

/* ── public API ────────────────────────────────────────────────────────────── */
function openTicket(prefillSymbol) {
  const host = $('ticketHost'); if (!host) return;
  TKT = tktFresh(prefillSymbol);
  if (MODE === 'live' && STATUS.liveEnabled === false) {
    tktRenderBlocked('Live trading is disabled on this server (TRADING_LIVE_ENABLED). Orders cannot be placed on live accounts.');
    return;
  }
  if (tktViewOnly()) TKT.side = 'sell';
  tktRender();
  if (TKT.symbol) tktLookup();
}
function closeTicket() { const host = $('ticketHost'); if (host) host.innerHTML = ''; TKT = null; }
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
  const banner = tktViewOnly() ? '<div class="warn" style="font-size:13px;margin-bottom:10px">View-only account (' + esc(DISP) + '): sells only — turn on trading to buy.</div>' : '';
  host.innerHTML = '<div class="panel"><h2>' + (TKT.side === 'sell' ? 'Sell a stock' : 'Buy a stock') + '</h2>' + banner +
    '<div class="steps">' + steps + '</div>' +
    '<div class="ticket"><div id="tktForm"></div><div id="tktSummary"></div></div></div>';
  tktRenderStep();
  tktRenderSummary();
}
function tktRenderStep() {
  if (tktBookMoved()) { closeTicket(); return; }
  const f = $('tktForm'); if (!f || !TKT) return;
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
  const amount = TKT.sizeMode === 'shares' ? (q != null ? shares(q) : '—')
    : (tktNum(TKT.notional) > 0 ? money(TKT.notional) + (q != null ? ' (&asymp; ' + shares(q) + ')' : '') : '—');
  box.innerHTML = '<div class="summary-box">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>Order summary</b>' +
    '<button class="icon-btn" id="tktClose" title="Close" aria-label="Close" style="width:30px;min-height:28px;font-size:14px">&times;</button></div>' +
    row('Account', '<b style="font-size:13px">' + esc(DISP) + '</b>' + (MODE === 'live' ? ' <span class="pill" style="color:var(--warn);border-color:var(--warn)">live</span>' : '')) +
    row('Side', TKT.side === 'sell' ? '<span class="err">Sell</span>' : '<span class="ok">Buy</span>') +
    row('Symbol', TKT.symbol ? '<b style="font-size:13px">' + esc(TKT.symbol) + '</b>' + (TKT.quote ? ' ' + tktPx(TKT.quote.price) : '') : '—') +
    row('Amount', amount) +
    row('Order type', esc(tktRuleLabel(tktRule()))) +
    row('Price rule', esc(tktRuleWords())) +
    row('Time in force', TKT.tif === 'gtc' ? 'Until cancelled (GTC)' : 'Today only (day)') +
    row('Estimated total', est != null ? '<b style="font-size:13px">' + money(est) + '</b>' : '—') +
    '<div class="foot">Guardrails: max ' + (g.maxNotionalUsd != null ? money(g.maxNotionalUsd) : '—') + ' per order · max ' + (g.maxQty != null ? esc(g.maxQty) : '—') + ' shares</div></div>';
  tktOn('tktClose', 'onclick', closeTicket);
}

/* ── step 1: pick the stock ────────────────────────────────────────────────── */
function tktStep1Html() {
  return '<label class="f">Ticker symbol' +
    '<div style="display:flex;gap:8px;margin-top:4px"><input id="tktSym" maxlength="10" autocomplete="off" spellcheck="false" placeholder="e.g. MSFT" style="flex:1;min-width:0;text-transform:uppercase" value="' + esc(TKT.symbol) + '" />' +
    '<button class="btn ghost" id="tktLookup" style="flex:none"' + (TKT.busy ? ' disabled' : '') + '>Look up</button></div></label>' +
    '<div id="tktQuote">' + tktQuoteHtml() + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn buy" id="tktNext1"' + (TKT.quote ? '' : ' disabled') + '>Next &rarr;</button></div>';
}
function tktQuoteHtml() {
  if (TKT.busy) return spinner('Looking up ' + TKT.symbol + '…');
  if (TKT.quoteErr) return '<div class="err" style="font-size:13px">' + esc(TKT.quoteErr) + '</div>';
  const q = TKT.quote;
  if (!q) return '<div class="foot">Enter a ticker and look it up. The chart and signal model open below while you size the order.</div>';
  return '<div class="det-stats">' + st(esc(q.symbol), tktPx(q.price)) + st('As of', '<span style="font-size:12px">' + esc(fmtDate(q.asOf)) + '</span>') + '</div>';
}
function tktWireStep1() {
  const inp = $('tktSym'), next = $('tktNext1');
  if (inp) {
    inp.oninput = () => {
      inp.value = inp.value.toUpperCase(); TKT.symbol = inp.value.trim();
      if (TKT.quote && TKT.quote.symbol !== TKT.symbol) {
        TKT.quote = null; TKT.quoteErr = '';
        const qh = $('tktQuote'); if (qh) qh.innerHTML = tktQuoteHtml();
        if (next) next.disabled = true;
        tktRenderSummary();
      }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tktLookup(); } };
  }
  tktOn('tktLookup', 'onclick', tktLookup);
  if (next) next.onclick = () => tktGo(2);
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
    t.quote = q; t.quoteErr = err;
    if (q) { try { focus(q.symbol); } catch (e) { /* research pane is optional; the ticket stands alone */ } }
  }
  tktRenderStep(); tktRenderSummary();
}

/* ── step 2: size & price rule ─────────────────────────────────────────────── */
function tktStep2Html() {
  const sell = TKT.side === 'sell', price = TKT.quote ? tktPx(TKT.quote.price) : '—';
  const radio = (v, l) => '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;color:var(--text)"><input type="radio" name="tktSize" value="' + v + '"' + (TKT.sizeMode === v ? ' checked' : '') + ' style="width:auto" /> ' + l + '</label>';
  const rules = TKT_RULES.filter(x => sell || !x.sellOnly).map(x => '<option value="' + x.id + '"' + (x.id === TKT.rule ? ' selected' : '') + '>' + esc(tktRuleLabel(x)) + '</option>').join('');
  const prices = tktPriceInputsHtml();
  const sideCtl = tktViewOnly()
    ? '<span class="pill" style="color:var(--warn);border-color:var(--warn)">Sell only</span>'
    : '<div class="switch"><button id="tktBuy" class="' + (sell ? '' : 'on') + '">Buy</button><button id="tktSell" class="' + (sell ? 'on' : '') + '">Sell</button></div>';
  return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' + sideCtl +
    '<b>' + esc(TKT.symbol) + '</b> <span class="foot" style="margin:0">' + price + '</span></div>' +
    tktHeldHtml() +
    '<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">Size by &nbsp;' + radio('shares', 'Shares') + radio('dollars', 'Dollars') + '</div>' +
    '<div class="grid2">' + tktSizeInputHtml() + '<label class="f">Price rule<select id="tktRule">' + rules + '</select></label></div>' +
    (prices ? '<div class="grid2">' + prices + '</div>' : '') +
    '<div class="grid2"><label class="f">Time in force<select id="tktTif"><option value="day"' + (TKT.tif === 'day' ? ' selected' : '') + '>Today only (day)</option><option value="gtc"' + (TKT.tif === 'gtc' ? ' selected' : '') + '>Until cancelled (GTC)</option></select></label>' +
    '<label class="f">Why (rationale, optional)<input id="tktWhy" maxlength="500" placeholder="Kept with the order in the journal" value="' + esc(TKT.rationale) + '" /></label></div>' +
    '<div id="tktValid" class="foot" style="min-height:16px">' + tktValidHtml() + '</div>' +
    '<div id="tktFormErr" class="err" style="font-size:13px;margin-top:6px">' + esc(TKT.formErr) + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" id="tktBack2">&larr; Back</button>' +
    '<button class="btn buy" id="tktReview"' + (TKT.busy ? ' disabled' : '') + '>' + (TKT.busy ? 'Checking…' : 'Review &rarr;') + '</button></div>';
}
/* SELL only: what the operator actually holds here, with a one-click "Sell all". */
function tktHeldHtml() {
  if (TKT.side !== 'sell') return '';
  const h = tktHeld(); if (!h) return '';
  return '<div class="foot" style="margin:-4px 0 10px">You hold ' + esc(h.qty) + ' share' + (h.qty === 1 ? '' : 's') +
    (h.avg != null ? ' (avg ' + tktPx(h.avg) + ')' : '') + ' &middot; <a href="#" id="tktSellAll">Sell all</a></div>';
}
function tktSizeInputHtml() {
  if (TKT.sizeMode === 'shares') return '<label class="f">Shares<input id="tktQty" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 25" value="' + esc(TKT.qty) + '" /></label>';
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
  const n = tktNum(TKT.notional), p = tktRefPrice();
  if (!(n > 0)) return 'Whole shares only — the share count is rounded down.';
  if (!(p > 0)) return 'No reference price yet.';
  const cap = tktSellCap(), q = cap != null ? cap : Math.floor(n / p);
  return '&asymp; ' + q + ' share' + (q === 1 ? '' : 's') + ' at ' + tktPx(p) +
    (q >= 1 ? ' (' + money(q * p) + ')' : ' — ' + (TKT.side === 'sell' ? '' : 'buys ') + 'less than one share') +
    (cap != null ? ' — capped at the ' + cap + ' you hold' : '');
}
/* Errors (class err) block Review; warnings (class warn) advise and let it through. */
function tktValidHtml() {
  const v = tktValidate(); if (v) return '<span class="err">' + esc(v) + '</span>';
  const w = [tktPriceWarn(), tktGuardHint()].filter(Boolean);
  if (w.length) return w.map(x => '<span class="warn">' + esc(x) + '</span>').join('<br />');
  return '<span class="ok">Ready to review.</span>';
}
function tktWireStep2() {
  tktOn('tktBuy', 'onclick', () => tktSetSide('buy'));
  tktOn('tktSell', 'onclick', () => tktSetSide('sell'));
  tktOn('tktSellAll', 'onclick', tktSellAll);
  const form = $('tktForm');
  if (form) form.querySelectorAll('input[name="tktSize"]').forEach(r => r.onchange = () => {
    tktSyncForm(); TKT.sizeMode = r.value; TKT.focusId = r.value === 'shares' ? 'tktQty' : 'tktNotional'; tktRenderStep(); tktRenderSummary();
  });
  tktOn('tktRule', 'onchange', () => {
    tktSyncForm(); TKT.rule = $('tktRule').value;
    const r = tktRule(), t = r.type;
    TKT.tif = r.tif; // every rule change resets TIF to the rule's default — no GTC market orders by stickiness
    TKT.focusId = t === 'market' ? 'tktRule' : (t === 'limit' ? 'tktLimit' : (t === 'trailing_stop' ? 'tktTrail' : 'tktStop'));
    tktRenderStep(); tktRenderSummary();
  });
  tktOn('tktTif', 'onchange', () => { TKT.tif = $('tktTif').value; tktRenderSummary(); });
  ['tktQty', 'tktNotional', 'tktStop', 'tktLimit', 'tktTrail', 'tktWhy'].forEach(id => tktOn(id, 'oninput', tktLiveUpdate));
  tktOn('tktBack2', 'onclick', () => tktGo(1));
  tktOn('tktReview', 'onclick', tktReview);
  const el = (TKT.focusId && $(TKT.focusId)) || $('tktQty') || $('tktNotional');
  TKT.focusId = null;
  if (el && !TKT.busy) el.focus();
}
/* Pull every field the operator can type into back into TKT (inputs are the live source of truth). */
function tktSyncForm() {
  const v = (id) => { const el = $(id); return el ? el.value : null; };
  const q = v('tktQty'); if (q != null) TKT.qty = q;
  const n = v('tktNotional'); if (n != null) TKT.notional = n;
  const s = v('tktStop'); if (s != null) TKT.stopPrice = s;
  const l = v('tktLimit'); if (l != null) TKT.limitPrice = l;
  const t = v('tktTrail'); if (t != null) TKT.trailPercent = t;
  const w = v('tktWhy'); if (w != null) TKT.rationale = w;
  const tif = v('tktTif'); if (tif != null) TKT.tif = tif;
}
function tktLiveUpdate() {
  tktSyncForm(); TKT.formErr = '';
  const c = $('tktCalc'); if (c) c.innerHTML = tktCalcHtml();
  const vd = $('tktValid'); if (vd) vd.innerHTML = tktValidHtml();
  const fe = $('tktFormErr'); if (fe) fe.textContent = '';
  tktRenderSummary();
}
function tktSetSide(side) {
  if (side === 'buy' && tktViewOnly()) return; // a view-only book sells only — the server refuses its buys
  tktSyncForm(); TKT.side = side; TKT.formErr = '';
  if (side === 'buy' && tktRule().sellOnly) { TKT.rule = 'market'; TKT.tif = tktRule().tif; }
  tktRender();
}
function tktSellAll(e) {
  if (e && e.preventDefault) e.preventDefault();
  const h = tktHeld(); if (!h) return;
  tktSyncForm(); TKT.sizeMode = 'shares'; TKT.qty = String(Math.floor(h.qty)); TKT.formErr = ''; TKT.focusId = 'tktQty';
  tktRenderStep(); tktRenderSummary();
}
/* The exact POST /decisions/manual body — only the price params the chosen rule needs are sent. A
   dollars-mode SELL that hit the held cap is sent as the capped SHARE count (the server sizes an
   uncapped notional itself and would otherwise mint a short). */
function tktBody() {
  const t = tktRule().type;
  const body = { symbol: TKT.symbol, side: TKT.side, orderType: t, timeInForce: TKT.tif };
  if (TKT.sizeMode === 'shares' || tktSellCap() != null) body.qty = tktQty(); else body.notional = tktNum(TKT.notional);
  if (t === 'limit' || t === 'stop_limit') body.limitPrice = tktNum(TKT.limitPrice);
  if (t === 'stop' || t === 'stop_limit') body.stopPrice = tktNum(TKT.stopPrice);
  if (t === 'trailing_stop') body.trailPercent = tktNum(TKT.trailPercent);
  const why = String(TKT.rationale || '').trim(); if (why) body.rationale = why;
  return body;
}
async function tktReview() {
  const t = TKT; if (!t || t.busy) return;
  tktSyncForm();
  const v = tktValidate();
  if (v) { t.formErr = v; const fe = $('tktFormErr'); if (fe) fe.textContent = v; return; }
  t.busy = true; t.formErr = ''; tktRenderStep();
  const book = BOOK;
  let j = null, err = '';
  try { j = await api('/decisions/manual', jbody('POST', tktBody())); } catch (e) { err = e.message || 'Review failed.'; }
  if (TKT !== t) return;
  t.busy = false;
  if (err || !j || !j.decisionId) { t.formErr = err || 'The server did not return a decision.'; tktRenderStep(); return; }
  tktAdoptDecision(t, j, book);
  tktGo(3);
}
/* The minted decision is the truth from here on: ONE requestId for its whole life (idempotent
   retries), and the SERVER's share count replaces the client's estimate so every panel agrees. */
function tktAdoptDecision(t, j, book) {
  t.decision = j; t.bookAtMint = book; t.result = null;
  t.requestId = 'tkt-' + String(j.decisionId).slice(0, 8);
  t.mintedNotional = t.sizeMode === 'dollars' ? tktNum(t.notional) : null;
  if (j.decision && j.decision.qty != null) { t.sizeMode = 'shares'; t.qty = String(j.decision.qty); }
}

/* ── step 3: confirm & place ───────────────────────────────────────────────── */
function tktStep3Html() {
  const d = TKT.decision || {}, dd = d.decision || {}, live = MODE === 'live' || !!d.requiresConfirm;
  const r = TKT.result, settled = !!r && (!tktResultBad(r) || r.status === 'duplicate');
  const stats = '<div class="det-stats">' + st('Reference price', tktPx(d.refPrice)) + st('Estimated total', d.estNotional != null ? money(d.estNotional) : '—') +
    st('Order type', esc(dd.orderType || tktRule().type)) + st('Time in force', esc(String(dd.timeInForce || TKT.tif).toUpperCase())) + '</div>';
  const from = TKT.mintedNotional != null ? '<div class="foot" style="margin:4px 0 0">from ' + money(TKT.mintedNotional) + ' requested</div>' : '';
  return '<div class="summary-box" style="margin-bottom:12px"><b>' + esc(tktSummaryText()) + '</b>' + from + '</div>' + stats +
    (live && !settled ? '<div class="livebanner">This is a LIVE account (' + esc(DISP) + ') — the order trades real money and you will be asked to confirm.</div>' : '') +
    '<div class="foot">This does not follow the account\'s strategy; the engine\'s guardrails still apply.</div>' +
    (r ? tktResultHtml() : '') +
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
  const b = $('tktPlace') || $('tktAnother') || $('tktJournal'); if (b && !TKT.busy) b.focus();
}
/* Back discards the minted decision (and its requestId) and restores the sizing the operator typed. */
function tktBackToSize() {
  const t = TKT; if (!t) return;
  if (t.mintedNotional != null) t.sizeMode = 'dollars';
  t.decision = null; t.result = null; t.requestId = null; t.bookAtMint = null; t.mintedNotional = null;
  tktGo(2);
}
async function tktPlace() {
  const t = TKT; if (!t || !t.decision || t.busy) return;
  if (t.bookAtMint !== BOOK) { t.result = { ok: false, message: 'The selected account changed since this order was reviewed. Go back and review it again.' }; tktRenderStep(); return; }
  const live = MODE === 'live' || !!t.decision.requiresConfirm;
  if (live && !confirm('Place a LIVE order on ' + DISP + '?\n' + tktSummaryText() + '\nThis trades REAL money.')) return;
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
/* POST /orders answers `{ ok, order: OrderResult }` — the ORDER's status decides, not the envelope's ok. */
function tktPlaceResult(j) {
  if (!j || !j.order) return { ok: false, message: 'No response from the server.' };
  return Object.assign({ ok: j.ok !== false && !/reject/i.test(String(j.order.status || '')), message: j.order.rejectReason || null }, j.order);
}
/* Pre-venue refusals arrive as thrown Error(message). A duplicate means the venue already has THIS
   decision's order under our requestId — never offer Place again. */
function tktPlaceError(e) {
  const msg = (e && e.message) || 'Order failed.';
  if (/duplicate|already/i.test(msg)) return { ok: false, status: 'duplicate', message: 'This order was already submitted for this decision — check the Trade journal before placing another.' };
  return { ok: false, status: 'rejected', message: msg };
}
/* Best-effort refresh of KPIs + positions — nothing here may ever mask the order result already shown. */
function tktRefreshAfterOrder() {
  if (typeof loadKpisAndPositions !== 'function') return;
  try {
    const p = loadKpisAndPositions();
    if (p && typeof p.catch === 'function') p.catch(() => { /* refresh is best-effort */ });
  } catch (e) { /* refresh is best-effort; the order result above is already shown */ }
}
