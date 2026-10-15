/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose real native runner replies to owned browser fixtures without replacing application routes, SQL or original-principal intents.
 */
import {createServer} from 'node:http';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';
export async function startBundleHttpFixture(){
 const native=await startNativeSqlFixture(),requests=[],prefix='/api/motion-studio';
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://fixture.invalid');if(!url.pathname.startsWith(prefix+'/')){res.writeHead(404);res.end();return;}
   const pieces=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024+65536)throw new Error('fixture_input_bound');pieces.push(chunk);}
   const bytes=Buffer.concat(pieces),type=req.headers['content-type']||'',binary=!!bytes.length&&!type.startsWith('application/json');
   let body=bytes.length?binary?bytes.toString('base64'):JSON.parse(bytes.toString('utf8')):{};
   const path=url.pathname.slice(prefix.length),actor=req.headers['x-fixture-user']||'alice';requests.push({method:req.method,path,actor,bytes:size});
   // Named assignments and source admission are controlled seams; SDK/SQL/HTTP codecs and
   // original auth.caller are genuine. This proxy is not installed hosted acceptance.
   const result=await native.call(path,{actor,method:req.method,body,headers:req.headers,bodyEncoding:binary?'base64':'json'});
   res.statusCode=result.status;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type',result.representation?.content_type||'application/json');
   if(result.representation?.encoding==='base64')res.end(Buffer.from(result.body,'base64'));
   else if(typeof result.body==='string')res.end(result.body);
   else res.end(result.rawBody||JSON.stringify(result.body));
  }catch(error){if(!res.headersSent){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {native,requests,origin:'http://127.0.0.1:'+server.address().port,async close(){server.closeAllConnections();await new Promise(done=>server.close(done));await native.close();}};
}
