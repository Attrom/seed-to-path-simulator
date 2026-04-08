const PAD = { top: 30, right: 30, bottom: 40, left: 55 };
const MIN_CANVAS_H = 250;

function niceStep(range, targetSteps) {
  const raw = range / targetSteps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

export function computeBounds(result) {
  let maxDist = 0, maxAlt = 0;
  for (const p of result.path)      { maxDist = Math.max(maxDist, p.dist); maxAlt = Math.max(maxAlt, p.alt); }
  for (const c of result.collected) { maxDist = Math.max(maxDist, c.dist); maxAlt = Math.max(maxAlt, c.alt + 200); }
  for (const m of result.missed)    { maxDist = Math.max(maxDist, m.dist); maxAlt = Math.max(maxAlt, m.alt + 200); }
  maxDist *= 1.05;
  maxAlt = Math.max(maxAlt * 1.1, 500);
  return { maxDist, maxAlt };
}

export function render(result, canvas, { frame = -1, bounds = null } = {}) {
  if (!bounds) bounds = computeBounds(result);
  const { maxDist, maxAlt } = bounds;

  const CANVAS_W = canvas.parentElement?.clientWidth || 960;
  const plotW = CANVAS_W - PAD.left - PAD.right;
  const scale = plotW / maxDist;
  const plotH = Math.max(maxAlt * scale, MIN_CANVAS_H - PAD.top - PAD.bottom);
  const CANVAS_H = Math.round(plotH + PAD.top + PAD.bottom);

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const drawAll = frame < 0;
  const lastIdx = drawAll ? result.path.length - 1 : Math.min(frame, result.path.length - 1);
  const curDist = result.path[lastIdx]?.dist ?? 0;

  const sx = d => PAD.left + (d / maxDist) * plotW;
  const sy = a => PAD.top + plotH - (a / maxAlt) * plotH;

  // ── background ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  bgGrad.addColorStop(0, '#0a0f22');
  bgGrad.addColorStop(0.7, '#111830');
  bgGrad.addColorStop(1, '#1a2845');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ── ground ──
  const groundY = sy(0);
  ctx.fillStyle = '#1a2540';
  ctx.fillRect(PAD.left, groundY, plotW, CANVAS_H - groundY);
  ctx.strokeStyle = '#2a4070'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD.left, groundY); ctx.lineTo(CANVAS_W - PAD.right, groundY); ctx.stroke();

  // ── grid ──
  ctx.strokeStyle = '#1a2040'; ctx.lineWidth = 0.5;
  const altStep = niceStep(maxAlt, 5);
  for (let a = altStep; a < maxAlt; a += altStep) {
    ctx.beginPath(); ctx.moveTo(PAD.left, sy(a)); ctx.lineTo(CANVAS_W - PAD.right, sy(a)); ctx.stroke();
  }
  const distStep = niceStep(maxDist, 6);
  for (let d = distStep; d < maxDist; d += distStep) {
    ctx.beginPath(); ctx.moveTo(sx(d), PAD.top); ctx.lineTo(sx(d), groundY); ctx.stroke();
  }

  // ── axis labels ──
  ctx.fillStyle = '#4a5580'; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'right';
  for (let a = 0; a <= maxAlt; a += altStep) {
    ctx.fillText(Math.round(a / 100).toString(), PAD.left - 6, sy(a) + 3);
  }
  ctx.textAlign = 'center';
  for (let d = 0; d <= maxDist; d += distStep) {
    ctx.fillText(Math.round(d / 100).toString(), sx(d), groundY + 16);
  }
  ctx.fillStyle = '#4a5580'; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'center';
  ctx.fillText('distance (\u00d7100)', PAD.left + plotW / 2, CANVAS_H - 6);
  ctx.save();
  ctx.translate(12, PAD.top + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('altitude (\u00d7100)', 0, 0);
  ctx.restore();

  // ── flight path (up to lastIdx) ──
  ctx.lineWidth = 2; ctx.lineJoin = 'round';
  if (lastIdx >= 1) {
    for (let i = 1; i <= lastIdx; i++) {
      const p0 = result.path[i - 1], p1 = result.path[i];
      const m = p1.mult;
      ctx.strokeStyle = m >= 10 ? '#ff6a4a' : m >= 3 ? '#f0b020' : m >= 1.5 ? '#60d870' : '#4090e0';
      ctx.beginPath(); ctx.moveTo(sx(p0.dist), sy(p0.alt)); ctx.lineTo(sx(p1.dist), sy(p1.alt)); ctx.stroke();
    }
  }

  // ── default marker for bonuses / field objects ──
  // Items may carry an optional `marker` object to override styling:
  //   marker.color    – fill color
  //   marker.outline  – stroke color around the circle
  //   marker.opacity  – override alpha (default 0.25)
  //   marker.shape    – 'rect' draws a vertical rectangle instead of a circle
  //   marker.height   – rectangle height in pixels (default 30)
  const drawDefaultDisc = (item) => {
    const x = sx(item.dist), y = sy(item.alt);
    const mk = item.marker;

    if (mk?.shape === 'rect') {
      const h = mk.height ?? 30;
      ctx.globalAlpha = mk.opacity ?? 0.7;
      ctx.fillStyle = mk.color ?? '#fff';
      ctx.fillRect(x - 2, y - h, 4, h);
      ctx.globalAlpha = 1;
      return;
    }

    const isHarm = item.isRocket || item.label === 'x0.5';
    ctx.globalAlpha = mk?.opacity ?? 0.25;
    ctx.fillStyle = mk?.color ?? (isHarm ? '#e05858' : '#6080a0');
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();

    if (mk?.outline) {
      ctx.strokeStyle = mk.outline;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.fillStyle = '#8090b0'; ctx.font = 'bold 9px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText(item.label, x, y - 12);
    ctx.globalAlpha = 1;
  };

  for (const m of result.missed) drawDefaultDisc(m);

  for (const c of result.collected) {
    const reached = drawAll || c.dist <= curDist;
    if (!reached) {
      drawDefaultDisc(c);
      continue;
    }

    const x = sx(c.dist), y = sy(c.alt);
    const isHarm = c.isRocket || c.label === 'x0.5';

    ctx.shadowColor = isHarm ? '#ff4040' : '#40ff80';
    ctx.shadowBlur = 10;
    ctx.fillStyle = isHarm ? '#c03030' : c.label.startsWith('x') ? '#d0a020' : '#30a050';
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText(c.label, x, y - 15);

    ctx.fillStyle = isHarm ? '#ff8080' : '#a0ffa0';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText(c.multAfter.toFixed(1) + '\u00d7', x, y + 22);
  }

  // ── end marker (only when showing final frame) ──
  const atEnd = drawAll || lastIdx >= result.path.length - 1;
  if (atEnd) {
    if (result.landed) {
      const lx = sx(result.path[result.path.length - 1].dist);
      ctx.fillStyle = '#5cdb6a'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F6A2}', lx, groundY + 30);
    } else {
      const last = result.path[result.path.length - 1];
      const lx = sx(last.dist), ly = sy(last.alt);
      ctx.fillStyle = '#e05858'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4A5}', lx, ly - 5);
    }
  }

  // ── plane marker ──
  const cur = result.path[lastIdx];
  if (cur) {
    const px = sx(cur.dist), py = sy(cur.alt);

    if (!atEnd) {
      ctx.shadowColor = '#4090e0';
      ctx.shadowBlur = 14;
    }

    ctx.fillStyle = '#4090e0';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u{2708}', px + 2, py - 8);
    ctx.shadowBlur = 0;

    if (!atEnd) {
      const mult = cur.mult;
      const tag = mult.toFixed(1) + '\u00d7';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.fillStyle = mult >= 10 ? '#ff6a4a' : mult >= 3 ? '#f0b020' : mult >= 1.5 ? '#60d870' : '#4090e0';
      ctx.fillText(tag, px + 2, py - 22);
    }
  }
}
