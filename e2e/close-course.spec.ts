import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Close Course Persistence Test', () => {
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
    
    // Clean up sessions directory in the Electron app's userData folder
    if (fs.existsSync(sessionDir)) {
      console.log(`Cleaning up session directory: ${sessionDir}`);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    // Recreate the directory to ensure it exists for the app to write to
    fs.mkdirSync(sessionDir, { recursive: true });
    
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('Load course, navigate, close via GUI, and verify session persistence', async () => {
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
    const iframeFrame = page.frameLocator(iframeSelector);
    
    // Wait for the Next button to be visible inside the iframe
    const nextBtn = iframeFrame.locator('#nextBtn');
    await nextBtn.waitFor({ state: 'visible', timeout: 10000 });

    // 3. Navigate to Slide 2
    console.log('Clicking Next button...');
    await nextBtn.click();
    await page.waitForTimeout(1000); // Wait for transition

    // 4. Set cmi.exit to 'suspend' explicitly (simulating course behavior)
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

    // 5. Click the Close Button in the main UI
    console.log('Clicking Close button...');
    const closeBtn = page.locator('#hc-close-course');
    await closeBtn.click();

    // 6. Wait for the course to be cleared (iframe hidden or src cleared)
    // The app hides the iframe and shows "No Content" state
    await page.waitForSelector(iframeSelector, { state: 'hidden', timeout: 10000 });
    console.log('Course closed and iframe hidden.');

    // 7. Verify Session File
    // Get the userData path from the running Electron app
    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const sessionJsonPath = path.join(userDataPath, 'scorm-sessions', 'gui_scorm_template.json');
    
    console.log(`Checking session file at: ${sessionJsonPath}`);
    
    if (!fs.existsSync(sessionJsonPath)) {
      console.log(`File not found at ${sessionJsonPath}`);
      const dir = path.dirname(sessionJsonPath);
      if (fs.existsSync(dir)) {
        console.log(`Contents of ${dir}:`, fs.readdirSync(dir));
      } else {
        console.log(`Directory ${dir} does not exist.`);
      }
    }

    expect(fs.existsSync(sessionJsonPath)).toBe(true);

    const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
    console.log('Session Data:', JSON.stringify(sessionData, null, 2));

    // Verify persistence
    // Note: The structure depends on how SessionStore saves it. 
    // Based on session-store.js, it saves whatever rte.dataModel.getAllData() returns.
    // Usually it has a 'coreData' or similar property.
    // Let's check for cmi.exit in the saved data.
    
    // The saved data structure from ScormService.commit/terminate:
    // data = rte.dataModel.getAllData();
    // This usually returns { coreData: { ... }, ... }
    
    const coreData = sessionData.coreData || sessionData;
    const exitValue = coreData['cmi.exit'] || coreData['cmi.core.exit'];
    
    expect(exitValue).toBe('suspend');
  });
});
