
import { test, expect, ElectronApplication, Page, _electron as electron } from '@playwright/test';

/**
 * E2E tests for the new, integrated SCORM Inspector panel.
 */
test.describe('Integrated SCORM Inspector Panel', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    // Launch Electron app
    electronApp = await electron.launch({ args: ['.'] });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Expose a test helper on the window to load a course without file dialogs
    await page.exposeFunction('testLoadCourse', async (coursePath) => {
      return await electronApp.evaluate(async ({ app }, course) => {
        // This code runs in the main process
        const fileManager = app.mainProcessServices.fileManager;
        return await fileManager.loadCourse(course);
      }, coursePath);
    });
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should open the inspector as a panel within the main window and display data', async () => {
    // Step 1: Load a course to provide context
    // Using a known simple course from the fixtures
    const loadResult = await page.evaluate(async () => {
      // This is a simplified path for testing purposes
      const coursePath = 'references/scorm_starter_template';
      return await (window as any).testLoadCourse(coursePath);
    });
    expect(loadResult.success).toBe(true);
    await page.waitForSelector('.course-outline__tree'); // Wait for UI to update

    // Step 2: Make some SCORM API calls to generate data for the inspector
    await page.evaluate(() => {
      const api = (window as any).API_1484_11;
      if (!api) throw new Error('SCORM API not found on window');
      api.Initialize('');
      api.SetValue('cmi.completion_status', 'incomplete');
      api.SetValue('cmi.score.raw', '88');
      api.Commit('');
    });

    // Step 3: Locate and click the Inspector header button
    const inspectorButton = page.locator('#hc-inspector');
    await expect(inspectorButton).toBeVisible();
    await inspectorButton.click();

    // Step 4: Verify the inspector opens as a PANEL, not a new window
    const windowCount = electronApp.windows().length;
    expect(windowCount).toBe(1); // CRITICAL: Assert no new window was opened

    const inspectorPanel = page.locator('.inspector-panel__container');
    await expect(inspectorPanel).toBeVisible();
    await expect(inspectorPanel).toContainText('SCORM Inspector (Integrated)');

    // Step 5: Verify the API Log tab is active by default and shows data
    const apiLogTab = page.locator('.inspector-tab#inspector-tab-api');
    await expect(apiLogTab).toBeVisible();
    // Check for content from the API calls we just made
    await expect(apiLogTab).toContainText('SetValue');
    await expect(apiLogTab).toContainText('cmi.completion_status');
    await expect(apiLogTab).toContainText('88');

    // Step 6: Interact with tabs and verify content changes
    const activityTreeTabButton = page.locator('button[data-tab="tree"]');
    await activityTreeTabButton.click();

    const activityTreeTab = page.locator('.inspector-tab#inspector-tab-tree');
    await expect(apiLogTab).not.toBeVisible();
    await expect(activityTreeTab).toBeVisible();

    // Check for some text that indicates the activity tree is rendered
    await expect(activityTreeTab).toContainText('Activity Tree');
    // Check for an item from the known test course manifest
    await expect(activityTreeTab).toContainText('Simple SCORM Content');

    // Step 7: Close the inspector panel
    const closeButton = inspectorPanel.locator('.inspector-panel__close');
    await closeButton.click();
    await expect(inspectorPanel).not.toBeVisible();
  });
});
