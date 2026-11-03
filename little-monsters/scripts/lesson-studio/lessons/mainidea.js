/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Keep the right scope: a frame fits a page, shrinks to one detail and balloons past it; a garden grows while its passage is read; the right answer lights up its words in the passage; a newspaper spins in with the headline; and always topples off the weak support of some and may
 */
(function () {
  const PAPER = '#f3efe0', RULE = '#c9c4b0', DARK = '#22302b', LEAF = '#7fd07a', STRONG_TEAL = '#39b897', HOT_PINK = '#ff4f9e';
  const PETALS = ['#ff9ccf', '#ffd66b', '#9fd0ff', '#ffb066', '#ff9ccf'];
  const BLOCK = '#8fe6cf';

  /** The passage panel on the Watch me page: every frame there is measured against it. */
  const PANEL = { x: 54, y: 82, w: 1126, h: 252 };
  /** Bigger than the passage: the "too broad" size. */
  const HUGE = { x: 40, y: 72, w: 1148, h: 650 };

  /** A frame rectangle that fits these words exactly, in board coordinates. */
  function fit(nodes, padX = 14, padY = 4) {
    const rects = [].concat(nodes).map((n) => n.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
    return { x: left - 58 - padX, y: top - 44 - padY, w: right - left + padX * 2, h: bottom - top + padY * 2 };
  }

  const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  /** Change a frame's color along with its size. */
  function recolor(s, frame, from, to, t) {
    s.anim(frame, [{ borderColor: from }, { borderColor: to }], t, 0.25, 'linear');
  }

  /** Dim something and leave it dim. */
  function dim(s, nodes, t, to = 0.35) {
    [].concat(nodes).forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: to }], t, 0.25));
  }

  /** Clear finished things off the board. */
  function clear(s, nodes, t) {
    nodes.forEach((n) => s.hide(n, t, 0.25));
  }

  /** A loop around a sticker. Stickers wait at scale 0, which would measure as nothing. */
  function circleSticker(s, tag, t, opts) {
    const waiting = tag.style.scale;
    tag.style.scale = '1';
    s.circle(tag, t, opts);
    tag.style.scale = waiting;
  }

  /** A page of writing, the passage as a picture. .band is its middle, .detail its one small line. */
  function sheet() {
    const row = (cls, y, w) => `<rect class="${cls}" x="44" y="${y}" width="${w}" height="20" rx="8" fill="${RULE}"/>`;
    return `<rect x="0" y="0" width="400" height="340" rx="14" fill="${PAPER}"/>
      <text x="200" y="56" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="42" fill="${DARK}">The passage</text>
      ${row('r', 88, 312)}${row('band', 128, 312)}${row('band', 168, 296)}${row('band', 208, 312)}${row('r', 248, 280)}${row('detail', 288, 170)}`;
  }

  /** One flower: .stem draws, .leaf appears, .head pops open. */
  function flower(x, ground, tall, petal, r = 46) {
    const y = ground - tall;
    const petals = [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${x}" cy="${y - r * 0.62}" rx="${r * 0.48}" ry="${r * 0.68}" transform="rotate(${a} ${x} ${y})" fill="${petal}"/>`).join('');
    return `<g class="fl">
      <path class="stem" d="M${x},${ground} Q${x - 14},${ground - tall / 2} ${x},${y}" fill="none" stroke="${LEAF}" stroke-width="13" stroke-linecap="round"/>
      <path class="leaf" d="M${x - 8},${ground - tall * 0.34} q-46,-30 -62,6 q40,18 62,-6 Z" fill="${LEAF}"/>
      <g class="head">${petals}<circle cx="${x}" cy="${y}" r="${r * 0.36}" fill="#fff3c4" stroke="#d99a1e" stroke-width="4"/></g></g>`;
  }

  /** Grow one flower: stem first, then the head opens. */
  function growFlower(s, n, t, gain = 0.3) {
    s.draw(n.querySelector('.stem'), t, 0.35, { gain: gain * 0.7 });
    s.appear(n.querySelector('.leaf'), t + 0.2, 0.2);
    s.pop(n.querySelector('.head'), t + 0.25, { gain });
  }

  /** One fat bee, big enough to read on a phone. */
  function bee(x, y) {
    return `<g class="bee">
      <g class="wings"><ellipse cx="${x - 8}" cy="${y - 30}" rx="15" ry="24" fill="#eaf6ff" stroke="#2a2a2a" stroke-width="3" transform="rotate(-18 ${x - 8} ${y - 30})"/>
      <ellipse cx="${x + 14}" cy="${y - 30}" rx="15" ry="24" fill="#eaf6ff" stroke="#2a2a2a" stroke-width="3" transform="rotate(18 ${x + 14} ${y - 30})"/></g>
      <ellipse cx="${x}" cy="${y}" rx="38" ry="25" fill="#ffd66b" stroke="#2a2a2a" stroke-width="4"/>
      <path d="M${x - 12},${y - 23} V${y + 23} M${x + 8},${y - 24} V${y + 24}" stroke="#2a2a2a" stroke-width="9"/>
      <circle cx="${x + 26}" cy="${y - 6}" r="4.5" fill="#2a2a2a"/></g>`;
  }

  /** A sun for "two summers". */
  function sun(x, y) {
    const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M${x},${y - 38} V${y - 56}" stroke="#ffd66b" stroke-width="9" stroke-linecap="round" transform="rotate(${a} ${x} ${y})"/>`).join('');
    return `<g class="sun">${rays}<circle cx="${x}" cy="${y}" r="30" fill="#ffd66b"/></g>`;
  }

  /** The garden from the passage: ground, five flowers, two suns and six bees. */
  function gardenScene() {
    const flowers = [[120, 186], [320, 236], [520, 196], [720, 244], [920, 190]].map(([x, tall], i) => flower(x, 366, tall, PETALS[i])).join('');
    const bees = [[225, 120], [425, 70], [620, 110], [824, 134], [60, 96], [1020, 196]].map(([x, y]) => bee(x, y)).join('');
    return `<path class="ground" d="M6,366 Q540,346 1074,366" fill="none" stroke="${LEAF}" stroke-width="12" stroke-linecap="round"/>
      ${flowers}${sun(925, 56)}${sun(1048, 56)}${bees}`;
  }

  /** A bee flies in from the side and hovers for the rest of the page, as one long path. */
  function buzz(s, node, t, until, seed) {
    node.style.opacity = 0;
    const dur = until - t, steps = Math.ceil(dur / 0.2), frames = [], flaps = [];
    const fromX = 560 + seed * 40, fromY = -60 + ((seed * 53) % 120);
    for (let i = 0; i <= steps; i++) {
      const at = (i * dur) / steps, near = 1 - (1 - Math.min(1, at / 0.8)) ** 2;
      const x = fromX * (1 - near) + 16 * Math.sin(at * 2.3 + seed);
      const y = fromY * (1 - near) + 13 * Math.sin(at * 3.7 + seed * 2);
      frames.push({ translate: `${x.toFixed(1)}px ${y.toFixed(1)}px`, opacity: Math.min(1, at / 0.15), offset: i / steps });
    }
    s.anim(node, frames, t, dur, 'linear');
    const wings = node.querySelector('.wings'), beats = Math.ceil(dur * 15);
    wings.style.transformBox = 'fill-box';
    wings.style.transformOrigin = '50% 100%';
    for (let i = 0; i <= beats; i++) flaps.push({ scale: i % 2 ? '1 0.55' : '1 1', offset: i / beats });
    s.anim(wings, flaps, t, dur, 'linear');
  }

  /** The whole planet, with a garden on every side, for "all gardens everywhere". */
  function planet() {
    const flowers = [[60, 92], [150, 40], [244, 92], [34, 200], [266, 204], [150, 300]].map(([x, y], i) => flower(x, y, 34, PETALS[i % 5], 26)).join('');
    return `<circle cx="150" cy="170" r="112" fill="#9fd0ff"/>
      <path d="M92,92 q44,-22 66,10 q18,28 -10,46 q-34,12 -54,-14 q-16,-22 -2,-42 Z M176,170 q40,-14 62,14 q6,32 -30,50 q-32,6 -44,-22 q-4,-30 12,-42 Z M88,206 q26,-8 38,14 q2,24 -24,28 q-28,-6 -14,-42 Z" fill="${LEAF}"/>
      ${flowers}`;
  }

  /** The newspaper: a masthead, room for the headline, and columns of small print. */
  function newspaper() {
    const col = (x, w) => [0, 1, 2].map((i) => `<rect x="${x}" y="${346 + i * 24}" width="${i === 2 ? w * 0.7 : w}" height="12" rx="5" fill="${RULE}"/>`).join('');
    return `<rect x="0" y="0" width="900" height="424" rx="12" fill="${PAPER}"/>
      <text x="450" y="50" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="42" fill="${DARK}">The Daily Monster</text>
      <path d="M28,66 H872 M28,74 H872" stroke="${DARK}" stroke-width="3"/>
      ${col(40, 250)}${col(325, 250)}${col(610, 250)}`;
  }

  /** Answer choices, not looked at yet. Each .cardN pops in on its own. */
  function cards() {
    return ['A', 'B', 'C'].map((name, i) => `<g class="card${i}"><rect x="${i * 300}" y="0" width="250" height="240" rx="20" fill="#9fd0ff" stroke="#16352b" stroke-width="5"/>
      <text x="${i * 300 + 125}" y="160" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="130" fill="#16352b">${name}</text></g>`).join('');
  }

  /** Stacked bricks standing on the floor, one .brick per step from the floor up. */
  function bricks(cx, floor, count, w = 250, h = 96) {
    let out = '';
    for (let i = 0; i < count; i++) {
      out += `<rect class="brick" x="${cx - w / 2}" y="${floor - (i + 1) * h + 3}" width="${w}" height="${h - 6}" rx="10" fill="${BLOCK}" stroke="#16352b" stroke-width="4"/>`;
    }
    return out;
  }

  /** The Idea page: one frame shows all three sizes on a page of writing. */
  function scopeDemo(s, c) {
    const page = s.shape(sheet(), { x: 500, y: 276, w: 400, h: 340 });
    const fitsPage = { x: 484, y: 260, w: 432, h: 372 };
    const onDetail = { x: 532, y: 552, w: 186, h: 48 };
    s.pop(page, c.cen);
    const f = s.frame(fitsPage, c.cen + 0.1, { color: s.ink.teal });
    s.m.point({ x: 700, y: 440 }, c.cen, 1.8);

    const band = [...page.querySelectorAll('.band')];
    band.forEach((n, i) => s.anim(n, [{ fill: RULE }, { fill: STRONG_TEAL }], c.word('central') + i * 0.1, 0.2, 'linear'));
    const point = s.tag('central point', { x: 250, y: 300, at: c.word('central'), bg: s.ink.teal, size: 52 });

    band.forEach((n) => s.anim(n, [{ fill: STRONG_TEAL }, { fill: RULE }], c.not, 0.2, 'linear'));
    f.to(onDetail, c.not, 0.6);
    recolor(s, f, s.ink.teal, HOT_PINK, c.not);
    dim(s, point, c.not, 0.45);
    s.anim(page.get('.detail'), [{ fill: RULE }, { fill: s.ink.pink }], c.word('small'), 0.2, 'linear');
    const detail = s.tag('small detail', { x: 250, y: 420, at: c.word('small'), bg: s.ink.pink, size: 52 });
    s.m.point(centerOf(onDetail), c.word('small'), 1.1);

    f.to({ x: 40, y: 192, w: 1148, h: 530 }, c.big, 0.7);
    recolor(s, f, HOT_PINK, s.ink.orange, c.big);
    dim(s, detail, c.big, 0.45);
    s.tag('giant claim', { x: 250, y: 540, at: c.word('giant'), bg: s.ink.orange, size: 52 });
    s.m.mood('wow', c.word('giant'), 1.2);
    [[1010, 220], [1040, 380], [960, 560]].forEach(([x, y], i) => s.text('?', { x, y, size: 130, color: s.ink.orange, at: c.word('passage', 1) + i * 0.16, dur: 0.15, quiet: true }));
    s.m.act('shake', c.word('never'), 0.7);
  }

  /** The garden grows, summers pass and bees arrive, each on the word that says it. */
  function growGarden(s, c) {
    const g = s.shape(gardenScene(), { x: 40, y: 340, w: 1080, h: 400 });
    s.draw(g.get('.ground'), c.a, 0.6, { gain: 0.3 });
    const grown = [c.word('garden'), c.word('planted'), c.word('native'), c.word('native') + 0.25, c.word('flowers')];
    [...g.querySelectorAll('.fl')].forEach((n, i) => growFlower(s, n, grown[i]));
    const suns = [...g.querySelectorAll('.sun')];
    s.pop(suns[0], c.word('two'), { gain: 0.3 });
    s.pop(suns[1], c.word('summers'), { gain: 0.3 });
    const landed = ['drew', 'more', 'visits', 'from', 'local', 'pollinators'].map((w) => c.word(w));
    [...g.querySelectorAll('.bee')].forEach((n, i) => buzz(s, n, landed[i], c.end + 5, i + 1));
    s.m.look(g, c.a, 2.4);
    s.m.mood('happy', c.word('flowers'), 1.2);
    s.m.point({ x: 800, y: 460 }, c.word('visits'), 1.3);
    return g;
  }

  /** What an option looks like in the slot under the passage. */
  const OPTION = { x: 58, size: 76, align: 'left' };
  const optionLabel = (s, text, bg, at) => s.tag(text, { x: 54, y: 346, at, bg, size: 56, align: 'left' });

  /** Too narrow: the frame shrinks to the one clause and a single flower grows. */
  function tooNarrow(s, c, v, f) {
    const tiny = fit([v.s1.find('garden'), v.s1.find('planted'), v.s1.find('native'), v.s1.find('flowers')]);
    f.to(tiny, c.word('narrow') - 0.2, 0.6);
    s.m.point(centerOf(tiny), c.word('narrow'), 1.2);
    const label = optionLabel(s, 'Too narrow', s.ink.pink, c.word('narrow'));
    const line = s.spoken('The garden planted flowers.', c, c.n, { ...OPTION, y: 450, color: s.ink.pink });
    const lone = s.shape(flower(135, 330, 190, PETALS[0], 62), { x: 850, y: 356, w: 270, h: 360 });
    growFlower(s, lone.get('.fl'), c.word('flowers') - 0.25, 0.5);
    const note = s.tag('True, but just a detail', { x: 54, y: 556, at: c.tr, bg: s.ink.pink, size: 54, align: 'left' });
    s.m.act('nod', c.tr, 0.8);
    clear(s, [label, line, note, lone], c.broad);
  }

  /** Too broad: the frame balloons past the passage and the whole planet fills with gardens. */
  function tooBroad(s, c, f) {
    const pale = s.ink.orange;
    f.to(HUGE, c.word('broad') - 0.2, 0.7);
    recolor(s, f, HOT_PINK, pale, c.word('broad') - 0.2);
    s.m.mood('wow', c.word('broad'), 1.1);
    const label = optionLabel(s, 'Too broad', pale, c.word('broad'));
    const a = s.spoken('All gardens everywhere', c, c.b, { ...OPTION, y: 450, color: pale });
    const b = s.spoken('save pollinators.', c, c.word('save'), { ...OPTION, y: 540, color: pale });
    s.mark(a.find('All'), c.word('all'), { color: pale, hold: c.just - c.word('all') });
    s.mark(a.find('everywhere'), c.word('everywhere'), { color: pale, hold: c.just - c.word('everywhere') });
    const world = s.shape(planet(), { x: 800, y: 370, w: 300, h: 340 });
    s.pop(world, c.word('gardens'), { gain: 0.5 });
    [...world.querySelectorAll('.fl')].forEach((n, i) => s.pop(n, c.word('everywhere') + i * 0.14, { gain: 0.25 }));
    const note = s.tag('The passage never said that', { x: 54, y: 638, at: c.nv, bg: s.ink.red, size: 50, align: 'left' });
    s.m.act('shake', c.word('never'), 0.8);
    const lines = [s.strike(a, c.word('never'), { dim: 1 }), s.strike(b, c.word('said'), { dim: 1 })];
    clear(s, [label, a, b, note, world, ...lines], c.just);
  }

  /** Just right: the frame settles on the passage and each word of the answer lights up its source. */
  function justRight(s, c, v, f) {
    f.to(PANEL, c.just, 0.7);
    recolor(s, f, s.ink.orange, s.ink.teal, c.just);
    optionLabel(s, 'Just right', s.ink.teal, c.word('right'));
    const a = s.spoken('This neighborhood garden increased', c, c.r, { ...OPTION, y: 450, color: s.ink.yellow });
    const b = s.spoken('local pollinator visits.', c, c.word('local'), { ...OPTION, y: 540, color: s.ink.yellow });
    s.mark(v.s1.find('neighborhood'), c.word('neighborhood'));
    s.mark(v.s1.find('garden'), c.word('garden', 1));
    s.mark(v.s3.find('drew'), c.word('increased'));
    s.mark(v.s3.find('more'), c.word('increased') + 0.12);
    s.mark(v.s3.find('local'), c.word('local'));
    s.mark(v.s3.find('pollinators'), c.word('pollinator'));
    s.mark(v.s3.find('visits'), c.word('visits'));
    s.m.mood('proud', c.r, 3);
    s.m.look(a, c.r, 2.2);
    s.stars(b, c.word('visits') + 0.25, 9);
  }

  /** Always and all stand tall, because very strong support holds them up. */
  function strongSide(s, c, floor) {
    const big = { size: 112, color: s.ink.red };
    const alw = s.text('always', { ...big, x: 195, y: 92, at: c.word('always'), dur: 0.3 });
    const all = s.text('all', { ...big, x: 510, y: 92, at: c.word('all'), dur: 0.2 });
    const marks = [s.mark(alw, c.word('always'), { color: s.ink.red }), s.mark(all, c.word('all'), { color: s.ink.red })];
    s.m.look(alw, c.word('always'), 1.2);
    const ground = s.shape(`<path class="floor" d="M40,${floor} H1120" fill="none" stroke="#f5f3ea" stroke-width="7" stroke-linecap="round"/>`);
    s.draw(ground.get('.floor'), c.need, 0.4, { gain: 0.3 });
    const strong = s.shape(bricks(195, floor, 4) + bricks(510, floor, 4));
    const onWord = ['they', 'need', 'very', 'strong'].map((w) => c.word(w));
    [...strong.querySelectorAll('.brick')].forEach((n, i) => s.pop(n, onWord[i % 4] + (i > 3 ? 0.08 : 0), { gain: 0.3 }));
    const note = s.tag('very strong support', { x: 352, y: 654, at: c.word('support'), bg: s.ink.teal, size: 52 });
    s.m.point({ x: 510, y: 400 }, c.word('strong'), 1);
    dim(s, [alw, all, ...marks, strong, note], c.if, 0.4);
  }

  /** Some and may are one brick high, so an always dropped on them topples straight off. */
  function weakSide(s, c, floor) {
    s.tag('the author said', { x: 848, y: 654, at: c.word('author'), bg: '#9fd0ff', size: 50 });
    const word = { size: 100, color: s.ink.teal, y: 448 };
    s.text('some', { ...word, x: 750, at: c.word('some'), dur: 0.25 });
    s.text('may', { ...word, x: 945, at: c.word('may'), dur: 0.2 });
    const weak = s.shape(bricks(750, floor, 1, 190, 84) + bricks(945, floor, 1, 190, 84));
    const stubs = [...weak.querySelectorAll('.brick')];
    s.pop(stubs[0], c.word('some'), { gain: 0.3 });
    s.pop(stubs[1], c.word('may'), { gain: 0.3 });

    const yours = s.tag('your answer', { x: 848, y: 92, at: c.word('your'), bg: s.ink.yellow, size: 52 });
    s.hide(yours, c.word("can't"), 0.15);
    s.tag("can't say always", { x: 848, y: 92, at: c.word("can't"), bg: s.ink.red, size: 52 });
    const plank = s.text('always', { size: 104, color: '#1d3a31', x: 832, y: 322, at: c.word('answer'), dur: 0.04, quiet: true });
    Object.assign(plank.style, { background: s.ink.red, borderRadius: '14px', padding: '0 16px', textShadow: 'none', transformOrigin: '100% 100%' });
    s.anim(plank, [{ translate: '0px -140px' }, { translate: '0px 0px' }], c.word('answer'), 0.26, 'cubic-bezier(.5,0,.8,.4)');
    s.sfx('pop', c.word('answer') + 0.26, 0.7);
    s.anim(plank, [{ translate: '0px 0px', rotate: '0deg' }, { translate: '0px 0px', rotate: '12deg', offset: 0.35 }, { translate: '50px 200px', rotate: '88deg' }], c.word('say'), 0.55, 'ease-in');
    s.sfx('boing', c.word('say') + 0.5, 0.7);
    s.m.act('shake', c.word("can't"), 0.9);
    s.m.mood('oops', c.word('say'), 1.3);
  }

  LessonStudio.define({
    id: 'mainidea',
    teacher: 'tealy',
    title: 'Keep the right scope',
    beats: [
      {
        say: `{hi}Hello, I'm Tealy. {love}I love reading. {sec}And here's my secret for main idea questions: {size}it's all about size.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.2);
          s.m.mood('happy', c.love, 1.1);
          s.wideCam(c.sec - 0.3, 1.1);
          s.text('Keep the right scope', { y: 120, size: 112, color: s.ink.yellow, at: c.sec + 0.2, dur: 1 });
          s.tag('main idea questions', { x: 614, y: 290, at: c.word('main'), bg: '#9fd0ff', size: 56 });
          const line = s.spoken("It's all about size", c, c.size, { y: 430, size: 116 });
          const size = line.find('size');
          s.mark(size, c.word('size'));
          s.tag('scope = size', { x: 614, y: 590, at: c.word('size') + 0.3, bg: s.ink.yellow, size: 56 });
          s.m.mood('sly', c.size, 1.6);
          s.m.point(size, c.size, 1);
        },
      },
      {
        page: 'The idea',
        say: `{main}A main idea has to be the right size. {cen}It covers the central point of the passage. {not}Not just one small detail. {big}And not some giant claim the passage never made.`,
        run(s, c) {
          const head = s.words(['Main', 'idea:', 'the', 'right', 'size'], { y: 84, size: 96, times: ['main', 'idea', 'the', 'right', 'size'].map((w) => c.word(w)) });
          s.mark(head.find('right'), c.word('right'));
          s.mark(head.find('size'), c.word('size'));
          s.m.look(head, c.main, 1.6);
          scopeDemo(s, c);
        },
      },
      {
        page: 'Watch me',
        say: `{p}Here's a passage. {a}A neighborhood garden planted native flowers. {b}Over two summers, those flowers drew more visits from local pollinators.`,
        run(s, c, v) {
          const panel = s.shape(`<rect class="back" x="0" y="0" width="${PANEL.w}" height="${PANEL.h}" rx="18" fill="rgba(245,243,234,.07)" stroke="rgba(245,243,234,.45)" stroke-width="4"/>`, { ...PANEL, layer: 'under' });
          s.appear(panel, c.p, 0.25);
          s.draw(panel.get('.back'), c.p, 0.7, { gain: 0.4 });
          s.m.point(centerOf(PANEL), c.p, 1);

          const line = { x: 84, size: 64, align: 'left' };
          v.s1 = s.spoken('A neighborhood garden planted native flowers.', c, c.a, { ...line, y: 88 });
          v.s2 = s.spoken('Over two summers, those flowers', c, c.b, { ...line, y: 168 });
          v.s3 = s.spoken('drew more visits from local pollinators.', c, c.word('drew'), { ...line, y: 248 });
          v.garden = growGarden(s, c);
          s.mark(v.s3.find('drew'), c.word('drew'), { hold: c.end + 0.3 - c.word('drew') });
          s.mark(v.s3.find('more'), c.word('more'), { hold: c.end + 0.3 - c.word('more') });
        },
      },
      {
        say: `{narrow}Too narrow: {n}the garden planted flowers. {tr}True, but just a detail. {broad}Too broad: {b}all gardens everywhere save pollinators. {nv}The passage never said that. {just}Just right: {r}this neighborhood garden increased local pollinator visits.`,
        run(s, c, v) {
          const f = s.frame(PANEL, c.narrow, { color: HOT_PINK });
          s.hide(v.garden, c.narrow, 0.35);
          tooNarrow(s, c, v, f);
          tooBroad(s, c, f);
          justRight(s, c, v, f);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{fast}Here's the fast way. {write}Before you look at the options, write a short headline for the passage. {paper}Like a newspaper. {h}Garden draws more local pollinators. {then}Then find the answer that matches.`,
        run(s, c) {
          const fast = s.text('The fast way', { y: 84, size: 104, color: s.ink.yellow, at: c.word('fast'), dur: 0.5 });
          s.m.act('thumbs', c.fast, 1);
          s.m.mood('sly', c.fast, 1.4);

          const deck = s.shape(cards(), { x: 189, y: 280, w: 850, h: 240 });
          ['look', 'at', 'options'].forEach((w, i) => s.pop(deck.get('.card' + i), c.word(w), { gain: 0.4 }));
          s.m.act('stop', c.word('look'), 1);
          s.hide(fast, c.word('write'), 0.2);
          s.move(deck, 0, 560, c.word('write'), 0.5);

          const line = s.spoken('Write a short headline', c, c.word('write'), { y: 78, size: 100 });
          s.mark(line.find('headline'), c.word('headline'));
          s.m.point(line.find('headline'), c.word('headline'), 1.2);
          const passage = s.shape(sheet(), { x: 414, y: 242, w: 400, h: 340 });
          s.pop(passage, c.word('passage'), { gain: 0.4 });
          s.hide(passage, c.paper, 0.2);

          const paper = s.shape(newspaper(), { x: 164, y: 200, w: 900, h: 424 });
          paper.style.scale = '0';
          s.anim(paper, [{ scale: 0, rotate: '-900deg' }, { scale: 1, rotate: '0deg' }], c.paper, 0.85, 'cubic-bezier(.2,.75,.25,1)');
          s.sfx('whoosh', c.paper, 0.8);
          s.m.mood('wow', c.word('newspaper'), 1);

          const head = { size: 104, color: DARK };
          const h1 = s.spoken('Garden draws more', c, c.h, { ...head, y: 280 });
          s.spoken('local pollinators', c, c.word('local'), { ...head, y: 376 });
          s.m.point(h1, c.h, 1.6);

          const y = 638, size = 52;
          const a = s.tag('too narrow', { x: 214, y, at: c.word('find'), bg: s.ink.pink, size });
          const b = s.tag('just right', { x: 614, y, at: c.word('answer'), bg: s.ink.teal, size });
          const d = s.tag('too broad', { x: 1000, y, at: c.word('that'), bg: s.ink.orange, size });
          dim(s, [a, d], c.word('matches'));
          circleSticker(s, b, c.word('matches'), { color: s.ink.yellow, pad: 12 });
          s.stars(b, c.word('matches') + 0.2, 9);
          s.m.act('nod', c.word('matches'), 0.7);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}A town's new bike lane cut commute times for local riders. {m}Main idea? Choice {o1}A: bikes are the best way to travel. Choice {o2}B: one town's bike lane helped its riders. {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          v.town = s.spoken("A town's new bike lane cut commute times for local riders.", c, c.a, { size: 74, wrap: 980, x: 60, y: 84, leading: 1.2 });
          s.m.look(v.town, c.a, 2.6);
          const q = s.tag('Main idea?', { x: 60, y: 276, at: c.m, bg: s.ink.yellow, size: 56, align: 'left' });
          s.m.point(q, c.m, 0.7);
          const opt = { x: 60, size: 70, align: 'left', color: s.ink.teal };
          v.a = s.spoken('A Bikes are the best way to travel.', c, c.o1, { ...opt, y: 382 });
          v.b = s.spoken('B One town’s bike lane helped its riders.', c, c.o2, { ...opt, y: 486 });
          s.mark(v.a.w[0], c.o1, { color: s.ink.teal });
          s.mark(v.b.w[0], c.o2, { color: s.ink.teal });
          s.m.point(v.a, c.o1, 1);
          s.m.point(v.b, c.o2, 1.3);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}B! Choice {why}A goes way bigger than the passage.`,
        run(s, c, v) {
          s.mark(v.b, c.ans, { dur: 0.3 });
          s.stars(v.b, c.ans + 0.1, 9);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
          const f = s.frame(fit(v.a, 12, 2), c.why, { color: s.ink.orange });
          f.to(HUGE, c.word('way'), 0.7);
          s.strike(v.a, c.word('bigger'));
          s.tag('way bigger than the passage', { x: 614, y: 610, at: c.word('way'), bg: s.ink.orange, size: 54 });
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{w}Watch for words like always, and all. {need}They need very strong support. {if}If the author said some, {may}or may, {cant}your answer can't say always.`,
        run(s, c) {
          const floor = 640;
          strongSide(s, c, floor);
          weakSide(s, c, floor);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{m}Match the author's scope, {how}and how certain they are. {bye}Now hit Try this skill, and happy reading!`,
        run(s, c) {
          const a = s.spoken("Match the author's scope,", c, c.m, { y: 130, size: 112 });
          s.mark(a.find('scope'), c.word('scope'));
          const b = s.spoken('and how certain they are.', c, c.how, { y: 280, size: 112 });
          s.mark(b.find('certain'), c.word('certain'), { color: s.ink.teal });
          s.m.mood('proud', c.how, 3);
          const next = s.tag('Next: Try this skill', { x: 614, y: 480, at: c.word('try'), bg: '#ffd66b', size: 60 });
          s.m.point(next, c.bye, 1);
          s.m.act('wave', c.word('happy'), 1.6);
          s.confetti(c.word('happy'));
        },
      },
    ],
  });
})();
