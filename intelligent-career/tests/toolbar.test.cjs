/**
 * CHANGE LOG
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Pin the already shipped 1.1.13 group version while preserving all toolbar and member assertions.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the actual Career toolbar's delegated navigation complete and its references owned by real member surfaces.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep the Career front door on a real member search surface and exclude the generic global ticket workbench.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Read canonical required membership and keep Career configuration and sources conspicuous without changing the group's declarative contract.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pin the released group version, 1.1.6.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Approvals, Prepare & submit and Application status are stages of the Job Board (career-hunter 1.48.0), so the group delegates five destinations and the board carries the rest; pin 1.1.8.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.1.9: the Resume band carries Career's Master record (career-hunter 1.51.0), borrowed from the member's own surface.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.1.10: Print Ingest is no longer a member of the Intelligent Career group; it is a platform tool and is opened from Platform.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.1.12: the group's concierge is Career's own (career-concierge).
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.1.11: the front door opens on Career's Home, a real member surface that carries the job search box; Search Jobs follows it.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Keep Career accounts in member Settings, remove mandatory Facebook setup and verify every retained setup fix names a retained member surface.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const root = resolve(__dirname, '..'), store = resolve(root, '..');
const core = resolve(process.env.OSHAL_CORE_ROOT || resolve(store, '../oshal'));
const candidates = [process.env.STORE_CI_TOOLCHAIN, resolve(store, 'scripts/toolchain/node_modules'), resolve(core, 'node_modules')].filter(Boolean);
const toolchain = candidates.find(directory => existsSync(resolve(directory, 'js-yaml/package.json')));
if (!toolchain) throw new Error('js-yaml requires scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const yaml = createRequire(resolve(toolchain, 'js-yaml/package.json'))('./index.js');
const group = yaml.load(readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8'));
const members = new Map(group.dependencies.required.apps.map(name => [name, yaml.load(readFileSync(resolve(store, name, 'oshal-app.yaml'), 'utf8'))]));

test('Career group retains the destinations delegated from the global Career navigation', () => {
  const delegated = ['career-board', 'career-strengthen', 'career-recruiters', 'career-insights', 'career-settings'];
  for (const merged of ['career-approvals', 'career-submissions', 'career-application-status']) {
    assert.equal(group.toolbar.some(item => item.surface === merged), false, `${merged} is a Job Board stage`);
  }
  for (const surface of delegated) assert.ok(group.toolbar.some(item => item.app === 'career-hunter' && item.surface === surface), surface);
});

test('the Resume band carries the Master record, borrowed from Career by surface name', () => {
  const item = group.toolbar.find(entry => entry.app === 'career-hunter' && entry.surface === 'career-master-record');
  assert.equal(item?.group, 'Resume');
  const surface = members.get('career-hunter').ui.static.find(entry => entry.toolName === 'career-master-record');
  assert.equal(surface?.iframeUrl, '/api/career-hunter/master-record-ui');
  assert.equal(surface.group, 'Resume');
});

test('every shipped toolbar reference resolves once to its declared member rather than a copied URL', () => {
  const seen = new Set();
  for (const item of group.toolbar) {
    assert.ok(members.has(item.app), item.app);
    assert.equal(members.get(item.app).ui.static.filter(surface => surface.toolName === item.surface).length, 1, item.surface);
    assert.equal(seen.has(`${item.app}/${item.surface}`), false); seen.add(`${item.app}/${item.surface}`);
    assert.equal(Object.hasOwn(item, 'iframeUrl'), false);
  }
  for (const key of ['routes', 'tools', 'migrations', 'uses', 'ui']) assert.equal(Object.hasOwn(group, key), false, key);
});

test('Career configuration and sources are a visible borrowed navigation band', () => {
  assert.equal(group.kind, 'group');
  assert.equal(group.version, '1.1.13');
  assert.equal(group.chatBot, members.get('career-hunter').chatBot, 'the group\'s concierge is Career\'s own (1.1.12)');
  assert.deepEqual([...members.keys()], ['career-hunter', 'portrait-studio', 'social']);
  for (const surface of ['career-settings', 'career-companies']) {
    const item = group.toolbar.find(item => item.app === 'career-hunter' && item.surface === surface);
    assert.equal(item?.group, 'Configuration', surface);
    assert.equal(item.section, undefined, 'configuration is not confined to the bottom tray');
  }
  assert.equal(group.toolbar.some(item=>item.surface==='social-accounts'),false);
  assert.equal(group.setup.some(item=>item.app==='social'&&item.readiness==='facebook'),false);
  assert.ok(group.setup.length>0);
  for(const step of group.setup){
    if(step.fix)assert.ok(group.toolbar.some(item=>item.app===step.app&&item.surface===step.fix),step.fix);
  }
  assert.equal(group.experience, undefined, 'the group keeps its no-code contract; Career Hunter owns the authenticated experience');
});

test('the group manifest does not mention print-ingest', () => {
  const content = readFileSync(resolve(root, 'oshal-app.yaml'), 'utf8');
  assert.equal(content.includes('print-ingest'), false, 'no mention of print-ingest should remain');
});

 test('Career opens on Home, then Search Jobs, and excludes the global Tickets workbench', () => {
  assert.equal(group.ribbon.defaultView, 'career-hunter--career-home');
  assert.ok(group.ribbon.hideFrameworkItems.includes('tickets'));
  assert.equal(group.toolbar[0].surface, 'career-home');
  assert.equal(group.toolbar[0].group, undefined, 'Home leads the bar ungrouped');
  assert.equal(group.toolbar[1].surface, 'career-search');
  for (const surface of ['career-board','career-submission-activity']) assert.ok(group.toolbar.some(item => item.surface===surface));
  const search = members.get('career-hunter').ui.static.find(item => item.toolName === group.ribbon.defaultView.split('--')[1]);
  assert.equal(search?.iframeUrl, '/api/career-hunter/home');
  assert.ok(group.toolbar.some(item => item.app === 'career-hunter' && item.surface === group.ribbon.defaultView.split('--')[1]));
});
