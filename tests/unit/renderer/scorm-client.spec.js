/**
 * @jest-environment jsdom
 */
const assert = require('assert');
const sinon = require('sinon/pkg/sinon'); // Import sinon (CommonJS version)
const { ScormClient } = require('../../../src/renderer/services/scorm-client');

describe('ScormClient debug event emission', function() {
  let scormClient;
  let originalElectronAPI;
  let emitDebugEventSpy;
  let sandbox; // Declare sandbox

  beforeEach(function() {
    sandbox = sinon.createSandbox(); // Create a sandbox
    // Mock window.electronAPI
    originalElectronAPI = window.electronAPI;
    window.electronAPI = {
      emitDebugEvent: () => {}, // Mock function
      scormInitialize: async () => ({ success: true }),
      scormGetValue: async () => ({ success: true, value: '' }),
      scormSetValue: async () => ({ success: true }),
      scormCommit: async () => ({ success: true }),
      scormTerminate: async () => ({ success: true })
    };
    emitDebugEventSpy = sandbox.spy(window.electronAPI, 'emitDebugEvent'); // Use sandbox.spy

    // Mock uiState
    const mockUiState = {
      addApiCall: () => {},
      updateSession: () => {},
      updateProgress: () => {},
      getState: () => {}
    };
    scormClient = new ScormClient();
    scormClient.setUiState(mockUiState);
  });

  afterEach(function() {
    sandbox.restore(); // Restore sandbox
    window.electronAPI = originalElectronAPI;
    scormClient.destroy();
  });

  it('emits debug events via electronAPI.emitDebugEvent when logApiCall is invoked', function() {
    scormClient.Initialize('test-session');
    scormClient.GetValue('cmi.core.lesson_status');

    assert.ok(emitDebugEventSpy.calledWith('api:call', {
      method: 'Initialize',
      parameter: 'test-session',
      result: 'true',
      errorCode: '0',
      timestamp: sinon.match.number
    }), 'emitDebugEvent should be called for Initialize');

    assert.ok(emitDebugEventSpy.calledWith('api:call', {
      method: 'GetValue',
      parameter: 'cmi.core.lesson_status',
      result: '',
      errorCode: '0',
      timestamp: sinon.match.number
    }), 'emitDebugEvent should be called for GetValue');

    assert.strictEqual(emitDebugEventSpy.callCount, 2, 'emitDebugEvent should be called twice');
  });
});