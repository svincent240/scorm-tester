// rate-limiter.js - API rate limiting for security
class ApiRateLimiter {
  constructor(config) {
    this.limits = new Map(); // sessionId -> { calls: number, resetTime: number }
    this.globalLimits = new Map(); // method -> { calls: number, resetTime: number }
    this.config = config;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }

  checkLimit(sessionId, method = 'default') {
    const now = Date.now();
    const sessionLimit = this.config.get('security.rateLimitApiCalls') || 1000;
    const windowMs = this.config.get('security.rateLimitWindowMs') || 60000;

    // Check session-specific limit
    const sessionKey = sessionId;
    const sessionData = this.limits.get(sessionKey);

    if (!sessionData || now > sessionData.resetTime) {
      // Reset or initialize
      this.limits.set(sessionKey, {
        calls: 1,
        resetTime: now + windowMs,
        firstCall: now
      });
      return { allowed: true, remaining: sessionLimit - 1 };
    }

    if (sessionData.calls >= sessionLimit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((sessionData.resetTime - now) / 1000)
      };
    }

    sessionData.calls++;
    return {
      allowed: true,
      remaining: sessionLimit - sessionData.calls
    };
  }

  checkGlobalLimit(method) {
    const now = Date.now();
    const globalLimit = this.config.get('security.rateLimitApiCalls') * 10; // Global limit is 10x session limit
    const windowMs = this.config.get('security.rateLimitWindowMs') || 60000;

    const globalData = this.globalLimits.get(method);

    if (!globalData || now > globalData.resetTime) {
      this.globalLimits.set(method, {
        calls: 1,
        resetTime: now + windowMs
      });
      return { allowed: true, remaining: globalLimit - 1 };
    }

    if (globalData.calls >= globalLimit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((globalData.resetTime - now) / 1000)
      };
    }

    globalData.calls++;
    return {
      allowed: true,
      remaining: globalLimit - globalData.calls
    };
  }

  isAllowed(sessionId, method) {
    // Check both session and global limits
    const sessionCheck = this.checkLimit(sessionId, method);
    const globalCheck = this.checkGlobalLimit(method);

    if (!sessionCheck.allowed) {
      return {
        allowed: false,
        reason: 'session_limit_exceeded',
        retryAfter: sessionCheck.retryAfter
      };
    }

    if (!globalCheck.allowed) {
      return {
        allowed: false,
        reason: 'global_limit_exceeded',
        retryAfter: globalCheck.retryAfter
      };
    }

    return {
      allowed: true,
      sessionRemaining: sessionCheck.remaining,
      globalRemaining: globalCheck.remaining
    };
  }

  cleanup() {
    const now = Date.now();

    // Clean up expired session limits
    for (const [key, data] of this.limits) {
      if (now > data.resetTime) {
        this.limits.delete(key);
      }
    }

    // Clean up expired global limits
    for (const [key, data] of this.globalLimits) {
      if (now > data.resetTime) {
        this.globalLimits.delete(key);
      }
    }
  }

  getStats() {
    return {
      sessionLimits: this.limits.size,
      globalLimits: this.globalLimits.size,
      memoryUsage: (this.limits.size + this.globalLimits.size) * 100 // Rough estimate
    };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.limits.clear();
    this.globalLimits.clear();
  }
}

// Rate limiting middleware for IPC handlers
function withRateLimit(config, monitor) {
  const rateLimiter = new ApiRateLimiter(config);

  return function rateLimitMiddleware(handler, method = 'unknown') {
    return async function(event, sessionId, ...args) {
      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string') {
        monitor.trackSecurityEvent('rate_limit_invalid_session', { method });
        return { success: false, errorCode: '301', error: 'Invalid session ID' };
      }

      // Check rate limits
      const limitCheck = rateLimiter.isAllowed(sessionId, method);
      
      if (!limitCheck.allowed) {
        monitor.trackSecurityEvent('rate_limit_exceeded', {
          sessionId,
          method,
          reason: limitCheck.reason,
          retryAfter: limitCheck.retryAfter
        });

        return {
          success: false,
          errorCode: '301',
          error: 'Rate limit exceeded',
          retryAfter: limitCheck.retryAfter
        };
      }

      // Add rate limit headers to response (for debugging)
      const result = await handler(event, sessionId, ...args);
      
      if (result && typeof result === 'object') {
        result.rateLimitRemaining = limitCheck.sessionRemaining;
      }

      return result;
    };
  };
}

module.exports = {
  ApiRateLimiter,
  withRateLimit
};