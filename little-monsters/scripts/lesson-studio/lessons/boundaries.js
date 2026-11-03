/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Join complete sentences: a wanted poster for the outlaw comma, subjects and verbs lit under a magnifying glass, then sentences as railway cars: a period, a semicolon and a comma with a joining word each do the job, a comma alone drops out and the cars roll apart, and a fragment with no wheels of its own tips over until a comma hooks it up
 */
(function () {
  const INK = '#173a30';
  const BLUE = '#9fd0ff';
  const ORANGE = '#ffb066';
  const TEAL = '#8fe6cf';
  const PINK = '#ff9ccf';
  const RED = '#ff8080';
  const YELLOW = '#ffd66b';
  const CHALK = '#f5f3ea';
  const STEEL = '#3b4a56';
  const BOARD = { x: 58, y: 44, w: 1228 };
  const ROLL = 'cubic-bezier(.2,.75,.25,1)';

  /** An empty layer the size of the page: whatever is put in it moves and turns together. */
  function rig(s, ...nodes) {
    const n = document.createElement('div');
    n.style.cssText = 'position:absolute;inset:0';
    s.page._top.appendChild(n);
    n.append(...nodes);
    return n;
  }

  /** Measure a node on the board. Valid while building, before anything has moved. */
  function rectOf(node, pad = 0) {
    const r = node.getBoundingClientRect();
    return { x: r.left - BOARD.x - pad, y: r.top - BOARD.y - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  }

  /** The stretch from one word to another, for an underline that spans them. */
  function span(a, b) {
    return {
      getBoundingClientRect() {
        const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
        return { left: p.left, top: p.top, width: q.right - p.left, height: p.height };
      },
    };
  }

  /** A small target around a bold punctuation mark's own ink: `at` is how far down its line, `half` half its height in ems. */
  function nibOf(mark, at = 0.83, half = 0.2) {
    return {
      getBoundingClientRect() {
        const r = mark.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(mark).fontSize);
        const cy = r.top + r.height * at, cx = r.left + r.width / 2;
        return { left: cx - 10, top: cy - half * em, width: 20, height: half * 2 * em };
      },
    };
  }

  /** Where a block's text baseline falls, read from a zero-height inline probe. */
  function baselineOf(block) {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0';
    block.appendChild(probe);
    const y = probe.getBoundingClientRect().bottom;
    probe.remove();
    return y;
  }

  /** Name a comma as the suspect: it turns yellow in a red ring, jumps, and the monster points at it. Returns the ring. */
  function suspect(s, comma, t) {
    s.tint(comma, YELLOW, t);
    s.pulse(comma, t, { to: 1.4, dur: 0.6 });
    s.m.point(comma, t, 1);
    return s.circle(nibOf(comma), t, { color: RED, pad: 12 });
  }

  /** Fade out something that came in with dropIn, where hide would read its hidden starting opacity. */
  const fade = (s, n, t, dur = 0.16) => s.anim(n, [{ opacity: 1 }, { opacity: 0 }], t, dur);

  /** Drop something into place from above, with a bounce. */
  function dropIn(s, n, t, from = 230) {
    n.style.opacity = 0;
    s.anim(n, [{ opacity: 0 }, { opacity: 1 }], t, 0.06);
    s.anim(n, [{ translate: `0px ${-from}px` }, { translate: '0px 0px' }], t, 0.42, 'cubic-bezier(.5,0,.5,1.5)');
    s.sfx('pop', t + 0.28, 0.6);
    return n;
  }

  /** Let something fall off the board, turning as it goes. */
  function fall(s, n, t, drop = 340, spin = 55) {
    s.anim(n, [
      { translate: '0px 0px', rotate: '0deg', opacity: 1 },
      { opacity: 1, offset: 0.75 },
      { translate: `0px ${drop}px`, rotate: `${spin}deg`, opacity: 0 },
    ], t, 0.8, 'cubic-bezier(.5,0,.9,.6)');
    s.sfx('boing', t, 0.5);
  }

  /** A big round punctuation mark or word, placed but not yet revealed. */
  const glyph = (s, html, x, y, size = 190, color = YELLOW) => s.place(`<b>${html}</b>`, { x, y, size, color, font: "'Fredoka'" });

  /** One sticker spot that shows a single tag at a time. */
  function stickers(s, x, y, size = 60) {
    let shown = null;
    return (text, t, bg) => {
      if (shown) s.hide(shown, t, 0.12);
      shown = s.tag(text, { x, y, at: t, bg, size });
      return shown;
    };
  }

  /** The outlaw: a comma in a bandit mask, drawn in a square of the given size around a center point. */
  function outlaw(s, cx, cy, size) {
    return s.shape(`<g transform="translate(${size / 2} ${size / 2}) scale(${size / 240})">
      <path d="M-52,-34 a58,58 0 1 1 116,0 c0,62 -34,112 -92,136 c-8,3 -13,-5 -7,-11 c20,-20 32,-44 34,-70 c-30,-2 -51,-26 -51,-55 z" fill="${ORANGE}" stroke="#16352b" stroke-width="7"/>
      <rect x="-60" y="-70" width="132" height="38" rx="17" fill="#1d2430"/>
      <circle cx="-20" cy="-51" r="13" fill="#fff"/><circle cx="32" cy="-51" r="13" fill="#fff"/>
      <circle cx="-16" cy="-49" r="6" fill="#1d2430"/><circle cx="36" cy="-49" r="6" fill="#1d2430"/>
      <path d="M-10,-10 q16,12 32,0" fill="none" stroke="#16352b" stroke-width="7" stroke-linecap="round"/></g>`,
    { x: cx - size / 2, y: cy - size / 2, w: size, h: size });
  }

  /** A wanted poster's paper and heading, in a rig that pops as one around its own middle. */
  function poster(s, { x, y, w, h, title = 96 }) {
    const paper = s.shape(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#f3e3bd" stroke="#b89a62" stroke-width="5"/>
      <circle cx="${x + w / 2}" cy="${y + 13}" r="12" fill="${RED}" stroke="#7a2b2b" stroke-width="4"/>`);
    const head = s.place('<b>WANTED</b>', { x: x + w / 2, y: y + 26, size: title, color: '#a8322a', font: "'Fredoka'" });
    return { rig: rig(s, paper, head), origin: `${x + w / 2}px ${y + h / 2}px` };
  }

  /** Pop a poster in around its own middle, not the middle of the board. */
  function popPoster(s, p, t) {
    s.pop(p.rig, t);
    p.rig.style.transformOrigin = p.origin;
  }

  /** One wheel with spokes that show when it turns. */
  const wheelArt = (cx, cy, r) => `<g class="wheel"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#2a3240" stroke="${CHALK}" stroke-width="6"/>
    <path d="M${cx - r + 8},${cy} H${cx + r - 8} M${cx},${cy - r + 8} V${cy + r - 8}" stroke="${CHALK}" stroke-width="5"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.26}" fill="${YELLOW}"/></g>`;

  /** A railway car in its own rig, so body, wheels, words and marks move as one. */
  function car(s, { x, y, w, h, color }) {
    const r = 40, wy = y + h + 26, spots = [x + 78, x + w - 78], hook = y + h - 52;
    const svg = s.shape(`${spots.map((cx) => wheelArt(cx, wy, r)).join('')}
      <rect x="${x - 16}" y="${hook}" width="${w + 32}" height="20" rx="10" fill="${STEEL}"/>
      <rect x="${x + 8}" y="${y + h - 8}" width="${w - 16}" height="18" rx="8" fill="${STEEL}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${color}" stroke="#16352b" stroke-width="6"/>
      <rect x="${x - 8}" y="${y - 10}" width="${w + 16}" height="26" rx="13" fill="${STEEL}"/>`);
    const wheels = [...svg.querySelectorAll('.wheel')];
    wheels.forEach((g, i) => { g._hub = `${spots[i]}px ${wy}px`; });
    return { rig: rig(s, svg), wheels, x, y, w, h, r, right: x + w, cx: x + w / 2, hookY: hook + 10 };
  }

  /** Paint words on a car's side, already there when it rolls in. */
  function paint(s, k, html, { size = 92, dy = 28 } = {}) {
    const n = s.place(html, { x: k.cx, y: k.y + dy, size, color: INK });
    n.style.textAlign = 'center';
    k.rig.appendChild(n);
    return n;
  }

  /** Turn a car's wheels by the distance it covers. */
  function spin(s, k, dx, t, dur) {
    k.wheels.forEach((g) => s.turn(g, (g._rot || 0) + (dx / (2 * Math.PI * k.r)) * 360, t, dur, { origin: g._hub, easing: ROLL }));
  }

  /** A car arrives from off the board, hidden until it starts to move. */
  function rollIn(s, k, from, t, dur = 1) {
    k.rig.style.opacity = 0;
    s.anim(k.rig, [{ opacity: 0 }, { opacity: 1 }], t, 0.04);
    s.anim(k.rig, [{ translate: `${from}px 0px` }, { translate: '0px 0px' }], t, dur, ROLL);
    spin(s, k, -from, t, dur);
    s.sfx('whoosh', t, 0.5);
  }

  /** A car rolls along the rail from where it is. */
  function roll(s, k, dx, t, dur = 0.5) {
    s.move(k.rig, dx, 0, t, dur, ROLL);
    spin(s, k, dx, t, dur);
  }

  /** The rail the cars run on, with its sleepers. */
  function track(s, y, t) {
    let sleepers = '';
    for (let i = 0; i < 16; i++) sleepers += `<rect x="${40 + i * 74.27}" y="${y - 2}" width="34" height="16" rx="3" fill="#a86f3d"/>`;
    const g = s.shape(`<g class="sl">${sleepers}</g><path class="rail" d="M44,${y} H1184" fill="none" stroke="${CHALK}" stroke-width="8" stroke-linecap="round"/>`);
    s.draw(g.get('.rail'), t, 0.5);
    s.appear(g.get('.sl'), t + 0.2, 0.3);
  }

  /** A solid coupling between two cars, drawn across the gap. */
  function coupling(s, a, b, t) {
    const g = s.shape(`<path class="link" d="M${a.right + 12},${a.hookY} H${b.x - 12}" fill="none" stroke="${YELLOW}" stroke-width="18" stroke-linecap="round"/>`);
    s.draw(g.get('.link'), t, 0.25);
    s.sfx('ding', t + 0.2, 0.5);
    return g.get('.link');
  }

  /** A big red cross that draws itself over a mark. */
  function cross(s, cx, cy, r, t) {
    const line = (cls, x0, x1) => `<path class="${cls}" d="M${x0},${cy - r} L${x1},${cy + r}" fill="none" stroke="#ff5a5f" stroke-width="16" stroke-linecap="round"/>`;
    const g = s.shape(line('a', cx - r, cx + r) + line('b', cx + r, cx - r));
    s.draw(g.get('.a'), t, 0.14);
    s.draw(g.get('.b'), t + 0.14, 0.14);
    return g;
  }

  /** A comma alone: the cars close up on the outlaw, it gives way and they roll apart again. */
  function snapApart(s, c, L, R, gx, sign) {
    roll(s, L, 110, c.alone + 0.05, 0.42);
    roll(s, R, -110, c.alone + 0.05, 0.42);
    const o = outlaw(s, gx, 290, 170);
    dropIn(s, o, c.alone + 0.1, 220);
    sign('comma alone', c.alone, RED);
    s.m.point(o, c.alone, 0.8);
    fall(s, o, c.not);
    roll(s, L, -110, c.not, 0.8);
    roll(s, R, 110, c.not, 0.8);
    s.m.act('shake', c.not, 0.9);
    s.m.mood('oops', c.not, 1.4);
    sign('not enough', c.word('enough'), RED);
  }

  /** A car that cannot stand alone: its wheels drop off and it sags onto the rail. Returns the sag, so a coupling can lift it again. */
  function sag(s, k, t) {
    k.wheels.forEach((g, i) => s.anim(g, [{ translate: '0px 0px', opacity: 1 }, { translate: `${i ? 70 : -70}px 90px`, opacity: 0 }], t, 0.55, 'cubic-bezier(.5,0,.9,.6)'));
    k.rig.style.transformOrigin = `${k.x}px ${k.y + k.h}px`;
    const frames = [{ rotate: '0deg', translate: '0px 0px' }, { rotate: '-7deg', translate: '0px 58px' }];
    s.anim(k.rig, frames, t + 0.1, 0.5, 'cubic-bezier(.5,0,.6,1.5)');
    s.sfx('boing', t + 0.3, 0.6);
    return frames;
  }

  /** A sentence read aloud in two sides with a big comma between, so each part can be marked or replaced alone. */
  function clauses(s, c, leftText, rightText, cueL, cueR, { y, size }) {
    const left = s.spoken(leftText, c, cueL, { x: 0, y, size, align: 'left' });
    const right = s.spoken(rightText, c, cueR, { x: 0, y, size, align: 'left' });
    const lw = left.getBoundingClientRect().width - size * 0.28;
    const rw = right.getBoundingClientRect().width - size * 0.28;
    const gap = size * 0.85;
    const x0 = (BOARD.w - lw - gap - rw) / 2;
    left.style.left = x0 + 'px';
    right.style.left = x0 + lw + gap + 'px';
    const said = c.from(cueL, left.w.length).at(-1).t1;
    const comma = s.text('<b>,</b>', { x: x0 + lw + gap * 0.42, y, size: size * 1.5, font: "'Fredoka'", at: Math.min(said, cueR - 0.05), dur: 0.1, quiet: true });
    comma.style.top = y + baselineOf(left) - baselineOf(comma) + 'px';
    comma.style.transformOrigin = '50% 83%';
    return { left, right, comma, a: rig(s, left), b: rig(s, right) };
  }

  /** A magnifying glass whose lens starts over a point on the board. */
  function magnifier(s, x, y) {
    const glass = s.shape(`<line x1="146" y1="146" x2="212" y2="212" stroke="#a86f3d" stroke-width="28" stroke-linecap="round"/>
      <circle cx="92" cy="92" r="80" fill="rgba(255,255,255,.05)" stroke="${CHALK}" stroke-width="10"/>
      <path d="M44,72 Q54,44 82,36" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="8" stroke-linecap="round"/>`, { x: x - 92, y: y - 92, w: 240, h: 240 });
    glass._at = { x, y };
    return glass;
  }

  /** Slide the glass quietly to a new spot: its lens centers on the point. */
  function glide(s, glass, x, y, t, dur = 0.4) {
    const from = glass._off || { x: 0, y: 0 };
    const to = { x: x - glass._at.x, y: y - glass._at.y };
    s.anim(glass, [{ translate: `${from.x}px ${from.y}px` }, { translate: `${to.x}px ${to.y}px` }], t, dur, 'cubic-bezier(.45,.05,.2,1)');
    glass._off = to;
  }

  /** Wheels and a frame around one side of a sentence, to show it stands on its own. */
  function flatcar(s, side, block, color, t) {
    const last = block.w[block.w.length - 1];
    const box = rectOf(span(block.w[0], last), 8);
    const r = 30, wy = box.y + box.h + 24;
    const art = s.shape(`<rect class="fill" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="16" fill="${color}" fill-opacity=".18"/>
      <rect class="frame" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="16" fill="none" stroke="${color}" stroke-width="7"/>
      ${wheelArt(box.x + 70, wy, r)}${wheelArt(box.x + box.w - 70, wy, r)}`);
    side.prepend(art);
    s.appear(art.get('.fill'), t, 0.3);
    s.draw(art.get('.frame'), t, 0.4);
    art.querySelectorAll('.wheel').forEach((g, i) => s.pop(g, t + 0.25 + i * 0.12, { gain: 0.5 }));
    return wy + r;
  }

  /** A little hop, the way something shows it can stand up by itself. */
  const hop = (s, side, t) => s.anim(side, [{ translate: '0px 0px' }, { translate: '0px -26px', offset: 0.4 }, { translate: '0px 0px' }], t, 0.5, 'ease-in-out', 'none');

  /** A yellow warning triangle, for the top of a careful page. */
  function warning(s, cx, y, t) {
    const sign = s.shape(`<g transform="scale(1.6)"><path d="M70,8 L132,118 Q136,128 124,128 L16,128 Q4,128 8,118 Z" fill="${YELLOW}" stroke="#16352b" stroke-width="6" stroke-linejoin="round"/>
      <rect x="62" y="44" width="16" height="46" rx="7" fill="#16352b"/><circle cx="70" cy="106" r="9" fill="#16352b"/></g>`, { x: cx - 112, y, w: 224, h: 218 });
    s.pop(sign, t);
    return sign;
  }

  /** One way to join two sentences, on its own card: the mark large, its name under it. */
  function joinCard(s, { x, w, mark, label, bg, at, size = 130 }) {
    const cx = x + w / 2;
    const back = s.shape(`<rect x="${x}" y="208" width="${w}" height="226" rx="22" fill="rgba(245,243,234,.1)" stroke="rgba(245,243,234,.55)" stroke-width="4"/>`);
    s.pop(back.querySelector('rect'), at, { gain: 0.4 });
    dropIn(s, glyph(s, mark, cx, 305 - size * 0.915, size), at, 120);
    s.tag(label, { x: cx, y: 356, at: at + 0.1, bg, size: 46 });
  }

  /** A rubber stamp that slams down on a word. */
  function stamp(s, text, x, y, t) {
    const n = s.place(`<span style="display:inline-block;border:7px solid currentColor;border-radius:14px;padding:0 16px;background:rgba(243,227,189,.88)"><b>${text}</b></span>`, { x, y, size: 60, color: '#c0271f', font: "'Fredoka'" });
    n.style.rotate = '-12deg';
    n.style.opacity = 0;
    s.anim(n, [{ scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1 }], t, 0.2, 'ease-in');
    s.sfx('poof', t + 0.15, 0.8);
    return n;
  }

  LessonStudio.define({
    id: 'boundaries',
    teacher: 'bluebold',
    title: 'Join complete sentences',
    beats: [
      {
        say: `{hi}Hi! I'm Bluebold, {catch}and I catch sentences breaking the law. {crime}Today's crime: {two}two complete sentences, {glue}glued together with a {comma}comma.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1.4);
          s.wideCam(c.catch - 0.3, 1.1);
          s.text('Join complete sentences', { y: 50, size: 96, color: YELLOW, at: c.catch + 0.3, dur: 1.1 });
          s.m.mood('sly', c.crime, 3.4);
          popPoster(s, poster(s, { x: 224, y: 180, w: 780, h: 490 }), c.crime);
          const a = s.tag('sentence', { x: 386, y: 430, at: c.two, bg: BLUE, size: 56 });
          const b = s.tag('sentence', { x: 842, y: 430, at: c.two + 0.25, bg: ORANGE, size: 56 });
          s.move(a, 40, 0, c.glue, 0.5);
          s.move(b, -40, 0, c.glue, 0.5);
          const o = s.pop(outlaw(s, 607, 480, 270), c.comma, { gain: 0.9 });
          s.m.point(o, c.glue, 1.5);
        },
      },
      {
        page: 'Watch me',
        say: `{ev}Here's the evidence. {a}The lab closed, {r}the students went home. {ok}Is that okay? {test}Let's test it.`,
        run(s, c, v) {
          v.exhibit = s.tag('Exhibit A', { x: 614, y: 140, at: c.ev, bg: YELLOW, size: 60 });
          v.line = clauses(s, c, 'The lab closed', 'the students went home.', c.a, c.r, { y: 360, size: 76 });
          s.m.look('board', c.ev, 3);
          v.ring = suspect(s, v.line.comma, c.ok);
          s.m.mood('hmm', c.ok, 1.6);
          const box = rectOf(nibOf(v.line.comma));
          v.glass = magnifier(s, box.x + box.w / 2, box.y + box.h / 2);
          s.pop(v.glass, c.test);
        },
      },
      {
        say: `{left}Find the {sub}subject and {verb}verb on the left. {lab}The lab, {closed}closed. {done}Complete. {right}On the right. {stu}The students, {went}went. {also}Also complete. {both}Both sides could {stand}stand alone.`,
        run(s, c, v) {
          const { left, right, comma, a, b } = v.line;
          const lit = (word, t, color, side, block) => {
            side.insertBefore(s.mark(word, t, { color }), block);
            s.pulse(word, t, { to: 1.16, dur: 0.4 });
          };
          const go = (word, t) => { const r = rectOf(word); glide(s, v.glass, r.x + r.w / 2, r.y + r.h / 2, t); };

          s.hide(v.exhibit, c.left, 0.2);
          s.hide(v.ring, c.left, 0.2);
          const legend = [s.tag('subject', { x: 496, y: 130, at: c.sub, bg: TEAL, size: 56 }), s.tag('verb', { x: 732, y: 130, at: c.verb, bg: PINK, size: 56 })];
          go(left.find('lab'), c.left);
          s.m.point(left.find('lab'), c.left, 1.2);

          lit(left.find('lab'), c.lab, TEAL, a, left);
          go(left.find('closed'), c.closed);
          lit(left.find('closed'), c.closed, PINK, a, left);
          const lbox = rectOf(left);
          s.tag('complete', { x: lbox.x + lbox.w / 2 - 10, y: 240, at: c.done, bg: '#c9f3e8', size: 56 });
          s.m.act('nod', c.done, 0.5);

          go(right.find('students'), c.right);
          s.m.point(right.find('students'), c.right, 1.2);
          lit(right.find('students'), c.stu, TEAL, b, right);
          go(right.find('went'), c.went);
          lit(right.find('went'), c.went, PINK, b, right);
          const rbox = rectOf(right);
          s.tag('complete', { x: rbox.x + rbox.w / 2 - 10, y: 240, at: c.also, bg: '#c9f3e8', size: 56 });
          s.m.act('nod', c.also, 0.5);

          s.anim(v.glass, [{ opacity: 1 }, { opacity: 0 }], c.both, 0.2);
          legend.forEach((n) => s.hide(n, c.both, 0.2));
          const floor = flatcar(s, a, left, BLUE, c.both);
          flatcar(s, b, right, ORANGE, c.both + 0.1);
          track(s, floor + 4, c.both);
          fall(s, comma, c.stand, 300);
          hop(s, a, c.stand);
          hop(s, b, c.stand + 0.12);
          s.m.mood('wow', c.both, 1.8);
        },
      },
      {
        page: 'The idea',
        say: `{two}Two complete sentences need a {real}real connection. {p}A period. {semi}A semicolon. {comma}Or a comma with a {join}joining word, like {and}and, or {so}so. {alone}A comma alone is {not}not enough.`,
        run(s, c) {
          const gx = 540, top = 170, up = 130;
          track(s, 486, c.two);
          const L = car(s, { x: 60, y: top, w: 320, h: 244, color: BLUE });
          const R = car(s, { x: 700, y: top, w: 470, h: 244, color: ORANGE });
          paint(s, L, 'The lab<br>closed');
          const the = paint(s, R, '<span class="w">the</span> students<br>went home.').querySelector('.w');
          rollIn(s, L, -520, c.two);
          rollIn(s, R, 620, c.two + 0.1);
          const sign = stickers(s, gx, 545);
          sign('real connection?', c.real, YELLOW);
          const ask = dropIn(s, glyph(s, '?', gx, up), c.word('connection'));

          const period = c.word('period');
          fade(s, ask, period);
          const dot = dropIn(s, glyph(s, '.', gx, up - 62, 260), period);
          const cap = s.swap(the, 'The', period, { color: '#b3261e' });
          R.rig.appendChild(cap);
          sign('period', period, TEAL);
          s.m.point({ x: gx, y: 300 }, c.p, 1.6);

          const semi = c.word('semicolon');
          fade(s, dot, semi);
          const both = dropIn(s, glyph(s, ';', gx, up), semi);
          R.rig.appendChild(s.swap(cap, 'the', semi, { color: INK }));
          const link = coupling(s, L, R, semi + 0.2);
          sign('semicolon', semi, PINK);

          const comma = c.word('comma');
          fade(s, both, comma);
          const nib = dropIn(s, glyph(s, ',', gx - 100, up), comma);
          sign('comma', comma, BLUE);
          sign('comma + joining word', c.join, BLUE);
          const and = glyph(s, 'and', gx + 25, up + 82, 100);
          s.pop(and, c.and);
          const so = s.swap(and, `<b style="font-family:'Fredoka'">so</b>`, c.so);

          fade(s, nib, c.alone);
          s.hide(so, c.alone, 0.16);
          s.anim(link, [{ opacity: 1 }, { opacity: 0 }], c.alone, 0.16);
          snapApart(s, c, L, R, gx, sign);
        },
      },
      {
        page: 'Your turn',
        chipColor: PINK,
        say: `{go}Your turn. {a}The rain stopped, {r}we went outside. {ask}Legal, or {ill}illegal? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          s.m.mood('happy', c.go, 1);
          v.q = clauses(s, c, 'The rain stopped', 'we went outside.', c.a, c.r, { y: 220, size: 88 });
          v.legal = s.tag('Legal', { x: 390, y: 380, at: c.ask, bg: TEAL, size: 76 });
          v.illegal = s.tag('Illegal', { x: 830, y: 380, at: c.ill, bg: RED, size: 76 });
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}Illegal! {why}Two complete {th}thoughts, and just a {cm}comma. {fix}Fix it with a {semi}semicolon, {so}or a comma and so.`,
        run(s, c, v) {
          const { left, right, comma } = v.q;
          s.hide(v.legal, c.ans, 0.2);
          s.pulse(v.illegal, c.ans, { to: 1.3, dur: 0.6 });
          s.stars(v.illegal, c.ans + 0.1, 9);
          s.m.act('cheer', c.ans, 1.1);
          s.m.mood('proud', c.ans, 2.2);
          s.under(span(left.w[0], left.w[2]), c.why, { color: TEAL });
          s.under(span(right.w[0], right.w[2]), c.th, { color: TEAL });
          const ring = suspect(s, comma, c.cm);
          s.hide(ring, c.semi, 0.15);
          s.hide(v.illegal, c.semi, 0.15);
          const fixed = s.swap(comma, `<b style="font-family:'Fredoka'">;</b>`, c.semi);
          s.pulse(fixed, c.semi + 0.4, { to: 1.3, dur: 0.6 });
          s.circle(nibOf(fixed, 0.68, 0.36), c.semi + 0.15, { color: TEAL, pad: 12 });
          s.tag('Fixed', { x: 614, y: 380, at: c.semi + 0.1, bg: TEAL, size: 76 });
          s.m.act('nod', c.semi, 0.6);
          s.text('The rain stopped<b style="color:#ffd66b">, so</b> we went outside.', { y: 530, size: 84, at: c.so, dur: 1 });
        },
      },
      {
        page: 'Watch out',
        chipColor: RED,
        say: `{care}Careful, though. A {semi}semicolon needs a {comp}complete sentence on {both}both sides. {a}Because it rained, {we}we stayed in. {cant}Because it rained can't {stand}stand alone. {so}So a semicolon there is {wrong}wrong. {fix}A comma works here.`,
        run(s, c) {
          const gx = 560, top = 130, up = 90, h = 244;
          const sign = warning(s, gx, 130, c.care);
          s.m.mood('hmm', c.care, 2);
          s.hide(sign, c.semi, 0.15);
          const semi = dropIn(s, glyph(s, ';', gx, up), c.semi);

          track(s, top + h + 72, c.comp);
          const L = car(s, { x: 90, y: top, w: 350, h, color: BLUE });
          const R = car(s, { x: 680, y: top, w: 400, h, color: ORANGE });
          const nameL = paint(s, L, 'complete', { size: 80, dy: 84 });
          const nameR = paint(s, R, 'complete', { size: 80, dy: 84 });
          rollIn(s, L, -560, c.comp, 0.8);
          rollIn(s, R, 560, c.comp, 0.8);
          hop(s, L.rig, c.both);
          hop(s, R.rig, c.both);
          s.hide(nameL, c.a, 0.12);
          s.hide(nameR, c.we, 0.12);

          const opts = { size: 92, align: 'center', color: INK, leading: 1.1, y: top + 28 };
          const frag = s.spoken(['Because', 'it', 'rained'], c, c.a, { ...opts, x: L.cx, wrap: 320 });
          L.rig.appendChild(frag);
          R.rig.appendChild(s.spoken(['we', 'stayed', 'in.'], c, c.we, { ...opts, x: R.cx, wrap: 380 }));

          frag.w.forEach((w, i) => L.rig.insertBefore(s.mark(w, c.cant + i * 0.1, { color: PINK, hold: c.fix - c.cant - i * 0.1 }), frag));
          s.m.point(frag, c.cant, 1.2);
          const slump = sag(s, L, c.stand);
          s.m.mood('oops', c.stand, 1.4);
          const label = stickers(s, gx, 520, 60);
          label('cannot stand alone', c.stand + 0.2, RED);

          s.pulse(semi, c.word('semicolon', 1), { to: 1.25 });
          const no = cross(s, gx, top + 118, 70, c.wrong);
          s.m.act('shake', c.wrong, 0.8);

          fade(s, semi, c.fix);
          s.anim(no, [{ opacity: 1 }, { opacity: 0 }], c.fix, 0.16);
          dropIn(s, glyph(s, ',', gx, up), c.fix);
          coupling(s, L, R, c.fix + 0.2);
          s.anim(L.rig, [...slump].reverse(), c.fix + 0.25, 0.6, 'cubic-bezier(.3,1.3,.5,1)');
          label('comma works', c.fix + 0.2, TEAL);
          s.m.mood('happy', c.fix, 1.4);
        },
      },
      {
        page: 'A faster way',
        chipColor: TEAL,
        say: `{fast}The fast way: before you look at the {pun}punctuation choices, {find}find the {sub}subject and {verb}verb on {each}each side. {read}And read the {whole}whole sentence, not just the {under}underlined words.`,
        run(s, c) {
          const line = s.words(['The', 'bell', 'rang,', 'the', 'hall', 'emptied.'], { y: 110, size: 88, at: c.fast, per: 0.07 });
          const [, bell, rang, the, hall, emptied] = line.w;
          const blank = span(rang, the);
          s.m.mood('sly', c.fast, 2.2);
          s.under(blank, c.fast + 0.5, { color: YELLOW, drop: 2 });

          const picks = [['A  rang, the', 240], ['B  rang; the', 614], ['C  rang the', 988]];
          picks.forEach(([text, x], i) => {
            const n = s.tag(text, { x, y: 290, at: c.pun + i * 0.14, bg: CHALK, size: 46 });
            s.hide(n, c.find, 0.2);
          });

          s.m.point(line, c.find, 1.4);
          const rule = s.words('Subject + verb on each side?', { y: 280, size: 92, times: [c.sub, c.verb - 0.1, c.verb, c.word('on'), c.each, c.word('side')] });
          s.tint(rule.w[0], TEAL, c.sub);
          s.tint(rule.w[2], PINK, c.verb);
          const hold = c.read - c.sub;
          [bell, hall].forEach((w) => s.mark(w, c.sub, { color: TEAL, hold }));
          [rang, emptied].forEach((w) => s.mark(w, c.verb, { color: PINK, hold: c.read - c.verb }));

          const frame = s.frame(rectOf(blank, 10), c.read);
          frame.to(rectOf(span(line.w[0], emptied), 14), c.whole);
          s.m.point(line, c.whole, 1.4);
          s.text('Read the whole sentence', { y: 440, size: 96, color: YELLOW, at: c.whole, dur: 0.9 });
          s.tag('not just the underlined words', { x: 614, y: 585, at: c.under, bg: CHALK, size: 48 });
          s.pulse(rang, c.under, { to: 1.2 });
          s.pulse(the, c.under, { to: 1.2 });
        },
      },
      {
        page: 'Remember',
        chipColor: YELLOW,
        say: `{two}Two complete sides. {a}Period. {b}Semicolon. {d}Or a comma and a joining word. {bye}Now hit Try this skill, and go {catch}catch some {crim}criminals!`,
        run(s, c) {
          s.text('Two complete sides?', { y: 72, size: 100, color: YELLOW, at: c.two, dur: 0.8 });
          joinCard(s, { x: 60, w: 270, mark: '.', label: 'period', bg: TEAL, at: c.a, size: 200 });
          joinCard(s, { x: 356, w: 320, mark: ';', label: 'semicolon', bg: PINK, at: c.b });
          joinCard(s, { x: 702, w: 470, mark: ', so', label: 'comma + and / so', bg: BLUE, at: c.d });
          s.m.mood('proud', c.d, 3);
          s.tag('Next: Try this skill', { x: 350, y: 560, at: c.bye + 0.2, bg: YELLOW, size: 60 });
          s.m.act('wave', c.bye, 2.3);
          const p = poster(s, { x: 760, y: 456, w: 340, h: 266, title: 62 });
          popPoster(s, p, c.catch);
          s.pop(outlaw(s, 930, 600, 150), c.catch + 0.05);
          stamp(s, 'CAUGHT', 930, 618, c.crim);
          s.confetti(c.crim + 0.2);
        },
      },
    ],
  });
})();
