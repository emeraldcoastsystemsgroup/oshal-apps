'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./fixtures/personal-calendar.cjs');
test('real HTTP + forced-RLS calendar merges past/ongoing spans and snapshot under the original owner', {timeout:30000},async()=>{
 const f=await fixture();try{
 const trip=await f.seed('alice',{title:'Ongoing trip',start:'2026-09-29T23:00:00-05:00',end:'2026-10-03T00:00:00-05:00'});assert.equal(trip.status,201);
 await f.seed('bob',{title:'Foreign appointment',start:'2026-10-01'});
 await f.snapshot('alice',[{id:'google',title:'Google holiday',start:'2026-10-02',end:'2026-10-04',allDay:true}], '2026-10-01T12:00:00Z');
 const route='/api/calendar/events/agenda?from=2026-10-01&to=2026-10-31&tz=America%2FChicago';
 const mine=await f.call('GET',route);assert.equal(mine.status,200);assert.deepEqual(mine.body.events.map(e=>e.title),['Ongoing trip','Google holiday']);assert.equal(mine.body.events[0].lastDay,'2026-10-02');assert.equal(mine.body.snapshot.complete,false);
 const other=await f.call('GET',route,null,'bob');assert.deepEqual(other.body.events.map(e=>e.title),['Foreign appointment']);assert.equal(other.body.snapshot.state,'missing');
 assert.equal((await f.call('DELETE','/api/calendar/events/'+trip.body.event.id,null,'bob')).status,404);
 assert.equal((await f.scoped('bob','SELECT * FROM calendar_own_events WHERE user_sub=$1',['alice'])).rows.length,0);
 await assert.rejects(f.scoped('bob',"INSERT INTO calendar_own_events(user_sub,id,title,starts_at,created_at) VALUES('alice','foreign','Denied','2026-10-01',now())"),/row-level security/);
 await f.snapshot('alice',[{id:'bad',title:'Invalid saved time',start:'bad'}],'2026-10-01T12:00:00Z');const partial=await f.call('GET',route);assert.equal(partial.body.partial,true);assert.equal(partial.body.warnings.length,1);assert.equal(partial.body.events[0].title,'Ongoing trip');
 assert.equal((await f.call('GET',route,null,null)).status,401);
 assert.equal((await f.call('GET',route+'&owner=bob')).status,400);
 assert.equal((await f.call('GET',route,null,'alice',{'x-oshal-tenant-id':'other'})).status,400);
 await f.snapshot('alice',Array.from({length:251},()=>({title:'Overflow',start:'2026-10-01',allDay:true})),'2026-10-01T12:00:00Z');assert.equal((await f.call('GET',route)).body.error,'calendar_snapshot_invalid_or_overflow');
 await f.snapshot('alice',[],'2026-10-01T12:00:00Z');await f.scoped('alice',"INSERT INTO calendar_own_events(user_sub,id,title,starts_at,all_day,created_at) SELECT 'alice','overflow-'||n,'overflow','2026-10-01',true,now() FROM generate_series(1,500) n");assert.equal((await f.call('GET',route)).body.error,'calendar_capacity_exceeded');
 }finally{await f.close();}
});
