/* CHANGE LOG
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Put account totals and schedule above two clear control cards and keep activation summaries compact without changing reviewed terms.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Keep exact account controls in the Strategies section, including old account bookmarks.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Restore exact saved reviews and caps across reloads, surface both authorities above research, and use shared theme-aware dashboard controls.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Choose and retain an explicit historical study end; distinguish it from the latest completed session without changing live signals.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Show retained combined allocation/backstop studies with continuous later evaluation and separate research-only controls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Display fresh native effective strategy authority instead of the saved automation switch.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prepare and review whole-account allocation on the exact account page, with separate personal activation.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Dedicated original-owner account strategy, study, watcher, position backstop and pending-funding panels. Tracking and broker protection stay distinct.
 */
'use strict';
const accountValue=v=>v==null?'Unknown':money(v);
const accountPercent=v=>v==null?'Unknown':Number(v).toFixed(2)+'%';
const sameNativeAccount=(a,b)=>a.accountId===b.accountId&&a.connectionKey===b.connectionKey;
const nativeAccountStrategyReviews=new WeakMap();
/** Keep a bookmarkable account binding; the loaded owner roster must resolve both identifiers. */
function setNativeAccountAddress(model){
 if(typeof location==='undefined'||!model.accountId||!model.connectionKey)return;
 if(typeof VIEW!=='undefined'){VIEW='strategies';SUB='accounts';if(typeof renderNav==='function')renderNav();}
 const p=new URLSearchParams(location.search);p.set('view','strategies');p.set('sub','accounts');p.delete('tab');p.set('account',model.accountId);p.set('connection',model.connectionKey);
 history.replaceState(null,'',location.pathname+'?'+p.toString());
}
function clearNativeAccountAddress(){
 const p=new URLSearchParams(location.search);p.delete('account');p.delete('connection');history.replaceState(null,'',location.pathname+'?'+p.toString());
}
function showFocusedNativeAccount(models){
 const p=new URLSearchParams(location.search),accountId=p.get('account'),connectionKey=p.get('connection');if(!accountId&&!connectionKey)return false;
 const model=models.find(m=>m.nativeReadOnly&&m.accountId===accountId&&m.connectionKey===connectionKey);
 if(model){NATIVE_STRATEGY_ACCOUNTS=models.filter(m=>m.nativeReadOnly);nativeAccountView(model);}
 else{main.innerHTML='<section class="panel"><h2>Account page unavailable</h2><p>This account and connection could not be resolved in your current roster.</p><button class="btn" id="nativeFocusBack">All account strategies</button></section>';$('nativeFocusBack').onclick=()=>navigate('strategies',{sub:'accounts'});}
 return true;
}
/** Load independent evidence without replacing an unavailable section with invented empty data. */
async function loadNativeAccountManagement(model,token){
 const host=$('nativeAccountManagement');if(!host)return;
 const expanded=new Set([...host.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent));
 const paths=['/portfolio','/portfolio/research','/portfolio/management','/portfolio/backstops','/portfolio/expected-funding','/portfolio/backstops/combined','/portfolio/live/reviews?'+new URLSearchParams({accountId:model.accountId,connectionKey:model.connectionKey})];
 const results=await Promise.allSettled([...paths.map(path=>api(path)),typeof paperScheduleRow==='function'?paperScheduleRow({app:'intelligent-trades',name:'portfolio-watcher'}):Promise.reject(Error('Schedule reader unavailable'))]);
 if(stale(token)||!host.isConnected)return;
 const values=results.map(r=>r.status==='fulfilled'?r.value:null),[portfolio,research,management,backstops,funding,combined,saved,schedule]=values;
 const account=portfolio?.accounts?.find(a=>sameNativeAccount(a,model));
 if(!account){host.innerHTML='<p class="err">Account strategy evidence is unavailable for this exact connection. Refresh before reviewing actions.</p>';return;}
 const strategy=research?.strategies?.find(s=>s.id===account.strategyId),watch=management?.watches?.find(w=>sameNativeAccount(w,account));
 const studies=(research?.runs||[]).filter(r=>sameNativeAccount(r,account)&&r.strategyId===account.strategyId&&r.status==='completed');
 const study=studies.find(r=>r.id===watch?.runId)||studies.sort((a,b)=>(b.window?.sessions||0)-(a.window?.sessions||0))[0];
 const state=backstops?.accounts?.find(a=>sameNativeAccount(a,account)),policy=backstops?.policies?.find(a=>sameNativeAccount(a,account));
 const summaryTerms=watch?.authority?.active?watch?.mandate?.terms:saved?.strategy?.mandate?.terms||watch?.mandate?.terms;
 host.innerHTML='<section class="panel native-account-summary" aria-label="Account totals">'+nativeAccountMetric('Account value',accountValue(account.equity))+nativeAccountMetric('Cash',accountValue(account.cash))+nativeAccountMetric(watch?.authority?.active?'Active capital cap':'Reviewed capital cap',accountValue(summaryTerms?.capitalCents!=null?summaryTerms.capitalCents/100:null))+nativeAccountMetric('Account type',account.constraints?.group||'Unclassified')+'</section>'+nativeScheduleControls(schedule)+nativeStrategyPanel(account,strategy,study,watch,research,management,schedule,saved?.strategy,!!saved,portfolio?.researchWindow)+(typeof nativeBrokerProtectionPanel==='function'?nativeBrokerProtectionPanel(account,policy,backstops):'')+'<details class="panel native-secondary"><summary>Strategy research &amp; backtests</summary>'+nativeCombinedPanel(account,combined)+'</details><details class="panel native-secondary"><summary>Position floors &amp; stop research</summary>'+nativeBackstopPanel(account,state,policy,backstops)+'</details><details class="panel native-secondary"><summary>Expected incoming funds</summary>'+nativeExpectedFundingPanel(funding)+'</details>';
 if(!saved&&host.querySelector('[data-native-protection-review]'))host.querySelector('[data-native-protection-review]').innerHTML='<p class="err">Saved protection reviews could not be read. Refresh this account to recover them.</p>';
 if(saved?.strategy)nativeAccountStrategyReviews.set(host,saved.strategy);
 if(saved?.protection&&!(policy?.automatedWatcherExits||policy?.automatedBrokerProtection)&&typeof nativeProtectionReviews!=='undefined'){nativeProtectionReviews.set(host,saved.protection);host.querySelector('[data-native-protection-review]').innerHTML=nativeProtectionReviewHtml(saved.protection,account);}
 host.querySelectorAll('details').forEach(d=>{if(expanded.has(d.querySelector('summary')?.textContent))d.open=true;});
 host.onclick=event=>{const button=event.target.closest('[data-native-management]');if(button&&host.contains(button))nativeAccountManagementAction(button,host,{account,model,token,policy,backstops,watch,management,research});};
}
function nativeAccountMetric(label,value){return'<div class="kpi"><div class="l">'+esc(label)+'</div><div class="n">'+esc(value)+'</div></div>';}
function nativeStrategyPanel(a,strategy,study,watch,research,management,schedule,saved,reviewReadAvailable=true,researchWindow){
 const status=!management?'Unavailable':watch?.lastError?'Check failed':watch?.enabled?'Monitor enabled':'Monitor off';
 return'<section class="panel native-management-panel"><div class="native-section-head"><div><p class="native-eyebrow">'+esc(a.label)+'</p><h2>Trading strategy</h2></div><span class="native-state '+(watch?.authority?.active?'is-active':'')+'">Live trading: '+esc(management?nativeAuthorityLabel(watch,a):'Unavailable')+'</span></div>'+
 nativeStrategyChoices(a,research,watch,researchWindow)+
 '<p class="sub">'+(strategy?.config?.modelVersion===2?'Monthly allocation · ':'')+'Cash-funded whole shares. No new borrowing.</p>'+
 nativeAccountAllocationControls(a,watch,management,saved,reviewReadAvailable)+
 '<p class="native-last-check">'+esc(status)+' · Last check '+esc(watch?.lastRunAt?new Date(watch.lastRunAt).toLocaleString():'Never')+'</p>'+(watch?.lastError?'<p class="err">'+esc(watch.lastError)+'</p>':'')+
 (study?'<details class="native-evidence"><summary>Assigned completed backtest</summary><p>'+esc(study.window?.firstSession||study.startDate)+' to '+esc(study.window?.lastSession||study.endDate)+' · '+esc(study.window?.sessions||'Unknown')+' sessions</p><div class="kpis">'+nativeAccountMetric('Price return',accountPercent(study.metrics?.totalReturnPct))+nativeAccountMetric('SPY',accountPercent(study.metrics?.benchmarkReturnPct))+nativeAccountMetric('Maximum drawdown',accountPercent(study.metrics?.maxDrawdownPct))+nativeAccountMetric('Modeled costs',accountValue(study.costs?.tradingUsd))+'</div><p class="sub">Price-only history excludes distributions and taxes. '+(strategy?.universeEvidence?'This current Congress basket is not a historical filing-following backtest. ':'')+'Later results and real fills can differ.</p></details>':'<p class="err">No completed account study is available.</p>')+
 '<div class="native-form-actions"><button class="btn ghost" data-native-management="strategies">Open strategy research</button><button class="btn ghost" data-native-management="refresh">Refresh this account</button></div></section>';
}
/** Combined research remains separate from personal execution/protection activation. */
function nativeCombinedPanel(account,data){
 const run=data?.runs?.find(r=>sameNativeAccount(r,account)&&r.strategyId===account.strategyId);
 return'<section class="panel" data-native-combined-panel><h2>Strategy + moving backstops</h2><p>Test the assigned strategy and trailing exits together. Earlier sessions select among six trails; later sessions carry forward the existing cash, positions and stop ratchets.</p><p>Fresh-cash study scaled to current equity, with allocation tickets capped at $50,000 and daily turnover capped at twice equity (up to $2 million). This does not reconstruct the current legacy holdings or margin loan. Expected incoming funds are excluded.</p><label>Study end date <input type="date" data-native-combined-end value="'+esc(run?.requestedEndDate||run?.laterWindow?.endDate||data?.latestCompletedSession||'')+'" max="'+esc(data?.latestCompletedSession||'')+'"></label><p>Conflicting candles inside the requested history are refused. Selecting an earlier end changes the research window; it does not repair or replace current market data.</p><button class="btn ghost" data-native-management="combined"'+(!account.strategyId?' disabled':'')+'>Compare strategy with moving stops</button><p data-native-combined-status role="status" aria-live="polite">'+(!data?'Combined-study read unavailable.':'')+'</p><div data-native-combined-study>'+(run?nativeCombinedStudy(run):'<p>No combined study is retained for this assigned strategy.</p>')+'</div></section>';
}
function nativeCombinedStudy(run){
 const cells=period=>'<td>'+accountPercent(period?.metrics?.totalReturnPct)+'</td><td>'+accountPercent(period?.metrics?.maxDrawdownPct)+'</td>';
 const table='<div style="overflow:auto"><table><thead><tr><th>Model</th><th>Training return</th><th>Training drawdown</th><th>Later return</th><th>Later drawdown</th></tr></thead><tbody>'+(run.candidates||[]).map(c=>'<tr><td>'+esc(c.trailPct)+'% trail'+(c.trailPct===run.selectedTrailPct?' · training selected':'')+'</td>'+cells(c.training)+cells(c.later)+'</tr>').join('')+'<tr><td>Allocation only</td>'+cells(run.comparators?.allocationOnly?.training)+cells(run.comparators?.allocationOnly?.later)+'</tr>'+['SPY','DIA'].map(symbol=>'<tr><td>'+symbol+' buy &amp; hold</td>'+['training','later'].map(period=>cells({metrics:run.comparators?.allocationOnly?.[period]?.benchmarks?.[symbol]})).join('')+'</tr>').join('')+'<tr><td>Cash · no interest</td><td>0.00%</td><td>0.00%</td><td>0.00%</td><td>0.00%</td></tr></tbody></table></div>';
 return'<h3>Retained combined study · '+esc(run.strategyName)+'</h3><p>Training '+esc(run.trainingWindow?.startDate)+' to '+esc(run.trainingWindow?.endDate)+' · later '+esc(run.laterWindow?.startDate)+' to '+esc(run.laterWindow?.endDate)+'. '+(run.selectedTrailPct==null?'No positive-training trail qualified.':'Training selected '+esc(run.selectedTrailPct)+'% trail.')+'</p>'+(run.sessionsAfterStudyEnd?'<p>Requested study end '+esc(run.requestedEndDate)+' · latest completed session at read '+esc(run.latestCompletedSession)+' · '+esc(run.sessionsAfterStudyEnd)+' completed session(s) after this research window.</p>':'')+table+'<p>Modeled one-way costs '+esc(run.config?.transactionCostBps)+'bps. Prior stop only; gap-through exits can fill below the stop. A stop aborts the pending allocation cycle; reentry waits for a later scheduled rebalance.</p><p>Price-only research excludes distributions and taxes; no untouched holdout. '+(run.currentCongressBasket?'The current Congress basket does not establish historical filing-following performance. ':'')+'Daily OHLC cannot reproduce continuous broker ratchets or prove safe order replacement. This study enables no real orders. Study '+esc(run.id)+'.</p>';
}
function nativeDraftReviewHtml(answer,account){
 const m=answer.mandate,ready=answer.review?.activationReady===true,availability=answer.availability||'ready';
 const preview=answer.review?.proposal?.actions||[];
 return'<div class="native-review-card"><div class="native-section-head"><h3>REAL MONEY strategy mandate</h3><span class="native-state">'+esc(ready?'Ready for your activation':availability==='ready'?'Transition needs review':availability==='expired'?'Review expired':'Refresh review: '+availability)+'</span></div><p class="native-confirm-identity"><strong>'+esc(account?.label||m.accountMasked||'This account')+'</strong><span>'+esc(answer.review?.research?.strategyName||answer.review?.strategy?.name||'Assigned account strategy')+'</span></p><div class="native-approval-terms"><div><span>Capital cap</span><strong>'+accountValue(m.terms.capitalCents/100)+'</strong></div><div><span>Daily turnover limit</span><strong>'+accountValue(m.terms.maxDailyTurnoverCents/100)+'</strong></div><div><span>Authority</span><strong>30 days</strong></div></div><p class="sub">'+(m.terms.scope==='whole-account'?'May sell existing holdings across this account. ':'')+'Buys require verified cash. Live prices, positions and funding are checked again before orders.</p><button class="btn primary native-activate" data-native-management="strategy-activate"'+(!ready?' disabled':'')+'>Activate live trading</button><p class="native-review-expiry">'+(m.reviewExpiresAtMs?'Review valid until '+esc(new Date(m.reviewExpiresAtMs).toLocaleString())+'.':'')+'</p>'+
 '<div class="native-order-preview">'+preview.slice(0,4).map(a=>'<div><strong>'+esc(a.symbol)+'</strong><span>'+esc(a.action)+' '+esc(Math.abs(a.changeQty))+' shares</span></div>').join('')+'</div>'+(preview.length>4?'<p class="sub">'+esc(preview.length)+' total proposed actions. Review every holding and exception below.</p>':'')+
 '<details class="native-evidence" data-native-exact-review><summary>Exact saved review, holdings and research</summary>'+nativeStrategyReviewBody(m,answer.review).replace('<h4>REAL MONEY strategy mandate</h4>','')+'</details></div>';
}
function nativeAccountAllocationControls(account,watch,management,saved,reviewReadAvailable=true){
 if(!watch?.enabled)return'<p class="native-attention">Choose Change strategy above, then save a strategy with a completed backtest for this account.</p>';
 if(watch.automatedTrading)return'<div class="native-control-actions"><button class="btn primary" disabled>'+esc(watch.authority?.active?'Live trading is active':'Live trading needs review')+'</button><button class="btn danger" data-native-management="strategy-stop">Deactivate strategy</button></div><p class="sub">'+(watch.authority?.active?'This account’s saved strategy is authorized.':'Execution is not verified active. Deactivate the old authorization, then review it again.')+' Deactivation stops future strategy orders; it does not cancel existing orders or disable watcher exits.</p><p data-native-allocation-status role="status" aria-live="polite"></p>';
 if(!reviewReadAvailable)return'<p class="err">Saved account reviews could not be read. Refresh this account before changing reviewed terms or preparing activation.</p>';
 const held=account.holdingsCount>0,available=management?.execution?.wholeAccountAvailable===true,terms=saved?.mandate?.terms;
 const whole=terms?terms.scope==='whole-account':held,cap=terms?.capitalCents!=null?terms.capitalCents/100:Number.isFinite(account.equity)?Math.min(held?1000000:50000,Math.floor(Math.max(0,account.equity)*.99)):'';
 return'<div class="native-execution-controls"><h3>Live trading limits</h3><p class="sub">Whole-account scope may sell existing holdings outside the buy universe. Buys require verified cash; expected funds are excluded.</p>'+
 (!available?'<p>Whole-account enrollment requires the verified native release.</p>':'')+
 '<div class="native-form-grid"><label>Management scope <select data-native-strategy-scope><option value="whole-account"'+(whole?' selected':'')+(!available?' disabled':'')+'>Whole account · existing and future long equities</option><option value="strategy-owned"'+(!whole?' selected':'')+(held?' disabled':'')+'>Strategy-owned · initial account must be flat</option></select></label><label>Capital cap $ <input type="number" min="100" max="1000000" step=".01" data-native-strategy-cap value="'+esc(cap)+'"></label></div>'+
 '<button class="btn primary native-review-action" data-native-management="strategy-review"'+(held&&!available?' disabled':'')+'>'+(saved?'Refresh activation review':'Review &amp; activate')+'</button><p data-native-allocation-status role="status" aria-live="polite">'+(saved?'Review the account and strategy below before activation.':'Review the exact account, strategy and orders before activating live trading.')+'</p><div data-native-allocation-review>'+(saved?nativeDraftReviewHtml(saved,account):'')+'</div></div>';
}
function nativeBackstopPanel(a,state,policy,data){
 const rows=(a.holdings||[]).map(h=>{const r=state?.rows?.find(x=>x.symbol===h.symbol);return'<tr><td>'+esc(h.symbol)+'</td><td>'+esc(h.qty??'Unknown')+'</td><td>'+accountValue(r?.state?.peak)+'</td><td>'+accountValue(r?.state?.stop)+'</td><td>'+esc(r?.status||(data?'Not enrolled':'Unavailable'))+(r?.message?'<br>'+esc(r.message):'')+'</td><td>'+esc(r?.broker?.status||'Not verified')+'</td></tr>';}).join('');
 return'<section class="panel"><h2>Moving backstops · every reported position</h2><p><strong>Model tracking does not place broker stops.</strong> A recorded stop can rise with observed prices and cannot fall. Only verified working broker orders count as broker protection.</p>'+
 '<p>Last position check '+esc(state?.observedAt||'Never')+' · '+esc(state?.summary?.positions??a.holdingsCount)+' reported holdings · '+esc(state?.summary?.workingBrokerStops??'Unknown')+' with verified working broker stops. Broker order read: '+esc(state?.brokerReadStatus||'Not verified')+'.</p>'+
 '<label>Trail percent <input type="number" min="0.5" max="50" step="0.5" data-native-trail value="'+esc(policy?.config?.trailPct??10)+'"'+(policy?' disabled':'')+'></label> '+(!policy?'<button class="btn" data-native-management="enroll">Enable backstop tracking</button> ':'')+'<button class="btn ghost" data-native-management="check">Check position backstops</button><p data-native-status role="status" aria-live="polite"></p>'+
 '<div style="overflow:auto"><table><thead><tr><th>Instrument</th><th>Quantity</th><th>Observed peak</th><th>Modeled stop</th><th>Tracking</th><th>Broker protection</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">No open positions are reported. Newly acquired holdings still require a verified protection check.</td></tr>')+'</tbody></table></div>'+
 '<h3>Backtest moving stops</h3><p>Compare six fixed trails that exit to cash without automatic reentry. Earlier observations choose the candidate; the later period is reported separately. Gap-through stops fill at the lower open in the model.</p><label>Backstop study end date <input type="date" data-native-study-end value="'+esc(data?.latestCompletedSession||'')+'" max="'+esc(data?.latestCompletedSession||'')+'"></label> <label>Instrument <input data-native-study-symbol maxlength="16" value="'+esc(a.holdings?.[0]?.symbol||'SPY')+'"></label> <button class="btn ghost" data-native-management="backtest">Run backstop comparison</button><div data-native-study></div>'+'</section>';
}
function nativeExpectedFundingPanel(data){
 const plan=data?.plans?.[0];
 return'<section class="panel"><h2>Expected incoming funds · portfolio</h2><p>'+(!data?'Funding-plan read unavailable.':plan?accountValue(plan.amountUsd)+' expected; destination account not assigned.':'No expected funding recorded.')+' These funds are excluded from current cash, buying power and order caps until the broker reports receipt.</p><label>Expected amount $ <input data-native-funding type="number" min="1" max="100000000" step="0.01" value="'+esc(plan?.amountUsd??'')+'"></label> <button class="btn ghost" data-native-management="funding">Save expected funding</button></section>';
}
async function nativeAccountManagementAction(button,host,context){
 const {account,model,token}=context;
 const action=button.dataset.nativeManagement,status=host.querySelector(action==='combined'?'[data-native-combined-status]':action.startsWith('strategy-')?'[data-native-allocation-status]':action.startsWith('broker-')?'[data-native-protection-notice]':'[data-native-status]'),binding={accountId:account.accountId,connectionKey:account.connectionKey};
 if(action.startsWith('account-')||action.startsWith('schedule-')){button.disabled=true;try{await nativeAccountControlAction(action,host,context);}finally{if(button.isConnected)button.disabled=false;}return;}
 if(action==='strategies'){navigate('strategies',{sub:'library'});return;}
 button.disabled=true;if(status)status.textContent='Reading and saving account evidence…';
 try{
  if(action==='combined'){
   const answer=await api('/portfolio/backstops/combined',jbody('POST',{...binding,strategyId:account.strategyId,endDate:host.querySelector('[data-native-combined-end]').value}));
   if(stale(token)||!host.isConnected)return;host.querySelector('[data-native-combined-study]').innerHTML=nativeCombinedStudy(answer.run);
   if(status)status.textContent='Combined study retained. No strategy or broker authority activated.';return;
  }
  if(action.startsWith('strategy-')){await nativeAccountStrategyAction(action,host,context);return;}
  if(action.startsWith('broker-')){await nativeBrokerProtectionAction(action,button,host,context);return;}
  if(action==='enroll'){const trailPct=Number(host.querySelector('[data-native-trail]').value);await api('/portfolio/backstops/configure',jbody('POST',{...binding,config:{modelVersion:2,trailPct,transactionCostBps:25,reentry:'none'},confirm:true}));}
  if(action==='check')await api('/portfolio/backstops/check',jbody('POST',binding));
  if(action==='funding')await api('/portfolio/expected-funding',jbody('POST',{amountUsd:Number(host.querySelector('[data-native-funding]').value)}));
  if(action==='backtest'){
   const symbol=host.querySelector('[data-native-study-symbol]').value.trim().toUpperCase(),answer=await api('/portfolio/backstops/backtest',jbody('POST',{...binding,symbol,modelVersion:2,endDate:host.querySelector('[data-native-study-end]').value}));
   if(stale(token)||!host.isConnected)return;const r=answer.run;
   host.querySelector('[data-native-study]').innerHTML='<h4>'+esc(r.symbol)+' · retained backstop study</h4><p>Training '+esc(r.trainingWindow.startDate)+' to '+esc(r.trainingWindow.endDate)+'; later '+esc(r.laterWindow.startDate)+' to '+esc(r.laterWindow.endDate)+'. '+(r.selectedConfig?'Training selection '+esc(r.selectedConfig.trailPct)+'%.':'No positive-training candidate qualified.')+'</p><div style="overflow:auto"><table><thead><tr><th>Trail</th><th>Training return</th><th>Later return</th><th>Later drawdown</th></tr></thead><tbody>'+r.candidates.map(c=>'<tr><td>'+esc(c.config.trailPct)+'%</td><td>'+accountPercent(c.training.metrics.returnPct)+'</td><td>'+accountPercent(c.later.metrics.returnPct)+'</td><td>'+accountPercent(c.later.metrics.maxDrawdownPct)+'</td></tr>').join('')+'</tbody></table></div><p>Retrospective price research; no untouched holdout or future profit claim.25bps costs; taxes/distributions excluded. Study '+esc(r.id)+'.</p>';
   if(r.sessionsAfterStudyEnd)host.querySelector('[data-native-study]').insertAdjacentHTML('beforeend','<p>Requested end '+esc(r.requestedEndDate)+'; latest completed session at read '+esc(r.latestCompletedSession)+'. Current quotes and execution checks use their own fresh evidence.</p>');
   if(r.dataQuality?.coalescedSnapshots)host.querySelector('[data-native-study]').insertAdjacentHTML('beforeend','<p>Combined '+esc(r.dataQuality.coalescedSnapshots)+' duplicate daily snapshot(s) with identical open, high, low and close prices. Conflicting prices are refused.</p>');
   if(typeof nativeBrokerProtectionPanel==='function'){
    const data=await api('/portfolio/backstops');if(stale(token)||!host.isConnected)return;
    const panel=host.querySelector('[data-native-protection-controls]');
    if(panel)panel.outerHTML=nativeBrokerProtectionPanel(account,data.policies?.find(p=>sameNativeAccount(p,account)),data);
   }
   if(status)status.textContent='Study saved. No broker orders placed.';return;
  }
  if(!stale(token))await loadNativeAccountManagement(model,token);
 }catch(e){if(!stale(token)&&status)status.textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}
}
async function nativeAccountStrategyAction(action,host,context){
 const {account,watch,model,token}=context;
 if(action!=='strategy-stop'&&host.querySelector('[data-native-account-edit]')?.hidden===false)throw Error('Save or cancel this strategy change before reviewing activation.');
 if(!watch?.enabled)throw Error('Start this account monitor before reviewing execution.');
 if(action==='strategy-review'){
  const scope=host.querySelector('[data-native-strategy-scope]').value,capitalCents=Math.round(Number(host.querySelector('[data-native-strategy-cap]').value)*100);
  if(!Number.isSafeInteger(capitalCents)||capitalCents<10000||capitalCents>(scope==='whole-account'?100000000:5000000))throw Error('Choose a capital cap within the selected management scope.');
  const result=await api('/portfolio/live/mandate',jbody('POST',{watchId:watch.id,scope,capitalCents}));
  if(stale(token)||!host.isConnected)return;
  nativeAccountStrategyReviews.set(host,result);
  host.querySelector('[data-native-allocation-review]').innerHTML=nativeDraftReviewHtml(result,account);
  host.querySelector('[data-native-allocation-status]').textContent='Review saved. No strategy authority activated and no broker orders placed.';return;
 }
 if(action==='strategy-activate'){
  const result=nativeAccountStrategyReviews.get(host);if(!result?.review?.activationReady)throw Error('Prepare a fresh, verified transition first.');
  const m=result.mandate;if(!confirm(nativeStrategyConfirmation(m,account.label)))return;
  await api('/portfolio/live/activate',jbody('POST',{watchId:watch.id,mandateId:m.mandateId,fingerprint:m.fingerprint,confirm:true,confirmAdoption:m.terms.scope==='whole-account'}));
 }
 if(action==='strategy-stop')await api('/portfolio/live/stop',jbody('POST',{watchId:watch.id}));
 if(!stale(token))await loadNativeAccountManagement(model,token);
}
