/**
 * CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Share each permitted press’s words and retained picture across job and activity pages.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Distinguish owner-resolved sent and not-sent outcomes from worker confirmation.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 9 (fold Submission activity into Applications and say each move out loud). One vocabulary for an application a person has sent or is sending, in one file: Waiting, Sending, Sent, Needs your answer, Did not go through. forSubmission() reads a record of something Career is sending from the person's computer; forJob() reads a job the person has applied to and says how Career knows it was sent, so a job the person marked themselves reads "You marked this as applied yourself. Career has no confirmation that it was sent." move() is the one line a page shows when a job changes stage ("Applied to Acme, November 10."). The Job Board, the application page and the activity page read these, so the words cannot drift apart.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 5: a job the person marked as applied themselves, and one with no record of how it was sent, leads with Applied. It led with Sent, which is more than Career knows: nobody but the person saw it go. Sent stays for what the person's computer reported and for a confirmation page Career holds. forJob() answers kind 'applied' with the word Applied for the first two; the sentences that say how Career knows are unchanged. Guard: tests/career-applications-section.test.mjs, tests/career-apply-by-hand.test.mjs.
 */
(function (root) {
  'use strict';

  /**
   * What an application can be, in a job seeker's words. Waiting, Sending, Sent, Needs your answer and Did not go through are
   * what Career sending it from the person's computer can be. Applied is the person's own word for a job they applied to
   * themselves: Career did not see it go, so it does not call it Sent.
   */
  var WORDS = { waiting: 'Waiting', sending: 'Sending', sent: 'Sent', applied: 'Applied', answer: 'Needs your answer', failed: 'Did not go through' };
  /** The sources (user_signals.application_source) for which Career can say Sent: a computer reported it, or Career holds the confirmation page. */
  var SENT_SOURCES = { 'worker-reported': true, 'verified-submission': true };
  /** A submission record's status (lib/career-submission-queue.js) as one of the five; a retired record has no line. */
  var SUBMISSION = { queued: 'waiting', claimed: 'sending', reviewing: 'sending', submitting: 'sending', submitted: 'sent', needs_you: 'answer', unknown: 'answer', failed: 'failed', resolved_sent: 'applied', resolved_not_sent: 'failed' };
  var SUBMISSION_DETAIL = {
    queued: 'You approved it. Your computer has not started it yet.',
    claimed: 'Your computer is filling in the employer\'s form.',
    reviewing: 'Your computer is filling in the employer\'s form.',
    submitting: 'Your computer is filling in the employer\'s form.',
    submitted: 'Your computer reported it sent. The employer has not confirmed receipt.',
    needs_you: 'The employer\'s form asks something Career could not answer for you.',
    unknown: 'Career could not confirm that it arrived. Check with the employer before trying again.',
    resolved_sent: 'You said it was sent. Career recorded your word.',
    resolved_not_sent: 'You said it was not sent. A new attempt needs fresh review and approval.',
    failed: 'Your computer stopped before the form was sent.',
  };
  /** How Career knows a job was sent (user_signals.application_source), said plainly. */
  var SENT_DETAIL = {
    'manual-mark': 'You marked this as applied yourself. Career has no confirmation that it was sent.',
    'worker-reported': 'Your computer reported it sent. The employer has not confirmed receipt.',
    'verified-submission': 'Career kept a copy of the confirmation page. That does not mean the employer has accepted it.',
    unverified: 'Career has no record of how this was sent.',
  };
  /** The stages a job can move to, as the line that says so. */
  var MOVES = { saved: 'Saved', unsaved: 'Unsaved', preparing: 'Getting ready', removed: 'Removed' };

  /**
   * @description A stored time as a date. The engine writes SQLite's "YYYY-MM-DD HH:MM:SS", which is UTC with no zone;
   * read as written a browser would take it for local time and could show the day before.
   * @param {unknown} value A stored time.
   * @returns {Date|null} The date, or null when the value is not a time.
   */
  function when(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    var at = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + 'Z' : text);
    return Number.isNaN(at.getTime()) ? null : at;
  }

  /**
   * @description A day as a person says it, for example "November 10".
   * @param {unknown} value A stored time or a Date.
   * @param {string} [locale] The language to write it in; the browser's own when left out.
   * @returns {string} The day, or an empty string.
   */
  function day(value, locale) {
    var at = value instanceof Date ? value : when(value);
    return at ? at.toLocaleDateString(locale || undefined, { month: 'long', day: 'numeric' }) : '';
  }

  /**
   * @description The status line of something Career is sending, or tried to send, from the person's computer.
   * @param {object|null} item A record from GET /submission-queue.
   * @returns {{kind:string, word:string, detail:string}|null} The line, or null for a record that was retired.
   */
  function forSubmission(item) {
    var kind = item && SUBMISSION[item.status];
    return kind ? { kind: kind, word: WORDS[kind], detail: SUBMISSION_DETAIL[item.status] } : null;
  }

  /**
   * @description The status line of a job a person has applied to: the word, its day, and how Career knows. The word is Sent
   * when the person's computer reported it or Career holds the confirmation page, and Applied when the person marked it
   * themselves or nothing records how it was sent.
   * @param {object} job A job from GET /jobs: applied_at, application_source, confirmation_path.
   * @param {string} [locale] The language for the date.
   * @returns {{kind:'sent'|'applied', word:string, detail:string, day:string}} The line.
   */
  function forJob(job, locale) {
    var raw = job && typeof job.application_source === 'string' ? job.application_source : '';
    var source = Object.prototype.hasOwnProperty.call(SENT_DETAIL, raw) ? raw : 'unverified';
    // A confirmation is claimed only when its file is on record.
    if (source === 'verified-submission' && !String((job && job.confirmation_path) || '').trim()) source = 'unverified';
    var kind = SENT_SOURCES[source] === true ? 'sent' : 'applied';
    return { kind: kind, word: WORDS[kind], detail: SENT_DETAIL[source], day: day(job && job.applied_at, locale) };
  }

  /**
   * @description The one line a page shows when a job changes stage.
   * @param {'applied'|'saved'|'unsaved'|'preparing'|'removed'} kind The move.
   * @param {{title?:string, company?:string}} job The job that moved.
   * @param {Date|string} [at] When, for a move that carries its day (applied).
   * @param {string} [locale] The language for the date.
   * @returns {string} For example "Applied to Acme, November 10." or "Saved: Office Manager at Acme.".
   */
  function move(kind, job, at, locale) {
    var title = String((job && job.title) || '').trim(), company = String((job && job.company) || '').trim();
    if (kind === 'applied') {
      var on = day(at || new Date(), locale);
      return 'Applied' + (company ? ' to ' + company : title ? ': ' + title : '') + (on ? ', ' + on : '') + '.';
    }
    if (!MOVES[kind]) return '';
    var name = title && company ? title + ' at ' + company : title || company;
    return MOVES[kind] + (name ? ': ' + name : '') + '.';
  }

  function pressWords(item, press) {
    var at = press.allowedAt == null ? null : new Date(press.allowedAt);
    var time = at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    var start = 'Step ' + press.step + (press.step === 1 && item.pressesAllowed ? ' of up to ' + item.pressesAllowed : '');
    if (!press.result) return start + ' · Career was allowed to press “' + press.label + '”' + (time ? ' at ' + time : '') + ' and did not report back. Whether it was pressed is not known.';
    var site = ''; try { site = new URL(press.origin).hostname; } catch (_) {}
    var line = start + (time ? ' · ' + time : '') + ' · Career pressed “' + press.label + '”' + (press.kind === 'open' && site ? ' on ' + site : '') + '. ';
    if (press.result === 'advanced') return line + (press.kind === 'open' ? 'The application form opened.' : 'The form moved to its next page.');
    if (press.result === 'confirmed') return line + (item.confirmationText ? 'The employer showed: “' + item.confirmationText + '”.' : 'The employer showed a confirmation page.');
    if (press.result === 'left_site') return line + 'The page tried to go to another site, which Career blocked. Career stopped.';
    return line + 'The page did not move on in 10 seconds. Career stopped and pressed nothing else.';
  }
  function pressHistory(item) {
    var escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return (item && item.presses || []).map(press => {
      var kept = (item.pressPictures || []).some(picture => picture.step === press.step);
      var image = kept ? '<img style="max-width:100%" loading="lazy" src="/api/career-hunter/submission-queue/' + encodeURIComponent(item.id || item.submissionId) + '/press-picture/' + encodeURIComponent(press.step) + '" alt="Picture after step ' + escape(press.step) + '">' : '<p>No picture was kept for this step.</p>';
      return '<figure class="press-step"><p>' + escape(pressWords(item, press)) + '</p>' + image + '</figure>';
    }).join('');
  }

  var exported = { pressWords: pressWords, pressHistory: pressHistory, WORDS: WORDS, when: when, day: day, forSubmission: forSubmission, forJob: forJob, move: move };
  if (root) root.CareerStatusLine = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : null);
