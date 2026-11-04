/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Send the device credential in the native heartbeat body's required token field as well as its device header; other work routes retain header-only authentication.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execute serial device-bound native form work with semantic Playwright controls, one-use final permits, durable exact-result recovery and private per-worker browser state.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),dns=require('node:dns').promises,net=require('node:net');
const queue=require('./career-submission-queue'),{runSubmission}=require('./career-submission-browser');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const BOT='cb000000-0000-0000-0000-000000000004';
function privateDirectory(dir){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('worker_directory_refused');
  return dir;
}
function config(file){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>8192)throw Error('worker_config_refused');
  const value=JSON.parse(fs.readFileSync(file,'utf8')),url=new URL(value.kernelUrl);
  if(value.version!==1||!UUID.test(value.nodeId)||typeof value.deviceToken!=='string'||value.deviceToken.length<24
      ||value.botId!==BOT||url.username||url.password||url.search||url.hash||url.pathname!=='/'
      ||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)
      ||!path.isAbsolute(value.profileDir)||!path.isAbsolute(value.workDir))throw Error('worker_config_refused');
  return value;
}
/** Device headers stay in Node, never in page scripts, browser storage or a model prompt. */
function client(settings){
  return async(suffix,body={})=>{
    const payload=suffix==='heartbeat'?{...body,token:settings.deviceToken}:body;
    const response=await fetch(new URL('/nodes/'+settings.nodeId+'/'+suffix,settings.kernelUrl),{method:'POST',redirect:'error',
      headers:{'x-oshal-node-token':settings.deviceToken,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    if(Number(response.headers.get('content-length'))>24000000)throw Error('worker_response_bound');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>24000000)throw Error('worker_response_bound');chunks.push(chunk);}
    let answer;try{answer=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('worker_response_invalid');}
    if(!response.ok){const error=Error('worker_request_refused');error.status=response.status;throw error;}
    return answer;
  };
}
function hashHex(value){
  if(!Array.isArray(value)||value.length!==32||value.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('worker_digest_invalid');
  return Buffer.from(value).toString('hex');
}
function nodeFile(name,bytes){return {path:name,digest:[...Buffer.from(queue.digest(bytes),'hex')],bytes:[...bytes]};}
function publicAddress(address){
  if(net.isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224
    ||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0)
    ||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19));}
  return net.isIP(address)===6&&/^[23][a-f0-9]{3}:/i.test(address)&&!/^2001:db8:/i.test(address);
}
/** Deny requests to local services, including a public name that resolves privately. */
async function publicNetwork(route){
  try{
    const url=new URL(route.request().url()),host=url.hostname.replace(/^\[|\]$/g,'');
    if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')return route.abort('blockedbyclient');
    const addresses=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))return route.abort('blockedbyclient');
    return route.fallback();
  }catch{return route.abort('blockedbyclient');}
}
function durable(file,body){
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(body),{mode:0o600,flag:'wx'});
  const fd=fs.openSync(temp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);
}
/** A fresh page is the only browser surface this function owns or closes. */
async function execute(call,envelope,context,{generation,root,fixtureOrigin,timeoutMs=10000}){
  if(!UUID.test(envelope?.id||''))throw Error('worker_envelope_invalid');
  const dir=fs.mkdtempSync(path.join(privateDirectory(root),'work-')),prefix='work/'+envelope.id+'/',started=Date.now();
  let page,permit=null,output,completed=false;
  try{
    const packet=await call(prefix+'input');
    if(packet.version!==1||packet.executor!=='browser-form-v1'||packet.model||packet.persona||packet.envelope?.id!==envelope.id
        ||packet.envelope?.owner!==envelope.owner||packet.envelope?.tenant!==envelope.tenant||packet.envelope?.bot!==envelope.bot
        ||packet.files?.length!==1||packet.files[0].path!=='browser-task.json'||packet.limits?.wall_ms>120000)
      throw Error('worker_input_invalid');
    const bytes=Buffer.from(packet.files[0].bytes);
    if(bytes.length>1048576||queue.digest(bytes)!==hashHex(packet.files[0].digest))throw Error('worker_input_changed');
    const input=JSON.parse(bytes.toString('utf8')),{requestDigest,...bound}=input;
    if(input.version!==1||input.intentId!==input.task?.submissionId||new URL(input.task.url).origin!==input.origin
        ||queue.jsonDigest(bound)!==requestDigest||input.expiresAt<=Date.now()||input.expiresAt>Date.now()+86400000)
      throw Error('worker_intent_changed');
    const documents=input.task.documents;
    if(!documents||Object.keys(documents).some(k=>!['Resume_ATS.pdf','CoverLetter.pdf'].includes(k)))throw Error('worker_documents_invalid');
    for(const [name,encoded]of Object.entries(documents)){
      if(typeof encoded!=='string'||encoded.length>500000)throw Error('worker_document_bound');
      fs.writeFileSync(path.join(dir,name),Buffer.from(encoded,'base64'),{mode:0o600,flag:'wx'});
    }
    await call(prefix+'browser-progress',{phase:'reviewing',intentId:input.intentId,requestDigest});
    page=await context.newPage();
    const timer=setTimeout(()=>{page.close().catch(()=>{});},Math.max(100,packet.limits.wall_ms-2000));timer.unref();
    let result;
    try{
      result=await runSubmission(page,input.task,dir,{
        check:async()=>{try{return (await call(prefix+'check')).current===true;}catch{return false;}},
        beforeSubmit:async()=>{
          // Never retry this request: a missing acknowledgement may already have consumed it.
          const approved=await call(prefix+'browser-progress',{phase:'submitting',intentId:input.intentId,requestDigest});
          if(approved.current!==true||!UUID.test(approved.permit||''))return false;
          permit=approved.permit;return true;
        },
      },{fixtureOrigin,timeoutMs});
    }finally{clearTimeout(timer);}
    const {confirmation,review,...data}=result;
    const answer=JSON.stringify({version:1,intentId:input.intentId,requestDigest,
      outcome:result.status==='submitted'?'completed':result.status==='unknown'||permit?'unknown':'needs_review',
      permit,confirmationArtifact:confirmation?'confirmation.png':null,confirmationSha256:confirmation?queue.digest(confirmation):null,data});
    const artifacts=[nodeFile('answer.md',Buffer.from(answer))];
    if(review)artifacts.push(nodeFile('review.png',review));
    if(confirmation)artifacts.push(nodeFile('confirmation.png',confirmation));
    if(artifacts.reduce((n,f)=>n+f.bytes.length,0)>packet.limits.artifact_bytes)throw Error('worker_evidence_bound');
    output={generation,inference_receipt:'browser-form-v1:'+envelope.id,inference_receipts:[],answer,artifacts,
      elapsed_ms:Date.now()-started};
    const outbox=path.join(root,envelope.id+'.result.json');durable(outbox,output);
    // Recovery sends these exact retained bytes. It never opens the employer form again.
    await call(prefix+'result',output);completed=true;fs.unlinkSync(outbox);
    return {id:envelope.id,status:result.status,actions:result.actions,screenshots:result.screenshots,elapsedMs:result.elapsedMs};
  }catch(error){
    if(!output)await call(prefix+'failed').catch(()=>{});
    throw Error(output?'worker_result_pending':'worker_execution_stopped');
  }finally{if(page)await page.close().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}
}
async function recover(call,root){
  for(const name of fs.readdirSync(privateDirectory(root))){
    if(!/^[a-f0-9-]{36}\.result\.json$/.test(name))continue;
    const target=path.join(root,name),stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16000000||(stat.mode&0o077))throw Error('worker_outbox_refused');
    try{await call('work/'+name.slice(0,36)+'/result',JSON.parse(fs.readFileSync(target,'utf8')));fs.unlinkSync(target);}
    catch(e){
      if(e.status&&e.status<500){await call('work/'+name.slice(0,36)+'/failed').catch(()=>{});fs.renameSync(target,target+'.unreported');}
      else throw Error('worker_result_pending');
    }
  }
}
function fingerprint(playwrightVersion,browserPath){
  const files=['career-browser-worker.js','career-submission-browser.js','career-submission-queue.js','autofill-bookmarklet.js'];
  return queue.digest(Buffer.concat([...files.map(name=>fs.readFileSync(path.join(__dirname,name))),fs.readFileSync(path.join(__dirname,'../bin/career-browser-worker.cjs')),Buffer.from(playwrightVersion),
    Buffer.from(queue.digest(fs.readFileSync(browserPath)))]));
}
module.exports={BOT,client,config,execute,recover,fingerprint,privateDirectory,publicNetwork};
