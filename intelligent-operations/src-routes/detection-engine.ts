/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the package engine identity and complete typed percolation replies through OSHAL's admitted relay. */
// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './intake';
import {clean,fail} from './topology-model';
export function detectionEngine(ctx){
 const expected=JSON.parse(fs.readFileSync(path.join(ctx.appPackageDir,'engine/identity.json'),'utf8'));
 return async(cmd,owner,args={})=>{
  if(!clean(owner))fail(401,'A verified caller is required.');
  if(typeof ctx.intent!=='function')fail(503,'The authorized detection engine relay is unavailable.');
  const response=await ctx.intent('engine.exchange',{request:{cmd,args:{...args,scope:hash(['detection-owner-v1',owner])}},timeoutMs:55000});
  const hello=response?.hello;if(!hello||hello.protocol!==expected.protocol||hello.engine!==expected.engine||hello.buildHash!==expected.buildHash)fail(503,'The installed detection engine does not match this package build.');
  if(response.reply?.error)fail(503,response.reply.error.message||'Detection could not complete.');
  if(!response.reply?.result)fail(503,'Detection returned no complete result.');
  return {...response.reply.result,engineBuild:hello.buildHash};
 };
}
