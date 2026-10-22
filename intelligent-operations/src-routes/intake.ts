/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Admit source deliveries, attempts and pending processing atomically under the native caller. */
// @ts-nocheck
import {createHash, randomUUID} from 'node:crypto';
const Mapping = require('../ui/adapter-mapping.js');

/** Canonical JSON preserves array order and values while removing object-key ordering from identity. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = (status,message) => {throw Object.assign(Error(message),{status});};
const identified = value => typeof value==='string' && value.length>0 && value.length<=256 && value.trim()===value && !/[\x00-\x1f\x7f]/.test(value);
const conflict = e => ['40001','40P01','23505'].includes(e.code) || /scoped collection revision changed/.test(e.message);

/** The caller is supplied by OSHAL, never by a payload. Commit precedes every acknowledgement. */
export async function admit(pool, owner, source, raw) {
  if (!identified(owner)) fail(401,'A verified OSHAL caller is required.');
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail(400,'One alert object is required.');
  if (Buffer.byteLength(JSON.stringify(raw))>65536) fail(413,'Record exceeds 64 KiB.');
  const result=Mapping.normalize(JSON.stringify(raw),source.mapping,source.source);
  const reasons=result.ok ? [] : [...result.errors];
  if (result.ok && result.normalized.data.environment!==source.environment) reasons.push({path:'data.environment',message:'Event environment does not match its registered source.'});
  const valid=result.ok && reasons.length===0, payloadHash=hash(raw);
  // Source authority comes from the registered revision, including when the payload forges its source.
  const eventId=identified(raw.id)?raw.id:null;
  const id=hash(['delivery-v1',source.source,eventId===null?['unidentified',payloadHash]:['event',eventId]]);
  const attemptId=randomUUID(), receivedAt=new Date().toISOString();
  const proposed={id,sourceId:source.id,source:source,receivedAt,raw,payloadHash,
    normalized:valid?result.normalized:null,identity:valid?{delivery:result.deliveryIdentity,symptom:result.symptomIdentity}:null,
    decision:valid?'validated':'quarantined',reasons:valid?['Committed to the processing queue.']:reasons};
  for(let retry=0;retry<8;retry++) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const rows=(await client.query('SELECT payload_hash, record FROM operations_deliveries WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows;
      const previous=rows[0];
      const outcome=previous?(previous.payload_hash===payloadHash?'retry':'conflict'):proposed.decision;
      const attempt={id:attemptId,deliveryId:id,sourceId:source.id,payloadHash,receivedAt,outcome,
        ...(outcome==='conflict'?{raw}:{}),
        reasons:outcome==='conflict'?['This source reused an event ID with different content. The original delivery is unchanged.']:proposed.reasons};
      if (!previous) {
        await client.query('INSERT INTO operations_deliveries (user_sub,id,source_uri,event_id,payload_hash,source_revision,record,received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[owner,id,source.source,eventId,payloadHash,source.id,JSON.stringify(proposed),receivedAt]);
        if(valid) await client.query('INSERT INTO operations_processing (user_sub,id,delivery_id,state,revision,record,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[owner,id,id,'pending',0,JSON.stringify({deliveryId:id,sourceId:source.id}),receivedAt]);
      }
      await client.query('INSERT INTO operations_delivery_attempts (user_sub,id,delivery_id,outcome,record,received_at) VALUES ($1,$2,$3,$4,$5,$6)',[owner,attemptId,id,outcome,JSON.stringify(attempt),receivedAt]);
      await client.query('COMMIT');
      return {status:outcome==='conflict'?409:previous?200:201,record:previous?.record||proposed,attempt,retry:outcome==='retry'};
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      // Only proven transaction conflicts retry here. A missing COMMIT response is an uncertain outcome.
      if(!conflict(error)||retry===7)throw error;
    } finally {await client.release();}
  }
}

/** Reads retain bounded pages and caller scope; old manual-import records remain separately identifiable. */
export async function intakeRecords(pool,owner) {
  if(!identified(owner))fail(401,'A verified OSHAL caller is required.');
  const read=async table=>(await pool.query(`SELECT record FROM ${table} WHERE user_sub=$1 ORDER BY received_at DESC LIMIT 200`,[owner])).rows.map(r=>r.record);
  const [events,attempts,processing]=await Promise.all([read('operations_deliveries'),read('operations_delivery_attempts'),
    pool.query('SELECT id, delivery_id, state, revision, created_at FROM operations_processing WHERE user_sub=$1 ORDER BY created_at DESC LIMIT 200',[owner]).then(r=>r.rows)]);
  return {events,attempts,processing};
}
