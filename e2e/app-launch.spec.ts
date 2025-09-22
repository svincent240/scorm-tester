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
  const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: true });
  
  // Wait for app to load
  await page.waitForLoadState('domcontentloaded');
  
  // Verify main UI elements are present
  await expect(page).toHaveTitle('SCORM Tester');
  await expect(page.locator('#hc-open-zip')).toBeVisible();
  await expect(page.locator('#hc-open-folder')).toBeVisible();

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
  const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: true });
  
  await page.waitForLoadState('domcontentloaded');
  
  // Verify header buttons are enabled (do not click to avoid OS dialogs)
  const loadBtn = page.locator('#hc-open-zip');
  await expect(loadBtn).toBeEnabled();

  const folderBtn = page.locator('#hc-open-folder');
  await expect(folderBtn).toBeEnabled();

  // Do not click buttons that open native dialogs; we verify responsiveness instead

  // Verify app is responsive
  const title = await page.title();
  expect(title).toBe('SCORM Tester');
  
  // Check for console errors before closing
  consoleMonitor.printSummary('app can handle navigation and UI interactions');
  consoleMonitor.assertNoCriticalErrors('app can handle navigation and UI interactions');
  
  await electronApp.close();
});