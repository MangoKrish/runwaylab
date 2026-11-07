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

/** Copies the video to the dev server's recordings folder. True only when it landed there. */
async function copyToThisComputer(session) {
  if (!LOCAL_HOSTS.includes(location.hostname)) return false;
  try {
    const res = await fetch(`/dev/recordings?name=${encodeURIComponent(recordingName(session))}`, { method: 'POST', body: session.blob });
    if (res.ok) console.info(`[keep] recording saved to recordings/${recordingName(session)}`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Hands the browser the video as a file download: Downloads on a computer, the Files app on an iPhone. */
export function downloadFile(session) {
  const url = URL.createObjectURL(session.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = recordingName(session);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Every new camera recording becomes a real file on the device that filmed it, once. Under npm run dev it goes
 * to the project's recordings/ folder instead; anywhere else, or if that fails, it is downloaded. Uploaded clips
 * are already files, so they are left alone.
 */
export async function keepOnDevice(session) {
  if (session.source !== 'camera' || !session.blob || copied.has(session.id)) return;
  copied.add(session.id);
  if (!(await copyToThisComputer(session))) downloadFile(session);
}
