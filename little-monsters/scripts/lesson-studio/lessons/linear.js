/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Solve for what is asked: an equation drops onto a balance that tips and levels, a worked equation moves term by term as it is spoken, little monsters walk past the stop sign into the x = 5 trap, a choice is weighed on the scale, and the habit of underlining what is asked
 */
(function () {
  const CHALK = '#f5f3ea', YELLOW = '#ffd66b', PINK = '#ff9ccf', TEAL = '#8fe6cf', RED = '#ff8080', INK = '#173a30', PLUM = '#3b1030';
  const MOVE = 'cubic-bezier(.45,.05,.2,1)';
  /** The worked page and the student's page share one layout, so the second feels familiar. */
  const EQ_X = 540, EQ_Y = 84, Q_X = 90, Q_Y = 612, RULE_Y = 342, WORK = { size: 150, dy: 94 }, SIGN = [1044, 410, 86];

  /** Where a node sits on the board, read during the build while nothing has moved. */
  function spot(n) {
    const r = n.getBoundingClientRect();
    return { x: r.left - 58 + r.width / 2, y: r.top - 44 + r.height / 2, left: r.left - 58, right: r.right - 58 };
  }

  /** How far a term must slide to sit next to the equals sign once the terms between are gone. */
  const gapToEquals = (w) => spot(w[3]).left - spot(w[0]).right - 36;

  /** A chalk line that draws itself: a ruled line in a working, or the ground. */
  function chalkLine(s, x0, x1, y, t, { width = 7, dur = 0.3, gain = 0.6 } = {}) {
    const g = s.shape(`<path class="l" d="M${x0},${y} H${x1}" stroke="${CHALK}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`);
    s.draw(g.get('.l'), t, dur, { gain });
  }

  /** A labelled weight for a balance pan. */
  function block(cls, x, top, w, h, fill, label, size = 84) {
    return `<g class="${cls}"><rect x="${x}" y="${top}" width="${w}" height="${h}" rx="16" fill="${fill}"/>`
      + `<text x="${x + w / 2}" y="${top + h / 2 + size * 0.32}" text-anchor="middle" font-size="${size}" font-family="Chalk" fill="${PLUM}">${label}</text></g>`;
  }

  /**
   * The balance: a beam that tips on its post while the pans hang level, and a badge at the pivot
   * that reads as the equation's equals sign. Everything is in board coordinates.
   */
  function balance(s, { cx = 540, by = 236, arm = 332, drop = 170, pan = 330, foot = 690, left = '', right = '' } = {}) {
    const hl = cx - arm, hr = cx + arm, py = by + drop;
    const side = (hx, load, cls) => `<g class="${cls}">
      <path class="part" d="M${hx},${by + 6} L${hx - pan / 2 + 18},${py} M${hx},${by + 6} L${hx + pan / 2 - 18},${py}" stroke="${CHALK}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path class="part" d="M${hx - pan / 2},${py} H${hx + pan / 2} Q${hx + pan / 2 - 18},${py + 52} ${hx},${py + 52} Q${hx - pan / 2 + 18},${py + 52} ${hx - pan / 2},${py} Z" fill="${TEAL}"/>
      ${load}</g>`;
    const bars = `<path d="M${cx - 27},${by - 14} H${cx + 27} M${cx - 27},${by + 14} H${cx + 27}" stroke="${PLUM}" stroke-width="11" stroke-linecap="round" fill="none"/>`;
    const slash = `<path d="M${cx + 15},${by - 31} L${cx - 15},${by + 31}" stroke="${PLUM}" stroke-width="11" stroke-linecap="round" fill="none"/>`;
    const query = `<text x="${cx}" y="${by + 26}" text-anchor="middle" font-size="84" font-family="Chalk" fill="${PLUM}">?</text>`;
    const face = (cls, fill, inner, hidden) => `<g class="${cls}"${hidden ? ' style="opacity:0"' : ''}><circle cx="${cx}" cy="${by}" r="54" fill="${fill}" stroke="${INK}" stroke-width="5"/>${inner}</g>`;
    const g = s.shape(`
      <rect class="part" x="${cx - 20}" y="${by}" width="40" height="${foot - by}" rx="12" fill="#c9915a"/>
      <rect class="part" x="${cx - 150}" y="${foot - 6}" width="300" height="36" rx="16" fill="#a97243"/>
      <g class="beam"><rect class="part" x="${hl - 24}" y="${by - 13}" width="${2 * arm + 48}" height="26" rx="13" fill="${CHALK}"/>
        ${side(hl, left, 'panL')}${side(hr, right, 'panR')}</g>
      <g class="mid">${face('eq', YELLOW, bars)}${face('neq', RED, bars + slash, true)}${face('q', CHALK, query, true)}</g>`);
    const beam = g.get('.beam'), panL = g.get('.panL'), panR = g.get('.panR'), mid = g.get('.mid');
    let showing = 'eq';
    return {
      g, mid, cx, by, hl, hr, py,
      parts(t) { g.querySelectorAll('.part').forEach((p) => s.appear(p, t, 0.35)); },
      /** Tip the beam. The pans turn back the other way and swing a little, so they stay level. */
      tilt(deg, t, dur = 0.65) {
        s.turn(beam, deg, t, dur, { origin: `${cx}px ${by}px` });
        s.turn(panL, -deg, t, dur + 0.3, { origin: `${hl}px ${by}px`, easing: 'cubic-bezier(.3,1.9,.5,1)' });
        s.turn(panR, -deg, t, dur + 0.3, { origin: `${hr}px ${by}px`, easing: 'cubic-bezier(.3,1.9,.5,1)' });
      },
      /** Change the badge between equals, not equals and a question mark. */
      badge(name, t) {
        s.anim(g.get('.' + showing), [{ opacity: 1 }, { opacity: 0 }], t, 0.14);
        s.anim(g.get('.' + name), [{ opacity: 0 }, { opacity: 1 }], t, 0.14);
        s.pulse(mid, t, { to: 1.25, dur: 0.42 });
        showing = name;
      },
    };
  }

  /** Drop a weight onto a pan so it lands at time t. */
  function land(s, node, t, from = 210) {
    node.style.opacity = 0;
    s.anim(node, [{ opacity: 0, translate: `0px ${-from}px` }, { opacity: 1, translate: `0px ${-from}px`, offset: 0.12 }, { opacity: 1, translate: '0px 0px' }], t - 0.34, 0.34, 'ease-in');
    s.sfx('pop', t, 0.8);
  }

  /** A road sign that springs up from its foot. */
  function stopSign(s, [x, y, r], t, post) {
    const points = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      points.push(`${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`);
    }
    const g = s.shape(`<g class="sign"><rect x="${x - 8}" y="${y}" width="16" height="${post}" rx="6" fill="#cfc9b6"/>
      <polygon points="${points.join(' ')}" fill="#e5484d" stroke="${CHALK}" stroke-width="8" stroke-linejoin="round"/>
      <text x="${x}" y="${y + r * 0.24}" text-anchor="middle" font-size="${r * 0.66}" font-family="Fredoka" font-weight="600" fill="#fff">STOP</text></g>`);
    s.grow(g.get('.sign'), t, 0.42, { from: '1 0', origin: '50% 100%', easing: 'cubic-bezier(.3,1.6,.5,1)' });
    s.sfx('boing', t, 0.55);
  }

  /** A puff of chalk dust where terms cancel. */
  function dust(s, x, y, t) {
    const puffs = [[-70, -26], [-30, -60], [24, -66], [72, -22], [-52, 34], [6, 46], [60, 30]];
    const g = s.shape(puffs.map(() => `<circle cx="${x}" cy="${y}" r="26" fill="${CHALK}" style="opacity:0"/>`).join(''));
    [...g.children].forEach((n, i) => {
      n.style.transformBox = 'fill-box';
      n.style.transformOrigin = '50% 50%';
      s.anim(n, [{ opacity: 0.75, translate: '0px 0px', scale: 0.3 }, { opacity: 0, translate: `${puffs[i][0]}px ${puffs[i][1]}px`, scale: 1.1 }], t, 0.55, 'ease-out', 'none');
    });
    s.sfx('poof', t, 0.8);
  }

  /** Cancelled terms get a line through them and then go, in a puff of dust. */
  function vanish(s, nodes, t) {
    const lines = nodes.map((n, i) => s.strike(n, t + i * 0.05, { dim: 1 }));
    [...nodes, ...lines].forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0 }], t + 0.34, 0.26));
    const a = spot(nodes[0]), b = spot(nodes[nodes.length - 1]);
    dust(s, (a.x + b.x) / 2, (a.y + b.y) / 2, t + 0.34);
  }

  /** Write a term under the left side, then send a copy flying from beside it to the right side. */
  function termOnBothSides(s, html, leftOf, rightOf, t, flyAt, dur) {
    const look = { size: 96, color: PINK, dy: -14 };
    const first = s.below(leftOf, html, { ...look, at: t, dur: 0.25 });
    const copy = s.below(rightOf, html, { ...look, at: flyAt, dur: 0.05 });
    const a = first.getBoundingClientRect(), b = copy.getBoundingClientRect();
    s.anim(copy, [{ translate: `${a.right + 10 - b.left}px 0px` }, { translate: '0px 0px' }], flyAt, dur, MOVE);
    s.sfx('whoosh', flyAt, 0.45);
    return [first, copy];
  }

  /** A row of answer choices, each a chalk box with a lettered bubble. list.row moves them all. */
  function choices(s, items, { x, y, w, h, gap }) {
    const g = s.shape(`<g class="row">${items.map(([letter, value], i) => {
      const left = x + i * (w + gap), mid = y + h / 2;
      return `<g class="ch${i}"><rect class="box" x="${left}" y="${y}" width="${w}" height="${h}" rx="18" fill="rgba(245,243,234,.1)" stroke="${CHALK}" stroke-width="5"/>
        <circle cx="${left + 46}" cy="${mid}" r="32" fill="${TEAL}"/>
        <text x="${left + 46}" y="${mid + 17}" text-anchor="middle" font-size="48" font-family="Fredoka" font-weight="600" fill="${INK}">${letter}</text>
        <text class="val" x="${left + 92 + (w - 92) / 2}" y="${mid + 33}" text-anchor="middle" font-size="102" font-family="Chalk" fill="${CHALK}">${value}</text></g>`;
    }).join('')}</g>`);
    const list = items.map((_, i) => g.get('.ch' + i));
    list.row = g.get('.row');
    return list;
  }

  /** Fill one choice box with marker. */
  function pickChoice(s, node, color, t) {
    s.anim(node.querySelector('.box'), [{ fill: 'rgba(245,243,234,.1)' }, { fill: color }], t, 0.2);
    s.anim(node.querySelector('.val'), [{ fill: CHALK }, { fill: PLUM }], t, 0.2);
    s.sfx('swipe', t, 0.5);
  }

  /** Waddle a little monster along the ground. */
  function walk(s, node, dx, t, dur, steps = 6) {
    const frames = [];
    const count = steps * 2;
    for (let i = 0; i <= count; i++) {
      const k = i / count;
      const up = Math.abs(Math.sin(k * steps * Math.PI)) * 14;
      frames.push({ translate: `${(dx * k).toFixed(1)}px ${(-up).toFixed(1)}px`, rotate: i === count ? '0deg' : `${i % 2 ? 5 : -5}deg` });
    }
    s.anim(node, frames, t, dur, 'linear');
    node._at = { x: dx, y: 0 };
  }

  /** Jump along an arc to an offset from where the node was placed. */
  function hop(s, node, dx, dy, t, dur = 0.55, high = 130) {
    const a = node._at || { x: 0, y: 0 };
    const frames = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      frames.push({ translate: `${(a.x + (dx - a.x) * k).toFixed(1)}px ${(a.y + (dy - a.y) * k - Math.sin(k * Math.PI) * high).toFixed(1)}px` });
    }
    s.anim(node, frames, t, dur, 'linear');
    s.sfx('boing', t, 0.4);
    node._at = { x: dx, y: dy };
  }

  /** A chalk cage that slams down, landing a moment after t. */
  function cage(s, x, y, w, h, t, fall = 190) {
    const bars = [1, 2, 3, 4].map((i) => `M${x + (w * i) / 5},${y} V${y + h}`).join(' ');
    const g = s.shape(`<g class="cage"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="rgba(23,58,48,.28)" stroke="${CHALK}" stroke-width="10"/>
      <path d="${bars}" stroke="${CHALK}" stroke-width="8" fill="none"/></g>`);
    const n = g.get('.cage');
    n.style.opacity = 0;
    s.anim(n, [
      { opacity: 0, translate: `0px ${-fall}px` }, { opacity: 1, translate: `0px ${-fall}px`, offset: 0.04 },
      { opacity: 1, translate: '0px 0px', offset: 0.62 }, { opacity: 1, translate: '0px -22px', offset: 0.8 }, { opacity: 1, translate: '0px 0px' },
    ], t - 0.05, 0.5, 'ease-in');
    s.sfx('poof', t + 0.25, 0.9);
  }

  /** The opening: a pile of extra work lands sheet by sheet while it is named. */
  function workPile(s, x, y, times) {
    const lay = [[-14, 20, -7], [16, 2, 5], [-8, -16, -3], [12, -36, 6], [-4, -56, -2]];
    const g = s.shape(`<g class="pile">${lay.map(([dx, dy, r]) => `<g transform="translate(${x + dx} ${y + dy}) rotate(${r})"><g class="sheet">
      <rect x="-170" y="-112" width="340" height="224" rx="10" fill="${CHALK}" stroke="#b9b3a0" stroke-width="3"/>
      <path d="M-134,-68 H112 M-134,-22 H66 M-134,24 H124 M-134,70 H28" stroke="#7b9a8e" stroke-width="13" stroke-linecap="round" fill="none"/></g></g>`).join('')}</g>`);
    [...g.querySelectorAll('.sheet')].forEach((sheet, i) => {
      sheet.style.opacity = 0;
      s.anim(sheet, [{ opacity: 0, translate: '0px -200px' }, { opacity: 1, translate: '0px -200px', offset: 0.15 }, { opacity: 1, translate: '0px 0px' }], times[i] - 0.1, 0.26, 'ease-in');
      s.sfx('pop', times[i] + 0.14, 0.4);
    });
    return g.get('.pile');
  }

  /** The equation is built from weights across the top, then falls apart onto the balance. */
  function equationBecomesBalance(s, c) {
    const b = balance(s, {
      left: block('x', 80, 306, 110, 100, PINK, 'x') + block('add', 200, 306, 136, 100, YELLOW, '+ 2'),
      right: block('four', 744, 306, 110, 100, PINK, '4') + block('add', 864, 306, 136, 100, YELLOW, '+ 2'),
    });
    const named = c.word('equation'), balanced = c.word('balance');
    [[b.g.get('.x'), 255, -220], [b.mid, 0, -100], [b.g.get('.four'), -109, -220]].forEach(([n, dx, dy], i) => {
      s.pop(n, named + i * 0.12, { gain: 0.5 });
      n.style.translate = `${dx}px ${dy}px`;
      s.anim(n, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], balanced, 0.55, MOVE);
    });
    b.parts(balanced - 0.05);
    s.sfx('whoosh', balanced, 0.5);
    return b;
  }

  /** The crowd pops up beside the answer, ignores the stop sign and keeps walking to x = 5. */
  function crewKeepsGoing(s, c) {
    const start = c.word('But'), keep = c.word('keep'), get = c.word('get');
    const known = s.eq(['3x', '=', '15'], { x: 60, y: 96, size: 120, align: 'left', times: [start, start + 0.06, start + 0.12] });
    known.w[2].style.color = YELLOW;
    stopSign(s, [486, 162, 66], start + 0.2, 308);
    chalkLine(s, 50, 1130, 470, start + 0.1, { width: 6, dur: 0.5, gain: 0.3 });
    const crew = [[110, 40, c.word('lot')], [225, 210, c.word('of')], [340, 120, c.word('people')]].map(([x, hue, t]) => s.critter(x, 390, 140, t, { hue }));
    crew.forEach((n) => walk(s, n, 520, keep, get - keep));
    s.m.look({ x: 400, y: 390 }, c.word('people'), 1.4);
    s.m.act('shake', c.word('going'), 0.7);
    s.words(['÷', '3'], { x: 668, y: 90, size: 104, gap: 0.2, color: PINK, times: [c.div, c.word('three', 1)] });
    s.arrow({ x: 570, y: 226 }, { x: 770, y: 206 }, c.div, { color: PINK, curve: 0.12 });
    const wrong = s.eq(['x', '=', '5'], { x: 800, y: 96, size: 120, align: 'left', color: PINK, times: [get, get + 0.08, c.word('five')] });
    return { crew, wrong };
  }

  /** They rush to the five in the choices, and the cage that was waiting for them comes down. */
  function fiveIsTheTrap(s, c, { crew, wrong }) {
    const pick = c.word('pick'), five = c.word('five', 1), waiting = c.word('waiting');
    const list = choices(s, [['A', '5'], ['B', '7'], ['C', '15'], ['D', '22']], { x: 50, y: 474, w: 208, h: 146, gap: 26 });
    s.circle(list[2], c.word('them') + 0.1, { color: YELLOW, pad: 8 });
    list.forEach((n, i) => {
      s.pop(n, pick + i * 0.07, { gain: 0.4 });
      s.pulse(n, c.word('choices') + i * 0.07, { to: 1.1, dur: 0.36 });
    });
    s.m.mood('oops', pick, 2.6);
    crew.forEach((n, i) => hop(s, n, [-14, -56, -98][i], 0, pick + i * 0.08, 0.55, 120));
    pickChoice(s, list[0], PINK, five);
    s.mark(wrong.w[2], five, { color: PINK, hold: 1.4 });
    s.m.point({ x: 150, y: 540 }, c.wait, waiting - c.wait);
    cage(s, 42, 294, 256, 176, waiting);
    s.m.act('shake', waiting, 1);
    s.tag('A trap!', { x: 154, y: 632, at: c.word('them'), bg: RED, size: 60 });
  }

  /** The choices start large in the middle of the board, then move up to make room for the balance. */
  function choicesMoveUp(s, c) {
    const list = choices(s, [['A', '3'], ['B', '5'], ['C', '7'], ['D', '9']], { x: 121, y: 86, w: 190, h: 112, gap: 26 });
    const big = { translate: '0px 230px', scale: '1.18' };
    Object.assign(list.row.style, big, { transformBox: 'view-box', transformOrigin: '540px 142px' });
    s.anim(list.row, [big, { translate: '0px 0px', scale: '1' }], c.word('into') - 0.05, 0.45, MOVE);
    const glow = [c.try, c.word('the'), c.word('answers'), c.word('answers') + 0.3];
    list.forEach((n, i) => {
      s.pop(n, c.word('multiple') + i * 0.09, { gain: 0.4 });
      s.pulse(n, glow[i], { to: 1.12, dur: 0.42 });
    });
    pickChoice(s, list[1], YELLOW, c.word('choice', 1));
  }

  /** The original equation sits on the balance, left side in one pan and right side in the other. */
  function originalOnBalance(s, c) {
    const hl = 208, top = 346, orig = c.word('original');
    const tokens = [['3', -118], ['×', -62], ['5', -6], ['+', 56], ['7', 114]];
    const line = (cls, x, text) => `<text class="${cls}" x="${x}" y="${top + 78}" text-anchor="middle" font-size="88" font-family="Chalk" fill="${PLUM}">${text}</text>`;
    const b = balance(s, {
      by: 290, drop: 160,
      left: `<g class="sum"><rect x="${hl - 160}" y="${top}" width="320" height="104" rx="16" fill="${PINK}"/>${line('before', hl, '3x + 7')}`
        + `<g class="after" style="opacity:0">${tokens.map(([text, dx], i) => line('t' + i, hl + dx, text)).join('')}</g></g>`,
      right: block('rhs', 807, top, 130, 104, YELLOW, '22', 88),
    });
    b.parts(orig - 0.05);
    s.pop(b.g.get('.sum'), orig);
    s.pop(b.g.get('.rhs'), orig + 0.1);
    s.pop(b.mid, orig + 0.2, { gain: 0.3 });
    const label = s.tag('the original equation', { x: b.cx, y: 568, at: orig, size: 46 });
    s.anim(label, [{ opacity: 1 }, { opacity: 0 }], c.three, 0.25);
    return b;
  }

  /** The chosen five jumps from its box onto the x, and the balance is asked the question. */
  function plugInTheFive(s, c, b) {
    const fly = c.see, see = c.word('see');
    const five = s.text('5', { x: 478, y: 89, size: 102, color: YELLOW, at: fly, dur: 0.05 });
    hop(s, five, 202 - 478, 395 - 142, fly, 0.55, 90);
    s.anim(five, [{ scale: 1 }, { scale: 1.7, offset: 0.5 }, { scale: 1 }], fly, 0.55, 'linear');
    s.anim(five, [{ opacity: 1 }, { opacity: 0 }], fly + 0.55, 0.12);
    s.anim(b.g.get('.before'), [{ opacity: 1 }, { opacity: 0 }], fly + 0.4, 0.06);
    s.anim(b.g.get('.after'), [{ opacity: 0 }, { opacity: 1 }], fly + 0.46, 0.08);
    b.badge('q', see);
    b.tilt(-6, see, 0.4);
    b.tilt(5, c.word('it'), 0.4);
    b.tilt(-4, c.word('balances') + 0.3, 0.5);
  }

  /** Each term swells as it is read, the left side adds up to twenty-two, and the beam levels. */
  function itBalances(s, c, b) {
    [c.three, c.word('times'), c.word('five'), c.word('plus'), c.word('seven')].forEach((t, i) => {
      const n = b.g.get('.t' + i);
      n.style.transformBox = 'fill-box';
      n.style.transformOrigin = '50% 50%';
      s.pulse(n, t, { to: 1.4, dur: 0.42 });
    });
    s.m.point({ x: b.hl, y: 400 }, c.three, c.tw - c.three);
    s.text('= 22', { x: b.hl, y: 512, size: 104, color: YELLOW, at: c.tw, dur: 0.3 });
    b.tilt(0, c.tw + 0.3, 0.8);
    b.badge('eq', c.tw + 0.5);
    s.tag('It works!', { x: b.hr, y: 540, at: c.yes, bg: YELLOW, size: 60 });
    s.stars({ x: b.cx, y: b.by }, c.yes, 8);
    s.m.act('hop', c.yes, 0.4);
    s.m.mood('happy', c.yes, 1.6);
  }

  /** What you found against what they asked, and the one more step from x to three x. */
  function foundVersusAsked(s, c) {
    const warn = s.shape(`<g class="warn"><path d="M614,190 L780,470 H448 Z" fill="${YELLOW}" stroke="${CHALK}" stroke-width="14" stroke-linejoin="round"/>
      <text x="614" y="440" text-anchor="middle" font-size="220" font-family="Fredoka" font-weight="600" fill="${PLUM}">!</text></g>`).get('.warn');
    const foundT = c.word('found'), said = c.word('x', 2), three = c.word('three'), last = c.word('three', 1), done = c.word('x', 4);
    s.pop(warn, c.word('careful'));
    s.anim(warn, [{ opacity: 1 }, { opacity: 0 }], foundT, 0.2);
    const found = s.words(['You', 'found:', 'x', '=', '5'], { x: 80, y: 130, size: 124, align: 'left', times: [foundT, foundT + 0.1, c.word('x'), c.word('is'), c.word('five')] });
    s.mark(found.find('x'), c.word('x', 1), { color: PINK });
    s.mark(found.find('5'), c.word('five'), { color: PINK });
    const asked = s.words(['They', 'asked:', '3x', '=', '?'], { x: 80, y: 370, size: 124, color: TEAL, align: 'left', times: [c.word('question'), c.word('wanted'), three, said, said + 0.1] });
    const target = asked.find('3x'), blank = asked.w[4];
    s.circle(target, three, { color: YELLOW });
    s.m.point(target, three, c.stopx - three);
    s.m.act('shake', c.stopx, 0.8);
    s.tag("Don't stop here", { x: 480, y: 278, at: c.word('stop'), bg: RED, size: 50 });
    s.pulse(target, last);
    s.arrow(found.find('5'), blank, last, { color: YELLOW, curve: -0.34 });
    s.text('× 3', { x: spot(blank).x + 130, y: 268, size: 96, color: YELLOW, at: last, dur: 0.25 });
    s.swap(blank, '15', done, { color: YELLOW });
    s.stars(blank, done + 0.1, 7);
  }

  /** Two routes from what you are trying: the original is the check, a changed line is not. */
  function onlyTheOriginal(s, c) {
    const tryT = c.word('try'), work = c.word('work'), orig = c.word('original'), eqT = c.word('equation');
    const not = c.word('not'), line = c.word('line'), changed = c.word('changed');
    const pen = (cls, color, d, width = 10) => `<path class="${cls}" d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    const routes = s.shape(`<g transform="translate(0 22)">${pen('good', TEAL, 'M470,222 Q370,262 310,346')}${pen('goodHead', TEAL, 'M350,334 L306,352 L298,306')}
      ${pen('bad', RED, 'M690,222 Q790,262 850,346')}${pen('badHead', RED, 'M810,338 L854,352 L858,306')}
      ${pen('yes', YELLOW, 'M190,250 L224,288 L290,206', 17)}${pen('no1', RED, 'M740,226 L808,294', 17)}${pen('no2', RED, 'M808,226 L740,294', 17)}</g>`);
    s.text('Try  x = 5', { x: 580, y: 104, size: 116, at: tryT, dur: 0.3 });
    s.draw(routes.get('.good'), work, 0.35);
    s.draw(routes.get('.goodHead'), work + 0.3, 0.12);
    const first = s.words(['3x', '+', '7', '=', '22'], { x: 316, y: 386, size: 124, gap: 0.2, color: YELLOW, times: [orig, orig + 0.08, orig + 0.16, orig + 0.24, eqT] });
    s.tag('the original', { x: 316, y: 540, at: orig, bg: YELLOW, size: 54 });
    s.m.point(first, orig, not - orig);
    s.draw(routes.get('.yes'), eqT + 0.2, 0.3);
    s.sfx('ding', eqT + 0.3, 0.7);
    s.m.mood('happy', eqT, 1);
    s.draw(routes.get('.bad'), not, 0.35);
    s.draw(routes.get('.badHead'), not + 0.3, 0.12);
    s.words(['3x', '=', '15'], { x: 860, y: 386, size: 124, gap: 0.2, times: [line, line + 0.08, line + 0.16] });
    s.tag('a line you changed', { x: 860, y: 540, at: line, bg: RED, size: 48 });
    s.draw(routes.get('.no1'), changed, 0.16);
    s.draw(routes.get('.no2'), changed + 0.14, 0.16);
    s.m.act('shake', changed, 0.8);
  }

  /** The student who underlined hops over the five, and the cage comes down on nobody. */
  function trapMisses(s, c) {
    const trap = c.word('trap'), never = c.word('never'), gets = c.word('gets');
    chalkLine(s, 70, 960, 622, c.stay, { width: 6, dur: 0.4, gain: 0.3 });
    const friend = s.critter(170, 553, 120, c.stay + 0.1, { hue: 120 });
    s.tag('every time', { x: 860, y: 450, at: c.word('every'), size: 50 });
    s.pop(choices(s, [['A', '5']], { x: 340, y: 524, w: 208, h: 98, gap: 0 })[0], trap, { gain: 0.4 });
    hop(s, friend, 520, 0, never, gets - never + 0.15, 90);
    cage(s, 354, 404, 180, 120, gets, 110);
    s.stars({ x: 690, y: 553 }, c.word('you', 1), 8);
  }

  LessonStudio.define({
    id: 'linear',
    teacher: 'pinky',
    title: 'Solve for what is asked',
    facts: [['22 - 7', 15], ['15 / 3', 5], ['26 + 4', 30], ['3 * 5', 15], ['3 * 5 + 7', 22]],
    beats: [
      {
        say: `{hi}Hey! I'm Pinky. {save}Today I'm going to save you from doing extra work on algebra questions. [playful] Seriously. Extra work is how they get you.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.9);
          s.m.mood('happy', c.hi, 2.2);
          s.wideCam(c.save - 0.2, 1.1);
          s.text('Solve for what is asked', { y: 90, size: 104, at: c.save + 0.4, color: YELLOW, dur: 1.1 });
          s.m.look('board', c.save + 0.3, 1.4);
          const pile = workPile(s, 320, 480, c.from(c.word('extra'), 5).map((w) => w.t0));
          const extra = s.words(['extra', 'work'], { x: 820, y: 300, size: 128, color: PINK, times: [c.word('extra'), c.word('work')] });
          s.m.mood('sly', c.word('Seriously'), 2.6);
          s.mark(extra.w[0], c.word('extra', 1), { color: PINK });
          s.mark(extra.w[1], c.word('work', 1), { color: PINK });
          s.m.look(extra, c.word('extra', 1), 1.2);
          s.tag('how they get you', { x: 820, y: 476, at: c.word('how'), bg: RED, size: 56 });
          s.turn(pile, 5, c.word('get'), 0.5, { origin: '320px 600px', easing: 'cubic-bezier(.3,2.4,.5,1)' });
          s.sfx('boing', c.word('get'), 0.4);
        },
      },
      {
        page: 'The idea',
        say: `{bal}An equation is a balance. {put}Whatever you do to one side, {other}you do to the other side, {level}and it stays level.`,
        run(s, c) {
          const b = equationBecomesBalance(s, c);
          const level = s.shape(`<path class="l" d="M44,236 H1160" stroke="${YELLOW}" stroke-width="6" stroke-dasharray="3 24" stroke-linecap="round" fill="none"/>`, { layer: 'under' });
          const sideL = c.word('side'), sideR = c.word('side', 1), adds = b.g.querySelectorAll('.add');
          s.m.look('board', c.bal, 2);
          s.m.point({ x: b.cx, y: b.by }, c.word('balance'), c.put - c.word('balance'));
          s.m.point({ x: b.hl, y: 356 }, c.put, c.other - c.put - 0.1);
          s.tag('one side', { x: b.hl, y: 516, at: c.word('one'), size: 50 });
          land(s, adds[0], sideL);
          b.tilt(-8, sideL);
          b.badge('neq', sideL + 0.1);
          s.m.mood('wow', sideL, 1);
          s.m.point({ x: b.hr, y: 356 }, c.other, c.level - c.other);
          s.tag('other side', { x: b.hr, y: 516, at: c.word('other'), size: 50 });
          land(s, adds[1], sideR);
          b.tilt(0, sideR, 0.75);
          b.badge('eq', sideR + 0.25);
          s.appear(level.get('.l'), c.word('stays'), 0.3);
          s.tag('It stays level', { x: b.cx, y: 92, at: c.word('level'), bg: YELLOW, size: 60 });
          s.m.mood('happy', c.level, 1.6);
          s.m.act('nod', c.level, 0.8);
        },
      },
      {
        page: 'Watch me',
        say: `{look}Okay, look at this one. {a}Three x plus seven {b}equals twenty-two. {ask}And the question says: what is the value of {tx}three x? {not}Not x. [emphatic] Three x. {ring}So I circle that, right now, before I do anything else.`,
        run(s, c, v) {
          const named = c.word('three', 1), circle = c.word('circle');
          s.m.look('board', c.look, 1.6);
          s.m.act('lean', c.look, 0.8);
          v.eq = s.eq(['3x', '+', '7', '=', '22'], { x: EQ_X, y: EQ_Y, times: [c.a, c.word('plus'), c.word('seven'), c.b, c.word('twenty-two')] });
          s.tag('the question', { x: Q_X, y: Q_Y - 66, at: c.word('question'), size: 44, align: 'left' });
          v.target = s.spoken('What is the value of 3x ?', c, c.word('what'), { x: Q_X, y: Q_Y, size: 88, color: TEAL, align: 'left' }).find('3x');
          s.m.point(v.target, c.tx, c.not - c.tx - 0.1);
          s.mark(v.target, named, { hold: circle - named });
          const notX = s.text('x', { x: 975, y: Q_Y - 24, size: 124, color: RED, at: c.not, dur: 0.2 });
          const line = s.strike(notX, c.word('x', 2), { dim: 1 });
          s.m.act('shake', c.not, 0.7);
          s.m.mood('sly', c.not, 2.2);
          s.pulse(v.target, c.word('three', 2));
          [notX, line].forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0 }], circle, 0.3));
          s.circle(v.target, circle, { color: YELLOW, dur: 0.55 });
          s.m.act('nod', c.word('right'), 0.6);
        },
      },
      {
        say: `{sub}Subtract seven {both}from both sides. {gone}Plus seven, minus seven: gone. {left}Twenty-two minus seven {f}is fifteen. {eq2}So three x equals fifteen.`,
        pause: 0.2,
        run(s, c, v) {
          const w = v.eq.w, close = gapToEquals(w);
          const both = c.word('both'), plus = c.word('plus'), gone = c.word('gone'), fifteen = c.word('fifteen'), three = c.word('three');
          s.m.point(w[2], c.sub, both - c.sub);
          const [minusL, minusR] = termOnBothSides(s, '− 7', w[2], w[4], c.word('seven'), both, 0.42);
          s.mark(w[1], plus, { color: PINK, hold: gone - plus, pad: 4 });
          s.mark(w[2], c.word('seven', 1), { color: PINK, hold: gone - c.word('seven', 1), pad: 4 });
          s.mark(minusL, c.word('minus'), { color: PINK, hold: gone - c.word('minus') });
          vanish(s, [w[1], w[2], minusL], gone);
          s.m.mood('happy', gone, 1);
          s.move(w[0], close, 0, gone + 0.5, 0.4);
          s.mark(w[4], c.left, { hold: fifteen - c.left + 0.3 });
          s.mark(minusR, c.word('minus', 1), { hold: fifteen - c.word('minus', 1) + 0.3 });
          chalkLine(s, spot(w[0]).left + close - 16, spot(w[4]).right + 16, RULE_Y, c.f);
          v.r15 = s.below(w[4], '15', { ...WORK, color: YELLOW, at: fifteen, dur: 0.3 });
          v.r3x = s.below(w[0], '3x', { ...WORK, at: three, dur: 0.05, dx: close });
          s.anim(v.r3x, [{ translate: '0px -120px' }, { translate: '0px 0px' }], three, 0.4, MOVE);
          s.sfx('whoosh', three, 0.45);
          s.below(w[3], '=', { ...WORK, at: c.word('equals'), dur: 0.15 });
          s.pulse(v.r15, c.word('fifteen', 1));
          s.m.point(v.r15, c.eq2, 1.4);
        },
      },
      {
        say: `{stop}And stop. [firmly] Right there. {done}Three x is fifteen. That is the answer. {most}But a lot of people keep going, {div}divide by three, {five}get five, {pick}and pick five. {wait}Which is sitting right there in the choices, waiting for them.`,
        run(s, c, v) {
          const stop = c.word('stop'), fifteen = c.word('fifteen'), at = spot(v.r15);
          s.m.act('stop', stop, 1);
          s.m.mood('wow', stop, 0.8);
          stopSign(s, SIGN, stop, 240);
          s.circle(v.r3x, c.done, { color: YELLOW, pad: 2 });
          s.pulse(v.target, c.done);
          s.circle(v.r15, fifteen, { color: YELLOW, pad: 2 });
          s.stars(v.r15, fifteen + 0.25, 8);
          s.m.act('nod', fifteen, 0.8);
          s.m.mood('proud', fifteen, 2);
          s.tag('the answer', { x: at.x, y: at.y + 84, at: c.word('answer'), bg: YELLOW, size: 48 });
          s.newPage(c.word('But'), 'The trap', RED);
          s.m.mood('hmm', c.word('But'), 1.4);
          fiveIsTheTrap(s, c, crewKeepsGoing(s, c));
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}Five y minus four {b}equals twenty-six. {ask}What is five y? {try}Go on, I'll wait.`,
        pause: 5.2,
        run(s, c, v) {
          s.m.look('board', c.go, 2);
          v.eq2 = s.eq(['5y', '−', '4', '=', '26'], { x: EQ_X, y: EQ_Y, times: [c.a, c.word('minus'), c.word('four'), c.b, c.word('twenty-six')] });
          const ask = s.spoken('What is 5y ?', c, c.ask, { x: Q_X, y: Q_Y - 12, size: 96, color: TEAL, align: 'left' });
          s.circle(ask.find('5y'), c.word('y', 1), { color: YELLOW, dur: 0.45 });
          v.thinkFrom = c.try + 0.5;
          v.ringFrom = c.end + 0.3;
        },
      },
      {
        say: `{answer}Thirty! {add}Add four to both sides, {stop}and stop. {all}If you got thirty, you're already better at this than you were two minutes ago.`,
        gap: 0.1,
        run(s, c, v) {
          const wait = c.answer - v.thinkFrom - 0.35, w = v.eq2.w, close = gapToEquals(w);
          const both = c.word('both'), stop = c.word('stop'), again = c.word('thirty', 1), better = c.word('better');
          s.m.act('think', v.thinkFrom, Math.min(3.6, wait));
          if (wait > 4.4) s.m.act('tilt', v.thinkFrom + 4, wait - 4);
          s.m.mood('hmm', v.thinkFrom, wait);
          s.countdown(v.ringFrom, Math.max(4, Math.floor(c.answer - v.ringFrom - 0.4)), { x: 1080, y: 18 });
          s.below(w[0], '5y', { ...WORK, dx: close, at: c.answer, dur: 0.1 });
          s.below(w[3], '=', { ...WORK, at: c.answer + 0.08, dur: 0.1 });
          const thirty = s.below(w[4], '30', { ...WORK, color: YELLOW, at: c.answer + 0.14, dur: 0.15 });
          s.m.act('cheer', c.answer, 1.2);
          s.m.mood('proud', c.answer, 2.6);
          s.stars(thirty, c.answer + 0.2, 9);
          const [plusL] = termOnBothSides(s, '+ 4', w[2], w[4], c.word('four'), both, 0.3);
          chalkLine(s, spot(w[0]).left + close - 16, spot(w[4]).right + 16, RULE_Y, c.word('sides'), { dur: 0.25 });
          vanish(s, [w[1], w[2], plusL], c.stop);
          s.move(w[0], close, 0, c.stop + 0.5, 0.4);
          s.circle(thirty, stop, { color: YELLOW, pad: 2 });
          stopSign(s, SIGN, stop, 240);
          s.pulse(thirty, again);
          s.m.point(thirty, again, 1);
          s.tag('Better already!', { x: spot(thirty).x, y: spot(thirty).y + 92, at: better, bg: YELLOW, size: 50 });
          s.m.act('hop', better, 0.4);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{mc}On multiple choice, there's another move: {try}try the answers. {plug}Put a choice into the original equation {see}and see if it balances. {three}Three times five, plus seven. {tw}Twenty-two. {yes}It works!`,
        run(s, c) {
          s.m.look('board', c.mc, 2);
          choicesMoveUp(s, c);
          s.m.mood('sly', c.word('another'), 1.8);
          s.m.point({ x: 400, y: 372 }, c.plug, c.word('original') - c.plug);
          const b = originalOnBalance(s, c);
          plugInTheFive(s, c, b);
          itBalances(s, c, b);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{but}But careful. {found}Plugging in found x. {x}X is five. {want}The question wanted three x. {stopx}So don't stop at x when the question asks for three x. {must}And whatever you try has to work in the original equation, not a line you changed along the way.`,
        run(s, c) {
          s.m.mood('hmm', c.but, 2);
          foundVersusAsked(s, c);
          s.newPage(c.must, 'Watch out', RED);
          onlyTheOriginal(s, c);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{one}One habit. {u}Underline what they're asking for, before you calculate anything. {stay}Do that every time, and this trap never gets you. {bye}Now hit Try this skill, and go get 'em!`,
        run(s, c) {
          const target = s.words('What is the value of 3x ?', { x: 600, y: 84, size: 96, color: TEAL, at: c.one, per: 0.05 }).find('3x');
          s.under(target, c.u, { dur: c.word('what') - c.u, width: 12 });
          s.m.point(target, c.u, c.word('before') - c.u);
          s.mark(target, c.word('asking'), { color: YELLOW });
          s.spoken("Underline what they're asking for,", c, c.u, { x: 600, y: 204, size: 88 });
          s.spoken('before you calculate anything.', c, c.word('before'), { x: 600, y: 304, size: 88, color: YELLOW });
          trapMisses(s, c);
          s.m.mood('proud', c.stay, 3.2);
          s.tag('Next: Try this skill', { x: 520, y: 636, at: c.word('Try'), bg: YELLOW, size: 56 });
          s.m.act('wave', c.bye, 2.1);
          s.confetti(c.bye + 0.6);
        },
      },
    ],
  });
})();
