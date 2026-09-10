/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — every resolveBook() call in the lab routes must read the QUERY book before any body field (the 2026-09-03 surface audit: a query/body split routed every order to PAPER; the lab apply route had drifted to body-first, found by the Studio parity proof review 2026-09-06). Source pin over the route file: no call starts with a body field, and the call count is what we expect so a new handler cannot slip in unscoped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const route = readFileSync(path.resolve(__dirname, '..', 'src-routes/trading-strategy-lab-routes.ts'), 'utf8');

describe('lab routes — book resolution is QUERY-first on every handler', () => {
  it('no resolveBook() call reads a body field before req.query.book', () => {
    const calls = route.match(/resolveBook\(pool, s, [^\n]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) {
      const args = c.slice('resolveBook(pool, s, '.length);
      expect(args.startsWith('b.book')).toBe(false);
      expect(args.startsWith('String((req.body')).toBe(false);
      expect(args.startsWith('(req.query.book') || args.startsWith('String(req.query.book')).toBe(true);
    }
  });

  it('the two handlers that used to be body-first are now query-first', () => {
    expect(route).toContain('resolveBook(pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined))');
    expect(route).toContain("resolveBook(pool, s, String(req.query.book ?? (req.body || {}).book ?? req.query.mode ?? '') || undefined)");
    expect(route).not.toContain('resolveBook(pool, s, b.book ??');
    expect(route).not.toContain('resolveBook(pool, s, String((req.body || {}).book ??');
  });
});
