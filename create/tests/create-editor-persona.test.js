/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: after an approved new project the follow-up said "You can open it here:
 *   /api/create/editor?project=create": the persona asked for a link carrying the returned project id, which the next turn never
 *   receives. The served persona names the project and points to My projects, and asks for no link, path or id.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: the follow-up said the new project "is currently open in the Image
 *   editor studio" while Create home was docked. The persona says where it opens and never that it is open now.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Tie served natural-edit guidance to the actual recursive group contract/model and approval boundary.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Match the entire current apply-tool contract context to the actual editing contract and native prompt size bound.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const served = fs.readFileSync(path.join(__dirname, '..', 'personas', 'create-editor.yaml'), 'utf8');
/** The served perspective only (the change log above it quotes the old answer). */
const persona = served.slice(served.indexOf('\nperspective:'), served.indexOf('\ncapabilities:'));

test('the editor persona points to My projects and never asks for a link with an id (sweep 12)', () => {
  assert.doesNotMatch(persona, /\/api\/create\/editor\?project=/, 'no link template the model fills with a guessed id');
  assert.match(persona, /say it opens from My projects in the\s+Create editor/);
  assert.match(persona, /Never write a link, a path or a\s+project id/);
  const editor = fs.readFileSync(path.join(__dirname, '..', 'tools', 'create-editor.html'), 'utf8');
  assert.match(editor, />My projects</, 'the place the reply names is on the editor');
});

test('the editor persona never says a new project is open now (sweep 13)', () => {
  const flat = persona.replace(/\s+/g, ' ');
  assert.match(flat, /Never say a project is open now: creating one does not open it/);
  assert.match(flat, /say it opens from My projects in the Create editor or from Recent work on Create home/);
  const home = fs.readFileSync(path.join(__dirname, '..', 'tools', 'create-home.html'), 'utf8');
  assert.match(home, /Recent work/, 'the place the reply names is on Create home');
});

test('served group capability agrees with the real immutable agent model and current editing contract', async () => {
  const {editingContract,applyAgentOperations,operationSchema}=await import('../tools/editor/agent-tools.mjs');
  const {createProject,applyOperation}=await import('../tools/editor/model.mjs');
  assert.match(editingContract().conventions.duplicate,/supports nested groups/);
  assert.ok(operationSchema.properties.type.enum.includes('duplicate'));
  assert.doesNotMatch(persona,/group duplication is refused/i);
  assert.match(persona,/Duplicate supports unlocked\s+nested groups/);
  let original=createProject({name:'Owned group',width:320,height:180});
  for(const [id,x]of [['one',20],['two',80]])original=applyOperation(original,{type:'add',layer:{id,type:'rect',x,y:20,w:40,h:40,fill:'#ff0000'}});
  original=applyOperation(original,{type:'group',id:'original',ids:['one','two']});
  const serialized=JSON.stringify(original),copied=applyAgentOperations(original,[{type:'duplicate',id:'original',newId:'copy'}]);
  assert.equal(JSON.stringify(original),serialized);assert.equal(copied.layers.length,original.layers.length+3);
  for(const layer of original.layers)assert.deepEqual(copied.layers.find(item=>item.id===layer.id),layer);
  const locked=applyOperation(original,{type:'update',id:'one',patch:{locked:true}});
  assert.throws(()=>applyAgentOperations(locked,[{type:'duplicate',id:'original',newId:'copy'}]),/Unlock/);
});

test('natural edit guidance requires a fresh contract/read and an actual held card before any new completion',()=>{
 const flat=persona.replace(/\s+/g,' ');
 assert.match(flat,/Use the complete current editing contract included in the create-apply-edits tool description in each new request/);
 assert.match(flat,/If that full contract is not supplied, read create-editing-contract before constructing any edit/);
 assert.match(flat,/create-read-project for its actual current revision, layer identities, hierarchy and locks/);
 assert.match(flat,/To ask approval for an allowed edit, call create-apply-edits: the kernel holds the exact proposal on an approval card and does not execute it yet/);
 assert.match(flat,/A prose promise or question without a held card is not an edit proposal/);
 assert.match(flat,/A prior "done" status refers to its earlier action, not a new request/);
});


test('current apply-tool context contains the full source editing contract without changing approval or owner inputs',async()=>{
 const {editingContract}=await import('../tools/editor/agent-tools.mjs');
 const manifest=fs.readFileSync(path.join(__dirname,'..','oshal-app.yaml'),'utf8');
 const start=manifest.indexOf('\n  - name: create-apply-edits\n');assert.ok(start>=0);
 const end=manifest.indexOf('\n  - name:',start+1),tool=manifest.slice(start,end<0?undefined:end);
 const block=tool.match(/\n    description: \|-\n([\s\S]*?)\n    executor:/);assert.ok(block,'current native tool description, not ignored usage instructions');
 const embedded=block[1].match(/CURRENT_EDITING_CONTRACT_JSON\n      (\{[^\n]*\})\n      END_CURRENT_EDITING_CONTRACT_JSON/);assert.ok(embedded);
 assert.deepEqual(JSON.parse(embedded[1]),editingContract(),'every current convention, schema, example, limit and unsupported capability reaches the tool context');
 assert.ok(Buffer.byteLength(block[1])<=16*1024,'native ToolContract summary bound');
 assert.match(tool,/defaultAuthMode: ask/);assert.match(tool,/requiresApproval: true/);
 assert.match(tool,/apiEndpoint: POST \/api\/create\/projects\/\{input.id\}\/operations/);
 assert.match(tool,/required:\n        - id\n        - baseRevision\n        - operations/);
 assert.match(block[1],/Hold the exact edit card for approval/);
 assert.match(persona.replace(/\s+/g,' '),/Never replace missing contract information with remembered rules/);
});
