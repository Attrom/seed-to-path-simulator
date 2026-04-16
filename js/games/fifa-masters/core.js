/**
 * FIFA Masters — core simulation algorithm.
 *
 * Pure seed-to-path engine with no rendering concerns.
 * Designed to be consumed by any game client that needs to convert a seed
 * into a deterministic path, bonus data, and stop/arrival information.
 *
 * For this app's visualizer wrapper (adds rendering markers), see simulation.js.
 * For static field layout (player/goalpost positions), see field-config.js.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW TO USE THIS MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dependencies:
 *   • prng.js   — FlightRandom (deterministic seeded PRNG)
 *   • field-config.js — static player/goalpost positions (see that file for docs)
 *
 * Determinism guarantee:
 *   simulate(seed) always returns the exact same result for a given integer
 *   seed.  The PRNG state is fully determined by the seed, and every random
 *   choice in the algorithm consumes RNG calls in a fixed order.
 *
 * ── Quick start ─────────────────────────────────────────────────────────────
 *
 *   import { simulate } from './core.js';
 *   const result = simulate(42);
 *
 * ── What simulate(seed) returns ─────────────────────────────────────────────
 *
 *   seed            (number)   The input seed, echoed back.
 *   startTeam       ('A'|'B')  Which team kicks off.
 *   landed          (boolean)  Did the player/bettor WIN this round?
 *   isGoal          (boolean)  Was the final shot a goal? (win/loss depends
 *                              on WHICH goal — see field-config.js header)
 *   totalMult       (number)   Final multiplier if won, 0 if lost.
 *
 *   path            (array)    The ball's trajectory, one entry per simulation
 *                              tick.  Array index = frame number (0-based).
 *     [i].dist      (number)   Ball x-position (world units, same axis as
 *                              fieldConfig.players[].x and goalposts.*.x).
 *     [i].alt       (number)   Ball altitude (y ≥ 0, world units).
 *     [i].mult      (number)   Current multiplier at this tick (reflects all
 *                              bonuses collected up to and including this frame).
 *
 *   bonuses         (array)    ALL bonus objects generated for this seed.
 *                              Seed-dependent positions & values.
 *     [i].x         (number)   Bonus x-position.
 *     [i].y         (number)   Bonus y-position (altitude).
 *     [i].add       (number)   Additive effect (e.g. 1 → multiplier += 1).
 *     [i].mult      (number)   Multiplicative effect (e.g. 2 → multiplier *= 2,
 *                              0.5 → multiplier *= 0.5 which is a negative bonus).
 *     [i].label     (string)   Human-readable label ('+1', '+5', 'x2', 'x0.5').
 *     [i].collected (boolean)  true if the ball hit this bonus during the sim.
 *
 *   collected       (array)    Only the bonuses that were actually HIT, with
 *                              timing and multiplier snapshots.
 *     [i].frame     (number)   *** The tick (0-based path index) at which the
 *                              ball collected this bonus.  path[frame].mult
 *                              already reflects this collection. ***
 *     [i].multBefore (number)  Multiplier just before this collection.
 *     [i].multAfter  (number)  Multiplier just after this collection.
 *     [i].dist / .alt          Bonus position (same as the corresponding
 *                              bonuses[].x / .y).
 *     [i].label     (string)   Same as bonuses[].label.
 *     [i].isRocket   (boolean) true if negative (mult < 1).
 *
 *   stops           (array)    The ordered sequence of "stops" the ball visits:
 *                              first the kickoff player, then each pass target,
 *                              ending at a goalpost.
 *     [i].type      ('player'|'goal')
 *     [i].index     (number)   Player index into fieldConfig.players[].
 *                              Only present when type === 'player'.
 *     [i].x         (number)   x-position of this stop.
 *     [i].y         (number)   y-position (receive/shoot height).
 *     [i].arrivalFrame (number)
 *       *** The tick at which the ball arrives at this stop. ***
 *       For the first stop (kickoff player), arrivalFrame is 0.
 *       For subsequent stops, arrivalFrame = path.length after all ticks of
 *       the arc leading to this stop have been pushed.
 *
 *       KEY USAGE — "N ticks before the ball reaches player at stop i":
 *         const warnFrame = stops[i].arrivalFrame - N;
 *         // path[warnFrame] is the ball position N ticks before arrival.
 *
 *       The ball DEPARTS from stop i at the same frame (no dwell time),
 *       so the first tick of the NEXT arc is at path[stops[i].arrivalFrame].
 *
 *   events          (array)    Discrete labeled moments in chronological order.
 *     [i].label     (string)   'kickoff', bonus label, 'goal', or 'saved'.
 *     [i].mult      (number)   Multiplier at this event.
 *     [i].isLoss    (boolean)  true if mult dropped vs. previous event.
 *
 *   ── Stats (all numbers) ──
 *   ticks               Total simulation ticks (= path.length).
 *   shipDist             Cumulative horizontal distance the ball traveled.
 *   peakAlt              Highest altitude reached at any tick.
 *   bonusesCollected     Count of bonuses hit (positive + negative).
 *   positiveBonuses      Count of positive bonuses hit.
 *   negativeBonuses      Count of negative bonuses hit.
 *   totalShots           Number of player stops (= passes + final shot).
 *   shotsA / shotsB      Shots by Team A / Team B.
 *   dirChanges           How many times the ball changed team direction.
 *   shots                Max touches by any single player.
 *   lastShotStartFrame   Frame index where the final arc began.
 *   lastShotPeakFrame    Frame index of the highest point in the final arc.
 *   lastShotGoalX        x-position of the target goalpost for the final shot.
 *
 * ── How the algorithm works (overview) ──────────────────────────────────────
 *
 *   Phase 1 — "Who gets the ball?" (consumes target-selection RNG)
 *     1. RNG picks kickoff team (A or B).
 *     2. Bonuses are placed symmetrically (RNG positions + types).
 *     3. buildTravelList iteratively picks the next pass target or goal
 *        using weighted random selection.  Closer players & goals nearer
 *        to the kicker's forward direction are more likely.
 *     4. RNG decides goal vs save for the final shot.
 *     5. buildStops assigns a receive/shoot y-height to each stop based on
 *        the outgoing pass distance (long = low, short = high).
 *
 *   Phase 2 — "How does the ball fly?" (consumes arc-height RNG)
 *     For each consecutive pair of stops:
 *     1. A random arc peak is chosen within [ARC_PEAK_MIN, ARC_PEAK_MAX],
 *        capped so short shots don't fly unrealistically high.
 *     2. Initial vertical velocity (V) is derived from the peak.
 *     3. Horizontal velocity (vx) and flight duration (T) are computed so
 *        the ball lands exactly at the target stop.
 *     4. The ball is stepped tick-by-tick (ballX += vx, ballY += vy, vy -= 1).
 *        Each tick is pushed to path[] and tested against all uncollected
 *        bonuses for collision (segment-to-point distance ≤ 150 world units).
 *     5. After all ticks for an arc, the ball is snapped to the exact stop
 *        position and the next arc begins.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { FlightRandom } from '../../shared/prng.js';
import { fieldConfig }  from './field-config.js';

// ─── Config-derived constants ────────────────────────────────────────────────

const FIELD_WIDTH              = fieldConfig.fieldWidth;
const GOAL_A_X                 = fieldConfig.goalposts.a.x;
const GOAL_B_X                 = fieldConfig.goalposts.b.x;
const CENTER_X                 = FIELD_WIDTH / 2;
const PLAYER_POINT_LOW_HEIGHT  = fieldConfig.playerPointLowHeight;
const PLAYER_POINT_HIGH_HEIGHT = fieldConfig.playerPointHighHeight;
const TEAM_B_HEIGHT_OFFSET     = fieldConfig.teamBHeightOffset;
const MAX_MULTIPLIER_HEIGHT    = fieldConfig.maxMultiplierHeight;
const MIN_MULTIPLIER_HEIGHT    = fieldConfig.minMultiplierHeight;

// ─── Algorithm constants ─────────────────────────────────────────────────────
// These tune the simulation behaviour.  Changing any of them will produce
// different paths for the same seed — they are part of the algorithm contract.

const BONUS_NEGATIVE_PER_SIDE = 5;   // negative (x0.5) bonuses placed per field half
const BONUS_POSITIVE_PER_SIDE = 12;  // positive bonuses placed per field half
const BONUS_HIT_R2   = 150 * 150;    // collision radius² (world units) for bonus pickup
const MAX_MULT       = 500;          // hard cap on the multiplier
const TICK_LIMIT     = 20000;        // safety cap — simulation aborts if exceeded

const ARC_PEAK_MIN   = 2500;  // minimum arc peak height (world units above ground)
const ARC_PEAK_MAX   = 5000;  // maximum arc peak height (capped further by shot distance)
const MAX_BALL_VX    = 180;   // max horizontal velocity per tick (world units)

const GOAL_W_POW     = 6;     // exponent for goalpost targeting weight (proximity^POW)
const GOAL_W_SCALE   = 96;    // scale factor for goalpost weight
const W_PRECISION    = 10000; // resolution for the weighted random roll
const LONG_SHOT_THRESHOLD = 7000; // if outgoing dx > this → ball received LOW; else HIGH

// Player indices that are too close for a direct pass (bidirectional).
const CLOSE_PAIRS = new Map([[2, 3], [3, 2], [8, 9], [9, 8]]);

// ─── Segment-to-point distance (bonus collision) ────────────────────────────
// Returns the squared distance from point (px,py) to the closest point on the
// line segment (ax,ay)→(bx,by).  Used each tick to test if the ball's movement
// segment passes close enough to a bonus to collect it.

function segDistSq(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

// ─── Player helpers ──────────────────────────────────────────────────────────

function getPlayers() {
  return fieldConfig.players;
}

function findCenterPlayer(players, team) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    if (players[i].team !== team) continue;
    const d = Math.abs(players[i].x - CENTER_X);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ─── Bonus generation ───────────────────────────────────────────────────────
// Bonuses are placed symmetrically: for each bonus, a mirror pair is created
// at equal horizontal offset from both goalposts, at a random altitude within
// [minMultiplierHeight, maxMultiplierHeight].  This means bonus positions are
// seed-dependent (they consume RNG calls).
//
// Each bonus type has { add, mult }:
//   add  → added to multiplier first  (mult += add)
//   mult → then multiplied            (mult *= mult)
//   So { add: 5, mult: 1 } means "+5" and { add: 0, mult: 2 } means "x2".
//   The one negative type is { add: 0, mult: 0.5 } → halves the multiplier.

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

export function generateBonusPositions(rng) {
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
// Picks the next pass target for a kicker.  Candidates are all players ahead
// of the kicker in the kick direction, excluding the close-pair partner and
// the player who just passed (no immediate return passes).
//
// Weighting:  Closer players get higher weight (1/rank by distance).
//             The goalpost gets a weight that rises steeply with proximity
//             (proximity^6 * 96), so forwards near the goal are very likely
//             to attempt a shot.

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
// Physics model:  y(t) = fromY + V*t − t*(t−1)/2   (discrete gravity, vy -= 1/tick)
// Peak altitude  = fromY + V*(V+1)/2
// vFromPeak      → derives initial vy from a desired peak height.
// minPeakForSpeed → minimum peak so horizontal speed stays ≤ MAX_BALL_VX.
// computeArc     → given initial vy (V), computes flight time T and horizontal
//                  velocity vx so the ball lands exactly at the target.

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
// Phase 1 of the algorithm: repeatedly call chooseTarget until a goal is
// selected (or a 200-pass safety cap is reached).  The output is an ordered
// list of targets the ball will visit.

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

// Converts the target list into a full stop sequence (kickoff player + targets)
// and assigns each stop a y-height based on the outgoing pass distance.
function buildStops(players, startIdx, targets) {
  const stops = [
    { type: 'player', index: startIdx, x: players[startIdx].x },
    ...targets,
  ];
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].type === 'goal') {
      stops[i].y = PLAYER_POINT_LOW_HEIGHT;
    } else {
      const off = players[stops[i].index].team === 'B' ? TEAM_B_HEIGHT_OFFSET : 0;
      if (i === 0) {
        stops[i].y = PLAYER_POINT_LOW_HEIGHT + off;
      } else {
        const dx = Math.abs(stops[i + 1].x - stops[i].x);
        stops[i].y = (dx > LONG_SHOT_THRESHOLD
          ? PLAYER_POINT_LOW_HEIGHT
          : PLAYER_POINT_HIGH_HEIGHT) + off;
      }
    }
  }
  return stops;
}

// ─── Full simulation with recording ─────────────────────────────────────────
//
// Returns:
//   seed         – input seed
//   startTeam    – 'A' or 'B' (kickoff team)
//   path         – [{dist, alt, mult}, ...]  one entry per tick
//   bonuses      – [{x, y, add, mult, label, collected}, ...]  all bonuses (positions + values)
//   collected    – [{dist, alt, label, isRocket, multBefore, multAfter, frame}, ...]
//   stops        – [{type, index, x, y, arrivalFrame}, ...]
//                    arrivalFrame = path.length at the moment the ball reaches this stop.
//                    For the first stop (kickoff) arrivalFrame is 0.
//                    Use (arrivalFrame - N) to find the tick N ticks before arrival.
//   events       – [{label, mult, isLoss}, ...]
//   landed       – boolean (did the player win?)
//   isGoal       – boolean (was the final shot a goal? — determines win/loss per goal side)
//   totalMult    – final multiplier if won, else 0
//   ticks, shipDist, peakAlt, bonusesCollected, positiveBonuses, negativeBonuses,
//   totalShots, shotsA, shotsB, dirChanges, shots,
//   lastShotStartFrame, lastShotPeakFrame, lastShotGoalX

export function simulate(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);

  const players   = getPlayers();
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
  let lastShotStartFrame = 0;
  let lastShotPeakFrame  = 0;
  let lastShotPeakAlt    = -Infinity;

  stops[0].arrivalFrame = 0;

  for (let s = 0; s < stops.length - 1 && ticks < TICK_LIMIT; s++) {
    const isLastShot = s === stops.length - 2;
    if (isLastShot) lastShotStartFrame = path.length;

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

      if (isLastShot && ballY > lastShotPeakAlt) {
        lastShotPeakAlt = ballY;
        lastShotPeakFrame = path.length;
      }

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

    stops[s + 1].arrivalFrame = path.length;

    // snap to exact receive/shoot point
    ballX = to.x;
    ballY = to.y;
  }

  pushEv(isGoal ? 'goal' : 'saved', landed ? mult : 0);

  let totalShots = 0, shotsA = 0, shotsB = 0, dirChanges = 0;
  let prevTeam = null;
  const shotCounts = new Map();
  for (const s of stops) {
    if (s.type === 'player') {
      const team = players[s.index].team;
      totalShots++;
      if (team === 'A') shotsA++; else shotsB++;
      if (prevTeam !== null && team !== prevTeam) dirChanges++;
      prevTeam = team;
      shotCounts.set(s.index, (shotCounts.get(s.index) || 0) + 1);
    }
  }

  return {
    seed, startTeam, path, bonuses, collected, stops, events,
    landed, isGoal,
    totalMult: landed ? mult : 0,
    ticks,
    shipDist: totalDist,
    peakAlt,
    bonusesCollected: posHits + negHits,
    positiveBonuses: posHits,
    negativeBonuses: negHits,
    totalShots, shotsA, shotsB, dirChanges,
    shots: Math.max(0, ...shotCounts.values()),
    lastShotStartFrame,
    lastShotPeakFrame,
    lastShotGoalX: lastStop.x,
  };
}

// ─── Lightweight summary (no path/event recording) ──────────────────────────
// Same RNG consumption order as simulate() so results are consistent, but does
// NOT build path[], collected[], stops[], or events[].  Use for fast batch
// scanning / filtering of seeds when you only need aggregate stats.

export function simulateSummary(seed) {
  const rng = new FlightRandom();
  rng.seed(seed);

  const players   = getPlayers();
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
    startTeam,
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
      let totalShots = 0, shotsA = 0, shotsB = 0, dirChanges = 0;
      let prevTeam = null;
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
        totalShots, shotsA, shotsB, dirChanges,
        shots: Math.max(0, ...sc.values()),
      };
    })(),
  };
}
