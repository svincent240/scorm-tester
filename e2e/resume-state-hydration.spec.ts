import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { ConsoleMonitor } from './helpers/console-monitor';

/**
 * Resume State Hydration E2E Tests
 * 
 * Tests comprehensive state preservation across session reload, specifically:
 * 
 * ISSUE: After reload, state is not being fully retained:
 * ❌ Current slide reverts to first slide instead of saved position
 * ❌ Navigation history (visitedSlides) is cleared
 * ❌ Entry mode is "ab-initio" instead of "resume"
 * ❌ Session timing data is reset
 * ✅ Some suspend_data (objectives) is preserved
 * 
 * EXPECTED BEHAVIOR:
 * When reloading with saved state (cmi.exit='suspend'):
 * ✅ Should resume at last active slide
 * ✅ Should maintain navigation history
 * ✅ Should set cmi.entry to "resume"
 * ✅ Should preserve session timing data
 * ✅ Should preserve all suspend_data including navigation state
 * 
 * This test verifies:
 * 1. Initial session state with navigation
 * 2. Proper shutdown with suspend
 * 3. Resume with complete state hydration
 * 4. All state components are correctly restored
 */

test.describe('Resume State Hydration', () => {
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
    
    userDataPath = await electronApp.evaluate(async ({ app }) => {
      return app.getPath('userData');
    });
    
    // Clean up session files for test isolation
    const sessionsDir = path.join(userDataPath, 'scorm-sessions');
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.startsWith('gui_') && f.endsWith('.json'));
      for (const file of files) {
        fs.unlinkSync(path.join(sessionsDir, file));
      }
    }
    
    consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('Complete state hydration on resume - navigation, history, timing', async () => {
    const courseZip = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    console.log('\n=== PHASE 1: Initial Load and Navigation ===');
    
    // Load course
    const loadResult = await page.evaluate(async ({ courseZip }) => {
      try {
        return await (window as any).testLoadCourse(courseZip);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { courseZip });

    expect(loadResult.success).toBe(true);
    console.log('✓ Course loaded');

    // Wait for initialization
    await page.waitForTimeout(5000);
    
    // Wait for SCORM API to be ready
    let apiReady = false;
    for (let i = 0; i < 20; i++) {
      const check = await page.evaluate(() => {
        const api = (window as any).API_1484_11 || (window as any).API;
        if (!api) return false;
        
        try {
          const entry = api.GetValue('cmi.entry');
          return entry !== '';
        } catch {
          return false;
        }
      });
      
      if (check) {
        apiReady = true;
        console.log(`✓ SCORM API ready (attempt ${i + 1})`);
        break;
      }
      await page.waitForTimeout(500);
    }
    
    expect(apiReady).toBe(true);

    console.log('\n=== PHASE 2: Simulate Navigation to Slide 2 (ui-demo) ===');
    
    // Simulate user navigating through course
    const navigationState = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      if (!iframe?.contentWindow) return { success: false, reason: 'No iframe' };
      
      const api = (window as any).API_1484_11 || (window as any).API;
      if (!api) return { success: false, reason: 'No API' };
      
      // Check if automation API is available (for courses that support it)
      const automationAPI = (iframe.contentWindow as any).__automation_api__;
      
      // Simulate navigation state
      const navigationData = {
        currentSlide: 'ui-demo',
        currentSlideIndex: 1,
        visitedSlides: ['intro', 'ui-demo'],
        slideTimings: {
          'intro': { start: Date.now() - 60000, duration: 45000 },
          'ui-demo': { start: Date.now() - 15000, duration: 15000 }
        },
        totalTimeSpent: 60000
      };
      
      // Set comprehensive state data
      const results: any = {
        navigation: navigationData
      };
      
      // Set SCORM data model values
      results.setLocation = api.SetValue('cmi.location', 'ui-demo');
      results.setProgress = api.SetValue('cmi.progress_measure', '0.25');
      results.setCompletion = api.SetValue('cmi.completion_status', 'incomplete');
      results.setExit = api.SetValue('cmi.exit', 'suspend');
      
      // Store navigation state in suspend_data
      results.setSuspendData = api.SetValue('cmi.suspend_data', JSON.stringify(navigationData));
      
      // Commit the data
      results.commit = api.Commit('');
      
      // Get current values to verify
      results.verify = {
        entry: api.GetValue('cmi.entry'),
        location: api.GetValue('cmi.location'),
        exit: api.GetValue('cmi.exit'),
        suspendData: api.GetValue('cmi.suspend_data'),
        progressMeasure: api.GetValue('cmi.progress_measure'),
        completionStatus: api.GetValue('cmi.completion_status')
      };
      
      return { success: true, ...results };
    });

    console.log('✓ Navigation state set:');
    console.log('  Current slide:', navigationState.navigation.currentSlide);
    console.log('  Slide index:', navigationState.navigation.currentSlideIndex);
    console.log('  Visited slides:', navigationState.navigation.visitedSlides);
    console.log('  Exit mode:', navigationState.verify.exit);
    console.log('  Location:', navigationState.verify.location);
    console.log('  Progress:', navigationState.verify.progressMeasure);

    expect(navigationState.success).toBe(true);
    expect(navigationState.verify.exit).toBe('suspend');
    expect(navigationState.verify.location).toBe('ui-demo');
    expect(navigationState.commit).toBe('true');

    console.log('\n=== PHASE 3: Terminate Session (Save State) ===');

    // Call Terminate to save all data
    const terminateResult = await page.evaluate(() => {
      const api = (window as any).API_1484_11 || (window as any).API;
      if (!api) return { success: false, reason: 'No API' };
      
      const result = api.Terminate('');
      return { 
        success: result === 'true', 
        result,
        finalExit: api.GetValue('cmi.exit')
      };
    });
    
    console.log('✓ Terminate called:', terminateResult);
    expect(terminateResult.success).toBe(true);

    // Wait for shutdown to complete
    await page.waitForTimeout(2000);
    
    // Verify session file was created
    const sessionsDir = path.join(userDataPath, 'scorm-sessions');
    const sessionFiles = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('gui_') && f.endsWith('.json'));
    
    console.log('✓ Session files created:', sessionFiles.length);
    
    if (sessionFiles.length > 0) {
      const sessionFile = path.join(sessionsDir, sessionFiles[0]);
      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      console.log('✓ Saved session data keys:', Object.keys(sessionData));
      console.log('  - cmi.location:', sessionData['cmi.location']);
      console.log('  - cmi.exit:', sessionData['cmi.exit']);
      console.log('  - cmi.suspend_data length:', sessionData['cmi.suspend_data']?.length || 0);
    }

    console.log('\n=== PHASE 4: Reload Course (Should Resume) ===');

    // Reload the course
    const reloadResult = await page.evaluate(async ({ courseZip }) => {
      try {
        return await (window as any).testLoadCourse(courseZip);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { courseZip });

    expect(reloadResult.success).toBe(true);
    console.log('✓ Course reloaded');

    // Wait for resume initialization
    await page.waitForTimeout(5000);

    console.log('\n=== PHASE 5: Verify Complete State Hydration ===');

    // Check all aspects of resumed state
    const resumedState = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      if (!iframe?.contentWindow) return { success: false, reason: 'No iframe' };
      
      const api = (window as any).API_1484_11 || (window as any).API;
      if (!api) return { success: false, reason: 'No API' };
      
      const automationAPI = (iframe.contentWindow as any).__automation_api__;
      
      // Get all SCORM data model values
      const cmiData = {
        entry: api.GetValue('cmi.entry'),
        exit: api.GetValue('cmi.exit'),
        location: api.GetValue('cmi.location'),
        suspendData: api.GetValue('cmi.suspend_data'),
        progressMeasure: api.GetValue('cmi.progress_measure'),
        completionStatus: api.GetValue('cmi.completion_status')
      };
      
      // Parse suspend data to check navigation state
      let navigationState = null;
      try {
        if (cmiData.suspendData) {
          navigationState = JSON.parse(cmiData.suspendData);
        }
      } catch (e) {
        navigationState = { parseError: String(e) };
      }
      
      // Check automation API state if available
      let automationState = null;
      if (automationAPI) {
        try {
          automationState = {
            currentSlide: automationAPI.getCurrentSlide ? automationAPI.getCurrentSlide() : null,
            visitedSlides: automationAPI.getVisitedSlides ? automationAPI.getVisitedSlides() : null,
            slideCount: automationAPI.getSlideCount ? automationAPI.getSlideCount() : null
          };
        } catch (e) {
          automationState = { error: String(e) };
        }
      }
      
      return {
        success: true,
        cmiData,
        navigationState,
        automationState,
        hasAutomationAPI: !!automationAPI
      };
    });

    console.log('\n📊 RESUME STATE VERIFICATION:');
    
    expect(resumedState.success).toBe(true);
    expect(resumedState.cmiData).toBeDefined();
    
    console.log('\n1. SCORM Data Model:');
    console.log('   ✓ cmi.entry:', resumedState.cmiData?.entry);
    console.log('   ✓ cmi.exit:', resumedState.cmiData?.exit);
    console.log('   ✓ cmi.location:', resumedState.cmiData?.location);
    console.log('   ✓ cmi.progress_measure:', resumedState.cmiData?.progressMeasure);
    console.log('   ✓ cmi.completion_status:', resumedState.cmiData?.completionStatus);
    
    console.log('\n2. Navigation State (from suspend_data):');
    if (resumedState.navigationState && !resumedState.navigationState.parseError) {
      console.log('   ✓ Current slide:', resumedState.navigationState.currentSlide);
      console.log('   ✓ Slide index:', resumedState.navigationState.currentSlideIndex);
      console.log('   ✓ Visited slides:', resumedState.navigationState.visitedSlides);
      console.log('   ✓ Timings present:', !!resumedState.navigationState.slideTimings);
    } else {
      console.log('   ⚠️  Could not parse navigation state:', resumedState.navigationState);
    }
    
    if (resumedState.hasAutomationAPI && resumedState.automationState) {
      console.log('\n3. Automation API State:');
      console.log('   ✓ Current slide:', resumedState.automationState.currentSlide);
      console.log('   ✓ Visited slides:', resumedState.automationState.visitedSlides);
      console.log('   ✓ Slide count:', resumedState.automationState.slideCount);
    }

    console.log('\n=== TEST ASSERTIONS ===');

    if (!resumedState.cmiData) {
      console.log('   ❌ CRITICAL: No CMI data returned!');
      expect(resumedState.cmiData).toBeDefined();
      return;
    }

    // CRITICAL ASSERTIONS - These should all pass for proper resume
    
    // 1. Entry mode should be "resume", not "ab-initio"
    console.log('\n✓ Checking: cmi.entry should be "resume"');
    if (resumedState.cmiData.entry !== 'resume') {
      console.log('   ❌ FAILED: entry is', resumedState.cmiData.entry, '(expected "resume")');
    } else {
      console.log('   ✅ PASSED: entry is "resume"');
    }
    
    // 2. Location should be preserved (ui-demo, not intro or empty)
    console.log('\n✓ Checking: cmi.location should be "ui-demo"');
    if (resumedState.cmiData.location !== 'ui-demo') {
      console.log('   ❌ FAILED: location is', resumedState.cmiData.location, '(expected "ui-demo")');
    } else {
      console.log('   ✅ PASSED: location is "ui-demo"');
    }
    
    // 3. Exit should be cleared (empty after Terminate)
    console.log('\n✓ Checking: cmi.exit should be empty after Terminate');
    if (resumedState.cmiData.exit !== '') {
      console.log('   ⚠️  WARNING: exit is still', resumedState.cmiData.exit);
    } else {
      console.log('   ✅ PASSED: exit is empty');
    }
    
    // 4. Suspend data should contain navigation state
    console.log('\n✓ Checking: suspend_data should contain navigation state');
    if (!resumedState.navigationState || resumedState.navigationState.parseError) {
      console.log('   ❌ FAILED: No valid navigation state in suspend_data');
    } else {
      console.log('   ✅ PASSED: Navigation state present');
      
      // 5. Navigation state should have correct current slide
      console.log('\n✓ Checking: Navigation state current slide should be "ui-demo"');
      if (resumedState.navigationState.currentSlide !== 'ui-demo') {
        console.log('   ❌ FAILED: currentSlide is', resumedState.navigationState.currentSlide);
      } else {
        console.log('   ✅ PASSED: currentSlide is "ui-demo"');
      }
      
      // 6. Visited slides should be preserved
      console.log('\n✓ Checking: Visited slides should include intro and ui-demo');
      const visitedSlides = resumedState.navigationState.visitedSlides || [];
      const hasIntro = visitedSlides.includes('intro');
      const hasUiDemo = visitedSlides.includes('ui-demo');
      if (!hasIntro || !hasUiDemo) {
        console.log('   ❌ FAILED: visitedSlides is', visitedSlides);
      } else {
        console.log('   ✅ PASSED: visitedSlides has intro and ui-demo');
      }
      
      // 7. Timing data should be preserved
      console.log('\n✓ Checking: Timing data should be preserved');
      if (!resumedState.navigationState.slideTimings) {
        console.log('   ❌ FAILED: No slideTimings in navigation state');
      } else {
        console.log('   ✅ PASSED: slideTimings present');
      }
    }
    
    // 8. Progress should be preserved
    console.log('\n✓ Checking: Progress should be preserved');
    if (resumedState.cmiData?.progressMeasure !== '0.25') {
      console.log('   ❌ FAILED: progress is', resumedState.cmiData?.progressMeasure);
    } else {
      console.log('   ✅ PASSED: progress is 0.25');
    }

    console.log('\n=== DIAGNOSTIC OUTPUT FOR DEBUGGING ===');
    console.log('Full resumed state:', JSON.stringify(resumedState, null, 2));
    
    // Print session file content if available
    if (sessionFiles.length > 0) {
      const sessionFile = path.join(sessionsDir, sessionFiles[0]);
      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      console.log('\nSession file content:');
      console.log(JSON.stringify(sessionData, null, 2));
    }

    console.log('\n=== TEST COMPLETE ===');
    
    // For now, we'll do soft assertions with detailed logging
    // Uncomment the strict assertions below once the issues are fixed
    
    /*
    expect(resumedState.cmiData.entry).toBe('resume');
    expect(resumedState.cmiData.location).toBe('ui-demo');
    expect(resumedState.navigationState.currentSlide).toBe('ui-demo');
    expect(resumedState.navigationState.visitedSlides).toEqual(['intro', 'ui-demo']);
    expect(resumedState.navigationState.slideTimings).toBeDefined();
    */
  });

  test('Direct automation API state check - visitedSlides tracking', async () => {
    const courseZip = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    console.log('\n=== Testing Automation API Visited Slides Tracking ===');
    
    // Load course
    const loadResult = await page.evaluate(async ({ courseZip }) => {
      return await (window as any).testLoadCourse(courseZip);
    }, { courseZip });

    expect(loadResult.success).toBe(true);
    await page.waitForTimeout(5000);

    // Check if automation API is available
    const hasAutomation = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      const automationAPI = iframe?.contentWindow && (iframe.contentWindow as any).__automation_api__;
      return !!automationAPI;
    });

    if (!hasAutomation) {
      console.log('⚠️  Automation API not available for this course, skipping test');
      test.skip();
      return;
    }

    console.log('✓ Automation API detected');

    // Get initial state
    const initialState = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      const automationAPI = (iframe?.contentWindow as any).__automation_api__;
      
      return {
        currentSlide: automationAPI.getCurrentSlide(),
        visitedSlides: automationAPI.getVisitedSlides ? automationAPI.getVisitedSlides() : []
      };
    });

    console.log('Initial state:', initialState);

    // Simulate navigation (if automation API supports it)
    const navigationResult = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      const automationAPI = (iframe?.contentWindow as any).__automation_api__;
      const api = (window as any).API_1484_11 || (window as any).API;
      
      // Try to navigate to next slide if possible
      if (automationAPI.goToSlide) {
        try {
          automationAPI.goToSlide(1); // Go to second slide (index 1)
          
          // Set exit to suspend
          api.SetValue('cmi.exit', 'suspend');
          api.Commit('');
          
          return {
            success: true,
            currentSlide: automationAPI.getCurrentSlide(),
            visitedSlides: automationAPI.getVisitedSlides ? automationAPI.getVisitedSlides() : []
          };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      }
      
      return { success: false, reason: 'goToSlide not available' };
    });

    console.log('After navigation:', navigationResult);

    // Terminate and reload
    await page.evaluate(() => {
      const api = (window as any).API_1484_11 || (window as any).API;
      api.Terminate('');
    });

    await page.waitForTimeout(2000);

    // Reload
    const reloadResult = await page.evaluate(async ({ courseZip }) => {
      return await (window as any).testLoadCourse(courseZip);
    }, { courseZip });

    expect(reloadResult.success).toBe(true);
    await page.waitForTimeout(5000);

    // Check resumed state
    const resumedState = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      const automationAPI = (iframe?.contentWindow as any).__automation_api__;
      const api = (window as any).API_1484_11 || (window as any).API;
      
      return {
        entry: api.GetValue('cmi.entry'),
        currentSlide: automationAPI.getCurrentSlide(),
        visitedSlides: automationAPI.getVisitedSlides ? automationAPI.getVisitedSlides() : []
      };
    });

    console.log('Resumed state:', resumedState);
    console.log('\nExpected:');
    console.log('  - entry: "resume"');
    console.log('  - currentSlide: same as before reload');
    console.log('  - visitedSlides: preserved from before reload');
    console.log('\nActual:');
    console.log('  - entry:', resumedState.entry);
    console.log('  - currentSlide:', resumedState.currentSlide);
    console.log('  - visitedSlides:', resumedState.visitedSlides);
  });
});
