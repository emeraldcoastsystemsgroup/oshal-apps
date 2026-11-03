/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Grade integrity, timing, selection, curriculum and progress regressions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lesson videos live in .videos, outside what the kernel copies into each sandbox. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalog, FORMATS, createSession, changeSession, publicSession, research, officialPractice } = require('../routes/education-prep-model');
const { summarize } = require('../routes/education-prep-progress');
const { trainingInput, personalizedContent, createTraining } = require('../routes/education-prep-training');
const start = (input = {}) => createSession({ exam:'SAT', mode:'diagnostic', ...input }, new Set(), ['linear'], 100000);
const answer = (choice, ms = 1000) => ({ choice, ms, confidence:'sure', flagged:false });

// Live regression: different students can collide on the native collection witness.
function storedPrep() {
  const Module=require('node:module'),load=Module._load;
  Module._load=function(name,...rest){
    if(name==='@/shared/logger')return {createChildLogger:()=>({error(){}})};
    return load.call(this,name,...rest);
  };
  try{return require('../routes/education-prep-store');}finally{Module._load=load;}
}
function conflictPool(failures, native=true) {
  const calls=[];let attempt=0;
  const pool={storageModel:native?'kernel-scoped-documents':undefined,connect:async()=>({
    query:async(sql)=>{
      calls.push(sql);
      if(sql==='BEGIN')attempt++;
      if(sql==='COMMIT'&&attempt<=failures)throw new Error('refused: conflict: scoped collection revision or expected body changed');
      if(sql.startsWith('SELECT profile'))return {rows:[{profile:{exam:'SAT',dailyMinutes:15,testDate:'',lessons:{['concurrent-'+attempt]:{completedAt:attempt}}}}]};
      return {rows:[]};
    },release:()=>calls.push('release')
  })};return {pool,calls};
}
test('native prep retries a definitely rolled-back collection conflict with fresh profile reads',async()=>{
  const {pool,calls}=conflictPool(2);
  const saved=await storedPrep().saveProfile(pool,{studentId:'student',tenantId:'school'},{exam:'SAT',dailyMinutes:20,testDate:''});
  assert.equal(saved.dailyMinutes,20);assert.deepEqual(Object.keys(saved.lessons),['concurrent-3']);
  assert.equal(calls.filter(x=>x==='ROLLBACK').length,2);assert.equal(calls.filter(x=>x==='release').length,3);
});
test('repeated native contention becomes a bounded reload conflict',async()=>{
  const {pool,calls}=conflictPool(Infinity);
  await assert.rejects(storedPrep().saveProfile(pool,{studentId:'student',tenantId:'school'},{exam:'SAT',dailyMinutes:20,testDate:''}),e=>e.status===409);
  assert.equal(calls.filter(x=>x==='BEGIN').length,4);assert.equal(calls.filter(x=>x==='ROLLBACK').length,4);
});
test('native retry does not replay a PostgreSQL or uncertain transport failure',async()=>{
  const {pool,calls}=conflictPool(1,false);
  await assert.rejects(storedPrep().saveProfile(pool,{studentId:'student',tenantId:'school'},{exam:'SAT',dailyMinutes:20,testDate:''}));
  assert.equal(calls.filter(x=>x==='BEGIN').length,1);
  const uncertain={storageModel:'kernel-scoped-documents',connect:async()=>({query:async sql=>{if(sql==='COMMIT')throw new Error('connection closed');return {rows:[]};},release(){}})};
  await assert.rejects(storedPrep().saveProfile(uncertain,{studentId:'student',tenantId:'school'},{exam:'SAT',dailyMinutes:20,testDate:''}),/connection closed/);
});
test('a completed session ignores attempted answer edits without changing its revision or ledger',async()=>{
  const calls=[],row={session_id:'00000000-0000-4000-8000-000000000123',revision:7,state:{status:'complete'}};
  const pool={connect:async()=>({query:async sql=>{calls.push(sql);return {rows:sql.startsWith('SELECT session_id')?[row]:[]};},release(){}})};
  const saved=await storedPrep().updateSession(pool,{studentId:'student',tenantId:'school'},row.session_id,{revision:7,action:'save',answers:{forged:{choice:3}}});
  assert.deepEqual(saved,row);assert.equal(calls.some(sql=>/^(UPDATE|INSERT)/.test(sql)),false);
  await assert.rejects(storedPrep().updateSession(pool,{studentId:'student',tenantId:'school'},row.session_id,{revision:6,action:'save'}),e=>e.status===409);
});

test('official resources keep paper forms and online scoring keys distinct without publishing local metadata', () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname,'../data/test-prep/official-resources.json')));
  assert.equal(index.resources.length,32);
  assert.equal(new Set(index.resources.map(r=>r.id)).size,32);
  for (const r of index.resources) {
    assert.match(r.sha256,/^[a-f0-9]{64}$/); assert.ok(r.bytes>10000 && r.pages>0);
    assert.ok(['satsuite.collegeboard.org','www.act.org'].includes(new URL(r.url).hostname));
    const published=officialPractice.resources.find(x=>x.id===r.id);
    assert.equal(published.localFile,undefined);assert.equal(published.sha256,undefined);
    if(r.kind==='online-scoring') assert.equal(r.format,'enhanced-online-key');
    if(r.exam==='SAT' && r.kind==='test') {
      assert.equal(r.format,'paper-nonadaptive');
      assert.equal(Object.values(r.sectionQuestions).flat().reduce((a,b)=>a+b,0),120);
      assert.notEqual(120,FORMATS.SAT.reduce((a,b)=>a+b.count,0));
    }
  }
  assert.equal(officialPractice.resources.filter(r=>r.kind==='test' && r.exam==='SAT').length,8);
  assert.equal(officialPractice.resources.filter(r=>r.kind==='test' && r.exam==='ACT').length,4);
});
test('strategy guidance has limitations, primary-source context and valid related lessons for every exam section', () => {
  assert.equal(research.strategies.length,47);
  assert.equal(new Set(research.strategies.map(s=>s.id)).size,47);
  for(const s of research.strategies) {
    for(const field of ['method','shortcut','caution','example']) assert.ok(s[field].length>25,s.id+' '+field);
    assert.ok(s.sources.length);
    for(const id of s.sources) assert.ok(research.sources.some(source=>source.id===id));
    if(s.lessonId) assert.ok(catalog.lessons.some(l=>l.id===s.lessonId));
    assert.equal(s.basis,'original-instruction-with-primary-source-context');
  }
  for(const [exam,sections] of Object.entries({SAT:['rw','math','general'],ACT:['english','math','reading','science','writing','general']})) {
    for(const section of sections) assert.ok(research.strategies.some(s=>s.sections[exam]===section));
  }
});
test('inspected question references point to the right form, real page and applicable strategy', () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname,'../data/test-prep/official-resources.json')));
  assert.equal(research.questionExamples.length,16);
  for(const q of research.questionExamples) {
    const r=index.resources.find(r=>r.id===q.resourceId);
    assert.equal(r.exam,q.exam); assert.equal(r.test,q.test);
    assert.ok(q.pdfPage>0 && q.pdfPage<=r.pages);
    assert.ok(research.strategies.find(s=>s.id===q.strategyId)?.sections[q.exam]);
    assert.equal(q.answer,undefined); assert.equal(q.prompt,undefined);
  }
});

test('every initial lesson has a complete transcript, real MP4 and caption file', () => {
  assert.equal(catalog.lessons.length, 21);
  for (const l of catalog.lessons) {
    assert.equal(l.frames.length, 5);
    for (const k of ['learn','example','shortcut','caution','mistake']) assert.ok(l[k].length > 25);
    const bytes = fs.readFileSync(path.join(__dirname, '../.videos', l.id + '.mp4')); assert.ok(bytes.length > 10000); assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
    assert.match(fs.readFileSync(path.join(__dirname, '../tools/prep-media', l.id + '.vtt'),'utf8'), /^WEBVTT\n/);
  }
});
test('bank IDs and choices are unique; all questions resolve to a lesson and valid answer', () => {
  assert.equal(catalog.questions.length, 222);
  assert.equal(new Set(catalog.questions.map(q => q.id)).size, 222);
  for (const q of catalog.questions) {
    assert.ok(catalog.lessons.some(l => l.id === q.skill)); assert.equal(new Set(q.options).size, 4);
    assert.ok(q.answer >= 0 && q.answer < 4); assert.ok(q.explanation.length > 30);
  }
});
test('numeric answer keys satisfy their original problems, including requested expressions and scaling', () => {
  for (const q of catalog.questions.filter(q => q.sections.SAT === 'math')) {
    const n = Number(q.id.split('-').at(-1)), value = q.options[q.answer];
    const expected = {linear:(n+2)*(n+4), systems:n+4, percent:(50+10*n)*.8,
      quadratic:-3, geometry:9*(n+2)**2, data:11+n, probability:`${n+2}/${2*n+9}`, trig:'3/5'}[q.skill];
    assert.equal(String(value), String(expected), q.id);
  }
});
test('full pacing sessions have current counts, time budgets, no repeated IDs, and optional ACT science', () => {
  for (const [exam,science,count,seconds] of [['SAT',false,98,8040],['ACT',false,131,7500],['ACT',true,171,9900]]) {
    const s = start({ exam,science,mode:'simulation' });
    const qs=s.blocks.flatMap(b=>b.questions);
    assert.equal(qs.length,count); assert.equal(new Set(qs.map(q=>q.id)).size,count);
    assert.equal(s.blocks.reduce((n,b)=>n+b.seconds,0),seconds);
    for (const b of s.blocks) assert.equal(b.questions[0].targetSeconds,b.seconds/b.questions.length);
  }
  assert.equal(start({ mode:'simulation', multiplier:1.5 }).blocks[0].seconds,2880);
});
test('diagnostics cover each skill and focused practice prefers unseen questions', () => {
  const s=start(); assert.equal(new Set(s.blocks[0].questions.map(q=>q.skill)).size,18);
  const seen = new Set(catalog.questions.filter(q=>q.skill==='linear').slice(0,2).map(q=>q.id));
  const focused=createSession({exam:'SAT',mode:'practice',skill:'linear'},seen,['linear'],100000);
  assert.equal(focused.blocks[0].questions.length,8);
  assert.ok(focused.blocks[0].questions.every(q=>!seen.has(q.id)));
});
test('invalid exam, mode, skill and accommodation settings fail closed', () => {
  for (const input of [{exam:'AP'},{mode:'pretend'},{mode:'practice',skill:'science-data'},{multiplier:0},{multiplier:3},{science:'true'}]) assert.throws(()=>start(input));
});
test('prepared practice hides questions and starts its deadline only after an explicit begin', () => {
  const s=start(); s.status='ready';s.blocks[0].startedAt=null;
  const view=publicSession(s,'ready',0,999999);
  assert.equal(view.blocks[0].questions.length,0);assert.equal(view.blocks[0].count,18);
  assert.throws(()=>changeSession(s,{action:'finish'},999999));
  const begun=changeSession(s,{action:'begin'},999999);
  assert.equal(begun.status,'active');assert.equal(begun.blocks[0].startedAt,999999);
  assert.equal(publicSession(begun,'ready',1,999999).blocks[0].questions.length,18);
  assert.throws(()=>changeSession(begun,{action:'begin'},1000000));
});
test('training accepts only supported exam topics and bounded goals, never arbitrary bank additions', () => {
  for(const input of [{exam:'SAT',strategyIds:['science-lookup']},{exam:'ACT',strategyIds:[]},
    {exam:'SAT',strategyIds:['systems','systems']},{exam:'SAT',strategyIds:['systems'],mode:'publish'},
    {exam:'SAT',strategyIds:['systems'],goal:'x'.repeat(301)}]) assert.throws(()=>trainingInput(input));
  assert.equal(trainingInput({exam:'SAT',strategyIds:['systems']}).mode,'guided');
  const policy=JSON.parse(fs.readFileSync(path.join(__dirname,'../storage/relationships.json')));
  assert.equal(policy.tables.lm_prep_questions.read,'true');
  assert.equal(policy.tables.lm_prep_questions.insert,"$3->>'role'='admin'");
  for(const action of ['update','delete'])assert.equal(policy.tables.lm_prep_questions[action],undefined);
  for(const table of ['lm_prep_answers','lm_prep_training']) {
    for(const action of ['read','insert','update']) {
      assert.match(policy.tables[table][action],/student_id/);assert.match(policy.tables[table][action],/tenant_id/);
    }
  }
});
test('personalization rejects missing, malformed and oversized output and discards undeclared fields', () => {
  for(const raw of ['[]','{}','not json','x'.repeat(25000),JSON.stringify({summary:'s',steps:['s'],cards:[]})]) assert.throws(()=>personalizedContent(raw));
  const valid={summary:'A clear summary',steps:['Step one','Step two','Step three'],workedExample:'A worked example',cards:[1,2,3].map(n=>({front:'Question '+n,back:'Explanation '+n})),tools:['unsafe'],answerKey:'ignored'};
  const parsed=personalizedContent(JSON.stringify(valid));assert.equal(parsed.cards.length,3);
  assert.equal(parsed.tools,undefined);assert.equal(parsed.answerKey,undefined);
});
test('personalization carries the caller identity and bounded source data; failed generation saves no empty pack', async () => {
  const Module=require('node:module'),load=Module._load,calls=[],writes=[];
  let result=JSON.stringify({summary:'Summary',steps:['One','Two','Three'],workedExample:'Example',cards:[1,2,3].map(n=>({front:'Q'+n,back:'A'+n}))});
  Module._load=function(name,...rest){
    if(name==='@/features/swarm-orchestration/services/prompt-containment')return {wrapUntrustedPromptContent:(label,text,limit)=>`<${label}>${text.slice(0,limit)}</${label}>`};
    if(name==='./education-study-model')return {runStudyModel:async(...args)=>{calls.push(args);return result;}};
    return load.call(this,name,...rest);
  };
  try {
    const ctx={pool:{query:async(sql,params)=>{writes.push({sql,params});return {rows:[]};}}};
    const actor={studentId:'student',tenantId:'school'};
    const pack=await createTraining(ctx,actor,'verified-sub',{exam:'SAT',strategyIds:['systems'],mode:'personalized',goal:'Use smaller steps.'});
    assert.equal(calls[0][1],'verified-sub');assert.equal(calls[0][2],'student');
    assert.match(calls[0][4],/untrusted data/);assert.match(calls[0][4],/Use smaller steps/);
    assert.equal(pack.content.mode,'personalized');assert.equal(writes.length,1);
    assert.deepEqual(writes[0].params.slice(1,3),['student','school']);
    result='bad output';await assert.rejects(createTraining(ctx,actor,'verified-sub',{exam:'SAT',strategyIds:['systems'],mode:'personalized'}));
    assert.equal(writes.length,1);
  } finally {Module._load=load;}
});
test('active views withhold answer keys, explanations and future modules', () => {
  const s=start({mode:'simulation'}), view=publicSession(s,'id',0,100000);
  assert.equal(view.blocks[1].questions.length,0);
  assert.equal(view.blocks[0].questions[0].answer,undefined);
  assert.equal(view.blocks[0].questions[0].explanation,undefined);
  assert.equal(s.blocks[0].questions[0].answer >= 0,true);
});
test('saving and reload preserve cumulative timing, answers, confidence and flags', () => {
  const s=start(), q=s.blocks[0].questions[0];
  const saved=changeSession(s,{action:'save',answers:{[q.id]:{...answer(q.answer,2200),flagged:true}}},104000);
  assert.equal(s.blocks[0].answers[q.id],undefined);
  const reloaded=JSON.parse(JSON.stringify(saved));
  assert.deepEqual(publicSession(reloaded,'id',1,105000).blocks[0].answers[q.id],{choice:q.answer,ms:2200,confidence:'sure',flagged:true});
});
test('invalid timing, unknown IDs, invalid choices and decreasing cumulative time are rejected atomically', () => {
  const s=start(), q=s.blocks[0].questions[0];
  for (const bad of [answer(q.answer,-1),answer(q.answer,Infinity),answer(q.answer,1000000),answer(99),{...answer(0),confidence:'invented'}]) {
    assert.throws(()=>changeSession(s,{action:'save',answers:{[q.id]:bad}},102000)); assert.deepEqual(s.blocks[0].answers,{});
  }
  assert.throws(()=>changeSession(s,{action:'save',answers:{unknown:answer(0)}},102000));
  const saved=changeSession(s,{action:'save',answers:{[q.id]:answer(0,1000)}},102000);
  assert.throws(()=>changeSession(saved,{action:'save',answers:{[q.id]:answer(0,999)}},103000));
});
test('expired submissions use the last saved answer, never a late correction', () => {
  const s=start(), q=s.blocks[0].questions[0], wrong=(q.answer+1)%4;
  const saved=changeSession(s,{action:'save',answers:{[q.id]:answer(wrong)}},102000);
  const expired=changeSession(saved,{action:'finish',answers:{[q.id]:answer(q.answer)}},100000+s.blocks[0].seconds*1000+1);
  assert.equal(expired.status,'complete'); assert.equal(expired.blocks[0].answers[q.id].choice,wrong);
  assert.deepEqual(changeSession(expired,{action:'finish',answers:{[q.id]:answer(q.answer)}},99999999),expired);
});
test('SAT modules lock when finished and enforce the ten-minute break before Math', () => {
  let s=start({mode:'simulation'});
  assert.throws(()=>changeSession(s,{action:'continue'},101000));
  s=changeSession(s,{action:'finish'},102000); s=changeSession(s,{action:'continue'},103000);
  s=changeSession(s,{action:'finish'},104000);
  assert.throws(()=>changeSession(s,{action:'continue'},105000));
  s=changeSession(s,{action:'continue'},704000); assert.equal(s.current,2); assert.equal(s.blocks[2].startedAt,704000);
});
function completedItems(count, {correct=true, ratio=1, exam='SAT', offset=0}={}) {
  const s=start({exam,mode:'practice',skill:'linear'});
  s.blocks[0].questions=catalog.questions.filter(q=>q.skill==='linear').slice(offset,offset+count);
  s.status='complete';s.completedAt=200000+offset*1000;
  for (const q of s.blocks[0].questions) s.blocks[0].answers[q.id]=answer(correct?q.answer:(q.answer+1)%4,q.targetSeconds*1000*ratio);
  return {session_id:'s'+offset,revision:1,state:s};
}
test('correct-but-slow students receive pace work; inaccurate students receive concept work', () => {
  const slow=summarize([completedItems(5,{ratio:1.6})],'SAT',300000).skills.find(s=>s.id==='linear');
  assert.equal(slow.status,'pace');assert.equal(slow.accuracy,100);assert.equal(slow.paceRatio,1.6);
  assert.equal(summarize([completedItems(5,{correct:false})],'SAT',300000).skills.find(s=>s.id==='linear').status,'learn');
});
test('repeated answers do not inflate evidence or improvement; exams remain separate', () => {
  const one=completedItems(1); const report=summarize(Array.from({length:6},(_,i)=>({...one,session_id:'s'+i})),'SAT',300000);
  assert.equal(report.freshQuestions,1); assert.equal(report.repeatedQuestions,5);
  assert.equal(report.skills.find(s=>s.id==='linear').status,'assess');
  assert.equal(report.skills.find(s=>s.id==='linear').improvement,null);
  assert.equal(summarize([one],'ACT',300000).freshQuestions,0);
});
test('improvement requires ten fresh samples and compares non-overlapping windows', () => {
  const r=summarize([completedItems(5,{correct:false}),completedItems(5,{offset:5,ratio:.7})],'SAT',300000).skills.find(s=>s.id==='linear');
  assert.equal(r.improvement.accuracyPoints,100);assert.equal(r.improvement.baselineCount,5);assert.equal(r.samples,10);
});
test('reflections persist only for completed questions and are bounded', () => {
  const row=completedItems(1), id=row.state.blocks[0].questions[0].id;
  const saved=changeSession(row.state,{action:'reflect',questionId:id,reason:'reading',note:' Read what is asked. '},300000);
  assert.deepEqual(saved.reflections[id],{reason:'reading',note:'Read what is asked.'});
  assert.throws(()=>changeSession(start(),{action:'reflect',questionId:id,reason:'reading',note:'x'},300000));
  assert.throws(()=>changeSession(row.state,{action:'reflect',questionId:id,reason:'other',note:'x'.repeat(1001)},300000));
});
