import { render, computeBounds } from './shared/renderer.js';
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

[scanFrom, scanTo, fMinHits, fMaxHits, fMinMult, fMaxMult, fMinDist, fMaxDist, fMinTicks, fMaxTicks, fMinHpt, fMaxHpt].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') runScan(); });
});

// ─── Init ───────────────────────────────────────────────────────────────────
setActiveGame(listGames()[0].id);
runSingle();
