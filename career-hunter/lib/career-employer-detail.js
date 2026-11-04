/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fetch only anonymous structured Workday job details through the original admitted run's kernel egress; the Python sandbox retains no external networking or employer credentials.
 */
'use strict';
function workdayDetailUrl(input){
  if(typeof input!=='string'||input.length>4096)return null;
  let url;try{url=new URL(input);}catch{return null;}
  const host=/^([a-z0-9-]+)\.wd[0-9]+\.myworkdayjobs\.com$/.exec(url.hostname);
  if(url.protocol!=='https:'||!host||url.username||url.password||url.port||url.search||url.hash)return null;
  if(!url.pathname.startsWith('/wday/cxs/'+host[1]+'/')||!/^\/wday\/cxs\/[^/]+\/[A-Za-z0-9_-]+\/job\/[^/]+\/.+/.test(url.pathname))return null;
  if(/%2e|%2f|%5c|\\/i.test(url.pathname)||url.pathname.split('/').some(p=>p==='.'||p==='..'))return null;
  return url.href;
}
async function employerDetailGet(ctx,body){
  const url=workdayDetailUrl(body?.url);
  if(!url||Object.keys(body).some(key=>!['operation','url'].includes(key)))return {status:400,body:{ok:false,error:'invalid-employer-detail'}};
  try{
    const response=await ctx.http.fetch(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json'}});
    const text=await response.text();
    if(Buffer.byteLength(text,'utf8')>256*1024)return {status:502,body:{ok:false,error:'employer-detail-too-large'}};
    return {status:200,body:{ok:true,status:response.status,body:text,contentType:response.headers.get('content-type')||'application/json'}};
  }catch{return {status:502,body:{ok:false,error:'employer-detail-unavailable'}};}
}
module.exports={workdayDetailUrl,employerDetailGet};
