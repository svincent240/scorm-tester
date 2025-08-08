"use strict";

/**
 * Token bucket rate limiter for IPC channels, scoped per sender.
 * - Per-sender buckets track timestamps of recent calls.
 * - Named profiles provide sensible defaults (configurable).
 * - Exempts a set of SN channels from rate limiting.
 * - Provides a lightweight SCORM grace window for scorm-get-value after Initialize.
 */
class TokenBucketRateLimiter {
  constructor(config = {}) {
    // Defaults; allow overrides via config
    this.config = {
      rateLimitWindow: 1000, // ms
      rateLimitMax: 20,      // max calls per window
      ...config
    };

    // Optional per-sender buckets: { senderId: [timestamp,...] }
    this.buckets = new Map();

    // Profiles mapping (future-proofing)
    this.profiles = {
      default: { windowMs: 1000, max: 20 },
      rendererLogs: { windowMs: 1000, max: 100, softDropOnLimit: true },
      snBypass: null, // no limits
      uiSparse: { windowMs: 1000, max: 3 }
    };
  }

  _now() {
    return Date.now();
  }

  _isSnBypassChannel(channel) {
    return (
      channel === 'sn:getStatus' ||
      channel === 'sn:processNavigation' ||
      channel === 'sn:initialize' ||
      channel === 'sn:updateActivityProgress' ||
      channel === 'sn:reset'
    );
  }

  /**
   * Determine whether the caller is allowed to proceed for a given channel.
   * ctx may include runtime dependencies (e.g., scormService) and options.profile to support profile-based limits.
   */
  allow(sender, channel = null, ctx = {}) {
    // 1) Bypass for SN channels per policy (explicit check still respected)
    if (this._isSnBypassChannel(channel)) {
      return true;
    }

    const now = this._now();

    // 2) SCORM grace window for scorm-get-value after Initialize (preserve previous behavior)
    try {
      if (channel === 'scorm-get-value') {
        const scormService = ctx?.scormService;
        if (scormService && typeof scormService.getAllSessions === 'function') {
          const sessions = scormService.getAllSessions();
          for (const s of sessions || []) {
            const started = s && s.startTime ? new Date(s.startTime).getTime() : 0;
            if (started && (now - started) <= 750) {
              // Allow early bursts during startup for scorm-get-value only
              return true;
            }
          }
        }
      }
    } catch (_) {
      // If anything fails, fall back to limiter rules
    }

    // 3) Resolve rate limit profile
    const profileName = (ctx && ctx.profile) ? String(ctx.profile) : 'default';
    let profileDef = null;
    if (this.profiles && Object.prototype.hasOwnProperty.call(this.profiles, profileName)) {
      profileDef = this.profiles[profileName];
    } else {
      profileDef = this.profiles && this.profiles.default ? this.profiles.default : { windowMs: this.config.rateLimitWindow, max: this.config.rateLimitMax };
    }

    // If profileDef is null, it signals "no limit" (e.g., snBypass profile)
    if (profileDef === null) {
      return true;
    }

    const windowMs = Number(profileDef.windowMs || this.config.rateLimitWindow || 1000);
    const max = Object.prototype.hasOwnProperty.call(profileDef, 'max') ? Number(profileDef.max) : Number(this.config.rateLimitMax || 20);
    const softDrop = !!profileDef.softDropOnLimit;

    // Use a key scoped by sender + channel + profile to avoid cross-channel interference
    const senderId = (sender && sender.id) ? sender.id : 'unknown';
    const key = `${senderId}::${channel || 'unknown'}::${profileName}`;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }

    // Prune old entries outside the profile window
    const windowStart = now - windowMs;
    while (bucket.length && bucket[0] < windowStart) {
      bucket.shift();
    }

    // Check limit
    this.logger?.debug(`RateLimiter: Checking limit for key=${key}, bucket.length=${bucket.length}, max=${max}`);
    if (bucket.length >= max) {
      // Exceeded: return false; wrapper/further callers may inspect profileDef.softDropOnLimit to determine soft drop behavior
      // Log a more informative message for diagnostics
      if (this._logger) {
        try { this._logger.info && this._logger.info(`RateLimiter: limit hit (profile=${profileName}) channel=${channel} sender=${senderId}`); } catch (_) {}
      }
      return false;
    }

    // Allow and push timestamp
    bucket.push(now);
    return true;
  }
}

module.exports = TokenBucketRateLimiter;