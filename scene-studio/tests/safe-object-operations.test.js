/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pure typed-operation, source-program, permissions and owner/CAS guards; no real engine or provider claim.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process'),Module=require('node:module');
const root=path.resolve(__dirname,'..');
const{objectBody,objectRequest,objectOperation,lowerObjectRequest}=require('../routes/object-operations.js');
const program=fs.readFileSync(path.join(root,'tools/blender-object-operations.py'),'utf8');
const yaml=Module.createRequire(path.resolve(__dirname,'../../scripts/toolchain/package.json'))('js-yaml');
const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8'));
const authorization=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
const operation=value=>JSON.stringify({kind:'set-property',property:'text',value});
test('closed object operations reject caller Python, metadata and invalid values before engine work',()=>{
 const body={expectedRevision:7,objectName:'ExistingText',frame:12,operationJson:operation('Exact 😀 source')};
 assert.equal(objectBody(true,body).expectedRevision,7);
 for(const extra of[{code:'pass'},{editable:true},{type:'FONT'},{save:true},{file:'/tmp/x'},{operationJson:{kind:'set-property'}}])
  assert.throws(()=>objectBody(true,{...body,...extra}));
 for(const op of[{kind:'set-property',property:'text',value:'x',code:'pass'},
  {kind:'set-property',property:'location:3',value:2},{kind:'set-property',property:'visible',value:'true'},
  {kind:'set-property',property:'lightEnergy',value:-1},{kind:'keyframe',channel:'__class__'},
  {kind:'set-property',property:'text',value:'x'.repeat(2000)}]) assert.throws(()=>objectOperation(JSON.stringify(op)));
 for(const value of[-1,0,1.2,1000001]) assert.throws(()=>objectBody(true,{...body,frame:value}));
 assert.throws(()=>objectBody(false,{expectedRevision:7,save:false}));
 assert.throws(()=>objectRequest('object_inspect',{files:[],operationJson:operation('x')}));
});
test('canonical program is frozen with native source and caller strings stay JSON data in the Python AST',()=>{
 assert.equal(createHash('sha256').update(program).digest('hex'),'98b7b3da1a20e0095e3ee6b69f15e700466a0c0e645f8a39081072e8c9286900');
 const objectName='ExistingText\"); __import__("os").system("bad") #\n😀';
 const value='literal \" text\n__import__("os")';
 const out=lowerObjectRequest('object_patch',{files:[],objectName,frame:12,operationJson:operation(value)});
 assert.equal(out.op,'mcp_call');assert.equal(out.fields.save,true);
 const inspect=lowerObjectRequest('object_inspect',{files:[],objectName});assert.equal(inspect.fields.save,false);
 const check=spawnSync('python3',['-c',`import ast,json,sys
prefix=ast.parse(sys.stdin.readline()) if False else None
code=sys.stdin.read(); tree=ast.parse(code); call=tree.body[-1].value
assert isinstance(tree.body[-1],ast.Assign) and call.func.id=='_oshal_object_operation'
assert call.args[0].func.attr=='loads'
print(json.dumps(json.loads(call.args[0].args[0].value),ensure_ascii=False))`],{input:out.fields.arguments.code,encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);const payload=JSON.parse(check.stdout);assert.equal(payload.objectName,objectName);assert.equal(payload.operation.value,value);
});
test('public editor and new route-backed tools never acquire arbitrary-run rights',()=>{
 assert.deepEqual(authorization.roles.editor.grants.map(g=>g.permission),['app.open','scene.read','scene.edit','scene.export']);
 assert.ok(authorization.roles.creator.grants.some(g=>g.permission==='scene.run'));
 const binding=id=>authorization.bindings.tools.find(b=>b.id===id).allOf;
 assert.deepEqual(binding('scene-inspect-object'),['scene.read']);assert.deepEqual(binding('scene-edit-object'),['scene.read','scene.edit']);
 assert.deepEqual(binding('blender-run-python'),['scene.edit','scene.run']);
 assert.deepEqual(authorization.bindings.bots[0].allOf,['scene.read']);
 const read=manifest.tools.find(t=>t.name==='scene-inspect-object'),write=manifest.tools.find(t=>t.name==='scene-edit-object');
 assert.equal(read.executor.executorType,'api');assert.equal(write.executor.executorType,'api');
 assert.equal(read.requiresApproval,false);assert.equal(write.requiresApproval,true);assert.equal(write.defaultAuthMode,'ask');
 const example=write.description.match(/operationJson='([^']+)'/)[1];assert.deepEqual(objectOperation(example),{kind:'set-property',property:'text',value:'Updated native text'});
 assert.equal(write.inputSchema.properties.operationJson.type,'string');assert.equal(write.inputSchema.additionalProperties,false);
});
test('typed service preserves owner filtering, mandatory CAS and readonly revisions before dispatch',async()=>{
 const old=Module._load;Module._load=function(name,...args){if(name==='@/shared/logger')return{createChildLogger:()=>({debug(){},info(){},warn(){},error(){}})};return old.call(this,name,...args);};
 let service;try{service=require('../routes/project-service.js');}finally{Module._load=old;}
 const {fakePool,b64}=require('./scene.fixture.cjs'),os=require('node:os');
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'scene-typed-unit-')),calls=[];
 let text='Original';
 const inspection=()=>({objects:[],total:1,frame:1,offset:0,selected:{id:'Text',type:'FONT',text}});
 const deps={pool:fakePool(),dataRoot,engineBuild:'d'.repeat(64),engine:{async request(op,fields){
  calls.push({op,fields});if(op==='new_project')return{files:[{path:'scene.blend',data:b64('original unit fixture')}]};
  assert.ok(['object_inspect','object_patch'].includes(op));assert.equal(fields.objectName,'Text');assert.ok(!('code'in fields));
  if(op==='object_patch')text=JSON.parse(fields.operationJson).value;
  return{text:JSON.stringify(inspection()),isError:false,changed:op==='object_patch',delta:{added:[],modified:['scene.blend'],deleted:[]},files:[{path:'scene.blend',data:b64('updated unit fixture')}]};
 }}};
 try{
  const project=await service.createProject(deps,'owner',{kind:'blender',title:'Typed unit source',template:'default'});
  const body={expectedRevision:1,objectName:'Text',frame:1};
  const before=calls.length;await assert.rejects(service.callObjectTool(deps,'foreign',project.project_id,false,body),/project_not_found/);assert.equal(calls.length,before);
  const read=await service.callObjectTool(deps,'owner',project.project_id,false,body);assert.equal(read.changed,false);assert.equal(read.project.revision,1);assert.equal(read.extra.inspection.selected.text,'Original');
  const write=await service.callObjectTool(deps,'owner',project.project_id,true,{...body,operationJson:operation('Updated')});assert.equal(write.project.revision,2);assert.equal(write.extra.inspection.selected.text,'Updated');
  const after=calls.length;await assert.rejects(service.callObjectTool(deps,'owner',project.project_id,true,{...body,operationJson:operation('Stale')}),/changed/);assert.equal(calls.length,after);
  await assert.rejects(service.callObjectTool(deps,'owner',project.project_id,true,{...body,expectedRevision:2,operationJson:operation('x'),editable:true}));assert.equal(calls.length,after);
 }finally{fs.rmSync(dataRoot,{recursive:true,force:true});}
});
test('trusted program checks native linkage and isolates shared text/light/camera data with synthetic datablocks',()=>{
 const script=`import sys,types,copy\nsys.modules['bpy']=types.SimpleNamespace()\nsource=open(sys.argv[1]).read(); namespace={}\nexec(source,{},namespace)\n_oshal_patch=namespace['_oshal_patch']\nclass Data(types.SimpleNamespace):\n def copy(self):\n  value=copy.copy(self); value.users=1; return value\ndef obj(kind,data): return types.SimpleNamespace(type=kind,data=data,library=None,override_library=None,hide_select=False,rotation_mode='XYZ')\nshared=Data(body='Original',users=2,library=None,override_library=None)\no=obj('FONT',shared)\n_oshal_patch(o,{'kind':'set-property','property':'text','value':'Changed'},1)\nassert shared.body=='Original' and o.data.body=='Changed' and o.data is not shared\no.library='linked.blend'\ntry: _oshal_patch(o,{'kind':'set-property','property':'text','value':'Forbidden'},1); raise AssertionError('linked write accepted')\nexcept ValueError: pass\nfor kind,key,field,start in [('LIGHT','lightEnergy','energy',10),('CAMERA','lens','lens',32)]:\n shared=Data(users=2,library=None,override_library=None,type='PERSP',bl_rna=types.SimpleNamespace(properties={field:types.SimpleNamespace(hard_min=0,hard_max=5000)}))\n setattr(shared,field,start); o=obj(kind,shared)\n _oshal_patch(o,{'kind':'set-property','property':key,'value':64},1)\n assert getattr(shared,field)==start and getattr(o.data,field)==64 and o.data is not shared\n try: _oshal_patch(o,{'kind':'set-property','property':key,'value':999999},1); raise AssertionError('RNA range clamp accepted')\n except ValueError: pass\nprint('native linkage/shared-data guard simulation passed')`;
 const out=spawnSync('python3',['-c',script,path.join(root,'tools/blender-object-operations.py')],{encoding:'utf8'});
 assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/guard simulation passed/);
});
