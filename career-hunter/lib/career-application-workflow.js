/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep explicit preparation consent in each owner's records and bind readiness/review to current inputs and exact packet bytes; preparation never authorizes employer submission.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const board=require('./career-board-state');
const FILE='application-workflow.json',OFF={enabled:false,mode:'review'};
function fail(message,status=409){const e=Error(message);e.status=status;throw e;}
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||!['review','automatic'].includes(value.mode))fail('Choose OFF or ON and a preparation choice.',400);
 return {enabled:value.enabled,mode:value.mode};
}
function safeFile(file){try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024)fail('Preparation choice is unavailable.',503);}catch(e){if(e.code!=='ENOENT')throw e;}}
function read(dir){
 if(!dir)return {...OFF};const file=path.join(dir,FILE);safeFile(file);
 try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1)fail('Preparation choice is unavailable.',503);return validate(data);}
 catch(e){if(e.code==='ENOENT')return {...OFF};fail('Preparation choice is unavailable.',503);}
}
function save(dir,input){
 const value=validate(input);if(Object.keys(input).some(key=>!['enabled','mode'].includes(key)))fail('Only the preparation choice is accepted.',400);
 const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';safeFile(file);
 try{fs.writeFileSync(temp,JSON.stringify({version:1,...value})+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
 finally{fs.rmSync(temp,{force:true});}return value;
}
function address(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function packetProof(dir,id,job,application){
 const state=board.readBoardState(dir).jobs[id]||{};
 if(application.needsGeneration||state.phase!=='ready'||!state.completedAt)return null;
 const hashes=require('./career-application-draft').packetHashes(dir,job);
 if(!hashes)return null;
 return crypto.createHash('sha256').update(JSON.stringify({inputs:application.inputsHash,requestId:state.requestId,hashes})).digest('hex');
}
function view(dir,id,job,application){
 const state=board.readBoardState(dir).jobs[id]||{},flow=state.workflow;if(!flow)return null;
 const held=reason=>({state:'stuck',ready:false,reason,proof:null});
 if(job.active===0)return held('The employer posting is no longer available. Check the original posting.');
 if(!address(job.url))return held('The employer form link is unavailable. Open the application and check the posting.');
 if(state.phase==='failed'||application.failed)return held(state.error==='resume_required'?'Upload your résumé, then retry preparation.':'Preparation stopped: '+String(state.error||'generation failed').replaceAll('_',' ')+'. Open the application to review and retry.');
 if(state.phase!=='ready')return {state:'preparing',ready:false,proof:null,reason:'Preparation is pending. Refresh progress; if it was interrupted, open the application and retry generation.'};
 const proof=packetProof(dir,id,job,application);
 if(!proof)return held('The current documents are unavailable or changed. Open the application and generate a current packet.');
 const ready=flow.mode==='automatic'||flow.reviewedProof===proof;
 return {state:ready?'ready':'review',ready,proof,reason:ready?'Ready to submit. Career does not send this to the employer automatically.':'Review each application before it is marked ready to submit.'};
}
function review(dir,id,job,input){
 const drafts=require('./career-application-draft'),application=drafts.view(dir,id,job),workflow=view(dir,id,job,application);
 if(!input||Object.keys(input).length!==1||typeof input.proof!=='string')fail('Review the current application first.',400);
 if(application.locked||!workflow?.proof||workflow.proof!==input.proof)fail('The application changed. Review its current documents before marking it ready.');
 const saved=board.readBoardState(dir).jobs[id];board.updateBoardState(dir,id,{workflow:{...saved.workflow,reviewedProof:workflow.proof,reviewedAt:new Date().toISOString()}});
 return {ok:true,application:drafts.view(dir,id,job)};
}
module.exports={read,save,view,review,address};
