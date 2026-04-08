import { FlightRandom } from '../../shared/prng.js';

export const gameInfo = {
  id: 'fifa-masters',
  name: 'FIFA Masters',
};

// ─── Field constants ────────────────────────────────────────────────────────
const FIELD_WIDTH = 27100;
const BONUS_NEGATIVE_PER_SIDE = 5;
const BONUS_POSITIVE_PER_SIDE = 20;
const BONUS_HIT_R2 = 150 * 150;
const MAX_MULT = 500;
const TICK_LIMIT = 20000;

// LAYOUT — all values relative to center (0,0); y = 0 is ground / bottom of goalpost.
const GOAL_POST_POSITION       = 12160;
const MAX_MULTIPLIER_HEIGHT    = 4100;
const MIN_MULTIPLIER_HEIGHT    = 2450;
const GOALPOST_HEIGHT          = 2230;
const PLAYER_MODEL_HEIGHT      = 1350;
const PLAYER_MODEL_WIDTH       = 770;
const PLAYER_BASE_HEIGHT       = 240;
const BALL_MODEL_DIAMETER      = 520;
const PLAYER_POINT_LOW_HEIGHT  = 790;
const PLAYER_POINT_HIGH_HEIGHT = 1950;

const CENTER_X = FIELD_WIDTH / 2;
const GOAL_A_X = CENTER_X - GOAL_POST_POSITION;
const GOAL_B_X = CENTER_X + GOAL_POST_POSITION;

// Arc peak is randomised directly (not vy).
// Range [ARC_PEAK_MIN, ARC_PEAK_MAX), capped at 2500 + dx so short shots stay low.
const ARC_PEAK_MIN = 2500;
const ARC_PEAK_MAX = 5000;
const MAX_BALL_VX  = 100;

// Goalpost targeting weight = proximity^POW * SCALE.
// Tuned so the most-forward attacker (~81% proximity) gets ~90% goalpost chance.
const GOAL_W_POW = 6;
const GOAL_W_SCALE = 96;
const W_PRECISION = 10000;
const LONG_SHOT_THRESHOLD = 7000;

// Players too close for a direct pass (0-based indices).
const CLOSE_PAIRS = new Map([[2, 3], [3, 2], [8, 9], [9, 8]]);

// ─── Segment-to-point distance (for bonus collision) ────────────────────────
function segDistSq(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

// ─── Player arrangement ─────────────────────────────────────────────────────
// KA - 1A 1B 1A 2B 1A 1B 2A 1B 1A 1B - KB
// Offsets are relative to center (0,0 = FIELD_WIDTH / 2).
const PLAYER_LAYOUT = [
  { team: 'A', offset: -9830 },
  { team: 'B', offset: -8230 },
  { team: 'A', offset: -5770 },
  { team: 'B', offset: -5630 },
  { team: 'B', offset: -3490 },
  { team: 'A', offset: -940 },
  { team: 'B', offset: 940 },
  { team: 'A', offset: 3940 },
  { team: 'A', offset: 5630 },
  { team: 'B', offset: 5770 },
  { team: 'A', offset: 8230 },
  { team: 'B', offset: 9830 },
];

function buildPlayers() {
  const center = FIELD_WIDTH / 2;
  return PLAYER_LAYOUT.map(({ team, offset }) => ({
    x: Math.round(center + offset),
    team,
  }));
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

// ─── Bonus generation ───────────────────────────────────────────────────────
const BONUS_POSITIVE_TYPES = [
  { add: 1, mult: 1 },
  { add: 1, mult: 1 },
  { add: 1, mult: 1 },
  { add: 2, mult: 1 },
  { add: 2, mult: 1 },
  { add: 5, mult: 1 },
  { add: 10, mult: 1 },
  { add: 0, mult: 2 },
  { add: 0, mult: 3 },
];
const BONUS_NEGATIVE_TYPE = { add: 0, mult: 0.5 };

function bonusLabel(b) {
  return b.add ? `+${b.add}` : `x${b.mult}`;
}

const BONUS_MIN_DIST_SQ = 500 * 500;
const BONUS_PLACE_TRIES = 50;

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
  for (let i = 0; i < BONUS_NEGATIVE_PER_SIDE; i++) {
    placePair(rng, out, BONUS_NEGATIVE_TYPE, hRange, halfW);
  }
  for (let i = 0; i < BONUS_POSITIVE_PER_SIDE; i++) {
    const t = BONUS_POSITIVE_TYPES[rng.random(BONUS_POSITIVE_TYPES.length)];
    placePair(rng, out, t, hRange, halfW);
  }
  return out;
}

function generateBonuses(rng) {
  return generateBonusPositions(rng).map(b => ({
    ...b, label: bonusLabel(b), collected: false,
  }));
}

// ─── Target selection ───────────────────────────────────────────────────────
// Pick a player in the kick direction or the goalpost.
// Nearby players are weighted higher (1/rank).
// Goalpost weight rises steeply with proximity (proximity^6 * 96).
// Excluded: close-pair partner AND the player who just passed (no immediate return).

function chooseTarget(rng, kickerX, kickRight, players, kickerIdx, prevIdx) {
  const goalX = kickRight ? GOAL_B_X : GOAL_A_X;
  const blocked = CLOSE_PAIRS.get(kickerIdx);

  const candidates = [];
  for (let i = 0; i < players.length; i++) {
    if (i === blocked || i === prevIdx) continue;
    if (kickRight ? players[i].x > kickerX : players[i].x < kickerX) {
      candidates.push({ type: 'player', index: i, x: players[i].x });
    }
  }
  candidates.sort((a, b) => Math.abs(a.x - kickerX) - Math.abs(b.x - kickerX));

  const goalDist = GOAL_B_X - GOAL_A_X;
  const proximity = 1 - Math.abs(goalX - kickerX) / goalDist;
  const goalW = Math.max(0.1, Math.pow(proximity, GOAL_W_POW) * GOAL_W_SCALE);

  let totalW = goalW;
  const weights = [];
  for (let i = 0; i < candidates.length; i++) {
    const w = 1 / (i + 1);
    weights.push(w);
    totalW += w;
  }

  let roll = (rng.random(W_PRECISION) / W_PRECISION) * totalW;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return { type: 'goal', x: goalX };
}

// ─── Arc computation ────────────────────────────────────────────────────────
// y(t) = fromY + V*t − t(t−1)/2.  Peak = fromY + V(V+1)/2.
// Solving y(T) = targetY → T = [(2V+1) + sqrt((2V+1)² − 8·dy)] / 2.

function vFromPeak(peak, fromY) {
  const rel = peak - fromY;
  return Math.max(1, Math.round((-1 + Math.sqrt(1 + 8 * rel)) / 2));
}

function minPeakForSpeed(fromX, fromY, targetX, targetY) {
  const absDx = Math.abs(targetX - fromX);
  if (absDx === 0) return 0;
  const dy = targetY - fromY;
  let Tmin = Math.ceil(absDx / MAX_BALL_VX);
  if (dy > 0 && Tmin * Tmin <= 2 * dy) {
    Tmin = Math.ceil(Math.sqrt(2 * dy)) + 1;
  }
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

// ─── Travel-list builder ─────────────────────────────────────────────────────
// Phase 1: decide WHO receives the ball in what order (consumes target-selection
// RNG).  Phase 2 (in simulate / simulateSummary) randomises arc heights.

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

// Build the full stop list (start player + travel targets) and assign each
// player stop a y-height.  The ball is received AND shot from this exact point.
// Rule: outgoing x-distance > LONG_SHOT_THRESHOLD → LOW, otherwise → HIGH.
// Goal shots arrive at the goalkeeper's LOW receive height.

function buildStops(players, startIdx, targets) {
  const stops = [
    { type: 'player', index: startIdx, x: players[startIdx].x },
    ...targets,
  ];
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].type === 'goal') {
      stops[i].y = PLAYER_POINT_LOW_HEIGHT;
    } else if (i === 0) {
      stops[i].y = PLAYER_POINT_LOW_HEIGHT;
    } else {
      const dx = Math.abs(stops[i + 1].x - stops[i].x);
      stops[i].y = dx > LONG_SHOT_THRESHOLD
        ? PLAYER_POINT_LOW_HEIGHT
        : PLAYER_POINT_HIGH_HEIGHT;
    }
  }
  return stops;
}

// ─── Full simulation with recording ─────────────────────────────────────────

export function simulate(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);

  const players   = buildPlayers();
  const startTeam = rng.random(2) === 0 ? 'A' : 'B';
  const startIdx  = findCenterPlayer(players, startTeam);
  const bonuses   = generateBonuses(rng);

  // Phase 1 — travel list (target-selection RNG)
  const targets  = buildTravelList(rng, players, startIdx);
  const isGoal   = rng.random(2) === 0;
  const stops    = buildStops(players, startIdx, targets);
  const lastStop = stops[stops.length - 1];
  // Goal A: saved = cashout, goal = crash.  Goal B: goal = cashout, saved = crash.
  const landed   = lastStop.x === GOAL_B_X ? isGoal : !isGoal;

  // Phase 2 — simulate arcs (arc-height RNG)
  let ballX = stops[0].x;
  let ballY = stops[0].y;
  let mult     = 1;
  let totalDist = 0;
  let peakAlt   = 0;

  const path      = [];
  const collected = [];
  const events    = [];
  let prevMult    = 1;
  let posHits     = 0;
  let negHits     = 0;

  const pushEv = (label, m) => {
    events.push({ label, mult: m, isLoss: prevMult > m });
    prevMult = m;
  };
  pushEv('kickoff', 1);

  let ticks = 0;

  for (let s = 0; s < stops.length - 1 && ticks < TICK_LIMIT; s++) {
    const to       = stops[s + 1];
    const dx       = Math.abs(to.x - ballX);
    const sPeak    = minPeakForSpeed(ballX, ballY, to.x, to.y);
    const pMin     = Math.max(ARC_PEAK_MIN, Math.ceil(sPeak));
    const pMax     = Math.max(pMin, Math.min(ARC_PEAK_MAX, 2500 + dx));
    const peak     = pMin + rng.random(Math.max(1, pMax - pMin));
    const V        = vFromPeak(peak, ballY);
    const { vx, vy: initVy, T } = computeArc(ballX, ballY, to.x, to.y, V);

    let vy = initVy;
    for (let step = 0; step < T && ticks < TICK_LIMIT; step++) {
      const prevBX = ballX, prevBY = ballY;
      ballX += vx;
      ballY += vy;
      vy    -= 1;
      totalDist += Math.abs(vx);
      ticks++;

      if (ballY > peakAlt) peakAlt = ballY;

      for (const b of bonuses) {
        if (b.collected) continue;
        if (segDistSq(prevBX, prevBY, ballX, ballY, b.x, b.y) > BONUS_HIT_R2) continue;
        b.collected = true;
        if (b.mult < 1) negHits++; else posHits++;
        if (b.add)       mult += b.add;
        if (b.mult !== 1) mult *= b.mult;
        mult = Math.min(MAX_MULT, Math.max(0, mult));
        collected.push({
          dist: b.x, alt: b.y, label: b.label,
          isRocket: b.mult < 1,
          multBefore: prevMult, multAfter: mult,
          frame: path.length,
        });
        pushEv(b.label, mult);
      }

      path.push({ dist: ballX, alt: Math.max(0, ballY), mult });
    }

    // snap to exact receive/shoot point
    ballX = to.x;
    ballY = to.y;
  }

  pushEv(isGoal ? 'goal' : 'saved', landed ? mult : 0);

  // uncollected bonuses + field markers → missed
  const missed = [];
  for (const b of bonuses) {
    if (!b.collected) {
      missed.push({ dist: b.x, alt: b.y, label: b.label, isRocket: b.mult < 1 });
    }
  }
  // goalposts
  missed.push({
    dist: GOAL_A_X, alt: 0, label: '', isRocket: false,
    marker: { shape: 'rect', color: '#ffffff', opacity: 0.6, worldHeight: GOALPOST_HEIGHT }
  });
  missed.push({
    dist: GOAL_B_X, alt: 0, label: '', isRocket: false,
    marker: { shape: 'rect', color: '#ffffff', opacity: 0.6, worldHeight: GOALPOST_HEIGHT }
  });
  // field players (capsules — team A left of x, team B right of x)
  for (const p of players) {
    missed.push({
      dist: p.x, alt: 0, label: p.team, isRocket: false,
      marker: {
        shape: 'capsule', color: p.team === 'A' ? '#e05858' : '#4088e0',
        opacity: 0.75, worldHeight: PLAYER_MODEL_HEIGHT,
        worldWidth: PLAYER_MODEL_WIDTH, baseHeight: PLAYER_BASE_HEIGHT,
        side: p.team === 'A' ? 'left' : 'right',
      }
    });
  }
  // goalkeepers (centered on the goalpost)
  missed.push({
    dist: GOAL_A_X, alt: 0, label: 'GK', isRocket: false,
    marker: {
      shape: 'capsule', color: '#e05858', outline: '#fff',
      opacity: 0.85, worldHeight: PLAYER_MODEL_HEIGHT,
      worldWidth: PLAYER_MODEL_WIDTH, baseHeight: PLAYER_BASE_HEIGHT,
    }
  });
  missed.push({
    dist: GOAL_B_X, alt: 0, label: 'GK', isRocket: false,
    marker: {
      shape: 'capsule', color: '#4088e0', outline: '#fff',
      opacity: 0.85, worldHeight: PLAYER_MODEL_HEIGHT,
      worldWidth: PLAYER_MODEL_WIDTH, baseHeight: PLAYER_BASE_HEIGHT,
    }
  });

  const shotCounts = new Map();
  for (const s of stops) {
    if (s.type === 'player') shotCounts.set(s.index, (shotCounts.get(s.index) || 0) + 1);
  }
  const scorerIdx = stops.length >= 2 ? stops[stops.length - 2].index : -1;

  return {
    seed, path, collected, missed, events,
    landed,
    totalMult: landed ? mult : 0,
    ticks,
    shipDist: totalDist,
    peakAlt,
    bonusesCollected: posHits + negHits,
    positiveBonuses: posHits,
    negativeBonuses: negHits,
    scorerShots: shotCounts.get(scorerIdx) || 0,
    shots: Math.max(0, ...shotCounts.values()),
  };
}

// ─── Lightweight summary (no path/event recording) ──────────────────────────

export function simulateSummary(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);

  const players   = buildPlayers();
  const startTeam = rng.random(2) === 0 ? 'A' : 'B';
  const startIdx  = findCenterPlayer(players, startTeam);

  const bonuses = generateBonusPositions(rng).map(b => ({
    ...b, collected: false,
  }));

  // Phase 1 — travel list
  const targets  = buildTravelList(rng, players, startIdx);
  const isGoal   = rng.random(2) === 0;
  const stops    = buildStops(players, startIdx, targets);
  const lastStop = stops[stops.length - 1];
  const landed   = lastStop.x === GOAL_B_X ? isGoal : !isGoal;

  // Phase 2 — arcs
  let ballX = stops[0].x;
  let ballY = stops[0].y;
  let mult      = 1;
  let hits      = 0;
  let posHits   = 0;
  let negHits   = 0;
  let peakAlt   = 0;
  let totalDist = 0;

  let ticks = 0;

  for (let s = 0; s < stops.length - 1 && ticks < TICK_LIMIT; s++) {
    const to       = stops[s + 1];
    const dx       = Math.abs(to.x - ballX);
    const sPeak    = minPeakForSpeed(ballX, ballY, to.x, to.y);
    const pMin     = Math.max(ARC_PEAK_MIN, Math.ceil(sPeak));
    const pMax     = Math.max(pMin, Math.min(ARC_PEAK_MAX, 2500 + dx));
    const peak     = pMin + rng.random(Math.max(1, pMax - pMin));
    const V        = vFromPeak(peak, ballY);
    const { vx, vy: initVy, T } = computeArc(ballX, ballY, to.x, to.y, V);

    let vy = initVy;
    for (let step = 0; step < T && ticks < TICK_LIMIT; step++) {
      const prevBX = ballX, prevBY = ballY;
      ballX += vx;
      ballY += vy;
      vy    -= 1;
      totalDist += Math.abs(vx);
      ticks++;
      if (ballY > peakAlt) peakAlt = ballY;

      for (const b of bonuses) {
        if (b.collected) continue;
        if (segDistSq(prevBX, prevBY, ballX, ballY, b.x, b.y) > BONUS_HIT_R2) continue;
        b.collected = true;
        hits++;
        if (b.mult < 1) negHits++; else posHits++;
        if (b.add)       mult += b.add;
        if (b.mult !== 1) mult *= b.mult;
        mult = Math.min(MAX_MULT, Math.max(0, mult));
      }
    }

    ballX = to.x;
    ballY = to.y;
  }

  return {
    seed,
    objectsHit:      hits,
    finalMultiplier:  mult,
    totalMultiplier:  landed ? mult : 0,
    outcome:          landed ? 'win' : 'crash',
    distance:         totalDist,
    peakAltitude:     peakAlt,
    ticks,
    hitsPerTick:      ticks > 0 ? hits / ticks : 0,
    bonusesCollected: posHits + negHits,
    positiveBonuses:  posHits,
    negativeBonuses:  negHits,
    ...(() => {
      const sc = new Map();
      for (const s of stops) {
        if (s.type === 'player') sc.set(s.index, (sc.get(s.index) || 0) + 1);
      }
      const scorerIdx = stops.length >= 2 ? stops[stops.length - 2].index : -1;
      return {
        scorerShots: sc.get(scorerIdx) || 0,
        shots: Math.max(0, ...sc.values()),
      };
    })(),
  };
}
