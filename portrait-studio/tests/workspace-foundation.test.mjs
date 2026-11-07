/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real source-photo cropping, typed settings, history and mobile editor panes over isolated synthetic reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-05: the inspector no longer carries a second copy of the generation notes and settings (Step 3's #notes and #tune* are the one set, the set Generate reads), so the notes checks assert there is no notes property and that a reader has no editable property.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),core=process.env.OSHAL_CORE_ROOT,platform=process.env.OSHAL_PLATFORM_ROOT;
assert.ok(core&&platform,'Matching core dependencies and kernel platform roots are required.');
const requireCore=createRequire(resolve(core,'package.json')),requireOwn=createRequire(resolve(root,'oshal-app.yaml'));
const express=requireCore('express'),{chromium}=requireCore('playwright'),sharp=requireCore('sharp');
const {clientCatalog}=requireOwn('./routes/portrait-catalog.js');
let browser,photo;
before(async()=>{browser=await chromium.launch({headless:true});photo=await sharp({create:{width:800,height:600,channels:3,background:'#4488aa'}}).png().toBuffer();});
after(async()=>{await browser?.close();});
async function fixture(t,{width=1280,create=true}={}){
 const app=express(),requests=[];
 app.use((req,res,next)=>{requests.push({method:req.method,path:req.path});next();});
 app.get('/api/portrait-studio/app',(_req,res)=>res.sendFile(resolve(root,'tools/portrait-studio.html')));
 app.get('/api/portrait-studio/capture-module',(_req,res)=>res.sendFile(resolve(root,'tools/portrait-capture.js')));
 app.get('/api/portrait-studio/face-module',(_req,res)=>res.sendFile(resolve(root,'tools/portrait-face.js')));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
 app.get('/api/portrait-studio/permissions',(_req,res)=>res.json({permissions:{view:true,read:true,create,change:true,export:true},unavailable:{email:true}}));
 app.get('/api/portrait-studio/provider',(_req,res)=>res.json({configured:true,provider:'fixture-no-generation'}));
 app.get('/api/portrait-studio/catalog',(_req,res)=>res.json(clientCatalog()));app.get('/api/portrait-studio/portraits',(_req,res)=>res.json({portraits:[]}));
 app.get('/api/artifacts/picker.js',(_req,res)=>res.type('js').send('window.oshalArtifactPicker=undefined;'));
 app.use((_req,res)=>res.status(404).json({error:'outside_fixture'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const context=await browser.newContext({viewport:{width,height:915}});t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/api/portrait-studio/app');await page.locator('.ef-shell').waitFor({state:'attached'});
 return{page,requests,errors};
}
const property=(page,key)=>page.locator('[data-editor-property="'+key+'"]');
async function change(page,key,value){await property(page,key).fill(String(value));await property(page,key).press('Tab');}
test('source crop geometry remains editable with aspect-preserving properties and undo/redo',async t=>{
 const{page,requests,errors}=await fixture(t);await page.locator('#fileInput').setInputFiles({name:'Synthetic.png',mimeType:'image/png',buffer:photo});
 await property(page,'crop-w').waitFor();const width=Number(await property(page,'crop-w').inputValue());
 await change(page,'crop-w',240);assert.equal(Number(await property(page,'crop-h').inputValue()),300);
 await page.getByRole('button',{name:'Undo crop',exact:true}).click();assert.equal(Number(await property(page,'crop-w').inputValue()),width);
 await page.getByRole('button',{name:'Redo crop',exact:true}).click();assert.equal(Number(await property(page,'crop-w').inputValue()),240);
 assert.equal(await property(page,'notes').count(),0,'generation notes live in Step 3 only');
 assert.equal(requests.some(row=>row.method==='POST'),false);assert.deepEqual(errors,[]);
});
test('phone properties retain the source canvas and read-only access disables edits',async t=>{
 const{page,requests,errors}=await fixture(t,{width:412});await page.locator('#fileInput').setInputFiles({name:'Synthetic.png',mimeType:'image/png',buffer:photo});
 await page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();await property(page,'crop-w').waitFor();await change(page,'crop-w',240);
 await page.getByRole('button',{name:'Close inspector',exact:true}).click();assert.equal(await page.locator('#cropCanvas').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(requests.some(row=>row.method==='POST'),false);assert.deepEqual(errors,[]);
 const reader=await fixture(t,{create:false});assert.equal(await reader.page.locator('[data-editor-property]:not(:disabled)').count(),0);assert.equal(await reader.page.locator('#generateBtn').isVisible(),false);
 assert.equal(reader.requests.some(row=>row.method==='POST'),false);assert.deepEqual(reader.errors,[]);
});
