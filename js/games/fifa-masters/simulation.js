import { FlightRandom } from '../../shared/prng.js';

export const gameInfo = {
  id:   'fifa-masters',
  name: 'FIFA Masters',
};

// ─── Field constants ────────────────────────────────────────────────────────
const FIELD_WIDTH      = 20000;
const BONUS_COUNT      = 40;
const BONUS_HIT_R2     = 150 * 150;
const MAX_MULT         = 1000;
const TICK_LIMIT       = 50000;

// Arc height is controlled by initial vy (integer).
// Peak height = V*(V+1)/2, flight time = 2*V+1 ticks.
// V ∈ [28, 70) → peak ≈ 406–2485, flight ≈ 57–139 ticks.
const ARC_V_MIN        = 28;
const ARC_V_RANGE      = 42;

// Goalpost targeting weight = proximity^POW * SCALE.
// Tuned so the most-forward attacker (~81% proximity) gets ~90% goalpost chance.
const GOAL_W_POW       = 6;
const GOAL_W_SCALE     = 96;
const W_PRECISION      = 10000;

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
// KA - 3A 1B 2A 1B 1A 1B 1A 1B 1A 1B 1A 2B 1A 3B - KB
const TEAM_PATTERN = [
  'A','A','A', 'B',
  'A','A', 'B',
  'A', 'B',
  'A', 'B',
  'A', 'B',
  'A', 'B',
  'B', 'A',
  'B','B','B',
];

function buildPlayers() {
  const spacing = FIELD_WIDTH / (TEAM_PATTERN.length + 1);
  return TEAM_PATTERN.map((team, i) => ({
    x: Math.round(spacing * (i + 1)),
    team,
  }));
}

function findCenterTeamA(players) {
  const center = FIELD_WIDTH / 2;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    if (players[i].team !== 'A') continue;
    const d = Math.abs(players[i].x - center);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ─── Bonus generation ───────────────────────────────────────────────────────
const BONUS_TYPES = [
  { add: 1,  mult: 1   },
  { add: 1,  mult: 1   },
  { add: 1,  mult: 1   },
  { add: 2,  mult: 1   },
  { add: 2,  mult: 1   },
  { add: 5,  mult: 1   },
  { add: 10, mult: 1   },
  { add: 0,  mult: 2   },
  { add: 0,  mult: 3   },
  { add: 0,  mult: 0.5 },
  { add: 0,  mult: 0.5 },
];

function bonusLabel(b) {
  return b.add ? `+${b.add}` : `x${b.mult}`;
}

function generateBonuses(rng) {
  return Array.from({ length: BONUS_COUNT }, () => {
    const t = BONUS_TYPES[rng.random(BONUS_TYPES.length)];
    return {
      x: rng.random(FIELD_WIDTH - 2000) + 1000,
      y: rng.random(2500) + 400,
      add: t.add, mult: t.mult,
      label: bonusLabel(t),
      collected: false,
    };
  });
}

// ─── Target selection ───────────────────────────────────────────────────────
// Pick a player in the kick direction or the goalpost.
// Nearby players are weighted higher (1/rank).
// Goalpost weight rises steeply with proximity (proximity^6 * 96).

function chooseTarget(rng, kickerX, kickRight, players) {
  const goalX = kickRight ? FIELD_WIDTH : 0;

  const candidates = [];
  for (let i = 0; i < players.length; i++) {
    if (kickRight ? players[i].x > kickerX : players[i].x < kickerX) {
      candidates.push({ type: 'player', index: i, x: players[i].x });
    }
  }
  candidates.sort((a, b) => Math.abs(a.x - kickerX) - Math.abs(b.x - kickerX));

  const proximity = 1 - Math.abs(goalX - kickerX) / FIELD_WIDTH;
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
// Given integer V (initial vy), the ball peaks at V*(V+1)/2 and
// returns to y=0 after exactly T = 2*V+1 ticks.
// vx is computed so the ball lands exactly at targetX.

function computeArc(fromX, targetX, V) {
  const T = 2 * V + 1;
  const vx = (targetX - fromX) / T;
  return { vx, vy: V, T };
}

// ─── Full simulation with recording ─────────────────────────────────────────

export function simulate(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);

  const players  = buildPlayers();
  const startIdx = findCenterTeamA(players);
  const bonuses  = generateBonuses(rng);

  let ballX = players[startIdx].x;
  let ballY = 0;
  let mult     = 1;
  let finished = false;
  let isGoal   = false;
  let totalDist = 0;
  let peakAlt   = 0;

  const path      = [];
  const collected = [];
  const events    = [];
  let prevMult    = 1;

  const pushEv = (label, m) => {
    events.push({ label, mult: m, isLoss: prevMult > m });
    prevMult = m;
  };
  pushEv('kickoff', 1);

  let ticks = 0;

  while (!finished && ticks < TICK_LIMIT) {
    // current player determines kick direction
    const kickRight = ticks === 0
      ? true
      : players.find(p => p.x === ballX)?.team === 'A';

    const target = chooseTarget(rng, ballX, kickRight, players);
    const V = ARC_V_MIN + rng.random(ARC_V_RANGE);
    const { vx, vy: initVy, T } = computeArc(ballX, target.x, V);

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
        if (b.add)       mult += b.add;
        if (b.mult !== 1) mult *= b.mult;
        mult = Math.min(MAX_MULT, Math.max(0, mult));
        collected.push({
          dist: b.x, alt: b.y, label: b.label,
          isRocket: b.mult < 1,
          multBefore: prevMult, multAfter: mult,
        });
        pushEv(b.label, mult);
      }

      path.push({ dist: ballX, alt: Math.max(0, ballY), mult });
    }

    // snap to exact target
    ballX = target.x;
    ballY = 0;

    if (target.type === 'goal') {
      isGoal   = rng.random(2) === 0;
      finished = true;
      pushEv(isGoal ? 'goal' : 'saved', isGoal ? mult : 0);
    }
  }

  // uncollected bonuses + field markers → missed
  const missed = [];
  for (const b of bonuses) {
    if (!b.collected) {
      missed.push({ dist: b.x, alt: b.y, label: b.label, isRocket: b.mult < 1 });
    }
  }
  // goalposts (white rectangles, drawn first so players render on top)
  missed.push({ dist: 0, alt: 0, label: '', isRocket: false,
    marker: { shape: 'rect', color: '#ffffff', opacity: 0.6, height: 34 } });
  missed.push({ dist: FIELD_WIDTH, alt: 0, label: '', isRocket: false,
    marker: { shape: 'rect', color: '#ffffff', opacity: 0.6, height: 34 } });
  // field players (team-colored)
  for (const p of players) {
    missed.push({ dist: p.x, alt: 0, label: p.team, isRocket: false,
      marker: { color: p.team === 'A' ? '#e05858' : '#4088e0', opacity: 0.75 } });
  }
  // goalkeepers (team-colored with white outline)
  missed.push({ dist: 0, alt: 0, label: 'GK', isRocket: false,
    marker: { color: '#e05858', outline: '#fff', opacity: 0.85 } });
  missed.push({ dist: FIELD_WIDTH, alt: 0, label: 'GK', isRocket: false,
    marker: { color: '#4088e0', outline: '#fff', opacity: 0.85 } });

  return {
    seed, path, collected, missed, events,
    landed: isGoal,
    totalMult: isGoal ? mult : 0,
    ticks,
    shipDist: totalDist,
    peakAlt,
  };
}

// ─── Lightweight summary (no path/event recording) ──────────────────────────

export function simulateSummary(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);

  const players  = buildPlayers();
  const startIdx = findCenterTeamA(players);

  const bonuses = [];
  for (let i = 0; i < BONUS_COUNT; i++) {
    const t = BONUS_TYPES[rng.random(BONUS_TYPES.length)];
    bonuses.push({
      x: rng.random(FIELD_WIDTH - 2000) + 1000,
      y: rng.random(2500) + 400,
      add: t.add, mult: t.mult, collected: false,
    });
  }

  let ballX = players[startIdx].x;
  let ballY = 0;
  let mult      = 1;
  let hits      = 0;
  let peakAlt   = 0;
  let totalDist = 0;
  let finished  = false;
  let isGoal    = false;

  let ticks = 0;

  while (!finished && ticks < TICK_LIMIT) {
    const kickRight = ticks === 0
      ? true
      : players.find(p => p.x === ballX)?.team === 'A';

    const target = chooseTarget(rng, ballX, kickRight, players);
    const V = ARC_V_MIN + rng.random(ARC_V_RANGE);
    const { vx, vy: initVy, T } = computeArc(ballX, target.x, V);

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
        if (b.add)       mult += b.add;
        if (b.mult !== 1) mult *= b.mult;
        mult = Math.min(MAX_MULT, Math.max(0, mult));
      }
    }

    ballX = target.x;
    ballY = 0;

    if (target.type === 'goal') {
      isGoal   = rng.random(2) === 0;
      finished = true;
    }
  }

  return {
    seed,
    objectsHit:      hits,
    finalMultiplier:  mult,
    totalMultiplier:  isGoal ? mult : 0,
    outcome:          isGoal ? 'win' : 'crash',
    distance:         totalDist,
    peakAltitude:     peakAlt,
    ticks,
    hitsPerTick:      ticks > 0 ? hits / ticks : 0,
  };
}
