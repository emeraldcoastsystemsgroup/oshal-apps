/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | F19 regression guard: team buttons across the lobby, You sheet, and Host Desk use design tokens (selected accent fill + on-accent text >= 4.5:1; unselected surface + hairline border + ink >= 4.5:1), carry team identity via .gs-team-dot rather than button fill, and keep theme-aware team hues >= 3:1 across all twenty portal themes at 412x915 and 1440x900 while .gp-studio retains broadcast hues.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(REPO, 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const { themes: THEME_TOKENS } = JSON.parse(
  fs.readFileSync(path.join(REPO, 'dnd', 'tests', 'browser', 'theme-tokens.json'), 'utf8'),
);

const ON_ACCENT = {
  midnight: '#111827', daylight: '#ffffff', ocean: '#111827', sakura: '#111827', forest: '#111827',
  gray: '#111827', black: '#111827', 'light-blue': '#111827', aurora: '#111827', graphite: '#111827',
  amber: '#111827', workspace: '#ffffff', studio: '#20311f', jarvis: '#fffaf5', orbit: '#ffffff',
  commons: '#ffffff', nexus: '#10242b', family: '#ffffff', classroom: '#ffffff', company: '#ffffff',
};

const LIGHT_THEMES = new Set([
  'daylight', 'light-blue', 'workspace', 'jarvis', 'orbit', 'commons', 'family', 'classroom', 'company',
]);

function buildThemeSheet() {
  return Object.entries(THEME_TOKENS).map(([id, vars]) => {
    const entries = Object.entries({ ...vars, '--text-on-accent': ON_ACCENT[id] })
      .map(([k, v]) => `${k}:${v};`).join('');
    return `html[data-theme="${id}"]{${entries}}`;
  }).join('\n');
}

function makeRoom(role, control) {
  const me = {
    seatId: 'me', name: 'Sam Rivera', team: role === 'host' ? null : 'A',
    role, me: true, npc: null, presenceKind: 'avatar', presenceRev: 0,
  };
  const bot = {
    seatId: 'b1', name: 'Bo', team: 'B', role: 'player',
    me: false, npc: 'sharp', presenceKind: 'avatar', presenceRev: 0,
  };
  return {
    ok: true, now: Date.now(), rev: 3, events: [], seats: [me, bot],
    scoreboard: [{ team: 'A', name: 'Team A', score: 40 }, { team: 'B', name: 'Team B', score: 20 }],
    room: { roomId: 'r1', isOwner: true, status: 'live', joinCode: 'AB12CD' },
    show: { id: 'family-feud', title: 'Family Feud', teams: true },
    state: {
      showId: 'family-feud', phase: 'faceoff', round: 1,
      buzz: { open: true, serial: 1 },
      host: { line: 'Name something people bring to game night.', at: Date.now() },
      timer: { endsAt: Date.now() + 30000, ms: 30000, note: 'Buzz in' },
      board: {
        question: 'Name something people bring to game night.',
        faceoff: null, strikes: 0, bank: 0, multiplier: 1, control,
        answers: [{ text: 'Snacks', points: 50, revealed: false }], roundsTotal: 3,
      },
    },
  };
}

async function startFixtureServer() {
  const app = express();
  const sheet = buildThemeSheet();
  let mode = 'player';
  app.use(express.json());
  app.get('/stage', (_req, res) => res.sendFile(path.join(PKG, 'ui', 'stage.html')));
  app.get('/api/game-show/state', (_req, res) => {
    res.json(mode === 'hostOnly' ? makeRoom('host', null) : makeRoom('player', 'A'));
  });
  app.get('/api/game-show/shows', (_req, res) => {
    res.json({ ok: true, shows: [{ id: 'family-feud', title: 'Family Feud' }, { id: 'jeopardy', title: 'Jeopardy' }] });
  });
  app.get('/api/game-show/rooms', (_req, res) => res.json({ ok: true, rooms: [] }));
  app.get('/api/game-show/leaderboard', (_req, res) => res.json({ ok: true, entries: [] }));
  app.post('/api/game-show/sync', (_req, res) => {
    const r = mode === 'hostOnly' ? makeRoom('host', null) : makeRoom('player', 'A');
    res.json({ ok: true, now: Date.now(), rev: 3, changed: false, seats: r.seats, scoreboard: r.scoreboard, events: [], status: 'live' });
  });
  app.get(/^\/api\/game-show\/[\w-]+\.(js|css)$/, (req, res) => res.sendFile(path.join(PKG, 'ui', path.basename(req.path))));
  app.use('/api/game-show', (_req, res) => res.json({ ok: true }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(sheet));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, setMode: (m) => { mode = m; } };
}

function measureTeamChoicePair(scopeSelector) {
  const parse = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css);
    if (!m) return [0, 0, 0, 1];
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  };
  const over = (t, u) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
  const lum = (c) => {
    const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const cr = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const ground = (el) => {
    const stops = (img) => (img.match(/rgba?\([^)]+\)/g) || []).map(parse);
    let g = [255, 255, 255, 1];
    const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n);
    for (const n of chain) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg[3] > 0) g = over(bg, g);
      const st = cs.backgroundImage && cs.backgroundImage !== 'none' ? stops(cs.backgroundImage) : [];
      if (st.length) g = over(st[0], g);
    }
    return g;
  };
  const root = document.querySelector(scopeSelector);
  const btnA = root.querySelector('button.gs-choice[data-team="A"]');
  const btnB = root.querySelector('button.gs-choice[data-team="B"]');
  const dotA = btnA.querySelector('.gs-team-dot');
  const dotB = btnB.querySelector('.gs-team-dot');
  const bgA = ground(btnA), bgB = ground(btnB), pageBg = parse(getComputedStyle(document.body).backgroundColor);
  const cA = parse(getComputedStyle(dotA).backgroundColor), cB = parse(getComputedStyle(dotB).backgroundColor);
  const csA = getComputedStyle(btnA), csB = getComputedStyle(btnB);
  const rDot = dotA.getBoundingClientRect();
  return {
    selectedInkRatio: cr(over(parse(csA.color), bgA), bgA),
    unselectedInkRatio: cr(over(parse(csB.color), bgB), bgB),
    dotAOnSurface: cr(cA, bgB),
    dotBOnSurface: cr(cB, bgB),
    dotAOnPage: cr(cA, pageBg),
    dotBOnPage: cr(cB, pageBg),
    dotWidth: rDot.width,
    dotHeight: rDot.height,
    dotsDistinct: csA.backgroundColor !== csB.backgroundColor && getComputedStyle(dotA).backgroundColor !== getComputedStyle(dotB).backgroundColor,
    unselectedBorderPx: parseFloat(csB.borderTopWidth),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
}

let browser;
let fixture;
test.before(async () => {
  fixture = await startFixtureServer();
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
  await new Promise((r) => fixture.server.close(r));
});

for (const theme of ['light-blue', 'midnight']) {
  for (const viewport of [{ width: 412, height: 915 }, { width: 1440, height: 900 }]) {
    test(`F19 lobby, You sheet, and Host Desk team buttons in ${theme} at ${viewport.width}x${viewport.height}`, async () => {
      fixture.setMode('player');
      const touch = viewport.width < 700;
      const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
      const page = await ctx.newPage();
      try {
        await page.goto(`${fixture.base}/stage?lobby=1`);
        await page.locator('button.gs-choice[data-team="A"]').waitFor();
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        const lobby = await page.evaluate(measureTeamChoicePair, '#gs-root');
        assert.ok(lobby.selectedInkRatio >= 4.5 && lobby.unselectedInkRatio >= 4.5);
        assert.ok(lobby.dotAOnSurface >= 3 && lobby.dotBOnSurface >= 3 && lobby.dotsDistinct);
        assert.ok(lobby.dotWidth >= 8 && lobby.dotWidth <= 12 && lobby.unselectedBorderPx >= 1 && !lobby.overflowX);

        await page.goto(`${fixture.base}/stage?view=clicker&room=r1`);
        await page.locator('.gs-clickwho .gp-you-btn').waitFor();
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.locator('.gs-clickwho .gp-you-btn').click();
        await page.locator('#gs-sheets [aria-label="You"]').waitFor();
        const you = await page.evaluate(measureTeamChoicePair, '#gs-sheets');
        assert.ok(you.selectedInkRatio >= 4.5 && you.unselectedInkRatio >= 4.5 && you.dotAOnSurface >= 3 && you.dotBOnSurface >= 3 && !you.overflowX);

        await page.goto(`${fixture.base}/stage?view=host&room=r1`);
        await page.locator('.gs-desk').waitFor();
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        if (touch) await page.locator('.gs-desk-bar button', { hasText: 'Clock' }).click();
        const host = await page.evaluate(measureTeamChoicePair, '.gs-override');
        assert.ok(host.selectedInkRatio >= 4.5 && host.unselectedInkRatio >= 4.5 && host.dotAOnSurface >= 3 && host.dotBOnSurface >= 3 && !host.overflowX);
      } finally {
        await ctx.close();
      }
    });
  }
}

test('F19 all 20 themes satisfy >= 4.5:1 button text and >= 3:1 team dots while .gp-studio keeps broadcast hues', async () => {
  fixture.setMode('player');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${fixture.base}/stage?view=clicker&room=r1`);
    await page.locator('.gs-clickwho .gp-you-btn').click();
    await page.locator('#gs-sheets [aria-label="You"]').waitFor();
    for (const theme of Object.keys(THEME_TOKENS)) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const m = await page.evaluate(measureTeamChoicePair, '#gs-sheets');
      assert.ok(m.selectedInkRatio >= 4.5, `${theme}: selected ink ${m.selectedInkRatio.toFixed(2)}:1`);
      assert.ok(m.unselectedInkRatio >= 4.5, `${theme}: unselected ink ${m.unselectedInkRatio.toFixed(2)}:1`);
      assert.ok(m.dotAOnSurface >= 3 && m.dotAOnPage >= 3, `${theme}: teamA dot ${m.dotAOnSurface.toFixed(2)}:1`);
      assert.ok(m.dotBOnSurface >= 3 && m.dotBOnPage >= 3, `${theme}: teamB dot ${m.dotBOnSurface.toFixed(2)}:1`);
      const rootVars = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return [cs.getPropertyValue('--gs-teamA').trim(), cs.getPropertyValue('--gs-teamB').trim()];
      });
      assert.deepEqual(rootVars, LIGHT_THEMES.has(theme) ? ['#0369a1', '#be185d'] : ['#38bdf8', '#f472b6']);
    }
    await page.goto(`${fixture.base}/stage?view=stage&room=r1`);
    await page.locator('.gp-studio').waitFor();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light-blue'));
    const studioVars = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.gp-studio'));
      return [cs.getPropertyValue('--gs-teamA').trim(), cs.getPropertyValue('--gs-teamB').trim()];
    });
    assert.deepEqual(studioVars, ['#38bdf8', '#f472b6']);
  } finally {
    await ctx.close();
  }
});
