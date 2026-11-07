// A thin wrapper around MediaPipe Pose Landmarker. The runtime and models are served by this site, so
// nothing is fetched from anywhere else and tracking keeps working on poor venue Wi-Fi.

/**
 * @param {string} base  URL of the site root, ending in a slash.
 * @param {{numPoses?:number, model?:'lite'|'full'|'heavy'}} options
 */
export async function createPose(base, { numPoses = 3, model = 'lite' } = {}) {
  const { FilesetResolver, PoseLandmarker } = await import(`${base}vendor/mediapipe/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${base}vendor/mediapipe/wasm`);

  // Prefer the GPU, and fall back to the CPU on machines where WebGL is not available.
  let landmarker = null;
  let delegate = null;
  let lastError = null;
  for (const candidate of ['GPU', 'CPU']) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}vendor/mediapipe/pose_landmarker_${model}.task`, delegate: candidate },
        runningMode: 'VIDEO',
        numPoses, // More than one, so a bystander cannot replace the walker: TargetLock chooses between them.
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      delegate = candidate;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!landmarker) throw lastError || new Error('The pose model could not start.');

  return {
    delegate,
    model: `MediaPipe ${model}`,
    /** Timestamps must always increase, or MediaPipe throws. Callers are responsible for that. */
    detect: (source, ms) => {
      const result = landmarker.detectForVideo(source, ms);
      const { landmarks } = result;
      result.close?.();
      return landmarks;
    },
    close: () => landmarker.close(),
  };
}
