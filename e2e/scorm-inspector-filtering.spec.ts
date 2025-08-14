import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { _electron as electron } from 'playwright';

test.describe('SCORM Inspector Filtering Tests', () => {
  let electronApp: ElectronApplication;
  let mainWindow: Page;
  let inspectorWindow: Page;

  test.beforeAll(async () => {
    // Launch Electron app
    electronApp = await electron.launch({ 
      args: ['.'],
      timeout: 30000
    });
    
    // Get the main window
    mainWindow = await electronApp.firstWindow();
    await mainWindow.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test('filter clear button should not cause data to disappear', async () => {
    // Check that test helper is available
    const hasHelper = await mainWindow.evaluate(() => {
      return typeof (window as any).testLoadCourse === 'function';
    });

    if (!hasHelper) {
      console.log('Test helper not available, skipping test');
      return;
    }

    // Step 1: Load a SCORM course
    console.log('Step 1: Loading SCORM course...');

    const courseLoadResult = await mainWindow.evaluate(async () => {
      try {
        return await (window as any).testLoadCourse('references/BasicCourse');
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(courseLoadResult.success).toBe(true);
    console.log('✓ Course loading initiated successfully');

    // Wait for course to load
    await mainWindow.waitForTimeout(2000);

    // Step 2: Make some SCORM API calls to populate data
    console.log('Step 2: Making SCORM API calls...');
    
    const scormResults = await mainWindow.evaluate(async () => {
      const api = (window as any).API_1484_11;
      if (!api) return { success: false, error: 'API not found' };

      const results = [];
      
      // Initialize
      results.push({ method: 'Initialize', result: api.Initialize('') });
      
      // Set some values
      results.push({ 
        method: 'SetValue', 
        element: 'cmi.completion_status', 
        value: 'incomplete',
        result: api.SetValue('cmi.completion_status', 'incomplete') 
      });
      
      results.push({ 
        method: 'SetValue', 
        element: 'cmi.score.raw', 
        value: '85',
        result: api.SetValue('cmi.score.raw', '85') 
      });
      
      // Commit
      results.push({ method: 'Commit', result: api.Commit('') });

      return { success: true, results };
    });

    expect(scormResults.success).toBe(true);
    console.log('✓ SCORM API calls executed successfully');

    // Step 3: Open SCORM Inspector
    console.log('Step 3: Opening SCORM Inspector...');
    
    await mainWindow.click('button[title="Open SCORM Inspector"]');
    await mainWindow.waitForTimeout(2000);

    // Get inspector window
    const windows = electronApp.windows();
    inspectorWindow = windows.find(w => w.url().includes('scorm-inspector')) || windows[1];
    
    expect(inspectorWindow).toBeDefined();
    await inspectorWindow.waitForLoadState('domcontentloaded');
    console.log('✓ Inspector window opened');

    // Step 4: Wait for data to load and verify it's present
    console.log('Step 4: Waiting for data to load...');
    await inspectorWindow.waitForTimeout(3000);

    // Check if data model has content
    const initialDataCheck = await inspectorWindow.evaluate(() => {
      const dataModelElement = document.getElementById('data-model');
      const hasNoDataMessage = dataModelElement?.innerHTML?.includes('No SCORM data available');
      const hasDataContent = dataModelElement?.innerHTML?.includes('cmi.') || 
                            dataModelElement?.innerHTML?.includes('completion_status') ||
                            dataModelElement?.innerHTML?.includes('score');
      
      return {
        hasDataModelElement: !!dataModelElement,
        hasNoDataMessage,
        hasDataContent,
        innerHTML: dataModelElement?.innerHTML?.substring(0, 500) || 'N/A'
      };
    });

    console.log('Initial data check:', initialDataCheck);

    // Step 5: Test filtering functionality
    console.log('Step 5: Testing filter functionality...');

    // Type in filter
    const filterInput = inspectorWindow.locator('#data-filter');
    await filterInput.fill('completion');
    await inspectorWindow.waitForTimeout(500);

    // Check that filter is applied
    const filteredDataCheck = await inspectorWindow.evaluate(() => {
      const dataModelElement = document.getElementById('data-model');
      const hasFilterStats = dataModelElement?.innerHTML?.includes('Showing');
      const hasCompletionData = dataModelElement?.innerHTML?.includes('completion');
      
      return {
        hasFilterStats,
        hasCompletionData,
        innerHTML: dataModelElement?.innerHTML?.substring(0, 500) || 'N/A'
      };
    });

    console.log('Filtered data check:', filteredDataCheck);

    // Step 6: Clear filter and check for data persistence
    console.log('Step 6: Testing filter clear...');

    const clearButton = inspectorWindow.locator('#clear-filter');
    await clearButton.click();
    await inspectorWindow.waitForTimeout(1000);

    // Check that data is still present after clearing filter
    const clearedDataCheck = await inspectorWindow.evaluate(() => {
      const dataModelElement = document.getElementById('data-model');
      const hasNoDataMessage = dataModelElement?.innerHTML?.includes('No SCORM data available');
      const hasDataContent = dataModelElement?.innerHTML?.includes('cmi.') || 
                            dataModelElement?.innerHTML?.includes('completion_status') ||
                            dataModelElement?.innerHTML?.includes('score');
      const hasFilterStats = dataModelElement?.innerHTML?.includes('Showing');
      
      return {
        hasNoDataMessage,
        hasDataContent,
        hasFilterStats,
        innerHTML: dataModelElement?.innerHTML?.substring(0, 500) || 'N/A'
      };
    });

    console.log('Cleared data check:', clearedDataCheck);

    // Assertions
    expect(clearedDataCheck.hasNoDataMessage).toBe(false);
    expect(clearedDataCheck.hasDataContent).toBe(true);
    expect(clearedDataCheck.hasFilterStats).toBe(false); // Filter stats should be gone

    console.log('✓ Filter clear test completed successfully');
  });
});
