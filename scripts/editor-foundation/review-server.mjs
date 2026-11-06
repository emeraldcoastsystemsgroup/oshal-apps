/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve actual editor adapters on an isolated loopback review shim with durable Create JSON and genuine disposable Publishing SQL/Typst.
 */
import {createServer,request as upstreamRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ReviewStore,ReviewError} from './review-store.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
function reply(res,status,value,headers={}){const bytes=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value);res.writeHead(status,{'Content-Type':typeof value==='object'&&!Buffer.isBuffer(value)?'application/json':'text/plain; charset=utf-8','Cache-Control':'no-store',...headers});res.end(bytes);}
async function body(req){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>600000)throw new ReviewError(413,'review_request_limit');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new ReviewError(400,'review_invalid_json');}}
function localRequest(req){const host=String(req.headers.host??'');if(!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host))return false;const origin=req.headers.origin;if(origin&&origin!==`http://${host}`)return false;return req.headers['sec-fetch-site']!=='cross-site';}
function landing(editor){return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editor foundation review</title><link rel="stylesheet" href="/shared/ui/css/surface-themes.css"><script src="/shared/ui/js/surface-theme.js"></script><style>*{box-sizing:border-box}body{margin:0;color:var(--text-primary);background:var(--bg-primary);font:13px system-ui}header{height:78px;padding:8px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border-color)}header p{margin:2px 0;font-size:12px}nav{display:flex;gap:8px}a,button{color:var(--text-primary);background:var(--bg-card);border:1px solid var(--border-color);padding:8px;border-radius:6px;text-decoration:none}button{cursor:pointer}iframe{display:block;width:100%;height:calc(100dvh - 78px);border:0}#review-note{color:var(--text-secondary)}@media(max-width:600px){header{height:116px;flex-wrap:wrap;padding:6px}iframe{height:calc(100dvh - 116px)}header p{font-size:11px}}</style></head><body><header><div><strong>Editor foundation · review workspace</strong><p id="review-note">Separate review data · AI provider unavailable</p></div><nav aria-label="Review editors"><a href="/?editor=create">Image editor</a><a href="/?editor=publishing">Publishing</a><button id="theme" type="button">Switch theme</button></nav></header><iframe id="review-editor" title="${editor==='publishing'?'Publishing Studio':'Create image editor'}"></iframe><script type="module">const editor=${JSON.stringify(editor)},frame=document.querySelector('iframe');let dark=localStorage.getItem('cockpit-theme')==='midnight';document.querySelector('#theme').onclick=()=>{dark=!dark;localStorage.setItem('cockpit-theme',dark?'midnight':'workspace');location.reload();};const info=await fetch('/review/status').then(r=>r.json());frame.src=editor==='publishing'?'/api/publishing-studio/app':'/api/create/editor?project='+info.createId;if(editor==='publishing'){frame.addEventListener('load',()=>{const open=()=>{const button=[...frame.contentDocument.querySelectorAll('#documents button')].find(node=>node.textContent.includes('Foundation review'));if(button){button.click();return true;}return false;};if(!open()){const observer=new MutationObserver(()=>{if(open())observer.disconnect();});observer.observe(frame.contentDocument.body,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),15000);}});}</script></body></html>`;}
export async function startReviewServer(options={}){
 const platformRoot=resolve(options.platformRoot??process.env.OSHAL_PLATFORM_ROOT??join(root,'../kernel-editor-foundation/platform'));
 const stateFile=options.stateFile??join(homedir(),'.local/state/oshal-editor-foundation/review/create-projects.json');
 const store=new ReviewStore(stateFile);
 let publishing=options.publishing,ownsPublishing=false,closed=false;
 if(!publishing){const {fixture}=await import('../../publishing-studio/tests/fixtures/fixture.mjs');publishing=await fixture({http:true});ownsPublishing=true;}
 try {
 const publisher=publishing.context('alice').store;
 const created=await publisher.create({title:'Foundation review publication',pageCount:2,requestKey:randomUUID()});
 const initial=created.document.model;
 const seeded=await publisher.save(created.document.id,{baseRevision:1,requestKey:randomUUID(),operations:[{op:'replace-layout',pages:initial.pages.map((page,index)=>({...page,objects:index?[]:[{id:'reviewShape',kind:'rect',x:60,y:350,width:240,height:100,color:[59,130,246]}],frames:page.frames.map(frame=>({...frame,height:230}))})),masters:initial.masters,stories:[{...initial.stories[0],paragraphs:[{style:'body',runs:[{text:'Select the blue shape and edit its properties. The same document can be saved, reopened, rendered and changed by a registered editing partner.'}]}]}],assets:initial.assets}]});
 if(options.renderSeed!==false){const {job}=await publisher.begin(seeded.document.id,{revision:seeded.document.revision,requestKey:randomUUID()});await publisher.produce(job.id);}
 const info={review:true,createId:store.list()[0].id,publishingId:seeded.document.id,publishingBackend:'genuine disposable PostgreSQL and Typst; removed when server stops',createBackend:'atomic JSON using actual Create validation; retained across restart',ai:{available:false,reason:'No AI provider is connected to this isolated review workspace.'}};
 const files=[['/shared/ui/css/',join(platformRoot,'src/shared/ui/css')],['/shared/ui/js/',join(platformRoot,'src/shared/ui/js')],['/cockpit/',join(platformRoot,'src/pages/cockpit')],['/api/create/editor/',join(root,'create/tools/editor')]];
 async function staticFile(res,file){try{reply(res,200,await readFile(file),{'Content-Type':mime[extname(file)]??'application/octet-stream'});}catch(error){if(error.code==='ENOENT')reply(res,404,{error:'review_asset_not_found'});else throw error;}}
 const server=createServer(async(req,res)=>{try{
  if(!localRequest(req))return reply(res,403,{error:'review_local_origin_required'});
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname,method=req.method;
  if(path==='/review/status'&&method==='GET')return reply(res,200,info);
  if(path==='/'&&method==='GET')return reply(res,200,landing(url.searchParams.get('editor')==='publishing'?'publishing':'create'),{'Content-Type':'text/html; charset=utf-8'});
  // No provider request, user credential or approval is forwarded from the review workspace.
  if(path.startsWith('/api/swarm/')||path.startsWith('/api/jarvis/'))return reply(res,503,{error:'No AI provider is connected to this isolated review workspace.'});
  if(path.startsWith('/api/publishing-studio')){
   const target=new URL(publishing.url),upstream=upstreamRequest({hostname:'127.0.0.1',port:target.port,path:req.url,method,headers:{...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{}),...(req.headers['content-length']?{'content-length':req.headers['content-length']}:{}),'x-test-owner':'alice'}},answer=>{res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);});upstream.on('error',()=>reply(res,502,{error:'review_publishing_transport_unavailable'}));req.pipe(upstream);return;
  }
  if(method==='GET'){
   if(path==='/api/create/editor')return staticFile(res,join(root,'create/tools/create-editor.html'));
   if(path==='/api/create/theme/create.css')return staticFile(res,join(root,'create/ui/create.css'));
   if(path==='/api/artifacts/picker.js'||path==='/api/artifacts/picker.css')return staticFile(res,join(platformRoot,'src/pages/cockpit/js/components/artifact-picker'+extname(path)));
   for(const[prefix,base]of files)if(path.startsWith(prefix)){const relative=decodeURIComponent(path.slice(prefix.length));const file=resolve(base,relative);if(!file.startsWith(resolve(base)+'/'))return reply(res,403,{error:'review_asset_path_refused'});return staticFile(res,file);}
   if(path==='/api/create/permissions')return reply(res,200,{permissions:{view:true,read:true,create:true,change:true,delete:true,export:true,generate:false}});
   if(path==='/api/create/brand-kit')return reply(res,200,{kit:null});
   if(path==='/api/ui/profile')return reply(res,200,{profile:{name:'editor-foundation-review',ribbon:{items:[]}}});
   if(path==='/api/create/projects')return reply(res,200,{projects:store.list()});
  }
  const match=/^\/api\/create\/projects\/([a-f0-9-]+)(?:\/(revisions|export)(?:\/(\d+))?)?$/.exec(path);
  if(match){const[,id,kind,revision]=match;if(method==='GET'){
   if(kind==='export')return reply(res,200,{document:store.read(id).document});
   if(kind==='revisions'&&!revision){store.read(id);return reply(res,200,{revisions:store.state.projects[id].history.map(row=>store.metadata(row)).reverse()});}
   return reply(res,200,{project:store.read(id,revision)});
  }if(method==='POST'&&kind==='revisions')return reply(res,201,{project:store.save(id,await body(req))});if(method==='DELETE'&&!kind){store.remove(id,(await body(req)).baseRevision);return reply(res,204,'');}}
  if(path==='/api/create/projects'&&method==='POST'){const value=await body(req);return reply(res,201,{project:store.create(value.document,value.title)});}
  if(path.startsWith('/api/create/project-assets')||path.includes('/psd'))return reply(res,503,{error:'File imports are unavailable in this isolated foundation review; shape, text and vector editing are available.'});
  reply(res,404,{error:'review_route_not_available'});
 }catch(error){if(!res.headersSent)reply(res,error.status??400,{error:error.message});else res.destroy();}});
 try{await new Promise((done,reject)=>{server.once('error',reject);server.listen(options.port??38820,'127.0.0.1',done);});}catch(error){if(ownsPublishing)await publishing.close();throw error;}
 return {origin:'http://127.0.0.1:'+server.address().port,store,publishing,info,async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(done=>server.close(done));if(ownsPublishing)await publishing.close();}};
 } catch(error) { if(ownsPublishing)await publishing.close(); throw error; }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const review=await startReviewServer({port:Number(process.env.EDITOR_REVIEW_PORT??38820)});
 process.stdout.write(JSON.stringify({reviewUrl:review.origin,create:review.origin+'/?editor=create',publishing:review.origin+'/?editor=publishing',ai:review.info.ai,notice:'Create review JSON persists; this disposable Publishing database is removed when the server stops.'})+'\n');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void review.close().then(()=>process.exit(0),error=>{process.stderr.write('Review cleanup failed: '+error.message+'\n');process.exit(1);});});
}
