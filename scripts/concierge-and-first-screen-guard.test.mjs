/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Store CI structural guards for Deliverable A3: (Check A) every active application package in oshal-apps that is neither an experience nor an intentional headless service without ticketType declares its own first screen rather than dropping people onto the generic ticket queue or another application's surface; (Check B) every active store package declaring chatBot (or bots with a UI surface) mounts the core Jarvis concierge chat window (/api/jarvis/, jarvis-chat-frame.js or editor-assistant.js) rather than shipping a new bespoke HTML/JS chat form.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Shopping 1.5.1: remove purchasing/tools/shopping-chat.html from PENDING_BESPOKE_CHAT_SURFACES now that it mounts jarvis-chat-frame.js.
 * 3   | maintainer@emeraldcoastsystemsgroup.com | Phone & Device Control 1.20.3: remove phone-control/tools/computer-link.js from PENDING_BESPOKE_CHAT_SURFACES now that phone-control mounts jarvis-chat-frame.js.
 * 4   | maintainer@emeraldcoastsystemsgroup.com | Intelligent Operations 1.9.4: remove experience/command-helper.js, experience/console.js, and experience/pod-console.js from PENDING_BESPOKE_CHAT_SURFACES now that all three mount jarvis-chat-frame.js.
 * 5   | maintainer@emeraldcoastsystemsgroup.com | Little Monsters 1.9.4: remove little-monsters/tools/tutor-chat.html from PENDING_BESPOKE_CHAT_SURFACES now that Class Tutor mounts jarvis-chat-frame.js, ratcheting pending bespoke concierge surfaces across the store to zero.
 * 6   | maintainer@emeraldcoastsystemsgroup.com | Engineering shelf 1.0.0: add engineering-shelf to HEADLESS_BACKEND_PACKAGES. It declares one role across the five engineering applications and has no screen, bot, tool or ticketType; it is hidden from the application lists, so there is no first screen for a person to be dropped onto.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(TOOLCHAIN, 'package.json'))('js-yaml');

/**
 * Pure backend/system packages that intentionally declare no UI surface AND omit ticketType.
 * A package that declares ticketType with empty ui.static lands on the generic ticket queue and is NEVER exempt here.
 */
export const HEADLESS_BACKEND_PACKAGES = new Set([
  'devops',
  'dev-workspace-index',
  'engineering-shelf',
  'daily-trade-recap',
  'hello-oshal',
  'program-instructions',
]);

/** Explicit operator-queue whitelist (empty: every active application tile opens its own first screen). */
export const ALLOW_TICKET_QUEUE_LANDING = new Set([]);

/** Multiplayer tabletop narration and physical-prop voice loops that are gameplay/hardware surfaces, not concierge chat. */
export const NON_CONCIERGE_DOMAIN_SURFACES = new Set([
  'dnd/ui/table-combat-narration.js',
  'dnd/ui/table-story.js',
  'pumpkin/tools/pumpkin-projector.js',
]);

/**
 * Legacy non-Create surfaces on main still awaiting migration onto jarvis-chat-frame.js.
 * Any newly added bespoke chat surface fails immediately; a migrated surface must be removed from this set.
 */
export const PENDING_BESPOKE_CHAT_SURFACES = new Set([]);

const BESPOKE_ENDPOINT_RE = /(?:\/api\/[a-z0-9-]+|\$\{[^}]+\}|['"`]\s*\+)\s*\/(?:[a-z0-9-]+\/)*(?:chat|concierge\/turn|assistant|tutor-chat)(?![A-Za-z0-9_/-])/g;
const RELATIVE_POST_CHAT_RE = /\b(?:api|call|fetch|postJson|jpost)\s*\(\s*(?:['"`]POST['"`]\s*,\s*)?['"`]\/(?:chat|concierge\/turn|assistant|tutor-chat)['"`]/g;
const DIRECT_BOT_ASK_RE = /\/api\/jarvis\/ask(?![/\w-])|\/api\/swarm\/bots\/[^"'`\s]+\/ask(?![/\w-])/g;
const SIMPLE_CHAT_RE = /\/shared\/ui\/js\/simple-chat\.js\b/g;
const CORE_CONCIERGE_RE = /\/api\/jarvis\/|\/shared\/ui\/js\/(?:jarvis-chat-frame|editor-assistant)\.js\b/;

/** List sorted package directories containing oshal-app.yaml. */
export function listPackageDirs(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
}

/** Strip JS and HTML comments so historical changelog notes do not trigger code checks. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Resolve the primary landing surface URL declared by a non-group manifest. */
function resolveLandingUrl(manifest) {
  const statics = Array.isArray(manifest.ui?.static) ? manifest.ui.static : [];
  const dynamic = manifest.ui?.dynamic && typeof manifest.ui.dynamic === 'object' ? manifest.ui.dynamic : null;
  const defaultView = typeof manifest.ribbon?.defaultView === 'string' ? manifest.ribbon.defaultView.trim() : '';
  if (defaultView && statics.length > 0) {
    const matched = statics.find((item) => (item.toolName || item.id) === defaultView);
    if (!matched && !dynamic) return { missingDefault: defaultView, url: '' };
    if (matched) return { missingDefault: '', url: String(matched.iframeUrl || matched.route || matched.url || '').trim() };
  }
  const first = statics[0];
  if (first) return { missingDefault: '', url: String(first.iframeUrl || first.route || first.url || '').trim() };
  if (dynamic) return { missingDefault: '', url: String(dynamic.iframeUrlTemplate || '').trim() };
  return { missingDefault: '', url: '' };
}

/** Whether a landing URL belongs to this package (or to a declared optional member of a pure launcher). */
function ownsLandingUrl(dir, manifest, url) {
  const pkg = String(manifest.name || dir).trim();
  const mounts = (Array.isArray(manifest.routes) ? manifest.routes : [])
    .map((route) => String(route?.mountPath || '').trim())
    .filter(Boolean);
  const prefixes = new Set([`/api/${pkg}`, `/api/${dir}`, `/apps/${pkg}`, `/apps/${dir}`, ...mounts]);
  if (pkg === 'storage') prefixes.add('/api/files');
  for (const prefix of prefixes) {
    if (url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)) return true;
  }
  const optionalApps = Array.isArray(manifest.dependencies?.optional?.apps) ? manifest.dependencies.optional.apps : [];
  const isPureLauncher = !manifest.ticketType && !(Array.isArray(manifest.bots) && manifest.bots.length > 0) && optionalApps.length > 0;
  if (!isPureLauncher) return false;
  if (url === '/utilities') return true;
  return optionalApps.some((member) => url === `/api/${member}` || url.startsWith(`/api/${member}/`));
}

/** Check A: audit every active store package for an owned, non-ticket-queue first screen. */
export function auditFirstScreens(root) {
  const problems = [];
  for (const dir of listPackageDirs(root)) {
    const manifest = yaml.load(fs.readFileSync(path.join(root, dir, 'oshal-app.yaml'), 'utf8')) || {};
    if (manifest.status !== 'active') continue;
    const uses = Array.isArray(manifest.uses) ? manifest.uses : [];
    if (uses.includes('experience')) continue;
    if (manifest.kind === 'group') {
      const toolbar = Array.isArray(manifest.toolbar) ? manifest.toolbar : [];
      const requiredApps = new Set([dir, manifest.name, ...(manifest.dependencies?.required?.apps || [])].filter(Boolean));
      if (!toolbar.length) problems.push(`${dir}: active group declares an empty toolbar`);
      else if (!requiredApps.has(toolbar[0]?.app)) {
        problems.push(`${dir}: group first toolbar surface borrows "${toolbar[0]?.app}", which is not a required member`);
      }
      continue;
    }
    const { missingDefault, url } = resolveLandingUrl(manifest);
    if (missingDefault) {
      problems.push(`${dir}: ribbon.defaultView "${missingDefault}" matches no ui.static surface`);
      continue;
    }
    if (!url) {
      if (manifest.ticketType) {
        if (!ALLOW_TICKET_QUEUE_LANDING.has(dir)) {
          problems.push(`${dir}: active package declares ticketType "${manifest.ticketType}" with no own first screen (ui.static / ui.dynamic empty) — lands on the generic ticket queue`);
        }
      } else if (!HEADLESS_BACKEND_PACKAGES.has(dir)) {
        problems.push(`${dir}: active package declares no own first screen (ui.static / ui.dynamic empty)`);
      }
      continue;
    }
    if (/^\/(?:cockpit\/)?tickets(?:[/?]|$)|[?&]ticket=/i.test(url)) {
      problems.push(`${dir}: first screen "${url}" lands on the generic ticket queue instead of ${dir}'s own screen`);
      continue;
    }
    if (!ownsLandingUrl(dir, manifest, url)) {
      problems.push(`${dir}: first screen "${url}" points outside ${manifest.name || dir}'s own routes`);
    }
  }
  return problems;
}

/** Collect UI source files (and HTML-bearing route files) inside one package folder. */
function listUiFiles(pkgRoot, acc = []) {
  for (const entry of fs.readdirSync(pkgRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (['node_modules', 'dist', 'build', 'tests', 'migrations', 'engine', 'personas', 'docs', 'src-routes'].includes(entry.name)) continue;
    const full = path.join(pkgRoot, entry.name);
    if (entry.isDirectory()) listUiFiles(full, acc);
    else if (/\.(?:html|js|mjs|cjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Detect bespoke chat calls in a single client/UI source string (comments already stripped). */
function detectBespokeChatTokens(code) {
  if (CORE_CONCIERGE_RE.test(code)) return [];
  const raw = [
    ...(code.match(BESPOKE_ENDPOINT_RE) || []),
    ...(code.match(RELATIVE_POST_CHAT_RE) || []),
    ...(code.match(DIRECT_BOT_ASK_RE) || []),
    ...(code.match(SIMPLE_CHAT_RE) || []),
  ];
  return [...new Set(raw.map((token) => token.trim()))].filter((token) => !token.endsWith('/assistant/ui'));
}

/** Check B: audit every active store package with chatBot (or bots + UI surface) for bespoke chat forms. */
export function auditBespokeConciergeForms(root) {
  const findings = [];
  for (const dir of listPackageDirs(root)) {
    const manifest = yaml.load(fs.readFileSync(path.join(root, dir, 'oshal-app.yaml'), 'utf8')) || {};
    if (manifest.status !== 'active') continue;
    const hasUi = Boolean((manifest.ui?.static || []).length || manifest.ui?.dynamic || (manifest.toolbar || []).length);
    const hasConcierge = Boolean((typeof manifest.chatBot === 'string' && manifest.chatBot.trim())
      || (Array.isArray(manifest.bots) && manifest.bots.length > 0 && hasUi));
    if (!hasConcierge) continue;
    for (const file of listUiFiles(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (NON_CONCIERGE_DOMAIN_SURFACES.has(rel)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (rel.includes('/routes/') && !/<!doctype html|<html[\s>]/i.test(source)) continue;
      const tokens = detectBespokeChatTokens(stripComments(source));
      if (tokens.length > 0) findings.push({ pkg: dir, file: rel, tokens });
    }
  }
  return findings;
}

/** Ratchet helper matching check-store-bots.mjs: new bespoke files and stale pending entries both fail. */
export function unexpectedBespoke(findings, pending = PENDING_BESPOKE_CHAT_SURFACES) {
  const foundFiles = new Set(findings.map((item) => item.file));
  const unexpected = findings
    .filter((item) => !pending.has(item.file))
    .map((item) => `${item.file} ships bespoke chat (${item.tokens.join(', ')}) instead of framing /api/jarvis/ or jarvis-chat-frame.js`);
  const stale = [...pending]
    .filter((file) => !foundFiles.has(file))
    .map((file) => `pending bespoke chat entry no longer violates; remove it from PENDING_BESPOKE_CHAT_SURFACES: ${file}`);
  return [...unexpected, ...stale];
}

/** Build a disposable store tree for unit/mutation checks. */
function makeStoreFixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-concierge-first-screen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : yaml.dump(content));
  }
  return dir;
}

test('Check A unit contract: refuses ticketType without UI, cross-app first screens, and broken group toolbars', (t) => {
  const root = makeStoreFixture(t, {
    'valid-app/oshal-app.yaml': {
      name: 'valid-app', status: 'active', ticketType: 'valid-work',
      routes: [{ mountPath: '/api/valid-app', module: 'routes/index.js' }],
      ui: { static: [{ toolName: 'valid-home', iframeUrl: '/api/valid-app/home' }] },
    },
    'broken-queue/oshal-app.yaml': {
      name: 'broken-queue', status: 'active', ticketType: 'broken-queue', ui: { static: [] },
    },
    'wrong-target/oshal-app.yaml': {
      name: 'wrong-target', status: 'active',
      routes: [{ mountPath: '/api/wrong-target', module: 'routes/index.js' }],
      ui: { static: [{ toolName: 'wrong-home', iframeUrl: '/api/other-app/home' }] },
    },
    'experience-pkg/oshal-app.yaml': {
      name: 'experience-pkg', status: 'active', uses: ['experience'], ui: { static: [] },
    },
    'program-instructions/oshal-app.yaml': {
      name: 'program-instructions', status: 'active', ui: { static: [] },
    },
  });
  const problems = auditFirstScreens(root);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /^broken-queue: active package declares ticketType "broken-queue" with no own first screen/);
  assert.match(problems[1], /^wrong-target: first screen "\/api\/other-app\/home" points outside wrong-target's own routes$/);
});

test('Check B unit contract: refuses bespoke chat endpoints unless jarvis-chat-frame or editor-assistant is mounted', (t) => {
  const root = makeStoreFixture(t, {
    'bespoke-app/oshal-app.yaml': {
      name: 'bespoke-app', status: 'active', chatBot: 'bespoke-concierge',
      ui: { static: [{ toolName: 'main', iframeUrl: '/api/bespoke-app/ui' }] },
    },
    'bespoke-app/tools/app.html': '<script>fetch("/api/bespoke-app/chat", { method: "POST" });</script>',
    'core-editor/oshal-app.yaml': {
      name: 'core-editor', status: 'active', chatBot: 'core-concierge',
      ui: { static: [{ toolName: 'main', iframeUrl: '/api/core-editor/ui' }] },
    },
    'core-editor/tools/editor.mjs': 'import { createEditorAssistant } from "/shared/ui/js/editor-assistant.js";',
    'core-frame/oshal-app.yaml': {
      name: 'core-frame', status: 'active', chatBot: 'frame-concierge',
      ui: { static: [{ toolName: 'main', iframeUrl: '/api/core-frame/ui' }] },
    },
    'core-frame/tools/frame.html': '<script type="module">import { mountJarvisChat } from "/shared/ui/js/jarvis-chat-frame.js";</script>',
  });
  const findings = auditBespokeConciergeForms(root);
  assert.deepEqual(findings.map((item) => item.file), ['bespoke-app/tools/app.html']);
  assert.equal(unexpectedBespoke(findings, new Set()).length, 1);
  assert.match(unexpectedBespoke([], new Set(['stale/tools/chat.html']))[0], /no longer violates/);
});

test('Check A store catalog: every active non-experience package owns its first screen', () => {
  const problems = auditFirstScreens(ROOT);
  assert.deepEqual(problems, [], `Active packages without an owned first screen:\n${problems.join('\n')}`);
});

test('Check B store catalog: zero Create bespoke chat forms and zero unratcheted bespoke concierge surfaces', (t) => {
  const findings = auditBespokeConciergeForms(ROOT);
  const strict = process.env.OSHAL_CONCIERGE_GUARD_STRICT === '1';
  t.diagnostic(`bespoke chat surfaces remaining on main (${findings.length}): ${findings.map((f) => f.file).join(', ')}`);
  const createSuiteViolations = findings.filter((item) => {
    const manifest = yaml.load(fs.readFileSync(path.join(ROOT, item.pkg, 'oshal-app.yaml'), 'utf8')) || {};
    return manifest.suite === 'ai-creative' || item.pkg === 'presentations';
  });
  assert.deepEqual(createSuiteViolations, [], 'Create and AI Office surfaces must never ship bespoke chat forms');
  const failures = unexpectedBespoke(findings, strict ? new Set() : PENDING_BESPOKE_CHAT_SURFACES);
  assert.deepEqual(failures, [], failures.join('\n'));
});
