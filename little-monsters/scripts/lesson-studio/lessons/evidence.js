/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Choose what the text supports: an inference stands on a column of evidence while a plausible guess topples, a pointing finger traces a choice to the passage's exact words and hunts in vain for the next one, the claims fly into three bins, outside knowledge bounces off the passage, and the finger checks every choice until one falls
 */
(function () {
  const GO = 'cubic-bezier(.45,.05,.2,1)';

  /**
   * Run a measurement or a hand-drawn mark on a node at full size. s.pop parks a tag at
   * scale 0 until its moment, and the stage's marks measure the node while building.
   */
  function atFullSize(node, work) {
    const parked = node.style.scale;
    node.style.scale = '1';
    const out = work();
    node.style.scale = parked;
    return out;
  }

  /** Where a node sits on the board. Valid while building: nothing has moved yet. */
  function spot(s, node) {
    return atFullSize(node, () => {
      const o = s.page.getBoundingClientRect(), r = node.getBoundingClientRect();
      return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, cx: r.left - o.left + r.width / 2, bottom: r.bottom - o.top };
    });
  }

  /** The point just under a word, where a fingertip touches it. */
  function under(s, node) {
    const b = spot(s, node);
    return [b.cx, b.bottom + 2];
  }

  const HAND = `<path class="palm" d="M28,78 L28,18 C28,6 52,6 52,18 L52,58 C54,48 72,48 73,60 C76,52 92,52 93,64 C96,58 110,60 110,72 L110,104 C110,130 92,146 68,146 L52,146 C36,146 26,136 20,124 L4,94 C-2,84 12,72 22,82 L28,90 Z" fill="#35c4b6" stroke="#0d2a24" stroke-width="6" stroke-linejoin="round"/>
    <path d="M52,58 V88 M73,60 V88 M93,64 V88" fill="none" stroke="#0d2a24" stroke-width="4" stroke-linecap="round"/>`;

  /** A big pointing finger in Tealy's color, tip at a board point, so "point to it" really happens on the board. */
  function finger(s, x, y, at) {
    const hand = s.shape(HAND, { x: x - 40, y: y - 4, w: 120, h: 150 });
    hand.style.filter = 'drop-shadow(0 7px 5px rgba(0,0,0,.32))';
    s.show(hand, at, 0.18);
    let now = [0, 0];
    hand.slide = (nx, ny, t, dur = 0.42, easing = GO) => {
      const to = [nx - x, ny - y];
      s.anim(hand, [{ translate: `${now[0]}px ${now[1]}px` }, { translate: `${to[0]}px ${to[1]}px` }], t, dur, easing);
      now = to;
      return hand;
    };
    hand.along = (stops, t, dur) => {
      const frames = stops.map(([nx, ny, offset]) => ({ translate: `${nx - x}px ${ny - y}px`, offset }));
      s.anim(hand, frames, t, dur, 'linear');
      const last = stops[stops.length - 1];
      now = [last[0] - x, last[1] - y];
      return hand;
    };
    hand.done = (t) => s.anim(hand, [{ opacity: 1 }, { opacity: 0 }], t, 0.22);
    return hand;
  }

  /** The soft card every passage in this lesson is written on. */
  function passageCard(s, x, y, w, h, at, inside = '') {
    const g = s.shape(`<rect class="r" x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="rgba(245,243,234,.07)" stroke="rgba(245,243,234,.6)" stroke-width="5"/>${inside}`, { layer: 'under' });
    s.appear(g.get('.r'), at, 0.3);
    s.draw(g.get('.r'), at, 0.6, { gain: 0.3 });
    return g;
  }

  /** A soft puff of chalk dust along the floor where something lands. */
  function dust(s, x, y, t) {
    const puffs = [-3, -2, -1, 0, 1, 2, 3].map((k) => ({ cx: x + k * 76, r: 30 - Math.abs(k) * 3, dx: k * 26, dy: -46 + Math.abs(k) * 8 }));
    const g = s.shape(puffs.map((p) => `<circle class="d" cx="${p.cx}" cy="116" r="${p.r}" fill="#f5f3ea"/>`).join(''), { y: y - 120, h: 160 });
    g.style.filter = 'blur(7px)';
    g.querySelectorAll('.d').forEach((n, i) => {
      n.style.opacity = 0;
      n.style.transformBox = 'fill-box';
      n.style.transformOrigin = '50% 50%';
      s.anim(n, [{ opacity: 0.7, translate: '0px 0px', scale: 0.5 }, { opacity: 0, translate: `${puffs[i].dx}px ${puffs[i].dy}px`, scale: 1.5 }], t, 0.65, 'ease-out');
    });
    s.sfx('poof', t, 0.7);
  }

  /** Wobble, drop and bounce: what a claim does with nothing under it. */
  function topple(s, node, t, dy) {
    s.anim(node, [
      { translate: '0px 0px', rotate: '0deg', offset: 0 },
      { translate: '4px 0px', rotate: '-4deg', offset: 0.14 },
      { translate: '-2px 0px', rotate: '4deg', offset: 0.28, easing: 'cubic-bezier(.55,0,1,.6)' },
      { translate: `0px ${dy}px`, rotate: '6deg', offset: 0.74, easing: 'ease-out' },
      { translate: `0px ${dy - 30}px`, rotate: '5deg', offset: 0.86, easing: 'ease-in' },
      { translate: `0px ${dy}px`, rotate: '6deg', offset: 1 },
    ], t, 1.05, 'linear');
  }

  /** The column of evidence that holds the inference up, and the floor the guess lands on. */
  const COLUMN = `<path class="ground" d="M70,520 H1100" stroke="#f5f3ea" stroke-width="8" stroke-linecap="round"/>
    <g class="col">
      <rect x="165" y="486" width="330" height="34" rx="8" fill="#8fe6cf" stroke="#16352b" stroke-width="4"/>
      <rect x="196" y="266" width="268" height="222" fill="#c9f3e8" stroke="#16352b" stroke-width="4"/>
      <path d="M232,276 V344 M330,276 V344 M428,276 V344 M232,414 V478 M330,414 V478 M428,414 V478" stroke="#5fc7ae" stroke-width="8" stroke-linecap="round"/>
      <rect x="172" y="236" width="316" height="32" rx="8" fill="#8fe6cf" stroke="#16352b" stroke-width="4"/>
      <text x="330" y="396" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="54" fill="#173a30">evidence</text>
    </g>`;

  /** An open bin, solid for what the text gives you and dashed for what it does not. */
  function binMarkup(i, x, w, color, dashed) {
    return `<path class="bin${i}" d="M${x},296 L${x + 16},648 H${x + w - 16} L${x + w},296" fill="rgba(245,243,234,.06)" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="26 20"' : ''}/>`;
  }

  /** Write a claim as it is spoken, then fly each word down to rest in the bin. Never before the claim is finished. */
  function sortInto(s, c, cue, text, centerX, t) {
    const line = s.spoken(text, c, cue, { y: 92, size: 68 });
    const said = c.from(cue, line.w.length);
    const when = Math.max(said[said.length - 1].t1, t);
    const slot = s.words(text, { hidden: true, x: centerX, y: 330, size: 68, wrap: 296, align: 'center', leading: 1.16 });
    slot.style.top = 634 - slot.getBoundingClientRect().height + 'px';
    line.w.forEach((w, i) => {
      const a = spot(s, w), b = spot(s, slot.w[i]);
      s.anim(w, [{ translate: '0px 0px' }, { translate: `${b.x - a.x}px ${b.y - a.y}px` }], when + i * 0.05, 0.5, 'cubic-bezier(.4,.1,.3,1.12)');
    });
    s.sfx('whoosh', when, 0.7);
  }

  /** Beat 3, first half: the finger goes from the choice to the passage's own words. */
  function traceChoiceOne(s, c, v) {
    s.hide(v.q, c.one, 0.25);
    s.tag('1', { x: 92, y: 414, at: c.one, bg: '#9fd0ff', size: 56 });
    const row = s.spoken('The requests influenced the schedule.', c, c.c1, { x: 150, y: 410, size: 70, align: 'left', color: s.ink.teal });
    const words = ['after', 'visitors', 'requested'].map((w) => v.l2.find(w));
    s.mark(row.find('requests'), c.can);
    const hand = finger(s, ...under(s, row.find('requests')), c.can);
    hand.slide(...under(s, words[0]), c.yes, 0.5);
    s.sfx('whoosh', c.yes, 0.4);
    c.from(c.ph, 3).forEach((w, i) => {
      s.mark(words[i], w.t0);
      if (i) hand.slide(...under(s, words[i]), w.t0, 0.24);
    });
    hand.done(c.fol);
    s.m.point(row, c.can, 1);
    s.m.point(words[1], c.ph, 1.1);
    s.arrow(words[2], row.find('requests'), c.fol, { color: s.ink.yellow, curve: -0.16 });
    s.tag('follows', { x: 680, y: 296, at: c.word('follows'), bg: '#8fe6cf', size: 58 });
    s.m.act('nod', c.word('follows'), 0.7);
  }

  /** Beat 3, second half: the finger hunts the whole passage, finds nothing, and the choice goes. */
  function huntChoiceTwo(s, c, v) {
    const badge = s.tag('2', { x: 92, y: 534, at: c.two, bg: '#9fd0ff', size: 56 });
    const row = s.spoken('Attendance doubled.', c, c.c2, { x: 150, y: 530, size: 70, align: 'left', color: s.ink.teal });
    const y1 = spot(s, v.l1).bottom, y2 = spot(s, v.l2).bottom;
    s.mark(row.find('doubled'), c.where, { color: s.ink.pink, hold: c.out - c.where });
    s.hide(s.tag('nowhere', { x: 940, y: 296, at: c.nw, bg: '#ff8080', size: 58 }), c.new, 0.2);
    const hunt = finger(s, 110, y1, c.where);
    hunt.along([[110, y1, 0], [1110, y1, 0.42], [110, y2, 0.58], [1110, y2, 1]], c.where, Math.max(0.9, c.new - c.where - 0.05));
    hunt.done(c.new);
    s.sfx('whoosh', c.where, 0.4);
    s.m.act('shrug', c.nw, 0.9);
    s.m.mood('hmm', c.nw, 1.2);
    const stuck = s.tag('new assumption', { x: 905, y: 536, at: c.new, bg: '#ff8080', size: 54 });
    const cross = s.strike(row, c.out, { dim: 0.35 });
    const away = [{ translate: '0px 0px', rotate: '0deg', opacity: 1 }, { translate: '30px 200px', rotate: '8deg', opacity: 0 }];
    [row, stuck, badge].forEach((n) => s.anim(n, away, c.out + 0.22, 0.42, 'ease-in'));
    s.anim(cross, [{ opacity: 1 }, { opacity: 0 }], c.out + 0.22, 0.2);
    s.m.act('shake', c.out, 0.6);
    s.sfx('poof', c.out, 0.8);
  }

  /** Beat 7: what you know is shoved out of the passage, then bounces off it when it tries to get back in. */
  function bounceOffThePassage(s, c) {
    const card = passageCard(s, 70, 84, 1060, 312, c.leave, '<path class="lines" d="M120,146 H1080 M120,206 H1010 M120,266 H1060 M120,326 H880" fill="none" stroke="#f5f3ea" stroke-opacity=".3" stroke-width="10" stroke-linecap="round"/>');
    const lines = card.get('.lines');
    s.draw(lines, c.leave + 0.1, 0.6, { gain: 0.2 });
    s.anim(lines, [{ opacity: 1 }, { opacity: 0 }], c.ev, 0.3);
    const pal = s.critter(620, 322, 120, c.wyk, { hue: 300 });
    const sign = s.tag('What you already know', { x: 620, y: 174, at: c.wyk, bg: '#ff9ccf', size: 62 });
    s.m.look(sign, c.wyk, 1.2);
    const shoved = 'cubic-bezier(.5,0,.3,1.3)';
    s.move(sign, 0, 322, c.o, 0.55, shoved);
    s.move(pal, 0, 322, c.o, 0.55, shoved);
    s.hide(sign, c.out, 0.15);
    const outside = s.tag('Outside knowledge', { x: 620, y: 496, at: c.out, bg: '#ff9ccf', size: 62 });
    s.m.look(outside, c.out, 1);
    const bump = (y0) => [{ translate: `0px ${y0}px` }, { translate: `0px ${y0 - 92}px`, offset: 0.42, easing: 'ease-in' }, { translate: `0px ${y0 - 70}px`, offset: 0.54, easing: 'ease-out' }, { translate: `0px ${y0}px` }];
    s.anim(outside, bump(0), c.cant, 0.8, 'linear', 'none');
    s.anim(pal, bump(322), c.cant, 0.8, 'linear', 'none');
    s.anim(card, [{ translate: '0px 0px' }, { translate: '0px -12px', offset: 0.4 }, { translate: '0px 0px' }], c.cant + 0.34, 0.3, 'ease-out', 'none');
    s.sfx('boing', c.cant + 0.34, 0.7);
    s.m.act('stop', c.cant, 0.9);
    const ev = s.spoken('Evidence from the passage', c, c.ev, { x: 600, y: 186, size: 92, color: s.ink.yellow });
    s.under(ev, c.word('passage'), { color: s.ink.yellow });
    [outside, pal].forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0.7 }], c.ev, 0.3));
  }

  /** Beat 8: the finger visits every choice; the one with no fact shakes and falls. */
  function checkEveryChoice(s, c) {
    const xs = [240, 480, 720, 960];
    const cards = ['A', 'B', 'C', 'D'].map((letter, i) => s.tag(letter, { x: xs[i], y: 80, at: c.word('every') + i * 0.14, bg: '#9fd0ff', size: 84 }));
    const hand = finger(s, ...under(s, cards[0]), c.put);
    s.pulse(cards[0], c.put + 0.1);
    hand.slide(...under(s, cards[1]), c.word('specific'), 0.32);
    s.pulse(cards[1], c.word('specific') + 0.25);
    hand.slide(...under(s, cards[2]), c.no, 0.36);
    s.anim(cards[2], [{ rotate: '0deg' }, { rotate: '-9deg', offset: 0.25 }, { rotate: '8deg', offset: 0.6 }, { rotate: '0deg' }], c.no + 0.32, 0.4, 'linear', 'none');
    const cross = atFullSize(cards[2], () => s.strike(cards[2], c.el, { dim: 0.5 }));
    s.anim(cards[2], [{ translate: '0px 0px', rotate: '0deg', opacity: 0.5 }, { translate: '26px 200px', rotate: '20deg', opacity: 0 }], c.el + 0.3, 0.5, 'ease-in');
    s.anim(cross, [{ opacity: 1 }, { opacity: 0 }], c.el + 0.3, 0.2);
    s.sfx('poof', c.el + 0.3, 0.6);
    hand.slide(...under(s, cards[3]), c.el + 0.4, 0.36);
    hand.done(c.bye);
  }

  LessonStudio.define({
    id: 'evidence',
    teacher: 'tealy',
    title: 'Choose what the text supports',
    beats: [
      {
        say: `{hi}Tealy here. {some}Some answers just {sound}sound right. {prove}Today, we make them {pr}prove it.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1);
          s.wideCam(c.some - 0.3, 1.1);
          s.text('Choose what the text supports', { y: 110, size: 92, color: s.ink.yellow, at: c.some + 0.1, dur: 1 });
          s.text('Sounds right?', { y: 290, size: 100, color: s.ink.pink, at: c.sound, dur: 0.5 });
          const stamp = s.tag('Prove it!', { x: 614, y: 450, at: c.pr, bg: '#ffd66b', size: 96 });
          stamp.style.rotate = '-5deg';
          s.m.mood('sly', c.prove, 1.8);
          s.m.point(stamp, c.pr, 1);
        },
      },
      {
        page: 'The idea',
        say: `{inf}An inference has to follow from the {ev}evidence. {pl}Sounding plausible {isnt}isn't enough. {pt}If you can't point to it, {pick}you can't pick it.`,
        run(s, c) {
          const g = s.shape(COLUMN);
          s.draw(g.get('.ground'), c.inf, 0.5, { gain: 0.3 });
          s.tag('Inference', { x: 330, y: 145, at: c.word('inference'), bg: '#ffd66b', size: 64 });
          s.grow(g.get('.col'), c.ev, 0.7, { origin: '50% 100%' });
          s.sfx('whoosh', c.ev, 0.5);
          s.m.point({ x: 330, y: 380 }, c.ev, 1.1);
          const guess = s.tag('Sounds plausible', { x: 830, y: 145, at: c.pl, bg: '#ff9ccf', size: 60 });
          topple(s, guess, c.isnt, 289);
          dust(s, 830, 520, c.isnt + 0.78);
          s.m.mood('oops', c.isnt, 1.2);
          const said = [c.word("can't", 0), c.word('point'), c.word('to', 1), c.word('it', 0), c.word("can't", 1), c.word('pick'), c.word('it', 1)];
          const line = s.words(["Can't", 'point', 'to', 'it?', "Can't", 'pick', 'it.'], { x: 552, y: 568, size: 84, times: said });
          s.mark(line.find('point'), c.word('point'));
          s.mark(line.find('pick'), c.word('pick'), { color: s.ink.pink });
          s.m.point(line.find('point'), c.word("can't", 0), 1.5);
        },
      },
      {
        page: 'Watch me',
        say: `{a}A museum extended its Saturday hours {after}after visitors requested evening access. {now}Now, what does that support?`,
        run(s, c, v) {
          passageCard(s, 50, 78, 1128, 180, c.a);
          v.l1 = s.spoken('A museum extended its Saturday hours', c, c.a, { x: 76, y: 88, size: 74, align: 'left' });
          v.l2 = s.spoken('after visitors requested evening access.', c, c.after, { x: 76, y: 170, size: 74, align: 'left' });
          s.m.look(v.l1, c.a, 3.5);
          v.q = s.spoken('What does that support?', c, c.word('what'), { y: 350, size: 92, color: s.ink.teal });
          s.m.mood('hmm', c.now, 1.5);
        },
      },
      {
        say: `{one}Choice one: {c1}the requests influenced the schedule. {can}Can I point to it? {yes}Yes: {ph}after visitors requested. {fol}That follows. {two}Choice two: {c2}attendance doubled. {where}Where's that? {nw}Nowhere. {new}It's a new assumption. {out}Out.`,
        run(s, c, v) {
          traceChoiceOne(s, c, v);
          huntChoiceTwo(s, c, v);
        },
      },
      {
        page: 'Sort it',
        chipColor: '#9fd0ff',
        say: `So sort it {bins}into three bins. {st}Stated: {st2}the hours were extended. {f}Follows: {f2}the requests mattered. {p}Merely possible: {p2}attendance went up.`,
        run(s, c) {
          const places = [[50, 325, '#8fe6cf', false], [415, 325, '#ffd66b', false], [780, 355, '#ff9ccf', true]];
          const g = s.shape(places.map(([x, w, color, dashed], i) => binMarkup(i, x, w, color, dashed)).join(''));
          places.forEach((p, i) => {
            const part = g.get('.bin' + i);
            s.appear(part, c.bins + i * 0.22, p[3] ? 0.4 : 0.1);
            if (!p[3]) s.draw(part, c.bins + i * 0.22, 0.5, { gain: 0.35 });
          });
          const label = (text, x, at, bg) => s.tag(text, { x, y: 196, at, bg, size: 54 });
          s.m.point(label('Stated', 212, c.st, '#8fe6cf'), c.st, 1.2);
          sortInto(s, c, c.st2, 'the hours were extended', 212, c.f - 0.2);
          s.m.point(label('Follows', 577, c.f, '#ffd66b'), c.f, 1.2);
          sortInto(s, c, c.f2, 'the requests mattered', 577, c.p - 0.2);
          s.m.point(label('Merely possible', 957, c.p, '#ff9ccf'), c.p, 1.2);
          sortInto(s, c, c.p2, 'attendance went up', 957, c.end + 0.22);
          s.m.mood('proud', c.p2, 2);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        gap: 2,
        say: `Your turn. {a}A cafe added oat milk {after}after customers kept asking. {ask}Does that prove sales rose? Yes or no? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          passageCard(s, 50, 78, 980, 180, c.a);
          s.spoken('A cafe added oat milk', c, c.a, { x: 76, y: 88, size: 76, align: 'left' });
          v.cafe = s.spoken('after customers kept asking.', c, c.after, { x: 76, y: 170, size: 76, align: 'left' });
          v.ask = s.spoken('Does that prove sales rose?', c, c.ask, { y: 285, size: 92, color: s.ink.teal });
          s.m.point(v.ask, c.ask, 1.2);
          v.yes = s.tag('Yes', { x: 420, y: 402, at: c.word('yes'), bg: '#9fd0ff', size: 76 });
          v.no = s.tag('No', { x: 780, y: 402, at: c.word('no'), bg: '#9fd0ff', size: 76 });
          s.m.look(v.ask, c.try, 5);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}No! All it supports is that {asking}the asking mattered. {not}It says nothing about {sales}sales.`,
        run(s, c, v) {
          s.anim(v.no, [{ backgroundColor: '#9fd0ff' }, { backgroundColor: '#ffd66b' }], c.ans, 0.2);
          atFullSize(v.no, () => s.circle(v.no, c.ans, { color: s.ink.yellow, pad: 10 }));
          atFullSize(v.yes, () => s.strike(v.yes, c.ans, { dim: 0.4 }));
          s.stars(v.no, c.ans + 0.1, 9);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
          ['customers', 'kept', 'asking'].forEach((w, i) => s.mark(v.cafe.find(w), c.asking + i * 0.12));
          s.tag('the asking mattered', { x: 600, y: 534, at: c.word('mattered'), bg: '#8fe6cf', size: 60 });
          s.m.point(v.cafe.find('kept'), c.asking, 1);
          s.tag('nothing about sales', { x: 600, y: 630, at: c.word('nothing'), bg: '#ff9ccf', size: 60 });
          s.mark(v.ask.find('sales'), c.sales, { color: s.ink.pink });
          s.m.act('shake', c.sales, 0.6);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{leave}And leave {wyk}what you already know {o}outside. {out}Outside knowledge {cant}can't replace {ev}evidence from the passage.`,
        run(s, c) {
          bounceOffThePassage(s, c);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{each}For every choice, {put}put your finger on a specific {fact}fact. {no}No fact? {el}Eliminate it. {bye}Now hit Try this skill, and happy hunting!`,
        run(s, c) {
          checkEveryChoice(s, c);
          const rule = s.spoken('Put your finger on a specific fact', c, c.put, { x: 600, y: 350, size: 84, color: s.ink.yellow });
          s.mark(rule.find('fact'), c.fact);
          s.m.point(rule, c.put, 1.3);
          s.text('No fact?', { x: 340, y: 468, size: 100, at: c.no, dur: 0.4 });
          s.tag('Eliminate it', { x: 760, y: 480, at: c.el, bg: '#ff8080', size: 68 });
          s.m.mood('proud', c.el, 2.6);
          s.tag('Next: Try this skill', { x: 600, y: 612, at: c.word('try'), bg: '#ffd66b', size: 62 });
          s.m.act('wave', c.bye, 2.2);
          s.confetti(c.word('happy'));
        },
      },
    ],
  });
})();
