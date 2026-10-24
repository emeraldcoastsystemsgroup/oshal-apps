/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Owner runbooks: the person keeps one runbook per alert type (plain markdown, at most 16 KiB, revision-checked, own scope). An investigation for that alert type attaches it as evidence/runbook.md, the person's own operating guidance, unlike producer-supplied alert text; the investigation input digest covers it. Nothing is run from a runbook. */
// @ts-nocheck
import {createHash} from 'node:crypto';
import {processingTransaction} from './pipeline';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const MAX=16384,LIMIT=64;
const ownerRequired=owner=>{if(typeof owner!=='string'||!owner)fail(401,'A verified caller is required.');};
const key=alertType=>'runbook:'+createHash('sha256').update(alertType).digest('hex').slice(0,40);
const cleanType=v=>typeof v==='string'&&v.trim()===v&&v.length>=1&&v.length<=256&&!/[\u0000-\u001f]/.test(v);

/** @description The caller's runbooks, newest first, with their size and revision. */
export async function runbooks(pool,owner){
 ownerRequired(owner);
 const rows=(await pool.query("SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id LIKE 'runbook:%' LIMIT 65",[owner])).rows.map(r=>r.record);
 return {items:rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,LIMIT),limit:LIMIT,executionAuthorized:false};
}

/** @description The caller's runbook for one alert type, or null. */
export async function runbookFor(pool,owner,alertType){
 ownerRequired(owner);if(!cleanType(alertType))return null;
 return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,key(alertType)])).rows[0]?.record||null;
}

/** @description Save or replace the caller's runbook for one alert type; a stale revision is refused. */
export async function saveRunbook(pool,owner,input){
 ownerRequired(owner);
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['alertType','markdown','expectedRevision'].includes(k)))fail(400,'Send alertType, markdown and expectedRevision.');
 if(!cleanType(input.alertType))fail(400,'Name the alert type exactly as alerts carry it.');
 if(typeof input.markdown!=='string'||!input.markdown.trim()||input.markdown.length>MAX||input.markdown.includes('\u0000'))fail(400,'A runbook is 1 to 16384 characters of text.');
 if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'Invalid expectedRevision.');
 return processingTransaction(pool,async c=>{
  const held=(await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,key(input.alertType)])).rows[0]?.record;
  if((held?.revision||0)!==input.expectedRevision)fail(409,'This runbook changed; refresh before saving.');
  if(!held&&(await c.query("SELECT count(*)::int AS n FROM operations_processing_config WHERE user_sub=$1 AND id LIKE 'runbook:%'",[owner])).rows[0].n>=LIMIT)fail(409,'Remove a runbook before adding another (64 at most).');
  const record={alertType:input.alertType,markdown:input.markdown,sha256:createHash('sha256').update(input.markdown).digest('hex'),revision:input.expectedRevision+1,updatedAt:new Date().toISOString()};
  if(held)await c.query('UPDATE operations_processing_config SET revision=$3, record=$4 WHERE user_sub=$1 AND id=$2',[owner,key(input.alertType),record.revision,JSON.stringify(record)]);
  else await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,$3,$4)',[owner,key(input.alertType),record.revision,JSON.stringify(record)]);
  return record;
 });
}

/** @description Remove the caller's runbook for one alert type. */
export async function removeRunbook(pool,owner,input){
 ownerRequired(owner);if(!cleanType(input?.alertType))fail(400,'Name the alert type.');
 const removed=(await pool.query('DELETE FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,key(input.alertType)])).rowCount;
 return {removed:removed===1};
}
