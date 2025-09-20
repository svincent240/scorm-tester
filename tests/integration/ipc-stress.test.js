/**
 * @jest-environment jsdom
 */

// IPC stress test to validate client-side batching and commit debouncing
// Ensures no reliance on server-side rate limiting

describe('IPC Stress: client-side shaping', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: true });
    // Provide a minimal electronAPI before importing scorm-client
    window.electronAPI = {
      rendererBaseUrl: 'scorm-app://app/src/renderer/',
      scormInitialize: jest.fn().mockResolvedValue({ success: true }),
      scormSetValuesBatch: jest.fn().mockResolvedValue({ success: true, results: [] }),
      scormCommit: jest.fn().mockResolvedValue({ success: true }),
      scormTerminate: jest.fn().mockResolvedValue({ success: true })
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    // Clean up for next test
    delete window.electronAPI;
  });

  test('SetValue bursts are batched; Commit bursts are debounced', async () => {
    const mod = await import('../../src/renderer/services/scorm-client.js');
    const scormClient = mod.scormClient || mod.default || mod;

    // Provide minimal UI state so Initialize() can update session
    const uiStateMock = {
      updateSession: jest.fn(),
      updateProgress: jest.fn(),
      addApiCall: jest.fn(),
      getState: jest.fn().mockReturnValue(null)
    };
    scormClient.setUiState(uiStateMock);


    // Initialize session
    expect(scormClient.Initialize('sess-1')).toBe('true');

    // Fire 100 rapid SetValue calls
    for (let i = 0; i < 100; i++) {
      scormClient.SetValue(`cmi.interactions.${i}.learner_response`, 'x');
    }

    // Allow batching window to flush
    jest.advanceTimersByTime(50);

    // With BATCH_MAX_SIZE=25, 100 ops should yield ~4 batch calls
    expect(window.electronAPI.scormSetValuesBatch).toHaveBeenCalled();
    const calls = window.electronAPI.scormSetValuesBatch.mock.calls;
    const totalOps = calls.reduce((sum, args) => {
      const batch = Array.isArray(args[1]) ? args[1] : (Array.isArray(args[2]) ? args[2] : []);
      return sum + batch.length;
    }, 0);
    expect(totalOps).toBe(100);

    // Optional: expect around 4 calls; allow 3-5 to avoid timing brittleness
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.length).toBeLessThanOrEqual(5);

    // Now trigger commit bursts
    for (let j = 0; j < 10; j++) {
      scormClient.Commit('');
    }

    // Debounce is 250ms; advance and expect only one commit
    jest.advanceTimersByTime(300);
    expect(window.electronAPI.scormCommit).toHaveBeenCalledTimes(1);

    // Finish: terminate
    expect(scormClient.Terminate('')).toBe('true');
  });
});

