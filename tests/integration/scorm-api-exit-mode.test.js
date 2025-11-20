/**
 * SCORM API Exit Mode Integration Test
 * 
 * Tests that cmi.exit can be set correctly through the full API chain.
 * This reproduces the issue seen in the E2E test where SetValue('cmi.exit', 'suspend')
 * appears to fail.
 */

const ScormService = require('../../src/main/services/scorm-service');
const SessionStore = require('../../src/main/services/session-store');

// Mock Electron app
jest.mock('electron', () => {
  const pathModule = require('path');
  return {
    app: {
      getPath: jest.fn((name) => {
        if (name === 'userData') {
          return pathModule.join(__dirname, '../../.test-data');
        }
        return '';
      })
    }
  };
});

const mockWindowManager = {
  broadcastToAllWindows: jest.fn()
};

describe('SCORM API Exit Mode', () => {
  let scormService;
  let sessionStore;
  let mockLogger;

  beforeEach(async () => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };

    sessionStore = new SessionStore(null, mockLogger);
    await sessionStore.initialize();

    scormService = new ScormService(null, mockLogger, {
      sessionNamespace: 'test-exit-mode'
    });

    scormService.sessionStore = sessionStore;
    scormService.getDependency = jest.fn((name) => {
      if (name === 'windowManager') return mockWindowManager;
      if (name === 'telemetryStore') return null;
      return null;
    });

    await scormService.initialize();

    // Setup mock SN service
    scormService.snService = {
      sequencingSession: {
        manifest: { identifier: 'test-course' }
      },
      getSequencingState: jest.fn().mockReturnValue({
        sessionState: 'active',
        activityTreeStats: { totalActivities: 1 }
      }),
      processNavigation: jest.fn().mockResolvedValue({ success: true })
    };
  });

  afterEach(async () => {
    if (scormService) {
      await scormService.shutdown();
    }
  });

  it('should successfully set cmi.exit to suspend', async () => {
    console.log('\n=== TEST: Set cmi.exit to suspend ===');
    const sessionId = 'exit-test-1';

    // Initialize session
    const initResult = await scormService.initializeSession(sessionId);
    expect(initResult.success).toBe(true);
    console.log('✓ Session initialized');

    // Verify RTE instance exists
    const rte = scormService.rteInstances.get(sessionId);
    expect(rte).toBeDefined();
    console.log('✓ RTE instance found');

    // Try to set cmi.exit using the RTE API directly (like the content would)
    const setValueResult = rte.SetValue('cmi.exit', 'suspend');
    console.log(`✓ SetValue('cmi.exit', 'suspend') returned: ${setValueResult}`);
    expect(setValueResult).toBe('true');

    // Check for errors
    const errorCode = rte.GetLastError();
    console.log(`✓ GetLastError() returned: ${errorCode}`);
    expect(errorCode).toBe('0');

    // Verify the value was set (note: cmi.exit is write-only, so we can't GetValue)
    // Instead, check the internal data model
    const exitValueInternal = rte.dataModel._getInternalValue('cmi.exit');
    console.log(`✓ Internal value of cmi.exit: ${exitValueInternal}`);
    expect(exitValueInternal).toBe('suspend');

    // Now try through the service layer (like IPC would)
    const serviceSetResult = await scormService.setValue(sessionId, 'cmi.exit', 'suspend');
    console.log(`✓ scormService.setValue('cmi.exit', 'suspend') returned:`, serviceSetResult);
    expect(serviceSetResult.success).toBe(true);
    expect(serviceSetResult.errorCode).toBe('0');

    console.log('✅ TEST COMPLETE: cmi.exit set successfully');
  });

  it('should set cmi.exit multiple times without error', async () => {
    console.log('\n=== TEST: Set cmi.exit multiple times ===');
    const sessionId = 'exit-test-2';

    await scormService.initializeSession(sessionId);
    const rte = scormService.rteInstances.get(sessionId);

    // Set to suspend
    let result = rte.SetValue('cmi.exit', 'suspend');
    expect(result).toBe('true');
    console.log('✓ Set to suspend');

    // Set to normal
    result = rte.SetValue('cmi.exit', 'normal');
    expect(result).toBe('true');
    console.log('✓ Set to normal');

    // Set to logout
    result = rte.SetValue('cmi.exit', 'logout');
    expect(result).toBe('true');
    console.log('✓ Set to logout');

    // Set back to suspend
    result = rte.SetValue('cmi.exit', 'suspend');
    expect(result).toBe('true');
    console.log('✓ Set back to suspend');

    console.log('✅ TEST COMPLETE: Multiple sets successful');
  });

  it('should reject invalid exit values', async () => {
    console.log('\n=== TEST: Reject invalid exit values ===');
    const sessionId = 'exit-test-3';

    await scormService.initializeSession(sessionId);
    const rte = scormService.rteInstances.get(sessionId);

    // Try invalid value
    const result = rte.SetValue('cmi.exit', 'invalid-value');
    console.log(`✓ SetValue('cmi.exit', 'invalid-value') returned: ${result}`);
    expect(result).toBe('false');

    const errorCode = rte.GetLastError();
    console.log(`✓ GetLastError() returned: ${errorCode}`);
    expect(errorCode).not.toBe('0');

    console.log('✅ TEST COMPLETE: Invalid value rejected');
  });
});
