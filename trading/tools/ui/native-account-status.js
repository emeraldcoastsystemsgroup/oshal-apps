/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.57.1: Review blockers did nothing visible when the evidence section was already open, and the section never said which holdings were holding the allocation up. A blocked check now leads its section with exactly the holdings the watcher's record names (deferred changes, recorded blockers, changed holdings or the order it stopped at), each with its reason in plain words and what the person can do, or says what the record leaves unnamed; their rows are marked in the targets table. Every next step names the content it shows (blockers, last check, targets, recorded orders, settings). Status classification and every account calculation are unchanged.
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
 // Plain words for the blocker codes the watcher records against a holding (routes/live/automation.js, routes/live/allocation.js,
 // routes/trading-portfolio-plan.js): the reason, then what the person can do and where. Any other code keeps the record's own message.
 const AGAIN='Nothing to do. The next watcher check reads the price again.';
 const PLAIN={
  protective_exit_requires_new_signal:['Protection sold this holding, so this allocation will not buy it straight back.','Nothing to do. The strategy’s next signal decides whether to buy it again.'],
  protected_sale_requires_coordination:['A protective sell order at the broker already holds these shares, so the planned sale cannot use them.','The sale waits while that order works. Your protective orders are listed on this page under Watcher evidence & submitted orders; cancelling one there is your own confirmed choice and may leave those shares unprotected.'],
  quote_stale:['Its last trade price is not recent enough to place an order.',AGAIN],
  quote_time_invalid:['Its price came without a valid trade time.',AGAIN],
  quote_source_unverified:['Its price is not a verified real-time Schwab quote.','The next watcher check reads the price again; the allocation waits until it is verified.'],
  fractional_residual_requires_review:['Whole-share orders would leave a fraction of a share outside the strategy.','The allocation trades whole shares only; the record asks for that fraction to be reviewed separately.'],
 };
 const ORDER_STOPS={
  'unfilled-order-review-required':'The broker ended this allocation order without filling it.',
  'prepared-chunk-review-required':'A prepared order no longer fits what remains of this change.',
  'order-rejected':'The broker rejected this allocation order.',
  'order-result-uncertain':'The broker’s answer to this order is not confirmed.',
 };
 const UNNAMED={
  'uncertain-order-review-required':'The watcher’s record does not say which order’s outcome is uncertain, so no holding can be named.',
  'cycle-record-missing-review-required':'The watcher’s record does not name the holdings: it found orders for this allocation without the record that started it.',
 };
 const NO_STEP='The record names no step for this.',NO_REASON='The record gives no reason.',SIDE={buy:'Buy',sell:'Sell'};
 const symbolOf=value=>typeof value==='string'&&value.trim()?value.trim().toUpperCase().replace(/\//g,'.'):null;
 function because(blocker){
  const plain=PLAIN[blocker.code],own=typeof blocker.message==='string'?blocker.message.trim():'';
  return plain?{reason:plain[0],step:plain[1]}:{reason:own||NO_REASON,step:'No step is recorded for this; the next watcher check evaluates it again.'};
 }
 function merge(list){
  const merged=[];
  for(const row of list){
   const same=row.symbol&&merged.find(prior=>prior.symbol===row.symbol&&prior.side===row.side);
   if(!same){merged.push({...row,reasons:[...row.reasons]});continue;}
   for(const why of row.reasons)if(!same.reasons.some(prior=>prior.reason===why.reason))same.reasons.push(why);
  }
  return merged;
 }
 /** @description Name exactly what the watcher's retained record says holds the allocation up. A holding the record does not name stays unnamed.
  * @param {object|null} receipt The exact-account retained receipt.
  * @returns {{status:string|null,rows:Array<object>,more:number,missing:string|null}} Holdings with plain reasons and steps, or what the record leaves out.
  */
 function blockerList(receipt){
  const automation=receipt?.automation,status=automation?.status||receipt?.status||null,listed=[];
  const position=(symbol,side,reasons)=>({symbol:symbolOf(symbol),side:SIDE[side]?side:null,whole:false,reasons});
  for(const row of rows(automation?.deferred))listed.push(position(row.symbol,row.action,rows(row.blockers).map(because)));
  for(const row of automation?rows(automation.blockers):status==='blocked'?rows(receipt?.proposal?.blockers):[])listed.push({...position(row.symbol,null,[because(row)]),whole:!symbolOf(row.symbol)});
  if(status==='holdings-changed-review-required')for(const symbol of array(automation?.symbols).filter(symbolOf))listed.push(position(symbol,null,[{reason:'The broker reports a different number of shares than this allocation recorded.',step:NO_STEP}]));
  const ticket=automation?.ticket;
  if(ORDER_STOPS[status]&&ticket&&typeof ticket==='object')listed.push(position(ticket.terms?.symbol,ticket.terms?.side,[{reason:ORDER_STOPS[status]+(ticket.orderId?' Broker order '+text(ticket.orderId).slice(0,40)+'.':''),step:NO_STEP}]));
  const merged=merge(listed),unnamed=merged.some(row=>!row.symbol&&!row.whole);
  const missing=!merged.length?UNNAMED[status]||'The watcher’s record does not name the holdings holding the allocation up, or why.':unnamed?'The watcher’s record does not name the holding for one or more of these.':null;
  return {status,rows:merged.slice(0,20),more:Math.max(0,merged.length-20),missing};
 }
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
 /** @description Choose local guidance using the existing classification and its failure precedence. focus names the content the step shows. */
 function nextStep(status,account,watch,schedule,receipt,isFresh){
  const evidence={label:'Review last check',destination:'evidence',focus:'check'};
  const setup={label:'Review setup',destination:'settings',focus:'settings'};
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
  if(status.key==='order-pending')return {label:'Review recorded orders',destination:'evidence',focus:'orders'};
  if(status.key==='review-blocked')return {label:'Review blockers',destination:'evidence',focus:'blockers'};
  if(['aligned','cycle-complete','cycle-exceptions'].includes(status.key))return {label:'See targets and holdings',destination:'evidence',focus:'targets'};
  return evidence;
 }
 /** @description Build a read-only account story; every retained fact keeps its timestamp.
  * @param {object} input Account, watch, schedule, latest completed session and optional observation clock.
  * @returns {object} The conservative status and dated evidence for a single account.
  */
 function live({account,watch,schedule,latestSession,now=Date.now()}={}){
  const receipt=receiptOf(account,watch),isFresh=fresh(receipt,now,latestSession);
  const status=classify(account,watch,schedule,receipt,isFresh),step=nextStep(status,account,watch,schedule,receipt,isFresh);
  return {...status,nextStep:step,blockers:step.focus==='blockers'?blockerList(receipt):null,ordersSubmitted:Number.isSafeInteger(receipt?.ordersSubmitted)&&receipt.ordersSubmitted>=0?receipt.ordersSubmitted:null,receiptFresh:isFresh,asOf:stamp(receipt?.observedAt),lastCheck:stamp(watch?.lastRunAt),nextCheck:stamp(schedule?.nextRunAt),
   decisionAsOf:receipt?.signal?.decisionAsOf||null,signalAsOf:receipt?.signal?.signalAsOf||null,evidenceThrough:receipt?.signal?.evidenceThrough||null,
   setting:watch?.automatedTrading===true?'Armed':watch?.automatedTrading===false?'Not armed':'Unknown',approval:watch?.authority?.active===true?'Active':watch?.authority?.status==='active'?'Unverified':text(watch?.authority?.status||'Unknown'),
   schedule:text(schedule?.status||'Unknown'),reasons:reasons(receipt),comparison:comparison(receipt)};
 }
 function dateHtml(value){return stamp(value)?'<time datetime="'+escape(value)+'">'+escape(new Date(value).toLocaleString())+'</time>':'Unknown';}
 function percent(value){return finite(value)?value.toFixed(2)+'%':'Unknown';}
 /** @description One focusable place a next step can bring into view; data-native-status-focus names it for the step's button. */
 function target(focus,content,extra=''){return '<div class="native-status-target'+extra+'" data-native-status-focus="'+focus+'" tabindex="-1">'+content+'</div>';}
 /** @description The holdings holding the allocation up, as the record names them, each with its reason and the person's step. */
 function blockerHtml(list){
  if(!list)return '';
  const item=row=>'<li class="native-blocker"><strong>'+escape((row.symbol||(row.whole?'Whole account':'Holding not named in the record'))+(row.side?' · '+SIDE[row.side]:''))+'</strong>'+
   (row.reasons.length?row.reasons:[{reason:NO_REASON,step:NO_STEP}]).map(why=>'<span class="native-blocker-reason">'+escape(why.reason)+'</span><span class="native-blocker-step">'+escape(why.step)+'</span>').join('')+'</li>';
  const lead=list.status==='waiting-for-position-review'?'Every other change in this allocation has filled. These wait:':'The watcher’s last check recorded:';
  const named=list.rows.length?'<p class="sub">'+escape(lead)+'</p><ul class="native-blocker-list">'+list.rows.map(item).join('')+'</ul>'+(list.more?'<p class="sub">'+escape(list.more)+' more are in the record.</p>':''):'';
  return target('blockers','<h3>Holding up the allocation</h3>'+named+(list.missing?'<p class="native-blocker-missing">'+escape(list.missing)+'</p>':''),' native-status-blockers');
 }
 /** @description Targets beside measured holdings; a holding the record names as a blocker is marked in words and colour. */
 function tableHtml(model){
  const marked=new Set((model.blockers?.rows||[]).map(row=>row.symbol).filter(Boolean));
  const body=model.comparison.map(row=>{const hit=marked.has(symbolOf(row.symbol));return '<tr'+(hit?' class="native-blocker-row"':'')+'><td>'+escape(row.symbol)+(hit?' <span class="native-blocker-tag">Blocker</span>':'')+'</td><td>'+percent(row.targetPct)+'</td><td>'+percent(row.heldPct)+'</td><td>'+escape(row.quantity===null?'Unknown':row.quantity)+'</td></tr>';}).join('');
  return target('targets',body?'<div style="overflow:auto"><table><caption>Targets and holdings from the retained account check above</caption><thead><tr><th>Holding</th><th>Target weight</th><th>Held weight</th><th>Shares</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<p>Target and holding comparison is unavailable.</p>');
 }
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
  const check=target('check',dates+(model.reasons.length?'<ul>'+model.reasons.map(reason=>'<li>'+escape(reason)+'</li>').join('')+'</ul>':''));
  const submitted='<p class="native-recorded-count">Submitted in that recorded check: <strong>'+escape(model.ordersSubmitted===null?'Unknown':model.ordersSubmitted)+'</strong>. Count date '+dateHtml(model.asOf)+'. Submission is not a fill.</p>';
  const next=model.nextStep||{label:'Review last check',destination:'evidence',focus:'check'},section=next.destination==='settings'?'nativeStrategySettings':'nativeStatusEvidence';
  const action='<div class="native-status-actions"><button class="btn primary" data-native-status-next="'+escape(next.destination)+'" data-native-status-show="'+escape(next.focus||'')+'" aria-controls="'+section+'">'+escape(next.label)+'</button>'+stopHtml+'</div>';
  const detail='<details class="native-status-evidence" data-native-status-evidence id="nativeStatusEvidence"><summary>Retained check, targets and recorded orders</summary>'+blockerHtml(model.blockers)+check+tableHtml(model)+executionHtml+'</details>';
  return '<section class="native-execution-story" aria-label="Account activity status">'+intro.replace('</strong> · ','</strong> ')+terms+checks.replace('Next check','Next watcher run')+submitted+action+detail+'</section>';
 }
 const api={live,html,comparison,blockerList,MAX_RECEIPT_AGE_MS};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof globalThis==='object')globalThis.NativeAccountStatus=api;
}
