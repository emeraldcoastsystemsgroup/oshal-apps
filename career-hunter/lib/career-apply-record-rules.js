/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0, "applications that improve themselves" part 3 (design career-self-improving-applications-2026-11-27): the answer an employer's question takes from the signed-in person's own record, before anyone asks them. Pure: settle(question, options, person) reads only the person view it is given (career-apply-record-person.js builds it from their own store: facts, roles, education, standing answers, saved answers, Attestations, Matching area, the job and the letter Career wrote for it) and names no person. It answers eligibility (work authorization, sponsorship, citizenship, 18 or older only when the record proves it, a clearance from a saved answer), self-identification (the standing answers, else the form's prefer-not option), location and work pattern (country, state, time zone where the state has one, relocation, office days and "within N miles" from the Matching area and the job's distance), career facts (name parts, current employer, years from the roles' dates, past employment at this employer, an area the record names, profile links, pay from a saved answer), consents (terms and acknowledgements only under the Attestations switch; marketing, text messages and recordings: no), "why us" from the job's letter and how they heard. It never answers a check that a person is human, a fact the record does not hold (start date, notice period, time off, non-compete) or anything it cannot settle: that card stays the person's. Options are matched as whole words, so "No" never matches inside "Now", and by meaning (yes, no, prefer not) for long-worded options.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The job-source rule answers only a question about where the person found the job (how did you hear / learn / find out about, where did you find or see it, referral source). It matched any "hear about" or "learn about", so an essay such as "We'd love to hear about something you built and operated in production" would have been filled with "Company careers website" (seen on Resend's form in the owner's apply-all run, 2026-11-27).
 */
'use strict';

/** @description Lower-case words only (NFKC, accents folded), single spaces. @param {*} value @returns {string} */
const norm=value=>String(value??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').normalize('NFKC').toLowerCase()
 .replace(/['’]/g,'').replace(/[^\p{L}\p{N}+$]+/gu,' ').trim();
/** @description Whether norm()ed words hold the phrase as whole words. @param {string} words @param {string} phrase @returns {boolean} */
const has=(words,phrase)=>(' '+words+' ').includes(' '+norm(phrase)+' ');
const any=(words,phrases)=>phrases.some(phrase=>has(words,phrase));
const DECLINE=['prefer not','decline','do not wish','dont wish','choose not','rather not','not to answer','not to disclose','not to say','not to self identify','not wish to','wish not to',
 'do not want to answer','dont want to answer','do not want to disclose','dont want to disclose','do not want to say'];
const NO_START=/^(no|none|never|not|nope|i am not|im not|i do not|i dont|i have not|i havent|i will not|i wont|i would not|i cannot|i cant|i decline)\b/;
const YES_START=/^(yes|yeah|i am|im|i do|i have|i will|i would|i can|i identify|i agree|i consent|i acknowledge|i understand|i certify|i accept|agree|accept|true|checked)\b/;

/**
 * @description The option a form lists for the person's words, by whole words: an option that is the words, then one that
 * begins with them, then (for words of four letters or more) one that holds them. "no" never matches inside "now".
 * @param {string[]} options The form's options. @param {...string} wants The person's words, best first. @returns {number|null} Its place.
 */
function pick(options,...wants){
 const listed=(options||[]).map(norm),words=wants.map(norm).filter(Boolean);
 for(const want of words){const at=listed.indexOf(want);if(at>=0)return at;}
 for(const want of words){const at=listed.findIndex(option=>option.startsWith(want+' '));if(at>=0)return at;}
 for(const want of words.filter(word=>word.length>3)){const at=listed.findIndex(option=>has(option,want));if(at>=0)return at;}
 return null;
}
/** @description What an option means for a yes-or-no question: decline, no, yes, or null. @param {string} option @returns {string|null} */
function polarity(option){
 const words=norm(option);
 if(any(words,DECLINE))return 'decline';
 if(NO_START.test(words))return 'no';
 if(YES_START.test(words))return !/^yes\b/.test(words)&&any(words,['not','dont','do not','never'])?'no':'yes';
 return any(words,['not','dont','never'])?'no':null;
}
/** @description The first option that means `want` (yes, no or decline). @returns {number|null} */
function meaning(options,want){const at=(options||[]).findIndex(option=>polarity(option)===want);return at>=0?at:null;}
/** @description A yes or no answer: the option that means it, else the word itself in a box. @returns {object|null} */
function yesNo(options,yes,rule){
 if(!options?.length)return {answer:yes?'Yes':'No',rule};
 const at=meaning(options,yes?'yes':'no');
 return at===null?null:{option:at,rule};
}
/** @description The person's words as an answer: the option that matches them, else the words in a box. @returns {object|null} */
function say(options,rule,...words){
 const shown=words.filter(word=>typeof word==='string'&&word.trim());if(!shown.length)return null;
 if(!options?.length)return {answer:shown[0].trim(),rule};
 const at=pick(options,...shown);return at===null?null:{option:at,rule};
}
/** @description The form's prefer-not option, for a question the person did not answer. @returns {object|null} */
function declined(options,rule){const at=meaning(options,'decline');return at===null?null:{option:at,rule};}
/** @description Yes or no from a standing answer ("Yes", "No", true, false); null when it says neither. @returns {boolean|null} */
function truth(value){const words=norm(value);return /^(yes|true|y)\b/.test(words)?true:/^(no|false|n|none)\b/.test(words)?false:null;}
/** @description The span an option's numbers cover: "$150,000 - $175,000", "150k", "10+ years", "Less than 2". @returns {{low:number,high:number}|null} */
function span(option){
 const text=String(option??'').toLowerCase();
 const numbers=[...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/g)].map(([,n,k])=>Number(n.replace(/,/g,''))*(k?1000:1)).filter(Number.isFinite);
 if(!numbers.length)return null;
 const low=Math.min(...numbers),high=Math.max(...numbers);
 if(/\+|or more|and (above|up|over)|or (above|higher|greater)|more than|at least|over\b|above\b|greater than/.test(text))return {low,high:Infinity};
 if(/less than|under\b|below\b|up to|fewer than|or less|or fewer/.test(text))return {low:-Infinity,high};
 return {low,high};
}
/** @description The option whose span holds the amount. @param {string[]} options @param {number} amount @returns {number|null} */
function within(options,amount){
 if(!Number.isFinite(amount))return null;
 const at=(options||[]).findIndex(option=>{const s=span(option);return !!s&&s.low<=amount&&amount<=s.high;});
 return at>=0?at:null;
}

// ---- never by rule ---------------------------------------------------------------------------------------------
const HUMAN=['captcha','are you a robot','not a robot','are you human','verify you are human','prove you are human','security check'];
const NOT_RECORDED=['start date','date available','available to start','availability date','when can you start','when could you start','earliest start',
 'notice period','weeks notice','current notice','time off','vacation','pto','planned leave','non compete','noncompete','non solicit','nonsolicit','restrictive covenant','garden leave'];
/** A check that a person is human, or a fact no record holds: never answered by rule, so the card stays the person's. */
function never(q){
 if(/\b\d+\s*(\+|-|x|×|\*|\/|plus|minus|times)\s*\d+\b/.test(q)||any(q,HUMAN))return {rule:'never-bot-check',none:true};
 if(any(q,NOT_RECORDED))return {rule:'never-not-in-record',none:true};
 return null;
}
// ---- consents --------------------------------------------------------------------------------------------------
const OPTIONAL=['sms','text message','text messages','texting','whatsapp','marketing','newsletter','promotional','talent community','talent network','talent pool',
 'future opportunities','future job opportunities','job alerts','job alert','recruiting emails','career updates'];
const CONSENTING=['consent','agree','opt in','opt out','subscribe','receive','sign up','join','contact me','would you like','permission','allow'];
/** Marketing, text-message and recording consents: no. */
function optionalConsent(q,options){
 const recording=any(q,['record','recording','recorded'])&&any(q,['interview','call','consent','session','conversation']);
 if(!recording&&!(any(q,CONSENTING)&&any(q,OPTIONAL)))return null;
 const rule='consent-optional-no';
 return options.length?(yesNo(options,false,rule)||say(options,rule,'opt out','decline','no')):{answer:'No',rule};
}
const TERMS=/^(by (checking|clicking|selecting|submitting|signing)|i (consent|agree|acknowledge|certify|understand|hereby|have read|confirm|attest|accept)|do you (consent|agree|acknowledge|accept)|please (confirm|acknowledge|allow|read)|acknowledg|allow us to|consent|terms|privacy)/;
/** Terms, privacy and acknowledgements: yes only when the person switched Attestations' terms on. */
function terms(q,options,p){
 if(!TERMS.test(q)&&!any(q,['privacy policy','privacy notice','terms and conditions','terms of use','data processing','candidate privacy','acknowledgement','acknowledgment']))return null;
 if(p.attest?.terms!==true)return {rule:'consent-needs-attestation',none:true};
 const rule='consent-attested';
 return options.length?(yesNo(options,true,rule)||say(options,rule,'i agree','i consent','i acknowledge','i understand','agree','yes')):{answer:'Yes',rule};
}
// ---- eligibility and identity ----------------------------------------------------------------------------------
const COUNTRIES={'united states':['United States','United States of America','USA','US','U.S.','U.S.A.','America'],'united kingdom':['United Kingdom','UK','Great Britain','Britain','England'],
 canada:['Canada'],australia:['Australia'],india:['India'],germany:['Germany'],ireland:['Ireland'],mexico:['Mexico'],france:['France'],'new zealand':['New Zealand'],
 netherlands:['Netherlands'],spain:['Spain'],brazil:['Brazil'],japan:['Japan'],singapore:['Singapore'],israel:['Israel'],poland:['Poland']};
/** @description A country's names, the person's own words first. @param {string} country @returns {string[]} */
function countryNames(country){
 const key=norm(country);if(!key)return [];
 const found=Object.entries(COUNTRIES).find(([name,list])=>name===key||list.some(word=>norm(word)===key));
 return found?[country,...found[1]]:[country];
}
/** @description Whether the question names a country that is not the person's. @returns {boolean} */
function otherCountry(q,p){
 const mine=new Set(countryNames(p.country).map(norm));
 return Object.values(COUNTRIES).some(list=>list.some(word=>norm(word).length>2&&has(q,word)&&!mine.has(norm(word))))&&!countryNames(p.country).some(word=>norm(word).length>2&&has(q,word));
}
const AUTHORIZED=/(authori[sz]ed|eligible|eligibility|legal(ly)? (right|able|permitted|entitled)|right to work|permitted to work|entitled to work)/;
function authorization(q,options,p){
 const sponsor=any(q,['sponsor','sponsorship','sponsored']),authorized=AUTHORIZED.test(q)&&any(q,['work','employment','employed']);
 if(sponsor&&authorized)return null;
 if(sponsor){const yes=truth(p.standing?.sponsorship);return yes===null?null:yesNo(options,yes,'eligibility-sponsorship');}
 if(!authorized||otherCountry(q,p))return null;
 const yes=truth(p.standing?.workAuthorization);return yes===null?null:yesNo(options,yes,'eligibility-authorized');
}
/** @description Whether the person's citizenship answer names the United States (null when they gave none). @returns {boolean|null} */
function usCitizen(p){
 const words=norm(p.standing?.citizenship);if(!words)return null;
 if(/^(no|none|not)\b/.test(words))return false;
 return any(words,['united states','u s','us','usa','american'])&&!any(words,['not a','non citizen','noncitizen']);
}
function citizenship(q,options,p){
 if(/\b(u s|us|united states|american) citizen|citizen of the (u s|us|united states|usa)\b/.test(q)){const yes=usCitizen(p);return yes===null?null:yesNo(options,yes,'eligibility-citizen');}
 if(!has(q,'citizenship')&&!/country (of|where you hold) citizenship/.test(q))return null;
 const own=p.standing?.citizenship;if(!own)return null;
 return say(options,'eligibility-citizenship',own,...(usCitizen(p)?['U.S. Citizen','US Citizen','United States Citizen','Citizen']:[]));
}
/** @description Whether the record proves the person is 18 or older: a role or school dated 18 or more years ago. @returns {boolean} */
function adult(p){
 const year=Number(String(p.today||new Date().toISOString()).slice(0,4)),dates=[...(p.roles||[]).map(role=>role.start),...(p.education||[]).flatMap(school=>[school.start,school.end])];
 return dates.map(value=>Number(String(value??'').slice(0,4))).some(found=>found>=1900&&found<=year-18);
}
function age(q,options,p){
 if(!(/\b(18|eighteen)\b/.test(q)&&any(q,['age','older','years','old']))&&!any(q,['legal age','of legal age','legal working age']))return null;
 return adult(p)?yesNo(options,true,'eligibility-age'):null;
}
const LEVELS=['ts sci','top secret','secret','confidential','public trust','q clearance','l clearance','dod secret','interim secret'];
function clearance(q,options,p){
 if(!has(q,'clearance'))return null;
 const saved=(p.saved||[]).find(item=>has(norm(item.text),'clearance')&&norm(item.value));if(!saved)return null;
 const words=norm(saved.value),level=LEVELS.find(item=>has(words,item)),active=!!level&&!any(words,['inactive','expired','lapsed','none','no','not']);
 if(any(q,['level','which','type of','what type','what kind','highest'])||options.some(option=>LEVELS.some(item=>has(norm(option),item))))
  return say(options,'eligibility-clearance-level',saved.value,...(level?[level]:[]));
 if(any(q,['currently','active','hold','held','have','possess','current']))return yesNo(options,active,'eligibility-clearance');
 return active?yesNo(options,true,'eligibility-clearance'):null;
}
const RACES={white:['White','White (Not Hispanic or Latino)','Caucasian'],'black or african american':['Black or African American','Black','African American'],asian:['Asian'],
 'american indian or alaska native':['American Indian or Alaska Native','American Indian','Native American'],'native hawaiian or other pacific islander':['Native Hawaiian or Other Pacific Islander','Native Hawaiian','Pacific Islander'],
 'two or more races':['Two or More Races','Two or more','Multiracial']};
function selfId(q,options,p){
 const s=p.standing||{};
 if(any(q,['transgender','sexual orientation','lgbt','lgbtq','lgbtqia','pronoun','pronouns']))return declined(options,'selfid-not-in-record');
 if(has(q,'veteran')){const yes=truth(s.veteranStatus);return yes===null?declined(options,'selfid-declined'):yesNo(options,yes,'selfid-veteran');}
 if(has(q,'disability')||has(q,'disabled')){const yes=truth(s.disabilityStatus);return yes===null?declined(options,'selfid-declined'):yesNo(options,yes,'selfid-disability');}
 if(any(q,['race','racial'])||(any(q,['ethnicity','ethnic'])&&!any(q,['hispanic','latino']))){
  if(truth(s.hispanicLatino)===true){const found=say(options,'selfid-hispanic','Hispanic or Latino','Hispanic','Latino');if(found)return found;}
  const race=RACES[norm(s.race)];return race?say(options,'selfid-race',...race):declined(options,'selfid-declined');
 }
 if(any(q,['hispanic','latino','latinx'])){const yes=truth(s.hispanicLatino);return yes===null?declined(options,'selfid-declined'):yesNo(options,yes,'selfid-hispanic');}
 if(has(q,'gender')||(has(q,'sex')&&!has(q,'sexual'))){
  const gender=norm(s.gender);
  return gender==='male'?say(options,'selfid-gender','Male','Man'):gender==='female'?say(options,'selfid-gender','Female','Woman'):declined(options,'selfid-declined');
 }
 return null;
}
// ---- location and work pattern ---------------------------------------------------------------------------------
const ZONES={eastern:['CT','DE','DC','GA','ME','MD','MA','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV'],central:['AL','AR','IL','IA','LA','MN','MS','MO','OK','WI'],
 mountain:['AZ','CO','MT','NM','UT','WY'],pacific:['CA','NV','WA'],hawaii:['HI'],alaska:['AK']};
const ZONE_WORDS={eastern:['Eastern Time (ET)','Eastern','EST','ET','US/Eastern','America/New_York'],central:['Central Time (CT)','Central','CST','CT','US/Central','America/Chicago'],
 mountain:['Mountain Time (MT)','Mountain','MST','MT','US/Mountain','America/Denver'],pacific:['Pacific Time (PT)','Pacific','PST','PT','US/Pacific','America/Los_Angeles'],
 hawaii:['Hawaii Time (HT)','Hawaii','HST','Pacific/Honolulu'],alaska:['Alaska Time (AKT)','Alaska','AKST','America/Anchorage']};
/** @description The person's time zone: a saved answer about it, else the one zone their US state lies in (none for a state split between two). */
function zoneOf(p){
 const saved=(p.saved||[]).find(item=>any(norm(item.text),['time zone','timezone'])&&norm(item.value));if(saved)return [saved.value];
 if(usCountry(p)===false)return [];
 const abbrev=String(p.stateAbbrev||'').toUpperCase(),zone=Object.keys(ZONES).find(name=>ZONES[name].includes(abbrev));
 return zone?ZONE_WORDS[zone]:[];
}
/** @description Whether the person lives in the United States (null when the record does not say). */
function usCountry(p){const words=norm(p.country);return words?countryNames('United States').some(name=>norm(name)===words):null;}
/** @description Whether the job is within the person's Matching area (null when either distance or radius is unknown). */
function nearJob(p){const miles=p.job?.distanceMiles,radius=p.home?.radiusMiles;return Number.isFinite(miles)&&Number.isFinite(radius)?miles<=radius:null;}
const OFFICE=/\boffice\b|on ?site|in ?person|hybrid|days (a|per) week|\bhq\b|headquarters|anchor day|commut/;
function workPattern(q,options,p){
 const miles=/live within (\d+) ?miles|within (\d+) ?miles of/.exec(q);
 if(miles){const limit=Number(miles[1]||miles[2]),d=p.job?.distanceMiles;return Number.isFinite(d)?yesNo(options,d<=limit,'location-within-miles'):null;}
 const relocate=/relocat|\b(move|moving) to\b/.test(q),office=OFFICE.test(q)&&any(q,['willing','able','available','open','comfortable','agree','can you','are you','do you']);
 if(!relocate&&!office)return null;
 const near=nearJob(p);return near===null?null:yesNo(options,near,relocate?'location-relocation':'location-office');
}
function stateRule(q,options,p){
 if(/reside in any of the following states|live in any of the following states|resident of any of the following states|located in any of the following states/.test(q)){
  if(!p.state)return null;
  const named=has(q,p.state)||(p.stateAbbrev&&new RegExp('(^|[\\s,(/])'+p.stateAbbrev.toUpperCase()+'([\\s,)./]|$)').test(p.question||''));
  return yesNo(options,named,'location-states-listed');
 }
 if(['state','state of residence','state province','state or province','what state do you live in','which state do you live in','what state do you reside in','state region'].includes(q))
  return say(options,'location-state',p.state,p.stateAbbrev);
 return null;
}
const SANCTIONED=['cuba','iran','north korea','syria','crimea','sudan','belarus','russia','venezuela'];
function countryRule(q,options,p){
 if(/(citizen|resident|national) of any of the following countries|following (sanctioned|embargoed) countries/.test(q)||(has(q,'cuba')&&has(q,'iran'))){
  const mine=[p.country,p.standing?.citizenship].map(norm).filter(Boolean);
  if(!mine.length||SANCTIONED.some(name=>mine.some(own=>has(own,name))))return null;
  return options.length?(yesNo(options,false,'location-sanctioned')||say(options,'location-sanctioned','none of the above','none','i am not','no')):{answer:'No',rule:'location-sanctioned'};
 }
 if(/(which|what) country do you (currently )?(live|reside)|country of residence|country you (live|reside) in|which country are you (applying|located)|applying from which country/.test(q)||q==='country')
  return say(options,'location-country',...countryNames(p.country));
 if(/time ?zone/.test(q))return say(options,'location-time-zone',...zoneOf(p));
 return null;
}
function whereFrom(q,options,p){
 if(!/where (do|will|would) you (intend to |plan (on|to) )?(work|be working|be located)|from where do you|current location|where are you (currently )?(located|based)|plan on working from|working from|city of residence|what city/.test(q)
   &&!(options.length&&any(q,['located in','geograph','reside in','based in','region'])))return null;
 if(options.length)return say(options,'location-where',p.city&&p.state?`${p.city}, ${p.state}`:'',p.state,...countryNames(p.country),'north america','americas');
 const place=[p.city,p.state,p.country].filter(Boolean).join(', ');return place?{answer:place,rule:'location-where'}:null;
}
// ---- career facts ----------------------------------------------------------------------------------------------
const SUFFIXES=['inc','incorporated','llc','l l c','ltd','limited','corp','corporation','co','company','plc','lp','llp','gmbh','group','holdings','the'];
const orgWords=name=>norm(name).split(' ').filter(word=>word&&!SUFFIXES.includes(word));
/** @description Whether the record shows a role at this employer; null when the job's employer or the work history is unknown. @returns {boolean|null} */
function workedHere(p){
 const want=orgWords(p.job?.company),roles=(p.roles||[]).filter(role=>orgWords(role.org).length);if(!want.length||!roles.length)return null;
 return roles.some(role=>{const have=orgWords(role.org);return want.every(word=>have.includes(word))||have.every(word=>want.includes(word));});
}
/** @description Whole years the roles' dates cover, overlaps counted once; null with no dated role. @returns {number|null} */
function careerYears(p){
 const now=Date.parse(p.today||new Date().toISOString()),at=value=>{const m=/^(\d{4})(?:-(\d{1,2}))?/.exec(String(value??''));return m?Date.UTC(+m[1],(m[2]?+m[2]:1)-1,1):null;};
 const spans=(p.roles||[]).map(role=>[at(role.start),role.end?at(role.end):now]).filter(([a,b])=>a!==null&&b!==null&&a<=b).sort((x,y)=>x[0]-y[0]);
 if(!spans.length)return null;
 let total=0,[from,to]=spans[0];
 for(const [a,b] of spans.slice(1)){if(a<=to)to=Math.max(to,b);else{total+=to-from;[from,to]=[a,b];}}
 return Math.floor((total+to-from)/(365.25*24*3600e3));
}
const GENERIC=new Set(['systems','system','software','tools','tool','platforms','platform','technologies','technology','environment','environments','solutions','applications','application',
 'products','product','such','as','the','a','an','and','or','any','of','in','with','using','experience','years','year','working','work','hands','on','professional','relevant','your','you','do','have']);
const stem=word=>word.replace(/(ings|ing|ants|ant|ents|ent|ers|er|ed|s)$/,'').length>=4?word.replace(/(ings|ing|ants|ant|ents|ent|ers|er|ed|s)$/,''):word;
/** @description Whether every working word of an area the question names appears in the record's roles and skills. @returns {boolean} */
function recordNames(p,area){
 const words=norm(area).split(' ').filter(word=>word&&!GENERIC.has(word)).map(stem);if(!words.length)return false;
 const record=new Set(norm(p.recordText).split(' ').map(stem));
 return words.every(word=>record.has(word));
}
function names(q,options,p){
 const f=p.facts||{},text=(value,rule)=>!options.length&&value?{answer:value,rule}:null;
 if(has(q,'first name')||has(q,'given name'))return text(f['name.first'],'fact-first-name');
 if(has(q,'last name')||has(q,'surname')||has(q,'family name'))return text(f['name.last'],'fact-last-name');
 if(has(q,'preferred name')||has(q,'nickname'))return {rule:'never-not-in-record',none:true};
 if(['name','your name','full name','legal name','full legal name'].includes(q)||has(q,'full name')||has(q,'legal name'))return text(f['name.full'],'fact-full-name');
 if(/^(current|present|most recent) (company|employer)|current employer|company you (currently )?work for|current or most recent (company|employer)|name of your current (company|employer)/.test(q))return text(f['work.employer'],'fact-current-employer');
 if(/current (job )?title|current position|most recent (job )?title/.test(q))return text(p.currentTitle,'fact-current-title');
 if(has(q,'linkedin'))return text(f['links.linkedin'],'profile-linkedin');
 if(has(q,'github'))return text(f['links.github'],'profile-github');
 if(any(q,['website','portfolio','personal site','personal url','blog','web site']))return any(q,['other','additional','second'])?null:text(f['links.website'],'profile-website');
 return null;
}
function experience(q,options,p){
 if(/how many years of (relevant |total |professional |work |industry |overall )*(work )?experience( do you have)?$/.test(q)){
  const years=careerYears(p);if(years===null)return null;
  if(!options.length)return {answer:String(years),rule:'fact-years'};
  const at=within(options,years);return at===null?null:{option:at,rule:'fact-years'};
 }
 if(/(ever|previously|currently|formerly|before|in the past) (worked|been employed|employed|work)\b.*\b(for|by|at|with)\b|former employee|have you (ever )?worked (for|at)|previous(ly)? employ|been an employee of|current or former employee/.test(q))
  {const here=workedHere(p);return here===null?null:yesNo(options,here,'fact-worked-here');}
 const area=/(?:experience (?:with|in|using|working with)|worked with|familiar(?:ity)? with|proficien(?:t|cy) (?:in|with)|knowledge of)\s+([^?.!,;]{2,60})/.exec(q);
 if(area&&!/\b\d+\b/.test(q)&&recordNames(p,area[1]))return yesNo(options,true,'fact-area-in-record');
 return null;
}
const PAY=['salary','compensation','pay expectation','pay expectations','expected pay','desired pay','pay range','base pay','expected salary','desired salary','hourly rate','wage expectation'];
function pay(q,options,p){
 if(!any(q,PAY)||any(q,['current salary','current compensation','current pay','salary history']))return null;
 const saved=(p.saved||[]).find(item=>any(norm(item.text),PAY)&&!any(norm(item.text),['current salary','salary history'])&&/\d/.test(item.value));if(!saved)return null;
 if(!options.length)return {answer:saved.value,rule:'pay-saved-answer'};
 const found=span(saved.value),at=found?within(options,Number.isFinite(found.low)?found.low:found.high):null;
 return at===null?null:{option:at,rule:'pay-saved-answer'};
}
// ---- the job's own words ---------------------------------------------------------------------------------------
const WHY=['what interests you','what excites you','what draws you','why do you want to work','why are you interested','tell us why','why would you like to work','why you are interested','what attracts you','why do you want to join'];
function whyUs(q,options,p){
 if(options.length||!(/^why (do you want|are you interested|are you excited|would you like|this (role|position|company|job|team)|us\b|join|work)/.test(q)||any(q,WHY)))return null;
 return p.letter?{answer:p.letter,rule:'why-us-letter'}:null;
}
/** Only a question about where the person found the job: "We would love to hear about something you built" is an essay. */
const HEARD=/\bhow (did|do) you (first )?(hear|learn|find out) (about|of)\b|\bhow did you (find|discover|come across)\b|\bwhere did you (first )?(find|see|hear|come across|learn)\b|\breferral source\b|\bhow you (heard|learned|found) (about|of)\b|\bsource of (this )?application\b|^source$/;
function heard(q,options,p){
 if(!HEARD.test(q))return null;
 const own=p.standing?.heard&&say(options,'heard-standing',p.standing.heard);if(own)return own;
 if(!options.length)return {answer:'Company careers website',rule:'heard-careers-site'};
 const at=pick(options,'company website','company careers website','careers page','career site','careers site','company career','employer website','website','job board','internet','online','other');
 return at===null?null:{option:at,rule:'heard-careers-site'};
}
/** A box that asks to specify an "Other" the person did not choose. */
function other(q,options){return !options.length&&(q==='other'||/^(if (you answered |you selected |you chose )?other|other please specify|other specify|please specify other)\b/.test(q))&&q.length<=60?{answer:'N/A',rule:'other-not-applicable'}:null;}

/** The families, in order: what is never answered first, then the optional consents, so "I agree to receive texts" is a no. */
const FAMILIES=[never,optionalConsent,authorization,citizenship,age,clearance,selfId,terms,workPattern,stateRule,countryRule,whereFrom,names,experience,pay,whyUs,heard,other];
/**
 * @description The answer the person's own record gives one question: {option, rule} (the option's place), {answer, rule}
 * (the words for a box, or for a list that names its options only once opened), {none:true, rule} for a question never
 * answered by rule, or null when no rule settles it. Either of the last two leaves the card for the person.
 * @param {string} question The question's exact words. @param {string[]} [options] The options the form lists.
 * @param {object} person The person view (career-apply-record-person.js). @returns {object|null}
 */
function settle(question,options,person){
 const raw=String(question??'').replace(/^\s*\(required\)\s*/i,'').replace(/[*\s:]+$/,''),q=norm(raw);if(!q)return null;
 const opts=(Array.isArray(options)?options:[]).filter(option=>typeof option==='string'&&option.trim()),p={...(person||{}),question:raw};
 for(const family of FAMILIES){const result=family(q,opts,p);if(result)return result;}
 return null;
}
/** @description Whether a settle() result is an answer (not a refusal). @param {object|null} result @returns {boolean} */
const answered=result=>!!result&&!result.none&&(Number.isInteger(result.option)||typeof result.answer==='string');
module.exports={settle,answered,pick,polarity,within,span,careerYears,adult,workedHere,recordNames,norm};
