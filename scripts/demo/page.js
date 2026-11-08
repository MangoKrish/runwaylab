// Drawn in headless Chrome by scripts/demo/edit.mjs. The screen recording sits in a browser window on a soft
// background; a camera eases in and out of what matters; the cursor and captions are drawn on top.
// window.DEMO holds the layout; renderFrame(state) draws one frame and returns it as a JPEG in base64.
(() => {
  const { OW, OH, WIN, CSS_W, CSS_H, TITLE_H } = window.DEMO;
  const canvas = document.createElement('canvas');
  canvas.width = OW;
  canvas.height = OH;
  const c = canvas.getContext('2d');
  const NAVY = '#14213D';
  const CREAM = '#F4EDE0';
  const APRICOT = '#F2C38B';
  const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

  // Source frames, decoded once each and kept for a little while.
  const cache = new Map();
  async function frame(i) {
    if (cache.has(i)) return cache.get(i);
    const img = new Image();
    img.src = `/clip${i}.jpg`;
    await img.decode();
    cache.set(i, img);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return img;
  }

  let fox = null;
  window.loadFox = async () => {
    const { foxMark } = await import('/src/ui/fox.mjs');
    const svg = foxMark();
    svg.setAttribute('width', '256');
    svg.setAttribute('height', '256');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await img.decode();
    fox = img;
    return true;
  };

  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const out = (u) => 1 - (1 - Math.min(Math.max(u, 0), 1)) ** 3;

  function rounded(x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function background(t) {
    c.fillStyle = NAVY;
    c.fillRect(0, 0, OW, OH);
    // Two slow glows, the house apricot and a deeper blue, drifting.
    const blobs = [
      [0.22 + 0.05 * Math.sin(t * 0.21), 0.78 + 0.04 * Math.cos(t * 0.17), 0.62, 'rgba(242,195,139,0.22)'],
      [0.82 + 0.04 * Math.cos(t * 0.13), 0.2 + 0.05 * Math.sin(t * 0.19), 0.7, 'rgba(66,86,131,0.55)'],
      [0.6 + 0.06 * Math.sin(t * 0.11), 0.95, 0.5, 'rgba(242,195,139,0.10)'],
    ];
    for (const [x, y, r, col] of blobs) {
      const g = c.createRadialGradient(x * OW, y * OH, 0, x * OW, y * OH, r * OW);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(20,33,61,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, OW, OH);
    }
  }

  function browserWindow(img, alpha, lift) {
    const { x, y, w } = WIN;
    const h = TITLE_H + CSS_H;
    c.save();
    c.globalAlpha = alpha;
    c.translate(0, lift);
    c.shadowColor = 'rgba(5,10,24,0.55)';
    c.shadowBlur = 60;
    c.shadowOffsetY = 24;
    rounded(x, y, w, h, 14);
    c.fillStyle = '#0F1A31';
    c.fill();
    c.shadowColor = 'transparent';
    c.save();
    rounded(x, y, w, h, 14);
    c.clip();
    // Title bar: three dots and the address.
    c.fillStyle = '#0F1A31';
    c.fillRect(x, y, w, TITLE_H);
    ['#FF6B6B', '#F2C38B', '#8FD1A8'].forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath();
      c.arc(x + 22 + i * 20, y + TITLE_H / 2, 6, 0, Math.PI * 2);
      c.fill();
    });
    const pillW = 360;
    rounded(x + w / 2 - pillW / 2, y + 8, pillW, TITLE_H - 16, 8);
    c.fillStyle = '#1A2A4B';
    c.fill();
    c.fillStyle = '#B0A899';
    c.font = `500 14px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('runwaylab-mu.vercel.app', x + w / 2, y + TITLE_H / 2 + 1);
    if (img) c.drawImage(img, x, y + TITLE_H, CSS_W, CSS_H);
    c.restore();
    c.strokeStyle = 'rgba(244,237,224,0.10)';
    c.lineWidth = 1;
    rounded(x + 0.5, y + 0.5, w - 1, h - 1, 14);
    c.stroke();
    c.restore();
  }

  function cursor(x, y, press) {
    c.save();
    c.translate(x, y);
    const s = 1.15 * (1 - 0.12 * press);
    c.scale(s, s);
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = 6;
    c.shadowOffsetY = 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 21);
    c.lineTo(5, 16);
    c.lineTo(8.5, 24);
    c.lineTo(12, 22.5);
    c.lineTo(8.6, 14.8);
    c.lineTo(15.5, 14.8);
    c.closePath();
    c.fillStyle = '#FFFFFF';
    c.fill();
    c.shadowColor = 'transparent';
    c.lineWidth = 1.4;
    c.strokeStyle = '#111';
    c.stroke();
    c.restore();
  }

  function ripple(x, y, age) {
    const u = age / 0.45;
    if (u < 0 || u > 1) return;
    c.save();
    c.globalAlpha = 0.55 * (1 - u);
    c.strokeStyle = APRICOT;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, 8 + 26 * out(u), 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  function caption(cap) {
    if (!cap) return;
    const a = Math.min(out(cap.age / 0.35), out((cap.life - cap.age) / 0.35));
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    c.font = `600 34px ${FONT}`;
    const tw = c.measureText(cap.text).width;
    const padX = 30;
    const w = tw + padX * 2 + 22;
    const h = 70;
    const x = (OW - w) / 2;
    // At the top: the studio shows its own prompts across the bottom of the camera picture.
    const y = 34 - (1 - a) * 16;
    c.shadowColor = 'rgba(5,10,24,0.5)';
    c.shadowBlur = 30;
    rounded(x, y, w, h, h / 2);
    c.fillStyle = 'rgba(15,26,49,0.92)';
    c.fill();
    c.shadowColor = 'transparent';
    c.strokeStyle = 'rgba(242,195,139,0.35)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = APRICOT;
    c.beginPath();
    c.arc(x + padX + 4, y + h / 2, 6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = CREAM;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(cap.text, x + padX + 22, y + h / 2 + 1);
    c.restore();
  }

  function chip(text) {
    if (!text) return;
    c.save();
    c.font = `700 22px ${FONT}`;
    const w = c.measureText(text).width + 56;
    const x = OW - w - 40;
    const y = OH - 80;
    rounded(x, y, w, 44, 22);
    c.fillStyle = 'rgba(15,26,49,0.85)';
    c.fill();
    c.fillStyle = APRICOT;
    // Fast-forward mark.
    c.beginPath();
    c.moveTo(x + 16, y + 14); c.lineTo(x + 26, y + 22); c.lineTo(x + 16, y + 30); c.closePath();
    c.moveTo(x + 26, y + 14); c.lineTo(x + 36, y + 22); c.lineTo(x + 26, y + 30); c.closePath();
    c.fill();
    c.fillStyle = CREAM;
    c.textBaseline = 'middle';
    c.fillText(text, x + 44, y + 23);
    c.restore();
  }

  const SERIF = '"Bodoni Moda", Georgia, serif';

  /** The plate frame from the site: a cream rule, an inner hairline, inset from the edge of the frame. */
  function plateFrame(a) {
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = 'rgba(244,237,224,0.55)';
    c.lineWidth = 2;
    c.strokeRect(56, 56, OW - 112, OH - 112);
    c.strokeStyle = 'rgba(244,237,224,0.16)';
    c.lineWidth = 1;
    c.strokeRect(64.5, 64.5, OW - 129, OH - 129);
    c.restore();
  }

  /** The dashed gold floor tape from the hero, drawn left to right as u goes from 0 to 1. */
  function floorTape(cx, y, w, u) {
    if (u <= 0) return;
    c.save();
    c.beginPath();
    c.rect(cx - w / 2, y - 4, w * Math.min(1, u), 8);
    c.clip();
    c.fillStyle = APRICOT;
    for (let x = cx - w / 2; x < cx + w / 2; x += 34) c.fillRect(x, y - 1.5, 22, 3);
    c.restore();
  }

  /** A name set like the site's masthead: the first part upright, "Lab" in italic gold. */
  function masthead(y, size, alpha) {
    c.save();
    c.globalAlpha = alpha;
    c.textBaseline = 'alphabetic';
    c.font = `600 ${size}px ${SERIF}`;
    const a = c.measureText('Runway').width;
    c.font = `italic 400 ${size}px ${SERIF}`;
    const b = c.measureText('Lab').width;
    const x = OW / 2 - (a + b) / 2;
    c.textAlign = 'left';
    c.font = `600 ${size}px ${SERIF}`;
    c.fillStyle = CREAM;
    c.fillText('Runway', x, y);
    c.font = `italic 400 ${size}px ${SERIF}`;
    c.fillStyle = APRICOT;
    c.fillText('Lab', x + a, y);
    c.restore();
  }

  function label(text, y, alpha) {
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = APRICOT;
    c.font = `600 24px ${FONT}`;
    c.textAlign = 'center';
    c.letterSpacing = '6px';
    c.fillText(text, OW / 2, y);
    c.restore();
  }

  function serifCard(a, t, kind) {
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    background(t);
    c.restore();
    plateFrame(a);
    const rise = (1 - out(t / 0.9)) * 24;
    if (kind === 'intro') {
      label('HACKTRENT 2026  ·  PLATE I', OH / 2 - 150, a * out(t / 0.6));
      masthead(OH / 2 + 40 + rise, 176, a);
      floorTape(OW / 2, OH / 2 + 82, 640, out((t - 0.5) / 0.9));
      c.save();
      c.globalAlpha = a * out((t - 0.8) / 0.6);
      c.fillStyle = '#D3CBBC';
      c.font = `italic 400 48px ${SERIF}`;
      c.textAlign = 'center';
      c.fillText('Can code judge a runway walk?', OW / 2, OH / 2 + 168);
      c.restore();
    } else {
      masthead(OH / 2 - 40 + rise, 150, a);
      floorTape(OW / 2, OH / 2 + 2, 560, out((t - 0.3) / 0.8));
      c.save();
      c.textAlign = 'center';
      c.globalAlpha = a * out((t - 0.3) / 0.6);
      c.fillStyle = APRICOT;
      c.font = `600 38px ${FONT}`;
      c.fillText('runwaylab-mu.vercel.app', OW / 2, OH / 2 + 74);
      c.globalAlpha = a * out((t - 0.6) / 0.6);
      c.fillStyle = '#D3CBBC';
      c.font = `500 28px ${FONT}`;
      c.fillText('Pose tracking in the browser  ·  Gemini  ·  Tiger Data  ·  Auth0', OW / 2, OH / 2 + 136);
      c.globalAlpha = a * out((t - 0.9) / 0.6);
      if (fox) c.drawImage(fox, OW / 2 - 150, OH - 196, 56, 56);
      c.fillStyle = CREAM;
      c.font = `600 28px ${FONT}`;
      c.textAlign = 'left';
      c.fillText('Made by Annontrix', OW / 2 - 80, OH - 158);
      c.restore();
    }
  }

  /** The card in the music's break: the film holds its breath, then the wall lands on the beat. */
  function breakCard(b, t) {
    if (!b) return;
    const a = out(b.age / 0.3);
    c.save();
    c.globalAlpha = a;
    c.fillStyle = '#0B1428';
    c.fillRect(0, 0, OW, OH);
    c.restore();
    plateFrame(a * 0.8);
    const u = b.age / b.life;
    label('07  ·  THE WALL', OH / 2 - 110, a);
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.fillStyle = CREAM;
    c.font = `600 112px ${SERIF}`;
    c.fillText('Then it goes', OW / 2, OH / 2 + 10 - (1 - out(b.age / 0.6)) * 18);
    c.globalAlpha = out((b.age - 0.45) / 0.5);
    c.fillStyle = APRICOT;
    c.font = `italic 400 112px ${SERIF}`;
    c.fillText('on the wall.', OW / 2, OH / 2 + 130);
    c.restore();
    floorTape(OW / 2, OH / 2 + 172, 520, out((u - 0.35) / 0.6));
  }

  function titleCard(a, t, kind, serif) {
    if (serif) return serifCard(a, t, kind);
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    background(t);
    const rise = (1 - out(t / 0.9)) * 30;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    if (kind === 'intro') {
      c.fillStyle = APRICOT;
      c.font = `600 28px ${FONT}`;
      c.fillText('HACKTRENT 2026', OW / 2, OH / 2 - 120 + rise);
      c.fillStyle = CREAM;
      c.font = `700 148px ${FONT}`;
      c.fillText('RunwayLab', OW / 2, OH / 2 + 30 + rise);
      c.globalAlpha = a * out((t - 0.5) / 0.6);
      c.fillStyle = '#D3CBBC';
      c.font = `500 40px ${FONT}`;
      c.fillText('Can code judge a runway walk?', OW / 2, OH / 2 + 110);
    } else {
      c.fillStyle = CREAM;
      c.font = `700 120px ${FONT}`;
      c.fillText('RunwayLab', OW / 2, OH / 2 - 60 + rise);
      c.fillStyle = APRICOT;
      c.font = `600 40px ${FONT}`;
      c.fillText('runwaylab-mu.vercel.app', OW / 2, OH / 2 + 10 + rise);
      c.globalAlpha = a * out((t - 0.4) / 0.6);
      c.fillStyle = '#D3CBBC';
      c.font = `500 30px ${FONT}`;
      c.fillText('Pose tracking in the browser  ·  Gemini  ·  Tiger Data  ·  Auth0', OW / 2, OH / 2 + 80);
      c.globalAlpha = a * out((t - 0.8) / 0.6);
      if (fox) c.drawImage(fox, OW / 2 - 150, OH - 170, 56, 56);
      c.fillStyle = CREAM;
      c.font = `600 28px ${FONT}`;
      c.textAlign = 'left';
      c.fillText('Made by Annontrix', OW / 2 - 80, OH - 132);
    }
    c.restore();
  }

  window.renderFrame = async (s) => {
    const img = s.src === null ? null : await frame(s.src);
    c.save();
    if (s.punch) {
      c.translate(OW / 2, OH / 2);
      c.scale(1 + s.punch, 1 + s.punch);
      c.translate(-OW / 2, -OH / 2);
    }
    background(s.t);
    if (s.windowAlpha > 0) {
      c.save();
      const { z, cx, cy } = s.cam;
      c.translate(OW / 2, OH / 2);
      c.scale(z, z);
      c.translate(-cx, -cy);
      browserWindow(img, s.windowAlpha, s.lift);
      if (s.cursor) {
        if (s.click) ripple(s.click.x, s.click.y, s.click.age);
        cursor(s.cursor.x, s.cursor.y, s.press);
      }
      c.restore();
    }
    c.restore();
    chip(s.chip);
    caption(s.caption);
    breakCard(s.brk, s.t);
    titleCard(s.intro, s.t, 'intro', s.serif);
    titleCard(s.outro, s.outroT, 'outro', s.serif);
    return canvas.toDataURL('image/jpeg', 0.92).slice(23);
  };
})();
