/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise cycle identity, insert-once creation and stale-write refusal through a synthetic SQL port.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Refuse stale snapshots after repeated states and no-op writes, including legacy and invalid revision evidence.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Recognize exact memory and PostgreSQL stale-write conflicts while preserving winning state and unrelated errors.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fingerprint}=require('../routes/trading-portfolio-store');
const {readCycle,createCycle,updateCycle}=require('../routes/live/continuity/cycles');
const TABLE='oshal_trading_portfolio_records',KIND='live-cycle',OWNER='synthetic-owner',KEY='synthetic-month';
const idFor=(owner,key)=>`${KIND}:${fingerprint([owner,key])}`;
const conflict=error=>error.status===409&&error.code==='cycle_revision_changed';

/** This double checks the app's SQL contract; it is not native persistence or row-security proof. */
function fixture(){
 const rows=new Map(),queries=[];
 const query=async(sql,args)=>{
  queries.push({sql,args});
  if(sql===`SELECT record_id, payload, created_at FROM ${TABLE} WHERE user_sub=$1 AND kind=$2 AND record_id=$3`){
   const row=rows.get(`${args[0]}:${args[2]}`);return{rows:row&&row.kind===args[1]?[{...row}]:[]};
  }
  if(sql===`INSERT INTO ${TABLE} (record_id,user_sub,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_sub,record_id) DO NOTHING`){
   const key=`${args[1]}:${args[0]}`;
   if(!rows.has(key))rows.set(key,{record_id:args[0],user_sub:args[1],kind:args[2],payload:args[3],created_at:args[4]});
   return{rows:[]};
  }
  if(sql===`UPDATE ${TABLE} SET payload=$1 WHERE user_sub=$2 AND kind=$3 AND record_id=$4 AND payload=$5 RETURNING record_id`){
   const row=rows.get(`${args[1]}:${args[3]}`);
   if(!row||row.kind!==args[2]||row.payload!==args[4])return{rows:[]};
   row.payload=args[0];return{rows:[{record_id:row.record_id}]};
  }
  throw Error('Unexpected SQL; a whole-kind scan or unguarded write is not admitted by this fixture.');
 };
 return{rows,queries,ctx:{pool:{query}}};
}

test('cycle reads are keyed, owner-isolated and missing rows return null',async()=>{
 const h=fixture();assert.equal(await readCycle(h.ctx,OWNER,KEY),null);
 const first=await createCycle(h.ctx,OWNER,KEY,{status:'in-progress'});
 assert.equal(first.id,idFor(OWNER,KEY));assert.equal(first.key,KEY);
 assert.equal(await readCycle(h.ctx,'another-owner',KEY),null);
 assert.equal(await readCycle(h.ctx,OWNER,'another-cycle'),null);
 const other=await createCycle(h.ctx,'another-owner',KEY,{status:'completed'});
 assert.notEqual(first.id,other.id);assert.equal((await readCycle(h.ctx,OWNER,KEY)).status,'in-progress');
});

test('repeated and competing creation preserves the first retained cycle',async()=>{
 const h=fixture();
 const [first,second]=await Promise.all([createCycle(h.ctx,OWNER,KEY,{status:'original'}),createCycle(h.ctx,OWNER,KEY,{status:'replacement'})]);
 assert.equal(first.status,'original');assert.deepEqual(second,first);
 assert.equal(h.rows.size,1);
});

test('two readers cannot overwrite one another: stale exact-payload replacement is refused once',async()=>{
 const h=fixture();await createCycle(h.ctx,OWNER,KEY,{progress:0});
 const a=await readCycle(h.ctx,OWNER,KEY),b=await readCycle(h.ctx,OWNER,KEY);
 const saved=await updateCycle(h.ctx,OWNER,KEY,a,{progress:1});assert.equal(saved.progress,1);
 const count=h.queries.length;
 await assert.rejects(updateCycle(h.ctx,OWNER,KEY,b,{progress:2}),conflict);
 assert.equal(h.queries.length,count+1,'a failed compare does not reread, retry or merge');
 assert.equal((await readCycle(h.ctx,OWNER,KEY)).progress,1);
 const final=await updateCycle(h.ctx,OWNER,KEY,saved,{progress:3});
 assert.equal(final.progress,3);assert.equal(final.createdAt,a.createdAt);
});

test('the hidden snapshot preserves exact raw JSON despite metadata and caller mutation',async()=>{
 const h=fixture(),raw='{ "key": "synthetic-month", "progress": 0 }',id=idFor(OWNER,KEY);
 h.rows.set(`${OWNER}:${id}`,{record_id:id,user_sub:OWNER,kind:KIND,payload:raw,created_at:'2026-10-30T20:15:00Z'});
 const before=await readCycle(h.ctx,OWNER,KEY);before.progress=99;
 const after=await updateCycle(h.ctx,OWNER,KEY,before,{progress:1});
 assert.equal(h.queries.at(-1).args[4],raw);
 assert.equal(after.createdAt,'2026-10-30T20:15:00.000Z');
 assert.equal(Object.getOwnPropertyDescriptor(before,Object.getOwnPropertySymbols(before)[0]).enumerable,false);
 assert.equal(Object.getOwnPropertySymbols({...before}).length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(after)),{progress:1,key:KEY,executionRevision:1,id,createdAt:'2026-10-30T20:15:00.000Z'});
});

test('serialized, cross-owner and cross-cycle snapshots cannot authorize a replacement',async()=>{
 const h=fixture(),before=await createCycle(h.ctx,OWNER,KEY,{progress:0}),count=h.queries.length;
 for(const [owner,key,snapshot] of [[OWNER,KEY,{...before}],['another-owner',KEY,before],[OWNER,'another-cycle',before]]){
  await assert.rejects(updateCycle(h.ctx,owner,key,snapshot,{progress:1}),conflict);
 }
 assert.equal(h.queries.length,count,'invalid snapshot identity is refused before SQL');
});

test('more than 500 historical cycles do not impose an app-wide cycle scan',async()=>{
 const h=fixture();
 for(let i=0;i<601;i++){
  const id=idFor(OWNER,`old-${i}`);h.rows.set(`${OWNER}:${id}`,{record_id:id,user_sub:OWNER,kind:KIND,payload:JSON.stringify({key:`old-${i}`}),created_at:'2026-10-01T00:00:00Z'});
 }
 const saved=await createCycle(h.ctx,OWNER,KEY,{progress:0});
 assert.equal((await readCycle(h.ctx,OWNER,KEY)).id,saved.id);
 assert.equal(h.rows.size,602);
 assert.ok(h.queries.every(q=>!q.sql.includes('ORDER BY')&&!q.sql.includes('LIMIT')));
 assert.equal(h.queries.filter(q=>q.sql.startsWith('SELECT')).length,2);
});

for(const [backend,message] of [
 ['memory','scoped collection revision changed'],
 ['PostgreSQL','scoped collection revision or expected body changed']
])test(backend+' stale-write conflicts preserve the winning cycle without rereading or retrying',async()=>{
 for(const prefix of ['', 'conflict: ', 'refused: conflict: ']){
  const h=fixture(),before=await createCycle(h.ctx,OWNER,KEY,{progress:0});
  const winner=await updateCycle(h.ctx,OWNER,KEY,before,{progress:1});
  const retained=h.rows.get(`${OWNER}:${before.id}`).payload;let attempts=0;
  const ctx={pool:{query:async()=>{attempts++;throw Error(prefix+message);}}};
  await assert.rejects(updateCycle(ctx,OWNER,KEY,before,{progress:2}),conflict);
  assert.equal(attempts,1,'a native conflict cannot trigger a reread, retry or merge');
  assert.equal(h.rows.get(`${OWNER}:${before.id}`).payload,retained);
  assert.deepEqual(await readCycle(h.ctx,OWNER,KEY),winner);
 }
});

test('messages merely containing a native conflict phrase keep their original error identity',async()=>{
 const h=fixture(),before=await createCycle(h.ctx,OWNER,KEY,{progress:0});
 for(const message of ['unavailable: scoped collection revision changed','conflict: scoped collection revision changed unexpectedly','scoped collection revision or expected body changed: storage unavailable']){
  const error=Error(message);let attempts=0;
  const ctx={pool:{query:async()=>{attempts++;throw error;}}};
  await assert.rejects(updateCycle(ctx,OWNER,KEY,before,{progress:1}),e=>e===error);
  assert.equal(attempts,1);assert.equal((await readCycle(h.ctx,OWNER,KEY)).progress,0);
 }
});

test('unavailable native persistence is propagated without fabricating a successful update',async()=>{
 const h=fixture(),before=await createCycle(h.ctx,OWNER,KEY,{progress:0}),error=Error('synthetic store unavailable');
 const ctx={pool:{query:async()=>{throw error;}}};
 await assert.rejects(updateCycle(ctx,OWNER,KEY,before,{progress:1}),e=>e===error);
 assert.equal((await readCycle(h.ctx,OWNER,KEY)).progress,0);
});

test('oversized cycle data and changed payload identity are rejected before any write',async()=>{
 const h=fixture();
 await assert.rejects(createCycle(h.ctx,OWNER,KEY,{value:'x'.repeat(1500000)}),e=>e.status===413&&e.code==='record_too_large');
 await assert.rejects(createCycle(h.ctx,OWNER,KEY,{key:'wrong-cycle'}),conflict);
 assert.equal(h.queries.length,0);
});

test('a state returning from A through B to A cannot admit the old A snapshot',async()=>{
 const h=fixture(),a=await createCycle(h.ctx,OWNER,KEY,{state:'A',executionRevision:99});
 assert.equal(a.executionRevision,0,'creation starts at zero regardless of caller input');
 const b=await updateCycle(h.ctx,OWNER,KEY,a,{state:'B',executionRevision:500});
 const returned=await updateCycle(h.ctx,OWNER,KEY,b,{state:'A',executionRevision:-1});
 assert.equal(b.executionRevision,1);assert.equal(returned.executionRevision,2);
 assert.equal(returned.createdAt,a.createdAt);
 await assert.rejects(updateCycle(h.ctx,OWNER,KEY,a,{state:'stale'}),conflict);
 assert.equal((await readCycle(h.ctx,OWNER,KEY)).state,'A');
});

test('a no-op replacement consumes its snapshot and cannot be repeated by a stale writer',async()=>{
 const h=fixture(),before=await createCycle(h.ctx,OWNER,KEY,{progress:0});
 const saved=await updateCycle(h.ctx,OWNER,KEY,before,{progress:0});
 assert.equal(saved.executionRevision,1);assert.equal(saved.createdAt,before.createdAt);
 await assert.rejects(updateCycle(h.ctx,OWNER,KEY,before,{progress:0}),conflict);
 assert.equal((await readCycle(h.ctx,OWNER,KEY)).executionRevision,1);
});

test('legacy revision is zero and the immutable persisted snapshot determines its first increment',async()=>{
 const h=fixture(),id=idFor(OWNER,KEY),createdAt='2026-10-30T20:15:00.000Z';
 h.rows.set(`${OWNER}:${id}`,{record_id:id,user_sub:OWNER,kind:KIND,payload:JSON.stringify({key:KEY,progress:0}),created_at:createdAt});
 const before=await readCycle(h.ctx,OWNER,KEY);assert.equal(before.executionRevision,0);
 before.executionRevision=100;
 const after=await updateCycle(h.ctx,OWNER,KEY,before,{progress:1,executionRevision:1000});
 assert.equal(after.executionRevision,1);assert.equal(after.createdAt,createdAt);
});

test('invalid stored revisions and exhausted safe integer revisions cannot authorize writes',async()=>{
 const h=fixture(),id=idFor(OWNER,KEY),rowKey=`${OWNER}:${id}`;
 for(const executionRevision of [-1,1.5,'1',null,Number.MAX_SAFE_INTEGER+1]){
  h.rows.set(rowKey,{record_id:id,user_sub:OWNER,kind:KIND,payload:JSON.stringify({key:KEY,executionRevision}),created_at:'2026-10-30T20:15:00Z'});
  await assert.rejects(readCycle(h.ctx,OWNER,KEY),conflict);
 }
 h.rows.get(rowKey).payload=JSON.stringify({key:KEY,executionRevision:Number.MAX_SAFE_INTEGER});
 const before=await readCycle(h.ctx,OWNER,KEY),count=h.queries.length;
 await assert.rejects(updateCycle(h.ctx,OWNER,KEY,before,{}),conflict);
 assert.equal(h.queries.length,count,'revision overflow is refused before SQL');
});
