/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (create--create-home): the work cards' meta is words, never the studios' raw slash strings ("built / revision 1 /" → "Built · revision 1", "reconstructed / photos /" → "Reconstructed from photos", "Saved pptx document · … · oshal-local" → "Saved PowerPoint"), the date reads "Image editor · 2 days ago", a search counts "1 match" / "2 matches", every planned control is greyed with "Not available yet" and its backlog id and has no handler, and each Blank start names a real studio address. Runs Home's own functions in isolation; no browser, no network. CREATE_HOME_FILE points it at another copy of the page (the red-on-old-code proof).
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Blank row's image start is two sized blanks (1080 × 1080 and 1920 × 1080) that open the editor with ?size=.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Home reports New's top edge to the shell (--oshal-app-bottom-inset) so the orb rests above New on a phone, and leaves the shell alone when it is not framed.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | The access probe's limit covers sixteen studios answered one after another (the trial's "can't check" on every template).
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | New is position:fixed (offsetParent always null): the orb case gives New a null offsetParent and a real box, the trial's failure shape.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | No template or blank start speaks set-up wording (the trial sweep: "desktop worker" on the Video clip card).
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | RP-CRE-01..03: zero planned placeholders remain on Home or in New; Custom size validates 16..8192 whole pixels; home-actions.mjs classifies raster, SVG, Office and PDF imports and enforces studio access and size bounds.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.CREATE_HOME_FILE || path.join(PKG, 'tools', 'create-home.html'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

/** One top-level declaration of Home's script, as written: a `var` line or a whole function. */
function declaration(name) {
  const oneLine = new RegExp('\\n  (?:function ' + name + '\\(.*\\}|var ' + name + ' = .*;)(?=\\n)').exec(source);
  if (oneLine && (oneLine[0].match(/\{/g) || []).length === (oneLine[0].match(/\}/g) || []).length) return oneLine[0];
  const block = new RegExp('\\n  function ' + name + '\\([^]*?\\n  \\}(?=\\n)').exec(source)
    || new RegExp('\\n  var ' + name + ' = [\\[{][^]*?\\n  [\\]}];(?=\\n)').exec(source);
  assert.ok(block, `Home declares ${name}`);
  return block[0];
}
/** Compile the named declarations together, so each runs exactly as the page runs it. */
function load(names, globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(names.map(declaration).join('\n'), context);
  return context;
}
const words = () => load(['ISO', 'FORMAT_WORDS', 'humanize', 'detailParts', 'stateWords', 'whenText', 'metaWords', 'matchWords']);
const studio = (app, name) => ({ app, name });
const ago = (days) => new Date(Date.now() - days * 864e5 - 36e5).toISOString();

test('each studio\'s raw detail becomes words on its card', () => {
  const page = words();
  const cases = [
    [studio('cad-studio', 'CAD Studio'), `built / revision 1 / ${ago(6)}`, 'Built · revision 1'],
    [studio('scan-to-print', '3D Scan-to-Print'), `reconstructed / photos / ${ago(2)}`, 'Reconstructed from photos'],
    [studio('presentations', 'AI Office'), `Saved pptx document · ${ago(1)} · oshal-local`, 'Saved PowerPoint'],
    [studio('presentations', 'AI Office'), `Saved docx document · ${ago(1)} · dropbox`, 'Saved Word document'],
    [studio('create', 'Image editor'), `Layered image · updated ${ago(2)}`, 'Layered image'],
    [studio('lora', 'LoRA Studio'), 'No saved model version', 'No saved model version'],
    [studio('lora', 'LoRA Studio'), `Latest version v3 · ready · registered ${ago(3)}`, 'Latest version v3 · ready'],
    [studio('video', 'Video Studio'), `awaiting_approval · 2 episodes recorded assembled · updated ${ago(1)}`, 'Awaiting approval · 2 episodes recorded assembled'],
    [studio('scene-studio', 'Scene Studio'), 'Godot game / revision 4 / date unavailable / no preview yet', 'Godot game · revision 4 · no preview yet'],
  ];
  for (const [owner, detail, expected] of cases) {
    const said = page.stateWords(owner, detail);
    assert.equal(said, expected, detail);
    assert.doesNotMatch(said, /\/|\d{4}-\d{2}-\d{2}T|oshal-local/, 'no slash, instant or provider id survives');
  }
});

test('the meta line names the studio and says when in words', () => {
  const page = words();
  assert.equal(page.metaWords(studio('create', 'Image editor'), `Layered image · updated ${ago(2)}`), 'Image editor · 2 days ago');
  assert.equal(page.metaWords(studio('cad-studio', 'CAD Studio'), `built / revision 1 / ${ago(1)}`), 'CAD Studio · Yesterday');
  assert.equal(page.metaWords(studio('lora', 'LoRA Studio'), 'No saved model version'), 'LoRA Studio', 'no date, no dangling dot');
});

test('search counts in words: "1 match", "2 matches"', () => {
  const page = words();
  assert.deepEqual([1, 2, 12].map((n) => page.matchWords(n)), ['1 match', '2 matches', '12 matches']);
  assert.doesNotMatch(source, /matches in your workspace/, 'the old "1 matches" sentence is gone');
});

test('no RP-CRE-01..03 planned placeholders remain on Home or in New, and Custom size validates 16..8192 px', () => {
  assert.doesNotMatch(source, /data-ds-not-yet|data-ds-backlog|Not available yet/, 'all RP-CRE-01..03 controls are live');
  assert.match(source, /id="renameDialog"/);
  assert.match(source, /id="deleteDialog"/);
  assert.match(source, /id="customSizeForm"/);
  assert.match(source, /id="importInput"/);
  const page = load(['parseCustomSize']);
  assert.deepEqual(plain(page.parseCustomSize('1200', '628')), { ok: true, width: 1200, height: 628, query: 'size=1200x628' });
  assert.deepEqual(plain(page.parseCustomSize(16, 8192)), { ok: true, width: 16, height: 8192, query: 'size=16x8192' });
  for (const [w, h] of [['15', '1080'], ['1080', '8193'], ['100.5', '200'], ['-50', '500'], ['', '400'], ['abc', '400']]) {
    const bad = plain(page.parseCustomSize(w, h));
    assert.equal(bad.ok, false, `${w}x${h} rejected`);
    assert.match(bad.message, /16 and 8192/);
  }
});

test('home-actions classifies supported import formats and enforces studio access and byte limits (RP-CRE-03)', async () => {
  const actions = await import(path.join(PKG, 'tools', 'editor', 'home-actions.mjs'));
  assert.equal(actions.parseItemId('project=00000000-0000-4000-8000-0000000000c1', 'project'), '00000000-0000-4000-8000-0000000000c1');
  assert.equal(actions.parseItemId('project=not-a-uuid', 'project'), '');
  assert.equal(actions.copyTitle('Launch deck'), 'Launch deck (copy)');
  assert.equal(actions.cleanImportTitle('Q4_brand-guide.final.pdf'), 'Q4 brand guide.final');
  const openAll = { create: 'open', presentations: 'open', 'pdf-workbench': 'open' };
  assert.equal(actions.classifyImportFile({ name: 'photo.webp', size: 1024 }, openAll).spec.kind, 'raster');
  assert.equal(actions.classifyImportFile({ name: 'badge.svg', size: 512 }, openAll).spec.kind, 'svg');
  assert.equal(actions.classifyImportFile({ name: 'slides.pptx', size: 4096 }, openAll).spec.kind, 'office');
  assert.equal(actions.classifyImportFile({ name: 'memo.docx', size: 4096 }, openAll).spec.kind, 'office');
  assert.equal(actions.classifyImportFile({ name: 'form.pdf', size: 8192 }, openAll).spec.kind, 'pdf');
  assert.equal(actions.classifyImportFile({ name: 'archive.zip', size: 100 }, openAll).ok, false);
  assert.equal(actions.classifyImportFile({ name: 'huge.svg', size: 3 * 1024 * 1024 }, openAll).ok, false);
  assert.equal(actions.classifyImportFile({ name: 'slides.pptx', size: 1024 }, { ...openAll, presentations: 'locked' }).ok, false);
});

test('the Blank row comes first and every start is a real studio address', () => {
  const blanks = plain(load(['BLANKS']).BLANKS);
  assert.deepEqual(blanks.map((b) => b.label), ['Image', 'Image', 'Presentation', 'Document', 'Spreadsheet', 'Video', 'Portrait', 'Story', '3D scan']);
  assert.deepEqual(blanks.filter((b) => b.tool === 'create-editor').map((b) => [b.hint, b.query]),
    [['1080 × 1080', 'size=1080x1080'], ['1920 × 1080', 'size=1920x1080']], 'the image editor opens a blank canvas of each size');
  const office = blanks.filter((b) => b.tool === 'create-office').map((b) => b.query);
  assert.deepEqual(office, ['kind=pptx', 'kind=docx', 'kind=xlsx'], 'AI Office opens a blank document of each kind');
  assert.equal(blanks.find((b) => b.id === 'video').tool, 'create-video-editor', 'an empty timeline, not generation');
  assert.ok(source.indexOf('id="blankRow"') < source.indexOf('id="tq"'), 'Blank precedes the template search');
});

test('skeletons hold the grid only while a studio is still answering', () => {
  const grid = { children: [], attrs: {}, replaceChildren() { this.children = []; }, appendChild(n) { this.children.push(n); }, setAttribute(k, v) { this.attrs[k] = v; } };
  const page = load(['renderRecent'], {
    recentGrid: grid, recentNote: {}, recentCards: [], pending: 3,
    workCard: () => ({ kind: 'card' }), skeleton: () => ({ kind: 'skeleton' }), el: (_t, cls) => ({ kind: cls }), applyFilters() {},
  });
  page.renderRecent();
  assert.deepEqual(grid.children.map((c) => c.kind), ['skeleton', 'skeleton', 'skeleton', 'skeleton']);
  assert.equal(grid.attrs['aria-busy'], 'true');
  page.recentCards = [{ t: 1 }, { t: 2 }, { t: 3 }]; page.renderRecent();
  assert.deepEqual(grid.children.map((c) => c.kind), ['card', 'card', 'card', 'skeleton', 'skeleton']);
  page.pending = 0; page.renderRecent();
  assert.deepEqual(grid.children.map((c) => c.kind), ['card', 'card', 'card']);
  assert.equal(grid.attrs['aria-busy'], 'false');
  page.recentCards = []; page.renderRecent();
  assert.deepEqual(grid.children.map((c) => c.kind), ['empty']);
});


test("the shell's orb is lifted above New, never onto it", () => {
  const page = load(['orbInset']);
  // A 915px phone, the frame 48px below the top, New's top 783px into the frame: New starts 84px above the bottom.
  assert.equal(page.orbInset(915, 48, 783), 80, 'the orb rests 12px + 80px up, above New with a gap');
  assert.equal(page.orbInset(915, 48, 900), 0, 'never a negative inset');
  const set = {};
  const outer = { style: { setProperty: (k, v) => { set[k] = v; }, removeProperty: (k) => { delete set[k]; } } };
  const box = { top: 783, height: 52 };
  const fab = { offsetParent: null, getBoundingClientRect: () => box };   // position:fixed: offsetParent is always null
  const win = { innerHeight: 915, document: { documentElement: outer } };
  const framed = load(['orbInset', 'clearOrb'], { document: { getElementById: () => fab }, window: { parent: win, frameElement: { getBoundingClientRect: () => ({ top: 48 }) } } });
  framed.clearOrb();
  assert.equal(set['--oshal-app-bottom-inset'], '80px');
  box.height = 0; framed.clearOrb();
  assert.equal(set['--oshal-app-bottom-inset'], undefined, 'a hidden New gives the corner back');
  const alone = { document: { getElementById: () => fab } }; alone.window = { frameElement: null }; alone.window.parent = alone.window;
  assert.doesNotThrow(() => load(['orbInset', 'clearOrb'], alone).clearOrb(), 'a standalone open has no shell to touch');
});

test("the access probe's limit covers every studio answered in turn, so templates do not say \"can't check\"", () => {
  const studios = (source.match(/\{ tool: 'create-[a-z-]+',\s+app: '/g) || []).length;
  assert.ok(studios >= 14, 'Home asks every studio it lists');
  const page = load(['ACCESS_TIMEOUT_MS']);
  assert.ok(page.ACCESS_TIMEOUT_MS >= studios * 400, `${studios} probes at ~0.3-0.4 s each fit inside ${page.ACCESS_TIMEOUT_MS} ms`);
  assert.match(declaration('accessFor'), /fetchJson\('\/api\/authorization\/me\?app=' \+ encodeURIComponent\(app\), ACCESS_TIMEOUT_MS\)/);
});

test('no template or blank start speaks set-up wording a visitor cannot act on', () => {
  const cards = plain(load(['OTHER']).OTHER).concat(plain(load(['BLANKS']).BLANKS));
  for (const card of cards) assert.doesNotMatch(String(card.desc || card.hint || ''), /desktop worker|an administrator|api key|not connected/i, card.name || card.label);
});
