/* CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First Career Coaching page script (0.1.0). Share with a coach: the seeker's page reads their own Career counts in their own session (jobs/stats, jobs/progress and, only when they choose, their applied list), builds the career-summary.v1 snapshot with Career's own stage words (unknown stays unknown, never zero), shows exactly what the coach will see, and on Share asks the kernel for a one-use confirmation and the seeker's own decision on the approval ticket before the share is made. People with access lists each coach with Stop sharing. Shared with me: the coach's code with Copy, New code and Turn off, and each client's seeker-shared snapshot with its age, its end and Stop viewing, or the plain reason none can be shown.
 */
(function (root) {
  'use strict';
  const API = '/api/career-coaching';
  const CAREER = '/api/career-hunter';
  const DAY = 24 * 60 * 60 * 1000;
  const STAGE = Object.freeze({applied: 'Applied', interview: 'Interviewing', offer: 'Offer', rejected: 'Closed'});
  const TILES = Object.freeze([['saved', 'Saved'], ['gettingReady', 'Getting ready'], ['applied', 'Applied'],
    ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['closed', 'Closed']]);

  /** @description A count Career stated, or null when it did not. @param {unknown} v @returns {number|null} */
  function known(v) { return Number.isSafeInteger(v) && v >= 0 ? v : null; }

  /**
   * @description The six pipeline counts from Career's GET /jobs/stats, by Career's own stage definitions
   * (tools/career-stages.js): Saved = saved, Getting ready = queued, Applied = tracked, Interviewing = interview,
   * Offer = offer, Closed = rejected. A failed read is unknown, never zero.
   * @param {object|null} stats - The stats answer, or null when it failed.
   * @returns {object} Pipeline.
   */
  function pipelineFrom(stats) {
    const none = {saved: null, gettingReady: null, applied: null, interviewing: null, offer: null, closed: null};
    if (!stats || typeof stats !== 'object') return none;
    if (stats.empty === true) return {saved: 0, gettingReady: 0, applied: 0, interviewing: 0, offer: 0, closed: 0};
    const bucket = (status) => {
      if (!Array.isArray(stats.byStatus)) return null;
      const row = stats.byStatus.find((item) => item && item.status === status);
      return row ? known(Number(row.n)) : 0;
    };
    return {saved: known(stats.saved), gettingReady: known(stats.queued), applied: known(stats.tracked),
      interviewing: bucket('interview'), offer: bucket('offer'), closed: bucket('rejected')};
  }

  /**
   * @description Applications recorded in the past seven days, with Career's own cutoff (GET /jobs/progress).
   * @param {object|null} progress - The progress answer, or null when it failed.
   * @param {number} now - Browser time in milliseconds.
   * @returns {object} Activity.
   */
  function activityFrom(progress, now) {
    if (progress && progress.period === 'past7days' && typeof progress.since === 'string' && typeof progress.asOf === 'string') {
      return {period: 'past7days', since: progress.since, asOf: progress.asOf, applied: known(progress.applied)};
    }
    return {period: 'past7days', since: new Date(now - 7 * DAY).toISOString(), asOf: new Date(now).toISOString(), applied: null};
  }

  /**
   * @description Up to 25 applications: public employer and title, Career's stage word and the recorded day only.
   * @param {object[]} jobs - Career's applied list (GET /jobs?status=tracked).
   * @returns {object[]} Application entries.
   */
  function applicationsFrom(jobs) {
    const clip = (text, max) => [...String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, max).join('');
    return (Array.isArray(jobs) ? jobs : []).filter((job) => job && STAGE[job.status] && clip(job.company, 120) && clip(job.title, 160))
      .slice(0, 25).map((job, index) => ({item: 'a' + (index + 1), employer: clip(job.company, 120), title: clip(job.title, 160),
        stage: STAGE[job.status], date: /^\d{4}-\d{2}-\d{2}/.test(String(job.applied_at || '')) ? String(job.applied_at).slice(0, 10) : null}));
  }

  /**
   * @description The career-summary.v1 snapshot the seeker reviews, from their own Career reads.
   * @param {{stats: object|null, progress: object|null, jobs: object[]|null, now: number, applications: boolean}} input
   * @returns {object} Snapshot.
   */
  function buildSnapshot({stats, progress, jobs, now, applications}) {
    const activity = activityFrom(progress, now);
    const snapshot = {schema: 'career-summary.v1', sourceAsOf: progress && typeof progress.asOf === 'string' ? progress.asOf : new Date(now).toISOString(),
      pipeline: pipelineFrom(stats), activity};
    if (applications) snapshot.applications = applicationsFrom(jobs);
    return snapshot;
  }

  /** @description "2 hours ago" for an instant. @param {string} iso @param {number} now @returns {string} */
  function ageText(iso, now) {
    const ms = now - Date.parse(iso);
    if (!Number.isFinite(ms)) return 'unknown';
    const minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    const hours = Math.round(minutes / 60);
    if (hours < 48) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    return Math.round(hours / 24) + ' days ago';
  }

  /** @description "Ends Nov 20" for a deadline. @param {string} iso @returns {string} */
  function endsText(iso) {
    const at = new Date(iso);
    return Number.isFinite(at.getTime()) ? 'Ends ' + at.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'End unknown';
  }

  /** @description JSON answer of a same-origin call, with the status. @returns {Promise<{ok: boolean, status: number, body: object}>} */
  async function call(fetchImpl, url, method, body, headers) {
    const init = {method, credentials: 'same-origin', cache: 'no-store', headers: {...(headers || {})}};
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const response = await fetchImpl(url, init);
    let parsed = {};
    try { parsed = await response.json(); } catch (_) { parsed = {}; }
    return {ok: response.ok, status: response.status, body: parsed || {}};
  }

  /**
   * @description The seeker's own decision on the preview's approval ticket through the kernel's human gate:
   * a one-use confirmation for this ticket, then approve or cancel, then the package reconciles.
   * @param {Function} fetchImpl - fetch.
   * @param {string} previewId - The preview to decide.
   * @param {'approve'|'cancel'} outcome - The person's choice.
   * @returns {Promise<object>} The activation answer.
   */
  async function decide(fetchImpl, previewId, outcome) {
    const prepared = await call(fetchImpl, `${API}/previews/${encodeURIComponent(previewId)}/prepare`, 'POST', {});
    if (!prepared.ok) throw new Error(prepared.body.message || 'The approval could not be opened.');
    const ticket = encodeURIComponent(prepared.body.ticketId);
    if (prepared.body.status === 'awaiting_approval') {
      const minted = await call(fetchImpl, `/tickets/${ticket}/application/confirmation`, 'POST', {});
      if (!minted.ok || typeof minted.body.confirmation !== 'string') throw new Error(minted.body.detail || 'The share could not be confirmed.');
      const decided = await call(fetchImpl, `/tickets/${ticket}/application/decision`, 'POST', {outcome}, {'x-oshal-confirm': minted.body.confirmation});
      if (!decided.ok) throw new Error(decided.body.detail || decided.body.message || 'The decision was refused.');
    }
    const activated = await call(fetchImpl, `${API}/previews/${encodeURIComponent(previewId)}/activate`, 'POST', {});
    if (!activated.ok) throw new Error(activated.body.message || 'Nothing was shared.');
    return activated.body;
  }

  root.CareerCoaching = {API, CAREER, STAGE, TILES, pipelineFrom, activityFrom, applicationsFrom, buildSnapshot, ageText,
    endsText, call, decide};
})(typeof window === 'undefined' ? globalThis : window);
