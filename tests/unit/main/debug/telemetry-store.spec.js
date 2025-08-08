const assert = require('assert');
const DebugTelemetryStore = require('../../../../src/main/services/debug/debug-telemetry-store');

describe('DebugTelemetryStore', function() {
  it('trims old entries when exceeding maxSize', function() {
    const logs = [];
    const logger = {
      warn: (...args) => logs.push(['warn', ...args]),
      info: () => {},
      debug: () => {}
    };
    const store = new DebugTelemetryStore({ maxSize: 3, logger });
    store.storeApiCall({ id: 1 });
    store.storeApiCall({ id: 2 });
    store.storeApiCall({ id: 3 });
    assert.strictEqual(store.getHistory().length, 3);
    store.storeApiCall({ id: 4 });
    const hist = store.getHistory();
    assert.strictEqual(hist.length, 3);
    assert.deepStrictEqual(hist.map(h => h.id), [2, 3, 4]);
    const warned = logs.find(l => l[0] === 'warn');
    assert.ok(warned, 'warn logged when trimming');
  });

  it('flushTo sends all entries to webContents using debug-event-received', function() {
    const sent = [];
    const fakeWC = { send: (channel, eventType, entry) => sent.push({ channel, eventType, entry }) };
    const logger = { info: () => {}, warn: () => {}, debug: () => {} };
    const store = new DebugTelemetryStore({ maxSize: 10, logger });
    store.storeApiCall({ foo: 'a' });
    store.storeApiCall({ foo: 'b' });
    store.flushTo(fakeWC);
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[0].channel, 'debug-event-received');
    assert.strictEqual(sent[0].eventType, 'api:call');
    assert.deepStrictEqual(sent.map(s => s.entry.foo), ['a', 'b']);
  });

  it('flushTo handles invalid webContents gracefully', function() {
    const logs = [];
    const logger = { warn: (...args) => logs.push(args), info: () => {}, debug: () => {} };
    const store = new DebugTelemetryStore({ logger });
    store.storeApiCall({ x: 1 });
    store.flushTo(null);
    assert.strictEqual(logs.length > 0, true);
  });
});