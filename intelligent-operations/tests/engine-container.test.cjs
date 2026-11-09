/** CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | 1.5.2: guard the install-time probe a review asked for (2026-11-09): the compose test above reads files only, so nothing proved the running search applies the free-space watermarks or lifts the index-create block. The installer must read the three watermarks from compose.yaml before it starts anything (its parser gives exactly the values js-yaml reads), and once the engine and its link are in place it must run engine/search-disk-guard.py over search's own GET /_cluster/settings?include_defaults=true&flat_settings=true, retry for 3 minutes and refuse to finish (search's answer, its log, exit 1) when it never passes. The guard itself is proven against a real OpenSearch in tests/search-disk-guard.test.cjs. */
/** CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | 1.5.1: guard the search service's disk watermarks. All three are absolute free-space sizes shrinking from low to high to flood stage, the disk monitor and the create-index auto-release are never turned off, and lab/detection.py renders the same three. On 2026-11-08 the Spark's 91 % full 3.5 TB disk (310 GB free) tripped OpenSearch's default 90 % high watermark; its index-create block refused every new rule index with HTTP 403, desk activation failed and the processing tick answered 503 every minute. */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | The closing-step guard expects the on-demand wording, not an "only control" claim: publishing, previewing and evaluating report the engine state with the same install command (third review, 2026-11-03). */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | A hello carrying error (the engine's own busy signal, {"error":"engine-busy"} relayed by the kernel with a null reply) must be the transient busy 503 without an installHint property, never the build-mismatch refusal; the installer must prove the restarted link unit (systemctl --user is-active and a TCP connect to the loopback port parsed from the unit, within 5 s) before saying the kernel dials the engine again, and print the unit's last 20 journal lines and exit 1 otherwise; and its closing step must name the real control, the Operations navigation entry "Data pipeline" and its button "Check detection service" (GET /pipeline/health), as experience/index.html spells them. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the engine-container pattern the store gate checks (scripts/check-engine-container-pattern.mjs): the compiled route exports INSTALL_HINT naming install-engine.sh and refuses an unreachable engine or an identity-digest mismatch with status 503, the command in the message and installHint beside it (a kernel deadline or a busy engine carries none), the mounted router answers that shape over HTTP, and the installer restarts an existing oshal-native-operations-link user unit after the recreate through systemctl --user cat/restart only, printing the two host steps when the unit is absent. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Spark engine container shape (engine/container/compose.yaml) and its installer without Docker: no published port, search private, engine on the engines network, digest-pinned images, read-only capability-free engine over exactly the three engine files, and an installer that self-tests against identity.json and only prints the host steps. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),engine=path.join(root,'engine'),composeFile=path.join(engine,'container/compose.yaml'),installer=path.join(engine,'install-engine.sh');
const dependency=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(root,'../scripts/toolchain'),'package.json'));
const yaml=dependency('js-yaml');
const compose=yaml.load(fs.readFileSync(composeFile,'utf8'));
const {detectionEngine,INSTALL_HINT}=require('../routes/detection-engine.js');
const identity=JSON.parse(fs.readFileSync(path.join(engine,'identity.json'),'utf8'));
/** The route's context with one fake kernel relay; the package dir is the real one so identity.json is read. */
const relay=intent=>({appPackageDir:root,intent});
/** A relay whose engine answers the hello and one health reply. */
const answering=hello=>async()=>({hello,reply:{id:1,result:{backend:'opensearch',version:'3.3.2',health:'green'}}});
/** A relay that fails the way the kernel's engine.exchange intent does. */
const failing=message=>async()=>{throw Error(message);};
const EXTERNAL='engines',ENGINE_FILES=['server.py','percolation.py','identity.json'];
/** Every key name found anywhere under a value, so a published port cannot hide at any depth. */
function keysDeep(value,found=new Set()){if(Array.isArray(value))value.forEach(v=>keysDeep(v,found));else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){found.add(k);keysDeep(v,found);}return found;}
/** Service network names whether networks is written as a list or a mapping. */
function networksOf(service){return Array.isArray(service.networks)?service.networks:Object.keys(service.networks||{});}

test('the project publishes no port, keeps search private and joins only the engine to the external engines network',()=>{
  assert.equal(compose.name,'oshal-intelligent-operations-engine');
  assert.deepEqual(Object.keys(compose.services).sort(),['engine','search']);
  for(const [name,service] of Object.entries(compose.services)){assert.ok(!keysDeep(service).has('ports'),name+' publishes a port');assert.ok(!keysDeep(service).has('expose'),name+' exposes a port');}
  assert.equal(compose.networks[EXTERNAL].external,true);
  assert.equal(compose.networks[EXTERNAL].name,'${OSHAL_ENGINE_NETWORK:-oshal-native-engines}');
  assert.deepEqual(networksOf(compose.services.search),['private'],'search must sit on the private network only');
  assert.ok(networksOf(compose.services.engine).includes(EXTERNAL),'the engine must join the engines network');
  assert.ok(networksOf(compose.services.engine).includes('private'),'the engine must reach search on the private network');
  assert.equal(compose.services.engine.container_name,'oshal-intelligent-operations-engine');
  assert.equal(compose.services.search.environment.OPERATIONS_SEARCH_URL,undefined);
  assert.equal(compose.services.engine.environment.OPERATIONS_SEARCH_URL,'http://search:9200');
});

test('both images are pinned by digest and the search pin is the Kubernetes lab installer pin',()=>{
  const pinned=/@sha256:[a-f0-9]{64}$/;
  for(const [name,service] of Object.entries(compose.services))assert.match(service.image,pinned,name+' image is not digest-pinned');
  assert.match(compose.services.engine.image,/^python:3\.13-slim@sha256:/);
  const lab=fs.readFileSync(path.join(root,'lab/detection.py'),'utf8');
  const labPin=/^SEARCH='opensearchproject\/opensearch@(sha256:[a-f0-9]{64})'$/m.exec(lab);
  assert.ok(labPin,'lab/detection.py no longer pins the search image');
  assert.ok(compose.services.search.image.endsWith('@'+labPin[1]),'compose search digest differs from lab/detection.py');
  assert.match(compose.services.search.image,/^opensearchproject\/opensearch:3\.3\.2@/);
});

test('the engine runs read-only without capabilities as 1000:1000 over exactly the three mounted engine files',()=>{
  const service=compose.services.engine;
  assert.equal(service.read_only,true);assert.deepEqual(service.cap_drop,['ALL']);assert.deepEqual(service.security_opt,['no-new-privileges:true']);
  assert.equal(service.pids_limit,128);assert.equal(service.mem_limit,'256m');assert.equal(String(service.user),'1000:1000');assert.equal(service.restart,'unless-stopped');
  assert.deepEqual(service.command,['python','-B','/engine/server.py']);
  assert.equal(service.environment.OPERATIONS_ENGINE_BIND,'0.0.0.0');assert.equal(String(service.environment.OPERATIONS_ENGINE_PORT),'7419');assert.equal(String(service.environment.PYTHONDONTWRITEBYTECODE),'1');
  assert.ok(service.healthcheck.test.join(' ').includes('7419'),'the healthcheck must probe 7419');
  const mounts=service.volumes.map(v=>{assert.equal(v.type,'bind');assert.equal(v.read_only,true);assert.equal(v.target,'/engine/'+path.basename(v.source));return path.basename(v.source);});
  assert.deepEqual(mounts.sort(),[...ENGINE_FILES].sort(),'the engine mounts exactly server.py, percolation.py and identity.json');
  for(const v of service.volumes){const source=path.resolve(path.dirname(composeFile),v.source);assert.ok(fs.statSync(source).isFile(),v.source+' is not a file next to the engine');assert.equal(path.dirname(source),engine);}
  const search=compose.services.search;
  assert.deepEqual(search.cap_drop,['ALL']);assert.deepEqual(search.security_opt,['no-new-privileges:true']);assert.equal(search.mem_limit,'1536m');assert.equal(search.restart,'unless-stopped');
  assert.equal(search.environment['discovery.type'],'single-node');assert.equal(String(search.environment.DISABLE_SECURITY_PLUGIN),'true');assert.equal(String(search.environment.DISABLE_INSTALL_DEMO_CONFIG),'true');
  assert.equal(search.environment.OPENSEARCH_JAVA_OPTS,'-Xms512m -Xmx512m');assert.equal(String(search.environment['node.store.allow_mmap']),'false');
  assert.deepEqual(search.volumes,['search-data:/usr/share/opensearch/data']);assert.ok(compose.volumes['search-data']!==undefined);
});

test('search judges disk pressure by free space in both shapes, so a mostly full large disk cannot block new rule indexes',()=>{
  // A percentage of a 3.5 TB disk is hundreds of GB: at 91 % used the default 90 % high watermark put the index-create block
  // on the cluster and every new rule index (each desk's default policy among them) came back HTTP 403.
  const env=compose.services.search.environment,keys=['low','high','flood_stage'].map(k=>'cluster.routing.allocation.disk.watermark.'+k);
  const free=keys.map(k=>{const v=String(env[k]??'');assert.match(v,/^[1-9]\d*gb$/,k+' must be an absolute free-space size such as 20gb, never a percentage or a ratio');return Number.parseInt(v,10);});
  assert.ok(free[0]>free[1]&&free[1]>free[2],'free space must shrink from the low to the high to the flood-stage watermark');
  for(const off of ['cluster.routing.allocation.disk.threshold_enabled','cluster.blocks.create_index.auto_release'])
    assert.notEqual(String(env[off]),'false',off+' stays on: the disk monitor is what lifts an index-create block it set');
  assert.equal(env['cluster.blocks.create_index'],undefined,'the compose file never sets the block itself');
  const objects=JSON.parse(execFileSync('python3',[path.join(root,'lab/detection.py'),'render'],{encoding:'utf8'}));
  const search=objects.find(o=>o.kind==='Deployment').spec.template.spec.containers.find(c=>c.name==='search');
  const lab=Object.fromEntries(search.env.map(e=>[e.name,e.value]));
  for(const k of keys)assert.equal(lab[k],String(env[k]),'lab/detection.py renders '+k+' as engine/container/compose.yaml declares it');
});

test('the install finishes only when the running search reports the free-space watermarks compose.yaml sets and no index-create block',()=>{
  const code=fs.readFileSync(installer,'utf8').split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');
  assert.match(code,/^SETTINGS='http:\/\/127\.0\.0\.1:9200\/_cluster\/settings\?include_defaults=true&flat_settings=true'$/m,'what search applies, its node settings included');
  const parser=/^watermark\(\) \{\n[\s\S]*?\n\}\n/m.exec(code);assert.ok(parser,'the installer defines watermark()');
  const levels=['low','high','flood_stage'],env=compose.services.search.environment;
  const parsed=execFileSync('sh',['-c',parser[0]+'COMPOSE=$1; for level in low high flood_stage; do watermark "$level"; done','installer',composeFile],{encoding:'utf8'}).trim().split('\n');
  assert.deepEqual(parsed,levels.map(l=>String(env['cluster.routing.allocation.disk.watermark.'+l])),'the installer requires exactly the values compose.yaml gives search');
  for(const [name,level] of [['LOW','low'],['HIGH','high'],['FLOOD','flood_stage']])assert.match(code,new RegExp('^'+name+'=\\$\\(watermark '+level+'\\)$','m'));
  assert.match(code,/\|\| die "compose\.yaml gives search no free-space disk watermarks/,'a compose file without them stops the install');
  assert.ok(code.indexOf('LOW=$(watermark low)')<code.indexOf('docker compose -p'),'the watermarks are read before anything starts');
  const check=/^disk_settings\(\) \{\n([\s\S]*?)\n\}\n/m.exec(code);assert.ok(check,'the installer defines disk_settings()');
  assert.equal(check[1].trim(),'docker exec "$SEARCH" curl -fsS "$SETTINGS" | python3 -I "$ENGINE_DIR/search-disk-guard.py" "$LOW" "$HIGH" "$FLOOD"','search answers inside its container and the guard judges it with the three values');
  assert.ok(fs.statSync(path.join(engine,'search-disk-guard.py')).isFile(),'the guard ships beside the installer');
  const loop=/\nuntil verdict=\$\(disk_settings\); do\n([\s\S]*?)\ndone\n/.exec(code);assert.ok(loop,'the installer retries the check');
  assert.match(loop[1],/\[ "\$i" -ge 36 \]/);assert.match(loop[1],/sleep 5/,'36 tries 5 s apart: the disk monitor lifts an old block on a pass after the restart');
  assert.match(loop[1],/printf '%s\\n' "\$verdict" >&2/,'search\'s last answer is printed');assert.match(loop[1],/docker logs --tail 40 "\$SEARCH"/);
  assert.match(loop[1],/\n\s+die "after 3 minutes search still does not judge disk by the free space compose\.yaml sets or still blocks new indexes/,'and the install refuses to finish, exit 1');
  const link=code.indexOf('\nfi\n',code.indexOf('{"intelligent-operations":"127.0.0.1:%s"}')),until=code.indexOf('\nuntil verdict=$(disk_settings)'),closing=code.lastIndexOf('say "then open Operations');
  assert.ok(link>0&&until>link&&closing>until,'the check runs once the engine and its link are in place, so a refusal leaves the kernel dialling the engine, and before the closing step');
});

test('identity.json is the SHA-256 of percolation.py then server.py, the digest the installer self-test compares',()=>{
  const identity=JSON.parse(fs.readFileSync(path.join(engine,'identity.json'),'utf8'));
  const digest=crypto.createHash('sha256').update(Buffer.concat(['percolation.py','server.py'].map(n=>fs.readFileSync(path.join(engine,n))))).digest('hex');
  assert.equal(identity.buildHash,digest);assert.equal(identity.protocol,1);assert.equal(identity.engine,'operations-detection');
});

test('the installer is executable, parses, self-tests the hello against identity.json and only prints the host steps',()=>{
  assert.notEqual(fs.statSync(installer).mode&0o111,0,'install-engine.sh must be executable');
  const text=fs.readFileSync(installer,'utf8');
  assert.ok(text.startsWith('#!/bin/sh\n'));
  execFileSync('sh',['-n',installer],{stdio:'pipe'});
  assert.doesNotMatch(text,/docker build/,'the installer builds nothing');
  const selfTest=/self_test\(\) \{([\s\S]*?)\n\}\n/.exec(text);
  assert.ok(selfTest,'the installer defines self_test()');
  assert.match(selfTest[1],/identity\.json/,'the self-test must compare the hello against identity.json');
  assert.match(selfTest[1],/"cmd": "health"/,'the self-test must send the health command');
  assert.match(selfTest[1],/"id": 1/,'the self-test must send id 1 as the kernel relay does');
  assert.match(text,/EXPECTED=\$\(sed [^\n]*identity\.json"\)/,'the host identity.json digest is read into the self-test');
  assert.match(text,/native_container_forward\.py %s %s %s %s\\n' "\$LISTEN" "\$CONTAINER" "\$NETWORK" "\$ENGINE_PORT"/,'the link unit line is printed with listen, container, network and 7419');
  assert.match(text,/\{"intelligent-operations":"127\.0\.0\.1:%s"\}/,'the OSHAL_PACKAGE_ENGINES entry is printed');
  assert.match(text,/LISTEN=\$\{1:-37420\}/,'the listen port argument defaults to 37420');
  assert.match(text,/wait_for_status=yellow/,'the installer waits for yellow search health');
  assert.match(text,/docker exec "\$SEARCH" curl/,'the health wait runs curl inside the search container');
  assert.doesNotMatch(text,/sed -i|tee |oshald\.env[^ ]*\s*>>?/,'the installer writes no host file');
  const code=text.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');
  const calls=code.match(/systemctl --user[^\n|&;]*/g)||[];
  assert.ok(calls.length>=3,'the installer detects, restarts and verifies the link unit through systemctl --user');
  for(const call of calls)assert.match(call.trim(),/^systemctl --user (cat|restart|is-active) "\$LINK"/,'only cat, restart and is-active of the pinned link unit: '+call.trim());
  assert.equal((code.match(/systemctl/g)||[]).length,calls.length+1,'systemctl appears only as the command -v probe and those --user calls');
  const help=execFileSync('sh',[installer,'--help'],{encoding:'utf8'});
  assert.match(help,/^# Usage/m);assert.match(help,/oshal-native-operations-link\.service/);assert.match(help,/^# Env overrides/m);
});

test('after the recreate and the self-test the installer restarts an existing oshal-native-operations-link unit, else prints the two host steps',()=>{
  const code=fs.readFileSync(installer,'utf8').split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');
  assert.match(code,/^LINK=oshal-native-operations-link\.service$/m,'the link unit name is pinned');
  const branch=/if command -v systemctl >\/dev\/null 2>&1 && systemctl --user cat "\$LINK" >\/dev\/null 2>&1; then\n([\s\S]*?)\nelse\n([\s\S]*?)\nfi\n/.exec(code);
  assert.ok(branch,'the restart is guarded by systemctl --user cat of the unit and has an else branch');
  assert.match(branch[1],/systemctl --user restart "\$LINK" \|\| die /,'the unit is restarted and a failed restart is an error');
  assert.match(branch[1],/say "restarted \$LINK/,'the restart is said');
  assert.match(branch[1],/OSHAL_PACKAGE_ENGINES must still pin/,'the restart branch names the pin it leaves unchanged');
  assert.doesNotMatch(branch[1],/native_container_forward\.py %s/,'the restart branch does not print the link step as still to do');
  assert.match(branch[2],/native_container_forward\.py %s %s %s %s/,'the else branch prints the link unit line');
  assert.match(branch[2],/OSHAL_PACKAGE_ENGINES entry/,'the else branch prints the OSHAL_PACKAGE_ENGINES step');
  const recreate=code.indexOf('--force-recreate engine'),selfTest=code.indexOf('if ! self_test; then'),restart=code.indexOf('systemctl --user restart');
  assert.ok(recreate>0&&selfTest>recreate&&restart>selfTest,'the restart comes after the engine recreate and after the self-test passed');
});

test('the restarted link unit is proven active and connectable within 5 s before the installer says the kernel dials the engine again, else the journal is printed and it exits 1',()=>{
  const text=fs.readFileSync(installer,'utf8'),code=text.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');
  const ready=/link_ready\(\) \{([\s\S]*?)\n\}\n/.exec(code);
  assert.ok(ready,'the installer defines link_ready()');
  assert.match(ready[1],/systemctl --user is-active "\$LINK"/,'the unit must be active');
  assert.match(ready[1],/python3 -c '[^']*socket\.create_connection\(\("127\.0\.0\.1", int\(sys\.argv\[1\]\)\), 1\)/,'the loopback port handed in must accept a TCP connect');
  assert.match(ready[1],/\[ "\$i" -lt 5 \]/,'at most five one-second attempts');assert.match(ready[1],/sleep 1/);
  const branch=/if command -v systemctl >\/dev\/null 2>&1 && systemctl --user cat "\$LINK" >\/dev\/null 2>&1; then\n([\s\S]*?)\nelse\n/.exec(code)[1];
  const restart=branch.indexOf('systemctl --user restart "$LINK"'),probe=branch.indexOf('if ! link_ready "$probe"; then'),journal=branch.indexOf('journalctl --user --no-pager -u "$LINK" -n 20'),said=branch.indexOf('say "restarted $LINK');
  assert.ok(restart>=0&&probe>restart&&journal>probe&&said>journal,'restart, then link_ready on the parsed port, then the journal on failure, and only then the restarted line');
  assert.match(branch,/probe=\$\{unit_listen:-\$LISTEN\}/,'the probed port is the one parsed from the unit, the argument only when none parsed');
  assert.match(branch.slice(journal,said),/\n\s+die "\$LINK was restarted but within 5 s it was not active or loopback 127\.0\.0\.1:\$probe refused a TCP connect/,'the failure line is clear and die exits 1');
  assert.match(text,/^die\(\) \{ printf [^\n]*>&2; exit 1; \}$/m,'die exits 1');
  assert.match(code,/say "restarted \$LINK: loopback \$probe -> \$CONTAINER:\$ENGINE_PORT on \$NETWORK dials the recreated engine again \(unit active, 127\.0\.0\.1:\$probe accepted a TCP connect\)"/);
});

test('the closing operator step names the Operations navigation entry and button that report the engine state, as the experience spells them',()=>{
  const surface=fs.readFileSync(path.join(root,'experience/index.html'),'utf8');
  assert.ok(surface.includes('<a href="#data">Data pipeline</a>'),'the Operations navigation entry is Data pipeline');
  assert.ok(surface.includes('<button id="engine-health">Check detection service</button>'),'the button is Check detection service');
  assert.match(fs.readFileSync(path.join(root,'experience/experience.js'),'utf8'),/\$\('engine-health'\)\.addEventListener\('click',[^\n]*request\('\/pipeline\/health'\)/,'the button calls GET /pipeline/health');
  const closing=fs.readFileSync(installer,'utf8').trimEnd().split('\n').pop();
  assert.match(closing,/^say "then open Operations, choose the navigation entry 'Data pipeline' and press 'Check detection service' \(GET \/pipeline\/health\)/);
  assert.match(closing,/on-demand check, like publishing or previewing a policy and evaluating, reports the engine state with this install command/);
  assert.doesNotMatch(closing,/Data & decisions|refresh processing/,'the closing step names no screen that does not exist');
  const readme=fs.readFileSync(path.join(engine,'README.md'),'utf8');
  assert.match(readme,/navigation entry \*\*Data pipeline\*\* and its button \*\*Check detection service\*\*/);assert.doesNotMatch(readme,/Data & decisions/);
});

test('INSTALL_HINT is the installer command the route hands the surface',()=>{
  assert.match(INSTALL_HINT,/sh intelligent-operations\/engine\/install-engine\.sh <listen-port>/);
  assert.ok(fs.readFileSync(path.join(root,'routes/detection-engine.js'),'utf8').includes('install-engine.sh'),'the compiled route names install-engine.sh');
});

test('an engine whose identity digest differs is refused with the install command',async()=>{
  const run=detectionEngine(relay(answering({...identity,buildHash:'0'.repeat(64)})));
  await assert.rejects(run('health','person-1'),error=>error.status===503&&error.installHint===INSTALL_HINT&&/does not match this package build/.test(error.message)&&error.message.includes(INSTALL_HINT));
  const other=detectionEngine(relay(answering({...identity,engine:'other-engine'})));
  await assert.rejects(other('health','person-1'),error=>error.status===503&&error.installHint===INSTALL_HINT);
});

test('an engine the kernel relay cannot reach is refused with the install command',async()=>{
  const run=detectionEngine(relay(failing('engine container is not reachable or broke its line protocol')));
  await assert.rejects(run('health','person-1'),error=>error.status===503&&error.installHint===INSTALL_HINT&&/not reachable/.test(error.message)&&error.message.includes(INSTALL_HINT));
});

test('a hello carrying error, the engine busy signal the kernel relays with a null reply, is the transient busy 503 with no installHint property',async()=>{
  const run=detectionEngine({appPackageDir:root,intent:async()=>({hello:{error:'engine-busy'},reply:null})});
  await assert.rejects(run('health','person-1'),error=>error.status===503&&!('installHint' in error)&&/busy/.test(error.message)&&error.message==='The detection engine is busy; retry shortly.'&&!error.message.includes('install-engine.sh'));
});

test('a kernel deadline or a busy engine is reported as such without the install command',async()=>{
  await assert.rejects(detectionEngine(relay(failing('engine did not answer within the request deadline')))('health','person-1'),error=>error.status===503&&error.installHint===undefined&&/deadline/.test(error.message)&&!error.message.includes('install-engine.sh'));
  await assert.rejects(detectionEngine(relay(failing('engine is busy')))('health','person-1'),error=>error.status===503&&error.installHint===undefined&&/busy/.test(error.message)&&!error.message.includes('install-engine.sh'));
});

test('a matching hello completes the reply with the engine build, and an unverified caller never reaches the relay',async()=>{
  const requests=[];
  const run=detectionEngine(relay(async(name,input)=>{requests.push({name,input});return answering(identity)();}));
  const result=await run('health','person-1');
  assert.equal(result.engineBuild,identity.buildHash);assert.equal(result.backend,'opensearch');assert.equal(result.health,'green');
  assert.equal(requests.length,1);assert.equal(requests[0].name,'engine.exchange');assert.equal(requests[0].input.timeoutMs,55000);
  assert.equal(requests[0].input.request.cmd,'health');assert.match(requests[0].input.request.args.scope,/^[a-f0-9]{64}$/);
  await assert.rejects(run('health',''),error=>error.status===401);
  assert.equal(requests.length,1,'the relay is not used for an unverified caller');
});

test('the mounted router answers a down engine over HTTP with status 503, the reason and installHint',async()=>{
  const {loadExperience}=require('./fixtures/intake.cjs');
  const express=dependency('express'),app=express();
  app.use((req,_res,next)=>{req.oidc={user:{sub:'person-1'}};next();});
  const ctx={authorization:{registerResource(){}},store:{query:async()=>[]},pool:{query:async()=>({rows:[]})},appPackageDir:root,intent:failing('engine container is not reachable or broke its line protocol')};
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes(ctx));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/intelligent-operations/pipeline/health`,{headers:{Accept:'application/json'}});
    assert.equal(response.status,503);
    const body=await response.json();
    assert.equal(body.installHint,INSTALL_HINT);assert.ok(body.error.includes(INSTALL_HINT),'the error text the surface renders carries the command');assert.match(body.error,/not reachable/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
