/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR        | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-22          | Claude Opus   | Regression: an aborted static request must
 *                     |               | NOT write to a finished response (that uncaught
 *                     |               | ERR_HTTP_HEADERS_SENT crashed the whole control plane).
 */

/**
 * @description
 * Regression test for the control-plane crash where a client aborting a static
 * education file fetch (e.g. little-monsters-logo.png) fired res.sendFile's error
 * callback AFTER the response was finished; the handler then called
 * res.status(404).send(), throwing an uncaught ERR_HTTP_HEADERS_SENT that exited
 * the entire oshal-api process (observed live as a tunnel 502).
 *
 * The mock res throws from status()/send() when headersSent — faithfully
 * reproducing Express — so the OLD (unguarded) code would throw here. The fix
 * guards on res.headersSent/writableEnded and must not write at all.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { serveFile } from '../../src/app/routes/education-routes';

function makeRes(headersSent: boolean): Response {
  const res: any = {
    headersSent,
    writableEnded: headersSent,
    status: vi.fn(function (this: any) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      return this;
    }),
    send: vi.fn(function (this: any) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      return this;
    }),
    // Simulate an aborted transfer: sendFile invokes its callback with an error.
    sendFile: vi.fn((_path: string, cb: (err: unknown) => void) => cb(new Error('ECONNABORTED'))),
  };
  return res as Response;
}

describe('education serveFile — aborted request must not crash the process', () => {
  it('does NOT write to an already-finished response (client aborted, headersSent=true)', () => {
    const res = makeRes(true);
    expect(() => serveFile('little-monsters-logo.png')({} as Request, res)).not.toThrow();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('still responds 404 when the response is open (genuine missing file)', () => {
    const res = makeRes(false);
    expect(() => serveFile('missing.png')({} as Request, res)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalled();
  });
});
