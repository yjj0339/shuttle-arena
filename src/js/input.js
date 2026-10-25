import { PLAYER } from './shared/constants.js';

export class InputController {
  constructor(opts) {
    this.zone = opts.stickZone;
    this.swingZone = opts.swingZone;
    this.base = opts.stickBase;
    this.knob = opts.stickKnob;
    this.swingCore = opts.swingCore;
    this.halo = opts.halo;
    this.jumpBtn = opts.jumpBtn;

    this.ax = 0;
    this.az = 0;
    this.jump = false;
    this.held = false;
    this.charge = 0;
    this.chargeStart = 0;
    this.enabled = false;

    this.stickId = null;
    this.swingId = null;
    this.jumpHold = false;
    this.origin = { x: 0, y: 0 };
    this.radius = 60;
    this.keys = new Set();

    this.bind();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.releaseAll();
  }

  releaseAll() {
    this.ax = 0;
    this.az = 0;
    this.jump = false;
    if (this.jumpBtn) this.jumpBtn.classList.remove('pressed');
    this.resetStick();
    if (this.held) this.releaseSwing();
  }

  resetStick() {
    this.stickId = null;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    if (this.base) {
      this.base.style.left = '';
      this.base.style.top = '';
      this.base.style.bottom = '';
      this.base.classList.remove('active');
    }
  }

  bind() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      const rect = z.getBoundingClientRect();
      this.origin.x = e.clientX;
      this.origin.y = e.clientY;
      this.radius = Math.min(z.clientWidth * 0.5, z.clientHeight * 0.42);
      if (this.base) {
        const bRect = this.base.getBoundingClientRect();
        this.base.style.left = `${e.clientX - rect.left - bRect.width / 2}px`;
        this.base.style.top = `${e.clientY - rect.top - bRect.height / 2}px`;
        this.base.style.bottom = 'auto';
        this.base.classList.add('active');
      }
      this.updateStick(e.clientX, e.clientY);
    }, { passive: false });

    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    }, { passive: false });

    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.ax = 0;
      this.az = 0;
      this.resetStick();
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);

    const sz = this.swingZone;
    sz.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.swingId !== null) return;
      e.preventDefault();
      this.swingId = e.pointerId;
      this.press();
    }, { passive: false });

    const upSwing = (e) => {
      if (e.pointerId !== this.swingId) return;
      this.swingId = null;
      this.releaseSwing();
    };
    sz.addEventListener('pointerup', upSwing);
    sz.addEventListener('pointercancel', upSwing);
    sz.addEventListener('pointerleave', upSwing);

    if (this.jumpBtn) {
      const jb = this.jumpBtn;
      jb.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        jb.classList.add('pressed');
        this.jump = true;
        setTimeout(() => { this.jump = false; }, 90);
      }, { passive: false });
      jb.addEventListener('pointerup', () => jb.classList.remove('pressed'));
      jb.addEventListener('pointercancel', () => jb.classList.remove('pressed'));
    }

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'j' || k === ' ' || k === 'k') this.press();
      if (k === 'w' || k === 'arrowup') { this.jump = true; setTimeout(() => { this.jump = false; }, 90); }
      this.syncKeys();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'j' || k === ' ' || k === 'k') this.releaseSwing();
      this.syncKeys();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.syncKeys();
      if (this.held) this.releaseSwing();
      this.resetStick();
    });
  }

  syncKeys() {
    if (this.stickId !== null) return;
    const k = this.keys;
    const left = k.has('a') || k.has('arrowleft');
    const right = k.has('d') || k.has('arrowright');
    const fwd = k.has('s') || k.has('arrowdown');
    const back = k.has('w') || k.has('arrowup');
    this.ax = (right ? 1 : 0) - (left ? 1 : 0);
    this.az = (fwd ? 1 : 0) - (back ? 1 : 0);
  }

  updateStick(cx, cy) {
    const dx = cx - this.origin.x;
    const dy = cy - this.origin.y;
    const r = this.radius || 60;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, r);
    const nx = dist > 0.001 ? dx / dist : 0;
    const ny = dist > 0.001 ? dy / dist : 0;
    const mag = Math.min(1, clamped / (r * 0.84));
    let ax = nx * mag;
    let az = ny * mag;
    if (Math.abs(ax) < 0.11) ax = 0;
    if (Math.abs(az) < 0.11) az = 0;
    this.ax = ax;
    this.az = az;
    if (this.knob) {
      this.knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
    }
  }

  press() {
    if (this.held) return;
    this.held = true;
    this.chargeStart = performance.now();
    this.charge = 0;
    if (this.swingCore) this.swingCore.classList.add('pressed');
    if (this.halo) this.halo.classList.add('on');
  }

  releaseSwing() {
    if (!this.held) return;
    this.charge = Math.min(1, (performance.now() - this.chargeStart) / 1000 / PLAYER.CHARGE_TIME);
    this.held = false;
    if (this.swingCore) this.swingCore.classList.remove('pressed');
    if (this.halo) this.halo.classList.remove('on');
    this.charge = 0;
  }

  state() {
    if (this.held) {
      this.charge = Math.min(1, (performance.now() - this.chargeStart) / 1000 / PLAYER.CHARGE_TIME);
    }
    return {
      ax: this.ax,
      az: this.az,
      jump: this.jump,
      held: this.held,
      charge: this.held ? this.charge : 0,
    };
  }

  currentCharge() {
    if (!this.held) return 0;
    return Math.min(1, (performance.now() - this.chargeStart) / 1000 / PLAYER.CHARGE_TIME);
  }
}
