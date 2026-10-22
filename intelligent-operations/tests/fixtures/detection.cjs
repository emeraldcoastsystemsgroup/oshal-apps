// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped engine over real TCP and disposable OpenSearch, with native admission verified separately in the installed lab.
'use strict';
const {spawn}=require('node:child_process'),net=require('node:net'),{root}=require('./intake.cjs');
const {detectionEngine}=require('../../routes/detection-engine.js');
async function engineFixture(){
 const url=process.env.OSHAL_TEST_SEARCH;if(url!=='http://127.0.0.1:35690')throw Error('OSHAL_TEST_SEARCH must explicitly name disposable OpenSearch http://127.0.0.1:35690.');
 const child=spawn('python3',['server.py'],{cwd:root+'/engine',env:{...process.env,OPERATIONS_SEARCH_URL:url,OPERATIONS_ENGINE_PORT:'0'},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 const port=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>{child.kill();reject(Error('Engine did not start: '+stderr));},10000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Engine exited '+code+': '+stderr));});child.stdout.on('data',bytes=>{buffer+=bytes;if(buffer.includes('\n')){clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).listening);}});});
 const intent=async(name,input)=>{if(name!=='engine.exchange')throw Error('Unexpected intent');return new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port});let buffer='',hello;
  socket.setTimeout(55000,()=>{socket.destroy();reject(Error('Engine deadline'));});socket.on('error',reject);
  socket.on('data',bytes=>{buffer+=bytes.toString();let end;while((end=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(!hello){hello=row;socket.write(JSON.stringify({...input.request,id:1})+'\n');}else{socket.end();resolve({hello,reply:row});}}});
 });};
 return {intent,engine:detectionEngine({appPackageDir:root,intent}),async close(){child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}};
}
module.exports={engineFixture};
