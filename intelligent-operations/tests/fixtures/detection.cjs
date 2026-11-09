// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped engine over real TCP and disposable OpenSearch, with native admission verified separately in the installed lab.
// CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The fixture deletes every rule index its engine was asked to publish. Since 1.5.0 the processing tick publishes the four desk default policies for whoever it runs as, and each case's own clean-up deleted only the index the case had published; every full Operations run left about 79 one-shard rule indexes on the shared test search, which reached its 1000-shard limit on 2026-11-09 and failed the Operations step of every store push from the Spark. close() now deletes them once the engine has stopped (an index that never came to exist is fine), and under node --test the file ends by deleting any that are left and fails when the test search refuses a delete.
'use strict';
const {spawn}=require('node:child_process'),net=require('node:net'),{after}=require('node:test'),{root}=require('./intake.cjs');
const {detectionEngine}=require('../../routes/detection-engine.js');
const SEARCH='http://127.0.0.1:35690',HEX=/^[a-f0-9]{64}$/;
/** Every rule index an engine of this test file was asked to publish, named as engine/percolation.py names it (ops-rules-<scope>-<revision>). The test search is shared by every file and every lane. */
const published=new Set();
/** @description Delete rule indexes from the disposable test search. @param names Index names this file's engines were asked to publish. @returns The deletes the search refused or could not answer, each with its reason; a missing index is not one of them. */
async function dropIndexes(names){
 const failed=[];
 for(const name of names){try{const r=await fetch(SEARCH+'/'+name,{method:'DELETE'});if(!r.ok&&r.status!==404)failed.push(name+': HTTP '+r.status);}catch(error){failed.push(name+': '+error.message);}}
 return failed;
}
// Under node --test (never in a script such as lab/evaluate_recorded.cjs, where a hook would start a test harness) the file
// ends by deleting whatever is left, a publish still in flight when its engine closed for instance, and fails when it cannot.
if(process.env.NODE_TEST_CONTEXT)after(async()=>{const failed=await dropIndexes([...published]);if(failed.length)throw Error('The detection fixture could not delete '+failed.length+' rule index(es) from the test search: '+failed.slice(0,5).join('; '));});
async function engineFixture(){
 const url=process.env.OSHAL_TEST_SEARCH;if(url!==SEARCH)throw Error('OSHAL_TEST_SEARCH must explicitly name disposable OpenSearch http://127.0.0.1:35690.');
 const child=spawn('python3',['server.py'],{cwd:root+'/engine',env:{...process.env,OPERATIONS_SEARCH_URL:url,OPERATIONS_ENGINE_PORT:'0'},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 const port=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>{child.kill();reject(Error('Engine did not start: '+stderr));},10000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Engine exited '+code+': '+stderr));});child.stdout.on('data',bytes=>{buffer+=bytes;if(buffer.includes('\n')){clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).listening);}});});
 const own=new Set();
 // Recorded before the request leaves: an index the engine creates and then fails to answer for is still this fixture's to delete.
 const record=request=>{const args=request?.args||{};if(request?.cmd==='publish'&&HEX.test(String(args.scope))&&HEX.test(String(args.revision))){const index='ops-rules-'+args.scope+'-'+args.revision;own.add(index);published.add(index);}};
 const intent=async(name,input)=>{if(name!=='engine.exchange')throw Error('Unexpected intent');record(input.request);return new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port});let buffer='',hello;
  socket.setTimeout(55000,()=>{socket.destroy();reject(Error('Engine deadline'));});socket.on('error',reject);
  socket.on('data',bytes=>{buffer+=bytes.toString();let end;while((end=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(!hello){hello=row;socket.write(JSON.stringify({...input.request,id:1})+'\n');}else{socket.end();resolve({hello,reply:row});}}});
 });};
 // close never throws, so the caller's database fixture still closes after it; a refused delete is retried and reported by the file's hook.
 return {intent,engine:detectionEngine({appPackageDir:root,intent}),async close(){child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await dropIndexes([...own]);}};
}
module.exports={engineFixture};
