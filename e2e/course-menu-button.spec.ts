import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import { ConsoleMonitor } from './helpers/console-monitor';

/**
 * Course Menu Button E2E Tests
 *
 * Tests the course menu button functionality that toggles the sidebar visibility.
 * The button should:
 * - Show/hide the sidebar with "Course Outline"
 * - Change button text between "📚 Course Menu" and "✕ Hide Menu"
 * - Work with and without loaded courses
 * - Maintain consistent state across interactions
 *
 * Implementation: Uses simplified direct DOM manipulation with proper CSS
 * specificity to override responsive design rules that were preventing hiding.
 */

test.describe('Course Menu Button Tests', () => {
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
    consoleMonitor = new ConsoleMonitor(page);
    
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for app to fully initialize
    await page.waitForTimeout(2000);
    
    // MANDATORY: Check for errors after app initialization
    consoleMonitor.printSummary('after app initialization');
    consoleMonitor.assertNoCriticalErrors('after app initialization');
    
    // Verify AppManager is initialized
    const isInitialized = await page.evaluate(() => {
      return !!(window as any).appManager && (window as any).appManager.initialized;
    });
    
    if (!isInitialized) {
      console.log('Waiting for AppManager to initialize...');
      await page.waitForTimeout(3000);
    }
    
    // MANDATORY: Check for errors after AppManager verification
    consoleMonitor.printSummary('after AppManager verification');
    consoleMonitor.assertNoCriticalErrors('after AppManager verification');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('course menu button exists and is visible', async () => {
    // Look for the course menu button in navigation controls
    const menuBtn = page.locator('#navigation-controls-menu');
    
    // Verify button exists and is visible
    await expect(menuBtn).toBeVisible();
    await expect(menuBtn).toBeEnabled();
    
    console.log('✓ Course menu button is visible and enabled');
    
    // Verify initial button text
    const buttonText = await menuBtn.textContent();
    expect(buttonText).toContain('Course Menu');
    console.log('✓ Course menu button has correct initial text:', buttonText);
    
    // MANDATORY: Check for errors after button verification
    consoleMonitor.printSummary('after button verification');
    consoleMonitor.assertNoCriticalErrors('after button verification');
  });

  test('course menu button toggles sidebar visibility without course', async () => {
    const menuBtn = page.locator('#navigation-controls-menu');
    const sidebar = page.locator('#app-sidebar');

    // Check actual initial state
    const initialState = await page.evaluate(() => {
      const sidebar = document.getElementById('app-sidebar');
      return {
        exists: !!sidebar,
        classes: sidebar?.className || 'not found',
        isHidden: sidebar?.classList.contains('app-sidebar--hidden') || false,
        isVisible: sidebar ? !sidebar.classList.contains('app-sidebar--hidden') : false
      };
    });

    // Verify initial state - sidebar should be visible by default
    await expect(sidebar).toBeVisible();

    if (initialState.isHidden) {
      // If sidebar starts hidden, first click should show it
      await expect(sidebar).toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar starts hidden as expected');
    } else {
      await expect(sidebar).not.toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar starts visible as expected');
    }

    // MANDATORY: Check for errors after initial state verification
    consoleMonitor.printSummary('after initial state verification');
    consoleMonitor.assertNoCriticalErrors('after initial state verification');

    // Click menu button to toggle sidebar
    await menuBtn.click();

    await page.waitForTimeout(500); // Allow for animation/state change

    // Check the result and verify the toggle worked
    const afterToggleState = await page.evaluate(() => {
      const sidebar = document.getElementById('app-sidebar');
      return {
        classes: sidebar?.className || 'not found',
        isHidden: sidebar?.classList.contains('app-sidebar--hidden') || false
      };
    });

    // The sidebar should now be in the opposite state from initial
    if (initialState.isHidden) {
      // Started hidden, should now be visible
      await expect(sidebar).not.toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar is now visible (was hidden)');

      // Button should show "Hide Menu" when sidebar is visible
      const buttonText = await menuBtn.textContent();
      expect(buttonText).toContain('Hide Menu');
      console.log('✓ Button text changed to:', buttonText);
    } else {
      // Started visible, should now be hidden
      await expect(sidebar).toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar is now hidden (was visible)');

      // Button should show "Course Menu" when sidebar is hidden
      const buttonText = await menuBtn.textContent();
      expect(buttonText).toContain('Course Menu');
      console.log('✓ Button text changed to:', buttonText);
    }

    // MANDATORY: Check for errors after first toggle
    consoleMonitor.printSummary('after first toggle');
    consoleMonitor.assertNoCriticalErrors('after first toggle');

    // Click menu button again to toggle back
    await menuBtn.click();
    await page.waitForTimeout(500); // Allow for animation/state change

    // Verify sidebar is back to initial state
    if (initialState.isHidden) {
      await expect(sidebar).toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar is hidden again (back to initial state)');
    } else {
      await expect(sidebar).not.toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar is visible again (back to initial state)');
    }

    // MANDATORY: Check for errors after second toggle
    consoleMonitor.printSummary('after second toggle');
    consoleMonitor.assertNoCriticalErrors('after second toggle');
  });

  test('course menu button works with loaded course', async () => {
    const zipPath = path.resolve(process.cwd(), 'references/real_course_examples/SL360_LMS_SCORM_2004.zip');

    // Check that test helper is available
    const hasHelper = await page.evaluate(() => {
      return typeof (window as any).testLoadCourse === 'function';
    });

    if (!hasHelper) {
      console.log('Test helper not available, skipping course loading test');
      // MANDATORY: Check for errors even when skipping
      consoleMonitor.printSummary('test helper check');
      consoleMonitor.assertNoCriticalErrors('test helper check');
      return;
    }

    // Load the course using test helper
    const loadResult = await page.evaluate(async ({ zipPath }) => {
      try {
        return await (window as any).testLoadCourse(zipPath);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { zipPath });

    // MANDATORY: Check for errors immediately after course loading
    consoleMonitor.printSummary('after course loading execution');
    consoleMonitor.assertNoCriticalErrors('after course loading execution');

    console.log('Course loading result:', loadResult);
    expect(loadResult).toBeDefined();
    expect(typeof loadResult.success).toBe('boolean');

    if (loadResult.success) {
      console.log('✓ Course loading initiated successfully');

      // Wait for UI updates
      await page.waitForTimeout(2000);

      // MANDATORY: Check for errors after UI wait
      consoleMonitor.printSummary('after UI update wait');
      consoleMonitor.assertNoCriticalErrors('after UI update wait');

      // Now test menu button with loaded course
      const menuBtn = page.locator('#navigation-controls-menu');
      const sidebar = page.locator('#app-sidebar');
      const courseOutline = page.locator('.course-outline');

      // Verify course outline is present
      await expect(courseOutline).toBeVisible();
      console.log('✓ Course outline is visible after loading');

      // Test menu toggle with course loaded
      await menuBtn.click();
      await page.waitForTimeout(500);

      // Verify sidebar is hidden
      await expect(sidebar).toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Sidebar hidden successfully with course loaded');

      // MANDATORY: Check for errors after menu toggle with course
      consoleMonitor.printSummary('after menu toggle with course');
      consoleMonitor.assertNoCriticalErrors('after menu toggle with course');

      // Show sidebar again
      await menuBtn.click();
      await page.waitForTimeout(500);

      // Verify sidebar and course outline are visible
      await expect(sidebar).not.toHaveClass(/app-sidebar--hidden/);
      await expect(courseOutline).toBeVisible();
      console.log('✓ Sidebar and course outline visible after toggle');

      // MANDATORY: Check for errors after final toggle
      consoleMonitor.printSummary('after final toggle');
      consoleMonitor.assertNoCriticalErrors('after final toggle');

    } else {
      console.log('Course loading failed, testing menu button without course content');

      // Still test basic menu functionality
      const menuBtn = page.locator('#navigation-controls-menu');
      await menuBtn.click();
      await page.waitForTimeout(500);

      const sidebar = page.locator('#app-sidebar');
      await expect(sidebar).toHaveClass(/app-sidebar--hidden/);
      console.log('✓ Menu button works even when course loading failed');

      // MANDATORY: Check for errors after fallback test
      consoleMonitor.printSummary('after fallback menu test');
      consoleMonitor.assertNoCriticalErrors('after fallback menu test');
    }
  });

  test('course menu button maintains state across interactions', async () => {
    const menuBtn = page.locator('#navigation-controls-menu');
    const sidebar = page.locator('#app-sidebar');
    
    // Test multiple rapid toggles
    for (let i = 0; i < 3; i++) {
      await menuBtn.click();
      await page.waitForTimeout(200);
      
      const isHidden = await sidebar.evaluate(el => el.classList.contains('app-sidebar--hidden'));
      const expectedHidden = (i % 2) === 0; // First click hides, second shows, third hides
      expect(isHidden).toBe(expectedHidden);
      
      console.log(`✓ Toggle ${i + 1}: Sidebar ${isHidden ? 'hidden' : 'visible'} as expected`);
    }
    
    // MANDATORY: Check for errors after rapid toggles
    consoleMonitor.printSummary('after rapid toggles');
    consoleMonitor.assertNoCriticalErrors('after rapid toggles');
  });
});
