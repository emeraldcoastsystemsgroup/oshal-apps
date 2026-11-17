/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: "when im in image editor the image concierge button can not be clicked, same with ai office, portrait has a jarvis ball that opens create-editor not a concierge, video editor's concierge doesnt open". A person reaches an editor inside Today (/cockpit/?app=<key>&screen=<tool>), where Today's own bar Concierge, its Jarvis ball and the editor's own Concierge decide which concierge opens; a package page opened alone shows none of that. This serves the shipped Today page from a kernel platform export, as the kernel's own Today tests do (platform/src/pages/cockpit/js/today-startup-concierge.test.mjs), with the profile the kernel builds from a store manifest (crates/api/src/ui_applications.rs profile, concierge_bots, concierge_agent, ribbon_item), the applications' own pages from their fixture servers on the same origin, and the one chat window with its stand-in kernel (scripts/one-chat-window/kernel-window.mjs). The origin is a loopback address, a secure context as production's is: on a plain-http name the Image editor cannot start (crypto.randomUUID is undefined there). Nothing leaves the browser: every request is answered here or by a fixture server, and no request reaches a live service.
 */
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolchain,windowAsset} from '../one-chat-window/kernel-window.mjs';

const STORE=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
/** Today's address in these cases: answered whole by the browser's routes, never by a server. */
export const TODAY_ORIGIN='http://127.0.0.1:39911';
const TYPES={'.css':'text/css','.html':'text/html','.json':'application/json','.webmanifest':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const typeOf=path=>{if(path.endsWith('/'))return 'text/html';const ext=path.slice(path.lastIndexOf('.'));return TYPES[ext]||'text/javascript';};

/**
 * @description A Today asset as the kernel maps it (ui_assets.rs): /cockpit/ the cockpit pages, /shared/ui/ the shared UI,
 * /shared/ the shared pages then the shared UI, /dist/ the API bundle.
 * @param {string} platform The kernel platform folder. @param {string} path The request path.
 * @returns {Promise<Buffer|null>} The shipped file, or null when the platform ships none.
 */
export async function shipped(platform,path){
 const tries=path==='/cockpit/'?['pages/cockpit/index.html']:path.startsWith('/cockpit/')?['pages/cockpit/'+path.slice(9)]
  :path.startsWith('/shared/ui/')?['shared/ui/'+path.slice(11)]:path.startsWith('/shared/')?['pages/shared/'+path.slice(8),'shared/ui/'+path.slice(8)]
  :path.startsWith('/dist/')?['api/dist/'+path.slice(6)]:[];
 for(const rel of tries){try{return await readFile(join(platform,'src',rel));}catch{/* the next mapping, as the kernel tries it */}}
 return null;
}

/**
 * @description GET /api/ui/profile?app=<app> as the kernel answers it for a person admitted to every tile: the manifest's
 * tiles as ribbon items (`tool-<toolName>`), its bots, and the concierge agent (the manifest's chatBot when it names one
 * of its own bots, else the first).
 * @param {string} app The store package. @returns {Promise<object>} The answer.
 */
export async function todayProfile(app){
 const yaml=toolchain('js-yaml'),manifest=yaml.load(await readFile(join(STORE,app,'oshal-app.yaml'),'utf8')),ribbon=manifest.ribbon||{};
 const items=(manifest.ui?.static||[]).map(tile=>{const id=tile.toolName||tile.label||'tool',label=tile.label||id;
  return{id:'tool-'+id,label,icon:tile.icon||'codicon codicon-app',section:tile.section||'top',group:tile.group??null,
   toolUi:{iframeUrl:tile.iframeUrl,sidebarLabel:label,visibilityToolName:tile.visibilityToolName??null,surfaceBinding:null}};});
 const bots=(manifest.bots||[]).map(bot=>({agentId:bot.agentId??null,name:bot.name,selector:bot.agentId||bot.name}));
 const named=String(manifest.chatBot||'').trim().toLowerCase(),chosen=bots.find(bot=>bot.name.toLowerCase()===named)||bots[0];
 const chatAgent=chosen?{agentId:chosen.agentId,name:chosen.name,selector:chosen.selector}:null;
 return{profile:{name:app,displayName:manifest.displayName||app,theme:null,suite:manifest.suite,ribbon:{items},
  chatBots:bots.map(({agentId,name})=>({agentId,name})),chatAgent,assistant:null,hideChatPanel:Boolean(ribbon.hideChatPanel),
  hideAssistant:Boolean(ribbon.hideAssistant),hideStatusBar:Boolean(ribbon.hideStatusBar),defaultView:ribbon.defaultView?'tool-'+ribbon.defaultView:items[0]?.id},
  operator:false,landingApp:null,requested:app,chatAgent};
}

/**
 * @description Answer every request of a browser context opened on TODAY_ORIGIN: an application path from its fixture
 * server (the request as sent, less the browser's Origin and Referer, which a fixture's own origin check would refuse),
 * the window's page and assets, the shipped Today page, Today's own reads, and the window's stand-in kernel. Any other
 * write is refused and kept; any other address is aborted and kept.
 * @param {object} context A Playwright BrowserContext.
 * @param {{platform:string,kernel:{handle:Function},profile:function():object,servers:Array<[string,string]>}} options
 *   The platform, the stand-in kernel, the profile in force, and [path prefix, fixture origin] pairs.
 * @returns {Promise<{writes:string[],foreign:string[]}>}
 */
export async function serveToday(context,{platform,kernel,profile,servers}){
 const writes=[],foreign=[];
 const json=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  if(url.origin!==TODAY_ORIGIN){foreign.push(url.origin);return route.abort();}
  const server=servers.find(([prefix])=>path.startsWith(prefix));
  if(server){const headers={...request.headers()};delete headers.origin;delete headers.referer;
   return route.fulfill({response:await route.fetch({url:server[1]+path+url.search,headers})});}
  if(method==='GET'&&(path.startsWith('/api/jarvis')||path==='/shared/ui/js/package-tool-cards.js'||path.startsWith('/experience/'))){
   const asset=await windowAsset(platform,path);if(asset)return route.fulfill({status:asset.status,contentType:asset.type,body:asset.body});}
  if(method==='GET'||method==='HEAD'){const body=await shipped(platform,path);if(body)return route.fulfill({contentType:typeOf(path),body});}
  if(path==='/api/auth/user')return json(route,{authenticated:true,user:{sub:'today-fixture-person',name:'Fixture Person'}});
  if(path==='/api/cli-tokens/whoami')return json(route,{operator:false});
  if(path==='/api/ui/profile')return json(route,profile());
  if(path==='/api/agents')return json(route,{agents:[]});
  if(path==='/api/swarm/bots/registry')return json(route,{bots:[]});
  const own=kernel.handle({method,url,body:request.postData()||'',headers:request.headers()});
  if(own)return json(route,own.json,own.status);
  if(method!=='GET'&&method!=='HEAD'){writes.push(method+' '+path);return json(route,{error:'today fixture reads only'},405);}
  return json(route,{error:'today fixture endpoint unavailable'},404);
 });
 return{writes,foreign};
}

/**
 * @description The editor's page inside Today, once its shared editor is on screen.
 * @param {object} page Today. @param {string} path The page's path. @param {number} [timeout]
 * @returns {Promise<object>} The page's Frame.
 */
export async function editorFrame(page,path,timeout=30000){
 for(const until=Date.now()+timeout;Date.now()<until;){
  const frame=page.frames().find(candidate=>{try{return new URL(candidate.url()).pathname.startsWith(path);}catch{return false;}});
  if(frame&&await frame.locator('.ef-shell').count().catch(()=>0))return frame;
  await page.waitForTimeout(250);
 }
 throw new Error(`Today never showed the editor at ${path}: ${page.frames().map(frame=>frame.url()).join(', ')}`);
}

/**
 * @description The concierge entries a person can see in Today with an editor open: Today's bar Concierge, Today's ball,
 * and the editor's own Concierge (a button, a tool or a tab), each named for the report.
 * @param {object} page Today. @param {object} frame The editor's page.
 * @returns {Promise<Array<[string,object]>>} [name, locator] of each one on screen.
 */
export async function conciergeEntries(page,frame){
 const candidates=[['Today bar Concierge',page.locator('.tool-view-header [data-tool-view-concierge]')],['Today ball',page.locator('#jarvisOrbFab')],
  ['editor Concierge',frame.getByRole('button',{name:/^\W*Concierge$/})],['editor Concierge tab',frame.getByRole('tab',{name:'Concierge',exact:true})]];
 const shown=[];
 for(const [name,locator] of candidates)for(let i=0,n=await locator.count();i<n;i++)if(await locator.nth(i).isVisible())shown.push([name,locator.nth(i)]);
 return shown;
}

/**
 * @description The editor's one chat window as the person sees it: its address and whether it is on screen with its
 * message box.
 * @param {object} frame The editor's page. @returns {Promise<{src:string|null,shown:boolean,typing:boolean}>}
 */
export async function editorWindow(frame){
 const placed=await frame.evaluate(()=>{const window=document.querySelector('iframe.jarvis-chat-frame');
  return window?{src:window.getAttribute('src'),shown:window.getClientRects().length>0&&window.getBoundingClientRect().width>0&&window.getBoundingClientRect().height>0}:{src:null,shown:false};});
 const typing=placed.shown&&await frame.frameLocator('iframe.jarvis-chat-frame').locator('.jc-composer #typein').isVisible().catch(()=>false);
 return{...placed,typing};
}
