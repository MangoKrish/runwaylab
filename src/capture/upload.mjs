// Checks an uploaded clip before accepting it. The file extension proves nothing, so the real test is
// whether this browser can actually open the video and read its size and length.

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // iPhone clips at 60 fps are large.
export const MAX_UPLOAD_SECONDS = 120; // Room for three walks up and back.
const ACCEPTED = ['video/mp4', 'video/webm', 'video/quicktime'];

export class UploadError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Checks that need no decoding. Separate so they can be tested without a browser. */
export function checkUploadBasics(file) {
  if (!file) throw new UploadError('none', 'No file was chosen.');
  if (file.size === 0) throw new UploadError('empty', 'That file is empty.');
  const byName = /\.(mp4|m4v)$/i.test(file.name) ? 'video/mp4' : /\.webm$/i.test(file.name) ? 'video/webm' : /\.mov$/i.test(file.name) ? 'video/quicktime' : '';
  const type = ACCEPTED.includes(file.type) ? file.type : byName;
  if (!type) throw new UploadError('type', 'Please choose an MP4, MOV or WebM video.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError('big', `That file is ${Math.round(file.size / 1048576)} MB. The limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`);
  }
  return type;
}

export async function checkUpload(file) {
  const type = checkUploadBasics(file);
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new UploadError('timeout', 'That video took too long to open. It may be damaged.')), 12000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => {
        clearTimeout(timer);
        const decode = video.error?.code === 4 || video.error?.code === 3;
        reject(new UploadError(decode ? 'codec' : 'corrupt', decode
          ? 'This browser cannot play that video. It may be damaged, or use a codec the browser lacks. H.264 MP4 is the safest choice.'
          : 'That video could not be read. The file may be damaged.'));
      };
      video.src = url;
    });
    if (!video.videoWidth || !video.videoHeight) throw new UploadError('novideo', 'That file has no video picture.');
    if (Number.isFinite(video.duration) && video.duration > MAX_UPLOAD_SECONDS) {
      throw new UploadError('long', `That clip is ${Math.round(video.duration)} seconds long. Please trim it to ${MAX_UPLOAD_SECONDS} seconds or less.`);
    }
    return { type, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
