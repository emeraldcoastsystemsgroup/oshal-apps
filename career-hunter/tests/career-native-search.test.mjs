/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the genuine read-only search and saved-home radius against disposable SQLite, including private owner isolation, paging and identity rechecks.
 */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
class Adapter {
  constructor(file){this.db=new DatabaseSync(file);}
  prepare(sql){const s=this.db.prepare(sql);return {run:(...a)=>s.run(...a),get:(...a)=>s.get(...a),all:(...a)=>s.all(...a)};}
  pragma(sql){return this.prepare('PRAGMA '+sql).all();}
  close(){this.db.close();}
}
const original=Module._load;
let search, reader;
Module._load=function(name,...rest){
  if(name==='better-sqlite3')return Adapter;
  if(name==='@/shared/logger')return {createChildLogger:()=>({error(){},warn(){},info(){}})};
  return original.call(this,name,...rest);
};
try{search=require('../lib/native-career-search');reader=require('../lib/native-career-read');}finally{Module._load=original;}
const {resolveUserStoreLayout}=require('../lib/user-store-path');
const yaml=require('../../scripts/toolchain/node_modules/js-yaml');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-native-search-'));
const principal={subject:'alice',issuer:'fixture',id:'alice-id',tenant:'fixture-tenant',state:'active'};
const previous={};let alice,bob,scopeBytes,corpusBytes;
before(()=>{
  for(const [key,value] of Object.entries({OSHAL_CAREER_OWNER_MOUNT:'1',JOBHUNTER_STORE_ROOT:root})){
    previous[key]=process.env[key];process.env[key]=value;
  }
  alice=resolveUserStoreLayout(root,'default','alice');bob=resolveUserStoreLayout(root,'default','bob');
  const scope={version:1,near:'Destin, FL',lat:30.4044,lon:-86.4714,radiusMiles:70,includeRemote:true};
  scopeBytes=JSON.stringify(scope);fs.writeFileSync(path.join(alice.userDir,'job-search-scope.json'),scopeBytes);
  fs.writeFileSync(path.join(bob.userDir,'job-search-scope.json'),JSON.stringify({...scope,near:'Los Angeles, CA',lat:34.0522,lon:-118.2437}));
  const file=path.join(root,'default','corpus.db');const db=new DatabaseSync(':memory:');db.prepare('ATTACH DATABASE ? AS corpus').run(file);
  const py=fs.readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
  db.exec(py.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);
  db.exec('CREATE INDEX IF NOT EXISTS corpus.idx_corpus_geo ON postings_corpus(active,lat,lon,city)');
  db.exec("INSERT INTO corpus.companies(id,name) VALUES(1,'Real fixture employer')");
  const add=db.prepare(`INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,active,remote,city,lat,lon,location,posted_date,first_seen_at)
    VALUES(?,1,?,'Software Engineer',?,1,0,?,?,?, ?,date('now'),datetime('now'))`);
  for(let id=1;id<=205;id++)add.run(id,'job-'+id,'https://example.test/'+id,'destin',30.4044,-86.4714,'Destin, FL');
  add.run(500,'la','https://example.test/500','los angeles',34.0522,-118.2437,'Los Angeles, CA');
  db.exec("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,active,remote,location,posted_date,first_seen_at) VALUES(501,1,'unknown','Software Engineer','https://example.test/501',1,1,'Remote',date('now'),datetime('now'))");
  db.close();corpusBytes=fs.readFileSync(file);
});
after(()=>{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(root,{recursive:true,force:true});});

test('home plus a temporary 50-mile radius returns only local jobs and preserves the saved 70-mile area',()=>{
  const r=search.searchCareerOpenings(principal,{useHome:true,radiusMiles:50,q:'Engineer',days:7,per:200},root);
  assert.equal(r.jobs.length,200);assert.equal(r.per,200);assert.equal(r.exhausted,false);
  assert.ok(r.jobs.every(j=>j.distance_miles<=50&&j.id<500));
  assert.equal(r.location.label,'Destin, FL');assert.equal(r.location.radius_miles,50);
  assert.equal(r.locationSource,'saved_matching_area');
  const link=new URL(r.searchUrl,'https://example.test');
  assert.equal(link.searchParams.get('near'),'Destin, FL');assert.equal(link.searchParams.get('radius_miles'),'50');
  assert.equal(link.searchParams.has('lat'),false);
  assert.equal(fs.readFileSync(path.join(alice.userDir,'job-search-scope.json'),'utf8'),scopeBytes);
  assert.deepEqual(fs.readFileSync(path.join(root,'default','corpus.db')),corpusBytes);
  const next=search.searchCareerOpenings(principal,{useHome:true,radiusMiles:50,q:'Engineer',per:200,page:2},root);
  assert.equal(next.jobs.length,5);assert.equal(next.exhausted,true);
  assert.equal(next.jobs.some(j=>r.jobs.some(first=>first.id===j.id)),false);
});
test('explicit city or ZIP works without a resume; home uses only the acting owner',()=>{
  for(const near of ['Destin, FL','32541']){
    const r=search.searchCareerOpenings(principal,{near,radiusMiles:50,per:25},root);
    assert.equal(r.jobs.length,25);assert.ok(r.jobs.every(j=>j.id<500));
  }
  const r=search.searchCareerOpenings({...principal,subject:'bob',id:'bob-id'},{useHome:true,radiusMiles:50},root);
  assert.deepEqual(r.jobs.map(j=>j.id),[500]);
  assert.throws(()=>search.searchCareerOpenings({...principal,subject:'carol'},{useHome:true,radiusMiles:50},root),/Save your home/);
});
test('invalid or missing locations and foreign ownership fields cannot silently widen a search',()=>{
  for(const input of [{radiusMiles:50},{near:'no such place',radiusMiles:50},{near:'Destin, FL',useHome:true},
    {useHome:true,radiusMiles:251},{useHome:true,per:0},{useHome:true,per:201},{useHome:true,owner:'bob'},
    {near:['Destin, FL']},{per:1.5}])assert.throws(()=>search.searchCareerOpenings(principal,input,root));
  assert.throws(()=>search.searchCareerOpenings(null,{near:'Destin, FL'},root),/identity/);
  const remote=search.searchCareerOpenings(principal,{remote:'remote'},root);
  assert.deepEqual(remote.jobs.map(j=>j.id),[501]);
});
test('the registered tool rechecks original identity before releasing real results',async()=>{
  let handler,reads=0;
  reader.createNativeCareerReadRoutes({specialistContext:{register(){}},tools:{register:(name,fn)=>{assert.equal(name,'career_database');handler=fn;}},
    intent:async()=>({principal:++reads===1?principal:{...principal,subject:'bob'}})},root);
  await assert.rejects(handler({near:'Destin, FL',radiusMiles:50}),/career_saved_source_unavailable/);
});
test('the manifest and authorization expose a read-only structured tool to Career/Jarvis',()=>{
  const manifest=yaml.load(fs.readFileSync(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
  const catalog=yaml.load(fs.readFileSync(new URL('../authorization.yaml',import.meta.url),'utf8'));
  const t=manifest.tools.find(t=>t.name==='career_database');
  assert.equal(t.executor.builtinKey,'package');assert.equal(t.inputSchema.additionalProperties,false);
  assert.equal(t.inputSchema.properties.radiusMiles.maximum,250);
  assert.equal(t.inputSchema.properties.per.maximum,200);
  assert.deepEqual(catalog.bindings.tools.find(t=>t.id==='career_database').allOf,['career.read']);
});
