const counters = {
  reads: 0,
  writes: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

let hourlyTimer = null;

/**
 * Increment Firebase read count.
 * @param {number} count Count to add.
 * @returns {void}
 */
function recordRead(count = 1) {
  counters.reads += count;
}

/**
 * Increment Firebase write count.
 * @param {number} count Count to add.
 * @returns {void}
 */
function recordWrite(count = 1) {
  counters.writes += count;
}

/**
 * Increment cache-hit count.
 * @param {number} count Count to add.
 * @returns {void}
 */
function recordCacheHit(count = 1) {
  counters.cacheHits += count;
}

/**
 * Increment cache-miss count.
 * @param {number} count Count to add.
 * @returns {void}
 */
function recordCacheMiss(count = 1) {
  counters.cacheMisses += count;
}

/**
 * Estimate Firebase operation cost for the current window.
 * @returns {{readsCost:number, writesCost:number, totalCost:number, cacheHitRate:number}}
 */
function estimateCost() {
  const readsCost = (counters.reads / 1000000) * 0.06;
  const writesCost = (counters.writes / 1000000) * 1.25;
  const cacheLookups = counters.cacheHits + counters.cacheMisses;
  const cacheHitRate = cacheLookups ? (counters.cacheHits / cacheLookups) * 100 : 0;

  return {
    readsCost,
    writesCost,
    totalCost: readsCost + writesCost,
    cacheHitRate,
  };
}

/**
 * Log the current hourly counters and reset them.
 * @returns {void}
 */
function logAndReset() {
  const estimate = estimateCost();
  console.log(
    `[${new Date().toISOString()}] Hourly: ` +
    `Reads=${counters.reads}, Writes=${counters.writes}, ` +
    `Cache hit=${estimate.cacheHitRate.toFixed(0)}%, ` +
    `Est cost=$${estimate.totalCost.toFixed(4)}`
  );

  counters.reads = 0;
  counters.writes = 0;
  counters.cacheHits = 0;
  counters.cacheMisses = 0;
}

/**
 * Start hourly operation logging.
 * @param {number} intervalMs Logging interval.
 * @returns {NodeJS.Timeout}
 */
function startHourlyLogger(intervalMs = 60 * 60 * 1000) {
  if (hourlyTimer) clearInterval(hourlyTimer);
  hourlyTimer = setInterval(logAndReset, intervalMs);
  hourlyTimer.unref?.();
  return hourlyTimer;
}

module.exports = {
  estimateCost,
  logAndReset,
  recordCacheHit,
  recordCacheMiss,
  recordRead,
  recordWrite,
  startHourlyLogger,
};
