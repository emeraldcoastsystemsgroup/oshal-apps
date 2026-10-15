'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{own}=require('./fixtures/personal-calendar.cjs');
test('closed bounded civil windows reject overrides, impossible dates and unknown zones',()=>{
 assert.deepEqual(own.agendaWindow({from:'2026-10-01',to:'2026-10-31',tz:'America/Chicago'}),{from:'2026-10-01',to:'2026-10-31',tz:'America/Chicago'});
 for(const q of [{from:'2026-02-30',to:'2026-03-01',tz:'UTC'},{from:'2026-01-01',to:'2026-03-04',tz:'UTC'},{from:'2026-03-04',to:'2026-01-01',tz:'UTC'},{from:'2026-10-01',to:'2026-10-31',tz:'US/Fake'},{from:'2026-10-01',to:'2026-10-31',tz:'UTC',owner:'bob'}])assert.throws(()=>own.agendaWindow(q));
});
test('timed spans cross DST and midnight correctly; all-day exclusive end never shifts',()=>{
 const timed=own.agendaEvent({id:'a',title:'Fall back',start:'2026-11-01T00:30:00-05:00',end:'2026-11-02T00:00:00-06:00'},'oshal','America/Chicago');assert.deepEqual([timed.firstDay,timed.lastDay],['2026-11-01','2026-11-01']);
 const travel=own.agendaEvent({title:'Trip',start:'2026-10-10T23:00:00-05:00',end:'2026-10-13T12:00:00-05:00'},'google','Asia/Tokyo');assert.deepEqual([travel.firstDay,travel.lastDay],['2026-10-11','2026-10-14']);
 for(const zone of ['Pacific/Honolulu','Asia/Tokyo']){const day=own.agendaEvent({title:'Holiday',start:'2026-10-11',end:'2026-10-13',allDay:true},'google',zone);assert.deepEqual([day.firstDay,day.lastDay],['2026-10-11','2026-10-12']);}
 assert.throws(()=>own.agendaEvent({title:'No offset',start:'2026-10-11T12:00'},'google','UTC'));
});
