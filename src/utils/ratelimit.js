// ─── In-memory rate limiter (no external dependencies) ──────────────────────
// Used for both Discord interactions and HTTP API requests.
// Tracks hits per key (userId or IP) within a sliding window.

class RateLimiter {
  /**
   * @param {number} maxHits   — max allowed hits within the window
   * @param {number} windowMs  — time window in milliseconds
   */
  constructor(maxHits, windowMs) {
    this.maxHits = maxHits;
    this.windowMs = windowMs;
    this.hits = new Map(); // key → [timestamp, ...]

    // Garbage-collect expired entries every 60s to prevent memory leaks
    this._gcTimer = setInterval(() => this._gc(), 60_000);
    if (this._gcTimer.unref) this._gcTimer.unref();
  }

  /**
   * Check if a key is rate-limited. If not, records the hit.
   * @param {string} key
   * @returns {boolean} true if BLOCKED (over limit), false if allowed
   */
  isLimited(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxHits) {
      return true; // blocked
    }

    timestamps.push(now);
    return false; // allowed
  }

  /** How many seconds until the next slot opens (for Retry-After headers). */
  retryAfterSec(key) {
    const timestamps = this.hits.get(key);
    if (!timestamps || !timestamps.length) return 0;
    const oldest = timestamps[0];
    const freeAt = oldest + this.windowMs;
    return Math.max(0, Math.ceil((freeAt - Date.now()) / 1000));
  }

  _gc() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, ts] of this.hits) {
      while (ts.length && ts[0] <= cutoff) ts.shift();
      if (!ts.length) this.hits.delete(key);
    }
  }
}

module.exports = { RateLimiter };
