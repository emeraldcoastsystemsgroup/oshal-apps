/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The page frame is served by the already-bound mascot script (one include per page), so the authorization catalog stays at its installed revision
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Every Little Monsters surface follows the one presentation contract: the shared theme bootstrap (so the operator's skin reaches the page in every host) with the classroom skin as the standalone default, the package stylesheet and page frame, no per-page cockpit theme links or parent-frame theme readers, no external font hosts, no pinned skin, and a viewport for phones
 * -----------------------------------------------------------------------------
 *
 * Dependency-free guard for tools/**.html. Runs under the tests/*.test.cjs store-CI glob.
 *
 * @module lm-surface-conventions.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const BOOTSTRAP_CSS = '/shared/ui/css/surface-themes.css';
/** The bootstrap reads its standalone default from its own script tag, so the tag must carry it. */
const BOOTSTRAP_TAG = /<script src="\/shared\/ui\/js\/surface-theme\.js" data-theme-default="classroom"><\/script>/;
const PACKAGE_CSS = '/api/education/education.css';
const FRAME_JS = '/api/education/mascot.js';

const pages = fs.readdirSync(TOOLS).filter(f => f.endsWith('.html')).sort();
const games = fs.readdirSync(path.join(TOOLS, 'games')).map(d => path.join('games', d, 'index.html')).filter(f => fs.existsSync(path.join(TOOLS, f))).sort();

const read = rel => fs.readFileSync(path.join(TOOLS, rel), 'utf8');
const head = html => { const at = html.search(/<body[\s>]/i); return at === -1 ? html : html.slice(0, at); };

test('the package ships its surfaces and mini-games', () => {
  assert.ok(pages.length >= 19, `expected the registered surfaces, found ${pages.length}`);
  assert.equal(games.length, 6);
});

for (const rel of pages) {
  test(`${rel} follows the surface presentation contract`, () => {
    const html = read(rel), h = head(html);
    assert.ok(h.includes(BOOTSTRAP_CSS), 'loads the shared theme stylesheet');
    assert.match(h, BOOTSTRAP_TAG, 'loads the shared theme script with the classroom skin as the standalone default');
    assert.ok(h.includes(PACKAGE_CSS), 'loads the package design system');
    assert.ok(h.search(BOOTSTRAP_TAG) < h.indexOf(PACKAGE_CSS), 'the bootstrap paints the skin before the package stylesheet resolves its tokens');
    assert.equal((html.match(/\/api\/education\/mascot\.js/g) || []).length, 1, 'loads the shared page frame (mascot.js) exactly once');
    assert.match(h, /<meta name="viewport"/, 'declares a phone viewport');
    assert.doesNotMatch(html, /\/cockpit\/css\/themes\//, 'no per-page cockpit theme links; the bootstrap owns the skin');
    assert.doesNotMatch(html, /data-lm-theme-link|parent\.document\.documentElement\.getAttribute\('data-theme'\)/, 'no parent-frame theme reader of its own');
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, 'no external font or script hosts');
    assert.doesNotMatch(html, /surface-glass\.css/, 'the glass treatment is retired in favour of the package design system');
    assert.doesNotMatch(h, /<html[^>]*\sdata-theme=/, 'no page pins a skin on <html>');
  });
}

for (const rel of games) {
  test(`${rel} follows the mini-game presentation contract`, () => {
    const html = read(rel), h = head(html);
    assert.ok(h.includes(BOOTSTRAP_CSS), 'loads the shared theme stylesheet');
    assert.match(h, BOOTSTRAP_TAG, 'loads the shared theme script with the classroom skin as the standalone default');
    assert.ok(h.includes(PACKAGE_CSS), 'loads the package design system');
    assert.match(h, /<meta name="viewport"/, 'declares a phone viewport');
    assert.doesNotMatch(html, /\/cockpit\/css\/themes\/|surface-glass\.css|fonts\.googleapis\.com/, 'no per-page theme links, glass or external fonts');
  });
}

test('the design system defines every color as a framework token alias and keeps the legacy names pages still use', () => {
  const css = read('education.css');
  for (const token of ['--lm-bg', '--lm-card', '--lm-ink', '--lm-muted', '--lm-line', '--lm-accent']) assert.match(css, new RegExp(`${token}: var\\(--`), `${token} aliases a framework token`);
  for (const legacy of ['--space-md', '--font-size-sm', '--radius-md', '--font-family', '--lm-xp-gradient']) assert.ok(css.includes(`${legacy}:`), `${legacy} still defined`);
  assert.doesNotMatch(css, /\[data-theme="[a-z-]+"\]\s*\{/, 'no skin palette is redefined here; skins live in the framework theme files');
});
