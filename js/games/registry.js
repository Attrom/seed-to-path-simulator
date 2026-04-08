import * as fifaMasters from './fifa-masters/simulation.js';

const games = [
  fifaMasters,
];

const gameMap = Object.fromEntries(games.map(g => [g.gameInfo.id, g]));

export function listGames() {
  return games.map(g => g.gameInfo);
}

export function getGame(id) {
  return gameMap[id] ?? games[0];
}
