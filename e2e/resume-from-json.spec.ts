import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Resume Course from JSON Test', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let page: Awaited<ReturnType<typeof electronApp.firstWindow>>;
  let consoleErrors: string[] = [];
  let pageErrors: Error[] = [];

  test.beforeEach(async () => {
    consoleErrors = [];
    pageErrors = [];
    electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    page = await electronApp.firstWindow();
    
    // Get the userData path from the running Electron app
    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const sessionDir = path.join(userDataPath, 'scorm-sessions');
    
    // Ensure directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Create a crafted session JSON file
    // Identifier for 'references/real_course_examples/dist' is 'SCORM-Template'
    // Filename: gui_scorm_template.json
    const sessionJsonPath = path.join(sessionDir, 'gui_scorm_template.json');
    
    const validSuspendData = JSON.stringify({
      navigation: {
        currentSlideIndex: 1,
        visitedSlides: ["intro"],
        resumeSlideId: null
      },
      sessionData: {
        slideStartTimes: {},
        slideDurations: {}
      }
    });

    const craftedSessionData = {
      coreData: {
        "cmi.exit": "suspend",
        "cmi.location": "ui-demo",
        "cmi.suspend_data": validSuspendData,
        "cmi.completion_status": "incomplete",
        "cmi.success_status": "unknown",
        "cmi.entry": "" 
      }
    };

    console.log(`Injecting session file at: ${sessionJsonPath}`);
    fs.writeFileSync(sessionJsonPath, JSON.stringify(craftedSessionData, null, 2), 'utf-8');
    
    page.on('console', msg => {
      console.log(`[Browser Console] ${msg.text()}`);
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      console.log(`[Browser Page Error] ${error.message}`);
      pageErrors.push(error);
    });
    
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('Open course and verify it resumes from injected JSON', async () => {
    // 1. Load the course
    const coursePath = path.resolve(process.cwd(), 'references/real_course_examples/dist');
    console.log(`Loading course from: ${coursePath}`);

    // Wait for the helper to be available
    await page.waitForFunction(() => typeof (window as any).testLoadCourse === 'function');
    
    // Wait for AppManager to be initialized
    await page.waitForFunction(() => (window as any).appManager && (window as any).appManager.initialized);

    // Attach SCORM error listener to capture errors like 122
    await page.evaluate(() => {
      (window as any).scormErrors = [];
      (window as any).appManager.eventBus.on('ui:scorm:error', (error: any) => {
        console.log(`[SCORM Error Event] Code: ${error.code}, Message: ${error.message}`);
        (window as any).scormErrors.push(error);
      });
    });

    const loadResult = await page.evaluate(async ({ coursePath }) => {
      // @ts-ignore
      return await window.testLoadCourse(coursePath, 'folder');
    }, { coursePath });
    
    expect(loadResult.success).toBe(true);

    // 2. Wait for the iframe and content to be ready
    const iframeSelector = 'iframe';
    await page.waitForSelector(iframeSelector);
    
    // 3. Verify SCORM values in the running course
    // We need to wait for the course to initialize and read the values
    
    // Poll for API availability and values
    const scormValues = await page.evaluate(async () => {
      const iframe = document.querySelector('iframe');
      if (!iframe) return null;
      
      const getApi = () => (iframe.contentWindow as any).API_1484_11 || (iframe.contentWindow as any).API;
      
      // Wait for API
      let attempts = 0;
      while (!getApi() && attempts < 20) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }
      
      const api = getApi();
      if (!api) return { error: 'No API found' };

      // Wait for SCORM initialization to avoid error 122 (Retrieve data before initialization)
      // We can check the internal state via appManager if available, or just wait for the event
      if ((window as any).appManager) {
         const scormClient = (window as any).appManager.services.get('scormClient');
         if (!scormClient.getInitialized()) {
            await new Promise<void>(resolve => {
               (window as any).appManager.eventBus.once('ui:scorm:initialized', () => resolve());
            });
         }
      } else {
         // Fallback: Wait for cmi.entry to be available, but this might cause error 122
         // If we are here, we accept that we might trigger an error, but we should try to avoid it.
         // Since we are in a test that has appManager, this branch shouldn't be taken.
      }

      return {
        entry: api.GetValue('cmi.entry'),
        location: api.GetValue('cmi.location'),
        suspendData: api.GetValue('cmi.suspend_data'),
        exit: api.GetValue('cmi.exit') 
      };
    });

    console.log('SCORM Values:', scormValues);

    expect(scormValues).not.toBeNull();
    if (!scormValues) throw new Error('scormValues is null');
    
    expect(scormValues.error).toBeUndefined();
    
    // Verify Resume Logic
    expect(scormValues.entry).toBe('resume');
    
    // Note: cmi.location might be reset by the course content if it detects a mismatch or race condition,
    // but the presence of correct suspend_data and entry='resume' confirms the platform loaded the JSON.
    expect(scormValues.location).toBe('ui-demo'); 

    // We check if suspendData contains the key structure we injected
    expect(scormValues.suspendData).toContain('visitedSlides');
    expect(scormValues.suspendData).toContain('intro');

    // Verify no errors occurred
    const capturedConsoleErrors = consoleErrors;
    const capturedPageErrors = pageErrors;

    expect(capturedConsoleErrors, 'Should have no console errors').toEqual([]);
    expect(capturedPageErrors, 'Should have no page errors').toEqual([]);

    // Verify no SCORM errors occurred
    const scormErrors = await page.evaluate(() => (window as any).scormErrors);
    expect(scormErrors, 'Should have no SCORM errors').toEqual([]);
  });
});
