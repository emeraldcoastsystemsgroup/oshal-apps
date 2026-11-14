/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Use the system temporary folder and register each cleanup as soon as its resource exists, so a failed setup never leaves the employer server open (the gate sets no TMPDIR and the proof hung for 900 s).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Model an unanswered ask timeout and reject unreported pictures at native acceptance.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Count every loopback employer press and verify distinct native permits, reports and retained pictures through the real worker. */
'use strict';
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const queue=require('../../lib/career-submission-queue'),{execute}=require('../../lib/career-browser-worker');
const noise=`<canvas width=1600 height=1000></canvas><script>const c=document.querySelector('canvas'),x=c.getContext('2d'),p=x.createImageData(c.width,c.height);let s=17;for(let i=0;i<p.data.length;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;p.data[i]=i%4===3?255:s>>>24;}x.putImageData(p,0,0);</script>`;
function form(step,kind){
  const question=kind==='question'&&step===2?'<label>Required employer attestation<input required name=attestation></label>':'';
  const label=kind==='saving'?'Continue':kind==='five'||step===1&&!['single','large-single'].includes(kind)?'Continue':'Submit application';
  return `<form onsubmit="event.preventDefault()"><label>Name<input name=full_name required></label><label>Email<input name=email required type=email></label><label>Resume<input type=file name=resume required></label>${question}<label>Stage ${step}<input name=stage_${step}></label><button type=button onclick="press(${step})">${label}</button></form>`;
}
function documentFor(step,kind,opening){
  const body=opening&&step===1?'<button onclick="press(1)">Apply</button>':form(step,kind);
  return `<!doctype html><h1>Disposable employer step ${step}</h1>${body}<script>async function press(step){await fetch('/press?step='+step,{method:'POST',keepalive:true});${kind==='saving'?"document.querySelector('h1').textContent='Saving…'":kind==='redirect'?"location.href='http://localhost:'+location.port+'/other'":"location.href='/step/'+(step+1)"}}</script>`;
}
async function employer(kind,opening){
  const presses=[],shows=[];let applications=0,otherRequests=0,firstCookie;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');res.setHeader('Content-Type','text/html');
    if(url.pathname==='/cookie'){res.setHeader('Set-Cookie','old=earlier-run; Path=/');res.end('Fixture earlier run');return;}
    if(req.headers.host.startsWith('localhost'))otherRequests++;
    if(firstCookie===undefined)firstCookie=req.headers.cookie||'';
    if(url.pathname==='/press'){
      const step=Number(url.searchParams.get('step'));presses.push(step);
      const receipt=kind==='continue-receipt'||kind==='single'||kind==='large-single'||step===2&&['two','large'].includes(kind)||opening&&kind==='two'&&step===2;
      const shown=kind==='saving'?'same-step':kind==='redirect'?'redirect':receipt?'receipt':'next-step';shows.push(shown);
      if(receipt)applications++;res.end('ok');return;
    }
    const step=Number(url.pathname.split('/').at(-1))||1;
    if(applications&&step>presses.at(-1)){res.end('<h1>Thank you for applying</h1>'+(/large/.test(kind)?noise:''));return;}
    res.end(documentFor(step,kind,opening));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {server,origin:'http://127.0.0.1:'+server.address().port,presses,shows,get applications(){return applications;},get otherRequests(){return otherRequests;},get firstCookie(){return firstCookie;}};
}
function packet(dir,origin){
  const resume=Buffer.from('%PDF-1.7\nApproved fixture resume\n%%EOF'),cover=Buffer.from('%PDF-1.7\nApproved fixture cover\n%%EOF');
  const profile={fullName:'Fixture Applicant',email:'fixture@example.test'};
  const item=queue.enqueue(dir,{approved:true,postingId:991,url:origin+'/step/1',resumeSha256:queue.digest(resume),coverSha256:queue.digest(cover),profileSha256:queue.jsonDigest(profile)},{fixtureOrigin:origin}).item;
  const task={...item,version:1,mode:'submit',approved:true,submissionId:item.id,profile,documents:{'Resume_ATS.pdf':resume.toString('base64'),'CoverLetter.pdf':cover.toString('base64')}};
  const bound={version:1,intentId:item.id,origin,maxPresses:4,expiresAt:Date.now()+300000,task};
  return {...bound,requestDigest:queue.jsonDigest(bound)};
}
function stub(input,options,fixture){
  const asks=[],reports=[],permitted=[],rawReports=[];let retained,dropped=false;
  const envelope={id:input.intentId,owner:'fixture',tenant:'fixture',bot:'fixture'},bytes=Buffer.from(JSON.stringify(input));
  const call=async(suffix,body)=>{
    if(suffix.endsWith('/input'))return {version:1,executor:'browser-form-v1',envelope,files:[{path:'browser-task.json',bytes:[...bytes],digest:[...Buffer.from(queue.digest(bytes),'hex')]}],limits:{wall_ms:30000,artifact_bytes:2097152}};
    if(suffix.endsWith('/check'))return {current:true};
    if(suffix.endsWith('/browser-progress')){
      if(body.phase==='reviewing')return {current:true};
      if(body.phase==='press'){
        asks.push(body);assert.equal(body.step,asks.length);assert.equal(body.origin,input.origin);assert.match(body.stepSha256,/^[a-f0-9]{64}$/);assert.ok(body.label.length);
        if(options.refuseAll||options.refuseSecond&&body.step===2){const e=Error('refused');e.reason='browser_press_repeated';throw e;}
        const permit='c1000000-0000-0000-0000-'+String(body.step).padStart(12,'0');permitted.push({body,permit});
        if(options.loseAsk&&body.step===2)await new Promise((_,reject)=>setTimeout(()=>reject(Error('request timed out without an answer')),50));
        return {current:true,phase:'press',step:body.step,of:4,permit};
      }
      assert.equal(body.phase,'pressed');rawReports.push(JSON.stringify(body));
      if(options.loseBothReports)throw Error('report never reached durable storage');
      assert.equal(body.permit,permitted[body.step-1].permit);
      const result={'next-step':'advanced',receipt:'confirmed','same-step':'unknown',redirect:'left_site'}[fixture.shows[body.step-1]];
      assert.equal(body.result,result);assert.match(body.afterSha256,/^[a-f0-9]{64}$/);
      const prior=reports.find(r=>r.step===body.step);if(prior)assert.deepEqual(body,prior);else reports.push(body);
      if(options.loseReport&&!dropped){dropped=true;throw Error('report reply lost');}
      return {current:true,phase:'pressed',step:body.step,result,next:result==='advanced'&&body.step<4&&permitted[body.step-1].body.kind!=='submit'};
    }
    if(suffix.endsWith('/result')){
      for(const artifact of body.artifacts)if(/^press-/.test(artifact.path))assert.ok(reports.some(r=>artifact.path==='press-'+r.step+'.png'),'only acknowledged reports can carry pictures');
      const answer=JSON.parse(body.answer);
      for(const report of reports){const name=report.result==='confirmed'&&answer.outcome==='completed'?'confirmation.png':'press-'+report.step+'.png';const picture=body.artifacts.find(a=>a.path===name);assert.equal(queue.digest(Buffer.from(picture.bytes)),report.afterSha256);}
      if(answer.outcome==='completed')assert.equal(answer.confirmationSha256,reports.at(-1).afterSha256);
      retained=body;return {accepted:true};
    }
    if(suffix.endsWith('/failed'))assert.fail('worker failed instead of publishing a bounded result');
    assert.fail(suffix);
  };
  return {call,envelope,asks,reports,permitted,rawReports,get retained(){return retained;}};
}
async function run(t,browser,kind,options={}){
  // The system's temporary folder, not process.env.TMPDIR: the gate does not set TMPDIR, and an undefined path threw
  // after the employer server had started, leaving it open so the whole proof never exited (gate: no verdict after 900 s).
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'press-proof-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const fixture=await employer(kind,options.opening);
  t.after(()=>new Promise(r=>fixture.server.close(r)));
  const context=await browser.newContext({serviceWorkers:'block'});
  t.after(()=>context.close());
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.fallback():route.abort('blockedbyclient'));
  if(options.cookies){
    const earlier=await context.newPage();await earlier.goto(fixture.origin+'/cookie');await earlier.close();
    assert.ok((await context.cookies()).some(c=>c.name==='old'));
    await context.addCookies([{name:'unrelated',value:'keep',url:'http://localhost:'+fixture.server.address().port}]);
  }
  const input=packet(dir,fixture.origin),native=stub(input,options,fixture);
  const result=await execute(native.call,native.envelope,context,{generation:Array(32).fill(7),root:dir,fixtureOrigin:fixture.origin,timeoutMs:500});
  const output=native.retained,answer=JSON.parse(output.answer);
  for(const report of native.reports){
    const name=report.result==='confirmed'&&answer.outcome==='completed'?'confirmation.png':'press-'+report.step+'.png';
    const picture=output.artifacts.find(a=>a.path===name);assert.ok(picture,'kept '+name);assert.equal(queue.digest(Buffer.from(picture.bytes)),report.afterSha256);
    if(name==='confirmation.png')assert.equal(answer.confirmationSha256,report.afterSha256);
  }
  assert.equal(fixture.presses.length,native.reports.length+(options.loseBothReports?1:0));
  assert.equal(native.permitted.length,fixture.presses.length+(options.loseAsk?1:0));
  assert.ok(new Set(native.asks.map(a=>a.stepSha256)).size===native.asks.length,'no repeated fingerprint');
  assert.ok(output.artifacts.reduce((n,a)=>n+a.bytes.length,0)<=2097152);
  if(options.cookies){assert.equal(fixture.firstCookie,'');assert.ok((await context.cookies()).some(c=>c.name==='unrelated'&&c.value==='keep'));}
  return {fixture,native,result,answer,output};
}
module.exports={run};
