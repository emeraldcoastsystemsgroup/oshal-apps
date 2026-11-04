/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual interview workspace in Chromium: background preparation, exact evidence display, saved practice, stale-guide refusal, safe text and narrow-screen layout.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json')),{chromium}=deps('playwright');
const html=readFileSync(new URL('../../tools/career-interview.html',import.meta.url));
test('interview workspace prepares, practices and retains experience-backed feedback at a narrow viewport',async t=>{
  let record=null,queued=null,stale=false;const calls=[];
  const evidence={id:'r0-deliverables-0',role:{title:'Instructor',org:'Fixture College',start:'2020',end:'2024'},text:'Coached students through introductory Python projects.'};
  const plan={focus:'Prepare to teach introductory Python.',questions:Array.from({length:6},(_,i)=>({id:'q'+(i+1),category:'role',question:'Explain Python concept '+(i+1)+' <script>bad()</script>',why:'This role teaches Python.',approach:['Use a concrete example.'],evidenceIds:[evidence.id]})),evidence:[evidence],askEmployer:['Which student groups will I teach?'],checklist:['Rehearse a teaching demonstration.']};
  const server=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/api/career-hunter/interview/1')){
      res.setHeader('content-type','application/json');
      if(req.method==='POST'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({url:req.url,body});queued={kind:req.url.endsWith('/practice')?'practice':'prepare',body};res.writeHead(202);res.end(JSON.stringify({ok:true,requestId:body.requestId}));return;
      }
      if(queued){const {kind,body}=queued;queued=null;
        if(kind==='prepare')record={version:1,postingId:1,plan,planId:'a'.repeat(32),preparedAt:new Date().toISOString(),job:{title:'Adjunct Instructor',company:'Fixture Employer',url:'https://example.test/job'},practice:[]};
        else{assert.equal(body.planId,record.planId);assert.equal(body.questionId,'q2');record.practice.push({id:'attempt-one',planId:record.planId,questionId:body.questionId,answer:body.answer,at:new Date().toISOString(),feedback:{summary:'Add an observed result.',answerQuote:'I coached a student',strengths:['Names the situation.'],improvements:['Describe how you checked understanding.'],followUp:'What changed for the student?'}});}
        record.operation={ok:true,kind,requestId:body.requestId};
      }
      res.end(JSON.stringify({job:{postingId:1,title:'Adjunct Instructor',company:'Fixture Employer'},record,stale,processing:false}));return;
    }
    if(req.url.startsWith('/shared/')||req.url.includes('/static/')){res.writeHead(200,{'content-type':req.url.endsWith('.js')?'text/javascript':'text/css'});res.end('');return;}
    res.setHeader('content-type','text/html');res.end(html);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  await page.goto('http://127.0.0.1:'+server.address().port+'/interview?postingId=1');
  await page.getByRole('button',{name:'Prepare for this interview',exact:true}).click();
  await page.getByText('Your preparation guide is ready.',{exact:true}).waitFor();
  assert.equal(calls.length,1);assert.equal(await page.locator('#questions button').count(),6);
  await page.locator('#questions button').nth(1).click();await page.getByText('Experience you can draw on',{exact:true}).click();
  assert.equal(await page.locator('#evidence .evidence p').innerText(),evidence.text);
  assert.equal(await page.locator('#question script').count(),0,'model text is never rendered as markup');
  await page.getByLabel('Your practice answer',{exact:true}).fill('I coached a student using a short Python exercise.');
  await page.getByRole('button',{name:'Get feedback and save practice',exact:true}).click();
  await page.getByText('Practice and feedback saved.',{exact:true}).waitFor();
  assert.equal(calls[1].body.answer,'I coached a student using a short Python exercise.');assert.equal(await page.getByText('Add an observed result.',{exact:true}).count(),1);
  await page.reload();await page.locator('#questions button').nth(1).click();assert.equal(await page.getByText('Latest saved feedback',{exact:true}).count(),1);
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width,JSON.stringify(size));
  stale=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Your experience or this job changed. Prepare a fresh guide before practicing.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Get feedback and save practice',exact:true}).isEnabled(),false);assert.equal(calls.length,2);
});
