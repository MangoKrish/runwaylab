// Chooses the tracker. RTMPose held up clearly better than MediaPipe at close range and from behind in our
// comparison (see README), and it runs fast on a GPU. On a browser with no WebGPU it would be too slow, so
// MediaPipe is the fallback.
//
// This wrapper never throws. A failed frame just counts as a missing frame, and if the GPU tracker keeps
// failing, for example because the graphics device was lost, MediaPipe takes over partway through.
import { createRtmPose } from './rtmpose.mjs';
import { createPose } from './landmarker.mjs';

const FAILURES_BEFORE_SWITCHING = 3;

export async function createTracker(base) {
  let active = null;
  const gpu = await navigator.gpu?.requestAdapter?.().catch(() => null);
  if (gpu) {
    try {
      active = await createRtmPose(base);
    } catch (err) {
      console.error('RTMPose could not start, using MediaPipe instead.', err);
    }
  }
  if (!active) active = await createPose(base, { model: 'full' });

  let failures = 0;
  let switching = null;

  return {
    get delegate() { return active.delegate; },
    get model() { return active.model; },
    async detect(source, ms) {
      if (switching) {
        await switching;
      }
      try {
        const poses = await active.detect(source, ms);
        failures = 0;
        return poses;
      } catch (err) {
        console.error('A frame could not be tracked.', err);
        failures++;
        if (failures >= FAILURES_BEFORE_SWITCHING && !active.model.startsWith('MediaPipe')) {
          switching = createPose(base, { model: 'full' })
            .then((next) => {
              try {
                active.close();
              } catch {
                // It has already failed, so there may be nothing left to close.
              }
              active = next;
              failures = 0;
            })
            .catch((failure) => console.error('MediaPipe could not take over.', failure))
            .finally(() => { switching = null; });
        }
        return [];
      }
    },
    close() {
      try {
        active.close();
      } catch (err) {
        console.error(err);
      }
    },
  };
}
