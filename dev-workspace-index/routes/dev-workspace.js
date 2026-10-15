/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fail-closed dev-console-only cited query over the package's generated local-workspace index.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Server-verified dev mode and a Jarvis package tool. The client-set x-oshal-dev-context header is no longer an authority: a super-admin (OSHAL_DEV_CONSOLE_ENABLED + OSHAL_SUPERADMIN_SUBS, read through the framework's superadmin module) turns dev mode on for their own verified actor through same-origin POST /dev-mode, it expires by the manifest TTL and dies with the process. The in-process tool dev_workspace_search (ctx.tools.register, actor from ctx.authorization.currentActor(), never from input) returns cited doc_id/path/title/excerpt under the same gate. The default index path is now the package's own data/ file, the same default the CLI writes. Package-mode resource adapter registered for the authorization catalog.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | GET /status reports `sources`: the index's document count per source (checkout, local-notes), computed from the served index. The core live-acceptance case needs it to tell an index built without --notes-dir (tonight's handover cannot be asked for, so the case names that build step) from a handover ask that failed.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A refusal is explained in words. GET /dev-mode names the first failing check (`reason`) and the exact operator settings that turn the console and the package on (`settings`), and the surface renders every state and refusal as a sentence instead of printing the raw JSON. On the native kernel a package sees only its own operator settings (OSHAL_PACKAGE_ENV_<PACKAGE>__<NAME>; names starting OSHAL_ never reach it), so the package flag is also read as DEV_WORKSPACE_INDEX_ENABLED; both stay off unless the operator sets them.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The query field fits a phone-width screen (its fieldset grew to the 48-character input and overflowed at 412px; min-width:0 and a bounded input) and the empty answer box is hidden.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The dev-mode state line breaks inside a long setting name (OSHAL_PACKAGE_ENV_DEV_WORKSPACE_INDEX__DEV_WORKSPACE_INDEX_ENABLED is one 60-character word, which made the page 705px wide at 412px).
 * 7 | maintainer@emeraldcoastsystemsgroup.com | The page wears the framework theme. It set no color or background, so its frame was transparent and default black text sat on the dark shell, unreadable on a phone. It now links the shared surface themes (data-theme default midnight, the shell's theme followed by surface-theme.js) and paints its own background, text, fields, buttons and panels from those tokens, with dark fallbacks when the theme sheet cannot load.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: Enter in the Query field (the phone keyboard's Go) runs the search; only the Search button did.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { DevModeRegistry, isDevWorkspaceQueryAllowed, refusalReason } = require('../tools/workspace-policy');
const { readDeclaredManifest } = require('../tools/workspace-manifest');

const DEFAULT_INDEX = path.join('data', 'dev-workspace-index.json');
const TOOL_NAME = 'dev_workspace_search';
const TOOL_INPUT_KEYS = Object.freeze(['query', 'limit']);
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 10;
const EXCERPT_LENGTH = 420;
const CITATION_RULE = 'Cite the doc_id and path of every result you use; a claim without a doc_id from this index is not from the workspace.';
const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

function fault(code, status = 400, reason = null) {
  return Object.assign(new Error(code), { code, status, statusCode: status, ...(reason ? { reason } : {}) });
}

function frameworkLogger() {
  try { return require('@/shared/logger').createChildLogger({ module: 'dev-workspace-index' }); } catch { return SILENT; }
}

const PACKAGE_NAME = 'dev-workspace-index';
const PACKAGE_SETTING = 'DEV_WORKSPACE_INDEX_ENABLED';
const LEGACY_SETTINGS = Object.freeze({ devConsole: 'OSHAL_DEV_CONSOLE_ENABLED', package: 'OSHAL_DEV_WORKSPACE_INDEX_ENABLED' });

/** The operator settings that open each gate, in the names this runtime reads them by. */
function operatorSettings(superadmin) {
  if (!superadmin || typeof superadmin.operatorSetting !== 'function') return LEGACY_SETTINGS;
  return { devConsole: superadmin.operatorSetting(PACKAGE_NAME, superadmin.DEV_CONSOLE_SETTING),
    package: superadmin.operatorSetting(PACKAGE_NAME, PACKAGE_SETTING) };
}

/** The ADR-077 double gate, read from the framework; a package test injects ctx.devWorkspaceGates. */
function resolveGates(ctx, logger) {
  if (ctx.devWorkspaceGates) return { settings: LEGACY_SETTINGS, ...ctx.devWorkspaceGates };
  try {
    const superadmin = require('@/shared/middleware/superadmin');
    return { devConsoleEnabled: () => superadmin.superAdminEnabled(), isSuperAdminSub: (sub) => superadmin.isSuperAdminSub(sub),
      settings: operatorSettings(superadmin) };
  } catch (error) {
    logger.error({ err: error }, 'superadmin module unavailable; developer workspace index fails closed');
    return { devConsoleEnabled: () => false, isSuperAdminSub: () => false, settings: LEGACY_SETTINGS };
  }
}

function loadIndex(file) {
  try {
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    return index && Array.isArray(index.documents) ? index : null;
  } catch {
    return null;
  }
}

/** Document count per source (checkout, local-notes) of a loaded index. */
function sourceCounts(index) {
  return index.documents.reduce((acc, doc) => ({ ...acc, [doc.source || 'checkout']: (acc[doc.source || 'checkout'] || 0) + 1 }), {});
}

function searchIndex(index, query, limit = 5) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9_-]+/).filter((term) => term.length > 1);
  if (!terms.length) return [];
  const size = Math.min(Math.max(Number(limit) || 5, 1), MAX_LIMIT);
  return index.documents.map((doc) => {
    const haystack = `${doc.title} ${doc.path} ${doc.chunks.map((chunk) => chunk.text).join(' ')}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    const chunk = doc.chunks.find((candidate) => terms.some((term) => candidate.text.toLowerCase().includes(term)));
    return score ? { doc_id: doc.doc_id, title: doc.title, path: doc.path, source: doc.source || 'checkout', score, excerpt: chunk?.text.slice(0, EXCERPT_LENGTH) || '' } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, size);
}

function toolInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fault('invalid_tool_input');
  if (Object.keys(input).some((key) => !TOOL_INPUT_KEYS.includes(key))) throw fault('invalid_tool_input');
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > MAX_QUERY_LENGTH) throw fault('invalid_tool_input');
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT)) throw fault('invalid_tool_input');
  return { query, limit: input.limit ?? 5 };
}

function sameOrigin(req) {
  return req.get('origin') === `${req.protocol}://${req.get('host')}` && req.get('x-oshal-dev-workspace') === '1' && req.get('sec-fetch-site') !== 'cross-site';
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

/** The gate and the two operations behind it; every read of the index goes through admit(). */
function createGateway({ ctx, declared, gates, devMode, logger, indexPath }) {
  const actor = () => {
    const current = ctx.authorization?.currentActor?.();
    if (!current || current.isActive !== true || !current.sub || !current.issuer) throw fault('signed_in_owner_required', 401);
    return current;
  };
  const checks = (current) => ({
    devConsoleEnabled: gates.devConsoleEnabled() === true,
    superAdmin: gates.isSuperAdminSub(current.sub) === true,
    packageEnabled: truthy(process.env.OSHAL_DEV_WORKSPACE_INDEX_ENABLED) || truthy(process.env[PACKAGE_SETTING]),
    devMode: devMode.isEnabled(current),
  });
  const admit = (current) => {
    const evaluated = checks(current);
    if (!isDevWorkspaceQueryAllowed(evaluated)) throw fault('dev_workspace_unavailable', 403, refusalReason(evaluated));
    return evaluated;
  };
  const search = (current, query, limit) => {
    admit(current);
    const index = loadIndex(indexPath());
    if (!index) throw fault('dev_workspace_index_missing', 503);
    const results = searchIndex(index, query, limit);
    logger.info({ sub: current.sub, results: results.length, queryLength: query.length }, 'developer workspace search');
    return { query, results, collection: index.collection || declared.collection, generatedAt: index.generated_at || null, citation: CITATION_RULE };
  };
  const switchDevMode = (current, on) => {
    const reason = refusalReason({ ...checks(current), devMode: true });
    if (reason) throw fault('dev_workspace_unavailable', 403, reason);
    const state = on ? devMode.enable(current) : devMode.disable(current);
    logger.info({ sub: current.sub, enabled: state.enabled, expiresAt: state.expiresAt }, 'developer workspace dev mode switched');
    return state;
  };
  return { actor, checks, admit, search, switchDevMode };
}

/** One handler per fixed method+path; anything else falls through to the framework. */
function createHandlers(gateway, { declared, devMode, indexPath, gates }) {
  const { actor, checks, admit, search, switchDevMode } = gateway;
  return {
    'GET /app': (_req, res) => res.type('html').send(APP_HTML),
    'GET /dev-mode': (_req, res) => {
      const current = actor();
      const evaluated = checks(current);
      res.json({ superAdmin: evaluated.superAdmin, devConsoleEnabled: evaluated.devConsoleEnabled, packageEnabled: evaluated.packageEnabled, devMode: devMode.state(current), ttlMinutes: declared.devModeTtlMinutes,
        reason: refusalReason({ ...evaluated, devMode: true }), settings: gates.settings });
    },
    'POST /dev-mode': (req, res) => {
      if (!sameOrigin(req)) throw fault('same_origin_action_required', 403);
      res.json({ devMode: switchDevMode(actor(), true) });
    },
    'DELETE /dev-mode': (req, res) => {
      if (!sameOrigin(req)) throw fault('same_origin_action_required', 403);
      res.json({ devMode: switchDevMode(actor(), false) });
    },
    'GET /status': (_req, res) => {
      admit(actor());
      const index = loadIndex(indexPath());
      res.json({ enabled: true, devMode: true, indexPresent: Boolean(index), counts: index?.counts || null, sources: index ? sourceCounts(index) : null, generatedAt: index?.generated_at || null, collection: index?.collection || declared.collection });
    },
    'GET /query': (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const { query, limit } = toolInput({ query: url.searchParams.get('q') || '', ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}) });
      res.json(search(actor(), query, limit));
    },
  };
}

function dispatcher(handlers, logger) {
  return (req, res, next) => {
    const pathname = req.url.split('?')[0];
    const handler = handlers[`${req.method} ${pathname}`];
    if (!handler) { next(); return; }
    const started = Date.now();
    try {
      handler(req, res);
      logger.info({ method: req.method, path: pathname, status: res.statusCode, durationMs: Date.now() - started }, 'developer workspace route');
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 503;
      if (status >= 500) logger.error({ err: error, method: req.method, path: pathname }, 'developer workspace route failed');
      else logger.warn({ code: error?.code, reason: error?.reason, method: req.method, path: pathname }, 'developer workspace route refused');
      res.status(status).json({ error: error?.code || 'dev_workspace_unavailable', ...(error?.reason ? { reason: error.reason } : {}) });
    }
  };
}

/**
 * @description Package route factory. Serves the Developer Workspace surface, the per-actor dev-mode
 * switch and the cited query, and registers the dev_workspace_search tool. Every read of the index
 * needs the ADR-077 capability, the super-admin allowlist, the package flag and server-held dev mode.
 * @param {object} ctx Per-package framework context (appPackageDir, authorization, tools); tests inject gates and clock.
 * @returns {Function} An express-compatible (req, res, next) handler.
 */
function createDevWorkspaceIndexRoutes(ctx = {}) {
  const logger = ctx.devWorkspaceLogger || frameworkLogger();
  const packageDir = path.resolve(ctx.appPackageDir || path.resolve(__dirname, '..'));
  const declared = readDeclaredManifest(packageDir);
  const indexPath = () => path.resolve(process.env.OSHAL_DEV_WORKSPACE_INDEX_PATH || path.join(packageDir, DEFAULT_INDEX));
  const gates = resolveGates(ctx, logger);
  const devMode = ctx.devWorkspaceDevMode || new DevModeRegistry({ ttlMs: declared.devModeTtlMinutes * 60_000 });
  const gateway = createGateway({ ctx, declared, gates, devMode, logger, indexPath });

  ctx.authorization?.registerResource?.('workspace', { authorize: async ({ actor: current }) => current?.isActive === true });
  ctx.tools?.register?.(TOOL_NAME, async (input) => {
    const current = gateway.actor();
    const { query, limit } = toolInput(input);
    return gateway.search(current, query, limit);
  });
  return dispatcher(createHandlers(gateway, { declared, devMode, indexPath, gates }), logger);
}

const APP_HTML = `<!doctype html><html lang="en" data-theme="midnight"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Developer Workspace Index</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css"><script src="/shared/ui/js/surface-theme.js"></script>
<style>:root{--dw-bg:var(--bg-primary,#0f1117);--dw-panel:var(--bg-card,#171a22);--dw-text:var(--text-primary,#e6e8ee);--dw-muted:var(--text-secondary,#b4bccb);--dw-line:var(--border-color,#2e3442);--dw-accent:var(--accent-primary,#7c9cff)}
html,body{background:var(--dw-bg);color:var(--dw-text)}body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:880px}h1{font-size:1.25rem}p{color:var(--dw-text)}code{color:var(--dw-accent);overflow-wrap:anywhere}legend,label{color:var(--dw-muted)}fieldset{border:1px solid var(--dw-line);border-radius:8px;margin:12px 0;padding:12px;background:var(--dw-panel)}button,input{font:inherit;color:var(--dw-text);background:var(--dw-bg);border:1px solid var(--dw-line);border-radius:6px;padding:6px 10px}button{margin:4px 8px 4px 0;cursor:pointer}button:hover{border-color:var(--dw-accent)}pre{white-space:pre-wrap;color:var(--dw-text);background:var(--dw-panel);border:1px solid var(--dw-line);padding:12px;border-radius:8px;max-height:60vh;overflow:auto}#state{font-weight:600;overflow-wrap:anywhere}fieldset{min-width:0}input{max-width:100%;box-sizing:border-box}pre:empty{display:none}</style></head><body>
<main><h1>Developer Workspace Index</h1>
<p>A dev-console-only, cited index of this checkout's documentation for oshal developers. Build it with <code>node tools/workspace-index.js --root &lt;checkout&gt;</code> from the package. Normal conversations cannot reach it: a super-admin turns dev mode on here, and it expires or ends with the process.</p>
<fieldset><legend>Dev mode</legend><p id="state">Checking…</p><button id="on" type="button">Turn dev mode on</button><button id="off" type="button">Turn dev mode off</button></fieldset>
<fieldset><legend>Ask for a document</legend><label>Query <input id="q" placeholder="ADR-077, a backlog title, a runbook, tonight's handover" size="48"></label> <button id="go" type="button">Search</button></fieldset>
<pre id="out" aria-live="polite"></pre></main>
<script>
(function(){var base='/api/dev-workspace-index';var out=document.getElementById('out');var state=document.getElementById('state');var settings={};
function reasonText(code){var s={dev_console_disabled:'The developer console is off on this installation. The operator turns it on by setting '+(settings.devConsole||'the developer console setting')+'=true.',
 super_admin_required:'Only the installation administrator can use the developer console, and this account is not the administrator.',
 package_disabled:'The workspace index package is off. The operator turns it on by setting '+(settings.package||'the package setting')+'=true.',
 dev_mode_off:'Dev mode is off. Turn it on above to search.',
 same_origin_action_required:'That action has to come from this page; reload it and try again.',
 signed_in_owner_required:'Sign in to use the developer console.',
 dev_workspace_index_missing:'The workspace index has not been built yet. Build it with node tools/workspace-index.js --root <checkout> from the package.',
 invalid_tool_input:'Type a search of 1 to 200 characters.'};return s[code]||('The developer console refused this ('+code+').');}
function refusal(status,body){var code=(body&&(body.reason||body.error))||('HTTP '+status);return reasonText(code);}
function say(text){out.textContent=text;}
function onOff(v){return v?'on':'off';}
function call(method,path){return fetch(base+path,{method:method,credentials:'same-origin',headers:{'x-oshal-dev-workspace':'1','content-type':'application/json'}}).then(function(r){return r.json().catch(function(){return {};}).then(function(b){return {s:r.status,b:b};});});}
function refresh(){call('GET','/dev-mode').then(function(x){
 if(x.s!==200){state.textContent=refusal(x.s,x.b);return;}
 var b=x.b;settings=b.settings||{};
 var facts=' Administrator: '+(b.superAdmin?'yes':'no')+'. Developer console: '+onOff(b.devConsoleEnabled)+'. Package: '+onOff(b.packageEnabled)+'.';
 if(b.reason){state.textContent=reasonText(b.reason)+facts;return;}
 state.textContent=(b.devMode&&b.devMode.enabled?'Dev mode is on until '+new Date(b.devMode.expiresAt).toLocaleString()+'.':'Dev mode is off. Turn it on to search.')+facts;
}).catch(function(){state.textContent='The developer console could not be reached. Check the connection and reload.';});}
function toggle(method){call(method,'/dev-mode').then(function(x){say(x.s===200?(x.b.devMode&&x.b.devMode.enabled?'Dev mode is on.':'Dev mode is off.'):refusal(x.s,x.b));refresh();});}
function results(b){if(!b.results||!b.results.length)return 'No document in the index matches "'+b.query+'".';
 return b.results.map(function(r){return r.title+' ('+r.path+', '+r.doc_id+')\\n'+r.excerpt;}).join('\\n\\n')+'\\n\\n'+(b.citation||'');}
document.getElementById('on').onclick=function(){toggle('POST');};
document.getElementById('off').onclick=function(){toggle('DELETE');};
function search(){var q=document.getElementById('q').value;call('GET','/query?q='+encodeURIComponent(q)).then(function(x){say(x.s===200?results(x.b):refusal(x.s,x.b));});}
document.getElementById('go').onclick=search;
document.getElementById('q').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();search();}};
refresh();})();
</script></body></html>`;

module.exports = { CITATION_RULE, DEFAULT_INDEX, TOOL_NAME, createDevWorkspaceIndexRoutes, loadIndex, searchIndex, toolInput };
