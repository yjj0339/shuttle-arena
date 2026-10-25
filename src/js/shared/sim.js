import { COURT, PHYS, BALL, PLAYER, RULES, SHOT } from './constants.js';
import { integrate3, buildShot } from './physics.js';

const SIDE_L = -1;
const SIDE_R = 1;
const SIDES = [SIDE_L, SIDE_R];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function idxOf(side) { return side < 0 ? 0 : 1; }

export function classifyShot(h, charge, down) {
  if (h > 2.28) {
    if (down && charge > 0.42) return SHOT.SMASH;
    if (charge > 0.58) return SHOT.CLEAR;
    return SHOT.DROP;
  }
  if (h > 1.55) {
    if (down && charge > 0.35) return SHOT.DRIVE;
    if (charge > 0.62) return SHOT.CLEAR;
    if (charge > 0.34) return SHOT.DRIVE;
    return SHOT.LIFT;
  }
  if (charge < 0.38) return SHOT.NET;
  return SHOT.LIFT;
}

export function makePlayer(side) {
  return {
    side,
    x: side * 2.6,
    z: 0,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    onGround: true,
    charging: false,
    charge: 0,
    cooldown: 0,
    jumpLatch: false,
    swingAnim: 0,
    lungeT: 0,
    lastKind: '',
    aimError: 0,
    inputAx: 0,
    inputAz: 0,
    inputDown: false,
    inputJump: false,
  };
}

export class World {
  constructor() {
    this.players = [makePlayer(SIDE_L), makePlayer(SIDE_R)];
    this.ball = {
      x: -2.6, y: RULES.SERVE_HEIGHT, z: 0,
      vx: 0, vy: 0, vz: 0,
      active: false, netHit: false, sideLock: null,
    };
    this.score = [0, 0];
    this.phase = 'serve';
    this.phaseTimer = 0;
    this.server = SIDE_L;
    this.lastHitter = null;
    this.rally = 0;
    this.events = [];
    this.tick = 0;
    this.pending = [null, null];
    this.winner = 0;
    this.pointInfo = null;
    this.resetPositions();
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  resetPositions() {
    const s = this.server;
    const sp = this.players[idxOf(s)];
    const rp = this.players[idxOf(-s)];
    sp.x = s * 2.55; sp.z = 0;
    rp.x = -s * 3.05; rp.z = 0;
    for (const p of this.players) {
      p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0; p.onGround = true;
      p.charging = false; p.charge = 0; p.cooldown = 0; p.lungeT = 0;
      p.inputAx = 0; p.inputAz = 0; p.inputJump = false;
    }
    this.pending[0] = null;
    this.pending[1] = null;
    this.syncServeBall();
  }

  syncServeBall() {
    const s = this.server;
    const p = this.players[idxOf(s)];
    const b = this.ball;
    b.x = p.x - s * RULES.SERVE_DIST;
    b.z = p.z * 0.85;
    b.y = RULES.SERVE_HEIGHT + p.y * 0.2;
    b.vx = 0; b.vy = 0; b.vz = 0;
    b.active = false;
    b.netHit = false;
    b.sideLock = null;
  }

  setInput(side, inp) {
    const p = this.players[idxOf(side)];
    if (!p) return;
    p.inputAx = clamp(inp.ax || 0, -1, 1);
    p.inputAz = clamp(inp.az || 0, -1, 1);
    p.inputDown = !!inp.down;
    p.inputJump = !!inp.jump;
    if (typeof inp.aimError === 'number') p.aimError = inp.aimError;
    const wantCharge = !!inp.swingHeld;

    if (this.phase === 'serve' && side === this.server) {
      if (wantCharge && !p.charging) {
        p.charging = true;
        p.charge = 0;
      } else if (!wantCharge && p.charging) {
        p.charging = false;
        const c = clamp(typeof inp.charge === 'number' ? inp.charge : p.charge, 0, 1);
        p.charge = 0;
        this.doServe(side, c, p.inputDown);
      }
      return;
    }

    if (wantCharge && !p.charging && p.cooldown <= 0) {
      p.charging = true;
      p.charge = 0;
    } else if (!wantCharge && p.charging) {
      p.charging = false;
      const c = clamp(typeof inp.charge === 'number' ? inp.charge : p.charge, 0, 1);
      p.charge = 0;
      this.pending[idxOf(side)] = { charge: c, down: p.inputDown, az: p.inputAz, life: 0.56 };
      p.lungeT = PLAYER.LUNGE_LEAD;
    }
  }

  doServe(side, charge) {
    if (this.phase !== 'serve') return;
    const p = this.players[idxOf(side)];
    const b = this.ball;
    const kind = charge > 0.46 ? SHOT.SERVE_HIGH : SHOT.SERVE_LOW;
    const targetZ = clamp(
      b.z * 0.3 + p.inputAz * (COURT.HALF_WIDTH - 0.55) + (Math.random() - 0.5) * 0.32,
      -COURT.HALF_WIDTH + 0.28, COURT.HALF_WIDTH - 0.28
    );
    const shot = buildShot(kind, {
      hx: b.x, hy: b.y, hz: b.z, side, charge,
      aiming: { z: targetZ },
    });
    b.vx = shot.vx; b.vy = shot.vy; b.vz = shot.vz;
    b.active = true;
    b.netHit = false;
    b.sideLock = null;
    this.lastHitter = side;
    this.rally = 1;
    this.phase = 'rally';
    this.phaseTimer = 0;
    p.swingAnim = 1;
    p.lastKind = kind;
    this.emit('hit', { side, kind, x: b.x, y: b.y, z: b.z, power: shot.power, serve: true });
  }

  tryHit(side, charge, down, az) {
    const p = this.players[idxOf(side)];
    const b = this.ball;
    if (this.phase !== 'rally' || !b.active) return false;
    if (b.sideLock === side) return false;

    const planar = Math.hypot(b.x - p.x, b.z - p.z);
    if (planar > PLAYER.REACH_X + 0.18) return false;
    if (b.y > p.y + PLAYER.REACH_UP) return false;
    if (b.y < 0.02) return false;
    if (b.x * side < -0.08) return false;

    const kind = classifyShot(b.y, charge, down);
    const steer = typeof az === 'number' ? az : p.inputAz;
    const targetZ = clamp(
      b.z * 0.32 + steer * (COURT.HALF_WIDTH - 0.42) + (p.aimError || 0) * 0.8,
      -COURT.HALF_WIDTH - 0.10, COURT.HALF_WIDTH + 0.10
    );

    const shot = buildShot(kind, {
      hx: b.x, hy: b.y, hz: b.z, side, charge,
      aimX: (Math.random() - 0.5) * 0.4,
      aiming: { z: targetZ },
    });

    b.vx = shot.vx; b.vy = shot.vy; b.vz = shot.vz;
    b.sideLock = side;
    b.netHit = false;
    this.lastHitter = side;
    this.rally++;
    p.swingAnim = 1;
    p.lastKind = kind;
    p.cooldown = PLAYER.SWING_CD;
    this.emit('hit', { side, kind, x: b.x, y: b.y, z: b.z, power: shot.power });
    return true;
  }

  stepPlayer(p, dt) {
    const ax = p.inputAx || 0;
    const az = p.inputAz || 0;
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.lungeT > 0) p.lungeT -= dt;
    if (p.charging) p.charge = Math.min(1, p.charge + dt / PLAYER.CHARGE_TIME);
    if (p.swingAnim > 0) p.swingAnim = Math.max(0, p.swingAnim - dt * 3.1);

    let tx = 0;
    let tz = 0;
    if (!(this.phase === 'serve' && p.side === this.server)) {
      const mag = Math.hypot(ax, az);
      const scale = mag > 1 ? 1 / mag : 1;
      const spd = PLAYER.MOVE_SPEED * (p.charging ? 0.74 : 1);
      tx = ax * scale * spd;
      tz = az * scale * spd;
    }

    const stepV = (cur, target) => {
      if (target === 0) {
        const dv = PLAYER.DECEL * dt;
        return Math.abs(cur) <= dv ? 0 : cur - Math.sign(cur) * dv;
      }
      const accel = Math.abs(target) > Math.abs(cur) ? PLAYER.ACCEL : PLAYER.DECEL;
      const dv = accel * dt;
      return Math.abs(target - cur) <= dv ? target : cur + Math.sign(target - cur) * dv;
    };
    p.vx = stepV(p.vx, tx);
    p.vz = stepV(p.vz, tz);

    p.x += p.vx * dt;
    p.z += p.vz * dt;

    const near = 0.78;
    if (p.side === SIDE_L) p.x = clamp(p.x, -COURT.HALF_LENGTH - 0.6, -near);
    else p.x = clamp(p.x, near, COURT.HALF_LENGTH + 0.6);
    p.z = clamp(p.z, -COURT.HALF_WIDTH - 0.55, COURT.HALF_WIDTH + 0.55);

    if (p.inputJump && p.onGround && !p.jumpLatch) {
      p.vy = PLAYER.JUMP_V;
      p.onGround = false;
      p.jumpLatch = true;
    }
    if (!p.inputJump) p.jumpLatch = false;

    if (!p.onGround) {
      p.vy -= PHYS.G * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
    }
  }

  stepBall(dt) {
    const b = this.ball;
    if (!b.active) return;
    const prevX = b.x;
    const prevY = b.y;

    integrate3(b, dt);

    if (prevX !== 0 && prevX * b.x < 0 && Math.abs(b.z) < COURT.NET_HALF_WIDTH) {
      const denom = Math.abs(prevX) + Math.abs(b.x);
      const f = denom > 1e-9 ? Math.abs(prevX) / denom : 0.5;
      const crossY = prevY + (b.y - prevY) * f;
      const nh = COURT.NET_CENTER;
      if (crossY < nh + BALL.R * 0.8) {
        b.x = prevX + (b.x - prevX) * Math.max(0, f - 0.02);
        b.y = crossY;
        b.vx = -b.vx * BALL.NET_BOUNCE;
        b.vz *= 0.35;
        b.vy = Math.abs(b.vy) * 0.18 + 0.15;
        b.netHit = true;
        b.sideLock = null;
        this.emit('net', { x: 0, y: crossY, z: b.z, speed: Math.hypot(b.vx, b.vy, b.vz) });
      }
    }

    if (b.y <= BALL.R && b.vy < 0) {
      b.y = BALL.R;
      this.land();
    }
  }

  land() {
    const b = this.ball;
    b.active = false;
    const landX = b.x;
    const landZ = b.z;
    const hitter = this.lastHitter;
    const inX = Math.abs(landX) <= COURT.HALF_LENGTH + 0.015;
    const inZ = Math.abs(landZ) <= COURT.HALF_WIDTH + 0.015;
    const out = !inX || !inZ;
    let scorer;
    let reason;
    if (hitter == null) {
      scorer = -this.server;
      reason = 'no-hit';
    } else if (out) {
      scorer = -hitter;
      reason = 'out';
    } else if (Math.sign(landX) === Math.sign(hitter)) {
      scorer = -hitter;
      reason = b.netHit ? 'net' : 'own-court';
    } else {
      scorer = hitter;
      reason = 'winner';
    }
    this.emit('land', { x: landX, y: BALL.R, z: landZ, out, netHit: !!b.netHit, scorer });
    this.awardPoint(scorer, reason, landX, landZ);
  }

  awardPoint(scorer, reason, landX, landZ) {
    this.score[idxOf(scorer)]++;
    this.server = scorer;
    this.lastHitter = null;
    this.phase = 'point';
    this.phaseTimer = RULES.POINT_PAUSE;
    this.pointInfo = { scorer, reason, landX, landZ, rally: this.rally };
    this.rally = 0;
    this.emit('point', { scorer, reason, landX, landZ });

    const a = this.score[0];
    const c = this.score[1];
    const win = (s, o) => (s >= RULES.TARGET_POINTS && s - o >= RULES.WIN_BY) || s >= RULES.HARD_CAP;
    if (win(a, c) || win(c, a)) {
      this.winner = a > c ? 1 : -1;
      this.phase = 'over';
      this.emit('gameover', { winner: this.winner, score: [a, c] });
    }
  }

  step(dt) {
    this.tick++;
    dt = Math.min(dt, PHYS.MAX_STEP);

    if (this.phase === 'over') {
      for (const p of this.players) this.stepPlayer(p, dt);
      return;
    }

    if (this.phase === 'point') {
      this.phaseTimer -= dt;
      for (const p of this.players) this.stepPlayer(p, dt);
      if (this.ball.active) this.stepBall(dt);
      if (this.phaseTimer <= 0) {
        this.phase = 'serve';
        this.phaseTimer = 0;
        this.resetPositions();
      }
      return;
    }

    if (this.phase === 'serve') {
      for (const p of this.players) this.stepPlayer(p, dt);
      this.syncServeBall();
      return;
    }

    for (const p of this.players) this.stepPlayer(p, dt);

    for (let i = 0; i < 2; i++) {
      const pend = this.pending[i];
      if (!pend) continue;
      pend.life -= dt;
      const side = SIDES[i];
      if (this.tryHit(side, pend.charge, pend.down, pend.az)) {
        this.pending[i] = null;
      } else if (pend.life <= 0) {
        this.pending[i] = null;
        this.emit('whiff', { side });
      }
    }

    this.stepBall(dt);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot() {
    const b = this.ball;
    return {
      tk: this.tick,
      b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.active ? 1 : 0],
      p: this.players.map((p) => [
        r2(p.x), r2(p.z), r2(p.y),
        r2(p.vx), r2(p.vz), r2(p.vy),
        r2(p.charge), p.charging ? 1 : 0, r2(p.cooldown),
        r2(p.swingAnim), r2(p.lungeT), p.lastKind || '',
      ]),
      s: [this.score[0], this.score[1]],
      ph: this.phase,
      sv: this.server,
      lh: this.lastHitter || 0,
      rt: r2(this.phaseTimer),
      rl: this.rally,
      w: this.winner,
      pi: this.pointInfo,
    };
  }

  applySnapshot(s) {
    const b = this.ball;
    b.x = s.b[0]; b.y = s.b[1]; b.z = s.b[2];
    b.vx = s.b[3]; b.vy = s.b[4]; b.vz = s.b[5];
    b.active = !!s.b[6];
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      const q = s.p[i];
      p.x = q[0]; p.z = q[1]; p.y = q[2];
      p.vx = q[3]; p.vz = q[4]; p.vy = q[5];
      p.charge = q[6]; p.charging = !!q[7]; p.cooldown = q[8];
      p.swingAnim = q[9]; p.lungeT = q[10]; p.lastKind = q[11];
      p.onGround = p.y <= 0.001;
      p.inputAx = 0; p.inputAz = 0;
    }
    this.score[0] = s.s[0];
    this.score[1] = s.s[1];
    this.phase = s.ph;
    this.server = s.sv;
    this.lastHitter = s.lh || null;
    this.phaseTimer = s.rt;
    this.rally = s.rl;
    this.winner = s.w || 0;
    this.pointInfo = s.pi || null;
  }
}

function r2(v) { return Math.round(v * 100) / 100; }

export { SIDE_L, SIDE_R, SIDES };
