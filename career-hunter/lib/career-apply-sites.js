/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G, Roger 2026-11-21: "there is more than workday ... are you fixing all posts or just workday"): which form an assisted application fills, moved out of career-apply-packet.js and widened past Workday, Greenhouse, Lever and Ashby. Seven more engines are named by their own hosts (SAP SuccessFactors, IBM Kenexa BrassRing, Amazon's own portal, Eightfold, SmartRecruiters, iCIMS, Oracle Recruiting Cloud and Oracle Taleo), each with its rules in lib/apply-profiles. A company careers page that embeds Greenhouse, Lever, Ashby or SmartRecruiters is resolved, from the company's engine and token and the posting's own engine id that Career's source already recorded (else the page's gh_jid or ashby_jid), to the engine's own form address, the address the company's frame loads, so the run fills it in that engine's careful rules on one approved origin (the add-on reads the top frame only, and a run is approved for one origin). An iCIMS posting is opened at its in_iframe address and an amazon.jobs posting at its application on account.amazon.jobs, for the same reason. Any other public HTTPS employer site is no longer refused: it is the generic site, filled in Career's careful general rules (lib/apply-profiles/generic.json): only exact labels take his record's facts, everything else is his saved answer or a card, pages are moved with Next or Continue, and the run stops before any button that sends the application.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');

/** The engines Career has rules for, by host, and the generic site, which has none: every other public employer site. */
const SITES=[['workday','Workday',[/(?:^|\.)myworkdayjobs\.com$/,/(?:^|\.)myworkday\.com$/,/(?:^|\.)myworkdaysite\.com$/]],
 ['greenhouse','Greenhouse',[/(?:^|\.)greenhouse\.io$/]],['lever','Lever',[/^jobs(?:\.eu)?\.lever\.co$/]],['ashby','Ashby',[/^jobs\.ashbyhq\.com$/]],
 ['successfactors','SAP SuccessFactors',[/(?:^|\.)successfactors\.(?:com|eu)$/,/(?:^|\.)sapsf\.(?:com|eu|cn)$/]],
 ['brassring','IBM Kenexa BrassRing',[/(?:^|\.)brassring\.com$/]],['amazon','Amazon Jobs',[/^(?:www\.|account\.)?amazon\.jobs$/]],
 ['eightfold','Eightfold',[/(?:^|\.)eightfold\.ai$/]],['smartrecruiters','SmartRecruiters',[/^(?:jobs|careers)\.smartrecruiters\.com$/]],
 ['icims','iCIMS',[/(?:^|\.)icims\.com$/]],['oracle','Oracle Recruiting Cloud',[/^[a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com$/]],
 ['taleo','Oracle Taleo',[/(?:^|\.)taleo\.net$/]],['generic','This employer’s own site',[]]];
const NAMED=SITES.filter(([id])=>id!=='generic').map(([id])=>id);
const RULE_KEYS=['id','version','document','steps','press','fields','groups','equivalents','decline','signature','upload'];
const HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TOKEN=/^[a-z0-9][a-z0-9_.-]{0,79}$/i,NUMBER=/^\d{1,20}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SHORT=/^[a-z0-9-]{1,80}$/i;
/** How each embeddable engine's own form address is made from the company's token and the posting's engine id. */
const EMBEDS={
 greenhouse:{id:NUMBER,param:'gh_jid',url:(token,id)=>`https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(token)}&token=${id}`},
 lever:{id:UUID,param:null,url:(token,id)=>`https://jobs.lever.co/${encodeURIComponent(token)}/${id}/apply`},
 ashby:{id:UUID,param:'ashby_jid',url:(token,id)=>`https://jobs.ashbyhq.com/${encodeURIComponent(token)}/${id}/application`},
 smartrecruiters:{id:SHORT,param:null,url:(token,id)=>`https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${id}`}};
const rulesCache=new Map();

/**
 * @description The exact hosts this installation says use an engine's form (package setting CAREER_APPLY_SITE_HOSTS),
 * for an employer whose own careers address fronts that engine's form. @returns {Record<string,string[]>} Engine id to
 * hosts; {} when the setting is absent. Throws when it is malformed, never half read.
 */
function installationHosts(){
 const raw=process.env.CAREER_APPLY_SITE_HOSTS;if(!raw)return {};
 let value;try{value=JSON.parse(raw);}catch{throw Error('CAREER_APPLY_SITE_HOSTS is not JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([id,hosts])=>!NAMED.includes(id)
   ||!Array.isArray(hosts)||hosts.length>50||hosts.some(host=>typeof host!=='string'||!HOST.test(host))))
  throw Error(`CAREER_APPLY_SITE_HOSTS must be {"<${NAMED.join('|')}>":["host.name",...]}`);
 return value;
}
/** @description One site's id and name. @param {string} id @returns {{id:string,name:string}} */
const site=id=>{const found=SITES.find(([known])=>known===id);return {id:found[0],name:found[1]};};
/**
 * @description Which engine an address is on, by this installation's named hosts, else the engines' own hosts.
 * @param {string} url An https address. @returns {{id:string,name:string}|null} The engine, or null for none Career names.
 */
function siteFor(url){
 if(!URL.canParse(url))return null;
 const host=new URL(url).hostname.toLowerCase(),named=Object.entries(installationHosts()).find(([,hosts])=>hosts.includes(host));
 const found=named?named[0]:SITES.find(([id,,hosts])=>id!=='generic'&&hosts.some(pattern=>pattern.test(host)))?.[0];
 return found?site(found):null;
}
/**
 * @description The engine form a company careers page embeds, at the engine's own address: the company's engine and
 * token from Career's source, and the posting's engine id from that source, else from the page's own gh_jid or ashby_jid.
 * @param {object} posting {url, atsType, atsToken, atsJobId}. @returns {string|null} The engine's form address, or null.
 */
function embeddedForm(posting){
 const embed=EMBEDS[String(posting?.atsType||'').toLowerCase()],token=String(posting?.atsToken||'').trim();
 if(!embed||!TOKEN.test(token))return null;
 const own=String(posting.atsJobId??'').trim(),param=embed.param&&new URL(posting.url).searchParams.get(embed.param);
 const id=embed.id.test(own)?own:param&&embed.id.test(param)?param:null;
 return id?embed.url(token,id):null;
}
/** @description An iCIMS posting's own frame address (in_iframe=1): the page around it holds no form fields. @param {string} url @returns {string} */
function icimsFrame(url){
 const address=new URL(url);if(address.searchParams.get('in_iframe')!=='1')address.searchParams.set('in_iframe','1');
 return address.href;
}
/**
 * @description An amazon.jobs posting's application, which Amazon keeps on its account host: Apply on the posting leaves
 * www.amazon.jobs for account.amazon.jobs, and a run is approved for one origin. @param {string} url @returns {string}
 */
function amazonApplication(url){
 const address=new URL(url),id=/\/jobs\/(\d{1,20})(?:\/|$)/.exec(address.pathname)?.[1];
 return ['www.amazon.jobs','amazon.jobs'].includes(address.hostname)&&id?`https://account.amazon.jobs/jobs/${id}/apply`:url;
}
/** @description Where an engine's own form opens, when it is not the posting's address. @param {string} id @param {string} url @returns {string} */
const ownForm=(id,url)=>id==='icims'?icimsFrame(url):id==='amazon'?amazonApplication(url):url;
/**
 * @description The form an assisted application fills and the rules it is filled in: the posting's own engine; else the
 * engine the company's page embeds, at that engine's own address; else the generic site at the posting's address.
 * @param {object} posting {url (a public https address), atsType, atsToken, atsJobId}.
 * @returns {{url:string,site:{id:string,name:string,embeddedOn?:string}}}
 */
function formFor(posting){
 const own=siteFor(posting.url);
 if(own)return {url:ownForm(own.id,posting.url),site:own};
 const embedded=embeddedForm(posting),engine=embedded&&siteFor(embedded);
 if(engine)return {url:embedded,site:{...engine,embeddedOn:new URL(posting.url).hostname}};
 return {url:posting.url,site:site('generic')};
}
/**
 * @description One site's rules (Appendix B), read from lib/apply-profiles and checked for their closed shape.
 * @param {string} id The site. @returns {object} The rules, frozen. Throws for a site Career does not know.
 */
function siteRules(id){
 if(rulesCache.has(id))return rulesCache.get(id);
 if(!SITES.some(([known])=>known===id))throw Object.assign(Error('Career has no rules for this form site.'),{code:'site_unsupported'});
 const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'apply-profiles',id+'.json'),'utf8'));
 const keys=Object.keys(rules).sort().join(),wanted=[...RULE_KEYS].sort().join();
 if(keys!==wanted||rules.id!==id||!Number.isSafeInteger(rules.version)||!['docx','pdf'].includes(rules.document))
  throw Error('site rules '+id+' do not match their closed shape');
 const frozen=Object.freeze(rules);rulesCache.set(id,frozen);return frozen;
}
module.exports={SITES,siteFor,formFor,embeddedForm,siteRules,installationHosts};
