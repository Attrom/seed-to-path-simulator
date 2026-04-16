/**
 * FIFA Masters — app-facing simulation wrapper.
 *
 * Imports the core algorithm from core.js and enriches its output with
 * rendering markers (the `missed` array) used by this app's visualizers.
 *
 * Other game clients should import core.js directly instead — it provides
 * all game-logic data without rendering concerns.
 */

import * as core          from './core.js';
import { fieldConfig }    from './field-config.js';

export const gameInfo = {
  id: 'fifa-masters',
  name: 'FIFA Masters',
};

export const simulateSummary = core.simulateSummary;

// ─── Full simulation with rendering markers ──────────────────────────────────

export function simulate(seed) {
  const result = core.simulate(seed);

  const {
    goalposts,
    players,
    goalpostHeight,
    playerModelHeight,
    playerModelWidth,
    playerBaseHeight,
    teamBHeightOffset,
  } = fieldConfig;

  // Build the `missed` array consumed by renderer.js / advancedRenderer.js.
  // Contains uncollected bonuses and static field markers.
  const missed = [];

  for (const b of result.bonuses) {
    if (!b.collected) {
      missed.push({ dist: b.x, alt: b.y, label: b.label, isRocket: b.mult < 1 });
    }
  }

  // Goalposts
  missed.push({
    dist: goalposts.a.x, alt: 0, label: '', isRocket: false,
    marker: { shape: 'rect', color: '#ffffff', opacity: 0.6, worldHeight: goalpostHeight },
  });
  missed.push({
    dist: goalposts.b.x, alt: 0, label: '', isRocket: false,
    marker: { shape: 'rect', color: '#ffffff', opacity: 0.6, worldHeight: goalpostHeight },
  });

  // Field players
  for (const p of players) {
    const base = p.team === 'B'
      ? playerBaseHeight + teamBHeightOffset
      : playerBaseHeight;
    missed.push({
      dist: p.x, alt: 0, label: p.team, isRocket: false,
      marker: {
        shape: 'capsule', color: p.team === 'A' ? '#e05858' : '#4088e0',
        opacity: 0.75, worldHeight: playerModelHeight,
        worldWidth: playerModelWidth, baseHeight: base,
        side: p.team === 'A' ? 'left' : 'right',
      },
    });
  }

  // Goalkeepers
  missed.push({
    dist: goalposts.a.x, alt: 0, label: 'GK', isRocket: false,
    marker: {
      shape: 'capsule', color: '#e05858', outline: '#fff',
      opacity: 0.85, worldHeight: playerModelHeight,
      worldWidth: playerModelWidth, baseHeight: playerBaseHeight,
    },
  });
  missed.push({
    dist: goalposts.b.x, alt: 0, label: 'GK', isRocket: false,
    marker: {
      shape: 'capsule', color: '#4088e0', outline: '#fff',
      opacity: 0.85, worldHeight: playerModelHeight,
      worldWidth: playerModelWidth, baseHeight: playerBaseHeight,
    },
  });

  return { ...result, missed };
}
