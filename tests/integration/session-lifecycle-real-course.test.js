/**
 * Session Lifecycle Integration Tests with Real SCORM Course
 * 
 * Tests the unified session lifecycle (UNIFIED_SESSION_LIFECYCLE.md) using the
 * real dist course (references/real_course_examples/dist). This validates that:
 * 
 * 1. CAM properly parses manifest and provides courseId
 * 2. Shutdown path saves data with the correct courseId
 * 3. Startup path loads data and resumes correctly
 * 4. Navigation state is preserved across reload
 * 
 * This test exercises the FULL STACK:
 * - FileManager (course extraction/access)
 * - CAM (manifest parsing, courseId extraction)
 * - RTE (data model, API operations)
 * - SessionStore (persistence)
 * - ScormService (orchestration)
 */

const path = require('path');
const fs = require('fs');
const ScormService = require('../../src/main/services/scorm-service');
const SessionStore = require('../../src/main/services/session-store');
const FileManager = require('../../src/main/services/file-manager');

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

describe('Session Lifecycle with Real SCORM Course', () => {
  let scormService;
  let sessionStore;
  let fileManager;
  let mockLogger;
  let testDataDir;
  let coursePath;

  beforeAll(() => {
    // Path to the real dist course
    coursePath = path.resolve(__dirname, '../../references/real_course_examples/dist');
    
    // Verify course exists
    if (!fs.existsSync(coursePath)) {
      throw new Error(`Test course not found at: ${coursePath}`);
    }
    
    const manifestPath = path.join(coursePath, 'imsmanifest.xml');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found at: ${manifestPath}`);
    }
    
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

    // Create real instances
    fileManager = new FileManager(null, mockLogger);
    await fileManager.initialize();

    sessionStore = new SessionStore(null, mockLogger);
    await sessionStore.initialize();

    scormService = new ScormService(null, mockLogger, {
      sessionNamespace: 'test-real-course'
    });

    // Inject dependencies
    scormService.sessionStore = sessionStore;
    scormService.fileManager = fileManager;
    scormService.getDependency = jest.fn((name) => {
      if (name === 'windowManager') return mockWindowManager;
      if (name === 'telemetryStore') return null;
      if (name === 'fileManager') return fileManager;
      return null;
    });

    await scormService.initialize();

    // Process the manifest once at the start to set up CAM/SN services
    // This simulates what happens when a course is loaded in the GUI
    const manifestPath = path.join(coursePath, 'imsmanifest.xml');
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const processResult = await scormService.processScormManifest(coursePath, manifestContent);
    if (!processResult.success) {
      console.warn('Warning: Initial manifest processing failed:', processResult.error);
    }
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

  describe('Complete Lifecycle with Manifest Parsing', () => {
    it('should parse manifest, initialize session, save on terminate, and resume on next load', async () => {
      console.log('\n=== TEST: Complete lifecycle with real course ===');
      const sessionId = 'real-course-session-1';

      // Manifest is already processed in beforeEach
      // Verify SN service has the manifest
      expect(scormService.snService).toBeDefined();
      expect(scormService.snService.sequencingSession).toBeDefined();
      expect(scormService.snService.sequencingSession.manifest.identifier).toBe('SCORM-Template');
      console.log(`✓ Manifest already processed. Course ID: ${scormService.snService.sequencingSession.manifest.identifier}`);

      // === STEP 1: Initialize first session ===
      console.log('\n--- STEP 1: Initialize first session ---');
      const initResult = await scormService.initializeSession(sessionId);
      
      expect(initResult.success).toBe(true);
      console.log('✓ Session initialized');

      // Verify RTE instance exists
      const rte = scormService.rteInstances.get(sessionId);
      expect(rte).toBeDefined();

      // Check initial entry mode
      const initialEntry = rte.dataModel.getValue('cmi.entry');
      expect(initialEntry).toBe('ab-initio');
      console.log(`✓ Entry mode: ${initialEntry}`);

      // === STEP 3: Simulate course interaction ===
      console.log('\n--- STEP 3: Simulate course interaction ---');
      
      // Set location (simulating navigation to page 3)
      const setLocation = await scormService.setValue(sessionId, 'cmi.location', 'page-3');
      expect(setLocation.success).toBe(true);
      console.log('✓ Set location: page-3');

      // Set suspend data (simulating course state)
      const suspendData = JSON.stringify({
        currentPage: 3,
        completedPages: [1, 2, 3],
        score: 75,
        timestamp: Date.now()
      });
      const setSuspend = await scormService.setValue(sessionId, 'cmi.suspend_data', suspendData);
      expect(setSuspend.success).toBe(true);
      console.log('✓ Set suspend_data');

      // Set progress
      const setProgress = await scormService.setValue(sessionId, 'cmi.progress_measure', '0.6');
      expect(setProgress.success).toBe(true);
      console.log('✓ Set progress: 0.6');

      // Set exit to suspend
      const setExit = await scormService.setValue(sessionId, 'cmi.exit', 'suspend');
      expect(setExit.success).toBe(true);
      console.log('✓ Set exit: suspend');

      // Commit
      const commitResult = await scormService.commit(sessionId);
      expect(commitResult.success).toBe(true);
      console.log('✓ Committed data');

      // === STEP 4: Terminate (should save) ===
      console.log('\n--- STEP 4: Terminate session ---');
      const terminateResult = await scormService.terminate(sessionId);
      
      expect(terminateResult.success).toBe(true);
      console.log('✓ Session terminated');

      // Verify session cleaned up
      expect(scormService.sessions.has(sessionId)).toBe(false);
      expect(scormService.rteInstances.has(sessionId)).toBe(false);
      console.log('✓ Session cleaned up from memory');

      // === STEP 5: Verify file was saved ===
      console.log('\n--- STEP 5: Verify session file saved ---');
      const savedFilePath = sessionStore.getFilePath('SCORM-Template', 'test-real-course');
      
      expect(fs.existsSync(savedFilePath)).toBe(true);
      console.log(`✓ Session file exists: ${savedFilePath}`);

      // Read and verify saved data
      const savedData = await sessionStore.loadSession('SCORM-Template', 'test-real-course');
      expect(savedData).not.toBeNull();
      expect(savedData.coreData['cmi.exit']).toBe('suspend');
      expect(savedData.coreData['cmi.location']).toBe('page-3');
      expect(savedData.coreData['cmi.progress_measure']).toBe('0.6');
      
      const parsedSuspendData = JSON.parse(savedData.coreData['cmi.suspend_data']);
      expect(parsedSuspendData.currentPage).toBe(3);
      expect(parsedSuspendData.completedPages).toEqual([1, 2, 3]);
      console.log('✓ Saved data verified:', {
        exit: savedData.coreData['cmi.exit'],
        location: savedData.coreData['cmi.location'],
        progress: savedData.coreData['cmi.progress_measure']
      });

      // === STEP 6: Initialize new session (should resume) ===
      // Manifest is already processed, no need to reprocess
      console.log('\n--- STEP 6: Initialize new session (should resume) ---');
      const sessionId2 = 'real-course-session-2';
      const resumeResult = await scormService.initializeSession(sessionId2);
      
      expect(resumeResult.success).toBe(true);
      console.log('✓ New session initialized');

      // Verify it resumed
      const rte2 = scormService.rteInstances.get(sessionId2);
      expect(rte2).toBeDefined();

      const resumeEntry = rte2.dataModel.getValue('cmi.entry');
      expect(resumeEntry).toBe('resume');
      console.log(`✓ Entry mode: ${resumeEntry}`);

      // === STEP 7: Verify all data was restored ===
      console.log('\n--- STEP 7: Verify data restored ---');
      
      const locationRestored = await scormService.getValue(sessionId2, 'cmi.location');
      expect(locationRestored.value).toBe('page-3');
      console.log(`✓ Location restored: ${locationRestored.value}`);

      const suspendRestored = await scormService.getValue(sessionId2, 'cmi.suspend_data');
      const parsedRestored = JSON.parse(suspendRestored.value);
      expect(parsedRestored.currentPage).toBe(3);
      expect(parsedRestored.completedPages).toEqual([1, 2, 3]);
      console.log('✓ Suspend data restored');

      const progressRestored = await scormService.getValue(sessionId2, 'cmi.progress_measure');
      expect(progressRestored.value).toBe('0.6');
      console.log(`✓ Progress restored: ${progressRestored.value}`);

      // Clean up
      await scormService.terminate(sessionId2);
      console.log('\n✅ TEST COMPLETE: Full lifecycle verified with real course');
    });

    it('should NOT resume when exit is normal (completed course)', async () => {
      console.log('\n=== TEST: Normal exit (no resume) ===');
      const sessionId = 'normal-exit-session';

      // Manifest already processed in beforeEach
      // Initialize and complete course
      await scormService.initializeSession(sessionId);
      await scormService.setValue(sessionId, 'cmi.completion_status', 'completed');
      await scormService.setValue(sessionId, 'cmi.success_status', 'passed');
      await scormService.setValue(sessionId, 'cmi.score.scaled', '0.95');
      await scormService.setValue(sessionId, 'cmi.exit', 'normal'); // Normal exit, not suspend
      await scormService.commit(sessionId);
      console.log('✓ Course completed with normal exit');

      await scormService.terminate(sessionId);
      console.log('✓ Session terminated and saved');

      // Verify data was saved
      const savedData = await sessionStore.loadSession('SCORM-Template', 'test-real-course');
      expect(savedData).not.toBeNull();
      expect(savedData.coreData['cmi.exit']).toBe('normal');
      console.log('✓ Saved data has exit=normal');

      // Initialize new session (should NOT resume)
      const sessionId2 = 'fresh-start-session';
      await scormService.initializeSession(sessionId2);
      console.log('✓ New session initialized');

      const rte2 = scormService.rteInstances.get(sessionId2);
      const entry = rte2.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log(`✓ Entry mode: ${entry} (fresh start, not resume)`);

      // Verify data was NOT restored
      const completion = await scormService.getValue(sessionId2, 'cmi.completion_status');
      expect(completion.value).toBe('unknown'); // Fresh start
      console.log(`✓ Completion status: ${completion.value} (not restored)`);

      await scormService.terminate(sessionId2);
      console.log('✅ TEST COMPLETE: Normal exit does not resume');
    });

    it('should handle forceNew flag with real course', async () => {
      console.log('\n=== TEST: forceNew flag ===');
      const sessionId1 = 'force-new-1';

      // Manifest already processed in beforeEach
      // Create first session with suspend
      await scormService.initializeSession(sessionId1);
      await scormService.setValue(sessionId1, 'cmi.location', 'page-10');
      await scormService.setValue(sessionId1, 'cmi.suspend_data', 'old_data');
      await scormService.setValue(sessionId1, 'cmi.exit', 'suspend');
      await scormService.commit(sessionId1);
      await scormService.terminate(sessionId1);
      console.log('✓ First session saved with suspend');

      // Verify data exists
      const savedData = await sessionStore.loadSession('SCORM-Template', 'test-real-course');
      expect(savedData).not.toBeNull();
      expect(savedData.coreData['cmi.exit']).toBe('suspend');
      console.log('✓ Confirmed saved data exists');

      // Initialize with forceNew (should ignore saved data)
      const sessionId2 = 'force-new-2';
      await scormService.initializeSession(sessionId2, { forceNew: true });
      console.log('✓ New session initialized with forceNew=true');

      const rte2 = scormService.rteInstances.get(sessionId2);
      const entry = rte2.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log(`✓ Entry mode: ${entry} (forceNew worked)`);

      // Verify data was NOT loaded
      const location = await scormService.getValue(sessionId2, 'cmi.location');
      expect(location.value).toBe('');
      console.log(`✓ Location: ${location.value || '(empty)'} (not restored)`);

      await scormService.terminate(sessionId2);
      console.log('✅ TEST COMPLETE: forceNew ignores saved data');
    });

    it('should handle reload flag with real course', async () => {
      console.log('\n=== TEST: reload flag ===');
      const sessionId = 'reload-test';

      // Manifest already processed in beforeEach
      // Initialize session
      await scormService.initializeSession(sessionId);
      await scormService.setValue(sessionId, 'cmi.location', 'page-5');
      await scormService.setValue(sessionId, 'cmi.suspend_data', 'reload_test');
      await scormService.setValue(sessionId, 'cmi.exit', 'suspend');
      await scormService.commit(sessionId);
      console.log('✓ Session created with data');
      
      // Log what was saved
      const rteBeforeReload = scormService.rteInstances.get(sessionId);
      const savedData = rteBeforeReload.dataModel.getAllData();
      console.log('📊 Data saved before reload:', JSON.stringify({
        cmiLocation: savedData.coreData?.['cmi.location'],
        cmiExit: savedData.coreData?.['cmi.exit'],
        cmiEntry: savedData.coreData?.['cmi.entry'],
        hasCollections: {
          interactions: savedData.interactions?.length || 0,
          objectives: savedData.objectives?.length || 0
        }
      }, null, 2));

      // Verify session is active
      expect(scormService.sessions.has(sessionId)).toBe(true);
      expect(scormService.rteInstances.has(sessionId)).toBe(true);
      console.log('✓ Session active in memory');

      // Reload (should terminate and reinitialize)
      await scormService.initializeSession(sessionId, { reload: true });
      console.log('✓ Reload completed');

      // Verify session still exists (new instance)
      expect(scormService.sessions.has(sessionId)).toBe(true);
      expect(scormService.rteInstances.has(sessionId)).toBe(true);
      console.log('✓ New session created');

      // Verify it resumed
      const rte = scormService.rteInstances.get(sessionId);
      const restoredData = rte.dataModel.getAllData();
      console.log('📊 Data loaded after reload:', JSON.stringify({
        cmiLocation: restoredData.coreData?.['cmi.location'],
        cmiExit: restoredData.coreData?.['cmi.exit'],
        cmiEntry: restoredData.coreData?.['cmi.entry'],
        hasCollections: {
          interactions: restoredData.interactions?.length || 0,
          objectives: restoredData.objectives?.length || 0
        }
      }, null, 2));
      
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('resume');
      console.log(`✓ Entry mode: ${entry} (resumed after reload)`);

      // Verify data was restored
      const location = await scormService.getValue(sessionId, 'cmi.location');
      expect(location.value).toBe('page-5');
      console.log(`✓ Location: ${location.value} (restored)`);

      await scormService.terminate(sessionId);
      console.log('✅ TEST COMPLETE: Reload terminates and resumes');
    });
  });

  describe('Error Handling with Real Course', () => {
    it('should handle missing manifest gracefully', async () => {
      console.log('\n=== TEST: Missing manifest ===');
      
      const fakePath = path.join(coursePath, 'nonexistent.xml');
      const result = await scormService.processScormManifest(fakePath);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      console.log('✓ Gracefully handled missing manifest');
      console.log('✅ TEST COMPLETE');
    });

    it('should fallback to fresh start if saved data is corrupted', async () => {
      console.log('\n=== TEST: Corrupted saved data ===');
      const sessionId = 'corrupted-test';

      // Manifest already processed in beforeEach
      // Manually write corrupted JSON
      const filePath = sessionStore.getFilePath('SCORM-Template', 'test-real-course');
      fs.writeFileSync(filePath, '{ this is not valid JSON }', 'utf8');
      console.log('✓ Wrote corrupted JSON to session file');

      // Try to initialize (should fall back to fresh start)
      const initResult = await scormService.initializeSession(sessionId);
      expect(initResult.success).toBe(true);
      console.log('✓ Initialized despite corrupted data');

      // Should be fresh start
      const rte = scormService.rteInstances.get(sessionId);
      const entry = rte.dataModel.getValue('cmi.entry');
      expect(entry).toBe('ab-initio');
      console.log(`✓ Entry mode: ${entry} (fell back to fresh start)`);

      await scormService.terminate(sessionId);
      console.log('✅ TEST COMPLETE: Corrupted data handled gracefully');
    });
  });

  describe('Data Integrity with Real Course', () => {
    it('should preserve complex data model through save/resume cycle', async () => {
      console.log('\n=== TEST: Complex data preservation ===');
      const sessionId1 = 'complex-data-1';

      // Manifest already processed in beforeEach
      // Initialize and set complex data
      await scormService.initializeSession(sessionId1);
      console.log('✓ Session initialized');

      // Set various data model elements
      const testData = {
        'cmi.location': 'module2/lesson3/page7',
        'cmi.suspend_data': JSON.stringify({
          nested: { data: [1, 2, 3] },
          unicode: '你好世界🌍',
          special: 'line\nbreak\ttab'
        }),
        'cmi.completion_status': 'incomplete',
        'cmi.success_status': 'unknown',
        'cmi.progress_measure': '0.75',
        'cmi.score.raw': '88',
        'cmi.score.max': '100',
        'cmi.score.min': '0',
        'cmi.score.scaled': '0.88',
        'cmi.exit': 'suspend'
      };

      for (const [key, value] of Object.entries(testData)) {
        const result = await scormService.setValue(sessionId1, key, value);
        expect(result.success).toBe(true);
      }
      console.log('✓ Complex data set');

      await scormService.commit(sessionId1);
      await scormService.terminate(sessionId1);
      console.log('✓ Session terminated and saved');

      // Initialize new session (should resume)
      const sessionId2 = 'complex-data-2';
      await scormService.initializeSession(sessionId2);
      console.log('✓ New session initialized');

      // Verify all data was preserved
      for (const [key, expectedValue] of Object.entries(testData)) {
        if (key === 'cmi.exit') continue; // Exit is write-only on resume

        const result = await scormService.getValue(sessionId2, key);
        expect(result.value).toBe(expectedValue);
      }
      console.log('✓ All complex data verified');

      // Specifically check the complex suspend_data
      const suspendData = await scormService.getValue(sessionId2, 'cmi.suspend_data');
      const parsed = JSON.parse(suspendData.value);
      expect(parsed.nested.data).toEqual([1, 2, 3]);
      expect(parsed.unicode).toBe('你好世界🌍');
      expect(parsed.special).toBe('line\nbreak\ttab');
      console.log('✓ Complex suspend_data preserved perfectly');

      await scormService.terminate(sessionId2);
      console.log('✅ TEST COMPLETE: Complex data integrity verified');
    });
  });
});
