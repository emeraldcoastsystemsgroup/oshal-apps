/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.2: prove engine/search-disk-guard.py, the check install-engine.sh runs before it may finish, against a real OpenSearch 3.3.2 (the disposable test search) rather than against the compose file: OpenSearch accepts compose.yaml's three free-space watermarks as one valid set and refuses them out of order, reports what it applies in the answer the installer reads (the installer's own SETTINGS path), and the guard passes exactly that; a percentage the cluster applies fails it by name, transient over persistent as OpenSearch resolves them; a create-index block fails it, naming a disk monitor that cannot lift it; node settings are read where include_defaults reports them. On 2026-11-08 the engine's search applied the default 85/90/95 % on a 91 % full disk with 310 GB free and held the block, and every new rule index was refused with HTTP 403. The case writes only the three transient watermark settings and removes them again. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),guard=path.join(root,'engine/search-disk-guard.py'),SEARCH='http://127.0.0.1:35690';
if(process.env.OSHAL_TEST_SEARCH!==SEARCH)throw Error('OSHAL_TEST_SEARCH must explicitly name disposable OpenSearch http://127.0.0.1:35690.');
const yaml=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(root,'../scripts/toolchain'),'package.json'))('js-yaml');
const LEVELS=['low','high','flood_stage'],KEY=level=>'cluster.routing.allocation.disk.watermark.'+level,BLOCK='cluster.blocks.create_index';
const declared=LEVELS.map(level=>String(yaml.load(fs.readFileSync(path.join(root,'engine/container/compose.yaml'),'utf8')).services.search.environment[KEY(level)]));
/** The settings path install-engine.sh asks search for, read from the installer so the two cannot drift. */
const settingsPath=/^SETTINGS='http:\/\/127\.0\.0\.1:9200(\/[^']+)'$/m.exec(fs.readFileSync(path.join(root,'engine/install-engine.sh'),'utf8'))[1];
/** The guard exactly as the installer runs it: the settings answer on stdin, compose.yaml's three values as arguments. */
function judge(answer,values=declared){
  const run=spawnSync('python3',['-I',guard,...values],{input:typeof answer==='string'?answer:JSON.stringify(answer),encoding:'utf8'});
  return {code:run.status,verdict:run.stdout.trim()?JSON.parse(run.stdout):null,stderr:run.stderr};
}
const settings=async()=>{const response=await fetch(SEARCH+settingsPath);assert.equal(response.status,200);return response.json();};
/** Set (or with null remove) the three transient watermarks in one update, the way OpenSearch validates a set. */
async function transient(values){
  const response=await fetch(SEARCH+'/_cluster/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({transient:Object.fromEntries(LEVELS.map((level,i)=>[KEY(level),values?values[i]:null]))})});
  return {status:response.status,body:await response.json()};
}
const removed=async()=>assert.equal((await transient(null)).status,200,'the transient watermarks are removed again');

test('OpenSearch takes compose.yaml\'s free-space watermarks as one valid set, refuses them out of order, and the guard passes what it then reports',async()=>{
  assert.equal(settingsPath,'/_cluster/settings?include_defaults=true&flat_settings=true');
  try{
    const reversed=await transient([...declared].reverse());
    assert.equal(reversed.status,400,'OpenSearch checks the order of a free-space set: '+JSON.stringify(reversed.body));
    assert.match(JSON.stringify(reversed.body),/low disk watermark \[\d+gb\] less than high disk watermark/);
    const set=await transient(declared);assert.equal(set.status,200,JSON.stringify(set.body));assert.equal(set.body.acknowledged,true);
    const answer=await settings();
    assert.deepEqual(LEVELS.map(level=>answer.transient[KEY(level)]),declared,'OpenSearch reports the values it applies');
    assert.equal(answer.defaults[BLOCK],'false','the shared test search never carries the block');
    const {code,verdict}=judge(answer);
    assert.equal(code,0,JSON.stringify(verdict));assert.equal(verdict.status,'passed');
    assert.deepEqual(verdict.watermarks,Object.fromEntries(LEVELS.map((level,i)=>[level,declared[i]])));assert.equal(verdict.createIndexBlock,false);
    assert.equal(judge(answer,['40gb',declared[1],declared[2]]).code,1,'a value other than the declared one is refused');
  }finally{await removed();}
});

test('a percentage the cluster applies over the declared free space fails the guard by name, transient over persistent as OpenSearch resolves them',async()=>{
  // Far above the host's use, so the shared test search blocks nothing while they apply.
  const percent=['99.7%','99.8%','99.9%'];
  try{
    const set=await transient(percent);assert.equal(set.status,200,JSON.stringify(set.body));
    const answer=await settings(),{code,verdict}=judge(answer);
    assert.equal(code,1);assert.equal(verdict.status,'failed');
    assert.deepEqual(verdict.watermarks,Object.fromEntries(LEVELS.map((level,i)=>[level,percent[i]])),'the transient values win, as they do in the cluster');
    for(const [i,level] of LEVELS.entries())assert.ok(verdict.problems.includes(KEY(level)+' is '+percent[i]+', not the '+declared[i]+' free space compose.yaml sets'),JSON.stringify(verdict.problems));
  }finally{await removed();}
});

test('an index-create block fails the guard and a disk monitor that cannot lift it is named; node settings are read where include_defaults puts them',async()=>{
  // The block itself is never put on the shared test search (every other suite creating an index would fail): it is added
  // to the real answer in the shape production's search reported it on 2026-11-09, persistent "cluster.blocks.create_index":"true".
  try{
    assert.equal((await transient(declared)).status,200);
    const answer=await settings(),MONITOR='cluster.routing.allocation.disk.threshold_enabled';
    const blocked={...answer,persistent:{...answer.persistent,[BLOCK]:'true',[MONITOR]:'true'}};
    let {code,verdict}=judge(blocked);
    assert.equal(code,1);assert.equal(verdict.createIndexBlock,true);assert.equal(verdict.diskMonitor,'true');
    assert.deepEqual(verdict.problems,[BLOCK+' is true: search refuses every new index, so each new rule index answers HTTP 403'],'only the block: the watermarks are the declared ones');
    ({code,verdict}=judge({...blocked,persistent:{...blocked.persistent,[MONITOR]:'false'}}));
    assert.equal(code,1);assert.match(verdict.problems.join(' '),/cluster\.routing\.allocation\.disk\.threshold_enabled=false, cluster\.blocks\.create_index\.auto_release=true nothing lifts it/);
    assert.equal(judge({...blocked,transient:{...blocked.transient,[BLOCK]:'false'}}).code,0,'a transient false is what the cluster applies');
    // A search started with the values (the -E settings compose.yaml's environment becomes) reports them under defaults only.
    const started={transient:{},persistent:{},defaults:{...answer.defaults,...Object.fromEntries(LEVELS.map((level,i)=>[KEY(level),declared[i]]))}};
    assert.equal(judge(started).code,0,JSON.stringify(judge(started).verdict));
    assert.equal(judge({...started,defaults:{...started.defaults,[KEY('high')]:'90%'}}).code,1);
  }finally{await removed();}
});

test('a search that does not answer, or a call without the three values, never passes',()=>{
  const empty=judge('');assert.equal(empty.code,1);assert.match(empty.verdict.problems[0],/^search did not answer its settings/);
  assert.equal(judge('[]').code,1);
  assert.equal(spawnSync('python3',['-I',guard,declared[0]],{input:'{}',encoding:'utf8'}).status,2);
});
