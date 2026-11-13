/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Local HTTP fixture serves shipped Career and real shared assistant assets, with fictional owner status and no external requests.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The shared UI comes from OSHAL_KERNEL_PLATFORM, which the store gate supplies; OSHAL_CORE_ROOT is read only when that is unset.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'../../..');
const express=require(require.resolve('express',{paths:[path.join(repo,'scripts/toolchain')]}));
export const {chromium}=require(require.resolve('playwright',{paths:[path.join(repo,'scripts/toolchain')]}));
export const sharedRoot=process.env.OSHAL_KERNEL_PLATFORM||process.env.OSHAL_CORE_ROOT;
const items=[['home','Home','home'],['search','Find jobs','search-ui'],['board','My jobs','board-native'],['resume-studio','My résumé','resume-studio'],['settings','Settings','settings']]
 .map(([id,label,view])=>({id:'tool-career-'+id,label,section:'top',toolUi:{iframeUrl:'/api/career-hunter/'+view,visibilityToolName:'career-'+id}}));
export async function startConciergeFixture(){
 const app=express(),calls=[];app.use(express.json());
 app.use((req,res,next)=>{calls.push({method:req.method,path:req.path,body:req.body});next();});
 app.get('/api/ui/profile',(_req,res)=>res.json({profile:{ribbon:{items}}}));
 app.get('/api/auth/user',(_req,res)=>res.json({displayName:'Alex Fixture'}));
 app.get('/api/career-hunter/home',(_req,res)=>res.sendFile(path.join(repo,'career-hunter/tools/career-home.html')));
 app.use('/api/career-hunter/static',express.static(path.join(repo,'career-hunter/tools')));
 if(sharedRoot)app.use('/shared/ui',express.static(path.join(sharedRoot,'src/shared/ui')));
 app.get('/ui/kernel/:file',(_req,res)=>res.type('js').send('/* Fixture: unused table component. */'));
 app.post('/api/swarm/bots/career-concierge/ask',(req,res)=>{
  if(req.body.context?.app!=='career-hunter')return res.status(400).json({error:'wrong application'});
  res.json({reply:'Your main résumé is saved. Sections: Summary, Skills, Experience, Education. Open My résumé to edit it.'});
 });
 app.get('/api/career-hunter/jobs/stats',(_req,res)=>res.json({saved:2,queued:0,tracked:0}));
 app.get('/api/career-hunter/resume/state',(_req,res)=>res.json({hasResume:true,name:'Alex Fixture',roles:2,scored:4}));
 app.get('/api/career-hunter/home-summary',(_req,res)=>res.json({metrics:[{label:'Saved jobs',value:'2'}],items:[]}));
 app.get('/api/career-hunter/home-plan',(_req,res)=>res.json({apps:[]}));
 app.use('/api',(_req,res)=>res.json({jobs:[],records:[],applications:[]}));
 app.get('/fixture/:host',(req,res)=>res.type('html').send(parent(req.params.host)));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 return{origin:'http://127.0.0.1:'+server.address().port,calls,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
function parent(host){
 if(host==='native')return`<!doctype html><html><head><style>body{margin:0}#surface-frame-container{height:100dvh;display:flex}iframe{flex:1;min-width:0;border:0}.app-focus-bar{height:40px}</style></head><body><div id="surface-viewer-card"><div class="app-focus-bar"><button id="concierge-toggle">Old concierge</button></div><nav id="active-app-tools">Unformatted application bar</nav><div id="surface-frame-container"><iframe id="active-app-frame" src="/api/career-hunter/home"></iframe><aside id="active-app-concierge">Old fly-in</aside></div></div></body></html>`;
 return`<!doctype html><html><head><style>body{margin:0}.cockpit-body{height:100dvh}.tool-view-container,.main-content,iframe{height:100%;width:100%;border:0}</style></head><body><div class="cockpit-body"><div class="main-content"><div class="tool-view-container"><div class="tool-view-header">Old bar</div><iframe src="/api/career-hunter/home"></iframe></div></div><aside class="chat-panel collapsed">Old fly-in</aside></div></body></html>`;
}
