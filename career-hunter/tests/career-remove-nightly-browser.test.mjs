/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Cross the actual Saved button, compiled owner writer, nightly launcher and fresh match SQL to prove removal never reoffers the job.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {volumeFixture} from './helpers/career-volume-fixture.mjs';
import {playwright} from './helpers/ux-page.mjs';
const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
async function openSaved(browser,f){
 const context=await browser.newContext();
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());assert.equal(url.origin,'http://removal.fixture.test','no employer or kernel request is allowed');
  if(url.pathname==='/screen')return route.fulfill({contentType:'text/html',body:readFileSync(new URL('../tools/career-job-lists.html',import.meta.url),'utf8')});
  if(url.pathname.startsWith('/api/career-hunter/static/')){const file=url.pathname.split('/').at(-1);return route.fulfill({contentType:file.endsWith('.css')?'text/css':'application/javascript',body:readFileSync(new URL('../tools/'+file,import.meta.url),'utf8')});}
  if(url.pathname.startsWith('/shared/')||url.pathname.startsWith('/cockpit/'))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'application/javascript',body:''});
  const path=url.pathname.replace('/api/career-hunter','');let body;try{body=request.postDataJSON();}catch{}
  const real=/^\/jobs(?:$|\/(?:stats|3001(?:\/status)?))/.test(path);
  const out=real?await f.call(request.method(),path+url.search,body):{status:200,json:path==='/resume/state'?{hasResume:true,roles:3}:path==='/applications'?{applications:[]}:url.pathname==='/api/auth/user'?{authenticated:true,tenant:'fiction',principal_id:'fictional-person'}:{}};
  return route.fulfill({status:out.status,contentType:'application/json',body:JSON.stringify(out.json)});
 });
 const page=await context.newPage();page.setDefaultTimeout(8000);await page.goto('http://removal.fixture.test/screen');
 return {page,context};
}
function nightly(f){
 const source=readFileSync(new URL('../bin/oshal-jobhunter.js',import.meta.url),'utf8'),start=source.indexOf('function corpusRuns('),end=source.indexOf('\n/**',start);
 const code=vm.runInNewContext(source.slice(start,end)+';corpusRuns("score-titles",[])')[0][1];
 const out=spawnSync(process.env.CAREER_PYTHON||'python3',['-c','import sys\nfrom jobhunter import score\nscore.score_batch=lambda **kw:(0,0)\nexec(sys.stdin.read())'],{input:code,encoding:'utf8',timeout:30000,env:{...process.env,
  PYTHONPATH:new URL('../engine',import.meta.url).pathname,JOBHUNTER_STORE:'sqlite',JOBHUNTER_MULTIUSER:'1',
  JOBHUNTER_DATA:f.paths.userDir,JOBHUNTER_USER_DB:f.paths.userDb,JOBHUNTER_CORPUS_DB:f.paths.corpusDb,
  JOBHUNTER_CAREER_DB:f.paths.userDir+'/fictional-profile-absent.json',OSHAL_USER_SUB:'fictional-volume-person',
  CH_NIGHTLY_MATCH:'1',CH_TITLES:'invented',CH_LIMIT:'50',CH_FRESH_DAYS:'7'}});
 assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/"result": "complete"/);
}
test('Saved removal remains absent after the actual nightly pass and a fresh match read',async()=>{
 const f=volumeFixture(),browser=await playwright().chromium.launch({headless:true});let screen;
 try{
  const owner=new Database(f.paths.userDb);try{owner.prepare('UPDATE user_signals SET ai_fit_score=100 WHERE posting_id=3001').run();}finally{owner.close();}
  assert.equal((await f.call('POST','/jobs/3001/status',{favorite:true})).status,200);
  screen=await openSaved(browser,f);const row=screen.page.locator('.job-row[data-job-id="3001"]');await row.waitFor();
  const response=screen.page.waitForResponse(r=>r.url().endsWith('/jobs/3001/status')&&r.request().method()==='POST');
  await row.getByRole('button',{name:/^(Remove|Unsave)$/}).click();assert.equal((await response).status(),200);
  nightly(f);
  const matches=await f.call('GET','/jobs?matches=1&lane=all&min_score=100&per=25');assert.equal(matches.status,200);
  assert.deepEqual(matches.json.jobs.map(job=>job.id),[],'the original Unsave flow reoffers this same posting after the night');
  assert.equal((await f.call('GET','/jobs/3001')).json.job.status,'dismissed');
 }finally{await screen?.context.close();await browser.close();f.close();}
});
