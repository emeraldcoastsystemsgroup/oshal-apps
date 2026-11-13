/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Date the retained submitted count beside the value, independently of the latest monitor attempt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Present one local next step beside dated retained counts; disclose detailed evidence without changing status classification or account calculations.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read account status from exact-account retained evidence. Approval, scheduling and a successful execution are separate facts; stale or missing evidence never becomes an active strategy. Render dated target weights beside the holdings from the same receipt. This module performs no request or mutation.
 */
'use strict';
// A private lexical block keeps classic-script names isolated without wrapping the module in a large function.
{
 /** @description A one-minute watcher check older than this is retained history, not current activity. @returns {number} Fifteen minutes in milliseconds. */
 const MAX_RECEIPT_AGE_MS=15*60*1000;
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const array=value=>Array.isArray(value)?value:[];
 const rows=value=>array(value).filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
 const knownRows=value=>Array.isArray(value)&&rows(value).length===value.length?value:null;
 const text=value=>String(value==null?'':value);
 const escape=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
 const same=(a,b)=>!!a&&!!b&&!!a.accountId&&!!a.connectionKey&&a.accountId===b.accountId&&a.connectionKey===b.connectionKey;
 const result=(key,label,detail)=>({key,label,detail});
 const unknown=detail=>result('unknown','Status unknown',detail);
 const pending=new Set(['working-orders','waiting-for-broker-order','order-submitted','submission-replayed']);
 const blocked=new Set(['blocked','review-required','waiting-for-position-review','uncertain-order-review-required','holdings-changed-review-required','cycle-record-missing-review-required','unfilled-order-review-required','prepared-chunk-review-required','order-rejected','order-result-uncertain']);
 const words={
  'waiting-for-position-review':'Some positions need review before the allocation can finish.',
  'holdings-changed-review-required':'Holdings changed; the retained allocation needs reconciliation.',
  'uncertain-order-review-required':'A previous order outcome is uncertain and needs reconciliation.',
  'protective-exit-awaiting-next-cycle':'Allocation is paused after a protective sale.',
  'market-closed':'Waiting for the regular market session.',
  'waiting-for-settled-cash':'Waiting for broker-verified settled cash.',
  'waiting-for-verified-buy-funding':'Waiting for verified funding for a purchase.',
  'waiting-for-capital-capacity':'Waiting for room within the approved capital cap.',
  'waiting-for-daily-turnover-budget':'Waiting for the next daily turnover budget.',
 };
 /** @description The matching receipt only; a receipt from another account or strategy is not evidence. */
 function receiptOf(account,watch){
  const receipt=watch?.lastReceipt;
  return same(account,watch)&&same(account,receipt)&&!!watch.strategyId&&receipt.strategyId===watch.strategyId?receipt:null;
 }
 /** @description A recent check and the latest completed signal session are different dates from a monthly decision. */
 function fresh(receipt,now,latestSession){
  const at=stamp(receipt?.observedAt),age=at?now-Date.parse(at):Infinity;
  return age>=0&&age<=MAX_RECEIPT_AGE_MS&&!!stamp(latestSession)&&!!stamp(receipt.signal?.signalAsOf)&&receipt.signal.signalAsOf===latestSession;
 }
 /** @description Retain the server's actual blockers without turning missing reasons into a success. */
 function reasons(receipt){
  const automation=receipt?.automation;
  const why=[...rows(automation?.blockers),...rows(automation?.deferred).flatMap(row=>rows(row.blockers)),...rows(receipt?.proposal?.blockers)];
  return [...new Set(why.filter(row=>typeof row.message==='string').map(row=>row.message.trim()).filter(Boolean))];
 }
 function malformed(receipt){
  const lists=[receipt.positions,receipt.signal?.targets,receipt.workingOrders,receipt.automation?.blockers,receipt.automation?.deferred,receipt.proposal?.blockers];
  if(lists.some(value=>value!==undefined&&(!Array.isArray(value)||rows(value).length!==value.length)))return true;
  return rows(receipt.automation?.deferred).some(row=>row.blockers!==undefined&&(!Array.isArray(row.blockers)||rows(row.blockers).length!==row.blockers.length));
 }
 function receiptStatus(receipt){
  const status=receipt.automation?.status||receipt.status,why=reasons(receipt);
  if(pending.has(status)||receipt.workingOrders?.length)return result('order-pending','Order pending','A broker order is pending. Submission is not a confirmed fill.');
  if(blocked.has(status))return result('review-blocked','Review blocked',words[status]||why[0]||'The last check requires review before further orders.');
  if(status==='protective-exit-awaiting-next-cycle')return result('paused','Paused',words[status]);
  if(status==='aligned')return result('aligned','Aligned','The last check reports the allocation aligned. This does not establish a profit or a new fill.');
  if(status==='cycle-completed')return result('cycle-complete','Cycle complete','The recorded allocation cycle completed. Compare its targets with the retained holdings below.');
  if(status==='cycle-completed-with-exceptions')return result('cycle-exceptions','Cycle complete with exceptions','The allocation completed with exceptions; inspect the retained reasons and holdings below.');
  if(words[status])return result('monitoring','Monitoring',words[status]);
  return unknown('The last receipt does not establish an execution outcome.');
 }
 function classify(account,watch,schedule,receipt,isFresh){
  if(!same(account,watch))return unknown('No matching account monitor could be verified.');
  const failedAt=stamp(watch.lastRunAt),checkedAt=stamp(receipt?.observedAt);
  if(watch.lastError&&(!checkedAt||!failedAt||Date.parse(failedAt)>=Date.parse(checkedAt)))return result('review-blocked','Review blocked','Last check failed: '+text(watch.lastError).slice(0,240));
  if(watch.lastReceipt&&!receipt)return unknown('The retained receipt does not match this account and strategy.');
  if(watch.strategyId&&watch.strategyId!==account.strategyId)return result('review-blocked','Review blocked','The approved strategy differs from the assigned strategy.');
  if(watch.enabled===false)return result('paused','Paused','This account monitor is stopped. Existing holdings and broker orders may remain.');
  if(watch.enabled!==true)return unknown('The account monitor setting could not be verified.');
  if(watch.automatedTrading===true&&watch.authority?.active!==true)return result('review-blocked','Review blocked','The saved trading setting is on, but current live approval is '+text(watch.authority?.status||'unavailable')+'.');
  if(watch.automatedTrading===false)return result('monitoring','Monitoring','This monitor does not authorize automatic strategy orders.');
  if(watch.automatedTrading!==true)return unknown('The automatic trading setting could not be verified.');
  if(!schedule)return unknown('The watcher schedule could not be read.');
  if(schedule.status!=='active')return result('paused','Paused','The watcher schedule is '+text(schedule.status||'unavailable')+(schedule.reason?': '+text(schedule.reason):'.'));
  if(!receipt)return result('armed','Armed','Approved and scheduled; no matching execution receipt is available.');
  if(!isFresh)return unknown('The retained account check is old or its signal session could not be verified. Refresh the evidence; do not infer activity from approval.');
  if(malformed(receipt))return unknown('The retained account evidence has an unreadable shape. Refresh before relying on its outcome.');
  return receiptStatus(receipt);
 }
 /** @description Compare target weights with measured holdings from the same retained account check.
  * @param {object|null} receipt The exact-account retained receipt.
  * @returns {Array<object>} Target weight, measured held weight and shares, retaining unknown values.
  */
 function comparison(receipt){
  if(!receipt)return [];
  const targets=knownRows(receipt.signal?.targets),positions=knownRows(receipt.positions);
  const symbols=[...new Set([...(targets||[]).map(row=>row.symbol),...(positions||[]).map(row=>row.symbol)].filter(symbol=>typeof symbol==='string'&&symbol))].sort();
  return symbols.map(symbol=>{
   const target=targets?.find(row=>row.symbol===symbol),held=positions?.filter(row=>row.symbol===symbol);
   const measured=held&&held.every(row=>finite(row.marketValue)),value=measured?held.reduce((sum,row)=>sum+row.marketValue,0):null;
   const qty=held&&held.every(row=>finite(row.qty))?held.reduce((sum,row)=>sum+row.qty,0):null;
   return {symbol,targetPct:target?(finite(target.weightPct)?target.weightPct:null):targets?0:null,heldPct:value!==null&&finite(receipt.accountEquity)&&receipt.accountEquity>0?value/receipt.accountEquity*100:null,quantity:qty};
  });
 }
 /** @description Choose local guidance using the existing classification and its failure precedence. */
 function nextStep(status,account,watch,schedule,receipt,isFresh){
  const evidence={label:'Review last check',destination:'evidence'};
  const setup={label:'Review setup',destination:'settings'};
  if(!same(account,watch))return evidence;
  const failedAt=stamp(watch.lastRunAt),checkedAt=stamp(receipt?.observedAt);
  if(watch.lastError&&(!checkedAt||!failedAt||Date.parse(failedAt)>=Date.parse(checkedAt)))return evidence;
  if(watch.lastReceipt&&!receipt)return evidence;
  if(watch.strategyId&&watch.strategyId!==account.strategyId)return setup;
  if(watch.enabled===false)return setup;
  if(watch.enabled!==true)return evidence;
  if(watch.automatedTrading===true&&watch.authority?.active!==true)return setup;
  if(watch.automatedTrading!==true)return evidence;
  if(!schedule)return evidence;
  if(schedule.status!=='active'||!receipt)return setup;
  if(!isFresh||malformed(receipt))return evidence;
  if(status.key==='order-pending')return {label:'Review recorded orders',destination:'evidence'};
  if(status.key==='review-blocked')return {label:'Review blockers',destination:'evidence'};
  if(['aligned','cycle-complete','cycle-exceptions'].includes(status.key))return {label:'See targets and holdings',destination:'evidence'};
  return evidence;
 }
 /** @description Build a read-only account story; every retained fact keeps its timestamp.
  * @param {object} input Account, watch, schedule, latest completed session and optional observation clock.
  * @returns {object} The conservative status and dated evidence for a single account.
  */
 function live({account,watch,schedule,latestSession,now=Date.now()}={}){
  const receipt=receiptOf(account,watch),isFresh=fresh(receipt,now,latestSession);
  const status=classify(account,watch,schedule,receipt,isFresh);
  return {...status,nextStep:nextStep(status,account,watch,schedule,receipt,isFresh),ordersSubmitted:Number.isSafeInteger(receipt?.ordersSubmitted)&&receipt.ordersSubmitted>=0?receipt.ordersSubmitted:null,receiptFresh:isFresh,asOf:stamp(receipt?.observedAt),lastCheck:stamp(watch?.lastRunAt),nextCheck:stamp(schedule?.nextRunAt),
   decisionAsOf:receipt?.signal?.decisionAsOf||null,signalAsOf:receipt?.signal?.signalAsOf||null,evidenceThrough:receipt?.signal?.evidenceThrough||null,
   setting:watch?.automatedTrading===true?'Armed':watch?.automatedTrading===false?'Not armed':'Unknown',approval:watch?.authority?.active===true?'Active':watch?.authority?.status==='active'?'Unverified':text(watch?.authority?.status||'Unknown'),
   schedule:text(schedule?.status||'Unknown'),reasons:reasons(receipt),comparison:comparison(receipt)};
 }
 function dateHtml(value){return stamp(value)?'<time datetime="'+escape(value)+'">'+escape(new Date(value).toLocaleString())+'</time>':'Unknown';}
 function percent(value){return finite(value)?value.toFixed(2)+'%':'Unknown';}
 /** @description Present exact dated evidence without adding controls or calling a service.
  * @param {object} model The result of live().
  * @param {object} options compact draws the roster summary only.
  * @returns {string} Escaped, read-only account status markup.
  */
 function html(model,{compact=false,executionHtml='',stopHtml=''}={}){
  const intro='<p><strong>'+escape(model.label)+'</strong> · '+escape(model.detail)+'</p>';
  const checks='<p class="sub">Last check '+dateHtml(model.lastCheck)+' · Next check '+dateHtml(model.nextCheck)+'</p>';
  if(compact)return intro+checks;
  const terms='<p class="sub">Setting: '+escape(model.setting)+' · Live approval: '+escape(model.approval)+' · Schedule: '+escape(model.schedule)+'</p>';
  const dates='<p class="sub">Retained account check '+dateHtml(model.asOf)+(model.receiptFresh?'':' · not verified current')+'<br>Model decision '+escape(model.decisionAsOf||'Unknown')+' · Signal session '+escape(model.signalAsOf||'Unknown')+' · Evidence through '+escape(model.evidenceThrough||'Unknown')+'</p>';
  const rows=model.comparison.map(row=>'<tr><td>'+escape(row.symbol)+'</td><td>'+percent(row.targetPct)+'</td><td>'+percent(row.heldPct)+'</td><td>'+escape(row.quantity===null?'Unknown':row.quantity)+'</td></tr>').join('');
  const table=rows?'<div style="overflow:auto"><table><caption>Targets and holdings from the retained account check above</caption><thead><tr><th>Holding</th><th>Target weight</th><th>Held weight</th><th>Shares</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>Target and holding comparison is unavailable.</p>';
  const submitted='<p class="native-recorded-count">Submitted in that recorded check: <strong>'+escape(model.ordersSubmitted===null?'Unknown':model.ordersSubmitted)+'</strong>. Count date '+dateHtml(model.asOf)+'. Submission is not a fill.</p>';
  const next=model.nextStep||{label:'Review last check',destination:'evidence'},target=next.destination==='settings'?'nativeStrategySettings':'nativeStatusEvidence';
  const action='<div class="native-status-actions"><button class="btn primary" data-native-status-next="'+escape(next.destination)+'" aria-controls="'+target+'">'+escape(next.label)+'</button>'+stopHtml+'</div>';
  const detail='<details class="native-status-evidence" data-native-status-evidence id="nativeStatusEvidence"><summary>Retained check, targets and recorded orders</summary>'+dates+table+(model.reasons.length?'<ul>'+model.reasons.map(reason=>'<li>'+escape(reason)+'</li>').join('')+'</ul>':'')+executionHtml+'</details>';
  return '<section class="native-execution-story" aria-label="Account activity status">'+intro.replace('</strong> · ','</strong> ')+terms+checks.replace('Next check','Next watcher run')+submitted+action+detail+'</section>';
 }
 const api={live,html,comparison,MAX_RECEIPT_AGE_MS};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof globalThis==='object')globalThis.NativeAccountStatus=api;
}
