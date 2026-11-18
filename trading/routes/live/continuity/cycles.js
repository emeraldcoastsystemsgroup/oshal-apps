/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read allocation cycles by identity and refuse stale replacements using the exact persisted payload.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Increment a persisted revision on every update so returning to an earlier state cannot admit an old snapshot.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Normalize exact native memory and PostgreSQL stale-write conflicts without hiding unrelated persistence errors.
 */
'use strict';
const {fingerprint}=require('../../trading-portfolio-store');
const {PortfolioError}=require('../../trading-portfolio-model');
const SNAPSHOT=Symbol('persisted cycle snapshot'),KIND='live-cycle';
const TABLE='oshal_trading_portfolio_records';
const changed=()=>new PortfolioError(409,'cycle_revision_changed','The allocation cycle changed. Reconcile its current evidence before continuing.');
const cycleId=(owner,key)=>`${KIND}:${fingerprint([owner,key])}`;

function revision(data){
 const value=Object.hasOwn(data,'executionRevision')?data.executionRevision:0;
 if(!Number.isSafeInteger(value)||value<0)throw changed();
 return value;
}

function record(owner,key,row){
 const payload=String(row.payload),data=JSON.parse(payload),id=cycleId(owner,key);
 if(row.record_id!==id||!data||typeof data!=='object'||Array.isArray(data)||data.key!==key)throw changed();
 const createdAt=new Date(row.created_at).toISOString(),result={...data,executionRevision:revision(data),id,createdAt};
 Object.defineProperty(result,SNAPSHOT,{value:Object.freeze({owner,key,payload,createdAt})});
 return result;
}

function serialize(key,data,executionRevision){
 if(!data||typeof data!=='object'||Array.isArray(data)||(data.key!==undefined&&data.key!==key))throw changed();
 const payload=JSON.stringify({...data,key,executionRevision});
 if(Buffer.byteLength(payload)>1500000)throw new PortfolioError(413,'record_too_large','This allocation cycle exceeds the storage limit.');
 return payload;
}

/**
 * @description Fetch one owner-bound cycle without scanning historical cycles.
 * @param {object} ctx Native package context. @param {string} owner Owner subject. @param {string} key Stable cycle key.
 * @returns {Promise<object|null>} The retained cycle and its private persisted snapshot, or null.
 */
async function readCycle(ctx,owner,key){
 const answer=await ctx.pool.query(`SELECT record_id, payload, created_at FROM ${TABLE} WHERE user_sub=$1 AND kind=$2 AND record_id=$3`,[owner,KIND,cycleId(owner,key)]);
 if(answer.rows.length>1)throw changed();
 return answer.rows.length?record(owner,key,answer.rows[0]):null;
}

/**
 * @description Preserve the first cycle created by competing invocations, then read the retained result.
 * @param {object} ctx Native context. @param {string} owner Owner subject. @param {string} key Cycle key. @param {object} data Initial cycle.
 * @returns {Promise<object>} The retained cycle; a repeat create cannot replace its progress.
 */
async function createCycle(ctx,owner,key,data){
 const payload=serialize(key,data,0),createdAt=new Date().toISOString();
 await ctx.pool.query(`INSERT INTO ${TABLE} (record_id,user_sub,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_sub,record_id) DO NOTHING`,[cycleId(owner,key),owner,KIND,payload,createdAt]);
 const retained=await readCycle(ctx,owner,key);
 if(!retained)throw changed();
 return retained;
}

/**
 * @description Replace exactly the observed cycle; failed comparisons are never retried or merged.
 * @param {object} ctx Native context. @param {string} owner Owner subject. @param {string} key Cycle key.
 * @param {object} before Record returned by this module. @param {object} after Replacement cycle data.
 * @returns {Promise<object>} The replacement with a fresh private snapshot; stale writes throw a 409.
 */
async function updateCycle(ctx,owner,key,before,after){
 const expected=before?.[SNAPSHOT],id=cycleId(owner,key);
 if(!expected||expected.owner!==owner||expected.key!==key||before.id!==id)throw changed();
 const previousRevision=revision(JSON.parse(expected.payload));
 if(previousRevision===Number.MAX_SAFE_INTEGER)throw changed();
 const payload=serialize(key,after,previousRevision+1);
 let answer;
 try{
  answer=await ctx.pool.query(`UPDATE ${TABLE} SET payload=$1 WHERE user_sub=$2 AND kind=$3 AND record_id=$4 AND payload=$5 RETURNING record_id`,[payload,owner,KIND,id,expected.payload]);
 }catch(error){
  if(/^(?:(?:refused: )?conflict: )?scoped collection revision(?: or expected body)? changed$/.test(String(error?.message??'')))throw changed();
  throw error;
 }
 if(answer.rows.length!==1||answer.rows[0].record_id!==id)throw changed();
 return record(owner,key,{record_id:id,payload,created_at:expected.createdAt});
}

module.exports={readCycle,createCycle,updateCycle};
