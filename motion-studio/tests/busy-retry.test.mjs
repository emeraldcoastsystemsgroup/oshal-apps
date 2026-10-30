/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A storage-busy refusal is retried within its budget and then answers; other refusals are not retried; the workbench sends every request through it and the route serves it.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {fetchRetryingBusy} from '../tools/busy-retry.mjs';
const answer=(status,body)=>new Response(JSON.stringify(body),{status});
test('a storage-busy refusal is retried after the server\'s delay until the edit goes through',async()=>{
 const replies=[answer(503,{error:'motion_storage_busy',retryAfterMs:100}),answer(503,{error:'motion_storage_busy',retryAfterMs:100}),answer(200,{project:{revision:5}})];
 const waits=[];let sent=0;
 const {response,text}=await fetchRetryingBusy(async()=>{sent++;return replies.shift();},{sleep:async ms=>{waits.push(ms);}});
 assert.equal(response.status,200);assert.equal(JSON.parse(text).project.revision,5);assert.equal(sent,3);assert.deepEqual(waits,[100,200]);
});
test('other refusals and other 503s are returned at once',async()=>{
 for(const reply of [answer(409,{error:'motion_revision_conflict'}),answer(503,{error:'motion_engine_busy'}),new Response('not json',{status:503})]){
  let sent=0;const {response}=await fetchRetryingBusy(async()=>{sent++;return reply.clone();},{sleep:async()=>{throw new Error('must not wait');}});
  assert.equal(sent,1);assert.equal(response.status,reply.status);
 }
});
test('a lock that stays busy is reported once the wait budget is spent',async()=>{
 let waited=0,sent=0;
 const {response,text}=await fetchRetryingBusy(async()=>{sent++;return answer(503,{error:'motion_storage_busy',retryAfterMs:100});},{maxWaitMs:1500,sleep:async ms=>{waited+=ms;}});
 assert.equal(response.status,503);assert.equal(JSON.parse(text).error,'motion_storage_busy');assert.equal(waited,1500);assert.ok(sent>1);
});
test('the workbench sends its requests through the retry and the route serves the module',()=>{
 const workbench=readFileSync(new URL('../tools/workbench.mjs',import.meta.url),'utf8');
 assert.match(workbench,/import \{fetchRetryingBusy\} from '\.\/busy-retry\.mjs';/);
 assert.match(workbench,/async function api\(path,options=\{\}\)\{const \{response,text\}=await fetchRetryingBusy\(/);
 assert.match(readFileSync(new URL('../routes/application.mjs',import.meta.url),'utf8'),/'busy-retry\.mjs'\]\)router\.get\('\/ui\/'/);
});
