/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Launch the actual pinned browser entry point and require the native heartbeat body credential before its serial claim loop can start; retain header-only authentication on work requests and keep credentials out of output.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../../bin/career-browser-worker.cjs',import.meta.url));
function child(args,env){
  const process=spawn(globalThis.process.execPath,[entry,...args],{env,stdio:['ignore','pipe','pipe']});
  let out='',err='';process.stdout.on('data',bytes=>out+=bytes);process.stderr.on('data',bytes=>err+=bytes);
  const ended=new Promise(resolve=>process.on('exit',(code,signal)=>resolve({code,signal,out,err})));
  return {process,ended};
}
test('real browser worker authenticates its heartbeat and reaches the claim loop without exposing its credential',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'career-browser-process-'));
  const env={...process.env,NODE_PATH:resolve(process.env.STORE_CI_TOOLCHAIN,'node_modules')};
  const fingerprint=await child(['--fingerprint'],env).ended;
  assert.equal(fingerprint.code,0,fingerprint.err);assert.match(fingerprint.out.trim(),/^[a-f0-9]{64}$/);
  const node='c1000000-0000-0000-0000-000000000001',bot='cb000000-0000-0000-0000-000000000004';
  const token='synthetic-heartbeat-device-token-private';
  let heartbeats=0,claims=0,resolveClaim;const claimed=new Promise(resolve=>resolveClaim=resolve),failures=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;const value=JSON.parse(raw);
      assert.equal(req.headers['x-oshal-node-token'],token);
      res.setHeader('content-type','application/json');
      if(req.url==='/nodes/'+node+'/heartbeat'){
        assert.equal(value.token,token);assert.equal(Buffer.from(value.generation).toString('hex'),fingerprint.out.trim());
        heartbeats++;res.end(JSON.stringify({status:'ok',node,last_seen:Date.now()}));
      }else{
        assert.equal(req.url,'/nodes/'+node+'/claim');assert.deepEqual(value,{bot});assert.ok(heartbeats>0);
        claims++;res.end(JSON.stringify({envelope:null}));resolveClaim();
      }
    }catch(error){failures.push(error.message);res.writeHead(401);res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const file=join(dir,'worker.json');writeFileSync(file,JSON.stringify({version:1,kernelUrl:'http://127.0.0.1:'+server.address().port,
    nodeId:node,botId:bot,deviceToken:token,profileDir:join(dir,'profile'),workDir:join(dir,'work'),headless:true}),{mode:0o600});
  const worker=child([file,'--expected-sha256',fingerprint.out.trim()],env);
  t.after(async()=>{worker.process.kill('SIGKILL');await worker.ended;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  let timer;
  try{await Promise.race([claimed,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Worker did not authenticate and claim')),15000)),worker.ended.then(result=>{throw Error('Worker exited before claiming: '+result.err);})]);}
  finally{clearTimeout(timer);}
  worker.process.kill('SIGTERM');const result=await worker.ended;
  assert.equal(result.code,0,result.err);assert.ok(heartbeats>=1);assert.ok(claims>=1);assert.deepEqual(failures,[]);
  assert.ok(!(result.out+result.err).includes(token));
});
