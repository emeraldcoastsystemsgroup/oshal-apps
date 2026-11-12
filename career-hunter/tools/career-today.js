/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career's home is the day of someone looking for a job (Roger, 2026-11-11: "it's about building the day in the life of someone who is looking for a job"). This file turns what Career, the inbox check, Portrait Studio and Social already know into the day's steps, in the order a day goes: read your replies, review new matches, send what is ready, follow up, prepare for interviews, be seen, get stronger. A step exists only when there is something to do, each has one button, and a person with no résumé gets three numbered steps and nothing else. An independent judge scored Career's earlier home below Little Monsters because it showed counts and no next step.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 6: To approve is no longer a stage, so the step that sent a person there follows. The jobs Career picked lead Saved, and the step says so in those words ("2 jobs Career picked are waiting for you", See Career's picks) and opens Saved. Its id and its place in the day are unchanged. It reads counts.approve only: the home summary's approval-review also counts picks the person has since prepared, and a step that opened a list with none of them in it would be a dead end.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.55.0: the photo step's button reads Add a photo (was Open Portrait Studio). Career's bar calls that page Photo, and the button says what the person does there; the page it opens is unchanged.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 1: the step about Career's picks opens ?view=approve (was ?view=saved). The Job Board puts a person's remembered filters back on a plain visit to Saved, and a remembered search could hide the very picks this step had counted; ?view=approve is the picks address, which the page treats as explicit and restores nothing over. Guard: tests/career-today.test.mjs, tests/career-applications-section.test.mjs.
 */
(function (root) {
  'use strict';

  var DAY = 86400000;
  var REPLY_WORDS = { offer: 'Offer', interview: 'Interview reply', acknowledged: 'Application received', rejected: 'Not selected' };
  var REPLY_RANK = { offer: 0, interview: 1, acknowledged: 2, rejected: 3 };

  function count(value) { var n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); }
  function metric(summary, id) {
    var list = summary && Array.isArray(summary.metrics) ? summary.metrics : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return count(list[i].value);
    return 0;
  }
  function time(value) { var t = Date.parse(value); return Number.isFinite(t) ? t : NaN; }

  /**
   * @description The replies an employer sent in the last seven days, most important first, then newest.
   * @param {object|null} updates The /jobs/updates answer.
   * @param {number} now Milliseconds.
   * @returns {Array<object>} Events with a `words` label added.
   */
  function recentReplies(updates, now) {
    var events = updates && Array.isArray(updates.events) ? updates.events : [];
    return events.filter(function (event) { var at = time(event && event.date); return event && REPLY_WORDS[event.kind] && at <= now && now - at <= 7 * DAY; })
      .map(function (event) { return Object.assign({}, event, { words: REPLY_WORDS[event.kind] }); })
      .sort(function (a, b) { return REPLY_RANK[a.kind] - REPLY_RANK[b.kind] || time(b.date) - time(a.date); });
  }

  /**
   * @description Applications sent more than a week ago that no employer has answered.
   * @param {Array<object>} applied Jobs in the Applied stage, each with `applied_at` and `emailUpdates`.
   * @param {number} now Milliseconds.
   * @returns {Array<object>} The silent ones.
   */
  function silentApplications(applied, now) {
    return (Array.isArray(applied) ? applied : []).filter(function (job) {
      var at = time(job && job.applied_at);
      return Number.isFinite(at) && now - at > 7 * DAY && !(Array.isArray(job.emailUpdates) && job.emailUpdates.length);
    });
  }

  /** @description Recruiters whose follow-up date is today or earlier. */
  function dueRecruiters(recruiters, now) {
    var today = new Date(now).toISOString().slice(0, 10);
    return (Array.isArray(recruiters) ? recruiters : []).filter(function (r) { return r && r.followup_date && String(r.followup_date).slice(0, 10) <= today; });
  }

  function replyStep(input, now) {
    var updates = input.updates, replies = recentReplies(updates, now);
    if (replies.length) {
      var first = replies[0], open = first.postingId ? { view: 'board', query: 'application=' + first.postingId } : null;
      return { id: 'replies', kind: 'mail', title: plural(replies.length, 'reply', 'replies') + ' from employers this week',
        lines: replies.slice(0, 3).map(function (r) { return { text: r.words + ': ' + String(r.subject || '').slice(0, 90), posting: r.postingId || null, review: Boolean(r.needsReview) }; }),
        action: open ? Object.assign({ label: 'Open the newest' }, open) : { label: 'See applications', view: 'board', query: 'view=status' } };
    }
    var sent = count(input.stats && input.stats.applied) + count(input.stats && input.stats.tracked);
    if (!updates || !sent) return null;
    if (updates.status === 'unavailable') return { id: 'replies-broken', kind: 'mail', title: 'Career cannot read your inbox for replies', detail: String(updates.error || 'Open Settings to reconnect your mailbox.'), action: { label: 'Fix it in Settings', view: 'settings' } };
    if (updates.status === 'not-checked') return { id: 'replies-off', kind: 'mail', title: 'Have Career watch for replies', detail: 'It checks your inbox for answers to your applications and files each one against its job.', action: { label: 'Turn it on', view: 'settings' } };
    return null;
  }

  function followSteps(input, now) {
    var steps = [], due = dueRecruiters(input.recruiters, now), silent = silentApplications(input.applied, now);
    if (due.length) steps.push({ id: 'recruiters', kind: 'people', title: plural(due.length, 'recruiter follow-up is', 'recruiter follow-ups are') + ' due',
      detail: due.slice(0, 3).map(function (r) { return r.firm; }).filter(Boolean).join(', '), action: { label: 'Open Recruiters', view: 'recruiters' } });
    if (silent.length) steps.push({ id: 'silent', kind: 'clock', title: plural(silent.length, 'application has', 'applications have') + ' had no reply for a week',
      detail: silent.slice(0, 3).map(function (j) { return j.company; }).filter(Boolean).join(', '), action: { label: 'See them', view: 'board', query: 'view=status' } });
    return steps;
  }

  function presenceStep(input) {
    var portrait = input.portrait && input.portrait.portrait, plan = input.plan && input.plan.plan, drafts = input.drafts && Array.isArray(input.drafts.drafts) ? input.drafts.drafts.length : 0;
    if (portrait && portrait.ready === false) return { id: 'portrait', kind: 'person', title: 'Add a professional portrait', detail: 'Recruiters look at the photo first. Take one or upload one, and pick a style.', action: { label: 'Add a photo', view: 'portrait-studio' } };
    if (plan && plan.state === 'draft') return { id: 'profile', kind: 'person', title: 'Your LinkedIn profile is written and waiting for you', detail: 'Read it, change what you like, then approve it.', action: { label: 'Review it', view: 'profile-studio' } };
    if (drafts) return { id: 'posts', kind: 'person', title: plural(drafts, 'post draft is', 'post drafts are') + ' waiting', detail: 'Posting about your field keeps you in front of the people who hire.', action: { label: 'Open your drafts', view: 'social-workspace' } };
    return null;
  }

  function strongerStep(input) {
    var r = input.readiness || {};
    if (r.stories && r.stories.ready === false) return { id: 'stories', kind: 'spark', title: 'Tell the story of each role', detail: String(r.stories.detail || ''), action: { label: 'Start', view: 'strengthen' } };
    if (r.materials && r.materials.ready === false) return { id: 'materials', kind: 'spark', title: 'Add work that is not on your résumé', detail: String(r.materials.detail || ''), action: { label: 'Add it', view: 'experience-library' } };
    return null;
  }

  /** @description The three numbered steps of a person who has not added a résumé yet. */
  function firstRun() {
    return [
      { id: 'resume', kind: 'doc', first: true, number: 1, title: 'Add your résumé', detail: 'Career reads it once. Everything else starts from it.', action: { label: 'Add your résumé', view: 'resume-studio' } },
      { id: 'want', kind: 'target', number: 2, title: 'Say what you want', detail: 'Job titles, place and pay.', action: { label: 'Set it', view: 'settings' } },
      { id: 'matches', kind: 'star', number: 3, title: 'See your matches', detail: 'Career ranks every opening for you, and prepares each application with you.', action: { label: 'Search jobs now', view: 'search' } },
    ];
  }

  /**
   * @description The day's steps, in the order a day goes. A step is present only when there is something to do.
   * @param {object} input What the page read: resume, stats, summary, counts, updates, applied, recruiters, portrait, plan, drafts, readiness.
   * @param {number} now Milliseconds.
   * @param {Array<string>} [views] The views this person can open; a step that opens another is left out.
   * @returns {{firstRun:boolean, steps:Array<object>}} The plan.
   */
  function plan(input, now, views) {
    var data = input || {}, resume = data.resume;
    var allowed = function (step) { return step && (!views || !step.action || !step.action.view || views.indexOf(step.action.view) !== -1); };
    if (resume && resume.hasResume === false && !resume.indexing && !resume.building) return { firstRun: true, steps: firstRun().filter(allowed) };
    // counts.approve is the number of Career's picks the person can still act on (CareerStages.picks). The home summary's
    // approval-review also counts picks they have since prepared, so it is not a fallback: the step would open a list with none.
    // The step opens ?view=approve, the picks address: the Job Board puts back no remembered filter over an address that names what to show.
    var steps = [], fresh = metric(data.summary, 'scored-24h'), approve = count(data.counts && data.counts.approve);
    var interviews = count(data.stats && data.stats.interviewing) || count(data.counts && data.counts.interview);
    steps.push(replyStep(data, now));
    if (fresh) steps.push({ id: 'matches', kind: 'star', title: plural(fresh, 'job was', 'jobs were') + ' scored for you since yesterday', detail: 'Save the ones worth a closer look and pass on the rest.', action: { label: 'Review them', view: 'board', query: 'view=matches' } });
    if (approve) steps.push({ id: 'approve', kind: 'send', title: plural(approve, 'job Career picked is', 'jobs Career picked are') + ' waiting for you', detail: 'Prepare the ones you want to apply to and remove the rest. Nothing is sent until you say so.', action: { label: 'See Career\'s picks', view: 'board', query: 'view=approve' } });
    steps = steps.concat(followSteps(data, now));
    if (interviews) steps.push({ id: 'interviews', kind: 'talk', title: plural(interviews, 'interview is', 'interviews are') + ' in progress', detail: 'Go over the role, the company and your stories before you talk.', action: { label: 'Prepare', view: 'board', query: 'view=interviewing' } });
    steps.push(presenceStep(data), strongerStep(data));
    steps = steps.filter(allowed).slice(0, 6);
    if (steps.length) steps[0].first = true;
    return { firstRun: false, steps: steps };
  }

  /**
   * @description This week in three numbers a job seeker counts by: sent, answered, interviews.
   * @param {object} input The same input as plan().
   * @param {number} now Milliseconds.
   * @returns {{applied:number, replies:number, interviews:number}} The week.
   */
  function week(input, now) {
    var data = input || {}, events = data.updates && Array.isArray(data.updates.events) ? data.updates.events : [];
    var inWeek = function (value) { var at = time(value); return Number.isFinite(at) && at <= now && now - at <= 7 * DAY; };
    return {
      applied: (Array.isArray(data.applied) ? data.applied : []).filter(function (job) { return inWeek(job && job.applied_at); }).length,
      replies: events.filter(function (event) { return event && inWeek(event.date); }).length,
      interviews: events.filter(function (event) { return event && event.kind === 'interview' && inWeek(event.date); }).length,
    };
  }

  var exported = { plan: plan, week: week, recentReplies: recentReplies, silentApplications: silentApplications, dueRecruiters: dueRecruiters, firstRun: firstRun };
  if (root) root.CareerToday = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : null);
