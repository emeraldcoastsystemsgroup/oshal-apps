/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.69.0 (career-hunter backlog, "The Discover swipe deck as the Job Board's phone layout"): the phone layout of the Job Board's New matches stage is this deck, in a file of its own. One job at a time (employer, title, place, pay when the posting states it, fit), Pass and Save by swipe or by button, Undo and More. Every write goes to the route the board's own buttons use (POST /jobs/:id/status): Save is the board's Save (favorite true), Pass is the board's Remove (status dismissed). What changed from the deck the page carried: (a) Undo is real. It reads the job first (GET /jobs/:id) and reverses only what the last action left: a passed job goes back to new (status new), a saved one is unsaved (favorite false); a job that has moved on since is left alone and the person is told where it is. Before, Undo of Pass only put the card back while the job stayed removed, and a failed unsave still said Restored. (b) More opens the job's details; it used to load another page or open the posting depending on how many jobs were left. (c) The deck re-reads the first page when it runs low. It asked for page 2, which skips as many matches as the person had just saved or passed. (d) The end of the deck says how many were saved and passed, with Open Saved and Find jobs, and Undo stays; it used to say "No matches yet". A list that could not be read says so with Try again. (e) Pay is shown only when the posting states it. (f) The four buttons are drawn once, so a press by keyboard keeps its focus; the card under the lead one cannot be tabbed to; a refusal while Career is working is said in plain words; a card is not redrawn while it is held. Kept as it was: a Save comes back by itself only on Career's own busy refusal, an unknown result leaves the card away (Undo now checks it), a Pass that fails always comes back, and a late refusal never puts a job into a list that was replaced meanwhile. Guards: tests/career-match-deck-page.test.mjs, tests/career-match-deck-routes.test.mjs.
 */
(function (root) {
  'use strict';
  const JOBS = '/api/career-hunter/jobs/';
  const HISTORY_LIMIT = 20, THRESHOLD = 80, FLICK_DISTANCE = 36, FLICK_SPEED = 0.45;
  /** Where a job is once it has left New matches, by its status, in the words of the stage row. */
  const STAGE = { promoted: 'Getting ready', generated: 'Getting ready', deferred: 'Getting ready', applied: 'Applied', interview: 'Interviewing', offer: 'Offer', rejected: 'Closed', dismissed: 'Removed' };
  const BUTTONS = '<button type="button" class="ck-btn" data-deck-act="undo" disabled>Undo</button><button type="button" class="ck-btn" data-deck-act="pass">Pass</button><button type="button" class="ck-primary" data-deck-act="save">Save</button><button type="button" class="ck-btn" data-deck-act="more">More</button>';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (id) => document.getElementById(id);
  const sentence = (text) => String(text).replace(/[.\s]+$/, '') + '.';
  /** Why a read or a write did not happen, in words a person can act on; a server's own sentence is kept. */
  function reason(error, generic = 'Career could not do that just now.', aboutJob = true) {
    const text = String(error?.message || ''), status = error?.status;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'Career took too long to answer.';
    if (status === 401) return 'You are signed out. Sign in and try again.';
    if (status === 404 && aboutJob) return 'Career no longer has this job.';
    if (status === undefined && /fetch|network|load failed/i.test(text)) return 'Career could not be reached.';
    // An answer that is not Career's own (a gateway's page), a bare status or a route's short code is not a sentence to show.
    if (!text || error?.name === 'SyntaxError' || status >= 500 || /^HTTP \d+$/.test(text) || /^[a-z_ ]+$/.test(text)) return generic;
    return sentence(text);
  }
  const named = (job) => { const title = String(job?.title || '').trim(), company = String(job?.company || '').trim(); return title && company ? title + ' at ' + company : title || company || 'This job'; };

  let host = null, history = [], shownOn = false, undoing = false, held = false, waiting = false, refilling = false, stalled = false;
  const acting = new Set(), tally = { save: 0, pass: 0 };

  /**
   * @description Take the page's hooks. The page owns the jobs, their loading and the posting sheet; the deck owns the
   * card, the four buttons and what Undo remembers.
   * @param {object} next rows(), setRows(rows), render(), say(text), moved(text), posting(id), more() (read the first
   *   page again and add what is new), retry() (read the list afresh), exhausted(), reading() (a read is unanswered),
   *   failed() (the error of the last read, or null), view() (a number that changes when the list is replaced, not when
   *   it is added to), filtered(), pay(job), place(job), badge(job), note(job).
   * @returns {void}
   */
  function attach(next) { host = next; history = []; tally.save = 0; tally.pass = 0; stalled = false; }

  /** @description Leave out the jobs this visit has saved or passed, or is saving or passing now: a read that raced a write still lists them. @param {Array<object>} rows @returns {Array<object>} */
  function without(rows) { const gone = new Set([...acting, ...history.map((entry) => entry.job.id)]); return gone.size ? rows.filter((job) => !gone.has(job.id)) : rows; }

  /** The fit of a job as the card says it: the number, or the plain reason there is none. */
  function fitMarkup(job) {
    if (root.CareerJobActions.detailsNeeded(job)) return '<p class="match-fit"><span class="details-needed-label">Details needed</span></p>';
    if (job.ai_fit_score != null) return `<p class="match-fit" data-fit="${esc(job.ai_fit_score)}">AI fit <b>${esc(job.ai_fit_score)}</b></p>`;
    return `<p class="match-fit">${job.fit_assessment?.kind === 'undecided' ? 'Close call, not settled yet' : 'Not scored yet'}</p>`;
  }

  /** One card. The lead card is the job the buttons act on; the one under it only shows that more follow. */
  function cardMarkup(job, lead) {
    const unread = root.CareerJobActions.detailsNeeded(job), known = Boolean(job.salary_min || job.salary_max);
    const body = unread ? host.note(job) : `<p class="why">${esc(job.ai_fit_rationale || 'Press More to read the posting and how you fit it.')}</p>`;
    return `<article class="match-card ${lead ? 'lead' : 'peek'}" data-deck-id="${esc(job.id)}"${lead ? ` aria-label="${esc(named(job))}"` : ' aria-hidden="true" inert'}>`
      + `<div class="match-card-head"><p class="co">${esc(job.company)}${host.badge(job)}</p>${fitMarkup(job)}</div>`
      + `<h2><button class="job-title" type="button" data-posting="${esc(job.id)}">${esc(job.title)}</button></h2>`
      + `<div class="meta">${host.place(job)}${known ? `<span class="match-pay">${esc(host.pay(job))}</span>` : ''}</div>${body}</article>`;
  }

  /** The words for what this visit did, for the end of the deck. */
  function tallyWords() {
    const saved = tally.save, passed = tally.pass, parts = [];
    if (saved) parts.push('saved ' + saved);
    if (passed) parts.push('passed on ' + passed);
    return parts.length ? 'You ' + parts.join(' and ') + '.' : '';
  }

  /** The end of the deck: what was done, where the saved jobs are, and what to do next. */
  function endMarkup() {
    const filtered = host.filtered();
    const next = filtered ? 'Your filters are on. Clear them to see your other matches.' : 'New matches appear here as Career finds them.';
    const saved = tally.save ? ' Your saved jobs are in Saved, where you prepare an application.' : '';
    return `<div class="ck-empty match-deck-state" data-deck-state="end"><div class="ck-empty-icon" aria-hidden="true">✓</div><h2>${filtered ? 'No more matches with these filters' : 'That is every match for now'}</h2>`
      + `<p>${esc(tallyWords() + saved)} ${next}${history.length ? ' Undo brings back the last one.' : ''}</p>`
      + (tally.save ? '<a class="ck-primary" href="/api/career-hunter/board-native?view=saved">Open Saved</a>' : '')
      + (filtered ? '<button type="button" class="ck-btn" data-clear-filters>Clear filters</button>' : `<a class="${tally.save ? 'ck-btn' : 'ck-primary'}" href="/api/career-hunter/search-ui" data-career-tool="career-search">Find jobs</a>`)
      + '</div>';
  }

  /** A list that could not be read: what happened, that nothing is lost, and the way to try again. */
  function errorMarkup() {
    return `<div class="ck-alert match-deck-state" role="alert" data-deck-state="error"><h2>Couldn’t load your matches</h2><p>${esc(reason(host.failed(), 'Career could not read your matches just now.', false))} Nothing you saved or passed is lost. Try again in a moment.</p>`
      + '<button type="button" class="ck-btn" data-deck-act="retry">Try again</button></div>';
  }

  /** The place a card will be while the list is read. The page's status line says it for a screen reader. */
  function loadingMarkup() { return `<div class="match-card match-deck-state" data-deck-state="loading" aria-hidden="true"><p class="why">${worked() ? 'Loading more matches…' : 'Loading your matches…'}</p></div>`; }

  /** Whether this visit has acted on a job: what turns an empty list into the end of a deck. */
  const worked = () => tally.save + tally.pass > 0 || history.length > 0;

  /** What the deck should show for the jobs the page holds now. */
  function stateOf(on) {
    if (!on || !host) return 'off';
    if (host.rows().length) return 'cards';
    if (host.failed()) return 'error';
    if (host.reading()) return 'loading';
    if (worked() && (host.exhausted() || stalled)) return 'end';
    return worked() || acting.size ? 'loading' : 'off';
  }

  /** Show or hide the four buttons, drawn once so a press keeps its focus, and set which of them can be pressed. */
  function dock(state) {
    const shown = state === 'cards' || (state !== 'off' && history.length > 0), buttons = el('deckActionButtons');
    el('matchActionDock').toggleAttribute('data-deck-active', shown);
    if (!shown) { buttons.innerHTML = ''; return; }
    if (!buttons.querySelector('[data-deck-act]')) buttons.innerHTML = BUTTONS;
    const last = history[history.length - 1];
    for (const button of buttons.querySelectorAll('[data-deck-act]')) {
      const undo = button.dataset.deckAct === 'undo';
      button.disabled = undo ? !last || undoing || acting.has(last.job.id) : state !== 'cards';
      if (undo) button.toggleAttribute('aria-busy', undoing);
    }
  }
  /** Bring the buttons up to date without redrawing the card. */
  const sync = () => dock(stateOf(shownOn));

  /**
   * @description Draw the deck into the page's list when the phone layout of New matches is on.
   * @param {boolean} on Whether New matches is shown as cards on a phone.
   * @returns {boolean} True when the deck drew the list; false when the page should draw its own list or empty state.
   */
  function draw(on) {
    if (held && on) { waiting = true; return true; }
    shownOn = on;
    const state = stateOf(on);
    dock(state);
    if (state === 'off') return false;
    const list = el('list'), rows = host.rows();
    if (state === 'cards') {
      list.innerHTML = `<div class="match-deck" role="group" aria-label="New matches, one job at a time"><p class="hint">Swipe right to save or left to pass, or use the buttons.</p><div class="match-deck-stage">${rows[1] ? cardMarkup(rows[1], false) : ''}${cardMarkup(rows[0], true)}</div></div>`;
      bindSwipe(list.querySelector('.match-card.lead'));
    } else list.innerHTML = state === 'end' ? endMarkup() : state === 'error' ? errorMarkup() : loadingMarkup();
    el('pager').innerHTML = '';
    if (state === 'loading' && !host.reading() && !acting.size && !refilling) setTimeout(() => void refill(), 0);
    return true;
  }

  /** Read the first page again when the deck runs low. The jobs already saved or passed have left it, so the next ones follow; asking for page 2 would skip as many as were acted on. */
  async function refill() {
    if (refilling || !host || host.exhausted() || host.reading() || acting.size || host.rows().length >= 2) return;
    refilling = true;
    const before = host.rows().length;
    try { await host.more(); stalled = host.rows().length <= before && !host.exhausted() && !host.failed(); }
    finally { refilling = false; }
    if (stalled) host.render();
  }

  /** Say a move in the page's status line and, for a screen reader, which job the buttons act on now. */
  function announce(text) {
    host.moved(text);
    const lead = host.rows()[0], line = el('actionState');
    if (!lead || !line) return;
    const next = document.createElement('span');
    next.className = 'match-deck-sr';
    next.textContent = ' Next: ' + named(lead) + '.';
    line.append(next);
  }

  /** One write to the route the board's own buttons use; a refusal carries its HTTP status and plain words. */
  async function post(id, body) {
    const response = await fetch(JOBS + id + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok !== false) return result;
    const busy = response.status === 409 && result.error === 'career_run_in_progress';
    throw Object.assign(Error(busy ? 'Career is working on your account. Try again when it finishes' : result.error || 'HTTP ' + response.status), { status: response.status });
  }

  /** Put a job back on top of the deck. */
  function restore(job) { host.setRows([job, ...host.rows().filter((row) => row.id !== job.id)]); }

  /** Take an action out of the visit's count: it did not happen, or it is not known to have happened. */
  function uncount(entry) { if (entry.counted) { entry.counted = false; tally[entry.action] = Math.max(0, tally[entry.action] - 1); } }

  /** Forget one remembered action and what it added to the visit's count. */
  function forget(entry) {
    uncount(entry);
    const index = history.indexOf(entry);
    if (index !== -1) history.splice(index, 1);
  }

  /**
   * A Save or a Pass that did not go through. A Pass always comes back: showing a job again is harmless. A Save comes
   * back only when Career's own refusal proves nothing was written (it is working on the account); any other answer, or
   * none, leaves it unknown whether the job was saved, so the card stays away and Undo, which reads the job first, is
   * the way to find out. A job whose list was replaced meanwhile is not put into the new list; the list is read again.
   */
  function refused(entry, error, view) {
    const lead = entry.job, save = entry.action === 'save', proven = !save || error.careerRunInProgress === true;
    if (!proven) { uncount(entry); host.render(); host.say('Could not confirm the save: ' + reason(error) + ' Press Undo to check it.'); return; }
    forget(entry);
    const same = host.view() === view;
    if (same) restore(lead);
    host.render();
    host.say((save ? 'Not saved: ' : 'Not passed: ') + reason(error) + (same ? ' ' + named(lead) + ' is back on top.' : ''));
    if (!same) host.retry();
  }

  /** Save or pass the lead job: the card leaves at once, and what follows a write that did not go through is `refused`. */
  async function move(kind, lead) {
    const entry = { job: lead, action: kind, counted: true }, view = host.view();
    acting.add(lead.id); history.push(entry); tally[kind] += 1; stalled = false;
    if (history.length > HISTORY_LIMIT) history.shift();
    host.setRows(host.rows().filter((job) => job.id !== lead.id)); host.render();
    try {
      if (kind === 'save') await root.CareerJobActions.save(lead.id); else await post(lead.id, { status: 'dismissed' });
      acting.delete(lead.id); sync();
      announce(root.CareerStatusLine.move(kind === 'save' ? 'saved' : 'removed', lead));
    } catch (error) {
      acting.delete(lead.id); refused(entry, error, view);
    }
    if (host.rows().length < 2) void refill();
  }

  /** Read one job as Career holds it now. */
  async function read(id) {
    const response = await fetch(JOBS + id, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Object.assign(Error('HTTP ' + response.status), { status: response.status });
    const { job } = await response.json();
    if (!job || Number(job.id) !== Number(id)) throw Error('Career did not return this job');
    return job;
  }

  /**
   * Reverse exactly what the last action left, and nothing else. A passed job that is still removed goes back to new; a
   * saved job that is still only saved is unsaved. `never` means the action had not landed, so there is nothing to
   * reverse; `moved` means the job has gone on to another stage since and is left as it is.
   */
  async function reverse(entry, now) {
    const status = now.status || '', open = status === '' || status === 'new', id = entry.job.id;
    if (entry.action === 'pass') {
      if (status === 'dismissed') { await post(id, { status: 'new' }); return 'back'; }
      return open ? 'never' : 'moved';
    }
    if (open && now.favorite === true) { await root.CareerJobActions.favorite(id, false); return 'back'; }
    return open ? 'never' : 'moved';
  }

  /** Undo the last action. */
  async function undo() {
    const entry = history[history.length - 1];
    if (!entry) { host.say('Nothing to undo.'); return; }
    if (undoing || acting.has(entry.job.id)) return;
    undoing = true; sync();
    try {
      const now = await read(entry.job.id), outcome = await reverse(entry, now);
      forget(entry);
      if (outcome === 'moved') { host.say(`Not undone: ${named(entry.job)} is in ${STAGE[now.status] || 'another stage'} now, so it was left there.`); return; }
      restore(entry.job); stalled = false;
      if (outcome === 'never') host.moved(`Brought back: ${named(entry.job)}. It had not been ${entry.action === 'pass' ? 'removed' : 'saved'}.`);
      else host.moved(entry.action === 'pass' ? 'Brought back: ' + named(entry.job) + '.' : root.CareerStatusLine.move('unsaved', entry.job));
    } catch (error) {
      host.say('Could not undo: ' + reason(error) + ' Nothing was changed. Try again.');
    } finally { undoing = false; host.render(); }
  }

  /**
   * @description One press of a deck button, or the same thing by swipe.
   * @param {string} kind 'pass', 'save', 'undo', 'more' or 'retry'.
   * @returns {Promise<void>}
   */
  async function act(kind) {
    if (!host) return;
    if (kind === 'undo') return undo();
    if (kind === 'retry') { host.retry(); return; }
    const lead = host.rows()[0];
    if (!lead || acting.has(lead.id)) return;
    if (kind === 'more') { host.posting(lead.id); return; }
    if (kind === 'pass' || kind === 'save') await move(kind, lead);
  }

  /** Let go of a held card, and draw what was held back while it was held. */
  function release() { held = false; if (waiting) { waiting = false; host.render(); } }

  /**
   * The swipe. The card follows the finger from anywhere on it once the movement is sideways; a drag past the threshold,
   * or a quick flick, sends it off the screen and saves (right) or passes (left); anything shorter settles back. A touch
   * the phone takes for scrolling never acts, and a tap still opens the job.
   */
  function bindSwipe(card) {
    if (!card) return;
    const still = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let pointer = null, sx = 0, sy = 0, dx = 0, started = 0, mode = '';
    const settle = () => { card.classList.remove('dragging'); card.style.transform = ''; delete card.dataset.swipe; release(); };
    card.onpointerdown = (e) => { if (e.button || pointer !== null) return; pointer = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; started = e.timeStamp; mode = ''; };
    card.onpointermove = (e) => {
      if (e.pointerId !== pointer) return;
      dx = e.clientX - sx; const dy = e.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
        if (mode === 'swipe') { held = true; card.setPointerCapture?.(pointer); card.classList.add('dragging'); }
      }
      if (mode !== 'swipe') return;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      card.dataset.swipe = dx > 24 ? 'save' : dx < -24 ? 'pass' : '';
    };
    const end = (e, cancelled) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (mode !== 'swipe') { mode = ''; return; }
      mode = 'swiped'; // the click that follows a drag is not a tap on the job
      const speed = Math.abs(dx) / Math.max(1, e.timeStamp - started);
      if (cancelled || !(Math.abs(dx) > THRESHOLD || (Math.abs(dx) > FLICK_DISTANCE && speed > FLICK_SPEED))) { settle(); return; }
      const kind = dx > 0 ? 'save' : 'pass';
      held = false; waiting = false;
      if (still) { void act(kind); return; }
      card.classList.remove('dragging'); card.classList.add('flung');
      card.style.transform = `translateX(${dx > 0 ? 130 : -130}%) rotate(${dx > 0 ? 18 : -18}deg)`;
      setTimeout(() => void act(kind), 170);
    };
    card.onpointerup = (e) => end(e, false);
    card.onpointercancel = (e) => end(e, true);
    card.addEventListener('click', (e) => { if (mode === 'swiped') { mode = ''; e.preventDefault(); e.stopPropagation(); } }, true);
  }

  root.CareerMatchDeck = { attach, draw, act, without };
})(window);
