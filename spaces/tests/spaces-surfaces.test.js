/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Source-of-truth guard for the completed Spaces carve: protect the packaged factory and /pair endpoint in source and compiled routes, parse every served inline script, and pin the cockpit-versus-embed stylesheet boundary.
 * 2026-08-06 01:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Move the room-scale/8GB/multi-scan acceptance assertion beside its now-authoritative packaged surface before deleting the unrouted kernel copy.
 *
 * Dependency-free `node --test` suite, matching the store CI contract.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const TOOLS_ROOT = path.join(PACKAGE_ROOT, 'tools');
const SOURCE_ROUTE = path.join(PACKAGE_ROOT, 'src-routes', 'spaces-routes.ts');
const COMPILED_ROUTE = path.join(PACKAGE_ROOT, 'routes', 'spaces-routes.js');

const SURFACES = [
  { file: 'spaces.html', themed: true },
  { file: 'spaces-viewer.html', themed: false },
  { file: 'spaces-capture.html', themed: false },
];

const read = (filePath) => fs.readFileSync(filePath, 'utf8');

/** Remove comments so prose cannot satisfy a route-code invariant. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function stylesheetLinks(html) {
  const links = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) links.push(href[1]);
  }
  return links;
}

function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] || '';
    if (/\bsrc\s*=/i.test(attributes) || !match[2].trim()) continue;
    scripts.push({ code: match[2], module: /type\s*=\s*["']?module/i.test(attributes) });
  }
  return scripts;
}

test('the package ships every surface its routes serve', () => {
  for (const { file } of SURFACES) {
    assert.ok(fs.existsSync(path.join(TOOLS_ROOT, file)), `missing tools/${file}`);
  }
});

test('the upload surface states its certified scene-size boundary', () => {
  const html = read(path.join(TOOLS_ROOT, 'spaces.html'));
  assert.match(html, /room-scale/i);
  assert.match(html, /8\s?GB/i);
  assert.match(html, /multiple linked scans/i);
});

test('every inline script in every Spaces surface parses', () => {
  for (const { file } of SURFACES) {
    const scripts = inlineScripts(read(path.join(TOOLS_ROOT, file)));
    assert.ok(scripts.length >= 1, `${file} has no inline driver script`);
    for (const [index, script] of scripts.entries()) {
      const code = script.module ? `(async () => {\n${script.code}\n})()` : script.code;
      assert.doesNotThrow(
        () => new vm.Script(code, { filename: `${file}#${index}` }),
        `inline script #${index} in ${file} does not parse`,
      );
    }
  }
});

test('the cockpit surface remains deployment-themed', () => {
  for (const { file } of SURFACES.filter((surface) => surface.themed)) {
    const html = read(path.join(TOOLS_ROOT, file));
    const links = stylesheetLinks(html);
    assert.ok(links.some((href) => href.endsWith('/surface-themes.css')), `${file} lost surface-themes.css`);
    assert.ok(links.some((href) => href.endsWith('/surface-glass.css')), `${file} lost surface-glass.css`);
    assert.ok((html.match(/var\(--/g) || []).length > 0, `${file} stopped reading design tokens`);
  }
});

test('the full-screen embeds remain self-contained and theme-independent', () => {
  for (const { file } of SURFACES.filter((surface) => !surface.themed)) {
    const html = read(path.join(TOOLS_ROOT, file));
    assert.deepEqual(stylesheetLinks(html), [], `${file} grew a render-blocking shared stylesheet`);
    assert.equal((html.match(/var\(--/g) || []).length, 0, `${file} started reading cockpit design tokens`);
  }
});

test('source and compiled routes keep the package loader factory contract', () => {
  for (const [label, file] of [['source', SOURCE_ROUTE], ['compiled', COMPILED_ROUTE]]) {
    const code = codeOnly(read(file));
    assert.match(code, /createSpacesRoutes\s*\(\s*ctx\s*[:)]/, `${label} route lost createSpacesRoutes(ctx)`);
    assert.doesNotMatch(code, /\bapiDir\b/, `${label} route regained the retired core apiDir parameter`);
    assert.match(code, /surfaceHtml\s*\(\s*ctx\.appPackageDir/, `${label} route stopped serving from appPackageDir`);
  }
});

test('source and compiled routes both retain mobile pairing ingest', () => {
  for (const [label, file] of [['source', SOURCE_ROUTE], ['compiled', COMPILED_ROUTE]]) {
    assert.match(
      codeOnly(read(file)),
      /router\s*\.\s*post\s*\(\s*(['"`])\/pair\1/,
      `${label} route lost POST /pair`,
    );
  }
  assert.match(read(COMPILED_ROUTE), /createSpacesRoutes/, 'compiled route lost the manifest factory export');
});
