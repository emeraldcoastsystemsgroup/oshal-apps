/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Use percent multipliers: bars lose and gain their percent chunks, a hoodie's price changes on one multiplication, two factors fly off a rising and falling bar into one product, and blocks show why the base decides the percent
 */
(function () {
  const TEAL = '#8fe6cf', PINK = '#ff9ccf', YELLOW = '#ffd66b';
  const DARK = '#16352b', PLUM = '#3b1030', BROWN = '#3b2a00', CHALK = '#f5f3ea';

  /** Text inside a bar or block, in the chalk font. */
  const label = (x, y, size, fill, text, cls = '') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-family="Chalk" fill="${fill}">${text}</text>`;

  /** A rounded bar part with an optional label centered in it. */
  function part(cls, x, y, w, h, fill, text = '', ink = DARK, size = 66) {
    return `<g class="${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}"/>${text ? label(x + w / 2, y + h / 2 + size * 0.34, size, ink, text) : ''}</g>`;
  }

  /** A row of equal blocks named .b0, .b1 and so on, the last one pink, so each can pop in or fall away. */
  function blocks({ x, y, w, h, labels }) {
    const last = labels.length - 1;
    return labels.map((text, i) => part(`b${i}`, x + i * (w + 6), y, w, h, i === last ? PINK : TEAL, text, i === last ? PLUM : DARK)).join('');
  }

  /** A hoodie, drawn from its own origin. */
  function hoodie(x, y) {
    return `<g class="hoodie"><g transform="translate(${x},${y})">
      <path d="M58,66 L8,186 Q4,204 22,208 L50,214 L84,118 Z" fill="#e8904a"/>
      <path d="M202,66 L252,186 Q256,204 238,208 L210,214 L176,118 Z" fill="#e8904a"/>
      <path d="M58,64 Q130,36 202,64 L208,244 Q130,258 52,244 Z" fill="#ffb066"/>
      <path d="M82,62 Q130,-22 178,62 Q130,100 82,62 Z" fill="#e8904a"/>
      <path d="M100,60 Q130,6 160,60 Q130,82 100,60 Z" fill="#6b3a17"/>
      <path d="M116,84 V128 M144,84 V128" stroke="#fff4e0" stroke-width="6" stroke-linecap="round" fill="none"/>
      <path d="M84,176 H176 L192,232 H68 Z" fill="#e8904a"/>
    </g></g>`;
  }

  /** Up twenty then down twenty, one unit to six pixels, so the two chunks are honestly different sizes. */
  function upThenDown() {
    return `${part('r1', 70, 208, 600, 104, TEAL, '100', DARK, 76)}${part('up', 670, 208, 120, 104, YELLOW, '+20', BROWN, 66)}
      ${part('r2', 70, 352, 576, 104, TEAL)}${part('cut', 646, 352, 144, 104, PINK, '−24', PLUM, 66)}
      ${label(358, 430, 76, DARK, '96', 'n96')}
      <rect class="miss" x="648" y="352" width="22" height="104" fill="#ff8080"/>
      <path class="line" d="M670,198 V474" fill="none" stroke="${CHALK}" stroke-width="6" stroke-dasharray="16 12" stroke-linecap="round"/>`;
  }

  /** Let a chunk of a bar break off and fall away. */
  function drop(s, node, t, dx = 70, dy = 170) {
    s.anim(node, [{ translate: '0px 0px', rotate: '0deg', opacity: 1 }, { translate: `${dx}px ${dy}px`, rotate: '24deg', opacity: 0 }], t, 0.7, 'cubic-bezier(.5,0,.8,.6)');
    s.sfx('whoosh', t, 0.6);
  }

  /** Bring every block of a row in, one quick pop after another. */
  function popAll(s, row, count, t) {
    for (let i = 0; i < count; i++) s.pop(row.get(`.b${i}`), t + i * 0.06, { gain: 0.25 });
  }

  /** Fly a factor into its slot in the product, growing to the slot's size and swinging low past what is already written. */
  function flyInto(s, node, slot, t, swing = 0) {
    const a = node.getBoundingClientRect(), b = slot.getBoundingClientRect();
    const dx = b.left + b.width / 2 - a.left - a.width / 2, dy = b.top + b.height / 2 - a.top - a.height / 2;
    s.anim(node, [{ translate: '0px 0px', scale: 1 }, { translate: `${dx / 2}px ${dy / 2 + swing}px`, scale: 1.1 }, { translate: `${dx}px ${dy}px`, scale: 1.2 }], t, 0.5, 'ease-in-out');
    s.sfx('whoosh', t, 0.42);
  }

  LessonStudio.define({
    id: 'percent',
    teacher: 'pinky',
    title: 'Use percent multipliers',
    facts: [
      ['100 - 20', 80],
      ['1 - 0.2', 0.8],
      ['1 + 0.2', 1.2],
      ['100 + 20', 120],
      ['5 * 20', 100],
      ['4 * 20', 80],
      ['50 * 0.8', 40],
      ['100 - 25', 75],
      ['4 * 25', 100],
      ['3 * 25', 75],
      ['1 - 0.25', 0.75],
      ['80 * 0.75', 60],
      ['100 * 1.2', 120],
      ['120 * 0.8', 96],
      ['1.2 * 0.8', 0.96],
      ['0.2 * 100', 20],
      ['0.2 * 120', 24],
      ['120 - 24', 96],
      ['4 * 10', 40],
      ['5 * 10', 50],
      ['50 - 40', 10],
      ['10 / 40', 0.25],
      ['10 / 50', 0.2],
    ],
    beats: [
      {
        say: `{hi}Hey, it's Pinky! {stack}If you've been finding the percent, then subtracting, then doing it all over again, {good}I have good news. {one}One move does all of it.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.6);
          s.wideCam(c.stack - 0.3, 1.1);
          s.m.look('board', c.word('finding'), 3.2);
          const steps = [
            s.text('Find the %', { y: 110, size: 100, color: s.ink.teal, at: c.word('finding'), dur: 0.5 }),
            s.text('Subtract', { y: 240, size: 100, color: s.ink.pink, at: c.word('subtracting'), dur: 0.5 }),
            s.text('Do it all again', { y: 370, size: 100, at: c.word('doing'), dur: 0.7 }),
          ];
          const loop = s.shape(`<path class="l" d="M920,425 C1090,410 1090,175 860,165" fill="none" stroke="${YELLOW}" stroke-width="9" stroke-linecap="round"/>
            <path class="h" d="M892,136 L856,165 L894,194" fill="none" stroke="${YELLOW}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
          s.draw(loop.get('.l'), c.word('again'), 0.32);
          s.draw(loop.get('.h'), c.word('again') + 0.32, 0.1);
          s.m.mood('sly', c.good, 2.4);
          steps.forEach((n, i) => {
            s.anim(n, [{ translate: '0px 0px' }, { translate: `0px ${190 - 130 * i}px` }], c.one, 0.25);
            s.hide(n, c.one, 0.2);
          });
          s.hide(loop, c.one, 0.15);
          s.sfx('whoosh', c.one, 0.6);
          const title = s.text('Use percent multipliers', { y: 300, size: 100, color: s.ink.yellow, at: c.one + 0.15, dur: 0.6 });
          s.m.point(title, c.one + 0.15, 1.1);
        },
      },
      {
        page: 'The idea',
        say: `{mul}A percent change is just a multiplication: {val}the starting value, {times}times {rate}one plus or minus the rate. {off}Twenty percent off means you keep eighty percent. {eight}So you multiply by point eight. {up}Twenty percent up? {onetwo}Multiply by one point two.`,
        run(s, c) {
          const head = s.words(['Percent', 'change', '=', 'multiply'], { y: 92, size: 100, times: [c.word('percent'), c.word('change'), c.word('is'), c.word('multiplication')] });
          const swipe = s.mark(head.w[3], c.word('multiplication'));
          s.m.point(head, c.mul, 1.3);
          const formula = s.words(['start', '×', '(1', '±', 'rate)'], { y: 206, size: 108, color: s.ink.yellow, times: [c.word('starting'), c.times, c.word('one'), c.word('plus'), c.word('rate')] });
          s.tint(formula.w[3], s.ink.pink, c.word('plus'));
          s.m.look({ x: 614, y: 260 }, c.val, 2.4);
          s.hide(head, c.off, 0.25);
          s.hide(swipe, c.off, 0.25);
          s.move(formula, 0, -128, c.off, 0.45);

          // Twenty percent off: the bar loses its last fifth.
          const a = s.words(['20%', 'off', '=', '1 − 0.2'], { x: 70, y: 204, size: 80, align: 'left', times: [c.off, c.word('off'), c.eight, c.eight + 0.12] });
          a.w[3].style.color = s.ink.teal;
          const barA = s.shape(`${part('keep', 70, 292, 440, 104, TEAL)}${part('chunk', 510, 292, 110, 104, PINK, '20%', PLUM, 62)}${label(290, 368, 76, DARK, 'keep 80%', 'kt')}`);
          s.grow(barA.get('.keep'), c.off, 0.35, { from: '0 1', origin: '0% 50%' });
          s.pop(barA.get('.chunk'), c.word('off'), { gain: 0.6 });
          drop(s, barA.get('.chunk'), c.word('keep'));
          s.appear(barA.get('.kt'), c.word('eighty'));
          s.m.look({ x: 320, y: 340 }, c.off, 1.8);
          const m1 = s.words(['×', '0.8'], { x: 900, y: 262, size: 140, color: s.ink.yellow, times: [c.word('multiply'), c.word('point')] });
          s.pulse(m1.w[1], c.word('eight'));
          s.m.point(m1, c.word('multiply'), 1.1);

          // Twenty percent up: the bar gains a fifth.
          const b = s.words(['20%', 'up', '=', '1 + 0.2'], { x: 70, y: 434, size: 80, align: 'left', times: [c.up, c.word('up'), c.onetwo, c.onetwo + 0.12] });
          b.w[3].style.color = s.ink.teal;
          const barB = s.shape(`${part('whole', 70, 522, 550, 104, TEAL, '100%', DARK, 72)}${part('more', 620, 522, 110, 104, YELLOW, '20%', BROWN, 62)}`);
          s.grow(barB.get('.whole'), c.up, 0.35, { from: '0 1', origin: '0% 50%' });
          s.pop(barB.get('.more'), c.word('up'), { gain: 0.7 });
          const m2 = s.words(['×', '1.2'], { x: 900, y: 492, size: 140, color: s.ink.yellow, times: [c.onetwo, c.word('one', 1)] });
          s.pulse(m2.w[1], c.word('two'));
          s.m.mood('happy', c.onetwo, 1.6);
          s.m.point(m2, c.onetwo, 1.3);
        },
      },
      {
        page: 'Watch me',
        say: `{item}A fifty dollar hoodie, twenty percent off. {dont}Don't find the twenty percent and then subtract. {keep}You keep eighty percent. {calc}Fifty times point eight. {ans}Forty dollars.`,
        run(s, c) {
          const hood = s.shape(hoodie(52, 84));
          s.pop(hood.get('.hoodie'), c.word('hoodie'));
          const price = s.text('$50', { x: 460, y: 96, size: 128, color: s.ink.teal, at: c.word('fifty'), dur: 0.3 });
          s.words(['20%', 'off'], { x: 460, y: 238, size: 84, color: s.ink.pink, times: [c.word('twenty'), c.word('off')] });
          s.m.look({ x: 200, y: 200 }, c.item, 1.9);
          const bar = s.shape(blocks({ x: 70, y: 356, w: 130, h: 100, labels: ['20%', '20%', '20%', '20%', '20%'] }));
          popAll(s, bar, 5, c.word('off'));

          // The long way goes up, gets crossed out, and goes away.
          s.m.act('shake', c.dont, 0.9);
          s.m.mood('hmm', c.dont, 1.8);
          const d1 = s.words(['Find', '20%'], { x: 880, y: 100, size: 88, times: [c.word('find'), c.word('twenty', 1)] });
          const d2 = s.words(['then', 'subtract'], { x: 880, y: 204, size: 88, times: [c.word('then'), c.word('subtract')] });
          const x1 = s.strike(d1, c.word('subtract') + 0.3, { dim: 1 });
          const x2 = s.strike(d2, c.word('subtract') + 0.42, { dim: 1 });
          [d1, d2, x1, x2].forEach((n) => s.hide(n, c.keep + 0.1, 0.25));

          // You keep the rest, and that is the multiplier.
          drop(s, bar.get('.b4'), c.keep);
          s.words(['keep', '80%'], { x: 775, y: 338, size: 108, align: 'left', color: s.ink.yellow, times: [c.keep, c.word('eighty')] });
          s.m.point({ x: 340, y: 406 }, c.keep, 1.2);
          const m = s.eq(['50', '×', '0.8', '=', '$40'], { x: 470, y: 500, size: 136, gap: 0.28, times: [c.calc, c.word('times'), c.word('point'), c.ans, c.ans + 0.1] });
          m.w[2].style.color = s.ink.yellow;
          m.w[4].style.color = s.ink.yellow;
          s.m.look(m, c.calc, 1.3);
          s.circle(m.w[4], c.ans + 0.3, { color: s.ink.yellow, pad: 12 });
          s.stars(m.w[4], c.ans + 0.3, 8);
          s.swap(price, '$40', c.ans + 0.35, { color: s.ink.yellow });
          s.m.act('thumbs', c.ans, 1.2);
          s.m.mood('proud', c.ans, 1.8);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}Eighty dollars, twenty-five percent off. {ask}What do you multiply by, and what's the price? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          s.m.look('board', c.a, 1.8);
          s.words(['$80,', '25%', 'off'], { y: 100, size: 124, times: [c.word('Eighty'), c.word('twenty-five'), c.word('off')] });
          v.by = s.words(['Multiply', 'by'], { x: 250, y: 236, size: 104, align: 'left', color: s.ink.teal, times: [c.word('multiply'), c.word('by')] });
          v.ask1 = s.text('?', { x: 720, y: 236, size: 104, align: 'left', color: s.ink.yellow, at: c.word('by') + 0.15, dur: 0.15 });
          v.asked = s.words(['Price', '='], { x: 250, y: 352, size: 104, align: 'left', color: s.ink.teal, times: [c.word('price'), c.word('price') + 0.1] });
          v.ask2 = s.text('?', { x: 560, y: 352, size: 104, align: 'left', color: s.ink.yellow, at: c.word('price') + 0.2, dur: 0.15 });
          s.m.point(v.by, c.word('multiply'), 1.1);
          s.m.act('think', c.end + 0.1, 4.9);
          s.m.mood('hmm', c.end + 0.1, 4.9);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Point seven five! {price}Eighty times that is sixty dollars.`,
        run(s, c, v) {
          s.hide(v.ask1, c.ans, 0.12);
          const value = s.text('0.75', { x: 720, y: 236, size: 104, align: 'left', color: s.ink.yellow, at: c.ans, dur: 0.4 });
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);
          const bar = s.shape(blocks({ x: 120, y: 510, w: 170, h: 100, labels: ['25%', '25%', '25%', '25%'] }));
          popAll(s, bar, 4, c.ans);
          drop(s, bar.get('.b3'), c.word('five'), 60, 110);
          s.text('keep 75%', { x: 670, y: 506, size: 96, align: 'left', color: s.ink.teal, at: c.word('five') + 0.25, dur: 0.35 });

          // The multiplier comes down into the working, and the price comes out.
          s.hide(v.asked, c.price, 0.15);
          s.hide(v.ask2, c.price, 0.15);
          const m = s.eq(['80', '×', '0.75', '=', '$60'], { x: 250, y: 352, size: 104, gap: 0.28, align: 'left', times: [c.price, c.word('times'), c.word('that'), c.word('is'), c.word('sixty')] });
          m.w[2].style.opacity = 0;
          m.w[4].style.color = s.ink.yellow;
          s.hide(v.by, c.word('that'), 0.25);
          s.flyTo(value, m.w[2], c.word('that'), 0.4);
          s.circle(m.w[4], c.word('sixty') + 0.3, { color: s.ink.yellow, pad: 12 });
          s.stars(m.w[4], c.word('sixty') + 0.2, 9);
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{why}Here's why this is so good. {two}Two changes in a row? Just multiply the factors. {up}Up twenty percent, {down}then down twenty percent. {calc}One point two, times point eight. {ans}Point nine six.`,
        run(s, c, v) {
          const b = s.bars([100], { x: 170, y: 100, w: 170, h: 600, max: 125, at: c.why, colors: [s.ink.teal] });
          const start = s.shape(`<path class="line" d="M132,220 H360" fill="none" stroke="${CHALK}" stroke-width="6" stroke-dasharray="18 14" stroke-linecap="round"/>`);
          s.appear(start.get('.line'), c.why + 0.2);
          s.text('100', { x: 86, y: 178, size: 72, at: c.why + 0.2, dur: 0.3 });
          s.m.mood('sly', c.why, 1.5);
          s.m.look({ x: 255, y: 400 }, c.why, 1.6);

          const two = s.words(['Two', 'changes?'], { x: 890, y: 92, size: 92, times: [c.two, c.word('changes')] });
          const how = s.words(['Multiply', 'the', 'factors'], { x: 890, y: 196, size: 80, color: s.ink.teal, times: [c.word('multiply'), c.word('the'), c.word('factors')] });

          // The bar goes up and comes down, and each change leaves its factor beside it.
          const f1 = s.words(['×', '1.2'], { x: 470, y: 112, size: 110, color: s.ink.yellow, times: [c.up, c.word('twenty')] });
          b.setTo(0, 120, c.up);
          s.sfx('whoosh', c.up, 0.6);
          const n120 = s.place('120', { x: 255, y: 134, size: 88, color: DARK });
          s.show(n120, c.up + 0.3, 0.2);
          s.hide(n120, c.word('down'), 0.15);
          const f2 = s.words(['×', '0.8'], { x: 470, y: 252, size: 110, color: s.ink.pink, times: [c.word('down'), c.word('twenty', 1)] });
          b.setTo(0, 96, c.word('down'));
          s.sfx('whoosh', c.word('down'), 0.6);
          const n96 = s.place('96', { x: 255, y: 250, size: 88, color: DARK });
          s.show(n96, c.word('down') + 0.3, 0.2);
          s.m.look({ x: 255, y: 240 }, c.up, 2.2);

          // The two factors fly over and become one product.
          s.hide(two, c.calc, 0.2);
          s.move(how, 0, -104, c.calc, 0.4);
          const m = s.words(['1.2', '×', '0.8'], { x: 890, y: 214, size: 132, times: [c.calc, c.word('times'), c.word('point', 1)] });
          m.w[0].style.opacity = 0;
          m.w[2].style.opacity = 0;
          s.hide(f1.w[0], c.calc, 0.15);
          flyInto(s, f1.w[1], m.w[0], c.calc);
          s.hide(f2.w[0], c.word('point', 1), 0.15);
          flyInto(s, f2.w[1], m.w[2], c.word('point', 1), 150);
          s.m.look({ x: 890, y: 280 }, c.calc, 2);
          v.ans = s.text('= 0.96', { x: 890, y: 360, size: 140, color: s.ink.yellow, at: c.ans, dur: 0.3 });
          s.circle(v.ans, c.ans + 0.45, { color: s.ink.yellow });
          s.m.mood('wow', c.ans, 1.6);
        },
      },
      {
        say: `{look}And look at that.`,
        run(s, c, v) {
          s.m.point(v.ans, c.look, 1.1);
          s.tag('not 1!', { x: 890, y: 548, at: c.word('that'), bg: '#ff8080', size: 56 });
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{walk}Up twenty, down twenty, and you do not get back to the start. {why}They don't cancel, {big}because the second twenty percent is twenty percent of a bigger number.`,
        run(s, c) {
          const top = s.words(['+20%', '−20%', '≠', 'start'], { y: 84, size: 104, times: [c.walk, c.word('down'), c.word('not'), c.word('start')] });
          top.w[2].style.color = s.ink.red;
          top.w[3].style.color = s.ink.red;

          const bars = s.shape(upThenDown());
          s.grow(bars.get('.r1'), c.start, 0.25, { from: '0 1', origin: '0% 50%' });
          s.appear(bars.get('.line'), c.start + 0.1);
          s.tag('start', { x: 670, y: 478, at: c.word('start'), bg: CHALK, size: 44 });
          s.pop(bars.get('.up'), c.word('twenty'), { gain: 0.7 });
          [bars.get('.r2'), bars.get('.cut')].forEach((n) => {
            n.style.opacity = 0;
            s.anim(n, [{ translate: '0px -144px', opacity: 0 }, { translate: '0px 0px', opacity: 1 }], c.word('down'), 0.3);
          });
          s.sfx('whoosh', c.word('down'), 0.5);
          s.m.mood('wow', c.walk, 2);
          s.m.look({ x: 430, y: 330 }, c.walk, 1.6);
          s.anim(bars.get('.cut'), [{ translate: '0px 0px' }, { translate: '36px 0px' }], c.word('twenty', 1) + 0.15, 0.3);
          s.appear(bars.get('.n96'), c.word('twenty', 1) + 0.3);
          s.appear(bars.get('.miss'), c.word('not'), 0.2);
          s.m.act('shake', c.word('not'), 0.9);

          s.words(['They', "don't", 'cancel'], { y: 566, x: 480, size: 104, color: s.ink.red, times: [c.why, c.word("don't"), c.word('cancel')] });
          s.words(['20%', 'of', '100'], { x: 846, y: 218, size: 80, align: 'left', at: c.big, per: 0.1 });
          const cap = s.words(['20%', 'of', '120'], { x: 846, y: 362, size: 80, align: 'left', times: [c.word('second'), c.word('of'), c.word('bigger')] });
          s.mark(cap.w[2], c.word('bigger'));
          s.m.point(cap, c.word('second'), 1.8);
          s.m.mood('hmm', c.big, 2.2);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{last}Last trap. Always name the base. {go}Going from forty to fifty {ten}is a change of ten. {over}Ten out of forty, the starting value, {ans}is twenty-five percent. {not}Not twenty.`,
        run(s, c) {
          s.m.mood('sly', c.last, 1.2);
          const head = s.words(['Last', 'trap:', 'name', 'the', 'base'], { y: 84, size: 96, gap: 0.38, color: s.ink.yellow, times: [c.last, c.word('trap'), c.word('name'), c.word('the'), c.word('base')] });
          head.w[0].style.color = s.ink.white;
          head.w[1].style.color = s.ink.white;
          s.circle(head.find('base'), c.word('base') + 0.2, { color: s.ink.pink, pad: 13 });
          s.m.point(head, c.word('name'), 1);

          s.words(['40', '→', '50'], { x: 300, y: 200, size: 124, times: [c.word('forty'), c.word('to'), c.word('fifty')] });
          const row = s.shape(blocks({ x: 70, y: 340, w: 150, h: 100, labels: ['10', '10', '10', '10', '10'] }));
          popAll(s, row, 4, c.word('forty'));
          s.pop(row.get('.b4'), c.word('fifty'), { gain: 0.7 });
          s.m.look({ x: 400, y: 390 }, c.go, 2);
          s.text('+10', { x: 769, y: 244, size: 96, color: s.ink.pink, at: c.word('ten'), dur: 0.25 });

          const f = s.eq(['10', '/', '40', '=', '25%'], { x: 340, y: 540, size: 116, times: [c.over, c.word('out'), c.word('forty', 1), c.ans, c.word('twenty-five')] });
          f.w[0].style.color = s.ink.pink;
          f.w[2].style.color = s.ink.yellow;
          f.w[4].style.color = s.ink.yellow;
          s.frame({ x: 60, y: 330, w: 636, h: 120 }, c.word('forty', 1));
          s.tag('the base', { x: 378, y: 456, at: c.word('starting'), bg: YELLOW, size: 48 });
          s.mark(f.w[2], c.word('starting'));
          s.m.point(f.w[2], c.word('starting'), 1.1);
          s.m.mood('proud', c.ans, 1.2);

          const wrong = s.eq(['10', '/', '50', '=', '20%'], { x: 690, y: 562, size: 80, gap: 0.14, align: 'left', at: c.not, per: 0.05 });
          s.strike(wrong, c.word('twenty'), { dim: 0.75 });
          s.m.act('shake', c.not, 0.7);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{one}A percent change is a multiplication. {base}And always ask: percent of what? {bye}Now hit Try this skill, and go get 'em!`,
        run(s, c) {
          const a = s.words(['Percent', 'change', '=', 'multiply'], { y: 120, size: 108, times: [c.word('percent'), c.word('change'), c.word('is'), c.word('multiplication')] });
          s.mark(a.w[3], c.word('multiplication'));
          s.m.look(a, c.one, 2);
          const b = s.words(['Percent', 'of', 'what?'], { y: 290, size: 116, gap: 0.38, color: s.ink.yellow, times: [c.word('percent', 1), c.word('of'), c.word('what')] });
          s.circle(b.w[2], c.word('what') + 0.15, { color: s.ink.pink, pad: 13 });
          s.m.point(b, c.word('percent', 1), 1.1);
          s.m.mood('proud', c.base, 3);
          s.tag('Next: Try this skill', { x: 614, y: 500, at: c.word('Try'), bg: '#ffd66b', size: 56 });
          s.m.act('wave', c.bye, 2.1);
          s.confetti(c.bye + 0.6);
        },
      },
    ],
  });
})();
