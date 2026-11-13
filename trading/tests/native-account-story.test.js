/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The first screen's words (1.57.0), on invented accounts read through the shipped GET /paper/today: each card says whether the account runs and how much of its plan is the strategy's fallback, with the strategy's own rule; what was sent and filled today and why nothing was; and the change in value as two parts that add up. Every part names its source and the time of its record, a paper card always says its value counts prices only, an unreadable figure reads Unknown, a hostile label is escaped, each card has one button, and no sentence gives advice.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Story=require('../tools/ui/account-story.js');
const {OWNER,createTodayDb,brokerOrder,seedConnected,seedPaper}=require('./support/today-fixtures');
const NOW=new Date('2026-11-12T18:50:00.000Z');
const format=at=>new Date(at).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const options=(out,over={})=>({now:Date.parse(out.asOf),latestSession:out.latestCompletedSession,marketOpen:out.marketOpen,watcher:{status:'active',activation:{}},paperJob:{status:'active',activation:{}},format,...over});
const read=async(seed,now=NOW)=>{const db=createTodayDb();seed(db);return require('../routes/today/read').todayRead({pool:db.pool},OWNER,now);};
const connected=async(over={},opts={},now=NOW)=>{const out=await read(db=>seedConnected(db,over),now);return Story.connected(out.connected[0],options(out,opts));};
const part=(card,title)=>card.parts.find(p=>p.title===title);
const words=card=>[card.label,card.chip,card.parked,...card.intro,...card.parts.flatMap(p=>[...p.lines,...(p.after||[]),...p.notes,...(p.sum||[]).flat()]),card.next.label,card.link?.label].filter(Boolean).join('\n');

test('a running account says it runs, how much of its plan is the fallback, and names the strategy\'s own rule',async()=>{
 const card=await connected();
 assert.deepEqual([card.chip,card.parked,card.trades],['RUNNING','MOSTLY PARKED',true]);
 assert.deepEqual(card.intro,['Runs "Example monthly trend".','The watcher checked it at Nov 12, 1:49 PM, 1 minute ago. Holdings match the plan.','Approval active until Dec 2 (as of the Nov 12, 1:45 PM check).']);
 const plan=part(card,'The plan');
 assert.deepEqual(plan.lines.slice(0,3),['Decided Oct 30, at the month-end. The next decision uses the Nov 30 month-end.','Treasury bills (BIL) 60% · SPY 20% · GLD 20%',
  '2 of this strategy\'s 5 funds are in the plan. The rest of the plan is in BIL, the strategy\'s fallback fund.']);
 assert.match(plan.lines[3],/^Held at the last check: Treasury bills \(BIL\) 59\.8% · SPY 19\.8% · GLD 19\.4% · cash 1%\.$/);
 assert.deepEqual(plan.notes,['This strategy keeps a fund while its latest month-end close is above its ten-month average. The share of a fund that is not is held in BIL.']);
 assert.deepEqual(plan.captions,[{source:'the strategy\'s saved decision',at:'2026-10-30',day:true},{source:'your broker, read by the watcher',at:'2026-11-12T18:45:00.000Z'}]);
 assert.deepEqual(card.next,{label:'See the last check',go:'evidence'});assert.deepEqual(card.link,{label:'Account details',go:'details'});
});

test('the parked chip follows the plan\'s fallback share at its four thresholds, and no plan means no chip',()=>{
 for(const [share,chip] of [[100,'PARKED'],[99.5,'PARKED'],[99.4,'MOSTLY PARKED'],[50,'MOSTLY PARKED'],[49.9,'PARTLY PARKED'],[0.5,'PARTLY PARKED'],[0.4,null],[null,null]])
  assert.equal(Story.parkedChip({fallbackPct:share}),chip,String(share));
 assert.equal(Story.parkedChip(null),null);
});

test('each state has its own chip, sentence and one next step, taken from the status the management page computes',async()=>{
 const cases=[
  [{watch:{enabled:false,stoppedAt:'2026-11-12T15:00:00.000Z'}},{},'STOPPED','Set up this account',/monitor is stopped/],
  [{watch:{lastError:'Synthetic quote failure',lastRunAt:'2026-11-12T18:49:30.000Z'}},{},'NEEDS YOU','See what is waiting',/Last check failed: Synthetic quote failure/],
  [{watch:{automatedTrading:false,mandateId:null}},{},'WATCHING ONLY','Set up this account',/not approved to place strategy orders/],
  [{},{watcher:{status:'suspended',reason:'release'}},'NOT RUNNING','Go to the watcher switch',/Approved, but the watcher job is suspended\. Nothing is being checked\./],
  [{},{watcher:{status:'not-activated'}},'NOT RUNNING','Go to the watcher switch',/Approved, but the watcher job is not switched on\. Nothing is being checked\./],
  [{receipt:{observedAt:'2026-11-12T17:00:00.000Z'}},{},'UNKNOWN','Check this account',/old or its signal session could not be verified/],
  [{receipt:{automation:{status:'order-submitted',mandate:{status:'active',effectiveStatus:'active',expiresAtMs:Date.parse('2026-12-02T15:00:00Z'),terms:{}}}}},{},'RUNNING','See the last check',/An order is pending at the broker\. Sent is not filled\./],
  [{receipt:{automation:{status:'market-closed',mandate:{status:'active',effectiveStatus:'active',expiresAtMs:Date.parse('2026-12-02T15:00:00Z'),terms:{}}}}},{},'RUNNING','See the last check',/Waiting for the regular market session\./],
  [{receipt:{automation:{status:'mandate-inactive',mandate:{status:'stopped'}}}},{},'NEEDS YOU','See what is waiting',/current live approval is stopped/],
  [{},{watcher:null},'RUNNING','See the last check',/checked it at Nov 12, 1:49 PM/],
  [{watch:{lastGuardAt:'2026-11-12T18:00:00.000Z'}},{watcher:null},'UNKNOWN','Check this account',/watcher schedule could not be read/],
 ];
 for(const [over,opts,chip,next,sentence] of cases){
  const card=await connected(over,opts);
  assert.equal(card.chip,chip,JSON.stringify(over));assert.equal(card.next.label,next);assert.match(card.intro.join(' '),sentence);
 }
 const db=createTodayDb(),out=await require('../routes/today/read').todayRead({pool:db.pool},OWNER,NOW);
 const bare=Story.connected({kind:'connected',accountId:'a',connectionKey:'c',label:'Example cash',status:{account:{accountId:'a',connectionKey:'c',strategyId:null},watch:null},monitor:null,plan:null,holdings:null,today:null,value:null},options(out));
 assert.deepEqual([bare.chip,bare.next.label,bare.trades,bare.intro[0]],['NOT SET UP','Set up this account',false,'No strategy is set to run on this account.']);
 assert.deepEqual(part(bare,'The plan').lines,['No plan is recorded for this account.']);assert.deepEqual(part(bare,'Value').lines,['No value is recorded for this account.']);
 // An account the broker lists with no saved record: the page's own read is said as the page's read, never as a record.
 const listed=part(Story.connected({kind:'connected',accountId:'a',connectionKey:'c',label:'Example cash',status:{account:{accountId:'a',connectionKey:'c',strategyId:null},watch:null},monitor:null,plan:null,holdings:null,today:null,value:null,
  live:{equity:1250.5,at:'2026-11-12T18:49:00.000Z'}},options(out)),'Value');
 assert.deepEqual(listed.lines,['No value is recorded for this account.','$1,250.50 at Nov 12, 1:49 PM, read from your broker by this page.']);
 assert.deepEqual(listed.captions,[{source:'your broker, read by this page',at:'2026-11-12T18:49:00.000Z'}]);
});

test('a daily plan says when it is decided, its target cash, and that its market check is off',async()=>{
 const out=await read(db=>{seedConnected(db,{receipt:{signal:{signalAsOf:'2026-11-11',decisionAsOf:'2026-11-11',evidenceThrough:'2026-11-11',rebalanceCadence:'completed-session-daily',
  targets:[{symbol:'SPY',weightPct:15},{symbol:'IEF',weightPct:10}],cashWeightPct:75,marketRiskOn:false}}});});
 const fact=out.connected[0];fact.strategy={...fact.strategy,kind:'retirement-defensive-daily',defensiveGrossPct:35};
 const card=Story.connected(fact,options(out)),plan=part(card,'The plan');
 assert.equal(card.parked,'MOSTLY PARKED');
 assert.deepEqual(plan.lines.slice(0,2),['Decided after the Nov 11 close. It is decided again after each market close.','SPY 15% · IEF 10% · cash 75%']);
 assert.deepEqual(plan.notes,['The strategy\'s market check is off, which limits the plan to 35%. The rest stays in cash.']);
});

test('today says what was sent and by whom, what filled, what is still open, and keeps uncertain attempts apart',async()=>{
 const orders=[brokerOrder('9101','SELL','GLD',4,377.5,'2026-11-12T15:02:00.000Z'),brokerOrder('9102','BUY','BIL',16,91.4,'2026-11-12T15:07:00.000Z'),
  brokerOrder('9104','BUY','SPY',2,680,'2026-11-12T17:00:00.000Z',{status:'REJECTED'}),brokerOrder('9105','BUY','GLD',1,370,'2026-11-12T17:30:00.000Z',{status:'WORKING'})];
 const tickets=[{ticketId:'t1',orderId:'9101',status:'submitted',mandateId:'m'},{ticketId:'t2',orderId:'9102',status:'submitted',protectionMandateId:'p'},{ticketId:'t4',orderId:null,status:'unknown',mandateId:'m'}];
 const card=await connected({receipt:{brokerOrders:orders,nativeTickets:tickets,reportedCash:354.1}}),today=part(card,'Today');
 assert.deepEqual(today.lines,['4 orders sent today: 1 by the strategy, 1 by watcher exits, 2 placed outside OSHAL.',
  '2 fills today: Bought 16 BIL at $91.40 (Nov 12, 10:07 AM); Sold 4 GLD at $377.50 (Nov 12, 10:02 AM).','Of the orders sent today: 1 still working, 1 refused.']);
 assert.deepEqual(today.notes,['1 attempt with an uncertain result. Not counted as sent.']);
 assert.deepEqual(today.captions,[{source:'your broker\'s order list, read by the watcher',at:'2026-11-12T18:45:00.000Z'}]);
 assert.deepEqual([card.sent,card.filled],[4,2]);
 const quiet=part(await connected(),'Today');
 assert.deepEqual(quiet.lines,['No orders sent. The last check found holdings already match the plan.','Last fill: Bought 41 BIL at $91.52 (Nov 3, 10:05 AM).']);
 const unreadable=await connected({receipt:{brokerOrders:null}});
 assert.deepEqual(part(unreadable,'Today').lines,['Unknown. The order list the last check saved could not be read.']);assert.equal(unreadable.sent,null);
});

test('the value is the change and two parts that add up, each with its source and time, and Unknown stays Unknown',async()=>{
 const value=part(await connected(),'Value');
 assert.deepEqual(value.lines,['$31,204.18 at Nov 12, 1:45 PM · down $12.40 since the last record of Nov 11.']);
 assert.deepEqual(value.sum,[['Prices of what it holds','-$14.90'],['Cash in or out, other than trades','+$2.50']]);
 assert.equal(value.notes[0],'Interest, dividends, fees, deposits and withdrawals are not listed one by one in saved records. They are inside the second line.');
 assert.match(value.notes[1],/^Since purchase, price only: BIL -\$3\.10 · SPY \+\$120\.44 · GLD -\$18\.02\. This counts price change on what is held now\. It leaves out closed trades and cash paid out\.$/);
 assert.deepEqual(value.captions,[{source:'your broker, read by the watcher',at:'2026-11-12T18:45:00.000Z'},{source:'OSHAL\'s saved daily record',at:'2026-11-12T04:55:00.000Z',past:true}]);
 const noCash=part(await connected({receipt:{reportedCash:null}}),'Value');
 assert.deepEqual(noCash.sum,[]);assert.match(noCash.notes[0],/^The split is unknown: a cash figure is missing\.$/);
 const first=part(await connected({receipt:{observedAt:'2026-11-11T18:45:00.000Z'},watch:{lastGuardAt:'2026-11-11T18:49:00.000Z'}},{},new Date('2026-11-11T18:50:00.000Z')),'Value');
 assert.deepEqual(first.lines,['$31,204.18 at Nov 11, 1:45 PM.','No earlier record to compare with. The first one is saved by the watcher\'s next check.']);
 const interest=await read(db=>seedConnected(db));interest.connected[0].interest={accrued:4.25,at:'2026-11-12T18:45:00.000Z'};
 assert.ok(part(Story.connected(interest.connected[0],options(interest)),'Value').notes.includes('Margin interest the broker has accrued so far: $4.25.'));
});

test('a paper card says it is simulated, why it did not trade today, and that its value counts prices only',async()=>{
 const out=await read(db=>{seedPaper(db,'paper',{strategy:false});seedPaper(db,'example-paper');});
 const [reference,named]=out.paper.map(fact=>Story.paper(fact,options(out)));
 assert.deepEqual([named.tag,named.chip,named.parked,named.trades],['simulated money','RUNNING','PARKED',true]);
 assert.deepEqual(named.intro,['Runs "Example monthly trend" on simulated money.','Last scheduled pass Nov 12, 1:45 PM: no trade.']);
 assert.deepEqual(part(named,'The plan').lines.slice(1,3),['Treasury bills (BIL) 100%','None of this strategy\'s 5 funds is in the plan. The whole plan is in BIL, the strategy\'s fallback fund.']);
 assert.deepEqual(part(named,'Today').lines,['No simulated trades. This account trades when the monthly decision changes. The other passes only re-price what it holds.',
  'Last trade: Bought 1092 BIL at $91.52 (Nov 3, 10:05 AM), Strategy rebalance: Example monthly trend.','2 passes recorded today.']);
 const value=part(named,'Value');
 assert.deepEqual(value.lines,['$99,868.96 at Nov 12, 1:45 PM · down $41.50 since the record of Nov 11.']);
 assert.ok(part(named,'The plan').lines.includes('Held in the ledger: Treasury bills (BIL) 99.9% · cash 0.1%.'));
 assert.deepEqual(value.after,['Since it started on Oct 28 with $100,000.00: down $131.04 (-0.13%).'],'the result since the start is said after the sum, so the sum reads against the change above it');
 assert.deepEqual(value.sum,[['Prices of what it holds','-$41.50'],['Modeled trading costs','$0.00']]);
 assert.equal(value.notes.at(-1),'This simulation counts prices only. It does not add the interest or dividends a fund pays, so a fund that pays out each month reads lower here than in a brokerage account.');
 assert.deepEqual(value.captions,[{source:'this simulation\'s ledger',at:'2026-11-12T18:45:00.000Z'}]);
 assert.deepEqual([named.next,named.link],[{label:'See passes and fills',go:'paper'},null]);
 assert.deepEqual(part(reference,'The plan').lines[0],'No plan is recorded for this account. It trades by its posture rules.');
 assert.deepEqual([reference.intro[0],reference.next,reference.link],['Trades by its balanced posture rules on simulated money.',{label:'See passes and fills',go:'journal'},{label:'Open account',go:'open'}]);
});

test('a paper account that is armed but not running, stopped, failed or never started says so',async()=>{
 const out=await read(db=>seedPaper(db,'example-paper')),fact=out.paper[1],state=(change,opts={})=>Story.paper({...fact,...change},options(out,opts));
 assert.deepEqual([state({},{paperJob:{status:'suspended',activation:{}}}).chip,state({},{paperJob:{status:'suspended',activation:{}}}).intro[1]],['NOT RUNNING','Armed, but the paper job is suspended. Nothing trades.']);
 assert.equal(state({},{paperJob:{status:'active'}}).intro[1],'Armed, but the paper job is not switched on. Nothing trades.');
 assert.equal(state({lastScheduledTickAt:'2026-11-12T17:00:00.000Z'}).intro[1],'Armed, but no scheduled pass has been recorded since Nov 12, 12:00 PM.');
 assert.equal(state({},{marketOpen:false}).intro[1],'Last scheduled pass Nov 12, 1:45 PM: no trade. Waiting for the market to open.');
 assert.deepEqual([state({config:{...fact.config,armed:false}}).chip,state({config:{...fact.config,armed:false}}).trades],['STOPPED',false]);
 assert.deepEqual([state({strategy:{...fact.strategy,lastResult:'failed: No fresh current price for BIL.'}}).chip,state({strategy:{...fact.strategy,lastResult:'failed: No fresh current price for BIL.'}}).intro[1]],
  ['NEEDS YOU','Last strategy check failed: No fresh current price for BIL.']);
 const idle=Story.paper(out.paper[0],options(out));
 assert.deepEqual([idle.chip,idle.intro,idle.next,idle.parts.length],['NOT STARTED',['This paper account has not been started.',Story.FIXED.basis],{label:'Open account',go:'open'},0]);
});

test('the headline answers whether it is trading, what happened today, and the recorded value with its times',async()=>{
 const out=await read(db=>{seedConnected(db);seedPaper(db,'example-paper');}),o=options(out);
 const cards=[Story.connected(out.connected[0],o),...out.paper.map(fact=>Story.paper(fact,o))];
 assert.deepEqual(Story.headline(cards,o),{answer:'Yes.',sentence:'2 of 2 accounts set to trade are running.',today:'0 orders sent, 0 filled on connected accounts. 0 simulated trades.',
  value:'$31,204.18 from each account\'s last check; newest Nov 12, 1:45 PM, oldest Nov 12, 1:45 PM.'});
 const stalled=[Story.connected(out.connected[0],options(out,{watcher:{status:'suspended'}})),Story.paper(out.paper[1],o)];
 assert.deepEqual([Story.headline(stalled,o).answer,Story.headline(stalled,o).sentence],['Partly.','1 of 2 accounts set to trade is running.']);
 assert.equal(Story.headline([Story.paper(out.paper[0],o)],o).answer,'Nothing is set to trade.');
 const blocked=await connected({watch:{lastError:'Synthetic failure',lastRunAt:'2026-11-12T18:49:30.000Z'}});
 assert.deepEqual([Story.headline([blocked],o).answer,Story.headline([blocked],o).sentence],['No.','0 of 1 account set to trade are running. 1 needs you.']);
});

test('the drawn card names a source and a time for every part, has one button, escapes a hostile label and carries no MONEY control',async()=>{
 const out=await read(db=>{seedConnected(db);seedPaper(db,'example-paper');}),o=options(out);
 const fact={...out.connected[0],label:'<img src=x onerror=bad>'},card=Story.connected(fact,o),html=Story.cardHtml(card,o);
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img src=x onerror=bad&gt;/);
 for(const name of ['plan','today','value']){
  const section=html.slice(html.indexOf('data-story-part="'+name+'"'));
  assert.match(section.slice(0,section.indexOf('</section>')),/<p class="story-src">Sources?: [^<]+ · <time datetime="[^"]+"/,name+' names its source and time');
 }
 assert.equal((html.match(/<button/g)||[]).length,1);assert.equal((html.match(/<a /g)||[]).length,1);
 assert.match(html,/<button class="btn primary" data-story-next="evidence">See the last check<\/button>/);
 assert.doesNotMatch(html,/data-native-management|data-lp=|data-np=|data-portfolio-action|data-act=/);
 const paper=Story.cardHtml(Story.paper(out.paper[1],o),o);
 assert.match(paper,/This simulation counts prices only\./);assert.equal((paper.match(/<button/g)||[]).length,1);
 const late=Story.cardHtml(card,{...o,now:o.now+40*60000});
 assert.match(late,/<time datetime="2026-11-12T18:45:00\.000Z" class="warn">Nov 12, 1:45 PM \(45 minutes ago\)<\/time>/,'an old record is marked during market hours');
 assert.match(html,/Sources: your broker, read by the watcher · <time datetime="2026-11-12T18:45:00\.000Z">Nov 12, 1:45 PM<\/time>; OSHAL&#39;s saved daily record · <time datetime="2026-11-12T04:55:00\.000Z">Nov 11, 11:55 PM<\/time>/,
  'the earlier day\'s record is listed with its own time and is not marked as stale');
 assert.match(Story.headlineHtml(Story.headline([card],o)),/<span>Is it trading\?<\/span> <strong>Yes\.<\/strong>/);
});

test('no sentence on any card tells the person what to buy, sell, hold or change',async()=>{
 const out=await read(db=>{seedConnected(db);seedPaper(db,'paper',{strategy:false});seedPaper(db,'example-paper');}),o=options(out);
 const cards=[Story.connected(out.connected[0],o),...out.paper.map(fact=>Story.paper(fact,o)),await connected({watch:{enabled:false}}),await connected({receipt:{brokerOrders:null}}),
  await connected({},{watcher:{status:'suspended'}})];
 const text=cards.map(words).join('\n')+Object.values(Story.FIXED).join('\n')+Object.values(Story.RULES).join('\n')+Object.values(Story.headline(cards,o)).join('\n');
 assert.doesNotMatch(text,/\b(should|recommend|advise|advice|consider|good time|bad time|buy now|sell now|you ought|must buy|must sell|better off|worth buying|worth selling)\b/i);
});
