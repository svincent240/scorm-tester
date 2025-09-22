import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import { ConsoleMonitor } from './helpers/console-monitor';

test.describe('Course Loading Tests', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let page: Awaited<ReturnType<typeof electronApp.firstWindow>>;
  let consoleMonitor: ConsoleMonitor;

  test.beforeEach(async () => {
    electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    page = await electronApp.firstWindow();
    
    // Set up console monitoring
    consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: true });
    
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

  test.afterEach(async ({}, testInfo) => {
    // Note: Error checking is done within each test for immediate feedback
    await electronApp.close();
  });

  test('header load buttons are present (no dialogs opened)', async () => {
    // Verify header buttons are present and enabled (do not click to avoid OS dialogs)
    const zipBtn = page.locator('#hc-open-zip');
    const folderBtn = page.locator('#hc-open-folder');
    await expect(zipBtn).toBeVisible();
    await expect(zipBtn).toBeEnabled();
    await expect(folderBtn).toBeVisible();
    await expect(folderBtn).toBeEnabled();

    console.log('✓ Header load buttons are visible and enabled');

    // Check for errors after verification
    consoleMonitor.printSummary('header load buttons present');
    consoleMonitor.assertNoCriticalErrors('header load buttons present');
  });

  test('loads ZIP course programmatically', async () => {
    const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    // Use the deterministic test helper to load the course (fail-fast if missing)
    const loadResult = await page.evaluate(async ({ zipPath }) => {
      try {
        return await (window as any).testLoadCourse(zipPath);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { zipPath });
    
    console.log('Course loading result:', loadResult);
    
    // Fail-fast: course must load successfully
    expect(loadResult).toBeDefined();
    expect(loadResult.success).toBe(true);

    // Wait a bit and check if UI updated
    await page.waitForTimeout(2000);

    const iframe = page.locator('#content-frame');
    await expect(iframe).toBeAttached();
    console.log('✓ Iframe exists in DOM');
    
    // Check for errors after ZIP course loading
    consoleMonitor.printSummary('ZIP course loading test');
    consoleMonitor.assertNoCriticalErrors('ZIP course loading test');
  });

  test('loads folder course programmatically', async () => {
    const folderPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004');

    // Use the deterministic test helper to load the course from folder with correct type
    const loadResult = await page.evaluate(async ({ folderPath }) => {
      try {
        if (typeof (window as any).testLoadCourse === 'function') {
          // Pass 'folder' as the second parameter to specify type
          return await (window as any).testLoadCourse(folderPath, 'folder');
        }
        return { success: false, error: 'testLoadCourse helper not available' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { folderPath });

    console.log('Folder course loading result:', loadResult);

    // Fail-fast: course must load successfully
    expect(loadResult).toBeDefined();
    expect(loadResult.success).toBe(true);

    // Wait a bit and check if UI updated
    await page.waitForTimeout(2000);

    const iframe = page.locator('#content-frame');
    await expect(iframe).toBeAttached();
    console.log('✓ Iframe exists in DOM after folder load');
    
    // Check for errors after folder course loading
    consoleMonitor.printSummary('folder course loading test');
    consoleMonitor.assertNoCriticalErrors('folder course loading test');
  });

  test('header folder button is present (no dialog opened)', async () => {
    const folderBtn = page.locator('#hc-open-folder');
    await expect(folderBtn).toBeVisible();
    await expect(folderBtn).toBeEnabled();
    console.log('✓ Header folder button is visible and enabled');

    // Check for errors after verification
    consoleMonitor.printSummary('header folder button present');
    consoleMonitor.assertNoCriticalErrors('header folder button present');
  });
});