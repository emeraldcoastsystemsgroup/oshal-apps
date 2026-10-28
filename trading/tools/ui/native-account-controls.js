/* CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Make shared schedule state and its next action visible above the account control cards.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Account-bound strategy selection, explicit current authority, shared schedule status and compact account roster. Selection never activates execution.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Make account strategy controls the Strategies landing page, with persistent section navigation and exact account switching.
 */
'use strict';
const nativeAccountsMatch=(a,b)=>a.accountId===b.accountId&&a.connectionKey===b.connectionKey;
let NATIVE_STRATEGY_ACCOUNTS=[];
function nativeAccountHref(a){return '/api/trading/?view=strategies&sub=accounts&account='+encodeURIComponent(a.accountId)+'&connection='+encodeURIComponent(a.connectionKey);}
function nativeStrategyNavigation(active='accounts'){
 return '<nav class="native-strategy-navigation" aria-label="Strategy sections">'+[['accounts','Account strategies'],['library','Strategy research'],['tuning','Futures research']].map(([key,label])=>'<button class="btn '+(key===active?'primary':'ghost')+'" data-native-strategy-section="'+key+'"'+(key===active?' aria-current="page"':'')+'>'+label+'</button>').join('')+'</nav>';
}
function wireNativeStrategyNavigation(){
 main.querySelectorAll('[data-native-strategy-section]').forEach(button=>button.onclick=()=>navigate('strategies',{sub:button.dataset.nativeStrategySection}));
}
async function renderNativeStrategyAccounts(token){
 main.innerHTML='<section class="panel"><h2>Strategies</h2><p class="sub">Choose an account below to manage its strategy, live trading and watcher exits.</p></section>'+nativeStrategyNavigation()+'<div id="nativeAccountOverview">'+spinner('Reading account strategies…')+'</div>';
 wireNativeStrategyNavigation();
 await loadNativeAccountOverview(token);
}
function nativeAuthorityLabel(w,a){return !w?'Inactive':w.authority?.active?(a&&w.strategyId!==a.strategyId?'Active · different strategy':'Active'):w.automatedTrading?'Needs review · '+(w.authority?.status||'unverified'):'Inactive';}
function nativeProtectionLabel(p,available=true){return !available?'Unavailable':p?.nativeStatus?.effectiveStatus==='active'&&(p.automatedWatcherExits||p.automatedBrokerProtection)?'Active':p?.automatedWatcherExits||p?.automatedBrokerProtection?'Needs review':'Inactive';}
function nativeAccountRoster(p,r,management,backstops){
 return '<section class="panel native-control-roster"><div class="native-section-head"><div><p class="native-eyebrow">Strategies by account</p><h2>Account strategies</h2></div><span class="sub">Strategy and watcher controls for each account</span></div><div class="native-roster-scroll"><table><thead><tr><th>Account</th><th>Value</th><th>Assigned strategy</th><th>Live trading</th><th>Watcher exits</th><th></th></tr></thead><tbody>'+p.accounts.filter(a=>a.kind==='live').map(a=>{
  const w=management?.watches?.find(w=>nativeAccountsMatch(w,a)),policy=backstops?.policies?.find(b=>nativeAccountsMatch(b,a)),s=r?.strategies?.find(s=>s.id===a.strategyId);
  return '<tr><td><a class="native-account-link" href="'+esc(nativeAccountHref(a))+'">'+esc(a.label)+'</a><span class="native-cell-note">'+esc(a.constraints?.group||a.accountType||'')+'</span></td><td class="native-value">'+accountValue(a.equity)+'</td><td class="native-roster-strategy">'+esc(s?.name||(r?'Choose a strategy':'Unavailable'))+'</td><td><span class="native-state '+(w?.authority?.active?'is-active':'')+'">'+esc(management?nativeAuthorityLabel(w,a):'Unavailable')+'</span></td><td><span class="native-state '+(nativeProtectionLabel(policy)==='Active'?'is-active':'')+'">'+esc(nativeProtectionLabel(policy,!!backstops))+'</span></td><td><a class="btn primary" href="'+esc(nativeAccountHref(a))+'">Manage strategy</a></td></tr>';
 }).join('')+'</tbody></table></div></section>';
}
async function loadNativeAccountOverview(token){
 const host=$('nativeAccountOverview');if(!host)return;
 const results=await Promise.allSettled(['/portfolio','/portfolio/research','/portfolio/management','/portfolio/backstops'].map(p=>api(p)));
 if(stale(token)||!host.isConnected)return;
 const [p,r,m,b]=results.map(r=>r.status==='fulfilled'?r.value:null);
 if(!Array.isArray(p?.accounts)){host.innerHTML='<section class="panel"><h2>Strategy controls unavailable</h2><p>Refresh to verify account strategies and watcher status. The Accounts dashboard remains available.</p></section>';return;}
 NATIVE_STRATEGY_ACCOUNTS=p.accounts.filter(a=>a.kind==='live').map(a=>({...a,nativeReadOnly:true,state:Number.isFinite(a.equity)?'ok':'unavailable',positions:a.holdings||[]}));
 if(showFocusedNativeAccount(NATIVE_STRATEGY_ACCOUNTS))return;
 if(!NATIVE_STRATEGY_ACCOUNTS.length){host.innerHTML='<section class="panel"><h2>No connected trading accounts</h2><p>Connect a brokerage account to manage its strategy. Paper accounts remain on the Accounts dashboard.</p></section>';return;}
 host.innerHTML=nativeAccountRoster(p,r,m,b);
 host.onclick=event=>{
  const link=event.target.closest('a[href]');
  if(!link||!host.contains(link)||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const account=p.accounts.find(a=>a.kind==='live'&&nativeAccountHref(a)===link.getAttribute('href'));
  const model=account&&NATIVE_STRATEGY_ACCOUNTS.find(m=>nativeAccountsMatch(m,account));
  if(model){event.preventDefault();nativeAccountView(model);}
 };
}
function nativeStrategyChoices(a,r,w,window){
 const strategies=r?.strategies||[],locked=!!w?.automatedTrading;
 const actual=locked?'<p class="native-attention">'+(w.authority?.active?'Authorized strategy: ':'Previous authorization: ')+esc(strategies.find(s=>s.id===w.strategyId)?.name||'Unavailable')+(w.strategyId!==a.strategyId?'. This differs from the assigned strategy below. Deactivate before reviewing the replacement.':'')+'</p>':'';
 return '<div class="native-strategy-picker">'+actual+'<div class="native-form-grid"><label>Strategy for '+esc(a.label)+'<select data-native-account-strategy disabled>'+(!a.strategyId?'<option value="">Choose a strategy</option>':'')+strategies.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===a.strategyId?' selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label><div class="native-picker-action"><button class="btn" data-native-management="account-change"'+(!r?' disabled':'')+'>Change strategy</button></div></div>'+
 '<div data-native-account-edit hidden><p class="sub">Changes apply only to <strong>'+esc(a.label)+'</strong>. Saving a selection leaves live trading inactive.</p>'+(locked?'<p class="native-attention">Deactivate this account’s live strategy before saving a replacement.</p>':'')+'<div class="native-form-actions"><button class="btn primary" data-native-management="account-save"'+(locked?' disabled':'')+'>Save strategy</button><button class="btn ghost" data-native-management="account-cancel">Cancel change</button></div><details class="native-evidence"><summary>Backtest selected strategy for this account</summary><p class="sub">A completed study for this exact account is required. This creates research only.</p><div class="native-form-grid"><label>Start date<input type="date" data-native-account-start value="'+esc(window?.suggestedStart||'')+'"></label><label>End date<input type="date" data-native-account-end value="'+esc(window?.latestCompletedSession||'')+'" max="'+esc(window?.latestCompletedSession||'')+'"></label></div><button class="btn" data-native-management="account-study">Run account backtest</button></details></div><p data-native-account-notice role="status" aria-live="polite"></p></div>';
}
function nativeScheduleControls(schedule){
 const active=schedule?.status==='active';
 return '<div class="native-schedule-bar '+(active?'is-active':'is-paused')+'"><div><strong>Watcher schedule '+(active?'is active':schedule?'is '+esc(schedule.status):'status unavailable')+'</strong><span class="native-cell-note">'+(schedule?.nextRunAt?'Next check '+esc(new Date(schedule.nextRunAt).toLocaleString()):'Checks all enabled account policies once a minute.')+'</span><span class="native-cell-note">Only activated strategies and exit policies may submit orders.</span></div><button class="btn '+(active?'ghost':'primary')+'" data-native-management="schedule-activate"'+(active||!schedule?' disabled':'')+'>'+(active?'Watcher schedule is active':'Activate watcher schedule')+'</button>'+(active?'<button class="btn ghost" data-native-management="schedule-deactivate">Deactivate shared schedule</button>':'')+'<p data-native-schedule-notice role="status" aria-live="polite"></p></div>';
}
/** Account identity comes from the loaded roster, never the global paper book or another form. */
async function nativeAccountControlAction(action,host,context){
 const {account,watch,model,token,research}=context,select=host.querySelector('[data-native-account-strategy]'),notice=host.querySelector(action.startsWith('schedule-')?'[data-native-schedule-notice]':'[data-native-account-notice]');
 const current=()=>!stale(token)&&host.isConnected;
 if(action==='account-change'){
  select.disabled=false;host.querySelector('[data-native-account-edit]').hidden=false;
  host.querySelectorAll('[data-native-management="strategy-activate"],[data-native-management="strategy-review"]').forEach(b=>{b.dataset.beforeChangeDisabled=String(b.disabled);b.disabled=true;});
  notice.textContent='Currently assigned: '+(research?.strategies?.find(s=>s.id===account.strategyId)?.name||'None')+'. Save or cancel this change before reviewing activation.';select.focus();return;
 }
 if(action==='account-cancel'){
  select.value=account.strategyId||'';select.disabled=true;host.querySelector('[data-native-account-edit]').hidden=true;
  host.querySelectorAll('[data-before-change-disabled]').forEach(b=>{b.disabled=b.dataset.beforeChangeDisabled==='true';delete b.dataset.beforeChangeDisabled;});
  notice.textContent='Selection unchanged.';return;
 }
 try{
  if(action.startsWith('schedule-')){
   const row=await paperScheduleRow({app:'intelligent-trades',name:'portfolio-watcher'});if(!current())return;
   if(!row)throw Error('Watcher schedule is unavailable.');
   if(action==='schedule-deactivate'){
    if(!confirm('Deactivate the shared watcher schedule for ALL accounts? Automatic strategy checks and watcher exits will stop. Existing broker orders remain.'))return;
    await paperKernel('/api/v1/agent/schedules/'+encodeURIComponent(row.id)+'/deactivate',{method:'POST',body:'{}'});
   }else if(row.status!=='active')await paperKernel('/api/v1/agent/schedules/'+encodeURIComponent(row.id)+'/activate',{method:'POST',body:JSON.stringify({class:'person',configuration:{runBudgetMicros:1000000,dailyBudgetMicros:10000000,timeoutMs:120000}})});
   if(current())await loadNativeAccountManagement(model,token);return;
  }
  const strategyId=select.value;if(!research?.strategies?.some(s=>s.id===strategyId))throw Error('Choose a saved strategy.');
  const binding={accountId:account.accountId,connectionKey:account.connectionKey};
  if(action==='account-study'){
   notice.textContent='Backtesting the selected strategy for '+account.label+'…';
   const result=await api('/portfolio/backtest',jbody('POST',{...binding,strategyId,startDate:host.querySelector('[data-native-account-start]').value,endDate:host.querySelector('[data-native-account-end]').value}));
   if(!current())return;
   if(result.run?.status!=='completed')throw Error(result.run?.error?.message||'The backtest could not complete.');
   research.runs.unshift(result.run);notice.textContent='Backtest complete. Return '+accountPercent(result.run.metrics?.totalReturnPct??result.run.result?.metrics?.totalReturnPct)+'. You can save this selection; live trading stays inactive.';return;
  }
  if(action==='account-save'){
   const fresh=await api('/portfolio/management');if(!current())return;
   const live=fresh.watches?.find(w=>nativeAccountsMatch(w,account));
   if(live?.automatedTrading||live?.authority?.active)throw Error('Deactivate '+account.label+' before changing its strategy.');
   const runs=await api('/portfolio/research');if(!current())return;
   const run=runs.runs.filter(r=>nativeAccountsMatch(r,account)&&r.strategyId===strategyId&&r.status==='completed').sort((a,b)=>(b.window?.sessions||0)-(a.window?.sessions||0))[0];
   if(!run)throw Error('Run a completed backtest for this strategy and this account before saving.');
   const strategy=runs.strategies.find(s=>s.id===strategyId),c=strategy?.config;
   if(c?.modelVersion!==2||!['monthly-trend','quarterly-rotation'].includes(c.kind)||c.fractionalShares||c.grossExposurePct!==100)throw Error('Live accounts currently support cash-funded, whole-share monthly trend or monthly rotation strategies.');
   await api('/portfolio/profiles',jbody('POST',{...binding,label:account.label,registration:account.constraints.registration,strategyId}));
   if(!current())return;
   await api('/portfolio/watch',jbody('POST',{runId:run.id,confirm:true}));
   if(current())await loadNativeAccountManagement(model,token);
  }
 }catch(e){if(current())notice.textContent=e.message;}
}
