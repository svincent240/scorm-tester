/**
 * Tiny singleflight utility to coalesce concurrent identical calls.
 * createSingleflight() returns a function (key, fn) that ensures only one in-flight promise per key.
 * Additional trailing debounce not implemented here; the wrapper handles 500ms debounce separately if needed later.
 */
function createSingleflight() {
  const inFlight = new Map();
  return async function(key, fn) {
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }
    const p = (async () => {
      try {
        return await Promise.resolve(fn());
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, p);
    return p;
  };
}
module.exports = createSingleflight;