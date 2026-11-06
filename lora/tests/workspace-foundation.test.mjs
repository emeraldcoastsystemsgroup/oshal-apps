/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise new-character properties and dataset source controls in the real shared editor without starting training.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),core=process.env.OSHAL_CORE_ROOT,platform=process.env.OSHAL_PLATFORM_ROOT;assert.ok(core&&platform,'Matching core and platform roots required.');
const requireCore=createRequire(resolve(core,'package.json')),express=requireCore('express'),{chromium}=requireCore('playwright');let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>{await browser?.close();});
async function fixture(t,width=1280,metadata=true){
 const app=express(),writes=[],character={subject:'test-character',display_name:'Test character',trigger_word:'testcharacter',hero_image:'hero.png',ident_prompt:'A blue test character',storage_key:'owned-test'};
 app.use(express.json());app.get('/api/lora/ui',(_req,res)=>res.sendFile(resolve(root,'tools/lora.html')));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
 app.get('/api/lora/characters/:subject/editor',(req,res)=>metadata?res.json({subject:req.params.subject,characterId:'11111111-1111-4111-8111-111111111111',displayName:character.display_name,revision:0,canConfigure:true,canExecute:false}):res.status(403).json({error:'Fixture source editor unavailable; saved evidence remains readable.'}));
 app.get('/api/lora/characters',(_req,res)=>res.json({characters:[character]}));app.get('/api/lora/models',(_req,res)=>res.json({models:[]}));app.get('/api/lora/dataset',(_req,res)=>res.json({images:[]}));
 app.post('/api/lora/characters',(req,res)=>{writes.push(req.body);res.json({subject:character.subject,message:'Fixture character saved; no training.'});});
 app.use((_req,res)=>res.status(404).json({error:'outside_fixture'}));const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const context=await browser.newContext({viewport:{width,height:915}});t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/api/lora/ui');await page.locator('.ef-shell').waitFor();return{page,writes,errors};
}
const property=(page,key)=>page.locator('[data-editor-property="'+key+'"]');
async function change(page,key,value){await property(page,key).fill(value);await property(page,key).press('Tab');}
test('typed creation fields feed the existing Save character command and never start training',async t=>{
 const{page,writes,errors}=await fixture(t);await page.locator('#characterEditor summary').click();
 await change(page,'subject','new-character');await change(page,'displayName','New character');await change(page,'heroImage','hero-new.png');await change(page,'identPrompt','A green new character');
 await page.locator('#characterForm').getByRole('button',{name:'Save character',exact:true}).click();await page.locator('#createResult').filter({hasText:/saved/i}).waitFor();
 assert.equal(writes.length,1);assert.equal(writes[0].subject,'new-character');assert.equal(writes[0].identPrompt,'A green new character');assert.deepEqual(errors,[]);
});
test('selected identity remains read-only while a phone dataset caption stays editable',async t=>{
 const{page,writes,errors}=await fixture(t,412);await page.locator('.ef-tools').getByRole('button',{name:'Navigation',exact:true}).click();
 await page.locator('[data-char-index]').filter({hasText:'Test character'}).click();await page.getByRole('button',{name:'Close navigation',exact:true}).click();await page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();
 await property(page,'datasetCaption').waitFor();assert.equal(await property(page,'trigger_word').isDisabled(),true);await change(page,'datasetCaption','An owned training image caption');
 assert.equal(await page.locator('#datasetCaption').inputValue(),'An owned training image caption');assert.equal(writes.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});

test('an unavailable source editor leaves the existing saved evidence readable and source fields disabled',async t=>{
 const{page,writes,errors}=await fixture(t,1280,false);await page.locator('[data-char-index]').filter({hasText:'Test character'}).click();await page.locator('#sourceEditStatus').filter({hasText:'Read-only saved evidence'}).waitFor();assert.equal(await property(page,'display_name').isDisabled(),true);assert.equal(await property(page,'datasetCaption').isDisabled(),true);assert.equal(await page.locator('#vers').getByText(/No trained versions yet/).isVisible(),true);assert.equal(writes.length,0);assert.deepEqual(errors,[]);
});
