
/**
 * @jest-environment jsdom
 */

import { CourseOutline } from '../../../../src/renderer/components/scorm/course-outline.js';
import { EventBus } from '../../../../src/renderer/services/event-bus.js';

// Mock dependencies
const mockSnBridge = {
  validateCourseOutlineChoice: jest.fn(),
  getCourseOutlineActivityTree: jest.fn(),
  getCourseOutlineAvailableNavigation: jest.fn(),
};



jest.mock('../../../../src/renderer/utils/renderer-logger.js', () => ({
  rendererLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CourseOutline Component Logic', () => {
  let courseOutline;
  let eventBus;
  let rootElement;
  const mockCourseStructure = {
    identifier: 'course-root',
    items: [
      { identifier: 'item-1', title: 'Module 1', type: 'sco' },
      {
        identifier: 'item-2', title: 'Module 2', type: 'agg', items: [
          { identifier: 'item-2-1', title: 'Sub-Module 2.1', type: 'sco' },
        ]
      },
    ]
  };

  beforeEach(async () => {
    document.body.innerHTML = '<div id="outline-root"></div>';
    rootElement = document.getElementById('outline-root');
    eventBus = new EventBus();
    jest.spyOn(eventBus, 'emit');

    // Mock the uiState dependency to be a simple object
    const mockUiState = {
      getState: jest.fn(),
      setState: jest.fn(),
    };

    courseOutline = new CourseOutline('#outline-root', { snBridge: mockSnBridge });
    courseOutline.eventBus = eventBus;
    courseOutline.uiState = mockUiState;

    // Mock that SCORM states are loaded so navigation is allowed
    courseOutline.scormStatesLoaded = true;

    await courseOutline.render();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should render an empty state when no course is loaded', () => {
    courseOutline.showEmptyState();
    expect(rootElement.querySelector('.empty-state__title').textContent).toBe('No Course Loaded');
  });

  test('should render the course structure when a "course:loaded" event is received', () => {
    courseOutline.handleCourseLoaded({ structure: mockCourseStructure });
    const items = rootElement.querySelectorAll('.outline-item__title');
    expect(items.length).toBe(3);
    expect(items[0].textContent.trim()).toBe('Module 1');
    expect(items[1].textContent.trim()).toBe('Module 2');
    expect(items[2].textContent.trim()).toBe('Sub-Module 2.1');
  });

  test('clicking an item should first call for authoritative validation', async () => {
    courseOutline.handleCourseLoaded({ structure: mockCourseStructure });
    // Mark states loaded to allow navigation in unit test scope
    courseOutline.scormStatesLoaded = true;

    mockSnBridge.validateCourseOutlineChoice.mockResolvedValue({ success: true, allowed: true });

    const itemToClick = rootElement.querySelector('[data-item-id="item-1"] .outline-item__title');
    itemToClick.click();

    // Wait for async operations in navigateToItem
    await new Promise(process.nextTick);

    expect(mockSnBridge.validateCourseOutlineChoice).toHaveBeenCalledWith('item-1');
  });

  test('should emit "navigation:request" if validation succeeds', async () => {
    courseOutline.handleCourseLoaded({ structure: mockCourseStructure });
    courseOutline.scormStatesLoaded = true;

    mockSnBridge.validateCourseOutlineChoice.mockResolvedValue({ success: true, allowed: true });

    const itemToClick = rootElement.querySelector('[data-item-id="item-1"] .outline-item__title');
    itemToClick.click();

    await new Promise(process.nextTick);

    expect(mockSnBridge.validateCourseOutlineChoice).toHaveBeenCalledWith('item-1');
    expect(eventBus.emit).toHaveBeenCalledWith('navigation:request', {
      requestType: 'choice',
      activityId: 'item-1',
      source: 'course-outline'
    });
  });

  test('should NOT emit "navigation:request" if validation fails', async () => {
    courseOutline.handleCourseLoaded({ structure: mockCourseStructure });
    courseOutline.scormStatesLoaded = true;

    mockSnBridge.validateCourseOutlineChoice.mockResolvedValue({ success: true, allowed: false, reason: 'Sequencing rules forbid it' });

    const itemToClick = rootElement.querySelector('[data-item-id="item-1"] .outline-item__title');
    itemToClick.click();

    await new Promise(process.nextTick);

    expect(mockSnBridge.validateCourseOutlineChoice).toHaveBeenCalledWith('item-1');
    expect(eventBus.emit).not.toHaveBeenCalledWith('navigation:request', expect.any(Object));
    // It should emit a denied event instead
    expect(eventBus.emit).toHaveBeenCalledWith('navigationDenied', { itemId: 'item-1', reason: 'Sequencing rules forbid it' });
  });
});
