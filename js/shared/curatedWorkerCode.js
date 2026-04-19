/**
 * Self-contained worker code for curated list scanning.
 * Duplicates PRNG, simulateSummary, and passesFilters so the worker
 * runs without imports (Blob URL workers can't use ES modules).
 *
 * Keep in sync with: prng.js, simulation.js, scanner.js
 */
export function getCuratedWorkerCode() {
  return `'use strict';

// ── PRNG ──
class FlightRandom {
  constructor() { this.s0 = 0; this.s1 = 0; this.s2 = 0; }
  seed(v) {
    this.s0 = v;
    this.s1 = v * 213947 + 1238971;
    this.s2 = v * 7431 + 94823;
    this.random();
  }
  random(max = Number.MAX_SAFE_INTEGER) {
    let t = this.s0;
    const s = this.s1;
    this.s0 = s;
    t ^= t << 23;
    t ^= t >> 17;
    t ^= s;
    t ^= s >> 26;
    this.s1 = t;
    this.s2 = (1103515245 * this.s2 + 12345) % 2147483648;
    return (this.s0 + this.s1 + this.s2) % max;
  }
}

// ── Simulation constants ──
const FIELD_WIDTH = 27100;
const BONUS_NEGATIVE_PER_SIDE = 5;
const BONUS_POSITIVE_PER_SIDE = 12;
const BONUS_HIT_R2 = 150 * 150;
const MAX_MULT = 500;
const TICK_LIMIT = 20000;
const GOAL_POST_POSITION       = 12160;
const MAX_MULTIPLIER_HEIGHT    = 4100;
const MIN_MULTIPLIER_HEIGHT    = 2450;
const PLAYER_POINT_LOW_HEIGHT  = 790;
const PLAYER_POINT_HIGH_HEIGHT = 1950;
const TEAM_B_HEIGHT_OFFSET     = 60;
const CENTER_X = FIELD_WIDTH / 2;
const GOAL_A_X = CENTER_X - GOAL_POST_POSITION;
const GOAL_B_X = CENTER_X + GOAL_POST_POSITION;
const ARC_PEAK_MIN = 2500;
const ARC_PEAK_MAX = 5000;
const ARC_VX_LIMIT = 180;
const BALL_DRAG    = 0.01;
const DRAG_RETAIN  = 1 - BALL_DRAG;
const SPEED_MULT   = 1.1;
const DRAG_CUTOFF  = 0.35;
const GOAL_W_POW = 6;
const GOAL_W_SCALE = 96;
const W_PRECISION = 10000;
const LONG_SHOT_THRESHOLD = 7000;
const CLOSE_PAIRS = new Map([[2, 3], [3, 2], [8, 9], [9, 8]]);

const BONUS_POSITIVE_TYPES = [
  { add: 1, mult: 1 }, { add: 1, mult: 1 }, { add: 1, mult: 1 },
  { add: 2, mult: 1 }, { add: 2, mult: 1 },
  { add: 5, mult: 1 }, { add: 10, mult: 1 },
  { add: 0, mult: 2 }, { add: 0, mult: 3 },
];
const BONUS_NEGATIVE_TYPE = { add: 0, mult: 0.5 };
const BONUS_MIN_DIST_SQ = 500 * 500;
const BONUS_PLACE_TRIES = 50;

const PLAYER_LAYOUT = [
  { team: 'A', offset: -9830 }, { team: 'B', offset: -8230 },
  { team: 'A', offset: -5770 }, { team: 'B', offset: -5630 },
  { team: 'B', offset: -3490 }, { team: 'A', offset: -940 },
  { team: 'B', offset: 940 },   { team: 'A', offset: 3940 },
  { team: 'A', offset: 5630 },  { team: 'B', offset: 5770 },
  { team: 'A', offset: 8230 },  { team: 'B', offset: 9830 },
];

// ── Simulation helpers ──
function segDistSq(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function buildPlayers() {
  const center = FIELD_WIDTH / 2;
  return PLAYER_LAYOUT.map(({ team, offset }) => ({ x: Math.round(center + offset), team }));
}

function findCenterPlayer(players, team) {
  const center = FIELD_WIDTH / 2;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    if (players[i].team !== team) continue;
    const d = Math.abs(players[i].x - center);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function tooClose(placed, x, y) {
  for (let j = 0; j < placed.length; j++) {
    const dx = placed[j].x - x, dy = placed[j].y - y;
    if (dx * dx + dy * dy < BONUS_MIN_DIST_SQ) return true;
  }
  return false;
}

function placePair(rng, out, t, hRange, halfW) {
  let ox, y, lx, rx;
  for (let attempt = 0; attempt < BONUS_PLACE_TRIES; attempt++) {
    ox = rng.random(halfW - 1000) + 1000;
    y  = rng.random(hRange) + MIN_MULTIPLIER_HEIGHT;
    lx = GOAL_A_X + ox;
    rx = GOAL_B_X - ox;
    if (!tooClose(out, lx, y) && !tooClose(out, rx, y)) break;
  }
  out.push({ x: lx, y, add: t.add, mult: t.mult });
  out.push({ x: rx, y, add: t.add, mult: t.mult });
}

function generateBonusPositions(rng) {
  const hRange = MAX_MULTIPLIER_HEIGHT - MIN_MULTIPLIER_HEIGHT;
  const halfW  = (GOAL_B_X - GOAL_A_X) / 2;
  const out    = [];
  for (let i = 0; i < BONUS_NEGATIVE_PER_SIDE; i++) placePair(rng, out, BONUS_NEGATIVE_TYPE, hRange, halfW);
  for (let i = 0; i < BONUS_POSITIVE_PER_SIDE; i++) {
    const t = BONUS_POSITIVE_TYPES[rng.random(BONUS_POSITIVE_TYPES.length)];
    placePair(rng, out, t, hRange, halfW);
  }
  return out;
}

function chooseTarget(rng, kickerX, kickRight, players, kickerIdx, prevIdx) {
  const goalX = kickRight ? GOAL_B_X : GOAL_A_X;
  const blocked = CLOSE_PAIRS.get(kickerIdx);
  const candidates = [];
  for (let i = 0; i < players.length; i++) {
    if (i === blocked || i === prevIdx) continue;
    if (kickRight ? players[i].x > kickerX : players[i].x < kickerX)
      candidates.push({ type: 'player', index: i, x: players[i].x });
  }
  candidates.sort((a, b) => Math.abs(a.x - kickerX) - Math.abs(b.x - kickerX));
  const goalDist = GOAL_B_X - GOAL_A_X;
  const proximity = 1 - Math.abs(goalX - kickerX) / goalDist;
  const goalW = Math.max(0.1, Math.pow(proximity, GOAL_W_POW) * GOAL_W_SCALE);
  let totalW = goalW;
  const weights = [];
  for (let i = 0; i < candidates.length; i++) { const w = 1 / (i + 1); weights.push(w); totalW += w; }
  let roll = (rng.random(W_PRECISION) / W_PRECISION) * totalW;
  for (let i = 0; i < candidates.length; i++) { roll -= weights[i]; if (roll <= 0) return candidates[i]; }
  return { type: 'goal', x: goalX };
}

function vFromPeak(peak, fromY) {
  const rel = peak - fromY;
  return Math.max(1, Math.round((-1 + Math.sqrt(1 + 8 * rel)) / 2));
}

function minPeakForSpeed(fromX, fromY, targetX, targetY) {
  const absDx = Math.abs(targetX - fromX);
  if (absDx === 0) return 0;
  const dy = targetY - fromY;
  let Tmin = Math.ceil(absDx / ARC_VX_LIMIT);
  if (dy > 0 && Tmin * Tmin <= 2 * dy) Tmin = Math.ceil(Math.sqrt(2 * dy)) + 1;
  const V = Math.max(1, Math.ceil((Tmin + 2 * dy / Tmin - 1) / 2));
  return fromY + V * (V + 1) / 2;
}

function computeArc(fromX, fromY, targetX, targetY, V) {
  const dy = targetY - fromY;
  const d = 2 * V + 1;
  const disc = d * d - 8 * dy;
  const T = Math.max(1, Math.round((d + Math.sqrt(Math.max(0, disc))) / 2));
  const vx = (targetX - fromX) / T;
  return { vx, vy: V, T };
}

function buildTravelList(rng, players, startIdx) {
  const targets = [];
  let curX = players[startIdx].x;
  let curIdx = startIdx;
  const otherCenter = findCenterPlayer(players, players[startIdx].team === 'A' ? 'B' : 'A');
  let prevIdx = otherCenter;
  for (let i = 0; i < 200; i++) {
    const kickRight = players[curIdx].team === 'A';
    const target = chooseTarget(rng, curX, kickRight, players, curIdx, prevIdx);
    targets.push(target);
    if (target.type === 'goal') break;
    prevIdx = curIdx;
    curX = target.x;
    curIdx = target.index;
  }
  return targets;
}

function buildStops(players, startIdx, targets) {
  const stops = [{ type: 'player', index: startIdx, x: players[startIdx].x }, ...targets];
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].type === 'goal') {
      stops[i].y = PLAYER_POINT_LOW_HEIGHT;
    } else {
      const off = players[stops[i].index].team === 'B' ? TEAM_B_HEIGHT_OFFSET : 0;
      if (i === 0) { stops[i].y = PLAYER_POINT_LOW_HEIGHT + off; }
      else {
        const dx = Math.abs(stops[i + 1].x - stops[i].x);
        stops[i].y = (dx > LONG_SHOT_THRESHOLD ? PLAYER_POINT_LOW_HEIGHT : PLAYER_POINT_HIGH_HEIGHT) + off;
      }
    }
  }
  return stops;
}

// ── simulateSummary ──
function simulateSummary(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);
  const players   = buildPlayers();
  const startTeam = rng.random(2) === 0 ? 'A' : 'B';
  const startIdx  = findCenterPlayer(players, startTeam);
  const bonuses = generateBonusPositions(rng).map(b => ({ ...b, collected: false }));
  const targets  = buildTravelList(rng, players, startIdx);
  const isGoal   = rng.random(2) === 0;
  const stops    = buildStops(players, startIdx, targets);
  const lastStop = stops[stops.length - 1];
  const landed   = lastStop.x === GOAL_B_X ? isGoal : !isGoal;
  let ballX = stops[0].x, ballY = stops[0].y;
  let mult = 1, hits = 0, posHits = 0, negHits = 0, peakAlt = 0, totalDist = 0, ticks = 0;
  for (let s = 0; s < stops.length - 1 && ticks < TICK_LIMIT; s++) {
    const to = stops[s + 1];
    const dx = Math.abs(to.x - ballX);
    const sPeak = minPeakForSpeed(ballX, ballY, to.x, to.y);
    const pMin = Math.max(ARC_PEAK_MIN, Math.ceil(sPeak));
    const pMax = Math.max(pMin, Math.min(ARC_PEAK_MAX, 2500 + dx));
    const peak = pMin + rng.random(Math.max(1, pMax - pMin));
    const V = vFromPeak(peak, ballY);
    const { vx, T } = computeArc(ballX, ballY, to.x, to.y, V);
    const T_act = Math.max(1, Math.round(T / SPEED_MULT));
    const arcFromX = ballX, arcFromY = ballY;
    const rT = Math.pow(DRAG_RETAIN, T_act);
    const denom = 1 - rT;
    let hitPeak = false, peakProg = 0, peakTick = 0, linearRate = 0;
    for (let step = 0; step < T_act && ticks < TICK_LIMIT; step++) {
      const prevBX = ballX, prevBY = ballY;
      const t = step + 1;
      let p;
      if (!hitPeak) {
        p = denom < 1e-12 ? t / T_act : (1 - Math.pow(DRAG_RETAIN, t)) / denom;
        if (p >= DRAG_CUTOFF) { hitPeak = true; peakProg = p; peakTick = t; linearRate = T_act > t ? (1 - peakProg) / (T_act - t) : 0; }
      } else { p = peakProg + linearRate * (t - peakTick); }
      const s = p * T;
      ballX = arcFromX + s * vx;
      ballY = arcFromY + V * s - s * (s - 1) / 2;
      totalDist += Math.abs(ballX - prevBX); ticks++;
      if (ballY > peakAlt) peakAlt = ballY;
      for (const b of bonuses) {
        if (b.collected) continue;
        if (segDistSq(prevBX, prevBY, ballX, ballY, b.x, b.y) > BONUS_HIT_R2) continue;
        b.collected = true; hits++;
        if (b.mult < 1) negHits++; else posHits++;
        if (b.add) mult += b.add;
        if (b.mult !== 1) mult *= b.mult;
        mult = Math.min(MAX_MULT, Math.max(0, mult));
      }
    }
    ballX = to.x; ballY = to.y;
  }
  let totalShots = 0, shotsA = 0, shotsB = 0, dirChanges = 0, prevTeam = null;
  const sc = new Map();
  for (const s of stops) {
    if (s.type === 'player') {
      const team = players[s.index].team;
      totalShots++;
      if (team === 'A') shotsA++; else shotsB++;
      if (prevTeam !== null && team !== prevTeam) dirChanges++;
      prevTeam = team;
      sc.set(s.index, (sc.get(s.index) || 0) + 1);
    }
  }
  return {
    seed, startTeam,
    objectsHit: hits, finalMultiplier: mult,
    totalMultiplier: landed ? mult : 0,
    outcome: landed ? 'win' : 'crash',
    distance: totalDist, peakAltitude: peakAlt, ticks,
    hitsPerTick: ticks > 0 ? hits / ticks : 0,
    bonusesCollected: posHits + negHits,
    positiveBonuses: posHits, negativeBonuses: negHits,
    totalShots, shotsA, shotsB, dirChanges,
    shots: Math.max(0, ...sc.values()),
  };
}

// ── passesFilters ──
function passesFilters(s, filters) {
  if (filters.minHits       != null && s.objectsHit      < filters.minHits)       return false;
  if (filters.maxHits       != null && s.objectsHit      > filters.maxHits)       return false;
  if (filters.minMultiplier != null && s.finalMultiplier  < filters.minMultiplier) return false;
  if (filters.maxMultiplier != null && s.finalMultiplier  > filters.maxMultiplier) return false;
  if (filters.outcome && filters.outcome !== 'any' && s.outcome !== filters.outcome) return false;
  if (filters.minDistance   != null && s.distance         < filters.minDistance)    return false;
  if (filters.maxDistance   != null && s.distance         > filters.maxDistance)    return false;
  if (filters.minTicks      != null && s.ticks            < filters.minTicks)      return false;
  if (filters.maxTicks      != null && s.ticks            > filters.maxTicks)      return false;
  if (filters.minHpt        != null && s.hitsPerTick      < filters.minHpt)       return false;
  if (filters.maxHpt        != null && s.hitsPerTick      > filters.maxHpt)       return false;
  if (filters.minPosBonuses != null && s.positiveBonuses  < filters.minPosBonuses) return false;
  if (filters.maxPosBonuses != null && s.positiveBonuses  > filters.maxPosBonuses) return false;
  if (filters.minNegBonuses != null && s.negativeBonuses  < filters.minNegBonuses) return false;
  if (filters.maxNegBonuses != null && s.negativeBonuses  > filters.maxNegBonuses) return false;
  if (filters.minTotalShots != null && s.totalShots       < filters.minTotalShots) return false;
  if (filters.maxTotalShots != null && s.totalShots       > filters.maxTotalShots) return false;
  if (filters.minShotsA     != null && s.shotsA           < filters.minShotsA)    return false;
  if (filters.maxShotsA     != null && s.shotsA           > filters.maxShotsA)    return false;
  if (filters.minShotsB     != null && s.shotsB           < filters.minShotsB)    return false;
  if (filters.maxShotsB     != null && s.shotsB           > filters.maxShotsB)    return false;
  if (filters.minDirChanges != null && s.dirChanges       < filters.minDirChanges) return false;
  if (filters.maxDirChanges != null && s.dirChanges       > filters.maxDirChanges) return false;
  if (filters.minShots      != null && s.shots            < filters.minShots)     return false;
  if (filters.maxShots      != null && s.shots            > filters.maxShots)     return false;
  if (filters.startTeam && s.startTeam !== filters.startTeam) return false;
  return true;
}

// ── Worker message handler ──
const BATCH = 5000;
const MAX_SEED = 4294967296;

self.onmessage = function(e) {
  const { filters, limit } = e.data;
  const results = [];

  for (let seed = 0; seed < MAX_SEED; seed++) {
    if (results.length >= limit) break;

    const s = simulateSummary(seed);
    if (passesFilters(s, filters)) results.push(s);

    if (seed % BATCH === 0) {
      self.postMessage({ type: 'progress', seed: seed, found: results.length });
    }
  }

  self.postMessage({ type: 'done', results: results });
};
`;
}
