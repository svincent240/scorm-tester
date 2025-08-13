import { _electron as electron, test, expect } from '@playwright/test';
 
test('renders the first page', async () => {
  // Ensure Playwright launches the same Electron binary used by the project.
  const electronApp = await electron.launch({ executablePath: require('electron'), args: ['.'] });
  const window = await electronApp.firstWindow();
  
  await test.step('Verify window title', async () => {
    expect(await window.title()).toBe('SCORM Tester');
  });
  
  await test.step('Take screenshot', async () => {
    await window.screenshot();
  });
  
  console.log('🔚 Closing app...');
  await electronApp.close();
  console.log('✅ Test completed successfully');
});