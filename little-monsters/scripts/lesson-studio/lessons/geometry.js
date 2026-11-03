/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Scale areas carefully: a square's outline doubles and copies of the little square fly in to fill it, the k by k picture of the rule, a shape that triples for the student, a cube that builds up to eight, a rectangle with a face pulled out of shape, and units with their pictures
 */
(function () {
  const DARK = '#16352b';
  const TEAL = ['#c9f3e8', '#8fe6cf', '#5fc7ae'];
  const PINK = ['#ffd3e8', '#ff9ccf', '#e97db4'];

  /** Where the worked square stands: the little square's corner and side, in board pixels. */
  const SQ = { x: 96, y: 170, side: 240 };

  /** The block of eight cubes: one cube's edge, the isometric steps along it, and the block's middle. */
  const CUBE = { u: 120, w: 104.4, h: 60, cx: 300, cy: 370 };

  /** A square of tiles, built from small rects so tiles can pop in one by one. */
  function tiles(cols, rows, size, color) {
    let out = '';
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      out += `<rect class="tile" x="${q * size + 3}" y="${r * size + 3}" width="${size - 6}" height="${size - 6}" rx="6" fill="${color}"/>`;
    }
    return out;
  }

  /** The little square of the worked example: nine tiles with its area written on them. */
  function littleSquare(color) {
    const mid = SQ.side / 2;
    return `${tiles(3, 3, SQ.side / 3, color)}<text class="nine" x="${mid}" y="${mid + 38}" text-anchor="middle" font-size="124" font-family="Chalk" fill="${DARK}">9</text>`;
  }

  /** One isometric cube, for the volume build. The point x, y is the near corner of its top face. */
  function iso(x, y, s, [top, left, right] = TEAL) {
    const w = s * 0.87, h = s * 0.5;
    return `<g class="cube"><path d="M${x},${y} L${x + w},${y - h} L${x},${y - 2 * h} L${x - w},${y - h} Z" fill="${top}" stroke="${DARK}" stroke-width="3"/>
      <path d="M${x},${y} L${x},${y + s} L${x - w},${y + s - h} L${x - w},${y - h} Z" fill="${left}" stroke="${DARK}" stroke-width="3"/>
      <path d="M${x},${y} L${x},${y + s} L${x + w},${y + s - h} L${x + w},${y - h} Z" fill="${right}" stroke="${DARK}" stroke-width="3"/></g>`;
  }

  /** The eight cubes of a doubled cube, back to front. The original sits at the front, in pink. */
  function cubeBlock() {
    const { u, w, h, cx, cy } = CUBE;
    const order = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    return order.map(([i, j, k], n) => iso(cx + (i - j) * w, cy + (i + j) * h - k * u, u, n === 3 ? PINK : TEAL)).join('');
  }

  /** A lumpy five-sided shape standing on the corner x, y, u wide and u tall, so it is no special figure. */
  function lump(x, y, u) {
    const points = [[0, 0], [0, -0.68], [0.4, -1], [1, -0.7], [0.88, 0]];
    return `M${points.map(([a, b]) => `${x + a * u},${y + b * u}`).join(' L')} Z`;
  }

  /** A right triangle with legs of four and three units, its right angle at the corner x, y. */
  function triangle(x, y, u) {
    return `M${x},${y} H${x + 4 * u} L${x},${y - 3 * u} Z`;
  }

  /** A rectangle with a face. Pull it out of shape and the face shows it. */
  function buddy(x, base, w, h, color) {
    const eye = (at) => `<circle cx="${x + w * at}" cy="${base - h * 0.62}" r="${h * 0.17}" fill="#fff"/><circle cx="${x + w * at}" cy="${base - h * 0.6}" r="${h * 0.08}" fill="${DARK}"/>`;
    return `<g class="buddy"><g class="body"><rect x="${x}" y="${base - h}" width="${w}" height="${h}" rx="${h * 0.12}" fill="${color}"/>${eye(0.33)}${eye(0.67)}
      <path d="M${x + w * 0.36},${base - h * 0.3} Q${x + w / 2},${base - h * 0.1} ${x + w * 0.64},${base - h * 0.3}" fill="none" stroke="${DARK}" stroke-width="${h * 0.05}" stroke-linecap="round"/></g></g>`;
  }

  /** A slash through a board word, because the chalk font has no not-equal sign. */
  function slash(s, node, t, color) {
    const page = s.page.getBoundingClientRect(), b = node.getBoundingClientRect();
    const x = b.left - page.left + b.width / 2, y = b.top - page.top + b.height / 2;
    const line = s.shape(`<path class="slash" d="M${x - 20},${y + 36} L${x + 20},${y - 36}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>`).get('.slash');
    s.draw(line, t, 0.18);
    return line;
  }

  /** Send a copy of a board term to where the working needs it, so the step visibly uses it. */
  function carry(s, from, to, html, color, t, dur = 0.34) {
    const copy = s.below(from, html, { size: parseFloat(getComputedStyle(from).fontSize), color, at: t, dur: 0.01, dy: -from.offsetHeight, quiet: true });
    s.flyTo(copy, to, t, dur);
    s.hide(copy, t + dur, 0.05);
  }

  /** Grow an outline's size, which keeps its line the same thickness all the way. */
  function growOutline(s, node, size, next, t, dur) {
    s.anim(node, [{ width: `${size}px`, height: `${size}px` }, { width: `${next}px`, height: `${next}px` }], t, dur, 'cubic-bezier(.45,.05,.2,1)');
    s.sfx('whoosh', t, 0.6);
  }

  LessonStudio.define({
    id: 'geometry',
    teacher: 'pinky',
    title: 'Scale areas carefully',
    facts: [
      ['3 ** 2', 9],
      ['3 * 2', 6],
      ['6 ** 2', 36],
      ['2 * 9', 18],
      ['4 * 9', 36],
      ['3 ** 2 * 5', 45],
      ['4 * 2', 8],
      ['5 * 2', 10],
      ['2 ** 3', 8],
    ],
    beats: [
      {
        say: `{hi}Hi, Pinky here! {q}Quick one. If you double the {si}sides of a {sq}square, how much {big}bigger is the {ar}area? {gut}Most people's gut says {two}double. {see}Let's see.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.3);
          s.wideCam(c.q - 0.3, 1.1);
          s.text('Scale areas carefully', { y: 44, size: 96, color: s.ink.yellow, at: c.q, dur: 0.9 });
          s.words(['sides', '×', '2'], { x: 210, y: 300, size: 76, times: [c.si, c.si + 0.12, c.si + 0.24] });
          const pic = s.shape(`<rect class="little" x="130" y="400" width="160" height="160" rx="10" fill="#8fe6cf"/>
            <rect class="big" x="450" y="240" width="320" height="320" rx="12" fill="none" stroke="#f5f3ea" stroke-width="7"/>`);
          s.pop(pic.get('.little'), c.sq, { gain: 0.6 });
          s.arrow({ x: 300, y: 480 }, { x: 440, y: 480 }, c.big, { curve: -0.22 });
          s.draw(pic.get('.big'), c.big, 0.5);
          const area = s.words(['Area', '×', '?'], { x: 610, y: 354, size: 84, times: [c.ar, c.ar + 0.1, c.ar + 0.2] });
          s.m.point(area, c.ar, 0.9);
          s.m.mood('sly', c.gut, 2.2);
          s.critter(980, 460, 190, c.gut, { hue: 200 });
          s.tag('Double?', { x: 980, y: 250, at: c.two, bg: '#ff9ccf', size: 60 });
          s.m.look('board', c.see, 0.8);
        },
      },
      {
        page: 'Watch me',
        say: `Here's a {sq}square with {side}side {three}three. Its area is {sqr}three squared: {n}nine. {dbl}Now double every side. {six}Side six. {ar6}Six squared {th}is thirty-six.`,
        run(s, c, v) {
          const { x, y, side } = SQ;
          const outline = s.shape(`<rect class="out" x="${x}" y="${y}" width="${side}" height="${side}" rx="10" fill="none" stroke="#f5f3ea" stroke-width="7"/>`).get('.out');
          s.draw(outline, c.sq, 0.5);
          const label = s.text('side 3', { x: x + side / 2, y: 92, size: 68, at: c.side, dur: 0.4 });
          v.little = s.shape(littleSquare('#8fe6cf'), { x, y, w: side, h: side, layer: 'under' });
          const cells = [...v.little.querySelectorAll('.tile')];
          cells.slice(0, 3).forEach((n, i) => s.pop(n, c.three + i * 0.1, { gain: 0.3 }));
          const fill = c.word('area');
          cells.slice(3).forEach((n, i) => s.pop(n, fill + ((c.n - fill) * i) / 6, { gain: 0.25 }));
          s.pop(v.little.get('.nine'), c.n, { gain: 0.6 });
          s.m.point({ x: x + side / 2, y: y + side / 2 }, c.side, 1.1);
          v.nine = s.eq(['3<sup>2</sup>', '=', '9'], { x: 860, y: 130, size: 112, color: s.ink.teal, times: [c.sqr, c.n - 0.15, c.n] }).w[2];
          s.mark(v.nine, c.n, { hold: 1.2 });

          const grow = c.word('double');
          const twice = s.text('× 2', { x: 380, y: 92, size: 68, color: s.ink.pink, at: grow, dur: 0.3 });
          growOutline(s, outline, side, side * 2, grow, Math.max(0.7, c.six - grow - 0.1));
          s.m.look({ x: x + side * 1.5, y: y + side * 1.5 }, grow, 1.2);
          s.hide(label, c.six, 0.15);
          s.hide(twice, c.six, 0.15);
          s.words(['side', '6'], { x: x + side, y: 92, size: 68, color: s.ink.yellow, times: [c.six, c.word('six')] });
          v.total = s.eq(['6<sup>2</sup>', '=', '36'], { x: 860, y: 270, size: 112, color: s.ink.pink, times: [c.ar6, c.th, c.word('thirty-six')] }).w[2];
          s.mark(v.total, c.word('thirty-six'), { hold: 1.6 });
          s.m.point(v.total, c.word('thirty-six'), 0.9);
          s.m.mood('wow', c.word('thirty-six'), 1.2);
        },
      },
      {
        say: `{thirty}Thirty-six is not two times nine. It's {four}four times nine. {look}Look. {c1}Four copies {c2}of the little square {c3}fit inside {c4}the big one.`,
        run(s, c, v) {
          const { x, y, side } = SQ;
          const nineAt = c.word('nine');
          const line = s.eq(['36', '=', '2', '×', '9'], { x: 860, y: 430, size: 104, times: [c.thirty + 0.3, Math.min(c.word('is') + 0.3, c.word('not')), c.word('two'), c.word('times'), nineAt + 0.15] });
          carry(s, v.total, line.w[0], '36', s.ink.pink, c.thirty, 0.3);
          carry(s, v.nine, line.w[4], '9', s.ink.teal, nineAt - 0.15, 0.3);
          const bar = slash(s, line.w[1], c.word('not'), s.ink.red);
          s.m.act('shake', c.word('not'), 0.7);
          s.hide(bar, c.four, 0.16);
          s.mark(line.w[2], c.four);
          const four = s.swap(line.w[2], '4', c.four, { color: '#1d3a31' });
          s.m.point(line.w[2], c.four, 0.9);
          s.m.point({ x: x + side, y: y + side }, c.look, 1);
          s.pulse(v.little, c.c1, { to: 1.08 });
          s.pulse(four, c.c1, { to: 1.3 });
          [['c2', '#ff9ccf', side, 0], ['c3', '#ffd66b', 0, side], ['c4', '#9fd0ff', side, side]].forEach(([cue, color, dx, dy]) => {
            const copy = s.shape(littleSquare(color), { x, y, w: side, h: side, layer: 'under' });
            s.show(copy, c[cue], 0.06);
            s.move(copy, dx, dy, c[cue], 0.5);
            s.sfx('pop', c[cue] + 0.5, 0.5);
          });
          s.m.mood('proud', c.c4, 1.6);
          s.stars({ x: x + side, y: y + side }, c.c4 + 0.45, 9);
          s.m.act('hop', c.c4 + 0.45, 0.4);
        },
      },
      {
        page: 'The idea',
        gap: 1.8,
        say: `{rule}That's the rule. If {len}lengths get {mul}multiplied by {k}k, {ar}area gets multiplied by {kk}k {sq}squared.`,
        run(s, c) {
          const u = 100, x = 700, y = 190;
          const pic = s.shape(tiles(3, 3, u, '#8fe6cf'), { x, y, w: 3 * u, h: 3 * u, layer: 'under' });
          const cells = [...pic.querySelectorAll('.tile')];
          const outline = s.shape(`<rect class="out" x="${x}" y="${y}" width="${u}" height="${u}" rx="8" fill="none" stroke="#f5f3ea" stroke-width="7"/>`).get('.out');
          s.pop(cells[0], c.rule, { gain: 0.6 });
          s.draw(outline, c.rule, 0.4);
          s.m.act('nod', c.rule, 0.8);
          s.words(['Lengths', '×', 'k'], { x: 340, y: 170, size: 108, color: s.ink.teal, times: [c.len, c.mul, c.k] });
          growOutline(s, outline, u, 3 * u, c.mul, Math.max(0.7, c.ar - c.mul - 0.1));
          s.m.look({ x: x + 1.5 * u, y: y + 1.5 * u }, c.mul, 1.2);
          s.text('× k', { x: x + 1.5 * u, y: 104, size: 76, color: s.ink.teal, at: c.k, dur: 0.25 });
          s.text('× k', { x: x + 3 * u + 64, y: y + 1.5 * u - 42, size: 76, color: s.ink.teal, at: c.k, dur: 0.25 });
          const area = s.words(['Area', '×', 'k<sup>2</sup>'], { x: 340, y: 340, size: 124, color: s.ink.yellow, times: [c.ar, c.word('multiplied', 1), c.kk] });
          cells.slice(1).forEach((n, i) => s.pop(n, c.ar + ((c.sq - c.ar) * i) / 8, { gain: 0.25 }));
          s.mark(area.w[2], c.sq);
          s.tag('k × k', { x: x + 1.5 * u, y: y + 1.5 * u - 44, at: c.sq, bg: '#ffd66b', size: 62 });
          s.m.point(area.w[2], c.sq, 1.1);
          s.m.mood('proud', c.sq, 1.4);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        gap: 1.5,
        say: `{go}Your turn. A {sh}shape has an {ar}area of {five}five. Make every {len}length {three}three times as {lg}long. {ask}What's the {nw}new area? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const bx = 690, by = 470, u = 110;
          const pic = s.shape(`<path class="big" d="${lump(bx, by, u * 3)}" fill="rgba(245,243,234,.07)" stroke="#f5f3ea" stroke-width="7" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            <path class="little" d="${lump(bx, by, u)}" fill="#8fe6cf"/>`);
          s.pop(pic.get('.little'), c.sh, { gain: 0.6 });
          s.text('5', { x: bx + 50, y: by - 78, size: 68, color: DARK, at: c.five, dur: 0.2 });
          v.area = s.words(['Area', '=', '5'], { x: 330, y: 110, size: 100, times: [c.ar, c.word('of'), c.five] });
          v.len = s.words(['Lengths', '×', '3'], { x: 330, y: 230, size: 100, color: s.ink.teal, times: [c.len, c.three, c.three] });
          const big = pic.get('.big');
          s.show(big, c.three, 0.12);
          s.grow(big, c.three, Math.max(0.7, c.lg - c.three + 0.25), { from: '0.3333 0.3333', to: '1 1', origin: '0% 100%' });
          s.sfx('whoosh', c.three, 0.6);
          s.m.look({ x: bx + 1.5 * u, y: by - 1.5 * u }, c.three, 1.2);
          v.ask = s.words(['New', 'area?'], { x: 330, y: 350, size: 100, color: s.ink.yellow, times: [c.nw, c.word('area', 1)] });
          v.q = s.text('?', { x: 900, y: 226, size: 140, color: s.ink.yellow, at: c.nw, dur: 0.25 });
          s.m.point(v.q, c.nw, 0.8);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Forty-five! {three}Three {sq}squared is {is9}nine. {nine}Nine {tm}times {five}five.`,
        run(s, c, v) {
          s.hide(v.ask, c.ans, 0.15);
          const answer = s.swap(v.q, '45', c.ans, { color: s.ink.yellow });
          s.stars(answer, c.ans + 0.1, 9);
          s.m.act('cheer', c.ans, 0.9);
          s.m.mood('proud', c.ans, 2.2);
          const threeLands = c.three + Math.max(0.3, c.sq - c.three);
          const square = s.eq(['3<sup>2</sup>', '=', '9'], { x: 330, y: 350, size: 100, color: s.ink.teal, times: [threeLands, Math.max(c.word('is'), threeLands + 0.1), c.is9] });
          carry(s, v.len.w[2], square.w[0], '3', s.ink.teal, c.three, threeLands - c.three);
          const nineLands = c.nine + Math.max(0.3, c.tm - c.nine);
          const fiveFlies = nineLands + 0.05, fiveLands = fiveFlies + Math.max(0.3, c.five - fiveFlies);
          const product = s.eq(['9', '×', '5', '=', '45'], { x: 330, y: 480, size: 100, color: s.ink.yellow, times: [nineLands, fiveFlies, fiveLands, fiveLands + 0.15, fiveLands + 0.27] });
          carry(s, square.w[2], product.w[0], '9', s.ink.teal, c.nine, nineLands - c.nine);
          carry(s, v.area.w[2], product.w[2], '5', s.ink.white, fiveFlies, fiveLands - fiveFlies);
          s.mark(product.w[4], fiveLands + 0.3);
          s.m.point(product.w[4], fiveLands + 0.15, 0.9);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        gap: 1.6,
        say: `{fast}This is the fast way, because you don't have to {re}recalculate {ev}every {sd}side. Just {find}find the {sf}scale factor.`,
        run(s, c) {
          const pic = s.shape(`<path class="small" d="${triangle(150, 570, 46)}" fill="#8fe6cf"/>
            <path class="big" d="${triangle(570, 590, 92)}" fill="none" stroke="#f5f3ea" stroke-width="7" stroke-linejoin="round"/>`);
          s.pop(pic.get('.small'), c.fast, { gain: 0.5 });
          s.draw(pic.get('.big'), c.fast + 0.2, 0.6);
          s.m.mood('sly', c.fast, 2.2);
          [['3', 110, 462], ['4', 242, 574], ['5', 266, 432]].forEach(([t, x, y]) => s.text(t, { x, y, size: 64, at: c.word('way'), dur: 0.2 }));
          const asks = [[c.re, 612, 430], [c.ev, 754, 596], [c.sd, 796, 372]].map(([at, x, y]) => s.text('?', { x, y, size: 72, color: s.ink.yellow, at, dur: 0.15 }));
          s.m.point({ x: 700, y: 480 }, c.ev, 0.9);
          const line = s.words(['Find', 'the', 'scale factor'], { y: 84, size: 92, times: [c.find, c.word('the', 1), c.sf] });
          s.mark(line.w[2], c.sf + 0.5);
          s.tag('× 2', { x: 445, y: 396, at: c.sf, bg: '#ffd66b', size: 64 });
          s.arrow({ x: 352, y: 545 }, { x: 548, y: 545 }, c.sf, { curve: -0.24, color: s.ink.yellow });
          ['6', '8', '10'].forEach((t, i) => s.swap(asks[i], t, c.word('factor') + i * 0.12, { color: s.ink.yellow }));
          s.m.point(line.w[2], c.sf, 1.2);
          s.m.mood('proud', c.word('factor'), 1.4);
        },
      },
      {
        page: 'Even in 3D',
        chipColor: '#8fe6cf',
        gap: 1.3,
        say: `It even works in {three}three {dim}dimensions. {vol}Volume scales by the {cu}cube of the length factor. {dbl}Double the {si}sides of a cube, {eight}and you get eight times the volume.`,
        run(s, c) {
          const { u, w, h, cx, cy } = CUBE;
          const cubes = [...s.shape(cubeBlock()).querySelectorAll('.cube')];
          s.pop(cubes[3], c.three, { gain: 0.6 });
          const px = cx, py = cy + 2 * h + u;
          const edges = s.shape(`<g fill="none" stroke="#ffd66b" stroke-width="9" stroke-linecap="round">
            <path class="edge" d="M${px},${py} L${px - 2 * w},${py - 2 * h}"/><path class="edge" d="M${px},${py} L${px + 2 * w},${py - 2 * h}"/><path class="edge" d="M${px},${py} V${py - 2 * u}"/></g>`);
          const hit = c.word('eight');
          edges.querySelectorAll('.edge').forEach((e, i) => {
            e.setAttribute('pathLength', '1');
            e.style.strokeDasharray = '1.02';
            e.style.strokeDashoffset = '1.03';
            s.anim(e, [{ strokeDashoffset: 1.03 }, { strokeDashoffset: 0.51 }], c.dim + i * 0.14, 0.3, 'ease-out');
            s.anim(e, [{ strokeDashoffset: 0.51 }, { strokeDashoffset: 0 }], c.dbl, (hit - c.dbl) * 0.7, 'ease-in-out');
          });
          const dims = s.tag('3 dimensions', { x: cx, y: 270, at: c.dim, bg: '#ffd66b', size: 54 });
          s.hide(dims, c.dbl, 0.2);
          s.m.look(dims, c.dim, 1.2);
          const rule = s.words(['Volume', '×', 'k<sup>3</sup>'], { x: 850, y: 150, size: 100, color: s.ink.yellow, times: [c.vol, c.word('scales'), c.cu] });
          s.mark(rule.w[2], c.cu, { hold: 1.2 });
          s.m.point(rule.w[2], c.cu, 1);
          [2, 1, 0, 4, 5, 6, 7].forEach((n, i) => s.pop(cubes[n], c.dbl + ((hit - c.dbl) * i) / 7, { gain: 0.35 }));
          s.m.look({ x: cx, y: cy }, c.dbl, 1.4);
          s.text('2', { x: 160, y: 556, size: 76, color: s.ink.yellow, at: c.si, dur: 0.15 });
          s.text('2', { x: 440, y: 556, size: 76, color: s.ink.yellow, at: c.si + 0.1, dur: 0.15 });
          s.text('2', { x: 344, y: 400, size: 76, color: DARK, at: c.si + 0.2, dur: 0.15 });
          const two = s.words(['Volume', '×', '2<sup>3</sup>'], { x: 850, y: 310, size: 100, times: [c.dbl, c.si, c.word('cube', 1)] });
          s.mark(two.w[2], hit);
          s.swap(two.w[2], '8', hit, { color: '#1d3a31' });
          s.stars(two.w[2], hit + 0.1, 8);
          s.m.point(two.w[2], hit, 1.1);
          s.m.mood('wow', hit, 1.4);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        gap: 1.4,
        say: `{one}One condition. The {sh}shapes {hv}have to be {sim}similar. {every}Every {ma}matching {len}length scaled by the {same}same amount. {stretch}Stretch {ju}just one {sd}side, {off}and this rule is off.`,
        run(s, c) {
          s.m.mood('hmm', c.one, 2);
          const title = s.words(['Area × k<sup>2</sup>', 'only', 'if', 'similar'], { y: 84, size: 88, times: [c.one, c.hv, c.hv + 0.15, c.sim] });
          s.mark(title.find('similar'), c.sim + 0.28);
          s.m.point(title.find('similar'), c.sim, 0.9);
          const pic = s.shape(buddy(85, 550, 165, 110, '#8fe6cf') + buddy(345, 550, 330, 220, '#8fe6cf') + buddy(770, 550, 165, 110, '#ff9ccf'));
          const [a, b, d] = pic.querySelectorAll('.buddy');
          s.pop(a, c.sh, { gain: 0.5 });
          s.pop(b, c.sh + 0.25, { gain: 0.5 });
          const label = (t, x, y, at) => s.text(t, { x, y, size: 64, at, dur: 0.2 });
          label('3', 167, 368, c.ma);
          label('6', 510, 258, c.ma);
          label('2', 62, 458, c.len);
          label('4', 318, 402, c.len);
          s.tag('similar: all × 2', { x: 510, y: 576, at: c.same, bg: '#8fe6cf', size: 50 });
          s.m.look({ x: 510, y: 450 }, c.every, 1.8);

          s.pop(d, c.stretch, { gain: 0.5 });
          const top3 = label('3', 852, 368, c.stretch);
          const side2 = label('2', 742, 458, c.stretch);
          const body = d.querySelector('.body');
          body.style.transformBox = 'fill-box';
          body.style.transformOrigin = '0% 100%';
          const pull = Math.max(0.6, c.off - c.ju);
          s.anim(body, [{ scale: '1 1' }, { scale: '2 1' }], c.ju, pull, 'cubic-bezier(.4,1.2,.5,1)');
          s.sfx('boing', c.ju, 0.7);
          s.hide(top3, c.sd, 0.15);
          label('6', 935, 368, c.sd);
          s.m.point({ x: 935, y: 490 }, c.stretch, 1);
          s.circle(side2, c.off, { color: s.ink.red, pad: 10 });
          s.tag('not similar', { x: 935, y: 576, at: c.off, bg: '#ff8080', size: 50 });
          s.strike(title.w[0], c.word('off'));
          s.m.act('shake', c.off, 0.8);
          s.m.mood('oops', c.off, 1.4);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        gap: 1.4,
        say: `{u}And watch your units. {pl}Plain units for {len}length. {sq}Square units for {ar}area. {cu}Cubic units for {vo}volume. {bye}Now hit Try this skill, and go scale something!`,
        run(s, c) {
          s.spoken('Watch your units', c, c.word('watch'), { y: 80, size: 88, color: s.ink.yellow });
          const pic = s.shape(`<path class="ruler" d="M160,255 H280 M160,235 V275 M280,235 V275" fill="none" stroke="#f5f3ea" stroke-width="8" stroke-linecap="round"/>
            <rect class="tile" x="172" y="337" width="96" height="96" rx="8" fill="#8fe6cf"/>${iso(220, 515, 60)}`);
          const row = (words, y, color, times) => s.words(words, { x: 350, y, size: 100, align: 'left', color, times });
          s.draw(pic.get('.ruler'), c.pl, 0.4);
          row(['cm', 'for', 'length'], 200, s.ink.white, [c.pl, c.word('for'), c.len]);
          s.pop(pic.get('.tile'), c.sq, { gain: 0.6 });
          const area = row(['cm<sup>2</sup>', 'for', 'area'], 330, s.ink.teal, [c.sq, c.word('for', 1), c.ar]);
          s.mark(area.w[0], c.sq, { color: s.ink.teal, hold: 1.1 });
          s.pop(pic.get('.cube'), c.cu, { gain: 0.6 });
          const volume = row(['cm<sup>3</sup>', 'for', 'volume'], 460, s.ink.yellow, [c.cu, c.word('for', 2), c.vo]);
          s.mark(volume.w[0], c.cu, { hold: 1.1 });
          s.m.point({ x: 220, y: 385 }, c.sq, 0.8);
          s.m.point({ x: 220, y: 515 }, c.cu, 0.8);
          s.m.mood('proud', c.cu, 3);
          s.tag('Next: Try this skill', { x: 614, y: 610, at: c.word('Try'), bg: '#ffd66b', size: 56 });
          s.m.act('wave', c.bye, 2.1);
          s.confetti(c.bye + 0.6);
        },
      },
    ],
  });
})();
