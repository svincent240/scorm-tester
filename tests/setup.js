/**
 * Global test setup utilities
 * - Seeded RNG helpers
 * - Temp directory helpers
 * - Logger test sink helpers
 * - Fake timer utilities
 *
 * Notes:
 * - Renderer console must not be used. Tests should route logs via shared logger or a sink.
 * - Keep utilities deterministic and side-effect free where possible.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// -------------------- Seeded RNG --------------------

/**
 * Create a deterministic pseudo-random number generator (LCG).
 * @param {number} seed
 */
function createSeededRng(seed = 123456789) {
  let s = seed >>> 0;
  return function next() {
    // LCG parameters (Numerical Recipes)
    s = (1664525 * s + 1013904223) >>> 0;
    // Convert to [0,1)
    return s / 0xffffffff;
  };
}

// -------------------- Temp Directory Helpers --------------------

/**
 * Create a unique temp directory for a test and return its path.
 * Caller should clean up when appropriate.
 * @param {string} prefix
 */
function makeTempDir(prefix = 'scorm-tester-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

/**
 * Recursively delete a directory (best-effort).
 * @param {string} dir
 */
function rimraf(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      rimraf(full);
    } else {
      try { fs.unlinkSync(full); } catch (_) { /* intentionally empty */ }
    }
  }
  try { fs.rmdirSync(dir); } catch (_) { /* intentionally empty */ }
}

// -------------------- Logger Test Sink --------------------

/**
 * Create a simple in-memory logger sink compatible with the shared logger shape.
 * Tests can assert on captured entries without using console in renderer.
 */
function createLoggerSink() {
  const entries = [];
  const sink = {
    info: (msg, meta) => entries.push({ level: 'info', msg, meta: meta ?? null, ts: Date.now() }),
    warn: (msg, meta) => entries.push({ level: 'warn', msg, meta: meta ?? null, ts: Date.now() }),
    error: (msg, meta) => entries.push({ level: 'error', msg, meta: meta ?? null, ts: Date.now() }),
    debug: (msg, meta) => entries.push({ level: 'debug', msg, meta: meta ?? null, ts: Date.now() }),
    entries,
    clear: () => { entries.length = 0; }
  };
  return sink;
}

// -------------------- Fake Timer Utilities --------------------

/**
 * Jest fake timers wrapper with sane defaults.
 * Consumers can advance timers deterministically.
 */
function useFakeTimers(jestRef) {
  jestRef.useFakeTimers();
  return {
    advance(ms) { jestRef.advanceTimersByTime(ms); },
    runAll() { jestRef.runAllTimers(); },
    useReal() { jestRef.useRealTimers(); }
  };
}

/**
 * Create a mock session manager used by RTE tests.
 * Minimal surface to satisfy tests expecting Initialize/Terminate and state flags.
 */
function createMockSessionManager() {
  let initialized = false;
  let terminated = false;
  return {
    get initialized() { return initialized; },
    get terminated() { return terminated; },
    markInitialized() { initialized = true; },
    markTerminated() { terminated = true; },
    reset() { initialized = false; terminated = false; }
  };
}

// -------------------- Exports and Jest Globals --------------------

// Back-compat: many tests reference global.testUtils and expect createMockLogger().
// Expose both global.__testUtils (new) and global.testUtils (legacy alias).
const __testUtils = {
  createSeededRng,
  makeTempDir,
  rimraf,
  createLoggerSink,
  useFakeTimers,
  createMockSessionManager, // ensure available to all tests
  // Shim expected by older tests: produce a mock logger compatible with shared logger shape.
  createMockLogger() {
    const sink = createLoggerSink();
    // Provide logFile property as some tests assert presence/path (non-functional in-memory).
    return {
      logFile: '/tmp/test/scorm-tester.log',
      info: sink.info,
      warn: sink.warn,
      error: sink.error,
      debug: sink.debug,
      entries: sink.entries,
      clear: sink.clear
    };
  }
};

global.__testUtils = __testUtils;
// Legacy alias
global.testUtils = __testUtils;

module.exports = {
  ...__testUtils
};