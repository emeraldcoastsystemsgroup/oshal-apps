/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Store CI browser guard for Deliverable A3 (Check C): mount the pinned kernel platform (/shared/ui, /cockpit/css/themes, Today shell and /api/jarvis/ concierge stub) alongside all ten Create editor surfaces (create, presentations, portrait-studio, video, publishing-studio, brand-graphics, motion-studio, scene-studio, vids, pdf-workbench), open each at 1440x900 and 412x915 (touch), press its concierge entry point with real Playwright pointer events, and assert /api/jarvis/?concierge=<app> opens visibly on screen with a human concierge name, New conversation, Recent conversations and #jarvisModelBtn.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const requireToolchain = createRequire(path.join(TOOLCHAIN, 'package.json'));
const express = requireToolchain('express');
const yaml = requireToolchain('js-yaml');
const { chromium } = requireToolchain('playwright');

const NAMED_PLATFORM = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_PLATFORM_ROOT;
if (!NAMED_PLATFORM || !fs.existsSync(path.resolve(NAMED_PLATFORM, 'src/shared/ui/js/editor-foundation.js'))) {
  throw new Error(
    `Create concierge browser guard requires OSHAL_KERNEL_PLATFORM (or OSHAL_PLATFORM_ROOT) holding src/shared/ui (got ${JSON.stringify(NAMED_PLATFORM ?? null)})`,
  );
}
const PLATFORM = path.resolve(NAMED_PLATFORM);

const VIEWPORTS = [
  { label: '1440x900', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { label: '412x915', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
];

export const CREATE_SURFACES = [
  { id: 'create', app: 'create', screen: 'create-editor', expectedConcierge: 'create' },
  { id: 'presentations', app: 'presentations', screen: 'presentations-studio', expectedConcierge: 'presentations' },
  { id: 'portrait-studio', app: 'portrait-studio', screen: 'portrait-studio', expectedConcierge: 'portrait-studio' },
  { id: 'create-portrait', app: 'create', screen: 'create-portrait', expectedConcierge: 'portrait-studio' },
  { id: 'video', app: 'video', screen: 'video-editor', expectedConcierge: 'video' },
  { id: 'publishing-studio', app: 'publishing-studio', screen: 'publishing-studio', expectedConcierge: 'publishing-studio' },
  { id: 'brand-graphics', app: 'brand-graphics', screen: 'brand-graphics', expectedConcierge: 'brand-graphics' },
  { id: 'motion-studio', app: 'motion-studio', screen: 'motion-studio-editor', expectedConcierge: 'motion-studio' },
  { id: 'scene-studio', app: 'scene-studio', screen: 'scene-studio', expectedConcierge: 'scene-studio' },
  { id: 'vids', app: 'vids', screen: 'vids-studio', expectedConcierge: 'vids' },
  { id: 'pdf-workbench', app: 'pdf-workbench', screen: 'pdf-workbench', expectedConcierge: 'pdf-workbench' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_BOT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** Load and cache store manifests keyed by package directory/name. */
function loadManifestMap() {
  const map = new Map();
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const file = path.join(ROOT, entry.name, 'oshal-app.yaml');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const manifest = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    map.set(entry.name, manifest);
    if (manifest.name) map.set(manifest.name, manifest);
  }
  return map;
}

/** Extract the Studio HTML served by vids/routes/vids-routes.js without importing runtime dependencies. */
function extractVidsStudioHtml() {
  const source = fs.readFileSync(path.join(ROOT, 'vids', 'routes', 'vids-routes.js'), 'utf8');
  const match = source.match(/`(<!doctype html>[\s\S]*?<\/html>)`/i);
  assert.ok(match, 'vids/routes/vids-routes.js embeds its <!doctype html> template');
  return new Function(`return \`${match[1]}\`;`)();
}

/** Render the deterministic /api/jarvis/ concierge frame stub matching jarvis-conversation.js + jarvis-model-menu.js. */
function renderJarvisConciergeStub() {
  return `<!doctype html><html lang="en" data-theme="light-blue"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Concierge</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;height:100%;font:14px/1.4 system-ui,sans-serif;background:#fff;color:#0f172a}
  body{display:flex;flex-direction:column}.jc-header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #cbd5e1;min-height:44px}
  .jc-identity{display:flex;flex-direction:column;min-width:0;flex:1}.jc-name{font-weight:700;font-size:13px}
  .jc-title{font-size:12px;color:#475569}.jc-transcript{flex:1;padding:12px;overflow:auto}
  .jc-composer{padding:8px 10px;border-top:1px solid #cbd5e1;display:flex;flex-direction:column;gap:6px}
  button{min-width:32px;min-height:32px;cursor:pointer}textarea{width:100%;min-height:40px}
</style></head><body class="jarvis-chat jarvis-concierge">
<header class="jc-header">
  <button type="button" aria-label="Recent conversations">☰</button>
  <div class="jc-identity"><span class="jc-name" id="jcName"></span><strong class="jc-title">New conversation</strong></div>
  <button type="button" aria-label="New conversation">+</button>
  <button type="button" class="jc-panel-control jc-panel-close" id="jcClose" aria-label="Close the assistant">×</button>
</header>
<main class="jc-transcript"><p class="jc-concierge-help" id="jcHelp"></p></main>
<form id="typer" class="jc-composer">
  <textarea id="typein" class="jc-input" rows="1"></textarea>
  <div><button type="button" id="jarvisModelBtn" class="jmm-trigger"><span class="jmm-trigger-label">Automatic</span> ▾</button>
  <button type="submit" aria-label="Send">Send</button></div>
</form>
<script>
  const params = new URLSearchParams(location.search);
  const title = (params.get('title') || 'Concierge').trim();
  document.getElementById('jcName').textContent = title;
  document.getElementById('typein').placeholder = 'Ask ' + title + '…';
  if (window.parent !== window) {
    const post = (action) => window.parent.postMessage({ type: 'oshal-orb', action }, location.origin);
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin || ev.source !== window.parent || !ev.data) return;
      if (ev.data.type === 'oshal-orb-host') post('docked');
      if (ev.data.type === 'oshal-concierge-host' && ev.data.help) document.getElementById('jcHelp').textContent = ev.data.help;
    });
    document.getElementById('jcClose').addEventListener('click', () => post('close'));
    post('ready');
  }
</script></body></html>`;
}

/** Find which store manifest owns an iframe route prefix, mirroring crates/api/src/ui_applications.rs. */
function findRouteOwner(manifests, rawUrl) {
  const clean = String(rawUrl || '').split(/[?#]/)[0];
  let best = null;
  for (const manifest of new Set(manifests.values())) {
    for (const route of manifest.routes || []) {
      const prefix = String(route.mountPath || '').replace(/\/+$/, '');
      if (!prefix) continue;
      if (clean === prefix || clean.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.len) best = { len: prefix.length, manifest };
      }
    }
  }
  return best?.manifest || null;
}

/** Build the deterministic /api/swarm/bots/registry list from loaded store manifests. */
function buildBotRegistry(manifests) {
  const bots = [];
  for (const manifest of new Set(manifests.values())) {
    for (const bot of manifest.bots || []) {
      bots.push({
        name: bot.name,
        agentId: bot.agentId || bot.name,
        displayName: bot.displayName || `${manifest.displayName || manifest.name} concierge`,
        package: manifest.name,
        declared: true,
        routable: true,
        availability: 'available',
      });
    }
  }
  return bots;
}

/** Build the /api/ui/profile payload Today's shell consumes for one requested application. */
function buildProfileResponse(manifests, appName) {
  const manifest = manifests.get(appName);
  assert.ok(manifest, `Unknown store manifest: ${appName}`);
  const botId = String(manifest.chatBot || manifest.bots?.[0]?.name || 'concierge');
  const botRow = (manifest.bots || []).find((item) => item.name === botId) || { agentId: botId, name: botId };
  const botEntry = {
    agentId: botRow.agentId || botId,
    name: botRow.name || botId,
    displayName: botRow.displayName || `${manifest.displayName || appName} concierge`,
  };
  const items = (manifest.ui?.static || []).map((tile) => {
    const owner = findRouteOwner(manifests, tile.iframeUrl);
    const ops = Array.isArray(owner?.surface?.ops) ? owner.surface.ops : null;
    return {
      id: `tool-${tile.toolName}`,
      label: tile.label,
      icon: tile.icon || 'codicon codicon-app',
      section: tile.section || 'top',
      group: tile.group || null,
      toolUi: { iframeUrl: tile.iframeUrl, sidebarLabel: tile.label, surfaceBinding: owner && ops ? { app: owner.name, ops } : null },
    };
  });
  const def = manifest.ribbon?.defaultView || manifest.ui?.static?.[0]?.toolName || 'main';
  const profile = {
    name: manifest.name, displayName: manifest.displayName || manifest.name, theme: manifest.theme || null,
    suite: manifest.suite || 'ai-creative', ribbon: { items }, chatBots: [botEntry], chatAgent: botEntry,
    assistant: null, hideChatPanel: Boolean(manifest.ribbon?.hideChatPanel), hideAssistant: false,
    hideStatusBar: Boolean(manifest.ribbon?.hideStatusBar), defaultView: `tool-${def}`,
  };
  return { profile, chatAgent: botEntry, bots: [botEntry], operator: false, landingApp: null, requested: appName };
}

/** Mount pinned kernel platform assets (/shared/ui, /cockpit/css/themes, Today shell, /api/jarvis/ stub). */
function mountKernelPlatform(app, manifests) {
  const jarvisStub = renderJarvisConciergeStub();
  const bots = buildBotRegistry(manifests);
  app.get('/api/jarvis/', (_req, res) => res.type('html').send(jarvisStub));
  app.get('/shared/ui/js/package-tool-cards.js', (_req, res) => res.sendFile('src/api/jarvis-package-tools.js', { root: PLATFORM }));
  app.use('/shared/ui', express.static(path.resolve(PLATFORM, 'src/shared/ui')));
  app.use('/cockpit/css/themes', express.static(path.resolve(PLATFORM, 'src/pages/cockpit/css/themes')));
  app.get('/cockpit/', (_req, res) => res.sendFile('src/pages/cockpit/index.html', { root: PLATFORM }));
  for (const [route, file, stub] of [
    ['/cockpit/js/app-handoff.js', 'src/pages/cockpit/js/app-handoff.js', 'export async function receiveHandoff(){ return null; }'],
    ['/cockpit/js/app-workflows.js', 'src/pages/cockpit/js/app-workflows.js', 'export async function mountConnectedActions(){} export async function requestHandoff(){ return null; }'],
  ]) {
    app.get(route, (_req, res) => (fs.existsSync(path.resolve(PLATFORM, file)) ? res.sendFile(file, { root: PLATFORM }) : res.type('js').send(stub)));
  }
  app.use('/cockpit/vendor', (req, res) => res.type(req.path.endsWith('.css') ? 'css' : 'js').send(''));
  app.use('/cockpit', express.static(path.resolve(PLATFORM, 'src/pages/cockpit')));
  app.use('/shared', express.static(path.resolve(PLATFORM, 'src/pages/shared')));
  app.use('/shared', express.static(path.resolve(PLATFORM, 'src/shared/ui')));
  app.get('/ui/kernel/table.js', (_req, res) => {
    const table = path.resolve(PLATFORM, '../crates/api/src/kernel_table.js');
    return fs.existsSync(table) ? res.type('js').sendFile(table) : res.type('js').send('window.OshalTable = window.OshalTable || {};');
  });
  app.get('/ui/kernel/screen.css', (_req, res) => res.type('css').send(''));
  app.get('/api/artifacts/picker.js', (_req, res) => res.type('js').send('window.oshalPickArtifact = async () => null;'));
  app.get('/api/artifacts/send-to.js', (_req, res) => res.type('js').send(''));
  app.get('/experience/location-reporter.js', (_req, res) => res.type('js').send(''));
  app.get('/api/auth/user', (_req, res) => res.json({ authenticated: true, user: { sub: 'ada-example', name: 'Ada Example' } }));
  app.get('/api/cli-tokens/whoami', (_req, res) => res.json({ operator: false }));
  app.get('/api/agents', (_req, res) => res.json({ agents: bots }));
  app.get('/api/swarm/bots/registry', (_req, res) => res.json({ total: bots.length, bots }));
  app.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  app.post('/api/cockpit/recents', (_req, res) => res.json({ ok: true }));
  app.get('/api/cockpit/recents', (_req, res) => res.json({ recents: [] }));
  app.get('/api/persistence/status', (_req, res) => res.json({ ok: true, durable: true }));
  app.get('/api/metrics/summary', (_req, res) => res.json({ ok: true }));
  app.get('/api/ui/profile', (req, res) => {
    const requested = String(req.query.name || req.query.profile || req.query.app || 'create');
    res.json(buildProfileResponse(manifests, requested));
  });
}

/** Mount all ten Create editor HTML surfaces, static modules, and read-only synthetic JSON state. */
function mountCreateEditorSurfaces(app, vidsHtml) {
  const fullPerms = { view: true, read: true, create: true, change: true, delete: true, export: true, generate: false };
  app.get('/api/create/home', (_req, res) => res.sendFile(path.join(ROOT, 'create/tools/create-home.html')));
  app.get('/api/create/editor', (_req, res) => res.sendFile(path.join(ROOT, 'create/tools/create-editor.html')));
  app.get('/api/create/theme/create.css', (_req, res) => res.sendFile(path.join(ROOT, 'create/ui/create.css')));
  app.use('/api/create/editor', express.static(path.join(ROOT, 'create/tools/editor')));
  app.get('/api/create/permissions', (_req, res) => res.json({ permissions: fullPerms }));
  app.get('/api/create/brand-kit', (_req, res) => res.json({ kit: null }));
  app.get('/api/create/projects', (_req, res) => res.json({ projects: [] }));

  app.get('/api/presentations/editor/app', (_req, res) => res.sendFile(path.join(ROOT, 'presentations/tools/office/editor.html')));
  app.use('/api/presentations/editor/assets', express.static(path.join(ROOT, 'presentations/tools/office')));
  app.get('/api/presentations/editor/permissions', (_req, res) => res.json({ permissions: fullPerms, actorSub: 'ada-example' }));
  app.get('/api/presentations/editor/documents', (_req, res) => res.json({ documents: [] }));
  app.get('/api/presentations/sections/themes', (_req, res) => res.json({ themes: [] }));
  app.get('/api/presentations/sections/starters', (_req, res) => res.json({ starters: [] }));

  const { clientCatalog } = createRequire(import.meta.url)(path.join(ROOT, 'portrait-studio/routes/portrait-catalog.js'));
  app.get('/api/portrait-studio/app', (_req, res) => res.sendFile(path.join(ROOT, 'portrait-studio/tools/portrait-studio.html')));
  app.get('/api/portrait-studio/capture-module', (_req, res) => res.sendFile(path.join(ROOT, 'portrait-studio/tools/portrait-capture.js')));
  app.get('/api/portrait-studio/face-module', (_req, res) => res.sendFile(path.join(ROOT, 'portrait-studio/tools/portrait-face.js')));
  app.use('/api/portrait-studio', express.static(path.join(ROOT, 'portrait-studio/tools')));
  app.get('/api/portrait-studio/catalog', (_req, res) => res.json(clientCatalog()));
  app.get('/api/portrait-studio/permissions', (_req, res) => res.json({ permissions: fullPerms, unavailable: { email: true } }));
  app.get('/api/portrait-studio/provider', (_req, res) => res.json({ configured: false, provider: 'native-unconfigured' }));
  app.get('/api/portrait-studio/portraits', (_req, res) => res.json({ portraits: [] }));
  app.get('/api/portrait-studio/source-projects', (_req, res) => res.json({ projects: [] }));

  app.get('/api/video/editor', (_req, res) => res.sendFile(path.join(ROOT, 'video/tools/editor/editor.html')));
  app.use('/api/video/editor/assets', express.static(path.join(ROOT, 'video/tools/editor')));
  app.get('/api/video/editor/capabilities', (_req, res) => res.json({ permissions: fullPerms, profiles: [], speech: { available: false } }));
  app.get('/api/video/editor/projects', (_req, res) => res.json({ projects: [] }));
  app.get('/api/video/editor/media', (_req, res) => res.json({ media: [] }));
  app.get('/api/video/editor/exports', (_req, res) => res.json({ exports: [] }));
  app.get('/api/video/editor/sounds', (_req, res) => res.json({ sounds: [] }));
  app.get('/api/motion-studio/render-jobs', (_req, res) => res.json({ jobs: [] }));

  mountRemainingCreateStudios(app, fullPerms, vidsHtml);
}

/** Mount Publishing, Brand Graphics, Motion, Scene, Vids and PDF Workbench surfaces on the Express harness. */
function mountRemainingCreateStudios(app, fullPerms, vidsHtml) {
  app.get('/api/publishing-studio/app', (_req, res) => res.sendFile(path.join(ROOT, 'publishing-studio/tools/workbench.html')));
  app.use('/api/publishing-studio/ui', express.static(path.join(ROOT, 'publishing-studio/tools')));
  app.get('/api/publishing-studio/permissions', (_req, res) => res.json({ permissions: fullPerms }));
  app.get('/api/publishing-studio/documents', (_req, res) => res.json({ documents: [] }));
  app.get('/api/publishing-studio/templates', (_req, res) => res.json({ templates: [] }));
  app.get('/api/publishing-studio/social/channels', (_req, res) => res.json({ channels: [] }));
  app.get('/api/publishing-studio/social/posts', (_req, res) => res.json({ posts: [] }));

  app.get('/api/brand-graphics/review', (_req, res) => res.sendFile(path.join(ROOT, 'brand-graphics/tools/review.html')));
  app.use('/api/brand-graphics', express.static(path.join(ROOT, 'brand-graphics/tools')));
  app.get('/api/brand-graphics/home-summary', (_req, res) => res.json({ metrics: [], items: [] }));
  app.get('/api/brand-graphics/source-projects', (_req, res) => res.json({ projects: [] }));

  app.get('/api/motion-studio/app', (_req, res) => res.sendFile(path.join(ROOT, 'motion-studio/tools/workbench.html')));
  app.use('/api/motion-studio/ui', express.static(path.join(ROOT, 'motion-studio/tools')));
  app.get('/api/motion-studio/permissions', (_req, res) => res.json({ permissions: fullPerms }));
  app.get('/api/motion-studio/editing-contract', (_req, res) => res.json({
    engine: { ticksPerSecond: 60000, commands: [], effects: [], fonts: ['Inter'] },
  }));
  app.get('/api/motion-studio/projects', (_req, res) => res.json({ projects: [] }));
  app.get('/api/motion-studio/assets', (_req, res) => res.json({ assets: [] }));
  app.get('/api/motion-studio/fonts', (_req, res) => res.json({ fonts: ['Inter'] }));
  app.get('/api/motion-studio/effects', (_req, res) => res.json({ effects: [] }));

  app.get('/api/scene-studio/app', (_req, res) => res.sendFile(path.join(ROOT, 'scene-studio/tools/scene-studio.html')));
  app.use('/api/scene-studio/assets', express.static(path.join(ROOT, 'scene-studio/tools')));
  app.get('/api/scene-studio/capabilities', (_req, res) => res.json({
    access: { edit: true, execute: false }, capabilities: { versions: { godot: '4.4', blender: 'Blender 4.4' } },
  }));
  app.get('/api/scene-studio/projects', (_req, res) => res.json({ projects: [] }));

  app.get('/api/vids/app', (_req, res) => res.type('html').send(vidsHtml));
  app.get('/api/vids/source-project-editor.mjs', (_req, res) => res.sendFile(path.join(ROOT, 'vids/tools/source-project-editor.mjs')));
  app.get('/api/vids/jobs', (_req, res) => res.json({ workers: [], jobs: [] }));
  app.get('/api/vids/source-projects', (_req, res) => res.json({ projects: [] }));

  app.get('/api/pdf-workbench/app', (_req, res) => res.sendFile(path.join(ROOT, 'pdf-workbench/tools/workbench.html')));
  app.use('/api/pdf-workbench/ui', express.static(path.join(ROOT, 'pdf-workbench/tools')));
  app.get('/api/pdf-workbench/permissions', (_req, res) => res.json({ permissions: fullPerms }));
  app.get('/api/pdf-workbench/documents', (_req, res) => res.json({ documents: [] }));
  app.get('/api/pdf-workbench/sources', (_req, res) => res.json({ sources: [] }));
  app.get('/api/pdf-workbench/signatures', (_req, res) => res.json({ signatures: [] }));
}

/** Find a visibly rendered concierge trigger inside the editor frame or on Today's bar/orb. */
async function findVisibleConciergeTrigger(page, appFrame) {
  const inFrameSelectors = [
    '.ef-panes button[aria-controls$="-concierge"]',
    'button.video-concierge',
    'button.motion-concierge',
    '[data-pane="concierge"]',
    '[data-pub-tab="concierge"]',
    'button[aria-label="Concierge"]',
  ];
  for (const sel of inFrameSelectors) {
    const loc = appFrame.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return { where: `frame:${sel}`, locator: loc };
  }
  const byRole = appFrame.getByRole('button', { name: /^(?:✦\s*|💬\s*)?Concierge$/i }).first();
  if (await byRole.isVisible().catch(() => false)) return { where: 'frame:role=button[Concierge]', locator: byRole };
  for (const sel of ['.tool-view-header [data-tool-view-concierge]', '#jarvisOrbFab']) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return { where: `today:${sel}`, locator: loc };
  }
  return null;
}

/** Close an initially open desktop editor concierge via real pointer click so we test opening from closed. */
async function ensureClosedBeforePress(appFrame, press) {
  const isOpen = await appFrame.evaluate(() => {
    const host = document.querySelector('[data-editor-concierge="open"]');
    return Boolean(host);
  }).catch(() => false);
  if (!isOpen) return;
  const innerClose = appFrame.frameLocator('iframe.jarvis-chat-frame').locator('.jc-panel-close').first();
  if (await innerClose.isVisible().catch(() => false)) {
    await press(innerClose);
  } else {
    const headerClose = appFrame.locator('button[aria-label="Close concierge"]').first();
    if (await headerClose.isVisible().catch(() => false)) await press(headerClose);
  }
  await appFrame.waitForFunction(() => !document.querySelector('[data-editor-concierge="open"]'), null, { timeout: 5000 });
}

/** Locate the visibly opened /api/jarvis/?concierge=... iframe (either inside the editor or in Today's rail). */
async function locateOpenJarvisWindow(page, appFrame, viewport) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const inner = appFrame.locator('iframe.jarvis-chat-frame').first();
    if (await inner.isVisible().catch(() => false)) {
      const src = await inner.getAttribute('src').catch(() => '');
      const innerBox = src && src.startsWith('/api/jarvis/') ? await inner.boundingBox().catch(() => null) : null;
      if (innerBox && innerBox.width >= 180 && innerBox.height >= 180 && innerBox.x < viewport.width && innerBox.x + innerBox.width > 0) {
        return { src, box: innerBox, chat: appFrame.frameLocator('iframe.jarvis-chat-frame').first() };
      }
    }
    const rail = page.locator('#chatPanel:not(.collapsed) iframe#chatWorkspaceFrame').first();
    if (await rail.isVisible().catch(() => false)) {
      const src = await rail.getAttribute('src').catch(() => '');
      const railBox = src && src.startsWith('/api/jarvis/') ? await rail.boundingBox().catch(() => null) : null;
      if (railBox && railBox.width >= 180 && railBox.height >= 180 && railBox.x < viewport.width && railBox.x + railBox.width > 0) {
        return { src, box: railBox, chat: page.frameLocator('#chatPanel:not(.collapsed) iframe#chatWorkspaceFrame').first() };
      }
    }
    await page.waitForTimeout(100);
  }
  return null;
}

/** Assert the opened /api/jarvis/ window belongs to expectedConcierge and renders its core header + model controls. */
async function assertJarvisConciergeContract(opened, expectedConcierge) {
  assert.ok(opened, `Clicking Concierge must visibly open /api/jarvis/?concierge=${expectedConcierge} on screen`);
  const parsed = new URL(opened.src, 'http://127.0.0.1');
  assert.equal(parsed.pathname, '/api/jarvis/');
  assert.equal(
    parsed.searchParams.get('concierge'),
    expectedConcierge,
    `Expected concierge=${expectedConcierge}, got ${opened.src}`,
  );
  assert.ok(parsed.searchParams.get('bot'), `Missing bot parameter in ${opened.src}`);
  const nameLocator = opened.chat.locator('.jc-header .jc-name').first();
  await nameLocator.waitFor({ state: 'visible', timeout: 8000 });
  const humanName = (await nameLocator.textContent() || '').trim();
  assert.ok(humanName.length > 0, 'Concierge header .jc-name must not be blank');
  assert.equal(UUID_RE.test(humanName), false, `Concierge .jc-name must be human-readable, got UUID "${humanName}"`);
  assert.equal(RAW_BOT_ID_RE.test(humanName), false, `Concierge .jc-name must be human-readable, got bot id "${humanName}"`);
  await opened.chat.locator('button[aria-label="New conversation"]').first().waitFor({ state: 'visible', timeout: 8000 });
  await opened.chat.locator('button[aria-label="Recent conversations"]').first().waitFor({ state: 'visible', timeout: 8000 });
  await opened.chat.locator('#jarvisModelBtn').first().waitFor({ state: 'visible', timeout: 8000 });
}

let server;
let origin;
let browser;

test.before(async () => {
  const manifests = loadManifestMap();
  const app = express();
  mountKernelPlatform(app, manifests);
  mountCreateEditorSurfaces(app, extractVidsStudioHtml());
  app.use((req, res) => res.status(req.method === 'GET' ? 404 : 405).json({ error: 'fixture_unavailable', path: req.path }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
});

for (const surface of CREATE_SURFACES) {
  for (const mode of VIEWPORTS) {
    test(`${surface.id} (${mode.label}): real pointer press opens /api/jarvis/?concierge=${surface.expectedConcierge}`, { timeout: 60000 }, async (t) => {
      const context = await browser.newContext({
        viewport: mode.viewport,
        isMobile: mode.isMobile,
        hasTouch: mode.hasTouch,
        deviceScaleFactor: mode.isMobile ? 2 : 1,
      });
      await context.route('**/*', (route) => (
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
      ));
      const page = await context.newPage();
      const press = (locator) => (mode.hasTouch ? locator.tap({ timeout: 8000 }) : locator.click({ timeout: 8000 }));
      try {
        await page.goto(`${origin}/cockpit/?app=${surface.app}&screen=${surface.screen}`, { waitUntil: 'domcontentloaded' });
        const iframeEl = await page.waitForSelector('#mainContent .tool-view-container:not([hidden]) > iframe, .tool-view-container > iframe', { timeout: 15000 });
        const appFrame = await iframeEl.contentFrame();
        assert.ok(appFrame, `${surface.id}: Today mounted the application iframe`);
        await appFrame.waitForSelector('.ef-shell', { state: 'attached', timeout: 15000 });
        await page.waitForTimeout(350);
        if (!mode.isMobile) await ensureClosedBeforePress(appFrame, press);
        const trigger = await findVisibleConciergeTrigger(page, appFrame);
        assert.ok(trigger, `${surface.id} (${mode.label}): a visible Concierge entry button must be rendered on screen`);
        t.diagnostic(`${surface.id} (${mode.label}) trigger=${trigger.where}`);
        await press(trigger.locator);
        const opened = await locateOpenJarvisWindow(page, appFrame, mode.viewport);
        if (!opened) {
          const debugState = await appFrame.evaluate(() => {
            const root = document.querySelector('.ef-editor');
            const f = document.querySelector('iframe.jarvis-chat-frame');
            const r = f?.getBoundingClientRect();
            return { panel: root?.dataset.editorPanel, conc: root?.dataset.editorConcierge, src: f?.getAttribute('src'), rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
          }).catch(() => null);
          t.diagnostic(`${surface.id} (${mode.label}) debug=${JSON.stringify(debugState)}`);
        }
        await assertJarvisConciergeContract(opened, surface.expectedConcierge);
      } finally {
        await context.close();
      }
    });
  }
}
