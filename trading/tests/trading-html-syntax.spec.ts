/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — parse every inline <script> block in trading.html so a JS syntax error (e.g. a raw newline inside a string literal from a bad codegen edit) can never ship a page that loads to a blank spinner. The store build compiles src-routes/*.ts but never touches the HTML surface; this closes that gap (2026-09-03: a literal newline in a confirm() string broke the entire page).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D2 split: also parse every tools/ui/*.js module (classic scripts), and prove every <script src="/api/trading/ui/X.js"> the shell references exists on disk — a missing module is a blank view, not a build error.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D6 carve: view-events.js joins the module list; every cross-module event helper (called at render time from view-account.js / view-accounts.js / view-strategies.js) must be defined EXACTLY once across tools/ui/*.js — a half-moved block would otherwise blank the Event playbooks tab or the Studio card at click time, which no parse check sees.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Strict-CSP pins (ADR-136 D2 tail): no inline event-handler attribute, no javascript: URL, no eval / new Function / string timer anywhere in trading.html or tools/ui - comments are stripped before the scan so prose about a removed attribute cannot turn the guard red. Plus the policy the pins are written against, read from the kernel rather than described: buildStrictCsp gives script-src 'self' alone (no unsafe-inline / unsafe-hashes / unsafe-eval) while style-src keeps 'unsafe-inline', which is what makes this surface's style attributes legal, and cspMode maps OSHAL_STRICT_CSP=on to enforce.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Close four gaps a review found in the SEQ 4 pins. (a) The inline-block test only PARSED whatever it found - "zero blocks is the goal" was a comment, not an assertion - so any new inline block that was not literally the old bootstrap shape passed green while breaking the surface under script-src 'self'; zero is now asserted. (b) A handler installed as a STRING at runtime (setAttribute('onclick', ...) or el.onclick = '...') is refused by the same directive and was invisible to the markup-attribute scan. (c) These pins read trading.html + tools/ui, which this package owns, but the shell also loads two scripts it does not; the set of external script sources is now pinned to a named allowlist, so widening the blast radius is a deliberate edit here. (d) The cspMode pin now covers the PRECEDENCE that decides whether an enforce-mode canary tests anything at all: OSHAL_CSP_REPORT_ONLY beats OSHAL_STRICT_CSP, and this deployment sets both, so the canary's real step is unsetting the report-only pin - not setting an enforce flag that is already on.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Round-3 review: the handler-attribute pin was case-sensitive and demanded a quote after '=', so ONCLICK="x()" and the unquoted onclick=x() (both legal HTML, both refused under script-src 'self') read as clean; and the runtime string-handler pin missed the bracket form el['onclick'] = '...' and a template-literal setAttribute(`onclick`, ...). Both are widened here. Also new: the cross-module globals the delegated listeners call at CLICK time (openTicket in ticket.js, setBookStrategy/resetBookStrategy/toggleBook in view-strategies.js, bookOf/navigate in app.js) are pinned from both ends - defined exactly once in the module named here, AND still called from a different module - because moving a handler from an attribute into a listener turned those calls into late-bound globals: a rename would be a silent ReferenceError on a money-adjacent button with every other spec green.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { buildStrictCsp, cspMode } from '@/features/security/hardening/strict-csp';

const TOOLS = path.resolve(__dirname, '..', 'tools');
const UI = path.join(TOOLS, 'ui');

/**
 * Strip comments before scanning for handler attributes. A CHANGE LOG entry or a code comment that
 * QUOTES a removed attribute would otherwise turn this guard red on the very commit that removes it -
 * the guard must read the shipped markup, not the prose about it. Block comments go first; only
 * whole-line // comments are stripped, so a 'https://...' inside a string is never touched.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/**
 * Any HTML event-handler attribute, in BOTH legal spellings. HTML attribute names are
 * case-insensitive (ONCLICK= is the same attribute) and the value may be unquoted, so a
 * quote-and-lowercase-only pin let two shapes the browser still refuses read as clean.
 */
const HANDLER_ATTR = [
  /[\s"']on[a-z]+\s*=\s*\\?["']/i,        // onclick="x()", or escaped inside a JS string
  /[\s"']on[a-z]+=[^\s"'=<>]+[^<>]*>/i,    // <button onclick=x()> - unquoted attribute value
];

describe('trading surface — every script parses', () => {
  it('trading.html carries ZERO inline <script> blocks (and any that somehow exist parse)', () => {
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    // An inline block is THE canonical script-src 'self' violation: under enforcement the browser
    // refuses to run it and the shell loads dead. boot() is registered from app.js instead. This is
    // an assertion, not a comment - the previous shape only rejected the one literal bootstrap block.
    expect(
      blocks.map((b) => b[1].trim().slice(0, 80)),
      'strict CSP: the shell must carry no inline script block',
    ).toEqual([]);
    // Kept from SEQ 1: should one ever be re-added deliberately it must at least parse, so a syntax
    // error is never what a reader has to blame a blank page on.
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

  it('every script the shell loads is a package module or a NAMED external (the guard scope)', () => {
    // The pins in this file read trading.html + tools/ui, which this package owns. The shell also
    // loads scripts it does not own; they sit inside the same policy, so the SET is pinned here.
    // Adding one means editing this list AND hand-checking the new file for eval / new Function /
    // string timers - the scope of the other pins can no longer widen silently.
    const EXTERNAL_OK = ['/api/trading-charts/vendor/lightweight-charts.js', '/shared/ui/js/surface-theme.js'];
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
    const external = srcs.filter((s) => !s.startsWith('/api/trading/ui/')).sort();
    expect(external, 'an unexpected external script joined the surface').toEqual(EXTERNAL_OK);
    // All same-origin, so 'self' covers them; a cross-origin src would be blocked outright.
    expect(srcs.filter((s) => /^(https?:)?\/\//.test(s)), 'no cross-origin script src').toEqual([]);
  });

  it('the shell has no inline bootstrap script — boot() is registered from app.js (CSP)', () => {
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    expect(html).not.toMatch(/<script>\s*boot\(\)/);
    expect(readFileSync(path.join(UI, 'app.js'), 'utf8')).toContain("document.addEventListener('DOMContentLoaded', boot);");
  });

  it('no inline event-handler attribute survives anywhere on the surface (strict CSP)', () => {
    const offenders: string[] = [];
    const check = (name: string, src: string) => {
      const clean = stripComments(src);
      clean.split('\n').forEach((line, i) => { if (HANDLER_ATTR.some((re) => re.test(line))) offenders.push(`${name}:${i + 1} ${line.trim().slice(0, 110)}`); });
    };
    check('trading.html', readFileSync(path.join(TOOLS, 'trading.html'), 'utf8'));
    for (const f of readdirSync(UI).filter((x) => x.endsWith('.js'))) check(f, readFileSync(path.join(UI, f), 'utf8'));
    expect(offenders, `inline handler attributes must be delegated listeners:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no handler is installed as a STRING at runtime either (setAttribute / el.onclick =)', () => {
    // The markup scan above reads source attributes only. Setting the same attribute from JS -
    // el.setAttribute('onclick', '...') - produces an inline handler the browser refuses under
    // script-src 'self' just the same, and assigning a string to el.onclick is the third spelling.
    // Each has an alternate spelling the first pass missed: a template-literal attribute name,
    // and the bracket form el['onclick'] = '...', which is the dot form at runtime.
    const offenders: string[] = [];
    const files = ['trading.html', ...readdirSync(UI).filter((x) => x.endsWith('.js'))];
    for (const f of files) {
      const clean = stripComments(readFileSync(f === 'trading.html' ? path.join(TOOLS, f) : path.join(UI, f), 'utf8'));
      const PATS = [
        /setAttribute\s*\(\s*["'`]on[a-z]+["'`]/i,          // setAttribute('onclick', ..) or (`onclick`, ..)
        /\.on[a-z]+\s*=\s*["'`]/i,                          // el.onclick = '..'  (a function reference is legal)
        /\[\s*["'`]on[a-z]+["'`]\s*\]\s*=\s*["'`]/i,        // el['onclick'] = '..'
      ];
      for (const pat of PATS) {
        if (pat.test(clean)) offenders.push(`${f}: ${pat}`);
      }
    }
    expect(offenders, `handlers must be addEventListener, never a string: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('no javascript: URL, eval, new Function or string timer in the surface (strict CSP)', () => {
    const offenders: string[] = [];
    const files = ['trading.html', ...readdirSync(UI).filter((x) => x.endsWith('.js'))];
    for (const f of files) {
      const clean = stripComments(readFileSync(f === 'trading.html' ? path.join(TOOLS, f) : path.join(UI, f), 'utf8'));
      for (const pat of [/javascript:/, /\beval\s*\(/, /new Function\s*\(/, /set(Timeout|Interval)\s*\(\s*["']/]) {
        if (pat.test(clean)) offenders.push(`${f}: ${pat}`);
      }
    }
    expect(offenders, offenders.join(' | ')).toEqual([]);
  });

  it('the kernel policy this surface is written against: script-src is self only; style-src keeps unsafe-inline', () => {
    // The source pins above are only meaningful against the REAL policy, so read it rather than
    // describing it. OSHAL_STRICT_CSP=on is the enforcement flag (there is no CSP_MODE variable).
    const d = buildStrictCsp({ reportUri: '/api/security/csp-report' });
    expect(d['script-src']).toEqual(["'self'"]);
    for (const bad of ["'unsafe-inline'", "'unsafe-hashes'", "'unsafe-eval'"]) {
      expect(d['script-src'], `script-src must never carry ${bad}`).not.toContain(bad);
    }
    // The surface ships an inline <style> block and emits style="" attributes from every ui module;
    // both are legal ONLY because style-src keeps 'unsafe-inline'. If that default ever flips, this
    // pin fails before the surface does.
    expect(d['style-src']).toContain("'unsafe-inline'");
    expect(readFileSync(path.join(TOOLS, 'trading.html'), 'utf8')).toMatch(/<style>/);
    const uiStyled = readdirSync(UI).filter((f) => f.endsWith('.js')).filter((f) => readFileSync(path.join(UI, f), 'utf8').includes('style="'));
    expect(uiStyled.length, 'the ui modules emit inline style attributes').toBeGreaterThan(0);
    expect(cspMode({ OSHAL_STRICT_CSP: 'on' } as NodeJS.ProcessEnv)).toBe('enforce');
    expect(cspMode({} as NodeJS.ProcessEnv)).toBe('report-only');
    expect(cspMode({ OSHAL_CSP: 'off' } as NodeJS.ProcessEnv)).toBe('disabled');
    // The precedence an enforce-mode canary MUST know, pinned here so the runbook cannot drift from
    // it: OSHAL_CSP_REPORT_ONLY beats OSHAL_STRICT_CSP. Setting the enforce flag on a box that
    // already pins report-only changes NOTHING - an operator would click through a Report-Only
    // header, grep a clean log and record "zero violations under enforcement" having tested nothing.
    // Unsetting OSHAL_CSP_REPORT_ONLY (and restarting) is the step that actually enforces.
    expect(cspMode({ OSHAL_STRICT_CSP: 'on', OSHAL_CSP_REPORT_ONLY: 'on' } as NodeJS.ProcessEnv)).toBe('report-only');
    expect(cspMode({ OSHAL_STRICT_CSP: 'on', OSHAL_CSP: 'off' } as NodeJS.ProcessEnv)).toBe('disabled');
  });

  it('every view the router dispatches to is defined by some module', () => {
    const all = readdirSync(UI).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(UI, f), 'utf8')).join('\n');
    for (const fn of ['renderAccountsView', 'renderAccountView', 'renderStrategiesView', 'renderResearchView', 'renderReportsView']) {
      expect(all, `${fn} must be defined by a ui module`).toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
    }
  });
  it('every global a delegated listener calls at click time is defined exactly once, and the cross-module call still exists', () => {
    // Moving an action out of an onclick attribute into a delegated listener does not change WHERE
    // the work lives - it changes WHEN the name is resolved. These are late-bound globals across
    // classic scripts, so a rename on either side is a ReferenceError at CLICK time on a
    // money-adjacent button while every parse/attribute pin here stays green. Pinned from BOTH
    // ends: renaming the definition empties definedIn; renaming the wire empties the callers.
    const DELEGATED: Array<[string, string, boolean]> = [
      ['openTicket', 'ticket.js', true],                 // #acctHead data-act="buy"
      ['setBookStrategy', 'view-strategies.js', true],   // #acctHead data-act="set"   + #rosterHost
      ['resetBookStrategy', 'view-strategies.js', true], // #acctHead data-act="reset" + #rosterHost
      ['toggleBook', 'view-strategies.js', true],        // the Start/Stop confirm gate lives inside it
      ['bookOf', 'app.js', true],                        // resolves the book at CLICK time, not at paint
      ['navigate', 'app.js', true],                      // #acctHead data-act="research"
      ['acctToggleTrading', 'view-account.js', false],   // wired within its own module
      ['discoverAccounts', 'view-accounts.js', false],   // #discoverBtn, bound by REFERENCE in wireDiscovered()
    ];
    const uiFiles = readdirSync(UI).filter((f) => f.endsWith('.js'));
    const clean = Object.fromEntries(uiFiles.map((f) => [f, stripComments(readFileSync(path.join(UI, f), 'utf8'))]));
    for (const [fn, owner, crossModule] of DELEGATED) {
      const decl = new RegExp(`(^|\\n)(async\\s+)?function\\s+${fn}\\s*\\(`);
      const definedIn = uiFiles.filter((f) => decl.test(clean[f]));
      expect(definedIn, `${fn} must be defined exactly once, in ${owner}`).toEqual([owner]);
      // Count REFERENCES, not calls: a delegated wire may be `btn.onclick = discoverAccounts`
      // (a function reference - the legal, non-string form), which no `name(` scan would see.
      // The owner file always contains the declaration itself, so one hit there is not a use.
      const callers = uiFiles.filter((f) => {
        const hits = (clean[f].match(new RegExp(`\\b${fn}\\b`, 'g')) || []).length;
        return f === owner ? hits > 1 : hits > 0;
      });
      if (crossModule) {
        expect(
          callers.filter((f) => f !== owner),
          `${fn} is pinned as a cross-module call, but nothing outside ${owner} calls it any more - the delegated listener was renamed or removed`,
        ).not.toEqual([]);
      } else {
        expect(callers, `${fn} must still be wired by its own module`).toContain(owner);
      }
    }
  });

  it('every cross-module event-playbook helper is defined exactly once, in view-events.js, and the shell loads that module', () => {
    const files = readdirSync(UI).filter((f) => f.endsWith('.js'));
    const sources = Object.fromEntries(files.map((f) => [f, readFileSync(path.join(UI, f), 'utf8')]));
    const html = readFileSync(path.join(TOOLS, 'trading.html'), 'utf8');
    expect(html).toContain('<script src="/api/trading/ui/view-events.js"></script>');
    for (const fn of ['eventPlanActive', 'eventStatusPill', 'eventEntryExitText', 'renderStudioEventResult', 'studioArmEvent', 'studioDisarmEvent', 'loadEventPlansTab', 'eventRemindersText']) {
      const definedIn = files.filter((f) => new RegExp(`(^|\\n)(async\\s+)?function\\s+${fn}\\s*\\(`).test(sources[f]));
      expect(definedIn, `${fn} must be defined exactly once, in view-events.js`).toEqual(['view-events.js']);
    }
  });
});
