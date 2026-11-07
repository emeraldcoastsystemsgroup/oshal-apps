/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise new-character properties and dataset source controls in the real shared editor without starting training.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: the studio opens on New character step 1 with Create character as its one primary and the other fields under a closed Advanced, Properties never repeats the creation form, the inline Concierge column is gone, the phone opens on the character list with one + New character, the stepper shows one step at a time, and Train/Validate/Improve/Overnight are withheld unless GET /worker reports a GPU worker. The creation case fills the form itself (Properties no longer carries it) and its Subject slug is made from the Name.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The opens-ready case also proves no saved-source controls (Reload saved source) show before a character is chosen; red on the first stepper commit, where the list painted before the shared editor mounted that panel.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | + New character carries data-ef-floating, so the shell orb rests above it on a phone.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),core=process.env.OSHAL_CORE_ROOT,platform=process.env.OSHAL_PLATFORM_ROOT;assert.ok(core&&platform,'Matching core and platform roots required.');
const requireCore=createRequire(resolve(core,'package.json')),express=requireCore('express'),{chromium}=requireCore('playwright');let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>{await browser?.close();});
async function fixture(t,width=1280,metadata=true,worker=null){
 const app=express(),writes=[],character={subject:'test-character',display_name:'Test character',trigger_word:'testcharacter',hero_image:'hero.png',ident_prompt:'A blue test character',storage_key:'owned-test'};
 app.use(express.json());app.get('/api/lora/ui',(_req,res)=>res.sendFile(resolve(root,'tools/lora.html')));
 app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
 app.get('/api/lora/characters/:subject/editor',(req,res)=>metadata?res.json({subject:req.params.subject,characterId:'11111111-1111-4111-8111-111111111111',displayName:character.display_name,revision:0,canConfigure:true,canExecute:false}):res.status(403).json({error:'Fixture source editor unavailable; saved evidence remains readable.'}));
 app.get('/api/lora/characters',(_req,res)=>res.json({characters:[character]}));app.get('/api/lora/models',(_req,res)=>res.json({models:[]}));app.get('/api/lora/dataset',(_req,res)=>res.json({images:[]}));
 if(worker!==null)app.get('/api/lora/worker',(_req,res)=>res.json({gpuWorker:worker}));
 app.post('/api/lora/characters',(req,res)=>{writes.push(req.body);res.json({subject:character.subject,message:'Fixture character saved; no training.'});});
 app.use((_req,res)=>res.status(404).json({error:'outside_fixture'}));const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const context=await browser.newContext(width<800?{viewport:{width,height:915},isMobile:true,hasTouch:true}:{viewport:{width,height:900}});t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/api/lora/ui');await page.locator('.ef-shell').waitFor();return{page,writes,errors};
}
const property=(page,key)=>page.locator('[data-editor-property="'+key+'"]');
async function change(page,key,value){await property(page,key).fill(value);await property(page,key).press('Tab');}
test('typed creation fields feed the existing Create character command and never start training',async t=>{
 const{page,writes,errors}=await fixture(t);const form=page.locator('#characterForm');
 await form.locator('[name=displayName]').fill('New character');await form.locator('[name=identPrompt]').fill('A green new character');
 await form.getByRole('button',{name:'Create character',exact:true}).click();await page.locator('#createResult').filter({hasText:'Fill in Hero image'}).waitFor();
 assert.equal(await page.locator('#characterAdvanced').evaluate(node=>node.open),true,'a missing Hero image opens Advanced');assert.equal(writes.length,0);
 await form.locator('[name=heroImage]').fill('hero-new.png');await form.getByRole('button',{name:'Create character',exact:true}).click();await page.locator('#result').filter({hasText:/saved/i}).waitFor();
 assert.equal(writes.length,1);assert.equal(writes[0].subject,'new-character','a blank Subject slug is made from the Name');assert.equal(writes[0].identPrompt,'A green new character');
 assert.equal(await page.locator('[data-step="dataset"]').getAttribute('aria-current'),'step','a created character continues at 2 Dataset');assert.deepEqual(errors,[]);
});
test('the studio opens ready on New character step 1 with no duplicate form and no inline concierge',async t=>{
 const{page,errors}=await fixture(t);await page.locator('[data-char-index]').first().waitFor();const form=page.locator('#characterForm');
 assert.equal(await form.isVisible(),true);assert.equal(await page.locator('#newCharacterTitle').textContent(),'New character');
 for(const name of ['displayName','triggerWord','identPrompt'])assert.equal(await form.locator('[name='+name+']').isVisible(),true,name+' is on step 1');
 assert.equal(await page.locator('#characterAdvanced').evaluate(node=>node.open),false,'Advanced starts closed');
 for(const name of ['subject','heroImage','negativePrompt','identityStructure','identityViolation','baseModel'])assert.equal(await page.locator('#characterAdvanced [name='+name+']').count(),1,name+' is under Advanced');
 assert.equal(await page.locator('.ef-inspector [data-editor-property]').count(),0,'Properties does not repeat the creation form');assert.equal(await page.locator('#sourceEditPanel').isVisible(),false,'no saved-source controls before a character is chosen');
 assert.equal(await page.locator('.ef-concierge').count(),0,'no inline Concierge column');assert.equal(await page.locator('.ef-tools').getByRole('button',{name:'Concierge',exact:true}).count(),0,'no Concierge pane button');
 assert.equal(await page.locator('[data-step="identity"]').getAttribute('aria-current'),'step');for(const step of ['dataset','train','scorecards'])assert.equal(await page.locator('[data-step="'+step+'"]').isDisabled(),true,step+' waits for a character');
 assert.equal(await page.getByText('Select a character',{exact:false}).isVisible(),false);assert.equal(await page.locator('#characterForm label').filter({hasText:/on the worker|UTF-8|GPU worker/}).count(),0,'no worker jargon or byte limits in the labels');assert.deepEqual(errors,[]);
});
test('a phone opens on the character list with one New character, and a tap opens the character',async t=>{
 const{page,writes,errors}=await fixture(t,412);const row=page.locator('[data-home-index]').filter({hasText:'Test character'});await row.waitFor();
 assert.match(await row.textContent(),/0 versions · best score/);assert.equal(await page.locator('#characterForm').isVisible(),false);
 const fab=page.locator('#newCharacterFab');assert.equal(await fab.isVisible(),true);assert.equal(await fab.getAttribute('data-ef-floating'),'','+ New character is marked as the floating control the orb rests above');const box=await fab.boundingBox(),view=page.viewportSize();assert.ok(box.x+box.width>view.width-40&&box.y>view.height/2,'+ New character sits at the bottom right');
 await row.tap();await page.locator('#loraSteps').waitFor();assert.equal(await page.locator('[data-step="dataset"]').getAttribute('aria-current'),'step');assert.equal(await page.locator('#phoneHome').isVisible(),false);
 await page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();await property(page,'datasetCaption').waitFor();assert.equal(await property(page,'trigger_word').isDisabled(),true);
 await change(page,'datasetCaption','An owned training image caption');assert.equal(await page.locator('#datasetCaption').inputValue(),'An owned training image caption');
 await page.getByRole('button',{name:'Close inspector',exact:true}).click();await page.locator('.ef-tools').getByRole('button',{name:'Characters',exact:true}).click();await page.locator('#newCharacterBtn').click();
 await page.locator('#characterForm').waitFor();assert.equal(await page.locator('[data-step="identity"]').getAttribute('aria-current'),'step');
 assert.equal(writes.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});
test('Train, Validate, Improve and Overnight are withheld without a GPU worker and offered with one',async t=>{
 for(const worker of [false,null,true]){
  const{page,writes,errors}=await fixture(t,1440,true,worker);await page.locator('[data-char-index]').filter({hasText:'Test character'}).click();await page.locator('[data-step="train"]').click();
  await page.locator('#vers').getByText(/No trained versions yet/).waitFor();const shown=worker===true;
  for(const id of ['trainBtn','valBtn','impBtn','overnightBtn','autoTog'])assert.equal(await page.locator('#'+id).isVisible(),shown,id+(shown?' offered':' withheld')+' with worker='+worker);
  assert.equal(await page.locator('#'+'trainBtn').count(),1,'withheld, not deleted');assert.equal(writes.length,0);assert.deepEqual(errors,[]);
 }
});

test('an unavailable source editor leaves the existing saved evidence readable and source fields disabled',async t=>{
 const{page,writes,errors}=await fixture(t,1280,false);await page.locator('[data-char-index]').filter({hasText:'Test character'}).click();await page.locator('#sourceEditStatus').filter({hasText:'Read-only saved evidence'}).waitFor();assert.equal(await property(page,'display_name').isDisabled(),true);assert.equal(await property(page,'datasetCaption').isDisabled(),true);await page.locator('[data-step="train"]').click();assert.equal(await page.locator('#vers').getByText(/No trained versions yet/).isVisible(),true);assert.equal(writes.length,0);assert.deepEqual(errors,[]);
});
