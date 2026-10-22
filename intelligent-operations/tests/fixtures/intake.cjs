// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Real disposable SQL transactions and forced owner policies for intake acceptance.
// CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Apply all ordered package migrations before exercising forced owner policies.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const dependency=createRequire(path.join(process.env.STORE_CI_TOOLCHAIN||path.join(root,'../scripts/toolchain'),'package.json'));
const {Client,Pool}=dependency('pg');
function loadExperience(){const file=path.join(root,'routes/experience.js'),m={exports:{}};new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>id==='express'?dependency(id):require(id.startsWith('.')?path.resolve(path.dirname(file),id):id),m,m.exports);return m.exports;}
async function fixture(){
 const raw=process.env.OSHAL_TEST_POSTGRES;if(!raw)throw Error('OSHAL_TEST_POSTGRES is required: disposable PostgreSQL 127.0.0.1:35689 only.');
 const url=new URL(raw);if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='35689')throw Error('Only disposable PostgreSQL 127.0.0.1:35689 is allowed.');
 const id=randomUUID().replaceAll('-',''),db='operations_'+id,role='operations_'+id,pools=[];
 const admin=new Client({connectionString:raw,connectionTimeoutMillis:3000,statement_timeout:10000});await admin.connect();
 const close=async()=>{
  await Promise.all(pools.map(p=>p.end()));const deadline=Date.now()+5000;
  while((await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',[db])).rows[0].n){if(Date.now()>deadline)throw Error('Intake fixture connections did not close.');await new Promise(r=>setTimeout(r,20));}
  await admin.query(`DROP DATABASE IF EXISTS ${db}`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();
 };
 try{
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);await admin.query(`CREATE DATABASE ${db}`);url.pathname='/'+db;
  const makePool=()=>{const p=new Pool({connectionString:url.href,max:8,connectionTimeoutMillis:5000,statement_timeout:10000});pools.push(p);return p;};
  const inspect=makePool();for(const f of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())await inspect.query(fs.readFileSync(path.join(root,'migrations',f),'utf8'));
  await inspect.query(`GRANT USAGE ON SCHEMA public TO ${role}`);await inspect.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  // These are named boundary seams, not SQL mocks: each replica has an independent pool; every query, rollback and RLS check is real PostgreSQL.
  function caller(owner,intercept){const p=makePool();const scoped={async connect(){const c=await p.connect();return {async query(q,v){
   if(intercept)await intercept('before',q,v);
   const result=await c.query(q,v);
   if(q==='BEGIN'){await c.query(`SET LOCAL ROLE ${role}`);await c.query("SELECT set_config('oshal.current_sub',$1,true)",[owner]);}
   if(intercept)await intercept('after',q,v);return result;
  },release:()=>c.release()};},async query(q,v){const c=await scoped.connect();try{await c.query('BEGIN');const r=await c.query(q,v);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};return scoped;}
  return {caller,inspect,close};
 }catch(e){await close();throw e;}
}
module.exports={fixture,dependency,loadExperience,root};
