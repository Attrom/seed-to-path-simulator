import { render, computeBounds } from './shared/renderer.js';
import { loadAdvancedAssets, renderAdvanced } from './shared/advancedRenderer.js';
import { scanSeedsAsync }       from './shared/scanner.js';
import { updateInfoBar, updateEventsStrip, updateLegend, renderResultsTable } from './shared/ui.js';
import { listGames, getGame }   from './games/registry.js';

// ─── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const pageTitle    = $('page-title');
const seedInput    = $('seed-input');
const btnRun       = $('btn-run');
const btnRandom    = $('btn-random');
const canvas       = $('canvas');
const infoBar      = $('info-bar');
const eventsStrip  = $('events-strip');
const legend       = $('legend');

const btnPlay      = $('btn-play');
const btnReset     = $('btn-reset');
const speedSelect  = $('speed-select');
const scrubber     = $('scrubber');
const frameCounter = $('frame-counter');

const tabBtns      = document.querySelectorAll('.tab-btn');
const tabPanels    = document.querySelectorAll('.tab-panel');

const scanFrom     = $('scan-from');
const scanTo       = $('scan-to');
const fOutcome     = $('f-outcome');
const fMinHits     = $('f-min-hits');
const fMaxHits     = $('f-max-hits');
const fMinMult     = $('f-min-mult');
const fMaxMult     = $('f-max-mult');
const fMinDist     = $('f-min-dist');
const fMaxDist     = $('f-max-dist');
const fMinTicks    = $('f-min-ticks');
const fMaxTicks    = $('f-max-ticks');
const fMinHpt      = $('f-min-hpt');
const fMaxHpt      = $('f-max-hpt');
const fMinBonuses     = $('f-min-bonuses');
const fMaxBonuses     = $('f-max-bonuses');
const fMinPosBonuses  = $('f-min-pos-bonuses');
const fMaxPosBonuses  = $('f-max-pos-bonuses');
const fMinNegBonuses  = $('f-min-neg-bonuses');
const fMaxNegBonuses  = $('f-max-neg-bonuses');
const fMinScorerShots = $('f-min-scorer-shots');
const fMaxScorerShots = $('f-max-scorer-shots');
const fMinShots    = $('f-min-shots');
const fMaxShots    = $('f-max-shots');
const btnScan      = $('btn-scan');
const btnStopScan  = $('btn-stop-scan');
const scanStatus   = $('scan-status');
const tableWrap    = $('results-table-wrap');

// ─── Active game ────────────────────────────────────────────────────────────
let activeGame = null;

function setActiveGame(id) {
  activeGame = getGame(id);
  pageTitle.textContent = `${activeGame.gameInfo.name} \u2014 Seed Simulator`;
  document.title = pageTitle.textContent;
}

// ─── Tab switching ──────────────────────────────────────────────────────────
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ─── Animation state ────────────────────────────────────────────────────────
let currentResult = null;
let currentBounds = null;
let animFrame     = -1;
let playing       = false;
let rafId         = null;
let accumulator   = 0;

function totalFrames() {
  return currentResult ? currentResult.path.length : 0;
}

function getSpeed() {
  return parseFloat(speedSelect.value) || 1;
}

function syncScrubber() {
  const total = totalFrames();
  scrubber.max = Math.max(0, total - 1);
  scrubber.value = animFrame < 0 ? total - 1 : animFrame;
  frameCounter.textContent = `${animFrame < 0 ? total : animFrame + 1} / ${total}`;
}

function drawCurrentFrame() {
  if (!currentResult) return;
  render(currentResult, canvas, { frame: animFrame, bounds: currentBounds });
}

function stopPlayback() {
  playing = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  btnPlay.textContent = '\u25b6';
  btnPlay.classList.remove('playing');
}

function startPlayback() {
  if (!currentResult || totalFrames() === 0) return;
  if (animFrame < 0 || animFrame >= totalFrames() - 1) {
    animFrame = 0;
    accumulator = 0;
  }
  playing = true;
  btnPlay.textContent = '\u23f8';
  btnPlay.classList.add('playing');
  lastTimestamp = null;
  rafId = requestAnimationFrame(animationLoop);
}

let lastTimestamp = null;

function animationLoop(timestamp) {
  if (!playing) return;

  if (lastTimestamp === null) lastTimestamp = timestamp;
  const dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  const ticksPerSec = 60 * getSpeed();
  accumulator += dt * ticksPerSec;

  const steps = Math.floor(accumulator);
  if (steps > 0) {
    accumulator -= steps;
    animFrame = Math.min(animFrame + steps, totalFrames() - 1);
  }

  drawCurrentFrame();
  syncScrubber();

  if (animFrame >= totalFrames() - 1) {
    animFrame = -1;
    drawCurrentFrame();
    syncScrubber();
    updateInfoBar(currentResult, infoBar);
    updateEventsStrip(currentResult, eventsStrip);
    stopPlayback();
    return;
  }

  rafId = requestAnimationFrame(animationLoop);
}

// ─── Single-seed visualizer ─────────────────────────────────────────────────
function runSingle(seedOverride) {
  stopPlayback();

  let seed;
  if (seedOverride !== undefined) {
    seed = seedOverride;
    seedInput.value = seed;
  } else {
    const raw = seedInput.value.trim();
    seed = raw === '' ? Math.floor(Math.random() * 4294967296) : parseInt(raw, 10);
    if (isNaN(seed)) seed = Math.floor(Math.random() * 4294967296);
    seedInput.value = seed;
  }

  currentResult = activeGame.simulate(seed);
  currentBounds = computeBounds(currentResult);
  animFrame = -1;

  drawCurrentFrame();
  syncScrubber();
  updateInfoBar(currentResult, infoBar);
  updateEventsStrip(currentResult, eventsStrip);
  updateLegend(legend);
}

btnRun.addEventListener('click', () => runSingle());
btnRandom.addEventListener('click', () => { seedInput.value = ''; runSingle(); });
seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSingle(); });

// ─── Playback controls ─────────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (playing) stopPlayback();
  else startPlayback();
});

btnReset.addEventListener('click', () => {
  stopPlayback();
  if (!currentResult) return;
  animFrame = 0;
  accumulator = 0;
  drawCurrentFrame();
  syncScrubber();
});

scrubber.addEventListener('input', () => {
  stopPlayback();
  const v = parseInt(scrubber.value, 10);
  animFrame = v >= totalFrames() - 1 ? -1 : v;
  drawCurrentFrame();
  syncScrubber();
});

// ─── Scanner ────────────────────────────────────────────────────────────────
let scanAbort = null;

function buildFilters() {
  const f = {};
  const v = el => { const n = parseFloat(el.value); return isNaN(n) ? null : n; };
  f.minHits       = v(fMinHits);
  f.maxHits       = v(fMaxHits);
  f.minMultiplier = v(fMinMult);
  f.maxMultiplier = v(fMaxMult);
  f.minDistance   = v(fMinDist);
  f.maxDistance   = v(fMaxDist);
  f.minTicks      = v(fMinTicks);
  f.maxTicks      = v(fMaxTicks);
  f.minHpt        = v(fMinHpt);
  f.maxHpt        = v(fMaxHpt);
  f.minBonuses     = v(fMinBonuses);
  f.maxBonuses     = v(fMaxBonuses);
  f.minPosBonuses  = v(fMinPosBonuses);
  f.maxPosBonuses  = v(fMaxPosBonuses);
  f.minNegBonuses  = v(fMinNegBonuses);
  f.maxNegBonuses  = v(fMaxNegBonuses);
  f.minScorerShots = v(fMinScorerShots);
  f.maxScorerShots = v(fMaxScorerShots);
  f.minShots      = v(fMinShots);
  f.maxShots      = v(fMaxShots);
  const oc = fOutcome.value;
  if (oc !== 'any') f.outcome = oc;
  return f;
}

async function runScan() {
  if (scanAbort) scanAbort.abort();
  scanAbort = new AbortController();

  const from = parseInt(scanFrom.value, 10) || 0;
  const to   = parseInt(scanTo.value, 10)   || 1000;
  const filters = buildFilters();
  const total = to - from;

  btnScan.disabled = true;
  btnStopScan.hidden = false;
  scanStatus.textContent = `Scanning 0 / ${total} ...`;
  tableWrap.innerHTML = '';

  const results = await scanSeedsAsync(activeGame.simulateSummary, from, to, filters, (done, tot) => {
    scanStatus.textContent = `Scanning ${done} / ${tot} ...`;
  }, scanAbort.signal);

  btnScan.disabled = false;
  btnStopScan.hidden = true;

  if (scanAbort.signal.aborted) {
    scanStatus.textContent = `Scan aborted. Found ${results.length} matching seeds so far.`;
  } else {
    scanStatus.textContent = `Done. ${results.length} seed${results.length !== 1 ? 's' : ''} matched out of ${total} scanned.`;
  }

  const table = renderResultsTable(results, tableWrap);
  if (table) {
    table.addEventListener('click', e => {
      const row = e.target.closest('tr[data-seed]');
      if (!row) return;
      const seed = parseInt(row.dataset.seed, 10);
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="tab-visualizer"]').classList.add('active');
      $('tab-visualizer').classList.add('active');
      runSingle(seed);
    });
  }

  scanAbort = null;
}

btnScan.addEventListener('click', runScan);
btnStopScan.addEventListener('click', () => { if (scanAbort) scanAbort.abort(); });

[scanFrom, scanTo, fMinHits, fMaxHits, fMinMult, fMaxMult, fMinDist, fMaxDist, fMinTicks, fMaxTicks, fMinHpt, fMaxHpt, fMinBonuses, fMaxBonuses, fMinPosBonuses, fMaxPosBonuses, fMinNegBonuses, fMaxNegBonuses, fMinScorerShots, fMaxScorerShots, fMinShots, fMaxShots].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') runScan(); });
});

// ─── Advanced Visualizer ─────────────────────────────────────────────────────
const advSeedInput    = $('adv-seed-input');
const advBtnRun       = $('adv-btn-run');
const advBtnPlay      = $('adv-btn-play');
const advSpeedSelect  = $('adv-speed-select');
const advScrubber     = $('adv-scrubber');
const advFrameCounter = $('adv-frame-counter');
const advCanvas       = $('adv-canvas');

let advResult  = null;
let advFrame   = -1;
let advPlaying = false;
let advRafId   = null;
let advAccum   = 0;
let advLastTs  = null;

function advTotal() { return advResult ? advResult.path.length : 0; }
function advSpeed() { return parseFloat(advSpeedSelect.value) || 1; }

function advSync() {
  const t = advTotal();
  advScrubber.max   = Math.max(0, t - 1);
  advScrubber.value = advFrame < 0 ? t - 1 : advFrame;
  advFrameCounter.textContent = `${advFrame < 0 ? t : advFrame + 1} / ${t}`;
}

function advDraw() {
  if (!advResult) return;
  renderAdvanced(advResult, advCanvas, advFrame);
}

function advStop() {
  advPlaying = false;
  if (advRafId) { cancelAnimationFrame(advRafId); advRafId = null; }
  advBtnPlay.textContent = '\u25b6';
  advBtnPlay.classList.remove('playing');
}

function advStart() {
  if (!advResult || advTotal() === 0) return;
  if (advFrame < 0 || advFrame >= advTotal() - 1) {
    advFrame = 0;
    advAccum = 0;
  }
  advPlaying = true;
  advBtnPlay.textContent = '\u23f8';
  advBtnPlay.classList.add('playing');
  advLastTs = null;
  advRafId  = requestAnimationFrame(advLoop);
}

function advLoop(ts) {
  if (!advPlaying) return;
  if (advLastTs === null) advLastTs = ts;
  const dt = (ts - advLastTs) / 1000;
  advLastTs = ts;

  let slowFactor = 1;
  if (advResult.lastShotGoalX != null && advFrame >= 0) {
    const ballX = advResult.path[Math.min(advFrame, advResult.path.length - 1)]?.dist ?? 0;
    const viewW = (advCanvas.parentElement?.clientWidth || window.innerWidth) * 10;
    const distToGoal = Math.abs(advResult.lastShotGoalX - ballX);
    if (distToGoal <= viewW && advFrame >= advResult.lastShotStartFrame) {
      slowFactor = 0.35;
    }
  }
  advAccum += dt * 60 * advSpeed() * slowFactor;
  const steps = Math.floor(advAccum);
  if (steps > 0) {
    advAccum -= steps;
    advFrame = Math.min(advFrame + steps, advTotal() - 1);
  }

  advDraw();
  advSync();

  if (advFrame >= advTotal() - 1) {
    advFrame = -1;
    advDraw();
    advSync();
    advStop();
    return;
  }
  advRafId = requestAnimationFrame(advLoop);
}

function advRun(seedOverride) {
  advStop();
  let seed;
  if (seedOverride !== undefined) {
    seed = seedOverride;
    advSeedInput.value = seed;
  } else {
    const raw = advSeedInput.value.trim();
    seed = raw === '' ? Math.floor(Math.random() * 4294967296) : parseInt(raw, 10);
    if (isNaN(seed)) seed = Math.floor(Math.random() * 4294967296);
    advSeedInput.value = seed;
  }
  advResult = activeGame.simulate(seed);

  // On goal outcomes, extend the path past the goalpost until the ball hits the ground
  const lastEv = advResult.events[advResult.events.length - 1];
  if (lastEv && lastEv.label === 'goal' && advResult.path.length >= 2) {
    const p = advResult.path;
    const n = p.length - 1;
    const vx = p[n].dist - p[n - 1].dist;
    let vy = (p[n].alt - p[n - 1].alt) - 1;
    let ballX = p[n].dist;
    let ballY = p[n].alt;
    const mult = p[n].mult;
    while (ballY > 0) {
      ballX += vx;
      ballY += vy;
      vy -= 1;
      p.push({ dist: ballX, alt: Math.max(0, ballY), mult });
    }
  }

  advFrame  = 0;
  advAccum  = 0;
  advDraw();
  advSync();
  advStart();
}

advBtnRun.addEventListener('click', () => advRun());
advSeedInput.addEventListener('keydown', e => { if (e.key === 'Enter') advRun(); });

advBtnPlay.addEventListener('click', () => {
  if (advPlaying) advStop();
  else advStart();
});

advScrubber.addEventListener('input', () => {
  advStop();
  const v = parseInt(advScrubber.value, 10);
  advFrame = v >= advTotal() - 1 ? -1 : v;
  advDraw();
  advSync();
});

window.addEventListener('resize', () => {
  if (advResult && document.getElementById('tab-advanced')?.classList.contains('active')) {
    advDraw();
  }
});

loadAdvancedAssets();

// ─── Init ───────────────────────────────────────────────────────────────────
setActiveGame(listGames()[0].id);
runSingle();
