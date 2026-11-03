/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Read factored quadratics: tiles vanish as a factor counts down to zero, each factor is worked down to its solution with its number jumping the equals sign, a small monster hops the sum along a number line, the factors fly together to multiply out, and rolling pairs show that a sum is not the solutions
 */
(function () {
  /** A piece of a word that can be marked, measured or popped by itself. */
  const part = (cls, html) => `<span class="${cls}" style="display:inline-block">${html}</span>`;
  const factor = (op, n) => `(${part('x', 'x')} ${part('term', `${part('op', op)} ${part('digit', n)}`)}${part('close', ')')}`;

  const BULB = `<path d="M614,190 C540,190 490,246 490,316 C490,366 520,396 542,426 C552,442 556,456 556,470 H672 C672,456 676,442 686,426 C708,396 738,366 738,316 C738,246 688,190 614,190 Z" fill="#ffd66b" stroke="#16352b" stroke-width="7"/>
    <path d="M580,470 L560,330 L598,366 L614,326 L630,366 L668,330 L648,470" fill="none" stroke="#b9792a" stroke-width="7"/>
    <path d="M566,488 H662 M574,512 H654" stroke="#f5f3ea" stroke-width="14" stroke-linecap="round"/>
    <path d="M614,146 V100 M470,190 L440,160 M758,190 L788,160 M452,316 H408 M776,316 H820" stroke="#ffd66b" stroke-width="10" stroke-linecap="round"/>`;
  const BOLT = '<path d="M660,120 L480,370 H600 L540,600 L760,310 H640 L720,120 Z" fill="#ffd66b" stroke="#16352b" stroke-width="8" stroke-linejoin="round"/>';

  /** A node's box on the board. Valid while building, before anything has moved. */
  function spot(node) {
    const o = document.getElementById('chalk').getBoundingClientRect(), r = node.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, cx: r.left - o.left + r.width / 2, cy: r.top - o.top + r.height / 2 };
  }

  /** A picture for the moment a page opens on a word, gone when the writing starts. */
  function flash(s, markup, at, until, sound) {
    const pic = s.shape(`<g class="pic">${markup}</g>`).get('.pic');
    s.pop(pic, at);
    s.sfx(sound, at, 0.6);
    s.anim(pic, [{ opacity: 1 }, { opacity: 0 }], until - 0.15, 0.15);
  }

  /** Let a factor's sign, number and bracket wait for the words that say them. */
  function sayFactor(s, f, signAt, digitAt) {
    s.show(f.querySelector('.op'), signAt, 0.08);
    s.show(f.querySelector('.digit'), digitAt, 0.08);
    s.show(f.querySelector('.close'), digitAt + 0.1, 0.08);
  }

  /** Slide a word until its center is on a board point, arcing up over what is in between. */
  function glide(s, node, to, t, dur, lift = 0) {
    const b = spot(node), x = to.cx - b.cx, y = to.cy - b.cy;
    const frames = [{ translate: '0px 0px' }, { translate: `${x}px ${y}px` }];
    if (lift) frames.splice(1, 0, { translate: `${x / 2}px ${y / 2 - lift}px` });
    s.anim(node, frames, t, dur, 'ease-in-out');
  }

  /** A chalk copy of a term flies from one spot to another and is gone when it lands. */
  function flyCopy(s, text, from, to, t, land, { color = s.ink.yellow, size = 100 } = {}) {
    const g = s.shape(`<text class="z" x="${from.cx}" y="${from.cy + size * 0.3}" text-anchor="middle" font-size="${size}" font-family="Chalk" fill="${color}" opacity="0">${text}</text>`);
    const end = `${to.cx - from.cx}px ${to.cy - from.cy}px`;
    s.anim(g.get('.z'), [{ opacity: 1, translate: '0px 0px' }, { opacity: 1, translate: end, offset: 0.9 }, { opacity: 0, translate: end }], t, land - t + 0.08, 'ease-in-out', 'none');
    s.sfx('whoosh', t, 0.4);
  }

  /** A chalk number that changes on the spot. steps is [[value, time], ...] in time order; a repeat carries on. */
  function countOn(s, word, steps, color, zeroColor = color) {
    const b = spot(word), size = parseFloat(getComputedStyle(word).fontSize);
    steps.forEach(([value, at], i) => {
      if (i && steps[i - 1][0] === value) return;
      const next = steps.slice(i + 1).find((step) => step[0] !== value);
      const n = s.place(String(value), { x: b.cx, y: b.y, size, color: value === 0 ? zeroColor : color });
      n.style.opacity = 0;
      s.anim(n, [{ opacity: 0 }, { opacity: 1 }], at, 0.03, 'linear');
      if (next) s.anim(n, [{ opacity: 1 }, { opacity: 0 }], next[1] - 0.03, 0.03, 'linear');
    });
  }

  /** Five by three tiles: a factor counts down, its columns or rows vanish and the product falls to zero. */
  function tileProduct(s, c) {
    const CELL = 80, COLS = 5, ROWS = 3;
    let cells = '';
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      cells += `<rect class="tile" data-q="${q}" data-r="${r}" x="${q * CELL + 3}" y="${r * CELL + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="9" fill="#8fe6cf"/>`;
    }
    const g = s.shape(`<rect class="edge" x="-7" y="-7" width="${COLS * CELL + 14}" height="${ROWS * CELL + 14}" rx="14" fill="none" stroke="rgba(245,243,234,.42)" stroke-width="4" stroke-dasharray="14 12"/>${cells}`, { x: 90, y: 360, w: COLS * CELL, h: ROWS * CELL });
    s.appear(g.get('.edge'), c.mul);
    const stepA = (c.z2 - c.one) / COLS, stepB = (c.z3 - c.way) / ROWS;
    g.querySelectorAll('.tile').forEach((tile, i) => {
      const q = Number(tile.dataset.q), r = Number(tile.dataset.r);
      s.pop(tile, c.mul + i * 0.03, { gain: 0.1 });
      s.anim(tile, [{ scale: 1 }, { scale: 0 }], c.one + (COLS - 1 - q) * stepA, 0.14, 'ease-in');
      s.anim(tile, [{ scale: 0 }, { scale: 1 }], c.no, 0.3);
      s.anim(tile, [{ scale: 1 }, { scale: 0 }], c.way + r * stepB, 0.14, 'ease-in');
    });
    const states = [[5, 3, c.mul]];
    for (let k = 1; k <= COLS; k++) states.push([COLS - k, 3, c.one + (k - 1) * stepA]);
    states.push([5, 3, c.no]);
    for (let k = 1; k <= ROWS; k++) states.push([5, ROWS - k, c.way + (k - 1) * stepB]);
    states.slice(1).forEach(([, , t]) => s.sfx('tick', t, 0.35));
    const row = s.words(['5', '×', '3', '=', '15'], { x: 810, y: 392, size: 124, hidden: true });
    s.show(row.w[1], c.mul, 0.2);
    s.show(row.w[3], c.mul, 0.2);
    countOn(s, row.w[0], states.map(([a, , t]) => [a, t]), s.ink.white, s.ink.pink);
    countOn(s, row.w[2], states.map(([, b, t]) => [b, t]), s.ink.white, s.ink.pink);
    countOn(s, row.w[4], states.map(([a, b, t]) => [a * b, t]), s.ink.white, s.ink.yellow);
    s.sfx('poof', c.z2, 0.5);
    s.sfx('poof', c.z3, 0.5);
  }

  /** Work a line under a factor: x − 3 = 0 turns into x = 3 as the number jumps the equals sign. */
  function solveUnder(s, over, y, color, op, num, sign, { write, zero, go, signAt, land }) {
    const cx = spot(over).cx, size = 104;
    const row = s.words(['x', op, num, '=', '0'], { x: cx, y, size, color, times: [write, write + 0.06, write + 0.12, zero - 0.1, zero] });
    s.anim(row, [{ translate: '0px -70px' }, { translate: '0px 0px' }], write, 0.3);
    const answer = s.words(['x', '=', part('sgn', sign) + part('num', num)], { x: cx, y, size, color, hidden: true });
    const [wx, wop, wnum, weq, wzero] = row.w, [ax, aeq, alast] = answer.w;
    const sgn = alast.querySelector('.sgn'), digit = alast.querySelector('.num');
    s.sfx('whoosh', go, 0.5);
    glide(s, wnum, spot(digit), go, land - go, 66);
    glide(s, weq, spot(aeq), go, land - go);
    glide(s, wx, spot(ax), go, land - go);
    s.hide(wzero, go + (land - go) * 0.5, 0.12);
    if (sign) {
      glide(s, wop, spot(sgn), go, signAt - go, 66);
      s.hide(wop, signAt - 0.03, 0.03);
      const box = spot(sgn), home = spot(row), flipped = document.createElement('span');
      flipped.className = 'w';
      flipped.textContent = sign;
      Object.assign(flipped.style, { position: 'absolute', left: `${box.x - home.x}px`, top: `${box.y - home.y}px`, color: s.ink.yellow });
      row.appendChild(flipped);
      s.pop(flipped, signAt);
      s.hide(flipped, land - 0.03, 0.03);
    } else {
      s.hide(wop, go, 0.12);
    }
    [wx, weq, wnum].forEach((n) => s.hide(n, land - 0.03, 0.03));
    alast.style.opacity = 0;
    [ax, aeq, alast].forEach((n) => s.show(n, land, 0.03));
    s.sfx('pop', land, 0.5);
    answer.last = alast;
    answer.digit = digit;
    return answer;
  }

  /** A number line where a small monster hops back from where it stands, leaving chalk arcs. */
  function hopLine(s, { start, steps, draw, stand, go, stop, land }) {
    const UNIT = 80, Y = 620, px = (v) => 150 + (v + 6) * UNIT;
    let ticks = '', arcs = '';
    for (let v = -6; v <= 4; v++) ticks += `<path d="M${px(v)},${Y - 12} V${Y + 12}" stroke="#f5f3ea" stroke-width="5" stroke-linecap="round"/>`;
    for (let k = 0; k < steps; k++) arcs += `<path class="hop${k}" d="M${px(start - k)},${Y - 14} Q${px(start - k - 0.5)},${Y - 100} ${px(start - k - 1)},${Y - 14}" fill="none" stroke="#ffd66b" stroke-width="7" stroke-linecap="round"/>`;
    const g = s.shape(`<path class="axis" d="M${px(-6) - 26},${Y} H${px(4) + 26}" fill="none" stroke="#f5f3ea" stroke-width="6" stroke-linecap="round"/><g class="ticks">${ticks}</g>${arcs}`);
    s.draw(g.get('.axis'), draw, 0.5);
    s.appear(g.get('.ticks'), draw + 0.2, 0.3);
    s.text('0', { x: px(0), y: Y + 16, size: 72, at: draw + 0.3, dur: 0.15, quiet: true });
    s.text(String(start), { x: px(start), y: Y + 16, size: 72, color: s.ink.teal, at: stand, dur: 0.15, quiet: true });
    const bug = s.critter(px(start), Y - 75, 130, stand, { hue: 9, light: 1.2 });
    const step = (stop - go) / steps;
    for (let k = 0; k < steps; k++) {
      const t = go + k * step, from = -k * UNIT, to = -(k + 1) * UNIT;
      s.anim(bug, [{ translate: `${from}px 0px` }, { translate: `${(from + to) / 2}px -44px` }, { translate: `${to}px 0px` }], t, step, 'ease-in-out');
      s.draw(g.get(`.hop${k}`), t, step, { gain: 0.08 });
      s.sfx('tick', t, 0.45);
    }
    s.tag(`${steps} steps back`, { x: px(start - steps / 2), y: 350, at: go, bg: '#ff9ccf', size: 50 });
    const landed = s.text(String(start - steps).replace('-', '−'), { x: px(start - steps), y: Y + 16, size: 72, color: s.ink.yellow, at: land, dur: 0.2 });
    s.stars(landed, land + 0.1, 8, { spread: 100 });
  }

  /** Two terms leave the factors and fly together into the term they make. */
  function combine(s, pairs, target, t, land) {
    const to = spot(target);
    pairs.forEach(([source, text]) => {
      flyCopy(s, text, spot(source), to, t, land);
      s.anim(source, [{ color: s.ink.white }, { color: s.ink.yellow, offset: 0.2 }, { color: s.ink.yellow, offset: 0.8 }, { color: s.ink.white }], t, land - t + 0.2, 'linear', 'none');
    });
  }

  /** The two factors multiply out on the words that say each term; then they go, and b is read off and becomes the sum. */
  function multiplyOut(s, c, rule, formB) {
    const fac = s.eq([factor('−', '3'), factor('+', '5'), '=', '0'], { y: 292, size: 100, times: [c.our, c.our + 0.15, c.our + 0.3, c.our + 0.35] });
    const [xA, xB] = fac.querySelectorAll('.x'), [t3, t5] = fac.querySelectorAll('.term');
    const twoX = c.tw + 0.15, fifteen = c.ff + 0.2;
    const out = s.words(['x<sup>2</sup>', '+', `${part('co', '2')}x`, '−', '15', '=', '0'], { y: 446, size: 108, times: [c.exp + 0.25, c.pp, twoX, c.mm, fifteen, fifteen + 0.2, fifteen + 0.3] });
    combine(s, [[xA, 'x'], [xB, 'x']], out.w[0], c.exp - 0.05, c.exp + 0.25);
    combine(s, [[t5, '+5x'], [t3, '−3x']], out.w[2], c.pp, twoX);
    combine(s, [[t3, '− 3'], [t5, '+ 5']], out.w[4], c.mm, fifteen);
    const up = -150, two = out.querySelector('.co'), at = spot(two), high = { cx: at.cx, cy: at.cy + up };
    s.hide(fac, c.b, 0.25);
    s.move(out, 0, up, c.b, 0.4);
    const twoMark = s.mark(two, c.bt, { color: s.ink.teal });
    twoMark.style.translate = `0px ${up}px`;
    const marks = [s.mark(formB, c.b, { color: s.ink.teal }), twoMark];
    s.m.point({ x: high.cx, y: high.cy }, c.b, c.ans - c.b);
    const minusB = rule.w[5], slot = spot(minusB);
    flyCopy(s, '2', high, slot, c.ans, c.nn, { size: 108 });
    s.hide(minusB, c.nn - 0.05, 0.05);
    const result = s.place('−2', { x: slot.cx, y: slot.y, size: 80, color: s.ink.yellow });
    marks.push(s.mark(result, c.nn));
    s.pop(result, c.nn);
    return [out, result, ...marks];
  }

  LessonStudio.define({
    id: 'quadratic',
    teacher: 'pinky',
    title: 'Read factored quadratics',
    facts: [
      ['5 * 3', 15], ['4 * 3', 12], ['3 * 3', 9], ['2 * 3', 6], ['1 * 3', 3], ['0 * 3', 0],
      ['5 * 2', 10], ['5 * 1', 5], ['5 * 0', 0],
      ['3 - 3', 0], ['-5 + 5', 0],
      ['3 + (-5)', -2], ['3 - 5', -2], ['1 + (-3)', -2], ['0 + (-2)', -2], ['4 + (-6)', -2],
      ['2 + (-6)', -4], ['2 - 6', -4],
      ['5 - 3', 2], ['-3 * 5', -15], ['-(5 - 3)', -2],
      ['3 * (-5)', -15],
    ],
    beats: [
      {
        say: `{hi}Pinky here! {scary}Factored {q}quadratics {look}look {sc}scary. {give}But they're basically {hand}handing you the {ans}answer. {read}You just have to {r}read them.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.2);
          s.wideCam(c.scary - 0.4, 1);
          const title = s.words(['Read', 'factored', 'quadratics'], { y: 100, size: 96, color: s.ink.yellow, times: [c.r, c.scary + 0.3, c.q + 0.3] });
          s.under(title.w[0], c.r + 0.2, { color: s.ink.pink });
          const room = (spot(title.w[1]).x - spot(title.w[0]).x) / 2;
          title.style.translate = `${-room}px 0px`;
          s.anim(title, [{ translate: `${-room}px 0px` }, { translate: '0px 0px' }], c.r, 0.3);
          const eq = s.eq([factor('−', '3'), factor('+', '5'), '=', '0'], { y: 268, size: 140, at: c.look, per: 0.08 });
          eq.w.forEach((w) => { s.tint(w, s.ink.red, c.sc, 0.12); s.tint(w, s.ink.white, c.give, 0.2); });
          s.anim(eq, [{ rotate: '0deg' }, { rotate: '-1.6deg' }, { rotate: '1.6deg' }, { rotate: '-1.2deg' }, { rotate: '1.2deg' }, { rotate: '0deg' }], c.sc, 0.7, 'linear');
          s.m.mood('oops', c.sc, c.give - c.sc);
          s.m.mood('sly', c.give, c.read - c.give);
          const [n3, n5] = eq.querySelectorAll('.digit');
          s.mark(n3, c.hand);
          s.mark(n5, c.hand + 0.15);
          s.m.point(eq.w[1], c.hand, c.read - c.hand - 0.2);
          s.tag('The answer is right here', { x: 614, y: 494, at: c.ans, bg: '#ffd66b', size: 54 });
          s.arrow({ x: 470, y: 494 }, n3, c.ans + 0.1, { color: s.ink.yellow, curve: 0.12 });
          s.arrow({ x: 760, y: 494 }, n5, c.ans + 0.1, { color: s.ink.yellow, curve: -0.12 });
          s.m.act('nod', c.read, 0.8);
        },
      },
      {
        page: 'The idea',
        say: `Here's the whole {idea}idea. If {two}two {things}things {mul}multiply to {z}zero, {least}at least {one}one of them has to be {z2}zero. {no}There's no other {way}way to get {z3}zero out of a multiplication.`,
        run(s, c) {
          s.m.look('board', c.start, 2.2);
          flash(s, BULB, c.idea, c.two, 'ding');
          s.m.mood('wow', c.idea, c.two - c.idea - 0.2);
          const rule = s.words(['▢', '×', '▢', '=', '0'], { y: 84, size: 124, times: [c.two, c.mul, c.things, c.word('to'), c.z] });
          s.mark(rule.w[4], c.z);
          s.words(['at', 'least', 'one', 'has', 'to', 'be', '0'], { y: 226, size: 84, color: s.ink.teal, times: [c.least, c.word('least'), c.one, c.word('has'), c.word('to', 1), c.word('be'), c.z2] });
          tileProduct(s, c);
          const first = s.swap(rule.w[0], '0', c.one, { color: s.ink.pink });
          s.m.point(first, c.one, c.no - c.one - 0.3);
          s.anim(first, [{ opacity: 1 }, { opacity: 0 }], c.no, 0.16);
          s.anim(rule.w[0], [{ opacity: 0 }, { opacity: 1 }], c.no, 0.16);
          s.swap(rule.w[2], '0', c.way, { color: s.ink.pink });
          s.tag('No other way', { x: 810, y: 552, at: c.way, bg: '#ffd66b', size: 56 });
          s.m.mood('happy', c.no, 2);
          s.m.act('nod', c.no, 1);
        },
      },
      {
        page: 'Watch me',
        say: `{look}So look. {a}X minus three, times {bx}x plus five, {z}equals {z0}zero. {two}Two {fac}factors. {f}Make the {first}first one {f0}zero: {x3}x is {three}three. {s}Make the {second}second one {s0}zero: {x5}x is {neg}negative {five}five. {sol}Those are the {sols}solutions.`,
        run(s, c, v) {
          s.m.look('board', c.look, 3);
          v.eq = s.eq([factor('−', '3'), factor('+', '5'), '=', '0'], { y: 84, size: 136, times: [c.a, c.bx, c.z, c.z0] });
          const [f1, f2] = v.eq.w;
          sayFactor(s, f1, c.word('minus'), c.word('three'));
          sayFactor(s, f2, c.word('plus'), c.word('five'));
          [[f1, c.two, s.ink.teal], [f2, c.fac, s.ink.pink]].forEach(([f, at, color]) => {
            const b = spot(f);
            [s.under(f, at, { color, drop: 0 }), s.tag('factor', { x: b.cx, y: b.y + b.h + 14, at, bg: color, size: 50 })].forEach((n) => s.hide(n, c.f, 0.2));
          });
          v.marks = [s.mark(f1, c.f, { color: s.ink.teal }), s.mark(f2, c.s, { color: s.ink.pink })];
          s.m.point(f1, c.f, c.x3 - c.f);
          v.a3 = solveUnder(s, f1, 250, s.ink.teal, '−', '3', '', { write: c.first, zero: c.f0, go: c.x3, land: c.three + 0.08 });
          s.m.point(f2, c.s, c.x5 - c.s);
          v.a5 = solveUnder(s, f2, 250, s.ink.pink, '+', '5', '−', { write: c.second, zero: c.s0, go: c.x5, signAt: c.neg, land: c.five + 0.05 });
          const left = spot(v.a3.w[0]), right = spot(v.a5.last);
          v.box = s.frame({ x: left.x - 30, y: left.y - 8, w: right.x + right.w - left.x + 60, h: left.h + 16 }, c.sol);
          v.label = s.tag('the solutions', { x: (left.x + right.x + right.w) / 2, y: left.y + left.h + 24, at: c.sols, bg: '#ffd66b', size: 52 });
          s.m.act('nod', c.sol, 0.8);
          s.m.mood('proud', c.sol, 1.2);
          s.stars(v.label, c.sols + 0.1, 8);
        },
      },
      {
        say: `{sign}Watch that {sg}sign! {plus}Plus five {give}gives you {neg}negative five. {sum}And if they ask for the {sm}sum? {calc}Three {pl}plus {ng}negative five {ans}is {nn}negative {two}two.`,
        run(s, c, v) {
          s.m.mood('wow', c.sign, 1.4);
          s.anim(v.box, [{ opacity: 1 }, { opacity: 0 }], c.sign, 0.2);
          s.hide(v.label, c.sign, 0.2);
          const plus5 = v.eq.w[1].querySelector('.term'), minus5 = v.a5.last;
          s.m.point(minus5, c.sg, c.sum - c.sg - 0.3);
          const ring = s.circle(minus5.querySelector('.sgn'), c.sg, { color: s.ink.yellow, pad: 10 });
          s.hide(ring, c.neg, 0.15);
          const flip = s.words(['+5', '→', '−5'], { y: 430, size: 150, times: [c.plus, c.give, c.neg] });
          s.tint(flip.w[2], s.ink.yellow, c.neg, 0.01);
          s.pulse(flip.w[2], c.neg + 0.15);
          const marks = [s.mark(plus5, c.plus), s.mark(minus5, c.neg)];
          [v.eq, flip, ...v.marks, ...marks].forEach((n) => s.hide(n, c.sum, 0.25));
          s.tint(minus5, s.ink.pink, c.sum, 0.2);
          const rise = -160, raised = (n) => { const b = spot(n); return { cx: b.cx, cy: b.cy + rise }; };
          s.move(v.a3, 0, rise, c.sum, 0.5);
          s.move(v.a5, 0, rise, c.sum, 0.5);
          const row = s.words(['sum', '=', '3', '+', '(−5)', '=', '−2'], { y: 226, size: 108, times: [c.sm, c.sm + 0.15, c.calc + 0.25, c.pl, c.ng + 0.25, c.ans, c.nn] });
          s.tint(row.w[6], s.ink.yellow, c.nn, 0.01);
          const middle = (spot(row.w[2]).x + spot(row.w[4]).x + spot(row.w[4]).w) / 2;
          const what = s.text('?', { x: middle, y: 226, size: 108, color: s.ink.teal, at: c.sm + 0.2, dur: 0.15, quiet: true });
          s.hide(what, c.calc, 0.1);
          flyCopy(s, '3', raised(v.a3.digit), spot(row.w[2]), c.calc, c.calc + 0.3, { color: s.ink.teal, size: 104 });
          flyCopy(s, '−5', raised(minus5), spot(row.w[4]), c.ng, c.ng + 0.3, { color: s.ink.pink, size: 104 });
          hopLine(s, { start: 3, steps: 5, draw: c.sm, stand: c.calc, go: c.ng, stop: c.two, land: c.two });
          s.m.point({ x: 560, y: 540 }, c.calc, c.two - c.calc);
          s.circle(row.w[6], c.two, { color: s.ink.yellow, pad: 8 });
          s.m.mood('proud', c.ans, 1.6);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        gap: 1.4,
        say: `{go}Your turn. {a}X minus two, times {bx}x plus six, {z}equals {z0}zero. What is the {sm}sum of the solutions? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          s.m.look('board', c.go, 3);
          v.q = s.eq([factor('−', '2'), factor('+', '6'), '=', '0'], { y: 84, size: 128, times: [c.a, c.bx, c.z, c.z0] });
          sayFactor(s, v.q.w[0], c.word('minus'), c.word('two'));
          sayFactor(s, v.q.w[1], c.word('plus'), c.word('six'));
          v.ask = s.spoken('sum of the solutions?', c, c.sm, { y: 236, size: 96, color: s.ink.teal });
          s.m.point(v.ask, c.sm, 1.1);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Negative {four}four! The solutions are {t}two {and}and {ng}negative {six}six.`,
        run(s, c, v) {
          s.hide(v.ask, c.ans, 0.2);
          const land = c.end + 0.45;
          const row = s.words(['sum', '=', '2', '+', '(−6)', '=', '−4'], { y: 232, size: 108, times: [c.ans, c.t, c.t + 0.25, c.and, c.ng + 0.25, c.ans, c.four] });
          s.tint(row.w[6], s.ink.yellow, c.ans, 0.01);
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);
          s.stars(row.w[6], c.four, 9);
          const [t2, t6] = v.q.querySelectorAll('.term'), [d2] = v.q.querySelectorAll('.digit');
          s.mark(t2, c.t, { color: s.ink.teal, hold: c.ng - c.t + 0.3 });
          flyCopy(s, '2', spot(d2), spot(row.w[2]), c.t, c.t + 0.3, { color: s.ink.teal, size: 104 });
          s.mark(t6, c.ng, { color: s.ink.pink, hold: 0.7 });
          flyCopy(s, '−6', spot(t6), spot(row.w[4]), c.ng, c.ng + 0.3, { color: s.ink.pink, size: 104 });
          hopLine(s, { start: 2, steps: 6, draw: c.ans, stand: c.t + 0.3, go: c.ng, stop: land, land });
          s.m.point({ x: 560, y: 540 }, c.t, land - c.t);
          s.circle(row.w[6], land, { color: s.ink.yellow, pad: 8 });
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        gap: 1.7,
        say: `Here's a {sc}shortcut. If it's written {x2}x squared {p1}plus {bx}b x {p2}plus {cc}c, {neg}the solutions add up to {nb}negative {bb}b. {ours}Multiply {our}ours out: {exp}x squared {pp}plus {tw}two x {mm}minus {ff}fifteen. {b}B is {bt}two, {ans}so the sum is {nn}negative two. {same}Same answer!`,
        run(s, c, v) {
          s.m.look('board', c.start, 2);
          flash(s, BOLT, c.sc, c.x2, 'whoosh');
          s.m.mood('sly', c.sc, c.x2 - c.sc);
          const form = s.words(['x<sup>2</sup>', '+', `${part('b', 'b')}x`, '+', 'c', '=', '0'], { y: 84, size: 104, times: [c.x2, c.p1, c.bx, c.p2, c.cc, c.cc + 0.2, c.cc + 0.3] });
          const rule = s.spoken(['the', 'solutions', 'add', 'up', 'to', '−b'], c, c.neg, { y: 196, size: 80, color: s.ink.yellow });
          s.m.point(rule.w[5], c.nb, 1.2);
          const formB = form.querySelector('.b');
          s.mark(formB, c.bb, { hold: c.ours - c.bb });
          s.mark(rule.w[5], c.bb, { hold: c.ours - c.bb });
          const worked = multiplyOut(s, c, rule, formB);
          const echo = s.words(['3', '+', '(−5)', '=', '−2'], { x: 410, y: 446, size: 100, at: c.same, per: 0.05 });
          const tag = s.tag('Same answer!', { x: 880, y: 462, at: c.same, bg: '#ffd66b', size: 54 });
          s.stars(tag, c.same + 0.2, 8);
          s.m.act('hop', c.same, 0.4);
          s.m.mood('happy', c.same, 1.4);
          v.form = form;
          v.formB = formB;
          v.fading = [rule, echo, tag, ...worked];
        },
      },
      {
        say: `{hide}And if there's a {num}number in front of x squared, that's {la}A, and the {sm}sum {is}is {nb}negative b {over}over {da}A.`,
        run(s, c, v) {
          v.fading.forEach((n) => s.hide(n, c.hide, 0.25));
          s.tint(v.formB, s.ink.white, c.hide, 0.2);
          const front = spot(v.form.w[0]);
          const box = s.text('▢', { x: front.x - 46, y: front.y, size: 104, color: s.ink.pink, at: c.num, dur: 0.15 });
          s.m.point(box, c.num, c.la - c.num);
          s.hide(box, c.la, 0.1);
          const lead = s.text('a', { x: front.x - 8, y: front.y, size: 104, color: s.ink.pink, align: 'right', at: c.la, dur: 0.12 });
          s.words(['sum', '='], { x: 340, y: 322, size: 150, times: [c.sm, c.is] });
          s.text('−b', { x: 690, y: 232, size: 150, color: s.ink.yellow, at: c.nb, dur: 0.25 });
          const bar = s.shape('<path class="bar" d="M570,404 H810" fill="none" stroke="#ffd66b" stroke-width="10" stroke-linecap="round"/>');
          s.draw(bar.get('.bar'), c.over, 0.22, { gain: 0.3 });
          const under = s.text('a', { x: 690, y: 412, size: 150, color: s.ink.pink, at: c.da, dur: 0.1, quiet: true });
          flyCopy(s, 'a', spot(lead), spot(under), c.over, c.da, { color: s.ink.pink, size: 130 });
          s.m.mood('wow', c.nb, 1.4);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{but}But this {only}only gives you {the}the {sm}sum. {not}Not {the2}the {sols}solutions themselves. {keep}And keep track of the {sg}signs, and that {ld}leading number.`,
        run(s, c) {
          s.m.mood('hmm', c.but, 2);
          const line = s.words(['only', 'the', 'sum,', 'not', 'the', 'solutions'], { y: 88, size: 82, times: [c.only, c.the, c.sm, c.not, c.the2, c.sols] });
          line.w.forEach((w, i) => { w.style.color = i < 3 ? s.ink.teal : s.ink.pink; });
          s.mark(line.find('sum'), c.sm, { color: s.ink.teal, hold: c.not - c.sm });
          s.mark(line.find('solutions'), c.sols, { color: s.ink.pink, hold: c.keep - c.sols });
          const row = s.words(['3', '+', '(−5)', '=', '−2'], { y: 190, size: 136, hidden: true });
          [row.w[1], row.w[3], row.w[4]].forEach((n) => s.show(n, c.sm, 0.2));
          s.tint(row.w[4], s.ink.yellow, c.sm, 0.01);
          s.mark(row.w[4], c.sm);
          const step = (c.keep - c.not) / 5;
          const roll = (values) => [[values[4], c.sm], ...values.map((value, i) => [value, c.not + i * step])];
          countOn(s, row.w[0], roll(['3', '1', '0', '4', '?']), s.ink.white);
          countOn(s, row.w[2], roll(['(−5)', '(−3)', '(−2)', '(−6)', '(?)']), s.ink.white);
          for (let i = 0; i < 5; i++) s.sfx('tick', c.not + i * step, 0.5);
          s.m.act('shake', c.not, 0.9);
          const f = s.words(['sum', '=', `<span class="frac"><span>${part('sg', '−')}b</span>${part('ld', 'a')}</span>`], { x: 330, y: 376, size: 130, times: [c.keep, c.keep + 0.1, c.keep + 0.2] });
          const sg = f.querySelector('.sg'), ld = f.querySelector('.ld');
          s.mark(sg, c.sg);
          s.tag('the signs', { x: 830, y: 420, at: c.sg, bg: '#ffd66b', size: 54 });
          s.mark(ld, c.ld, { color: s.ink.pink });
          s.tag('that leading number', { x: 830, y: 512, at: c.ld, bg: '#ff9ccf', size: 54 });
          s.m.point(sg, c.sg, c.end - c.sg);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{before}So before you start, {read}read what they {want}want. {o}One solution. {b}Both. {s}Their sum. {p}Or their product. {bye}Now hit Try this skill!`,
        run(s, c) {
          s.eq([factor('−', '3'), factor('+', '5'), '=', '0'], { y: 80, size: 100, at: c.before, per: 0.1 });
          const line = s.spoken('read what they want', c, c.read, { y: 196, size: 92, color: s.ink.yellow });
          s.mark(line.find('want'), c.want);
          s.m.point(line, c.read, 1.2);
          [['One solution: 3', c.o, 330, 322], ['Both: 3 and −5', c.b, 890, 322], ['Their sum: −2', c.s, 330, 432], ['Their product: −15', c.p, 890, 432]].forEach(([t, at, x, y]) => {
            s.hide(s.tag(t, { x, y, at, bg: '#8fe6cf', size: 56 }), c.bye, 0.25);
          });
          s.m.mood('proud', c.p, 3);
          s.tag('Next: Try this skill', { x: 614, y: 380, at: c.bye + 0.2, bg: '#ffd66b', size: 72 });
          s.m.act('wave', c.bye, 2);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
