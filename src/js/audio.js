export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  noise(dur, filterType, freq, q, gain, decay = 0.08, slideTo) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + decay);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  tone(freq, dur, gain, type = 'sine', slideTo) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hit(power = 0.6, kind = 'clear') {
    this.ensure();
    const p = Math.max(0.2, Math.min(1, power));
    const heavy = kind === 'smash';
    const soft = kind === 'net' || kind === 'drop';
    const quick = kind === 'drive';

    if (heavy) {
      this.noise(0.1, 'bandpass', 1100, 0.9, 0.75, 0.1, 380);
      this.tone(150, 0.13, 0.42, 'triangle', 52);
      this.tone(84, 0.18, 0.3, 'sine', 44);
      this.noise(0.05, 'highpass', 4200, 0.7, 0.32, 0.05);
    } else if (soft) {
      this.noise(0.05, 'bandpass', 3200, 1.6, 0.18, 0.05, 1800);
      this.tone(420, 0.05, 0.09, 'sine', 260);
    } else if (quick) {
      this.noise(0.05, 'bandpass', 2800, 1.2, 0.5, 0.05, 1100);
      this.tone(260, 0.06, 0.26, 'square', 130);
    } else {
      this.noise(0.07, 'bandpass', 2200 + p * 900, 1.1, 0.4 + p * 0.28, 0.07, 900);
      this.tone(200 + p * 80, 0.09, 0.2 + p * 0.14, 'triangle', 90);
    }
  }

  whoosh(speed) {
    this.ensure();
    const k = Math.max(0.15, Math.min(1, speed / 40));
    this.noise(0.16, 'bandpass', 900 + k * 1200, 0.9, 0.05 + k * 0.12, 0.16, 380);
  }

  cheer(strong) {
    this.ensure();
    const n = strong ? 1 : 0.6;
    this.noise(0.7, 'bandpass', 1400, 0.6, 0.11 * n, 0.75, 700);
    this.tone(523, 0.3, 0.1 * n, 'sine');
    setTimeout(() => this.tone(784, 0.36, 0.09 * n, 'sine'), 110);
    setTimeout(() => this.tone(1046, 0.5, 0.07 * n, 'sine'), 220);
  }

  net() {
    this.ensure();
    this.noise(0.11, 'lowpass', 900, 0.7, 0.14, 0.13);
  }

  land() {
    this.ensure();
    this.noise(0.08, 'lowpass', 520, 0.6, 0.2, 0.1);
    this.tone(96, 0.1, 0.12, 'sine', 58);
  }

  point(win) {
    this.ensure();
    if (win) {
      this.tone(660, 0.16, 0.16, 'sine');
      setTimeout(() => this.tone(880, 0.22, 0.15, 'sine'), 90);
      setTimeout(() => this.tone(1174, 0.3, 0.12, 'sine'), 190);
    } else {
      this.tone(392, 0.18, 0.13, 'sine');
      setTimeout(() => this.tone(294, 0.28, 0.11, 'sine'), 100);
    }
  }

  serve() {
    this.ensure();
    this.noise(0.05, 'bandpass', 2600, 1.4, 0.28, 0.05);
  }

  ui() {
    this.ensure();
    this.tone(520, 0.06, 0.07, 'sine', 700);
  }

  win() {
    this.ensure();
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.34, 0.14, 'sine'), i * 110));
  }

  lose() {
    this.ensure();
    const notes = [392, 349, 294];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.36, 0.12, 'sine'), i * 130));
  }
}
