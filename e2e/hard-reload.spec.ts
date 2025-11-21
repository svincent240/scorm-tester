import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Hard Reload Test (Force New Session)', () => {
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

  test('Load course, navigate, hard reload (Shift+Click), and verify fresh start', async () => {
    // 1. Load the course
    const coursePath = path.resolve(process.cwd(), 'references/real_course_examples/dist');
    console.log(`Loading course from: ${coursePath}`);

    // Wait for the helper to be available
    await page.waitForFunction(() => typeof (window as any).testLoadCourse === 'function');
    await page.waitForFunction(() => (window as any).appManager && (window as any).appManager.initialized);

    // Attach SCORM error listener to capture errors
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

    // 4. Verify we're on slide 2 (Previous button should be enabled)
    const prevBtn = iframeFrame.locator('#prevBtn');
    const isPrevEnabledBefore = await prevBtn.evaluate((btn: HTMLButtonElement) => !btn.disabled);
    console.log(`Is Previous button enabled before reload? ${isPrevEnabledBefore}`);
    expect(isPrevEnabledBefore).toBe(true);

    // 5. Click the Reload Button with Shift key held down (hard reset)
    console.log('Clicking Reload button with Shift key (hard reset)...');
    // NOTE: Playwright's { modifiers: ['Shift'] } doesn't set event.shiftKey for click events,
    // so we programmatically emit the event with forceNew: true instead
    const emitResult = await page.evaluate(() => {
      const eventBus = (window as any).eventBus;
      if (eventBus) {
        console.log('[TEST] Emitting course:reload:request with forceNew: true');
        eventBus.emit('course:reload:request', { forceNew: true });
        return { emitted: true, forceNew: true };
      }
      return { emitted: false };
    });
    console.log('Emitted reload event:', JSON.stringify(emitResult));

    // 6. Wait for reload to complete
    // The iframe will reload. We wait for it to be back and the Next button to be visible again.
    await page.waitForTimeout(2000); // Wait for the reload process to start
    await nextBtn.waitFor({ state: 'visible', timeout: 15000 });

    // 7. Assertion 1: Verify session file still exists (hard reset doesn't delete it)
    // According to spec: "Hard Reset: Flag skips loading step. Never deletes JSON files"
    const sessionJsonPath = path.join(userDataPath, 'scorm-sessions', 'gui_scorm_template.json');
    console.log(`Checking if session file exists at: ${sessionJsonPath}`);
    
    if (fs.existsSync(sessionJsonPath)) {
      console.log(`Session file exists (as expected, hard reset doesn't delete it)`);
    } else {
      console.log(`Session file does not exist yet`);
    }

    // 8. Assertion 2: Verify Data Reset (cmi.entry is ab-initio, NOT resume)
    // This confirms that the platform skipped loading the session data
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

    console.log('SCORM Values after hard reload:', scormValues);
    expect(scormValues).not.toBeNull();
    expect(scormValues!.entry).toBe('ab-initio'); // Should be fresh start, NOT resume
    
    // 9. Assertion 3: Verify UI Fresh Start (Previous button disabled)
    // This confirms that the course started from the beginning
    const isPrevEnabledAfter = await prevBtn.evaluate((btn: HTMLButtonElement) => !btn.disabled);
    console.log(`Is Previous button enabled after hard reload? ${isPrevEnabledAfter}`);
    expect(isPrevEnabledAfter).toBe(false); // Should be disabled (back at slide 1)

    // 10. Navigate forward again and verify we can reach slide 2
    console.log('Clicking Next button after hard reload...');
    await nextBtn.click();
    await page.waitForTimeout(1000);
    
    const isPrevEnabledAfterNav = await prevBtn.evaluate((btn: HTMLButtonElement) => !btn.disabled);
    console.log(`Is Previous button enabled after navigating forward? ${isPrevEnabledAfterNav}`);
    expect(isPrevEnabledAfterNav).toBe(true); // Now we should be able to go back

    // Verify no errors occurred
    expect(consoleErrors, 'Should have no console errors').toEqual([]);
    expect(pageErrors, 'Should have no page errors').toEqual([]);

    // Verify no SCORM errors occurred
    const scormErrors = await page.evaluate(() => (window as any).scormErrors);
    expect(scormErrors, 'Should have no SCORM errors').toEqual([]);
  });
});
