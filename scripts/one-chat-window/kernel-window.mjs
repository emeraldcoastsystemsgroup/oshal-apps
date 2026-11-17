/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-16 ("for the last time"): every chat in an application is the kernel's one chat window, the Jarvis page framed as the application's concierge (/shared/ui/js/jarvis-chat-frame.js mountJarvisChat; the shared editor pane frames it too). A package's browser suite serves that window from a kernel platform export and stands in for the kernel routes it reads, as the kernel's own platform/src/shared/ui/js/jarvis-chat-core.test.mjs does: the page and its assets, the model menu's rails (a pick rides on the turn's context as provider and model), the person's conversations, and the bot's door, which answers at once with a pending job whose steps and answer the window then reads. Each turn is kept with its door, body and headers, so a suite can say what reached the bot. No live service, no provider, nothing outside the loopback.
 */
import {existsSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const STORE=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
/** The file every platform that carries the one chat window holds (kernel 00c62f98 or later). */
export const WINDOW_MOUNT='src/shared/ui/js/jarvis-chat-frame.js';
const TYPES={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
/** Two rails the person may pick from, so the window shows its model menu (GET /api/models/choice). */
export const RAILS=Object.freeze({
 catalog:[{id:'first',models:[{id:'first-model',name:'First model'}]},{id:'picked',models:[{id:'picked-model',name:'Picked model'}]}],
 report:{fleetDefault:{providerId:'first',modelId:'first-model',fallbackOrder:['picked']}},
 choice:{pick:'swarm-rails',mode:'everyone',rails:[{provider:'first',model:'first-model'},{provider:'picked',model:'picked-model'}]}});

/**
 * @description The store gate's toolchain module (Playwright, Express), from STORE_CI_TOOLCHAIN or scripts/toolchain.
 * @param {string} name The module. @returns {*} The module.
 */
export function toolchain(name){
 const roots=[process.env.STORE_CI_TOOLCHAIN,join(STORE,'scripts/toolchain')].filter(Boolean);
 return createRequire(import.meta.url)(createRequire(import.meta.url).resolve(name,{paths:roots}));
}

/**
 * @description The kernel platform folder the window is served from: OSHAL_KERNEL_PLATFORM (the store gate's pin),
 * else OSHAL_PLATFORM_ROOT, else the fallback a suite names. It must carry the window; a platform from before it is
 * refused in words, never skipped.
 * @param {string} [fallback] A suite's own default (a sibling kernel checkout's platform folder).
 * @returns {string} The platform folder.
 */
export function kernelPlatform(fallback){
 const named=process.env.OSHAL_KERNEL_PLATFORM||process.env.OSHAL_PLATFORM_ROOT||fallback||'';
 const folder=named?resolve(named):'';
 if(!folder||!existsSync(join(folder,WINDOW_MOUNT)))throw new Error(`OSHAL_KERNEL_PLATFORM must name a kernel platform folder that carries the one chat window (${WINDOW_MOUNT}, kernel 00c62f98 or later); got "${named||'(unset)'}"`);
 return folder;
}

/**
 * @description Where the kernel serves a path of the window from, inside a platform folder: the Jarvis page and its
 * assets, its briefing client, the shared UI (with the approval cards), the cockpit and the experience folder.
 * @param {string} platform The platform folder. @param {string} pathname The request path.
 * @returns {string|null} The file, or null when the window does not read that path from disk.
 */
export function windowFile(platform,pathname){
 if(pathname==='/api/jarvis/'||pathname==='/api/jarvis')return join(platform,'src/api/jarvis.html');
 if(pathname.startsWith('/api/jarvis/assets/'))return join(platform,'src/api',pathname.slice('/api/jarvis/assets/'.length));
 if(pathname==='/api/jarvis/briefings/client.js')return join(platform,'src/pages/jarvis-briefings/client.js');
 if(pathname==='/shared/ui/js/package-tool-cards.js')return join(platform,'src/api/jarvis-package-tools.js');
 for(const [prefix,folder] of [['/shared/ui/','src/shared/ui/'],['/cockpit/','src/pages/cockpit/'],['/experience/','src/experience/']])
  if(pathname.startsWith(prefix))return join(platform,folder,pathname.slice(prefix.length));
 return null;
}

/**
 * @description Send a platform file the window reads, if the platform has it. A path of the Jarvis page's own that the
 * platform does not ship answers 404; a shared, cockpit or experience path it does not ship is left to the suite.
 * @param {string} platform @param {string} pathname
 * @returns {Promise<{status:number,type:string,body:Buffer|string}|null>} null when the suite answers the path.
 */
export async function windowAsset(platform,pathname){
 let path;try{path=decodeURIComponent(pathname);}catch{return null;}
 const file=windowFile(platform,path);
 if(!file)return null;
 const missing=path.startsWith('/api/jarvis')?{status:404,type:'text/plain',body:'not in this platform'}:null;
 const inside=resolve(file);if(!inside.startsWith(resolve(platform)+'/'))return missing;
 try{if((await stat(inside)).isFile())return{status:200,type:TYPES[extname(inside)]||'text/plain',body:await readFile(inside)};}catch{/* this platform does not ship it */}
 return missing;
}

/**
 * @description The stand-in kernel behind the window: the routes it reads and the bot's door.
 * @param {object} [options]
 * @param {function(object):(string|object)} [options.answer] The answer to a turn (the turn as asked): Markdown, or
 * `{answer, ...more}` whose other fields (an approval card's `packageToolProposal`) ride on the finished turn.
 * @param {Array<object>} [options.shelf] The person's saved conversations (GET /api/jarvis/tasks rows).
 * @param {Record<string,Array<{role:string,text:string}>>} [options.history] Turns kept per session.
 * @param {object} [options.choice] GET /api/models/choice; RAILS.choice by default (the menu is shown).
 * @returns {{asks:Array<object>,handle:function({method:string,url:URL,body:string,headers:object}):({status:number,json:*}|null),answerFor:function(object):string}}
 *   Every turn as the door received it (`bot`, `door`, `message`, `sessionId`, `context`, `prefer`), the routes, and
 *   the words a turn is answered with.
 */
export function windowKernel({answer=()=>'Done.',shelf=[],history={},choice=RAILS.choice}={}){
 const asks=[],jobs=new Map(),traces=[];
 const json=(value,status=200)=>({status,json:value});
 /** The finished turn's answer and what rides with it, made once per turn and the same every time it is read. */
 const replies=new WeakMap();
 const replyTo=ask=>{if(!replies.has(ask)){const made=answer(ask);replies.set(ask,made&&typeof made==='object'?{...made,answer:String(made.answer??'')}:{answer:String(made??'')});}return replies.get(ask);};
 const answerFor=ask=>replyTo(ask).answer;
 function handle({method,url,body,headers}){
  const p=url.pathname;
  const door=/^\/api\/swarm\/bots\/([^/]+)\/ask$/.exec(p);
  if(door&&method==='POST'){
   let sent={};try{sent=JSON.parse(body||'{}');}catch{return json({error:'not JSON'},400);}
   const ask={...sent,bot:decodeURIComponent(door[1]),door:p,prefer:String(headers?.prefer||''),n:asks.length+1};
   asks.push(ask);traces.push(String(headers?.['x-oshal-trace']||''));
   jobs.set('pending-'+ask.n,{ask,left:1});
   return json({jobId:'pending-'+ask.n,status:'pending'},202);
  }
  if(method!=='GET'&&method!=='HEAD')return null;
  if(p==='/api/jarvis/ask/result'){
   const job=jobs.get(url.searchParams.get('jobId'));if(!job)return json({error:'not_found'},404);
   if(job.left-->0)return json({status:'pending',steps:[{kind:'model',status:'running'}],moreSteps:0});
   return json({steps:[{kind:'model',status:'done'}],...replyTo(job.ask),status:'done',jobId:'saved-'+job.ask.n,sessionId:job.ask.sessionId});
  }
  if(p==='/api/models/choice')return json(choice);
  if(p==='/api/providers')return json(RAILS.catalog);
  if(p==='/api/agents/provider-switch')return json(RAILS.report);
  if(p==='/settings/inference.fleet.fallbacks')return json({key:'inference.fleet.fallbacks',scope:'kernel_default',value:'[]'});
  if(p==='/api/trial/status')return json({trial_active:false});
  if(p==='/api/jarvis/tasks')return json({tasks:shelf,nextCursor:null,total:shelf.length});
  if(p==='/api/jarvis/history'){const session=url.searchParams.get('sessionId');return json({sessionId:session,turns:history[session]||[]});}
  if(p==='/api/costs')return json({events:traces.map((trace,i)=>({trace,api:asks[i]?.context?.provider||'first',model:asks[i]?.context?.model||'first-model',at:i+1}))});
  if(p.startsWith('/api/jarvis/')||p.startsWith('/api/models/')||p.startsWith('/api/agents/')||p.startsWith('/api/artifacts/')||p.startsWith('/api/user-model/'))return json({});
  return null;
 }
 return{asks,handle,answerFor};
}

/**
 * @description Put the window and its stand-in kernel on an Express app, ahead of the suite's own routes.
 * @param {object} app The Express app. @param {{platform:string,kernel:object}} options
 * @returns {object} The app.
 */
export function mountWindow(app,{platform,kernel}){
 app.use(async(req,res,next)=>{
  try{
   const url=new URL(req.originalUrl||req.url,'http://127.0.0.1');
   const asset=await windowAsset(platform,url.pathname);
   if(asset){res.status(asset.status).type(asset.type).send(asset.body);return;}
   // Only a turn has a body the stand-in reads: from a body parser that already ran, else from the request itself.
   const turn=req.method==='POST'&&/^\/api\/swarm\/bots\/[^/]+\/ask$/.test(url.pathname);
   const body=!turn?'':req.body!==undefined?(typeof req.body==='string'?req.body:JSON.stringify(req.body)):req.complete?''
    :await new Promise((done,fail)=>{let text='';req.setEncoding('utf8');req.on('data',chunk=>{text+=chunk;});req.on('end',()=>done(text));req.on('error',fail);});
   const answer=kernel.handle({method:req.method,url,body,headers:req.headers});
   if(answer){res.status(answer.status).json(answer.json);return;}
   next();
  }catch(error){next(error);}
 });
 return app;
}

/**
 * @description The chat window inside a page or a frame, once its message box is there.
 * @param {object} scope A Playwright Page, Frame or FrameLocator. @param {string} [selector] The window's frame.
 * @param {number} [timeout]
 * @returns {Promise<object>} The window's FrameLocator.
 */
export async function chatWindow(scope,selector='iframe.jarvis-chat-frame',timeout=20000){
 const chat=scope.frameLocator(selector);
 await chat.locator('.jc-composer #typein').waitFor({state:'visible',timeout}).catch(async()=>{
  const src=await scope.locator(selector).first().getAttribute('src',{timeout:1000}).catch(()=>null);
  throw new Error(`no chat window in ${selector}: ${src||'(no frame)'}`);
 });
 return chat;
}

/**
 * @description The window's own controls, every one of which the person can see: the model menu, Files, Tap to talk,
 * Keep trying, New conversation and Recent conversations.
 * @param {object} chat The window. @returns {Promise<void>}
 */
export async function windowControls(chat){
 for(const [name,locator] of [['the model menu','#jarvisModelBtn'],['Files','#addMediaBtn'],['Tap to talk','#mic'],['Keep trying','#effortToggle'],
  ['New conversation','.jc-header button[aria-label="New conversation"]'],['Recent conversations','.jc-header button[aria-label="Recent conversations"]']]){
  await chat.locator(locator).first().waitFor({state:'visible',timeout:15000}).catch(()=>{throw new Error(`the chat window shows ${name} (${locator})`);});
 }
}

/**
 * @description Pick a model in the window's menu for the next request.
 * @param {object} chat @param {function(object):Promise} press Click or tap. @param {string} [provider]
 * @returns {Promise<string>} The label the control then shows.
 */
export async function pickModel(chat,press,provider='picked'){
 await press(chat.locator('#jarvisModelBtn'));await press(chat.locator(`.jmm-item[data-provider="${provider}"]`));
 return (await chat.locator('#jarvisModelBtn .jmm-trigger-label').textContent()).trim();
}

/**
 * @description Send words as the person in the window and wait for the bot's answer to show under them.
 * @param {object} chat @param {string} words @param {function(object):Promise} press
 * @param {{asks:Array<object>,answerFor:function(object):string}} kernel The stand-in. @param {number} [timeout]
 * @returns {Promise<{ask:object,answer:object}>} The turn as the bot's door received it, and the answer's bubble.
 */
export async function sendInWindow(chat,words,press,kernel,timeout=20000){
 const before=kernel.asks.length;
 await chat.locator('#typein').fill(words);await press(chat.locator('#typer button[type=submit]'));
 for(const until=Date.now()+timeout;kernel.asks.length<=before;){
  if(Date.now()>until)throw new Error('the window sent no turn to a bot');
  await new Promise(done=>setTimeout(done,50));
 }
 const ask=kernel.asks.at(-1);
 const said=kernel.answerFor(ask).split('\n').map(line=>line.replace(/^\s*(?:[-+]|\d+\.)\s+/,'').replace(/[*_`#>|]/g,' ').trim()).find(Boolean)||'';
 const answer=chat.locator('#convo .msg.bot .bx').filter({hasText:said.split(/\s+/).slice(0,6).join(' ')}).last();
 await answer.waitFor({timeout}).catch(()=>{throw new Error(`the answer to "${words}" did not show in the window`);});
 return{ask,answer};
}
