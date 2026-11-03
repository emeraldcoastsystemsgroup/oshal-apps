/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Separate plurals from ownership: a little apostrophe with eyes flies out of a bad sign, lands before or after the s as tiny monsters claim a desk and a lounge, hovers over two dogs and their bowl, and is lifted out of a sentence by the say-it-is test
 */
(function () {
  /** Where the page starts in the room, for turning a measured box into board coordinates. */
  const BOARD_X = 58, BOARD_Y = 44;

  /** Room left in a line of writing for the apostrophe to land in. */
  const SLOT = '<span style="display:inline-block;width:.36em">&nbsp;</span>';
  const SLOT_EM = 0.36;
  const MARK_EM = 0.48;
  const DARK = '#1d3a31';

  const DESK = `<rect x="0" y="52" width="300" height="24" rx="7" fill="#c9915a"/>
    <rect x="14" y="76" width="22" height="100" rx="4" fill="#a97243"/>
    <rect x="264" y="76" width="22" height="100" rx="4" fill="#a97243"/>
    <rect x="168" y="76" width="96" height="62" rx="4" fill="#b5804c"/>
    <rect x="198" y="100" width="36" height="10" rx="5" fill="#6b4520"/>
    <circle cx="62" cy="32" r="20" fill="#ff7a7e"/>
    <path d="M62,14 q3,-10 12,-12" fill="none" stroke="#8fe6cf" stroke-width="6" stroke-linecap="round"/>
    <rect x="180" y="34" width="86" height="18" rx="4" fill="#9fd0ff"/>
    <rect x="188" y="16" width="70" height="18" rx="4" fill="#ff9ccf"/>`;

  const COUCH = `<rect x="34" y="6" width="292" height="118" rx="30" fill="#5fc7ae"/>
    <rect x="0" y="62" width="62" height="104" rx="26" fill="#8fe6cf"/>
    <rect x="298" y="62" width="62" height="104" rx="26" fill="#8fe6cf"/>
    <rect x="52" y="104" width="256" height="62" rx="16" fill="#a8efdc"/>
    <path d="M137,108 V162 M223,108 V162" stroke="#5fc7ae" stroke-width="5"/>
    <rect x="44" y="166" width="20" height="22" rx="4" fill="#6b4520"/>
    <rect x="296" y="166" width="20" height="22" rx="4" fill="#6b4520"/>`;

  const BOWL = `<path d="M30,40 L270,40 L240,118 Q150,132 60,118 Z" fill="#ffd66b"/>
    <ellipse cx="150" cy="40" rx="120" ry="24" fill="#b88a25"/>
    <ellipse cx="150" cy="37" rx="98" ry="15" fill="#7a4f22"/>`;

  const BOOKS = `<rect x="10" y="96" width="220" height="38" rx="6" fill="#9fd0ff"/><rect x="24" y="110" width="192" height="6" fill="#f5f3ea"/>
    <rect x="34" y="56" width="180" height="40" rx="6" fill="#ff9ccf"/><rect x="48" y="72" width="150" height="6" fill="#f5f3ea"/>
    <rect x="18" y="16" width="190" height="40" rx="6" fill="#ffd66b"/><rect x="32" y="32" width="160" height="6" fill="#f5f3ea"/>`;

  const SIGN = `<rect x="5" y="5" width="930" height="260" rx="26" fill="#8a5a2e" stroke="#5d3a1a" stroke-width="10"/>
    <rect x="26" y="26" width="888" height="218" rx="16" fill="none" stroke="#b5804c" stroke-width="5"/>
    <circle cx="74" cy="146" r="30" fill="#ff7a7e"/><path d="M74,118 q3,-12 15,-14" fill="none" stroke="#8fe6cf" stroke-width="6" stroke-linecap="round"/>
    <circle cx="866" cy="146" r="30" fill="#ff7a7e"/><path d="M866,118 q3,-12 15,-14" fill="none" stroke="#8fe6cf" stroke-width="6" stroke-linecap="round"/>`;

  const CAT = `<path d="M222,290 q72,-6 58,-96" fill="none" stroke="#e8914a" stroke-width="24" stroke-linecap="round"/>
    <ellipse cx="150" cy="246" rx="92" ry="88" fill="#ffb066"/>
    <ellipse cx="150" cy="262" rx="50" ry="56" fill="#ffe0b8"/>
    <path d="M76,66 L66,0 L132,34 Z" fill="#ffb066"/><path d="M224,66 L234,0 L168,34 Z" fill="#ffb066"/>
    <path d="M86,50 L80,18 L114,36 Z" fill="#ff9ccf"/><path d="M214,50 L220,18 L186,36 Z" fill="#ff9ccf"/>
    <circle cx="150" cy="92" r="86" fill="#ffb066"/>
    <circle cx="116" cy="80" r="15" fill="#1a0a24"/><circle cx="184" cy="80" r="15" fill="#1a0a24"/>
    <circle cx="121" cy="74" r="5" fill="#fff"/><circle cx="189" cy="74" r="5" fill="#fff"/>
    <path d="M138,108 L162,108 L150,122 Z" fill="#ff7a90"/>
    <path d="M60,100 L24,92 M60,116 L24,122 M240,100 L276,92 M240,116 L276,122" stroke="#f5f3ea" stroke-width="5" stroke-linecap="round"/>
    <ellipse class="paw" cx="92" cy="270" rx="30" ry="26" fill="#ffc98a"/>
    <ellipse class="tongue" cx="150" cy="146" rx="14" ry="20" fill="#ff7a90"/>
    <path d="M150,122 V130 M130,130 Q150,146 170,130" fill="none" stroke="#1a0a24" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="208" cy="310" rx="32" ry="22" fill="#ffc98a"/>`;

  /** A sitting dog, front on. The tail is its own part so it can wag. */
  const dog = (fur, ear) => `<path class="tail" d="M150,196 q46,-8 40,-58" fill="none" stroke="${ear}" stroke-width="18" stroke-linecap="round"/>
    <ellipse cx="100" cy="176" rx="62" ry="60" fill="${fur}"/>
    <circle cx="100" cy="82" r="62" fill="${fur}"/>
    <ellipse cx="38" cy="80" rx="20" ry="46" fill="${ear}" transform="rotate(12 38 80)"/>
    <ellipse cx="162" cy="80" rx="20" ry="46" fill="${ear}" transform="rotate(-12 162 80)"/>
    <circle cx="76" cy="70" r="11" fill="#1a0a24"/><circle cx="124" cy="70" r="11" fill="#1a0a24"/>
    <circle cx="79" cy="66" r="4" fill="#fff"/><circle cx="127" cy="66" r="4" fill="#fff"/>
    <ellipse cx="100" cy="96" rx="14" ry="10" fill="#1a0a24"/>
    <ellipse cx="100" cy="126" rx="11" ry="14" fill="#ff7a90"/>
    <path d="M100,106 V116 M84,114 Q100,128 116,114" fill="none" stroke="#1a0a24" stroke-width="5" stroke-linecap="round"/>`;

  /** Free drawing at a scale, in its own coordinates. */
  function art(s, markup, x, y, k, w, h) {
    const g = s.shape(markup, { x, y, w: w * k, h: h * k });
    g.setAttribute('viewBox', `0 0 ${w} ${h}`);
    return g;
  }

  /** The star of this lesson: a fat apostrophe with eyes. Starts unseen at its resting place. */
  function star(s, x, y, h) {
    const w = (h * 100) / 140;
    const g = art(s, `<path d="M52,4 C80,4 97,26 97,52 C97,92 68,122 30,136 C21,139 15,129 23,124 C38,114 46,104 49,96 C24,94 5,75 5,50 C5,24 25,4 52,4 Z" fill="#ffd66b" stroke="#16352b" stroke-width="5"/>
      <circle cx="36" cy="44" r="14" fill="#fff"/><circle cx="66" cy="44" r="14" fill="#fff"/>
      <circle cx="39" cy="46" r="7.5" fill="#1a0a24"/><circle cx="69" cy="46" r="7.5" fill="#1a0a24"/>
      <path d="M40,68 Q52,80 64,68" fill="none" stroke="#1a0a24" stroke-width="5" stroke-linecap="round"/>`, x, y, h / 140, 100, 140);
    g.style.opacity = 0;
    g._at = { cx: x + w / 2, cy: y + h / 2, h };
    return g;
  }

  /** A star sitting in the empty slot of a line of writing, waiting to arrive. */
  function perched(s, slot, size) {
    const r = slot.getBoundingClientRect();
    const h = size * MARK_EM, w = (h * 100) / 140;
    return star(s, r.left - BOARD_X + (r.width - w) / 2, r.top - BOARD_Y + size * 0.02, h);
  }

  /** Bounce a star into view at a point, large or small, before it goes anywhere. */
  function popAt(s, g, t, at = g._at) {
    const k = at.h / g._at.h, x = at.cx - g._at.cx, y = at.cy - g._at.cy;
    s.anim(g, [
      { opacity: 1, translate: `${x}px ${y}px`, scale: '0 0' },
      { opacity: 1, offset: 0.7, translate: `${x}px ${y}px`, scale: `${k * 1.15} ${k * 1.15}` },
      { opacity: 1, translate: `${x}px ${y}px`, scale: `${k} ${k}` },
    ], t, 0.34, 'ease-out');
    s.sfx('pop', t, 0.7);
  }

  /** Fly a star from a point to its resting place in an arc, and land with a squash. */
  function land(s, g, t, from, { dur = 0.5, arc = 70 } = {}) {
    const k = from.h / g._at.h, x = from.cx - g._at.cx, y = from.cy - g._at.cy, half = (k + 1) / 2;
    s.anim(g, [
      { opacity: 1, translate: `${x}px ${y}px`, rotate: '0deg', scale: `${k} ${k}` },
      { opacity: 1, offset: 0.5, translate: `${x * 0.4}px ${y * 0.4 - arc}px`, rotate: '-16deg', scale: `${half} ${half}` },
      { opacity: 1, offset: 0.82, translate: '0px 0px', rotate: '0deg', scale: '1.3 0.72' },
      { opacity: 1, translate: '0px 0px', rotate: '0deg', scale: '1 1' },
    ], t, dur, 'ease-in-out');
    s.sfx('pop', t + dur * 0.8, 0.9);
  }

  /** Set a star free: a swoop, a spin, and off the top of the board. */
  function flyOff(s, g, t, { x0 = 0, y0 = 0, k0 = 1, dx = 360, dy = -640, dur = 1 } = {}) {
    s.anim(g, [
      { opacity: 1, translate: `${x0}px ${y0}px`, rotate: '0deg', scale: `${k0} ${k0}` },
      { opacity: 1, offset: 0.3, translate: `${x0 - dx * 0.2}px ${y0 + dy * 0.16}px`, rotate: '-40deg', scale: `${k0 * 1.3} ${k0 * 1.3}` },
      { opacity: 1, offset: 0.65, translate: `${x0 + dx * 0.45}px ${y0 + dy * 0.5}px`, rotate: '170deg', scale: `${k0 * 1.5} ${k0 * 1.5}` },
      { opacity: 0, translate: `${x0 + dx}px ${y0 + dy}px`, rotate: '380deg', scale: `${k0 * 1.5} ${k0 * 1.5}` },
    ], t, dur, 'ease-in');
    s.sfx('whoosh', t, 0.9);
  }

  /** A small jump to a new spot. */
  function hop(s, node, dx, dy, t, dur = 0.42, high = 46) {
    const x0 = node._tx || 0, y0 = node._ty || 0;
    node._tx = x0 + dx; node._ty = y0 + dy;
    s.anim(node, [
      { translate: `${x0}px ${y0}px` },
      { offset: 0.5, translate: `${x0 + dx / 2}px ${y0 + dy / 2 - high}px` },
      { translate: `${node._tx}px ${node._ty}px` },
    ], t, dur, 'ease-in-out');
    s.sfx('boing', t, 0.35);
  }

  /** An unseen box over two neighbours, so one circle can go around both. */
  function around(s, a, b) {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const left = Math.min(ra.left, rb.left), top = Math.min(ra.top, rb.top);
    return box(s, left - BOARD_X, top - BOARD_Y, Math.max(ra.right, rb.right) - left, Math.max(ra.bottom, rb.bottom) - top);
  }

  /** An unseen box at a spot on the board, for marks that go around a moment rather than a word. */
  function box(s, x, y, w, h) {
    const n = document.createElement('div');
    Object.assign(n.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    s.page._top.appendChild(n);
    return n;
  }

  /** A line whose pieces sit tight together, so single letters can arrive and move on their own. */
  const tight = (s, parts, opts) => s.words(parts, { gap: 0, ...opts });

  /** Fade finished writing back, so the next idea has the board. */
  const dim = (s, nodes, t) => nodes.forEach((n) => s.anim(n, [{ opacity: 1 }, { opacity: 0.32 }], t, 0.3));

  /** Rub a stroke out again. */
  const rubOut = (s, path, t) => s.anim(path, [{ opacity: 1 }, { opacity: 0 }], t, 0.22);

  /** Wag a dog's tail for a stretch of time. */
  function wag(s, svg, t, dur) {
    const tail = svg.get('.tail');
    tail.style.transformBox = 'view-box';
    tail.style.transformOrigin = '150px 196px';
    const frames = [];
    const steps = Math.round(dur / 0.16);
    for (let i = 0; i <= steps; i++) frames.push({ rotate: i % 2 ? '16deg' : '-16deg' });
    s.anim(tail, frames, t, dur, 'linear', 'none');
  }

  /** A cat with its tongue in. */
  function cat(s, x, y, k) {
    const g = art(s, CAT, x, y, k, 300, 340);
    const tongue = g.get('.tongue');
    tongue.style.transformBox = 'fill-box';
    tongue.style.transformOrigin = '50% 0%';
    tongue.style.scale = '1 0';
    return g;
  }

  /** The cat lifts its paw, licks it and puts it down again. */
  function lick(s, g, t) {
    s.anim(g.get('.paw'), [{ translate: '0px 0px' }, { translate: '34px -112px', offset: 0.22 }, { translate: '34px -112px', offset: 0.82 }, { translate: '0px 0px' }], t, 1.5, 'ease-in-out');
    s.anim(g.get('.tongue'), [{ scale: '1 0' }, { scale: '1 1', offset: 0.15 }, { scale: '1 0.3', offset: 0.3 }, { scale: '1 1', offset: 0.45 }, { scale: '1 0.3', offset: 0.6 }, { scale: '1 1', offset: 0.75 }, { scale: '1 0' }], t + 0.25, 1, 'linear');
  }

  /** The sign that opens the lesson: the apostrophe where it does not belong, then set free. */
  function badSign(s, c) {
    const free = c.word('free'), first = c.word('apostrophe'), named = c.word('mark');
    s.pop(art(s, SIGN, 144, 335, 1, 940, 270), c.ab - 0.05, { gain: 0.5 });
    const line = tight(s, ['Fresh&nbsp;', 'apple', SLOT, 's'], { size: 140, y: 390, at: c.ab, per: 0.1 });
    const mark = perched(s, line.w[2], 140);
    const home = { cx: 614, cy: 250, h: 150 };
    popAt(s, mark, first, home);
    s.m.look({ x: home.cx, y: home.cy }, first, 1);
    land(s, mark, c.ab + 0.15, home);
    s.m.point(mark, named, 1);
    rubOut(s, s.circle(mark, named, { color: s.ink.red, pad: 14 }), c.free);
    s.m.mood('oops', named, 1);
    s.pulse(mark, c.word('set'), { to: 1.3 });
    flyOff(s, mark, free);
    s.stars(line.w[2], free, 9);
    s.move(line.w[3], -line.w[2].getBoundingClientRect().width, 0, free + 0.2, 0.4);
    s.m.act('hop', free, 0.4);
    s.m.mood('proud', free, 1.6);
  }

  /** The apostrophe's two jobs, and the wrong job it gets kicked out of. */
  function twoJobs(s, c) {
    const own = c.word('ownership'), con = c.word('contraction');
    const home = star(s, 571, 78, 120);
    const big = { cx: 614, cy: 230, h: 240 };
    popAt(s, home, c.word('apostrophe'), big);
    const jobs = s.text('two jobs', { x: 614, y: 380, size: 124, color: s.ink.yellow, at: c.word('two'), dur: 0.35 });
    s.hide(jobs, c.own, 0.2);
    land(s, home, c.own, big, { dur: 0.4, arc: 10 });
    const tagA = s.tag('ownership', { x: 310, y: 92, at: own, bg: '#8fe6cf', size: 60 });
    const a = tight(s, ['the&nbsp;', 'cat', SLOT, 's', '&nbsp;toy'], { x: 310, y: 190, size: 110, at: own + 0.05, per: 0.07 });
    const markA = perched(s, a.w[2], 110);
    land(s, markA, own + 0.1, home._at);
    const tagB = s.tag('contraction', { x: 900, y: 92, at: con, bg: '#9fd0ff', size: 60 });
    const b = tight(s, ['it', SLOT, 's', '&nbsp;=&nbsp;', 'it&nbsp;is'], { x: 900, y: 190, size: 110, at: con + 0.05, per: 0.09 });
    const markB = perched(s, b.w[1], 110);
    land(s, markB, con + 0.1, home._at);
    s.m.point(a.w[2], own, 0.9);
    s.m.point(b.w[1], con, 0.9);
    s.tag('not for plain plurals', { x: 614, y: 362, at: c.word('not'), bg: '#ff8080', size: 60 });
    s.m.act('stop', c.word('not'), 0.8);
    dim(s, [tagA, a, markA, tagB, b, markB], c.two);
    const cats = [cat(s, 70, 480, 0.56), cat(s, 244, 480, 0.56)];
    cats[1].style.filter = 'hue-rotate(170deg)';
    cats.forEach((g, i) => s.pop(g, c.two + i * 0.12, { gain: 0.5 }));
    const p = tight(s, ['two&nbsp;', 'cat', SLOT, 's'], { x: 690, y: 490, size: 150, color: s.ink.red, times: [c.two, c.word('cats'), c.word('cats'), c.word('cats') + 0.15] });
    const markP = perched(s, p.w[2], 150);
    s.hide(home, c.two, 0.1);
    land(s, markP, c.two, home._at, { dur: 0.45 });
    s.m.point(p.w[2], c.two, 1);
    s.m.mood('oops', c.two, 1);
    rubOut(s, s.strike(markP, c.no, { dim: 1 }), c.no + 0.3);
    s.anim(markP, [{ opacity: 1, translate: '0px 0px', rotate: '0deg' }, { opacity: 0, translate: '40px 300px', rotate: '150deg' }], c.no + 0.2, 0.55, 'ease-in');
    s.sfx('boing', c.no + 0.2, 0.5);
    s.move(p.w[3], -p.w[2].getBoundingClientRect().width, 0, c.no + 0.45, 0.3);
    [p.w[0], p.w[1], p.w[3]].forEach((n) => s.tint(n, s.ink.yellow, c.no + 0.45));
    s.m.act('shake', c.no, 0.8);
  }

  /** The two dogs and their bowl, the two places the mark could go, and a mark deciding. */
  function dogsAndBowl(s, c, v) {
    const dogs = [art(s, dog('#d9a56d', '#8a5a2e'), 110, 100, 1, 200, 240), art(s, dog('#c9c4d6', '#6f6a86'), 310, 100, 1, 200, 240)];
    dogs.forEach((g, i) => {
      s.pop(g, c.dogs + i * 0.14, { gain: 0.5 });
      wag(s, g, c.dogs + 0.4, c.end + 5.2 - c.dogs);
      hop(s, g, 60, 0, c.word('share') + i * 0.08);
    });
    s.pop(art(s, BOWL, 620, 210, 1, 300, 130), c.bowl, { gain: 0.5 });
    const Q = `<span style="color:${s.ink.pink};font-family:Fredoka;font-weight:600">?</span>`;
    const line = tight(s, ['dog', Q, 's', Q, '&nbsp;bowl'], { x: 560, y: 480, size: 170, times: [c.dogs, c.ap, c.dogs + 0.1, c.ap, c.bowl] });
    s.sfx('chalk', c.dogs, 0.55, 0.3);
    const mark = perched(s, line.w[3], 170);
    const reach = line.w[1].getBoundingClientRect().left - line.w[3].getBoundingClientRect().left, mid = reach / 2, lift = 108;
    const spot = (x, offset) => ({ opacity: 1, offset, translate: `${x}px ${-lift}px`, scale: '1.5 1.5', rotate: x === mid ? '0deg' : x === 0 ? '10deg' : '-10deg', easing: 'ease-in-out' });
    s.anim(mark, [{ opacity: 1, translate: `${mid}px ${-lift - 150}px`, scale: '0 0', rotate: '0deg' }, spot(mid, 1)], c.ap, 0.4, 'cubic-bezier(.3,1.5,.5,1)');
    s.sfx('pop', c.ap, 0.7);
    const span = c.end + 5.2 - c.try - 0.1;
    s.anim(mark, [spot(mid, 0), spot(reach, 0.14), spot(reach, 0.26), spot(0, 0.42), spot(0, 0.54), spot(reach, 0.7), spot(reach, 0.82), spot(mid, 1)], c.try, span, 'linear');
    [0.14, 0.7].forEach((k) => s.pulse(line.w[1], c.try + span * k));
    s.pulse(line.w[3], c.try + span * 0.42);
    s.m.look(line.w[1], c.ask, 1.2);
    s.m.act('think', c.try + 0.2, 4.6);
    s.m.mood('hmm', c.try + 0.2, 4.6);
    s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
    v.dogs = { line, mark, mid, lift, list: dogs };
  }

  /**
   * The sentence for the test. Its plain layout is the final "its paw"; the s and paw start one
   * slot further along for the apostrophe, and make room for the i of "it is" when the test runs.
   */
  function testSentence(s, c, isAt, noAt) {
    const size = 124, y = 170;
    const widthOf = (html) => { const n = s.place(html, { size }); const w = n.getBoundingClientRect().width; n.remove(); return w; };
    const room = widthOf('&nbsp;i'), slot = SLOT_EM * size;
    const line = tight(s, ['The&nbsp;', 'cat&nbsp;', 'licked&nbsp;', 'it', 's', '&nbsp;paw'], { x: 570, y, size, at: c.test, per: 0.05 });
    const [, , , it, ess, paw] = line.w;
    const itBox = it.getBoundingClientRect(), sBox = ess.getBoundingClientRect(), pawEnd = paw.getBoundingClientRect().right - BOARD_X;
    const wide = box(s, itBox.left - BOARD_X, y, sBox.right - itBox.left + room, itBox.height);
    const small = s.text('i', { x: sBox.left - BOARD_X + widthOf('&nbsp;'), y, size, align: 'left', at: isAt + 0.1, dur: 0.12, color: DARK });
    s.tint(it, DARK, isAt + 0.1, 0.05);
    s.tint(ess, DARK, isAt + 0.1, 0.05);
    s.mark(wide, isAt, { color: s.ink.pink, hold: noAt - isAt });
    s.hide(small, noAt + 0.05, 0.15);
    s.hide(s.text('?', { x: pawEnd + room + 4, y, size, align: 'left', at: c.word('paw'), dur: 0.15, color: s.ink.pink }), noAt, 0.15);
    s.text('.', { x: pawEnd + 2, y, size, align: 'left', at: noAt + 0.4, dur: 0.1 });
    s.mark(it, noAt + 0.35, { color: s.ink.yellow });
    s.mark(ess, noAt + 0.38, { color: s.ink.yellow });
    s.read({ w: line.w.slice(0, 3) }, c.from(c.a, 3));
    s.read({ w: [paw] }, c.from(c.word('paw'), 1));
    [ess, paw].forEach((n) => { n._tx = slot; n.style.translate = `${slot}px 0px`; });
    const h = size * MARK_EM;
    const mark = star(s, itBox.right - BOARD_X + (slot - (h * 100) / 140) / 2, itBox.top - BOARD_Y + size * 0.02, h);
    s.show(mark, c.test + 0.2, 0.15);
    return { it, ess, paw, wide, room, slot, mark };
  }

  /** The say-it-is test: one sentence changes shape in place as the monster reads it. */
  function theTest(s, c) {
    const up = 112, grown = 1.8, isAt = c.word('is') + 0.12, noAt = c.word('no');
    const { it, ess, paw, wide, room, slot, mark } = testSentence(s, c, isAt, noAt);
    rubOut(s, s.circle(around(s, it, ess), c.test + 0.3, { color: s.ink.pink, pad: 10, dur: 0.35 }), isAt);
    s.m.point(it, c.say, 1);
    const sayIt = s.tag('say: it is', { x: 770, y: 340, at: c.say, bg: '#ff9ccf', size: 64 });
    s.anim(mark, [{ translate: '0px 0px', scale: '1 1' }, { translate: `0px ${-up}px`, scale: `${grown} ${grown}` }], isAt, 0.35, 'cubic-bezier(.3,1.5,.5,1)');
    [ess, paw].forEach((n) => s.move(n, room - slot, 0, isAt, 0.3));
    const kitty = cat(s, 110, 372, 0.97);
    s.pop(kitty, c.word('cat'), { gain: 0.5 });
    lick(s, kitty, c.word('licked'));
    s.m.mood('oops', c.word('paw'), 1.4);
    const nope = s.tag('Nope!', { x: 770, y: 460, at: c.nope, bg: '#ff8080', size: 90 });
    s.sfx('boing', c.nope, 0.6);
    s.m.act('shake', c.nope, 0.8);
    rubOut(s, s.strike(wide, c.nope, { dim: 1, width: 12 }), noAt);
    s.hide(sayIt, noAt, 0.15);
    s.hide(nope, noAt, 0.15);
    flyOff(s, mark, noAt, { y0: -up, k0: grown, dx: 340, dy: -240, dur: 0.8 });
    [ess, paw].forEach((n) => s.move(n, -room, 0, noAt + 0.05, 0.3));
    s.tag('no apostrophe', { x: 770, y: 400, at: c.word('apostrophe'), bg: '#ffd66b', size: 80 });
    s.stars(it, noAt + 0.4, 9);
    lick(s, kitty, c.word('apostrophe'));
    s.m.point(it, c.word('apostrophe'), 1);
    s.m.mood('proud', noAt, 2);
  }

  LessonStudio.define({
    id: 'possessives',
    teacher: 'bluebold',
    title: 'Separate plurals from ownership',
    beats: [
      {
        say: `{hi}Hey, Bluebold here! {ap}The apostrophe may be the most {ab}abused mark in English. {free}Today, we set it free.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.3);
          s.wideCam(c.ap - 0.3, 1.1);
          s.text('Separate plurals from ownership', { y: 60, size: 96, color: s.ink.yellow, at: c.ap + 0.3, dur: 1.1 });
          badSign(s, c);
        },
      },
      {
        page: 'The idea',
        say: `{job}An apostrophe does two jobs. {own}It shows ownership, {con}or it marks a contraction. {not}It does not make a plain plural. {two}Two cats. {no}No apostrophe.`,
        run: twoJobs,
      },
      {
        page: 'Watch me',
        say: `{ask}Ask one question first: {q}how many owners? {one}One teacher {owns}owns a desk. {take}Take teacher. {add}Add apostrophe, {es}s. {r}The teacher's desk.`,
        run(s, c) {
          const big = s.text('?', { x: 614, y: 150, size: 380, color: s.ink.pink, at: c.word('question'), dur: 0.01, quiet: true });
          s.pop(big, c.word('question'));
          s.hide(big, c.q, 0.15);
          s.spoken('How many owners?', c, c.q, { y: 76, size: 92, color: s.ink.yellow });
          s.pop(art(s, DESK, 540, 186, 1.2, 300, 180), c.word('desk'), { gain: 0.5 });
          const kid = s.critter(170, 290, 180, c.one, { hue: 40 });
          s.m.look({ x: 300, y: 290 }, c.one, 1.2);
          hop(s, kid, 290, 0, c.owns, 0.42, 18);
          s.tag('one owner', { x: 220, y: 250, at: c.owns + 0.3, bg: '#8fe6cf', size: 60 });
          const line = tight(s, ['The&nbsp;', 'teacher', SLOT, 's', '&nbsp;desk'], { x: 570, y: 425, size: 136, times: [c.r, c.take, c.add, c.es, c.word('desk', 1)] });
          s.sfx('chalk', c.take, 0.55, 0.4);
          const mark = perched(s, line.w[2], 136);
          land(s, mark, c.add, { cx: mark._at.cx, cy: mark._at.cy - 220, h: mark._at.h * 1.5 });
          s.m.point(mark, c.add, 1.2);
          s.mark(line.w[3], c.es, { color: s.ink.yellow, hold: c.r - c.es });
          s.circle(around(s, mark, line.w[3]), c.r, { pad: 8 });
          s.m.mood('happy', c.r, 1.6);
        },
      },
      {
        page: 'Watch me',
        say: `{sev}Several teachers {share}share a {lo}lounge. {take}Take teachers, {al}which already ends in {es}s, {just}and just add the {ap}apostrophe. {r}The teachers' lounge.`,
        run(s, c) {
          s.pop(art(s, COUCH, 545, 86, 1.2, 360, 190), c.lo, { gain: 0.5 });
          const kids = [0, 1, 2].map((i) => s.critter(110 + i * 124, 180, 130, c.sev + i * 0.14, { hue: [40, 210, 120][i] }));
          s.m.look({ x: 500, y: 180 }, c.sev, 1.6);
          kids.forEach((k, i) => hop(s, k, 540 - i * 6, -2, c.lo + 0.12 + i * 0.1));
          s.tag('several owners', { x: 280, y: 150, at: c.lo + 0.5, bg: '#8fe6cf', size: 60 });
          const take = c.word('teachers', 1);
          const line = tight(s, ['The&nbsp;', 'teacher', 's', SLOT, '&nbsp;lounge'], { x: 570, y: 350, size: 136, times: [c.r, take, take + 0.25, c.ap, c.word('lounge', 1)] });
          s.sfx('chalk', take, 0.55, 0.4);
          s.mark(line.w[2], c.es, { color: s.ink.pink, hold: c.r - c.es });
          s.tag('already ends in s', { x: 440, y: 540, at: c.word('ends'), bg: '#ff9ccf', size: 60 });
          const mark = perched(s, line.w[3], 136);
          land(s, mark, c.ap - 0.15, { cx: mark._at.cx, cy: mark._at.cy - 220, h: mark._at.h * 1.5 });
          s.m.point(mark, c.ap - 0.1, 1.2);
          s.circle(around(s, line.w[2], mark), c.r, { pad: 8 });
          s.m.mood('happy', c.r, 1.2);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}Two {dogs}dogs share one {bowl}bowl. {ask}Where does the {ap}apostrophe go? {try}Go.`,
        pause: 5.2,
        run: dogsAndBowl,
      },
      {
        gap: 0.1,
        say: `{ans}After the {es}s! {why}Dogs, apostrophe. {two}Two owners.`,
        run(s, c, v) {
          const { line, mark, mid, lift, list } = v.dogs;
          land(s, mark, c.ans, { cx: mark._at.cx + mid, cy: mark._at.cy - lift, h: mark._at.h * 1.5 }, { dur: 0.45, arc: 20 });
          s.hide(line.w[1], c.ans, 0.15);
          s.hide(line.w[3], c.ans, 0.15);
          s.move(line.w[0], line.w[1].getBoundingClientRect().width, 0, c.ans + 0.2, 0.3);
          s.stars(mark, c.ans + 0.3, 9);
          s.mark(line.w[2], c.es, { color: s.ink.yellow, hold: c.why - c.es });
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
          s.circle(around(s, line.w[2], mark), c.why, { pad: 12 });
          s.m.point(mark, c.why, 1);
          s.tag('two owners', { x: 760, y: 90, at: c.two, bg: '#8fe6cf', size: 64 });
          list.forEach((g, i) => hop(s, g, 0, 0, c.two + i * 0.12, 0.4, 40));
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{irr}Irregular plurals are different. {ch}Children doesn't {fin}end in s, {so}so it's children's books. {ap}Apostrophe s.`,
        run(s, c) {
          const both = c.word("children's");
          s.text('Irregular plurals', { y: 76, size: 92, color: s.ink.orange, at: c.irr, dur: 0.8 });
          [0, 1, 2, 3].forEach((i) => s.critter(120 + i * 118, 270, 118, c.ch + i * 0.1, { hue: [40, 120, 210, 300][i] }));
          s.pop(art(s, BOOKS, 650, 180, 1.2, 240, 140), c.word('books'), { gain: 0.5 });
          const line = tight(s, ['childre', 'n', SLOT, 's', '&nbsp;books'], { x: 500, y: 360, size: 150, times: [c.ch, c.ch + 0.2, c.ch, both + 0.2, c.word('books')] });
          s.sfx('chalk', c.ch, 0.55, 0.4);
          s.mark(line.w[1], c.fin, { color: s.ink.pink, hold: both - c.fin });
          s.tag('no s at the end', { x: 340, y: 555, at: c.fin + 0.1, bg: '#ff8080', size: 60 });
          const mark = perched(s, line.w[2], 150);
          land(s, mark, both - 0.1, { cx: mark._at.cx, cy: mark._at.cy - 220, h: mark._at.h * 1.5 });
          s.circle(around(s, mark, line.w[3]), c.ap, { pad: 8 });
          s.m.point(mark, c.ap, 1.1);
          s.m.mood('wow', c.so, 1);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{fam}And the famous one. {its}I T S shows {own}ownership. {it}I T apostrophe S means {is}it is, {has}or it has.`,
        run(s, c) {
          const plain = c.from(c.its, 3).map((w) => w.t0), tick = c.from(c.it, 4).map((w) => w.t0);
          const home = { cx: 614, cy: 200, h: 130 };
          const a = tight(s, ['i', 't', 's'], { x: 300, y: 110, size: 200, color: s.ink.teal, times: plain });
          const b = tight(s, ['i', 't', SLOT, 's'], { x: 900, y: 110, size: 200, color: s.ink.pink, times: tick });
          const mark = perched(s, b.w[2], 200);
          popAt(s, mark, c.fam, home);
          s.stars({ x: home.cx, y: home.cy }, c.fam + 0.1, 7);
          land(s, mark, tick[2] - 0.1, home);
          s.m.point(a, c.its, 1);
          s.tag('ownership', { x: 300, y: 350, at: c.own, bg: '#8fe6cf', size: 72 });
          s.m.point(mark, tick[2], 0.9);
          s.tag('it is', { x: 900, y: 350, at: c.is, bg: '#ff9ccf', size: 72 });
          s.tag('it has', { x: 900, y: 470, at: c.word('has'), bg: '#ff9ccf', size: 72 });
          s.m.mood('sly', c.its, 1.4);
        },
      },
      {
        page: 'The test',
        chipColor: '#9fd0ff',
        say: `{test}To test it, {say}say it is. {a}The cat licked it is paw? {nope}Nope. {no}So, no apostrophe.`,
        run: theTest,
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{how}How many owners? {then}Then place the {mk}mark. {bye}Now hit Try this skill, and go set some {ap}apostrophes free!`,
        run(s, c) {
          s.spoken('How many owners?', c, c.how, { y: 70, size: 100, color: s.ink.yellow });
          s.critter(180, 260, 130, c.word('owners'), { hue: 40 });
          [0, 1, 2].forEach((i) => s.critter(90 + i * 92, 412, 104, c.word('owners') + 0.15 + i * 0.1, { hue: [40, 210, 120][i] }));
          const one = tight(s, ['teacher', SLOT, 's'], { x: 380, y: 186, size: 140, align: 'left', times: [c.then, c.mk, c.mk] });
          const many = tight(s, ['teacher', 's', SLOT], { x: 380, y: 336, size: 140, align: 'left', times: [c.then, c.then + 0.2, c.mk] });
          [perched(s, one.w[1], 140), perched(s, many.w[2], 140)].forEach((mark) => {
            land(s, mark, c.mk - 0.1, { cx: mark._at.cx, cy: mark._at.cy - 200, h: mark._at.h * 1.4 });
          });
          s.m.mood('proud', c.then, 3);
          s.spoken('Then place the mark', c, c.then, { y: 500, size: 84 });
          s.tag('Next: Try this skill', { x: 480, y: 620, at: c.bye + 0.2, bg: '#ffd66b', size: 56 });
          s.m.act('wave', c.bye, 2.5);
          [150, 380, 610, 840, 1040].forEach((x, i) => {
            const m = star(s, x, 640, 96);
            flyOff(s, m, c.ap + i * 0.14, { dx: 140 - i * 70, dy: -860, dur: 1.2 });
          });
          s.confetti(c.ap + 0.2);
        },
      },
    ],
  });
})();
