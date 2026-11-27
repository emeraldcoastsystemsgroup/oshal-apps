/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | An employer's automatic confirmation was recorded as a rejection and its job set to rejected (production, 2026-11-26: "Thank you for applying to <employer>!" three seconds after the application, and "Hello from <employer>! We have your application." five seconds before Career's own record of it). The reader now takes a confirmation as an acknowledgement, a rejection only from a statement, and nothing dated within five minutes of applied_at as a rejection of that application; the next read relabels a stored wrong event and puts its job back. Real SQLite with the engine's schema, the real state files, a scripted mailbox; the employers and the person are made up.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url),mail=require('../lib/career-email-updates'),board=require('../lib/career-board-state');
const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8');
const MINUTE=60000,DAY=86400000;
/** The two applications of 2026-11-26, with made-up employers: the first confirmation came three seconds after, the second five seconds before. */
const LANTERN={id:11,company:'Lanternworks',title:'Platform Engineer',status:'applied',applied_at:'2026-11-26T06:10:00.000Z'};
const QUILL={id:12,company:'Quillstone Inc',title:'Staff Software Engineer',status:'applied',applied_at:'2026-11-26 11:02:33'};
const applied=job=>mail.timestamp(job.applied_at);
const b64=text=>Buffer.from(text,'utf8').toString('base64url');
/** One mailbox message as the mail API returns it: a subject, a snippet and plain or HTML parts. */
function message(id,subject,at,{text='',html='',snippet=''}={}){
  const parts=[text&&{mimeType:'text/plain',body:{data:b64(text)}},html&&{mimeType:'text/html',body:{data:b64(html)}}].filter(Boolean);
  return {id,threadId:'t-'+id,internalDate:String(at),snippet,payload:{mimeType:'multipart/alternative',headers:[{name:'Subject',value:subject}],parts}};
}
/** The same sentence as a mail program writes it in HTML: source lines broken inside it, two words emphasised, a link. */
const CONDITION_IN_HTML='<div>\n<p>Hi there,</p>\n\n<p>We have received your application for the <b>Platform Engineer</b> role at Lanternworks. If you are\n\n  <strong>not selected</strong>\n\n  for this position, continue to keep an eye on our <a href="https://careers.example.test">careers page</a>.</p>\n</div>';
/** The first confirmation: its subject, and the sentence that read as a rejection. The HTML part emphasises two of its words and the snippet carries an apostrophe as the mailbox writes it. */
const lanternConfirmation=at=>message('lantern-confirmation','Thank you for applying to Lanternworks!',at,{
  snippet:'Hi there, We&#39;ve received your application for the Platform Engineer role at Lanternworks. If you&#39;re not selected for this position, continue to keep',
  text:'Hi there,\n\nWe have received your application for the Platform Engineer role at Lanternworks and our team is\nreviewing it. If you are not selected for this position, continue to keep an eye on our careers page.\n\nThe Lanternworks recruiting team',
  html:CONDITION_IN_HTML});
/** The second confirmation: its subject. The body is written for this test with the wording such notices use for people who are not chosen. */
const quillConfirmation=at=>message('quill-confirmation','Hello from Quillstone! We have your application.',at,{
  text:'We have your application for the Staff Software Engineer role at Quillstone Inc. We read every application, and because of the number we receive we will not be able to answer each one. Your application is considered alongside other candidates. Candidates who are not selected will hear from us by email. Should we decide not to move forward, you can apply again in six months.'});
const rejectionAfterThanks=at=>message('lantern-rejection','Thank you for applying to Lanternworks',at,{
  text:'Thank you for applying to Lanternworks and for the time you put into the Platform Engineer application.\n\nAfter careful consideration, we have decided not to move forward with your application at this time, but if another role fits we would be glad to hear from you.'});
/** A message about the first application whose whole text is the given sentences. */
const about=(text,at=applied(LANTERN)+3*DAY,subject='Lanternworks: Platform Engineer')=>message('m',subject,at,{text});

test('an employer confirmation that says what happens to people who are not selected is an acknowledgement',()=>{
  // As they arrived: seconds from the application. And two days later, where only the words decide.
  for(const at of [applied(LANTERN)+3000,applied(LANTERN)+2*DAY]){
    const event=mail.match(lanternConfirmation(at),[LANTERN,QUILL]);
    assert.equal(event.kind,'acknowledged');assert.equal(event.postingId,11);assert.equal(event.needsReview,false);
    assert.equal(event.subject,'Thank you for applying to Lanternworks!');
  }
  for(const at of [applied(QUILL)-5000,applied(QUILL)+2*DAY]){
    const event=mail.match(quillConfirmation(at),[LANTERN,QUILL]);
    assert.equal(event.kind,'acknowledged');assert.equal(event.postingId,12);
  }
  for(const words of ['We have your application.','We’ve received your application.','Your application has been received.','Application submitted!','Thank you for applying.','Thanks for applying!',
    'Thank you for your application to Lanternworks!','Thanks for your application.','Thank you for submitting your application.'])
    assert.equal(mail.match(about(words+' If you are not selected for this position, continue to keep an eye on our careers page.'),[LANTERN]).kind,'acknowledged',words);
});

test('a subject that thanks him for his application is a confirmation the repair can see',()=>{
  assert.equal(mail.reading('Thank you for your application to Lanternworks!','').kind,'acknowledged');
  assert.equal(mail.reading('Thank you for your application to Lanternworks!','Unfortunately we have decided not to move forward with your application.').kind,'rejected','a decision still rejects');
});

test('a rejection is a statement, also when the message opens with thanks',()=>{
  assert.equal(mail.match(rejectionAfterThanks(applied(LANTERN)+3*DAY),[LANTERN]).kind,'rejected');
  for(const text of ['Thank you for applying. We have decided not to move forward with your application.',
    'Thank you for applying. We will not be proceeding.',
    'Thanks for applying! Unfortunately, we have chosen to go ahead with other candidates whose experience is closer to the role.',
    'We have received your application and reviewed it. We regret to inform you that we cannot offer you this role.',
    'Thank you for applying. We won’t be moving forward with your candidacy.',
    'Thank you for applying. You have not been selected for this role.',
    'Thank you for applying. The position has been filled.',
    'Thank you for applying. Your application was unsuccessful on this occasion.',
    'We are not moving forward with your application.','We will not be extending an invitation this time.'])
    assert.equal(mail.match(about(text),[LANTERN]).kind,'rejected',text);
});

test('rejection words inside a condition or about people in general do not count',()=>{
  for(const text of ['If you are not selected for this position, continue to keep an eye on our careers page.',
    'Should we decide not to move forward, we will let you know by email.',
    'In the event that you are not selected, we will keep your details for six months.',
    'Whether or not you are selected, you will hear from us.',
    'Candidates who are not selected will not be contacted.',
    'Unsuccessful applicants will not receive individual feedback.',
    'We keep reading applications until the position has been filled.',
    'You will hear from us when the position has been filled.',
    'Please take it that you were unsuccessful if you have not heard from us in 14 days.',
    'If you have not heard from us in 14 days, please take it that you have not been selected.']){
    assert.equal(mail.match(about(text),[LANTERN]),null,text);
    assert.equal(mail.match(about('Thank you for applying. '+text),[LANTERN]).kind,'acknowledged',text);
  }
  // The condition holds across the source lines and the emphasis of an HTML part, and across a character reference, whose semicolon ends no sentence.
  assert.equal(mail.match(message('m','Lanternworks: Platform Engineer',applied(LANTERN)+3*DAY,{html:CONDITION_IN_HTML.replace('We have received your application for','About')}),[LANTERN]),null);
  assert.equal(mail.match(message('m','Lanternworks: Platform Engineer',applied(LANTERN)+3*DAY,{snippet:'If your application to the Research &amp; Design group isn&#39;t the one, or is not selected, we keep it on file.'}),[LANTERN]),null);
  // A confirmation is not a rejection for words it uses outside any decision.
  assert.equal(mail.match(about('We have your application. It is reviewed alongside other candidates, and we will not be able to answer everyone.'),[LANTERN]).kind,'acknowledged');
  // A sentence after the condition is still read, and so is a clause before it.
  assert.equal(mail.match(about('If you have questions, reply to this message. Unfortunately, we will not be moving forward with your application.'),[LANTERN]).kind,'rejected');
  assert.equal(mail.match(about('Thank you for applying. We will not be moving forward with your application, and we hope you apply again if another role fits.'),[LANTERN]).kind,'rejected');
  assert.equal(mail.match(about('Thank you for applying. We have decided not to proceed but if a role opens we will write.'),[LANTERN]).kind,'rejected');
});

test('a message dated before five minutes after applied_at is not a rejection of that application',()=>{
  // The same real rejection: an acknowledgement for its thanks while it is that early, a rejection from five minutes on.
  for(const [offset,kind] of [[-5000,'acknowledged'],[3000,'acknowledged'],[5*MINUTE-1,'acknowledged'],[5*MINUTE,'rejected'],[3*DAY,'rejected']])
    assert.equal(mail.match(rejectionAfterThanks(applied(LANTERN)+offset),[LANTERN]).kind,kind,String(offset));
  // With no confirmation in it, that early it is no update at all.
  assert.equal(mail.match(about('We will not be proceeding.',applied(LANTERN)+2*MINUTE),[LANTERN]),null);
  assert.equal(mail.match(about('We will not be proceeding.',applied(LANTERN)+6*MINUTE),[LANTERN]).kind,'rejected');
  // Applied to the same job twice: a rejection seconds after the second application is the first one's.
  const first={...LANTERN,id:9,applied_at:'2026-11-01T00:00:00Z'},event=mail.match(rejectionAfterThanks(applied(LANTERN)+3000),[LANTERN,first]);
  assert.equal(event.kind,'rejected');assert.equal(event.postingId,9);assert.deepEqual(event.candidateIds,[9]);
  // Before the application by more than the same five minutes: not this application's mail, as before.
  assert.equal(mail.match(lanternConfirmation(applied(LANTERN)-5*MINUTE-1),[LANTERN]),null);
});

test('an offer and an interview invitation read as before',()=>{
  const at=applied(LANTERN)+3*DAY;
  assert.equal(mail.match(about('Thank you for applying. We are pleased to offer you the role; your offer letter is attached.',at),[LANTERN]).kind,'offer');
  assert.equal(mail.match(about('Thank you for applying. We would like to schedule an interview with you next week.',at),[LANTERN]).kind,'interview');
  assert.equal(mail.match(about('Interview invitation',at),[LANTERN]).kind,'interview');
  assert.equal(mail.match(about('Your offer of employment',applied(LANTERN)+MINUTE),[LANTERN]).kind,'offer');
  assert.equal(mail.match(about('Our monthly newsletter',at),[LANTERN]),null);
});

/** A made-up person's store: the engine's own schema, the two applications, and the submission mailbox on the résumé. */
function store(){
  const dir=mkdtempSync(join(tmpdir(),'career-mail-updates-')),db=new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  for(const name of ['CORPUS_SCHEMA','USER_SCHEMA'])db.exec(engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1]);
  for(const job of [LANTERN,QUILL]){
    db.prepare('INSERT INTO corpus.companies(id,name)VALUES(?,?)').run(job.id,job.company);
    db.prepare("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,remote,state,posted_date)VALUES(?,?,?,?,'',1,0,1,'','2026-11-20')").run(job.id,job.id,'req-'+job.id,job.title);
    db.prepare("INSERT INTO user_signals(posting_id,status,applied_at,application_source)VALUES(?,?,?,'verified-submission')").run(job.id,job.status,job.applied_at);
  }
  writeFileSync(join(dir,'career_db.json'),JSON.stringify({profile:{email:'applicant@example.test'}}));
  const status=id=>db.prepare('SELECT status FROM user_signals WHERE posting_id=?').get(id).status;
  return {dir,db,status,close(){db.close();rmSync(dir,{recursive:true});}};
}
/** A scripted mailbox: its address, one page of message ids, each message whole. It records every call. */
function mailbox(messages,calls=[]){
  return async(url,options)=>{
    calls.push([url,options]);let data;
    if(url.endsWith('/profile'))data={emailAddress:'applicant@example.test'};
    else if(url.includes('/messages/'))data=messages.find(m=>m.id===decodeURIComponent(url.split('/messages/')[1].split('?')[0]));
    else data={messages:messages.map(m=>({id:m.id}))};
    return {ok:true,status:200,json:async()=>data};
  };
}
/** An event as the reader stored it before this change: the confirmation's subject and date under the kind "rejected". */
const stored=(job,subject,offset,more={})=>({messageId:'old-'+job.id+'-'+offset,threadId:'t',subject,date:new Date(applied(job)+offset).toISOString(),kind:'rejected',
  postingId:job.id,candidateIds:[job.id],needsReview:false,mailbox:'applicant@example.test',...more});
const NOW=Date.parse('2026-11-26T12:00:00Z');
/** Reads until the mailbox has nothing pending (two messages are read per call). */
async function readAll(person,fetcher,from=NOW){let result,at=from;do{result=await mail.check(person.dir,person.db,fetcher,at);at+=15*MINUTE;}while(result.pending);return result;}

test('the reader keeps both confirmed applications applied, and a later real rejection still closes one',async()=>{
  const person=store(),calls=[];
  try{
    const result=await readAll(person,mailbox([quillConfirmation(applied(QUILL)-5000),lanternConfirmation(applied(LANTERN)+3000)],calls));
    assert.equal(result.status,'connected');
    assert.deepEqual(result.events.map(e=>[e.postingId,e.kind]).sort(),[[11,'acknowledged'],[12,'acknowledged']]);
    assert.equal(person.status(11),'applied');assert.equal(person.status(12),'applied');
    assert.equal(mail.decorate(mail.read(person.dir),{id:11}).emailUpdates[0].kind,'acknowledged');
    await readAll(person,mailbox([rejectionAfterThanks(applied(LANTERN)+3*DAY)],calls),NOW+4*DAY);
    assert.equal(person.status(11),'rejected');assert.equal(person.status(12),'applied');
    assert.deepEqual(mail.decorate(mail.read(person.dir),{id:11}).emailUpdates.map(e=>e.kind),['acknowledged','rejected']);
    assert.ok(calls.every(([,options])=>options.method==='GET'),'the mailbox is only read');
  }finally{person.close();}
});

test('the next read relabels a stored wrong rejection and puts its job back to applied',async()=>{
  const person=store(),calls=[];
  try{
    person.db.exec("UPDATE user_signals SET status='rejected'");
    mail.write(person.dir,{version:1,seen:['old'],events:[stored(LANTERN,'Thank you for applying to Lanternworks!',3000),stored(QUILL,'Hello from Quillstone! We have your application.',-5000)]});
    const result=await mail.check(person.dir,person.db,mailbox([],calls),NOW);
    assert.deepEqual(result.events.map(e=>e.kind),['acknowledged','acknowledged']);
    assert.equal(person.status(11),'applied');assert.equal(person.status(12),'applied');
    const kept=mail.read(person.dir).events;
    assert.deepEqual(kept.map(e=>[e.messageId,e.subject,e.date,e.postingId]),[stored(LANTERN,'Thank you for applying to Lanternworks!',3000),stored(QUILL,'Hello from Quillstone! We have your application.',-5000)].map(e=>[e.messageId,e.subject,e.date,e.postingId]),'only the kind changes');
    assert.equal(mail.decorate(mail.read(person.dir),{id:12}).emailUpdates[0].kind,'acknowledged');
    // Read again: nothing left to put right, and a rejection the person records afterwards is theirs.
    person.db.exec("UPDATE user_signals SET status='rejected' WHERE posting_id=11");
    board.updateBoardState(person.dir,11,{manualTracking:{status:'rejected',recordedAt:new Date(NOW).toISOString()}});
    await mail.check(person.dir,person.db,mailbox([],calls),NOW+15*MINUTE);
    assert.equal(person.status(11),'rejected');assert.equal(person.status(12),'applied');
  }finally{person.close();}
});

test('the repair runs when the mailbox cannot be read',async()=>{
  const person=store();
  try{
    person.db.exec("UPDATE user_signals SET status='rejected' WHERE posting_id=11");
    mail.write(person.dir,{version:1,seen:[],events:[stored(LANTERN,'Thank you for applying to Lanternworks!',3000)]});
    const result=await mail.check(person.dir,person.db,async()=>({ok:false,status:401,json:async()=>({})}),NOW);
    assert.equal(result.status,'unavailable');assert.equal(result.events[0].kind,'acknowledged');assert.equal(person.status(11),'applied');
  }finally{person.close();}
});

test('the repair leaves alone what it cannot show to be the wrong reading',async()=>{
  const person=store();
  try{
    person.db.exec("UPDATE user_signals SET status='rejected'");
    // The person recorded this rejection: the status route writes manualTracking beside the status. The event is still a confirmation.
    board.updateBoardState(person.dir,11,{manualTracking:{status:'rejected',recordedAt:'2026-11-26T09:00:00.000Z'}});
    // A real rejection is stored for this one as well.
    const real=stored(QUILL,'An update on your Quillstone application',9*DAY,{messageId:'real'});
    mail.write(person.dir,{version:1,seen:[],events:[stored(LANTERN,'Thank you for applying to Lanternworks!',3000),stored(QUILL,'Hello from Quillstone! We have your application.',-5000),real]});
    await mail.check(person.dir,person.db,mailbox([]),NOW);
    assert.deepEqual(mail.read(person.dir).events.map(e=>e.kind),['acknowledged','acknowledged','rejected']);
    assert.equal(person.status(11),'rejected','the person set it');assert.equal(person.status(12),'rejected','a real rejection is stored');
    // Not a wrong reading by what is stored: a confirmation subject days later, a subject that is no confirmation, and one that states a rejection.
    const untouched=[stored(LANTERN,'Thank you for applying to Lanternworks!',2*DAY),stored(LANTERN,'Lanternworks: Platform Engineer',3000),
      stored(LANTERN,'Thank you for applying: we will not be moving forward',3000),stored(LANTERN,'Thank you for applying to Lanternworks!',5*MINUTE)];
    board.updateBoardState(person.dir,11,{manualTracking:null});
    mail.write(person.dir,{version:1,seen:[],events:untouched});
    await mail.check(person.dir,person.db,mailbox([]),NOW+15*MINUTE);
    assert.deepEqual(mail.read(person.dir).events,untouched);assert.equal(person.status(11),'rejected');
    // A stored acknowledgement, interview or offer is never relabelled, and a job that is not rejected keeps its status.
    person.db.exec("UPDATE user_signals SET status='interview' WHERE posting_id=12");
    const others=['acknowledged','interview','offer'].map((kind,index)=>stored(QUILL,'Hello from Quillstone! We have your application.',1000+index,{kind}));
    mail.write(person.dir,{version:1,seen:[],events:[...others,stored(QUILL,'Hello from Quillstone! We have your application.',-5000)]});
    await mail.check(person.dir,person.db,mailbox([]),NOW+30*MINUTE);
    assert.deepEqual(mail.read(person.dir).events.map(e=>e.kind),['acknowledged','interview','offer','acknowledged']);assert.equal(person.status(12),'interview');
  }finally{person.close();}
});

test('a job the wrong reading closed goes back to the interview already on record',async()=>{
  const person=store();
  try{
    person.db.exec("UPDATE user_signals SET status='rejected'");
    // The person recorded an interview by hand before the confirmation was read; a later invitation is stored for the other job.
    board.updateBoardState(person.dir,11,{manualTracking:{status:'interview',recordedAt:'2026-11-26T07:00:00.000Z',interviewAt:null}});
    mail.write(person.dir,{version:1,seen:[],events:[stored(LANTERN,'Thank you for applying to Lanternworks!',3000),stored(QUILL,'Hello from Quillstone! We have your application.',-5000),
      stored(QUILL,'Interview invitation from Quillstone',2*DAY,{kind:'interview',messageId:'invite'})]});
    await mail.check(person.dir,person.db,mailbox([]),NOW+3*DAY);
    assert.equal(person.status(11),'interview');assert.equal(person.status(12),'interview');
  }finally{person.close();}
});

test('an event matched to more than one application is relabelled and changes no status',async()=>{
  const person=store();
  try{
    person.db.exec("UPDATE user_signals SET status='rejected' WHERE posting_id=11");
    mail.write(person.dir,{version:1,seen:[],events:[stored(LANTERN,'Thank you for applying!',3000,{postingId:null,candidateIds:[11,12],needsReview:true}),
      stored(QUILL,'Thank you for applying!',3000,{postingId:null,candidateIds:[12,999],needsReview:true,messageId:'unknown-job'})]});
    await mail.check(person.dir,person.db,mailbox([]),NOW);
    // 06:10:03 is before both applications' five minutes; the second event names a job the person has no record of.
    assert.deepEqual(mail.read(person.dir).events.map(e=>e.kind),['acknowledged','rejected']);assert.equal(person.status(11),'rejected');
  }finally{person.close();}
});

test('the person\'s own status change still records itself, which is how the repair knows a rejection is theirs',()=>{
  const route=readFileSync(new URL('../routes/career-board-routes.js',import.meta.url),'utf8');
  assert.match(route,/\['interview', 'offer', 'rejected'\]\.includes\(status\)\)\s*patch\.manualTracking = \{ status, recordedAt:/);
  const writers=['lib','routes'].flatMap(folder=>require('node:fs').readdirSync(new URL('../'+folder+'/',import.meta.url)).filter(name=>name.endsWith('.js')).map(name=>folder+'/'+name))
    .filter(file=>/UPDATE user_signals SET status=(?:\?|@status)/.test(readFileSync(new URL('../'+file,import.meta.url),'utf8')));
  assert.deepEqual(writers.sort(),['lib/career-email-updates.js','lib/career-manual-submission.js','routes/career-board-routes.js'],'another file now writes a job status of its caller\'s choosing: if it can write "rejected", repair() in lib/career-email-updates.js must be able to tell that write from the mail reader\'s own');
});
