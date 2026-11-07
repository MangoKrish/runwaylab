// Reads every frame of a recording with the browser's own video decoder.
//
// A playing video is tied to the display: the browser hands over at most one frame per refresh and drops the rest,
// so sampling tops out at about 20 frames per second of waiting, however fast the tracker is. Decoding has no such
// limit. It gives every frame with its exact time, in order, even when the page is in the background.
//
// mp4box.js finds the frames inside an MP4 or MOV file. Anything this cannot read, such as WebM, is reported by
// returning false, and the analyzer falls back to playing the video.
import { abortError } from './video.mjs';

const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_WAITING_FRAMES = 4;
const MAX_QUEUED_CHUNKS = 6;
const STALLED_MS = 10000;

let library = null;

function loadLibrary(base) {
  library ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}vendor/mp4box/mp4box.all.min.js`;
    script.onload = () => resolve({ MP4Box: window.MP4Box, DataStream: window.DataStream });
    script.onerror = () => {
      library = null;
      reject(new Error('The MP4 reader could not be loaded.'));
    };
    document.head.append(script);
  });
  return library;
}

async function looksLikeMp4(blob) {
  const head = new TextDecoder().decode(await blob.slice(4, 8).arrayBuffer());
  return ['ftyp', 'moov', 'wide', 'free', 'mdat', 'skip'].includes(head);
}

/** Find the video track, and each frame's bytes and time. */
async function readSamples(blob, { MP4Box }, signal) {
  const file = MP4Box.createFile();
  const samples = [];
  let track = null;
  file.onError = () => {};
  file.onReady = (info) => {
    track = info.videoTracks[0] ?? null;
    if (!track) return;
    file.setExtractionOptions(track.id, null, { nbSamples: 120 });
    file.start();
  };
  file.onSamples = (_, __, list) => {
    for (const sample of list) samples.push(sample);
  };
  for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
    if (signal?.aborted) throw abortError();
    const buffer = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
    buffer.fileStart = offset;
    file.appendBuffer(buffer);
  }
  file.flush();
  return { file, track, samples };
}

/** The codec settings stored in the file, which the decoder needs before it can read a frame. */
function codecSettings(file, track, { DataStream }) {
  for (const entry of file.getTrackById(track.id).mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8); // Without the box's own header.
  }
  return undefined;
}

/**
 * How far the file says to turn its picture, in clockwise degrees, from the track's 16.16 fixed-point matrix. A video
 * element applies this by itself, and the decoder does not.
 */
export function rotationFromMatrix(matrix) {
  if (!matrix) return 0;
  const degrees = Math.round((Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI);
  const nearest = (Math.round(degrees / 90) * 90 + 360) % 360;
  return nearest;
}

/**
 * @param handle Awaited with (frame, seconds from the first frame, the file's rotation) for every frame, in order.
 *               It must not keep the frame: this closes it afterward.
 * @returns true when the whole file was read, or false if this file or browser cannot be read this way.
 *          A decoding error partway through also throws, and the caller can fall back to playing the video.
 */
export async function decodeFrames(blob, { base, signal }, handle) {
  if (typeof VideoDecoder === 'undefined' || !(await looksLikeMp4(blob))) return false;
  const lib = await loadLibrary(base);
  const { file, track, samples } = await readSamples(blob, lib, signal);
  if (!track || !samples.length) return false;

  const config = {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    description: codecSettings(file, track, lib),
    hardwareAcceleration: 'prefer-hardware',
  };
  const support = await VideoDecoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) return false;

  const rotation = rotationFromMatrix(track.matrix);
  const waiting = [];
  let failure = null;
  let wake = () => {};
  const decoder = new VideoDecoder({
    output: (frame) => {
      waiting.push(frame);
      wake();
    },
    error: (err) => {
      failure = err;
      wake();
    },
  });
  decoder.addEventListener?.('dequeue', () => wake());
  decoder.configure(config);

  let next = 0;
  let flushing = false;
  let flushed = false;
  let firstTime = null;
  let lastProgress = performance.now();
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      while (next < samples.length && decoder.decodeQueueSize < MAX_QUEUED_CHUNKS && waiting.length < MAX_WAITING_FRAMES) {
        const sample = samples[next++];
        decoder.decode(new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts * 1e6) / sample.timescale,
          duration: (sample.duration * 1e6) / sample.timescale,
          data: sample.data,
        }));
        sample.data = null; // The decoder has its own copy, so this memory can go.
      }
      if (next === samples.length && !flushing) {
        flushing = true;
        decoder.flush().then(() => {
          flushed = true;
          wake();
        }, (err) => {
          failure = err;
          wake();
        });
      }
      if (waiting.length) {
        const frame = waiting.shift();
        try {
          firstTime ??= frame.timestamp;
          await handle(frame, (frame.timestamp - firstTime) / 1e6, rotation);
        } finally {
          frame.close();
        }
        lastProgress = performance.now();
        continue;
      }
      if (flushed) return true;
      if (performance.now() - lastProgress > STALLED_MS) throw new Error('The decoder stopped responding.');
      await new Promise((resolve) => {
        wake = resolve;
        setTimeout(resolve, 200);
      });
    }
  } finally {
    for (const frame of waiting) frame.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}
