// The RunwayLab showreel style: a 60 fps motion-graphics edit drawn frame by frame on a canvas in headless Chrome.
// Globals set by make.mjs: WALK (tracked frames), PLAN (from plan.mjs), FRAME_COUNT and SRC_FPS (source frames).
// Everything that changes between edits (times, captions, palette, numbers) comes from PLAN.
(() => {
  const W = 1080, H = 1920, FPS = 60;
  const B = PLAN.beat;
  const SW = PLAN.source.w, SH = PLAN.source.h;
  const { ink: INK, stage: STAGE, accent: VIOLET, deep: DEEP, hot: HOT } = PLAN.palette;
  const S = PLAN.sections, C = PLAN.captions, V = PLAN.values;
  const DISPLAY = '"Be Vietnam Pro", system-ui, sans-serif';
  const MONO = 'ui-monospace, Menlo, monospace';
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32], [29, 36], [30, 37], [33, 34], [34, 35]];

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const off = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const layer = off(), lctx = layer.getContext('2d');
  const chR = off(), chG = off(), chB = off();
  const stage1 = off(), s1 = stage1.getContext('2d'), stage2 = off(), s2 = stage2.getContext('2d');

  // ── helpers ──
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const outExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
  const outBack = (x) => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
  const inOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
  const outCubic = (x) => 1 - (1 - x) ** 3;
  let seed = 7;
  const rand = (n) => { const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); };
  // Strength of a hit that decays after each beat time in the list.
  const hit = (t, beats, decay = 0.22) => beats.reduce((m, k) => { const d = t - k * B; return d >= 0 && d < decay * 3 ? Math.max(m, Math.exp(-d / decay)) : m; }, 0);

  // ── source frames and poses ──
  const images = new Map();
  const frameIndex = (t) => clamp(Math.round(t * SRC_FPS), 0, FRAME_COUNT - 1);
  async function need(t) {
    const i = frameIndex(t);
    if (!images.has(i)) {
      const img = new Image();
      img.src = `/clip${i}.jpg`;
      images.set(i, img.decode().then(() => img));
    }
    return images.get(i);
  }
  const F = WALK.frames;
  function poseAt(t) {
    let lo = 0, hi = F.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid].t <= t) lo = mid; else hi = mid; }
    const a = F[lo], b = F[hi];
    if (!a.pts) return b.pts; if (!b.pts) return a.pts;
    const k = b.t === a.t ? 0 : clamp((t - a.t) / (b.t - a.t));
    return a.pts.map((p, i) => (p && b.pts[i] ? [lerp(p[0], b.pts[i][0], k), lerp(p[1], b.pts[i][1], k)] : p || b.pts[i]));
  }
  function bodyCenter(t, span = 0.35) {
    let sx = 0, sy = 0, n = 0;
    for (let d = -span; d <= span; d += span / 4) {
      const p = poseAt(t + d); if (!p) continue;
      const pts = p.filter(Boolean); const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      sx += (Math.min(...xs) + Math.max(...xs)) / 2; sy += (Math.min(...ys) + Math.max(...ys)) / 2; n++;
    }
    return n ? [sx / n, sy / n] : [SW / 2, SH / 2];
  }
  const mid = (p, a, b) => (p[a] && p[b] ? [(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2] : null);

  // A 9:16 window on the source; returns the mapping from source pixels to the screen.
  function view(cx, cy, zoom) {
    const h = SH / zoom, w = (h * 9) / 16;
    const x0 = clamp(cx - w / 2, 0, SW - w), y0 = clamp(cy - h / 2, 0, SH - h);
    const s = W / w;
    return { x0, y0, w, h, s, map: (p) => [(p[0] - x0) * s, (p[1] - y0) * s] };
  }
  function drawSource(c, img, v, { filter = 'none', alpha = 1, flip = false } = {}) {
    c.save(); c.globalAlpha = alpha; c.filter = filter;
    if (flip) { c.translate(W, 0); c.scale(-1, 1); }
    c.drawImage(img, v.x0, v.y0, v.w, v.h, 0, 0, W, H);
    c.restore();
  }

  // ── drawing pieces ──
  function skeleton(c, p, v, { color = VIOLET, width = 7, alpha = 1, glow = 26, joints = true, jointColor = INK } = {}) {
    if (!p) return;
    c.save(); c.globalAlpha = alpha; c.lineCap = 'round'; c.lineJoin = 'round';
    c.shadowColor = color; c.shadowBlur = glow; c.strokeStyle = color; c.lineWidth = width;
    c.beginPath();
    for (const [a, b] of BONES) { if (!p[a] || !p[b]) continue; const A = v.map(p[a]), Bp = v.map(p[b]); c.moveTo(...A); c.lineTo(...Bp); }
    c.stroke();
    if (joints) {
      c.shadowBlur = glow * 0.6; c.fillStyle = jointColor;
      for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 33, 34, 35]) { if (!p[i]) continue; const [x, y] = v.map(p[i]); c.beginPath(); c.arc(x, y, width * 0.95, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }
  function brackets(c, p, v, t, color = INK) {
    if (!p) return;
    const pts = p.filter(Boolean).map(v.map); const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const pad = 40, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad, L = 60;
    c.save(); c.strokeStyle = color; c.lineWidth = 4; c.globalAlpha = 0.9;
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { c.beginPath(); c.moveTo(x + dx * L, y); c.lineTo(x, y); c.lineTo(x, y + dy * L); c.stroke(); }
    c.font = `600 26px ${MONO}`; c.fillStyle = color; c.fillText(`ID 01 · CONF ${(0.93 + 0.04 * Math.sin(t * 9)).toFixed(2)}`, x0, Math.max(230, y0 - 16));
    c.restore();
  }
  function text(c, str, x, y, { size = 120, weight = 700, color = INK, align = 'center', font = DISPLAY, alpha = 1, track = 0, shadow = true } = {}) {
    c.save(); c.globalAlpha = alpha; c.font = `${weight} ${size}px ${font}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
    if (track) c.letterSpacing = `${track}px`;
    if (shadow) { c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 30; c.shadowOffsetY = 6; }
    c.fillText(str, x, y); c.restore();
  }
  // A mono readout that types on and ticks its number toward the true value.
  function readout(c, label, value, unit, x, y, t0, t, { color = INK, accent = VIOLET, digits = 1, align = 'left' } = {}) {
    const p = prog(t, t0, t0 + 0.35); if (p <= 0) return;
    const shown = (value * outCubic(p)).toFixed(digits);
    const chars = Math.ceil(label.length * clamp(p * 1.6));
    c.save(); c.textAlign = align;
    c.font = `600 30px ${MONO}`; c.fillStyle = color; c.globalAlpha = 0.85; c.letterSpacing = '3px';
    c.fillText(label.slice(0, chars), x, y);
    c.font = `700 64px ${MONO}`; c.globalAlpha = 1; c.fillStyle = accent; c.letterSpacing = '0px';
    c.fillText(`${shown}${unit}`, x, y + 68);
    c.restore();
  }
  function flash(c, a, color = '#fff') { if (a <= 0.01) return; c.save(); c.globalAlpha = clamp(a); c.fillStyle = color; c.fillRect(0, 0, W, H); c.restore(); }
  function vignette(c, s = 0.55) { const g = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${s})`); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  const grains = Array.from({ length: 6 }, (_, n) => { const g = document.createElement('canvas'); g.width = 360; g.height = 640; const gc = g.getContext('2d'); const d = gc.createImageData(360, 640); for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(rand(i + n * 99991) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } gc.putImageData(d, 0, 0); return g; });
  function grain(c, f, a = 0.07) { c.save(); c.globalAlpha = a; c.globalCompositeOperation = 'overlay'; c.imageSmoothingEnabled = false; c.drawImage(grains[f % grains.length], 0, 0, W, H); c.restore(); }
  function scanlines(c, a = 0.08) { c.save(); c.globalAlpha = a; c.fillStyle = '#000'; for (let y = 0; y < H; y += 6) c.fillRect(0, y, W, 2); c.restore(); }
  // Splits the layer into red, green and blue and offsets them.
  function rgbSplit(c, src, d) {
    if (d < 0.5) { c.drawImage(src, 0, 0); return; }
    for (const [cv, col] of [[chR, '#f00'], [chG, '#0f0'], [chB, '#00f']]) { const x = cv.getContext('2d'); x.globalCompositeOperation = 'source-over'; x.drawImage(src, 0, 0); x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, W, H); }
    c.save(); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
    c.drawImage(chR, d, 0); c.drawImage(chG, 0, 0); c.drawImage(chB, -d, d * 0.3); c.restore();
  }
  // Horizontal slices pushed sideways, a digital tear.
  function tear(c, src, amount, f) {
    if (amount < 0.02) { c.drawImage(src, 0, 0); return; }
    c.drawImage(src, 0, 0);
    for (let i = 0; i < 9; i++) { const y = Math.floor(rand(f * 31 + i) * H), h = 20 + rand(f * 7 + i) * 140, dx = (rand(f * 13 + i) - 0.5) * 260 * amount; c.drawImage(src, 0, y, W, h, dx, y, W, h); }
  }
  // Zoom punch on the layer: draws it scaled about the centre.
  function punch(c, src, s) { c.save(); c.translate(W / 2, H / 2); c.scale(s, s); c.translate(-W / 2, -H / 2); c.drawImage(src, 0, 0); c.restore(); }
  function chip(c, label, x, y, color = VIOLET) {
    c.save(); c.font = `700 30px ${MONO}`; c.letterSpacing = '3px'; const w = c.measureText(label).width + 36;
    c.fillStyle = color; c.fillRect(x, y - 40, w, 54); c.fillStyle = STAGE; c.fillText(label, x + 18, y - 3); c.restore();
  }
  function safeMeta(c, t, label) {
    c.save(); c.font = `600 24px ${MONO}`; c.fillStyle = INK; c.globalAlpha = 0.7; c.letterSpacing = '4px';
    c.fillText(label, 60, 150); c.textAlign = 'right'; c.fillText(`${String(Math.floor(t * 60)).padStart(4, '0')} · 60 FPS`, W - 60, 150); c.restore();
  }

  // ── the edit, beat by beat ──
  const frac = (p) => (p ? `${p.points} / ${p.max}` : '–');
  async function frame(f) {
    const t = f / FPS;
    const k = t / B; // beats
    lctx.save(); lctx.fillStyle = STAGE; lctx.fillRect(0, 0, W, H); lctx.restore();
    let shake = 0, split = 0, tearAmt = 0, zoom = 1, flashA = 0, flashCol = '#fff';
    const after = []; // overlays drawn after the layer effects

    if (k < S.drop) {
      // INTRO: three words on the three beats before the drop, over the frozen walker, the last as pure skeleton.
      const STILL = PLAN.still;
      const img = await need(STILL); const p = poseAt(STILL);
      const [cx, cy] = bodyCenter(STILL); const v = view(cx, cy, 1.05 + 0.08 * k);
      if (k < 2) drawSource(lctx, img, v, { filter: `grayscale(1) contrast(1.5) brightness(${k < 1 ? 0.45 : 0.32})` });
      if (k >= 1 && k < 2) { lctx.save(); lctx.globalCompositeOperation = 'difference'; lctx.fillStyle = DEEP; lctx.fillRect(0, 0, W, H); lctx.restore(); }
      if (k >= 2) {
        const reveal = outExpo(prog(k, 2, 2.6));
        lctx.save(); lctx.beginPath(); lctx.rect(0, 0, W, H * reveal); lctx.clip();
        skeleton(lctx, p, v, { width: 9, glow: 40 }); lctx.restore();
        lctx.save(); lctx.strokeStyle = VIOLET; lctx.globalAlpha = 0.18; lctx.lineWidth = 1;
        for (let x = 0; x < W; x += 90) { lctx.beginPath(); lctx.moveTo(x, 0); lctx.lineTo(x, H); lctx.stroke(); }
        for (let y = 0; y < H; y += 90) { lctx.beginPath(); lctx.moveTo(0, y); lctx.lineTo(W, y); lctx.stroke(); } lctx.restore();
      }
      C.intro.forEach((w, at) => {
        if (k < at || k >= at + 1) return;
        const e = prog(k, at, at + 0.35), s = lerp(1.6, 1, outExpo(e));
        const size = w.length > 8 ? 140 : w.length > 6 ? 168 : 230;
        after.push((c) => { c.save(); c.translate(W / 2, H * 0.47); c.scale(s, s); text(c, w, 0, 0, { size, track: -6, color: at === 1 ? STAGE : INK, shadow: at !== 1 }); c.restore(); });
      });
      if (k >= 1 && k < 2) after.unshift((c) => { const e = outExpo(prog(k, 1, 1.25)); c.save(); c.fillStyle = INK; c.fillRect(0, H * 0.47 - 200 * e, W, 300 * e); c.restore(); });
      split = 22 * hit(t, [0, 1, 2], 0.12); tearAmt = hit(t, [0, 1, 2], 0.1); shake = 18 * hit(t, [0, 1, 2], 0.08);
      zoom = 1 + 0.25 * inOut(prog(k, 2.4, 3)) ** 2;
      after.push((c) => safeMeta(c, t, 'RUNWAYLAB / SHOWREEL'));
    } else if (k < S.turn) {
      // DROP: the first walk at full speed, tracked live.
      const src = PLAN.drop.start + (t - S.drop * B);
      const img = await need(src); const p = poseAt(src);
      const [cx] = bodyCenter(src); const v = view(cx, SH / 2, 1);
      drawSource(lctx, img, v, { filter: 'contrast(1.12) saturate(1.15)' });
      for (let i = 6; i >= 1; i--) skeleton(lctx, poseAt(src - i * 0.06), v, { alpha: 0.12 * (7 - i) / 6, width: 5, glow: 0, joints: false });
      skeleton(lctx, p, v);
      if (p) after.push((c) => brackets(c, p, v, t));
      after.push((c) => {
        safeMeta(c, t, 'TRACKING · 38 POINTS');
        if (V.shoulderRock !== null) readout(c, 'SHOULDER ROCK', V.shoulderRock, '°', 64, 1290, (S.drop + 0.5) * B, t);
        if (V.headDrift !== null) readout(c, 'HEAD DRIFT', V.headDrift, '%', 64, 1440, (S.drop + 1.5) * B, t, { digits: 2 });
        if (V.cadence) readout(c, 'CADENCE', V.cadence, '/MIN', 64, 1590, (S.drop + 2.5) * B, t, { digits: 0 });
        if (PLAN.socials && k >= S.drop + 1) chip(c, PLAN.socials.toUpperCase(), 64, 1180, VIOLET);
        if (k >= S.drop + 4) chip(c, 'LIVE', W - 190, 260, HOT);
      });
      const beats = [0, 1, 2, 3, 4, 5].map((i) => S.drop + i);
      zoom = 1 + 0.09 * hit(t, beats, 0.12);
      split = 16 * hit(t, [S.drop, S.drop + 2, S.drop + 4], 0.1) + 30 * hit(t, [S.drop], 0.2);
      flashA = hit(t, [S.drop], 0.12);
      shake = 14 * hit(t, [S.drop], 0.1);
    } else if (k < S.montage) {
      // TURN: slow motion, a dial sweeping round the hips.
      const src = PLAN.turn.start + (t - S.turn * B) * PLAN.turn.speed;
      const img = await need(src); const p = poseAt(src);
      const [cx] = bodyCenter(src, 0.5); const v = view(cx, SH / 2, 1.1);
      drawSource(lctx, img, v, { filter: 'grayscale(1) contrast(1.3) brightness(0.8)' });
      lctx.save(); lctx.globalCompositeOperation = 'color'; lctx.fillStyle = DEEP; lctx.fillRect(0, 0, W, H); lctx.restore();
      skeleton(lctx, p, v, { color: INK, glow: 18, jointColor: VIOLET });
      const hip = p && (mid(p, 23, 24) || mid(p, 11, 12)); const sh = p && p[11] && p[12] ? Math.hypot(p[11][0] - p[12][0], p[11][1] - p[12][1]) * v.s : 300;
      after.push((c) => {
        if (hip) {
          const [hx, hy] = v.map(hip); const r = Math.max(260, sh * 1.25);
          const e = outExpo(prog(k, S.turn, S.turn + 0.6)), sweep = prog(k, S.turn, S.montage) * Math.PI * 2;
          c.save(); c.translate(hx, hy); c.strokeStyle = VIOLET; c.lineWidth = 3; c.globalAlpha = 0.9;
          c.beginPath(); c.arc(0, 0, r * e, 0, Math.PI * 2); c.stroke();
          for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2 + k * 0.3; const L = i % 6 ? 14 : 34; c.beginPath(); c.moveTo(Math.cos(a) * r * e, Math.sin(a) * r * e); c.lineTo(Math.cos(a) * (r * e + L), Math.sin(a) * (r * e + L)); c.stroke(); }
          c.lineWidth = 14; c.strokeStyle = HOT; c.shadowColor = HOT; c.shadowBlur = 24; c.beginPath(); c.arc(0, 0, r * e + 60, -Math.PI / 2, -Math.PI / 2 + sweep); c.stroke();
          c.restore();
        }
        text(c, C.turn, W / 2, 330, { size: C.turn.length > 9 ? 100 : 120, track: 8, alpha: outExpo(prog(k, S.turn, S.turn + 0.4)) });
        if (V.turnTime !== null) readout(c, 'TIME', Math.min(V.turnTime, (t - S.turn * B) * PLAN.turn.speed), ' S', W / 2, 1520, S.turn * B, t, { align: 'center', digits: 2 });
        if (k >= S.turn + 2 && V.turn) chip(c, `TURN  ${V.turn.points}/${V.turn.max}`, W / 2 - 150, 1730, VIOLET);
        safeMeta(c, t, `SLOW MOTION · ${PLAN.turn.speed.toFixed(1)}×`);
      });
      zoom = 1 + 0.06 * hit(t, [S.turn, S.turn + 2], 0.15);
      split = 10 * hit(t, [S.turn], 0.2);
    } else if (k < S.chrono) {
      // MONTAGE: one detail per beat.
      const beat = Math.floor(k) - S.montage, local = t - Math.floor(k) * B;
      const cut = PLAN.montage[Math.min(beat, PLAN.montage.length - 1)]; const src = cut.src + local;
      const img = await need(src); const p = poseAt(src);
      let c0 = bodyCenter(src, 0.2);
      if (p && cut.focus === 'feet') c0 = mid(p, 27, 28) || c0;
      if (p && cut.focus === 'shoulders') c0 = mid(p, 11, 12) || c0;
      if (p && cut.focus === 'head') c0 = p[0] || c0;
      const v = view(c0[0], c0[1], cut.zoom);
      if (cut.focus === 'triptych') {
        for (let i = 0; i < 3; i++) {
          const ts = cut.moments[i] + local, im = await need(ts), [px] = bodyCenter(ts, 0.2);
          const ph = SH, pw = (ph * (W / 3 - 8)) / H, sx0 = clamp(px - pw / 2, 0, SW - pw);
          const slide = outExpo(prog(local, i * 0.07, i * 0.07 + 0.25));
          lctx.save(); lctx.translate(0, (1 - slide) * (i % 2 ? -H : H) * 0.4);
          lctx.filter = i === 1 ? 'contrast(1.2) saturate(1.15)' : 'grayscale(1) contrast(1.3)';
          lctx.drawImage(im, sx0, 0, pw, ph, i * (W / 3) + 4, 0, W / 3 - 8, H);
          lctx.restore();
        }
      } else if (cut.focus === 'mirror') {
        drawSource(lctx, img, v, { filter: 'contrast(1.2) saturate(1.2)' });
        lctx.save(); lctx.beginPath(); lctx.rect(W / 2, 0, W / 2, H); lctx.clip(); drawSource(lctx, img, v, { filter: 'contrast(1.2) saturate(1.2)', flip: true }); lctx.restore();
        lctx.save(); lctx.strokeStyle = INK; lctx.lineWidth = 3; lctx.beginPath(); lctx.moveTo(W / 2, 0); lctx.lineTo(W / 2, H); lctx.stroke(); lctx.restore();
      } else {
        const dim = cut.focus === 'lines' ? 'brightness(0.25) grayscale(1)' : cut.focus === 'back' ? 'contrast(1.25) saturate(1.3)' : 'contrast(1.15) saturate(1.1)';
        drawSource(lctx, img, v, { filter: dim });
        if (cut.focus === 'lines') skeleton(lctx, p, v, { width: 10, glow: 44 });
      }
      after.push((c) => {
        const e = outExpo(prog(local, 0, 0.18));
        if (cut.focus === 'feet' && p && p[27] && p[28]) {
          const a = v.map(p[27]), b = v.map(p[28]);
          c.save(); c.strokeStyle = HOT; c.lineWidth = 6; c.setLineDash([22, 14]);
          for (const q of [a, b]) { c.beginPath(); c.moveTo(q[0], q[1] - 400 * e); c.lineTo(q[0], q[1] + 120); c.stroke(); }
          c.setLineDash([]); c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(a[0], a[1] + 60); c.lineTo(b[0], b[1] + 60); c.stroke(); c.restore();
          if (V.footLine !== null) readout(c, 'FOOT LINE', V.footLine, '%', 64, 1380, Math.floor(k) * B, t);
        }
        if (cut.focus === 'shoulders' && p && p[11] && p[12]) {
          const a = v.map(p[11]), b = v.map(p[12]);
          c.save(); c.strokeStyle = VIOLET; c.lineWidth = 7; c.shadowColor = VIOLET; c.shadowBlur = 20; c.beginPath(); c.moveTo(lerp(b[0], a[0], -0.25), lerp(b[1], a[1], -0.25)); c.lineTo(lerp(b[0], a[0], 1.25 * e), lerp(b[1], a[1], 1.25 * e)); c.stroke(); c.restore();
          if (V.shoulderRock !== null) readout(c, 'SHOULDER ROCK', V.shoulderRock, '°', 64, 1380, Math.floor(k) * B, t);
        }
        if (cut.focus === 'head' && p && p[0]) {
          const [x, y] = v.map(p[0]); const r = 120 + 30 * (1 - e);
          c.save(); c.strokeStyle = INK; c.lineWidth = 4; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(x + dx * (r - 30), y + dy * (r - 30)); c.lineTo(x + dx * (r + 40), y + dy * (r + 40)); c.stroke(); }
          c.restore(); if (V.headDrift !== null) readout(c, 'HEAD DRIFT', V.headDrift, '%', 64, 1380, Math.floor(k) * B, t, { digits: 2 });
        }
        if (cut.focus === 'lines') { text(c, C.posture, W / 2, 360, { size: 130, track: 10, alpha: e }); chip(c, frac(V.posture), W / 2 - 110, 470, VIOLET); }
        if (cut.focus === 'triptych') text(c, C.sequence, W / 2, 1640, { size: C.sequence.length > 11 ? 90 : 110, track: 4, alpha: e });
        if (cut.focus === 'back' && V.arms) chip(c, `ARMS  ${V.arms.points}/${V.arms.max}`, 64, 1600, HOT);
        if (cut.focus === 'mirror') { text(c, C.balance, W / 2, 360, { size: 130, track: 10, alpha: e }); if (V.head) chip(c, `HEAD  ${V.head.points}/${V.head.max}`, W / 2 - 130, 470, VIOLET); }
        safeMeta(c, t, `DETAIL ${String(beat + 1).padStart(2, '0')} / ${String(PLAN.montage.length).padStart(2, '0')}`);
      });
      zoom = cut.focus === 'whip' ? 1 + 1.4 * prog(local, 0, B) ** 3 : 1 + 0.1 * Math.exp(-local / 0.12);
      split = 14 * Math.exp(-local / 0.08) + (cut.focus === 'back' ? 18 : 0);
      tearAmt = beat % 2 ? 0.7 * Math.exp(-local / 0.06) : 0;
      if (cut.focus === 'whip') flashA = prog(local, B * 0.65, B) ** 2;
    } else if (k < S.score) {
      // CHRONOPHOTOGRAPHY: the last walk, every pose left behind as a trace.
      const s0 = PLAN.chrono.start, src = s0 + (t - S.chrono * B) * PLAN.chrono.speed;
      const img = await need(src); const p = poseAt(src);
      const [cx] = bodyCenter(src, 0.5); const v = view(cx, SH / 2, 1);
      drawSource(lctx, img, v, { filter: 'grayscale(1) brightness(0.35) contrast(1.4)' });
      for (let ts = s0; ts < src - 0.05; ts += 0.2) {
        const age = (src - ts) / (src - s0 + 0.001);
        skeleton(lctx, poseAt(ts), view(bodyCenter(ts, 0.5)[0], SH / 2, 1), { alpha: 0.15 + 0.35 * (1 - age), width: 4, glow: 0, joints: false, color: VIOLET });
      }
      skeleton(lctx, p, v, { color: INK, width: 8, glow: 30, jointColor: HOT });
      after.push((c) => {
        safeMeta(c, t, 'CHRONOPHOTOGRAPH · 5 HZ');
        text(c, C.chronoTitle, W / 2, 380, { size: C.chronoTitle.length > 10 ? 120 : 150, track: 2, alpha: outExpo(prog(k, S.chrono, S.chrono + 0.4)) });
        text(c, C.chronoSub, W / 2, 460, { size: 40, font: MONO, weight: 600, track: 8, color: VIOLET, alpha: outExpo(prog(k, S.chrono + 0.5, S.chrono + 1)) });
      });
      flashA = hit(t, [S.chrono], 0.15) * 0.8; split = 20 * hit(t, [S.chrono, S.chrono + 2], 0.12); zoom = 1 + 0.06 * hit(t, [0, 1, 2, 3].map((i) => S.chrono + i), 0.12);
    } else {
      // SCORE: the bars, the number, the name.
      const R = S.score;
      const img = await need(PLAN.scoreStill); const [cx] = bodyCenter(PLAN.scoreStill); const v = view(cx, SH / 2, 1 + 0.03 * (k - R));
      drawSource(lctx, img, v, { filter: 'blur(28px) grayscale(0.6) brightness(0.35)' });
      lctx.save(); lctx.globalCompositeOperation = 'color'; lctx.fillStyle = DEEP; lctx.globalAlpha = 0.6; lctx.fillRect(0, 0, W, H); lctx.restore();
      after.push((c) => {
        V.parts.forEach((part, i) => {
          const at = R + i * 0.45, e = outExpo(prog(k, at, at + 0.4)), fill = outCubic(prog(k, at + 0.15, at + 0.9));
          if (e <= 0) return;
          const y = 1010 + i * 92, x = 90 + (1 - e) * -400, w = W - 180;
          c.save(); c.globalAlpha = e;
          c.font = `600 30px ${MONO}`; c.fillStyle = INK; c.letterSpacing = '2px'; c.fillText(part.label.toUpperCase(), x, y);
          c.textAlign = 'right'; c.fillText(part.seen === false ? 'NOT SEEN' : `${Math.round(part.points * fill)}/${part.max}`, x + w, y);
          c.fillStyle = 'rgba(247,243,236,.16)'; c.fillRect(x, y + 16, w, 14);
          c.fillStyle = part.points / part.max >= 0.75 ? VIOLET : part.points === 0 ? HOT : INK; c.fillRect(x, y + 16, w * (part.points / part.max) * fill, 14);
          c.restore();
        });
        const n = V.score === null ? '–' : String(Math.round(V.score * outCubic(prog(k, R + 3, R + 4))));
        const slam = prog(k, R + 4, R + 4.3), s = k < R + 4 ? 0.9 : lerp(1.35, 1, outBack(slam));
        if (k >= R + 3) {
          c.save(); c.translate(W / 2, 700); c.scale(s, s);
          text(c, n, -30, 0, { size: 400, track: -16 });
          text(c, `/${V.max}`, n.length > 1 ? 230 : 130, -6, { size: 120, align: 'left', color: VIOLET });
          c.restore();
        }
        if (k >= R + 4) text(c, V.grade, W / 2, 820, { size: 64, track: 12, color: VIOLET, alpha: outExpo(prog(k, R + 4.1, R + 4.5)) });
        if (PLAN.socials && k >= R + 4.5) text(c, `WALK BY ${PLAN.socials.toUpperCase()}`, W / 2, 900, { size: 34, font: MONO, weight: 600, track: 4, alpha: outExpo(prog(k, R + 4.5, R + 5)) });
        if (k >= R + 5.5) {
          const e = outExpo(prog(k, R + 5.5, R + 6));
          c.save(); c.beginPath(); c.rect(0, 1700, W * e, 200); c.clip();
          text(c, 'RunwayLab', W / 2, 1790, { size: 104, track: -2 });
          text(c, 'runwaylab-mu.vercel.app', W / 2, 1850, { size: 30, font: MONO, weight: 600, color: VIOLET, track: 2 });
          c.restore();
        }
        safeMeta(c, t, 'RESULT · MEASURED HALF');
      });
      flashA = hit(t, [R + 4], 0.14) * 0.9 + hit(t, [R], 0.12) * 0.6; shake = 26 * hit(t, [R + 4], 0.1); split = 18 * hit(t, [R + 4], 0.15);
      if (k >= R + 7) { flashA = 1; flashCol = '#000'; }
    }

    // ── composite ──
    ctx.save(); ctx.fillStyle = STAGE; ctx.fillRect(0, 0, W, H);
    ctx.translate((rand(f * 3) - 0.5) * shake, (rand(f * 5) - 0.5) * shake);
    s1.fillStyle = STAGE; s1.fillRect(0, 0, W, H); punch(s1, layer, zoom);
    s2.fillStyle = STAGE; s2.fillRect(0, 0, W, H); tear(s2, stage1, tearAmt, f);
    rgbSplit(ctx, stage2, split);
    ctx.restore();
    vignette(ctx);
    for (const draw of after) draw(ctx);
    scanlines(ctx, 0.05);
    grain(ctx, f);
    flash(ctx, flashA, flashCol);
    return canvas.toDataURL('image/jpeg', 0.93).slice(23);
  }

  window.renderFrame = frame;
  window.reelReady = true;
})();
