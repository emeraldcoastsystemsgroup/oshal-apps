/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Predict meaning in context: a dictionary is crossed out for a lens that reads, a hypothesis grows feet and walks off to show the wrong meaning, a sheet covers the choices while a sticky note takes the word's place, the student's own word flies down to its match, one word stays put while a car and a researcher give it two jobs, a floppy review fails to cut paper, a tone needle swings, and a wrong word falls out of the grammar slot
 */
(function () {
  const DARK = '#1d3a31', PAPER = '#f5f3ea', RULE = '#c9c4b0', SUN = '#ffd66b', MINT = '#8fe6cf', PINK = '#ff9ccf', SKY = '#9fd0ff', RED = '#ff5a5f', ORANGE = '#ffb066', COVER = '#3d6fb5';
  const FREDOKA = 'font-family="Fredoka" font-weight="600"';

  /** The answer rows on the Watch me page. */
  const ROW = { x: 70, y: [348, 458, 568], w: 640, h: 98 };
  const CHOICES = [['A', 'moved forward'], ['B', 'proposed'], ['C', 'improved']];

  /** The tone dial on the Watch out page: its pivot and radius. */
  const DIAL = { x: 250, y: 500, r: 150 };

  /** Where a node sits on the board. Valid during build, before anything has moved. */
  function boxOn(node) {
    const r = node.getBoundingClientRect();
    return { x: r.left - 58, y: r.top - 44, w: r.width, h: r.height, cx: r.left - 58 + r.width / 2, cy: r.top - 44 + r.height / 2 };
  }

  /** A frame rectangle that fits these nodes, in board coordinates. */
  function around(nodes, padX = 18, padY = 2) {
    const boxes = nodes.map(boxOn);
    const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: left - padX, y: top - padY, w: right - left + padX * 2, h: bottom - top + padY * 2 };
  }

  /** A loop around a sticker. Stickers wait at scale 0, which would measure as nothing. */
  function circleSticker(s, tag, t, opts) {
    const waiting = tag.style.scale;
    tag.style.scale = '1';
    s.circle(tag, t, opts);
    tag.style.scale = waiting;
  }

  /** A closed dictionary. */
  function closedBook(x, y) {
    return `<g class="book"><rect x="${x + 10}" y="${y + 10}" width="380" height="350" rx="14" fill="${PAPER}" stroke="${DARK}" stroke-width="4"/>
      <rect x="${x}" y="${y}" width="380" height="350" rx="14" fill="${COVER}" stroke="${DARK}" stroke-width="5"/>
      <rect x="${x + 20}" y="${y + 20}" width="340" height="310" rx="8" fill="none" stroke="${SUN}" stroke-width="5"/>
      <text x="${x + 190}" y="${y + 170}" text-anchor="middle" ${FREDOKA} font-size="58" fill="${SUN}">Dictionary</text>
      <text x="${x + 190}" y="${y + 240}" text-anchor="middle" ${FREDOKA} font-size="46" fill="${PAPER}">A to Z</text></g>`;
  }

  /** The dictionary open at the word from the student's turn. Its pages grow out of the spine. */
  function openBook(x, y) {
    const w = 300, h = 270;
    return `<rect class="back" x="${x - 18}" y="${y - 12}" width="${2 * w + 36}" height="${h + 30}" rx="16" fill="${COVER}" stroke="${DARK}" stroke-width="5"/>
      <g class="left"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${PAPER}" stroke="${DARK}" stroke-width="4"/>
        <text x="${x + w / 2}" y="${y + 160}" text-anchor="middle" ${FREDOKA} font-size="84" fill="${DARK}">sharp</text></g>
      <g class="right"><rect x="${x + w}" y="${y}" width="${w}" height="${h}" rx="10" fill="${PAPER}" stroke="${DARK}" stroke-width="4"/>
        <text x="${x + w * 1.5}" y="${y + 118}" text-anchor="middle" font-family="Chalk" font-size="68" fill="${DARK}">pointed,</text>
        <text x="${x + w * 1.5}" y="${y + 194}" text-anchor="middle" font-family="Chalk" font-size="68" fill="${DARK}">like a knife</text></g>`;
  }

  /** A page of writing, for the reading lens to travel over. */
  function readingPage(x, y) {
    const row = (i, w) => `<rect x="${x + 34}" y="${y + 40 + i * 58}" width="${w}" height="24" rx="10" fill="${RULE}"/>`;
    return `<g class="page"><rect x="${x}" y="${y}" width="470" height="264" rx="14" fill="${PAPER}" stroke="${DARK}" stroke-width="4"/>${row(0, 402)}${row(1, 380)}${row(2, 402)}${row(3, 250)}</g>`;
  }

  /** A magnifying glass, centered on its origin so it can be slid anywhere. */
  function lens() {
    return `<g class="lens"><path d="M44,44 L96,96" stroke="${DARK}" stroke-width="26" stroke-linecap="round"/><path d="M44,44 L96,96" stroke="${ORANGE}" stroke-width="15" stroke-linecap="round"/>
      <circle r="60" fill="rgba(159,208,255,.38)" stroke="${DARK}" stroke-width="20"/><circle r="60" fill="none" stroke="${ORANGE}" stroke-width="11"/></g>`;
  }

  /** Slide the lens along rows of writing, left to right, row after row. */
  function sweep(s, node, rows, t, dur) {
    const units = rows.length * 4 + rows.length - 1, frames = [];
    rows.forEach(([x0, x1, y], i) => {
      frames.push({ translate: `${x0}px ${y}px`, offset: (i * 5) / units });
      frames.push({ translate: `${x1}px ${y}px`, offset: (i * 5 + 4) / units });
    });
    s.anim(node, frames, t, dur, 'linear');
    s.sfx('whoosh', t, 0.3);
  }

  /** A thought cloud with its trail of little bubbles running off toward the student. */
  function thoughtCloud() {
    const puffs = [[190, 508, 112, 76], [320, 456, 128, 88], [470, 440, 138, 92], [610, 462, 124, 84], [700, 520, 92, 66], [560, 566, 134, 66], [350, 572, 150, 66]];
    return `<g class="cloud">${puffs.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${PAPER}"/>`).join('')}</g>
      <g class="trail"><circle class="d0" cx="840" cy="590" r="30" fill="${PAPER}"/><circle class="d1" cx="915" cy="640" r="20" fill="${PAPER}"/><circle class="d2" cx="968" cy="682" r="12" fill="${PAPER}"/></g>`;
  }

  /** Two legs in big shoes, standing on a word that sits at x, y on the board. */
  function legs(x, y, span) {
    const leg = (cls, at) => `<g class="${cls}"><path d="M${at},${y} V${y + 34}" stroke="${PAPER}" stroke-width="10" stroke-linecap="round"/><ellipse cx="${at + 14}" cy="${y + 42}" rx="30" ry="13" fill="${SUN}" stroke="${DARK}" stroke-width="3"/></g>`;
    return leg('l', x) + leg('r', x + span);
  }

  /** March a word and its legs across the board: the word bobs and the shoes lift in turn. */
  function walk(s, nodes, legsSvg, dist, t, dur) {
    const steps = Math.max(2, Math.round(dur / 0.32)), frames = [];
    for (let i = 0; i <= steps; i++) frames.push({ translate: `${(dist * i) / steps}px ${i % 2 && i < steps ? -11 : 0}px` });
    nodes.forEach((n) => { s.anim(n, frames, t, dur, 'linear'); n._tx = dist; n._ty = 0; });
    const lift = [{ translate: '0px 0px' }, { translate: '20px -22px', offset: 0.5 }, { translate: '0px 0px' }];
    for (let i = 0; i < steps; i++) {
      const at = t + (i * dur) / steps;
      s.anim(legsSvg.get(i % 2 ? '.r' : '.l'), lift, at, dur / steps, 'ease-in-out', 'none');
      s.sfx('tick', at + dur / steps / 2, 0.4);
    }
  }

  /** One answer card, its words not readable yet. */
  function answerCard(i) {
    const y = ROW.y[i], mid = y + ROW.h / 2;
    return `<g class="card${i}"><rect x="${ROW.x}" y="${y}" width="${ROW.w}" height="${ROW.h}" rx="14" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/>
      <circle cx="${ROW.x + 54}" cy="${mid}" r="35" fill="${SKY}" stroke="${DARK}" stroke-width="3"/>
      <text x="${ROW.x + 54}" y="${mid + 19}" text-anchor="middle" ${FREDOKA} font-size="54" fill="${DARK}">${CHOICES[i][0]}</text>
      <rect class="scribble" x="${ROW.x + 116}" y="${y + 36}" width="${[430, 300, 340][i]}" height="26" rx="10" fill="${RULE}"/></g>`;
  }

  /** The sheet the student slides over the answers. */
  function coverSheet() {
    return `<g class="sheet"><g transform="rotate(-1.2 390 506)"><rect x="52" y="342" width="690" height="350" rx="16" fill="rgba(0,0,0,.25)"/>
      <rect x="44" y="332" width="690" height="350" rx="16" fill="${SUN}" stroke="${DARK}" stroke-width="4"/>
      <text x="390" y="532" text-anchor="middle" ${FREDOKA} font-size="88" fill="${DARK}">no peeking!</text></g></g>`;
  }

  /** A sticky note, drawn from its own top-left corner. */
  function stickyNote(w, h) {
    return `<g transform="rotate(-1.4 ${w / 2} ${h / 2})"><rect x="5" y="9" width="${w}" height="${h}" rx="8" fill="rgba(0,0,0,.3)"/><rect width="${w}" height="${h}" rx="8" fill="${SUN}"/>
      <path d="M${w - 36},${h} L${w},${h - 36} L${w},${h} Z" fill="#dfae3e"/></g>`;
  }

  /** A little car from the side, standing on its origin. */
  function sideCar() {
    const wheel = (x) => `<g class="wheel"><circle cx="${x}" cy="-25" r="25" fill="${DARK}"/><circle cx="${x}" cy="-25" r="11" fill="${PAPER}"/><path d="M${x},-43 V-7 M${x - 18},-25 H${x + 18}" stroke="${PAPER}" stroke-width="4"/></g>`;
    return `<g class="car"><path d="M-54,-70 L-28,-114 Q-24,-120 -14,-120 H34 Q44,-120 50,-112 L78,-70 Z" fill="#d7f2ff" stroke="${DARK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M8,-120 V-70" stroke="${DARK}" stroke-width="5"/>
      <rect x="-108" y="-72" width="216" height="54" rx="20" fill="${PINK}" stroke="${DARK}" stroke-width="5"/>${wheel(-62)}${wheel(62)}</g>`;
  }

  /** A light bulb with rays: an idea held up for everyone to look at. */
  function bulb(x, y) {
    const rays = [-70, -35, 0, 35, 70].map((a) => `<path d="M${x},${y - 56} V${y - 78}" stroke="${SUN}" stroke-width="8" stroke-linecap="round" transform="rotate(${a} ${x} ${y})"/>`).join('');
    return `<g class="bulb">${rays}<circle cx="${x}" cy="${y}" r="40" fill="${SUN}" stroke="${DARK}" stroke-width="4"/><rect x="${x - 17}" y="${y + 36}" width="34" height="24" rx="6" fill="${RULE}" stroke="${DARK}" stroke-width="4"/></g>`;
  }

  /** A kitchen knife with its tip to the right. */
  function knife(x, y) {
    return `<g class="knife"><rect x="${x}" y="${y + 4}" width="130" height="56" rx="16" fill="#c9915a" stroke="${DARK}" stroke-width="4"/>
      <path d="M${x + 126},${y} H${x + 440} Q${x + 356},${y + 74} ${x + 126},${y + 74} Z" fill="#e6edf2" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M${x + 150},${y + 18} H${x + 350}" stroke="#fff" stroke-width="7" stroke-linecap="round"/></g>`;
  }

  /** A review on paper: one star out of five. */
  function reviewSheet(cls, x, y) {
    const star = (i) => `<path d="M0,-21 L6,-7 L21,-6 L10,4 L13,19 L0,11 L-13,19 L-10,4 L-21,-6 L-6,-7 Z" transform="translate(${x + 56 + i * 42} ${y + 96})" fill="${i ? RULE : '#f5a623'}" stroke="${DARK}" stroke-width="2.5" stroke-linejoin="round"/>`;
    return `<g class="${cls}"><rect x="${x}" y="${y}" width="280" height="160" rx="12" fill="${PAPER}" stroke="${DARK}" stroke-width="4"/>
      <text x="${x + 140}" y="${y + 56}" text-anchor="middle" ${FREDOKA} font-size="50" fill="${DARK}">Review</text>${[0, 1, 2, 3, 4].map(star).join('')}
      <rect x="${x + 34}" y="${y + 128}" width="212" height="12" rx="6" fill="${RULE}"/></g>`;
  }

  /** The tone dial: harsh on the left, kind on the right, and a needle that points straight up to start. */
  function dial() {
    const { x, y, r } = DIAL;
    return `<path class="harsh" d="M${x - r},${y} A${r},${r} 0 0 1 ${x},${y - r}" fill="none" stroke="#ff8080" stroke-width="36"/>
      <path class="kind" d="M${x},${y - r} A${r},${r} 0 0 1 ${x + r},${y}" fill="none" stroke="${MINT}" stroke-width="36"/>
      <g class="needle"><path d="M${x},${y} V${y - r + 8}" stroke="${PAPER}" stroke-width="13" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="19" fill="${PAPER}"/></g>`;
  }

  /** A word on a colored card, so it can drop into a slot and fall out again. */
  function tile(s, word, x, y, bg, at) {
    return s.text(`<span style="background:${bg};color:${DARK};border-radius:14px;padding:0 14px;text-shadow:none">${word}</span>`, { x, y, size: 76, at, dur: 0.02, quiet: true });
  }

  /** A tick that draws itself. */
  function tick(x, y, k = 1) {
    return `<path class="tick" d="M${x},${y} l${40 * k},${44 * k} l${78 * k},${-98 * k}" fill="none" stroke="${MINT}" stroke-width="${24 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /** Not a dictionary: the book pops in and gets crossed out. Reading: a lens travels over a page. */
  function openingScene(s, c) {
    const memorized = c.word('memorized'), dict = c.word('dictionary');
    s.tag('Vocabulary questions', { x: 614, y: 146, at: c.word('questions'), bg: SKY, size: 50 });
    const book = s.shape(closedBook(96, 236)).get('.book');
    s.pop(book, memorized, { gain: 0.7 });
    s.m.point({ x: 286, y: 410 }, memorized, 0.9);
    const cross = s.shape(`<g fill="none" stroke="${RED}" stroke-width="30" stroke-linecap="round"><path class="a" d="M130,276 L456,578"/><path class="b" d="M456,276 L130,578"/></g>`);
    s.draw(cross.get('.a'), dict + 0.3, 0.16, { gain: 0.5 });
    s.draw(cross.get('.b'), dict + 0.46, 0.16, { gain: 0.5 });
    s.m.act('shake', dict + 0.3, 0.6);

    const page = s.shape(readingPage(650, 236)).get('.page');
    s.pop(page, c.read, { gain: 0.5 });
    const glass = s.shape(lens()).get('.lens');
    const started = c.word('testing', 1);
    s.pop(glass, started, { gain: 0.3 });
    sweep(s, glass, [[700, 1060, 288], [700, 1060, 404]], started, c.end + 0.75 - started);
    const line = s.spoken('you can read', c, c.word('you', 1), { x: 885, y: 516, size: 104, color: MINT });
    s.mark(line.find('read'), c.word('read'));
    s.m.look({ x: 885, y: 360 }, c.read, 1.6);
    s.m.mood('happy', c.read, 2);
  }

  /** The sentence, the meaning your brain jumps to, and a hypothesis that tries walking. */
  function wrongMeaning(s, c, v) {
    const big = { x: 60, size: 112, align: 'left' };
    v.first = s.spoken('The researcher advanced', c, c.a, { ...big, y: 84 });
    v.second = s.spoken('a hypothesis.', c, c.word('a'), { ...big, y: 204 });
    const adv = v.first.find('advanced'), hyp = v.second.find('hypothesis');
    s.mark(adv, c.word('advanced', 1));
    s.m.point(adv, c.word('advanced', 1), 1.1);

    v.bubble = s.shape(thoughtCloud());
    v.cloud = v.bubble.get('.cloud');
    v.trail = v.bubble.get('.trail');
    ['.d2', '.d1', '.d0'].forEach((part, i) => s.pop(v.bubble.get(part), c.brain + i * 0.07, { gain: 0.2 }));
    s.pop(v.cloud, c.word('brain') + 0.1, { gain: 0.6 });
    s.m.look({ x: 450, y: 500 }, c.brain, 1.6);
    v.moved = s.text('moved forward?', { x: 448, y: 454, size: 96, color: DARK, at: c.word('moved'), dur: 0.5 });

    // The word grows legs and tries the meaning out.
    const b = boxOn(hyp), dist = 500;
    const feet = s.shape(legs(b.x + 90, b.y + b.h - 22, 250));
    s.appear(feet, c.like, 0.15);
    s.sfx('pop', c.like, 0.5);
    walk(s, [hyp, feet], feet, dist, c.like + 0.05, Math.max(0.9, c.but - c.like - 0.05));
    s.m.mood('sly', c.like, 1.4);

    // It cannot: the legs vanish, the word drops, and it goes home.
    const dont = c.word("don't"), home = c.word('walk');
    s.anim(feet, [{ opacity: 1 }, { opacity: 0 }], dont, 0.12);
    s.sfx('poof', dont, 0.7);
    s.anim(hyp, [{ translate: `${dist}px 0px` }, { translate: `${dist}px 22px`, offset: 0.45 }, { translate: `${dist}px 0px` }], dont, 0.3, 'ease-in-out');
    s.move(hyp, -dist, 0, home, 0.45);
    v.struck = s.strike(v.moved, home, { dim: 0.5 });
    s.m.act('shake', dont, 0.8);
    s.m.mood('oops', c.but, 1.3);
  }

  /** The two covers: a sheet over the choices and a sticky note over the word. */
  function coverBoth(s, c, v) {
    const named = c.word('choices'), slides = named + 0.28, landed = slides + 0.3;
    [v.cloud, v.trail, v.moved, v.struck].forEach((n) => s.hide(n, c.cover, 0.2));

    const cards = s.shape(CHOICES.map((_, i) => answerCard(i)).join(''), { layer: 'under' });
    v.cards = CHOICES.map((_, i) => cards.get(`.card${i}`));
    v.cards.forEach((n, i) => {
      s.pop(n, named + i * 0.07, { gain: 0.4 });
      s.hide(n.querySelector('.scribble'), landed, 0.02);
    });
    // The real words go on while the sheet is over them.
    v.rows = CHOICES.map(([, word], i) => s.text(word, { x: ROW.x + 116, y: ROW.y[i] + 2, size: 84, color: DARK, align: 'left', at: landed, dur: 0.02, quiet: true }));
    v.sheet = s.shape(coverSheet()).get('.sheet');
    v.sheet.style.translate = '-900px 0px';
    s.anim(v.sheet, [{ translate: '-900px 0px' }, { translate: '0px 0px' }], slides, 0.3, 'cubic-bezier(.3,1.15,.5,1)');
    s.sfx('swipe', slides, 0.8);
    s.m.look({ x: 390, y: 500 }, c.cover, 1.2);

    const adv = v.first.find('advanced'), b = boxOn(adv), hit = c.word('word');
    v.box = { x: b.x - 18, y: b.y + 8, w: b.w + 60, h: b.h - 12 };
    v.mid = { x: v.box.x + v.box.w / 2, y: v.box.y + v.box.h / 2 };
    v.note = s.shape(stickyNote(v.box.w, v.box.h), v.box);
    v.note.style.opacity = 0;
    s.anim(v.note, [{ opacity: 0, translate: '0px -130px' }, { opacity: 1, translate: '0px 0px' }], hit, 0.24, 'cubic-bezier(.3,1.4,.5,1)');
    s.sfx('pop', hit + 0.2, 0.9);
    s.hide(adv, hit + 0.2, 0.04);
  }

  /** Reading past the note, then writing a plain word of your own on it. */
  function ownWord(s, c, v) {
    s.read(v.first, c.from(c.b, 3));
    s.read(v.second, c.from(c.word('a'), 2));
    s.pulse(v.note, c.word('blank'), { to: 1.08 });
    s.m.look(v.note, c.word('blank'), 1);

    const onNote = { x: v.mid.x, y: v.box.y + 2, size: 100, color: DARK };
    const ask = s.text('?', { ...onNote, at: c.simple, dur: 0.15 });
    const simple = s.tag('a simple word', { x: v.mid.x, y: 226, at: c.word('simple'), bg: MINT, size: 54 });
    s.m.point(v.note, c.word('there'), 0.9);
    s.m.mood('hmm', c.simple, 1.6);
    s.hide(ask, c.s1 - 0.04, 0.06);
    const first = s.text('suggested', { ...onNote, at: c.s1, dur: 0.35 });
    s.hide(first, c.p - 0.04, 0.06);
    s.text('proposed', { ...onNote, at: c.p, dur: 0.35 });
    s.m.act('nod', c.p, 0.6);

    s.hide(simple, c.now, 0.12);
    v.own = s.tag('your own word first', { x: v.mid.x, y: 226, at: c.now, bg: MINT, size: 54 });
    s.m.mood('proud', c.now, 1.3);
    s.pulse(v.sheet, c.word('options'), { to: 1.03 });
    s.m.point({ x: 390, y: 500 }, c.word('before'), 1.2);
  }

  /** Off comes the sheet, each choice is held up, and your word flies down to its match. */
  function compareChoices(s, c, v) {
    const off = c.word('uncover');
    s.anim(v.sheet, [{ translate: '0px 0px', rotate: '0deg' }, { translate: '-920px -30px', rotate: '-12deg' }], off, 0.45, 'cubic-bezier(.5,0,.8,.5)');
    s.sfx('whoosh', off, 0.8);
    s.m.look({ x: 390, y: 500 }, off, 1.2);
    s.hide(v.own, c.cmp, 0.12);
    s.tag('compare meanings', { x: v.mid.x, y: 226, at: c.word('compare'), bg: MINT, size: 54 });

    const no = (i, cue, t) => {
      s.mark(v.rows[i], cue, { hold: t - cue });
      s.strike(v.rows[i], t, { dim: 0.5 });
      s.anim(v.cards[i], [{ opacity: 1 }, { opacity: 0.55 }], t, 0.2);
    };
    no(0, c.a, c.no);
    s.m.look(v.rows[0], c.a, 0.8);
    s.m.act('shake', c.no, 0.5);

    s.mark(v.rows[1], c.b);
    s.m.point(v.rows[1], c.b, 1.1);
    const flight = 0.42, spot = { x: 960, y: 462 };
    const flying = s.tag('proposed', { x: v.mid.x, y: v.box.y + 16, at: c.yes, bg: SUN, size: 72 });
    s.move(flying, spot.x - v.mid.x, spot.y - v.box.y - 16, c.yes, flight);
    s.text('=', { x: 760, y: 454, size: 96, color: SUN, at: c.yes + flight, dur: 0.1 });
    s.stars({ x: spot.x, y: spot.y + 48 }, c.yes + flight, 9);
    s.m.mood('proud', c.yes, 1.4);

    no(2, c.d, c.no2);
    s.m.look(v.rows[2], c.d, 0.8);
  }

  /** The rule, with one word in a frame that grows out to the sentence around it. */
  function theRule(s, c, v) {
    const said = ['a', 'word', 'means', 'what', 'the', 'author', 'mean'].map((w) => c.word(w));
    const rule = s.words(['A', 'word', 'means', 'what', 'the', 'author', 'means'], { y: 76, size: 80, times: said });
    s.mark(rule.find('author'), c.word('author'), { color: MINT, hold: 1.3 });

    const row = { y: 204, size: 72 };
    v.adv = s.text('advanced', { x: 627, y: 184, size: 96, color: SUN, at: c.word('word'), dur: 0.3 });
    v.frame = s.frame(around([v.adv]), c.word('word') + 0.1, { color: SUN });
    s.m.point(v.adv, c.word('word'), 1);

    const head = s.text('The researcher', { ...row, x: 460, align: 'right', at: c.here, dur: 0.35 });
    const tail = s.text('a hypothesis.', { ...row, x: 796, align: 'left', at: c.word('this'), dur: 0.35 });
    v.sentence = around([head, v.adv, tail]);
    v.frame.to(v.sentence, c.here, 0.5);
    v.inThis = s.tag('in this sentence', { x: 614, y: 324, at: c.word('this'), bg: SUN, size: 54 });
    s.m.look({ x: 614, y: 240 }, c.here, 1.2);
    v.gone = [head, tail, v.inThis];
  }

  /** The word stays where it is. A car gives it one job, and a researcher gives it another. */
  function twoJobs(s, c, v) {
    v.gone.forEach((n) => s.hide(n, c.car, 0.12));
    const row = { y: 204, size: 72 };

    const who = s.text('The car', { ...row, x: 460, align: 'right', at: c.car, dur: 0.25 });
    v.frame.to(around([who, v.adv]), c.car, 0.4);
    const scene = s.shape(`<path class="road" d="M64,456 H664" fill="none" stroke="${PAPER}" stroke-width="9" stroke-linecap="round"/>${sideCar()}`);
    s.draw(scene.get('.road'), c.car, 0.3, { gain: 0.3 });
    const car = scene.get('.car');
    car.style.translate = '172px 452px';
    s.appear(car, c.word('car'), 0.12);
    const go = c.word('advanced'), dur = Math.max(0.8, c.res - go - 0.1);
    s.anim(car, [{ translate: '172px 452px' }, { translate: '552px 452px' }], go, dur, 'cubic-bezier(.45,.05,.4,1)');
    scene.querySelectorAll('.wheel').forEach((n) => {
      n.style.transformBox = 'fill-box';
      n.style.transformOrigin = '50% 50%';
      s.anim(n, [{ rotate: '0deg' }, { rotate: '900deg' }], go, dur, 'cubic-bezier(.45,.05,.4,1)');
    });
    s.sfx('whoosh', go, 0.7);
    s.m.look({ x: 360, y: 400 }, go, 1.2);
    const moved = s.tag('moved forward', { x: 340, y: 474, at: c.word('moved'), bg: MINT, size: 56 });

    s.hide(who, c.res, 0.12);
    const person = s.text('The researcher', { ...row, x: 460, align: 'right', at: c.res, dur: 0.3 });
    const idea = s.text('a hypothesis.', { ...row, x: 796, align: 'left', at: c.word('a'), dur: 0.3 });
    v.frame.to(around([person, v.adv, idea]), c.res, 0.45);
    s.critter(792, 396, 124, c.word('researcher'), { hue: 300 });
    const light = s.shape(bulb(920, 396)).get('.bulb');
    s.pop(light, c.word('hypothesis'), { gain: 0.6 });
    const proposed = s.tag('proposed', { x: 856, y: 474, at: c.word('proposed'), bg: SUN, size: 56 });
    s.m.point(proposed, c.pr, 0.8);

    s.mark(v.adv, c.same);
    s.m.point(v.adv, c.same, 1);
    s.spoken('Same word, different job.', c, c.same, { y: 584, size: 100 });
    s.pulse(moved, c.job, { to: 1.16 });
    s.pulse(proposed, c.job + 0.12, { to: 1.16 });
    s.m.mood('proud', c.job, 1.2);
  }

  /** The student's turn: the sentence, and a picture for each meaning. */
  function yourTurn(s, c, v) {
    v.sent = s.spoken("The critic's review was sharp.", c, c.a, { x: 60, y: 84, size: 92, align: 'left' });
    const asked = c.word('sharp', 1);
    s.mark(v.sent.find('sharp'), asked);
    s.m.point(v.sent.find('sharp'), asked, 0.8);

    const pics = s.shape(knife(70, 262) + reviewSheet('review', 730, 214));
    v.knife = pics.get('.knife');
    s.pop(v.knife, c.word('knife'), { gain: 0.6 });
    v.pointed = s.tag('pointed, like a knife', { x: 300, y: 372, at: c.word('pointed'), bg: SKY, size: 52 });
    s.text('or', { x: 610, y: 280, size: 76, color: SUN, at: c.word('or'), dur: 0.15 });
    s.pop(pics.get('.review'), c.word('harsh'), { gain: 0.6 });
    v.harsh = s.tag('harsh', { x: 870, y: 372, at: c.word('harsh'), bg: PINK, size: 66 });
    s.m.act('think', c.try + 0.2, 4.6);
    s.m.mood('hmm', c.try + 0.2, 4.6);
    s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
  }

  /** Harsh wins, and a floppy review takes a swing at a sheet of paper. */
  function reviewCantCut(s, c, v) {
    circleSticker(s, v.harsh, c.ans, { color: SUN, pad: 12 });
    s.stars(v.harsh, c.ans + 0.1, 9);
    s.m.act('cheer', c.ans, 1);
    s.m.mood('proud', c.ans, 1.8);
    [v.knife, v.pointed].forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0.4 }], c.ans, 0.25));

    s.mark(v.sent.find('review'), c.word('review'), { color: PINK });
    const y = 712, gag = s.shape(`<path class="table" d="M64,${y} H600" fill="none" stroke="${PAPER}" stroke-width="8" stroke-linecap="round"/>
      <g class="paper"><path d="M340,${y - 6} L590,${y - 6} L620,${y - 36} L370,${y - 36} Z" fill="#fff" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/></g>${reviewSheet('swing', 100, y - 214)}`);
    const swing = gag.get('.swing'), hub = `100px ${y - 54}px`;
    s.draw(gag.get('.table'), c.word('review'), 0.2, { gain: 0.2 });
    s.pop(gag.get('.paper'), c.word('paper') - 0.5, { gain: 0.3 });
    swing.style.transformBox = 'view-box';
    swing.style.transformOrigin = hub;
    swing.style.opacity = 0;
    s.appear(swing, c.word('review'), 0.12);
    s.anim(swing, [{ rotate: '-24deg' }, { rotate: '-14deg' }], c.word('review'), 0.3, 'ease-out');
    const hit = c.word('cut') + 0.2;
    s.anim(swing, [
      { rotate: '-14deg', easing: 'cubic-bezier(.6,0,1,.6)' },
      { rotate: '30deg', offset: 0.34, easing: 'ease-out' },
      { rotate: '6deg', offset: 0.62, easing: 'ease-in' },
      { rotate: '30deg', offset: 0.82, easing: 'ease-out' },
      { rotate: '18deg' },
    ], hit - 0.2, 0.8, 'linear');
    s.sfx('boing', hit, 0.8);
    s.spoken("can't cut paper", c, c.word("can't"), { x: 860, y: 590, size: 96 });
  }

  /** The dictionary opens at the meaning that just fooled someone, and it is crossed out. */
  function familiarMeaning(s, c, v) {
    const said = ['a', 'familiar', 'meaning', 'can', 'be', 'wrong'].map((w) => c.word(w));
    const head = s.words(['A', 'familiar', 'meaning', 'can', 'be', 'wrong'], { y: 76, size: 92, times: said });
    s.mark(head.find('wrong'), c.word('wrong'), { color: '#ff8080' });
    s.m.mood('hmm', c.fam, 2);

    const opens = c.word('dictionary');
    const book = s.shape(openBook(314, 204));
    s.pop(book.get('.back'), opens, { gain: 0.6 });
    s.grow(book.get('.left'), opens, 0.34, { from: '0 1', to: '1 1', origin: '100% 50%' });
    s.grow(book.get('.right'), opens, 0.34, { from: '0 1', to: '1 1', origin: '0% 50%' });
    s.m.point({ x: 760, y: 340 }, opens, 1);
    const cross = s.shape(`<g fill="none" stroke="${RED}" stroke-width="20" stroke-linecap="round"><path class="a" d="M640,236 L886,446"/><path class="b" d="M886,236 L640,446"/></g>`);
    s.draw(cross.get('.a'), c.word('wrong'), 0.14, { gain: 0.5 });
    s.draw(cross.get('.b'), c.word('wrong') + 0.14, 0.14, { gain: 0.5 });
    s.m.mood('oops', c.word('wrong'), 1);

    const line = s.words("The critic's review was sharp.".split(' '), { y: 524, size: 84, at: c.word('in'), per: 0.09 });
    const mark = s.mark(line.find('sharp'), c.word('sentence'));
    v.done = [book, cross, line, mark];
  }

  /** Check the tone: a needle swings to what the writer is being. */
  function toneCheck(s, c, v) {
    v.done.forEach((n) => s.hide(n, c.tone, 0.2));
    s.tag('check the tone', { x: DIAL.x, y: 206, at: c.word('tone'), bg: MINT, size: 52 });
    const g = s.shape(dial());
    s.draw(g.get('.harsh'), c.word('check'), 0.25, { gain: 0.3 });
    s.draw(g.get('.kind'), c.word('check') + 0.2, 0.25, { gain: 0.3 });
    const needle = g.get('.needle');
    s.appear(needle, c.word('tone'), 0.15);
    const hub = `${DIAL.x}px ${DIAL.y}px`, say = { size: 62, y: DIAL.y + 22 };
    s.turn(needle, 62, c.word('kind'), 0.5, { origin: hub });
    s.text('kind', { ...say, x: DIAL.x + DIAL.r, color: MINT, at: c.word('kind'), dur: 0.2 });
    s.m.mood('happy', c.word('kind'), 0.8);
    s.turn(needle, -62, c.word('harsh'), 0.6, { origin: hub });
    s.text('harsh', { ...say, x: DIAL.x - DIAL.r, color: '#ff8080', at: c.word('harsh'), dur: 0.2 });
    s.m.mood('oops', c.word('harsh'), 1);
    s.m.point({ x: DIAL.x, y: DIAL.y - 120 }, c.word('harsh'), 0.8);
    s.sfx('tick', c.word('harsh') + 0.3, 0.7);
  }

  /** Check the grammar: the wrong form falls out of the slot and the right one clicks in. */
  function grammarCheck(s, c) {
    s.tag('check the grammar', { x: 800, y: 206, at: c.word('grammar'), bg: SKY, size: 52 });
    s.spoken('The researcher', c, c.bad, { x: 480, y: 296, size: 76, align: 'left' });
    const x = 480, y = 390, w = 276, h = 96, mid = x + w / 2;
    const slot = s.shape(`<rect class="box" x="4" y="4" width="${w - 8}" height="${h - 8}" rx="16" fill="rgba(143,230,207,.1)" stroke="${MINT}" stroke-width="6" stroke-dasharray="20 15"/>`, { x, y, w, h });
    s.pop(slot.get('.box'), c.word('proposal'), { gain: 0.3 });
    const wrong = tile(s, 'proposal', mid, y + 2, PINK, c.word('proposal'));
    s.spoken('a hypothesis.', c, c.word('a'), { x: 776, y: 392, size: 76, align: 'left' });

    const fall = c.nope;
    s.anim(wrong, [
      { translate: '0px 0px', rotate: '0deg' },
      { translate: '-12px 0px', rotate: '-3deg', offset: 0.1 },
      { translate: '12px 0px', rotate: '3deg', offset: 0.2 },
      { translate: '-8px 0px', rotate: '-2deg', offset: 0.3 },
      { translate: '0px 0px', rotate: '0deg', offset: 0.4 },
      { translate: '40px 460px', rotate: '38deg' },
    ], fall, 0.75, 'ease-in');
    s.hide(wrong, fall + 0.72, 0.02);
    s.sfx('boing', fall, 0.7);
    s.m.act('shake', fall, 0.7);
    s.m.mood('oops', fall, 0.9);

    const right = tile(s, 'proposed', mid, y + 2, SUN, c.good);
    s.anim(right, [{ translate: '0px -130px' }, { translate: '0px 0px' }], c.good, 0.24, 'cubic-bezier(.3,1.4,.5,1)');
    s.sfx('pop', c.good + 0.2, 0.9);
    s.tag('fits!', { x: mid, y: 500, at: c.word('fits'), bg: MINT, size: 60 });
    s.stars({ x: mid, y: y + h / 2 }, c.word('fits'), 9);
    s.m.act('thumbs', c.good, 1);
    s.m.mood('proud', c.good, 1.2);
  }

  /** The last check: put your word back, read the whole sentence, and tick it. */
  function rereadIt(s, c) {
    const said = ['reread', 'with', 'your', 'choice', 'in', 'it'];
    s.words(['Reread', 'with', 'your', 'choice', 'in', 'it'], { y: 76, size: 96, color: SUN, times: said.map((w) => c.word(w)) });
    const shown = c.word('sentence'), word = c.word('choice');
    const line = s.words(['The', 'researcher', 'proposed', 'a', 'hypothesis.'], { y: 230, size: 80, times: [shown, shown + 0.1, word, shown + 0.2, shown + 0.3] });
    s.mark(line.find('proposed'), word);
    s.m.point(line.find('proposed'), word, 0.9);

    const glass = s.shape(lens()).get('.lens');
    const sense = c.word('sense'), started = c.word('in');
    s.pop(glass, started, { gain: 0.3 });
    sweep(s, glass, [[110, 1090, 280]], started, Math.max(0.8, sense - started));
    s.hide(glass, sense + 0.05, 0.2);

    const g = s.shape(tick(330, 440));
    s.draw(g.get('.tick'), sense, 0.3, { gain: 0.7 });
    s.tag('still makes sense', { x: 690, y: 382, at: c.word('makes'), bg: MINT, size: 60 });
    s.stars({ x: 390, y: 420 }, c.word('got'), 9);
    s.m.mood('proud', c.ok, 3);

    const next = s.tag('Next: Try this skill', { x: 614, y: 540, at: c.word('try'), bg: SUN, size: 64 });
    s.m.point(next, c.word('try'), 0.9);
    s.m.act('wave', c.bye, 1.8);
    s.confetti(c.word('skill'));
  }

  LessonStudio.define({
    id: 'vocabulary',
    teacher: 'tealy',
    title: 'Predict meaning in context',
    beats: [
      {
        say: `{hi}Hi, Tealy here. {not}Vocabulary questions aren't testing whether you memorized a dictionary. {read}They're testing whether you can read.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1);
          s.wideCam(c.not - 0.3, 1.1);
          s.text('Predict meaning in context', { y: 40, size: 96, color: s.ink.yellow, at: c.not + 0.2, dur: 1.2 });
          openingScene(s, c);
        },
      },
      {
        page: 'Watch me',
        gap: 1.3,
        say: `{a}The researcher advanced a hypothesis. {what}What does advanced mean here? {brain}Your brain says: moved forward. {like}Like somebody walking. {but}But hypotheses don't walk.`,
        run: wrongMeaning,
      },
      {
        say: `{cover}So cover the choices, {wd}and cover the word. {b}The researcher, blank, a hypothesis. {simple}What simple word would you put there? {s1}Suggested. {p}Proposed. {now}Now you have a meaning, before you even see the options.`,
        run(s, c, v) {
          coverBoth(s, c, v);
          ownWord(s, c, v);
        },
      },
      {
        say: `{now}Then uncover the choices, {cmp}and compare meanings. {a}Moved forward? {no}No. {b}Proposed? {yes}That's your word. {d}Improved? {no2}No.`,
        run: compareChoices,
      },
      {
        page: 'The idea',
        gap: 1.3,
        say: `{w}A word means what the author is using it to mean, {here}in this sentence.`,
        run: theRule,
      },
      {
        say: `{car}The car advanced. {mv}It moved forward. {res}The researcher advanced a hypothesis. {pr}She proposed it. {same}Same word, {job}different job.`,
        run: twoJobs,
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}The critic's review was sharp. {ask}Does sharp mean pointed, like a knife, or harsh? {try}Go.`,
        pause: 5.2,
        run: yourTurn,
      },
      {
        gap: 0.1,
        say: `{ans}Harsh! {why}A review can't cut paper.`,
        run: reviewCantCut,
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        gap: 1.6,
        say: `{fam}A familiar dictionary meaning can be wrong in this sentence.`,
        run: familiarMeaning,
      },
      {
        say: `{tone}So check the tone. {kind}Is the writer being kind, {hsh}or harsh?`,
        run: toneCheck,
      },
      {
        say: `{gr}And check the grammar too. {bad}The researcher proposal a hypothesis? {nope}Nope. {good}Proposed fits.`,
        run: grammarCheck,
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        gap: 1.3,
        say: `{then}Then reread the sentence with your choice in it. {ok}If it still makes sense, you've got it. {bye}Now hit Try this skill!`,
        run: rereadIt,
      },
    ],
  });
})();
