'use strict';
// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Enqueue native signed audio durably before acknowledgement and resume canonical processing through private worker proof.
const {randomUUID,createHash} = require('node:crypto');
const P = require('./policy');
const terminal = new Set(['completed','failed','cancelled','uncertain','expired']);
/** Shared by the registered tool, web UI and callbacks; no Jarvis dependency. */
class CallingService {
  constructor({pool,carrier,transcribe,enqueueAudio,now=()=>Date.now()}) { Object.assign(this,{pool,carrier,transcribe,enqueueAudio,now}); }
  async settings(actor) { return (await this.pool.query('SELECT config FROM calling_settings WHERE owner_sub=$1 AND owner_issuer=$2',[actor.sub,actor.issuer])).rows[0]?.config ?? {...P.defaults}; }
  async save(actor,value) {
    const c=P.config(value);
    await this.pool.query(`INSERT INTO calling_settings(owner_sub,owner_issuer,config) VALUES($1,$2,$3)
      ON CONFLICT(owner_sub,owner_issuer) DO UPDATE SET config=$3,updated_at=now()`,[actor.sub,actor.issuer,c]); return c;
  }
  async run(id,actor) {
    if (!P.uuid.test(id)) throw P.fault('task_not_found',404);
    const r=(await this.pool.query('SELECT * FROM calling_runs WHERE id=$1 AND owner_sub=$2 AND owner_issuer=$3',[id,actor.sub,actor.issuer])).rows[0];
    if (!r) throw P.fault('task_not_found',404); return r;
  }
  async event(id,kind,detail={}) { await this.pool.query('INSERT INTO calling_events(run_id,kind,detail) VALUES($1,$2,$3)',[id,kind,detail]); }
  async setStatus(id,status,outcome) { await this.pool.query(`UPDATE calling_runs SET status=$2,outcome=$3,updated_at=now() WHERE id=$1 AND status IN ('dialing','active','transferring')`,[id,status,outcome]); }
  async start(actor,input) {
    const task=P.plan(input), hash=P.fingerprint(task);
    const prior=(await this.pool.query('SELECT id,request_hash FROM calling_runs WHERE owner_sub=$1 AND owner_issuer=$2 AND request_key=$3',[actor.sub,actor.issuer,task.idempotencyKey])).rows[0];
    if (prior) { if(prior.request_hash!==hash) throw P.fault('idempotency_conflict',409); return this.report(actor,prior.id); }
    const c=P.config(await this.settings(actor));
    if (!c.enabled) throw P.fault('calling_disabled',409);
    if (!c.allowedNumbers.includes(task.to)) throw P.fault('destination_not_allowed',403);
    if (c.maxMinutes*c.estimatedCentsPerMinute>c.maxCostCents) throw P.fault('estimated_budget_exceeded',409);
    const carrier=await this.carrier(actor,c.connectionId);
    if (!(await carrier.numbers()).some(n=>n.number===c.from)) throw P.fault('selected_sender_unavailable',409);
    const id=randomUUID();
    try { await this.pool.query('INSERT INTO calling_runs(id,owner_sub,owner_issuer,request_key,request_hash,task,config) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,actor.sub,actor.issuer,task.idempotencyKey,hash,task,c]); }
    catch(e) { if(e.code==='23505') { const replay=(await this.pool.query('SELECT id,request_hash FROM calling_runs WHERE owner_sub=$1 AND owner_issuer=$2 AND request_key=$3',[actor.sub,actor.issuer,task.idempotencyKey])).rows[0]; if(replay?.request_hash===hash) return this.report(actor,replay.id); throw P.fault('active_call_or_duplicate_request',409); } throw e; }
    await this.event(id,'task_started',{transport:'twilio',configurationScope:'person',executionOwner:actor.sub});
    try {
      const sid=await carrier.start({To:task.to,From:c.from,Url:P.hook(c,id,'answer'),Method:'POST',
        StatusCallback:P.hook(c,id,'status'),StatusCallbackMethod:'POST',StatusCallbackEvent:'completed',TimeLimit:String(c.maxMinutes*60),Timeout:'30'});
      await this.pool.query('UPDATE calling_runs SET call_sid=COALESCE(call_sid,$2),updated_at=now() WHERE id=$1',[id,sid]);
      const admitted=await this.run(id,actor);
      if(['cancelled','expired'].includes(admitted.status)) {
        try { await carrier.stop(sid); } catch { await this.event(id,'hangup_unconfirmed'); }
      }
      await this.event(id,'carrier_accepted',{callSid:sid});
    } catch(e) { await this.setStatus(id,'uncertain',e.code||'carrier_result_uncertain'); await this.event(id,'carrier_uncertain'); }
    return this.report(actor,id);
  }
  async report(actor,id) {
    const r=await this.run(id,actor);
    const [turns,events]=await Promise.all([this.pool.query('SELECT turn,status,transcript,decision,audio_sha256,audio_bytes,provider,error FROM calling_turns WHERE run_id=$1 ORDER BY turn',[id]),this.pool.query('SELECT kind,detail,created_at FROM calling_events WHERE run_id=$1 ORDER BY id LIMIT 500',[id])]);
    return {id:r.id,status:r.status,outcome:r.outcome,objective:r.task.objective,to:r.task.to,createdAt:r.created_at,turns:turns.rows,events:events.rows};
  }
  async cancel(actor,id) {
    const r=await this.run(id,actor);
    if(terminal.has(r.status)) return this.report(actor,id);
    await this.setStatus(id,'cancelled','owner_cancelled');
    if(r.call_sid) { try { await (await this.carrier(actor,r.config.connectionId)).stop(r.call_sid); }
      catch { await this.event(id,'hangup_unconfirmed'); } }
    return this.report(actor,id);
  }
  async callback(actor,id,action,turn,body) {
    const r=await this.run(id,actor), c=r.config;
    if(r.call_sid && r.call_sid!==body.CallSid) throw P.fault('call_sid_mismatch',403);
    if(action==='status') {
      if(['completed','busy','no-answer','failed','canceled'].includes(body.CallStatus)) await this.setStatus(id,body.CallStatus==='completed'?'completed':'failed','carrier_'+body.CallStatus);
      return P.wrap('<Hangup/>');
    }
    if(terminal.has(r.status)) return P.twiml({kind:'stop'},c,id,turn);
    const current=await this.settings(actor);
    if(!current.enabled || current.connectionId!==c.connectionId) { await this.setStatus(id,'cancelled','configuration_disabled_or_changed'); return P.twiml({kind:'stop'},c,id,turn); }
    if(this.now()-new Date(r.created_at).getTime()>c.maxMinutes*60000 || turn>=c.maxTurns) { await this.setStatus(id,'expired','limit_reached'); return P.twiml({kind:'stop'},c,id,turn); }
    if(action==='answer') {
      if(turn!==0 || !/^CA[0-9a-f]{32}$/i.test(body.CallSid)) throw P.fault('invalid_answer');
      await this.pool.query("UPDATE calling_runs SET status='active',call_sid=$2 WHERE id=$1 AND status='dialing' AND (call_sid IS NULL OR call_sid=$2)",[id,body.CallSid]);
      await this.pool.query('INSERT INTO calling_turns(run_id,turn) VALUES($1,0) ON CONFLICT DO NOTHING',[id]);
      return P.twiml({kind:'say',text:c.introduction},c,id,0);
    }
    if(action==='transfer') { await this.setStatus(id,body.DialCallStatus==='completed'?'completed':'failed','handoff_'+body.DialCallStatus); return P.wrap('<Hangup/>'); }
    const row=(await this.pool.query('SELECT * FROM calling_turns WHERE run_id=$1 AND turn=$2',[id,turn])).rows[0];
    if(!row) throw P.fault('unexpected_turn',409);
    if(action==='audio') {
      if(body.RecordingStatus==='failed') { await this.pool.query("UPDATE calling_turns SET status='ready',decision=$3,error='recording_failed',completed_at=now() WHERE run_id=$1 AND turn=$2 AND status='waiting'",[id,turn,{kind:'stop',reason:'recording_failed'}]); }
      else if(body.RecordingStatus==='absent') { await this.pool.query("UPDATE calling_turns SET status='ready',decision=$3,completed_at=now() WHERE run_id=$1 AND turn=$2 AND status='waiting'",[id,turn,{kind:'wait',reason:'no_recording'}]); }
      else if(body.RecordingStatus==='completed' && /^RE[0-9a-f]{32}$/i.test(body.RecordingSid)) {
        if(this.enqueueAudio) {
          // The native signed-callback boundary persists work before returning to the carrier.
          await this.enqueueAudio({id,turn,recordingSid:body.RecordingSid});
        } else {
          const claim=await this.pool.query("UPDATE calling_turns SET status='processing',recording_sid=$3,started_at=now() WHERE run_id=$1 AND turn=$2 AND status='waiting' RETURNING turn",[id,turn,body.RecordingSid]);
          if(claim.rows.length) void this.processAudio(actor,r,turn,body.RecordingSid).catch(()=>{});
        }
      }
      return P.wrap('');
    }
    if(action==='recorded' || action==='poll') {
      if(row.status==='processing' && this.now()-new Date(row.started_at).getTime()>90000) {
        await this.setStatus(id,'failed','audio_processing_timeout'); return P.twiml({kind:'stop'},c,id,turn);
      }
      if(row.status!=='ready') return P.twiml({kind:'pending'},c,id,turn);
      const decision=row.decision;
      if(decision.kind==='stop') await this.setStatus(id,'failed',decision.reason);
      if(decision.kind==='transfer') await this.setStatus(id,'transferring',decision.reason);
      if(!['stop','transfer'].includes(decision.kind)) await this.pool.query('INSERT INTO calling_turns(run_id,turn) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,turn+1]);
      const remainingSeconds=Math.max(1,Math.floor((c.maxMinutes*60000-(this.now()-new Date(r.created_at).getTime()))/1000));
      return P.twiml(decision,{...c,remainingSeconds},id,turn+1);
    }
    throw P.fault('unknown_callback',404);
  }
  /** Called only after the native route has obtained its private worker proof. */
  async workAudio(actor,id,turn,sid) {
    const r=await this.run(id,actor);
    const row=(await this.pool.query('SELECT * FROM calling_turns WHERE run_id=$1 AND turn=$2',[id,turn])).rows[0];
    if(!row || (row.recording_sid && row.recording_sid!==sid) || !/^RE[0-9a-f]{32}$/i.test(sid)) throw P.fault('audio_work_mismatch',403);
    if(row.status==='waiting') {
      const claimed=await this.pool.query("UPDATE calling_turns SET status='processing',recording_sid=$3,started_at=now() WHERE run_id=$1 AND turn=$2 AND status='waiting' RETURNING turn",[id,turn,sid]);
      if(claimed.rows.length!==1) throw P.fault('audio_work_conflict',409);
    } else if(row.status==='ready') {
      // A crash after the SQL result commit must finish cleanup, never repeat interpretation.
      await (await this.carrier(actor,r.config.connectionId)).deleteAudio(sid);
      return;
    } else if(row.status!=='processing') throw P.fault('audio_work_state',409);
    await this.processAudio(actor,r,turn,sid);
  }
  async processAudio(actor,r,turn,sid) {
    let carrier;
    try {
      carrier=await this.carrier(actor,r.config.connectionId);
      const bytes=await carrier.audio(sid);
      const result=await interpretAudio(bytes,r.task,r.config,this.transcribe);
      await this.pool.query("UPDATE calling_turns SET status='ready',transcript=$3,decision=$4,audio_sha256=$5,audio_bytes=$6,provider=$7,completed_at=now() WHERE run_id=$1 AND turn=$2 AND status='processing'",[r.id,turn,result.transcript,result.decision,result.sha256,result.bytes,result.provider]);
      await this.event(r.id,'audio_interpreted',{turn,decision:result.decision.kind,audioSha256:result.sha256});
    } catch(e) {
      await this.pool.query("UPDATE calling_turns SET status='ready',decision=$3,error=$4,completed_at=now() WHERE run_id=$1 AND turn=$2 AND status='processing'",[r.id,turn,{kind:'stop',reason:'audio_unavailable'},e.code||'audio_processing_failed']);
    } finally {
      if(carrier) try { await carrier.deleteAudio(sid); } catch { await this.event(r.id,'recording_cleanup_failed',{recordingSid:sid}); }
    }
  }
}
async function interpretAudio(bytes,task,c,transcribe) {
  if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>4*1024*1024) throw P.fault('invalid_audio');
  let result;
  const silence = message => c.sttProvider==='local-stt' && /returned 422:.*"error"\s*:\s*"no_speech_detected"/.test(message||'');
  try { result=await transcribe(bytes,'audio/wav',{providerId:c.sttProvider,enableSegments:true}); }
  catch(e) { if(!silence(e.message)) throw e; result={text:'',providerId:c.sttProvider}; }
  if(result.fallback && silence(result.message)) result={text:'',providerId:c.sttProvider};
  if(result.fallback || typeof result.text!=='string') throw P.fault('speech_provider_unavailable',503);
  const transcript=result.text.slice(0,5000);
  return {transcript,decision:P.decide(transcript,task),provider:result.providerId,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
module.exports={CallingService,interpretAudio,terminal};
