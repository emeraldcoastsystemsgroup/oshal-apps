#!/usr/bin/env node
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A stand-in employer for Career's submission proof (never a real employer): (a) one page with name, email, phone, résumé and cover fields, (b) Continue then Submit, (c) Apply then a sign-in wall. It records each request's path and, for a POST, only field names, whether each was filled, file names, sizes and SHA-256 values; no content. Paths are /<variant>/<run>/apply so each run's lines can be told apart.
 */
'use strict';
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),crypto=require('node:crypto');
const PAGE=(title,body,script='')=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;max-width:640px;margin:32px auto;padding:0 16px}label{display:block;margin:12px 0}input{display:block;margin-top:4px}</style>
<p><b>Stand-in Employer</b> (a test site for Career; there is no real job here)</p>${body}${script?`<script>${script}</script>`:''}</html>`;
const POSTING='<h1>Operations Coordinator</h1><p>Coordinates schedules, suppliers and office operations for a small team.</p>';
const DETAILS='<label>Full name <input name="full_name" required></label><label>Email <input name="email" type="email" required></label><label>Phone <input name="phone" type="tel"></label>';
const FILES='<label>Résumé <input name="resume" type="file" accept=".pdf" required></label><label>Cover letter <input name="cover_letter" type="file" accept=".pdf"></label><button type="submit">Submit application</button>';
const VARIANTS={
  a:()=>PAGE('Apply · Stand-in Employer',`${POSTING}<form method="post" action="submit" enctype="multipart/form-data">${DETAILS}${FILES}</form>`),
  b:()=>PAGE('Apply · Stand-in Employer',`${POSTING}<form id="f" method="post" action="submit" enctype="multipart/form-data"><section id="one"><h2>Step 1 of 2: your details</h2>${DETAILS}<p id="note" role="alert"></p><button type="button" id="next">Continue</button></section><section id="two"></section></form>`,
    `document.getElementById('next').onclick=()=>{const f=document.getElementById('f');
     if(!f.full_name.value.trim()||!f.email.value.trim()||!f.email.checkValidity()){document.getElementById('note').textContent='Enter your name and email to continue.';return;}
     document.getElementById('one').hidden=true;document.getElementById('two').innerHTML='<h2>Step 2 of 2: documents</h2>'+${JSON.stringify(FILES)};};`),
  c:()=>PAGE('Operations Coordinator · Stand-in Employer',`${POSTING}<button type="button" onclick="location.href='signin'">Apply</button>`),
};
const SIGN_IN=PAGE('Sign in · Stand-in Employer','<h1>Sign in to apply</h1><p>Use your candidate account to continue your application.</p><form method="post" action="signin"><label>Email <input name="email" type="email" required autocomplete="username"></label><label>Password <input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Sign in</button></form>');
const THANKS=PAGE('Received · Stand-in Employer','<h1>Thank you for applying</h1><p>Your application has been received.</p>');
const INCOMPLETE=PAGE('Stand-in Employer','<h1>We could not read your résumé</h1><p>Attach your résumé as a PDF and send it again.</p>');
const LIMIT=12*1024*1024;
/** Splits one multipart body into parts; values are hashed or reduced to "filled", never kept. */
function parts(body,type){
  const match=/boundary=(?:"([^"]+)"|([^;]+))/i.exec(type||'');if(!match)return null;
  const mark=Buffer.from('--'+(match[1]||match[2]).trim()),out=[];let at=body.indexOf(mark);
  while(at>=0){
    const start=at+mark.length;if(body.subarray(start,start+2).toString()==='--')break;
    const next=body.indexOf(mark,start);if(next<0)break;
    const chunk=body.subarray(start+2,next-2),split=chunk.indexOf('\r\n\r\n');
    if(split>=0){
      const head=chunk.subarray(0,split).toString('utf8'),data=chunk.subarray(split+4);
      const name=/name="([^"]*)"/i.exec(head)?.[1]??'',file=/filename="([^"]*)"/i.exec(head);
      out.push(file?{field:name,filename:file[1],size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')}:{name,filled:data.length>0});
    }
    at=next;
  }
  return out;
}
function urlencoded(body){return [...new URLSearchParams(body.toString('utf8'))].map(([name,value])=>({name,filled:value.length>0}));}
/**
 * @description Starts the stand-in. Plain HTTP on a local port (a public HTTPS name in front of it is the operator's step);
 * `tls` ({key, cert}) serves HTTPS instead, for a local check through an exact-name tunnel.
 * @param {{port?:number,host?:string,log?:string,tls?:{key:Buffer,cert:Buffer}}} options
 * @returns {Promise<{server,port,events,close}>} The listening server, its port, the recorded events and a close.
 */
async function start({port=0,host='127.0.0.1',log,tls}={}){
  const events=[];
  const record=event=>{const line={at:new Date().toISOString(),...event};events.push(line);if(log)fs.appendFileSync(log,JSON.stringify(line)+'\n',{mode:0o600});};
  const handler=async(req,res)=>{
    const url=new URL(req.url,'http://stand-in'),send=(status,html)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);};
    if(url.pathname==='/healthz'){res.writeHead(200,{'content-type':'text/plain'});res.end('ok\n');return;}
    const route=/^\/([abc])\/([a-z0-9-]{1,40})\/(apply|signin|submit)$/.exec(url.pathname);
    if(!route){send(404,PAGE('Not found','<h1>Not found</h1>'));return;}
    const [,variant,run,step]=route,base={variant,run,method:req.method,path:url.pathname};
    if(req.method==='GET'){
      record(base);
      if(step==='apply')send(200,VARIANTS[variant]());else if(step==='signin'&&variant==='c')send(200,SIGN_IN);else send(404,PAGE('Not found','<h1>Not found</h1>'));
      return;
    }
    if(req.method!=='POST'){send(405,PAGE('Not allowed','<h1>Not allowed</h1>'));return;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>LIMIT){record({...base,refused:'too_large'});send(413,INCOMPLETE);req.destroy();return;}chunks.push(chunk);}
    const body=Buffer.concat(chunks),type=req.headers['content-type']||'';
    const fields=/multipart\/form-data/i.test(type)?parts(body,type):urlencoded(body);
    const files=(fields||[]).filter(f=>f.filename!==undefined),text=(fields||[]).filter(f=>f.filename===undefined);
    record({...base,bytes:body.length,fields:text,files});
    const resume=files.find(f=>f.field==='resume'&&f.size>0);
    send(200,step==='submit'&&variant!=='c'&&resume?THANKS:step==='signin'?PAGE('Sign in','<h1>Sign-in is not available on this stand-in</h1>'):INCOMPLETE);
  };
  const server=tls?https.createServer(tls,handler):http.createServer(handler);
  server.headersTimeout=20000;server.requestTimeout=60000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {server,port:server.address().port,events,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
module.exports={start,parts};
if(require.main===module){
  const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
  start({port:Number(arg('--port')||0),host:arg('--host')||'127.0.0.1',log:arg('--log')}).then(({port})=>{
    process.stdout.write(JSON.stringify({event:'stand-in.listening',host:arg('--host')||'127.0.0.1',port})+'\n');
  }).catch(error=>{process.stderr.write('stand-in failed: '+error.message+'\n');process.exitCode=1;});
}
