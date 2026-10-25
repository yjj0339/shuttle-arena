import { COURT, BALL, PLAYER } from './shared/constants.js';

const CAM = { eyeX: -3.15, eyeY: 11.0, eyeZ: 14.4, lookY: 1.05 };

const THEME = {
  skyTop: '#f6f9fc',
  skyMid: '#e7eff7',
  skyLow: '#d5e2ee',
  skyFloor: '#c6d5e3',
  crowdBase: 'rgba(206, 219, 232, 0.92)',
  crowdFade: 'rgba(242, 246, 250, 0.92)',
  apronFar: '#b7c8d7',
  apronNear: '#a3b6c8',
  courtFar: '#43a56c',
  courtMid: '#4cb273',
  courtNear: '#55bb7c',
  floorFar: '#c9d7e4',
  floorNear: '#b4c5d6',
  netFill: 'rgba(252, 254, 255, 0.5)',
  netLine: 'rgba(112, 142, 168, 0.45)',
  netTape: '#ffffff',
  shadow: '36, 64, 92',
  line: 'rgba(255, 255, 255, 0.96)',
  lineSoft: 'rgba(255, 255, 255, 0.7)',
  ink: '#16283c',
};

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
    this.cy = h * 0.5;

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

    const corners = [
      [COURT.HALF_LENGTH, -COURT.HALF_WIDTH],
      [COURT.HALF_LENGTH, COURT.HALF_WIDTH],
      [-COURT.HALF_LENGTH, -COURT.HALF_WIDTH],
      [-COURT.HALF_LENGTH, COURT.HALF_WIDTH],
    ].map(([x, z]) => this.rawProject(x, 0, z));
    const ratios = corners.map((c) => c.vx / c.d);
    const minN = Math.min(...ratios);
    const maxN = Math.max(...ratios);
    const span = Math.max(maxN - minN, 0.001);
    this.focal = Math.min(w * 0.90, h * 1.62) / span;
    this.cx = w / 2 - ((minN + maxN) / 2) * this.focal;

    const t1 = this.rawProject(0, 0, -COURT.HALF_WIDTH - 0.6);
    const t2 = this.rawProject(0, 0, COURT.HALF_WIDTH + 0.6);
    let yTop = -t1.vy * (this.focal / t1.d);
    let yBot = -t2.vy * (this.focal / t2.d);
    const maxH = h * 0.60;
    if (yBot - yTop > maxH) {
      this.focal *= maxH / (yBot - yTop);
      this.cx = w / 2 - ((minN + maxN) / 2) * this.focal;
      yTop = -t1.vy * (this.focal / t1.d);
      yBot = -t2.vy * (this.focal / t2.d);
    }
    this.cy = h * 0.565 - (yTop + yBot) / 2;

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
    g.fillStyle = '#e6eef6';
    g.fillRect(0, 0, w, h);

    const floorY = this.project(0, 0, -COURT.HALF_WIDTH - 1).y;
    const wallBot = Math.min(floorY - h * 0.02, h * 0.60);

    const wall = g.createLinearGradient(0, 0, 0, wallBot);
    wall.addColorStop(0, THEME.skyTop);
    wall.addColorStop(0.42, THEME.skyMid);
    wall.addColorStop(0.8, THEME.skyLow);
    wall.addColorStop(1, THEME.skyFloor);
    g.fillStyle = wall;
    g.fillRect(0, 0, w, wallBot + 2);

    const rnd = mulberry(20261025);
    const seatTop = h * 0.045;
    const seatBot = Math.max(seatTop + h * 0.09, wallBot - h * 0.095);

    g.fillStyle = THEME.crowdBase;
    g.fillRect(0, seatTop, w, seatBot - seatTop);

    g.strokeStyle = 'rgba(140, 168, 195, 0.28)';
    g.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const yy = seatTop + (seatBot - seatTop) * Math.pow(i / 7, 1.28);
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(w, yy);
      g.stroke();
    }

    g.save();
    g.filter = `blur(${Math.max(0.7, h * 0.0016).toFixed(2)}px)`;
    const unit = Math.max(1.7, Math.min(3.4, w / 520));
    const total = Math.round(w * 0.62);
    for (let i = 0; i < total; i++) {
      const px = rnd() * w;
      const py = seatTop + rnd() * (seatBot - seatTop);
      const depth = (py - seatTop) / Math.max(1, seatBot - seatTop);
      const kk = (0.72 + depth * 0.75) * (0.76 + rnd() * 0.55);
      const bw = unit * kk * 1.15;
      const bh = unit * kk * 2.25;
      const tint = rnd();
      const col = tint > 0.9 ? '232, 128, 92'
        : tint > 0.78 ? '70, 168, 208'
          : tint > 0.58 ? '96, 132, 188'
            : tint > 0.3 ? '120, 144, 170' : '84, 104, 128';
      g.fillStyle = `rgba(${col}, ${0.26 + depth * 0.4 + rnd() * 0.14})`;
      rr(g, px, py - bh, bw, bh, bw * 0.45);
      g.fill();
      g.beginPath();
      g.arc(px + bw / 2, py - bh - bw * 0.36, bw * 0.42, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    const fade = g.createLinearGradient(0, seatTop, 0, seatBot);
    fade.addColorStop(0, 'rgba(243, 248, 252, 0.88)');
    fade.addColorStop(0.45, 'rgba(243, 248, 252, 0.18)');
    fade.addColorStop(1, 'rgba(243, 248, 252, 0)');
    g.fillStyle = fade;
    g.fillRect(0, seatTop, w, seatBot - seatTop);

    const trussY = h * 0.052;
    g.strokeStyle = 'rgba(150, 178, 202, 0.5)';
    g.lineWidth = Math.max(1, h * 0.0016);
    g.beginPath();
    g.moveTo(0, trussY); g.lineTo(w, trussY);
    g.moveTo(0, trussY + h * 0.012); g.lineTo(w, trussY + h * 0.012);
    g.stroke();
    g.strokeStyle = 'rgba(150, 178, 202, 0.3)';
    for (let x = -h * 0.05; x < w; x += h * 0.032) {
      g.beginPath();
      g.moveTo(x, trussY + h * 0.012);
      g.lineTo(x + h * 0.016, trussY);
      g.stroke();
    }

    for (const lx of [0.5, 0.18, 0.82]) {
      const lxp = w * lx;
      const lg = g.createRadialGradient(lxp, -h * 0.08, 0, lxp, -h * 0.08, h * 0.65);
      lg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      lg.addColorStop(0.35, 'rgba(255, 255, 255, 0.4)');
      lg.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, w, wallBot);
    }

    const adH = Math.min(h * 0.062, Math.max(18, wallBot * 0.14));
    const adTop = wallBot - adH - h * 0.004;
    g.fillStyle = '#f8fbfe';
    g.fillRect(0, adTop, w, adH);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const sx0 = (w / segs) * i;
      const sw = w / segs;
      const hue = i % 3 === 0 ? '236, 138, 96' : i % 3 === 1 ? '70, 176, 206' : '104, 148, 214';
      const gg2 = g.createLinearGradient(sx0, adTop, sx0 + sw, adTop + adH);
      gg2.addColorStop(0, `rgba(${hue}, 0.10)`);
      gg2.addColorStop(0.5, `rgba(${hue}, 0.26)`);
      gg2.addColorStop(1, `rgba(${hue}, 0.11)`);
      g.fillStyle = gg2;
      g.fillRect(sx0 + 2, adTop + 2, sw - 4, adH - 4);
      g.fillStyle = `rgba(${hue}, 0.62)`;
      for (let b2 = 0; b2 < 3; b2++) {
        const bw = sw * (0.07 + ((i * 7 + b2 * 13) % 10) / 40);
        g.fillRect(sx0 + sw * (0.14 + b2 * 0.24), adTop + adH * (0.34 + (b2 % 2) * 0.18), bw, adH * 0.1);
      }
    }
    g.fillStyle = 'rgba(150, 178, 202, 0.5)';
    g.fillRect(0, adTop, w, 1);
    g.fillRect(0, adTop + adH - 1, w, 1);

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

    const floorG = g.createLinearGradient(0, p(0, -ohw).y, 0, p(0, ohw).y);
    floorG.addColorStop(0, THEME.floorFar);
    floorG.addColorStop(1, THEME.floorNear);
    this.poly(g, [p(-ohl, -ohw), p(ohl, -ohw), p(ohl, ohw), p(-ohl, ohw)], floorG);

    const apronG = g.createLinearGradient(0, p(0, -HW - 0.9).y, 0, p(0, HW + 0.9).y);
    apronG.addColorStop(0, THEME.apronFar);
    apronG.addColorStop(1, THEME.apronNear);
    this.poly(g, [p(-ohl, -HW - 0.95), p(ohl, -HW - 0.95), p(ohl, HW + 0.95), p(-ohl, HW + 0.95)], apronG);

    const courtG = g.createLinearGradient(0, p(0, -HW).y, 0, p(0, HW).y);
    courtG.addColorStop(0, THEME.courtFar);
    courtG.addColorStop(0.5, THEME.courtMid);
    courtG.addColorStop(1, THEME.courtNear);
    this.poly(g, [p(-HL, -HW), p(HL, -HW), p(HL, HW), p(-HL, HW)], courtG);

    const sheen = g.createLinearGradient(0, p(0, -HW).y, 0, p(0, HW).y);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
    sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    this.poly(g, [p(-HL, -HW), p(HL, -HW), p(HL, HW), p(-HL, HW)], sheen);

    const lineW = (x) => Math.max(1.2, this.project(x, 0, 0).s * 0.05);
    const line = (x1, z1, x2, z2, strong) => {
      const a = p(x1, z1);
      const b = p(x2, z2);
      g.strokeStyle = strong ? THEME.line : THEME.lineSoft;
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
    const poolR = this.W * 0.32;
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
    pool.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    pool.addColorStop(0.7, 'rgba(255, 255, 255, 0.05)');
    pool.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, this.W, this.H);
    g.restore();
  }

  drawNet(g) {
    const Z0 = -COURT.NET_HALF_WIDTH - 0.28;
    const Z1 = COURT.NET_HALF_WIDTH + 0.28;
    const H = COURT.NET_CENTER;
    const p = (y, z) => this.project(0, y, z);

    const b0 = p(0, Z0), b1 = p(0, Z1);
    const t0 = p(H, Z0), t1 = p(H, Z1);
    const mid = this.project(0, H * 0.5, 0);
    if (mid.s < 0.4) return;

    g.beginPath();
    g.moveTo(b0.x, b0.y);
    g.lineTo(b1.x, b1.y);
    g.lineTo(t1.x, t1.y);
    g.lineTo(t0.x, t0.y);
    g.closePath();
    g.fillStyle = THEME.netFill;
    g.fill();

    g.save();
    g.clip();
    g.strokeStyle = THEME.netLine;
    g.lineWidth = Math.max(0.5, mid.s * 0.0055);

    for (let y = 0.055; y < H; y += 0.075) {
      const a = p(y, Z0);
      const b = p(y, Z1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    for (let z = Z0; z <= Z1 + 0.001; z += (Z1 - Z0) / 16) {
      const a = p(0, z);
      const b = p(H, z);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.restore();

    const tapeUp = Math.max(2.2, mid.s * 0.030);
    g.strokeStyle = THEME.netTape;
    g.lineWidth = Math.max(2, mid.s * 0.045);
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(t0.x, t0.y);
    g.lineTo(t1.x, t1.y);
    g.stroke();
    g.strokeStyle = 'rgba(120, 150, 175, 0.35)';
    g.lineWidth = Math.max(0.6, mid.s * 0.006);
    g.beginPath();
    g.moveTo(t0.x, t0.y + tapeUp * 0.5 + g.lineWidth);
    g.lineTo(t1.x, t1.y + tapeUp * 0.5 + g.lineWidth);
    g.stroke();

    for (const z of [Z0, Z1]) {
      const base = p(0, z);
      const top = p(COURT.NET_POST, z);
      const wpx = Math.max(3, base.s * 0.062);
      const grd = g.createLinearGradient(base.x - wpx, 0, base.x + wpx, 0);
      grd.addColorStop(0, '#8ba3b8');
      grd.addColorStop(0.35, '#f4f9fd');
      grd.addColorStop(0.62, '#c5d4e0');
      grd.addColorStop(1, '#7d95ab');
      g.fillStyle = grd;
      rr(g, base.x - wpx / 2, top.y - wpx * 0.3, wpx, base.y - top.y + wpx * 0.3, wpx * 0.4);
      g.fill();
      g.fillStyle = 'rgba(90, 120, 145, 0.35)';
      g.beginPath();
      g.ellipse(base.x, base.y + wpx * 0.1, wpx * 0.9, wpx * 0.32, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawShadow(g, wx, wz, radius, alpha, height) {
    const p = this.project(wx, 0, wz);
    const k = clamp(1 - height / 6.5, 0.2, 1);
    const rx = radius * p.s * (1.35 - k * 0.35);
    const ry = rx * 0.34;
    const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
    grd.addColorStop(0, `rgba(${THEME.shadow}, ${0.34 * alpha * k})`);
    grd.addColorStop(0.6, `rgba(${THEME.shadow}, ${0.16 * alpha * k})`);
    grd.addColorStop(1, `rgba(${THEME.shadow}, 0)`);
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
      ? { shirt: '#f2663c', shirt2: '#d14420', trim: '#ffe4d8', skin: '#f2c49d', skin2: '#dcab84', hair: '#2a1a14', shoe: '#ffffff' }
      : { shirt: '#2f93d8', shirt2: '#146ba8', trim: '#dcf1ff', skin: '#eec09a', skin2: '#d3a077', hair: '#1a2735', shoe: '#ffffff' };

    const speed = Math.hypot(p.vx, p.vz);
    p.runPhase = (p.runPhase || 0) + speed * dt * 5.6;
    const moving = speed > 0.4;
    const airborne = p.y > 0.06;
    const H = 1.78 * s;

    this.drawShadow(g, p.x, p.z, 0.55, 1, p.y);

    g.save();
    g.translate(base.x, base.y);
    if (Math.abs(p.vz) > 0.3) g.rotate(clamp(-p.vz * 0.035, -0.08, 0.08));

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
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = width * 0.7;
      g.beginPath();
      g.moveTo(lerp(kneeX, footX, 0.74), lerp(kneeY, footY, 0.74));
      g.lineTo(footX, footY);
      g.stroke();
      g.fillStyle = shoeCol;
      g.beginPath();
      g.ellipse(footX + dir * H * 0.020, footY + H * 0.002, H * 0.052, H * 0.023, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = side < 0 ? 'rgba(209,68,32,0.9)' : 'rgba(20,107,168,0.9)';
      g.beginPath();
      g.ellipse(footX + dir * H * 0.020, footY + H * 0.014, H * 0.052, H * 0.008, 0, 0, Math.PI * 2);
      g.fill();
    };

    drawLeg(legL * 0.9, H * 0.052, kit.skin2, '#e9eef4', H * 0.079);

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

    g.fillStyle = side < 0 ? 'rgba(38, 52, 70, 0.95)' : 'rgba(28, 44, 62, 0.95)';
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

    g.fillStyle = 'rgba(255,255,255,0.2)';
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
      const a = Math.sin((1 - swing) * Math.PI) * 0.45;
      g.save();
      g.globalAlpha = a;
      g.strokeStyle = 'rgba(80, 200, 255, 0.95)';
      g.lineWidth = H * 0.018;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(rBaseX, rBaseY, racketLen * 0.66, racketAng - 0.9 * dir, racketAng + 0.55 * dir, dir < 0);
      g.stroke();
      g.restore();
    }

    g.strokeStyle = '#37485c';
    g.lineWidth = H * 0.021;
    g.beginPath();
    g.moveTo(rBaseX, rBaseY);
    g.lineTo(rBaseX + Math.cos(racketAng) * racketLen * 0.4 * dir, rBaseY + Math.sin(racketAng) * racketLen * 0.4);
    g.stroke();

    g.save();
    g.translate(rcx, rcy);
    g.rotate(racketAng * dir);
    g.strokeStyle = 'rgba(52, 74, 96, 0.95)';
    g.lineWidth = H * 0.016;
    g.beginPath();
    g.ellipse(0, 0, racketLen * 0.285, racketLen * 0.215, 0, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(120, 150, 175, 0.6)';
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

    g.fillStyle = 'rgba(30, 24, 20, 0.9)';
    g.beginPath();
    g.ellipse(dir * headR * 0.4, headCY + headR * 0.08, headR * 0.085, headR * 0.115, 0, 0, Math.PI * 2);
    g.fill();

    g.restore();

    if (isLocal) {
      g.strokeStyle = side < 0 ? 'rgba(226, 92, 52, 0.6)' : 'rgba(24, 128, 196, 0.6)';
      g.lineWidth = Math.max(1, H * 0.008);
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
      const col = p.charge > 0.78 ? '#ef9a2c' : p.charge > 0.45 ? '#16a97f' : '#7f9ab5';
      g.fillStyle = 'rgba(255, 255, 255, 0.72)';
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
    const r = Math.max(2.8, p.s * 0.058);

    if (b.active) this.trail.push({ x: p.x, y: p.y, t: this.time, s: p.s });
    if (this.trail.length > 26) this.trail.shift();

    this.drawShadow(g, b.x, b.z, 0.16, 0.8, b.y);

    if (b.active) {
      g.save();
      for (let i = 0; i < this.trail.length - 1; i++) {
        const a = this.trail[i];
        const c = this.trail[i + 1];
        const age = this.time - c.t;
        if (age > 0.18) continue;
        const al = (1 - age / 0.18) * 0.28 * clamp(spd / 22, 0.3, 1);
        g.strokeStyle = `rgba(255, 255, 255, ${al})`;
        g.lineWidth = r * (0.4 + (1 - age / 0.18) * 0.9);
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke();
      }
      g.restore();
    }

    const ang = spd > 0.5 ? Math.atan2(-b.vy, b.vx) : -Math.PI / 2;
    const stretch = clamp(spd / 50, 0, 1);

    g.save();
    g.translate(p.x, p.y);
    g.rotate(ang);

    const skirtLen = r * (1.95 + stretch * 1.0);
    const skirtW = r * 1.5;
    g.fillStyle = 'rgba(255, 255, 255, 0.98)';
    g.strokeStyle = 'rgba(96, 128, 152, 0.7)';
    g.lineWidth = Math.max(0.5, r * 0.16);
    g.beginPath();
    g.moveTo(r * 0.15, -skirtW * 0.33);
    g.quadraticCurveTo(-skirtLen * 0.5, -skirtW * 0.72, -skirtLen, -skirtW);
    g.lineTo(-skirtLen, skirtW);
    g.quadraticCurveTo(-skirtLen * 0.5, skirtW * 0.72, r * 0.15, skirtW * 0.33);
    g.closePath();
    g.fill();
    g.stroke();

    g.strokeStyle = 'rgba(128, 158, 182, 0.55)';
    g.lineWidth = Math.max(0.4, r * 0.07);
    for (let i = -3; i <= 3; i++) {
      g.beginPath();
      g.moveTo(r * 0.06, i * skirtW * 0.16);
      g.lineTo(-skirtLen * 0.95, i * skirtW * 0.82);
      g.stroke();
    }

    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(96, 128, 152, 0.85)';
    g.lineWidth = Math.max(0.6, r * 0.16);
    g.beginPath();
    g.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    g.restore();
  }

  drawLandingHint(g) {
    const h = this.landing;
    if (!h) return;
    const p = this.project(h.x, 0, h.z || 0);
    const rx = Math.max(10, p.s * 0.4);
    const col = h.out ? '226, 62, 78' : '18, 152, 118';
    g.save();
    g.strokeStyle = `rgba(${col}, 0.85)`;
    g.lineWidth = Math.max(1.2, p.s * 0.012);
    g.setLineDash([Math.max(3, p.s * 0.05), Math.max(3, p.s * 0.045)]);
    g.lineDashOffset = -this.time * 26;
    g.beginPath();
    g.ellipse(p.x, p.y, rx, rx * 0.34, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = `rgba(${col}, 0.16)`;
    g.beginPath();
    g.ellipse(p.x, p.y, rx * 0.42, rx * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  spawnHitFx(x, y, z, side, power) {
    this.fx.push({ type: 'ring', x, y, z, t: 0, life: 0.4, color: side < 0 ? '232, 96, 56' : '30, 140, 208', r1: 0.9 + power * 0.7 });
    this.fx.push({ type: 'burst', x, y, z, t: 0, life: 0.28, color: side < 0 ? '255, 176, 140' : '150, 214, 248', n: 9, power });
    if (power > 0.78) this.shake = Math.max(this.shake, 4);
  }

  spawnLandFx(x, z, scorer) {
    this.fx.push({ type: 'land', x, z, t: 0, life: 0.55, color: scorer < 0 ? '232, 96, 56' : '30, 140, 208' });
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
          g.strokeStyle = `rgba(${f.color}, ${(1 - k) * 0.75})`;
          g.lineWidth = Math.max(1.5, p.s * 0.032 * (1 - k));
          g.beginPath();
          g.ellipse(p.x, p.y, r, r * 0.75, 0, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        } else {
          g.save();
          for (let i = 0; i < f.n; i++) {
            const a = (i / f.n) * Math.PI * 2 + 0.42;
            const d = lerp(0.06, 0.7 + f.power * 0.45, k);
            const q = this.project(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.75, f.z);
            g.fillStyle = `rgba(${f.color}, ${(1 - k) * 0.8})`;
            g.beginPath();
            g.arc(q.x, q.y, Math.max(0.9, q.s * 0.024 * (1 - k)), 0, Math.PI * 2);
            g.fill();
          }
          g.restore();
        }
      } else if (f.type === 'land') {
        const p = this.project(f.x, 0, f.z);
        const r = lerp(0.08, 0.95, k) * p.s;
        g.save();
        g.strokeStyle = `rgba(${f.color}, ${(1 - k) * 0.6})`;
        g.lineWidth = Math.max(1.3, p.s * 0.022 * (1 - k));
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
        g.lineWidth = size * 0.16;
        g.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        g.strokeText(f.text, 0, 0);
        g.fillStyle = f.color || THEME.ink;
        g.fillText(f.text, 0, 0);
        if (f.sub) {
          g.font = `700 ${size * 0.24}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
          g.lineWidth = size * 0.06;
          g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          g.strokeText(f.sub, 0, size * 0.56);
          g.fillStyle = 'rgba(28, 48, 68, 0.85)';
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

    g.fillStyle = '#e6eef6';
    g.fillRect(0, 0, this.W, this.H);
    if (this.bg) g.drawImage(this.bg, 0, 0, this.W, this.H);

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
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.3})`;
      g.fillRect(0, 0, this.W, this.H);
    }

    g.restore();
  }
}
