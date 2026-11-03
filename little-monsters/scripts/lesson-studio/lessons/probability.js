/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Count the right sample space: a drawstring bag whose tiles are counted aloud into a fraction, a spinner for equally likely, the monster's paw drawing a tile out so the fraction changes, four coin outcomes flipped into one minus the only failure, and a test question whose little words get highlighted
 */
(function () {
  const RED = '#ff7b8a', BLUE = '#7eb6ff', DARK = '#16352b', CHALK = '#f5f3ea', GOLD = '#ffd66b', TEAL = '#8fe6cf', SILVER = '#d5dce6';
  const TILE = 92, STEP = 104, CARD = 'rgba(245,243,234,.1)';
  const upTo = (n) => [...Array(n).keys()];

  /** Where tile i sits inside the bag, in the bag's own coordinates. */
  const slot = (i) => ({ x: 62 + (i % 5) * STEP, y: 226 + Math.floor(i / 5) * STEP });

  /** The middle of tile i on the board. */
  const mid = (b, i) => ({ x: b.x + slot(i).x + TILE / 2, y: b.y + slot(i).y + TILE / 2 });

  function tileMarkup(i, color) {
    const { x, y } = slot(i);
    return `<g class="tile t${i}"><rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="16" fill="${color}" stroke="${DARK}" stroke-width="4"/></g>`;
  }

  /**
   * A drawstring bag you can see into. The sack draws at `at`, each tile pops on its own time.
   * `hand` adds the monster's arm above the bag; `lift` is a tile kept in front of the arm, so the arm can carry it out.
   */
  function bag(s, red, blue, { x = 24, y = 104, at, redAt = at + 0.2, blueAt = redAt + red * 0.05, per = 0.05, hand = false, lift = -1 }) {
    const colors = [...Array(red).fill(RED), ...Array(blue).fill(BLUE)];
    const sack = 'M246,82 C150,112 34,176 28,300 C22,420 66,506 176,510 H464 C574,506 618,420 612,300 C606,176 490,112 394,82 Z';
    const t = LessonStudio.teachers.pinky;
    const paw = hand ? `<image class="paw" href="../art/monster/arm_open.png" x="130" y="-126" width="400" height="400" style="filter:hue-rotate(${t.hue}deg) saturate(${t.sat}) brightness(${t.light});translate:0px -400px"/>` : '';
    const g = s.shape(`<path class="body" d="${sack}" fill="rgba(226,186,130,.2)"/>
      <path class="edge" d="${sack}" fill="none" stroke="${CHALK}" stroke-width="7" stroke-linejoin="round"/>
      <path class="folds" d="M292,96 C282,122 268,146 250,166 M348,96 C352,124 352,146 346,172 M392,96 C404,122 420,146 440,162" fill="none" stroke="rgba(245,243,234,.5)" stroke-width="5" stroke-linecap="round"/>
      ${colors.map((color, i) => (i === lift ? '' : tileMarkup(i, color))).join('')}
      ${paw}
      <g class="neck"><path d="M246,82 C226,54 214,26 238,14 C272,0 368,0 402,14 C426,26 414,54 394,82 Z" fill="#d7ae78" stroke="${CHALK}" stroke-width="6" stroke-linejoin="round"/>
      <rect x="232" y="68" width="176" height="24" rx="12" fill="${GOLD}" stroke="${DARK}" stroke-width="3"/></g>
      ${lift >= 0 ? tileMarkup(lift, colors[lift]) : ''}`, { x, y, w: 640, h: 520 });
    s.appear(g.get('.body'), at, 0.3);
    s.appear(g.get('.folds'), at + 0.3, 0.2);
    s.appear(g.get('.neck'), at + 0.2, 0.2);
    s.draw(g.get('.edge'), at, 0.5);
    const list = colors.map((_, i) => g.querySelector('.t' + i));
    list.forEach((n, i) => s.pop(n, i < red ? redAt + i * per : blueAt + (i - red) * per, { gain: 0.26 }));
    return { g, list, x, y, paw: hand ? g.get('.paw') : null };
  }

  /**
   * Move the paw through [time, x, y] stops. y 0 is its deepest; -400 is out of sight above the board.
   * Stops are tied to spoken words, so a quick take could put two out of order; keep them in order.
   */
  function pawPath(s, b, stops) {
    let last = stops[0][0];
    const times = stops.map(([t]) => (last = Math.max(last, t)));
    const t0 = times[0], dur = last - t0;
    s.anim(b.paw, stops.map(([, x, y], i) => ({ offset: (times[i] - t0) / dur, translate: `${x}px ${y}px`, easing: 'ease-in-out' })), t0, dur, 'linear');
  }

  /** The paw goes into the bag at t0, feels around, and comes out empty at t1. */
  function rummage(s, b, t0, t1) {
    const stops = [[t0, 0, -400], [t0 + 0.32, 0, 0]];
    for (let t = t0 + 0.58, k = 0; t < t1 - 0.12; t += 0.26, k++) stops.push([t, k % 2 ? 18 : -18, k % 2 ? 0 : 10]);
    stops.push([t1, 0, 0], [t1 + 0.36, 0, -400]);
    pawPath(s, b, stops);
    s.sfx('whoosh', t0, 0.4);
  }

  /** Add one more part to the bag's drawing and return it. */
  function addToBag(b, markup) {
    b.g.insertAdjacentHTML('beforeend', markup);
    return b.g.lastElementChild;
  }

  /** Count tiles out loud: each one bumps and shows its number in turn. The numbers leave at `gone`. */
  function count(s, b, tiles, t, per, gone) {
    tiles.forEach((i, k) => {
      const when = t + k * per, p = slot(i);
      const label = addToBag(b, `<text x="${p.x + TILE / 2}" y="${p.y + 69}" text-anchor="middle" font-size="62" font-family="Chalk" fill="${DARK}">${k + 1}</text>`);
      s.appear(label, when, 0.05);
      s.anim(label, [{ opacity: 1 }, { opacity: 0 }], gone, 0.18);
      s.pulse(b.list[i], when, { to: 1.16, dur: 0.3 });
      s.sfx('tick', when, 0.34);
    });
  }

  /**
   * A fraction whose top, bar and bottom can each arrive on their own word.
   * With `steps` nothing shows until the parts are revealed; otherwise the whole fraction appears at `at`.
   */
  function fraction(s, top, bot, { x, y, size = 150, color = CHALK, at, steps = false }) {
    const n = s.place(`<span class="frac"><span style="border:0">${top}</span><i style="display:block;width:100%;height:.06em;background:currentColor"></i><span>${bot}</span></span>`, { x, y, size, color });
    const [t, bar, b] = n.querySelector('.frac').children;
    s.show(n, at, steps ? 0.01 : 0.14);
    if (!steps) { s.pulse(n, at, { to: 1.2, dur: 0.36 }); s.sfx('pop', at, 0.6); }
    return { n, top: t, bar, bot: b };
  }

  /** Draw a fraction's bar across, ready for its numbers. */
  function drawBar(s, f, t) {
    s.grow(f.bar, t, 0.3, { from: '0 1', to: '1 1', origin: '50% 50%' });
    s.sfx('chalk', t, 0.5, 0.3);
  }

  /** Send a number from a spot on the board into its place in a fraction. */
  function flyIn(s, part, from, t, dur = 0.5) {
    const o = s.page.getBoundingClientRect(), r = part.getBoundingClientRect();
    const dx = from.x - (r.left - o.left + r.width / 2), dy = from.y - (r.top - o.top + r.height / 2);
    s.show(part, t, 0.06);
    s.anim(part, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], t, dur, 'cubic-bezier(.45,.05,.2,1)');
    s.sfx('whoosh', t, 0.42);
  }

  /** A chalk X through something wrong, which then dims. A level strike would hide on a fraction's bar. */
  function cross(s, node, t) {
    const o = s.page.getBoundingClientRect(), r = node.getBoundingClientRect();
    const x0 = r.left - o.left - 6, y0 = r.top - o.top + 4, x1 = x0 + r.width + 12, y1 = y0 + r.height - 8;
    const line = (a, d) => `<path class="${a}" d="${d}" fill="none" stroke="${s.ink.red}" stroke-width="10" stroke-linecap="round"/>`;
    const g = s.shape(line('a', `M${x0},${y1} L${x1},${y0}`) + line('b', `M${x0},${y0} L${x1},${y1}`));
    s.draw(g.get('.a'), t, 0.18);
    s.draw(g.get('.b'), t + 0.18, 0.18);
    s.anim(node, [{ opacity: 1 }, { opacity: 0.5 }], t + 0.1, 0.2);
  }

  /** A spinner with four equal slices. Its needle turns on demand. */
  function spinner(s, x, y, r, at) {
    const point = (d) => `${(r + r * Math.sin((d * Math.PI) / 180)).toFixed(1)},${(r - r * Math.cos((d * Math.PI) / 180)).toFixed(1)}`;
    const slice = (a, color) => `<path d="M${r},${r} L${point(a - 45)} A${r},${r} 0 0 1 ${point(a + 45)} Z" fill="${color}" stroke="${DARK}" stroke-width="5"/>`;
    const g = s.shape(`<g class="disc">${[RED, GOLD, BLUE, TEAL].map((color, i) => slice(i * 90, color)).join('')}</g>
      <g class="needle"><path d="M${r - 14},${r} L${r},${r * 0.16} L${r + 14},${r} Z" fill="${CHALK}" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/><circle cx="${r}" cy="${r}" r="18" fill="${CHALK}" stroke="${DARK}" stroke-width="4"/></g>`, { x, y, w: 2 * r, h: 2 * r });
    s.pop(g.get('.disc'), at);
    s.pop(g.get('.needle'), at + 0.1, { gain: 0.3 });
    return g;
  }

  /** One way two flips can land: a pair of coins on a card. The coins spin in at `t`. */
  function outcome(s, name, cx, y, t) {
    const coin = (face, x) => `<g class="coin"><circle cx="${x}" cy="${y + 68}" r="56" fill="${face === 'H' ? GOLD : SILVER}" stroke="${face === 'H' ? '#b98a22' : '#7d8a99'}" stroke-width="6"/><text x="${x}" y="${y + 95}" text-anchor="middle" font-size="76" font-family="Fredoka" font-weight="600" fill="${DARK}">${face}</text></g>`;
    const g = s.shape(`<g class="o"><rect class="card" x="${cx - 128}" y="${y}" width="256" height="136" rx="24" fill="${CARD}" stroke="rgba(245,243,234,.7)" stroke-width="5"/>${coin(name[0], cx - 60)}${coin(name[1], cx + 60)}</g>`);
    const o = g.get('.o');
    Object.assign(o.style, { transformBox: 'fill-box', transformOrigin: '50% 50%' });
    s.appear(g.get('.card'), t, 0.18);
    g.querySelectorAll('.coin').forEach((n, i) => {
      Object.assign(n.style, { transformBox: 'fill-box', transformOrigin: '50% 50%', scale: '1 0' });
      s.anim(n, [{ scale: '1 0' }, { scale: '1 1' }, { scale: '1 0' }, { scale: '1 1' }], t + i * 0.08, 0.48, 'linear');
    });
    s.sfx('swipe', t, 0.34);
    return { o, card: g.get('.card') };
  }

  /** Flip one word over into another on its side, at t1, and back again at t2. */
  function flipOver(s, a, b, t1, t2) {
    const half = 0.17;
    b.style.scale = '1 0';
    s.anim(a, [{ scale: '1 1' }, { scale: '1 0' }], t1, half, 'ease-in');
    s.anim(b, [{ scale: '1 0' }, { scale: '1 1' }], t1 + half, half, 'ease-out');
    s.anim(b, [{ scale: '1 1' }, { scale: '1 0' }], t2, half, 'ease-in');
    s.anim(a, [{ scale: '1 0' }, { scale: '1 1' }], t2 + half, half, 'ease-out');
    s.sfx('whoosh', t1, 0.5);
    s.sfx('whoosh', t2, 0.4);
  }

  /** Turn an outcome card a solid color. */
  function paint(s, card, color, t) {
    s.anim(card, [{ fill: CARD }, { fill: color }], t, 0.24, 'linear');
  }

  LessonStudio.define({
    id: 'probability',
    teacher: 'pinky',
    title: 'Count the right sample space',
    facts: [
      ['3 + 7', 10],
      ['3 / 10', 0.3],
      ['5 + 3', 8],
      ['3 / 8', 0.375],
      ['3 - 1', 2],
      ['10 - 1', 9],
      ['2 / 9', 2 / 9],
      ['2 * 2', 4],
      ['1 / 4', 0.25],
      ['1 - 1 / 4', 0.75],
    ],
    beats: [
      {
        say: `{hi}Hey, Pinky here, with a {bag}bag of tiles! {count}Probability is really just {counting}counting. {trick}The trick is counting the {right}right things.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.4);
          s.wideCam(c.word('with') - 0.3, 1);
          const b = bag(s, 3, 7, { x: 294, y: 192, at: c.bag });
          s.m.look('board', c.bag, 1.1);
          s.m.point(mid(b, 6), c.count, 1.2);
          count(s, b, upTo(10), c.counting, 0.09, c.trick + 0.3);
          const title = s.words('Count the right sample space', { y: 82, size: 86, color: GOLD, at: c.trick, per: 0.13 });
          s.m.mood('sly', c.trick, 1.8);
          s.mark(title.find('right'), c.right);
          upTo(3).forEach((i) => s.pulse(b.list[i], c.right + i * 0.09, { to: 1.24 }));
          s.m.point(title.find('right'), c.right, 0.9);
        },
      },
      {
        page: 'The idea',
        say: `{p}Probability is {want}what you want, {over}over {every}everything that could happen, {ss}the sample space. {eq}As long as {all}every outcome is {likely}equally likely.`,
        run(s, c) {
          s.words(['Probability', '='], { x: 44, y: 142, size: 86, align: 'left', gap: 0.22, times: [c.p, c.word('is')] });
          const top = s.spoken('what you want', c, c.want, { x: 826, y: 88, size: 98, color: TEAL });
          const line = s.shape(`<path class="l" d="M480,204 H1172" stroke="${CHALK}" stroke-width="9" stroke-linecap="round"/>`);
          s.draw(line.get('.l'), c.over, 0.3);
          const low = s.spoken('everything that could happen', c, c.every, { x: 826, y: 218, size: 64 });
          low.w[low.w.length - 1].style.marginRight = 0;
          s.m.look(top, c.want, 0.8);
          s.m.point(low, c.every, 1.7);
          s.mark(low, c.ss, { color: s.ink.pink, pad: 10 });
          s.tag('the sample space', { x: 826, y: 310, at: c.ss + 0.1, bg: s.ink.pink, size: 50 });
          s.spoken('every outcome', c, c.all, { x: 320, y: 432, size: 80 });
          const even = s.spoken(['equally', 'likely'], c, c.likely, { x: 320, y: 530, size: 100, color: GOLD });
          even.w[1].style.marginRight = 0;
          s.mark(even, c.likely + 0.15, { pad: 10, dur: 0.34 });
          const wheel = spinner(s, 650, 420, 140, c.all);
          s.turn(wheel.get('.needle'), 1170, c.likely - 0.1, 1.7, { origin: '140px 140px', easing: 'cubic-bezier(.16,.72,.22,1)' });
          s.sfx('whoosh', c.likely, 0.6);
          s.m.point(wheel, c.all, 1.5);
          s.m.mood('happy', c.likely, 1.6);
        },
      },
      {
        page: 'Watch me',
        say: `{r}Three red tiles. {b}Seven blue. {reach}Reach in. {ask}What's the chance of red? {three}Three red, {ten}ten tiles in {total}total. {ans}Three tenths.`,
        run(s, c) {
          const b = bag(s, 3, 7, { at: c.r - 0.25, redAt: c.r, blueAt: c.b, per: 0.09, hand: true });
          s.m.look('board', c.r, 2);
          s.text('3 red', { x: 756, y: 88, size: 88, color: RED, at: c.r, dur: 0.3 });
          s.text('7 blue', { x: 988, y: 88, size: 88, color: s.ink.blue, at: c.b, dur: 0.3 });
          rummage(s, b, c.reach, c.three);
          s.m.look(mid(b, 2), c.reach, 1);
          const q = s.words('Chance of red?', { x: 872, y: 188, size: 80, color: TEAL, times: [c.word('chance'), c.word('of'), c.word('red', 1)] });
          s.mark(q.find('red'), c.word('red', 1), { color: RED, hold: 1.1 });
          const f = fraction(s, '3', '10', { x: 872, y: 304, size: 150, at: c.three, steps: true });
          drawBar(s, f, c.three);
          s.m.point(mid(b, 2), c.three, c.total - c.three);
          count(s, b, upTo(3), c.three, 0.13, c.ten);
          flyIn(s, f.top, mid(b, 1), c.three + 0.1);
          count(s, b, upTo(10), c.ten, 0.07, c.ans + 0.1);
          flyIn(s, f.bot, mid(b, 7), c.total, 0.42);
          s.tint(f.n, GOLD, c.ans);
          s.circle(f.n, c.ans + 0.1, { color: GOLD, pad: 12 });
          s.m.point(f.n, c.ans, 1.2);
          s.m.act('thumbs', c.ans, 1.1);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {r}Five red. {b}Three blue. {ask}What's the chance of blue? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          v.turn = bag(s, 5, 3, { at: c.go, redAt: c.r, blueAt: c.b, per: 0.08 });
          s.m.look('board', c.go, 2.4);
          s.text('5 red', { x: 742, y: 88, size: 88, color: RED, at: c.r, dur: 0.3 });
          s.text('3 blue', { x: 968, y: 88, size: 88, color: s.ink.blue, at: c.b, dur: 0.3 });
          const q = s.words('Chance of blue?', { x: 858, y: 188, size: 80, color: TEAL, times: [c.word('chance'), c.word('of'), c.word('blue', 1)] });
          s.mark(q.find('blue'), c.word('blue', 1), { color: BLUE, hold: 1 });
          s.m.point(q, c.ask, 0.8);
          v.guess = fraction(s, '?', '?', { x: 858, y: 288, size: 150, at: c.try });
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Three eighths! {why}Three blue, {tot}eight in total. {wrong}If you said {said}three fifths, {forgot}you left the {blues}blues out of the {sum}total.`,
        run(s, c, v) {
          const b = v.turn;
          s.hide(v.guess.n, c.ans, 0.1);
          const f = fraction(s, '3', '8', { x: 858, y: 288, size: 150, color: GOLD, at: c.ans });
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);
          s.stars(f.n, c.ans + 0.1, 9);
          count(s, b, [5, 6, 7], c.why, 0.14, c.tot);
          s.pulse(f.top, c.why, { to: 1.3 });
          count(s, b, upTo(8), c.tot, 0.08, c.wrong);
          s.pulse(f.bot, c.tot + 0.2, { to: 1.3 });
          s.m.mood('oops', c.wrong, 2.6);
          const wrong = fraction(s, '3', '5', { x: 1036, y: 306, size: 120, at: c.said });
          cross(s, wrong.n, c.forgot);
          s.circle(addToBag(b, `<rect x="${slot(5).x}" y="${slot(5).y}" width="${2 * STEP + TILE}" height="${TILE}" fill="none"/>`), c.blues, { color: s.ink.blue, pad: 10 });
          s.m.point(mid(b, 6), c.blues, 1);
          s.pulse(f.bot, c.sum, { to: 1.3 });
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{now}Now watch what happens when I {draw}draw a red tile, {nb}and I don't put it {back}back. {bag}The bag changes. {two}Two red left, {nine}nine tiles in {total}total. {ans}The chance of red is now two ninths, {not}not three tenths. {dep}These draws aren't independent. {sec}The second depends on the first.`,
        run(s, c) {
          const b = bag(s, 3, 7, { at: c.now - 0.2, per: 0.03, hand: true, lift: 2 });
          s.m.look(mid(b, 2), c.now, 2.4);
          const out = b.list[2], rise = c.word('red');
          pawPath(s, b, [[c.draw - 0.1, 0, -400], [c.draw + 0.2, 0, 0], [rise, 0, 0], [rise + 0.4, 0, -210], [c.nb, 0, -210], [c.nb + 0.36, 0, -400]]);
          s.move(out, 0, -210, rise, 0.4);
          s.move(out, 436, -30, c.nb, 0.62);
          s.appear(addToBag(b, `<rect x="${slot(2).x}" y="${slot(2).y}" width="${TILE}" height="${TILE}" rx="16" fill="none" stroke="${CHALK}" stroke-width="4" stroke-dasharray="11 10"/>`), rise + 0.15, 0.2);
          s.tag('not put back', { x: 842, y: 110, at: c.back, bg: '#ff8080', size: 48, align: 'left' });
          s.m.mood('wow', c.bag, 1.4);
          s.anim(b.g, [{ rotate: '0deg' }, { rotate: '-3.5deg', offset: 0.28 }, { rotate: '3deg', offset: 0.62 }, { rotate: '0deg' }], c.bag, 0.7, 'ease-in-out', 'none');
          s.sfx('boing', c.bag, 0.5);
          const old = fraction(s, '3', '10', { x: 774, y: 236, size: 130, at: c.bag });
          const f = fraction(s, '2', '9', { x: 990, y: 236, size: 130, color: GOLD, at: c.two, steps: true });
          drawBar(s, f, c.two);
          s.m.point(mid(b, 0), c.two, c.total - c.two);
          s.arrow({ x: 838, y: 356 }, { x: 930, y: 356 }, c.two, { curve: 0.12, color: TEAL });
          count(s, b, [0, 1], c.two, 0.14, c.nine);
          flyIn(s, f.top, mid(b, 0), c.two + 0.1);
          count(s, b, [0, 1, 3, 4, 5, 6, 7, 8, 9], c.nine, 0.07, c.ans);
          flyIn(s, f.bot, mid(b, 6), c.total, 0.42);
          s.circle(f.n, c.word('two', 1), { color: GOLD, pad: 18 });
          s.m.point(f.n, c.word('two', 1), 1.1);
          cross(s, old.n, c.word('three'));
          s.m.act('shake', c.not, 0.7);
          s.m.mood('hmm', c.dep, 3);
          const line = s.words(['not independent:', 'depends on the first'], { x: 520, y: 630, size: 66, color: TEAL, times: [c.dep, c.word('depends')] });
          s.mark(line.w[0], c.word('independent'), { color: s.ink.pink });
          s.pulse(f.n, c.word('depends'), { to: 1.12 });
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{flip}For at least one, {turn}flip it around: {rule}one {rm}minus the {none}chance of none. {coin}Flip a coin twice. {want}At least one heads? {dont}Don't count them all. {only}The only way to fail is {tt}tails, tails. That's {one}one fourth. So {m1}one {minus}minus {m2}one fourth: {ans}three fourths.`,
        run(s, c) {
          const side = { y: 170, size: 130, color: TEAL };
          const least = s.text('at least one', { ...side, at: c.word('at'), dur: 0.35 });
          flipOver(s, least, s.place('none', { ...side, color: s.ink.pink }), c.turn, c.rule);
          const rule = s.words(['=', '1', '−', 'chance of none'], { y: 330, size: 112, times: [c.rule, c.rule, c.rm, c.none] });
          s.mark(rule.w[3], c.word('none'), { color: s.ink.pink, hold: c.coin - c.word('none') });
          s.m.point(rule.w[3], c.rule, 1.2);
          s.hide(least, c.coin, 0.24);
          s.hide(rule, c.coin, 0.24);
          const cards = ['HH', 'HT', 'TH', 'TT'].map((name, i) => outcome(s, name, 185 + i * 286, 92, c.coin + 0.14 + i * 0.24));
          const wins = cards.slice(0, 3), fail = cards[3];
          s.m.look('board', c.coin, 1.4);
          const q = s.spoken('At least one heads?', c, c.want, { x: 380, y: 252, size: 92 });
          s.under(q.find('heads'), c.word('heads'), { color: GOLD });
          wins.forEach((w, i) => s.pulse(w.o, c.word('heads') + i * 0.12, { to: 1.08 }));
          s.m.act('shake', c.dont, 0.7);
          wins.forEach((w) => s.anim(w.o, [{ opacity: 1 }, { opacity: 0.42 }], c.dont, 0.3));
          paint(s, fail.card, '#ff8080', c.tt);
          s.pulse(fail.o, c.tt, { to: 1.1 });
          s.tag('fail', { x: 1043, y: 234, at: c.tt, bg: '#ff8080', size: 46 });
          s.m.point(fail.card, c.tt, 1);
          s.m.mood('oops', c.tt, 1);
          const f = fraction(s, '1', '4', { x: 1043, y: 304, size: 130, at: c.one });
          const row = { y: 474, size: 130, dur: 0.2 };
          s.text('1', { ...row, x: 330, at: c.m1 });
          s.text('−', { ...row, x: 414, at: c.minus });
          s.move(f.n, 526 - 1043, 440 - 304, c.m2, 0.5);
          s.text('=', { ...row, x: 640, at: c.ans });
          const a = fraction(s, '3', '4', { x: 750, y: 440, size: 130, color: GOLD, at: c.ans });
          s.stars(a.n, c.ans + 0.1, 8);
          wins.forEach((w, i) => {
            s.anim(w.o, [{ opacity: 0.42 }, { opacity: 1 }], c.ans + i * 0.1, 0.2);
            paint(s, w.card, TEAL, c.ans + i * 0.1);
          });
          s.m.point(a.n, c.ans, 0.9);
          s.m.mood('proud', c.ans, 1.4);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{read}So read the little words. {g}Given that. {w}Without replacement. {a}At least. {tell}They tell you what to count. {bye}Now hit Try this skill!`,
        run(s, c) {
          const sheet = s.shape(`<rect class="sheet" x="50" y="82" width="1112" height="330" rx="22" fill="none" stroke="${CHALK}" stroke-width="6"/>`);
          s.draw(sheet.get('.sheet'), c.read, 0.5);
          const line = { x: 90, size: 72, align: 'left', per: 0.06 };
          const a = s.words(['Given that', 'the', 'first', 'tile', 'is', 'red,'], { ...line, y: 100, at: c.read });
          const b = s.words(['drawn', 'without replacement,'], { ...line, y: 200, at: c.word('little') });
          const d = s.words(["what's", 'the', 'chance', 'of', 'at least', 'one', 'blue?'], { ...line, y: 300, at: c.word('words') });
          s.m.look('board', c.read, 1.4);
          s.mark(a.w[0], c.g, { color: GOLD });
          s.m.point(a.w[0], c.g, 0.4);
          s.mark(b.w[1], c.w, { color: s.ink.pink });
          s.m.point(b.w[1], c.w, 0.7);
          s.mark(d.w[4], c.a, { color: TEAL });
          s.m.point(d.w[4], c.a, 0.5);
          s.spoken('They tell you what to count', c, c.tell, { x: 560, y: 446, size: 84, color: GOLD });
          s.m.mood('proud', c.tell, 2.6);
          s.tag('Next: Try this skill', { x: 560, y: 574, at: c.bye + 0.2, bg: GOLD, size: 56 });
          s.m.act('wave', c.bye, 1.9);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
