/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.54.0: the bar's sections are a job search in a job seeker's words (Home, Find jobs, My jobs, Applications, Résumé, Profile & contacts), named in the frame; every other page is under More.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career as its own application: the page frame's arithmetic (which pages a profile gives, how they become sections, which one is showing, what the cockpit is asked for) and the guard that every Career page loads the frame once, inside its head, with its change log still a comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tools = resolve(here, '..', 'tools');
const frame = createRequire(import.meta.url)('../tools/career-frame.js');

const item = (id, label, group, section, href, toolName) => ({ id, label, group, section, toolUi: { iframeUrl: href, visibilityToolName: toolName } });
/** The Intelligent Career front door's profile, in the shape the kernel answers, with a few things that must be dropped. */
const GROUP = { ribbon: { items: [
  item('tool-career-hunter--career-home', 'Home', null, 'top', '/api/career-hunter/home', 'career-home'),
  item('tool-career-hunter--career-search', 'Search Jobs', 'Job Search', 'top', '/api/career-hunter/search-ui', 'career-search'),
  item('tool-career-hunter--career-board', 'Job Board', 'Job Search', 'top', '/api/career-hunter/board-native', 'career-board'),
  item('tool-career-hunter--career-recruiters', 'Recruiters', 'Connections', 'top', '/api/career-hunter/recruiters-ui', 'career-recruiters'),
  item('tool-career-hunter--career-insights', 'Insights', 'Review', 'top', '/api/career-hunter/insights-ui', 'career-insights'),
  item('tool-career-hunter--career-strengthen', 'Strengthen', 'Resume', 'top', '/api/career-hunter/strengthen-ui', 'career-strengthen'),
  item('tool-career-hunter--career-resume-studio', 'Resume Studio', 'Resume', 'top', '/api/career-hunter/resume-studio', 'career-resume-studio'),
  item('tool-career-hunter--career-profile-studio', 'Profile Studio', 'Presence', 'top', '/api/career-hunter/profile-studio', 'career-profile-studio'),
  item('tool-portrait-studio--portrait-studio', 'Portrait Studio', 'Presence', 'top', '/api/portrait-studio/app'),
  item('tool-career-hunter--career-submission-activity', 'Submission activity', 'Activity', 'top', '/api/career-hunter/submissions', 'career-submission-activity'),
  item('tool-social--social-accounts', 'Accounts', null, 'bottom', '/utilities'),
  item('tool-career-hunter--career-settings', 'Career Settings', 'Configuration', 'top', '/api/career-hunter/settings', 'career-settings'),
  'settings',
  item('tool-elsewhere', 'Elsewhere', null, 'top', '//elsewhere.example/x'),
  item('tool-script', 'Script', null, 'top', 'javascript:alert(1)'),
  { id: 'tool-no-page', label: 'No page' },
  item('view-tickets', 'Tickets', null, 'top', '/api/tickets'),
] } };

test('a page has one short name whichever profile lists it', () => {
  assert.equal(frame.viewOf('tool-career-search'), 'search');
  assert.equal(frame.viewOf('tool-career-hunter--career-search', 'career-search'), 'search');
  assert.equal(frame.viewOf('tool-career-portrait-studio'), 'portrait-studio');
  assert.equal(frame.viewOf('tool-portrait-studio--portrait-studio'), 'portrait-studio');
  assert.equal(frame.viewOf('tool-social--social-workspace'), 'social-workspace');
});

test('only the profile\'s own same-origin pages become links', () => {
  const entries = frame.navEntries(GROUP);
  assert.deepEqual(entries.map((entry) => entry.view), ['home', 'search', 'board', 'recruiters', 'insights', 'strengthen', 'resume-studio',
    'profile-studio', 'portrait-studio', 'submission-activity', 'social-accounts', 'settings']);
  assert.deepEqual(entries.filter((entry) => !entry.own).map((entry) => entry.view), ['portrait-studio', 'social-accounts'], 'another application\'s page is known as one');
  assert.deepEqual(frame.navEntries(null), []);
  assert.deepEqual(frame.navEntries({ ribbon: {} }), []);
});

test('the bar follows a job search in a job seeker\'s words, and everything else is under More', () => {
  const layout = frame.sections(frame.navEntries(GROUP));
  assert.deepEqual(layout.primary.map((part) => [part.label, part.lead.view, part.pages.map((page) => page.view)]), [
    ['Home', 'home', ['home']],
    ['Find jobs', 'search', ['search']],
    ['My jobs', 'board', ['board']],
    ['Applications', 'submission-activity', ['submission-activity']],
    ['Résumé', 'resume-studio', ['resume-studio', 'strengthen']],
    ['Profile & contacts', 'profile-studio', ['profile-studio', 'portrait-studio', 'recruiters']],
  ]);
  assert.deepEqual(layout.more.map((entry) => entry.view), ['insights', 'social-accounts', 'settings']);
});

test('a section shows only when the person can open one of its pages, and a tile the manifest adds later is under More', () => {
  const profile = { ribbon: { items: [
    item('tool-career-review', 'Career Review', null, 'top', '/api/career-hunter/review'),
    item('tool-career-new-thing', 'New thing', 'Later', 'top', '/api/career-hunter/new-thing'),
    item('tool-career-search', 'Search Jobs', 'Job Search', 'top', '/api/career-hunter/search-ui'),
  ] } };
  const layout = frame.sections(frame.navEntries(profile));
  assert.deepEqual(layout.primary.map((part) => part.label), ['Find jobs']);
  assert.deepEqual(layout.more.map((entry) => entry.view), ['review', 'new-thing'], 'nothing the profile lists is lost');
});

test('the page being shown is found by its address, its stage, or the screen it hosts', () => {
  const entries = frame.navEntries(GROUP), at = (path, search) => frame.activeEntry(entries, path, search)?.view ?? null;
  assert.equal(at('/api/career-hunter/search-ui', '?q=nurse'), 'search');
  assert.equal(at('/api/career-hunter/search-ui', '?view=matches'), 'board', 'recommendations are a stage of the board');
  assert.equal(at('/api/career-hunter/approvals', ''), 'board');
  assert.equal(at('/api/career-hunter/board-native/', '?view=saved'), 'board');
  assert.equal(at('/api/career-hunter/home', ''), 'home');
  assert.equal(at('/api/career-hunter/home', '?open=portrait-studio'), 'portrait-studio');
  assert.equal(at('/api/career-hunter/interview', ''), null);
});

test('the bar counts interviews when there are any, else saved jobs, else nothing', () => {
  assert.deepEqual(frame.stageChip({ saved: 7, interviewing: 0 }), { count: 7, label: 'saved', query: 'view=saved' });
  assert.deepEqual(frame.stageChip({ saved: 7, interviewing: 2 }), { count: 2, label: 'interviewing', query: 'view=interviewing' });
  assert.equal(frame.stageChip({ saved: 0 }), null);
  assert.equal(frame.stageChip(null), null);
});

test('a query for the cockpit is percent-encoded with no plus sign, and empty values are left out', () => {
  const query = frame.strictQuery([['q', 'program manager (remote)'], ['near', ''], ['title', "o'neil & co"]]);
  assert.equal(query, 'q=program%20manager%20%28remote%29&title=o%27neil%20%26%20co');
  assert.match(query, /^[A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*(?:&[A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*)*$/, 'the shape the cockpit passes on');
});

test('the cockpit\'s chrome is hidden only while it is showing a Career page', () => {
  const css = frame.hostStyle();
  const scope = 'body:has(.tool-view-container > iframe[src^="/api/career-hunter/"])';
  for (const rule of css.split('}').map((part) => part.trim()).filter(Boolean)) {
    // Commas inside :is(...) and :has(...) belong to one selector.
    for (const selector of rule.split('{')[0].split(/,(?![^()]*\))/)) assert.ok(selector.trim().startsWith(scope), selector.trim().slice(0, 80));
  }
  for (const part of ['.header-bar', '#ribbonContainer', '.status-bar', '.chat-panel', '.tool-view-header']) assert.ok(css.includes(scope + ' ' + part), part);
  assert.equal(css.includes('zen-mode'), false, 'no class is left on the cockpit that would outlive the Career page');
  assert.equal(/jarvis|orb/i.test(css), false, 'the floating assistant stays');
});

test('a name is the person\'s first name, from either shape the kernel answers', () => {
  assert.equal(frame.firstName({ displayName: 'Ada Lovelace' }), 'Ada');
  assert.equal(frame.firstName({ user: { name: 'Grace Hopper' } }), 'Grace');
  assert.equal(frame.firstName(null), '');
});

test('the shipped routes serve the home page, uncached, and it is bound to app.open', () => {
  const { modules } = loadCompiledModules({ surface: 'routes/career-surface-routes.js' });
  const routes = new Map();
  modules.surface.registerCareerSurfaceRoutes({ get: (route, handler) => routes.set(route, handler) });
  let file, cache;
  routes.get('/home')({ query: {} }, { setHeader: (name, value) => { if (name === 'Cache-Control') cache = value; }, sendFile: (value) => { file = value; } });
  assert.ok(file.endsWith(join('tools', 'career-home.html')));
  assert.match(cache, /no-store/);
  const catalog = readFileSync(resolve(here, '..', 'authorization.yaml'), 'utf8');
  assert.match(catalog, /- \{ id: home-ui, method: GET, path: \/home, allOf: \[app\.open\] \}/);
  assert.match(readFileSync(resolve(here, '..', 'src-routes', 'career-surface-routes.ts'), 'utf8'), /router\.get\('\/home', createCareerToolFileHandler\('career-home\.html'\)\)/);
});

/** Career's phone app has its own complete shell and bottom bar; it is not a tile and is opened by its own address. */
const OWN_SHELL = ['career-mobile.html'];

test('every Career page loads the frame once, in its head, after its theme, and keeps its change log a comment', () => {
  const pages = readdirSync(tools).filter((file) => file.endsWith('.html'));
  assert.ok(pages.length >= 18);
  for (const file of pages) {
    const html = readFileSync(join(tools, file), 'utf8'), head = html.slice(0, html.indexOf('</head>'));
    const scripts = html.split('src="/api/career-hunter/static/career-frame.js"').length - 1;
    if (OWN_SHELL.includes(file)) { assert.equal(scripts, 0, file); continue; }
    assert.equal(scripts, 1, `${file} loads the frame once`);
    assert.ok(head.includes('src="/api/career-hunter/static/career-frame.js"'), `${file} loads it in its head`);
    assert.ok(head.includes('href="/api/career-hunter/static/career-frame.css"'), `${file} loads the frame's stylesheet in its head`);
    assert.equal(/<script[^>]*career-frame\.js[^>]*\b(defer|async)\b/.test(html), false, `${file} runs the frame before first paint, so the skin never flashes`);
    assert.match(html, /<html\b[^>]*\bdata-career-surface=/, `${file} names its surface`);
    const body = html.slice(html.search(/<body\b/));
    assert.equal(/\d+ \| maintainer@emeraldcoastsystemsgroup\.com \|/.test(body.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')), false, `${file} shows no change-log line as text`);
    const uncommented = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.equal(uncommented.slice(0, uncommented.search(/<html\b/)).replace(/<!doctype html>/i, '').trim(), '', `${file} has only comments before <html>`);
  }
});
