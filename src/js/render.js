import { COURT, BALL, PLAYER } from './shared/constants.js';

const CAM = { eyeX: -1.35, eyeY: 10.6, eyeZ: 14.3, lookY: 1.05 };

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.W = 0;
    this.H = 0;
    this.bg = null;
    this.fx = [];
    this.shake = 0;
    this.trail = [];
    this.time = 0;
    this.flash = 0;
    this.landing = null;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(240, rect.height || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.W = w;
    this.H = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cx = w / 2;
    this.cy = h * 0.485;

    const eye = [CAM.eyeX, CAM.eyeY, CAM.eyeZ];
    const look = [0, CAM.lookY, 0];
    let fx = look[0] - eye[0];
    let fy = look[1] - eye[1];
    let fz = look[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    this.fwd = [fx, fy, fz];
    const rx = -fz;
    const rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    this.right = [rx / rl, 0, rz / rl];
    const R = this.right;
    this.up = [
      R[1] * fz - R[2] * fy,
      R[2] * fx - R[0] * fz,
      R[0] * fy - R[1] * fx,
    ];
    this.eye = eye;

    const c1 = this.rawProject(COURT.HALF_LENGTH, 0, COURT.HALF_WIDTH);
    const c2 = this.rawProject(-COURT.HALF_LENGTH, 0, COURT.HALF_WIDTH);
    const halfSpan = Math.max(Math.abs(c1.vx / c1.d), Math.abs(c2.vx / c2.d), 0.001);
    this.focal = (w * 0.452) / halfSpan;

    const t1 = this.rawProject(0, 0, -COURT.HALF_WIDTH - 1.0);
    const t2 = this.rawProject(0, 0, COURT.HALF_WIDTH + 1.0);
    let yTop = -t1.vy * (this.focal / t1.d);
    let yBot = -t2.vy * (this.focal / t2.d);
    const maxH = h * 0.665;
    if (yBot - yTop > maxH) {
      this.focal *= maxH / (yBot - yTop);
      yTop = -t1.vy * (this.focal / t1.d);
      yBot = -t2.vy * (this.focal / t2.d);
    }
    this.cy = h * 0.585 - (yTop + yBot) / 2;

    this.buildBackground();
  }

  rawProject(x, y, z) {
    const ex = x - this.eye[0];
    const ey = y - this.eye[1];
    const ez = z - this.eye[2];
    const vx = ex * this.right[0] + ey * this.right[1] + ez * this.right[2];
    const vy = ex * this.up[0] + ey * this.up[1] + ez * this.up[2];
    const vz = ex * this.fwd[0] + ey * this.fwd[1] + ez * this.fwd[2];
    const d = Math.max(0.35, vz);
    return { vx, vy, d };
  }

  project(x, y, z) {
    const p = this.rawProject(x, y, z);
    const k = this.focal / p.d;
    return {
      x: this.cx + p.vx * k,
      y: this.cy - p.vy * k,
      s: k,
      d: p.d,
    };
  }

  buildBackground() {
    const w = this.W, h = this.H;
    const c = document.createElement('canvas');
    c.width = Math.round(w * this.dpr);
    c.height = Math.round(h * this.dpr);
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const floorY = this.project(0, 0, -COURT.HALF_WIDTH).y;
    const wallBot = Math.min(floorY - h * 0.03, h * 0.62);

    const wall = g.createLinearGradient(0, 0, 0, wallBot);
    wall.addColorStop(0, '#03060c');
    wall.addColorStop(0.35, '#060f1a');
    wall.addColorStop(0.72, '#0b1a29');
    wall.addColorStop(1, '#13263a');
    g.fillStyle = wall;
    g.fillRect(0, 0, w, wallBot + 2);

    const rnd = mulberry(20261025);
    const seatTop = h * 0.045;
    const seatBot = wallBot - h * 0.135;

    const baseG = g.createLinearGradient(0, seatTop, 0, seatBot);
    baseG.addColorStop(0, 'rgba(9, 16, 27, 0.94)');
    baseG.addColorStop(0.55, 'rgba(15, 27, 42, 0.9)');
    baseG.addColorStop(1, 'rgba(23, 39, 58, 0.84)');
    g.fillStyle = baseG;
    g.fillRect(0, seatTop, w, seatBot - seatTop);

    g.strokeStyle = 'rgba(96, 140, 186, 0.05)';
    g.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const yy = seatTop + (seatBot - seatTop) * Math.pow(i / 7, 1.3);
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(w, yy);
      g.stroke();
    }

    g.save();
    g.filter = `blur(${Math.max(1, h * 0.0022).toFixed(2)}px)`;
    const unit = Math.max(1.8, Math.min(3.8, w / 480));
    const total = Math.round(w * 0.55);
    for (let i = 0; i < total; i++) {
      const px = rnd() * w;
      const py = seatTop + rnd() * (seatBot - seatTop);
      const depth = (py - seatTop) / Math.max(1, seatBot - seatTop);
      const k = (0.72 + depth * 0.75) * (0.76 + rnd() * 0.55);
      const bw = unit * k * 1.15;
      const bh = unit * k * 2.25;
      const tint = rnd();
      const col = tint > 0.93 ? '255, 186, 138'
        : tint > 0.85 ? '128, 214, 232'
          : tint > 0.7 ? '150, 176, 214'
            : tint > 0.4 ? '188, 200, 218' : '86, 100, 124';
      g.fillStyle = `rgba(${col}, ${0.055 + depth * 0.19 + rnd() * 0.09})`;
      rr(g, px, py - bh, bw, bh, bw * 0.45);
      g.fill();
      g.beginPath();
      g.arc(px + bw / 2, py - bh - bw * 0.36, bw * 0.42, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    const fade = g.createLinearGradient(0, seatTop, 0, seatBot);
    fade.addColorStop(0, 'rgba(4, 9, 16, 0.88)');
    fade.addColorStop(0.45, 'rgba(4, 9, 16, 0.35)');
    fade.addColorStop(1, 'rgba(4, 9, 16, 0.06)');
    g.fillStyle = fade;
    g.fillRect(0, seatTop, w, seatBot - seatTop);

    const trussY = h * 0.05;
    g.strokeStyle = 'rgba(96, 140, 184, 0.15)';
    g.lineWidth = Math.max(1, h * 0.0016);
    g.beginPath();
    g.moveTo(0, trussY); g.lineTo(w, trussY);
    g.moveTo(0, trussY + h * 0.013); g.lineTo(w, trussY + h * 0.013);
    g.stroke();
    g.strokeStyle = 'rgba(96, 140, 184, 0.1)';
    for (let x = -h * 0.05; x < w; x += h * 0.032) {
      g.beginPath();
      g.moveTo(x, trussY + h * 0.013);
      g.lineTo(x + h * 0.016, trussY);
      g.stroke();
    }

    const adH = h * 0.055;
    const adTop = wallBot - adH - h * 0.012;
    g.fillStyle = '#050c15';
    g.fillRect(0, adTop, w, adH);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const sx0 = (w / segs) * i;
      const sw = w / segs;
      const hue = i % 3 === 0 ? '250, 160, 90' : i % 3 === 1 ? '90, 220, 235' : '130, 170, 240';
      const gg2 = g.createLinearGradient(sx0, adTop, sx0 + sw, adTop + adH);
      gg2.addColorStop(0, `rgba(${hue}, 0.08)`);
      gg2.addColorStop(0.5, `rgba(${hue}, 0.26)`);
      gg2.addColorStop(1, `rgba(${hue}, 0.09)`);
      g.fillStyle = gg2;
      g.fillRect(sx0 + 2, adTop + 2, sw - 4, adH - 4);
      g.fillStyle = `rgba(${hue}, 0.42)`;
      for (let b2 = 0; b2 < 3; b2++) {
        const bw = sw * (0.07 + ((i * 7 + b2 * 13) % 10) / 40);
        g.fillRect(sx0 + sw * (0.14 + b2 * 0.24), adTop + adH * (0.34 + (b2 % 2) * 0.18), bw, adH * 0.1);
      }
    }
    g.fillStyle = 'rgba(150, 210, 245, 0.16)';
    g.fillRect(0, adTop, w, 1);
    g.fillRect(0, adTop + adH - 1, w, 1);

    const haze = g.createLinearGradient(0, seatTop - h * 0.02, 0, wallBot);
    haze.addColorStop(0, 'rgba(7, 15, 26, 0.7)');
    haze.addColorStop(0.42, 'rgba(7, 15, 26, 0.42)');
    haze.addColorStop(1, 'rgba(7, 15, 26, 0.05)');
    g.fillStyle = haze;
    g.fillRect(0, seatTop - h * 0.02, w, wallBot - seatTop + h * 0.02);

    for (const lx of [0.5, 0.16, 0.84]) {
      const lxp = w * lx;
      const lg = g.createRadialGradient(lxp, -h * 0.05, 0, lxp, -h * 0.05, h * 0.6);
      lg.addColorStop(0, 'rgba(200, 230, 255, 0.2)');
      lg.addColorStop(0.3, 'rgba(150, 200, 250, 0.06)');
      lg.addColorStop(1, 'rgba(150, 200, 250, 0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, w, wallBot);
    }

    this.bg = c;
    this.wallBot = wallBot;
  }

  poly(g, pts, fill, stroke, lw) {
    if (!pts.length) return;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1.5; g.stroke(); }
  }

  drawCourt(g) {
    const HW = COURT.HALF_WIDTH;
    const HL = COURT.HALF_LENGTH;
    const ohw = HW + 1.05;
    const ohl = HL + 1.05;
    const p = (x, z) => this.project(x, 0, z);

    const farL = p(-ohl, -ohw);
    const farR = p(ohl, -ohw);
    const nearR = p(ohl, ohw);
    const nearL = p(-ohl, ohw);

    const floorG = g.createLinearGradient(0, farL.y, 0, nearL.y);
    floorG.addColorStop(0, '#081118');
    floorG.addColorStop(0.45, '#0b1720');
    floorG.addColorStop(1, '#0d1d26');
    this.poly(g, [farL, farR, nearR, nearL], floorG);

    const apronG = g.createLinearGradient(0, p(0, -HW - 0.9).y, 0, p(0, HW + 0.9).y);
    apronG.addColorStop(0, '#0c2624');
    apronG.addColorStop(0.55, '#0f3631');
    apronG.addColorStop(1, '#123f39');
    this.poly(g, [p(-ohl, -HW - 0.95), p(ohl, -HW - 0.95), p(ohl, HW + 0.95), p(-ohl, HW + 0.95)], apronG);

    const courtG = g.createLinearGradient(0, p(0, -HW).y, 0, p(0, HW).y);
    courtG.addColorStop(0, '#1a5b58');
    courtG.addColorStop(0.45, '#267a72');
    courtG.addColorStop(1, '#2f9083');
    this.poly(g, [p(-HL, -HW), p(HL, -HW), p(HL, HW), p(-HL, HW)], courtG);

    const sheen = g.createLinearGradient(0, p(0, -HW).y, 0, p(0, HW).y);
    sheen.addColorStop(0, 'rgba(190, 255, 250, 0.11)');
    sheen.addColorStop(0.5, 'rgba(190, 255, 250, 0.035)');
    sheen.addColorStop(1, 'rgba(190, 255, 250, 0)');
    this.poly(g, [p(-HL, -HW), p(HL, -HW), p(HL, HW), p(-HL, HW)], sheen);

    const lineW = (x) => Math.max(1.1, this.project(x, 0, 0).s * 0.048);
    const line = (x1, z1, x2, z2, strong) => {
      const a = p(x1, z1);
      const b = p(x2, z2);
      g.strokeStyle = strong ? 'rgba(246, 255, 255, 0.9)' : 'rgba(246, 255, 255, 0.6)';
      g.lineWidth = strong ? lineW(x1) * 1.2 : lineW(x1) * 0.9;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    };

    line(-HL, -HW, HL, -HW, true);
    line(-HL, HW, HL, HW, true);
    line(-HL, -HW, -HL, HW, true);
    line(HL, -HW, HL, HW, true);
    line(-COURT.SHORT_SERVICE, -HW, -COURT.SHORT_SERVICE, HW, false);
    line(COURT.SHORT_SERVICE, -HW, COURT.SHORT_SERVICE, HW, false);
    line(-COURT.SHORT_SERVICE, 0, COURT.SHORT_SERVICE, 0, false);

    const poolC = p(0, 0);
    const poolR = this.W * 0.30;
    g.save();
    g.beginPath();
    const cl0 = p(-HL, -HW);
    const cl1 = p(HL, -HW);
    const cl2 = p(HL, HW);
    const cl3 = p(-HL, HW);
    g.moveTo(cl0.x, cl0.y);
    g.lineTo(cl1.x, cl1.y);
    g.lineTo(cl2.x, cl2.y);
    g.lineTo(cl3.x, cl3.y);
    g.closePath();
    g.clip();
    const pool = g.createRadialGradient(poolC.x, poolC.y, 0, poolC.x, poolC.y, poolR);
    pool.addColorStop(0, 'rgba(150, 255, 240, 0.055)');
    pool.addColorStop(0.65, 'rgba(150, 255, 240, 0.016)');
    pool.addColorStop(1, 'rgba(150, 255, 240, 0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = pool;
    g.fillRect(0, 0, this.W, this.H);
    g.restore();
  }

  drawNet(g) {
    const anchor = this.project(0, 0, 0);
    const top = this.project(0, COURT.NET_CENTER, 0);
    const k = anchor.s;
    if (k < 0.5) return;
    const halfW = 2.98 * k;
    const topHalf = halfW * 0.985;
    const cx = anchor.x;
    const yBase = anchor.y;
    const yTop = top.y;
    const h = yBase - yTop;

    const mesh = g.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
    mesh.addColorStop(0, 'rgba(206, 232, 252, 0.02)');
    mesh.addColorStop(0.5, 'rgba(216, 240, 255, 0.055)');
    mesh.addColorStop(1, 'rgba(206, 232, 252, 0.02)');
    g.beginPath();
    g.moveTo(cx - topHalf, yTop);
    g.lineTo(cx + topHalf, yTop);
    g.lineTo(cx + halfW, yBase);
    g.lineTo(cx - halfW, yBase);
    g.closePath();
    g.fillStyle = mesh;
    g.fill();

    g.save();
    g.clip();
    g.strokeStyle = 'rgba(226, 242, 255, 0.24)';
    g.lineWidth = Math.max(0.5, k * 0.0055);
    const rows = 14;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = yTop + h * t;
      const hwid = lerp(topHalf, halfW, t);
      g.beginPath();
      g.moveTo(cx - hwid, y);
      g.lineTo(cx + hwid, y);
      g.stroke();
    }
    const cols = 26;
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      const xb = cx - halfW + halfW * 2 * t;
      const xt = cx - topHalf + topHalf * 2 * t;
      g.beginPath();
      g.moveTo(xt, yTop);
      g.lineTo(xb, yBase);
      g.stroke();
    }
    g.restore();

    const tapeH = Math.max(2.4, k * 0.036);
    const tape = g.createLinearGradient(0, yTop - tapeH, 0, yTop + tapeH * 0.4);
    tape.addColorStop(0, 'rgba(255,255,255,0.72)');
    tape.addColorStop(0.45, '#ffffff');
    tape.addColorStop(1, 'rgba(226, 238, 250, 0.9)');
    g.fillStyle = tape;
    g.beginPath();
    g.moveTo(cx - topHalf - 1, yTop - tapeH * 0.42);
    g.lineTo(cx + topHalf + 1, yTop - tapeH * 0.42);
    g.lineTo(cx + topHalf + 1, yTop + tapeH * 0.58);
    g.lineTo(cx - topHalf - 1, yTop + tapeH * 0.58);
    g.closePath();
    g.fill();

    const postW = Math.max(3, k * 0.058);
    for (const side of [-1, 1]) {
      const px = cx + side * (halfW + postW * 0.6);
      const grd = g.createLinearGradient(px - postW, 0, px + postW, 0);
      grd.addColorStop(0, '#0b1622');
      grd.addColorStop(0.35, '#3a627f');
      grd.addColorStop(0.62, '#1d3448');
      grd.addColorStop(1, '#0a1520');
      g.fillStyle = grd;
      rr(g, px - postW / 2, yTop - tapeH * 0.5, postW, h + tapeH * 0.5, postW * 0.35);
      g.fill();
    }
  }

  drawNetPostsUnused(g) {
    for (const z of [-COURT.NET_HALF_WIDTH, COURT.NET_HALF_WIDTH]) {
      const base = this.project(0, 0, z);
      const top = this.project(0, COURT.NET_POST, z);
      const wpx = Math.max(2.5, base.s * 0.055);
      const grd = g.createLinearGradient(base.x - wpx, 0, base.x + wpx, 0);
      grd.addColorStop(0, '#0b1622');
      grd.addColorStop(0.4, '#3a627f');
      grd.addColorStop(0.62, '#1d3448');
      grd.addColorStop(1, '#0a1520');
      g.fillStyle = grd;
      rr(g, base.x - wpx / 2, top.y, wpx, base.y - top.y, wpx * 0.35);
      g.fill();
    }
  }

  drawShadow(g, wx, wz, radius, alpha, height) {
    const p = this.project(wx, 0, wz);
    const k = clamp(1 - height / 6.5, 0.2, 1);
    const rx = radius * p.s * (1.35 - k * 0.35);
    const ry = rx * 0.34;
    const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
    grd.addColorStop(0, `rgba(0, 8, 14, ${0.5 * alpha * k})`);
    grd.addColorStop(0.6, `rgba(0, 8, 14, ${0.24 * alpha * k})`);
    grd.addColorStop(1, 'rgba(0, 8, 14, 0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  drawPlayer(g, p, side, isLocal, dt) {
    const base = this.project(p.x, p.y, p.z);
    const foot = this.project(p.x, 0, p.z);
    const s = base.s;
    if (s < 0.4) return;

    const dir = side < 0 ? 1 : -1;
    const kit = side < 0
      ? { shirt: '#ff7d4e', shirt2: '#e04f26', trim: '#ffd9c7', skin: '#f0c39c', skin2: '#d9a87e', hair: '#2a1a14', shoe: '#f4f7fb' }
      : { shirt: '#35d5ff', shirt2: '#0a86bd', trim: '#c9f2ff', skin: '#e8bb94', skin2: '#ce9a72', hair: '#16212e', shoe: '#f4f7fb' };

    const speed = Math.hypot(p.vx, p.vz);
    p.runPhase = (p.runPhase || 0) + speed * dt * 5.6;
    const moving = speed > 0.4;
    const airborne = p.y > 0.06;
    const H = 1.78 * s;

    this.drawShadow(g, p.x, p.z, 0.55, 1, p.y);

    g.save();
    g.translate(base.x, base.y);
    if (Math.abs(p.vz) > 0.3) {
      g.rotate(clamp(-p.vz * 0.035, -0.08, 0.08));
    }

    const hipY = -H * 0.468;
    const shoulderY = -H * 0.812;
    const headR = H * 0.088;
    const headCY = -H * 0.878;

    const lean = p.charging ? dir * 0.075 : (moving ? dir * 0.045 : 0);
    g.save();
    g.rotate(lean);

    const legL = moving ? Math.sin(p.runPhase) : 0;
    const legR = moving ? Math.sin(p.runPhase + Math.PI) : 0;
    const legAmp = moving ? 0.62 : 0.12;

    const drawLeg = (ang, off, col, shoeCol, width) => {
      const hipX = dir * off;
      const swingA = Math.sin(ang * legAmp);
      const kneeX = hipX + swingA * H * 0.175 * dir + dir * H * 0.012;
      const kneeY = hipY + H * 0.238;
      const swing2 = Math.sin(ang * legAmp * 0.45 + 0.5);
      const footX = kneeX + swing2 * H * 0.155 * dir;
      const footY = airborne ? hipY + H * 0.315 : -H * 0.010;
      g.strokeStyle = col;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(hipX, hipY);
      g.lineTo(kneeX, kneeY);
      g.lineTo(footX, footY);
      g.stroke();
      g.strokeStyle = 'rgba(248,252,255,0.92)';
      g.lineWidth = width * 0.7;
      g.beginPath();
      g.moveTo(lerp(kneeX, footX, 0.74), lerp(kneeY, footY, 0.74));
      g.lineTo(footX, footY);
      g.stroke();
      g.fillStyle = shoeCol;
      g.beginPath();
      g.ellipse(footX + dir * H * 0.020, footY + H * 0.002, H * 0.052, H * 0.023, 0, 0, Math.PI * 2);
      g.fill();
    };

    drawLeg(legL * 0.9, H * 0.052, kit.skin2, '#d9e2ec', H * 0.079);

    const offArmAng = 2.0 - (moving ? Math.sin(p.runPhase + 1.1) * 0.35 : 0.05);
    const offShX = -dir * H * 0.052;
    const offElbowX = offShX + Math.cos(offArmAng) * H * 0.115 * -dir;
    const offElbowY = shoulderY + Math.sin(offArmAng) * H * 0.115 + H * 0.045;
    const offHandX = offElbowX + Math.cos(offArmAng + 0.5) * H * 0.105 * -dir;
    const offHandY = offElbowY + Math.sin(offArmAng + 0.5) * H * 0.105;
    g.strokeStyle = kit.skin2;
    g.lineWidth = H * 0.046;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(offShX, shoulderY + H * 0.022);
    g.quadraticCurveTo(offElbowX, offElbowY, offHandX, offHandY);
    g.stroke();

    const torsoW = H * 0.212;
    const torsoTop = shoulderY - H * 0.012;
    const torsoBot = hipY + H * 0.028;

    g.fillStyle = 'rgba(16, 26, 38, 0.92)';
    g.beginPath();
    g.moveTo(-torsoW * 0.47, hipY - H * 0.012);
    g.lineTo(torsoW * 0.47, hipY - H * 0.012);
    g.lineTo(torsoW * 0.50, hipY + H * 0.115);
    g.lineTo(torsoW * 0.14, hipY + H * 0.128);
    g.lineTo(-torsoW * 0.14, hipY + H * 0.128);
    g.lineTo(-torsoW * 0.50, hipY + H * 0.115);
    g.closePath();
    g.fill();

    const bodyG = g.createLinearGradient(-torsoW * 0.5, torsoTop, torsoW * 0.5, torsoBot);
    bodyG.addColorStop(0, kit.shirt);
    bodyG.addColorStop(0.62, kit.shirt);
    bodyG.addColorStop(1, kit.shirt2);
    g.fillStyle = bodyG;
    g.beginPath();
    g.moveTo(-torsoW * 0.44, torsoTop + H * 0.014);
    g.quadraticCurveTo(0, torsoTop - H * 0.016, torsoW * 0.44, torsoTop + H * 0.014);
    g.lineTo(torsoW * 0.47, torsoBot - H * 0.045);
    g.quadraticCurveTo(torsoW * 0.47, torsoBot, torsoW * 0.30, torsoBot);
    g.lineTo(-torsoW * 0.30, torsoBot);
    g.quadraticCurveTo(-torsoW * 0.47, torsoBot, -torsoW * 0.47, torsoBot - H * 0.045);
    g.closePath();
    g.fill();

    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.beginPath();
    g.moveTo(dir * torsoW * 0.12, torsoTop + H * 0.01);
    g.lineTo(dir * torsoW * 0.46, torsoTop + H * 0.02);
    g.lineTo(dir * torsoW * 0.44, torsoBot - H * 0.02);
    g.lineTo(dir * torsoW * 0.16, torsoBot - H * 0.02);
    g.closePath();
    g.fill();

    drawLeg(legR * 0.9, -H * 0.052, kit.skin, kit.shoe, H * 0.083);

    const swing = p.swingAnim;
    const charge = p.charge;
    const IDLE = [0.62, 0.20, -0.34];
    let upA, foreA, rackA;
    if (swing > 0) {
      const t = 1 - swing;
      const hitA = p.lastKind === 'smash' || p.lastKind === 'drive'
        ? [-1.15, -0.55, -1.35]
        : [-0.55, -0.30, -1.05];
      const e = t * t * (3 - 2 * t);
      upA = lerp(hitA[0], IDLE[0], e);
      foreA = lerp(hitA[1], IDLE[1], e);
      rackA = lerp(hitA[2], IDLE[2], e);
    } else if (p.charging) {
      upA = lerp(IDLE[0], -0.30, charge);
      foreA = lerp(IDLE[1], -0.95, charge);
      rackA = lerp(IDLE[2], -1.55, charge);
    } else {
      upA = IDLE[0]; foreA = IDLE[1]; rackA = IDLE[2];
    }

    const shX = dir * H * 0.058;
    const shY = shoulderY + H * 0.012;
    const elbowX = shX + Math.cos(upA) * H * 0.150 * dir;
    const elbowY = shY + Math.sin(upA) * H * 0.150;
    const handX = elbowX + Math.cos(foreA) * H * 0.152 * dir;
    const handY = elbowY + Math.sin(foreA) * H * 0.152;

    g.strokeStyle = kit.skin;
    g.lineWidth = H * 0.058;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(shX, shY);
    g.quadraticCurveTo(elbowX, elbowY, handX, handY);
    g.stroke();

    g.fillStyle = kit.skin;
    g.beginPath();
    g.arc(handX, handY, H * 0.028, 0, Math.PI * 2);
    g.fill();

    const racketAng = rackA;
    const racketLen = H * 0.345;
    const rBaseX = handX;
    const rBaseY = handY;
    const rcx = rBaseX + Math.cos(racketAng) * racketLen * 0.62 * dir;
    const rcy = rBaseY + Math.sin(racketAng) * racketLen * 0.62;

    if (swing > 0.2) {
      const a = Math.sin((1 - swing) * Math.PI) * 0.5;
      g.save();
      g.globalAlpha = a;
      g.strokeStyle = 'rgba(200, 245, 255, 0.9)';
      g.lineWidth = H * 0.018;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(rBaseX, rBaseY, racketLen * 0.66, racketAng - 0.9 * dir, racketAng + 0.55 * dir, dir < 0);
      g.stroke();
      g.restore();
    }

    g.strokeStyle = '#22323f';
    g.lineWidth = H * 0.021;
    g.beginPath();
    g.moveTo(rBaseX, rBaseY);
    g.lineTo(rBaseX + Math.cos(racketAng) * racketLen * 0.4 * dir, rBaseY + Math.sin(racketAng) * racketLen * 0.4);
    g.stroke();

    g.save();
    g.translate(rcx, rcy);
    g.rotate(racketAng * dir);
    g.strokeStyle = 'rgba(240, 250, 255, 0.95)';
    g.lineWidth = H * 0.0155;
    g.beginPath();
    g.ellipse(0, 0, racketLen * 0.285, racketLen * 0.215, 0, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(190, 225, 248, 0.38)';
    g.lineWidth = Math.max(0.5, H * 0.0042);
    for (let i = -2; i <= 2; i++) {
      const yy = i * racketLen * 0.068;
      const span = Math.sqrt(Math.max(0, 1 - (yy / (racketLen * 0.215)) ** 2)) * racketLen * 0.285;
      g.beginPath(); g.moveTo(-span, yy); g.lineTo(span, yy); g.stroke();
    }
    for (let i = -2; i <= 2; i++) {
      const xx = i * racketLen * 0.088;
      const span = Math.sqrt(Math.max(0, 1 - (xx / (racketLen * 0.285)) ** 2)) * racketLen * 0.215;
      g.beginPath(); g.moveTo(xx, -span); g.lineTo(xx, span); g.stroke();
    }
    g.restore();

    g.fillStyle = kit.skin2;
    g.beginPath();
    g.ellipse(dir * H * 0.008, headCY + headR * 0.72, H * 0.028, H * 0.040, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = kit.skin;
    g.beginPath();
    g.ellipse(0, headCY, headR * 0.94, headR, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = kit.skin2;
    g.beginPath();
    g.ellipse(-dir * headR * 0.22, headCY + headR * 0.42, headR * 0.62, headR * 0.34, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = kit.hair;
    g.beginPath();
    g.ellipse(0, headCY - headR * 0.18, headR * 1.0, headR * 0.92, 0, Math.PI * 0.98, Math.PI * 2.02);
    g.fill();
    g.beginPath();
    g.ellipse(dir * headR * 0.42, headCY - headR * 0.1, headR * 0.62, headR * 0.7, 0, Math.PI * 1.02, Math.PI * 1.98);
    g.fill();
    g.beginPath();
    g.ellipse(-dir * headR * 0.55, headCY + headR * 0.2, headR * 0.38, headR * 0.5, dir * 0.4, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = 'rgba(26, 20, 18, 0.9)';
    g.beginPath();
    g.ellipse(dir * headR * 0.4, headCY + headR * 0.08, headR * 0.085, headR * 0.115, 0, 0, Math.PI * 2);
    g.fill();

    g.restore();

    if (isLocal) {
      g.strokeStyle = side < 0 ? 'rgba(255, 138, 92, 0.5)' : 'rgba(77, 225, 255, 0.5)';
      g.lineWidth = H * 0.007;
      g.setLineDash([H * 0.045, H * 0.035]);
      g.beginPath();
      g.ellipse(foot.x, foot.y, H * 0.185, H * 0.05, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    g.restore();

    if (p.charging) {
      const y = base.y - H * 1.22;
      const w = Math.max(30, H * 0.42);
      const hh = Math.max(4, H * 0.038);
      const col = p.charge > 0.78 ? '#ffd166' : p.charge > 0.45 ? '#5ef0d4' : '#9dbdd8';
      g.fillStyle = 'rgba(6, 14, 24, 0.62)';
      rr(g, base.x - w / 2, y, w, hh, hh / 2);
      g.fill();
      g.fillStyle = col;
      if (p.charge > 0.02) {
        rr(g, base.x - w / 2 + 1.5, y + 1.5, Math.max(2, (w - 3) * p.charge), hh - 3, (hh - 3) / 2);
        g.fill();
      }
    }
  }

  drawBall(g, b, dt) {
    const p = this.project(b.x, b.y, b.z);
    if (p.d < 0.5) return;
    const spd = Math.hypot(b.vx, b.vy, b.vz);
    const r = Math.max(2.6, p.s * 0.055);

    if (b.active) this.trail.push({ x: p.x, y: p.y, t: this.time, s: p.s });
    if (this.trail.length > 26) this.trail.shift();

    this.drawShadow(g, b.x, b.z, 0.16, 0.85, b.y);

    if (b.active) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.trail.length - 1; i++) {
        const a = this.trail[i];
        const c = this.trail[i + 1];
        const age = this.time - c.t;
        if (age > 0.2) continue;
        const al = (1 - age / 0.2) * 0.3 * clamp(spd / 22, 0.3, 1);
        g.strokeStyle = `rgba(200, 245, 255, ${al})`;
        g.lineWidth = r * (0.4 + (1 - age / 0.2) * 0.9);
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke();
      }
      g.restore();
    }

    const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
    glow.addColorStop(0, 'rgba(240, 252, 255, 0.26)');
    glow.addColorStop(0.45, 'rgba(200, 240, 255, 0.09)');
    glow.addColorStop(1, 'rgba(200, 240, 255, 0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); g.fill();

    const ang = spd > 0.5 ? Math.atan2(-b.vy, b.vx) : -Math.PI / 2;
    const stretch = clamp(spd / 50, 0, 1);

    g.save();
    g.translate(p.x, p.y);
    g.rotate(ang);

    const skirtLen = r * (2.0 + stretch * 1.0);
    const skirtW = r * 1.5;
    const sk = g.createLinearGradient(-skirtLen, 0, r * 0.5, 0);
    sk.addColorStop(0, 'rgba(255,255,255,0.22)');
    sk.addColorStop(0.5, 'rgba(255,255,255,0.72)');
    sk.addColorStop(1, 'rgba(255,255,255,0.99)');
    g.fillStyle = sk;
    g.beginPath();
    g.moveTo(r * 0.15, -skirtW * 0.33);
    g.quadraticCurveTo(-skirtLen * 0.5, -skirtW * 0.72, -skirtLen, -skirtW);
    g.lineTo(-skirtLen, skirtW);
    g.quadraticCurveTo(-skirtLen * 0.5, skirtW * 0.72, r * 0.15, skirtW * 0.33);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(160, 195, 220, 0.4)';
    g.lineWidth = Math.max(0.4, r * 0.07);
    for (let i = -3; i <= 3; i++) {
      g.beginPath();
      g.moveTo(r * 0.06, i * skirtW * 0.16);
      g.lineTo(-skirtLen * 0.95, i * skirtW * 0.82);
      g.stroke();
    }

    const cork = g.createRadialGradient(r * 0.2, -r * 0.22, 0, r * 0.05, 0, r * 1.35);
    cork.addColorStop(0, '#ffffff');
    cork.addColorStop(0.55, '#f4ebdd');
    cork.addColorStop(1, '#c8b096');
    g.fillStyle = cork;
    g.beginPath(); g.arc(0, 0, r * 0.88, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = Math.max(0.5, r * 0.11);
    g.beginPath(); g.arc(0, 0, r * 0.88, 0, Math.PI * 2); g.stroke();

    g.restore();
  }

  drawLandingHint(g) {
    const h = this.landing;
    if (!h) return;
    const p = this.project(h.x, 0, h.z || 0);
    const rx = Math.max(10, p.s * 0.4);
    const col = h.out ? '255, 96, 110' : '160, 246, 232';
    g.save();
    g.strokeStyle = `rgba(${col}, 0.9)`;
    g.lineWidth = Math.max(1.1, p.s * 0.012);
    g.setLineDash([Math.max(3, p.s * 0.05), Math.max(3, p.s * 0.045)]);
    g.lineDashOffset = -this.time * 26;
    g.beginPath();
    g.ellipse(p.x, p.y, rx, rx * 0.34, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = `rgba(${col}, 0.22)`;
    g.beginPath();
    g.ellipse(p.x, p.y, rx * 0.4, rx * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  spawnHitFx(x, y, z, side, power) {
    this.fx.push({ type: 'ring', x, y, z, t: 0, life: 0.4, color: side < 0 ? '255, 150, 105' : '95, 225, 255', r1: 0.9 + power * 0.7 });
    this.fx.push({ type: 'burst', x, y, z, t: 0, life: 0.28, color: side < 0 ? '255, 200, 165' : '190, 245, 255', n: 9, power });
    if (power > 0.78) this.shake = Math.max(this.shake, 4.2);
  }

  spawnLandFx(x, z, scorer) {
    this.fx.push({ type: 'land', x, z, t: 0, life: 0.55, color: scorer < 0 ? '255, 150, 105' : '95, 225, 255' });
  }

  spawnText(text, sub, color) {
    this.fx.push({ type: 'text', text, sub, color, t: 0, life: 1.3 });
  }

  updateFx(dt) {
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.life);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 20);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.4);
  }

  drawFx(g) {
    for (const f of this.fx) {
      const k = f.t / f.life;
      if (f.type === 'ring' || f.type === 'burst') {
        const p = this.project(f.x, f.y, f.z);
        if (f.type === 'ring') {
          const r = lerp(0.16, f.r1, k) * p.s;
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.strokeStyle = `rgba(${f.color}, ${(1 - k) * 0.7})`;
          g.lineWidth = Math.max(1.4, p.s * 0.03 * (1 - k));
          g.beginPath();
          g.ellipse(p.x, p.y, r, r * 0.75, 0, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        } else {
          g.save();
          g.globalCompositeOperation = 'lighter';
          for (let i = 0; i < f.n; i++) {
            const a = (i / f.n) * Math.PI * 2 + 0.42;
            const d = lerp(0.06, 0.7 + f.power * 0.45, k);
            const q = this.project(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.75, f.z);
            g.fillStyle = `rgba(${f.color}, ${(1 - k) * 0.85})`;
            g.beginPath();
            g.arc(q.x, q.y, Math.max(0.8, q.s * 0.022 * (1 - k)), 0, Math.PI * 2);
            g.fill();
          }
          g.restore();
        }
      } else if (f.type === 'land') {
        const p = this.project(f.x, 0, f.z);
        const r = lerp(0.08, 0.95, k) * p.s;
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = `rgba(${f.color}, ${(1 - k) * 0.55})`;
        g.lineWidth = Math.max(1.2, p.s * 0.02 * (1 - k));
        g.beginPath();
        g.ellipse(p.x, p.y, r, r * 0.34, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else if (f.type === 'text') {
        const pop = k < 0.14 ? lerp(0.55, 1, k / 0.14) : 1;
        const fade = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
        const size = Math.min(this.W * 0.052, this.H * 0.115);
        g.save();
        g.globalAlpha = fade;
        g.translate(this.cx, this.H * 0.24);
        g.scale(pop, pop);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${size}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
        g.fillStyle = f.color || '#fff';
        g.shadowColor = 'rgba(0,0,0,0.55)';
        g.shadowBlur = size * 0.4;
        g.fillText(f.text, 0, 0);
        if (f.sub) {
          g.font = `600 ${size * 0.24}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
          g.fillStyle = 'rgba(238, 245, 255, 0.8)';
          g.fillText(f.sub, 0, size * 0.56);
        }
        g.restore();
      }
    }
  }

  draw(world, camera, dt, opts = {}) {
    const g = this.ctx;
    this.time += dt;
    g.save();
    if (this.shake > 0.1) {
      g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    if (this.bg) g.drawImage(this.bg, 0, 0, this.W, this.H);
    else { g.fillStyle = '#0a1220'; g.fillRect(0, 0, this.W, this.H); }

    this.drawCourt(g);
    this.drawLandingHint(g);

    const items = [];
    items.push({ d: this.rawProject(0, 0.7, 0).d, draw: () => this.drawNet(g) });

    const [pl, pr] = world.players;
    items.push({ d: this.rawProject(pl.x, 0, pl.z).d, draw: () => this.drawPlayer(g, pl, -1, opts.localSide === -1, dt) });
    items.push({ d: this.rawProject(pr.x, 0, pr.z).d, draw: () => this.drawPlayer(g, pr, 1, opts.localSide === 1, dt) });
    const bp = this.rawProject(world.ball.x, world.ball.y, world.ball.z);
    items.push({ d: bp.d, draw: () => this.drawBall(g, world.ball, dt) });

    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();

    this.drawFx(g);

    if (this.flash > 0.01) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.13})`;
      g.fillRect(0, 0, this.W, this.H);
    }

    g.restore();
  }
}
