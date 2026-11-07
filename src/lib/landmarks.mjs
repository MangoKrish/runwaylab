// MediaPipe Pose Landmarker returns 33 points per person, and RTMPose adds five more of its own. These are the
// ones this app uses. "L" and "R" are the person's own left and right, so L_SHOULDER appears on the right of the
// image when they face the camera.
export const LM = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
  // Only RTMPose gives these. They come after MediaPipe's 33 slots, and stay empty under MediaPipe.
  HEAD_TOP: 33, NECK: 34, HIP_CENTER: 35, L_SMALL_TOE: 36, R_SMALL_TOE: 37,
};

export const LANDMARK_COUNT = 38;

// The lines drawn in the skeleton overlay.
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
  [29, 36], [30, 37], // Heel to small toe.
  [33, 34], [34, 35], // Top of head, neck and hip centre: the line of the spine.
];

export const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
