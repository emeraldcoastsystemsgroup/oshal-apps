/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: the Image editor's concierge button could not be clicked, AI Office the same, Portrait's Jarvis ball opened create-editor instead of its own concierge, and the video editor's concierge did not open. Every one of those is an application inside Today (/cockpit/?app=<key>), where the concierge entry is Today's own (the bar's Concierge that a framed editor takes over, or the floating ball), so a store suite that opens the application's page alone never presses it. This serves the shipped Today page from a kernel platform export (index.html and every module it loads, mapped as the kernel's own today-startup-concierge.test.mjs does) with the reads Today makes at start, and each application's profile built from its manifest the way the kernel builds it (crates/api/src/ui_applications.rs profile, ribbon_item, concierge_agent at 0ed7f44b: the items are the manifest's ui.static screens as tool-<toolName>, the chat agent is the manifest's chatBot, else its first bot). Together with kernel-window.mjs (the one chat window) a suite opens /cockpit/?app=<key>&screen=<toolName> over its own application routes and presses the entry a person sees.
 */
import {readFileSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolchain} from './kernel-window.mjs';

const STORE=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const TYPES={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.webmanifest':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
/** The person Today shows: made up, never anyone real. */
export const PERSON=Object.freeze({sub:'fixture-person',name:'Fixture Person'});

/**
 * @description An application's profile as GET /api/ui/profile answers it for an admitted person, from the package's
 * manifest in this store: navigation items from ui.static, the bots it declares, and the chat agent its chatBot names.
 * @param {string} name The package folder and application name. @param {object} [manifest] Its manifest, when a suite has it.
 * @returns {object} The profile answer.
 */
export function profileFor(name,manifest){
 const declared=manifest||toolchain('js-yaml').load(readFileSync(join(STORE,name,'oshal-app.yaml'),'utf8'));
 const bots=(declared.bots||[]).map(bot=>({agentId:bot.agentId??null,name:bot.name,selector:bot.agentId?String(bot.agentId):bot.name}));
 const wanted=String(declared.chatBot||'').toLowerCase(),chosen=bots.find(bot=>bot.name.toLowerCase()===wanted)||bots[0]||null;
 const chatAgent=chosen&&{agentId:chosen.agentId,name:chosen.name,selector:chosen.selector};
 const items=(declared.ui?.static||[]).map(tile=>{const id=tile.toolName||tile.label||'tool',label=tile.label||id;
  return{id:'tool-'+id,label,icon:tile.icon||'codicon codicon-app',section:tile.section||'top',group:tile.group??null,
   toolUi:{iframeUrl:tile.iframeUrl,sidebarLabel:label,visibilityToolName:tile.visibilityToolName??null,surfaceBinding:null}};});
 const flags=declared.ribbon||{};
 return{profile:{name,displayName:declared.displayName||name,theme:null,suite:declared.suite||null,ribbon:{items},
  chatBots:bots.map(({agentId,name})=>({agentId,name})),chatAgent,assistant:null,hideChatPanel:flags.hideChatPanel===true,
  hideAssistant:flags.hideAssistant===true,hideStatusBar:flags.hideStatusBar===true,defaultView:items[0]?.id||null},
  chatAgent,operator:false,landingApp:null,requested:name,source:'swarm-app'};
}

/**
 * @description The shipped file a Today address names, as the kernel maps it (ui_assets.rs): /cockpit/ the Today page,
 * /cockpit/<path> the cockpit folder, /shared/ui/<path> the shared UI, /shared/<path> the shared pages then the shared UI,
 * /dist/<path> the API bundle.
 * @param {string} platform The platform folder. @param {string} path The request path. @returns {Promise<string|null>} The file.
 */
export async function todayFile(platform,path){
 const tries=path==='/cockpit/'||path==='/cockpit'?['src/pages/cockpit/index.html']:path.startsWith('/cockpit/')?['src/pages/cockpit/'+path.slice(9)]
  :path.startsWith('/shared/ui/')?['src/shared/ui/'+path.slice(11)]:path.startsWith('/shared/')?['src/pages/shared/'+path.slice(8),'src/shared/ui/'+path.slice(8)]
  :path.startsWith('/dist/')?['src/api/dist/'+path.slice(6)]:[];
 for(const rel of tries){const file=resolve(platform,rel);if(!file.startsWith(resolve(platform)+'/'))continue;try{if((await stat(file)).isFile())return file;}catch{/* the next mapping, as the kernel tries it */}}
 return null;
}

/**
 * @description Put Today and the reads it makes at start on an Express app, after the suite's own application routes
 * and kernel-window.mjs's mountWindow, and refuse every other /api/ read as the kernel would (404 in JSON).
 * @param {object} app The Express app. @param {{platform:string,apps:string[],person?:object}} options The platform folder
 * and the applications whose profiles Today may ask for.
 * @returns {object} The app.
 */
export function mountToday(app,{platform,apps,person=PERSON}){
 const profiles=new Map(apps.map(name=>[name,profileFor(name)]));
 app.use(async(req,res,next)=>{
  try{
   if(req.method!=='GET'&&req.method!=='HEAD')return next();
   const url=new URL(req.originalUrl||req.url,'http://127.0.0.1'),path=decodeURIComponent(url.pathname);
   if(path==='/api/ui/profile'){const answer=profiles.get(url.searchParams.get('name')||'');return answer?res.json(answer):res.status(404).json({error:'application unavailable'});}
   if(path==='/api/auth/user')return res.json({authenticated:true,user:person});
   if(path==='/api/cli-tokens/whoami')return res.json({operator:false});
   if(path==='/api/agents')return res.json({agents:[]});
   if(path==='/api/swarm/bots/registry')return res.json({bots:[]});
   if(path==='/swarmbot/chat')return res.type('html').send('<!doctype html><title>Rail</title><main>Fixture concierge rail</main>');
   // The vendor bundles are not in a platform export (the kernel test answers them empty too).
   if(path.startsWith('/cockpit/vendor/'))return res.type('text/javascript').send('');
   const file=await todayFile(platform,path);
   if(file)return res.type(TYPES[extname(file)]||'application/octet-stream').send(await readFile(file));
   if(path.startsWith('/api/'))return res.status(404).json({error:'fixture endpoint unavailable'});
   next();
  }catch(error){next(error);}
 });
 return app;
}

/**
 * @description Every concierge entry a person can see on Today's screen of an application: the bar's Concierge, the
 * floating ball, and the framed screen's own Concierge button. Each is a Playwright locator, pressed by the caller.
 * @param {object} page The Today page. @returns {Array<{name:string,locator:object}>} The entries, in that order.
 */
export function conciergeEntries(page){
 const screen=page.frameLocator('.tool-view-container > iframe');
 return[{name:'the bar\'s Concierge',locator:page.locator('.tool-view-header [data-tool-view-concierge]')},
  {name:'the floating ball',locator:page.locator('#jarvisOrbFab')},
  {name:'the screen\'s own Concierge',locator:screen.locator('.ef-shell').getByRole('button',{name:'Concierge',exact:true})}];
}

/**
 * @description Which application's concierge a chat window is, read from its address (/api/jarvis/?concierge=<app>&bot=<bot>).
 * @param {object} scope The page, frame or frame locator holding the window. @param {string} [selector] The window's frame.
 * @returns {Promise<{path:string,app:string|null,bot:string|null,src:string}>} The page it frames and the concierge it is.
 */
export async function windowAddress(scope,selector='iframe.jarvis-chat-frame'){
 const src=await scope.locator(selector).first().getAttribute('src')||'',url=new URL(src,'http://window.fixture');
 return{path:url.pathname,app:url.searchParams.get('concierge'),bot:url.searchParams.get('bot'),src};
}

/**
 * @description The addresses of every one chat window open on Today after an entry was pressed: the rail's
 * (#chatWorkspaceFrame, while its panel is open) and any window inside the framed screen that is on screen.
 * @param {object} page The Today page. @returns {Promise<string[]>} Their src addresses.
 */
export async function openWindows(page){
 const found=[];
 const rail=await page.evaluate(()=>{const panel=document.getElementById('chatPanel'),frame=document.getElementById('chatWorkspaceFrame');
  return panel&&frame&&!panel.classList.contains('collapsed')&&frame.getClientRects().length?frame.getAttribute('src')||'':'';});
 if(rail)found.push(rail);
 const inner=page.frameLocator('.tool-view-container > iframe').locator('iframe.jarvis-chat-frame');
 for(let i=0,n=await inner.count().catch(()=>0);i<n;i++)if(await inner.nth(i).isVisible().catch(()=>false))found.push(await inner.nth(i).getAttribute('src')||'');
 return found;
}
