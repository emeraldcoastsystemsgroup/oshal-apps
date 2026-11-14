/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prepare application opens the application inside an application group (Roger, 2026-11-14, in Intelligent Career: "The application did not open. Use Open application to try again."). The shipped tools/career-job-actions.js runs against the Career screens the real intelligent-career/oshal-app.yaml lists, named as the kernel names a group's member screens (`<app>--<screen>`): the screen it asks the shell for is one the group registered. Before 1.61.3 it asked for the bare `career-board`, which a group does not have, the shell ignored it and the page's 10 s wait ended in that message on every press.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ACTIONS = read('../tools/career-job-actions.js');

/** The Career screens the Intelligent Career group borrows, read from the group's own manifest. */
function groupSurfaces() {
  const toolbar = read('../../intelligent-career/oshal-app.yaml').split(/^toolbar:\s*$/m)[1].split(/^\S/m)[0];
  return [...toolbar.matchAll(/-\s*\{\s*app:\s*career-hunter,\s*surface:\s*([\w-]+)/g)].map((match) => match[1]);
}

/**
 * @description The page's own actions in a frame whose shell registered `views` (the rail's data-view values).
 * @param {string[]} views Registered view ids, as the shell's rail carries them.
 * @returns {{actions: object, posted: object[], leave: () => void}} The actions, what they posted, and the page leaving.
 */
function framed(views) {
  const posted = [], listeners = {};
  const parent = { document: { querySelectorAll: () => views.map((view) => ({ getAttribute: () => view })) }, postMessage: (message) => posted.push(message) };
  const window = { parent, location: { href: 'https://career.example.test/api/career-hunter/board-native', origin: 'https://career.example.test' },
    addEventListener: (name, listener) => { listeners[name] = listener; }, removeEventListener: () => {} };
  vm.runInNewContext(ACTIONS, { window, URL, URLSearchParams, setTimeout, clearTimeout });
  return { actions: window.CareerJobActions, posted, leave: () => listeners.pagehide?.() };
}

test('the Intelligent Career group still borrows the Job Board, the screen an application opens on', () => {
  const surfaces = groupSurfaces();
  assert.ok(surfaces.includes('career-board'), 'the group lists career-board: ' + surfaces.join(', '));
  assert.ok(!surfaces.includes('career-submissions') && !surfaces.includes('career-application-status'),
    'Prepare & submit and Application status are stages of the Job Board, not screens of their own');
});

test('in an application group, Prepare application asks the shell for the Job Board the group registered', async () => {
  const views = groupSurfaces().map((surface) => 'tool-career-hunter--' + surface);
  const { actions, posted, leave } = framed(views);
  const opening = actions.openApplication(81, false, undefined, { wait: true });
  assert.equal(posted.length, 1, 'one request to the shell');
  assert.ok(views.includes('tool-' + posted[0].tool), `the shell has no screen named ${posted[0].tool}, so nothing would open`);
  assert.deepEqual({ ...posted[0] }, { type: 'app-navigate', tool: 'career-hunter--career-board', query: 'view=queue&application=81' });
  leave();
  await opening;
});

test('in an application group, an applied job, a reply and the approvals link open on the same registered Job Board', () => {
  const views = groupSurfaces().map((surface) => 'tool-career-hunter--' + surface);
  const { actions, posted } = framed(views);
  actions.openApplication(82, true);
  actions.openApplication(83, false, 'documents');
  actions.navigate('career-approvals', '/api/career-hunter/approvals');
  assert.deepEqual(posted.map((message) => message.tool), Array(3).fill('career-hunter--career-board'));
  assert.deepEqual(posted.map((message) => message.query), ['view=status&application=82', 'view=queue&application=83&step=documents', 'view=approve']);
});

test('in Career opened as its own application the short name is sent, as before', () => {
  const { actions, posted } = framed(['tool-career-home', 'tool-career-board', 'tool-career-resume-studio']);
  actions.openApplication(81, false);
  actions.navigate('career-resume-studio', '/api/career-hunter/resume-studio?posting=81');
  assert.deepEqual(posted.map((message) => [message.tool, message.query]), [['career-board', 'view=queue&application=81'], ['career-resume-studio', 'posting=81']]);
});

test('a screen that is not merged keeps its own member name in a group', () => {
  const views = groupSurfaces().map((surface) => 'tool-career-hunter--' + surface);
  const { actions, posted } = framed(views);
  actions.navigate('career-resume-studio', '/api/career-hunter/resume-studio');
  assert.equal(posted[0].tool, 'career-hunter--career-resume-studio');
});
