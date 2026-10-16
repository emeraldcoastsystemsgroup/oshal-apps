/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fetch fresh caller-bound evidence for native reconciliation and append only preview-matched historical closes in a witnessed SQL transaction.
 */
import type {AppContext} from '@/app/composition/app-context';
import {planNativeReconciliation, type LedgerSnapshot, type VenueEvidence} from './trading-native-reconciliation';
import {readNativeAccounts,readNativeHistory} from './trading-native-reads';
type Row=Record<string,unknown>;
export class ReconciliationError extends Error {constructor(readonly status:number,readonly code:string,message:string){super(message);}}
const fail=(status:number,code:string,message:string):never=>{throw new ReconciliationError(status,code,message);};
export interface Selector {accountId:string;connection:string}

/** Evidence is fetched by the authenticated server; browser-supplied fills, book IDs and owners are ignored. */
export async function nativeReconciliationPreview(ctx:AppContext,selector:Selector) {
 const host=ctx as AppContext&{intent?:(name:string,input:Row)=>Promise<unknown>};
 if(typeof host.intent!=='function')return fail(503,'reconciliation_unavailable','Native reconciliation is unavailable on this host.');
 const ledger=await host.intent('trading.reconciliation.ledger',selector as unknown as Row) as LedgerSnapshot;
 const accounts=await readNativeAccounts(ctx);
 const account=accounts.accounts.find(a=>a.accountId===selector.accountId&&a.connectionKey===selector.connection);
 if(!account)return fail(502,'account_read_failed','The selected Schwab account could not be read.');
 if(ledger.status==='no-ledger')return{...planNativeReconciliation(ledger,{accountId:account.accountId,accountBinding:ledger.accountBinding,transactions:[],unsupported:[],positions:account.positions}),readAt:accounts.readAt};
 const end=Date.now(),start=end-365*86400000,trades=new Map<string,Row>(),unsupported:unknown[]=[];
 for(let from=start;from<end;from+=55*86400000){
  const result=await readNativeHistory(ctx,{...selector,from:new Date(from).toISOString(),to:new Date(Math.min(from+55*86400000,end)).toISOString()}) as {accountId:string;accountBinding:string;transactions:Row[];unsupported:unknown[]};
  if(result.accountId!==selector.accountId||result.accountBinding!==ledger.accountBinding||!Array.isArray(result.transactions)||!Array.isArray(result.unsupported))return fail(502,'evidence_changed','The Schwab account evidence changed. Retry the preview.');
  unsupported.push(...result.unsupported);
  for(const trade of result.transactions){
   const key=String(trade.transactionId||'');if(!key)return fail(502,'invalid_execution','Schwab history contains an unidentified execution.');
   const old=trades.get(key);if(old&&JSON.stringify(old)!==JSON.stringify(trade))return fail(502,'conflicting_execution','Schwab returned conflicting execution copies.');trades.set(key,trade);
  }
 }
 const latestAccounts=await readNativeAccounts(ctx);
 const latestAccount=latestAccounts.accounts.find(a=>a.accountId===selector.accountId&&a.connectionKey===selector.connection);
 const holdings=(rows:Row[])=>JSON.stringify(rows.map(p=>({symbol:p.symbol,qty:String(p.qty)})).sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol))));
 if(!latestAccount||holdings(account.positions)!==holdings(latestAccount.positions))return fail(409,'holdings_changed','Schwab holdings changed while reading history. Review a new preview.');
 const venue:VenueEvidence={accountId:selector.accountId,accountBinding:ledger.accountBinding,transactions:[...trades.values()],unsupported,positions:latestAccount.positions};
 const report=planNativeReconciliation(ledger,venue);
 return{...report,readAt:latestAccounts.readAt,ledger};
}

const columns=['order_id','book_id','mode','symbol','side','status','filled_qty','filled_avg_price','broker_order_id','created_at'];
function witness(rows:Row[]):string {
 return JSON.stringify(rows.map(row=>Object.fromEntries(columns.map(k=>[k,k==='created_at'&&row[k]?new Date(row[k] as string).toISOString():['filled_qty','filled_avg_price'].includes(k)&&row[k]!==null&&row[k]!==undefined?Number(row[k]):row[k]??null]))).sort((a,b)=>String(a.order_id).localeCompare(String(b.order_id))));
}

/** Native ledger only: historical records, no broker execution and no legacy service/book configuration. */
export async function nativeReconciliationApply(ctx:AppContext,selector:Selector,fingerprint:string,owner:string) {
 const report=await nativeReconciliationPreview(ctx,selector);
 if(report.fingerprint!==fingerprint)return fail(409,'preview_changed','The ledger or Schwab evidence changed. Review a new preview before applying.');
 if(!report.bookId||!report.corrections.length)return fail(409,'nothing_to_apply','There are no verified historical closes to apply.');
 const pool=ctx.pool as AppContext['pool']&{storageModel?:string};
 if(pool.storageModel!=='kernel-scoped-documents')return fail(503,'native_ledger_required','This repair requires the native owner-scoped ledger.');
 const expected='ledger'in report?report.ledger:undefined;
 if(!expected)return fail(409,'ledger_unavailable','Historical ledger evidence is unavailable.');
 const client=await pool.connect();let committed=false;
 try{
  await client.query('BEGIN');
  const before=(await client.query(`SELECT ${columns.join(',')} FROM oshal_trading_orders WHERE book_id=$1 AND mode=$2`,[report.bookId,'live'])).rows as Row[];
  if(witness(before)!==witness(expected.orders))return fail(409,'ledger_changed','The historical ledger changed while preparing the repair. Review a new preview.');
  const recorded=new Date().toISOString();
  for(const correction of report.corrections){
   const audit={reason:'ledger-reconcile',source:'schwab',transactionId:correction.transaction_id,originalTradeDate:correction.venue_trade_date,evidenceFingerprint:report.fingerprint,recordedAt:recorded};
   await client.query(`INSERT INTO oshal_trading_decisions (decision_id,user_sub,mode,book_id,signal_ids,action,symbol,side,qty,confidence,rationale,indicators,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[correction.decision_id,owner,'live',report.bookId,[],'sell',correction.symbol,'sell',correction.qty,1,'Historical ledger correction from a verified Schwab execution; no new order placed.',JSON.stringify(audit),correction.created_at]);
   const fields=['order_id','decision_id','client_order_id','broker_order_id','symbol','side','qty','filled_qty','filled_avg_price','cost_basis','realized_pnl','fees','created_at','book_id','mode','broker','status','raw_status','order_type'];
   await client.query(`INSERT INTO oshal_trading_orders (${fields.join(',')},user_sub,updated_at) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')},$20,$21)`,[...fields.map(k=>correction[k]),owner,recorded]);
  }
  const after=(await client.query(`SELECT ${columns.join(',')} FROM oshal_trading_orders WHERE book_id=$1 AND mode=$2`,[report.bookId,'live'])).rows as Row[];
  for(const symbol of report.symbols.filter(s=>s.action==='book')){
   const quantity=after.filter(r=>r.symbol===symbol.symbol&&r.status==='filled').reduce((total,r)=>total+(r.side==='buy'?1:-1)*Number(r.filled_qty),0);
   if(!Number.isFinite(quantity)||Math.abs(quantity-Number(symbol.venueQty))>0.000001)return fail(409,'quantity_mismatch','The recorded ledger quantity did not match Schwab; the repair was rolled back.');
  }
  await client.query('COMMIT');committed=true;
  return{accountId:report.accountId,bookId:report.bookId,bookedRows:report.corrections.length,reviewExceptions:report.symbols.filter(s=>s.action==='refuse').length,realOrdersPlaced:0,nativeLedgerOnly:true};
 }finally{try{if(!committed)await client.query('ROLLBACK');}finally{client.release();}}
}
