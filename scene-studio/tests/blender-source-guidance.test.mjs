/** Execute the actual model-visible read/write examples against owned SQL and real Blender. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {startNativeEditorFixture} from './native-editor-fixture.mjs';
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'));
const manifest=deps('js-yaml').load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
const tool=manifest.tools.find(item=>item.name==='blender-run-python');
const readExample=JSON.parse(tool.description.split('Read example: ')[1].split(' Write example: ')[0]);
const writeExample=JSON.parse(tool.description.split('Write example: ')[1].split(' Example identities')[0]);

test('actual Blender description examples read native text before writing and read changed source again',async()=>{
 assert.equal(tool.defaultAuthMode,'auto');assert.equal(tool.requiresApproval,false);
 const fixture=await startNativeEditorFixture({appId:'scene-studio'});let id;
 const call=async(method,path,body,status=200)=>{const response=await fetch(fixture.origin+'/api/scene-studio'+path,{method,headers:{'x-fixture-user':'alice',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
 try{
  id=(await call('POST','/projects',{kind:'blender',template:'default',title:'Executable text contract'},201)).project.projectId;
  await call('POST','/projects/'+id+'/blender/execute_blender_code_for_cli',{save:true,code:'import bpy\nd=bpy.data.curves.new("FixtureData",type="FONT")\nd.body="Seed native text 😀"\nd.size=2.5\no=bpy.data.objects.new("FixtureText",d)\nbpy.context.collection.objects.link(o)\no.location.x=1.25\nresult={"name":o.name}'});
  const body=input=>({save:input.save,code:input.code.replaceAll('ExistingText','FixtureText')});
  const first=await call('POST','/projects/'+id+'/blender/execute_blender_code_for_cli',body(readExample));assert.equal(first.project.revision,2);assert.equal(JSON.parse(first.result.text).text,'Seed native text 😀');
  const saved=await call('POST','/projects/'+id+'/blender/execute_blender_code_for_cli',body(writeExample));assert.equal(saved.project.revision,3);assert.equal(JSON.parse(saved.result.text).text,'Updated native text');
  const fresh=await call('POST','/projects/'+id+'/blender/execute_blender_code_for_cli',body(readExample));assert.equal(fresh.project.revision,3);assert.equal(JSON.parse(fresh.result.text).text,'Updated native text');
  const geometry=await call('POST','/projects/'+id+'/blender/execute_blender_code_for_cli',{save:false,code:'import bpy\no=bpy.data.objects["FixtureText"]\nresult={"size":o.data.size,"x":o.location.x,"objects":sorted(o.name for o in bpy.data.objects)}'});const values=JSON.parse(geometry.result.text);assert.equal(values.size,2.5);assert.equal(values.x,1.25);assert.deepEqual(values.objects,['Camera','Cube','FixtureText','Light']);
 }finally{if(id)await call('DELETE','/projects/'+id,{confirm:true});await fixture.close();}
});
