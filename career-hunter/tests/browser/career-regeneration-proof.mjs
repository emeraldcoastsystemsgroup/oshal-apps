/** Exercise retry, retained inputs, one inert document viewer, and submitted-packet protection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,startFixture}from './career-theme-fixture.mjs';

test('regeneration retries in place and a retained panel follows submitted status',async t=>{
 const job={id:81,title:'Owned automation engineer',company:'Owned employer',status:'generated',favorite:true,has_resume:true,has_cover:true,generated_at:'2026-10-28T20:00:00Z',board:{phase:'failed',error:'preparation_failed',completedAt:'old'}};
 const fixture=await startFixture(),browser=await chromium.launch({headless:true}),context=await browser.newContext();
 t.after(async()=>{await context.close();await browser.close();await fixture.close();});
 let pending=null,revision=1,previewFailed=false;const generations=[],scriptWarnings=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==fixture.origin)return route.abort();
  const answer=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/api/career-hunter/jobs')return answer({jobs:[job],per:50,exhausted:true});
  if(url.pathname==='/api/career-hunter/jobs/81/generate'){
   pending=req.postDataJSON();generations.push(pending);job.board={phase:'generating',requestId:pending.requestId};
   return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({ok:true,requestId:pending.requestId})});
  }
  if(url.pathname==='/api/career-hunter/jobs/81'){
   if(pending){job.board={requestId:pending.requestId,completedAt:'done',phase:generations.length===1?'failed':'ready',error:generations.length===1?'preparation_failed':null};pending=null;if(generations.length===2){revision=2;job.generated_at='2026-10-28T21:00:00Z';}}
   return answer({job});
  }
  if(url.pathname==='/api/career-hunter/jobs/81/status'){const body=req.postDataJSON();if(body.correction==='undo-manual-submission'){job.status='generated';job.application_source=null;job.board={phase:'ready'};return answer({ok:true,status:'generated'});}Object.assign(job,body,{application_source:'manual-mark'});return answer({ok:true});}
  if(url.pathname==='/api/career-hunter/resume/doc')return answer({meta:{}});
  if(url.pathname==='/api/career-hunter/resume'&&url.searchParams.get('as')==='html'){
   if(previewFailed)return route.fulfill({status:503,body:'Owned preview outage'});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'"></head><body onload="throw Error('unexpected event')"><h1>${url.searchParams.get('kind')} revision ${revision}</h1><script>throw Error('unexpected proxy script')</script></body></html>`});
  }
  return route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(7000);page.on('console',message=>{if(/Blocked script execution|unexpected proxy script|unexpected event/.test(message.text()))scriptWarnings.push(message.text());});
 await page.goto(fixture.origin+'/api/career-hunter/board-native?view=queue');
 const regenerate=page.getByRole('button',{name:'Regenerate résumé & cover letter',exact:true});await regenerate.waitFor({state:'visible'});assert.equal(await page.locator('.customization-options').getAttribute('open'),null);
 await page.frameLocator('.rzbox iframe').getByText('resume revision 1',{exact:true}).waitFor();assert.equal(await page.locator('.rzbox iframe').getAttribute('sandbox'),'');assert.equal(await page.frameLocator('.rzbox iframe').locator('script').count(),0);assert.equal(await page.frameLocator('.rzbox iframe').locator('meta[http-equiv="Content-Security-Policy"]').count(),1);
 await page.getByRole('tab',{name:'Cover letter',exact:true}).click();await page.frameLocator('.rzbox iframe').getByText('cover revision 1',{exact:true}).waitFor();assert.match(await page.getByRole('link',{name:'Download PDF ↓',exact:true}).getAttribute('href'),/kind=cover/);
 await page.getByText('Tailoring & additional experience',{exact:true}).click();await page.getByLabel('Customization for this application').fill('Keep my recorded automation experience.');await regenerate.click();
 await page.locator('[data-packet-state]').filter({hasText:'Generating your résumé'}).waitFor();assert.equal(await page.locator('[data-generate-job]').isDisabled(),true);
 await page.locator('[data-packet-state]').filter({hasText:'Document generation failed'}).waitFor();assert.equal(await regenerate.isEnabled(),true);assert.equal(await page.locator('[data-preparation-error]:visible').count(),0);assert.equal(await page.getByRole('link',{name:'Download PDF ↓',exact:true}).count(),1);
 await regenerate.click();await page.frameLocator('.rzbox iframe').getByText('cover revision 2',{exact:true}).waitFor();assert.equal(await page.getByLabel('Customization for this application').inputValue(),'Keep my recorded automation experience.');assert.ok(generations.every(request=>request.guidance==='Keep my recorded automation experience.'));assert.notEqual(generations[0].requestId,generations[1].requestId);assert.doesNotMatch(await page.locator('[data-packet-state]').innerText(),/failed/);
 assert.equal(await page.getByRole('link',{name:'Download PDF ↓',exact:true}).count(),1);assert.equal(await page.getByRole('link',{name:'Edit documents',exact:true}).count(),1);assert.equal(await page.getByRole('link',{name:/View resume|View cover|exact PDF/}).count(),0);
 await page.getByText('Already applied elsewhere?',{exact:true}).click();await page.getByRole('button',{name:'Record submitted application',exact:true}).click();await page.locator('[data-packet-state]').filter({hasText:'Submitted application'}).waitFor();assert.equal(await regenerate.isVisible(),false);assert.equal(await page.getByRole('link',{name:'Edit documents',exact:true}).isVisible(),false);assert.equal(await page.getByRole('button',{name:'Review and submit application',exact:true}).isVisible(),false);assert.equal(generations.length,2);
 await page.getByRole('button',{name:'View submitted documents',exact:true}).click();await page.getByRole('button',{name:'View submitted documents',exact:true}).click();await page.locator('[data-packet-state]').filter({hasText:'Submitted application'}).waitFor();assert.equal(await regenerate.isVisible(),false);
 previewFailed=true;await page.getByRole('tab',{name:'Résumé',exact:true}).click();await page.getByText('Preview unavailable. Use Download PDF above to open this document.',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Download PDF ↓',exact:true}).count(),1);assert.match(await page.getByRole('link',{name:'Download PDF ↓',exact:true}).getAttribute('href'),/kind=resume/);assert.deepEqual(scriptWarnings,[]);
 await page.getByRole('button',{name:'Return to preparation',exact:true}).click();await page.getByRole('heading',{name:'Submission queue',exact:true}).waitFor();await regenerate.waitFor({state:'visible'});assert.equal(job.status,'generated');assert.equal(generations.length,2,'correcting status does not generate or submit anything');
});
