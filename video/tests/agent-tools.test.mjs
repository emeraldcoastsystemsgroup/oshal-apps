/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove declared agent fields, migration, linked edits, timing and no silent locked-track edits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, applyAgentOperations, editingContract } from '../tools/editor/agent-tools.mjs';
import { createTimeline } from '../tools/editor/timeline-model.mjs';
const source={asset:'00000000-0000-4000-8000-000000000001',kind:'video',name:'Owned clip',frames:120,width:1280,height:720,audio:true};
const populated=()=>applyAgentOperations(blankProject({title:'Proof'}),[{type:'addSource',sourceMetadata:source},{type:'addClip',track:'video1',sourceKey:'v1',in:0,out:90,start:0}]);
test('agent explicitly migrates legacy documents and new projects start multitrack',()=>{
 const before=createTimeline('Legacy');const result=applyAgentOperations(before,[{type:'migrate'}]);
 assert.equal(before.version,1);assert.equal(result.version,2);assert.deepEqual(result.tracks.map(t=>t.id),['video1','audio1']);
 assert.equal(blankProject({title:'New'}).version,2);
});
test('agent linked audio trims/splits stay synchronized and input remains immutable',()=>{
 const before=populated(),id=before.tracks[0].clips[0].id;
 const result=applyAgentOperations(before,[{type:'extractAudio',id,track:'audio1'},{type:'clip',id,patch:{start:30}},{type:'split',id,frame:60}]);
 assert.equal(result.tracks[0].clips.length,2);assert.equal(result.tracks[1].clips.length,2);
 assert.equal(result.tracks[0].clips[0].audioEnabled,false);assert.deepEqual(result.tracks[0].clips.map(c=>c.start),[30,60]);
 assert.deepEqual(result.tracks[1].clips.map(c=>c.start),[30,60]);assert.equal(before.tracks[0].clips[0].start,0);
});
test('agent rejects locked tracks, stale shapes, code and partially valid batches atomically',()=>{
 const before=populated(),serial=JSON.stringify(before),id=before.tracks[0].clips[0].id;
 const locked=applyAgentOperations(before,[{type:'track',id:'video1',patch:{locked:true}}]);
 assert.throws(()=>applyAgentOperations(locked,[{type:'clip',id,patch:{volume:80}}]));
 for(const ops of [[{type:'rename',name:'Changed'},{type:'exec',command:'no'}],[{type:'migrate',owner:'bob'}],[{type:'addClip',track:'video1',source:'v1'}],[],Array(17).fill({type:'migrate'})])assert.throws(()=>applyAgentOperations(before,ops));
 assert.equal(JSON.stringify(before),serial);
});
test('agent contract uses the public source fields and explicit frame units',()=>{
 const contract=editingContract();assert.ok(contract.unsupported.includes('PSD'));assert.deepEqual(contract.operations.addClip,['track','sourceKey','start','in','out']);
 assert.equal(contract.operationSchema.additionalProperties,false);assert.match(contract.conventions.timing,/30fps/);assert.match(contract.conventions.sources,/Do not include fps/);
 const result=applyAgentOperations(populated(),[{type:'text',track:'captions',entry:{text:'Caption',start:0,end:60,position:'bottom',size:'small'}}]);assert.equal(result.captions[0].text,'Caption');
});
