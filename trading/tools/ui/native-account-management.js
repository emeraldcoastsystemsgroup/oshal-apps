/* CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Display fresh native effective strategy authority instead of the saved automation switch.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Dedicated original-owner account strategy, study, watcher, position backstop and pending-funding panels. Tracking and broker protection stay distinct.
 */
'use strict';
const accountValue=v=>v==null?'Unknown':money(v);
const accountPercent=v=>v==null?'Unknown':Number(v).toFixed(2)+'%';
const sameNativeAccount=(a,b)=>a.accountId===b.accountId&&a.connectionKey===b.connectionKey;
/** Keep a bookmarkable account binding; the loaded owner roster must resolve both identifiers. */
function setNativeAccountAddress(model){
 if(typeof location==='undefined'||!model.accountId||!model.connectionKey)return;
 const p=new URLSearchParams(location.search);p.set('view','accounts');p.set('account',model.accountId);p.set('connection',model.connectionKey);
 history.replaceState(null,'',location.pathname+'?'+p.toString());
}
function clearNativeAccountAddress(){
 const p=new URLSearchParams(location.search);p.delete('account');p.delete('connection');history.replaceState(null,'',location.pathname+'?'+p.toString());
}
function showFocusedNativeAccount(models){
 const p=new URLSearchParams(location.search),accountId=p.get('account'),connectionKey=p.get('connection');if(!accountId&&!connectionKey)return false;
 const model=models.find(m=>m.nativeReadOnly&&m.accountId===accountId&&m.connectionKey===connectionKey);
 if(model)nativeAccountView(model);
 else{main.innerHTML='<section class="panel"><h2>Account page unavailable</h2><p>This account and connection could not be resolved in your current roster.</p><button class="btn" id="nativeFocusBack">All accounts</button></section>';$('nativeFocusBack').onclick=()=>navigate('accounts',{sub:null});}
 return true;
}
/** Load independent evidence without replacing an unavailable section with invented empty data. */
async function loadNativeAccountManagement(model,token){
 const host=$('nativeAccountManagement');if(!host)return;
 const paths=['/portfolio','/portfolio/research','/portfolio/management','/portfolio/backstops','/portfolio/expected-funding'];
 const results=await Promise.allSettled([...paths.map(path=>api(path)),typeof paperScheduleRow==='function'?paperScheduleRow({app:'intelligent-trades',name:'portfolio-watcher'}):Promise.reject(Error('Schedule reader unavailable'))]);
 if(stale(token)||!host.isConnected)return;
 const values=results.map(r=>r.status==='fulfilled'?r.value:null),[portfolio,research,management,backstops,funding,schedule]=values;
 const account=portfolio?.accounts?.find(a=>sameNativeAccount(a,model));
 if(!account){host.innerHTML='<p class="err">Account strategy evidence is unavailable for this exact connection. Refresh before reviewing actions.</p>';return;}
 const strategy=research?.strategies?.find(s=>s.id===account.strategyId),watch=management?.watches?.find(w=>sameNativeAccount(w,account));
 const studies=(research?.runs||[]).filter(r=>sameNativeAccount(r,account)&&r.strategyId===account.strategyId&&r.status==='completed');
 const study=studies.find(r=>r.id===watch?.runId)||studies.sort((a,b)=>(b.window?.sessions||0)-(a.window?.sessions||0))[0];
 const state=backstops?.accounts?.find(a=>sameNativeAccount(a,account)),policy=backstops?.policies?.find(a=>sameNativeAccount(a,account));
 host.innerHTML=nativeStrategyPanel(account,strategy,study,watch,research,management,schedule)+nativeBackstopPanel(account,state,policy,backstops)+nativeExpectedFundingPanel(funding);
 host.onclick=event=>{const button=event.target.closest('[data-native-management]');if(button&&host.contains(button))nativeAccountManagementAction(button,host,{account,model,token,policy,backstops});};
}
function nativeStrategyPanel(a,strategy,study,watch,research,management,schedule){
 const status=!management?'Unavailable':watch?.lastError?'CHECK FAILED':watch?.enabled?'Monitor enabled':'Monitor not enabled';
 const c=strategy?.config,sourceNote=strategy?.universeEvidence?'<p>Congress basket: selected disclosed stocks. Its price backtest does not establish historical filing-following returns.</p>':'';
 return'<section class="panel"><h2>Account strategy & management</h2><p><strong>'+esc(a.label)+'</strong> · '+esc(a.constraints?.group||'Unclassified')+'</p><p>Assigned strategy: '+esc(strategy?.name||(research?'None':'Unavailable'))+'</p>'+
 (c?'<p>'+esc(c.kind)+' · '+esc(c.grossExposurePct)+'% modeled exposure · '+esc(c.lookbackSessions)+'-session lookback · '+(c.modelVersion===2?'calendar-monthly trading':'every '+esc(c.rebalanceSessions)+' modeled sessions')+'</p>':'')+sourceNote+
 '<p>Equity '+accountValue(a.equity)+' · Cash '+accountValue(a.cash)+' · Signed margin balance '+accountValue(a.balanceFacts?.marginBalance)+' · Maintenance '+accountValue(a.balanceFacts?.maintenanceRequirement)+'</p>'+
 '<p><strong>'+esc(status)+'</strong> · last check '+esc(watch?.lastRunAt||'Never')+'</p>'+(watch?.lastError?'<p class="err">'+esc(watch.lastError)+'</p>':'')+
 '<p>Watcher schedule: '+esc(schedule?.status||'Unavailable')+(schedule?.reason?' · '+esc(schedule.reason):'')+' · next '+esc(schedule?.nextRunAt||'Unknown')+'</p>'+
 '<p><strong>Real-order authority: '+(!management?'unknown':watch?.authority?.active?'ENABLED':watch?.automatedTrading?'NOT ACTIVE ('+(watch.authority?.status||'unavailable')+')':'NOT ENABLED')+'</strong>. '+(watch?.automatedTrading?'Check its exact mandate, expiry, current orders and fills.':'Monitoring and saved research do not authorize broker orders.')+'</p>'+
 (study?'<h3>Assigned completed backtest</h3><p>'+esc(study.window?.firstSession||study.startDate)+' to '+esc(study.window?.lastSession||study.endDate)+' · '+esc(study.window?.sessions||'Unknown')+' sessions</p><p>Price return '+accountPercent(study.metrics?.totalReturnPct)+' · SPY '+accountPercent(study.metrics?.benchmarkReturnPct)+' · Maximum drawdown '+accountPercent(study.metrics?.maxDrawdownPct)+' · Modeled costs '+accountValue(study.costs?.tradingUsd)+'</p><p>Historical price-only results exclude distributions and taxes. Later-period validation and real fills can differ.</p>':'<p class="err">No completed study for the assigned account strategy is available.</p>')+
 '<button class="btn" data-native-management="strategies">Open strategy and real-order controls</button> <button class="btn ghost" data-native-management="refresh">Refresh this account</button></section>';
}
function nativeBackstopPanel(a,state,policy,data){
 const rows=(a.holdings||[]).map(h=>{const r=state?.rows?.find(x=>x.symbol===h.symbol);return'<tr><td>'+esc(h.symbol)+'</td><td>'+esc(h.qty??'Unknown')+'</td><td>'+accountValue(r?.state?.peak)+'</td><td>'+accountValue(r?.state?.stop)+'</td><td>'+esc(r?.status||(data?'Not enrolled':'Unavailable'))+(r?.message?'<br>'+esc(r.message):'')+'</td><td>'+esc(r?.broker?.status||'Not verified')+'</td></tr>';}).join('');
 return'<section class="panel"><h2>Moving backstops · every reported position</h2><p><strong>Model tracking does not place broker stops.</strong> A recorded stop can rise with observed prices and cannot fall. Only verified working broker orders count as broker protection.</p>'+
 '<p>Last position check '+esc(state?.observedAt||'Never')+' · '+esc(state?.summary?.positions??a.holdingsCount)+' reported holdings · '+esc(state?.summary?.workingBrokerStops??'Unknown')+' with verified working broker stops. Broker order read: '+esc(state?.brokerReadStatus||'Not verified')+'.</p>'+
 '<label>Trail percent <input type="number" min="0.5" max="50" step="0.5" data-native-trail value="'+esc(policy?.config?.trailPct??10)+'"'+(policy?' disabled':'')+'></label> '+(!policy?'<button class="btn" data-native-management="enroll">Enable backstop tracking</button> ':'')+'<button class="btn ghost" data-native-management="check">Check position backstops</button><p data-native-status role="status" aria-live="polite"></p>'+
 '<div style="overflow:auto"><table><thead><tr><th>Instrument</th><th>Quantity</th><th>Observed peak</th><th>Modeled stop</th><th>Tracking</th><th>Broker protection</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">No open positions are reported. Newly acquired holdings still require a verified protection check.</td></tr>')+'</tbody></table></div>'+
 '<h3>Backtest moving stops</h3><p>Compare six fixed trails that exit to cash without automatic reentry. Earlier observations choose the candidate; the later period is reported separately. Gap-through stops fill at the lower open in the model.</p><label>Instrument <input data-native-study-symbol maxlength="16" value="'+esc(a.holdings?.[0]?.symbol||'SPY')+'"></label> <button class="btn ghost" data-native-management="backtest">Run backstop comparison</button><div data-native-study></div>'+(typeof nativeBrokerProtectionPanel==='function'?nativeBrokerProtectionPanel(a,policy,data):'')+'</section>';
}
function nativeExpectedFundingPanel(data){
 const plan=data?.plans?.[0];
 return'<section class="panel"><h2>Expected incoming funds · portfolio</h2><p>'+(!data?'Funding-plan read unavailable.':plan?accountValue(plan.amountUsd)+' expected; destination account not assigned.':'No expected funding recorded.')+' These funds are excluded from current cash, buying power and order caps until the broker reports receipt.</p><label>Expected amount $ <input data-native-funding type="number" min="1" max="100000000" step="0.01" value="'+esc(plan?.amountUsd??'')+'"></label> <button class="btn ghost" data-native-management="funding">Save expected funding</button></section>';
}
async function nativeAccountManagementAction(button,host,context){
 const {account,model,token}=context;
 const action=button.dataset.nativeManagement,status=host.querySelector('[data-native-status]'),binding={accountId:account.accountId,connectionKey:account.connectionKey};
 if(action==='strategies'){navigate('strategies',{sub:null});return;}
 button.disabled=true;if(status)status.textContent='Reading and saving account evidence…';
 try{
  if(action.startsWith('broker-')){await nativeBrokerProtectionAction(action,button,host,context);return;}
  if(action==='enroll'){const trailPct=Number(host.querySelector('[data-native-trail]').value);await api('/portfolio/backstops/configure',jbody('POST',{...binding,config:{modelVersion:2,trailPct,transactionCostBps:25,reentry:'none'},confirm:true}));}
  if(action==='check')await api('/portfolio/backstops/check',jbody('POST',binding));
  if(action==='funding')await api('/portfolio/expected-funding',jbody('POST',{amountUsd:Number(host.querySelector('[data-native-funding]').value)}));
  if(action==='backtest'){
   const symbol=host.querySelector('[data-native-study-symbol]').value.trim().toUpperCase(),answer=await api('/portfolio/backstops/backtest',jbody('POST',{...binding,symbol,modelVersion:2}));
   if(stale(token)||!host.isConnected)return;const r=answer.run;
   host.querySelector('[data-native-study]').innerHTML='<h4>'+esc(r.symbol)+' · retained backstop study</h4><p>Training '+esc(r.trainingWindow.startDate)+' to '+esc(r.trainingWindow.endDate)+'; later '+esc(r.laterWindow.startDate)+' to '+esc(r.laterWindow.endDate)+'. '+(r.selectedConfig?'Training selection '+esc(r.selectedConfig.trailPct)+'%.':'No positive-training candidate qualified.')+'</p><div style="overflow:auto"><table><thead><tr><th>Trail</th><th>Training return</th><th>Later return</th><th>Later drawdown</th></tr></thead><tbody>'+r.candidates.map(c=>'<tr><td>'+esc(c.config.trailPct)+'%</td><td>'+accountPercent(c.training.metrics.returnPct)+'</td><td>'+accountPercent(c.later.metrics.returnPct)+'</td><td>'+accountPercent(c.later.metrics.maxDrawdownPct)+'</td></tr>').join('')+'</tbody></table></div><p>Retrospective price research; no untouched holdout or future profit claim.25bps costs; taxes/distributions excluded. Study '+esc(r.id)+'.</p>';
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
