/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The lesson timeline: chalk writing, highlights, circles, moving math and board pages, each fired on the spoken word that names it. Time is seekable, so render.mjs can film any frame in any order
 */
(function () {
  'use strict';

  const BOARD = { x: 58, y: 44, w: 1228, h: 762 };
  const FPS = 30;
  const INK = { white: '#f5f3ea', yellow: '#ffd66b', pink: '#ff9ccf', teal: '#8fe6cf', red: '#ff8080', blue: '#9fd0ff', orange: '#ffb066' };
  const svgNS = 'http://www.w3.org/2000/svg';

  let world, chalk, fx, monster, anims = [], sfxList = [], seed = 7;
  /** Counted so a guard can refuse a lesson that is only words on a board. */
  const tally = { movingParts: 0, highlights: 0 };

  function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  const jitter = (n) => (rand() - 0.5) * 2 * n;

  /** Create a paused animation; seek() drives it. */
  function anim(node, frames, t, dur, easing = 'cubic-bezier(.3,.9,.3,1)', fill = 'forwards') {
    if (!Number.isFinite(t)) throw new Error('animation start is not a number: ' + t);
    const a = node.animate(frames, { delay: t * 1000, duration: Math.max(1, dur * 1000), easing, fill });
    a.pause();
    anims.push(a);
    return a;
  }

  function sfx(name, t, gain = 1, dur = 0) { sfxList.push({ name, t, gain, dur }); }

  /** A board page: highlights under the writing, marks and arrows over it. */
  function makePage() {
    const page = document.createElement('div');
    page.className = 'page';
    const under = document.createElement('div'); under.className = 'layer';
    const top = document.createElement('div'); top.className = 'layer';
    const ink = document.createElementNS(svgNS, 'svg'); ink.setAttribute('class', 'ink');
    page.append(under, top, ink);
    chalk.appendChild(page);
    page._under = under; page._top = top; page._ink = ink;
    return page;
  }

  /** Measure a node in board coordinates. Valid during build: nothing has moved yet. */
  function boxOf(node) {
    // A popped node waits at scale 0 until its moment; measure it at its real size.
    const parked = node.style && node.style.scale === '0';
    if (parked) node.style.scale = '1';
    const r = node.getBoundingClientRect();
    if (parked) node.style.scale = '0';
    return { x: r.left - BOARD.x, y: r.top - BOARD.y, w: r.width, h: r.height, cx: r.left - BOARD.x + r.width / 2, cy: r.top - BOARD.y + r.height / 2 };
  }

  function worldOf(target) {
    if (target === 'board') return { x: BOARD.x + BOARD.w / 2, y: BOARD.y + BOARD.h / 2 };
    if (target && target.nodeType) { const b = boxOf(target); return { x: b.cx + BOARD.x + (target._tx || 0), y: b.cy + BOARD.y + (target._ty || 0) }; }
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('a target needs numeric x and y: ' + JSON.stringify(target));
    return { x: target.x + BOARD.x, y: target.y + BOARD.y };
  }

  const WRITE_CLOSED = 'inset(-30% 104% -30% -4%)', WRITE_OPEN = 'inset(-30% -4% -30% -4%)';

  /** Reveal left to right, the way chalk writes. */
  function writeOn(node, t, dur) {
    node.style.clipPath = WRITE_CLOSED;
    anim(node, [{ clipPath: WRITE_CLOSED }, { clipPath: WRITE_OPEN }], t, dur, 'linear');
  }

  function wobble(x0, y0, x1, y1, amp) {
    const mx = (x0 + x1) / 2 + jitter(amp), my = (y0 + y1) / 2 + jitter(amp);
    return `M${x0},${y0} Q${mx},${my} ${x1},${y1}`;
  }

  /** Hand-drawn stroke that draws itself. */
  function stroke(page, d, t, { color = INK.pink, width = 8, dur = 0.42, opacity = 1 } = {}) {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', width);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('pathLength', '1');
    p.setAttribute('opacity', opacity);
    p.style.strokeDasharray = '1.02';
    p.style.strokeDashoffset = '1.02';
    page._ink.appendChild(p);
    anim(p, [{ strokeDashoffset: 1.02 }, { strokeDashoffset: 0 }], t, dur, 'ease-out');
    return p;
  }

  /** Everything a lesson can do. All times are seconds on the video timeline. */
  class Stage {
    constructor(m) { this.m = new Puppet(m); this.page_ = makePage(); this.ink = INK; }

    get page() { return this.page_; }

    /** Wipe the board with the eraser and start a new page ending at time t. */
    newPage(t, label, color) {
      const old = this.page_;
      const start = Math.max(0, t - 0.75);
      const eraser = document.getElementById('eraser');
      const path = [];
      for (let i = 0; i <= 6; i++) {
        path.push({ translate: `${40 + (i * BOARD.w) / 6}px ${(i % 2 ? 110 : 560) + jitter(40)}px`, opacity: i === 0 || i === 6 ? 0 : 1 });
      }
      anim(eraser, path, start, 0.72, 'linear', 'none');
      anim(old, [{ clipPath: 'inset(-5% 0 -5% 0%)', opacity: 1 }, { clipPath: 'inset(-5% 0 -5% 104%)', opacity: 0.55 }], start, 0.72, 'linear');
      sfx('erase', start, 0.8, 0.72);
      this.page_ = makePage();
      // A page is in the document from the start; keep it out of sight until its wipe ends.
      anim(this.page_, [{ opacity: 0 }, { opacity: 1 }], Math.max(0, t - 0.02), 0.02, 'linear', 'both');
      if (label) this.chip(label, t, color);
      return this.page_;
    }

    chip(text, t, color) {
      const n = document.createElement('div');
      n.className = 'chip';
      n.textContent = text;
      if (color) n.style.background = color;
      n.style.scale = '0';
      this.page_._top.appendChild(n);
      anim(n, [{ scale: 0 }, { scale: 1 }], t, 0.32, 'cubic-bezier(.3,1.6,.5,1)');
      sfx('pop', t, 0.6);
      return n;
    }

    /** Create a text block and position it by its anchor. */
    place(html, { x = BOARD.w / 2, y = 300, size = 72, color = INK.white, align = 'center', font }) {
      const n = document.createElement('div');
      n.className = 'txt';
      n.innerHTML = html;
      n.style.fontSize = size + 'px';
      n.style.color = color;
      if (font) n.style.fontFamily = font;
      this.page_._top.appendChild(n);
      const w = n.getBoundingClientRect().width;
      n.style.left = (align === 'center' ? x - w / 2 : align === 'right' ? x - w : x) + 'px';
      n.style.top = y + 'px';
      return n;
    }

    /** Write a whole line of text at time `at`. */
    text(html, opts = {}) {
      const n = this.place(html, opts);
      const chars = n.textContent.length;
      const dur = opts.dur || Math.min(1.5, Math.max(0.28, chars * 0.038));
      if (opts.fade) { n.style.opacity = 0; anim(n, [{ opacity: 0 }, { opacity: 1 }], opts.at, 0.3); }
      else writeOn(n, opts.at, dur);
      if (!opts.quiet) sfx('chalk', opts.at, 0.55, dur);
      return n;
    }

    /** Write a line word by word. Returns the block; .w holds each word, .find() looks one up. */
    words(text, opts = {}) {
      const parts = Array.isArray(text) ? text : text.split(' ');
      const gap = opts.gap === undefined ? 0.28 : opts.gap;
      const cell = opts.cell ? `width:${opts.cell}px;text-align:center;` : '';
      const html = parts.map((p) => `<span class="w" style="${cell}margin-right:${opts.cell ? 0 : gap}em">${p}</span>`).join('');
      const n = this.place(html, opts);
      n.w = [...n.querySelectorAll('.w')];
      if (opts.wrap) {
        n.style.whiteSpace = 'normal';
        n.style.width = opts.wrap + 'px';
        n.style.lineHeight = opts.leading || 1.28;
        n.style.left = (opts.align === 'center' ? (opts.x ?? BOARD.w / 2) - opts.wrap / 2 : opts.x) + 'px';
        n.style.textAlign = opts.align || 'left';
      }
      n.find = (word, nth = 0) => {
        const want = word.replace(/[^\w']/g, '').toLowerCase();
        const hits = n.w.filter((s) => s.textContent.replace(/[^\w']/g, '').toLowerCase() === want);
        if (!hits[nth]) throw new Error('no word on the board: ' + word);
        return hits[nth];
      };
      const times = opts.times;
      if (opts.hidden) { n.w.forEach((s) => { s.style.opacity = 0; }); return n; }
      if (opts.at === undefined && !times) throw new Error('words() needs at or times: ' + text);
      const per = opts.per === undefined ? 0.11 : opts.per;
      n.w.forEach((s, i) => {
        const when = times ? times[Math.min(i, times.length - 1)] : opts.at + i * per;
        writeOn(s, when, Math.max(0.12, s.textContent.length * 0.04));
      });
      sfx('chalk', times ? times[0] : opts.at, 0.55, Math.min(2.4, n.w.length * per + 0.2));
      return n;
    }

    /** Write a line one word at a time, each exactly as it is spoken. */
    spoken(text, c, cue, opts = {}) {
      const count = (Array.isArray(text) ? text : text.split(' ')).length;
      const times = c.from(cue, count).map((w) => w.t0);
      if (times.length < count) throw new Error('fewer spoken words than board words: ' + text);
      return this.words(text, { ...opts, times });
    }

    /** Raw animation, for moves the helpers do not cover. */
    anim(node, frames, t, dur, easing, fill) { tally.movingParts += 1; return anim(node, frames, t, dur, easing, fill); }

    /** Axes for a graph, with helpers that plot in data units. */
    plot({ x, y, w, h, xMax, yMax, xStep, yStep, xName, yName, at, yMin = 0, xMin = 0 }) {
      const ticks = [];
      for (let v = xMin + xStep; v <= xMax + 1e-6; v += xStep) ticks.push(['x', v]);
      for (let v = yMin + yStep; v <= yMax + 1e-6; v += yStep) ticks.push(['y', v]);
      const px = (v) => ((v - xMin) / (xMax - xMin)) * w;
      const py = (v) => h - ((v - yMin) / (yMax - yMin)) * h;
      const labels = ticks.map(([axis, v]) => (axis === 'x'
        ? `<text x="${px(v)}" y="${h + 48}" text-anchor="middle" font-size="42" font-family="Chalk" fill="${INK.white}">${v}</text><path d="M${px(v)},${h - 8} V${h + 8}" stroke="${INK.white}" stroke-width="4"/>`
        : `<text x="-20" y="${py(v) + 14}" text-anchor="end" font-size="42" font-family="Chalk" fill="${INK.white}">${v}</text><path d="M-8,${py(v)} H8" stroke="${INK.white}" stroke-width="4"/>`)).join('');
      const svg = this.shape(`<g class="ticks">${labels}</g>
        <path class="ax" d="M0,-10 V${h} H${w + 16}" fill="none" stroke="${INK.white}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        ${xName ? `<text class="name" x="${w / 2}" y="${h + 96}" text-anchor="middle" font-size="42" font-family="Fredoka" font-weight="500" fill="${INK.teal}">${xName}</text>` : ''}
        ${yName ? `<text class="name" x="${-h / 2}" y="-74" transform="rotate(-90)" text-anchor="middle" font-size="42" font-family="Fredoka" font-weight="500" fill="${INK.teal}">${yName}</text>` : ''}
        <g class="data"></g>`, { x, y, w, h });
      this.draw(svg.get('.ax'), at, 0.5);
      this.appear(svg.get('.ticks'), at + 0.3, 0.35);
      svg.querySelectorAll('.name').forEach((n) => this.appear(n, at + 0.4, 0.3));
      const data = svg.get('.data');
      const add = (markup) => { const g = document.createElementNS(svgNS, 'g'); g.innerHTML = markup; data.appendChild(g); return g.firstElementChild; };
      const box = (vx, vy) => ({ x: x + px(vx), y: y + py(vy) });
      return {
        px, py, svg, box,
        line: (x0, y0, x1, y1, t, { color = INK.yellow, width = 8, dur = 0.7 } = {}) => this.draw(add(`<path d="M${px(x0)},${py(y0)} L${px(x1)},${py(y1)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`), t, dur),
        dot: (vx, vy, t, { color = INK.pink, r = 15 } = {}) => this.pop(add(`<circle cx="${px(vx)}" cy="${py(vy)}" r="${r}" fill="${color}" stroke="#16352b" stroke-width="4"/>`), t, { gain: 0.5 }),
        shade: (x0, x1, t, { color = INK.pink, alpha = 0.18 } = {}) => this.appear(add(`<rect x="${px(x0)}" y="-10" width="${px(x1) - px(x0)}" height="${h + 10}" fill="${color}" fill-opacity="${alpha}"/>`), t, 0.4),
      };
    }

    /** Bars standing on a baseline. setTo() animates one to a new value. */
    bars(values, { x, y, w, h, max, gap = 26, colors = [INK.teal], at, per = 0.12 }) {
      const bw = (w - gap * (values.length - 1)) / values.length;
      const list = values.map((v, i) => {
        const bar = document.createElement('div');
        bar.className = 'bar';
        const color = colors[i % colors.length];
        Object.assign(bar.style, { position: 'absolute', left: x + i * (bw + gap) + 'px', top: y + 'px', width: bw + 'px', height: h + 'px', background: color, borderRadius: '10px 10px 3px 3px', transformOrigin: '50% 100%', scale: '1 0' });
        this.page_._under.appendChild(bar);
        bar._value = v;
        anim(bar, [{ scale: '1 0' }, { scale: `1 ${v / max}` }], at + i * per, 0.5, 'cubic-bezier(.3,1.25,.5,1)');
        sfx('pop', at + i * per, 0.45);
        return bar;
      });
      return {
        list,
        setTo: (i, v, t, dur = 0.65) => {
          tally.movingParts += 1;
          const bar = list[i];
          anim(bar, [{ scale: `1 ${bar._value / max}` }, { scale: `1 ${v / max}` }], t, dur, 'cubic-bezier(.4,1.2,.5,1)');
          bar._value = v;
        },
      };
    }

    /** A tiny monster on the board: an owner, a student, a friend. */
    critter(x, y, size, t, { hue = 0, light = 1.15 } = {}) {
      const n = document.createElement('div');
      Object.assign(n.style, { position: 'absolute', left: x - size / 2 + 'px', top: y - size * 0.58 + 'px', width: size + 'px', height: size * 1.154 + 'px' });
      n.innerHTML = `<img src="../art/monster/body.png" alt="" style="width:100%;height:100%;filter:hue-rotate(${hue}deg) brightness(${light})">
        <i style="position:absolute;left:27%;top:30%;width:19%;height:20%;border-radius:50%;background:radial-gradient(circle at 50% 60%,#1a0a24 0 46%,#fff 48%)"></i>
        <i style="position:absolute;left:54%;top:30%;width:19%;height:20%;border-radius:50%;background:radial-gradient(circle at 50% 60%,#1a0a24 0 46%,#fff 48%)"></i>
        <i style="position:absolute;left:38%;top:54%;width:24%;height:9%;border:0 solid #3a0820;border-bottom-width:${Math.max(2, size * 0.035)}px;border-radius:0 0 50% 50%"></i>`;
      this.page_._top.appendChild(n);
      this.pop(n, t, { gain: 0.4 });
      return n;
    }

    /** A frame that can change size, for scope and zoom. Starts at the first rect. */
    frame(rect, t, { color = INK.yellow, width = 8 } = {}) {
      const n = document.createElement('div');
      Object.assign(n.style, { position: 'absolute', border: `${width}px solid ${color}`, borderRadius: '18px', left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px', opacity: 0 });
      this.page_._top.appendChild(n);
      anim(n, [{ opacity: 0 }, { opacity: 1 }], t, 0.2);
      n._rect = rect;
      n.to = (next, at, dur = 0.7) => {
        tally.movingParts += 1;
        const a = n._rect;
        anim(n, [{ left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px' }, { left: next.x + 'px', top: next.y + 'px', width: next.w + 'px', height: next.h + 'px' }], at, dur, 'cubic-bezier(.4,1.1,.5,1)');
        n._rect = next;
        sfx('whoosh', at, 0.5);
      };
      return n;
    }

    /** Write something centered under a word, so a working lines up with what it works on. */
    below(target, html, opts = {}) {
      const b = boxOf(target);
      const dy = opts.dy === undefined ? 6 : opts.dy;
      return this.text(html, { size: 84, ...opts, x: b.cx + (opts.dx || 0), y: b.y + b.h + dy, align: 'center' });
    }

    /** Shortcut for an equation: tokens sit closer than words. */
    eq(tokens, opts = {}) { return this.words(tokens, { size: 150, gap: 0.2, ...opts }); }

    /** Light up each board word as it is spoken. Pass the spoken words of that stretch. */
    read(line, spoken, color = INK.yellow) {
      line.w.forEach((s, i) => {
        const sp = spoken[i];
        if (!sp) return;
        const base = s.style.color || getComputedStyle(s).color;
        anim(s, [{ color: base }, { color, offset: 0.2 }, { color, offset: 0.75 }, { color: base }], sp.t0 - 0.05, Math.max(0.42, sp.t1 - sp.t0 + 0.34), 'linear', 'none');
      });
    }

    /**
     * Marker swipe behind a word: the word turns dark on solid color so it jumps off the board.
     * Pass hold to let it fade again after that many seconds, so a working stays readable.
     */
    mark(target, t, { color = INK.yellow, alpha = 0.94, pad = 8, dur = 0.24, soft = false, ink = '#1d3a31', hold = 0 } = {}) {
      tally.highlights += 1;
      const b = boxOf(target);
      if (soft) alpha = 0.32;
      const base = getComputedStyle(target).color;
      if (!soft) anim(target, [{ color: base, textShadow: 'none' }, { color: ink, textShadow: 'none' }], t + dur * 0.5, 0.08, 'linear');
      const n = document.createElement('div');
      n.className = 'swipe';
      Object.assign(n.style, { left: b.x - pad + 'px', top: b.y + b.h * 0.1 + 'px', width: b.w + pad * 2 + 'px', height: b.h * 0.82 + 'px', background: color, opacity: alpha, scale: '0 1' });
      this.page_._under.appendChild(n);
      anim(n, [{ scale: '0 1' }, { scale: '1 1' }], t, dur, 'ease-out');
      sfx('swipe', t, 0.5);
      if (hold) {
        anim(n, [{ opacity: alpha }, { opacity: 0 }], t + hold, 0.3, 'linear');
        anim(target, [{ color: ink, textShadow: 'none' }, { color: base }], t + hold, 0.2, 'linear');
      }
      return n;
    }

    /** Hand-drawn loop around a word. */
    circle(target, t, { color = INK.pink, pad = 16, width = 8, dur = 0.5 } = {}) {
      tally.highlights += 1;
      const b = boxOf(target);
      const rx = b.w / 2 + pad, ry = b.h / 2 + pad;
      const pts = [];
      for (let i = 0; i <= 28; i++) {
        const a = -2.1 + (i / 28) * Math.PI * 2.16;
        const wob = 1 + 0.03 * Math.sin(i * 1.3) + (i / 28) * 0.05;
        pts.push(`${(b.cx + Math.cos(a) * rx * wob).toFixed(1)},${(b.cy + Math.sin(a) * ry * wob).toFixed(1)}`);
      }
      sfx('chalk', t, 0.7, dur);
      return stroke(this.page_, 'M' + pts.join(' L'), t, { color, width, dur });
    }

    /** Underline that draws in. */
    under(target, t, { color = INK.yellow, width = 8, dur = 0.34, drop = 6 } = {}) {
      const b = boxOf(target), y = b.y + b.h + drop;
      sfx('chalk', t, 0.6, dur);
      return stroke(this.page_, wobble(b.x - 4, y, b.x + b.w + 4, y + jitter(3), 6), t, { color, width, dur });
    }

    /** Cross a word out and dim it. */
    strike(target, t, { color = INK.red, width = 9, dur = 0.26, dim = 0.45 } = {}) {
      const b = boxOf(target), y = b.cy + 2;
      if (dim < 1) anim(target, [{ opacity: 1 }, { opacity: dim }], t + 0.12, 0.2);
      sfx('chalk', t, 0.7, dur);
      return stroke(this.page_, wobble(b.x - 8, y + 6, b.x + b.w + 8, y - 6, 8), t, { color, width, dur });
    }

    /** Curved arrow between two words or points. */
    arrow(from, to, t, { color = INK.teal, curve = 0.24, width = 7, dur = 0.42, head = 22, gap = 12 } = {}) {
      const a = from.nodeType ? boxOf(from) : { cx: from.x, cy: from.y, w: 0, h: 0 };
      const b = to.nodeType ? boxOf(to) : { cx: to.x, cy: to.y, w: 0, h: 0 };
      const dx = b.cx - a.cx, dy = b.cy - a.cy, len = Math.hypot(dx, dy) || 1;
      const edge = (box, ux, uy) => Math.min(box.w ? Math.abs(box.w / 2 / (ux || 1e-6)) : 0, box.h ? Math.abs(box.h / 2 / (uy || 1e-6)) : 0);
      const ux = dx / len, uy = dy / len;
      const s = edge(a, ux, uy) + gap, e = edge(b, ux, uy) + gap;
      const x0 = a.cx + ux * s, y0 = a.cy + uy * s, x1 = b.cx - ux * e, y1 = b.cy - uy * e;
      const mx = (x0 + x1) / 2 - uy * len * curve, my = (y0 + y1) / 2 + ux * len * curve;
      const ang = Math.atan2(y1 - my, x1 - mx);
      const hd = `M${x1 - head * Math.cos(ang - 0.5)},${y1 - head * Math.sin(ang - 0.5)} L${x1},${y1} L${x1 - head * Math.cos(ang + 0.5)},${y1 - head * Math.sin(ang + 0.5)}`;
      stroke(this.page_, `M${x0},${y0} Q${mx},${my} ${x1},${y1}`, t, { color, width, dur });
      sfx('swipe', t, 0.4);
      return stroke(this.page_, hd, t + dur, { color, width, dur: 0.12 });
    }

    /** Pop something in with a bounce. */
    pop(node, t, { dur = 0.34, gain = 0.7 } = {}) {
      node.style.scale = '0';
      node.style.clipPath = '';
      node.style.transformBox = 'fill-box';
      node.style.transformOrigin = '50% 50%';
      anim(node, [{ scale: 0 }, { scale: 1 }], t, dur, 'cubic-bezier(.3,1.7,.5,1)');
      sfx('pop', t, gain);
      return node;
    }

    show(node, t, dur = 0.3) { node.style.opacity = 0; anim(node, [{ opacity: 0 }, { opacity: 1 }], t, dur); return node; }
    hide(node, t, dur = 0.3) { anim(node, [{ opacity: 0 }], t, dur); return node; }

    /** Change a word's color and keep it. */
    tint(node, color, t, dur = 0.22) {
      anim(node, [{ color: getComputedStyle(node).color }, { color }], t, dur, 'linear');
      return node;
    }

    /** Slide something by an offset from where it is. */
    move(node, dx, dy, t, dur = 0.55, easing = 'cubic-bezier(.45,.05,.2,1)') {
      tally.movingParts += 1;
      const x0 = node._tx || 0, y0 = node._ty || 0;
      node._tx = x0 + dx; node._ty = y0 + dy;
      anim(node, [{ translate: `${x0}px ${y0}px` }, { translate: `${node._tx}px ${node._ty}px` }], t, dur, easing);
      sfx('whoosh', t, 0.42);
      return node;
    }

    /** Slide a word onto another word's spot. */
    flyTo(node, target, t, dur = 0.6) {
      const a = boxOf(node), b = boxOf(target);
      return this.move(node, b.cx - a.cx - (node._tx || 0) + (target._tx || 0), b.cy - a.cy - (node._ty || 0) + (target._ty || 0), t, dur);
    }

    /** A pulse to pull the eye. */
    pulse(node, t, { to = 1.22, dur = 0.5 } = {}) {
      anim(node, [{ scale: 1 }, { scale: to, offset: 0.4 }, { scale: 1 }], t, dur, 'ease-in-out', 'none');
      return node;
    }

    /** Fade the old word and write the new one in its place. */
    swap(node, html, t, opts = {}) {
      const b = boxOf(node);
      const fresh = document.createElement('div');
      // Swapping a sticker gives a sticker; swapping chalk gives chalk.
      fresh.className = node.classList.contains('tag') ? 'tag' : 'txt';
      fresh.innerHTML = html;
      fresh.style.fontSize = getComputedStyle(node).fontSize;
      fresh.style.color = opts.color || INK.yellow;
      this.page_._top.appendChild(fresh);
      const w = fresh.getBoundingClientRect().width, h = fresh.getBoundingClientRect().height;
      fresh.style.left = b.cx - w / 2 + 'px';
      fresh.style.top = b.cy - h / 2 + 'px';
      this.hide(node, t, 0.16);
      this.pop(fresh, t + 0.06);
      return fresh;
    }

    /** A rounded sticker label. */
    tag(text, { x, y, at, bg, color, size, align = 'center' }) {
      const n = document.createElement('div');
      n.className = 'tag';
      n.textContent = text;
      if (bg) n.style.background = bg;
      if (color) n.style.color = color;
      if (size) n.style.fontSize = size + 'px';
      this.page_._top.appendChild(n);
      const r = n.getBoundingClientRect();
      n.style.left = (align === 'center' ? x - r.width / 2 : align === 'right' ? x - r.width : x) + 'px';
      n.style.top = y + 'px';
      this.pop(n, at);
      return n;
    }

    /** Add free-form SVG to the board. Query its parts and animate them with draw(), appear() and turn(). */
    shape(markup, { x = 0, y = 0, w = BOARD.w, h = BOARD.h, layer = 'top' } = {}) {
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'shape');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.style.left = x + 'px'; svg.style.top = y + 'px';
      svg.style.width = w + 'px'; svg.style.height = h + 'px';
      svg.innerHTML = markup;
      (layer === 'under' ? this.page_._under : this.page_._top).appendChild(svg);
      svg.get = (sel) => { const n = svg.querySelector(sel); if (!n) throw new Error('no shape part: ' + sel); return n; };
      return svg;
    }

    /** Draw an SVG path or shape's outline over time. */
    draw(node, t, dur = 0.6, { gain = 0.6 } = {}) {
      node.setAttribute('pathLength', '1');
      node.style.strokeDasharray = '1.02';
      node.style.strokeDashoffset = '1.02';
      anim(node, [{ strokeDashoffset: 1.02 }, { strokeDashoffset: 0 }], t, dur, 'ease-in-out');
      sfx('chalk', t, gain, dur);
      return node;
    }

    /** Fade in an SVG part and leave it there. */
    appear(node, t, dur = 0.28) { node.style.opacity = 0; anim(node, [{ opacity: 0 }, { opacity: 1 }], t, dur); return node; }

    /** Rotate an SVG part around a point in its own coordinates. */
    turn(node, deg, t, dur = 0.7, { origin, easing = 'cubic-bezier(.34,1.5,.5,1)' } = {}) {
      tally.movingParts += 1;
      const from = node._rot || 0;
      node._rot = deg;
      if (origin) { node.style.transformBox = 'view-box'; node.style.transformOrigin = origin; }
      anim(node, [{ rotate: from + 'deg' }, { rotate: deg + 'deg' }], t, dur, easing);
      return node;
    }

    /** Grow an SVG part or element along one or both axes, from its origin. */
    grow(node, t, dur = 0.5, { from = '1 0', to = '1 1', origin, easing = 'cubic-bezier(.3,1.2,.5,1)' } = {}) {
      tally.movingParts += 1;
      if (origin) { node.style.transformBox = 'fill-box'; node.style.transformOrigin = origin; }
      node.style.scale = from;
      anim(node, [{ scale: from }, { scale: to }], t, dur, easing);
      return node;
    }

    /** Ring countdown for "your turn" pauses. Ticks once per second. */
    countdown(t, secs, { x = 1090, y = 70, size = 110 } = {}) {
      const svg = this.shape(`<circle class="back" cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 8}" fill="rgba(0,0,0,.18)" stroke="rgba(245,243,234,.3)" stroke-width="9"/>
        <circle class="ring" cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 8}" fill="none" stroke="${INK.yellow}" stroke-width="9" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>`, { x, y, w: size, h: size });
      const ring = svg.get('.ring');
      ring.setAttribute('pathLength', '1');
      ring.style.strokeDasharray = '1';
      anim(ring, [{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], t, secs, 'linear');
      this.show(svg, t, 0.2);
      for (let i = 0; i < secs; i++) {
        const num = this.place(String(secs - i), { x: x + size / 2, y: y + size * 0.14, size: size * 0.6, color: INK.yellow, font: "'Fredoka'" });
        num.style.opacity = 0;
        anim(num, [{ opacity: 0 }, { opacity: 1, offset: 0.05 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }], t + i, 1, 'linear', 'none');
        sfx('tick', t + i, 0.55);
      }
      anim(svg, [{ opacity: 1 }, { opacity: 0 }], t + secs, 0.2);
      return svg;
    }

    /** Stars that burst from a word or point. */
    stars(target, t, n = 9, { spread = 170 } = {}) {
      const c = worldOf(target);
      for (let i = 0; i < n; i++) {
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'star');
        svg.innerHTML = `<path d="M12 1l3.2 7.3 7.8.8-5.8 5.3 1.7 7.8L12 18.2 5.1 22.2l1.7-7.8L1 9.1l7.8-.8z" fill="${[INK.yellow, INK.pink, INK.teal, '#fff'][i % 4]}"/>`;
        svg.style.left = c.x - 23 + 'px'; svg.style.top = c.y - 23 + 'px';
        svg.style.opacity = 0;
        fx.appendChild(svg);
        const a = (i / n) * Math.PI * 2 + jitter(0.3), r = spread * (0.7 + rand() * 0.6);
        anim(svg, [
          { opacity: 1, translate: '0px 0px', scale: 0.3, rotate: '0deg' },
          { opacity: 1, offset: 0.6, translate: `${Math.cos(a) * r * 0.82}px ${Math.sin(a) * r * 0.82}px`, scale: 1, rotate: '120deg' },
          { opacity: 0, translate: `${Math.cos(a) * r}px ${Math.sin(a) * r + 30}px`, scale: 0.8, rotate: '200deg' },
        ], t, 0.9, 'ease-out', 'none');
      }
      sfx('ding', t, 0.8);
    }

    /** Falling paper at the end of a lesson. */
    confetti(t, n = 70) {
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        const color = [INK.yellow, INK.pink, INK.teal, INK.blue, INK.orange][i % 5];
        Object.assign(d.style, { position: 'absolute', left: rand() * 1920 + 'px', top: '-30px', width: 14 + rand() * 12 + 'px', height: 8 + rand() * 8 + 'px', background: color, opacity: 0, borderRadius: '2px' });
        fx.appendChild(d);
        const start = t + rand() * 1.1, dur = 1.8 + rand() * 1.1;
        anim(d, [
          { opacity: 1, translate: '0px 0px', rotate: '0deg' },
          { opacity: 1, offset: 0.85, translate: `${jitter(120)}px ${800 + rand() * 240}px`, rotate: `${jitter(700)}deg` },
          { opacity: 0, translate: `${jitter(140)}px 1120px`, rotate: `${jitter(900)}deg` },
        ], start, dur, 'cubic-bezier(.3,.3,.7,1)', 'none');
      }
      sfx('tada', t, 0.9);
    }

    /** Move the camera. Zoom 1 is the full room. */
    camera(zoom, cx, cy, t, dur = 0.9) {
      const clampT = (v, span) => Math.min(0, Math.max(span - span * zoom, v));
      const tx = clampT(960 - cx * zoom, 1920), ty = clampT(540 - cy * zoom, 1080);
      const next = `translate(${tx}px,${ty}px) scale(${zoom})`;
      anim(world, [{ transform: world._cam || 'translate(0px,0px) scale(1)' }, { transform: next }], t, dur, 'cubic-bezier(.45,.05,.25,1)');
      world._cam = next;
    }

    faceCam(t, dur) { this.camera(1.42, 1596, 610, t, dur); }
    boardCam(t, dur) { this.camera(1.16, 640, 440, t, dur); }
    wideCam(t, dur) { this.camera(1, 960, 540, t, dur); }
    sfx(name, t, gain, dur) { sfx(name, t, gain, dur); }
  }

  /** The stage-facing puppet: converts board targets to room points when asked. */
  class Puppet {
    constructor(m) { this.m = m; }
    point(target, t, dur) { this.m.point(worldOf(target), t, dur); return this; }
    look(target, t, dur) { this.m.look(worldOf(target), t, dur); return this; }
    act(name, t, dur = 1.2) {
      this.m.act(name, t, dur);
      if (name === 'hop') sfx('boing', t, 0.5);
      if (name === 'enter') sfx('boing', t, 0.6);
      return this;
    }
    mood(name, t, dur) { this.m.mood(name, t, dur); return this; }
  }

  /** Per-beat cue lookup. An unknown cue is a script bug and must stop the render. */
  function cuesFor(beat, index) {
    const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
    const helpers = {
      start: beat.start,
      end: beat.end,
      index,
      spoken: beat.words,
      word(text, nth = 0) {
        const hits = beat.words.filter((w) => norm(w.w) === norm(text));
        if (!hits[nth]) throw new Error(`beat ${index}: "${text}" is not spoken`);
        return hits[nth].t0;
      },
      from(t, count) {
        const rest = beat.words.filter((w) => w.t0 >= t - 0.001);
        return count === undefined ? rest : rest.slice(0, count);
      },
    };
    for (const name of Object.keys(beat.cues)) {
      if (name in helpers) throw new Error(`beat ${index}: the cue {${name}} is a reserved name; rename it`);
    }
    return new Proxy(helpers, {
      get(obj, key) {
        if (key in obj) return obj[key];
        if (typeof key === 'string' && key in beat.cues) return beat.cues[key];
        if (typeof key === 'symbol') return undefined;
        throw new Error(`beat ${index}: no cue {${String(key)}} in the script`);
      },
    });
  }

  /** The monster reacts to what it says even with no gesture written in the script. */
  function liveliness(s, beat) {
    for (const word of beat.words) {
      if (word.raw.endsWith('?')) s.m.act('tilt', word.t0 - 0.1, 0.9);
      if (word.raw.endsWith('!')) s.m.act('nod', word.t0, 0.5);
    }
  }

  async function loadImage(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  }

  const LessonStudio = {
    lessons: {},
    teachers: {},
    define(lesson) { this.lessons[lesson.id] = lesson; },
    worldPoint(p) { return p; },

    /** Build one lesson's whole timeline. */
    async build(id, timing) {
      const lesson = this.lessons[id];
      if (!lesson) throw new Error('no such lesson: ' + id);
      const teacher = this.teachers[lesson.teacher];
      if (!teacher) throw new Error('no such teacher: ' + lesson.teacher);
      world = document.getElementById('world');
      chalk = document.getElementById('chalk');
      fx = document.getElementById('fx');
      await Promise.all([document.fonts.load('72px Chalk'), document.fonts.load('600 34px Fredoka'), document.fonts.load('500 34px Fredoka')]);
      const names = ['body', 'arm_open', 'arm_point', 'arm_fist'];
      const images = await Promise.all(names.map((n) => loadImage(`../art/monster/${n}.png`)));
      const art = Object.fromEntries(names.map((n, i) => [n, images[i]]));
      monster = new window.Monster(document.getElementById('monster'), teacher, art);
      monster.setVoice(timing.mouthO, timing.mouthC, timing.fps);
      monster.planBlinks(timing.duration, id.length * 977 + 31);
      seed = id.length * 7919 + 13;
      const s = new Stage(monster);
      const state = {};
      lesson.beats.forEach((beat, i) => {
        const b = timing.beats[i];
        const c = cuesFor(b, i);
        if (beat.page) s.newPage(b.start, beat.page, beat.chipColor);
        liveliness(s, b);
        beat.run(s, c, state);
      });
      this.seek(0);
      return { duration: timing.duration, fps: FPS, sfx: sfxList, teacher: teacher.name, ...tally };
    },

    /**
     * Look for layout problems at time t: visible writing off the board, covered by other
     * writing, or too small to read on a phone. Geometry only; a person still judges the picture.
     */
    audit(t) {
      this.seek(t);
      const closed = (n) => /inset\([^)]*104%/.test(getComputedStyle(n).clipPath || '');
      const shown = (n) => {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3 || cs.scale === '0' || closed(n)) return false;
        for (let up = n.parentElement; up && up.id !== 'chalk'; up = up.parentElement) {
          if (Number(getComputedStyle(up).opacity) < 0.3 || closed(up)) return false;
        }
        const r = n.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };
      const boxes = [];
      const add = (n, owner, label) => {
        const r = n.getBoundingClientRect();
        boxes.push({ owner, text: label.slice(0, 40), left: r.left, right: r.right, top: r.top + r.height * 0.14, bottom: r.bottom - r.height * 0.14 });
      };
      const problems = [];
      const small = (n, text, floor) => {
        const size = parseFloat(getComputedStyle(n).fontSize);
        if (size < floor) problems.push({ kind: 'too-small', text: text.slice(0, 40), size });
      };
      chalk.querySelectorAll('.page .txt').forEach((block) => {
        const tokens = [...block.querySelectorAll('.w')];
        const live = tokens.filter(shown);
        if (tokens.length ? !live.length : !shown(block)) return;
        small(block, block.textContent.trim(), 56);
        if (tokens.length) live.forEach((w) => add(w, block, w.textContent.trim()));
        else add(block, block, block.textContent.trim());
      });
      chalk.querySelectorAll('.page .tag').forEach((tag) => {
        if (!shown(tag)) return;
        small(tag, tag.textContent.trim(), 38);
        add(tag, tag, tag.textContent.trim());
      });
      chalk.querySelectorAll('.page .chip').forEach((chip) => { if (shown(chip)) add(chip, chip, chip.textContent.trim()); });
      for (const b of boxes) {
        if (b.left < BOARD.x - 2 || b.right > BOARD.x + BOARD.w + 2 || b.top < BOARD.y - 2 || b.bottom > BOARD.y + BOARD.h + 2) {
          problems.push({ kind: 'off-board', text: b.text, box: [b.left, b.top, b.right, b.bottom].map(Math.round) });
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.owner === b.owner) continue;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 6 && h > 6) problems.push({ kind: 'overlap', a: a.text, b: b.text, area: Math.round(w * h) });
        }
      }
      return problems;
    },

    /** Put the whole stage at time t. */
    seek(t) {
      for (const a of anims) a.currentTime = t * 1000;
      monster.update(t);
    },
  };

  window.LessonStudio = LessonStudio;
})();
