/**
 * Guards for the served surface.
 *
 * THE WORLD 1.0.1 LESSON, which this repo already paid for: the surface is one inline <script> in a
 * served HTML file. No compiler parses it and no console reports it, so a syntax error there ships
 * green and the page simply never loads. `world` 1.0.1 went out with its load() declaration deleted.
 * This file parses the real inline script with classic-script grammar so that cannot happen here.
 *
 * The second half guards the CONTRACT between the surface and the router: every endpoint the page
 * calls must be one the package actually registers. A surface calling a route nobody mounted is a
 * blank panel with a 404 behind it, which looks identical to "no data".
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — inline-script parse guard, the surface-to-router endpoint contract, the tab set, and the presence of the credential warning the fantasy tab must show before anyone pastes an account cookie.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The fantasy half moved to the fantasy-football package (ADR-146 D1): the endpoint contract reads sports-routes.js alone, and the three fantasy-copy guards (credential warning, no credential payload, league scoring) moved with the page to fantasy-football/tests/fantasy-surface.test.js. In their place: the Fantasy tab names the new app, links to it, and calls no retired /fantasy route.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sports-edge.html'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sports-routes.js'), 'utf8');

/** Every inline (non-src) script in the page, concatenated. */
function inlineScript() {
  return [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

test('THE INLINE SCRIPT PARSES — no compiler checks it, so this is the only thing that does', () => {
  const src = inlineScript();
  assert.ok(src.length > 2000, 'the page should actually carry its script');
  // Classic-script grammar, exactly how the browser will parse it. Throws on a syntax error.
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'sports-edge.html' }));
});

test('the surface has no CRLF, which the repo stores as LF', () => {
  assert.equal(HTML.includes('\r'), false);
});

test('every tab has a section and a handler', () => {
  for (const tab of ['teams', 'games', 'preview', 'fantasy', 'record']) {
    assert.ok(HTML.includes(`data-tab="${tab}"`), `${tab} needs a nav button`);
    assert.ok(HTML.includes(`id="tab-${tab}"`), `${tab} needs a section`);
  }
  const src = inlineScript();
  assert.match(src, /'teams', 'games', 'preview', 'fantasy', 'record'/, 'the tab list must include every tab');
});

test('EVERY ENDPOINT THE PAGE CALLS IS ONE THE ROUTER REGISTERS', () => {
  // A surface calling a route nobody mounted is a blank panel with a 404 behind it, which looks
  // exactly like "no data" to the person reading it.
  const src = inlineScript();
  const called = new Set();
  for (const m of src.matchAll(/API \+ '(\/[a-z0-9/_-]*)/gi)) {
    // Keep the first path segment (or two for /fantasy/*), dropping query strings and interpolation.
    const parts = m[1].split('/').filter(Boolean);
    if (!parts.length) continue;
    called.add(parts[0] === 'fantasy' ? `fantasy/${parts[1] || ''}` : parts[0]);
  }
  assert.ok(called.size >= 6, `expected the page to call several endpoints, saw ${[...called].join(', ')}`);
  for (const ep of called) {
    const seg = ep.replace(/\/$/, '');
    assert.ok(
      ROUTES.includes(`'/${seg}'`) || ROUTES.includes(`'/${seg}/`) || ROUTES.includes(`"/${seg}"`),
      `the surface calls /${seg} but no router registers it`,
    );
  }
});

test('THE FANTASY TAB SAYS WHERE FANTASY WENT — and calls no fantasy route', () => {
  // ADR-146 D1: the fantasy half is its own app now. A tab that silently vanished would read as the
  // feature being deleted; a tab that still called /fantasy/* would render a 410 as an error.
  assert.match(HTML, /Fantasy moved to its own app/);
  assert.match(HTML, /href="\/cockpit\/\?app=fantasy-football"/);
  assert.match(HTML, /yours alone/);
  assert.equal(/API \+ '\/fantasy/.test(inlineScript()), false, 'the page must not call a retired fantasy route');
  assert.equal(inlineScript().includes('/api/connect/'), false, 'and never posts a credential');
});
