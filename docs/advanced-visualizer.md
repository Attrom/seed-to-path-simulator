# Advanced Visualizer — Implementation Documentation

## Overview

The **Advanced View** tab provides a 2D game-style replay of a seed's simulation. Instead of the chart-based path view in the default Visualizer, it renders the football field with PNG sprites for players, ball, and background, and follows the ball with a side-scrolling camera.

All game data comes from `js/games/fifa-masters/core.js`. The renderer (`js/shared/advancedRenderer.js`) reads the simulation result and draws each frame; the playback loop (`js/app.js`, "Advanced Visualizer" section) drives the animation.

---

## Data Source: `core.js`

`simulate(seed)` is the single entry point. It takes an integer seed and returns a fully deterministic result object. The advanced visualizer uses these fields:

### `result.path` — Ball trajectory

An array with one entry per simulation tick (frame). Each entry:

| Field  | Description |
|--------|-------------|
| `dist` | Ball x-position in world units (horizontal axis of the field). |
| `alt`  | Ball altitude in world units (y ≥ 0, 0 = ground). |
| `mult` | Current multiplier at this tick (reflects all bonuses collected so far). |

The renderer reads `path[frame]` each tick to know where the ball is and what multiplier to display.

### `result.missed` — Static field objects

Contains everything that is drawn on the field but is not part of the ball's path:

- **Goalposts**: entries with `marker.shape === 'rect'`. Drawn as white vertical bars at `dist` (their x-position) from ground to `marker.worldHeight`.
- **Players**: entries with `marker.shape === 'capsule'`. Each has:
  - `dist` — player x-position (from `fieldConfig.players[i].x`)
  - `marker.color` — `'#e05858'` for Team A (red), `'#4088e0'` for Team B (blue)
  - `marker.side` — `'left'` (Team A) or `'right'` (Team B), controls whether the sprite is drawn to the left or right of the x-coordinate
  - `marker.baseHeight`, `marker.worldHeight` — vertical bounds for the sprite
- **Uncollected bonuses**: entries with no `marker` and a non-empty `label` (e.g. `'+1'`, `'x2'`, `'x0.5'`). Drawn at `(dist, alt)` in world space.

### `result.collected` — Hit bonuses with timing

Each entry records a bonus the ball collected during flight:

| Field       | Description |
|-------------|-------------|
| `dist, alt` | Position of the bonus (world units). |
| `label`     | Display text (`'+1'`, `'x0.5'`, etc.). |
| `isRocket`  | `true` for negative bonuses (x0.5). |
| `frame`     | The path index (tick number) at which the ball hit this bonus. |
| `multAfter` | The multiplier immediately after collection. |

The renderer compares the current playback frame against `c.frame` to decide if the bonus has been hit yet, and whether to show a brief highlight.

### `result.landed` — Win/loss outcome

`true` if the round is a win (cashout), `false` if it's a crash. Used to color the score panel green/red at the end.

### `result.events` — Discrete labeled moments

Array of `{ label, mult, isLoss }`. The last event's `label` is either `'goal'` or `'saved'`, which the playback loop checks to decide whether to extend the ball path past the goalpost.

### `result.lastShotStartFrame`, `result.lastShotPeakFrame`, `result.lastShotGoalX`

Metadata about the final arc (the shot on goal):

- `lastShotStartFrame` — path index where the final arc begins.
- `lastShotPeakFrame` — path index of the highest point in the final arc.
- `lastShotGoalX` — x-position of the target goalpost.

Used by the playback loop to trigger slow-motion near the goal.

---

## World-to-Pixel Mapping

The field exists in **world units** (the simulation's coordinate system). The advanced view converts to pixels:

```
Scale factor:  10 world units = 1 pixel

Vertical viewport:  700px tall
  Displays world Y range: -980 (bottom) to +6020 (top)
  Total: 7000 world units → 700 pixels

Pixel X = (worldX - cameraLeft) / 10
Pixel Y = (6020 - worldY) / 10
```

The ground (`worldY = 0`) maps to pixel row 602, so most of the viewport is sky where the ball arcs.

The field is 27,100 world units wide → 2,710 pixels. The viewport is the browser window width, typically much narrower, so only a portion of the field is visible at any time.

---

## Camera System

The camera is horizontal-only (vertical range is fixed at -980 to +6020). It follows the ball:

```
viewportWorldWidth = canvasPixelWidth × 10
cameraLeft = ballWorldX - viewportWorldWidth / 2
```

**Clamping**: the camera never shows space outside the field:

```
cameraLeft = clamp(cameraLeft, 0, fieldWidth - viewportWorldWidth)
```

If the viewport is wider than the field (very wide screens), the field is centered.

---

## Rendering Layers (draw order)

Each frame, `renderAdvanced()` draws in this order:

1. **Background** — `BG.png` stretched across the full field width (2,710px) and viewport height (700px). Dark fill drawn outside the field bounds.

2. **Ground line** — subtle white line at `worldY = 0`.

3. **Goalposts** — white vertical bars from ground to goalpost height (2,230 world units). From `result.missed` entries with `marker.shape === 'rect'`.

4. **Players** — PNG sprites (`player_a.png` for Team A, `player_b.png` for Team B). Each sprite is sized using the world model dimensions:
   - Height: `playerModelHeight` (1,350 units → 135px)
   - Width: proportional to the sprite's natural aspect ratio
   - Base: `playerBaseHeight` (240 units → 24px above ground)
   - Positioning uses `marker.side`: Team A sprites extend **left** of their x-coordinate, Team B sprites extend **right** (matching the capsule rendering in the standard visualizer).

5. **Bonuses** — labeled rounded rectangles (32px bold font). All bonuses are drawn at full opacity. Collected bonuses get a brief glow + white border highlight for 40 frames after the ball hits them, then return to normal.

6. **Ball trail** — at high speeds (> 30 world units/tick), 6 ghost images are drawn behind the ball, progressively smaller and more transparent.

7. **Ball** — `Ball.png` drawn at the ball's current position. Diameter: 520 world units → 52px.

8. **Score panel** — `score_panel.png` fixed to viewport top-center (doesn't move with the camera). Displays the current multiplier in white text, turning green on win or red on crash at the end.

9. **End marker** — a football emoji (⚽) for goals, explosion (💥) for saves/crashes, drawn at the ball's final position.

---

## Playback Loop (`app.js`)

### Starting a simulation

`advRun(seed)` calls `activeGame.simulate(seed)` to get the result. If the outcome is a goal (last event label is `'goal'`), it extends the path by continuing the ball's velocity and gravity past the goalpost until altitude reaches 0 — this is a visual-only extension, not part of the core simulation data.

### Frame advancement

`advLoop(timestamp)` runs via `requestAnimationFrame`:

```
ticksPerSecond = 60 × userSpeedMultiplier × slowMotionFactor
accumulator += deltaTime × ticksPerSecond
steps = floor(accumulator)
advFrame += steps
```

The frame index directly indexes into `result.path`. When `advFrame` reaches the end, playback stops and the final state is drawn.

### Slow-motion effect

During the last shot (the arc toward the goalpost), when the ball is within **1,200 world units** of the target goalpost, playback speed is multiplied by **0.35×**. This creates a dramatic slow-down as the ball approaches the goal.

The condition:
```
advFrame >= result.lastShotStartFrame
AND |result.lastShotGoalX - ballX| <= 1200
```

### Scrubber / speed controls

The scrubber maps directly to path frame indices. The speed selector offers 0.25× to 20× multipliers. Both share the same playback infrastructure as the standard Visualizer tab.

---

## PNG Assets

| Asset | File | Usage |
|-------|------|-------|
| Field background | `assets/BG.png` | Stretched across the full field (2,710px × 700px) |
| Team A player | `assets/player_a.png` | Red jersey chibi, faces right |
| Team B player | `assets/player_b.png` | Blue jersey chibi, faces left (pre-flipped asset) |
| Ball | `assets/Ball.png` | Drawn at 52px diameter with motion trail |
| Score panel | `assets/score_panel.png` | HUD element at top-center showing multiplier |

Assets are loaded asynchronously at startup. The loader tries `assets/` first (for the source `index.html`) and falls back to `../assets/` (for the bundled `dist/seed-simulator.html`).

---

## How the Ball Follows the Path

The simulation in `core.js` builds the path by stepping through **arcs between stops**:

1. **Stops** are an ordered sequence of player positions and a final goalpost, determined by the weighted target-selection algorithm in Phase 1.

2. For each consecutive pair of stops, an arc is computed:
   - A random peak height is chosen (seed-dependent).
   - Initial vertical velocity `V` is derived from the peak.
   - Horizontal velocity `vx` and flight duration `T` are computed so the ball lands exactly at the next stop.

3. Each tick of the arc: `ballX += vx`, `ballY += vy`, `vy -= 1` (discrete gravity). The position is pushed to `path[]`.

4. Bonus collision is checked each tick using segment-to-point distance (the movement segment from the previous position to the current position, against each bonus's position, with a 150-unit hit radius).

The advanced visualizer simply indexes into this pre-computed `path[]` array at the current frame number. It does not re-simulate anything — all the physics happened in `core.js`.

---

## How Player Positions Are Determined

Player positions are **static** — defined in `field-config.js` (12 players, 6 per team, fixed x-coordinates). They do not move during a round.

The simulation's `stops[]` array records which players the ball visits and in what order. The advanced view does not animate player movement; players stand at their fixed positions while the ball arcs between them.

Player sprite positioning uses the same `side` convention as the original capsule renderer:
- Team A (`side: 'left'`): sprite drawn with its right edge at the player's x-coordinate
- Team B (`side: 'right'`): sprite drawn with its left edge at the player's x-coordinate
- Goalkeepers (no `side`): centered on the goalpost x-coordinate

---

## How the Multiplier Changes

The multiplier starts at 1.0 and changes when the ball collects a bonus:

1. **Additive bonuses** (`+1`, `+2`, `+5`, `+10`): `mult += add`
2. **Multiplicative bonuses** (`x2`, `x3`): `mult *= factor`
3. **Negative bonuses** (`x0.5`): `mult *= 0.5` (halves the multiplier)

Operations are applied in order: add first, then multiply. The multiplier is clamped to [0, 500].

In the advanced view:
- The **score panel** at the top always shows the current `path[frame].mult` value.
- Each bonus tag on the field shows its label (`+1`, `x2`, `x0.5`).
- When a bonus is collected (current frame ≥ `collected[i].frame`), it gets a brief 40-frame highlight (glow + white border), then returns to its normal appearance.
- At the end of the round, the score panel text turns **green** for a win or **red** for a crash.
