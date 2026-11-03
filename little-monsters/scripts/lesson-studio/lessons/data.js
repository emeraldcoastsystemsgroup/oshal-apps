/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Turn means into totals: score bars stack into one tower (the total) and share out level again (the mean), the worked example lands a new score on the tower and splits it into five, and a seesaw tips on the false average of averages and levels on the true one
 */
(function () {
  const MAX = 20;
  const DARK = '#173a30';
  const BOUNCE = 'cubic-bezier(.4,1.15,.5,1)';
  const SMOOTH = 'cubic-bezier(.45,.05,.3,1)';
  const BRIGHT = ['#8fe6cf', '#ff9ccf', '#ffd66b', '#9fd0ff'];
  /** A slot a carried number lands on is never written: the number itself flies there. */
  const NEVER = 1e4;

  /** Slide a node to an offset from its home spot, silently, so a whole pile makes one sound. */
  function glide(s, node, x, y, t, dur, easing = BOUNCE) {
    s.anim(node, [{ translate: `${node._tx || 0}px ${node._ty || 0}px` }, { translate: `${x}px ${y}px` }], t, dur, easing);
    node._tx = x;
    node._ty = y;
  }

  /** Where a node sits on the current page, measured during the build before anything moves. */
  function spot(s, node) {
    const page = s.page.getBoundingClientRect(), r = node.getBoundingClientRect();
    return { cx: r.left - page.left + r.width / 2, y: r.top - page.top };
  }

  /** Score bars on one floor. Stacked they are the total; shared out level they are the mean. */
  function pile(s, { left, width, gap, floor, unit }) {
    const step = width + gap;
    const items = [];
    const cx = (col) => left + col * step + width / 2;

    function add(value, col, t, { color, label, labelAt = t, size = 60 } = {}) {
      const { list } = s.bars([value], { x: left + col * step, y: floor - MAX * unit, w: width, h: MAX * unit, max: MAX, colors: [color], at: t });
      const item = { bar: list[0], col, value, now: value };
      if (label) item.label = s.text(label, { x: cx(col), y: floor - (value * unit) / 2 - size * 0.55, size, color: DARK, at: labelAt, dur: 0.2, quiet: true });
      items.push(item);
      return item;
    }

    /** Send one bar to a column, raised off the floor, at a new height. Its label rides along. */
    function send(item, col, lift, value, t, dur) {
      const dx = (col - item.col) * step;
      glide(s, item.bar, dx, -lift, t, dur);
      if (value !== item.now) s.anim(item.bar, [{ scale: `1 ${item.now / MAX}` }, { scale: `1 ${value / MAX}` }], t, dur, BOUNCE);
      if (item.label) glide(s, item.label, dx, -lift - ((value - item.value) * unit) / 2, t, dur);
      item.now = value;
    }

    /** Pile every bar into one tower at a column, nearest bar at the bottom. Returns the tower's top. */
    function stack(col, t, dur = 0.5, stagger = 0.06) {
      let lift = 0;
      const nearestFirst = items.map((item, i) => ({ item, far: Math.abs(i - col) })).sort((a, b) => a.far - b.far);
      nearestFirst.forEach(({ item }, i) => {
        send(item, col, lift, item.now, t + i * stagger, dur);
        lift += item.now * unit;
      });
      s.sfx('whoosh', t, 0.7);
      return floor - lift;
    }

    /** Share the tower out: every bar back on the floor in its own column at the same height. */
    function level(value, t, dur = 0.7) {
      items.forEach((item, i) => send(item, i, 0, value, t, dur));
      s.sfx('whoosh', t, 0.7);
    }

    const hideLabels = (t) => items.forEach((item) => item.label && s.hide(item.label, t, 0.15));
    return { items, cx, add, send, stack, level, hideLabels, y: (value) => floor - value * unit, x: (col) => left + col * step, width, unit };
  }

  /** A straight chalk line: the floor bars stand on, or the level they share. */
  function line(s, x0, x1, y, t, color = '#f5f3ea', width = 6) {
    const g = s.shape(`<path class="l" d="M${x0},${y} H${x1}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`);
    return s.draw(g.get('.l'), t, 0.35, { gain: 0.25 });
  }

  /** A line of working in the right column, one token per spoken word. */
  function row(s, tokens, times, opts) {
    return s.words(tokens, { x: 570, align: 'left', size: 84, gap: 0.24, times, ...opts });
  }

  /** Lift a copy of a number off its line and fly it to its next slot. */
  function carry(s, token, slot, t, { size = 84, dur = 0.5 } = {}) {
    const from = spot(s, token);
    const copy = s.text(token.textContent, { x: from.cx, y: from.y, size, color: getComputedStyle(token).color, at: t, dur: 0.01, quiet: true });
    s.flyTo(copy, slot, t, dur);
    return copy;
  }

  /** Empty chalk boxes on the floor: the places a shared-out pile is about to land. */
  function slots(s, p, cols, value, t) {
    const g = s.shape(cols.map((i) => `<rect class="slot" x="${p.x(i)}" y="${p.y(value)}" width="${p.width}" height="${value * p.unit}" rx="8" fill="none" stroke="#f5f3ea" stroke-width="5" stroke-opacity=".75"/>`).join(''));
    g.querySelectorAll('.slot').forEach((slot, i) => s.draw(slot, t + i * 0.06, 0.28, { gain: 0.15 }));
    return g;
  }

  /** A chalk brace over a run of bars, its point in the middle. */
  function brace(s, x0, x1, y, t, color) {
    const mid = (x0 + x1) / 2;
    const g = s.shape(`<path class="b" d="M${x0},${y + 26} Q${x0},${y} ${x0 + 32},${y} H${mid - 32} Q${mid},${y} ${mid},${y - 26} Q${mid},${y} ${mid + 32},${y} H${x1 - 32} Q${x1},${y} ${x1},${y + 26}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`);
    s.draw(g.get('.b'), t, 0.3, { gain: 0.3 });
    return g;
  }

  const PLANK = 370, MID = 594, RIDER = 100;

  /** A plank on a prop. It tips while the prop is in the wrong place and levels at the true average. */
  function seesaw(s, t) {
    const g = s.shape(`<g class="plank"><rect x="60" y="${PLANK}" width="1115" height="22" rx="11" fill="#c9915a"/></g>
      <path class="prop" d="M${MID},${PLANK + 22} L${MID - 52},${PLANK + 96} H${MID + 52} Z" fill="#ffd66b"/>`);
    const plank = g.get('.plank'), prop = g.get('.prop');
    s.appear(plank, t, 0.3);
    s.appear(prop, t, 0.3);
    s.sfx('pop', t, 0.6);
    const riders = [];
    let deg = 0;
    const drop = (x, angle) => (x - MID) * Math.sin((angle * Math.PI) / 180);
    return {
      /** Stand a tiny monster on the plank, wherever the plank is right now. */
      ride(x, row2, at, hue) {
        const base = drop(x, deg);
        const n = s.critter(x, PLANK + 4 - RIDER * 0.574 - (row2 ? 88 : 0) + base, RIDER, at, { hue, light: 1.6 });
        riders.push({ n, x, base });
      },
      tip(angle, at, dur = 0.7, easing = 'cubic-bezier(.34,1.5,.5,1)') {
        s.turn(plank, angle, at, dur, { origin: `${MID}px ${PLANK + 22}px`, easing });
        riders.forEach((r) => glide(s, r.n, 0, drop(r.x, angle) - r.base, at, dur, easing));
        deg = angle;
      },
      slide(x, at, dur) { glide(s, prop, x - MID, 0, at, dur, SMOOTH); },
    };
  }

  /** The trap in words: the claim appears as it is read and the words that matter get marked. */
  function trapWords(s, c) {
    const trap = s.tag('the trap', { x: 614, y: 90, at: c.word('trap'), bg: s.ink.red, size: 60 });
    const claim = s.spoken('averaging two averages', c, c.avg, { y: 210, size: 104, color: s.ink.yellow });
    const when = s.spoken("when the groups aren't the same size", c, c.un, { y: 360, size: 76 });
    const same = s.mark(when.find('same'), c.word('same'), { color: s.ink.pink });
    const size = s.mark(when.find('size'), c.word('size'), { color: s.ink.pink });
    s.m.point(when.find('same'), c.word('same'), 1);
    [trap, claim, when, same, size].forEach((n) => s.hide(n, c.two, 0.18));
  }

  /** The groups climb on: the plank tips under the two, then the other way under the eight. */
  function boardGroups(s, c, saw) {
    [148, 248].forEach((x, i) => saw.ride(x, false, c.two + i * 0.12, 240));
    saw.tip(-7, c.word('students'), 0.6);
    const two = s.words(['2', 'students:', '90'], { x: 240, y: 84, size: 72, color: s.ink.blue, times: [c.two, c.word('students'), c.word('ninety')] });
    s.m.point(two, c.two, 1.2);
    s.m.point({ x: 990, y: 300 }, c.eight, 1.2);
    [861, 947, 1033, 1119].forEach((x, i) => {
      saw.ride(x, false, c.eight + i * 0.07, 0);
      saw.ride(x, true, c.eight + 0.28 + i * 0.07, 0);
    });
    saw.tip(7, c.word('students', 1) + 0.25, 0.7);
    const eight = s.words(['8', 'students:', '70'], { x: 880, y: 84, size: 72, color: s.ink.pink, times: [c.eight, c.word('students', 1), c.word('seventy')] });
    return { two, eight };
  }

  /** The two totals are worked over their groups, then combine into one number that goes over ten. */
  function weightedTotal(s, c, { two, eight }) {
    const end = s.words(['740', '÷', '10', '=', '74'], { x: MID, y: 560, size: 104, times: [c.word('seven'), c.word('over'), c.word('ten'), c.e, c.e] });
    end.w[4].style.color = s.ink.yellow;
    const parts = s.words(['180', '+', '560'], { x: spot(s, end.w[0]).cx, y: 560, size: 104, times: [c.a, c.word('plus'), c.word('five')] });
    s.swap(two, '2 × 90 = 180', c.a, { color: s.ink.blue });
    s.swap(eight, '8 × 70 = 560', c.word('five'), { color: s.ink.pink });
    const merge = Math.max(0.3, c.word('seven') - c.c);
    s.hide(parts.w[1], c.c, 0.12);
    [0, 2].forEach((i) => {
      s.flyTo(parts.w[i], end.w[0], c.c, merge);
      s.hide(parts.w[i], c.c + merge * 0.55, merge * 0.45);
    });
    return end;
  }

  LessonStudio.define({
    id: 'data',
    teacher: 'pinky',
    title: 'Turn means into totals',
    facts: [
      ['9 + 15 + 8 + 16', 48],
      ['48 / 4', 12],
      ['4 * 12', 48],
      ['48 + 17', 65],
      ['65 / 5', 13],
      ['3 * 10', 30],
      ['30 + 18', 48],
      ['(30 + 18) / 4', 12],
      ['2 + 8', 10],
      ['(90 + 70) / 2', 80],
      ['2 * 90', 180],
      ['8 * 70', 560],
      ['180 + 560', 740],
      ['740 / 10', 74],
    ],
    beats: [
      {
        say: `{hi}Pinky here! {look}Here's a question that looks impossible. {four}Four scores. {dk}You don't know any of them, {just}just their average. {add}Add one more. {ask}What's the new average? {doable}Totally doable.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.2);
          s.wideCam(c.look - 0.3, 1.1);
          s.m.mood('wow', c.look, 1.6);
          s.text('Turn means into totals', { y: 36, size: 88, color: s.ink.yellow, at: c.look + 0.4, dur: 1.2 });
          const p = pile(s, { left: 100, width: 96, gap: 20, floor: 660, unit: 21 });
          line(s, 84, 672, 662, c.four);
          [9, 15, 8, 16].forEach((score, i) => p.add(score, i, c.four + i * 0.12, { color: s.ink.teal, label: '?', labelAt: c.dk + i * 0.12, size: 72 }));
          s.m.look('board', c.four, 2);
          line(s, 84, 556, p.y(12), c.just, s.ink.yellow);
          s.tag('just the average', { x: 900, y: 382, at: c.word('average'), bg: s.ink.yellow, size: 44 });
          p.add(17, 4, c.add, { color: s.ink.pink, label: '?', labelAt: c.word('more'), size: 72 });
          s.m.point({ x: p.cx(4), y: 480 }, c.add, 1.1);
          const ask = s.text('New average?', { x: 900, y: 190, size: 92, color: s.ink.yellow, at: c.word('new'), dur: 0.6 });
          s.m.look(ask, c.ask, 1.2);
          s.m.mood('sly', c.doable, 1.6);
        },
      },
      {
        page: 'The idea',
        say: `{mean}The mean is {tot}the total, {div}divided by how many. {so}Which means: mean times how many {back}gets you the total back.`,
        run(s, c) {
          const p = pile(s, { left: 60, width: 100, gap: 16, floor: 700, unit: 11 });
          line(s, 44, 524, 702, c.mean);
          [9, 15, 8, 16].forEach((score, i) => p.add(score, i, c.mean + i * 0.08, { color: BRIGHT[i] }));
          const rule = row(s, ['mean', '=', 'total', '÷', 'count'], [c.word('mean'), c.word('is'), c.word('total'), c.div, c.word('how')], { y: 170, size: 76 });
          s.mark(rule.find('mean'), c.word('mean'), { hold: 0.9 });
          s.mark(rule.find('count'), c.word('how'), { color: s.ink.teal, hold: 0.9 });
          const towerX = p.cx(1.5);
          p.stack(1.5, c.word('is'), Math.max(0.3, c.word('total') - c.word('is')), 0.03);
          const total = s.tag('total', { x: towerX, y: 96, at: c.word('total'), bg: s.ink.yellow, size: 50 });
          s.hide(total, c.div, 0.2);
          p.level(12, c.div, c.word('many') - c.div);
          const shared = line(s, 44, 524, p.y(12), c.word('many'), s.ink.yellow);
          const mean = s.tag('mean = average', { x: towerX, y: 478, at: c.word('many'), bg: s.ink.yellow, size: 44 });
          const back = row(s, ['mean', '×', 'count', '=', 'total'], [c.word('mean', 1), c.word('times'), c.word('how', 1), c.back, c.word('total', 1)], { y: 330, size: 76, color: s.ink.yellow });
          s.m.look(back, c.so, 1.4);
          s.hide(shared, c.back, 0.2);
          s.hide(mean, c.back, 0.2);
          p.stack(1.5, c.back, Math.max(0.4, c.word('total', 1) - c.back));
          s.tag('total', { x: towerX, y: 96, at: c.word('total', 1), bg: s.ink.yellow, size: 50 });
          s.mark(back.find('total'), c.word('total', 1));
          s.m.point(back.find('total'), c.back, 1.3);
        },
      },
      {
        page: 'Watch me',
        say: `{four}Four scores average twelve. {pic}Picture four bars, all leveled at twelve. {so}So the total is {calc}four times twelve: {ans}forty-eight.`,
        run(s, c, v) {
          const p = pile(s, { left: 60, width: 84, gap: 14, floor: 700, unit: 8 });
          v.p = p;
          v.given = row(s, ['4', 'scores,', 'average', '12'], [c.four, c.word('scores'), c.word('average'), c.word('twelve')], { y: 120, size: 80 });
          s.m.look(v.given, c.four, 1.2);
          line(s, 44, 552, 702, c.pic);
          [0, 1, 2, 3].forEach((i) => p.add(12, i, c.pic + i * 0.1, { color: s.ink.teal, label: '12', labelAt: c.word('twelve', 1) }));
          const even = line(s, 44, 440, p.y(12) - 8, c.word('leveled'), s.ink.yellow);
          s.m.point({ x: p.cx(1.5), y: 620 }, c.pic, 1.3);
          v.work = row(s, ['total', '=', '4', '×', '12', '=', '48'], [c.word('total'), c.word('is'), c.calc, c.word('times'), c.word('twelve', 2), c.ans, c.ans], { y: 270 });
          v.work.w[6].style.color = s.ink.yellow;
          s.mark(v.work.find('total'), c.word('total'), { hold: 1.2 });
          s.hide(even, c.ans, 0.15);
          const top = p.stack(2, c.ans, 0.5, 0.09);
          v.top = s.text('48', { x: p.cx(2), y: top - 92, size: 84, color: s.ink.yellow, at: c.ans + 0.45, dur: 0.2 });
          s.m.point({ x: p.cx(2), y: 460 }, c.ans, 1.3);
          s.m.mood('happy', c.ans, 1.4);
        },
      },
      {
        say: `{add}Add a score of seventeen. {nt}New total: {calc}forty-eight plus seventeen, {r}sixty-five. {nc}New count: five. {div}Sixty-five divided by five {ans}is thirteen.`,
        run(s, c, v) {
          const { p } = v;
          const fresh = p.add(17, 3, c.word('score'), { color: s.ink.pink, label: '17', labelAt: c.word('seventeen') });
          s.m.point({ x: p.cx(3), y: 620 }, c.add, 1.1);
          v.given.w.forEach((w) => s.hide(w, c.nt, 0.16));
          v.work.w.slice(0, 6).forEach((w) => s.hide(w, c.nt, 0.16));
          const total = row(s, ['total:', '48', '+', '17', '=', '65'], [c.word('total'), NEVER, c.word('plus'), c.word('seventeen', 1), c.r, c.r], { y: 120 });
          s.mark(total.w[0], c.word('total'), { hold: 0.8 });
          total.w[3].style.color = s.ink.pink;
          total.w[5].style.color = s.ink.yellow;
          s.flyTo(v.work.w[6], total.w[1], c.calc, 0.42);
          s.tint(v.work.w[6], s.ink.white, c.calc + 0.2);
          s.hide(v.top, c.word('plus'), 0.15);
          p.send(fresh, 2, 48 * p.unit, 17, c.word('plus'), Math.max(0.35, c.word('seventeen', 1) - c.word('plus')));
          s.sfx('whoosh', c.word('plus'), 0.7);
          const peak = s.text('65', { x: p.cx(2), y: p.y(65) - 92, size: 84, color: s.ink.yellow, at: c.r, dur: 0.2 });

          const count = row(s, ['count:', '5'], [c.word('count'), c.word('five')], { y: 260 });
          s.mark(count.w[0], c.word('count'), { color: s.ink.teal, hold: 0.9 });
          count.w[1].style.color = s.ink.teal;
          const outlines = slots(s, p, [0, 1, 3, 4], 13, c.word('five'));

          const mean = row(s, ['mean:', '65', '÷', '5', '=', '13'], [c.div, NEVER, c.word('divided'), NEVER, c.ans, c.word('thirteen')], { y: 400 });
          mean.w[5].style.color = s.ink.yellow;
          carry(s, total.w[5], mean.w[1], c.div, { dur: 0.4 });
          carry(s, count.w[1], mean.w[3], c.word('five', 1), { dur: 0.3 });
          s.hide(peak, c.div, 0.15);
          p.hideLabels(c.word('divided'));
          p.level(13, c.word('divided'), Math.max(0.6, c.word('five', 1) - c.word('divided') + 0.2));
          s.hide(outlines, c.ans, 0.2);
          [0, 1, 2, 3, 4].forEach((i) => s.text('13', { x: p.cx(i), y: p.y(13) + 18, size: 60, color: DARK, at: c.word('thirteen'), dur: 0.2, quiet: true }));
          s.circle(mean.w[5], c.word('thirteen') + 0.12, { color: s.ink.yellow, pad: 12 });
          s.stars(mean.w[5], c.word('thirteen') + 0.15, 9);
          s.m.act('thumbs', c.ans, 1.2);
          s.m.mood('proud', c.ans, 1.4);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}Three scores average ten. {b}Add an eighteen. {ask}What's the new mean? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const p = pile(s, { left: 60, width: 100, gap: 16, floor: 700, unit: 14 });
          v.q = p;
          line(s, 44, 524, 702, c.a);
          [0, 1, 2].forEach((i) => p.add(10, i, c.a + i * 0.12, { color: s.ink.teal, label: '10', labelAt: c.word('ten') }));
          p.add(18, 3, c.b, { color: s.ink.pink, label: '18', labelAt: c.word('eighteen') });
          v.given = row(s, ['3', 'scores,', 'average', '10'], [c.a, c.word('scores'), c.word('average'), c.word('ten')], { y: 140, size: 80 });
          v.plus = row(s, ['Add', '18'], [c.b, c.word('eighteen')], { y: 260, color: s.ink.pink, size: 92 });
          v.ask = row(s, ['New', 'mean?'], [c.word('new'), c.word('mean')], { y: 390, color: s.ink.yellow, size: 92 });
          s.m.look('board', c.go, 1.4);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Twelve! {calc}Thirty plus eighteen is forty-eight, {div}divided by four.`,
        run(s, c, v) {
          const { q } = v;
          s.hide(v.given, c.ans, 0.2);
          s.hide(v.plus, c.ans, 0.2);
          s.hide(v.ask, c.ans, 0.12);
          const answer = s.text('New mean: 12', { x: 570, y: 390, size: 92, align: 'left', color: s.ink.yellow, at: c.ans, dur: 0.25 });
          s.stars(answer, c.ans + 0.15, 9);
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);
          s.move(answer, 0, -250, c.calc, 0.45);

          const group = brace(s, 60, 392, 520, c.calc, s.ink.yellow);
          const thirty = s.tag('3 × 10 = 30', { x: 226, y: 420, at: c.calc, bg: s.ink.yellow, size: 44 });
          const sum = row(s, ['total:', '30', '+', '18', '=', '48'], [c.calc, c.calc, c.word('plus'), c.word('eighteen'), c.word('is'), c.word('forty-eight')], { y: 290 });
          sum.w[3].style.color = s.ink.pink;
          const share = row(s, ['mean:', '48', '÷', '4', '=', '12'], [c.div, NEVER, c.word('by'), c.word('four'), c.word('four') + 0.2, c.word('four') + 0.2], { y: 420 });
          share.w[5].style.color = s.ink.yellow;
          carry(s, sum.w[5], share.w[1], c.div, { dur: 0.3 });
          s.hide(group, c.div, 0.15);
          s.hide(thirty, c.div, 0.15);
          q.hideLabels(c.div);
          q.level(12, c.div, Math.max(0.6, c.word('four') - c.div));
          [0, 1, 2, 3].forEach((i) => s.text('12', { x: q.cx(i), y: q.y(12) + 50, size: 60, color: DARK, at: c.word('four'), dur: 0.2, quiet: true }));
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{see}See what we skipped? {never}We never needed the original scores. {rec}Recover the old total first, {easy}and the rest is easy.`,
        run(s, c) {
          const p = pile(s, { left: 60, width: 100, gap: 16, floor: 700, unit: 11 });
          line(s, 44, 524, 702, c.see);
          [9, 15, 8, 16].forEach((score, i) => p.add(score, i, c.see + i * 0.1, { color: BRIGHT[i], label: '?', size: 72 }));
          s.m.mood('sly', c.see, 2);
          s.m.point({ x: p.cx(1.5), y: 620 }, c.never, 1.4);
          const never = row(s, ['never', 'needed'], [c.word('never'), c.word('needed')], { y: 170, size: 96 });
          const scores = row(s, ['the', 'original', 'scores'], [c.word('the'), c.word('original'), c.word('scores')], { y: 290, size: 84 });
          const swipe = s.mark(never.find('never'), c.word('never'), { color: s.ink.pink });
          [never, scores, swipe].forEach((n) => s.hide(n, c.rec, 0.15));
          const crosses = p.items.map((item, i) => s.strike(item.label, c.word('original') + i * 0.1, { dim: 1, width: 10 }));
          crosses.forEach((mark) => s.hide(mark, c.rec, 0.15));
          p.hideLabels(c.rec);
          p.stack(1.5, c.rec, Math.max(0.45, c.word('total') - c.rec));
          s.tag('total', { x: p.cx(1.5), y: 96, at: c.word('total'), bg: s.ink.yellow, size: 50 });
          const old = row(s, ['old', 'total'], [c.word('old'), c.word('total')], { y: 170, size: 104, color: s.ink.yellow });
          s.mark(old.find('total'), c.word('total'));
          row(s, ['=', 'mean', '×', 'count'], [c.word('first'), c.word('first') + 0.1, c.word('first') + 0.2, c.word('first') + 0.3], { y: 300, size: 92 });
          s.m.point(old.find('total'), c.word('total'), 1.1);
          s.tag('the rest is easy', { x: 830, y: 450, at: c.word('easy'), bg: s.ink.teal, size: 50 });
          s.m.act('thumbs', c.easy, 1.1);
          s.m.mood('proud', c.easy, 1.2);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{trap}Now the trap: {avg}averaging two averages {un}when the groups aren't the same size. {two}Two students average ninety. {eight}Eight students average seventy. {not}The class average is not eighty. {use}Use totals. {a}One eighty {b}plus five sixty {c}is seven forty, {d}over ten: {e}seventy-four.`,
        run(s, c) {
          s.m.mood('hmm', c.trap, 2.4);
          trapWords(s, c);
          const saw = seesaw(s, c.two);
          const groups = boardGroups(s, c, saw);

          const asked = s.tag('class average', { x: MID, y: 478, at: c.not, bg: s.ink.white, size: 44 });
          const wrong = s.text('80', { x: 470, y: 390, size: 76, at: c.word('eighty'), dur: 0.2 });
          const cross = s.strike(wrong, c.word('eighty') + 0.3);
          s.m.act('shake', c.word('not'), 0.8);
          s.m.mood('oops', c.word('not'), 1.2);
          [asked, wrong, cross].forEach((n) => s.hide(n, c.use, 0.18));
          const hint = s.tag('use totals', { x: MID, y: 478, at: c.use, bg: s.ink.yellow, size: 44 });

          s.hide(hint, c.a, 0.18);
          const end = weightedTotal(s, c, groups);

          saw.slide(832, c.d, c.e - c.d);
          saw.tip(0, c.d, c.e - c.d, SMOOTH);
          const truth = s.text('74', { x: 730, y: 392, size: 96, color: s.ink.yellow, at: c.e, dur: 0.2 });
          s.circle(end.w[4], c.e + 0.12, { color: s.ink.yellow, pad: 12 });
          s.stars(truth, c.e + 0.1, 8);
          s.m.point(end.w[4], c.d, 1.4);
          s.m.mood('proud', c.e, 1.4);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{when}When you add a value, {both}update both the total and the count. {bye}Now hit Try this skill, and go get 'em!`,
        run(s, c) {
          s.spoken('When you add a value', c, c.when, { y: 96, size: 96 });
          [
            { name: 'total', x: 340, was: '48', now: '65', bg: s.ink.teal, at: c.word('total') },
            { name: 'count', x: 880, was: '4', now: '5', bg: s.ink.pink, at: c.word('count') },
          ].forEach(({ name, x, was, now, bg, at }) => {
            s.tag(name, { x, y: 236, at: c.both, bg, size: 60 });
            const old = s.text(was, { x, y: 318, size: 150, at: c.both, dur: 0.25 });
            const fresh = s.swap(old, now, at, { color: s.ink.yellow });
            s.pulse(fresh, at + 0.22, { to: 1.3 });
            s.sfx('ding', at, 0.4);
          });
          s.m.mood('proud', c.both, 2.6);
          s.tag('Next: Try this skill', { x: 614, y: 560, at: c.word('Try'), bg: '#ffd66b', size: 56 });
          s.m.act('wave', c.bye, 2.1);
          s.confetti(c.bye + 0.6);
        },
      },
    ],
  });
})();
