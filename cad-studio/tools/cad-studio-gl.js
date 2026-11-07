/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Preserve the application viewer API through the shared OSHAL STL viewer v1; report an incompatible core explicitly.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | 0.5.0: add CadStudioGl interactive CAD viewport supporting 7-orientation View Cube + Fit to view + touch pinch-to-zoom (RP-CAD-02) and point-to-point, sharp-edge, planar-face, and bounding-box measurement in mm or in (RP-CAD-01), while preserving CadStudioViewer shared v1 compatibility.
 */
(function () {
  'use strict';

  function coreSharedViewer() {
    const shared = window.OSHALStlViewer;
    if (!shared || shared.apiVersion !== 1 || typeof shared.mount !== 'function' || typeof shared.parseStl !== 'function') {
      throw new Error('3D preview requires an updated OSHAL core with the shared STL viewer v1.');
    }
    return shared;
  }

  function parseBinaryStl(view, count) {
    const positions = new Float32Array(count * 9);
    const normals = new Float32Array(count * 9);
    for (let i = 0; i < count; i += 1) {
      const at = 84 + i * 50;
      let nx = view.getFloat32(at, true), ny = view.getFloat32(at + 4, true), nz = view.getFloat32(at + 8, true);
      for (let v = 0; v < 3; v += 1) {
        const o = at + 12 + v * 12;
        positions.set([view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)], i * 9 + v * 3);
      }
      if (Math.hypot(nx, ny, nz) < 1e-6) {
        const n = triNormal(positions, i * 9);
        nx = n[0]; ny = n[1]; nz = n[2];
      }
      for (let v = 0; v < 3; v += 1) normals.set([nx, ny, nz], i * 9 + v * 3);
    }
    if (!positions.every(Number.isFinite) || !normals.every(Number.isFinite)) {
      throw new Error('STL coordinates and normals must be finite numbers.');
    }
    return { positions, normals, triangles: count };
  }

  function triNormal(pos, o) {
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function parseStl(buffer) {
    const raw = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw.byteLength >= 84 && raw.byteLength === 84 + 50 * view.getUint32(80, true)) {
      return parseBinaryStl(view, view.getUint32(80, true));
    }
    const text = new TextDecoder().decode(raw);
    const verts = [];
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) verts.push(Number(m[1]), Number(m[2]), Number(m[3]));
    const count = Math.floor(verts.length / 9);
    const positions = new Float32Array(verts.slice(0, count * 9));
    const normals = new Float32Array(count * 9);
    for (let i = 0; i < count; i += 1) {
      const n = triNormal(positions, i * 9);
      for (let v = 0; v < 3; v += 1) normals.set(n, i * 9 + v * 3);
    }
    if (!positions.every(Number.isFinite)) throw new Error('STL coordinates and normals must be finite numbers.');
    return { positions, normals, triangles: count };
  }

  function convertFromMm(mm, unit) {
    return unit === 'in' ? mm / 25.4 : mm;
  }

  function measureDistance(a, b, unit) {
    const u = unit === 'in' ? 'in' : 'mm';
    const dxMm = Math.abs(b[0] - a[0]), dyMm = Math.abs(b[1] - a[1]), dzMm = Math.abs(b[2] - a[2]);
    const distMm = Math.hypot(dxMm, dyMm, dzMm);
    return {
      mode: 'point',
      unit: u,
      distance: convertFromMm(distMm, u),
      dx: convertFromMm(dxMm, u),
      dy: convertFromMm(dyMm, u),
      dz: convertFromMm(dzMm, u),
      distanceMm: distMm,
      a: a.slice(),
      b: b.slice(),
    };
  }

  function extractFeatureEdges(positions) {
    const verts = [], vMap = new Map(), edgeMap = new Map();
    const vIdx = (x, y, z) => {
      const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      if (vMap.has(k)) return vMap.get(k);
      const id = verts.length; verts.push([x, y, z]); vMap.set(k, id); return id;
    };
    const tris = Math.floor(positions.length / 9);
    for (let t = 0; t < tris; t += 1) {
      const o = t * 9, n = triNormal(positions, o);
      const ids = [
        vIdx(positions[o], positions[o + 1], positions[o + 2]),
        vIdx(positions[o + 3], positions[o + 4], positions[o + 5]),
        vIdx(positions[o + 6], positions[o + 7], positions[o + 8]),
      ];
      for (let e = 0; e < 3; e += 1) {
        const i0 = ids[e], i1 = ids[(e + 1) % 3];
        if (i0 === i1) continue;
        const key = i0 < i1 ? `${i0}:${i1}` : `${i1}:${i0}`;
        let rec = edgeMap.get(key);
        if (!rec) { rec = { a: verts[Math.min(i0, i1)], b: verts[Math.max(i0, i1)], normals: [] }; edgeMap.set(key, rec); }
        rec.normals.push(n);
      }
    }
    const sharp = [];
    for (const rec of edgeMap.values()) {
      const isSharp = rec.normals.length === 1 || (rec.normals[0][0] * rec.normals[1][0] + rec.normals[0][1] * rec.normals[1][1] + rec.normals[0][2] * rec.normals[1][2]) < 0.96;
      if (isSharp) sharp.push({ a: rec.a, b: rec.b });
    }
    return mergeCollinearEdges(sharp);
  }

  function mergeCollinearEdges(rawEdges) {
    const merged = rawEdges.map((e) => ({ a: e.a.slice(), b: e.b.slice(), used: false }));
    const samePt = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-3;
    const dirOf = (p, q) => { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
    const out = [];
    for (let i = 0; i < merged.length; i += 1) {
      if (merged[i].used) continue;
      merged[i].used = true;
      let a = merged[i].a, b = merged[i].b, grew = true;
      while (grew) {
        grew = false;
        const d0 = dirOf(a, b);
        for (let j = 0; j < merged.length; j += 1) {
          if (merged[j].used) continue;
          const e = merged[j], d1 = dirOf(e.a, e.b);
          if (Math.abs(d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]) < 0.9995) continue;
          if (samePt(b, e.a)) { b = e.b; e.used = true; grew = true; }
          else if (samePt(b, e.b)) { b = e.a; e.used = true; grew = true; }
          else if (samePt(a, e.b)) { a = e.a; e.used = true; grew = true; }
          else if (samePt(a, e.a)) { a = e.b; e.used = true; grew = true; }
        }
      }
      out.push({ a, b, lengthMm: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) });
    }
    return out;
  }

  const persp4 = (fov, aspect, near, far) => {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  };
  const tr4 = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const rx4 = (a) => new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
  const rz4 = (a) => new Float32Array([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function mul4(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
    return out;
  }

  function invert4(m) {
    const inv = new Float64Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (Math.abs(det) < 1e-14) return null;
    for (let i = 0; i < 16; i += 1) inv[i] /= det;
    return inv;
  }

  function projectPt(mvp, p, w, h) {
    const cx = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const cy = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (cw <= 1e-5) return null;
    return { x: (cx / cw * 0.5 + 0.5) * w, y: (0.5 - cy / cw * 0.5) * h };
  }

  function raycastPositions(positions, mvp, lx, ly, w, h, snapTolMm) {
    const inv = invert4(mvp);
    if (!inv || !positions || !positions.length) return null;
    const nx = (lx / w) * 2 - 1, ny = 1 - (ly / h) * 2;
    const unproj = (z) => {
      const rw = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15];
      return [(inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12]) / rw, (inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13]) / rw, (inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14]) / rw];
    };
    const orig = unproj(-1), far = unproj(1);
    const dx = far[0] - orig[0], dy = far[1] - orig[1], dz = far[2] - orig[2], dl = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / dl, dy / dl, dz / dl];
    let bestT = Infinity, hit = null, hitTri = -1;
    for (let t = 0; t + 8 < positions.length; t += 9) {
      const ax = positions[t], ay = positions[t + 1], az = positions[t + 2];
      const e1x = positions[t + 3] - ax, e1y = positions[t + 4] - ay, e1z = positions[t + 5] - az;
      const e2x = positions[t + 6] - ax, e2y = positions[t + 7] - ay, e2z = positions[t + 8] - az;
      const hx = dir[1] * e2z - dir[2] * e2y, hy = dir[2] * e2x - dir[0] * e2z, hz = dir[0] * e2y - dir[1] * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-9) continue;
      const f = 1 / det, sx = orig[0] - ax, sy = orig[1] - ay, sz = orig[2] - az;
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = f * (dir[0] * qx + dir[1] * qy + dir[2] * qz);
      if (v < 0 || u + v > 1) continue;
      const dist = f * (e2x * qx + e2y * qy + e2z * qz);
      if (dist > 1e-4 && dist < bestT) {
        bestT = dist; hitTri = t;
        hit = [orig[0] + dir[0] * dist, orig[1] + dir[1] * dist, orig[2] + dir[2] * dist];
      }
    }
    if (!hit) return null;
    for (let k = 0; k < 3; k += 1) {
      const vx = positions[hitTri + k * 3], vy = positions[hitTri + k * 3 + 1], vz = positions[hitTri + k * 3 + 2];
      if (Math.hypot(vx - hit[0], vy - hit[1], vz - hit[2]) <= snapTolMm) { hit = [vx, vy, vz]; break; }
    }
    return { point: hit, normal: triNormal(positions, hitTri) };
  }

  function pickSharpEdge(edges, mvp, lx, ly, w, h) {
    let best = null, bestPx = 18;
    for (const edge of edges) {
      const p0 = projectPt(mvp, edge.a, w, h), p1 = projectPt(mvp, edge.b, w, h);
      if (!p0 || !p1) continue;
      const vx = p1.x - p0.x, vy = p1.y - p0.y, len2 = vx * vx + vy * vy;
      const t = len2 > 1e-4 ? Math.max(0, Math.min(1, ((lx - p0.x) * vx + (ly - p0.y) * vy) / len2)) : 0;
      const d = Math.hypot(lx - (p0.x + vx * t), ly - (p0.y + vy * t));
      if (d < bestPx) { bestPx = d; best = edge; }
    }
    return best;
  }

  function gridLines(size) {
    const step = 10 * Math.max(1, Math.ceil(size * 0.8 / 1000));
    const ticks = Math.ceil(size * 0.8 / step), half = ticks * step, lines = [];
    for (let i = -ticks; i <= ticks; i += 1) {
      const v = i * step;
      lines.push(-half, v, 0, half, v, 0, v, -half, 0, v, half, 0);
    }
    return new Float32Array(lines);
  }

  const VS = 'attribute vec3 p; attribute vec3 n; uniform mat4 mvp; uniform mat4 mv; varying vec3 vn; varying vec3 vp;' +
    'void main(){ gl_Position = mvp * vec4(p,1.0); vn = mat3(mv) * n; vp = (mv * vec4(p,1.0)).xyz; }';
  const FS = 'precision mediump float; uniform vec3 color; uniform float unlit; varying vec3 vn; varying vec3 vp;' +
    'void main(){ if (unlit > 0.5) { gl_FragColor = vec4(color, 1.0); return; } vec3 n = normalize(vn); vec3 l = normalize(-vp);' +
    'float d = max(dot(n, l), 0.0); float f = 0.25 + 0.75 * d; gl_FragColor = vec4(color * f, 1.0); }';

  function initGl(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) throw new Error('WebGL is not available');
    const compile = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const msg = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(msg); }
      return s;
    };
    const prog = gl.createProgram(), vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { const msg = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error(msg); }
    gl.useProgram(prog);
    return {
      gl, prog,
      loc: { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), mvp: gl.getUniformLocation(prog, 'mvp'), mv: gl.getUniformLocation(prog, 'mv'), color: gl.getUniformLocation(prog, 'color'), flat: gl.getUniformLocation(prog, 'unlit') },
      bufs: { p: gl.createBuffer(), n: gl.createBuffer(), grid: gl.createBuffer() },
    };
  }

  function ensureHud(canvas) {
    const parent = canvas.parentElement;
    if (!parent || typeof document === 'undefined') return null;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const hud = document.createElement('canvas');
    hud.className = 'cad-viewer-hud';
    hud.setAttribute('aria-hidden', 'true');
    hud.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    canvas.insertAdjacentElement('afterend', hud);
    return hud;
  }

  function drawHud(hud, state, mvp, w, h) {
    if (!hud) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (hud.width !== pw || hud.height !== ph) { hud.width = pw; hud.height = ph; }
    const ctx = hud.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!state.triangles || state.measureMode === 'off') return;
    const fmtU = (mm) => { const v = convertFromMm(mm, state.unit); return v.toFixed(state.unit === 'in' ? 3 : 2) + ' ' + state.unit; };
    const pill = (x, y, text) => {
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 14;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; ctx.fillRect(x - tw / 2, y - 24, tw, 22);
      ctx.fillStyle = '#38bdf8'; ctx.fillText(text, x - tw / 2 + 7, y - 9);
    };
    if (state.measureMode === 'bbox') {
      const [x0, y0, z0] = state.lo, [x1, y1, z1] = state.hi;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
      for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        const a = projectPt(mvp, c[i], w, h), b = projectPt(mvp, c[j], w, h);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      ctx.setLineDash([]);
      const top = projectPt(mvp, [(x0 + x1) / 2, (y0 + y1) / 2, z1], w, h);
      if (top) pill(top.x, top.y, `${fmtU(x1 - x0)} × ${fmtU(y1 - y0)} × ${fmtU(z1 - z0)}`);
    }
    if (state.selectedEdge) {
      const a = projectPt(mvp, state.selectedEdge.a, w, h), b = projectPt(mvp, state.selectedEdge.b, w, h);
      if (a && b) {
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        pill((a.x + b.x) / 2, (a.y + b.y) / 2, fmtU(state.selectedEdge.lengthMm));
      }
    }
    if (state.pickA) {
      const pa = projectPt(mvp, state.pickA.point, w, h);
      const pb = state.pickB ? projectPt(mvp, state.pickB.point, w, h) : null;
      if (pa && pb) {
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        if (state.measureMode === 'point') pill((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, fmtU(Math.hypot(state.pickB.point[0] - state.pickA.point[0], state.pickB.point[1] - state.pickA.point[1], state.pickB.point[2] - state.pickA.point[2])));
      }
      for (const p of [pa, pb]) if (p) { ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  const VIEW_PRESETS = Object.freeze({
    iso: [-Math.PI / 4, -Math.atan(Math.SQRT2)],
    top: [0, 0],
    bottom: [0, -Math.PI],
    front: [0, -Math.PI / 2],
    back: [Math.PI, -Math.PI / 2],
    left: [Math.PI / 2, -Math.PI / 2],
    right: [-Math.PI / 2, -Math.PI / 2],
  });

  function emitMeasure(state) {
    if (typeof state.onMeasure !== 'function') return;
    const u = state.unit;
    if (state.measureMode === 'off') { state.onMeasure({ mode: 'off', unit: u }); return; }
    if (state.measureMode === 'bbox' && state.triangles) {
      const sx = state.hi[0] - state.lo[0], sy = state.hi[1] - state.lo[1], sz = state.hi[2] - state.lo[2];
      state.onMeasure({ mode: 'bbox', unit: u, sizeX: convertFromMm(sx, u), sizeY: convertFromMm(sy, u), sizeZ: convertFromMm(sz, u), diagonal: convertFromMm(Math.hypot(sx, sy, sz), u) });
      return;
    }
    if (state.measureMode === 'edge') {
      if (!state.selectedEdge) { state.onMeasure({ mode: 'edge', unit: u, pending: 'Click any sharp edge on the part.' }); return; }
      const e = state.selectedEdge;
      state.onMeasure({ ...measureDistance(e.a, e.b, u), mode: 'edge' });
      return;
    }
    if (state.measureMode === 'face') {
      if (!state.pickA) { state.onMeasure({ mode: 'face', unit: u, pending: 'Click the first face on the part.' }); return; }
      if (!state.pickB) { state.onMeasure({ mode: 'face', unit: u, pending: 'First face selected — click a second face.' }); return; }
      const n1 = state.pickA.normal, n2 = state.pickB.normal;
      const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
      const angleDeg = Math.acos(dot) * (180 / Math.PI);
      const parallelOffsetMm = Math.abs(dot) > 0.999 ? Math.abs((state.pickB.point[0] - state.pickA.point[0]) * n1[0] + (state.pickB.point[1] - state.pickA.point[1]) * n1[1] + (state.pickB.point[2] - state.pickA.point[2]) * n1[2]) : null;
      state.onMeasure({ mode: 'face', unit: u, angleDeg, parallelOffset: parallelOffsetMm === null ? null : convertFromMm(parallelOffsetMm, u) });
      return;
    }
    if (!state.pickA) { state.onMeasure({ mode: 'point', unit: u, pending: 'Click the first surface or corner point on the part.' }); return; }
    if (!state.pickB) { state.onMeasure({ mode: 'point', unit: u, pending: 'Point A set — click a second point on the part.' }); return; }
    state.onMeasure(measureDistance(state.pickA.point, state.pickB.point, u));
  }

  function bindControls(canvas, state, invalidate) {
    const listeners = [], pointers = new Map();
    const on = (t, ev, fn, op) => { t.addEventListener(ev, fn, op); listeners.push(() => t.removeEventListener(ev, fn, op)); };
    let drag = null, pinch = 0;
    on(canvas, 'pointerdown', (ev) => {
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture(ev.pointerId);
      if (pointers.size === 2) { const pts = [...pointers.values()]; pinch = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1; drag = null; return; }
      drag = { x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY, pan: ev.shiftKey || ev.button === 2, moved: 0 };
    });
    on(canvas, 'pointermove', (ev) => {
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        const pts = [...pointers.values()], next = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        state.dist = Math.max(1.2, Math.min(12, state.dist * (pinch / next))); pinch = next; invalidate(); return;
      }
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.x = ev.clientX; drag.y = ev.clientY; drag.moved += Math.hypot(dx, dy);
      if (drag.pan) { state.pan[0] += dx * state.radius * 0.004 * state.dist; state.pan[1] -= dy * state.radius * 0.004 * state.dist; }
      else { state.yaw += dx * 0.01; state.pitch = Math.max(-Math.PI, Math.min(0, state.pitch + dy * 0.01)); if (state.activeView) { state.activeView = null; state.onViewChange?.(null); } }
      invalidate();
    });
    on(canvas, 'pointerup', (ev) => {
      pointers.delete(ev.pointerId);
      if (drag && drag.moved < 5 && !drag.pan && state.measureMode !== 'off' && state.measureMode !== 'bbox' && state.lastMvp && state.positions) {
        const rect = canvas.getBoundingClientRect(), lx = ev.clientX - rect.left, ly = ev.clientY - rect.top;
        if (state.measureMode === 'edge') {
          state.selectedEdge = pickSharpEdge(state.edges, state.lastMvp, lx, ly, rect.width || 300, rect.height || 300);
          emitMeasure(state); invalidate();
        } else {
          const hit = raycastPositions(state.positions, state.lastMvp, lx, ly, rect.width || 300, rect.height || 300, state.radius * 0.04);
          if (hit) {
            if (!state.pickA || state.pickB) { state.pickA = hit; state.pickB = null; } else state.pickB = hit;
            emitMeasure(state); invalidate();
          }
        }
      }
      drag = null;
    });
    on(canvas, 'pointercancel', (ev) => { pointers.delete(ev.pointerId); drag = null; });
    on(canvas, 'wheel', (ev) => { ev.preventDefault(); state.dist = Math.max(1.2, Math.min(12, state.dist * (ev.deltaY > 0 ? 1.1 : 0.9))); invalidate(); }, { passive: false });
    on(canvas, 'contextmenu', (ev) => ev.preventDefault());
    on(window, 'resize', invalidate);
    return () => listeners.forEach((fn) => fn());
  }

  function mount(canvas) {
    coreSharedViewer();
    const { gl, prog, loc, bufs } = initGl(canvas);
    const hud = ensureHud(canvas);
    const state = {
      triangles: 0, gridCount: 0, positions: null, edges: [], lo: [0, 0, 0], hi: [0, 0, 0],
      center: [0, 0, 0], radius: 50, yaw: -0.6, pitch: -1.1, dist: 3, pan: [0, 0], activeView: 'iso',
      measureMode: 'off', unit: 'mm', pickA: null, pickB: null, selectedEdge: null,
      onMeasure: null, onViewChange: null, lastMvp: null, dirty: false, frame: 0, disposed: false,
    };

    function draw() {
      state.frame = 0; state.dirty = false;
      if (state.disposed) return;
      const w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
      if (canvas.width !== w * devicePixelRatio || canvas.height !== h * devicePixelRatio) { canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.enable(gl.DEPTH_TEST); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const style = getComputedStyle(canvas);
      const parseC = (css, fb) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || ''); return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : fb; };
      const mv = mul4(tr4(state.pan[0], state.pan[1], -state.radius * state.dist), mul4(rx4(state.pitch), mul4(rz4(state.yaw), tr4(-state.center[0], -state.center[1], -state.center[2]))));
      const mvp = mul4(persp4(0.8, w / h, state.radius * 0.05, state.radius * 40), mv);
      state.lastMvp = mvp;
      gl.uniformMatrix4fv(loc.mvp, false, mvp); gl.uniformMatrix4fv(loc.mv, false, mv);
      if (state.gridCount) {
        gl.uniform1f(loc.flat, 1); gl.uniform3fv(loc.color, parseC(style.borderColor, [0.5, 0.5, 0.5]));
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.grid); gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(loc.n); gl.vertexAttrib3f(loc.n, 0, 0, 1); gl.drawArrays(gl.LINES, 0, state.gridCount);
      }
      if (state.triangles) {
        gl.uniform1f(loc.flat, 0); gl.uniform3fv(loc.color, parseC(style.color, [0.55, 0.7, 0.95]));
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.p); gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.n); gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, state.triangles * 3);
      }
      drawHud(hud, state, mvp, w, h);
    }

    function invalidate() { if (!state.dirty && !state.disposed) { state.dirty = true; state.frame = requestAnimationFrame(draw); } }

    function load(buffer) {
      if (state.disposed) throw new Error('The 3D viewer has been disposed.');
      const mesh = parseStl(buffer);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < mesh.positions.length; i += 3) for (let a = 0; a < 3; a += 1) { lo[a] = Math.min(lo[a], mesh.positions[i + a]); hi[a] = Math.max(hi[a], mesh.positions[i + a]); }
      state.lo = mesh.triangles ? lo : [0, 0, 0]; state.hi = mesh.triangles ? hi : [0, 0, 0];
      state.center = mesh.triangles ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
      state.radius = mesh.triangles ? Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) : 50;
      state.triangles = mesh.triangles; state.positions = mesh.positions;
      state.edges = mesh.triangles <= 25000 ? extractFeatureEdges(mesh.positions) : [];
      state.pickA = null; state.pickB = null; state.selectedEdge = null;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.p); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.n); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      const grid = gridLines(state.radius * 2);
      state.gridCount = grid.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.grid); gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
      state.dist = 3; state.pan = [0, 0];
      emitMeasure(state); invalidate();
      return { triangles: mesh.triangles, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
    }

    function clear() { state.triangles = 0; state.gridCount = 0; state.positions = null; state.edges = []; state.pickA = null; state.pickB = null; state.selectedEdge = null; invalidate(); }
    function setView(name) { const v = VIEW_PRESETS[name]; if (!v) return; state.yaw = v[0]; state.pitch = v[1]; state.pan = [0, 0]; state.activeView = name; state.onViewChange?.(name); invalidate(); }
    function fitToView() { state.dist = 2.8; state.pan = [0, 0]; invalidate(); }
    function setMeasureMode(mode) { state.measureMode = mode || 'off'; state.pickA = null; state.pickB = null; state.selectedEdge = null; canvas.style.cursor = state.measureMode !== 'off' && state.measureMode !== 'bbox' ? 'crosshair' : ''; emitMeasure(state); invalidate(); }
    function setUnit(unit) { state.unit = unit === 'in' ? 'in' : 'mm'; emitMeasure(state); invalidate(); }
    function clearMeasure() { state.pickA = null; state.pickB = null; state.selectedEdge = null; emitMeasure(state); invalidate(); }
    function setCallbacks(cb) { if (cb.onMeasure !== undefined) state.onMeasure = cb.onMeasure; if (cb.onViewChange !== undefined) state.onViewChange = cb.onViewChange; }
    const unbind = bindControls(canvas, state, invalidate);
    function dispose() {
      if (state.disposed) return;
      state.disposed = true; cancelAnimationFrame(state.frame); unbind(); hud?.remove();
      Object.values(bufs).forEach((b) => gl.deleteBuffer(b));
      gl.deleteProgram(prog); gl.useProgram(null); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    invalidate();
    return { load, clear, resize: invalidate, parseStl, dispose, setView, fitToView, setMeasureMode, setUnit, clearMeasure, setCallbacks };
  }

  window.CadStudioViewer = {
    mount: (canvas) => coreSharedViewer().mount(canvas),
    parseStl: (buffer) => coreSharedViewer().parseStl(buffer),
  };
  window.CadStudioGl = { mount, parseStl, convertFromMm, measureDistance, extractFeatureEdges };
})();
