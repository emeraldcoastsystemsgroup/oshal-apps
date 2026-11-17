/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16: "there are a bunch of jobs from torch technology that i want to apply for but in the my jobs initial screen the popup says that there is no information about the job"): the posting sheet's description when the corpus has none. Workday lists carry no description (engine ats.py Workday.fetch) and the pull's description stage leaves Workday, Oracle Recruiting Cloud and SmartRecruiters to the person's own reads, which only the nightly pass (50 a night) and Check my fit or Prepare made; the sheet showed "No description was provided." for every such job nobody had read. A job with no description is now read here, once, through the kernel's egress at the one structured address the engine's readers use (lib/career-employer-detail.js admits it, as it does for the engine's rail), its text taken from the same fields, with paragraph and list breaks kept as the pull keeps a description (engine posting_page.detail_text), and kept as the person's own copy in the engine's format (engine job_context.py: version 2, employer-detail, bound to the listing) so the sheet, the Concierge, preparation and scoring reuse it with no new read. A job no such address fits, or whose read fails, gets a plain reason. POST /jobs/:id/details reads and keeps; GET /jobs/:id?details=read reads for that view only (a read cannot write, and a write waits while Career is preparing the person's applications). Guards: tests/career-job-details.test.mjs, tests/career-job-details-contract.py.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const {employerDetailUrl,employerDetailGet}=require('./career-employer-detail');
const {applyJobContext,snapshot,hasText}=require('./career-job-context');
const {callerSub,userPaths,openUserDb}=require('../routes/career-user-store');
const {fullyRemoteSql}=require('../routes/career-search-scope');

const logger=createChildLogger({module:'career-job-details'});
/** The bounds engine/jobhunter/job_context.py holds a saved copy to: whole or absent, never cut. */
const MAX_CHARS=64000,LIMIT=384*1024,MAX_ENTRIES=1000,VERSION=2;
/** Oracle requisition fields in the order engine/jobhunter/oracle_orc.py DETAIL_FIELDS joins them. */
const ORACLE_FIELDS=['ExternalDescriptionStr','ExternalResponsibilitiesStr','ExternalQualificationsStr','OrganizationDescriptionStr','CorporateDescriptionStr'];
/** SmartRecruiters job-ad sections in the order engine/jobhunter/ats_feeds.py SmartRecruiters.detail joins them. */
const SR_SECTIONS=['jobDescription','qualifications','additionalInformation','companyDescription'];
/** Why a description could not be read, in the words the posting sheet says them (tools/career-job-lists.js READ_WHY). */
const REASONS={
  'no-reader':'It cannot read job descriptions from this employer’s job site.',
  closed:'The posting is no longer on the employer’s site.',
  refused:'The employer’s site refused the request.',
  empty:'The posting has no description.',
  unavailable:'The employer’s site did not answer.',
};

/* Python's str.strip() whitespace, as lib/career-job-context.js holds it. */
const SPACE='\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP=new RegExp(`^[${SPACE}]+|[${SPACE}]+$`,'gu');
const pyStrip=value=>value.replace(STRIP,'');
const chars=value=>Array.from(value).length;

/* HTML 4 named references (and apos) with the values Python's html.unescape gives them; "!" marks a name that needs
   its semicolon, the rest are the legacy names HTML5 also reads without one. */
const NAMED=(()=>{
  const table={};
  for(const entry of ('Aacute:c1 aacute:e1 Acirc:c2 acirc:e2 acute:b4 AElig:c6 aelig:e6 Agrave:c0 agrave:e0 alefsym!:2135 Alpha!:391 alpha!:3b1 AMP:26 amp:26 and!:2227 ang!:2220 apos!:27 Aring:c5 aring:e5 asymp!:2248 Atilde:c3 atilde:e3 Auml:c4 auml:e4 bdquo!:201e Beta!:392 beta!:3b2 brvbar:a6 bull!:2022 cap!:2229 Ccedil:c7 ccedil:e7 cedil:b8 cent:a2 Chi!:3a7 chi!:3c7 circ!:2c6 clubs!:2663 cong!:2245 COPY:a9 copy:a9 crarr!:21b5 cup!:222a curren:a4 Dagger!:2021 dagger!:2020 dArr!:21d3 darr!:2193 deg:b0 Delta!:394 delta!:3b4 diams!:2666 divide:f7 Eacute:c9 eacute:e9 Ecirc:ca ecirc:ea Egrave:c8 egrave:e8 empty!:2205 emsp!:2003 ensp!:2002 Epsilon!:395 epsilon!:3b5 equiv!:2261 Eta!:397 eta!:3b7 ETH:d0 eth:f0 Euml:cb euml:eb euro!:20ac exist!:2203 fnof!:192 forall!:2200 frac12:bd frac14:bc frac34:be frasl!:2044 Gamma!:393 gamma!:3b3 ge!:2265 GT:3e gt:3e hArr!:21d4 harr!:2194 hearts!:2665 hellip!:2026 Iacute:cd iacute:ed Icirc:ce icirc:ee iexcl:a1 Igrave:cc igrave:ec image!:2111 infin!:221e int!:222b Iota!:399 iota!:3b9 iquest:bf isin!:2208 Iuml:cf iuml:ef Kappa!:39a kappa!:3ba Lambda!:39b lambda!:3bb lang!:27e8 laquo:ab lArr!:21d0 larr!:2190 lceil!:2308 ldquo!:201c le!:2264 lfloor!:230a lowast!:2217 loz!:25ca lrm!:200e lsaquo!:2039 lsquo!:2018 LT:3c lt:3c macr:af mdash!:2014 micro:b5 middot:b7 minus!:2212 Mu!:39c mu!:3bc nabla!:2207 nbsp:a0 ndash!:2013 ne!:2260 ni!:220b not:ac notin!:2209 nsub!:2284 Ntilde:d1 ntilde:f1 Nu!:39d nu!:3bd Oacute:d3 oacute:f3 Ocirc:d4 ocirc:f4 OElig!:152 oelig!:153 Ograve:d2 ograve:f2 oline!:203e Omega!:3a9 omega!:3c9 Omicron!:39f omicron!:3bf oplus!:2295 or!:2228 ordf:aa ordm:ba Oslash:d8 oslash:f8 Otilde:d5 otilde:f5 otimes!:2297 Ouml:d6 ouml:f6 para:b6 part!:2202 permil!:2030 perp!:22a5 Phi!:3a6 phi!:3c6 Pi!:3a0 pi!:3c0 piv!:3d6 plusmn:b1 pound:a3 Prime!:2033 prime!:2032 prod!:220f prop!:221d Psi!:3a8 psi!:3c8 QUOT:22 quot:22 radic!:221a rang!:27e9 raquo:bb rArr!:21d2 rarr!:2192 rceil!:2309 rdquo!:201d real!:211c REG:ae reg:ae rfloor!:230b Rho!:3a1 rho!:3c1 rlm!:200f rsaquo!:203a rsquo!:2019 sbquo!:201a Scaron!:160 scaron!:161 sdot!:22c5 sect:a7 shy:ad Sigma!:3a3 sigma!:3c3 sigmaf!:3c2 sim!:223c spades!:2660 sub!:2282 sube!:2286 sum!:2211 sup!:2283 sup1:b9 sup2:b2 sup3:b3 supe!:2287 szlig:df Tau!:3a4 tau!:3c4 there4!:2234 Theta!:398 theta!:3b8 thetasym!:3d1 thinsp!:2009 THORN:de thorn:fe tilde!:2dc times:d7 trade!:2122 Uacute:da uacute:fa uArr!:21d1 uarr!:2191 Ucirc:db ucirc:fb Ugrave:d9 ugrave:f9 uml:a8 upsih!:3d2 Upsilon!:3a5 upsilon!:3c5 Uuml:dc uuml:fc weierp!:2118 Xi!:39e xi!:3be Yacute:dd yacute:fd yen:a5 Yuml!:178 yuml:ff Zeta!:396 zeta!:3b6 zwj!:200d zwnj!:200c').split(' ')){
    const [name,hex]=entry.split(':'),bare=!name.endsWith('!'),key=name.replace('!',''),value=String.fromCodePoint(parseInt(hex,16));
    table[key+';']=value;if(bare)table[key]=value;
  }
  return table;
})();
/* Python's html._invalid_charrefs (0x00, CR and the windows-1252 block) and html._invalid_codepoints. */
const CP1252=[0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178];
const dropped=n=>(n>=0x1&&n<=0x8)||n===0xb||(n>=0xe&&n<=0x1f)||(n>=0x7f&&n<=0x9f)||(n>=0xfdd0&&n<=0xfdef)||(n&0xfffe)===0xfffe;
const CHARREF=/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/**
 * @description Python's html.unescape for numeric references and the HTML 4 names (and apos), the names job postings
 * use; an HTML5-only name is left as written.
 * @param {string} text - Text with character references.
 * @returns {string} The text with them replaced.
 */
function unescapeHtml(text){
  if(!text.includes('&'))return text;
  return text.replace(CHARREF,(whole,ref)=>{
    if(ref[0]==='#'){
      const digits=ref.slice(ref[1]==='x'||ref[1]==='X'?2:1).replace(/;$/,''),n=Number.parseInt(digits,ref[1]==='x'||ref[1]==='X'?16:10);
      if(n===0)return '\ufffd';if(n===0xd)return '\r';if(n>=0x80&&n<=0x9f)return String.fromCodePoint(CP1252[n-0x80]);
      if(!Number.isFinite(n)||(n>=0xd800&&n<=0xdfff)||n>0x10ffff)return '\ufffd';
      return dropped(n)?'':String.fromCodePoint(n);
    }
    if(Object.hasOwn(NAMED,ref))return NAMED[ref];
    for(let x=ref.length-1;x>1;x--)if(Object.hasOwn(NAMED,ref.slice(0,x)))return NAMED[ref.slice(0,x)]+ref.slice(x);
    return '&'+ref;
  });
}

const TAG=/<[^>]+>/g,BREAK=/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|ul|ol|tr|section|article)\s*>|<li\b[^>]*>/gi;
/**
 * @description One posting's description from its detail sections, as the pull keeps one (engine posting_page.detail_text):
 * markup escaped once more is read, paragraph and list ends become line breaks, tags go, references are read, runs of
 * blank space close up; nothing when the text is empty or longer than a saved copy may hold.
 * @param {...unknown} sections - HTML sections in order; anything but text is skipped.
 * @returns {string|null} The description, or null.
 */
function detailText(...sections){
  const parts=sections.map(s=>typeof s==='string'&&s.includes('&lt;')?unescapeHtml(s):s).map(s=>typeof s==='string'?s.replace(BREAK,'\n'):s)
    .filter(s=>typeof s==='string'&&pyStrip(s));
  if(!parts.length)return null;
  const stripped=pyStrip(unescapeHtml(parts.join('\n\n').replace(TAG,' ')));
  if(!stripped||chars(stripped)>MAX_CHARS)return null;
  const text=pyStrip(stripped.replace(/[ \t\r\f\v\u00a0\u200b]+/g,' ').replace(/ ?\n[ \n]*/g,run=>run.split('\n').length>2?'\n\n':'\n'));
  return text||null;
}

/**
 * @description The structured detail addresses the engine's readers would read for this posting, in the order they try
 * them (engine detail.fetch: the Workday posting its link names, then the source's own reader), kept only where
 * lib/career-employer-detail.js admits them, which is what the kernel's egress lets Career read.
 * @param {{url?:unknown,ats_job_id?:unknown}} posting - The corpus row.
 * @param {{ats_type?:unknown,ats_token?:unknown}} company - Its employer's source.
 * @returns {Array<{kind:string,url:string}>} Admitted addresses, without repeats.
 */
function detailAddresses(posting,company){
  const found=[],jobId=String(posting?.ats_job_id??''),token=String(company?.ats_token??''),kind=String(company?.ats_type??'');
  const add=(reader,address)=>{const admitted=address&&employerDetailUrl(address);if(admitted&&!found.some(item=>item.url===admitted))found.push({kind:reader,url:admitted});};
  try{
    const link=new URL(String(posting?.url??'')),host=/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(link.hostname),parts=link.pathname.split('/job/');
    if(link.protocol==='https:'&&host&&parts.length>=2&&!link.username&&!link.password){
      const site=parts[0].replace(/^\/+|\/+$/g,'').split('/').pop(),rest=link.pathname.slice(parts[0].length+5);
      const external='/job/'+(rest.endsWith('/apply')?rest.slice(0,-6):rest).replace(/\/+$/,'');
      if(/^[A-Za-z0-9_-]+$/.test(site))add('workday',`https://${host[1]}.${host[2]}.myworkdayjobs.com/wday/cxs/${host[1]}/${site}${external}`);
    }
  }catch{/* a posting link that is not an address names no Workday posting; the source's own reader may still */}
  if(kind==='workday'){const parts=token.split(':');if(parts.length===3)add('workday',`https://${parts[0]}.${parts[1]}.myworkdayjobs.com/wday/cxs/${parts[0]}/${parts[2]}${jobId}`);}
  if(kind==='oracle_orc'){
    const [backend,site]=(token+'||').split('|');
    if(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fa(?:\.us2|\.us6|\.ocs)?\.oraclecloud\.com$/.test(backend)&&/^[A-Za-z0-9_-]{1,255}$/.test(site)&&/^[A-Za-z0-9_-]{1,64}$/.test(jobId))
      add('oracle_orc',`https://${backend}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=%22${jobId}%22,siteNumber=${site}`);
  }
  if(kind==='smartrecruiters'&&/^[A-Za-z0-9_-]{1,100}$/.test(token)&&/^[0-9]{1,20}$/.test(jobId))
    add('smartrecruiters',`https://api.smartrecruiters.com/v1/companies/${token}/postings/${jobId}`);
  return found;
}

/**
 * @description The description in one structured detail answer, from the fields the engine's reader of that source reads.
 * @param {string} kind - workday, oracle_orc or smartrecruiters.
 * @param {unknown} data - The parsed answer.
 * @param {string} jobId - The posting's id on its source.
 * @returns {{description?:string,reason?:string}} The description, or why there is none.
 */
function describe(kind,data,jobId){
  if(!data||typeof data!=='object'||Array.isArray(data))return {reason:'empty'};
  if(kind==='workday'){const description=detailText(data.jobPostingInfo?.jobDescription);return description?{description}:{reason:'empty'};}
  if(kind==='oracle_orc'){
    // A closed requisition answers 200 with no items (tests/employer-detail-fixtures/oracle-eeho-us2-closed.json).
    if(Array.isArray(data.items)&&!data.items.length)return {reason:'closed'};
    const item=Array.isArray(data.items)&&data.items.length===1&&data.items[0]&&typeof data.items[0]==='object'?data.items[0]:null;
    if(!item||String(item.Id)!==jobId)return {reason:'empty'};
    let sections=ORACLE_FIELDS.map(field=>item[field]);
    if(!sections.some(section=>typeof section==='string'&&pyStrip(section)))sections=[item.ShortDescriptionStr];
    const description=detailText(...sections);return description?{description}:{reason:'empty'};
  }
  if(String(data.id)!==jobId)return {reason:'empty'};
  const sections=data.jobAd?.sections||{},description=detailText(...SR_SECTIONS.map(key=>sections[key]?.text));
  return description?{description}:{reason:'empty'};
}

/**
 * @description Read one posting's description through the kernel's egress: at most the engine's two addresses, one GET
 * each, never retried or redirected, the second only when the first gave no description.
 * @param {{http:{fetch:Function}}} ctx - Kernel context (its egress).
 * @param {object} posting - The corpus row.
 * @param {object} company - Its employer's source.
 * @returns {Promise<{description?:string,reason?:string,kind?:string,reads:number}>} The description, or why there is none.
 */
async function readDescription(ctx,posting,company){
  const addresses=detailAddresses(posting,company),jobId=String(posting?.ats_job_id??'');
  if(!addresses.length)return {reason:'no-reader',reads:0};
  let first=null,reads=0;
  for(const {kind,url} of addresses){
    const started=Date.now();let outcome;
    try{outcome=await employerDetailGet(ctx,{operation:'employer-detail-get',url});}
    catch(err){logger.error({err,postingId:posting.id,kind},'career job description read failed');outcome={status:502,body:{ok:false}};}
    reads+=1;
    const status=outcome.status===200?Number(outcome.body.status):null;
    let result;
    if(status===200){let data=null;try{data=JSON.parse(outcome.body.body);}catch{data=null;/* not JSON: no description in it */}result=describe(kind,data,jobId);}
    else result={reason:status===404||status===410?'closed':status!==null&&status<500&&status!==429?'refused':'unavailable'};
    logger.info({postingId:posting.id,kind,employerStatus:status,found:Boolean(result.description),durationMs:Date.now()-started},'career job description read');
    if(result.description)return {description:result.description,kind,reads};
    first=first||result;
  }
  return {reason:first.reason,reads};
}

/**
 * @description Keep a description read from the employer as the person's own copy, exactly as engine job_context.py
 * writes one (version 2, basis employer-detail, bound to this listing), so every Career reader uses it without a read.
 * Never replaces a copy that still fits this listing, and keeps nothing when the person's folder holds the most copies.
 * @param {string} userDir - The person's folder.
 * @param {object} posting - The corpus row the copy belongs to (as GET /jobs/:id reads it).
 * @param {string} description - The employer's text.
 * @returns {{kept:boolean,retrievedAt?:string,reason?:string}} Whether it was kept.
 */
function keepCopy(userDir,posting,description){
  if(chars(description)>MAX_CHARS)return {kept:false,reason:'too-large'};
  const directory=path.join(userDir,'job-context'),file=path.join(directory,posting.id+'.json');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const info=fs.lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())return {kept:false,reason:'unavailable'};
  let present=false;try{fs.lstatSync(file);present=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!present&&fs.readdirSync(directory).filter(name=>name.endsWith('.json')).length>=MAX_ENTRIES)return {kept:false,reason:'full'};
  const retrievedAt=new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
  const value={version:VERSION,snapshot:snapshot(posting),description,descriptionSha256:crypto.createHash('sha256').update(description).digest('hex'),
    retrievedAt,basis:'employer-detail',sourceChars:chars(description),sourceBytes:Buffer.byteLength(description,'utf8'),truncated:false};
  const rendered=JSON.stringify(value);if(Buffer.byteLength(rendered,'utf8')>LIMIT)return {kept:false,reason:'too-large'};
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{
    const handle=fs.openSync(temporary,'wx',0o600);
    try{fs.writeSync(handle,rendered);fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
    fs.renameSync(temporary,file);
  }finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')logger.error({err:error},'career job description temporary file not removed');}}
  return {kept:true,retrievedAt};
}

/** The corpus row GET /jobs/:id reads (its remote as the board reads it), with the employer's name and source. */
function postingRow(db,postingId){
  return db.prepare(`SELECT p.*, CASE WHEN ${fullyRemoteSql()} THEN 1 ELSE 0 END AS remote,
      c.name AS company, c.ats_type AS company_ats_type, c.ats_token AS company_ats_token
    FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id WHERE p.id=?`).get(postingId);
}
/** The posting's own columns, as job_context.snapshot binds a copy to them. */
function listing(row){const out={...row};for(const key of ['company','company_ats_type','company_ats_token'])delete out[key];return out;}

/**
 * @description The description the sheet shows when the corpus and the person's saved copy have none: read now,
 * for the view only. GET /jobs/:id?details=read calls it; a read admission keeps nothing.
 * @param {{http:{fetch:Function}}} ctx - Kernel context.
 * @param {object} db - The person's store with the corpus attached (open).
 * @param {number} postingId - The job.
 * @returns {Promise<{description?:string,description_context?:object,reason?:string}>} What was read, or why not.
 */
async function readForView(ctx,db,postingId){
  const row=postingRow(db,postingId);if(!row)return {reason:'closed'};
  const read=await readDescription(ctx,listing(row),{ats_type:row.company_ats_type,ats_token:row.company_ats_token});
  if(!read.description)return {reason:read.reason};
  return {description:read.description,description_context:{basis:'employer-detail',retrievedAt:new Date().toISOString(),kept:false}};
}

/**
 * @description POST /jobs/:id/details: the person's job's description, read through the kernel's egress and kept as
 * their own copy when the corpus and their saved copies have none. Answers {ok:true, description, description_context}
 * or {ok:false, reason, why}; a job that already has a description is answered without a read.
 * @param {{http:{fetch:Function}}} ctx - Kernel context.
 * @param {object} req - Express request.
 * @param {object} res - Express response.
 * @returns {Promise<void>}
 */
async function postDetails(ctx,req,res){
  const started=Date.now(),userSub=callerSub(req);
  if(!userSub){res.status(401).json({error:'unauthorized'});return;}
  const postingId=Number(req.params.id);
  if(!Number.isSafeInteger(postingId)||postingId<=0){res.status(400).json({error:'bad id'});return;}
  res.setHeader('Cache-Control','private, no-store');
  const {userDir}=userPaths(userSub);
  let row,known,verified=true;
  const db=openUserDb(userSub);
  if(!db){res.status(404).json({error:'no data'});return;}
  try{
    row=postingRow(db,postingId);
    if(!row){res.status(404).json({error:'not found'});return;}
    try{known=applyJobContext(userDir,listing(row));}catch{known=listing(row);verified=false;/* a copy that cannot be verified is not replaced */}
  }finally{db.close();}
  if(hasText(known.description)){res.json({ok:true,description:known.description,description_context:known.description_context||null});return;}
  const read=await readDescription(ctx,listing(row),{ats_type:row.company_ats_type,ats_token:row.company_ats_token});
  if(!read.description){
    logger.info({postingId,reason:read.reason,reads:read.reads,durationMs:Date.now()-started},'career job description unavailable');
    res.json({ok:false,reason:read.reason,why:REASONS[read.reason],company:row.company,url:row.url||null});return;
  }
  let kept={kept:false,reason:'unverified-copy'};
  if(verified){
    try{kept=keepCopy(userDir,listing(row),read.description);if(kept.kept)clearNeedsDetails(userSub,postingId);}
    catch(err){logger.error({err,postingId},'career job description not kept');kept={kept:false,reason:'unavailable'};}
  }
  logger.info({postingId,kind:read.kind,kept:kept.kept,keptReason:kept.reason||null,durationMs:Date.now()-started},'career job description read and kept');
  res.json({ok:true,description:read.description,
    description_context:{basis:'employer-detail',retrievedAt:kept.retrievedAt||new Date().toISOString(),kept:kept.kept}});
}

/**
 * @description With the description now kept, the job is no longer one the nightly pass could not read: its
 * "details needed" mark goes, as engine score.clear_needs_details takes it off when the person pastes one.
 * @param {string} userSub - The person.
 * @param {number} postingId - The job.
 * @returns {void}
 */
function clearNeedsDetails(userSub,postingId){
  const db=openUserDb(userSub,false);if(!db)return;
  try{db.prepare(`UPDATE user_signals SET ai_model=NULL WHERE posting_id=? AND ai_fit_score IS NULL AND ai_model LIKE '{"needsDetails":%'`).run(postingId);}
  finally{db.close();}
}

/**
 * @description Registers POST /jobs/:id/details on the Career router.
 * @param {object} router - Authenticated Career router.
 * @param {object} ctx - Kernel context (its egress).
 * @returns {void}
 */
function register(router,ctx){
  router.post('/jobs/:id/details',(req,res)=>{postDetails(ctx,req,res).catch(err=>{
    logger.error({err,postingId:req.params.id},'career job description route failed');
    if(!res.headersSent)res.status(500).json({error:'read failed'});
  });});
}

module.exports={register,postDetails,readForView,readDescription,detailAddresses,describe,detailText,unescapeHtml,keepCopy,REASONS};
