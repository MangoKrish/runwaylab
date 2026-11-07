// Every recording is kept. In the browser that is the saved-walks store; when RunwayLab runs on this computer
// (npm run dev), the video file is also written to the project's recordings/ folder. Nothing goes anywhere else.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const copied = new Set();

export const extensionFor = (mime = '') => (mime.includes('webm') ? 'webm' : mime.includes('quicktime') ? 'mov' : 'mp4');

/** A file name that sorts by time and never collides: 2026-11-07_0745_ab12cd34.mp4 */
export function recordingName(session) {
  const d = new Date(session.createdAt || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}_${String(session.id).replace(/[^a-z0-9]/gi, '').slice(0, 8)}.${extensionFor(session.mime || session.blob?.type)}`;
}

/** Copies the video to the dev server's recordings folder, once per walk. Quietly does nothing anywhere else. */
export async function copyToThisComputer(session) {
  if (!LOCAL_HOSTS.includes(location.hostname) || !session.blob || copied.has(session.id)) return;
  copied.add(session.id);
  try {
    const res = await fetch(`/dev/recordings?name=${encodeURIComponent(recordingName(session))}`, { method: 'POST', body: session.blob });
    if (res.ok) console.info(`[keep] recording saved to recordings/${recordingName(session)}`);
  } catch {
    // Not running under npm run dev. The copy in the browser still stands.
  }
}
