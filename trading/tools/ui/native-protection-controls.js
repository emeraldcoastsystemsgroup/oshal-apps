/* CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Separate native protective-authority review, personal activation, expiry, retained attempts and exact cancellation from model tracking.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the exact trail's training/later results and selection status in the financial review.
 */
'use strict';
const nativeProtectionReviews=new WeakMap();
function nativeBrokerProtectionPanel(account,policy,data){
 const configKey=c=>c&&[c.modelVersion,c.trailPct,c.transactionCostBps,c.reentry||''].join('|');
 const active=policy?.nativeStatus?.effectiveStatus,studies=(data?.research||[]).filter(r=>sameNativeAccount(r,account)&&r.candidates?.some(c=>configKey(c.config)===configKey(policy?.config)));
 const studied=new Set(studies.map(r=>r.symbol)),missing=(account.holdings||[]).filter(h=>!studied.has(h.symbol)).map(h=>h.symbol);
 const available=data?.brokerExecutionAvailable===true,v2=policy?.config?.modelVersion===2;
 const choices=studies.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.symbol)+' · '+esc(r.laterWindow?.endDate||r.sourceReadAt)+' · '+esc(r.id.slice(0,8))+'</option>').join('');
 const tickets=(policy?.nativeTickets||[]).map(t=>'<tr><td>'+esc(t.terms?.symbol)+'</td><td>'+esc(t.orderId||'Unacknowledged')+'</td><td>'+esc(t.terms?.quantity)+'</td><td>'+esc(t.brokerStatus?.status||t.status)+'</td><td>'+accountValue(t.brokerStatus?.stopPrice)+'</td><td>'+esc(t.cancelStatus||'—')+'</td><td>'+(t.orderId&&t.status==='submitted'&&!['FILLED','CANCELED','CANCELLED','REJECTED','EXPIRED','REPLACED'].includes(t.brokerStatus?.status)?'<button class="btn ghost" data-native-management="broker-cancel" data-ticket="'+esc(t.ticketId)+'">Cancel exact order</button>':'')+'</td></tr>').join('');
 return'<div data-native-protection-controls><h3>Broker-held moving stops</h3><p><strong>Protective authority: '+esc(active?active.toUpperCase():policy?.automatedBrokerProtection?'UNVERIFIED':'NOT ENABLED')+'</strong>. '+(!available?'The required native release is not active.':'Native approval is separate from the account strategy’s purchase authority.')+'</p>'+
 '<p>Approved protection sells eligible whole shares using regular-session GTC trailing stops. It cannot buy, borrow or short. Fractional shares and unavailable quotes remain exceptions. Canceled or expired stops require review before restoration, so their previous floor is not silently lowered.</p>'+
 (policy?.mandate?.expiresAtMs?'<p>Authority expires '+esc(new Date(policy.mandate.expiresAtMs).toISOString())+'.</p>':'')+
 (policy&&!v2?'<button class="btn ghost" data-native-management="broker-upgrade">Use exit-to-cash tracking</button><p>This keeps the same trail and observed peaks; it changes research to a protective exit without automatic reentry.</p>':'')+
 '<p>Matching exit-to-cash studies: '+esc(studies.length)+'. '+(missing.length?'Holdings without a matching study: '+esc(missing.join(', '))+'.':'')+' Historical results do not establish future returns.</p>'+
 '<label>Study for this review <select data-native-protection-study>'+choices+'</select></label> <button class="btn" data-native-management="broker-review"'+(!available||!v2||!studies.length||policy?.automatedBrokerProtection?' disabled':'')+'>Review real-money protection</button> '+
 (policy?.automatedBrokerProtection?'<button class="btn ghost" data-native-management="broker-stop">Stop future protection submissions</button>':'')+
 '<div data-native-protection-review></div><p>Latest native protection check: '+esc(policy?.lastBrokerProtectionCheck?.status||'Never')+'.</p>'+
 '<div style="overflow:auto"><table><thead><tr><th>Instrument</th><th>Broker order</th><th>Shares</th><th>Status</th><th>Broker stop</th><th>Cancellation</th><th>Action</th></tr></thead><tbody>'+(tickets||'<tr><td colspan="7">No native protective tickets are reported'+(policy?.nativeTickets===null?'; the native ticket read is unavailable':'')+'.</td></tr>')+'</tbody></table></div></div>';
}
function nativeProtectionReviewHtml(review,account){
 const m=review.mandate,t=m.terms,r=review.research;
 const evidence=r?'<h4>Exact trail research · '+esc(r.symbol)+'</h4><p>'+(!r.hasPositiveTrainingCandidate?'No positive-training candidate qualified.':r.trainingSelected?'This trail was selected using training data.':'This trail was not the training-selected candidate.')+'</p><div style="overflow:auto"><table><thead><tr><th>Period</th><th>Dates</th><th>Return</th><th>Buy &amp; hold</th><th>Maximum drawdown</th><th>Modeled costs on $10,000</th></tr></thead><tbody>'+['training','later'].map(period=>'<tr><td>'+esc(period)+'</td><td>'+esc(r[period+'Window']?.startDate)+' to '+esc(r[period+'Window']?.endDate)+'</td><td>'+accountPercent(r.candidate?.[period]?.metrics?.returnPct)+'</td><td>'+accountPercent(r.candidate?.[period]?.metrics?.benchmarkReturnPct)+'</td><td>'+accountPercent(r.candidate?.[period]?.metrics?.maxDrawdownPct)+'</td><td>'+accountValue(r.candidate?.[period]?.fees)+'</td></tr>').join('')+'</tbody></table></div><p>Exit to cash without automatic reentry; '+esc(r.candidate?.config?.transactionCostBps)+'bps modeled costs. Historical prices exclude distributions and taxes. '+(r.untouchedHoldout?'':'No untouched holdout. ')+(r.currentHoldingsSelectionBias?'Current-holdings selection bias applies. ':'')+'This component study does not test a combined allocation and protective-stop strategy. Study '+esc(review.researchRunId)+'.</p>':'<p class="err">Research details are unavailable. Prepare a fresh review before approval.</p>';
 return'<section class="panel"><h3>Review protection · '+esc(account.label)+'</h3><p><strong>REAL MONEY · '+esc(t.trailBps/100)+'% trailing stops</strong> on eligible current and future long equity holdings in this account.</p><p>Sell only; no purchases, borrowing or shorting. Regular-session GTC orders. Maximum reference value '+accountValue(t.maxTicketNotionalCents/100)+' per ticket; at most '+esc(t.maxOrdersPerPass)+' native attempts in five minutes. Authority lasts 30 days.</p><p>Fractional shares cannot receive broker stops. Stops become market orders when triggered and execution price is not guaranteed. Existing broker orders remain after stopping future submissions.</p>'+evidence+'<p>This review does not establish that every holding was backtested or protected.</p><p>Review expires '+esc(new Date(m.reviewExpiresAtMs).toISOString())+'.</p><button class="btn" data-native-management="broker-activate"'+(!r?' disabled':'')+'>Activate REAL MONEY protective stops</button></section>';
}
async function nativeBrokerProtectionAction(action,button,host,context){
 const {account,policy}=context,bound={accountId:account.accountId,connectionKey:account.connectionKey};
 if(action==='broker-upgrade')await api('/portfolio/backstops/configure',jbody('POST',{...bound,confirm:true,upgrade:true,config:{...policy.config,modelVersion:2,reentry:'none'}}));
 if(action==='broker-review'){
  const answer=await api('/portfolio/backstops/review',jbody('POST',{...bound,researchRunId:host.querySelector('[data-native-protection-study]').value}));
  if(stale(context.token)||!host.isConnected)return;
  nativeProtectionReviews.set(host,answer.review);host.querySelector('[data-native-protection-review]').innerHTML=nativeProtectionReviewHtml(answer.review,account);return;
 }
 if(action==='broker-activate'){
  const review=nativeProtectionReviews.get(host);if(!review)throw Error('Prepare a fresh protective review first.');
  if(!confirm('Activate REAL MONEY sell-only protective stops for '+account.label+' at '+review.mandate.terms.trailBps/100+'% for 30 days? This authorizes unattended broker sell orders.'))return;
  await api('/portfolio/backstops/activate',jbody('POST',{...bound,reviewId:review.id,fingerprint:review.mandate.fingerprint,confirm:true}));
 }
 if(action==='broker-stop')await api('/portfolio/backstops/stop',jbody('POST',bound));
 if(action==='broker-cancel'){
  const ticket=policy?.nativeTickets?.find(t=>t.ticketId===button.dataset.ticket);if(!ticket)throw Error('Refresh the exact native order before cancelling.');
  if(!confirm('Cancel REAL broker protection '+ticket.orderId+' for '+ticket.terms.quantity+' '+ticket.terms.symbol+' in '+account.label+'? Those shares may become unprotected.'))return;
  await api('/portfolio/backstops/cancel',jbody('POST',{...bound,ticketId:ticket.ticketId,orderId:ticket.orderId,fingerprint:ticket.fingerprint,confirm:true}));
 }
 if(!stale(context.token))await loadNativeAccountManagement(context.model,context.token);
}
