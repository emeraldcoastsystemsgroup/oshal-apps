/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I: the task carries flags {input, window, submit}, How Career fills in a form from the person's Saved answers (career-apply-flags.js; like a person, in front, stop before Submit unless he chose otherwise), under the approval digest; the review says each in words (flagLines) and its last line says Career presses Submit once when he chose Submit after I approve. His standing veteran and disability answers are the facts selfid.veteran and selfid.disability (yes or no; a blank one is no fact, so the form's question is declined), and his citizenship the fact eligibility.citizenship.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 5.3 and Appendix C): the approved input of an assisted application, browser-task version 2. It carries this job's Word and PDF résumé and the PDF cover letter, each checked by its kind (PK for Word, %PDF- for PDF) and digested; the facts from the person's record that may be typed (normalizeAutofillProfile and the standing answers); the roles in this job's résumé with their recorded dates and deliverables; education; the saved answers; and the employer site's rules (lib/apply-profiles). Today's approval accepted only PDFs (career-submission-native.js review). Nothing here is invented: every value is read from the person's own store, and a date the record holds only as a year stays a year.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (the owner's answer to design question 1): the task carries attest {terms, selfIdSignature} from the person's Attestations switches, false unless he switched one on, under the approval digest, so a switch changed after approval does not reach that run; the review says each in words.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the facts carry the state's abbreviation beside its full name (address.state_abbrev; the site's rules pick which a field takes) and posting.employer, the posting's employer, which the kernel's rules read for Previously worked for this employer. With normalizeAutofillProfile now reading application_contact, a record's street, city, state, postal code and country reach address.line1, address.city, address.state, address.postal and address.country.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G): an employer site Career has no rules for is no longer refused as site_unsupported. Which form is filled and in which rules comes from career-apply-sites.js formFor (the posting's own engine, the engine its company page embeds at that engine's own address, else the generic site); the approval screen names it, says where an embedded form really opens, and for a site filled in the careful general rules says what that means and that Career stops before any button that sends the application.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: an installation may name exact hosts that use a site's form, in the package setting CAREER_APPLY_SITE_HOSTS ({"workday":["careers.example.com"]}): an employer whose own careers address fronts its Workday form. A malformed setting is refused, never half read; a host is matched exactly, never as a suffix.
 */
'use strict';
const queue=require('./career-submission-queue'),roles=require('./career-resume-roles'),sites=require('./career-apply-sites'),flagsOf=require('./career-apply-flags');

const MIME={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf'};
const MAGIC={docx:Buffer.from([0x50,0x4b,0x03,0x04]),pdf:Buffer.from('%PDF-')};
const MAX_DOCUMENT=2*1024*1024,MAX_INPUT=1024*1024,MAX_TEXT=512,MAX_ANSWER=2000;
/** The bounds ADR-221 gives one run (design 2.6), fixed in every approval. */
const BOUNDS=Object.freeze({advancing:16,entries:20,edits:400,activeMs:1800000,waitMs:1800000});
/** Fact slots and where each is read: normalizeAutofillProfile's keys, then the standing answers. */
const FACT_SLOTS=[['name.first','firstName'],['name.middle','middleName'],['name.last','lastName'],['name.full','fullName'],
 ['email','email'],['phone','phone'],['address.line1','addressLine1'],['address.line2','addressLine2'],['address.city','city'],
 ['address.state','state'],['address.state_abbrev','stateAbbrev'],['address.postal','postalCode'],['address.country','country'],['links.linkedin','linkedin'],
 ['links.website','website'],['links.github','github'],['eligibility.authorized','workAuthorization'],['eligibility.sponsorship','sponsorship']];
const STANDING_SLOTS=[['source.heard','heard'],['phone.type','phoneType'],['eligibility.citizenship','citizenship']];
/** His standing self-identification answers, as the kernel takes them: yes or no, and no fact for a blank one (declined). */
const SELFID_SLOTS=[['selfid.veteran','veteranStatus'],['selfid.disability','disabilityStatus']];
/** The posting's employer, which the kernel reads for Previously worked for this employer (its fact posting.employer). */
const POSTING_SLOT='posting.employer';
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};
const text=value=>typeof value==='string'||typeof value==='number'?String(value).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_TEXT):'';

/** @description A file name part without characters a file system refuses. @param {*} value @returns {string} */
const safeName=value=>String(value??'').replace(/[\u0000-\u001f\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
/**
 * @description The name a document carries in the employer's form: <Company> - <Title> - Job <id> - <Document>.<ext>, the
 * name the Send step's downloads already have. @param {object} posting @param {string} label @param {string} ext @returns {string}
 */
function documentName(posting,label,ext){return [safeName(posting.company)||'Employer',safeName(posting.title)||'Job','Job '+posting.id,label].join(' - ')+'.'+ext;}
/**
 * @description One packet document, refused unless its bytes are the kind its name says.
 * @param {string} id resume-docx, resume-pdf or cover-pdf. @param {object} posting @param {Buffer} bytes @returns {object} The document.
 */
function document(id,posting,bytes){
 const kind=id.endsWith('docx')?'docx':'pdf',label=id.startsWith('cover')?'Cover Letter':'Resume';
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX_DOCUMENT||!bytes.subarray(0,MAGIC[kind].length).equals(MAGIC[kind]))
  fail('packet_unavailable',kind==='docx'?'This job’s Word résumé is unavailable. Generate the documents again.':'Generate and review both the résumé and cover letter first.');
 return {id,name:documentName(posting,label,kind),type:MIME[kind],sha256:queue.digest(bytes),bytes};
}
/**
 * @description The facts that may be typed, by slot: only values the record holds, never a derived guess.
 * @param {object} profile normalizeAutofillProfile output. @param {object} standing {heard, phoneType}. @returns {Record<string,string>}
 */
function facts(profile,standing){
 const out={};
 for(const [slot,key] of FACT_SLOTS){const value=text(profile?.[key]);if(value)out[slot]=value;}
 if(!out['name.full']&&out['name.first']&&out['name.last'])out['name.full']=[out['name.first'],out['name.middle'],out['name.last']].filter(Boolean).join(' ');
 for(const [slot,key] of STANDING_SLOTS){const value=text(standing?.[key]);if(value)out[slot]=value;}
 for(const [slot,key] of SELFID_SLOTS){const value=text(standing?.[key]).toLowerCase();if(value==='yes'||value==='no')out[slot]=value;}
 return out;
}
/**
 * @description A recorded date as the record holds it: YYYY-MM when it names a month, YYYY when it names only a year,
 * null when it names neither. A year is never given a month here; the run asks for it.
 * @param {*} value A role's or school's start or end. @returns {string|null}
 */
function recordedDate(value){
 const source=text(value);if(!source)return null;
 if(/^(19|20)\d{2}$/.test(source))return source;
 const found=roles.month(source,false),years=source.match(/\b(19|20)\d{2}\b/g)||[];
 const named=/\b(\d{4})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{4})\b|\b[a-z]{3,9}\.?,?\s+\d{4}\b/i.test(source);
 if(found&&named)return found[0]+'-'+String(found[1]).padStart(2,'0');
 return years.length===1?years[0]:null;
}
/** @description A role's recorded deliverables, word for word, bounded. @param {object} role @returns {string[]} */
const deliverables=role=>(Array.isArray(role?.deliverables)?role.deliverables:[]).map(item=>String(item??'').trim()).filter(Boolean).slice(0,20).map(item=>item.slice(0,MAX_ANSWER));
/** @description Start and end read from a résumé's own span ("Apr 2019 to Present"), for an entry no recorded role matches. @param {*} span @returns {{start:string|null,end:string|null,current:boolean}} */
function spanDates(span){
 const parts=text(span).split(/\s+(?:to|-|–|—)\s+/i),current=/\b(present|current|now)\b/i.test(parts[1]||'');
 return {start:recordedDate(parts[0]),end:current?null:recordedDate(parts[1]),current};
}
/**
 * @description The roles in this job's résumé, each with its title and employer as the résumé has them and its dates
 * and deliverables as the record has them; and, kept out of the packet, which recorded role each one is, so a month the
 * person gives later is written to that role. @param {object} resume The job's generated résumé. @param {object} careerDb
 * The person's record. @returns {{roles:object[],links:(object|null)[]}}
 */
function packetRoles(resume,careerDb){
 const plan=roles.plan(careerDb||{}),recorded=Array.isArray(careerDb?.roles)?careerDb.roles:[],list=[],links=[];
 const items=(Array.isArray(resume?.experience)?resume.experience:[]).filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).slice(0,30);
 for(const item of items){
  const matches=roles.rolesOf(item,plan),entry=matches.length===1?matches[0]:null,role=entry?recorded[entry.index]:null;
  const title=text(item.title)||text(role?.title),employer=text(item.org||item.employer)||text(role?.org);
  if(!title&&!employer)continue;
  const own=role?{start:recordedDate(role.start),end:roles.isCurrent(role)?null:recordedDate(role.end)}:spanDates(item.span);
  list.push({title,employer,start:own.start,end:own.end,deliverables:deliverables(role)});
  links.push(role?{roleIndex:entry.index,title:text(role.title),org:text(role.org),start:role.start==null?'':String(role.start),end:role.end==null?'':String(role.end)}:null);
 }
 return {roles:list,links};
}
const DEGREE=/^(master of business administration|(?:bachelor|master|doctor|associate) of (?:applied science|fine arts|science|arts|engineering|education|laws|philosophy)|(?:bachelor|master|associate)'?s(?: degree)?|mba|ph\.?\s?d\.?|b\.?\s?sc\.?|m\.?\s?sc\.?|b\.?\s?eng\.?|m\.?\s?eng\.?|b\.?\s?s\.?|b\.?\s?a\.?|m\.?\s?s\.?|m\.?\s?a\.?|bba|j\.?\s?d\.?)(?=[\s,]|$)/i;
const SCHOOL=/universit|college|institut|school|academy|polytechnic/i;
/** @description One education entry as the record writes it, an object or one statement such as "BS, Computer Science | State University | 2009 - 2013". @param {*} entry @returns {object|null} */
function school(entry){
 if(entry&&typeof entry==='object'&&!Array.isArray(entry)){
  const item={school:text(entry.school||entry.institution),degree:text(entry.degree),field:text(entry.field||entry.major)||null,
   start:recordedDate(entry.start??entry.from),end:recordedDate(entry.end??entry.to??entry.year)};
  return item.school||item.degree?item:null;
 }
 const statement=text(entry);if(!statement)return null;
 const years=statement.match(/\b(19|20)\d{2}\b/g)||[],parts=statement.split(/\s+\|\s+|\s+[—–]\s+|,\s+/).map(text).filter(part=>part&&!/^\D{0,3}(19|20)\d{2}/.test(part));
 const degreePart=parts.find(part=>DEGREE.test(part))||'',found=degreePart.match(DEGREE),rest=found?degreePart.slice(found[0].length).replace(/^\s*(?:in|of)\s+/i,'').trim():'';
 const after=parts[parts.indexOf(degreePart)+1],field=rest||(after&&!SCHOOL.test(after)&&!DEGREE.test(after)?after:'');
 const item={school:parts.find(part=>SCHOOL.test(part)&&part!==degreePart)||'',degree:found?found[0]:'',field:field||null,
  start:years.length>1?years[0]:null,end:years.length?years[years.length-1]:null};
 return item.school||item.degree?item:null;
}
/** @description The record's education, at most ten schools. @param {object} careerDb @returns {object[]} */
const education=careerDb=>(Array.isArray(careerDb?.education)?careerDb.education:[]).map(school).filter(Boolean).slice(0,10);
/** @description The saved answers the run may use, by Career's question id. @param {object[]} saved @returns {object[]} */
const answers=saved=>(Array.isArray(saved)?saved:[]).filter(item=>/^question:[a-f0-9]{64}$/.test(item?.id||'')&&text(item.text)&&typeof item.value==='string'&&item.value.trim())
 .slice(0,200).map(item=>({id:item.id,text:text(item.text),value:item.value.trim().slice(0,MAX_ANSWER)}));

/**
 * @description Everything one approval covers, from material the server read from the person's own store. The form is
 * the posting's own engine, the engine its company page embeds, or the generic site (career-apply-sites formFor). Refused
 * when the address is not a public HTTPS posting, a document is missing or of the wrong kind, or
 * the record has no name and email. @param {object} material {posting, profile, standing, careerDb, resume, resumeDocx,
 * resumePdf, coverPdf, answers}. @returns {{site:object,task:object,links:object[],packetDigest:string}}
 */
function build(material){
 const {posting}=material,{url,site}=sites.formFor({...posting,url:queue.jobUrl(posting?.url)});
 const rules=sites.siteRules(site.id),documents=[document('resume-docx',posting,material.resumeDocx),document('resume-pdf',posting,material.resumePdf)];
 if(material.coverPdf)documents.push(document('cover-pdf',posting,material.coverPdf));
 const known=facts(material.profile,material.standing),employer=text(posting.company);if(employer)known[POSTING_SLOT]=employer;
 if(!known.email||!(known['name.first']||known['name.full']))fail('profile_incomplete','Add your name and email to your record before Career fills in a form.');
 const {roles:list,links}=packetRoles(material.resume,material.careerDb);
 const attest={terms:material.attest?.terms===true,selfIdSignature:material.attest?.selfIdSignature===true};
 const flags=flagsOf.read({[flagsOf.FIELD]:material.flags});
 const task={postingId:posting.id,url,documents,facts:known,roles:list,education:education(material.careerDb),answers:answers(material.answers),attest,flags,rules};
 const binding={...task,documents:documents.map(({id,name,type,sha256})=>({id,name,type,sha256}))};
 return {site,task,links,packetDigest:queue.jsonDigest(binding)};
}
const SLOT_LABELS={'name.first':'First name','name.middle':'Middle name','name.last':'Last name','name.full':'Full name','email':'Email','phone':'Phone',
 'phone.type':'Phone type','address.line1':'Address','address.line2':'Address line 2','address.city':'City','address.state':'State','address.state_abbrev':'State abbreviation','address.postal':'Postal code',
 'address.country':'Country','links.linkedin':'LinkedIn','links.website':'Website','links.github':'GitHub','eligibility.authorized':'Authorized to work',
 'eligibility.sponsorship':'Needs sponsorship','source.heard':'How you heard about the job','posting.employer':'This employer'};
/**
 * @description The Attestations switches as the approval screen says them. @param {{terms:boolean,selfIdSignature:boolean}} attest
 * @returns {string[]} One sentence each.
 */
const attestLines=attest=>[attest.terms?'Career ticks the employer’s terms box for you, in your name.':'You tick the employer’s terms box yourself. Career hands it back to you there.',
 attest.selfIdSignature?'Career signs the self-identification form with your name and today’s date, in your name.':'You sign the self-identification form yourself. Career hands it back to you there.'];
/** @description Where the run stops, as the approval screen says it. @param {{id:string}} site @returns {string} */
const stopLine=site=>site.id==='generic'?'Career stops before any button that sends the application. You press it.':'Career stops at the employer’s Review page. You press Submit.';
/**
 * @description What the approval screen says about how this form is filled: where an embedded form really opens, and
 * what the careful general rules of a site Career has no rules for are. @param {object} site @param {string} host @returns {string[]}
 */
function modeLines(site,host){
 const lines=site.embeddedOn?[`${site.embeddedOn} shows the ${site.name} form; Career opens that form at ${host}.`]:[];
 if(site.id==='generic')lines.push('Career has no rules for this site, so it types your record only into fields whose words say exactly what they are, asks you everything else, and moves pages only with Next or Continue.');
 return lines;
}
/** @description A slot's place on the approval screen, in SLOT_LABELS' order (Phone type under Phone). @param {string} slot @returns {number} */
const shown=slot=>{const at=Object.keys(SLOT_LABELS).indexOf(slot);return at<0?999:at;};
/**
 * @description What the approval screen shows: the exact documents with their versions, the facts that may be typed,
 * the résumé's roles with dates, education, the saved answers, the site and the stop at Review. No document bytes.
 * @param {object} material As build takes. @returns {object} The review.
 */
function review(material){
 const built=build(material),{task,site}=built;
 return {postingId:task.postingId,title:material.posting.title,company:material.posting.company,url:task.url,host:new URL(task.url).hostname,
  site,uploads:task.rules.document,documents:task.documents.map(({id,name,type,sha256,bytes})=>({id,name,type,sha256,byteLength:bytes.length})),
  facts:Object.entries(task.facts).sort(([a],[b])=>shown(a)-shown(b)).map(([slot,value])=>({slot,label:SLOT_LABELS[slot]||slot,value})),roles:task.roles,education:task.education,
  answers:task.answers,attest:task.attest,attestLines:attestLines(task.attest),flags:task.flags,flagLines:flagsOf.lines(task.flags),stop:flagsOf.stopLine(task.flags,stopLine(site)),mode:modeLines(site,new URL(task.url).hostname),packetDigest:built.packetDigest};
}
/**
 * @description The approved input of one attempt, Appendix C: its own attempt number and request digest over the same
 * approved task. Refused past 1 MiB. @param {{id:string,attempt:number,expiresAt:number,task:object}} run @returns {object}
 */
function input({id,attempt,expiresAt,task}){
 const documents=task.documents.map(({id:doc,name,type,sha256,bytes})=>({id:doc,name,type,sha256,base64:bytes.toString('base64')}));
 const bound={version:2,intentId:id,attempt,origin:new URL(task.url).origin,expiresAt,mode:'assist',bounds:{...BOUNDS},
  task:{submissionId:id,postingId:task.postingId,url:task.url,documents,facts:task.facts,roles:task.roles,education:task.education,answers:task.answers,attest:task.attest,flags:task.flags,rules:task.rules}};
 const value={...bound,requestDigest:queue.jsonDigest(bound)};
 if(Buffer.byteLength(JSON.stringify(value))>MAX_INPUT)fail('packet_too_large','These documents are too large to send to your computer (1 MB in all).');
 return value;
}
module.exports={BOUNDS,MIME,siteFor:sites.siteFor,siteRules:sites.siteRules,documentName,facts,recordedDate,packetRoles,education,answers,build,review,input};
