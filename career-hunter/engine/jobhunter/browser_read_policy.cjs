/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Permit anonymous public HTTPS listing reads and explicit search JSON requests; refuse forms, mutations, private destinations and browser credentials.
 */
'use strict';
const dns=require('node:dns').promises,net=require('node:net');

function publicAddress(address){
  if(net.isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224
    ||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0)
    ||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19));}
  return net.isIP(address)===6&&/^[23][a-f0-9]{3}:/i.test(address)&&!/^2001:db8:/i.test(address);
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
function createReadPolicy({fixtureOrigin,lookup=dns.lookup}={}){
  const cached=new Map();
  return async route=>{
    const request=route.request();
    try{
      const url=new URL(request.url()),host=url.hostname.replace(/^\[|\]$/g,'');
      const fixture=fixtureOrigin&&url.origin===fixtureOrigin;
      if(url.username||url.password||!fixture&&(url.protocol!=='https:'||url.port&&url.port!=='443'))return route.abort('blockedbyclient');
      if(!['GET','HEAD'].includes(request.method())&&!(request.method()==='POST'&&searchPost(request,url)))return route.abort('blockedbyclient');
      if(!fixture){
        let found=cached.get(host);
        if(!found||found.expires<Date.now()){
          const addresses=net.isIP(host)?[{address:host}]:await lookup(host,{all:true});
          found={allowed:addresses.length>0&&addresses.every(a=>publicAddress(a.address)),expires:Date.now()+10000};cached.set(host,found);
        }
        if(!found.allowed)return route.abort('blockedbyclient');
      }
      return route.continue();
    }catch{return route.abort('blockedbyclient');}
  };
}
module.exports={publicAddress,searchPost,createReadPolicy};
