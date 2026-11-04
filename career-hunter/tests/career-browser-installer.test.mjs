/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the installer's real bounded device-profile preflight, refusing different owners, broadened bot bindings and redirects without creating a user service or logging credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Default the Playwright modules to the store's scripts/toolchain, so the suite runs from the gate, which does not set STORE_CI_TOOLCHAIN.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';
import {writeFileSync,mkdtempSync,rmSync,statSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../bin/install-browser-worker.py',import.meta.url));
function run(args){return new Promise(resolve=>{const process=spawn('python3',[script,...args],{stdio:['ignore','pipe','pipe']});let out='',err='';process.stdout.on('data',c=>out+=c);process.stderr.on('data',c=>err+=c);process.on('exit',code=>resolve({code,out,err}));});}
test('original-owner device verification is private and refuses changed bindings or credential redirects',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'career-worker-install-')),file=join(dir,'worker.json'),node='c1000000-0000-0000-0000-000000000001',owner='a1000000-0000-0000-0000-000000000001',tenant='b1000000-0000-0000-0000-000000000001',bot='cb000000-0000-0000-0000-000000000004';
  const token='synthetic-device-token-never-logged';let mode='valid',calls=0;
  const server=http.createServer((req,res)=>{calls++;assert.equal(req.headers['x-oshal-node-token'],token);
    if(mode==='redirect'){res.writeHead(302,{location:'/different-destination'});res.end();return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({id:node,owner:mode==='foreign'?node:owner,tenant,harness:'browser-form-v1',supported_work_executor:'browser-form-v1',capabilities:{browse:true},bound_bots:mode==='broad'?[bot,node]:[bot]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  writeFileSync(file,JSON.stringify({version:1,kernelUrl:'http://127.0.0.1:'+server.address().port,nodeId:node,deviceToken:token,owner,tenant,botId:bot}),{mode:0o644});
  const args=['--config',file,'--node-modules',resolve(process.env.STORE_CI_TOOLCHAIN||fileURLToPath(new URL('../../scripts/toolchain',import.meta.url)),'node_modules'),'--check-only'];
  const valid=await run(args);assert.equal(valid.code,0,valid.err);assert.equal(JSON.parse(valid.out).verified,true);assert.equal(statSync(file).mode&0o777,0o600);
  for(mode of ['foreign','broad','redirect']){const before=calls,result=await run(args);assert.notEqual(result.code,0);assert.equal(calls,before+1);assert.ok(!(result.out+result.err).includes(token),'credentials stay out of diagnostics');}
});
