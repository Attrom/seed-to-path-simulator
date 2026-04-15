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
  if (filters.minPosBonuses  != null && s.positiveBonuses   < filters.minPosBonuses)  return false;
  if (filters.maxPosBonuses  != null && s.positiveBonuses   > filters.maxPosBonuses)  return false;
  if (filters.minNegBonuses  != null && s.negativeBonuses   < filters.minNegBonuses)  return false;
  if (filters.maxNegBonuses  != null && s.negativeBonuses   > filters.maxNegBonuses)  return false;
  if (filters.minTotalShots != null && s.totalShots        < filters.minTotalShots) return false;
  if (filters.maxTotalShots != null && s.totalShots        > filters.maxTotalShots) return false;
  if (filters.minShotsA    != null && s.shotsA            < filters.minShotsA)    return false;
  if (filters.maxShotsA    != null && s.shotsA            > filters.maxShotsA)    return false;
  if (filters.minShotsB    != null && s.shotsB            < filters.minShotsB)    return false;
  if (filters.maxShotsB    != null && s.shotsB            > filters.maxShotsB)    return false;
  if (filters.minDirChanges != null && s.dirChanges        < filters.minDirChanges) return false;
  if (filters.maxDirChanges != null && s.dirChanges        > filters.maxDirChanges) return false;
  if (filters.minShots      != null && s.shots            < filters.minShots)     return false;
  if (filters.maxShots      != null && s.shots            > filters.maxShots)     return false;
  if (filters.startTeam && s.startTeam !== filters.startTeam) return false;
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

/**
 * Scan seeds 0..maxSeed, collecting up to `limit` matches per filter set.
 * Yields to the event loop periodically. Returns early once limit is reached.
 */
export async function scanUntilLimit(simulateSummaryFn, filters, limit, onProgress = null, abortSignal = null) {
  const results = [];
  const maxSeed = 4294967296;
  const BATCH = 500;

  for (let seed = 0; seed < maxSeed; seed++) {
    if (abortSignal?.aborted) break;
    if (results.length >= limit) break;

    const s = simulateSummaryFn(seed);
    if (passesFilters(s, filters)) results.push(s);

    if (seed % BATCH === 0) {
      if (onProgress) onProgress(seed, results.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  return results;
}
