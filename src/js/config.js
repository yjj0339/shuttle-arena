export const REMOTE = {
  enabled: true,
  host: 'shuttle-arena.app.workbuddy.host',
  sharecode: 'PNCFY5M4LU',
};

export function networkBase() {
  const h = location.hostname;
  const forceRemote = new URLSearchParams(location.search).get('remote') === '1';
  const isManaged = !forceRemote && (h.includes('workbuddy') || h === 'localhost' || h === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(h));
  if (!REMOTE.enabled || isManaged) {
    return { http: '', ws: '', sharecode: new URLSearchParams(location.search).get('sharecode') || '' };
  }
  const sc = REMOTE.sharecode ? `sharecode=${REMOTE.sharecode}` : '';
  return {
    http: `https://${REMOTE.host}`,
    ws: `wss://${REMOTE.host}/ws?${sc}`,
    sharecode: REMOTE.sharecode,
  };
}
