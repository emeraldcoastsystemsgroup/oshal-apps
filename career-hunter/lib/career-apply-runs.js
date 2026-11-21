/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I: a run also records who pressed Submit (submittedBy: you or career) and whether Career pressed it once without the employer's confirmation being seen (pressedByCareer).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 4.7 and 5.1): the person's own record of each assisted application, apply-runs.json beside the submission queue. One approval binds one job's exact packet for 24 hours; it may start again (Go on) while it lasts, because it never submits, and each start is its own attempt with its own frozen input file (apply-<id>-<attempt>.json) and request digest over the same approved task. A job holds one run at a time; a changed packet needs that run stopped or ended first. Nothing here starts work: the routes publish the input before any kernel call.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const queue=require('./career-submission-queue');
const FILE='apply-runs.json',MAX_RUNS=500,MAX_BYTES=4*1024*1024,MAX_INPUT=1024*1024,MAX_ATTEMPTS=12,DAY=24*60*60*1000;
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const STATUSES=new Set(['approved','queued','running','waiting','ready','submitted','not_seen','paused','stopped','failed']);
/** A run that holds its job: another approval of different documents waits until it ends. */
const HOLDING=new Set(['approved','queued','running','waiting','ready','paused']);
const PATCH=['status','reason','nativeTicketId','live','keptCards','receiptFile','pictures','confirmationFile','confirmationSha256','confirmationText','submittedAt','changes','attemptWork','submittedBy','pressedByCareer'];
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};

/**
 * @description The person's assisted application records. @param {string} dir Their own store. @returns {{version:number,runs:object}}
 */
function read(dir){
 const file=path.join(dir,FILE);let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {version:1,runs:{}};throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)fail('runs_unavailable','Assisted application records are unavailable.',503);
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data?.version!==1||!data.runs||typeof data.runs!=='object'||Array.isArray(data.runs)||Object.entries(data.runs).some(([id,run])=>!ID.test(id)||run?.id!==id
   ||!STATUSES.has(run.status)||!HASH.test(run.packetDigest||'')||!Number.isSafeInteger(run.postingId)||!Array.isArray(run.attempts)||!Array.isArray(run.events)))
  fail('runs_invalid','Assisted application records need repair.',503);
 return data;
}
function write(dir,state){
 const bytes=JSON.stringify(state)+'\n';if(Buffer.byteLength(bytes)>MAX_BYTES)fail('runs_full','Assisted application history is full.');
 const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});const fd=fs.openSync(temp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
/** @description One run, or a 404. @param {string} dir @param {string} id @returns {object} */
function get(dir,id){const run=ID.test(id||'')&&read(dir).runs[id];if(!run)fail('run_not_found','This assisted application was not found.',404);return run;}
function mutate(dir,id,change,now=Date.now()){
 const state=read(dir),run=ID.test(id||'')&&state.runs[id];if(!run)fail('run_not_found','This assisted application was not found.',404);
 const before=run.status;change(run);run.updatedAt=new Date(now).toISOString();
 if(run.status!==before){run.events.push({at:run.updatedAt,kind:run.status});run.events=run.events.slice(-60);}
 write(dir,state);return run;
}
/**
 * @description Record one approval of one job's exact packet. The same packet approved again is the same run; a
 * different packet while a run holds the job is refused. @param {string} dir @param {object} built career-apply-packet
 * build() output. @param {{title:string,company:string}} posting @param {number} [now] @returns {{run:object,deduped:boolean}}
 */
function approve(dir,built,posting,now=Date.now()){
 const state=read(dir),postingId=built.task.postingId;
 const holding=Object.values(state.runs).find(run=>run.postingId===postingId&&HOLDING.has(run.status)&&Date.parse(run.expiresAt)>now);
 if(holding){
  if(holding.packetDigest!==built.packetDigest)fail('run_conflict','Career is already filling in this job’s form with other documents. Stop it before approving these.');
  return {run:holding,deduped:true};
 }
 if(Object.keys(state.runs).length>=MAX_RUNS)fail('runs_full','Assisted application history is full.');
 const id=crypto.randomUUID(),at=new Date(now).toISOString();
 state.runs[id]={id,postingId,url:built.task.url,origin:new URL(built.task.url).origin,site:built.site.id,title:String(posting.title||'').slice(0,300),
  company:String(posting.company||'').slice(0,300),packetDigest:built.packetDigest,status:'approved',reason:'',approvedAt:at,createdAt:at,updatedAt:at,
  expiresAt:new Date(now+DAY).toISOString(),attempts:[],nativeTicketId:null,links:built.links,keptCards:[],events:[{at,kind:'approved'}]};
 write(dir,state);return {run:state.runs[id],deduped:false};
}
const inputFile=(dir,id,n)=>path.join(dir,'apply-'+id+'-'+n+'.json');
/**
 * @description Publish one attempt's frozen input before anything starts it. @param {string} dir @param {string} id
 * @param {object} input career-apply-packet input() output. @returns {object} The run.
 */
function publish(dir,id,input){
 const n=input.attempt,name=inputFile(dir,id,n),bytes=JSON.stringify(input);
 if(Buffer.byteLength(bytes)>MAX_INPUT)fail('packet_too_large','These documents are too large to send to your computer (1 MB in all).');
 return mutate(dir,id,run=>{
  if(run.attempts.some(attempt=>attempt.n===n))return;
  if(n!==run.attempts.length+1||n>MAX_ATTEMPTS)fail('attempt_out_of_order','This application cannot start again now.');
  const temp=name+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,name);}finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
  run.attempts.push({n,requestDigest:input.requestDigest,workId:null,startedAt:null});
 });
}
/**
 * @description One attempt's input exactly as approved, refused when the file or its digest changed.
 * @param {string} dir @param {string} id @param {number} n @returns {object} The input.
 */
function snapshot(dir,id,n){
 const run=get(dir,id),attempt=run.attempts.find(item=>item.n===n),name=inputFile(dir,id,n);
 let stat;try{stat=fs.lstatSync(name);}catch{fail('input_unavailable','The approved input is unavailable.');}
 if(!attempt||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_INPUT)fail('input_unavailable','The approved input is unavailable.');
 const input=JSON.parse(fs.readFileSync(name,'utf8')),{requestDigest,...bound}=input;
 if(input.intentId!==id||input.attempt!==n||requestDigest!==attempt.requestDigest||queue.jsonDigest(bound)!==requestDigest)fail('input_changed','The approved input changed.');
 return input;
}
/**
 * @description Change what Career knows about a run. Only the listed fields; a run that ended stays ended.
 * @param {string} dir @param {string} id @param {object} patch @param {number} [now] @returns {object} The run.
 */
function update(dir,id,patch,now=Date.now()){
 if(Object.keys(patch).some(key=>!PATCH.includes(key)))fail('invalid_run_update','Unsupported assisted application update.');
 if(patch.status&&!STATUSES.has(patch.status))fail('invalid_run_update','Unsupported assisted application state.');
 return mutate(dir,id,run=>{
  if(['submitted','stopped'].includes(run.status)&&patch.status&&patch.status!==run.status)fail('run_finished','This application has ended.');
  if(patch.nativeTicketId&&(!ID.test(patch.nativeTicketId)||run.nativeTicketId&&run.nativeTicketId!==patch.nativeTicketId))fail('native_binding_changed','The application’s ticket changed.');
  const {attemptWork,...rest}=patch;
  if(attemptWork){const attempt=run.attempts.find(item=>item.n===attemptWork.n);if(!attempt||attempt.workId&&attempt.workId!==attemptWork.workId||!ID.test(attemptWork.workId||''))
   fail('native_binding_changed','The application’s work reference changed.');attempt.workId=attemptWork.workId;attempt.startedAt=attempt.startedAt||new Date(now).toISOString();}
  Object.assign(run,rest);
 },now);
}
/** @description A run as its owner's pages read it: no request digests and no input. @param {object} run @returns {object} */
function publicRun(run){
 const {links,attempts,...rest}=run;
 return {...rest,attempt:attempts.length,attemptsStarted:attempts.filter(item=>item.workId).length,expired:Date.parse(run.expiresAt)<=Date.now()};
}
module.exports={HOLDING,read,get,approve,publish,snapshot,update,publicRun};
