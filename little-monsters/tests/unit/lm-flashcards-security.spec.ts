/**
 * Little Monsters — flashcard CRUD security (IDOR / access control).
 *
 * The by-id flashcard endpoints must NOT let a student edit/delete/read another
 * class's cards just because they're signed in. These tests mount the study routes
 * with mocked auth + a mock pool and assert: (a) an enrolled student succeeds and the
 * enrollment check actually runs, (b) a non-member is rejected with 403, (c) a missing
 * card/set is 404, (d) a private (class_id null) self-study set skips the class check,
 * and (e) empty input is rejected.
 */
import express from 'express';
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('@/app/routes/education-access', async (orig) => {
  const actual = await orig<typeof import('@/app/routes/education-access')>();
  return {
    ...actual, // keep the real EducationAccessError so sendAccessError's instanceof works
    resolveAuthedStudent: vi.fn(async () => ({ studentId: 'stu-1' })),
    assertClassAccess: vi.fn(async () => undefined),
    listAccessibleClassIds: vi.fn(async () => [] as string[]),
  };
});

import { createEducationStudyRoutes } from '@/app/routes/education-study-routes';
import { assertClassAccess, EducationAccessError } from '@/app/routes/education-access';

/** Mock pool: `classId` is what the set/card resolves to (null = private self-study set);
 *  `exists:false` makes the lookup return no rows (→ 404). */
function makePool(opts: { classId?: string | null; exists?: boolean }) {
  return {
    query: async (sql: string) => {
      if (/class_id from lm_flashcards|class_id from lm_flashcard_sets/i.test(sql)) {
        if (opts.exists === false) return { rows: [] };
        return { rows: [{ class_id: opts.classId ?? null }] };
      }
      if (/select \* from lm_flashcards where set_id/i.test(sql)) return { rows: [{ card_id: 'c1', front: 'q', back: 'a' }] };
      if (/delete from lm_flashcards where card_id|delete from lm_flashcards where set_id/i.test(sql)) return { rows: [{ set_id: 'set-1' }] };
      return { rows: [] };
    },
  };
}

const servers: Array<() => Promise<void>> = [];
async function serve(pool: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/education', createEducationStudyRoutes({ pool } as never));
  const server = app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  servers.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${addr.port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((c) => c()));
  vi.mocked(assertClassAccess).mockReset();
  vi.mocked(assertClassAccess).mockResolvedValue(undefined);
});

const PATCH_BODY = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ front: 'f', back: 'b' }) };

describe('flashcard CRUD — access control', () => {
  it('PATCH a card in an accessible class → 200, and the enrollment check actually ran', async () => {
    const url = await serve(makePool({ classId: 'cls-1' }));
    const res = await fetch(`${url}/api/education/flashcards/cards/c1`, PATCH_BODY);
    expect(res.status).toBe(200);
    expect(vi.mocked(assertClassAccess)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ studentId: 'stu-1' }), 'cls-1');
  });

  it('PATCH a card in a class the student is NOT in → 403 (IDOR blocked)', async () => {
    vi.mocked(assertClassAccess).mockRejectedValue(new EducationAccessError('not enrolled', 403));
    const url = await serve(makePool({ classId: 'cls-9' }));
    const res = await fetch(`${url}/api/education/flashcards/cards/c1`, PATCH_BODY);
    expect(res.status).toBe(403);
  });

  it('DELETE a set in a class the student is NOT in → 403', async () => {
    vi.mocked(assertClassAccess).mockRejectedValue(new EducationAccessError('not enrolled', 403));
    const url = await serve(makePool({ classId: 'cls-9' }));
    const res = await fetch(`${url}/api/education/flashcards/sets/set-1`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('GET cards in an inaccessible class → 403 (was unauthenticated before the review)', async () => {
    vi.mocked(assertClassAccess).mockRejectedValue(new EducationAccessError('not enrolled', 403));
    const url = await serve(makePool({ classId: 'cls-9' }));
    const res = await fetch(`${url}/api/education/flashcards/sets/set-1/cards`);
    expect(res.status).toBe(403);
  });

  it('a private self-study set (class_id null) skips the class check and is allowed', async () => {
    const url = await serve(makePool({ classId: null }));
    const res = await fetch(`${url}/api/education/flashcards/cards/c1`, PATCH_BODY);
    expect(res.status).toBe(200);
    expect(vi.mocked(assertClassAccess)).not.toHaveBeenCalled();
  });

  it('editing a card that does not exist → 404', async () => {
    const url = await serve(makePool({ exists: false }));
    const res = await fetch(`${url}/api/education/flashcards/cards/missing`, PATCH_BODY);
    expect(res.status).toBe(404);
  });

  it('PATCH with an empty front is rejected (400)', async () => {
    const url = await serve(makePool({ classId: 'cls-1' }));
    const res = await fetch(`${url}/api/education/flashcards/cards/c1`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ front: '', back: 'b' }),
    });
    expect(res.status).toBe(400);
  });
});
