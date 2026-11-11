/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The words a judge asked Career to retire stay retired (report 2026-11-11, changes 1 and 5). Over the pages and scripts a route serves, with their comments left out: no line names the vendor's own project or one person's field as an example; saving a job is Save, Saved and Unsave, never a star or a shortlist; résumé is never written without its accents outside the screen named Resume Studio; and the stage names are the ones career-stages.js defines (Getting ready, Closed, Removed, Needs your answer). tools/career-board.html is served by no route (routes/career-surface-routes.js) and is not read here; the home page, the frame and the Companies page are held by their own tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
/** Files this sweep does not own: an unserved page, pages another change holds, and vendored code. */
const SKIP = new Set(['career-board.html', 'career-home.html', 'career-frame.js', 'career-today.js', 'career-companies.html', 'career-leaflet.js']);
const files = readdirSync(tools).filter((name) => /\.(html|js)$/.test(name) && !SKIP.has(name));
/** A file as a person can meet it: change logs and other comments are not on any screen. */
const shown = (name) => readFileSync(join(tools, name), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // The AI Office document Career links a person's master résumé to is found by this stored title, so it cannot change.
  .replace("const TITLE = 'Master resume (Career)';", '');

test('the sweep reads every served page and script', () => {
  assert.ok(files.length >= 25, `only ${files.length} files found under tools/`);
  for (const name of ['career-search.html', 'career-job-lists.js', 'career-approvals.html', 'career-settings.html', 'career-mobile.html']) assert.ok(files.includes(name), name);
});

test('no line names the vendor\'s project or one person\'s field', () => {
  const retired = [/Approve \+ OSHAL/, /\+OSHAL/, /default OSHAL LLM/, /OSHAL (?:product|runs|checks|never|adds|writes|fills)/, /Apply with OSHAL/, /\bSAP\b/, /Basis Administrator/, /Cleared \/ GovTech/, /GovTech/, /An operator recorded this status/, /operator bot/, /desktop browser worker/];
  for (const name of files) for (const phrase of retired) assert.doesNotMatch(shown(name), phrase, `${name} still says ${phrase}`);
});

test('saving a job has one word, and no star or shortlist is left', () => {
  const retired = [/Remove star/, /Star removed/, /Save to Job Board/, /Saved to (?:your )?Job Board/, /★ On your Job Board/, /shortlist/i, /★/];
  for (const name of files) for (const phrase of retired) assert.doesNotMatch(shown(name), phrase, `${name} still says ${phrase}`);
});

test('résumé is written with its accents wherever a person reads it', () => {
  // The words that used to be written without accents, as they appeared in text; the screen name Resume Studio is the
  // manifest's and the frame's to change, and identifiers, addresses and field names are not text.
  const retired = [/\b[Yy]our resume\b/, /\bmaster resume\b/i, /\bPick a resume\b/, /\bthis resume\b/, /\bselected resume\b/, /\btailored resumes?\b(?! and cover letter)/, /Resume Editor/, /Featured resume/, /Upload resume PDF/, /Open resume/, /their resume\b/, /Nightly resume/, /a resume first/, /Strengthen your resume/];
  for (const name of files) for (const phrase of retired) assert.doesNotMatch(shown(name), phrase, `${name} still says ${phrase}`);
});

test('the stages carry the names a job seeker reads', () => {
  globalThis.window = undefined;
  createRequire(import.meta.url)(join(tools, 'career-stages.js'));
  const { STAGES, MORE } = globalThis.CareerStages;
  assert.deepEqual(STAGES.map((stage) => [stage.id, stage.label]), [['matches', 'New matches'], ['saved', 'Saved'], ['approve', 'To approve'], ['preparing', 'Getting ready'], ['applied', 'Applied'], ['interviewing', 'Interviewing']]);
  assert.deepEqual(MORE.map((stage) => [stage.id, stage.label, stage.status]), [['offer', 'Offer', 'offer'], ['closed', 'Closed', 'rejected'], ['dismissed', 'Removed', 'dismissed'], ['generated', 'Document records', 'generated'], ['promoted', 'Queued for documents', 'promoted'], ['deferred', 'Needs your answer', 'deferred']]);
  // "Not selected" is still the word for a reply that turns an application down (the Job Board's reply line); the stage it lands in is Closed.
  for (const name of files) assert.doesNotMatch(shown(name), /'Preparing'|' · Not selected'|'Dismissed'|Dismissed\.|'Needs you'|Needs you —/, `${name} repeats a retired stage name`);
});
