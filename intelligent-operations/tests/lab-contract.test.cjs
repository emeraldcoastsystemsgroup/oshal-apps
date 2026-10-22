/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Validate rendered lab scope, image pins, bounded jobs and ownership refusals without touching any cluster. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');const path=require('node:path');
const fs=require('node:fs');const crypto=require('node:crypto');
const lab=path.resolve(__dirname,'../lab');
test('rendered lab has pinned images, explicit namespaces, no ingress and bounded workloads',()=>{
  const objects=JSON.parse(execFileSync('python3',[path.join(lab,'lab.py'),'render'],{encoding:'utf8'})).items;
  assert.deepEqual(objects.filter(o=>o.kind==='Namespace').map(o=>o.metadata.name),['operations-demo','operations-monitoring']);
  assert.equal(objects.some(o=>o.kind==='Ingress'),false);
  for(const o of objects){
    if(o.metadata.namespace)assert.ok(['operations-demo','operations-monitoring'].includes(o.metadata.namespace));
    for(const c of o.spec?.template?.spec?.containers||[]){assert.match(c.image,/@sha256:[a-f0-9]{64}$/);assert.ok(c.resources.limits.cpu);assert.ok(c.resources.limits.memory);}
    if(o.kind==='Service')assert.equal(o.spec.type,undefined);
  }
});
test('a foreign API or changed cluster incarnation is refused before any mutation; excessive load creates nothing',()=>{
  const code=String.raw`import importlib.util,json,tempfile
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('lab',${JSON.stringify(path.join(lab,'lab.py'))})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
 m.STATE=Path(tmp)
 (m.STATE/'ownership.json').write_text(json.dumps({'cluster':m.CLUSTER,'kubeSystemUid':'original','nodes':['a','b','c']}))
 with patch.object(m,'local_docker'),patch.object(m,'kubectl',return_value='https://production.example:6443'):
  try:m.guard();raise AssertionError('foreign API admitted')
  except RuntimeError:pass
 with patch.object(m,'local_docker'),patch.object(m,'kubectl',side_effect=['https://127.0.0.1:12345','replacement']):
  try:m.guard();raise AssertionError('replacement admitted')
  except RuntimeError:pass
 with patch.object(m,'guard'),patch.object(m,'kubectl') as calls:
  for args in [(2001,10),(100,21),(2000,1)]:
   try:m.load(*args);raise AssertionError('unbounded job admitted')
   except ValueError:pass
  assert calls.call_count==0
 with patch.dict(m.os.environ,{'DOCKER_HOST':'ssh://remote.example'},clear=False):
  try:m.local_docker();raise AssertionError('remote Docker admitted')
  except RuntimeError:pass
 with patch.dict(m.os.environ,{'DOCKER_CONTEXT':'remote','DOCKER_HOST':'unix:///var/run/docker.sock'},clear=False),patch.object(m,'run',return_value='ssh://remote.example'):
  try:m.local_docker();raise AssertionError('remote context override admitted')
  except RuntimeError:pass
print('scope and bounds verified')`;
  assert.match(execFileSync('python3',['-c',code],{encoding:'utf8'}),/scope and bounds verified/);
});
test('exported observations have valid hashes and pair actual local firing/resolved alert occurrences',()=>{
  const samples=path.join(lab,'samples'),receipt=JSON.parse(fs.readFileSync(path.join(samples,'acceptance.json'),'utf8'));
  assert.equal(receipt.environment,'operations-lab');assert.equal(receipt.synthetic,true);assert.equal(receipt.status,'passed');
  for(const [name,digest] of Object.entries(receipt.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(samples,name))).digest('hex'),digest,name);
  const firing=JSON.parse(fs.readFileSync(path.join(samples,'alertmanager-firing.json'),'utf8'));
  const resolved=JSON.parse(fs.readFileSync(path.join(samples,'alertmanager-resolved.json'),'utf8'));
  assert.equal(firing.status,'firing');assert.equal(resolved.status,'resolved');
  const keys=new Set(firing.alerts.map(a=>JSON.stringify([a.fingerprint,a.startsAt])));
  assert.ok(resolved.alerts.some(a=>keys.has(JSON.stringify([a.fingerprint,a.startsAt]))));
  for(const a of [...firing.alerts,...resolved.alerts])assert.equal(a.labels.environment,'operations-lab');
  const inventory=JSON.parse(fs.readFileSync(path.join(samples,'inventory-at-failure.json'),'utf8'));
  assert.equal(inventory.synthetic,true);assert.ok(inventory.pods.length>=2);
  for(const pod of inventory.pods){assert.ok(pod.uid);assert.match(pod.node,/^operations-lab-/);assert.equal(pod.namespace,'operations-demo');}
});

test('experience deployment preserves native sandboxing, durable records and loopback-only access',()=>{
  const deploy=path.resolve(lab,'../deploy/kubernetes.py');
  const objects=JSON.parse(execFileSync('python3',[deploy,'render'],{encoding:'utf8'})).items;
  const kernel=objects.find(o=>o.kind==='Deployment'&&o.metadata.name==='operations-kernel');
  assert.equal(kernel.spec.strategy.type,'Recreate');assert.equal(kernel.spec.replicas,1);
  const pod=kernel.spec.template.spec,c=pod.containers[0];
  assert.equal(pod.hostUsers,false);assert.equal(pod.automountServiceAccountToken,false);
  assert.equal(c.securityContext.seccompProfile.type,'Localhost');assert.equal(c.securityContext.appArmorProfile.localhostProfile,'oshal-bwrap');assert.equal(c.securityContext.allowPrivilegeEscalation,false);
  assert.equal(pod.volumes.find(v=>v.name==='state').persistentVolumeClaim.claimName,'operations-state');
  assert.equal(objects.filter(o=>o.kind==='PersistentVolumeClaim').length,2);
  assert.ok(objects.filter(o=>o.kind==='Service').every(o=>o.spec.type==='ClusterIP'));
  assert.ok(!objects.some(o=>o.kind==='Secret'||o.kind==='Ingress'));
  const config=objects.find(o=>o.kind==='ConfigMap').data;assert.equal(config.OSHAL_MOCK_IDENTITY,'false');assert.equal(config.OSHAL_FLEET_PROVIDER,'noop');
});

test('Kubernetes capture preserves unknown and missing readiness rather than inventing failure',()=>{
  const deploy=path.resolve(lab,'../deploy/kubernetes.py');
  const code=String.raw`import importlib.util,json,io,contextlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('deployment',${JSON.stringify(deploy)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
pods=[{'metadata':{'uid':str(i),'name':'pod-'+str(i),'namespace':'operations-demo'},'spec':{'containers':[{'name':'api','image':'example:fixture'}]},'status':{'conditions':[] if value is None else [{'type':'Ready','status':value}]}} for i,value in enumerate(['True','False','Unknown',None])]
output=io.StringIO()
with patch.object(m.lab,'guard',return_value={'kubeSystemUid':'test-cluster'}),patch.object(m,'kube',return_value=json.dumps({'items':pods})),contextlib.redirect_stdout(output):m.capture()
result=json.loads(output.getvalue());assert [p['ready'] for p in result['pods']]==[True,False,None,None]
assert all(p['containers'][0]['ready'] is None for p in result['pods'])
print('unknown readiness preserved')`;
  assert.match(execFileSync('python3',['-c',code],{encoding:'utf8'}),/unknown readiness preserved/);
});
