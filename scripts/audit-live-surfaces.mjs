/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 20:10:00 | @codex-surface-audit    | Add a manifest-driven desktop/mobile and theme audit for every declared app surface.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..');
const coreDir = path.resolve(process.env.OSHAL_CORE_DIR || path.join(repoDir, '..', 'oshal'));
const coreRequire = createRequire(path.join(coreDir, 'package.json'));
const { chromium } = coreRequire('playwright');
const yaml = coreRequire('js-yaml');
const execFileAsync = promisify(execFile);

const baseUrl = String(process.env.OSHAL_SURFACE_BASE_URL || 'https://oshal.agenticfederal.us').replace(/\/+$/, '');
const outputDir = path.resolve(
  process.env.OSHAL_SURFACE_AUDIT_DIR || path.join(os.tmpdir(), 'oshal-surface-audit'),
);
const concurrency = Math.max(1, Math.min(12, Number(process.env.OSHAL_SURFACE_CONCURRENCY || 6)));
const navigationTimeout = Math.max(3_000, Number(process.env.OSHAL_SURFACE_TIMEOUT_MS || 15_000));
const captureFailures = process.env.OSHAL_SURFACE_SCREENSHOTS !== '0';
const captureAll = process.env.OSHAL_SURFACE_SCREENSHOTS === 'all';
const embedInControlPlane = process.env.OSHAL_SURFACE_EMBEDDED !== '0';

const allVariants = [
  { name: 'desktop-ocean', width: 1440, height: 900, theme: 'ocean' },
  { name: 'mobile-ocean', width: 390, height: 844, theme: 'ocean' },
  { name: 'desktop-daylight', width: 1440, height: 900, theme: 'daylight' },
];
const requestedVariants = new Set(
  String(process.env.OSHAL_SURFACE_VARIANTS || '').split(',').map((value) => value.trim()).filter(Boolean),
);
const variants = requestedVariants.size
  ? allVariants.filter((variant) => requestedVariants.has(variant.name))
  : allVariants;

function safeFileName(value) {
  return value.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 120) || 'root';
}

async function discoverSurfaces() {
  const entries = await fs.readdir(repoDir, { withFileTypes: true });
  const surfaces = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifestPath = path.join(repoDir, entry.name, 'oshal-app.yaml');
    let source;
    try {
      source = await fs.readFile(manifestPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const manifest = yaml.load(source);
    for (const surface of manifest?.ui?.static || []) {
      if (!surface?.iframeUrl) continue;
      surfaces.push({
        app: manifest.name || entry.name,
        label: surface.label || surface.toolName || surface.iframeUrl,
        toolName: surface.toolName || '',
        path: surface.iframeUrl,
      });
    }
  }
  return surfaces;
}

async function createGuestCookie() {
  let value = String(process.env.OSHAL_GUEST_COOKIE || '').trim();
  if (!value) {
    const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const { stdout } = await execFileAsync(curl, [
      '-sS',
      '-i',
      '-X',
      'POST',
      `${baseUrl}/api/guest/start?next=%2Fcockpit%2F`,
    ], { timeout: navigationTimeout });
    const match = stdout.match(/^set-cookie:\s*oshal_guest=([^;\r\n]+)/im);
    if (!match) throw new Error('Guest session did not return the oshal_guest cookie');
    value = match[1];
  }
  return {
    name: 'oshal_guest',
    value,
    domain: new URL(baseUrl).hostname,
    path: '/',
    httpOnly: true,
    secure: baseUrl.startsWith('https:'),
    sameSite: 'Lax',
  };
}

function classify(result) {
  const failures = [];
  const warnings = [];
  if (!result.responseStatus || result.responseStatus >= 400) failures.push(`HTTP ${result.responseStatus || 'no response'}`);
  if (!result.contentType.includes('text/html')) failures.push(`content-type ${result.contentType || 'missing'}`);
  if (result.finalUrl.includes('/signin') || result.finalUrl.includes('/guest')) failures.push('authentication redirect');
  if (result.runtimeError) failures.push(`runtime: ${result.runtimeError}`);
  if (result.consoleErrors.length) failures.push(`${result.consoleErrors.length} console error(s)`);
  if (result.visibleTextLength < 20) failures.push('blank or nearly blank');
  if (result.errorText) failures.push(`error copy: ${result.errorText}`);
  if (result.horizontalOverflow > 2) failures.push(`${result.horizontalOverflow}px horizontal overflow`);
  if (result.verticalOverflow > 8 && !result.canScrollVertically) failures.push('page content is clipped and cannot scroll vertically');
  if (result.overflowingElements.length) warnings.push(`${result.overflowingElements.length} element(s) cross the viewport`);
  if (!result.hasViewportMeta) warnings.push('missing viewport meta');
  if (!result.hasSharedThemeCss) warnings.push('shared theme CSS is not linked directly');
  if (!result.hasThemeScript) warnings.push('control-plane theme script is not linked directly');
  if (result.themeAttribute !== result.requestedTheme) warnings.push(`theme attribute is ${result.themeAttribute || 'unset'}; verifying computed tokens`);
  return { failures, warnings };
}

async function inspectSurface(context, surface, variant) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    const sourceUrl = message.location().url || '';
    if (message.type() === 'error' && !sourceUrl.includes('/cockpit/')) {
      consoleErrors.push(message.text().slice(0, 500));
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  let response;
  let runtimeError = '';
  let auditFrame = page.mainFrame();
  try {
    if (embedInControlPlane) {
      await page.goto(`${baseUrl}/cockpit/`, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout,
      });
      const targetUrl = new URL(surface.path, baseUrl).href;
      const responsePromise = page.waitForResponse(
        (candidate) => candidate.url() === targetUrl && candidate.request().resourceType() === 'document',
        { timeout: navigationTimeout },
      );
      await page.evaluate(({ path: iframePath, theme }) => {
        document.documentElement.dataset.theme = theme;
        const iframe = document.createElement('iframe');
        iframe.id = 'surface-audit-frame';
        iframe.src = iframePath;
        iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:transparent';
        document.body.appendChild(iframe);
      }, { path: surface.path, theme: variant.theme });
      response = await responsePromise;
      const iframe = await page.locator('#surface-audit-frame').elementHandle();
      auditFrame = await iframe.contentFrame();
      await auditFrame.waitForLoadState('domcontentloaded', { timeout: navigationTimeout });
    } else {
      response = await page.goto(`${baseUrl}${surface.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout,
      });
    }
    await page.waitForTimeout(200);
  } catch (error) {
    runtimeError = String(error?.message || error).split('\n')[0];
  }

  let metrics = {
    title: '',
    visibleTextLength: 0,
    errorText: '',
    hasViewportMeta: false,
    hasSharedThemeCss: false,
    hasThemeScript: false,
    themeAttribute: '',
    bodyBackground: '',
    bodyColor: '',
    horizontalOverflow: 0,
    verticalOverflow: 0,
    canScrollVertically: true,
    overflowingElements: [],
  };
  if (!page.isClosed()) {
    try {
      metrics = await auditFrame.evaluate(({ width, requestedTheme }) => {
        const root = document.documentElement;
        const body = document.body;
        const text = (body?.innerText || '').replace(/\s+/g, ' ').trim();
        const errorMatch = text.match(/\b(?:internal server error|application error|cannot get|not found|unauthorized|forbidden)\b/i);
        const overflowingElements = [...document.querySelectorAll('body *')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0
              && style.position !== 'fixed'
              && (rect.right > width + 2 || rect.left < -2);
          })
          .slice(0, 12)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              id: element.id || '',
              className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            };
          });
        const verticalOverflow = Math.max(0, Math.round(root.scrollHeight - innerHeight));
        const beforeScroll = root.scrollTop || body?.scrollTop || scrollY;
        if (verticalOverflow > 8) scrollTo(0, Math.min(120, verticalOverflow));
        const afterScroll = root.scrollTop || body?.scrollTop || scrollY;
        if (verticalOverflow > 8) scrollTo(0, beforeScroll);
        return {
          title: document.title,
          visibleTextLength: text.length,
          errorText: errorMatch?.[0] || '',
          hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
          hasSharedThemeCss: Boolean(document.querySelector('link[href*="/shared/ui/css/surface-themes.css"]')),
          hasThemeScript: Boolean(document.querySelector('script[src*="/shared/ui/js/surface-theme.js"]')),
          themeAttribute: root.dataset.theme || '',
          requestedTheme,
          bodyBackground: body ? getComputedStyle(body).backgroundColor : '',
          bodyColor: body ? getComputedStyle(body).color : '',
          horizontalOverflow: Math.max(0, Math.round(root.scrollWidth - innerWidth)),
          verticalOverflow,
          canScrollVertically: verticalOverflow <= 8 || afterScroll > beforeScroll,
          overflowingElements,
        };
      }, { width: variant.width, requestedTheme: variant.theme });
    } catch (error) {
      runtimeError ||= `inspection failed: ${error.message}`;
    }
  }

  const headers = response?.headers() || {};
  const result = {
    ...surface,
    variant: variant.name,
    requestedTheme: variant.theme,
    responseStatus: response?.status() || 0,
    contentType: headers['content-type'] || '',
    finalUrl: auditFrame.url(),
    runtimeError,
    consoleErrors: [...new Set(consoleErrors)],
    ...metrics,
  };
  Object.assign(result, classify(result));

  if (captureFailures && (captureAll || result.failures.length)) {
    const screenshotDir = path.join(outputDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });
    try {
      await page.screenshot({
        path: path.join(screenshotDir, `${surface.app}-${safeFileName(surface.path)}-${variant.name}.png`),
        fullPage: false,
        timeout: 5_000,
      });
    } catch {
      // A navigation failure may leave no document to capture.
    }
  }
  await page.close();
  return result;
}

async function mapConcurrent(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        results[index] = { ...items[index], failures: [String(error?.message || error)], warnings: [] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const requestedApps = new Set(
  String(process.env.OSHAL_SURFACE_APPS || '').split(',').map((value) => value.trim()).filter(Boolean),
);
const requestedPaths = new Set(
  String(process.env.OSHAL_SURFACE_PATHS || '').split(';').map((value) => value.trim()).filter(Boolean),
);
const surfaces = (await discoverSurfaces()).filter(
  (surface) => (requestedApps.size === 0 || requestedApps.has(surface.app))
    && (requestedPaths.size === 0 || requestedPaths.has(surface.path)),
);
const jobs = variants.flatMap((variant) => surfaces.map((surface) => ({ surface, variant })));
await fs.mkdir(outputDir, { recursive: true });
await fs.rm(path.join(outputDir, 'screenshots'), { recursive: true, force: true });

const browser = await chromium.launch({ headless: true });
const contexts = new Map();
const guestCookie = await createGuestCookie();
for (const variant of variants) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: variant.height },
    // Keep the operating-system preference fixed. The control plane's saved theme,
    // not prefers-color-scheme, must be what changes a surface.
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((theme) => {
    localStorage.setItem('cockpit-theme', theme);
  }, variant.theme);
  await context.addCookies([guestCookie]);
  contexts.set(variant.name, context);
}
const results = await mapConcurrent(
  jobs,
  concurrency,
  ({ surface, variant }) => inspectSurface(contexts.get(variant.name), surface, variant),
);
await Promise.all([...contexts.values()].map((context) => context.close()));
await browser.close();

const bySurface = new Map();
for (const result of results) {
  const key = `${result.app}\t${result.path}`;
  const summary = bySurface.get(key) || {
    app: result.app,
    label: result.label,
    path: result.path,
    failures: new Set(),
    warnings: new Set(),
    variants: [],
  };
  for (const failure of result.failures || []) summary.failures.add(`${result.variant || 'audit'}: ${failure}`);
  for (const warning of result.warnings || []) summary.warnings.add(`${result.variant || 'audit'}: ${warning}`);
  summary.variants.push(result);
  bySurface.set(key, summary);
}

for (const summary of bySurface.values()) {
  const ocean = summary.variants.find((item) => item.variant === 'desktop-ocean');
  const daylight = summary.variants.find((item) => item.variant === 'desktop-daylight');
  if (ocean && daylight
      && ocean.responseStatus < 400
      && daylight.responseStatus < 400
      && ocean.bodyBackground === daylight.bodyBackground
      && ocean.bodyBackground !== 'rgba(0, 0, 0, 0)') {
    summary.failures.add(`theme: page background stays ${ocean.bodyBackground || 'unset'} when the control plane changes from ocean to daylight`);
  }
}

const summaries = [...bySurface.values()].map((summary) => ({
  ...summary,
  failures: [...summary.failures],
  warnings: [...summary.warnings],
}));
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  applications: new Set(surfaces.map((surface) => surface.app)).size,
  surfaces: surfaces.length,
  variants: variants.map((variant) => variant.name),
  failedSurfaces: summaries.filter((summary) => summary.failures.length).length,
  warnedSurfaces: summaries.filter((summary) => summary.warnings.length).length,
  summaries,
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  '# oshal application surface audit',
  '',
  `- Applications: ${report.applications}`,
  `- Declared surfaces: ${report.surfaces}`,
  `- Failed surfaces: ${report.failedSurfaces}`,
  `- Warning surfaces: ${report.warnedSurfaces}`,
  '',
];
for (const summary of summaries) {
  if (!summary.failures.length && !summary.warnings.length) continue;
  lines.push(`## ${summary.app} — ${summary.label}`, '', `\`${summary.path}\``);
  for (const failure of summary.failures) lines.push(`- FAIL: ${failure}`);
  for (const warning of summary.warnings) lines.push(`- WARN: ${warning}`);
  lines.push('');
}
await fs.writeFile(path.join(outputDir, 'report.md'), `${lines.join('\n')}\n`);

console.log(JSON.stringify({
  outputDir,
  applications: report.applications,
  surfaces: report.surfaces,
  failedSurfaces: report.failedSurfaces,
  warnedSurfaces: report.warnedSurfaces,
}, null, 2));
if (report.failedSurfaces) process.exitCode = 1;
