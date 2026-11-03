/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resumable timed practice, focused study and private progress UI.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Complete first-visit school setup before loading private progress.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lessons show as posters with their teacher and length; the lesson page leads with the video and Try this skill, with the full transcript a press away.
 */
'use strict';
(() => {
  const $ = id => document.getElementById('prep-' + id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const url = '/api/education/prep';
  let curriculum, progress, session, trainingPack, current = 0, busy = false, blocked = false, clockHidden = false;
  let lastTick = performance.now(), offset = 0, shownLesson = null, lastCheckpoint = 0;
  const now = () => Date.now() + offset;
  const clock = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
  const exam = () => $('exam').value;
  const science = () => exam() === 'ACT' && $('science').checked;
  async function api(path, body) {
    const response = await fetch(url + path, { method:body ? 'POST' : 'GET', credentials:'same-origin',
      headers: body ? { 'Content-Type':'application/json' } : {}, body:body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'Could not load your work.'); error.status = response.status; throw error; }
    return data;
  }
  function error(err) { $('error').textContent = err.message; $('error').hidden = false; }
  function clearError() { $('error').hidden = true; }
  function pane(name) { for (const key of ['home', 'session', 'lesson', 'training']) $(key).hidden = key !== name; window.scrollTo(0,0); }
  function title(id) { return curriculum.lessons.find(l => l.id === id)?.title || id; }
  async function refresh(initial = false) {
    clearError();
    progress = await api(`/progress?exam=${exam()}&science=${science()}`);
    if (initial) {
      $('exam').value = progress.profile.exam;
      $('date').value = progress.profile.testDate || '';
      $('budget').value = progress.profile.dailyMinutes || 15;
      if (exam() !== progress.exam) progress = await api(`/progress?exam=${exam()}&science=${science()}`);
    }
    renderHome();
  }
  function minutes(seconds) { const t = Math.round(seconds); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  function lessonCard(l) {
    return `<article class="lm-card prep-lesson-card"><button class="prep-poster" data-lesson="${esc(l.id)}" aria-label="Watch ${esc(l.title)}, taught by ${esc(l.teacher)}"><img src="${esc(l.poster)}" alt="" loading="lazy"><span class="prep-play" aria-hidden="true"></span><span class="prep-length">${minutes(l.seconds)}</span></button><span class="prep-section-tag">${esc(l.sections[exam()])} · with ${esc(l.teacher)}${progress.profile.lessons[l.id] ? ' · lesson reviewed' : ''}</span><h3>${esc(l.title)}</h3><p>${esc(l.learn)}</p>${lessonButton(l.id, 'Watch or read lesson')}</article>`;
  }
  function transcriptOf(lesson) {
    return lesson.transcript.map(c => `${c.label ? `<h3>${esc(c.label)}</h3>` : ''}<p>${esc(c.text)}</p>`).join('');
  }
  function lessonButton(id, label = 'Learn the method') { return `<button class="lm-btn lm-btn-ghost" data-lesson="${esc(id)}">${esc(label)}</button>`; }
  const sectionName = section => ({ rw:'Reading and Writing', math:'Math', english:'English', reading:'Reading', science:'Science (optional)', writing:'Writing (optional)', general:'Pacing and review' }[section] || section);
  const externalLink = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  function strategyCards(items, includeLesson = true) {
    return items.map(s => {
      const examples = curriculum.research.questionExamples.filter(q => q.strategyId === s.id && q.exam === exam());
      return `<details class="prep-strategy" data-strategy="${esc(s.id)}"><summary>${esc(s.title)} <span class="lm-help">· ${esc(sectionName(s.sections[exam()]))}</span></summary>
        <p><strong>Method:</strong> ${esc(s.method)}</p><p><strong>Shortcut:</strong> ${esc(s.shortcut)}</p><p><strong>Watch for:</strong> ${esc(s.caution)}</p><p>${esc(s.example)}</p>
        ${includeLesson && s.lessonId ? lessonButton(s.lessonId, 'Related foundation lesson & video') : ''}
        <button class="lm-btn lm-btn-secondary" data-build-training="${esc(s.id)}">Create a study pack</button>
        ${examples.length ? `<p><strong>Official question references</strong> — attempt the question before opening solutions.</p><ul>${examples.map(q => {
          const resource = curriculum.officialPractice.resources.find(r => r.id === q.resourceId);
          return `<li>${externalLink(resource.url + '#page=' + q.pdfPage, `${q.exam} test ${q.test} · ${q.section} · Q${q.question} · ${resource.kind === 'explanations' ? 'explanations (answers included)' : 'test booklet'}`)}<br>${esc(q.note)}</li>`;
        }).join('')}</ul>` : ''}
        <p class="lm-help">Original instructional method. Sources for the question type or related publisher guidance: ${s.sources.map(id => {
          const source = curriculum.research.sources.find(r => r.id === id); return externalLink(source.url, source.title);
        }).join(' · ')}</p></details>`;
    }).join('');
  }
  function renderStrategies() {
    if (!curriculum) return;
    const available = curriculum.research.strategies.filter(s => s.sections[exam()]);
    const sections = [...new Set(available.map(s => s.sections[exam()]))];
    const selected = $('strategy-section').value;
    $('strategy-section').innerHTML = '<option value="all">All sections</option>' + sections.map(s => `<option value="${esc(s)}">${esc(sectionName(s))}</option>`).join('');
    $('strategy-section').value = sections.includes(selected) ? selected : 'all';
    const query = $('strategy-search').value.trim().toLowerCase();
    const shown = available.filter(s => ($('strategy-section').value === 'all' || s.sections[exam()] === $('strategy-section').value) &&
      [s.title,s.method,s.shortcut,s.caution,s.example].join(' ').toLowerCase().includes(query));
    $('strategy-count').textContent = `${shown.length} of ${available.length} ${exam()} methods · researched ${curriculum.research.verifiedOn}. Selected official questions are mapped; most still need individual annotations.`;
    $('strategies').innerHTML = shown.length ? strategyCards(shown) : '<p>No matching methods. Try another section or search word.</p>';
  }
  function renderOfficial() {
    const collection = curriculum.officialPractice, resources = collection.resources.filter(r => r.exam === exam());
    $('official-note').textContent = collection.notes[exam()];
    $('official-date').textContent = collection.verifiedOn;
    $('official').innerHTML = resources.filter(r => r.kind === 'test').map(r => `<article class="lm-card"><h3>${esc(r.exam)} practice test ${r.test}</h3><p>${r.exam === 'SAT' ? 'Nonadaptive paper form · 120 questions' : 'Enhanced ACT · paper scoring and Writing task included'}</p><ul>${resources.filter(x => x.test === r.test).map(x => `<li>${externalLink(x.url, ({test:'Test booklet PDF',scoring:'Paper scoring guide',explanations:'Answer explanations','online-scoring':'Online scoring key (online form only)'})[x.kind])}</li>`).join('')}</ul></article>`).join('');
  }
  function renderHome() {
    const d = progress.dashboard;
    $('metrics').innerHTML = [[progress.freshQuestions,'Fresh questions'],[d.recentAccuracy === null ? '—' : d.recentAccuracy + '%','Accuracy · last 5 sessions'],[d.activeMinutes,'Active practice minutes'],[d.reviewedPacks,'Training packs reviewed']].map(([value,label]) => `<article class="lm-card"><p class="prep-metric">${esc(value)}</p><p>${esc(label)}</p></article>`).join('');
    $('coach-message').textContent = progress.coach.message;
    $('coach-tip').innerHTML = progress.coach.tip ? `<p><strong>Try this:</strong> ${esc(progress.coach.tip)}</p><p class="lm-help">${esc(progress.coach.caution)}</p>` : '';
    $('coach-actions').innerHTML = `${progress.coach.topicId ? `<button class="lm-btn lm-btn-secondary" data-build-training="${esc(progress.coach.topicId)}">Build training for my focus</button>` : ''}<a class="lm-btn lm-btn-ghost" href="#prep-training-heading">Choose a training topic</a>`;
    $('science-label').hidden = exam() !== 'ACT';
    $('format').textContent = exam() === 'SAT' ? '98 questions · 134 working minutes · 10-minute break.' : `English, Math, Reading${science() ? ' and Science' : ''} · ${science() ? '171 questions · 165' : '131 questions · 125'} working minutes. Section transitions allow a break.`;
    $('count').textContent = `${progress.freshQuestions} fresh questions · ${$('budget').value} minute daily goal`;
    $('focus').innerHTML = (progress.focus.length ? progress.focus : progress.skills.slice(0, 3)).map(s => `<article class="lm-card"><span class="prep-section-tag">${esc(s.section)} · ${esc(s.status)}</span><h3>${esc(s.title)}</h3><p>${esc(s.reason)}</p>${lessonButton(s.id)}<button class="lm-btn lm-btn-primary" data-practice="${esc(s.id)}">Practice</button></article>`).join('');
    $('skills').innerHTML = progress.skills.map(s => `<tr><td>${esc(s.title)}</td><td>${s.samples}</td><td>${s.accuracy === null ? '—' : s.accuracy + '%'}</td><td>${s.medianSeconds === null ? '—' : s.medianSeconds + 's · ' + s.paceRatio + '× target'}</td><td>${s.improvement ? `${s.improvement.accuracyPoints > 0 ? '+' : ''}${s.improvement.accuracyPoints} accuracy points${s.improvement.paceRatioChange === null ? '' : ' · ' + (s.improvement.paceRatioChange > 0 ? '+' : '') + s.improvement.paceRatioChange + '× pace'}` : 'Need 10 fresh'}</td></tr>`).join('');
    $('window').textContent = progress.window + ' Lower pace ratios are faster; accuracy must hold. No score prediction.';
    const lessons = curriculum.lessons.filter(l => l.sections[exam()] && (science() || l.domain !== 'science'));
    $('lessons').innerHTML = lessons.map(lessonCard).join('');
    $('resume-section').hidden = !progress.active.length;
    $('resume').innerHTML = progress.active.map(s => `<button class="lm-btn lm-btn-secondary" data-resume="${s.id}">${s.status === 'ready' ? 'Begin prepared' : 'Resume'} ${s.exam} ${s.mode} · ${new Date(s.createdAt).toLocaleDateString()}</button>`).join('');
    $('history').innerHTML = progress.history.length ? progress.history.map(s => `<button class="lm-btn lm-btn-secondary" data-resume="${s.id}">${new Date(s.date).toLocaleDateString()} · ${esc(s.mode)} · ${s.correct}/${s.count} correct (${s.accuracy}%) · ${clock(s.activeSeconds)} active</button>`).join('') : '<p class="lm-help">Your first completed session will appear here.</p>';
    renderStrategies(); renderOfficial();
    $('trend').innerHTML = progress.history.length ? progress.history.slice(0,10).reverse().map(r => `<button class="prep-trend-item" data-resume="${r.id}" aria-label="${esc(new Date(r.date).toLocaleDateString())}: ${r.accuracy}% correct, ${r.count} questions"><span>${r.accuracy}%</span><span class="prep-trend-bar" style="height:${Math.max(3,Math.round(r.accuracy*1.2))}px"></span><small>${esc(new Date(r.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</small></button>`).join('') : '<p>Complete your first practice to start your trend.</p>';
    const selected = $('training-topic').value;
    const methods = curriculum.research.strategies.filter(s => s.sections[exam()]);
    $('training-topic').innerHTML = methods.map(s => `<option value="${esc(s.id)}">${esc(sectionName(s.sections[exam()]))} · ${esc(s.title)}</option>`).join('');
    if (methods.some(s => s.id === selected)) $('training-topic').value = selected;
    $('training-list').innerHTML = progress.training.length ? progress.training.map(p => `<article class="lm-card"><h3>${esc(p.title)}</h3><p>${p.progress.reviewedCards.length} recall cards reviewed${p.progress.completedAt ? ' · Pack reviewed' : ' · In progress'}</p><button class="lm-btn lm-btn-secondary" data-training="${p.id}">Open saved training</button></article>`).join('') : '<p>Your saved topic lessons and notes will appear here.</p>';
  }
  async function createPack(topicId, quick = false) {
    if (busy) return;
    $('lesson').querySelector('video')?.pause();
    busy = true; clearError(); $('status').textContent = 'Creating and saving your training…';
    $('training-form').querySelector('button').disabled = true;
    try {
      trainingPack = await api('/training', { exam:exam(), strategyIds:[topicId], mode:quick ? 'guided' : $('training-mode').value, goal:quick ? '' : $('training-goal').value });
      history.replaceState(null, '', `?training=${trainingPack.id}`); pane('training'); renderTraining(); $('status').textContent = 'Training saved to your student account.';
    } catch (err) {
      $('status').textContent = 'Training could not be created. Your existing packs are still saved.';
      throw err;
    } finally { busy = false; $('training-form').querySelector('button').disabled = false; }
  }
  async function openTraining(id) {
    if (busy) return;
    busy = true; clearError();
    try {
      trainingPack = await api('/training/' + id); $('exam').value = trainingPack.exam;
      history.replaceState(null, '', `?training=${trainingPack.id}`); pane('training'); renderTraining();
    } finally { busy = false; }
  }
  function renderTraining() {
    const p = trainingPack, c = p.content;
    $('training').innerHTML = `<button class="lm-btn lm-btn-ghost" data-action="home">← Dashboard</button><div class="lm-eyebrow">Saved ${c.mode === 'personalized' ? 'personalized explanation · AI-assisted' : 'topic study pack'}</div><h2>${esc(p.title)}</h2>${c.goal ? `<p><strong>Your goal:</strong> ${esc(c.goal)}</p>` : ''}<p>${esc(c.summary)}</p>
      <h3>Work through the method</h3><ol>${c.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><h3>Worked example</h3><div class="prep-training-example">${esc(c.workedExample)}</div>
      <h3>Recall cards</h3><p>Try answering before opening each card. Reviewed cards stay saved.</p><div class="prep-list">${c.cards.map(card => `<details class="prep-strategy"><summary>${esc(card.front)}${p.progress.reviewedCards.includes(card.id) ? ' · Reviewed' : ''}</summary><p>${esc(card.back)}</p><button class="lm-btn lm-btn-secondary" data-training-card="${esc(card.id)}">Mark card reviewed</button></details>`).join('')}</div>
      <h3>My lesson learned</h3><textarea id="prep-training-note" class="prep-note" maxlength="1000" aria-label="My training reflection">${esc(p.progress.note)}</textarea><div class="prep-controls"><button class="lm-btn lm-btn-secondary" data-training-action="note">Save note</button><button class="lm-btn lm-btn-primary" data-training-action="complete">Mark pack reviewed</button><button class="lm-btn lm-btn-ghost" data-training="${p.id}">Reload saved pack</button></div>
      <p class="lm-help">${p.progress.completedAt ? 'Pack reviewed. ' : ''}${p.progress.reviewedCards.length}/${c.cards.length} recall cards reviewed. Studying records activity; fresh practice answers establish progress.</p>
      <h3>Try it on fresh practice</h3><div class="prep-controls">${c.practiceSkills.map(id => `${lessonButton(id, 'Foundation lesson: ' + title(id))}<button class="lm-btn lm-btn-primary" data-practice="${esc(id)}">Practice ${esc(title(id))}</button>`).join('') || '<p>This topic has no dedicated in-app question set yet. Use the official practice resources on your dashboard.</p>'}</div>
      <h3>Methods and sources</h3>${c.methods.map(m => `<p><strong>${esc(m.title)}:</strong> ${esc(m.caution)}</p>`).join('')}<ul>${c.sources.map(s => `<li>${externalLink(s.url,s.title)}</li>`).join('')}</ul>`;
  }
  async function saveTraining(action, cardId) {
    if (busy || !trainingPack) return;
    busy = true; clearError(); $('status').textContent = 'Saving training progress…';
    $('training').querySelectorAll('button,textarea').forEach(el => el.disabled = true);
    try {
      trainingPack = await api('/training/' + trainingPack.id, { revision:trainingPack.revision, action, cardId, note:$('training-note').value });
      renderTraining(); $('status').textContent = 'Training progress saved.';
    } finally { busy = false; $('training').querySelectorAll('button,textarea').forEach(el => el.disabled = false); }
  }
  function accept(data) { session = data; $('exam').value = data.exam; $('science').checked = data.science; offset = data.serverNow - Date.now(); lastTick = performance.now(); }
  async function start(mode, skill) {
    if (busy) return;
    busy = true; clearError(); $('status').textContent = 'Preparing your practice…';
    try {
      accept(await api('/sessions', { exam:exam(), science:science(), multiplier:Number($('multiplier').value), mode, skill }));
      trainingPack = null; current = 0; blocked = false; history.replaceState(null, '', `?session=${session.id}`); pane('session'); renderSession();
    } finally { busy = false; $('status').textContent = ''; }
  }
  async function resume(id) {
    if (busy) return;
    busy = true; clearError();
    try { accept(await api('/sessions/' + id)); blocked = false; current = 0; history.replaceState(null, '', `?session=${session.id}`); pane('session'); renderSession(); }
    finally { busy = false; }
  }
  function block() { return session?.blocks[session.current]; }
  function accrue() {
    const tick = performance.now(), elapsed = tick - lastTick; lastTick = tick;
    const b = block();
    if (!b || b.endedAt || session.status !== 'active' || busy || blocked || document.hidden || $('session').hidden) return;
    const q = b.questions[current]; if (!q) return;
    const a = b.answers[q.id] ||= { choice:null, ms:0, confidence:'unsure', flagged:false };
    const room = Math.max(0, Math.min(b.seconds * 1000, now() - b.startedAt) - Object.values(b.answers).reduce((sum, x) => sum + x.ms, 0));
    a.ms += Math.round(Math.min(Math.max(0, elapsed), room));
  }
  async function save(action = 'save', extra = {}) {
    if (busy || blocked || !session) return false;
    if (session.status === 'ready' && action !== 'begin') return true;
    accrue(); busy = true; clearError();
    $('session').querySelectorAll('button,select,input,textarea').forEach(el => el.disabled = true);
    try {
      accept(await api('/sessions/' + session.id, { revision:session.revision, action, answers:block()?.answers || {}, ...extra }));
      if (action === 'continue') current = 0;
      $('status').textContent = 'Saved'; lastCheckpoint = performance.now(); renderSession(); return true;
    } catch (err) {
      if (err.status === 409) blocked = true;
      if (session.status === 'active') renderSession();
      error(err); $('status').textContent = blocked ? 'Reload this session to get its saved version.' : 'Not saved. Your answers are still here; retry before leaving.';
      return false;
    } finally { busy = false; lastTick = performance.now(); $('session').querySelectorAll('button,select,input,textarea').forEach(el => el.disabled = blocked && el.dataset.action !== 'reload'); }
  }
  function renderSession() {
    if (session.status === 'ready') {
      $('session').innerHTML = `<div class="lm-eyebrow">Prepared for you · ${session.exam}</div><h2>Your ${esc(session.mode)} is ready</h2><p>The clock has not started. Begin when you are ready to work.</p><ul>${session.blocks.map(b => `<li>${esc(b.label)} · ${b.count} questions · ${Math.round(b.seconds/60)} minutes</li>`).join('')}</ul><button class="lm-btn lm-btn-primary" data-action="begin">Begin practice</button><button class="lm-btn lm-btn-ghost" data-action="home">Back to dashboard</button>`;
      return;
    }
    if (session.status === 'complete') { renderReview(); return; }
    const b = block();
    if (b.endedAt) {
      $('session').innerHTML = `<h2>${esc(b.label)} saved</h2><p>Your answers are locked for this section. Rest before continuing.</p><p id="prep-break" role="status"></p><button class="lm-btn lm-btn-primary" data-action="continue">Start next section</button><button class="lm-btn lm-btn-ghost" data-action="home">Back to Study Lab</button>`;
      return;
    }
    const q = b.questions[current], a = b.answers[q.id] || { choice:null, ms:0, confidence:'unsure', flagged:false };
    $('session').innerHTML = `<div class="prep-top"><div><div class="lm-eyebrow">${esc(b.label)}</div><h2>Question ${current + 1} of ${b.count}</h2></div><div><span class="prep-clock" id="prep-clock" aria-label="Time remaining"></span><button class="lm-btn lm-btn-ghost" data-action="clock">${clockHidden ? 'Show' : 'Hide'} clock</button></div></div>
      <p class="lm-help">Working time continues while this tab is hidden or closed. Active question time pauses when hidden. Answers save as you go.</p>
      <p class="prep-question" id="prep-question">${esc(q.prompt)}</p><div role="group" aria-labelledby="prep-question">${q.options.map((o,i) => `<button class="prep-choice" data-choice="${i}" aria-pressed="${a.choice === i}">${String.fromCharCode(65+i)}. ${esc(o)}</button>`).join('')}</div>
      <div class="prep-controls"><label>How sure are you?<select id="prep-confidence"><option value="unsure" ${a.confidence === 'unsure' ? 'selected' : ''}>Unsure</option><option value="guess" ${a.confidence === 'guess' ? 'selected' : ''}>Guessing</option><option value="sure" ${a.confidence === 'sure' ? 'selected' : ''}>Sure</option></select></label><label><input type="checkbox" id="prep-flag" ${a.flagged ? 'checked' : ''}> Mark for review</label><span class="lm-help">Practice target: ${Math.round(q.targetSeconds * session.multiplier)}s (a guide, not a per-question limit)</span></div>
      <div class="prep-controls"><button class="lm-btn lm-btn-secondary" data-action="previous">Previous</button><button class="lm-btn lm-btn-primary" data-action="next">Next question</button><button class="lm-btn lm-btn-ghost" data-action="save">Save now</button><button class="lm-btn lm-btn-ghost" data-action="reload">Reload saved session</button></div>
      <nav class="prep-map" aria-label="Questions in this section">${b.questions.map((item,i) => `<button data-index="${i}" aria-label="Question ${i+1}${b.answers[item.id]?.flagged ? ', flagged' : ''}" aria-current="${i === current}" class="${b.answers[item.id]?.choice != null ? 'answered' : ''}">${i+1}${b.answers[item.id]?.flagged ? ' ⚑' : ''}</button>`).join('')}</nav>
      <details><summary>Finish this section</summary><p>${b.questions.filter(item => b.answers[item.id]?.choice == null).length} unanswered. Finishing locks these answers.</p><button class="lm-btn lm-btn-primary" data-action="finish">Submit section</button></details>`;
    tickClock();
  }
  function renderReview() {
    let correct = 0, total = 0;
    for (const b of session.blocks) for (const q of b.questions) { total++; correct += Number(b.answers[q.id]?.choice === q.answer); }
    $('session').innerHTML = `<div class="lm-eyebrow">Practice complete · ${session.exam}</div><h2>Here’s what to work on next.</h2><p class="prep-stat">${correct}/${total} correct</p><p>Raw practice accuracy: ${Math.round(correct/total*100)}%. This is not an official scaled score.</p><button class="lm-btn lm-btn-primary" data-action="home">See my updated focus</button>
      ${session.blocks.map(b => `<h3>${esc(b.label)}</h3>${b.questions.map(q => {
        const a = b.answers[q.id], r = session.reflections[q.id];
        return `<article class="prep-review"><span class="lm-pill">${a?.choice === q.answer ? 'Correct' : 'Review'}</span><h3>${esc(q.prompt)}</h3><p>Your answer: ${esc(a?.choice == null ? 'Unanswered' : q.options[a.choice])} · Correct: ${esc(q.options[q.answer])}</p><p>${esc(q.explanation)}</p><p class="lm-help">${Math.round((a?.ms || 0)/1000)}s active · target ${Math.round(q.targetSeconds * session.multiplier)}s · confidence: ${esc(a?.confidence || 'not recorded')}</p>${lessonButton(q.skill, 'Review ' + title(q.skill))}
        <form data-reflect="${q.id}"><label>What happened?<select name="reason">${[['concept','Need the concept'],['reading','Misread the question'],['calculation','Calculation slip'],['time','Ran short of time'],['guess','Guessed'],['other','Other / worked well']].map(([v,t]) => `<option value="${v}" ${r?.reason === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>My lesson learned<textarea class="prep-note" name="note" maxlength="1000" placeholder="Next time I will…">${esc(r?.note || '')}</textarea></label><button class="lm-btn lm-btn-secondary" type="submit">Save reflection</button>${r ? '<span class="lm-help"> Saved</span>' : ''}</form></article>`;
      }).join('')}`).join('')}`;
  }
  function showLesson(id) {
    const lesson = curriculum.lessons.find(l => l.id === id); if (!lesson) return;
    shownLesson = id; pane('lesson');
    $('lesson').innerHTML = `<button class="lm-btn lm-btn-ghost" data-action="back">← Back</button><div class="lm-eyebrow">Taught by ${esc(lesson.teacher)}</div><h2>${esc(lesson.title)}</h2><video class="prep-video" controls preload="metadata" playsinline poster="${esc(lesson.poster)}"><source src="${esc(lesson.video)}" type="video/mp4"><track kind="captions" srclang="en" label="English" src="${esc(lesson.captions)}">Your browser does not support video; the full lesson is written out below.</video><div class="prep-controls"><button class="lm-btn lm-btn-primary" data-practice="${esc(id)}">Try this skill</button><button class="lm-btn lm-btn-secondary" data-action="learned">Mark lesson reviewed</button></div><details class="prep-lesson-text"><summary>Read the lesson instead</summary>${transcriptOf(lesson)}</details><p class="lm-help">Captions are in the video's menu. ${esc(lesson.teacher)}'s voice is AI-generated. Reviewing a lesson records study activity; fresh practice answers establish progress.</p>`;
    const methods = curriculum.research.strategies.filter(s => s.lessonId === id && s.sections[exam()]);
    if (methods.length) $('lesson').insertAdjacentHTML('beforeend', '<h3>Related methods and traps</h3>' + strategyCards(methods, false));
    $('lesson').querySelector('video').addEventListener('error', () => { $('status').textContent = 'Video unavailable. The complete lesson is readable below.'; $('lesson').querySelector('details').open = true; }, true);
  }
  async function home() {
    if (session?.status === 'active' && !block()?.endedAt && !await save()) return;
    session = null; trainingPack = null; shownLesson = null; history.replaceState(null, '', location.pathname); pane('home'); await refresh();
  }
  async function navigate(index) {
    if (await save()) { current = Math.max(0, Math.min(index, block().questions.length - 1)); renderSession(); }
  }
  async function action(name) {
    if (name === 'home') return home();
    if (name === 'back') { $('lesson').querySelector('video')?.pause(); shownLesson = null; pane(trainingPack ? 'training' : session ? 'session' : 'home'); return; }
    if (name === 'learned') { await api('/profile', { action:'lesson', lessonId:shownLesson }); $('status').textContent = 'Lesson reviewed. Now try it on a fresh question.'; await refresh(); return; }
    if (name === 'reload') return resume(session.id);
    if (name === 'clock') { clockHidden = !clockHidden; renderSession(); return; }
    if (name === 'previous') return navigate(current-1);
    if (name === 'next') return navigate(current+1);
    if (name === 'continue' && now() < session.availableAt) return;
    return save(name);
  }
  function tickClock() {
    if (!session || session.status !== 'active') return;
    const b = block();
    if (b.endedAt) {
      if ($('break')) $('break').textContent = now() < session.availableAt ? `Scheduled break: ${clock((session.availableAt-now())/1000)} remaining` : 'Ready when you are.';
      return;
    }
    const remaining = (b.startedAt + b.seconds * 1000 - now()) / 1000;
    if ($('clock')) $('clock').textContent = clockHidden ? 'Clock hidden' : clock(remaining);
    if (remaining <= 0 && !busy && !blocked) save('finish').catch(error);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.type === 'submit' && button.closest('form')) return;
    const d = button.dataset;
    if (busy) return;
    const run = async () => {
      if (d.buildTraining) return createPack(d.buildTraining, true);
      if (d.training) return openTraining(d.training);
      if (d.trainingAction) return saveTraining(d.trainingAction);
      if (d.trainingCard) return saveTraining('review-card', d.trainingCard);
      if (d.start) return start(d.start);
      if (d.practice) { $('lesson').querySelector('video')?.pause(); return start('practice', d.practice); }
      if (d.resume) return resume(d.resume);
      if (d.lesson) return showLesson(d.lesson);
      if (d.action) return action(d.action);
      if (d.index !== undefined) return navigate(Number(d.index));
      if (d.choice !== undefined) {
        accrue(); const q = block().questions[current];
        block().answers[q.id] ||= { choice:null, ms:0, confidence:'unsure', flagged:false };
        block().answers[q.id].choice = Number(d.choice); return save();
      }
    };
    run().catch(error);
  });
  document.addEventListener('change', event => {
    if (event.target === $('strategy-section')) { renderStrategies(); return; }
    if (event.target === $('exam') || event.target === $('science')) { refresh().catch(error); return; }
    if (event.target === $('confidence') || event.target === $('flag')) {
      accrue(); const id = block().questions[current].id;
      block().answers[id] ||= { choice:null, ms:0, confidence:'unsure', flagged:false };
      block().answers[id].confidence = $('confidence').value; block().answers[id].flagged = $('flag').checked;
      save().catch(error);
    }
  });
  $('strategy-search').addEventListener('input', renderStrategies);
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target === $('training-form')) createPack($('training-topic').value).catch(err => { $('status').textContent = 'Training could not be created. Your existing packs are still saved.'; error(err); });
    else if (event.target === $('goal')) api('/profile', { exam:exam(), dailyMinutes:Number($('budget').value), testDate:$('date').value }).then(() => { $('status').textContent = 'Study plan saved'; return refresh(); }).catch(error);
    else if (event.target.dataset.reflect) {
      const fields = new FormData(event.target);
      save('reflect', { questionId:event.target.dataset.reflect, reason:fields.get('reason'), note:fields.get('note') }).catch(error);
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save().catch(error); lastTick = performance.now(); });
  window.addEventListener('beforeunload', event => { if (session?.status === 'active' && !block()?.endedAt) { event.preventDefault(); event.returnValue = ''; } });
  setInterval(() => {
    accrue(); tickClock();
    if (session?.status === 'active' && !block()?.endedAt && !document.hidden && !busy && !blocked && performance.now()-lastCheckpoint > 5000) save().catch(error);
  }, 1000);
  (async () => {
    if (window.LM?.me) await window.LM.me();
    curriculum = await api('/catalog'); await refresh(true);
    const params = new URLSearchParams(location.search), id = params.get('session'), pack = params.get('training');
    if (id) await resume(id); else if (pack) await openTraining(pack);
  })().catch(error);
})();
