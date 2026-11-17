/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4 (Roger, 2026-11-16: "the job location doesnt transfer to the my jobs page and i cant look at jobs near me"): the words for where a job is, one source for My jobs' list and any other view of the same jobs (the table @lane-careerbulk1 adds). From the fields GET /jobs gives every job (location, workplaceType, distanceMiles): the posting's place or "Location unknown", Fully remote / Hybrid / On-site when the posting says so, and the straight-line miles from the person's home. And the one line a page shows when Career does not know the person's home, with the way to set it.
 */
(function (root) {
  'use strict';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** How a job is worked, in the words a person reads. */
  const WORK = { remote: 'Fully remote', hybrid: 'Hybrid', onsite: 'On-site' };

  /**
   * @description Miles as a person reads them: one decimal at most, "mi" after.
   * @param {number} miles Straight-line miles.
   * @returns {string} For example "24.9 mi" or "3 mi".
   */
  function miles(miles) {
    return (Math.round(miles * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' mi';
  }

  /**
   * @description The parts of a job's place line, in order: the posting's place (or "Location unknown" when it names none
   *   and is not fully remote), how the job is worked when the posting says so, and the miles from home when Career knows
   *   both points. An answer from before these fields (no workplaceType) still says Fully remote from its `remote`.
   * @param {{location?: string|null, remote?: number|boolean, workplaceType?: string|null, distanceMiles?: number|null}} job A job.
   * @returns {Array<{kind: 'place'|'work'|'distance', text: string}>} The parts.
   */
  function parts(job) {
    const out = [];
    const remote = job.workplaceType === 'remote' || (job.workplaceType === undefined && Boolean(job.remote));
    const text = typeof job.location === 'string' ? job.location.trim() : '';
    if (text) out.push({ kind: 'place', text });
    else if (!remote) out.push({ kind: 'place', text: 'Location unknown' });
    const work = WORK[job.workplaceType] || (remote ? WORK.remote : '');
    if (work) out.push({ kind: 'work', text: work });
    if (typeof job.distanceMiles === 'number' && Number.isFinite(job.distanceMiles)) {
      out.push({ kind: 'distance', text: miles(job.distanceMiles) + ' from home' });
    }
    return out;
  }

  /**
   * @description The place line as spans for a row's facts (`.meta`), each marked by its kind.
   * @param {object} job A job. @returns {string} Markup, escaped.
   */
  function meta(job) {
    return parts(job).map((part) => `<span class="job-${part.kind}">${esc(part.text)}</span>`).join('');
  }

  /**
   * @description The place line as one text, for a table cell or a screen reader label.
   * @param {object} job A job. @returns {string} For example "Redmond, OR · On-site · 24.9 mi from home".
   */
  function line(job) {
    return parts(job).map((part) => part.text).join(' · ');
  }

  /**
   * @description The line a page shows when Career does not know the person's home: what it means and where to set it.
   *   Nothing when the home is known or the answer said nothing about it.
   * @param {{known: boolean, line: string, settingsUrl: string}|null|undefined} home GET /jobs `home`.
   * @returns {string} Markup, escaped, or ''.
   */
  function homeLine(home) {
    if (!home || home.known) return '';
    return `<span>${esc(home.line)}</span> <a class="home-link" href="${esc(home.settingsUrl)}" data-career-tool="career-settings">Set your home</a>`;
  }

  root.CareerJobPlace = { parts, meta, line, homeLine, miles };
}(window));
