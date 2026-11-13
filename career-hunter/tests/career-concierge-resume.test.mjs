/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Synthetic concierge replay crosses the declared tool, shipped route and saved owner reader; counts scripted completions, reads and engine launches.
 */
import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {madeUpProfile} from './helpers/career-master-record-fixture.mjs';
const require=createRequire(import.meta.url), root=fs.mkdtempSync(path.join(os.tmpdir(),'career-concierge-'));
const packageRoot=path.resolve(import.meta.dirname,'..');
const yaml=require(require.resolve('js-yaml',{paths:[path.join(packageRoot,'../scripts/toolchain')]}));
const manifest=yaml.load(fs.readFileSync(path.join(packageRoot,'oshal-app.yaml'),'utf8'));
const dirs={alex:path.join(root,'default/alex'),blair:path.join(root,'default/blair')};
for(const dir of Object.values(dirs))fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dirs.alex,'career_db.json'),JSON.stringify(madeUpProfile('ALEX')));
process.env.JOBHUNTER_STORE_ROOT=root;process.env.OSHAL_CAREER_OWNER_MOUNT='1';
let engine=0, reads=0;
const originalLoad=Module._load;
Module._load=function(request,...rest){
 if(request==='@/shared/logger')return{createChildLogger:()=>({error(){},warn(){},info(){}})};
 if(request==='@/features/agent-management')return{BotNodeClient:class{},createRegistryEndpointResolver:()=>null};
 if(request==='@/app/routes/inline-bot-execution'||request==='./career-engine-runner')return{};
 if(request==='better-sqlite3')return class{constructor(){throw Error('No database needed for resume presence');}};
 if(request==='@/shared/middleware/authz')return{getTrustedServiceUserSub:()=>null};
 if(request==='@/app/routes/caller-sub')return{callerSub:req=>req.oidc?.user?.sub||null};
 if(request==='./career-engine-dispatch')return{runCareerCliAwait:async(_pool,sub,args)=>{
  engine++;assert.deepEqual(args,['resume','base']);
  const out=spawnSync('python3',['-c','import json\nfrom jobhunter import profile\nread=profile._read_profile_text\ncount=[0]\ndef traced():\n count[0]+=1\n return read()\nprofile._read_profile_text=traced\nvalue=profile.base_document()\nprint(json.dumps({"value":value,"reads":count[0]}))'],
   {cwd:packageRoot,encoding:'utf8',env:{...process.env,JOBHUNTER_DATA:dirs[sub],JOBHUNTER_CAREER_DB:path.join(dirs[sub],'career_db.json'),PYTHONPATH:path.join(packageRoot,'engine')}});
  if(out.status!==0)return{ok:false,out:out.stdout,err:out.stderr};
  const result=JSON.parse(out.stdout);reads+=result.reads;return{ok:true,out:JSON.stringify(result.value),err:''};
 }};
 return originalLoad.call(this,request,...rest);
};
const studio=require('../routes/career-resume-studio-routes.js'),reader=require('../lib/native-career-read.js');
Module._load=originalLoad;
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const handlers=new Map();
studio.registerCareerResumeStudio({get:(p,h)=>handlers.set(p,h),post(){}},{pool:{}});
async function turn(sub){
 engine=0;reads=0;const prompt=[{role:'user',text:'is my resume loaded'}];let models=0;
 // Script only the model boundary. Its answer must consume the real tool observation.
 const complete=()=>{models++;if(models===1)return{tool:'career_resume_read',input:{}};
  const value=prompt.at(-1).value;
  if(typeof value.present!=='boolean')return{reply:'Legacy full-document observation'};
  return{reply:value.present?'Your main résumé is saved. Sections: '+value.sections.map(s=>s.heading).join(', '):value.message+' Open My résumé: '+value.editScreen};};
 const call=complete(),tool=manifest.tools.find(t=>t.name===call.tool);
 const endpoint=tool.executor.apiEndpoint.replace(/^GET /,'');
 const url=new URL(endpoint,'http://fixture.test');const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;}};
 const read=fs.openSync;fs.openSync=function(file,...args){if(String(file)===path.join(dirs[sub],'career_db.json'))reads++;return read.call(this,file,...args);};
 try{await handlers.get(url.pathname.replace('/api/career-hunter',''))({oidc:{user:{sub}},userSub:'forged-alex',query:{...Object.fromEntries(url.searchParams),userSub:'alex'}},res);}finally{fs.openSync=read;}
 assert.equal(res.code,200,JSON.stringify(res.body));prompt.push({role:'tool',value:res.body});
 const answer=complete();return{answer:answer.reply,observation:res.body,models,tools:1,engine,reads};
}
test('saved fictional owner asks the concierge: presence and headings reach its next completion without resume text',async()=>{
 const result=await turn('alex');assert.equal(typeof result.observation.present,'boolean','the turn must receive presence, rather than infer it');assert.match(result.answer,/saved.*Summary/);assert.match(result.answer,/Experience/);
 assert.doesNotMatch(JSON.stringify(result.observation),/ALEX|SUMMARY|deliverables|bullets|@example/);
 assert.deepEqual([result.tools,result.models,result.engine,result.reads],[1,2,0,1]);
 console.log('SAVED fixture counts '+JSON.stringify({toolCalls:result.tools,scriptedModelCalls:result.models,engineLaunches:result.engine,profileReads:result.reads}));
});
test('empty fictional owner gets truthful absence and My résumé, never the other owner selected in query',async()=>{
 const result=await turn('blair');assert.match(result.answer,/not saved a résumé/);assert.match(result.answer,/career-resume-studio/);
 assert.deepEqual(result.observation.sections,[]);assert.equal(result.engine,0);
});
test('automatic facts do not erase a saved resume when no job corpus exists',async()=>{
 const principal={subject:'alex',issuer:'https://fixture.test',id:'fixture-alex',tenant:'fixture',state:'active'};
 const value=reader.readCareerSnapshot(principal,root);assert.equal(value.profile.present,true);
 assert.match(value.notice,/corpus/);assert.equal(value.signalsTotal,0);
 let entry;reader.createNativeCareerReadRoutes({pool:{query:async()=>({rows:[{remote_only:false}]})},tools:{register(){}},
  specialistContext:{register:e=>{entry=e;}},intent:async()=>({principal})},root);
 assert.equal((await entry.read({sub:'alex',issuer:principal.issuer,signal:{aborted:false}}))['profile.present'],true);
});
test('status read refuses corrupt, oversized and linked sources, and requires signed-in identity',async()=>{
 const tool=manifest.tools.find(t=>t.name==='career_resume_read');const url=new URL(tool.executor.apiEndpoint.replace(/^GET /,''),'http://fixture.test');
 async function call(sub){const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;}};await handlers.get('/resume/doc')({oidc:{user:{sub}},userSub:'forged-alex',query:Object.fromEntries(url.searchParams)},res);return res;}
 assert.equal((await call(undefined)).code,401);
 const missing=await call('never-created');assert.equal(missing.body.present,false);assert.equal(fs.existsSync(path.join(root,'default/never-created')),false);
 const file=path.join(dirs.blair,'career_db.json');
 for(const body of ['{bad','[]','x'.repeat(4*1024*1024+1)]){fs.writeFileSync(file,body);assert.equal((await call('blair')).code,503);}
 fs.rmSync(file);fs.symlinkSync(path.join(dirs.alex,'career_db.json'),file);assert.equal((await call('blair')).code,503);fs.rmSync(file);
});
test('concierge asks once for bounded presence and reads content only when asked',()=>{
 const persona=yaml.load(fs.readFileSync(path.join(packageRoot,'personas/career-concierge.yaml'),'utf8'));
 assert.match(persona.perspective,/presence and section headings/);assert.match(persona.perspective,/Do not repeat/);
 assert.match(manifest.tools.find(t=>t.name==='career_resume_read').executor.apiEndpoint,/view=status/);
});

test('fixture call budget: one tool and two scripted completions, with engine and observation cost recorded',async()=>{
 const runs=[];for(let n=0;n<5;n++){const start=performance.now(),r=await turn('alex');runs.push({milliseconds:performance.now()-start,toolCalls:r.tools,scriptedModelCalls:r.models,engineLaunches:r.engine,profileReads:r.reads,observationBytes:Buffer.byteLength(JSON.stringify(r.observation))});}
 assert.ok(runs.every(r=>r.toolCalls===1&&r.scriptedModelCalls===2));
 console.log('CONCIERGE_METRICS '+JSON.stringify(runs));
});

test('control: the existing full reader and automatic facts with a corpus already read the asking owner correctly',async()=>{
 const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;}};
 await handlers.get('/resume/doc')({oidc:{user:{sub:'alex'}},query:{id:'master',userSub:'blair'}},res);
 assert.equal(res.code,200);assert.match(res.body.resume.summary,/ALEX-SUMMARY/);
 const corpus=path.join(root,'default/corpus.db');new DatabaseSync(corpus).close();
 try{const principal={subject:'alex',issuer:'https://fixture.test',id:'fixture-alex',tenant:'fixture',state:'active'};
  assert.equal(reader.readCareerSnapshot(principal,root).profile.present,true);
  assert.equal(reader.readCareerSnapshot({...principal,subject:'blair'},root).profile.present,false);
 }finally{fs.rmSync(corpus);}
});
