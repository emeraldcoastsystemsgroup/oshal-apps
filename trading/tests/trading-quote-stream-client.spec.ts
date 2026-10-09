/**
 * ADR-143 D3/D9 — the browser half of the quote relay, run as the shipped classic script.
 *
 * tools/ui/quote-stream.js is evaluated in a node:vm sandbox with a fake EventSource, a fake
 * document and the globals the shell provides (BOOK, TKT, STATE, UNIVERSE, fmtDate, esc). The
 * claims under test are the client's: one same-origin EventSource per (book, symbol union), prints
 * patch the ticket and a position, the feed pill and as-of wording follow hello's feed and
 * staleAfterSec, stale cells grey and the poll resumes on a silent stream, teardown clears the
 * sweep. The relay itself is proven over real HTTP in trading-quote-stream.spec.ts.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sandbox the shipped quote-stream.js: EventSource path and reuse, print patching, freshness-gated feed pill, stale greying and as-of rewrite from hello.staleAfterSec, poll hand-back on a silent stream, teardown; plus the ticket/positions wiring pins (qsSync on lookup and close, data-stream-symbol on the patched cells).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UI = resolve(process.cwd(), 'tools/ui');
const SOURCE = readFileSync(resolve(UI, 'quote-stream.js'), 'utf8');

class FakeElement {
  classes = new Set<string>();
  constructor(public sym: string) {}
  get classList() { const classes = this.classes; return { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); }, contains: (name: string) => classes.has(name) }; }
}

class FakeEventSource {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (event: { data: string }) => void): void { (this.listeners[type] ||= []).push(fn); }
  emit(type: string, payload: unknown): void { this.readyState = FakeEventSource.OPEN; for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(payload) }); }
  close(): void { this.readyState = FakeEventSource.CLOSED; }
}

interface Sandbox { ctx: vm.Context; run: (code: string) => any; elements: FakeElement[]; styles: Array<{ id: string; textContent: string }>; }

function sandbox(): Sandbox {
  const elements = [new FakeElement('AAPL'), new FakeElement('MSFT'), new FakeElement('MSFT')];
  const styles: Array<{ id: string; textContent: string }> = [];
  const document = {
    querySelectorAll: (selector: string) => { const sym = /\[data-stream-symbol="([^"]*)"\]/.exec(selector)?.[1]; return elements.filter((el) => el.sym === sym); },
    getElementById: (id: string) => styles.find((style) => style.id === id) || null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (style: { id: string; textContent: string }) => { styles.push(style); } },
  };
  const globals: Record<string, unknown> = {
    BOOK: 'paper',
    TKT: { symbol: 'AAPL', quote: { symbol: 'AAPL', price: 180, asOf: '2026-09-28T13:00:00.000Z', live: false }, quoteAt: 0, quoteErr: '' },
    STATE: { positions: [{ symbol: 'MSFT', qty: 10, avgEntryPrice: 100, price: 105, marketValue: 1050, unrealizedPl: 50, retPct: 5 }, { symbol: 'AAPL', qty: 1, avgEntryPrice: 150 }] },
    UNIVERSE: {},
    tktApplyQuote: vi.fn(),
    renderPortfolioTable: vi.fn(),
    fmtDate: (iso: string) => `T(${iso})`,
    esc: (s: unknown) => String(s ?? ''),
    document, EventSource: FakeEventSource, encodeURIComponent,
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    Date,
  };
  const ctx = vm.createContext(globals);
  vm.runInContext(SOURCE, ctx, { filename: 'quote-stream.js' });
  return { ctx, run: (code: string) => vm.runInContext(code, ctx), elements, styles };
}

const HELLO = { streaming: true, feed: 'iex', staleAfterSec: 2, symbols: ['AAPL', 'MSFT'], dropped: [], book: 'paper', source: 'alpaca-stream' };

describe('quote-stream.js in the shipped shell shape (ADR-143 client)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(new Date('2026-09-28T14:30:00.000Z')); FakeEventSource.instances.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('opens one same-origin EventSource for the ticket-first union, injects the greying rule once and reuses the source', () => {
    const box = sandbox();
    box.run('qsSync()');
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual(['/api/trading/stream?book=paper&symbols=AAPL%2CMSFT']);
    expect(box.styles).toEqual([{ id: 'qsStreamStyle', textContent: '.stream-stale{opacity:.55}' }]);
    box.run('qsSync()');
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(box.styles).toHaveLength(1);
  });

  it('patches the ticket and the position on prints and shows the feed pill only while fresh', () => {
    const box = sandbox();
    box.run('qsSync()');
    const source = FakeEventSource.instances[0];
    source.emit('hello', HELLO);
    expect(box.run("qsIsStreaming('AAPL')")).toBe(true);           // the poll pauses while a print is awaited
    expect(box.run("qsPillHtml('AAPL')")).toBe('');                 // but no pill before a print exists
    source.emit('print', { symbol: 'AAPL', price: 189.5, size: 100, asOf: '2026-09-28T14:30:00.000Z', feed: 'iex' });
    expect(box.ctx.TKT.quote).toEqual({ symbol: 'AAPL', price: 189.5, asOf: '2026-09-28T14:30:00.000Z', size: 100, live: true });
    expect(box.ctx.tktApplyQuote).toHaveBeenCalledTimes(1);
    expect(box.run("qsPillHtml('AAPL')")).toContain('live · IEX');
    expect(box.run("qsAsOfText('AAPL')")).toBe('as of T(2026-09-28T14:30:00.000Z)');
    source.emit('print', { symbol: 'MSFT', price: 150, size: 5, asOf: '2026-09-28T14:30:01.000Z', feed: 'iex' });
    expect(box.ctx.STATE.positions[0]).toMatchObject({ price: 150, marketValue: 1500, unrealizedPl: 500, retPct: 50 });
    expect(box.ctx.UNIVERSE.MSFT).toEqual({ symbol: 'MSFT', price: 150, mktValue: 1500, uPl: 500, retPct: 50 });
    expect(box.ctx.renderPortfolioTable).toHaveBeenCalledTimes(2);   // AAPL is held too: one repaint per print on a held symbol
    expect(box.elements.map((el) => el.classList.contains('stream-stale'))).toEqual([false, false, false]);
  });

  it('greys stale cells, drops the pill, rewrites the as-of and hands the poll back after staleAfterSec', () => {
    const box = sandbox();
    box.run('qsSync()');
    const source = FakeEventSource.instances[0];
    source.emit('hello', HELLO);
    source.emit('print', { symbol: 'AAPL', price: 189.5, size: 100, asOf: '2026-09-28T14:30:00.000Z', feed: 'iex' });
    source.emit('print', { symbol: 'MSFT', price: 110, size: 5, asOf: '2026-09-28T14:30:00.000Z', feed: 'iex' });
    vi.advanceTimersByTime(1900);                                    // sweep at 1 s: 1 s old, within staleAfterSec of 2 s
    expect(box.elements.map((el) => el.classList.contains('stream-stale'))).toEqual([false, false, false]);
    vi.advanceTimersByTime(1100);                                    // sweep at 3 s: 3 s old, past staleAfterSec
    expect(box.elements.map((el) => el.classList.contains('stream-stale'))).toEqual([true, true, true]);
    expect(box.run("qsPillHtml('AAPL')")).toBe('');
    expect(box.run("qsAsOfText('AAPL')")).toBe('stale · last IEX print T(2026-09-28T14:30:00.000Z)');
    expect(box.run("qsIsStreaming('AAPL')")).toBe(false);          // tktTick polls again
    expect(box.ctx.tktApplyQuote).toHaveBeenCalledTimes(2);        // the ticket repainted on the flip
    source.emit('print', { symbol: 'AAPL', price: 190, size: 1, asOf: '2026-09-28T14:30:03.000Z', feed: 'iex' });
    expect(box.elements.map((el) => el.classList.contains('stream-stale'))).toEqual([false, true, true]);
    expect(box.run("qsPillHtml('AAPL')")).toContain('live · IEX');
    expect(box.run("qsIsStreaming('AAPL')")).toBe(true);
  });

  it('yields the as-of wording to a newer poll quote once the poll has taken over', () => {
    const box = sandbox();
    box.run('qsSync()');
    const source = FakeEventSource.instances[0];
    source.emit('hello', HELLO);
    source.emit('print', { symbol: 'AAPL', price: 189.5, size: 100, asOf: '2026-09-28T14:30:00.000Z', feed: 'iex' });
    vi.advanceTimersByTime(3000);
    expect(box.run("qsAsOfText('AAPL')")).toContain('stale');
    box.ctx.TKT.quote = { symbol: 'AAPL', price: 189.7, asOf: '2026-09-28T14:30:02.500Z', live: false };
    expect(box.run("qsAsOfText('AAPL')")).toBe('');
  });

  it('keeps the poll in charge on a streaming:false hello and never shows a pill', () => {
    const box = sandbox();
    box.run('qsSync()');
    FakeEventSource.instances[0].emit('hello', { ...HELLO, streaming: false, reason: 'stream_disabled', source: 'alpaca-poll' });
    expect(box.run("qsIsStreaming('AAPL')")).toBe(false);
    expect(box.run("qsPillHtml('AAPL')")).toBe('');
    expect(box.run("qsAsOfText('AAPL')")).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tears down the source and the sweep on close, and an empty union closes instead of opening', () => {
    const box = sandbox();
    box.run('qsSync()');
    const source = FakeEventSource.instances[0];
    source.emit('hello', HELLO);
    expect(vi.getTimerCount()).toBe(1);
    box.run('qsClose()');
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    expect(vi.getTimerCount()).toBe(0);
    box.ctx.TKT = null; box.ctx.STATE.positions = [];
    box.run('qsSync()');
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe('the shell wiring the client relies on (ADR-143 D9)', () => {
  const ticket = readFileSync(resolve(UI, 'ticket.js'), 'utf8');
  const positions = readFileSync(resolve(UI, 'shared-positions.js'), 'utf8');
  const body = (source: string, name: string) => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\nfunction ', start + 1)); };

  it('the ticket takes its pill and as-of wording from the stream module and tags the price cell', () => {
    const quote = body(ticket, 'tktQuoteHtml');
    expect(quote).toContain('qsPillHtml(q.symbol)');
    expect(quote).toContain('qsAsOfText(q.symbol)');
    expect(quote).toContain('data-stream-symbol="\' + esc(q.symbol)');
    expect(ticket).not.toContain('live · IEX');
  });

  it('a symbol looked up inside the ticket and a closed ticket both re-sync the stream', () => {
    expect(body(ticket, 'tktLookup')).toContain('qsSync()');
    const close = ticket.split('\n').find((line) => line.startsWith('function closeTicket('))!;
    expect(close).toContain('TKT = null; if (typeof qsSync === \'function\') qsSync();');
    expect(close).not.toContain('qsClose');
  });

  it('the positions row tags exactly the cells a print patches', () => {
    const row = body(positions, 'renderPortfolioTable');
    for (const col of ['last', 'marketValue', 'uPl', 'retPct']) expect(row).toContain(`data-col="${col}" data-stream-symbol="' + esc(p.symbol) + '"`);
    expect(row.match(/data-stream-symbol=/g)).toHaveLength(4);
    expect(row).toContain("Today $ and % stay the broker\\'s values");
  });
});
