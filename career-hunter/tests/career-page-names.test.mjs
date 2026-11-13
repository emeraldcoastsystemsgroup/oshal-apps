/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One name for each Career page, in a job seeker's words (judge's report 2026-11-11, changes 4, 12, 13 and 14). The bar already read Home, Find jobs, My jobs, Applications, Résumé, Profile & contacts and More, while the pages under it, their titles and headings and the entries under More still said Search Jobs, Job Board, Resume Studio, Additional experience, Strengthen, Profile Studio, Career Settings, Master record and Insights. This holds the names together: the manifest's label, the page's title and its heading agree for every page a tile opens, the résumé every application starts from is the main résumé, and no page, script, answer, tool description or persona line a person can meet carries a retired name. Ids, tool names, addresses, routes and file names are not names a person reads and did not change.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Retire core résumé in served words while preserving the stored Office lookup title and backend identities.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.55.0: the page that was Improve it is Improve my résumé. "Improve it" reads well under the Résumé section of Career's own bar and says nothing by itself, and the workspace group's toolbar and the cockpit's main menu list the tile by its label alone. The manifest's label, the page's title and its heading are the full name; Career's own bar still says Improve it there, the way it says Photo for Portrait Studio's page; and no other page, script, answer or line for the assistant uses the short form.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, 'tools');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(root, '../../oshal/src'));
const toolchain = [process.env.STORE_CI_TOOLCHAIN, resolve(root, '../scripts/toolchain/node_modules'), resolve(core, 'node_modules')]
  .filter(Boolean).find((directory) => existsSync(resolve(directory, 'js-yaml/package.json')));
if (!toolchain) throw new Error('js-yaml requires scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const yaml = createRequire(resolve(toolchain, 'js-yaml/package.json'))('./index.js');
const manifest = yaml.load(readFileSync(join(root, 'oshal-app.yaml'), 'utf8'));

/**
 * Every page a tile opens: the tile, the name a person reads, and the file a route serves for it. `title` and
 * `heading` are given only where they are deliberately not the name: Home is titled with the application's name and
 * greets the person, and Companies (an administrator's page) says so in both.
 */
const PAGES = [
  { tool: 'career-home', name: 'Home', file: 'career-home.html', title: 'Intelligent Career', heading: 'Welcome back.' },
  { tool: 'career-review', name: 'Career Review', file: 'review.html' },
  { tool: 'career-search', name: 'Find jobs', file: 'career-search.html' },
  { tool: 'career-board', name: 'My jobs', file: 'career-job-lists.html' },
  { tool: 'career-submission-activity', name: 'Submission activity', file: 'career-submissions.html' },
  { tool: 'career-recruiters', name: 'Recruiters', file: 'career-recruiters.html' },
  { tool: 'career-insights', name: 'Job market', file: 'career-insights.html' },
  { tool: 'career-strengthen', name: 'Improve my résumé', file: 'career-strengthen.html' },
  { tool: 'career-resume-studio', name: 'My résumé', file: 'career-resume-studio.html' },
  { tool: 'career-experience-library', name: 'Other experience', file: 'career-experience-bank.html' },
  { tool: 'career-master-record', name: 'Download my data', file: 'career-master-record.html' },
  { tool: 'career-profile-studio', name: 'LinkedIn profile', file: 'career-profile-studio.html' },
  { tool: 'career-companies', name: 'Companies', file: 'career-companies.html', title: 'Companies — Admin', heading: 'Companies · admin' },
  { tool: 'career-settings', name: 'Settings', file: 'career-settings.html' },
];
/** The names the judge's table retired, as a person met them. */
const RETIRED_NAMES = ['Search Jobs', 'Job Board', 'Resume Studio', 'Additional experience', 'Strengthen', 'Profile Studio', 'Career Settings', 'Master record', 'Insights'];

const blank = (text) => text.replace(/[^\n]/g, ' ');
/** A page or script as a person can meet it: change logs and other comments are on no screen. Line numbers are kept. */
const withoutComments = (text) => text.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank).replace(/\s\/\/ .*$/gm, blank);
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * A retired name as it stands in text. A word that is also part of an identifier (Strengthen, Insights) counts only
 * when it stands alone, so `registerCareerStrengthenRoutes` and `InsightsNotReady` are not a person's words.
 */
const alone = (word) => new RegExp(`(?<![A-Za-z0-9_$.\\-/])${word}(?![A-Za-z0-9_(\\-])`);
// "Additional Experience" in capitals is the heading of that section inside a résumé document, which goes to an employer
// as written; the page and what it holds are "other experience".
const RETIRED = [/Search Jobs/, /Job Board/, /R[eé]sum[eé] Studio/, /[Aa]dditional experience/, alone('Strengthen'), /Profile Studio/, /Career Settings/,
  /[Mm]aster record/, alone('Insights')];
/** The old word for the main résumé as a person met it; `master` as a value or a name in code is not a person's word. */
const MASTER_RESUME = [/core r[eé]sum[eé]/i,/master r[eé]sum[eé]/i, /(?<![A-Za-z0-9_'"=./-])MASTER(?![A-Za-z0-9_'"])/, / \(master\)/];

/** @returns {Array<string>} `file:line: text` for every line of `text` a pattern matches. */
function hits(label, text, patterns) {
  const found = [];
  text.split('\n').forEach((line, index) => { for (const pattern of patterns) if (pattern.test(line)) { found.push(`${label}:${index + 1}: ${line.trim().slice(0, 160)}`); break; } });
  return found;
}

test('the manifest names every page a tile opens as the table of names does', () => {
  const own = manifest.ui.static.filter((tile) => String(tile.iframeUrl).startsWith('/api/career-hunter/'));
  assert.deepEqual(own.map((tile) => [tile.toolName, tile.label]).sort(), PAGES.map((page) => [page.tool, page.name]).sort());
  for (const label of manifest.ui.static.map((tile) => tile.label)) assert.equal(RETIRED_NAMES.includes(label), false, `${label} is a retired name`);
  assert.equal(new Set(manifest.ui.static.map((tile) => tile.label)).size, manifest.ui.static.length, 'no two pages share a name');
});

test('each page\'s title is its name, and a page that carries a heading carries its name', () => {
  for (const page of PAGES) {
    const html = withoutComments(read('tools', page.file));
    const title = /<title>([^<]*)<\/title>/.exec(html);
    assert.equal(title && title[1], page.title || page.name, `${page.file} is titled for ${page.name}`);
    // A heading written with ${...} is the heading of a document the page shows (the résumé's own name), not the page's.
    const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1]).filter((inner) => !inner.includes('${')).map(textOf);
    assert.ok(headings.length <= 1, `${page.file} has one page heading at most`);
    if (headings.length) assert.equal(headings[0], page.heading || page.name, `${page.file} is headed ${page.name}`);
  }
});

test('the list of a person\'s jobs opens under its name and keeps it', () => {
  const script = withoutComments(read('tools', 'career-job-lists.js'));
  assert.match(script, /labels=\{saved:'My jobs',/, 'the page heading for the saved list is the page\'s name');
});

test('the file Download my data saves is named for what it is', () => {
  const page = withoutComments(read('tools', 'career-master-record.html'));
  assert.match(page, /const name = `career-data-\$\{current\.asOf\.slice\(0, 10\)\}\.md`;/, 'the name a person sees in their downloads and in the page\'s Saved line');
  assert.doesNotMatch(page, /master-record-\$\{/);
  assert.match(read('lib', 'career-master-record-markdown.js'), /`# My Career data\$\{r\.person\.name \? `: \$\{one\(r\.person\.name\)\}` : ''\}`/, 'and the file is headed the same way');
});

test('no page or script a route serves carries a retired name', () => {
  // career-board.html is served by no route (the list of jobs is career-job-lists.html); the map library is vendored.
  const skipped = new Set(['career-board.html', 'career-leaflet.js']);
  const files = readdirSync(tools).filter((name) => /\.(html|js)$/.test(name) && !skipped.has(name));
  assert.ok(files.length >= 28, `only ${files.length} files found under tools/`);
  const found = files.flatMap((name) => hits(`tools/${name}`, withoutComments(read('tools', name)), RETIRED));
  assert.deepEqual(found, []);
});

test('the résumé every application starts from is the main résumé on every page', () => {
  const skipped = new Set(['career-board.html', 'career-leaflet.js']);
  const files = readdirSync(tools).filter((name) => /\.(html|js)$/.test(name) && !skipped.has(name));
  // The AI Office document Career links a person's main résumé to is found by this stored title, so it cannot change.
  const stored = "const TITLE = 'Master resume (Career)';";
  assert.ok(read('tools', 'career-resume-office.js').includes(stored), 'the stored document title is unchanged');
  const found = files.flatMap((name) => hits(`tools/${name}`, withoutComments(read('tools', name)).replace(stored, ''), MASTER_RESUME));
  assert.deepEqual(found, []);
  const studio = withoutComments(read('tools', 'career-resume-studio.html'));
  assert.match(studio, /Save main résumé/);
  assert.match(studio, /Save to main résumé/);
});

test('no answer a route sends carries a retired name', () => {
  // A log line is read by an operator, never sent to a person.
  const sent = (text) => withoutComments(text).split('\n').map((line) => (/\blogger\.(?:debug|info|warn|error)\(/.test(line) ? '' : line)).join('\n');
  // The instruction the classic editor's model is given is read by a model, not sent to a person.
  const INSTRUCTION = "'You are editing the candidate\\'s MASTER resume in a live editor. This is NOT a job-tailored',";
  assert.ok(read('routes', 'career-resume-studio-routes.js').includes(INSTRUCTION), 'the model instruction is where this test expects it');
  const found = [];
  for (const folder of ['routes', 'lib', 'bin']) {
    for (const name of readdirSync(join(root, folder)).filter((file) => file.endsWith('.js'))) {
      found.push(...hits(`${folder}/${name}`, sent(read(folder, name)).replace(INSTRUCTION, ''), [...RETIRED, /master r[eé]sum[eé]/i]));
    }
  }
  assert.deepEqual(found, []);
});

test('the manifest and the persona tell a person and the assistant the same names', () => {
  const said = [manifest.displayName, manifest.description, manifest.localEditing.description, manifest.experience.label,
    ...manifest.authorization.roleTemplates.map((template) => template.label),
    ...(manifest.tools || []).flatMap((tool) => [tool.displayName, tool.description, tool.usageInstructions])].filter(Boolean).join('\n');
  assert.deepEqual(hits('oshal-app.yaml', said, RETIRED), []);
  assert.deepEqual(hits('oshal-app.yaml', [manifest.description, manifest.localEditing.description].join('\n'), MASTER_RESUME), []);
  const persona = read('personas', 'career-hunter.yaml').replace(/^\s*#.*$/gm, '');
  assert.deepEqual(hits('personas/career-hunter.yaml', persona, RETIRED), []);
  for (const name of ['My jobs', 'My résumé', 'Improve my résumé', 'Download my data', 'Job market', 'main résumé']) assert.ok(persona.includes(name), `the persona says ${name}`);
});

test('the page is Improve my résumé everywhere, and Improve it only in Career\'s own bar under Résumé', () => {
  const frame = createRequire(import.meta.url)('../tools/career-frame.js');
  const tile = manifest.ui.static.find((entry) => entry.toolName === 'career-strengthen');
  assert.equal(tile.label, 'Improve my résumé', 'the label a toolbar or a menu shows with nothing around it');
  const profile = { ribbon: { items: manifest.ui.static.map((entry) => ({ id: `tool-${entry.toolName}`, label: entry.label, section: entry.section, group: entry.group, toolUi: { iframeUrl: entry.iframeUrl, visibilityToolName: entry.toolName } })) } };
  const entries = frame.navEntries(profile), page = entries.find((entry) => entry.view === 'strengthen');
  assert.deepEqual([page.label, page.full], ['Improve it', 'Improve my résumé'], 'the bar\'s word, and the page\'s own name for a place that lists it alone');
  const section = frame.sections(entries).primary.find((part) => part.pages.some((entry) => entry.view === 'strengthen'));
  assert.equal(section.label, 'Résumé', 'the short word is only ever shown under this section');
  for (const entry of entries.filter((other) => other.view !== 'strengthen')) assert.equal(entry.full, '', `${entry.label} has one name`);
  // Outside the frame the short form says nothing, so nothing else uses it.
  const short = [/Improve it\b/];
  const found = [];
  for (const name of readdirSync(tools).filter((file) => /\.(html|js)$/.test(file) && !['career-frame.js', 'career-board.html', 'career-leaflet.js'].includes(file))) found.push(...hits(`tools/${name}`, withoutComments(read('tools', name)), short));
  for (const folder of ['routes', 'lib']) for (const name of readdirSync(join(root, folder)).filter((file) => file.endsWith('.js'))) found.push(...hits(`${folder}/${name}`, withoutComments(read(folder, name)), short));
  found.push(...hits('personas/career-hunter.yaml', read('personas', 'career-hunter.yaml').replace(/^\s*#.*$/gm, ''), short));
  found.push(...hits('oshal-app.yaml', [manifest.description, ...manifest.ui.static.map((entry) => entry.label), ...(manifest.tools || []).flatMap((tool) => [tool.displayName, tool.description, tool.usageInstructions])].filter(Boolean).join('\n'), short));
  assert.deepEqual(found, []);
});
