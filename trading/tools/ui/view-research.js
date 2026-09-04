/* trading/ui/view-research.js — VIEW 'research' (ADR-136 D1/D2): market-wide analysis.
 *
 * Classic script; depends on app.js globals (BOOK/MODE/DISP/SUB/STATUS/UNIVERSE, api(), esc/money/
 * fmtDate, subTabs(), selectTab() shim). Sub-tabs: Recommendations, Algorithms, Capture & signals.
 * The loaders below moved VERBATIM from the single-file page and still paint into #tabbody, which
 * subTabs() provides. Recommendations and scans read the selected account's data rail; captured
 * signals and analyst decisions are filed on that account (api() scopes every call to BOOK).
 * focus() and loadKpisAndPositions() are account-view globals (view-account.js) reached by the
 * "Focus →" buttons and the post-order refresh.
 */

/* ── recommendations — tab ───────────────────────────────────── */
function loadReco() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Market analysis &amp; recommendations</h2>' +
    '<button class="btn ghost sm" id="recoBtn" style="margin-left:auto">Re-analyze</button></div>' +
    '<div id="recoBody"><div class="spin"><span class="dot"></span> Analyzing the market…</div></div></div>';
  $('recoBtn').onclick = doAnalyze; doAnalyze();
}
async function doAnalyze() {
  const body = $('recoBody'); if (!body) return;
  body.innerHTML = '<div class="spin"><span class="dot"></span> Scanning the universe…</div>';
  try {
    const j = await api('/recommendations');
    const list = (arr, kind) => arr.length ? arr.map((r) => {
      const e = r.ensemble || {}; const conf = Math.round((Math.abs(e.score) || 0) * 100);
      const pills = (r.signals || []).map((s) => '<span class="pill ' + (s.dir === 'up' ? 'buy' : 'sell') + '" style="font-size:9px">' + s.algo + '</span>').join(' ');
      return '<div class="sig" style="border-left-color:' + (kind === 'buy' ? 'var(--buy)' : 'var(--sell)') + '">' +
        '<div><span class="pill ' + kind + '">' + kind.toUpperCase() + '</span> <strong>' + esc(r.symbol) + '</strong> ' + money(r.price) +
        ' <span class="foot">conviction ' + conf + '%</span>' +
        ' <button class="btn ghost sm" data-fsym="' + esc(r.symbol) + '" style="float:right">Focus →</button></div>' +
        '<div class="foot" style="margin-top:4px">' + pills + '</div></div>';
    }).join('') : '<div class="foot">none</div>';
    body.innerHTML =
      '<div class="foot" style="margin-bottom:10px">Assessed <strong>' + (j.assessed ? j.assessed.symbols : 0) + '</strong> symbols · ' + ((j.buys||[]).length) + ' buys, ' + ((j.sells||[]).length) + ' sells, ' + (j.holds||0) + ' hold · ' + fmtDate(j.asOf) + '</div>' +
      '<div class="grid2">' +
      '<div><div class="foot" style="color:var(--buy);margin-bottom:4px">TOP BUYS</div>' + list(j.buys||[],'buy') + '</div>' +
      '<div><div class="foot" style="color:var(--sell);margin-bottom:4px">TOP SELLS / SHORTS</div>' + list(j.sells||[],'sell') + '</div></div>';
    body.querySelectorAll('button[data-fsym]').forEach((b) => b.onclick = () => { const s=b.getAttribute('data-fsym'); focus(s); window.scrollTo({top:0,behavior:'smooth'}); });
  } catch (e) { body.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}

/* ── algorithms — tab ────────────────────────────────────────── */
async function loadAlgos() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="panel"><h2>Algorithms — deterministic engine</h2>' +
    '<div class="sub" style="margin-bottom:10px">Scan a watchlist: momentum / gravity / donchian / mean-rev and their ensemble — reproducible from market data, no LLM. Focus any name to chart it and place the trade.</div>' +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap"><input id="scanSyms" placeholder="HD,LOW,GNRC,BLDR,SPY" value="HD,LOW,GNRC,BLDR,SPY" style="max-width:340px"><button class="btn primary" id="scanBtn">Scan</button> <span id="scanMsg" class="sub"></span></div>' +
    '<div id="scoreboard"></div><div id="scanOut"></div></div>';
  $('scanBtn').onclick = doScan; loadScoreboard();
}
async function loadScoreboard() {
  const host = $('scoreboard'); if (!host) return;
  try {
    const a = (await api('/algo-stats')).algos || [];
    host.innerHTML = a.length
      ? '<div class="foot" style="margin-bottom:4px">PER-ALGO LIVE HIT-RATE (resolved predictions)</div><table><thead><tr><th>Algorithm</th><th class="num">resolved</th><th class="num">open</th><th class="num">hit %</th></tr></thead><tbody>'
        + a.map((r) => '<tr><td>' + esc(r.algo) + '</td><td class="num">' + (r.resolved||0) + '</td><td class="num">' + (r.open||0) + '</td><td class="num">' + (r.hit_rate_pct==null?'—':r.hit_rate_pct+'%') + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="foot">No resolved predictions yet — Scan now, then again after the horizon.</div>';
  } catch (e) { host.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}
async function doScan() {
  const msg = $('scanMsg'), out = $('scanOut');
  const syms = ($('scanSyms').value || 'HD,LOW,GNRC,BLDR,SPY').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  msg.className = 'sub'; msg.innerHTML = '<span class="dot"></span> Scanning…';
  try {
    const j = await api('/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: syms }) });
    msg.textContent = 'resolved ' + (j.resolved || 0) + ' prior predictions';
    const rows = (j.scanned || []).filter((s) => !s.error);
    const cell = (s, a) => { const v = (s.signals || []).find((x) => x.algo === a); return v ? '<span class="pill ' + (v.dir === 'up' ? 'buy' : 'sell') + '">' + v.dir + '</span>' : '<span class="foot">—</span>'; };
    out.innerHTML = '<table style="margin-top:8px"><thead><tr><th>Symbol</th><th class="num">price</th><th>momentum</th><th>gravity</th><th>donchian</th><th>mean-rev</th><th>ensemble</th><th></th></tr></thead><tbody>' +
      rows.map((s) => { const e = s.ensemble || { action: 'hold' };
        const ep = '<span class="pill ' + (e.action === 'buy' ? 'buy' : e.action === 'sell' ? 'sell' : 'hold') + '">' + e.action + (e.score != null ? ' ' + e.score : '') + '</span>';
        return '<tr><td><strong>' + esc(s.symbol) + '</strong></td><td class="num">' + money(s.price) + '</td><td>' + cell(s, 'momentum') + '</td><td>' + cell(s, 'gravity') + '</td><td>' + cell(s, 'donchian') + '</td><td>' + cell(s, 'meanrev') + '</td><td>' + ep + '</td><td><button class="btn ghost sm" data-fsym="' + esc(s.symbol) + '">Focus →</button></td></tr>'; }).join('') + '</tbody></table>';
    out.querySelectorAll('button[data-fsym]').forEach((b) => b.onclick = () => { const sy=b.getAttribute('data-fsym'); if(!UNIVERSE[sy]) UNIVERSE[sy]={symbol:sy}; focus(sy); window.scrollTo({top:0,behavior:'smooth'}); });
  } catch (e) { msg.className = 'sub err'; msg.textContent = e.message; }
}

/* ── signal capture + feed — tab ─────────────────────────────── */
function renderCapture() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML =
    '<div class="panel"><h2>Capture a signal</h2>' +
    '<div class="sub" style="margin-bottom:12px">Snapshot what you read — a tweet, a headline. Stored immutably so any trade can be traced back to it.</div>' +
    '<div class="grid2">' +
      '<label class="f">Source<select id="sgSource"><option value="x">X / Twitter</option><option value="news">News</option><option value="inbox">Inbox</option><option value="manual">Manual</option></select></label>' +
      '<label class="f">Symbols (comma-sep)<input id="sgSymbols" placeholder="AAPL, SPY"></label>' +
      '<label class="f">Author / publisher<input id="sgAuthor" placeholder="@source"></label>' +
      '<label class="f">Link (optional)<input id="sgUrl" placeholder="https://…"></label>' +
    '</div>' +
    '<label class="f">Headline / title<input id="sgTitle" placeholder="Short form"></label>' +
    '<label class="f">Body<textarea id="sgBody" placeholder="Paste the artifact text…"></textarea></label>' +
    '<button class="btn primary" id="sgBtn">Capture signal</button> <span id="sgMsg" class="sub"></span></div>' +
    '<div id="feed"></div>';
  $('sgBtn').onclick = captureSignal;
}
async function captureSignal() {
  const msg = $('sgMsg'); const btn = $('sgBtn');
  const body = { source: $('sgSource').value, symbols: $('sgSymbols').value.split(',').map(s=>s.trim()).filter(Boolean),
    author: $('sgAuthor').value.trim(), url: $('sgUrl').value.trim(), title: $('sgTitle').value.trim(), body: $('sgBody').value.trim() };
  if (!body.body && !body.title) { msg.className='sub err'; msg.textContent='Add a headline or body.'; return; }
  btn.disabled = true; msg.className='sub'; msg.innerHTML='<span class="dot"></span> Capturing…';
  try { await api('/signals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    msg.className='sub ok'; msg.textContent='Captured.'; $('sgBody').value=''; $('sgTitle').value=''; await loadFeed();
  } catch (e) { msg.className='sub err'; msg.textContent=e.message; } finally { btn.disabled=false; }
}
async function loadFeed() {
  const host = $('feed'); if (!host) return;
  let signals = [];
  try { signals = (await api('/signals')).signals || []; } catch (e) { host.innerHTML='<div class="panel err">'+esc(e.message)+'</div>'; return; }
  host.innerHTML = '<div class="panel"><h2>Signal feed</h2>' +
    (signals.length ? signals.map(s =>
      '<div class="sig"><div><strong>' + esc(s.title || (s.body||'').slice(0,80)) + '</strong> ' +
      (s.symbols && s.symbols.length ? '<span class="pill">' + s.symbols.map(esc).join(', ') + '</span>' : '') + '</div>' +
      '<div class="foot">' + esc(s.source) + (s.author ? ' · ' + esc(s.author) : '') + ' · ' + fmtDate(s.observed_at) +
      (s.url ? ' · <a href="' + esc(s.url) + '" target="_blank">source</a>' : '') + '</div>' +
      '<div style="margin-top:6px"><button class="btn ghost sm" data-sig="' + s.signal_id + '">Reason over this →</button> <span class="sub" id="dm_' + s.signal_id + '"></span></div>' +
      '<div id="dec_' + s.signal_id + '"></div></div>'
    ).join('') : '<div class="foot">No signals captured yet for ' + esc(DISP) + '.</div>') + '</div>';
  host.querySelectorAll('button[data-sig]').forEach(b => b.onclick = () => decide(b.getAttribute('data-sig')));
}
async function decide(signalId) {
  const msg = $('dm_' + signalId); const host = $('dec_' + signalId);
  msg.className='sub'; msg.innerHTML='<span class="dot"></span> Analyst is reasoning… (~20s)';
  try {
    const j = await api('/decide', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ signalIds:[signalId] }) });
    msg.textContent=''; const d = j.decision; const actionable = d.action !== 'hold' && d.symbol && d.qty > 0;
    host.innerHTML = '<div class="why"><div><span class="pill ' + d.action + '">' + d.action + '</span> ' +
      (actionable ? '<strong>' + esc(d.symbol) + '</strong> · ' + d.qty + ' sh · ' + esc(d.orderType||'market') + (d.limitPrice?(' @ '+money(d.limitPrice)):'') : 'no trade') +
      ' <span class="foot">confidence ' + Math.round((d.confidence||0)*100) + '%</span></div>' +
      '<div class="rat" style="margin-top:8px">' + esc(d.rationale) + '</div>' +
      (actionable ? '<div style="margin-top:10px"><button class="btn ' + (d.side==='sell'?'ghost':'buy') + ' sm" id="exec_' + j.decisionId + '">' + (MODE==='live'?'Place LIVE order':'Place paper order') + '</button> <span class="sub" id="em_' + j.decisionId + '"></span></div>' : '') + '</div>';
    if (actionable) $('exec_' + j.decisionId).onclick = () => execute(j.decisionId, d);
  } catch (e) { msg.className='sub err'; msg.textContent=e.message; }
}
async function execute(decisionId, d) {
  const msg = $('em_' + decisionId); const btn = $('exec_' + decisionId);
  const label = d.side + ' ' + d.qty + ' ' + d.symbol + (d.orderType==='limit'?(' @ '+money(d.limitPrice)):' at market');
  if (STATUS.bookEnabled === false && d.side === 'buy') { alert('This account is view-only — buys are off. Use Start trading on the account page to arm it.'); return; }
  if (MODE === 'live' && !confirm('Place a LIVE order on ' + (DISP||BOOK) + ' to ' + label + '?\nThis trades REAL money in account ' + (DISP||BOOK) + '.')) return;
  btn.disabled = true; msg.className='sub'; msg.innerHTML='<span class="dot"></span> Placing…';
  // ONE requestId per decision (never per click): the engine's reservation arbiter keys on it, so a retry
  // after a lost response is refused as a duplicate instead of placing a second real order.
  const requestId = 'cap-' + String(decisionId).slice(0, 8);
  try { const j = await api('/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ decisionId, requestId, confirm: MODE==='live' }) });
    const ord = (j && j.order) || {}; const bad = /reject|cancel|fail/i.test(String(ord.status || ''));
    msg.className = bad ? 'sub err' : 'sub ok';
    msg.textContent = (bad ? 'Not placed (' : 'Order ') + (ord.status || 'submitted') + (bad ? ')' : '') + (ord.id ? ' (' + String(ord.id).slice(0,8) + ')' : '') + (ord.rejectReason ? ' — ' + ord.rejectReason : '') + '.';
    if (bad) btn.disabled = false;                         // a venue rejection may legitimately be retried (same requestId)
    // The refresh is best-effort and MUST NOT mask the result (this view has no KPI strip).
    try { UNIVERSE = {}; await loadKpisAndPositions(); } catch (re) { /* nothing to paint here */ }
  } catch (e) {
    const dup = /duplicate|already/i.test(e.message || '');
    msg.className = dup ? 'sub warn' : 'sub err';
    msg.textContent = dup ? 'Already submitted for this decision — check the Trade journal before placing again.' : e.message;
    if (!dup) btn.disabled = false;
  }
}

/* ── view entry ──────────────────────────────────────────────── */
async function renderResearchView(token) {
  main.innerHTML = '<div class="panel"><h2>Research</h2><div class="sub">Market-wide analysis. Recommendations and algorithm scans read the selected account\'s data rail; captured signals and analyst decisions are filed on the account shown below.</div></div>' +
    acctContextBar('signals and decisions from this page are filed here') + '<div id="viewTabs"></div>';
  if (stale(token)) return;
  wireAcctContextBar();
  subTabs('viewTabs', [['reco','Recommendations'],['algos','Algorithms'],['capture','Capture & signals']], SUB || 'reco', (k) => {
    if (k === 'reco') loadReco();
    else if (k === 'algos') loadAlgos();
    else if (k === 'capture') { renderCapture(); loadFeed(); }
  });
}
