import { _electron as electron, test, expect } from '@playwright/test';
import { ConsoleMonitor } from './helpers/console-monitor';

test('app launches successfully and shows main interface', async () => {
  // Launch Electron app
  const electronApp = await electron.launch({ 
    executablePath: require('electron'), 
    args: ['.'],
    timeout: 30000
  });
  
  const page = await electronApp.firstWindow();
  
  // Set up console monitoring
  const consoleMonitor = new ConsoleMonitor(page);
  
  // Wait for app to load
  await page.waitForLoadState('domcontentloaded');
  
  // Verify main UI elements are present
  await expect(page).toHaveTitle('SCORM Tester');
  await expect(page.locator('#course-load-btn')).toBeVisible();
  await expect(page.locator('#course-folder-btn')).toBeVisible();
  
  // Verify iframe exists (even if hidden initially)
  await expect(page.locator('#content-frame')).toBeAttached();
  
  // Check that electronAPI is available
  const hasAPI = await page.evaluate(() => {
    return typeof (window as any).electronAPI !== 'undefined';
  });
  expect(hasAPI).toBe(true);
  
  // Check for console errors before closing
  consoleMonitor.printSummary('app launches successfully and shows main interface');
  consoleMonitor.assertNoCriticalErrors('app launches successfully and shows main interface');
  
  await electronApp.close();
});

test('app can handle navigation and UI interactions', async () => {
  const electronApp = await electron.launch({ 
    executablePath: require('electron'), 
    args: ['.'],
    timeout: 30000
  });
  
  const page = await electronApp.firstWindow();
  
  // Set up console monitoring
  const consoleMonitor = new ConsoleMonitor(page);
  
  await page.waitForLoadState('domcontentloaded');
  
  // Test that buttons are clickable (even if they open dialogs)
  const loadBtn = page.locator('#course-load-btn');
  await expect(loadBtn).toBeEnabled();
  
  const folderBtn = page.locator('#course-folder-btn');
  await expect(folderBtn).toBeEnabled();
  
  // Test that the app doesn't crash when clicking buttons
  // (We won't actually click since it opens file dialogs)
  
  // Verify app is responsive
  const title = await page.title();
  expect(title).toBe('SCORM Tester');
  
  // Check for console errors before closing
  consoleMonitor.printSummary('app can handle navigation and UI interactions');
  consoleMonitor.assertNoCriticalErrors('app can handle navigation and UI interactions');
  
  await electronApp.close();
});