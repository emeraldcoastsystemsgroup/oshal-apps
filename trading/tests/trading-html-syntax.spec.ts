/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — parse every inline <script> block in trading.html so a JS syntax error (e.g. a raw newline inside a string literal from a bad codegen edit) can never ship a page that loads to a blank spinner. The store build compiles src-routes/*.ts but never touches the HTML surface; this closes that gap (2026-09-03: a literal newline in a confirm() string broke the entire page).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D2 split: also parse every tools/ui/*.js module (classic scripts), and prove every <script src="/api/trading/ui/X.js"> the shell references exists on disk — a missing module is a blank view, not a build error.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';

const TOOLS = path.resolve(__dirname, '..', 'tools');
const UI = path.join(TOOLS, 'ui');

describe('trading surface — every script parses', () => {
  it('every inline <script> block in trading.html is syntactically valid JS', () => {
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    // Zero inline blocks is the goal (CSP): boot() runs on DOMContentLoaded from app.js. Any that exist must parse.
    const errors: string[] = [];
    blocks.forEach((b, i) => {
      try { new Function(b[1]); } catch (e) { errors.push(`block ${i}: ${(e as Error).message}`); }
    });
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  it('every tools/ui/*.js module is syntactically valid JS (classic script)', () => {
    const files = readdirSync(UI).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    const errors: string[] = [];
    for (const f of files) {
      const src = readFileSync(path.join(UI, f), 'utf8');
      try { new Function(src); } catch (e) { errors.push(`${f}: ${(e as Error).message}`); }
    }
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  it('every module the shell references exists, and app.js loads first', () => {
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    const refs = [...html.matchAll(/<script src="\/api\/trading\/ui\/([^"?]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(1);
    expect(refs[0]).toBe('app.js');
    const missing = refs.filter((f) => !existsSync(path.join(UI, f)));
    expect(missing, `referenced but missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('the shell has no inline bootstrap script — boot() is registered from app.js (CSP)', () => {
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    expect(html).not.toMatch(/<script>\s*boot\(\)/);
    expect(readFileSync(path.join(UI, 'app.js'), 'utf8')).toContain("document.addEventListener('DOMContentLoaded', boot);");
  });

  it('every view the router dispatches to is defined by some module', () => {
    const all = readdirSync(UI).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(UI, f), 'utf8')).join('\n');
    for (const fn of ['renderAccountsView', 'renderAccountView', 'renderStrategiesView', 'renderResearchView', 'renderReportsView']) {
      expect(all, `${fn} must be defined by a ui module`).toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
    }
  });
});
