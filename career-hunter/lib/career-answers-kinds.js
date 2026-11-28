/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review (design career-self-improving-applications-2026-11-27 part 4, written questions): what kind of question an employer's form asked, read the same way for a card and for the words a run waited with. A check that a person is human (arithmetic, captcha words) is a check: never drafted, never kept for reuse. A fact no record holds (start date, notice period, time off, a non-compete, pay) or a question with listed options is a plain question for the person. A question that asks for prose (Tell us about, Describe, Why, What platform have you built, Have you owned ... If so, When working on ...) is a written question Career drafts from the record. A month card (In which month of 2012 did you start as ...) fills the record and stays the job page's. key() is the same question at any employer: its words folded (accents, case, punctuation) and digested, with no field type. idsFor() gives the question ids a run looks up for those words (career-apply-answers questionId), exactId() the one the kernel's card id names (career-apply-sync cardId).
 */
'use strict';
const crypto=require('node:crypto');
const {questionId}=require('./career-apply-answers'),{cardId}=require('./career-apply-sync');
/** The kernel's field kinds a question can have (apply_input.rs FieldKind, lower case). */
const KINDS=['text','textarea','select','listbox','prompt','date','checkbox','radio'];
/** The kinds a box with no options is, and the kinds a list is. */
const BOX_KINDS=['textarea','text'],LIST_KINDS=['select','radio','listbox','prompt','checkbox'];
const MAX_TEXT=500;
/** @description Plain words: NFKC, accents folded, lower case, apostrophes dropped, other marks to spaces. @param {*} value @returns {string} */
const norm=value=>String(value??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').normalize('NFKC').toLowerCase()
 .replace(/['’]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** @description Whether norm()ed words hold a phrase as whole words. @returns {boolean} */
const has=(words,phrase)=>(' '+words+' ').includes(' '+norm(phrase)+' ');
const any=(words,phrases)=>phrases.some(phrase=>has(words,phrase));
/** @description One line of a question's words, at most 500 characters. @param {*} value @returns {string} */
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_TEXT):'';
const HUMAN=['captcha','are you a robot','not a robot','are you human','verify you are human','prove you are human','security check','type the characters','enter the characters','anti spam','spam check'];
const ARITHMETIC=/\b\d+\s*(\+|-|x|×|\*|\/|÷|plus|minus|times|multiplied by|divided by)\s*\d+\b/i;
/** Facts no record holds; the same words career-apply-record-rules.js never answers, and pay. */
const NOT_RECORDED=['start date','date available','available to start','availability date','when can you start','when could you start','earliest start',
 'notice period','weeks notice','current notice','time off','vacation','pto','planned leave','non compete','noncompete','non solicit','nonsolicit',
 'restrictive covenant','garden leave','salary','compensation','desired pay','expected pay','pay expectations','pay expectation','hourly rate',
 'rate expectations','current pay','date of birth','birth date','social security','ssn','who referred','referred you','referral name','employee id',
 'graduation date','gpa','phone number','email address','home address','mailing address','street address','linkedin','github','portfolio url','website url','how many years','number of years',
 'hear about','how did you find','learn about us','learned about us','where did you see','source of application','authorized','authorised','sponsorship','sponsor','visa',
 'citizen','citizenship','clearance','gender','race','ethnicity','veteran','disability','pronouns','18 years','convicted','felony','background check','drug test'];
const MONTH=/^in which month of \d{4} did (you start|your role)/;
const WRITTEN=new RegExp('^(tell (us|me)|describe|explain|elaborate|share|walk (us|me) through|give (us |me )?an example|provide (an )?examples?|'
 +'please (describe|explain|share|tell|provide|elaborate|walk|give|summarize|outline|discuss)|briefly (describe|explain|tell|share|summarize|outline)|summarize|outline|discuss|'
 +'in (a few|two or three|your own) (sentences|words)|why|what (platform|platforms|project|projects|product|products|system|systems|interests|excites|attracts|draws|motivates|inspires|makes you|would you|have you|did you|was|were|part)|'
 +'what is your (approach|experience|philosophy|greatest|biggest|proudest|favorite|favourite|process|management style|leadership style|working style|work style|ideal)|'
 +'how (do|did|would|have|will|can) you|have you (ever |personally |previously |recently |also )?(built|owned|led|helped|worked|designed|managed|created|developed|shipped|launched|architected|implemented|delivered|run|mentored|scaled|migrated|contributed|been responsible)|'
 +'do you (proactively|enjoy|prefer|thrive|like|have experience)|when (working|you work|you are working|you were|faced)|if so|(can|could) you (describe|tell|share|explain|give|walk|provide))\\b');
const WRITTEN_ANYWHERE=['if so','what part did you','tell us about','a time when','a time you','example of a time','in your own words','your experience with','your experience in','your experience working'];

/**
 * @description The kind of one question: check (a person is human), month (a month card that fills the record), plain (a fact
 * no record holds, or a question with options) or written (prose Career drafts from the record). Pure.
 * @param {string} text The question's exact words. @param {string[]} [options] The options its card listed. @returns {'check'|'month'|'plain'|'written'}
 */
function kindOf(text,options){
 const raw=clean(text).replace(/^\s*\(required\)\s*/i,'').replace(/[*\s:]+$/,''),words=norm(raw);
 if(ARITHMETIC.test(raw)||any(words,HUMAN))return 'check';
 if(MONTH.test(words))return 'month';
 if((Array.isArray(options)?options:[]).some(option=>clean(option)))return 'plain';
 if(any(words,NOT_RECORDED))return 'plain';
 if(WRITTEN.test(words)||any(words,WRITTEN_ANYWHERE))return 'written';
 return 'plain';
}
/** @description The same question at any employer: its folded words, digested; no field type. @param {string} text @returns {string} k:<32 hex> */
const key=text=>'k:'+crypto.createHash('sha256').update(norm(text)).digest('hex').slice(0,32);
/** @description The questions a run waits on, from its waiting words ("... asks you in Approvals: A / B. Career types your answer in for you."). @param {string} words @returns {string[]} */
function waiting(words){
 const found=/asks you in Approvals:\s*([\s\S]*?)\.\s*Career types your answer in for you/.exec(String(words||''));
 return found?found[1].split(' / ').map(clean).filter(Boolean).slice(0,20):[];
}
/**
 * @description The question ids a run looks up for these words when the field's kind is not known: the box kinds for a
 * question with no options, the list kinds for one with options. @param {string} text @param {string[]} [options] @returns {string[]}
 */
const idsFor=(text,options)=>((Array.isArray(options)&&options.length)?LIST_KINDS:[...BOX_KINDS,'date']).map(kind=>questionId(clean(text),kind));
/**
 * @description The question id the kernel's card of this run names, recovered from its words: the id whose card id (the
 * kernel's derivation from the run and the id) is this card's, or '' when none is. @param {string} run @param {string} card
 * @param {string} text @returns {string}
 */
function exactId(run,card,text){
 if(!/^apply-[a-f0-9]{32}$/.test(card||'')||!run)return '';
 for(const kind of KINDS){const id=questionId(clean(text),kind);if(cardId(run,id)===card)return id;}
 return '';
}
module.exports={KINDS,norm,clean,kindOf,key,waiting,idsFor,exactId};
