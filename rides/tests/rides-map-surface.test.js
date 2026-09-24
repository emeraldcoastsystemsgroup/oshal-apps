/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 21:20:00 | maintainer@emeraldcoastsystemsgroup.com   | Surface contract for the Rides map. Three regressions this pins, all of which shipped once: (1) THE DRAWING — the panel used to be a CSS grid with two pins nailed at left:28%/left:76%, which looks like a map in a screenshot and is not one, so the surface must build a real Leaflet map with a real tile layer and must NOT reintroduce fixed-percentage pin positioning; (2) THE CDN — the Leaflet bytes ship inside this package, because an external script tag is refused under OSHAL_STRICT_CSP and unreachable on an air-gapped install, and the failure mode is a map that silently never draws; (3) THE SYNTAX ERROR — the surface is one served HTML file whose inline scripts no compiler ever parses (the world 1.0.1 lesson: a SyntaxError there renders as a page that never loads and is caught by nothing), so every inline script is parsed here.
 * 2026-09-21 10:30:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin the distance label to the measurement it describes. Keyless — the accepted default — the server measures the straight line between the two geocoded pins and multiplies it by a stated detour factor, and the surface printed that as "~N km by road", which a rider reads as a driven route. It now prints "road estimate (straight line × 1.3)". The second half is forward compatibility the store has to ship FIRST: the server is gaining an optional routing-engine override (OSHAL_ROUTING_URL) that answers basis:'routed', and renderDistance tested `basis === 'geocoded'` exactly, so a real routed distance fell through and the row was hidden outright — a measured route displayed as nothing. The guard EXECUTES renderDistance out of the shipped HTML rather than grepping it, because a substring assertion passes on a label that never renders.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const PKG = path.resolve(__dirname, '..');
const SURFACE = path.join(PKG, 'tools', 'rides-app.html');
const VENDOR = path.join(PKG, 'tools', 'vendor', 'leaflet');
const html = fs.readFileSync(SURFACE, 'utf8');

function inlineScripts(source) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (m[2].trim()) out.push({ code: m[2], module: /type\s*=\s*["']?module/i.test(attrs) });
  }
  return out;
}

test('every inline script in the rides surface parses', () => {
  const scripts = inlineScripts(html);
  assert.ok(scripts.length >= 1, 'expected at least the surface driver script');
  for (const [i, s] of scripts.entries()) {
    assert.doesNotThrow(
      () => s.module ? execFileSync(process.execPath, ['--check','--input-type=module'], {input:s.code,stdio:'pipe'}) : new vm.Script(s.code, { filename: `rides-app.html#${i}` }),
      `inline script #${i} in rides-app.html does not parse`,
    );
  }
});

test('Leaflet ships inside the package at the paths the surface asks for', () => {
  for (const file of ['leaflet.js', 'leaflet.css', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(VENDOR, file)), `missing tools/vendor/leaflet/${file}`);
  }
  // The default marker images are part of the dist; without them Leaflet renders broken icons.
  assert.ok(fs.existsSync(path.join(VENDOR, 'images', 'marker-icon.png')), 'missing vendored marker images');
  assert.match(html, /href="\/api\/rides\/vendor\/leaflet\/leaflet\.css"/);
  assert.match(html, /\$\{API\}\/vendor\/leaflet\/leaflet\.js/);
});

test('the vendored Leaflet keeps its licence and its upstream banner', () => {
  const licence = fs.readFileSync(path.join(VENDOR, 'LICENSE'), 'utf8');
  assert.match(licence, /BSD 2-Clause/i);
  assert.match(fs.readFileSync(path.join(VENDOR, 'leaflet.js'), 'utf8').slice(0, 400), /Leaflet 1\.9\.4/);
});

test('no map asset is loaded from a remote host', () => {
  // Google's own script tag is the ONE allowed remote load, and only when an operator has
  // configured a key. Anything else — unpkg, cdnjs, jsdelivr — means the map stopped being
  // self-contained and will die under strict CSP or with no egress.
  const remoteScripts = [...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const src of remoteScripts) {
    assert.ok(!/^https?:\/\//i.test(src), `surface loads a remote script tag: ${src}`);
  }
  for (const host of ['unpkg.com', 'cdnjs.cloudflare.com', 'jsdelivr.net']) {
    assert.ok(!html.includes(host), `surface references the CDN ${host}`);
  }
  const remoteStyles = [...html.matchAll(/<link[^>]*\shref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const href of remoteStyles) {
    assert.ok(!/^https?:\/\//i.test(href), `surface loads a remote stylesheet: ${href}`);
  }
});

test('the surface builds a real map, with real tiles and real markers', () => {
  assert.match(html, /window\.L\.map\(/, 'no Leaflet map is constructed');
  assert.match(html, /window\.L\.tileLayer\(/, 'no tile layer is added — a map with no tiles is a grey box');
  assert.match(html, /window\.L\.marker\(/, 'no markers are created');
  assert.match(html, /window\.L\.polyline\(/, 'no route line is drawn');
  assert.match(html, /draggable:\s*true/, 'markers must be draggable — that is how a rider corrects a pin');
});

test('the decorative fake map is gone and must not return', () => {
  // The tell of the old drawing: pins positioned by hardcoded percentage instead of coordinates.
  assert.doesNotMatch(html, /\.map-point\.pickup\s*\{[^}]*left:\s*28%/, 'the hardcoded pickup pin is back');
  assert.doesNotMatch(html, /\.map-point\.dropoff\s*\{[^}]*left:\s*76%/, 'the hardcoded dropoff pin is back');
  assert.ok(!html.includes('class="map-point'), 'the decorative pin markup is back');
  assert.ok(!html.includes('id="routeLine"'), 'the CSS-border fake route is back');
});

test('a dragged or dropped pin is resolved to an address, not left as raw decimals', () => {
  assert.match(html, /\$\{API\}\/reverse\?lat=/, 'no reverse-geocode call — a dropped pin would stay a coordinate pair');
  assert.match(html, /on\('dragend'/, 'markers are not wired to resolve after a drag');
});

test('address lookup is on-demand, never per keystroke', () => {
  // Nominatim's usage policy rules out autocomplete-style querying of the public endpoint, and
  // the CLI serializes at ~1 req/s — a keystroke-triggered lookup would both abuse it and feel
  // broken. Resolution hangs off blur/Enter instead.
  assert.ok(
    !/#dropoff'\)\.addEventListener\('input',\s*\(\)\s*=>\s*\{[^}]*geocodeField/.test(html),
    'destination geocoding is wired to input events',
  );
  assert.match(html, /addEventListener\('blur',\s*\(\)\s*=>\s*\{\s*if\s*\(!googleMapState\.enabled\)\s*geocodeField/);
});

test('Google is an upgrade, not a requirement — the surface picks OSM without a key', () => {
  assert.match(html, /maps\.googleMapsEnabled\s*\?\s*await enableGoogleMaps\(maps\)\s*:\s*false/);
  assert.match(html, /if\s*\(!google\)\s*\{[\s\S]{0,400}?initOsmMap/, 'no OSM path when Google is absent or fails');
});

test('a null fare renders as no estimate, never as a dollar sign with a placeholder', () => {
  // "$?-?" reads as a loading state; the honest answer when an address did not resolve is that
  // there is no estimate at all.
  assert.ok(!html.includes('$${escapeHtml(option.fareLow ?? \'?\')}'), 'the placeholder fare rendering is back');
  assert.match(html, /no estimate/);
});

test('moving a pin retracts the fare that described the old route', () => {
  // Same failure class as the hashed estimate, reached a different way: a rider drags the
  // destination two towns over and the surface keeps showing "$32-41 · 18.6 km" beside the new
  // line. setPoint must invalidate unless the move came FROM an estimate response.
  assert.match(html, /function invalidateEstimate\(\)/, 'no retraction path exists');
  const setPoint = html.slice(html.indexOf('async function setPoint'), html.indexOf('function clearPin'));
  assert.match(setPoint, /if\s*\(!opts\.fromEstimate\)\s*invalidateEstimate\(\)/, 'setPoint does not retract a stale estimate');
  // …and the estimate's own pin placement must NOT retract the answer it just computed.
  assert.match(html, /setPoint\('pickup',\s*result\.coords\.pickup,\s*\{[^}]*fromEstimate:\s*true/);
  assert.match(html, /setPoint\('dropoff',\s*result\.coords\.dropoff,\s*\{[^}]*fromEstimate:\s*true/);
});

test('a retracted estimate also disables the handoff button', () => {
  // Opening Uber off a stale selection is the one action here with a real-world consequence.
  const invalidate = html.slice(html.indexOf('function invalidateEstimate'), html.indexOf('/** Drop one end'));
  assert.match(invalidate, /requestBtn/);
  assert.match(invalidate, /disabled = true/);
  assert.match(invalidate, /state\.selected = null/);
});

test('Leaflet is told to recompute its size after the iframe settles', () => {
  // Leaflet caches container size at init. In a cockpit iframe that size is often still zero,
  // and the symptom is a permanently grey map that looks like a tile-server outage.
  assert.match(html, /invalidateSize\(\)/);
});

// ── The distance label ───────────────────────────────────────────────────────
// Pulled out of the shipped HTML and EXECUTED, not regex-matched: the thing under test is what
// the rider reads, and a substring assertion over the source would pass on a label that never
// renders. `basis` is the server's statement of what it measured, so the function is driven with
// each value the server can send.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is never closed`);
}

function runRenderDistance(result) {
  const label = { textContent: '' };
  const row = { hidden: null };
  const sandbox = {
    Number,
    __result: result,
    $: (selector) => {
      if (selector === '#distanceRow') return row;
      if (selector === '#distanceLabel') return label;
      return null;
    },
  };
  vm.createContext(sandbox);
  new vm.Script(`${extractFunction(html, 'renderDistance')}\nrenderDistance(__result);`, {
    filename: 'rides-app.html#renderDistance',
  }).runInContext(sandbox);
  return { label: label.textContent, hidden: row.hidden };
}

test('the distance label says which measurement it is', () => {
  // Keyless — the accepted default. The road figure is the straight line times a stated detour
  // factor, and printing it as a bare "by road" reads as a driven route the server never drove.
  const keyless = runRenderDistance({ basis: 'geocoded', distanceKm: 13, straightLineKm: 10, roadFactor: 1.3 });
  assert.equal(keyless.hidden, false, 'a measured trip must show what it was measured from');
  assert.match(keyless.label, /10 km straight line/, 'the honest half of the measurement is missing');
  assert.match(keyless.label, /road estimate/, 'the modelled road distance is printed as if it were routed');
  assert.match(keyless.label, /1\.3/, 'the detour factor the fare rests on is not stated');

  // Routed — what the server answers once an operator plugs a routing engine into
  // OSHAL_ROUTING_URL. This value did not exist when renderDistance was written, and the old
  // `basis === 'geocoded'` test hid the distance row for it: a real route shown as nothing.
  const routed = runRenderDistance({ basis: 'routed', distanceKm: 12.4, straightLineKm: 10, roadFactor: 1.3 });
  assert.equal(routed.hidden, false, 'a routed distance is hidden instead of shown');
  assert.match(routed.label, /routed/, 'a routed distance is not labelled as routed');
  assert.doesNotMatch(routed.label, /road estimate/, 'a measured route is labelled as an estimate of one');

  // Unresolved stays silent: no pin, no distance, no number to misread.
  const unresolved = runRenderDistance({ basis: 'unresolved', distanceKm: null, straightLineKm: null });
  assert.equal(unresolved.hidden, true, 'a trip we could not place still shows a distance');
});
