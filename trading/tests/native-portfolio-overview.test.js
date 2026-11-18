/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The approval notice (coordinator's added scope): an approval ending within 14 days warns with the days left; one ending before the account's next trade (the market day after the Nov 30 month-end decision, or the next market day for a daily plan) says so; one ending after both is a plain date; an ended one says it ended; none, or one off for another reason, says nothing. The read names the next two months of market days.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The portfolio overview's read and arithmetic (1.58.0), on invented accounts. GET /paper/values is a registered read that refuses a caller who is not admitted, sends its one SELECT and nothing else, calls no kernel intent and stays outside the order-authority set; it groups each account's days, keeps the later record of a day, skips a row it cannot read and never answers another person's rows. The arithmetic lays values on market days and leaves a missing day as a gap (no bar across it, no line through it), handles a single day, cuts ranges back from the newest day (month ends included), adds accounts only on the days every one is recorded, counts percent from the first value in a range, and reads benchmark closes without guessing between two.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Retain the exact legacy closure and prove overview reads, arithmetic and charts join no supported order-authority version.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTodayDb}=require('./support/today-fixtures');
const F=require('./support/overview-fixtures');
const S=require('../tools/ui/portfolio-series.js');
const C=require('../tools/ui/portfolio-charts.js');
const ROOT=path.resolve(__dirname,'..');
const routes=()=>require('../routes/trading-paper-routes');
const values=()=>require('../routes/today/values');
const read=(db,owner=F.OWNER,now=F.NOW)=>values().valuesRead({pool:db.pool},owner,now);
const p=(day,equity,at=day+'T20:55:00.000Z')=>({day,at,equity});

test('GET /paper/values is a registered read that refuses a caller who is not admitted',async()=>{
 const db=createTodayDb(),registered=[],router={};
 for(const method of ['get','post'])router[method]=(route,handler)=>registered.push({method,route,handler});
 routes().createTradingPaperRoutes({pool:db.pool},()=>router);
 const route=registered.find(r=>r.method==='get'&&r.route==='/values');
 assert.ok(route,'GET /values is mounted on the paper router');
 const answer=req=>new Promise(resolve=>{const res={status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};route.handler(req,res);});
 assert.equal((await answer({headers:{}})).status,401);
 assert.equal(db.log.length,0,'nothing is read for a caller who is not admitted');
 const ok=await answer({oshalCallerSub:F.OWNER,headers:{}});
 assert.equal(ok.status,200);assert.equal(ok.body.ok,true);assert.deepEqual(ok.body.accounts,[]);assert.deepEqual(ok.body.sessions,[]);
});

test('the read sends its one SELECT, calls no kernel intent, and none of its files can write or reach a broker',async()=>{
 const db=createTodayDb(),intents=[];F.seedPortfolio(db);
 const ctx={pool:db.pool,intent:async name=>{intents.push(name);throw new Error('the values read must not call '+name);}};
 const out=await routes().paperHandlers(ctx,()=>F.NOW).values({oshalCallerSub:F.OWNER,headers:{}});
 assert.equal(out.status,200);assert.equal(out.body.accounts.length,3);
 assert.deepEqual(db.log,[values().SQL.VALUES_ALL],'exactly one statement, the declared SELECT');
 assert.match(values().SQL.VALUES_ALL,/^SELECT [a-z_, ]+ FROM trading_account_values WHERE user_sub=\$1 AND observed_day>=\$2 LIMIT 9500$/);
 assert.doesNotMatch(values().SQL.VALUES_ALL,/ORDER BY|DISTINCT|GROUP BY/,'no whole-table sort in the kernel: rows are sorted in the package');
 assert.deepEqual(intents,[],'no broker, price or order service is reached');
 for(const file of ['routes/today/values.js','tools/ui/portfolio-series.js','tools/ui/portfolio-charts.js','tools/ui/view-overview.js'])
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT,file),'utf8'),/\.intent\s*\(|trading\.orders\.|INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM|saveRecord|removeRecord|method:\s*'(POST|PUT|PATCH|DELETE)'|jbody\(/,file+' reads only');
});

test('each account\'s days come back oldest first, one per day, the later record winning; unreadable rows and other people\'s rows never appear',async()=>{
 const db=createTodayDb(),a=F.ACCOUNT;
 db.value(F.OWNER,a,'2026-11-12','2026-11-12T15:00:00.000Z',100,1);
 db.value(F.OWNER,a,'2026-11-12','2026-11-12T18:00:00.000Z',101,1);
 db.value(F.OWNER,a,'2026-11-10','2026-11-10T20:55:00.000Z',99,null);
 db.value(F.OWNER,a,'2026-11-11','not a time',98,1);
 db.value(F.OWNER,a,'2026-11-09','2026-11-09T20:55:00.000Z','NaN',1);
 db.value(F.OWNER,a,'2026-11-0x','2026-11-09T20:55:00.000Z',97,1);
 db.value('someone-else',a,'2026-11-11','2026-11-11T20:55:00.000Z',5000,1);
 const out=await read(db);
 assert.equal(out.accounts.length,1);
 assert.deepEqual(out.accounts[0],{accountId:a.accountId,connectionKey:a.connectionKey,points:[{day:'2026-11-10',at:'2026-11-10T20:55:00.000Z',equity:99,cash:null},{day:'2026-11-12',at:'2026-11-12T18:00:00.000Z',equity:101,cash:1}]});
 assert.equal(out.skipped,3,'a row with no time, no figure or no date is skipped, never guessed');
 assert.deepEqual([out.today,out.from,out.cut],['2026-11-12','2023-11-08',false]);
 assert.deepEqual(out.sessions,['2026-11-10','2026-11-11','2026-11-12'],'the sessions run from the first recorded day to today');
 assert.deepEqual([out.upcoming[0],out.upcoming.includes('2026-11-26'),out.upcoming.includes('2026-12-01'),out.upcoming.at(-1)],['2026-11-12',false,true,'2027-01-13'],'the next two months of market days, Thanksgiving left out');
 assert.match(out.basis,/not a return: deposits and withdrawals move it too/);
});

test('the sessions come from the verified calendar, and a span it does not cover is said as null; a full answer is marked cut',async()=>{
 const db=createTodayDb();
 db.value(F.OWNER,F.ACCOUNT,'2028-01-03','2028-01-03T20:55:00.000Z',100,1);
 assert.equal((await read(db,F.OWNER,new Date('2028-01-04T15:00:00Z'))).sessions,null,'2028 is outside the verified calendar');
 const sessions=(await read(createTodayDb())).sessions;assert.deepEqual(sessions,[]);
 const big={query:async()=>({rows:Array.from({length:values().LIMITS.rows},(_,i)=>({connection_key:'k',account_id:'a'+(i%9),observed_day:'2026-11-1'+(i%3),observed_at:'2026-11-10T20:00:00Z',equity:1,cash:1}))})};
 assert.equal((await values().valuesRead({pool:big},F.OWNER,F.NOW)).cut,true);
 const thanks=(await read((()=>{const d=createTodayDb();F.seedPortfolio(d);return d;})())).sessions;
 assert.equal(thanks.includes('2026-11-26'),false,'Thanksgiving is not a session');assert.equal(thanks[0],F.FIRST_DAY);
});

test('a day with no record is a gap: no line through it and no bar on it or after it',()=>{
 const sessions=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
 const series=S.accountSeries([p('2026-11-02',100),p('2026-11-03',110),p('2026-11-05',99),p('2026-11-06',101.5)],sessions);
 assert.deepEqual(series.map(x=>x.value),[100,110,null,99,101.5],'the missing day stays null, never filled');
 assert.deepEqual(S.dailyChanges(series).map(c=>c.change),[null,10,null,null,2.5],'no bar on the gap, none bridging it');
 assert.deepEqual(S.dailyChanges(series)[1].pct,10);
 assert.deepEqual(C.runs(series.map(x=>x.value)),[[0,1],[3,4]],'the line breaks at the gap');
 const svg=C.valueChart(series,{width:600,chart:'t',label:'x'});
 assert.equal((svg.match(/<polyline /g)||[]).length,2,'two line runs');
 const bars=C.barsChart(S.dailyChanges(series),{width:600,chart:'t',label:'x'});
 assert.equal((bars.match(/data-pf-sign="up"/g)||[]).length,2);assert.equal((bars.match(/class="details-loss-bar"/g)||[]).length,0);
 const down=C.barsChart([{day:'a',change:null},{day:'b',change:-3},{day:'c',change:0}],{width:300,chart:'t',label:'x'});
 assert.match(down,/class="details-loss-bar" data-pf-sign="down"/);assert.match(down,/class="pf-flat-bar" data-pf-sign="flat"/);
});

test('records on days that are not market days stay off the grid; without a calendar Monday to Friday is used',()=>{
 const pts=[p('2026-11-06',100),p('2026-11-07',100.5),p('2026-11-09',103)];
 assert.deepEqual(S.accountSeries(pts,['2026-11-06','2026-11-09']).map(x=>[x.day,x.value]),[['2026-11-06',100],['2026-11-09',103]]);
 assert.deepEqual(S.dailyChanges(S.accountSeries(pts,['2026-11-06','2026-11-09'])).map(c=>c.change),[null,3],'Monday counts from Friday');
 assert.deepEqual(S.accountSeries(pts,null).map(x=>x.day),['2026-11-06','2026-11-09'],'weekdays without the calendar');
 assert.deepEqual(S.expectedDays('2026-11-25','2026-11-30',null),['2026-11-25','2026-11-26','2026-11-27','2026-11-30']);
 assert.deepEqual(S.accountSeries([p('2026-11-07',5)],['2026-11-06','2026-11-09']),[],'only a weekend record: nothing on the grid');
});

test('a single recorded day is a value with no change and no trend',()=>{
 const v=S.overview({accounts:[{accountId:'a',connectionKey:'k',points:[p('2026-11-12',500)]}],sessions:['2026-11-12']},'1M');
 assert.equal(v.total.latest.value,500);assert.equal(v.total.day.change,null);
 assert.deepEqual([v.total.span.change,v.total.span.pct],[null,null]);
 assert.deepEqual(v.accounts[0].percent,{base:'2026-11-12',points:[{day:'2026-11-12',pct:0}]});
 assert.deepEqual(v.compareDays,['2026-11-12']);
});

test('ranges are cut back from the newest day, month ends included, and a range longer than the history says when it starts',()=>{
 assert.deepEqual(['1W','1M','3M','YTD','1Y','ALL'].map(r=>S.rangeStart('2026-11-12',r)),['2026-11-05','2026-10-12','2026-08-12','2026-01-01','2025-11-12',null]);
 assert.equal(S.rangeStart('2026-03-31','1M'),'2026-02-28');assert.equal(S.rangeStart('2026-05-31','3M'),'2026-02-28');
 assert.equal(S.rangeStart('2024-02-29','1Y'),'2023-02-28');assert.equal(S.rangeStart('2026-01-15','1M'),'2025-12-15');
 const db=F.historyDays().sessions,series=S.accountSeries(db.map(d=>p(d,100)),db);
 assert.deepEqual(S.coverage(series,S.rangeStart('2026-11-12','1M'),db),{starts:F.FIRST_DAY,short:true},'1M reaches back to Oct 12; the history starts Oct 13');
 assert.deepEqual(S.coverage(series,S.rangeStart('2026-11-12','1W'),db),{starts:F.FIRST_DAY,short:false});
 assert.deepEqual(S.coverage([{day:'2026-10-12',value:1}],'2026-10-10',['2026-10-12']),{starts:'2026-10-12',short:false},'a range that starts on the weekend before the first market day is not short');
 assert.deepEqual(S.coverage(series,'2026-10-10',db),{starts:F.FIRST_DAY,short:true},'Monday Oct 12 was a market day with no record');
 const week=S.inRange(series,S.rangeStart('2026-11-12','1W'));assert.deepEqual(week.map(x=>x.day),['2026-11-05','2026-11-06','2026-11-09','2026-11-10','2026-11-11','2026-11-12']);
});

test('the total adds the accounts only on the days every one of them is recorded',()=>{
 const sessions=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
 const a=S.accountSeries([p('2026-11-02',100),p('2026-11-03',101),p('2026-11-04',102),p('2026-11-05',103),p('2026-11-06',104)],sessions);
 const b=S.accountSeries([p('2026-11-03',50),p('2026-11-05',52),p('2026-11-06',53)],sessions);
 const c=S.accountSeries([p('2026-11-02',10.1),p('2026-11-03',10.2),p('2026-11-04',10.3),p('2026-11-05',10.4)],sessions);
 const total=S.totalSeries([a,b,c]);
 assert.deepEqual(total.map(x=>[x.day,x.value]),[['2026-11-03',161.2],['2026-11-04',null],['2026-11-05',165.4]],'starts when every account has begun; a missing account is a gap; stops after the last day all are recorded');
 assert.deepEqual(S.dailyChanges(total).map(c=>c.change),[null,null,null]);
 const v=S.overview({accounts:[{accountId:'a',connectionKey:'k',points:a.map(x=>p(x.day,x.value))},{accountId:'c',connectionKey:'k',points:c.map(x=>p(x.day,x.value))}],sessions},'ALL');
 assert.deepEqual(v.lagging,['k|c'],'an account that stops before the newest day is named');assert.equal(v.total.latest.day,'2026-11-05');
 assert.equal(v.total.latest.value,113.4);
});

test('percent counts from the first recorded value in the range; a benchmark from its first close on or after the comparison\'s first day',()=>{
 const series=[{day:'d1',value:null},{day:'d2',value:200},{day:'d3',value:210},{day:'d4',value:null},{day:'d5',value:190}];
 assert.deepEqual(S.percentSeries(series),{base:'d2',points:[{day:'d1',pct:null},{day:'d2',pct:0},{day:'d3',pct:5},{day:'d4',pct:null},{day:'d5',pct:-5}]});
 assert.deepEqual(S.spanChange(series),{first:series[1],last:series[4],change:-10,pct:-5});
 const closes=new Map([['d2',50],['d3',55],['d5',45]]);
 assert.deepEqual(S.benchmarkSeries(closes,['d1','d2','d3','d4','d5']).points.map(x=>x.pct),[null,0,10,null,-10]);
 assert.equal(S.benchmarkSeries(null,['d1']),null);assert.equal(S.benchmarkSeries(new Map([['x',1]]),['d1']),null);
 const v=S.overview({accounts:[{accountId:'a',connectionKey:'k',points:[p('2026-11-03',100),p('2026-11-04',110)]},{accountId:'b',connectionKey:'k',points:[p('2026-11-02',40),p('2026-11-04',30)]}],sessions:['2026-11-02','2026-11-03','2026-11-04']},'1M');
 assert.deepEqual(v.compareDays,['2026-11-02','2026-11-03','2026-11-04'],'the comparison runs from the earliest first value');
 assert.deepEqual(v.accounts.map(a=>[a.key,a.span.pct]),[['k|a',10],['k|b',-25]]);
});

test('benchmark closes are read from candles or the archive line, and a day with two different closes is not guessed',()=>{
 const t=day=>Date.parse(day+'T05:00:00Z')/1000;
 assert.deepEqual([...S.closesOf({bars:[{t:t('2026-11-03'),c:600},{t:t('2026-11-04'),c:0},{t:t('2026-11-05'),c:'x'},{t:t('2026-11-06'),c:610}]}).entries()],[['2026-11-03',600],['2026-11-06',610]]);
 assert.deepEqual([...S.closesOf({bars:[],line:[{t:t('2026-11-03'),v:91.5}]}).entries()],[['2026-11-03',91.5]]);
 assert.equal(S.closesOf({bars:[{t:t('2026-11-03'),c:600},{t:t('2026-11-03')+3600,c:601}]}),null);
 assert.equal(S.closesOf({error:'schwab_market_data_unavailable'}),null);assert.equal(S.closesOf(null),null);
});

test('the invented portfolio: the total, today\'s change and the gap day follow from the saved rows',async()=>{
 const db=createTodayDb();F.seedPortfolio(db);
 const out=await read(db),v=S.overview(out,'1M');
 assert.deepEqual(v.accounts.map(a=>a.key).sort(),[F.ACCOUNT,F.IRA,F.CASH].map(a=>a.connectionKey+'|'+a.accountId).sort());
 const sum=day=>Math.round(([F.ACCOUNT,F.IRA,F.CASH].reduce((n,a)=>n+F.valueOn(a,day),0))*100)/100;
 assert.equal(v.total.latest.day,F.TODAY);assert.equal(v.total.latest.value,sum(F.TODAY));
 assert.equal(v.total.day.change,Math.round((sum(F.TODAY)-sum('2026-11-11'))*100)/100);
 assert.equal(v.total.points.find(x=>x.day===F.GAP_DAY).value,null,'the cash account misses Nov 5, so the total has a gap that day');
 assert.equal(v.total.points.some(x=>x.day===F.SATURDAY),false,'a Saturday record is not a market day');
 assert.equal(v.total.coverage.short,true);assert.equal(v.total.coverage.starts,F.FIRST_DAY);
 assert.deepEqual(v.lagging,[]);
 for(const r of ['1W','1M','3M','YTD','1Y','ALL'])assert.ok(S.overview(out,r).total.points.length>=6,r+' draws');
});

test('none of the overview\'s files joins the order-authority set, and the manifest sources are unchanged',()=>{
 const authority=require('./support/order-authority');
 const excluded=['routes/today/values.js','routes/today/read.js','routes/trading-paper-routes.js',
  'tools/ui/view-overview.js','tools/ui/portfolio-series.js','tools/ui/portfolio-charts.js'];
 for(const [version,sources] of Object.entries(authority.preservedLegacy(ROOT))){
  const seen=authority.closure(ROOT,sources);
  for(const file of excluded){assert.ok(fs.existsSync(path.join(ROOT,file)),file+' exists');assert.ok(!seen.has(file),file+' is outside version '+version);}
 }
});

test('an approval\'s end date: within 14 days it warns, before the next trade it says so, after both it is a plain date, and none says nothing',()=>{
 const now=F.NOW.getTime(),upcoming=require('../routes/trading-portfolio-calendar').sessionDates('2026-11-12','2027-01-13'),monthly={cadence:'monthly',nextDecisionUses:'2026-11-30'},daily={cadence:'daily'};
 const o={now,upcoming,latestSession:'2026-11-11'},active=expiresAt=>({status:'active',active:true,expiresAt});
 assert.deepEqual(S.approvalNotice(active(F.MARGIN_APPROVAL_ENDS),monthly,o),{endDay:'2026-11-30',nextTrade:'2026-12-01',daysLeft:18,reason:'before-trade',warn:true,text:'Approval ends Nov 30, before the Dec 1 trade.'},'18 days away, but before the trade the Nov 30 decision makes');
 assert.deepEqual(S.approvalNotice(active('2026-11-20T15:00:00.000Z'),daily,o),{endDay:'2026-11-20',nextTrade:'2026-11-12',daysLeft:8,reason:'soon',warn:true,text:'Approval ends Nov 20, in 8 days.'},'within 14 days, after the next daily trade');
 assert.equal(S.approvalNotice(active('2026-11-12T23:00:00.000Z'),daily,o).text,'Approval ends Nov 12, today.');
 assert.equal(S.approvalNotice(active('2026-11-13T23:00:00.000Z'),daily,o).text,'Approval ends Nov 13, tomorrow.');
 assert.deepEqual(S.approvalNotice(active('2026-12-02T15:00:00.000Z'),monthly,o),{endDay:'2026-12-02',nextTrade:'2026-12-01',daysLeft:20,reason:null,warn:false,text:'Approval ends Dec 2.'},'after the next trade and more than 14 days away');
 assert.equal(S.approvalNotice(active('2026-11-26T15:00:00.000Z'),monthly,o).reason,'before-trade','within 14 days and before the trade: the trade is named');
 assert.deepEqual(S.approvalNotice({status:'expired',active:false,expiresAt:'2026-11-10T15:00:00.000Z'},monthly,o),{endDay:'2026-11-10',nextTrade:null,daysLeft:-2,reason:'ended',warn:true,text:'Approval ended Nov 10.'});
 assert.equal(S.approvalNotice(null,monthly,o),null,'no approval');
 assert.equal(S.approvalNotice({status:'not-enabled',active:false},monthly,o),null,'no end date');
 assert.equal(S.approvalNotice({status:'stopped',active:false,expiresAt:'2026-12-20T15:00:00.000Z'},monthly,o),null,'off for another reason: the status tab explains it');
 assert.equal(S.approvalNotice(active('2026-12-20T15:00:00.000Z'),null,o).warn,false,'no plan: no trade day is named');
 assert.equal(S.nextSession('2026-11-25',upcoming),'2026-11-27','the next market day skips Thanksgiving');
 assert.equal(S.nextSession('2027-01-13',upcoming),'2027-01-14','past the named days: Monday to Friday');
 assert.equal(new Date(S.sessionOpenMs('2026-12-01')).toISOString(),'2026-12-01T14:30:00.000Z');assert.equal(new Date(S.sessionOpenMs('2026-07-01')).toISOString(),'2026-07-01T13:30:00.000Z');
});
