// Runs real clips through the real tracker and measuring code, and prints every number behind the score.
// This is the tool for tuning the rules in src/lib/score.mjs against real walks. From the project folder:
//   node scripts/analyze-clip.mjs walk1.mov walk2.mov
// Add ROTATE=90 for a clip that was filmed sideways. Clips stay on this computer: nothing goes to Gemini.
import path from 'node:path';
import { openHeadless } from './headless.mjs';
import { processFrames } from '../src/lib/process.mjs';

const clips = process.argv.slice(2);
if (!clips.length) {
  console.log('Usage: node scripts/analyze-clip.mjs <clip> [<clip> ...]');
  process.exit(1);
}
const HZ = Number(process.env.HZ) || 60;
const ROTATE = Number(process.env.ROTATE) || 0;
const chrome = await openHeadless(clips);

const show = (m) => (m?.ok ? m.value : 'n/a');
try {
  for (let i = 0; i < clips.length; i++) {
    const out = await chrome.analyze(i, HZ, ROTATE);
    const r = processFrames(out.raw, { W: out.W, H: out.H, duration: out.duration });
    const m = r.metrics;
    console.log(`\n=== ${path.basename(clips[i])}: ${out.W}x${out.H}, ${out.duration.toFixed(1)} s, ${out.raw.length} samples, analyzed in ${out.seconds.toFixed(1)} s by ${out.tracker} on ${out.delegate}, read by ${out.reader}`);
    console.log(`walk: ${r.phases.shape}, size change up ${r.phases.rise} and back ${r.phases.fall}; approach ${r.phases.approach}, turn ${r.phases.turn}, back ${r.phases.back}`);
    console.log(`coverage: ${Math.round(m.coverage.ratio * 100)}% of ${m.coverage.sampled} frames, ${m.coverage.validSeconds} s; ${JSON.stringify(m.coverage.counts)}`);
    console.log(`laps found: ${r.laps.length}; calibrated: ${r.stance ? `yes, ${r.stance.seconds} s, height ${r.stance.heightRatio} torso lengths, noise ${JSON.stringify(r.stance.noise)}` : 'no'}; steps ${m.stepCount}, cadence ${m.cadence}/min`);
    if (r.measured.laps) console.log(`lap scores: ${r.measured.laps.map((l) => l.points ?? 'unusable').join(', ')}`);
    console.log(`feet ${show(m.footLine)} | rhythm ${show(m.stepRhythm)} | pace ${show(m.pace)} | shoulder sway ${show(m.shoulderSway)} | trunk sway ${show(m.trunkSway)} | bounce ${show(m.bounce)}`);
    console.log(`neck ${show(m.neck)} (drop ${show(m.neckDrop)}) | chin ${show(m.gaze)} (drop ${show(m.gazeDrop)}) | line ${show(m.torsoSpread)} | head ${show(m.headMovement)} | arms ${show(m.armSwing)} balance ${show(m.armBalance)} | turn ${show(m.turnTime)} s wobble ${show(m.turnWobble)}`);
    if (r.measured.ok) {
      console.log(`SCORE ${r.measured.points}/${r.measured.max}: ${r.measured.parts.map((p) => `${p.label} ${p.points}/${p.max}`).join(', ')}`);
    } else {
      console.log(`NO SCORE: ${r.measured.reason}`);
    }
  }
} finally {
  chrome.close();
}
process.exit(0);
