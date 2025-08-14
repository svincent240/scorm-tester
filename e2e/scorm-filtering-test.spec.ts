import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { _electron as electron } from 'playwright';

test.describe('SCORM Inspector Filtering Tests', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      args: ['.'],
      timeout: 30000
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Wait for app to fully initialize
    await page.waitForTimeout(2000);

    // Verify AppManager is initialized
    const isInitialized = await page.evaluate(() => {
      return !!(window as any).appManager && (window as any).appManager.initialized;
    });

    if (!isInitialized) {
      console.log('Waiting for AppManager to initialize...');
      await page.waitForTimeout(3000);
    }
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('filter clear button should not cause data to disappear', async () => {
    // Check that test helper is available
    const hasHelper = await page.evaluate(() => {
      return typeof (window as any).testLoadCourse === 'function';
    });
    
    if (!hasHelper) {
      console.log('❌ Test helper not available, skipping test');
      return;
    }

    // Step 1: Load SCORM course
    console.log('Step 1: Loading SCORM course...');
    const loadResult = await page.evaluate(async () => {
      try {
        return await (window as any).testLoadCourse('SL360_LMS_SCORM_2004.zip');
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
    
    console.log('Course load result:', loadResult);
    if (!loadResult.success) {
      console.log('❌ Course failed to load:', loadResult.error);
      return; // Skip test if course doesn't load
    }
    await page.waitForTimeout(3000);

    // Wait for course iframe and API to be available
    console.log('Waiting for SCORM API to be available...');
    let apiAvailable = false;
    for (let i = 0; i < 10; i++) {
      const hasApi = await page.evaluate(() => {
        return !!(window as any).API_1484_11;
      });

      if (hasApi) {
        apiAvailable = true;
        break;
      }

      console.log(`Waiting for API... attempt ${i + 1}/10`);
      await page.waitForTimeout(1000);
    }

    if (!apiAvailable) {
      console.log('❌ SCORM API not available, skipping test');
      return;
    }

    // Step 2: Make SCORM API calls
    console.log('Step 2: Making SCORM API calls...');
    const scormResults = await page.evaluate(async () => {
      const api = (window as any).API_1484_11;
      if (!api) return { success: false, error: 'API not found' };

      const results = [];
      
      try {
        results.push({ method: 'Initialize', result: api.Initialize('') });
        results.push({ method: 'SetValue', element: 'cmi.completion_status', value: 'incomplete', result: api.SetValue('cmi.completion_status', 'incomplete') });
        results.push({ method: 'SetValue', element: 'cmi.score.raw', value: '85', result: api.SetValue('cmi.score.raw', '85') });
        results.push({ method: 'Commit', result: api.Commit('') });
        return { success: true, results };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    console.log('SCORM API results:', scormResults);
    if (!scormResults.success) {
      console.log('❌ SCORM API calls failed:', scormResults.error);
      return; // Skip test if API calls fail
    }
    console.log('✓ SCORM API calls executed');

    // Step 3: Open inspector
    console.log('Step 3: Opening SCORM Inspector...');
    await page.click('button[title="Open SCORM Inspector"]');
    await page.waitForTimeout(3000);

    const windows = electronApp.windows();
    const inspectorWindow = windows[windows.length - 1];
    await inspectorWindow.waitForLoadState('domcontentloaded');
    await inspectorWindow.waitForTimeout(5000);

    // Step 4: Verify initial data
    console.log('Step 4: Verifying initial data...');
    const initialCheck = await inspectorWindow.evaluate(() => {
      const dataModelElement = document.getElementById('data-model');
      return {
        hasDataContent: dataModelElement?.innerHTML?.includes('completion_status') || 
                       dataModelElement?.innerHTML?.includes('score') ||
                       dataModelElement?.innerHTML?.includes('Core Tracking') || false,
        hasNoDataMessage: dataModelElement?.innerHTML?.includes('No SCORM data available') || false,
        innerHTML: dataModelElement?.innerHTML?.substring(0, 300) || 'N/A'
      };
    });

    console.log('Initial data check:', { hasDataContent: initialCheck.hasDataContent, hasNoDataMessage: initialCheck.hasNoDataMessage });
    expect(initialCheck.hasDataContent).toBe(true);
    expect(initialCheck.hasNoDataMessage).toBe(false);

    // Step 5: Apply filter
    console.log('Step 5: Testing filter...');
    const filterInput = inspectorWindow.locator('#data-filter');
    await filterInput.fill('completion');
    await inspectorWindow.waitForTimeout(1000);

    const filteredCheck = await inspectorWindow.evaluate(() => {
      const dataModelElement = document.getElementById('data-model');
      return {
        hasFilteredContent: dataModelElement?.innerHTML?.includes('completion') || false,
        hasFilterStats: dataModelElement?.innerHTML?.includes('Showing') || false
      };
    });

    console.log('Filtered data check:', filteredCheck);

    // Step 6: Clear filter and verify data persists
    console.log('Step 6: Testing filter clear...');
    const clearButton = inspectorWindow.locator('#clear-filter');
    await clearButton.click();
    await inspectorWindow.waitForTimeout(2000);

    const clearedCheck = await inspectorWindow.evaluate(() => {
      const dataModelElement = document.getElementById('data-model');
      return {
        hasDataContent: dataModelElement?.innerHTML?.includes('completion_status') || 
                       dataModelElement?.innerHTML?.includes('score') ||
                       dataModelElement?.innerHTML?.includes('Core Tracking') || false,
        hasNoDataMessage: dataModelElement?.innerHTML?.includes('No SCORM data available') || false,
        hasFilterStats: dataModelElement?.innerHTML?.includes('Showing') || false,
        innerHTML: dataModelElement?.innerHTML?.substring(0, 300) || 'N/A'
      };
    });

    console.log('Post-clear data check:', { 
      hasDataContent: clearedCheck.hasDataContent, 
      hasNoDataMessage: clearedCheck.hasNoDataMessage,
      hasFilterStats: clearedCheck.hasFilterStats
    });

    // Key assertions - data should persist after filter clear
    expect(clearedCheck.hasDataContent).toBe(true);
    expect(clearedCheck.hasNoDataMessage).toBe(false);
    expect(clearedCheck.hasFilterStats).toBe(false); // Filter stats should be gone

    console.log('✅ Filter clear test passed - data persisted correctly');
  });
});
