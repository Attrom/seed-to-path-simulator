import { FlightRandom } from '../../shared/prng.js';

export const gameInfo = {
  id:   'aviamasters',
  name: 'Aviamasters',
};

const BASE_WIN        = 2 ** 13;
const MAX_WIN         = 250 * BASE_WIN;
const GRAVITY_CAP     = 60;
const MAX_UPWARD_SPEED = 110;
const X_DECEL         = 2;
const LAND_ZONE       = 1350;
const WRAP_L          = 2500;
const WRAP_R          = 4050;
const ROCKET_YADD     = 20;

// ─── Bonus ──────────────────────────────────────────────────────────────────
class Bonus {
  constructor(game, rng, yAdd, add, mult = 1, rocketAfter = 0) {
    this.game = game; this.rng = rng; this.yAdd = yAdd; this.add = add;
    this.mult = mult; this.rarity = 2000 + add * 400 + mult * 2000;
    this.speed = 0; this.rocketAfter = rocketAfter;
    this.x = 0; this.y = 0; this.isRocket = false; this.respawnCount = 0;
    this.siblings = []; this.onCollected = null;
  }

  get label() {
    if (this.isRocket) return 'x0.5';
    return this.add ? `+${this.add}` : `x${this.mult}`;
  }

  newRound() { this.isRocket = false; this.respawnCount = 0; this.respawn(); }

  respawn() {
    this.x = this.rng.random(this.rarity) + 4000;
    this.y = -this.rng.random(4000) - 700;
    while (this.siblings.some(b => b !== this && Math.abs(b.x - this.x) < 300 && Math.abs(b.y - this.y) < 450))
      this.y -= 200;
  }

  update() {
    this.x += this.game.xSpeed + this.speed;
    if (this.x > 0) return;
    const hit = Math.abs(this.game.playerY - this.y) <= 220;
    if (hit) {
      if (this.isRocket || this.mult < 1) {
        const loss = Math.max(1, Math.floor(this.game.win * 0.5));
        this.game.win = Math.max(0, this.game.win - loss);
      } else {
        this.game.win += this.add * BASE_WIN;
        this.game.win *= this.mult;
      }
      this.game.win = Math.min(MAX_WIN, this.game.win);
      const maxB = Math.max(-this.game.ySpeed + 20, Math.floor((6000 + this.game.playerY + 0.5) / 64));
      const ya = this.isRocket ? ROCKET_YADD : this.yAdd;
      this.game.ySpeed = Math.max(-maxB, -MAX_UPWARD_SPEED, this.game.ySpeed + ya);
      if (ya < 0) this.game.ySpeed = Math.min(ya, this.game.ySpeed);
    }
    if (hit && this.onCollected) this.onCollected();
    this.respawnCount++;
    if (this.respawnCount === this.rocketAfter) this.isRocket = true;
    this.respawn();
  }
}

// ─── Flight Model ───────────────────────────────────────────────────────────
class FlightModel {
  constructor() {
    this.rng = new FlightRandom();
    this.win = 1; this.playerY = 0; this.xSpeed = 0; this.ySpeed = 0;
    this.shipX = 0; this.isFinished = true; this.landed = false; this.distance = 0;
    this.bonuses = [
      new Bonus(this, this.rng, -40, 1, 1, 1),
      new Bonus(this, this.rng, -40, 1, 1, 2),
      new Bonus(this, this.rng, -40, 1, 1, 3),
      new Bonus(this, this.rng, -40, 2, 1, 4),
      new Bonus(this, this.rng, -40, 2, 1, 5),
      new Bonus(this, this.rng, -40, 5, 1, 6),
      new Bonus(this, this.rng, -40, 10, 1, 7),
      new Bonus(this, this.rng, -40, 0, 2, 8),
      new Bonus(this, this.rng, -40, 0, 3, 9),
      new Bonus(this, this.rng, -40, 0, 4, 10),
      new Bonus(this, this.rng, -40, 0, 5, 11),
      new Bonus(this, this.rng, ROCKET_YADD, 0, 0.5),
    ];
    for (const b of this.bonuses) b.siblings = this.bonuses;
  }

  seed(v) {
    this.distance = 0; this.isFinished = false; this.win = BASE_WIN;
    this.landed = false; this.ySpeed = -78; this.xSpeed = -80;
    this.playerY = 0; this.shipX = 0; this.rng.seed(v);
    for (const b of this.bonuses) b.y = -1e6;
    for (const b of this.bonuses) b.newRound();
  }

  update() {
    this.shipX += this.xSpeed;
    this.distance -= this.xSpeed;
    if (this.shipX < -WRAP_L) this.shipX = WRAP_R;
    if (this.landed) {
      if (this.shipX > -LAND_ZONE) {
        if (this.xSpeed) this.xSpeed += X_DECEL;
        if (this.xSpeed === 0) this.isFinished = true;
      } else { this.landed = false; this.isFinished = true; }
    } else {
      if (this.ySpeed < GRAVITY_CAP) this.ySpeed++;
      this.playerY += this.ySpeed;
      if (this.playerY >= 0) {
        if (this.shipX > -LAND_ZONE && this.shipX < LAND_ZONE)
          { this.landed = true; this.ySpeed = 0; this.playerY = 0; }
        else this.isFinished = true;
        if (this.xSpeed) this.xSpeed += X_DECEL;
      }
    }
    for (const b of this.bonuses) b.update();
  }

  multiplier()      { return this.win / BASE_WIN; }
  totalMultiplier() { return this.landed ? this.win / BASE_WIN : 0; }
}

// ─── Simulation ─────────────────────────────────────────────────────────────

const TICK_LIMIT = 50000;

export function simulate(seed) {
  const model = new FlightModel();
  model.seed(seed);

  const path      = [];
  const collected = [];
  const missed    = [];
  const events    = [];
  let prevMult    = 0;
  let peakAlt     = 0;

  const pushEv = (label, mult) => {
    events.push({ label, mult, isLoss: prevMult > mult });
    prevMult = mult;
  };
  pushEv('takeoff', 1);

  for (const b of model.bonuses) {
    b.onCollected = () => {
      collected.push({
        dist: model.distance, alt: -model.playerY, label: b.label,
        isRocket: b.isRocket,
        multBefore: prevMult, multAfter: model.multiplier(),
      });
      pushEv(b.label, model.multiplier());
    };
  }

  let ticks = 0;
  while (!model.isFinished && ticks < TICK_LIMIT) {
    for (const b of model.bonuses) {
      if (b.x > 0 && b.x <= Math.abs(model.xSpeed) + 1) {
        const willHit = Math.abs(model.playerY - b.y) <= 220;
        if (!willHit) {
          missed.push({ dist: model.distance, alt: -b.y, label: b.label, isRocket: b.isRocket });
        }
      }
    }
    model.update();
    ticks++;
    const alt = -model.playerY;
    if (alt > peakAlt) peakAlt = alt;
    path.push({ dist: model.distance, alt, mult: model.multiplier() });
  }

  const totalMult = model.totalMultiplier();
  pushEv(model.landed ? 'landed' : 'crashed', totalMult);
  const shipDist = model.distance + model.shipX;

  return { seed, path, collected, missed, events, landed: model.landed, totalMult, ticks, shipDist, peakAlt };
}

export function simulateSummary(seed) {
  const model = new FlightModel();
  model.seed(seed);

  let objectsHit  = 0;
  let peakAlt     = 0;

  for (const b of model.bonuses) {
    b.onCollected = () => { objectsHit++; };
  }

  let ticks = 0;
  while (!model.isFinished && ticks < TICK_LIMIT) {
    model.update();
    ticks++;
    const alt = -model.playerY;
    if (alt > peakAlt) peakAlt = alt;
  }

  return {
    seed,
    objectsHit,
    finalMultiplier: model.multiplier(),
    totalMultiplier: model.totalMultiplier(),
    outcome: model.landed ? 'win' : 'crash',
    distance: model.distance,
    peakAltitude: peakAlt,
    ticks,
    hitsPerTick: ticks > 0 ? objectsHit / ticks : 0,
  };
}
