/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-04-21 23:15:00 | roger.murphy@agenticfederal.us   | Deep per-page browser spec — visits every LM UI page in Chromium, asserts key elements render, and flags any console errors
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const BASE = process.env.SWARM_APPS_TEST_BASE_URL || 'http://localhost:35457';
test.use({ baseURL: BASE, ignoreHTTPSErrors: true });

/**
 * Browser-level per-page verification. For each LM page:
 *   1. Navigate with a real browser
 *   2. Assert status 200 and a non-empty body
 *   3. Assert a page-specific marker (title text, key element, etc.)
 *   4. Collect any console errors and fail if unexpected
 *
 * This is the "human clicks every screen" test the earlier HTTP-code
 * checks missed.
 */

type PageCheck = {
  path: string;
  name: string;
  expectTitle?: RegExp;
  expectText?: RegExp;
  expectSelector?: string;
};

const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,
  /Failed to load resource: the server responded with a status of 404.*favicon/i,
  /\[DOM\].*password field is not contained in a form/i,
  /codicon.ttf.*404/i, // codicon font may 404 in some setups; not blocking
];

function watchConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const handler = (msg: ConsoleMessage) => {
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some(rx => rx.test(text))) return;
    if (msg.type() === 'error') errors.push(text);
    else if (msg.type() === 'warning') warnings.push(text);
  };
  page.on('console', handler);
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));
  return { errors, warnings };
}

test.beforeAll(async ({ request }) => {
  const health = await request.get('/health').catch(() => null);
  test.skip(!health || !health.ok(), `OSHAL stack not reachable at ${BASE}`);
  // Ensure LM is active
  await request.patch('/api/swarm/apps/little-monsters/toggle', { data: { active: true } });
});

// ─── Demo mode landing and auth ─────────────────────────────────────────────

test('landing: GET / redirects to /chat and renders without console errors', async ({ page }) => {
  const { errors } = watchConsole(page);
  const res = await page.goto('/');
  expect(res?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/chat/);
  await expect(page).toHaveTitle(/Chat/i);
  expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('demo /login redirects into /cockpit/', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/cockpit\/?$/);
});

test('/api/auth/user returns the demo user in JSON', async ({ request }) => {
  const res = await request.get('/api/auth/user');
  expect(res.ok()).toBeTruthy();
  const { user, mode, authenticated } = await res.json();
  expect(authenticated).toBe(true);
  expect(mode).toBe('demo');
  expect(user.name).toMatch(/Alex/);
});

// ─── Cockpit default (framework mode) — should show only framework items ────

test('cockpit default (no ?app=): ribbon shows ONLY the 9 framework items', async ({ page }) => {
  const { errors } = watchConsole(page);
  await page.goto('/cockpit/');
  await expect(page.locator('.ribbon-btn').first()).toBeVisible({ timeout: 10_000 });

  const labels = (await page.locator('.ribbon-btn').allTextContents())
    .map(s => s.trim())
    .filter(Boolean);
  // Should NOT contain app-owned tool icons (LM, Echo, Engineering)
  const joined = labels.join(' | ');
  expect(joined, `unexpected app tool in framework ribbon: ${joined}`).not.toMatch(/Student Dashboard|My Day|Tutor|Flashcards|Record/);
  expect(joined).not.toMatch(/Ops Dashboard|Mesh|Graph/);
  expect(joined).not.toMatch(/Task Explorer|Queue Admin|Swarm Control|Workflow Studio/);
  // Should contain framework items
  expect(joined).toMatch(/Tickets/);
  expect(joined).toMatch(/Chat/);
  expect(joined).toMatch(/Settings/);
  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

// ─── Cockpit focused on Little Monsters ─────────────────────────────────────

test('cockpit ?app=little-monsters: 5 LM items + 4 class icons + Settings only', async ({ page }) => {
  const { errors } = watchConsole(page);
  await page.goto('/cockpit?app=little-monsters');
  await expect(page.locator('.ribbon-btn').first()).toBeVisible({ timeout: 10_000 });

  // The ribbon renders the manifest's static items synchronously, then
  // _loadToolViews() fetches /api/tools/dynamic and re-renders with the
  // dynamic class icons (Algebra I, Biology I, English Lit, US History).
  // Wait for that second render before asserting.
  await expect(page.locator('.ribbon-btn', { hasText: 'Algebra I' })).toBeVisible({ timeout: 10_000 });

  const labels = (await page.locator('.ribbon-btn').allTextContents()).map(s => s.trim());
  const joined = labels.join(' | ');

  // LM static items
  expect(joined).toMatch(/Student Dashboard/);
  expect(joined).toMatch(/My Day/);
  expect(joined).toMatch(/Tutor/);
  expect(joined).toMatch(/Flashcards/);
  expect(joined).toMatch(/Record/);

  // 4 class icons
  expect(joined).toMatch(/Algebra I/);
  expect(joined).toMatch(/Biology I/);
  expect(joined).toMatch(/English Lit/);
  expect(joined).toMatch(/US History/);

  // Settings stays
  expect(joined).toMatch(/Settings/);

  // No leaks from other apps
  expect(joined).not.toMatch(/Ops Dashboard|Echo Graph/);
  expect(joined).not.toMatch(/Task Explorer|Queue Admin|Swarm Control|Workflow Studio/);

  // No framework items that should be hidden
  expect(joined).not.toMatch(/\bTickets\b/);
  expect(joined).not.toMatch(/\bEcho\b/);
  expect(joined).not.toMatch(/\bLogs\b/);

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

// ─── Each LM page actually renders meaningful content ───────────────────────

const LM_PAGES: PageCheck[] = [
  {
    path: '/api/education/dashboard',
    name: 'Student Dashboard',
    expectTitle: /Little Monsters|Student Dashboard/i,
    expectText: /class|dashboard/i,
  },
  {
    path: '/api/education/my-day',
    name: 'My Day',
    expectText: /today|day|schedule/i,
  },
  {
    path: '/api/education/tutor',
    name: 'Tutor Chat',
    expectText: /tutor|ask|chat/i,
  },
  {
    path: '/api/education/flashcards',
    name: 'Flashcard Study',
    expectText: /flashcard|card|study/i,
  },
  {
    path: '/api/education/recorder',
    name: 'Lecture Recorder',
    expectText: /record|lecture|audio|microphone/i,
  },
];

for (const p of LM_PAGES) {
  test(`LM page renders meaningfully: ${p.name} (${p.path})`, async ({ page }) => {
    const { errors } = watchConsole(page);
    const res = await page.goto(p.path);
    expect(res?.status(), `HTTP status for ${p.path}`).toBe(200);

    const body = (await page.content()).trim();
    expect(body.length, `empty body for ${p.path}`).toBeGreaterThan(200);

    if (p.expectTitle) {
      await expect(page).toHaveTitle(p.expectTitle);
    }
    if (p.expectText) {
      expect(body).toMatch(p.expectText);
    }
    if (p.expectSelector) {
      await expect(page.locator(p.expectSelector).first()).toBeVisible();
    }

    expect(errors, `console errors on ${p.path}: ${errors.join('\n')}`).toHaveLength(0);
  });
}

// ─── Class view uses a real seeded classId ──────────────────────────────────

test('class view loads with the seeded Algebra I classId', async ({ page, request }) => {
  const classes = await (await request.get('/api/education/classes')).json();
  const algebra = classes.classes.find((c: any) => c.name === 'Algebra I');
  expect(algebra, 'Algebra I class should be seeded').toBeTruthy();

  const { errors } = watchConsole(page);
  await page.goto(`/api/education/class?classId=${algebra.class_id}`);
  const body = (await page.content()).trim();
  expect(body.length).toBeGreaterThan(200);
  expect(errors, `class page console errors: ${errors.join('\n')}`).toHaveLength(0);
});

// ─── Applications panel can be navigated and shows correct state ───────────

test('applications panel: lists 3 apps and each has working action buttons', async ({ page }) => {
  const { errors } = watchConsole(page);
  await page.goto('/applications');
  await expect(page.locator('h1')).toHaveText(/Swarm Applications/i);
  await expect(page.locator('.app-card').first()).toBeVisible({ timeout: 10_000 });

  const cards = await page.locator('.app-card').count();
  expect(cards).toBe(3);

  // Each card has the action buttons
  for (const appName of ['little-monsters', 'workflow-studio', 'oshal-engineering']) {
    const card = page.locator(`.app-card[data-name="${appName}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('button[data-act="toggle"]')).toBeVisible();
    await expect(card.locator('button[data-act="focus"]')).toBeVisible();
    await expect(card.locator('button[data-act="export"]')).toBeVisible();
    await expect(card.locator('button[data-act="unload"]')).toBeVisible();
  }

  expect(errors, `applications panel console errors: ${errors.join('\n')}`).toHaveLength(0);
});

// ─── Focus select actually navigates + changes the ribbon ──────────────────

test('clicking an LM ribbon item opens an iframe in the content area — NOT a whole-page navigation', async ({ page }) => {
  await page.goto('/cockpit?app=little-monsters');
  await expect(page.locator('.ribbon-btn').first()).toBeVisible({ timeout: 10_000 });

  // Click the Tutor tool icon in the ribbon
  const tutorBtn = page.locator('.ribbon-btn', { hasText: 'Tutor' }).first();
  await expect(tutorBtn).toBeVisible();
  await tutorBtn.click();

  // After click, the URL must still be /cockpit (no full-page nav)
  await expect(page).toHaveURL(/\/cockpit/);

  // An iframe with the tutor URL must be present in the content area
  const iframe = page.locator('iframe[src*="/api/education/tutor"]').first();
  await expect(iframe).toBeVisible({ timeout: 5_000 });

  // Ribbon button remains in active state
  await expect(tutorBtn).toHaveClass(/active/);
});

test('focus-select dropdown navigates to cockpit with ?app= param', async ({ page }) => {
  await page.goto('/applications');
  await expect(page.locator('#focusSelect')).toBeVisible({ timeout: 10_000 });
  await page.selectOption('#focusSelect', 'workflow-studio');
  await page.waitForURL(/\?app=workflow-studio/);
  await expect(page.locator('.ribbon-btn').first()).toBeVisible({ timeout: 10_000 });
  const labels = (await page.locator('.ribbon-btn').allTextContents()).join(' | ');
  expect(labels).toMatch(/Ops Dashboard|Mesh|Graph/);
  expect(labels).not.toMatch(/Student Dashboard|Tutor|Flashcards/);
});

// ─── Theme sync: LM iframe tracks cockpit theme rotation ────────────────────

test('LM page HTML ships the inline theme-sync bootstrap', async ({ request }) => {
  const res = await request.get('/api/education/dashboard');
  expect(res.status()).toBe(200);
  const body = await res.text();
  // The inline bootstrap must be present — it is what keeps the iframe's
  // palette glued to the parent cockpit's data-theme attribute.
  expect(body).toMatch(/data-lm-theme-link/);
  expect(body).toMatch(/cockpit-theme/);
  expect(body).toMatch(/MutationObserver/);
});

test('LM iframe inherits cockpit theme and flips live when parent theme changes', async ({ page }) => {
  // Load cockpit root directly — this gives us a same-origin parent that
  // boots the theme manager. We inject the LM iframe manually so this test
  // doesn't depend on the ribbon having the little-monsters profile loaded.
  await page.goto('/cockpit/');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')), { timeout: 10_000 })
    .toBeTruthy();

  await page.evaluate(() => {
    const f = document.createElement('iframe');
    f.id = 'lm-theme-test';
    f.src = '/api/education/dashboard';
    f.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:300px;';
    document.body.appendChild(f);
  });

  const iframeLocator = page.locator('#lm-theme-test');
  await expect(iframeLocator).toBeVisible();
  const frame = page.frameLocator('#lm-theme-test');
  // The theme-sync bootstrap runs synchronously at head parse — polling for the
  // data-theme attribute waits for the iframe document to exist AND the script
  // to have executed.
  const parentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await expect
    .poll(() => frame.locator('html').getAttribute('data-theme'), { timeout: 10_000 })
    .toBe(parentTheme);

  const nextTheme = parentTheme === 'daylight' ? 'ocean' : 'daylight';
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), nextTheme);

  await expect
    .poll(() => frame.locator('html').getAttribute('data-theme'), { timeout: 5_000 })
    .toBe(nextTheme);

  const themeHref = await frame.locator('link[data-lm-theme-link="1"]').getAttribute('href');
  expect(themeHref).toBe(`/cockpit/css/themes/${nextTheme}.css`);
});
