'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),store=path.resolve(root,'..');
const modules=process.env.STORE_CI_TOOLCHAIN?path.join(process.env.STORE_CI_TOOLCHAIN,'node_modules'):path.join(store,'scripts/toolchain/node_modules');
const dependency=Module.createRequire(path.join(modules,'fixture.cjs'));
const express=dependency('express'),{Client,Pool}=dependency('pg');
function load(name){const m={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,'routes',name+'.js'),'utf8'))(id=>{
 if(id==='express')return express;if(id==='crypto'||id==='path')return require(id);
 if(id==='@/shared/logger')return{createChildLogger:()=>({error(){},warn(){},info(){}})};
 if(id==='./event-time')return load('event-time');throw Error('Unexpected fixture import '+id);
},m,m.exports);return m.exports;}
const own=load('own-events');
async function fixture(){
 const raw=process.env.OSHAL_TEST_POSTGRES;if(!raw)throw Error('OSHAL_TEST_POSTGRES is required: disposable Postgres 127.0.0.1:35689 only.');
 const url=new URL(raw);if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='35689')throw Error('Only disposable Postgres 127.0.0.1:35689 is allowed.');
 const id=randomUUID().replaceAll('-',''),db='calendar_'+id,role='calendar_'+id,admin=new Client({connectionString:raw,connectionTimeoutMillis:3000,statement_timeout:5000});await admin.connect();let pool,server;
 try{
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);await admin.query(`CREATE DATABASE ${db}`);
  url.pathname='/'+db;pool=new Pool({connectionString:url.href,max:4,connectionTimeoutMillis:3000,statement_timeout:5000});
  for(const name of ['001-calendar-preparation.sql','003-calendar-own-events.sql','004-calendar-own-events-rls.sql','005-calendar-own-events-zone.sql'])await pool.query(fs.readFileSync(path.join(root,'migrations',name),'utf8'));
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);await pool.query(`GRANT SELECT,INSERT,DELETE,UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`);
  // Named Source seams: verified OIDC principal and legacy scoped-SQL session; real Express, SQL, migrations and RLS run.
  async function scoped(sub,q,values){const c=await pool.connect();try{await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);await c.query("SELECT set_config('oshal.current_sub',$1,true),set_config('oshal.is_operator','false',true)",[sub]);const out=await c.query(q,values);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  const app=express();app.use(express.json());app.use((req,res,next)=>{const match=/(?:^|;\s*)person=(alice|bob)/.exec(req.headers.cookie||'');req.oidc={user:{sub:match?.[1]},isAuthenticated:()=>!!match};req.ctx={pool:{query:(q,v)=>scoped(match?.[1]||'',q,v)}};next();});
  app.use('/api/calendar/events',(req,res,next)=>own.createOwnEventsRoutes(req.ctx)(req,res,next));
  app.use('/api/calendar/review',load('review').createReviewRoutes({appPackageDir:root}));
  app.get('/cockpit/js/app-handoff.js',(_q,r)=>r.type('js').send('export function receiveHandoff(){}'));
  app.get('/cockpit/js/app-workflows.js',(_q,r)=>r.type('js').send('export async function mountConnectedActions(){}'));
  app.get('/shared/ui/:kind/:file',(_q,r)=>r.type('js').send(''));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  async function call(method,route,body,person='alice',headers={}){const r=await fetch(base+route,{method,headers:{...(person?{Cookie:'person='+person}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>({}))};}
  return{base,pool,scoped,call,async seed(person,event){return call('POST','/api/calendar/events',{confirm:true,...event},person);},async snapshot(person,events,at){await scoped(person,'INSERT INTO calendar_preparation_snapshots(user_sub,events,synced_at) VALUES($1,$2,$3) ON CONFLICT(user_sub) DO UPDATE SET events=$2,synced_at=$3',[person,JSON.stringify(events),at]);},async close(){await new Promise(resolve=>server.close(resolve));await pool.end();await admin.query(`DROP DATABASE ${db} WITH (FORCE)`);await admin.query(`DROP ROLE ${role}`);await admin.end();}};
 }catch(e){if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();throw e;}
}
module.exports={fixture,own,dependency,root};
