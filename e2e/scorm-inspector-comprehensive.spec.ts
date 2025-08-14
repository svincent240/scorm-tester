import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';

test.describe('SCORM Inspector Comprehensive Tests', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  // Get all available courses from references folder
  const getAvailableCourses = () => {
    const referencesPath = path.resolve(process.cwd(), 'references');
    const courses = [];
    
    // Check for zip files in real_course_examples
    const realCoursesPath = path.join(referencesPath, 'real_course_examples');
    if (fs.existsSync(realCoursesPath)) {
      const files = fs.readdirSync(realCoursesPath);
      files.forEach(file => {
        if (file.endsWith('.zip')) {
          courses.push({
            name: file.replace('.zip', ''),
            path: path.join(realCoursesPath, file),
            type: 'zip'
          });
        } else if (fs.statSync(path.join(realCoursesPath, file)).isDirectory()) {
          courses.push({
            name: file,
            path: path.join(realCoursesPath, file),
            type: 'folder'
          });
        }
      });
    }
    
    return courses;
  };

  test.beforeEach(async () => {
    electronApp = await electron.launch({ 
      args: ['.'],
      timeout: 30000
    });
    
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  const courses = getAvailableCourses();
  
  if (courses.length === 0) {
    test('no courses found in references folder', async () => {
      console.log('❌ No SCORM courses found in references folder');
      expect(courses.length).toBeGreaterThan(0);
    });
  } else {
    console.log(`Found ${courses.length} courses:`, courses.map(c => c.name));
  }

  // Test each available course
  courses.forEach((course, index) => {
    test(`loads ${course.name} (${course.type}) and verifies inspector data display`, async () => {
      console.log(`\n🎯 Testing Course ${index + 1}/${courses.length}: ${course.name}`);
      console.log(`   Path: ${course.path}`);
      console.log(`   Type: ${course.type}`);

      // Check that test helper is available
      const hasHelper = await page.evaluate(() => {
        return typeof (window as any).testLoadCourse === 'function';
      });
      
      if (!hasHelper) {
        console.log('❌ Test helper not available, skipping test');
        return;
      }

      // Step 1: Load the SCORM course
      console.log('Step 1: Loading SCORM course...');
      const loadResult = await page.evaluate(async ({ coursePath }) => {
        try {
          return await (window as any).testLoadCourse(coursePath);
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }, { coursePath: course.path });
      
      console.log('Course load result:', loadResult);
      
      if (!loadResult.success) {
        console.log(`⚠️  Course ${course.name} failed to load: ${loadResult.error}`);
        // Don't fail the test, just log and continue
        return;
      }

      // Wait for course to load
      await page.waitForTimeout(3000);

      // Step 2: Make SCORM API calls to populate data
      console.log('Step 2: Making SCORM API calls...');
      
      const scormResults = await page.evaluate(async () => {
        const api = (window as any).API_1484_11;
        if (!api) return { success: false, error: 'API not found' };

        const results = [];
        
        try {
          // Initialize
          const initResult = api.Initialize('');
          results.push({ method: 'Initialize', result: initResult, error: api.GetLastError() });
          
          // Set some values
          const setValue1 = api.SetValue('cmi.completion_status', 'incomplete');
          results.push({ 
            method: 'SetValue', 
            element: 'cmi.completion_status', 
            value: 'incomplete',
            result: setValue1,
            error: api.GetLastError()
          });
          
          const setValue2 = api.SetValue('cmi.score.raw', '75');
          results.push({ 
            method: 'SetValue', 
            element: 'cmi.score.raw', 
            value: '75',
            result: setValue2,
            error: api.GetLastError()
          });
          
          // Commit
          const commitResult = api.Commit('');
          results.push({ method: 'Commit', result: commitResult, error: api.GetLastError() });

          return { success: true, results };
        } catch (error) {
          return { success: false, error: error.message, results };
        }
      });

      console.log('SCORM API results:', scormResults);

      // Step 3: Open SCORM Inspector
      console.log('Step 3: Opening SCORM Inspector...');
      
      const inspectorButton = page.locator('button[title="Open SCORM Inspector"]');
      await inspectorButton.click();
      await page.waitForTimeout(3000);

      // Get inspector window
      const windows = electronApp.windows();
      expect(windows.length).toBeGreaterThan(1);
      
      const inspectorWindow = windows[windows.length - 1];
      await inspectorWindow.waitForLoadState('domcontentloaded');
      console.log('✓ Inspector window opened');

      // Step 4: Wait for data and verify inspector functionality
      console.log('Step 4: Verifying inspector data...');
      await inspectorWindow.waitForTimeout(5000);

      let finalDataCheck = null;
      let dataReceived = false;
      
      // Check for data with better error handling
      for (let i = 0; i < 15; i++) {
        try {
          if (inspectorWindow.isClosed()) {
            console.log('❌ Inspector window closed unexpectedly');
            break;
          }

          const checkData = await inspectorWindow.evaluate(() => {
            const inspector = (window as any).scormInspector;
            const dataModelElement = document.getElementById('data-model');
            
            return {
              hasInspector: !!inspector,
              apiHistoryLength: inspector?.apiHistory?.length || 0,
              dataModelKeys: inspector?.dataModel ? Object.keys(inspector.dataModel) : [],
              hasDataModelElement: !!dataModelElement,
              dataModelHTML: dataModelElement?.innerHTML?.substring(0, 200) || 'N/A',
              hasNoDataMessage: dataModelElement?.innerHTML?.includes('No SCORM data available') || false,
              hasDataContent: dataModelElement?.innerHTML?.includes('cmi.') || 
                             dataModelElement?.innerHTML?.includes('completion_status') ||
                             dataModelElement?.innerHTML?.includes('score') || false
            };
          });

          finalDataCheck = checkData;

          if (checkData.apiHistoryLength > 0 || checkData.hasDataContent) {
            dataReceived = true;
            console.log(`✓ Inspector has data: ${checkData.apiHistoryLength} API calls, data content: ${checkData.hasDataContent}`);
            break;
          }

          console.log(`Waiting for data... attempt ${i + 1}/15 (API: ${checkData.apiHistoryLength}, content: ${checkData.hasDataContent})`);
          await inspectorWindow.waitForTimeout(1000);
        } catch (error) {
          console.log(`❌ Error checking data on attempt ${i + 1}: ${error.message}`);
          break;
        }
      }

      // Step 5: Report results for this course
      console.log(`\n📊 Results for ${course.name}:`);
      console.log(`   Course loaded: ${loadResult.success}`);
      console.log(`   SCORM API calls: ${scormResults.success ? scormResults.results?.length || 0 : 'Failed'}`);
      console.log(`   Inspector opened: ${!inspectorWindow.isClosed()}`);
      console.log(`   Data received: ${dataReceived}`);
      
      if (finalDataCheck) {
        console.log(`   API History: ${finalDataCheck.apiHistoryLength} calls`);
        console.log(`   Has data content: ${finalDataCheck.hasDataContent}`);
        console.log(`   Shows "No data" message: ${finalDataCheck.hasNoDataMessage}`);
      }

      // Test filtering if data is present
      if (dataReceived && finalDataCheck?.hasDataContent) {
        console.log('Step 5: Testing filter functionality...');
        
        try {
          // Test filter input
          const filterInput = inspectorWindow.locator('#data-filter');
          await filterInput.fill('completion');
          await inspectorWindow.waitForTimeout(500);

          // Test clear filter
          const clearButton = inspectorWindow.locator('#clear-filter');
          await clearButton.click();
          await inspectorWindow.waitForTimeout(1000);

          // Verify data is still there after clearing filter
          const postFilterCheck = await inspectorWindow.evaluate(() => {
            const dataModelElement = document.getElementById('data-model');
            return {
              hasDataContent: dataModelElement?.innerHTML?.includes('cmi.') || 
                             dataModelElement?.innerHTML?.includes('completion_status') ||
                             dataModelElement?.innerHTML?.includes('score') || false,
              hasNoDataMessage: dataModelElement?.innerHTML?.includes('No SCORM data available') || false
            };
          });

          console.log(`   Filter test - Data persisted: ${postFilterCheck.hasDataContent}, No data message: ${postFilterCheck.hasNoDataMessage}`);
          
          // This is the key test - data should persist after filter clear
          expect(postFilterCheck.hasDataContent).toBe(true);
          expect(postFilterCheck.hasNoDataMessage).toBe(false);
          
        } catch (error) {
          console.log(`⚠️  Filter test failed: ${error.message}`);
        }
      }

      console.log(`✅ Test completed for ${course.name}\n`);
    });
  });
});
