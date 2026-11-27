/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The smart build of Fill it in on my Chrome (design apply-smart-design-2026-11-26, section 2.0; Roger, 2026-11-26: "the software agent doesnt need to read a password ... it only needs to select the default login and it only needs to pull the email to get the key"): What Career does by itself on an employer's site, five switches of the person's own, kept in apply_profile.json as apply_help and all on unless he switched one off. Remember each employer site; look at the page before moving on; sign in with the login Chrome saved; create an account with Chrome's suggested password (only with sign-in on); read a verification code from his mail. A switch reaches a run only through the approved input, as task.assist, so it is under the approval's digest and a switch changed after approval does not reach that run. With every switch off the input carries no task.assist at all, exactly as before the switches. Signing in needs the run's window in front, so behind his other windows the two sign-in switches are sent off and the approval screen says so. The mail codes part names this application's own lookup route and the only senders a code may come from: the approved site's own domain and the job site's sending domains. The approval screen says each switch in one sentence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A run carries only the switches the kernel acts on (oshal-kernel dev/native-parity, read 2026-11-26: apply_run_signin.rs acts on signIn and createAccount, apply_run_code.rs and apply_code.rs on mailCodes; nothing reads siteMemory, and apply_run_screen.rs answers "not handled" for screen). Remember each employer site (lane A) and Look at the page before moving on (lane B) are NOT_YET: off, refused when a change names them, never kept and never in task.assist, so no approval says Career does what no run does. The other three are on unless he switches one off.
 */
'use strict';
const queue=require('./career-submission-queue');

/** The key the switches are kept under in apply_profile.json. */
const FIELD='apply_help';
/** The five switches, in the order the page shows them. */
const KEYS=Object.freeze(['siteMemory','screen','signIn','createAccount','mailCodes']);
/**
 * The switches the kernel does not act on yet, with their names on the page: off, never kept, never in a run. A switch
 * leaves this list in the change that ships its kernel lane, and its default then becomes on.
 */
const NOT_YET=Object.freeze({siteMemory:'Remember each employer site',screen:'Look at the page before moving on'});
/** On unless he switched one off (the owner's decision, 2026-11-26), except a switch the kernel does not act on yet. */
const DEFAULTS=Object.freeze({siteMemory:false,screen:false,signIn:true,createAccount:true,mailCodes:true});
/** This application's own route that reads one verification code; the kernel's run calls it, never a browser. */
const ROUTE='/api/career-hunter/apply-code';
const MAX_SENDERS=10;
const HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Second-level labels under a two-letter country ending that are part of the ending (co.uk, com.au). */
const COUNTRY_SECOND=['co','com','org','net','ac','gov','edu'];
const fail=(code,message,status=400)=>{throw new queue.SubmissionError(code,message,status);};

/**
 * @description The person's five switches as kept: each on unless kept as false, a switch not available yet (NOT_YET)
 * always off, and Create an account off whenever Sign in is off. @param {object} raw The parsed apply_profile.json. @returns {Record<string,boolean>}
 */
function read(raw){
 const kept=raw&&raw[FIELD]&&typeof raw[FIELD]==='object'&&!Array.isArray(raw[FIELD])?raw[FIELD]:{};
 const help=Object.fromEntries(KEYS.map(key=>[key,kept[key]===false?false:DEFAULTS[key]]));
 return help.signIn?help:{...help,createAccount:false};
}
/**
 * @description The switches after a change from the Saved answers page: only the five, each true or false, and none
 * that is not available yet. Switching Sign in off switches Create an account off with it; Create an account cannot be
 * on while Sign in is off. @param {object} current read() now. @param {object} values Some of the five switches.
 * @returns {object} The switches to keep, without those not available yet.
 */
function change(current,values){
 if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length||Object.entries(values).some(([key,value])=>!KEYS.includes(key)||typeof value!=='boolean'))
  fail('answers_invalid','Switch only the five things this page lists, on or off.');
 const soon=Object.keys(values).find(key=>key in NOT_YET);
 if(soon)fail('answers_invalid',`“${NOT_YET[soon]}” is not available yet, so it stays off.`);
 const next=Object.fromEntries(Object.entries({...current,...values}).filter(([key])=>!(key in NOT_YET)));
 if(values.signIn===false&&!('createAccount' in values))next.createAccount=false;
 if(next.createAccount&&!next.signIn)
  fail('answers_invalid','Creating an account needs “Sign in with the login Chrome saved” switched on, because Career signs in with the account it made.');
 return next;
}
/**
 * @description The domain a site's own mail comes from: its host without its leading names (job-boards.greenhouse.io is
 * greenhouse.io, careers.example.co.uk is example.co.uk). @param {string} host A host name. @returns {string} The
 * domain, or '' for an address or a name with one label.
 */
function siteDomain(host){
 const name=String(host||'').toLowerCase().replace(/\.$/,'');
 if(!HOST.test(name)||/^\d+(?:\.\d+){3}$/.test(name))return '';
 const labels=name.split('.'),country=labels.at(-1).length===2&&COUNTRY_SECOND.includes(labels.at(-2))&&labels.length>=3;
 return labels.slice(country?-3:-2).join('.');
}
/**
 * @description The only senders a verification code may come from: the approved site's own domain, then the job
 * site's sending domains, each a plain host name, ten at most. @param {string} origin The approved origin.
 * @param {string[]} [mail] The job site's sending domains. @returns {string[]}
 */
function senders(origin,mail){
 const own=URL.canParse(origin)?siteDomain(new URL(origin).hostname):'';
 const named=(Array.isArray(mail)?mail:[]).map(item=>String(item||'').trim().toLowerCase()).filter(item=>HOST.test(item));
 return [...new Set([own,...named].filter(Boolean))].slice(0,MAX_SENDERS);
}
/**
 * @description What a run may do by itself, as the approved input carries it (task.assist): only the switches the
 * kernel acts on (signIn, createAccount, mailCodes; none of NOT_YET), or null when every one is off, so the input is
 * then exactly the input before the switches.
 * @param {object} help read() output. @param {{flags:{window:string},origin:string,mail?:string[]}} run The run's
 * flags, its approved origin and the job site's sending domains. @returns {object|null}
 */
function assist(help,run){
 const front=run?.flags?.window!=='background',signIn=help.signIn===true&&front,from=help.mailCodes===true?senders(run?.origin,run?.mail):[];
 const value={siteMemory:help.siteMemory===true,screen:help.screen===true,signIn,createAccount:signIn&&help.createAccount===true,
  mailCodes:from.length?{route:ROUTE,senders:from}:null};
 const sent=Object.fromEntries(Object.entries(value).filter(([key])=>!(key in NOT_YET)));
 return sent.siteMemory||sent.screen||sent.signIn||sent.mailCodes?sent:null;
}
/**
 * @description What the approval screen says Career does by itself on this run, one sentence for each switch.
 * @param {object|null} value assist() output. @param {{window:string}} flags The run's flags. @param {object} help
 * read() output, to say why a switch he has on is not used on this run. @param {boolean} [several] True for a sheet
 * that approves several jobs at once: the mail sentence then names no one site's senders. @returns {string[]}
 */
function lines(value,flags,help,several=false){
 const on=value||{},behind=flags?.window==='background'&&help?.signIn===true;
 const from=several||!on.mailCodes?'the employer’s or the job site’s address':on.mailCodes.senders.join(' or ');
 return [
  on.siteMemory?'Career remembers what worked on this employer’s site (which field takes which of your facts, never a value of yours) and uses it next time.':'Career remembers nothing about this employer’s site.',
  on.screen?'Before moving on from a page, this installation’s own picture model looks at pictures of it, and Career fixes what looks wrong.':'Career does not look at pictures of the page before moving on.',
  on.signIn?'When the site asks you to sign in, Chrome fills the login it saved and Career presses Sign in. Career never sees, types or keeps a password.'
   :behind?'You sign in yourself: Chrome fills a saved login only in a window in front, and this run’s window is behind your other windows.':'You sign in to the employer’s site yourself.',
  on.createAccount?'When you have no account there, Career accepts the strong password Chrome suggests, and Chrome saves it. Career never sees it.':'You create an account on the employer’s site yourself.',
  on.mailCodes?`When the site emails you a verification code, Career reads that one message in your mailbox (only mail that arrived after the code was asked for, from ${from}) and types the code. It reads nothing else.`
   :'You type a verification code the site emails you yourself.',
  'A “verify you are human” check is always yours. Career never solves or skips one.'];
}
module.exports={FIELD,KEYS,NOT_YET,DEFAULTS,ROUTE,read,change,siteDomain,senders,assist,lines};
