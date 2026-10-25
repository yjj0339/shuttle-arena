import { World, SIDE_L, SIDE_R, classifyShot } from './shared/sim.js';
import { AI } from './shared/ai.js';
import { PLAYER, SHOT_LABEL, SHOT, COURT } from './shared/constants.js';
import { predictLanding3 } from './shared/physics.js';
import { networkBase } from './config.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { NetClient } from './net.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';

const FIXED = 1 / 60;
const RENDER_DELAY_TICKS = 4;
const SEND_INTERVAL = 33;

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const audio = new GameAudio();

const state = {
  mode: 'idle',
  running: false,
  localSide: SIDE_L,
  world: new World(),
  ai: null,
  net: null,
  buffer: [],
  roomCode: null,
  lastSend: 0,
  playedRallyMax: 0,
  totalRallies: 0,
  smashCount: 0,
  rematchWaiting: false,
  oppName: 'RIVAL',
  myName: 'YOU',
};

const ui = new UI();

const input = new InputController({
  stickZone: document.getElementById('stickZone'),
  swingZone: document.getElementById('swingZone'),
  stickBase: document.getElementById('stickBase'),
  stickKnob: document.getElementById('stickKnob'),
  swingCore: document.querySelector('.swing-core'),
  halo: document.getElementById('swingHalo'),
  jumpBtn: document.getElementById('jumpBtn'),
});

input.setEnabled(false);

function detectNames() {
  try {
    const saved = localStorage.getItem('ba_name');
    if (saved) return saved;
  } catch {}
  const n = '球友' + Math.floor(Math.random() * 900 + 100);
  try { localStorage.setItem('ba_name', n); } catch {}
  return n;
}
state.myName = detectNames();

function r2(v) { return Math.round(v * 100) / 100; }

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpSnapshot(a, b, f) {
  const A = a.d;
  const B = b.d;
  return {
    tk: Math.round(lerp(a.t, b.t, f)),
    b: [
      lerp(A.b[0], B.b[0], f), lerp(A.b[1], B.b[1], f), lerp(A.b[2], B.b[2], f),
      lerp(A.b[3], B.b[3], f), lerp(A.b[4], B.b[4], f), lerp(A.b[5], B.b[5], f),
      B.b[6],
    ],
    p: [0, 1].map((i) => {
      const q = A.p[i];
      const r = B.p[i];
      return [
        lerp(q[0], r[0], f), lerp(q[1], r[1], f), lerp(q[2], r[2], f),
        lerp(q[3], r[3], f), lerp(q[4], r[4], f), lerp(q[5], r[5], f),
        r[6], r[7], r[8], r[9], r[10], r[11],
      ];
    }),
    s: B.s,
    ph: B.ph,
    sv: B.sv,
    lh: B.lh,
    rt: B.rt,
    rl: B.rl,
    w: B.w,
    pi: B.pi,
  };
}

function handleEvents(evs) {
  const mySide = state.localSide;
  for (const ev of evs) {
    if (ev.type === 'hit') {
      const isMe = ev.side === mySide;
      audio.hit(ev.power, ev.kind === SHOT.SMASH);
      if (ev.kind === SHOT.SMASH) state.smashCount++;
      renderer.spawnHitFx(ev.x, ev.y, ev.z || 0, ev.side, ev.power);
    } else if (ev.type === 'net') {
      audio.net();
    } else if (ev.type === 'land') {
      audio.land();
      renderer.spawnLandFx(ev.x, ev.z || 0, ev.scorer);
    } else if (ev.type === 'point') {
      const iWin = ev.scorer === mySide;
      const reasons = {
        out: '出界', net: '下网', 'own-court': '未过网', winner: '落地得分', 'no-hit': '未击球',
      };
      renderer.spawnText(iWin ? '得分' : '失分', reasons[ev.reason] || '', iWin ? '#5ef0d4' : '#ff6f7d');
      renderer.flash = iWin ? 0.5 : 0.35;
      audio.point(iWin);
      state.totalRallies++;
    } else if (ev.type === 'gameover') {
      endMatch(ev.winner, ev.score);
    } else if (ev.type === 'whiff') {
      if (ev.side === mySide) renderer.shake = Math.max(renderer.shake, 2);
    }
  }
}

function updateHud() {
  const w = state.world;
  if (!w) return;
  const l = w.score[0];
  const r = w.score[1];
  if (ui._sc0 !== l || ui._sc1 !== r) {
    const flash = ui._sc0 !== l ? -1 : ui._sc1 !== r ? 1 : 0;
    ui.setScore(l, r, flash);
    ui._sc0 = l;
    ui._sc1 = r;
  }
  ui.setRally(w.rally);
  if (w.rally > state.playedRallyMax) state.playedRallyMax = w.rally;

  const showingServe = w.phase === 'serve';
  ui.setServeHint(showingServe ? '按住右侧蓄力 · 松手发球' : '');

  const p = w.players[myIdx()];
  const c = state.mode === 'solo' ? input.currentCharge() : p.charge;
  const charging = state.mode === 'solo' ? input.held : p.charging;
  if (charging && state.running) {
    let label = '蓄力中';
    if (w.phase === 'serve') {
      label = c > 0.46 ? '高远发球' : '短球';
    } else {
      const kind = classifyShot(w.ball.y, c, p.y > 0.12);
      label = SHOT_LABEL[kind] || '击球';
    }
    ui.setPower(c, label, true);
  } else {
    ui.setPower(0, '', false);
  }
}

function myIdx() {
  return state.localSide < 0 ? 0 : 1;
}

const perf = { draw: 0, frame: 16.7, max: 0 };
const perfHud = document.getElementById('perfHud');
if (new URLSearchParams(location.search).get('debug') === '1' && perfHud) {
  perfHud.classList.remove('hidden');
}
if (typeof window !== 'undefined') window.__perf = perf;
window.addEventListener('keydown', function (e) {
  if (e.key === 'd' || e.key === 'D') {
    if (perfHud) perfHud.classList.toggle('hidden');
  }
});

let lastFrame = performance.now();
let acc = 0;
let fpsAcc = 0;
let fpsCount = 0;
let fpsVal = 0;

function frame(now) {
  const dt = Math.min(0.06, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsAcc += dt;
  fpsCount++;
  if (fpsAcc > 0.5) {
    fpsVal = Math.round(fpsCount / fpsAcc);
    fpsAcc = 0;
    fpsCount = 0;
    ui.setStats(state.net ? state.net.latency : null, fpsVal);
    if (perfHud && !perfHud.classList.contains('hidden')) {
      perfHud.textContent = `fps      ${fpsVal}
draw     ${perf.draw.toFixed(2)} ms
drawMax  ${perf.max.toFixed(1)} ms
frame    ${perf.frame.toFixed(1)} ms
dpr      ${renderer.dpr.toFixed(2)}
px       ${(renderer.canvas.width * renderer.canvas.height / 10000).toFixed(0)} 万
ping     ${state.net ? state.net.latency + ' ms' : '-'}
net      ${state.net ? state.net.mode : '-'}`;
    }
  }

  const tDraw0 = performance.now();
  if (state.running) {
    if (state.mode === 'solo') {
      acc += dt;
      let n = 0;
      while (acc >= FIXED && n < 5) {
        stepSolo();
        acc -= FIXED;
        n++;
      }
      if (n >= 5) acc = 0;
      const evs = state.world.drainEvents();
      if (evs.length) handleEvents(evs);
    } else if (state.mode === 'online') {
      updateOnline();
      if (now - state.lastSend >= SEND_INTERVAL) {
        state.lastSend = now;
        sendInput();
      }
    }
    updateHud();
  }

  if (state.running) updateLandingHint();
  else renderer.landing = null;

  renderer.updateFx(dt);
  renderer.draw(state.world, null, dt, { localSide: state.localSide });
  if (typeof window !== 'undefined') {
  window.__game = {
    state, renderer, input, ui, audio,
    get world() { return state.world; },
    startSolo, startOnline,
  };
}

requestAnimationFrame(frame);
}

let hintFrame = 0;

function updateLandingHint() {
  const w = state.world;
  const b = w.ball;
  if (!b.active) { renderer.landing = null; return; }
  const mySide = state.localSide;
  if (b.vx * mySide < 0.8) { renderer.landing = null; return; }
  if ((hintFrame++ & 1) !== 0) return;
  const land = predictLanding3(b.x, b.y, b.z, b.vx, b.vy, b.vz);
  renderer.landing = {
    x: land.x,
    z: land.z,
    out: Math.abs(land.x) > COURT.HALF_LENGTH || Math.abs(land.z) > COURT.HALF_WIDTH,
  };
}

function stepSolo() {
  const w = state.world;
  const inp = input.state();
  w.setInput(SIDE_L, {
    ax: inp.ax, az: inp.az, jump: inp.jump, down: false,
    swingHeld: inp.held, charge: inp.charge,
  });
  const aiInp = state.ai.update(w, FIXED);
  w.setInput(SIDE_R, aiInp);
  w.step(FIXED);
}

function updateOnline() {
  const buf = state.buffer;
  if (!buf.length) return;
  if (buf.length === 1) {
    state.world.applySnapshot(buf[0].d);
    return;
  }
  const latest = buf[buf.length - 1];
  const target = latest.t - RENDER_DELAY_TICKS;
  if (target <= buf[0].t) {
    state.world.applySnapshot(buf[0].d);
    return;
  }
  let i = buf.length - 2;
  while (i > 0 && buf[i].t > target) i--;
  const a = buf[i];
  const b = buf[Math.min(i + 1, buf.length - 1)];
  const span = Math.max(1, b.t - a.t);
  const f = Math.max(0, Math.min(1, (target - a.t) / span));
  state.world.applySnapshot(lerpSnapshot(a, b, f));
  if (buf.length > 24) buf.splice(0, buf.length - 24);
}

let botAI = null;

function sendInput() {
  if (!state.net) return;
  if (botAI) {
    const inp = botAI.update(state.world, SEND_INTERVAL / 1000);
    state.net.send({
      t: 'input',
      ax: r2(inp.ax), az: r2(inp.az), jump: inp.jump, down: !!inp.down,
      held: inp.swingHeld, charge: r2(inp.charge),
    });
    return;
  }
  const s = input.state();
  state.net.send({
    t: 'input',
    ax: r2(s.ax),
    az: r2(s.az),
    jump: s.jump,
    down: false,
    held: s.held,
    charge: r2(s.charge),
  });
}

function startSolo(diff) {
  state.mode = 'solo';
  state.localSide = SIDE_L;
  state.world = new World();
  state.ai = new AI(SIDE_R, diff || 'normal');
  state.running = true;
  state.playedRallyMax = 0;
  state.totalRallies = 0;
  state.smashCount = 0;
  state.roomCode = null;
  ui._sc0 = -1;
  ui._sc1 = -1;
  ui.setNames('YOU', `AI · ${({ easy: '轻松', normal: '普通', hard: '困难', pro: '职业' })[diff || 'normal']}`);
  ui.show('__playing');
  input.setEnabled(true);
  audio.ensure();
  tryFullscreen();
}

function startOnline(side, oppName) {
  const params = new URLSearchParams(location.search);
  botAI = params.get('bot') === '1' ? new AI(side, params.get('botdiff') || 'normal') : null;
  state.mode = 'online';
  state.localSide = side;
  state.world = new World();
  state.ai = null;
  state.buffer = [];
  state.running = true;
  state.playedRallyMax = 0;
  state.totalRallies = 0;
  state.smashCount = 0;
  state.oppName = oppName || 'RIVAL';
  ui._sc0 = -1;
  ui._sc1 = -1;
  const myName = side === SIDE_L ? state.myName : 'RIVAL';
  const otherName = side === SIDE_L ? (oppName || 'RIVAL') : state.myName;
  ui.setNames(myName, otherName);
  ui.show('__playing');
  input.setEnabled(true);
  audio.ensure();
  tryFullscreen();
}

function tryFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) return;
  const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
  if (p && p.then) {
    p.then(() => {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }).catch(() => {});
  }
}

function endMatch(winner, score) {
  if (!state.running) return;
  state.running = false;
  input.setEnabled(false);
  const win = winner === state.localSide;
  state.rematchWaiting = false;
  setTimeout(() => {
    if (win) audio.win(); else audio.lose();
    ui.showResult(win, score, [
      { v: state.playedRallyMax, k: '最长回合' },
      { v: state.totalRallies, k: '总回合' },
      { v: state.smashCount, k: '杀球数' },
    ]);
  }, 900);
}

function quitToMenu() {
  state.running = false;
  input.setEnabled(false);
  if (state.net) {
    state.net.send({ t: 'leave' });
    state.net.close();
    state.net = null;
  }
  state.mode = 'idle';
  state.buffer = [];
  ui.show('menu');
  ui.setServeHint('');
  ui.setPower(0, '', false);
}

async function ensureNet() {
  ui.setNetState('连接中…', '');
  if (state.net && (state.net.mode === 'ws' || state.net.mode === 'poll')) return state.net;
  const net = new NetClient();
  bindNet(net);
  let mode = 'x';
  try {
    mode = await net.connect();
  } catch (e) {
    document.title = 'NETFAIL:' + (e && e.message);
    throw e;
  }
  document.title = 'NET:' + mode;
  state.net = net;
  ui.setNetState(mode === 'ws' ? '在线 · WS 直连' : '在线 · 轮询模式', 'ok');
  return net;
}

function bindNet(net) {
  net.on('room', (m) => {
    state.roomCode = m.code;
    ui.setRoomCode(m.code);
    if (!m.host) {
      ui.show('join');
    } else {
      ui.show('room');
    }
  });
  net.on('start', (m) => {
    startOnline(m.side, m.opp);
  });
  net.on('s', (m) => {
    const d = { ...m };
    delete d.ev;
    state.buffer.push({ t: m.tk, d });
    if (m.ev && m.ev.length) handleEvents(m.ev);
  });
  net.on('err', (m) => {
    ui.toast(m.msg || '出错了');
    if (state.mode !== 'online') ui.show('menu');
  });
  net.on('queue', () => {
    ui.setNetState('匹配中…', 'ok');
  });
  net.on('oppLeft', () => {
    if (state.running || ui.cur === 'playing') {
      state.running = false;
      input.setEnabled(false);
      ui.toast('对手已离开');
      setTimeout(() => quitToMenu(), 700);
    }
  });
  net.on('rematchAsk', () => {
    ui.toast('对手邀请再来一局');
  });
  net.on('rematchWait', () => {
    ui.toast('已发送邀请，等待对手…');
  });
  net.on('disconnect', () => {
    if (state.mode === 'online') {
      state.running = false;
      input.setEnabled(false);
      ui.toast('连接已断开');
      setTimeout(() => quitToMenu(), 900);
    }
  });
}

ui.h.onAction = async (act) => {
  audio.ensure();
  audio.ui();
  switch (act) {
    case 'quick': {
      try {
        const net = await ensureNet();
        ui.show('room');
        ui.setRoomCode('----');
        document.querySelector('#screenRoom h2').textContent = '正在匹配';
        net.send({ t: 'quick', name: state.myName });
      } catch (e) {
        ui.toast('无法连接服务器');
        ui.setNetState('连接失败', 'bad');
        console.error('[net]', e && e.message);
      }
      break;
    }
    case 'create': {
      try {
        const net = await ensureNet();
        net.send({ t: 'create', name: state.myName });
      } catch (e) {
        ui.toast('无法连接服务器');
        console.error('[net]', e && e.message);
      }
      break;
    }
    case 'join': {
      ui.show('join');
      ui.setCode('');
      setTimeout(() => document.querySelector('#codeInput input')?.focus(), 260);
      break;
    }
    case 'doJoin': {
      const code = ui.getCode();
      if (code.length !== 4) return;
      try {
        const net = await ensureNet();
        net.send({ t: 'join', code, name: state.myName });
      } catch {
        ui.toast('无法连接服务器');
      }
      break;
    }
    case 'solo':
      ui.show('solo');
      break;
    case 'startSolo':
      startSolo(ui.difficulty);
      break;
    case 'back':
      if (ui.cur === 'room' && state.net) {
        state.net.send({ t: 'cancelQueue' });
      }
      ui.show('menu');
      break;
    case 'cancel':
      if (state.net) state.net.send({ t: 'cancelQueue' });
      quitToMenu();
      break;
    case 'copy': {
      const code = state.roomCode || '';
      const text = `来和我打一局羽毛球！房间码：${code} ${location.href}`;
      try {
        await navigator.clipboard.writeText(text);
        ui.toast('邀请已复制');
      } catch {
        ui.toast(`房间码 ${code}`);
      }
      break;
    }
    case 'again': {
      if (state.mode === 'solo') {
        startSolo(ui.difficulty);
      } else if (state.net) {
        state.net.send({ t: 'rematch' });
        state.rematchWaiting = true;
        ui.toast('已发送邀请');
      }
      break;
    }
    case 'home':
      quitToMenu();
      break;
    default:
      break;
  }
};

const quitBtn = document.getElementById('quitBtn');
if (quitBtn) {
  quitBtn.addEventListener('click', () => {
    if (!state.running && ui.cur !== 'playing') return;
    quitToMenu();
  });
  quitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderer.resize(), 120);
});
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 320));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.releaseAll();
});

setTimeout(() => {
  ui.hideLoading();
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'shuttle-ready' }, '*');
    }
  } catch (e) { /* ignore */ }
  const params = new URLSearchParams(location.search);
  const auto = params.get('auto');
  const demo = params.get('demo');
  if (auto === 'solo') {
    startSolo(params.get('diff') || 'normal');
  } else if (auto === 'create') {
    ensureNet()
      .then((net) => { document.title = 'NET_OK'; net.send({ t: 'create', name: state.myName }); })
      .catch((e) => { document.title = 'NET_ERR:' + ((e && e.message) || '').slice(0, 90); });
  } else if (auto === 'join') {
    ui.show('join');
  } else if (demo === 'result') {
    state.localSide = -1;
    ui.showResult(true, [11, 7], [
      { v: 14, k: '最长回合' }, { v: 23, k: '总回合' }, { v: 9, k: '杀球数' },
    ]);
  } else if (demo === 'lose') {
    ui.showResult(false, [8, 11], [
      { v: 9, k: '最长回合' }, { v: 18, k: '总回合' }, { v: 4, k: '杀球数' },
    ]);
  } else if (demo === 'room') {
    ui.setRoomCode('Q7KM');
    ui.show('room');
  } else if (demo === 'join') {
    ui.show('join');
    ui.setCode('Q7KM');
  } else if (demo === 'solo') {
    ui.show('solo');
  } else {
    ui.show('menu');
  }
  const base = networkBase();
  const healthUrl = (base.http || '') + '/api/health';
  fetch(healthUrl, { cache: 'no-store' }).then((r) => r.json()).then(() => {
    ui.setNetState(base.http ? '联机 · 远程服务器' : '联机 · 本机服务', 'ok');
  }).catch(() => ui.setNetState('离线 · 可单机练习', 'bad'));
}, 60);

if (typeof window !== 'undefined') {
  window.__game = {
    state, renderer, input, ui, audio,
    get world() { return state.world; },
    startSolo, startOnline,
  };
}

requestAnimationFrame(frame);
