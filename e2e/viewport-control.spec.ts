/**
 * E2E Tests for Viewport Control Feature
 * 
 * Tests both GUI and programmatic viewport control functionality
 */

import { _electron as electron, test, expect } from '@playwright/test';
import { ConsoleMonitor } from './helpers/console-monitor';

test.describe('Viewport Control', () => {

  test('should display mobile toggle button and viewport size in footer', async () => {
    const electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    
    const page = await electronApp.firstWindow();
    const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-layout.initialized', { timeout: 10000 });
    
    // Check mobile toggle button exists
    const mobileToggle = page.locator('#hc-mobile-toggle');
    await expect(mobileToggle).toBeVisible();
    const buttonText = await mobileToggle.textContent();
    expect(buttonText).toContain('Mobile');
    
    // Check viewport display exists and shows default size
    const viewportDisplay = page.locator('#footer-viewport');
    await expect(viewportDisplay).toBeVisible();
    const sizeText = await viewportDisplay.textContent();
    expect(sizeText).toMatch(/1366.*768/);
    
    consoleMonitor.printSummary('viewport UI elements');
    await electronApp.close();
  });

  test('should toggle to mobile view when button clicked', async () => {
    const electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    
    const page = await electronApp.firstWindow();
    const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-layout.initialized', { timeout: 10000 });
    
    const mobileToggle = page.locator('#hc-mobile-toggle');
    const viewportDisplay = page.locator('#footer-viewport');
    
    // Initial state - desktop
    let buttonText = await mobileToggle.textContent();
    expect(buttonText).toContain('Mobile');
    
    let sizeText = await viewportDisplay.textContent();
    expect(sizeText).toMatch(/1366.*768/);
    
    // Click to switch to mobile
    await mobileToggle.click();
    await page.waitForTimeout(500);
    
    // Verify button label changed
    buttonText = await mobileToggle.textContent();
    expect(buttonText).toContain('Desktop');
    
    // Verify footer shows mobile size
    sizeText = await viewportDisplay.textContent();
    expect(sizeText).toMatch(/390.*844/);
    
    consoleMonitor.printSummary('toggle to mobile');
    await electronApp.close();
  });

  test('should toggle back to desktop view', async () => {
    const electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    
    const page = await electronApp.firstWindow();
    const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-layout.initialized', { timeout: 10000 });
    
    const mobileToggle = page.locator('#hc-mobile-toggle');
    const viewportDisplay = page.locator('#footer-viewport');
    
    // Toggle to mobile
    await mobileToggle.click();
    await page.waitForTimeout(500);
    
    let buttonText = await mobileToggle.textContent();
    expect(buttonText).toContain('Desktop');
    
    let sizeText = await viewportDisplay.textContent();
    expect(sizeText).toMatch(/390.*844/);
    
    // Toggle back to desktop
    await mobileToggle.click();
    await page.waitForTimeout(1000);
    
    // Verify back to desktop
    buttonText = await mobileToggle.textContent();
    expect(buttonText).toContain('Mobile');
    
    sizeText = await viewportDisplay.textContent();
    expect(sizeText).toMatch(/1366.*768/);
    
    consoleMonitor.printSummary('toggle back to desktop');
    await electronApp.close();
  });

  test('should apply viewport size to content viewer container', async () => {
    const electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    
    const page = await electronApp.firstWindow();
    const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-layout.initialized', { timeout: 10000 });
    
    const container = page.locator('.content-viewer__container');
    await expect(container).toBeVisible();
    
    // Toggle to mobile
    const mobileToggle = page.locator('#hc-mobile-toggle');
    await mobileToggle.click();
    await page.waitForTimeout(500);
    
    // Verify container has max-width applied
    const maxWidth = await container.evaluate((el: HTMLElement) => 
      window.getComputedStyle(el).maxWidth
    );
    
    expect(maxWidth).toBe('390px');
    
    consoleMonitor.printSummary('apply viewport to container');
    await electronApp.close();
  });

  test('should get current viewport size via IPC', async () => {
    const electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    
    const page = await electronApp.firstWindow();
    const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-layout.initialized', { timeout: 10000 });
    
    const result = await page.evaluate(async () => {
      const api = (window as any).electronAPI;
      return await api.invoke('viewport:get-size');
    });
    
    expect(result.success).toBe(true);
    expect(result.size).toHaveProperty('width');
    expect(result.size).toHaveProperty('height');
    expect(result.size.width).toBe(1366);
    expect(result.size.height).toBe(768);
    
    consoleMonitor.printSummary('get viewport via IPC');
    await electronApp.close();
  });

  test('should set custom viewport size via IPC', async () => {
    const electronApp = await electron.launch({ 
      executablePath: require('electron'), 
      args: ['.'],
      timeout: 30000
    });
    
    const page = await electronApp.firstWindow();
    const consoleMonitor = new ConsoleMonitor(page, { failFastOnStructuredErrors: false });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.app-layout.initialized', { timeout: 10000 });
    
    // Verify get viewport size IPC works
    const getResult1 = await page.evaluate(async () => {
      const api = (window as any).electronAPI;
      return await api.invoke('viewport:get-size');
    });
    expect(getResult1.success).toBe(true);
    expect(getResult1.size.width).toBe(1366);
    expect(getResult1.size.height).toBe(768);
    
    // Set custom viewport size via IPC
    const setResult = await page.evaluate(async () => {
      const api = (window as any).electronAPI;
      return await api.invoke('viewport:set-size', { 
        width: 800, 
        height: 600 
      });
    });
    
    expect(setResult.success).toBe(true);
    expect(setResult.size.width).toBe(800);
    expect(setResult.size.height).toBe(600);
    
    // Verify main process state was updated
    const getResult2 = await page.evaluate(async () => {
      const api = (window as any).electronAPI;
      return await api.invoke('viewport:get-size');
    });
    expect(getResult2.success).toBe(true);
    expect(getResult2.size.width).toBe(800);
    expect(getResult2.size.height).toBe(600);
    
    // Note: UI update verification is handled by other tests that use the proper event flow
    // Direct IPC calls from page.evaluate() don't trigger the same event propagation as
    // user-initiated actions through the app's event system
    
    consoleMonitor.printSummary('set viewport via IPC');
    await electronApp.close();
  });
});
