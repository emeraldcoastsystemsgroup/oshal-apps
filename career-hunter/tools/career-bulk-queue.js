/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-CONCURRENT (Roger, 2026-11-25: "when im batch running resumes and trying to look for jobs i cant post them .. hit save... ect.."): the queue yields between jobs to the person. While any change they made is waiting to save (deps.pendingWrites, tools/career-pending-writes.js: a Save, a status, notes refused because a résumé is being written), no preparation starts, so when the résumé being written finishes their change goes next and the next résumé after it. Writes the person queued here still go first, as before. Guard: tests/career-concurrent-writes.test.mjs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "when i get to the application screen it fully generated my resume without asking me about adding in my optional addendum"; "this is not a choice in bulk edit"): a preparation carries the Other experience the person chose in bulk Prepare's step (experienceIds, kept with the item in their storage, so a reload or Prepare the failed ones again keeps it). Before a job is prepared the choice is saved on its own tailoring (POST /jobs/:id/status draft, with experienceChosen; nothing is written when it already holds it), so the job is prepared with it whichever way it starts, and Generate sends exactly that choice. A preparation queued before 1.68.1 has no choice and is cancelled with words instead of prepared without asking. Guard: tests/career-bulk-queue.test.mjs, tests/career-prepare-other-experience-browser.test.mjs.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.0 (Roger, 2026-11-16, on My jobs with 194 saved jobs: "select multiple rows on a table and push all the applications to prepare application that i select ... bulk select for all of the subsequent screens as well"). The queue behind My jobs' bulk actions. Prepare runs one job's own two writes (POST /jobs/:id/status promoted through CareerJobActions.promote, then POST /jobs/:id/generate through CareerJobActions.prepare with the job's saved tailoring), never a second preparation. At most two preparations at a time, because Career's documents come from the local models the host shares; the kernel lets one run hold a person's Career files, so in practice they run one after another, and a write refused because Career is working on the account waits and is tried again, never counted as a failure. Each item is queued, running, done, failed with its reason in words, skipped or cancelled; what is still queued can be cancelled. The queue is kept in the person's own browser storage (per tenant and principal) and survives a reload; one tab drives it at a time. A preparation whose run ended without its receipt, or that passed the kernel's 30 minute run limit, is failed with words and never retried by itself. Three failures in a row with one reason pause the preparations. Guard: tests/career-bulk-queue.test.mjs.
 */
(function (root) {
  'use strict';
  /** At most this many preparations at once: Career's documents come from the local models the host shares. */
  const MAX_AT_ONCE = 2;
  /** How often a running preparation is read. */
  const POLL_MS = 5000;
  /** After Career answers that it is working on the account, how long before the next write is tried. */
  const BUSY_WAIT_MS = 15000;
  /** The kernel ends a run at 30 minutes; a preparation without its receipt past this did not finish. */
  const RUN_LIMIT_MS = 31 * 60 * 1000;
  /** The tab that drives the queue renews its hold; another tab takes over when it lapses. */
  const LEASE_MS = 10000;
  /** This many preparations in a row that stop with one reason pause the rest. */
  const PAUSE_AFTER = 3;
  /** Writes one pass may make back to back (each waits for the one before). */
  const WRITES_PER_PASS = 25;
  /** Finished items kept for the person to read; the oldest go first. */
  const KEEP = 400;
  const DONE = new Set(['applied', 'interview', 'offer', 'rejected']);
  const PREPARED = new Set(['promoted', 'generated', 'deferred']);
  const DETAIL_FAILURES = new Set(['job_details_unavailable', 'job_context_unavailable']);
  /** Reasons that belong to one job (its posting, its description, its own tailoring); they never pause the others. */
  const ONE_JOB = new Set([...DETAIL_FAILURES, 'job_details_needed', 'pasted_details_invalid', 'posting_not_found', 'job_context_too_large',
    'already_submitted', 'experience_selection_invalid', 'experience_selection_changed', 'experience_unavailable', 'draft_conflict', 'application_locked']);
  const TERMINAL = new Set(['done', 'failed', 'cancelled', 'skipped']);
  const STOPPED = 'The preparation stopped before it finished, so nothing was saved. Select the job and prepare it again.';
  const TOO_LONG = 'Career did not finish this preparation within 30 minutes. Open the job to check it.';
  const WAITING = 'Waiting for Career to finish what it is doing on your account.';
  const UNREACHABLE = 'Career could not be reached. It is tried again shortly.';
  const UNASKED = 'This was queued before Career asked about your other experience, so it was not prepared. Select it and press Prepare applications to choose.';

  /** @description A request id the generate route accepts (letters, digits and dashes). @returns {string} */
  function newRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'bulk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /**
   * @description Whether a refused write means Career is busy on the account (try again later) rather than a refusal.
   * The native kernel answers 409 career_run_in_progress before the package runs, so nothing was written.
   * @param {Error & {status?:number, careerRunInProgress?:boolean}} error The thrown refusal.
   * @returns {boolean}
   */
  function isBusy(error) {
    if (!error) return false;
    if (error.careerRunInProgress === true || error.code === 'career_run_in_progress' || error.status === 429) return true;
    const text = String(error.message || '');
    return (error.status === 409 && /already running/i.test(text)) || (error.status === 503 && /busy/i.test(text));
  }

  /** @description Whether a write ended with no answer, so its outcome must be read before anything is written again. */
  function isUnknown(error) { return !!error && !Number.isFinite(error.status); }

  /**
   * @description The words an item shows on its row and in the progress list.
   * @param {object|null} item A queue item.
   * @returns {{kind:string, word:string, reason:string}|null} Null when there is no item.
   */
  function words(item) {
    if (!item) return null;
    const running = { prepare: 'Preparing…', status: 'Working…', send: 'Sending…' };
    const done = { prepare: 'Prepared', status: item.done || 'Done', send: 'Approved' };
    const word = item.state === 'queued' ? 'Queued' : item.state === 'running' ? running[item.kind] || 'Working…'
      : item.state === 'done' ? done[item.kind] || 'Done' : item.state === 'failed' ? 'Failed'
        : item.state === 'skipped' ? 'Skipped' : 'Cancelled';
    return { kind: item.state, word, reason: item.reason || item.note || '' };
  }

  /**
   * @description Make one person's queue.
   * @param {object} deps What the queue may use: owner ('tenant:principal', or '' for this visit only), storage
   *   (localStorage; any call may throw), fetch, actions (CareerJobActions), send (id, packetDigest) for an approved
   *   send, now (ms clock), tab (this tab's id), onChange (called with no argument when anything changed) and
   *   pendingWrites (how many of the person's own changes are waiting to save; no preparation starts while any are).
   * @returns {object} The queue's controls.
   */
  function create(deps) {
    const now = deps.now || (() => Date.now()), tab = deps.tab || newRequestId(), owner = String(deps.owner || '');
    const KEY = owner ? 'career-bulk:v1:' + owner : '', LEASE = owner ? 'career-bulk-lead:v1:' + owner : '';
    const state = { items: [], paused: null, busyUntil: 0, writing: false, ticking: false, bank: null, streak: null, timer: null, shown: '' };

    /** @description Read a stored JSON value; null when storage refuses or holds nothing usable. */
    function readStored(key) {
      if (!key || !deps.storage) return null;
      try { const text = deps.storage.getItem(key); return text ? JSON.parse(text) : null; } catch (_) { return null; }
    }
    /** @description Store a JSON value; false when storage refuses (a private window, a full store). */
    function writeStored(key, value) {
      if (!key || !deps.storage) return false;
      try { if (value == null) deps.storage.removeItem(key); else deps.storage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    }
    /** @description Take what another tab stored: the newer revision of each item wins. */
    function reload() {
      const stored = readStored(KEY);
      if (!stored || stored.version !== 1 || !Array.isArray(stored.items)) return;
      const mine = new Map(state.items.map((item) => [item.key, item]));
      const merged = stored.items.filter((item) => item && typeof item.key === 'string').map((item) => {
        const held = mine.get(item.key);
        mine.delete(item.key);
        return held && (held.rev || 0) > (item.rev || 0) ? held : item;
      });
      state.items = [...merged, ...mine.values()].sort((a, b) => a.queuedAt - b.queuedAt || (a.seq || 0) - (b.seq || 0));
      state.paused = stored.paused || null;
    }
    /** @description Keep the queue in the person's storage; the oldest finished items go when it grows past KEEP. */
    function persist() {
      const live = state.items.filter((item) => !TERMINAL.has(item.state)), ended = state.items.filter((item) => TERMINAL.has(item.state));
      state.items = [...ended.slice(Math.max(0, ended.length + live.length - KEEP)), ...live].sort((a, b) => a.queuedAt - b.queuedAt || (a.seq || 0) - (b.seq || 0));
      writeStored(KEY, { version: 1, items: state.items, paused: state.paused, updatedAt: now() });
    }
    /** @description What a person can see of the queue, to tell the page only when that changed. */
    function signature() { return JSON.stringify([state.paused, state.items.map((item) => [item.key, item.state, item.note, item.reason])]); }
    /** @description Tell the page, only when what it shows changed. */
    function notify() {
      const seen = signature();
      if (seen === state.shown) return;
      state.shown = seen;
      try { deps.onChange && deps.onChange(); } catch (_) { /* a page that failed to draw keeps the queue */ }
    }
    function changed() { persist(); notify(); }
    /** @description Change an item and count the change so another tab's older copy does not win. */
    function update(item, patch) { Object.assign(item, patch, { rev: (item.rev || 0) + 1, at: now() }); }

    /** @description Whether this tab drives the queue: it holds an unexpired lease, or nobody else does. */
    function lead() {
      if (!LEASE || !deps.storage) return true;
      const held = readStored(LEASE), at = now();
      if (held && held.tab !== tab && held.until > at) return false;
      if (!writeStored(LEASE, { tab, until: at + LEASE_MS })) return true;
      const check = readStored(LEASE);
      return !check || check.tab === tab;
    }
    function release() { const held = readStored(LEASE); if (held && held.tab === tab) writeStored(LEASE, null); }

    /** @description A preparation's Other experience choice as the item keeps it: the entry ids the person ticked, or nothing. */
    function choiceOf(entry) {
      const ids = entry && entry.kind === 'prepare' && Array.isArray(entry.experienceIds) ? entry.experienceIds.filter((one) => typeof one === 'string') : null;
      return ids ? { experienceIds: [...new Set(ids)] } : {};
    }

    /**
     * @description Queue work for the jobs a person selected. A job that already has the same work queued or running is
     * left alone and counted as already queued.
     * @param {Array<{id:number, title?:string, company?:string, kind:'prepare'|'status'|'send', body?:object, label?:string,
     *   done?:string, digest?:string}>} entries One per job.
     * @returns {{added:number, already:number, batch:string}}
     */
    function add(entries) {
      reload();
      const batch = newRequestId(), at = now();
      let added = 0, already = 0, seq = state.items.reduce((max, item) => Math.max(max, item.seq || 0), 0);
      for (const entry of entries || []) {
        const id = Number(entry && entry.id);
        if (!Number.isSafeInteger(id) || id <= 0 || !['prepare', 'status', 'send'].includes(entry.kind)) continue;
        if (state.items.some((item) => item.id === id && item.kind === entry.kind && !TERMINAL.has(item.state))) { already += 1; continue; }
        state.items.push({ key: batch + ':' + id + ':' + entry.kind, batch, id, seq: ++seq, kind: entry.kind, title: String(entry.title || ''),
          company: String(entry.company || ''), body: entry.body || null, label: String(entry.label || ''), done: String(entry.done || ''),
          digest: entry.digest || '', ...choiceOf(entry), state: 'queued', reason: '', note: '', queuedAt: at, rev: 1, at });
        added += 1;
      }
      if (added) { state.busyUntil = 0; changed(); }
      return { added, already, batch };
    }

    /** @description Cancel what has not started; running work finishes. @param {number[]} [ids] Only these jobs. @returns {number} */
    function cancelQueued(ids) {
      reload();
      const only = Array.isArray(ids) ? new Set(ids.map(Number)) : null;
      let count = 0;
      for (const item of state.items) {
        if (item.state !== 'queued' || (only && !only.has(item.id))) continue;
        update(item, { state: 'cancelled', reason: 'Cancelled before it started.', note: '' });
        count += 1;
      }
      if (count) changed();
      return count;
    }

    /** @description Take the finished items off the list; what is queued or running stays. @returns {number} */
    function clearFinished() {
      reload();
      const before = state.items.length;
      state.items = state.items.filter((item) => !TERMINAL.has(item.state));
      if (!state.items.some((item) => item.kind === 'prepare')) state.paused = null;
      if (before !== state.items.length) changed();
      return before - state.items.length;
    }

    /** @description Start the paused preparations again. @returns {void} */
    function resume() { reload(); state.paused = null; state.streak = null; state.busyUntil = 0; changed(); }

    /** @description Put the preparations that failed back in the queue, as the person asked; they start fresh. @returns {number} */
    function retryFailed() {
      reload();
      let count = 0;
      for (const item of state.items) {
        if (item.kind !== 'prepare' || item.state !== 'failed') continue;
        update(item, { state: 'queued', reason: '', note: '', requestId: '', prior: '', via: '', sawRun: false, idle: 0, unknown: false, maybe: false, promoted: false, startedAt: 0, endedAt: 0, queuedAt: now() });
        count += 1;
      }
      if (count) { state.paused = null; state.streak = null; state.busyUntil = 0; changed(); }
      return count;
    }

    /** @description Read one job as the person's own job route answers it. @param {number} id @returns {Promise<{job:object, processing:boolean}>} */
    async function readJob(id) {
      const response = await deps.fetch('/api/career-hunter/jobs/' + encodeURIComponent(id), { cache: 'no-store' });
      if (!response.ok) { const error = Error('Career could not read this job (HTTP ' + response.status + ').'); error.status = response.status; throw error; }
      const data = await response.json();
      if (!data || !data.job || Number(data.job.id) !== id) { const error = Error('Career could not read this job.'); error.status = 502; throw error; }
      return { job: data.job, processing: !!data.processing };
    }

    /** @description The other-experience revision the application page sends with Generate (read once a minute at most). */
    async function bankRevision() {
      if (state.bank && now() - state.bank.at < 60000) return state.bank.revision;
      const response = await deps.fetch('/api/career-hunter/experience-bank?summary=1', { cache: 'no-store' });
      if (!response.ok) { const error = Error('Your other experience could not be read (HTTP ' + response.status + ').'); error.status = response.status; throw error; }
      const data = await response.json();
      state.bank = { revision: String((data && data.revision) || ''), at: now() };
      return state.bank.revision;
    }

    /** @description The words for an engine reason code, the paste words for a job Career could not read. */
    function reasonWords(code, job) {
      if (DETAIL_FAILURES.has(code) && !(job && /\S/.test(String(job.description || '')))) return deps.actions.DETAILS_NEEDED;
      return deps.actions.message(code);
    }

    /**
     * @description End an item. Failures in a row with one reason pause the preparations, unless the reason belongs to that
     * one job (its description, its posting, its own tailoring).
     * @param {object} item The item. @param {string} outcome done, failed, skipped or cancelled. @param {string} [reason] Words.
     * @param {string} [code] The reason's code, when there is one.
     * @returns {void}
     */
    function finish(item, outcome, reason, code) {
      update(item, { state: outcome, reason: reason || '', note: '', endedAt: now() });
      if (item.kind !== 'prepare') return;
      if (outcome === 'failed' && ONE_JOB.has(code)) { state.busyUntil = 0; return; }
      if (outcome === 'failed') {
        state.streak = state.streak && state.streak.reason === reason ? { reason, count: state.streak.count + 1 } : { reason, count: 1 };
        if (state.streak.count >= PAUSE_AFTER) state.paused = { reason, at: now() };
      } else if (outcome === 'done') state.streak = null;
      if (outcome !== 'skipped') state.busyUntil = 0;
    }

    /** @description End a preparation on its own receipt: prepared, or failed with the engine's reason in words. */
    function ended(item, done, job) {
      if (done.phase === 'ready') return finish(item, 'done', '');
      return finish(item, 'failed', reasonWords(done.error, job), done.error);
    }

    /** @description Back to the queue after Career said it is busy (or gave no answer); the item keeps its place. */
    function wait(item, error, patch) {
      state.busyUntil = now() + BUSY_WAIT_MS;
      update(item, { state: 'queued', note: isUnknown(error) ? UNREACHABLE : WAITING, ...(patch || {}) });
    }

    /** @description A job's own receipt for the run this item is waiting on. */
    function receipt(item, job) {
      const board = (job && job.board) || {};
      if (!board.completedAt) return null;
      if (item.requestId) return board.requestId === item.requestId ? board : null;
      return board.requestId && board.requestId !== item.prior ? board : null;
    }

    /**
     * @description Before a preparation starts, what the job is now: already applied, one Career says it cannot read until
     * its description is pasted, already prepared, already being prepared (followed, not started twice), or ready.
     * @returns {'applied'|'unread'|'prepared'|'busy'|'ready'}
     */
    function standing(job) {
      if (DONE.has(job.status)) return 'applied';
      if (typeof job.details_needed === 'string' && job.details_needed.trim()) return 'unread';
      const application = job.application || {}, board = job.board || {};
      if (application.busy || (board.generationDraft && board.generationDraft.state === 'requested' && !receipt({ requestId: board.generationDraft.requestId }, job))) return 'busy';
      if (job.has_resume && job.has_cover && application.needsGeneration === false) return 'prepared';
      return 'ready';
    }

    /** @description Whether two Other experience choices hold the same entries. */
    function sameChoice(a, b) { return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort()); }

    /**
     * @description Save the person's bulk choice on the job's own tailoring before it is prepared, so the job is prepared with
     * it whichever way it starts (this queue, or the person's saved-job preparation). Nothing is written when it already holds it.
     * @param {object} item The queue item. @param {object} job The job as its route reads it. @param {string} revision The
     * other-experience revision. @returns {Promise<object>} The job's tailoring after the save.
     */
    async function keepChoice(item, job, revision) {
      const draft = (job.application && job.application.draft) || {};
      if (draft.experienceChosen === true && sameChoice(draft.experienceIds, item.experienceIds)) return draft;
      const response = await deps.fetch('/api/career-hunter/jobs/' + encodeURIComponent(item.id) + '/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: { revision: Number(draft.revision) || 0,
          guidance: draft.guidance || '', experienceIds: item.experienceIds, experienceRevision: revision, experienceChosen: true } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw refusal(response, result);
      return (result.application && result.application.draft) || draft;
    }

    /** @description A refused write as an error the queue understands: busy (wait), or a refusal with its own words. */
    function refusal(response, result) {
      const error = Error(String(result.error || 'HTTP ' + response.status));
      error.status = response.status; error.code = result.error === 'career_run_in_progress' ? result.error : result.code;
      error.careerRunInProgress = response.status === 409 && result.error === 'career_run_in_progress';
      return error;
    }

    /** @description Start one preparation: save the person's choice on the job, then the two writes one job's Prepare makes. */
    async function startPrepare(item) {
      if (!Array.isArray(item.experienceIds)) return finish(item, 'cancelled', UNASKED);
      const { job } = await readJob(item.id);
      const where = standing(job);
      if (where === 'applied') return finish(item, 'skipped', 'Already applied.');
      if (where === 'unread') return finish(item, 'failed', job.details_needed.trim(), 'job_details_needed');
      if (where === 'prepared') return finish(item, 'skipped', 'Already prepared: it has a résumé and cover letter.');
      const board = job.board || {};
      if (where === 'busy') return update(item, { state: 'running', requestId: board.generationDraft.requestId, startedAt: now(), note: '', sawRun: false, idle: 0, lastPoll: now() });
      const revision = await bankRevision();
      const draft = await keepChoice(item, job, revision);
      if (!PREPARED.has(job.status) && !item.promoted) {
        const promoted = await deps.actions.promote(item.id);
        update(item, { promoted: true });
        if (promoted && promoted.preparation && promoted.preparation.started === true) {
          return update(item, { state: 'running', via: 'setting', requestId: '', prior: board.requestId || '', startedAt: now(), note: '', sawRun: false, idle: 0, lastPoll: now() });
        }
      }
      const requestId = item.requestId || newRequestId();
      update(item, { requestId, maybe: true });
      await deps.actions.prepare(item.id, true, { requestId, guidance: draft.guidance || '', experienceIds: item.experienceIds,
        experienceRevision: revision, draftRevision: Number(draft.revision) || 0, experienceChosen: true });
      update(item, { state: 'running', maybe: false, startedAt: now(), note: '', sawRun: false, idle: 0, lastPoll: now() });
    }

    /** @description After a write that got no answer: read before writing again, and carry on from what the job shows. */
    async function reconcile(item) {
      const { job, processing } = await readJob(item.id);
      const done = item.requestId ? receipt(item, job) : null;
      if (done) return ended(item, done, job);
      if (item.requestId && processing) return update(item, { state: 'running', maybe: true, startedAt: now(), note: '', sawRun: true, idle: 0, lastPoll: now() });
      update(item, { unknown: false, promoted: item.promoted || PREPARED.has(job.status) });
      return startPrepare(item);
    }

    /** @description Read a running preparation and end it on its receipt, a run that vanished, or the run limit. */
    async function pollPrepare(item) {
      update(item, { lastPoll: now() });
      const { job, processing } = await readJob(item.id);
      const done = receipt(item, job);
      if (done) return ended(item, done, job);
      if (processing) return update(item, { sawRun: true, idle: 0 });
      if (item.sawRun && (item.idle || 0) + 1 >= 2) {
        // A start that was never confirmed goes back to the queue; a confirmed one that vanished is a failure.
        if (item.maybe) return update(item, { state: 'queued', note: '', sawRun: false, idle: 0, unknown: true });
        return finish(item, 'failed', STOPPED);
      }
      if (item.sawRun) return update(item, { idle: (item.idle || 0) + 1 });
      if (now() - (item.startedAt || now()) > RUN_LIMIT_MS) finish(item, 'failed', TOO_LONG);
    }

    /** @description One job's status write, the body its own row or page sends. */
    async function runStatus(item) {
      const response = await deps.fetch('/api/career-hunter/jobs/' + encodeURIComponent(item.id) + '/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body || {}) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw refusal(response, result);
      finish(item, 'done', '');
    }

    /** @description Run one queued item; busy or no answer puts it back, anything else ends it with words. */
    async function run(item) {
      state.writing = true;
      if (item.kind !== 'prepare') update(item, { state: 'running', note: '' });
      try {
        if (item.kind === 'prepare') await (item.unknown ? reconcile(item) : startPrepare(item));
        else if (item.kind === 'status') await runStatus(item);
        else { await deps.send(item.id, item.digest); finish(item, 'done', ''); }
      } catch (error) {
        if (isBusy(error) || (isUnknown(error) && item.kind === 'prepare')) wait(item, error, isUnknown(error) ? { unknown: true } : {});
        else if (isUnknown(error)) finish(item, 'failed', 'Career gave no answer, so this may or may not have happened. Open the job to check it.');
        else finish(item, 'failed', String((error && error.message) || 'Career refused this.'), error && error.code);
      } finally { state.writing = false; }
    }

    const running = () => state.items.filter((item) => item.kind === 'prepare' && item.state === 'running');
    /** @description Whether a change the person made is waiting to save; a preparation started now would make it wait again. */
    function personWaiting() {
      try { return Number(deps.pendingWrites ? deps.pendingWrites() : 0) > 0; } catch (_) { return false; }
    }
    /**
     * @description The next item to run: writes first (they are quick), then a preparation while fewer than two run and no
     * change of the person's is waiting to save.
     */
    function next() {
      if (now() < state.busyUntil) return null;
      const write = state.items.find((item) => item.state === 'queued' && item.kind !== 'prepare');
      if (write) return write;
      if (state.paused || running().length >= MAX_AT_ONCE || personWaiting()) return null;
      return state.items.find((item) => item.state === 'queued' && item.kind === 'prepare') || null;
    }

    /** @description One pass: take other tabs' changes, read running preparations, then start what may start. @returns {Promise<void>} */
    async function tick() {
      if (state.ticking) return;
      state.ticking = true;
      let leading = false;
      try {
        reload();
        leading = lead();
        if (!leading) return;
        for (const item of running()) {
          if (now() - (item.lastPoll || 0) < POLL_MS) continue;
          try { await pollPrepare(item); } catch (_) { update(item, { note: UNREACHABLE }); }
        }
        for (let writes = 0; writes < WRITES_PER_PASS && !state.writing; writes += 1) {
          const item = next();
          if (!item) break;
          await run(item);
          // One preparation starts a pass; a job found already prepared or applied does not hold up the next one.
          if (item.kind === 'prepare' && item.state !== 'skipped') break;
        }
      } finally {
        state.ticking = false;
        // Only the tab that drives writes the queue back; another tab only redraws what it read.
        if (leading) changed(); else notify();
      }
    }

    /** @description Drive the queue while the page is open. @param {number} [every] Milliseconds between passes. @returns {void} */
    function start(every) {
      if (state.timer || typeof setTimeout !== 'function') return;
      const loop = () => { state.timer = setTimeout(() => { void tick().finally(loop); }, every || 1500); };
      loop();
      if (root.addEventListener) {
        root.addEventListener('storage', (event) => { if (event.key === KEY) { reload(); notify(); } });
        root.addEventListener('pagehide', () => { persist(); release(); });
      }
    }
    /** @description Stop driving (the page is going) and give the lease up so another tab may take over. @returns {void} */
    function stop() { if (state.timer) clearTimeout(state.timer); state.timer = null; release(); }

    /** @description Counts for the overall line: by state, and the preparations alone. @returns {object} */
    function summary() {
      const count = (list, value) => list.filter((item) => item.state === value).length;
      const prepare = state.items.filter((item) => item.kind === 'prepare');
      const of = (list) => ({ total: list.length, queued: count(list, 'queued'), running: count(list, 'running'), done: count(list, 'done'),
        failed: count(list, 'failed'), cancelled: count(list, 'cancelled'), skipped: count(list, 'skipped') });
      return { ...of(state.items), prepare: of(prepare), paused: state.paused, waiting: now() < state.busyUntil };
    }
    /** @description The newest item for one job, or null. @param {number} id @returns {object|null} */
    function latest(id) { for (let i = state.items.length - 1; i >= 0; i -= 1) if (state.items[i].id === Number(id)) return { ...state.items[i] }; return null; }

    reload();
    state.shown = signature();
    return { add, cancelQueued, clearFinished, resume, retryFailed, tick, start, stop, summary, latest, reload,
      items: () => state.items.map((item) => ({ ...item })), owner };
  }

  root.CareerBulkQueue = { create, words, isBusy, MAX_AT_ONCE, POLL_MS, BUSY_WAIT_MS, RUN_LIMIT_MS, LEASE_MS, PAUSE_AFTER, STOPPED, TOO_LONG, UNASKED };
})(typeof window === 'undefined' ? globalThis : window);
