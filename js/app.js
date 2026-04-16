import { render, computeBounds } from './shared/renderer.js';
import { loadAdvancedAssets, renderAdvanced } from './shared/advancedRenderer.js';
import { scanSeedsAsync }       from './shared/scanner.js';
import { updateInfoBar, updateEventsStrip, updateLegend, renderResultsTable, renderCuratedTable } from './shared/ui.js';
import { getCuratedWorkerCode } from './shared/curatedWorkerCode.js';
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
const fStartTeam   = $('f-start-team');
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
const fMinPosBonuses  = $('f-min-pos-bonuses');
const fMaxPosBonuses  = $('f-max-pos-bonuses');
const fMinNegBonuses  = $('f-min-neg-bonuses');
const fMaxNegBonuses  = $('f-max-neg-bonuses');
const fMinTotalShots  = $('f-min-total-shots');
const fMaxTotalShots  = $('f-max-total-shots');
const fMinShotsA   = $('f-min-shots-a');
const fMaxShotsA   = $('f-max-shots-a');
const fMinShotsB   = $('f-min-shots-b');
const fMaxShotsB   = $('f-max-shots-b');
const fMinDirChanges = $('f-min-dir-changes');
const fMaxDirChanges = $('f-max-dir-changes');
const fMinShots    = $('f-min-shots');
const fMaxShots    = $('f-max-shots');
const btnScan      = $('btn-scan');
const btnStopScan  = $('btn-stop-scan');
const scanStatus   = $('scan-status');
const tableWrap    = $('results-table-wrap');

const presetSelect    = $('preset-select');
const btnPresetLoad   = $('btn-preset-load');
const btnPresetSave   = $('btn-preset-save');
const btnPresetDelete = $('btn-preset-delete');

const btnBuildCurated  = $('btn-build-curated');
const btnStopCurated   = $('btn-stop-curated');
const btnExportCurated = $('btn-export-curated');
const btnImportCurated = $('btn-import-curated');
const curatedStatus    = $('curated-status');
const curatedWarnings  = $('curated-warnings');
const curatedTableWrap = $('curated-table-wrap');

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

const btnCuratedRandom = $('btn-curated-random');

function pickCuratedSeed() {
  if (!curatedResults || curatedResults.length === 0) {
    alert('No curated list available. Build one in the Curated List tab first.');
    return null;
  }
  return curatedResults[Math.floor(Math.random() * curatedResults.length)].seed;
}

btnRun.addEventListener('click', () => runSingle());
btnRandom.addEventListener('click', () => { seedInput.value = ''; runSingle(); });
btnCuratedRandom.addEventListener('click', () => {
  const seed = pickCuratedSeed();
  if (seed != null) runSingle(seed);
});
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
  f.minPosBonuses  = v(fMinPosBonuses);
  f.maxPosBonuses  = v(fMaxPosBonuses);
  f.minNegBonuses  = v(fMinNegBonuses);
  f.maxNegBonuses  = v(fMaxNegBonuses);
  f.minTotalShots = v(fMinTotalShots);
  f.maxTotalShots = v(fMaxTotalShots);
  f.minShotsA     = v(fMinShotsA);
  f.maxShotsA     = v(fMaxShotsA);
  f.minShotsB     = v(fMinShotsB);
  f.maxShotsB     = v(fMaxShotsB);
  f.minDirChanges = v(fMinDirChanges);
  f.maxDirChanges = v(fMaxDirChanges);
  f.minShots      = v(fMinShots);
  f.maxShots      = v(fMaxShots);
  const oc = fOutcome.value;
  if (oc !== 'any') f.outcome = oc;
  const st = fStartTeam.value;
  if (st !== 'any') f.startTeam = st;
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

[scanFrom, scanTo, fMinHits, fMaxHits, fMinMult, fMaxMult, fMinDist, fMaxDist, fMinTicks, fMaxTicks, fMinHpt, fMaxHpt, fMinPosBonuses, fMaxPosBonuses, fMinNegBonuses, fMaxNegBonuses, fMinTotalShots, fMaxTotalShots, fMinShotsA, fMaxShotsA, fMinShotsB, fMaxShotsB, fMinDirChanges, fMaxDirChanges, fMinShots, fMaxShots].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') runScan(); });
});

// ─── Filter Presets ──────────────────────────────────────────────────────────
const PRESETS_KEY = 'seedSim_filterPresets';

const filterFields = [
  { key: 'scanFrom',       el: scanFrom },
  { key: 'scanTo',         el: scanTo },
  { key: 'outcome',        el: fOutcome },
  { key: 'startTeam',      el: fStartTeam },
  { key: 'minHits',        el: fMinHits },
  { key: 'maxHits',        el: fMaxHits },
  { key: 'minMult',        el: fMinMult },
  { key: 'maxMult',        el: fMaxMult },
  { key: 'minDist',        el: fMinDist },
  { key: 'maxDist',        el: fMaxDist },
  { key: 'minTicks',       el: fMinTicks },
  { key: 'maxTicks',       el: fMaxTicks },
  { key: 'minHpt',         el: fMinHpt },
  { key: 'maxHpt',         el: fMaxHpt },
  { key: 'minPosBonuses',  el: fMinPosBonuses },
  { key: 'maxPosBonuses',  el: fMaxPosBonuses },
  { key: 'minNegBonuses',  el: fMinNegBonuses },
  { key: 'maxNegBonuses',  el: fMaxNegBonuses },
  { key: 'minTotalShots',  el: fMinTotalShots },
  { key: 'maxTotalShots',  el: fMaxTotalShots },
  { key: 'minShotsA',      el: fMinShotsA },
  { key: 'maxShotsA',      el: fMaxShotsA },
  { key: 'minShotsB',      el: fMinShotsB },
  { key: 'maxShotsB',      el: fMaxShotsB },
  { key: 'minDirChanges',  el: fMinDirChanges },
  { key: 'maxDirChanges',  el: fMaxDirChanges },
  { key: 'minShots',       el: fMinShots },
  { key: 'maxShots',       el: fMaxShots },
];

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; }
  catch { return {}; }
}

function savePresets(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function refreshPresetSelect() {
  const presets = loadPresets();
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  presetSelect.innerHTML = '<option value="">\u2014 Saved Filters \u2014</option>';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    presetSelect.appendChild(opt);
  }
}

function captureFilterState() {
  const state = {};
  for (const { key, el } of filterFields) state[key] = el.value;
  return state;
}

function applyFilterState(state) {
  for (const { key, el } of filterFields) {
    if (key in state) el.value = state[key];
  }
}

btnPresetSave.addEventListener('click', () => {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;
  const presets = loadPresets();
  presets[name.trim()] = captureFilterState();
  savePresets(presets);
  refreshPresetSelect();
  presetSelect.value = name.trim();
});

btnPresetLoad.addEventListener('click', () => {
  const name = presetSelect.value;
  if (!name) return;
  const presets = loadPresets();
  if (presets[name]) applyFilterState(presets[name]);
});

btnPresetDelete.addEventListener('click', () => {
  const name = presetSelect.value;
  if (!name) return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  const presets = loadPresets();
  delete presets[name];
  savePresets(presets);
  refreshPresetSelect();
});

refreshPresetSelect();

// ─── Curated List Builder (parallel Web Workers) ─────────────────────────────
let curatedWorkers = [];
let curatedResults = null;
const curatedCache = new Map();

const CURATED_RESULTS_KEY = 'curatedResults';
const CURATED_CACHE_KEY   = 'curatedCache';

function saveCuratedToStorage() {
  try {
    if (curatedResults) {
      localStorage.setItem(CURATED_RESULTS_KEY, JSON.stringify(curatedResults));
    } else {
      localStorage.removeItem(CURATED_RESULTS_KEY);
    }
    const cacheObj = {};
    for (const [k, v] of curatedCache) cacheObj[k] = v;
    localStorage.setItem(CURATED_CACHE_KEY, JSON.stringify(cacheObj));
  } catch (_) { /* quota exceeded — best-effort */ }
}

function loadCuratedFromStorage() {
  try {
    const raw = localStorage.getItem(CURATED_RESULTS_KEY);
    if (raw) curatedResults = JSON.parse(raw);
    const cacheRaw = localStorage.getItem(CURATED_CACHE_KEY);
    if (cacheRaw) {
      const obj = JSON.parse(cacheRaw);
      for (const k of Object.keys(obj)) curatedCache.set(k, obj[k]);
    }
  } catch (_) { /* corrupt data — ignore */ }
}

const workerBlob = new Blob([getCuratedWorkerCode()], { type: 'application/javascript' });
const workerUrl  = URL.createObjectURL(workerBlob);

function buildFiltersFromState(state) {
  const f = {};
  const v = raw => { const n = parseFloat(raw); return isNaN(n) ? null : n; };

  f.minHits       = v(state.minHits);
  f.maxHits       = v(state.maxHits);
  f.minMultiplier = v(state.minMult);
  f.maxMultiplier = v(state.maxMult);
  f.minDistance   = v(state.minDist);
  f.maxDistance   = v(state.maxDist);
  f.minTicks      = v(state.minTicks);
  f.maxTicks      = v(state.maxTicks);
  f.minHpt        = v(state.minHpt);
  f.maxHpt        = v(state.maxHpt);
  f.minPosBonuses  = v(state.minPosBonuses);
  f.maxPosBonuses  = v(state.maxPosBonuses);
  f.minNegBonuses  = v(state.minNegBonuses);
  f.maxNegBonuses  = v(state.maxNegBonuses);
  f.minTotalShots = v(state.minTotalShots);
  f.maxTotalShots = v(state.maxTotalShots);
  f.minShotsA     = v(state.minShotsA);
  f.maxShotsA     = v(state.maxShotsA);
  f.minShotsB     = v(state.minShotsB);
  f.maxShotsB     = v(state.maxShotsB);
  f.minDirChanges = v(state.minDirChanges);
  f.maxDirChanges = v(state.maxDirChanges);
  f.minShots      = v(state.minShots);
  f.maxShots      = v(state.maxShots);

  const oc = state.outcome;
  if (oc && oc !== 'any') f.outcome = oc;
  const st = state.startTeam;
  if (st && st !== 'any') f.startTeam = st;

  return f;
}

function stopCuratedWorkers() {
  for (const w of curatedWorkers) w.terminate();
  curatedWorkers = [];
}

function finalizeCuratedList(allResults, names) {
  const LIMIT = 50;
  const seedMap = new Map();
  const warnings = [];

  for (const { name, results } of allResults) {
    curatedCache.set(name, results);
    if (results.length < LIMIT) {
      warnings.push(`Preset "${name}" found only ${results.length} seed${results.length !== 1 ? 's' : ''} (target: ${LIMIT}).`);
    }
    for (const m of results) {
      if (seedMap.has(m.seed)) {
        seedMap.get(m.seed).filterNames.push(name);
      } else {
        seedMap.set(m.seed, {
          seed: m.seed,
          startTeam: m.startTeam,
          totalMultiplier: m.outcome === 'crash' ? 0 : m.totalMultiplier,
          filterNames: [name],
          weight: 1,
        });
      }
    }
  }

  const list = [...seedMap.values()].sort((a, b) => a.seed - b.seed);
  for (const entry of list) {
    entry.filterNames = entry.filterNames.join(', ');
  }

  curatedResults = list;

  btnBuildCurated.disabled = false;
  btnStopCurated.hidden = true;

  const scannedCount = allResults.filter(r => !r.cached).length;
  const cachedCount  = allResults.length - scannedCount;
  let statusParts = [`${list.length} unique seed${list.length !== 1 ? 's' : ''}`];
  if (scannedCount > 0) statusParts.push(`${scannedCount} scanned`);
  if (cachedCount > 0)  statusParts.push(`${cachedCount} from cache`);
  curatedStatus.textContent = `Done. ${statusParts.join(', ')}.`;

  if (warnings.length > 0) {
    curatedWarnings.innerHTML = warnings.map(w => `<div>${w}</div>`).join('');
  }

  const table = renderCuratedTable(list, curatedTableWrap);
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

  btnExportCurated.hidden = list.length === 0;
  btnImportCurated.hidden = false;

  saveCuratedToStorage();
}

async function buildCuratedList() {
  stopCuratedWorkers();

  const presets = loadPresets();
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    curatedStatus.textContent = 'No saved filter presets found. Save some presets in the Scanner tab first.';
    return;
  }

  const cachedNames = names.filter(n => curatedCache.has(n));
  let namesToScan = names;

  if (cachedNames.length > 0) {
    const msg = `${cachedNames.length} of ${names.length} preset(s) have cached results:\n` +
      cachedNames.map(n => `  • "${n}" (${curatedCache.get(n).length} seeds)`).join('\n') +
      '\n\nKeep cached results and only scan new presets?\n' +
      '  OK = keep cache     Cancel = discard & rescan all';
    if (confirm(msg)) {
      namesToScan = names.filter(n => !curatedCache.has(n));
    } else {
      curatedCache.clear();
    }
  }

  btnBuildCurated.disabled = true;
  btnStopCurated.hidden = false;
  btnExportCurated.hidden = true;
  curatedWarnings.innerHTML = '';
  curatedTableWrap.innerHTML = '';
  curatedResults = null;

  if (namesToScan.length === 0) {
    const allResults = names.map(name => ({ name, results: curatedCache.get(name), cached: true }));
    finalizeCuratedList(allResults, names);
    return;
  }

  const LIMIT = 50;
  const progress = {};
  let completed = 0;

  function updateStatus() {
    curatedStatus.textContent = `Scanning ${namesToScan.length} preset(s) in parallel \u2014 ${completed}/${namesToScan.length} done` +
      (cachedNames.length > 0 && curatedCache.size > 0 ? ` (${names.length - namesToScan.length} cached)` : '');
  }

  const workerPromises = namesToScan.map(name => new Promise(resolve => {
    const filters = buildFiltersFromState(presets[name]);
    const worker = new Worker(workerUrl);
    curatedWorkers.push(worker);

    progress[name] = { seed: 0, found: 0, done: false };

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        progress[name] = { seed: msg.seed, found: msg.found, done: false };
        updateStatus();
      } else if (msg.type === 'done') {
        progress[name] = { seed: 0, found: msg.results.length, done: true };
        completed++;
        updateStatus();
        resolve({ name, results: msg.results, cached: false });
      }
    };

    worker.onerror = () => {
      progress[name] = { seed: 0, found: 0, done: true };
      completed++;
      updateStatus();
      resolve({ name, results: [], cached: false });
    };

    worker.postMessage({ filters, limit: LIMIT });
  }));

  updateStatus();

  const scannedResults = await Promise.all(workerPromises);
  stopCuratedWorkers();

  const allResults = names.map(name => {
    const scanned = scannedResults.find(r => r.name === name);
    if (scanned) return scanned;
    return { name, results: curatedCache.get(name), cached: true };
  });

  finalizeCuratedList(allResults, names);
}

btnBuildCurated.addEventListener('click', buildCuratedList);
btnStopCurated.addEventListener('click', () => {
  stopCuratedWorkers();
  curatedStatus.textContent = 'Build aborted.';
  btnBuildCurated.disabled = false;
  btnStopCurated.hidden = true;
});

btnExportCurated.addEventListener('click', () => {
  if (!curatedResults || curatedResults.length === 0) return;
  const exportData = curatedResults.map(r => ({
    seed: r.seed,
    startTeam: r.startTeam,
    totalMultiplier: r.totalMultiplier,
    filters: r.filterNames.split(', '),
    weight: r.weight,
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'curated-seeds.json';
  a.click();
  URL.revokeObjectURL(url);
});

btnImportCurated.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('Expected an array');
        const list = data.map(r => ({
          seed: Number(r.seed),
          startTeam: String(r.startTeam ?? ''),
          totalMultiplier: Number(r.totalMultiplier ?? 0),
          filterNames: Array.isArray(r.filters) ? r.filters.join(', ') : String(r.filterNames ?? r.filters ?? ''),
          weight: Number(r.weight ?? 1),
        }));
        if (list.some(r => isNaN(r.seed))) throw new Error('Invalid seed value(s)');

        curatedResults = list;
        curatedCache.clear();
        saveCuratedToStorage();
        restoreCuratedUI();
        curatedStatus.textContent = `Imported ${list.length} seed${list.length !== 1 ? 's' : ''}.`;
        curatedWarnings.innerHTML = '';
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  });
  input.click();
});

function restoreCuratedUI() {
  if (!curatedResults || curatedResults.length === 0) return;
  btnExportCurated.hidden = false;
  btnImportCurated.hidden = false;
  curatedStatus.textContent = `Loaded ${curatedResults.length} seed${curatedResults.length !== 1 ? 's' : ''} from previous session.`;
  const table = renderCuratedTable(curatedResults, curatedTableWrap);
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
}

loadCuratedFromStorage();
restoreCuratedUI();

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
let advRoundTime = Infinity;

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
  renderAdvanced(advResult, advCanvas, advFrame, advRoundTime);
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
    advFrame     = 0;
    advAccum     = 0;
    advRoundTime = 0;
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

  advRoundTime += dt;

  let slowFactor = 1;
  if (advResult.lastShotGoalX != null && advFrame >= 0) {
    const ballX = advResult.path[Math.min(advFrame, advResult.path.length - 1)]?.dist ?? 0;
    const distToGoal = Math.abs(advResult.lastShotGoalX - ballX);
    if (distToGoal <= 1200 && advFrame >= advResult.lastShotStartFrame) {
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

  advFrame     = 0;
  advAccum     = 0;
  advRoundTime = 0;
  advDraw();
  advSync();
  advStart();
}

const advBtnCuratedRandom = $('adv-btn-curated-random');

advBtnRun.addEventListener('click', () => advRun());
advBtnCuratedRandom.addEventListener('click', () => {
  const seed = pickCuratedSeed();
  if (seed != null) advRun(seed);
});
advSeedInput.addEventListener('keydown', e => { if (e.key === 'Enter') advRun(); });

advBtnPlay.addEventListener('click', () => {
  if (advPlaying) advStop();
  else advStart();
});

advScrubber.addEventListener('input', () => {
  advStop();
  const v = parseInt(advScrubber.value, 10);
  advFrame = v >= advTotal() - 1 ? -1 : v;
  advRoundTime = Infinity;
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
