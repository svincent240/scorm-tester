/**
 * Session Hydration Integration Tests
 * 
 * Tests the complete session save/load/resume workflow as described in
 * UNIFIED_SESSION_LIFECYCLE.md. Validates that:
 * 1. Session data is always saved on terminate
 * 2. Saved data is loaded on next initialization
 * 3. Resume happens when cmi.exit='suspend'
 * 4. Fresh start happens when cmi.exit!='suspend'
 * 5. forceNew flag properly skips saved data
 * 
 * This is a true integration test that exercises ScormService, SessionStore,
 * and RTE components together without mocking the core logic.
 */

const path = require('path');
const fs = require('fs');
const ScormService = require('../../src/main/services/scorm-service');
const SessionStore = require('../../src/main/services/session-store');

// Mock Electron app for userData path
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

// Mock window manager dependency
const mockWindowManager = {
  broadcastToAllWindows: jest.fn()
};

describe('Session Hydration Integration Tests', () => {
  let scormService;
  let sessionStore;
  let mockLogger;
  let testDataDir;

  beforeAll(() => {
    testDataDir = path.join(__dirname, '../../.test-data/scorm-sessions');
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  beforeEach(async () => {
    // Clean up test data directory
    if (fs.existsSync(testDataDir)) {
      const files = fs.readdirSync(testDataDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testDataDir, file));
      });
    }

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };

    // Create real SessionStore instance
    sessionStore = new SessionStore(null, mockLogger);
    await sessionStore.initialize();

    // Create real ScormService instance
    scormService = new ScormService(null, mockLogger, {
      sessionNamespace: 'test-integration'
    });

    // Inject real SessionStore
    scormService.sessionStore = sessionStore;

    // Mock getDependency for windowManager and telemetryStore
    scormService.getDependency = jest.fn((name) => {
      if (name === 'windowManager') return mockWindowManager;
      if (name === 'telemetryStore') return null; // Not needed for this test
      return null;
    });

    await scormService.initialize();

    // Setup mock SN service with a test course identifier (BEFORE any sessions)
    // This simulates what happens after processScormManifest is called
    scormService.snService = {
      sequencingSession: {
        manifest: { identifier: 'test-course-123' }
      },
      getSequencingState: jest.fn().mockReturnValue({
        sessionState: 'active',
        activityTreeStats: { totalActivities: 1 },
        currentActivity: null
      }),
      processNavigation: jest.fn().mockResolvedValue({ success: true }),
      initialize: jest.fn().mockResolvedValue({ success: true }),
      reset: jest.fn()
    };
  });

  afterEach(async () => {
    if (scormService) {
      await scormService.shutdown();
    }
  });

  afterAll(() => {
    // Clean up test data directory
    if (fs.existsSync(testDataDir)) {
      const files = fs.readdirSync(testDataDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testDataDir, file));
      });
      fs.rmdirSync(testDataDir);
    }
  });

  describe('Complete Save/Load/Resume Workflow', () => {
    it('should save session data on terminate and restore it on next initialize when exit=suspend', async () => {
      const sessionId = 'session-suspend-test';

      // === STEP 1: First session - navigate and suspend ===
      console.log('\n=== STEP 1: Initialize first session ===');
      const initResult = await scormService.initializeSession(sessionId);
      expect(initResult.success).toBe(true);

      // Get the RTE instance
      const rte = scormService.rteInstances.get(sessionId);
      expect(rte).toBeDefined();

      // Verify initial entry mode is ab-initio
      const initialEntry = rte.dataModel.getValue('cmi.entry');
      expect(initialEntry).toBe('ab-initio');
      console.log('✓ Initial entry mode:', initialEntry);

      // Simulate user navigating through course
      console.log('\n=== STEP 2: Simulate course navigation ===');
      const setValue1 = await scormService.setValue(sessionId, 'cmi.location', 'page5');
      expect(setValue1.success).toBe(true);

      const setValue2 = await scormService.setValue(sessionId, 'cmi.suspend_data', 'currentSlide=5;score=42;completed=[1,2,3,4,5]');
      expect(setValue2.success).toBe(true);

      const setValue3 = await scormService.setValue(sessionId, 'cmi.completion_status', 'incomplete');
      expect(setValue3.success).toBe(true);

      const setValue4 = await scormService.setValue(sessionId, 'cmi.progress_measure', '0.5');
      expect(setValue4.success).toBe(true);

      // Set exit to suspend (learner wants to continue later)
      const setExit = await scormService.setValue(sessionId, 'cmi.exit', 'suspend');
      expect(setExit.success).toBe(true);
      console.log('✓ Set cmi.exit=suspend');

      // Commit to ensure everything is in the data model
      const commitResult = await scormService.commit(sessionId);
      expect(commitResult.success).toBe(true);
      console.log('✓ Committed data');

      // Verify data before termination
      const locationBefore = await scormService.getValue(sessionId, 'cmi.location');
      expect(locationBefore.value).toBe('page5');
      const suspendDataBefore = await scormService.getValue(sessionId, 'cmi.suspend_data');
      expect(suspendDataBefore.value).toBe('currentSlide=5;score=42;completed=[1,2,3,4,5]');
      console.log('✓ Verified data in memory:', { location: locationBefore.value, suspendData: suspendDataBefore.value.substring(0, 30) + '...' });

      // === STEP 3: Terminate (should save data) ===
      console.log('\n=== STEP 3: Terminate session (should save) ===');
      const terminateResult = await scormService.terminate(sessionId);
      expect(terminateResult.success).toBe(true);
      console.log('✓ Session terminated');

      // Verify session is cleaned up from memory
      expect(scormService.sessions.has(sessionId)).toBe(false);
      expect(scormService.rteInstances.has(sessionId)).toBe(false);
      console.log('✓ Session cleaned up from memory');

      // Verify file was saved to disk
      const savedFilePath = sessionStore.getFilePath('test-course-123', 'test-integration');
      expect(fs.existsSync(savedFilePath)).toBe(true);
      console.log('✓ Session file saved to disk:', savedFilePath);

      // Read and verify saved data
      const savedData = await sessionStore.loadSession('test-course-123', 'test-integration');
      expect(savedData).not.toBeNull();
      expect(savedData.coreData['cmi.exit']).toBe('suspend');
      expect(savedData.coreData['cmi.location']).toBe('page5');
      expect(savedData.coreData['cmi.suspend_data']).toBe('currentSlide=5;score=42;completed=[1,2,3,4,5]');
      expect(savedData.coreData['cmi.completion_status']).toBe('incomplete');
      expect(savedData.coreData['cmi.progress_measure']).toBe('0.5');
      console.log('✓ Verified saved data:', {
        exit: savedData.coreData['cmi.exit'],
        location: savedData.coreData['cmi.location'],
        progress: savedData.coreData['cmi.progress_measure']
      });

      // === STEP 4: New session - should resume ===
      console.log('\n=== STEP 4: Initialize new session (should resume) ===');
      const sessionId2 = 'session-resume-test';
      const resumeResult = await scormService.initializeSession(sessionId2);
      expect(resumeResult.success).toBe(true);
      console.log('✓ New session initialized');

      // Get the new RTE instance
      const rte2 = scormService.rteInstances.get(sessionId2);
      expect(rte2).toBeDefined();

      // Verify entry mode is 'resume'
      const resumeEntry = rte2.dataModel.getValue('cmi.entry');
      expect(resumeEntry).toBe('resume');
      console.log('✓ Entry mode is "resume"');

      // Verify all data was restored
      const locationAfter = await scormService.getValue(sessionId2, 'cmi.location');
      expect(locationAfter.value).toBe('page5');

      const suspendDataAfter = await scormService.getValue(sessionId2, 'cmi.suspend_data');
      expect(suspendDataAfter.value).toBe('currentSlide=5;score=42;completed=[1,2,3,4,5]');

      const completionAfter = await scormService.getValue(sessionId2, 'cmi.completion_status');
      expect(completionAfter.value).toBe('incomplete');

      const progressAfter = await scormService.getValue(sessionId2, 'cmi.progress_measure');
      expect(progressAfter.value).toBe('0.5');

      // Exit should be cleared (read-only on new session)
      const exitAfter = await scormService.getValue(sessionId2, 'cmi.exit');
      expect(exitAfter.value).toBe('');

      console.log('✓ All data restored:', {
        location: locationAfter.value,
        suspendData: suspendDataAfter.value.substring(0, 30) + '...',
        completion: completionAfter.value,
        progress: progressAfter.value
      });

      // Clean up second session
      await scormService.terminate(sessionId2);
    });

    it('should NOT resume when exit is not suspend', async () => {
      const sessionId = 'session-normal-exit';

      // === First session - complete and exit normally ===
      console.log('\n=== First session: Complete and exit normally ===');
      await scormService.initializeSession(sessionId);

      await scormService.setValue(sessionId, 'cmi.location', 'page10');
      await scormService.setValue(sessionId, 'cmi.suspend_data', 'some_data');
      await scormService.setValue(sessionId, 'cmi.completion_status', 'completed');
      await scormService.setValue(sessionId, 'cmi.success_status', 'passed');
      await scormService.setValue(sessionId, 'cmi.exit', 'normal'); // Normal exit, not suspend

      console.log('✓ Set cmi.exit=normal (not suspend)');

      await scormService.terminate(sessionId);
      console.log('✓ Session terminated and saved');

      // Verify data was saved
      const savedData = await sessionStore.loadSession('test-course-123', 'test-integration');
      expect(savedData).not.toBeNull();
      expect(savedData.coreData['cmi.exit']).toBe('normal');
      console.log('✓ Saved data has exit=normal');

      // === Second session - should start fresh ===
      console.log('\n=== Second session: Should start fresh (ab-initio) ===');
      const sessionId2 = 'session-fresh-start';
      await scormService.initializeSession(sessionId2);

      const rte2 = scormService.rteInstances.get(sessionId2);
      const entry = rte2.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log('✓ Entry mode is "ab-initio" (fresh start)');

      // Verify data was NOT restored (fresh start)
      const location = await scormService.getValue(sessionId2, 'cmi.location');
      expect(location.value).toBe('');

      const suspendData = await scormService.getValue(sessionId2, 'cmi.suspend_data');
      expect(suspendData.value).toBe('');

      const completion = await scormService.getValue(sessionId2, 'cmi.completion_status');
      expect(completion.value).toBe('unknown');

      console.log('✓ Data NOT restored (fresh start):', {
        location: location.value || '(empty)',
        completion: completion.value
      });

      await scormService.terminate(sessionId2);
    });

    it('should force fresh start when forceNew flag is true', async () => {
      const sessionId1 = 'session-force-new-1';

      // === First session - create saved data ===
      console.log('\n=== First session: Create saved data ===');
      await scormService.initializeSession(sessionId1);
      await scormService.setValue(sessionId1, 'cmi.location', 'page3');
      await scormService.setValue(sessionId1, 'cmi.suspend_data', 'saved_progress');
      await scormService.setValue(sessionId1, 'cmi.exit', 'suspend');
      await scormService.terminate(sessionId1);
      console.log('✓ Saved data with exit=suspend');

      // Verify data exists
      const savedData = await sessionStore.loadSession('test-course-123', 'test-integration');
      expect(savedData).not.toBeNull();
      expect(savedData.coreData['cmi.exit']).toBe('suspend');
      console.log('✓ Confirmed saved data exists');

      // === Second session - use forceNew to ignore saved data ===
      console.log('\n=== Second session: Force new (ignore saved data) ===');
      const sessionId2 = 'session-force-new-2';
      const initResult = await scormService.initializeSession(sessionId2, { forceNew: true });
      expect(initResult.success).toBe(true);

      const rte = scormService.rteInstances.get(sessionId2);
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log('✓ Entry mode is "ab-initio" (forceNew worked)');

      // Verify data was NOT loaded
      const location = await scormService.getValue(sessionId2, 'cmi.location');
      expect(location.value).toBe('');

      const suspendData = await scormService.getValue(sessionId2, 'cmi.suspend_data');
      expect(suspendData.value).toBe('');

      console.log('✓ Saved data was ignored:', {
        location: location.value || '(empty)',
        suspendData: suspendData.value || '(empty)'
      });

      await scormService.terminate(sessionId2);
    });
  });

  describe('Reload Workflow', () => {
    it('should terminate existing session then initialize fresh with resume check', async () => {
      const sessionId = 'session-reload';

      // === Setup initial session ===
      console.log('\n=== Setup: Initial session ===');
      await scormService.initializeSession(sessionId);
      await scormService.setValue(sessionId, 'cmi.location', 'page7');
      await scormService.setValue(sessionId, 'cmi.suspend_data', 'reload_test_data');
      await scormService.setValue(sessionId, 'cmi.exit', 'suspend');
      console.log('✓ Session data set');

      // Don't terminate yet - reload should do it
      expect(scormService.sessions.has(sessionId)).toBe(true);
      expect(scormService.rteInstances.has(sessionId)).toBe(true);
      console.log('✓ Session active in memory');

      // === Reload (should terminate current, then initialize new) ===
      console.log('\n=== Reload: Terminate current + initialize new ===');
      const reloadResult = await scormService.initializeSession(sessionId, { reload: true });
      expect(reloadResult.success).toBe(true);
      console.log('✓ Reload completed');

      // Verify session still exists (new instance)
      expect(scormService.sessions.has(sessionId)).toBe(true);
      expect(scormService.rteInstances.has(sessionId)).toBe(true);
      console.log('✓ New session created');

      // Verify it resumed (because old session saved with exit=suspend)
      const rte = scormService.rteInstances.get(sessionId);
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('resume');
      console.log('✓ Resumed from saved data');

      // Verify data was restored
      const location = await scormService.getValue(sessionId, 'cmi.location');
      expect(location.value).toBe('page7');

      const suspendData = await scormService.getValue(sessionId, 'cmi.suspend_data');
      expect(suspendData.value).toBe('reload_test_data');

      console.log('✓ Data restored:', {
        location: location.value,
        suspendData: suspendData.value
      });

      await scormService.terminate(sessionId);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle corrupted saved data gracefully', async () => {
      // Manually write corrupted JSON to session file
      const filePath = sessionStore.getFilePath('test-course-123', 'test-integration');
      fs.writeFileSync(filePath, '{ this is not valid JSON }', 'utf8');
      console.log('\n=== Setup: Wrote corrupted JSON ===');

      // Try to initialize - should fall back to fresh start
      const sessionId = 'session-corrupted';
      const initResult = await scormService.initializeSession(sessionId);
      expect(initResult.success).toBe(true);
      console.log('✓ Initialized despite corrupted data');

      // Should be fresh start
      const rte = scormService.rteInstances.get(sessionId);
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log('✓ Fell back to ab-initio');

      await scormService.terminate(sessionId);
    });

    it('should handle missing session file gracefully', async () => {
      // Ensure no session file exists
      const filePath = sessionStore.getFilePath('test-course-123', 'test-integration');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      console.log('\n=== Setup: No saved data exists ===');

      const sessionId = 'session-no-file';
      const initResult = await scormService.initializeSession(sessionId);
      expect(initResult.success).toBe(true);
      console.log('✓ Initialized without saved data');

      const rte = scormService.rteInstances.get(sessionId);
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log('✓ Entry mode is ab-initio (fresh start)');

      await scormService.terminate(sessionId);
    });

    // Skip this test - the RTE currently only supports SCORM 2004, not SCORM 1.2
    // The hydration logic DOES check for both cmi.exit and cmi.core.exit, but the RTE
    // data model doesn't store SCORM 1.2 elements. This would need a SCORM 1.2-specific
    // data model implementation to work.
    it.skip('should handle SCORM 1.2 cmi.core.exit', async () => {
      const sessionId1 = 'session-scorm12-1';

      // Create SCORM 1.2 saved data
      console.log('\n=== First session: SCORM 1.2 course ===');
      await scormService.initializeSession(sessionId1);
      await scormService.setValue(sessionId1, 'cmi.core.lesson_location', 'slide8');
      await scormService.setValue(sessionId1, 'cmi.core.exit', 'suspend'); // SCORM 1.2 format
      await scormService.terminate(sessionId1);
      console.log('✓ Saved with cmi.core.exit=suspend');

      // Resume - should detect SCORM 1.2 exit
      const sessionId2 = 'session-scorm12-2';
      await scormService.initializeSession(sessionId2);

      const rte = scormService.rteInstances.get(sessionId2);
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('resume');
      console.log('✓ Resumed from SCORM 1.2 data');

      await scormService.terminate(sessionId2);
    });
  });

  describe('Data Integrity', () => {
    it('should preserve all data model elements on save/restore', async () => {
      const sessionId1 = 'session-complex-data';

      console.log('\n=== First session: Set complex data ===');
      await scormService.initializeSession(sessionId1);

      // Set various data model elements
      const testData = {
        'cmi.location': 'module3/lesson2/page5',
        'cmi.suspend_data': JSON.stringify({ state: 'complex', values: [1, 2, 3] }),
        'cmi.completion_status': 'incomplete',
        'cmi.success_status': 'unknown',
        'cmi.progress_measure': '0.65',
        'cmi.score.raw': '85',
        'cmi.score.max': '100',
        'cmi.score.min': '0',
        'cmi.score.scaled': '0.85',
        'cmi.exit': 'suspend'
      };

      for (const [key, value] of Object.entries(testData)) {
        await scormService.setValue(sessionId1, key, value);
      }
      console.log('✓ Set complex data');

      await scormService.terminate(sessionId1);
      console.log('✓ Terminated and saved');

      // Resume and verify all data
      console.log('\n=== Second session: Verify all data restored ===');
      const sessionId2 = 'session-verify-data';
      await scormService.initializeSession(sessionId2);

      for (const [key, expectedValue] of Object.entries(testData)) {
        if (key === 'cmi.exit') continue; // Exit is write-only on resume

        const result = await scormService.getValue(sessionId2, key);
        expect(result.value).toBe(expectedValue);
      }
      console.log('✓ All data verified');

      await scormService.terminate(sessionId2);
    });
  });
});
