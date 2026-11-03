/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The monster teacher as a cut-out puppet: rendered fur body and arms, a live face that blinks, looks and speaks from the voice track, and gestures on cue
 *
 * Every pose is a pure function of the time, so a frame can be rendered in any order
 * and comes out the same.
 */
(function () {
  'use strict';

  /** Where the rig stands in the 1920x1080 world, and the size it is drawn at. */
  const PLACE = { x: 1596, feet: 1046, scale: 0.56, feetY: 1465, centerX: 650 };
  const SHOULDER = { left: { x: 268, y: 905 }, right: { x: 1032, y: 905 } };
  const ARM_SCALE = 0.74;
  const ARM_PIVOT = { x: 400, y: 90 };
  const REST = { left: 11, right: 11 };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;
  const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const backOut = (k) => { k = clamp(k, 0, 1) - 1; return 1 + k * k * (2.7 * k + 1.7); };

  /** Ramp a gesture in and out over [t, t + dur], so nothing ever snaps. */
  function envelope(t, start, dur, rise = 0.22, fall = 0.28) {
    if (t < start || t > start + dur + fall) return 0;
    if (t < start + rise) return backOut((t - start) / rise);
    if (t > start + dur) return 1 - smooth((t - start - dur) / fall);
    return 1;
  }

  /** Small repeatable noise: a blend of sines, for idle sway that never loops visibly. */
  const wander = (t, seed) => Math.sin(t * 0.73 + seed) * 0.5 + Math.sin(t * 1.37 + seed * 2.1) * 0.3 + Math.sin(t * 2.91 + seed * 0.7) * 0.2;

  /** CSS hue-rotate, the same recolor the app's My Monsters screen applies. */
  function hueMatrixColor(rgb, deg, sat = 1) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const m = [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
    const out = [0, 1, 2].map((i) => m[i * 3] * rgb[0] + m[i * 3 + 1] * rgb[1] + m[i * 3 + 2] * rgb[2]);
    const grey = 0.213 * out[0] + 0.715 * out[1] + 0.072 * out[2];
    return out.map((v) => Math.round(clamp(grey + (v - grey) * sat, 0, 255)));
  }

  const css = (rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

  const svgNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    const n = document.createElementNS(svgNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  /** Face SVG: eyes, lids, brows and mouth, drawn in the body image's own pixels. */
  function buildFace(root, lid, brow) {
    const svg = el('svg', { id: 'face', viewBox: '0 0 1300 1500' }, root);
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <radialGradient id="sclera" cx="50%" cy="40%" r="62%"><stop offset="0" stop-color="#ffffff"/><stop offset=".72" stop-color="#fbf4fb"/><stop offset="1" stop-color="#d8c2dc"/></radialGradient>
      <radialGradient id="iris" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#4a2a5c"/><stop offset=".62" stop-color="#2a1236"/><stop offset="1" stop-color="#12061c"/></radialGradient>
      <linearGradient id="lidShade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${lid}"/><stop offset="1" stop-color="${lid}"/></linearGradient>
      <clipPath id="eyeClipL"><ellipse cx="0" cy="0" rx="122" ry="142"/></clipPath>
      <clipPath id="eyeClipR"><ellipse cx="0" cy="0" rx="122" ry="142"/></clipPath>
      <clipPath id="mouthClip"><path id="mouthClipPath"/></clipPath>`;
    const eyes = {};
    [['L', 482], ['R', 818]].forEach(([k, x]) => {
      const g = el('g', { transform: `translate(${x},600)` }, svg);
      el('ellipse', { cx: 0, cy: 8, rx: 136, ry: 156, fill: 'rgba(40,5,40,.36)' }, g);
      const clipped = el('g', { 'clip-path': `url(#eyeClip${k})` }, g);
      el('ellipse', { cx: 0, cy: 0, rx: 122, ry: 142, fill: 'url(#sclera)' }, clipped);
      const iris = el('g', {}, clipped);
      el('ellipse', { cx: 0, cy: 0, rx: 84, ry: 100, fill: 'url(#iris)' }, iris);
      el('ellipse', { cx: 0, cy: 6, rx: 46, ry: 56, fill: '#08030e' }, iris);
      el('ellipse', { cx: -28, cy: -42, rx: 30, ry: 34, fill: '#fff' }, iris);
      el('circle', { cx: 30, cy: 34, r: 13, fill: 'rgba(255,255,255,.85)' }, iris);
      const lidTop = el('path', { fill: lid }, clipped);
      const lidBot = el('path', { fill: lid }, clipped);
      el('ellipse', { cx: 0, cy: 0, rx: 122, ry: 142, fill: 'none', stroke: 'rgba(50,8,50,.75)', 'stroke-width': 7 }, g);
      const lash = el('path', { d: 'M-104,4 Q0,58 104,4', fill: 'none', stroke: 'rgba(50,8,50,.9)', 'stroke-width': 11, 'stroke-linecap': 'round', opacity: 0 }, g);
      eyes[k] = { iris, lidTop, lidBot, lash };
    });
    const browL = el('path', { fill: 'none', stroke: brow, 'stroke-width': 34, 'stroke-linecap': 'round' }, svg);
    const browR = el('path', { fill: 'none', stroke: brow, 'stroke-width': 34, 'stroke-linecap': 'round' }, svg);
    const mouthG = el('g', { transform: 'translate(650,868)' }, svg);
    const mouth = el('path', { fill: '#3a0820', stroke: 'rgba(52,6,40,.92)', 'stroke-width': 12, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, mouthG);
    const inner = el('g', { 'clip-path': 'url(#mouthClip)' }, mouthG);
    const tongue = el('ellipse', { fill: '#ee6d93' }, inner);
    const teeth = el('rect', { fill: '#fffaf2', rx: 12 }, inner);
    return { svg, eyes, browL, browR, mouth, tongue, teeth, clip: defs.querySelector('#mouthClipPath') };
  }

  /** Draw the art once, recolored, so a frame never pays for a CSS filter. */
  function recolored(image, hue, sat, light) {
    const c = document.createElement('canvas');
    c.width = image.naturalWidth; c.height = image.naturalHeight;
    const g = c.getContext('2d');
    g.filter = `hue-rotate(${hue}deg) saturate(${sat}) brightness(${light})`;
    g.drawImage(image, 0, 0);
    return c;
  }

  class Monster {
    /** @param {HTMLElement} root @param {object} teacher @param {object} art images by name */
    constructor(root, teacher, art) {
      this.root = root;
      this.teacher = teacher;
      this.events = [];
      this.points = [];
      this.moods = [];
      this.looks = [];
      this.blinks = [];
      this.mouthO = [];
      this.mouthC = [];
      this.fps = 30;
      const hue = teacher.hue || 0, sat = teacher.sat || 1, light = teacher.light || 1;
      const body = recolored(art.body, hue, sat, light);
      body.className = 'part';
      root.appendChild(body);
      this.lidColor = css(hueMatrixColor([150, 40, 138], hue, sat).map((v) => Math.min(255, v * light)));
      this.browColor = css(hueMatrixColor([84, 14, 84], hue, sat));
      this.face = buildFace(root, this.lidColor, this.browColor);
      this.arms = {};
      ['left', 'right'].forEach((side) => {
        const holder = document.createElement('div');
        holder.className = 'armHolder';
        const sprites = {};
        ['open', 'point', 'fist'].forEach((name) => {
          const c = recolored(art['arm_' + name], hue, sat, light);
          c.style.display = 'none';
          holder.appendChild(c);
          sprites[name] = c;
        });
        holder.style.transformOrigin = `${ARM_PIVOT.x}px ${ARM_PIVOT.y}px`;
        root.appendChild(holder);
        this.arms[side] = { holder, sprites, current: null };
      });
      if (teacher.accessory) this.face.svg.insertAdjacentHTML('beforeend', teacher.accessory);
    }

    /** Lip-sync data measured from the voice track at the render frame rate. */
    setVoice(open, shape, fps) { this.mouthO = open; this.mouthC = shape; this.fps = fps; }

    /** Blink at unhurried, unevenly spaced moments, seeded so a re-render matches. */
    planBlinks(duration, seed) {
      let t = 0.7, x = seed;
      while (t < duration) {
        x = (x * 9301 + 49297) % 233280;
        const r = x / 233280;
        this.blinks.push(t);
        if (r > 0.82) this.blinks.push(t + 0.24);
        t += 2.2 + r * 3.6;
      }
    }

    act(name, t, dur) { this.events.push({ name, t, dur }); }
    point(target, t, dur = 1.6) { this.points.push({ target, t, dur }); this.look(target, t - 0.12, dur + 0.2); }
    mood(name, t, dur = 2) { this.moods.push({ name, t, dur }); }
    look(target, t, dur = 1.4) { this.looks.push({ target, t, dur }); }

    /** Total weight of a named gesture at time t. */
    weight(name, t) {
      let w = 0, phase = 0;
      for (const e of this.events) {
        if (e.name !== name) continue;
        const k = envelope(t, e.t, e.dur);
        if (k > w) { w = k; phase = t - e.t; }
      }
      return { w, phase };
    }

    /** Speaking energy near time t, already 0..1 from the voice track. */
    energy(t) {
      const i = Math.floor(t * this.fps);
      return (this.mouthO[i] || 0) / 100;
    }

    /** The screen point the eyes are heading to, or null for the viewer. */
    gazeAt(t) {
      let target = null, best = -1;
      for (const l of this.looks) if (t >= l.t && t <= l.t + l.dur && l.t > best) { best = l.t; target = l.target; }
      return target;
    }

    armPose(t) {
      const out = { left: { a: REST.left, sprite: 'open', lift: 0 }, right: { a: REST.right, sprite: 'open', lift: 0 } };
      const e = this.energy(t);
      out.right.a += 7 * wander(t, 3.1) + 26 * smooth(e * 1.3) * (0.55 + 0.45 * Math.sin(t * 2.3));
      out.left.a += 5 * wander(t, 5.7) + 7 * smooth(e) * Math.sin(t * 1.9 + 1);
      this.applyPointing(t, out);
      this.applyGestures(t, out);
      return out;
    }

    /** Swing the board-side arm so the finger aims at the target. */
    applyPointing(t, out) {
      for (const p of this.points) {
        const k = envelope(t, p.t, p.dur, 0.28, 0.34);
        if (k <= 0) continue;
        const pos = window.LessonStudio.worldPoint(p.target);
        const sx = PLACE.x + (SHOULDER.left.x - PLACE.centerX) * PLACE.scale;
        const sy = PLACE.feet + (SHOULDER.left.y - PLACE.feetY) * PLACE.scale;
        const aim = (Math.atan2(sx - pos.x, pos.y - sy) * 180) / Math.PI;
        out.left.a = mix(out.left.a, clamp(aim, 20, 165) + 2.5 * Math.sin(t * 5.1), k);
        if (k > 0.25) out.left.sprite = 'point';
      }
    }

    applyGestures(t, out) {
      const wave = this.weight('wave', t);
      if (wave.w) { out.right.a = mix(out.right.a, 142 + 17 * Math.sin(wave.phase * 10), wave.w); }
      const cheer = this.weight('cheer', t);
      if (cheer.w) {
        out.left.a = mix(out.left.a, 150 + 10 * Math.sin(cheer.phase * 13), cheer.w);
        out.right.a = mix(out.right.a, 150 + 10 * Math.sin(cheer.phase * 13 + 2), cheer.w);
        if (cheer.w > 0.4) { out.left.sprite = 'fist'; out.right.sprite = 'fist'; }
      }
      const shrug = this.weight('shrug', t);
      if (shrug.w) {
        out.left.a = mix(out.left.a, 72, shrug.w);
        out.right.a = mix(out.right.a, 72, shrug.w);
        out.left.lift = out.right.lift = 26 * shrug.w;
      }
      const think = this.weight('think', t);
      // Fist at the chin, clear of the eyes and the glasses.
      if (think.w) { out.right.a = mix(out.right.a, -76, think.w); if (think.w > 0.4) out.right.sprite = 'fist'; }
      const thumbs = this.weight('thumbs', t);
      if (thumbs.w) { out.right.a = mix(out.right.a, 96, thumbs.w); if (thumbs.w > 0.4) out.right.sprite = 'fist'; }
      const stop = this.weight('stop', t);
      if (stop.w) { out.left.a = mix(out.left.a, 96, stop.w); out.right.a = mix(out.right.a, 96, stop.w); }
    }

    /** Whole-body motion: breathing, hops, leaning into a point. */
    bodyPose(t) {
      const e = this.energy(t);
      let dx = 7 * wander(t * 0.8, 1.2), dy = -10 * smooth(e) * Math.abs(Math.sin(t * 3.4));
      let rot = 1.2 * wander(t, 2.2) + 1.6 * smooth(e) * Math.sin(t * 2.7);
      let sx = 1 + 0.008 * Math.sin(t * 1.9), sy = 1 - 0.008 * Math.sin(t * 1.9);
      for (const p of this.points) {
        const k = envelope(t, p.t, p.dur, 0.28, 0.34);
        if (k > 0) { dx -= 52 * k; rot -= 4.5 * k; }
      }
      const hop = this.hopPose(t);
      dy += hop.dy; sx *= hop.sx; sy *= hop.sy;
      const nod = this.weight('nod', t);
      if (nod.w) { rot += 0; dy += 9 * nod.w * Math.abs(Math.sin(nod.phase * 7)); sy *= 1 - 0.02 * nod.w * Math.abs(Math.sin(nod.phase * 7)); }
      const shake = this.weight('shake', t);
      if (shake.w) { rot += 4.5 * shake.w * Math.sin(shake.phase * 12); }
      const tilt = this.weight('tilt', t);
      if (tilt.w) { rot += 7 * tilt.w; }
      const shrug = this.weight('shrug', t);
      if (shrug.w) { rot -= 4 * shrug.w; }
      const think = this.weight('think', t);
      if (think.w) { rot += 3.5 * think.w; }
      const lean = this.weight('lean', t);
      if (lean.w) { sx *= 1 + 0.03 * lean.w; sy *= 1 + 0.03 * lean.w; dy += 16 * lean.w; }
      return { dx, dy, rot, sx, sy, air: Math.max(0, -hop.dy) };
    }

    /** A hop: squash down, stretch up, land and settle. */
    hopPose(t) {
      let out = { dy: 0, sx: 1, sy: 1 };
      for (const name of ['hop', 'cheer', 'enter']) {
        for (const ev of this.events) {
          if (ev.name !== name) continue;
          const span = name === 'cheer' ? ev.dur : 0.62;
          const p = t - ev.t;
          if (p < -0.14 || p > span + 0.2) continue;
          const beat = name === 'cheer' ? ((p % 0.56) + 0.56) % 0.56 / 0.56 : clamp(p / 0.62, 0, 1);
          const high = name === 'cheer' ? 58 : 94;
          if (p < 0) { const k = 1 + p / 0.14; out = { dy: 0, sx: 1 + 0.07 * k, sy: 1 - 0.09 * k }; continue; }
          const arc = Math.sin(beat * Math.PI);
          const landing = p > span && p < span + 0.2 ? Math.sin(((p - span) / 0.2) * Math.PI) : 0;
          out = { dy: -high * arc, sx: 1 - 0.05 * arc + 0.06 * landing, sy: 1 + 0.07 * arc - 0.08 * landing };
        }
      }
      return out;
    }

    /** Mood blend for brows, lids and resting mouth. */
    moodPose(t) {
      const pose = { browL: 0, browR: 0, tiltL: 0, tiltR: 0, openEye: 0, sly: 0, smile: 0.72, hold: 0, wide: 0 };
      for (const m of this.moods) {
        const k = envelope(t, m.t, m.dur, 0.16, 0.3);
        if (k <= 0) continue;
        const set = MOODS[m.name] || {};
        Object.keys(set).forEach((key) => { pose[key] = mix(pose[key], set[key], k); });
      }
      return pose;
    }

    gaze(t, pose) {
      const target = this.gazeAt(t);
      let gx = 3 * wander(t * 1.4, 7), gy = 2 * wander(t * 1.1, 9);
      if (target) {
        const pos = window.LessonStudio.worldPoint(target);
        const ex = PLACE.x, ey = PLACE.feet + (600 - PLACE.feetY) * PLACE.scale;
        const dx = pos.x - ex, dy = pos.y - ey, len = Math.hypot(dx, dy) || 1;
        gx = (34 * dx) / len; gy = (34 * dy) / len;
      }
      return { gx, gy };
    }

    blinkAmount(t) {
      for (const b of this.blinks) {
        const p = t - b;
        if (p >= 0 && p <= 0.17) return Math.sin((p / 0.17) * Math.PI);
      }
      return 0;
    }

    updateEyes(t, pose) {
      const { gx, gy } = this.gaze(t, pose);
      const blink = this.blinkAmount(t);
      const heavy = 0.14 + pose.sly * 0.34 - pose.openEye * 0.14;
      const upper = clamp(Math.max(heavy, blink), 0, 1);
      const lower = clamp(Math.max(pose.sly * 0.12, blink * 0.34), 0, 1);
      ['L', 'R'].forEach((k) => {
        const eye = this.face.eyes[k];
        eye.iris.setAttribute('transform', `translate(${gx.toFixed(1)},${gy.toFixed(1)})`);
        const y = -150 + upper * 300;
        eye.lidTop.setAttribute('d', `M-140,-170 H140 V${y.toFixed(1)} Q0,${(y + 26 * (1 - blink)).toFixed(1)} -140,${y.toFixed(1)} Z`);
        const yb = 150 - lower * 300;
        eye.lidBot.setAttribute('d', `M-140,170 H140 V${yb.toFixed(1)} Q0,${(yb - 16).toFixed(1)} -140,${yb.toFixed(1)} Z`);
        eye.lash.setAttribute('opacity', blink > 0.72 ? 1 : 0);
      });
    }

    updateBrows(t, pose) {
      const e = this.energy(t);
      const talk = 8 * smooth(e) * Math.sin(t * 3.1);
      const brow = (x, dy, tilt, node) => {
        const y = 412 - dy - talk;
        node.setAttribute('d', `M${x - 92},${(y + tilt).toFixed(1)} Q${x},${(y - 26).toFixed(1)} ${x + 92},${(y - tilt).toFixed(1)}`);
      };
      brow(482, pose.browL, 8 + pose.tiltL, this.face.browL);
      brow(818, pose.browR, -8 + pose.tiltR, this.face.browR);
    }

    updateMouth(t, pose) {
      const i = Math.floor(t * this.fps);
      const o = clamp(((this.mouthO[i] || 0) / 100) + pose.hold, 0, 1);
      const c = (this.mouthC[i] || 50) / 100;
      const round = o > 0.05 ? clamp((0.42 - c) * 2.4, 0, 1) : 0;
      const wide = clamp((c - 0.55) * 2, 0, 1) + pose.wide;
      const hw = mix(mix(98, 136, wide), 74, round) + pose.smile * 26;
      const lift = pose.smile * 46 * (1 - 0.55 * o);
      const openUp = 8 + o * 26, openDown = 10 + o * 128 * (1 - 0.1 * wide);
      const closed = o < 0.05;
      const d = closed
        ? `M${-hw},${-lift} Q0,${lift * 0.9 + 12} ${hw},${-lift} Q0,${lift * 0.9 + 22} ${-hw},${-lift} Z`
        : `M${-hw},${-lift} Q0,${-openUp + lift * 0.5} ${hw},${-lift} Q${hw * 0.7},${openDown} 0,${openDown} Q${-hw * 0.7},${openDown} ${-hw},${-lift} Z`;
      this.face.mouth.setAttribute('d', d);
      this.face.clip.setAttribute('d', d);
      this.face.tongue.setAttribute('cx', 0);
      this.face.tongue.setAttribute('cy', openDown + 18);
      this.face.tongue.setAttribute('rx', hw * 0.6);
      this.face.tongue.setAttribute('ry', 34 + o * 40);
      this.face.tongue.setAttribute('opacity', closed ? 0 : 1);
      const teethH = 24 + 16 * o;
      this.face.teeth.setAttribute('x', -hw * 0.56);
      this.face.teeth.setAttribute('y', -openUp - 12 + lift * 0.25);
      this.face.teeth.setAttribute('width', hw * 1.12);
      this.face.teeth.setAttribute('height', teethH);
      this.face.teeth.setAttribute('opacity', closed || o < 0.12 ? 0 : 1);
    }

    updateArm(side, pose) {
      const arm = this.arms[side];
      if (arm.current !== pose.sprite) {
        Object.values(arm.sprites).forEach((c) => { c.style.display = 'none'; });
        arm.sprites[pose.sprite].style.display = 'block';
        arm.current = pose.sprite;
      }
      const sh = SHOULDER[side];
      const mirror = side === 'left' ? -1 : 1;
      const angle = (side === 'left' ? 1 : -1) * pose.a;
      const x = sh.x - ARM_PIVOT.x, y = sh.y - ARM_PIVOT.y - pose.lift;
      arm.holder.style.transform = `translate(${x}px,${y}px) rotate(${angle.toFixed(2)}deg) scale(${mirror * ARM_SCALE},${ARM_SCALE})`;
    }

    /** Pose the whole puppet for time t. */
    update(t) {
      const body = this.bodyPose(t);
      const px = PLACE.x + body.dx, py = PLACE.feet + body.dy;
      this.root.style.transform = `translate(${px.toFixed(2)}px,${py.toFixed(2)}px) rotate(${body.rot.toFixed(3)}deg) scale(${(PLACE.scale * body.sx).toFixed(4)},${(PLACE.scale * body.sy).toFixed(4)}) translate(${-PLACE.centerX}px,${-PLACE.feetY}px)`;
      const shadow = document.getElementById('floorShadow');
      const away = clamp(body.air / 100, 0, 1);
      shadow.style.transform = `translateX(${body.dx.toFixed(1)}px) scale(${(1 - 0.22 * away).toFixed(3)})`;
      shadow.style.opacity = (1 - 0.45 * away).toFixed(3);
      const pose = this.moodPose(t);
      this.updateEyes(t, pose);
      this.updateBrows(t, pose);
      this.updateMouth(t, pose);
      const arms = this.armPose(t);
      this.updateArm('left', arms.left);
      this.updateArm('right', arms.right);
    }
  }

  /** How each feeling sets the face. Numbers are offsets from the resting smile. */
  const MOODS = {
    happy: { smile: 1, browL: 8, browR: 8 },
    wow: { browL: 46, browR: 46, openEye: 1, smile: 0.2, hold: 0.42 },
    sly: { sly: 0.9, smile: 1, browL: -6, browR: 34, tiltL: 6, tiltR: -8 },
    hmm: { browL: 34, browR: -6, smile: 0.1, tiltL: -6, tiltR: 8 },
    oops: { browL: 22, browR: 22, tiltL: -22, tiltR: 22, smile: -0.5 },
    proud: { smile: 1.25, browL: 18, browR: 18, sly: 0.26, wide: 0.5 },
  };

  window.Monster = Monster;
  window.MonsterPlace = PLACE;
})();
