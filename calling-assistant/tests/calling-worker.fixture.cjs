/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A worker process for the credential-confinement case in integration.test.cjs. It runs the package's own CallingService, Twilio adapter, callback verifier and registered tool against the fixture schema and the fake carrier, holds the connection credential exactly as a worker does (parsed by credentials() from the raw SID:token string), and exposes only an IPC channel for tool calls and a loopback callback port. The parent spawns it with piped stdio and a fresh working directory, then reads everything it printed and every file it wrote, so a writer bound at module load, a pino destination or a worker-thread transport is observed the same way as console output. The fixture itself prints exactly one marker line on each stream so the parent can prove both pipes were read.
 * -----------------------------------------------------------------------------
 */
'use strict';
const express=require('express'),{Pool}=require('pg');
const {CallingService}=require('../routes/service'),{Twilio,credentials}=require('../routes/twilio');
const {callbackVerifier}=require('../routes/callback'),{registerCallingTool}=require('../routes/tool');

let pool,server,tool;

/** Answer one tool call over IPC; a refusal travels back as its message, code, status and stack. */
async function runTool(message){
 try{process.send({op:'result',id:message.id,result:await tool(message.input)});}
 catch(e){process.send({op:'error',id:message.id,error:{message:e.message,code:e.code,status:e.status,stack:String(e.stack)}});}
}

/** Build the worker from the parent's description and report the callback port once it listens. */
async function init({dsn,schema,carrierBase,credential,actor,transcript}){
 pool=new Pool({connectionString:dsn,max:3,options:`-c search_path=${schema}`});
 const forward=(url,opts)=>fetch(carrierBase+new URL(url).pathname+new URL(url).search,opts);
 const client=new Twilio(credentials(credential),forward);
 const calls=new CallingService({pool,carrier:async()=>client,transcribe:async()=>({text:transcript,providerId:'fixture-stt'})});
 registerCallingTool({tools:{register:(_name,handler)=>{tool=handler;}},authorization:{currentActor:()=>actor}},calls);
 const verify=callbackVerifier({findRun:async id=>(await pool.query('SELECT * FROM calling_runs WHERE id=$1',[id])).rows[0],carrier:async()=>client,asOwner:(_a,fn)=>fn()});
 const app=express();
 app.use(async(req,res)=>{
  res.set('Connection','close');
  try{const owner=await verify(req);if(!owner)return res.status(401).end();const parts=req.path.split('/');res.type('text/xml').send(await calls.callback(owner,parts[4],parts[5],Number(parts[6]),req.body));}
  catch(e){res.status(e.status||500).json({error:e.code||'failed'});}
 });
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 process.stdout.write('calling worker stdout open\n');process.stderr.write('calling worker stderr open\n');
 process.send({op:'ready',port:server.address().port});
}

/** Release every handle so the process ends on its own and flushes whatever its writers buffered. */
async function shutdown(){
 await new Promise(resolve=>server.close(resolve));
 await pool.end();
 process.disconnect();
}

process.on('message',message=>{
 if(message.op==='init')init(message).catch(e=>{process.send({op:'fatal',message:e.message});process.exitCode=1;process.disconnect();});
 else if(message.op==='tool')void runTool(message);
 else if(message.op==='exit')void shutdown();
});
