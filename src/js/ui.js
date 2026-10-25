const $ = (id) => document.getElementById(id);

export class UI {
  constructor(h) {
    this.h = h || {};
    this.screens = {
      menu: $('screenMenu'),
      room: $('screenRoom'),
      join: $('screenJoin'),
      solo: $('screenSolo'),
      over: $('screenOver'),
      loading: $('screenLoading'),
    };
    this.hud = $('hud');
    this.touch = $('touchLayer');
    this.toastEl = $('toast');
    this.cur = 'loading';
    this.bindMenu();
    this.bindCodeInput();
    this.bindDiff();
    this.bindGlobal();
  }

  bindGlobal() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (this.h.onAction) this.h.onAction(act, btn);
    });
  }

  bindMenu() {
    const codeInputs = [...document.querySelectorAll('#codeInput input')];
    codeInputs.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 1);
        if (inp.value && i < codeInputs.length - 1) codeInputs[i + 1].focus();
        this.updateJoinBtn();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && i > 0) codeInputs[i - 1].focus();
        if (e.key === 'Enter') {
          const v = this.getCode();
          if (v.length === 4) this.h.onAction && this.h.onAction('doJoin', document.getElementById('joinBtn'));
        }
      });
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text') || '';
        const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        [...clean].forEach((ch, k) => { if (codeInputs[k]) codeInputs[k].value = ch; });
        codeInputs[Math.min(clean.length, 3)].focus();
        this.updateJoinBtn();
      });
    });
  }

  bindCodeInput() {}

  bindDiff() {
    const list = $('diffList');
    if (!list) return;
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.diff');
      if (!b) return;
      [...list.children].forEach((c) => c.classList.toggle('active', c === b));
      this.difficulty = b.dataset.diff;
    });
    this.difficulty = 'normal';
  }

  getCode() {
    return [...document.querySelectorAll('#codeInput input')].map((i) => i.value).join('');
  }

  setCode(code) {
    const arr = [...document.querySelectorAll('#codeInput input')];
    arr.forEach((inp, i) => { inp.value = (code || '')[i] || ''; });
    this.updateJoinBtn();
  }

  updateJoinBtn() {
    const btn = $('joinBtn');
    if (btn) btn.disabled = this.getCode().length !== 4;
  }

  show(name) {
    const map = { menu: 'menu', room: 'room', join: 'join', solo: 'solo', over: 'over', loading: 'loading' };
    for (const [k, el] of Object.entries(this.screens)) {
      if (!el) continue;
      el.classList.toggle('hidden', k !== map[name]);
    }
    this.cur = name;
    const playing = name === '__playing';
    if (playing) {
      for (const el of Object.values(this.screens)) el && el.classList.add('hidden');
      this.cur = 'playing';
    }
    this.setPlayVisible(playing);
  }

  setPlayVisible(v) {
    this.hud.classList.toggle('hidden', !v);
    this.touch.classList.toggle('hidden', !v);
  }

  toast(msg, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setRoomCode(code) {
    const el = $('codeDisplay');
    if (!el) return;
    const spans = el.querySelectorAll('span');
    spans.forEach((s, i) => { s.textContent = code[i] || '–'; });
  }

  setNames(l, r) {
    const a = $('nameL');
    const b = $('nameR');
    if (a) a.textContent = l || 'LEFT';
    if (b) b.textContent = r || 'RIGHT';
  }

  setScore(l, r, flashSide) {
    $('scoreL').textContent = l;
    $('scoreR').textContent = r;
    if (flashSide) {
      const el = flashSide < 0 ? $('sbLeft') : $('sbRight');
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }
  }

  setRally(n) {
    const badge = $('rallyBadge');
    $('rallyNum').textContent = n;
    badge.classList.toggle('show', n >= 3);
  }

  setServeHint(text) {
    const el = $('serveHint');
    if (text) {
      el.textContent = text;
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
  }

  setStats(ping, fps) {
    $('pingVal').textContent = ping == null ? '--' : ping;
    $('fpsVal').textContent = fps == null ? '--' : fps;
  }

  setPower(charge, label, visible) {
    const ring = $('powerRing');
    ring.classList.toggle('hidden', !visible);
    if (!visible) return;
    const c = Math.max(0, Math.min(1, charge));
    const fill = $('prFill');
    const len = 276;
    fill.style.strokeDashoffset = String(len * (1 - c));
    fill.style.stroke = c > 0.78 ? '#ffd166' : c > 0.45 ? '#5ef0d4' : '#8fb4d6';
    $('prLabel').textContent = label;
  }

  showResult(win, score, stats) {
    const tag = $('resultTag');
    tag.textContent = win ? 'VICTORY' : 'DEFEAT';
    tag.classList.toggle('lose', !win);
    $('resultTitle').textContent = win ? '胜利' : '惜败';
    $('resultScore').textContent = `${score[0]} : ${score[1]}`;
    const st = $('resultStats');
    st.innerHTML = '';
    for (const s of stats) {
      const d = document.createElement('div');
      d.innerHTML = `<b>${s.v}</b><span>${s.k}</span>`;
      st.appendChild(d);
    }
    this.show('over');
  }

  setNetState(text, cls) {
    const el = $('netState');
    if (!el) return;
    el.textContent = text;
    el.className = `foot-chip ${cls || ''}`;
  }

  hideLoading() {
    this.screens.loading.classList.add('hidden');
  }
}
