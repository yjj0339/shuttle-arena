import { networkBase } from './config.js';

export class NetClient {
  constructor() {
    this.base = networkBase();
    this.handlers = new Map();
    this.ws = null;
    this.mode = 'idle';
    this.sid = null;
    this.closed = false;
    this.latency = 0;
    this.pingTimer = null;
    this.pollTimer = null;
    this.outQueue = [];
    this.pendingMsg = null;
    this.wsFail = '';
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, data) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(data);
  }

  url(path) {
    if (this.base.http) return this.base.http + path;
    return location.protocol + '//' + location.host + path;
  }

  async connect() {
    this.closed = false;
    try {
      await this.connectWS();
      this.mode = 'ws';
      return this.mode;
    } catch (e) {
      this.wsFail = (e && e.message) || 'ws fail';
      try {
        await this.connectPoll();
        this.mode = 'poll';
        return this.mode;
      } catch (e2) {
        throw new Error(this.wsFail + ' / poll: ' + ((e2 && e2.message) || 'fail'));
      }
    }
  }

  connectWS() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const raw = this.base.ws || `${proto}//${location.host}/ws`;
      const sep = raw.includes('?') ? '&' : '?';
      const target = `${raw}${sep}_n=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.target = target;

      let ws;
      try {
        ws = new WebSocket(target);
      } catch (err) {
        reject(new Error('ctor: ' + (err && err.message)));
        return;
      }

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) { /* ignore */ }
        reject(new Error('ws timeout'));
      }, 7000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        resolve();
        this.startPing();
        for (const m of this.outQueue) {
          try { ws.send(JSON.stringify(m)); } catch (e) { /* ignore */ }
        }
        this.outQueue = [];
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        this.handle(msg);
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('ws error'));
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('ws closed'));
          return;
        }
        if (this.ws === ws && !this.closed) this.emit('disconnect');
      };
    });
  }

  async connectPoll() {
    const res = await fetch(this.url('/api/open'), { method: 'POST', cache: 'no-store' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('open not json'); }
    this.sid = data.sid;
    this.pollLoop();
    for (const m of this.outQueue) this.send(m);
    this.outQueue = [];
  }

  async pollLoop() {
    if (this.mode !== 'poll' || this.closed) return;
    const body = { sid: this.sid };
    if (this.pendingMsg) {
      body.msg = this.pendingMsg;
      this.pendingMsg = null;
    }
    try {
      const res = await fetch(this.url('/api/poll'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.t === 'gone') {
        this.emit('disconnect');
        return;
      }
      if (data.msgs) for (const m of data.msgs) this.handle(m);
    } catch (e) { /* ignore */ }
    if (this.closed) return;
    this.pollTimer = setTimeout(() => this.pollLoop(), 40);
  }

  handle(msg) {
    if (msg.t === 'pong') {
      this.latency = Math.round(performance.now() - (msg.c || 0));
      return;
    }
    this.emit(msg.t, msg);
  }

  startPing() {
    const loop = () => {
      if (!this.ws || this.ws.readyState !== 1) return;
      this.send({ t: 'ping', c: performance.now() });
      this.pingTimer = setTimeout(loop, 2000);
    };
    loop();
  }

  send(obj) {
    if (this.closed) return;
    if (this.mode === 'ws' && this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    } else if (this.mode === 'poll') {
      this.pendingMsg = obj;
    } else {
      this.outQueue.push(obj);
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.pingTimer);
    clearTimeout(this.pollTimer);
    if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
    if (this.sid) {
      fetch(this.url('/api/close'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid: this.sid }),
        keepalive: true,
      }).catch(() => {});
    }
  }
}
