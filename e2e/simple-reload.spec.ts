import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Simple Course Reload Test', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let page: Awaited<ReturnType<typeof electronApp.firstWindow>>;
  let userDataPath: string;
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
    userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const sessionDir = path.join(userDataPath, 'scorm-sessions');
    
    // Clean up sessions directory
    if (fs.existsSync(sessionDir)) {
      console.log(`Cleaning up session directory: ${sessionDir}`);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    // Recreate to ensure it exists
    fs.mkdirSync(sessionDir, { recursive: true });
    
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

  test('Load course, navigate, reload, and verify persistence and resume', async () => {
    // 1. Load the course
    const coursePath = path.resolve(process.cwd(), 'references/real_course_examples/dist');
    console.log(`Loading course from: ${coursePath}`);

    // Wait for the helper to be available
    await page.waitForFunction(() => typeof (window as any).testLoadCourse === 'function');
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
    const iframeFrame = page.frameLocator(iframeSelector);
    const nextBtn = iframeFrame.locator('#nextBtn');
    await nextBtn.waitFor({ state: 'visible', timeout: 10000 });

    // 3. Navigate to Slide 2
    console.log('Clicking Next button...');
    await nextBtn.click();
    await page.waitForTimeout(1000);

    // 4. Set cmi.exit to 'suspend'
    // REMOVED: We want to test if the course handles this automatically during reload.
    /*
    console.log('Setting cmi.exit = suspend...');
    const setResult = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      // @ts-ignore
      const api = iframe.contentWindow.API_1484_11 || iframe.contentWindow.API;
      if (api) {
        const result = api.SetValue('cmi.exit', 'suspend');
        const commit = api.Commit('');
        return { result, commit };
      }
      return { error: 'No API found' };
    });
    expect(setResult.result).toBe('true');
    */

    // 5. Click the Reload Button
    console.log('Clicking Reload button...');
    const reloadBtn = page.locator('#course-reload-btn');
    await reloadBtn.click();

    // 6. Wait for reload to complete
    // The iframe will reload. We wait for it to be back and the Next button to be visible again.
    await page.waitForTimeout(2000); // Wait for the reload process to start
    await nextBtn.waitFor({ state: 'visible', timeout: 15000 });

    // 7. Assertion 1: Verify Persistence (JSON exists)
    // This confirms that the "Close" (Terminate) operation successfully wrote the session to disk.
    const sessionJsonPath = path.join(userDataPath, 'scorm-sessions', 'gui_scorm_template.json');
    console.log(`Checking session file at: ${sessionJsonPath}`);
    
    if (!fs.existsSync(sessionJsonPath)) {
      console.log(`File not found at ${sessionJsonPath}`);
      const dir = path.dirname(sessionJsonPath);
      if (fs.existsSync(dir)) {
        console.log(`Contents of ${dir}:`, fs.readdirSync(dir));
      }
    }
    expect(fs.existsSync(sessionJsonPath)).toBe(true);

    // 8. Assertion 2: Verify Data Delivery (cmi.entry is resume)
    // This confirms that the platform successfully reloaded the session data and provided it to the API.
    const scormValues = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      // @ts-ignore
      const api = iframe.contentWindow.API_1484_11 || iframe.contentWindow.API;
      if (!api) return null;
      return {
        entry: api.GetValue('cmi.entry'),
        location: api.GetValue('cmi.location'),
        suspendData: api.GetValue('cmi.suspend_data')
      };
    });

    console.log('Resumed SCORM Values:', scormValues);
    expect(scormValues).not.toBeNull();
    expect(scormValues!.entry).toBe('resume');
    
    // 9. Assertion 3: Verify UI Resume (Previous button enabled)
    // This confirms that the course content correctly utilized the provided resume data to restore the learner's location.
    // If this fails while Assertion 2 passes, it indicates a bug in the course content's resume logic.
    const prevBtn = iframeFrame.locator('#prevBtn');
    const isPrevEnabled = await prevBtn.evaluate((btn: HTMLButtonElement) => !btn.disabled);
    console.log(`Is Previous button enabled? ${isPrevEnabled}`);
    expect(isPrevEnabled).toBe(true);

    // Verify no errors occurred
    expect(consoleErrors, 'Should have no console errors').toEqual([]);
    expect(pageErrors, 'Should have no page errors').toEqual([]);

    // Verify no SCORM errors occurred
    const scormErrors = await page.evaluate(() => (window as any).scormErrors);
    expect(scormErrors, 'Should have no SCORM errors').toEqual([]);
  });
});
