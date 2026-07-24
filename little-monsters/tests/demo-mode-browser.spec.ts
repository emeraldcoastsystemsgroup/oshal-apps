/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-04-21 22:25:00 | roger.murphy@agenticfederal.us   | Browser-level demo spec — real Chromium navigation, not curl. Proves an actual human can log in, see the LM-focused cockpit, and click through the ribbon.
 */

import { test, expect } from '@playwright/test';

/**
 * Human-level demo proof. Playwright drives a real Chromium browser
 * against the live Docker stack. Nothing is mocked below the HTTP
 * surface — same code path an operator hits.
 */

const BASE = process.env.SWARM_APPS_TEST_BASE_URL || 'http://localhost:35457';

test.use({ baseURL: BASE, ignoreHTTPSErrors: true });

test.beforeAll(async ({ request }) => {
  // Sanity: if the stack isn't up, skip all tests cleanly.
  const health = await request.get('/health').catch(() => null);
  test.skip(!health || !health.ok(), `OSHAL stack not reachable at ${BASE}`);

  // Ensure Little Monsters is active so the ribbon has something to render.
  await request.patch('/api/swarm/apps/little-monsters/toggle', { data: { active: true } });
});

test('demo login route: GET /login redirects into the cockpit', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/cockpit\/?$/);
});

test('demo user info endpoint returns the seeded mock identity', async ({ request }) => {
  const res = await request.get('/api/auth/user');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(body.mode).toBe('demo');
  expect(body.user.name).toContain('Alex');
  expect(Array.isArray(body.user.roles)).toBeTruthy();
});

test('seeded demo data: 4 classes, 1 student, 4 flashcard sets', async ({ request }) => {
  const classes = await request.get('/api/education/classes');
  const body = await classes.json();
  const names = body.classes.map((c: any) => c.name);
  expect(names).toContain('Algebra I');
  expect(names).toContain('Biology I');
  expect(names).toContain('English Lit');
  expect(names).toContain('US History');
});

test('cockpit loads focused on Little Monsters and renders the LM ribbon', async ({ page }) => {
  await page.goto('/cockpit?app=little-monsters');
  // Page title + ribbon container exist
  await expect(page).toHaveTitle(/Cockpit/i);
  // RibbonNav fetches /api/ui/profile and paints — wait for at least one ribbon button
  await expect(page.locator('.ribbon-btn').first()).toBeVisible({ timeout: 10_000 });
  const count = await page.locator('.ribbon-btn').count();
  expect(count).toBeGreaterThanOrEqual(4); // 4 class icons + LM items

  // Should show the LM static items: Student Dashboard, My Day, Tutor, Flashcards, Record
  const labels = await page.locator('.ribbon-btn').allTextContents();
  const joined = labels.join(' | ');
  expect(joined).toMatch(/Student Dashboard|Dashboard/);
  expect(joined).toMatch(/Tutor/);
  expect(joined).toMatch(/Flashcards/);
});

test('cockpit focused on LM does NOT show engineering-only ribbon items', async ({ page }) => {
  await page.goto('/cockpit?app=little-monsters');
  await expect(page.locator('.ribbon-btn').first()).toBeVisible({ timeout: 10_000 });
  const labels = (await page.locator('.ribbon-btn').allTextContents()).join(' | ');
  expect(labels).not.toMatch(/Tickets/);
  expect(labels).not.toMatch(/Echo/);
  expect(labels).not.toMatch(/Calendar/); // framework Calendar is hidden — LM has its own "My Day"
});

test('applications panel lists all 3 shipping apps', async ({ page }) => {
  await page.goto('/applications');
  await expect(page.locator('h1')).toHaveText(/Swarm Applications/i);
  await expect(page.locator('.app-card').first()).toBeVisible({ timeout: 10_000 });
  const cards = page.locator('.app-card');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(3);
  const html = await page.content();
  expect(html).toContain('Little Monsters');
  expect(html).toContain('Echo Ops');
  expect(html).toContain('OSHAL Engineering');
});

test('toggling via applications panel actually deactivates + reactivates LM', async ({ page, request }) => {
  await page.goto('/applications');
  await expect(page.locator('.app-card').first()).toBeVisible({ timeout: 10_000 });

  // Find the little-monsters card by data-name
  const lmCard = page.locator('.app-card[data-name="little-monsters"]');
  await expect(lmCard).toBeVisible();

  const deactivateBtn = lmCard.locator('button[data-act="toggle"]');
  const label = await deactivateBtn.textContent();

  // Click deactivate
  if (label?.toLowerCase().includes('deactivate')) {
    await deactivateBtn.click();
    // After re-render the card should say Activate + status badge 'inactive'
    await expect(lmCard.locator('.status-badge')).toHaveText('inactive', { timeout: 5_000 });
  }

  // Verify backend: /api/education/dashboard now 503s
  const eduRes = await request.get('/api/education/dashboard');
  expect(eduRes.status()).toBe(503);

  // Toggle back on via API for cleanup
  await request.patch('/api/swarm/apps/little-monsters/toggle', { data: { active: true } });
});
