/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shared properties use the real scale/reconstruction routes and preserve viewport and print freshness on a phone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The first pane is named Objects (navigationLabel, 0.8.5).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.8.7: on a phone, choosing an object closes the Objects sheet by itself (the trial check, 2026-11-06), so the proof waits for that instead of pressing Close navigation.
 */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import{resolve}from'node:path';
import fixtureModule from './routes-core.fixture.js';
const{startFixture,readyJob,coreRequire}=fixtureModule;const{chromium}=coreRequire('playwright');let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});});after(async()=>{await browser?.close();});
async function openWorkspace(t,width=1280){
 const fixture=await startFixture(),job=await readyJob(fixture),context=await browser.newContext({viewport:{width,height:915}});
 t.after(async()=>{await context.close();await fixture.close();});const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.goto(fixture.base+'/app');await page.locator('.ef-shell').waitFor();
 if(width<800)await page.locator('.ef-tools').getByRole('button',{name:'Objects',exact:true}).click();
 await page.locator('.job-item').filter({hasText:'Synthetic box'}).click();
 if(width<800){await page.waitForFunction(()=>document.querySelector('.ef-editor').dataset.editorPanel==='');await page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();}
 await page.locator('[data-editor-property="dim-x"]').waitFor();return{page,fixture,job,errors};
}
async function saveReviewScreens(page,name){const dir=process.env.EDITOR_FOUNDATION_SCREENSHOT_DIR;if(!dir)return;const{mkdir}=await import('node:fs/promises');await mkdir(dir,{recursive:true});await page.screenshot({path:resolve(dir,name+'-desktop.png'),fullPage:true});await page.setViewportSize({width:412,height:915});await page.evaluate(()=>new Promise(requestAnimationFrame));const close=page.getByRole('button',{name:'Close inspector',exact:true});if(!await close.isVisible())await page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();await page.screenshot({path:resolve(dir,name+'-phone-properties.png'),fullPage:true});if(await close.isVisible())await close.click();await page.screenshot({path:resolve(dir,name+'-phone-document.png'),fullPage:true});}

test('shared measurements save through the owned object route and retire obsolete outputs',async t=>{
 const{page,fixture,job,errors}=await openWorkspace(t);const width=page.locator('[data-editor-property="dim-x"]');await width.fill('80');await width.press('Tab');
 assert.equal(await page.locator('#dim-x').inputValue(),'80');assert.equal(await page.locator('.downloads a').count(),0);
 await page.locator('#save-dims').click();await page.waitForFunction(()=>document.getElementById('job-state').textContent.includes('capturing'));
 const saved=(await fixture.call('/jobs/'+job.id)).body.job;assert.equal(saved.known_dimensions.find(value=>value.axis==='x').mm,80);assert.equal(fixture.fetchCalls.length,0);assert.deepEqual(errors,[]);
});
test('phone properties update the same object and reconstructed media stays available in the viewport',async t=>{
 const{page,fixture,job,errors}=await openWorkspace(t,412);const width=page.locator('[data-editor-property="dim-x"]');await width.fill('90');await width.press('Tab');await page.locator('#save-dims').click();
 await page.waitForFunction(()=>document.getElementById('job-state').textContent.includes('capturing'));await page.locator('#reconstruct').click();await page.locator('.downloads a').filter({hasText:'STL'}).waitFor({state:'attached'});
 await page.getByRole('button',{name:'Close inspector',exact:true}).click();assert.equal(await page.locator('#viewer').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal((await fixture.call('/jobs/'+job.id)).body.job.report.sizeMm.x,90);assert.equal(fixture.fetchCalls.length,0);assert.deepEqual(errors,[]);await page.setViewportSize({width:1280,height:915});await saveReviewScreens(page,'scan-to-print');
});
