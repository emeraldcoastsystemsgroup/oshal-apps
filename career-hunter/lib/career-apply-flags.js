/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I (Roger, 2026-11-21: "we are going to have some flags like run in foreground and stop before submit. or approve submit automatically"; design apply-flags-trusted-input-2026-11-21 section 0): How Career fills in a form, three settings of the person's own, kept in apply_profile.json as apply_flags and carried in the approved input as task.flags (so under the approval's digest). Typing: like a person (the default: Career only reads the page and his computer's own mouse and keyboard do every click, key and paste, slower, and nothing is changed inside the page) or fast (the add-on sets each value in the page). Window: in front (the default) or behind his other windows, only with fast. Submit: stop before Submit (the default) or submit after he approves, when Career presses Submit once after the Review check passes. Each value is from its closed list; anything else, and behind with like a person, is refused in words. The approval screen says each in a sentence.
 */
'use strict';
const queue=require('./career-submission-queue');

/** The closed choices, the first of each the default. */
const CHOICES=Object.freeze({input:['person-like','fast'],window:['foreground','background'],submit:['stop-before-submit','submit-after-approval']});
/** Roger's defaults (2026-11-21): like a person, in front, stop before Submit. */
const DEFAULTS=Object.freeze({input:'person-like',window:'foreground',submit:'stop-before-submit'});
const FIELD='apply_flags';
const fail=(code,message,status=400)=>{throw new queue.SubmissionError(code,message,status);};

/**
 * @description The person's three settings as kept, each its default when absent or not one of its choices.
 * @param {object} raw The parsed apply_profile.json. @returns {{input:string,window:string,submit:string}}
 */
function read(raw){
 const kept=raw&&typeof raw[FIELD]==='object'&&!Array.isArray(raw[FIELD])?raw[FIELD]:{};
 const flags=Object.fromEntries(Object.entries(CHOICES).map(([key,list])=>[key,list.includes(kept[key])?kept[key]:DEFAULTS[key]]));
 return flags.input==='person-like'&&flags.window==='background'?{...flags,window:'foreground'}:flags;
}
/**
 * @description The settings after a change from the Saved answers page: only the three, each from its choices; behind
 * with like a person is refused (his computer's mouse and keyboard need the window in front).
 * @param {object} current read() now. @param {object} values Some of {input, window, submit}. @returns {object} The settings to keep.
 */
function change(current,values){
 if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length||Object.entries(values).some(([key,value])=>!CHOICES[key]||!CHOICES[key].includes(value)))
  fail('answers_invalid','Choose how Career types, where its window is, and whether it presses Submit, from the choices this page shows.');
 const next={...current,...values};
 if(next.input==='person-like'&&next.window==='background')
  fail('answers_invalid','Typing like a person needs Career’s Chrome window in front. Choose Fast to let it work behind your other windows.');
 return next;
}
/**
 * @description The settings as the approval screen says them, one sentence each.
 * @param {{input:string,window:string,submit:string}} flags @returns {string[]}
 */
function lines(flags){
 return [flags.input==='person-like'
   ?'Career types like a person: it only reads the page, and your computer’s own mouse and keyboard do every click, key and paste, at a person’s pace.'
   :'Career fills it in fast: the browser add-on sets each value inside the page.',
  flags.window==='foreground'?'Its Chrome window stays in front while it works; you can take over at any time.':'Its Chrome window opens behind your other windows.',
  flags.submit==='submit-after-approval'
   ?'Career presses Submit once, after it checks the Review page and finds nothing wrong, and keeps the employer’s confirmation.'
   :'Career stops before Submit. You press it.'];
}
/** @description The last line of the approval screen for these settings. @param {object} flags @param {string} stop The site's stop line. @returns {string} */
const stopLine=(flags,stop)=>flags.submit==='submit-after-approval'?'Career checks the Review page and presses Submit once. You can stop it before then.':stop;
module.exports={CHOICES,DEFAULTS,FIELD,read,change,lines,stopLine};
