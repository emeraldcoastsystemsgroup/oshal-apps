/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Combined causal allocation/trailing-stop research with frozen targets, bounded allocation fills and preserved stop floors. No brokerage I/O.
 */
'use strict';
const {PortfolioError}=require('../trading-portfolio-model');
const {sessionDates,validDay}=require('../trading-portfolio-calendar');
const {normalizePortfolioStrategy,portfolioNextTargets}=require('../trading-portfolio-sim');
const {portfolioStrategySymbols,portfolioWarmupSessions}=require('../trading-portfolio-rotation');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fail=message=>{throw new PortfolioError(422,'combined_model_invalid',message);};
const CLOSE_EPS=1e-7;
/** The same completed-session target generator is used by live allocation reviews. */
function prepare(raw,input,trailPct){
 const strategy=normalizePortfolioStrategy(raw);
 if(strategy.fractionalShares||strategy.grossExposurePct>100)fail('This combined version models whole-share, cash-funded purchases. Borrowing entry and fractional stops require a separate supported model.');
 if(trailPct!==null&&(!finite(trailPct)||trailPct<0.5||trailPct>50))fail('Use a trail from 0.5% to 50%, or null for the allocation-only comparator.');
 validDay(input.startDate);validDay(input.endDate);
 if(input.startDate>=input.endDate||!finite(input.startingCapital)||input.startingCapital<100)fail('Choose an ordered study window and measured starting equity of at least $100.');
 const sessions=sessionDates(input.startDate,input.endDate);
 if(sessions.length<60)fail('At least 60 complete study sessions are required.');
 const extra=input.initialBook?.positions??[];
 if(!Array.isArray(extra)||extra.length>200||new Set(extra.map(p=>p?.symbol)).size!==extra.length||extra.some(p=>!p||typeof p.symbol!=='string'||!Number.isSafeInteger(p.quantity)||p.quantity<1))fail('Initial holdings must be distinct, positive whole-share positions.');
 const symbols=[...new Set([...portfolioStrategySymbols(strategy),'SPY','DIA',...extra.map(p=>p.symbol)])];
 const maps=new Map(),closes={};
 for(const symbol of symbols){
  const rows=input.series?.[symbol];if(!Array.isArray(rows)||rows.length>10000)fail(symbol+': complete daily OHLC history is required.');
  const map=new Map();
  for(const r of rows){
   validDay(r?.date);if(r.date>input.endDate)continue;
   if(map.has(r.date)||!['open','high','low','close'].every(k=>finite(r[k])&&r[k]>0)||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)||r.high<r.low)fail(symbol+': invalid or duplicate OHLC observation.');
   map.set(r.date,r);
  }
  maps.set(symbol,map);closes[symbol]=[...map.values()].map(r=>({date:r.date,close:r.close}));
 }
 const earliest=[...maps.get('SPY').keys()].sort()[0];
 if(!earliest||earliest>=sessions[0])fail('A prior completed signal session is required.');
 const calendar=sessionDates(earliest,input.endDate),first=calendar.indexOf(sessions[0]),warmup=Math.max(1,portfolioWarmupSessions(strategy));
 if(first<warmup)fail('Complete strategy warmup before the first fill session is required.');
 for(const [symbol,map]of maps)if(calendar.slice(first-warmup).some(day=>!map.has(day)))fail(symbol+': a required exchange session is missing.');
 const limit=input.dailyAllocationNotionalLimitUsd??1000000;
 if(!finite(limit)||limit<1||limit>2000000)fail('Use an explicit daily allocation fill limit between $1 and $2 million.');
 return{strategy,sessions,calendar,first,maps,closes,limit,extra};
}
function performance(curve,startingEquity){
 let peak=startingEquity,maxDrawdownPct=0;
 for(const point of curve){peak=Math.max(peak,point.equity);maxDrawdownPct=Math.max(maxDrawdownPct,(1-point.equity/peak)*100);}
 return{totalReturnPct:(curve.at(-1).equity/startingEquity-1)*100,maxDrawdownPct};
}
/**
 * Open gaps hit the previous stop before any allocation. Allocation targets use only prior
 * closes. Intraday lows test the prior floor; the high raises only tomorrow's floor.
 * A stop aborts the pending allocation cycle. Reentry waits for a later scheduled cycle.
 */
function simulateProtectedPortfolio(raw,input,{trailPct}={trailPct:10}){
 const d=prepare(raw,input,trailPct),s=d.strategy,cost=s.transactionCostBps/10000;
 const held=new Map(d.extra.map(p=>[p.symbol,p.quantity])),stops=new Map(),events=[],curve=[],rebalances=[];
 let cash=input.initialBook?.cash??input.startingCapital,fees=0,interest=0,cycle=null,previousDate=d.sessions[0];
 const beganWithDebt=cash<0;
 if(!finite(cash))fail('Initial cash must be measured.');
 const initialGross=[...held].reduce((n,[symbol,q])=>n+q*d.maps.get(symbol).get(d.sessions[0]).open,0);
 if(Math.abs(cash+initialGross-input.startingCapital)>0.011)fail('Initial cash plus holdings at the first open must equal starting equity; incoming funds are excluded.');
 const apr=input.financingAprPct??null,maintenance=input.maintenancePct??null;
 if(cash<0&&(input.leverageAllowed!==true||!finite(apr)||apr<0||apr>100||!finite(maintenance)||maintenance<25||maintenance>100))fail('Existing debt needs explicit taxable-margin authority, modeled APR and maintenance assumptions.');
 const mark=(day,key)=>cash+[...held].reduce((n,[symbol,q])=>n+q*d.maps.get(symbol).get(day)[key],0);
 function fill(day,symbol,side,quantity,price,reason,extra={}){
  const fee=quantity*price*cost;fees+=fee;cash+=(side==='sell'?1:-1)*quantity*price-fee;
  const q=(held.get(symbol)||0)+(side==='sell'?-quantity:quantity);
  if(q)held.set(symbol,q);else{held.delete(symbol);stops.delete(symbol);}
  if(side==='buy'&&trailPct!==null&&!stops.has(symbol))stops.set(symbol,{peak:price,stop:price*(1-trailPct/100)});
  events.push({date:day,symbol,side,quantity,price,fee,reason,...extra});
 }
 for(const p of d.extra)if(trailPct!==null){const price=d.maps.get(p.symbol).get(d.sessions[0]).open;stops.set(p.symbol,{peak:price,stop:price*(1-trailPct/100)});}
 let maintenanceBreached=false;
 const benchmarks=Object.fromEntries(['SPY','DIA'].map(symbol=>{const price=d.maps.get(symbol).get(d.sessions[0]).open,q=Math.floor(input.startingCapital/(price*(1+cost)));return[symbol,{quantity:q,cash:input.startingCapital-q*price*(1+cost)}];}));
 for(let offset=0;offset<d.sessions.length;offset++){
  const day=d.sessions[offset],index=d.first+offset;
  const financing=Math.max(0,-cash)*(apr??0)/100*(Date.parse(day)-Date.parse(previousDate))/86400000/365;
  cash-=financing;interest+=financing;previousDate=day;
  let stopped=false;
  for(const [symbol,floor]of [...stops]){
   const r=d.maps.get(symbol).get(day);
   if(r.open<=floor.stop){fill(day,symbol,'sell',held.get(symbol),r.open,'stop-gap',{priorStop:floor.stop});stopped=true;}
  }
  if(stopped&&cycle){events.push({date:day,reason:'cycle-aborted-by-stop',cycleId:cycle.id});cycle=null;}
  const due=offset===0||(s.modelVersion===2?day.slice(0,7)!==d.sessions[offset-1].slice(0,7):offset%s.rebalanceSessions===0);
  if(due&&!stopped){
   if(cycle)events.push({date:day,reason:'unfinished-cycle-superseded',cycleId:cycle.id});
   const signal=portfolioNextTargets(s,d.closes,d.calendar[index-1]),equity=Math.max(0,mark(day,'open'));
   const desired=new Map(signal.targets.map(t=>[t.symbol,Math.floor(equity*s.grossExposurePct/100*t.weightPct/100/d.maps.get(t.symbol).get(day).open)]));
   cycle={id:day,desired};rebalances.push({fillDate:day,signalAsOf:signal.signalAsOf,decisionAsOf:signal.decisionAsOf,targets:signal.targets});
  }
  const gross=[...held].reduce((n,[symbol,q])=>n+q*d.maps.get(symbol).get(day).open,0),equity=mark(day,'open');
  const marginBreach=gross>0&&cash<0&&maintenance!==null&&equity/gross*100<maintenance;
  maintenanceBreached ||= marginBreach;
  if(cycle&&!stopped){
   let budget=d.limit;
   const names=[...new Set([...held.keys(),...cycle.desired.keys()])].sort();
   for(const side of ['sell','buy']){
    // Do not finance a new purchase while an earlier reduction remains unfinished.
    if(side==='buy'&&(marginBreach||names.some(symbol=>(held.get(symbol)||0)>(cycle.desired.get(symbol)||0))))break;
    for(const symbol of names){
     const current=held.get(symbol)||0,target=cycle.desired.get(symbol)||0,change=target-current;
     if(side==='sell'?change>=0:change<=0)continue;
     const price=d.maps.get(symbol).get(day).open;
     let remaining=Math.abs(change);
     while(remaining>0){
      let q=Math.min(remaining,100000,Math.floor((50000+CLOSE_EPS)/price),Math.floor((budget+CLOSE_EPS)/price));
      if(side==='buy')q=Math.min(q,Math.floor((Math.max(0,cash)+CLOSE_EPS)/(price*(1+cost))));
      if(q>0){fill(day,symbol,side,q,price,'allocation',{cycleId:cycle.id});budget-=q*price;remaining-=q;}
      if(side==='buy'&&remaining>0&&cash<price*(1+cost)-CLOSE_EPS){cycle.desired.set(symbol,held.get(symbol)||0);events.push({date:day,symbol,reason:'target-rounded-to-available-cash',cycleId:cycle.id});break;}
      if(!q)break;
     }
    }
   }
   if(names.every(symbol=>(held.get(symbol)||0)===(cycle.desired.get(symbol)||0)))cycle=null;
  }
  for(const [symbol,floor]of [...stops]){
   const r=d.maps.get(symbol).get(day);
   if(r.low<=floor.stop){fill(day,symbol,'sell',held.get(symbol),Math.min(r.open,floor.stop),'stop-intraday',{priorStop:floor.stop});stopped=true;}
  }
  if(stopped&&cycle){events.push({date:day,reason:'cycle-aborted-by-stop',cycleId:cycle.id});cycle=null;}
  for(const [symbol,floor]of stops){floor.peak=Math.max(floor.peak,d.maps.get(symbol).get(day).high);floor.stop=Math.max(floor.stop,floor.peak*(1-trailPct/100));}
  const value=mark(day,'close');
  if(!finite(value)||!finite(cash)||[...held.values()].some(q=>!Number.isSafeInteger(q)||q<1)||cash<-CLOSE_EPS&&!beganWithDebt)fail('Combined cash/share accounting failed.');
  curve.push({date:day,equity:value,cash,positions:Object.fromEntries([...held].sort()),stops:Object.fromEntries([...stops].map(([symbol,v])=>[symbol,{...v}])),pendingCycle:cycle?.id??null,
   benchmarks:Object.fromEntries(Object.entries(benchmarks).map(([symbol,b])=>[symbol,b.cash+b.quantity*d.maps.get(symbol).get(day).close])),cashBenchmark:input.startingCapital});
 }
 return{model:'portfolio-protected-v1',researchOnly:true,realOrdersPlaced:0,config:s,trailPct,startingCapital:input.startingCapital,
  window:{firstSession:d.sessions[0],lastSession:d.sessions.at(-1),sessions:d.sessions.length},metrics:performance(curve,input.startingCapital),
  costs:{transactionCostBps:s.transactionCostBps,tradingUsd:fees,financingUsd:interest,financingAprPct:apr},maintenanceBreached,
  maxAllocationTicketNotionalUsd:50000,dailyAllocationNotionalLimitUsd:d.limit,events,curve,rebalances,
  assumptions:['Prior-session signals; modeled allocation fills at the next session open, whole shares, sells before cash-funded buys. Allocation tickets are capped at $50,000 and 100,000 shares, with an explicit daily turnover limit; market liquidity and limit-order fill probability are not reconstructed.',
   'Stops test the previously confirmed floor, gaps fill at the lower open, and today high only raises tomorrow floor. Remaining shares retain their floor after partial sales or additions. Broker continuous intraday ratchets can behave differently.',
   'A stop aborts the allocation cycle. A new entry waits until a later scheduled rebalance; fees and any explicit existing-debt interest debit cash. No new borrowing is modeled.',
   'Price-only research excludes distributions, taxes and future contributions. Initial legacy positions start a new modeled peak at the first open; their historical broker stop ratchets are unknown. Maintenance breaches are reported, not reconstructed broker liquidations.',
   'Synthetic fill assumptions do not prove safe broker stop replacement, actual coverage, executable authority, or future returns.']};
}
module.exports={simulateProtectedPortfolio,performance};
