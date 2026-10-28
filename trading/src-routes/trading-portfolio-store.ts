/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Declare separate owner-bound combined allocation/protection studies.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Declare owner-isolated position-backstop policy/state/study and expected-funding record kinds.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep heavy planning evidence separate from recent preview listings, count records without loading payloads, and preserve the first concurrent planning approval with insert-once semantics.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist owner-isolated immutable portfolio research and bounded mutable account declarations through the native governed SQL port.
 */
import {createHash,randomUUID} from 'node:crypto';
import type {AppContext} from '@/app/composition/app-context';
import {PortfolioError} from './trading-portfolio-model';
export type RecordKind='profile'|'outside'|'strategy'|'run'|'review'|'plan'|'plan-approval'|'plan-evidence'|'watch'|'live-ticket'|'live-mandate'|'live-cycle'|'backstop-policy'|'backstop-state'|'backstop-run'|'funding-plan'|'protection-review'|'combined-run';
export type Data=Record<string,any>;
export function fingerprint(value: unknown): string {
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export async function listRecords(ctx:AppContext,owner:string,kind:RecordKind,limit=500):Promise<Data[]> {
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new PortfolioError(400,'record_limit_invalid','Invalid internal record page limit.');
 const rows=(await ctx.pool.query(`SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 ORDER BY created_at DESC LIMIT ${limit===500?501:limit}`,[owner,kind])).rows;
 if(rows.length>500)throw new PortfolioError(409,'record_limit','Archive older research before adding more records.');
 return rows.map(row=>({...JSON.parse(String(row.payload)),id:String(row.record_id),createdAt:new Date(row.created_at).toISOString()}));
}
export async function getRecord(ctx:AppContext,owner:string,kind:RecordKind,id:unknown):Promise<Data> {
 if(typeof id!=='string'||id.length>100)throw new PortfolioError(400,'record_required','Select a saved record.');
 const row=(await ctx.pool.query('SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 AND record_id=$3',[owner,kind,id])).rows[0];
 if(!row)throw new PortfolioError(404,'record_not_found','This saved record was not found for your account.');
 return {...JSON.parse(String(row.payload)),id:String(row.record_id),createdAt:new Date(row.created_at).toISOString()};
}
export async function saveRecord(ctx:AppContext,owner:string,kind:RecordKind,data:Data,key?:string):Promise<Data> {
 const id=key?`${kind}:${fingerprint([owner,key])}`:randomUUID(),createdAt=new Date().toISOString();
 const payload=JSON.stringify(data);
 if(Buffer.byteLength(payload)>1500000)throw new PortfolioError(413,'record_too_large','This research record exceeds the storage limit.');
 if(!key && (await ctx.pool.query('SELECT record_id FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 LIMIT 501',[owner,kind])).rows.length>=500)throw new PortfolioError(409,'record_limit','Archive older research before adding more records.');
 await ctx.pool.query(`INSERT INTO oshal_trading_portfolio_records (record_id,user_sub,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5)
 ON CONFLICT (user_sub,record_id) DO UPDATE SET payload=EXCLUDED.payload,created_at=EXCLUDED.created_at`,[id,owner,kind,payload,createdAt]);
 return {...data,id,createdAt};
}
export async function removeRecord(ctx:AppContext,owner:string,kind:'outside',id:unknown):Promise<void> {
 await getRecord(ctx,owner,kind,id);
 await ctx.pool.query('DELETE FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 AND record_id=$3',[owner,kind,id]);
}


/** Immutable, idempotent planning receipt: a concurrent retry cannot overwrite the first approval. */
export async function savePlanApprovalOnce(ctx:AppContext,owner:string,planId:string,data:Data):Promise<Data> {
 const id='plan-approval:'+fingerprint([owner,'approval:'+planId]),createdAt=new Date().toISOString(),payload=JSON.stringify(data);
 if(Buffer.byteLength(payload)>1500000)throw new PortfolioError(413,'record_too_large','The planning receipt exceeds the storage limit.');
 const count=(await ctx.pool.query('SELECT record_id FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 LIMIT 501',[owner,'plan-approval'])).rows.length;
 if(count>=500)throw new PortfolioError(409,'record_limit','Archive older research before adding more records.');
 await ctx.pool.query('INSERT INTO oshal_trading_portfolio_records (record_id,user_sub,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_sub,record_id) DO NOTHING',[id,owner,'plan-approval',payload,createdAt]);
 return getRecord(ctx,owner,'plan-approval',id);
}
