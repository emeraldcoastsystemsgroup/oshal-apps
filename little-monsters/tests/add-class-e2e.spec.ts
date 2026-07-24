/**
 * Add Class E2E Test — Tests the full class creation flow via the LM Home UI.
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3456';

// Use a unique name each run to avoid collisions
const TEST_CLASS_NAME = 'Test Class ' + Date.now().toString(36).slice(-4);

test.describe('Add Class Flow', () => {
  test('add class button opens form, creates class, class appears in list', async ({ page }) => {
    await page.goto(`${BASE}/api/education/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // 1. Click "Add Class" button
    const addBtn = page.locator('button', { hasText: '+ Add Class' });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // 2. Modal should appear
    const modal = page.locator('#addClassModal');
    await expect(modal).toBeVisible();

    // 3. Fill in the form
    await page.locator('#nc-name').fill(TEST_CLASS_NAME);
    await page.locator('#nc-subject').fill('Test Subject');
    await page.locator('#nc-teacher').fill('Dr. Smith');
    await page.locator('#nc-grade').fill('11th Grade');
    await page.locator('#nc-room').fill('Room 312, Period 5');
    await page.locator('#nc-website').fill('https://classroom.google.com/physics-ap');
    await page.locator('#nc-schedule').fill('TTh 10:00-11:30 AM');
    await page.locator('#nc-desc').fill('AP Physics 1: Algebra-based. Covers mechanics, waves, and circuits.');

    // 4. Submit
    await page.locator('button', { hasText: 'Create Class' }).click();

    // 5. Wait for success message
    const statusEl = page.locator('#nc-status');
    await expect(statusEl).toContainText('Done!', { timeout: 10000 });

    // 6. Modal should close after delay
    await page.waitForTimeout(3000);

    // 7. New class should appear in the class list
    const classList = page.locator('#classList');
    await expect(classList).toContainText(TEST_CLASS_NAME);
  });

  test('validation rejects empty required fields', async ({ page }) => {
    await page.goto(`${BASE}/api/education/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.locator('button', { hasText: '+ Add Class' }).click();
    await page.waitForTimeout(300);

    // Submit with empty form
    await page.locator('button', { hasText: 'Create Class' }).click();

    // Should show error
    const statusEl = page.locator('#nc-status');
    await expect(statusEl).toContainText('required');
  });

  test('new class appears in API after creation', async ({ page }) => {
    const resp = await page.request.get(`${BASE}/api/education/classes`);
    const data = await resp.json();
    const created = data.classes.find((c: any) => c.name === TEST_CLASS_NAME);
    expect(created).toBeTruthy();
    expect(created.subject).toBe('Test Subject');
  });

  test('new class registered in ribbon', async ({ page }) => {
    const resp = await page.request.get(`${BASE}/api/tools/dynamic`);
    const data = await resp.json();
    const icon = data.tools.find((t: any) => t.ui?.sidebarLabel === TEST_CLASS_NAME);
    expect(icon).toBeTruthy();
    expect(icon.ui.iframeUrl).toContain('/api/education/class?classId=');
  });
});
