/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Email and Storage tabs inside Little Monsters: lm-email opens the standard email viewer (Intelligent Communication's inbox) and lm-storage the core personal file browser; every school template carries email-summarizer so the tab opens; Little Monsters' own connector lists stay empty (the mailbox is connected in the email application).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The tabs keep the Little Monsters top bar: lm-email and lm-storage open /api/education/email and /api/education/storage (tools/standard-view.html), which show the standard viewer below the frame; every top tab opens a Little Monsters page, both pages are served and bound. Linking /api/files directly replaced the frame and a student had no way back.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve the email membership and minimum template revision when later editor additions advance a school template.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-storage MERGE into lm-files): the lm-storage tile leaves ui.static so My Files is the single files tile, while /api/education/storage stays served and bound and opens /api/education/files?view=saved.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free node:test over the shipped manifest.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(PKG, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
const tile = (name) => manifest.ui.static.find((entry) => entry.toolName === name);

test('the Email tab opens the standard email viewer below the top bar and /api/education/storage leads to My Files -> Saved', () => {
  assert.equal(tile('lm-email').iframeUrl, '/api/education/email');
  assert.equal(tile('lm-email').label, 'Email');
  assert.equal(tile('lm-storage'), undefined, 'lm-storage merged into lm-files (?view=saved)');
  assert.equal(tile('lm-files').iframeUrl, '/api/education/files');
  const page = fs.readFileSync(path.join(PKG, 'tools', 'standard-view.html'), 'utf8');
  assert.match(page, /<script src="\/api\/education\/mascot\.js/, 'the page mounts the Little Monsters frame');
  assert.match(page, /location\.replace\('\/api\/education\/files\?view=saved'/, 'the old /api/education/storage address leads to My Files -> Saved');
  const views = Function(`${page.match(/var STANDARD_VIEWS = \{[\s\S]*?\};/)[0]} return STANDARD_VIEWS;`)();
  assert.deepEqual(views['/api/education/email'], { src: '/api/email/inbox', title: 'Email' });
  assert.deepEqual(views['/api/education/storage'], { src: '/api/files', title: 'Storage' });
});

test('every top tab opens a Little Monsters page, so the top bar stays and the student can move between tabs', () => {
  for (const entry of manifest.ui.static.filter((e) => e.section === 'top')) {
    assert.ok(entry.iframeUrl.startsWith('/api/education/'), `${entry.toolName} opens ${entry.iframeUrl}`);
  }
});

test('the email and storage pages are served and bound to opening the application', () => {
  const catalog = yaml.load(fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8'));
  for (const route of ['/email', '/storage']) {
    for (const method of ['GET', 'HEAD']) {
      const bound = catalog.bindings.http.find((b) => b.method === method && b.path === route);
      assert.deepEqual(bound && bound.allOf, ['app.open'], `${method} ${route}`);
    }
    for (const file of ['routes/education-routes.js', 'src-routes/education-routes.ts']) {
      const source = fs.readFileSync(path.join(PKG, file), 'utf8');
      assert.ok(source.includes(`router.get('${route}', serveFile('standard-view.html'));`), `${file} serves ${route}`);
    }
  }
});

test('every school template carries the email application so the Email tab opens for the person', () => {
  for (const template of manifest.authorization.roleTemplates) {
    assert.ok(template.members.some((m) => m.app === 'email-summarizer' && m.role === '@app-admin'), template.id);
    assert.ok(Number.isSafeInteger(template.version) && template.version >= 2, `${template.id} retains at least version 2, which introduced the email member`);
  }
  assert.ok(manifest.dependencies.required.apps.includes('email-summarizer'));
  assert.deepEqual(manifest.dependencies.required.connectors, []);
  assert.deepEqual(manifest.dependencies.optional.connectors, []);
});
