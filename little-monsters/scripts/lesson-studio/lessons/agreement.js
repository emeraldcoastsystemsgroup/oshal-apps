/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Find the real subject: a disguise flies off the title, the phrase and the pencils leave the box together while the sentence closes up around its true subject, a seesaw levels only when the verb matches the subject in number, and a crossed-out bag has to come back in the two-subject exception
 */
(function () {
  const OUTLINE = '#4a2c14';
  const SLIDE = 'cubic-bezier(.45,.05,.2,1)';
  const PENS = ['#ffd66b', '#ff9ccf', '#8fe6cf', '#9fd0ff', '#ffb066'];

  /** One pencil, tip up. The outer group is what moves; the inner one holds its lean. */
  function pencil(x, top, len, lean, color) {
    const half = 17, tip = 40;
    return `<g class="pen"><g transform="rotate(${lean} ${x} ${top + len})">
      <rect x="${x - half}" y="${top + tip}" width="${half * 2}" height="${len - tip}" fill="${color}" stroke="${OUTLINE}" stroke-width="4"/>
      <path d="M${x - half},${top + tip} L${x},${top} L${x + half},${top + tip} Z" fill="#f4d9b0" stroke="${OUTLINE}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M${x - 6},${top + 14} L${x},${top} L${x + 6},${top + 14} Z" fill="#2c2233"/>
    </g></g>`;
  }

  /** An open cardboard box. Whatever is in `inside` stands between its back and its front. */
  function cardboard(x, y, w, h, inside = '') {
    const line = `stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"`;
    return `<g class="crate">
      <path d="M${x},${y} L${x + 30},${y - 34} H${x + w - 30} L${x + w},${y} Z" fill="#7a5226" ${line}/>
      <path d="M${x},${y} L${x + 30},${y - 34} L${x - 40},${y - 52} L${x - 66},${y - 14} Z" fill="#c48c4b" ${line}/>
      <path d="M${x + w},${y} L${x + w - 30},${y - 34} L${x + w + 40},${y - 52} L${x + w + 66},${y - 14} Z" fill="#c48c4b" ${line}/>
      ${inside}
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#dba963" ${line}/>
      <rect x="${x + w / 2 - 26}" y="${y + 3}" width="52" height="40" fill="#f2cf94"/>
    </g>`;
  }

  /** A closed carton for the seesaw. */
  function carton(cls, x, y, w, h) {
    return `<g class="${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#dba963" stroke="${OUTLINE}" stroke-width="5"/>
      <rect x="${x + w / 2 - 18}" y="${y + 3}" width="36" height="${h - 6}" fill="#f2cf94"/></g>`;
  }

  function deskArt(x0, x1, y) {
    return `<path class="deskLegs" d="M${x0 + 46},${y + 10} V${y + 72} M${x1 - 46},${y + 10} V${y + 72}" fill="none" stroke="#a97243" stroke-width="18" stroke-linecap="round"/>
      <path class="deskTop" d="M${x0},${y} H${x1}" fill="none" stroke="#c9915a" stroke-width="22" stroke-linecap="round"/>`;
  }

  function boxOfPencils() {
    const pens = PENS.map((color, i) => pencil(450 + (i - 2) * 50, 372 + Math.abs(i - 2) * 8, 156, (i - 2) * 7, color)).join('');
    return deskArt(190, 710, 652) + cardboard(300, 480, 300, 160, pens);
  }

  /** The seesaw: one rigid plank, so boxes and verb tilt with it. */
  function seesaw(ink) {
    const word = (text) => `<text class="${text}" x="600" y="490" font-size="136" text-anchor="middle" font-family="Chalk" fill="${ink.pink}">${text}</text>`;
    return `<path class="ground" d="M40,640 H1100" fill="none" stroke="#f5f3ea" stroke-width="7" stroke-linecap="round"/>
      <path class="post" d="M410,526 L326,640 H494 Z" fill="#c9915a" stroke="#6f4119" stroke-width="5" stroke-linejoin="round"/>
      <g class="plank">
        <rect x="60" y="502" width="700" height="28" rx="14" fill="#f5f3ea"/>
        ${carton('boxA', 80, 398, 120, 104)}${carton('boxB', 212, 398, 120, 104)}
        ${word('are')}${word('is')}
      </g>`;
  }

  function pencilBundle() {
    return PENS.map((color, i) => pencil(812 + i * 36, 396 + (i % 2) * 22, 244 - (i % 2) * 22, (i - 2) * 1.5, color)).join('');
  }

  /** A paper list of chores. Its rows are separate so they can leave the paper. */
  function choreList() {
    const rows = ['dishes', 'laundry', 'trash', 'sweep'].map((text, i) => {
      const y = 402 + i * 76;
      return `<g class="row"><rect x="410" y="${y - 40}" width="40" height="40" rx="6" fill="none" stroke="#2c2233" stroke-width="5"/>
        <text x="470" y="${y}" font-size="66" font-family="Chalk" fill="#2c2233">${text}</text></g>`;
    }).join('');
    return `<rect class="paper" x="370" y="340" width="370" height="350" rx="10" fill="#fdf6e3" stroke="#8a7a55" stroke-width="5"/>${rows}`;
  }

  function bagArt(x, y, w, h) {
    return `<g class="bag">
      <path d="M${x + w * 0.28},${y + 4} C${x + w * 0.28},${y - h * 0.46} ${x + w * 0.72},${y - h * 0.46} ${x + w * 0.72},${y + 4}" fill="none" stroke="#2f5d8a" stroke-width="13" stroke-linecap="round"/>
      <path d="M${x},${y} H${x + w} L${x + w + 16},${y + h} H${x - 16} Z" fill="#7fb8f0" stroke="#2f5d8a" stroke-width="5" stroke-linejoin="round"/>
      <rect x="${x + w * 0.22}" y="${y + h * 0.34}" width="${w * 0.56}" height="${h * 0.42}" rx="10" fill="#a9d2f7" stroke="#2f5d8a" stroke-width="4"/>
    </g>`;
  }

  function hatArt() {
    return `<g class="hat">
      <path d="M130,100 Q134,14 230,18 Q326,14 330,100 Z" fill="#3c3350" stroke="#f5f3ea" stroke-width="6" stroke-linejoin="round"/>
      <path d="M133,76 H327 V100 H133 Z" fill="#ff5a5f"/>
      <path d="M58,106 Q230,74 402,106 Q230,134 58,106 Z" fill="#3c3350" stroke="#f5f3ea" stroke-width="6" stroke-linejoin="round"/>
    </g>`;
  }

  /** The disguise a sentence wears: hat, mask with shifty eyes, moustache, in a 460 by 300 box. */
  function disguise() {
    return `${hatArt()}<g class="mask">
        <path d="M72,146 Q230,118 388,146 Q408,216 322,226 Q262,232 230,196 Q198,232 138,226 Q52,216 72,146 Z" fill="#7a5ce0" stroke="#f5f3ea" stroke-width="6" stroke-linejoin="round"/>
        <ellipse cx="150" cy="176" rx="44" ry="28" fill="#fff"/><ellipse cx="310" cy="176" rx="44" ry="28" fill="#fff"/>
        <g class="eyes"><circle cx="150" cy="178" r="17" fill="#1a0a24"/><circle cx="310" cy="178" r="17" fill="#1a0a24"/></g>
      </g>
      <path class="stache" d="M230,250 Q190,226 148,258 Q190,278 230,262 Q270,278 312,258 Q270,226 230,250 Z" fill="#2c1838" stroke="#f5f3ea" stroke-width="5" stroke-linejoin="round"/>`;
  }

  /** A listening ear with sound waves dropping into it from the word above. */
  function earArt(x, y) {
    const wave = 'fill="none" stroke="#f5f3ea" stroke-width="7" stroke-linecap="round"';
    return `<path class="wave" d="M${x + 4},${y} Q${x + 46},${y + 16} ${x + 88},${y}" ${wave}/>
      <path class="wave" d="M${x + 18},${y + 20} Q${x + 46},${y + 32} ${x + 74},${y + 20}" ${wave}/>
      <g class="lobe"><g transform="translate(${x + 4} ${y + 40}) scale(.84)">
        <path d="M48,2 C84,0 104,30 100,62 C97,90 74,98 66,122 C60,144 34,150 26,128 C20,112 10,96 6,66 C2,30 18,4 48,2 Z" fill="#f7c5a8" stroke="#6b3a2a" stroke-width="6" stroke-linejoin="round"/>
        <path d="M30,62 C28,36 72,30 74,62 C76,84 54,88 50,108" fill="none" stroke="#c47d5e" stroke-width="9" stroke-linecap="round"/>
      </g></g>`;
  }

  /** A word's box in board coordinates, measured while building, before anything has moved. */
  function boxIn(s, node) {
    const r = node.getBoundingClientRect(), o = s.page.getBoundingClientRect();
    return { left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top, cx: (r.left + r.right) / 2 - o.left, cy: (r.top + r.bottom) / 2 - o.top };
  }

  /** The point just over a word, for arrows that arc above the words between. */
  function over(s, node, lift = 10) {
    const b = boxIn(s, node);
    return { x: b.cx, y: b.top + lift };
  }

  /** Something s.circle can ring: the area around two neighboring words. */
  const around = (a, b) => ({
    getBoundingClientRect() {
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      const left = Math.min(x.left, y.left), top = Math.min(x.top, y.top);
      return { left, top, width: Math.max(x.right, y.right) - left, height: Math.max(x.bottom, y.bottom) - top };
    },
  });

  /** Something s.circle can ring: a tag still waiting to pop has no measured size of its own. */
  const fullSize = (n) => ({
    getBoundingClientRect() {
      const r = n.getBoundingClientRect();
      return { left: r.left + r.width / 2 - n.offsetWidth / 2, top: r.top + r.height / 2 - n.offsetHeight / 2, width: n.offsetWidth, height: n.offsetHeight };
    },
  });

  /** Send a piece flying off the board, tumbling and fading. Works on words, strokes and drawings. */
  function flyOff(s, node, t, { dx = 180, dy = -620, turn = 50, dur = 0.7, from = 1 } = {}) {
    node.style.transformBox = 'fill-box';
    node.style.transformOrigin = '50% 50%';
    s.anim(node, [
      { translate: '0px 0px', rotate: '0deg', opacity: from },
      { translate: `${dx * 0.75}px ${dy * 0.75}px`, rotate: `${turn * 0.75}deg`, opacity: from, offset: 0.7 },
      { translate: `${dx}px ${dy}px`, rotate: `${turn}deg`, opacity: 0 },
    ], t, dur, 'cubic-bezier(.4,0,.7,.7)');
  }

  /** A word or stroke that is finished: it lifts a little and fades where it stands. */
  function vanish(s, node, t, { from = 1, dur = 0.3 } = {}) {
    node.style.transformBox = 'fill-box';
    node.style.transformOrigin = '50% 50%';
    s.anim(node, [{ translate: '0px 0px', scale: 1, opacity: from }, { translate: '0px -26px', scale: 1.1, opacity: 0 }], t, dur, 'ease-out');
  }

  /** A puff of chalk dust where something just vanished. */
  function puff(s, x, y, t, spread = 110) {
    const dust = s.shape(Array.from({ length: 10 }, (_, i) => `<circle cx="${x}" cy="${y}" r="${16 + (i % 3) * 8}" fill="#f5f3ea"/>`).join(''));
    dust.querySelectorAll('circle').forEach((dot, i) => {
      const a = (i / 10) * Math.PI * 2 + 0.4, r = spread * (0.55 + (i % 4) * 0.2);
      dot.style.opacity = 0;
      dot.style.transformBox = 'fill-box';
      dot.style.transformOrigin = '50% 50%';
      s.anim(dot, [{ opacity: 0.7, translate: '0px 0px', scale: 0.4 }, { opacity: 0, translate: `${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r * 0.6).toFixed(1)}px`, scale: 1.5 }], t, 0.6, 'ease-out');
    });
    s.sfx('poof', t, 0.9);
  }

  /**
   * Slide written words onto their places in a hidden line, then swap that line in.
   * Marks measure a word where it was built, so anything marked later has to land on the new line.
   * With along set, the words travel their own row first and rise at the end, so they cross nothing.
   */
  function settle(s, words, places, t, dur, { along = false } = {}) {
    words.forEach((word, i) => {
      const a = word.getBoundingClientRect(), b = places[i].getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      const frames = along
        ? [{ translate: '0px 0px' }, { translate: `${dx}px 0px`, offset: 0.68 }, { translate: `${dx}px ${dy}px` }]
        : [{ translate: '0px 0px' }, { translate: `${dx}px ${dy}px` }];
      s.anim(word, frames, t, dur, along ? 'ease-in-out' : SLIDE);
      s.hide(word, t + dur, 0.02);
      s.show(places[i], t + dur, 0.02);
    });
    s.sfx('whoosh', t, 0.6);
  }

  /** Slide words sideways together, with one sound for all of them. */
  function slide(s, words, dx, t, dur = 0.5) {
    words.forEach((word) => s.anim(word, [{ translate: '0px 0px' }, { translate: `${dx}px 0px` }], t, dur, SLIDE));
    s.sfx('whoosh', t, 0.5);
  }

  /** Drop a part onto the seesaw from above. */
  function land(s, node, t, height = 300) {
    node.style.opacity = 0;
    node.style.translate = `0px ${-height}px`;
    s.anim(node, [{ opacity: 1, translate: `0px ${-height}px` }, { opacity: 1, translate: '0px 0px' }], t, 0.3, 'cubic-bezier(.55,0,.9,.55)');
    s.sfx('pop', t + 0.28, 0.8);
  }

  /** Push a pencil up out of its box. */
  function rise(s, node, t, depth) {
    node.style.transformBox = 'fill-box';
    node.style.transformOrigin = '50% 50%';
    node.style.translate = `0px ${depth}px`;
    s.anim(node, [{ translate: `0px ${depth}px` }, { translate: '0px 0px' }], t, 0.38, 'cubic-bezier(.3,1.35,.5,1)');
  }

  /** Take a marker highlight off a word again. */
  function unmark(s, word, swipe, t, color) {
    s.hide(swipe, t, 0.25);
    s.tint(word, color, t, 0.2);
  }

  /** A little jump, to show which thing is being talked about. */
  function hop(s, node, t) {
    s.anim(node, [{ translate: '0px 0px' }, { translate: '0px -34px', offset: 0.4 }, { translate: '0px 0px' }], t, 0.45, 'ease-in-out', 'none');
    s.sfx('boing', t, 0.35);
  }

  /** Light each word as it is read aloud; a word that already wears a marker pulses instead. */
  function readOut(s, plain, marked, spoken) {
    plain.forEach(([word, i]) => s.read({ w: [word] }, [spoken[i]]));
    marked.forEach(([word, i]) => s.pulse(word, spoken[i].t0, { to: 1.16 }));
  }

  LessonStudio.define({
    id: 'agreement',
    teacher: 'bluebold',
    title: 'Find the real subject',
    beats: [
      {
        say: `{hi}Hey, it's Bluebold! {dis}Sentences wear disguises. {un}Today we're unmasking {the}the real subject.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.4);
          s.wideCam(c.dis - 0.5, 0.85);
          const line = s.spoken('Sentences wear disguises', c, c.dis, { y: 84, size: 88 });
          const art = s.shape(disguise(), { x: 384, y: 190, w: 460, h: 300 });
          const worn = c.word('disguises'), off = c.word('unmasking');
          ['.hat', '.mask', '.stache'].forEach((part, i) => s.pop(art.get(part), worn + i * 0.14, { gain: 0.5 }));
          s.anim(art.get('.eyes'), [{ translate: '0px 0px' }, { translate: '-22px 0px', offset: 0.2 }, { translate: '-22px 0px', offset: 0.45 }, { translate: '22px 0px', offset: 0.65 }, { translate: '22px 0px', offset: 0.85 }, { translate: '0px 0px' }], worn + 0.4, 1.3, 'linear');
          s.m.look('board', c.dis, 2);
          s.m.mood('sly', c.un, 2.4);
          flyOff(s, art.get('.hat'), off, { dx: -320, dy: -420, turn: -60 });
          flyOff(s, art.get('.mask'), off + 0.08, { dx: 380, dy: -460, turn: 50 });
          flyOff(s, art.get('.stache'), off + 0.14, { dx: 80, dy: 420, turn: 40 });
          s.sfx('whoosh', off, 0.8);
          s.hide(line, off, 0.3);
          const title = s.words('Find the real subject', { y: 300, size: 124, color: s.ink.yellow, times: [off + 0.2, c.the, c.word('real'), c.word('subject')] });
          s.mark(title.find('subject'), c.word('subject') + 0.15, { color: s.ink.pink });
        },
      },
      {
        page: 'Watch me',
        say: `{a}The box of pencils, is or are on the desk? {ear}Your ear hears {p}pencils, {wants}and wants to say {are}are. {trap}That's the trap.`,
        run(s, c, v) {
          const sp = c.from(c.a).map((w) => w.t0);
          v.top = s.words('The box of pencils is / are', { x: 107, y: 84, size: 104, align: 'left', times: sp.slice(0, 7) });
          v.low = s.words('on the desk.', { x: 107, y: 196, size: 104, align: 'left', times: sp.slice(7, 10) });
          v.top.w.slice(4).forEach((w) => { w.style.color = s.ink.teal; });
          const pencils = v.top.w[3], are = v.top.w[6];
          v.art = s.shape(boxOfPencils());
          const pens = [...v.art.querySelectorAll('.pen')];
          s.draw(v.art.get('.deskTop'), sp[1] - 0.1, 0.3, { gain: 0.3 });
          s.pop(v.art.get('.crate'), sp[1]);
          pens.forEach((p, i) => rise(s, p, sp[3] + i * 0.07, 112));
          s.draw(v.art.get('.deskLegs'), sp[9], 0.35, { gain: 0.3 });
          s.m.look('board', c.a, 3);
          v.ear = s.shape(earArt(650, 208));
          s.pop(v.ear.get('.lobe'), c.ear, { gain: 0.4 });
          v.ear.querySelectorAll('.wave').forEach((n, i) => s.draw(n, c.word('hears') + i * 0.12, 0.16, { gain: 0.2 }));
          v.penMark = s.mark(pencils, c.p, { color: s.ink.pink });
          pens.forEach((p, i) => s.anim(p, [{ rotate: '0deg' }, { rotate: '7deg', offset: 0.25 }, { rotate: '-7deg', offset: 0.75 }, { rotate: '0deg' }], c.p + i * 0.04, 0.5, 'ease-in-out', 'none'));
          s.m.point(pencils, c.p, 1.2);
          const head = s.arrow(over(s, pencils), over(s, are), c.wants, { color: s.ink.red, curve: -0.26 });
          v.arrow = [head, head.previousElementSibling];
          v.areMark = s.mark(are, c.are, { color: s.ink.red });
          s.m.mood('oops', c.are, 1.8);
          v.trap = s.tag('The trap', { x: 1030, y: 205, at: c.trap, bg: '#ff8080', size: 64 });
          s.pulse(are, c.trap, { to: 1.16 });
          s.m.act('shake', c.trap, 0.7);
        },
      },
      {
        say: `{cross}So cross out the {ph}phrase in the middle, {temp}just for a moment. {of}Of {pen}pencils, {gone}gone.`,
        run(s, c, v) {
          const of = v.top.w[2], pencils = v.top.w[3], are = v.top.w[6];
          [v.ear, v.trap, ...v.arrow].forEach((n) => s.hide(n, c.cross));
          unmark(s, pencils, v.penMark, c.cross, s.ink.white);
          unmark(s, are, v.areMark, c.cross, s.ink.teal);
          s.m.mood('sly', c.cross, 2.4);
          const ring = s.circle(around(of, pencils), c.ph, { color: s.ink.yellow, pad: 8 });
          s.m.point(pencils, c.ph, 1.5);
          v.moment = s.tag('just for a moment', { x: 836, y: 216, at: c.temp, bg: '#ffd66b', size: 50 });
          const cutOf = s.strike(of, c.of, { dim: 0.5 });
          const cutPen = s.strike(pencils, c.pen, { dim: 0.5 });
          [[of, 0.5], [pencils, 0.5], [cutOf, 1], [cutPen, 1], [ring, 1]].forEach(([n, from]) => vanish(s, n, c.gone, { from }));
          const a = boxIn(s, of), b = boxIn(s, pencils);
          puff(s, (a.left + b.right) / 2, b.cy, c.gone);
          s.sfx('whoosh', c.gone, 0.8);
          s.m.mood('wow', c.gone, 1.1);
          v.art.querySelectorAll('.pen').forEach((p, i) => flyOff(s, p, c.gone + i * 0.05, { dx: (i - 2) * 150, dy: -640, turn: (i - 2) * 80 + 40, dur: 0.75 }));
        },
      },
      {
        say: `{left}Now what's left? {bx}The box. {sub}The subject is box, {not}not pencils. {one}One box. {so}So, {verb}is. {r}The box is on the desk.`,
        run(s, c, v) {
          const line = s.words('The box is / are on the desk.', { y: 84, size: 104, hidden: true });
          const [the, box, is, slash, are, on, the2, desk] = line.w;
          [is, slash, are].forEach((w) => { w.style.color = s.ink.teal; });
          s.hide(v.moment, c.left);
          settle(s, [v.top.w[0], v.top.w[1], ...v.top.w.slice(4)], line.w.slice(0, 5), c.left, 0.42);
          settle(s, v.low.w, [on, the2, desk], c.left + 0.2, 0.62, { along: true });
          s.mark(box, c.bx, { color: s.ink.teal });
          s.m.point(box, c.bx, 1.3);
          hop(s, v.art.get('.crate'), c.bx);
          const under = boxIn(s, box);
          s.tag('subject', { x: under.right, y: 198, at: c.sub, bg: s.ink.teal, size: 52, align: 'right' });
          const nope = s.text('not pencils', { x: under.right + 26, y: 194, size: 76, color: s.ink.red, align: 'left', at: c.not, dur: 0.45 });
          s.m.act('shake', c.not, 0.6);
          s.hide(nope, c.one, 0.25);
          s.pop(s.place('1', { x: 450, y: 486, size: 136, color: OUTLINE }), c.one);
          s.text('one box', { x: 930, y: 340, size: 120, color: s.ink.teal, at: c.one, dur: 0.4 });
          const verb = s.text('is', { x: 930, y: 510, size: 150, color: s.ink.pink, at: c.verb, dur: 0.2 });
          s.arrow({ x: 930, y: 476 }, { x: 930, y: 534 }, c.so, { color: s.ink.yellow, curve: 0.01, gap: 0, width: 8 });
          const cut = s.strike(are, c.so, { dim: 0.5 });
          [[are, 0.5], [cut, 1], [slash, 1]].forEach(([n, from]) => vanish(s, n, c.verb, { from }));
          s.mark(is, c.verb, { color: s.ink.pink });
          s.arrow(over(s, box, 6), over(s, is, 6), c.verb + 0.1, { curve: -0.62, color: s.ink.teal });
          s.stars(is, c.verb + 0.1, 8, { spread: 130 });
          s.m.point(verb, c.verb, 1);
          s.m.act('thumbs', c.verb, 1.2);
          slide(s, [on, the2, desk], boxIn(s, slash).left - boxIn(s, on).left, c.verb + 0.15, 0.45);
          readOut(s, [[the, 0], [on, 3], [the2, 4], [desk, 5]], [[box, 1], [is, 2]], c.from(c.r));
          s.m.mood('proud', c.r, 2);
        },
      },
      {
        page: 'The idea',
        say: `{a}A verb agrees in number with its subject, {not}not with whatever {noun}noun happens to be {st}standing next to it.`,
        run(s, c) {
          const sp = c.from(c.a).map((w) => w.t0);
          const one = s.words('A verb agrees in number', { y: 84, size: 100, times: sp.slice(0, 5) });
          const two = s.words('with its subject', { y: 190, size: 100, times: sp.slice(5, 8) });
          s.mark(one.find('verb'), sp[1] + 0.1, { color: s.ink.pink });
          s.mark(one.find('number'), sp[4] + 0.1);
          s.mark(two.find('subject'), sp[7] + 0.1, { color: s.ink.teal });
          const is = s.text('is', { x: 980, y: 440, size: 136, color: s.ink.pink, align: 'left', at: sp[1], dur: 0.2 });
          const box = s.text('box', { x: 170, y: 440, size: 136, color: s.ink.teal, align: 'left', at: sp[7], dur: 0.3 });
          s.arrow(over(s, box, 14), over(s, is, 14), sp[7] + 0.3, { curve: -0.22, width: 9, dur: 0.6 });
          const pencils = s.text('pencils', { x: 600, y: 440, size: 136, color: s.ink.white, align: 'left', at: c.noun, dur: 0.35 });
          s.m.point(pencils, c.noun, 1.6);
          s.strike(pencils, c.word('it'), { dim: 0.45 });
          pencils.style.translate = '-210px 0px';
          s.anim(pencils, [{ translate: '-210px 0px' }, { translate: '0px 0px' }], c.st, 0.55, SLIDE);
          s.sfx('whoosh', c.st, 0.5);
          s.tag('just standing nearby', { x: 773, y: 600, at: c.word('next'), bg: s.ink.pink, size: 50 });
          s.m.act('shake', c.not, 0.7);
          s.m.mood('hmm', c.not, 2.2);
        },
      },
      {
        page: 'Picture this',
        chipColor: '#9fd0ff',
        say: `{pic}Think of a seesaw: {sub}subject on one side, {vb}verb on the other. {two}Two boxes, {are}are. {lev}Level. {take}Take one {aw}away, {tip}and it tips. {sw}Switch to is, {lv2}level again.`,
        run(s, c, v) {
          const art = s.shape(seesaw(s.ink)), plank = art.get('.plank'), pivot = { origin: '410px 516px' };
          const saw = c.word('seesaw');
          s.draw(art.get('.ground'), c.pic, 0.5, { gain: 0.3 });
          s.appear(art.get('.post'), saw, 0.25);
          s.appear(plank, saw, 0.25);
          s.m.look('board', c.pic, 2);
          v.subject = s.tag('subject', { x: 206, y: 262, at: c.sub, bg: s.ink.teal, size: 52 });
          s.tag('verb', { x: 600, y: 262, at: c.vb, bg: s.ink.pink, size: 52 });
          const says = (text, times) => {
            const line = s.words(text, { x: 968, y: 116, size: 88, times });
            line.w.slice(0, 2).forEach((w) => { w.style.color = s.ink.teal; });
            line.w[2].style.color = s.ink.pink;
            return line;
          };
          const two = says('two boxes are', [c.two, c.word('boxes'), c.are]);
          land(s, art.get('.boxA'), c.two);
          land(s, art.get('.boxB'), c.word('boxes'));
          s.turn(plank, -10, c.word('boxes') + 0.25, 0.55, pivot);
          s.m.point({ x: 206, y: 440 }, c.two, 1);
          land(s, art.get('.are'), c.are, 200);
          s.turn(plank, 0, c.are + 0.25, 0.6, pivot);
          const first = s.tag('level: they agree', { x: 410, y: 110, at: c.lev, bg: s.ink.teal, size: 52 });
          s.m.act('nod', c.lev, 0.5);
          flyOff(s, art.get('.boxB'), c.aw, { dx: -60, dy: -560, turn: -40, dur: 0.6 });
          s.sfx('whoosh', c.aw, 0.6);
          s.turn(plank, 10, c.aw + 0.2, 0.6, pivot);
          s.hide(first, c.aw + 0.2, 0.2);
          const tips = s.tag('tips: no match', { x: 410, y: 110, at: c.word('tips'), bg: s.ink.red, size: 52 });
          s.m.mood('wow', c.word('tips'), 1.1);
          flyOff(s, art.get('.are'), c.sw, { dx: 240, dy: -520, turn: 50, dur: 0.55 });
          land(s, art.get('.is'), c.word('is'), 200);
          s.hide(two, c.sw, 0.25);
          says('one box is', [c.word('is'), c.word('is') + 0.1, c.word('is') + 0.2]);
          s.m.point({ x: 600, y: 420 }, c.sw, 1.2);
          s.turn(plank, 0, c.lv2 - 0.1, 0.6, pivot);
          s.hide(tips, c.lv2 - 0.1, 0.2);
          v.level = s.tag('level: they agree', { x: 410, y: 110, at: c.lv2, bg: s.ink.teal, size: 52 });
          s.sfx('ding', c.lv2 + 0.2, 0.6);
          s.m.mood('happy', c.lv2, 1.4);
        },
      },
      {
        say: `{near}Now stand {pen}pencils right beside it. {no}Nothing moves. {only}It only weighs the {sub}subject.`,
        run(s, c, v) {
          const pens = s.shape(pencilBundle()).querySelectorAll('.pen');
          pens.forEach((p, i) => {
            s.grow(p, c.pen + i * 0.07, 0.34, { from: '1 0', to: '1 1', origin: '50% 100%' });
            s.anim(p, [{ rotate: '0deg' }, { rotate: '5deg', offset: 0.25 }, { rotate: '-5deg', offset: 0.75 }, { rotate: '0deg' }], c.word('beside') + i * 0.04, 0.5, 'ease-in-out', 'none');
          });
          s.sfx('pop', c.pen, 0.6);
          s.text('pencils', { x: 884, y: 296, size: 88, color: s.ink.yellow, at: c.pen, dur: 0.35 });
          s.m.point({ x: 884, y: 430 }, c.pen, 1.2);
          s.pulse(v.level, c.no, { to: 1.14 });
          s.m.act('shrug', c.no, 1);
          s.m.mood('sly', c.no, 2.2);
          s.circle(fullSize(v.subject), c.sub, { color: s.ink.yellow, pad: 10 });
          s.m.point(v.subject, c.only, 1.5);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}The list of chores, is or are long? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          const sp = c.from(c.a).map((w) => w.t0);
          v.top = s.words('The list of chores is / are', { x: 60, y: 84, size: 104, align: 'left', times: sp.slice(0, 7) });
          v.low = s.words('long?', { x: 60, y: 196, size: 104, align: 'left', times: sp.slice(7, 8) });
          v.top.w.slice(4).forEach((w) => { w.style.color = s.ink.teal; });
          v.list = s.shape(choreList());
          const paper = v.list.get('.paper'), rows = [...v.list.querySelectorAll('.row')];
          s.appear(paper, sp[1], 0.25);
          s.grow(paper, sp[7], 0.5, { from: '1 .5', to: '1 1', origin: '50% 0%' });
          rows.forEach((row, i) => s.appear(row, i < 2 ? sp[3] + i * 0.14 : sp[7] + 0.15 + (i - 2) * 0.14, 0.2));
          s.m.look('board', c.a, 3);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Is! {cross}Cross out {of}of {ch}chores. {one}One list, {so}so, {is}is. {r}The list is long.`,
        run(s, c, v) {
          const [the, list, of, chores, is, slash, are] = v.top.w;
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2.2);
          const away = c.ch + 0.3, dur = Math.max(0.4, c.one - away);
          s.mark(is, c.ans, { color: s.ink.pink, hold: Math.max(0.2, away - c.ans - 0.25) });
          s.stars(is, c.ans, 8, { spread: 120 });
          [are, slash].forEach((n) => vanish(s, n, c.ans + 0.15));
          const cutOf = s.strike(of, c.of, { dim: 0.5 });
          const cutCh = s.strike(chores, c.ch, { dim: 0.5 });
          [[of, 0.5], [chores, 0.5], [cutOf, 1], [cutCh, 1]].forEach(([n, from]) => vanish(s, n, away, { from }));
          const a = boxIn(s, of), b = boxIn(s, chores);
          puff(s, (a.left + b.right) / 2, b.cy, away);
          v.list.querySelectorAll('.row').forEach((row, i) => flyOff(s, row, away + (3 - i) * 0.07, { dx: (i - 1.5) * 70, dy: 620 - i * 60, turn: (i % 2 ? 1 : -1) * (24 + i * 8), dur: 0.65 }));
          const line = s.words('The list is long.', { y: 84, size: 104, hidden: true });
          line.w[2].style.color = s.ink.teal;
          settle(s, [the, list, is], line.w.slice(0, 3), away, dur);
          settle(s, v.low.w, [line.w[3]], away, dur, { along: true });
          s.mark(line.w[1], c.one, { color: s.ink.teal });
          s.pop(s.place('1', { x: 555, y: 430, size: 170, color: '#2c2233' }), c.one);
          s.text('one list', { x: 930, y: 350, size: 110, color: s.ink.teal, at: c.one, dur: 0.4 });
          s.arrow({ x: 930, y: 476 }, { x: 930, y: 530 }, c.so, { color: s.ink.yellow, curve: 0.01, gap: 0, width: 8 });
          s.text('is', { x: 930, y: 506, size: 140, color: s.ink.pink, at: c.is, dur: 0.2 });
          s.arrow(over(s, line.w[1], 6), over(s, line.w[2], 6), c.so, { curve: -0.62, color: s.ink.teal });
          s.mark(line.w[2], c.is, { color: s.ink.pink });
          s.m.point(line.w[2], c.is, 1);
          readOut(s, [[line.w[0], 0], [line.w[3], 3]], [[line.w[1], 1], [line.w[2], 2]], c.from(c.r));
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{but}But {dont}don't cross out too much. {a}The box and the bag are on the desk.`,
        run(s, c, v) {
          s.m.act('stop', c.but, 1);
          s.m.mood('hmm', c.but, 2);
          const warn = s.spoken("Don't cross out too much", c, c.dont, { y: 320, size: 104, color: s.ink.red });
          s.hide(warn, c.a, 0.25);
          const sp = c.from(c.a).map((w) => w.t0);
          v.top = s.words('The box and the bag', { x: 219, y: 84, size: 104, align: 'left', times: sp.slice(0, 5) });
          v.low = s.words('are on the desk.', { x: 219, y: 196, size: 104, align: 'left', times: sp.slice(5, 9) });
          v.art = s.shape(`${deskArt(170, 960, 652)}${cardboard(250, 490, 240, 150)}${bagArt(700, 470, 180, 170)}
            <text class="plus" x="595" y="600" font-size="120" text-anchor="middle" font-family="Chalk" fill="${s.ink.yellow}">+</text>`);
          s.draw(v.art.get('.deskTop'), sp[1] - 0.1, 0.3, { gain: 0.3 });
          s.pop(v.art.get('.crate'), sp[1]);
          s.pop(v.art.get('.bag'), sp[4]);
          s.draw(v.art.get('.deskLegs'), sp[8], 0.35, { gain: 0.3 });
          v.art.get('.plus').style.opacity = 0;
          s.m.look('board', c.a, 2.6);
        },
      },
      {
        say: `{try}Cross out {ab}and the bag, {lose}and you lose a subject.`,
        run(s, c, v) {
          const sp = c.from(c.ab, 3).map((w) => w.t0);
          const words = v.top.w.slice(2, 5);
          v.cuts = words.map((w, i) => s.strike(w, sp[i], { dim: 0.45 }));
          s.anim(v.art.get('.bag'), [{ translate: '0px 0px', rotate: '0deg', opacity: 1 }, { translate: '30px -90px', rotate: '12deg', opacity: 0.3 }], sp[2], 0.55, SLIDE);
          s.sfx('whoosh', sp[2], 0.6);
          s.m.point(words[2], c.ab, 1.4);
          s.m.mood('oops', c.lose, 1.9);
          s.m.act('shake', c.lose, 0.8);
          v.lost = s.tag('lost a subject', { x: 540, y: 318, at: c.lose, bg: s.ink.red, size: 52 });
        },
      },
      {
        say: `{two}Two things joined by {and}and: {sub}that's two subjects. {so}So, {are}are.`,
        run(s, c, v) {
          const [, box, and, the, bagWord] = v.top.w;
          v.cuts.forEach((n) => s.hide(n, c.two, 0.2));
          [and, the, bagWord].forEach((w) => s.anim(w, [{ opacity: 0.45 }, { opacity: 1 }], c.two, 0.25));
          s.anim(v.art.get('.bag'), [{ translate: '30px -90px', rotate: '12deg', opacity: 0.3 }, { translate: '0px 0px', rotate: '0deg', opacity: 1 }], c.two, 0.35, 'cubic-bezier(.5,0,.6,1.3)');
          s.sfx('boing', c.two + 0.25, 0.6);
          s.hide(v.lost, c.two, 0.2);
          s.mark(box, c.two + 0.1, { color: s.ink.teal });
          s.mark(bagWord, c.two + 0.3, { color: s.ink.teal });
          s.mark(and, c.and);
          s.appear(v.art.get('.plus'), c.and, 0.2);
          s.tag('two subjects', { x: 595, y: 318, at: c.sub, bg: s.ink.teal, size: 56 });
          s.m.mood('wow', c.sub, 1.2);
          const are = v.low.w[0];
          s.mark(are, c.are, { color: s.ink.pink });
          s.stars(are, c.are + 0.05, 8, { spread: 120 });
          s.m.point(are, c.are, 1.2);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{near}Nearby plurals are decoys. {dis}They distract you from a singular subject. {cross}Cross out the phrase, {match}then match subject and verb. {bye}Now hit Try this skill, and go unmask them!`,
        run(s, c) {
          const head = s.spoken('Nearby plurals are decoys', c, c.near, { y: 84, size: 100, color: s.ink.pink });
          const decoys = boxIn(s, head.find('decoys'));
          const art = s.shape(`<g transform="translate(${decoys.cx - 118} 26) rotate(-8 115 60) scale(.52)">${hatArt()}</g>`);
          const hat = art.get('.hat');
          s.pop(hat, c.word('decoys') + 0.1, { gain: 0.5 });
          s.mark(head.find('plurals'), c.word('plurals') + 0.1);
          const why = s.spoken('They distract you from a singular subject', c, c.dis, { y: 196, size: 72 });
          s.mark(why.find('singular'), c.word('singular') + 0.1, { color: s.ink.teal });
          const sp = c.from(c.cross, 4).map((w) => w.t0);
          const one = s.words('1. Cross out the phrase', { x: 191, y: 296, size: 88, align: 'left', times: [sp[0], ...sp] });
          s.strike(one.find('the'), sp[2], { dim: 1, color: s.ink.red });
          s.strike(one.find('phrase'), sp[3], { dim: 1, color: s.ink.red });
          const mp = c.from(c.match, 5).map((w) => w.t0);
          const two = s.words('2. Match subject and verb', { x: 191, y: 404, size: 88, align: 'left', times: mp });
          s.mark(two.find('subject'), mp[2] + 0.1, { color: s.ink.teal });
          s.mark(two.find('verb'), mp[4] + 0.1, { color: s.ink.pink });
          s.m.mood('proud', c.match, 3);
          s.tag('Next: Try this skill', { x: 614, y: 540, at: c.word('Try'), bg: '#ffd66b', size: 56 });
          s.m.act('wave', c.bye, 2.2);
          const off = c.word('unmask');
          flyOff(s, hat, off, { dx: 200, dy: -300, turn: 70 });
          s.sfx('whoosh', off, 0.6);
          s.confetti(c.bye + 0.6);
        },
      },
    ],
  });
})();
