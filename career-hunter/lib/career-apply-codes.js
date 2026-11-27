/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The smart build of Fill it in on my Chrome (design apply-smart-design-2026-11-26, section 2.4; Roger, 2026-11-26: "it only needs to pull the email to get the key so none of this is public"): POST /apply-code, the lookup of one verification code in the person's own mailbox, for the kernel's assisted application run and nobody else (a browser's request does not carry the kernel's mark and is refused). No model reads anything: it is five fixed steps. (1) The run is the caller's own, is being filled in now, and its approved input, read back from the frozen file, says task.assist.mailCodes with this route; else `off`. (2) The connected Gmail mailbox must be the email fact of that approved input; else `unavailable`. (3) One list request, messages?maxResults=5&q=after:<since in seconds> from:(<the approved senders>), then at most the three newest messages read in full; kept are those that arrived at or after `since` from a sender whose domain is one of the approved input's senders or a subdomain of one. The senders come from the approved input, never from the request. (4) The code is taken by two closed patterns over the subject and the text (a plain-text part, else the HTML with its tags removed; the first 24,000 characters): a token of 4 to 10 letters or digits that ends within 40 characters after the word code, passcode or PIN; else a line that is only such a token. A token counts only when it holds a digit or is six or more capital letters, so an ordinary word is never a code. Two different candidates in one message is `ambiguous`. (5) The answer is {status: found, code, from, at, messageId} or {status: none | ambiguous | off | unavailable, why}. What is logged is the run, the status, the sender's domain and the message's time, never the code. It makes only Gmail GETs through the kernel's egress, which holds the person's connection; Career holds no token.
 */
'use strict';
const runs=require('./career-apply-runs'),help=require('./career-apply-help');

const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me/';
/** What the kernel's own run sends with its call; the HTTP door forwards no such header from a browser. */
const TRIGGER='apply-run';
/** A run that is being filled in now (the approval made, not paused, not ended). */
const ACTIVE=new Set(['approved','queued','running','waiting','ready']);
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,MESSAGE=/^[A-Za-z0-9_-]{1,64}$/;
const HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const KEYWORD=/\b(?:passcode|code|pin)\b/gi,RUN=/[A-Za-z0-9]+/g;
const MAX_LIST=5,MAX_READ=3,MAX_TEXT=24000,NEAR=40,TIMEOUT_MS=5500;
const NOT_NOW='This application is not being filled in now, so Career read no mail.';
const SWITCH_OFF='This approval does not let Career read a code from your mail.';
const CONNECT='Connect the Gmail account you apply with, with mail read access, in Connections.';
const answer=(status,why)=>({status,why});

/** @description Whether the request is the kernel's own assisted application run. @param {object} req @returns {boolean} */
const fromRun=req=>String(req?.headers?.['x-oshal-trigger']||'')===TRIGGER;
/**
 * @description Whether a token is a code as this lookup takes one: 4 to 10 letters or digits, holding a digit or made
 * of six or more capital letters. @param {string} token @returns {boolean}
 */
const isCode=token=>/^[A-Za-z0-9]{4,10}$/.test(token)&&(/\d/.test(token)||/^[A-Z]{6,10}$/.test(token));
/**
 * @description The codes a message's words hold, by the two closed patterns: the first code that ends within 40
 * characters after each code, passcode or PIN; when there is none, each line that is only a code.
 * @param {string} words The subject and the text. @returns {string[]} The different candidates.
 */
function candidates(words){
 const flat=words.replace(/\s+/g,' '),near=new Set();
 for(const found of flat.matchAll(KEYWORD)){
  const from=found.index+found[0].length,after=flat.slice(from,from+NEAR+20);
  const first=[...after.matchAll(RUN)].find(run=>isCode(run[0])&&run.index+run[0].length<=NEAR);
  if(first)near.add(first[0]);
 }
 if(near.size)return [...near];
 return [...new Set(words.split(/\r?\n/).map(line=>line.trim()).filter(isCode))];
}
/** @description A part's own text, decoded and bounded. @param {object} part A Gmail message part. @returns {string} */
const decoded=part=>part?.body?.data?Buffer.from(String(part.body.data),'base64url').toString('utf8').slice(0,MAX_TEXT):'';
/** @description Every part of a message, to four levels and 24 parts. @param {object} part @returns {object[]} */
function parts(part,depth=0){
 if(!part||depth>4)return [];
 return [part,...(Array.isArray(part.parts)?part.parts.slice(0,12).flatMap(item=>parts(item,depth+1)):[])].slice(0,24);
}
/** @description HTML as the words a person reads: no style or script, a line for each block, no tags. @param {string} html @returns {string} */
function readable(html){
 return html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/(?:p|div|td|tr|li|h[1-6]|table)>/gi,'\n')
  .replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#(\d{2,5});/g,(_,n)=>String.fromCharCode(Number(n)));
}
/**
 * @description A message's subject and text: its plain-text parts, else its HTML made readable; the first 24,000
 * characters. @param {object} message A Gmail message in full format. @returns {string}
 */
function wordsOf(message){
 const all=parts(message.payload),of=type=>all.filter(part=>String(part.mimeType||'').toLowerCase()===type).map(decoded).filter(Boolean);
 const plain=of('text/plain'),html=of('text/html').map(readable),text=(plain.length?plain:html).join('\n');
 return (header(message,'subject').slice(0,500)+'\n'+text).slice(0,MAX_TEXT);
}
/** @description One header of a message. @param {object} message @param {string} name Lower case. @returns {string} */
function header(message,name){
 const headers=Array.isArray(message?.payload?.headers)?message.payload.headers:[];
 return String(headers.find(item=>String(item?.name||'').toLowerCase()===name)?.value||'');
}
/**
 * @description Who a message is from: the address in its From header and that address's domain, lower case.
 * @param {object} message @returns {{address:string,domain:string}} Empty strings when the header names no address.
 */
function sender(message){
 const raw=header(message,'from'),inside=/<([^<>]*)>\s*$/.exec(raw),address=String(inside?inside[1]:raw).trim().toLowerCase();
 const domain=address.includes('@')?address.slice(address.lastIndexOf('@')+1):'';
 return HOST.test(domain)&&/^[^\s@]{1,64}@/.test(address)?{address,domain}:{address:'',domain:''};
}
/** @description Whether a domain is one of the approved senders or a subdomain of one. @param {string} domain @param {string[]} allowed @returns {boolean} */
const approvedSender=(domain,allowed)=>Boolean(domain)&&allowed.some(name=>domain===name||domain.endsWith('.'+name));
/**
 * @description What the request may look up, from the person's own run and its frozen approved input: the senders, the
 * mailbox and the moment the code was asked for. Refused as `off` when the run is not his, not being filled in now, or
 * its approval does not say mail codes; as `unavailable` when its approved input cannot be read.
 * @param {string} dir The person's own store. @param {object} body {intentId, attempt, since}. @param {number} now
 * @returns {{senders:string[],email:string,since:number,run:string}|{status:string,why:string}}
 */
function approved(dir,body,now){
 const keys=Object.keys(body||{});
 if(keys.some(key=>!['intentId','attempt','since'].includes(key))||!ID.test(body?.intentId||'')||!Number.isSafeInteger(body.attempt)||body.attempt<1||!Number.isFinite(body.since))
  return answer('off','The lookup names one application, its attempt and the moment the code was asked for.');
 let run,input;
 try{run=runs.get(dir,body.intentId);}catch{return answer('off',NOT_NOW);}
 if(!ACTIVE.has(run.status)||run.attempts.at(-1)?.n!==body.attempt||!(Date.parse(run.expiresAt)>now))return answer('off',NOT_NOW);
 try{input=runs.snapshot(dir,run.id,body.attempt);}catch{return answer('unavailable','The approved application could not be read back, so Career read no mail.');}
 const mail=input.task?.assist?.mailCodes,email=String(input.task?.facts?.email||'').trim().toLowerCase();
 const named=Array.isArray(mail?.senders)?mail.senders.filter(name=>typeof name==='string'&&HOST.test(name)).slice(0,10):[];
 if(!mail||mail.route!==help.ROUTE||!named.length)return answer('off',SWITCH_OFF);
 if(!email)return answer('unavailable','The approved application names no email address, so Career read no mail.');
 return {senders:named,email,since:Math.max(body.since,Date.parse(run.approvedAt)||0),run:run.id};
}
/**
 * @description One Gmail GET through the kernel's egress, bounded; a refusal carries the words the person reads.
 * @param {Function} fetcher The package's fetch. @returns {(path:string)=>Promise<object>}
 */
function gmail(fetcher){
 return async path=>{
  let response;
  try{response=await fetcher(GMAIL+path,{method:'GET',signal:AbortSignal.timeout(TIMEOUT_MS)});}
  catch{throw Object.assign(Error('mailbox unreachable'),{why:'Your mailbox could not be read. '+CONNECT});}
  if(!response.ok)throw Object.assign(Error('mailbox refused'),{why:[401,403].includes(response.status)?CONNECT:`Your mailbox could not be read (HTTP ${response.status}).`});
  return response.json();
 };
}
/**
 * @description The messages that may hold the code: one list request, then at most the three newest read in full; kept
 * are those that arrived at or after `since` from an approved sender, newest first.
 * @param {Function} api gmail() output. @param {{senders:string[],since:number}} wanted @returns {Promise<object[]>}
 */
async function messages(api,wanted){
 const query=`after:${Math.floor(wanted.since/1000)} from:(${wanted.senders.join(' OR ')})`;
 const listed=await api(`messages?maxResults=${MAX_LIST}&q=${encodeURIComponent(query)}`);
 const ids=(Array.isArray(listed?.messages)?listed.messages:[]).map(item=>String(item?.id||'')).filter(id=>MESSAGE.test(id)).slice(0,MAX_READ);
 const kept=[];
 for(const id of ids){
  const message=await api('messages/'+encodeURIComponent(id)+'?format=full'),at=Number(message?.internalDate),from=sender(message);
  if(Number.isFinite(at)&&at>=wanted.since&&approvedSender(from.domain,wanted.senders))kept.push({id,at,from,message});
 }
 return kept.sort((a,b)=>b.at-a.at);
}
/**
 * @description Look up one verification code for one of the person's own runs. Every step is fixed; nothing here asks
 * a model. @param {string} dir The person's own store. @param {object} body {intentId, attempt, since}.
 * @param {{fetcher?:Function,now?:number,log?:Function}} [how] The package's fetch, the time, and where the lookup is
 * noted (the run, the status, the sender's domain and the message's time; never the code).
 * @returns {Promise<object>} {status: found, code, from, at, messageId} or {status, why}.
 */
async function lookup(dir,body,how={}){
 const now=how.now??Date.now(),log=how.log||(()=>{}),wanted=approved(dir,body,now);
 const said=(result,noted={})=>{log({run:body?.intentId,attempt:body?.attempt,status:result.status,...noted});return result;};
 if(wanted.status)return said(wanted);
 const api=gmail(how.fetcher||fetch);
 try{
  const profile=await api('profile');
  if(String(profile?.emailAddress||'').trim().toLowerCase()!==wanted.email)
   return said(answer('unavailable','The connected Gmail mailbox is not the email on this application, so Career did not read it.'));
  for(const kept of await messages(api,wanted)){
   const found=candidates(wordsOf(kept.message)),noted={domain:kept.from.domain,at:new Date(kept.at).toISOString()};
   if(found.length>1)return said(answer('ambiguous','The newest message from this site holds more than one code.'),noted);
   if(found.length===1)return said({status:'found',code:found[0],from:kept.from.address,at:kept.at,messageId:kept.id},noted);
  }
  return said(answer('none','No message with a code has arrived from this site yet.'));
 }catch(error){return said(answer('unavailable',String(error?.why||'Your mailbox could not be read.')));}
}
module.exports={TRIGGER,ACTIVE,fromRun,isCode,candidates,readable,wordsOf,sender,approved,lookup};
