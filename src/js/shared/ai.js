import { COURT, PLAYER } from './constants.js';
import { traceAtHeight, predictLanding3 } from './physics.js';

export const DIFFICULTY = {
  easy: { react: 0.24, speed: 0.82, err: 1.05, aggr: 0.16, whiff: 0.16, aim: 1.30, lane: 0.40, label: '轻松' },
  normal: { react: 0.18, speed: 0.93, err: 0.95, aggr: 0.38, whiff: 0.16, aim: 1.05, lane: 0.55, label: '普通' },
  hard: { react: 0.10, speed: 1.01, err: 0.60, aggr: 0.66, whiff: 0.09, aim: 0.65, lane: 0.70, label: '困难' },
  pro: { react: 0.04, speed: 1.09, err: 0.15, aggr: 0.84, whiff: 0.012, aim: 0.28, lane: 0.85, label: '职业' },
};

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class AI {
  constructor(side, level = 'normal') {
    this.side = side;
    this.setLevel(level);
    this.reset();
  }

  setLevel(level) {
    this.level = level;
    this.cfg = DIFFICULTY[level] || DIFFICULTY.normal;
  }

  reset() {
    this.time = 0;
    this.track = null;
    this.trackAge = 0;
    this.wasIncoming = false;
    this.hold = false;
    this.holdTime = 0;
    this.targetCharge = 0.6;
    this.wantDown = false;
    this.released = false;
    this.releaseTimer = 0;
    this.servePhase = 0;
    this.serveTimer = 0;
    this.highServe = false;
    this.errX = 0;
    this.errZ = 0;
    this.aimError = 0;
    this.attackBias = 0;
    this.whiffBias = 0;
    this.reactLeft = 0;
    this.steerZ = 0;
  }

  update(world, dt) {
    const idx = this.side < 0 ? 0 : 1;
    const p = world.players[idx];
    const b = world.ball;
    this.time += dt;
    const inp = { ax: 0, az: 0, jump: false, swingHeld: false, charge: 0, down: false };

    if (world.phase === 'over') { this.hold = false; return inp; }
    if (this.releaseTimer > 0) {
      this.releaseTimer -= dt;
      if (this.releaseTimer <= 0) this.released = false;
    }

    if (world.phase === 'serve') return this.serveLogic(world, p, inp, dt);

    if (world.phase === 'point') {
      this.track = null;
      this.wasIncoming = false;
      this.hold = false;
      this.servePhase = 0;
      this.moveTo(p, this.side * 2.9, 0, inp, 1);
      return inp;
    }

    const incoming = b.active && b.vx * this.side > 0.12;

    if (!incoming) {
      this.track = null;
      this.wasIncoming = false;
      this.hold = false;
      this.wantDown = false;
      this.moveTo(p, this.side * (1.95 + (1 - this.cfg.aggr) * 0.85), 0, inp, this.cfg.speed);
      this.reactLeft = this.cfg.react;
      return inp;
    }

    if (!this.wasIncoming) {
      this.wasIncoming = true;
      this.decideShot(b);
    }

    this.trackAge -= dt;
    if (!this.track || this.trackAge <= 0) {
      this.refreshTrack(b);
      this.trackAge = 0.09;
    }

    const tr = this.track;
    this.moveTo(p, this.clampSide(tr.aimX), clamp(tr.aimZ, -COURT.HALF_WIDTH - 0.3, COURT.HALF_WIDTH + 0.3), inp, this.cfg.speed);

    const remaining = tr.hit.t - (this.time - tr.born);
    const planar = Math.hypot(b.x - p.x, b.z - p.z);
    const reachable = b.y < p.y + PLAYER.REACH_UP + 0.1 && b.y > 0.02;

    if (tr.attack) {
      this.targetCharge = 0.9;
      this.wantDown = true;
      if (b.y > 2.1 && b.y < 3.35 && planar < 0.82 && p.onGround && !this.released) {
        inp.jump = true;
      }
    } else if (b.y > 2.25) {
      this.targetCharge = 0.72;
      this.wantDown = false;
    } else if (b.y > 1.1) {
      this.targetCharge = 0.58;
      this.wantDown = false;
    } else {
      this.targetCharge = 0.66;
      this.wantDown = false;
    }

    if (!this.hold && !this.released) {
      const lead = this.targetCharge * PLAYER.CHARGE_TIME + 0.04;
      const nearNow = planar < PLAYER.REACH_X * 1.02 && reachable;
      if (nearNow || (remaining > 0 && remaining <= lead)) {
        this.hold = true;
        this.holdTime = 0;
      }
    }

    if (this.hold) {
      this.holdTime += dt;
      const charge = Math.min(1, this.holdTime / PLAYER.CHARGE_TIME);
      const inRange = planar < PLAYER.REACH_X + 0.04 && reachable;
      const ready = charge >= Math.min(this.targetCharge, 0.1) - 0.04;
      if ((inRange && ready) || charge >= 0.995) {
        inp.charge = charge;
        inp.down = this.wantDown || p.y > 0.18;
        inp.swingHeld = false;
        inp.aimError = this.aimError;
        inp.az = this.steerZ * this.cfg.lane;
        this.hold = false;
        this.released = true;
        this.releaseTimer = 0.4;
        this.track = null;
        return inp;
      }
      inp.swingHeld = true;
      inp.charge = charge;
    }

    return inp;
  }

  moveTo(p, targetX, targetZ, inp, speed) {
    const dx = targetX - p.x;
    const dz = targetZ - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.07) {
      const k = Math.min(1, d * 1.6) * speed;
      inp.ax = (dx / d) * k;
      inp.az = (dz / d) * k;
    }
  }

  decideShot(b) {
    this.errX = (Math.random() - 0.5) * this.cfg.err;
    this.errZ = (Math.random() - 0.5) * this.cfg.err * 1.4;
    this.aimError = (Math.random() - 0.5) * this.cfg.aim;
    this.attackBias = Math.random();
    this.whiffBias = Math.random();
    this.steerZ = (Math.random() - 0.5) * 2;
    this.trackAge = 0;
    this.refreshTrack(b);
  }

  refreshTrack(b) {
    const hi = traceAtHeight(b.x, b.y, b.z, b.vx, b.vy, b.vz, 2.72);
    const mid = traceAtHeight(b.x, b.y, b.z, b.vx, b.vy, b.vz, 2.12);
    const low = traceAtHeight(b.x, b.y, b.z, b.vx, b.vy, b.vz, 1.28);
    const land = predictLanding3(b.x, b.y, b.z, b.vx, b.vy, b.vz);

    const inCourt = Math.abs(land.x) < COURT.HALF_LENGTH + 0.05
      && Math.abs(land.z) < COURT.HALF_WIDTH + 0.05;
    const prevAttack = this.track ? this.track.attack : false;

    let attack = false;
    if (inCourt && hi.ok && hi.t > 0.12 && Math.abs(hi.x) < COURT.HALF_LENGTH - 0.3) {
      attack = this.attackBias < this.cfg.aggr;
    }
    if (prevAttack && hi.ok && hi.t > 0.05) attack = true;

    let hit;
    if (attack) hit = hi;
    else if (mid.ok && mid.t > 0.02) hit = mid;
    else if (low.ok && low.t > 0.02) hit = low;
    else if (hi.ok && hi.t > 0.02) hit = hi;
    else hit = land;

    let aimX = hit.x + this.errX;
    let aimZ = (hit.z || 0) + this.errZ;

    if (this.whiffBias < this.cfg.whiff) {
      aimZ += (this.whiffBias < this.cfg.whiff / 2 ? 1 : -1) * (1.0 + this.whiffBias * 4);
    }

    if (Math.abs(land.x) > COURT.HALF_LENGTH + 0.12 || Math.abs(land.z) > COURT.HALF_WIDTH + 0.12) {
      aimX = this.side * 3.1;
      aimZ = 0;
      attack = false;
      hit = { t: 99, x: aimX, z: 0, ok: false };
    }

    this.track = { attack, hit, aimX, aimZ, land, born: this.time };
  }

  clampSide(x) {
    if (this.side < 0) return clamp(x, -COURT.HALF_LENGTH - 0.35, -0.78);
    return clamp(x, 0.78, COURT.HALF_LENGTH + 0.35);
  }

  serveLogic(world, p, inp, dt) {
    if (world.server !== this.side) {
      this.moveTo(p, this.side * 3.15, 0, inp, 1);
      this.servePhase = 0;
      this.serveTimer = 0;
      return inp;
    }

    if (this.servePhase === 0) {
      this.servePhase = 1;
      this.serveTimer = 0;
      this.highServe = Math.random() < 0.45;
    }

    if (this.servePhase === 1) {
      this.serveTimer += dt;
      const holdFor = this.highServe ? 0.45 : 0.17;
      if (this.serveTimer < holdFor) {
        inp.swingHeld = true;
        inp.charge = Math.min(1, this.serveTimer / PLAYER.CHARGE_TIME);
        inp.az = Math.sin(this.time * 0.9) * 0.5;
        return inp;
      }
      inp.swingHeld = false;
      inp.charge = Math.min(1, holdFor / PLAYER.CHARGE_TIME);
      this.servePhase = 3;
      this.serveTimer = 0;
      return inp;
    }

    if (this.servePhase === 3) {
      this.serveTimer += dt;
      if (this.serveTimer > 0.6) this.servePhase = 0;
    }
    return inp;
  }
}
