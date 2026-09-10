/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial - the sub-tab / navigation race contract for the Trading surface (ADR-136 D2 tail). Every "async function load*" in tools/ui is discovered from source and must be classified here (tab-scoped, view-scoped or state-only); an unclassified new loader fails, so the contract cannot be silently widened. Tab-scoped loaders must capture RENDER_TOKEN and tabGen() BEFORE their first await and re-check stale()/tabStale() after it; view-scoped loaders must capture RENDER_TOKEN (or take a token parameter) and re-check stale(). The two ordering pins that actually bit: loadRosterTab bails before it writes BOOKS or fills the live strategy pickers, and the roster's Start/Stop resolves the enable flag from BOOKS at click time rather than from a value baked into the markup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Close the discovery hole a review found: loaders() only sees a column-0 "async function load*", so a loader written as "const loadX = async () => ...", an indented declaration or a class method would have escaped classification entirely and shipped unguarded while every test stayed green. The alternate spellings are now rejected outright, which makes the column-0 convention an enforced contract rather than an accident of the current file.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Round-3 review: the "re-checks after the await" pin was a substring test on the post-await slice, so a loader that called stale(token) AFTER its innerHTML write - one that overpainted first and only then noticed - stayed green. It is now an ORDERING test against the paint: the bail must appear before the loader's first innerHTML write, which is the failure the guard exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';

const UI = path.resolve(__dirname, '..', 'tools', 'ui');
const files = readdirSync(UI).filter((f) => f.endsWith('.js')).sort();
const sources: Record<string, string> = Object.fromEntries(files.map((f) => [f, readFileSync(path.join(UI, f), 'utf8')]));
const all = files.map((f) => sources[f]).join('\n');

/**
 * Tab-scoped loaders paint into #tabbody (or a node inside it), which SURVIVES a sub-tab switch -
 * a slow answer for the tab just left would overpaint the tab just chosen. They must guard on both
 * the render token and the sub-tab generation.
 */
const TAB_SCOPED = [
  'loadRosterTab', 'loadLabApplied', 'loadLabKnobs', 'loadTuneRecs', 'loadTuneParams',
  'loadEventPlansTab', 'loadScoreboard', 'loadFeed', 'loadMovers', 'loadWatchlistPanel', 'loadJournal',
];
/** View-scoped loaders paint into a node the view owns; the render token alone is the guard. */
const VIEW_SCOPED = [
  'loadKpisAndPositions', 'loadRealized', 'loadPerfSummary', 'loadSignalModel',
  'loadEventPlanCard', 'loadLotsCard', 'loadDatedCard',
];
/** State-only: writes module state and paints NOTHING, so it has no stale paint to guard against. */
const STATE_ONLY = ['loadBooks'];

/** Only "load*" is in scope. refreshTuning / refreshLabList / actOnRec / runOptimizeNow / doScan /
 *  doAnalyze / captureSignal / decide / execute are async too, but they are user-triggered actions
 *  that delegate their painting to the load* functions below - the boundary is deliberate. */
type Loader = { file: string; name: string; params: string; before: string; after: string };

/** Split one top-level function body at its FIRST await: everything before, everything after. */
function loaders(): Loader[] {
  const out: Loader[] = [];
  for (const f of files) {
    const src = sources[f];
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = /^async function (load\w*)\s*\(([^)]*)\)/.exec(line);
      if (!m) return;
      let end = -1;
      for (let j = i + 1; j < lines.length; j += 1) { if (lines[j] === '}') { end = j; break; } }
      expect(end, `${f}: ${m[1]} has no column-0 closing brace (the tools/ui convention)`).toBeGreaterThan(i);
      const body = lines.slice(i, end + 1).join('\n');
      const at = body.indexOf('await ');
      expect(at, `${f}: ${m[1]} is declared async but never awaits - drop the async keyword`).toBeGreaterThan(-1);
      out.push({ file: f, name: m[1], params: m[2], before: body.slice(0, at), after: body.slice(at) });
    });
  }
  return out;
}

describe('trading surface - every async load* loader bails when its render or sub-tab moved', () => {
  const found = loaders();

  it('every async load* loader in tools/ui is classified here (both directions)', () => {
    const names = found.map((l) => l.name).sort();
    const classified = [...TAB_SCOPED, ...VIEW_SCOPED, ...STATE_ONLY].sort();
    expect(names, 'a new async load* loader must be classified in this spec').toEqual(classified);
  });

  it('no loader is written in a spelling the discovery above cannot see', () => {
    // loaders() matches a COLUMN-0 "async function load*" only. That is the tools/ui convention, but
    // it is also this spec's blind spot: any other spelling would be silently unclassified and could
    // ship with no token capture at all while every test here stayed green. So the convention is
    // pinned rather than assumed - an arrow-function loader, an indented declaration or a class
    // method must be rewritten as a top-level declaration (or this spec taught to find it).
    const offenders: string[] = [];
    const ALT = [
      /(^|[\s;(])(?:const|let|var)\s+load\w*\s*=\s*(?:async\b|[^=;]*=>)/,
      /^\s+async\s+function\s+load\w*\s*\(/,
      /^\s+async\s+load\w*\s*\(/,
    ];
    for (const f of files) {
      sources[f].split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (ALT.some((re) => re.test(line))) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 110)}`);
      });
    }
    expect(offenders, `loaders must be top-level "async function load*" declarations:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every painting loader captures its guard BEFORE the first await', () => {
    for (const l of found) {
      if (STATE_ONLY.includes(l.name)) continue;
      const captured = l.before.includes('RENDER_TOKEN') || /\btoken\b/.test(l.params);
      expect(captured, `${l.file}: ${l.name} must capture RENDER_TOKEN (or take a token param) before its first await`).toBe(true);
      if (TAB_SCOPED.includes(l.name)) {
        expect(l.before.includes('tabGen()'), `${l.file}: ${l.name} must capture tabGen() before its first await`).toBe(true);
      }
    }
  });

  it('every painting loader re-checks the guard AFTER the first await and BEFORE it paints', () => {
    // Presence alone is not the contract. A loader that writes innerHTML and only THEN asks whether
    // it is stale has already overpainted the view the user chose - which is the bug this spec
    // exists for - so the bail must come first. `paint` is the loader's first innerHTML write after
    // its first await; -1 means it paints nothing once it has awaited.
    for (const l of found) {
      if (STATE_ONLY.includes(l.name)) continue;
      const bail = l.after.indexOf('stale(token)');
      expect(bail, `${l.file}: ${l.name} must re-check stale(token) after its first await`).toBeGreaterThan(-1);
      const paint = l.after.indexOf('innerHTML');
      if (paint > -1) {
        expect(bail, `${l.file}: ${l.name} paints (innerHTML) BEFORE it re-checks stale(token) - a slow answer for the render you left overwrites the one you chose`).toBeLessThan(paint);
      }
      if (TAB_SCOPED.includes(l.name)) {
        const tabBail = l.after.indexOf('tabStale(gen)');
        expect(tabBail, `${l.file}: ${l.name} must re-check tabStale(gen) after its first await`).toBeGreaterThan(-1);
        if (paint > -1) {
          expect(tabBail, `${l.file}: ${l.name} paints before it re-checks tabStale(gen) - #tabbody survives a sub-tab switch, so this overpaints the sub-tab just chosen`).toBeLessThan(paint);
        }
      }
    }
  });

  it('loadBooks is exempt because it paints nothing - it only writes BOOKS/ACCOUNTS/MODE', () => {
    const l = found.find((x) => x.name === 'loadBooks');
    expect(l, 'loadBooks must still exist in app.js').toBeTruthy();
    expect(l!.after).not.toMatch(/innerHTML/);
  });

  it('app.js owns the guard primitives, and subTabs stamps the generation the loaders read', () => {
    const app = sources['app.js'];
    expect(app).toContain('function tabGen() {');
    expect(app).toContain('function tabStale(gen) { return tabGen() !== gen; }');
    expect(app).toContain('function stale(token) { return token !== RENDER_TOKEN; }');
    expect(app).toContain('<div id="tabbody" data-gen="');
    expect(app).toMatch(/SUB_GEN \+= 1;[\s\S]{0,200}setAttribute\('data-gen'/);
  });

  it('loadRosterTab bails BEFORE it writes BOOKS, wires the roster or fills the live pickers', () => {
    const vs = sources['view-strategies.js'];
    const body = vs.slice(vs.indexOf('async function loadRosterTab()'));
    const bail = body.indexOf('tabStale(gen)');
    const books = body.indexOf('BOOKS = j.books');
    const wire = body.indexOf('wireRoster(');
    const fill = body.indexOf('fillStrategyPickers()');
    expect(bail).toBeGreaterThan(-1);
    expect(bail).toBeLessThan(books);
    expect(books).toBeLessThan(wire);
    expect(wire).toBeLessThan(fill);
  });

  it('the roster Start/Stop resolves the enable flag from BOOKS at CLICK time, never from the markup', () => {
    const vs = sources['view-strategies.js'];
    const fn = vs.slice(vs.indexOf('function rosterAction('), vs.indexOf('function rosterAction(') + 700);
    expect(fn).toContain("const b = BOOKS.find(x => x.bookId === bookId);");
    expect(fn).toContain('toggleBook(bookId, !b.enabled)');
    // no data-enable / baked boolean may ride the row markup
    expect(vs).not.toMatch(/data-enable/);
    expect(vs).not.toMatch(/data-act="toggle"[^>']*'\s*\+\s*\(!b\.enabled\)/);
  });

  it('the account header resolves its book from BOOK at CLICK time, and #stratLine sits inside #acctHead', () => {
    const va = sources['view-account.js'];
    expect(va).toContain('function acctHeaderAction(act) {');
    expect(va).toContain('const b = bookOf(BOOK);');
    expect(va).toMatch(/id="acctHead"[\s\S]*id="stratLine"/);
  });

  it('no loader is left as a bare async wrapper with a painting caller that ignores the guard', () => {
    // loadTuning and loadAlgos paint synchronously and delegate every awaited paint to guarded
    // loaders, so they must NOT be async (an async keyword here would demand a token capture).
    expect(all).toContain('function loadTuning() {');
    expect(all).not.toContain('async function loadTuning(');
    expect(all).toContain('function loadAlgos() {');
    expect(all).not.toContain('async function loadAlgos(');
  });
});
