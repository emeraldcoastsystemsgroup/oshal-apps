/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Change one variable: one dial turns while the others stay put, a turned dial swings a gauge, three pots grow under lamps left on for different hours while drops, soil and padlocks show what stays the same, a watering can spoils the test, little monsters bop to music or sit in silence, a chart of ice cream and sunburns falls apart when the summer sun comes up, and a balance levels when both sides get the same water
 */
(function () {
  const DARK = '#16352b', CHALK = '#f5f3ea', YELLOW = '#ffd66b', TEAL = '#8fe6cf', PINK = '#ff9ccf', RED = '#ff8080', BLUE = '#9fd0ff', ORANGE = '#ffb066';
  const LEAF = '#7cd67a', STEM = '#4fae58', CLAY = '#c9764a', RIM = '#dd8f62', SOIL = '#4a2e1c';
  const GROW = '50% 100%';

  /** s.pop parks a tag at scale 0 until its moment, and the stage's marks measure while building. */
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
      return { x: r.left - o.left, y: r.top - o.top, right: r.right - o.left, cx: r.left - o.left + r.width / 2, cy: r.top - o.top + r.height / 2 };
    });
  }

  const leaf = (x, y, side, len) => `<path d="M${x},${y} Q${x + side * len * 0.45},${y - len * 0.62} ${x + side * len},${y - len * 0.3} Q${x + side * len * 0.6},${y + len * 0.2} ${x},${y} Z" fill="${LEAF}" stroke="${STEM}" stroke-width="3"/>`;

  /** A plant on a pot rim: a curved stem with leaves in pairs, more of them the taller it is. */
  function plantArt(x, rim, height) {
    const pairs = Math.max(1, Math.round(height / 64));
    let leaves = leaf(x, rim - height + 4, 1, 40) + leaf(x, rim - height + 4, -1, 34);
    for (let i = 0; i < pairs; i++) {
      const y = rim - height * (0.3 + (0.5 * i) / Math.max(1, pairs));
      leaves += leaf(x, y, i % 2 ? 1 : -1, 60 - i * 3) + leaf(x, y - 16, i % 2 ? -1 : 1, 56 - i * 3);
    }
    return `<g class="plant"><path d="M${x},${rim} C${x + 9},${rim - height * 0.4} ${x - 9},${rim - height * 0.7} ${x},${rim - height}" fill="none" stroke="${STEM}" stroke-width="11" stroke-linecap="round"/>${leaves}</g>`;
  }

  function potArt(x, rim) {
    return `<g class="pot"><path d="M${x - 58},${rim + 14} H${x + 58} L${x + 44},${rim + 94} Q${x + 42},${rim + 102} ${x + 34},${rim + 102} H${x - 34} Q${x - 42},${rim + 102} ${x - 44},${rim + 94} Z" fill="${CLAY}" stroke="${DARK}" stroke-width="4"/>
      <rect x="${x - 70}" y="${rim}" width="140" height="26" rx="9" fill="${RIM}" stroke="${DARK}" stroke-width="4"/>
      <ellipse class="soil" cx="${x}" cy="${rim + 2}" rx="58" ry="11" fill="${SOIL}"/></g>`;
  }

  /** A lamp and its beam. The more hours it stays on, the stronger the glow it is given. */
  function lampArt(x, y, rim, glow) {
    const id = `beam-${x}-${y}`;
    return `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${YELLOW}" stop-opacity="${glow}"/><stop offset="1" stop-color="${YELLOW}" stop-opacity="${glow * 0.3}"/></linearGradient></defs>
      <path class="beam" d="M${x - 50},${y + 46} H${x + 50} L${x + 102},${rim} H${x - 102} Z" fill="url(#${id})"/>
      <g class="lamp"><path d="M${x - 26},${y} H${x + 26} L${x + 66},${y + 46} H${x - 66} Z" fill="${ORANGE}" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/><ellipse cx="${x}" cy="${y + 46}" rx="30" ry="9" fill="#fff3b0"/></g>`;
  }

  /** Pots under lamps as one picture, so the light falls behind the plants. Each is x, plant height, glow. */
  function bench(s, specs, rim, lampY) {
    const art = s.shape(specs.map(([x, h, glow]) => lampArt(x, lampY, rim, glow) + plantArt(x, rim, h) + potArt(x, rim)).join(''));
    const all = (cls) => [...art.querySelectorAll(cls)];
    return { art, rim, specs, beams: all('.beam'), lamps: all('.lamp'), plants: all('.plant'), pots: all('.pot'), soils: all('.soil') };
  }

  /** Switch a lamp on: the lamp pops up and its light fades in. */
  function lampOn(s, b, i, t) {
    s.pop(b.lamps[i], t, { gain: 0.5 });
    s.appear(b.beams[i], t + 0.1, 0.3);
  }

  /** Every plant starts as the same small sprout, whatever it grows to. */
  const sprout = (height) => `0.45 ${(26 / height).toFixed(3)}`;

  function dialArt(cx, cy, r, face = CHALK) {
    const ticks = [-120, -80, -40, 0, 40, 80, 120].map((deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `M${(cx + Math.cos(a) * (r + 12)).toFixed(1)},${(cy + Math.sin(a) * (r + 12)).toFixed(1)} L${(cx + Math.cos(a) * (r + 28)).toFixed(1)},${(cy + Math.sin(a) * (r + 28)).toFixed(1)}`;
    }).join(' ');
    return `<g class="dial"><path d="${ticks}" fill="none" stroke="${CHALK}" stroke-width="6" stroke-linecap="round"/>
      <g class="knob"><circle class="face" cx="${cx}" cy="${cy}" r="${r}" fill="${face}" stroke="${DARK}" stroke-width="5"/><path d="M${cx},${cy - r * 0.2} V${cy - r * 0.84}" fill="none" stroke="${DARK}" stroke-width="${r * 0.16}" stroke-linecap="round"/></g></g>`;
  }

  function gaugeArt(cx, cy, r) {
    const ticks = [-60, -30, 0, 30, 60].map((deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `M${(cx + Math.cos(a) * (r - 8)).toFixed(1)},${(cy + Math.sin(a) * (r - 8)).toFixed(1)} L${(cx + Math.cos(a) * (r - 28)).toFixed(1)},${(cy + Math.sin(a) * (r - 28)).toFixed(1)}`;
    }).join(' ');
    return `<g class="gauge"><path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy} Z" fill="rgba(245,243,234,.1)" stroke="${CHALK}" stroke-width="7" stroke-linejoin="round"/>
      <path d="${ticks}" fill="none" stroke="${CHALK}" stroke-width="6" stroke-linecap="round"/>
      <g class="needle"><path d="M${cx},${cy} V${cy - r * 0.72}" fill="none" stroke="${TEAL}" stroke-width="11" stroke-linecap="round"/></g>
      <circle cx="${cx}" cy="${cy}" r="15" fill="${TEAL}" stroke="${DARK}" stroke-width="4"/></g>`;
  }

  /** Set a part's starting angle, so later turns of it read from there. */
  function setAngle(node, deg, cx, cy) {
    node.style.transformBox = 'view-box';
    node.style.transformOrigin = `${cx}px ${cy}px`;
    node.style.rotate = `${deg}deg`;
    node._rot = deg;
  }

  function padlockArt(x, y, k = 1) {
    return `<g class="padlock"><path class="shackle" d="M${x - 14 * k},${y - 10 * k} V${y - 26 * k} A${14 * k},${14 * k} 0 0 1 ${x + 14 * k},${y - 26 * k} V${y - 10 * k}" fill="none" stroke="${CHALK}" stroke-width="${8 * k}" stroke-linecap="round"/>
      <rect x="${x - 24 * k}" y="${y - 14 * k}" width="${48 * k}" height="${40 * k}" rx="${8 * k}" fill="${BLUE}" stroke="${DARK}" stroke-width="4"/>
      <circle cx="${x}" cy="${y + 5 * k}" r="${6 * k}" fill="${DARK}"/></g>`;
  }

  /** A padlock pops on open and its shackle snaps shut at time t. */
  function snapShut(s, lock, t, k = 1) {
    const shackle = lock.querySelector('.shackle');
    shackle.style.translate = `0px ${-12 * k}px`;
    s.pop(lock, t - 0.22, { gain: 0.35 });
    s.anim(shackle, [{ translate: `0px ${-12 * k}px` }, { translate: '0px 0px' }], t, 0.1, 'ease-in');
    s.sfx('tick', t, 0.9);
  }

  const dropArt = (x, y, k = 1) => `<path class="drop" d="M${x},${y - 22 * k} C${x + 6 * k},${y - 8 * k} ${x + 15 * k},${y} ${x + 15 * k},${y + 9 * k} A${15 * k},${15 * k} 0 1 1 ${x - 15 * k},${y + 9 * k} C${x - 15 * k},${y} ${x - 6 * k},${y - 8 * k} ${x},${y - 22 * k} Z" fill="${BLUE}" stroke="${DARK}" stroke-width="3"/>`;

  /** A drop falls the given distance and is gone when it lands. */
  function fall(s, node, dy, t, dur = 0.42) {
    node.style.opacity = 0;
    s.anim(node, [{ translate: `0px ${-dy}px`, opacity: 1 }, { translate: '0px 0px', opacity: 1, offset: 0.94 }, { translate: '0px 0px', opacity: 0 }], t, dur, 'ease-in', 'none');
  }

  /** The watering can, spout to the left. x, y is the middle of its body. */
  function canArt(x, y) {
    return `<g class="can"><path d="M${x - 46},${y + 12} L${x - 120},${y - 44}" fill="none" stroke="${BLUE}" stroke-width="17" stroke-linecap="round"/>
      <path d="M${x - 138},${y - 56} L${x - 104},${y - 30}" fill="none" stroke="${BLUE}" stroke-width="20" stroke-linecap="round"/>
      <path d="M${x + 6},${y - 44} C${x + 16},${y - 104} ${x + 106},${y - 84} ${x + 56},${y + 8}" fill="none" stroke="${BLUE}" stroke-width="12" stroke-linecap="round"/>
      <rect x="${x - 56}" y="${y - 46}" width="112" height="94" rx="14" fill="${BLUE}" stroke="${DARK}" stroke-width="4"/></g>`;
  }

  function flaskArt(x, y) {
    const glass = `M${x - 34},${y - 300} H${x + 34} M${x - 24},${y - 300} V${y - 186} L${x - 112},${y - 34} Q${x - 124},${y} ${x - 90},${y} H${x + 90} Q${x + 124},${y} ${x + 112},${y - 34} L${x + 24},${y - 186} V${y - 300}`;
    const liquid = `M${x - 62},${y - 128} H${x + 62} L${x + 104},${y - 38} Q${x + 112},${y - 8} ${x + 86},${y - 8} H${x - 86} Q${x - 112},${y - 8} ${x - 104},${y - 38} Z`;
    const bubbles = [[-44, 34, 12], [20, 26, 15], [52, 40, 9], [-8, 44, 10]].map(([dx, up, r]) => `<circle class="bubble" cx="${x + dx}" cy="${y - up}" r="${r}" fill="#f5fffb"/>`).join('');
    return `<path class="liquid" d="${liquid}" fill="${TEAL}"/>${bubbles}<path class="glass" d="${glass}" fill="none" stroke="${CHALK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /** Bubbles keep rising from time t until the page is wiped. */
  function bubbleUp(s, nodes, t, until, rise = 72) {
    nodes.forEach((n, i) => {
      n.style.opacity = 0;
      for (let at = t + i * 0.17; at < until; at += 0.7) {
        s.anim(n, [{ translate: '0px 0px', opacity: 0.85 }, { translate: `0px ${-rise}px`, opacity: 0 }], at, 0.7, 'ease-in', 'none');
      }
    });
  }

  /** Bounce up and down from t until a later time: the little monsters' dance. */
  function bop(s, node, t, until, amp = 18, period = 0.21) {
    const count = Math.max(2, 2 * Math.round((until - t) / (2 * period)));
    const frames = Array.from({ length: count + 1 }, (_, i) => ({ translate: `0px ${i % 2 ? -amp : 0}px` }));
    s.anim(node, frames, t, count * period, 'ease-in-out');
  }

  const noteArt = (x, y, color = YELLOW) => `<g class="note"><ellipse cx="${x}" cy="${y}" rx="16" ry="12" fill="${color}" transform="rotate(-20 ${x} ${y})"/><path d="M${x + 14},${y - 3} V${y - 56} Q${x + 32},${y - 50} ${x + 36},${y - 28}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/></g>`;

  const sheetArt = (x, y) => `<g class="sheet"><rect x="${x - 30}" y="${y - 38}" width="60" height="76" rx="6" fill="${CHALK}" stroke="${DARK}" stroke-width="3"/><path d="M${x - 18},${y - 20} H${x + 18} M${x - 18},${y - 4} H${x + 18} M${x - 18},${y + 12} H${x + 4}" fill="none" stroke="#7a8a84" stroke-width="5" stroke-linecap="round"/></g>`;

  const tickArt = (x, y) => `<path class="tick" d="M${x - 16},${y + 12} L${x - 4},${y + 26} L${x + 22},${y - 8}" fill="none" stroke="#2f9e74" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;

  /** Two groups of three little monsters with their sheets, the same in every way but the music. */
  const GROUPS = { music: [145, 280, 415], silence: [695, 830, 965], y: 335, size: 124, sheetY: 440 };

  function iceCreamArt(x, y) {
    return `<g class="icecream"><path d="M${x - 40},${y - 92} L${x},${y} L${x + 40},${y - 92} Z" fill="#e7b36a" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/><path d="M${x - 22},${y - 90} L${x + 12},${y - 26} M${x + 22},${y - 90} L${x - 12},${y - 26}" stroke="#b9843c" stroke-width="3"/>
      <circle cx="${x}" cy="${y - 116}" r="42" fill="${PINK}" stroke="${DARK}" stroke-width="4"/><circle cx="${x - 13}" cy="${y - 128}" r="9" fill="#ffe2f0"/></g>`;
  }

  function sunArt(x, y, r) {
    const rays = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return `M${(x + Math.cos(a) * (r + 12)).toFixed(1)},${(y + Math.sin(a) * (r + 12)).toFixed(1)} L${(x + Math.cos(a) * (r + 32)).toFixed(1)},${(y + Math.sin(a) * (r + 32)).toFixed(1)}`;
    }).join(' ');
    return `<g class="sun"><g class="rays"><path d="${rays}" fill="none" stroke="${YELLOW}" stroke-width="10" stroke-linecap="round"/></g>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${YELLOW}" stroke="${ORANGE}" stroke-width="6"/>
      <circle cx="${x - r * 0.32}" cy="${y - r * 0.14}" r="${r * 0.09}" fill="${DARK}"/><circle cx="${x + r * 0.32}" cy="${y - r * 0.14}" r="${r * 0.09}" fill="${DARK}"/>
      <path d="M${x - r * 0.36},${y + r * 0.22} Q${x},${y + r * 0.6} ${x + r * 0.36},${y + r * 0.22}" fill="none" stroke="${DARK}" stroke-width="5" stroke-linecap="round"/></g>`;
  }

  /** Axes with two wobbling lines that climb together, as a chart of real counts would. */
  function trendArt({ x, y, w, h }) {
    const climb = [0.1, 0.2, 0.26, 0.42, 0.5, 0.68, 0.84];
    const wobble = [0, 0.02, -0.02, 0.015, 0.03, -0.01, 0];
    const path = (lift, sign) => 'M' + climb.map((v, i) => `${(x + 6 + ((w - 26) * i) / 6).toFixed(1)},${(y + h - (v + lift + sign * wobble[i]) * h).toFixed(1)}`).join(' L');
    return `<path class="ax" d="M${x},${y} V${y + h} H${x + w}" fill="none" stroke="${CHALK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="sales" d="${path(0.1, 1)}" fill="none" stroke="${YELLOW}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="burns" d="${path(0, -1)}" fill="none" stroke="${PINK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <text class="name" x="${x + w / 2}" y="${y + h + 52}" text-anchor="middle" font-size="44" font-family="Fredoka" font-weight="500" fill="${TEAL}">winter to summer</text>`;
  }

  /** A balance whose pans hang level however the beam tips. Each load goes on a pan in board coordinates. */
  function balance(s, { cx, by, arm, drop, foot, loadL, loadR }) {
    const pan = (hx, load, cls) => `<g class="${cls}"><path d="M${hx},${by} L${hx - 112},${by + drop} M${hx},${by} L${hx + 112},${by + drop}" fill="none" stroke="${CHALK}" stroke-width="5" stroke-linecap="round"/>
      ${load}<path d="M${hx - 128},${by + drop} H${hx + 128} Q${hx + 104},${by + drop + 38} ${hx},${by + drop + 38} Q${hx - 104},${by + drop + 38} ${hx - 128},${by + drop} Z" fill="${TEAL}" stroke="${DARK}" stroke-width="4"/></g>`;
    const hl = cx - arm, hr = cx + arm;
    const g = s.shape(`<g class="stand"><rect x="${cx - 18}" y="${by}" width="36" height="${foot - by}" rx="10" fill="#c9915a" stroke="${DARK}" stroke-width="3"/><rect x="${cx - 120}" y="${foot}" width="240" height="26" rx="12" fill="#a97243" stroke="${DARK}" stroke-width="3"/></g>
      <g class="beam"><rect x="${hl - 18}" y="${by - 11}" width="${2 * arm + 36}" height="22" rx="11" fill="${CHALK}" stroke="${DARK}" stroke-width="3"/>${pan(hl, loadL, 'panL')}${pan(hr, loadR, 'panR')}</g>
      <circle class="pin" cx="${cx}" cy="${by}" r="20" fill="${YELLOW}" stroke="${DARK}" stroke-width="4"/>`);
    const beam = g.get('.beam'), panL = g.get('.panL'), panR = g.get('.panR');
    return {
      g,
      /** Tip the beam. The pans turn back the other way, so they stay level. */
      tilt(deg, t, dur = 0.7) {
        s.turn(beam, deg, t, dur, { origin: `${cx}px ${by}px` });
        s.turn(panL, -deg, t, dur + 0.25, { origin: `${hl}px ${by}px`, easing: 'cubic-bezier(.3,1.9,.5,1)' });
        s.turn(panR, -deg, t, dur + 0.25, { origin: `${hr}px ${by}px`, easing: 'cubic-bezier(.3,1.9,.5,1)' });
      },
    };
  }

  /** A little potted plant on a balance pan: the same pot and plant, drawn smaller. */
  function panLoad(x, panY) {
    const rim = 300;
    return `<g transform="translate(${x} ${panY - 62}) scale(0.6) translate(${-x} ${-rim})">${plantArt(x, rim, 92)}${potArt(x, rim)}</g>`;
  }

  /** The opening picture: a bubbling flask wired to three dials, of which only one will turn. */
  function openingRig(s, c, tests, change, end) {
    const xs = [440, 630, 820], y = 530;
    const g = s.shape(`<path class="wire" d="M270,590 H340" fill="none" stroke="${CHALK}" stroke-width="7" stroke-linecap="round"/>
      <rect class="panel" x="340" y="432" width="590" height="196" rx="26" fill="rgba(245,243,234,.07)" stroke="${CHALK}" stroke-width="6"/>
      ${flaskArt(160, 690)}${xs.map((x) => dialArt(x, y, 56)).join('')}`);
    s.draw(g.get('.glass'), tests, 0.55);
    s.appear(g.get('.liquid'), tests + 0.2, 0.3);
    bubbleUp(s, [...g.querySelectorAll('.bubble')], tests + 0.3, end);
    s.draw(g.get('.panel'), tests + 0.2, 0.5, { gain: 0.3 });
    s.draw(g.get('.wire'), tests + 0.4, 0.2, { gain: 0.2 });
    const dials = [...g.querySelectorAll('.dial')], knobs = [...g.querySelectorAll('.knob')], faces = [...g.querySelectorAll('.face')];
    dials.forEach((d, i) => s.pop(d, tests + 0.35 + i * 0.12, { gain: 0.4 }));
    knobs.forEach((k, i) => setAngle(k, -80, xs[i], y));
    s.anim(faces[1], [{ fill: CHALK }, { fill: YELLOW }], change, 0.2, 'linear');
    s.turn(knobs[1], 100, change, Math.max(0.7, c.end - change), { origin: `${xs[1]}px ${y}px` });
    s.grow(g.get('.liquid'), change, 0.8, { from: '1 0.62', origin: GROW });
    s.sfx('whoosh', change, 0.5);
  }

  /** The idea as a machine: turn the dial on purpose, and read the gauge to see what happens. */
  function ideaMachine(s, c) {
    const dial = [280, 268], gauge = [850, 338];
    const g = s.shape(dialArt(dial[0], dial[1], 84, YELLOW) + gaugeArt(gauge[0], gauge[1], 132));
    const knob = g.get('.knob'), needle = g.get('.needle');
    setAngle(knob, -100, dial[0], dial[1]);
    setAngle(needle, -62, gauge[0], gauge[1]);
    s.pop(g.get('.dial'), c.ch, { gain: 0.6 });
    s.turn(knob, -30, c.word('change'), 0.6, { origin: `${dial[0]}px ${dial[1]}px` });
    s.pop(g.get('.gauge'), c.me, { gain: 0.6 });
    s.arrow({ x: 416, y: 268 }, { x: 702, y: 268 }, c.word('measure'), { color: YELLOW, curve: -0.14 });
    s.turn(knob, 72, c.word('what'), 0.9, { origin: `${dial[0]}px ${dial[1]}px`, easing: 'ease-in-out' });
    s.turn(needle, 40, c.word('what'), 1, { origin: `${gauge[0]}px ${gauge[1]}px` });
    s.sfx('whoosh', c.word('what'), 0.5);
  }

  /** Lamps go on for two, six and ten hours, each with its sign. */
  function lightUp(s, c, b, specs) {
    [c.a, c.b, c.d].forEach((at, i) => {
      lampOn(s, b, i, at);
      specs.tags.push(s.tag(specs.hours[i], { x: b.specs[i][0], y: 156, at, bg: YELLOW, size: 50 }));
    });
  }

  /** Height arrows that draw beside each plant as the word is said, so the measuring is seen. */
  function heightBars(s, b, t) {
    const bars = b.specs.map(([x, h]) => {
      const X = x + 84, top = b.rim - h, bot = b.rim - 6;
      return `<path class="bar" d="M${X - 12},${top + 14} L${X},${top} L${X + 12},${top + 14} M${X},${top} V${bot} M${X - 12},${bot - 14} L${X},${bot} L${X + 12},${bot - 14}" fill="none" stroke="${TEAL}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    s.shape(bars).querySelectorAll('.bar').forEach((n, i) => s.draw(n, t + i * 0.08, 0.5, { gain: 0.3 }));
  }

  /** Same species, same water, same soil: each is seen happening to all three pots alike. */
  function sameForAll(s, c, b) {
    b.plants.forEach((n, i) => s.anim(n, [{ rotate: '0deg' }, { rotate: '7deg', offset: 0.25 }, { rotate: '-7deg', offset: 0.65 }, { rotate: '0deg' }], c.same + i * 0.04, 0.75, 'ease-in-out', 'none'));
    const drops = s.shape(b.specs.flatMap(([x]) => [dropArt(x + 30, b.rim - 16), dropArt(x - 30, b.rim - 16)]).join(''));
    [...drops.querySelectorAll('.drop')].forEach((n, i) => fall(s, n, 150, c.w + (i % 2) * 0.2, 0.46));
    s.sfx('pop', c.w + 0.42, 0.35);
    b.soils.forEach((n) => s.anim(n, [{ fill: SOIL }, { fill: '#b57a48', offset: 0.35 }, { fill: SOIL }], c.so, 0.8, 'linear', 'none'));
    const tags = [['Same species', 225, c.same], ['Same water', 590, c.w], ['Same soil', 925, c.so]].map(([text, x, at]) => s.tag(text, { x, y: 648, at, bg: BLUE, size: 46 }));
    const locks = s.shape(tags.map((tag) => { const t = spot(s, tag); return padlockArt(t.right - 2, t.y + 8); }).join(''));
    [...locks.querySelectorAll('.padlock')].forEach((n, i) => snapShut(s, n, c.word('locked') + i * 0.1));
  }

  /** The spoiled test: the can tips over the tall plant, and drops run out of its spout. */
  function pourWater(s, c, x, y, rim) {
    const g = s.shape(canArt(x, y) + Array.from({ length: 9 }, () => dropArt(x - 138, rim - 10, 0.8)).join(''));
    const can = g.get('.can'), start = c.word('more'), stop = c.tall + 0.3;
    s.pop(can, start - 0.18, { gain: 0.5 });
    s.turn(can, -28, start, 0.4, { origin: `${x}px ${y}px`, easing: 'ease-out' });
    [...g.querySelectorAll('.drop')].forEach((n, i) => fall(s, n, rim - 10 - (y + 24), start + 0.25 + (i * (stop - start)) / 9, 0.34));
    s.sfx('swipe', start + 0.3, 0.7);
    s.turn(can, 0, stop, 0.4, { origin: `${x}px ${y}px`, easing: 'ease-in-out' });
  }

  /** The student's page: one group bops to music, the other sits still, then everyone gets a test. */
  function studyGroups(s, c, v) {
    const heard = c.word('music', 1), quiet = c.word('silence'), testAt = c.word('everyone');
    const hues = [40, 110, 190];
    const critters = [...GROUPS.music, ...GROUPS.silence].map((x, i) => {
      const at = i < 3 ? c.b + i * 0.14 : c.word('some', 1) + (i - 3) * 0.14;
      return s.critter(x, GROUPS.y, GROUPS.size, at, { hue: hues[i % 3] });
    });
    critters.slice(0, 3).forEach((n) => bop(s, n, heard, testAt));
    v.music = s.tag('music', { x: 280, y: 158, at: heard, bg: YELLOW, size: 58 });
    v.silence = s.tag('silence', { x: 830, y: 158, at: quiet, bg: BLUE, size: 58 });
    const notes = s.shape(noteArt(110, 232) + noteArt(450, 222, PINK) + noteArt(196, 214, TEAL));
    [...notes.querySelectorAll('.note')].forEach((n, i) => { s.pop(n, heard + i * 0.1, { gain: 0.2 }); bop(s, n, heard, testAt, 12, 0.3); });
    s.anim(notes, [{ opacity: 1 }, { opacity: 0 }], testAt, 0.3);
    const xs = [...GROUPS.music, ...GROUPS.silence];
    v.sheets = s.shape(xs.map((x) => sheetArt(x, GROUPS.sheetY)).join('') + xs.map((x) => tickArt(x, GROUPS.sheetY)).join(''));
    [...v.sheets.querySelectorAll('.sheet')].forEach((n, i) => s.pop(n, testAt + i * 0.07, { gain: 0.25 }));
    v.testTag = s.tag('word test', { x: 555, y: 370, at: c.word('word'), bg: TEAL, size: 46 });
  }

  /** The answer: the question line gives way to what was changed and what was measured. */
  function studyAnswer(s, c, v) {
    s.hide(v.q, c.ans, 0.2);
    atFullSize(v.music, () => s.circle(v.music, c.ans, { color: PINK, pad: 12 }));
    s.stars(v.music, c.ans + 0.1, 9);
    s.swap(v.ask, 'Independent: music or silence', c.ans, { color: YELLOW });
    atFullSize(v.silence, () => s.circle(v.silence, c.word('changed'), { color: PINK, pad: 12 }));
    s.arrow({ x: 420, y: 196 }, { x: 680, y: 196 }, c.word('changed'), { color: YELLOW, curve: -0.2 });
    const score = c.word('score');
    [...v.sheets.querySelectorAll('.tick')].forEach((n, i) => s.draw(n, score + i * 0.05, 0.2, { gain: 0.2 }));
    s.swap(v.testTag, 'test score', score, { color: DARK }).style.background = TEAL;
  }

  /** The chart page's two labels with their pictures, which later fly apart to make room for the sun. */
  function iceCreamCast(s, c) {
    const icon = s.shape(iceCreamArt(690, 332));
    s.pop(icon.get('.icecream'), c.a, { gain: 0.5 });
    const tagA = s.tag('ice cream sales', { x: 910, y: 184, at: c.word('sales'), bg: YELLOW, size: 46 });
    const burn = s.critter(690, 418, 112, c.word('sunburns'), { hue: 345, light: 1.25 });
    const tagB = s.tag('sunburns', { x: 860, y: 390, at: c.word('sunburns'), bg: PINK, size: 50 });
    return { icon, tagA, burn, tagB };
  }

  /** Ice cream does not cause sunburn: the two fly to either side and the arrow between them is struck out. */
  function noCause(s, c, cast) {
    const t = c.not, late = c.word('cause');
    s.move(cast.icon, 90 - 690, 92, t, 0.6);
    s.move(cast.tagA, 262 - 910, 292, t, 0.6);
    s.move(cast.tagB, 830 - 860, 86, t, 0.6);
    s.move(cast.burn, 1010 - 690, 56, t, 0.6);
    const word = s.text('causes', { x: 560, y: 356, size: 64, color: CHALK, at: late, dur: 0.3 });
    s.arrow({ x: 450, y: 448 }, { x: 680, y: 448 }, late, { color: CHALK, curve: 0.08 });
    s.strike(word, c.word('sunburn'), { dim: 0.6 });
  }

  /** It's just summer: the sun comes up over both, and the real cause points at each of them. */
  function summerSun(s, c) {
    const x = 560, y = 148, r = 62;
    const g = s.shape(sunArt(x, y, r));
    const sun = g.get('.sun');
    s.anim(sun, [{ translate: '0px 120px', opacity: 0 }, { translate: '0px 0px', opacity: 1 }], c.sum, 0.6);
    sun.style.opacity = 0;
    const rays = g.get('.rays');
    rays.style.transformBox = 'view-box';
    rays.style.transformOrigin = `${x}px ${y}px`;
    s.anim(rays, [{ rotate: '0deg' }, { rotate: '150deg' }], c.sum, 5, 'linear');
    s.sfx('whoosh', c.sum, 0.6);
    const tag = s.tag('summer!', { x: 800, y: 92, at: c.word('summer'), bg: YELLOW, size: 60 });
    s.arrow({ x: 470, y: 196 }, { x: 290, y: 366 }, c.word('summer'), { color: YELLOW, curve: 0.12 });
    s.arrow({ x: 650, y: 196 }, { x: 820, y: 366 }, c.word('summer'), { color: YELLOW, curve: -0.12 });
    return tag;
  }

  LessonStudio.define({
    id: 'science-design',
    teacher: 'sprout',
    title: 'Change one variable',
    beats: [
      {
        say: `{hi}Sprout here! {test}Want to test something properly? {one}You get one rule. {ch}Change one thing.`,
        run(s, c) {
          s.m.act('enter', c.start - 0.75, 0.4);
          s.faceCam(0, 0.01);
          s.m.act('wave', c.hi, 1);
          s.wideCam(c.test - 0.3, 1.1);
          openingRig(s, c, c.word('test'), c.word('change'), c.end + 1);
          s.words(['One', 'rule'], { x: 620, y: 84, size: 84, color: TEAL, times: [c.word('one'), c.word('rule')] });
          const line = s.spoken('Change one thing', c, c.ch, { x: 620, y: 178, size: 124, color: YELLOW });
          const one = c.word('one', 1);
          s.mark(line.find('one'), one);
          s.m.point(line.find('one'), one, 1.2);
          s.m.mood('proud', one, 1.4);
        },
      },
      {
        page: 'The idea',
        say: `{ctrl}In a controlled experiment, {ch}you change one thing on purpose: {iv}the independent variable. {me}You measure what happens: {dv}the dependent variable. {keep}And you keep everything else the same.`,
        run(s, c) {
          s.words(['Controlled', 'experiment'], { x: 660, y: 70, size: 84, times: [c.word('controlled'), c.word('experiment')] });
          ideaMachine(s, c);
          s.words(['change', 'on', 'purpose'], { x: 280, y: 392, size: 62, color: YELLOW, times: [c.word('change'), c.word('on'), c.word('purpose')] });
          s.tag('Independent', { x: 280, y: 470, at: c.word('independent'), bg: YELLOW, size: 60 });
          s.spoken('measure what happens', c, c.word('measure'), { x: 850, y: 392, size: 62, color: TEAL });
          s.tag('Dependent', { x: 850, y: 470, at: c.word('dependent'), bg: TEAL, size: 60 });
          s.m.look({ x: 280, y: 268 }, c.ch, 1.6);
          s.m.point({ x: 280, y: 300 }, c.word('independent'), 0.9);
          s.m.point({ x: 850, y: 300 }, c.word('what'), 1);
          const line = s.spoken('Keep everything else the same', c, c.word('keep'), { x: 565, y: 596, size: 70, color: BLUE });
          s.mark(line.find('same'), c.word('same'), { color: BLUE });
          const locks = s.shape(padlockArt(112, 636, 1.5) + padlockArt(1022, 636, 1.5));
          [...locks.querySelectorAll('.padlock')].forEach((n, i) => snapShut(s, n, c.word('same') + i * 0.1, 1.5));
          s.m.act('nod', c.word('same'), 0.8);
        },
      },
      {
        page: 'Watch me',
        say: `{q}Does light affect plant growth? {p}Three pots. {a}Two hours of light. {b}Six hours. {d}Ten hours. {ch}Light is what we change. {h}Height is what we measure.`,
        run(s, c, v) {
          const q = s.spoken('Does light affect plant growth?', c, c.q, { x: 640, y: 70, size: 76 });
          s.mark(q.find('light'), c.word('light'));
          s.mark(q.find('growth'), c.word('growth'), { color: TEAL });
          const specs = [[400, 96, 0.16], [670, 168, 0.3], [940, 240, 0.52]];
          const b = v.bench = bench(s, specs, 530, 234);
          b.pots.forEach((n, i) => s.pop(n, c.p + i * 0.14, { gain: 0.5 }));
          b.plants.forEach((n, i) => {
            s.grow(n, c.h, 0.95, { from: sprout(specs[i][1]), origin: GROW });
            s.appear(n, c.p + i * 0.14, 0.2);
          });
          const hours = { hours: ['2 h', '6 h', '10 h'], tags: [] };
          lightUp(s, c, b, hours);
          s.m.look('board', c.p, 2.5);
          const change = s.tag('We change', { x: 186, y: 156, at: c.word('change'), bg: YELLOW, size: 46 });
          hours.tags.forEach((n, i) => atFullSize(n, () => s.circle(n, c.ch + i * 0.1, { color: YELLOW, pad: 8 })));
          s.m.point(hours.tags[1], c.ch, 1);
          s.tag('We measure', { x: 186, y: 400, at: c.word('measure'), bg: TEAL, size: 46 });
          heightBars(s, b, c.word('measure'));
          s.sfx('whoosh', c.h, 0.5);
          s.m.mood('wow', c.h, 1.4);
          s.m.point({ x: 940, y: 330 }, c.h, 1.1);
          return change;
        },
      },
      {
        say: `{same}Same species. {w}Same water. {so}Same soil. {lock}Those stay locked.`,
        run(s, c, v) {
          sameForAll(s, c, v.bench);
          s.m.look({ x: 225, y: 660 }, c.same, 0.9);
          s.m.look({ x: 590, y: 660 }, c.w, 0.9);
          s.m.look({ x: 925, y: 660 }, c.so, 0.9);
          s.m.act('nod', c.lock, 0.9);
        },
      },
      {
        page: 'What if?',
        chipColor: '#ff8080',
        say: `{if}If I also gave the ten hour plant more water, {tall}and it grew taller, {was}was it the light, or the water? {cant}I can't tell. {unf}That's not a fair test.`,
        run(s, c) {
          const rim = 466, x0 = 250, x1 = 700, tall = 276;
          const b = bench(s, [[x0, 96, 0.16], [x1, tall, 0.52]], rim, 92);
          b.pots.forEach((n) => s.pop(n, c.if, { gain: 0.3 }));
          b.plants.forEach((n) => s.appear(n, c.if, 0.2));
          lampOn(s, b, 0, c.if);
          s.tag('2 h', { x: x0 + 124, y: 96, at: c.if, bg: YELLOW, size: 50 });
          lampOn(s, b, 1, c.word('ten'));
          s.tag('10 h', { x: x1 - 136, y: 96, at: c.word('ten'), bg: YELLOW, size: 50 });
          const start = 168 / tall;
          s.grow(b.plants[1], c.word('grew'), 0.9, { from: `0.8 ${start.toFixed(3)}`, origin: GROW });
          s.sfx('whoosh', c.word('grew'), 0.6);
          pourWater(s, c, 880, 300, rim);
          const water = s.tag('more water', { x: 960, y: 118, at: c.word('water'), bg: BLUE, size: 50 });
          s.m.point({ x: 700, y: 300 }, c.word('taller'), 0.9);
          const light = s.tag('Light?', { x: 470, y: 222, at: c.word('light'), bg: YELLOW, size: 54 });
          s.arrow({ x: 582, y: 258 }, { x: 650, y: 270 }, c.word('light'), { color: YELLOW, curve: 0.1 });
          s.pulse(light, c.word('light') + 0.3);
          const again = s.swap(water, 'Water?', c.word('water', 1), { color: DARK });
          again.style.background = BLUE;
          s.arrow({ x: 880, y: 190 }, { x: 750, y: 262 }, c.word('water', 1), { color: BLUE, curve: 0.12 });
          s.m.act('shrug', c.cant, 1.2);
          s.m.mood('oops', c.cant, 2.2);
          const stamp = s.tag('Not a fair test', { x: 500, y: 590, at: c.word('fair'), bg: RED, size: 84 });
          stamp.style.rotate = '-3deg';
          s.sfx('boing', c.word('fair'), 0.5);
        },
      },
      {
        page: 'Your turn',
        chipColor: '#ff9ccf',
        say: `{go}Your turn. {a}Does music help people remember words? {b}Some people hear music, some sit in silence, then everyone takes a word test. {ask}What's the independent variable? {try}Go.`,
        pause: 5.2,
        run(s, c, v) {
          v.q = s.spoken('Does music help people remember words?', c, c.a, { x: 555, y: 70, size: 68 });
          s.mark(v.q.find('music'), c.word('music'), { hold: 1.4 });
          studyGroups(s, c, v);
          v.ask = s.words(['Independent', 'variable?'], { x: 555, y: 520, size: 88, color: YELLOW, times: [c.word('independent'), c.word('variable')] });
          s.m.point(v.ask, c.ask, 1.2);
          s.m.act('think', c.try + 0.2, 4.6);
          s.m.mood('hmm', c.try + 0.2, 4.6);
          s.countdown(c.end + 0.3, 5, { x: 1080, y: 18 });
        },
      },
      {
        gap: 0.1,
        say: `{ans}The music! {why}That's what the researchers changed. {dv}The test score is the dependent variable.`,
        run(s, c, v) {
          studyAnswer(s, c, v);
          s.m.act('cheer', c.ans, 1);
          s.m.mood('proud', c.ans, 2);
          s.words(['Dependent:', 'test', 'score'], { x: 555, y: 620, size: 80, color: TEAL, times: [c.word('dependent'), c.word('dependent') + 0.12, c.word('dependent') + 0.24] });
        },
      },
      {
        page: 'A faster way',
        chipColor: '#8fe6cf',
        say: `{ask}On the test, ask two questions. {a}What changed on purpose? {b}What got measured? {those}Those are your independent and dependent variables.`,
        run(s, c) {
          const head = s.spoken('Ask two questions', c, c.word('ask'), { x: 640, y: 72, size: 74 });
          s.mark(head.find('two'), c.word('two'), { hold: 1.2, color: PINK });
          const icons = s.shape(dialArt(136, 240, 58, YELLOW) + gaugeArt(136, 544, 92));
          const knob = icons.get('.knob'), needle = icons.get('.needle');
          setAngle(knob, -90, 136, 240);
          setAngle(needle, -62, 136, 544);
          s.pop(icons.get('.dial'), c.a, { gain: 0.5 });
          s.turn(knob, 80, c.word('changed'), 0.8, { origin: '136px 240px' });
          s.pop(icons.get('.gauge'), c.b, { gain: 0.5 });
          s.turn(needle, 40, c.word('measured'), 0.8, { origin: '136px 544px' });
          const one = s.spoken('What changed on purpose?', c, c.a, { x: 680, y: 176, size: 88 });
          s.mark(one.find('changed'), c.word('changed'));
          const two = s.spoken('What got measured?', c, c.b, { x: 680, y: 428, size: 88 });
          s.mark(two.find('measured'), c.word('measured'), { color: TEAL });
          s.m.look(one, c.a, 1.2);
          s.m.look(two, c.b, 1.2);
          const said = c.word('independent'), said2 = c.word('dependent');
          const first = s.tag('Independent', { x: 680, y: 296, at: said, bg: YELLOW, size: 62 });
          s.tag('Dependent', { x: 680, y: 548, at: said2, bg: TEAL, size: 62 });
          s.m.point(first, said, 1.1);
          s.m.mood('proud', said2, 1.2);
        },
      },
      {
        page: 'Watch out',
        chipColor: '#ff8080',
        say: `{obs}And be careful with observational studies. {a}Ice cream sales and sunburns rise together. {not}Ice cream doesn't cause sunburn. {sum}It's just summer. {cor}Correlation, by itself, isn't proof of causation.`,
        run(s, c) {
          const title = s.spoken('Observational studies', c, c.word('observational'), { x: 640, y: 72, size: 80, color: YELLOW });
          s.m.mood('hmm', c.obs, 1.8);
          const chart = s.shape(trendArt({ x: 76, y: 180, w: 500, h: 290 }));
          s.draw(chart.get('.ax'), c.a - 0.4, 0.4, { gain: 0.3 });
          s.appear(chart.get('.name'), c.a - 0.2, 0.3);
          const rise = c.word('rise');
          s.draw(chart.get('.sales'), rise, 0.85);
          s.draw(chart.get('.burns'), rise + 0.05, 0.85, { gain: 0.2 });
          const cast = iceCreamCast(s, c);
          s.m.point({ x: 400, y: 280 }, rise, 1.1);
          s.hide(chart, c.not, 0.25);
          s.hide(title, c.not, 0.25);
          noCause(s, c, cast);
          s.m.act('shake', c.word('cause'), 0.8);
          const sun = summerSun(s, c);
          s.m.point(sun, c.word('summer'), 1);
          const cor = c.word('correlation'), proof = c.word('proof');
          const line = s.words(['Correlation', "isn't", 'proof', 'of', 'causation'], { x: 560, y: 590, size: 76, times: [cor, c.word("isn't"), proof, c.word('of'), c.word('causation')] });
          s.mark(line.find('proof'), proof, { color: PINK });
          s.m.look(line, cor, 2);
        },
      },
      {
        page: 'Remember',
        chipColor: '#ffd66b',
        say: `{fair}A fair comparison controls the other explanations. {bye}Now hit Try this skill!`,
        run(s, c) {
          const top = s.spoken('A fair comparison', c, c.fair, { x: 560, y: 70, size: 92, color: YELLOW });
          s.mark(top.find('fair'), c.word('fair'));
          const control = c.word('controls');
          const line = s.spoken('controls the other explanations', c, control, { x: 560, y: 164, size: 74 });
          s.under(line.find('controls'), control, { color: BLUE });
          const by = 300, drop = 118, arm = 240, cx = 560;
          const load = (x, extra) => panLoad(x, by + drop) + extra;
          const scale = balance(s, { cx, by, arm, drop, foot: 572, loadL: load(cx - arm, dropArt(cx - arm + 76, by + drop - 26, 1.3)), loadR: load(cx + arm, dropArt(cx + arm + 76, by + drop - 26, 1.3)) });
          const drops = [...scale.g.querySelectorAll('.drop')];
          fall(s, drops[1], 90, c.fair + 0.1, 0.34);
          drops[1].style.opacity = 1;
          scale.tilt(9, c.fair - 0.02, 0.01);
          s.show(scale.g, c.fair, 0.2);
          drops[0].style.opacity = 0;
          s.anim(drops[0], [{ translate: '0px -110px', opacity: 0 }, { translate: '0px -110px', opacity: 1, offset: 0.1 }, { translate: '0px 0px', opacity: 1 }], control, 0.34, 'ease-in');
          scale.tilt(0, control + 0.3, 0.75);
          s.stars({ x: cx, y: by }, control + 0.9, 8);
          const lock = s.shape(padlockArt(cx, 470, 1.6));
          snapShut(s, lock.get('.padlock'), c.word('explanations'), 1.6);
          s.m.point({ x: cx, y: by }, control, 1.1);
          s.m.mood('proud', c.fair, 3);
          const button = c.word('try');
          s.tag('Next: Try this skill', { x: 470, y: 620, at: button, bg: YELLOW, size: 58 });
          s.arrow({ x: 830, y: 640 }, { x: 830, y: 722 }, button, { color: YELLOW, curve: 0 });
          s.m.act('wave', c.bye, 1.8);
          s.confetti(c.bye + 0.5);
        },
      },
    ],
  });
})();
