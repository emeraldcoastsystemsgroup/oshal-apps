/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Read axes and units first: a bubbling flask gives way to a chart under a sliding lens, table rows fly onto a graph, a real experiment (stopwatch, thermometer rising, water on a flame) fills the table as it is read, the same row-then-across move runs on the table and the graph side by side, a dot slides to the halfway point, a line wags and fans out past the data at two hours, and a broken axis and a logarithmic axis show one distance meaning different amounts
 */
(function () {
  /** Colors keep one meaning all lesson: yellow is what is measured, pink is its units, teal is the working. */
  const WHITE = '#f5f3ea', YELLOW = '#ffd66b', PINK = '#ff9ccf', TEAL = '#8fe6cf', BLUE = '#9fd0ff', RED = '#ff8080', DARK = '#173a30';
  const WOOD = '#c9915a', HOT = '#ff6b6b', FLAME = '#ffb066';
  const SMOOTH = 'cubic-bezier(.45,.05,.3,1)';

  /** The lesson's measurements: minutes and degrees. */
  const DATA = [[10, 18], [20, 22], [30, 26]];

  /** The worked table on the left of the board, with the experiment to its right. */
  const TABLE = { left: 50, right: 800, top: 84, bottom: 520, rule: 172, split: 372, colA: 205, colB: 586, rowY: 184, rowH: 108 };
  /** The graph of the worked example. Its right edge leaves a column free for working. */
  const GRAPH = { x: 130, y: 90, w: 620, h: 490, xMax: 40, yMax: 30, xStep: 10, yStep: 10, xName: 'minutes', yName: 'degrees' };
  /** The same graph stretched out to two hours, so it is plain how far past the data that is. */
  const WIDE = { x: 130, y: 150, w: 950, h: 420, xMax: 120, yMax: 70, xStep: 30, yStep: 20, xName: 'minutes', yName: 'degrees' };
  /** The bar chart on the scales page: its axis, floor and top in board pixels. */
  const BAR = { axis: 170, top: 270, floor: 650, cut: 580, a: 96, b: 100, cutValue: 95 };

  const fade = (s, node, t, dur = 0.25) => s.anim(node, [{ opacity: 1 }, { opacity: 0 }], t, dur);

  /** A heart around the point x, y, for the monster's love of a good graph. */
  function heartPath(x, y) {
    return `M${x},${y - 14} C${x - 10},${y - 40} ${x - 50},${y - 34} ${x - 50},${y - 4} C${x - 50},${y + 26} ${x - 14},${y + 46} ${x},${y + 66} C${x + 14},${y + 46} ${x + 50},${y + 26} ${x + 50},${y - 4} C${x + 50},${y - 34} ${x + 10},${y - 40} ${x},${y - 14} Z`;
  }

  /** The two chalk rules of a table, drawing themselves. */
  function rules(s, { left, right, top, bottom, rule, split }, t) {
    const g = s.shape(`<g fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round"><path class="h" d="M${left},${rule} H${right}"/><path class="v" d="M${split},${top} V${bottom}"/></g>`);
    s.draw(g.get('.h'), t, 0.4);
    s.draw(g.get('.v'), t + 0.2, 0.4);
    return g;
  }

  /** Bubbles that keep rising from their spots, each one reused in turn, for as long as something heats. */
  function bubbles(s, spots, rise, from, to, color = WHITE) {
    const g = s.shape(spots.map(([x, y, r]) => `<circle class="b" cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity=".85" style="opacity:0"/>`).join(''));
    const dots = [...g.querySelectorAll('.b')];
    const dur = 0.95, step = (dur + 0.05) / dots.length;
    for (let t = from, k = 0; t < to; t += step, k += 1) {
      s.anim(dots[k % dots.length], [{ opacity: 0, translate: '0px 0px' }, { opacity: 1, offset: 0.15 }, { opacity: 0.8, offset: 0.85 }, { opacity: 0, translate: `0px ${rise}px` }], t, dur, 'linear', 'none');
    }
    return g;
  }

  /** The look of hard science: a flask that fizzes and an atom that spins, gone as soon as the charts arrive. */
  function hardScience(s, c) {
    const looks = c.word('looks'), hard = c.word('hard');
    const g = s.shape(`<g class="flask">
        <path d="M131,440 H269 L308,540 Q316,560 294,560 H106 Q84,560 92,540 Z" fill="${PINK}"/>
        <path d="M156,250 H244 M172,250 V340 L92,540 Q84,560 106,560 H294 Q316,560 308,540 L228,340 V250" fill="none" stroke="${WHITE}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g class="atom" fill="none" stroke="${BLUE}" stroke-width="7">
        <ellipse cx="470" cy="300" rx="118" ry="42"/><ellipse cx="470" cy="300" rx="118" ry="42" transform="rotate(60 470 300)"/><ellipse cx="470" cy="300" rx="118" ry="42" transform="rotate(120 470 300)"/>
        <circle cx="470" cy="300" r="19" fill="${YELLOW}" stroke="none"/>
        <circle cx="588" cy="300" r="11" fill="${WHITE}" stroke="none"/><circle cx="411" cy="198" r="11" fill="${WHITE}" stroke="none"/><circle cx="411" cy="402" r="11" fill="${WHITE}" stroke="none"/>
      </g>`);
    const atom = g.get('.atom');
    s.pop(g.get('.flask'), looks, { gain: 0.6 });
    s.pop(atom, hard, { gain: 0.6 });
    s.turn(atom, 75, hard, c.most - hard + 0.3, { origin: '470px 300px', easing: 'linear' });
    const fizz = bubbles(s, [[165, 540, 10], [200, 548, 13], [232, 536, 9], [186, 520, 11], [218, 515, 8]], -250, looks, c.most, WHITE);
    const tag = s.tag('hard science?', { x: 300, y: 590, at: hard, bg: RED, size: 56 });
    [g, fizz, tag].forEach((n) => s.hide(n, c.most, 0.25));
  }

  /** "I love a good graph": a heart, then a little chart, drawn where the close-up can see them. */
  function lovedChart(s, c) {
    const heart = s.shape(`<path class="h" d="${heartPath(905, 238)}" fill="${RED}"/>`).get('.h');
    s.pop(heart, c.word('love'), { gain: 0.6 });
    s.hide(heart, c.act, 0.2);
    const g = s.plot({ x: 690, y: 310, w: 420, h: 250, xMax: 40, yMax: 30, xStep: 10, yStep: 10, xName: 'minutes', yName: 'degrees', at: c.word('good') - 0.1 });
    g.line(10, 18, 30, 26, c.word('graph'), { dur: 0.5 });
    DATA.forEach(([m, d], i) => g.dot(m, d, c.word('graph') + i * 0.14, { r: 12 }));
    return g;
  }

  /** A lens slides along the axis while the monster says how carefully to read it. */
  function lensOverAxis(s, c, x0, x1, y) {
    const lens = s.shape(`<g class="lens"><path d="M50,50 L104,104" stroke="${WOOD}" stroke-width="20" stroke-linecap="round"/><circle r="70" fill="rgba(200,240,255,.2)" stroke="${WOOD}" stroke-width="12"/></g>`).get('.lens');
    lens.style.translate = `${x0}px ${y}px`;
    s.appear(lens, c.word('charts'), 0.2);
    s.anim(lens, [{ translate: `${x0}px ${y}px` }, { translate: `${x1}px ${y}px` }], c.word('very'), c.word('carefully') - c.word('very') + 0.45, SMOOTH);
    s.sfx('whoosh', c.word('very'), 0.5);
  }

  /** Each table row flies across the board and lands as its dot on the graph. */
  function flyDots(s, g, starts, t, step = 0.16) {
    return DATA.map(([m, d], i) => {
      const at = t + i * step, to = g.box(m, d);
      const dot = g.dot(m, d, at, { r: 14 });
      s.anim(dot, [{ translate: `${starts[i].x - to.x}px ${starts[i].y - to.y}px` }, { translate: '0px 0px' }], at, 0.45, SMOOTH);
      return dot;
    });
  }

  /** The small table on the idea page: numbers only, until the monster says to read what they measure. */
  function bareTable(s, t) {
    rules(s, { left: 60, right: 530, top: 84, bottom: 440, rule: 214, split: 292 }, t);
    DATA.forEach(([m, d], i) => {
      s.text(String(m), { x: 175, y: 222 + i * 70, size: 68, at: t + i * 0.07, dur: 0.14, quiet: true });
      s.text(String(d), { x: 410, y: 222 + i * 70, size: 68, at: t + i * 0.07, dur: 0.14, quiet: true });
    });
    return DATA.map((row, i) => ({ x: 530, y: 258 + i * 70 }));
  }

  /** The names go on while "read" is said, and the units when "units" is. */
  function nameEverything(s, c) {
    const unitAt = c.word('units');
    const timeT = s.text('Time', { x: 175, y: 84, size: 64, color: YELLOW, at: c.read, dur: 0.25 });
    const tempT = s.text('Temp', { x: 410, y: 84, size: 64, color: YELLOW, at: c.read, dur: 0.25 });
    s.text('(min)', { x: 175, y: 142, size: 60, color: PINK, at: unitAt, dur: 0.25, quiet: true });
    s.text('(degrees)', { x: 410, y: 142, size: 60, color: PINK, at: unitAt, dur: 0.25, quiet: true });
    const onY = s.words(['Temp', '(degrees)'], { x: 650, y: 78, size: 66, align: 'left', color: YELLOW, times: [c.read, unitAt] });
    const onX = s.words(['Time', '(minutes)'], { x: 900, y: 450, size: 66, color: YELLOW, times: [c.read, unitAt] });
    [onY, onX].forEach((label) => { label.w[1].style.color = PINK; });
    return { timeT, tempT, onY, onX };
  }

  /** The stopwatch: its hand sweeps a sixth of the way round for each ten minutes. */
  function stopwatch(s, x, y, r, t) {
    const marks = [0, 60, 120, 180, 240, 300].map((a) => `<path d="M${x},${y - r + 7} V${y - r + 21}" stroke="${DARK}" stroke-width="6" stroke-linecap="round" transform="rotate(${a} ${x} ${y})"/>`).join('');
    const g = s.shape(`<g class="watch"><rect x="${x - 15}" y="${y - r - 26}" width="30" height="24" rx="6" fill="${WOOD}"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${WHITE}" stroke="${WOOD}" stroke-width="10"/>${marks}
      <path class="hand" d="M${x},${y + 10} V${y - r + 24}" stroke="#e0456b" stroke-width="8" stroke-linecap="round"/>
      <circle cx="${x}" cy="${y}" r="9" fill="${DARK}"/></g>`);
    s.pop(g.get('.watch'), t, { gain: 0.6 });
    const hand = g.get('.hand');
    return { to: (deg, at) => s.turn(hand, deg, at, 0.55, { origin: `${x}px ${y}px` }) };
  }

  /** A beaker on a flame with a thermometer standing in it. The liquid is a bar, so it can rise and fall. */
  function heatedWater(s, t) {
    const x = 1000, top = 110, bottom = 520;
    const py = (deg) => bottom - (deg / 30) * (bottom - top);
    const scale = [10, 20, 30].map((d) => `<path d="M${x + 22},${py(d)} H${x + 36}" stroke="${WHITE}" stroke-width="5"/><text x="${x + 42}" y="${py(d) + 16}" font-size="46" font-family="Chalk" fill="${WHITE}">${d}</text>`).join('');
    const g = s.shape(`<g class="lab">
        <path d="M884,470 H1116 V592 Q1116,612 1096,612 H904 Q884,612 884,592 Z" fill="${BLUE}" fill-opacity=".38"/>
        <path d="M874,416 H884 V592 Q884,612 904,612 H1096 Q1116,612 1116,592 V416 H1126" fill="none" stroke="${WHITE}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M${x - 18},${bottom + 8} V${top + 2} A18,18 0 0 1 ${x + 18},${top + 2} V${bottom + 8}" fill="rgba(245,243,234,.14)" stroke="${WHITE}" stroke-width="6"/>
        <circle cx="${x}" cy="${bottom + 26}" r="30" fill="${HOT}" stroke="${WHITE}" stroke-width="6"/>${scale}
      </g>
      <g class="flame"><path d="M1000,626 C1040,664 1046,686 1000,704 C954,686 960,664 1000,626 Z" fill="${FLAME}"/><path d="M1000,656 C1020,676 1020,690 1000,700 C980,690 980,676 1000,656 Z" fill="${YELLOW}"/></g>
      <rect x="950" y="704" width="100" height="18" rx="9" fill="${WOOD}"/>`);
    const flame = g.get('.flame');
    s.pop(g.get('.lab'), t, { gain: 0.6 });
    s.pop(flame, t + 0.1, { gain: 0.3 });
    flame.style.transformOrigin = '50% 100%';
    const fluid = s.bars([10], { x: x - 11, y: top, w: 22, h: bottom - top, max: 30, colors: [HOT], at: t });
    return { fluid, flame };
  }

  /** The water keeps simmering while the page is up. */
  function simmer(s, lab, from, to) {
    const frames = [];
    for (let i = 0; i <= Math.ceil((to - from) / 0.14); i += 1) frames.push({ scale: i % 2 ? '1.06 1.14' : '.94 .9' });
    s.anim(lab.flame, frames, from, to - from, 'linear', 'none');
    bubbles(s, [[920, 596, 8], [1060, 600, 10], [950, 590, 6], [1090, 596, 7], [1040, 604, 6], [905, 600, 7]], -120, from, to);
  }

  /** The working table, written as it is read aloud. The experiment on its right runs in step with it. */
  function fillTable(s, c, v) {
    const { colA, colB, rowY, rowH } = TABLE;
    const heads = [
      s.words(['Time', '(min)'], { x: colA, y: 84, size: 72, color: YELLOW, times: [c.t, c.word('minutes')] }),
      s.words(['Temp', '(degrees)'], { x: colB, y: 84, size: 72, color: YELLOW, times: [c.d, c.word('degrees')] }),
    ];
    heads.forEach((h) => { h.w[1].style.color = PINK; });
    s.mark(heads[0].w[0], c.t, { hold: 1 });
    s.mark(heads[1].w[0], c.d, { hold: 1 });
    s.m.point(heads[0].w[0], c.t, 0.9);
    s.m.point(heads[1].w[0], c.d, 0.9);
    const said = [[c.a, c.word('eighteen')], [c.b, c.word('twenty-two')], [c.e, c.word('twenty-six')]];
    v.rows = DATA.map(([m, d], i) => [
      s.text(String(m), { x: colA, y: rowY + i * rowH, size: 100, at: said[i][0], dur: 0.2 }),
      s.text(String(d), { x: colB, y: rowY + i * rowH, size: 100, at: said[i][1], dur: 0.2 }),
    ]);
    v.watch = stopwatch(s, 905, 205, 76, c.t);
    v.lab = heatedWater(s, c.d);
    DATA.forEach(([, d], i) => {
      v.watch.to(60 * (i + 1), said[i][0]);
      v.lab.fluid.setTo(0, d, said[i][1], 0.55);
    });
    simmer(s, v.lab, c.d + 0.2, c.end + 0.2);
    v.heat = c.end + 0.2;
  }

  /** The table on the right of the graph page, doing the same moves as the graph beside it. */
  function sideTable(s, t) {
    rules(s, { left: 850, right: 1170, top: 90, bottom: 460, rule: 170, split: 985 }, t);
    s.text('min', { x: 917, y: 92, size: 60, color: PINK, at: t, dur: 0.2, quiet: true });
    s.text('degrees', { x: 1077, y: 92, size: 60, color: PINK, at: t, dur: 0.2, quiet: true });
    return DATA.map(([m, d], i) => [
      s.text(String(m), { x: 917, y: 182 + i * 92, size: 84, at: t + 0.1, dur: 0.15, quiet: true }),
      s.text(String(d), { x: 1077, y: 182 + i * 92, size: 84, at: t + 0.1, dur: 0.15, quiet: true }),
    ]);
  }

  /** The answer found on the graph: a dot walks up from the axis to the line, then across to the other axis. */
  function walkTheGraph(s, c, g, side) {
    const twenty = c.word('twenty');
    const up = Math.max(0.5, c.word('line') - c.up + 0.15), across = Math.max(0.5, c.ans - c.ac - 0.15);
    const start = g.box(20, 0), end = g.box(0, 22);
    s.tag('20', { x: start.x, y: start.y + 6, at: twenty, bg: TEAL, size: 54 });
    s.mark(side[1][0], twenty, { color: TEAL });
    g.line(20, 0, 20, 22, c.up, { color: TEAL, dur: up });
    g.line(20, 22, 0, 22, c.ac, { color: TEAL, dur: across });
    const walker = g.dot(20, 0, twenty, { color: TEAL, r: 19 });
    s.move(walker, 0, g.py(22) - g.py(0), c.up, up, 'linear');
    s.move(walker, g.px(0) - g.px(20), 0, c.ac, across, 'linear');
    s.arrow(side[1][0], side[1][1], c.ac, { curve: 0, color: YELLOW, width: 8, gap: 8, head: 18 });
    const tag = s.tag('22', { x: GRAPH.x - 52, y: end.y - 38, at: c.ans, bg: YELLOW, size: 62 });
    s.mark(side[1][1], c.ans);
    s.stars(tag, c.ans + 0.1, 8);
    s.m.point(start, twenty, 0.9);
    s.m.point(g.box(20, 22), c.up, 0.9);
    s.m.mood('happy', c.ans, 1.4);
  }

  /** Why twenty: dots slide along the line and meet in the middle, then equal steps show the line is steady. */
  function whyTwenty(s, c, g) {
    const halfway = c.word('halfway');
    [[10, 18], [20, 22]].forEach(([m, d]) => {
      const dot = g.dot(m, d, halfway - 0.02, { color: YELLOW, r: 12 });
      s.move(dot, g.px(15) - g.px(m), g.py(20) - g.py(d), halfway, Math.max(0.45, c.word('points') - halfway));
    });
    const line = s.text('halfway', { x: 995, y: 276, size: 88, at: halfway, dur: 0.3 });
    s.mark(line, halfway, { color: TEAL, hold: 1 });
    const stepAt = [c.word('line'), c.word('steady')];
    [[10, 18, 20, 22], [20, 22, 30, 26]].forEach(([x0, y0, x1, y1], i) => {
      g.line(x0, y0, x1, y0, stepAt[i], { color: WHITE, width: 6, dur: 0.18 });
      g.line(x1, y0, x1, y1, stepAt[i] + 0.16, { color: WHITE, width: 6, dur: 0.14 });
      const b = g.box(x1, (y0 + y1) / 2);
      s.tag('+4', { x: b.x + 58, y: b.y - 28, at: stepAt[i] + 0.2, bg: TEAL, size: 44 });
    });
    const steady = s.text('steady', { x: 995, y: 384, size: 88, at: c.word('steady'), dur: 0.3 });
    s.mark(steady, c.word('steady'), { color: YELLOW });
  }

  /** Inside the data: the band, the dot we just found, and how safe it is. */
  function insideData(s, c, g) {
    const named = c.word('interpolation');
    g.line(10, 18, 30, 26, c.in, { dur: 0.4 });
    DATA.forEach(([m, d], i) => g.dot(m, d, c.in + 0.1 + i * 0.1, { r: 12 }));
    s.tag('interpolation', { x: 300, y: 74, at: named, bg: TEAL, size: 54 });
    g.dot(15, 20, named, { color: TEAL, r: 15 });
    g.shade(10, 30, c.word('inside'), { color: TEAL, alpha: 0.26 });
    s.tag('pretty safe', { x: 300, y: 158, at: c.word('safe'), bg: TEAL, size: 46 });
    s.m.point(g.box(20, 22), c.word('inside'), 1.2);
    s.m.mood('happy', c.word('safe'), 1);
  }

  /** Swing a line about its first point, as if nobody can say where it goes. */
  function wag(s, node, x, y, t, dur) {
    node.style.transformBox = 'view-box';
    node.style.transformOrigin = `${x}px ${y}px`;
    s.anim(node, [0, -7, 20, -5, 15, -3, 7, 0].map((deg) => ({ rotate: `${deg}deg` })), t, dur, 'ease-in-out');
    s.sfx('boing', t, 0.4);
  }

  /** Past the data: the band sweeps out to two hours, the line follows, wags, and then fans out. */
  function beyondData(s, c, g) {
    const go = c.word('beyond'), reach = c.word('hours') - go;
    const band = g.shade(30, 120, go, { color: PINK, alpha: 0.2 });
    s.grow(band, go, reach, { from: '0 1', to: '1 1', origin: '0% 50%', easing: SMOOTH });
    const line = g.line(30, 26, 120, 62, go, { color: PINK, dur: reach });
    const tick = [...g.svg.querySelectorAll('.ticks text')].find((n) => n.textContent === '120');
    s.circle(tick, c.word('two'), { color: YELLOW, pad: 12 });
    s.tag('2 hours', { x: 1000, y: 628, at: c.word('two'), bg: YELLOW, size: 50 });
    const named = s.tag('extrapolation', { x: 720, y: 74, at: c.word('extrapolation'), bg: PINK, size: 54 });
    s.m.point(named, c.ex, 1.1);
    const swing = c.word('uncertain');
    wag(s, line, g.px(30), g.py(26), swing, Math.max(0.8, c.word('trend') - swing));
    s.tag('uncertain', { x: 720, y: 158, at: swing, bg: PINK, size: 46 });
    s.m.mood('hmm', swing, 1.2);
    const fan = s.shape(`<g fill="none" stroke="${PINK}" stroke-width="8" stroke-linecap="round">
      <path class="flat" d="M${g.px(30)},${g.py(26)} C${g.px(55)},${g.py(36)} ${g.px(80)},${g.py(38)} ${g.px(120)},${g.py(38)}"/>
      <path class="fall" d="M${g.px(30)},${g.py(26)} C${g.px(58)},${g.py(32)} ${g.px(85)},${g.py(22)} ${g.px(120)},${g.py(8)}"/></g>`, { x: WIDE.x, y: WIDE.y, w: WIDE.w, h: WIDE.h });
    const trend = c.word('trend');
    s.draw(fan.get('.flat'), trend, 0.55);
    s.draw(fan.get('.fall'), trend + 0.15, 0.55);
    [62, 38, 8].forEach((d, i) => {
      const end = g.box(120, d);
      s.text('?', { x: end.x + 22, y: end.y - 42, size: 72, color: YELLOW, at: trend + 0.45 + i * 0.1, dur: 0.12, quiet: true });
    });
    s.m.act('shrug', c.word('not'), 1);
  }

  /** The legend names the colors, so the bars cannot be read without it. */
  function legend(s, t) {
    const key = s.shape(`<rect x="110" y="178" width="44" height="40" rx="7" fill="${PINK}"/><rect x="340" y="178" width="44" height="40" rx="7" fill="${BLUE}"/>`);
    s.appear(key, t, 0.2);
    const a = s.text('tank A', { x: 164, y: 164, size: 62, align: 'left', at: t, dur: 0.2, quiet: true });
    const b = s.text('tank B', { x: 394, y: 164, size: 62, align: 'left', at: t + 0.1, dur: 0.2, quiet: true });
    return { key, a, b };
  }

  /** Two bars almost level on a true axis. Break the axis and the same two numbers look worlds apart. */
  function brokenChart(s, c) {
    const { axis, top, floor, cut, a, b, cutValue } = BAR;
    const drawn = c.word('axis'), broke = c.word('broken');
    const lines = s.shape(`<g fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path class="upper" d="M${axis},${top - 14} V${cut}"/><path class="lower" d="M${axis},${cut} V${floor}"/><path class="floor" d="M${axis},${floor} H560"/>
      <path class="zig" d="M${axis},${cut} l-22,9 l44,14 l-44,14 l44,14 l-22,8 V${floor}" stroke="${RED}" stroke-width="9"/></g>`);
    ['.upper', '.lower', '.floor'].forEach((k) => s.draw(lines.get(k), drawn, 0.3, { gain: 0.25 }));
    const trueAt = (value) => floor - (value / b) * (floor - top);
    const brokenAt = (value) => cut - ((value - cutValue) / (b - cutValue)) * (cut - top);
    const bars = s.bars([a, b], { x: 215, y: top, w: 300, h: floor - top, max: b, gap: 40, colors: [PINK, BLUE], at: c.word('scales') - 0.1, per: 0 });
    const labelA = s.text(String(a), { x: 280, y: trueAt(a) + 6, size: 68, color: DARK, at: c.word('scales') + 0.1, dur: 0.15, quiet: true });
    s.text(String(b), { x: 450, y: top + 6, size: 68, color: DARK, at: c.word('scales') + 0.1, dur: 0.15, quiet: true });
    const ticks = (text, y, at) => s.text(text, { x: 152, y: y - 36, size: 60, align: 'right', at, dur: 0.15, quiet: true });
    ticks('100', top, drawn);
    ticks('0', floor, drawn);
    const half = ticks('50', trueAt(50), drawn);
    s.hide(lines.get('.lower'), broke, 0.1);
    s.hide(half, broke, 0.15);
    s.draw(lines.get('.zig'), broke, 0.3);
    ticks('95', cut, broke + 0.1);
    const low = ((floor - brokenAt(a)) / (floor - top)) * b;
    bars.setTo(0, low, broke, 0.6);
    s.move(labelA, 0, brokenAt(a) - trueAt(a), broke, 0.6);
    s.tag('broken scale', { x: 330, y: 158, at: broke, bg: RED, size: 56 });
    s.m.point({ x: axis, y: cut + 30 }, broke, 0.8);
  }

  /** A logarithmic axis: one ruler hops along equal gaps, and each gap is worth ten times the last. */
  function logAxis(s, c) {
    const y = 430, xs = [660, 810, 960, 1110], named = c.word('logarithmic');
    const g = s.shape(`<path class="axis" d="M630,${y} H1125" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round"/>
      ${xs.map((x) => `<path class="tick" d="M${x},${y - 16} V${y + 16}" stroke="${WHITE}" stroke-width="7" stroke-linecap="round"/>`).join('')}
      <rect class="ruler" x="${xs[0]}" y="536" width="150" height="20" rx="10" fill="${YELLOW}"/>`);
    s.draw(g.get('.axis'), named, 0.3, { gain: 0.3 });
    s.tag('logarithmic', { x: 875, y: 158, at: named, bg: BLUE, size: 56 });
    ['1', '10', '100', '1000'].forEach((label, i) => s.text(label, { x: xs[i], y: y + 22, size: 66, color: YELLOW, at: named + i * 0.12, dur: 0.12, quiet: true }));
    const hops = [[c.word('changes'), '+9', 46, 292], [c.word('distance'), '+90', 54, 278], [c.word('graph'), '+900', 66, 256]];
    const ruler = g.get('.ruler');
    s.appear(ruler, hops[0][0], 0.15);
    hops.forEach(([t, text, size, top], i) => {
      if (i) s.move(ruler, 150, 0, t - 0.08, 0.28);
      s.arrow({ x: xs[i], y: y - 22 }, { x: xs[i + 1], y: y - 22 }, t, { curve: -0.3, color: PINK, width: 7, gap: 2, head: 18, dur: 0.26 });
      s.tag(text, { x: xs[i] + 75 + (i === 2 ? 14 : 0), y: top, at: t + 0.14, bg: PINK, size });
    });
    s.m.look({ x: 880, y: 420 }, named, 1.2);
  }

  LessonStudio.define({
    id: 'science-data',
    teacher: 'sprout',
    title: 'Read axes and units first',
    facts: [
      ['(18 + 22) / 2', 20],
      ['(10 + 20) / 2', 15],
      ['22 - 18', 4],
      ['26 - 22', 4],
      ['2 * 60', 120],
      ['10 - 1', 9],
      ['100 - 10', 90],
      ['1000 - 100', 900],
    ],
    beats: [
      {
        say: `{hi}Hi! I'm Sprout, and I love a good graph. {act}ACT science looks like hard science. {most}A lot of it is reading charts very carefully.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.8);
          s.wideCam(c.act - 0.3, 1.1);
          const chart = lovedChart(s, c);
          hardScience(s, c);
          s.m.mood('wow', c.word('hard'), 1);
          s.m.mood('sly', c.most, 2);
          s.move(chart.svg, -330, 0, c.most, 0.6);
          s.grow(chart.svg, c.most, 0.6, { from: '1 1', to: '1.35 1.35', origin: '0% 100%' });
          s.text('Read axes and units first', { y: 46, size: 92, color: YELLOW, at: c.word('reading'), dur: 1 });
          s.m.point({ x: 640, y: 400 }, c.word('charts'), 0.9);
          lensOverAxis(s, c, 502, 927, 610);
        },
      },
      {
        page: 'The idea',
        say: `{tab}A table or a graph is just measurements. {before}So before comparing anything, {read}read what's being measured, {un}and its units.`,
        run(s, c) {
          const starts = bareTable(s, c.word('table'));
          const graph = c.word('graph');
          const g = s.plot({ x: 700, y: 165, w: 400, h: 225, xMax: 40, yMax: 30, xStep: 10, yStep: 10, at: graph - 0.1 });
          flyDots(s, g, starts, graph);
          g.line(10, 18, 30, 26, c.word('just'), { dur: 0.4 });
          s.m.look('board', c.tab, 1.4);
          const just = s.spoken('just measurements', c, c.word('just'), { y: 545, size: 100, color: TEAL });
          s.hide(just, c.before, 0.2);
          const before = s.words(['Before', 'comparing', 'anything:'], { y: 545, size: 88, times: [c.word('before'), c.word('comparing'), c.word('anything')] });
          s.hide(before, c.read, 0.15);
          const read = s.spoken("read what's being measured", c, c.read, { x: 540, y: 530, size: 82, color: YELLOW });
          const units = s.spoken('and its units', c, c.un, { x: 540, y: 632, size: 82, color: PINK });
          const names = nameEverything(s, c);
          const measured = c.word('measured');
          s.mark(read.find('measured'), measured, { hold: 1.2 });
          s.mark(names.onY.w[0], measured, { hold: 1.2 });
          s.mark(names.onX.w[0], measured + 0.1, { hold: 1.2 });
          s.mark(units.find('units'), c.word('units'), { color: PINK });
          s.mark(names.onY.w[1], c.word('units'), { color: PINK });
          s.mark(names.onX.w[1], c.word('units') + 0.1, { color: PINK });
          s.m.point(names.onY.w[0], c.read, 1);
          s.m.mood('happy', c.un, 1);
        },
      },
      {
        page: 'Watch me',
        say: `{r}Here's a table. {t}Time, in minutes. {d}Temperature, in degrees. {a}Ten minutes, eighteen degrees. {b}Twenty minutes, twenty-two. {e}Thirty minutes, twenty-six.`,
        run(s, c, v) {
          rules(s, TABLE, c.r);
          fillTable(s, c, v);
          s.m.look('board', c.a, 4);
        },
      },
      {
        say: `{q}Question: what's the temperature at twenty minutes? {dont}Don't read everything. {go}Go straight to the row. {tw}Twenty minutes. {ac}Across. {ans}Twenty-two degrees.`,
        run(s, c, v) {
          const [left, right] = v.rows[1];
          simmer(s, v.lab, v.heat, c.end + 0.6);
          const ask = s.words(['Q:', 'Temp', 'at', '20', 'minutes?'], { x: 56, y: 540, size: 92, align: 'left', times: [c.q, c.word('temperature'), c.word('at'), c.word('twenty'), c.word('minutes')] });
          ask.w[0].style.color = TEAL;
          s.mark(ask.find('Temp'), c.word('temperature'), { hold: 1.4 });
          s.mark(ask.find('20'), c.word('twenty'), { hold: 1.4 });
          s.m.point(ask.find('20'), c.word('twenty'), 0.8);
          s.m.act('shake', c.dont, 0.7);
          [v.rows[0], v.rows[2]].flat().forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0.32 }], c.word('everything'), 0.3));
          const box = s.frame({ x: 62, y: 178, w: 730, h: 336 }, c.go);
          box.to({ x: 62, y: 286, w: 730, h: 112 }, c.word('row'), 0.45);
          s.m.point(left, c.tw, 0.9);
          s.mark(left, c.tw);
          v.watch.to(120, c.tw);
          s.arrow(left, right, c.ac, { curve: 0, color: YELLOW, width: 9 });
          s.mark(right, c.ans);
          v.lab.fluid.setTo(0, 22, c.ans, 0.55);
          s.stars(right, c.ans + 0.2, 8);
          s.m.act('thumbs', c.ans, 1.2);
        },
      },
      {
        page: 'Same on a graph',
        chipColor: '#9fd0ff',
        say: `{same}On a graph, it's the same move. {find}Find twenty on the axis. {up}Up to the line. {ac}Across. {ans}Twenty-two.`,
        run(s, c) {
          const g = s.plot({ ...GRAPH, at: c.same - 0.2 });
          const side = sideTable(s, c.same - 0.1);
          flyDots(s, g, DATA.map((row, i) => ({ x: 850, y: 226 + i * 92 })), c.word('graph'));
          g.line(10, 18, 30, 26, c.word('same'), { dur: 0.5 });
          s.m.look('board', c.same, 1.6);
          walkTheGraph(s, c, g, side);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}This one is between the points. {ask}What's the temperature at fifteen minutes, roughly? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const g = s.plot({ ...GRAPH, at: c.go - 0.2 });
          v.g = g;
          g.line(10, 18, 30, 26, c.go + 0.1, { dur: 0.5 });
          const dots = DATA.map(([m, d], i) => g.dot(m, d, c.go + 0.2 + i * 0.12, { r: 14 }));
          g.shade(10, 20, c.a, { color: TEAL, alpha: 0.24 });
          s.pulse(dots[0], c.word('points'), { to: 1.6 });
          s.pulse(dots[1], c.word('points') + 0.1, { to: 1.6 });
          s.m.point(g.box(15, 20), c.a, 1);
          v.ask = s.spoken(["What's", 'the', 'temp', 'at', '15', 'minutes,', 'roughly?'], c, c.ask, { x: 812, y: 150, size: 74, wrap: 372, color: YELLOW });
          s.mark(v.ask.find('15'), c.word('fifteen'));
          const at15 = g.box(15, 0);
          s.tag('15', { x: at15.x, y: at15.y + 6, at: c.word('fifteen'), bg: TEAL, size: 54 });
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}About twenty! {why}It's halfway between the points, and the line is steady.`,
        run(s, c, v) {
          const { g, ask } = v;
          s.hide(ask, c.ans, 0.12);
          whyTwenty(s, c, g);
          g.line(15, 0, 15, 20, c.ans, { color: TEAL, dur: 0.28 });
          g.line(15, 20, 0, 20, c.ans + 0.24, { color: TEAL, dur: 0.24 });
          g.dot(15, 20, c.ans + 0.24, { color: PINK, r: 17 });
          s.words(['About', '20!'], { x: 995, y: 150, size: 100, color: YELLOW, times: [c.word('about'), c.word('twenty')] });
          s.tag('20', { x: GRAPH.x - 52, y: g.box(0, 20).y - 38, at: c.word('twenty'), bg: YELLOW, size: 62 });
          s.stars(g.box(15, 20), c.ans + 0.3, 9);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{in}That's interpolation: inside the data, and pretty safe. {out}Going beyond the data, like at two hours? {ex}That's extrapolation. {un}It's uncertain. {tr}The trend might not continue.`,
        run(s, c) {
          const g = s.plot({ ...WIDE, at: c.in - 0.2 });
          insideData(s, c, g);
          beyondData(s, c, g);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{chk}And check the legends and axis scales. {br}A broken scale, or a logarithmic one, {ch}changes what distance on the graph means.`,
        run(s, c) {
          const check = s.spoken('Check the legends and axis scales', c, c.word('check'), { y: 74, size: 78, color: TEAL });
          s.mark(check.find('legends'), c.word('legends'), { hold: 1 });
          s.mark(check.find('axis'), c.word('axis'), { hold: 1 });
          s.mark(check.find('scales'), c.word('scales'), { hold: 1 });
          const key = legend(s, c.word('legends'));
          s.circle(key.a, c.word('legends') + 0.1, { color: YELLOW, pad: 10 });
          s.m.point(key.a, c.word('legends'), 0.8);
          [key.key, key.a, key.b].forEach((n) => s.hide(n, c.br, 0.15));
          brokenChart(s, c);
          logAxis(s, c);
          s.hide(check, c.ch, 0.15);
          s.text('Same distance, not the same amount!', { y: 74, size: 78, color: PINK, at: c.word('distance'), dur: 0.9 });
          s.m.mood('wow', c.word('distance'), 1.3);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{v}Variables. {u}Units. {th}Then go straight to what the question asks. {bye}Now hit Try this skill!`,
        run(s, c) {
          s.tag('Variables', { x: 320, y: 88, at: c.v, bg: YELLOW, size: 76 });
          s.text('Time, Temp', { x: 320, y: 196, size: 84, at: c.v + 0.1, dur: 0.4 });
          s.tag('Units', { x: 860, y: 88, at: c.u, bg: PINK, size: 76 });
          s.text('min, degrees', { x: 860, y: 196, size: 84, at: c.u + 0.1, dur: 0.4 });
          const go = s.spoken('Then go straight to what the question asks', c, c.th, { x: 590, y: 318, size: 92, wrap: 880, align: 'center', color: TEAL });
          s.mark(go.find('straight'), c.word('straight'), { hold: 1 });
          s.mark(go.find('question'), c.word('question'));
          s.m.point(go.find('question'), c.word('question'), 0.9);
          s.m.mood('proud', c.th, 2.4);
          s.tag('Next: Try this skill', { x: 590, y: 580, at: c.word('Try'), bg: YELLOW, size: 64 });
          s.m.act('wave', c.bye, 1.8);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
