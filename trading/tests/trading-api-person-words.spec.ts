/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The shipped tools/ui/app.js api() (sliced verbatim, as the position-plans spec does) runs against recorded replies: a server failure (the paper book's "(0 , trading_pinned_lots_1.pinnedQtyBySymbol) is not a function" 500) and the native not-available refusal reach a panel as one plain sentence, while a route's own refusal words (a 4xx, a 503 naming the missing connector) are kept, with the status and code still on the error.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/** The shipped api(), sliced verbatim from app.js, over a recorded fetch answer; nothing is rendered. */
function shell(status: number, body: unknown) {
  const app = readFileSync(path.resolve(__dirname, '..', 'tools/ui/app.js'), 'utf8');
  const start = app.indexOf('async function api(');
  const context: Record<string, unknown> = {
    BOOK: 'paper', MODE: 'paper',
    fetch: async () => ({ ok: status < 400, status, json: async () => body }),
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, app.indexOf('\n}\n', start) + 3), context, { filename: 'app.js' });
  return context as { api: (p: string) => Promise<unknown> };
}

async function failure(status: number, body: unknown): Promise<{ message: string; status: number; code: string | null }> {
  try { await shell(status, body).api('/lots'); } catch (e) { return e as never; }
  throw new Error('the read was expected to fail');
}

describe('a failed trading read reaches the panel in a person\'s words', () => {
  it('a server failure never shows its internal text', async () => {
    const e = await failure(500, { error: '(0 , trading_pinned_lots_1.pinnedQtyBySymbol) is not a function' });
    expect(e.message).toBe('the server could not answer just now. Try again in a moment.');
    expect(e.message).not.toMatch(/is not a function|trading_|\(0 ,/);
    expect(e.status).toBe(500);
  });

  it('the native not-available refusal is one plain sentence', async () => {
    const e = await failure(503, { error: 'native_executor_unavailable', detail: 'native trading executor unavailable' });
    expect(e.message).toBe('this is not available on this installation yet.');
    expect(e.code).toBe('native_executor_unavailable');
  });

  it('a route\'s own refusal words are kept', async () => {
    expect((await failure(503, { error: 'market_data_not_connected', detail: 'no market-data connector is connected' })).message)
      .toBe('no market-data connector is connected');
    const confirm = await failure(428, { error: 'confirm_required', message: 'Resend with confirm:true.' });
    expect(confirm.message).toBe('Resend with confirm:true.');
    expect(confirm.code).toBe('confirm_required');
  });
});
