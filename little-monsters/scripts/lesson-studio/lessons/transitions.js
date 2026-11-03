/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Name the logical relationship: a car obeys a road sign and crashes at the wrong one, four little roads act out the four turns, the right sign flies into the blank, answer cards stay face down until the prediction is said, and a Therefore with no support falls flat
 */
(function () {
  const DARK = '#16352b';
  const SIGN = { contrast: '#ff9ccf', continuation: '#8fe6cf', example: '#ffd66b', cause: '#9fd0ff', warn: '#ff8080' };

  /** Roads as chalk edge, asphalt and a dashed center line, in layers so a fork joins cleanly. */
  function roads(paths, w = 64) {
    const layer = (name, stroke, width, extra = '') => paths.map((d, i) => `<path class="${name}${i}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`).join('');
    return layer('edge', '#f5f3ea', w + 9) + layer('band', '#34444a', w) + layer('dash', '#ffd66b', Math.max(3, w * 0.07), `stroke-dasharray="${w * 0.4} ${w * 0.36}"`);
  }

  /** Lay road i of a roads() drawing: the surface draws along its length, then the dashes show. */
  function lay(s, svg, i, t, dur = 0.6) {
    s.draw(svg.get(`.edge${i}`), t, dur, { gain: 0.3 });
    s.draw(svg.get(`.band${i}`), t, dur, { gain: 0 });
    s.appear(svg.get(`.dash${i}`), t + dur, 0.2);
  }

  /** A car seen from above with Bluebold at the wheel, nose toward +x, centered on its origin. */
  function car(name, color, k = 1, extra = '') {
    const glass = `fill="#d7f2ff" stroke="${DARK}" stroke-width="3"`;
    return `<g class="${name}"><g transform="scale(${k})">${extra}
      <path d="M-40,-34 h24 v10 h-24 Z M16,-34 h24 v10 h-24 Z M-40,24 h24 v10 h-24 Z M16,24 h24 v10 h-24 Z" fill="${DARK}"/>
      <rect x="-58" y="-28" width="116" height="56" rx="20" fill="${color}" stroke="${DARK}" stroke-width="4"/>
      <path d="M18,-21 Q38,-18 38,0 Q38,18 18,21 Q24,0 18,-21 Z" ${glass}/>
      <rect x="-50" y="-17" width="10" height="34" rx="4" ${glass}/>
      <path d="M-22,-14 L-32,-25 L-9,-15 Z M-22,14 L-32,25 L-9,15 Z" fill="#b9ec7a" stroke="${DARK}" stroke-width="2"/>
      <circle cx="-8" cy="0" r="17" fill="#1e74df" stroke="${DARK}" stroke-width="3"/>
      <circle cx="-1" cy="-7" r="6" fill="#fff"/><circle cx="-1" cy="7" r="6" fill="#fff"/>
      <circle cx="1" cy="-7" r="3" fill="#12061c"/><circle cx="1" cy="7" r="3" fill="#12061c"/>
    </g></g>`;
  }

  /** A school bus from the side, centered on its origin. */
  function schoolBus(name) {
    const pane = (x, w = 42) => `<rect x="${x}" y="-44" width="${w}" height="38" rx="6" fill="#d7f2ff" stroke="${DARK}" stroke-width="3"/>`;
    const wheel = (x) => `<circle cx="${x}" cy="44" r="22" fill="${DARK}"/><circle cx="${x}" cy="44" r="8" fill="#f5f3ea"/>`;
    return `<g class="${name}"><rect x="-122" y="-58" width="244" height="102" rx="18" fill="${SIGN.example}" stroke="${DARK}" stroke-width="5"/>
      ${pane(-106)}${pane(-54)}${pane(-2)}${pane(50, 56)}
      <path d="M-122,10 H122" stroke="${DARK}" stroke-width="6"/>${wheel(-68)}${wheel(70)}</g>`;
  }

  /** Points along a path, evenly spaced, each with the heading of the road there. */
  function samples(d, n = 48) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    const len = path.getTotalLength(), out = [];
    let last = null;
    for (let i = 0; i <= n; i++) {
      const at = (len * i) / n;
      const p = path.getPointAtLength(at);
      const a = path.getPointAtLength(Math.max(0, at - 3)), b = path.getPointAtLength(Math.min(len, at + 3));
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (last !== null) { while (deg - last > 180) deg -= 360; while (deg - last < -180) deg += 360; }
      last = deg;
      out.push({ x: p.x, y: p.y, deg });
    }
    return out;
  }

  /** Drive a car along a path, nose first through every bend. zoom(point) can size it by where it is. */
  function ride(s, node, d, t, dur, { easing = 'ease-in-out', zoom, gain = 0.4 } = {}) {
    const frames = samples(d).map((p) => {
      const frame = { translate: `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`, rotate: `${p.deg.toFixed(1)}deg` };
      if (zoom) frame.scale = String(zoom(p));
      return frame;
    });
    s.anim(node, frames, t, dur, easing);
    s.sfx('whoosh', t, gain);
  }

  /** A label that rides with a car but stays upright, and waits at minX until the car has come on board. */
  function tagAlong(s, node, d, t, dur, dy, minX) {
    s.anim(node, samples(d).map((p) => ({ translate: `${Math.max(minX, p.x).toFixed(1)}px ${(p.y + dy).toFixed(1)}px` })), t, dur, 'ease-in-out');
  }

  /** Put a car at the start of the road, showing from time t. */
  function park(s, node, x, y, t) {
    node.style.translate = `${x}px ${y}px`;
    s.appear(node, t, 0.15);
    return node;
  }

  const fade = (s, node, t, to = 0, dur = 0.3, from = 1) => s.anim(node, [{ opacity: from }, { opacity: to }], t, dur);

  /** The dashed hole in a sentence, where a sign belongs. */
  function blank(s, x, y, w, h, t) {
    const svg = s.shape(`<rect class="box" x="4" y="4" width="${w - 8}" height="${h - 8}" rx="18" fill="rgba(143,230,207,.1)" stroke="${s.ink.teal}" stroke-width="6" stroke-dasharray="20 15"/>`, { x, y, w, h });
    s.pop(svg.get('.box'), t);
    return svg;
  }

  /** A sign flies into the blank and the dashes go away. With rise it swoops in low and comes up from below. */
  function landSign(s, sign, slot, t, dur = 0.55, rise = 0) {
    const a = sign.getBoundingClientRect(), b = slot.getBoundingClientRect();
    sign._tx = b.x + b.width / 2 - a.x - a.width / 2;
    sign._ty = b.y + b.height / 2 - a.y - a.height / 2;
    s.anim(sign, [{ translate: '0px 0px' }, { translate: `${sign._tx}px ${sign._ty + rise}px`, offset: 0.72 }, { translate: `${sign._tx}px ${sign._ty}px` }], t, dur, 'ease-in-out');
    s.sfx('whoosh', t, 0.42);
    fade(s, slot.get('.box'), t + dur - 0.1, 0, 0.12);
    s.sfx('pop', t + dur, 0.8);
    s.stars(sign, t + dur, 8);
  }

  /** A tag of a set width, so cards in a grid line up. */
  function card(s, text, x, y, w, at, bg, size) {
    const n = s.tag(text, { x, y, at, bg, size });
    n.style.width = w + 'px';
    n.style.left = x - w / 2 + 'px';
    n.style.textAlign = 'center';
    n.style.whiteSpace = 'pre';
    return n;
  }

  /** The opening: a fork, a sign with an arrow, one car that obeys it and one sent into a wall. */
  function openingScene(s, c) {
    const start = 'M-90,490 H560', bendUp = 'C700,490 720,310 860,310 H1320', bendDown = 'C700,490 720,650 860,650';
    const g = s.shape(`${roads([start, `M560,490 ${bendUp}`, `M560,490 ${bendDown} H1040`], 76)}
      <g class="wall"><rect x="1042" y="584" width="58" height="132" rx="8" fill="${SIGN.warn}" stroke="${DARK}" stroke-width="5"/>
        <path d="M1042,622 L1100,592 M1042,664 L1100,634 M1042,706 L1100,676" stroke="#f5f3ea" stroke-width="12"/></g>
      <g class="sign"><rect x="380" y="270" width="18" height="176" rx="6" fill="#c9915a" stroke="${DARK}" stroke-width="3"/>
        <rect class="plate" x="202" y="172" width="376" height="104" rx="18" fill="${SIGN.example}" stroke="${DARK}" stroke-width="5"/>
        <text class="right" x="348" y="243" text-anchor="middle" font-size="60" font-family="Fredoka" font-weight="500" fill="#173a30">However,</text>
        <text class="wrong" x="348" y="243" text-anchor="middle" font-size="60" font-family="Fredoka" font-weight="500" fill="#3b1030">Also,</text>
        <path class="arrow" d="M482,224 H550 M526,198 L552,224 L526,250" fill="none" stroke="#173a30" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></g>
      ${car('one', SIGN.contrast, 1.2)}${car('two', SIGN.cause, 1.2)}`);
    const laid = c.word('road') - 0.05, signAt = c.word('signs');
    lay(s, g, 0, laid, 0.3);
    [1, 2].forEach((i) => lay(s, g, i, laid + 0.28, 0.35));
    s.grow(g.get('.sign'), signAt, 0.35, { from: '0', to: '1', origin: '50% 100%' });
    s.sfx('pop', signAt, 0.7);
    s.text('transition word', { x: 372, y: 288, size: 60, align: 'right', at: signAt + 0.15, dur: 0.6 });
    s.m.point({ x: 390, y: 224 }, signAt, 1.4);

    // The right sign: the arrow aims up the safe branch and the reader's car follows it off the board.
    s.turn(g.get('.arrow'), -38, c.word('which'), 0.4, { origin: '516px 224px' });
    const safe = `${start} ${bendUp}`, drive = c.word('turning') + 0.5 - c.tell;
    ride(s, park(s, g.get('.one'), -90, 490, c.tell), safe, c.tell, drive);
    const reader = s.tag('reader', { x: 0, y: 0, at: c.word('reader'), bg: SIGN.contrast, size: 46 });
    tagAlong(s, reader, safe, c.tell, drive, -112, 130);
    fade(s, reader, c.tell + drive * 0.72, 0, 0.15);
    wrongSign(s, c, g, `${start} ${bendDown} H972`);
  }

  /** The wrong sign goes up, the arrow swings down, the next car obeys it and hits the wall. */
  function wrongSign(s, c, g, road) {
    s.turn(g.get('.arrow'), 40, c.wrong, 0.35, { origin: '516px 224px' });
    fade(s, g.get('.right'), c.wrong, 0, 0.1);
    s.appear(g.get('.wrong'), c.wrong, 0.1);
    s.anim(g.get('.plate'), [{ fill: SIGN.example }, { fill: SIGN.warn }], c.word('wrong'), 0.15);
    s.m.mood('hmm', c.wrong, 0.9);
    s.m.look({ x: 390, y: 224 }, c.wrong, 0.8);
    s.m.look({ x: 1040, y: 640 }, c.crash, 1.2);
    s.pop(g.get('.wall'), c.wrong + 0.1, { gain: 0.5 });
    const hit = c.word('crashes');
    const two = park(s, g.get('.two'), -90, 490, c.wrong);
    ride(s, two, road, c.wrong, hit - c.wrong, { easing: 'cubic-bezier(.45,.1,.9,.75)' });
    s.anim(two, [{ translate: '972px 650px', rotate: '0deg' }, { translate: '934px 672px', rotate: '32deg' }], hit, 0.28, 'cubic-bezier(.2,1.4,.5,1)');
    s.turn(g.get('.wall'), 9, hit, 0.3, { origin: '1100px 716px' });
    s.sfx('boing', hit, 0.9);
    s.sfx('poof', hit, 0.9);
    s.stars({ x: 1040, y: 640 }, hit, 12, { spread: 150 });
    s.m.mood('oops', hit, 1.4);
    s.m.act('hop', hit, 0.4);
  }

  /** One of the four turns: a road stub that waits, then its sign, its road and its words on cue. */
  function turnCell(s, { name, bg, words, times, x, y, cue, stubAt, start, markup, go, point = true }) {
    const tag = s.tag(name, { x, y, at: cue, bg, size: 58 });
    const g = s.shape(markup, { x: x - 250, y: y + 90, w: 500, h: 150 });
    lay(s, g, 0, stubAt, 0.3);
    s.sfx('pop', stubAt, 0.5);
    s.words(words, { x, y: y + 246, size: 62, times });
    go(g, park(s, g.get('.c'), start[0], start[1], stubAt));
    if (point) s.m.point(tag, cue, 1.2);
  }

  /** Example: the car rolls under a magnifying glass and comes up big. */
  function exampleCell(s, c) {
    const lens = 330;
    turnCell(s, {
      name: 'Example', bg: SIGN.example, words: ['for', 'instance'], times: [c.word('for'), c.word('instance')], x: 320, y: 404, cue: c.d, stubAt: c.four + 0.4, start: [10, 70],
      markup: `${roads(['M10,70 H230', 'M230,70 H480'], 56)}
        <circle class="glass" cx="${lens}" cy="70" r="70" fill="rgba(215,242,255,.22)" stroke="#f5f3ea" stroke-width="8"/>
        ${car('c', SIGN.example, 0.82)}
        <path class="handle" d="M382,120 L418,150" stroke="#ffb066" stroke-width="15" stroke-linecap="round"/>`,
      go(g, piece) {
        lay(s, g, 1, c.d, 0.25);
        s.pop(g.get('.glass'), c.d, { gain: 0.5 });
        s.pop(g.get('.handle'), c.d, { gain: 0.1 });
        const away = (p) => Math.abs(p.x - lens);
        ride(s, piece, `M10,70 H${lens}`, c.d + 0.1, c.e - c.d - 0.25, { zoom: (p) => (away(p) > 90 ? 1 : 1 + 0.4 * (1 - away(p) / 90)) });
      },
    });
  }

  /** Cause and effect: the car bumps the first domino and the whole row goes down. */
  function causeCell(s, c) {
    const dominoes = [0, 1, 2, 3, 4].map((i) => 226 + i * 40);
    turnCell(s, {
      name: 'Cause and effect', bg: SIGN.cause, words: ['as', 'a', 'result'], times: [c.word('as'), c.word('a'), c.word('result')], x: 870, y: 404, cue: c.e, stubAt: c.four + 0.6, start: [10, 70], point: false,
      markup: `${roads(['M10,70 H120', 'M120,70 H200'], 56)}${car('c', SIGN.cause, 0.82)}
        ${dominoes.map((x, i) => `<g class="d${i}"><rect x="${x}" y="16" width="28" height="110" rx="6" fill="#f5f3ea" stroke="${DARK}" stroke-width="4"/><circle cx="${x + 14}" cy="44" r="6" fill="${DARK}"/><circle cx="${x + 14}" cy="98" r="6" fill="${DARK}"/></g>`).join('')}`,
      go(g, piece) {
        lay(s, g, 1, c.e, 0.2);
        const hit = c.word('effect');
        ride(s, piece, 'M10,70 H178', c.e, hit - c.e, { easing: 'ease-in' });
        dominoes.forEach((x, i) => {
          s.appear(g.get(`.d${i}`), c.e, 0.15);
          s.turn(g.get(`.d${i}`), i === 4 ? 88 : 70, hit + i * 0.13, 0.26, { origin: `${x + 28}px 126px`, easing: 'cubic-bezier(.5,0,.9,.7)' });
          s.sfx('tick', hit + i * 0.13, 0.7);
        });
        s.m.look(g.get('.d2'), c.e, 1.6);
        s.m.mood('wow', hit + 0.2, 0.9);
      },
    });
  }

  /** The four turns, each acted out: a hairpin, a straight run, a magnifying glass and falling dominoes. */
  function fourTurns(s, c) {
    turnCell(s, {
      name: 'Contrast', bg: SIGN.contrast, words: ['however,', 'nevertheless'], times: [c.word('however'), c.word('nevertheless')], x: 320, y: 78, cue: c.a, stubAt: c.four, start: [50, 110],
      markup: roads(['M50,110 H270', 'M270,110 H390 A40,40 0 0 0 390,30 H190'], 56) + car('c', SIGN.contrast, 0.82),
      go(g, piece) {
        lay(s, g, 1, c.a, 0.35);
        ride(s, piece, 'M50,110 H390 A40,40 0 0 0 390,30 H230', c.a + 0.15, c.b - c.a - 0.3);
      },
    });
    turnCell(s, {
      name: 'Continuation', bg: SIGN.continuation, words: ['also,', 'moreover'], times: [c.word('also'), c.word('moreover')], x: 870, y: 78, cue: c.b, stubAt: c.four + 0.2, start: [10, 70],
      markup: roads(['M10,70 H230', 'M230,70 H490'], 56) + car('c', SIGN.continuation, 0.82),
      go(g, piece) {
        lay(s, g, 1, c.b, 0.3);
        ride(s, piece, 'M10,70 H470', c.b + 0.1, c.d - c.b - 0.25);
      },
    });
    exampleCell(s, c);
    causeCell(s, c);
  }

  /** What the example sentence does on the road: straight on is expected, the hairpin is what happened. */
  function expectationRoad(s, c, v) {
    v.straight = 'M-60,650 H620';
    v.bend = 'M620,650 C760,650 760,450 620,450 H300';
    const g = s.shape(`<path class="ahead" d="M640,650 H985" fill="none" stroke="#f5f3ea" stroke-width="8" stroke-dasharray="22 20" stroke-linecap="round"/>
      <g class="flag"><path d="M1000,690 V560" stroke="#f5f3ea" stroke-width="9" stroke-linecap="round"/><path d="M1000,562 L1060,586 L1000,610 Z" fill="${s.ink.yellow}" stroke="${DARK}" stroke-width="3"/></g>
      ${roads([v.straight, 'M620,650 C760,650 760,450 620,450 H250'], 62)}${car('c', SIGN.contrast, 0.82)}${car('c2', SIGN.contrast, 0.82)}`);
    v.road = g;
    const expect = c.word('expect');
    lay(s, g, 0, c.exp, 0.5);
    s.appear(g.get('.ahead'), expect, 0.4);
    s.pop(g.get('.flag'), expect, { gain: 0.5 });
    v.hope = s.tag('Expected', { x: 922, y: 470, at: expect, bg: s.ink.yellow, size: 54 });
    v.piece = park(s, g.get('.c'), -60, 650, c.exp);
    ride(s, v.piece, v.straight, c.exp, c.but - c.exp);
    s.m.look(g.get('.flag'), c.exp, 1.6);

    const lost = c.word('lost', 1);
    lay(s, g, 1, c.but - 0.1, 0.5);
    s.tag('Lost', { x: 130, y: 416, at: lost, bg: s.ink.pink, size: 54 });
    ride(s, v.piece, v.bend, c.but, c.sur - c.but);
    s.m.look(v.two.w[1], c.but, 1);
    s.m.mood('oops', lost, 0.5);

    [g.get('.ahead'), g.get('.flag'), v.hope].forEach((n) => fade(s, n, c.sur, 0.2));
    s.m.mood('wow', c.sur, 1.1);
    s.m.act('hop', c.sur, 0.4);
    s.stars({ x: 730, y: 550 }, c.sur, 9, { spread: 130 });
  }

  LessonStudio.define({
    id: 'transitions',
    teacher: 'bluebold',
    title: 'Name the logical relationship',
    beats: [
      {
        say: `{hi}Bluebold here! {road}Transition words are road signs. {tell}They tell the reader which way the next sentence is turning. {wrong}Put up the wrong sign, {crash}and everyone crashes.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1);
          s.wideCam(c.road - 0.2, 1.1);
          s.text('Name the logical relationship', { y: 54, size: 84, color: s.ink.yellow, at: c.road + 0.5, dur: 1.2 });
          openingScene(s, c);
        },
      },
      {
        page: 'The idea',
        say: `{four}There are four main turns. {a}Contrast, like however or nevertheless. {b}Continuation, like also or moreover. {d}Example, like for instance. {e}And cause and effect, like as a result.`,
        run(s, c) {
          s.m.mood('happy', c.four, 1.2);
          fourTurns(s, c);
        },
      },
      {
        page: 'Watch me',
        say: `{a}The team practiced daily. {b}Blank. It lost the match. {hm}Hmm. {exp}You'd expect practice to help. {but}But they lost! {sur}That's a surprise. {con}That's contrast.`,
        run(s, c, v) {
          v.one = s.spoken('The team practiced daily.', c, c.a, { x: 67, y: 84, size: 92, align: 'left' });
          v.slot = blank(s, 67, 204, 480, 104, c.b);
          v.two = s.spoken('it lost the match.', c, c.word('It'), { x: 567, y: 200, size: 92, align: 'left' });
          s.m.point(v.slot, c.b, 1.2);
          s.m.mood('hmm', c.hm, 1.8);
          expectationRoad(s, c, v);
          const practice = c.word('practice'), lost = c.word('lost', 1);
          s.mark(v.one.w[2], practice, { color: s.ink.teal, hold: c.end + 0.3 - practice });
          s.mark(v.two.w[1], lost, { color: s.ink.pink, hold: c.end + 0.3 - lost });
          const named = c.word('contrast');
          const tag = s.tag('Contrast', { x: 460, y: 499, at: named, bg: SIGN.contrast, size: 72 });
          s.m.point(tag, named, 0.8);
        },
      },
      {
        say: `{so}So the sign is nevertheless. {a}The team practiced daily. {n}Nevertheless, {r}it lost the match.`,
        run(s, c, v) {
          const named = c.word('nevertheless');
          const sign = s.tag('Nevertheless,', { x: 900, y: 340, at: named, bg: SIGN.contrast, size: 70 });
          s.m.point(v.slot, named, 1);
          landSign(s, sign, v.slot, named + 0.3, 0.6, 104);
          fade(s, v.piece, c.so, 0, 0.2);
          [v.road.get('.ahead'), v.road.get('.flag'), v.hope].forEach((n) => fade(s, n, c.so, 0, 0.25, 0.2));

          // Read it aloud: the car takes the road again, word for word.
          const again = park(s, v.road.get('.c2'), -60, 650, c.a);
          ride(s, again, v.straight, c.a, c.n - c.a);
          ride(s, again, v.bend, c.n, c.end + 0.25 - c.n);
          s.read(v.one, c.from(c.a, 4));
          s.pulse(sign, c.n, { to: 1.1 });
          s.read(v.two, c.from(c.r, 4));
          s.m.act('nod', c.n, 0.8);
          s.m.mood('proud', c.r, 1.2);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}The bus was late. {b}Blank. I missed class. {ask}Which turn is it? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          v.one = s.spoken('The bus was late.', c, c.a, { x: 67, y: 84, size: 92, align: 'left' });
          v.slot = blank(s, 67, 204, 440, 104, c.b);
          v.two = s.spoken('I missed class.', c, c.word('I'), { x: 527, y: 200, size: 92, align: 'left' });
          s.m.point(v.slot, c.b, 1.1);
          v.ask = s.text('Which turn?', { x: 508, y: 326, size: 84, color: s.ink.yellow, at: c.ask, dur: 0.5 });
          v.options = [
            s.tag('Contrast', { x: 265, y: 446, at: c.ask + 0.1, bg: SIGN.contrast, size: 56 }),
            s.tag('Continuation', { x: 750, y: 446, at: c.ask + 0.2, bg: SIGN.continuation, size: 56 }),
            s.tag('Example', { x: 265, y: 556, at: c.ask + 0.3, bg: SIGN.example, size: 56 }),
            s.tag('Cause and effect', { x: 750, y: 556, at: c.ask + 0.4, bg: SIGN.cause, size: 56 }),
          ];
          s.m.point(v.ask, c.ask, 0.9);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Cause and effect! {why}The late bus caused it. {fit}As a result fits.`,
        run(s, c, v) {
          const right = v.options[3];
          fade(s, v.ask, c.ans, 0, 0.2);
          [0, 1, 2].forEach((i) => fade(s, v.options[i], c.ans, 0, 0.25));
          s.move(right, -30, -230, c.ans, 0.45);
          s.stars({ x: 720, y: 366 }, c.ans + 0.35, 9);
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);

          // The bus pulls in late, and the arrow shows what it caused.
          const late = c.word('late'), caused = c.word('caused');
          s.mark(v.one.w[3], late, { color: s.ink.blue });
          const g = s.shape(schoolBus('bus'));
          ride(s, park(s, g.get('.bus'), -160, 552, c.why), 'M-160,552 H200', c.why, caused - c.why, { easing: 'ease-out' });
          s.m.look({ x: 200, y: 552 }, c.why, 0.9);
          s.arrow({ x: 340, y: 552 }, { x: 560, y: 552 }, caused, { color: s.ink.blue, curve: 0.08, width: 11, head: 34 });
          s.mark(v.two.w[1], caused, { color: s.ink.blue });
          s.tag('missed class', { x: 760, y: 510, at: caused + 0.25, bg: s.ink.blue, size: 60 });
          s.m.point(v.two.w[1], caused, 0.9);

          const sign = s.tag('As a result,', { x: 300, y: 392, at: c.fit, bg: SIGN.cause, size: 66 });
          landSign(s, sign, v.slot, c.fit + 0.25);
          s.m.act('nod', c.fit, 0.7);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{fast}Here's the fast way. {pred}Predict the relationship in your own words, {before}before you look at the options. {say2}Say it. {a}That's a surprise. {b}Or, that's why. {then}Then look for your match.`,
        run(s, c) {
          const lines = `<path d="M-84,-16 H-132 M-92,4 H-170 M-84,22 H-126" stroke="#f5f3ea" stroke-width="7" stroke-linecap="round"/>`;
          const zip = s.shape(car('zip', s.ink.yellow, 1.2, lines));
          ride(s, park(s, zip.get('.zip'), -160, 400, c.fast), 'M-160,400 H1560', c.fast, c.pred - c.fast, { easing: 'cubic-bezier(.5,0,.6,1)', gain: 0.8 });
          s.m.mood('happy', c.fast, 1.2);

          s.text('Predict first', { y: 76, size: 112, color: s.ink.yellow, at: c.pred, dur: 0.6 });
          const own = s.text('in your own words', { y: 196, size: 72, at: c.word('in'), dur: 0.7 });
          s.m.look(own, c.word('own'), 1);

          // The options stay face down until the prediction has been said out loud.
          const spots = [[330, 486], [820, 486], [330, 594], [820, 594]];
          const options = c.word('options');
          const covers = ['A', 'B', 'C', 'D'].map((k, i) => card(s, `${k}   ?`, spots[i][0], spots[i][1], 440, options + i * 0.08, '#c9d6cf', 56));
          s.m.look({ x: 575, y: 560 }, options, 1);

          s.pulse(own, c.say2, { to: 1.1 });
          const bubble = (text, x, at, bg) => {
            const tail = s.shape(`<path class="t" d="M${x - 34},384 L${x + 6},384 L${x - 26},432 Z" fill="${bg}"/>`);
            s.pop(tail.get('.t'), at, { gain: 0.1 });
            return s.tag(text, { x, y: 306, at, bg, size: 54 });
          };
          bubble('That\'s a surprise!', 330, c.a, SIGN.contrast);
          s.m.mood('wow', c.a, 1);
          bubble('That\'s why!', 820, c.b, SIGN.cause);
          s.m.act('nod', c.b, 0.7);

          // Now look: the matching cards light up in the color of the words that found them.
          const look = c.word('look', 1);
          const faces = [['A   However,', SIGN.contrast], ['B   As a result,', SIGN.cause], ['C   For instance,', '#f5f3ea'], ['D   Moreover,', '#f5f3ea']].map(([text, bg], i) => {
            s.anim(covers[i], [{ scale: '1 1' }, { scale: '0 1' }], look + i * 0.08, 0.14, 'ease-in');
            return card(s, text, spots[i][0], spots[i][1], 440, look + 0.14 + i * 0.08, bg, 56);
          });
          const found = c.word('match');
          [2, 3].forEach((i) => fade(s, faces[i], found, 0.35));
          s.stars(faces[0], found, 7);
          s.stars(faces[1], found + 0.1, 7);
          s.m.look(faces[0], look, 1);
          s.m.mood('proud', found, 1);
          s.m.act('nod', found, 0.7);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{one}One warning. {two}Two facts sitting together don't prove cause and effect. {a}Sales rose. {b}The weather was warm. {t}Therefore? {not}Not unless the passage says so.`,
        run(s, c) {
          // A warning sign fills the board, then steps aside for the rule.
          const w = s.shape(`<g class="warn"><path d="M0,-58 L58,0 L0,58 L-58,0 Z" fill="${s.ink.yellow}" stroke="${DARK}" stroke-width="6" stroke-linejoin="round"/>
            <text x="0" y="26" text-anchor="middle" font-size="72" font-family="Fredoka" font-weight="600" fill="${DARK}">!</text></g>`);
          const warn = w.get('.warn');
          warn.style.translate = '614px 340px';
          warn.style.scale = '0';
          s.anim(warn, [{ scale: 0 }, { scale: 2.6 }], c.word('warning'), 0.34, 'cubic-bezier(.3,1.7,.5,1)');
          s.sfx('pop', c.word('warning'), 0.8);
          s.m.mood('hmm', c.one, 1.6);
          s.anim(warn, [{ translate: '614px 340px', scale: 2.6 }, { translate: '112px 132px', scale: 1 }], c.two - 0.3, 0.45);
          s.words(['Two', 'facts', '≠', 'cause', 'and', 'effect'], { x: 188, y: 84, size: 92, align: 'left', times: [c.two, c.word('facts'), c.word('don\'t'), c.word('cause'), c.word('and'), c.word('effect')] });

          s.spoken('Sales rose.', c, c.a, { x: 70, y: 226, size: 80, align: 'left' });
          s.spoken('The weather was warm.', c, c.b, { x: 450, y: 226, size: 80, align: 'left' });

          // "Therefore" hangs in the air with nothing under it, and falls.
          const ground = s.shape(`<path class="g" d="M170,704 H960" stroke="#f5f3ea" stroke-width="9" stroke-linecap="round" fill="none"/>`);
          s.draw(ground.get('.g'), c.t, 0.35, { gain: 0.3 });
          const sign = s.tag('Therefore?', { x: 565, y: 372, at: c.t, bg: SIGN.contrast, size: 84 });
          s.m.point(sign, c.t, Math.max(0.5, c.not - c.t));
          s.m.mood('sly', c.t, 0.7);
          s.anim(sign, [
            { translate: '0px 0px', rotate: '0deg', easing: 'cubic-bezier(.55,0,1,.6)' },
            { translate: '0px 196px', rotate: '5deg', offset: 0.68, easing: 'cubic-bezier(.2,.7,.5,1)' },
            { translate: '0px 166px', rotate: '3deg', offset: 0.82, easing: 'cubic-bezier(.5,0,1,.6)' },
            { translate: '0px 196px', rotate: '5deg' },
          ], c.not, 0.72, 'linear');
          s.sfx('whoosh', c.not, 0.6);
          s.sfx('boing', c.not + 0.48, 0.8);
          s.m.act('shake', c.not, 0.9);
          s.m.look({ x: 565, y: 620 }, c.not, 0.9);
          s.tag('Needs support', { x: 565, y: 384, at: c.word('passage'), bg: s.ink.yellow, size: 66 });
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{r}Read the sentence before the blank, {a}and the sentence after. {n}Name the turn. {p}Then pick the sign. {bye}Now hit Try this skill!`,
        run(s, c) {
          s.text('1. Read', { x: 60, y: 84, size: 92, align: 'left', at: c.r, dur: 0.4 });
          const before = s.tag('before', { x: 440, y: 102, at: c.word('before'), bg: s.ink.teal, size: 56 });
          const slot = blank(s, 566, 94, 262, 96, c.word('blank'));
          const after = s.tag('after', { x: 950, y: 102, at: c.word('after'), bg: s.ink.teal, size: 56 });
          s.m.point(before, c.word('before'), 0.9);
          s.m.point(after, c.word('after'), 0.8);

          s.text('2. Name the turn', { x: 60, y: 218, size: 92, align: 'left', at: c.n, dur: 0.6, color: s.ink.teal });
          const bendy = s.shape(`<path class="b" d="M650,300 H770 A36,36 0 0 0 770,228 H700" fill="none" stroke="${s.ink.teal}" stroke-width="12" stroke-linecap="round"/>
            <path class="h" d="M724,204 L698,228 L724,252" fill="none" stroke="${s.ink.teal}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`);
          s.draw(bendy.get('.b'), c.word('turn'), 0.4, { gain: 0.4 });
          s.appear(bendy.get('.h'), c.word('turn') + 0.38, 0.08);

          s.text('3. Pick the sign', { x: 60, y: 352, size: 92, align: 'left', at: c.p, dur: 0.6, color: s.ink.yellow });
          const sign = s.tag('However,', { x: 770, y: 362, at: c.word('pick'), bg: SIGN.contrast, size: 54 });
          landSign(s, sign, slot, c.word('sign'), 0.5);
          s.m.mood('proud', c.p, 3);

          // The reader's car creeps along with each step, then drives straight through to the button.
          const lane = s.shape(`${roads(['M-80,540 H1320'], 60)}${car('z', SIGN.contrast, 0.85)}`);
          lay(s, lane, 0, c.r, 0.5);
          const racer = park(s, lane.get('.z'), 90, 540, c.r);
          [[90, 300, c.a], [300, 520, c.n], [520, 740, c.p]].forEach(([from, to, at]) => ride(s, racer, `M${from},540 H${to}`, at, 0.5, { gain: 0.25 }));
          ride(s, racer, 'M740,540 H1400', c.bye, c.end - c.bye + 0.5, { easing: 'ease-in', gain: 0.7 });
          s.tag('Next: Try this skill', { x: 560, y: 612, at: c.bye + 0.2, bg: s.ink.yellow, size: 58 });
          s.m.act('wave', c.bye, 1.9);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
