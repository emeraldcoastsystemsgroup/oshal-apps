/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.65.0 (Roger, production 2026-11-14: "Preparation needs attention: The PDF renderer is unavailable. Please check Settings.. Your saved notes, selections and previous documents are retained."). The shipped tools/career-job-actions.js and tools/career-application.js run together over one failed preparation: the missing-renderer notice names no page and says what the person can do, and the application page ends every message with exactly one full stop before "Your saved notes", whether the message brought its own stop, none or two. No page adds a full stop of its own after a message, so the Job Board's two lines stay as they are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ACTIONS = read('../tools/career-job-actions.js');
const PAGE = read('../tools/career-application.js');
const KEPT = 'Your saved notes, selections and previous documents are retained.';

/** A job whose document preparation failed for `reason`, as the job route answers it. */
const failed = (reason) => ({ id: 81, title: 'Office Manager', company: 'Example Co', location: 'Austin, TX', status: 'promoted',
  url: 'https://jobs.example.com/apply/81', has_resume: false, has_cover: false, board: { phase: 'failed', error: reason },
  application: { failed: true, needsGeneration: true, draft: { revision: 1, guidance: '', experienceIds: [] } } });

/** The least of a page element the application page touches before and while it draws. */
const element = () => ({ innerHTML: '', textContent: '', className: '', setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });

/**
 * @description The shipped application page, opened on one job over fixture answers, with the shipped actions beside it.
 * @param {object} job The job the page reads.
 * @param {(reason: string) => string} [words] Stands in for the actions' message table, to give the page a message of any ending.
 * @returns {Promise<{html: string, message: (reason: string) => string}>} What the page drew, and the shipped message table.
 */
async function opened(job, words) {
  const root = element(), line = element();
  const answers = { '/api/career-hunter/jobs/81': { job }, '/api/career-hunter/experience-bank': { entries: [], revision: 1 }, '/api/career-hunter/resume/state': { hasResume: true } };
  const context = vm.createContext({ URL, URLSearchParams, setTimeout, clearTimeout,
    location: { search: '?application=81', pathname: '/api/career-hunter/board-native' }, history: { replaceState() {} },
    document: { title: '', getElementById: (id) => ({ application: root, message: line })[id] || null, querySelectorAll: () => [] },
    addEventListener() {},
    fetch: async (url) => ({ ok: url in answers, status: url in answers ? 200 : 404, json: async () => answers[url] || {} }) });
  context.window = context;
  vm.runInContext(ACTIONS, context);
  const message = context.CareerJobActions.message;
  if (words) context.CareerJobActions.message = words;
  vm.runInContext(PAGE, context);
  for (let turn = 0; turn < 50 && !root.innerHTML; turn++) await new Promise((resolve) => setImmediate(resolve));
  return { html: root.innerHTML, message };
}

/** The failed-preparation notice's words on the drawn page. */
function notice(html) {
  const found = html.match(/<div class="notice error">([^<]*)<\/div>/);
  assert.ok(found, 'the page shows the failed-preparation notice: ' + html.slice(0, 300));
  return found[1];
}

test('with no PDF renderer on the server, the notice says what is true and names no page', async () => {
  const { html, message } = await opened(failed('renderer_unavailable'));
  const words = notice(html);
  assert.doesNotMatch(words, /\.\./, words);
  assert.doesNotMatch(words, /Settings/, 'Career\'s Settings page has nothing about PDF documents: ' + words);
  assert.match(words, /^Preparation needs attention: This server cannot make PDF documents right now\. /, words);
  assert.match(words, /tell whoever runs it/, 'the notice says what the person can do: ' + words);
  assert.ok(words.endsWith('it is fixed. ' + KEPT), 'one full stop before the kept-work sentence: ' + words);
  assert.doesNotMatch(message('renderer_unavailable'), /Settings/);
  assert.match(message('renderer_unavailable'), /[^.]\.$/, 'the message ends with its own single full stop, as the Job Board prints it');
});

test('every other failed preparation reads with exactly one full stop before "Your saved notes"', async () => {
  for (const reason of ['resume_required', 'score_unavailable', 'job_details_unavailable', 'preparation_failed', 'a_reason_nobody_listed']) {
    const { html, message } = await opened(failed(reason));
    const words = notice(html), own = message(reason);
    assert.match(own, /[^.]\.$/, reason + ' ends with one full stop of its own: ' + own);
    assert.equal(words, 'Preparation needs attention: ' + own + ' ' + KEPT, reason);
    assert.doesNotMatch(words, /\.\./, reason + ': ' + words);
  }
});

test('the page ends the message once whatever the message ends with', async () => {
  for (const [given, shown] of [['Words with no stop', 'Words with no stop.'], ['Words with one stop.', 'Words with one stop.'],
    ['Words with two stops..', 'Words with two stops.'], ['Words with a space after. ', 'Words with a space after.'], ['Is this a question?', 'Is this a question?']]) {
    const { html } = await opened(failed('anything'), () => given);
    assert.equal(notice(html), 'Preparation needs attention: ' + shown + ' ' + KEPT, JSON.stringify(given));
  }
});

test('no Career page adds a full stop of its own after a message', () => {
  const tools = new URL('../tools/', import.meta.url);
  const adds = [/CareerJobActions\.message\([^()]*\)\)*\}\.(?!\w)/, /CareerJobActions\.message\([^()]*\)\)*\s*\+\s*'\.'/];
  const pages = readdirSync(tools).filter((name) => /\.(js|html)$/.test(name));
  const shows = pages.filter((name) => readFileSync(new URL(name, tools), 'utf8').includes('CareerJobActions.message('));
  assert.ok(shows.includes('career-application.js') && shows.includes('career-board.html'), 'the pages that show a message: ' + shows.join(', '));
  for (const name of shows) {
    const source = readFileSync(new URL(name, tools), 'utf8');
    for (const pattern of adds) assert.doesNotMatch(source, pattern, name + ' prints a second full stop after a message that already ends with one');
  }
});
