/** CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday; his open jobs need new documents): Generate again (N), a bulk action of Saved and Getting ready in the Table and the List, where N counts the selected jobs that have documents and are not applied or removed; it hands them to tools/career-regenerate.js, which asks once and queues them in his store. The List's rows of those stages can now always be selected (Generate again needs no computer); its bar offers Fill in several on my Chrome (while offered) and Generate again. Guard: tests/career-regenerate-browser.test.mjs.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH (Roger, 2026-11-21: "i really need to be able to post 200 resumes by monday"): Fill in several on my Chrome, the bulk action of Saved and Getting ready when his Job Apply computer reports browser-apply (the filled button of Getting ready). It hands every selected job to tools/career-apply-batch.js, whose approval sheet says which still need documents and offers Prepare them (this table's own Prepare applications for those jobs). The List can select too: while the action is offered, each List row of those stages has the same checkbox (the page draws it, CareerJobsTable.picks), the selection is this module's, and the List's bar offers only Fill in several on my Chrome.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.68.9: Bulk Send names the person's chosen Job Apply connected device when asking to send approved applications.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "when i click prepare application i still need the option of 'Other experience · optional — Agentic Federal | oshal (open-source)' to be selectable. this is not a choice in bulk edit"): Prepare applications asks first. One step lists the person's Other experience as the application page does ("Other experience · optional", each entry with its organization), under "Include in every selected application", with the count in its title and its button ("Prepare 4 applications") and the jobs left out; the entries the person prepared their last application with are ticked (GET /experience-bank?summary=1 last). Nothing is queued until Prepare is pressed; Cancel, Escape or a failed read queue nothing and say so. Each queued preparation carries exactly the ticked entries (CareerBulkQueue saves them on the job's tailoring before it is prepared), and the line after says which. Guard: tests/career-prepare-other-experience-browser.test.mjs.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.0 (Roger, 2026-11-16, 194 saved jobs on My jobs: "a consolidated job view where i can select multiple rows on a table and push all the applications to prepare application that i select ... bulk select for all of the subsequent screens as well"; and "the job location doesnt transfer to the my jobs page and i cant look at jobs near me"). A Table view beside the List on Saved, Getting ready, Removed, Applied, Interviewing, Offer and Closed, remembered per person in their own browser storage. One row per job with Company, Title, Location, Match, Stage, Saved and Résumé; every column sorts; filters for distance (within 10, 25, 50 or 100 miles, or Remote), résumé and stage. A checkbox on each row, select all of what the filters show (indeterminate when part is chosen, Shift for a range) and a running count. A bar with the stage's bulk actions: Saved prepares applications, removes, or moves to Getting ready; Getting ready sends from the person's computer, prepares again or removes; Removed puts back or prepares; Applications move between Interviewing, Offer and Closed. Prepare and every move run through CareerBulkQueue (each job's own writes, at most two preparations at a time), with progress on each row and overall, Cancel for what is queued, Resume after a pause and Clear. Send reads each job's exact packet, then asks once with the count and the companies and sends nothing until the person ticks the approval and presses Send. At phone width the table is a selectable list with the same actions. Guard: tests/career-jobs-table-browser.test.mjs.
 */
(function (root) {
  'use strict';
  const API = '/api/career-hunter';
  const DONE = new Set(['applied', 'interview', 'offer', 'rejected']), READY = new Set(['promoted', 'generated', 'deferred']);
  const DETAIL_FAILURES = new Set(['job_details_unavailable', 'job_context_unavailable']);
  /** The stages a job can be in, in the order a job moves, as a person reads them. */
  const STAGE_ORDER = ['Saved', 'Getting ready', 'Applied', 'Interviewing', 'Offer', 'Closed', 'Removed'];
  const STATUS_STAGE = { applied: 'Applied', interview: 'Interviewing', offer: 'Offer', rejected: 'Closed', dismissed: 'Removed' };
  /** Moves a job can make, the body its own page or row sends, and the word for it done. */
  const MOVES = {
    queue: { label: 'Getting ready', body: { status: 'promoted', favorite: true }, done: 'Moved to Getting ready' },
    interview: { label: 'Interviewing', body: { status: 'interview' }, done: 'Moved to Interviewing' },
    offer: { label: 'Offer', body: { status: 'offer' }, done: 'Moved to Offer' },
    rejected: { label: 'Closed', body: { status: 'rejected' }, done: 'Moved to Closed' },
  };
  /** Each stage's bulk actions; the first named is the stage's filled button. */
  const STAGE_ACTIONS = {
    saved: { buttons: ['prepare', 'fill', 'regenerate', 'remove'], moves: ['queue'] }, queue: { buttons: ['fill', 'send', 'prepare', 'regenerate', 'remove'], moves: [] },
    dismissed: { buttons: ['putback', 'prepare'], moves: [] }, status: { buttons: [], moves: ['interview', 'offer', 'rejected'] },
    interview: { buttons: [], moves: ['offer', 'rejected'] }, offer: { buttons: [], moves: ['interview', 'rejected'] },
    closed: { buttons: [], moves: ['interview', 'offer'] },
  };
  const LABELS = { prepare: 'Prepare applications', remove: 'Remove', putback: 'Put back in Saved', send: 'Send from my computer', fill: 'Fill in several on my Chrome', regenerate: 'Generate again' };
  /** The stages whose List rows can be selected, for Fill in several on my Chrome and Generate again. */
  const LIST_PICKS = new Set(['saved', 'queue']);
  const MILES = [10, 25, 50, 100], PER = 300, MOST = 2000;
  const COLUMNS = [['company', 'Company'], ['title', 'Title'], ['location', 'Location'], ['match', 'Match'], ['stage', 'Stage'], ['saved', 'Saved'], ['resume', 'Résumé']];
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => root.document.getElementById(id);
  const S = { deps: null, layout: 'list', rows: [], selected: new Set(), anchor: null, sort: { key: 'match', dir: -1 },
    filter: { within: '', resume: '', stage: '' }, home: null, epoch: 0, queue: null, error: '', loading: false, reloadTimer: null, ended: new Set(), computer: null, fill: false, availability: null, shift: false, busy: false };
  const phone = typeof root.matchMedia === 'function' ? root.matchMedia('(max-width: 640px)') : { matches: false, addEventListener() {} };

  /** @description Read a remembered value from the person's own storage; '' when the browser refuses. */
  function recall(key) { try { return key ? root.localStorage.getItem(key) || '' : ''; } catch (_) { return ''; } }
  /** @description Remember a value in the person's own storage; nothing happens when the browser refuses. */
  function keep(key, value) { try { if (key) root.localStorage.setItem(key, value); } catch (_) { /* the view still switches for this visit */ } }
  const viewKey = () => (S.deps && S.deps.owner ? 'career-jobs-view:v1:' + S.deps.owner : '');

  /** @description The stage a job is in, in a person's words. @param {object} job @returns {string} */
  function stageOf(job) { return STATUS_STAGE[job.status] || (READY.has(job.status) ? 'Getting ready' : 'Saved'); }
  /** @description The words for an engine reason, the paste words for a job Career could not read. */
  function reasonWords(code, job) {
    const actions = root.CareerJobActions;
    if (!actions) return '';
    if (DETAIL_FAILURES.has(code) && !/\S/.test(String(job.description || ''))) return actions.DETAILS_NEEDED;
    return actions.message(code);
  }
  /** @description Whether Career says it cannot read this job until its description is pasted. */
  function unread(job) { return Boolean((root.CareerJobActions && root.CareerJobActions.detailsNeeded(job)) || (typeof job.details_needed === 'string' && job.details_needed.trim())); }

  /**
   * @description A job's résumé, as the job's own record says it: prepared, being prepared, failed with its reason, or not yet.
   * @param {object} job A job from GET /jobs.
   * @returns {{kind:string, word:string, reason:string}}
   */
  function resumeOf(job) {
    const board = job.board || {}, draft = board.generationDraft || {};
    if (draft.state === 'requested' && !(board.requestId === draft.requestId && board.completedAt)) return { kind: 'running', word: 'Preparing…', reason: '' };
    if (job.has_resume) return { kind: 'done', word: 'Prepared', reason: '' };
    if (board.phase === 'failed' && board.completedAt) return { kind: 'failed', word: 'Failed', reason: reasonWords(board.error, job) };
    if (unread(job)) return { kind: 'none', word: 'Needs the job description', reason: '' };
    return { kind: 'none', word: 'Not prepared', reason: '' };
  }
  /** @description The queue's word for a job's résumé while it is queued, preparing or just ended; otherwise the job's own. */
  function resumeShown(job) {
    const item = S.queue && S.queue.latest(job.id);
    // A preparation the queue saw finish reads Prepared at once; the stage is read again a moment later.
    if (item && item.kind === 'prepare' && (['queued', 'running', 'failed'].includes(item.state) || (item.state === 'done' && !job.has_resume))) {
      const said = root.CareerBulkQueue.words(item);
      // A row says why only when it failed; waiting is said once, in the overall line.
      return { kind: item.state, word: said.word, reason: item.state === 'failed' ? said.reason : '' };
    }
    return resumeOf(job);
  }
  /** @description The words of a move or send the queue holds for a job, shown in its Stage cell, or ''. */
  function stageNote(job) {
    const item = S.queue && S.queue.latest(job.id);
    if (!item || item.kind === 'prepare' || !['queued', 'running', 'failed'].includes(item.state)) return '';
    const said = root.CareerBulkQueue.words(item);
    return item.state === 'queued' ? 'Queued: ' + (item.label || said.word) : said.word + (said.reason ? ': ' + said.reason : '');
  }

  /**
   * @description Where a job is, for the Location column: Remote, the place with its distance from home, or Location unknown.
   * @param {object} job A job with location, workplaceType and distanceMiles.
   * @returns {{word:string, miles:number|null, remote:boolean}}
   */
  function placeOf(job) {
    const remote = job.workplaceType === 'remote' || (job.workplaceType == null && Number(job.remote) === 1);
    const miles = Number.isFinite(Number(job.distanceMiles)) && job.distanceMiles !== null && job.distanceMiles !== '' ? Number(job.distanceMiles) : null;
    if (remote) return { word: 'Remote', miles: null, remote: true };
    const where = String(job.location || '').trim(), hybrid = job.workplaceType === 'hybrid' ? ' · Hybrid' : '';
    if (!where) return { word: 'Location unknown' + hybrid, miles, remote: false };
    // Miles as the List says them (career-job-place.js): one decimal at most, "from home".
    return { word: where + hybrid + (miles != null ? ' · ' + Number(miles.toFixed(1)) + ' mi from home' : ''), miles, remote: false };
  }
  /** @description When the person saved the job, as a time; null when unknown. */
  function savedTime(job) { const at = Date.parse((job.board && job.board.savedAt) || ''); return Number.isFinite(at) ? at : null; }
  function savedWords(job) { const at = savedTime(job); return at == null ? '—' : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function matchOf(job) { const value = Number(job.ai_fit_score); return job.ai_fit_score != null && Number.isFinite(value) ? value : null; }

  /** @description Whether a job passes the table's own filters (distance, résumé, stage). */
  function passes(job) {
    const { within, resume, stage } = S.filter, place = placeOf(job);
    if (within === 'remote' && !place.remote) return false;
    if (within && within !== 'remote' && !(place.miles != null && !place.remote && place.miles <= Number(within))) return false;
    if (resume === 'prepared' && !job.has_resume) return false;
    if (resume === 'none' && job.has_resume) return false;
    if (stage && stageOf(job) !== stage && !(stage === 'Applications' && DONE.has(job.status))) return false;
    return true;
  }
  /** @description One column's value for sorting; an empty value sorts last whichever way the column goes. */
  function sortValue(job, key) {
    if (key === 'company') return String(job.company || '').toLowerCase();
    if (key === 'title') return String(job.title || '').toLowerCase();
    if (key === 'location') { const place = placeOf(job); return place.miles != null ? place.miles : place.remote ? 1e7 : null; }
    if (key === 'match') return matchOf(job);
    if (key === 'stage') return STAGE_ORDER.indexOf(stageOf(job));
    if (key === 'saved') return savedTime(job);
    return ['done', 'running', 'failed', 'none'].indexOf(resumeOf(job).kind);
  }
  /** @description The rows the filters show, in the chosen order. @returns {object[]} */
  function visible() {
    if (S.layout !== 'table') return S.deps && S.deps.rows ? S.deps.rows() : [];
    const { key, dir } = S.sort;
    return S.rows.filter(passes).sort((a, b) => {
      const x = sortValue(a, key), y = sortValue(b, key);
      if (x == null || y == null) return x == null && y == null ? a.id - b.id : x == null ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
    });
  }


  /** @description A same-origin address a person may follow (the home-location link the job route names), else Settings. */
  function sameOrigin(href) {
    try { const url = new URL(String(href || ''), root.location.href); if (url.origin === root.location.origin) return url.pathname + url.search; } catch (_) { /* not an address */ }
    return API + '/settings';
  }
  /** @description The line the job route gives when the person has no home location, with the way to set it; none while the page shows its own home line. */
  function homeLine() {
    const home = S.home;
    const page = root.document.getElementById('jobsHomeLine');
    if (!home || home.known !== false || (page && !page.hidden)) return '';
    return `<p class="jt-home" id="jtHome">${esc(home.line || 'Add your home location to see how far each job is.')} <a href="${esc(sameOrigin(home.settingsUrl))}" data-career-tool="${esc(home.settingsTool || 'career-settings')}">${esc(home.linkLabel || 'Set your home location')}</a></p>`;
  }
  /** @description The table's own filters: distance from home (or Remote), résumé, and on Saved the stage. */
  function filtersMarkup() {
    const pick = (value, current) => (String(value) === String(current) ? ' selected' : '');
    const homeless = S.home && S.home.known === false;
    const within = MILES.map((m) => `<option value="${m}"${pick(m, S.filter.within)}${homeless ? ' disabled' : ''}>Within ${m} miles</option>`).join('');
    const stage = S.deps.stage === 'saved' ? `<label class="jt-filter"><span>Stage</span><select id="jtStage"><option value="">Any stage</option>${['Saved', 'Getting ready', 'Applications'].map((name) => `<option value="${name}"${pick(name, S.filter.stage)}>${name}</option>`).join('')}</select></label>` : '';
    return `<div class="jt-filters"><label class="jt-filter"><span>Distance</span><select id="jtWithin"><option value="">Any distance</option>${within}<option value="remote"${pick('remote', S.filter.within)}>Remote</option></select></label>`
      + `<label class="jt-filter"><span>Résumé</span><select id="jtResume"><option value="">Any résumé</option><option value="prepared"${pick('prepared', S.filter.resume)}>Résumé prepared</option><option value="none"${pick('none', S.filter.resume)}>Not prepared</option></select></label>`
      + `${stage}<span class="jt-count" id="jtCount" role="status"></span></div>${homeLine()}`;
  }
  /** @description The way into an application already in Getting ready or Applications (a saved job is prepared from the bar). */
  function openButton(job) {
    if (!DONE.has(job.status) && !READY.has(job.status)) return '';
    return `<button type="button" class="ck-btn jt-open-btn" data-table-open="${job.id}" data-done="${DONE.has(job.status)}" aria-label="Open the application for ${esc(job.title)} at ${esc(job.company)}">Open</button>`;
  }
  /** @description The words in a job's Résumé cell, with the reason under a failure. */
  function resumeCell(job) {
    const resume = resumeShown(job);
    return `<span class="jt-word">${esc(resume.word)}</span>${resume.reason ? `<span class="jt-reason">${esc(resume.reason)}</span>` : ''}`;
  }
  const checkLabel = (job) => `Select ${esc(job.title)} at ${esc(job.company)}`;
  /** @description One table row. @param {object} job @returns {string} */
  function rowMarkup(job) {
    const on = S.selected.has(job.id), place = placeOf(job), match = matchOf(job), resume = resumeShown(job);
    return `<tr data-id="${job.id}" data-selected="${on}"><td class="jt-check"><label class="jt-pick"><input type="checkbox" data-select="${job.id}" aria-label="${checkLabel(job)}"${on ? ' checked' : ''}></label></td>`
      + `<td class="jt-col-company">${esc(job.company)}</td><td class="jt-col-title"><button type="button" class="jt-title" data-posting="${job.id}">${esc(job.title)}</button></td>`
      + `<td class="jt-col-location"${place.remote ? ' data-remote' : ''}>${esc(place.word)}</td><td class="jt-col-match">${match == null ? (unread(job) ? 'Details needed' : '—') : esc(match)}</td>`
      + `<td class="jt-col-stage" data-stage-cell>${esc(stageNote(job) || stageOf(job))}</td><td class="jt-col-saved">${esc(savedWords(job))}</td>`
      + `<td class="jt-col-resume" data-resume="${esc(resume.kind)}" data-resume-cell>${resumeCell(job)}</td><td class="jt-col-open">${openButton(job)}</td></tr>`;
  }
  /** @description The header cell of one sortable column. */
  function headCell([key, label]) {
    const on = S.sort.key === key, order = on ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th scope="col" class="jt-col-${key}" aria-sort="${order}"><button type="button" class="jt-sort" data-sort="${key}">${esc(label)}<span class="jt-arrow" aria-hidden="true">${on ? (S.sort.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
  }
  /** @description The desktop table. @param {object[]} rows The rows the filters show. @returns {string} */
  function tableMarkup(rows) {
    return `<div class="jt-scroll"><table class="jt-table"><caption class="jt-sr">${esc(S.deps.title || 'Jobs')}, ${rows.length} shown</caption><thead><tr><th scope="col" class="jt-check"><label class="jt-pick"><input type="checkbox" id="jtAll" aria-label="Select all ${rows.length} jobs these filters show"></label></th>`
      + `${COLUMNS.map(headCell).join('')}<th scope="col" class="jt-col-open"><span class="jt-sr">Open</span></th></tr></thead><tbody>${rows.map(rowMarkup).join('')}</tbody></table></div>`;
  }
  /** @description One card of the phone list: the same facts and the same checkbox. */
  function cardMarkup(job) {
    const on = S.selected.has(job.id), place = placeOf(job), match = matchOf(job), resume = resumeShown(job);
    const facts = [place.word, match != null ? 'Match ' + match : unread(job) ? 'Details needed' : '', 'Saved ' + savedWords(job)].filter(Boolean).map(esc).join(' · ');
    return `<li class="jt-card" data-id="${job.id}" data-selected="${on}"><label class="jt-pick"><input type="checkbox" data-select="${job.id}" aria-label="${checkLabel(job)}"${on ? ' checked' : ''}></label>`
      + `<div class="jt-card-body"><p class="jt-co">${esc(job.company)}</p><button type="button" class="jt-title" data-posting="${job.id}">${esc(job.title)}</button><p class="jt-meta">${facts}</p>`
      + `<p class="jt-chips"><span class="jt-chip" data-stage-cell>${esc(stageNote(job) || stageOf(job))}</span><span class="jt-chip" data-resume="${esc(resume.kind)}" data-resume-cell>${resumeCell(job)}</span></p></div>${openButton(job)}</li>`;
  }
  /** @description The phone list: Select all, a sort, and the cards. */
  function cardsMarkup(rows) {
    const options = COLUMNS.map(([key, label]) => `<option value="${key}"${S.sort.key === key ? ' selected' : ''}>${esc(label === 'Location' ? 'Distance' : label)}</option>`).join('');
    return `<div class="jt-phone-tools"><label class="jt-allrow"><input type="checkbox" id="jtAll" aria-label="Select all ${rows.length} jobs these filters show"><span>Select all ${rows.length}</span></label>`
      + `<label class="jt-sortrow"><span>Sort</span><select id="jtSort">${options}</select></label></div><ul class="jt-list" aria-label="Jobs">${rows.map(cardMarkup).join('')}</ul>`;
  }
  /** @description What the table says when it has nothing to show. */
  function emptyMarkup() {
    if (S.rows.length) return '<div class="ck-empty"><h2>No jobs match these filters</h2><p>Change or clear them to see this stage.</p><button type="button" class="ck-btn" data-table-clear>Clear filters</button></div>';
    return '<div class="ck-empty"><div class="ck-empty-icon" aria-hidden="true">🗂️</div><h2>Nothing here yet</h2><p>Jobs you save appear here.</p></div>';
  }
  /** @description Draw the whole table (or the phone list) from the loaded rows. @returns {void} */
  function renderTable() {
    const host = $('jobsTable');
    if (!host || S.layout !== 'table') return;
    if (S.error) { host.innerHTML = `<div class="ck-alert" role="alert"><h2>Could not load these jobs</h2><p>${esc(S.error)}</p><button type="button" class="ck-btn" data-table-retry>Retry</button></div>`; return; }
    if (S.loading && !S.rows.length) { host.innerHTML = '<p class="hint" role="status">Loading jobs…</p>'; return; }
    const rows = visible();
    host.innerHTML = filtersMarkup() + (rows.length ? (phone.matches ? cardsMarkup(rows) : tableMarkup(rows)) : emptyMarkup());
    syncChecks();
  }
  /** @description Bring every Résumé and Stage cell up to date with the queue, without redrawing the rows. */
  function refreshCells() {
    const host = $('jobsTable');
    if (!host || S.layout !== 'table') return;
    for (const job of S.rows) {
      const row = host.querySelector(`[data-id="${job.id}"]`);
      if (!row) continue;
      const cell = row.querySelector('[data-resume-cell]'), stage = row.querySelector('[data-stage-cell]'), resume = resumeShown(job);
      const said = resume.kind + '|' + resume.word + '|' + resume.reason;
      if (cell && cell.dataset.said !== said) { cell.dataset.said = said; cell.dataset.resume = resume.kind; cell.innerHTML = resumeCell(job); }
      const where = stageNote(job) || stageOf(job);
      if (stage && stage.textContent !== where) stage.textContent = where;
    }
  }

  /** @description The chosen rows the filters still show, in the order the person sees them; a hidden row is never acted on. @returns {object[]} */
  function selectedRows() { return visible().filter((job) => S.selected.has(job.id)); }
  /** @description Drop from the selection what the filters no longer show, so "select all" always means what is on screen. */
  function prune() { const shown = new Set(visible().map((job) => job.id)); for (const id of [...S.selected]) if (!shown.has(id)) S.selected.delete(id); }
  /** @description Bring every checkbox, the select-all box, the count and the bar in line with the selection. @returns {void} */
  function syncChecks() {
    const host = S.layout === 'table' ? $('jobsTable') : $('list');
    if (!host) return;
    const rows = visible(), chosen = rows.filter((job) => S.selected.has(job.id)).length;
    for (const box of host.querySelectorAll('[data-select]')) {
      const on = S.selected.has(Number(box.dataset.select));
      box.checked = on;
      const row = box.closest('[data-id]');
      if (row) row.dataset.selected = String(on);
    }
    const all = $('jtAll');
    if (all) { all.checked = rows.length > 0 && chosen === rows.length; all.indeterminate = chosen > 0 && chosen < rows.length; }
    const count = $('jtCount');
    if (count) count.textContent = (rows.length === S.rows.length ? rows.length + (rows.length === 1 ? ' job' : ' jobs') : rows.length + ' of ' + S.rows.length + ' jobs') + (chosen ? ' · ' + chosen + ' selected' : '');
    renderBar();
  }
  /**
   * @description Choose or unchoose one row; with Shift, every row between it and the last one pressed, as Gmail does.
   * @param {number} id The job. @param {boolean} on Chosen or not. @param {boolean} range Whether Shift was held.
   * @returns {void}
   */
  function choose(id, on, range) {
    const order = visible().map((job) => job.id), from = order.indexOf(S.anchor), to = order.indexOf(id);
    if (range && from >= 0 && to >= 0) for (const each of order.slice(Math.min(from, to), Math.max(from, to) + 1)) { if (on) S.selected.add(each); else S.selected.delete(each); }
    else if (on) S.selected.add(id); else S.selected.delete(id);
    S.anchor = id;
    if (S.selected.size && S.deps.say) S.deps.say('');
    syncChecks();
  }
  /** @description Choose every row the filters show, or none of them. @param {boolean} on @returns {void} */
  function chooseAll(on) {
    for (const job of visible()) { if (on) S.selected.add(job.id); else S.selected.delete(job.id); }
    if (S.selected.size && S.deps.say) S.deps.say('');
    syncChecks();
  }

  /** @description The bar under a selection: how many are chosen, Clear, and the stage's bulk actions. @returns {void} */
  function renderBar() {
    const bar = $('bulkBar');
    if (!bar) return;
    const chosen = S.deps && (S.layout === 'table' || picks()) ? selectedRows() : [];
    bar.hidden = !chosen.length;
    root.document.documentElement.toggleAttribute('data-bulk-bar', !bar.hidden);
    if (bar.hidden) { bar.innerHTML = ''; return; }
    const plan = STAGE_ACTIONS[S.deps.stage], list = S.layout !== 'table';
    const again = chosen.filter((job) => !leftOut('regenerate', job)).length;
    const names = plan.buttons.filter((name) => (name !== 'send' || S.computer === true) && (name !== 'fill' || S.fill === true) && (name !== 'regenerate' || (again > 0 && Boolean(root.CareerRegenerate))) && (!list || name === 'fill' || name === 'regenerate'));
    const label = (name) => (name === 'regenerate' ? `${LABELS.regenerate} (${again})` : LABELS[name]);
    const buttons = names.map((name, index) => `<button type="button" class="${index === 0 ? 'ck-primary' : 'ck-btn'}" data-bulk="${name}">${esc(label(name))}</button>`).join('');
    const moves = plan.moves.length && !list ? `<select class="jt-move" data-bulk-move aria-label="Move the selected jobs to"><option value="">Move to…</option>${plan.moves.map((name) => `<option value="${name}">${esc(MOVES[name].label)}</option>`).join('')}</select>` : '';
    bar.innerHTML = `<button type="button" class="ck-icon" data-bulk="clear" aria-label="Clear the selection">✕</button><span class="jt-selected" role="status">${chosen.length} selected</span><div class="jt-actions">${buttons}${moves}</div>`;
  }

  /** @description Whether the queue already holds this work for the job. */
  function pending(id, kind) { const item = S.queue && S.queue.latest(id); return Boolean(item && item.kind === kind && ['queued', 'running'].includes(item.state)); }
  /**
   * @description Why one chosen job is left out of an action, in a few words; '' when the action applies to it.
   * @param {string} name The action. @param {object} job The job.
   * @returns {string}
   */
  function leftOut(name, job) {
    const applied = DONE.has(job.status);
    if (name === 'prepare') return applied ? 'already applied' : job.has_resume ? 'already prepared' : unread(job) ? 'needs the job description pasted' : resumeOf(job).kind === 'running' || pending(job.id, 'prepare') ? 'already being prepared' : '';
    if (name === 'remove') return applied ? 'applied jobs stay in Applications' : job.status === 'dismissed' ? 'already removed' : '';
    if (name === 'putback') return job.status === 'dismissed' ? '' : 'not removed';
    if (name === 'fill') return applied ? 'already applied' : '';
    if (name === 'regenerate') return applied ? 'already applied' : job.status === 'dismissed' ? 'removed' : !job.has_resume ? 'no documents yet' : '';
    if (name === 'send') return applied ? 'already applied' : !(job.has_resume && job.has_cover) ? 'no résumé and cover letter yet' : pending(job.id, 'send') ? 'already being sent' : '';
    if (name === 'queue') return applied ? 'already applied' : READY.has(job.status) ? 'already in Getting ready' : '';
    if (MOVES[name]) return !applied ? 'not applied yet' : job.status === MOVES[name].body.status ? 'already there' : '';
    return 'not available here';
  }
  /** @description "3 left out: 2 already prepared, 1 already applied." for the jobs an action did not take (most first). */
  function leftWords(left) {
    if (!left.length) return '';
    const counts = new Map();
    for (const { why } of left) counts.set(why, (counts.get(why) || 0) + 1);
    const ordered = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return ` ${left.length} left out: ${ordered.map(([why, n]) => n + ' ' + why).join(', ')}.`;
  }
  /** @description One queue entry for a job: its own preparation, or the status write its own row or page sends. */
  function entry(name, job) {
    const base = { id: job.id, title: job.title, company: job.company };
    if (name === 'prepare') return { ...base, kind: 'prepare', label: 'Prepare' };
    if (name === 'remove') return { ...base, kind: 'status', body: { status: 'dismissed', favorite: false }, label: 'Remove', done: 'Removed' };
    if (name === 'putback') return { ...base, kind: 'status', body: { favorite: true }, label: 'Put back in Saved', done: 'Put back in Saved' };
    return { ...base, kind: 'status', body: MOVES[name].body, label: 'Move to ' + MOVES[name].label, done: MOVES[name].done };
  }
  /** @description What the page says once work is queued. */
  function startedWords(name, added) {
    if (name === 'prepare') return `${added} ${added === 1 ? 'application' : 'applications'} queued. Career prepares them one or two at a time while My jobs is open.`;
    const what = name === 'remove' ? 'Removing' : name === 'putback' ? 'Putting back' : 'Moving';
    return `${what} ${added} ${added === 1 ? 'job' : 'jobs'}.`;
  }
  /**
   * @description Run one bulk action on the chosen rows the filters show. Jobs it does not apply to are left out and named.
   * Send asks first (confirmSend); everything else is queued at once.
   * @param {string} name prepare, remove, putback, send, or a move (queue, interview, offer, rejected).
   * @returns {void}
   */
  function act(name) {
    const chosen = selectedRows(), take = [], left = [];
    if (name === 'fill') { void fillChosen(chosen); return; }
    if (name === 'regenerate') { void regenerateChosen(chosen); return; }
    for (const job of chosen) { const why = leftOut(name, job); if (why) left.push({ job, why }); else take.push(job); }
    if (!take.length) { S.deps.say(`None of the ${chosen.length} selected can do that.` + leftWords(left)); return; }
    if (name === 'send') { void confirmSend(take, left); return; }
    if (name === 'prepare') { void confirmPrepare(take, left); return; }
    const result = S.queue.add(take.map((job) => entry(name, job)));
    S.selected.clear();
    syncChecks(); renderProgress(); refreshCells();
    S.deps.say(startedWords(name, result.added) + leftWords(left) + (result.already ? ` ${result.already} already queued.` : ''));
    void S.queue.tick();
  }

  /** @description The person's Other experience (no facts): entries, revision and the choice they prepared their last application with. */
  /**
   * @description Fill in several on my Chrome: the batch's own sheet reads each job's exact packet, asks once and queues
   * each approval; jobs still needing documents can be prepared from it with this table's Prepare applications.
   * @param {object[]} chosen The selected rows. @returns {Promise<void>}
   */
  async function fillChosen(chosen) {
    const prepare = (jobs) => {
      const take = [], left = [];
      for (const job of jobs) { const why = leftOut('prepare', job); if (why) left.push({ job, why }); else take.push(job); }
      if (take.length) void confirmPrepare(take, left); else S.deps.say('None of them can be prepared now.' + leftWords(left));
    };
    try {
      const queue = await root.CareerApplyBatch.confirm(chosen, { say: S.deps.say, availability: S.availability, prepare });
      if (queue) { S.selected.clear(); syncChecks(); }
    } catch (error) { S.deps.say(error.message); }
  }
  /**
   * @description Generate again for the chosen jobs that have documents: tools/career-regenerate.js asks once and queues them.
   * @param {object[]} chosen The selected rows. @returns {Promise<void>}
   */
  async function regenerateChosen(chosen) {
    const take = [], left = [];
    for (const job of chosen) { const why = leftOut('regenerate', job); if (why) left.push({ job, why }); else take.push(job); }
    try {
      const queue = await root.CareerRegenerate.confirm(take.map((job) => ({ id: job.id, company: job.company, title: job.title })), { say: S.deps.say, left: leftWords(left) });
      if (queue) { S.selected.clear(); syncChecks(); }
    } catch (error) { S.deps.say(error.message); }
  }
  /** @description Whether the List draws a checkbox on each row: a bulk action of the List is offered on this stage. @returns {boolean} */
  function picks() { return Boolean(S.deps && (S.fill === true || Boolean(root.CareerRegenerate)) && LIST_PICKS.has(S.deps.stage) && S.layout !== 'table'); }
  /** @description Whether a job is selected, for the List's own row checkbox. @param {number} id @returns {boolean} */
  function isSelected(id) { return S.selected.has(id); }
  async function readExperience() {
    const response = await root.fetch(API + '/experience-bank?summary=1', { cache: 'no-store' }), data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'HTTP ' + response.status);
    return { entries: (data.entries || []).filter((one) => one && !one.archived), last: (data.last && data.last.experienceIds) || null };
  }
  /** @description "Each includes Agentic Federal." for the line after queueing; '' for a person with no other experience. */
  function choiceWords(ids, entries) {
    if (!entries.length) return '';
    const names = entries.filter((one) => ids.includes(one.id)).map((one) => one.title);
    return names.length ? ` Each includes ${names.join(', ')}.` : ' None includes your other experience.';
  }
  /**
   * @description Bulk Prepare asks first: one step with the person's Other experience, "Include in every selected application",
   * the count and what is left out. Only Prepare queues anything, and each preparation carries exactly the ticked entries.
   * @param {object[]} take The jobs to prepare. @param {Array<{job:object, why:string}>} left The others and why.
   * @returns {Promise<void>}
   */
  async function confirmPrepare(take, left) {
    let bank;
    try { bank = await readExperience(); }
    catch (error) { S.deps.say(`Your other experience could not be read (${String(error.message || error).replace(/\.$/, '')}), so nothing was queued. Try again.`); return; }
    const ids = await prepareDialog({ take, left, bank });
    if (!ids) { S.deps.say('Nothing was queued.'); return; }
    const result = S.queue.add(take.map((job) => ({ ...entry('prepare', job), experienceIds: ids })));
    S.selected.clear();
    syncChecks(); renderProgress(); refreshCells();
    S.deps.say(startedWords('prepare', result.added) + choiceWords(ids, bank.entries) + leftWords(left) + (result.already ? ` ${result.already} already queued.` : ''));
    void S.queue.tick();
  }
  /** @description One Other experience box in the bulk step, labelled as on the application page (title, then organization). */
  function choiceBox(group, one, ticked) {
    const label = make('label', null, group, 'jt-choice'), box = make('input', null, label), words = make('span', one.title, label);
    box.type = 'checkbox'; box.name = 'jtExperience'; box.value = one.id; box.checked = ticked;
    if (one.organization && one.organization !== one.title) make('small', one.organization, words);
  }
  /**
   * @description The one step before bulk Prepare queues anything. Resolves with the ticked entry ids when the person presses
   * Prepare, or null when they cancel (Cancel, Escape, Back).
   * @param {{take:object[], left:Array<{job:object, why:string}>, bank:{entries:object[], last:string[]|null}}} plan
   * @returns {Promise<string[]|null>}
   */
  function prepareDialog(plan) {
    return new Promise((resolve) => {
      const n = plan.take.length, count = `${n} ${n === 1 ? 'application' : 'applications'}`, last = new Set(plan.bank.last || []);
      const dialog = make('dialog', null, root.document.body, 'ck-sheet jt-prepare');
      dialog.setAttribute('data-ds-sheet', ''); dialog.setAttribute('data-no-glass', ''); dialog.setAttribute('aria-labelledby', 'jtPrepareTitle');
      const head = make('header', null, dialog), body = make('div', null, dialog, 'ck-sheet-body'), foot = make('footer', null, dialog);
      make('h2', `Prepare ${count}`, head).id = 'jtPrepareTitle';
      make('p', 'Career writes the résumé and cover letter for each one from your main résumé, one or two at a time while My jobs is open.', body);
      const group = make('fieldset', null, body, 'jt-experience');
      make('legend', 'Other experience · optional', group);
      if (plan.bank.entries.length) {
        make('p', 'Include in every selected application', group, 'jt-include');
        for (const one of plan.bank.entries) choiceBox(group, one, last.has(one.id));
        if (plan.bank.entries.some((one) => last.has(one.id))) make('p', 'Ticked as in the last application you prepared.', group, 'hint');
      } else make('p', 'You have no other experience saved yet, so each application uses your main résumé alone.', group, 'hint');
      if (plan.left.length) make('p', leftWords(plan.left).trim(), body, 'hint');
      let done = false;
      const finish = (value) => { if (done) return; done = true; if (dialog.open) dialog.close(); dialog.remove(); resolve(value); };
      const cancel = make('button', 'Cancel', foot, 'ck-tertiary'), go = make('button', `Prepare ${count}`, foot, 'ck-primary');
      cancel.type = 'button'; go.type = 'button';
      cancel.onclick = () => finish(null);
      go.onclick = () => finish([...dialog.querySelectorAll('input[name="jtExperience"]:checked')].map((box) => box.value));
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
      dialog.showModal();
    });
  }

  /** @description One element with text, for dialogs drawn without markup strings. */
  function make(tag, text, parent, className) { const el = root.document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; if (parent) parent.append(el); return el; }
  /**
   * @description The one question before anything is sent: the count, each company and job, what is left out, and an approval
   * box the person ticks. Send stays off until it is ticked and refuses if it is not; Cancel, Escape and Back send nothing.
   * @param {{computer:boolean, ready:Array<{job:object, packet:object}>, notReady:Array<{job:object, error:string}>, left:Array<{job:object, why:string}>}} plan
   * @returns {Promise<boolean>} True only when the person ticked the approval and pressed Send.
   */
  function sendDialog(plan) {
    return new Promise((resolve) => {
      const dialog = make('dialog', null, root.document.body, 'ck-sheet jt-send'), n = plan.ready.length;
      dialog.setAttribute('data-ds-sheet', ''); dialog.setAttribute('data-no-glass', ''); dialog.setAttribute('aria-labelledby', 'jtSendTitle');
      const head = make('header', null, dialog), body = make('div', null, dialog, 'ck-sheet-body'), foot = make('footer', null, dialog);
      const title = make('h2', !plan.computer ? 'No computer is connected' : n ? `Send ${n} ${n === 1 ? 'application' : 'applications'} from your computer?` : 'None of these can be sent now', head);
      title.id = 'jtSendTitle';
      let done = false;
      const finish = (value) => { if (done) return; done = true; if (dialog.open) dialog.close(); dialog.remove(); resolve(value); };
      if (!plan.computer) make('p', 'Career sends applications from your own connected computer, and none is connected now, so nothing was sent. Open each application to apply on the employer’s form.', body);
      else sendBody(body, plan);
      const cancel = make('button', n && plan.computer ? 'Cancel' : 'Close', foot, 'ck-tertiary');
      cancel.type = 'button'; cancel.onclick = () => finish(false);
      if (n && plan.computer) sendButton(foot, body, n, () => finish(true));
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
      dialog.showModal();
    });
  }
  /** @description The list of applications to send, what is left out, and the approval box. */
  function sendBody(body, plan) {
    if (plan.ready.length) {
      const via = plan.deviceName ? plan.deviceName : 'your connected computer';
      make('p', `Career sends each one, with the résumé and cover letter you prepared, to the employer’s own form from ${via}. It stops at anything it does not recognise and asks you.`, body);
      const list = make('ul', null, body, 'jt-send-list');
      for (const { job, packet } of plan.ready) { const line = make('li', null, list); make('b', packet.company || job.company, line); line.append(' · ' + (packet.title || job.title)); }
    }
    const out = [...plan.notReady.map(({ job, error }) => `${job.company} (${error})`), ...plan.left.map(({ job, why }) => `${job.company} (${why})`)];
    if (out.length) make('p', `Not sent: ${out.join('; ')}.`, body, 'hint');
    if (!plan.ready.length) return;
    const approve = make('label', null, body, 'jt-approve'), box = make('input', null, approve);
    box.type = 'checkbox'; box.id = 'jtApprove';
    approve.append(` I checked these ${plan.ready.length} ${plan.ready.length === 1 ? 'application' : 'applications'} and approve sending ${plan.ready.length === 1 ? 'it' : 'them'}.`);
  }
  /** @description Send: off until the approval is ticked, and it checks the box itself when pressed. */
  function sendButton(foot, body, n, approved) {
    const send = make('button', `Send ${n} ${n === 1 ? 'application' : 'applications'}`, foot, 'ck-primary'), box = body.querySelector('#jtApprove');
    const said = make('p', '', body, 'jt-refused'); said.setAttribute('role', 'status');
    send.type = 'button'; send.disabled = true;
    box.addEventListener('change', () => { send.disabled = !box.checked; said.textContent = ''; });
    send.onclick = () => { if (!box.checked) { said.textContent = 'Tick the approval first. Nothing was sent.'; return; } approved(); };
  }
  /**
   * @description Bulk Send: check for a connected computer, read each job's exact packet (what the employer would get), ask once,
   * and only then queue each send (CareerSubmit.approveAndStart, the three writes one job's send makes).
   * @param {object[]} take Jobs with a résumé and cover letter. @param {Array<{job:object, why:string}>} left The others and why.
   * @returns {Promise<void>}
   */
  async function confirmSend(take, left) {
    const computer = await root.CareerSubmit.workers().catch(() => ({ available: false }));
    let read = [];
    if (computer.available) {
      S.deps.say(`Reading the exact documents for ${take.length} ${take.length === 1 ? 'application' : 'applications'}…`);
      read = await Promise.all(take.map(async (job) => {
        try { const packet = await root.CareerSubmit.request('/submission-review/' + encodeURIComponent(job.id)); return packet && packet.packetDigest ? { job, packet } : { job, error: 'its documents could not be read' }; }
        catch (error) { return { job, error: String(error.message || 'not ready').replace(/\.$/, '') }; }
      }));
      S.deps.say('');
    }
    const ready = read.filter((one) => one.packet), notReady = read.filter((one) => !one.packet);
    if (!await sendDialog({ computer: computer.available === true, deviceName: computer.selectedDeviceName || '', ready, notReady, left })) { S.deps.say('Nothing was sent.'); return; }
    const result = S.queue.add(ready.map(({ job, packet }) => ({ id: job.id, title: job.title, company: packet.company || job.company, kind: 'send', digest: packet.packetDigest, label: 'Send', done: 'Approved' })));
    S.selected.clear();
    syncChecks(); renderProgress(); refreshCells();
    S.deps.say(`Sending ${result.added} ${result.added === 1 ? 'application' : 'applications'} from your computer, one after another.`);
    void S.queue.tick();
  }

  /** @description "3 prepared · 1 preparing · 7 queued · 1 failed" for one kind of work. */
  function countWords(sum, doneWord, runningWord) {
    const parts = [[sum.done, doneWord], [sum.running, runningWord], [sum.queued, 'queued'], [sum.failed, 'failed'], [sum.skipped, 'skipped'], [sum.cancelled, 'cancelled']];
    return parts.filter(([n]) => n > 0).map(([n, word]) => n + ' ' + word).join(' · ');
  }
  /** @description The overall line: the preparations, the other changes, a pause or a wait, and what the person can do. */
  function progressMarkup(items, sum) {
    const p = sum.prepare, other = items.filter((item) => item.kind !== 'prepare'), lines = [];
    if (p.total) lines.push(`<p class="jt-progress-line"><b>Prepare applications</b> <span>${esc(countWords(p, 'prepared', 'preparing'))}</span></p><progress max="${Math.max(1, p.total - p.cancelled)}" value="${p.done + p.failed + p.skipped}" aria-label="Applications prepared"></progress>`);
    if (other.length) {
      const o = { done: 0, running: 0, queued: 0, failed: 0, skipped: 0, cancelled: 0 };
      for (const item of other) o[item.state] += 1;
      lines.push(`<p class="jt-progress-line"><b>Other changes</b> <span>${esc(countWords(o, 'done', 'in progress'))}</span></p>`);
    }
    // While one of these is preparing, that is what the others wait for; otherwise Career is busy with something else.
    if (sum.paused) lines.push(`<p class="jt-paused" role="alert">Paused: ${esc(sum.paused.reason)}</p>`);
    else if (p.running || (p.queued && !sum.waiting)) lines.push('<p class="hint">Career prepares them one or two at a time while My jobs is open.</p>');
    else if (sum.waiting && sum.queued) lines.push('<p class="hint">Waiting for Career to finish what it is doing on your account.</p>');
    const failed = items.filter((item) => item.state === 'failed'), retry = failed.some((item) => item.kind === 'prepare');
    const buttons = [sum.queued ? `<button type="button" class="ck-btn" data-progress="cancel">Cancel ${sum.queued} queued</button>` : '',
      sum.paused ? '<button type="button" class="ck-btn" data-progress="resume">Resume</button>' : '',
      retry ? '<button type="button" class="ck-btn" data-progress="retry">Prepare the failed ones again</button>' : '',
      items.some((item) => ['done', 'failed', 'skipped', 'cancelled'].includes(item.state)) ? '<button type="button" class="ck-tertiary" data-progress="clear">Clear finished</button>' : ''].join('');
    const why = failed.length ? `<details class="jt-failures"><summary>${failed.length} did not finish</summary><ul>${failed.map((item) => `<li><b>${esc(item.company)}</b> · ${esc(item.title)}: ${esc(item.reason)}</li>`).join('')}</ul></details>` : '';
    return lines.join('') + (buttons ? `<div class="jt-progress-actions">${buttons}</div>` : '') + why;
  }
  /** @description Draw the overall progress, or hide it when the queue is empty. @returns {void} */
  function renderProgress() {
    const box = $('bulkProgress');
    if (!box || !S.queue) return;
    const items = S.queue.items();
    box.hidden = !items.length;
    box.innerHTML = items.length ? progressMarkup(items, S.queue.summary()) : '';
  }
  /** @description A press in the progress panel: cancel what is queued, resume, prepare the failed ones again, or clear. */
  function progressAction(name) {
    if (name === 'cancel') { const n = S.queue.cancelQueued(); S.deps.say(`${n} ${n === 1 ? 'job was' : 'jobs were'} cancelled before ${n === 1 ? 'it' : 'they'} started.`); }
    else if (name === 'resume') { S.queue.resume(); S.deps.say('Preparing again.'); }
    else if (name === 'retry') { const n = S.queue.retryFailed(); S.deps.say(`${n} queued again.`); }
    else if (name === 'clear') S.queue.clearFinished();
    renderProgress(); refreshCells();
    void S.queue.tick();
  }

  /** @description Every job of this stage the page's own filters allow, read a page of 300 at a time (2,000 at most). */
  async function fetchAll(epoch) {
    const params = new URLSearchParams(S.deps.filters());
    // The Table filters and sorts in the page, so it reads the whole stage: no page, sort or distance of the List's own.
    for (const key of ['page', 'per', 'sort', 'view', 'earlier', 'within']) params.delete(key);
    params.set('status', S.deps.feed);
    if (S.deps.current) params.set('current', '1');
    params.set('per', String(PER));
    const rows = new Map();
    for (let page = 1; rows.size < MOST; page += 1) {
      params.set('page', String(page));
      const response = await root.fetch(API + '/jobs?' + params, { cache: 'no-store' }), data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'HTTP ' + response.status);
      if (epoch !== S.epoch) return null;
      if (data.home && typeof data.home === 'object') S.home = data.home;
      for (const job of data.jobs || []) if (!rows.has(job.id)) rows.set(job.id, job);
      if (data.exhausted === true || (data.jobs || []).length < PER) break;
    }
    return [...rows.values()];
  }
  /** @description Load the stage into the table; a newer load wins. @returns {Promise<void>} */
  async function load() {
    if (S.layout !== 'table') return;
    const epoch = ++S.epoch;
    S.loading = true; S.error = '';
    if (!S.rows.length) renderTable();
    try {
      const rows = await fetchAll(epoch);
      if (rows === null || epoch !== S.epoch) return;
      S.rows = rows; prune();
    } catch (error) { if (epoch === S.epoch) S.error = String(error.message || error); }
    finally { if (epoch === S.epoch) { S.loading = false; renderTable(); } }
  }
  const FIRST_DIR = { company: 1, title: 1, location: 1, match: -1, stage: 1, saved: -1, resume: 1 };
  /** @description Sort by a column: a second press turns it round; nearest first, best match first, newest saved first. */
  function sortBy(key, turn) {
    if (!FIRST_DIR[key]) return;
    S.sort = turn && S.sort.key === key ? { key, dir: -S.sort.dir } : { key, dir: FIRST_DIR[key] };
    renderTable();
    const again = $('jobsTable') && $('jobsTable').querySelector(turn ? `[data-sort="${key}"]` : '#jtSort');
    if (again) again.focus();
  }
  /** @description Show the List or the Table, remember it for this person, and load what it shows. */
  function setLayout(layout, first) {
    const table = layout === 'table' && Boolean(STAGE_ACTIONS[S.deps.stage]);
    S.layout = table ? 'table' : 'list';
    if (!first) keep(viewKey(), S.layout);
    root.document.documentElement.dataset.jobsLayout = S.layout;
    for (const button of root.document.querySelectorAll('[data-jobs-view]')) button.setAttribute('aria-selected', String(button.dataset.jobsView === S.layout));
    const host = $('jobsTable');
    if (host) { host.hidden = !table; if (!table) host.innerHTML = ''; }
    S.selected.clear(); renderBar();
    if (first) return;
    if (table) void load(); else S.deps.reload();
  }
  /** @description Clicks the table owns: the switch, sorting, the bar, the progress panel, Open, and a tap on a phone card. */
  function onClick(event) {
    const at = (selector) => event.target.closest && event.target.closest(selector);
    const view = at('[data-jobs-view]'), bulk = at('[data-bulk]'), sort = at('[data-sort]'), open = at('[data-table-open]'), progress = at('[data-progress]');
    if (view) { if (view.dataset.jobsView !== S.layout) setLayout(view.dataset.jobsView); return; }
    if (bulk) { if (bulk.dataset.bulk === 'clear') { S.selected.clear(); syncChecks(); } else act(bulk.dataset.bulk); return; }
    if (sort) { sortBy(sort.dataset.sort, true); return; }
    if (open) { void Promise.resolve(root.CareerJobActions.openApplication(Number(open.dataset.tableOpen), open.dataset.done === 'true')).catch((error) => S.deps.say(error.message)); return; }
    if (progress) { progressAction(progress.dataset.progress); return; }
    if (at('[data-table-clear]')) { S.filter = { within: '', resume: '', stage: '' }; prune(); renderTable(); return; }
    if (at('[data-table-retry]')) { void load(); return; }
    const card = at('.jt-card');
    if (card && !at('button, a, input, label, select')) { const id = Number(card.dataset.id); choose(id, !S.selected.has(id), false); }
  }
  /** @description Changes the table owns: a row's checkbox, select all, the filters, the phone sort and Move to. */
  function onChange(event) {
    const target = event.target, filter = { jtWithin: 'within', jtResume: 'resume', jtStage: 'stage' }[target.id];
    if (target.matches('[data-select]')) { choose(Number(target.dataset.select), target.checked, S.shift === true); S.shift = false; return; }
    if (target.id === 'jtAll') { chooseAll(target.checked); return; }
    if (target.matches('[data-bulk-move]')) { const name = target.value; target.value = ''; if (name) act(name); return; }
    if (filter) { S.filter[filter] = target.value; prune(); renderTable(); const again = $(target.id); if (again) again.focus(); return; }
    if (target.id === 'jtSort') sortBy(target.value, false);
  }
  /** @description The queue changed: redraw progress and the rows; when a job's work ended, read the stage again. */
  function queueChanged() {
    renderProgress();
    sayWhenDone();
    if (S.layout === 'table') refreshCells(); else if (S.deps.redraw) S.deps.redraw();
    let ended = false;
    for (const item of S.queue.items()) if (['done', 'failed', 'skipped'].includes(item.state) && !S.ended.has(item.key)) { S.ended.add(item.key); ended = true; }
    if (!ended) return;
    clearTimeout(S.reloadTimer);
    S.reloadTimer = setTimeout(() => { if (S.deps.refresh) S.deps.refresh(); }, 1200);
  }
  /** @description When the last queued preparation ends, say how it went in the page's one status line. */
  function sayWhenDone() {
    const p = S.queue.summary().prepare, busy = p.queued + p.running > 0;
    if (S.busy && !busy && p.done + p.failed > 0) S.deps.say(`Prepare applications: ${p.done} prepared${p.failed ? `, ${p.failed} did not finish (the reasons are above)` : ''}.`);
    S.busy = busy;
  }
  /** @description Whether a computer is connected to send from; Send is offered only then, as on one application's page. */
  async function readComputer() {
    const before = S.fill;
    try {
      S.availability = await root.CareerSubmit.workers();
      S.computer = S.availability.available === true;
      S.fill = Boolean(root.CareerApplyBatch && root.CareerApplyBatch.device(S.availability).ready);
    } catch (_) { S.computer = false; S.fill = false; }
    renderBar();
    // The List draws its checkboxes only while Fill in several on my Chrome is offered.
    if (S.fill !== before && S.layout !== 'table' && S.deps.redraw) S.deps.redraw();
  }
  function localStore() { try { return root.localStorage; } catch (_) { return null; } }
  let wired = false;
  /**
   * @description Join My jobs: start the person's queue, offer the Table on the stages that have one, and show the view the
   * person last chose. The page passes what the table needs from it.
   * @param {{stage:string, feed:string, current:boolean, title:string, owner:string, filters:()=>object, say:(text:string)=>void,
   *   reload:()=>void, refresh:()=>void, redraw:()=>void}} deps
   * @returns {void}
   */
  function attach(deps) {
    S.deps = deps;
    S.queue = root.CareerBulkQueue.create({ owner: deps.owner || '', storage: localStore(), fetch: (url, init) => root.fetch(url, init),
      actions: root.CareerJobActions, send: (id, digest) => root.CareerSubmit.approveAndStart(id, digest), onChange: queueChanged });
    for (const item of S.queue.items()) if (['done', 'failed', 'skipped', 'cancelled'].includes(item.state)) S.ended.add(item.key);
    const begun = S.queue.summary().prepare;
    S.busy = begun.queued + begun.running > 0;
    S.queue.start(1500);
    const switcher = $('jobsViewSwitch');
    if (switcher) switcher.hidden = !STAGE_ACTIONS[deps.stage];
    if (!wired) {
      wired = true;
      root.document.addEventListener('click', (event) => { if (event.target.matches && event.target.matches('[data-select]')) S.shift = event.shiftKey; }, true);
      root.document.addEventListener('click', onClick);
      root.document.addEventListener('change', onChange);
      if (phone.addEventListener) phone.addEventListener('change', () => renderTable());
    }
    setLayout(recall(viewKey()) === 'table' ? 'table' : 'list', true);
    if (deps.stage === 'queue' || LIST_PICKS.has(deps.stage)) void readComputer();
    renderProgress();
  }
  /**
   * @description The words a List row shows for a job while the queue holds work for it, or ''.
   * @param {number} id The job. @returns {string}
   */
  function words(id) {
    const item = S.queue && S.queue.latest(id);
    if (!item || !['queued', 'running', 'failed'].includes(item.state)) return '';
    const said = root.CareerBulkQueue.words(item);
    if (item.kind === 'prepare') return item.state === 'queued' ? 'Queued to prepare' : item.state === 'running' ? 'Preparing…' : 'Preparation failed: ' + said.reason;
    return item.state === 'queued' ? 'Queued: ' + (item.label || said.word) : said.word + (said.reason ? ': ' + said.reason : '');
  }

  root.CareerJobsTable = { attach, load, words, picks, isSelected, active: () => S.layout === 'table', queue: () => S.queue };
})(window);
