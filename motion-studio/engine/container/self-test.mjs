/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real bridge identity, animated pixels, owned mask/source reopen and embedded-font text before an installer reports success.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require the four implemented exact keyframe adapters in the source registry.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { sourceIdentity } from '../package-identity.mjs';
import { exchange } from './wire.mjs';
import { decodePng, sourcePng } from './png.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function expectedIdentity(){
  const expected=sourceIdentity();
  if(process.argv.includes('--expected-stdin')){
    let parts=[],size=0;for await(const part of process.stdin){size+=part.length;if(size>4096)throw new Error('motion_selftest_identity_limit');parts.push(part);}
    assert.deepEqual(JSON.parse(Buffer.concat(parts).toString('utf8')),expected,'installed package differs from this image');
  }
  return expected;
}
export async function selfTest(expected, address={}){
  const call=request=>exchange(request,expected,address);
  const comp=document=>Object.values(document.items).find(item=>item.kind.type==='Comp');
  const blank=await call({op:'create'});
  const catalog=await call({op:'catalog'});assert.equal(catalog.commands.length,433);for(const id of ['keys.inspectExact','keys.selectExact','keys.addExact','keys.patchExact']){const entry=catalog.commands.find(command=>command.id===id);assert.equal(entry?.adapter,'oshal-native-keyframe');assert.deepEqual(entry.schema.required,['layer','prop','timeTicks']);}for(const id of ['text.inspectAt','text.patchAt']){const entry=catalog.commands.find(command=>command.id===id);assert.equal(entry?.adapter,'oshal-native-text');assert.ok(entry.schema.required.includes('compTimeTicks'));}for(const id of ['mask.inspectAt','mask.patchAt']){const entry=catalog.commands.find(command=>command.id===id);assert.equal(entry?.adapter,'oshal-native-mask');assert.ok(entry.schema.required.includes('compTimeTicks'));}assert.ok(catalog.commands.find(c=>c.id==='mask.patchAt').schema.properties.operations.items.properties.command.enum.includes('mask.featherPoint.set'));for(const id of ['properties.inspectAt','properties.patchAt'])assert.ok(catalog.commands.some(c=>c.id===id));assert.equal(catalog.ticksPerSecond,254016000000);
  let result=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Real self-test',width:320,height:180,frameRate:30,duration:5}},{command:'layer.newSolid',params:{name:'Animated red',color:'#ff0000',width:100,height:60}}]});
  const composition=comp(result.document),layer=composition.kind.layers[0].id;
  result=await call({op:'edit',document:result.document,comp:composition.id,commands:[{command:'prop.addKey',params:{layer,path:'transform/opacity',time:0,value:0}},{command:'prop.addKey',params:{layer,path:'transform/opacity',time:5,value:100}}]});
  const preview=async(document,extra={})=>Buffer.from((await call({op:'preview',document,time:2.5,transparent:true,...extra})).png,'base64');
  const midpoint=await preview(result.document),decoded=decodePng(midpoint);assert.equal(decoded.width,320);assert.equal(decoded.height,180);
  assert.equal(decoded.pixels[(90*320+160)*4+3],128);assert.equal(decoded.pixels[3],0);
  assert.equal(hash(await preview((await call({op:'inspect',document:result.document})).document)),hash(midpoint));
  const asset=sourcePng(),owned={id:randomUUID(),sha256:hash(asset),data:asset.toString('base64')};
  let photo=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Owned photo',width:32,height:16,frameRate:30,duration:5}},{command:'asset.import',params:{assetId:owned.id}}],assets:[owned]});
  const photoComp=comp(photo.document),photoLayer=photoComp.kind.layers[0].id;
  photo=await call({op:'edit',document:photo.document,comp:photoComp.id,commands:[{command:'layer.addMask',params:{layer:photoLayer,shape:'rect',rect:[0,0,8,8]}}],assets:[owned]});
  const masked=await preview(photo.document,{assets:[owned]}),pixels=decodePng(masked).pixels;
  const nonzero=Array.from({length:pixels.length/4},(_,n)=>pixels[n*4+3]).filter(alpha=>alpha>0);assert.equal(nonzero.length,64);assert.ok(nonzero.every(alpha=>alpha===128));
  assert.equal(hash(await preview((await call({op:'inspect',document:photo.document,assets:[owned]})).document,{assets:[owned]})),hash(masked));
  const text=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Embedded font',width:320,height:180,frameRate:30,duration:5}},{command:'layer.newText',params:{name:'Text',text:'Motion',size:36,position:[160,90]}}]});
  const textPixels=decodePng(await preview(text.document)).pixels;assert.ok(Array.from({length:textPixels.length/4},(_,n)=>textPixels[n*4+3]).filter(alpha=>alpha>0).length>100,'embedded font must actually render');
  const scene=await call({op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:'Exact properties',width:160,height:90,frameRate:30,duration:5}},{command:'layer.newSolid',params:{name:'Plane',width:40,height:20}},{command:'layer.setSwitch',params:{layers:['Plane'],switch:'threeD',value:true}},{command:'prop.set',params:{layer:'Plane',path:'transform/scale',value:[80,120,150]}}]});
  const sceneComp=comp(scene.document),sceneLayer=sceneComp.kind.layers[0],observation=(await call({op:'edit',document:scene.document,comp:sceneComp.id,commands:[{command:'properties.inspectAt',params:{layer:String(sceneLayer.id),compTimeTicks:'1'}}]})).results[0];
  const opacity=observation.properties.find(p=>p.path==='transform/opacity'),patched=await call({op:'edit',document:scene.document,comp:sceneComp.id,commands:[{command:'properties.patchAt',params:{layer:String(sceneLayer.id),compTimeTicks:'1',changes:[{prop:opacity.prop,value:25}]}}]});
  const seen=(await call({op:'edit',document:patched.document,comp:sceneComp.id,commands:[{command:'properties.inspectAt',params:{layer:String(sceneLayer.id),compTimeTicks:'1'}}]})).results[0];assert.deepEqual(seen.properties.find(p=>p.path==='transform/scale').value,[80,120,150]);assert.equal(seen.properties.find(p=>p.path==='transform/opacity').value,25);
  let effectScene=await call({op:'edit',document:scene.document,comp:sceneComp.id,commands:[{command:'layer.select',params:{layers:[sceneLayer.id]}},{command:'effect.apply',params:{effect:'ec.blur.gaussian'}}]});
  const effectGroup=comp(effectScene.document).kind.layers[0].props.children.find(g=>g.match==='effects').children[0],radius=effectGroup.children.find(p=>p.match==='blurriness');
  effectScene=await call({op:'edit',document:effectScene.document,comp:sceneComp.id,commands:[{command:'prop.addKey',params:{layer:sceneLayer.id,prop:radius.uid,time:0,value:0}},{command:'prop.addKey',params:{layer:sceneLayer.id,prop:radius.uid,time:2,value:12}}]});
  const effectRef={layer:String(sceneLayer.id),effect:String(effectGroup.uid),compTimeTicks:'254016000000'},effectValues=(await call({op:'edit',document:effectScene.document,comp:sceneComp.id,commands:[{command:'properties.inspectAt',params:effectRef}]})).results[0];assert.equal(effectValues.properties.find(p=>p.path==='blurriness').value,6);
  effectScene=await call({op:'edit',document:effectScene.document,comp:sceneComp.id,commands:[{command:'properties.patchAt',params:{...effectRef,changes:[{prop:String(radius.uid),value:10}]}}]});
  const effectKeys=comp(effectScene.document).kind.layers[0].props.children.find(g=>g.match==='effects').children[0].children.find(p=>p.match==='blurriness').keys;assert.deepEqual(effectKeys.map(k=>k.time),[0,254016000000,508032000000]);assert.deepEqual(effectKeys.map(k=>k.value.v),[0,10,12]);
  let stringScene=await call({op:'edit',document:scene.document,comp:sceneComp.id,commands:[{command:'layer.select',params:{layers:[sceneLayer.id]}},{command:'effect.apply',params:{effect:'ec.utility.applylut'}}]});
  const lutGroup=comp(stringScene.document).kind.layers[0].props.children.find(g=>g.match==='effects').children[0],lut=lutGroup.children.find(p=>p.match==='lut');
  stringScene=await call({op:'edit',document:stringScene.document,comp:sceneComp.id,commands:[{command:'properties.patchAt',params:{layer:String(sceneLayer.id),effect:String(lutGroup.uid),compTimeTicks:'1',changes:[{prop:String(lut.uid),value:'#😀\nLUT_1D_SIZE 2\n0 0 0\n0 0 0\n'}]}}]});
  stringScene=await call({op:'edit',document:stringScene.document,comp:sceneComp.id,commands:[{command:'properties.patchAt',params:{layer:String(sceneLayer.id),effect:String(lutGroup.uid),compTimeTicks:'1',changes:[{prop:String(lut.uid),textPatch:{start:1,end:3,text:'😁'}}]}}]});
  assert.ok(comp(stringScene.document).kind.layers[0].props.children.find(g=>g.match==='effects').children[0].children.find(p=>p.match==='lut').value.v.startsWith('#😁\n'));
  return {ok:true,identity:expected,commandCount:catalog.commands.length,midpointAlpha:128,maskedPixels:64,midpointSha256:hash(midpoint),maskedSha256:hash(masked),textRendered:true};
}
if(process.argv[1]?.endsWith('/self-test.mjs')){
  try{console.log(JSON.stringify(await selfTest(await expectedIdentity())));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
