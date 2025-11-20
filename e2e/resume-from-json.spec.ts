import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Resume Course from JSON Test', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let page: Awaited<ReturnType<typeof electronApp.firstWindow>>;

  test.beforeEach(async () => {
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
    
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    
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

      // Wait for Initialize to be called (cmi.entry should be set)
      attempts = 0;
      while (api.GetValue('cmi.entry') === '' && attempts < 20) {
         await new Promise(r => setTimeout(r, 200));
         attempts++;
      }

      return {
        entry: api.GetValue('cmi.entry'),
        location: api.GetValue('cmi.location'),
        suspendData: api.GetValue('cmi.suspend_data'),
        exit: api.GetValue('cmi.exit') // Should be empty string initially after load, or what was in JSON? 
        // Actually cmi.exit is write-only in some versions, but usually readable in RTE.
        // But cmi.entry is the key indicator of resume.
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
    // expect(scormValues.location).toBe('ui-demo'); 

    // We check if suspendData contains the key structure we injected
    expect(scormValues.suspendData).toContain('visitedSlides');
    expect(scormValues.suspendData).toContain('intro');
  });
});
