/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Permit anonymous public HTTPS listing reads and explicit search JSON requests; refuse forms, mutations, private destinations and browser credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Allow only AWS WAF's bounded anonymous multipart proof after a navigation reports a browser check; keep applicant forms, arbitrary POSTs and private destinations refused.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add fail-closed loopback proxy and redirect-target enforcement so 301/302/303/307/308 redirects (navigation and subresource) to loopback, RFC1918, link-local/metadata, CGNAT or 6to4 addresses never leave the reader.
 */
'use strict';
const dns=require('node:dns').promises,http=require('node:http'),net=require('node:net');
const REDIRECTS=new Set([301,302,303,307,308]);

function publicAddress(address){
  if(net.isIP(address)===4){
    const p=address.split('.').map(Number);
    return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224
      ||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31
      ||p[0]===192&&(p[1]===168||p[1]===0)||p[0]===100&&p[1]>=64&&p[1]<=127
      ||p[0]===198&&(p[1]===18||p[1]===19||p[1]===51&&p[2]===100)
      ||p[0]===203&&p[1]===0&&p[2]===113);
  }
  return net.isIP(address)===6&&/^[23][a-f0-9]{3}:/i.test(address)
    &&!/^2001:(?:0{0,4}|db8):|^2002:/i.test(address);
}

const MUTATION=/\bmutation\b|(?:apply|submit|create|delete|update|candidate|application|register|login|signin|subscribe)/i;
function searchPost(request,url){
  if(!['fetch','xhr'].includes(request.resourceType())||request.isNavigationRequest()
    ||/(?:^|\/)(?:apply|applications?|candidates?|register|login|signin|subscribe|submit|create|delete|update)(?:\/|$)/i.test(url.pathname)
    ||!/graphql|query|search|jobs|postings|positions|opportunities/i.test(url.pathname))return false;
  if(!/^application\/json(?:;|$)/i.test(request.headers()['content-type']||''))return false;
  const body=request.postData();if(typeof body!=='string'||Buffer.byteLength(body)>65536)return false;
  let value;try{value=JSON.parse(body);}catch{return false;}
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(typeof value.query==='string')return !/\bmutation\b/i.test(value.query.replace(/"(?:\\.|[^"\\])*"/g,'""'))&&/^\s*(?:query\b|\{)/i.test(value.query);
  if(typeof value.operationName==='string')return /search|query|list|career|posting|job/i.test(value.operationName)&&!MUTATION.test(value.operationName);
  // Workday's anonymous listing search has no GraphQL operation name.
  return /\/wday\/cxs\/[^/]+\/[^/]+\/jobs\/?$/.test(url.pathname)
    && Object.keys(value).every(key=>['appliedFacets','limit','offset','searchText'].includes(key));
}

/** @description Admit the anonymous WAF proof without admitting applicant forms.
 * @param {object} request Browser request. @param {URL} url Parsed destination.
 * @returns {boolean} Whether this is the exact bounded proof request.
 */
function browserCheckPost(request,url){
  if(!/^[a-f0-9]+\.[a-f0-9]+\.[a-z0-9-]+\.token\.awswaf\.com$/.test(url.hostname)
    ||!/^\/[a-f0-9]+\/[a-f0-9]+\/[a-f0-9]+\/mp_verify$/.test(url.pathname)
    ||request.resourceType()!=='fetch'||request.isNavigationRequest()
    ||!/^multipart\/form-data;\s*boundary=/i.test(request.headers()['content-type']||''))return false;
  const body=request.postData();if(typeof body!=='string'||Buffer.byteLength(body)>65536||/filename\s*=/i.test(body))return false;
  const names=[...body.matchAll(/Content-Disposition:\s*form-data;\s*name="([^"]+)"/gi)].map(part=>part[1]).sort();
  return names.length===2&&names[0]==='solution_data'&&names[1]==='solution_metadata';
}

async function resolvePublicHost(host,lookup,cached){
  const clean=String(host||'').replace(/^\[|\]$/g,'').toLowerCase();
  if(!clean||clean==='localhost'||clean.endsWith('.localhost'))return {allowed:false};
  let found=cached.get(clean);
  if(!found||found.expires<Date.now()){
    const addresses=net.isIP(clean)?[{address:clean}]:await lookup(clean,{all:true});
    const allowed=addresses.length>0&&addresses.every(a=>publicAddress(a.address));
    found={allowed,address:allowed?addresses[0].address:null,expires:Date.now()+10000};
    cached.set(clean,found);
  }
  return found;
}

async function checkDestination(rawUrl,{fixtureOrigin,lookup=dns.lookup,cached=new Map()}={}){
  let url;try{url=new URL(rawUrl);}catch{return {allowed:false};}
  if(url.username||url.password)return {allowed:false};
  const host=url.hostname.replace(/^\[|\]$/g,'');
  const fixture=Boolean(fixtureOrigin&&url.origin===fixtureOrigin);
  if(fixture){
    const port=Number(url.port)||(url.protocol==='https:'?443:80);
    return {allowed:true,fixture:true,url,address:host,port};
  }
  if(url.protocol!=='https:'||url.port&&url.port!=='443')return {allowed:false};
  const resolved=await resolvePublicHost(host,lookup,cached);
  return resolved.allowed?{allowed:true,fixture:false,url,address:resolved.address,port:443}:{allowed:false};
}

function createReadPolicy({fixtureOrigin,lookup=dns.lookup,browserCheck=()=>false}={}){
  const cached=new Map();
  return async route=>{
    const request=route.request();
    try{
      const verdict=await checkDestination(request.url(),{fixtureOrigin,lookup,cached});
      if(!verdict.allowed)return route.abort('blockedbyclient');
      if(!['GET','HEAD'].includes(request.method())&&!(request.method()==='POST'
        &&(searchPost(request,verdict.url)||browserCheck()&&browserCheckPost(request,verdict.url))))return route.abort('blockedbyclient');
      return route.continue();
    }catch{return route.abort('blockedbyclient');}
  };
}

function parseAuthority(authority){
  const ipv6=/^\[([^\]]+)\]:(\d+)$/.exec(authority||'');
  if(ipv6)return {host:ipv6[1],port:Number(ipv6[2])};
  const idx=String(authority||'').lastIndexOf(':');
  if(idx<=0)return null;
  const host=authority.slice(0,idx),port=Number(authority.slice(idx+1));
  return host&&Number.isInteger(port)&&port>0&&port<=65535?{host,port}:null;
}

function proxyHeaders(headers){
  const out={};
  for(const [key,value]of Object.entries(headers||{})){
    if(!/^proxy-/i.test(key))out[key]=value;
  }
  return out;
}

function forwardHttp(req,res,verdict,opts){
  const upstream=http.request({
    host:verdict.address,port:verdict.port,method:req.method,
    path:verdict.url.pathname+verdict.url.search,headers:proxyHeaders(req.headers),
  },async upRes=>{
    if(REDIRECTS.has(upRes.statusCode)&&upRes.headers.location){
      let target;try{target=new URL(upRes.headers.location,verdict.url.href).href;}catch{target='';}
      const next=target?await checkDestination(target,opts):{allowed:false};
      if(!next.allowed){upRes.destroy();req.socket.destroy();return;}
    }
    res.writeHead(upRes.statusCode||502,upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error',()=>req.socket.destroy());
  req.pipe(upstream);
}

function handleConnect(req,clientSocket,head,opts){
  const target=parseAuthority(req.url);
  if(!target){clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');clientSocket.destroy();return;}
  const hostPart=net.isIP(target.host)===6?`[${target.host}]`:target.host;
  checkDestination(`https://${hostPart}:${target.port}/`,opts).then(verdict=>{
    if(!verdict.allowed){clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');clientSocket.destroy();return;}
    const upstream=net.connect({host:verdict.address,port:verdict.port},()=>{
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head&&head.length)upstream.write(head);
      upstream.pipe(clientSocket);clientSocket.pipe(upstream);
    });
    upstream.on('error',()=>clientSocket.destroy());
    clientSocket.on('error',()=>upstream.destroy());
  }).catch(()=>clientSocket.destroy());
}

/** @description Start an ephemeral loopback egress proxy that checks every request and redirect hop against the public-address policy. */
async function createReadProxy({fixtureOrigin,lookup=dns.lookup}={}){
  const opts={fixtureOrigin,lookup,cached:new Map()};
  const server=http.createServer((req,res)=>{
    checkDestination(req.url,opts).then(verdict=>{
      if(!verdict.allowed){req.socket.destroy();return;}
      forwardHttp(req,res,verdict,opts);
    }).catch(()=>req.socket.destroy());
  });
  server.on('connect',(req,clientSocket,head)=>handleConnect(req,clientSocket,head,opts));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const {port}=server.address();
  return {
    url:`http://127.0.0.1:${port}`,
    close(){server.closeAllConnections();return new Promise(resolve=>server.close(resolve));},
  };
}

module.exports={publicAddress,searchPost,browserCheckPost,checkDestination,createReadPolicy,createReadProxy};
