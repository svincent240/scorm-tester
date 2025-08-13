// IPC wrapper factory (surgical scaffold)
// Provides declarative route wrapping for IpcHandler

const Singleflight = require('../../../shared/utils/singleflight');
const IPC_RESULT = require('../../../shared/utils/ipc-result');
const IPC_VALIDATION = require('../../../shared/utils/ipc-validation');

// Critical channels that should default to the ipc-result envelope
const DEFAULT_ENVELOPE_CHANNELS = new Set([
  'scorm-initialize',
  'scorm-get-value',
  'scorm-set-value',
  'scorm-commit',
  'scorm-terminate',
  'select-scorm-package',
  'select-scorm-folder',
  'extract-scorm',
  'save-temporary-file',
  'find-scorm-entry',
  'get-course-info',
  'get-course-manifest',
  'path-to-file-url',
  'resolve-scorm-url'
]);

// Debounce state per channel (channel -> { timer, pending })
const debounceState = new Map();

module.exports = {
  createWrappedHandler(route, ctx) {
    if (!route || !route.channel) {
      return async (event, ...args) => IPC_RESULT.success(null);
    }

    const channel = route.channel;
    const handlerName = route.handlerName;
    
    // Resolve the actual per-channel handler on the context
    // Check both own properties and prototype chain
    const actualHandler = (typeof ctx[handlerName] === 'function')
      ? ctx[handlerName].bind(ctx)
      : null;

    if (!actualHandler) {
      // Log available methods for debugging
      const availableMethods = [];
      for (const name in ctx) {
        if (typeof ctx[name] === 'function') {
          availableMethods.push(name);
        }
      }
      ctx?.logger?.error(`wrapper-factory: handler not found: ${handlerName} for channel ${channel}. Available: ${availableMethods.slice(0, 10).join(', ')}`);
      
      // Return a function that produces an error result
      return async (event, ...args) => {
        return IPC_RESULT.failure('handler_not_found', `Handler ${handlerName} not found for channel ${channel}`);
      };
    }

    // Prepare a lightweight singleflight wrapper if requested
    let singleflightFn = null;
    try {
      if (route.options && route.options.singleFlight) {
        singleflightFn = (typeof Singleflight === 'function') ? Singleflight() : null;
      }
    } catch (_) {
      singleflightFn = null;
    }

    // Capture debounceMs option (optional trailing execution)
    const debounceMs = route.options && route.options.debounceMs ? Number(route.options.debounceMs) : 0;

    return async (event, ...args) => {
      ctx.requestCounter = (ctx.requestCounter || 0) + 1;
      const requestId = ctx.requestCounter;
      const startTime = Date.now();

      // Determine whether to use ipc-result envelope: explicit option OR default for critical channels
      const useIpcResult = (route.options && route.options.useIpcResult) || DEFAULT_ENVELOPE_CHANNELS.has(channel);
      const wrapResult = (payload) => {
        if (useIpcResult) {
          return IPC_RESULT.success(payload);
        }
        return payload;
      };
  
      const wrapFailure = (code, message, details) => {
        if (useIpcResult) {
          return IPC_RESULT.failure(code, message, details);
        }
        return { success: false, code, message, details };
      };

      try {
        // Per-route validation: use shared IPC_VALIDATION when route requests validateArgs,
        // otherwise fall back to ctx.validateRequest if present.
        if (route.options && route.options.validateArgs) {
          const valid = IPC_VALIDATION.validateRequest(event, channel, args);
          if (!valid) {
            ctx.logger?.warn(`wrapper-factory: route validation failed for ${channel}`);
            return wrapFailure('validation_failed', 'Request validation failed (route)', { channel, argsLength: (args || []).length });
          }
        } else if (typeof ctx.validateRequest === 'function') {
          const valid = ctx.validateRequest(event, channel, args);
          if (!valid) {
            ctx.logger?.warn(`wrapper-factory: validation failed for ${channel}`);
            return wrapFailure('validation_failed', 'Request validation failed', { channel, argsLength: (args || []).length });
          }
        }

        // Rate limiting (if provided)
        if (ctx.rateLimiter && typeof ctx.rateLimiter.allow === 'function') {
          const profile = route.options && route.options.rateLimitProfile
            ? route.options.rateLimitProfile
            : 'default';
          try {
            // Pass runtime scormService to limiter to allow grace windows
            const scormService = typeof ctx.getDependency === 'function' ? ctx.getDependency('scormService') : null;
            const allowed = ctx.rateLimiter.allow(event.sender, channel, { scormService, profile, context: { route } });
            if (!allowed) {
              const profileDef = ctx.rateLimiter && ctx.rateLimiter.profiles ? ctx.rateLimiter.profiles[profile] : null;
              // softDrop behavior: preserve compatibility by returning soft-ok when profile requests it
              if (profileDef && profileDef.softDropOnLimit) {
                ctx.logger?.info(`IPC rate-limited (soft) ${channel} for sender ${((event || {}).sender && event.sender.id) || 'unknown'}`);
                if (typeof ctx.recordOperation === 'function') ctx.recordOperation(`${channel}:rate_limited_soft_ok`, true);
                return wrapResult({ rateLimited: true, softDrop: true });
              }
              // Hard reject
              ctx.logger?.info(`IPC rate-limited ${channel} for sender ${((event || {}).sender && event.sender.id) || 'unknown'}`);
              if (typeof ctx.recordOperation === 'function') ctx.recordOperation(`${channel}:rate_limited`, false);
              return wrapFailure('rate_limited', 'Rate limit exceeded', { channel, profile });
            }
          } catch (e) {
            // If limiter errors, proceed to avoid hard failures (log for observability)
            ctx.logger?.warn(`wrapper-factory: rateLimiter.allow failed for ${channel}: ${e?.message || e}`);
          }
        }

        // Debounce handling (channel-level trailing execution). If debounceMs set, coalesce calls and guarantee trailing execution.
        if (debounceMs > 0) {
          const key = `${channel}:debounce`;
          let state = debounceState.get(key);
          if (!state) {
            state = { timer: null, pending: false };
            debounceState.set(key, state);
          }

          // If a timer is already scheduled, mark pending and refresh timer
          if (state.timer) {
            state.pending = true;
            clearTimeout(state.timer);
            state.timer = setTimeout(async () => {
              state.timer = null;
              const sfKey = `${channel}:debounce:trailing`;
              try {
                const callActual = async () => actualHandler(event, ...args);
                if (singleflightFn) {
                  await singleflightFn(sfKey, callActual);
                } else {
                  await callActual();
                }
                if (typeof ctx.recordOperation === 'function') ctx.recordOperation(`${channel}:debounce_trailing`, true);
              } catch (e) {
                ctx.logger?.warn(`wrapper-factory: debounce trailing call for ${channel} failed: ${e?.message || e}`);
              } finally {
                state.pending = false;
              }
            }, debounceMs);
            // Return deferred/coalesced response to caller
            if (typeof ctx.recordOperation === 'function') ctx.recordOperation(`${channel}:debounced_call_coalesced`, true);
            return wrapResult({ coalesced: true, deferred: true });
          } else {
            // No timer yet: schedule trailing execution and return deferred immediately.
            state.pending = false;
            state.timer = setTimeout(async () => {
              state.timer = null;
              const sfKey = `${channel}:debounce:trailing`;
              try {
                const callActual = async () => actualHandler(event, ...args);
                if (singleflightFn) {
                  await singleflightFn(sfKey, callActual);
                } else {
                  await callActual();
                }
                if (typeof ctx.recordOperation === 'function') ctx.recordOperation(`${channel}:debounce_trailing`, true);
              } catch (e) {
                ctx.logger?.warn(`wrapper-factory: debounce trailing call for ${channel} failed: ${e?.message || e}`);
              } finally {
                state.pending = false;
              }
            }, debounceMs);
            if (typeof ctx.recordOperation === 'function') ctx.recordOperation(`${channel}:debounced_call_scheduled`, true);
            return wrapResult({ coalesced: true, deferred: true });
          }
        }

        // Normal invocation path (with optional singleflight)
        const callActual = async () => actualHandler(event, ...args);
        let result;
        if (singleflightFn && route.options && route.options.singleFlight) {
          const senderId = (event && event.sender && event.sender.id) || 'unknown';
          const key = `${channel}:${senderId}`;
          result = await singleflightFn(key, callActual);
        } else {
          result = await callActual();
        }

        const duration = Date.now() - startTime;
        ctx.logger?.info(`IPC_ENVELOPE { channel: ${channel}, requestId: ${requestId}, durationMs: ${duration}, status: 'success' }`);
        if (typeof ctx.recordOperation === 'function') {
          ctx.recordOperation(`${channel}:success`, true);
        }

        // Optionally use ipc-result envelope
        return wrapResult(result);
      } catch (error) {
        const duration = Date.now() - startTime;
        ctx.logger?.error(`IPC_ENVELOPE { channel: ${channel}, requestId: ${requestId}, durationMs: ${duration}, status: 'error', error: ${error?.message || 'unknown'} }`);
        if (typeof ctx.recordOperation === 'function') {
          ctx.recordOperation(`${channel}:error`, false);
        }

        // Return a failure envelope if requested, otherwise throw to let upstream handling decide
        if (route.options && route.options.useIpcResult) {
          return IPC_RESULT.failure(error.code || 'IPC_HANDLER_ERROR', error.message || 'Handler error', { channel, requestId });
        }

        // Preserve prior behavior by rethrowing so IpcHandler.wrapHandler can handle the error path
        throw error;
      } finally {
        // placeholder for potential cleanup
      }
    };
  }
};