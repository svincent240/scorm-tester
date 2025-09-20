import { ScormClient } from '../../../src/renderer/services/scorm-client.js';

/**
 * IPC shaping unit test for renderer SCORM client
 * - Batching of SetValue to scormSetValuesBatch
 * - Debouncing of Commit to scormCommit
 */

describe('ScormClient IPC shaping', () => {
  beforeEach(() => {
    jest.useRealTimers();
    global.window = {
      electronAPI: {
        scormSetValuesBatch: jest.fn().mockResolvedValue({ success: true }),
        scormCommit: jest.fn().mockResolvedValue({ success: true })
      }
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    delete global.window;
  });

  test('SetValue flood is batched into a small number of IPC calls', async () => {
    const client = new ScormClient();
    client.sessionId = 's1';
    client.isInitialized = true;

    // Flood 100 SetValue calls rapidly
    for (let i = 0; i < 100; i++) {
      client.SetValue(`cmi.objectives.${i}.score.raw`, String(i));
    }

    // Allow batch timer to flush
    await new Promise((r) => setTimeout(r, 60));

    // Expect far fewer IPC batch calls than SetValue invocations (batch size 25, delay 20ms)
    const callCount = window.electronAPI.scormSetValuesBatch.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThanOrEqual(8); // 100 items with size 25 -> ~4 calls; allow slack
  });

  test('Commit calls are debounced under burst', async () => {
    const client = new ScormClient();
    client.sessionId = 's1';
    client.isInitialized = true;

    // Burst of Commit calls within debounce window (250ms)
    for (let i = 0; i < 10; i++) {
      client.Commit('');
    }

    // Wait slightly more than debounce interval
    await new Promise((r) => setTimeout(r, 300));

    // Expect only a single IPC commit
    expect(window.electronAPI.scormCommit).toHaveBeenCalledTimes(1);
  });
});

