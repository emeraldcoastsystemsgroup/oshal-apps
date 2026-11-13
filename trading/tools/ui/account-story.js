/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.0: turn the saved facts of GET /paper/today into one card per account that answers three questions in plain words: is it running or parked and in what, what did it do today, and why did the value move. A connected account's state is the status the Manage strategy page already computes (native-account-status.js), renamed, so the two screens cannot disagree. "Parked" is read from the strategy's saved decision and named with the strategy's own rule, never guessed from holdings. A paper card always says its value counts prices only. Every part names its source and the time of its record. This module makes no request and changes nothing; no sentence says what to buy, sell or hold.
 */
'use strict';
// A private lexical block keeps classic-script names isolated, as native-account-status.js does.
{
 const FIFTEEN_MINUTES=15*60*1000,THREE_MINUTES=3*60*1000;
 const FIXED={
  basis:'This simulation counts prices only. It does not add the interest or dividends a fund pays, so a fund that pays out each month reads lower here than in a brokerage account.',
  otherCash:'Interest, dividends, fees, deposits and withdrawals are not listed one by one in saved records. They are inside the second line.',
  sincePurchase:'This counts price change on what is held now. It leaves out closed trades and cash paid out.',
  noPrior:'No earlier record to compare with. The first one is saved by the watcher\'s next check.',
 };
 const RULES={
  'monthly-trend':'This strategy keeps a fund while its latest month-end close is above its ten-month average. The share of a fund that is not is held in BIL.',
  'quarterly-rotation':'This strategy holds up to three funds whose three-month return beats BIL\'s. Empty places are held in BIL.',
 };
 const NEXT={
  'NEEDS YOU':{label:'See what is waiting',go:'evidence'},'NOT RUNNING':{label:'Go to the watcher switch',go:'schedule'},'NOT SET UP':{label:'Set up this account',go:'settings'},
  'STOPPED':{label:'Set up this account',go:'settings'},'WATCHING ONLY':{label:'Set up this account',go:'settings'},'UNKNOWN':{label:'Check this account',go:'refresh'},
  'RUNNING':{label:'See the last check',go:'evidence'},
 };
 const statusReader=()=>typeof NativeAccountStatus!=='undefined'?NativeAccountStatus:typeof require==='function'?require('./native-account-status.js'):null;
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
 const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=value=>finite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value):'Unknown';
 const signed=value=>!finite(value)?'Unknown':value===0?money(0):(value<0?'-':'+')+money(Math.abs(value));
 const moved=value=>!finite(value)?'change unknown':value<0?'down '+money(-value):value>0?'up '+money(value):'no change';
 const percent=(value,places=1)=>finite(value)?String(Math.round(value*10**places)/10**places)+'%':'Unknown';
 const plural=(n,word)=>n+' '+word+(n===1?'':word.endsWith('s')?'es':'s');
 const fund=symbol=>symbol==='BIL'?'Treasury bills (BIL)':symbol;
 /** The kernel's word for a job that is not active, in the person's words. */
 const jobWords=status=>({'not-activated':'not switched on',suspended:'suspended',paused:'paused'}[status]||'not running');
 /** A calendar day in words, without shifting it into the reader's time zone. */
 const dayWords=day=>/^\d{4}-\d{2}-\d{2}/.test(String(day))?new Date(String(day).slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'an unknown date';
 const clockWords=(at,options)=>!stamp(at)?'an unknown time':options.format?options.format(at):new Date(at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 function ago(at,now){
  if(!stamp(at))return 'time unknown';
  const minutes=Math.round((now-Date.parse(at))/60000);
  return minutes<1?'less than a minute ago':minutes<90?plural(minutes,'minute')+' ago':minutes<2880?plural(Math.round(minutes/60),'hour')+' ago':plural(Math.round(minutes/1440),'day')+' ago';
 }

 /** @description The second chip: how much of the saved plan is the model's fallback. Read from the plan, never from holdings. */
 function parkedChip(plan){
  const share=plan?.fallbackPct;
  return !finite(share)||share<0.5?null:share>=99.5?'PARKED':share>=50?'MOSTLY PARKED':'PARTLY PARKED';
 }
 /** @description What the account held at its last record, as weights: the watcher's last check, or a simulation's ledger. */
 function holdsLine(holdings,paper){
  const rows=(holdings?.positions||[]).filter(p=>finite(p.weightPct)).sort((a,b)=>b.weightPct-a.weightPct).slice(0,6).map(p=>fund(p.symbol)+' '+percent(p.weightPct));
  const cash=finite(holdings?.cash)&&holdings.equity>0?['cash '+percent(holdings.cash/holdings.equity*100)]:[];
  return rows.length||cash.length?(paper?'Held in the ledger: ':'Held at the last check: ')+[...rows,...cash].join(' · ')+'.':null;
 }
 /** @description The plan part: when it was decided, its weights, how many funds are in it and the strategy's own rule. */
 function planPart(fact){
  const plan=fact.plan,holds=holdsLine(fact.holdings,fact.kind==='paper'),captions=[];
  if(fact.holdings?.at)captions.push({source:fact.kind==='paper'?'this simulation\'s ledger':'your broker, read by the watcher',at:fact.holdings.at});
  if(!plan||!Array.isArray(plan.targets)){
   const none=fact.kind==='paper'&&fact.opened?'No plan is recorded for this account. It trades by its posture rules.':'No plan is recorded for this account.';
   return {title:'The plan',lines:[none,...(holds?[holds]:[])],notes:[],captions};
  }
  const monthly=plan.cadence==='monthly',weights=[...plan.targets].sort((a,b)=>b.weightPct-a.weightPct).map(t=>fund(t.symbol)+' '+percent(t.weightPct));
  if(!monthly&&plan.cashWeightPct>=0.5)weights.push('cash '+percent(plan.cashWeightPct));
  const lines=[monthly?'Decided '+dayWords(plan.decisionAsOf)+', at the month-end.'+(plan.nextDecisionUses?' The next decision uses the '+dayWords(plan.nextDecisionUses)+' month-end.':'')
   :'Decided after the '+dayWords(plan.decisionAsOf)+' close. It is decided again after each market close.',weights.join(' · ')||'Nothing is in the plan.'];
  if(monthly&&finite(plan.funds)&&finite(plan.fundsInPlan)&&plan.fallbackPct>=0.5)
   lines.push(plan.fundsInPlan?plan.fundsInPlan+' of this strategy\'s '+plural(plan.funds,'fund')+' '+(plan.fundsInPlan===1?'is':'are')+' in the plan. The rest of the plan is in BIL, the strategy\'s fallback fund.'
    :'None of this strategy\'s '+plural(plan.funds,'fund')+' is in the plan. The whole plan is in BIL, the strategy\'s fallback fund.');
  const notes=[];
  if(RULES[fact.strategy?.kind])notes.push(RULES[fact.strategy.kind]);
  if(!monthly&&plan.marketRiskOn===false)notes.push('The strategy\'s market check is off'+(finite(fact.strategy?.defensiveGrossPct)?', which limits the plan to '+percent(fact.strategy.defensiveGrossPct):'')+'. The rest stays in cash.');
  if(holds)lines.push(holds);
  return {title:'The plan',lines,notes,captions:[{source:'the strategy\'s saved decision',at:plan.decisionAsOf,day:true},...captions]};
 }

 /** @description One fill in words. */
 function fillWords(fill,options){
  return (String(fill.side).startsWith('SELL')?'Sold ':'Bought ')+fill.quantity+' '+fill.symbol+' at '+money(fill.price)+' ('+clockWords(fill.at,options)+')'+(fill.reason?', '+fill.reason:'');
 }
 /** @description Today for a connected account: what was sent and filled, by whom, and why nothing was. */
 function connectedToday(fact,state,options){
  const today=fact.today,caption=today?.at?[{source:'your broker\'s order list, read by the watcher',at:today.at}]:[];
  if(!today)return {title:'Today',lines:['No check is recorded for this account.'],notes:[],captions:caption};
  if(!today.orders||!today.fills)return {title:'Today',lines:['Unknown. The order list the last check saved could not be read.'],notes:[],captions:caption,unknown:true};
  const sent=today.orders.entered,lines=[],notes=[];
  if(!sent.total&&!today.fills.length){
   lines.push('No orders sent.'+(state.why?' '+state.why:''));
   if(today.lastFill)lines.push('Last fill: '+fillWords(today.lastFill,options)+'.');
  }else{
   const by=[[sent.strategy,'by the strategy'],[sent.watcherExit,'by watcher exits'],[sent.oneOff,'from a one-off review'],[sent.outside,'placed outside OSHAL']].filter(([n])=>n>0).map(([n,who])=>n+' '+who);
   lines.push(plural(sent.total,'order')+' sent today'+(by.length?': '+by.join(', '):'')+'.');
   lines.push(plural(today.fills.length,'fill')+(today.fillsCut?' or more':'')+' today'+(today.fills.length?': '+today.fills.slice(0,3).map(f=>fillWords(f,options)).join('; ')+(today.fills.length>3?'; and '+(today.fills.length-3)+' more':''):'')+'.');
   const rest=[[today.orders.working,'still working'],[today.orders.refused,'refused'],[today.orders.cancelled,'cancelled']].filter(([n])=>n>0).map(([n,what])=>n+' '+what);
   if(rest.length)lines.push('Of the orders sent today: '+rest.join(', ')+'.');
  }
  if(today.uncertainAttempts>0)notes.push(plural(today.uncertainAttempts,'attempt')+' with an uncertain result. Not counted as sent.');
  if(today.uncertainAttempts===null)notes.push('Uncertain attempts: Unknown.');
  if(today.exceptions>0)notes.push(plural(today.exceptions,'order')+' in the saved list could not be read and '+(today.exceptions===1?'is':'are')+' left out.');
  return {title:'Today',lines,notes,captions:caption,sent:sent.total,filled:today.fills.length};
 }
 /** @description Today for a paper account: recorded passes and simulated trades, each with its own reason. */
 function paperToday(fact,options){
  const today=fact.today,lines=[],fills=today.fills,passes=fact.passesToday;
  if(!fills.length){
   lines.push('No simulated trades.'+(fact.strategy?(fact.plan?.cadence==='monthly'?' This account trades when the monthly decision changes. The other passes only re-price what it holds.':' This account trades when the daily decision changes.'):''));
   if(today.lastFill)lines.push('Last trade: '+fillWords(today.lastFill,options)+'.');
  }else{
   lines.push(plural(fills.length,'simulated trade')+(today.fillsCut?' or more':'')+' today: '+fills.slice(0,3).map(f=>fillWords(f,options)).join('; ')+(fills.length>3?'; and '+(fills.length-3)+' more':'')+'.');
   lines.push('Result of today\'s trades, with modeled costs: '+signed(today.realizedPl)+'.');
  }
  lines.push(plural(passes.count,'pass')+(passes.capped?' or more':'')+' recorded today'+(passes.withTrades?', '+passes.withTrades+' with trades':'')+'.');
  return {title:'Today',lines,notes:[],captions:[{source:'this simulation\'s ledger',at:fact.holdings.at}],filled:fills.length};
 }

 /** @description The value part: the value, its change since the last earlier record, the two parts that add up to it, and what is said after that sum. */
 function valuePart(fact,options){
  const value=fact.value,paper=fact.kind==='paper',lines=[],after=[],notes=[],sum=[];
  if(!value||!finite(value.now?.equity)){
   // An account the broker lists that has no saved record yet: the page's own read when it opened, said as that.
   const live=finite(fact.live?.equity)?[money(fact.live.equity)+(stamp(fact.live.at)?' at '+clockWords(fact.live.at,options):'')+', read from your broker by this page.']:[];
   return {title:'Value',lines:['No value is recorded for this account.',...live],sum,notes:paper?[FIXED.basis]:[],captions:live.length&&stamp(fact.live.at)?[{source:'your broker, read by this page',at:fact.live.at}]:[]};
  }
  const captions=[{source:paper?'this simulation\'s ledger':'your broker, read by the watcher',at:value.now.at}];
  if(value.prior){
   lines.push(money(value.now.equity)+' at '+clockWords(value.now.at,options)+' · '+moved(value.change)+' since the '+(paper?'':'last ')+'record of '+dayWords(value.prior.day)+'.');
   if(!paper)captions.push({source:'OSHAL\'s saved daily record',at:value.prior.at,past:true});
  }else lines.push(money(value.now.equity)+' at '+clockWords(value.now.at,options)+'.',paper?'No earlier record to compare with.':FIXED.noPrior);
  if(value.parts){
   sum.push(['Prices of what it holds',signed(value.parts.prices)],paper?['Modeled trading costs',signed(value.parts.costs)]:['Cash in or out, other than trades',signed(value.parts.otherCash)]);
   if(!paper)notes.push(FIXED.otherCash);
   if(value.parts.bought||value.parts.sold)notes.push('Trades that day: bought '+money(value.parts.bought)+', sold '+money(value.parts.sold)+'. A trade moves value between cash and holdings and does not change the total.');
  }else if(value.prior)notes.push('The split is unknown: '+(value.unknown||[]).map(k=>k==='cash'?'a cash figure is missing':k==='fills'?'that day\'s fills could not be valued':'a figure is missing').join(', ')+'.');
  const since=(fact.holdings?.positions||[]).filter(p=>finite(p.unrealizedPl)).slice(0,6).map(p=>p.symbol+' '+signed(p.unrealizedPl));
  if(since.length)notes.push('Since purchase, price only: '+since.join(' · ')+'.'+(paper?'':' '+FIXED.sincePurchase));
  if(fact.interest)notes.push('Margin interest the broker has accrued so far: '+money(fact.interest.accrued)+'.');
  if(paper&&value.sinceStart)after.push('Since it started on '+dayWords(value.sinceStart.startedAt)+' with '+money(value.sinceStart.startingCash)+': '+moved(value.sinceStart.change)+' ('+percent(value.sinceStart.pct,2)+').');
  if(paper)notes.push(FIXED.basis);
  return {title:'Value',lines,sum,after,notes,captions};
 }

 /** @description A connected account's chip and first sentence: the Manage strategy page's own status, renamed. */
 function connectedState(fact,options){
  const watch=fact.status?.watch,monitor=fact.monitor,reader=statusReader(),now=options.now;
  if(!watch)return {chip:'NOT SET UP',sentence:'No strategy is set to run on this account.'};
  const fresh=stamp(monitor?.heartbeatAt)&&now-Date.parse(monitor.heartbeatAt)<=THREE_MINUTES;
  const schedule=options.watcher||(fresh?{status:'active'}:null);
  const story=reader?reader.live({account:fact.status.account,watch,schedule,latestSession:options.latestSession,now}):{key:'unknown',detail:'The account-status reader is unavailable.'};
  if(story.key==='review-blocked')return {chip:'NEEDS YOU',sentence:story.detail};
  if(story.key==='paused'&&watch.enabled===false)return {chip:'STOPPED',sentence:'This account\'s monitor is stopped. Holdings and any broker orders stay as they are.'};
  if(story.key==='monitoring'&&watch.automatedTrading===false)return {chip:'WATCHING ONLY',sentence:'The watcher checks this account. It is not approved to place strategy orders.'};
  if(story.key==='paused'&&schedule&&schedule.status!=='active')return {chip:'NOT RUNNING',sentence:'Approved, but the watcher job is '+jobWords(schedule.status)+'. Nothing is being checked.'};
  if(story.key==='unknown')return {chip:'UNKNOWN',sentence:story.detail};
  const checked=stamp(monitor?.heartbeatAt)?'The watcher checked it at '+clockWords(monitor.heartbeatAt,options)+', '+ago(monitor.heartbeatAt,now)+'.':'No check is recorded yet.';
  const said={aligned:'Holdings match the plan.','cycle-complete':'Holdings match the plan.','cycle-exceptions':'The plan\'s orders finished with exceptions.',
   'order-pending':'An order is pending at the broker. Sent is not filled.',armed:'Approved and scheduled.'}[story.key]||story.detail;
  const why={aligned:'The last check found holdings already match the plan.','cycle-complete':'The last check found holdings already match the plan.','order-pending':'',armed:''}[story.key]??story.detail;
  return {chip:'RUNNING',sentence:checked+' '+said,why};
 }
 /** @description A paper account's chip and first sentence: armed is a setting; recorded passes say whether it ran. */
 function paperState(fact,options){
  if(fact.unreadable)return {chip:'UNKNOWN',sentence:'This account\'s ledger could not be read.'};
  if(!fact.opened)return {chip:'NOT STARTED',sentence:'This paper account has not been started.'};
  if(!fact.config.armed)return {chip:'STOPPED',sentence:'This paper account is stopped. It keeps its positions and history.'};
  const result=String(fact.strategy?.lastResult||''),job=options.paperJob,last=stamp(fact.lastScheduledTickAt);
  if(result.startsWith('failed:'))return {chip:'NEEDS YOU',sentence:'Last strategy check failed: '+result.slice(7).trim()};
  if(job&&!(job.activation&&job.status==='active'))return {chip:'NOT RUNNING',sentence:'Armed, but the paper job is '+jobWords(job.activation?job.status:'not-activated')+'. Nothing trades.'};
  if(options.marketOpen===true&&(!last||options.now-Date.parse(last)>FIFTEEN_MINUTES))
   return {chip:'NOT RUNNING',sentence:last?'Armed, but no scheduled pass has been recorded since '+clockWords(last,options)+'.':'Armed, but no scheduled pass has been recorded.'};
  const outcome=fact.lastTick?.outcome==='traded'?'traded':'no trade';
  return {chip:'RUNNING',sentence:(last?'Last scheduled pass '+clockWords(last,options)+': '+outcome+'.':'No scheduled pass is recorded yet.')+(options.marketOpen===false?' Waiting for the market to open.':'')};
 }

 /**
  * @description One connected account's card from its saved facts.
  * @param {object} fact One entry of GET /paper/today `connected`.
  * @param {{now:number,latestSession:string|null,watcher:object|null,format?:Function}} options The clock, the last completed session, the watcher job row and an optional time formatter.
  * @returns {object} Chips, sentences, the plan, today and value parts with their sources and times, and one next step.
  */
 function connected(fact,options){
  const state=connectedState(fact,options),approval=fact.monitor?.approval,intro=[];
  if(fact.strategy?.name)intro.push('Runs "'+fact.strategy.name+'".');
  intro.push(state.sentence);
  if(approval&&fact.monitor.automatedTrading)intro.push(approval.active&&approval.expiresAt?'Approval active until '+dayWords(approval.expiresAt)+' (as of the '+clockWords(approval.asOf,options)+' check).'
   :'Approval: '+approval.status+(approval.asOf?' (as of the '+clockWords(approval.asOf,options)+' check)':'')+'.');
  const today=connectedToday(fact,state,options);
  return {kind:'connected',key:fact.connectionKey+'|'+fact.accountId,accountId:fact.accountId,connectionKey:fact.connectionKey,label:fact.label,tag:'connected account',chip:state.chip,parked:parkedChip(fact.plan),intro,
   parts:[planPart(fact),today,valuePart(fact,options)],next:NEXT[state.chip],link:{label:'Account details',go:'details'},
   trades:Boolean(fact.monitor?.enabled&&fact.monitor?.automatedTrading),sent:today.unknown?null:today.sent||0,filled:today.unknown?null:today.filled||0,
   recorded:finite(fact.value?.now?.equity)?{equity:fact.value.now.equity,at:fact.value.now.at}:null};
 }
 /**
  * @description One paper account's card from its own ledger. It always says the value counts prices only.
  * @param {object} fact One entry of GET /paper/today `paper`.
  * @param {{now:number,marketOpen:boolean|null,paperJob:object|null,format?:Function}} options The clock, whether the market is open, the paper job row and an optional time formatter.
  * @returns {object} Chips, sentences, the plan, today and value parts with their sources and times, and one next step.
  */
 function paper(fact,options){
  const state=paperState(fact,options),reference=fact.ref==='paper',base={kind:'paper',key:'paper|'+fact.ref,ref:fact.ref,label:fact.label,tag:'simulated money',chip:state.chip,sent:0,filled:0,recorded:null};
  if(!fact.opened||fact.unreadable)return {...base,parked:null,intro:[state.sentence,FIXED.basis],parts:[],trades:false,next:reference?{label:'Open account',go:'open'}:{label:'See passes and fills',go:'paper'},link:null};
  const today=paperToday(fact,options);
  return {...base,parked:parkedChip(fact.plan),filled:today.filled,trades:fact.config.armed,
   intro:[fact.strategy?'Runs "'+fact.strategy.name+'" on simulated money.':'Trades by its '+(fact.config.posture||'own')+' posture rules on simulated money.',state.sentence],
   parts:[planPart(fact),today,valuePart(fact,options)],next:{label:'See passes and fills',go:reference?'journal':'paper'},link:reference?{label:'Open account',go:'open'}:null};
 }

 /**
  * @description The headline across every card: is it trading, what happened today, and the recorded value of connected accounts.
  * @param {Array<object>} cards Results of connected() and paper().
  * @param {{format?:Function}} [options] An optional time formatter.
  * @returns {{answer:string,sentence:string,today:string,value:string|null}} The headline in words.
  */
 function headline(cards,options={}){
  const set=cards.filter(c=>c.trades),running=set.filter(c=>c.chip==='RUNNING').length,needs=cards.filter(c=>c.chip==='NEEDS YOU').length;
  const real=cards.filter(c=>c.kind==='connected'),unknown=real.filter(c=>c.sent===null).length,recorded=real.filter(c=>c.recorded);
  const times=recorded.map(c=>c.recorded.at).filter(stamp).sort();
  return {answer:!set.length?'Nothing is set to trade.':running===set.length?'Yes.':running?'Partly.':'No.',
   sentence:(set.length?running+' of '+plural(set.length,'account')+' set to trade '+(running===1?'is':'are')+' running.':'')+(needs?' '+needs+' need'+(needs===1?'s':'')+' you.':''),
   today:plural(real.reduce((n,c)=>n+(c.sent||0),0),'order')+' sent, '+real.reduce((n,c)=>n+(c.filled||0),0)+' filled on connected accounts'+(unknown?' ('+plural(unknown,'account')+' unknown)':'')+'. '
    +plural(cards.filter(c=>c.kind==='paper').reduce((n,c)=>n+(c.filled||0),0),'simulated trade')+'.',
   value:recorded.length?money(recorded.reduce((n,c)=>n+c.recorded.equity,0))+' from each account\'s last check; newest '+clockWords(times.at(-1),options)+', oldest '+clockWords(times[0],options)
    +(recorded.length<real.length?'. '+plural(real.length-recorded.length,'account')+' with no saved value '+(real.length-recorded.length===1?'is':'are')+' not included':'')+'.':null};
 }

 function captionHtml(caption,options,now){
  const at=caption.day?(/^\d{4}-\d{2}-\d{2}/.test(String(caption.at))?String(caption.at).slice(0,10):null):stamp(caption.at);
  // A record that should be current is marked when it is old in market hours; an earlier day's record is old by design.
  const old=!caption.day&&!caption.past&&at&&options.marketOpen===true&&now-Date.parse(at)>FIFTEEN_MINUTES;
  return escape(caption.source)+' · '+(at?'<time datetime="'+escape(at)+'"'+(old?' class="warn"':'')+'>'+escape(caption.day?dayWords(at):clockWords(at,options))+(old?' ('+escape(ago(at,now))+')':'')+'</time>':'time Unknown');
 }
 function partHtml(part,options,now){
  return '<section class="story-part" data-story-part="'+escape(part.title==='The plan'?'plan':part.title.toLowerCase())+'"><h3>'+escape(part.title)+'</h3>'+part.lines.map(line=>'<p>'+escape(line)+'</p>').join('')
   +(part.sum?.length?'<dl class="story-sum">'+part.sum.map(([name,amount])=>'<div><dt>'+escape(name)+'</dt><dd>'+escape(amount)+'</dd></div>').join('')+'</dl>':'')
   +(part.after||[]).map(line=>'<p>'+escape(line)+'</p>').join('')+part.notes.map(note=>'<p class="story-note">'+escape(note)+'</p>').join('')+(part.captions.length?'<p class="story-src">'+(part.captions.length>1?'Sources: ':'Source: ')+part.captions.map(c=>captionHtml(c,options,now)).join('; ')+'</p>':'')+'</section>';
 }
 /**
  * @description Draw one card. Every value is escaped; the only controls are one button and, when there is one, one link.
  * @param {object} card A result of connected() or paper().
  * @param {{now?:number,marketOpen?:boolean|null,format?:Function}} [options] The clock, whether the market is open and an optional time formatter.
  * @returns {string} The card's markup.
  */
 function cardHtml(card,options={}){
  const now=options.now??Date.now(),tone={'RUNNING':'is-running','NEEDS YOU':'is-blocked','NOT RUNNING':'is-blocked'}[card.chip]||'';
  return '<article class="panel story" data-story="'+escape(card.key)+'" data-story-kind="'+escape(card.kind)+'"><header class="story-head"><div><h2>'+escape(card.label)+'</h2><p class="story-tag">'+escape(card.tag)+'</p></div>'
   +'<p class="story-chips"><span class="story-chip '+tone+'">'+escape(card.chip)+'</span>'+(card.parked?'<span class="story-chip">'+escape(card.parked)+'</span>':'')+'</p></header>'
   +card.intro.map(line=>'<p class="story-intro">'+escape(line)+'</p>').join('')+card.parts.map(part=>partHtml(part,options,now)).join('')
   +'<div class="story-actions"><button class="btn primary" data-story-next="'+escape(card.next.go)+'">'+escape(card.next.label)+'</button>'
   +(card.link?'<a href="#" class="story-link" data-story-link="'+escape(card.link.go)+'">'+escape(card.link.label)+'</a>':'')+'</div></article>';
 }
 /**
  * @description Draw the headline above the cards.
  * @param {{answer:string,sentence:string,today:string,value:string|null}} top A result of headline().
  * @returns {string} The headline's markup.
  */
 function headlineHtml(top){
  return '<section class="panel story-top" aria-label="Summary"><p class="story-answer"><span>Is it trading?</span> <strong>'+escape(top.answer)+'</strong> '+escape(top.sentence)+'</p>'
   +'<p><span>Today so far:</span> '+escape(top.today)+'</p>'+(top.value?'<p><span>Recorded value of connected accounts:</span> '+escape(top.value)+'</p>':'')+'</section>';
 }
 const api={connected,paper,headline,cardHtml,headlineHtml,parkedChip,FIXED,RULES};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof globalThis==='object')globalThis.AccountStory=api;
}
