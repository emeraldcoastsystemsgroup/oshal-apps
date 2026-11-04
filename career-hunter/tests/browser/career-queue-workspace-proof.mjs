/** A queued job has one focused workspace; changing jobs retains unsent application drafts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,startFixture} from './career-theme-fixture.mjs';

test('queue selection retains drafts, survives refresh, and fits a phone without horizontal scrolling',async t=>{
 const jobs=[{id:91,title:'Python engineer',company:'First employer',status:'promoted',favorite:true},
  {id:92,title:'Adjunct instructor',company:'Second employer',status:'generated',favorite:true,has_resume:true,has_cover:true,generated_at:'2026-10-28T20:00:00Z'}];
 const fixture=await startFixture(),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1280,height:900}});
 t.after(async()=>{await context.close();await browser.close();await fixture.close();});
 const errors=[],writes=[];
 await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==fixture.origin)return route.abort();if(req.method()!=='GET'){writes.push(url.pathname);return route.abort();}
  const answer=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname.endsWith('/jobs'))return answer({jobs:url.searchParams.get('q')==='instructor'?jobs.slice(1):jobs,per:50,exhausted:true});
  const id=url.pathname.match(/\/jobs\/(91|92)$/)?.[1];if(id)return answer({job:jobs.find(j=>j.id===Number(id))});
  if(url.pathname.endsWith('/experience-bank'))return answer({revision:'owned',entries:[{id:'project',title:'Independent product work'}]});
  if(url.pathname.endsWith('/resume')&&url.searchParams.get('as')==='html')return route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Owned application document</h1>'});
  return route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture.origin+'/api/career-hunter/board-native?view=queue');
 await page.getByRole('button',{name:'Generate résumé & cover letter',exact:true}).waitFor();
 assert.equal(await page.locator('#list>.card:visible').count(),1);assert.equal(await page.locator('#tabs').isVisible(),false);
 const before=await page.locator('#queueNavigator').boundingBox(),workspace=await page.locator('#list').boundingBox();assert.ok(before.x+before.width<workspace.x,'selector sits beside the preparation workspace');assert.ok(Math.abs(before.y-workspace.y)<2,'selector aligns with the top of the selected application');
 await page.locator('.queue-selected').getByLabel('Customization for this application').fill('Emphasize platform development.');await page.getByRole('checkbox',{name:'Independent product work'}).check();
 await page.getByText('Fit assessment and customization notes',{exact:true}).click();await page.locator('.queue-selected').getByLabel('Talk through this application').fill('Keep this unsent question.');
 await page.locator('[data-queue-job="92"]').click();await page.getByRole('button',{name:'Regenerate résumé & cover letter',exact:true}).waitFor();
 assert.equal(await page.locator('#list>.card:visible').count(),1);assert.equal(await page.getByRole('link',{name:'Download PDF ↓',exact:true}).count(),1);
 await page.locator('[data-queue-job="91"]').click();assert.equal(await page.locator('.queue-selected').getByLabel('Customization for this application').inputValue(),'Emphasize platform development.');assert.equal(await page.getByRole('checkbox',{name:'Independent product work'}).isChecked(),true);assert.equal(await page.locator('.queue-selected').getByLabel('Talk through this application').inputValue(),'Keep this unsent question.');
 await page.getByRole('searchbox').fill('instructor');await page.getByRole('button',{name:'Search queue',exact:true}).click();await page.locator('#list>.card[data-job-id="91"]').waitFor({state:'detached'});
 await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'Search queue',exact:true}).click();await page.locator('[data-queue-job="91"]').click();await page.getByRole('button',{name:'Generate résumé & cover letter',exact:true}).waitFor();assert.equal(await page.locator('.queue-selected').getByLabel('Customization for this application').inputValue(),'Emphasize platform development.');assert.equal(await page.getByRole('checkbox',{name:'Independent product work'}).isChecked(),true);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-queue-job="92"]').click();await page.getByRole('button',{name:'Regenerate résumé & cover letter',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#list>.card:visible').count(),1);
 const mobile=await page.locator('#list').boundingBox();assert.ok(mobile.y>=-1&&mobile.y<100,'selecting a job brings its workspace into view on a phone');
 assert.deepEqual(writes,[],'selecting and reviewing sends no applications or generation requests');assert.deepEqual(errors,[]);
});
