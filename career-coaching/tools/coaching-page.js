/* CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First Career Coaching page behaviour (0.1.0). Every value from a server is written as text, never as markup. ?view=share is the seeker's page, ?view=coach the coach's; a view the person's role does not open says so instead of failing. Stop sharing is one press. The share is made only after the Share confirmation, through the kernel's own one-use confirmation and the seeker's decision.
 */
(function () {
  'use strict';
  const C = window.CareerCoaching;
  const $ = (id) => document.getElementById(id);
  const state = {pending: null, preview: null};

  /** @description Build an element whose children are elements or text, never markup. @returns {HTMLElement} */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') node.className = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child));
    return node;
  }

  /** @description Show a short status line. @param {string} words @returns {void} */
  function toast(words) {
    const node = $('toast');
    node.textContent = words;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }

  /** @description Show or clear an error line. @param {string} id @param {string|null} words @returns {void} */
  function error(id, words) { const node = $(id); node.textContent = words || ''; node.hidden = !words; }

  /** @description The six count tiles; an unknown count shows a dash. @param {object} pipeline @returns {HTMLElement} */
  function tiles(pipeline) {
    return el('div', {class: 'cc-tiles'}, C.TILES.map(([key, label]) => el('div', {class: 'cc-tile'},
      el('b', {}, pipeline && Number.isSafeInteger(pipeline[key]) ? String(pipeline[key]) : '—'), el('span', {}, label))));
  }

  /** @description A snapshot's counts, past-7-days activity, applications and next steps. @returns {HTMLElement} */
  function snapshotBlock(view) {
    const applied = view.activity && Number.isSafeInteger(view.activity.applied) ? String(view.activity.applied) : 'unknown';
    const parts = [tiles(view.pipeline), el('p', {}, 'Applications recorded in the past 7 days: ', el('b', {}, applied))];
    if (Array.isArray(view.applications) && view.applications.length) {
      parts.push(el('table', {class: 'cc-table'}, el('thead', {}, el('tr', {}, el('th', {}, 'Employer'), el('th', {}, 'Job title'),
        el('th', {}, 'Stage'), el('th', {}, 'Date'))), el('tbody', {}, view.applications.map((row) => el('tr', {},
        el('td', {}, row.employer), el('td', {}, row.title), el('td', {}, row.stage), el('td', {}, row.date || '—'))))));
    }
    if (Array.isArray(view.nextSteps) && view.nextSteps.length) {
      parts.push(el('h3', {}, 'Next steps'), el('ul', {}, view.nextSteps.map((step) => el('li', {}, step.text,
        step.due ? el('span', {class: 'cc-muted'}, ' · due ' + step.due) : null))));
    }
    return el('div', {}, parts);
  }

  /** @description One People with access row with its state and Stop sharing. @param {object} share @returns {HTMLElement} */
  function shareRow(share) {
    const label = {shared: C.endsText(share.expiresAt), expired: 'Expired', ended: 'Stopped', stopped: 'Your coach stopped viewing'}[share.state] || 'Ended';
    const what = ['Counts', share.fieldGroups.includes('applications') ? 'Applications' : null,
      share.fieldGroups.includes('next-steps') ? 'Next steps' : null].filter(Boolean).join(' · ');
    const stop = share.state === 'shared' ? el('button', {type: 'button', class: 'cc-danger', 'data-link': share.linkId,
      onclick: () => stopSharing(share.linkId)}, 'Stop sharing') : null;
    return el('li', {}, el('div', {class: 'cc-row'}, el('div', {}, el('b', {}, share.coachName), ' ',
      el('span', {class: 'cc-muted'}, share.coachEmail || '')), el('span', {class: share.state === 'shared' ? 'cc-chip on' : 'cc-chip'}, label)),
      el('div', {class: 'cc-row'}, el('span', {class: 'cc-muted'}, `Shared as ${share.alias} · ${what}`), stop));
  }

  /** @description Read and draw the seeker's shares. @returns {Promise<void>} */
  async function loadShares() {
    const answer = await C.call(fetch, C.API + '/shares', 'GET');
    if (answer.status === 401 || answer.status === 403) { roleNote('share-role', 'This page is for coaching clients. Ask your administrator for the Coaching client role.'); return; }
    if (!answer.ok) { roleNote('share-role', answer.body.message || 'Your shares could not be read.'); return; }
    const {shares, coachViewing, days, defaultDays, name} = answer.body;
    $('viewing-note').hidden = coachViewing !== 'unavailable';
    $('share-list').replaceChildren(...shares.map(shareRow));
    $('share-empty').hidden = shares.length > 0;
    if (!$('days').options.length) {
      $('days').replaceChildren(...days.map((n) => el('option', {value: String(n)}, n === 1 ? '1 day' : `${n} days`)));
      $('days').value = String(defaultDays);
      state.defaultDays = defaultDays;
    }
    if (!$('alias').value && name) $('alias').value = name;
  }

  /** @description Show why a view is closed and hide its controls. @returns {void} */
  function roleNote(id, words) {
    const node = $(id);
    node.textContent = words;
    node.hidden = false;
    for (const other of node.parentElement.querySelectorAll('.cc-card:not(.cc-note), form, ul, #viewing-note')) other.hidden = true;
  }

  /** @description Stop sharing with one coach, in one press. @param {string} linkId @returns {Promise<void>} */
  async function stopSharing(linkId) {
    const answer = await C.call(fetch, `${C.API}/shares/${encodeURIComponent(linkId)}/revoke`, 'POST', {});
    toast(answer.ok ? 'Stopped sharing. Your coach can no longer see your summary.' : (answer.body.message || 'Sharing could not be stopped.'));
    await loadShares();
  }

  /** @description The seeker's own Career reads, each optional: a failed read is unknown, not zero. @returns {Promise<object>} */
  async function careerReads(applications) {
    const read = async (url) => { try { const a = await C.call(fetch, url, 'GET'); return a.ok ? a.body : null; } catch (_) { return null; } };
    const [stats, progress, list] = await Promise.all([read(C.CAREER + '/jobs/stats'), read(C.CAREER + '/jobs/progress'),
      applications ? read(C.CAREER + '/jobs?status=tracked&sort=applied&per=25') : Promise.resolve(null)]);
    return {stats, progress, jobs: list && Array.isArray(list.jobs) ? list.jobs : []};
  }

  /** @description The next steps the seeker wrote. @returns {object[]} */
  function nextSteps() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    return [...document.querySelectorAll('.cc-step')].map((row) => ({text: row.querySelector('.step-text').value.trim(),
      due: row.querySelector('.step-due').value || null})).filter((step) => step.text)
      .map((step) => ({...step, timeZone: step.due ? zone : null}));
  }

  /** @description Review: read Career, store the preview, show exactly what the coach will see. @returns {Promise<void>} */
  async function review(event) {
    event.preventDefault();
    error('form-error', null);
    const include = {applications: $('include-applications').checked, nextSteps: $('include-steps').checked};
    $('review').disabled = true;
    try {
      // A retry after a lost answer resends the same intent id with the same body, so the server returns that preview.
      if (!state.pending) {
        const reads = await careerReads(include.applications);
        state.pending = {intentId: crypto.randomUUID(), coachCode: $('coach-code').value, days: Number($('days').value),
          alias: $('alias').value, include, snapshot: C.buildSnapshot({...reads, now: Date.now(), applications: include.applications})};
        if (include.nextSteps) state.pending.nextSteps = nextSteps();
      }
      const answer = await C.call(fetch, C.API + '/previews', 'POST', state.pending);
      if (!answer.ok) { error('form-error', answer.body.message || 'The preview could not be made.'); if (answer.status < 500) state.pending = null; return; }
      state.pending = null;
      showReview(answer.body.preview);
    } catch (_) {
      error('form-error', 'The connection dropped. Press Review again; the same preview is kept.');
    } finally { $('review').disabled = false; }
  }

  /** @description Draw the review panel for a stored preview. @param {object} preview @returns {void} */
  function showReview(preview) {
    state.preview = preview;
    $('review-coach').textContent = preview.coach.name;
    $('review-email').textContent = preview.coach.email || '';
    $('review-title').textContent = `What ${preview.coach.name} will see`;
    const payload = preview.payload;
    $('review-snapshot').replaceChildren(el('p', {class: 'cc-muted'}, `Shared as ${payload.alias} · Seeker-shared snapshot of your Career, read `
      + C.ageText(payload.sourceAsOf, Date.now())), snapshotBlock(payload));
    $('review-terms').textContent = `${preview.renewal ? 'This replaces what you share with this coach now. ' : ''}Access ends `
      + `${preview.days} ${preview.days === 1 ? 'day' : 'days'} after you share. Nothing else in Career is shared. This preview lasts 10 minutes.`;
    error('review-error', null);
    $('share-form').hidden = true;
    $('review-panel').hidden = false;
  }

  /** @description Clear the form back to its defaults (7 days, the person's name, nothing optional). @returns {void} */
  function resetForm() {
    const days = $('days').value, alias = $('alias').value;
    $('share-form').reset();
    $('days').value = state.defaultDays ? String(state.defaultDays) : days;
    $('alias').value = alias;
    $('steps').hidden = true;
  }

  /** @description Close the review without sharing. @returns {void} */
  function back() { $('review-panel').hidden = true; $('share-form').hidden = false; state.preview = null; state.pending = null; }

  /** @description Open the Share confirmation. @returns {void} */
  function askConfirm() {
    const p = state.preview;
    $('confirm-title').textContent = `Share with ${p.coach.name}?`;
    $('confirm-text').textContent = `${p.coach.name} will see this summary for ${p.days} ${p.days === 1 ? 'day' : 'days'}. `
      + 'You can stop sharing at any time.';
    $('confirm').showModal();
  }

  /** @description The person pressed Share in the confirmation: decide through the kernel, then refresh. @returns {Promise<void>} */
  async function confirmShare() {
    const p = state.preview;
    $('confirm-share').disabled = true;
    try {
      const result = await C.decide(fetch, p.previewId, 'approve');
      $('confirm').close();
      if (result.share) { toast(`Shared with ${p.coach.name}. ${C.endsText(result.share.expiresAt)}.`); back(); resetForm(); }
      else toast(result.message || 'Nothing was shared.');
      await loadShares();
    } catch (failure) {
      $('confirm').close();
      error('review-error', failure.message || 'Nothing was shared.');
    } finally { $('confirm-share').disabled = false; }
  }

  /** @description Draw the coach's code card. @param {object} card @returns {void} */
  function drawCard(card) {
    $('code-card').hidden = false;
    $('code-value').textContent = card.published ? card.code : 'No code published';
    const actions = card.published
      ? [el('button', {type: 'button', onclick: () => navigator.clipboard && navigator.clipboard.writeText(card.code).then(() => toast('Code copied.'))}, 'Copy'),
        el('button', {type: 'button', onclick: () => changeCard('POST', {action: 'new-code'}, 'New code ready. The old code no longer works.')}, 'New code'),
        el('button', {type: 'button', class: 'cc-danger', onclick: () => changeCard('DELETE', undefined, 'Code turned off. Existing shares continue until they end.')}, 'Turn off')]
      : [el('button', {type: 'button', class: 'cc-primary', onclick: () => changeCard('POST', {action: 'publish'}, 'Your code is ready to give to clients.')}, 'Get my code')];
    $('code-actions').replaceChildren(...actions);
  }

  /** @description Publish, replace or turn off the coach code. @returns {Promise<void>} */
  async function changeCard(method, body, words) {
    const answer = await C.call(fetch, C.API + '/card', method, body);
    if (answer.ok) { drawCard(answer.body); toast(words); } else toast(answer.body.message || 'The code could not be changed.');
  }

  /** @description One client's snapshot card. @param {object} client @returns {HTMLElement} */
  function clientRow(client) {
    return el('li', {class: 'cc-card'}, el('div', {class: 'cc-row'}, el('h2', {}, client.alias),
      el('span', {class: 'cc-chip'}, client.label)),
      el('p', {class: 'cc-muted'}, `As of ${C.ageText(client.sourceAsOf, Date.now())} · shared ${C.ageText(client.publishedAt, Date.now())} · ${C.endsText(client.expiresAt)}`),
      snapshotBlock(client),
      el('div', {class: 'cc-actions'}, el('button', {type: 'button', onclick: () => stopViewing(client.linkId)}, 'Stop viewing')));
  }

  /** @description Read and draw the coach's code and clients. @returns {Promise<void>} */
  async function loadCoach() {
    const card = await C.call(fetch, C.API + '/card', 'GET');
    if (card.status === 401 || card.status === 403) { roleNote('coach-role', 'This page is for career coaches. Ask your administrator for the Career coach role.'); return; }
    if (card.ok) drawCard(card.body);
    const answer = await C.call(fetch, C.API + '/shared-with-me', 'GET');
    const note = $('clients-note');
    note.hidden = answer.ok;
    if (!answer.ok) note.textContent = answer.body.message || 'Shared snapshots could not be read.';
    const clients = answer.ok ? answer.body.clients : [];
    $('client-list').replaceChildren(...clients.map(clientRow));
    $('client-empty').hidden = !answer.ok || clients.length > 0;
  }

  /** @description The coach stops viewing one client's snapshot. @param {string} linkId @returns {Promise<void>} */
  async function stopViewing(linkId) {
    const answer = await C.call(fetch, `${C.API}/shared-with-me/${encodeURIComponent(linkId)}/stop`, 'POST', {});
    toast(answer.ok ? 'You stopped viewing this summary.' : (answer.body.message || 'That could not be done.'));
    await loadCoach();
  }

  /** @description Open the view the address names and wire its controls. @returns {void} */
  function start() {
    const coach = new URLSearchParams(location.search).get('view') === 'coach';
    $(coach ? 'coach-view' : 'share-view').hidden = false;
    if (coach) { loadCoach(); return; }
    $('share-form').addEventListener('submit', review);
    $('include-steps').addEventListener('change', () => { $('steps').hidden = !$('include-steps').checked; });
    for (const id of ['coach-code', 'alias', 'days', 'include-applications', 'include-steps']) $(id).addEventListener('change', () => { state.pending = null; });
    $('review-back').addEventListener('click', back);
    $('review-share').addEventListener('click', askConfirm);
    $('confirm-cancel').addEventListener('click', () => { $('confirm').close(); toast('Nothing was shared.'); });
    $('confirm-share').addEventListener('click', confirmShare);
    loadShares();
  }

  start();
})();
