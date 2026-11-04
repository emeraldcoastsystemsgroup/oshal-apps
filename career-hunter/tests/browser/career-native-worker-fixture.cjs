/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped worker against isolated native HTTP and an owned TLS employer fixture through an exact-host loopback tunnel, verifying complete multipart PDF bytes and real Chromium evidence without contacting an employer.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),http=require('node:http'),net=require('node:net');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const worker=require('../../lib/career-browser-worker');
async function run(settings){
  const deps=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN,'package.json')),{chromium}=deps('playwright');
  const root=fs.mkdtempSync(path.join(settings.workDir,'../employer-tls-')),key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=jobs.example.com'],{stdio:'ignore'});
  const sockets=new Set();let posts=0,badBody=false,lastStage='start',captured,browser;
  const employer=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},async(req,res)=>{
    res.setHeader('content-type','text/html');
    if(req.method==='POST'){
      posts++;let body='';for await(const chunk of req)body+=chunk.toString('binary');
      const documents=settings.approvedDocuments
        ?Object.values(settings.approvedDocuments).map(value=>Buffer.from(value,'base64').toString('binary'))
        :['Approved native resume','Approved native cover'];
      badBody=['Fixture','Applicant','fixture@example.test','Resume_ATS.pdf','CoverLetter.pdf',...documents].some(v=>!body.includes(v));
      res.end(badBody?'<h1>Fixture rejected the multipart data</h1>':'<h1>Thank you for applying</h1><p>Your application has been received.</p>');return;
    }
    res.end(`<!doctype html><h1>Disposable native employer form</h1>
      <form method="POST" action="/accepted" enctype="multipart/form-data">
      <label>First name<input name="first_name" required></label><label>Last name<input name="last_name" required></label>
      <label>Email address<input name="email" type="email" required></label>
      <label>Resume<input name="resume" type="file" required></label><label>Cover letter<input name="cover_letter" type="file" required></label>
      <button type="submit">Submit application</button></form>`);
  });
  const tunnel=http.createServer((_req,res)=>{res.writeHead(403);res.end();});
  const track=socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});};
  tunnel.on('connect',(req,socket,head)=>{
    track(socket);if(req.url!=='jobs.example.com:443'){socket.destroy();return;}
    const upstream=net.connect(employer.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
    track(upstream);socket.once('close',()=>upstream.destroy());upstream.once('error',()=>socket.destroy());
  });
  try{
    await new Promise(resolve=>employer.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>tunnel.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:'+tunnel.address().port}});
    const context=await browser.newContext({serviceWorkers:'block',ignoreHTTPSErrors:true});
    const transport=worker.client(settings),call=async(suffix,body)=>{lastStage=suffix.split('/').at(-1);if(lastStage==='result')captured=JSON.parse(body.answer).data;return transport(suffix,body);};
    const result=await worker.execute(call,settings.envelope,context,{generation:settings.generation,root:settings.workDir});
    if(result.status!=='submitted'||posts!==1||badBody)throw Error('fixture_submission_not_confirmed');
    return {status:result.status,posts,actions:result.actions,screenshots:result.screenshots};
  }catch(error){process.stderr.write(JSON.stringify({stage:lastStage,code:error.message,fixtureResult:captured})+'\n');throw error;}
  finally{await browser?.close();for(const socket of sockets)socket.destroy();employer.closeAllConnections();tunnel.closeAllConnections();
    await Promise.all([new Promise(resolve=>employer.close(resolve)),new Promise(resolve=>tunnel.close(resolve))]);fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8')))
  .then(result=>process.stdout.write(JSON.stringify(result)+'\n'))
  .catch(()=>{process.stderr.write('native_browser_fixture_failed\n');process.exitCode=1;});
