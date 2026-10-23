/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Provisioning through Git: a team namespace (Namespace, ResourceQuota, LimitRange, default-deny NetworkPolicy, editors RoleBinding) or an app deployment (hardened Deployment and Service) rendered by the server from strictly validated parameters into exact manifests with digests; nothing is applied by the application. The request is promoted through the existing Git rail (branch, pull/merge request, the person's pipeline applies it). */
// @ts-nocheck
import {createHash} from 'node:crypto';
import {hash} from './intake';
import {processingTransaction} from './pipeline';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const requireOwner=owner=>{if(typeof owner!=='string'||!owner.trim())fail(401,'A verified caller is required.');};
const sha=b=>createHash('sha256').update(b).digest('hex');
const closed=(input,fields,message)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))fail(400,message);};
const DNS=/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/,QTY=/^[0-9]{1,6}(\.[0-9]{1,3})?(m|Ki|Mi|Gi|Ti)?$/,GROUP=/^[A-Za-z0-9:@._-]{1,128}$/,PATH=/^\/[A-Za-z0-9._~\/-]{0,127}$/;
const IMAGE=/^[a-z0-9]([a-z0-9.-]{0,252})(:[0-9]{1,5})?(\/[a-z0-9]([a-z0-9._-]{0,127}))+(:[A-Za-z0-9._-]{1,128}|@sha256:[a-f0-9]{64})$/;
const need=(ok,message)=>{if(!ok)fail(400,message);};
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const qty=(v,label)=>{need(typeof v==='string'&&QTY.test(v),label+' is a Kubernetes quantity such as 500m, 2 or 4Gi.');return v;};
const header=(template,name)=>'# Rendered by TriageNorth provisioning ('+template+') for '+name+'. Review it in the pull request; your pipeline applies it.\n';
export const TEMPLATES={
 'team-namespace':{
  label:'Team namespace with quota, defaults, isolation and editors',
  fields:['name','team','editorsGroup','cpuRequests','memoryRequests','cpuLimits','memoryLimits','pods','defaultCpuRequest','defaultMemoryRequest','defaultCpuLimit','defaultMemoryLimit'],
  validate(p){need(typeof p.name==='string'&&DNS.test(p.name),'name is a DNS label (lower case, digits, dashes, at most 63).');need(typeof p.team==='string'&&DNS.test(p.team),'team is a DNS label.');need(typeof p.editorsGroup==='string'&&GROUP.test(p.editorsGroup),'editorsGroup is the group your identity provider sends (letters, digits, : @ . _ -).');
   for(const k of ['cpuRequests','memoryRequests','cpuLimits','memoryLimits','defaultCpuRequest','defaultMemoryRequest','defaultCpuLimit','defaultMemoryLimit'])qty(p[k],k);need(int(p.pods,1,1000),'pods is 1 to 1000.');return p;},
  render(p){const h=header('team-namespace',p.name);return {
   'namespace.yaml':h+`apiVersion: v1\nkind: Namespace\nmetadata:\n  name: "${p.name}"\n  labels:\n    team: "${p.team}"\n    app.kubernetes.io/managed-by: "triagenorth"\n    pod-security.kubernetes.io/enforce: "baseline"\n    pod-security.kubernetes.io/warn: "restricted"\n`,
   'resourcequota.yaml':h+`apiVersion: v1\nkind: ResourceQuota\nmetadata:\n  name: "${p.name}-quota"\n  namespace: "${p.name}"\nspec:\n  hard:\n    requests.cpu: "${p.cpuRequests}"\n    requests.memory: "${p.memoryRequests}"\n    limits.cpu: "${p.cpuLimits}"\n    limits.memory: "${p.memoryLimits}"\n    pods: "${p.pods}"\n`,
   'limitrange.yaml':h+`apiVersion: v1\nkind: LimitRange\nmetadata:\n  name: "${p.name}-defaults"\n  namespace: "${p.name}"\nspec:\n  limits:\n    - type: Container\n      defaultRequest:\n        cpu: "${p.defaultCpuRequest}"\n        memory: "${p.defaultMemoryRequest}"\n      default:\n        cpu: "${p.defaultCpuLimit}"\n        memory: "${p.defaultMemoryLimit}"\n`,
   'networkpolicy.yaml':h+`apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: "${p.name}-default-deny-ingress"\n  namespace: "${p.name}"\nspec:\n  podSelector: {}\n  policyTypes: ["Ingress"]\n  ingress:\n    - from:\n        - podSelector: {}\n`,
   'rolebinding.yaml':h+`apiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata:\n  name: "${p.name}-editors"\n  namespace: "${p.name}"\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: ClusterRole\n  name: edit\nsubjects:\n  - apiGroup: rbac.authorization.k8s.io\n    kind: Group\n    name: "${p.editorsGroup}"\n`};}},
 'app-deployment':{
  label:'App deployment with a hardened Deployment and a Service',
  fields:['namespace','name','image','replicas','port','cpuRequest','memoryRequest','cpuLimit','memoryLimit','healthPath'],
  validate(p){need(typeof p.namespace==='string'&&DNS.test(p.namespace),'namespace is a DNS label.');need(typeof p.name==='string'&&DNS.test(p.name),'name is a DNS label.');need(typeof p.image==='string'&&IMAGE.test(p.image)&&!/:latest$/.test(p.image),'image is registry/repository:tag or @sha256:digest, never :latest.');
   need(int(p.replicas,1,20),'replicas is 1 to 20.');need(int(p.port,1,65535),'port is 1 to 65535.');for(const k of ['cpuRequest','memoryRequest','cpuLimit','memoryLimit'])qty(p[k],k);need(typeof p.healthPath==='string'&&PATH.test(p.healthPath),'healthPath is an absolute URL path.');return p;},
  render(p){const h=header('app-deployment',p.namespace+'/'+p.name);return {
   'deployment.yaml':h+`apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: "${p.name}"\n  namespace: "${p.namespace}"\n  labels:\n    app.kubernetes.io/name: "${p.name}"\n    app.kubernetes.io/managed-by: "triagenorth"\nspec:\n  replicas: ${p.replicas}\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: "${p.name}"\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: "${p.name}"\n    spec:\n      automountServiceAccountToken: false\n      securityContext:\n        runAsNonRoot: true\n        seccompProfile:\n          type: RuntimeDefault\n      containers:\n        - name: "${p.name}"\n          image: "${p.image}"\n          ports:\n            - containerPort: ${p.port}\n          resources:\n            requests:\n              cpu: "${p.cpuRequest}"\n              memory: "${p.memoryRequest}"\n            limits:\n              cpu: "${p.cpuLimit}"\n              memory: "${p.memoryLimit}"\n          readinessProbe:\n            httpGet:\n              path: "${p.healthPath}"\n              port: ${p.port}\n          livenessProbe:\n            httpGet:\n              path: "${p.healthPath}"\n              port: ${p.port}\n            initialDelaySeconds: 10\n          securityContext:\n            allowPrivilegeEscalation: false\n            readOnlyRootFilesystem: true\n            capabilities:\n              drop: ["ALL"]\n`,
   'service.yaml':h+`apiVersion: v1\nkind: Service\nmetadata:\n  name: "${p.name}"\n  namespace: "${p.namespace}"\nspec:\n  selector:\n    app.kubernetes.io/name: "${p.name}"\n  ports:\n    - port: ${p.port}\n      targetPort: ${p.port}\n`};}}
};
/** @description Validate and render one provisioning request; the same template and parameters render the same bytes. */
export function renderProvisioning(input){
 closed(input,['template','params','reason'],'Supply only template, params and reason.');const t=TEMPLATES[input.template];need(t,'Choose a supported provisioning template.');
 closed(input.params,t.fields,'Supply exactly the '+input.template+' parameters.');need(t.fields.every(f=>input.params[f]!==undefined),'Every '+input.template+' parameter is required.');
 need(typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.reason),'Say in up to 1000 characters why this is provisioned.');
 const params=t.validate({...input.params}),files=Object.entries(t.render(params)).map(([name,content])=>({name,content,sha256:sha(content),bytes:Buffer.byteLength(content)}));
 return {template:input.template,params,reason:input.reason.trim(),files};
}
/** @description Keep one request per template and parameters (at most 64 per person). */
export async function saveProvisioning(pool,owner,input){
 requireOwner(owner);const rendered=renderProvisioning(input),id=hash(['provisioning-v1',{template:rendered.template,params:rendered.params}]);
 return processingTransaction(pool,async c=>{
  const previous=(await c.query('SELECT record FROM operations_provisioning WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0]?.record;if(previous)return {...previous,retry:true};
  const count=(await c.query('SELECT count(*)::int AS n FROM operations_provisioning WHERE user_sub=$1',[owner])).rows[0].n;if(count>=64)fail(409,'This workbench holds at most 64 provisioning requests.');
  const record={id,...rendered,createdAt:new Date().toISOString(),executionAuthorized:false,appliedBy:'your Git pipeline after review'};
  await c.query('INSERT INTO operations_provisioning(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)',[owner,id,record.createdAt,JSON.stringify(record)]);return record;
 });
}
/** @description The owned request with its stored files, digests rechecked. */
export async function provisioningRequest(c,owner,id){
 if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail(400,'Choose a saved provisioning request.');
 const record=(await c.query('SELECT record FROM operations_provisioning WHERE user_sub=$1 AND id=$2',[owner,id])).rows[0]?.record;if(!record)fail(404,'The owned provisioning request is unavailable.');
 for(const f of record.files)if(sha(f.content)!==f.sha256)fail(503,'Stored manifest bytes no longer match their digest.');return record;
}
/** @description Own requests newest first with their Git promotions. */
export async function provisioningRecords(pool,owner,promotions){
 requireOwner(owner);const rows=(await pool.query('SELECT record FROM operations_provisioning WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 21',[owner])).rows.map(r=>r.record);
 return {items:rows.slice(0,20).map(r=>({...r,promotions:promotions.filter(p=>p.planId===r.id)})),truncated:rows.length>20,templates:Object.fromEntries(Object.entries(TEMPLATES).map(([k,t])=>[k,{label:t.label,fields:t.fields}])),executionAuthorized:false};
}
