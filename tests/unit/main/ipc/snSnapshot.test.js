const assert = require('assert');
const IpcHandler = require('../../../../src/main/services/ipc-handler');

describe('IpcHandler SNSnapshotService passthrough', function() {
  it('delegates to SNSnapshotService.getStatus when snapshot service is provided', async function() {
    const mockSnapshot = { success: true, initialized: true, sessionState: 'active', availableNavigation: ['a'] };
    const mockSnSnapshotService = {
      getStatus: async () => mockSnapshot
    };

    const mockErrorHandler = { setError: () => {} };
    const mockLogger = { info: () => {}, warn: () => {}, error: () => {} };

    const ipc = new IpcHandler(mockErrorHandler, mockLogger, {});
    // inject the mock SNSnapshotService
    ipc.snSnapshotService = mockSnSnapshotService;

    const result = await ipc.handleSNGetStatus({});
    assert.deepStrictEqual(result, mockSnapshot);
  });

  it('falls back to SN service on scormService when snapshot service not present', async function() {
    const mockStatus = { success: true, initialized: false, sessionState: 'not_initialized', availableNavigation: [] };
    const mockSnService = {
      getStatus: async () => mockStatus
    };
    const mockScormService = {
      getSNService: () => mockSnService
    };

    const mockErrorHandler = { setError: () => {} };
    const mockLogger = { info: () => {}, warn: () => {}, error: () => {} };

    const ipc = new IpcHandler(mockErrorHandler, mockLogger, {});
    // wire scormService via the dependency map so getDependency finds it
    const deps = new Map();
    deps.set('scormService', mockScormService);
    ipc.dependencies = deps;

    const result = await ipc.handleSNGetStatus({});
    // handler wraps fallback status into success envelope in code path (returns { success: true, ...status })
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.initialized, mockStatus.initialized);
  });
});