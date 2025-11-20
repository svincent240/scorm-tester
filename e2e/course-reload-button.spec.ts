import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import { ConsoleMonitor } from './helpers/console-monitor';

/**
 * Course Reload Button E2E Test
 * 
 * Tests the GUI reload button with real navigation and resume:
 * 1. Load the dist course (has navigation buttons)
 * 2. Navigate to slide 2 using the Next button
 * 3. Click the GUI reload button
 * 4. Verify resume worked - should be on slide 2
 * 
 * This test uses the REAL unified paths:
 * - GUI navigation (Next button)
 * - GUI reload button
 * - Real SCORM course with multiple slides
 * 
 * Expected to FAIL initially because resume is not fully working yet.
 */

test.describe('Course Reload Button', () => {
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
    consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('Navigate to slide 2, click reload button, verify resume to slide 2', async () => {
    const coursePath = path.resolve(process.cwd(), 'references/real_course_examples/dist');

    console.log('\n=== STEP 1: Load Course ===');
    
    // Load the dist course (folder type)
    const loadResult = await page.evaluate(async ({ coursePath }) => {
      try {
        return await (window as any).testLoadCourse(coursePath, 'folder');
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, { coursePath });

    expect(loadResult.success).toBe(true);
    console.log('✓ Course loaded');

    // Wait for course to initialize
    await page.waitForTimeout(5000);
    
    // Wait for SCORM API to be ready
    let apiReady = false;
    for (let i = 0; i < 20; i++) {
      const check = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        if (!iframe?.contentWindow) return false;
        
        // Check if course content loaded (not about:blank)
        if (!iframe.src || iframe.src === 'about:blank') return false;
        
        // Check if we can access the content document
        try {
          const doc = iframe.contentWindow.document;
          if (!doc || doc.readyState !== 'complete') return false;
          
          // Check if course has navigation buttons
          const nextBtn = doc.querySelector('#nextBtn, [data-action="nav-next"], [data-testid="nav-next"]');
          return !!nextBtn;
        } catch {
          return false;
        }
      });
      
      if (check) {
        apiReady = true;
        console.log(`✓ Course content ready after ${i + 1} attempts`);
        break;
      }
      await page.waitForTimeout(500);
    }
    
    expect(apiReady).toBe(true);

    console.log('\n=== STEP 2: Get Initial Slide Info ===');
    
    // Get initial slide number/location
    const initialSlide = await page.evaluate(() => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      if (!iframe?.contentWindow) return null;
      
      const doc = iframe.contentWindow.document;
      
      // Get slide container content (where actual slides load)
      const slideContainer = doc.querySelector('#slide-container, .slide-content, main');
      const slideContent = slideContainer?.textContent?.trim() || '';
      
      // Try to get slide indicator or counter
      const slideIndicator = doc.querySelector('.slide-number, .slide-counter, #slide-indicator, .current-slide');
      const slideText = slideIndicator?.textContent || '';
      
      // Check SCORM location
      const api = (window as any).API_1484_11 || (window as any).API;
      const location = api ? api.GetValue('cmi.location') : '';
      
      // Get page title or content to identify slide
      const title = doc.title || doc.querySelector('h1, h2, .slide-title')?.textContent || '';
      
      // Get slide heading/title
      const slideHeading = slideContainer?.querySelector('h1, h2, h3')?.textContent || '';
      
      return {
        slideText,
        location,
        title: title.substring(0, 100),
        slideContent: slideContent.substring(0, 300),
        slideHeading,
        hasContent: slideContent.length > 0
      };
    });
    
    console.log('✓ Initial slide:', initialSlide);

    console.log('\n=== STEP 3: Navigate to Slide 2 ===');
    
    // Click the Next button in the course content
    const navResult = await page.evaluate(() => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      if (!iframe?.contentWindow) return { success: false, reason: 'No iframe' };
      
      const doc = iframe.contentWindow.document;
      
      // Find and click the Next button
      const nextBtn = doc.querySelector('#nextBtn, [data-action="nav-next"], [data-testid="nav-next"]') as HTMLButtonElement;
      if (!nextBtn) {
        return { success: false, reason: 'Next button not found' };
      }
      
      if (nextBtn.disabled) {
        return { success: false, reason: 'Next button is disabled' };
      }
      
      nextBtn.click();
      return { success: true };
    });
    
    console.log('✓ Clicked Next button:', navResult);
    expect(navResult.success).toBe(true);

    // Wait for navigation to complete
    await page.waitForTimeout(2000);

    // Get slide 2 info
    const slide2Info = await page.evaluate(() => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      if (!iframe?.contentWindow) return null;
      
      const doc = iframe.contentWindow.document;
      
      // Get slide container content (where actual slides load)
      const slideContainer = doc.querySelector('#slide-container, .slide-content, main');
      const slideContent = slideContainer?.textContent?.trim() || '';
      
      const slideIndicator = doc.querySelector('.slide-number, .slide-counter, #slide-indicator, .current-slide');
      const slideText = slideIndicator?.textContent || '';
      
      const api = (window as any).API_1484_11 || (window as any).API;
      const location = api ? api.GetValue('cmi.location') : '';
      
      const title = doc.title || doc.querySelector('h1, h2, .slide-title')?.textContent || '';
      
      // Get slide heading/title
      const slideHeading = slideContainer?.querySelector('h1, h2, h3')?.textContent || '';
      
      return {
        slideText,
        location,
        title: title.substring(0, 100),
        slideContent: slideContent.substring(0, 300),
        slideHeading,
        hasContent: slideContent.length > 0
      };
    });
    
    console.log('✓ After navigation - Slide 2:', slide2Info);
    
    // Verify we moved to a different slide
    expect(slide2Info?.slideContent).not.toBe(initialSlide?.slideContent);

    console.log('\n=== STEP 4: Set Exit Mode and Save ===');
    
    // Set cmi.exit='suspend' and commit data
    const saveResult = await page.evaluate(() => {
      const api = (window as any).API_1484_11 || (window as any).API;
      if (!api) return { success: false, reason: 'No API' };
      
      // Set exit to suspend so resume will work
      const exitResult = api.SetValue('cmi.exit', 'suspend');
      
      // Commit to ensure data is saved
      const commitResult = api.Commit('');
      
      return {
        success: true,
        exit: exitResult,
        commit: commitResult,
        location: api.GetValue('cmi.location')
      };
    });
    
    console.log('✓ Saved with exit=suspend:', saveResult);
    expect(saveResult.success).toBe(true);

    console.log('\n=== STEP 5: Click Reload Button ===');
    
    // Find and click the reload button in the main UI (not in iframe)
    const reloadButton = page.locator('#course-reload-btn, button:has-text("Reload")').first();
    await expect(reloadButton).toBeVisible({ timeout: 5000 });
    await reloadButton.click();
    console.log('✓ Clicked reload button');

    // Wait for reload to complete
    await page.waitForTimeout(8000);
    
    // Wait for course to be ready again
    for (let i = 0; i < 20; i++) {
      const ready = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        if (!iframe?.contentWindow) return false;
        if (!iframe.src || iframe.src === 'about:blank') return false;
        
        try {
          const doc = iframe.contentWindow.document;
          return doc && doc.readyState === 'complete';
        } catch {
          return false;
        }
      });
      
      if (ready) {
        console.log(`✓ Course reloaded after ${i + 1} attempts`);
        break;
      }
      await page.waitForTimeout(500);
    }

    console.log('\n=== STEP 6: Verify Resume at Slide 2 ===');
    
    // Get slide info after reload
    const resumedSlide = await page.evaluate(() => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      if (!iframe?.contentWindow) return null;
      
      const doc = iframe.contentWindow.document;
      
      // Get slide container content (where actual slides load)
      const slideContainer = doc.querySelector('#slide-container, .slide-content, main');
      const slideContent = slideContainer?.textContent?.trim() || '';
      
      const slideIndicator = doc.querySelector('.slide-number, .slide-counter, #slide-indicator, .current-slide');
      const slideText = slideIndicator?.textContent || '';
      
      const api = (window as any).API_1484_11 || (window as any).API;
      const location = api ? api.GetValue('cmi.location') : '';
      const entry = api ? api.GetValue('cmi.entry') : '';
      const exit = api ? api.GetValue('cmi.exit') : '';
      
      const title = doc.title || doc.querySelector('h1, h2, .slide-title')?.textContent || '';
      
      // Get slide heading/title
      const slideHeading = slideContainer?.querySelector('h1, h2, h3')?.textContent || '';
      
      return {
        slideText,
        location,
        entry,
        exit,
        title: title.substring(0, 100),
        slideContent: slideContent.substring(0, 300),
        slideHeading,
        hasContent: slideContent.length > 0
      };
    });
    
    console.log('✓ After reload - Resumed slide:', resumedSlide);
    
    console.log('\n=== VERIFICATION ===');
    console.log('Initial slide:', initialSlide);
    console.log('Navigated to slide 2:', slide2Info);
    console.log('After reload:', resumedSlide);
    
    // Verify entry mode is 'resume'
    console.log('\n📊 Entry mode:', resumedSlide?.entry);
    expect(resumedSlide?.entry).toBe('resume');
    
    // Verify we're on slide 2 (same content as before reload)
    console.log('📊 Content match:', {
      slide2: slide2Info?.slideContent?.substring(0, 50),
      resumed: resumedSlide?.slideContent?.substring(0, 50)
    });
    
    // The slide content should match slide 2, not slide 1
    expect(resumedSlide?.slideContent).toBe(slide2Info?.slideContent);
    expect(resumedSlide?.slideContent).not.toBe(initialSlide?.slideContent);
    
    console.log('\n✅ TEST COMPLETE');
    console.log('Resume worked! Reloaded at slide 2, not slide 1');
  });
});
