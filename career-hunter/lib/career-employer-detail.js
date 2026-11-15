/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fetch only anonymous structured Workday job details through the original admitted run's kernel egress; the Python sandbox retains no external networking or employer credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Admit one more anonymous structured posting read, one exact host and path shape: Oracle Recruiting Cloud's candidate-site requisition details (the documented ById finder, nothing else in the query). Jobs from those boards had no description on the native kernel and could never be scored. Everything else stays refused, still GET only, no credential, no redirect followed, 256 KiB at most.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Admit the SmartRecruiters Posting API's one-posting read: GET https://api.smartrecruiters.com/v1/companies/<company>/postings/<digits>, no query, rebuilt from its checked parts. SmartRecruiters jobs carry no description in the list feed, and the engine's existing per-posting read was refused here.
 */
'use strict';
const ORACLE_HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fa(?:\.us2|\.us6|\.ocs)?\.oraclecloud\.com$/;
const ORACLE_PATH='/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails';
const ORACLE_QUERY=/^\?onlyData=true&finder=ById;Id=%22([A-Za-z0-9_-]{1,64})%22,siteNumber=([A-Za-z0-9_-]{1,255})$/;
const SMARTRECRUITERS_PATH=/^\/v1\/companies\/([A-Za-z0-9_-]{1,100})\/postings\/([0-9]{1,20})$/;
function parsed(input){
  if(typeof input!=='string'||input.length>4096)return null;
  let url;try{url=new URL(input);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null;
  return url;
}
function workdayDetailUrl(input){
  const url=parsed(input);if(!url)return null;
  const host=/^([a-z0-9-]+)\.wd[0-9]+\.myworkdayjobs\.com$/.exec(url.hostname);
  if(!host||url.search)return null;
  if(!url.pathname.startsWith('/wday/cxs/'+host[1]+'/')||!/^\/wday\/cxs\/[^/]+\/[A-Za-z0-9_-]+\/job\/[^/]+\/.+/.test(url.pathname))return null;
  if(/%2e|%2f|%5c|\\/i.test(url.pathname)||url.pathname.split('/').some(p=>p==='.'||p==='..'))return null;
  return url.href;
}
/** One requisition of one candidate site, by the documented ById finder; the address is rebuilt from its checked parts. */
function oracleDetailUrl(input){
  const url=parsed(input);if(!url||!ORACLE_HOST.test(url.hostname)||url.pathname!==ORACLE_PATH)return null;
  const query=ORACLE_QUERY.exec(url.search);if(!query)return null;
  return `https://${url.hostname}${ORACLE_PATH}?onlyData=true&finder=ById;Id=%22${query[1]}%22,siteNumber=${query[2]}`;
}
/** One posting of one company on the Posting API, with no query at all. */
function smartRecruitersDetailUrl(input){
  const url=parsed(input);if(!url||url.hostname!=='api.smartrecruiters.com'||url.search)return null;
  const path=SMARTRECRUITERS_PATH.exec(url.pathname);if(!path)return null;
  return `https://api.smartrecruiters.com/v1/companies/${path[1]}/postings/${path[2]}`;
}
function employerDetailUrl(input){
  return workdayDetailUrl(input)||oracleDetailUrl(input)||smartRecruitersDetailUrl(input);
}
async function employerDetailGet(ctx,body){
  const url=employerDetailUrl(body?.url);
  if(!url||Object.keys(body).some(key=>!['operation','url'].includes(key)))return {status:400,body:{ok:false,error:'invalid-employer-detail'}};
  try{
    const response=await ctx.http.fetch(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json'}});
    const text=await response.text();
    if(Buffer.byteLength(text,'utf8')>256*1024)return {status:502,body:{ok:false,error:'employer-detail-too-large'}};
    return {status:200,body:{ok:true,status:response.status,body:text,contentType:response.headers.get('content-type')||'application/json'}};
  }catch{return {status:502,body:{ok:false,error:'employer-detail-unavailable'}};}
}
module.exports={workdayDetailUrl,oracleDetailUrl,smartRecruitersDetailUrl,employerDetailUrl,employerDetailGet};
