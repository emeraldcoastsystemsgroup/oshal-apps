/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Give each real account a separate holdings, recorded value and benchmark dashboard with no financial action controls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Holdings performance: gain/loss bars per holding and any holding's daily price against the comparison symbol, so the page shows performance on day one while account history is still being recorded.
 */
'use strict';
function nativeDetailsHref(a){return '/api/trading/?view=accounts&sub=details&account='+encodeURIComponent(a.accountId)+'&connection='+encodeURIComponent(a.connectionKey);}
function detailsMoney(n){return n==null||!Number.isFinite(Number(n))?'—':new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);}
function detailsPercent(n){return n==null||!Number.isFinite(n)?'—':(n>0?'+':'')+n.toFixed(2)+'%';}
function detailsGain(positions){return positions.every(p=>p.unrealizedPl!=null&&Number.isFinite(Number(p.unrealizedPl)))?positions.reduce((sum,p)=>sum+Number(p.unrealizedPl),0):null;}
/** @description Keep account details bookmarkable under Accounts, independent of the strategy page.
 * @param {object} model Exact owner roster row. @returns {void} Page routing only. */
function nativeAccountDetailsView(model){
 ++RENDER_TOKEN;const token=RENDER_TOKEN;
 main.onclick=null;main.onchange=null;main.onsubmit=null;
 if(typeof VIEW!=='undefined'){VIEW='accounts';SUB='details';if(typeof renderNav==='function')renderNav();}
 const q=new URLSearchParams(location.search);q.set('view','accounts');q.set('sub','details');q.set('account',model.accountId);q.set('connection',model.connectionKey);q.delete('tab');history.replaceState(null,'',location.pathname+'?'+q);
 main.innerHTML='<div class="account-details"><section class="panel details-header"><div><button class="btn ghost sm" data-details-back>← Accounts dashboard</button><p class="native-eyebrow">Account details · Schwab</p><h1>'+esc(model.label)+'</h1><p class="sub" data-details-asof>Reading current balances and holdings…</p></div><button class="btn primary" data-details-manage>Manage strategy →</button></section><div data-details-status role="status" aria-live="polite"></div><div data-details-summary></div><section class="panel"><div class="details-section-head"><div><h2>Account value &amp; comparison</h2><p class="sub">Recorded account balances, including cash.</p></div><div class="details-filters"><label>Period<select data-details-period><option value="1W">1 week</option><option value="1M" selected>1 month</option><option value="3M">3 months</option><option value="1Y">1 year</option><option value="ALL">All recorded</option></select></label><form data-details-form><label>Compare with<input data-details-compare value="SPY" maxlength="15" list="details-benchmarks" aria-label="Comparison symbol"></label><datalist id="details-benchmarks"><option value="SPY">S&amp;P 500 ETF</option><option value="QQQ">Nasdaq 100 ETF</option><option value="DIA">Dow ETF</option><option value="IWM">Russell 2000 ETF</option></datalist><button class="btn" type="submit">Compare</button></form></div></div><div data-details-charts></div></section><section class="panel"><div class="details-section-head"><div><h2>Holdings performance</h2><p class="sub">Gain or loss since purchase, and a holding\u2019s price against the comparison symbol.</p></div></div><div class="details-chart-grid"><article><h3>Gain / loss by holding</h3><div data-details-bars></div></article><article data-details-stock></article></div></section><section class="panel"><div class="details-section-head"><div><h2>Current holdings</h2><p class="sub">Select a symbol to chart its price against the comparison symbol.</p></div><span data-details-count class="pill"></span></div><div data-details-holdings class="details-table-scroll"></div></section></div>';
 main.querySelector('[data-details-back]').onclick=()=>navigate('accounts',{sub:null});
 main.querySelector('[data-details-manage]').onclick=()=>nativeAccountView(model);
 main.querySelector('[data-details-period]').onchange=()=>loadNativeAccountDetails(model,token);
 main.querySelector('[data-details-form]').onsubmit=e=>{e.preventDefault();loadNativeAccountDetails(model,token);};
 loadNativeAccountDetails(model,token);
}
async function loadNativeAccountDetails(model,token){
 const host=main.querySelector('.account-details');if(!host)return;
 const notice=host.querySelector('[data-details-status]'),compare=host.querySelector('[data-details-compare]').value.trim().toUpperCase(),period=host.querySelector('[data-details-period]').value;
 const requestId=String(Number(host.dataset.request||0)+1);host.dataset.request=requestId;
 const current=()=>!stale(token)&&host.isConnected&&host.dataset.request===requestId;
 notice.textContent='Updating account details…';
 try{
  const answer=await api('/portfolio/account-details?'+new URLSearchParams({accountId:model.accountId,connectionKey:model.connectionKey,period,compare}));
  if(!current())return;
  if(!sameNativeAccount(answer.account,model))throw Error('The response did not match this account and connection.');
  paintNativeAccountDetails(host,answer);
  notice.textContent='';
  const positions=answer.account.holdings||answer.account.positions||[],held=positions.slice().sort((a,b)=>(b.marketValue||0)-(a.marketValue||0));
  if(!positions.some(p=>p.symbol===host.dataset.stock))host.dataset.stock=held[0]?.symbol||compare;
  const chart=()=>loadNativeStockComparison(host,model,host.dataset.stock,compare,period,current);
  host.querySelectorAll('[data-details-symbol]').forEach(button=>button.onclick=()=>{host.dataset.stock=button.dataset.detailsSymbol;chart();host.querySelector('[data-details-stock]').scrollIntoView({block:'nearest'});});
  chart();
 }catch(e){if(current()){notice.className='native-attention';notice.textContent=e.message;}}
}
function detailsMetric(label,value,extra=''){return '<div class="details-metric"><span>'+esc(label)+'</span><strong>'+value+'</strong>'+(extra?'<small>'+esc(extra)+'</small>':'')+'</div>';}
function paintNativeAccountDetails(host,data){
 const a=data.account,positions=a.holdings||a.positions||[],gain=detailsGain(positions),held=positions.every(p=>Number.isFinite(p.marketValue))?positions.reduce((sum,p)=>sum+p.marketValue,0):null;
 host.querySelector('[data-details-asof]').textContent='Updated '+new Date(data.readAt).toLocaleString()+' · '+(a.constraints?.registration||a.accountType);
 host.querySelector('[data-details-summary]').innerHTML='<section class="details-metrics">'+detailsMetric('Account value',detailsMoney(a.equity))+detailsMetric('Cash',detailsMoney(a.cash))+detailsMetric('Holdings value',detailsMoney(held),positions.length+' positions')+detailsMetric('Open-position gain / loss',detailsMoney(gain),'Since entry; excludes closed trades')+'</section>';
 host.querySelector('[data-details-count]').textContent=positions.length+' holdings';
 host.querySelector('[data-details-holdings]').innerHTML=detailsHoldingsTable(positions,a.equity);
 host.querySelector('[data-details-bars]').innerHTML=detailsHoldingBars(positions);
 const history=data.history,comparison=data.benchmark,points=comparison.points||[],last=comparison.status==='available'?points.at(-1):null;
 host.querySelector('[data-details-charts]').innerHTML='<div class="details-chart-grid"><article><h3>Account value over time</h3><p class="details-chart-value">'+detailsMoney(history.points.at(-1)?.value)+'</p>'+detailsLineChart(history.points.map(p=>({date:p.date,value:p.value})),'Recorded account value',false)+'<p class="sub">'+esc(history.message||history.basis)+'</p></article><article><h3>Value change vs. '+esc(comparison.symbol)+'</h3><p class="sub">'+(last?'Matching dates: '+esc(points[0].date)+' – '+esc(last.date):'At least two matching account observations are needed.')+'</p>'+detailsBarChart(last,comparison.symbol)+'<p class="sub">'+esc(comparison.message||comparison.basis||'A comparison becomes available as actual account history is recorded.')+'</p></article></div><details class="details-observations"><summary>Recorded values and comparison details</summary><p class="sub">'+esc(history.basis)+'</p><div class="details-table-scroll"><table><thead><tr><th>Observed</th><th>Account value</th><th>Cash</th></tr></thead><tbody>'+history.points.map(p=>'<tr><td>'+esc(new Date(p.at).toLocaleString())+'</td><td>'+detailsMoney(p.value)+'</td><td>'+detailsMoney(p.cash)+'</td></tr>').join('')+'</tbody></table></div></details>';
}
const DETAIL_DAYS={'1W':7,'1M':31,'3M':93,'1Y':366,'ALL':3650};
/** @description Daily closes inside the selected period, newest session last.
 * @param {object} answer Bars response. @param {string} symbol Requested symbol. @param {number} days Period length.
 * @returns {Array<{date:string,close:number}>} Measured closes only. */
function detailsCloses(answer,symbol,days){
 if(!Array.isArray(answer?.bars))throw Error(symbol+' prices are unavailable from Schwab.');
 const rows=answer.bars.filter(b=>Number.isFinite(b.t)&&Number.isFinite(b.c)&&b.c>0).map(b=>({date:new Date(b.t*1000).toISOString().slice(0,10),close:b.c}));
 const end=rows.length?Date.parse(rows.at(-1).date):0;
 return rows.filter(r=>Date.parse(r.date)>=end-days*86400000);
}
/** @description Chart one holding's price change against the comparison symbol on matching trading days.
 * @param {HTMLElement} host Page. @param {object} model Account. @param {string} stock Holding. @param {string} compare Comparison.
 * @param {string} period Window key. @param {Function} current Whether this request is still current. @returns {Promise<void>} */
async function loadNativeStockComparison(host,model,stock,compare,period,current){
 const target=host.querySelector('[data-details-stock]');if(!target||!stock)return;
 target.innerHTML='<h3>'+esc(stock)+' vs. '+esc(compare)+'</h3><div class="details-empty"><strong>Reading daily prices…</strong></div>';
 try{
  const read=s=>api('/bars?'+new URLSearchParams({symbol:s,timeframe:'1Day',connection:model.connectionKey}));
  const [mine,other]=await Promise.all([read(stock),stock===compare?null:read(compare)]);
  if(!current()||host.dataset.stock!==stock)return;
  const days=DETAIL_DAYS[period]||31,a=detailsCloses(mine,stock,days),b=other?detailsCloses(other,compare,days):a;
  const theirs=new Map(b.map(r=>[r.date,r.close])),rows=a.filter(r=>theirs.has(r.date));
  if(rows.length<2)throw Error('Not enough matching trading days for '+stock+' and '+compare+' in this period.');
  const first=rows[0],pct=(v,base)=>(v/base-1)*100;
  const series=rows.map(r=>({date:r.date,a:pct(r.close,first.close),b:pct(theirs.get(r.date),theirs.get(first.date))}));
  target.innerHTML='<h3>'+esc(stock)+' vs. '+esc(compare)+'</h3><p class="sub">Daily closes from Schwab, '+esc(first.date+' – '+rows.at(-1).date)+'. Price change only; dividends excluded.</p>'+detailsCompareChart(series,stock,compare);
 }catch(e){if(current()&&host.dataset.stock===stock)target.innerHTML='<h3>'+esc(stock)+' vs. '+esc(compare)+'</h3><div class="details-empty"><strong>Price comparison unavailable</strong><p>'+esc(e.message)+'</p></div>';}
}
function detailsCompareChart(series,a,b){
 const all=series.flatMap(p=>[p.a,p.b]),low=Math.min(0,...all),high=Math.max(0,...all),pad=(high-low||1)*.1,min=low-pad,max=high+pad,last=series.at(-1);
 const x=i=>64+i/(series.length-1)*546,y=v=>195-(v-min)/(max-min)*175,line=k=>series.map((p,i)=>x(i).toFixed(1)+','+y(p[k]).toFixed(1)).join(' ');
 return '<svg class="details-chart" viewBox="0 0 640 240" role="img" aria-label="'+esc(a+' '+detailsPercent(last.a)+' versus '+b+' '+detailsPercent(last.b))+'"><title>'+esc(a+' versus '+b)+'</title>'+
  [high,0,low].filter((v,i,l)=>l.indexOf(v)===i).map(v=>'<line x1="64" x2="610" y1="'+y(v)+'" y2="'+y(v)+'" class="details-gridline"/><text x="56" y="'+(y(v)+4)+'" text-anchor="end">'+esc(detailsPercent(v))+'</text>').join('')+
  '<polyline points="'+line('b')+'" fill="none" class="details-compare-line"/><polyline points="'+line('a')+'" fill="none" class="details-value-line"/><text x="64" y="228">'+esc(series[0].date)+'</text><text x="610" y="228" text-anchor="end">'+esc(last.date)+'</text></svg>'+
  '<p class="details-legend"><span class="details-key details-key-a"></span>'+esc(a)+' <strong>'+esc(detailsPercent(last.a))+'</strong><span class="details-key details-key-b"></span>'+esc(b)+' <strong>'+esc(detailsPercent(last.b))+'</strong></p>';
}
/** @description Horizontal gain/loss bars since purchase, largest gain first.
 * @param {Array<object>} positions Current holdings. @returns {string} SVG or an empty state. */
function detailsHoldingBars(positions){
 const rows=positions.map(p=>({symbol:p.symbol,pl:Number(p.unrealizedPl),pct:Number(p.unrealizedPl)/(Number(p.avgEntryPrice)*Number(p.qty))*100})).filter(r=>Number.isFinite(r.pct)).sort((a,b)=>b.pct-a.pct).slice(0,15);
 if(!rows.length)return '<div class="details-empty"><strong>No open positions</strong><p>This account holds cash. Each holding\u2019s gain or loss appears here after it buys.</p></div>';
 const extent=Math.max(...rows.map(r=>Math.abs(r.pct)),1),mid=330,h=30,w=v=>Math.max(Math.abs(v)/extent*190,2);
 return '<svg class="details-chart" viewBox="0 0 640 '+(rows.length*h+16)+'" role="img" aria-label="Gain or loss since purchase by holding"><title>Gain or loss since purchase</title><line x1="'+mid+'" x2="'+mid+'" y1="0" y2="'+(rows.length*h+16)+'" class="details-gridline"/>'+
  rows.map((r,i)=>{const y=8+i*h,len=w(r.pct),gain=r.pct>=0;return '<text x="8" y="'+(y+18)+'" class="details-bar-symbol">'+esc(r.symbol)+'</text><rect class="'+(gain?'details-gain-bar':'details-loss-bar')+'" x="'+(gain?mid:mid-len)+'" y="'+(y+4)+'" width="'+len+'" height="20" rx="3"><title>'+esc(r.symbol+' '+detailsPercent(r.pct)+' · '+detailsMoney(r.pl))+'</title></rect><text x="'+(gain?mid+len+6:mid-len-6)+'" y="'+(y+18)+'" text-anchor="'+(gain?'start':'end')+'">'+esc(detailsPercent(r.pct))+'</text>';}).join('')+'</svg>';
}
function detailsHoldingsTable(positions,equity){
 if(!positions.length)return '<div class="details-empty"><strong>This account currently holds cash.</strong><p>No open positions were reported by Schwab. Use Manage strategy to inspect execution status.</p></div>';
 return '<table><thead><tr><th>Stock / ETF</th><th>Shares</th><th>Price</th><th>Market value</th><th>Average cost</th><th>Unrealized gain / loss</th><th>Account weight</th></tr></thead><tbody>'+positions.slice().sort((a,b)=>(b.marketValue||0)-(a.marketValue||0)).map(p=>'<tr><td><button class="details-symbol" data-details-symbol="'+esc(p.symbol)+'">'+esc(p.symbol)+'</button></td><td>'+esc(new Intl.NumberFormat(undefined,{maximumFractionDigits:6}).format(p.qty))+'</td><td>'+detailsMoney(p.currentPrice)+'</td><td><strong>'+detailsMoney(p.marketValue)+'</strong></td><td>'+detailsMoney(p.avgEntryPrice)+'</td><td class="'+(p.unrealizedPl>0?'ok':p.unrealizedPl<0?'err':'')+'">'+detailsMoney(p.unrealizedPl)+'</td><td>'+(equity>0&&p.marketValue!=null?(p.marketValue/equity*100).toFixed(2)+'%':'—')+'</td></tr>').join('')+'</tbody></table>';
}
function detailsLineChart(points,label){
 if(points.length<2)return '<div class="details-empty"><strong>Account history is collecting</strong><p>Current value is available. A trend needs a second recorded day.</p></div>';
 const values=points.map(p=>p.value),low=Math.min(...values),high=Math.max(...values),spread=high-low||Math.max(Math.abs(low)*.01,1),min=low-spread*.15,max=high+spread*.15;
 const x=i=>70+i/(points.length-1)*530,y=v=>190-(v-min)/(max-min)*155;
 const line=points.map((p,i)=>x(i).toFixed(2)+','+y(p.value).toFixed(2)).join(' ');
 return '<svg class="details-chart" viewBox="0 0 640 235" role="img" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title>'+[0,.5,1].map(f=>{const v=min+(max-min)*f,py=y(v);return '<line x1="70" x2="610" y1="'+py+'" y2="'+py+'" class="details-gridline"/><text x="62" y="'+(py+4)+'" text-anchor="end">'+esc(new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(v))+'</text>';}).join('')+'<polyline points="'+line+'" fill="none" class="details-value-line"/>'+points.map((p,i)=>'<circle cx="'+x(i)+'" cy="'+y(p.value)+'" r="4" class="details-value-dot"><title>'+esc(p.date+' · '+detailsMoney(p.value))+'</title></circle>').join('')+'<text x="70" y="222">'+esc(points[0].date)+'</text><text x="610" y="222" text-anchor="end">'+esc(points.at(-1).date)+'</text></svg>';
}
function detailsBarChart(point,symbol){
 if(!point)return '<div class="details-empty"><strong>Comparison not available yet</strong><p>Choose a longer period if recorded history exists. No backfilled or simulated account returns are shown.</p></div>';
 const bars=[['Account value',point.accountPct,'details-account-bar'],[symbol,point.benchmarkPct,'details-benchmark-bar']],extent=Math.max(...bars.map(b=>Math.abs(b[1])),.1),y=v=>115-v/extent*75;
 return '<svg class="details-chart" viewBox="0 0 640 235" role="img" aria-label="Account value change '+esc(detailsPercent(point.accountPct))+' versus '+esc(symbol)+' '+esc(detailsPercent(point.benchmarkPct))+'"><title>Value change on matching dates, not cash-flow-adjusted return</title><line x1="55" x2="610" y1="115" y2="115" class="details-gridline"/><text x="45" y="119" text-anchor="end">0%</text>'+bars.map(([name,v,cls],i)=>{const x=155+i*240,py=y(v);return '<rect class="'+cls+'" x="'+x+'" y="'+Math.min(py,115)+'" width="95" height="'+Math.max(Math.abs(py-115),1)+'" rx="4"/><text x="'+(x+47.5)+'" y="'+(v>=0?py-12:py+20)+'" text-anchor="middle">'+esc(detailsPercent(v))+'</text><text x="'+(x+47.5)+'" y="222" text-anchor="middle">'+esc(name)+'</text>';}).join('')+'</svg>';
}
/** @description Show verified current authority and shared schedule on every native dashboard tile.
 * @param {number} token Render generation. @returns {Promise<void>} Read-only refresh. */
async function loadNativeDashboardState(token){
 const results=await Promise.allSettled([api('/portfolio'),api('/portfolio/management'),api('/portfolio/backstops'),paperScheduleRow({app:'intelligent-trades',name:'portfolio-watcher'})]);
 if(stale(token)||!$('tiles'))return;
 const [p,m,b,s]=results.map(r=>r.status==='fulfilled'?r.value:null);
 ACCT_TILES.filter(a=>a.nativeReadOnly).forEach(a=>{
  const current=p?.accounts?.find(row=>sameNativeAccount(row,a)),watch=m?.watches?.find(row=>sameNativeAccount(row,a)),policy=b?.policies?.find(row=>sameNativeAccount(row,a));
  if(current){a.label=current.label;a.positions=current.holdings||[];a.equity=current.equity;a.cash=current.cash;}
  a.executionLabel=!m?'Trading status unavailable':!watch?.authority?.active?'Live trading: '+nativeAuthorityLabel(watch,current||a):s?.status==='active'?'Live trading: active':'Live trading paused · schedule '+(s?.status||'unavailable');
  a.protectionLabel='Watcher exits: '+(nativeProtectionLabel(policy,!!b)==='Active'&&s?.status!=='active'?'paused · schedule '+(s?.status||'unavailable'):nativeProtectionLabel(policy,!!b));
 });paintTiles(ACCT_TILES);
}
