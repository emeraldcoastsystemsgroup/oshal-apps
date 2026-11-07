/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Preserve the application viewer API through the shared OSHAL STL viewer v1; report an incompatible core explicitly.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.0: self-contained WebGL + 2D HUD STL viewer supporting interactive 3D bounding-box crop handles and live shader clipping (RP-SCN-01), live rotation/lay-flat preview on a Z=0 bed grid (RP-SCN-02), and raycast surface point-to-point measurement (RP-SCN-03).
 */
(function () {
  'use strict';

  function parseBinaryStl(view, n) {
    const positions = new Float32Array(n * 9);
    const normals = new Float32Array(n * 9);
    for (let i = 0; i < n; i += 1) {
      const at = 84 + i * 50;
      let nx = view.getFloat32(at, true), ny = view.getFloat32(at + 4, true), nz = view.getFloat32(at + 8, true);
      for (let v = 0; v < 3; v += 1) {
        const o = at + 12 + v * 12;
        positions[i * 9 + v * 3] = view.getFloat32(o, true);
        positions[i * 9 + v * 3 + 1] = view.getFloat32(o + 4, true);
        positions[i * 9 + v * 3 + 2] = view.getFloat32(o + 8, true);
      }
      if (Math.hypot(nx, ny, nz) < 1e-6) {
        const ux = positions[i * 9 + 3] - positions[i * 9], uy = positions[i * 9 + 4] - positions[i * 9 + 1], uz = positions[i * 9 + 5] - positions[i * 9 + 2];
        const vx = positions[i * 9 + 6] - positions[i * 9], vy = positions[i * 9 + 7] - positions[i * 9 + 1], vz = positions[i * 9 + 8] - positions[i * 9 + 2];
        nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
      }
      for (let v = 0; v < 3; v += 1) normals.set([nx, ny, nz], i * 9 + v * 3);
    }
    if (!positions.every(Number.isFinite) || !normals.every(Number.isFinite)) throw new Error('STL coordinates must be finite numbers.');
    return { positions, normals, triangles: n };
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
    const n = Math.floor(verts.length / 9);
    const positions = new Float32Array(verts.slice(0, n * 9));
    const normals = new Float32Array(n * 9);
    for (let i = 0; i < n; i += 1) {
      const a = i * 9, b = a + 3, c = a + 6;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      for (let v = 0; v < 3; v += 1) normals.set([nx / len, ny / len, nz / len], a + v * 3);
    }
    if (!positions.every(Number.isFinite)) throw new Error('STL coordinates must be finite numbers.');
    return { positions, normals, triangles: n };
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function mul4(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
    return out;
  }

  const tr4 = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const rx4 = (a) => new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
  const ry4 = (a) => new Float32Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
  const rz4 = (a) => new Float32Array([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  function invert4(m) {
    const inv = new Float32Array(16);
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
    if (Math.abs(det) < 1e-12) return null;
    for (let i = 0; i < 16; i += 1) inv[i] /= det;
    return inv;
  }

  function projectPoint(mvp, p, w, h) {
    const cx = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const cy = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const cz = mvp[2] * p[0] + mvp[6] * p[1] + mvp[10] * p[2] + mvp[14];
    const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (cw <= 1e-5) return null;
    return { x: ((cx / cw) * 0.5 + 0.5) * w, y: (0.5 - (cy / cw) * 0.5) * h, z: cz / cw };
  }

  function unprojectRay(mvp, px, py, w, h) {
    const inv = invert4(mvp);
    if (!inv) return null;
    const nx = (px / w) * 2 - 1, ny = 1 - (py / h) * 2;
    const unp = (nz) => {
      const x = inv[0] * nx + inv[4] * ny + inv[8] * nz + inv[12];
      const y = inv[1] * nx + inv[5] * ny + inv[9] * nz + inv[13];
      const z = inv[2] * nx + inv[6] * ny + inv[10] * nz + inv[14];
      const rw = inv[3] * nx + inv[7] * ny + inv[11] * nz + inv[15] || 1;
      return [x / rw, y / rw, z / rw];
    };
    const near = unp(-1), far = unp(1);
    const dx = far[0] - near[0], dy = far[1] - near[1], dz = far[2] - near[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return { origin: near, dir: [dx / len, dy / len, dz / len] };
  }

  function raycastPositions(positions, triangles, origin, dir) {
    let bestT = Infinity, bestPoint = null;
    for (let i = 0; i < triangles; i += 1) {
      const b = i * 9;
      const ax = positions[b], ay = positions[b + 1], az = positions[b + 2];
      const e1x = positions[b + 3] - ax, e1y = positions[b + 4] - ay, e1z = positions[b + 5] - az;
      const e2x = positions[b + 6] - ax, e2y = positions[b + 7] - ay, e2z = positions[b + 8] - az;
      const px = dir[1] * e2z - dir[2] * e2y, py = dir[2] * e2x - dir[0] * e2z, pz = dir[0] * e2y - dir[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-8) continue;
      const inv = 1 / det;
      const tx = origin[0] - ax, ty = origin[1] - ay, tz = origin[2] - az;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-5 && t < bestT) {
        bestT = t;
        bestPoint = { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, z: origin[2] + dir[2] * t };
      }
    }
    return bestPoint;
  }

  function gridLines(size, zPlane) {
    const step = 10 * Math.max(1, Math.ceil(size * 0.8 / 1000));
    const ticks = Math.ceil(size * 0.8 / step), half = ticks * step;
    const lines = [];
    for (let i = -ticks; i <= ticks; i += 1) {
      const v = i * step;
      lines.push(-half, v, zPlane, half, v, zPlane, v, -half, zPlane, v, half, zPlane);
    }
    return new Float32Array(lines);
  }

  function parseColor(css, fallback) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || '');
    return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : fallback;
  }

  const VS = 'attribute vec3 p; attribute vec3 n; uniform mat4 mvp; uniform mat4 mv; uniform mat4 model;' +
    'varying vec3 vn; varying vec3 vp; varying vec3 vw;' +
    'void main(){ vec4 wp = model * vec4(p, 1.0); vw = wp.xyz; gl_Position = mvp * wp; vn = mat3(mv) * mat3(model) * n; vp = (mv * wp).xyz; }';
  const FS = 'precision mediump float; uniform vec3 color; uniform float unlit; uniform float cropOn; uniform vec3 cropMin; uniform vec3 cropMax;' +
    'varying vec3 vn; varying vec3 vp; varying vec3 vw;' +
    'void main(){ if (unlit > 0.5) { gl_FragColor = vec4(color, 1.0); return; }' +
    'if (cropOn > 0.5 && (vw.x < cropMin.x || vw.x > cropMax.x || vw.y < cropMin.y || vw.y > cropMax.y || vw.z < cropMin.z || vw.z > cropMax.z)) discard;' +
    'vec3 n = normalize(vn); vec3 l = normalize(-vp); float d = abs(dot(n, l)); gl_FragColor = vec4(color * (0.28 + 0.72 * d), 1.0); }';

  function createGlContext(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const msg = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(msg); }
      return s;
    };
    const prog = gl.createProgram();
    const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    return {
      gl, prog,
      loc: {
        p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'),
        mvp: gl.getUniformLocation(prog, 'mvp'), mv: gl.getUniformLocation(prog, 'mv'), model: gl.getUniformLocation(prog, 'model'),
        color: gl.getUniformLocation(prog, 'color'), flat: gl.getUniformLocation(prog, 'unlit'),
        cropOn: gl.getUniformLocation(prog, 'cropOn'), cropMin: gl.getUniformLocation(prog, 'cropMin'), cropMax: gl.getUniformLocation(prog, 'cropMax'),
      },
      bufs: { p: gl.createBuffer(), n: gl.createBuffer(), grid: gl.createBuffer() },
    };
  }

  function cropHandlesOf(b) {
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
    return [
      { key: 'minX', axis: 0, pos: [b.minX, cy, cz], color: '#ef4444' },
      { key: 'maxX', axis: 0, pos: [b.maxX, cy, cz], color: '#ef4444' },
      { key: 'minY', axis: 1, pos: [cx, b.minY, cz], color: '#22c55e' },
      { key: 'maxY', axis: 1, pos: [cx, b.maxY, cz], color: '#22c55e' },
      { key: 'minZ', axis: 2, pos: [cx, cy, b.minZ], color: '#3b82f6' },
      { key: 'maxZ', axis: 2, pos: [cx, cy, b.maxZ], color: '#3b82f6' },
    ];
  }

  function drawCropHud(ctx, state, mvp, w, h) {
    const b = state.cropBox;
    const corners = [
      [b.minX, b.minY, b.minZ], [b.maxX, b.minY, b.minZ], [b.maxX, b.maxY, b.minZ], [b.minX, b.maxY, b.minZ],
      [b.minX, b.minY, b.maxZ], [b.maxX, b.minY, b.maxZ], [b.maxX, b.maxY, b.maxZ], [b.minX, b.maxY, b.maxZ],
    ].map((c) => projectPoint(mvp, c, w, h));
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const [i, j] of edges) if (corners[i] && corners[j]) { ctx.moveTo(corners[i].x, corners[i].y); ctx.lineTo(corners[j].x, corners[j].y); }
    ctx.stroke(); ctx.setLineDash([]);
    state.projectedHandles = [];
    for (const hnd of cropHandlesOf(b)) {
      const pt = projectPoint(mvp, hnd.pos, w, h);
      if (!pt) continue;
      state.projectedHandles.push({ ...hnd, sx: pt.x, sy: pt.y });
      ctx.fillStyle = hnd.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawMeasureHud(ctx, state, mvp, w, h) {
    const pa = projectPoint(mvp, [state.measureA.x, state.measureA.y, state.measureA.z], w, h);
    const pb = state.measureB ? projectPoint(mvp, [state.measureB.x, state.measureB.y, state.measureB.z], w, h) : null;
    if (pa && pb) {
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 - 12;
      const dist = Math.hypot(state.measureB.x - state.measureA.x, state.measureB.y - state.measureA.y, state.measureB.z - state.measureA.z);
      const label = dist.toFixed(2) + ' mm';
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(15, 18, 25, 0.9)'; ctx.fillRect(mx - tw / 2, my - 11, tw, 22);
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1; ctx.strokeRect(mx - tw / 2, my - 11, tw, 22);
      ctx.fillStyle = '#fef08a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, mx, my);
    }
    for (const [pt, tag] of [[pa, 'A'], [pb, 'B']]) {
      if (!pt) continue;
      ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tag, pt.x, pt.y);
    }
  }

  function drawHud(hud, state, mvp, w, h) {
    if (!hud) return;
    const dpr = window.devicePixelRatio || 1;
    if (hud.width !== Math.round(w * dpr) || hud.height !== Math.round(h * dpr)) {
      hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
    }
    const ctx = hud.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state.cropBox && state.triangles) drawCropHud(ctx, state, mvp, w, h);
    else state.projectedHandles = [];
    if (state.measureA && state.triangles) drawMeasureHud(ctx, state, mvp, w, h);
  }

  function buildModelMatrix(state) {
    const p = state.preview;
    if (!p || (!p.rxDeg && !p.ryDeg && !p.rzDeg)) return tr4(0, 0, 0);
    const c = state.center;
    const r = mul4(rz4((p.rzDeg || 0) * Math.PI / 180), mul4(ry4((p.ryDeg || 0) * Math.PI / 180), rx4((p.rxDeg || 0) * Math.PI / 180)));
    return mul4(tr4(c[0], c[1], c[2]), mul4(r, tr4(-c[0], -c[1], -c[2])));
  }

  function mount(canvas, opts) {
    const options = opts || {};
    const gpu = createGlContext(canvas);
    let hud = null;
    if (canvas.parentElement && typeof document !== 'undefined') {
      hud = canvas.parentElement.querySelector('.stp-viewer-hud');
      if (!hud) {
        hud = document.createElement('canvas');
        hud.className = 'stp-viewer-hud';
        hud.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;';
        canvas.parentElement.appendChild(hud);
      }
    }

    const state = {
      positions: null, normals: null, triangles: 0, gridCount: 0,
      min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 50,
      yaw: -0.6, pitch: -1.1, dist: 3, pan: [0, 0],
      tool: 'orbit', cropBox: null, preview: null, projectedHandles: [],
      measureA: null, measureB: null, lastMvp: null,
      onMeasure: options.onMeasure || null, onCropChange: options.onCropChange || null,
      dirty: false, frame: 0, disposed: false,
    };

    function renderFrame() {
      state.frame = 0; state.dirty = false;
      if (state.disposed) return;
      const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
      const dpr = window.devicePixelRatio || 1;
      const mv = mul4(tr4(state.pan[0], state.pan[1], -state.radius * state.dist), mul4(rx4(state.pitch), mul4(rz4(state.yaw), tr4(-state.center[0], -state.center[1], -state.center[2]))));
      const mvp = mul4(perspective(0.8, w / h, Math.max(0.1, state.radius * 0.04), state.radius * 40), mv);
      state.lastMvp = mvp;

      if (gpu) {
        const { gl, loc, bufs } = gpu;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(gpu.prog);
        const style = getComputedStyle(canvas);
        const part = parseColor(style.color, [0.31, 0.55, 1.0]);
        const line = parseColor(style.borderColor, [0.45, 0.48, 0.54]);
        gl.uniformMatrix4fv(loc.mvp, false, mvp);
        gl.uniformMatrix4fv(loc.mv, false, mv);
        if (state.gridCount) {
          gl.uniformMatrix4fv(loc.model, false, tr4(0, 0, 0));
          gl.uniform1f(loc.flat, 1); gl.uniform1f(loc.cropOn, 0); gl.uniform3fv(loc.color, line);
          gl.bindBuffer(gl.ARRAY_BUFFER, bufs.grid); gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 0, 0);
          gl.disableVertexAttribArray(loc.n); gl.vertexAttrib3f(loc.n, 0, 0, 1);
          gl.drawArrays(gl.LINES, 0, state.gridCount);
        }
        if (state.triangles) {
          gl.uniformMatrix4fv(loc.model, false, buildModelMatrix(state));
          gl.uniform1f(loc.flat, 0); gl.uniform3fv(loc.color, part);
          if (state.cropBox) {
            gl.uniform1f(loc.cropOn, 1);
            gl.uniform3f(loc.cropMin, state.cropBox.minX, state.cropBox.minY, state.cropBox.minZ);
            gl.uniform3f(loc.cropMax, state.cropBox.maxX, state.cropBox.maxY, state.cropBox.maxZ);
          } else {
            gl.uniform1f(loc.cropOn, 0);
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, bufs.p); gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, bufs.n); gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.TRIANGLES, 0, state.triangles * 3);
        }
      }
      drawHud(hud, state, mvp, w, h);
    }

    function invalidate() {
      if (!state.dirty && !state.disposed) {
        state.dirty = true;
        state.frame = requestAnimationFrame(renderFrame);
      }
    }

    const pointers = new Map();
    let drag = null, pinchDist = 0;
    const listeners = [];
    const on = (el, ev, fn, op) => { el.addEventListener(ev, fn, op); listeners.push(() => el.removeEventListener(ev, fn, op)); };

    on(canvas, 'pointerdown', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const lx = ev.clientX - rect.left, ly = ev.clientY - rect.top;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture(ev.pointerId);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        drag = null; return;
      }
      if (state.cropBox && state.projectedHandles.length) {
        const hit = state.projectedHandles.find((h) => Math.hypot(h.sx - lx, h.sy - ly) <= 14);
        if (hit) { drag = { kind: 'crop', handle: hit, startX: lx, startY: ly, startVal: state.cropBox[hit.key] }; return; }
      }
      drag = { kind: ev.shiftKey || ev.button === 2 ? 'pan' : 'orbit', x: ev.clientX, y: ev.clientY, startX: lx, startY: ly, moved: 0 };
    });

    on(canvas, 'pointermove', (ev) => {
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const nextDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        state.dist = Math.max(1.1, Math.min(14, state.dist * (pinchDist / nextDist)));
        pinchDist = nextDist; invalidate(); return;
      }
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      if (drag.kind === 'crop' && state.cropBox && state.lastMvp) {
        const lx = ev.clientX - rect.left, ly = ev.clientY - rect.top;
        const stepVec = [drag.handle.pos[0] + (drag.handle.axis === 0 ? 1 : 0), drag.handle.pos[1] + (drag.handle.axis === 1 ? 1 : 0), drag.handle.pos[2] + (drag.handle.axis === 2 ? 1 : 0)];
        const p0 = projectPoint(state.lastMvp, drag.handle.pos, rect.width, rect.height);
        const p1 = projectPoint(state.lastMvp, stepVec, rect.width, rect.height);
        if (p0 && p1) {
          const ax = p1.x - p0.x, ay = p1.y - p0.y, alen2 = ax * ax + ay * ay;
          if (alen2 > 1e-4) {
            const deltaMm = ((lx - drag.startX) * ax + (ly - drag.startY) * ay) / alen2;
            const next = { ...state.cropBox, [drag.handle.key]: drag.startVal + deltaMm };
            if (next.minX < next.maxX - 0.5 && next.minY < next.maxY - 0.5 && next.minZ < next.maxZ - 0.5) {
              state.cropBox = next;
              if (state.onCropChange) state.onCropChange({ ...state.cropBox });
              invalidate();
            }
          }
        }
        return;
      }
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.moved += Math.hypot(dx, dy); drag.x = ev.clientX; drag.y = ev.clientY;
      if (drag.kind === 'pan') {
        state.pan[0] += dx * state.radius * 0.004 * state.dist;
        state.pan[1] -= dy * state.radius * 0.004 * state.dist;
      } else {
        state.yaw += dx * 0.01;
        state.pitch = Math.max(-Math.PI, Math.min(0, state.pitch + dy * 0.01));
      }
      invalidate();
    });

    const endPointer = (ev) => {
      pointers.delete(ev.pointerId);
      if (drag && drag.kind === 'orbit' && drag.moved < 5 && state.tool === 'measure' && state.positions && state.lastMvp) {
        const rect = canvas.getBoundingClientRect();
        const ray = unprojectRay(state.lastMvp, ev.clientX - rect.left, ev.clientY - rect.top, rect.width || 320, rect.height || 320);
        const hit = ray ? raycastPositions(state.positions, state.triangles, ray.origin, ray.dir) : null;
        if (hit) {
          if (!state.measureA || state.measureB) { state.measureA = hit; state.measureB = null; }
          else state.measureB = hit;
          if (state.onMeasure) state.onMeasure(measurementPayload(state.measureA, state.measureB));
          invalidate();
        }
      }
      if (pointers.size === 0) drag = null;
    };
    on(canvas, 'pointerup', endPointer);
    on(canvas, 'pointercancel', (ev) => { pointers.delete(ev.pointerId); drag = null; });
    on(canvas, 'wheel', (ev) => { ev.preventDefault(); state.dist = Math.max(1.1, Math.min(14, state.dist * (ev.deltaY > 0 ? 1.1 : 0.9))); invalidate(); }, { passive: false });
    on(canvas, 'contextmenu', (ev) => ev.preventDefault());
    on(window, 'resize', invalidate);

    function measurementPayload(a, b) {
      if (!a) return { a: null, b: null, distanceMm: 0, deltaMm: { x: 0, y: 0, z: 0 }, absDeltaMm: { x: 0, y: 0, z: 0 } };
      if (!b) return { a, b: null, distanceMm: 0, deltaMm: { x: 0, y: 0, z: 0 }, absDeltaMm: { x: 0, y: 0, z: 0 } };
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      return { a, b, distanceMm: Math.hypot(dx, dy, dz), deltaMm: { x: dx, y: dy, z: dz }, absDeltaMm: { x: Math.abs(dx), y: Math.abs(dy), z: Math.abs(dz) } };
    }

    function load(buffer) {
      if (state.disposed) throw new Error('The 3D viewer has been disposed.');
      const mesh = parseStl(buffer);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < mesh.positions.length; i += 3) for (let a = 0; a < 3; a += 1) {
        lo[a] = Math.min(lo[a], mesh.positions[i + a]); hi[a] = Math.max(hi[a], mesh.positions[i + a]);
      }
      state.positions = mesh.positions; state.normals = mesh.normals; state.triangles = mesh.triangles;
      state.min = mesh.triangles ? lo : [0, 0, 0];
      state.max = mesh.triangles ? hi : [0, 0, 0];
      state.center = mesh.triangles ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
      state.radius = mesh.triangles ? Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) : 50;
      state.preview = null;
      if (gpu) {
        const { gl, bufs } = gpu;
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.p); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.n); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
        const grid = gridLines(state.radius * 2, mesh.triangles ? Math.min(0, lo[2]) : 0);
        state.gridCount = grid.length / 3;
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.grid); gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
      }
      state.dist = 3; state.pan = [0, 0];
      invalidate();
      return { triangles: mesh.triangles, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], min: [...state.min], max: [...state.max] };
    }

    function clear() {
      state.triangles = 0; state.gridCount = 0; state.positions = null;
      state.cropBox = null; state.preview = null; state.measureA = null; state.measureB = null;
      invalidate();
    }

    function fitToView() { state.dist = 2.8; state.pan = [0, 0]; invalidate(); }
    function setView(preset) {
      const views = { iso: [-0.6, -1.1], top: [0, 0], bottom: [0, -Math.PI], front: [0, -Math.PI / 2], back: [Math.PI, -Math.PI / 2], left: [Math.PI / 2, -Math.PI / 2], right: [-Math.PI / 2, -Math.PI / 2] };
      const v = views[preset] || views.iso;
      state.yaw = v[0]; state.pitch = v[1]; state.pan = [0, 0]; invalidate();
    }
    function setTool(tool) { state.tool = tool || 'orbit'; canvas.style.cursor = state.tool === 'measure' ? 'crosshair' : ''; invalidate(); }
    function setCropBox(box) { state.cropBox = box ? { ...box } : null; invalidate(); }
    function getBounds() { return { minX: state.min[0], maxX: state.max[0], minY: state.min[1], maxY: state.max[1], minZ: state.min[2], maxZ: state.max[2] }; }
    function setPreviewTransform(spec) { state.preview = spec ? { ...spec } : null; invalidate(); }
    function clearMeasure() { state.measureA = null; state.measureB = null; if (state.onMeasure) state.onMeasure(measurementPayload(null, null)); invalidate(); }
    function setCallbacks(cb) { if (cb.onMeasure !== undefined) state.onMeasure = cb.onMeasure; if (cb.onCropChange !== undefined) state.onCropChange = cb.onCropChange; }
    function dispose() {
      if (state.disposed) return;
      state.disposed = true; cancelAnimationFrame(state.frame); listeners.forEach((fn) => fn());
      if (hud) hud.remove();
      if (gpu) {
        Object.values(gpu.bufs).forEach((b) => gpu.gl.deleteBuffer(b));
        gpu.gl.deleteProgram(gpu.prog);
      }
    }

    invalidate();
    return {
      load, clear, resize: invalidate, parseStl, dispose,
      fitToView, setView, setTool, setCropBox, getBounds, setPreviewTransform, clearMeasure, setCallbacks,
    };
  }

  function mountStlViewer(hostOrCanvas, buffer, opts) {
    let canvas = hostOrCanvas;
    if (hostOrCanvas && hostOrCanvas.tagName !== 'CANVAS') {
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;color:#4f8cff;border-color:#64748b;';
      hostOrCanvas.replaceChildren(canvas);
    }
    const inst = mount(canvas, opts);
    if (buffer) inst.load(buffer);
    return inst;
  }

  function coreSharedViewer() {
    const shared = window.OSHALStlViewer;
    if (!shared || shared.apiVersion !== 1 || typeof shared.mount !== 'function' || typeof shared.parseStl !== 'function') {
      throw new Error('3D preview requires an updated OSHAL core with the shared STL viewer v1.');
    }
    return shared;
  }

  window.ScanToPrintViewer = {
    mount: (canvas) => coreSharedViewer().mount(canvas),
    parseStl: (buffer) => coreSharedViewer().parseStl(buffer),
  };
  window.ScanToPrintGl = { mount, mountStlViewer, parseStl };
})();
