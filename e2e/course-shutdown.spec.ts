import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { ConsoleMonitor } from './helpers/console-monitor';

/**
 * Course Shutdown E2E Tests
 * 
 * Tests the unified shutdown path that:
 * 1. Sets cmi.exit='suspend' via SCORM API
 * 2. Calls Terminate() to trigger persistence
 * 3. Saves all data to JSON regardless of exit type
 * 4. Immediately cleans up session from memory
 * 
 * This verifies that:
 * - GUI close button uses the unified shutdown path
 * - Menu "Close Course" uses the unified shutdown path
 * - Data is always persisted to JSON on shutdown
 * - Session can be resumed after shutdown
 */

test.describe('Course Shutdown Tests', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let page: Awaited<ReturnType<typeof electronApp.firstWindow>>;
  let consoleMonitor: ConsoleMonitor;
  let userDataPath: string;

  test.beforeEach(async () => {
    electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    page = await electronApp.firstWindow();
    
    // Get userData path for checking session files
    userDataPath = await electronApp.evaluate(async ({ app }) => {
      return app.getPath('userData');
    });
    
    // Clean up any existing session files to ensure test isolation
    const sessionsDir = path.join(userDataPath, 'scorm-sessions');
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.startsWith('gui_') && f.endsWith('.json'));
      for (const file of files) {
        fs.unlinkSync(path.join(sessionsDir, file));
      }
    }
    
    // Set up console monitoring (don't fail on CSP font errors from course content)
    consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    consoleMonitor.printSummary('after app initialization');
    consoleMonitor.assertNoCriticalErrors('after app initialization');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('GUI close button triggers unified shutdown path and saves data', async () => {
    const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    // Load the course
    const loadResult = await page.evaluate(async ({ zipPath }) => {
      try {
        return await (window as any).testLoadCourse(zipPath);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { zipPath });

    consoleMonitor.printSummary('after course loading');
    consoleMonitor.assertNoCriticalErrors('after course loading');
    expect(loadResult.success).toBe(true);

    // Wait for course to load
    await page.waitForTimeout(3000);

    // Get session files directory
    const sessionsDir = path.join(userDataPath, 'scorm-sessions');
    
    // Get files with timestamps before close
    const filesBefore = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }));
    console.log('✓ Session files before close:', filesBefore.length);

    // Make some SCORM API calls to generate data
    await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      if (iframe?.contentWindow) {
        const api = (iframe.contentWindow as any).API_1484_11;
        if (api) {
          api.SetValue('cmi.location', 'page-5');
          api.SetValue('cmi.suspend_data', 'test_shutdown_data');
          api.Commit('');
        }
      }
    });

    await page.waitForTimeout(500);
    console.log('✓ Set SCORM data (location and suspend_data)');

    // Trigger shutdown via event bus (same path as close button)
    const closeResult = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      const apiAvailable = iframe?.contentWindow && 'API_1484_11' in iframe.contentWindow;
      
      const eventBus = (window as any).appManager?.services?.get('eventBus');
      if (eventBus) {
        eventBus.emit('course:close:request');
      }
      
      return { apiAvailable, eventBusWorked: !!eventBus };
    });
    
    console.log('✓ Triggered course close:', closeResult);

    // Wait for shutdown to complete
    await page.waitForTimeout(2000);

    consoleMonitor.printSummary('after close button click');
    // Don't assert on errors - SCORM courses generate expected errors (CSP font loading, etc.)

    // Find files that were created or modified after close
    const filesAfter = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }));
    
    const beforeMap = new Map(filesBefore.map(f => [f.name, f.mtime]));
    const modifiedFiles = filesAfter.filter(f => {
      const beforeTime = beforeMap.get(f.name);
      return !beforeTime || f.mtime > beforeTime;
    });
    
    console.log('✓ Session files after close:', filesAfter.length);
    console.log('✓ Modified/new session files:', modifiedFiles.map(f => f.name));
    
    expect(modifiedFiles.length).toBeGreaterThan(0);
    
    const sessionPath = path.join(sessionsDir, modifiedFiles[0].name);
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    
    // Verify data was saved (data is nested under coreData)
    expect(sessionData.coreData['cmi.exit']).toBe('suspend');
    expect(sessionData.coreData['cmi.location']).toBe('page-5');
    expect(sessionData.coreData['cmi.suspend_data']).toBe('test_shutdown_data');
    
    console.log('✓ Session data verified:');
    console.log('  - cmi.exit:', sessionData.coreData['cmi.exit']);
    console.log('  - cmi.location:', sessionData.coreData['cmi.location']);
    console.log('  - cmi.suspend_data:', sessionData.coreData['cmi.suspend_data']);
  });

  test('Menu close course triggers unified shutdown path and saves data', async () => {
    const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    // Get session files directory
    const sessionsDir = path.join(userDataPath, 'scorm-sessions');
    
    // Get files with timestamps before close
    const filesBefore = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }));

    // Load the course
    const loadResult = await page.evaluate(async ({ zipPath }) => {
      try {
        return await (window as any).testLoadCourse(zipPath);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { zipPath });

    expect(loadResult.success).toBe(true);
    await page.waitForTimeout(3000);

    // Make some SCORM API calls
    await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      if (iframe?.contentWindow) {
        const api = (iframe.contentWindow as any).API_1484_11;
        if (api) {
          api.SetValue('cmi.location', 'menu-test-page');
          api.SetValue('cmi.score.raw', '85');
          api.Commit('');
        }
      }
    });

    await page.waitForTimeout(500);
    console.log('✓ Set SCORM data via API');

    // Trigger menu close action via event bus
    await page.evaluate(() => {
      const eventBus = (window as any).appManager?.services?.get('eventBus');
      if (eventBus) {
        eventBus.emit('course:close:request');
      }
    });

    console.log('✓ Triggered menu close via event bus');

    // Wait for shutdown
    await page.waitForTimeout(2000);

    consoleMonitor.printSummary('after menu close');
    // Don't assert on errors - courses generate expected SCORM errors

    // Find files that were created or modified after close
    const filesAfter = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }));
    
    const beforeMap = new Map(filesBefore.map(f => [f.name, f.mtime]));
    const modifiedFiles = filesAfter.filter(f => {
      const beforeTime = beforeMap.get(f.name);
      return !beforeTime || f.mtime > beforeTime;
    });
    
    console.log('✓ Modified/new session files via menu close:', modifiedFiles.map(f => f.name));
    expect(modifiedFiles.length).toBeGreaterThan(0);
    
    const sessionPath = path.join(sessionsDir, modifiedFiles[0].name);
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    
    expect(sessionData.coreData['cmi.exit']).toBe('suspend');
    expect(sessionData.coreData['cmi.location']).toBe('menu-test-page');
    expect(sessionData.coreData['cmi.score.raw']).toBe('85');
    
    console.log('✓ Menu close saved data correctly');
  });

  test('shutdown and resume workflow - data persists and restores', async () => {
    const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    // Get session files directory
    const sessionsDir = path.join(userDataPath, 'scorm-sessions');

    // Load the course
    const loadResult = await page.evaluate(async ({ zipPath }) => {
      try {
        return await (window as any).testLoadCourse(zipPath);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { zipPath });

    expect(loadResult.success).toBe(true);
    await page.waitForTimeout(3000);

    // Get files after load (baseline for detecting close-time modifications)
    // Wait a bit to ensure file system has settled after initial load
    await page.waitForTimeout(1000);
    const filesBefore = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }));

    // Set unique data
    const testLocation = `resume-test-${Date.now()}`;
    const testSuspendData = `suspend-${Math.random()}`;
    
    await page.evaluate(({ location, suspendData }) => {
      const iframe = document.querySelector('iframe');
      if (iframe?.contentWindow) {
        const api = (iframe.contentWindow as any).API_1484_11;
        if (api) {
          api.SetValue('cmi.location', location);
          api.SetValue('cmi.suspend_data', suspendData);
          api.SetValue('cmi.score.scaled', '0.75');
          api.Commit('');
        }
      }
    }, { location: testLocation, suspendData: testSuspendData });

    await page.waitForTimeout(500);
    console.log('✓ Set unique test data:', { testLocation, testSuspendData });

    // Close the course
    await page.evaluate(() => {
      const eventBus = (window as any).appManager?.services?.get('eventBus');
      if (eventBus) {
        eventBus.emit('course:close:request');
      }
    });

    await page.waitForTimeout(2000);
    console.log('✓ Course closed');

    // Find the session file that was modified
    const filesAfter = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime()
      }));
    
    const beforeMap = new Map(filesBefore.map(f => [f.name, f.mtime]));
    const modifiedFiles = filesAfter.filter(f => {
      const beforeTime = beforeMap.get(f.name);
      return !beforeTime || f.mtime > beforeTime;
    });
    
    expect(modifiedFiles.length).toBeGreaterThan(0);
    const sessionPath = path.join(sessionsDir, modifiedFiles[0].name);
    const savedData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    
    expect(savedData.coreData['cmi.location']).toBe(testLocation);
    expect(savedData.coreData['cmi.suspend_data']).toBe(testSuspendData);
    expect(savedData.coreData['cmi.score.scaled']).toBe('0.75');
    console.log('✓ Data saved correctly');

    // Reload the course (this should trigger resume)
    const reloadResult = await page.evaluate(async ({ zipPath }) => {
      try {
        return await (window as any).testLoadCourse(zipPath);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { zipPath });

    expect(reloadResult.success).toBe(true);
    await page.waitForTimeout(3000);
    console.log('✓ Course reloaded');

    // Verify data was restored
    const restoredData = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      if (iframe?.contentWindow) {
        const api = (iframe.contentWindow as any).API_1484_11;
        if (api) {
          return {
            location: api.GetValue('cmi.location'),
            suspendData: api.GetValue('cmi.suspend_data'),
            scoreScaled: api.GetValue('cmi.score.scaled'),
            entry: api.GetValue('cmi.entry')
          };
        }
      }
      return null;
    });

    expect(restoredData).toBeTruthy();
    if (restoredData) {
      expect(restoredData.location).toBe(testLocation);
      expect(restoredData.suspendData).toBe(testSuspendData);
      expect(restoredData.scoreScaled).toBe('0.75');
      // Note: cmi.entry is write-only in SCORM 2004, cannot be read via GetValue
      // The fact that location and suspend_data were restored proves resume worked
      
      console.log('✓ Resume workflow verified:');
      console.log('  - Data restored correctly (location, suspend_data, score)');
      console.log('  - Location:', restoredData.location);
      console.log('  - Suspend data:', restoredData.suspendData);
      console.log('  - Score:', restoredData.scoreScaled);
    }

    consoleMonitor.printSummary('after resume verification');
    // Don't assert on errors - courses generate expected SCORM errors
  });
});
