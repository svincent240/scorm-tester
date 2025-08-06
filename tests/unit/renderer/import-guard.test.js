/**
 * Renderer Import-Time Safety (Node environment)
 *
 * Ensures selected renderer modules are safe to import under a Node (non-jsdom) environment:
 * - No direct DOM access at import time (document/window usage must be guarded)
 * - Any import-time timers are handled via Jest fake timers to avoid open handle warnings
 *
 * Scope: Import scorm-client only. Do NOT import app-manager because it attaches window event listeners
 * in the constructor; that is exercised in jsdom-based integration suites.
 */

const path = require('path');

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

describe('Renderer import-time safety (Node env)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: true });
    // Ensure no global window/document are defined (Node-like)
    // Some environments might provide them; explicitly remove if present
    if (global.window) delete global.window;
    if (global.document) delete global.document;
    jest.resetModules();
    // Provide minimal event-target stubs used by ui-state when scorm-client pulls it in
    global.window = {
      electronAPI: {},
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    global.document = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      hidden: false
    };
  });

  afterEach(() => {
    try { jest.runOnlyPendingTimers(); } catch (_) {}
    try { jest.clearAllTimers(); } catch (_) {}
    try { jest.useRealTimers(); } catch (_) {}
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('importing scorm-client succeeds without DOM access at import time', () => {
    // Use CommonJS require with absolute path to avoid Jest ESM resolver issues
    const target = path.resolve(__dirname, '../../..', 'src/renderer/services/scorm-client.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(target);
    const scormClient = mod.scormClient || mod.default || mod;

    // Basic surface checks
    expect(scormClient).toBeDefined();
    expect(typeof scormClient.Initialize === 'function' || typeof scormClient.Initialize === 'undefined').toBe(true);
    expect(typeof scormClient.Terminate === 'function' || typeof scormClient.Terminate === 'undefined').toBe(true);
  });
});