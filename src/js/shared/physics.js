import { PHYS, COURT, BALL } from './constants.js';

const G = PHYS.G;
const K = PHYS.DRAG;
const SIM_H = 1 / 110;

export function netHeightAt(x) {
  const t = Math.min(1, Math.abs(x) / COURT.HALF_LENGTH);
  return COURT.NET_CENTER + (COURT.NET_POST - COURT.NET_CENTER) * t * t;
}

export function integrate3(s, dt) {
  const steps = Math.max(1, Math.ceil(dt / PHYS.SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const d = K * sp * h;
    s.vx -= d * s.vx;
    s.vy -= d * s.vy + G * h;
    s.vz -= d * s.vz;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.z += s.vz * h;
  }
  return s;
}

export function simulateLanding3(x0, y0, z0, vx, vy, vz, maxT = 7.5) {
  let x = x0, y = y0, z = z0;
  let cvx = vx, cvy = vy, cvz = vz;
  let t = 0;
  let crossed = false;
  const startSide = Math.sign(x0) || 1;
  while (t < maxT) {
    const sp = Math.hypot(cvx, cvy, cvz);
    const d = K * sp;
    cvx -= d * cvx * SIM_H;
    cvy -= (d * cvy + G) * SIM_H;
    cvz -= d * cvz * SIM_H;
    const px = x, py = y;
    x += cvx * SIM_H;
    y += cvy * SIM_H;
    z += cvz * SIM_H;
    t += SIM_H;
    if (!crossed && x * startSide < 0) {
      crossed = true;
      const f = Math.abs(px) / Math.max(1e-6, Math.abs(px) + Math.abs(x));
      const cy = py + (y - py) * f;
      if (cy < netHeightAt(0) + BALL.R * 0.5 && Math.abs(z) < COURT.NET_HALF_WIDTH) {
        return { x, y: cy, z, t, netHit: true };
      }
    }
    if (y <= BALL.R && cvy < 0) {
      const prevY = y - cvy * SIM_H;
      const fy = Math.max(0, Math.min(1, (prevY - BALL.R) / Math.max(1e-6, prevY - y)));
      return {
        x: x - cvx * SIM_H * (1 - fy),
        y: BALL.R,
        z: z - cvz * SIM_H * (1 - fy),
        t: t - SIM_H * (1 - fy),
        netHit: false,
      };
    }
  }
  return { x, y, z, t, netHit: false };
}

export function predictLanding3(x, y, z, vx, vy, vz, maxT = 8) {
  return simulateLanding3(x, y, z, vx, vy, vz, maxT);
}

export function traceAtHeight(x, y, z, vx, vy, vz, targetY, maxT = 6) {
  let cx = x, cy = y, cz = z, cvx = vx, cvy = vy, cvz = vz;
  let t = 0;
  let started = y > targetY;
  while (t < maxT) {
    const sp = Math.hypot(cvx, cvy, cvz);
    const d = K * sp;
    cvx -= d * cvx * SIM_H;
    cvy -= (d * cvy + G) * SIM_H;
    cvz -= d * cvz * SIM_H;
    cx += cvx * SIM_H;
    cy += cvy * SIM_H;
    cz += cvz * SIM_H;
    t += SIM_H;
    if (!started) {
      if (cy > targetY) started = true;
      else continue;
    }
    if (cvy < 0 && cy <= targetY) return { x: cx, y: cy, z: cz, t, ok: true };
    if (cy < -0.2) break;
  }
  return { x: cx, y: cy, z: cz, t, ok: false };
}

const SHOT_ANGLE = {
  clear: 50, lift: 58, drop: 25, net: 19, drive: 10, smash: -13,
  serveLow: 24, serveHigh: 50,
};

const SHOT_DEPTH = {
  clear: [0.55, 2.85],
  lift: [0.55, 2.45],
  drop: [1.05, 2.30],
  net: [0.62, 1.35],
  drive: [3.90, 6.10],
  smash: [2.40, 3.95],
  serveLow: [1.50, 2.10],
  serveHigh: [0.55, 1.75],
};

const SHOT_POWER = {
  clear: 0.62, lift: 0.58, drop: 0.34, net: 0.30,
  drive: 0.85, smash: 1.0, serveLow: 0.26, serveHigh: 0.58,
};

function solveSpeed(hx, hy, hz, ux, uz, angleDeg, dist, maxSpeed) {
  const rad = angleDeg * Math.PI / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  let lo = 2.4;
  let hi = maxSpeed;
  let best = null;
  for (let i = 0; i < 15; i++) {
    const v = (lo + hi) * 0.5;
    const vx = cosA * v * ux;
    const vz = cosA * v * uz;
    const vy = sinA * v;
    const land = simulateLanding3(hx, hy, hz, vx, vy, vz);
    const traveled = land.netHit ? -99 : Math.hypot(land.x - hx, land.z - hz);
    if (traveled < dist) lo = v; else hi = v;
    best = { vx, vy, vz, land, speed: v };
  }
  return best;
}

export function buildShot(kind, opts) {
  const {
    hx, hy, hz, side, charge = 0.6, aimX = 0, aimZ = 0, aiming = null,
  } = opts;
  const c = Math.max(0, Math.min(1, charge));
  const dirX = -Math.sign(side) || -1;

  const depthRange = SHOT_DEPTH[kind] || SHOT_DEPTH.clear;
  const t = 1 - c;
  const depth = depthRange[0] + (depthRange[1] - depthRange[0]) * t;

  let targetX = (COURT.HALF_LENGTH - depth) * dirX + aimX;
  const lim = COURT.HALF_LENGTH + 1.35;
  targetX = Math.max(-lim, Math.min(lim, targetX));

  let targetZ;
  if (aiming && Number.isFinite(aiming.z)) {
    targetZ = aiming.z;
  } else {
    const laneBias = Math.max(-1, Math.min(1, aimZ));
    targetZ = laneBias * (COURT.HALF_WIDTH - 0.55);
  }
  targetZ = Math.max(-COURT.HALF_WIDTH - 0.8, Math.min(COURT.HALF_WIDTH + 0.8, targetZ));

  let dx = targetX - hx;
  let dz = targetZ - hz;
  let dist = Math.hypot(dx, dz);
  if (dist < 0.05) { dx = dirX; dz = 0; dist = 0.05; }
  const ux = dx / dist;
  const uz = dz / dist;

  let angle = SHOT_ANGLE[kind] ?? 50;
  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = solveSpeed(hx, hy, hz, ux, uz, angle, dist, 76);
    if (!result.land.netHit) break;
    if (kind === 'smash' || kind === 'drive') angle *= 0.55;
    else angle += 7;
  }

  return {
    vx: result.vx,
    vy: result.vy,
    vz: result.vz,
    speed: result.speed,
    flightTime: result.land.t,
    landX: result.land.x,
    landZ: result.land.z,
    power: (SHOT_POWER[kind] ?? 0.6),
  };
}
