#!/usr/bin/env node
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the enrolled native browser worker with pinned runtime bytes and a private persistent login profile, keeping browser state separate from the user's other tabs.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const worker=require('../lib/career-browser-worker');
async function main(){
  // Resolve an operator-installed pinned Playwright bundle, never arbitrary job-supplied code.
  const {chromium}=require('playwright'),version=require('playwright/package.json').version;
  if(version!=='1.59.1')throw Error('worker_playwright_version_refused');
  const browserPath=process.env.CAREER_BROWSER_EXECUTABLE||chromium.executablePath();
  const fingerprint=worker.fingerprint(version,browserPath),generation=[...Buffer.from(fingerprint,'hex')];
  if(process.argv[2]==='--fingerprint'){process.stdout.write(fingerprint+'\n');return;}
  if(process.argv.length!==5||process.argv[3]!=='--expected-sha256'||process.argv[4]!==fingerprint)throw Error('worker_runtime_pin_refused');
  const settings=worker.config(path.resolve(process.argv[2])),call=worker.client(settings);
  worker.privateDirectory(settings.workDir);worker.privateDirectory(settings.profileDir);
  const context=await chromium.launchPersistentContext(settings.profileDir,{executablePath:browserPath,
    headless:settings.headless!==false,serviceWorkers:'block',acceptDownloads:false,viewport:{width:1280,height:900}});
  await context.route('**/*',worker.publicNetwork);
  // No debugging attachment to an unrelated browser or user tab is used.
  for(const page of context.pages())await page.close();
  let stop=false;for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>{stop=true;context.close().catch(()=>{});});
  let heartbeat;
  try{
    await call('heartbeat',{generation});
    heartbeat=setInterval(()=>call('heartbeat',{generation}).catch(()=>{}),10000);heartbeat.unref();
    while(!stop){
      try{
        await worker.recover(call,settings.workDir);
        const {envelope}=await call('claim',{bot:settings.botId});
        if(envelope){const result=await worker.execute(call,envelope,context,{generation,root:settings.workDir});
          process.stdout.write(JSON.stringify({event:'career.browser.completed',...result})+'\n');}
        else await new Promise(resolve=>setTimeout(resolve,1000));
      }catch(e){process.stderr.write(JSON.stringify({event:'career.browser.waiting',code:e.message==='worker_result_pending'?'result_pending':'request_stopped'})+'\n');
        await new Promise(resolve=>setTimeout(resolve,2000));}
    }
  }finally{clearInterval(heartbeat);await context.close();}
}
main().catch(()=>{process.stderr.write('career_browser_worker_start_refused\n');process.exitCode=1;});
