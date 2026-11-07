/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the actual rendered Vids surface keeps source drafts on refusal and distinguishes unavailable rendered exports.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.6.5: verify single brief form (#prompt without duplicate Properties), withheld #go with Help disclosure when worker is offline, and retained brief on online worker refusal.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),core=process.env.OSHAL_CORE_ROOT,platform=process.env.OSHAL_PLATFORM_ROOT;assert.ok(core&&platform,'Matching core and platform roots required.');
const requireCore=createRequire(resolve(core,'package.json')),express=requireCore('express'),{chromium}=requireCore('playwright');
const source=readFileSync(resolve(root,'routes/vids-routes.js'),'utf8').match(/`(<!doctype html>[\s\S]*?<\/html>)`/i)[1],html=new Function('return `'+source+'`;')();let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>{await browser?.close();});
async function fixture(t,{width=1280,worker='online',finished=false,exported=false}={}){
 const app=express(),writes=[],job={job_id:'11111111-1111-4111-8111-111111111111',idea:'A recorded rendered clip',status:'done',orientation:'Landscape',created_at:new Date().toISOString()};
 app.use(express.json());app.get('/api/vids/app',(_req,res)=>res.type('html').send(html));app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
 app.get('/api/vids/jobs',(_req,res)=>res.json({workers:[{name:'Fixture worker',status:worker}],jobs:finished?[job]:[]}));
 app.get('/api/vids/jobs/:job/artifact',(_req,res)=>res.json(exported?{artifact:{previewUrl:'/api/vids/jobs/'+job.job_id+'/artifact/video.mp4',publicUrl:null},attach:{available:true}}:{artifact:null,attach:{available:false,detail:'No finished export is attached.'}}));
 app.get('/api/vids/jobs/:job/artifact/video.mp4',(_req,res)=>res.type('video/mp4').sendFile(resolve(root,'tests/fixtures/source-preview.mp4')));
 app.post('/api/vids/jobs',(req,res)=>{writes.push(req.body);res.status(503).json({error:'Fixture worker unavailable. Your brief is unchanged.'});});
 app.use((_req,res)=>res.status(404).json({error:'outside_fixture'}));const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const context=await browser.newContext({viewport:{width,height:915}});t.after(async()=>{await context.close();server.closeAllConnections();await new Promise(done=>server.close(done));});const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/api/vids/app');await page.locator('.ef-shell').waitFor();return{page,writes,errors};
}
async function saveReviewScreens(page,name){const dir=process.env.EDITOR_FOUNDATION_SCREENSHOT_DIR;if(!dir)return;const{mkdir}=await import('node:fs/promises');await mkdir(dir,{recursive:true});await page.screenshot({path:resolve(dir,name+'-desktop.png'),fullPage:true});await page.setViewportSize({width:412,height:915});await page.evaluate(()=>new Promise(requestAnimationFrame));await page.screenshot({path:resolve(dir,name+'-phone-document.png'),fullPage:true});}

test('single brief form feeds dispatch when worker is online and a refused generation retains the complete brief',async t=>{
 const{page,writes,errors}=await fixture(t);await page.locator('#go').waitFor({state:'visible'});
 assert.equal(await page.locator('[data-editor-property="prompt"]').count(),0);
 const prompt=page.locator('#prompt');await prompt.fill('Keep this source brief');await prompt.press('Tab');
 assert.equal(await page.locator('#prompt').inputValue(),'Keep this source brief');await page.locator('#go').click();await page.locator('#vidsStatus').filter({hasText:/Fixture worker unavailable/}).waitFor();
 assert.equal(writes.length,1);assert.equal(writes[0].prompt,'Keep this source brief');assert.equal(await page.locator('#prompt').inputValue(),'Keep this source brief');assert.deepEqual(errors,[]);
});
test('an offline worker withholds Generate clip, puts setup in Help, and offers no fake editing on unavailable exports',async t=>{
 const{page,writes,errors}=await fixture(t,{width:412,worker:'offline',finished:true});await page.locator('#wtxt').filter({hasText:'no worker registered'}).waitFor();assert.equal(await page.locator('#go').isVisible(),false);assert.equal(await page.locator('#workerHelp').isVisible(),true);
 await page.locator('.ef-tools').getByRole('button',{name:'Navigation',exact:true}).click();await page.locator('[data-select-job]').click();await page.getByRole('button',{name:'Close navigation',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Edit or send clip…',exact:true}).count(),0);assert.match(await page.locator('#selectedPreview').textContent(),/no private finished export/i);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(writes.length,0);assert.deepEqual(errors,[]);
});

test('a real rendered MP4 plays as immutable evidence with an explicit clip editing handoff',async t=>{
 const{page,writes,errors}=await fixture(t,{finished:true,exported:true});const video=page.getByLabel('Selected rendered video',{exact:true});await video.waitFor();await video.evaluate(async video=>{video.muted=true;await video.play();});await page.waitForFunction(()=>{const video=document.querySelector('video[aria-label="Selected rendered video"]');return video&&video.readyState>=2&&video.videoWidth===320;});await video.evaluate(video=>{video.pause();video.dataset.retainedProof='yes';});await page.locator('[data-select-job]').first().click();assert.equal(await video.getAttribute('data-retained-proof'),'yes');assert.equal(await video.evaluate(video=>video.duration),1);assert.equal(await page.getByRole('button',{name:'Edit or send clip…',exact:true}).isEnabled(),true);assert.equal(writes.length,0);assert.deepEqual(errors,[]);await saveReviewScreens(page,'vids');
});
