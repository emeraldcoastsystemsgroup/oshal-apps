/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (movies--movies-concierge, FIX-BROKEN): in Light Blue the title sheet was the
 *   theme's translucent glass over a dark blurred scrim, and the synopsis a fixed #d8d8ea, about 1.2:1; in Graphite the
 *   Search button printed white on a pale silver fill. Regression guard over the served surface: the sheet is painted with
 *   an opaque surface token, the synopsis with the second ink token, the page is dimmed by the scrim token with no blur, and
 *   accent buttons take the theme's on-accent ink. A computed check pins the Light Blue and Graphite fallbacks above 4.5:1.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'movies-app.html'), 'utf8');
const rule = (sel) => { const m = HTML.match(new RegExp('\\n\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };

test('the title sheet is opaque and the page behind it is dimmed by the scrim token, with no blur', () => {
  const sheet = rule('.sheet');
  assert.match(sheet, /background:var\(--ds-surface,var\(--bg-primary,#0a0a12\)\)/);
  assert.doesNotMatch(sheet, /backdrop-filter|--bg2/);
  const modal = rule('.modal');
  assert.match(modal, /background:var\(--ds-scrim,/);
  assert.doesNotMatch(modal, /backdrop-filter/);
});

test('the synopsis uses the second ink token, never a fixed light grey', () => {
  const ov = rule('.sheet .ov');
  assert.match(ov, /color:var\(--ds-ink-2,var\(--text-secondary,var\(--muted\)\)\)/);
  assert.doesNotMatch(HTML, /#d8d8ea/);
});

test('accent buttons and the viewer\'s own chat bubble take the theme\'s on-accent ink', () => {
  assert.match(rule('.btn'), /color:var\(--ds-on-accent,var\(--text-on-accent,#fff\)\)/);
  assert.match(rule('.msg.me'), /color:var\(--ds-on-accent,var\(--text-on-accent,#fff\)\)/);
});

/** WCAG relative-luminance contrast of two #rrggbb colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('with today\'s theme files the fallbacks read at 4.5:1 or better (Light Blue and Graphite, cockpit css/themes)', () => {
  // The values the fallbacks resolve to: --bg-primary / --text-secondary, and --accent-primary / --text-on-accent.
  const lightBlue = { bg: '#eaf4ff', ink2: '#315b8a', accent: '#3b82f6', onAccent: '#111827' };
  const graphite = { bg: '#0c0d10', ink2: '#d1d5db', accent: '#c0cad8', onAccent: '#111827' };
  for (const [name, t] of Object.entries({ lightBlue, graphite })) {
    assert.ok(contrast(t.bg, t.ink2) >= 4.5, `${name} synopsis ${contrast(t.bg, t.ink2).toFixed(2)}`);
    assert.ok(contrast(t.accent, t.onAccent) >= 4.5, `${name} button ${contrast(t.accent, t.onAccent).toFixed(2)}`);
  }
  assert.ok(contrast('#c0cad8', '#ffffff') < 2, 'the old Graphite white-on-silver really was unreadable');
});
