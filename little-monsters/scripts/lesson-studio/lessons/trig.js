/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Use right-triangle ratios: SOH CAH TOA built letter by letter from the three ratios, a 3-4-5 triangle whose sides light as they are named, a small monster standing on the angle and looking across it, fractions filled by numbers flying off the triangle, the labels swapping when it walks to the other angle, and a leaning triangle squaring up to show where the ratios apply
 */
(function () {
  /** Each side keeps one color all lesson, so the color alone says which side it is. */
  const WHITE = '#f5f3ea', OPP = '#8fe6cf', ADJ = '#ff9ccf', HYP = '#ffd66b', ANGLE = '#ffb066', RED = '#ff8080';
  const LETTER = { O: OPP, A: ADJ, H: HYP };
  const SIDE = { Opposite: OPP, Adjacent: ADJ, Hypotenuse: HYP };

  /** The 3-4-5 triangle in board coordinates, 140 px to the unit: first angle (150,610), right angle (710,610), other angle (710,190). */
  const CONE_A = ['M150,610 L710,400 L710,400 Z', 'M150,610 L710,610 L710,190 Z'];
  const CONE_C = ['M710,190 L430,610 L430,610 Z', 'M710,190 L710,610 L150,610 Z'];
  const FLAT = 36.87;

  /** The working sits top right, where the pointing arm never crosses. */
  const CODE = { x: 930, y: 56, size: 110 };
  const NAME = { x: 790, y: 240, size: 104, align: 'left' };
  const TOP = { x: 1095, y: 172, size: 110 };
  const BOTTOM = { x: 1095, y: 306, size: 110 };
  const MIDDLE = { x: 1095, y: 300 };
  const BAR = `<path class="bar" d="M1035,298 H1155" fill="none" stroke="${WHITE}" stroke-width="9" stroke-linecap="round"/>`;

  /** Tags beside the sides. */
  const TAG_HYP = { x: 358, y: 312, bg: HYP, size: 52, align: 'right' };
  const TAG_OPP = { x: 735, y: 462, bg: OPP, size: 52, align: 'left' };
  const TAG_ADJ = { x: 472, y: 642, bg: ADJ, size: 52, align: 'left' };

  /** The small monster's feet stand on a corner. */
  const MINI = { hue: 9, light: 1.2 };
  const AT_A = { x: 118, y: 541 }, AT_C = { x: 710, y: 121 }, MINI_SIZE = 120;

  /** A triangle that starts out leaning, then tips until one corner is square. */
  const LEAN = ['M400,640 L840,640 L560,320 Z', 'M400,640 L840,640 L840,320 Z'];

  /** The triangle's parts. Sides stay hidden until drawn; everything else is switched on by the beats. */
  function triangle(s) {
    const side = (name, d) => `<path class="${name}" d="${d}" fill="none" stroke="${WHITE}" stroke-width="14" stroke-linecap="round"/>`;
    const g = s.shape(`
      <path class="coneA" d="${CONE_A[0]}" fill="${OPP}" fill-opacity=".22"/>
      <path class="coneC" d="${CONE_C[0]}" fill="${OPP}" fill-opacity=".22"/>
      <path class="wedgeA" d="M150,610 L260,610 A110,110 0 0 0 238,544 Z" fill="${ANGLE}"/>
      <path class="wedgeC" d="M710,190 L710,300 A110,110 0 0 1 622,256 Z" fill="${ANGLE}"/>
      ${side('adj', 'M150,610 H710')}${side('opp', 'M710,610 V190')}${side('hyp', 'M150,610 L710,190')}
      <path class="right" d="M654,603 V554 H703" fill="none" stroke="${HYP}" stroke-width="9"/>
      <path class="ghost" d="M150,610 L710,190" fill="none" stroke="${HYP}" stroke-width="16" stroke-linecap="round"/>
      <path class="faces" d="M508,341 L652,533 M615.6,516.4 L652,533 L646.3,493.4" fill="none" stroke="${HYP}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`);
    ['.coneA', '.coneC', '.wedgeA', '.wedgeC', '.ghost', '.faces', '.right'].forEach((k) => { g.get(k).style.opacity = 0; });
    return g;
  }

  /** The side lengths as chalk text, so marks and flights can use them. */
  function lengths(s, t3, t4, t5, quiet = false) {
    const at = (text, x, y, t) => s.text(text, { x, y, size: 92, at: t, dur: 0.2, quiet });
    return { n3: at('3', 750, 348, t3), n4: at('4', 430, 620, t4), n5: at('5', 400, 298, t5) };
  }

  const fade = (s, node, t, dur = 0.3) => s.anim(node, [{ opacity: 1 }, { opacity: 0 }], t, dur);
  const recolor = (s, node, from, to, t) => s.anim(node, [{ stroke: from }, { stroke: to }], t, 0.25, 'linear');
  const flash = (s, node, t) => s.anim(node, [{ strokeWidth: '14px' }, { strokeWidth: '26px', offset: 0.4 }, { strokeWidth: '14px' }], t, 0.55, 'ease-in-out', 'none');

  /** Grow a corner wedge out of its vertex. */
  function wedge(s, node, t, origin) {
    node.style.opacity = 1;
    s.pop(node, t, { gain: 0.6 });
    node.style.transformOrigin = origin;
  }

  /** A light cone that opens from the corner across to the side it lands on. */
  function look(s, node, frames, t, dur = 0.8) {
    s.appear(node, t, 0.12);
    s.anim(node, [{ d: `path("${frames[0]}")` }, { d: `path("${frames[1]}")` }], t, dur, 'cubic-bezier(.3,.7,.3,1)');
    s.sfx('whoosh', t, 0.4);
  }

  /** The small monster jumps on the spot. */
  function hop(s, node, t) {
    const x = node._tx || 0, y = node._ty || 0;
    s.anim(node, [{ translate: `${x}px ${y}px` }, { translate: `${x}px ${y - 34}px`, offset: 0.5 }, { translate: `${x}px ${y}px` }], t, 0.42, 'ease-in-out', 'none');
    s.sfx('boing', t, 0.35);
  }

  /** The small monster hops along a straight line, keeping its feet on it. */
  function walk(s, node, dx, dy, t, dur, hops = 5) {
    const frames = [];
    for (let i = 0; i <= hops * 8; i++) {
      const k = i / (hops * 8);
      frames.push({ translate: `${(dx * k).toFixed(1)}px ${(dy * k - Math.abs(Math.sin(k * hops * Math.PI)) * 30).toFixed(1)}px` });
    }
    s.anim(node, frames, t, dur, 'linear');
    node._tx = dx; node._ty = dy;
    for (let i = 0; i < hops; i++) s.sfx('boing', t + (i * dur) / hops, 0.22);
  }

  /** How far a node must shift to sit on another node, and the size it has there. */
  function offsetTo(node, from) {
    const a = node.getBoundingClientRect(), b = from.getBoundingClientRect();
    return { dx: b.left + b.width / 2 - a.left - a.width / 2, dy: b.top + b.height / 2 - a.top - a.height / 2, k: b.height / a.height };
  }

  /** A word that lifts off another board word and lands in its own place at its own size. */
  function landFrom(s, node, from, t, dur = 0.42) {
    const { dx, dy, k } = offsetTo(node, from);
    node.style.opacity = 0;
    s.anim(node, [{ opacity: 0 }, { opacity: 1 }], t, 0.06);
    s.anim(node, [{ translate: `${dx}px ${dy}px`, scale: k }, { translate: '0px 0px', scale: 1 }], t, dur, 'cubic-bezier(.45,.05,.2,1)');
    s.sfx('whoosh', t, 0.35);
    return node;
  }

  /** The same flight for a letter leaving a row of writing: it rises into the gap above the row, runs along it, then drops into place. */
  function arcFrom(s, node, from, t, lift, dur = 0.4) {
    const { dx, dy, k } = offsetTo(node, from);
    node.style.opacity = 0;
    s.anim(node, [{ opacity: 0 }, { opacity: 1 }], t, 0.05);
    s.anim(node, [
      { translate: `${dx}px ${dy}px`, scale: k },
      { translate: `${dx}px ${lift}px`, scale: 0.7, offset: 0.2 },
      { translate: `0px ${lift}px`, scale: 0.7, offset: 0.8 },
      { translate: '0px 0px', scale: 1 },
    ], t, dur, 'linear');
    s.sfx('swipe', t, 0.3);
    return node;
  }

  /** A fraction slot filled by something flying in. */
  const slot = (s, text, spot, color, from, t) => landFrom(s, s.place(text, { x: spot.x, y: spot.y, size: spot.size, color }), from, t);

  /** The box around several nodes, for circling a stacked fraction. */
  const around = (...nodes) => ({
    getBoundingClientRect() {
      const r = nodes.map((n) => n.getBoundingClientRect());
      const left = Math.min(...r.map((b) => b.left)), top = Math.min(...r.map((b) => b.top));
      return { left, top, width: Math.max(...r.map((b) => b.right)) - left, height: Math.max(...r.map((b) => b.bottom)) - top };
    },
  });

  /** A tag is built at scale 0, so its full size is read with the scale lifted. */
  function tagBox(tag) {
    tag.style.scale = '1';
    const r = tag.getBoundingClientRect();
    tag.style.scale = '0';
    return { getBoundingClientRect: () => r };
  }

  /** A word of the mnemonic with its letters in their side colors. */
  const colored = (word) => [...word].map((l) => `<span style="color:${LETTER[l] || WHITE}">${l}</span>`).join('');

  /** The mnemonic as separate letters, so each can be marked or flown. */
  function letters(s, word, spot, opts) {
    const n = s.words([...word], { ...spot, gap: 0.04, ...opts });
    n.w.forEach((w) => { w.style.color = LETTER[w.textContent] || WHITE; });
    return n;
  }

  const initial = (word) => `<span class="ini">${word[0]}</span>${word.slice(1)}`;

  /** One ratio row, every piece written on its spoken word. Returns the three letters the mnemonic takes. */
  function ratioRow(s, c, cue, i, [fn, top, bottom]) {
    const y = 120 + i * 190, t = c.from(cue, 5).map((w) => w.t0);
    const head = s.words([initial(fn), '='], { x: 50, y, size: 84, align: 'left', times: t.slice(0, 2) });
    const body = s.words([initial(top), '/', initial(bottom)], { x: 240, y, size: 84, align: 'left', times: t.slice(2) });
    body.w[0].style.color = SIDE[top];
    body.w[2].style.color = SIDE[bottom];
    return { y, body, said: t[2], lift: i ? -98 : -73, ini: [head.w[0], body.w[0], body.w[2]].map((w) => w.querySelector('.ini')) };
  }

  /** Spell one word of the mnemonic: each letter is marked in its row and flies to the end of that row. */
  function spell(s, c, cue, row, word) {
    const col = letters(s, word, { x: 1072, y: row.y - 6, size: 100 }, { hidden: true });
    c.from(cue, 3).forEach((w, k) => {
      s.mark(row.ini[k], w.t0, { color: col.w[k].style.color, pad: 5 });
      arcFrom(s, col.w[k], row.ini[k], w.t0, row.lift);
    });
    return col;
  }

  /** Two tags trade places along two sides of an arc, so they pass instead of colliding. */
  function swapTags(s, a, b, t, dur = 0.75) {
    const { dx, dy } = offsetTo(a, b);
    const len = Math.hypot(dx, dy), nx = (-dy / len) * 90, ny = (dx / len) * 90;
    s.anim(a, [{ translate: '0px 0px' }, { translate: `${dx / 2 + nx}px ${dy / 2 + ny}px`, offset: 0.5 }, { translate: `${dx}px ${dy}px` }], t, dur, 'ease-in-out');
    s.anim(b, [{ translate: '0px 0px' }, { translate: `${-dx / 2 - nx}px ${-dy / 2 - ny}px`, offset: 0.5 }, { translate: `${-dx}px ${-dy}px` }], t, dur, 'ease-in-out');
    a._tx = dx; a._ty = dy; b._tx = -dx; b._ty = -dy;
    s.sfx('whoosh', t, 0.6);
  }

  /** The worked example back on a fresh page, labelled from the first angle, with the small monster still standing on it. */
  function recap(s, t) {
    const g = triangle(s), adj = g.get('.adj'), opp = g.get('.opp'), hyp = g.get('.hyp'), coneA = g.get('.coneA'), wedgeA = g.get('.wedgeA');
    [[adj, ADJ], [opp, OPP], [hyp, HYP]].forEach(([n, color], i) => {
      n.setAttribute('stroke', color);
      s.draw(n, t + i * 0.1, 0.2);
    });
    s.appear(g.get('.right'), t, 0.2);
    wedge(s, wedgeA, t, '0% 100%');
    coneA.setAttribute('d', CONE_A[1]);
    s.appear(coneA, t, 0.2);
    return {
      g, adj, opp, hyp, coneA, wedgeA, ...lengths(s, t, t, t, true),
      hypTag: s.tag('Hypotenuse', { ...TAG_HYP, at: t }),
      oppTag: s.tag('Opposite', { ...TAG_OPP, at: t }),
      adjTag: s.tag('Adjacent', { ...TAG_ADJ, at: t }),
      mini: s.critter(AT_A.x, AT_A.y, MINI_SIZE, t, MINI),
    };
  }

  /** The caution as a picture: a leaning triangle draws, tips until one corner is square, and earns a tick. */
  function squaring(s, drawn, tips, squared) {
    const g = s.shape(`
      <path class="lean" d="${LEAN[0]}" fill="none" stroke="${RED}" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/>
      <path class="wedge" d="M400,640 L510,640 A110,110 0 0 0 488,574 Z" fill="${ANGLE}"/>
      <path class="box" d="M772,630 V572 H830" fill="none" stroke="${HYP}" stroke-width="13"/>
      <path class="tick" d="M650,510 L700,560 L790,450" fill="none" stroke="${OPP}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>`);
    const lean = g.get('.lean'), box = g.get('.box'), tick = g.get('.tick');
    [box, tick, g.get('.wedge')].forEach((n) => { n.style.opacity = 0; });
    s.draw(lean, drawn, 0.5);
    s.anim(lean, [{ d: `path("${LEAN[0]}")` }, { d: `path("${LEAN[1]}")` }], tips, 0.55, 'cubic-bezier(.3,1.2,.5,1)');
    recolor(s, lean, RED, OPP, tips);
    s.sfx('whoosh', tips, 0.5);
    s.appear(box, squared, 0.15);
    box.style.transformBox = 'fill-box';
    box.style.transformOrigin = '100% 100%';
    s.appear(tick, squared + 0.15, 0.05);
    s.draw(tick, squared + 0.15, 0.3);
    s.sfx('ding', squared + 0.15, 0.6);
    return g;
  }

  LessonStudio.define({
    id: 'trig',
    teacher: 'pinky',
    title: 'Use right-triangle ratios',
    facts: [['3 / 5', 0.6], ['3 / 4', 0.75], ['(3 * 3 + 4 * 4) ** 0.5', 5]],
    beats: [
      {
        say: `{hi}Pinky here! {three}Three ratios, {silly}and one silly word that holds them all: {soh}SOH CAH TOA.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.3);
          s.wideCam(c.three - 0.3, 1.1);
          const t = c.three + 0.3;
          const title = s.words('Use right-triangle ratios', { y: 110, size: 100, color: HYP, times: [t, t + 0.14, t + 0.66] });
          s.under(title.find('ratios'), c.word('one'), { color: WHITE });
          s.tag('one silly word', { x: 614, y: 268, at: c.word('silly'), bg: ADJ, size: 52 });
          s.m.mood('sly', c.silly, 1.6);
          const word = s.spoken(['SOH', 'CAH', 'TOA'].map(colored), c, c.soh, { y: 360, size: 180, gap: 0.3 });
          word.w.forEach((w, i) => s.pulse(w, c.word(['SOH', 'CAH', 'TOA'][i]) + 0.12));
          s.m.point(word.w[1], c.soh, 1.8);
          s.m.mood('happy', c.soh, 2.2);
        },
      },
      {
        page: 'The idea',
        say: `{s}Sine is opposite over hypotenuse. {c}Cosine is adjacent over hypotenuse. {t}Tangent is opposite over adjacent. {that}That's it. {a}S O H, {b}C A H, {d}T O A.`,
        run(s, c) {
          const rows = [ratioRow(s, c, c.s, 0, ['sin', 'Opposite', 'Hypotenuse']), ratioRow(s, c, c.c, 1, ['cos', 'Adjacent', 'Hypotenuse']), ratioRow(s, c, c.t, 2, ['tan', 'Opposite', 'Adjacent'])];
          rows.forEach((row) => s.m.point(row.body, row.said, 1.3));
          s.m.mood('happy', c.that, 1);
          const cols = [spell(s, c, c.a, rows[0], 'SOH'), spell(s, c, c.b, rows[1], 'CAH'), spell(s, c, c.d, rows[2], 'TOA')];
          s.m.look(cols[1], c.a, 2.4);
          s.m.mood('proud', c.d, 1.4);
        },
      },
      {
        page: 'Watch me',
        say: `{tri}Here's a right triangle. {legs}Legs three and four, {h}hypotenuse five. {hy}Start with the hypotenuse. {face}It faces the right angle, {long}and it's always the longest side.`,
        run(s, c, v) {
          const g = v.g = triangle(s);
          const adj = g.get('.adj'), opp = g.get('.opp'), hyp = g.get('.hyp'), right = g.get('.right');
          s.draw(adj, c.tri, 0.35);
          s.draw(opp, c.tri + 0.25, 0.3);
          s.draw(hyp, c.tri + 0.45, 0.35);
          s.appear(right, c.word('right', 0), 0.2);
          s.m.point({ x: 430, y: 430 }, c.tri, 1.2);
          Object.assign(v, lengths(s, c.word('three'), c.word('four'), c.word('five')));
          flash(s, opp, c.word('three'));
          flash(s, adj, c.word('four'));
          flash(s, hyp, c.h);
          const named = c.word('hypotenuse', 1);
          recolor(s, hyp, WHITE, HYP, named);
          flash(s, hyp, named);
          s.m.point(s.tag('Hypotenuse', { ...TAG_HYP, at: named }), named, 1.2);
          const faces = g.get('.faces');
          s.appear(faces, c.face, 0.05);
          s.draw(faces, c.face, 0.5);
          right.style.transformBox = 'fill-box';
          right.style.transformOrigin = '100% 100%';
          s.pulse(right, c.word('right', 1), { to: 1.7, dur: 0.6 });
          s.m.point({ x: 680, y: 580 }, c.face, 1);
          const longest = c.word('longest'), ghost = g.get('.ghost');
          fade(s, faces, longest, 0.2);
          s.appear(ghost, longest, 0.06);
          s.turn(ghost, FLAT, longest, 0.65, { origin: '150px 610px', easing: 'cubic-bezier(.3,1.25,.5,1)' });
          s.sfx('whoosh', longest, 0.5);
          v.longTag = s.tag('Longest side', { x: 924, y: 506, at: longest + 0.3, bg: HYP, size: 52 });
          s.m.mood('wow', longest, 1.2);
          s.m.look(v.longTag, longest, 1.2);
        },
      },
      {
        say: `{pick}Now pick an angle. {this}This one, right here. {stand}Stand on it, and look across. {see}The side you see, that's opposite: {three}three. {touch}The leg touching you is adjacent: {four}four.`,
        run(s, c, v) {
          const g = v.g, ghost = g.get('.ghost'), opp = g.get('.opp'), adj = g.get('.adj');
          s.turn(ghost, 0, c.pick, 0.4, { origin: '150px 610px', easing: 'ease-in-out' });
          fade(s, ghost, c.pick + 0.34, 0.1);
          s.hide(v.longTag, c.pick, 0.25);
          wedge(s, g.get('.wedgeA'), c.word('angle'), '0% 100%');
          s.m.point({ x: 205, y: 590 }, c.this, 1.2);
          s.pulse(g.get('.wedgeA'), c.this, { to: 1.3 });
          v.mini = s.critter(AT_A.x, AT_A.y, MINI_SIZE, c.stand, MINI);
          look(s, g.get('.coneA'), CONE_A, c.word('look'));
          s.m.mood('wow', c.word('look'), 1);
          const seen = c.word('see'), touching = c.word('touching');
          recolor(s, opp, WHITE, OPP, seen);
          flash(s, opp, seen);
          s.m.point({ x: 716, y: 430 }, c.see, 1.5);
          s.tag('Opposite', { ...TAG_OPP, at: c.word('opposite') });
          s.mark(v.n3, c.three, { color: OPP, hold: 1.3 });
          recolor(s, adj, WHITE, ADJ, touching);
          flash(s, adj, touching);
          hop(s, v.mini, touching);
          s.m.point({ x: 430, y: 612 }, c.touch, 1.5);
          v.adjTag = s.tag('Adjacent', { ...TAG_ADJ, at: c.word('adjacent') });
          s.mark(v.n4, c.four, { color: ADJ, hold: 0.9 });
        },
      },
      {
        say: `{so}So the sine of this angle {o}is opposite {h}over hypotenuse: {ans}three fifths.`,
        pause: 0.9,
        run(s, c, v) {
          const g = v.g, sine = c.word('sine'), said = c.word('opposite'), hyp = c.word('hypotenuse'), fifths = c.word('fifths');
          s.hide(v.adjTag, c.so, 0.25);
          recolor(s, g.get('.adj'), ADJ, WHITE, c.so);
          fade(s, g.get('.coneA'), c.so, 0.3);
          const code = letters(s, 'SOH', CODE, { times: [sine, sine + 0.08, sine + 0.16] });
          s.words(['sin', '='], { ...NAME, times: [sine, c.o] });
          s.m.look(code, sine, 1.2);
          s.pulse(g.get('.wedgeA'), c.word('this'), { to: 1.3 });
          s.mark(code.w[0], sine + 0.12, { color: WHITE, pad: 5, hold: c.ans - sine - 0.12 });
          s.mark(code.w[1], said, { color: OPP, pad: 5, hold: c.ans - said });
          const o = slot(s, 'O', TOP, OPP, code.w[1], said);
          flash(s, g.get('.opp'), said);
          const bar = s.shape(BAR).get('.bar');
          s.draw(bar, c.word('over'), 0.22);
          s.mark(code.w[2], hyp, { color: HYP, pad: 5, hold: c.ans - hyp });
          const h = slot(s, 'H', BOTTOM, HYP, code.w[2], hyp);
          flash(s, g.get('.hyp'), hyp);
          const three = slot(s, '3', TOP, OPP, v.n3, c.ans);
          fade(s, o, c.ans + 0.2, 0.15);
          const five = slot(s, '5', BOTTOM, HYP, v.n5, fifths);
          fade(s, h, fifths + 0.2, 0.15);
          s.m.point(three, c.ans, 1.2);
          s.circle(around(bar, three, five), fifths + 0.4, { color: HYP, pad: 12 });
          s.stars(MIDDLE, fifths + 0.4, 9);
          s.m.act('thumbs', fifths, 1.3);
          s.m.mood('proud', fifths, 1.8);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {same}Same triangle, same angle. {ask}What's the tangent? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const g = v.g = triangle(s), shown = c.word('triangle'), angle = c.word('angle'), tangent = c.word('tangent');
          s.draw(g.get('.adj'), c.same, 0.25);
          s.draw(g.get('.opp'), c.same + 0.15, 0.25);
          s.draw(g.get('.hyp'), c.same + 0.3, 0.25);
          s.appear(g.get('.right'), shown, 0.2);
          Object.assign(v, lengths(s, shown, shown, shown, true));
          wedge(s, g.get('.wedgeA'), angle, '0% 100%');
          v.mini = s.critter(AT_A.x, AT_A.y, MINI_SIZE, angle, MINI);
          look(s, g.get('.coneA'), CONE_A, angle, 0.6);
          s.m.look(g.get('.hyp'), c.same, 1.6);
          s.words(['tan', '='], { ...NAME, times: [tangent, tangent + 0.2] });
          v.q = s.text('?', { x: TOP.x, y: 226, size: 140, color: HYP, at: tangent + 0.3, dur: 0.2 });
          s.m.point(v.q, tangent, 1);
          s.pulse(v.q, c.try, { to: 1.3 });
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Three fourths! {why}Opposite over adjacent.`,
        run(s, c, v) {
          const g = v.g, fourths = c.word('fourths'), said = c.word('opposite'), adjacent = c.word('adjacent');
          s.hide(v.q, c.ans, 0.12);
          const bar = s.shape(BAR).get('.bar');
          s.draw(bar, c.ans, 0.2);
          const three = slot(s, '3', TOP, OPP, v.n3, c.ans);
          const four = slot(s, '4', BOTTOM, ADJ, v.n4, fourths);
          s.circle(around(bar, three, four), fourths + 0.35, { color: HYP, pad: 12 });
          s.stars(MIDDLE, fourths + 0.35, 9);
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2);
          hop(s, v.mini, c.ans);
          const code = letters(s, 'TOA', CODE, { times: [said, said + 0.08, said + 0.16] });
          recolor(s, g.get('.opp'), WHITE, OPP, said);
          flash(s, g.get('.opp'), said);
          s.mark(code.w[1], said + 0.1, { color: OPP, pad: 5 });
          s.tag('Opposite', { ...TAG_OPP, at: said });
          recolor(s, g.get('.adj'), WHITE, ADJ, adjacent);
          flash(s, g.get('.adj'), adjacent);
          s.mark(code.w[2], adjacent, { color: ADJ, pad: 5 });
          s.tag('Adjacent', { ...TAG_ADJ, at: adjacent });
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{sw}Now switch to the other angle. {labels}Watch the labels swap. {four}The four is now opposite. {three}The three is adjacent. {hyp}The hypotenuse never moves. {always}So always label from the angle they named.`,
        run(s, c) {
          const r = recap(s, c.sw), other = c.word('other'), swap = c.word('swap'), wedgeC = r.g.get('.wedgeC');
          fade(s, r.coneA, other, 0.25);
          fade(s, r.wedgeA, other, 0.25);
          walk(s, r.mini, AT_C.x - AT_A.x, AT_C.y - AT_A.y, other, c.labels - other);
          wedge(s, wedgeC, other, '100% 0%');
          s.m.point({ x: 680, y: 240 }, other, 1.2);
          look(s, r.g.get('.coneC'), CONE_C, c.labels);
          swapTags(s, r.oppTag, r.adjTag, swap);
          recolor(s, r.opp, OPP, ADJ, swap);
          recolor(s, r.adj, ADJ, OPP, swap);
          s.m.mood('wow', swap, 1.2);
          s.mark(r.n4, c.word('four'), { color: OPP, hold: 1.1 });
          s.pulse(r.oppTag, c.word('opposite'));
          s.m.point(r.oppTag, c.four, 1.3);
          s.mark(r.n3, c.word('three'), { color: ADJ, hold: 0.9 });
          s.pulse(r.adjTag, c.word('adjacent'));
          s.m.point(r.adjTag, c.three, 1.1);
          flash(s, r.hyp, c.word('hypotenuse'));
          const ring = s.circle(tagBox(r.hypTag), c.word('hypotenuse'), { color: HYP, pad: 10 });
          fade(s, ring, c.always, 0.3);
          s.m.act('shake', c.word('never'), 0.7);
          s.m.mood('sly', c.hyp, 1.6);
          const rule = s.spoken(['Label', 'from', 'the', 'angle', 'they', 'named'], c, c.word('label'), { x: 800, y: 84, size: 80, wrap: 380, color: HYP });
          s.mark(rule.find('named'), c.word('named'), { color: ANGLE });
          s.pulse(wedgeC, c.word('named'), { to: 1.3 });
          s.m.point(rule, c.word('label'), 1.6);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{r}These ratios work directly on right triangles. {a}So find the right angle. {b}Label from the named angle. {d}Then SOH CAH TOA. {bye}Now hit Try this skill!`,
        run(s, c) {
          const rightWord = c.word('right', 0), triWord = c.word('triangles');
          const line = s.spoken('These ratios work directly on right triangles', c, c.r, { x: 614, y: 84, size: 92, wrap: 1000, align: 'center' });
          s.mark(line.find('right'), rightWord, { color: OPP, hold: c.a - rightWord });
          s.mark(line.find('triangles'), triWord, { color: OPP, hold: c.a - triWord });
          const g = squaring(s, c.word('work'), rightWord, triWord);
          s.m.point(g.get('.lean'), rightWord, 1.3);
          s.m.mood('happy', triWord, 1.4);
          s.hide(line, c.a, 0.15);
          fade(s, g.get('.tick'), c.a, 0.2);
          s.move(g, 426, -251, c.a, 0.6);
          s.anim(g, [{ scale: 1 }, { scale: 0.55 }], c.a, 0.6, 'cubic-bezier(.45,.05,.2,1)');
          const step = { x: 60, size: 88, align: 'left' };
          const one = s.spoken(['1.', 'Find', 'the', 'right', 'angle'], c, c.a, { ...step, y: 130 });
          s.mark(one.find('right'), c.word('right', 1), { color: HYP, hold: 1.1 });
          s.pulse(g.get('.box'), c.word('angle', 0), { to: 1.5, dur: 0.6 });
          s.m.point({ x: 1142, y: 250 }, c.a, 1.2);
          const two = s.spoken(['2. Label', 'from', 'the', 'named', 'angle'], c, c.b, { ...step, y: 275, color: OPP });
          s.mark(two.find('named'), c.word('named'), { color: ANGLE, hold: 1 });
          s.appear(g.get('.wedge'), c.word('named'), 0.2);
          const three = s.spoken(['3.', 'SOH', 'CAH', 'TOA'].map((w, i) => (i ? colored(w) : w)), c, c.d, { ...step, y: 420 });
          three.w.slice(1).forEach((w, i) => s.pulse(w, c.word(['SOH', 'CAH', 'TOA'][i]) + 0.1));
          s.m.mood('proud', c.d, 2.8);
          s.tag('Next: Try this skill', { x: 614, y: 572, at: c.bye + 0.2, bg: HYP, size: 52 });
          s.m.act('wave', c.bye, 2);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
