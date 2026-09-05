/* trading/ui/shared-positions.js — shared account-detail building blocks (ADR-136 D2).
 *
 * The KPI strip, the positions table, and the focus pane (chart + deterministic signal model +
 * the decision-driven order ticket), moved VERBATIM out of the single-file trading page per
 * ADR-136 D2. Used by view-account.js; classic script, plain globals, loaded after app.js.
 *
 * Every loader that awaits must bail via stale(token) where a token is available. These legacy
 * loaders predate tokens and are only ever invoked from a render that already checked the token,
 * so they are unchanged. Labels that once derived the account name from MODE now use DISP (the
 * human label of the selected book); the LIVE wording stays wherever it warns about real money.
 *
 * ADR-138: window.PINNED_BY_SYMBOL ({SYM: qty}, published by the account view's Protected lots card)
 * marks a held symbol with a 'pinned N' pill in the positions table and the focus pane — those shares
 * are ring-fenced from the autopilot. Absent map → no pill; drawFocusChart(sym) is also reused by the
 * Research view's stock tab (it only needs a #focChart host).
 */

/* ── KPI strip + positions → universe seed ───────────────────── */
async function loadKpisAndPositions() {
  const token = RENDER_TOKEN;                 // bail after the await if the operator navigated away
  try {
    const j = await api('/ledger');
    if (stale(token)) return;
    const kpisHost = $('kpis');
    // HONESTY: a null account means the broker read failed — never paint $0 equity / $0 cash.
    if (!j.account) {
      STATE.equity = 0; STATE.positions = [];
      if (kpisHost) kpisHost.innerHTML = '<div class="panel err">Balances unavailable for ' + esc(DISP) + ' — the broker account read failed' + (j.error ? ': ' + esc(j.error) : '') + '.</div>';
      const ph = $('positionsHero'); if (ph) ph.innerHTML = '';
      return;
    }
    const a = j.account;
    const pos = (j.positions || []).map(p => {
      const cost = Number(p.avgEntryPrice||0) * Number(p.qty||0);
      const px = Number(p.currentPrice|| (cost? (Number(p.marketValue)/Number(p.qty)) : 0));
      return Object.assign({}, p, { cost, price:px, retPct: cost>0 ? (Number(p.unrealizedPl)/cost)*100 : 0 });
    });
    STATE.equity = Number(a.equity||0); STATE.positions = pos;
    const upl = pos.reduce((s,p)=>s+Number(p.unrealizedPl||0),0);
    // ONE consolidated, honest day number. Prefer the server's day = equity − last COMPLETED session close
    // (reliable baseline). Only if that's unavailable fall back to the intraday-move sum. We do NOT add
    // realized-since-entry here — that's accumulated profit, not today's move, and made a down day look green.
    const serverDay = (j.day && j.day.dayPL != null) ? j.day : null;
    const intradayKnown = pos.some(p => p.unrealizedIntradayPl != null);
    const intradayPL = pos.reduce((s,p) => s + (p.unrealizedIntradayPl != null ? Number(p.unrealizedIntradayPl) : 0), 0);
    const dayPL = serverDay ? Number(serverDay.dayPL) : intradayPL;
    const dayPct = serverDay ? Number(serverDay.dayPLPct) : (STATE.equity - dayPL > 0 ? (dayPL/(STATE.equity - dayPL))*100 : 0);
    // hold ourselves accountable: show today's move next to SPY's today move (are we beating the market today?)
    const spyPos = pos.find(p => p.symbol === 'SPY');
    const spyDayPct = (spyPos && spyPos.changeToday != null) ? Number(spyPos.changeToday)*100 : null;
    const spyBit = spyDayPct!=null ? (' <span class="s">vs S&P '+pct(spyDayPct)+'</span>') : '';
    const dayNode = (serverDay || intradayKnown) ? ('<span class="n" style="color:'+(dayPL>=0?'var(--buy)':'var(--sell)')+'">' + money(dayPL) + '</span> <span class="s">' + pct(dayPct) + ' today</span>' + spyBit) : '—';
    // Views without a KPI strip (Research, Reports) call this only to refresh STATE after an order.
    if (!kpisHost) { pos.forEach(p => { UNIVERSE[p.symbol] = Object.assign(UNIVERSE[p.symbol]||{}, { symbol:p.symbol, price:p.price, held:true, qty:p.qty, avg:Number(p.avgEntryPrice||0) }); }); return; }
    kpisHost.innerHTML =
      kpi(money(a.equity), 'Equity') +
      '<div class="kpi"><div>' + dayNode + '</div><div class="l">Day P&L</div></div>' +
      kpi('<span id="kTot">—</span>', 'Total return') +
      kpi('<span id="kVs">—</span>', 'vs S&P 500') +
      kpi(money(upl), 'Open P&L', null, cls(upl)) +
      kpi('<span id="kReal">—</span>', 'Realized today') +
      kpi('<span id="kWin">—</span>', 'Win rate 30d') +
      kpi(money(a.cash), 'Cash') +
      kpi(String(pos.length), 'Positions');
    // seed universe with held names (instant), then focus the largest holding (or SPY)
    pos.forEach(p => { UNIVERSE[p.symbol] = Object.assign(UNIVERSE[p.symbol]||{}, {
      symbol:p.symbol, price:p.price, changePct: p.changeToday!=null?Number(p.changeToday)*100:null,
      held:true, qty:p.qty, avg:Number(p.avgEntryPrice||0), retPct:p.retPct, mktValue:Number(p.marketValue||0),
      uPl:Number(p.unrealizedPl||0), uPlDay:(p.unrealizedIntradayPl!=null?Number(p.unrealizedIntradayPl):null) }); });
    renderPortfolioTable();   // the hero table at the top — lead with the open book
    loadRealized();
  } catch (e) { if (!stale(token)) { const k = $('kpis'); if (k) k.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; } }
}
function kpi(n, l, id, klass) { return '<div class="kpi"' + (id?(' id="'+id+'"'):'') + '><div class="n ' + (klass||'') + '">' + n + '</div><div class="l">' + l + '</div></div>'; }

async function loadRealized() {
  const token = RENDER_TOKEN;
  try {
    const j = await api('/realized'); if (stale(token)) return; const t = j.today || {}, d = j.last30d || {};
    STATE.realized = j; // feeds today's realized into the Day P&L tile on the next render/refresh
    const kr = $('kReal'); if (kr) {
      kr.parentElement.style.color = Number(t.net)>=0?'var(--buy)':'var(--sell)';
      kr.innerHTML = (t.trades ? money(t.net) + ' <span class="s">' + (t.wins||0) + 'W · ' + (t.losses||0) + 'L</span>' : '<span class="s" style="font-size:13px">no closes yet</span>');
    }
    const kw = $('kWin'); if (kw) kw.innerHTML = (d.winRatePct==null ? '<span class="s" style="font-size:13px">building…</span>' : d.winRatePct + '% <span class="s">' + (d.wins||0) + '–' + (d.losses||0) + '</span>');
  } catch { /* tile stays as placeholder */ }
}

/* ── positions list (LEFT) — YOUR BOOK; the signal is annotated ON each holding ──
 * This is the active book, not a recommendation feed: every row is a name you actually hold
 * (HELD qty + unrealized P&L), and the deterministic ensemble shows what to DO with it
 * (SELL→trim / BUY→add / HOLD). New ideas you don't own live in the Recommendations tab. */
function renderPositions() {
  const host = $('uniList'); if (!host) return;
  const items = Object.values(UNIVERSE).filter(u => u.held)
    .sort((a,b) => (Number(b.mktValue)||0)-(Number(a.mktValue)||0) || (a.symbol<b.symbol?-1:1));
  if ($('uniMeta')) $('uniMeta').textContent = items.length + ' held';
  if (!items.length) { host.innerHTML = '<div class="foot">No open positions in ' + esc(DISP) + '.</div>'; return; }
  host.innerHTML = items.map(u => {
    const pnl = u.retPct;
    const sig = u.signal; // ensemble action for THIS holding
    const verb = sig==='sell' ? ' · trim' : sig==='buy' ? ' · add' : sig==='hold' ? ' · hold' : '';
    const sigPill = sig ? '<span class="pill ' + sig + '" style="font-size:9px">' + sig.toUpperCase() + verb + '</span>'
      : '<span class="foot" style="font-size:9px">scoring…</span>';
    const pnlSpan = pnl!=null ? '<span class="c ' + (pnl>=0?'ok':'err') + '">' + pct(pnl) + '</span>' : '<span class="c foot">—</span>';
    const w = pnl!=null ? Math.min(100, Math.max(4, Math.abs(pnl)*5)) : 0;
    const barColor = (pnl||0)>=0 ? '#34c79a' : '#ec7672';
    return '<button class="uni-row' + (u.symbol===CURRENT?' active':'') + '" data-symbol="' + esc(u.symbol) + '">' +
      '<span class="s">' + esc(u.symbol) + '</span><span class="p">' + (u.price?money(u.price):'—') + '</span>' +
      '<span class="a"><span class="pill own" style="font-size:9px">HELD ' + (u.qty||0) + '</span> ' + sigPill + '</span>' + pnlSpan +
      '<span class="gbar"><i style="width:' + w + '%;background:' + barColor + '"></i></span></button>';
  }).join('');
  host.querySelectorAll('.uni-row').forEach(r => r.onclick = () => focus(r.getAttribute('data-symbol')));
}
/* one deterministic scan of the held book → annotate each position with its current ensemble signal */
async function annotatePositionSignals() {
  const token = RENDER_TOKEN;
  const held = Object.values(UNIVERSE).filter(u => u.held).map(u => u.symbol);
  if (!held.length) return;
  try {
    // DB lookup of the engine's recorded signals — ONE query for the whole book, no market-data calls.
    const j = await api('/signal-latest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbols: held }) });
    if (stale(token)) return;   // the operator switched accounts while this was in flight
    (j.results || []).forEach(s => { if (UNIVERSE[s.symbol]) UNIVERSE[s.symbol].signal = (s.ensemble || {}).action || 'hold'; });
    renderPortfolioTable();
  } catch { /* leave rows as 'scoring…' */ }
}

/* ── portfolio table (TAB) — the whole book at a glance: avg cost, value, day & total P&L ──
 * Read-only ledger of what the AI holds and how each name is doing. Sortable; click a row to
 * open that name's chart + signal model + ticket in the detail pane above. This is the view the
 * old screen had — every position and its money, without clicking through one at a time. */
function posSortVal(p) {
  switch (STATE.posSort.key) {
    case 'symbol': return p.symbol;
    case 'qty': return Number(p.qty)||0;
    case 'avg': return Number(p.avgEntryPrice)||0;
    case 'last': return Number(p.price)||0;
    case 'dayPl': return p.unrealizedIntradayPl!=null?Number(p.unrealizedIntradayPl):-1e15;
    case 'dayPct': return p.changeToday!=null?Number(p.changeToday):-1e15;
    case 'uPl': return Number(p.unrealizedPl)||0;
    case 'retPct': return Number(p.retPct)||0;
    default: return Number(p.marketValue)||0;
  }
}
/* ADR-138: 'pinned N' after a symbol whose shares (in part or whole) sit in protected lots. */
function pinnedPill(sym) {
  const m = window.PINNED_BY_SYMBOL, n = m && m[sym] != null ? Number(m[sym]) : 0;
  if (!(n > 0)) return '';
  return ' <span class="pill pinned" title="' + n + ' share' + (n === 1 ? ' is a protected lot' : 's are protected lots') + ' — ring-fenced from the autopilot">pinned ' + n + '</span>';
}
function renderPortfolioTable() {
  const host = $('positionsHero'); if (!host) return;
  const pos = STATE.positions || [];
  if (!pos.length) { host.innerHTML = '<div class="panel"><h2>Positions</h2><div class="foot">No open positions in ' + esc(DISP) + '.</div></div>'; return; }
  const tot = pos.reduce((s,p)=>({ mv:s.mv+Number(p.marketValue||0), day:s.day+(p.unrealizedIntradayPl!=null?Number(p.unrealizedIntradayPl):0), upl:s.upl+Number(p.unrealizedPl||0) }), { mv:0, day:0, upl:0 });
  const dir = STATE.posSort.dir;
  const rows = pos.slice().sort((a,b)=>{ const va=posSortVal(a), vb=posSortVal(b); return dir * (va<vb?-1:va>vb?1:0); });
  const arrow = (k) => STATE.posSort.key===k ? (STATE.posSort.dir<0?' ▾':' ▴') : '';
  const th = (k,label,extra) => '<th class="' + (extra||'') + '" data-sort="' + k + '">' + label + arrow(k) + '</th>';
  const body = rows.map(p => {
    const sig = (UNIVERSE[p.symbol]||{}).signal;
    const verb = sig==='sell'?' · trim':sig==='buy'?' · add':sig==='hold'?' · hold':'';
    const sigPill = sig ? '<span class="pill ' + sig + '" style="font-size:9px">' + sig.toUpperCase() + verb + '</span>' : '<span class="foot" style="font-size:9px">scoring…</span>';
    const dayPl = p.unrealizedIntradayPl!=null?Number(p.unrealizedIntradayPl):null;
    const dayPct = p.changeToday!=null?Number(p.changeToday)*100:null;
    return '<tr data-fsym="' + esc(p.symbol) + '" class="pos-row' + (p.symbol===CURRENT?' active':'') + '" style="cursor:pointer">' +
      '<td><strong>' + esc(p.symbol) + '</strong>' + pinnedPill(p.symbol) + '</td>' +
      '<td>' + sigPill + '</td>' +
      '<td class="num">' + (p.qty) + '</td>' +
      '<td class="num">' + money(p.avgEntryPrice) + '</td>' +
      '<td class="num">' + money(p.price) + '</td>' +
      '<td class="num">' + money(p.marketValue) + '</td>' +
      '<td class="num ' + (dayPl==null?'':(dayPl>=0?'ok':'err')) + '">' + (dayPl==null?'—':money(dayPl)) + '</td>' +
      '<td class="num ' + (dayPct==null?'':(dayPct>=0?'ok':'err')) + '">' + (dayPct==null?'—':pct(dayPct)) + '</td>' +
      '<td class="num ' + (p.unrealizedPl>=0?'ok':'err') + '">' + money(p.unrealizedPl) + '</td>' +
      '<td class="num ' + (p.retPct>=0?'ok':'err') + '">' + pct(p.retPct) + '</td>' +
    '</tr>';
  }).join('');
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Portfolio — ' + esc(DISP) + '</h2>' +
      '<span class="foot" style="margin-left:auto">' + pos.length + ' held · ' + money(tot.mv) + ' value</span></div>' +
    '<div style="overflow-x:auto"><table><thead><tr>' +
      th('symbol','Symbol') + '<th>Signal</th>' + th('qty','Qty','num') + th('avg','Avg cost','num') + th('last','Last','num') +
      th('marketValue','Mkt value','num') + th('dayPl','Today $','num') + th('dayPct','Today %','num') + th('uPl','Total $','num') + th('retPct','Total %','num') +
    '</tr></thead><tbody>' + body + '</tbody>' +
    '<tfoot><tr><td colspan="5" class="foot">Totals</td>' +
      '<td class="num"><strong>' + money(tot.mv) + '</strong></td>' +
      '<td class="num ' + (tot.day>=0?'ok':'err') + '"><strong>' + money(tot.day) + '</strong></td><td></td>' +
      '<td class="num ' + (tot.upl>=0?'ok':'err') + '"><strong>' + money(tot.upl) + '</strong></td><td></td></tr></tfoot>' +
    '</table></div>' +
    '<div class="foot" style="margin-top:8px">Click any row to open its chart, signal model and order ticket below. The AI manages these positions — this table is your read-only ledger of what it holds and how each is doing.</div></div>';
  host.querySelectorAll('th[data-sort]').forEach(t => t.onclick = () => {
    const k = t.getAttribute('data-sort');
    if (STATE.posSort.key===k) STATE.posSort.dir *= -1; else STATE.posSort = { key:k, dir:-1 };
    renderPortfolioTable();
  });
  host.querySelectorAll('tr[data-fsym]').forEach(r => r.onclick = () => { focus(r.getAttribute('data-fsym')); const f=$('focus'); if (f) f.scrollIntoView({ behavior:'smooth', block:'start' }); });
}

/* ── detail pane (RIGHT) — chart + signal model + ticket ─────── */
let FCHART = null, FCANDLE = null, FVOL = null, FENTRY = null;
async function chartBars(symbol, tf) {
  const r = await fetch('/api/trading-charts/bars?symbol=' + encodeURIComponent(symbol) + '&timeframe=' + tf, { credentials: 'include' });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status)); return j.bars || [];
}
function focus(sym) {
  if (!sym) return;
  const host = $('focus');
  // Focus → from a view without a detail pane (Research, Reports): open the account view on this
  // symbol instead of silently doing nothing. renderAccountView consumes PENDING_FOCUS after it paints.
  if (!host) { PENDING_FOCUS = sym; navigate('account', { book: BOOK, kind: MODE, sub: 'journal' }); return; }
  CURRENT = sym;
  document.querySelectorAll('#positionsHero tr[data-fsym]').forEach(r => r.classList.toggle('active', r.getAttribute('data-fsym')===sym));
  const u = UNIVERSE[sym] || { symbol:sym };
  const tfs = ['5Min','1Hour','1Day','1Week'];
  const stancePill = u.signal ? '<span class="pill ' + u.signal + '">' + u.signal.toUpperCase() + '</span>' : (u.held ? '<span class="pill own">HELD</span>' : '');
  const chg = u.changePct!=null ? '<span class="' + (u.changePct>=0?'ok':'err') + '">' + pct(u.changePct) + '</span>' : '';
  const statGrid = u.held ? (
    '<div class="det-stats">' +
      st('Shares', String(u.qty||0)) +
      st('Avg cost', u.avg?money(u.avg):'—') +
      st('Last', u.price?money(u.price):'—') +
      st('Mkt value', u.mktValue!=null?money(u.mktValue):'—') +
      st('Today', dollarPctCell(u.uPlDay, u.changePct)) +
      st('Total P&L', dollarPctCell(u.uPl, u.retPct)) +
    '</div>'
  ) : '';
  host.innerHTML =
    '<div class="det-head"><div class="det-id">' +
      '<h2>' + esc(sym) + ' ' + stancePill + (u.held?'<span class="pill own">held ' + (u.qty||0) + '</span>':'') + pinnedPill(sym) + '</h2>' +
      '<div class="det-price">' + (u.price?money(u.price):'—') + '</div>' +
      '<div class="det-meta">' + chg + (u.avg?('<span>avg ' + money(u.avg) + '</span>'):'') + (u.retPct!=null?('<span class="' + (u.retPct>=0?'ok':'err') + '">' + pct(u.retPct) + ' unreal</span>'):'') + '</div>' +
    '</div><div class="tf-switch" id="focTf">' + tfs.map(t => '<button data-tf="' + t + '"' + (t===FOC_TF?' class="on"':'') + '>' + t + '</button>').join('') + '</div></div>' +
    statGrid +
    '<div class="det-chart" id="focChart"></div>' +
    '<div style="margin-top:14px"><div class="panel head2" style="padding:0;margin-bottom:10px;background:none;border:0;box-shadow:none"><h2 style="margin:0;font-size:13px">Signal model</h2>' +
      '<span class="foot" style="margin-left:auto" id="focConv">scoring…</span></div>' +
      '<div class="sigmodel" id="focSig"><div class="spin"><span class="dot"></span></div></div><div class="sm-why" id="focWhy"></div></div>' +
    '<div id="focTicket" style="margin-top:14px"></div>';
  $('focTf').querySelectorAll('button').forEach(b => b.onclick = () => { FOC_TF = b.getAttribute('data-tf'); $('focTf').querySelectorAll('button').forEach(x=>x.className=''); b.className='on'; drawFocusChart(sym); });
  drawFocusChart(sym);
  loadSignalModel(sym);
}
async function drawFocusChart(sym) {
  const el = $('focChart'); if (!el) return;
  if (!window.LightweightCharts) { el.innerHTML = '<div class="foot err" style="padding:14px">Chart library failed to load.</div>'; return; }
  if (FCHART) { try { FCHART.remove(); } catch {} FCHART = null; FENTRY = null; }
  const css = getComputedStyle(document.documentElement); const line = (v,d)=>(css.getPropertyValue(v).trim()||d);
  FCHART = LightweightCharts.createChart(el, { width: el.clientWidth, height: 330,
    layout:{ background:{ type:'solid', color:'transparent' }, textColor: line('--muted','#8a99a3') },
    grid:{ vertLines:{ color: line('--line','#26333f') }, horzLines:{ color: line('--line','#26333f') } },
    timeScale:{ timeVisible: FOC_TF==='5Min'||FOC_TF==='1Hour', borderColor: line('--line','#26333f') },
    rightPriceScale:{ borderColor: line('--line','#26333f') }, crosshair:{ mode:0 } });
  FCANDLE = FCHART.addCandlestickSeries({ upColor:'#34c79a', downColor:'#ec7672', wickUpColor:'#34c79a', wickDownColor:'#ec7672', borderVisible:false });
  FVOL = FCHART.addHistogramSeries({ priceFormat:{ type:'volume' }, priceScaleId:'' });
  FVOL.priceScale().applyOptions({ scaleMargins:{ top:0.82, bottom:0 } });
  try {
    const bars = await chartBars(sym, FOC_TF);
    FCANDLE.setData(bars.map(b => ({ time:b.t, open:b.o, high:b.h, low:b.l, close:b.c })));
    FVOL.setData(bars.map(b => ({ time:b.t, value:b.v, color: b.c>=b.o?'rgba(52,199,154,.35)':'rgba(236,118,114,.35)' })));
    const avg = (UNIVERSE[sym]||{}).avg || 0;
    if (avg > 0) FENTRY = FCANDLE.createPriceLine({ price: avg, color:'#5fa8ff', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'avg cost' });
    FCHART.timeScale().fitContent();
    try { new ResizeObserver(()=>{ if (FCHART && el.clientWidth) FCHART.applyOptions({ width: el.clientWidth }); }).observe(el); } catch {}
  } catch (e) {
    const m = String(e.message || '');
    const feedDown = /HTTP 50\d|alpaca_|fetch failed|timed?_?out|timeout|data_feed|broker_not_configured/i.test(m);
    el.innerHTML = '<div style="padding:18px 16px;color:var(--muted);font-size:13px;line-height:1.6">' +
      '<div style="font-weight:800;color:var(--text);margin-bottom:4px">Live chart unavailable</div>' +
      (feedDown
        ? 'The market-data feed isn’t responding right now (' + esc(m) + '). The position numbers above are live from your broker — only the candles are missing.'
        : esc(m)) +
      ' <button class="btn ghost sm" id="focChartRetry" style="margin-top:10px;display:block">Retry chart</button></div>';
    const rb = document.getElementById('focChartRetry'); if (rb) rb.onclick = () => drawFocusChart(sym);
  }
}
/* the deterministic "influence model": the engine's per-algo signals + ensemble for this name.
 * Default = a pure DB read of the engine's RECORDED signals (no Alpaca call, no rate limit). The
 * "Recompute live" button is the only click path that re-hits the market-data feed on demand. */
function renderSigModel(sym, s, live) {
  const host = $('focSig'), why = $('focWhy'), conv = $('focConv'); if (!host || CURRENT !== sym) return;
  const e = s.ensemble || { action:'hold', score:0 };
  const sigs = s.signals || [];
  const ALGOS = ['momentum','gravity','donchian','meanrev'];
  if (conv) conv.innerHTML = 'ensemble <span class="pill ' + (e.action==='buy'?'buy':e.action==='sell'?'sell':'hold') + '">' + e.action + (e.score!=null?(' ' + e.score):'') + '</span>';
  host.innerHTML = ALGOS.map(algo => {
    const v = sigs.find(x => (x.algo||'').toLowerCase().startsWith(algo.slice(0,4)));
    const dir = v ? v.dir : null;
    const mag = v && v.confidence!=null ? Math.round(Math.abs(v.confidence)*100) : (dir? 60 : 0);
    const wpx = Math.min(50, mag/2);
    const barI = dir==='up' ? '<i class="pos" style="width:' + wpx + '%"></i>' : dir==='down' ? '<i class="neg" style="width:' + wpx + '%"></i>' : '';
    const val = dir==='up' ? '<span class="v ok">▲</span>' : dir==='down' ? '<span class="v err">▼</span>' : '<span class="v foot">—</span>';
    return '<div class="sm-row"><span class="k">' + algo + '</span><span class="sm-bar"><span class="mid"></span>' + barI + '</span>' + val + '</div>';
  }).join('');
  const mtf = s.mtf ? ' Multi-timeframe conviction: <strong class="' + (s.mtf.dir==='up'?'ok':'err') + '">' + s.mtf.dir + ' ' + Math.round((s.mtf.confidence||0)*100) + '%</strong>.' : '';
  if (s.error) why.innerHTML = '<span class="err">' + esc(s.error) + '</span>';
  else if (!sigs.length && !s.mtf) why.innerHTML = '<span class="err">No stored signal for ' + esc(sym) + ' yet — the engine hasn’t scored it recently. Hit “Recompute live”.</span> <button class="btn ghost sm" id="focRecompute" style="margin-top:8px">Recompute live</button>';
  else why.innerHTML = (live
      ? 'Recomputed live just now from market data (momentum, gravity, donchian, mean-reversion — no LLM).'
      : 'Latest stored read from the engine — a DB lookup, no live call' + (s.asOf?(' · as of ' + fmtDate(s.asOf)):'') + '.') +
    mtf + ' Current: ' + e.action + (e.score!=null?(' (score ' + e.score + ')'):'') + '.' +
    ' <button class="btn ghost sm" id="focRecompute" style="margin-top:8px">Recompute live</button>';
  const rb = $('focRecompute'); if (rb) rb.onclick = () => recomputeSignalLive(sym);
  renderTicket(sym, e);
}
/* passive read — pure DB lookup of the engine's recorded signals (no Alpaca call, no rate limit) */
async function loadSignalModel(sym) {
  try {
    const j = await api('/signal-latest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbols:[sym] }) });
    renderSigModel(sym, (j.results || []).find(x => x.symbol===sym) || { signals:[], ensemble:{ action:'hold', score:0 } }, false);
  } catch (err) {
    if (CURRENT === sym) { const h=$('focSig'); if (h) h.innerHTML = '<div class="foot err">' + esc(err.message) + '</div>'; const c=$('focConv'); if (c) c.textContent=''; }
  }
}
/* explicit, user-triggered live recompute — the ONLY click path that calls the market-data feed */
async function recomputeSignalLive(sym) {
  const why = $('focWhy'); if (why) why.innerHTML = '<span class="dot"></span> Recomputing from live market data…';
  try {
    const j = await api('/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbols:[sym] }) });
    renderSigModel(sym, (j.scanned || []).find(x => x.symbol===sym) || { signals:[], ensemble:{ action:'hold', score:0 } }, true);
  } catch (err) {
    if (CURRENT === sym && why) why.innerHTML = '<span class="err">' + esc(err.message) + '</span>';
  }
}
function renderTicket(sym, ensemble) {
  const host = $('focTicket'); if (!host) return;
  const act = (ensemble||{}).action || 'hold';
  if (act === 'hold') { host.innerHTML = '<div class="why">Ensemble says <strong>HOLD</strong> — no order proposed. Capture a signal or wait for the read to firm up.</div>'; return; }
  host.innerHTML = '<div class="why"><div class="panel head2" style="padding:0;background:none;border:0;box-shadow:none;margin:0 0 8px"><h2 style="margin:0;font-size:13px">Order ticket</h2><span class="pill ' + (act==='buy'?'buy':'sell') + '" style="margin-left:auto">' + act.toUpperCase() + '</span></div>' +
    '<button class="btn ' + (act==='buy'?'buy':'ghost') + ' sm" id="focTrade">' + (MODE==='live'?'Reason &amp; place LIVE order':'Reason &amp; place paper order') + '</button> <span class="sub" id="focTradeMsg"></span><div id="focTradeOut"></div></div>';
  $('focTrade').onclick = () => focusTrade(sym);
}
async function focusTrade(sym) {
  const out = $('focTradeOut'), msg = $('focTradeMsg'); if (!out) return;
  msg.className='sub'; msg.innerHTML='<span class="dot"></span> Deterministic decision…';
  try {
    const d = await api('/decide-algo', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: sym }) });
    const dec = d.decision || {}; msg.textContent='';
    if (dec.action === 'hold') { out.innerHTML = '<div class="foot" style="margin-top:8px">Ensemble says HOLD — no trade. ' + esc(dec.rationale || '') + '</div>'; return; }
    out.innerHTML = '<div style="margin-top:8px"><div class="rat" style="margin-bottom:8px">' + esc(dec.rationale || '') + '</div>' +
      '<button class="btn ' + (dec.side==='sell'?'ghost':'buy') + ' sm" id="focExec">' + (MODE==='live'?'Place LIVE order':'Place paper order') + ' · ' + dec.side + ' ' + dec.qty + ' ' + esc(sym) + '</button> <span class="sub" id="focExecMsg"></span></div>';
    $('focExec').onclick = async () => {
      const em = $('focExecMsg');
      if (STATUS.bookEnabled === false && dec.side === 'buy') { alert('This account is view-only — buys are off. Use Start trading on this account page to arm it.'); return; }
      if (MODE === 'live' && !confirm('LIVE order on ' + (DISP||BOOK) + ': ' + dec.side + ' ' + dec.qty + ' ' + sym + '?\nThis trades REAL money in account ' + (DISP||BOOK) + '.')) return;
      em.className='sub'; em.innerHTML='<span class="dot"></span> Placing…';
      // ONE requestId per decision (never per click): the engine's reservation arbiter keys on it, so a
      // retry after a lost response is refused as a duplicate instead of placing a second real order.
      const requestId = 'foc-' + String(d.decisionId).slice(0, 8);
      try {
        const o = await api('/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ decisionId: d.decisionId, requestId, confirm: MODE==='live' }) });
        const ord = (o && o.order) || {};
        const bad = /reject|cancel|fail/i.test(String(ord.status || ''));
        em.className = bad ? 'sub err' : 'sub ok';
        em.textContent = (bad ? 'Not placed (' : 'Order ') + esc(ord.status || 'submitted') + (bad ? ')' : '') + (ord.rejectReason ? ' — ' + ord.rejectReason : '') + '.';
        try { UNIVERSE = {}; await loadKpisAndPositions(); } catch (re) { /* refresh is best-effort; the result above stands */ }
      } catch (e) { em.className='sub err'; em.textContent = /duplicate|already/i.test(e.message) ? 'Already submitted for this decision — check the Trade journal before placing again.' : e.message; }
    };
  } catch (e) { msg.className='sub err'; msg.textContent = e.message; }
}

/* ── perf summary (KPI tiles only) ───────────────────────────── */
async function loadPerfSummary() {
  const token = RENDER_TOKEN;
  try {
    const j = await api('/performance?period=' + PERF_PERIOD); if (stale(token)) return; const s = j.summary || {};
    const totRet = (s.inceptionReturnPct != null) ? s.inceptionReturnPct : s.totalReturnPct;
    const kt = $('kTot'); if (kt && totRet!=null) { kt.textContent = pct(totRet); kt.parentElement.style.color = totRet>=0?'var(--buy)':'var(--sell)'; }
    const kv = $('kVs'); if (kv && s.vsSpyPct!=null) { kv.textContent = pct(s.vsSpyPct); kv.parentElement.style.color = s.vsSpyPct>=0?'var(--buy)':'var(--sell)'; }
  } catch { /* tiles stay as placeholders */ }
}
