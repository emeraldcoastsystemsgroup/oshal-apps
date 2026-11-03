/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Compare predictions: two scientist monsters clash, a magnifying glass scans observations until the models' predictions differ, a shaker salts one of two ice cubes that melt against a clock, a table settles it, two balls fall level in a strobe picture, one checked card shrinks among many unknowns, and a familiar claim bounces off the answer box
 */
(function () {
  const M1 = '#ffd66b', M2 = '#9fd0ff', TEAL = '#8fe6cf', PINK = '#ff9ccf', RED = '#ff8080', CHALK = '#f5f3ea', DARK = '#16352b';

  /** Where the ice test stands. Both cubes share a size and a plate line, so they read as equal. */
  const LAB = { salted: 270, plain: 790, middle: 530, base: 580, side: 170, nozzle: { x: 306, y: 352 } };

  /** Where the two balls fall: both bottoms start on the shelf and meet the floor. */
  const DROP = { heavy: { x: 330, r: 74 }, light: { x: 620, r: 50 }, shelf: 410, floor: 660, left: 210, right: 750 };

  /** A chalk check mark centered near x, y. */
  function check(x, y, k = 1, color = TEAL) {
    return `<path class="mark" d="M${x - 30 * k},${y} L${x - 8 * k},${y + 24 * k} L${x + 34 * k},${y - 30 * k}" fill="none" stroke="${color}" stroke-width="${13 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /** A chalk cross centered on x, y. */
  function cross(x, y, k = 1, color = RED) {
    const d = 26 * k;
    return `<path class="mark" d="M${x - d},${y - d} L${x + d},${y + d} M${x + d},${y - d} L${x - d},${y + d}" fill="none" stroke="${color}" stroke-width="${13 * k}" stroke-linecap="round"/>`;
  }

  /** Draw a check or a cross on the board. */
  function stamp(s, markup, t) {
    return s.draw(s.shape(markup).get('.mark'), t, 0.24, { gain: 0.5 });
  }

  /** A lightning bolt: two sides clashing. */
  function bolt(cx, cy, k = 1) {
    const p = [[10, -70], [-30, 8], [2, 8], [-12, 70], [34, -16], [2, -16]].map(([x, y]) => `${cx + x * k},${cy + y * k}`).join(' L');
    return `<path class="bolt" d="M${p} Z" fill="${M1}" stroke="${DARK}" stroke-width="5" stroke-linejoin="round"/>`;
  }

  /** The prediction pictures in the scan: one column is one possible observation. */
  const icon = {
    dot: (x, y, color) => `<circle cx="${x}" cy="${y}" r="44" fill="${color}" stroke="${CHALK}" stroke-width="5"/>`,
    box: (x, y, color) => `<rect x="${x - 40}" y="${y - 40}" width="80" height="80" rx="14" fill="${color}" stroke="${CHALK}" stroke-width="5"/>`,
    tri: (x, y, color) => `<path d="M${x},${y - 46} L${x + 48},${y + 38} H${x - 48} Z" fill="${color}" stroke="${CHALK}" stroke-width="5" stroke-linejoin="round"/>`,
  };

  /** An equals sign between two predictions, struck through when they differ. */
  function relation(x, y, differ) {
    const color = differ ? RED : CHALK;
    const slash = differ ? `<path d="M${x + 16},${y - 22} L${x - 16},${y + 22}" stroke="${RED}" stroke-width="8" stroke-linecap="round"/>` : '';
    return `<path d="M${x - 24},${y - 9} H${x + 24} M${x - 24},${y + 9} H${x + 24}" stroke="${color}" stroke-width="8" stroke-linecap="round"/>${slash}`;
  }

  /** A magnifying glass with its lens centered on x, y. */
  function lens(x, y, r) {
    return `<g class="lens"><path d="M${x + r * 0.72},${y + r * 0.72} L${x + r * 1.2},${y + r * 1.2}" stroke="#c98a4b" stroke-width="26" stroke-linecap="round"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,.07)" stroke="${CHALK}" stroke-width="12"/>
      <path d="M${x - r * 0.72},${y - r * 0.28} Q${x - r * 0.62},${y - r * 0.66} ${x - r * 0.26},${y - r * 0.76}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="9" stroke-linecap="round"/></g>`;
  }

  /** One ice cube standing on the base line, with a face so its melting reads at a glance. */
  function cube(cls, cx) {
    const { base, side } = LAB;
    const x = cx - side / 2, y = base - side;
    return `<g class="${cls}"><rect x="${x}" y="${y}" width="${side}" height="${side}" rx="28" fill="#d6f3ff" stroke="#fff" stroke-width="6"/>
      <path d="M${x + 26},${y + 32} Q${x + 56},${y + 20} ${x + 92},${y + 28}" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
      <circle cx="${cx - 32}" cy="${y + 82}" r="11" fill="${DARK}"/><circle cx="${cx + 32}" cy="${y + 82}" r="11" fill="${DARK}"/>
      <path d="M${cx - 22},${y + 116} Q${cx},${y + 134} ${cx + 22},${y + 116}" fill="none" stroke="${DARK}" stroke-width="7" stroke-linecap="round"/></g>`;
  }

  /** The grains of salt where they come to rest along the top of the salted cube. */
  function grains() {
    const left = LAB.salted - LAB.side / 2 + 16, top = LAB.base - LAB.side - 4;
    return Array.from({ length: 26 }, (_, i) => `<circle class="grain" cx="${left + (i * 41) % (LAB.side - 32)}" cy="${top - (i % 3) * 5}" r="6.5" fill="#fff"/>`).join('');
  }

  /** The bench of the ice test: plates, puddles under the cubes, the cubes and the salt. */
  function bench() {
    const { salted, plain, base, side } = LAB;
    const plate = (cx) => `<path class="plate" d="M${cx - side * 0.95},${base + 4} H${cx + side * 0.95}" stroke="${CHALK}" stroke-width="10" stroke-linecap="round"/>`;
    const puddle = (cls, cx, rx) => `<ellipse class="${cls}" cx="${cx}" cy="${base - 8}" rx="${rx}" ry="14" fill="#9fd0ff" opacity=".85"/>`;
    return `${plate(salted)}${plate(plain)}${puddle('wetA', salted, 152)}${puddle('wetB', plain, 112)}${cube('iceA', salted)}${cube('iceB', plain)}<g class="salt">${grains()}</g>`;
  }

  /** A thermometer whose red column can rise. */
  function thermometer(x, top, bottom) {
    const bulb = bottom - 32;
    const ticks = [0.2, 0.45, 0.7].map((k) => `<path d="M${x + 22},${top + (bulb - top) * k} h18" stroke="${CHALK}" stroke-width="4" stroke-linecap="round"/>`).join('');
    return `<g class="thermo"><rect x="${x - 17}" y="${top}" width="34" height="${bulb - top}" rx="17" fill="rgba(245,243,234,.16)" stroke="${CHALK}" stroke-width="5"/>${ticks}
      <rect class="red" x="${x - 8}" y="${top + 56}" width="16" height="${bulb - top - 56}" rx="8" fill="${RED}"/>
      <circle cx="${x}" cy="${bulb}" r="32" fill="${RED}" stroke="${CHALK}" stroke-width="5"/></g>`;
  }

  /** A clock whose hand can sweep, to say that time is passing. */
  function clock(x, y, r) {
    return `<g class="clock"><circle cx="${x}" cy="${y}" r="${r}" fill="rgba(245,243,234,.14)" stroke="${CHALK}" stroke-width="7"/>
      <path class="hand" d="M${x},${y} V${y - r * 0.72}" stroke="${M1}" stroke-width="9" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="8" fill="${CHALK}"/></g>`;
  }

  /** A salt shaker standing around x, y. The outer group slides, the inner one tilts. */
  function shaker(x, y) {
    const holes = [-14, 0, 14].map((d) => `<circle cx="${x + d}" cy="${y - 50}" r="3.5" fill="${DARK}"/>`).join('');
    return `<g class="shaker"><g class="tilt"><path d="M${x - 26},${y - 30} L${x - 34},${y + 46} Q${x - 34},${y + 54} ${x - 26},${y + 54} H${x + 26} Q${x + 34},${y + 54} ${x + 34},${y + 46} L${x + 26},${y - 30} Z" fill="#fbfaf4" stroke="#fff" stroke-width="3"/>
      <path d="M${x - 28},${y - 30} Q${x},${y - 78} ${x + 28},${y - 30} Z" fill="#aab6bf" stroke="#7f8b95" stroke-width="4"/>${holes}
      <text x="${x}" y="${y + 32}" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="46" fill="${DARK}">S</text></g></g>`;
  }

  /** Shake the salt: the shaker tilts over the cube and each grain falls from its mouth. */
  function pourSalt(s, bench, tilt, t) {
    const { x, y } = LAB.nozzle;
    s.turn(tilt, -140, t + 0.12, 0.2, { origin: '352px 300px', easing: 'cubic-bezier(.4,0,.3,1)' });
    [...bench.querySelectorAll('.grain')].forEach((g, i) => {
      const dx = x - Number(g.getAttribute('cx')), dy = y - Number(g.getAttribute('cy'));
      g.style.opacity = 0;
      const start = t + 0.3 + (i % 13) * 0.05 + (i % 2) * 0.03;
      s.anim(g, [{ translate: `${dx}px ${dy}px`, opacity: 1 }, { translate: '0px 0px', opacity: 1 }], start, 0.26, 'cubic-bezier(.4,0,1,.7)');
    });
    s.sfx('swipe', t + 0.3, 0.8);
  }

  /** Melt one cube down onto its plate over a stretch of time. */
  function melt(s, node, t, dur, sx, sy) {
    s.anim(node, [{ scale: '1 1' }, { scale: `${sx} ${sy}` }], t, dur, 'cubic-bezier(.35,.1,.8,.9)');
  }

  /** A ball with its label on it. */
  function ball(cls, { x, r }, y, color, label, size) {
    return `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${CHALK}" stroke-width="5"/>
      <text x="${x}" y="${y + size * 0.32}" text-anchor="middle" font-family="Fredoka" font-weight="500" font-size="${size}" fill="${DARK}">${label}</text></g>`;
  }

  /** The strobe picture: where both balls were at one moment, level with each other. */
  function ghost(off) {
    const { heavy, light, shelf, left, right } = DROP;
    const ring = ({ x, r }, color) => `<circle cx="${x}" cy="${shelf - r + off}" r="${r}" fill="none" stroke="${color}" stroke-width="4" opacity=".55"/>`;
    return `<g class="ghost">${ring(heavy, PINK)}${ring(light, TEAL)}<path d="M${left},${shelf + off} H${right}" stroke="${CHALK}" stroke-width="4" stroke-dasharray="12 14" opacity=".5"/></g>`;
  }

  /** Let both balls fall under gravity, with a level line riding along that shows they stay even. */
  function dropBalls(s, g, t, dur) {
    const fall = DROP.floor - DROP.shelf;
    const gravity = 'cubic-bezier(.33,0,.67,.33)';
    ['.heavy', '.light', '.level'].forEach((k) => s.anim(g.get(k), [{ translate: '0px 0px' }, { translate: `0px ${fall}px` }], t, dur, gravity));
    ['.heavy', '.light'].forEach((k) => s.anim(g.get(k), [{ translate: `0px ${fall}px` }, { translate: `0px ${fall - 24}px`, offset: 0.5 }, { translate: `0px ${fall}px` }], t + dur, 0.34, 'ease-out'));
    const level = g.get('.level');
    level.style.opacity = 0;
    s.anim(level, [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }], t, dur, 'linear', 'none');
    [0.5, 0.75].forEach((k) => s.appear(s.shape(ghost(fall * k * k)).get('.ghost'), t + dur * k, 0.06));
    s.sfx('whoosh', t, 0.5);
    s.sfx('boing', t + dur, 0.7);
  }

  /** One observation card: a checked one, or an unknown. */
  function card(x, y, inner, cls) {
    return `<g class="${cls}"><rect x="${x}" y="${y}" width="150" height="180" rx="18" fill="rgba(245,243,234,.12)" stroke="${CHALK}" stroke-width="5"/>${inner}</g>`;
  }

  /** The grid of cards: the first is the one observation, the rest have never been checked. */
  function cardGrid() {
    let out = '';
    for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
      const x = 66 + col * 170, y = 268 + row * 200;
      if (row || col) out += card(x, y, `<text x="${x + 75}" y="${y + 124}" text-anchor="middle" font-family="Chalk" font-size="104" fill="${CHALK}" opacity=".75">?</text>`, 'unknown');
    }
    return out + card(66, 268, check(141, 358, 1.35), 'checked');
  }

  LessonStudio.define({
    id: 'science-claims',
    teacher: 'sprout',
    title: 'Compare predictions',
    beats: [
      {
        say: `{hi}Sprout here! {two}Today, two scientists disagree. {love}And I love that, {way}because there's a way to settle it.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1);
          s.wideCam(c.two - 0.3, 1.1);
          const clash = c.word('disagree'), calm = c.word('settle');
          const left = s.critter(330, 450, 270, c.word('two'), { hue: 40 });
          const right = s.critter(900, 450, 270, c.word('scientists'), { hue: 200 });
          s.m.point({ x: 615, y: 450 }, c.word('scientists'), 1.1);
          s.move(left, 70, 0, clash, 0.22);
          s.move(right, -70, 0, clash, 0.22);
          const spark = s.shape(bolt(615, 440, 1.3)).get('.bolt');
          s.pop(spark, clash + 0.12, { gain: 0.8 });
          const yes = s.tag('Yes!', { x: 400, y: 196, at: clash, bg: M1, size: 66 });
          const no = s.tag('No!', { x: 830, y: 196, at: clash + 0.16, bg: M2, size: 66 });
          s.m.mood('proud', c.love, 1.6);
          const title = s.text('Compare predictions', { y: 56, size: 108, color: s.ink.yellow, at: c.way, dur: 0.9 });
          s.m.look(title, c.way, 1.4);
          [spark, yes, no].forEach((n) => s.hide(n, calm, 0.25));
          s.move(left, -70, 0, calm, 0.4);
          s.move(right, 70, 0, calm, 0.4);
        },
      },
      {
        page: 'The idea',
        say: `{two}When two models compete, {look}you look for an observation {diff}where they predict different things. {test}That's the test.`,
        run(s, c) {
          const [xA, xB, xC] = [420, 680, 940], rowA = 230, rowB = 370, mid = 300;
          const clash = c.word('compete'), hit = c.word('different');
          const one = s.tag('Model 1', { x: 400, y: 260, at: c.word('two'), bg: M1, size: 60 });
          const two = s.tag('Model 2', { x: 830, y: 260, at: c.word('models'), bg: M2, size: 60 });
          s.move(one, 70, 0, clash, 0.2);
          s.move(two, -70, 0, clash, 0.2);
          const spark = s.shape(bolt(615, 300, 1)).get('.bolt');
          s.pop(spark, clash + 0.1, { gain: 0.7 });
          s.hide(spark, c.look, 0.15);
          s.move(one, -320, -72, c.look, 0.45);
          s.move(two, -610, 68, c.look, 0.45);
          s.spoken('you look for an observation', c, c.look, { x: 614, y: 78, size: 66, color: s.ink.teal });
          const scan = s.shape(`<g class="col"><g>${icon.dot(xA, rowA, TEAL)}${relation(xA, mid, false)}${icon.dot(xA, rowB, TEAL)}</g></g>
            <g class="col"><g>${icon.box(xB, rowA, PINK)}${relation(xB, mid, false)}${icon.box(xB, rowB, PINK)}</g></g>
            <g class="col"><g>${icon.tri(xC, rowA, M1)}${relation(xC, mid, true)}${icon.dot(xC, rowB, M2)}</g></g>${lens(xA, mid, 125)}`);
          const cols = [...scan.querySelectorAll('.col')];
          const glass = scan.get('.lens');
          const stops = [c.word('look'), c.word('observation'), c.word('predict')];
          s.pop(glass, stops[0], { gain: 0.5 });
          s.pop(cols[0], stops[0] + 0.12, { gain: 0.3 });
          s.move(glass, xB - xA, 0, stops[1], 0.3);
          s.anim(cols[0], [{ opacity: 1 }, { opacity: 0.4 }], stops[1], 0.25);
          s.pop(cols[1], stops[1] + 0.22, { gain: 0.3 });
          s.move(glass, xC - xB, 0, stops[2], 0.3);
          s.anim(cols[1], [{ opacity: 1 }, { opacity: 0.4 }], stops[2], 0.25);
          s.pop(cols[2], stops[2] + 0.22, { gain: 0.6 });
          const line = s.spoken('where they predict different things', c, c.diff, { x: 614, y: 470, size: 72 });
          s.mark(line.find('different'), hit, { color: M1 });
          s.pulse(cols[2], hit, { to: 1.08 });
          s.m.point({ x: xC, y: mid }, hit, 1.1);
          s.m.mood('wow', hit, 1);
          const verdict = s.tag("That's the test", { x: 614, y: 588, at: c.test, bg: TEAL, size: 66 });
          s.stars({ x: xC, y: mid }, c.test, 8);
          s.m.look(verdict, c.test, 0.9);
        },
      },
      {
        page: 'Watch me',
        gap: 1.2,
        say: `{m1}Model one says: salt speeds up melting. {m2}Model two says: salt changes nothing. {dis}They disagree! {so}So let's test it. {ice}Two equal pieces of ice. {same}Same room, same temperature. {salt}Salt on one.`,
        run(s, c, v) {
          const { salted, plain, middle, side, base } = LAB;
          v.tag1 = s.tag('Model 1', { x: 40, y: 84, at: c.m1, bg: M1, size: 50, align: 'left' });
          v.claim1 = s.words(['salt', 'speeds up', 'melting'], { x: 262, y: 76, size: 72, align: 'left', times: [c.word('salt'), c.word('speeds'), c.word('melting')] });
          v.swipe1 = s.mark(v.claim1.w[1], c.word('speeds'), { color: M1 });
          s.m.point(v.claim1.w[1], c.word('speeds'), 1);
          v.tag2 = s.tag('Model 2', { x: 40, y: 170, at: c.m2, bg: M2, size: 50, align: 'left' });
          v.claim2 = s.words(['salt', 'changes nothing'], { x: 262, y: 162, size: 72, align: 'left', times: [c.word('salt', 1), c.word('changes')] });
          v.swipe2 = s.mark(v.claim2.w[1], c.word('changes'), { color: M2 });
          s.m.point(v.claim2.w[1], c.word('changes'), 1);

          const clash = c.word('disagree');
          const spark = s.shape(bolt(1010, 170, 1.15)).get('.bolt');
          s.pop(spark, clash, { gain: 0.8 });
          const rift = s.tag('disagree!', { x: 1010, y: 150, at: clash + 0.05, bg: PINK, size: 50 });
          s.pulse(v.claim1, clash, { to: 1.05 });
          s.pulse(v.claim2, clash, { to: 1.05 });
          s.m.mood('wow', clash, 1.1);
          s.hide(spark, c.so, 0.2);
          s.hide(rift, c.so, 0.2);

          v.lab = s.shape(bench());
          const lab = v.lab;
          [...lab.querySelectorAll('.plate')].forEach((n, i) => s.draw(n, c.word('test') + i * 0.12, 0.3, { gain: 0.4 }));
          const equal = s.text('equal', { x: middle, y: 440, size: 72, color: s.ink.teal, at: c.word('equal'), dur: 0.25 });
          [lab.get('.wetA'), lab.get('.wetB')].forEach((n) => { n.style.transformBox = 'fill-box'; n.style.transformOrigin = '50% 50%'; n.style.scale = '0 0'; });
          ['.iceA', '.iceB'].forEach((k, i) => {
            const cubeNode = lab.get(k);
            s.pop(cubeNode, c.word('pieces') + i * 0.14);
            cubeNode.style.transformOrigin = '50% 100%';
          });
          s.m.look({ x: middle, y: base - side / 2 }, c.word('pieces'), 1.2);

          s.hide(equal, c.same, 0.2);
          const room = s.shape(`<rect class="room" x="70" y="250" width="920" height="392" rx="26" fill="none" stroke="${CHALK}" stroke-opacity=".6" stroke-width="5"/>`).get('.room');
          s.draw(room, c.word('room'), 0.5, { gain: 0.4 });
          v.room = room;
          s.spoken('same room, same temperature', c, c.same, { x: middle, y: 652, size: 62, color: s.ink.teal });
          v.heat = s.shape(thermometer(middle, 310, 576));
          s.appear(v.heat.get('.thermo'), c.word('temperature'), 0.2);
          s.grow(v.heat.get('.red'), c.word('temperature'), 0.6, { from: '1 0.1', to: '1 1', origin: '50% 100%' });
          s.m.point({ x: middle, y: 440 }, c.word('temperature'), 0.9);

          const shake = s.shape(shaker(352, 300));
          v.shaker = shake.get('.shaker');
          s.pop(v.shaker, c.salt, { gain: 0.5 });
          pourSalt(s, lab, shake.get('.tilt'), c.salt);
          v.saltTag = s.tag('salt', { x: 142, y: 306, at: c.salt, bg: CHALK, size: 48 });
          s.m.point({ x: salted, y: base - side / 2 }, c.word('on'), 1.1);
          v.plain = plain;
        },
      },
      {
        say: `{p1}Model one predicts the salted ice melts first. {p2}Model two predicts a tie. {if}If the salted ice melts first, {sup}that supports model one.`,
        run(s, c, v) {
          const { salted, middle, side, base } = LAB;
          const lab = v.lab;
          const t0 = c.word('the', 1), done = c.word('first', 1) + 0.4, dur = Math.max(1, done - t0);
          s.hide(v.shaker, c.p1, 0.25);
          s.pulse(v.tag1, c.p1, { to: 1.12 });
          s.hide(v.claim1, c.word('predicts'), 0.2);
          s.hide(v.swipe1, c.word('predicts'), 0.2);
          const pick1 = s.words(['salted ice', 'melts first'], { x: 262, y: 76, size: 72, align: 'left', times: [c.word('salted'), c.word('melts')] });
          s.mark(pick1.w[1], c.word('first'), { color: M1 });
          s.m.point(pick1.w[1], c.word('melts'), 1);

          s.pulse(v.tag2, c.p2, { to: 1.12 });
          s.hide(v.claim2, c.word('predicts', 1), 0.2);
          s.hide(v.swipe2, c.word('predicts', 1), 0.2);
          const pick2 = s.words(['a tie'], { x: 262, y: 162, size: 72, align: 'left', times: [c.word('a')] });
          s.mark(pick2.w[0], c.word('tie'), { color: M2 });

          s.hide(v.heat.get('.thermo'), t0, 0.2);
          const time = s.shape(clock(middle, 430, 74));
          s.appear(time.get('.clock'), t0, 0.2);
          s.turn(time.get('.hand'), 900, t0, dur, { origin: `${middle}px 430px`, easing: 'linear' });

          melt(s, lab.get('.iceA'), t0, dur, 0.5, 0.05);
          s.hide(lab.get('.iceA'), done - 0.1, 0.1);
          melt(s, lab.get('.iceB'), t0, dur, 0.97, 0.84);
          s.anim(lab.get('.wetA'), [{ scale: '0 0' }, { scale: '1 1' }], t0, dur, 'linear');
          s.anim(lab.get('.wetB'), [{ scale: '0 0' }, { scale: '.8 .8' }], t0, dur, 'linear');
          s.anim(lab.get('.salt'), [{ translate: '0px 0px', opacity: 1 }, { translate: `0px ${side * 0.8}px`, opacity: 0 }], t0, dur * 0.9, 'cubic-bezier(.35,.1,.8,.9)');
          s.sfx('whoosh', t0, 0.3);
          s.m.look({ x: salted, y: base - 60 }, t0, dur);
          s.tag('first!', { x: salted, y: 470, at: c.word('first', 1), bg: M1, size: 56 });
          s.m.mood('wow', c.word('first', 1), 0.9);

          s.anim(pick2, [{ opacity: 1 }, { opacity: 0.45 }], c.word('supports'), 0.3);
          const backing = s.tag('Supports Model 1', { x: 560, y: 262, at: c.word('supports'), bg: M1, size: 58 });
          s.stars(backing, c.word('supports') + 0.1, 9);
          s.m.act('thumbs', c.word('supports'), 1.2);
          s.m.mood('proud', c.word('supports'), 1.4);
        },
      },
      {
        page: 'A faster way',
        chipColor: TEAL,
        gap: 1.5,
        say: `{make}Make a small table. {a}Each model, {b}its prediction, {d}and what you observed. {then}Then just compare.`,
        run(s, c) {
          const left = 50, right = 1100, head = 208, midline = 400, bottom = 590, col1 = 290, col2 = 680;
          const grid = s.shape(`<path class="h" d="M${left},${head} H${right}" stroke="${CHALK}" stroke-width="7" stroke-linecap="round"/><path class="v" d="M${col1},96 V${bottom}" stroke="${CHALK}" stroke-width="7" stroke-linecap="round"/><path class="w" d="M${col2},96 V${bottom}" stroke="${CHALK}" stroke-width="7" stroke-linecap="round"/><path class="r" d="M${left},${midline} H${right}" stroke="rgba(245,243,234,.5)" stroke-width="5" stroke-linecap="round"/>`);
          ['.h', '.v', '.w', '.r'].forEach((k, i) => s.draw(grid.get(k), c.word('table') + i * 0.12, 0.32, { gain: 0.3 }));
          const say1 = c.word('model'), say2 = c.word('prediction'), say3 = c.word('observed');
          s.text('Model', { x: 170, y: 118, size: 70, color: s.ink.teal, at: say1, dur: 0.25 });
          s.tag('Model 1', { x: 170, y: 262, at: say1 + 0.12, bg: M1, size: 46 });
          s.tag('Model 2', { x: 170, y: 454, at: say1 + 0.26, bg: M2, size: 46 });
          s.text('Predicts', { x: 485, y: 118, size: 70, color: s.ink.teal, at: say2, dur: 0.25 });
          const guess1 = s.text('salted first', { x: 485, y: 254, size: 76, at: say2 + 0.1, dur: 0.3 });
          const guess2 = s.text('a tie', { x: 485, y: 446, size: 76, at: say2 + 0.3, dur: 0.2 });
          s.text('Observed', { x: 865, y: 118, size: 70, color: s.ink.teal, at: say3, dur: 0.25 });
          const seen1 = s.text('salted first', { x: 860, y: 254, size: 76, color: s.ink.yellow, at: say3 + 0.1, dur: 0.3 });
          s.text('salted first', { x: 860, y: 446, size: 76, color: s.ink.yellow, at: say3 + 0.3, dur: 0.3 });
          s.m.look('board', say1, 2.2);

          const go = c.word('compare');
          const scan = s.frame({ x: left - 14, y: 222, w: right - left + 28, h: 164 }, go - 0.08);
          s.mark(guess1, go, { color: M1 });
          s.mark(seen1, go, { color: M1 });
          stamp(s, check(1062, 298), go + 0.24);
          s.sfx('ding', go + 0.26, 0.6);
          scan.to({ x: left - 14, y: 414, w: right - left + 28, h: 164 }, go + 0.62, 0.3);
          s.strike(guess2, go + 0.94);
          stamp(s, cross(1062, 490), go + 1.04);
          s.m.point({ x: 860, y: 300 }, go, 1.4);
          s.m.mood('proud', go + 0.3, 1.4);
        },
      },
      {
        page: 'Your turn',
        chipColor: PINK,
        gap: 1.7,
        say: `{go}Your turn. {a}Model A says heavier balls fall faster. {b}Model B says they fall at the same rate. {c1}You drop two balls together, {c2}and they land together. {ask}Which model does that support? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const { heavy, light, shelf, floor, left, right } = DROP;
          v.tagA = s.tag('Model A', { x: 40, y: 84, at: c.a, bg: M1, size: 50, align: 'left' });
          v.claimA = s.spoken('heavier balls fall faster', c, c.word('heavier'), { x: 262, y: 76, size: 72, align: 'left' });
          s.mark(v.claimA.find('faster'), c.word('faster'), { color: M1, hold: 1.1 });
          v.tagB = s.tag('Model B', { x: 40, y: 170, at: c.b, bg: M2, size: 50, align: 'left' });
          v.claimB = s.words(['they', 'fall', 'at', 'the', 'same rate'], { x: 262, y: 162, size: 72, align: 'left', times: [c.word('they'), c.word('fall', 1), c.word('at'), c.word('the'), c.word('same')] });
          s.mark(v.claimB.w[4], c.word('same'), { color: M2, hold: 1.1 });

          const g = s.shape(`<path class="floor" d="M${left},${floor} H${right}" stroke="${CHALK}" stroke-width="10" stroke-linecap="round"/>
            <path class="shelf" d="M${left},${shelf} H${right}" stroke="#c98a4b" stroke-width="14" stroke-linecap="round"/>
            <path class="level" d="M${left},${shelf} H${right}" stroke="${M1}" stroke-width="5" stroke-dasharray="14 12"/>
            ${ball('heavy', heavy, shelf - heavy.r, PINK, 'heavy', 46)}${ball('light', light, shelf - light.r, TEAL, 'light', 42)}`);
          const release = c.word('together'), landed = Math.max(release + 0.6, c.word('land'));
          s.draw(g.get('.shelf'), c.c1, 0.3, { gain: 0.3 });
          s.draw(g.get('.floor'), c.c1 + 0.1, 0.3, { gain: 0.3 });
          s.pop(g.get('.heavy'), c.word('two'), { gain: 0.5 });
          s.pop(g.get('.light'), c.word('balls', 1), { gain: 0.5 });
          s.move(g.get('.shelf'), -900, 0, release - 0.05, 0.22);
          dropBalls(s, g, release, landed - release);
          s.m.look({ x: 480, y: 500 }, c.word('two'), landed - c.word('two') + 0.2);
          s.m.mood('wow', landed, 1);
          v.landed = s.tag('land together', { x: 925, y: 582, at: landed, bg: TEAL, size: 54 });
          v.which = s.text('Which model?', { x: 925, y: 330, size: 80, color: s.ink.yellow, at: c.word('model', 2), dur: 0.5 });
          s.pulse(v.which, c.word('support'), { to: 1.08 });
          s.m.point(v.which, c.ask, 1.1);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Model B! {why}The observation matches its prediction.`,
        run(s, c, v) {
          s.hide(v.which, c.ans, 0.2);
          s.mark(v.claimB.w[4], c.ans, { color: M2 });
          s.pulse(v.tagB, c.ans, { to: 1.2 });
          s.stars(v.tagB, c.ans + 0.05, 9);
          stamp(s, check(960, 206), c.ans + 0.15);
          s.strike(v.claimA.find('faster'), c.ans + 0.25);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
          const see = c.word('observation');
          s.circle(v.landed, see, { color: s.ink.teal, pad: 12 });
          s.arrow(v.landed, v.claimB.w[4], c.word('matches'), { color: s.ink.teal, curve: 0.12, gap: 16 });
          s.m.point(v.claimB.w[4], c.word('matches'), 1.1);
        },
      },
      {
        page: 'Watch out',
        chipColor: RED,
        gap: 1.2,
        say: `{but}But careful. {ag}Agreement with one observation supports a model. {not}It doesn't prove it's true everywhere, forever.`,
        run(s, c) {
          s.m.mood('hmm', c.but, 1.4);
          const warn = s.shape(`<g class="warn"><path d="M614,250 L720,440 H508 Z" fill="${RED}" stroke="${CHALK}" stroke-width="7" stroke-linejoin="round"/>
            <path d="M614,312 V378 M614,408 V410" stroke="${DARK}" stroke-width="18" stroke-linecap="round"/></g>`).get('.warn');
          s.pop(warn, c.word('careful'), { gain: 0.7 });
          s.hide(warn, c.word('one'), 0.15);
          const first = s.spoken('Agreement with one observation supports a model', c, c.ag, { x: 614, y: 78, size: 62 });
          s.circle(first.find('one'), c.word('one'), { color: s.ink.yellow, pad: 8, width: 6 });
          const second = s.spoken("It doesn't prove it's true everywhere, forever", c, c.not, { x: 614, y: 164, size: 62 });

          const grid = s.shape(cardGrid());
          const checked = grid.get('.checked');
          const zoom = '473px 110px', shrink = c.word('prove');
          checked.style.transformBox = 'fill-box';
          checked.style.transformOrigin = '50% 50%';
          checked.style.scale = '0';
          checked.style.translate = zoom;
          s.anim(checked, [{ scale: 0 }, { scale: 1.75 }], c.word('one'), 0.34, 'cubic-bezier(.3,1.5,.5,1)');
          s.sfx('pop', c.word('one'), 0.7);
          const tick = checked.querySelector('.mark');
          s.draw(tick, c.word('observation'), 0.26, { gain: 0.5 });
          s.mark(first.find('supports'), c.word('supports'), { color: TEAL });
          s.pulse(checked, c.word('supports'), { to: 1.9 });
          s.m.point({ x: 614, y: 468 }, c.word('supports'), 0.9);

          s.mark(second.find('prove'), shrink, { color: PINK });
          s.m.act('shake', c.word("doesn't"), 0.8);
          s.anim(checked, [{ scale: 1.75, translate: zoom }, { scale: 1, translate: '0px 0px' }], shrink, 0.45, 'cubic-bezier(.45,.05,.2,1)');
          const unknowns = [...grid.querySelectorAll('.unknown')];
          const wave = c.word('everywhere'), span = Math.max(0.5, c.word('forever') + 0.3 - wave);
          unknowns.forEach((n, i) => s.pop(n, wave + (span * i) / unknowns.length, { gain: 0.3 }));
          s.m.look({ x: 600, y: 460 }, wave, 1.3);
          s.m.mood('wow', wave, 1.2);
        },
      },
      {
        page: 'Remember',
        chipColor: M1,
        gap: 1.3,
        say: `{acc}And when a question says according to model A, {ans}answer according to model A, {even}even if another claim seems more familiar. {bye}Now hit Try this skill!`,
        run(s, c) {
          const paper = s.shape(`<rect class="paper" x="150" y="84" width="930" height="136" rx="14" fill="#fbf8ee" stroke="#d8d2bd" stroke-width="4"/>`).get('.paper');
          paper.style.transformBox = 'fill-box';
          s.pop(paper, c.word('question'), { gain: 0.5 });
          const line = s.words(['According', 'to', 'Model A'], { x: 615, y: 98, size: 100, color: '#23473b', times: [c.word('according'), c.word('to'), c.word('model')] });
          s.mark(line.w[2], c.word('model'), { color: M1 });
          s.m.point(line.w[2], c.word('model'), 1);

          s.text('Answer:', { x: 60, y: 290, size: 76, align: 'left', at: c.ans, dur: 0.25 });
          const box = s.frame({ x: 310, y: 256, w: 390, h: 150 }, c.ans);
          const pick = s.tag('Model A', { x: 615, y: 108, at: c.word('according', 1), bg: M1, size: 76 });
          s.flyTo(pick, box, c.word('according', 1) + 0.1, 0.5);

          const reason = s.spoken('even if another claim seems more familiar', c, c.even, { x: 614, y: 440, size: 66 });
          s.mark(reason.find('familiar'), c.word('familiar'), { color: PINK });
          const lure = s.tag('familiar claim', { x: 950, y: 290, at: c.word('claim'), bg: PINK, size: 54 });
          s.move(lure, -96, 0, c.word('seems'), 0.3);
          s.m.act('stop', c.word('more'), 0.9);
          s.move(lure, 96, 0, c.word('familiar'), 0.2, 'cubic-bezier(.3,1.5,.5,1)');
          s.strike(lure, c.word('familiar') + 0.24);
          s.m.mood('proud', c.word('familiar'), 1.2);

          const button = s.tag('Try this skill', { x: 614, y: 556, at: c.word('try'), bg: M1, size: 66 });
          s.m.point(button, c.word('try'), 1);
          const down = s.shape(`<path class="down" d="M570,668 L614,712 L658,668" fill="none" stroke="${M1}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`).get('.down');
          s.appear(down, c.word('skill'), 0.15);
          s.anim(down, [{ translate: '0px 0px' }, { translate: '0px 14px' }, { translate: '0px 0px' }, { translate: '0px 14px' }, { translate: '0px 0px' }], c.word('skill'), 1.6, 'ease-in-out');
          s.m.act('wave', c.end, 1.6);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
