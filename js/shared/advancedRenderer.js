const ADV_SCALE      = 10;
const ADV_VIEWPORT_H = 700;
const ADV_Y_MAX      = 6020;
const ADV_FIELD_W    = 27100;

const advImg   = {};
let   advReady = false;

function tryLoad(name) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      const fb = new Image();
      fb.onload  = () => resolve(fb);
      fb.onerror = () => resolve(null);
      fb.src = '../assets/' + name;
    };
    img.src = 'assets/' + name;
  });
}

export async function loadAdvancedAssets() {
  const [bg, pA, pB, ball, scorePanel] = await Promise.all([
    tryLoad('BG.png'),
    tryLoad('player_a.png'),
    tryLoad('player_b.png'),
    tryLoad('Ball.png'),
    tryLoad('score_panel.png'),
  ]);
  advImg.bg         = bg;
  advImg.playerA    = pA;
  advImg.playerB    = pB;
  advImg.ball       = ball;
  advImg.scorePanel = scorePanel;
  advReady          = true;
}

function w2x(wx, camL) { return (wx - camL) / ADV_SCALE; }
function w2y(wy)       { return (ADV_Y_MAX - wy) / ADV_SCALE; }

// ── Bonus / multiplier tag ──────────────────────────────────────────────────

const HIGHLIGHT_DURATION = 40;

function drawTag(ctx, x, y, label, isHarm, highlight) {
  ctx.save();
  ctx.font = 'bold 32px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tw = ctx.measureText(label).width;
  const px = 12, py = 8;
  const bw = tw + px * 2, bh = 36 + py * 2, br = 8;
  const bx = x - bw / 2, by = y - bh / 2;

  if (highlight) {
    ctx.shadowColor = isHarm ? '#ff4040' : '#40ff80';
    ctx.shadowBlur  = 14;
  }
  ctx.fillStyle = isHarm ? '#3a1020' : '#1a1a6e';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.fill();
  ctx.shadowBlur = 0;

  if (highlight) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2.5;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.stroke();
  }

  ctx.fillStyle = isHarm ? '#e05858' : '#ffffff';
  ctx.fillText(label, x, y);
  ctx.restore();
}

// ── Main render ─────────────────────────────────────────────────────────────

export function renderAdvanced(result, canvas, frame, roundElapsed) {
  if (!advReady) return;

  const CW = canvas.parentElement?.clientWidth || window.innerWidth;
  canvas.width  = CW;
  canvas.height = ADV_VIEWPORT_H;
  const ctx = canvas.getContext('2d');

  const drawAll = frame < 0;
  const lastIdx = drawAll
    ? result.path.length - 1
    : Math.min(frame, result.path.length - 1);

  const bwx = result.path[lastIdx]?.dist ?? ADV_FIELD_W / 2;
  const bwy = result.path[lastIdx]?.alt  ?? 0;

  // ── Camera (centered on ball, clamped to field) ───────────────────────────
  const viewW = CW * ADV_SCALE;
  let camL = bwx - viewW / 2;
  if (viewW >= ADV_FIELD_W) {
    camL = (ADV_FIELD_W - viewW) / 2;
  } else {
    camL = Math.max(0, Math.min(ADV_FIELD_W - viewW, camL));
  }

  // ── Background ────────────────────────────────────────────────────────────
  const fL = w2x(0, camL);
  const fW = ADV_FIELD_W / ADV_SCALE;

  if (advImg.bg) {
    ctx.drawImage(advImg.bg, fL, 0, fW, ADV_VIEWPORT_H);
  } else {
    ctx.fillStyle = '#1a5c2a';
    ctx.fillRect(fL, 0, fW, ADV_VIEWPORT_H);
  }

  // Dark fill outside the field
  if (fL > 0) {
    ctx.fillStyle = '#050a10';
    ctx.fillRect(0, 0, fL, ADV_VIEWPORT_H);
  }
  const fR = fL + fW;
  if (fR < CW) {
    ctx.fillStyle = '#050a10';
    ctx.fillRect(fR, 0, CW - fR, ADV_VIEWPORT_H);
  }

  // ── Ground line ───────────────────────────────────────────────────────────
  const gY = w2y(0);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(Math.max(0, fL), gY);
  ctx.lineTo(Math.min(CW, fR), gY);
  ctx.stroke();

  // ── Goalposts ─────────────────────────────────────────────────────────────
  for (const m of result.missed) {
    if (m.marker?.shape !== 'rect') continue;
    const px  = w2x(m.dist, camL);
    const tY  = w2y(m.marker.worldHeight);
    ctx.fillStyle   = '#ffffff';
    ctx.globalAlpha = 0.7;
    ctx.fillRect(px - 4, tY, 8, gY - tY);
    ctx.globalAlpha = 1;
  }

  // ── Players (sprites) ────────────────────────────────────────────────────
  for (const m of result.missed) {
    if (m.marker?.shape !== 'capsule') continue;

    const isA = m.marker.color === '#e05858';
    const img = isA ? advImg.playerA : advImg.playerB;
    if (!img) continue;

    const bH  = m.marker.baseHeight   ?? 0;
    const wH  = m.marker.worldHeight  ?? 1350;
    const tY  = w2y(bH + wH);
    const bY  = w2y(bH);
    const sH  = bY - tY;
    const sW  = sH * (img.naturalWidth / img.naturalHeight);
    const px  = w2x(m.dist, camL);

    const side = m.marker.side;
    const drawX = side === 'left' ? px - sW : side === 'right' ? px : px - sW / 2;
    ctx.drawImage(img, drawX, tY, sW, sH);
  }

  // ── Bonuses (with fade-in during playback) ────────────────────────────────
  const tagAlpha = drawAll ? 1 : Math.min(1, (roundElapsed ?? Infinity) / 1.0);
  if (tagAlpha > 0.001) {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = tagAlpha;

    for (const m of result.missed) {
      if (m.marker || !m.label) continue;
      drawTag(ctx, w2x(m.dist, camL), w2y(m.alt), m.label, m.isRocket, false);
    }

    for (const c of result.collected) {
      const hit = drawAll || (c.frame != null ? c.frame <= lastIdx : false);
      const recentHit = hit && !drawAll && c.frame != null
        && (lastIdx - c.frame) < HIGHLIGHT_DURATION;
      drawTag(ctx, w2x(c.dist, camL), w2y(c.alt), c.label, c.isRocket, recentHit);
    }

    ctx.globalAlpha = prevAlpha;
  }

  // ── Ball (with motion trail at high speeds) ────────────────────────────────
  const bpx = w2x(bwx, camL);
  const bpy = w2y(bwy);
  const br  = 520 / ADV_SCALE / 2;

  const TRAIL_COUNT = 6;
  const TRAIL_MIN_SPEED = 30;
  if (!drawAll && lastIdx >= 1) {
    const prev = result.path[Math.max(0, lastIdx - 1)];
    const dx = bwx - prev.dist;
    const dy = (result.path[lastIdx]?.alt ?? 0) - prev.alt;
    const speed = Math.sqrt(dx * dx + dy * dy);

    if (speed > TRAIL_MIN_SPEED) {
      const lookback = Math.min(lastIdx, TRAIL_COUNT);
      for (let t = lookback; t >= 1; t--) {
        const tp = result.path[lastIdx - t];
        const tx = w2x(tp.dist, camL);
        const ty = w2y(tp.alt);
        const alpha = (1 - t / (lookback + 1)) * 0.4;
        const scale = (1 - t / (lookback + 1)) * 0.7 + 0.3;
        const r = br * scale;
        ctx.globalAlpha = alpha;
        if (advImg.ball) {
          ctx.drawImage(advImg.ball, tx - r, ty - r, r * 2, r * 2);
        } else {
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  if (advImg.ball) {
    ctx.drawImage(advImg.ball, bpx - br, bpy - br, br * 2, br * 2);
  } else {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bpx, bpy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Score panel (fixed to viewport top-center) ─────────────────────────────
  const mult = result.path[lastIdx]?.mult ?? 1;
  if (advImg.scorePanel) {
    const panelW = 200;
    const panelH = panelW * (advImg.scorePanel.naturalHeight / advImg.scorePanel.naturalWidth);
    const panelX = (CW - panelW) / 2;
    const panelY = -2;
    ctx.drawImage(advImg.scorePanel, panelX, panelY, panelW, panelH);

    const textY = panelY + panelH * 0.62;
    ctx.font      = 'bold 20px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const atEnd = drawAll || lastIdx >= result.path.length - 1;
    ctx.fillStyle = atEnd ? (result.landed ? '#5cdb6a' : '#e05858') : '#ffffff';
    ctx.fillText('x' + mult.toFixed(2), CW / 2, textY);
    ctx.textBaseline = 'alphabetic';
  }

  // ── End marker ────────────────────────────────────────────────────────────
  const atEnd2 = drawAll || lastIdx >= result.path.length - 1;
  if (atEnd2) {
    const lastP = result.path[result.path.length - 1];
    const lx = w2x(lastP.dist, camL);
    const ly = w2y(lastP.alt);
    if (result.landed) {
      ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u26BD', lx, ly - 20);
    } else {
      ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4A5}', lx, ly - 10);
    }
  }
}
