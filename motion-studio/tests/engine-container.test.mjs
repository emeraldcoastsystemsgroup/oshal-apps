/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify source identity, pixel self-test, container hardening and admin installer refusal in isolated review fixtures, never an installed authority claim.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify exact-tick animation through the hardened source image bridge.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {startMotionBridge} from '../engine/bridge.mjs';
import {sourceIdentity,RUNTIME_FILES} from '../engine/package-identity.mjs';
import {startApplicationFixture,chromium} from './application-fixture.mjs';
import {motionEngine} from '../routes/engine-client.mjs';
import {selfTest} from '../engine/container/self-test.mjs';
import {decodePng,sourcePng} from '../engine/container/png.mjs';
import {packageProblems} from '../../scripts/check-engine-container-pattern.mjs';
const exec=promisify(execFile),root=resolve(import.meta.dirname,'..');
const image=process.env.MOTION_CONTAINER_IMAGE,binary=process.env.MOTION_ENGINE_BINARY;
if(!image||!binary)throw new Error('Explicit reviewed worker and disposable review image required; no silent skips.');
test('source packaging matches the real store engine pattern and normalized identity includes every runtime source',async t=>{
  assert.deepEqual(packageProblems(resolve(root,'..'),'motion-studio'),[]);
  const dir=await mkdtemp(join(tmpdir(),'motion-normalized-identity-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const name of RUNTIME_FILES){await mkdir(resolve(dir,name,'..'),{recursive:true});const text=await readFile(resolve(root,'engine',name),'utf8');await writeFile(resolve(dir,name),text.replace(/\r?\n/g,'\r\n'));}
  assert.deepEqual(sourceIdentity(dir),sourceIdentity());
  assert.deepEqual(JSON.parse(await readFile(resolve(root,'routes/engine-identity.json'),'utf8')),sourceIdentity());
});
test('the independent fixture PNG reader validates CRC and inflated-size boundaries',()=>{
  const png=sourcePng(),decoded=decodePng(png);assert.equal(decoded.width,16);assert.equal(decoded.height,8);assert.equal(decoded.pixels[3],128);
  const damaged=Buffer.from(png);damaged[damaged.length-5]^=1;assert.throws(()=>decodePng(damaged));
  assert.throws(()=>decodePng(png.subarray(0,png.length-1)));
  assert.throws(()=>decodePng(Buffer.alloc(12*1024*1024+1)));
});
test('actual local framed worker passes the same pixel/source/font self-test and wrong identity refuses',async t=>{
  const bridge=await startMotionBridge({binary});t.after(()=>bridge.close());
  const proof=await selfTest(sourceIdentity(),bridge.address);assert.equal(proof.midpointAlpha,128);assert.equal(proof.maskedPixels,64);assert.equal(proof.textRendered,true);
  await assert.rejects(selfTest({...sourceIdentity(),buildHash:'0'.repeat(64)},bridge.address),/source_mismatch/);
});
test('administrator installer pins its own compose project and refuses label mismatch before claiming engine readiness',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'motion-installer-control-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const log=join(dir,'calls.jsonl'),docker=join(dir,'docker');
  await writeFile(docker,`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.MOTION_TEST_DOCKER_LOG,JSON.stringify({args,inheritedProject:process.env.COMPOSE_PROJECT_NAME||null})+'\\n');if(args[0]==='inspect'&&args.join(' ').includes('com.docker.compose.project'))console.log(process.env.MOTION_TEST_WRONG_LABEL?'core-stack':'oshal-motion-studio-engine');else if(args[0]==='exec'&&args.includes('--expected-stdin')){process.stdin.resume();process.stdin.on('end',()=>console.log('{"ok":true}'));}\n`,{mode:0o700});
  const env={...process.env,PATH:dir+':'+process.env.PATH,OSHAL_NETWORK:'explicit-test-network',COMPOSE_PROJECT_NAME:'core-stack',MOTION_TEST_DOCKER_LOG:log};
  await exec('sh',[join(root,'engine/install-engine.sh')],{env});
  let calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.every(call=>call.inheritedProject===null));
  assert.deepEqual(calls.find(call=>call.args[0]==='compose').args.slice(0,3),['compose','-p','oshal-motion-studio-engine']);
  await writeFile(log,'');await assert.rejects(exec('sh',[join(root,'engine/install-engine.sh')],{env:{...env,MOTION_TEST_WRONG_LABEL:'1'}}),/Wrong compose project/);
  calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!calls.some(call=>call.args.includes('--expected-stdin')));
  // This mock proves installer decisions only. The next case runs the actual image.
});
test('actual source-built container renders with no network, host ports, host volumes or writable root',async t=>{
  const name='motion-review-'+randomUUID();let created=false;
  t.after(async()=>{if(created)await exec('docker',['rm','-f',name]);});
  await exec('docker',['run','-d','--name',name,'--network','none','--read-only','--tmpfs','/tmp:rw,size=512m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1g','--pids-limit','128',image]);created=true;
  const config=JSON.parse((await exec('docker',['inspect',name],{maxBuffer:65536})).stdout)[0];
  assert.equal(config.Config.User,'10001:10001');assert.equal(config.HostConfig.ReadonlyRootfs,true);assert.equal(config.HostConfig.NetworkMode,'none');
  assert.deepEqual(config.HostConfig.CapDrop,['ALL']);assert.ok(config.HostConfig.SecurityOpt.some(value=>/^no-new-privileges(?::true)?$/.test(value)));
  const status=(await exec('docker',['exec',name,'node','-e',"process.stdout.write(require('node:fs').readFileSync('/proc/self/status','utf8'))"])).stdout;
  assert.match(status,/^Uid:\s+10001\s+10001\s+10001\s+10001$/m);assert.match(status,/^CapEff:\s+0+$/m);assert.match(status,/^NoNewPrivs:\s+1$/m);
  assert.deepEqual(config.HostConfig.PortBindings,{});assert.ok(config.Mounts.every(mount=>mount.Type==='tmpfs'));
  const expected=await readFile(join(root,'routes/engine-identity.json'),'utf8');
  const run=async input=>new Promise((done,reject)=>{
    const child=execFile('docker',['exec','-i',name,'node','/opt/motion-engine/container/self-test.mjs','--expected-stdin'],{maxBuffer:65536,timeout:120000},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):done(JSON.parse(stdout)));
    child.stdin.end(input);
  });
  let proof,last;
  for(let attempt=0;attempt<30;attempt++){try{proof=await run(expected);break;}catch(error){last=error;if(!/ECONNREFUSED/.test(error.message))throw error;await new Promise(done=>setTimeout(done,100));}}
  if(!proof)throw last;assert.deepEqual(proof.identity,sourceIdentity());assert.equal(proof.midpointAlpha,128);assert.equal(proof.maskedPixels,64);assert.equal(proof.textRendered,true);
  const exactScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';import {decodePng} from '/opt/motion-engine/container/png.mjs';const identity=sourceIdentity(),call=p=>exchange(p,identity);const blank=await call({op:'create'});const edited=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Exact',width:32,height:16,duration:5,frameRate:30}},{command:'layer.newSolid',params:{name:'Red',color:'#ff0000',width:16,height:8}},{command:'prop.addKey',params:{layer:'#1',path:'transform/opacity',time:0,value:0}},{command:'prop.addKey',params:{layer:'#1',path:'transform/opacity',time:5,value:100}}]});const frame=await call({op:'preview',document:edited.document,time_ticks:635040000000,transparent:true});const png=decodePng(Buffer.from(frame.png,'base64'));process.stdout.write(JSON.stringify({timeTicks:frame.timeTicks,alpha:png.pixels[(8*32+16)*4+3]}));`;
  const exact=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',exactScript],{maxBuffer:65536})).stdout);
  assert.equal(exact.timeTicks,635040000000);assert.equal(exact.alpha,128);
  const keyScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';const identity=sourceIdentity(),call=p=>exchange(p,identity);const blank=await call({op:'create'}),seed=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Keys',width:32,height:16,duration:5,frameRate:30}},{command:'layer.newSolid',params:{name:'Dot',width:8,height:4}}]});const comp=Object.values(seed.document.items).find(i=>i.kind.type==='Comp'),layer=comp.kind.layers[0],prop=layer.props.children.find(p=>p.match==='transform').children.find(p=>p.match==='opacity'),refs={layer:String(layer.id),prop:String(prop.uid),timeTicks:'635040000000'};const result=await call({op:'edit',document:seed.document,comp:comp.id,commands:[{command:'keys.addExact',params:{...refs,value:37}},{command:'keys.inspectExact',params:refs}]});process.stdout.write(JSON.stringify(result.results[1]));`;
  const key=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',keyScript],{maxBuffer:65536})).stdout);
  assert.equal(key.layerTimeTicks,635040000000);assert.equal(key.key.value.v,37);assert.equal(key.samples.length,65);

  const textScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';import {decodePng} from '/opt/motion-engine/container/png.mjs';const call=p=>exchange(p,sourceIdentity()),blank=await call({op:'create'}),seed=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Caption',width:160,height:90,duration:5,frameRate:30}},{command:'layer.newText',params:{text:'MM',size:24,font:'Inter',position:[80,45]}}]});const comp=Object.values(seed.document.items).find(i=>i.kind.type==='Comp'),layer=comp.kind.layers[0],edited=await call({op:'edit',document:seed.document,comp:comp.id,commands:[{command:'text.patchAt',params:{layer:String(layer.id),compTimeTicks:'0',attributes:{text:'MW',fill:[0,0,1,0.5],style:'Bold'}}},{command:'text.fonts',params:{}}]}),frame=await call({op:'preview',document:edited.document,comp:comp.id,time_ticks:0,transparent:true}),png=decodePng(Buffer.from(frame.png,'base64'));let alpha=0,pixels=0,blue=0,red=0;for(let i=0;i<png.pixels.length;i+=4)if(png.pixels[i+3]){pixels++;alpha=Math.max(alpha,png.pixels[i+3]);blue=Math.max(blue,png.pixels[i+2]);red=Math.max(red,png.pixels[i]);}process.stdout.write(JSON.stringify({text:edited.results[0].value.text,fonts:edited.results[1].families,alpha,pixels,blue,red}));`;
  const text=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',textScript],{maxBuffer:65536})).stdout);
  assert.equal(text.text,'MW');assert.ok(text.fonts.some(font=>font.family==='Inter'&&font.styles.includes('Bold')));assert.ok(text.pixels>0);assert.equal(text.alpha,128);assert.equal(text.blue,255);assert.equal(text.red,0);

  const maskScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';import {decodePng} from '/opt/motion-engine/container/png.mjs';const call=p=>exchange(p,sourceIdentity()),blank=await call({op:'create'}),seed=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Mask',width:32,height:16,duration:5,frameRate:30}},{command:'layer.newSolid',params:{name:'Red',color:'#ff0000',width:16,height:8}},{command:'layer.addMask',params:{layer:'Red',rect:[0,0,8,8]}}]});const comp=Object.values(seed.document.items).find(i=>i.kind.type==='Comp'),layer=comp.kind.layers[0],mask=layer.props.children.find(p=>p.match==='masks').children[0],opacity=mask.children.find(p=>p.match==='opacity');const edited=await call({op:'edit',document:seed.document,comp:comp.id,commands:[{command:'keys.addExact',params:{layer:String(layer.id),prop:String(opacity.uid),timeTicks:'0',value:0}},{command:'keys.addExact',params:{layer:String(layer.id),prop:String(opacity.uid),timeTicks:'508032000000',value:100}},{command:'mask.patchAt',params:{layer:String(layer.id),mask:String(mask.uid),compTimeTicks:'127008000001',operations:[{command:'layer.mask.set',params:{field:'opacity',value:37}}]}}]});const frame=await call({op:'preview',document:edited.document,comp:comp.id,time_ticks:127008000001,transparent:true}),png=decodePng(Buffer.from(frame.png,'base64'));process.stdout.write(JSON.stringify({mask:edited.results[2],alpha:png.pixels[(8*32+12)*4+3]}));`;
  const mask=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',maskScript],{maxBuffer:65536})).stdout);assert.equal(mask.mask.compTimeTicks,'127008000001');assert.equal(mask.mask.properties.opacity.keyCount,3);assert.equal(mask.mask.properties.opacity.value.v,37);assert.equal(mask.alpha,94);

  const characterScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';import {decodePng} from '/opt/motion-engine/container/png.mjs';const call=p=>exchange(p,sourceIdentity()),blank=await call({op:'create'}),seed=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Full glyph',width:320,height:180,duration:5,frameRate:30}},{command:'layer.newText',params:{name:'Large M',text:'M',font:'Inter',size:6000,position:[10,165]}},{command:'layer.setText',params:{layer:'#1',justify:'left'}},{command:'prop.set',params:{layer:'#1',path:'transform/scale',value:[5,5,5]}},{command:'layer.enablePerChar3D',params:{layer:'#1',enabled:true}}]});const frame=await call({op:'preview',document:seed.document,time_ticks:0,transparent:true}),png=decodePng(Buffer.from(frame.png,'base64'));let tail=0;for(let y=0;y<png.height;y++)for(let x=230;x<png.width;x++)if(png.pixels[(y*png.width+x)*4+3])tail++;const huge=await call({op:'edit',document:seed.document,commands:[{command:'layer.setText',params:{layer:'#1',text:'MM'}}]});let refusal;try{await call({op:'preview',document:huge.document,time_ticks:0,transparent:true});}catch(e){refusal=e.message;}const catalog=await call({op:'catalog'});process.stdout.write(JSON.stringify({tail,refusal,perCharacterTextSurfacePixels:catalog.perCharacterTextSurfacePixels}));`;
  const character=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',characterScript],{maxBuffer:65536})).stdout);assert.ok(character.tail>100);assert.match(character.refusal,/text_surface_limit/);assert.equal(character.perCharacterTextSurfacePixels,33554432);

  const featherScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';import {decodePng} from '/opt/motion-engine/container/png.mjs';const call=p=>exchange(p,sourceIdentity()),blank=await call({op:'create'}),seed=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{width:160,height:90,duration:5,frameRate:30}},{command:'layer.newSolid',params:{name:'Red',color:'#ff0000',width:100,height:60}},{command:'layer.addMask',params:{layer:'Red',rect:[10,10,40,20]}}]});const comp=Object.values(seed.document.items).find(i=>i.kind.type==='Comp'),layer=comp.kind.layers[0],mask=layer.props.children.find(p=>p.match==='masks').children[0];const edited=await call({op:'edit',document:seed.document,comp:comp.id,commands:[{command:'mask.patchAt',params:{layer:String(layer.id),mask:String(mask.uid),compTimeTicks:'0',operations:[{command:'mask.featherPoint.add',params:{segment:3,t:.5,radius:12,tension:25}},{command:'mask.featherPoint.add',params:{segment:1,t:.5,radius:0}}]}}]}),frame=await call({op:'preview',document:edited.document,comp:comp.id,time_ticks:0,transparent:true}),png=decodePng(Buffer.from(frame.png,'base64'));process.stdout.write(JSON.stringify({left:png.pixels[(35*160+35)*4+3],right:png.pixels[(35*160+85)*4+3],points:edited.results[0].properties.path.value.v.feather}));`;
  const feather=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',featherScript],{maxBuffer:65536})).stdout);assert.ok(feather.left>0&&feather.left<255);assert.equal(feather.right,0);assert.equal(feather.points.length,2);assert.equal(feather.points[0].tension,.25);

  const pointScript=`import {exchange} from '/opt/motion-engine/container/wire.mjs';import {sourceIdentity} from '/opt/motion-engine/package-identity.mjs';import {decodePng} from '/opt/motion-engine/container/png.mjs';const call=p=>exchange(p,sourceIdentity()),blank=await call({op:'create'}),seed=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Point',width:320,height:180,duration:5,frameRate:30}},{command:'layer.newText',params:{text:'M'.repeat(60000),name:'Exact point source',size:1,position:[160,90]}}]});const comp=Object.values(seed.document.items).find(i=>i.kind.type==='Comp'),layer=comp.kind.layers[0],frame=await call({op:'preview',document:seed.document,comp:comp.id,time_ticks:0,transparent:true}),png=decodePng(Buffer.from(frame.png,'base64'));let visible=0;for(let i=3;i<png.pixels.length;i+=4)if(png.pixels[i])visible++;const huge=await call({op:'edit',document:seed.document,comp:comp.id,commands:[{command:'text.patchAt',params:{layer:String(layer.id),compTimeTicks:'0',attributes:{text:'MM',size:10000}}}]});let refusal;try{await call({op:'preview',document:huge.document,comp:comp.id,time_ticks:0,transparent:true});}catch(error){refusal=error.message;}const catalog=await call({op:'catalog'});process.stdout.write(JSON.stringify({visible,refusal,textSurfacePixels:catalog.textSurfacePixels,derivative:catalog.nativeRenderDerivative}));`;
  const point=JSON.parse((await exec('docker',['exec',name,'node','--input-type=module','-e',pointScript],{maxBuffer:65536,timeout:60000})).stdout);assert.ok(point.visible>0);assert.match(point.refusal,/text_surface_limit/);assert.equal(point.textSurfacePixels,33554432);assert.equal(point.derivative,'full-bounded-text-surfaces');

  await assert.rejects(run(JSON.stringify({...sourceIdentity(),buildHash:'0'.repeat(64)})),/installed package differs/);
  const notices=JSON.parse((await exec('docker',['exec',name,'node','-e',"process.stdout.write(require('node:fs').readFileSync('/opt/motion-dependency-notices/INDEX.json'))"],{maxBuffer:1024*1024})).stdout);
  assert.ok(notices.packages.length>100);assert.ok(notices.packages.some(pkg=>pkg.name==='effectcraft-text'));const derivative=notices.packages.find(pkg=>pkg.name==='effectcraft-render');assert.equal(derivative.modified,true);assert.equal(derivative.source,'git+https://github.com/storytold/effectcraft#67434e90388b6dca4417555346fa6850b6f96033');assert.ok(derivative.licenseTexts>=2);assert.ok(derivative.modifications.some(change=>change.includes('src/text.rs')));
});

test('actual HTTP and human page display bounded route guidance while a withdrawn view reveals none',async t=>{
  const fixture=await startApplicationFixture();let server,context;t.after(async()=>{await context?.close();await server?.close();await fixture.close();});
  fixture.state.afterEngine=()=>{throw new Error('Explicit unavailable-relay fixture');};
  let response=await fetch(fixture.origin+'/api/motion-studio/editing-contract');assert.equal(response.status,503);
  const body=await response.json();assert.match(body.detail,/installation administrator/);assert.match(body.installHint,/engine\/install-engine.sh/);assert.equal(body.expectedBuildHash,sourceIdentity().buildHash);
  assert.ok(Buffer.byteLength(JSON.stringify(body))<4096);assert.ok(!body.installHint.includes(root));
  await assert.rejects(motionEngine({intent:async()=>({hello:{bridge:{...sourceIdentity(),buildHash:'0'.repeat(64)}},reply:null})},{op:'create'}),error=>error.code==='motion_engine_source_mismatch'&&error.detail.includes('update'));
  await assert.rejects(motionEngine({intent:async()=>({hello:{error:'motion_engine_busy'},reply:null})},{op:'create'}),error=>error.detail.includes('Try again')&&error.engineSetup===undefined);
  server=await chromium.launchServer({headless:true,host:'127.0.0.1'});
  const browser=await chromium.connect(server.wsEndpoint());context=await browser.newContext({viewport:{width:412,height:915}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(fixture.origin+'/api/motion-studio/app');await page.locator('#status').filter({hasText:'Engine unavailable'}).waitFor();
  assert.match(await page.locator('#error').innerText(),/installation administrator/);assert.equal(await page.locator('#new button').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  fixture.state.denied.set('blocked',new Set(['project.view']));
  response=await fetch(fixture.origin+'/api/motion-studio/editing-contract',{headers:{'x-fixture-user':'blocked'}});assert.equal(response.status,403);
  assert.equal((await response.json()).installHint,undefined);
});
