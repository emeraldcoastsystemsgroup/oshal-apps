/* CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Distinguish the monthly decision date from the latest evidence coverage in planning receipts.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Concrete account rebalance previews with visible quantities, costs, funding blockers and exact planning acknowledgements. No broker order, borrowing or live-limit action exists here.
 */
'use strict';
/** Render the owned preview form and retained planning receipts. */
function portfolioPlansHtml(r,plans){
 const runs=r.runs.filter(run=>run.status==='completed');
 return '<section class="panel"><h2>Buy/sell planning previews</h2><p>Prepare concrete quantities from a completed study and current account evidence. The default preserves holdings outside that strategy. Whole-account scope can propose selling those holdings and requires a separate acknowledgement. Nothing here places an order or authorizes borrowing.</p>'+
 '<form data-portfolio="rebalance"><label>Completed study <select name="runId">'+portfolioOptions(runs.map(run=>[run.id,(run.strategy?.name||'Strategy')+' · '+(run.profileSnapshot?.label||run.accountSnapshot?.label||run.accountSnapshot?.accountMasked||'Selected account')+' · '+run.endDate]),'')+'</select></label> <label>Holdings scope <select name="scope"><option value="preserve-other-holdings">Preserve holdings outside this strategy</option><option value="whole-account">Rebalance the whole account, including outside holdings</option></select></label> <button class="btn" type="submit"'+(!runs.length?' disabled':'')+'>Prepare buy/sell preview</button></form>'+
 '<p class="foot">Shows up to 20 recent previews. Planning review caps: $5,000 and 100 shares per proposed action, 100% gross exposure. A larger preview needs explicit acknowledgement of its exact exceptions. These are planning caps, not changes to any live guardrail or broker credit limit.</p>'+
 plans.map(portfolioPlanCard).join('')+'</section>';
}
/** Show the full quantity roster, retained holdings and facts behind any required approval. */
function portfolioPlanCard(p){
 const f=p.funding,blocked=(p.blockers||[]).length>0;
 return '<article class="panel" data-plan-id="'+esc(p.id)+'"><h3>'+esc(p.accountLabel||p.accountId)+' · '+esc(p.strategyName)+' · '+esc(p.status)+'</h3><p>Evidence through '+esc(p.signalAsOf)+(p.signalDecisionAsOf?' · model decision '+esc(p.signalDecisionAsOf):'')+(p.rebalanceCadence?' · '+esc(p.rebalanceCadence):'')+' · reference collected '+esc(p.referenceAt)+' · expires '+esc(p.expiresAt)+'</p><p>Scope: '+esc(p.scope)+' · '+p.actions.length+' proposed actions</p>'+
 '<div style="overflow:auto"><table><thead><tr><th>Instrument</th><th>Action</th><th>Held quantity</th><th>Change quantity</th><th>After quantity</th><th>Reference price</th><th>Notional</th><th>Modeled cost</th></tr></thead><tbody>'+p.rows.map(row=>'<tr><td>'+esc(row.symbol)+(row.outsideStrategy?' · outside strategy':'')+(row.unmanaged?' · not managed':'')+'</td><td>'+esc(row.action)+'</td><td>'+esc(row.currentQty)+'</td><td>'+esc(row.changeQty)+'</td><td>'+esc(row.afterQty)+'</td><td>'+portfolioMoney(row.referencePrice)+'</td><td>'+portfolioMoney(row.notionalUsd)+'</td><td>'+portfolioMoney(row.modeledCostUsd)+'</td></tr>').join('')+'</tbody></table></div>'+
 '<p>Buys including costs '+portfolioMoney(p.buyUsd)+' · Net sell proceeds '+portfolioMoney(p.sellNetUsd)+' · Modeled costs '+portfolioMoney(p.modeledCostsUsd)+'</p>'+
 '<p>Reported equity '+portfolioMoney(f.reportedEquity)+' · Equity at reference prices '+portfolioMoney(f.repricedEquity)+' · Post-cost gross exposure '+portfolioPct(f.grossAfterPct)+' · Preserved holdings '+portfolioMoney(f.preservedHoldingsUsd)+'</p>'+
 '<p>Measured settled/withdrawable cash '+portfolioMoney(f.measuredSettledOrWithdrawableCash)+' · Measured broker buying power '+portfolioMoney(f.measuredBuyingPower)+' · Reported debit balance '+portfolioMoney(f.reportedDebitBalance)+' · Current maintenance '+portfolioMoney(f.currentMaintenanceRequirement)+'</p>'+
 '<p>Derived financing cash after changes '+portfolioMoney(f.derivedFinancingCashAfter)+' · Modeled borrowing after changes '+portfolioMoney(f.modeledBorrowingAfterUsd)+' · Modeled increase '+portfolioMoney(f.modeledBorrowingIncreaseUsd)+' · Assumed annual financing cost '+portfolioMoney(f.modeledAnnualInterestUsd)+'. These are model amounts; broker pretrade maintenance remains unknown.</p>'+
 (blocked?'<ul class="err">'+p.blockers.map(b=>'<li>'+esc(b.message)+'</li>').join('')+'</ul>':'')+
 (p.planningExceptions.length?'<p>Planning-cap exceptions requiring acknowledgement:</p><ul>'+p.planningExceptions.map(e=>'<li>'+esc((e.symbol?e.symbol+': ':'')+e.code)+' '+esc(Number(e.actual).toFixed(2))+' '+esc(e.unit)+' exceeds '+esc(e.limit)+'</li>').join('')+'</ul>':'')+
 (p.status==='pending-review'?'<div>'+(p.requiresPlanningExceptionAcknowledgement?'<label><input type="checkbox" data-plan-exceptions="'+esc(p.id)+'"> I reviewed the exact dollar, share and exposure exceptions above. This changes no live limit.</label><br>':'')+(p.requiresUnmanagedSalesAcknowledgement?'<label><input type="checkbox" data-plan-unmanaged="'+esc(p.id)+'"> I reviewed every proposed sale of a holding OSHAL does not manage, including outside-strategy holdings.</label><br>':'')+'<button class="btn ghost" data-portfolio-action="plan-approve" data-id="'+esc(p.id)+'">Approve this planning preview…</button></div>':'')+
 '<p class="foot">'+p.execution.blockers.map(esc).join(' ')+'</p><details><summary>Model assumptions</summary><ul>'+p.assumptions.map(a=>'<li>'+esc(a)+'</li>').join('')+'</ul></details><button class="btn ghost" data-portfolio-action="plan-receipt" data-id="'+esc(p.id)+'">View exact planning receipt</button><div data-plan-receipt="'+esc(p.id)+'"></div></article>';
}
/** Collect only the study identity and scope; every account amount and quote comes from the server. */
async function submitPortfolioPlan(form,token){
 const button=form.querySelector('button[type="submit"]');button.disabled=true;
 try{
  const values=Object.fromEntries(new FormData(form));portfolioNotice('Collecting current account, completed signals and reference quotes…');
  const answer=await api('/portfolio/plans',jbody('POST',{runId:values.runId,scope:values.scope}));if(stale(token))return;
  await renderNativePortfolioView(token);if(stale(token))return;
  portfolioNotice(answer.plan.status==='blocked'?'Preview saved with unresolved facts. It cannot be approved until those facts are resolved.':'Planning preview saved. Review quantities and any required acknowledgements. No order was placed.',answer.plan.status==='blocked');
  document.querySelector('[data-plan-id="'+CSS.escape(answer.plan.id)+'"]')?.scrollIntoView({block:'nearest'});
 }catch(e){if(!stale(token))portfolioNotice(e.message,true);}finally{if(button.isConnected)button.disabled=false;}
}
/** Exact planning approval is distinct from research-envelope approval and from a broker action. */
async function portfolioPlanAction(button,token){
 const id=button.dataset.id,action=button.dataset.portfolioAction,plan=PORTFOLIO_REVIEW.plans.find(p=>p.id===id);button.disabled=true;
 try{
  if(action==='plan-receipt'){
   const answer=await api('/portfolio/plans/'+encodeURIComponent(id));if(stale(token))return;
   const host=document.querySelector('[data-plan-receipt="'+CSS.escape(id)+'"]');if(host){host.innerHTML='<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(answer.plan,null,2))+'</pre>';}return;
  }
  const exceptions=document.querySelector('[data-plan-exceptions="'+CSS.escape(id)+'"]')?.checked===true;
  const unmanaged=document.querySelector('[data-plan-unmanaged="'+CSS.escape(id)+'"]')?.checked===true;
  if(plan.requiresPlanningExceptionAcknowledgement&&!exceptions)throw Error('Review and acknowledge the exact planning-cap exceptions first.');
  if(plan.requiresUnmanagedSalesAcknowledgement&&!unmanaged)throw Error('Review and acknowledge the proposed unmanaged-holding sales first.');
  if(!confirm('Approve this planning preview for '+(plan.accountLabel||plan.accountId)+'? '+plan.actions.length+' actions, buys '+portfolioMoney(plan.buyUsd)+', net sells '+portfolioMoney(plan.sellNetUsd)+', modeled borrowing increase '+portfolioMoney(plan.funding.modeledBorrowingIncreaseUsd)+'. This places no order and authorizes no borrowing or changed live limit.'))return;
  await api('/portfolio/plans/'+encodeURIComponent(id)+'/approve',jbody('POST',{confirm:true,fingerprint:plan.fingerprint,acknowledgePlanningExceptions:exceptions,acknowledgeUnmanagedSales:unmanaged}));
  if(!stale(token)){await renderNativePortfolioView(token);portfolioNotice('Planning preview acknowledged. Zero orders, zero authorized borrowing, and no live limit changes.');}
 }catch(e){if(!stale(token))portfolioNotice(e.message,true);}finally{if(button.isConnected)button.disabled=false;}
}
