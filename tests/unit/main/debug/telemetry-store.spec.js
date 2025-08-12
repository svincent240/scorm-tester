const assert = require('assert');
const ScormInspectorTelemetryStore = require('../../../../src/main/services/scorm-inspector/scorm-inspector-telemetry-store');

describe('ScormInspectorTelemetryStore', function() {
  it('trims old entries when exceeding maxHistorySize', function() {
    const logs = [];
    const logger = {
      warn: (...args) => logs.push(['warn', ...args]),
      info: () => {},
      debug: () => {}
    };
    const store = new ScormInspectorTelemetryStore({ 
      maxHistorySize: 3, 
      enableBroadcast: false,
      logger 
    });
    store.storeApiCall({ id: 1 });
    store.storeApiCall({ id: 2 });
    store.storeApiCall({ id: 3 });
    assert.strictEqual(store.getHistory().history.length, 3);
    store.storeApiCall({ id: 4 });
    const hist = store.getHistory().history;
    assert.strictEqual(hist.length, 3);
    assert.deepStrictEqual(hist.map(h => h.id), [4, 3, 2]); // Order is newest-first now
    const warned = logs.find(l => l[0] === 'warn');
    assert.ok(warned, 'warn logged when trimming');
  });

  it('flushTo sends all entries to webContents using scorm-inspector-data-updated', function() {
    const sent = [];
    const fakeWC = { send: (channel, entry) => sent.push({ channel, entry }) };
    const logger = { info: () => {}, warn: () => {}, debug: () => {} };
    const store = new ScormInspectorTelemetryStore({ 
      maxHistorySize: 10, 
      enableBroadcast: false,
      logger 
    });
    store.storeApiCall({ foo: 'a' });
    store.storeApiCall({ foo: 'b' });
    store.flushTo(fakeWC);
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[0].channel, 'scorm-inspector-data-updated');
    assert.deepStrictEqual(sent.map(s => s.entry.foo), ['b', 'a']); // Order is newest-first
  });

  it('flushTo handles invalid webContents gracefully', function() {
    const logs = [];
    const logger = { warn: (...args) => logs.push(args), info: () => {}, debug: () => {} };
    const store = new ScormInspectorTelemetryStore({ 
      enableBroadcast: false,
      logger 
    });
    store.storeApiCall({ x: 1 });
    store.flushTo(null);
    assert.strictEqual(logs.length > 0, true);
  });
});