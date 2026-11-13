/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require exact current native original-owner decision receipts instead of trusting a terminal status from global routes.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real private journal/outbox files with explicit native ticket-port fixtures, uncertainty recovery, exact action identity and no implicit human approval.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync, linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const decisions = require('../lib/career-source-decisions');
const requests = require('../lib/career-source-requests');
const action = () => ({id:7,companyId:42,company:'Example Employer',openedAt:'2026-11-10T09:00:00+00:00',evidence:{reviews:[{outcome:'nothing'}]}});

/** Explicit projected native receipt fixture; real receipt provenance is covered by installed kernel acceptance. */
function nativeDecision(row,status) {
  row.status=status; row.revision++;
  row.applicationDecision={version:1,app:'career-hunter',ticketId:row.ticketId,ticketType:row.ticketType,workflow:row.workflow,
    revision:row.revision,status,outcome:status==='done'?'approve':'cancel',ownerVerified:true};
}

function fixture(t) {
  const userDir = mkdtempSync(join(tmpdir(),'career-decision-'));
  t.after(() => rmSync(userDir,{recursive:true,force:true}));
  const rows = new Map(), calls = {create:0,start:0,list:0,get:0};
  let current = action(), loseCreate = false, loseStart = false;
  const tickets = {
    async listTickets(filter) { calls.list++; assert.deepEqual(filter,{ticketType:decisions.TYPE,ownerSub:'fixture-admin',limit:200}); return [...rows.values()].map(row=>({...row})); },
    async getTicket(id) { calls.get++; return rows.has(id) ? {...rows.get(id)} : null; },
    async createTicket(input) { calls.create++; assert.equal(input.ownerSub,'fixture-admin'); const id=randomUUID();
      rows.set(id,{ticketId:id,ticketType:input.ticketType,workflow:decisions.WORKFLOW,status:'queued',revision:0,title:input.title,description:input.description});
      if (loseCreate) throw new Error('create response lost'); return {ticketId:id}; },
    async startTicket(id,input) { calls.start++; assert.equal(input.executor,'native'); assert.equal(input.files.length,0);
      assert.ok(input.limits.wall_ms > 0 && input.limits.output_tokens > 0 && input.limits.artifact_bytes > 0,'actual native limits contract');
      rows.get(id).status='awaiting_approval'; rows.get(id).revision++; if (loseStart) throw new Error('start response lost'); return {status:'awaiting_approval'}; },
  };
  const options = {userDir,ownerSub:'fixture-admin',tickets,currentAction:()=>current,changeState:()=>null};
  return {options,rows,calls,setCurrent:value=>{current=value;},loseCreate:()=>{loseCreate=true;},loseStart:()=>{loseStart=true;},
    async ready() { const result=await decisions.sync(options,action()); assert.equal(result.state,'awaiting_approval',JSON.stringify(result)); return result; },
    outbox() { try{return readdirSync(join(userDir,'.source-request-outbox')).map(name=>JSON.parse(readFileSync(join(userDir,'.source-request-outbox',name),'utf8')));}catch{return [];} }};
}

test('one exact owner/action creates and starts one named ticket; repeated sync reuses it without approving',async t=>{
  const f=fixture(t), first=await f.ready(), next=await f.ready();
  assert.equal(next.ticketId,first.ticketId); assert.deepEqual([f.calls.create,f.calls.start,f.outbox().length],[1,1,0]);
  assert.deepEqual(decisions.snapshot(f.options.userDir,'other-owner',[action()]),[]);
  assert.equal(decisions.snapshot(f.options.userDir,'fixture-admin',[action()])[0].ticketId,first.ticketId);
});

test('lost create acknowledgement is recovered by exact original-owner metadata without a second create',async t=>{
  const f=fixture(t); f.loseCreate();
  assert.equal((await decisions.sync(f.options,action())).state,'create_uncertain');
  const recovered=await f.ready(); assert.ok(recovered.ticketId); assert.equal(f.calls.create,1); assert.equal(f.calls.start,1);
});

test('a killed request losing its journal still recovers the deterministic native marker',async t=>{
  const f=fixture(t), first=await f.ready(); rmSync(join(f.options.userDir,'career-source-decisions.json'));
  assert.equal((await f.ready()).ticketId,first.ticketId); assert.equal(f.calls.create,1);
});

test('an uncertain create with no correlation proof stays held instead of making another ticket',async t=>{
  const f=fixture(t); f.options.tickets.createTicket=async()=>{f.calls.create++;throw new Error('unknown create');};
  assert.equal((await decisions.sync(f.options,action())).state,'create_uncertain');
  assert.notEqual((await decisions.sync(f.options,action())).state,'awaiting_approval');
  assert.equal(f.calls.create,1); assert.equal(f.outbox().length,0);
});

test('nameless, ambiguous and saturated200 recovery lists never create a guessed ticket',async t=>{
  for(const kind of ['nameless','ambiguous','full']) {
    const f=fixture(t), row={ticketId:randomUUID(),ticketType:decisions.TYPE,workflow:decisions.WORKFLOW,status:'queued',
      title:'Recorded decision',description:decisions.markerFor('fixture-admin',action())+'\nEvidence'};
    const rows=kind==='nameless'?[{...row,title:undefined}]:kind==='ambiguous'?[row,{...row,ticketId:randomUUID()}]
      :Array.from({length:200},()=>({...row,ticketId:randomUUID(),description:'another marker'}));
    f.options.tickets.listTickets=async()=>rows;
    const result=await decisions.sync(f.options,action()); assert.equal(f.calls.create,0,kind); assert.equal(f.calls.start,0,kind);
    assert.notEqual(result.state,'awaiting_approval',kind); assert.equal(f.outbox().length,0);
  }
});

test('lost start acknowledgement reads and continues the same ticket without redispatch',async t=>{
  const f=fixture(t); f.loseStart(); assert.equal((await decisions.sync(f.options,action())).state,'start_uncertain');
  await f.ready(); assert.deepEqual([f.calls.create,f.calls.start],[1,1]);
});

test('only verified own native Done or Cancelled queues deterministic conditional archive or keep; Failed never archives',async t=>{
  for(const [status,outcome] of [['done','archive'],['cancelled','keep'],['failed',null]]) {
    const f=fixture(t), ready=await f.ready(); nativeDecision(f.rows.get(ready.ticketId),status);
    const result=await decisions.sync(f.options,action(),ready.ticketId);
    assert.equal(result.state,outcome?'queued_next_pull':'attention',JSON.stringify(result));
    assert.equal(f.outbox().length,outcome?1:0);
    if(outcome) { assert.equal(result.outcome,outcome); assert.match(f.outbox()[0].target,new RegExp('^decision:7:.*:'+outcome+'$'));
      const again=await decisions.sync(f.options,action(),ready.ticketId); assert.equal(again.requestId,result.requestId); assert.equal(f.outbox().length,1); }
  }
});

test('foreign ticket references, stale action IDs, reopened dates and recovered sources leave no source write',async t=>{
  const f=fixture(t), ready=await f.ready();
  await assert.rejects(decisions.sync(f.options,action(),randomUUID()),/does not match/);
  nativeDecision(f.rows.get(ready.ticketId),'done');
  for(const current of [null,{...action(),id:8},{...action(),openedAt:'2026-11-11T09:00:00+00:00'}]) {
    f.setCurrent(current); assert.equal((await decisions.sync(f.options,action(),ready.ticketId)).state,'stale');
  }
  assert.equal(f.outbox().length,0);
});

test('fresh source identity is rechecked after the native read and before queueing',async t=>{
  const f=fixture(t), ready=await f.ready(); nativeDecision(f.rows.get(ready.ticketId),'done');
  let reads=0; f.options.currentAction=()=>++reads===1?action():null;
  assert.equal((await decisions.sync(f.options,action(),ready.ticketId)).state,'stale'); assert.equal(f.outbox().length,0);
});

test('a changed native marker/type/workflow cannot be adopted or queued',async t=>{
  for(const patch of [{ticketType:'other'},{workflow:'other'},{description:'foreign marker'}]) {
    const f=fixture(t), ready=await f.ready(); Object.assign(f.rows.get(ready.ticketId),patch,{status:'done'});
    assert.equal((await decisions.sync(f.options,action(),ready.ticketId)).state,'attention'); assert.equal(f.outbox().length,0); assert.equal(f.calls.create,1);
  }
});

test('actual next-pull result, not a queued receipt, establishes applied outcome',async t=>{
  const f=fixture(t), ready=await f.ready(); nativeDecision(f.rows.get(ready.ticketId),'done');
  const queued=await decisions.sync(f.options,action(),ready.ticketId); assert.equal(queued.state,'queued_next_pull');
  f.options.changeState=id=>id===queued.requestId?{state:'removed'}:null;
  assert.equal((await decisions.sync(f.options,action(),ready.ticketId)).state,'applied');
});

test('journal reads refuse symlinks, hardlinks, malformed records and excess bytes',async t=>{
  const f=fixture(t), name=join(f.options.userDir,'career-source-decisions.json');
  writeFileSync(join(f.options.userDir,'other.json'),'{}'); symlinkSync(join(f.options.userDir,'other.json'),name);
  assert.throws(()=>decisions.read(f.options.userDir)); rmSync(name);
  linkSync(join(f.options.userDir,'other.json'),name); assert.throws(()=>decisions.read(f.options.userDir)); rmSync(name);
  for(const text of ['{bad}',JSON.stringify({version:1,items:[],unexpected:true}),' '.repeat(1024*1024+1)]) {
    writeFileSync(name,text); assert.throws(()=>decisions.read(f.options.userDir));
  }
});

test('temporary missing native service cannot clear an uncertain create hold',async t=>{
  const f=fixture(t), native=f.options.tickets;
  native.createTicket=async()=>{f.calls.create++;throw new Error('create outcome unknown');};
  assert.equal((await decisions.sync(f.options,action())).state,'create_uncertain');
  f.options.tickets=null;
  assert.equal((await decisions.sync(f.options,action())).state,'create_uncertain');
  f.options.tickets=native;
  await decisions.sync(f.options,action());
  assert.equal(f.calls.create,1,'restored empty listing cannot justify another create');
});

test('actual closed source action may be reconciled only from its exact recorded next-pull result',async t=>{
  const f=fixture(t), ready=await f.ready(); nativeDecision(f.rows.get(ready.ticketId),'cancelled');
  const queued=await decisions.sync(f.options,action(),ready.ticketId); f.setCurrent(null);
  f.options.changeState=id=>id===queued.requestId?{state:'kept'}:null;
  assert.equal((await decisions.sync(f.options,action(),ready.ticketId)).state,'applied');
  assert.equal(f.outbox().length,1,'reading the finished outcome cannot requeue');
});

test('a FIFO journal is refused without waiting for a writer',t=>{
  const f=fixture(t), name=join(f.options.userDir,'career-source-decisions.json');
  const fifo=spawnSync('mkfifo',[name],{encoding:'utf8'}); assert.equal(fifo.status,0,fifo.stderr);
  const program="try { require(process.argv[1]).read(process.argv[2]); process.exit(2); } catch { process.exit(0); }";
  const child=spawnSync(process.execPath,['-e',program,fileURLToPath(new URL('../lib/career-source-decisions.js',import.meta.url)),f.options.userDir],{timeout:2000,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr || child.error?.message); assert.equal(child.signal,null);
});


test('terminal status without exact current verified own application decision proof never queues',async t=>{
  for(const patch of [null,{app:'other-application'},{ownerVerified:false},{ticketId:randomUUID()},{revision:999},{ticketType:'other'},
      {workflow:'other'},{outcome:'cancel'},{status:'cancelled'},{version:2},{unexpected:true}]) {
    const f=fixture(t), ready=await f.ready(), row=f.rows.get(ready.ticketId);
    nativeDecision(row,'done');
    if(patch===null)delete row.applicationDecision; else Object.assign(row.applicationDecision,patch);
    const result=await decisions.sync(f.options,action(),ready.ticketId);
    assert.equal(result.state,'attention',JSON.stringify(patch)); assert.equal(f.outbox().length,0,JSON.stringify(patch));
  }
});
