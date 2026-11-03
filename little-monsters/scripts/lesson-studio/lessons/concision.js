/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Remove true redundancy as packing light: extra words turn into suitcases that get thrown off the board while the sentence closes up, a meaning meter stays level when only a repeat goes and drains when a real detail goes, then the words fly back
 */
(function () {
  const DARK = '#16352b', LABEL = '#173a30', WHITE = '#f5f3ea';
  const PINK = '#ff9ccf', TEAL = '#8fe6cf', BLUE = '#9fd0ff', YELLOW = '#ffd66b', RED = '#ff8080';
  const ROW = { label: 450, x: 470, w: 630, step: 90 };
  const GONE = { dx: 90, dy: 760, rise: 20, spin: 70 };
  const LOWER = [{ dx: -20, dy: 560, rise: 30, spin: -70 }, { dx: 30, dy: 560, rise: 30, spin: 80 }];

  /** A node's box on the current page. Valid while building, before anything has moved. */
  function spot(s, node) {
    const r = node.getBoundingClientRect(), o = s.page.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  /** A suitcase with a handle and straps. x, y, w and h include the handle. */
  function bag(s, { x, y, w, h, color = PINK, label = [], size = 60, font = 'Fredoka', handle = 34 }) {
    const body = h - handle, r = Math.min(22, body * 0.2), a = w * 0.34, b = w * 0.66, bend = Math.min(14, handle * 0.4);
    const weight = font === 'Fredoka' ? 600 : 400;
    const text = label.map((t, i) => {
      const ty = handle + body / 2 + (i - (label.length - 1) / 2) * size * 1.14;
      return `<text x="${w / 2}" y="${ty}" dy=".35em" text-anchor="middle" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="${LABEL}">${t}</text>`;
    }).join('');
    const straps = [0.05, 0.95].map((k) => `<rect x="${w * k - 4}" y="${handle + 3}" width="8" height="${body - 9}" fill="${DARK}" opacity=".18"/>`).join('');
    return s.shape(`<path d="M${a},${handle + 6} V${bend + 5} Q${a},5 ${a + bend},5 H${b - bend} Q${b},5 ${b},${bend + 5} V${handle + 6}" fill="none" stroke="${color}" stroke-width="${Math.max(6, handle * 0.28)}" stroke-linecap="round"/>
      <rect x="3" y="${handle}" width="${w - 6}" height="${body - 3}" rx="${r}" fill="${color}" stroke="${DARK}" stroke-width="5"/>${straps}${text}`, { x, y, w, h });
  }

  /** A suitcase laid exactly over words on the board, with the same words on it. */
  function bagOver(s, words, color) {
    const a = spot(s, words[0]), z = spot(s, words[words.length - 1]);
    const handle = 36, pad = 18;
    return bag(s, {
      x: a.x - pad, y: a.y + a.h * 0.05 - handle, w: z.x + z.w - a.x + pad * 2, h: a.h * 0.9 + handle, handle, color,
      label: [words.map((w) => w.textContent).join(' ')], size: parseFloat(getComputedStyle(words[0]).fontSize), font: 'Chalk',
    });
  }

  /** The words on the board become a suitcase. */
  function wordBag(s, words, t, { color = PINK, swipes = [] } = {}) {
    const g = bagOver(s, words, color);
    s.pop(g, t, { dur: 0.24, gain: 0.5 });
    [...words, ...swipes].forEach((n) => s.hide(n, t + 0.08, 0.05));
    return g;
  }

  /** Points along a throw: up by rise, across by dx, down by dy, tumbling by spin degrees. */
  function arc({ dx, dy, rise, spin }) {
    const frames = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      frames.push({ translate: `${(dx * k).toFixed(1)}px ${(dy * k * k - 4 * rise * k * (1 - k)).toFixed(1)}px`, rotate: `${(spin * k).toFixed(1)}deg` });
    }
    return frames;
  }

  /** Throw a suitcase off the board. */
  function fling(s, node, t, path, { dur = 0.8, gain = 0.9 } = {}) {
    s.anim(node, arc(path), t, dur, 'linear');
    s.sfx('whoosh', t, gain);
    return node;
  }

  /** The same throw played backwards. A suitcase not seen yet can wait off the board with fill both. */
  function comeBack(s, node, t, path, { dur = 0.6, gain = 0.7, fill = 'forwards' } = {}) {
    s.anim(node, arc(path).reverse(), t, dur, 'linear', fill);
    s.sfx('whoosh', t, gain);
    return node;
  }

  /** Close the hole a removed word left: the words on both sides slide together. */
  function closeUp(s, line, gone, t) {
    const at = line.w.indexOf(gone);
    const hole = spot(s, gone).w + 0.28 * parseFloat(getComputedStyle(gone).fontSize);
    line.w.forEach((w, i) => {
      if (w === gone) return;
      w._tx = i < at ? hole / 2 : -hole / 2;
      s.anim(w, [{ translate: '0px 0px' }, { translate: `${w._tx}px 0px` }], t, 0.45, 'cubic-bezier(.45,.05,.2,1)');
    });
    s.sfx('swipe', t, 0.5);
  }

  /** A row label at the left of the meter and the suitcases. */
  function rowLabel(s, html, y, at, color) {
    return s.text(html, { x: ROW.label, y, size: 72, align: 'right', color, at, dur: 0.4 });
  }

  /** The meter: a pill that fills up, and whose level can fall and rise. */
  function meter(s, y, at) {
    const h = 84;
    const g = s.shape(`<rect class="lvl" x="8" y="8" width="${ROW.w - 16}" height="${h - 16}" rx="${(h - 16) / 2}" fill="${TEAL}"/>
      <rect class="rim" x="0" y="0" width="${ROW.w}" height="${h}" rx="${h / 2}" fill="none" stroke="${WHITE}" stroke-width="6"/>`, { x: ROW.x, y, w: ROW.w, h });
    s.draw(g.get('.rim'), at, 0.25);
    s.grow(g.get('.lvl'), at + 0.05, 0.4, { from: '0 1', origin: '0% 50%' });
    return g;
  }

  /** One small suitcase per word, in a row. */
  function bagRow(s, y, n, at) {
    return Array.from({ length: n }, (_, i) => {
      const g = bag(s, { x: ROW.x + i * ROW.step, y, w: 78, h: 88, color: YELLOW, handle: 20 });
      s.pop(g, at + i * 0.04, { dur: 0.2, gain: 0.3 });
      return g;
    });
  }

  /** A chalk tick that draws itself. */
  function tick(s, x, y, t, color = TEAL) {
    const g = s.shape(`<path class="t" d="M6,34 L26,56 L66,8" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`, { x, y, w: 72, h: 64 });
    s.draw(g.get('.t'), t, 0.26);
    return g;
  }

  /** The luggage cart: a platform on two wheels, with or without its handle bar. */
  function cart(s, x, y, w, at, { handle = true } = {}) {
    const bar = handle ? `<path class="p" d="M4,10 L-36,-220 L-90,-232" fill="none" stroke="${WHITE}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    const g = s.shape(`<path class="p" d="M0,10 H${w}" fill="none" stroke="${WHITE}" stroke-width="12" stroke-linecap="round"/>${bar}
      <circle class="p" cx="${w * 0.14}" cy="42" r="24" fill="none" stroke="${WHITE}" stroke-width="9"/>
      <circle class="p" cx="${w * 0.86}" cy="42" r="24" fill="none" stroke="${WHITE}" stroke-width="9"/>`, { x, y, w, h: 70 });
    g.querySelectorAll('.p').forEach((p) => s.draw(p, at, 0.45, { gain: 0.25 }));
    return g;
  }

  /** A little monster hops home to a chalk house: returned, drawn. */
  function hopHome(s, c) {
    const home = s.shape(`<path class="p" d="M4,92 L80,18 L156,92 M24,76 V170 H136 V76 M64,170 V116 H96 V170" fill="none" stroke="${WHITE}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="p" d="M170,170 H620" fill="none" stroke="${WHITE}" stroke-width="6" stroke-linecap="round" opacity=".5"/>`, { x: 300, y: 480, w: 620, h: 176 });
    home.querySelectorAll('.p').forEach((p) => s.draw(p, c.why, 0.5, { gain: 0.3 }));
    const pal = s.critter(880, 581, 120, c.why + 0.15, { hue: 150, light: 1.2 });
    const frames = [];
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      frames.push({ translate: `${(-500 * k).toFixed(1)}px ${(-56 * Math.abs(Math.sin(k * Math.PI * 3))).toFixed(1)}px` });
    }
    s.anim(pal, frames, c.cb, 1, 'linear');
    s.sfx('boing', c.cb, 0.35);
  }

  LessonStudio.define({
    id: 'concision',
    teacher: 'bluebold',
    title: 'Remove true redundancy',
    beats: [
      {
        say: `{hi}Hi, Bluebold here! {lug}Some sentences carry {bags}luggage they don't need. Today we throw out the {ex}extra {xb}bags. {but}But only the {extra}extra ones.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.2);
          s.wideCam(c.lug - 0.3, 1.1);
          s.text('Remove true redundancy', { y: 76, size: 96, color: s.ink.yellow, at: c.lug + 0.2, dur: 1 });
          cart(s, 330, 620, 600, c.lug + 0.2);
          s.tag('sentence', { x: 630, y: 644, at: c.lug + 0.4, bg: WHITE, size: 46 });
          const keep = [bag(s, { x: 370, y: 450, w: 260, h: 180, color: TEAL }), bag(s, { x: 650, y: 470, w: 240, h: 160, color: BLUE })];
          const extra = [bag(s, { x: 390, y: 270, w: 220, h: 180, label: ['extra'] }), bag(s, { x: 660, y: 300, w: 210, h: 170, label: ['extra'] })];
          [...keep, ...extra].forEach((g, i) => s.pop(g, c.bags + i * 0.12, { gain: 0.45 }));
          extra.forEach((g) => s.appear(g.querySelector('text'), c.ex, 0.15));
          s.m.point(extra[0], c.bags, 1.2);
          fling(s, extra[0], c.xb + 0.15, { dx: -760, dy: -120, rise: 330, spin: -200 });
          fling(s, extra[1], c.xb + 0.5, { dx: 620, dy: -180, rise: 300, spin: 220 });
          s.m.act('hop', c.xb, 0.4);
          s.m.mood('sly', c.but, 1.8);
          keep.forEach((g, i) => { s.pulse(g, c.extra + i * 0.1, { to: 1.1 }); });
          tick(s, 465, 380, c.extra);
          tick(s, 735, 400, c.extra + 0.15);
        },
      },
      {
        page: 'Watch me',
        say: `{a}The final outcome was clear. Look at {f}final, and {o}outcome. An outcome is already {how}how things ended up. {so}So {f2}final is just {rep}repeating.`,
        run(s, c, v) {
          v.line = s.spoken('The final outcome was clear.', c, c.a, { size: 104, y: 110 });
          const [, final, outcome] = v.line.w;
          s.m.look('board', c.a, 2);
          const swipe = s.mark(final, c.f, { color: s.ink.pink });
          s.m.point(final, c.f, Math.max(0.2, c.o - c.f - 0.1));
          s.mark(outcome, c.o, { color: s.ink.teal, hold: c.end - c.o + 0.2 });
          s.m.point(outcome, c.o, 1.2);
          v.phrase = s.spoken('how things ended up', c, c.how, { size: 88, y: 320, color: s.ink.teal });
          s.arrow(outcome, v.phrase, c.how, { color: s.ink.teal, curve: 0.06 });
          v.bag = wordBag(s, [final], c.f2, { swipes: [swipe] });
          s.arrow(final, v.phrase, c.f2 + 0.1, { color: s.ink.pink, curve: -0.12 });
          s.m.point(final, c.f2, 1.1);
          v.rep = s.tag('just repeating', { x: 614, y: 460, at: c.rep, bg: PINK, size: 60 });
          s.m.mood('sly', c.so, 1.6);
        },
      },
      {
        say: `{drop}Drop it. {r}The outcome was clear. {same}Same meaning, {fewer}fewer words. {con}That's concise.`,
        run(s, c, v) {
          const [the, final, outcome, was, clear] = v.line.w;
          fling(s, v.bag, c.drop, { dx: 130, dy: 900, rise: 70, spin: 140 });
          s.m.act('hop', c.drop, 0.4);
          s.hide(s.page._ink, c.drop, 0.2);
          s.hide(v.phrase, c.drop, 0.2);
          s.hide(v.rep, c.drop, 0.2);
          closeUp(s, v.line, final, c.drop + 0.3);
          s.read({ w: [the, outcome, was, clear] }, c.from(c.r, 4));
          s.m.look(outcome, c.r, 1);
          rowLabel(s, 'meaning', 296, c.same, TEAL);
          const full = meter(s, 300, c.same);
          s.tag('same', { x: 1090, y: 306, at: c.same + 0.45, bg: YELLOW, size: 52, align: 'right' });
          s.m.point(full, c.same, 0.7);
          rowLabel(s, 'words', 412, c.fewer, YELLOW);
          const row = bagRow(s, 410, 5, c.fewer);
          fling(s, row[4], c.fewer + 0.3, { dx: 60, dy: 520, rise: 40, spin: 90 }, { dur: 0.6, gain: 0.5 });
          s.tag('fewer', { x: ROW.x + 4 * ROW.step + 10, y: 424, at: c.fewer + 0.5, bg: YELLOW, size: 52, align: 'left' });
          const win = s.tag('Concise!', { x: 614, y: 560, at: c.con + 0.2, bg: TEAL, size: 72 });
          s.stars(win, c.con + 0.3, 8);
          s.m.mood('proud', c.con, 1.4);
          s.m.act('thumbs', c.con, 1);
        },
      },
      {
        page: 'The idea',
        say: `{c1}Concise means {rem}removing {r}repeated meaning, {k}while {keep}keeping {d}every detail, and the {gr}grammar.`,
        run(s, c) {
          s.spoken('Concise means', c, c.c1, { size: 96, y: 84, color: s.ink.yellow });
          s.text('remove', { x: 220, y: 214, size: 76, color: s.ink.pink, at: c.rem, dur: 0.35 });
          s.text('keep', { x: 770, y: 214, size: 76, color: s.ink.teal, at: c.keep, dur: 0.3 });
          cart(s, 440, 590, 660, c.rem, { handle: false });
          const shape = { y: 330, w: 310, h: 260 };
          const out = bag(s, { ...shape, x: 450, label: ['repeated', 'meaning'] });
          s.pop(out, c.r, { gain: 0.6 });
          s.m.point(out, c.r, 0.9);
          s.anim(out, arc({ dx: -390, dy: 40, rise: 90, spin: -9 }), c.k, 0.55, 'linear');
          s.sfx('whoosh', c.k, 0.8);
          const cross = s.shape(`<path class="x" d="M8,8 L76,76 M76,8 L8,76" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round"/>`, { x: 300, y: 330, w: 84, h: 84 });
          s.draw(cross.get('.x'), c.k + 0.55, 0.3);
          const kept = [bag(s, { ...shape, x: 450, color: TEAL, label: ['every', 'detail'] }), bag(s, { ...shape, x: 780, color: BLUE, label: ['the', 'grammar'] })];
          s.pop(kept[0], c.d, { gain: 0.7 });
          s.pop(kept[1], c.gr, { gain: 0.7 });
          s.m.point(kept[1], c.gr, 1);
          s.m.mood('proud', c.gr, 1.4);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}We returned back home. {ask}Which word is extra? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          v.q = s.spoken('We returned back home.', c, c.a, { size: 120, y: 140 });
          s.m.look('board', c.a, 2);
          v.ask = s.text('Which word is extra?', { y: 320, size: 92, color: s.ink.teal, at: c.ask, dur: 0.7 });
          v.mystery = bag(s, { x: 504, y: 450, w: 220, h: 190, color: YELLOW, label: ['?'], size: 110 });
          s.pop(v.mystery, c.word('extra'), { gain: 0.6 });
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Back! {why}Returned already {means}means {cb}came back. {fix}We returned home.`,
        run(s, c, v) {
          const [we, returned, back, home] = v.q.w;
          s.hide(v.ask, c.ans, 0.2);
          s.hide(v.mystery, c.ans, 0.2);
          const gone = wordBag(s, [back], c.ans);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
          s.stars(back, c.ans + 0.1, 9);
          s.mark(returned, c.why, { color: s.ink.teal, hold: c.fix - c.why - 0.25 });
          s.m.point(returned, c.why, 1);
          s.words(['returned', '=', 'came', 'back'], { y: 320, size: 96, color: s.ink.yellow, times: [c.why, c.means, c.cb, c.word('back', 1)] });
          hopHome(s, c);
          fling(s, gone, c.fix - 0.1, { dx: -150, dy: -320, rise: 40, spin: -120 });
          closeUp(s, v.q, back, c.fix);
          s.read({ w: [we, returned, home] }, c.from(c.fix, 3));
          s.m.look(returned, c.fix, 1.2);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{but}But {sh0}shortest is not automatically right. {a}The store closes at nine on weekdays.`,
        run(s, c, v) {
          s.m.mood('hmm', c.but, 2);
          const warn = s.spoken('Shortest is not automatically right.', c, c.sh0, { size: 84, y: 120, color: s.ink.yellow });
          s.mark(warn.w[0], c.sh0, { color: s.ink.pink, hold: c.a - 0.35 - c.sh0 });
          s.m.point(warn.w[0], c.sh0, 1);
          s.hide(warn, c.a - 0.25, 0.25);
          const times = c.from(c.a, 7).map((w) => w.t0);
          v.one = s.words('The store closes at nine', { size: 104, y: 88, times: times.slice(0, 5) });
          v.two = s.words('on weekdays.', { size: 104, y: 236, times: times.slice(5) });
          s.m.look('board', c.a, 2);
        },
      },
      {
        say: `{cut}Cut {on}on weekdays, {and}and it's {sh}shorter, but you {lost}lost information.`,
        run(s, c, v) {
          const out = wordBag(s, v.two.w, c.on);
          s.m.point(out, c.on, 0.8);
          fling(s, out, c.and, GONE, { dur: 0.75 });
          const nine = spot(s, v.one.w[4]);
          v.stop = s.text('.', { x: nine.x + nine.w, y: 88, size: 104, align: 'left', at: c.and, dur: 0.1, quiet: true });
          rowLabel(s, 'words', 380, c.sh, YELLOW);
          v.row = bagRow(s, 376, 7, c.sh);
          fling(s, v.row[5], c.sh + 0.25, LOWER[0], { dur: 0.55, gain: 0.45 });
          fling(s, v.row[6], c.sh + 0.35, LOWER[1], { dur: 0.55, gain: 0.45 });
          v.shorter = s.tag('shorter', { x: ROW.x + 5 * ROW.step + 4, y: 390, at: c.sh + 0.55, bg: YELLOW, size: 46, align: 'left' });
          rowLabel(s, 'information', 496, c.lost, TEAL);
          v.level = meter(s, 500, c.lost).get('.lvl');
          s.anim(v.level, [{ scale: '1 1', fill: TEAL }, { scale: '.45 1', fill: RED }], c.lost + 0.4, 0.6, 'ease-in-out');
          v.lost = s.tag('lost', { x: 1086, y: 506, at: c.lost + 0.55, bg: RED, size: 52, align: 'right' });
          v.sat = s.tag('What about Saturday?', { x: 614, y: 256, at: c.lost + 0.3, bg: RED, size: 54 });
          s.m.mood('oops', c.lost, 1.4);
          s.m.act('shake', c.lost, 0.9);
        },
      },
      {
        say: `{job}Those words were {doing}doing a job.`,
        run(s, c, v) {
          [v.shorter, v.lost, v.sat].forEach((n) => s.hide(n, c.job, 0.2));
          s.hide(v.stop, c.job, 0.1);
          const back = bagOver(s, v.two.w, TEAL);
          comeBack(s, back, c.job, GONE, { fill: 'both' });
          comeBack(s, v.row[5], c.job + 0.1, LOWER[0], { dur: 0.45, gain: 0.3 });
          comeBack(s, v.row[6], c.job + 0.2, LOWER[1], { dur: 0.45, gain: 0.3 });
          s.anim(v.level, [{ scale: '.45 1', fill: RED }, { scale: '1 1', fill: TEAL }], c.job + 0.3, 0.6, 'ease-in-out');
          s.tag('doing a job', { x: 1160, y: 264, at: c.doing, bg: TEAL, size: 50, align: 'right' });
          s.stars(v.two.w[1], c.doing, 8);
          s.m.point(v.two.w[0], c.doing, 1.2);
          s.m.mood('proud', c.doing, 1.4);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{right}The right answer keeps {m}the meaning, {g}the grammar, {e}and the emphasis the question asks for.`,
        run(s, c) {
          s.spoken('The right answer keeps', c, c.right, { size: 100, y: 96, color: s.ink.yellow });
          const row = (text, y, times) => s.words(text, { x: 300, y, size: 96, align: 'left', times });
          row('the meaning', 240, c.from(c.m, 2).map((w) => w.t0));
          tick(s, 200, 256, c.word('meaning'));
          row('the grammar', 370, c.from(c.g, 2).map((w) => w.t0));
          tick(s, 200, 386, c.word('grammar'));
          const last = row('the emphasis asked for', 500, [c.from(c.e, 2)[1].t0, c.word('emphasis'), c.word('asks'), c.word('for')]);
          tick(s, 200, 516, c.word('for'));
          s.m.point(last.w[1], c.word('emphasis'), 1.4);
          s.m.mood('proud', c.word('for'), 1.2);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{cmp}So compare {m}the meaning of each word. {only}Only remove words that add {no}nothing. {then}Then read {wh}the whole new sentence, to be sure it still {wk}works.`,
        run(s, c) {
          const line = s.words('The final outcome was clear.', { size: 104, y: 100, at: c.cmp, per: 0.1 });
          const [the, final, outcome, was, clear] = line.w;
          s.text('Compare each word', { y: 270, size: 88, color: s.ink.teal, at: c.word('compare'), dur: 0.7 });
          s.read(line, c.from(c.m, 5));
          s.m.look('board', c.cmp, 2);
          const swipe = s.mark(final, c.only, { color: s.ink.pink });
          s.text('Adds nothing? Remove it.', { y: 390, size: 88, color: s.ink.yellow, at: c.only, dur: 0.9 });
          s.m.point(final, c.only, 1.2);
          const gone = wordBag(s, [final], c.no, { swipes: [swipe] });
          fling(s, gone, c.no + 0.3, { dx: 240, dy: -320, rise: 60, spin: 130 }, { gain: 0.7 });
          closeUp(s, line, final, c.no + 0.45);
          s.text('Read the whole new sentence', { y: 510, size: 88, at: c.then, dur: 1 });
          s.read({ w: [the, outcome, was, clear] }, c.from(c.wh, 4));
          s.m.point(outcome, c.wh, 1.2);
          const good = s.tag('still works!', { x: 614, y: 628, at: c.wk, bg: TEAL, size: 60 });
          s.stars(good, c.wk + 0.1, 8);
          s.m.act('thumbs', c.wk, 1);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{rep}Repeat? {cut}Cut it. {nw}New information? {keep}Keep it. {bye}Now hit Try this skill, and go {pack}pack light!`,
        run(s, c) {
          const box = { y: 120, w: 440, h: 240, handle: 34 };
          const ghost = s.shape(`<rect x="3" y="3" width="${box.w - 6}" height="${box.h - box.handle - 6}" rx="22" fill="none" stroke="${WHITE}" stroke-width="5" stroke-dasharray="14 12" opacity=".6"/>`, { x: 70, y: box.y + box.handle, w: box.w, h: box.h - box.handle });
          s.appear(ghost, c.cut + 0.1, 0.3);
          s.text('Repeat?', { x: 290, y: 200, size: 96, at: c.cut + 0.1, dur: 0.3, quiet: true });
          const out = bag(s, { ...box, x: 70, label: ['Repeat?'], size: 76 });
          s.pop(out, c.rep, { gain: 0.6 });
          fling(s, out, c.cut, { dx: -160, dy: 760, rise: 60, spin: -130 }, { dur: 0.75 });
          s.tag('Cut it', { x: 290, y: 386, at: c.cut, bg: RED, size: 72 });
          const stay = bag(s, { ...box, x: 610, color: TEAL, label: ['New', 'information?'], size: 64 });
          s.pop(stay, c.nw, { gain: 0.6 });
          s.tag('Keep it', { x: 830, y: 386, at: c.keep, bg: TEAL, size: 72 });
          s.pulse(stay, c.keep, { to: 1.08 });
          s.m.point(stay, c.keep, 0.9);
          s.m.mood('proud', c.keep, 3);
          s.tag('Next: Try this skill', { x: 560, y: 560, at: c.bye + 0.2, bg: YELLOW, size: 52 });
          s.m.act('wave', c.bye, 2);
          s.m.act('hop', c.pack, 0.4);
          s.pulse(stay, c.pack, { to: 1.08 });
          s.confetti(c.bye + 0.6);
        },
      },
    ],
  });
})();
