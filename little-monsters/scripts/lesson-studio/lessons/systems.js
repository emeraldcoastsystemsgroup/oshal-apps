/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Eliminate a variable: two balances pour together and stay level, each column of the worked example drops down and the opposite terms vanish, the answer goes back in, a scan picks add or subtract, then a graph window hides the crossing until the point is checked in both equations
 */
(function () {
  const DARK = '#173a30', MARKED = '#1d3a31';
  const PINK = '#ff9ccf', TEAL = '#8fe6cf', YELLOW = '#ffd66b', CHALK = '#f5f3ea', WOOD = '#c9915a', CORAL = '#ff8080', BLUE = '#9fd0ff';
  const TILT = 'cubic-bezier(.34,1.4,.5,1)', HANG = 165;

  /** The worked equations: five equal columns, so a term can drop straight down its own column. */
  const EQ = { size: 136, cell: 150, x: 200, align: 'left' };
  const ROW = [84, 230, 392], RULE_Y = 382;
  /** Where the rows sit once the second equation is finished and the sum has moved up. */
  const NEXT = [84, 230, 376, 522];
  /** The right-hand three columns, so every equals sign stays in one line. */
  const LAST3 = { ...EQ, x: EQ.x + 300 };

  /** Slide a part without a sound, remembering where it is. */
  function shift(s, node, dx, dy, t, dur, easing) {
    const x0 = node._tx || 0, y0 = node._ty || 0;
    node._tx = x0 + dx; node._ty = y0 + dy;
    s.anim(node, [{ translate: `${x0}px ${y0}px` }, { translate: `${node._tx}px ${node._ty}px` }], t, dur, easing);
  }

  /** Fade something out for good. */
  const fade = (s, node, t, dur = 0.3, from = 1) => s.anim(node, [{ opacity: from }, { opacity: 0 }], t, dur);

  /** The middle of a worked column, in board pixels. */
  const colX = (i) => EQ.x + EQ.cell * (i + 0.5);

  /** A copy of one written term, invisible until it leaves its place. */
  const copy = (s, text, col, y, color = YELLOW) => s.words([text], { size: EQ.size, gap: 0, x: colX(col), y, color, hidden: true }).w[0];

  /** The copy lights up over the original and slides off by (dx, dy). */
  function send(s, node, dx, dy, t, { dur = 0.38, quiet = false } = {}) {
    s.show(node, t, 0.02);
    if (quiet) shift(s, node, dx, dy, t, dur);
    else s.move(node, dx, dy, t, dur);
  }

  /** A hidden word arrives with a bounce. */
  function arrive(s, node, t, gain = 0.5) {
    s.show(node, t, 0.04);
    s.pop(node, t, { gain });
  }

  /** The opposite terms fall into the sum's empty columns side by side, run together, and are gone. */
  function vanish(s, { plusAt, minusAt, goneAt }) {
    const fall = ROW[2] - ROW[0], rise = ROW[2] - ROW[1], middle = EQ.x + 300;
    const terms = [
      { node: copy(s, '+', 1, ROW[0], PINK), col: 1, x: middle - 115, dy: fall, at: plusAt },
      { node: copy(s, 'y', 2, ROW[0], PINK), col: 2, x: middle - 45, dy: fall, at: plusAt, quiet: true },
      { node: copy(s, '−', 1, ROW[1], TEAL), col: 1, x: middle + 45, dy: rise, at: minusAt },
      { node: copy(s, 'y', 2, ROW[1], TEAL), col: 2, x: middle + 115, dy: rise, at: minusAt, quiet: true },
    ];
    terms.forEach(({ node, col, x, dy, at, quiet }) => {
      send(s, node, x - colX(col), dy, at, { quiet });
      shift(s, node, middle - x, 0, goneAt, 0.14);
      fade(s, node, goneAt + 0.12, 0.08);
    });
    s.sfx('poof', goneAt + 0.12, 0.9);
    s.stars({ x: middle, y: ROW[2] + 75 }, goneAt + 0.12, 9, { spread: 130 });
  }

  /** A letter shrinks away in a burst of stars. */
  function poof(s, node, t, spread = 150) {
    s.anim(node, [{ scale: 1, opacity: 1 }, { scale: 0, opacity: 0 }], t, 0.2);
    s.sfx('poof', t, 0.9);
    s.stars(node, t, 9, { spread });
  }

  /** Hand-drawn rule under the two equations. */
  function rule(s, t) {
    const line = s.shape(`<path class="line" d="M130,${RULE_Y} H960" stroke="${CHALK}" stroke-width="7" stroke-linecap="round"/>`);
    s.draw(line.get('.line'), t, 0.5);
    return line;
  }

  /** A letter block standing on a pan: (x, y) is the middle of its base. */
  function block(cls, x, y, letter, fill) {
    return `<g class="${cls}"><rect x="${x - 48}" y="${y - 96}" width="96" height="96" rx="12" fill="${fill}" stroke="#16352b" stroke-width="3"/>
      <text x="${x}" y="${y - 23}" text-anchor="middle" font-size="78" font-family="Chalk" fill="${DARK}">${letter}</text></g>`;
  }

  /** One pan on its strings, hanging from a beam end at (x, y), with whatever stands on it. */
  function pan(cls, x, y, inside) {
    const low = y + HANG;
    return `<g class="${cls}">
      <path d="M${x},${y} L${x - 104},${low} M${x},${y} L${x + 104},${low}" stroke="${CHALK}" stroke-width="5" fill="none"/>
      ${inside}
      <path d="M${x - 110},${low} H${x + 110} Q${x + 100},${low + 38} ${x},${low + 38} Q${x - 100},${low + 38} ${x - 110},${low} Z" fill="${WOOD}" stroke="#16352b" stroke-width="3"/></g>`;
  }

  /** A balance with its pivot at (cx, y) and beam half-length L. */
  function balance(name, cx, y, L, left, right) {
    return `<g class="${name}">
      <rect x="${cx - 13}" y="${y}" width="26" height="236" rx="10" fill="${WOOD}"/>
      <rect x="${cx - 90}" y="${y + 232}" width="180" height="20" rx="10" fill="#a97243"/>
      <g class="beam"><rect x="${cx - L - 8}" y="${y - 8}" width="${2 * L + 16}" height="16" rx="8" fill="${CHALK}"/></g>
      <circle cx="${cx}" cy="${y}" r="16" fill="${YELLOW}"/>
      ${pan('left', cx - L, y, left)}${pan('right', cx + L, y, right)}</g>`;
  }

  /** Tilt a balance: negative degrees drop the left pan. Riders are loose blocks standing on a pan. */
  function tilt(s, b, deg, t, { left = [], right = [] } = {}) {
    const lean = b.L * Math.sin((deg * Math.PI) / 180), step = lean - (b.drop || 0);
    b.drop = lean;
    s.turn(b.node.querySelector('.beam'), deg, t, 0.5, { origin: `${b.cx}px ${b.y}px`, easing: TILT });
    [b.node.querySelector('.left'), ...left].forEach((n) => shift(s, n, 0, -step, t, 0.5, TILT));
    [b.node.querySelector('.right'), ...right].forEach((n) => shift(s, n, 0, step, t, 0.5, TILT));
  }

  /** A block leaves one balance and lands on the other, over an arc. */
  function hopAcross(s, node, tx, ty, t, dur) {
    const x0 = node._tx, y0 = node._ty;
    node._tx = tx; node._ty = ty;
    s.anim(node, [{ translate: `${x0}px ${y0}px` }, { translate: `${(x0 + tx) / 2}px ${Math.min(y0, ty) - 84}px`, offset: 0.5 }, { translate: `${tx}px ${ty}px` }], t, dur, 'ease-in-out');
    s.sfx('whoosh', t, 0.5);
  }

  /** Two balances, each level. The second pours onto the first: it dips on one block and levels on the other. */
  function balances(s, c) {
    const y = 190, L = 150, low = y + HANG, one = { cx: 300, y, L }, two = { cx: 840, y, L }, away = two.cx - one.cx - 51;
    const svg = s.shape(`${balance('one', one.cx, y, L, block('a', one.cx - L, low, 'A', PINK), block('b', one.cx + L, low, 'B', PINK))}
      ${balance('two', two.cx, y, L, '', '')}
      ${block('c', one.cx - L + 51, low, 'C', TEAL)}${block('d', one.cx + L + 51, low, 'D', TEAL)}`);
    one.node = svg.get('.one');
    two.node = svg.get('.two');
    const a = svg.get('.a'), b = svg.get('.b'), blockC = svg.get('.c'), blockD = svg.get('.d');
    [blockC, blockD].forEach((n) => { n._tx = away; n._ty = 0; n.style.translate = `${away}px 0px`; });
    const first = c.word('two'), second = c.word('equations');
    s.appear(one.node, first, 0.3);
    [two.node, blockC, blockD].forEach((n) => s.appear(n, second, 0.3));
    s.sfx('pop', first, 0.6);
    s.sfx('pop', second, 0.6);

    const FLY = 0.45, tC = c.sum, landC = tC + FLY, tD = c.word('too'), landD = tD + FLY;
    hopAcross(s, blockC, 0, 0, tC, FLY);
    tilt(s, two, 10, tC, { right: [blockD] });
    shift(s, a, -51, 0, landC - 0.12, 0.15);
    tilt(s, one, -10, landC, { left: [blockC] });
    s.sfx('pop', landC, 0.8);
    hopAcross(s, blockD, 0, one.drop, tD, FLY);
    tilt(s, two, 0, tD);
    shift(s, b, -51, 0, landD - 0.12, 0.15);
    tilt(s, one, 0, landD, { left: [blockC], right: [blockD] });
    s.sfx('pop', landD, 0.8);
    return { two: two.node, landC, landD };
  }

  /** Two true equations as two level balances, poured together into one true sum. */
  function pourTogether(s, c) {
    const { two, landC, landD } = balances(s, c);
    const first = c.word('two'), second = c.word('equations'), check = c.word('true');
    const rowA = s.words(['A', '=', 'B', '✓'], { x: 300, y: 448, size: 88, times: [first, first + 0.08, first + 0.16, check] });
    const rowC = s.words(['C', '=', 'D', '✓'], { x: 840, y: 448, size: 88, times: [second, second + 0.08, second + 0.16, check + 0.15] });
    [rowA, rowC].forEach((row) => { row.w[3].style.color = TEAL; });
    const sum = s.words(['A', '+', 'C', '=', 'B', '+', 'D'], { x: 570, y: 572, size: 116, gap: 0.2, times: [landC - 0.1, landC, landC + 0.08, landD - 0.1, landD - 0.02, landD + 0.06, landD + 0.14] });
    [0, 4].forEach((i) => { sum.w[i].style.color = PINK; });
    [2, 6].forEach((i) => { sum.w[i].style.color = TEAL; });
    s.m.point(rowC, c.true, 1);
    s.m.mood('wow', landC, 0.6);
    return [two, rowC, rowA];
  }

  /** Opposite letters slide together and leave nothing. */
  function cancelLetters(s, c) {
    const letters = c.word('letters'), meet = c.word('cancels'), spot = { x: 840, y: 280 };
    const plus = s.text('+y', { x: 670, y: 200, size: 136, color: PINK, at: letters, dur: 0.2 });
    const minus = s.text('−y', { x: 1010, y: 200, size: 136, color: TEAL, at: letters + 0.25, dur: 0.2 });
    s.m.point(spot, c.word('set'), 1.2);
    s.move(plus, 100, 0, c.one, meet - c.one);
    s.move(minus, -100, 0, c.one, meet - c.one);
    [plus, minus].forEach((n) => fade(s, n, meet + 0.05, 0.1));
    s.sfx('poof', meet + 0.05, 0.9);
    s.stars(spot, meet + 0.05, 9, { spread: 150 });
    s.pop(s.text('0', { x: spot.x, y: 200, size: 136, color: YELLOW, at: meet + 0.1, dur: 0.1, quiet: true }), meet + 0.1, { gain: 0.3 });
    s.m.mood('wow', meet, 1);
  }

  /** A red line through the terms that cancel, from x0 to x1. */
  function crossOut(s, x0, x1, y, t) {
    const svg = s.shape(`<path class="cross" d="M${x0},${y + 8} L${x1},${y - 8}" stroke="#d9434e" stroke-width="10" stroke-linecap="round"/>`);
    s.draw(svg.get('.cross'), t, 0.25);
  }

  /** A short curved arrow between two rows, to carry a step. */
  function stepArrow(s, x, y0, y1, t) {
    const paint = `fill="none" stroke="${BLUE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
    const svg = s.shape(`<g class="step"><path class="curve" d="M${x},${y0} Q${x + 52},${(y0 + y1) / 2} ${x},${y1}" ${paint}/>
      <path class="head" d="M${x + 25},${y1 - 6} L${x},${y1} L${x + 7},${y1 - 26}" ${paint}/></g>`);
    s.draw(svg.get('.curve'), t, 0.35);
    s.draw(svg.get('.head'), t + 0.35, 0.1, { gain: 0 });
    return svg.get('.step');
  }

  /** A magnifying glass whose origin is the middle of its lens. */
  function lens(s, x, y, r) {
    const k = r * 0.72;
    const svg = s.shape(`<g class="lens"><circle r="${r}" fill="rgba(255,255,255,.08)" stroke="${YELLOW}" stroke-width="${r * 0.11}"/>
      <path d="M${k},${k} L${k * 1.9},${k * 1.9}" stroke="${YELLOW}" stroke-width="${r * 0.22}" stroke-linecap="round"/></g>`);
    const node = svg.get('.lens');
    node._tx = x; node._ty = y;
    node.style.translate = `${x}px ${y}px`;
    return node;
  }

  /** The two lines of the example seen through a graph window: y stays 0 to 12, x runs 0 to the window's edge. */
  function graphWindow(s, { x, y, w, h }) {
    const sx = (v, edge) => (v / edge) * w, sy = (v) => h - (v / 12) * h;
    const lines = (edge) => ({
      teal: `M0,${sy(12)} L${sx(12, edge)},${sy(0)}`,
      pink: `M${sx(4, edge)},${sy(0)} L${sx(12, edge)},${sy(8)}`,
    });
    const label = (vx, vy, text, anchor) => `<text x="${vx}" y="${vy}" text-anchor="${anchor}" font-size="46" font-family="Chalk" fill="${CHALK}">${text}</text>`;
    const xTicks = (cls, edge) => `<g class="${cls}">${[1, 2, 3].map((i) => label((i * w) / 3, h + 52, (i * edge) / 3, 'middle')).join('')}</g>`;
    const stroke = (cls, color, d) => `<path class="${cls}" d="${d}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
    const start = lines(12);
    const g = s.shape(`<defs><clipPath id="sys-window"><rect width="${w}" height="${h}"/></clipPath></defs>
      <rect class="glass" width="${w}" height="${h}" fill="rgba(0,0,0,.2)"/>
      <g clip-path="url(#sys-window)">${stroke('teal', TEAL, start.teal)}${stroke('pink', PINK, start.pink)}
        <circle class="dot" cx="${sx(8, 12)}" cy="${sy(4)}" r="19" fill="${YELLOW}" stroke="#16352b" stroke-width="4"/>
        <circle class="bad" cx="${sx(2, 12)}" cy="${sy(10)}" r="19" fill="${CORAL}" stroke="#16352b" stroke-width="4"/></g>
      <rect class="edge" width="${w}" height="${h}" fill="none" stroke="${YELLOW}" stroke-width="7"/>
      ${xTicks('far', 12)}${xTicks('near', 6)}
      <g class="side">${[1, 2, 3].map((i) => label(-16, sy(4 * i) + 16, 4 * i, 'end')).join('')}</g>`, { x, y, w, h });
    const near = g.get('.near');
    near.style.opacity = 0;
    let edge = 12;
    const zoom = (next, t, dur = 0.9) => {
      const from = lines(edge), to = lines(next);
      const ease = 'cubic-bezier(.45,.05,.25,1)';
      s.anim(g.get('.teal'), [{ d: `path("${from.teal}")` }, { d: `path("${to.teal}")` }], t, dur, ease);
      s.anim(g.get('.pink'), [{ d: `path("${from.pink}")` }, { d: `path("${to.pink}")` }], t, dur, ease);
      s.anim(g.get('.dot'), [{ translate: `${sx(8, edge) - sx(8, 12)}px 0px` }, { translate: `${sx(8, next) - sx(8, 12)}px 0px` }], t, dur, ease);
      const out = next === 6 ? g.get('.far') : near, back = next === 6 ? near : g.get('.far');
      s.anim(out, [{ opacity: 1 }, { opacity: 0 }], t, dur * 0.5);
      s.anim(back, [{ opacity: 0 }, { opacity: 1 }], t + dur * 0.5, dur * 0.5);
      s.sfx('whoosh', t, 0.7);
      edge = next;
    };
    return { g, zoom, sx, sy };
  }

  LessonStudio.define({
    id: 'systems',
    teacher: 'pinky',
    title: 'Eliminate a variable',
    facts: [['12 + 4', 16], ['16 / 2', 8], ['12 - 8', 4], ['10 + 2', 12], ['12 / 2', 6], ['8 + 4', 12], ['8 - 4', 4], ['6 + 6', 12], ['6 - 6', 0]],
    beats: [
      {
        say: `{hi}Hi again, it's Pinky! {two}Two equations, {un}two unknowns. {dbl}It looks like double the work. {not}It's not. {watch}Watch one letter vanish.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.2);
          s.wideCam(c.two - 0.3, 1.1);
          s.text('Eliminate a variable', { y: 44, size: 100, color: YELLOW, at: c.two - 0.1, dur: 1 });
          const eq = c.word('equations');
          s.text('Two equations', { x: 310, y: 170, size: 84, at: eq, dur: 0.45 });
          s.text('x + y = 12', { x: 310, y: 280, size: 92, at: eq + 0.2, dur: 0.4, color: TEAL });
          s.text('x − y = 4', { x: 310, y: 385, size: 92, at: eq + 0.4, dur: 0.4, color: TEAL });
          const un = c.word('unknowns');
          s.text('Two unknowns', { x: 830, y: 170, size: 84, at: c.un, dur: 0.45 });
          s.text('x', { x: 730, y: 265, size: 190, color: PINK, at: un, dur: 0.2 });
          const letter = s.text('y', { x: 930, y: 265, size: 190, color: PINK, at: un + 0.15, dur: 0.2 });
          const work = s.words(['Double', 'the', 'work?'], { x: 560, y: 545, size: 96, color: '#ffb066', times: [c.word('double'), c.word('the'), c.word('work')] });
          s.m.mood('hmm', c.dbl, 1.4);
          s.strike(work, c.not, { width: 11 });
          s.m.act('shake', c.not, 0.6);
          s.m.mood('sly', c.not, 1.8);
          s.m.point(letter, c.watch, 1.3);
          s.pulse(letter, c.word('one'), { to: 1.3, dur: 0.6 });
          poof(s, letter, c.word('vanish') + 0.15);
        },
      },
      {
        page: 'The idea',
        say: `{add}You're allowed to add two equations together, {sub}or subtract them. {true}If both are true, {sum}the sum is true too, {keep}and the solution stays the same. {cancel}And when the letters are set up right, {one}one of them just cancels.`,
        run(s, c) {
          s.m.look('board', c.add, 2.4);
          const sign = s.words(['+', 'or', '−'], { x: 570, y: 48, size: 96, color: YELLOW, times: [c.word('add'), c.word('or'), c.word('subtract')] });
          fade(s, sign, c.sum, 0.3);
          const finished = pourTogether(s, c);

          const level = s.tag('Still level!', { x: 300, y: 84, at: c.keep, bg: YELLOW, size: 56 });
          s.m.mood('happy', c.keep, 1.6);
          s.m.act('nod', c.keep, 0.7);
          finished.forEach((n) => fade(s, n, c.keep, 0.35));
          const same = s.text('Same solution', { x: 840, y: 250, size: 92, color: YELLOW, at: c.word('solution'), dur: 0.5 });

          [level, same].forEach((n) => fade(s, n, c.cancel, 0.25));
          cancelLetters(s, c);
        },
      },
      {
        page: 'Watch me',
        say: `{look}Look. {a}X plus y equals twelve. {b}X minus y equals four. {see}See the plus y, and the minus y? {opp}They're opposites. {sig}That's the signal.`,
        run(s, c, v) {
          v.top = s.spoken(['x', '+', 'y', '=', '12'], c, c.a, { ...EQ, y: ROW[0] });
          v.bot = s.spoken(['x', '−', 'y', '=', '4'], c, c.b, { ...EQ, y: ROW[1] });
          s.m.look('board', c.look, 3);
          const plus = c.word('plus', 1), minus = c.word('minus', 1);
          v.marks = [
            s.mark(v.top.w[1], plus, { color: PINK }), s.mark(v.top.w[2], plus + 0.14, { color: PINK }),
            s.mark(v.bot.w[1], minus, { color: TEAL }), s.mark(v.bot.w[2], minus + 0.14, { color: TEAL }),
          ];
          s.m.point(v.bot.w[2], c.see, 1.7);
          s.m.mood('wow', c.opp, 1.2);
          s.m.act('nod', c.sig, 0.7);
          v.signal = s.tag('Opposites!', { x: EQ.x + 300, y: 400, at: c.opp, bg: YELLOW, size: 64 });
        },
      },
      {
        say: `{down}Add them, straight down. {xx}X plus x is two x. {yy}Plus y, minus y: gone! {tw}Twelve plus four is sixteen.`,
        run(s, c, v) {
          fade(s, v.signal, c.down, 0.2);
          v.rule = rule(s, c.down);
          v.plus = s.text('+', { x: 110, y: ROW[1], size: 136, color: YELLOW, align: 'left', at: c.down, dur: 0.2, quiet: true });
          s.m.look('board', c.down, 1.4);
          v.sum = s.words(['2x', '', '', '=', '16'], { ...EQ, y: ROW[2], hidden: true });
          const fall = ROW[2] - ROW[0], rise = ROW[2] - ROW[1];

          const two = c.word('two');
          const xs = [copy(s, 'x', 0, ROW[0]), copy(s, 'x', 0, ROW[1])];
          send(s, xs[0], -42, fall, c.word('x', 0));
          send(s, xs[1], 42, rise, c.word('x', 1));
          xs.forEach((n) => fade(s, n, two, 0.08));
          arrive(s, v.sum.w[0], two);
          s.m.point(v.sum.w[0], c.xx, 1.1);

          const goneAt = c.word('gone');
          vanish(s, { plusAt: c.yy, minusAt: c.word('minus'), goneAt });
          v.marks.forEach((m) => fade(s, m, goneAt, 0.3, 0.94));
          [v.top.w[1], v.top.w[2], v.bot.w[1], v.bot.w[2]].forEach((n) => s.anim(n, [{ color: MARKED }, { color: CHALK }], goneAt, 0.2, 'linear'));
          s.m.mood('wow', goneAt, 1.1);
          s.m.act('hop', goneAt, 0.4);

          const sixteen = c.word('sixteen');
          const nums = [copy(s, '12', 4, ROW[0]), copy(s, '4', 4, ROW[1])];
          send(s, nums[0], -25, fall, c.tw);
          send(s, nums[1], 70, rise, c.word('four'));
          s.show(v.sum.w[3], c.word('is', 1), 0.15);
          nums.forEach((n) => fade(s, n, sixteen, 0.08));
          v.sum.w[4].style.color = YELLOW;
          arrive(s, v.sum.w[4], sixteen);
        },
      },
      {
        say: `{x}Two x equals sixteen, {eight}so x is eight. {back}Put eight back in. {y}Eight plus y is twelve, {four}so y is four.`,
        run(s, c, v) {
          [v.bot, v.rule, v.plus].forEach((n) => fade(s, n, c.x, 0.3));
          s.move(v.sum, 0, NEXT[1] - ROW[2], c.x, 0.5);
          shift(s, v.sum.w[0], 300, 0, c.x, 0.5);
          s.pulse(v.sum.w[4], c.word('sixteen'));

          const eight = c.word('eight', 0);
          const xRow = s.words(['x', '=', '8'], { ...LAST3, y: NEXT[2], times: [c.word('x', 1), c.word('is', 0), eight] });
          s.mark(xRow.w[2], eight);
          const step = stepArrow(s, 965, 290, 430, c.eight);
          const halve = s.tag('÷ 2', { x: 1075, y: 324, at: c.eight, bg: BLUE, size: 60 });

          const flyer = copy(s, '8', 4, NEXT[2]);
          send(s, flyer, colX(0) - colX(4), NEXT[0] - NEXT[2], c.back, { dur: 0.5 });
          fade(s, flyer, c.back + 0.5, 0.06);
          const put = s.swap(v.top.w[0], '8', c.back + 0.45, { color: YELLOW });
          s.m.point(v.top.w[0], c.back, 1.2);

          [step, halve].forEach((n) => fade(s, n, c.y, 0.25));
          s.anim(v.sum, [{ opacity: 1 }, { opacity: 0.35 }], c.y, 0.3);
          s.read({ w: [put, ...v.top.w.slice(1)] }, c.from(c.y, 5), TEAL);

          const four = c.word('four');
          const yRow = s.words(['y', '=', '4'], { ...LAST3, y: NEXT[3], times: [c.word('y', 1), c.word('is', 2), four] });
          s.mark(yRow.w[2], four);
          s.stars(yRow.w[2], four + 0.1, 8);
          s.m.act('thumbs', c.four, 1.2);
          s.m.mood('proud', c.four, 1.6);
        },
      },
      {
        page: 'Your turn',
        chipColor: PINK,
        say: `{go}Your turn. {a}X plus y equals ten. {b}X minus y equals two. {ask}What is x? {try}I'll wait.`,
        pause: 5.2,
        run(s, c, v) {
          v.t1 = s.spoken(['x', '+', 'y', '=', '10'], c, c.a, { ...EQ, y: ROW[0] });
          v.t2 = s.spoken(['x', '−', 'y', '=', '2'], c, c.b, { ...EQ, y: ROW[1] });
          v.ask = s.words(['x', '=', '?'], { ...LAST3, y: ROW[2] + 146, times: [c.ask + 0.1, c.word('is'), c.word('x', 2)] });
          v.ask.w[2].style.color = YELLOW;
          s.m.look('board', c.go, 2);
          s.m.act('think', c.try + 0.3, 4.4);
          s.m.mood('hmm', c.try + 0.3, 4.4);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Six! {add}Add them, and you get two x equals twelve. {x}X is six.`,
        run(s, c, v) {
          s.mark(v.ask.w[2], c.ans);
          s.swap(v.ask.w[2], '6', c.ans, { color: MARKED });
          s.stars(v.ask.w[2], c.ans + 0.1, 9);
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);

          rule(s, c.add);
          const leave = c.add + 0.06;
          vanish(s, { plusAt: leave, minusAt: leave + 0.12, goneAt: leave + 0.5 });
          s.words(['2x', '=', '12'], { ...LAST3, y: ROW[2], times: [c.word('two'), c.word('equals'), c.word('twelve')] });
          s.pulse(v.ask.w[0], c.x);
          s.m.point(v.ask.w[0], c.x, 1);
        },
      },
      {
        page: 'A faster way',
        chipColor: TEAL,
        say: `{scan}Before you do anything, look for {m}matching or {o}opposite coefficients. {sub}Matching? Subtract. {add}Opposite? Add. {whole}That's the whole scan.`,
        run(s, c) {
          const S = { size: 92, cell: 98, align: 'left', per: 0.07 };
          const row = (tokens, x, y, at) => s.words(tokens, { ...S, x, y, at });
          const left = [row(['2x', '+', '3y', '=', '13'], 50, 104, c.scan), row(['2x', '+', 'y', '=', '7'], 50, 204, c.scan + 0.25)];
          const right = [row(['3x', '+', '2y', '=', '11'], 590, 104, c.scan + 0.5), row(['x', '−', '2y', '=', '1'], 590, 204, c.scan + 0.75)];
          s.m.look('board', c.scan, 2.4);

          const glass = lens(s, 99, 208, 96);
          s.appear(glass, c.word('look'), 0.2);
          left.forEach((r) => s.mark(r.w[0], c.m, { color: PINK, pad: 1 }));
          s.move(glass, 687, 0, c.o - 0.25, 0.4);
          right.forEach((r) => { s.mark(r.w[1], c.o, { color: TEAL, pad: 1 }); s.mark(r.w[2], c.o + 0.1, { color: TEAL, pad: 1 }); });
          fade(s, glass, c.sub, 0.2);

          const big = (text, x, y, size, color, at) => s.text(text, { x, y, size, color, at, dur: 0.3 });
          big('Matching?', 295, 352, 84, CHALK, c.sub);
          const sub = big('Subtract', 295, 450, 136, PINK, c.word('subtract'));
          [156, 256].forEach((y) => crossOut(s, 58, 140, y, c.word('subtract')));
          s.m.point(sub, c.sub, 0.9);
          big('Opposite?', 835, 352, 84, CHALK, c.add);
          big('Add', 835, 450, 136, TEAL, c.word('add'));
          [156, 256].forEach((y) => crossOut(s, 700, 870, y, c.word('add')));
          s.m.act('thumbs', c.whole, 1.1);
          s.m.mood('happy', c.whole, 1.4);
        },
      },
      {
        page: 'On the SAT: graph it',
        chipColor: TEAL,
        say: `{graph}And on the SAT, you can also graph both equations. {cross}Where the lines cross, {pt}that's your solution.`,
        run(s, c) {
          const g = s.plot({ x: 120, y: 110, w: 546, h: 546, xMax: 12, yMax: 12, xStep: 4, yStep: 4, at: c.graph });
          const both = c.word('both'), eq = c.word('equations');
          g.line(0, 12, 12, 0, both, { color: TEAL, width: 9, dur: 0.6 });
          s.text('x + y = 12', { x: 750, y: 110, size: 80, color: TEAL, align: 'left', at: both, dur: 0.45 });
          g.line(4, 0, 12, 8, eq, { color: PINK, width: 9, dur: 0.6 });
          s.text('x − y = 4', { x: 750, y: 210, size: 80, color: PINK, align: 'left', at: eq, dur: 0.45 });
          s.m.look('board', c.graph, 2);

          const cross = g.box(8, 4);
          s.m.point(cross, c.cross, 1.5);
          const hit = c.word('cross');
          g.dot(8, 4, hit, { color: YELLOW, r: 22 });
          s.stars(cross, hit, 8, { spread: 120 });
          s.tag('(8, 4)', { x: 640, y: 438, at: hit + 0.1, bg: YELLOW, size: 60 });
          g.line(8, 4, 8, 0, c.pt, { color: YELLOW, width: 5, dur: 0.35 });
          g.line(8, 4, 0, 4, c.pt + 0.15, { color: YELLOW, width: 5, dur: 0.35 });
          s.text('x = 8, y = 4', { x: 750, y: 320, size: 76, color: YELLOW, align: 'left', at: c.pt + 0.1, dur: 0.6 });
          s.m.mood('proud', c.pt, 1.4);
        },
      },
      {
        page: 'Watch out',
        chipColor: CORAL,
        say: `{but}But a graph window can hide a crossing. {zoom}Zoom in the wrong place, {lines}and the lines look like they never meet.`,
        run(s, c, v) {
          s.m.mood('hmm', c.but, 2);
          const view = graphWindow(s, { x: 120, y: 156, w: 470, h: 470 });
          v.view = view;
          const { g } = view;
          s.appear(g.get('.glass'), c.but, 0.3);
          s.draw(g.get('.edge'), c.but, 0.5);
          s.appear(g.get('.far'), c.but + 0.2, 0.3);
          s.appear(g.get('.side'), c.but + 0.2, 0.3);
          s.tag('Graph window', { x: 355, y: 72, at: c.word('window'), bg: YELLOW, size: 52 });
          s.draw(g.get('.teal'), c.word('graph'), 0.5);
          s.draw(g.get('.pink'), c.word('window'), 0.5);
          s.pop(g.get('.dot'), c.word('crossing'), { gain: 0.5 });

          view.zoom(6, c.zoom, 1);
          s.m.point({ x: 400, y: 380 }, c.zoom, 1.2);
          v.none = s.tag('No crossing here?', { x: 875, y: 310, at: c.lines, bg: CORAL, size: 60 });
          s.m.act('shrug', c.word('never'), 1.1);
          s.m.mood('oops', c.word('never'), 1.2);
        },
      },
      {
        say: `{check}So check your point in {both}both of the original equations.`,
        run(s, c, v) {
          const { view } = v;
          const { g } = view;
          fade(s, v.none, c.check, 0.2);
          view.zoom(12, c.check, 0.7);
          v.spot = s.tag('(8, 4)', { x: 450, y: 284, at: c.word('point'), bg: YELLOW, size: 56 });
          s.pulse(g.get('.dot'), c.word('point'), { to: 1.5, dur: 0.6 });
          const R = { x: 860, size: 92, per: 0.06 };
          v.ok1 = s.words(['8', '+', '4', '=', '12', '✓'], { ...R, y: 130, color: TEAL, at: c.both });
          v.ok2 = s.words(['8', '−', '4', '=', '4', '✓'], { ...R, y: 250, color: PINK, at: c.word('original') });
          s.m.point(v.ok2, c.both, 1.3);
          s.m.mood('happy', c.word('equations'), 1);
        },
      },
      {
        say: `{one}A point on {only}only one line {not}is not a solution.`,
        run(s, c, v) {
          const { view } = v;
          const { g } = view;
          [v.ok1, v.ok2, v.spot].forEach((n) => fade(s, n, c.one, 0.2));
          const bad = g.get('.bad'), along = view.sx(4, 12);
          s.pop(bad, c.word('point'), { gain: 0.5 });
          s.move(bad, along, along, c.only - 0.05, 0.6);
          s.tag('(6, 6)', { x: 450, y: 284, at: c.word('line'), bg: CORAL, size: 56 });
          const R = { x: 860, size: 92, per: 0.06 };
          s.words(['6', '+', '6', '=', '12', '✓'], { ...R, y: 130, color: TEAL, at: c.only });
          const miss = s.words(['6', '−', '6', '=', '4', '✗'], { ...R, y: 250, color: PINK, at: c.not });
          miss.w[5].style.color = CORAL;
          s.m.act('shake', c.not, 0.8);
          s.m.mood('oops', c.not, 1.4);
          s.tag('Not a solution', { x: 860, y: 372, at: c.word('solution'), bg: CORAL, size: 60 });
        },
      },
      {
        page: 'Remember',
        chipColor: YELLOW,
        say: `{one}So: scan for matching or opposite terms. {two}Add or subtract. {three}Then check both equations. {bye}Now hit Try this skill, and go make some letters vanish!`,
        run(s, c) {
          const R = { x: 190, size: 96, align: 'left' };
          const scan = c.word('scan');
          s.appear(lens(s, 118, 148, 42), scan, 0.2);
          s.words(['Scan:', 'matching', 'or', 'opposite'], { ...R, y: 96, times: [scan, c.word('matching'), c.word('or'), c.word('opposite')] });
          const marks = s.shape(`<path class="pm" d="M92,258 H144 M118,232 V284 M92,316 H144" stroke="${TEAL}" stroke-width="11" stroke-linecap="round" fill="none"/>
            <path class="ok" d="M84,440 L108,468 L156,404" stroke="${YELLOW}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
          s.draw(marks.get('.pm'), c.two, 0.3);
          s.words(['Add', 'or', 'subtract'], { ...R, y: 228, color: TEAL, times: [c.two, c.word('or', 1), c.word('subtract')] });
          s.draw(marks.get('.ok'), c.word('check'), 0.3);
          s.words(['Then', 'check', 'both', 'equations'], { ...R, y: 360, color: YELLOW, times: [c.three, c.word('check'), c.word('both'), c.word('equations')] });
          s.m.mood('proud', c.three, 3);
          s.tag('Next: Try this skill', { x: 560, y: 520, at: c.word('try'), bg: YELLOW, size: 60 });
          s.m.act('wave', c.bye, 2.2);
          s.confetti(c.bye + 0.6);
          const letter = s.text('y', { x: 930, y: 490, size: 136, color: PINK, at: c.word('letters'), dur: 0.2, quiet: true });
          poof(s, letter, c.word('vanish') + 0.15, 130);
        },
      },
    ],
  });
})();
