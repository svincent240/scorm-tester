
/**
 * @jest-environment jsdom
 */

import { HeaderControls } from '../../../../src/renderer/components/header-controls.js';
import { EventBus } from '../../../../src/renderer/services/event-bus.js';

// Mock the logger
jest.mock('../../../../src/renderer/utils/renderer-logger.js', () => ({
  rendererLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('HeaderControls Component', () => {
  let headerControls;
  let eventBus;
  let rootElement;

  beforeEach(async () => {
    rootElement = document.createElement('div');
    rootElement.id = 'header-root';
    document.body.appendChild(rootElement);

    eventBus = new EventBus();
    jest.spyOn(eventBus, 'emit');

    headerControls = new HeaderControls('#header-root');
    // Manually inject the mock event bus
    headerControls.eventBus = eventBus;

    await headerControls.render();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  test('should render all control buttons', () => {
    expect(rootElement.querySelector('#hc-open-zip')).not.toBeNull();
    expect(rootElement.querySelector('#hc-open-folder')).not.toBeNull();
    expect(rootElement.querySelector('#hc-reload')).not.toBeNull();
    expect(rootElement.querySelector('#hc-inspector')).not.toBeNull();
    expect(rootElement.querySelector('#hc-theme')).not.toBeNull();
  });

  test('should have the Reload button disabled by default', () => {
    const reloadBtn = rootElement.querySelector('#hc-reload');
    expect(reloadBtn.disabled).toBe(true);
  });

  test('should emit "course:open-zip:request" when Open ZIP is clicked', () => {
    rootElement.querySelector('#hc-open-zip').click();
    expect(eventBus.emit).toHaveBeenCalledWith('course:open-zip:request');
  });

  test('should emit "course:open-folder:request" when Open Folder is clicked', () => {
    rootElement.querySelector('#hc-open-folder').click();
    expect(eventBus.emit).toHaveBeenCalledWith('course:open-folder:request');
  });

  test('should emit "ui:inspector:toggle-request" when Inspector is clicked', () => {
    rootElement.querySelector('#hc-inspector').click();
    expect(eventBus.emit).toHaveBeenCalledWith('ui:inspector:toggle-request');
  });

  test('should emit "ui:theme:toggle-request" when Theme is clicked', () => {
    rootElement.querySelector('#hc-theme').click();
    expect(eventBus.emit).toHaveBeenCalledWith('ui:theme:toggle-request');
  });

  test('should enable the Reload button on a "course:loaded" event', () => {
    const reloadBtn = rootElement.querySelector('#hc-reload');
    expect(reloadBtn.disabled).toBe(true);

    // Simulate event from another service
    eventBus.emit('course:loaded');

    expect(reloadBtn.disabled).toBe(false);
  });

  test('should disable the Reload button on a "course:cleared" event', () => {
    const reloadBtn = rootElement.querySelector('#hc-reload');
    // First, enable it
    eventBus.emit('course:loaded');
    expect(reloadBtn.disabled).toBe(false);

    // Then, clear the course
    eventBus.emit('course:cleared');

    expect(reloadBtn.disabled).toBe(true);
  });

  test('should emit "course:reload:request" when the enabled Reload button is clicked', () => {
    const reloadBtn = rootElement.querySelector('#hc-reload');
    eventBus.emit('course:loaded'); // Enable the button
    
    reloadBtn.click();

    expect(eventBus.emit).toHaveBeenCalledWith('course:reload:request');
  });
});
