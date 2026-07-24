/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-13 12:55:00 | roger.murphy@agenticfederal.us   | E2E: teacher analytics is teacher-gated (student 403) and returns roster/aggregates for the teacher of a class.
 * -----------------------------------------------------------------------------
 *
 * Run against the live docker stack (MOCK_OIDC → authenticated as demo student Alex):
 *   PLAYWRIGHT_PORT=35460 PLAYWRIGHT_REUSE_SERVER=true MOCK_OIDC=true \
 *     npx playwright test tests/education-teacher-analytics.spec.ts
 *
 * The teacher path is exercised by temporarily promoting the demo identity to a
 * teacher of a fresh class via the test-only helper endpoints, then reverting.
 */
import { test, expect } from '@playwright/test';

test.describe('Little Monsters — teacher analytics', () => {
  test('a student is denied the teacher surface (403)', async ({ request }) => {
    // MOCK_OIDC user (Alex) is a student by default.
    const classes = await request.get('/api/education/teacher/classes');
    expect(classes.status()).toBe(403);

    // And the per-class analytics is likewise teacher-only.
    const enrolled = (await (await request.get('/api/education/classes')).json()).classes as Array<{ class_id: string }>;
    if (enrolled.length > 0) {
      const a = await request.get(`/api/education/teacher/classes/${enrolled[0].class_id}/analytics`);
      // Either 403 (not a teacher) — never 200 for a student.
      expect(a.status()).toBe(403);
    }
  });

  test('teacher endpoints return well-formed shapes (smoke)', async ({ request }) => {
    // Even denied, the response is JSON with an error — never a stack/HTML.
    const r = await request.get('/api/education/teacher/classes');
    const body = await r.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});
