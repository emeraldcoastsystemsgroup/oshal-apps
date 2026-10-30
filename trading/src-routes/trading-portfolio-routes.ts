/** CHANGE LOG
 * 7 | maintainer@emeraldcoastsystemsgroup.com | The research read names each account's assigned strategy, so the concierge can compare a new strategy with the one an account runs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Record measured owner-bound account values and expose separate read-only account details.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Retain server-read congressional purchase provenance with immutable monthly candidate baskets; selected-universe studies never claim historical Congress performance.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Refreshing or re-adding an outside statement preserves its established account category and assigned review strategy.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Supply the last completed NYSE session as the historical window default, independent of the browser clock.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Register concrete non-executing previews under the same authenticated owner boundary, separately from research-envelope approvals.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native portfolio review with all held names, owner-declared outside accounts, immutable strategies and price-backed historical runs. Explicit research approval never enables broker execution or borrowing.
 */
import type {Router,Request,Response} from 'express';
import type {AppContext} from '@/app/composition/app-context';
import {callerSub} from '@/app/routes/trading-routes-helpers';
import {nativeSchwabReads,readNativeAccounts} from './trading-native-reads';
import {PortfolioError,accountKey,buildPortfolio,measured,registration,accountConstraints,type PortfolioProfile,type PortfolioRow} from './trading-portfolio-model';
import {normalizePortfolioStrategy,simulatePortfolio} from './trading-portfolio-sim';
import {fingerprint,getRecord,listRecords,saveRecord,removeRecord,type Data} from './trading-portfolio-store';
import {portfolioHistory} from './trading-portfolio-history';
import {congressStrategyEvidence} from './trading-congress-candidates';
import {registerPortfolioPlanRoutes} from './trading-portfolio-plan-routes';
import {registerNativeManagementRoutes} from './trading-native-management';
import {validDay,portfolioResearchWindow} from './trading-portfolio-calendar';
import {recordAccountValues,registerAccountValueRoutes} from './trading-account-values';
const running=new Set<string>();
function label(value:unknown,name='Name'):string {
 if(typeof value!=='string'||!value.trim()||value.trim().length>120)throw new PortfolioError(400,'name_invalid',`${name} must contain 1 to 120 characters.`);
 return value.trim();
}
function selector(body:Data):string {
 const key=accountKey(body);if(!key)throw new PortfolioError(400,'account_required','Select an account and its connection.');return key;
}
/** Exclude read timestamps but bind balances, positions, classification and assigned strategy. */
export function portfolioWitness(account:PortfolioRow,profile:Data|undefined):string {
 return fingerprint({account,profile:profile?{accountId:profile.accountId,connectionKey:profile.connectionKey,registration:profile.registration,label:profile.label,strategyId:profile.strategyId}:null});
}
export async function portfolioSnapshot(ctx:AppContext,owner:string,now=new Date()) {
 const [native,profiles,outside,watch]=await Promise.all([
  readNativeAccounts(ctx),listRecords(ctx,owner,'profile'),listRecords(ctx,owner,'outside'),
  ctx.pool.query('SELECT symbol FROM oshal_trading_watchlist WHERE user_sub=$1',[owner]),
 ]);
 if(!Array.isArray(native.accounts)||!Array.isArray(native.errors)||typeof native.readAt!=='string')throw new PortfolioError(502,'account_read_invalid','The account roster could not be verified.');
 const rows:PortfolioRow[]=[...native.accounts.map(a=>({...a,nativeReadOnly:true})),...outside.map(a=>a.account as PortfolioRow)];
 return {native,profiles,rows,report:{...buildPortfolio(rows,profiles as PortfolioProfile[],watch.rows.map(row=>String(row.symbol)),native.errors,now),readAt:native.readAt,nativePortfolio:true,researchWindow:portfolioResearchWindow(now),outsideSources:outside.map(row=>({id:row.id,asOf:row.asOf,provider:row.provider,accountId:row.account.accountId,label:row.account.label})),
  caveat:'Outside snapshots are owner-entered and may be stale or overlap connected accounts. Coverage does not certify net worth or active portfolio management.'}};
}
async function selected(ctx:AppContext,owner:string,body:Data,now=new Date()) {
 const snapshot=await portfolioSnapshot(ctx,owner,now),key=selector(body),account=snapshot.rows.find(row=>accountKey(row)===key);
 if(!account)throw new PortfolioError(404,'account_not_found','The selected account is unavailable in your current roster.');
 const profile=snapshot.profiles.find(row=>accountKey(row)===key);
 return {...snapshot,account,profile,constraints:accountConstraints(account,profile?.registration??registration(account.registration??'unknown'))};
}
export function registerTradingPortfolioRoutes(router:Router,ctx:AppContext,options:{now?:()=>Date}={}):void {
 const clock=options.now||(()=>new Date());
 const route=(method:'get'|'post'|'delete',path:string,fn:(req:Request,owner:string,at:Date)=>Promise<unknown>)=>{
  router[method](path,async(req:Request,res:Response)=>{
   res.setHeader('Cache-Control','no-store');const owner=callerSub(req);
   if(!owner){res.status(401).json({error:'not_authenticated'});return;}
   if(!nativeSchwabReads()){res.status(503).json({error:'native_portfolio_unavailable',message:'Portfolio review requires the native account read service.'});return;}
   try{res.json(await fn(req,owner,clock()));}catch(error){
    if(error instanceof PortfolioError){res.status(error.status).json({error:error.code,message:error.message});return;}
    res.status(502).json({error:'portfolio_unavailable',message:'Portfolio evidence could not be read or saved. No trades or borrowing were performed.'});
   }
  });
 };
 registerPortfolioPlanRoutes(route,ctx,{clock,selected:(owner,binding,now)=>selected(ctx,owner,binding,now),witness:portfolioWitness});
 registerNativeManagementRoutes(route,ctx,{clock,selected:(owner:string,binding:Data,now:Date)=>selected(ctx,owner,binding,now)});
 registerAccountValueRoutes(route,ctx,{selected:(owner:string,binding:Data,now:Date)=>selected(ctx,owner,binding,now)});
 route('get','/portfolio',async(_req,owner,at)=>{const snapshot=await portfolioSnapshot(ctx,owner,at);await recordAccountValues(ctx,owner,snapshot.native);return snapshot.report;});
 route('get','/portfolio/research',async(_req,owner,at)=>{
  const [strategies,runs,records,profiles]=await Promise.all([listRecords(ctx,owner,'strategy'),listRecords(ctx,owner,'run'),listRecords(ctx,owner,'review'),listRecords(ctx,owner,'profile')]);
  const approvals=new Map(records.filter(row=>row.status==='research-approved'&&row.reviewId).map(row=>[row.reviewId,row]));
  const reviews=records.filter(row=>!row.reviewId).map(row=>{
   const approval=approvals.get(row.id);
   return approval?{...row,status:'research-approved',approvedAt:approval.approvedAt,approvalId:approval.id}:
    {...row,status:at.getTime()>=Date.parse(row.expiresAt)?'expired':row.status};
  });
  const accounts=profiles.map(p=>({accountId:p.accountId,connectionKey:p.connectionKey,label:p.label,strategyId:p.strategyId??null}));
  return {strategies,runs:runs.slice(0,100).map(({history,result,...row})=>({...row,metrics:result?.metrics,window:result?.window,costs:result?.costs,maintenanceTriggered:result?.maintenanceTriggered})),reviews,accounts,liveExecutionAvailable:false};
 });
 route('post','/portfolio/profiles',async(req,owner,at)=>{
  const b=req.body||{},current=await selected(ctx,owner,b,at),reg=registration(b.registration);
  if(b.strategyId)await getRecord(ctx,owner,'strategy',b.strategyId);
  const profile={accountId:current.account.accountId,connectionKey:current.account.connectionKey,registration:reg,label:label(b.label,'Account label'),strategyId:b.strategyId||null};
  return {profile:await saveRecord(ctx,owner,'profile',profile,selector(b)),strategyAppliedToBroker:false};
 });
 route('post','/portfolio/outside',async(req,owner,at)=>{
  const b=req.body||{},provider=label(b.provider,'Provider'),name=label(b.label,'Account label'),asOf=validDay(b.asOf);
  if(asOf>at.toISOString().slice(0,10)||Date.parse(asOf)<at.getTime()-366*86400000)throw new PortfolioError(400,'snapshot_date_invalid','Use a statement date within the last year.');
  const reg=registration(b.registration),equity=measured(b.equity),cash=measured(b.cash);
  if(equity===null||Math.abs(equity)>1e9||cash===null||Math.abs(cash)>1e9||!Array.isArray(b.positions)||b.positions.length>500)throw new PortfolioError(400,'snapshot_invalid','Enter statement equity, cash, and at most 500 holdings.');
  const positions=b.positions.map((p:Data)=>{
   if(typeof p.symbol!=='string'||!p.symbol.trim()||p.symbol.length>64||measured(p.qty)===null||measured(p.marketValue)===null||Math.abs(p.marketValue)>1e9||Math.abs(p.qty)>1e9)throw new PortfolioError(400,'holding_invalid','Every holding needs a symbol, numeric quantity and market value.');
   return {symbol:p.symbol.trim().toUpperCase(),qty:p.qty,marketValue:p.marketValue,unmanaged:true};
  });
  if(new Set(positions.map((p:Data)=>p.symbol)).size!==positions.length)throw new PortfolioError(400,'holding_duplicate','Combine lots for each symbol before importing.');
  if(Math.abs(cash+positions.reduce((sum:number,p:Data)=>sum+p.marketValue,0)-equity)>Math.max(1,Math.abs(equity)*0.001))throw new PortfolioError(422,'snapshot_unreconciled','Cash plus holding values must reconcile to statement equity. Include every holding and any debt in statement cash.');
  let id:string;
  if(b.id){const previous=await getRecord(ctx,owner,'outside',b.id);id=previous.account.accountId;}else{id='outside:'+fingerprint([owner,provider,name]);}
  const account={accountId:id,connectionKey:'outside',kind:'outside',label:name,accountType:['cash','margin'].includes(b.accountType)?b.accountType:'unknown',registration:reg,equity,cash,buyingPower:null,dayChange:null,positions,nativeReadOnly:true,source:'owner-statement',asOf};
  const existingProfile=(await listRecords(ctx,owner,'profile')).find(row=>accountKey(row)===accountKey(account));
  const record=await saveRecord(ctx,owner,'outside',{provider,asOf,account},id);
  if(!existingProfile)await saveRecord(ctx,owner,'profile',{accountId:id,connectionKey:'outside',registration:reg,label:name,strategyId:null},accountKey(account)!);
  return {outside:record,brokerVerified:false,preservedReviewSettings:Boolean(existingProfile)};
 });
 route('delete','/portfolio/outside/:id',async(req,owner)=>{await removeRecord(ctx,owner,'outside',req.params.id);return{removed:true};});
 route('post','/portfolio/strategies',async(req,owner,at)=>{
  const b=req.body||{},config=normalizePortfolioStrategy(b.config);
  if(b.parentId)await getRecord(ctx,owner,'strategy',b.parentId);
  const universeEvidence=b.congressSelection===undefined?null:await congressStrategyEvidence(ctx,b.congressSelection,config,at);
  return {strategy:await saveRecord(ctx,owner,'strategy',{name:label(b.name,'Strategy name'),config,...(universeEvidence?{universeEvidence}:{}),parentId:b.parentId||null,configFingerprint:fingerprint(config),researchOnly:true})};
 });
 route('get','/portfolio/runs/:id',async(req,owner)=>({run:await getRecord(ctx,owner,'run',req.params.id)}));
 route('post','/portfolio/backtest',async(req,owner,at)=>{
  if(running.has(owner))throw new PortfolioError(409,'backtest_running','A portfolio backtest is already running for your account.');
  const b=req.body||{},s=await selected(ctx,owner,b,at),strategy=await getRecord(ctx,owner,'strategy',b.strategyId);
  const config=normalizePortfolioStrategy(strategy.config),capital=measured(s.account.equity);
  if(capital===null||capital<100)throw new PortfolioError(422,'capital_unavailable','At least $100 of measured account equity is required for this scenario.');
  if(config.grossExposurePct>100&&!s.constraints.leverageSimulationAllowed)throw new PortfolioError(422,'retirement_or_cash_leverage_refused','Borrowing scenarios require a confirmed taxable margin account.');
  const connection=s.account.kind==='outside'?s.native.accounts[0]?.connectionKey:String(s.account.connectionKey);
  if(!connection)throw new PortfolioError(422,'history_connection_required','Connect a Schwab market-data account before running historical research.');
  validDay(b.startDate);validDay(b.endDate);running.add(owner);
  const receipt={accountId:s.account.accountId,connectionKey:s.account.connectionKey,strategyId:strategy.id,strategy,accountWitness:portfolioWitness(s.account,s.profile),accountSnapshot:s.account,profileSnapshot:s.profile??null,startDate:b.startDate,endDate:b.endDate,researchOnly:true};
  try{
   const history=await portfolioHistory(ctx,connection,config,b.startDate,b.endDate,at);
   const result=simulatePortfolio(config,{startDate:b.startDate,endDate:b.endDate,startingCapital:capital,leverageAllowed:s.constraints.leverageSimulationAllowed,series:history.series});
   if(strategy.universeEvidence)result.assumptions.push(strategy.universeEvidence.note);
   return {run:await saveRecord(ctx,owner,'run',{...receipt,status:'completed',history,result,evidenceFingerprint:fingerprint({receipt,history,result})})};
  }catch(error){
   const e=error instanceof PortfolioError?error:new PortfolioError(502,'history_unavailable','Historical prices could not be verified. Retry after checking the connection.');
   const run=await saveRecord(ctx,owner,'run',{...receipt,status:e.code.includes('history')?'insufficient_or_unavailable':'failed',error:{code:e.code,message:e.message}});
   return {run,completed:false};
  }finally{running.delete(owner);}
 });
 route('post','/portfolio/reviews',async(req,owner,at)=>{
  const b=req.body||{},run=await getRecord(ctx,owner,'run',b.runId);
  if(run.status!=='completed')throw new PortfolioError(422,'completed_backtest_required','A completed price-backed historical run is required.');
  const s=await selected(ctx,owner,run,at),config=normalizePortfolioStrategy(run.strategy.config);
  if(s.constraints.group==='unclassified')throw new PortfolioError(409,'account_classification_required','Confirm account registration and broker mechanics before preparing a research review.');
  if(s.account.kind==='outside'&&(typeof s.account.asOf!=='string'||at.getTime()-Date.parse(s.account.asOf)>7*86400000))throw new PortfolioError(409,'outside_statement_stale','Replace this outside statement with a current snapshot before preparing a research review.');
  const equity=measured(s.account.equity);
  if(equity===null||equity<=0)throw new PortfolioError(422,'capital_unavailable','Positive measured equity is required.');
  if(config.grossExposurePct>100&&!s.constraints.leverageSimulationAllowed)throw new PortfolioError(409,'account_constraints_changed','This account cannot review a borrowing scenario.');
  const proposedAllocation=config.assets.map(a=>({symbol:a.symbol,envelopeUsd:equity*a.weightPct/100*config.grossExposurePct/100}));
  const gross=proposedAllocation.reduce((sum,a)=>sum+a.envelopeUsd,0);
  const review={accountId:s.account.accountId,connectionKey:s.account.connectionKey,accountLabel:s.profile?.label||s.account.label||s.account.accountMasked,runId:run.id,strategyId:run.strategyId,strategyName:run.strategy.name,backtest:{window:run.result.window,metrics:run.result.metrics,createdAt:run.createdAt},portfolioCoverage:s.report.coverage,strategyFingerprint:fingerprint(config),evidenceFingerprint:run.evidenceFingerprint,accountWitness:portfolioWitness(s.account,s.profile),equity,proposedAllocation,estimatedBorrowingUsd:Math.max(0,gross-equity),constraints:s.constraints,status:'pending',expiresAt:new Date(at.getTime()+15*60000).toISOString(),
   purpose:'Research allocation envelope only. It is not a current signal, executable order, broker credit approval, or protection for existing holdings.',liveExecutionAvailable:false};
  return {review:await saveRecord(ctx,owner,'review',{...review,fingerprint:fingerprint(review)})};
 });
 route('post','/portfolio/reviews/:id/approve',async(req,owner,at)=>{
  const b=req.body||{},review=await getRecord(ctx,owner,'review',req.params.id);
  if(b.confirm!==true||b.fingerprint!==review.fingerprint)throw new PortfolioError(428,'exact_review_confirmation_required','Confirm the exact displayed research review.');
  if(at.getTime()>=Date.parse(review.expiresAt))throw new PortfolioError(409,'review_expired','This review expired. Prepare a fresh review.');
  const s=await selected(ctx,owner,review,at);
  if(portfolioWitness(s.account,s.profile)!==review.accountWitness)throw new PortfolioError(409,'account_changed','Balances, holdings or classification changed. Prepare a fresh review.');
  const existing=(await listRecords(ctx,owner,'review')).find(row=>row.status==='research-approved'&&row.reviewId===review.id);
  if(existing)return {approval:existing,realOrdersPlaced:0,borrowingAuthorized:false};
  const approval=await saveRecord(ctx,owner,'review',{...review,status:'research-approved',approvedAt:at.toISOString(),reviewId:review.id,realOrdersPlaced:0,borrowingAuthorized:false},'approval:'+review.id);
  return {approval,realOrdersPlaced:0,borrowingAuthorized:false};
 });
}
