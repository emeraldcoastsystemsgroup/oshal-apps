/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the defensive fund and full calendar-month warmup in version2 rotation research and planning.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Calculate concrete, non-executing rebalance previews from measured holdings, completed-session targets and timestamped trade quotes. Separate planning exceptions from broker capacity and never authorize orders or borrowing.
 */
import {PortfolioError,measured,accountConstraints,type PortfolioRow,type PortfolioProfile} from './trading-portfolio-model';
import {normalizePortfolioStrategy,type PortfolioStrategy} from './trading-portfolio-sim';
import {portfolioStrategySymbols} from './trading-portfolio-rotation';
import {lastCompletedSession,nyseSessionClock} from './trading-portfolio-calendar';
export type HoldingsScope='preserve-other-holdings'|'whole-account';
export interface PlanQuote {symbol:string;tradePrice:number|null;tradeAt:string|null;source:string;delayed:boolean|null}
export interface PlanIssue {code:string;message:string;symbol?:string}
export const PLANNING_CAPS=Object.freeze({maxOrderUsd:5000,maxOrderShares:100,maxGrossExposurePct:100});
export const canonicalPlanSymbol=(raw:unknown):string=>{
 const symbol=typeof raw==='string'?raw.trim().toUpperCase().replaceAll('/','.') : '';
 if(!/^[A-Z][A-Z0-9.-]{0,15}$/.test(symbol)||symbol.includes('..'))throw new PortfolioError(422,'plan_instrument_unsupported','Rebalance previews require distinct equity/fund symbols. Unsupported instruments must be reviewed separately; none are dropped.');
 return symbol;
};
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const units=(n:number)=>Math.trunc(n*1e6)/1e6;
function finite(n:unknown,name:string,low=-1e9,high=1e9):number {
 const v=measured(n);if(v===null||v<low||v>high)throw new PortfolioError(422,'plan_fact_missing',`${name} must be measured and within the preview limits.`);return v;
}
/** A last trade needs its own timestamp; a mark/quote timestamp never masquerades as a trade. */
export function planQuoteStatus(q:PlanQuote,now:Date,latest=lastCompletedSession(now)):PlanIssue[] {
 const issues:PlanIssue[]=[];
 if(q.source!=='schwab'||q.delayed!==false)issues.push({code:'quote_source_unverified',symbol:q.symbol,message:`${q.symbol}: a verified, non-delayed Schwab trade quote is required for planning approval.`});
 const at=typeof q.tradeAt==='string'?Date.parse(q.tradeAt):NaN;
 if(!Number.isFinite(at)||at>now.getTime()+60000){issues.push({code:'quote_time_invalid',symbol:q.symbol,message:`${q.symbol}: the last trade has no valid provider timestamp.`});return issues;}
 const current=nyseSessionClock(now),trade=nyseSessionClock(new Date(at));
 const recent=now.getTime()-at<=15*60000;
 const lastClose=nyseSessionClock(new Date(latest+'T17:00:00Z')).close;
 const closedReference=!current.regular&&trade.date===latest&&trade.minutes>=lastClose-20;
 if(!recent&&!closedReference)issues.push({code:'quote_stale',symbol:q.symbol,message:`${q.symbol}: the trade is neither recent nor a reference from the last completed session.`});
 return issues;
}
export interface PlanInput {
 account:PortfolioRow;profile?:PortfolioProfile;config:unknown;
 targets:Array<{symbol:string;weightPct:number}>;signalAsOf:string;quotes:PlanQuote[];
 scope:HoldingsScope;now:Date;
}
/**
 * @description Build a long-only, cash-account-aware preview. Prices, positions and account facts
 * are supplied only by the authenticated workflow, never by an HTTP request body.
 * @param input Measured account, immutable strategy, completed targets and provider trade quotes.
 * @returns Every retained holding/action, modeled cash/costs, hard blockers and planning-cap exceptions.
 */
export function buildRebalancePlan(input:PlanInput) {
 const config=normalizePortfolioStrategy(input.config),account=input.account,now=input.now;
 if(!['preserve-other-holdings','whole-account'].includes(input.scope))throw new PortfolioError(400,'plan_scope_invalid','Choose whether to preserve holdings outside the strategy or rebalance the whole account.');
 if(input.signalAsOf!==lastCompletedSession(now))throw new PortfolioError(409,'signal_session_changed','Completed-session signals changed. Prepare a fresh preview.');
 const declared=input.profile?.registration??'unknown',constraints=accountConstraints(account,declared),blockers:PlanIssue[]=[];
 const block=(code:string,message:string,symbol?:string)=>blockers.push({code,message,...(symbol?{symbol}:{})});
 if(constraints.group==='unclassified')block('account_classification_required','Confirm the account category and broker cash/margin type before planning approval.');
 if(account.kind!=='live'||account.broker!=='schwab')block('outside_account_unverified','Outside statements can be previewed but cannot establish current broker funding authority.');
 if(constraints.retirement&&config.grossExposurePct>100)block('retirement_leverage_refused','Retirement previews cannot borrow, including accounts labelled MARGIN by the broker.');
 else if(config.grossExposurePct>100&&!constraints.leverageSimulationAllowed)block('cash_leverage_refused','Borrowed exposure requires a confirmed taxable margin account.');
 const equity=finite(account.equity,'Account equity',100),cash=finite(account.cash,'Reported account cash');
 if(!Array.isArray(account.positions)||account.positions.length>200)throw new PortfolioError(422,'plan_holdings_incomplete','Preview every holding together: the account needs a complete roster of at most 200 positions. No holdings are omitted.');
 const configured=new Set<string>();
 for(const rawSymbol of portfolioStrategySymbols(config)){const symbol=canonicalPlanSymbol(rawSymbol);if(configured.has(symbol))throw new PortfolioError(422,'plan_symbol_alias_conflict','Two strategy symbols resolve to the same instrument. Save one canonical symbol.');configured.add(symbol);}
 const weights=new Map<string,number>();
 for(const target of input.targets){const symbol=canonicalPlanSymbol(target.symbol);if(!configured.has(symbol)||weights.has(symbol))throw new PortfolioError(422,'plan_targets_invalid','Targets must be distinct configured strategy assets.');weights.set(symbol,finite(target.weightPct,'Target weight',0,100));}
 if([...weights.values()].reduce((a,b)=>a+b,0)>100.000001)throw new PortfolioError(422,'plan_targets_invalid','Target weights exceed 100%.');
 const held=new Map<string,{symbol:string;qty:number;marketValue:number;unmanaged:boolean}>();
 for(const raw of account.positions as PortfolioRow[]){
  const symbol=canonicalPlanSymbol(raw.symbol),qty=finite(raw.qty,'Holding quantity',0),marketValue=finite(raw.marketValue,'Holding market value',0);
  if(held.has(symbol))throw new PortfolioError(422,'plan_holding_duplicate','Combine instrument lots before planning; duplicate/aliased holdings are not double-counted.');
  if(qty===0&&marketValue!==0)throw new PortfolioError(422,'plan_holding_invalid','A zero-quantity position has a nonzero value. Reconcile the account before planning.');
  held.set(symbol,{symbol,qty,marketValue,unmanaged:raw.unmanaged===true||account.nativeReadOnly===true||account.notTrading===true});
 }
 const required=[...new Set([...configured,...held.keys()])].sort(),quotes=new Map<string,PlanQuote>();
 for(const quote of input.quotes){const symbol=canonicalPlanSymbol(quote.symbol);if(quotes.has(symbol))throw new PortfolioError(422,'plan_quote_duplicate','A preview cannot use conflicting or duplicate quote rows.');quotes.set(symbol,{...quote,symbol});}
 for(const symbol of required){const q=quotes.get(symbol);if(!q||measured(q.tradePrice)===null||q.tradePrice!<=0||q.tradePrice!>1e9)throw new PortfolioError(422,'plan_quote_missing',`${symbol}: a measured last-trade price is required; no held name is silently dropped.`);blockers.push(...planQuoteStatus(q,now,input.signalAsOf));}
 const price=(s:string)=>quotes.get(s)!.tradePrice!;
 const snapshotHoldings=[...held.values()].reduce((sum,p)=>sum+p.marketValue,0);
 const markedHoldings=[...held.values()].reduce((sum,p)=>sum+p.qty*price(p.symbol),0);
 const markedEquity=equity+markedHoldings-snapshotHoldings,netFinancingCash=equity-snapshotHoldings;
 if(!Number.isFinite(markedEquity)||markedEquity<=0)throw new PortfolioError(422,'plan_equity_invalid','The repriced account has no positive measured equity for allocation sizing.');
 const preserved=[...held.values()].filter(p=>input.scope==='preserve-other-holdings'&&!configured.has(p.symbol));
 const preservedValue=preserved.reduce((sum,p)=>sum+p.qty*price(p.symbol),0),allocationBase=Math.max(0,markedEquity-preservedValue),rate=config.transactionCostBps/10000;
 const compute=(feeGuess:number)=>required.map(symbol=>{
  const p=held.get(symbol),qty=p?.qty??0,px=price(symbol),preserve=input.scope==='preserve-other-holdings'&&!configured.has(symbol);
  const targetValue=preserve?qty*px:Math.max(0,allocationBase-feeGuess)*config.grossExposurePct/100*(weights.get(symbol)??0)/100;
  const delta=preserve?0:config.fractionalShares?units(targetValue/px-qty):Math.max(-Math.floor(qty),Math.floor(targetValue/px-qty));
  const proposedQty=Math.max(-qty,delta),after=qty+proposedQty,notional=Math.abs(proposedQty*px),fee=notional*rate;
  return {symbol,currentQty:qty,changeQty:proposedQty,afterQty:after,referencePrice:px,tradeAt:quotes.get(symbol)!.tradeAt,
   action:preserve?'preserve':proposedQty>0?'buy':proposedQty<0?'sell':'hold',targetWeightPct:weights.get(symbol)??0,
   outsideStrategy:!configured.has(symbol),unmanaged:p?.unmanaged??false,notionalUsd:notional,modeledCostUsd:fee,
   afterMarketValue:after*px,desiredValueUsd:targetValue};
 });
 let rows=compute(0),fees=0;
 // Re-evaluate targets against equity after modeled costs, so a fully invested cash plan reserves its fees.
 for(let i=0;i<16;i++){const nextFees=rows.reduce((sum,row)=>sum+row.modeledCostUsd,0);if(Math.abs(nextFees-fees)<0.000001){fees=nextFees;break;}fees=nextFees;rows=compute(fees);}
 fees=rows.reduce((sum,row)=>sum+row.modeledCostUsd,0);
 const actions=rows.filter(r=>r.changeQty!==0),buyUsd=rows.filter(r=>r.changeQty>0).reduce((sum,r)=>sum+r.notionalUsd+r.modeledCostUsd,0);
 const sellUsd=rows.filter(r=>r.changeQty<0).reduce((sum,r)=>sum+r.notionalUsd-r.modeledCostUsd,0);
 const cashAfter=netFinancingCash+sellUsd-buyUsd,equityAfter=markedEquity-fees,grossAfter=rows.reduce((sum,r)=>sum+Math.abs(r.afterMarketValue),0);
 if(![cashAfter,equityAfter,grossAfter,fees,...rows.flatMap(r=>[r.changeQty,r.afterQty,r.notionalUsd])].every(Number.isFinite))throw new PortfolioError(422,'plan_nonfinite','The preview produced nonfinite amounts.');
 if(equityAfter<=0)block('plan_costs_exhaust_equity','Modeled costs would exhaust account equity.');
 const grossAfterPct=equityAfter>0?grossAfter/equityAfter*100:null,modeledBorrowingBefore=Math.max(0,-netFinancingCash),modeledBorrowingAfter=Math.max(0,-cashAfter);
 const incrementalBorrowing=Math.max(0,modeledBorrowingAfter-modeledBorrowingBefore);
 const facts=account.balanceFacts&&typeof account.balanceFacts==='object'?account.balanceFacts as PortfolioRow:{};
 const buyingPower=measured(facts.buyingPower),debit=measured(facts.debitBalance),maintenance=measured(facts.maintenanceRequirement);
 const withdrawal=measured(facts.cashAvailableForWithdrawal),settled=measured(account.settledCash);
 const availableCash=settled!==null&&settled>=0?Math.min(Math.max(0,cash),settled):withdrawal!==null&&withdrawal>=0?Math.min(Math.max(0,cash),withdrawal):null;
 const tolerance=Math.max(1,equity*0.001);
 const cashAlreadyNet=Math.abs(cash+snapshotHoldings-equity)<=tolerance;
 const cashMinusDebit=debit!==null&&Math.abs(cash+snapshotHoldings-debit-equity)<=tolerance;
 const reconciliationBasis=cashAlreadyNet?'reported-cash-already-net':cashMinusDebit?'reported-cash-minus-debit':'unreconciled';
 if(debit!==null&&debit<0)block('debit_balance_invalid','The provider debit balance requires manual interpretation.');
 if(reconciliationBasis==='unreconciled')block('account_reconciliation_required','Cash, holdings, reported debt and equity do not reconcile. Derived financing cash is a model residual, not verified broker debt.');
 if(!constraints.leverageSimulationAllowed){
  if(cashAfter < -0.005||incrementalBorrowing>0.005)block('nonmargin_borrowing_refused','A cash or retirement preview cannot end with borrowed financing.');
  if(buyUsd>0){
   if(availableCash===null)block('settled_cash_unknown','Broker-reported settled/withdrawable cash is unavailable. Cash and retirement buys cannot be approved from an unknown settlement balance.');
   else if(buyUsd>availableCash+0.005)block('sale_or_settlement_funding_required','The buys exceed presently settled cash. Sale proceeds are not assumed immediately spendable; refresh after the broker reports settlement.');
  }
 }else{
  if(buyUsd>0&&(buyingPower===null||buyingPower<0))block('broker_buying_power_unknown','Measured provider buying power is unavailable; the legacy cash fallback is not used.');
  else if(buyUsd>0&&buyUsd>buyingPower!+0.005)block('broker_buying_power_exceeded','The buys exceed current provider buying power. Selling first does not invent extra broker capacity.');
  if(modeledBorrowingAfter>0.005||modeledBorrowingBefore>0.005||(debit??0)>0.005){
   if(debit===null||maintenance===null||maintenance<0)block('margin_facts_unknown','Broker debit balance and current maintenance requirement must be measured before a borrowing-related planning approval.');
   else if(equityAfter<maintenance)block('current_maintenance_not_met','Post-cost equity is below the current reported maintenance requirement. A planning exception cannot override this.');
  }
 }
 if(input.scope==='whole-account')for(const r of rows)if(r.outsideStrategy&&r.afterQty>1e-6)block('fractional_residual_requires_review','Whole-share sizing leaves a fractional holding outside the strategy. Review its closure separately.',r.symbol);
 if(actions.some(r=>Math.abs(r.changeQty)>1e9||r.afterQty>1e9))block('preview_quantity_limit','A proposed quantity exceeds the supported preview bounds.');
 const exceptions:Array<{code:string;symbol?:string;actual:number;limit:number;unit:string}>=[];
 for(const r of actions){if(money(r.notionalUsd+r.modeledCostUsd)>PLANNING_CAPS.maxOrderUsd)exceptions.push({code:'order_dollars',symbol:r.symbol,actual:money(r.notionalUsd+r.modeledCostUsd),limit:PLANNING_CAPS.maxOrderUsd,unit:'USD'});if(Math.abs(r.changeQty)>PLANNING_CAPS.maxOrderShares)exceptions.push({code:'order_shares',symbol:r.symbol,actual:Math.abs(r.changeQty),limit:PLANNING_CAPS.maxOrderShares,unit:'shares'});}
 if(grossAfterPct!==null&&grossAfter>equityAfter*PLANNING_CAPS.maxGrossExposurePct/100+0.005)exceptions.push({code:'gross_exposure',actual:grossAfterPct,limit:PLANNING_CAPS.maxGrossExposurePct,unit:'percent of post-cost equity'});
 return {model:'rebalance-preview-v1',scope:input.scope,signalAsOf:input.signalAsOf,config,referenceAt:now.toISOString(),expiresAt:new Date(now.getTime()+15*60000).toISOString(),
  status:blockers.length?'blocked':actions.length?'pending-review':'no-changes',blockers,planningCaps:PLANNING_CAPS,planningExceptions:exceptions,
  requiresPlanningExceptionAcknowledgement:exceptions.length>0,requiresUnmanagedSalesAcknowledgement:actions.some(r=>r.action==='sell'&&r.unmanaged),
  rows,actions,buyUsd:money(buyUsd),sellNetUsd:money(sellUsd),modeledCostsUsd:money(fees),
  funding:{reportedEquity:equity,repricedEquity:money(markedEquity),reportedCash:cash,derivedFinancingCashBefore:money(netFinancingCash),derivedFinancingCashAfter:money(cashAfter),
   postCostEquity:money(equityAfter),grossAfterUsd:money(grossAfter),grossAfterPct,preservedHoldingsUsd:money(preservedValue),allocationBaseUsd:money(allocationBase),
   measuredSettledOrWithdrawableCash:availableCash,measuredBuyingPower:buyingPower,reportedDebitBalance:debit,reconciliationBasis,currentMaintenanceRequirement:maintenance,
   modeledBorrowingBeforeUsd:money(modeledBorrowingBefore),modeledBorrowingAfterUsd:money(modeledBorrowingAfter),modeledBorrowingIncreaseUsd:money(incrementalBorrowing),
   assumedMarginAprPct:config.marginAprPct,modeledAnnualInterestUsd:modeledBorrowingAfter<=0.005?0:config.marginAprPct===null?null:money(modeledBorrowingAfter*config.marginAprPct/100),projectedBrokerMaintenanceRequirement:null},
  execution:{available:false,realOrdersPlaced:0,borrowingAuthorized:false,liveLimitsChanged:false,
   blockers:['Native brokerage execution is unavailable.','Broker instrument eligibility, tax lots and any pretrade margin/maintenance assessment are not established by this planning preview.']},
  assumptions:['Targets use completed-session signals from the saved research model; prices are timestamped reference trades, not executable quotes.',
   'Weights apply to the strategy allocation base after modeled transaction costs; holdings outside the strategy are preserved unless the whole-account scope is explicitly chosen.',
   'Whole-share rounding, current holdings and post-cost sizing can differ from the historical fresh-cash run.',
   'Derived financing cash is equity minus reported holding value, not an assertion of broker debit balance. Funding approval requires the measured broker facts shown above.',
   'Cash/retirement buys do not assume same-session reuse of sale proceeds. Whole-share sizing retains existing fractional residuals.',
   'Planning approval acknowledges these specific quantities and exceptions only. It places no order, increases no borrowing and changes no live guardrail.']};
}
