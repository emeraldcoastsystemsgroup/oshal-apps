/* CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Display verified native authority and expiry alongside the saved automatic-execution setting.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Visible account-specific monitor, schedule status, retained broker order states and separate exact real-money day-limit submission. No implicit activation.
 */
'use strict';
const NATIVE_TICKETS=new Map(),LIVE_MANDATES=new Map();
function portfolioManagementHtml(p,r,data){
 const choices=r.runs.filter(x=>x.status==='completed'&&p.accounts.some(a=>a.kind==='live'&&a.accountId===x.accountId&&a.connectionKey===x.connectionKey&&a.strategyId===x.strategyId));
 if(!data.execution.available)return '<section class="panel" id="portfolioManagement"><h2>Strategy monitor & real orders</h2><p>The native broker update is not active on this installation. Monitoring and real-order controls require that verified release.</p></section>';
 return '<section class="panel" id="portfolioManagement"><h2>Strategy monitor & real orders</h2><p>Monitoring checks your saved monthly rules, holdings and broker orders. A reviewed account mandate can authorize monthly automatic execution. Cash-funded whole shares only; monthly model exits, with no intraday stops.</p><p id="managementSchedule">Checking your own watcher schedule…</p>'+
 '<form data-portfolio="watch"><label>Backtested account strategy <select name="runId">'+portfolioOptions(choices.map(x=>[x.id,(x.profileSnapshot?.label||x.accountSnapshot?.accountMasked||'Account')+' · '+x.strategy.name+' · '+x.endDate]),'')+'</select></label> <button class="btn" type="submit"'+(!choices.length?' disabled':'')+'>Start strategy monitor</button></form>'+
 '<p><button class="btn ghost" data-portfolio-action="management-activate">Activate watcher schedule</button> <button class="btn ghost" data-portfolio-action="management-tick">Check portfolios now</button></p><p id="managementNotice" role="status" aria-live="polite"></p>'+
 (data.watches||[]).map(w=>{
  const receipt=w.lastReceipt,plan=receipt?.proposal;
  return '<article class="panel"><h3>'+esc(w.accountLabel||w.accountId)+' · '+(w.enabled?'monitor enabled':'monitor stopped')+'</h3><p>Last check '+esc(w.lastRunAt||'Never')+' · '+esc(w.lastError?'FAILED: '+w.lastError:receipt?.status||'Waiting for first check')+'</p>'+
  (w.enabled?'<button class="btn ghost" data-portfolio-action="management-stop" data-id="'+esc(w.id)+'">Stop this monitor</button>':'')+
  portfolioLiveMandateHtml(w,data)+(receipt?'<p>Model decision '+esc(receipt.signal.decisionAsOf)+' · evidence through '+esc(receipt.signal.evidenceThrough)+' · '+esc(receipt.signal.rebalanceCadence)+'</p><p>Reported equity '+portfolioMoney(receipt.accountEquity)+' · Cash '+portfolioMoney(receipt.reportedCash)+' · Working broker orders '+receipt.workingOrders.length+'</p>'+receipt.proposal.blockers.map(b=>'<p class="err">'+esc(b.message)+'</p>').join('')+
  '<div style="overflow:auto"><table><thead><tr><th>Instrument</th><th>Action</th><th>Shares</th><th>Reference</th><th>Day-limit price $</th><th></th></tr></thead><tbody>'+plan.actions.map(a=>'<tr><td>'+esc(a.symbol)+'</td><td>'+esc(a.action)+'</td><td>'+esc(Math.abs(a.changeQty))+'</td><td>'+portfolioMoney(a.referencePrice)+'</td><td><input type="number" min="0.01" step="0.01" value="'+Number(a.referencePrice).toFixed(2)+'" data-live-limit="'+esc(w.id+':'+a.symbol)+'" aria-label="Limit price for '+esc(a.symbol)+'"></td><td><button class="btn ghost" data-portfolio-action="management-ticket" data-id="'+esc(w.id)+'" data-symbol="'+esc(a.symbol)+'">Review real order</button></td></tr>').join('')+'</tbody></table></div>'+
  '<p>Current broker cash budget: '+portfolioMoney(receipt.brokerFunding?.cashBudgetUsd)+'. Initial and projected balances are not substituted for current funding.</p><h4>Broker orders</h4>'+((receipt.brokerOrders||[]).length?'<ul>'+receipt.brokerOrders.slice(0,25).map(o=>'<li>'+esc(o.orderId)+' · '+esc(o.legs.map(l=>l.symbol+' '+l.instruction).join(', '))+' · '+esc(o.status)+' · filled '+esc(o.filledQuantity)+' / '+esc(o.quantity)+managementCancelButton(w,receipt,o)+'</li>').join('')+'</ul>':'<p>No orders reported in the last 60 days.</p>'):'')+(receipt?.nativeTickets||[]).filter(t=>['unknown','attempting'].includes(t.status)).map(t=>'<p class="err">Uncertain attempt '+esc(t.ticketId)+'. No retry will be sent.</p><label>Matching broker order ID <input data-live-reconcile="'+esc(t.ticketId)+'" inputmode="numeric"></label> <button class="btn ghost" data-portfolio-action="management-reconcile" data-id="'+esc(w.id)+'" data-ticket="'+esc(t.ticketId)+'">Reconcile this exact attempt</button>').join('')+'<div data-live-ticket="'+esc(w.id)+'"></div></article>';
 }).join('')+'</section>';
}
function managementCancelButton(watch,receipt,order){
 const ticket=(receipt.nativeTickets||[]).find(t=>t.orderId===order.orderId&&t.status==='submitted');
 if(!ticket||['FILLED','CANCELED','CANCELLED','REJECTED','EXPIRED','REPLACED'].includes(order.status))return '';
 return ' <button class="btn ghost" data-portfolio-action="management-cancel" data-id="'+esc(watch.id)+'" data-ticket="'+esc(ticket.ticketId)+'" data-order="'+esc(order.orderId)+'">Cancel this broker order…</button>';
}
function managementNotice(message,error=false){const el=$('managementNotice');if(el){el.textContent=message;el.className=error?'err':'foot';}}
async function syncPortfolioWatcher(token){
 const el=$('managementSchedule');if(!el)return;
 try{const row=await paperScheduleRow({app:'intelligent-trades',name:'portfolio-watcher'});if(stale(token))return;
  el.textContent=row?'Watcher schedule: '+row.status+(row.reason?' · '+row.reason:'')+(row.nextRunAt?' · next '+row.nextRunAt:''):'Watcher schedule is not registered on this installation.';
 }catch(e){if(!stale(token))el.textContent='Watcher schedule status unavailable: '+e.message;}
}
async function submitPortfolioWatch(form,token){
 const button=form.querySelector('button');button.disabled=true;
 try{const runId=new FormData(form).get('runId');await api('/portfolio/watch',jbody('POST',{runId,confirm:true}));if(!stale(token)){await renderNativePortfolioView(token);managementNotice('Monitor saved. Activate your watcher schedule, then verify its first successful check. No trading or protection was activated.');}}
 catch(e){if(!stale(token))managementNotice(e.message,true);}finally{if(button.isConnected)button.disabled=false;}
}
async function portfolioManagementAction(button,token){
 const act=button.dataset.portfolioAction,id=button.dataset.id;let attemptStarted=false;button.disabled=true;
 try{
  if(act==='management-activate'){
   const row=await paperScheduleRow({app:'intelligent-trades',name:'portfolio-watcher'});if(!row)throw Error('The watcher job is not registered.');
   await paperKernel('/api/v1/agent/schedules/'+encodeURIComponent(row.id)+'/activate',{method:'POST',body:JSON.stringify({class:'person',configuration:{runBudgetMicros:1000000,dailyBudgetMicros:10000000,timeoutMs:120000}})});
   if(!stale(token)){await syncPortfolioWatcher(token);managementNotice('Schedule activation returned. Check its displayed status and next successful run.');}return;
  }
  if(act==='management-tick'){const result=await api('/portfolio/watch/tick',jbody('POST',{}));if(!stale(token)){await renderNativePortfolioView(token);managementNotice('Checked '+result.checked+' accounts; '+result.receipts.filter(r=>r.status==='failed').length+' failed. Broker submissions: '+(result.ordersSubmitted===null?'unknown; review retained native attempts':result.ordersSubmitted)+'.');}return;}
  const watch=PORTFOLIO_REVIEW.management.watches.find(w=>w.id===id);if(!watch)throw Error('Monitor not found; refresh.');
  if(act==='management-live-stop'){await api('/portfolio/live/stop',jbody('POST',{watchId:id}));if(!stale(token)){await renderNativePortfolioView(token);managementNotice('Future automatic submissions stopped. Check and separately cancel any working broker orders.');}return;}
  if(act==='management-mandate'){
   const capital=Number(document.querySelector('[data-live-capital="'+CSS.escape(id)+'"]')?.value),capitalCents=Math.round(capital*100);
   if(!Number.isSafeInteger(capitalCents)||capitalCents<10000||capitalCents>5000000)throw Error('Choose a cash capital cap between $100 and $50,000.');
   const result=await api('/portfolio/live/mandate',jbody('POST',{watchId:id,capitalCents}));LIVE_MANDATES.set(id,result.mandate);paintLiveMandate(id,result.mandate);return;
  }
  if(act==='management-live-activate'){
   const m=LIVE_MANDATES.get(id);if(!m)throw Error('Prepare this account’s exact strategy mandate first.');
   if(!confirm('Activate REAL MONEY monthly strategy on '+watch.accountLabel+'? Cash capital cap $'+(m.terms.capitalCents/100).toFixed(2)+', allowed symbols '+m.terms.symbols.join(', ')+'. The watcher may submit orders without asking again for 30 days. Monthly model exits only; no intraday stops.'))return;
   const result=await api('/portfolio/live/activate',jbody('POST',{watchId:id,mandateId:m.mandateId,fingerprint:m.fingerprint,confirm:true}));
   if(!stale(token)){await renderNativePortfolioView(token);managementNotice('Live mandate status: '+result.mandate.status+'. Your watcher schedule must also be active; verify its next retained broker result.');}return;
  }
  if(act==='management-stop'){await api('/portfolio/watch/stop',jbody('POST',{accountId:watch.accountId,connectionKey:watch.connectionKey}));if(!stale(token))await renderNativePortfolioView(token);return;}
  if(act==='management-cancel'){
   const ticket=(watch.lastReceipt?.nativeTickets||[]).find(t=>t.ticketId===button.dataset.ticket&&t.orderId===button.dataset.order);
   if(!ticket)throw Error('Refresh this account’s broker order evidence first.');
   if(!confirm('Request cancellation of REAL broker order '+ticket.orderId+' on '+watch.accountLabel+'? Already filled shares remain filled. A request is not a confirmed cancellation.'))return;
   const result=await api('/portfolio/live/cancel',jbody('POST',{watchId:id,ticketId:ticket.ticketId,orderId:ticket.orderId,fingerprint:ticket.fingerprint,confirm:true}));
   if(!stale(token))managementNotice('Cancellation status: '+(result.ticket.cancelStatus||result.ticket.brokerStatus?.status||'unknown')+'. Check current broker status; filled shares are unchanged.');return;
  }
  if(act==='management-reconcile'){
   const ticketId=button.dataset.ticket,orderId=document.querySelector('[data-live-reconcile="'+CSS.escape(ticketId)+'"]')?.value;
   if(!/^[0-9]+$/.test(orderId||''))throw Error('Enter the numeric broker order ID.');
   if(!confirm('Match uncertain attempt '+ticketId+' to broker order '+orderId+'? OSHAL verifies the exact account, order terms and submission time. This sends no new order.'))return;
   await api('/portfolio/live/reconcile',jbody('POST',{watchId:id,ticketId,orderId,confirm:true}));if(!stale(token)){await renderNativePortfolioView(token);managementNotice('Attempt reconciled to the verified broker order.');}return;
  }
  if(act==='management-ticket'){
   const symbol=button.dataset.symbol,field=document.querySelector('[data-live-limit="'+CSS.escape(id+':'+symbol)+'"]'),price=Number(field?.value),cents=Math.round(price*100);
   if(!Number.isFinite(price)||cents<=0||Math.abs(price*100-cents)>0.000001)throw Error('Enter a positive day-limit price in cents.');
   const result=await api('/portfolio/live/ticket',jbody('POST',{watchId:id,symbol,limitCents:cents}));if(stale(token))return;
   const t=result.ticket;NATIVE_TICKETS.set(id,t);const host=document.querySelector('[data-live-ticket="'+CSS.escape(id)+'"]');
   if(host)host.innerHTML='<h4>REAL MONEY order review</h4><p>'+esc(watch.accountLabel)+' · '+esc(t.terms.side)+' '+esc(t.terms.quantity)+' '+esc(t.terms.symbol)+' · Limit '+portfolioMoney(t.terms.limitCents/100)+' · Day · Regular session</p><p>Maximum limit notional '+portfolioMoney(t.terms.notionalCents/100)+' plus applicable fees. Ticket expires '+esc(new Date(t.expiresAtMs).toLocaleString())+'. Status '+esc(t.status)+'.</p><p>Current verified cash budget '+portfolioMoney(t.facts.cashBudgetUsd)+'. This is one order, not an atomic basket. Check partial fills and working orders before another submission.</p>'+(t.status==='prepared'?'<button class="btn" data-portfolio-action="management-submit" data-id="'+esc(id)+'">Submit this REAL order</button>':'<p>No retry will be sent for this ticket.</p>');return;
  }
  if(act==='management-submit'){
   const ticket=NATIVE_TICKETS.get(id);if(!ticket)throw Error('Prepare a fresh order review first.');
   if(!confirm('Submit REAL order on '+watch.accountLabel+': '+ticket.terms.side+' '+ticket.terms.quantity+' '+ticket.terms.symbol+' at day limit $'+(ticket.terms.limitCents/100).toFixed(2)+'? Maximum limit notional $'+(ticket.terms.notionalCents/100).toFixed(2)+' plus fees.'))return;
   attemptStarted=true;
   const result=await api('/portfolio/live/submit',jbody('POST',{watchId:id,ticketId:ticket.ticketId,fingerprint:ticket.fingerprint,confirm:true}));
   NATIVE_TICKETS.set(id,result.ticket);if(!stale(token)){managementNotice('Broker attempt status: '+result.ticket.status+(result.ticket.orderId?' · order '+result.ticket.orderId:'')+'. A submission is not a fill. Check portfolios now to reconcile.');button.disabled=true;}return;
  }
 }catch(e){if(!stale(token))managementNotice(e.message,true);}finally{if(button.isConnected&&!attemptStarted)button.disabled=false;}
}

function portfolioLiveMandateHtml(w,data){
 if(!data.execution.mandatesAvailable)return '<p>Automatic strategy execution requires the verified native mandate update.</p>';
 if(w.automatedTrading)return '<h4>Automatic monthly strategy '+(w.authority?.active?'enabled':'not active')+'</h4><p>Native approval: '+esc(w.authority?.status||'unavailable')+'</p><p>Cash capital cap '+portfolioMoney(w.mandate?.terms?.capitalCents/100)+' · expiry '+esc(w.mandate?.expiresAtMs?new Date(w.mandate.expiresAtMs).toLocaleString():'Unknown')+'</p><p>'+esc(w.lastReceipt?.automation?.status||'Awaiting first scheduled check')+' · Monthly model exits only; no intraday stops.</p><button class="btn" data-portfolio-action="management-live-stop" data-id="'+esc(w.id)+'">Stop automatic trading</button>';
 if(!w.enabled)return '';
 const budget=w.lastReceipt?.brokerFunding?.cashBudgetUsd;
 return '<h4>Automatic monthly execution</h4><p>Review the exact saved model, account and cash capital cap before activation. Enrollment requires a flat account. A source or strategy change requires a new review. Approval lasts 30 days.</p><label>Cash capital cap $ <input type="number" min="100" max="50000" step="0.01" data-live-capital="'+esc(w.id)+'" value="'+(Number.isFinite(budget)?Math.min(50000,Math.floor(budget*0.99)):'')+'"></label> <button class="btn ghost" data-portfolio-action="management-mandate" data-id="'+esc(w.id)+'">Review automatic strategy</button><div data-live-mandate="'+esc(w.id)+'"></div>';
}
function paintLiveMandate(id,m){
 const el=document.querySelector('[data-live-mandate="'+CSS.escape(id)+'"]');if(!el)return;
 el.innerHTML='<h4>REAL MONEY strategy mandate</h4><p>Account '+esc(m.accountMasked)+' · cash capital cap '+portfolioMoney(m.terms.capitalCents/100)+' · daily turnover cap '+portfolioMoney(m.terms.maxDailyTurnoverCents/100)+'</p><p>Allowed instruments '+esc(m.terms.symbols.join(', '))+'. Whole shares, long only, cash funded, regular-session day-limit orders. Orders proceed one at a time after broker reconciliation.</p><p>Cadence: monthly, using the saved completed-session model. Initial allocation can start during the next regular session. Price-only backtest excludes dividends and taxes; live fills, slippage and timing can differ. This adds no intraday protective stops and authorizes no borrowing.</p><p>Authority expires 30 days after activation. Stop prevents future submissions; existing broker orders require separate cancellation. Strategy fingerprint <span style="overflow-wrap:anywhere">'+esc(m.terms.strategyFingerprint)+'</span>.</p><button class="btn" data-portfolio-action="management-live-activate" data-id="'+esc(id)+'">Activate this REAL MONEY strategy</button>';
}
