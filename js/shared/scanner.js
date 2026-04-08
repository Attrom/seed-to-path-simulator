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
  if (filters.minBonuses     != null && s.bonusesCollected  < filters.minBonuses)     return false;
  if (filters.maxBonuses     != null && s.bonusesCollected  > filters.maxBonuses)     return false;
  if (filters.minPosBonuses  != null && s.positiveBonuses   < filters.minPosBonuses)  return false;
  if (filters.maxPosBonuses  != null && s.positiveBonuses   > filters.maxPosBonuses)  return false;
  if (filters.minNegBonuses  != null && s.negativeBonuses   < filters.minNegBonuses)  return false;
  if (filters.maxNegBonuses  != null && s.negativeBonuses   > filters.maxNegBonuses)  return false;
  if (filters.minScorerShots != null && s.scorerShots      < filters.minScorerShots) return false;
  if (filters.maxScorerShots != null && s.scorerShots      > filters.maxScorerShots) return false;
  if (filters.minShots      != null && s.shots            < filters.minShots)     return false;
  if (filters.maxShots      != null && s.shots            > filters.maxShots)     return false;
  return true;
}

/**
 * Scan a range of seeds using the supplied simulateSummary function.
 *
 * @param {Function} simulateSummaryFn  (seed) => summary object
 */
export function scanSeeds(simulateSummaryFn, from, to, filters = {}) {
  const results = [];
  for (let seed = from; seed < to; seed++) {
    const s = simulateSummaryFn(seed);
    if (passesFilters(s, filters)) results.push(s);
  }
  return results;
}

/**
 * Async version that yields to the event loop periodically.
 *
 * @param {Function} simulateSummaryFn  (seed) => summary object
 */
export async function scanSeedsAsync(simulateSummaryFn, from, to, filters = {}, onProgress = null, abortSignal = null) {
  const results = [];
  const total = to - from;
  const BATCH = 500;

  for (let seed = from; seed < to; seed++) {
    if (abortSignal?.aborted) break;

    const s = simulateSummaryFn(seed);
    if (passesFilters(s, filters)) results.push(s);

    if ((seed - from) % BATCH === 0) {
      if (onProgress) onProgress(seed - from, total);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (onProgress) onProgress(total, total);
  return results;
}
