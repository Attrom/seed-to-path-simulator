/**
 * Generates field-config.js from raw layout parameters.
 *
 * Run:  node js/games/fifa-masters/generate-field-config.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The raw field layout is defined in terms of OFFSETS from the field center
 * (e.g. a player at offset -9830 sits 9830 world units left of center).
 * This script computes absolute x-positions and writes them to field-config.js
 * so that consuming code (core.js, simulation.js, or any external game client)
 * can use the positions directly without re-deriving them.
 *
 * All layout values live HERE as the single source of truth.
 * field-config.js is the generated output — do not edit it by hand.
 *
 * ── When to re-run ──────────────────────────────────────────────────────────
 *
 * Re-run this script whenever you change any raw layout parameter below
 * (field size, goalpost position, player offsets, model dimensions, etc.).
 * The output file is deterministic — same inputs always produce the same file.
 *
 * ── What the output contains ────────────────────────────────────────────────
 *
 * field-config.js exports a single `fieldConfig` object with:
 *   • fieldWidth            — total horizontal extent of the field
 *   • goalposts.a.x / b.x  — absolute x of left / right goalpost
 *   • goalpostHeight        — visual height of goalpost sprite
 *   • players[]             — 12 field players, each { x, team }
 *                             (absolute x, ordered left→right)
 *   • playerPointLowHeight  — ball receive/shoot y for long passes (dx > 7000)
 *   • playerPointHighHeight — ball receive/shoot y for short passes (dx ≤ 7000)
 *   • teamBHeightOffset     — extra y added to Team B receive heights
 *   • maxMultiplierHeight   — upper y-bound of the bonus spawn band
 *   • minMultiplierHeight   — lower y-bound of the bonus spawn band
 *   • playerModelHeight/Width, playerBaseHeight, ballModelDiameter — visual dims
 *
 * See the generated file's header for full coordinate system docs and a
 * property-by-property reference.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { writeFileSync } from 'fs';
import { dirname, join }  from 'path';
import { fileURLToPath }   from 'url';

// ─── Raw layout parameters ──────────────────────────────────────────────────
// All values are in world units.  The field's origin is at the left edge (x=0)
// and ground level (y=0).  Positive x → right, positive y → up.

const FIELD_WIDTH              = 27100;  // total horizontal field size
const GOAL_POST_POSITION       = 12160;  // symmetric offset from center for each goal

const GOALPOST_HEIGHT          = 2230;   // visual height of the goalpost
const MAX_MULTIPLIER_HEIGHT    = 4100;   // top of the bonus spawn band (y)
const MIN_MULTIPLIER_HEIGHT    = 2450;   // bottom of the bonus spawn band (y)
const PLAYER_POINT_LOW_HEIGHT  = 420;    // ball y for long-distance passes
const PLAYER_POINT_HIGH_HEIGHT = 1950;   // ball y for short-distance passes
const TEAM_B_HEIGHT_OFFSET     = 60;     // additional y for Team B receive heights

const PLAYER_MODEL_HEIGHT      = 1350;   // sprite height (visual only)
const PLAYER_MODEL_WIDTH       = 770;    // sprite width (visual only)
const PLAYER_BASE_HEIGHT       = 240;    // sprite ground offset (visual only)
const BALL_MODEL_DIAMETER      = 520;    // ball sprite diameter (visual only)

// Player positions as offsets from field center (center = FIELD_WIDTH / 2).
// Ordered left→right.  Team A always kicks right; Team B kicks left.
const PLAYER_LAYOUT = [
  { team: 'A', offset: -9830 },
  { team: 'B', offset: -8230 },
  { team: 'A', offset: -5770 },
  { team: 'B', offset: -5630 },
  { team: 'B', offset: -3490 },
  { team: 'A', offset:  -940 },
  { team: 'B', offset:   940 },
  { team: 'A', offset:  3940 },
  { team: 'A', offset:  5630 },
  { team: 'B', offset:  5770 },
  { team: 'A', offset:  8230 },
  { team: 'B', offset:  9830 },
];

// ─── Derive absolute positions ──────────────────────────────────────────────

const CENTER_X = FIELD_WIDTH / 2;
const GOAL_A_X = CENTER_X - GOAL_POST_POSITION;
const GOAL_B_X = CENTER_X + GOAL_POST_POSITION;

const players = PLAYER_LAYOUT.map(({ team, offset }) => ({
  x: Math.round(CENTER_X + offset),
  team,
}));

// ─── Assemble config object ─────────────────────────────────────────────────

const config = {
  fieldWidth: FIELD_WIDTH,

  goalposts: {
    a: { x: GOAL_A_X },
    b: { x: GOAL_B_X },
  },

  goalpostHeight: GOALPOST_HEIGHT,

  players,

  playerPointLowHeight:  PLAYER_POINT_LOW_HEIGHT,
  playerPointHighHeight: PLAYER_POINT_HIGH_HEIGHT,
  teamBHeightOffset:     TEAM_B_HEIGHT_OFFSET,

  maxMultiplierHeight: MAX_MULTIPLIER_HEIGHT,
  minMultiplierHeight: MIN_MULTIPLIER_HEIGHT,

  playerModelHeight: PLAYER_MODEL_HEIGHT,
  playerModelWidth:  PLAYER_MODEL_WIDTH,
  playerBaseHeight:  PLAYER_BASE_HEIGHT,
  ballModelDiameter: BALL_MODEL_DIAMETER,
};

// ─── Write output ───────────────────────────────────────────────────────────
// The header block is emitted into the generated file so that any agent or
// developer reading field-config.js directly gets full context without needing
// to find this generator script.

const json = JSON.stringify(config, null, 2);

const header = `\
// Auto-generated by generate-field-config.mjs — do not edit manually.
// Regenerate:  node js/games/fifa-masters/generate-field-config.mjs
//
// ═══════════════════════════════════════════════════════════════════════════════
// STATIC FIELD CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// These values are constant across every game round — they do NOT depend on
// the seed.  They describe the physical layout of the football field and the
// visual dimensions of sprites.
//
// ── Coordinate system ───────────────────────────────────────────────────────
//
//   • x-axis (horizontal):  0 = left edge of field, fieldWidth = right edge.
//     The field center is at fieldWidth / 2 = ${CENTER_X}.
//     Goal A (left) and Goal B (right) are positioned symmetrically around center.
//
//   • y-axis (vertical / altitude):  0 = ground level.
//     Positive y = upward.  Bonuses float between minMultiplierHeight and
//     maxMultiplierHeight.  Players stand at playerBaseHeight; the ball is
//     received/shot from playerPointLowHeight or playerPointHighHeight
//     depending on the shot distance.
//
// ── Field layout (left → right) ─────────────────────────────────────────────
//
//   Goal A ─ KA ─ [players...] ─ center ─ [players...] ─ KB ─ Goal B
//   x=${GOAL_A_X}                       x=${CENTER_X}                       x=${GOAL_B_X}
//
//   Team A kicks right (toward Goal B).
//   Team B kicks left  (toward Goal A).
//   Goal B goal = win,  Goal A goal = crash  (for the player/bettor).
//   Goal B save = crash, Goal A save = win.
//
// ── Property reference ──────────────────────────────────────────────────────
//
//   fieldWidth              Total horizontal extent of the field (world units).
//
//   goalposts.a.x           x-position of the LEFT goalpost (Goal A).
//   goalposts.b.x           x-position of the RIGHT goalpost (Goal B).
//   goalpostHeight          Visual height of the goalpost sprite (world units).
//
//   players[]               12 field players (6 per team), ordered left→right.
//     .x                    Absolute x-position on the field.
//     .team                 'A' or 'B'.
//                           Index in this array is the player's ID used by
//                           stops[].index to reference which player the ball
//                           visits.
//
//   playerPointLowHeight    y at which the ball is received/shot for LONG passes
//                           (horizontal distance > 7000 world units).
//   playerPointHighHeight   y at which the ball is received/shot for SHORT passes
//                           (horizontal distance ≤ 7000 world units).
//   teamBHeightOffset       Extra y added to Team B player receive/shoot heights.
//
//   maxMultiplierHeight     Upper y-bound of the bonus spawn band.
//   minMultiplierHeight     Lower y-bound of the bonus spawn band.
//
//   playerModelHeight       Sprite height of a player (visual only).
//   playerModelWidth        Sprite width of a player (visual only).
//   playerBaseHeight        y-offset of a player sprite above ground (visual only).
//   ballModelDiameter       Diameter of the ball sprite (visual only).
//
// ═══════════════════════════════════════════════════════════════════════════════`;

const code = header + '\n\n' + `export const fieldConfig = ${json};\n`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'field-config.js');
writeFileSync(outPath, code, 'utf-8');
console.log(`field-config.js written → ${outPath}`);
