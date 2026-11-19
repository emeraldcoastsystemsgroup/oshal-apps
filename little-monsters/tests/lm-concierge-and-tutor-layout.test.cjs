/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Little Monsters 1.9.5 Concierge restoration (hideChatPanel: false, host frame preserves #chatPanel/.panel-resize-handle without zen-mode, ui/little-monsters.css themes .jarvis-chat with --text-on-accent) and full-bleed desktop/mobile Tutor layout (zero 980px box trap, zero duplicate headers/History/New chat/outer chips when shared window mounts, native starter prompts inside window, parent theme inheritance).
 * -----------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const rawToolchain = process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts', 'toolchain');
const TOOLCHAIN = rawToolchain.endsWith('node_modules') ? rawToolchain : path.join(rawToolchain, 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const TOOLS = path.join(PKG, 'tools');

const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8'));

test('manifest restores the Concierge panel and binds chatBot class-tutor inline', () => {
  assert.notEqual(manifest.ribbon?.hideChatPanel, true, 'ribbon.hideChatPanel must not hide the Concierge panel');
  assert.equal(manifest.ribbon?.hideChatPanel, false, 'ribbon.hideChatPanel explicitly enables the Concierge panel');
  assert.equal(manifest.chatBot, 'class-tutor');
  const bot = (manifest.bots || []).find((b) => b.name === 'class-tutor');
  assert.ok(bot, 'class-tutor bot must be declared');
  assert.equal(bot.posture, 'inline');
  assert.ok(fs.existsSync(path.join(PKG, bot.persona)), 'class-tutor persona file exists');
  assert.ok((catalog.bindings?.bots || []).some((b) => b.id === bot.agentId), 'class-tutor agentId is bound in authorization.yaml');
});

test('little-monsters.css sets --text-on-accent and styles the shared Jarvis chat window for Little Monsters', () => {
  const css = fs.readFileSync(path.join(PKG, 'ui', 'little-monsters.css'), 'utf8');
  assert.match(css, /--text-on-accent:\s*#ffffff/i, 'Send button on-accent contrast token must be defined');
  assert.match(css, /\[data-theme="little-monsters"\][^{]*\.jarvis-chat/, 'little-monsters.css must theme .jarvis-chat');
  const tutorLines = fs.readFileSync(path.join(TOOLS, 'tutor-chat.html'), 'utf8').split('\n').length;
  assert.ok(tutorLines < 1000, `tools/tutor-chat.html must stay under 1,000 lines (got ${tutorLines})`);
});

test('host frame keeps the cockpit Concierge rail visible alongside Little Monsters on desktop', async () => {
  const app = express();
  app.get('/api/education/citations', (_req, res) => res.sendFile(path.join(TOOLS, 'citations.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [
    { id: 'tool-lm-dashboard', label: 'Class dashboard', toolUi: { iframeUrl: '/api/education/dashboard' } },
    { id: 'tool-lm-citations', label: 'Citations', toolUi: { iframeUrl: '/api/education/citations' } },
  ] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella Student', role: 'student' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 40, level: 1 }));
  app.get('/cockpit-host', (_req, res) => res.type('html').send(`<!DOCTYPE html>
    <html lang="en" data-theme="little-monsters">
    <head>
      <style>
        html, body { margin: 0; height: 100%; }
        .cockpit-body { display: flex; height: 100vh; }
        .main-content { flex: 1; min-width: 0; height: 100%; }
        .tool-view-container { width: 100%; height: 100%; }
        .panel-resize-handle { width: 6px; }
        .chat-panel { width: 380px; height: 100%; display: flex; flex-direction: column; }
        .chat-panel.collapsed { width: 0; overflow: hidden; }
        body.zen-mode .chat-panel, body.zen-mode .panel-resize-handle { display: none !important; }
      </style>
    </head>
    <body>
      <header class="header-bar">Cockpit</header>
      <div class="cockpit-body">
        <main class="main-content"><div class="tool-view-container"><iframe id="appFrame" src="/api/education/citations" style="border:0;width:100%;height:100%"></iframe></div></main>
        <div class="panel-resize-handle" id="resizeChat"></div>
        <aside class="chat-panel" id="chatPanel"><div>Concierge rail</div></aside>
      </div>
    </body></html>`));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));

  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/cockpit-host`);
    const frame = page.frame({ url: /\/api\/education\/citations/ });
    await frame.locator('.lm-topbar[data-lm-ready]').waitFor();

    const state = await page.evaluate(() => {
      const panel = document.getElementById('chatPanel');
      const main = document.querySelector('.main-content');
      const header = document.querySelector('.header-bar');
      return {
        zenMode: document.body.classList.contains('zen-mode'),
        headerDisplay: getComputedStyle(header).display,
        panelDisplay: getComputedStyle(panel).display,
        panelWidth: panel.getBoundingClientRect().width,
        mainWidth: main.getBoundingClientRect().width,
      };
    });
    assert.equal(state.zenMode, false, 'Little Monsters must not force body.zen-mode which hides .chat-panel');
    assert.equal(state.headerDisplay, 'none', 'cockpit header-bar remains hidden behind Little Monsters topbar');
    assert.notEqual(state.panelDisplay, 'none', 'Concierge #chatPanel must remain visible');
    assert.ok(state.panelWidth >= 350, `Concierge rail should keep its width (got ${state.panelWidth}px)`);
    assert.ok(state.mainWidth >= 900 && state.mainWidth <= 1100, `Main workspace should share width beside Concierge (got ${state.mainWidth}px)`);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('Tutor page fills desktop width (1440x900 & 1280x800), avoids duplicate headers/controls, inherits theme, and fits mobile (390x844)', async () => {
  const helperUrl = pathToFileURL(path.join(STORE, 'scripts', 'one-chat-window', 'kernel-window.mjs')).href;
  const { kernelPlatform, mountWindow, windowKernel, chatWindow } = await import(helperUrl);
  const platform = kernelPlatform(path.resolve(STORE, '..', 'oshal-kernel', 'platform'));

  const app = express();
  const kernel = windowKernel({ answer: (ask) => `Reply: ${ask.message}` });
  app.use(express.json());
  mountWindow(app, { platform, kernel });
  app.get('/api/education/tutor', (_req, res) => res.sendFile(path.join(TOOLS, 'tutor-chat.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/education/lm-voice.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-voice.js')));
  app.get('/api/swarm/apps/little-monsters/theme.css', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'little-monsters.css')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [
    { id: 'tool-lm-dashboard', label: 'Class dashboard', toolUi: { iframeUrl: '/api/education/dashboard' } },
    { id: 'tool-lm-tutor', label: 'Tutor', toolUi: { iframeUrl: '/api/education/tutor' } },
  ] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella Student', role: 'student' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 40, level: 1 }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: [{ class_id: 'c1', name: 'Biology', subject: 'Science' }] }));
  app.get('/api/education/classes/:id/materials', (_req, res) => res.json({ materials: [] }));
  app.get('/api/education/classes/:id/shared-materials', (_req, res) => res.json({ materials: [{ material_id: 'm1', title: 'Biology 2e' }] }));
  app.post('/api/education/tutor-chat', (_req, res) => res.json({ success: true, threads: [] }));
  app.get('/themed-host', (_req, res) => res.type('html').send(`<!DOCTYPE html>
    <html lang="en" data-theme="little-monsters">
    <head>
      <link id="app-package-theme-css" rel="stylesheet" href="/api/swarm/apps/little-monsters/theme.css">
      <style>html, body { margin: 0; height: 100%; } iframe { width: 100vw; height: 100vh; border: 0; display: block; }</style>
    </head>
    <body><iframe src="/api/education/tutor"></iframe></body></html>`));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));

  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto(`${base}/api/education/tutor`);
      await page.locator('#groundBadge').waitFor();
      const chat = await chatWindow(page, '#tutorChatWindow iframe.jarvis-chat-frame');
      await chat.locator('.jc-welcome .chip').first().waitFor({ state: 'visible' });

      const geom = await page.evaluate(() => {
        const shell = document.querySelector('.tutor-shell').getBoundingClientRect();
        const head = document.querySelector('.tutor-head').getBoundingClientRect();
        const frame = document.querySelector('#tutorChatWindow iframe.jarvis-chat-frame').getBoundingClientRect();
        const visible = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
        };
        return {
          vw: innerWidth,
          shellWidth: shell.width,
          frameWidth: frame.width,
          headHeight: head.height,
          dupHistoryVisible: visible('#historyBtn'),
          dupNewChatVisible: visible('#newChatBtn'),
          dupTitleVisible: visible('#tutorName'),
          outerChipsVisible: visible('#suggestions'),
          classSelectVisible: visible('#classSelect'),
          groundBadgeVisible: visible('#groundBadge'),
          moreVisible: visible('#tutorMore'),
        };
      });
      assert.ok(geom.shellWidth >= vp.width * 0.98, `${vp.width}px: .tutor-shell must fill desktop width (got ${geom.shellWidth})`);
      assert.ok(geom.frameWidth >= vp.width * 0.98, `${vp.width}px: #tutorChatWindow iframe must fill desktop width (got ${geom.frameWidth})`);
      assert.ok(geom.headHeight <= 62, `${vp.width}px: slim class bar should be <= 62px (got ${geom.headHeight})`);
      assert.equal(geom.dupHistoryVisible, false, 'outer History button must hide when shared window owns Recent conversations');
      assert.equal(geom.dupNewChatVisible, false, 'outer New chat button must hide when shared window owns New conversation');
      assert.equal(geom.dupTitleVisible, false, 'outer Class Tutor title must hide so header is not duplicated');
      assert.equal(geom.outerChipsVisible, false, 'outer clipped suggestion row must hide when prompts live inside the shared window');
      assert.equal(geom.classSelectVisible, true, 'class picker stays visible');
      assert.equal(geom.groundBadgeVisible, true, 'grounding status stays visible');
      assert.equal(geom.moreVisible, true, 'Read aloud overflow stays visible');
      assert.ok(await chat.locator('.jc-welcome .chip').count() >= 4, 'starter prompts render natively inside the shared chat window');
      await page.close();
    }

    // Hosted under little-monsters packaged skin: nested Jarvis chat iframe inherits data-theme="little-monsters" + white Send ink
    const themed = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await themed.goto(`${base}/themed-host`);
    const tutorFrame = themed.frame({ url: /\/api\/education\/tutor/ });
    await tutorFrame.locator('#tutorChatWindow iframe.jarvis-chat-frame').waitFor();
    const nested = await chatWindow(tutorFrame, '#tutorChatWindow iframe.jarvis-chat-frame');
    await nested.locator('#typer button[type="submit"]').waitFor({ state: 'visible' });
    const skin = await tutorFrame.evaluate(() => {
      const inner = document.querySelector('#tutorChatWindow iframe.jarvis-chat-frame').contentDocument;
      const sendBtn = inner.querySelector('#typer button[type="submit"]');
      return {
        outerTheme: document.documentElement.getAttribute('data-theme'),
        innerTheme: inner.documentElement.getAttribute('data-theme'),
        innerHasPkgCss: Boolean(inner.getElementById('app-package-theme-css')),
        innerBg: inner.defaultView.getComputedStyle(inner.body).backgroundColor,
        sendColor: inner.defaultView.getComputedStyle(sendBtn).color,
      };
    });
    assert.equal(skin.outerTheme, 'little-monsters');
    assert.equal(skin.innerTheme, 'little-monsters');
    assert.equal(skin.innerHasPkgCss, true);
    assert.equal(skin.innerBg, 'rgb(251, 248, 245)', 'inner chat canvas wears Little Monsters warm cream background');
    assert.equal(skin.sendColor, 'rgb(255, 255, 255)', 'Send button ink is crisp white on Little Monsters violet accent');
    await themed.close();

    // Mobile 390x844: zero horizontal overflow and unobstructed composer
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(`${base}/api/education/tutor`);
    await mobile.locator('#groundBadge').waitFor();
    const mChat = await chatWindow(mobile, '#tutorChatWindow iframe.jarvis-chat-frame');
    const mGeom = await mobile.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      frame: document.querySelector('#tutorChatWindow iframe.jarvis-chat-frame').getBoundingClientRect(),
      bottomBar: document.querySelector('.lm-bottombar')?.getBoundingClientRect() || null,
    }));
    assert.ok(mGeom.overflow <= 1, `mobile overflow must be <= 1px (got ${mGeom.overflow})`);
    assert.ok(mGeom.frame.width >= 388, `mobile chat fills width (got ${mGeom.frame.width})`);
    if (mGeom.bottomBar) {
      assert.ok(mGeom.frame.bottom <= mGeom.bottomBar.top + 1, 'mobile chat sits cleanly above the bottom nav bar');
    }
    assert.equal(await mChat.locator('#typer button[type="submit"]').isVisible(), true);
    await mobile.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
