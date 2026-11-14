/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Upgrade an installed Career browser helper in place (defect 16): the real installer re-pins the unit to the delivered program, keeps the enrolled device and private settings, restarts the real worker through a stand-in systemctl that runs the unit's own start line, waits until a kernel stand-in (the kernel's node-profile readiness rule) sees the new fingerprint, rolls back a program that fails to start, and refuses without an install, with missing settings or while the helper is working.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The kernel stand-in's profile carries a jarvis_node section of about 120 KB, as the real kernel's does, so a bound under the real profile's size fails here (the 32 KB one refused the Spark's kernel as kernel_unreachable).
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,mkdtempSync,mkdirSync,rmSync,statSync,existsSync,copyFileSync,readdirSync,unlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';import {tmpdir,homedir} from 'node:os';import {fileURLToPath} from 'node:url';
const pkg=fileURLToPath(new URL('..',import.meta.url)),installer=join(pkg,'bin/install-browser-worker.py');
const modules=resolve(process.env.STORE_CI_TOOLCHAIN||fileURLToPath(new URL('../../scripts/toolchain',import.meta.url)),'node_modules');
const browsers=process.env.PLAYWRIGHT_BROWSERS_PATH||join(homedir(),'.cache/ms-playwright');
const BOT='cb000000-0000-0000-0000-000000000004',OWNER='a1000000-0000-0000-0000-0000000000a1',TENANT='b1000000-0000-0000-0000-0000000000b1';
const NODE='c1000000-0000-0000-0000-0000000000c1',NODE2='c1000000-0000-0000-0000-0000000000c2';
const TOKEN='synthetic-upgrade-device-token-never-printed',TOKEN2='synthetic-second-enrolment-token-never-printed';
const SERVICE='oshal-career-browser-'+OWNER+'.service';
const PROGRAM=['lib/career-browser-worker.js','lib/career-submission-browser.js','lib/career-submission-steps.js','lib/career-submission-queue.js',
  'lib/career-submission-png.js','lib/autofill-bookmarklet.js','bin/career-browser-worker.cjs','bin/install-browser-worker.py'];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// The real profile carries the person's jarvis_node section (107 KB on the Spark, 2026-11-13); the stand-in sends as much.
const JARVIS_NODE={guides:Array.from({length:120},(_,i)=>({id:'guide-'+i,text:'x'.repeat(1000)}))};

/** systemctl stand-in: daemon-reload, enable --now, restart and stop run the unit file's own Environment and ExecStart lines. */
const FAKE_SYSTEMCTL=`#!${process.execPath}
'use strict';const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const state=process.env.FAKE_SYSTEMD_STATE,args=process.argv.slice(2),service=args.at(-1);
fs.appendFileSync(path.join(state,'calls.log'),args.join(' ')+'\\n');
const pidFile=path.join(state,service+'.pid'),unit=path.join(process.env.HOME,'.config/systemd/user',service);
const words=line=>[...line.matchAll(/"((?:[^"\\\\]|\\\\.)*)"/g)].map(m=>m[1].replace(/\\\\(.)/g,'$1'));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
function stop(){
  if(!fs.existsSync(pidFile))return;const pid=Number(fs.readFileSync(pidFile,'utf8'));
  try{process.kill(pid,'SIGTERM');}catch{}
  for(let i=0;i<150&&alive(pid);i++)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
  try{process.kill(-pid,'SIGKILL');}catch{}fs.rmSync(pidFile,{force:true});
}
function start(){
  const lines=fs.readFileSync(unit,'utf8').split('\\n'),exec=words(lines.find(l=>l.startsWith('ExecStart=')).slice(10));
  const [key,...value]=words(lines.find(l=>l.startsWith('Environment=')).slice(12))[0].split('=');
  const log=fs.openSync(path.join(state,'service.log'),'a');
  const child=spawn(exec[0],exec.slice(1),{env:{...process.env,[key]:value.join('=')},stdio:['ignore',log,log],detached:true});
  fs.writeFileSync(pidFile,String(child.pid));child.unref();
}
if(args[0]!=='--user')process.exit(2);
if(args[1]==='daemon-reload')process.exit(0);
if(args[1]==='restart'){stop();start();}else if(args[1]==='enable'&&args.includes('--now'))start();
else if(args[1]==='stop')stop();else process.exit(1);
`;

/** Kernel stand-in for the device routes: profile readiness follows the kernel's node_profile rule (lease, executor, generation, bot). */
async function kernel(t){
  const nodes={[NODE]:{token:TOKEN,generation:null,lastSeen:0,heartbeats:[]},[NODE2]:{token:TOKEN2,generation:null,lastSeen:0,heartbeats:[]}},other=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;res.setHeader('content-type','application/json');
    const match=/^\/nodes\/([0-9a-f-]{36})\/(profile|heartbeat|claim)$/.exec(req.url),node=match&&nodes[match[1]];
    if(!node||req.headers['x-oshal-node-token']!==node.token){other.push(req.method+' '+req.url);res.writeHead(node?401:404);return res.end('{}');}
    if(req.method==='GET'&&match[2]==='profile'){
      const lease=Date.now()-node.lastSeen<15*60000;
      return res.end(JSON.stringify({id:match[1],owner:OWNER,tenant:TENANT,harness:'browser-form-v1',supported_work_executor:'browser-form-v1',
        capabilities:{browse:true},bound_bots:[BOT],generation:node.generation,last_seen:node.lastSeen,status:lease?'connected':'lease_expired',work_ready:lease&&node.generation!==null,
        jarvis_node:JARVIS_NODE}));
    }
    const body=JSON.parse(raw||'{}');
    if(match[2]==='heartbeat'&&body.token===node.token){node.generation=body.generation;node.lastSeen=Date.now();
      node.heartbeats.push(Buffer.from(body.generation).toString('hex'));return res.end('{"status":"ok"}');}
    if(match[2]==='claim'&&body.bot===BOT)return res.end('{"envelope":null}');
    other.push(req.method+' '+req.url);res.writeHead(400);res.end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {url:'http://127.0.0.1:'+server.address().port,nodes,other,seen:id=>nodes[id].generation&&Buffer.from(nodes[id].generation).toString('hex')};
}

/** Node resolves `playwright` from every parent folder before NODE_PATH, so the copied program must sit below none that holds one. */
function cleanParent(){
  const shadowed=dir=>{for(let at=resolve(dir);;at=dirname(at)){if(existsSync(join(at,'node_modules/playwright')))return true;if(at===dirname(at))return false;}};
  const parent=[tmpdir(),join(homedir(),'.cache')].find(dir=>existsSync(dir)&&!shadowed(dir));
  assert.ok(parent,'a scratch parent without a node_modules/playwright above it');return parent;
}
function scratch(t){
  const root=mkdtempSync(join(cleanParent(),'career-helper-upgrade-')),home=join(root,'home'),bin=join(root,'bin'),state=join(root,'systemd');
  for(const dir of [home,bin,state])mkdirSync(dir,{mode:0o700});
  writeFileSync(join(bin,'systemctl'),FAKE_SYSTEMCTL,{mode:0o700});
  t.after(async()=>{
    // A graceful stop lets the worker close its Chromium before the profile folder is removed.
    for(const name of existsSync(state)?readdirSync(state):[])if(name.endsWith('.pid'))
      execFileSync(join(bin,'systemctl'),['--user','stop',name.slice(0,-4)],{env});
    await delay(300);execFileSync('chmod',['-R','u+w',root]);rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  });
  const env={...process.env,HOME:home,PATH:bin+':'+process.env.PATH,PLAYWRIGHT_BROWSERS_PATH:browsers,FAKE_SYSTEMD_STATE:state};
  delete env.NODE_PATH;delete env.CAREER_BROWSER_EXECUTABLE;
  const base=join(home,'.local/state/oshal-native/career-browser'),person=join(base,'people',OWNER);
  return {root,env,state,base,person,unit:join(home,'.config/systemd/user',SERVICE),config:join(person,'worker.json'),
    calls:()=>existsSync(join(state,'calls.log'))?readFileSync(join(state,'calls.log'),'utf8').trim().split('\n'):[]};
}

/** A package copy as delivered; `change` edits one file so the copy carries a different program. */
function packageCopy(root,name,change={}){
  const dir=join(root,name,'career-hunter');
  for(const file of PROGRAM){mkdirSync(dirname(join(dir,file)),{recursive:true});
    const text=readFileSync(join(pkg,file),'utf8');writeFileSync(join(dir,file),change[file]?change[file](text):text);}
  return dir;
}

function run(script,args,env){return new Promise(done=>{const child=spawn('python3',[script,...args],{env,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('exit',code=>done({code,out,err}));});}
const json=result=>JSON.parse(result.out.trim().split('\n').at(-1));
const download=(s,k,node=NODE,token=TOKEN,name='download.json')=>{const file=join(s.root,name);
  writeFileSync(file,JSON.stringify({version:1,kernelUrl:k.url,nodeId:node,deviceToken:token,botId:BOT,owner:OWNER,tenant:TENANT}),{mode:0o600});return file;};
async function until(check,what,ms=45000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out: '+what);await delay(200);}}

/** The helper Roger has: installed and started from an older package, heartbeating its own fingerprint. */
async function installOld(s,k,{start=true}={}){
  const old=packageCopy(s.root,'old',{'lib/career-submission-queue.js':text=>text+'\n// an older delivered helper\n'});
  const result=await run(join(old,'bin/install-browser-worker.py'),['--config',download(s,k),'--node-modules',modules,...(start?['--start']:[])],s.env);
  assert.equal(result.code,0,result.err);const fingerprint=json(result).fingerprint;assert.match(fingerprint,/^[a-f0-9]{64}$/);
  if(start)await until(()=>k.seen(NODE)===fingerprint,'the old helper heartbeat');
  return {fingerprint,unit:readFileSync(s.unit,'utf8'),settings:readFileSync(s.config),inode:statSync(s.config).ino};
}
const startLine=text=>text.split('\n').find(l=>l.startsWith('ExecStart='));
const pinnedProgram=text=>/"([^"]+\/releases\/[a-f0-9]{64}\/bin\/career-browser-worker\.cjs)"/.exec(text)[1];
function assertSettingsKept(s,old){
  assert.deepEqual(readFileSync(s.config),old.settings,'the installed settings file is reused byte for byte');
  assert.equal(statSync(s.config).ino,old.inode);assert.equal(statSync(s.config).mode&0o777,0o600);
}
const noToken=result=>assert.ok(!(result.out+result.err).includes(TOKEN)&&!(result.out+result.err).includes(TOKEN2),'no device token in output');

test('a second Connect-a-computer settings file is still refused; --upgrade re-pins the same device in place',{timeout:150000},async t=>{
  const s=scratch(t),k=await kernel(t),old=await installOld(s,k);
  const second=await run(installer,['--config',download(s,k,NODE2,TOKEN2,'second.json'),'--node-modules',modules,'--start'],s.env);
  assert.notEqual(second.code,0,'a different settings file for the same person needs explicit review (defect 16)');noToken(second);
  assert.equal(readFileSync(s.unit,'utf8'),old.unit);assertSettingsKept(s,old);
  const delivered=packageCopy(s.root,'delivered'),calls=s.calls().length;
  const result=await run(installer,['--upgrade','--package',delivered,'--ready-timeout','60'],s.env);
  assert.equal(result.code,0,result.err+result.out);noToken(result);const report=json(result);
  assert.equal(report.upgraded,true);assert.equal(report.nodeId,NODE);assert.equal(report.owner,OWNER);assert.equal(report.service,SERVICE);
  assert.equal(report.previousFingerprint,old.fingerprint);assert.match(report.fingerprint,/^[a-f0-9]{64}$/);assert.notEqual(report.fingerprint,old.fingerprint);
  assert.equal(k.seen(NODE),report.fingerprint,'the kernel sees the new fingerprint');assert.equal(k.seen(NODE2),null,'no other device was used');
  assert.deepEqual(k.other,[],'no enrolment or other device route was called');
  const unit=readFileSync(s.unit,'utf8'),program=pinnedProgram(unit);
  assert.equal(unit,old.unit.replace(pinnedProgram(old.unit),program).replace(old.fingerprint,report.fingerprint),'only the start line changed');
  assert.ok(startLine(unit).endsWith('"--expected-sha256" "'+report.fingerprint+'"'));
  for(const file of PROGRAM.slice(0,7))assert.deepEqual(readFileSync(join(dirname(dirname(program)),file)),readFileSync(join(delivered,file)));
  assert.ok(existsSync(pinnedProgram(old.unit)),'the previous program copy is kept');
  assert.equal(readFileSync(join(s.base,'unit-backups',SERVICE),'utf8'),old.unit,'the previous unit is kept for a manual rollback');
  assertSettingsKept(s,old);
  assert.deepEqual(s.calls().slice(calls),['--user daemon-reload','--user restart '+SERVICE]);
  const pinned=execFileSync(process.execPath,[join(delivered,'bin/career-browser-worker.cjs'),'--fingerprint'],
    {env:{...s.env,NODE_PATH:join(s.base,'runtime-1.59.1/node_modules')}}).toString().trim();
  assert.equal(pinned,report.fingerprint,'the delivered package fingerprint, run with the helper runtime, is the pinned one');
  const again=await run(installer,['--upgrade','--ready-timeout','60'],s.env);
  assert.equal(again.code,0,again.err);assert.equal(json(again).upgraded,false);assert.equal(json(again).current,true);
  const check=await run(installer,['--upgrade','--check-only'],s.env);
  assert.equal(check.code,0,check.err);assert.deepEqual(json(check),{checkOnly:true,service:SERVICE,owner:OWNER,nodeId:NODE,
    installedFingerprint:report.fingerprint,deliveredFingerprint:report.fingerprint,current:true,kernelSeesInstalled:true});
  assert.deepEqual(s.calls().slice(calls),['--user daemon-reload','--user restart '+SERVICE],'a current helper is not restarted');
});

test('a delivered program that fails to start is rolled back to the previous pin, which reports ready again',{timeout:150000},async t=>{
  const s=scratch(t),k=await kernel(t),old=await installOld(s,k);
  const anchor="    await call('heartbeat',{generation});";
  assert.ok(readFileSync(join(pkg,'bin/career-browser-worker.cjs'),'utf8').includes(anchor));
  const broken=packageCopy(s.root,'broken',{'bin/career-browser-worker.cjs':text=>text.replace(anchor,"    throw Error('synthetic_start_failure');")});
  const beats=k.nodes[NODE].heartbeats.length,result=await run(installer,['--upgrade','--package',broken,'--ready-timeout','8'],s.env);
  assert.notEqual(result.code,0,'a failed upgrade exits non-zero');noToken(result);const report=json(result);
  assert.equal(report.upgraded,false);assert.equal(report.rolledBack,true);assert.equal(report.previousReady,true);
  assert.equal(report.reason,'new_program_not_ready');assert.equal(report.fingerprint,old.fingerprint);assert.notEqual(report.attemptedFingerprint,old.fingerprint);
  assert.equal(readFileSync(s.unit,'utf8'),old.unit,'the previous start line is back');assert.equal(k.seen(NODE),old.fingerprint);
  assert.ok(k.nodes[NODE].heartbeats.slice(beats).includes(old.fingerprint),'previousReady rests on a heartbeat after the rollback');
  assertSettingsKept(s,old);assert.deepEqual(k.other,[]);
  assert.deepEqual(s.calls().filter(c=>c.includes('restart')),['--user restart '+SERVICE,'--user restart '+SERVICE]);
});

test('upgrade refuses without an install, while the helper works, with a pending result and with missing settings',{timeout:90000},async t=>{
  const s=scratch(t),k=await kernel(t);
  const none=await run(installer,['--upgrade'],s.env);
  assert.notEqual(none.code,0);assert.match(none.err,/upgrade refused: no_install/);assert.ok(!existsSync(s.base),'nothing is created');
  const old=await installOld(s,k,{start:false}),work=join(s.person,'work');
  for(const [name,code] of [['work-abc123','helper_busy'],['d1000000-0000-0000-0000-000000000001.result.json','helper_result_pending']]){
    const path=join(work,name);name.startsWith('work-')?mkdirSync(path,{mode:0o700}):writeFileSync(path,'{}',{mode:0o600});
    const busy=await run(installer,['--upgrade'],s.env);
    assert.notEqual(busy.code,0);assert.match(busy.err,new RegExp('upgrade refused: '+code));rmSync(path,{recursive:true});
  }
  const copy=join(s.root,'settings-copy');copyFileSync(s.config,copy);unlinkSync(s.config);
  const missing=await run(installer,['--upgrade'],s.env);
  assert.notEqual(missing.code,0);assert.match(missing.err,/upgrade refused: settings_missing/);noToken(missing);
  assert.equal(readFileSync(s.unit,'utf8'),old.unit,'a refused upgrade leaves the unit alone');
  assert.ok(!s.calls().some(c=>c.includes('restart')),'a refused upgrade restarts nothing');
});
