/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve a verified replay receipt from owned immutable decisions, scans and packets, never client-supplied success counts. */
// @ts-nocheck
import {hash} from './intake';
import {reconstruct} from './topology-model';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const valid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const expected={deliveries:100,matched:40,filtered:60,survivors:4,suppressed:36,groups:2,evidencePackets:4};
function same(a,b){return JSON.stringify(a.slice().sort())===JSON.stringify(b.slice().sort());}
async function selected(pool,owner,table,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!valid(id)))fail(400,'Choose distinct recorded replay identifiers.');
 const slots=ids.map((_,i)=>'$'+(i+2)).join(',');const rows=(await pool.query('SELECT record FROM '+table+' WHERE user_sub=$1 AND id IN ('+slots+')',[owner,...ids])).rows.map(r=>r.record);
 if(rows.length!==ids.length)fail(404,'A replay record is unavailable in your scope.');return rows;
}
export async function completeReplay(ctx,owner,input){
 if(typeof owner!=='string'||!owner.trim())fail(401,'A verified caller is required.');
 if(!input||Object.keys(input).some(k=>!['decisionIds','correlationId'].includes(k))||!valid(input.correlationId))fail(400,'Submit recorded decision and correlation identifiers only.');
 const decisions=await selected(ctx.pool,owner,'operations_filter_decisions',input.decisionIds);
 if(new Set(decisions.map(d=>d.deliveryId)).size!==decisions.length)fail(400,'A replay cohort uses one frozen policy decision per delivery.');
 const sources=await ctx.store.query('sources'),registered=[...new Set(decisions.map(d=>d.sourceId))].map(id=>sources.find(s=>s.id===id));
 if(registered.some(s=>!s)||new Set(registered.map(s=>s.environment)).size!==1||!registered[0].environment.startsWith('replay-')||registered.some(s=>!s.source.startsWith('urn:triagenorth:replay:')))fail(400,'Saved scenario receipts require a separate explicitly synthetic replay environment.');
 const correlation=(await selected(ctx.pool,owner,'operations_topology_decisions',[input.correlationId]))[0],survivors=decisions.filter(d=>d.reduction?.workId);
 if(correlation.policy?.id!=='replay-dependencies-v1'||!same(correlation.deliveryIds,survivors.map(d=>d.deliveryId)))fail(409,'Correlation does not identify these exact surviving symptoms.');
 const packets=await selected(ctx.pool,owner,'operations_telemetry_packets',survivors.map(d=>d.reduction.workId));
 if(packets.some(p=>!survivors.some(d=>d.deliveryId===p.deliveryId&&d.reduction.workId===p.reservationId)))fail(409,'Evidence packets do not match the exact replay reservations.');
 const scans=await selected(ctx.pool,owner,'operations_topology_scans',correlation.scanIds);scans.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.id.localeCompare(b.id));
 if(hash(scans.map(s=>[s.id,s.payloadHash]))!==correlation.graphRevision)fail(409,'The recorded graph revision cannot be reconstructed.');
 const graph=reconstruct(scans,correlation.asOf);if(graph.assets.length>16||graph.relationships.length>32)fail(413,'Narrow the scenario graph before saving its receipt.');
 const actual={deliveries:decisions.length,matched:decisions.filter(d=>d.outcome==='matched').length,filtered:decisions.filter(d=>d.outcome==='unmatched').length,survivors:survivors.length,suppressed:decisions.filter(d=>d.reduction?.outcome==='suppressed').length,groups:correlation.groups.length,evidencePackets:packets.length};
 const id=hash(['replay-v1',input.decisionIds.slice().sort(),correlation.id]),previous=(await ctx.store.query('replays')).find(r=>r.id===id);if(previous)return {...previous,retry:true};
 const passed=Object.entries(expected).every(([key,value])=>actual[key]===value)&&correlation.status==='complete'&&packets.every(p=>p.observations.length>0);
 const body={id,scenario:'datacenter-dependency-v1',synthetic:true,environment:registered[0].environment,completedAt:correlation.createdAt,decisionIds:input.decisionIds.slice().sort(),expected,actual,passed,correlation,packets:packets.sort((a,b)=>a.id.localeCompare(b.id)),graph};
 if(Buffer.byteLength(JSON.stringify(body))>65536)fail(413,'Replay receipt exceeds 64 KiB.');
 const record={...body,sha256:hash(body)};await ctx.store.put('replays',id,record);return record;
}
