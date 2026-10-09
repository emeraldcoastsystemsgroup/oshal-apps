'use strict';
// The home summary GET /tasks answers (ADR-145 shape): readiness only when calling is enabled AND the saved connection is
// one of the caller's own, the newest runs as items, and the honesty notes; never a value the saved state does not carry.
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../routes/policy');
const CONNECTION='11111111-1111-4111-8111-111111111111';
const now=new Date('2026-09-28T04:00:00.000Z');
const enabled={...P.defaults,enabled:true,connectionId:CONNECTION,from:'+12025550101'};
const runs=[
 {id:'r3',status:'done',outcome:'transferred',created_at:new Date('2026-09-27T20:00:00.000Z')},
 {id:'r2',status:'failed',outcome:null,created_at:'2026-09-26T20:00:00.000Z'},
 {id:'r1',status:'done',outcome:'completed',created_at:'not a date'},
 {id:'r0',status:'cancelled',outcome:'cancelled',created_at:'2026-09-24T20:00:00.000Z'}
];

test('ready only when enabled and the saved connection is still one of the caller’s own',()=>{
 const s=P.summary(enabled,[{id:CONNECTION,label:'Fixture'}],runs,now);
 assert.deepEqual(s.tiles.map(t=>[t.id,t.value,t.tone]),[['calling','Ready','good'],['runs','4','neutral'],['last','transferred','neutral']]);
 assert.equal(s.metrics,s.tiles);
 assert.equal(s.asOf,'2026-09-28T04:00:00.000Z');assert.equal(s.partial,false);
 assert.equal(s.items[s.items.length-2].text,'Calls go out from +12025550101 over your own Twilio connection, to approved destinations only.');
 const off=P.summary({...P.defaults},[],[],now);
 assert.deepEqual(off.tiles.map(t=>[t.id,t.value,t.tone]),[['calling','Off','neutral'],['runs','0','neutral'],['last','None','neutral']]);
 assert.equal(off.items.length,2);assert.match(off.items[0].text,/^Calling is off until/);
 const orphaned=P.summary(enabled,[{id:'22222222-2222-4222-8222-222222222222',label:'Other'}],[],now);
 assert.equal(orphaned.tiles[0].value,'No connection');assert.equal(orphaned.tiles[0].tone,'neutral');
});

test('items are the three newest runs as saved, a failed run warns, and a bad timestamp is said, not guessed',()=>{
 const s=P.summary(enabled,[{id:CONNECTION}],runs,now);
 assert.equal(s.items.length,5);
 assert.deepEqual(s.items.slice(0,3).map(i=>[i.text,i.detail,i.tone,i.fix]),[
  ['Call done','transferred · 2026-09-27T20:00:00.000Z','neutral','calling-settings'],
  ['Call failed','no outcome recorded · 2026-09-26T20:00:00.000Z','warn','calling-settings'],
  ['Call done','completed · time not recorded','neutral','calling-settings']]);
 assert.match(s.items[4].text,/not proof of what the destination heard/);
 const failedLast=P.summary(enabled,[{id:CONNECTION}],[runs[1]],now);
 assert.deepEqual(failedLast.tiles[2],{id:'last',label:'Last outcome',value:'failed',tone:'warn'});
});

test('malformed inputs degrade to the off state instead of throwing',()=>{
 for(const bad of [null,undefined,'x',[],42]){
  const s=P.summary(bad,bad,bad,now);
  assert.equal(s.tiles[0].value,'Off');assert.equal(s.tiles[1].value,'0');assert.equal(s.items.length,2);
 }
 const mixed=P.summary(enabled,[{id:CONNECTION}],[null,'r',{status:'done',outcome:'ok',created_at:'2026-09-24T20:00:00.000Z'}],now);
 assert.equal(mixed.tiles[1].value,'1');assert.equal(mixed.items[0].text,'Call done');
});
