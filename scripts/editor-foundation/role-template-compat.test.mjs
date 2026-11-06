/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve every unrelated workspace member while replacing retired Office selectors with the same admin tier; optionally prove previews against an isolated actual native kernel without applying authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {resolve, join} from 'node:path';
const require=createRequire(new URL('../toolchain/package.json',import.meta.url));
const yaml=require('js-yaml'), root=resolve(import.meta.dirname,'../..');
const baseline=JSON.parse(await readFile(new URL('./fixtures/office-template-roles.before.json',import.meta.url),'utf8'));
const reorderedWorkspaces=new Set(['commons-experience','orbit-experience','studio-experience','jarvis-experience']);
const load=async name=>yaml.load(await readFile(join(root,name,'oshal-app.yaml'),'utf8'));
const office=await load('presentations');
const catalog=yaml.load(await readFile(join(root,'presentations',office.authorization.catalog),'utf8'));

test('18 Office template selectors preserve admin tier and every other member and template field',async()=>{
  let members=0;
  for(const [name,saved]of Object.entries(baseline.packages)){
    const current=await load(name);
    for(const entry of saved.templates){
      const actual=entry.path.reduce((value,key)=>value[key],current), expected=structuredClone(entry.before);
      expected.version++;
      if(reorderedWorkspaces.has(name)){
        expected.version++;
        for(const [app,role]of [['portrait-studio','mailer'],['video','producer']]){
          const item=expected.members.find(member=>member.app===app&&member.role===role);
          expected.members.splice(expected.members.indexOf(item),1);
          const last=expected.members.findLastIndex(member=>member.app===app);
          expected.members.splice(last+1,0,item);
        }
      }
      for(const member of expected.members)if(member.app==='presentations'){
        assert.equal(member.role,'@app-admin');member.role='admin';members++;
      }
      assert.deepEqual(actual,expected,name+': Office selector and reviewed effective-role ordering preserve every member');
    }
    const parts=saved.version.split('.');parts[2]=String(Number(parts[2])+(reorderedWorkspaces.has(name)?2:1));
    const numbers=current.version.split('.').map(Number), floor=parts.map(Number);
    assert.equal(numbers.length,3);assert.ok(numbers.every(Number.isInteger));
    const changed=numbers.findIndex((value,index)=>value!==floor[index]);
    assert.ok(changed<0||numbers[changed]>floor[changed],name+': release version must include the compatibility change');
    const audit=JSON.parse(await readFile(join(root,'audits',name+'.json'),'utf8'));
    assert.equal(audit.version,current.version);
  }
  assert.equal(members,18);assert.equal(Object.keys(baseline.packages).length,9);
});

test('declared Office admin retains the reserved legacy admin tier and all own document/legacy permissions',()=>{
  assert.equal(catalog.roles.admin.tier,'admin');
  assert.deepEqual(catalog.roles.admin.grants.map(x=>x.permission).sort(),Object.keys(catalog.permissions).sort());
  assert.ok(catalog.roles.admin.grants.every(x=>x.scope==='own'));
  assert.ok(catalog.roles.admin.grants.some(x=>x.permission==='legacy.access'));
  assert.equal(catalog.roles['@app-admin'],undefined,'no runtime alias or extra reserved role');
});

test('no shipped template retains the now-invalid presentations @app-admin selector',async()=>{
  const invalid=[];
  const walk=(value,path)=>{
    if(!value||typeof value!=='object')return;
    if(value.app==='presentations'&&value.role==='@app-admin')invalid.push(path);
    for(const[key,child]of Object.entries(value))walk(child,path+'.'+key);
  };
  for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isDirectory()){
    let value;try{value=await load(entry.name);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    walk(value,entry.name);
  }
  assert.deepEqual(invalid,[]);
});

const receiptPath=process.env.OSHAL_EDITOR_ROLE_HOST_RECEIPT;
test('actual isolated native previews accept declared admin, reject retired selector, and never apply a grant',{skip:!receiptPath&&'Set OSHAL_EDITOR_ROLE_HOST_RECEIPT and OSHAL_EDITOR_ROLE_ENV for genuine native preview proof.'},async()=>{
  const pins=JSON.parse(await readFile(receiptPath,'utf8')), url=new URL(pins.baseUrl);
  assert.equal(pins.kind,'isolated-native-editor-live-host/1');assert.equal(pins.isolated,true);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.ok(!['38788','38789','38820','38821'].includes(url.port));
  const text=await readFile(process.env.OSHAL_EDITOR_ROLE_ENV,'utf8'), line=text.split('\n').find(x=>x.startsWith('OSHAL_ADMIN_TOKEN='));
  assert.ok(line);const admin=line.slice(line.indexOf('=')+1).replace(/^(['"])(.*)\1$/,'$2');
  const request=async(token,method,path,body)=>{
    const response=await fetch(new URL(path,url),{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,value:await response.json()};
  };
  const subject='editor-template-preview-'+randomUUID(), invitation=await request(admin,'POST','/people/invitations',{invitee:subject,tier:'editor',lifetime_ms:600000});
  assert.equal(invitation.status,200);const accepted=await request('','POST','/people/invitations/'+encodeURIComponent(invitation.value.token)+'/accept',{subject});assert.equal(accepted.status,200);const id=accepted.value.principal;assert.ok(id);
  try{
    const before=await request(admin,'GET','/api/authorization/composites');assert.equal(before.status,200);
    const input={target:id,assignment_id:subject,action:'assign',expected_revision:before.value.revision,reason:'isolated Office selector compatibility preview only',idempotency_key:randomUUID(),selection:{kind:'granular',app:'presentations',role:'admin'}};
    const valid=await request(admin,'POST','/api/authorization/composites/preview',input);assert.equal(valid.status,200,JSON.stringify(valid.value));assert.ok(valid.value.plan_revision);
    const invalid=await request(admin,'POST','/api/authorization/composites/preview',{...input,selection:{...input.selection,role:'@app-admin'}});assert.notEqual(invalid.status,200);
    const after=await request(admin,'GET','/api/authorization/composites');assert.equal(after.status,200);assert.deepEqual(after.value.assignments,before.value.assignments,'preview never reapproves or applies authority');
  }finally{
    const confirmation=await request(admin,'POST','/confirmations',{});assert.equal(confirmation.status,200);
    const response=await fetch(new URL('/people/'+id+'/deactivate',url),{method:'POST',headers:{authorization:'Bearer '+admin,'content-type':'application/json','x-oshal-confirm':confirmation.value.confirmation},body:'{}'});assert.equal(response.status,200);
  }
});
